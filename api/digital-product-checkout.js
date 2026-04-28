// Vercel serverless function — creates a Stripe Checkout Session for a
// digital product. Uses Stripe Connect so payment goes directly to the
// creator's connected account.
//
// Buyer must be authenticated (matches courses pattern).
// On success, the webhook records the purchase using buyer_id from metadata.
//
// POST /api/digital-product-checkout
// Headers: Authorization: Bearer <buyer_access_token>
// Body: { product_id, marketing_consent, success_url, cancel_url }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTcxMzEsImV4cCI6MjA5MDg5MzEzMX0.VC8mcU5lUeA56kG2gHssvl88EVWr018XttA86jpfEn0';

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

const PLATFORM_FEE_BPS = 500;  // 5% platform fee

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
  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Verify buyer is signed in
    var buyer = await verifyBuyerJWT(req.headers.authorization || '');
    if (!buyer) {
      return res.status(401).json({ error: 'You must be signed in to checkout' });
    }

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

    // 6. Create Stripe Checkout Session via Connect
    var amountCents = Number(product.price_cents);
    var feeAmount = Math.floor(amountCents * (PLATFORM_FEE_BPS / 10000));

    var session = await stripeRequest('checkout/sessions', {
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: buyer.email,
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
          buyer_id: buyer.id,
          creator_user_id: product.user_id,
          marketing_consent: marketingConsent ? '1' : '0'
        }
      },
      metadata: {
        type: 'digital_product',
        product_id: product.id,
        buyer_id: buyer.id,
        creator_user_id: product.user_id,
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
