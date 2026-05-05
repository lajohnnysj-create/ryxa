// /api/google-calendar-start.js
//
// Initiates the Google Calendar OAuth flow.
// Called when a logged-in Ryxa user clicks "Connect Google Calendar".
//
// Flow:
//   1. Verify the caller is an authenticated Ryxa user (via Supabase access token in ?t=)
//   2. Generate a CSRF state token bound to the user_id, store nonce in httpOnly cookie
//   3. Redirect the browser to Google's OAuth consent screen
//
// Phase 1 only: just establishes the connection. No event sync yet.

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI;

// Non-sensitive scope: only calendars Ryxa creates
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

async function verifySupabaseUser(accessToken) {
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        apikey: SUPABASE_SERVICE_KEY
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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI || !SUPABASE_SERVICE_KEY) {
    console.error('Missing OAuth env vars');
    return res.status(500).send('OAuth not configured');
  }

  // Pull access token from query param (dashboard navigates here directly,
  // not via fetch — can't use Authorization headers across browser redirects).
  // Token is short-lived (1h) and sits in this URL for one redirect hop only.
  const supabaseAccessToken = req.query && req.query.t ? String(req.query.t) : null;

  if (!supabaseAccessToken) {
    return res.status(401).send('Missing session token. Please return to the dashboard and try again.');
  }

  const userId = await verifySupabaseUser(supabaseAccessToken);
  if (!userId) {
    return res.status(401).send('Invalid or expired session. Please refresh and try again.');
  }

  // CSRF state: random nonce in httpOnly cookie + sent to Google in state param
  const stateNonce = crypto.randomBytes(24).toString('base64url');
  const statePayload = JSON.stringify({ uid: userId, n: stateNonce });
  const stateB64 = Buffer.from(statePayload).toString('base64url');

  res.setHeader(
    'Set-Cookie',
    'ryxa_gcal_state=' + stateNonce + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'
  );

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',     // request refresh token
    prompt: 'consent',          // force consent so refresh_token always returned
    include_granted_scopes: 'true',
    state: stateB64,
  });

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
  return res.redirect(302, authUrl);
};
