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
    // Parse the body either way: a 404 carries the reason, and discarding it
    // leaves the UI saying "something went wrong" when the server said exactly
    // what went wrong.
    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, body: body };
  }

  async function apiPost(payload) {
    var t = await token();
    if (!t) return { status: 401, body: null };
    var res = await fetch('/api/admin-action', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, body: body };
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Click a row to copy the whole record, not just the message. The message
  // alone is rarely enough to act on: the stack, the page, and the app version
  // are what turn "TypeError" into a fixable report.
  function errorAsText(e) {
    var parts = [
      fmtTime(e.occurred_at),
      e.message || '(no message)',
    ];
    if (e.page) parts.push('page: ' + e.page);
    if (e.app_version) parts.push('version: ' + e.app_version);
    if (e.user_id) parts.push('user: ' + e.user_id);
    if (e.stack) parts.push('', e.stack);
    return parts.join('\n');
  }

  // navigator.clipboard needs a secure context AND a user gesture. A click is
  // a gesture, and admin.html is https, but Safari has historically been
  // fussy, so fall back to the old textarea+execCommand trick rather than
  // silently doing nothing.
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  function flashCopied(node) {
    node.classList.add('copied');
    setTimeout(function () { node.classList.remove('copied'); }, 900);
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
        st.title = 'Click to copy this error';

        // Copy lives on the stack box, not the row. The row toggles the stack
        // open; putting copy there meant one tap did both, and you got a
        // clipboard full of errors you were only trying to read.
        st.addEventListener('click', function (ev) {
          // Do not let this reach the row handler and collapse the box you
          // just clicked.
          ev.stopPropagation();
          // Selecting a line of the trace should not also copy the whole
          // record. If text is highlighted, leave the reader alone.
          var sel = window.getSelection && window.getSelection().toString();
          if (sel) return;
          copyText(errorAsText(e))
            .then(function () { flashCopied(st); })
            .catch(function (err) { console.error('copy failed:', err); });
        });

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
        // The per-source breakdown was noise: the number that matters is the
        // total, and the split is one query away in the dashboard if it is ever
        // needed. The label is static markup now, so nothing overwrites it.
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

      if (action === 'tab') {
        showTab(btn.getAttribute('data-admin-tab'));
        return;
      }

      if (action === 'find-creator') { findCreator(); return; }

      if (action === 'load-threshold') { loadThreshold(); return; }

      if (action === 'load-reports') { loadReports(); return; }

      if (action === 'logout') {
        // scope:'local' clears this browser only. A global sign-out would also
        // end the session in the creator dashboard, a different surface, which
        // is not what this button implies.
        try {
          await sb.auth.signOut({ scope: 'local' });
        } catch (err) {
          console.error('sign out failed:', err);
        }
        // Reload rather than toggling the DOM. The panel holds fetched creator
        // data; hiding a div leaves it in memory and in the page source.
        window.location.replace('/admin.html');
        return;
      }
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
      // Errors carry a .stack, reports carry a .report-detail. Same gesture,
      // same class name for the open state, so one handler serves both.
      var detail = row.querySelector('.stack, .report-detail');
      if (detail) detail.classList.toggle('open');
    }
  });

  // Read this in the console to know which build the browser actually loaded.
  window.__adminBuild = 'tabs-v2';

  // -------------------------------------------------------------------------
  // Tabs
  // -------------------------------------------------------------------------
  function showTab(name) {
    // Loads on first open rather than with the page. Two queries we need not
    // make while an admin is reading the error log.
    if (name === 'threshold' && !thresholdLoaded) loadThreshold();
    if (name === 'reports' && !reportsLoaded) loadReports();

    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-admin-tab') === name;
      tabs[i].classList.toggle('active', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var panels = document.querySelectorAll('.tabpanel');
    for (var j = 0; j < panels.length; j++) {
      panels[j].hidden = panels[j].id !== 'tab-' + name;
    }
  }

  // -------------------------------------------------------------------------
  // Creator lookup
  //
  // Username is user-controlled data landing in the admin's own page, so every
  // node here is built with createElement + textContent. No innerHTML, ever.
  // -------------------------------------------------------------------------
  function lookupMsg(text, kind) {
    var host = el('creator-result');
    host.textContent = '';
    if (!text) return;
    var p = document.createElement('p');
    p.className = 'lookup-msg ' + (kind || '');
    p.textContent = text;
    host.appendChild(p);
  }

  function renderCreator(c) {
    var host = el('creator-result');
    host.textContent = '';

    var card = document.createElement('div');
    card.className = 'creator-card';

    var name = document.createElement('div');
    name.className = 'creator-name';
    name.textContent = '@' + c.username;
    card.appendChild(name);

    var meta = document.createElement('div');
    meta.className = 'creator-meta';
    meta.textContent = c.user_id;
    card.appendChild(meta);

    var row = document.createElement('div');
    row.className = 'creator-row';

    var labelWrap = document.createElement('div');
    var label = document.createElement('div');
    label.className = 'creator-row-label';
    label.textContent = 'Blue check verification';
    var sub = document.createElement('div');
    sub.className = 'creator-row-sub';
    sub.textContent = 'Shows on their public Link in Bio.';
    labelWrap.appendChild(label);
    labelWrap.appendChild(sub);

    var sw = document.createElement('label');
    sw.className = 'switch';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!c.verified;
    input.setAttribute('aria-label', 'Verified badge for ' + c.username);
    var slider = document.createElement('span');
    slider.className = 'slider';
    sw.appendChild(input);
    sw.appendChild(slider);

    input.addEventListener('change', function () {
      var want = input.checked;
      input.disabled = true;

      apiPost({ action: 'set_verified', user_id: c.user_id, verified: want })
        .then(function (r) {
          input.disabled = false;
          if (r.status === 200 && r.body && typeof r.body.verified === 'boolean') {
            // Trust the server's echo, not what we asked for. If the two ever
            // disagree, the checkbox should show what is actually stored.
            input.checked = r.body.verified;
            c.verified = r.body.verified;
            status.className = 'lookup-msg ok';
            status.textContent = r.body.verified
              ? 'Verified. The badge is live on their page.'
              : 'Verification removed.';
            return;
          }
          // Roll the switch back: nothing changed on the server.
          input.checked = !want;
          status.className = 'lookup-msg err';
          status.textContent = (r.body && r.body.error) || 'Could not update (' + r.status + ')';
        })
        .catch(function (err) {
          input.disabled = false;
          input.checked = !want;
          status.className = 'lookup-msg err';
          status.textContent = 'Could not update: ' + (err && err.message ? err.message : 'network error');
        });
    });

    row.appendChild(labelWrap);
    row.appendChild(sw);
    card.appendChild(row);

    var status = document.createElement('p');
    status.className = 'lookup-msg';
    card.appendChild(status);

    host.appendChild(card);
  }

  async function findCreator() {
    var input = el('creator-search');
    var raw = (input.value || '').trim().replace(/^@+/, '');
    if (!raw) { lookupMsg('Enter a username.', 'err'); return; }

    lookupMsg('Searching...', '');
    var r = await api('action=creator&username=' + encodeURIComponent(raw));

    if (r.status === 200 && r.body && r.body.creator) {
      renderCreator(r.body.creator);
      return;
    }
    if (r.status === 404) { lookupMsg('No creator with that username.', 'err'); return; }
    if (r.status === 403 || r.status === 401) { showDenied(r.status); return; }
    lookupMsg((r.body && r.body.error) || 'Lookup failed (' + r.status + ')', 'err');
  }

  // A search box that ignores Enter feels broken, and the admin will press it.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (!e.target || e.target.id !== 'creator-search') return;
    e.preventDefault();
    findCreator();
  });

  // -------------------------------------------------------------------------
  // Threshold watchlist
  //
  // Fetched lazily: each row costs a live head-count against subscribers_view,
  // so the panel should not load until an admin actually opens it.
  // -------------------------------------------------------------------------
  var thresholdLoaded = false;

  function renderThreshold(accounts) {
    var body = el('threshold-body');
    body.textContent = '';

    if (!accounts || accounts.length === 0) {
      var tr0 = document.createElement('tr');
      var td0 = document.createElement('td');
      td0.colSpan = 4;
      td0.className = 'muted';
      td0.textContent = 'No accounts have crossed the threshold.';
      tr0.appendChild(td0);
      body.appendChild(tr0);
      return;
    }

    accounts.forEach(function (a) {
      var tr = document.createElement('tr');

      var tdName = document.createElement('td');
      // A username can be null if a creator never set one. Fall back to the id
      // rather than rendering an empty cell that looks like a bug.
      tdName.textContent = a.username ? '@' + a.username : a.user_id.slice(0, 8);
      if (!a.username) tdName.className = 'muted';

      // The count recorded when they crossed. Not a live figure, and the
      // column header says so: counting subscribers_view per account is a
      // five-table UNION each time, for a number nobody is acting on.
      var tdAt = document.createElement('td');
      tdAt.textContent = (a.subscribers_at_crossing || 0).toLocaleString();

      var tdWhen = document.createElement('td');
      tdWhen.className = 'hide-m muted';
      tdWhen.textContent = fmtTime(a.crossed_at);

      var tdVer = document.createElement('td');
      tdVer.className = 'hide-m muted';
      tdVer.textContent = a.attestation_version || '';

      tr.appendChild(tdName); tr.appendChild(tdAt);
      tr.appendChild(tdWhen); tr.appendChild(tdVer);
      body.appendChild(tr);
    });
  }

  async function loadThreshold() {
    var body = el('threshold-body');
    body.textContent = '';
    var trL = document.createElement('tr');
    var tdL = document.createElement('td');
    tdL.colSpan = 4;
    tdL.className = 'muted';
    tdL.textContent = 'Loading...';
    trL.appendChild(tdL);
    body.appendChild(trL);

    var r = await api('action=threshold');
    if (r.status === 403 || r.status === 401) { showDenied(r.status); return; }
    if (r.status !== 200 || !r.body) {
      body.textContent = '';
      var trE = document.createElement('tr');
      var tdE = document.createElement('td');
      tdE.colSpan = 4;
      tdE.className = 'muted';
      tdE.textContent = (r.body && r.body.error) || 'Could not load (' + r.status + ')';
      trE.appendChild(tdE);
      body.appendChild(trE);
      return;
    }
    thresholdLoaded = true;
    renderThreshold(r.body.accounts);
  }

  // -------------------------------------------------------------------------
  // AI content reports
  //
  // Reported content is text a user wrote or an AI produced. It is rendered
  // with textContent and never innerHTML: this page runs as the admin, and a
  // report is the one place hostile text arrives by design.
  // -------------------------------------------------------------------------
  var reportsLoaded = false;

  function reportAsText(r) {
    var parts = [
      fmtTime(r.created_at),
      'source: ' + r.source,
      'reporter: ' + (r.reporter ? '@' + r.reporter : r.reporter_id)
    ];
    if (r.conversation_id) parts.push('conversation: ' + r.conversation_id);
    if (r.reason) parts.push('', 'REASON:', r.reason);
    if (r.content) parts.push('', 'REPORTED CONTENT:', r.content);
    return parts.join('\n');
  }

  function renderReports(reports) {
    var body = el('reports-body');
    body.textContent = '';

    if (!reports || reports.length === 0) {
      var tr0 = document.createElement('tr');
      var td0 = document.createElement('td');
      td0.colSpan = 4;
      td0.className = 'muted';
      td0.textContent = 'No reports. Quiet is good.';
      tr0.appendChild(td0);
      body.appendChild(tr0);
      return;
    }

    reports.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.className = 'err-row';   // same hover + pointer affordance

      var tdWhen = document.createElement('td');
      tdWhen.textContent = fmtTime(r.created_at);

      var tdSrc = document.createElement('td');
      tdSrc.textContent = r.source || '';

      // The detail block lives inside the source cell so it spans naturally
      // under the row when opened, exactly like an error's stack trace.
      var detail = document.createElement('div');
      detail.className = 'report-detail';

      if (r.reason) {
        var rl = document.createElement('div');
        rl.className = 'report-label';
        rl.textContent = 'Reason';
        var rv = document.createElement('div');
        rv.textContent = r.reason;
        rv.style.marginBottom = '10px';
        detail.appendChild(rl);
        detail.appendChild(rv);
      }
      var cl = document.createElement('div');
      cl.className = 'report-label';
      cl.textContent = 'Reported content';
      var cv = document.createElement('div');
      cv.textContent = r.content || '(empty)';
      detail.appendChild(cl);
      detail.appendChild(cv);

      detail.title = 'Click to copy this report';
      detail.addEventListener('click', function (ev) {
        ev.stopPropagation();   // do not collapse the box you just clicked
        var sel = window.getSelection && window.getSelection().toString();
        if (sel) return;
        copyText(reportAsText(r))
          .then(function () { flashCopied(detail); })
          .catch(function (err) { console.error('copy failed:', err); });
      });
      tdSrc.appendChild(detail);

      var tdWho = document.createElement('td');
      tdWho.className = 'hide-m muted';
      tdWho.textContent = r.reporter ? '@' + r.reporter : (r.reporter_id || '').slice(0, 8);

      var tdStatus = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = r.status === 'pending' ? 'badge-pending' : 'badge-resolved';
      badge.textContent = r.status || 'pending';
      tdStatus.appendChild(badge);

      tr.appendChild(tdWhen); tr.appendChild(tdSrc);
      tr.appendChild(tdWho); tr.appendChild(tdStatus);
      body.appendChild(tr);
    });
  }

  async function loadReports() {
    var body = el('reports-body');
    body.textContent = '';
    var trL = document.createElement('tr');
    var tdL = document.createElement('td');
    tdL.colSpan = 4;
    tdL.className = 'muted';
    tdL.textContent = 'Loading...';
    trL.appendChild(tdL);
    body.appendChild(trL);

    var r = await api('action=reports');
    if (r.status === 403 || r.status === 401) { showDenied(r.status); return; }
    if (r.status !== 200 || !r.body) {
      body.textContent = '';
      var trE = document.createElement('tr');
      var tdE = document.createElement('td');
      tdE.colSpan = 4;
      tdE.className = 'muted';
      tdE.textContent = (r.body && r.body.error) || 'Could not load (' + r.status + ')';
      trE.appendChild(tdE);
      body.appendChild(trE);
      return;
    }
    reportsLoaded = true;
    renderReports(r.body.reports);
  }

  function bindTabs() {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          showTab(btn.getAttribute('data-admin-tab'));
        });
      })(tabs[i]);
    }
  }

  (async function init() {
    bindTabs();
    var s = await sb.auth.getSession();
    if (s.data && s.data.session) {
      // No "signed in as" line: reaching this panel already proves who you are,
      // and the server re-checks the identity on every request anyway.
      loadAll();
    }
  })();
})();
