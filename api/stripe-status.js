// Vercel serverless function — Stripe Connect Status Check
// =========================================================
// Returns whether the calling user has a connected Stripe account.
// Used by the dashboard to gate publishing of paid services/courses
// without exposing stripe_account_id to authenticated users via
// PostgREST direct table access.
//
// Endpoint: GET https://ryxa.io/api/stripe-status
// Headers:  Authorization: Bearer <supabase-jwt>
//
// Returns { connected: true|false }
// =========================================================

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
  // Per-IP rate limit: 30 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'stripe-status', 30, 60000)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  const userId = await verifySupabaseUser(token);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const profileRes = await fetch(
      SUPABASE_URL + '/rest/v1/profiles?user_id=eq.' + encodeURIComponent(userId) + '&select=stripe_account_id&limit=1',
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
        }
      }
    );

    if (!profileRes.ok) {
      return res.status(500).json({ error: 'Could not fetch profile' });
    }

    const profiles = await profileRes.json();
    const stripeId = (profiles && profiles[0] && profiles[0].stripe_account_id) || null;
    const connected = !!stripeId;
    // Return a masked version for display (e.g., "acct_123••••abcd")
    const masked = stripeId
      ? (stripeId.substring(0, 8) + '••••' + stripeId.substring(stripeId.length - 4))
      : null;
    return res.status(200).json({ connected, masked_id: masked });
  } catch (e) {
    console.error('stripe-status failed:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
