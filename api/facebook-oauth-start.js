// Vercel serverless function - Facebook OAuth Start
// ====================================================
// Verifies a signed ticket from the dashboard, generates a signed state token
// bound to the Ryxa user_id, and redirects to Facebook's authorization page.
//
// Mirrors instagram-oauth-start.js, but uses the FACEBOOK LOGIN flow
// (facebook.com/dialog/oauth + graph.facebook.com), not the Instagram-Login
// flow. Same Meta app (META_APP_ID / META_APP_SECRET).
//
// Deploy to: /api/facebook-oauth-start.js
// Endpoint:  https://ryxa.io/api/facebook-oauth-start
// ====================================================

const crypto = require('crypto');

const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const TICKET_SIGNING_SECRET = process.env.FACEBOOK_TICKET_SIGNING_SECRET;
const PUBLIC_BASE_URL = 'https://ryxa.io';
const REDIRECT_URI = PUBLIC_BASE_URL + '/api/facebook-oauth-callback';
const GRAPH_VERSION = 'v22.0';

const TICKET_TTL_MS = 5 * 60 * 1000; // must match facebook-ticket.js
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Page-level scopes. pages_show_list + pages_read_engagement are required to
// list the user's Pages and read the Page node (name, followers_count,
// fan_count). read_insights is included now so Stage 2 (reach/views/engagement)
// works without a second consent screen.
const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'read_insights'
];

// ----- Ticket verification -----

function getTicketSigningKey() {
  return crypto.createHash('sha256').update('ryxa_fb_ticket_' + TICKET_SIGNING_SECRET).digest();
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

// ----- State signing (CSRF on the callback). Distinct key from the ticket. -----

function getStateSigningKey() {
  return crypto.createHash('sha256').update('ryxa_fb_oauth_' + META_APP_SECRET).digest();
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
    console.error('Missing FACEBOOK_TICKET_SIGNING_SECRET');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const ticket = req.query && req.query.ticket ? String(req.query.ticket) : null;
  if (!ticket) {
    return res.status(401).json({ error: 'Missing ticket' });
  }

  const userId = verifyTicket(ticket);
  if (!userId) {
    return res.status(401).json({ error: 'Invalid or expired ticket' });
  }

  const state = signState({
    uid: userId,
    n: crypto.randomBytes(8).toString('hex'),
    t: Date.now()
  });

  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(','),
    state: state
  });

  const authUrl = 'https://www.facebook.com/' + GRAPH_VERSION + '/dialog/oauth?' + params.toString();

  res.writeHead(302, { Location: authUrl });
  return res.end();
};
