// FindTheSnakes Cookie Banner
// Include on any page: <script src="/cookie-banner.js"></script>
// Renders a small banner on first visit; remembers consent via localStorage.

(function() {
  'use strict';

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
    '  font-family: "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif;',
    '  font-size: 13px;',
    '  line-height: 1.55;',
    '  box-shadow: 0 12px 40px rgba(0,0,0,0.5);',
    '  backdrop-filter: blur(16px);',
    '  -webkit-backdrop-filter: blur(16px);',
    '  z-index: 2147483646;',
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
    '  font-family: "Syne", "DM Sans", sans-serif;',
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
    '  font-family: inherit;',
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
      '<div>We use essential cookies to keep you signed in and the service running, plus minimal analytics to understand how our tools are used. No advertising, no selling your data. <a href="/privacy.html">Privacy policy</a>.</div>' +
      '<div class="fts-cookie-actions">' +
        '<button class="fts-cookie-accept" type="button">Got it</button>' +
        '<button class="fts-cookie-decline" type="button">Learn more</button>' +
      '</div>';

    document.body.appendChild(banner);

    banner.querySelector('.fts-cookie-accept').addEventListener('click', function() {
      saveConsent(true);
      banner.remove();
    });
    banner.querySelector('.fts-cookie-decline').addEventListener('click', function() {
      window.location.href = '/privacy.html';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountBanner);
  } else {
    mountBanner();
  }
})();
