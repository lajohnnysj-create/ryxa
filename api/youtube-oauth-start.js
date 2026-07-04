// /api/youtube-oauth-start.js
//
// Initiates the YouTube OAuth flow. Called when a logged-in Ryxa user clicks
// "Connect YouTube" in Settings (under Instagram).
//
// Flow:
//   1. Dashboard POSTs /api/youtube-oauth-ticket (with auth header) to get a
//      short-lived signed ticket containing their user_id.
//   2. Dashboard navigates to /api/youtube-oauth-start?ticket=<signed_ticket>.
//   3. This endpoint verifies the ticket signature and extracts user_id.
//   4. Generates a CSRF state token bound to the user_id, sets a cookie.
//   5. Redirects the browser to Google's OAuth consent screen.
//
// YouTube reuses the SAME Google OAuth client as Calendar, but with YouTube
// scopes and its OWN redirect URI (YT_OAUTH_REDIRECT_URI), which must be
// registered in the Google Cloud console alongside the Calendar one.

const crypto = require('crypto');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const YT_REDIRECT_URI = process.env.YT_OAUTH_REDIRECT_URI;
const TICKET_SIGNING_SECRET = process.env.YT_TICKET_SIGNING_SECRET;

const TICKET_TTL_MS = 5 * 60 * 1000; // must match youtube-oauth-ticket.js
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Scopes:
//   - youtube.readonly: channel snippet + statistics (subs, views, videos)
//   - yt-analytics.readonly: 30-day metrics + owner demographics
//   - userinfo.email: show "Connected as <email>" in Settings
// yt-analytics.readonly is a SENSITIVE scope and may require Google OAuth
// verification on the consent screen before non-test users can grant it.
const SCOPE = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

function getSigningKey() {
  return crypto.createHash('sha256').update('ryxa_yt_ticket_' + TICKET_SIGNING_SECRET).digest();
}

// Distinct prefix from getSigningKey() so a leaked ticket-signing key can't
// forge state, and vice versa. Matches the Calendar / Instagram pattern.
function getStateSigningKey() {
  return crypto.createHash('sha256').update('ryxa_yt_state_' + TICKET_SIGNING_SECRET).digest();
}

function verifyTicket(rawTicket) {
  try {
    const decoded = Buffer.from(rawTicket, 'base64url').toString('utf8');
    const { p: payload, h: hmac } = JSON.parse(decoded);

    if (!payload || !hmac) {
      console.error('Ticket missing payload or hmac');
      return null;
    }

    const expectedHmac = crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
    if (hmac.length !== expectedHmac.length) {
      console.error('Ticket HMAC length mismatch');
      return null;
    }
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
      console.error('Ticket HMAC signature mismatch');
      return null;
    }

    const { uid, ts } = JSON.parse(payload);

    const age = Date.now() - ts;
    if (isNaN(age) || age < 0 || age > TICKET_TTL_MS) {
      console.error('Ticket expired, age:', age);
      return null;
    }

    if (!UUID_REGEX.test(uid)) {
      console.error('Invalid UUID in ticket:', uid);
      return null;
    }

    return uid;
  } catch (e) {
    console.error('verifyTicket failed:', e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  // Per-IP rate limit: 20 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'yt-oauth-start', 20, 60000)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!GOOGLE_CLIENT_ID || !YT_REDIRECT_URI || !TICKET_SIGNING_SECRET) {
    console.error('Missing env vars');
    return res.status(500).send('OAuth not configured');
  }

  const ticket = req.query && req.query.ticket ? String(req.query.ticket) : null;
  if (!ticket) {
    return res.status(401).send('Missing connect ticket. Please return to the dashboard and try again.');
  }

  const userId = verifyTicket(ticket);
  if (!userId) {
    return res.status(401).send('Invalid or expired ticket. Please refresh and try again.');
  }

  // CSRF state: random nonce in httpOnly cookie + HMAC-signed state in OAuth.
  //   - Cookie binding: proves it's the same browser that initiated the flow
  //   - HMAC signature: proves Ryxa generated the state (state.uid untamperable)
  // Both must pass in the callback.
  const stateNonce = crypto.randomBytes(24).toString('base64url');
  const statePayload = JSON.stringify({ uid: userId, n: stateNonce, ts: Date.now() });
  const stateHmac = crypto
    .createHmac('sha256', getStateSigningKey())
    .update(statePayload)
    .digest('hex');
  const stateB64 = Buffer.from(JSON.stringify({ p: statePayload, h: stateHmac })).toString('base64url');

  res.setHeader(
    'Set-Cookie',
    'ryxa_yt_state=' + stateNonce + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'
  );

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: YT_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: stateB64,
  });

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
  return res.redirect(302, authUrl);
};
