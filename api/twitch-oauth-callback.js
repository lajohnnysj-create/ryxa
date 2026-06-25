// /api/twitch-oauth-callback.js
//
// Handles Twitch's redirect after the user grants/denies consent.
// Served at the locked redirect URI https://ryxa.io/auth/twitch/callback via a
// vercel.json rewrite (apex 308s to www; the rewrite maps the path here).
//
// Flow:
//   1. Verify the state cookie matches the HMAC-signed state param (CSRF).
//   2. Exchange the auth code for access_token + refresh_token.
//   3. Fetch the profile (helix/users) + follower count (helix/channels/followers).
//   4. Encrypt both tokens and upsert into twitch_connections.
//   5. Redirect back to the dashboard with a success/error flag.
//
// Twitch specifics:
//   - Token endpoint returns FLAT JSON (access_token, refresh_token, expires_in,
//     scope [array], token_type).
//   - Every Helix call requires BOTH Authorization: Bearer AND Client-Id headers.
//   - helix/users returns { data: [ { id, login, display_name, ... } ] }.
//   - helix/channels/followers returns { total, data: [...] }; total is the
//     follower count (needs moderator:read:followers; broadcaster_id == own id).
//
// Tokens are AES-256-GCM encrypted at rest via lib/token-crypto. Plaintext
// tokens never touch the database.

const crypto = require('crypto');
const { encryptToken } = require('./lib/token-crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const TWITCH_REDIRECT_URI = process.env.TWITCH_OAUTH_REDIRECT_URI;
const TICKET_SIGNING_SECRET = process.env.TWITCH_TICKET_SIGNING_SECRET;

const DASHBOARD_URL = 'https://ryxa.io/dashboard.html';

const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';
const USERS_ENDPOINT = 'https://api.twitch.tv/helix/users';
const FOLLOWERS_ENDPOINT = 'https://api.twitch.tv/helix/channels/followers';

// State token TTL: reject states older than 10 minutes.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Must match the prefix in twitch-oauth-start.js getStateSigningKey().
function getStateSigningKey() {
  return crypto.createHash('sha256').update('ryxa_tw_state_' + TICKET_SIGNING_SECRET).digest();
}

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
      console.error('Twitch state HMAC mismatch');
      return null;
    }

    const payload = JSON.parse(payloadStr);
    if (!payload || !payload.uid || !payload.n || !payload.ts) return null;

    const age = Date.now() - Number(payload.ts);
    if (!isFinite(age) || age < 0 || age > STATE_MAX_AGE_MS) {
      console.error('Twitch state expired, age:', age);
      return null;
    }

    return payload;
  } catch (e) {
    console.error('Twitch verifyState failed:', e.message);
    return null;
  }
}

function redirectWithFlag(res, flag, reason) {
  const url = new URL(DASHBOARD_URL);
  url.searchParams.set('twitch_status', flag);
  if (reason) url.searchParams.set('twitch_message', reason);
  res.setHeader('Set-Cookie', 'ryxa_tw_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return res.redirect(302, url.toString());
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !TWITCH_REDIRECT_URI ||
      !TICKET_SIGNING_SECRET || !SUPABASE_SERVICE_KEY) {
    console.error('Missing env vars');
    return redirectWithFlag(res, 'error', 'misconfigured');
  }

  const { code, state, error: twError } = req.query || {};

  if (twError) {
    return redirectWithFlag(res, 'cancelled', String(twError));
  }
  if (!code || !state) {
    return redirectWithFlag(res, 'error', 'missing_params');
  }

  // CSRF: cookie nonce must be present and match the signed state nonce.
  const cookieHeader = req.headers.cookie || '';
  const cookieMatch = cookieHeader.match(/ryxa_tw_state=([^;]+)/);
  const cookieNonce = cookieMatch ? cookieMatch[1] : null;
  if (!cookieNonce) {
    return redirectWithFlag(res, 'error', 'state_missing');
  }

  const stateData = verifyState(state);
  if (!stateData) {
    return redirectWithFlag(res, 'error', 'state_invalid');
  }
  if (stateData.n !== cookieNonce) {
    return redirectWithFlag(res, 'error', 'state_mismatch');
  }

  const userId = stateData.uid;

  // Exchange auth code for tokens (flat JSON response).
  let tokens;
  try {
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        code: String(code),
        grant_type: 'authorization_code',
        redirect_uri: TWITCH_REDIRECT_URI,
      }),
    });

    const tokenText = await tokenRes.text();
    try { tokens = JSON.parse(tokenText); } catch { tokens = null; }

    if (!tokenRes.ok || !tokens || tokens.error) {
      // Never reflect Twitch's error_description into the client redirect.
      console.error('Twitch token exchange failed:', tokenRes.status, tokenText);
      return redirectWithFlag(res, 'error', 'token_exchange_failed');
    }
  } catch (e) {
    console.error('Token exchange error:', e);
    return redirectWithFlag(res, 'error', 'token_exchange_failed');
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    console.error('Missing tokens in Twitch response. Got keys:', Object.keys(tokens));
    return redirectWithFlag(res, 'error', 'incomplete_tokens');
  }

  const helixHeaders = {
    Authorization: 'Bearer ' + tokens.access_token,
    'Client-Id': TWITCH_CLIENT_ID,
  };

  // Fetch profile (helix/users; no params -> the authenticated user).
  let user = null;
  try {
    const usersRes = await fetch(USERS_ENDPOINT, { headers: helixHeaders });
    const usersText = await usersRes.text();
    let usersBody;
    try { usersBody = JSON.parse(usersText); } catch { usersBody = null; }
    if (usersRes.ok && usersBody && Array.isArray(usersBody.data) && usersBody.data[0]) {
      user = usersBody.data[0];
    } else {
      console.error('Twitch helix/users fetch failed:', usersRes.status, usersText);
    }
  } catch (e) {
    console.error('Twitch helix/users error:', e);
  }

  if (!user || !user.id) {
    return redirectWithFlag(res, 'error', 'no_profile');
  }

  // Fetch follower count (best-effort; needs moderator:read:followers).
  let followerCount = null;
  let fetchError = null;
  try {
    const fRes = await fetch(FOLLOWERS_ENDPOINT + '?broadcaster_id=' + encodeURIComponent(user.id), {
      headers: helixHeaders,
    });
    const fText = await fRes.text();
    let fBody;
    try { fBody = JSON.parse(fText); } catch { fBody = null; }
    if (fRes.ok && fBody && typeof fBody.total === 'number') {
      followerCount = toInt(fBody.total);
    } else {
      fetchError = 'followers:HTTP ' + fRes.status;
      console.error('Twitch followers fetch failed:', fRes.status, fText);
    }
  } catch (e) {
    fetchError = 'followers:' + e.message;
    console.error('Twitch followers error:', e);
  }

  const nowIso = new Date().toISOString();
  const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in || 14400) * 1000).toISOString();
  // Twitch returns scope as an array; normalize to a string[].
  const scopesArr = Array.isArray(tokens.scope)
    ? tokens.scope
    : (tokens.scope ? String(tokens.scope).split(' ').map((s) => s.trim()).filter(Boolean) : null);

  const login = user.login ? String(user.login) : null;

  try {
    const upsertRes = await fetch(
      SUPABASE_URL + '/rest/v1/twitch_connections?on_conflict=user_id',
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
          twitch_user_id: String(user.id),
          tw_display_name: user.display_name || null,
          tw_login: login,
          tw_avatar_url: user.profile_image_url || null,
          tw_description: user.description || null,
          tw_broadcaster_type: typeof user.broadcaster_type === 'string' ? user.broadcaster_type : null,
          tw_profile_url: login ? ('https://twitch.tv/' + login) : null,
          access_token: encryptToken(tokens.access_token),
          refresh_token: encryptToken(tokens.refresh_token),
          scopes: scopesArr,
          token_expires_at: tokenExpiresAt,
          connected_at: nowIso,
          last_refreshed_at: nowIso,
          follower_count: followerCount,
          data_last_fetched_at: nowIso,
          data_fetch_error: fetchError,
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

  return redirectWithFlag(res, 'connected');
};
