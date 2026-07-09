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
//     -> { ok: true, email, redirect_url }
//        redirect_url is a one-time magic link that signs the buyer in and
//        lands them on their purchase. We do NOT sign in from the browser:
//        CAPTCHA protection is enabled on this project, so any client-side
//        signInWithPassword without a Turnstile token fails, and Supabase
//        reports that as "Invalid login credentials". Minting the link server
//        side sidesteps the captcha entirely and needs no Supabase client on
//        the page.
//
// Guards on set_password, all of them required:
//   1. Stripe session exists, is ours, and payment_status === 'paid'
//   2. Session is recent (24h) so a stale URL cannot be replayed later
//   3. A purchase row exists for THIS session id, which names the owning user.
//      The password can therefore only ever be set on the account that owns
//      this exact purchase.
//   4. The account is one WE provisioned and still awaits a password
//      (app_metadata.needs_password, service-role writable only), and has
//      never signed in. Note: encrypted_password is useless for this, because
//      createUser hashes a random password when none is supplied.
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

// Read the auth user through the admin API. Returns app_metadata (service-role
// writable only) and last_sign_in_at, which together tell us whether this is a
// purchase-provisioned account still waiting for its password.
async function adminGetUser(userId) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error('admin getUser failed: ' + res.status);
  return await res.json();
}

// A one-time link that authenticates the buyer and lands them on their
// purchase. Generated with the service role, so no captcha is involved.
async function adminMagicLink(email, redirectTo) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ type: 'magiclink', email: email, redirect_to: redirectTo })
  });
  if (!res.ok) {
    var t = await res.text().catch(function () { return ''; });
    console.error('generate_link failed', res.status, t.slice(0, 200));
    return null;
  }
  var data = await res.json().catch(function () { return null; });
  return (data && (data.action_link || (data.properties && data.properties.action_link))) || null;
}

async function adminUpdateUser(userId, payload) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
    method: 'PUT',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    var t = await res.text().catch(function () { return ''; });
    throw new Error('admin updateUser failed: ' + res.status + ' ' + t.slice(0, 200));
  }
  return await res.json();
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

// Each purchase type lands in its own table, with its own column names.
// Getting these wrong means the page polls forever on "Setting up your access".
var PURCHASE_TABLES = {
  digital_product: {
    table: 'digital_product_purchases',
    sessionCol: 'stripe_session_id',
    userCol: 'buyer_user_id',
    itemCol: 'product_id'
  },
  course: {
    table: 'course_enrollments',
    sessionCol: 'stripe_checkout_session_id',
    userCol: 'user_id',
    itemCol: 'course_id'
  },
  coaching: {
    table: 'coaching_bookings',
    sessionCol: 'stripe_checkout_session_id',
    userCol: 'user_id',
    itemCol: 'coaching_id'
  }
};

// Look up the purchase row this session created. Its presence proves the
// webhook has run, and it names the account that owns the purchase.
async function findPurchase(type, sessionId) {
  var cfg = PURCHASE_TABLES[type];
  if (!cfg) return null;

  var rows = await sbFetch(
    '/rest/v1/' + cfg.table +
    '?' + cfg.sessionCol + '=eq.' + encodeURIComponent(sessionId) +
    '&select=' + cfg.userCol + ',buyer_email,' + cfg.itemCol +
    '&limit=1'
  );
  if (!rows || !rows.length) return null;

  var row = rows[0];
  return {
    userId: row[cfg.userCol],
    email: row.buyer_email,
    itemId: row[cfg.itemCol]
  };
}

// Where the Hub shows this purchase.
function hubPath(type, itemId) {
  if (type === 'course') return '/learn/?course=' + encodeURIComponent(itemId) + '&enrolled=1';
  if (type === 'coaching') return '/learn/';
  return '/learn/?dp=' + encodeURIComponent(itemId) + '&purchased=1';
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

    var type = body.type || 'digital_product';
    if (!PURCHASE_TABLES[type]) {
      return res.status(400).json({ error: 'Unknown purchase type' });
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
    var purchase = await findPurchase(type, sessionId);
    if (!purchase || !purchase.userId) {
      return res.status(200).json({ status: 'processing' });
    }

    var userId = purchase.userId;
    var email = purchase.email;

    var authUser = await adminGetUser(userId);
    var appMeta = (authUser && authUser.app_metadata) || {};
    // Only an account WE provisioned for this purchase flow, which has never
    // been signed into, may set a password here.
    var needsPassword = appMeta.needs_password === true && !authUser.last_sign_in_at;

    if (action === 'status') {
      return res.status(200).json({
        status: needsPassword ? 'needs_password' : 'ready',
        is_new_account: needsPassword,
        email: email,
        item_id: purchase.itemId,
        hub_path: hubPath(type, purchase.itemId)
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

    // Guard 4: never touch an account we did not provision, or one that has
    // already been used. Someone with a leaked session URL must not be able to
    // take over an account that simply happened to buy something.
    if (!needsPassword) {
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

    // Set the password. This MUST be its own admin call.
    //
    // Sending { password, app_metadata } together does NOT work: GoTrue
    // applies the metadata, silently ignores the password, and still bumps
    // updated_at. It looks like a success and leaves the account with the
    // random password createUser generated. Verified the hard way.
    try {
      await adminUpdateUser(userId, { password: password });
    } catch (e) {
      console.error('set_password: password update failed', e.message);
      return res.status(500).json({ error: 'Could not set your password. Please use "Email me a login link" at the Ryxa Hub.' });
    }

    // Only once the password is actually stored do we close the window. If the
    // call above had failed, the flag must stay true so the buyer can retry.
    try {
      await adminUpdateUser(userId, { app_metadata: { needs_password: false } });
    } catch (e) {
      // Non-fatal: the password is set, which is what the buyer cares about.
      // The stale flag is harmless because the ledger already blocks reuse.
      console.error('set_password: could not clear needs_password flag', e.message);
    }

    // Sign them in by redirecting to a freshly minted magic link. If link
    // generation fails, the password is still set: send them to the Hub to
    // sign in normally rather than failing a completed purchase.
    var origin2 = allowed.includes(origin) ? origin : 'https://www.ryxa.io';
    var target = origin2 + hubPath(type, purchase.itemId);
    var redirectUrl = await adminMagicLink(email, target);

    return res.status(200).json({
      ok: true,
      email: email,
      redirect_url: redirectUrl || (origin2 + '/learn/')
    });
  } catch (err) {
    console.error('purchase-complete error:', err);
    return res.status(500).json({ error: 'Something went wrong. Check your email for your access link.' });
  }
};
