// Vercel serverless function — handles free product claims (lead magnets).
// Skips Stripe entirely. Creates a digital_product_purchases row directly,
// sends a magic-link email to the buyer via Resend.
//
// POST /api/claim-free-product
// Body: { product_id, buyer_email, marketing_consent }
//
// Note: this function is invoked from the public landing page via
// `sb.functions.invoke('claim-free-product', ...)`. Because we use sb.functions.invoke,
// the path MUST match how Supabase Edge Functions would be called. To keep it
// simple, this function lives at /api/claim-free-product.js — but the public
// page hits Supabase Edge Functions, not this. So we need to ALSO deploy this
// as a Supabase Edge Function with the matching name.
//
// SIMPLER APPROACH: I'll change the public page to use fetch() for both flows.
// This file remains the canonical implementation.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

function getResendKey() {
  var k = process.env.RESEND_API_KEY;
  if (!k) throw new Error('RESEND_API_KEY not configured');
  return k;
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
    throw new Error('Supabase INSERT failed (' + res.status + '): ' + body);
  }
  var rows = await res.json();
  return rows && rows[0];
}

// Generate a Supabase magic-link OTP for the buyer's email.
// They click the link, are signed in, and land in /learn/.
async function generateMagicLink(email, redirectTo) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'magiclink',
      email: email,
      options: { redirect_to: redirectTo }
    })
  });
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data?.msg || data?.error_description || 'Could not generate magic link');
  }
  return data?.properties?.action_link || data?.action_link || null;
}

async function sendEmail(to, subject, html) {
  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + getResendKey(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Ryxa <hello@ryxa.io>',
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

function buildEmailHtml(productTitle, creatorName, magicLink) {
  return `<!DOCTYPE html>
<html>
<body style="background:#f5f5f7;margin:0;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    <tr><td style="padding:28px 28px 8px;">
      <div style="font-size:20px;font-weight:700;letter-spacing:-0.5px;">Your download is ready</div>
    </td></tr>
    <tr><td style="padding:8px 28px 4px;color:#444;font-size:15px;line-height:1.55;">
      <p style="margin:0 0 14px;">Thanks for grabbing <strong>${productTitle}</strong>${creatorName ? ' from ' + creatorName : ''}.</p>
      <p style="margin:0 0 18px;">Click the button below to access your download in your Ryxa Hub. The link will sign you in automatically.</p>
    </td></tr>
    <tr><td style="padding:8px 28px 24px;">
      <a href="${magicLink}" style="display:inline-block;padding:13px 26px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">Access your download</a>
    </td></tr>
    <tr><td style="padding:8px 28px 28px;color:#888;font-size:12px;line-height:1.6;">
      <p style="margin:0 0 8px;">If the button doesn't work, paste this link into your browser:</p>
      <p style="margin:0;word-break:break-all;color:#666;">${magicLink}</p>
    </td></tr>
  </table>
  <p style="text-align:center;color:#999;font-size:11px;margin:18px 0 0;">Sent by Ryxa · <a href="https://ryxa.io" style="color:#888;">ryxa.io</a></p>
</body>
</html>`;
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
    var productId = body.product_id;
    var buyerEmail = (body.buyer_email || '').trim().toLowerCase();
    var marketingConsent = !!body.marketing_consent;

    if (!productId || !buyerEmail) {
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

    if (product.price_cents && product.price_cents > 0) {
      return res.status(400).json({ error: 'This is a paid product. Use checkout instead.' });
    }

    // Verify product has at least one file
    var files = await sbSelect('digital_product_files?product_id=eq.' + encodeURIComponent(productId) + '&select=id&limit=1');
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'This product has no files yet' });
    }

    // Get creator name for email body
    var profiles = await sbSelect('profiles?user_id=eq.' + encodeURIComponent(product.user_id) + '&select=display_name,username&limit=1');
    var creatorName = '';
    if (profiles && profiles.length > 0) {
      creatorName = profiles[0].display_name || profiles[0].username || '';
    }

    // Check for an existing free purchase (idempotency)
    var existing = await sbSelect('digital_product_purchases?product_id=eq.' + encodeURIComponent(productId) + '&buyer_email=eq.' + encodeURIComponent(buyerEmail) + '&stripe_session_id=is.null&select=id&limit=1');
    if (!existing || existing.length === 0) {
      // Create the purchase row
      await sbInsert('digital_product_purchases', {
        product_id: productId,
        buyer_email: buyerEmail,
        stripe_session_id: null,
        amount_cents: 0,
        currency: product.currency || 'usd',
        status: 'completed',
        marketing_consent: marketingConsent
      });
    }
    // (If a row already exists, we silently re-send the email — same UX.)

    // Generate magic link to /learn/
    var redirectTo = 'https://ryxa.io/learn/?dp=' + product.id + '&purchased=1';
    var magicLink = await generateMagicLink(buyerEmail, redirectTo);
    if (!magicLink) {
      return res.status(500).json({ error: 'Could not generate access link' });
    }

    // Send email
    var subject = 'Your download — ' + product.title;
    var html = buildEmailHtml(product.title, creatorName, magicLink);
    await sendEmail(buyerEmail, subject, html);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('claim-free-product error:', err);
    return res.status(500).json({ error: err.message || 'Could not process claim' });
  }
};
