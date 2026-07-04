// Vercel serverless function - TikTok Data Fetch (creator-triggered)
// =====================================================================
// Triggered when a creator either:
//   1. Connects TikTok (fired once right after the OAuth callback succeeds)
//   2. Opens the Media Kit editor and cached data is missing or stale
//   3. Clicks the "Refresh from TikTok" button in the editor
//
// Authenticates the calling Ryxa user via their Supabase JWT, then calls the
// shared refreshTikTokData() helper (token refresh + profile + headline stats).
//
// Endpoint: POST https://ryxa.io/api/tiktok-data-fetch
// Headers:  Authorization: Bearer <supabase-jwt>
//
// Returns { ok: true, data: {...full row...} } on success
//         { ok: false, error: '...' } on failure
// =====================================================================

const { refreshTikTokData } = require('./_tiktok-fetch-helper.js');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

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
  // Per-IP rate limit: 10 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'tt-fetch', 10, 60000)) return;

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
    const result = await refreshTikTokData(userId);
    if (!result.ok) {
      if (result.error === 'Not connected to TikTok') {
        return res.status(404).json(result);
      }
      return res.status(500).json(result);
    }
    return res.status(200).json(result);
  } catch (e) {
    console.error('tiktok-data-fetch failed:', e.message);
    return res.status(500).json({ ok: false, error: 'Refresh failed' });
  }
};
