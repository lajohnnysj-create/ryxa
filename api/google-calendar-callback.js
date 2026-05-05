// /api/google-calendar-callback.js
//
// Handles Google's redirect after the user grants/denies consent.
//
// Flow:
//   1. Verify the state cookie matches Google's state param (CSRF guard)
//   2. Exchange the auth code for access_token + refresh_token
//   3. Look up the connected Google account's email (using userinfo endpoint)
//   4. Store tokens in google_calendar_connections (service role write)
//   5. Redirect the user back to the dashboard with a success/error flag
//
// On error, redirects with ?gcal=error&reason=... so the dashboard can
// surface a friendly message.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI;

const DASHBOARD_URL = 'https://ryxa.io/dashboard.html';

function redirectWithFlag(res, flag, reason) {
  const url = new URL(DASHBOARD_URL);
  url.searchParams.set('gcal', flag);
  if (reason) url.searchParams.set('reason', reason);
  // Tell dashboard to open Calendar Settings modal after load
  url.searchParams.set('view', 'calendar-settings');
  // Clear the state cookie
  res.setHeader('Set-Cookie', 'ryxa_gcal_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return res.redirect(302, url.toString());
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error: googleError } = req.query;

  // User clicked "Cancel" on Google's consent screen
  if (googleError) {
    return redirectWithFlag(res, 'cancelled', googleError);
  }

  if (!code || !state) {
    return redirectWithFlag(res, 'error', 'missing_params');
  }

  // CSRF check: cookie nonce must match the nonce inside Google's state
  const cookieHeader = req.headers.cookie || '';
  const cookieNonce = (cookieHeader.match(/ryxa_gcal_state=([^;]+)/) || [])[1];
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
    // Sometimes refresh_token is missing if the user has previously authorized
    // and we didn't force prompt=consent. We do force it, so this should be rare.
    console.error('Missing tokens in Google response:', Object.keys(tokens));
    return redirectWithFlag(res, 'error', 'incomplete_tokens');
  }

  // Get the email of the connected Google account
  let googleEmail = null;
  try {
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      googleEmail = profile.email || null;
    }
  } catch (e) {
    // Non-fatal: we can still store the connection without the email
    console.error('Userinfo fetch failed:', e);
  }

  // Store tokens in DB (service role bypasses RLS)
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

  const { error: dbErr } = await sb
    .from('google_calendar_connections')
    .upsert({
      user_id: userId,
      google_email: googleEmail,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope || 'https://www.googleapis.com/auth/calendar.app.created',
      expires_at: expiresAt,
      ryxa_calendar_id: null,         // Phase 3 will create the Ryxa calendar
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (dbErr) {
    console.error('Supabase upsert failed:', dbErr);
    return redirectWithFlag(res, 'error', 'db_write_failed');
  }

  return redirectWithFlag(res, 'connected');
}
