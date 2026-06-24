// Vercel serverless function - YouTube Data Fetch (creator-triggered)
// =====================================================================
// Triggered when a creator either:
//   1. Connects YouTube (fired once right after the OAuth callback succeeds)
//   2. Opens the Media Kit editor and cached data is missing or stale
//   3. Clicks the "Refresh from YouTube" button in the editor
//
// Authenticates the calling Ryxa user via their Supabase JWT, then calls the
// shared refreshYouTubeData() helper to do the actual work (token refresh +
// channel stats + 30-day analytics + demographics + recent uploads).
//
// Endpoint: POST https://ryxa.io/api/youtube-data-fetch
// Headers:  Authorization: Bearer <supabase-jwt>
//
// Returns { ok: true, data: {...full row...} } on success
//         { ok: false, error: '...' } on failure
// =====================================================================

const { refreshYouTubeData } = require('./_youtube-fetch-helper.js');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

// Verify a Supabase access token and return the user_id, or null.
async function verifySupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  const userId = await verifySupabaseUser(token);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  try {
    const result = await refreshYouTubeData(userId);
    if (!result.ok) {
      // Distinguish "not connected" (404) from real errors (500)
      if (result.error === 'Not connected to YouTube') {
        return res.status(404).json(result);
      }
      return res.status(500).json(result);
    }
    return res.status(200).json(result);
  } catch (e) {
    console.error('youtube-data-fetch failed:', e.message);
    return res.status(500).json({ ok: false, error: 'Refresh failed' });
  }
};
