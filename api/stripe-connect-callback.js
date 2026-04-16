// Vercel serverless function
// Handles Stripe Connect OAuth callback with signed state verification
// Deploy to: /api/stripe-connect-callback.js

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

function getSigningKey() {
  return crypto.createHash('sha256').update('ryxa_connect_' + STRIPE_SECRET_KEY).digest();
}

function verifyState(rawState) {
  try {
    // Decode base64url
    const decoded = Buffer.from(rawState, 'base64url').toString('utf8');
    const { p: payload, h: hmac } = JSON.parse(decoded);

    if (!payload || !hmac) {
      console.error('State missing payload or hmac');
      return null;
    }

    // Verify HMAC
    const expectedHmac = crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
    if (hmac.length !== expectedHmac.length) {
      console.error('HMAC length mismatch');
      return null;
    }
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
      console.error('HMAC signature mismatch');
      return null;
    }

    // Parse payload
    const { uid, ts } = JSON.parse(payload);

    // Check expiry (10 minutes)
    const age = Date.now() - ts;
    if (isNaN(age) || age < 0 || age > 10 * 60 * 1000) {
      console.error('State expired, age:', age);
      return null;
    }

    // Validate UUID
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(uid)) {
      console.error('Invalid UUID in state:', uid);
      return null;
    }

    return uid;
  } catch (e) {
    console.error('State verification error:', e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  const { code, state, error, error_description } = req.query;

  // If Stripe returned an error (user cancelled, etc.)
  if (error) {
    const reason = encodeURIComponent(error_description || error || 'Authorization cancelled');
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${reason}`);
  }

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
  const userId = verifyState(state);
  if (!userId) {
    console.error('State verification failed for state:', state?.substring(0, 20) + '...');
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
    return res.redirect(302, `/dashboard.html?stripe_connect=success`);

  } catch (err) {
    console.error('Stripe Connect callback error:', err);
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Server error — please try again')}`);
  }
};
