/* reset-password-page.js: Supabase password reset flow.
   CSP-compatible: no inline handlers. Loaded after the Supabase CDN script. */
(function () {
  'use strict';

  var yearEl = document.getElementById('copy-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  var SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
  var createClient = supabase.createClient;
  // autoRefreshToken stays OFF outside the dashboard. Only one page per
// origin may run the background refresh timer; multiple timers race for
// the single-use refresh token and trip Supabase reuse detection, which
// revokes the session (the random logout bug). Reads still refresh
// on demand when a real action needs a fresh token.
  var sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: false }
  });

  // Where to send them after a successful reset. The purchase email appends
  // ?next=/learn/?dp=... so a buyer lands on what they just bought rather than
  // the marketing homepage. Only same-origin paths are honored: an open
  // redirect here would be a phishing gift.
  function safeNext() {
    try {
      var next = new URLSearchParams(window.location.search).get('next');
      if (next && next.charAt(0) === '/' && next.charAt(1) !== '/') return next;
    } catch (e) {}
    return 'index.html';
  }

  // Password links are single-use and expire (Supabase OTP expiry). Opening the
  // email hours later means no session was established, and submitting the form
  // would surface a raw "Auth session missing" error. Show the recovery path
  // instead: the Hub's "Email me a login link" always works, because the
  // account and its purchases persist regardless of any old link.
  async function gateOnSession() {
    var form = document.getElementById('reset-form');
    var expired = document.getElementById('reset-expired');
    if (!form || !expired) return;

    // Supabase parses the recovery token out of the URL hash asynchronously.
    // Give it a beat before deciding there is no session.
    var session = null;
    for (var i = 0; i < 6; i++) {
      var got = await sb.auth.getSession();
      session = got && got.data ? got.data.session : null;
      if (session) break;
      await new Promise(function (r) { setTimeout(r, 200); });
    }

    if (session) return; // valid link, leave the form visible

    var hubBtn = document.getElementById('expired-hub-btn');
    if (hubBtn) {
      var next = safeNext();
      hubBtn.setAttribute('href', next.indexOf('/learn') === 0 ? next : '/learn/');
    }
    form.style.display = 'none';
    expired.style.display = 'block';
  }

  function showMsg(type, text) {
    var el = document.getElementById('msg');
    el.className = 'msg ' + type;
    el.textContent = text;
    el.style.display = 'block';
  }

  async function resetPassword() {
    var newPass = document.getElementById('new-password').value;
    var confirmPass = document.getElementById('confirm-password').value;
    var btn = document.getElementById('reset-btn');

    if (!newPass || newPass.length < 6) {
      showMsg('error', 'Password must be at least 6 characters.');
      return;
    }
    if (newPass !== confirmPass) {
      showMsg('error', 'Passwords do not match.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Updating...';

    var { error } = await sb.auth.updateUser({ password: newPass });

    if (error) {
      var m = String(error.message || '');
      if (/session|expired|invalid|token/i.test(m)) {
        m = 'This link has expired. Go to the Ryxa Hub and choose "Email me a login link" with the email you purchased with.';
      }
      showMsg('error', m);
      btn.disabled = false;
      btn.textContent = 'Update password';
    } else {
      showMsg('success', 'Password updated successfully! Redirecting...');
      setTimeout(function () { window.location.href = safeNext(); }, 1500);
    }
  }

  function init() {
    gateOnSession();

    var btn = document.getElementById('reset-btn');
    if (btn) btn.addEventListener('click', resetPassword);

    // Allow pressing Enter to submit
    var confirmField = document.getElementById('confirm-password');
    if (confirmField) {
      confirmField.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') resetPassword();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
