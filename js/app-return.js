// app-return.js
// Landing page for Stripe checkout returns that originated inside the
// native app. Checkout runs in the system browser (Safari on iOS, Chrome or
// the user's default on Android), so this page hands the user back to the app
// via a deep link: ryxa:// on iOS, an intent:// URL on Android.
// CSP-safe: external file only.

(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var status = params.get('status');
  var cancelled = status === 'cancelled';
  var billing = status === 'billing';
  var host = cancelled ? 'payment-cancelled'
    : (billing ? 'billing-return' : 'payment-success');
  var target = 'ryxa://' + host;

  // Android: Chrome blocks automatic custom scheme redirects that happen
  // without a user gesture, so the ryxa:// handoff below would silently do
  // nothing and every Android user would have to tap the fallback button.
  // An intent:// URL is the mechanism Chrome does honour, and it names the
  // package explicitly so there is no chooser. S.browser_fallback_url keeps
  // someone without the app installed on a real page instead of an error.
  // iOS is untouched and keeps the ryxa:// scheme it ships with today.
  var isAndroid = /Android/i.test(navigator.userAgent || '');
  if (isAndroid) {
    // Where to send someone whose device has no Ryxa app installed. Must match
    // the outcome: a cancelled checkout landing on a success page would be a
    // lie, so only the success and billing returns carry payment=success.
    var fallbackUrl = cancelled
      ? 'https://www.ryxa.io/dashboard.html'
      : 'https://www.ryxa.io/dashboard.html?payment=success';
    target =
      'intent://' + host + '#Intent;scheme=ryxa;package=io.ryxa.app;' +
      'S.browser_fallback_url=' + encodeURIComponent(fallbackUrl) + ';end';
  }

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

  // Attempt the handoff automatically. iOS may still require the tap fallback;
  // Android goes through the intent URL above, which Chrome honours directly.
  window.location.href = target;
})();
