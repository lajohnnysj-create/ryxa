// Vercel serverless function - POST /api/invoice-checkout
//
// Creates a Stripe Checkout session so an invoice recipient can pay by card.
// Mirrors api/tip-checkout.js: the amount comes from the invoice row (never
// the browser), the destination is the creator's Connect account resolved
// from the database, and metadata.type='invoice' keys the webhook
// (api/invoice-webhook.js) that marks the invoice paid on completion.
//
// Body: { public_id, success_url, cancel_url }  (anonymous - the payer)

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

const PLATFORM_FEE_BPS = 0; // Ryxa takes 0% on invoice payments (Stripe's own processing fees still apply)
const MIN_CENTS = 100;      // Stripe checkout floor ($1.00)
const MAX_CENTS = 99999999; // sanity ceiling
const RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RL_MAX = 15;                   // checkout-session creations per IP per invoice per hour

const crypto = require('crypto');

function getClientIp(req) {
  var xff = req.headers['x-forwarded-for'];
  if (xff) {
    var first = xff.split(',')[0].trim();
    if (first) return first;
  }
  var xri = req.headers['x-real-ip'];
  if (xri) return xri;
  return 'unknown';
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip)).digest('hex');
}

async function sbFetch(path, options) {
  options = options || {};
  var key = getServiceKey();
  var headers = Object.assign({
    apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'
  }, options.headers || {});
  return await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
}

// Per-IP-per-invoice throttle for anonymous checkout-session creation. Mirrors
// the tips throttle. Fails OPEN on infra errors (better to let a real payer
// through than to block payment on a rate-limit table hiccup). Read-then-write
// is not perfectly atomic, so a concurrent burst can overshoot by one or two;
// acceptable for a spam throttle.
async function checkRateLimit(ipHash, scope, bucketKey) {
  var q = 'invoice_rate_limits?ip_hash=eq.' + encodeURIComponent(ipHash)
    + '&scope=eq.' + encodeURIComponent(scope)
    + '&bucket_key=eq.' + encodeURIComponent(bucketKey);
  try {
    var selRes = await sbFetch(q + '&select=attempt_count,window_started_at&limit=1');
    if (!selRes.ok) return { allowed: true };
    var rows = await selRes.json();
    var now = Date.now();
    if (!rows || rows.length === 0) {
      await sbFetch('invoice_rate_limits', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: { ip_hash: ipHash, scope: scope, bucket_key: bucketKey, attempt_count: 1, window_started_at: new Date(now).toISOString() }
      });
      return { allowed: true };
    }
    var row = rows[0];
    var windowAge = now - new Date(row.window_started_at).getTime();
    if (windowAge > RL_WINDOW_MS) {
      await sbFetch(q, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: { attempt_count: 1, window_started_at: new Date(now).toISOString() } });
      return { allowed: true };
    }
    if (row.attempt_count >= RL_MAX) {
      return { allowed: false, retryAfterSeconds: Math.ceil((RL_WINDOW_MS - windowAge) / 1000) };
    }
    await sbFetch(q, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: { attempt_count: row.attempt_count + 1 } });
    return { allowed: true };
  } catch (e) {
    console.error('invoice checkout rate-limit error (failing open):', e.message);
    return { allowed: true };
  }
}

async function sbSelect(path) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: getServiceKey(), Authorization: 'Bearer ' + getServiceKey() }
  });
  if (!res.ok) throw new Error('Supabase select failed: ' + res.status);
  return res.json();
}

function stripeForm(obj, prefix) {
  var parts = [];
  for (var key in obj) {
    var val = obj[key];
    if (val == null) continue;
    var k = prefix ? prefix + '[' + key + ']' : key;
    if (typeof val === 'object' && !Array.isArray(val)) {
      parts.push(stripeForm(val, k));
    } else if (Array.isArray(val)) {
      val.forEach(function (item, i) {
        if (typeof item === 'object') {
          parts.push(stripeForm(item, k + '[' + i + ']'));
        } else {
          parts.push(encodeURIComponent(k + '[' + i + ']') + '=' + encodeURIComponent(item));
        }
      });
    } else {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(val));
    }
  }
  return parts.filter(Boolean).join('&');
}

async function stripeRequest(path, body) {
  var res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + getStripeKey(),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: stripeForm(body)
  });
  var data = await res.json();
  if (!res.ok) {
    throw new Error((data && data.error && data.error.message) || 'Stripe error: ' + res.status);
  }
  return data;
}

// Redirect targets must be Ryxa URLs (or localhost in dev), same rule as tips.
function isAllowedRedirect(u) {
  try {
    var x = new URL(u);
    if (x.hostname === 'localhost') return true;
    return x.protocol === 'https:' && (x.hostname === 'ryxa.io' || x.hostname.endsWith('.ryxa.io'));
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body || {};
    var publicId = (body.public_id || '').toString().trim();
    var successUrl = body.success_url;
    var cancelUrl = body.cancel_url;

    if (!publicId || publicId.length < 8 || publicId.length > 40 || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!isAllowedRedirect(successUrl) || !isAllowedRedirect(cancelUrl)) {
      return res.status(400).json({ error: 'Invalid redirect URL' });
    }

    // Throttle anonymous session creation per IP per invoice.
    var rl = await checkRateLimit(hashIp(getClientIp(req)), 'checkout', publicId);
    if (!rl.allowed) {
      if (rl.retryAfterSeconds) res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many payment attempts. Please try again in a bit.' });
    }

    // The invoice is the source of truth: amount, currency eligibility, and the
    // creator all come from the row, never from the request.
    var invoices = await sbSelect('invoices?public_id=eq.' + encodeURIComponent(publicId) + '&select=*&limit=1');
    if (!invoices || invoices.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    var inv = invoices[0];

    if (inv.status === 'paid') return res.status(400).json({ error: 'This invoice has already been paid.' });
    if (inv.status === 'draft') return res.status(400).json({ error: 'This invoice is not ready for payment yet.' });
    if (inv.payment_method !== 'stripe') return res.status(400).json({ error: 'Card payment is not enabled for this invoice.' });

    var amountCents = parseInt(inv.total_cents, 10);
    if (!Number.isFinite(amountCents) || amountCents < MIN_CENTS || amountCents > MAX_CENTS) {
      return res.status(400).json({ error: 'This invoice amount cannot be paid by card.' });
    }

    var profiles = await sbSelect('profiles?user_id=eq.' + encodeURIComponent(inv.user_id)
      + '&select=user_id,stripe_account_id,username,display_currency&limit=1');
    var creator = profiles && profiles[0];
    if (!creator || !creator.stripe_account_id) {
      return res.status(400).json({ error: 'This creator is not set up to receive card payments.' });
    }

    var currency = (creator.display_currency || 'usd').toLowerCase();
    var feeAmount = Math.floor(amountCents * (PLATFORM_FEE_BPS / 10000)); // 0 at 0 BPS

    // metadata.invoice_id is what the webhook keys on to mark the invoice paid
    // (the DB trigger then records the revenue event).
    var metadata = {
      type: 'invoice',
      invoice_id: inv.id,
      creator_user_id: inv.user_id
    };

    var itemName = 'Invoice' + (inv.invoice_number ? ' #' + inv.invoice_number : '')
      + ' from ' + (inv.from_name || '@' + (creator.username || 'creator'));

    var session = await stripeRequest('checkout/sessions', {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: currency,
          product_data: { name: itemName.slice(0, 120) },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      payment_intent_data: {
        application_fee_amount: feeAmount,
        transfer_data: { destination: creator.stripe_account_id },
        metadata: metadata
      },
      metadata: metadata,
      customer_email: inv.email_locked && inv.to_email ? inv.to_email : undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: false
    });

    return res.status(200).json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error('invoice-checkout error:', err);
    return res.status(500).json({ error: err.message || 'Could not start checkout' });
  }
};
