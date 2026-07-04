// Vercel serverless function - YouTube Disconnect
// ===================================================
// Disconnects a user's YouTube account from Ryxa:
//   1. Verifies the calling user is authenticated
//   2. Revokes the OAuth grant on Google's side
//   3. Deletes the connection row from our database
//
// Failure on Google's side does NOT block local deletion: the user's intent
// to disconnect is honored either way.
//
// Deploy to: /api/youtube-disconnect.js
// Endpoint URL: https://ryxa.io/api/youtube-disconnect
// ===================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { decryptToken } = require('./lib/token-crypto');

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

// Look up the user's stored tokens (to revoke the grant).
async function fetchUserTokens(userId) {
  const url =
    SUPABASE_URL +
    '/rest/v1/youtube_connections?user_id=eq.' +
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

// Revoke the grant on Google's side. Revoking the refresh token kills the
// whole grant. Falls back to the access token if no refresh token is present.
async function revokeGoogleToken(token) {
  try {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Google revoke failed:', res.status, err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Google revoke exception:', e.message);
    return false;
  }
}

async function deleteConnection(userId) {
  const res = await fetch(
    SUPABASE_URL +
      '/rest/v1/youtube_connections?user_id=eq.' +
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
  if (require('./lib/rate-limit').tooMany(req, res, 'yt-disconnect', 10, 60000)) return;

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

  // Revoke on Google (non-fatal). Prefer the refresh token (revokes the whole
  // grant); fall back to access token. Decrypt first; corrupt ciphertext still
  // proceeds to the local delete.
  let revoked = false;
  let plain = null;
  try {
    plain = decryptToken(conn.refresh_token) || decryptToken(conn.access_token);
  } catch (e) {
    console.warn('Could not decrypt token for revoke; proceeding with local delete:', e.message);
  }
  if (plain) {
    revoked = await revokeGoogleToken(plain);
  }

  try {
    const deleted = await deleteConnection(userId);
    return res.status(200).json({
      ok: true,
      revoked_on_google: revoked,
      deleted_rows: Array.isArray(deleted) ? deleted.length : 0,
    });
  } catch (e) {
    console.error('DB delete failed:', e.message);
    return res.status(500).json({ error: 'Failed to delete connection' });
  }
};
