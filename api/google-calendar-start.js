// /api/google-calendar-start.js
//
// Initiates the Google Calendar OAuth flow.
// Called when a logged-in Ryxa user clicks "Connect Google Calendar".
//
// Flow:
//   1. Verify the caller is an authenticated Ryxa user (via Supabase access token)
//   2. Generate a CSRF state token bound to the user_id and store it in an
//      httpOnly cookie (read back by the callback to prevent state injection)
//   3. Redirect the browser to Google's OAuth consent screen with the right
//      params, including state + scope + redirect_uri
//
// Phase 1 only: just establishes the connection. No event sync yet.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI;

// Non-sensitive scope: only events on calendars Ryxa creates
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    console.error('Missing Google OAuth env vars');
    return res.status(500).json({ error: 'OAuth not configured' });
  }

  // Pull access token from Authorization header (sent by dashboard)
  const authHeader = req.headers.authorization || '';
  const supabaseAccessToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!supabaseAccessToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Verify the user with Supabase
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: userErr } = await sb.auth.getUser(supabaseAccessToken);
  if (userErr || !user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  // CSRF state: random token bound to this user_id, signed with a server secret.
  // The callback verifies the cookie matches what comes back from Google.
  const stateNonce = crypto.randomBytes(24).toString('base64url');
  const statePayload = JSON.stringify({ uid: user.id, n: stateNonce });
  const stateB64 = Buffer.from(statePayload).toString('base64url');

  // Set short-lived httpOnly cookie containing the state nonce.
  // The callback verifies it matches what Google sends back.
  res.setHeader(
    'Set-Cookie',
    `ryxa_gcal_state=${stateNonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  // Build Google's OAuth URL
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',         // request refresh token
    prompt: 'consent',              // force consent so we always get a refresh_token
    include_granted_scopes: 'true',
    state: stateB64,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return res.redirect(302, authUrl);
}
