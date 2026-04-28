// Vercel serverless function — SSR landing page for digital products
// Renders /product/<slug> server-side with cache headers so a viral product
// doesn't melt the database. Cached at the CDN edge for 60s, can serve
// stale content for 5 minutes while revalidating in the background.
//
// Mirrors the bio.js SSR pattern.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTcxMzEsImV4cCI6MjA5MDg5MzEzMX0.VC8mcU5lUeA56kG2gHssvl88EVWr018XttA86jpfEn0';

// =============================================================
// Helpers
// =============================================================

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtPrice(cents, currency) {
  if (!cents || cents <= 0) return 'Free';
  var sym = (currency || 'usd').toLowerCase() === 'usd' ? '$' : '';
  return sym + (cents / 100).toFixed(2);
}

function notFoundResponse() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Product not found — Ryxa</title>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
body { margin:0; background:#0a0a14; color:#eee; font-family:'DM Sans',sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; text-align:center; }
h1 { font-family:'Syne',sans-serif; font-size:32px; font-weight:800; margin-bottom:12px; letter-spacing:-1px; }
p { color:rgba(255,255,255,0.55); font-size:15px; line-height:1.6; max-width:420px; margin:0 auto 24px; }
a { display:inline-block; padding:12px 26px; background:#7c3aed; color:#fff; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px; }
</style>
</head>
<body>
<div>
<h1>Product not found</h1>
<p>This product doesn't exist or has been taken down by the creator.</p>
<a href="https://ryxa.io">Visit Ryxa</a>
</div>
</body>
</html>`;
}

// =============================================================
// Main render
// =============================================================

function renderPage(product, creator) {
  var coverHtml = product.cover_image_url
    ? `<div class="cover" style="background-image:url('${esc(product.cover_image_url)}');"></div>`
    : `<div class="cover cover-default"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>`;

  var price = fmtPrice(product.price_cents, product.currency);
  var isFree = !product.price_cents || product.price_cents <= 0;
  var btnText = isFree ? 'Get for free' : 'Buy for ' + price;

  var creatorHandle = creator?.username ? '@' + creator.username : '';
  var creatorName = creator?.display_name || creator?.username || 'A creator';
  var avatarUrl = creator?.avatar_url || '';
  var avatarHtml = avatarUrl
    ? `<img src="${esc(avatarUrl)}" alt="" class="creator-avatar">`
    : `<div class="creator-avatar creator-avatar-default">${esc((creatorName[0] || 'R').toUpperCase())}</div>`;

  var description = product.description
    ? `<div class="description">${esc(product.description).replace(/\n/g, '<br>')}</div>`
    : '';

  // OG / Twitter card
  var ogImage = product.cover_image_url || 'https://ryxa.io/og-default.png';
  var pageTitle = esc(product.title) + ' — Ryxa';
  var pageDesc = product.description
    ? esc(String(product.description).slice(0, 160))
    : 'A digital product on Ryxa.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<title>${pageTitle}</title>
<meta name="description" content="${pageDesc}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(product.title)}">
<meta property="og:description" content="${pageDesc}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:url" content="https://ryxa.io/product/${esc(product.slug)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(product.title)}">
<meta name="twitter:description" content="${pageDesc}">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0a0a14; color:#eee; font-family:'DM Sans',sans-serif; min-height:100vh; line-height:1.5; }
  a { color:inherit; text-decoration:none; }

  .topbar { padding:16px 24px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:space-between; }
  .topbar-brand { font-family:'Syne',sans-serif; font-size:20px; font-weight:800; letter-spacing:-0.5px; }
  .topbar-link { font-size:13px; color:rgba(255,255,255,0.5); padding:8px 14px; border:1px solid rgba(255,255,255,0.1); border-radius:8px; transition:border-color 0.15s; }
  .topbar-link:hover { border-color:rgba(255,255,255,0.25); color:#fff; }

  .container { max-width:760px; margin:0 auto; padding:32px 24px 64px; }

  .cover { width:100%; aspect-ratio:16/9; background-size:cover; background-position:center; background-color:#16162a; border-radius:18px; margin-bottom:28px; box-shadow:0 20px 60px rgba(0,0,0,0.4); }
  .cover-default { background:linear-gradient(135deg,rgba(124,58,237,0.18),rgba(232,121,249,0.14)); display:flex; align-items:center; justify-content:center; }

  .title { font-family:'Syne',sans-serif; font-size:clamp(28px,5vw,44px); font-weight:800; letter-spacing:-1px; margin-bottom:16px; line-height:1.1; }

  .creator { display:flex; align-items:center; gap:10px; margin-bottom:28px; padding:12px 14px; background:#12121e; border:1px solid rgba(255,255,255,0.06); border-radius:12px; max-width:360px; transition:border-color 0.15s; }
  .creator:hover { border-color:rgba(255,255,255,0.15); }
  .creator-avatar { width:36px; height:36px; border-radius:50%; object-fit:cover; flex-shrink:0; }
  .creator-avatar-default { background:linear-gradient(135deg,#7c3aed,#a855f7); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:15px; }
  .creator-name { font-size:14px; font-weight:600; }
  .creator-handle { font-size:12px; color:rgba(255,255,255,0.45); }

  .description { font-size:15px; color:rgba(255,255,255,0.78); line-height:1.7; margin-bottom:32px; white-space:pre-wrap; word-wrap:break-word; }

  .checkout-box { background:#12121e; border:1px solid rgba(255,255,255,0.06); border-radius:14px; padding:22px; }
  .price-row { display:flex; align-items:baseline; gap:8px; margin-bottom:16px; }
  .price { font-family:'Syne',sans-serif; font-size:32px; font-weight:800; }
  .price-suffix { color:rgba(255,255,255,0.45); font-size:13px; }

  .email-input { width:100%; padding:12px 14px; background:#0a0a14; border:1px solid rgba(255,255,255,0.1); border-radius:10px; color:#eee; font-size:14px; font-family:'DM Sans',sans-serif; outline:none; margin-bottom:10px; }
  .email-input:focus { border-color:rgba(124,58,237,0.5); }

  .consent-row { display:flex; align-items:flex-start; gap:8px; margin-bottom:14px; font-size:12px; color:rgba(255,255,255,0.5); cursor:pointer; }
  .consent-row input { margin-top:2px; flex-shrink:0; }

  .buy-btn { width:100%; padding:14px; background:linear-gradient(135deg,#7c3aed,#a855f7); border:none; border-radius:10px; color:#fff; font-size:15px; font-weight:600; font-family:'DM Sans',sans-serif; cursor:pointer; box-shadow:0 4px 24px rgba(124,58,237,0.35); transition:transform 0.1s; }
  .buy-btn:hover:not(:disabled) { transform:translateY(-1px); }
  .buy-btn:disabled { opacity:0.6; cursor:not-allowed; transform:none; }

  .secure-row { display:flex; align-items:center; justify-content:center; gap:6px; margin-top:12px; font-size:11px; color:rgba(255,255,255,0.4); }

  .footer { text-align:center; padding:32px 16px 24px; font-size:12px; color:rgba(255,255,255,0.35); }
  .footer a { color:rgba(255,255,255,0.55); }

  .toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); padding:11px 18px; background:rgba(15,15,30,0.95); border:1px solid rgba(255,255,255,0.1); border-radius:10px; font-size:13px; max-width:90%; box-shadow:0 8px 32px rgba(0,0,0,0.4); display:none; backdrop-filter:blur(8px); z-index:99; }
  .toast.error { border-color:rgba(239,68,68,0.4); color:#fca5a5; }
  .toast.success { border-color:rgba(34,197,94,0.4); color:#86efac; }
</style>
</head>
<body>

<header class="topbar">
  <a href="https://ryxa.io" class="topbar-brand">Ryxa</a>
  <a href="https://ryxa.io" class="topbar-link">Sell digital products on Ryxa</a>
</header>

<main class="container">
  ${coverHtml}
  <h1 class="title">${esc(product.title)}</h1>

  ${creator?.username ? `<a href="https://ryxa.io/${esc(creator.username)}" class="creator">
    ${avatarHtml}
    <div>
      <div class="creator-name">${esc(creatorName)}</div>
      <div class="creator-handle">${esc(creatorHandle)}</div>
    </div>
  </a>` : ''}

  ${description}

  <div class="checkout-box">
    <div class="price-row">
      <div class="price">${price}</div>
      ${!isFree ? '<div class="price-suffix">one-time payment</div>' : ''}
    </div>

    <input type="email" id="buyer-email" class="email-input" placeholder="your@email.com" autocomplete="email" required>

    <label class="consent-row">
      <input type="checkbox" id="marketing-consent">
      <span>I'd like to receive updates from ${esc(creatorName)}</span>
    </label>

    <button type="button" id="buy-btn" class="buy-btn" onclick="checkout()">${btnText}</button>

    <div class="secure-row">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      ${isFree ? 'Instant access · Sent to your email' : 'Secure checkout via Stripe'}
    </div>
  </div>
</main>

<footer class="footer">
  <p>Powered by <a href="https://ryxa.io">Ryxa</a> · <a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a></p>
</footer>

<div id="toast" class="toast"></div>

<script>
const PRODUCT_ID = '${esc(product.id)}';
const PRODUCT_SLUG = '${esc(product.slug)}';
const IS_FREE = ${isFree ? 'true' : 'false'};

function showToast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + (type || '');
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 5000);
}

function isValidEmail(s) {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(s || ''));
}

async function checkout() {
  var email = (document.getElementById('buyer-email').value || '').trim().toLowerCase();
  var consent = document.getElementById('marketing-consent').checked;
  if (!isValidEmail(email)) {
    showToast('Please enter a valid email address', 'error');
    return;
  }

  var btn = document.getElementById('buy-btn');
  btn.disabled = true;
  btn.textContent = IS_FREE ? 'Sending download link...' : 'Loading checkout...';

  try {
    if (IS_FREE) {
      // Free flow: directly create purchase + email
      var resp = await fetch('/api/claim-free-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: PRODUCT_ID,
          buyer_email: email,
          marketing_consent: consent
        })
      });
      var data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Could not process request');
      }
      showToast("Sent! Check your email to access your download.", 'success');
      btn.textContent = 'Sent — check your inbox';
      // keep button disabled
      return;
    }

    // Paid flow: Stripe Checkout via Connect
    var resp = await fetch('/api/digital-product-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        buyer_email: email,
        marketing_consent: consent,
        success_url: window.location.origin + '/learn/?dp=' + PRODUCT_ID + '&purchased=1',
        cancel_url: window.location.href
      })
    });
    var data = await resp.json();
    if (!resp.ok || data.error) {
      throw new Error(data.error || 'Could not start checkout');
    }
    window.location.href = data.checkout_url;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '${btnText}';
    showToast(err.message || 'Something went wrong', 'error');
  }
}
</script>

</body>
</html>`;
}

// =============================================================
// Handler
// =============================================================

module.exports = async (req, res) => {
  // Extract slug from URL. Vercel rewrites /product/<slug> -> /api/product?slug=<slug>
  var slug = (req.query?.slug || '').trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(notFoundResponse());
  }

  try {
    // Fetch product (anon-readable for is_active=true)
    var prodRes = await fetch(SUPABASE_URL + '/rest/v1/digital_products?slug=eq.' + encodeURIComponent(slug) + '&is_active=eq.true&select=id,user_id,slug,title,description,cover_image_url,price_cents,currency,delivery_message&limit=1', {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      }
    });
    if (!prodRes.ok) throw new Error('Supabase error: ' + prodRes.status);
    var products = await prodRes.json();
    if (!products || products.length === 0) {
      res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(notFoundResponse());
    }
    var product = products[0];

    // Fetch creator profile for the byline
    var profRes = await fetch(SUPABASE_URL + '/rest/v1/profiles?user_id=eq.' + encodeURIComponent(product.user_id) + '&select=username,display_name,avatar_url&limit=1', {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      }
    });
    var creator = null;
    if (profRes.ok) {
      var profs = await profRes.json();
      if (profs && profs.length > 0) creator = profs[0];
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.send(renderPage(product, creator));
  } catch (err) {
    console.error('Product SSR error:', err);
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(notFoundResponse());
  }
};
