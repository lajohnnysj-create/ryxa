// /api/twitch-oauth-start.js
//
// Initiates the Twitch OAuth (authorization code) flow. Called when a logged-in
// Ryxa user clicks "Connect Twitch" in Settings.
//
// Flow:
//   1. Dashboard POSTs /api/twitch-oauth-ticket (with auth header) to get a
//      short-lived signed ticket containing their user_id.
//   2. Dashboard navigates to /api/twitch-oauth-start?ticket=<signed_ticket>.
//   3. This endpoint verifies the ticket signature and extracts user_id.
//   4. Generates a CSRF state token bound to the user_id, sets a cookie.
//   5. Redirects the browser to Twitch's authorization screen.
//
// Notes specific to Twitch:
//   - Uses client_id and SPACE-separated scopes (URLSearchParams encodes the
//     space, which Twitch accepts).
//   - The redirect_uri must EXACTLY match the one registered on the Twitch app:
//     https://ryxa.io/auth/twitch/callback  (apex; Vercel 308s to www and a
//     vercel.json rewrite maps that path to /api/twitch-oauth-callback).
//   - Scope moderator:read:followers is required to read the creator's own
//     follower count; helix/users (profile) needs no scope.

const crypto = require('crypto');

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_REDIRECT_URI = process.env.TWITCH_OAUTH_REDIRECT_URI;
const TICKET_SIGNING_SECRET = process.env.TWITCH_TICKET_SIGNING_SECRET;

const TICKET_TTL_MS = 5 * 60 * 1000; // must match twitch-oauth-ticket.js
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Scope (approved on the live Twitch app):
//   - moderator:read:followers  total follower count of the creator's own
//     channel (broadcaster_id must match the authenticated user, which it does
//     when the creator connects their own channel).
const SCOPE = 'moderator:read:followers';

function getSigningKey() {
  return crypto.createHash('sha256').update('ryxa_tw_ticket_' + TICKET_SIGNING_SECRET).digest();
}

// Distinct prefix from getSigningKey() so a leaked ticket-signing key can't
// forge state, and vice versa.
function getStateSigningKey() {
  return crypto.createHash('sha256').update('ryxa_tw_state_' + TICKET_SIGNING_SECRET).digest();
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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!TWITCH_CLIENT_ID || !TWITCH_REDIRECT_URI || !TICKET_SIGNING_SECRET) {
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
    'ryxa_tw_state=' + stateNonce + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'
  );

  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: TWITCH_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    state: stateB64,
  });

  const authUrl = 'https://id.twitch.tv/oauth2/authorize?' + params.toString();
  return res.redirect(302, authUrl);
};
