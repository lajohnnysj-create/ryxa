// =============================================================================
// /js/clients.js — Subscribers tool (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Subscribers tool (called "clients" internally for
// historical reasons; user-facing name is "Subscribers"). Loads opt-in/opt-out
// list of bio page visitors, paginates, filters, exports to CSV.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/clients.js
//   • Phase 2: replaced inline onclick/oninput/onchange/onfocus with
//     data-clients-action attributes + delegated event handlers
//   • Phase 3: replaced inline static styles with hash-named CSS classes
//
// External dependencies remain on window (sb, currentUser, escapeHtml, etc).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE (parallel of other tools)
// =============================================================================

const clientsActions = {};

function clientsRegisterAction(action, handler) {
  clientsActions[action] = handler;
}

function clientsFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['clientsAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.clientsAction) {
        const wantEvent = el.dataset.clientsEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.clientsAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function clientsDispatchEvent(event) {
  const found = clientsFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = clientsActions[found.action];
  if (!handler) {
    console.warn('[clients] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, clientsDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 17122-17308 (Subscribers/Clients tool) ----------
function initClientsTool() {
  document.getElementById('clients-content').style.display = 'block';
  loadClients();
}


var clientsData = [];
var clientsFiltered = [];
var clientsCurrentPage = 0;
var CLIENTS_PER_PAGE = 50;
// Set of emails the creator has marked "Remove from list". Populated from
// the subscriber_suppressions table on load. Used to filter clientsData
// AFTER aggregation so a suppressed buyer still keeps their purchase records.
var clientsSuppressed = new Set();
// Set of selected emails for bulk actions. Persists across pagination within
// a single session so creators can select across pages.
var clientsSelected = new Set();
// Map of email -> note text for the current creator. Populated on load from
// the subscriber_notes table. Used to (a) show the note indicator dot on
// rows that have a note, and (b) prefill the modal when opened.
var clientsNotes = {};
// Map of email -> { first_name, last_name } for the current creator. Combines
// data from subscriber_names (creator edits, wins) and manual_subscribers
// (CSV import or manual add, fallback). Used to prefill the name fields in
// the detail modal.
var clientsNamesData = {};
// Tracks which subscriber is currently open in the detail modal so the
// note-blur handler knows what email to save under.
var clientsCurrentDetailEmail = null;
// Used to compare against the textarea value on blur and skip a save when
// nothing actually changed (avoids needless network noise and "Saved"
// flashes when the creator just clicks away without typing).
var clientsCurrentDetailNoteOriginal = '';
// Same comparison-tracking for the name fields. Compared against on blur
// to skip no-op saves.
var clientsCurrentDetailNameOriginal = { first_name: '', last_name: '' };

// Order matters: when the same email appears in multiple sources, the SOURCE
// PRIORITY (lower number = earlier signup) wins for the "first source" badge.
// Within each loop we also pick the OLDEST date for that source. Combining
// these two rules gives us "first source they joined under".
var CLIENT_SOURCE_PRIORITY = { course: 0, booking: 1, product: 2, manual: 3, bio: 4 };
var CLIENT_SOURCE_LABEL = { course: 'Course', booking: 'Booking', product: 'Product', manual: 'Manual', bio: 'Bio' };

function filterSubscribers() {
  var query = (document.getElementById('clients-search')?.value || '').toLowerCase().trim();
  var optinOnly = document.getElementById('clients-optin-filter')?.checked || false;
  var rangeDays = parseInt(document.getElementById('clients-range-filter')?.value || 'all', 10);
  var cutoffMs = (!isNaN(rangeDays) && rangeDays > 0)
    ? (Date.now() - rangeDays * 24 * 60 * 60 * 1000)
    : null;

  clientsFiltered = clientsData.filter(function(c) {
    if (query && !c.email.toLowerCase().includes(query)) return false;
    if (optinOnly && !c.optin) return false;
    if (cutoffMs !== null && new Date(c.date).getTime() < cutoffMs) return false;
    return true;
  });
  applyClientsSort();
  clientsCurrentPage = 0;
  renderSubscribersPage();
}

function applyClientsSort() {
  var sort = document.getElementById('clients-sort')?.value || 'date-desc';
  clientsFiltered.sort(function(a, b) {
    switch (sort) {
      case 'date-asc': return new Date(a.date) - new Date(b.date);
      case 'email-asc': return a.email.localeCompare(b.email);
      case 'email-desc': return b.email.localeCompare(a.email);
      case 'source-asc': return (CLIENT_SOURCE_LABEL[a.source] || 'Z').localeCompare(CLIENT_SOURCE_LABEL[b.source] || 'Z');
      case 'date-desc':
      default: return new Date(b.date) - new Date(a.date);
    }
  });
}

function clientsPage(dir) {
  var maxPage = Math.max(0, Math.floor((clientsFiltered.length - 1) / CLIENTS_PER_PAGE));
  clientsCurrentPage = Math.max(0, Math.min(maxPage, clientsCurrentPage + dir));
  renderSubscribersPage();
}

function renderSubscribersPage() {
  var tbody = document.getElementById('clients-tbody');
  if (!tbody) return;
  var start = clientsCurrentPage * CLIENTS_PER_PAGE;
  var page = clientsFiltered.slice(start, start + CLIENTS_PER_PAGE);
  var maxPage = Math.max(0, Math.floor((clientsFiltered.length - 1) / CLIENTS_PER_PAGE));

  if (page.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="ana-s-cd4491">' + (clientsData.length > 0 ? 'No results found' : 'No subscribers yet') + '</td></tr>';
  } else {
    tbody.innerHTML = page.map(function(c) {
      var d = new Date(c.date);
      var date = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
      var optinBadge = c.optin
        ? '<span class="clients-s-becac0">Yes</span>'
        : '<span class="prod-s-6c6a73">No</span>';
      var sourceClass = 'clients-s-source-' + (c.source || 'bio');
      var sourceLabel = CLIENT_SOURCE_LABEL[c.source] || 'Bio';
      var checked = clientsSelected.has(c.email) ? ' checked' : '';
      var escEmail = (typeof escapeHtml === 'function') ? escapeHtml(c.email) : c.email;
      // Note indicator: filled-style icon with a small dot when a note exists.
      var hasNote = !!(clientsNotes[c.email.toLowerCase()] || '').trim();
      var noteBtnClass = 'clients-s-row-note' + (hasNote ? ' clients-s-row-note-has' : '');
      var noteTitle = hasNote ? 'View note' : 'Add a note';
      return '<tr class="ana-s-a56f95">'
        + '<td class="clients-s-row-check-cell">'
        + '<input type="checkbox" class="clients-s-checkbox" data-clients-action="toggle-row" data-clients-event="change" data-clients-email="' + escEmail + '" aria-label="Select ' + escEmail + '"' + checked + '>'
        + '</td>'
        + '<td class="clients-s-949353">' + escEmail + '</td>'
        + '<td class="clients-s-source-cell"><span class="clients-s-source-badge ' + sourceClass + '">' + sourceLabel + '</span></td>'
        + '<td class="clients-s-e6b633">' + optinBadge + '</td>'
        + '<td class="ana-s-14ba36">' + date + '</td>'
        + '<td class="clients-s-row-note-cell">'
        + '<button class="' + noteBtnClass + '" data-clients-action="open-detail" data-clients-email="' + escEmail + '" aria-label="' + noteTitle + ' for ' + escEmail + '" title="' + noteTitle + '">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
        + '</button>'
        + '</td>'
        + '<td class="clients-s-row-remove-cell">'
        + '<button class="clients-s-row-remove" data-clients-action="remove-one" data-clients-email="' + escEmail + '" aria-label="Remove ' + escEmail + ' from list" title="Remove from list">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
        + '</button>'
        + '</td>'
        + '</tr>';
    }).join('');
  }

  // Sync "select all on this page" checkbox state: checked only when EVERY
  // row on the current page is in the selected set.
  var selectAllEl = document.getElementById('clients-select-all');
  if (selectAllEl) {
    selectAllEl.checked = page.length > 0 && page.every(function(c) { return clientsSelected.has(c.email); });
  }

  var pagination = document.getElementById('clients-pagination');
  if (clientsFiltered.length > CLIENTS_PER_PAGE) {
    pagination.style.display = 'flex';
    document.getElementById('clients-prev').style.visibility = clientsCurrentPage > 0 ? 'visible' : 'hidden';
    document.getElementById('clients-next').style.visibility = clientsCurrentPage < maxPage ? 'visible' : 'hidden';
    document.getElementById('clients-page-info').textContent = (start + 1) + '–' + Math.min(start + CLIENTS_PER_PAGE, clientsFiltered.length) + ' of ' + clientsFiltered.length;
  } else {
    pagination.style.display = 'none';
  }

  renderBulkBar();
}

function renderBulkBar() {
  var bar = document.getElementById('clients-bulk-bar');
  if (!bar) return;
  var count = clientsSelected.size;
  if (count === 0) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    var countEl = document.getElementById('clients-bulk-count');
    if (countEl) countEl.textContent = count + ' selected';
  }
}

function renderClientsStats() {
  var total = clientsData.length;
  var optin = clientsData.filter(function(c) { return c.optin; }).length;
  var optout = total - optin;
  var totalEl = document.getElementById('clients-stat-total');
  var optinEl = document.getElementById('clients-stat-optin');
  var optoutEl = document.getElementById('clients-stat-optout');
  if (totalEl) totalEl.textContent = total.toLocaleString();
  if (optinEl) optinEl.textContent = optin.toLocaleString();
  if (optoutEl) optoutEl.textContent = optout.toLocaleString();
}

// Helper for merging sources. Picks the "first source" by oldest date when
// a subscriber appears in multiple source tables, breaking ties by the
// CLIENT_SOURCE_PRIORITY order (course before booking before product before bio).
function clientUpsert(clientMap, key, incoming) {
  if (!clientMap[key]) {
    clientMap[key] = incoming;
    return;
  }
  var existing = clientMap[key];
  // Marketing consent is sticky: once true, stays true.
  if (incoming.optin) existing.optin = true;
  // Date: keep the OLDEST (when they first appeared on the list).
  if (new Date(incoming.date) < new Date(existing.date)) {
    existing.date = incoming.date;
    // The new oldest record's source becomes the "first source".
    existing.source = incoming.source;
  } else if (new Date(incoming.date).getTime() === new Date(existing.date).getTime()) {
    // Tie on date: lower priority value wins (course beats booking, etc.).
    var oldPri = CLIENT_SOURCE_PRIORITY[existing.source] ?? 99;
    var newPri = CLIENT_SOURCE_PRIORITY[incoming.source] ?? 99;
    if (newPri < oldPri) existing.source = incoming.source;
  }
}

async function loadClients() {
  const tbody = document.getElementById('clients-tbody');
  if (!tbody || !currentUser) return;
  tbody.innerHTML = '<tr><td colspan="7" class="ana-s-cd4491">Loading...</td></tr>';
  try {
    const clientMap = {};

    // Pull the creator's suppression list FIRST so we can filter the final
    // aggregate cleanly. Tiny query usually; index lookup on (creator_id).
    clientsSuppressed = new Set();
    try {
      const { data: suppressions } = await sb
        .from('subscriber_suppressions')
        .select('email')
        .eq('creator_id', currentUser.id);
      if (suppressions) {
        suppressions.forEach(function(s) { if (s.email) clientsSuppressed.add(s.email.toLowerCase()); });
      }
    } catch (suppErr) { console.warn('Could not load suppressions (table may not exist yet):', suppErr); }

    // Pull the creator's notes for any subscribers they've annotated. Keyed
    // by lowercased email to match the aggregation keys below. If the table
    // doesn't exist yet (migration not run), the catch leaves clientsNotes
    // as an empty object and the note column shows the "Add a note" icon
    // for every row.
    clientsNotes = {};
    try {
      const { data: notes } = await sb
        .from('subscriber_notes')
        .select('email, note')
        .eq('creator_id', currentUser.id);
      if (notes) {
        notes.forEach(function(n) {
          if (n.email) clientsNotes[n.email.toLowerCase()] = n.note || '';
        });
      }
    } catch (noteErr) { console.warn('Could not load notes (table may not exist yet):', noteErr); }

    // Pull names for subscribers. Two sources, merged with precedence:
    //   1. subscriber_names (creator-edited, takes priority)
    //   2. manual_subscribers (from CSV import or manual-add, fallback)
    // Same email keyed by lowercase. Modal prefill uses this map.
    clientsNamesData = {};
    // Manual subscribers first so creator edits can overwrite them.
    try {
      const { data: ms } = await sb
        .from('manual_subscribers')
        .select('email, first_name, last_name')
        .eq('creator_id', currentUser.id);
      if (ms) {
        ms.forEach(function(m) {
          if (!m.email) return;
          var key = m.email.toLowerCase();
          if (m.first_name || m.last_name) {
            clientsNamesData[key] = {
              first_name: m.first_name || '',
              last_name: m.last_name || ''
            };
          }
        });
      }
    } catch (nameErr) { console.warn('Could not load manual subscriber names:', nameErr); }
    // Creator-edited names overwrite.
    try {
      const { data: sn } = await sb
        .from('subscriber_names')
        .select('email, first_name, last_name')
        .eq('creator_id', currentUser.id);
      if (sn) {
        sn.forEach(function(n) {
          if (!n.email) return;
          var key = n.email.toLowerCase();
          clientsNamesData[key] = {
            first_name: n.first_name || '',
            last_name: n.last_name || ''
          };
        });
      }
    } catch (curErr) { console.warn('Could not load subscriber names (table may not exist yet):', curErr); }

    const { data: enrollments } = await sb
      .from('course_enrollments')
      .select('user_id, buyer_email, enrolled_at, marketing_consent, courses(user_id)')
      .eq('courses.user_id', currentUser.id)
      .order('enrolled_at', { ascending: false });
    if (enrollments) {
      enrollments.forEach(function(e) {
        if (!e.courses || e.courses.user_id !== currentUser.id) return;
        var email = e.buyer_email || '';
        var key = (email || e.user_id).toLowerCase();
        clientUpsert(clientMap, key, {
          email: email,
          date: e.enrolled_at,
          optin: !!e.marketing_consent,
          source: 'course'
        });
      });
    }

    const { data: bookings } = await sb
      .from('coaching_bookings')
      .select('user_id, buyer_email, booked_at, marketing_consent, coaching_services(user_id)')
      .eq('coaching_services.user_id', currentUser.id)
      .order('booked_at', { ascending: false });
    if (bookings) {
      bookings.forEach(function(b) {
        if (!b.coaching_services || b.coaching_services.user_id !== currentUser.id) return;
        var email = b.buyer_email || '';
        var key = (email || b.user_id).toLowerCase();
        clientUpsert(clientMap, key, {
          email: email,
          date: b.booked_at,
          optin: !!b.marketing_consent,
          source: 'booking'
        });
      });
    }

    // Digital product purchases, same opt-in pattern as courses/bookings.
    const { data: dpPurchases } = await sb
      .from('digital_product_purchases')
      .select('buyer_user_id, buyer_email, purchased_at, marketing_consent, digital_products(user_id)')
      .eq('digital_products.user_id', currentUser.id)
      .order('purchased_at', { ascending: false });
    if (dpPurchases) {
      dpPurchases.forEach(function(p) {
        if (!p.digital_products || p.digital_products.user_id !== currentUser.id) return;
        var email = p.buyer_email || '';
        var key = (email || p.buyer_user_id).toLowerCase();
        clientUpsert(clientMap, key, {
          email: email,
          date: p.purchased_at,
          optin: !!p.marketing_consent,
          source: 'product'
        });
      });
    }

    // Bio email signups (always opted in).
    const { data: signups } = await sb
      .from('bio_email_signups')
      .select('email, created_at')
      .eq('creator_id', currentUser.id)
      .order('created_at', { ascending: false });
    if (signups) {
      signups.forEach(function(s) {
        var email = s.email || '';
        if (!email) return;
        var key = email.toLowerCase();
        clientUpsert(clientMap, key, {
          email: email,
          date: s.created_at,
          optin: true,
          source: 'bio'
        });
      });
    }

    // Manually-added subscribers + CSV imports. Always opted in - the creator
    // explicitly added them. The added_via column distinguishes 'manual' from
    // 'csv_import' but for display purposes they share the 'Manual' badge.
    try {
      const { data: manual } = await sb
        .from('manual_subscribers')
        .select('email, added_at')
        .eq('creator_id', currentUser.id);
      if (manual) {
        manual.forEach(function(m) {
          var email = m.email || '';
          if (!email) return;
          var key = email.toLowerCase();
          clientUpsert(clientMap, key, {
            email: email,
            date: m.added_at,
            optin: true,
            source: 'manual'
          });
        });
      }
    } catch (manErr) { console.warn('Could not load manual subscribers (table may not exist yet):', manErr); }

    // Filter out suppressed emails AFTER aggregation so the underlying
    // purchase records remain untouched in their source tables.
    var clients = Object.values(clientMap).filter(function(c) {
      return c.email && !clientsSuppressed.has(c.email.toLowerCase());
    });
    clients.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    clientsData = clients;
    clientsFiltered = clients.slice();
    applyClientsSort();
    clientsCurrentPage = 0;
    clientsSelected = new Set();

    var countEl = document.getElementById('clients-count');
    if (countEl) countEl.textContent = clients.length + ' subscriber' + (clients.length !== 1 ? 's' : '');

    // Clear search on reload.
    var searchEl = document.getElementById('clients-search');
    if (searchEl) searchEl.value = '';

    renderClientsStats();
    renderSubscribersPage();
  } catch (e) {
    console.error('Subscribers load error:', e);
    tbody.innerHTML = '<tr><td colspan="7" class="ana-s-cd4491">Could not load subscribers</td></tr>';
  }
}

function exportSubscribers() {
  var exportData = clientsFiltered.length > 0 ? clientsFiltered : clientsData;
  if (!exportData || exportData.length === 0) {
    showModalAlert('No Data', 'No subscribers to export.');
    return;
  }
  var csv = 'Email,Source,Opt In,Date Joined\n';
  exportData.forEach(function(c) {
    var d = new Date(c.date);
    var date = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
    var source = CLIENT_SOURCE_LABEL[c.source] || 'Bio';
    csv += '"' + c.email.replace(/"/g, '""') + '",' + source + ',' + (c.optin ? 'Yes' : 'No') + ',' + date + '\n';
  });
  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'ryxa-subscribers.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// --- Bulk selection + remove ---

function clientsToggleRow(email, checked) {
  if (!email) return;
  if (checked) clientsSelected.add(email);
  else clientsSelected.delete(email);
  // Sync "select all" checkbox state without re-rendering the whole table.
  var selectAllEl = document.getElementById('clients-select-all');
  if (selectAllEl) {
    var start = clientsCurrentPage * CLIENTS_PER_PAGE;
    var page = clientsFiltered.slice(start, start + CLIENTS_PER_PAGE);
    selectAllEl.checked = page.length > 0 && page.every(function(c) { return clientsSelected.has(c.email); });
  }
  renderBulkBar();
}

function clientsToggleAll(checked) {
  var start = clientsCurrentPage * CLIENTS_PER_PAGE;
  var page = clientsFiltered.slice(start, start + CLIENTS_PER_PAGE);
  page.forEach(function(c) {
    if (checked) clientsSelected.add(c.email);
    else clientsSelected.delete(c.email);
  });
  renderSubscribersPage();
}

function clientsClearSelection() {
  clientsSelected = new Set();
  renderSubscribersPage();
}

async function clientsBulkRemove() {
  if (clientsSelected.size === 0) return;
  var emails = Array.from(clientsSelected);
  var confirmText = emails.length === 1
    ? 'Remove this subscriber from your list? Their purchase records stay intact, but they will no longer appear in your subscribers list or exports.'
    : 'Remove ' + emails.length + ' subscribers from your list? Their purchase records stay intact, but they will no longer appear in your subscribers list or exports.';
  var confirmed = await confirmTypedDelete('Remove from List', confirmText, 'Remove');
  if (!confirmed) return;

  try {
    var rows = emails.map(function(email) {
      return { creator_id: currentUser.id, email: email };
    });
    // Upsert so re-removing an already-suppressed email is a no-op (the
    // unique constraint on (creator_id, email) would otherwise throw).
    var { error } = await sb.from('subscriber_suppressions').upsert(rows, {
      onConflict: 'creator_id,email',
      ignoreDuplicates: true
    });
    if (error) throw error;
    emails.forEach(function(e) { clientsSuppressed.add(e.toLowerCase()); });
    clientsData = clientsData.filter(function(c) { return !clientsSuppressed.has(c.email.toLowerCase()); });
    clientsSelected = new Set();
    filterSubscribers();
    renderClientsStats();
    var countEl = document.getElementById('clients-count');
    if (countEl) countEl.textContent = clientsData.length + ' subscriber' + (clientsData.length !== 1 ? 's' : '');
  } catch (e) {
    console.error('Bulk remove failed:', e);
    showModalAlert('Could not remove', e.message || 'Failed to remove subscribers.');
  }
}

async function clientsRemoveOne(email) {
  if (!email) return;
  var confirmed = await confirmTypedDelete(
    'Remove from List',
    'Remove ' + email + ' from your subscribers list? Their purchase records stay intact, but they will no longer appear in your list or exports.',
    'Remove'
  );
  if (!confirmed) return;

  try {
    var { error } = await sb.from('subscriber_suppressions').upsert([
      { creator_id: currentUser.id, email: email }
    ], { onConflict: 'creator_id,email', ignoreDuplicates: true });
    if (error) throw error;
    clientsSuppressed.add(email.toLowerCase());
    clientsData = clientsData.filter(function(c) { return c.email.toLowerCase() !== email.toLowerCase(); });
    clientsSelected.delete(email);
    filterSubscribers();
    renderClientsStats();
    var countEl = document.getElementById('clients-count');
    if (countEl) countEl.textContent = clientsData.length + ' subscriber' + (clientsData.length !== 1 ? 's' : '');
  } catch (e) {
    console.error('Remove failed:', e);
    showModalAlert('Could not remove', e.message || 'Failed to remove subscriber.');
  }
}

// --- Subscriber Details modal: profile view + note editor ---
// Opens the modal pre-filled with this subscriber's info and existing note.
// Saves the note on textarea blur (auto-save) with an inline "Saved" indicator.
function clientsOpenDetail(email) {
  if (!email) return;
  var sub = clientsData.find(function(c) { return c.email.toLowerCase() === email.toLowerCase(); });
  if (!sub) return;

  clientsCurrentDetailEmail = sub.email;

  var emailEl = document.getElementById('clients-detail-email');
  var sourceEl = document.getElementById('clients-detail-source');
  var optinEl = document.getElementById('clients-detail-optin');
  var dateEl = document.getElementById('clients-detail-date');
  var noteEl = document.getElementById('clients-detail-note');
  var statusEl = document.getElementById('clients-detail-note-status');
  var modal = document.getElementById('clients-detail-modal');
  if (!modal || !noteEl) return;

  if (emailEl) emailEl.textContent = sub.email;

  // Prefill name fields from clientsNamesData. Either or both can be empty.
  var firstNameEl = document.getElementById('clients-detail-first-name');
  var lastNameEl = document.getElementById('clients-detail-last-name');
  var nameStatusEl = document.getElementById('clients-detail-name-status');
  var existingName = clientsNamesData[sub.email.toLowerCase()] || { first_name: '', last_name: '' };
  if (firstNameEl) firstNameEl.value = existingName.first_name || '';
  if (lastNameEl) lastNameEl.value = existingName.last_name || '';
  clientsCurrentDetailNameOriginal = {
    first_name: existingName.first_name || '',
    last_name: existingName.last_name || ''
  };
  if (nameStatusEl) {
    nameStatusEl.textContent = '';
    nameStatusEl.className = 'clients-s-note-status';
  }

  // Re-use the source badge styling from the table for visual consistency.
  if (sourceEl) {
    var sourceClass = 'clients-s-source-' + (sub.source || 'bio');
    var sourceLabel = CLIENT_SOURCE_LABEL[sub.source] || 'Bio';
    sourceEl.innerHTML = '<span class="clients-s-source-badge ' + sourceClass + '">' + sourceLabel + '</span>';
  }
  if (optinEl) {
    optinEl.innerHTML = sub.optin
      ? '<span class="clients-s-becac0">Yes</span>'
      : '<span class="prod-s-6c6a73">No</span>';
  }
  if (dateEl) {
    var d = new Date(sub.date);
    dateEl.textContent = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  // Prefill the note from the in-memory map (already loaded with the table).
  var existing = clientsNotes[sub.email.toLowerCase()] || '';
  noteEl.value = existing;
  clientsCurrentDetailNoteOriginal = existing;
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.className = 'clients-s-note-status';
  }

  modal.style.display = 'flex';
  // Focus the textarea on next frame so the modal mounts first (avoids
  // scroll jump on some browsers).
  requestAnimationFrame(function() { try { noteEl.focus(); } catch (e) {} });
}

function clientsCloseDetail() {
  var modal = document.getElementById('clients-detail-modal');
  if (modal) modal.style.display = 'none';
  clientsCurrentDetailEmail = null;
  clientsCurrentDetailNoteOriginal = '';
  clientsCurrentDetailNameOriginal = { first_name: '', last_name: '' };
}

// Done button: explicit "I'm finished" action. Triggers the save (if the
// note actually changed) and waits for it to complete before closing, so
// the creator never closes the modal with an unsaved or in-flight note.
// Without this, users have to guess that clicking outside the textarea or
// closing the modal saves their note. The button makes the action explicit.
async function clientsDoneDetail(e, el) {
  if (el) el.disabled = true;
  try {
    // Save name first (small write), then note. Both no-op if unchanged.
    await clientsSaveName();
    await clientsSaveNote();
  } catch (err) {
    // Save errors are surfaced inline by their respective save functions.
    // Don't block the close - creator can re-open and try again.
    console.error('Save during Done failed:', err);
  } finally {
    if (el) el.disabled = false;
    clientsCloseDetail();
  }
}

// Auto-save the note on textarea blur. Skips the network call if nothing
// changed since open. Uses upsert with the (creator_id, email) unique
// constraint so the same email can be saved repeatedly without growing rows.
async function clientsSaveNote() {
  if (!clientsCurrentDetailEmail) return;
  var noteEl = document.getElementById('clients-detail-note');
  var statusEl = document.getElementById('clients-detail-note-status');
  if (!noteEl) return;

  var newNote = (noteEl.value || '').trim();
  // No-op if the value didn't change. Trim-compared so trailing-whitespace
  // edits don't trigger a save.
  if (newNote === (clientsCurrentDetailNoteOriginal || '').trim()) return;

  if (statusEl) {
    statusEl.textContent = 'Saving...';
    statusEl.className = 'clients-s-note-status';
  }

  try {
    var emailLc = clientsCurrentDetailEmail.toLowerCase();
    if (newNote === '') {
      // Empty note: delete the row entirely so the row doesn't linger with
      // an empty string. Keeps the indicator dot logic clean.
      var { error: delErr } = await sb
        .from('subscriber_notes')
        .delete()
        .eq('creator_id', currentUser.id)
        .eq('email', clientsCurrentDetailEmail);
      if (delErr) throw delErr;
      delete clientsNotes[emailLc];
    } else {
      var { error } = await sb.from('subscriber_notes').upsert([{
        creator_id: currentUser.id,
        email: clientsCurrentDetailEmail,
        note: newNote,
        updated_at: new Date().toISOString()
      }], { onConflict: 'creator_id,email' });
      if (error) throw error;
      clientsNotes[emailLc] = newNote;
    }

    clientsCurrentDetailNoteOriginal = newNote;
    if (statusEl) {
      statusEl.textContent = 'Saved';
      statusEl.className = 'clients-s-note-status clients-s-note-status-saved';
      // Fade out after a moment so the indicator doesn't linger forever.
      setTimeout(function() {
        if (statusEl.textContent === 'Saved') {
          statusEl.textContent = '';
          statusEl.className = 'clients-s-note-status';
        }
      }, 2500);
    }
    // Re-render the page so the note indicator dot appears/disappears.
    renderSubscribersPage();
  } catch (e) {
    console.error('Note save failed:', e);
    if (statusEl) {
      statusEl.textContent = 'Could not save';
      statusEl.className = 'clients-s-note-status clients-s-note-status-error';
    }
  }
}

// Auto-save first/last name fields on blur. Saves BOTH fields as one row
// in subscriber_names (single source of truth for creator-edited names).
// Skips the network call if neither field changed. Treats both-empty as a
// delete so the row doesn't linger as an empty placeholder.
async function clientsSaveName() {
  if (!clientsCurrentDetailEmail) return;
  var firstEl = document.getElementById('clients-detail-first-name');
  var lastEl = document.getElementById('clients-detail-last-name');
  var statusEl = document.getElementById('clients-detail-name-status');
  if (!firstEl || !lastEl) return;

  var newFirst = (firstEl.value || '').trim();
  var newLast = (lastEl.value || '').trim();

  // No-op if nothing changed. Trim-compared so trailing-whitespace edits
  // don't trigger a save.
  var origFirst = (clientsCurrentDetailNameOriginal.first_name || '').trim();
  var origLast = (clientsCurrentDetailNameOriginal.last_name || '').trim();
  if (newFirst === origFirst && newLast === origLast) return;

  if (statusEl) {
    statusEl.textContent = 'Saving...';
    statusEl.className = 'clients-s-note-status';
  }

  try {
    var emailLc = clientsCurrentDetailEmail.toLowerCase();
    if (newFirst === '' && newLast === '') {
      // Both empty: delete the row. Same clean-state pattern the notes
      // table uses. If the underlying subscriber came from manual_subscribers
      // with names there, those names will reappear after reload (which is
      // correct: clearing the creator override means "fall back to source").
      var { error: delErr } = await sb
        .from('subscriber_names')
        .delete()
        .eq('creator_id', currentUser.id)
        .eq('email', clientsCurrentDetailEmail);
      if (delErr) throw delErr;
      delete clientsNamesData[emailLc];
    } else {
      var { error } = await sb.from('subscriber_names').upsert([{
        creator_id: currentUser.id,
        email: clientsCurrentDetailEmail,
        first_name: newFirst || null,
        last_name: newLast || null,
        updated_at: new Date().toISOString()
      }], { onConflict: 'creator_id,email' });
      if (error) throw error;
      clientsNamesData[emailLc] = {
        first_name: newFirst,
        last_name: newLast
      };
    }

    clientsCurrentDetailNameOriginal = { first_name: newFirst, last_name: newLast };
    if (statusEl) {
      statusEl.textContent = 'Saved';
      statusEl.className = 'clients-s-note-status clients-s-note-status-saved';
      setTimeout(function() {
        if (statusEl.textContent === 'Saved') {
          statusEl.textContent = '';
          statusEl.className = 'clients-s-note-status';
        }
      }, 2500);
    }
  } catch (e) {
    console.error('Name save failed:', e);
    if (statusEl) {
      statusEl.textContent = 'Could not save';
      statusEl.className = 'clients-s-note-status clients-s-note-status-error';
    }
  }
}

// Close the modal when clicking the dark backdrop (but not when clicking
// inside the modal itself). The button uses the same close handler.
function clientsBackdropClick(event, el) {
  if (event.target === el) clientsCloseDetail();
}

// =============================================================================
// MANUAL ADD: single subscriber
// =============================================================================

var CLIENTS_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientsOpenAdd() {
  var modal = document.getElementById('clients-add-modal');
  if (!modal) return;
  // Reset fields each time the modal opens.
  ['clients-add-email', 'clients-add-first-name', 'clients-add-last-name', 'clients-add-note'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var err = document.getElementById('clients-add-error');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  modal.style.display = 'flex';
  requestAnimationFrame(function() {
    try { document.getElementById('clients-add-email').focus(); } catch (e) {}
  });
}

function clientsCloseAdd() {
  var modal = document.getElementById('clients-add-modal');
  if (modal) modal.style.display = 'none';
}

function clientsAddBackdropClick(event, el) {
  if (event.target === el) clientsCloseAdd();
}

async function clientsSubmitAdd() {
  var emailRaw = (document.getElementById('clients-add-email').value || '').trim();
  var firstName = (document.getElementById('clients-add-first-name').value || '').trim();
  var lastName = (document.getElementById('clients-add-last-name').value || '').trim();
  var note = (document.getElementById('clients-add-note').value || '').trim();
  var err = document.getElementById('clients-add-error');
  var submitBtn = document.getElementById('clients-add-submit-btn');

  function showErr(msg) {
    if (err) { err.style.display = 'block'; err.textContent = msg; }
  }

  if (!emailRaw) return showErr('Email is required.');
  if (!CLIENTS_EMAIL_RE.test(emailRaw)) return showErr("That doesn't look like a valid email address.");

  var emailLc = emailRaw.toLowerCase();

  // Block adding emails that are currently suppressed - the creator explicitly
  // removed them before, so silently re-adding would defeat the opt-out.
  if (clientsSuppressed.has(emailLc)) {
    return showErr('This email was previously removed from your list. Restore it from the suppression list first or contact support.');
  }
  // Block exact duplicates of currently-shown subscribers.
  if (clientsData.some(function(c) { return c.email.toLowerCase() === emailLc; })) {
    return showErr('This email is already in your subscribers list.');
  }

  if (submitBtn) submitBtn.disabled = true;
  if (err) { err.style.display = 'none'; err.textContent = ''; }

  try {
    var { error } = await sb.from('manual_subscribers').insert({
      creator_id: currentUser.id,
      email: emailRaw,
      first_name: firstName || null,
      last_name: lastName || null,
      added_via: 'manual'
    });
    if (error) throw error;

    // Save note if provided. Same upsert pattern as the detail modal.
    if (note) {
      try {
        await sb.from('subscriber_notes').upsert([{
          creator_id: currentUser.id,
          email: emailRaw,
          note: note,
          updated_at: new Date().toISOString()
        }], { onConflict: 'creator_id,email' });
        clientsNotes[emailLc] = note;
      } catch (noteErr) { console.warn('Note save failed (subscriber still added):', noteErr); }
    }

    // Add locally so the table updates without a full reload.
    clientsData.unshift({
      email: emailRaw,
      date: new Date().toISOString(),
      optin: true,
      source: 'manual'
    });
    filterSubscribers();
    renderClientsStats();
    var countEl = document.getElementById('clients-count');
    if (countEl) countEl.textContent = clientsData.length + ' subscriber' + (clientsData.length !== 1 ? 's' : '');
    clientsCloseAdd();
  } catch (e) {
    console.error('Add subscriber failed:', e);
    // 23505 is the Postgres unique-violation code. Means the email exists in
    // manual_subscribers (possibly added in another tab). Friendly message.
    if (e && (e.code === '23505' || /duplicate/i.test(e.message || ''))) {
      showErr('This email is already in your subscribers list.');
    } else {
      showErr(e.message || 'Could not add subscriber.');
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// =============================================================================
// CSV IMPORT
// =============================================================================

var CLIENTS_IMPORT_MAX_BYTES = 25 * 1024 * 1024;         // 25 MB
var CLIENTS_IMPORT_MAX_ROWS = 50000;                      // hard ceiling
var CLIENTS_IMPORT_BATCH_SIZE = 500;                      // rows per Supabase upsert

// Header name patterns. First match wins. We compare against the header text
// lowercased + trimmed so 'Email Address' and 'email_address' both match.
var CLIENTS_EMAIL_HEADER_PATTERNS = [
  /^email$/, /^email_address$/, /^email address$/, /email/
];
var CLIENTS_STATUS_HEADER_PATTERNS = [
  /^status$/, /^state$/, /^subscribed$/, /^subscription[ _]?status$/, /^active$/
];
var CLIENTS_STATUS_ACTIVE_VALUES = new Set(['subscribed', 'active', 'confirmed', 'true', 'yes', '1', '']);
var CLIENTS_STATUS_INACTIVE_VALUES = new Set(['unsubscribed', 'cleaned', 'bounced', 'complained', 'pending', 'inactive', 'false', 'no', '0', 'unconfirmed', 'archived']);

// Holds the parsed CSV between steps. Reset on modal open / close.
var clientsImport = {
  fileName: '',
  rows: [],            // array of objects keyed by header
  headers: [],         // ordered header list
  emailColumn: null,   // currently-selected column name for email
  statusColumn: null,  // auto-detected status column (null if none)
  validation: null     // computed counts: total, valid, invalid, suppressed, duplicate, alreadyIn, skippedStatus, toAdd, toAddRows
};

function clientsOpenImport() {
  var modal = document.getElementById('clients-import-modal');
  if (!modal) return;
  if (typeof Papa === 'undefined') {
    showModalAlert('CSV parser not loaded', 'Please refresh the page and try again.');
    return;
  }
  clientsImport = { fileName: '', rows: [], headers: [], emailColumn: null, statusColumn: null, validation: null };
  clientsImportShowStep('upload');
  // Reset the file input so re-uploading the same file fires change.
  var fileEl = document.getElementById('clients-import-file');
  if (fileEl) fileEl.value = '';
  modal.style.display = 'flex';
  clientsImportUpdateActionBtn('Import', true);
  clientsImportWireDropzone();
}

// Drag-and-drop is wired imperatively (rather than via data-action) because:
//   - It needs preventDefault on dragover/drop to opt into file drop
//   - It needs a counter for dragenter/leave so child elements don't break
//     the visual state when crossing them
//   - The handlers reference the SAME dropzone across re-opens, so we
//     idempotency-check via a private flag and bind once.
function clientsImportWireDropzone() {
  var zone = document.getElementById('clients-import-dropzone');
  if (!zone || zone._clientsDropWired) return;
  zone._clientsDropWired = true;
  // Counter prevents flicker when dragging over child elements (icon, text).
  // Each dragenter into a descendant fires on the parent too, and dragleave
  // fires when LEAVING any element. A simple toggle would flicker; a counter
  // correctly tracks "the cursor is somewhere inside this dropzone".
  zone._dragCounter = 0;

  zone.addEventListener('dragenter', function(e) {
    e.preventDefault();
    zone._dragCounter++;
    zone.classList.add('clients-s-dropzone-active');
  });
  zone.addEventListener('dragover', function(e) {
    // Must preventDefault on dragover to enable the drop event.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  zone.addEventListener('dragleave', function(e) {
    e.preventDefault();
    zone._dragCounter--;
    if (zone._dragCounter <= 0) {
      zone._dragCounter = 0;
      zone.classList.remove('clients-s-dropzone-active');
    }
  });
  zone.addEventListener('drop', function(e) {
    e.preventDefault();
    zone._dragCounter = 0;
    zone.classList.remove('clients-s-dropzone-active');
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length === 0) return;
    var file = files[0];
    // Validate extension OR MIME type before going further. Some OSes don't
    // set MIME on CSV files, so we accept either an extension match or the
    // browser-provided MIME hint.
    var nameLc = (file.name || '').toLowerCase();
    var typeOk = (file.type === 'text/csv' || file.type === 'application/vnd.ms-excel' || file.type === '');
    if (!nameLc.endsWith('.csv') && !typeOk) {
      showModalAlert('Wrong file type', 'Please drop a .csv file.');
      return;
    }
    // Re-use the same handler the file picker calls so validation + parsing
    // logic stays in one place.
    clientsImportFileSelected(null, { files: [file], value: '' });
  });
}

function clientsCloseImport() {
  var modal = document.getElementById('clients-import-modal');
  if (modal) modal.style.display = 'none';
  clientsImport = { fileName: '', rows: [], headers: [], emailColumn: null, statusColumn: null, validation: null };
}

function clientsImportBackdropClick(event, el) {
  if (event.target === el) clientsCloseImport();
}

function clientsImportShowStep(step) {
  ['upload', 'preview', 'progress', 'result'].forEach(function(s) {
    var el = document.getElementById('clients-import-step-' + s);
    if (el) el.style.display = (s === step) ? 'block' : 'none';
  });
}

function clientsImportUpdateActionBtn(label, disabled) {
  var btn = document.getElementById('clients-import-action-btn');
  if (!btn) return;
  btn.textContent = label;
  btn.disabled = !!disabled;
}

// File picker -> parse with PapaParse. We use header:true so each row is an
// object keyed by column name. skipEmptyLines avoids blank rows polluting counts.
function clientsImportFileSelected(event, el) {
  var file = el && el.files && el.files[0];
  if (!file) return;
  if (file.size > CLIENTS_IMPORT_MAX_BYTES) {
    showModalAlert('File too large', 'CSV must be 25MB or smaller. For very large lists (over 50,000 rows), split into multiple files and import them in pieces.');
    el.value = '';
    return;
  }
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    transformHeader: function(h) { return String(h || '').trim(); },
    complete: function(results) {
      var rows = results.data || [];
      if (rows.length === 0) {
        showModalAlert('Empty file', 'No rows found in this CSV.');
        return;
      }
      if (rows.length > CLIENTS_IMPORT_MAX_ROWS) {
        showModalAlert('Too many rows', 'Maximum ' + CLIENTS_IMPORT_MAX_ROWS.toLocaleString() + ' rows per import. Split your file and try again.');
        return;
      }
      clientsImport.fileName = file.name;
      clientsImport.rows = rows;
      clientsImport.headers = (results.meta && results.meta.fields) ? results.meta.fields.slice() : Object.keys(rows[0]);
      clientsImport.emailColumn = clientsImportDetectEmailColumn(clientsImport.headers);
      clientsImport.statusColumn = clientsImportDetectStatusColumn(clientsImport.headers);
      clientsImportRenderPreview();
      clientsImportShowStep('preview');
    },
    error: function(err) {
      console.error('CSV parse error:', err);
      showModalAlert('Could not parse CSV', err.message || 'The file may be malformed.');
    }
  });
}

function clientsImportDetectEmailColumn(headers) {
  for (var i = 0; i < CLIENTS_EMAIL_HEADER_PATTERNS.length; i++) {
    var pattern = CLIENTS_EMAIL_HEADER_PATTERNS[i];
    for (var j = 0; j < headers.length; j++) {
      if (pattern.test(headers[j].toLowerCase())) return headers[j];
    }
  }
  return null;
}

function clientsImportDetectStatusColumn(headers) {
  for (var i = 0; i < CLIENTS_STATUS_HEADER_PATTERNS.length; i++) {
    var pattern = CLIENTS_STATUS_HEADER_PATTERNS[i];
    for (var j = 0; j < headers.length; j++) {
      if (pattern.test(headers[j].toLowerCase())) return headers[j];
    }
  }
  return null;
}

function clientsImportRenderPreview() {
  var rows = clientsImport.rows;
  var headers = clientsImport.headers;

  document.getElementById('clients-import-filename').textContent = clientsImport.fileName;
  document.getElementById('clients-import-rowstats').textContent = rows.length.toLocaleString() + ' row' + (rows.length !== 1 ? 's' : '') + ' detected';

  // Email column picker
  var emailSelect = document.getElementById('clients-import-email-col');
  if (emailSelect) {
    emailSelect.innerHTML = '';
    headers.forEach(function(h) {
      var opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      if (h === clientsImport.emailColumn) opt.selected = true;
      emailSelect.appendChild(opt);
    });
    if (!clientsImport.emailColumn && headers.length > 0) {
      clientsImport.emailColumn = headers[0];
      emailSelect.value = headers[0];
    }
  }
  var hintEl = document.getElementById('clients-import-email-hint');
  if (hintEl) {
    hintEl.textContent = clientsImport.emailColumn
      ? 'We auto-detected this column. Change it if needed.'
      : "We couldn't auto-detect the email column. Please choose one.";
  }

  // Preview table (first 5 rows of CSV, no row count column)
  var tbl = document.getElementById('clients-import-preview-table');
  if (tbl) {
    var thead = '<thead><tr>' + headers.map(function(h) {
      return '<th>' + escapeHtml(h) + '</th>';
    }).join('') + '</tr></thead>';
    var previewRows = rows.slice(0, 5);
    var tbody = '<tbody>' + previewRows.map(function(r) {
      return '<tr>' + headers.map(function(h) {
        var v = r[h];
        return '<td>' + escapeHtml(v == null ? '' : String(v)) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody>';
    tbl.innerHTML = thead + tbody;
  }

  clientsImportComputeValidation();
}

function clientsImportEmailColChange(event, el) {
  clientsImport.emailColumn = el.value;
  clientsImportComputeValidation();
}

// Run through the parsed rows, classifying each one. Powers the preview
// summary and the actual insert.
function clientsImportComputeValidation() {
  var rows = clientsImport.rows;
  var emailCol = clientsImport.emailColumn;
  var statusCol = clientsImport.statusColumn;
  var existingEmails = new Set(clientsData.map(function(c) { return c.email.toLowerCase(); }));

  var stats = {
    total: rows.length,
    valid: 0,
    invalid: 0,
    skippedStatus: 0,
    alreadyIn: 0,
    suppressed: 0,
    duplicateInFile: 0,
    toAdd: 0,
    toAddRows: []
  };

  if (!emailCol) {
    clientsImport.validation = stats;
    clientsImportRenderValidation();
    return;
  }

  var seenInFile = new Set();

  rows.forEach(function(r) {
    var email = String(r[emailCol] || '').trim();
    if (!email || !CLIENTS_EMAIL_RE.test(email)) {
      stats.invalid++;
      return;
    }
    stats.valid++;
    var emailLc = email.toLowerCase();

    // Check status column if one was auto-detected.
    if (statusCol) {
      var status = String(r[statusCol] || '').trim().toLowerCase();
      if (CLIENTS_STATUS_INACTIVE_VALUES.has(status)) {
        stats.skippedStatus++;
        return;
      }
    }

    if (seenInFile.has(emailLc)) {
      stats.duplicateInFile++;
      return;
    }
    seenInFile.add(emailLc);

    if (clientsSuppressed.has(emailLc)) {
      stats.suppressed++;
      return;
    }
    if (existingEmails.has(emailLc)) {
      stats.alreadyIn++;
      return;
    }

    // Extract optional first/last name if those columns happen to exist.
    var firstName = null, lastName = null;
    clientsImport.headers.forEach(function(h) {
      var hLc = h.toLowerCase();
      if (hLc === 'first name' || hLc === 'first_name' || hLc === 'firstname' || hLc === 'fname') {
        firstName = String(r[h] || '').trim() || null;
      } else if (hLc === 'last name' || hLc === 'last_name' || hLc === 'lastname' || hLc === 'lname') {
        lastName = String(r[h] || '').trim() || null;
      }
    });

    stats.toAdd++;
    stats.toAddRows.push({
      creator_id: currentUser.id,
      email: email,
      first_name: firstName,
      last_name: lastName,
      added_via: 'csv_import'
    });
  });

  clientsImport.validation = stats;
  clientsImportRenderValidation();
}

function clientsImportRenderValidation() {
  var stats = clientsImport.validation;
  var el = document.getElementById('clients-import-validation');
  if (!el || !stats) return;
  var lines = [];
  lines.push('<div class="clients-s-import-validation-line"><span>Total rows</span><span class="clients-s-import-validation-num">' + stats.total.toLocaleString() + '</span></div>');
  if (stats.invalid > 0) lines.push('<div class="clients-s-import-validation-line"><span>Invalid emails</span><span class="clients-s-import-validation-num clients-s-import-validation-num-error">' + stats.invalid.toLocaleString() + '</span></div>');
  if (stats.skippedStatus > 0) lines.push('<div class="clients-s-import-validation-line"><span>Marked as unsubscribed in your CSV (skipped)</span><span class="clients-s-import-validation-num clients-s-import-validation-num-skip">' + stats.skippedStatus.toLocaleString() + '</span></div>');
  if (stats.duplicateInFile > 0) lines.push('<div class="clients-s-import-validation-line"><span>Duplicate rows in this file</span><span class="clients-s-import-validation-num clients-s-import-validation-num-skip">' + stats.duplicateInFile.toLocaleString() + '</span></div>');
  if (stats.alreadyIn > 0) lines.push('<div class="clients-s-import-validation-line"><span>Already in your list</span><span class="clients-s-import-validation-num clients-s-import-validation-num-skip">' + stats.alreadyIn.toLocaleString() + '</span></div>');
  if (stats.suppressed > 0) lines.push('<div class="clients-s-import-validation-line"><span>Previously removed by you</span><span class="clients-s-import-validation-num clients-s-import-validation-num-skip">' + stats.suppressed.toLocaleString() + '</span></div>');
  lines.push('<div class="clients-s-import-validation-line"><span><strong>Ready to add</strong></span><span class="clients-s-import-validation-num clients-s-import-validation-num-add">' + stats.toAdd.toLocaleString() + '</span></div>');
  el.innerHTML = lines.join('');

  // Update action button: only enable if there's at least 1 to add.
  clientsImportUpdateActionBtn('Add ' + stats.toAdd.toLocaleString() + ' Subscriber' + (stats.toAdd !== 1 ? 's' : ''), stats.toAdd === 0);
}

// Action button click dispatcher: behavior depends on which step is visible.
// On preview: kick off import. On result: close the modal.
async function clientsImportAction() {
  var resultStep = document.getElementById('clients-import-step-result');
  var isResultStep = resultStep && resultStep.style.display !== 'none';
  if (isResultStep) {
    clientsCloseImport();
    return;
  }
  await clientsImportRunImport();
}

async function clientsImportRunImport() {
  var stats = clientsImport.validation;
  if (!stats || stats.toAdd === 0) return;

  clientsImportShowStep('progress');
  clientsImportUpdateActionBtn('Importing...', true);
  document.getElementById('clients-import-cancel-btn').disabled = true;

  var rows = stats.toAddRows;
  var total = rows.length;
  var imported = 0;
  var failed = 0;
  var progressLabel = document.getElementById('clients-import-progress-label');
  var progressFill = document.getElementById('clients-import-progress-fill');
  var progressMeta = document.getElementById('clients-import-progress-meta');

  function updateProgress() {
    var pct = total === 0 ? 100 : Math.floor((imported + failed) / total * 100);
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressMeta) progressMeta.textContent = (imported + failed).toLocaleString() + ' of ' + total.toLocaleString() + ' processed';
  }

  for (var i = 0; i < rows.length; i += CLIENTS_IMPORT_BATCH_SIZE) {
    var batch = rows.slice(i, i + CLIENTS_IMPORT_BATCH_SIZE);
    if (progressLabel) progressLabel.textContent = 'Importing... batch ' + (Math.floor(i / CLIENTS_IMPORT_BATCH_SIZE) + 1) + ' of ' + Math.ceil(rows.length / CLIENTS_IMPORT_BATCH_SIZE);
    try {
      // ignoreDuplicates handles the edge case where between validation and
      // insert another tab added the same email. Won't surface as an error.
      var { error } = await sb.from('manual_subscribers').upsert(batch, {
        onConflict: 'creator_id,email',
        ignoreDuplicates: true
      });
      if (error) {
        console.error('Batch insert failed:', error);
        failed += batch.length;
      } else {
        imported += batch.length;
      }
    } catch (e) {
      console.error('Batch threw:', e);
      failed += batch.length;
    }
    updateProgress();
  }

  // Show result step.
  clientsImportShowStep('result');
  var resultEl = document.getElementById('clients-import-result-stats');
  if (resultEl) {
    var lines = [];
    lines.push('<div class="clients-s-import-validation-line"><span>Successfully imported</span><span class="clients-s-import-validation-num clients-s-import-validation-num-add">' + imported.toLocaleString() + '</span></div>');
    if (failed > 0) {
      lines.push('<div class="clients-s-import-validation-line"><span>Failed</span><span class="clients-s-import-validation-num clients-s-import-validation-num-error">' + failed.toLocaleString() + '</span></div>');
    }
    if (stats.invalid > 0) lines.push('<div class="clients-s-import-validation-line"><span>Invalid emails (skipped)</span><span class="clients-s-import-validation-num clients-s-import-validation-num-skip">' + stats.invalid.toLocaleString() + '</span></div>');
    if (stats.skippedStatus > 0) lines.push('<div class="clients-s-import-validation-line"><span>Unsubscribed (skipped)</span><span class="clients-s-import-validation-num clients-s-import-validation-num-skip">' + stats.skippedStatus.toLocaleString() + '</span></div>');
    if (stats.alreadyIn > 0) lines.push('<div class="clients-s-import-validation-line"><span>Already in your list</span><span class="clients-s-import-validation-num clients-s-import-validation-num-skip">' + stats.alreadyIn.toLocaleString() + '</span></div>');
    if (stats.suppressed > 0) lines.push('<div class="clients-s-import-validation-line"><span>Previously removed by you</span><span class="clients-s-import-validation-num clients-s-import-validation-num-skip">' + stats.suppressed.toLocaleString() + '</span></div>');
    resultEl.innerHTML = lines.join('');
  }
  clientsImportUpdateActionBtn('Close', false);
  document.getElementById('clients-import-cancel-btn').style.display = 'none';

  // Refresh the subscribers list to pick up the new rows.
  await loadClients();
}


// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

clientsRegisterAction('export', () => exportSubscribers());
clientsRegisterAction('filter', () => filterSubscribers());
clientsRegisterAction('sort-change', () => { applyClientsSort(); clientsCurrentPage = 0; renderSubscribersPage(); });
clientsRegisterAction('page', (e, el) => clientsPage(parseInt(el.dataset.clientsDir, 10)));
clientsRegisterAction('remove-readonly', (e, el) => el.removeAttribute('readonly'));
clientsRegisterAction('toggle-row', (e, el) => clientsToggleRow(el.dataset.clientsEmail, el.checked));
clientsRegisterAction('toggle-all', (e, el) => clientsToggleAll(el.checked));
clientsRegisterAction('bulk-remove', () => clientsBulkRemove());
clientsRegisterAction('bulk-clear', () => clientsClearSelection());
clientsRegisterAction('remove-one', (e, el) => clientsRemoveOne(el.dataset.clientsEmail));
clientsRegisterAction('open-detail', (e, el) => clientsOpenDetail(el.dataset.clientsEmail));
clientsRegisterAction('close-detail', () => clientsCloseDetail());
clientsRegisterAction('done-detail', (e, el) => clientsDoneDetail(e, el));
clientsRegisterAction('modal-backdrop-click', (e, el) => clientsBackdropClick(e, el));
clientsRegisterAction('note-blur', () => clientsSaveNote());
clientsRegisterAction('name-blur', () => clientsSaveName());
clientsRegisterAction('open-add', () => clientsOpenAdd());
clientsRegisterAction('close-add', () => clientsCloseAdd());
clientsRegisterAction('add-backdrop-click', (e, el) => clientsAddBackdropClick(e, el));
clientsRegisterAction('submit-add', () => clientsSubmitAdd());
clientsRegisterAction('open-import', () => clientsOpenImport());
clientsRegisterAction('close-import', () => clientsCloseImport());
clientsRegisterAction('import-backdrop-click', (e, el) => clientsImportBackdropClick(e, el));
clientsRegisterAction('csv-file-selected', (e, el) => clientsImportFileSelected(e, el));
clientsRegisterAction('dropzone-click', () => {
  // Programmatically trigger the hidden file input. Previously the dropzone
  // was a <label> with for= pointing here, but labels interfere with native
  // file-drop semantics so we use a <div role="button"> instead and forward
  // clicks manually.
  var input = document.getElementById('clients-import-file');
  if (input) input.click();
});
clientsRegisterAction('email-col-change', (e, el) => clientsImportEmailColChange(e, el));
clientsRegisterAction('import-action', () => clientsImportAction());

// Escape key closes any open modal. Doesn't capture-phase so other modals
// with their own escape handlers aren't interfered with.
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  var detail = document.getElementById('clients-detail-modal');
  var add = document.getElementById('clients-add-modal');
  var imp = document.getElementById('clients-import-modal');
  if (detail && detail.style.display !== 'none') {
    // Give whatever field is focused (note textarea or name input) a chance
    // to fire its blur handler and save before closing.
    var active = document.activeElement;
    if (active && active.id && (active.id === 'clients-detail-note' || active.id === 'clients-detail-first-name' || active.id === 'clients-detail-last-name')) {
      active.blur();
    }
    clientsCloseDetail();
  } else if (add && add.style.display !== 'none') {
    clientsCloseAdd();
  } else if (imp && imp.style.display !== 'none') {
    clientsCloseImport();
  }
});

// Enter in the Add Subscriber email field submits the form (small UX nicety).
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var addModal = document.getElementById('clients-add-modal');
  if (!addModal || addModal.style.display === 'none') return;
  var target = e.target;
  // Don't submit if focus is in the note textarea (Enter should newline).
  if (target && target.id === 'clients-add-note') return;
  // Don't submit if focus isn't in one of the add modal's inputs.
  if (!target || !target.id || !target.id.startsWith('clients-add-')) return;
  e.preventDefault();
  clientsSubmitAdd();
});

// Keyboard activation for the dropzone (now a div with role=button instead
// of a label, so it doesn't get native button activation behavior).
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var target = e.target;
  if (!target || target.id !== 'clients-import-dropzone') return;
  e.preventDefault();
  var input = document.getElementById('clients-import-file');
  if (input) input.click();
});

// Global drag-misfire guard: when the import modal is open, swallow any
// drop event that wasn't on the dropzone so a near-miss doesn't navigate
// the browser to the dropped file. Scoped to when the modal is open so it
// doesn't interfere with other drop targets on the dashboard (Brand Deal
// kanban, file uploaders, etc.) the rest of the time.
['dragover', 'drop'].forEach(function(evt) {
  window.addEventListener(evt, function(e) {
    var modal = document.getElementById('clients-import-modal');
    if (!modal || modal.style.display === 'none') return;
    var zone = document.getElementById('clients-import-dropzone');
    if (zone && (e.target === zone || zone.contains(e.target))) return;
    // Outside the dropzone but modal is open: swallow to prevent browser
    // file navigation. preventDefault is required on BOTH dragover and
    // drop for the swallow to take effect.
    e.preventDefault();
  });
});

