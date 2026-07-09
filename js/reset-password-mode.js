/* Runs BLOCKING in <head>, before the body paints.
 *
 * A purchase link carries ?next=; an ordinary password reset never does. Set a
 * class on <html> now so CSS can render the correct heading immediately. Doing
 * this later, from the main page script, means the wrong heading paints first
 * and visibly swaps.
 *
 * Only same-origin paths count. An open redirect on a password page would be a
 * phishing gift, so the same guard as safeNext() applies here.
 */
(function () {
  try {
    var next = new URLSearchParams(window.location.search).get('next');
    if (next && next.charAt(0) === '/' && next.charAt(1) !== '/') {
      document.documentElement.classList.add('rp-purchase');
    }
  } catch (e) {}
})();
