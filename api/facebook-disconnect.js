// Vercel serverless function - Facebook Disconnect
// ===================================================
// Disconnects a user's Facebook Page from Ryxa:
//   1. Verifies the calling user is authenticated (Supabase JWT)
//   2. Revokes the token on Meta's side (best-effort, non-fatal)
//   3. Deletes the connection row from our database (must succeed)
//
// Mirrors instagram-disconnect.js.
//
// Deploy to: /api/facebook-disconnect.js
// Endpoint:  https://ryxa.io/api/facebook-disconnect
// ===================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GRAPH = 'https://graph.facebook.com/v22.0';
const { decryptToken } = require('./lib/token-crypto');

async function verifySupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        apikey: SUPABASE_SERVICE_KEY
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.id ? data.id : null;
  } catch (e) {
    console.error('verifySupabaseUser failed:', e.message);
    return null;
  }
}

// Look up the user's Facebook tokens (user token is what revokes app access).
async function fetchUserToken(userId) {
  const url =
    SUPABASE_URL +
    '/rest/v1/facebook_connections?user_id=eq.' +
    encodeURIComponent(userId) +
    '&select=user_access_token,fb_page_id&limit=1';
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
    }
  });
  if (!res.ok) {
    console.error('Token lookup failed:', res.status);
    return null;
  }
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

// Revoke the app's permissions on Meta's side.
async function revokeMetaToken(userToken) {
  try {
    const res = await fetch(
      GRAPH + '/me/permissions?access_token=' + encodeURIComponent(userToken),
      { method: 'DELETE' }
    );
    if (!res.ok) {
      const err = await res.text();
      console.error('Meta revoke failed:', res.status, err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Meta revoke exception:', e.message);
    return false;
  }
}

async function deleteConnection(userId) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/facebook_connections?user_id=eq.' + encodeURIComponent(userId),
    {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        Prefer: 'return=representation'
      }
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
  if (require('./lib/rate-limit').tooMany(req, res, 'fb-disconnect', 10, 60000)) return;

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

  const conn = await fetchUserToken(userId);
  if (!conn) {
    return res.status(200).json({ ok: true, message: 'No connection to remove' });
  }

  let plainToken = null;
  try {
    plainToken = decryptToken(conn.user_access_token);
  } catch (e) {
    console.warn('Could not decrypt token for revoke; proceeding with local delete:', e.message);
  }
  const revoked = plainToken ? await revokeMetaToken(plainToken) : false;

  try {
    const deleted = await deleteConnection(userId);
    return res.status(200).json({
      ok: true,
      revoked_on_meta: revoked,
      deleted_rows: Array.isArray(deleted) ? deleted.length : 0
    });
  } catch (e) {
    console.error('DB delete failed:', e.message);
    return res.status(500).json({ error: 'Failed to delete connection' });
  }
};
