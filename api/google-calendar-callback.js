// /api/google-calendar-callback.js
//
// Handles Google's redirect after the user grants/denies consent.
//
// Flow:
//   1. Verify the state cookie matches Google's state param (CSRF guard)
//   2. Exchange the auth code for access_token + refresh_token
//   3. Look up the connected Google account's email (userinfo endpoint)
//   4. Store tokens in google_calendar_connections via PostgREST + service role
//   5. Redirect the user back to the dashboard with a success/error flag

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI;

const DASHBOARD_URL = 'https://ryxa.io/dashboard.html';

function redirectWithFlag(res, flag, reason) {
  const url = new URL(DASHBOARD_URL);
  url.searchParams.set('gcal', flag);
  if (reason) url.searchParams.set('reason', reason);
  url.searchParams.set('view', 'calendar-settings');
  res.setHeader('Set-Cookie', 'ryxa_gcal_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return res.redirect(302, url.toString());
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error: googleError } = req.query;

  if (googleError) {
    return redirectWithFlag(res, 'cancelled', googleError);
  }

  if (!code || !state) {
    return redirectWithFlag(res, 'error', 'missing_params');
  }

  // CSRF check: cookie nonce must match nonce in state
  const cookieHeader = req.headers.cookie || '';
  const cookieMatch = cookieHeader.match(/ryxa_gcal_state=([^;]+)/);
  const cookieNonce = cookieMatch ? cookieMatch[1] : null;
  if (!cookieNonce) {
    return redirectWithFlag(res, 'error', 'state_missing');
  }

  let stateData;
  try {
    const decoded = Buffer.from(String(state), 'base64url').toString('utf8');
    stateData = JSON.parse(decoded);
  } catch (e) {
    return redirectWithFlag(res, 'error', 'state_invalid');
  }

  if (!stateData || stateData.n !== cookieNonce || !stateData.uid) {
    return redirectWithFlag(res, 'error', 'state_mismatch');
  }

  const userId = stateData.uid;

  // Exchange auth code for tokens
  let tokens;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Google token exchange failed:', tokenRes.status, errText);
      return redirectWithFlag(res, 'error', 'token_exchange_failed');
    }

    tokens = await tokenRes.json();
  } catch (e) {
    console.error('Token exchange error:', e);
    return redirectWithFlag(res, 'error', 'token_exchange_failed');
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    console.error('Missing tokens in Google response. Got keys:', Object.keys(tokens));
    return redirectWithFlag(res, 'error', 'incomplete_tokens');
  }

  // Get the email of the connected Google account (best-effort, non-fatal)
  let googleEmail = null;
  try {
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      googleEmail = profile.email || null;
    }
  } catch (e) {
    console.error('Userinfo fetch failed:', e);
  }

  // Upsert into google_calendar_connections via PostgREST + service role
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  const nowIso = new Date().toISOString();

  try {
    const upsertRes = await fetch(
      SUPABASE_URL + '/rest/v1/google_calendar_connections?on_conflict=user_id',
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          user_id: userId,
          google_email: googleEmail,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          scope: tokens.scope || 'https://www.googleapis.com/auth/calendar.app.created',
          expires_at: expiresAt,
          ryxa_calendar_id: null,
          connected_at: nowIso,
          updated_at: nowIso,
        }),
      }
    );

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error('Supabase upsert failed:', upsertRes.status, errText);
      return redirectWithFlag(res, 'error', 'db_write_failed');
    }
  } catch (e) {
    console.error('DB write error:', e);
    return redirectWithFlag(res, 'error', 'db_write_failed');
  }

  return redirectWithFlag(res, 'connected');
};
