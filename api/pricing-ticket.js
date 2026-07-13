// /api/pricing-ticket.js
//
// Issues a short-lived signed "ticket" that carries a user's identity from the
// native app's WebView to the pricing page opened in Safari, WITHOUT putting a
// Supabase session token in the URL. Mirrors the OAuth ticket pattern
// (youtube-oauth-ticket.js etc.).
//
// Why this exists:
//   In the app, the upgrade buttons open the pricing page in Safari (so no
//   purchase surface renders inside the app, per App Store rules). Safari is a
//   separate browser and does NOT share the app WebView's Supabase session, so
//   the pricing page would otherwise see a logged-out visitor and bounce them
//   to signup. This ticket lets the pricing page (and the checkout function)
//   know which signed-in user initiated the upgrade.
//
// Flow:
//   1. Dashboard (in the app) POSTs here with the user's Supabase access token
//      in the Authorization header.
//   2. We verify the user is authenticated.
//   3. We mint a signed JSON payload containing the user_id and a timestamp.
//   4. The dashboard opens /pricing.html?ticket=<signed> in Safari.
//   5. The pricing page passes the ticket to create-checkout-session, which
//      verifies the signature and uses the embedded user_id (never a raw id
//      from the body).
//
// Signed with HMAC-SHA256 using PRICING_TICKET_SIGNING_SECRET. Valid 5 minutes.

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TICKET_SIGNING_SECRET = process.env.PRICING_TICKET_SIGNING_SECRET;

const TICKET_TTL_MS = 5 * 60 * 1000; // 5 minutes; must match the verifier

// Distinct key derivation prefix so a leaked pricing-ticket key can never be
// reused to forge OAuth tickets (and vice versa).
function getSigningKey() {
  return crypto.createHash('sha256').update('ryxa_pricing_ticket_' + TICKET_SIGNING_SECRET).digest();
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
        apikey: SUPABASE_SERVICE_KEY,
      },
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
  // Per-IP rate limit: 30 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'pricing-ticket', 30, 60000)) return;

  res.setHeader('Access-Control-Allow-Origin', 'https://ryxa.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!TICKET_SIGNING_SECRET || !SUPABASE_SERVICE_KEY) {
    console.error('pricing-ticket: missing env vars');
    return res.status(500).json({ error: 'misconfigured' });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || '';
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

module.exports.TICKET_TTL_MS = TICKET_TTL_MS;
