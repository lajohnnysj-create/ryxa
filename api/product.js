// Vercel serverless function — SSR landing page for digital products
// Renders /product/<slug> with cache headers so a viral product
// doesn't melt the database. Cached at the CDN edge for 60s.
//
// Buyer flow matches courses + coaching: must be signed in first.
// If not signed in, the buy/get button redirects to /learn/?redirect=<path>
// where they sign up or sign in, then come back here.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTcxMzEsImV4cCI6MjA5MDg5MzEzMX0.VC8mcU5lUeA56kG2gHssvl88EVWr018XttA86jpfEn0';

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
:root { --bg:#0a0a14; --surface:#12121e; --surface2:#16162a; --border:rgba(255,255,255,0.06); --border-hover:rgba(255,255,255,0.12); --text:#eee; --muted:rgba(255,255,255,0.45); --accent:#7c3aed; --accent2:#a855f7; --accent-glow:rgba(124,58,237,0.35); }
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
body { background:var(--bg); color:var(--text); font-family:'DM Sans',sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; text-align:center; }
h1 { font-family:'Syne',sans-serif; font-size:32px; font-weight:800; margin-bottom:12px; letter-spacing:-1px; }
p { color:var(--muted); font-size:15px; line-height:1.6; max-width:420px; margin:0 auto 24px; }
a.btn { display:inline-block; padding:12px 26px; background:var(--accent); color:#fff; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px; box-shadow:0 0 16px var(--accent-glow); }
</style>
</head>
<body>
<div>
<h1>Product not found</h1>
<p>This product doesn't exist or has been taken down by the creator.</p>
<a href="https://ryxa.io" class="btn">Back to Ryxa</a>
</div>
</body>
</html>`;
}

function renderPage(product, creator) {
  var creatorName = creator?.username || 'Creator';
  var price = fmtPrice(product.price_cents, product.currency);
  var isFree = !product.price_cents || product.price_cents <= 0;

  var coverHtml = product.cover_image_url
    ? `<img src="${esc(product.cover_image_url)}" alt="" class="dp-cover">`
    : `<div class="dp-cover-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>`;

  var description = product.description
    ? `<div class="dp-desc">${esc(product.description).replace(/\n/g, '<br>')}</div>`
    : '';

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
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<style>
  :root { --bg:#0a0a14; --surface:#12121e; --surface2:#16162a; --border:rgba(255,255,255,0.06); --border-hover:rgba(255,255,255,0.12); --text:#eee; --muted:rgba(255,255,255,0.45); --accent:#7c3aed; --accent2:#a855f7; --accent-glow:rgba(124,58,237,0.35); }
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:'DM Sans',sans-serif; min-height:100vh; line-height:1.5; }
  a { color:inherit; text-decoration:none; }

  /* Nav — matches course/booking pages */
  .nav { padding:16px 32px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border); position:relative; }
  .nav-logo { display:flex; align-items:center; gap:8px; text-decoration:none; color:var(--text); font-family:'Syne',sans-serif; font-size:20px; font-weight:800; letter-spacing:-0.4px; }
  .nav-logo img { width:28px; height:28px; border-radius:6px; }
  .nav-right { display:flex; gap:10px; align-items:center; }

  /* Signed-in chip */
  .signin-chip { display:none; align-items:center; gap:8px; padding:7px 12px; background:var(--surface); border:1px solid var(--border-hover); border-radius:999px; font-size:12px; color:var(--muted); cursor:pointer; transition:border-color 0.15s, color 0.15s; }
  .signin-chip:hover { border-color:var(--accent); color:var(--text); }
  .signin-chip-avatar { width:20px; height:20px; border-radius:50%; background:linear-gradient(135deg,var(--accent),var(--accent2)); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:10px; flex-shrink:0; }
  .signin-chip-email { max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .signin-popover { display:none; position:absolute; top:62px; right:32px; background:var(--surface); border:1px solid var(--border-hover); border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,0.4); z-index:50; min-width:240px; overflow:hidden; }
  .signin-popover-email { padding:14px 16px 12px; border-bottom:1px solid var(--border); font-size:13px; color:var(--muted); }
  .signin-popover-email strong { display:block; color:var(--text); font-weight:600; margin-top:2px; word-break:break-all; }
  .signin-popover-btn { width:100%; padding:11px 16px; background:transparent; border:none; color:var(--text); font-size:13px; font-family:'DM Sans',sans-serif; cursor:pointer; text-align:left; display:flex; align-items:center; gap:8px; transition:background 0.15s; }
  .signin-popover-btn:hover { background:rgba(124,58,237,0.08); }
  .signin-popover-btn.danger { color:#fca5a5; }
  .signin-popover-btn.danger:hover { background:rgba(239,68,68,0.08); }

  /* Hero */
  .dp-hero { max-width:960px; margin:0 auto; padding:48px 32px; }
  .dp-cover { width:100%; max-height:400px; object-fit:cover; border-radius:16px; margin-bottom:32px; border:1px solid var(--border); display:block; }
  .dp-cover-placeholder { width:100%; height:240px; background:linear-gradient(135deg,rgba(124,58,237,0.15),rgba(232,121,249,0.1)); border-radius:16px; margin-bottom:32px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border); }
  .dp-title { font-family:'Syne',sans-serif; font-size:clamp(28px,5vw,44px); font-weight:800; letter-spacing:-1.5px; line-height:1.1; margin-bottom:16px; }
  .dp-creator { font-size:14px; color:var(--muted); margin-bottom:24px; }
  .dp-creator strong { color:var(--accent2); font-weight:600; }
  .dp-desc { font-size:16px; line-height:1.75; color:var(--muted); margin-bottom:32px; max-width:700px; white-space:pre-wrap; word-wrap:break-word; }

  /* Buy card — matches course page */
  .dp-buy-card { background:var(--surface2); border:1px solid var(--border); border-radius:16px; padding:28px; margin-bottom:24px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; }
  .dp-price { font-family:'Syne',sans-serif; font-size:32px; font-weight:800; letter-spacing:-1px; }
  .dp-price-free { color:#4ade80; }
  .dp-buy-btn { padding:14px 36px; background:linear-gradient(135deg,#a78bfa,#e879f9); color:#fff; border:none; border-radius:10px; font-size:16px; font-weight:600; font-family:'DM Sans',sans-serif; cursor:pointer; box-shadow:0 4px 24px rgba(167,139,250,0.3); transition:all 0.2s; }
  .dp-buy-btn:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 6px 30px rgba(167,139,250,0.4); }
  .dp-buy-btn:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
  .dp-purchased-badge { padding:12px 24px; background:rgba(74,222,128,0.1); border:1px solid rgba(74,222,128,0.3); border-radius:10px; color:#4ade80; font-size:14px; font-weight:600; display:inline-flex; align-items:center; gap:8px; text-decoration:none; }

  /* Consent */
  .dp-consent { display:flex; align-items:center; gap:8px; margin-top:8px; cursor:pointer; font-size:13px; color:var(--muted); }
  .dp-consent input { accent-color:var(--accent); width:16px; height:16px; cursor:pointer; }

  /* Footer */
  .dp-footer { text-align:center; padding:32px; border-top:1px solid var(--border); }
  .dp-footer a { color:var(--muted); text-decoration:none; font-size:12px; }
  .dp-footer a:hover { color:var(--text); }

  .toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); padding:11px 18px; background:rgba(15,15,30,0.95); border:1px solid rgba(255,255,255,0.1); border-radius:10px; font-size:13px; max-width:90%; box-shadow:0 8px 32px rgba(0,0,0,0.4); display:none; backdrop-filter:blur(8px); z-index:99; }
  .toast.error { border-color:rgba(239,68,68,0.4); color:#fca5a5; }
  .toast.success { border-color:rgba(34,197,94,0.4); color:#86efac; }

  @media (max-width:640px) {
    .nav { padding:12px 16px; }
    .signin-popover { right:16px; }
    .dp-hero { padding:32px 16px; }
    .dp-buy-card { flex-direction:column; text-align:center; align-items:stretch; }
    .dp-buy-btn { width:100%; }
    .signin-chip-email { max-width:100px; }
  }
</style>
</head>
<body>

<nav class="nav">
  <a href="/" class="nav-logo"><img src="/logo.png" alt="Ryxa"> Ryxa</a>
  <div class="nav-right">
    <button id="signin-chip" class="signin-chip" type="button" onclick="toggleSigninPopover(event)">
      <span class="signin-chip-avatar" id="signin-chip-avatar">U</span>
      <span class="signin-chip-email" id="signin-chip-email"></span>
    </button>
  </div>
  <div id="signin-popover" class="signin-popover">
    <div class="signin-popover-email">
      Signed in as
      <strong id="signin-popover-email"></strong>
    </div>
    <a href="/learn/" class="signin-popover-btn" style="text-decoration:none;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      Ryxa Hub
    </a>
    <button class="signin-popover-btn danger" onclick="signOutAndReload()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      Sign out
    </button>
  </div>
</nav>

<section class="dp-hero">
  ${coverHtml}
  <h1 class="dp-title">${esc(product.title)}</h1>
  <div class="dp-creator">by <a href="/${esc(creatorName)}" style="color:inherit;text-decoration:none;"><strong>${esc(creatorName)}</strong></a></div>
  ${description}

  <div class="dp-buy-card">
    <div class="dp-price">${isFree ? '<span class="dp-price-free">Free</span>' : esc(price)}</div>
    <div id="dp-buy-area">
      <button id="buy-btn" class="dp-buy-btn" onclick="handleBuyClick()">${isFree ? 'Get for free' : 'Buy now'}</button>
    </div>
  </div>
  <label class="dp-consent" id="consent-row" style="display:none;">
    <input type="checkbox" id="marketing-consent">
    <span>Get updates from this creator</span>
  </label>
</section>

<footer class="dp-footer">
  <a href="/">Powered by Ryxa</a>
</footer>

<div id="toast" class="toast"></div>

<script>
const PRODUCT_ID = '${esc(product.id)}';
const PRODUCT_SLUG = '${esc(product.slug)}';
const IS_FREE = ${isFree ? 'true' : 'false'};
const SUPABASE_URL = '${SUPABASE_URL}';
const SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function showToast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + (type || '');
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 5000);
}

// Signed-in indicator
function toggleSigninPopover(evt) {
  if (evt) evt.stopPropagation();
  var pop = document.getElementById('signin-popover');
  pop.style.display = pop.style.display === 'block' ? 'none' : 'block';
}
document.addEventListener('click', function(e) {
  var pop = document.getElementById('signin-popover');
  var chip = document.getElementById('signin-chip');
  if (pop.style.display === 'block' && !pop.contains(e.target) && !chip.contains(e.target)) {
    pop.style.display = 'none';
  }
});

async function signOutAndReload() {
  await sb.auth.signOut();
  window.location.reload();
}

// On load: detect existing session, update UI
async function init() {
  try {
    var { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      var email = session.user.email || '';
      document.getElementById('signin-chip-email').textContent = email;
      document.getElementById('signin-chip-avatar').textContent = (email[0] || 'U').toUpperCase();
      document.getElementById('signin-chip').style.display = 'inline-flex';
      document.getElementById('signin-popover-email').textContent = email;
      document.getElementById('consent-row').style.display = 'flex';

      // If already purchased, swap button for "Go to Ryxa Hub" link
      try {
        var { data: existing } = await sb.from('digital_product_purchases')
          .select('id')
          .eq('product_id', PRODUCT_ID)
          .eq('buyer_user_id', session.user.id)
          .limit(1);
        if (existing && existing.length > 0) {
          document.getElementById('dp-buy-area').innerHTML = '<a href="/learn/?dp=' + PRODUCT_ID + '" class="dp-purchased-badge"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Go to your download</a>';
          document.getElementById('consent-row').style.display = 'none';
        }
      } catch (e) { /* non-fatal */ }
    }
  } catch (e) {
    console.error('Session check failed:', e);
  }
}
init();

async function handleBuyClick() {
  var { data: { session } } = await sb.auth.getSession();
  if (!session?.user) {
    window.location.href = '/learn/?redirect=' + encodeURIComponent(window.location.pathname);
    return;
  }

  var consentEl = document.getElementById('marketing-consent');
  var consent = consentEl ? consentEl.checked : false;
  var btn = document.getElementById('buy-btn');
  btn.disabled = true;
  btn.textContent = IS_FREE ? 'Processing...' : 'Loading checkout...';

  try {
    if (IS_FREE) {
      var resp = await fetch('/api/claim-free-product', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token
        },
        body: JSON.stringify({
          product_id: PRODUCT_ID,
          marketing_consent: consent
        })
      });
      var data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Could not process request');
      }
      window.location.href = '/learn/?dp=' + PRODUCT_ID + '&purchased=1';
      return;
    }

    var resp = await fetch('/api/digital-product-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      },
      body: JSON.stringify({
        product_id: PRODUCT_ID,
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
    btn.textContent = IS_FREE ? 'Get for free' : 'Buy now';
    showToast(err.message || 'Something went wrong', 'error');
  }
}
</script>

</body>
</html>`;
}

module.exports = async (req, res) => {
  var slug = (req.query?.slug || '').trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(notFoundResponse());
  }

  try {
    var prodRes = await fetch(SUPABASE_URL + '/rest/v1/digital_products?slug=eq.' + encodeURIComponent(slug) + '&is_active=eq.true&select=id,user_id,slug,title,description,cover_image_url,price_cents,currency,delivery_message&limit=1', {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
    });
    if (!prodRes.ok) throw new Error('Supabase error: ' + prodRes.status);
    var products = await prodRes.json();
    if (!products || products.length === 0) {
      res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(notFoundResponse());
    }
    var product = products[0];

    var profRes = await fetch(SUPABASE_URL + '/rest/v1/profiles?user_id=eq.' + encodeURIComponent(product.user_id) + '&select=username&limit=1', {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
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
