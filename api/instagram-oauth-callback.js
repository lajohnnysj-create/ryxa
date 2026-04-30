// Vercel serverless function — Instagram OAuth Callback
// =======================================================
// Receives Meta's redirect after the user approves Instagram access.
// Verifies state, exchanges code for token, fetches profile,
// stores the connection, redirects to dashboard.
//
// Deploy to: /api/instagram-oauth-callback.js
// Endpoint URL: https://ryxa.io/api/instagram-oauth-callback
//   (Must match the URL registered in Meta App Dashboard exactly)
// =======================================================

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const PUBLIC_BASE_URL = 'https://ryxa.io';
const REDIRECT_URI = PUBLIC_BASE_URL + '/api/instagram-oauth-callback';
const DASHBOARD_URL = PUBLIC_BASE_URL + '/dashboard';

// State token TTL — reject states older than 10 minutes
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// ----- helpers --------------------------------------------------

function getSigningKey() {
  return crypto.createHash('sha256').update('ryxa_ig_oauth_' + META_APP_SECRET).digest();
}

// Verify the signed state from the OAuth start endpoint.
// Returns the decoded payload or null.
function verifyState(stateRaw) {
  if (!stateRaw) return null;
  try {
    const wrapped = Buffer.from(stateRaw, 'base64url').toString('utf8');
    const { p: payloadStr, h: receivedHmac } = JSON.parse(wrapped);
    if (!payloadStr || !receivedHmac) return null;

    const expectedHmac = crypto
      .createHmac('sha256', getSigningKey())
      .update(payloadStr)
      .digest('hex');

    if (
      receivedHmac.length !== expectedHmac.length ||
      !crypto.timingSafeEqual(
        Buffer.from(receivedHmac, 'hex'),
        Buffer.from(expectedHmac, 'hex')
      )
    ) {
      console.error('State HMAC mismatch');
      return null;
    }

    const payload = JSON.parse(payloadStr);
    if (!payload || !payload.uid || !payload.t) return null;

    // Reject expired state tokens
    const age = Date.now() - Number(payload.t);
    if (age > STATE_MAX_AGE_MS) {
      console.error('State expired, age:', age);
      return null;
    }

    return payload;
  } catch (e) {
    console.error('verifyState failed:', e.message);
    return null;
  }
}

// Redirect helper — sends user back to dashboard with status
function redirectToDashboard(res, status, message) {
  const params = new URLSearchParams({
    instagram_status: status,
    ...(message ? { instagram_message: message } : {})
  });
  res.writeHead(302, { Location: DASHBOARD_URL + '?' + params.toString() });
  return res.end();
}

// Exchange the short-lived auth code for a short-lived access token
async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    code: code
  });

  const res = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Token exchange failed: ' + res.status + ' ' + err);
  }
  return res.json();
  // Returns: { access_token: "...", user_id: 12345, permissions: ["..."] }
}

// Exchange short-lived token (~1 hour) for a long-lived token (~60 days)
async function getLongLivedToken(shortLivedToken) {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: META_APP_SECRET,
    access_token: shortLivedToken
  });

  const res = await fetch(
    'https://graph.instagram.com/access_token?' + params.toString()
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Long-lived token exchange failed: ' + res.status + ' ' + err);
  }
  return res.json();
  // Returns: { access_token: "...", token_type: "bearer", expires_in: 5184000 }
}

// Fetch user's Instagram profile (username, account_type, profile_picture_url)
async function fetchProfile(accessToken) {
  const fields = 'id,username,account_type,profile_picture_url,name';
  const res = await fetch(
    'https://graph.instagram.com/v22.0/me?fields=' +
      encodeURIComponent(fields) +
      '&access_token=' +
      encodeURIComponent(accessToken)
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Profile fetch failed: ' + res.status + ' ' + err);
  }
  return res.json();
}

// Upsert the connection row (one row per Ryxa user, primary key user_id)
async function saveConnection(userId, payload) {
  const body = JSON.stringify({
    user_id: userId,
    ig_user_id: String(payload.ig_user_id),
    ig_username: payload.ig_username,
    access_token: payload.access_token,
    scopes: payload.scopes,
    account_type: payload.account_type,
    profile_picture_url: payload.profile_picture_url,
    connected_at: new Date().toISOString(),
    token_expires_at: payload.token_expires_at,
    last_refreshed_at: new Date().toISOString()
  });

  const res = await fetch(
    SUPABASE_URL + '/rest/v1/instagram_connections?on_conflict=user_id',
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=merge-duplicates'
      },
      body: body
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Save connection failed: ' + res.status + ' ' + err);
  }
  return res.json();
}

// ----- main handler --------------------------------------------

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!META_APP_ID || !META_APP_SECRET || !SUPABASE_SERVICE_KEY) {
    console.error('Missing required env vars');
    return redirectToDashboard(res, 'error', 'Server not configured');
  }

  const { code, state, error, error_description, error_reason } = req.query || {};

  // ---- User denied / Meta returned an error ----
  if (error) {
    console.log('OAuth error from Meta:', error, error_reason, error_description);
    if (error === 'access_denied' || error_reason === 'user_denied') {
      return redirectToDashboard(res, 'cancelled');
    }
    return redirectToDashboard(res, 'error', String(error_description || error));
  }

  // ---- Verify state ----
  const statePayload = verifyState(state);
  if (!statePayload) {
    return redirectToDashboard(res, 'error', 'Invalid or expired session');
  }
  const userId = statePayload.uid;

  if (!code) {
    return redirectToDashboard(res, 'error', 'Missing authorization code');
  }

  // ---- Exchange code → short-lived token ----
  let shortLived;
  try {
    shortLived = await exchangeCodeForToken(String(code));
  } catch (e) {
    console.error('Code exchange failed:', e.message);
    return redirectToDashboard(res, 'error', 'Token exchange failed');
  }

  if (!shortLived || !shortLived.access_token || !shortLived.user_id) {
    console.error('Unexpected token response:', shortLived);
    return redirectToDashboard(res, 'error', 'Invalid token response');
  }

  // ---- Exchange short-lived → long-lived token ----
  let longLived;
  try {
    longLived = await getLongLivedToken(shortLived.access_token);
  } catch (e) {
    console.error('Long-lived exchange failed:', e.message);
    return redirectToDashboard(res, 'error', 'Could not extend token');
  }

  if (!longLived || !longLived.access_token) {
    console.error('Unexpected long-lived response:', longLived);
    return redirectToDashboard(res, 'error', 'Invalid long-lived token');
  }

  const expiresIn = Number(longLived.expires_in) || 60 * 24 * 60 * 60; // 60 days default
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // ---- Fetch profile data ----
  let profile;
  try {
    profile = await fetchProfile(longLived.access_token);
  } catch (e) {
    console.error('Profile fetch failed:', e.message);
    // Non-fatal — we can save without it and let the dashboard handle missing fields
    profile = {};
  }

  // ---- Save the connection ----
  try {
    await saveConnection(userId, {
      ig_user_id: shortLived.user_id,
      ig_username: profile.username || null,
      access_token: longLived.access_token,
      scopes: shortLived.permissions || [],
      account_type: profile.account_type || null,
      profile_picture_url: profile.profile_picture_url || null,
      token_expires_at: expiresAt
    });
  } catch (e) {
    console.error('Save failed:', e.message);
    return redirectToDashboard(res, 'error', 'Could not save connection');
  }

  // ---- Success ----
  return redirectToDashboard(res, 'connected');
};
