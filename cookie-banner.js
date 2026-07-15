// FindTheSnakes Cookie Banner
// Include on any page: <script src="/cookie-banner.js"></script>
// Renders a small banner on first visit; remembers consent via localStorage.

(function() {
  'use strict';

  // Never show the cookie banner inside the native app. window.RyxaNative is
  // injected by the app wrapper before the page loads. Analytics is separately
  // blocked in-app (see ryxaLoadAnalytics), so there is nothing to consent to
  // here: only essential/session cookies run in the app, which need no consent
  // and are not tracking. This resolves Apple guideline 5.1.2(i) by removing
  // the cookie prompt from the app context, while the website keeps its banner
  // unchanged for real browser visitors.
  if (window.RyxaNative) return;
  // Also suppress the banner on pages the app opened in Safari (app=1 in the
  // URL, e.g. the pricing hand-off). Analytics are skipped on those loads too
  // (site-nav.js), so there is genuinely nothing to consent to.
  try {
    if (new URLSearchParams(window.location.search).get('app') === '1') return;
  } catch (e) { /* no URL access: fall through to normal behavior */ }

  var STORAGE_KEY = 'fts_cookie_consent';
  var CONSENT_VERSION = '1'; // bump to re-prompt if policy changes materially

  try {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      var parsed = JSON.parse(stored);
      if (parsed && parsed.v === CONSENT_VERSION) return; // already handled
    }
  } catch (e) { /* continue showing banner if storage fails */ }

  // Style injection — scoped to banner elements
  var style = document.createElement('style');
  style.textContent = [
    /* Defensive: some host pages (Link in Bio, Media Kit profiles) inject a
       creator-chosen font as `body, body * { font-family: X !important }`,
       which would otherwise override the banner's intended typography.
       This rule scopes the banner's font-family explicitly. */
    '#fts-cookie-banner, #fts-cookie-banner * {',
    '  font-family: "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif !important;',
    '}',
    '#fts-cookie-banner .fts-cookie-title {',
    '  font-family: "Syne", "DM Sans", sans-serif !important;',
    '}',
    '#fts-cookie-banner {',
    '  position: fixed;',
    '  bottom: 16px;',
    '  left: 16px;',
    '  right: 16px;',
    '  max-width: 520px;',
    '  margin: 0 auto;',
    '  background: rgba(15,15,26,0.98);',
    '  border: 1px solid rgba(255,255,255,0.15);',
    '  border-radius: 14px;',
    '  padding: 18px 20px;',
    '  color: #f0eef8;',
    '  font-size: 13px;',
    '  line-height: 1.55;',
    '  box-shadow: 0 12px 40px rgba(0,0,0,0.5);',
    '  backdrop-filter: blur(16px);',
    '  -webkit-backdrop-filter: blur(16px);',
    '  z-index: 1000;',
    '  animation: fts-cookie-up 280ms cubic-bezier(0.22,1,0.36,1);',
    '  box-sizing: border-box;',
    '}',
    '@keyframes fts-cookie-up {',
    '  from { opacity: 0; transform: translateY(12px); }',
    '  to { opacity: 1; transform: translateY(0); }',
    '}',
    '#fts-cookie-banner a {',
    '  color: #c4b5fd;',
    '  text-decoration: underline;',
    '  text-underline-offset: 2px;',
    '}',
    '#fts-cookie-banner .fts-cookie-title {',
    '  font-weight: 700;',
    '  color: #fff;',
    '  margin-bottom: 4px;',
    '  font-size: 14px;',
    '  letter-spacing: -0.2px;',
    '}',
    '#fts-cookie-banner .fts-cookie-actions {',
    '  display: flex;',
    '  gap: 8px;',
    '  margin-top: 12px;',
    '  flex-wrap: wrap;',
    '}',
    '#fts-cookie-banner button {',
    '  font-size: 12px;',
    '  font-weight: 500;',
    '  padding: 8px 16px;',
    '  border-radius: 8px;',
    '  cursor: pointer;',
    '  border: 1px solid transparent;',
    '  transition: all 0.15s;',
    '}',
    '#fts-cookie-banner .fts-cookie-accept {',
    '  background: #7c3aed;',
    '  color: #fff;',
    '  box-shadow: 0 0 18px rgba(124,58,237,0.35);',
    '}',
    '#fts-cookie-banner .fts-cookie-accept:hover { background: #a855f7; }',
    '#fts-cookie-banner .fts-cookie-decline {',
    '  background: transparent;',
    '  color: #b4b2c8;',
    '  border-color: rgba(255,255,255,0.18);',
    '}',
    '#fts-cookie-banner .fts-cookie-decline:hover {',
    '  color: #fff;',
    '  border-color: rgba(255,255,255,0.32);',
    '}',
    '@media (max-width: 540px) {',
    '  #fts-cookie-banner {',
    '    left: 12px;',
    '    right: 12px;',
    '    bottom: 12px;',
    '    padding: 14px 16px;',
    '    font-size: 12.5px;',
    '  }',
    '  #fts-cookie-banner .fts-cookie-title { font-size: 13px; }',
    '}',
    ''
  ].join('\n');
  document.head.appendChild(style);

  function saveConsent(accepted) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: CONSENT_VERSION,
        accepted: !!accepted,
        ts: Date.now(),
      }));
    } catch (e) { /* ignore */ }
  }

  function mountBanner() {
    var banner = document.createElement('div');
    banner.id = 'fts-cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie notice');
    banner.innerHTML =
      '<div class="fts-cookie-title">Cookies &amp; your data</div>' +
      '<div>We use essential cookies to keep you signed in and the service running, plus Google Analytics to understand how our tools are used. No advertising, no selling your data. <a href="/privacy.html">Privacy policy</a> &middot; <a href="/do-not-sell.html">Do Not Sell or Share My Personal Information</a>.</div>' +
      '<div class="fts-cookie-actions">' +
        '<button class="fts-cookie-accept" type="button">Accept</button>' +
        '<button class="fts-cookie-decline" type="button">Decline analytics</button>' +
      '</div>';

    document.body.appendChild(banner);

    banner.querySelector('.fts-cookie-accept').addEventListener('click', function() {
      saveConsent(true);
      // Fire analytics immediately so the user is tracked from this point on
      // without needing a page reload. The loader self-guards against double
      // injection if already loaded.
      try { if (typeof window.ryxaLoadAnalytics === 'function') window.ryxaLoadAnalytics(); } catch (e) {}
      banner.remove();
    });
    banner.querySelector('.fts-cookie-decline').addEventListener('click', function() {
      saveConsent(false);
      banner.remove();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountBanner);
  } else {
    mountBanner();
  }
})();
