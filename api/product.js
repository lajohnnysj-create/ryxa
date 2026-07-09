// Vercel serverless function — SSR landing page for digital products
// Renders /product/<slug> with cache headers so a viral product
// doesn't melt the database. Cached at the CDN edge for 60s.
//
// Buyer flow matches courses + coaching: must be signed in first.
// If not signed in, the buy/get button redirects to /learn/?redirect=<path>
// where they sign up or sign in, then come back here.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

// Server-side DOMPurify (runs in Node via JSDOM). Used to sanitize the
// rich-text description before injecting into the HTML response. Same
// security model as the courses/learn pages, applied at the SSR boundary.
const DOMPurify = require('isomorphic-dompurify');

// Class-whitelist hook for the rich-text description. Same defense-in-depth
// pattern as the client side (course-page.js, booking-page.js, learn-page.js):
// only the three lesson-img-size-* classes survive sanitization. Anything
// else gets stripped. Also defaults missing alt attrs on <img> to empty
// string for WCAG compliance.
//
// Module-scope idempotency: Vercel warm invocations reuse this module
// instance, and DOMPurify.addHook stacks listeners. The _ryxaHookInstalled
// guard ensures we install at most one hook per Node process lifetime.
const ALLOWED_DESC_CLASSES = { 'lesson-img-size-small': 1, 'lesson-img-size-medium': 1, 'lesson-img-size-large': 1 };
if (!DOMPurify._ryxaHookInstalled) {
  DOMPurify._ryxaHookInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', function(node) {
    if (node.hasAttribute && node.hasAttribute('class')) {
      var classes = (node.getAttribute('class') || '').split(/\s+/).filter(function(c) {
        return c && ALLOWED_DESC_CLASSES[c];
      });
      if (classes.length) {
        node.setAttribute('class', classes.join(' '));
      } else {
        node.removeAttribute('class');
      }
    }
    if (node.tagName === 'IMG' && !node.hasAttribute('alt')) {
      node.setAttribute('alt', '');
    }
  });
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Sanitize rich-text product description. Same cleanups as courses + learn:
// trim whitespace in block tags, drop empty paragraph spacers ('<p><br></p>'),
// unwrap href-less <a> tags, force external links to open in a new tab with
// rel=noopener noreferrer. Returns sanitized HTML safe to inject directly
// into the SSR response. Returns empty string if input is empty/null.
function sanitizeDescription(html) {
  if (!html) return '';
  var cleaned = String(html);
  cleaned = cleaned.replace(/(\s+)<\/(p|h2|h3|li)>/g, '</$2>');
  cleaned = cleaned.replace(/<(p|h2|h3|li)([^>]*)>\s+/g, '<$1$2>');
  cleaned = cleaned.replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, '');
  cleaned = cleaned.replace(/<p>\s*<\/p>/gi, '');
  cleaned = cleaned.replace(/<a(?:\s+(?!href=)[^>]*)?>(.*?)<\/a>/gi, '$1');
  cleaned = cleaned.replace(/<a\s+href=["']?["']?\s*>(.*?)<\/a>/gi, '$1');
  var safe = DOMPurify.sanitize(cleaned, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'h2', 'h3', 'ul', 'ol', 'li', 'img', 'span'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i
  });
  // Force external links to open in a new tab with safe rel. The client-side
  // sanitizers do this via DOM mutation; on the server we do it via string
  // replace since we're emitting HTML directly.
  safe = safe.replace(/<a\s+href="(https?:[^"]+)"([^>]*)>/gi, function(m, href, rest) {
    if (/\btarget=/i.test(rest)) return m;
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer"' + rest + '>';
  });
  return safe;
}

// Strip all HTML tags and collapse whitespace. Used for meta description
// and OG tags where plain text is required.
function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
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
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Plus+Jakarta+Sans:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root { --bg:#0a0a14; --surface:#12121e; --surface2:#16162a; --border:rgba(255,255,255,0.06); --border-hover:rgba(255,255,255,0.12); --text:#f0eef8; --text-secondary:#fff; --muted:#b4b2c8; --accent:#7c3aed; --accent2:#a855f7; --accent-glow:rgba(124,58,237,0.35); }
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
body { background:var(--bg); color:var(--text); font-family:'DM Sans',sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; text-align:center; }
h1 { font-family:'Plus Jakarta Sans',sans-serif; font-size:32px; font-weight:800; margin-bottom:12px; letter-spacing:-1px; }
p { color:var(--text-secondary); font-size:15px; line-height:1.6; max-width:420px; margin:0 auto 24px; }
a.btn { display:inline-block; padding:12px 26px; background:var(--accent); color:#fff; border-radius:10px; text-decoration:none; font-weight:600; font-size:14px; box-shadow:0 0 16px var(--accent-glow); }
</style>
</head>
<body>
<div>
<h1>Product not found</h1>
<p>This product doesn't exist or has been taken down by the creator.</p>
<a href="https://ryxa.io" class="btn">Back to Ryxa</a>
</div>
<script src="/cookie-banner.js"></script>
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
    ? `<div class="dp-desc">${sanitizeDescription(product.description)}</div>`
    : '';

  var ogImage = product.cover_image_url || 'https://ryxa.io/og-default.png';
  var pageTitle = esc(product.title) + ' - Ryxa';
  // Meta description must be plain text (no HTML). Strip tags from the
  // rich-text product description, then trim to 160 chars (standard SEO
  // length). Falls back to a generic blurb if description is empty.
  var pageDesc = product.description
    ? esc(stripTags(product.description).slice(0, 160))
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
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Plus+Jakarta+Sans:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.4/dist/umd/supabase.js" integrity="sha384-7SfFUrg31wOnGWBLLniKFCNmCSguYA5wI1WPDOt7kP/mom4R9/0pwghVEnv0uwYP" crossorigin="anonymous"></script>
<style>
  :root { --bg:#0a0a14; --surface:#12121e; --surface2:#16162a; --border:rgba(255,255,255,0.06); --border-hover:rgba(255,255,255,0.12); --text:#f0eef8; --text-secondary:#fff; --muted:#b4b2c8; --accent:#7c3aed; --accent2:#a855f7; --accent-glow:rgba(124,58,237,0.35); }
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
  .dp-hero { max-width:720px; margin:0 auto; padding:48px 24px; }
  .dp-cover { width:100%; max-height:400px; object-fit:cover; border-radius:16px; margin-bottom:32px; border:1px solid var(--border); display:block; }
  .dp-cover-placeholder { width:100%; height:240px; background:linear-gradient(135deg,rgba(124,58,237,0.15),rgba(232,121,249,0.1)); border-radius:16px; margin-bottom:32px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border); }
  .dp-title { font-family:'Plus Jakarta Sans',sans-serif; font-size:clamp(28px,5vw,44px); font-weight:800; letter-spacing:-1.5px; line-height:1.1; margin-bottom:16px; }
  .dp-creator { font-size:14px; color:var(--text-secondary); margin-bottom:24px; }
  .dp-creator strong { color:var(--accent2); font-weight:600; }
  .dp-desc { font-size:16px; line-height:1.75; color:var(--text-secondary); margin-bottom:32px; word-wrap:break-word; }
  /* Rich-text elements inside the description (set by the dashboard's Quill
     editor). Spacing tuned for landing-page readability. Mirrors the same
     pattern courses/index.html uses. */
  .dp-desc p { margin:0 0 14px; }
  .dp-desc p:last-child { margin-bottom:0; }
  .dp-desc h2 { font-family:'Plus Jakarta Sans',sans-serif; font-size:22px; font-weight:700; letter-spacing:-0.3px; color:var(--text); margin:24px 0 10px; }
  .dp-desc h3 { font-family:'Plus Jakarta Sans',sans-serif; font-size:18px; font-weight:700; color:var(--text); margin:20px 0 8px; }
  .dp-desc ul, .dp-desc ol { margin:0 0 14px; padding-left:22px; }
  .dp-desc li { margin-bottom:6px; }
  .dp-desc strong { color:var(--text); font-weight:600; }
  .dp-desc a { color:var(--accent2); text-decoration:underline; }
  .dp-desc a:hover { color:var(--accent); }
  /* Images inserted via the dashboard's Quill editor. The S/M/L size class
     is set in the editor and mirrors the same selectors used by the course
     landing page (course/index.html), the booking landing page
     (booking/index.html), and the Hub lesson renderer (learn/index.html).
     Baseline rules cap any untagged image to 100% so a missing class
     doesn't blow out the column. */
  .dp-desc img { max-width:100%; height:auto; display:block; margin:14px 0; border-radius:8px; }
  .dp-desc img.lesson-img-size-small { max-width:30%; width:30%; }
  .dp-desc img.lesson-img-size-medium { max-width:60%; width:60%; }
  .dp-desc img.lesson-img-size-large { max-width:100%; width:100%; }

  /* Buy card — matches course page */
  .dp-buy-card { margin-bottom:24px; }
  .dp-price { font-family:'Plus Jakarta Sans',sans-serif; font-size:32px; font-weight:800; letter-spacing:-1px; margin-bottom:20px; }
  .dp-price-free { color:#4ade80; }
  .dp-buy-btn { width:100%; padding:16px; background:var(--accent); color:#fff; border:none; border-radius:12px; font-size:16px; font-weight:600; font-family:'DM Sans',sans-serif; cursor:pointer; transition:opacity 0.15s; }
  .dp-buy-btn:hover:not(:disabled) { opacity:0.9; }
  .dp-buy-btn:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
  .dp-purchased-badge { padding:12px 24px; background:rgba(74,222,128,0.1); border:1px solid rgba(74,222,128,0.3); border-radius:10px; color:#4ade80; font-size:14px; font-weight:600; display:inline-flex; align-items:center; gap:8px; text-decoration:none; }

  /* Consent */
  .dp-consent { display:flex; align-items:center; gap:8px; margin-top:8px; cursor:pointer; font-size:13px; color:var(--text-secondary); }
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
  <!-- Not a link, on purpose. The wordmark is a trust signal for a buyer about
       to enter a card on an unfamiliar domain, and it puts Ryxa in front of a
       creator audience. But linking it to ryxa.io sends a buyer mid-purchase to
       a page selling the platform to creators, which is the worst possible
       destination. Keep the mark, remove the exit. -->
  <div class="nav-logo"><img src="/logo.png" alt="Ryxa"> Ryxa</div>
  <div class="nav-right">
    <button id="signin-chip" class="signin-chip" type="button" data-product-action="toggle-signin-popover">
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
    <button class="signin-popover-btn danger" data-product-action="signout">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      Sign out
    </button>
  </div>
</nav>

<section class="dp-hero">
  ${coverHtml}
  <h1 class="dp-title">${esc(product.title)}</h1>
  <div class="dp-creator">by <a href="/${esc(creatorName)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;"><strong>${esc(creatorName)}</strong></a></div>
  ${description}

  <div class="dp-buy-card">
    <div class="dp-price">${isFree ? '<span class="dp-price-free">Free</span>' : esc(price)}</div>
    <div id="dp-buy-area">
      <button id="buy-btn" class="dp-buy-btn" data-product-action="buy">${isFree ? 'Get for free' : 'Get instant access'}</button>
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

<meta name="ryxa-product-id" content="${esc(product.id)}">
<meta name="ryxa-product-slug" content="${esc(product.slug)}">
<meta name="ryxa-product-is-free" content="${isFree ? 'true' : 'false'}">
<meta name="ryxa-product-creator-name" content="${esc(creatorName)}">
<script src="/js/product-page.js" defer></script>
<script src="/cookie-banner.js"></script>

</body>
</html>`;
}

module.exports = async (req, res) => {
  // Per-IP rate limit: 60 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'product-data', 60, 60000)) return;

  // Content Security Policy — ENFORCED. Product landing pages are PUBLIC and
  // render seller-supplied content (title, description, images). Strict CSP
  // defends against XSS via injected <script> in product fields.
  // To roll back to Report-Only mode (if breakage is reported), change the
  // header name below from 'Content-Security-Policy' to
  // 'Content-Security-Policy-Report-Only'.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://www.ryxa.io https://kjytapcgxukalwsyputk.supabase.co",
    "connect-src 'self' https://kjytapcgxukalwsyputk.supabase.co https://cdn.jsdelivr.net",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));

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

    var profRes = await fetch(SUPABASE_URL + '/rest/v1/public_profiles?user_id=eq.' + encodeURIComponent(product.user_id) + '&select=username&limit=1', {
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
