// /api/facebook-ticket.js
//
// Issues a short-lived signed "ticket" used to start the Facebook OAuth flow
// without putting a Supabase session token in the URL. Mirrors
// instagram-ticket.js exactly, with a distinct signing secret and key prefix
// so a leaked Instagram (or Calendar) ticket cannot start a Facebook flow.
//
// Flow:
//   1. Dashboard POSTs here with the user's Supabase access token (Authorization)
//   2. We verify the user is authenticated
//   3. We mint a signed { uid, ts } payload
//   4. Dashboard navigates to /api/facebook-oauth-start?ticket=<signed>
//
// Signed with HMAC-SHA256 using FACEBOOK_TICKET_SIGNING_SECRET. Valid 5 minutes.

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TICKET_SIGNING_SECRET = process.env.FACEBOOK_TICKET_SIGNING_SECRET;

const TICKET_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getSigningKey() {
  // 'ryxa_fb_ticket_' prefix keeps this distinct from every other HMAC key.
  return crypto.createHash('sha256').update('ryxa_fb_ticket_' + TICKET_SIGNING_SECRET).digest();
}

function signTicket(userId) {
  const payload = JSON.stringify({ uid: userId, ts: Date.now() });
  const hmac = crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
  const wrapper = JSON.stringify({ p: payload, h: hmac });
  return Buffer.from(wrapper).toString('base64url');
}

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!TICKET_SIGNING_SECRET || !SUPABASE_SERVICE_KEY) {
    console.error('Missing env vars');
    return res.status(500).json({ error: 'misconfigured' });
  }

  const authHeader = req.headers.authorization || '';
  const supabaseAccessToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!supabaseAccessToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = await verifySupabaseUser(supabaseAccessToken);
  if (!userId) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const ticket = signTicket(userId);
  return res.status(200).json({ ticket });
};
