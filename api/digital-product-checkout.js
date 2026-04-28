// Vercel serverless function — creates a Stripe Checkout Session for a
// digital product. Uses Stripe Connect so payment goes directly to the
// creator's connected account (you collect application_fee).
//
// POST /api/digital-product-checkout
// Body: { product_id, buyer_email, marketing_consent, success_url, cancel_url }

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

// Application fee in basis points. 500 = 5%. Match what your other
// checkouts use; if zero, the creator gets 100% (you still earn via
// the $20/mo Max subscription).
const PLATFORM_FEE_BPS = 500;  // 5%

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

// Build form-encoded body for Stripe API. Stripe expects
// application/x-www-form-urlencoded with bracket notation for nested fields.
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
  // CORS
  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body || {};
    var productId = body.product_id;
    var buyerEmail = (body.buyer_email || '').trim().toLowerCase();
    var marketingConsent = !!body.marketing_consent;
    var successUrl = body.success_url;
    var cancelUrl = body.cancel_url;

    if (!productId || !buyerEmail || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    // Load product
    var products = await sbSelect('digital_products?id=eq.' + encodeURIComponent(productId) + '&is_active=eq.true&select=id,user_id,title,price_cents,currency,slug&limit=1');
    if (!products || products.length === 0) {
      return res.status(404).json({ error: 'Product not found or unavailable' });
    }
    var product = products[0];

    if (!product.price_cents || product.price_cents <= 0) {
      return res.status(400).json({ error: 'This is a free product. Use the free claim flow.' });
    }

    // Load creator's stripe_account_id
    var profiles = await sbSelect('profiles?user_id=eq.' + encodeURIComponent(product.user_id) + '&select=stripe_account_id,username&limit=1');
    if (!profiles || profiles.length === 0 || !profiles[0].stripe_account_id) {
      return res.status(400).json({ error: 'Creator has not connected a payment account' });
    }
    var creator = profiles[0];

    // Verify product has at least one file
    var files = await sbSelect('digital_product_files?product_id=eq.' + encodeURIComponent(productId) + '&select=id&limit=1');
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'This product has no files yet' });
    }

    // Create Checkout Session via Stripe Connect
    var amountCents = Number(product.price_cents);
    var feeAmount = Math.floor(amountCents * (PLATFORM_FEE_BPS / 10000));

    var session = await stripeRequest('checkout/sessions', {
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: buyerEmail,
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
        metadata: {
          type: 'digital_product',
          product_id: product.id,
          creator_user_id: product.user_id,
          buyer_email: buyerEmail,
          marketing_consent: marketingConsent ? '1' : '0'
        }
      },
      metadata: {
        type: 'digital_product',
        product_id: product.id,
        creator_user_id: product.user_id,
        buyer_email: buyerEmail,
        marketing_consent: marketingConsent ? '1' : '0'
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: false
    });

    return res.status(200).json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error('digital-product-checkout error:', err);
    return res.status(500).json({ error: err.message || 'Could not create checkout session' });
  }
};
