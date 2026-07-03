// admin-page.js
// UI for /admin.html. All authorization happens server-side in
// /api/admin-data (verified email + Google identity); this script only
// handles sign-in UX and rendering. All data renders via textContent, so
// logged error messages and stacks can never inject markup.

(function () {
  'use strict';

  var sb = window.supabase.createClient(
    'https://kjytapcgxukalwsyputk.supabase.co',
    'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG'
  );

  var oldest = null;

  function el(id) { return document.getElementById(id); }

  async function token() {
    var s = await sb.auth.getSession();
    return s.data && s.data.session ? s.data.session.access_token : null;
  }

  async function api(params) {
    var t = await token();
    if (!t) return { status: 401 };
    var res = await fetch('/api/admin-data?' + params, {
      headers: { Authorization: 'Bearer ' + t }
    });
    return { status: res.status, body: res.ok ? await res.json() : null };
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderRows(errors, append) {
    var body = el('err-body');
    if (!append) body.textContent = '';
    errors.forEach(function (e) {
      var tr = document.createElement('tr');
      tr.className = 'err-row';

      var tdTime = document.createElement('td');
      tdTime.textContent = fmtTime(e.occurred_at);
      var tdMsg = document.createElement('td');
      tdMsg.className = 'msg';
      tdMsg.textContent = e.message || '';
      if (e.stack) {
        var st = document.createElement('div');
        st.className = 'stack';
        st.textContent = e.stack;
        tdMsg.appendChild(st);
      }
      var tdPage = document.createElement('td');
      tdPage.className = 'hide-m muted';
      tdPage.textContent = e.page || '';
      var tdUser = document.createElement('td');
      tdUser.className = 'hide-m muted';
      tdUser.textContent = e.user_id ? e.user_id.slice(0, 8) : 'anon';
      var tdSrc = document.createElement('td');
      tdSrc.className = 'hide-m muted';
      tdSrc.textContent = e.app_version || '';

      tr.appendChild(tdTime); tr.appendChild(tdMsg); tr.appendChild(tdPage);
      tr.appendChild(tdUser); tr.appendChild(tdSrc);
      body.appendChild(tr);
      oldest = e.occurred_at;
    });
    if (errors.length === 0 && !append) {
      var tr0 = document.createElement('tr');
      var td0 = document.createElement('td');
      td0.colSpan = 5;
      td0.className = 'muted';
      td0.textContent = 'No errors logged. Quiet is good.';
      tr0.appendChild(td0);
      body.appendChild(tr0);
    }
  }

  async function loadAll() {
    var stats = await api('action=stats');
    if (stats.status === 403 || stats.status === 401) { showDenied(stats.status); return; }
    if (stats.body) {
      if (stats.body.earnings) {
        var cents = stats.body.earnings.total_cents || 0;
        el('stat-earnings').textContent = '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        var b = stats.body.earnings.breakdown || {};
        el('stat-earnings-detail').textContent =
          'Earnings: products $' + ((b.products_cents || 0) / 100).toFixed(0) +
          ', courses $' + ((b.courses_cents || 0) / 100).toFixed(0) +
          ', bookings $' + ((b.bookings_cents || 0) / 100).toFixed(0) +
          ', tips $' + ((b.tips_cents || 0) / 100).toFixed(0);
      }
      el('stat-users').textContent = stats.body.users_total || '0';
      el('stat-err24').textContent = stats.body.errors_24h || '0';
      el('stat-err7').textContent = stats.body.errors_7d || '0';
    }
    var errs = await api('action=errors&limit=50');
    if (errs.body) renderRows(errs.body.errors || [], false);
    el('gate').style.display = 'none';
    el('panel').style.display = 'block';
  }

  function showDenied(status) {
    var msg = el('gate-msg');
    msg.style.display = 'block';
    msg.textContent = status === 403
      ? 'This account is not authorized for admin access.'
      : 'Please sign in.';
  }

  document.addEventListener('click', async function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-admin-action]') : null;
    if (btn) {
      var action = btn.getAttribute('data-admin-action');
      if (action === 'login') {
        await sb.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin + '/admin.html' }
        });
        return;
      }
      if (action === 'refresh') { oldest = null; loadAll(); return; }
      if (action === 'load-more') {
        if (!oldest) return;
        var more = await api('action=errors&limit=50&before=' + encodeURIComponent(oldest));
        if (more.body) renderRows(more.body.errors || [], true);
        return;
      }
    }
    // Row tap toggles the stack trace.
    var row = e.target && e.target.closest ? e.target.closest('tr.err-row') : null;
    if (row) {
      var stack = row.querySelector('.stack');
      if (stack) stack.classList.toggle('open');
    }
  });

  (async function init() {
    var s = await sb.auth.getSession();
    if (s.data && s.data.session) {
      var email = s.data.session.user && s.data.session.user.email;
      el('admin-who').textContent = 'Signed in as ' + (email || 'unknown');
      loadAll();
    }
  })();
})();
