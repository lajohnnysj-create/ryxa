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

// =============================================================================
// SERVER-SIDE PAGINATION (subscribers_view)
// =============================================================================
// loadClients() now queries the subscribers_view (defined in
// migrations/subscribers-view.sql) with proper LIMIT/OFFSET/WHERE clauses.
// This drops egress per page load from ~5-10MB at 30k subscribers to ~10-20KB
// and makes search/sort/filter instant via Postgres indexes.
//
// State model:
//   - clientsData: current page rows only (~50 items, NOT the whole list)
//   - clientsTotalCount: total matching rows for current filter (server gives us)
//   - clientsStatsData: { total, optin, optout } from separate COUNT queries
//   - overlays (clientsSuppressed, clientsNotes, clientsNamesData): still
//     fetched in full on initial load. They're small enough to be cheap.
//     Names from Stripe-captured columns are fetched per-page to keep
//     egress bounded.
//
// Operations that NEEDED the full list before (CSV export, CSV import dedup)
// use a separate emails-only fetch helper that returns ~30 bytes per row.

var clientsTotalCount = 0;
var clientsStatsData = { total: 0, optin: 0, optout: 0 };

// =============================================================================
// MANUAL SUBSCRIBER ATTESTATION / SAFEGUARDS
// =============================================================================
// Three layers:
//   1. Per-row attestation on every single manual add (timestamp written to
//      manual_subscribers.attestation_acknowledged_at).
//   2. Per-import attestation on every CSV bulk import (logged to
//      manual_subscriber_imports via /api/log-manual-subscribers-import).
//   3. Soft threshold at 5k manual_subscribers (stricter attestation, logged
//      to manual_subscriber_threshold_events, fires notification email to
//      notifications@ryxa.io). Once cleared, user never sees it again.
//
// Hard ceiling at 1M is enforced by a DB trigger. The client just catches the
// specific error message and shows a friendly modal.
var MANUAL_SUBS_THRESHOLD = 5000;
var MANUAL_SUBS_ATTESTATION_VERSION = 'v1';
var MANUAL_SUBS_ATTESTATION_SINGLE = 'I confirm I have permission to add this contact to my Ryxa subscriber list.';
var MANUAL_SUBS_ATTESTATION_IMPORT = 'I confirm that the contacts in this list have opted in to receive emails from me, and I have the legal right to import them into Ryxa.';
var MANUAL_SUBS_ATTESTATION_THRESHOLD = 'I confirm that every email in this list was collected with active, voluntary opt-in consent from the contact. I have records of that consent and can produce them if requested. I understand that Ryxa may suspend or terminate my account if complaints, abuse reports, or legal issues arise from this list.';
var MANUAL_SUBS_API_LOG_IMPORT = '/api/log-manual-subscribers-import';
var MANUAL_SUBS_API_CROSS_THRESHOLD = '/api/cross-manual-subscribers-threshold';

// Cache: whether this user has already cleared the 5k threshold attestation.
// Loaded once on clients page init; updated locally after successful crossing.
var clientsThresholdCleared = null;

// Debounce timer for the search input. Each keystroke resets the timer; the
// query only fires once the user pauses typing (200ms). Without this, every
// letter would trigger a network call at 30k subscribers.
var clientsSearchDebounceTimer = null;

// Resolves the current filter/sort UI state into a normalized object the
// page-fetcher and stats-fetcher can consume. Single source of truth for
// "what does the creator want to see right now".
function clientsReadFilterState() {
  var query = (document.getElementById('clients-search')?.value || '').trim();
  var optinOnly = document.getElementById('clients-optin-filter')?.checked || false;
  var rangeDays = parseInt(document.getElementById('clients-range-filter')?.value || 'all', 10);
  var sort = document.getElementById('clients-sort')?.value || 'date-desc';
  var cutoffMs = (!isNaN(rangeDays) && rangeDays > 0)
    ? (Date.now() - rangeDays * 24 * 60 * 60 * 1000)
    : null;
  return { query: query, optinOnly: optinOnly, cutoffMs: cutoffMs, sort: sort };
}

// Builds the Supabase query against subscribers_view with filters applied.
// Used by both the page fetcher and the count query so the row scope stays
// consistent. The suppression filter is applied client-side here because
// PostgREST views can't easily do LEFT JOIN at query time - instead we fetch
// the suppression list once on load and post-filter rows. At reasonable
// suppression sizes (under a few hundred per creator) this is fine.
function clientsBuildQuery(filters) {
  var q = sb.from('subscribers_view')
    .select('email, source, optin, joined_at, email_lc', { count: 'exact' })
    .eq('creator_id', currentUser.id);
  if (filters.optinOnly) q = q.eq('optin', true);
  if (filters.cutoffMs !== null) q = q.gte('joined_at', new Date(filters.cutoffMs).toISOString());
  if (filters.query) {
    // ILIKE on email. Match anywhere in the address.
    q = q.ilike('email', '%' + filters.query.replace(/[%_]/g, '\\$&') + '%');
  }
  // Apply suppression filter server-side via NOT IN. This makes pagination
  // math accurate (otherwise pages with many suppressed rows would show
  // fewer items than CLIENTS_PER_PAGE, and the page count would be wrong).
  // PostgREST serializes the IN list into the URL, so very large suppression
  // sets would exceed URL length limits. Cap at SERVER_SUPPRESSION_LIMIT;
  // beyond that, fall back to client-side filter (the comment above the
  // fallback in clientsFetchPage explains the tradeoff).
  if (clientsSuppressed.size > 0 && clientsSuppressed.size <= CLIENTS_SERVER_SUPPRESSION_LIMIT) {
    // PostgREST .not('col', 'in', '(...)') wants parens-wrapped, comma-joined.
    // Emails can't contain parens or commas in valid form, but escape just
    // in case via a defensive replacement.
    var suppressList = Array.from(clientsSuppressed).map(function(e) {
      return String(e).replace(/[(),]/g, '');
    });
    q = q.not('email_lc', 'in', '(' + suppressList.join(',') + ')');
  }
  // Sort. Default date-desc. Email A-Z uses email_lc for stable case-insensitive
  // ordering. Source A-Z sorts by the source label alphabetically.
  switch (filters.sort) {
    case 'date-asc':   q = q.order('joined_at', { ascending: true }); break;
    case 'email-asc':  q = q.order('email_lc', { ascending: true }); break;
    case 'email-desc': q = q.order('email_lc', { ascending: false }); break;
    case 'source-asc': q = q.order('source', { ascending: true }).order('joined_at', { ascending: false }); break;
    case 'date-desc':
    default:           q = q.order('joined_at', { ascending: false });
  }
  return q;
}

// Cap on how many suppressed emails we'll include in the server-side NOT IN
// clause. PostgREST URL limit is ~8KB. Each email averages ~25 chars; at 500
// items the URL fragment is ~12-15KB which is fine, at 2000 it's ~50KB which
// would be rejected. Cap conservatively at 500 - way beyond what any real
// creator suppression list would hit.
var CLIENTS_SERVER_SUPPRESSION_LIMIT = 500;

// Fetches one page of subscribers for the current filter state. Suppression
// filter is applied server-side when feasible (size <= CLIENTS_SERVER_SUPPRESSION_LIMIT).
// For pathologically large suppression sets, falls back to client-side filter
// with a small over-fetch buffer; pagination math may be slightly off in that
// rare case but it's a degenerate scenario unlikely to occur in practice.
// Returns { rows, total } where total reflects the count after the
// server-side suppression filter (so pagination math is correct).
async function clientsFetchPage(pageIndex, filters) {
  var start = pageIndex * CLIENTS_PER_PAGE;
  var pageEnd = start + CLIENTS_PER_PAGE - 1;
  var serverHandlesSuppression = clientsSuppressed.size <= CLIENTS_SERVER_SUPPRESSION_LIMIT;
  var q = clientsBuildQuery(filters).range(start, pageEnd);
  var { data, count, error } = await q;
  if (error) throw error;
  // If server handled suppression, server count is already correct (post-filter).
  // If not, we need to filter client-side and the count is a slight over-estimate.
  if (serverHandlesSuppression) {
    return { rows: data || [], total: count || 0 };
  }
  // Fallback: large-suppression case. Client-side filter and approximate count.
  var rows = (data || []).filter(function(r) { return !clientsSuppressed.has(r.email_lc); });
  return { rows: rows, total: Math.max(0, (count || 0) - clientsSuppressed.size) };
}

// Stats: total, opted-in, opted-out counts (filter-independent - shows overall
// list health, not just current filter view). Uses head-only queries which
// return only the count header, no row data. Cheap. Applies the same
// server-side suppression filter as clientsFetchPage so counts are
// consistent with the page-level rendering math.
async function clientsFetchStats() {
  var serverHandlesSuppression = clientsSuppressed.size <= CLIENTS_SERVER_SUPPRESSION_LIMIT;
  function applySuppression(q) {
    if (clientsSuppressed.size > 0 && serverHandlesSuppression) {
      var suppressList = Array.from(clientsSuppressed).map(function(e) {
        return String(e).replace(/[(),]/g, '');
      });
      return q.not('email_lc', 'in', '(' + suppressList.join(',') + ')');
    }
    return q;
  }
  var [totalRes, optinRes] = await Promise.all([
    applySuppression(sb.from('subscribers_view')
      .select('email_lc', { count: 'exact', head: true })
      .eq('creator_id', currentUser.id)),
    applySuppression(sb.from('subscribers_view')
      .select('email_lc', { count: 'exact', head: true })
      .eq('creator_id', currentUser.id)
      .eq('optin', true))
  ]);
  var total = totalRes.count || 0;
  var optin = optinRes.count || 0;
  // Fallback path: suppression too large for server NOT IN. Approximate by
  // subtracting suppression count from total. The optin count is harder to
  // correct (we don't know how many suppressed emails were opt-in), so
  // conservatively cap optin <= total.
  if (!serverHandlesSuppression && clientsSuppressed.size > 0) {
    total = Math.max(0, total - clientsSuppressed.size);
    optin = Math.min(optin, total);
  }
  return { total: total, optin: optin, optout: total - optin };
}

// Fetches Stripe-captured names + manual_subscribers names ONLY for the
// emails currently displayed. Keeps egress bounded to ~50 rows per query.
// Returns a name map keyed by lowercased email, with proper precedence:
//   subscriber_names > Stripe-captured (oldest) > manual_subscribers
async function clientsFetchNamesForPage(emails) {
  if (!emails || emails.length === 0) return {};
  var nameMap = {};
  // Layer 3 (lowest): manual_subscribers
  try {
    var { data: ms } = await sb
      .from('manual_subscribers')
      .select('email, first_name, last_name')
      .eq('creator_id', currentUser.id)
      .in('email', emails);
    (ms || []).forEach(function(m) {
      if (m.first_name || m.last_name) {
        nameMap[m.email.toLowerCase()] = {
          first_name: m.first_name || '', last_name: m.last_name || ''
        };
      }
    });
  } catch (e) { console.warn('manual names fetch failed:', e); }
  // Layer 2: Stripe-captured names from the 3 buyer source tables. Pick
  // OLDEST per email for stability (matches what the old aggregation did).
  try {
    var stripeBuf = {};
    function considerStripe(email, first, last, dateStr) {
      if (!email || (!first && !last)) return;
      var key = email.toLowerCase();
      var t = new Date(dateStr).getTime();
      if (!stripeBuf[key] || t < stripeBuf[key].t) {
        stripeBuf[key] = { first_name: first || '', last_name: last || '', t: t };
      }
    }
    var [enrollResp, bookResp, dpResp] = await Promise.all([
      sb.from('course_enrollments')
        .select('buyer_email, buyer_first_name, buyer_last_name, enrolled_at, courses(user_id)')
        .eq('courses.user_id', currentUser.id)
        .in('buyer_email', emails),
      sb.from('coaching_bookings')
        .select('buyer_email, buyer_first_name, buyer_last_name, booked_at, coaching_services(user_id)')
        .eq('coaching_services.user_id', currentUser.id)
        .in('buyer_email', emails),
      sb.from('digital_product_purchases')
        .select('buyer_email, buyer_first_name, buyer_last_name, purchased_at, digital_products(user_id)')
        .eq('digital_products.user_id', currentUser.id)
        .in('buyer_email', emails)
    ]);
    (enrollResp.data || []).forEach(function(r) {
      if (!r.courses || r.courses.user_id !== currentUser.id) return;
      considerStripe(r.buyer_email, r.buyer_first_name, r.buyer_last_name, r.enrolled_at);
    });
    (bookResp.data || []).forEach(function(r) {
      if (!r.coaching_services || r.coaching_services.user_id !== currentUser.id) return;
      considerStripe(r.buyer_email, r.buyer_first_name, r.buyer_last_name, r.booked_at);
    });
    (dpResp.data || []).forEach(function(r) {
      if (!r.digital_products || r.digital_products.user_id !== currentUser.id) return;
      considerStripe(r.buyer_email, r.buyer_first_name, r.buyer_last_name, r.purchased_at);
    });
    Object.keys(stripeBuf).forEach(function(key) {
      nameMap[key] = {
        first_name: stripeBuf[key].first_name,
        last_name: stripeBuf[key].last_name
      };
    });
  } catch (e) { console.warn('Stripe names fetch failed:', e); }
  // Layer 1 (highest): creator-edited names
  try {
    var { data: sn } = await sb
      .from('subscriber_names')
      .select('email, first_name, last_name')
      .eq('creator_id', currentUser.id)
      .in('email', emails);
    (sn || []).forEach(function(n) {
      nameMap[n.email.toLowerCase()] = {
        first_name: n.first_name || '', last_name: n.last_name || ''
      };
    });
  } catch (e) { console.warn('creator-edited names fetch failed:', e); }
  return nameMap;
}

// Monotonically-increasing sequence number to guard against out-of-order
// reload completions. Each invocation of clientsReloadPage claims a token
// before its first await; if a later invocation runs in the interim, this
// older invocation's results are silently discarded when it resolves.
// Without this guard, rapid filter or page changes can paint stale data.
var clientsReloadSeq = 0;

// Detects whether a thrown error from a Supabase query is plausibly transient
// (worth retrying) vs a real logic error (just fail). Transient: HTTP 5xx,
// network failure, generic fetch error with no status. Non-transient: 4xx,
// PostgREST policy/permission errors, anything specific.
function clientsIsTransientError(err) {
  if (!err) return false;
  // Supabase JS sometimes attaches HTTP status as .status, .statusCode, or
  // inside .code. Pick whichever is set.
  var status = err.status || err.statusCode || 0;
  if (status >= 500 && status < 600) return true;
  // Network failures (offline, DNS, fetch abort) typically throw TypeError
  // with no status. Treat those as transient too.
  if (status === 0 && (err.name === 'TypeError' || /fetch/i.test(err.message || ''))) return true;
  return false;
}

// Wraps a fetcher in a sequence-aware retry. On transient failure, waits
// briefly and retries up to maxRetries times. Aborts early if the sequence
// number changes (meaning a newer reload has been issued, this one is stale).
async function clientsFetchPageWithRetry(pageIndex, filters, mySeq, maxRetries) {
  var attempt = 0;
  var lastErr = null;
  while (attempt <= maxRetries) {
    if (mySeq !== clientsReloadSeq) {
      // A newer reload is in flight, give up silently.
      var abort = new Error('stale-reload');
      abort.stale = true;
      throw abort;
    }
    try {
      return await clientsFetchPage(pageIndex, filters);
    } catch (e) {
      lastErr = e;
      if (!clientsIsTransientError(e) || attempt === maxRetries) throw e;
      attempt++;
      // 400ms first retry, 800ms second retry. Gives the DB time to settle
      // after a large insert without making the user wait long.
      await new Promise(function(resolve) { setTimeout(resolve, 400 * attempt); });
    }
  }
  throw lastErr;
}

// Trigger a server reload of the current page based on filter state. Called
// from filter change handlers, sort change, pagination, and refresh.
async function clientsReloadPage() {
  var tbody = document.getElementById('clients-tbody');
  if (!tbody || !currentUser) return;
  var mySeq = ++clientsReloadSeq;
  try {
    var filters = clientsReadFilterState();
    var { rows, total } = await clientsFetchPageWithRetry(clientsCurrentPage, filters, mySeq, 2);
    // If a newer reload has been issued while we were waiting, drop this
    // result on the floor. The newer reload owns the UI.
    if (mySeq !== clientsReloadSeq) return;
    // Map view rows -> the shape the rest of the file expects (clientsData[i])
    clientsData = rows.map(function(r) {
      return {
        email: r.email,
        source: r.source,
        optin: !!r.optin,
        date: r.joined_at
      };
    });
    clientsTotalCount = total;
    // Fetch names just for emails on this page. Merge into clientsNamesData
    // so we don't blow away names already fetched for prior pages (which we
    // DO need cached - the modal opens against any visible row).
    if (clientsData.length > 0) {
      try {
        var pageEmails = clientsData.map(function(c) { return c.email; });
        var pageNames = await clientsFetchNamesForPage(pageEmails);
        // Re-check sequence after this second await - even if the page data
        // is current, a newer reload might have superseded us during names.
        if (mySeq !== clientsReloadSeq) return;
        Object.keys(pageNames).forEach(function(key) {
          clientsNamesData[key] = pageNames[key];
        });
      } catch (nameErr) { console.warn('Per-page names fetch failed:', nameErr); }
    }
    var countEl = document.getElementById('clients-count');
    if (countEl) {
      // With Bug 1 fix, total is already post-suppression (server filtered
      // via NOT IN). No further client-side subtraction needed in the
      // common case. The clientsFetchPage fallback path for huge suppression
      // sets also returns post-filter total, so this is consistent.
      countEl.textContent = total + ' subscriber' + (total !== 1 ? 's' : '');
    }
    renderSubscribersPage();
  } catch (e) {
    // Stale-reload aborts are silent (a newer reload is taking over).
    if (e && e.stale) return;
    console.error('Subscribers page reload failed:', e);
    tbody.innerHTML = '<tr><td colspan="7" class="ana-s-cd4491">Could not load subscribers</td></tr>';
  }
}

// REPLACES the old client-side filter. Now: resets to page 0 and reloads
// from server with the new filter applied. Search keystrokes are debounced
// so we don't spam the server while the user is typing.
function filterSubscribers() {
  // Reset to page 1 whenever filter changes.
  clientsCurrentPage = 0;
  // Debounce ONLY the search input (other filters change less rapidly and
  // benefit from instant feedback). Detect search vs other by checking what
  // triggered the call - cheap heuristic: if the search input has focus,
  // debounce.
  var searchHasFocus = document.activeElement && document.activeElement.id === 'clients-search';
  if (searchHasFocus) {
    if (clientsSearchDebounceTimer) clearTimeout(clientsSearchDebounceTimer);
    clientsSearchDebounceTimer = setTimeout(function() {
      clientsSearchDebounceTimer = null;
      clientsReloadPage();
    }, 250);
  } else {
    clientsReloadPage();
  }
}

// applyClientsSort used to sort the in-memory list. Now sort happens
// server-side, so this just triggers a reload. Kept as a separate function
// since the sort change handler calls it.
function applyClientsSort() {
  // No-op in pagination model - sort is part of the server query. The
  // sort-change action handler calls clientsReloadPage directly.
}

function clientsPage(dir) {
  // clientsTotalCount is already post-suppression-filter (Bug 1 fix moved
  // suppression to server-side). No further subtraction needed.
  var maxPage = Math.max(0, Math.floor((Math.max(0, clientsTotalCount) - 1) / CLIENTS_PER_PAGE));
  clientsCurrentPage = Math.max(0, Math.min(maxPage, clientsCurrentPage + dir));
  clientsReloadPage();
}

function renderSubscribersPage() {
  var tbody = document.getElementById('clients-tbody');
  if (!tbody) return;
  var page = clientsData;
  // clientsTotalCount is already post-suppression (server filtered via NOT IN).
  var displayTotal = clientsTotalCount;
  var maxPage = Math.max(0, Math.floor((displayTotal - 1) / CLIENTS_PER_PAGE));
  var start = clientsCurrentPage * CLIENTS_PER_PAGE;

  if (page.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="ana-s-cd4491">' + (displayTotal > 0 ? 'No results found' : 'No subscribers yet') + '</td></tr>';
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

  var selectAllEl = document.getElementById('clients-select-all');
  if (selectAllEl) {
    selectAllEl.checked = page.length > 0 && page.every(function(c) { return clientsSelected.has(c.email); });
  }

  var pagination = document.getElementById('clients-pagination');
  if (displayTotal > CLIENTS_PER_PAGE) {
    pagination.style.display = 'flex';
    document.getElementById('clients-prev').style.visibility = clientsCurrentPage > 0 ? 'visible' : 'hidden';
    document.getElementById('clients-next').style.visibility = clientsCurrentPage < maxPage ? 'visible' : 'hidden';
    document.getElementById('clients-page-info').textContent = (start + 1) + '\u2013' + Math.min(start + CLIENTS_PER_PAGE, displayTotal) + ' of ' + displayTotal;
  } else {
    pagination.style.display = 'none';
  }

  renderBulkBar();
}

function renderClientsStats() {
  var total = clientsStatsData.total;
  var optin = clientsStatsData.optin;
  var optout = clientsStatsData.optout;
  var totalEl = document.getElementById('clients-stat-total');
  var optinEl = document.getElementById('clients-stat-optin');
  var optoutEl = document.getElementById('clients-stat-optout');
  if (totalEl) totalEl.textContent = total.toLocaleString();
  if (optinEl) optinEl.textContent = optin.toLocaleString();
  if (optoutEl) optoutEl.textContent = optout.toLocaleString();
}

// Kept for backward compatibility - old code in the file may call it but it's
// no longer the merge primitive. The view does the merge now. Safe no-op.
function clientUpsert(clientMap, key, incoming) {
  // Deprecated: merge now happens in subscribers_view (PG side). Left in
  // place so any external caller doesn't crash.
}

async function loadClients() {
  const tbody = document.getElementById('clients-tbody');
  if (!tbody || !currentUser) return;
  tbody.innerHTML = '<tr><td colspan="7" class="ana-s-cd4491">Loading...</td></tr>';
  try {
    // ----- Load overlays in parallel: suppressions, notes (full sets) -----
    // These are creator-scoped and typically small (under a few thousand even
    // for large creators). Pulled once on tool open and reused across paging.
    clientsSuppressed = new Set();
    clientsNotes = {};
    clientsNamesData = {};
    clientsCurrentPage = 0;
    clientsSelected = new Set();

    var overlayPromises = [
      sb.from('subscriber_suppressions').select('email').eq('creator_id', currentUser.id)
        .then(function(res) {
          (res.data || []).forEach(function(s) {
            if (s.email) clientsSuppressed.add(s.email.toLowerCase());
          });
        })
        .catch(function(err) { console.warn('suppressions load failed:', err); }),
      sb.from('subscriber_notes').select('email, note').eq('creator_id', currentUser.id)
        .then(function(res) {
          (res.data || []).forEach(function(n) {
            if (n.email) clientsNotes[n.email.toLowerCase()] = n.note || '';
          });
        })
        .catch(function(err) { console.warn('notes load failed:', err); })
    ];
    await Promise.all(overlayPromises);

    // Clear search input on reload.
    var searchEl = document.getElementById('clients-search');
    if (searchEl) searchEl.value = '';

    // Stats (parallel with first-page fetch).
    var statsPromise = clientsFetchStats()
      .then(function(s) { clientsStatsData = s; renderClientsStats(); })
      .catch(function(err) {
        console.warn('Stats load failed:', err);
        clientsStatsData = { total: 0, optin: 0, optout: 0 };
        renderClientsStats();
      });

    // First page of subscribers + names for that page.
    await clientsReloadPage();
    await statsPromise;
  } catch (e) {
    console.error('Subscribers load error:', e);
    tbody.innerHTML = '<tr><td colspan="7" class="ana-s-cd4491">Could not load subscribers</td></tr>';
  }
}

// CSV export: fetches ALL rows server-side (across all pages) for the current
// filter state. Only returns the lightweight columns we export, so even at
// 30k subscribers this is ~1-2MB - acceptable for an export action.
async function exportSubscribers() {
  // The Supabase REST default row limit is 1000. A single .select() against
  // subscribers_view silently truncates to 1000 rows even for accounts with
  // tens of thousands of subscribers. We fix this by paginating with .range()
  // and concatenating until we hit an empty page.
  var EXPORT_PAGE_SIZE = 1000;
  var btn = document.querySelector('[data-clients-action="export"]');
  var originalBtnHtml = btn ? btn.innerHTML : null;

  function setBtnLabel(text, disabled) {
    if (!btn) return;
    btn.innerHTML = text;
    btn.disabled = !!disabled;
  }
  function restoreBtn() {
    if (btn && originalBtnHtml !== null) {
      btn.innerHTML = originalBtnHtml;
      btn.disabled = false;
    }
  }

  try {
    var filters = clientsReadFilterState();
    setBtnLabel('Preparing export...', true);

    // Build the base query function. Each call creates a fresh query so we
    // can apply .range() per page.
    function buildExportQuery(from, to) {
      var q = sb.from('subscribers_view')
        .select('email, source, optin, joined_at, email_lc')
        .eq('creator_id', currentUser.id);
      if (filters.optinOnly) q = q.eq('optin', true);
      if (filters.cutoffMs !== null) q = q.gte('joined_at', new Date(filters.cutoffMs).toISOString());
      if (filters.query) q = q.ilike('email', '%' + filters.query.replace(/[%_]/g, '\\$&') + '%');
      q = q.order('joined_at', { ascending: false }).range(from, to);
      return q;
    }

    // Fetch in chunks of EXPORT_PAGE_SIZE until a page returns fewer rows
    // than requested (means we hit the end).
    var allRows = [];
    var pageIndex = 0;
    while (true) {
      var from = pageIndex * EXPORT_PAGE_SIZE;
      var to = from + EXPORT_PAGE_SIZE - 1;
      var { data, error } = await buildExportQuery(from, to);
      if (error) throw error;
      var chunk = data || [];
      allRows = allRows.concat(chunk);
      setBtnLabel('Exporting ' + allRows.length.toLocaleString() + '...', true);
      if (chunk.length < EXPORT_PAGE_SIZE) break;
      pageIndex++;
      // Safety: bail at 10M rows to prevent runaway loops on schema bugs.
      // No legitimate account will hit this; the 1M hard ceiling kicks first.
      if (pageIndex > 10000) {
        console.warn('Export bailed at 10M rows safety limit');
        break;
      }
    }

    // Apply the same client-side suppression filter that the page view uses
    // (consistent with what the user sees in the dashboard).
    var rows = allRows.filter(function(r) { return !clientsSuppressed.has(r.email_lc); });

    if (rows.length === 0) {
      restoreBtn();
      showModalAlert('No Data', 'No subscribers to export.');
      return;
    }

    setBtnLabel('Building file...', true);
    var csv = 'Email,Source,Opt In,Date Joined\n';
    rows.forEach(function(c) {
      var d = new Date(c.joined_at);
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
    restoreBtn();
  } catch (e) {
    console.error('Export failed:', e);
    restoreBtn();
    showModalAlert('Export failed', e.message || 'Could not export subscribers. Please try again.');
  }
}

// --- Bulk selection + remove ---

function clientsToggleRow(email, checked) {
  if (!email) return;
  if (checked) clientsSelected.add(email);
  else clientsSelected.delete(email);
  // Sync "select all" checkbox state without re-rendering the whole table.
  // clientsData IS the current page in the new pagination model.
  var selectAllEl = document.getElementById('clients-select-all');
  if (selectAllEl) {
    selectAllEl.checked = clientsData.length > 0 && clientsData.every(function(c) { return clientsSelected.has(c.email); });
  }
  renderBulkBar();
}

function clientsToggleAll(checked) {
  // clientsData IS the current page in the new pagination model.
  clientsData.forEach(function(c) {
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
    clientsSelected = new Set();
    // Reload page from server (the suppression filter is applied at read
    // time, so a fresh fetch correctly drops the removed rows). Refresh
    // stats too since the visible total changed.
    await clientsReloadPage();
    try {
      clientsStatsData = await clientsFetchStats();
      renderClientsStats();
    } catch (statsErr) { console.warn('Stats refresh failed:', statsErr); }
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
    clientsSelected.delete(email);
    // Reload page from server and refresh stats.
    await clientsReloadPage();
    try {
      clientsStatsData = await clientsFetchStats();
      renderClientsStats();
    } catch (statsErr) { console.warn('Stats refresh failed:', statsErr); }
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
  var attestEl = document.getElementById('clients-add-attest');
  if (attestEl) attestEl.checked = false;
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
  var attestCheckbox = document.getElementById('clients-add-attest');

  function showErr(msg) {
    if (err) { err.style.display = 'block'; err.textContent = msg; }
  }

  if (!emailRaw) return showErr('Email is required.');
  if (!CLIENTS_EMAIL_RE.test(emailRaw)) return showErr("That doesn't look like a valid email address.");

  // Attestation required: user must confirm they have permission to add this contact.
  if (!attestCheckbox || !attestCheckbox.checked) {
    return showErr('Please confirm you have permission to add this contact.');
  }

  var emailLc = emailRaw.toLowerCase();

  // Block adding emails that are currently suppressed - the creator explicitly
  // removed them before, so silently re-adding would defeat the opt-out.
  if (clientsSuppressed.has(emailLc)) {
    return showErr('This email was previously removed from your list. Restore it from the suppression list first or contact support.');
  }
  // Note: We used to check clientsData here for duplicates, but with server-
  // side pagination clientsData only holds the current page. Rely on the
  // database unique constraint on manual_subscribers (creator_id, email) -
  // duplicates surface as 23505 and are handled in the catch block below
  // with a friendly message. Same UX, accurate at any page.

  if (submitBtn) submitBtn.disabled = true;
  if (err) { err.style.display = 'none'; err.textContent = ''; }

  // Soft threshold check: count their CURRENT manual_subscribers and see if
  // this add will push them to 5k. If yes and they have not cleared the flag,
  // show the attestation modal first. They can cancel.
  try {
    var currentManualCount = await clientsCountManualSubscribers();
    var willBe = currentManualCount + 1;
    var thresholdResult = await clientsCheckThresholdBeforeAction(willBe);
    if (thresholdResult === 'cancelled') {
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
  } catch (e) {
    console.warn('Threshold pre-check failed (proceeding):', e);
  }

  try {
    var { error } = await sb.from('manual_subscribers').insert({
      creator_id: currentUser.id,
      email: emailRaw,
      first_name: firstName || null,
      last_name: lastName || null,
      added_via: 'manual',
      attestation_acknowledged_at: new Date().toISOString()
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

    // Reset to page 1 and reload from server so the new subscriber appears
    // at the top (default sort is date-desc). Also refresh stats since
    // total just incremented.
    clientsCurrentPage = 0;
    await clientsReloadPage();
    try {
      clientsStatsData = await clientsFetchStats();
      renderClientsStats();
    } catch (statsErr) { console.warn('Stats refresh failed:', statsErr); }
    clientsCloseAdd();
  } catch (e) {
    console.error('Add subscriber failed:', e);
    // Hard ceiling hit: trigger raised manual_subscriber_limit_exceeded.
    var ceilingMsg = clientsParseCeilingError(e);
    if (ceilingMsg) {
      showModalAlert('Subscriber limit reached', ceilingMsg);
    } else if (e && (e.code === '23505' || /duplicate/i.test(e.message || ''))) {
      // 23505 is the Postgres unique-violation code. Means the email exists in
      // manual_subscribers (possibly added in another tab). Friendly message.
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
  var attestEl = document.getElementById('clients-import-attest');
  if (attestEl) attestEl.checked = false;
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
// summary and the actual insert. Async because we fetch the full email
// set for this creator (lightweight - just emails, ~30 bytes/row) so the
// "already in your list" count is accurate even at scale.
async function clientsImportComputeValidation() {
  var rows = clientsImport.rows;
  var emailCol = clientsImport.emailColumn;
  var statusCol = clientsImport.statusColumn;

  // Fetch all existing emails for this creator from subscribers_view. We
  // only pull the email_lc column - extremely cheap, even at 30k rows.
  // Used for "already in your list" dedup in the preview.
  var existingEmails = new Set();
  try {
    // Paginate in chunks of 1000 to stay under Supabase's default range cap.
    // maxIterations is a safety cap (effectively 1M subscribers) in case
    // anything goes wrong with the loop conditions - prevents a runaway.
    var pageSize = 1000;
    var offset = 0;
    var maxIterations = 1000;
    var iterations = 0;
    while (iterations < maxIterations) {
      iterations++;
      var { data, error } = await sb
        .from('subscribers_view')
        .select('email_lc')
        .eq('creator_id', currentUser.id)
        .order('email_lc', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      data.forEach(function(r) { existingEmails.add(r.email_lc); });
      if (data.length < pageSize) break;
      offset += pageSize;
    }
    if (iterations >= maxIterations) {
      console.warn('Existing emails fetch hit iteration cap (' + maxIterations + ') - dedup count may be incomplete');
    }
  } catch (e) {
    console.warn('Existing emails fetch failed (dedup count may be inaccurate):', e);
  }

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

  // Attestation required: user must confirm before any rows are written.
  var attestCheckbox = document.getElementById('clients-import-attest');
  if (!attestCheckbox || !attestCheckbox.checked) {
    showModalAlert('Confirmation required', 'Please confirm that the contacts in this list have opted in to receive emails from you before importing.');
    return;
  }

  // Soft threshold check: count current manual_subscribers and see if this
  // import will push the user across 5k for the first time. If yes and they
  // have not cleared the flag, show the stricter attestation modal first.
  try {
    var currentManualCount = await clientsCountManualSubscribers();
    var willBe = currentManualCount + stats.toAdd;
    var thresholdResult = await clientsCheckThresholdBeforeAction(willBe);
    if (thresholdResult === 'cancelled') return;
  } catch (e) {
    console.warn('Threshold pre-check failed (proceeding):', e);
  }

  clientsImportShowStep('progress');
  clientsImportUpdateActionBtn('Importing...', true);
  document.getElementById('clients-import-cancel-btn').disabled = true;

  var rows = stats.toAddRows;
  var total = rows.length;
  var imported = 0;
  var failed = 0;
  var ceilingHit = null; // string error message if the 1M trigger fired
  var progressLabel = document.getElementById('clients-import-progress-label');
  var progressFill = document.getElementById('clients-import-progress-fill');
  var progressMeta = document.getElementById('clients-import-progress-meta');

  function updateProgress() {
    var pct = total === 0 ? 100 : Math.floor((imported + failed) / total * 100);
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressMeta) progressMeta.textContent = (imported + failed).toLocaleString() + ' of ' + total.toLocaleString() + ' processed';
  }

  for (var i = 0; i < rows.length; i += CLIENTS_IMPORT_BATCH_SIZE) {
    if (ceilingHit) break; // Stop further batches once trigger has fired.
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
        var ceilingMsg = clientsParseCeilingError(error);
        if (ceilingMsg) {
          ceilingHit = ceilingMsg;
          failed += batch.length;
        } else {
          console.error('Batch insert failed:', error);
          failed += batch.length;
        }
      } else {
        imported += batch.length;
      }
    } catch (e) {
      var ceilingMsg2 = clientsParseCeilingError(e);
      if (ceilingMsg2) {
        ceilingHit = ceilingMsg2;
      } else {
        console.error('Batch threw:', e);
      }
      failed += batch.length;
    }
    updateProgress();
  }

  // If the ceiling fired, show a friendly modal explaining what happened.
  if (ceilingHit) {
    showModalAlert('Subscriber limit reached', ceilingHit);
  }

  // Log this import event to the audit table, best-effort. Skip if nothing
  // was actually imported (ceiling hit on first batch with no successes).
  if (imported > 0) {
    clientsApiLogImport(imported); // fire-and-forget
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
clientsRegisterAction('sort-change', () => { clientsCurrentPage = 0; clientsReloadPage(); });
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


// =============================================================================
// MANUAL SUBSCRIBER THRESHOLD HELPERS
// =============================================================================

// Fetch the user's manual_subscribers count (NOT the combined view count).
// This is the count that matters for the 5k threshold check.
async function clientsCountManualSubscribers() {
  try {
    var res = await sb.from('manual_subscribers')
      .select('email', { count: 'exact', head: true })
      .eq('creator_id', currentUser.id);
    return res.count || 0;
  } catch (e) {
    console.warn('clientsCountManualSubscribers failed:', e);
    return 0;
  }
}

// Load the user's threshold-cleared flag once. Cached in clientsThresholdCleared.
// Called lazily; safe to call multiple times.
async function clientsLoadThresholdCleared() {
  if (clientsThresholdCleared !== null) return clientsThresholdCleared;
  try {
    var res = await sb.from('profiles')
      .select('manual_subscribers_threshold_cleared_at')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    clientsThresholdCleared = !!(res.data && res.data.manual_subscribers_threshold_cleared_at);
  } catch (e) {
    console.warn('clientsLoadThresholdCleared failed:', e);
    // Default to "not cleared" on error so we gate (safe default).
    clientsThresholdCleared = false;
  }
  return clientsThresholdCleared;
}

// Detects the specific DB trigger error for hitting the 1M ceiling. Returns the
// human-readable portion of the message if matched, else null.
function clientsParseCeilingError(err) {
  if (!err) return null;
  var msg = err.message || (err.details ? err.details : '') || '';
  // Trigger raises with prefix 'manual_subscriber_limit_exceeded:' before the message.
  var match = /manual_subscriber_limit_exceeded:\s*(.+)/.exec(msg);
  if (match) return match[1].trim();
  return null;
}

// POST to /api/log-manual-subscribers-import. Best-effort; warns on failure
// but does not block the user's flow.
async function clientsApiLogImport(rowsImported) {
  try {
    var session = (await sb.auth.getSession()).data.session;
    if (!session) return;
    var res = await fetch(MANUAL_SUBS_API_LOG_IMPORT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token
      },
      body: JSON.stringify({
        rows_imported: rowsImported,
        attestation_text: MANUAL_SUBS_ATTESTATION_IMPORT,
        attestation_version: MANUAL_SUBS_ATTESTATION_VERSION
      })
    });
    if (!res.ok) {
      console.warn('clientsApiLogImport failed:', res.status, await res.text().catch(function() { return ''; }));
    }
  } catch (e) {
    console.warn('clientsApiLogImport error:', e);
  }
}

// POST to /api/cross-manual-subscribers-threshold after the user has attested.
// Returns true on success, false on failure (so caller can decide whether to
// proceed or roll back).
async function clientsApiCrossThreshold(subscriberCount) {
  try {
    var session = (await sb.auth.getSession()).data.session;
    if (!session) return false;
    var res = await fetch(MANUAL_SUBS_API_CROSS_THRESHOLD, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token
      },
      body: JSON.stringify({
        threshold_count: MANUAL_SUBS_THRESHOLD,
        subscriber_count_at_crossing: subscriberCount,
        attestation_text: MANUAL_SUBS_ATTESTATION_THRESHOLD,
        attestation_version: MANUAL_SUBS_ATTESTATION_VERSION
      })
    });
    if (!res.ok) {
      console.warn('clientsApiCrossThreshold failed:', res.status);
      return false;
    }
    // Cache locally so the modal does not re-show in this session.
    clientsThresholdCleared = true;
    return true;
  } catch (e) {
    console.warn('clientsApiCrossThreshold error:', e);
    return false;
  }
}

// Show the soft-threshold attestation modal. Returns a Promise that resolves
// to true if the user attested and the API call succeeded, false if they
// cancelled or the API call failed.
//
// Built on top of showModalConfirm, with the attestation text in a styled
// callout box and the confirm button disabled until the checkbox is ticked.
function clientsShowThresholdAttestation(subscriberCountWillBe) {
  return new Promise(function(resolve) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';

    var modal = document.createElement('div');
    modal.style.cssText = 'background:#15101f;color:#f2effb;border-radius:14px;max-width:520px;width:100%;padding:28px;border:1px solid rgba(255,255,255,0.08);box-shadow:0 30px 80px rgba(0,0,0,0.5);';
    modal.innerHTML = '<div style="font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#facc15;margin-bottom:10px;">One quick confirmation</div>' +
      '<h3 style="font-family:\'Plus Jakarta Sans\',sans-serif;font-size:22px;font-weight:800;margin:0 0 12px;line-height:1.25;">You are crossing 5,000 manually added subscribers</h3>' +
      '<p style="font-size:14px;line-height:1.6;color:rgba(255,255,255,0.75);margin:0 0 16px;">To prevent abuse and protect compliance with anti-spam regulations like the U.S. CAN-SPAM Act, we ask power users to confirm a few things before continuing. Ryxa will be notified, and you will only see this once.</p>' +
      '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px;margin-bottom:18px;">' +
        '<div style="font-size:13px;line-height:1.65;color:rgba(255,255,255,0.85);font-style:italic;">"' +
          MANUAL_SUBS_ATTESTATION_THRESHOLD.replace(/"/g, '&quot;') +
        '"</div>' +
      '</div>' +
      '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin-bottom:22px;">' +
        '<input type="checkbox" id="ms-threshold-check" style="margin-top:2px;flex-shrink:0;width:18px;height:18px;cursor:pointer;accent-color:#facc15;">' +
        '<span style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.85);">I have read and agree to the statement above.</span>' +
      '</label>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
        '<button id="ms-threshold-cancel" style="background:transparent;border:1px solid rgba(255,255,255,0.18);color:rgba(255,255,255,0.85);padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500;font-family:inherit;cursor:pointer;">Cancel</button>' +
        '<button id="ms-threshold-confirm" disabled style="background:#facc15;border:none;color:#15101f;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;font-family:inherit;cursor:not-allowed;opacity:0.5;">Continue</button>' +
      '</div>';

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    var checkbox = modal.querySelector('#ms-threshold-check');
    var confirmBtn = modal.querySelector('#ms-threshold-confirm');
    var cancelBtn = modal.querySelector('#ms-threshold-cancel');

    checkbox.addEventListener('change', function() {
      confirmBtn.disabled = !checkbox.checked;
      confirmBtn.style.cursor = checkbox.checked ? 'pointer' : 'not-allowed';
      confirmBtn.style.opacity = checkbox.checked ? '1' : '0.5';
    });

    function close(result) {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      resolve(result);
    }

    cancelBtn.addEventListener('click', function() { close(false); });
    confirmBtn.addEventListener('click', async function() {
      if (!checkbox.checked) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Saving...';
      var ok = await clientsApiCrossThreshold(subscriberCountWillBe);
      if (!ok) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Continue';
        showModalAlert('Could not save', 'We could not record your attestation right now. Please try again in a moment.');
        return;
      }
      close(true);
    });
  });
}

// Wrapper for the threshold check used by both single-add and CSV import.
// Given the count that the action would result in, returns:
//   - 'cleared': user has already attested, proceed
//   - 'attested': user just attested via the modal, proceed
//   - 'cancelled': user cancelled the modal, abort the action
//   - 'not-needed': would not cross 5k, proceed without prompting
async function clientsCheckThresholdBeforeAction(countWillBe) {
  if (countWillBe < MANUAL_SUBS_THRESHOLD) return 'not-needed';
  var cleared = await clientsLoadThresholdCleared();
  if (cleared) return 'cleared';
  var attested = await clientsShowThresholdAttestation(countWillBe);
  return attested ? 'attested' : 'cancelled';
}
