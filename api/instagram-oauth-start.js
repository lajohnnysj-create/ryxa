// Vercel serverless function — Instagram OAuth Start
// ====================================================
// Kicks off the Instagram OAuth flow. Verifies a signed ticket
// from the dashboard, generates a signed state token bound to the
// Ryxa user_id, and redirects to Meta's authorization page.
//
// Deploy to: /api/instagram-oauth-start.js
// Endpoint URL: https://ryxa.io/api/instagram-oauth-start
// ====================================================
//
// Flow:
//   1. Dashboard fetches /api/instagram-ticket via POST (with Authorization header)
//      to get a short-lived signed ticket containing their user_id.
//   2. Dashboard navigates to /api/instagram-oauth-start?ticket=<signed_ticket>
//   3. This endpoint verifies the ticket signature and extracts user_id.
//   4. Generates a signed state token (separate signature, used by callback for CSRF).
//   5. Redirects the browser to Meta's OAuth consent screen.

const crypto = require('crypto');

const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const TICKET_SIGNING_SECRET = process.env.INSTAGRAM_TICKET_SIGNING_SECRET;
const PUBLIC_BASE_URL = 'https://ryxa.io';
const REDIRECT_URI = PUBLIC_BASE_URL + '/api/instagram-oauth-callback';

const TICKET_TTL_MS = 5 * 60 * 1000; // must match instagram-ticket.js
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stage 1 scopes — basic profile + insights for media kit auto-fill
// Stage 2 will add 'instagram_business_manage_messages' for Auto DM
const STAGE_1_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_insights'
];

// ----- Ticket verification (used to authenticate the connect-flow caller) -----

function getTicketSigningKey() {
  return crypto.createHash('sha256').update('ryxa_ig_ticket_' + TICKET_SIGNING_SECRET).digest();
}

function verifyTicket(rawTicket) {
  try {
    const decoded = Buffer.from(rawTicket, 'base64url').toString('utf8');
    const { p: payload, h: hmac } = JSON.parse(decoded);

    if (!payload || !hmac) {
      console.error('Ticket missing payload or hmac');
      return null;
    }

    const expectedHmac = crypto.createHmac('sha256', getTicketSigningKey()).update(payload).digest('hex');
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

// ----- State signing (used for CSRF on the OAuth callback) -----
// Note: this uses a different key (derived from META_APP_SECRET) than the
// ticket signing above. They serve different purposes and shouldn't share
// signing keys.

function getStateSigningKey() {
  return crypto.createHash('sha256').update('ryxa_ig_oauth_' + META_APP_SECRET).digest();
}

function signState(payload) {
  const payloadStr = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', getStateSigningKey()).update(payloadStr).digest('hex');
  const wrapped = JSON.stringify({ p: payloadStr, h: hmac });
  return Buffer.from(wrapped, 'utf8').toString('base64url');
}

// ----- main handler --------------------------------------------

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!META_APP_ID || !META_APP_SECRET) {
    console.error('Missing META_APP_ID or META_APP_SECRET');
    return res.status(500).json({ error: 'Server not configured' });
  }

  if (!TICKET_SIGNING_SECRET) {
    console.error('Missing INSTAGRAM_TICKET_SIGNING_SECRET');
    return res.status(500).json({ error: 'Server not configured' });
  }

  // Verify the signed ticket
  const ticket = req.query && req.query.ticket ? String(req.query.ticket) : null;
  if (!ticket) {
    return res.status(401).json({ error: 'Missing ticket' });
  }

  const userId = verifyTicket(ticket);
  if (!userId) {
    return res.status(401).json({ error: 'Invalid or expired ticket' });
  }

  // Generate state token: Ryxa user_id + random nonce + timestamp
  const state = signState({
    uid: userId,
    n: crypto.randomBytes(8).toString('hex'),
    t: Date.now()
  });

  // Build the Meta OAuth URL
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: STAGE_1_SCOPES.join(','),
    state: state
  });

  const authUrl = 'https://api.instagram.com/oauth/authorize?' + params.toString();

  res.writeHead(302, { Location: authUrl });
  return res.end();
};
