/* Purchase complete page.
 *
 * Runs for GUEST purchases only (the checkout endpoint sends logged-in buyers
 * straight to the Hub). It must assume two things are NOT true:
 *   1. that the visitor is signed in
 *   2. that the webhook has already finished
 *
 * Stripe redirects the browser and calls the webhook independently, with no
 * guaranteed order, so the page polls until the purchase row appears rather
 * than erroring on a race it should expect.
 *
 * Every branch ends with the buyer able to reach their purchase. If anything
 * here fails, the emailed link and the Hub's "Email me a login link" remain,
 * so a purchase is never stranded.
 */

var SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

var params = new URLSearchParams(window.location.search);
var SESSION_ID = params.get('session_id') || '';
var PRODUCT_ID = params.get('id') || '';

var POLL_INTERVAL_MS = 2000;
var POLL_MAX_ATTEMPTS = 12; // ~24s, generous for webhook latency

var els = {};
var buyerEmail = '';

function show(id) {
  ['state-processing', 'state-password', 'state-ready', 'state-error'].forEach(function (s) {
    var el = document.getElementById(s);
    if (el) el.style.display = (s === id) ? 'block' : 'none';
  });
}

function setError(msg) {
  var el = document.getElementById('error-text');
  if (el) el.textContent = msg;
  show('state-error');
}

function hubUrl() {
  if (PRODUCT_ID) return '/learn/?dp=' + encodeURIComponent(PRODUCT_ID) + '&purchased=1';
  return '/learn/';
}

async function callApi(payload) {
  var res = await fetch('/api/purchase-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Poll until the webhook has written the purchase row.
async function pollStatus(attempt) {
  attempt = attempt || 1;
  try {
    var data = await callApi({ action: 'status', session_id: SESSION_ID });

    if (data.status === 'processing') {
      if (attempt >= POLL_MAX_ATTEMPTS) {
        // The purchase is safe regardless: the webhook retries, and the email
        // is on its way. Tell them the truth and hand them the recovery path.
        setError('Your payment went through and your purchase is being set up. Check your email in a moment for your access link.');
        return;
      }
      setTimeout(function () { pollStatus(attempt + 1); }, POLL_INTERVAL_MS);
      return;
    }

    buyerEmail = data.email || '';
    if (PRODUCT_ID === '' && data.product_id) PRODUCT_ID = data.product_id;

    if (data.status === 'needs_password') {
      var emailEl = document.getElementById('locked-email');
      if (emailEl) emailEl.value = buyerEmail;
      var noteEl = document.getElementById('email-note');
      if (noteEl) noteEl.textContent = 'We also sent an access link to ' + buyerEmail + '.';
      show('state-password');
      return;
    }

    // Existing account, already has a password.
    var readyNote = document.getElementById('ready-note');
    if (readyNote) readyNote.textContent = 'Your purchase is in the Ryxa Hub account for ' + buyerEmail + '.';
    var readyBtn = document.getElementById('ready-btn');
    if (readyBtn) readyBtn.setAttribute('href', hubUrl());
    show('state-ready');
  } catch (e) {
    setError(e.message || 'We could not confirm this purchase. Check your email for your access link.');
  }
}

async function handleSetPassword() {
  var pw = document.getElementById('new-password').value;
  var btn = document.getElementById('set-password-btn');
  var err = document.getElementById('password-error');

  err.style.display = 'none';

  if (!pw || pw.length < 8) {
    err.textContent = 'Password must be at least 8 characters.';
    err.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Setting up...';

  try {
    await callApi({ action: 'set_password', session_id: SESSION_ID, password: pw });

    // Sign in with the credentials we just created, then go to the purchase.
    var signIn = await sb.auth.signInWithPassword({ email: buyerEmail, password: pw });
    if (signIn.error) {
      // Password is set even though sign-in hiccupped. Send them to the Hub
      // to sign in normally rather than pretending something broke.
      window.location.href = '/learn/';
      return;
    }
    window.location.href = hubUrl();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Set password and continue';
    err.textContent = e.message || 'Could not set your password. Use "Email me a login link" at the Ryxa Hub.';
    err.style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', function () {
  var btn = document.getElementById('set-password-btn');
  if (btn) btn.addEventListener('click', handleSetPassword);

  var pwInput = document.getElementById('new-password');
  if (pwInput) {
    pwInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleSetPassword();
    });
  }

  if (!SESSION_ID) {
    setError('This page needs a valid purchase link. Check your email for your access link.');
    return;
  }

  show('state-processing');
  pollStatus(1);
});
