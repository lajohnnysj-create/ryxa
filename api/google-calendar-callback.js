// /api/google-calendar-callback.js
//
// Handles Google's redirect after the user grants/denies consent.
//
// Flow:
//   1. Verify the state cookie matches Google's state param (CSRF guard)
//   2. Exchange the auth code for access_token + refresh_token
//   3. Look up the connected Google account's email (userinfo endpoint)
//   4. Upsert tokens in google_calendar_connections via PostgREST + service role
//   5. Redirect the user back to the dashboard with a success/error flag
//
// On reconnect, we always start fresh — disconnect deletes the previous
// calendar from Google and wipes the row, so this is always either a fresh
// install or a clean reconnect. The edge function will lazily create a new
// "Ryxa" calendar on the first sync.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI;
const TICKET_SIGNING_SECRET = process.env.GCAL_TICKET_SIGNING_SECRET;

const crypto = require('crypto');
const { encryptToken } = require('./lib/token-crypto');

const DASHBOARD_URL = 'https://ryxa.io/dashboard.html';

// State token TTL — reject states older than 10 minutes.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Must match the prefix in google-calendar-start.js getStateSigningKey()
function getStateSigningKey() {
  return crypto.createHash('sha256').update('ryxa_gcal_state_' + TICKET_SIGNING_SECRET).digest();
}

// Verify HMAC-signed state and return parsed payload, or null on any failure.
// Returns { uid, n, ts } on success.
function verifyState(stateRaw) {
  if (!stateRaw) return null;
  try {
    const decoded = Buffer.from(String(stateRaw), 'base64url').toString('utf8');
    const wrapper = JSON.parse(decoded);
    if (!wrapper || !wrapper.p || !wrapper.h) return null;

    const payloadStr = wrapper.p;
    const receivedHmac = wrapper.h;
    const expectedHmac = crypto
      .createHmac('sha256', getStateSigningKey())
      .update(payloadStr)
      .digest('hex');

    if (
      receivedHmac.length !== expectedHmac.length ||
      !crypto.timingSafeEqual(
        Buffer.from(receivedHmac, 'hex'),
        Buffer.from(expectedHmac, 'hex')
      )
    ) {
      console.error('Calendar state HMAC mismatch');
      return null;
    }

    const payload = JSON.parse(payloadStr);
    if (!payload || !payload.uid || !payload.n || !payload.ts) return null;

    // Expiry check
    const age = Date.now() - Number(payload.ts);
    if (!isFinite(age) || age < 0 || age > STATE_MAX_AGE_MS) {
      console.error('Calendar state expired, age:', age);
      return null;
    }

    return payload;
  } catch (e) {
    console.error('Calendar verifyState failed:', e.message);
    return null;
  }
}

function redirectWithFlag(res, flag, reason) {
  const url = new URL(DASHBOARD_URL);
  url.searchParams.set('gcal', flag);
  if (reason) url.searchParams.set('reason', reason);
  url.searchParams.set('view', 'calendar-settings');
  res.setHeader('Set-Cookie', 'ryxa_gcal_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return res.redirect(302, url.toString());
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error: googleError } = req.query;

  if (googleError) {
    return redirectWithFlag(res, 'cancelled', googleError);
  }

  if (!code || !state) {
    return redirectWithFlag(res, 'error', 'missing_params');
  }

  // CSRF check
  const cookieHeader = req.headers.cookie || '';
  const cookieMatch = cookieHeader.match(/ryxa_gcal_state=([^;]+)/);
  const cookieNonce = cookieMatch ? cookieMatch[1] : null;
  if (!cookieNonce) {
    return redirectWithFlag(res, 'error', 'state_missing');
  }

  // HMAC-verify state. Defense in depth: cookie binding alone proves the
  // browser session, but HMAC additionally proves Ryxa generated the state
  // (no tampering of state.uid possible). Both checks must pass.
  const stateData = verifyState(state);
  if (!stateData) {
    return redirectWithFlag(res, 'error', 'state_invalid');
  }

  // Cookie nonce must match what we embedded in the signed state.
  if (stateData.n !== cookieNonce) {
    return redirectWithFlag(res, 'error', 'state_mismatch');
  }

  const userId = stateData.uid;

  // Exchange auth code for tokens
  let tokens;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Google token exchange failed:', tokenRes.status, errText);
      return redirectWithFlag(res, 'error', 'token_exchange_failed');
    }

    tokens = await tokenRes.json();
  } catch (e) {
    console.error('Token exchange error:', e);
    return redirectWithFlag(res, 'error', 'token_exchange_failed');
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    console.error('Missing tokens in Google response. Got keys:', Object.keys(tokens));
    return redirectWithFlag(res, 'error', 'incomplete_tokens');
  }

  // Get the email of the connected Google account (best-effort)
  let googleEmail = null;
  try {
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      googleEmail = profile.email || null;
    }
  } catch (e) {
    console.error('Userinfo fetch failed:', e);
  }

  // Upsert into google_calendar_connections.
  // On reconnect, the disconnect flow has already wiped the previous row,
  // so this is always effectively a fresh insert. But we use upsert (merge)
  // for safety in case of any half-failed disconnects.
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  const nowIso = new Date().toISOString();

  try {
    const upsertRes = await fetch(
      SUPABASE_URL + '/rest/v1/google_calendar_connections?on_conflict=user_id',
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          user_id: userId,
          google_email: googleEmail,
          // Encrypted at rest; the Edge Function that syncs the calendar
          // decrypts these in-memory before calling Google's API.
          access_token: encryptToken(tokens.access_token),
          refresh_token: encryptToken(tokens.refresh_token),
          scope: tokens.scope || 'https://www.googleapis.com/auth/calendar.app.created',
          expires_at: expiresAt,
          ryxa_calendar_id: null,
          connected_at: nowIso,
          updated_at: nowIso,
        }),
      }
    );

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error('Supabase upsert failed:', upsertRes.status, errText);
      return redirectWithFlag(res, 'error', 'db_write_failed');
    }
  } catch (e) {
    console.error('DB write error:', e);
    return redirectWithFlag(res, 'error', 'db_write_failed');
  }

  // Fire an immediate sync so the user sees their events on Google
  // right after connecting (rather than waiting up to 15 min for the
  // next sweep cron). Best-effort — if this fails, the cron still catches up.
  try {
    // Read function URL + auth from app_config so we don't duplicate secrets
    const configRes = await fetch(
      SUPABASE_URL +
        '/rest/v1/app_config?key=in.(gcal_sync_function_url,gcal_sync_function_authorization)&select=key,value',
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        },
      }
    );

    if (configRes.ok) {
      const rows = await configRes.json();
      const cfg = {};
      (rows || []).forEach((r) => { cfg[r.key] = r.value; });

      if (cfg.gcal_sync_function_url && cfg.gcal_sync_function_authorization) {
        // Fire-and-forget — don't await, don't let it slow down the redirect
        fetch(cfg.gcal_sync_function_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: cfg.gcal_sync_function_authorization,
          },
          body: JSON.stringify({ user_id: userId, trigger: 'connect' }),
        }).catch((e) => console.error('Initial sync trigger failed (non-fatal):', e));
      }
    }
  } catch (e) {
    console.error('Initial sync setup failed (non-fatal):', e);
  }

  return redirectWithFlag(res, 'connected');
};
