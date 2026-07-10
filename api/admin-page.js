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
      var stack = row.querySelector('.stack');
      if (stack) stack.classList.toggle('open');
    }
  });

  // -------------------------------------------------------------------------
  // Tabs
  // -------------------------------------------------------------------------
  function showTab(name) {
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

  (async function init() {
    var s = await sb.auth.getSession();
    if (s.data && s.data.session) {
      // No "signed in as" line: reaching this panel already proves who you are,
      // and the server re-checks the identity on every request anyway.
      loadAll();
    }
  })();
})();
