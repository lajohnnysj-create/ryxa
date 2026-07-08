// Vercel serverless function backing /purchase-complete.html
//
// Two actions, both authorized by PROOF OF PAYMENT (a real, paid Stripe
// checkout session id), never by merely knowing an email address.
//
//   POST { action: 'status', session_id }
//     -> { status: 'processing' }                      webhook hasn't landed yet
//     -> { status: 'needs_password', email, ... }      new passwordless account
//     -> { status: 'ready', email, ... }               existing account, has a password
//
//   POST { action: 'set_password', session_id, password }
//     -> { ok: true, email }   caller then signs in client side
//
// Guards on set_password, all of them required:
//   1. Stripe session exists, is ours, and payment_status === 'paid'
//   2. Session is recent (24h) so a stale URL cannot be replayed later
//   3. A purchase row exists for THIS session id, which names the owning user.
//      The password can therefore only ever be set on the account that owns
//      this exact purchase.
//   4. That account has no password yet (public.user_has_password)
//   5. This session has never set a password before (one-shot ledger)

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

function getStripeKey() {
  var k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error('STRIPE_SECRET_KEY not configured');
  return k;
}

async function sbFetch(path, opts) {
  var key = getServiceKey();
  opts = opts || {};
  var headers = Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }, opts.headers || {});
  var res = await fetch(SUPABASE_URL + path, Object.assign({}, opts, { headers: headers }));
  var text = await res.text();
  var data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!res.ok) {
    throw new Error('Supabase ' + res.status + ': ' + (text || '').slice(0, 200));
  }
  return data;
}

async function sbRpc(fn, args) {
  return await sbFetch('/rest/v1/rpc/' + fn, {
    method: 'POST',
    body: JSON.stringify(args || {})
  });
}

async function stripeGetSession(sessionId) {
  var res = await fetch(
    'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId),
    { headers: { Authorization: 'Bearer ' + getStripeKey() } }
  );
  var data = await res.json();
  if (!res.ok) return null;
  return data;
}

// Look up the purchase row this session created. Its presence proves the
// webhook has run, and it names the account that owns the purchase.
async function findPurchase(sessionId) {
  var rows = await sbFetch(
    '/rest/v1/digital_product_purchases?stripe_session_id=eq.' +
    encodeURIComponent(sessionId) +
    '&select=buyer_user_id,buyer_email,product_id&limit=1'
  );
  return rows && rows.length ? rows[0] : null;
}

module.exports = async (req, res) => {
  if (require('./lib/rate-limit').tooMany(req, res, 'purchase-complete', 20, 60000)) return;

  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body || {};
    var action = body.action;
    var sessionId = body.session_id;

    if (!sessionId || typeof sessionId !== 'string' || sessionId.indexOf('cs_') !== 0) {
      return res.status(400).json({ error: 'Invalid session' });
    }

    // Guard 1 + 2: the session must be real, paid, and recent.
    var session = await stripeGetSession(sessionId);
    if (!session || session.payment_status !== 'paid') {
      return res.status(403).json({ error: 'This purchase could not be verified.' });
    }
    var ageSeconds = Math.floor(Date.now() / 1000) - Number(session.created || 0);
    if (ageSeconds > 86400) {
      return res.status(403).json({ error: 'This link has expired. Check your email for your access link.' });
    }

    // Guard 3: the purchase row names the owning account. Missing means the
    // webhook has not landed yet (the browser beat it), not that anything
    // failed. The page polls.
    var purchase = await findPurchase(sessionId);
    if (!purchase) {
      return res.status(200).json({ status: 'processing' });
    }

    var userId = purchase.buyer_user_id;
    var email = purchase.buyer_email;

    var hasPassword = await sbRpc('user_has_password', { p_user_id: userId });
    hasPassword = hasPassword === true;

    if (action === 'status') {
      return res.status(200).json({
        status: hasPassword ? 'ready' : 'needs_password',
        email: email,
        product_id: purchase.product_id
      });
    }

    if (action !== 'set_password') {
      return res.status(400).json({ error: 'Unknown action' });
    }

    // ---- set_password ----
    var password = body.password;
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    // Guard 4: never overwrite an existing account's password. Someone with a
    // leaked session URL must not be able to take over an account that simply
    // happened to buy something.
    if (hasPassword) {
      return res.status(409).json({
        error: 'This account already has a password. Sign in at the Ryxa Hub, or use "Email me a login link".'
      });
    }

    // Guard 5: one shot per session. The insert is the lock. A duplicate key
    // means this session already set a password (replay attempt, or a double
    // submit).
    try {
      await sbFetch('/rest/v1/purchase_password_setups', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ session_id: sessionId, user_id: userId })
      });
    } catch (e) {
      return res.status(409).json({
        error: 'A password was already set for this purchase. Sign in at the Ryxa Hub.'
      });
    }

    // Set the password on the account that owns this purchase.
    var key = getServiceKey();
    var updRes = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
      method: 'PUT',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: password })
    });

    if (!updRes.ok) {
      var errText = await updRes.text().catch(function () { return ''; });
      console.error('set_password: admin update failed', updRes.status, errText.slice(0, 200));
      return res.status(500).json({ error: 'Could not set your password. Please use "Email me a login link" at the Ryxa Hub.' });
    }

    return res.status(200).json({ ok: true, email: email });
  } catch (err) {
    console.error('purchase-complete error:', err);
    return res.status(500).json({ error: 'Something went wrong. Check your email for your access link.' });
  }
};
