// native-app.js
// Bridges Ryxa web pages to the native mobile app. Loaded on the dashboard
// and on marketing pages the app can reach (pricing). Does NOTHING in a
// normal browser: everything is gated on window.RyxaNative, which only the
// native app injects. Platform-agnostic on purpose: iOS today, Android
// inherits the same behavior automatically if that build ships later.
//
// Dashboard pages: adds a phone icon (native App Settings) and a bell
// (native Alerts) at the right end of the topbar.
// Marketing pages (anything with #site-header): hides the site nav and
// footer and adds a slim safe-area "Back to Dashboard" bar instead.
// CSP-safe: external file, no inline handlers, delegated listener.

(function () {
  'use strict';

  if (!window.RyxaNative || !window.ReactNativeWebView) return;

  var ICONS = {
    alerts:
      '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    settings:
      '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
    back:
      '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>'
  };

  // ==== Dashboard mode: phone (App Settings) + bell (Alerts) in topbar ====

  function makeTopbarButton(id, screen, label, icon) {
    var btn = document.createElement('button');
    btn.id = id;
    btn.setAttribute('data-native-screen', screen);
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', label);
    btn.style.background = 'none';
    btn.style.border = 'none';
    btn.style.padding = '6px';
    btn.style.cursor = 'pointer';
    btn.style.color = 'var(--text)';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.innerHTML = icon;
    return btn;
  }

  function insertTopbarButtons() {
    var right = document.querySelector('.topbar-right');
    if (!right || document.getElementById('native-alerts-bell')) return;

    var phone = makeTopbarButton('native-app-settings', 'settings', 'App Settings', ICONS.settings);
    phone.style.marginLeft = '10px';

    var bell = makeTopbarButton('native-alerts-bell', 'alerts', 'Alerts', ICONS.alerts);
    bell.style.marginLeft = '8px';
    // Negative margin cancels the button's own right padding (and a touch
    // more) so the glyph sits flush against the topbar's content edge.
    bell.style.marginRight = '-9px';

    right.appendChild(phone);
    right.appendChild(bell);
  }

  // ==== Marketing page mode (pricing and any page with #site-header) ====

  // Inside the app, the site nav is redundant and sits in the notch zone.
  // Replace it with a slim bar that respects the safe area and returns to
  // the dashboard.
  function setupMarketingPage() {
    var header = document.getElementById('site-header');
    if (!header || document.getElementById('native-back-bar')) return;

    header.style.display = 'none';
    var footer = document.getElementById('site-footer');
    if (footer) footer.style.display = 'none';

    // Inside the bottom sheet, the sheet's own header provides the exit,
    // so skip the Back to Dashboard bar and its body padding.
    if (window.RyxaNative.sheet) return;

    var bar = document.createElement('div');
    bar.id = 'native-back-bar';
    bar.style.position = 'fixed';
    bar.style.top = '0';
    bar.style.left = '0';
    bar.style.right = '0';
    bar.style.zIndex = '200';
    bar.style.background = 'var(--bg, #0a0a14)';
    bar.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
    bar.style.paddingTop = 'calc(10px + env(safe-area-inset-top, 0px))';
    bar.style.paddingBottom = '10px';
    bar.style.paddingLeft = '16px';
    bar.style.paddingRight = '16px';

    var link = document.createElement('a');
    link.href = '/dashboard';
    link.setAttribute('aria-label', 'Back to Dashboard');
    link.style.display = 'inline-flex';
    link.style.alignItems = 'center';
    link.style.gap = '8px';
    link.style.color = 'var(--text, #ffffff)';
    link.style.textDecoration = 'none';
    link.style.fontSize = '15px';
    link.style.fontWeight = '600';
    link.innerHTML = ICONS.back + '<span>Back to Dashboard</span>';

    bar.appendChild(link);
    document.body.appendChild(bar);

    // Push page content below the fixed bar.
    document.body.style.paddingTop = 'calc(48px + env(safe-area-inset-top, 0px))';
  }

  function insertAll() {
    insertTopbarButtons();
    setupMarketingPage();
  }

  function closeSidebar() {
    var overlay = document.getElementById('sidebar-overlay');
    if (overlay && overlay.classList.contains('open')) overlay.click();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest
      ? e.target.closest('[data-native-screen]')
      : null;
    if (!btn) return;
    e.preventDefault();
    var screen = btn.getAttribute('data-native-screen');
    try {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: 'openNative', screen: screen })
      );
    } catch (err) {
      // Bridge unavailable. Nothing sensible to do in-page.
    }
    closeSidebar();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', insertAll);
  } else {
    insertAll();
  }
})();
