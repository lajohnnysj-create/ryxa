// Vercel serverless function, creates a Stripe Checkout Session for a
// digital product. Uses Stripe Connect so payment goes directly to the
// creator's connected account.
//
// GUEST CHECKOUT: the buyer does NOT need an account. Two paths:
//
//   Logged in  -> Authorization header verifies, buyer_id goes in metadata,
//                 success_url is the caller's (straight into the Hub).
//   Guest      -> no auth header. Stripe collects the email on its own page.
//                 metadata carries NO buyer_id. The course-webhook then
//                 resolves or creates the account from that email and binds
//                 the purchase to it (payment provisions, login only accesses).
//                 success_url is rewritten to /purchase-complete, because a
//                 guest dropped on /learn/ would just hit a login wall.
//
// POST /api/digital-product-checkout
// Headers: Authorization: Bearer <buyer_access_token>   (OPTIONAL)
// Body: { product_id, marketing_consent, success_url, cancel_url }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

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

const PLATFORM_FEE_BPS = 0;  // 0% — Ryxa takes 0% transaction fees, Stripe still processes fees

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

// Returns the buyer when a valid token is present, otherwise null.
// null is now a normal, supported state (guest checkout), not an error.
async function verifyBuyerJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  var token = authHeader.split(' ')[1];
  try {
    var res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY }
    });
    if (!res.ok) return null;
    var data = await res.json();
    return data?.id ? { id: data.id, email: data.email } : null;
  } catch (e) {
    return null;
  }
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

module.exports = async (req, res) => {
  // Per-IP rate limit: 10 requests / 60s. See api/lib/rate-limit.js.
  // This route is reachable without auth now, so the limiter is the primary
  // abuse control. Keep it.
  if (require('./lib/rate-limit').tooMany(req, res, 'product-checkout', 10, 60000)) return;

  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Buyer is OPTIONAL. A missing or invalid token means a guest checkout.
    var buyer = await verifyBuyerJWT(req.headers.authorization || '');
    var isGuest = !buyer;

    // 2. Parse body
    var body = req.body || {};
    var productId = body.product_id;
    var marketingConsent = !!body.marketing_consent;
    var successUrl = body.success_url;
    var cancelUrl = body.cancel_url;

    if (!productId || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 3. Load product
    var products = await sbSelect('digital_products?id=eq.' + encodeURIComponent(productId) + '&is_active=eq.true&select=id,user_id,title,price_cents,currency,slug&limit=1');
    if (!products || products.length === 0) {
      return res.status(404).json({ error: 'Product not found or unavailable' });
    }
    var product = products[0];

    if (!product.price_cents || product.price_cents <= 0) {
      return res.status(400).json({ error: 'This is a free product. Use the free claim flow.' });
    }

    // 4. Load creator's stripe_account_id
    var profiles = await sbSelect('profiles?user_id=eq.' + encodeURIComponent(product.user_id) + '&select=stripe_account_id,username&limit=1');
    if (!profiles || profiles.length === 0 || !profiles[0].stripe_account_id) {
      return res.status(400).json({ error: 'Creator has not connected a payment account' });
    }
    var creator = profiles[0];

    // 5. Verify product has at least one file
    var files = await sbSelect('digital_product_files?product_id=eq.' + encodeURIComponent(productId) + '&select=id&limit=1');
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'This product has no files yet' });
    }

    // 6. Where Stripe sends the browser after payment.
    // A guest is not signed in, so the Hub would only show them a login wall.
    // Send them to the completion page instead, which works logged out and
    // hands them a set-password step. Stripe substitutes the real id for the
    // {CHECKOUT_SESSION_ID} template token.
    var resolvedSuccessUrl = successUrl;
    if (isGuest) {
      var base = allowed.includes(origin) ? origin : 'https://www.ryxa.io';
      resolvedSuccessUrl = base + '/purchase-complete.html'
        + '?session_id={CHECKOUT_SESSION_ID}'
        + '&type=digital_product'
        + '&id=' + encodeURIComponent(product.id);
    }

    // 7. Metadata. buyer_id is present ONLY for a logged-in purchase. Its
    // absence is the webhook's signal to resolve or create the buyer from the
    // email Stripe collected.
    var meta = {
      type: 'digital_product',
      product_id: product.id,
      creator_user_id: product.user_id,
      marketing_consent: marketingConsent ? '1' : '0'
    };
    if (buyer) meta.buyer_id = buyer.id;

    // 8. Create Stripe Checkout Session via Connect
    var amountCents = Number(product.price_cents);
    var feeAmount = Math.floor(amountCents * (PLATFORM_FEE_BPS / 10000));

    var sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      // Optional individual name field. Adds ONE field to checkout (no address).
      // Buyer's name comes back on session.customer_details.individual_name after
      // checkout completes, captured by the course-webhook into buyer_first_name
      // and buyer_last_name on digital_product_purchases.
      name_collection: {
        individual: { enabled: true, optional: true }
      },
      line_items: [{
        price_data: {
          currency: (product.currency || 'usd').toLowerCase(),
          product_data: { name: product.title },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      payment_intent_data: {
        application_fee_amount: feeAmount,
        transfer_data: { destination: creator.stripe_account_id },
        metadata: meta
      },
      metadata: meta,
      success_url: resolvedSuccessUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: false
    };

    // Logged-in buyers get their email prefilled. Guests type theirs on
    // Stripe's page, and that address becomes the account that owns the
    // purchase, so it arrives on session.customer_details.email.
    if (buyer && buyer.email) {
      sessionParams.customer_email = buyer.email;
    }

    var session = await stripeRequest('checkout/sessions', sessionParams);

    return res.status(200).json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error('digital-product-checkout error:', err);
    return res.status(500).json({ error: err.message || 'Could not create checkout session' });
  }
};
