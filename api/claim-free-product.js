// Vercel serverless function — handles free product claims (lead magnets).
// Requires the buyer to be authenticated (matches courses pattern).
// Skips Stripe entirely. Creates a digital_product_purchases row directly,
// then redirects buyer to /learn/ where they see their purchase.
//
// POST /api/claim-free-product
// Headers: Authorization: Bearer <buyer_access_token>
// Body: { product_id, marketing_consent }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTcxMzEsImV4cCI6MjA5MDg5MzEzMX0.VC8mcU5lUeA56kG2gHssvl88EVWr018XttA86jpfEn0';

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

function getResendKey() {
  return process.env.RESEND_API_KEY || '';
}

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

async function sbInsert(table, row) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    var err = new Error('Supabase INSERT failed (' + res.status + '): ' + body);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  var rows = await res.json();
  return rows && rows[0];
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

async function sendEmail(to, subject, html) {
  var key = getResendKey();
  if (!key) {
    console.warn('RESEND_API_KEY not set — skipping email');
    return;
  }
  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Ryxa <no-reply@ryxa.io>',
      to: [to],
      subject: subject,
      html: html
    })
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    throw new Error('Resend error (' + res.status + '): ' + body);
  }
}

function buildBuyerEmailHtml(productTitle, creatorName) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      <div style="text-align:center;margin-bottom:24px;">
        <img src="https://www.ryxa.io/logo.png" alt="Ryxa" width="36" height="36" style="border-radius:8px;">
      </div>
      <h1 style="font-size:22px;font-weight:700;text-align:center;margin-bottom:8px;color:#111;">Your download is ready</h1>
      <p style="font-size:15px;color:#555;text-align:center;margin-bottom:24px;">Thanks for grabbing this${creatorName ? ' from ' + creatorName : ''}!</p>
      <div style="background:#f8f8f8;border:1px solid #e5e5e5;border-radius:12px;padding:20px;margin-bottom:24px;">
        <div style="font-size:16px;font-weight:600;color:#111;margin-bottom:4px;">${productTitle}</div>
        <div style="font-size:14px;color:#666;">Free</div>
      </div>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="https://ryxa.io/learn/" style="display:inline-block;padding:12px 28px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">Go to Ryxa Hub</a>
      </div>
      <p style="font-size:12px;color:#999;text-align:center;">Your downloads are always available in your <a href="https://ryxa.io/learn/" style="color:#7c3aed;">Ryxa Hub</a>.</p>
    </div>`;
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
    // 1. Verify buyer is authenticated
    var buyer = await verifyBuyerJWT(req.headers.authorization || '');
    if (!buyer) {
      return res.status(401).json({ error: 'You must be signed in to claim this' });
    }

    // 2. Parse body
    var body = req.body || {};
    var productId = body.product_id;
    var marketingConsent = !!body.marketing_consent;

    if (!productId) {
      return res.status(400).json({ error: 'Missing product_id' });
    }

    // 3. Load product
    var products = await sbSelect('digital_products?id=eq.' + encodeURIComponent(productId) + '&is_active=eq.true&select=id,user_id,title,price_cents,currency,slug&limit=1');
    if (!products || products.length === 0) {
      return res.status(404).json({ error: 'Product not found or unavailable' });
    }
    var product = products[0];

    if (product.price_cents && product.price_cents > 0) {
      return res.status(400).json({ error: 'This is a paid product. Use checkout instead.' });
    }

    // 4. Verify product has at least one file
    var files = await sbSelect('digital_product_files?product_id=eq.' + encodeURIComponent(productId) + '&select=id&limit=1');
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'This product has no files yet' });
    }

    // 5. Check for an existing free purchase by this buyer (idempotency)
    var existing = await sbSelect('digital_product_purchases?product_id=eq.' + encodeURIComponent(productId) + '&buyer_user_id=eq.' + encodeURIComponent(buyer.id) + '&select=id&limit=1');
    if (existing && existing.length > 0) {
      // Already claimed — that's fine, return success
      return res.status(200).json({ ok: true, already_claimed: true });
    }

    // 6. Create purchase row
    try {
      await sbInsert('digital_product_purchases', {
        product_id: productId,
        buyer_user_id: buyer.id,
        buyer_email: buyer.email,
        stripe_session_id: null,
        amount_cents: 0,
        currency: product.currency || 'usd',
        status: 'completed',
        marketing_consent: marketingConsent
      });
    } catch (insErr) {
      // Catch unique-constraint violation (duplicate by email + product) gracefully
      if (insErr.status === 409 || (insErr.body || '').includes('duplicate')) {
        return res.status(200).json({ ok: true, already_claimed: true });
      }
      throw insErr;
    }

    // 7. Look up creator name (for email)
    var profiles = await sbSelect('profiles?user_id=eq.' + encodeURIComponent(product.user_id) + '&select=username&limit=1');
    var creatorName = '';
    if (profiles && profiles.length > 0) {
      creatorName = profiles[0].username || '';
    }

    // 8. Send confirmation email (best-effort — don't fail the request)
    try {
      var html = buildBuyerEmailHtml(product.title, creatorName);
      await sendEmail(buyer.email, 'Your download — ' + product.title, html);
    } catch (emailErr) {
      console.error('Email send failed (non-fatal):', emailErr);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('claim-free-product error:', err);
    return res.status(500).json({ error: err.message || 'Could not process claim' });
  }
};
