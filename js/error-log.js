// error-log.js
// First-party client error capture for the Ryxa dashboard. Reports every
// uncaught JavaScript error and unhandled promise rejection to
// /api/log-error so problems users hit in the wild are queryable instead
// of lost. CSP-safe: external file, no inline code, no third parties.
//
// Include on dashboard.html with:
//   <script src="/js/error-log.js"></script>
// placed BEFORE the other dashboard scripts so early errors are caught.

(function () {
  'use strict';

  var reported = 0;
  var MAX_PER_PAGE = 10; // never let a render loop flood the endpoint

  function send(message, stack) {
    if (reported >= MAX_PER_PAGE) return;
    reported++;
    try {
      var payload = {
        message: String(message || 'Unknown error').slice(0, 1000),
        stack: stack ? String(stack).slice(0, 5000) : null,
        page: window.location.pathname + window.location.search,
        app_version: window.RyxaNative ? 'app-' + (window.RyxaNative.version || '?') : 'web'
      };
      var headers = { 'Content-Type': 'application/json' };
      // Attach identity when available so errors are searchable per user.
      try {
        var raw = window.localStorage.getItem('sb-kjytapcgxukalwsyputk-auth-token');
        if (raw) {
          var tok = JSON.parse(raw);
          if (tok && tok.access_token) headers['Authorization'] = 'Bearer ' + tok.access_token;
        }
      } catch (e) {}
      fetch('/api/log-error', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (e) {
      // The error logger must never itself become a source of errors.
    }
  }

  window.addEventListener('error', function (event) {
    // Ignore resource load errors (img/script 404s); those are noise here.
    if (!event.error && !event.message) return;
    send(event.message, event.error && event.error.stack);
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    if (reason && reason.message) {
      send(reason.message, reason.stack);
    } else {
      send(typeof reason === 'string' ? reason : 'Unhandled promise rejection');
    }
  });
})();
