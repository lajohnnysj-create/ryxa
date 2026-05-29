// Do Not Sell or Share toggle.
// Sets/clears localStorage 'ryxa_dns' = '1' flag, which the site-nav.js
// analytics loader checks before injecting Google Analytics.
//
// CSP-compatible: no inline handlers. All wiring in this file.

(function() {
  'use strict';

  var KEY = 'ryxa_dns';
  var btn = document.getElementById('dns-toggle-btn');
  var pill = document.getElementById('dns-pill');
  var metaText = document.getElementById('dns-meta-text');
  if (!btn || !pill || !metaText) return;

  function isOptedOut() {
    try { return localStorage.getItem(KEY) === '1'; }
    catch (e) { return false; }
  }

  function hasGpc() {
    return navigator.globalPrivacyControl === true;
  }

  function render() {
    var gpc = hasGpc();
    var optedOut = isOptedOut();

    if (gpc) {
      // GPC trumps the toggle. Show as opted-out and disable manual toggle.
      pill.textContent = 'Not sharing';
      pill.className = 'status-pill opted-out';
      metaText.textContent = 'Your browser is sending a Global Privacy Control signal. Analytics is blocked automatically.';
      btn.textContent = 'Blocked by Global Privacy Control';
      btn.className = 'toggle-btn opted-out';
      btn.disabled = true;
      return;
    }

    if (optedOut) {
      pill.textContent = 'Not sharing';
      pill.className = 'status-pill opted-out';
      metaText.textContent = 'Analytics is disabled on this device. Google Analytics will not load.';
      btn.textContent = 'Enable analytics on this device';
      btn.className = 'toggle-btn opted-out';
      btn.disabled = false;
    } else {
      pill.textContent = 'Sharing';
      pill.className = 'status-pill tracking';
      metaText.textContent = 'Analytics may load on this device, subject to your cookie banner consent.';
      btn.textContent = 'Opt out of analytics on this device';
      btn.className = 'toggle-btn';
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', function() {
    if (hasGpc()) return; // shouldn't be reachable but defensive

    var currentlyOptedOut = isOptedOut();
    try {
      if (currentlyOptedOut) {
        localStorage.removeItem(KEY);
      } else {
        localStorage.setItem(KEY, '1');
      }
    } catch (e) {
      alert('Could not save your preference. Please check that browser storage is enabled.');
      return;
    }
    render();
  });

  render();
})();
