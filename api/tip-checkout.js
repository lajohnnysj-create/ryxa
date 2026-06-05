// Vercel serverless function that creates a Stripe Checkout Session for a
// "Buy Me a Coffee" tip to a creator. Anonymous: supporters are NOT signed in.
// Uses Stripe Connect with a destination charge so the money goes to the
// creator's connected account. PLATFORM_FEE_BPS = 0, so Ryxa takes 0%
// transaction fees (Stripe still processes its own fees, same as every other
// Ryxa Connect flow).
//
// On success, the Stripe webhook (hosted outside this repo) records the tip
// into the tips table and revenue_events, idempotent on the checkout session
// id. This route only creates the session; it never records anything. The
// amount, name, and message arrive from an anonymous browser and are treated
// as untrusted: amount is bounded and recomputed server-side, name/message are
// stripped of control characters and length-capped, and the creator plus their
// Connect account are resolved from the database, never from the request body.
//
// POST /api/tip-checkout
// Body: { username, amount_cents, supporter_name?, message?, website?(honeypot),
//         success_url, cancel_url }

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

const PLATFORM_FEE_BPS = 0;     // Ryxa takes 0% transaction fees (Stripe still processes its own fees)
const TIP_MIN_CENTS = 100;      // $1.00 floor
const TIP_MAX_CENTS = 50000;    // $500.00 ceiling (typo and abuse guard)
const NAME_MAX = 50;
const MESSAGE_MAX = 200;

async function sbSelect(path) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    throw new Error('Supabase SELECT failed (' + res.status + '): ' + body);
  }
  return await res.json();
}

function stripeForm(obj, prefix) {
  prefix = prefix || '';
  var parts = [];
  for (var key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    var val = obj[key];
    if (val == null) continue;
    var k = prefix ? prefix + '[' + key + ']' : key;
    if (typeof val === 'object' && !Array.isArray(val)) {
      parts.push(stripeForm(val, k));
    } else if (Array.isArray(val)) {
      val.forEach(function(item, i) {
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
    throw new Error(data?.error?.message || 'Stripe error: ' + res.status);
  }
  return data;
}

// Untrusted free text from an anonymous supporter. Collapse control characters
// and runs of whitespace, trim, and hard-cap the length. The creator's
// dashboard sanitizes again on render (DOMPurify) per the write-and-read rule;
// this is the write-side cap that also keeps us under Stripe's 500-char
// metadata value limit.
function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  var s = v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}

// Redirect targets must be Ryxa URLs (or localhost in dev). This stops the
// endpoint from being used to mint Stripe sessions that bounce supporters to
// an arbitrary site after payment.
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

    // Honeypot: a hidden field real supporters never fill. If it has a value,
    // it's almost certainly a bot. Respond 200 with no session so the bot gets
    // no signal that it was caught, and no Stripe session is created.
    if (body.website) {
      return res.status(200).json({ ok: true });
    }

    var username = (body.username || '').toString().trim().toLowerCase();
    var successUrl = body.success_url;
    var cancelUrl = body.cancel_url;

    if (!username || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!isAllowedRedirect(successUrl) || !isAllowedRedirect(cancelUrl)) {
      return res.status(400).json({ error: 'Invalid redirect URL' });
    }

    // Amount is recomputed and bounded server-side; the browser value is never
    // trusted as-is. Integer cents only, within [TIP_MIN_CENTS, TIP_MAX_CENTS].
    var amountCents = parseInt(body.amount_cents, 10);
    if (!Number.isFinite(amountCents) || String(amountCents) !== String(body.amount_cents).trim()
        || amountCents < TIP_MIN_CENTS || amountCents > TIP_MAX_CENTS) {
      return res.status(400).json({ error: 'Enter an amount between $1 and $500.' });
    }

    // Resolve the creator and their Connect account from the database. Nothing
    // about the destination comes from the request body.
    var profiles = await sbSelect('profiles?username=eq.' + encodeURIComponent(username)
      + '&select=user_id,stripe_account_id,username,display_currency&limit=1');
    if (!profiles || profiles.length === 0) {
      return res.status(404).json({ error: 'Creator not found' });
    }
    var creator = profiles[0];
    if (!creator.stripe_account_id) {
      return res.status(400).json({ error: 'This creator is not set up to receive tips yet.' });
    }

    var currency = (creator.display_currency || 'usd').toLowerCase();
    var supporterName = cleanText(body.supporter_name, NAME_MAX);
    var message = cleanText(body.message, MESSAGE_MAX);
    var feeAmount = Math.floor(amountCents * (PLATFORM_FEE_BPS / 10000));  // 0 at 0 BPS

    // metadata.creator_user_id is set here from the server-side lookup (never
    // from the client) and is what the webhook keys the tips/revenue_events row
    // to. supporter_name/message ride along for the webhook to store.
    var metadata = {
      type: 'tip',
      creator_user_id: creator.user_id,
      supporter_name: supporterName,
      message: message
    };

    var session = await stripeRequest('checkout/sessions', {
      mode: 'payment',
      payment_method_types: ['card'],
      name_collection: {
        individual: { enabled: true, optional: true }
      },
      line_items: [{
        price_data: {
          currency: currency,
          product_data: { name: 'Tip for @' + creator.username },
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
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: false
    });

    return res.status(200).json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error('tip-checkout error:', err);
    return res.status(500).json({ error: err.message || 'Could not start checkout' });
  }
};
