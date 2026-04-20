// site-nav.js — Shared header and footer for ryxa.io
// Usage: Add <div id="site-header"></div> and <div id="site-footer"></div> to any page
// Then include: <script src="/site-nav.js"></script> before closing </body>
// For active page highlighting, add data-page attribute to #site-header:
//   <div id="site-header" data-page="pricing"></div>

(function() {

// =====================
// INJECT STYLES
// =====================
var style = document.createElement('style');
style.textContent = ''
  // Anti-flash: reserve space
  + '#site-header{min-height:68px;}'
  + '#site-footer{min-height:200px;}'
  // Nav
  + 'nav{position:sticky;top:0;z-index:200;display:flex;align-items:center;justify-content:space-between;padding:0 48px;height:68px;background:rgba(7,7,15,0.85);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);}'
  + '.logo img{width:38px;height:38px;object-fit:contain;}'
  + '.logo{font-family:"Syne",sans-serif;font-weight:800;font-size:22px;letter-spacing:-0.5px;display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);}'
  + '.nav-links{display:flex;align-items:center;gap:32px;}'
  + '.nav-links a{color:var(--muted);font-size:14px;text-decoration:none;transition:color 0.2s;}'
  + '.nav-links a:hover{color:var(--text);}'
  + '.nav-right{display:flex;align-items:center;gap:12px;}'
  + '.btn-ghost{background:transparent;border:1px solid var(--border-hover);color:var(--text);border-radius:8px;padding:8px 20px;font-size:14px;font-weight:500;font-family:"DM Sans",sans-serif;cursor:pointer;transition:all 0.2s;}'
  + '.btn-ghost:hover{border-color:var(--accent2);color:var(--accent2);}'
  + '.btn-nav-cta{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:9px 22px;font-size:14px;font-weight:500;font-family:"DM Sans",sans-serif;cursor:pointer;transition:all 0.2s;box-shadow:0 0 20px var(--accent-glow);}'
  + '.btn-nav-cta:hover{background:var(--accent2);transform:translateY(-1px);}'
  // Hamburger
  + '.hamburger{display:none;flex-direction:column;justify-content:center;gap:5px;background:none;border:none;cursor:pointer;padding:6px;}'
  + '.hamburger span{display:block;width:22px;height:2px;background:var(--text);border-radius:2px;transition:all 0.25s;}'
  + '.hamburger.open span:nth-child(1){transform:translateY(7px) rotate(45deg);}'
  + '.hamburger.open span:nth-child(2){opacity:0;}'
  + '.hamburger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg);}'
  // Mobile menu
  + '.mobile-menu{display:none;position:fixed;inset:0;background:var(--bg);z-index:300;flex-direction:column;padding:80px 32px 40px;pointer-events:none;}'
  + '.mobile-menu.open{display:flex;pointer-events:all;}'
  + '.mobile-menu-links{display:flex;flex-direction:column;gap:4px;flex:1;}'
  + '.mobile-menu-links a{color:var(--text);font-size:24px;font-family:"Syne",sans-serif;font-weight:700;text-decoration:none;padding:14px 0;border-bottom:1px solid var(--border);transition:color 0.2s;}'
  + '.mobile-menu-links a:hover{color:var(--accent2);}'
  // Mobile submenu
  + '.mobile-submenu{display:none;flex-direction:column;gap:0;padding:0 0 8px 20px;overflow:hidden;}'
  + '.mobile-submenu a{font-size:16px !important;padding:10px 0 !important;border-bottom:1px solid rgba(255,255,255,0.04) !important;color:var(--muted) !important;font-weight:500 !important;}'
  + '.mobile-submenu a:hover{color:var(--accent2) !important;}'
  + '.mobile-menu-bottom{margin-top:32px;}'
  + '.mobile-cta{width:100%;padding:16px;background:var(--accent);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:500;font-family:"DM Sans",sans-serif;cursor:pointer;text-decoration:none;display:block;text-align:center;}'
  + '.mobile-signin{width:100%;padding:14px;background:transparent;border:1px solid var(--border-hover);color:var(--muted);border-radius:12px;font-size:15px;font-family:"DM Sans",sans-serif;cursor:pointer;margin-top:10px;text-align:center;}'
  // Tools dropdown
  + '.nav-tools-wrap{position:relative;display:flex;align-items:center;}'
  + '.nav-tools-trigger{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:14px;cursor:pointer;background:none;border:none;font-family:"DM Sans",sans-serif;padding:0;transition:color 0.2s;}'
  + '.nav-tools-trigger:hover,.nav-tools-wrap:hover .nav-tools-trigger{color:var(--text);}'
  + '.nav-tools-trigger svg{transition:transform 0.2s;}'
  + '.nav-tools-wrap:hover .nav-tools-trigger svg{transform:rotate(180deg);}'
  + '.nav-tools-menu{position:absolute;top:100%;left:0;transform:translateY(8px);width:720px;max-width:calc(100vw - 32px);background:rgba(15,15,26,0.98);backdrop-filter:blur(20px);border:1px solid var(--border-hover);border-radius:16px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,0.5);opacity:0;pointer-events:none;transition:opacity 0.18s,transform 0.18s;z-index:250;}'
  + '.nav-tools-wrap:hover .nav-tools-menu{opacity:1;pointer-events:all;transform:translateY(0);}'
  + '.nav-tools-wrap::before{content:"";position:absolute;top:100%;left:0;right:0;height:12px;}'
  + '.nav-tools-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;}'
  + '.nav-tools-item{display:flex;align-items:flex-start;gap:12px;padding:12px;border-radius:10px;text-decoration:none;transition:background 0.15s;color:inherit;}'
  + '.nav-tools-item:hover{background:rgba(124,58,237,0.08);}'
  + '.nav-tools-item-icon{width:36px;height:36px;border-radius:9px;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#c4b5fd;}'
  + '.nav-tools-item-icon svg{width:17px;height:17px;}'
  + '.nav-tools-item-content{flex:1;min-width:0;}'
  + '.nav-tools-item-title{font-family:"Syne",sans-serif;font-weight:700;font-size:13px;color:var(--text);margin-bottom:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}'
  + '.nav-tools-item-desc{font-size:11px;color:var(--muted);line-height:1.4;}'
  + '.nav-tools-tier{font-size:8px;padding:2px 6px;border-radius:4px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;vertical-align:middle;}'
  + '.nav-tools-tier.pro{background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.3);color:#c4b5fd;}'
  + '.nav-tools-tier.free{background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.3);color:#4ade80;}'
  + '.nav-tools-tier.max{background:linear-gradient(135deg,#a78bfa,#e879f9);color:#fff;border:none;}'
  + '.nav-tools-tier.popular{background:rgba(250,204,21,0.15);border:1px solid rgba(250,204,21,0.3);color:#fbbf24;}'
  + '.nav-tools-footer{margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;}'
  + '.nav-tools-footer-link{font-size:12px;color:#a78bfa;text-decoration:none;font-weight:500;display:inline-flex;align-items:center;gap:4px;}'
  + '.nav-tools-footer-link:hover{color:#c4b5fd;}'
  // Footer
  + '.footer-grid a:hover{color:var(--text) !important;}'
  // Responsive
  + '@media(max-width:768px){nav{padding:0 20px;}.nav-links,.nav-right{display:none;}.hamburger{display:flex;}footer{flex-direction:column;text-align:center;padding:40px 20px 24px !important;}.footer-grid{grid-template-columns:1fr 1fr !important;gap:24px !important;}.footer-grid>div:first-child{grid-column:1/-1;}.footer-grid>div:first-child p{margin-left:auto;margin-right:auto;}}'
  + '@media(max-width:480px){.footer-grid{grid-template-columns:1fr !important;}}';

document.head.appendChild(style);

// =====================
// HEADER
// =====================
function renderHeader() {
  var el = document.getElementById('site-header');
  if (!el) return;
  var page = el.getAttribute('data-page') || '';

  var pricingStyle = page === 'pricing' ? 'color:var(--text);' : '';
  var aboutStyle = page === 'about' ? 'color:var(--text);' : '';
  var blogStyle = page === 'blog' ? 'color:var(--text);' : '';

  el.innerHTML = ''
  // Mobile menu
  + '<div class="mobile-menu" id="mobile-menu">'
  +   '<button onclick="closeMobileMenu()" aria-label="Close menu" style="position:absolute;top:20px;right:20px;background:none;border:none;color:var(--muted);font-size:24px;cursor:pointer;line-height:1;padding:8px;">&#x2715;</button>'
  +   '<div class="mobile-menu-links">'
  +     '<a href="#" onclick="event.preventDefault();toggleMobileSubmenu(\'mobile-tools-sub\')">Tools <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-left:6px;"><polyline points="6 9 12 15 18 9"/></svg></a>'
  +     '<div id="mobile-tools-sub" class="mobile-submenu" style="display:none;">'
  +       '<a href="tools-link-in-bio.html" onclick="closeMobileMenu()">Link in Bio</a>'
  +       '<a href="tools-course-builder.html" onclick="closeMobileMenu()">Course Builder</a>'
  +       '<a href="tools-coaching.html" onclick="closeMobileMenu()">1:1 Coaching</a>'
  +       '<a href="tools-brand-deal-crm.html" onclick="closeMobileMenu()">Brand Deal CRM</a>'
  +       '<a href="tools-media-kit.html" onclick="closeMobileMenu()">Media Kit</a>'
  +       '<a href="tools-grid-planner.html" onclick="closeMobileMenu()">Grid Planner</a>'
  +       '<a href="tools-follower-audit.html" onclick="closeMobileMenu()">Follow-Back Audit</a>'
  +       '<a href="tools-image-studio.html" onclick="closeMobileMenu()">Photo Editor</a>'
  +       '<a href="tools-qr-generator.html" onclick="closeMobileMenu()">QR Generator</a>'
  +       '<a href="tools-invoice-generator.html" onclick="closeMobileMenu()">Invoice Generator</a>'
  +       '<a href="tools-sign-pdf.html" onclick="closeMobileMenu()">Sign PDF</a>'
  +       '<a href="tools.html" onclick="closeMobileMenu()" style="color:var(--accent2) !important;">View All Tools</a>'
  +     '</div>'
  +     '<a href="#" onclick="event.preventDefault();toggleMobileSubmenu(\'mobile-ai-sub\')">AI <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-left:6px;"><polyline points="6 9 12 15 18 9"/></svg></a>'
  +     '<div id="mobile-ai-sub" class="mobile-submenu" style="display:none;">'
  +       '<a href="tools-ai-design-studio.html" onclick="closeMobileMenu()">AI Design Studio</a>'
  +       '<a href="tools-script-builder.html" onclick="closeMobileMenu()">AI Script Builder</a>'
  +     '</div>'
  +     '<a href="pricing.html" onclick="closeMobileMenu()">Pricing</a>'
  +     '<a href="about.html" onclick="closeMobileMenu()">About</a>'
  +     '<a href="/learn/" onclick="closeMobileMenu()">Learning Hub</a>'
  +     '<a href="blog.html" onclick="closeMobileMenu()">Blog</a>'
  +   '</div>'
  +   '<div class="mobile-menu-bottom">'
  +     '<a class="mobile-cta" href="dashboard.html" id="mobile-dashboard-link" style="display:none;">Go to Dashboard</a>'
  +     '<button class="mobile-cta" onclick="openSignupModal()" id="mobile-signup-btn">Get started free</button>'
  +     '<button class="mobile-signin" onclick="openAuthModal()">Sign in</button>'
  +   '</div>'
  + '</div>'

  // Nav bar
  + '<nav>'
  +   '<a class="logo" href="index.html"><img src="/logo.png" alt=""> Ryxa</a>'
  +   '<div class="nav-links" id="nav-links">'
  +     '<a href="dashboard.html" id="dashboard-link" style="display:none;color:#c4b5fd;font-weight:500;">Dashboard</a>'

  // Tools dropdown
  +     '<div class="nav-tools-wrap">'
  +       '<button class="nav-tools-trigger" type="button" onclick="window.location.href=\'tools.html\'">Tools <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'
  +       '<div class="nav-tools-menu"><div class="nav-tools-grid">'
  +         '<a href="tools-link-in-bio.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Link in Bio <span class="nav-tools-tier popular">Popular</span></div><div class="nav-tools-item-desc">A clean, customizable page for all your links</div></div></a>'
  +         '<a href="tools-brand-deal-crm.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 12h18"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Brand Deal CRM <span class="nav-tools-tier max">Max</span></div><div class="nav-tools-item-desc">Track partnerships, contracts, deliverables, revenue</div></div></a>'
  +         '<a href="tools-course-builder.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Course Builder <span class="nav-tools-tier max">Max</span></div><div class="nav-tools-item-desc">Build and sell courses with Stripe payments</div></div></a>'
  +         '<a href="tools-coaching.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">1:1 Coaching <span class="nav-tools-tier max">Max</span></div><div class="nav-tools-item-desc">Sell private sessions and consultations</div></div></a>'
  +         '<a href="tools-media-kit.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="17" x2="8" y2="13"/><line x1="12" y1="17" x2="12" y2="11"/><line x1="16" y1="17" x2="16" y2="15"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Media Kit <span class="nav-tools-tier pro">Pro</span></div><div class="nav-tools-item-desc">Pitch brands with a pro media kit and rate card</div></div></a>'
  +         '<a href="tools-grid-planner.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Grid Planner <span class="nav-tools-tier free">Free</span></div><div class="nav-tools-item-desc">Plan your social grid, drag to reorder</div></div></a>'
  +         '<a href="tools-follower-audit.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Follow-Back Audit <span class="nav-tools-tier free">Free</span></div><div class="nav-tools-item-desc">See who unfollowed you on Instagram</div></div></a>'
  +         '<a href="tools-image-studio.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Photo Editor <span class="nav-tools-tier free">Free</span></div><div class="nav-tools-item-desc">Crop, adjust, convert with creator-ready ratios</div></div></a>'
  +         '<a href="tools-qr-generator.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v1"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">QR Generator <span class="nav-tools-tier free">Free</span></div><div class="nav-tools-item-desc">Create QR codes for your links and profiles</div></div></a>'
  +         '<a href="tools-invoice-generator.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Invoice Generator <span class="nav-tools-tier free">Free</span></div><div class="nav-tools-item-desc">Pro invoices for brand deals and collaborations</div></div></a>'
  +         '<a href="tools-sign-pdf.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M3 17l3-3 2 2 5-5 3 3"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Sign PDF <span class="nav-tools-tier free">Free</span></div><div class="nav-tools-item-desc">Fill and sign PDFs — no printer, no scanner</div></div></a>'
  +       '</div>'
  +       '<div class="nav-tools-footer"><div style="font-size:12px;color:var(--muted);">12 tools, one workspace</div><a href="tools.html" class="nav-tools-footer-link">View all tools <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></a></div>'
  +       '</div>'
  +     '</div>'

  // AI dropdown
  +     '<div class="nav-tools-wrap">'
  +       '<button class="nav-tools-trigger" type="button" onclick="window.location.href=\'tools-ai-design-studio.html\'">AI <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'
  +       '<div class="nav-tools-menu" style="width:340px;">'
  +         '<a href="tools-ai-design-studio.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="10" ry="4.5"/><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(120 12 12)"/><circle cx="12" cy="12" r="2"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">AI Design Studio <span class="nav-tools-tier free">Free to start</span></div><div class="nav-tools-item-desc">Create graphics with AI background removal, captions, and more</div></div></a>'
  +         '<a href="tools-script-builder.html" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">AI Script Builder <span class="nav-tools-tier pro">Pro</span></div><div class="nav-tools-item-desc">Write scripts with AI hook generator and text assist</div></div></a>'
  +       '</div>'
  +     '</div>'

  +     '<a href="pricing.html" style="' + pricingStyle + '">Pricing</a>'
  +     '<a href="about.html" style="' + aboutStyle + '">About</a>'

  // Learning Hub dropdown
  +     '<div class="nav-tools-wrap">'
  +       '<button class="nav-tools-trigger" type="button" onclick="window.location.href=\'/learn/\'">Learning Hub <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'
  +       '<div class="nav-tools-menu" style="width:300px;">'
  +         '<a href="/learn/" class="nav-tools-item"><div class="nav-tools-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></svg></div><div class="nav-tools-item-content"><div class="nav-tools-item-title">Dashboard Login</div><div class="nav-tools-item-desc">Access courses and bookings you\'ve purchased</div></div></a>'
  +       '</div>'
  +     '</div>'

  +     '<a href="blog.html" style="' + blogStyle + '">Blog</a>'
  +   '</div>'

  // Right side buttons
  +   '<div class="nav-right">'
  +     '<button class="btn-ghost" onclick="openAuthModal()" id="nav-signin-btn">Sign in</button>'
  +     '<button class="btn-nav-cta" onclick="openSignupModal()">Get started free</button>'
  +   '</div>'
  +   '<button class="hamburger" id="hamburger-btn" onclick="toggleMobileMenu()" aria-label="Menu"><span></span><span></span><span></span></button>'
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
  +       '<a href="index.html" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:var(--text);font-family:\'Syne\',sans-serif;font-weight:800;font-size:20px;margin-bottom:12px;"><img src="/logo.png" alt="" style="width:32px;height:32px;object-fit:contain;"> Ryxa</a>'
  +       '<p style="font-size:13px;color:var(--muted);line-height:1.6;max-width:200px;margin-bottom:16px;">Ryxa makes earning money and professional branding easy.</p>'
  +       '<a href="https://www.instagram.com/ryxa.io" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--muted);transition:all 0.15s;" aria-label="Instagram">'
  +         '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>'
  +       '</a>'
  +     '</div>'
  +     '<div>'
  +       '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:13px;margin-bottom:14px;">Tools</div>'
  +       '<div style="display:flex;flex-direction:column;gap:8px;">'
  +         '<a href="tools-link-in-bio.html" style="color:var(--muted);font-size:13px;text-decoration:none;">Link in Bio</a>'
  +         '<a href="tools-course-builder.html" style="color:var(--muted);font-size:13px;text-decoration:none;">Course Builder</a>'
  +         '<a href="tools-coaching.html" style="color:var(--muted);font-size:13px;text-decoration:none;">1:1 Coaching</a>'
  +         '<a href="tools-brand-deal-crm.html" style="color:var(--muted);font-size:13px;text-decoration:none;">Brand Deal CRM</a>'
  +         '<a href="tools-media-kit.html" style="color:var(--muted);font-size:13px;text-decoration:none;">Media Kit</a>'
  +         '<a href="tools-ai-design-studio.html" style="color:var(--muted);font-size:13px;text-decoration:none;">AI Design Studio</a>'
  +         '<a href="tools-script-builder.html" style="color:var(--muted);font-size:13px;text-decoration:none;">AI Script Builder</a>'
  +         '<a href="tools.html" style="color:var(--muted);font-size:13px;text-decoration:none;">View All Tools</a>'
  +       '</div>'
  +     '</div>'
  +     '<div>'
  +       '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:13px;margin-bottom:14px;">Product</div>'
  +       '<div style="display:flex;flex-direction:column;gap:8px;">'
  +         '<a href="pricing.html" style="color:var(--muted);font-size:13px;text-decoration:none;">Pricing</a>'
  +         '<a href="/learn/" style="color:var(--muted);font-size:13px;text-decoration:none;">Learning Hub</a>'
  +         '<a href="blog.html" style="color:var(--muted);font-size:13px;text-decoration:none;">Blog</a>'
  +       '</div>'
  +     '</div>'
  +     '<div>'
  +       '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:13px;margin-bottom:14px;">Company</div>'
  +       '<div style="display:flex;flex-direction:column;gap:8px;">'
  +         '<a href="about.html" style="color:var(--muted);font-size:13px;text-decoration:none;">About</a>'
  +         '<a href="privacy.html" style="color:var(--muted);font-size:13px;text-decoration:none;">Privacy</a>'
  +         '<a href="terms.html" style="color:var(--muted);font-size:13px;text-decoration:none;">Terms</a>'
  +       '</div>'
  +     '</div>'
  +     '<div>'
  +       '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:13px;margin-bottom:14px;">Support</div>'
  +       '<div style="display:flex;flex-direction:column;gap:8px;">'
  +         '<a href="mailto:hello@ryxa.io" style="color:var(--muted);font-size:13px;text-decoration:none;">hello@ryxa.io</a>'
  +       '</div>'
  +     '</div>'
  +   '</div>'
  +   '<div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:20px;width:100%;clear:both;">'
  +     '<p style="font-size:12px;color:var(--muted);margin:0;">&copy; ' + new Date().getFullYear() + ' MRLA Media LLC &middot; Ryxa</p>'
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
function siteNavCheckAuth() {
  try {
    var sb = window.supabase ? window.supabase.createClient(
      'https://kjytapcgxukalwsyputk.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI1OTkyODYsImV4cCI6MjA1ODE3NTI4Nn0.lOEoyBEFMV0bRoGjLoGsu3gRT25xGSnmlaJ2cBn-xqA'
    ) : null;
    if (sb) {
      sb.auth.getSession().then(function(res) {
        if (res.data.session) {
          var dashLink = document.getElementById('dashboard-link');
          var signinBtn = document.getElementById('nav-signin-btn');
          var mobileDash = document.getElementById('mobile-dashboard-link');
          var mobileSignup = document.getElementById('mobile-signup-btn');
          if (dashLink) dashLink.style.display = 'inline';
          if (signinBtn) signinBtn.style.display = 'none';
          if (mobileDash) mobileDash.style.display = 'block';
          if (mobileSignup) mobileSignup.style.display = 'none';
        }
      });
    }
  } catch(e) {}
}

// =====================
// INIT
// =====================
renderHeader();
renderFooter();
document.body.classList.add('site-ready');

})();
