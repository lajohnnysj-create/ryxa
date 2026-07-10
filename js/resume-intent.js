/* /js/resume-intent.js
 *
 * A buyer clicks "Get for free", has no account, and is sent to the Hub to make
 * one. They confirm by email and land back here. Without this, they meet the
 * same button they already pressed.
 *
 * THE INTENT TRAVELS IN THE URL, NOT IN localStorage.
 *
 * The first version used localStorage and failed in the most common case: the
 * confirmation email opens in Gmail's in-app browser, or a different default
 * browser, or on a phone when they signed up on a laptop. Different storage,
 * no intent, no resume. A URL survives all of that, because the email link
 * carries it.
 *
 * FOUR RULES, each closing a hole:
 *
 *   1. FREE ONLY. A paid product must never auto-open a Stripe session on page
 *      load. That is a checkout nobody clicked. Enforced by the caller.
 *
 *   2. EXPLICIT. The flag is only added when a buyer actually pressed a buy
 *      button and got bounced to sign in. Landing on a product page while
 *      logged in claims nothing.
 *
 *   3. SINGLE USE. The flag is stripped from the URL before the action runs,
 *      so a refresh cannot replay it and a thrown action cannot loop.
 *
 *   4. SESSION REQUIRED. Checked by the caller. A signed-out visitor with
 *      ?resume=1 in the URL gets an ordinary button.
 *
 * And one thing it deliberately does not carry: the marketing-consent
 * checkbox. Those pages hide it for logged-out visitors precisely because a
 * redirect would discard it. A consent value smuggled through a URL, across an
 * email round trip, is not consent worth recording.
 */
(function (global) {
  'use strict';

  var FLAG = 'resume';

  // Called before redirecting a logged-out buyer to the Hub. Returns the Hub
  // URL with the intent attached, so it can survive the email round trip.
  function hubUrlFor(pathname) {
    return '/learn/?redirect=' + encodeURIComponent(pathname) + '&' + FLAG + '=1';
  }

  // Called on page load. True exactly once, then the flag is removed from the
  // address bar so a refresh does nothing.
  function take() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return false; }
    if (params.get(FLAG) !== '1') return false;

    // Rule 3: strip before acting. history.replaceState leaves no entry, so
    // Back does not walk them into a second claim.
    try {
      params.delete(FLAG);
      var qs = params.toString();
      var clean = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
      window.history.replaceState({}, '', clean);
    } catch (e) {
      // A browser that refuses replaceState still claims once; the flag simply
      // survives a refresh. Acceptable: the action is idempotent server-side.
    }
    return true;
  }

  global.RyxaResume = { hubUrlFor: hubUrlFor, take: take };
})(window);
