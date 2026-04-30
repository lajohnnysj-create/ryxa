// Vercel serverless function — Instagram OAuth Start
// ====================================================
// Kicks off the Instagram OAuth flow. Authenticates the calling
// Ryxa user, generates a signed state token, and redirects to
// Meta's authorization page.
//
// Deploy to: /api/instagram-oauth-start.js
// Endpoint URL: https://ryxa.io/api/instagram-oauth-start
// ====================================================

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const PUBLIC_BASE_URL = 'https://ryxa.io';
const REDIRECT_URI = PUBLIC_BASE_URL + '/api/instagram-oauth-callback';

// Stage 1 scopes — basic profile + insights for media kit auto-fill
// Stage 2 will add 'instagram_business_manage_messages' for Auto DM
const STAGE_1_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_insights'
];

// ----- helpers --------------------------------------------------

function getSigningKey() {
  // Distinct key from other HMAC uses to prevent cross-feature signature reuse
  return crypto.createHash('sha256').update('ryxa_ig_oauth_' + META_APP_SECRET).digest();
}

// Sign a state payload so the callback can verify it came from us.
// Format: base64url(JSON({p: payload, h: hmac}))
function signState(payload) {
  const payloadStr = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', getSigningKey()).update(payloadStr).digest('hex');
  const wrapped = JSON.stringify({ p: payloadStr, h: hmac });
  return Buffer.from(wrapped, 'utf8').toString('base64url');
}

// Verify a Supabase access token and return the user_id, or null
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

// ----- main handler --------------------------------------------

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!META_APP_ID || !META_APP_SECRET) {
    console.error('Missing META_APP_ID or META_APP_SECRET');
    return res.status(500).json({ error: 'Server not configured' });
  }

  // Authenticate the calling user via their Supabase JWT
  // Frontend should pass it as ?token=xxx in the redirect URL
  const accessToken = (req.query && req.query.token) || '';
  const userId = await verifySupabaseUser(accessToken);

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Generate state token: Ryxa user_id + random nonce + timestamp
  const state = signState({
    uid: userId,
    n: crypto.randomBytes(8).toString('hex'),
    t: Date.now()
  });

  // Build the Meta OAuth URL
  // Reference: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: STAGE_1_SCOPES.join(','),
    state: state
  });

  const authUrl = 'https://www.instagram.com/oauth/authorize?' + params.toString();

  // Redirect the user to Meta
  res.writeHead(302, { Location: authUrl });
  return res.end();
};
