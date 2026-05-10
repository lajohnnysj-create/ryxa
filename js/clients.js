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

function filterSubscribers() {
  var query = (document.getElementById('clients-search')?.value || '').toLowerCase().trim();
  var optinOnly = document.getElementById('clients-optin-filter')?.checked || false;
  clientsFiltered = clientsData.filter(function(c) {
    if (query && !c.email.toLowerCase().includes(query)) return false;
    if (optinOnly && !c.optin) return false;
    return true;
  });
  clientsCurrentPage = 0;
  renderSubscribersPage();
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
    tbody.innerHTML = '<tr><td colspan="3" class="ana-s-cd4491">' + (clientsData.length > 0 ? 'No results found' : 'No subscribers yet') + '</td></tr>';
  } else {
    tbody.innerHTML = page.map(function(c) {
      var d = new Date(c.date);
      var date = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
      var optinBadge = c.optin
        ? '<span class="clients-s-becac0">Yes</span>'
        : '<span class="prod-s-6c6a73">No</span>';
      return '<tr class="ana-s-a56f95">'
        + '<td class="clients-s-949353">' + c.email + '</td>'
        + '<td class="clients-s-e6b633">' + optinBadge + '</td>'
        + '<td class="ana-s-14ba36">' + date + '</td>'
        + '</tr>';
    }).join('');
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
}

async function loadClients() {
  const tbody = document.getElementById('clients-tbody');
  if (!tbody || !currentUser) return;
  tbody.innerHTML = '<tr><td colspan="2" class="ana-s-cd4491">Loading...</td></tr>';
  try {
    const clientMap = {};

    const { data: enrollments } = await sb
      .from('course_enrollments')
      .select('user_id, buyer_email, enrolled_at, marketing_consent, courses(user_id)')
      .eq('courses.user_id', currentUser.id)
      .order('enrolled_at', { ascending: false });
    if (enrollments) {
      enrollments.forEach(function(e) {
        if (!e.courses || e.courses.user_id !== currentUser.id) return;
        var email = e.buyer_email || '';
        var key = email || e.user_id;
        if (!clientMap[key]) {
          clientMap[key] = { email: email, date: e.enrolled_at, optin: !!e.marketing_consent };
        } else if (e.marketing_consent) {
          clientMap[key].optin = true;
        }
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
        var key = email || b.user_id;
        if (!clientMap[key]) {
          clientMap[key] = { email: email, date: b.booked_at, optin: !!b.marketing_consent };
        } else {
          if (b.marketing_consent) clientMap[key].optin = true;
          if (new Date(b.booked_at) < new Date(clientMap[key].date)) clientMap[key].date = b.booked_at;
        }
      });
    }

    // Digital product purchases — same opt-in pattern as courses/bookings
    const { data: dpPurchases } = await sb
      .from('digital_product_purchases')
      .select('buyer_user_id, buyer_email, purchased_at, marketing_consent, digital_products(user_id)')
      .eq('digital_products.user_id', currentUser.id)
      .order('purchased_at', { ascending: false });
    if (dpPurchases) {
      dpPurchases.forEach(function(p) {
        if (!p.digital_products || p.digital_products.user_id !== currentUser.id) return;
        var email = p.buyer_email || '';
        var key = email || p.buyer_user_id;
        if (!clientMap[key]) {
          clientMap[key] = { email: email, date: p.purchased_at, optin: !!p.marketing_consent };
        } else {
          if (p.marketing_consent) clientMap[key].optin = true;
          if (new Date(p.purchased_at) < new Date(clientMap[key].date)) clientMap[key].date = p.purchased_at;
        }
      });
    }

    // Fetch bio email signups (always opted in)
    const { data: signups } = await sb
      .from('bio_email_signups')
      .select('email, created_at')
      .eq('creator_id', currentUser.id)
      .order('created_at', { ascending: false });
    if (signups) {
      signups.forEach(function(s) {
        var email = s.email || '';
        if (!email) return;
        if (!clientMap[email]) {
          clientMap[email] = { email: email, date: s.created_at, optin: true };
        } else {
          clientMap[email].optin = true;
          if (new Date(s.created_at) < new Date(clientMap[email].date)) clientMap[email].date = s.created_at;
        }
      });
    }

    var clients = Object.values(clientMap).filter(function(c) { return c.email; });
    clients.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    clientsData = clients;
    clientsFiltered = clients.slice();
    clientsCurrentPage = 0;

    var countEl = document.getElementById('clients-count');
    if (countEl) countEl.textContent = clients.length + ' subscriber' + (clients.length !== 1 ? 's' : '');

    // Clear search on reload
    var searchEl = document.getElementById('clients-search');
    if (searchEl) searchEl.value = '';

    renderSubscribersPage();
  } catch (e) {
    console.error('Subscribers load error:', e);
    tbody.innerHTML = '<tr><td colspan="2" class="ana-s-cd4491">Could not load subscribers</td></tr>';
  }
}

function exportSubscribers() {
  var exportData = clientsFiltered.length > 0 ? clientsFiltered : clientsData;
  if (!exportData || exportData.length === 0) {
    showModalAlert('No Data', 'No subscribers to export.');
    return;
  }
  var csv = 'Email,Opt In,Date Joined\n';
  exportData.forEach(function(c) {
    var d = new Date(c.date);
    var date = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
    csv += '"' + c.email.replace(/"/g, '""') + '",' + (c.optin ? 'Yes' : 'No') + ',' + date + '\n';
  });
  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'ryxa-subscribers.csv';
  a.click();
  URL.revokeObjectURL(url);
}


// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

clientsRegisterAction('export', () => exportSubscribers());
clientsRegisterAction('filter', () => filterSubscribers());
clientsRegisterAction('page', (e, el) => clientsPage(parseInt(el.dataset.clientsDir, 10)));
clientsRegisterAction('remove-readonly', (e, el) => el.removeAttribute('readonly'));

