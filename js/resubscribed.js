/* Shows one of three states based on ?status=, set by the redirect from
 * /api/confirm-resubscribe.
 *
 * The page is CSP-clean: no inline script, no inline handlers. The status is
 * read from the URL rather than trusted as content, and it is matched against
 * a fixed set, so an arbitrary ?status=<script> can never reach the DOM.
 */
(function () {
  var VALID = { ok: 'state-ok', invalid: 'state-invalid', error: 'state-error' };

  var status;
  try {
    status = new URLSearchParams(window.location.search).get('status');
  } catch (e) {
    status = null;
  }

  // Anything unrecognised falls back to the invalid state rather than showing
  // nothing. A blank card looks broken, and "invalid" is the safe claim: it
  // never asserts that a subscription changed.
  var id = VALID[status] || 'state-invalid';
  var el = document.getElementById(id);
  if (el) el.hidden = false;
})();
