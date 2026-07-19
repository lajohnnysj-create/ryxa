// Vercel serverless function - POST /api/invoice-webhook
//
// Dedicated Stripe webhook endpoint for INVOICE payments only. Register it in
// the Stripe dashboard as a second webhook endpoint pointing at
//   https://www.ryxa.io/api/invoice-webhook
// listening for checkout.session.completed, and set its signing secret in the
// STRIPE_INVOICE_WEBHOOK_SECRET env var. It ignores every event that is not an
// invoice checkout (metadata.type !== 'invoice'), so it coexists safely with
// the existing tips webhook.
//
// On a completed invoice checkout it sets the invoice's status to 'paid' via
// the service role; the invoices_revenue_sync DB trigger then records the
// revenue_events row, which is what feeds the analytics. Idempotent: an
// already-paid invoice is left untouched.

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

function getWebhookSecret() {
  var k = process.env.STRIPE_INVOICE_WEBHOOK_SECRET;
  if (!k) throw new Error('STRIPE_INVOICE_WEBHOOK_SECRET not configured');
  return k;
}

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

// Verify the Stripe-Signature header: HMAC-SHA256 of "<timestamp>.<payload>"
// with the endpoint's signing secret, compared in constant time, with a
// 5-minute tolerance window against replay.
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;
  var parts = {};
  sigHeader.split(',').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) {
      var key = kv.slice(0, i).trim();
      var val = kv.slice(i + 1).trim();
      if (key === 'v1') { (parts.v1 = parts.v1 || []).push(val); }
      else parts[key] = val;
    }
  });
  var ts = parseInt(parts.t, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false; // 5 min tolerance
  var expected = crypto.createHmac('sha256', secret)
    .update(parts.t + '.' + rawBody.toString('utf8'), 'utf8')
    .digest('hex');
  var sigs = parts.v1 || [];
  for (var i = 0; i < sigs.length; i++) {
    var candidate = Buffer.from(sigs[i], 'utf8');
    var exp = Buffer.from(expected, 'utf8');
    if (candidate.length === exp.length && crypto.timingSafeEqual(candidate, exp)) return true;
  }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var raw = await readRawBody(req);
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'], getWebhookSecret())) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    var event = JSON.parse(raw.toString('utf8'));

    if (event.type !== 'checkout.session.completed') {
      return res.status(200).json({ received: true });
    }

    var session = event.data && event.data.object;
    var meta = (session && session.metadata) || {};
    if (meta.type !== 'invoice' || !meta.invoice_id) {
      // Not an invoice checkout (e.g. a tip) - acknowledge and ignore.
      return res.status(200).json({ received: true });
    }
    if (session.payment_status && session.payment_status !== 'paid') {
      // Async payment methods not yet settled; wait for the paid event.
      return res.status(200).json({ received: true });
    }

    // Mark paid, only if not already paid (idempotent; the DB trigger records
    // the revenue event and is itself idempotent as a second layer).
    var patch = await fetch(SUPABASE_URL + '/rest/v1/invoices?id=eq.'
      + encodeURIComponent(meta.invoice_id) + '&status=neq.paid', {
      method: 'PATCH',
      headers: {
        apikey: getServiceKey(),
        Authorization: 'Bearer ' + getServiceKey(),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ status: 'paid' })
    });
    if (!patch.ok) {
      var t = await patch.text();
      console.error('invoice-webhook: mark paid failed', patch.status, t.slice(0, 200));
      // Non-2xx makes Stripe retry, which is what we want for a transient DB error.
      return res.status(500).json({ error: 'Update failed' });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('invoice-webhook error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

// Raw body is required for Stripe signature verification. This must come AFTER
// the handler assignment above (module.exports = ...) or it would be wiped.
module.exports.config = { api: { bodyParser: false } };
