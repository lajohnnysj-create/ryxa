// /api/google-calendar-start.js
//
// Initiates the Google Calendar OAuth flow.
// Called when a logged-in Ryxa user clicks "Connect Google Calendar".
//
// Flow:
//   1. Dashboard fetches /api/google-calendar-ticket via POST (with auth header)
//      to get a short-lived signed ticket containing their user_id.
//   2. Dashboard navigates to /api/google-calendar-start?ticket=<signed_ticket>
//   3. This endpoint verifies the ticket signature and extracts user_id.
//   4. Generates a CSRF state token bound to the user_id, sets cookie.
//   5. Redirects the browser to Google's OAuth consent screen.
//
// The ticket is signed with HMAC-SHA256 and expires in 5 minutes. It cannot
// be forged without the signing secret, and it cannot be used as a session
// token (it only proves "this user_id authorized starting an OAuth flow").

const crypto = require('crypto');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI;
const TICKET_SIGNING_SECRET = process.env.GCAL_TICKET_SIGNING_SECRET;

const TICKET_TTL_MS = 5 * 60 * 1000; // must match google-calendar-ticket.js
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Non-sensitive scopes:
//   - calendar.app.created: only calendars Ryxa creates
//   - userinfo.email: so we can show "Connected as <email>" in the dashboard
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/userinfo.email';

function getSigningKey() {
  return crypto.createHash('sha256').update('ryxa_gcal_ticket_' + TICKET_SIGNING_SECRET).digest();
}

// Distinct prefix from getSigningKey() so a leaked ticket-signing key can't
// forge state, and vice versa. Matches the Instagram OAuth pattern.
function getStateSigningKey() {
  return crypto.createHash('sha256').update('ryxa_gcal_state_' + TICKET_SIGNING_SECRET).digest();
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
  if (require('./lib/rate-limit').tooMany(req, res, 'gcal-start', 20, 60000)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI || !TICKET_SIGNING_SECRET) {
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
  // Belt and suspenders:
  //   - Cookie binding: proves it's the same browser that initiated the flow
  //   - HMAC signature: proves Ryxa generated the state (state.uid can't be tampered)
  // Either failure causes the callback to reject. Pattern matches the
  // Instagram and Stripe Connect callbacks.
  const stateNonce = crypto.randomBytes(24).toString('base64url');
  const statePayload = JSON.stringify({ uid: userId, n: stateNonce, ts: Date.now() });
  const stateHmac = crypto
    .createHmac('sha256', getStateSigningKey())
    .update(statePayload)
    .digest('hex');
  const stateB64 = Buffer.from(JSON.stringify({ p: statePayload, h: stateHmac })).toString('base64url');

  res.setHeader(
    'Set-Cookie',
    'ryxa_gcal_state=' + stateNonce + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'
  );

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
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
