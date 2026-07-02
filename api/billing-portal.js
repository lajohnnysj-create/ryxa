// Vercel serverless function ,  Stripe Customer Billing Portal session
// =====================================================================
// Creates a Stripe Billing Portal session for the signed-in user so they can
// change their payment method, view invoices, switch plans, or cancel, all
// handled by Stripe (which keeps the ONE existing subscription in sync, with
// proration, rather than creating a duplicate).
//
// Method:  POST
// Headers: Authorization: Bearer <supabase-jwt>
// Body:    optional { "flow": "update" | "cancel" }  (deep-links the portal)
// Returns: { url }  ,  redirect the browser to this
//
// Requires the Customer Portal to be configured + activated in the Stripe
// Dashboard (Settings -> Billing -> Customer portal).
//
// Deploy to: /api/billing-portal.js
// =====================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const RETURN_URL = 'https://ryxa.io/dashboard.html';

async function verifySupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        apikey: SERVICE_KEY || ''
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
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!STRIPE_SECRET_KEY || !SERVICE_KEY) { res.status(500).json({ error: 'Server not configured' }); return; }

  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const userId = await verifySupabaseUser(token);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  try {
    // Customer id comes from the server-side subscription record, never the body.
    const subRes = await fetch(
      SUPABASE_URL + '/rest/v1/subscriptions?user_id=eq.' + encodeURIComponent(userId) +
        '&select=stripe_customer_id&limit=1',
      { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
    );
    if (!subRes.ok) { res.status(500).json({ error: 'Could not load subscription' }); return; }
    const rows = await subRes.json();
    const customerId = rows && rows[0] && rows[0].stripe_customer_id;
    if (!customerId) {
      // No Stripe customer means nothing to manage (e.g. a Free user). The
      // caller should send Free users to the pricing page + Checkout instead.
      res.status(400).json({ error: 'no_customer' });
      return;
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const flow = body && body.flow;

    const params = new URLSearchParams();
    params.set('customer', customerId);
    params.set('return_url', RETURN_URL);
    // Optional deep-link straight to the update or cancel screen.
    if (flow === 'update') {
      params.set('flow_data[type]', 'subscription_update');
    } else if (flow === 'cancel') {
      params.set('flow_data[type]', 'subscription_cancel');
    }

    const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    const portal = await portalRes.json();
    if (!portalRes.ok || !portal.url) {
      console.error('billing-portal: stripe error', portal && portal.error && portal.error.message);
      res.status(500).json({ error: 'portal_failed' });
      return;
    }
    res.status(200).json({ url: portal.url });
  } catch (e) {
    console.error('billing-portal error:', e.message);
    res.status(500).json({ error: 'server_error' });
  }
};
