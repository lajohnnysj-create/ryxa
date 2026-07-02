// Vercel serverless function - Facebook Data Fetch (creator-triggered)
// =====================================================================
// Triggered when a creator opens the Media Kit (stale/missing cache) or
// clicks "Refresh from Facebook". Authenticates the Ryxa user via their
// Supabase JWT, then calls the shared refreshFacebookData() helper.
//
// Endpoint: POST https://ryxa.io/api/facebook-data-fetch
// Header:   Authorization: Bearer <supabase-jwt>
// Returns { ok: true, data: {...} } | { ok: false, error: '...' }
// =====================================================================

const { refreshFacebookData } = require('./_facebook-fetch-helper.js');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

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
  res.setHeader('Access-Control-Allow-Origin', 'https://ryxa.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const userId = await verifySupabaseUser(token);
  if (!userId) return res.status(401).json({ ok: false, error: 'Not authenticated' });

  try {
    const result = await refreshFacebookData(userId);
    if (!result.ok) {
      if (result.error === 'Not connected to Facebook' || result.error === 'No Page selected yet') {
        return res.status(404).json(result);
      }
      return res.status(500).json(result);
    }
    return res.status(200).json(result);
  } catch (e) {
    console.error('facebook-data-fetch failed:', e.message);
    return res.status(500).json({ ok: false, error: 'Refresh failed' });
  }
};
