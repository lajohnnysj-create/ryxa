// /api/tiktok-oauth-start.js
//
// Initiates the TikTok OAuth (Login Kit v2) flow. Called when a logged-in Ryxa
// user clicks "Connect TikTok" in Settings.
//
// Flow:
//   1. Dashboard POSTs /api/tiktok-oauth-ticket (with auth header) to get a
//      short-lived signed ticket containing their user_id.
//   2. Dashboard navigates to /api/tiktok-oauth-start?ticket=<signed_ticket>.
//   3. This endpoint verifies the ticket signature and extracts user_id.
//   4. Generates a CSRF state token bound to the user_id, sets a cookie.
//   5. Redirects the browser to TikTok's authorization screen.
//
// Notes specific to TikTok:
//   - Uses client_key (NOT client_id) and comma-separated scopes.
//   - The redirect_uri must EXACTLY match the one locked in the TikTok app:
//     https://ryxa.io/auth/tiktok/callback  (apex; Vercel 308s to www and a
//     vercel.json rewrite maps that path to /api/tiktok-oauth-callback).
//   - No query params are allowed in the redirect_uri; all per-request data is
//     carried in `state`.

const crypto = require('crypto');

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_OAUTH_REDIRECT_URI;
const TICKET_SIGNING_SECRET = process.env.TIKTOK_TICKET_SIGNING_SECRET;

const TICKET_TTL_MS = 5 * 60 * 1000; // must match tiktok-oauth-ticket.js
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Scopes (all approved on the live TikTok app):
//   - user.info.basic   open_id, union_id, avatar_url, display_name
//   - user.info.profile profile_web_link, profile_deep_link, bio_description, is_verified
//   - user.info.stats   follower_count, following_count, likes_count, video_count
//   - video.list        recent public videos (for the Recent Videos strip)
const SCOPE = 'user.info.basic,user.info.profile,user.info.stats,video.list';

function getSigningKey() {
  return crypto.createHash('sha256').update('ryxa_tt_ticket_' + TICKET_SIGNING_SECRET).digest();
}

// Distinct prefix from getSigningKey() so a leaked ticket-signing key can't
// forge state, and vice versa.
function getStateSigningKey() {
  return crypto.createHash('sha256').update('ryxa_tt_state_' + TICKET_SIGNING_SECRET).digest();
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

  if (!TIKTOK_CLIENT_KEY || !TIKTOK_REDIRECT_URI || !TICKET_SIGNING_SECRET) {
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
    'ryxa_tt_state=' + stateNonce + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'
  );

  const params = new URLSearchParams({
    client_key: TIKTOK_CLIENT_KEY,
    scope: SCOPE,
    response_type: 'code',
    redirect_uri: TIKTOK_REDIRECT_URI,
    state: stateB64,
  });

  const authUrl = 'https://www.tiktok.com/v2/auth/authorize/?' + params.toString();
  return res.redirect(302, authUrl);
};
