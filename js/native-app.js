// native-app.js
// Bridges the Ryxa dashboard to the native mobile app. Loaded on every
// dashboard visit but does NOTHING in a normal browser: everything is
// gated on window.RyxaNative, which only the native app injects.
//
// Adds "Alerts" and "App Settings" to the sidebar menu. Tapping them
// opens the app's native screens via the WebView message bridge.
// CSP-safe: external file, no inline handlers, delegated listener.

(function () {
  'use strict';

  if (!window.RyxaNative || !window.ReactNativeWebView) return;

  var ICONS = {
    alerts:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>'
  };

  function buildItem(screen, label, icon) {
    var btn = document.createElement('button');
    btn.className = 'sidebar-item';
    btn.id = 'nav-native-' + screen;
    btn.setAttribute('data-native-screen', screen);
    btn.setAttribute('type', 'button');

    var iconWrap = document.createElement('div');
    iconWrap.className = 'sidebar-item-icon';
    iconWrap.innerHTML = icon;

    var labelSpan = document.createElement('span');
    labelSpan.className = 'sidebar-item-label';
    labelSpan.textContent = label;

    btn.appendChild(iconWrap);
    btn.appendChild(labelSpan);
    return btn;
  }

  function insertItems() {
    var nav = document.querySelector('.sidebar-nav');
    if (!nav || document.getElementById('nav-native-alerts')) return;
    nav.appendChild(buildItem('alerts', 'Alerts', ICONS.alerts));
    nav.appendChild(buildItem('settings', 'App Settings', ICONS.settings));
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
    document.addEventListener('DOMContentLoaded', insertItems);
  } else {
    insertItems();
  }
})();
