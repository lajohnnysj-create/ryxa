/* data-deletion-page.js: Meta data-deletion status lookup.
   CSP-compatible: no inline handlers. Loaded after the Supabase CDN script. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
  // autoRefreshToken stays OFF outside the dashboard. Only one page per
// origin may run the background refresh timer; multiple timers race for
// the single-use refresh token and trip Supabase reuse detection, which
// revokes the session (the random logout bug). Reads still refresh
// on demand when a real action needs a fresh token.
  var sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: false }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatDate(iso) {
    if (!iso) return '\u2014';
    try {
      var d = new Date(iso);
      return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return iso;
    }
  }

  function renderStatus(html) {
    document.getElementById('status-content').innerHTML = html;
  }

  function renderNotFound(code) {
    renderStatus(
      '<div class="status-card">' +
        '<div class="status-icon notfound">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="10"/>' +
            '<line x1="12" y1="8" x2="12" y2="12"/>' +
            '<line x1="12" y1="16" x2="12.01" y2="16"/>' +
          '</svg>' +
        '</div>' +
        '<div class="status-title">Confirmation code not found</div>' +
        '<div class="status-desc">' + (code
          ? 'We couldn\'t find a deletion request matching this code. Double-check the code from Meta\'s confirmation, or contact us at hello@ryxa.io for assistance.'
          : 'No confirmation code was provided in the URL. The page should be opened from the link in Meta\'s deletion confirmation.') +
        '</div>' +
      '</div>'
    );
  }

  function renderCompleted(row) {
    renderStatus(
      '<div class="status-card">' +
        '<div class="status-icon completed">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="20 6 9 17 4 12"/>' +
          '</svg>' +
        '</div>' +
        '<div class="status-title">Deletion completed</div>' +
        '<div class="status-desc">Your Instagram connection data has been permanently removed from Ryxa.</div>' +
        '<div class="detail-row"><span class="label">Confirmation code</span><span class="value">' + escapeHtml(row.confirmation_code) + '</span></div>' +
        '<div class="detail-row"><span class="label">Requested</span><span class="value">' + escapeHtml(formatDate(row.requested_at)) + '</span></div>' +
        '<div class="detail-row"><span class="label">Completed</span><span class="value">' + escapeHtml(formatDate(row.completed_at)) + '</span></div>' +
      '</div>'
    );
  }

  function renderPending(row) {
    renderStatus(
      '<div class="status-card">' +
        '<div class="status-icon pending">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="10"/>' +
            '<polyline points="12 6 12 12 16 14"/>' +
          '</svg>' +
        '</div>' +
        '<div class="status-title">Deletion in progress</div>' +
        '<div class="status-desc">Your deletion request was received and is being processed. This page will reflect completion once it finishes.</div>' +
        '<div class="detail-row"><span class="label">Confirmation code</span><span class="value">' + escapeHtml(row.confirmation_code) + '</span></div>' +
        '<div class="detail-row"><span class="label">Requested</span><span class="value">' + escapeHtml(formatDate(row.requested_at)) + '</span></div>' +
      '</div>'
    );
  }

  async function loadStatus() {
    var params = new URLSearchParams(window.location.search);
    var code = (params.get('code') || '').trim();

    if (!code) {
      renderNotFound('');
      return;
    }

    try {
      var { data, error } = await sb.rpc('get_deletion_status', { p_code: code });
      if (error) {
        console.error('RPC error:', error);
        renderNotFound(code);
        return;
      }
      if (!data || data.length === 0) {
        renderNotFound(code);
        return;
      }
      var row = data[0];
      if (row.status === 'completed' && row.completed_at) {
        renderCompleted(row);
      } else {
        renderPending(row);
      }
    } catch (e) {
      console.error('Failed to load status:', e);
      renderNotFound(code);
    }
  }

  loadStatus();
})();
