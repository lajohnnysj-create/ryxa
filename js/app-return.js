// app-return.js
// Landing page for Stripe checkout returns that originated inside the
// native app. Checkout runs in Safari, so this page hands the user back
// to the app via the ryxa:// deep link. CSP-safe: external file only.

(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var cancelled = params.get('status') === 'cancelled';
  var target = cancelled ? 'ryxa://payment-cancelled' : 'ryxa://payment-success';

  var title = document.getElementById('return-title');
  var body = document.getElementById('return-body');
  var btn = document.getElementById('return-btn');

  if (cancelled && title && body) {
    title.textContent = 'Checkout cancelled';
    body.textContent = 'No charge was made. Tap below to head back to the app.';
  } else if (title) {
    title.textContent = 'Payment complete!';
  }

  if (btn) btn.setAttribute('href', target);

  // Attempt the handoff automatically. iOS may require the tap fallback.
  window.location.href = target;
})();
