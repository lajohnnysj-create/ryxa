// Vercel serverless function
// Generates a signed OAuth state token for Stripe Connect
// Deploy to: /api/stripe-connect-start.js
//
// The frontend calls this endpoint to get a secure OAuth URL.
// The state param is an HMAC-signed token containing the user ID + timestamp,
// preventing an attacker from forging the callback with someone else's user ID.

const crypto = require('crypto');

const STRIPE_CONNECT_CLIENT_ID = 'ca_ULc7AzJR6nqlaSnY1d8TvXn6WeNcLWpL';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const REDIRECT_URI = 'https://ryxa.io/api/stripe-connect-callback';

// HMAC signing key derived from Stripe secret (never exposed to client)
function getSigningKey() {
  return crypto.createHash('sha256').update('ryxa_connect_' + STRIPE_SECRET_KEY).digest();
}

function generateState(userId) {
  const timestamp = Date.now();
  const payload = `${userId}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
  // Format: userId:timestamp:signature
  return `${payload}:${hmac}`;
}

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { userId } = req.body || {};

  // Validate userId is a UUID
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!userId || !UUID_REGEX.test(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
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
