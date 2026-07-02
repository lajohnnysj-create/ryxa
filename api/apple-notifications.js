// Vercel serverless function ,  Sign in with Apple: Server-to-Server Notifications
// =================================================================================
// Apple POSTs here when a user who used "Sign in with Apple" on Ryxa:
//   • permanently deletes their Apple Account          -> type: account-delete
//   • revokes Sign in with Apple for Ryxa              -> type: consent-revoked
//   • turns private-relay email forwarding off / on    -> type: email-disabled / email-enabled
//
// Docs: https://developer.apple.com/documentation/signinwithapplerestapi/processing_changes_for_sign_in_with_apple_accounts
//
// Deploy to: /api/apple-notifications.js
// Configured in Apple Developer as the Server-to-Server Notification Endpoint:
//   https://ryxa.io/api/apple-notifications
//
// Security: Apple sends a signed JWT. We verify its signature against Apple's
// published public keys and check the issuer/audience before acting. We never
// trust the body without verification.
// =================================================================================

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLE_SERVICES_ID = process.env.APPLE_SERVICES_ID || 'io.ryxa.web';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';

// ----- helpers ----------------------------------------------------------------

function base64UrlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

// Verify Apple's signed JWT against Apple's published public keys (JWKS) and
// confirm issuer + audience. Returns the decoded payload, or null if invalid.
async function verifyAppleJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
  } catch (e) { return null; }

  if (!header || header.alg !== 'RS256' || !header.kid) return null;

  let jwks;
  try {
    const r = await fetch(APPLE_KEYS_URL);
    if (!r.ok) return null;
    jwks = await r.json();
  } catch (e) { return null; }
  const jwk = (jwks && Array.isArray(jwks.keys)) ? jwks.keys.find(k => k.kid === header.kid) : null;
  if (!jwk) return null;

  let ok = false;
  try {
    const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const signingInput = Buffer.from(parts[0] + '.' + parts[1]);
    ok = crypto.verify('RSA-SHA256', signingInput, pubKey, base64UrlDecode(parts[2]));
  } catch (e) { return null; }
  if (!ok) return null;

  if (payload.iss !== APPLE_ISSUER) return null;
  if (payload.aud !== APPLE_SERVICES_ID) return null;
  if (payload.exp && (Date.now() / 1000) > payload.exp) return null;

  return payload;
}

function svcHeaders(extra) {
  const h = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
  };
  if (extra) Object.assign(h, extra);
  return h;
}

// Map an Apple `sub` to a Supabase user id via a SECURITY DEFINER RPC that reads
// auth.identities. Returns the uuid string, or null if no match.
async function findUserByAppleSub(sub) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/find_user_by_apple_sub', {
      method: 'POST',
      headers: svcHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_sub: sub })
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data || null;
  } catch (e) { return null; }
}

// Returns the user's identity list (e.g., [{provider:'apple'},{provider:'google'}]),
// or null if it could not be determined (caller should then fail safe).
async function getUserIdentities(userId) {
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
      method: 'GET',
      headers: svcHeaders()
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && Array.isArray(u.identities)) ? u.identities : [];
  } catch (e) { return null; }
}

async function deleteAccount(userId) {
  // 1. Remove all app data (same path as in-app account deletion).
  const r1 = await fetch(SUPABASE_URL + '/rest/v1/rpc/delete_my_account', {
    method: 'POST',
    headers: svcHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ p_uid: userId })
  });
  if (!r1.ok) throw new Error('delete_my_account failed: ' + r1.status);

  // 2. Remove the auth user (also drops the Apple identity). 404 = already gone.
  const r2 = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
    method: 'DELETE',
    headers: svcHeaders()
  });
  if (!r2.ok && r2.status !== 404) throw new Error('auth user delete failed: ' + r2.status);
}

// ----- handler ----------------------------------------------------------------

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!SUPABASE_SERVICE_KEY) {
    console.error('apple-notifications: missing SUPABASE_SERVICE_ROLE_KEY');
    res.status(500).json({ error: 'server misconfigured' });
    return;
  }

  // Apple posts { "payload": "<signed JWT>" } as application/json.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const signedPayload = body && body.payload;
  if (!signedPayload) { res.status(400).json({ error: 'missing payload' }); return; }

  const claims = await verifyAppleJwt(signedPayload);
  if (!claims) { res.status(401).json({ error: 'invalid token' }); return; }

  // Event details live in the `events` claim (a JSON string).
  let events = claims.events;
  if (typeof events === 'string') { try { events = JSON.parse(events); } catch (e) { events = null; } }
  if (!events || !events.type) { res.status(200).json({ ok: true }); return; }

  try {
    const type = events.type;
    const sub = events.sub;

    if (type === 'account-delete' && sub) {
      const userId = await findUserByAppleSub(sub);
      if (!userId) {
        console.log('apple-notifications: account-delete -> no matching user');
      } else {
        const identities = await getUserIdentities(userId);
        if (identities === null) {
          // Could not confirm login methods; fail safe and let Apple retry
          // rather than risk deleting an account that still has other logins.
          throw new Error('could not verify identities for user');
        }
        const nonApple = identities.filter(i => i && i.provider !== 'apple');
        if (nonApple.length === 0) {
          await deleteAccount(userId);
          console.log('apple-notifications: account-delete -> account removed (Apple was sole login)');
        } else {
          console.log('apple-notifications: account-delete -> kept (user has ' + nonApple.length + ' other login method(s)); Apple identity now dangling');
        }
      }
    } else if (type === 'consent-revoked') {
      // User revoked Sign in with Apple. Not a data-deletion request, so we do
      // not delete their account (they may have other logins, or re-grant). The
      // stale Apple session will fail on its next token refresh.
      console.log('apple-notifications: consent-revoked (logged; no data deleted)');
    } else {
      // email-disabled / email-enabled and anything else: nothing destructive.
      console.log('apple-notifications: ' + type + ' (no action)');
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    // 500 tells Apple to retry (handles transient failures without data loss).
    console.error('apple-notifications processing error:', e.message);
    res.status(500).json({ error: 'processing failed' });
  }
};
