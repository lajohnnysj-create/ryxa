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
      showMsg('error', error.message);
      btn.disabled = false;
      btn.textContent = 'Update password';
    } else {
      showMsg('success', 'Password updated successfully! Redirecting...');
      setTimeout(function () { window.location.href = 'index.html'; }, 2000);
    }
  }

  function init() {
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
