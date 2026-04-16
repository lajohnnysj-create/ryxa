// Vercel serverless function
// Handles Stripe Connect OAuth callback with signed state verification
// Deploy to: /api/stripe-connect-callback.js
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY - Your platform's Stripe secret key (sk_live_...)
//   SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
//
// Flow:
// 1. /api/stripe-connect-start generates a signed state token (userId:timestamp:hmac)
// 2. Creator authorizes on Stripe → Stripe redirects here with ?code=xxx&state=signed_token
// 3. This function verifies the HMAC signature to confirm the state wasn't tampered with
// 4. Exchanges the code for a stripe_account_id via Stripe API
// 5. Stores it in the profiles table via Supabase
// 6. Redirects back to dashboard.html?stripe_connect=success

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

// Must match the signing key in stripe-connect-start.js
function getSigningKey() {
  return crypto.createHash('sha256').update('ryxa_connect_' + STRIPE_SECRET_KEY).digest();
}

function verifyState(state) {
  // State format: userId:timestamp:hmac
  const parts = state.split(':');
  if (parts.length < 3) return null;

  const hmac = parts.pop();
  const payload = parts.join(':'); // userId:timestamp (userId itself contains hyphens)

  // Re-split to extract userId and timestamp
  const lastColon = payload.lastIndexOf(':');
  if (lastColon === -1) return null;

  const userId = payload.substring(0, lastColon);
  const timestamp = parseInt(payload.substring(lastColon + 1), 10);

  // Verify HMAC
  const expectedHmac = crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
      return null; // Signature mismatch — tampered
    }
  } catch (e) {
    return null; // Buffer length mismatch or invalid hex
  }

  // Check expiry (10 minutes max)
  const age = Date.now() - timestamp;
  if (isNaN(age) || age < 0 || age > 10 * 60 * 1000) {
    return null; // Expired or future timestamp
  }

  // Validate userId is a UUID
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(userId)) {
    return null;
  }

  return userId;
}

module.exports = async function handler(req, res) {
  const { code, state, error, error_description } = req.query;

  // If Stripe returned an error (user cancelled, etc.)
  if (error) {
    const reason = encodeURIComponent(error_description || error || 'Authorization cancelled');
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${reason}`);
  }

  // Validate we have what we need
  if (!code || !state) {
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Missing authorization code')}`);
  }

  if (!STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY not configured');
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Server configuration error')}`);
  }

  if (!SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY not configured');
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Server configuration error')}`);
  }

  // Verify the signed state token
  const userId = verifyState(decodeURIComponent(state));
  if (!userId) {
    console.error('Invalid or expired state token');
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Session expired or invalid. Please try again.')}`);
  }

  try {
    // Exchange the authorization code for a Stripe account ID
    const tokenResponse = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_secret: STRIPE_SECRET_KEY,
      }).toString(),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('Stripe OAuth error:', tokenData.error, tokenData.error_description);
      const reason = encodeURIComponent(tokenData.error_description || tokenData.error);
      return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${reason}`);
    }

    const stripeAccountId = tokenData.stripe_user_id;
    if (!stripeAccountId) {
      console.error('No stripe_user_id in response:', tokenData);
      return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('No account ID returned')}`);
    }

    // Store the stripe_account_id in the profiles table
    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ stripe_account_id: stripeAccountId }),
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Supabase update failed:', updateResponse.status, errorText);
      return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Failed to save account')}`);
    }

    console.log(`Stripe Connect: user ${userId} connected account ${stripeAccountId}`);

    // Success — redirect back to dashboard
    return res.redirect(302, `/dashboard.html?stripe_connect=success`);

  } catch (err) {
    console.error('Stripe Connect callback error:', err);
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Server error — please try again')}`);
  }
};
