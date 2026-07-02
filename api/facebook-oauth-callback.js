// Vercel serverless function - Facebook OAuth Callback
// =======================================================
// Receives Facebook's redirect after the user approves Page access.
// Verifies state, exchanges code for a user token, extends it to long-lived,
// lists the user's Pages, selects one, stores the encrypted connection, and
// redirects to the dashboard.
//
// Mirrors instagram-oauth-callback.js but on the Facebook-Login flow. Page
// tokens derived from a long-lived user token are themselves long-lived, so
// page_access_token is what we use for Graph calls and user_access_token is
// what we refresh from.
//
// Deploy to: /api/facebook-oauth-callback.js
// Endpoint:  https://ryxa.io/api/facebook-oauth-callback
//   (Must match the redirect URI registered in the Meta App Dashboard exactly)
// =======================================================

const crypto = require('crypto');
const { encryptToken } = require('./lib/token-crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const PUBLIC_BASE_URL = 'https://ryxa.io';
const REDIRECT_URI = PUBLIC_BASE_URL + '/api/facebook-oauth-callback';
const DASHBOARD_URL = PUBLIC_BASE_URL + '/dashboard';
const GRAPH = 'https://graph.facebook.com/v22.0';

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// ----- state verification --------------------------------------

function getSigningKey() {
  return crypto.createHash('sha256').update('ryxa_fb_oauth_' + FACEBOOK_APP_SECRET).digest();
}

function verifyState(stateRaw) {
  if (!stateRaw) return null;
  try {
    const wrapped = Buffer.from(stateRaw, 'base64url').toString('utf8');
    const { p: payloadStr, h: receivedHmac } = JSON.parse(wrapped);
    if (!payloadStr || !receivedHmac) return null;
    const expectedHmac = crypto.createHmac('sha256', getSigningKey()).update(payloadStr).digest('hex');
    if (
      receivedHmac.length !== expectedHmac.length ||
      !crypto.timingSafeEqual(Buffer.from(receivedHmac, 'hex'), Buffer.from(expectedHmac, 'hex'))
    ) {
      console.error('State HMAC mismatch');
      return null;
    }
    const payload = JSON.parse(payloadStr);
    if (!payload || !payload.uid || !payload.t) return null;
    if (Date.now() - Number(payload.t) > STATE_MAX_AGE_MS) {
      console.error('State expired');
      return null;
    }
    return payload;
  } catch (e) {
    console.error('verifyState failed:', e.message);
    return null;
  }
}

function redirectToDashboard(res, status, message) {
  const params = new URLSearchParams({
    facebook_status: status,
    ...(message ? { facebook_message: message } : {})
  });
  res.writeHead(302, { Location: DASHBOARD_URL + '?' + params.toString() });
  return res.end();
}

// ----- Graph calls ---------------------------------------------

// Exchange the auth code for a short-lived USER access token.
async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id: FACEBOOK_APP_ID,
    client_secret: FACEBOOK_APP_SECRET,
    redirect_uri: REDIRECT_URI,
    code: code
  });
  const res = await fetch(GRAPH + '/oauth/access_token?' + params.toString());
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Token exchange failed: ' + res.status + ' ' + err);
  }
  return res.json(); // { access_token, token_type, expires_in }
}

// Exchange short-lived user token for a long-lived one (~60 days).
async function getLongLivedToken(shortLivedToken) {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: FACEBOOK_APP_ID,
    client_secret: FACEBOOK_APP_SECRET,
    fb_exchange_token: shortLivedToken
  });
  const res = await fetch(GRAPH + '/oauth/access_token?' + params.toString());
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Long-lived token exchange failed: ' + res.status + ' ' + err);
  }
  return res.json(); // { access_token, token_type, expires_in }
}

// Fetch the Facebook user id (for our records + the deletion webhook match).
async function fetchUserId(userToken) {
  const res = await fetch(GRAPH + '/me?fields=id&access_token=' + encodeURIComponent(userToken));
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.id ? String(data.id) : null;
}

// List the Pages the user administers, with per-Page tokens + basic fields.
async function fetchPages(userToken) {
  const fields = 'id,name,access_token,followers_count,fan_count,picture{url}';
  const res = await fetch(
    GRAPH + '/me/accounts?fields=' + encodeURIComponent(fields) +
    '&limit=100&access_token=' + encodeURIComponent(userToken)
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Pages fetch failed: ' + res.status + ' ' + err);
  }
  const data = await res.json();
  const list = Array.isArray(data.data) ? data.data : [];
  // Safe diagnostic: log the page COUNT and any API error only. Never log
  // `data` itself, each page entry contains an access_token.
  console.log('facebook me/accounts: pages=' + list.length + (data.error ? ' error=' + JSON.stringify(data.error) : ''));
  return list;
}

// Upsert the connection row (one per Ryxa user, PK user_id).
async function saveConnection(userId, payload) {
  const body = JSON.stringify({
    user_id: userId,
    fb_user_id: payload.fb_user_id,
    fb_page_id: payload.fb_page_id,
    fb_page_name: payload.fb_page_name,
    user_access_token: payload.user_access_token,
    page_access_token: payload.page_access_token,
    scopes: payload.scopes,
    followers_count: payload.followers_count,
    fan_count: payload.fan_count,
    profile_picture_url: payload.profile_picture_url,
    connected_at: new Date().toISOString(),
    token_expires_at: payload.token_expires_at,
    last_refreshed_at: new Date().toISOString()
  });
  const res = await fetch(SUPABASE_URL + '/rest/v1/facebook_connections?on_conflict=user_id', {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates'
    },
    body: body
  });
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
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET || !SUPABASE_SERVICE_KEY) {
    console.error('Missing required env vars');
    return redirectToDashboard(res, 'error', 'Server not configured');
  }

  const { code, state, error, error_description, error_reason } = req.query || {};

  if (error) {
    console.log('OAuth error from Meta:', error, error_reason, error_description);
    if (error === 'access_denied' || error_reason === 'user_denied') {
      return redirectToDashboard(res, 'cancelled');
    }
    return redirectToDashboard(res, 'error', String(error_description || error));
  }

  const statePayload = verifyState(state);
  if (!statePayload) {
    return redirectToDashboard(res, 'error', 'Invalid or expired session');
  }
  const userId = statePayload.uid;

  if (!code) {
    return redirectToDashboard(res, 'error', 'Missing authorization code');
  }

  // code -> short-lived user token
  let shortLived;
  try {
    shortLived = await exchangeCodeForToken(String(code));
  } catch (e) {
    console.error('Code exchange failed:', e.message);
    return redirectToDashboard(res, 'error', 'Token exchange failed');
  }
  if (!shortLived || !shortLived.access_token) {
    return redirectToDashboard(res, 'error', 'Invalid token response');
  }

  // short-lived -> long-lived user token
  let longLived;
  try {
    longLived = await getLongLivedToken(shortLived.access_token);
  } catch (e) {
    console.error('Long-lived exchange failed:', e.message);
    return redirectToDashboard(res, 'error', 'Could not extend token');
  }
  if (!longLived || !longLived.access_token) {
    return redirectToDashboard(res, 'error', 'Invalid long-lived token');
  }
  const userToken = longLived.access_token;
  const expiresIn = Number(longLived.expires_in) || 60 * 24 * 60 * 60;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // fetch the fb user id + the user's Pages
  const fbUserId = await fetchUserId(userToken);

  let pages;
  try {
    pages = await fetchPages(userToken);
  } catch (e) {
    console.error('Pages fetch failed:', e.message);
    return redirectToDashboard(res, 'error', 'Could not read your Pages');
  }

  if (!pages.length) {
    // Authorized but administers no Page (or granted none).
    return redirectToDashboard(res, 'no_page');
  }

  const encUserToken = encryptToken(userToken);
  const baseScopes = ['pages_show_list', 'pages_read_engagement', 'read_insights'];

  // Exactly one Page: nothing to choose, save it fully.
  if (pages.length === 1) {
    const page = pages[0];
    if (!page.access_token) return redirectToDashboard(res, 'no_page');
    try {
      await saveConnection(userId, {
        fb_user_id: fbUserId,
        fb_page_id: String(page.id),
        fb_page_name: page.name || null,
        user_access_token: encUserToken,
        page_access_token: encryptToken(page.access_token),
        scopes: baseScopes,
        followers_count: Number(page.followers_count) || null,
        fan_count: Number(page.fan_count) || null,
        profile_picture_url: (page.picture && page.picture.data && page.picture.data.url) || null,
        token_expires_at: expiresAt
      });
    } catch (e) {
      console.error('Save failed:', e.message);
      return redirectToDashboard(res, 'error', 'Could not save connection');
    }
    return redirectToDashboard(res, 'connected');
  }

  // Multiple Pages: store a PENDING connection (user token only) and let the
  // user pick which Page on the dashboard. The chosen Page's token is fetched
  // server-side in facebook-select-page, so page tokens never touch the client.
  try {
    await saveConnection(userId, {
      fb_user_id: fbUserId,
      fb_page_id: null,
      fb_page_name: null,
      user_access_token: encUserToken,
      page_access_token: null,
      scopes: baseScopes,
      followers_count: null,
      fan_count: null,
      profile_picture_url: null,
      token_expires_at: expiresAt
    });
  } catch (e) {
    console.error('Save pending failed:', e.message);
    return redirectToDashboard(res, 'error', 'Could not save connection');
  }
  return redirectToDashboard(res, 'pick_page');
};
