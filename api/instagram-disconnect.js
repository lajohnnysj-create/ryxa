// Vercel serverless function — Instagram Disconnect
// ===================================================
// Disconnects a user's Instagram account from Ryxa:
//   1. Verifies the calling user is authenticated
//   2. Revokes the access token on Meta's side
//   3. Deletes the connection row from our database
//
// Failure on the Meta side does NOT block local deletion —
// the user's intent to disconnect is honored either way.
//
// Deploy to: /api/instagram-disconnect.js
// Endpoint URL: https://ryxa.io/api/instagram-disconnect
// ===================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ----- helpers --------------------------------------------------

// Verify a Supabase JWT and return the user_id, or null
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

// Look up the user's IG access token from the database
async function fetchUserToken(userId) {
  const url =
    SUPABASE_URL +
    '/rest/v1/instagram_connections?user_id=eq.' +
    encodeURIComponent(userId) +
    '&select=access_token,ig_user_id&limit=1';

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

// Revoke the token on Meta's side
async function revokeMetaToken(accessToken) {
  // Meta's permissions deletion endpoint
  // Reference: https://developers.facebook.com/docs/graph-api/reference/user/permissions/
  try {
    const res = await fetch(
      'https://graph.instagram.com/v22.0/me/permissions?access_token=' +
        encodeURIComponent(accessToken),
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

// Delete the connection row from our database
async function deleteConnection(userId) {
  const res = await fetch(
    SUPABASE_URL +
      '/rest/v1/instagram_connections?user_id=eq.' +
      encodeURIComponent(userId),
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

// ----- main handler --------------------------------------------

module.exports = async function handler(req, res) {
  // CORS for in-app fetch from dashboard
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

  // Authenticate via Authorization: Bearer <jwt>
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  const userId = await verifySupabaseUser(accessToken);

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Look up the connection (to get the IG token to revoke)
  const conn = await fetchUserToken(userId);

  // If no connection exists, just return success — nothing to do
  if (!conn) {
    return res.status(200).json({ ok: true, message: 'No connection to remove' });
  }

  // Try to revoke on Meta's side (non-fatal if it fails)
  const revoked = await revokeMetaToken(conn.access_token);

  // Delete from our database (this is the part that MUST succeed)
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
