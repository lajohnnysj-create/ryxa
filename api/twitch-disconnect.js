// Vercel serverless function - Twitch Disconnect
// ===================================================
// Disconnects a user's Twitch account from Ryxa:
//   1. Verifies the calling user is authenticated
//   2. Revokes the OAuth grant on Twitch's side
//   3. Deletes the connection row from our database
//
// Failure on Twitch's side does NOT block local deletion: the user's intent to
// disconnect is honored either way.
//
// Twitch's revoke endpoint takes client_id + token (no client_secret).
//
// Deploy to: /api/twitch-disconnect.js
// Endpoint URL: https://ryxa.io/api/twitch-disconnect
// ===================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const { decryptToken } = require('./lib/token-crypto');

const REVOKE_ENDPOINT = 'https://id.twitch.tv/oauth2/revoke';

async function verifySupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        apikey: SUPABASE_SERVICE_KEY,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.id ? data.id : null;
  } catch (e) {
    console.error('verifySupabaseUser failed:', e.message);
    return null;
  }
}

async function fetchUserTokens(userId) {
  const url =
    SUPABASE_URL +
    '/rest/v1/twitch_connections?user_id=eq.' +
    encodeURIComponent(userId) +
    '&select=access_token,refresh_token&limit=1';
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
    },
  });
  if (!res.ok) {
    console.error('Token lookup failed:', res.status);
    return null;
  }
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

// Revoke the grant on Twitch's side. Twitch requires client_id + the token.
async function revokeTwitchToken(token) {
  try {
    const res = await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        token: token,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Twitch revoke failed:', res.status, err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Twitch revoke exception:', e.message);
    return false;
  }
}

async function deleteConnection(userId) {
  const res = await fetch(
    SUPABASE_URL +
      '/rest/v1/twitch_connections?user_id=eq.' +
      encodeURIComponent(userId),
    {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        Prefer: 'return=representation',
      },
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Delete failed: ' + res.status + ' ' + err);
  }
  return res.json();
}

module.exports = async function handler(req, res) {
  // Per-IP rate limit: 10 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'tw-disconnect', 10, 60000)) return;

  res.setHeader('Access-Control-Allow-Origin', 'https://ryxa.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  const userId = await verifySupabaseUser(accessToken);
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const conn = await fetchUserTokens(userId);
  if (!conn) {
    return res.status(200).json({ ok: true, message: 'No connection to remove' });
  }

  // Revoke on Twitch (non-fatal). Prefer the access token for revoke; fall back
  // to the refresh token. Decrypt first; corrupt ciphertext still proceeds to
  // the local delete.
  let revoked = false;
  let plain = null;
  try {
    plain = decryptToken(conn.access_token) || decryptToken(conn.refresh_token);
  } catch (e) {
    console.warn('Could not decrypt token for revoke; proceeding with local delete:', e.message);
  }
  if (plain) {
    revoked = await revokeTwitchToken(plain);
  }

  try {
    const deleted = await deleteConnection(userId);
    return res.status(200).json({
      ok: true,
      revoked_on_twitch: revoked,
      deleted_rows: Array.isArray(deleted) ? deleted.length : 0,
    });
  } catch (e) {
    console.error('DB delete failed:', e.message);
    return res.status(500).json({ error: 'Failed to delete connection' });
  }
};
