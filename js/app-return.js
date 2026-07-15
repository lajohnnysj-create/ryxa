// app-return.js
// Landing page for Stripe checkout returns that originated inside the
// native app. Checkout runs in Safari, so this page hands the user back
// to the app via the ryxa:// deep link. CSP-safe: external file only.

(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var status = params.get('status');
  var cancelled = status === 'cancelled';
  var billing = status === 'billing';
  var target = cancelled ? 'ryxa://payment-cancelled'
    : (billing ? 'ryxa://billing-return' : 'ryxa://payment-success');

  var title = document.getElementById('return-title');
  var body = document.getElementById('return-body');
  var btn = document.getElementById('return-btn');

  if (cancelled && title && body) {
    title.textContent = 'Checkout cancelled';
    body.textContent = 'No charge was made. Tap below to head back to the app.';
  } else if (billing && title && body) {
    // Returning from the Stripe billing portal: the user may have changed or
    // cancelled a plan, or just viewed invoices. Don't imply a payment.
    title.textContent = 'Returning to Ryxa...';
    body.textContent = 'Taking you back to the app. If nothing happens, tap the button below.';
  } else if (title) {
    title.textContent = 'Payment complete!';
  }

  if (btn) btn.setAttribute('href', target);

  // Attempt the handoff automatically. iOS may require the tap fallback.
  window.location.href = target;
})();
