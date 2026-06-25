// Shared Twitch data fetcher - imported by:
//   - api/twitch-data-fetch.js   (creator-triggered, auto + manual refresh)
//   - api/twitch-cron-refresh.js (background cron)
//
// Pulls the Twitch profile (helix/users) + follower count
// (helix/channels/followers) and writes them to the twitch_connections row.
// The public_twitch_kit_data view exposes the safe subset automatically.
//
// Twitch access tokens expire ~4h, so this helper first ensures a fresh access
// token before any API call. Twitch MAY rotate the refresh token on refresh, so
// we persist whatever refresh token comes back (re-encrypted). No plaintext
// tokens leave the server or get written to the DB. Every Helix call needs BOTH
// Authorization: Bearer AND Client-Id headers.
//
// Usage:
//   const { refreshTwitchData } = require('./_twitch-fetch-helper.js');
//   const result = await refreshTwitchData(userId);
//   // result = { ok: true, data: {...} }  or  { ok: false, error: '...' }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';
const USERS_ENDPOINT = 'https://api.twitch.tv/helix/users';
const FOLLOWERS_ENDPOINT = 'https://api.twitch.tv/helix/channels/followers';

const { decryptToken, encryptToken } = require('./lib/token-crypto');

// ============================================================
// HELPERS
// ============================================================

function bearerHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

// ============================================================
// LOAD CONNECTION ROW
// ============================================================

async function loadConnection(userId) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/twitch_connections?user_id=eq.' + encodeURIComponent(userId) +
      '&select=user_id,access_token,refresh_token,token_expires_at,twitch_user_id',
    { headers: bearerHeaders() }
  );
  if (!res.ok) throw new Error('Failed to load connection: ' + res.status);
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

// ============================================================
// TOKEN REFRESH (Twitch access tokens expire ~4h; refresh token MAY rotate)
// ============================================================
//
// Returns a usable plaintext access token. If the stored one is expired (or
// within a 5-min skew), refreshes via the refresh token, then persists the
// re-encrypted NEW access token (and the new refresh token if Twitch rotated it)
// with the new expiry.
async function ensureFreshToken(userId, conn) {
  let accessToken;
  let refreshToken;
  try {
    accessToken = decryptToken(conn.access_token);
    refreshToken = decryptToken(conn.refresh_token);
  } catch (e) {
    throw new Error('Token decryption failed; reconnect Twitch');
  }
  if (!refreshToken) throw new Error('No refresh token stored; reconnect Twitch');

  const expMs = conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
  const skewMs = 5 * 60 * 1000;
  if (accessToken && expMs && Date.now() < expMs - skewMs) {
    return accessToken; // still valid
  }

  // Refresh.
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const text = await tokenRes.text();
  let tok;
  try { tok = JSON.parse(text); } catch { tok = null; }

  if (!tokenRes.ok || !tok || tok.error || !tok.access_token) {
    console.error('Twitch token refresh failed:', tokenRes.status, text);
    throw new Error('Token refresh failed; reconnect Twitch');
  }

  const newTokenExpiry = new Date(Date.now() + (tok.expires_in || 14400) * 1000).toISOString();
  // Persist the new access token; if Twitch rotated the refresh token, persist
  // that too. Best-effort: if this write fails we still return the token so this
  // run succeeds; next run retries.
  const patch = {
    access_token: encryptToken(tok.access_token),
    token_expires_at: newTokenExpiry,
    last_refreshed_at: new Date().toISOString(),
  };
  if (tok.refresh_token) {
    patch.refresh_token = encryptToken(tok.refresh_token);
  }
  try {
    await fetch(
      SUPABASE_URL + '/rest/v1/twitch_connections?user_id=eq.' + encodeURIComponent(userId),
      { method: 'PATCH', headers: bearerHeaders(), body: JSON.stringify(patch) }
    );
  } catch (e) {
    console.error('Persisting refreshed token failed (non-fatal):', e.message);
  }

  return tok.access_token;
}

// ============================================================
// MAIN
// ============================================================

async function refreshTwitchData(userId) {
  if (!SUPABASE_SERVICE_KEY || !TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    return { ok: false, error: 'Server not configured' };
  }

  const conn = await loadConnection(userId);
  if (!conn) return { ok: false, error: 'Not connected to Twitch' };

  let token;
  try {
    token = await ensureFreshToken(userId, conn);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const helixHeaders = {
    Authorization: 'Bearer ' + token,
    'Client-Id': TWITCH_CLIENT_ID,
  };

  const collected = {};
  const errors = [];
  let broadcasterId = conn.twitch_user_id || null;

  // ---- Profile (helix/users; no params -> the authenticated user) ----
  try {
    const usersRes = await fetch(USERS_ENDPOINT, { headers: helixHeaders });
    const usersText = await usersRes.text();
    let usersBody;
    try { usersBody = JSON.parse(usersText); } catch { usersBody = null; }
    if (usersRes.ok && usersBody && Array.isArray(usersBody.data) && usersBody.data[0]) {
      const u = usersBody.data[0];
      broadcasterId = u.id ? String(u.id) : broadcasterId;
      const login = u.login ? String(u.login) : null;
      collected.twitch_user_id = broadcasterId;
      collected.tw_display_name = u.display_name || null;
      collected.tw_login = login;
      collected.tw_avatar_url = u.profile_image_url || null;
      collected.tw_description = u.description || null;
      collected.tw_broadcaster_type = typeof u.broadcaster_type === 'string' ? u.broadcaster_type : null;
      collected.tw_profile_url = login ? ('https://twitch.tv/' + login) : null;
    } else {
      errors.push('users:HTTP ' + usersRes.status);
    }
  } catch (e) {
    errors.push('users:' + e.message);
  }

  // ---- Follower count (helix/channels/followers -> total) ----
  if (broadcasterId) {
    try {
      const fRes = await fetch(FOLLOWERS_ENDPOINT + '?broadcaster_id=' + encodeURIComponent(broadcasterId), {
        headers: helixHeaders,
      });
      const fText = await fRes.text();
      let fBody;
      try { fBody = JSON.parse(fText); } catch { fBody = null; }
      if (fRes.ok && fBody && typeof fBody.total === 'number') {
        collected.follower_count = toInt(fBody.total);
      } else {
        errors.push('followers:HTTP ' + fRes.status);
      }
    } catch (e) {
      errors.push('followers:' + e.message);
    }
  } else {
    errors.push('followers:no_broadcaster_id');
  }

  // ---- Write ----
  collected.data_last_fetched_at = new Date().toISOString();
  collected.data_fetch_error = errors.length > 0 ? errors.join(' | ') : null;
  collected.last_refreshed_at = new Date().toISOString();

  const updateRes = await fetch(
    SUPABASE_URL + '/rest/v1/twitch_connections?user_id=eq.' + encodeURIComponent(userId),
    {
      method: 'PATCH',
      headers: Object.assign({}, bearerHeaders(), { Prefer: 'return=representation' }),
      body: JSON.stringify(collected),
    }
  );

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    return { ok: false, error: 'DB write failed: ' + errText };
  }

  const updated = await updateRes.json();
  return { ok: true, data: updated[0] || collected };
}

module.exports = { refreshTwitchData };
