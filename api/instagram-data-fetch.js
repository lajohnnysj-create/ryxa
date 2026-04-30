// Vercel serverless function — Instagram Data Fetch (creator-triggered)
// =====================================================================
// Triggered when a creator either:
//   1. Opens the Media Kit editor and the cached data is missing or > 24h old
//   2. Clicks the "Refresh from Instagram" button in the editor
//
// Authenticates the calling Ryxa user via their Supabase JWT, then calls
// the shared refreshInstagramData() helper to do the actual work.
//
// Endpoint: POST https://ryxa.io/api/instagram-data-fetch
// Headers:  Authorization: Bearer <supabase-jwt>
//
// Returns { ok: true, data: {...full row...} } on success
//         { ok: false, error: '...' } on failure
// =====================================================================

const { refreshInstagramData } = require('./_instagram-fetch-helper.js');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

// Verify a Supabase access token and return the user_id, or null.
// Same pattern as instagram-oauth-start.js.
async function verifySupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Extract bearer token from Authorization header
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  const userId = await verifySupabaseUser(token);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  try {
    const result = await refreshInstagramData(userId);
    if (!result.ok) {
      // Distinguish "not connected" (404) from real errors (500)
      if (result.error === 'Not connected to Instagram') {
        return res.status(404).json(result);
      }
      return res.status(500).json(result);
    }
    return res.status(200).json(result);
  } catch (e) {
    console.error('instagram-data-fetch failed:', e.message);
    return res.status(500).json({ ok: false, error: 'Refresh failed' });
  }
};
