// Vercel serverless function — Subscription state verification (Stripe truth)
// =========================================================================
// Reads the calling user's subscription state DIRECTLY from Stripe, so the
// dashboard can confirm that a cancel or reactivate actually took effect rather
// than trusting the local DB or a bare 2xx from the cancel-subscription Edge
// Function. This closes the "UI says cancelled but Stripe is still active" gap.
//
// Endpoint: GET https://ryxa.io/api/subscription-verify
// Headers:  Authorization: Bearer <supabase-jwt>
//
// Returns one of:
//   { has_subscription: true,  cancel_at_period_end: bool, status: '...' }
//   { has_subscription: false, reason: 'no_local_sub_id' }
//   { has_subscription: false, reason: 'stripe_not_found', status: 'canceled' }
//
// The user is derived from the verified JWT. The Stripe subscription id is read
// server-side via the service role and is never accepted from the client.
// =========================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function verifySupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        apikey: SERVICE_KEY || '',
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
  // Per-IP rate limit: 20 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'subscription-verify', 20, 60000)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!STRIPE_SECRET_KEY || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const userId = await verifySupabaseUser(token);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Look up the user's Stripe subscription id (service role; never from client).
    const subRes = await fetch(
      SUPABASE_URL + '/rest/v1/subscriptions?user_id=eq.' + encodeURIComponent(userId) +
        '&select=stripe_subscription_id&limit=1',
      { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
    );
    if (!subRes.ok) return res.status(500).json({ error: 'Could not load subscription' });
    const rows = await subRes.json();
    const subId = rows && rows[0] && rows[0].stripe_subscription_id;
    if (!subId) {
      return res.status(200).json({ has_subscription: false, reason: 'no_local_sub_id' });
    }

    // Ask Stripe directly. Bearer auth with the secret key is supported.
    const stripeRes = await fetch(
      'https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(subId),
      { headers: { Authorization: 'Bearer ' + STRIPE_SECRET_KEY } }
    );
    const sub = await stripeRes.json().catch(() => null);

    if (!stripeRes.ok) {
      // A 404 means the subscription was fully canceled/deleted (immediate
      // cancel), which still satisfies a cancel intent.
      const code = sub && sub.error && sub.error.code;
      if (stripeRes.status === 404 || code === 'resource_missing') {
        return res.status(200).json({ has_subscription: false, reason: 'stripe_not_found', status: 'canceled' });
      }
      console.error('Stripe subscription retrieve failed:', stripeRes.status, code || '');
      return res.status(502).json({ error: 'Stripe lookup failed' });
    }

    return res.status(200).json({
      has_subscription: true,
      cancel_at_period_end: sub && sub.cancel_at_period_end === true,
      status: (sub && sub.status) || null,
    });
  } catch (e) {
    console.error('subscription-verify failed:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
