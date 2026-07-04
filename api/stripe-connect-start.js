// Vercel serverless function
// Generates a signed OAuth state token for Stripe Connect
// Deploy to: /api/stripe-connect-start.js
//
// SECURITY: This endpoint requires Bearer token authentication. The user_id
// embedded in the signed state token comes from the verified Supabase session,
// NOT from the request body. This prevents an unauthenticated attacker from
// generating a state token signed with a victim's user_id and using it to
// hijack the victim's Stripe Connect account binding.

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_CONNECT_CLIENT_ID = 'ca_ULc7AzJR6nqlaSnY1d8TvXn6WeNcLWpL';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const REDIRECT_URI = 'https://ryxa.io/api/stripe-connect-callback';

function getSigningKey() {
  return crypto.createHash('sha256').update('ryxa_connect_' + STRIPE_SECRET_KEY).digest();
}

function generateState(userId) {
  const timestamp = Date.now();
  const payload = JSON.stringify({ uid: userId, ts: timestamp });
  const hmac = crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
  // Base64-encode the whole thing so it's URL-safe
  return Buffer.from(JSON.stringify({ p: payload, h: hmac })).toString('base64url');
}

// Verify a Supabase session token and return the user_id, or null on failure.
// Same pattern as google-calendar-ticket.js / instagram-ticket.js.
async function verifySupabaseUser(accessToken) {
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

module.exports = async function handler(req, res) {
  // Per-IP rate limit: 10 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'stripe-connect-start', 10, 60000)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }
  if (!SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Require Bearer token from the authenticated session.
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!accessToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Verify the token and extract the user_id from the SESSION, not from the body.
  // This is the entire point of the security fix — body.userId is untrusted
  // and could be set by an attacker to any victim's UUID.
  const userId = await verifySupabaseUser(accessToken);
  if (!userId) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const state = generateState(userId);

  const url = `https://connect.stripe.com/oauth/authorize`
    + `?response_type=code`
    + `&client_id=${STRIPE_CONNECT_CLIENT_ID}`
    + `&scope=read_write`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + `&state=${encodeURIComponent(state)}`;

  return res.status(200).json({ url });
};
