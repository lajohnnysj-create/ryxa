/* /js/resume-intent.js
 *
 * A buyer clicks "Get for free", has no account, and gets sent to the Hub to
 * make one. They confirm by email and land back here. Without this, they see
 * the same button they already pressed, and have to press it again.
 *
 * This records what they were doing before the redirect and replays it on
 * return.
 *
 * FOUR RULES, and each one closes a hole:
 *
 *   1. FREE ONLY. A paid product must never auto-open a Stripe session on page
 *      load. That is a checkout nobody clicked.
 *
 *   2. PATH-SCOPED. The stored intent names the page it belongs to. Returning
 *      to a different product must not claim this one.
 *
 *   3. SHORT TTL. Ten minutes. Without it, someone who abandoned a claim in
 *      March gets a mystery enrollment in June when they revisit the page.
 *
 *   4. SINGLE USE. Cleared before the action runs, not after. If the action
 *      throws, they get a button, not an infinite retry loop.
 *
 * And one thing it deliberately does NOT do: carry the marketing-consent
 * checkbox. Those pages hide the checkbox for logged-out visitors precisely
 * because a redirect would discard it. Persisting a consent value across a
 * login round trip, through localStorage, on a device that may not be the one
 * that returns, is not consent worth recording.
 */
(function (global) {
  'use strict';

  var KEY = 'ryx_resume_intent';
  var TTL_MS = 10 * 60 * 1000;

  function save(kind) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        kind: kind,                       // 'product' | 'course' | 'booking'
        path: window.location.pathname,   // rule 2
        ts: Date.now()                    // rule 3
      }));
    } catch (e) {
      // Private mode, quota, a browser that refuses. Losing the fast path is
      // fine; the button still works.
    }
  }

  function take(kind) {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return false; }
    if (!raw) return false;

    // Rule 4: clear first. A throwing action must not be able to replay.
    try { localStorage.removeItem(KEY); } catch (e) { /* nothing to do */ }

    var intent;
    try { intent = JSON.parse(raw); } catch (e) { return false; }
    if (!intent || intent.kind !== kind) return false;
    if (intent.path !== window.location.pathname) return false;
    if (!intent.ts || (Date.now() - intent.ts) > TTL_MS) return false;

    return true;
  }

  global.RyxaResume = { save: save, take: take };
})(window);
