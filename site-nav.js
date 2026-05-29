// site-nav.js — Shared header and footer for ryxa.io
// Usage: Add <div id="site-header"></div> and <div id="site-footer"></div> to any page
// Then include: <script src="/site-nav.js"></script> before closing </body>
// For active page highlighting, add data-page attribute to #site-header:
//   <div id="site-header" data-page="pricing"></div>

(function() {

// =====================
// INJECT FONT
// =====================
// site-nav uses Syne for the nav logo + footer headings. Some host pages
// (e.g. tools-link-in-bio.html) don't load Syne in their own font URL, so
// the nav/footer would fall back to system sans on devices without Syne in
// browser cache. Inject our own Syne link so we're self-sufficient and the
// branding looks identical across every page that uses site-nav.
// Idempotent: skipped if a Syne link is already present in <head>.
if (!document.querySelector('link[href*="family=Syne"]')) {
  // Preconnect helps the font request start as early as possible.
  if (!document.querySelector('link[rel="preconnect"][href*="fonts.gstatic.com"]')) {
    var pre1 = document.createElement('link');
    pre1.rel = 'preconnect';
    pre1.href = 'https://fonts.googleapis.com';
    document.head.appendChild(pre1);
    var pre2 = document.createElement('link');
    pre2.rel = 'preconnect';
    pre2.href = 'https://fonts.gstatic.com';
    pre2.crossOrigin = 'anonymous';
    document.head.appendChild(pre2);
  }
  var syneLink = document.createElement('link');
  syneLink.rel = 'stylesheet';
  // display=swap so the rest of the page renders immediately with a
  // fallback font, then upgrades to Syne when it arrives. No blocking.
  syneLink.href = 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap';
  document.head.appendChild(syneLink);
}

// =====================
// INJECT STYLES
// =====================
var style = document.createElement('style');
style.textContent = ''
  // Self-contained nav theme. The nav defines its OWN variables so it never
  // inherits (or is broken by) the host page's theme. The --nav-* names are
  // unique, so defining them on :root affects nothing but this nav/footer.
  + ':root{--nav-bg:#07070f;--nav-text:#f0eef8;--nav-accent:#7c3aed;--nav-accent2:#a855f7;--nav-border:rgba(255,255,255,0.07);--nav-border-hover:rgba(255,255,255,0.14);--nav-muted:#b4b2c8;}'
  // Skip link
  + '.skip-link{position:absolute;top:-100%;left:16px;z-index:9999;background:var(--nav-accent);color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;font-family:"DM Sans",sans-serif;text-decoration:none;transition:top 0.2s ease;box-shadow:0 4px 12px rgba(0,0,0,0.4);}'
  + '.skip-link:focus{top:12px;outline:2px solid #c4b5fd;outline-offset:2px;}'
  // Anti-flash: reserve space
  + '#site-header{min-height:80px;}'
  + '#site-footer{min-height:200px;background:#07070f;color:#f0eef8;}#site-footer p a{transition:color 0.2s;}#site-footer p a:hover{color:#f0eef8 !important;}'
  // Nav - single centered floating pill. The <nav> is a transparent fixed
  // wrapper that centers one pill containing logo, links, and buttons.
  + 'nav{position:fixed;top:0;left:0;right:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:20px 24px 14px;background:transparent;pointer-events:none;transition:transform 0.32s ease;}'
  + 'nav.nav-hidden{transform:translateY(-130%);}'
  + '@media(prefers-reduced-motion:reduce){nav{transition:none;}}'
  + '.nav-pill{pointer-events:auto;background:#000000;border:1px solid rgba(255,255,255,0.10);border-radius:100px;box-shadow:0 8px 32px rgba(0,0,0,0.35);display:flex;align-items:center;gap:30px;padding:8px 8px 8px 22px;}'
  + '.logo img{width:30px;height:30px;object-fit:contain;}'
  + '.logo{font-family:"Syne",sans-serif;font-weight:800;font-size:21px;letter-spacing:-0.5px;display:flex;align-items:center;gap:9px;text-decoration:none;color:var(--nav-text);}'
  + '.nav-links{display:flex;align-items:center;gap:26px;}'
  + '.nav-links a{color:rgba(255,255,255,0.72);font-size:15px;font-weight:500;font-family:"DM Sans",sans-serif;letter-spacing:0.01em;text-decoration:none;transition:color 0.2s;}'
  + '.nav-links a:hover{color:var(--nav-text);}'
  + '.nav-right{display:flex;align-items:center;gap:10px;}'
  + '.btn-ghost{background:transparent;border:none;color:rgba(255,255,255,0.72);border-radius:100px;padding:9px 14px;font-size:14px;font-weight:500;font-family:"DM Sans",sans-serif;cursor:pointer;transition:color 0.2s;}'
  + '.btn-ghost:hover{color:var(--nav-text);}'
  + '.btn-nav-cta{background:#fff;color:#14111c;border:none;border-radius:100px;padding:10px 22px;font-size:14px;font-weight:600;font-family:"DM Sans",sans-serif;cursor:pointer;transition:transform 0.2s;}'
  + '.btn-nav-cta:hover{transform:translateY(-1px);}'
  // Hamburger
  + '.hamburger{display:none;flex-direction:column;justify-content:center;gap:5px;background:none;border:none;cursor:pointer;padding:6px;}'
  + '.hamburger span{display:block;width:22px;height:2px;background:var(--nav-text);border-radius:2px;transition:all 0.25s;}'
  + '.hamburger.open span:nth-child(1){transform:translateY(7px) rotate(45deg);}'
  + '.hamburger.open span:nth-child(2){opacity:0;}'
  + '.hamburger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg);}'
  // Mobile menu
  + '.mobile-menu{display:none;position:fixed;inset:0;background:var(--nav-bg);z-index:300;flex-direction:column;padding:80px 32px 40px;pointer-events:none;overflow-y:auto;-webkit-overflow-scrolling:touch;}'
  + '.mobile-menu.open{display:flex;pointer-events:all;overflow-y:auto;}'
  + '.mobile-menu-links{display:flex;flex-direction:column;gap:4px;flex:1;}'
  + '.mobile-menu-links a{color:var(--nav-text);font-size:24px;font-family:"Syne",sans-serif;font-weight:700;text-decoration:none;padding:14px 0;border-bottom:1px solid var(--nav-border);transition:color 0.2s;}'
  + '@media(hover:hover){.mobile-menu-links a:hover{color:var(--nav-accent2);}}'
  // Mobile submenu
  + '.mobile-submenu{flex-direction:column;gap:0;padding:0 0 8px 20px;overflow:hidden;}'
  + '.mobile-submenu a{font-size:16px !important;padding:10px 0 !important;border-bottom:1px solid rgba(255,255,255,0.04) !important;color:var(--nav-muted) !important;font-weight:500 !important;}'
  + '@media(hover:hover){.mobile-submenu a:hover{color:var(--nav-accent2) !important;}}'
  + '.mobile-menu-bottom{margin-top:32px;}'
  + '.mobile-cta{width:100%;padding:16px;background:var(--nav-accent);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:500;font-family:"DM Sans",sans-serif;cursor:pointer;text-decoration:none;display:block;text-align:center;}'
  + '.mobile-signin{width:100%;padding:14px;background:transparent;border:1px solid var(--nav-border-hover);color:var(--nav-muted);border-radius:12px;font-size:15px;font-family:"DM Sans",sans-serif;cursor:pointer;margin-top:10px;text-align:center;}'
  // Tools dropdown
  + '.nav-tools-wrap{position:relative;display:flex;align-items:center;}'
  + '.nav-tools-trigger{display:inline-flex;align-items:center;gap:5px;color:var(--nav-muted);font-size:15px;font-weight:500;letter-spacing:0.01em;cursor:pointer;background:none;border:none;font-family:"DM Sans",sans-serif;padding:10px 12px;margin:-10px -12px;transition:color 0.2s;}'
  + '.nav-tools-trigger:hover,.nav-tools-wrap:hover .nav-tools-trigger,.nav-tools-wrap.nav-open .nav-tools-trigger{color:var(--nav-text);}'
  + '.nav-tools-trigger svg{transition:transform 0.2s;}'
  + '.nav-tools-wrap:hover .nav-tools-trigger svg,.nav-tools-wrap.nav-open .nav-tools-trigger svg{transform:rotate(180deg);}'
  + '.nav-tools-menu{position:absolute;top:100%;left:-12px;transform:translateY(0);width:560px;max-width:calc(100vw - 32px);max-height:calc(100vh - 96px);overflow-y:auto;overscroll-behavior:contain;background:#0c0c16;backdrop-filter:blur(20px);border:1px solid var(--nav-border-hover);border-radius:16px;padding:14px;box-shadow:0 20px 60px rgba(0,0,0,0.5);opacity:0;pointer-events:none;transition:opacity 0.18s,transform 0.18s;z-index:250;}'
  + '.nav-tools-menu::-webkit-scrollbar{width:10px;}'
  + '.nav-tools-menu::-webkit-scrollbar-track{background:transparent;border-radius:0 16px 16px 0;}'
  + '.nav-tools-menu::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:8px;border:2px solid #0c0c16;}'
  + '.nav-tools-menu::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.3);}'
  + '.nav-tools-menu{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.18) transparent;}'
  + '.nav-tools-wrap:hover .nav-tools-menu,.nav-tools-wrap.nav-open .nav-tools-menu{opacity:1;pointer-events:all;transform:translateY(0);}'
  + '.nav-tools-wrap::before{content:"";position:absolute;top:100%;left:-30px;right:-30px;height:24px;}'
  + '.nav-tools-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;}'
  + '.nav-tools-item{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border-radius:10px;text-decoration:none;transition:background 0.15s;color:inherit;}'
  + '.nav-tools-item:hover{background:rgba(124,58,237,0.08);}'
  + '.nav-tools-item-icon{width:36px;height:36px;border-radius:9px;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#c4b5fd;}'
  + '.nav-tools-item-icon svg{width:17px;height:17px;}'
  + '.nav-tools-item-content{flex:1;min-width:0;}'
  + '.nav-tools-item-title{font-family:"Syne",sans-serif;font-weight:700;font-size:13px;color:var(--nav-text);margin-bottom:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}'
  + '.nav-tools-item-desc{font-size:11px;color:var(--nav-muted);line-height:1.4;}'
  + '.nav-tools-tier{font-size:8px;padding:2px 6px;border-radius:4px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;vertical-align:middle;}'
  + '.nav-tools-tier.pro{background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.3);color:#c4b5fd;}'
  + '.nav-tools-tier.max{background:linear-gradient(135deg,#a78bfa,#e879f9);color:#fff;border:none;}'
  + '.nav-tools-tier.popular{background:rgba(250,204,21,0.15);border:1px solid rgba(250,204,21,0.3);color:#fbbf24;}'
  + '.nav-tools-footer{margin-top:12px;padding-top:12px;border-top:1px solid var(--nav-border);display:flex;align-items:center;justify-content:space-between;gap:12px;}'
  + '.nav-tools-footer-link{font-size:12px;color:#a78bfa;text-decoration:none;font-weight:500;display:inline-flex;align-items:center;gap:4px;}'
  + '.nav-tools-footer-link:hover{color:#c4b5fd;}'
  // Footer
  + '.footer-grid a:hover{color:#f0eef8 !important;}'
  + '.footer-grid a{text-decoration:none;}'
  // Responsive
  + '@media(max-width:768px){'
  +   'nav{padding:14px 16px;}'
  +   '.nav-pill{width:100%;gap:12px;padding:8px 10px 8px 18px;}'
  +   '.nav-links{display:none;}'
  +   '.nav-right{display:flex;}'
  +   '#nav-signin-btn{display:none;}'
  +   '.logo{margin-right:auto;font-size:0;gap:0;}'
  +   '.hamburger{display:flex;}'
  +   '.btn-nav-cta{padding:9px 18px;font-size:13px;}'
  +   'footer{flex-direction:column;text-align:center;padding:40px 20px 24px !important;}'
  +   '.footer-grid{grid-template-columns:1fr 1fr !important;gap:24px !important;}'
  +   '.footer-grid>div:first-child{grid-column:1/-1;}'
  +   '.footer-grid>div:first-child p{margin-left:auto;margin-right:auto;}'
  + '}'
  + '@media(max-width:480px){.footer-grid{grid-template-columns:1fr !important;}}';

document.head.appendChild(style);

// =====================
// GOOGLE ANALYTICS (consent-gated, GPC-respecting)
// =====================
// GA only loads if ALL of the following are true:
//   1. The browser is NOT sending a Global Privacy Control signal
//   2. The user has not opted out via the Do Not Sell page (ryxa_dns flag)
//   3. The user has affirmatively accepted the cookie banner
//
// This loader is callable. The cookie banner calls window.ryxaLoadAnalytics()
// the moment the user clicks Accept, so they get tracked immediately without
// a page reload. On subsequent page loads, the consent flag triggers load
// automatically.
window.ryxaLoadAnalytics = function() {
  // Already loaded? do nothing.
  if (window.gtag && window.dataLayer) return;

  // Honor Global Privacy Control (CCPA/CPRA requirement).
  if (navigator.globalPrivacyControl === true) return;

  // Honor explicit Do Not Sell or Share opt-out.
  try {
    if (localStorage.getItem('ryxa_dns') === '1') return;
  } catch (e) { /* localStorage unavailable, proceed cautiously */ }

  // Honor cookie banner consent. Stored by /cookie-banner.js as JSON
  // { v: '<version>', accepted: <bool>, ts: <ms> }.
  try {
    var raw = localStorage.getItem('fts_cookie_consent');
    if (!raw) return; // no decision yet
    var parsed = JSON.parse(raw);
    if (!parsed || parsed.accepted !== true) return; // declined or invalid
  } catch (e) { return; /* parse failure: do not load */ }

  // All gates passed. Load GA4.
  var gs = document.createElement('script');
  gs.async = true;
  gs.src = 'https://www.googletagmanager.com/gtag/js?id=G-G7QJHCCX63';
  document.head.appendChild(gs);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', 'G-G7QJHCCX63');
};

// Try to load immediately on page-init. If consent has not yet been given,
// this no-ops and the cookie banner will trigger the load when the user
// clicks Accept.
window.ryxaLoadAnalytics();

// =====================
// HEADER
// =====================
function renderHeader() {
  var el = document.getElementById('site-header');
  if (!el) return;
  var page = el.getAttribute('data-page') || '';

  var pricingStyle = page === 'pricing' ? 'color:var(--nav-text);' : '';
  var aboutStyle = page === 'about' ? 'color:var(--nav-text);' : '';

  el.innerHTML = ''
  // Skip link (a11y)
  + '<a class="skip-link" href="#main-content">Skip to content</a>'
  // Mobile menu
  + '<div class="mobile-menu" id="mobile-menu">'
  +   '<button data-nav-action="close-menu" aria-label="Close menu" style="position:absolute;top:20px;right:20px;background:none;border:none;color:var(--nav-muted);font-size:24px;cursor:pointer;line-height:1;padding:8px;">&#x2715;</button>'
  +   '<div class="mobile-menu-links">'
  +     '<a href="#" data-nav-action="toggle-submenu" data-nav-target="mobile-tools-sub">Tools <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-left:6px;"><polyline points="6 9 12 15 18 9"/></svg></a>'
  +     '<div id="mobile-tools-sub" class="mobile-submenu" style="display:none;">'
  +       '<a href="/tools-link-in-bio.html" data-nav-action="close-menu">Link in Bio</a>'
  +       '<a href="/tools-course-builder.html" data-nav-action="close-menu">Course Builder</a>'
  +       '<a href="/tools-coaching.html" data-nav-action="close-menu">1:1 Booking</a>'
  +       '<a href="/tools-digital-products.html" data-nav-action="close-menu">Digital Products</a>'
  +       '<a href="/tools-brand-deal-crm.html" data-nav-action="close-menu">Brand Deal CRM</a>'
  +       '<a href="/tools-media-kit.html" data-nav-action="close-menu">Media Kit</a>'
  +       '<a href="/tools-script-builder.html" data-nav-action="close-menu">Script Builder</a>'
  +       '<a href="/tools-subscribers.html" data-nav-action="close-menu">Subscribers</a>'
  +       '<a href="/tools-calendar.html" data-nav-action="close-menu">Calendar</a>'
  +       '<a href="/tools-design-studio.html" data-nav-action="close-menu">Design Studio</a>'
  +       '<a href="/tools-grid-planner.html" data-nav-action="close-menu">Grid Planner</a>'
  +       '<a href="/tools-follower-audit.html" data-nav-action="close-menu">Follow-Back Audit</a>'
  +       '<a href="/tools-photo-editor.html" data-nav-action="close-menu">Photo Editor</a>'
  +       '<a href="/tools-qr-generator.html" data-nav-action="close-menu">QR Generator</a>'
  +       '<a href="/tools-invoice-generator.html" data-nav-action="close-menu">Invoice Generator</a>'
  +       '<a href="/tools-sign-pdf.html" data-nav-action="close-menu">Sign PDF</a>'
  +       '<a href="/tools.html" data-nav-action="close-menu" style="color:var(--nav-accent2) !important;">View All Tools</a>'
  +     '</div>'
  +     '<a href="#" data-nav-action="toggle-submenu" data-nav-target="mobile-ai-sub">AI <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-left:6px;"><polyline points="6 9 12 15 18 9"/></svg></a>'
  +     '<div id="mobile-ai-sub" class="mobile-submenu" style="display:none;">'
  +       '<a href="/tools-thumbnail-analyzer.html" data-nav-action="close-menu">AI Thumbnail Analyzer</a>'
  +       '<a href="/tools-contract-analyzer.html" data-nav-action="close-menu">AI Contract Analyzer</a>'
  +       '<a href="/tools-chatbox.html" data-nav-action="close-menu">Chatbox</a>'
  +     '</div>'
  +     '<a href="/pricing.html" data-nav-action="close-menu">Pricing</a>'
  +     '<a href="/about.html" data-nav-action="close-menu">About</a>'
  +     '<a href="/learn/" data-nav-action="close-menu">Hub</a>'
  +     '<a href="/blog.html" data-nav-action="close-menu">Blog</a>'
  +   '</div>'
  +   '<div class="mobile-menu-bottom">'
  +     '<a class="mobile-cta" href="/dashboard.html" id="mobile-dashboard-link" style="display:none;">Go to Dashboard</a>'
  +     '<button class="mobile-cta" data-nav-action="open-signup" id="mobile-signup-btn">Get started free</button>'
  +     '<button class="mobile-signin" data-nav-action="open-signin">Sign in</button>'
  +   '</div>'
  + '</div>'

  // Nav bar - single centered pill
  + '<nav>'
  +   '<div class="nav-pill">'
  +     '<a class="logo" href="/index.html"><img src="/logo-black.png" alt="Ryxa"> Ryxa</a>'
  +   '<div class="nav-links" id="nav-links">'

  // Tools dropdown
  +     '<div class="nav-tools-wrap">'
  +       '<button class="nav-tools-trigger" type="button">Tools <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'
  +       '<div class="nav-tools-menu"><div class="nav-tools-grid">'
  +         '<a href="/tools-link-in-bio.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Link in Bio <span class="nav-tools-tier popular">Popular</span></div><div class="nav-tools-item-desc">The first impression for your brand</div></div></a>'
  +         '<a href="/tools-brand-deal-crm.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 12h18"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Brand Deal CRM <span class="nav-tools-tier max">Max</span></div><div class="nav-tools-item-desc">Track every brand deal in one place</div></div></a>'
  +         '<a href="/tools-course-builder.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Course Builder <span class="nav-tools-tier max">Max</span></div><div class="nav-tools-item-desc">Build and sell your own courses</div></div></a>'
  +         '<a href="/tools-coaching.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">1:1 Booking <span class="nav-tools-tier max">Max</span></div><div class="nav-tools-item-desc">Sell private sessions and consultations</div></div></a>'
  +         '<a href="/tools-digital-products.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Digital Products <span class="nav-tools-tier max">Max</span></div><div class="nav-tools-item-desc">Sell ebooks, templates, and presets</div></div></a>'
  +         '<a href="/tools-media-kit.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="17" x2="8" y2="13"/><line x1="12" y1="17" x2="12" y2="11"/><line x1="16" y1="17" x2="16" y2="15"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Media Kit <span class="nav-tools-tier pro">Pro</span></div><div class="nav-tools-item-desc">Pitch brands with a pro media kit</div></div></a>'
  +         '<a href="/tools-script-builder.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Script Builder <span class="nav-tools-tier pro">Pro</span></div><div class="nav-tools-item-desc">Write video scripts with AI help</div></div></a>'
  +         '<a href="/tools-subscribers.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Subscribers</div><div class="nav-tools-item-desc">Collect unlimited emails, free</div></div></a>'
  +         '<a href="/tools-calendar.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Calendar</div><div class="nav-tools-item-desc">Bookings, brand deals, all in one</div></div></a>'
  +         '<a href="/tools-design-studio.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="10" ry="4.5"/><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(120 12 12)"/><circle cx="12" cy="12" r="2"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Design Studio</div><div class="nav-tools-item-desc">Create graphics on a free canvas</div></div></a>'
  +         '<a href="/tools-grid-planner.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Grid Planner</div><div class="nav-tools-item-desc">Plan your feed, drag to reorder</div></div></a>'
  +         '<a href="/tools-follower-audit.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Follow-Back Audit</div><div class="nav-tools-item-desc">See who isn\'t following you back</div></div></a>'
  +         '<a href="/tools-photo-editor.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Photo Editor</div><div class="nav-tools-item-desc">Crop and adjust with creator ratios</div></div></a>'
  +         '<a href="/tools-qr-generator.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v1"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">QR Generator</div><div class="nav-tools-item-desc">Make QR codes for your links</div></div></a>'
  +         '<a href="/tools-invoice-generator.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Invoice Generator</div><div class="nav-tools-item-desc">Send pro invoices for brand deals</div></div></a>'
  +         '<a href="/tools-sign-pdf.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M3 17l3-3 2 2 5-5 3 3"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Sign PDF</div><div class="nav-tools-item-desc">Fill and sign PDFs in seconds</div></div></a>'
  +       '</div>'
  +       '<div class="nav-tools-footer"><div style="font-size:12px;color:var(--nav-muted);">All your creator tools, one workspace</div><a href="/tools.html" class="nav-tools-footer-link">View all tools <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></a></div>'
  +       '</div>'
  +     '</div>'

  // AI dropdown
  +     '<div class="nav-tools-wrap">'
  +       '<button class="nav-tools-trigger" type="button">AI <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'
  +       '<div class="nav-tools-menu" style="width:340px;">'
  +         '<a href="/tools-thumbnail-analyzer.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6M8 11h6"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">AI Thumbnail Analyzer <span class="nav-tools-tier pro">Pro</span></div><div class="nav-tools-item-desc">Get AI feedback on your thumbnails</div></div></a>'
  +         '<a href="/tools-contract-analyzer.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">AI Contract Analyzer <span class="nav-tools-tier pro">Pro</span></div><div class="nav-tools-item-desc">Scan a brand contract for red flags</div></div></a>'
  +         '<a href="/tools-chatbox.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Chatbox <span class="nav-tools-tier pro">Pro</span></div><div class="nav-tools-item-desc">Chat with a creator-trained AI</div></div></a>'
  +       '</div>'
  +     '</div>'

  +     '<a href="/pricing.html" style="' + pricingStyle + '">Pricing</a>'
  +     '<a href="/about.html" style="' + aboutStyle + '">About</a>'

  // Hub dropdown
  +     '<div class="nav-tools-wrap">'
  +       '<button class="nav-tools-trigger" type="button" data-nav-action="hub-trigger">Hub <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'
  +       '<div class="nav-tools-menu" style="width:300px;">'
  +         '<a href="/learn/" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Customer Login</div><div class="nav-tools-item-desc">Access courses, downloads, and bookings you have purchased</div></div></a>'
  +         '<a href="/blog.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Blog</div><div class="nav-tools-item-desc">Guides and strategy for creators</div></div></a>'
  +       '</div>'
  +     '</div>'

  +   '</div>'

  // Right side buttons
  +   '<div class="nav-right">'
  +     '<button class="btn-ghost" data-nav-action="open-signin" id="nav-signin-btn">Sign in</button>'
  +     '<button class="btn-nav-cta" data-nav-action="open-signup" id="nav-cta-btn">Get started free</button>'
  +   '</div>'
  +   '<button class="hamburger" id="hamburger-btn" data-nav-action="toggle-menu" aria-label="Menu"><span></span><span></span><span></span></button>'
  +   '</div>'
  + '</nav>';

  // Check logged-in state
  siteNavCheckAuth();
}

// =====================
// FOOTER
// =====================
function renderFooter() {
  var el = document.getElementById('site-footer');
  if (!el) return;

  el.innerHTML = ''
  + '<footer style="border-top:1px solid rgba(255,255,255,0.08);padding:60px 48px 32px;max-width:1200px;margin:0 auto;">'
  +   '<div class="footer-grid" style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr 1fr;gap:32px;margin-bottom:40px;">'
  +     '<div>'
  +       '<a href="/index.html" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:#f0eef8;font-family:\'Syne\',sans-serif;font-weight:800;font-size:20px;margin-bottom:12px;"><img src="/logo-black.png" alt="Ryxa" style="width:32px;height:32px;object-fit:contain;"> Ryxa<span style="font-size:14px;font-weight:400;margin-left:-2px;vertical-align:super;font-family:Inter,system-ui,sans-serif;text-decoration:none;">&trade;</span></a>'
  +       '<p style="font-size:13px;color:#b4b2c8;line-height:1.6;max-width:200px;margin-bottom:16px;">Ryxa makes earning money and professional branding easy.</p>'
  +       '<a href="https://www.instagram.com/ryxaforcreators" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#b4b2c8;transition:all 0.15s;" aria-label="Instagram">'
  +         '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>'
  +       '</a>'
  +     '</div>'
  +     '<div>'
  +       '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:13px;margin-bottom:14px;">Tools</div>'
  +       '<div style="display:flex;flex-direction:column;gap:8px;">'
  +         '<a href="/tools-link-in-bio.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Link in Bio</a>'
  +         '<a href="/tools-course-builder.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Course Builder</a>'
  +         '<a href="/tools-coaching.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">1:1 Booking</a>'
  +         '<a href="/tools-digital-products.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Digital Products</a>'
  +         '<a href="/tools-brand-deal-crm.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Brand Deal CRM</a>'
  +         '<a href="/tools-media-kit.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Media Kit</a>'
  +         '<a href="/tools-script-builder.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Script Builder</a>'
  +         '<a href="/tools-design-studio.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Design Studio</a>'
  +         '<a href="/tools-thumbnail-analyzer.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">AI Thumbnail Analyzer</a>'
  +         '<a href="/tools-contract-analyzer.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">AI Contract Analyzer</a>'
  +         '<a href="/tools-chatbox.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Chatbox</a>'
  +         '<a href="/tools.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">View All Tools</a>'
  +       '</div>'
  +     '</div>'
  +     '<div>'
  +       '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:13px;margin-bottom:14px;">Resources</div>'
  +       '<div style="display:flex;flex-direction:column;gap:8px;">'
  +         '<a href="/learn/" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Hub</a>'
  +         '<a href="/blog.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Blog</a>'
  +         '<a href="/how-much/" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Creator Earnings</a>'
  +       '</div>'
  +     '</div>'
  +     '<div>'
  +       '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:13px;margin-bottom:14px;">Company</div>'
  +       '<div style="display:flex;flex-direction:column;gap:8px;">'
  +         '<a href="/pricing.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Pricing</a>'
  +         '<a href="/about.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">About</a>'
  +         '<a href="/privacy.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Privacy</a>'
  +         '<a href="/terms.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Terms</a>'
  +         '<a href="/do-not-sell.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Do Not Sell or Share</a>'
  +       '</div>'
  +     '</div>'
  +     '<div>'
  +       '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:13px;margin-bottom:14px;">Support</div>'
  +       '<div style="display:flex;flex-direction:column;gap:8px;">'
  +         '<a href="/faq.html" style="color:#b4b2c8;font-size:13px;text-decoration:none;">FAQ</a>'
  +         '<a href="/help" style="color:#b4b2c8;font-size:13px;text-decoration:none;">Help Center</a>'
  +         '<a href="mailto:hello@ryxa.io" style="color:#b4b2c8;font-size:13px;text-decoration:none;">hello@ryxa.io</a>'
  +       '</div>'
  +     '</div>'
  +   '</div>'
  +   '<div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:20px;width:100%;clear:both;">'
  +     '<p style="font-size:12px;color:#b4b2c8;margin:0;">&copy; ' + new Date().getFullYear() + ' <a href="https://www.mrla-media.com" target="_blank" rel="noopener noreferrer" style="color:#b4b2c8;text-decoration:none;">MRLA Media LLC</a> &middot; Ryxa&trade;</p>'
  +   '</div>'
  + '</footer>';
}

// =====================
// MOBILE MENU
// =====================
window.toggleMobileMenu = function() {
  var menu = document.getElementById('mobile-menu');
  var btn = document.getElementById('hamburger-btn');
  if (!menu) return;
  menu.classList.toggle('open');
  if (btn) btn.classList.toggle('open');
  document.body.style.overflow = menu.classList.contains('open') ? 'hidden' : '';
};

window.closeMobileMenu = function() {
  var menu = document.getElementById('mobile-menu');
  var btn = document.getElementById('hamburger-btn');
  if (menu) menu.classList.remove('open');
  if (btn) btn.classList.remove('open');
  document.body.style.overflow = '';
};

window.toggleMobileSubmenu = function(id) {
  var sub = document.getElementById(id);
  if (!sub) return;
  if (sub.style.display === 'flex') {
    sub.style.display = 'none';
  } else {
    sub.style.display = 'flex';
  }
};

// =====================
// AUTH STATE CHECK
// =====================
// Reads the Supabase session directly from localStorage instead of creating
// our own Supabase client. Why: pages that load site-nav.js often ALREADY
// create a client (index.html, pricing.html, every /tools-*.html page).
// Creating a second client triggers Supabase's "Multiple GoTrueClient
// instances" warning and can cause race conditions on token refresh.
//
// The session is stored at sb-<project-ref>-auth-token. We just need to know
// if a non-expired session exists to flip the "Sign in" button to "Dashboard"
// — we don't need full auth APIs.
// Lightweight logged-in check. Reads the Supabase auth token straight from
// localStorage (no SDK needed) and verifies it has a non-expired access token.
// This is cosmetic-grade only, same as siteNavCheckAuth: it decides which page
// to route to, never gates anything. dashboard.html runs its own real session
// check, so a stale token at worst sends someone to that gate.
function siteNavIsLoggedIn() {
  try {
    var raw = localStorage.getItem('sb-kjytapcgxukalwsyputk-auth-token');
    if (!raw) return false;
    var session = JSON.parse(raw);
    if (!session || !session.access_token) return false;
    if (session.expires_at && session.expires_at * 1000 < Date.now()) return false;
    return true;
  } catch (e) {
    return false;
  }
}
window.siteNavIsLoggedIn = siteNavIsLoggedIn;

function siteNavCheckAuth() {
  try {
    var key = 'sb-kjytapcgxukalwsyputk-auth-token';
    var raw = localStorage.getItem(key);
    if (!raw) return;
    var session = JSON.parse(raw);
    // Supabase v2 stores the session object directly. Check for an access
    // token and verify it hasn't expired (expires_at is seconds-since-epoch).
    if (!session || !session.access_token) return;
    if (session.expires_at && session.expires_at * 1000 < Date.now()) return;

    // Logged in. On desktop, the prominent CTA button becomes "Dashboard"
    // (text + action swapped) and the "Sign in" ghost button is hidden.
    // On mobile, the dedicated dashboard link shows and the signup button
    // hides. NOTE: this is purely cosmetic - it only decides which label /
    // action the button carries. It is NOT an auth gate. dashboard.html does
    // its own real getSession()/refreshSession() check and shows a login
    // screen if there is no valid session, so a faked localStorage value at
    // worst sends someone to that real gate. Nothing here is protected.
    var ctaBtn = document.getElementById('nav-cta-btn');
    var signinBtn = document.getElementById('nav-signin-btn');
    var mobileDash = document.getElementById('mobile-dashboard-link');
    var mobileSignup = document.getElementById('mobile-signup-btn');
    if (ctaBtn) {
      ctaBtn.textContent = 'Dashboard';
      ctaBtn.setAttribute('data-nav-action', 'go-dashboard');
    }
    if (signinBtn) signinBtn.style.display = 'none';
    if (mobileDash) mobileDash.style.display = 'block';
    if (mobileSignup) mobileSignup.style.display = 'none';
  } catch(e) {}
}

// =====================
// INIT
// =====================
renderHeader();
renderFooter();

// =====================
// BLOG AUTHOR BYLINE
// Injects the author name + photo into a blog post's byline.
// A post opts in with: <div class="blog-meta" data-author="KEY" data-read="X min read"></div>
// To change an author's name/photo, edit BLOG_AUTHORS below (updates every post by them).
// To add a new author, add one entry. Non-blog pages have no .blog-meta[data-author],
// so this is a single no-op querySelector there.
// =====================
var BLOG_AUTHORS = {
  johnny: {
    name: 'Johnny La',
    photo: '/blog/johnny-ryxablog.webp',
    jobTitle: 'Actor, Creator, and Entrepreneur',
    bio: 'Johnny La is an actor, creator, and entrepreneur who has been active since 2003. Over his career he has built an audience of more than 250,000 followers across multiple platforms. Today he is the founder of Ryxa and has grown a strong creator community in Los Angeles, where he continues to share what he has learned and guide others through their own creator journey.',
    links: [
      { label: 'Instagram', url: 'https://www.instagram.com/thejohnnyla' },
      { label: 'IMDb', url: 'https://www.imdb.com/name/nm4478211' }
    ]
  }
};

function siteNavEscapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

(function injectBlogByline() {
  var meta = document.querySelector('.blog-meta[data-author]');
  if (!meta) return;  // not a blog post, do nothing

  var author = BLOG_AUTHORS[meta.getAttribute('data-author')];
  if (!author) return;  // unknown author key, leave byline empty rather than guess

  var read = meta.getAttribute('data-read');

  var html = '<span><img src="' + author.photo + '" alt="' + siteNavEscapeHtml(author.name)
           + '" class="blog-author-img"> ' + siteNavEscapeHtml(author.name) + '</span>';
  if (read) {
    html += '<span>\u2022</span><span>' + siteNavEscapeHtml(read) + '</span>';
  }
  meta.innerHTML = html;
})();

(function injectBlogAuthorBox() {
  var box = document.querySelector('.blog-author-box[data-author]');
  if (!box) return;  // post has no author box, do nothing

  var author = BLOG_AUTHORS[box.getAttribute('data-author')];
  if (!author) return;

  var links = '';
  if (author.links && author.links.length) {
    var parts = author.links.map(function (l) {
      return '<a href="' + l.url + '" target="_blank" rel="noopener">'
           + siteNavEscapeHtml(l.label) + '</a>';
    });
    links = '<div class="author-box-links">' + parts.join('') + '</div>';
  }

  box.innerHTML =
    '<img src="' + author.photo + '" alt="' + siteNavEscapeHtml(author.name) + '" class="author-box-img">'
    + '<div class="author-box-body">'
    + '<div class="author-box-label">About the author</div>'
    + '<div class="author-box-name">' + siteNavEscapeHtml(author.name) + '</div>'
    + '<div class="author-box-bio">' + siteNavEscapeHtml(author.bio) + '</div>'
    + links
    + '</div>';
})();

// =====================
// DROPDOWN KEYBOARD HANDLERS (APG Disclosure / Menu Button pattern)
// - Tab through triggers does NOT auto-open menus
// - Enter/Space/ArrowDown on trigger opens menu and focuses first item
// - Escape closes menu and returns focus to trigger
// - Tab from open menu closes it and continues normal tab order
// - Items get tabindex="-1" while closed so Tab skips over them
// =====================
(function setupNavDropdowns() {
  var wraps = document.querySelectorAll('.nav-tools-wrap');
  if (!wraps.length) return;

  function getItems(wrap) {
    return wrap.querySelectorAll('.nav-tools-menu a');
  }

  function closeMenu(wrap, returnFocus) {
    wrap.classList.remove('nav-open');
    var trigger = wrap.querySelector('.nav-tools-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    getItems(wrap).forEach(function(a) { a.setAttribute('tabindex', '-1'); });
    if (returnFocus && trigger) trigger.focus();
  }

  function openMenu(wrap, focusFirst) {
    // Close any other open menus first
    document.querySelectorAll('.nav-tools-wrap.nav-open').forEach(function(other) {
      if (other !== wrap) closeMenu(other, false);
    });
    wrap.classList.add('nav-open');
    var trigger = wrap.querySelector('.nav-tools-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    var items = getItems(wrap);
    items.forEach(function(a) { a.setAttribute('tabindex', '0'); });
    if (focusFirst && items.length) items[0].focus();
  }

  wraps.forEach(function(wrap) {
    var trigger = wrap.querySelector('.nav-tools-trigger');
    if (!trigger) return;

    // ARIA wiring
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'true');

    // Items start out of tab order
    getItems(wrap).forEach(function(a) { a.setAttribute('tabindex', '-1'); });

    // Trigger keyboard: Enter / Space / ArrowDown opens
    trigger.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        // The Hub trigger navigates via data-nav-action delegation when menu is empty
        if (getItems(wrap).length === 0) return;
        e.preventDefault();
        openMenu(wrap, true);
      } else if (e.key === 'Escape') {
        closeMenu(wrap, true);
      }
    });

    // Trigger click: toggle (mouse + touch). Hub trigger has data-nav-action
    // delegation that navigates when there are no dropdown items.
    trigger.addEventListener('click', function(e) {
      if (getItems(wrap).length === 0) return;
      e.preventDefault();
      if (wrap.classList.contains('nav-open')) {
        closeMenu(wrap, false);
      } else {
        openMenu(wrap, false);
      }
    });

    // Menu items: Escape closes, Tab from last item closes (so focus continues naturally)
    getItems(wrap).forEach(function(item, idx, all) {
      item.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMenu(wrap, true);
        } else if (e.key === 'Tab' && !e.shiftKey && idx === all.length - 1) {
          // Tabbing forward off last item — close menu, let browser do natural tab
          closeMenu(wrap, false);
        } else if (e.key === 'Tab' && e.shiftKey && idx === 0) {
          // Shift+Tab off first item — close menu, let browser tab back to trigger
          closeMenu(wrap, false);
        }
      });
    });

    // Click outside closes
    document.addEventListener('click', function(e) {
      if (wrap.classList.contains('nav-open') && !wrap.contains(e.target)) {
        closeMenu(wrap, false);
      }
    });

    // Focus moving outside the wrap closes (covers tab-through edge cases)
    wrap.addEventListener('focusout', function(e) {
      // relatedTarget is the element receiving focus; if it's outside this wrap, close
      if (e.relatedTarget && !wrap.contains(e.relatedTarget)) {
        closeMenu(wrap, false);
      }
    });
  });
})();

// =====================
// SITE-NAV ACTION DELEGATION (CSP-compatible)
// =====================
// Replaces the previous inline onclick="..." attributes on nav buttons and
// mobile menu links. All interactive elements use data-nav-action="..." and
// are routed through this single document-level click listener.
//
// Actions:
//   toggle-menu      → open/close mobile hamburger menu
//   close-menu       → close mobile menu (used by close button and every link)
//   toggle-submenu   → expand/collapse mobile Tools or AI submenu (uses data-nav-target)
//   open-signin      → call window.openAuthModal() (modal or redirect fallback)
//   open-signup      → call window.openSignupModal() (modal or redirect fallback)
//   go-dashboard     → navigate to /dashboard.html (CTA button when logged in)
//   hub-trigger      → navigate to /learn/ (preserves previous Hub button behavior)
//   try-tool         → "Try this tool" CTA: dashboard if logged in, else signup
//   toggle-faq       → expand/collapse a tool-page FAQ item (toggles .open on parent)
(function setupNavActionDelegation() {
  var handlers = {
    'toggle-menu': function() { if (typeof window.toggleMobileMenu === 'function') window.toggleMobileMenu(); },
    'close-menu': function() { if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu(); },
    'toggle-submenu': function(e, el) {
      var target = el.getAttribute('data-nav-target');
      if (target && typeof window.toggleMobileSubmenu === 'function') window.toggleMobileSubmenu(target);
    },
    'open-signin': function() { if (typeof window.openAuthModal === 'function') window.openAuthModal(); },
    'open-signup': function() { if (typeof window.openSignupModal === 'function') window.openSignupModal(); },
    'go-dashboard': function() { window.location.href = '/dashboard.html'; },
    'hub-trigger': function() { window.location.href = '/learn/'; },
    'try-tool': function(e) {
      // The element keeps an href as a no-JS fallback, so cancel it here.
      if (e) e.preventDefault();
      window.location.href = siteNavIsLoggedIn() ? '/dashboard.html' : '/index.html?action=signup';
    },
    'toggle-faq': function(e, el) {
      if (el && el.parentElement) el.parentElement.classList.toggle('open');
    }
  };

  document.addEventListener('click', function(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-nav-action]') : null;
    if (!el) return;
    var action = el.getAttribute('data-nav-action');
    var fn = handlers[action];
    if (!fn) return;
    // For anchors, preventDefault so href="#" submenu toggles don't scroll to top
    if (el.tagName === 'A' && (el.getAttribute('href') === '#' || action === 'toggle-submenu')) {
      e.preventDefault();
    }
    fn(e, el);
  });
})();

// Auto-tag first content element with id="main-content" for skip link
if (!document.getElementById('main-content')) {
  var header = document.getElementById('site-header');
  if (header) {
    var sibling = header.nextElementSibling;
    while (sibling && (sibling.classList.contains('modal-backdrop') || sibling.tagName === 'SCRIPT')) {
      sibling = sibling.nextElementSibling;
    }
    if (sibling) sibling.id = 'main-content';
  }
}

document.body.classList.add('site-ready');

// Fallback auth functions for pages that don't have their own modal
if (typeof window.openAuthModal === 'undefined') {
  window.openAuthModal = function() { window.location.href = '/index.html?action=signin'; };
}
if (typeof window.openSignupModal === 'undefined') {
  window.openSignupModal = function() { window.location.href = '/index.html?action=signup'; };
}

// =====================
// COOKIE BANNER
// =====================
// Auto-load /cookie-banner.js so every page using site-nav.js shows the cookie
// banner. This avoids the missing-banner bug on the 18 tool pages that include
// site-nav.js but had previously not included cookie-banner.js directly.
// Guard against double-loading: pages that already include cookie-banner.js
// directly (bio, mediakit, dashboard, reset-password) won't re-inject because
// the banner script self-guards on localStorage consent. But we also check for
// an existing <script src> match before injecting, to keep network use minimal.
(function loadCookieBanner() {
  var alreadyLoaded = !!document.querySelector('script[src="/cookie-banner.js"], script[src="cookie-banner.js"]');
  if (alreadyLoaded) return;
  var s = document.createElement('script');
  s.src = '/cookie-banner.js';
  s.async = true;
  document.head.appendChild(s);
})();

// =====================
// SCROLL-HIDE NAV
// =====================
// The floating nav hides when the user scrolls down and reappears when they
// scroll up - the standard modern "always one flick away" behavior. It is
// always visible near the top of the page. Scroll handling is rAF-throttled
// so it stays cheap. The CSS transition respects prefers-reduced-motion.
(function initScrollHideNav() {
  var navEl = document.querySelector('nav');
  if (!navEl) return;

  var lastY = window.pageYOffset || 0;
  var ticking = false;

  // Near the top: always visible, regardless of scroll direction.
  var TOP_ZONE = 80;
  // Ignore scroll movements smaller than this so tiny twitches do not
  // toggle the nav.
  var DELTA = 6;

  function update() {
    ticking = false;
    var y = window.pageYOffset || 0;

    // Near the top: always visible.
    if (y < TOP_ZONE) {
      navEl.classList.remove('nav-hidden');
      lastY = y;
      return;
    }

    // If the mobile menu is open, keep the nav visible.
    var menu = document.getElementById('mobile-menu');
    if (menu && menu.classList.contains('open')) {
      navEl.classList.remove('nav-hidden');
      lastY = y;
      return;
    }

    var diff = y - lastY;
    if (Math.abs(diff) < DELTA) return;  // too small to act on

    if (diff > 0) {
      navEl.classList.add('nav-hidden');     // scrolling down - hide
    } else {
      navEl.classList.remove('nav-hidden');  // scrolling up - show
    }
    lastY = y;
  }

  window.addEventListener('scroll', function() {
    if (!ticking) {
      window.requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
})();

})();
