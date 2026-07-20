// =============================================================================
// /js/deals.js - Brand Deal CRM (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Brand Deal CRM tool (Max tier). Extracted from
// dashboard.html for stricter CSP.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/deals.js
//   • Phase 2: replaced inline onclick/oninput/etc with data-deal-action
//     attributes + delegated event handlers (CSP-strict)
//   • Phase 3: replaced inline class="bio-s-6eae3a" attributes with hash-named CSS
//     classes in dashboard.html's <style> block (CSP-strict)
//
// External dependencies remain on window (sb, Auth, currentUser, isMax,
// escapeHtml, showModalAlert, showModalConfirm, formatMoney, etc).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE (parallel of bio/mk/course/coach/prod)
// =============================================================================

const dealActions = {};

function dealRegisterAction(action, handler) {
  dealActions[action] = handler;
}

function dealFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['dealAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.dealAction) {
        const wantEvent = el.dataset.dealEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.dealAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function dealDispatchEvent(event) {
  const found = dealFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = dealActions[found.action];
  if (!handler) {
    console.warn('[deal] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

// Note: drag events (dragstart, dragover, dragleave, drop, dragend) intentionally
// NOT delegated here. The pipeline kanban uses programmatic drag handlers wired
// via addEventListener in renderPipeline() (see Phase 2 conversion). Inline
// drag handlers in pipeline cards have been replaced with addEventListener
// during element creation, since drag events need the element reference,
// dataTransfer, and event.preventDefault() in ways that don't pass cleanly
// through the action dispatcher pattern.
['click', 'input', 'change', 'focus', 'blur', 'keydown', 'mouseover', 'mouseout'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, dealDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 13548-16249 (Brand Deal CRM) ----------
// =====================================================
// BRAND DEAL CRM
// =====================================================
function initDealsCrm() {
  const isMaxUser = isMax();
  const upsell = document.getElementById('deals-max-upsell');
  const main = document.getElementById('deals-main');
  if (!isMaxUser) {
    if (upsell) upsell.style.display = 'block';
    if (main) main.style.display = 'none';
    return;
  }
  if (upsell) upsell.style.display = 'none';
  if (main) main.style.display = 'block';
  // Always show list when entering the tool. Reset pipelineViewActive
  // (which persists across tool navigations since the JS module isn't
  // reloaded) and also reset the pipeline toggle button styling so it
  // matches the list view state.
  pipelineViewActive = false;
  const btn = document.getElementById('deals-pipeline-toggle');
  if (btn) {
    btn.textContent = 'View Pipeline';
    btn.classList.remove('active');
    btn.style.background = 'var(--accent)';
    btn.style.border = 'none';
    btn.style.color = '#fff';
    btn.style.boxShadow = '0 0 20px var(--accent-glow)';
  }
  showDealsList();
  if (!dealsInited) {
    dealsInited = true;
    loadDealsList();
  } else {
    // Subsequent opens render from memory - no refetch, no load bar. Matches
    // Courses / Link in Bio / Media Kit. In-tool saves keep the cache fresh
    // (cache-in-place update on save), so the list stays correct.
    renderDealsList();
    loadDealsAnalytics().catch(function(e) { console.error('loadDealsAnalytics', e); });
  }
}

// Switch to list view
function showDealsList() {
  // Leaving the detail view cancels any in-flight deal load.
  window.RyxaLoadGen.bump();
  document.getElementById('deals-detail-view').style.display = 'none';
  document.getElementById('deals-list-view').style.display = 'block';

  // Restore the correct sub-view (list vs pipeline)
  const content = document.getElementById('deals-content');
  const pipeline = document.getElementById('deals-pipeline-view');
  const analytics = document.getElementById('deals-analytics');
  if (pipelineViewActive) {
    if (content) content.style.display = 'none';
    if (pipeline) pipeline.style.display = 'block';
    if (analytics) analytics.style.display = 'none';
    renderPipeline();
  } else {
    if (content) content.style.display = 'block';
    if (pipeline) pipeline.style.display = 'none';
    if (analytics && dealsList.length > 0) analytics.style.display = 'block';
  }

  currentDealId = null;
  currentDealDeliverables = [];
  dealDeliverablesLoaded = true; // reset state: empty list is real until a load says otherwise
}


// =====================================================
// 1:1 COACHING
// =====================================================



// =====================================================
// BRAND DEAL CRM - State & Constants
// =====================================================
const DEAL_STATUS_LABELS = {
  draft: 'Draft',
  pending_contract: 'Pending Contract',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled'
};
const DEAL_PAYMENT_LABELS = {
  waiting: 'Waiting for Payment',
  paid: 'Paid'
};

let dealsList = [];              // Cache of all user deals
let currentDealId = null;        // Deal being edited in modal (null = new)
let currentDealDeliverables = []; // Working list of deliverables in modal
// True only when the deliverables list reflects reality: a successful load
// for existing deals, or the empty list of a brand new deal. Saving the
// deliverables section is blocked while false, so a failed load can never
// masquerade as "user deleted everything".
let dealDeliverablesLoaded = false;

// =====================================================
// BRAND DEAL CRM - List & Load
// =====================================================
// ---- Standard load treatment (shared pattern with the other five tools) ----

// Lock/unlock the deals list actions as one unit while the list is loading
// or in a failed state: New Deal and the pipeline toggle.
function setDealsListLocked(locked) {
  ['deals-new-btn', 'deals-pipeline-toggle'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.disabled = locked;
    el.style.opacity = locked ? '0.5' : '';
    el.style.cursor = locked ? 'not-allowed' : '';
  });
}

// Blocking failure state for the deals list: persistent red panel with Retry
// in the table area; a failed load must never masquerade as "no deals".
function dealsShowListFailed() {
  var tableEl = document.getElementById('deals-table');
  var emptyEl = document.getElementById('deals-empty');
  var chipsEl = document.getElementById('deals-filter-chips');
  if (emptyEl) emptyEl.style.display = 'none';
  if (chipsEl) chipsEl.style.display = 'none';
  if (!tableEl) return;
  tableEl.style.display = 'block';
  tableEl.innerHTML = '';
  var panel = document.createElement('div');
  panel.setAttribute('role', 'alert');
  panel.style.padding = '20px';
  panel.style.borderRadius = '12px';
  panel.style.border = '1px solid rgba(239,68,68,0.35)';
  panel.style.background = 'rgba(239,68,68,0.08)';
  var heading = document.createElement('div');
  heading.style.color = '#f87171';
  heading.style.fontWeight = '600';
  heading.style.fontSize = '15px';
  heading.style.marginBottom = '6px';
  heading.textContent = 'Could not load your deals';
  var body = document.createElement('div');
  body.style.color = 'rgba(255,255,255,0.7)';
  body.style.fontSize = '14px';
  body.style.lineHeight = '1.5';
  body.style.marginBottom = '14px';
  body.textContent = 'Check your internet connection and press Retry. If the issue continues, contact us at hello@ryxa.io.';
  var retry = document.createElement('button');
  retry.type = 'button';
  retry.setAttribute('data-deal-action', 'retry-list');
  retry.textContent = 'Retry';
  retry.style.padding = '9px 18px';
  retry.style.borderRadius = '8px';
  retry.style.border = '1px solid rgba(255,255,255,0.25)';
  retry.style.background = 'rgba(255,255,255,0.06)';
  retry.style.color = '#fff';
  retry.style.fontWeight = '600';
  retry.style.cursor = 'pointer';
  panel.appendChild(heading);
  panel.appendChild(body);
  panel.appendChild(retry);
  tableEl.appendChild(panel);
}

dealRegisterAction('retry-list', function() { loadDealsList(); });
dealRegisterAction('retry-detail-load', function() { if (currentDealId) showDealDetail(currentDealId); });

// Lock/unlock the entire deal detail form while its fresh row is loading or
// failed: every child of the detail view is dimmed with pointer-events off,
// EXCEPT the back link (always an escape hatch) and the failure panel (its
// Retry must stay clickable). Key action buttons are also disabled directly.
function setDealDetailLocked(locked) {
  var view = document.getElementById('deals-detail-view');
  if (view) {
    Array.prototype.forEach.call(view.children, function(child, i) {
      if (i === 0) return; // back-link row stays live
      if (child.hasAttribute('data-deal-load-panel')) return;
      child.style.pointerEvents = locked ? 'none' : '';
      child.style.opacity = locked ? '0.5' : '';
    });
  }
  ['deal-save-btn', 'deal-delete-btn', 'deal-share-btn'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.disabled = locked;
  });
}

function dealsClearDetailPanel() {
  var view = document.getElementById('deals-detail-view');
  if (!view) return;
  var panel = view.querySelector('[data-deal-load-panel]');
  if (panel) panel.remove();
}

// Blocking failure state for the deal detail: red panel with Retry inserted
// at the TOP of the detail view (right under the back link, where the user
// lands), not in the bottom message slot. Form stays locked; Back stays live.
function dealsShowDetailFailed() {
  var view = document.getElementById('deals-detail-view');
  if (!view) return;
  dealsClearDetailPanel();
  var panel = document.createElement('div');
  panel.setAttribute('data-deal-load-panel', '1');
  panel.setAttribute('role', 'alert');
  panel.style.padding = '20px';
  panel.style.borderRadius = '12px';
  panel.style.border = '1px solid rgba(239,68,68,0.35)';
  panel.style.background = 'rgba(239,68,68,0.08)';
  panel.style.margin = '0 0 16px 0';
  var heading = document.createElement('div');
  heading.style.color = '#f87171';
  heading.style.fontWeight = '600';
  heading.style.fontSize = '15px';
  heading.style.marginBottom = '6px';
  heading.textContent = 'Could not load this deal';
  var body = document.createElement('div');
  body.style.color = 'rgba(255,255,255,0.7)';
  body.style.fontSize = '14px';
  body.style.lineHeight = '1.5';
  body.style.marginBottom = '14px';
  body.textContent = 'Check your internet connection and press Retry. If the issue continues, contact us at hello@ryxa.io.';
  var retry = document.createElement('button');
  retry.type = 'button';
  retry.setAttribute('data-deal-action', 'retry-detail-load');
  retry.textContent = 'Retry';
  retry.style.padding = '9px 18px';
  retry.style.borderRadius = '8px';
  retry.style.border = '1px solid rgba(255,255,255,0.25)';
  retry.style.background = 'rgba(255,255,255,0.06)';
  retry.style.color = '#fff';
  retry.style.fontWeight = '600';
  retry.style.cursor = 'pointer';
  panel.appendChild(heading);
  panel.appendChild(body);
  panel.appendChild(retry);
  var first = view.firstElementChild;
  if (first && first.nextSibling) view.insertBefore(panel, first.nextSibling);
  else view.appendChild(panel);
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadDealsList() {
  if (!currentUser || !isMax()) return;
  const _gen = window.RyxaLoadGen.bump();
  const tableEl = document.getElementById('deals-table');
  const emptyEl = document.getElementById('deals-empty');
  const chipsEl = document.getElementById('deals-filter-chips');
  setDealsListLocked(true);
  if (emptyEl) emptyEl.style.display = 'none';
  if (chipsEl) chipsEl.style.display = 'none';
  if (tableEl) { tableEl.style.display = 'block'; tableEl.innerHTML = ''; }
  window.RyxaLoadBar.start(tableEl);

  const MAX_LOAD_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
    try {
      const res = await sb
        .from('brand_deals')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });
      if (res.error) throw res.error;
      if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('deals-table')); return; }
      dealsList = res.data || [];
      window.RyxaLoadBar.finish(tableEl);
      setDealsListLocked(false);
      renderDealsList();
      // Analytics cards are decoration; never let them fail or delay the list.
      loadDealsAnalytics().catch(function(e) { console.error('loadDealsAnalytics', e); });
      return;
    } catch (err) {
      if (attempt < MAX_LOAD_ATTEMPTS) {
        if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('deals-table')); return; }
        window.RyxaLoadBar.retrying(tableEl, 'Having trouble loading your deals. Retrying...');
        await new Promise(function(resolve) { setTimeout(resolve, 400 * attempt); });
        if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('deals-table')); return; }
        continue;
      }
      if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('deals-table')); return; }
      console.error('Failed to load deals:', err);
      window.RyxaLoadBar.fail(tableEl);
      dealsShowListFailed();
      showDashToast('error', 'Failed to load. Please retry, or contact hello@ryxa.io if it continues.');
      return;
    }
  }
}

function renderDealsList() {
  const emptyEl = document.getElementById('deals-empty');
  const tableEl = document.getElementById('deals-table');
  if (!emptyEl || !tableEl) return;

  const chipsEl = document.getElementById('deals-filter-chips');

  // No deals at all: the "create your first deal" empty state, no chips.
  if (dealsList.length === 0) {
    emptyEl.style.display = 'block';
    tableEl.style.display = 'none';
    if (chipsEl) chipsEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  if (chipsEl) chipsEl.style.display = 'flex';
  tableEl.style.display = 'block';

  // Apply the active list filter. "In Progress" groups the open stages
  // (draft, pending contract, active); Completed and Cancelled are their own
  // chips. New deals start as drafts, so In Progress must include draft, or a
  // freshly created deal would be hidden under the default view.
  const filtered = dealsList.filter(d => {
    if (dealsListFilter === 'all') return true;
    if (dealsListFilter === 'in_progress') return d.status === 'draft' || d.status === 'pending_contract' || d.status === 'active';
    return d.status === dealsListFilter;
  });

  if (filtered.length === 0) {
    const fLabels = { in_progress: 'in progress', completed: 'completed', cancelled: 'cancelled' };
    const fMsg = (dealsListFilter === 'all') ? 'No deals' : ('No ' + (fLabels[dealsListFilter] || '') + ' deals');
    tableEl.innerHTML = '<div class="deals-filter-empty">' + fMsg + '</div>';
    if (pipelineViewActive) renderPipeline();
    return;
  }

  const header = `
    <div class="deal-row-header">
      <div>Deal</div>
      <div>Brand</div>
      <div>Amount</div>
      <div>Status</div>
      <div>Payment</div>
    </div>
  `;

  const rows = filtered.map(d => {
    const amount = formatUSD(d.deal_amount_cents);
    const statusLabel = DEAL_STATUS_LABELS[d.status] || d.status;
    const paymentLabel = DEAL_PAYMENT_LABELS[d.payment_status] || d.payment_status;
    const paymentBadgeStyle = d.payment_status === 'paid'
      ? 'background:rgba(74,222,128,0.12);color:#4ade80;border:1px solid rgba(74,222,128,0.3);'
      : 'background:rgba(251,191,36,0.1);color:#fbbf24;border:1px solid rgba(251,191,36,0.3);';
    return `
      <div class="deal-row" data-deal-action="show-detail" data-deal-id="${d.id}">
        <div>
          <div class="deal-s-a3165e">${escapeHtml(d.deal_title)}</div>
          ${d.campaign_end_date ? `<div class="bio-s-5f3468">Ends ${formatDateShort(d.campaign_end_date)}</div>` : ''}
        </div>
        <div class="deal-s-8cb67d">
          <span class="deal-row-mobile-label bio-s-c8be1c" >Brand</span>
          ${escapeHtml(d.brand_name)}
        </div>
        <div class="coach-s-1bd029">
          <span class="deal-row-mobile-label bio-s-c8be1c" >Amount</span>
          ${amount}
        </div>
        <div>
          <span class="deal-row-mobile-label bio-s-c8be1c" >Status</span>
          <span class="deal-status-badge deal-status-${d.status}">${statusLabel}</span>
        </div>
        <div>
          <span class="deal-row-mobile-label bio-s-c8be1c" >Payment</span>
          <span class="deal-status-badge" style="${paymentBadgeStyle}">${paymentLabel}</span>
        </div>
      </div>
    `;
  }).join('');

  tableEl.innerHTML = `<div class="deal-s-b98ccd">${header}${rows}</div>`;

  // Keep pipeline in sync if it's active
  if (pipelineViewActive) renderPipeline();
}

function formatUSD(cents) {
  // Now currency-aware - uses the user's display currency
  return formatMoney(cents);
}

function formatDateShort(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// =====================================================
// BRAND DEAL CRM - Pipeline (Kanban) View
// =====================================================
let dealsInited = false;
let pipelineViewActive = false;
let dealsListFilter = 'in_progress';  // list filter chip: in_progress | all | completed | cancelled

// Only OPEN stages live on the board. Completed and Cancelled are terminal:
// they leave the board (via the card's Complete/Cancel actions) and live in
// the list view below, which remains the full record of every deal.
const PIPELINE_COLUMNS = [
  { key: 'draft', label: 'Draft', color: 'rgba(122,120,143,0.3)' },
  { key: 'pending_contract', label: 'Pending Contract', color: 'rgba(251,191,36,0.3)' },
  { key: 'active', label: 'Active', color: 'rgba(124,58,237,0.35)' }
];

function togglePipelineView() {
  pipelineViewActive = !pipelineViewActive;
  const btn = document.getElementById('deals-pipeline-toggle');
  const content = document.getElementById('deals-content');
  const pipeline = document.getElementById('deals-pipeline-view');
  const analytics = document.getElementById('deals-analytics');

  if (pipelineViewActive) {
    if (content) content.style.display = 'none';
    if (analytics) analytics.style.display = 'none';
    if (pipeline) pipeline.style.display = 'block';
    if (btn) {
      btn.textContent = 'View List';
      btn.classList.add('active');
      btn.style.background = 'transparent';
      btn.style.border = '1px solid var(--accent)';
      btn.style.color = 'var(--accent)';
      btn.style.boxShadow = 'none';
    }
    renderPipeline();
  } else {
    if (content) content.style.display = 'block';
    if (pipeline) pipeline.style.display = 'none';
    // Re-show analytics if there are deals
    if (analytics && dealsList.length > 0) analytics.style.display = 'block';
    if (btn) {
      btn.textContent = 'View Pipeline';
      btn.classList.remove('active');
      btn.style.background = 'var(--accent)';
      btn.style.border = 'none';
      btn.style.color = '#fff';
      btn.style.boxShadow = '0 0 20px var(--accent-glow)';
    }
  }
}

function renderPipeline() {
  const board = document.getElementById('pipeline-board');
  if (!board) return;

  board.innerHTML = PIPELINE_COLUMNS.map(col => {
    const deals = dealsList.filter(d => d.status === col.key);
    const totalCents = deals.reduce((sum, d) => sum + (d.deal_amount_cents || 0), 0);
    const cards = deals.length === 0
      ? `<div class="pipeline-col-empty">No deals</div>`
      : deals.map(d => buildPipelineCard(d)).join('');

    return `<div class="pipeline-col" data-status="${col.key}">
      <div class="pipeline-col-header" style="border-top:3px solid ${col.color};border-radius:14px 14px 0 0;">
        <div>
          <div class="pipeline-col-title">${col.label}</div>
          ${totalCents > 0 ? `<div class="prod-s-79fe1a">${formatUSD(totalCents)}</div>` : ''}
        </div>
        <span class="pipeline-col-count">${deals.length}</span>
      </div>
      <div class="pipeline-col-body" data-deal-drop-col="${col.key}">
        ${cards}
      </div>
    </div>`;
  }).join('');
}

function buildPipelineCard(d) {
  const amount = formatUSD(d.deal_amount_cents);
  const isPaid = d.payment_status === 'paid';
  const payStyle = isPaid
    ? 'background:rgba(74,222,128,0.12);color:#4ade80;border:1px solid rgba(74,222,128,0.3);'
    : 'background:rgba(251,191,36,0.1);color:#fbbf24;border:1px solid rgba(251,191,36,0.3);';
  const payLabel = isPaid ? 'Paid' : 'Unpaid';
  const endDate = d.campaign_end_date ? `<div class="deal-s-80d89c">Ends ${formatDateShort(d.campaign_end_date)}</div>` : '';

  // Determine prev/next statuses for mobile move buttons
  const statusKeys = PIPELINE_COLUMNS.map(c => c.key);
  const idx = statusKeys.indexOf(d.status);
  const prevStatus = idx > 0 ? statusKeys[idx - 1] : null;
  const nextStatus = idx < statusKeys.length - 1 ? statusKeys[idx + 1] : null;
  const prevLabel = prevStatus ? DEAL_STATUS_LABELS[prevStatus] : '';
  const nextLabel = nextStatus ? DEAL_STATUS_LABELS[nextStatus] : '';

  return `<div class="pipeline-card" draggable="true"
    data-deal-id="${d.id}"
    data-deal-drag-card
    data-deal-action="show-detail">
    <div class="pipeline-card-title">${escapeHtml(d.deal_title || 'Untitled')}</div>
    <div class="pipeline-card-brand">${escapeHtml(d.brand_name || '')}</div>
    <div class="pipeline-card-footer">
      <div class="pipeline-card-amount">${amount}</div>
      <span class="pipeline-card-payment" style="${payStyle}">${payLabel}</span>
    </div>
    ${endDate}
    <div class="pipeline-card-moves">
      <button class="pipeline-move-btn" data-deal-action="move-status" data-deal-id="${d.id}" data-deal-status="${prevStatus}" ${!prevStatus ? 'disabled' : ''}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        ${prevLabel ? escapeHtml(prevLabel) : '—'}
      </button>
      <button class="pipeline-move-btn" data-deal-action="move-status" data-deal-id="${d.id}" data-deal-status="${nextStatus}" ${!nextStatus ? 'disabled' : ''}>
        ${nextLabel ? escapeHtml(nextLabel) : '—'}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <div class="pipeline-card-terminal">
      <button class="pipeline-terminal-btn complete" data-deal-action="terminal-status" data-deal-id="${d.id}" data-deal-status="completed">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        Complete
      </button>
      <button class="pipeline-terminal-btn cancel" data-deal-action="terminal-status" data-deal-id="${d.id}" data-deal-status="cancelled">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Cancel
      </button>
    </div>
  </div>`;
}

// Move a deal to a new status via the mobile move buttons
async function moveDealStatus(dealId, newStatus) {
  if (!newStatus || newStatus === 'null') return;
  const deal = dealsList.find(d => d.id === dealId);
  if (!deal || deal.status === newStatus) return;

  const oldStatus = deal.status;
  deal.status = newStatus;
  renderPipeline();
  renderDealsList();

  const { error } = await sb.from('brand_deals')
    .update({ status: newStatus })
    .eq('id', dealId)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Failed to move deal:', error);
    deal.status = oldStatus;
    renderPipeline();
    renderDealsList();
    return false;
  }
  return true;
}

// Send a deal to a terminal state (Completed / Cancelled) from the board.
// Terminal deals leave the board and live in the list view below. We confirm
// first (the action is consequential and locks the deal) and name where it goes.
function promptTerminalStatus(dealId, status) {
  const deal = dealsList.find(d => d.id === dealId);
  if (!deal) return;
  const isComplete = status === 'completed';
  showModalConfirm(
    isComplete ? 'Mark deal complete?' : 'Cancel this deal?',
    isComplete
      ? 'It moves to your completed deals. You can still find it anytime in the list below.'
      : 'It moves to your cancelled deals. You can still find it anytime in the list below.',
    async function () {
      const ok = await moveDealStatus(dealId, status);
      if (ok) showDashToast('success', isComplete ? 'Deal marked complete.' : 'Deal cancelled.');
    },
    isComplete ? 'Mark Complete' : 'Cancel Deal',
    'Back'
  );
}

// --- Drag & Drop ---
let pipelineDragId = null;
let pipelineAutoScrollRAF = null;

function onPipelineDragStart(e, dealId) {
  pipelineDragId = dealId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dealId);
  requestAnimationFrame(() => {
    const card = document.querySelector(`.pipeline-card[data-deal-id="${dealId}"]`);
    if (card) card.classList.add('dragging');
  });
  // Start auto-scroll edge detection
  startPipelineAutoScroll();
}

function onPipelineDragEnd(e) {
  document.querySelectorAll('.pipeline-card.dragging').forEach(c => c.classList.remove('dragging'));
  document.querySelectorAll('.pipeline-col-body.drag-over').forEach(c => c.classList.remove('drag-over'));
  pipelineDragId = null;
  stopPipelineAutoScroll();
}

// Desktop: auto-scroll the pipeline-wrap when dragging near its left/right edges
let _pipelineDragClientX = 0;
function _onPipelineDragOverGlobal(e) {
  _pipelineDragClientX = e.clientX;
}

function startPipelineAutoScroll() {
  document.addEventListener('dragover', _onPipelineDragOverGlobal);
  function tick() {
    const wrap = document.querySelector('.pipeline-wrap');
    if (!wrap || !pipelineDragId) { stopPipelineAutoScroll(); return; }
    const rect = wrap.getBoundingClientRect();
    const edgeZone = 60; // px from edge to start scrolling
    const speed = 12;    // px per frame
    const x = _pipelineDragClientX;
    if (x > 0 && x < rect.left + edgeZone && wrap.scrollLeft > 0) {
      wrap.scrollLeft -= speed;
    } else if (x > rect.right - edgeZone && x < rect.right + 40) {
      wrap.scrollLeft += speed;
    }
    pipelineAutoScrollRAF = requestAnimationFrame(tick);
  }
  pipelineAutoScrollRAF = requestAnimationFrame(tick);
}

function stopPipelineAutoScroll() {
  if (pipelineAutoScrollRAF) cancelAnimationFrame(pipelineAutoScrollRAF);
  pipelineAutoScrollRAF = null;
  document.removeEventListener('dragover', _onPipelineDragOverGlobal);
}

// Drag handlers - called from document-level delegated listeners below.
// We pass the column element explicitly because event delegation means
// e.currentTarget is `document` (where the listener was attached), not the
// column. The old code that used e.currentTarget.classList.add('drag-over')
// threw "Cannot read properties of undefined" because document.classList is
// undefined. The delegated dispatcher does the closest() lookup once and
// passes the result here.
function onPipelineDragOver(e, col) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  if (col) col.classList.add('drag-over');
}

function onPipelineDragLeave(e, col) {
  // dragleave fires when crossing between child elements inside the column,
  // not only when leaving the column entirely. Without this guard the
  // .drag-over highlight flickers on/off as the user drags over cards.
  // relatedTarget is the element the mouse is moving INTO - if it's still
  // inside the same column, we're not actually leaving, so do nothing.
  if (col && e.relatedTarget && col.contains(e.relatedTarget)) return;
  if (col) col.classList.remove('drag-over');
}

async function onPipelineDrop(e, newStatus, col) {
  e.preventDefault();
  if (col) col.classList.remove('drag-over');

  const dealId = pipelineDragId || e.dataTransfer.getData('text/plain');
  if (!dealId) return;

  // Find the deal in our local list
  const deal = dealsList.find(d => d.id === dealId);
  if (!deal || deal.status === newStatus) {
    // No change - just clean up
    renderPipeline();
    return;
  }

  const oldStatus = deal.status;
  // Optimistically update local state + re-render
  deal.status = newStatus;
  renderPipeline();
  // Also update the list view table behind the scenes
  renderDealsList();

  // Persist to Supabase
  const { error } = await sb.from('brand_deals')
    .update({ status: newStatus })
    .eq('id', dealId)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Failed to update deal status:', error);
    // Revert on failure
    deal.status = oldStatus;
    renderPipeline();
    renderDealsList();
    // Brief visual feedback
    const card = document.querySelector(`.pipeline-card[data-deal-id="${dealId}"]`);
    if (card) {
      card.style.borderColor = 'rgba(239,68,68,0.6)';
      setTimeout(() => { card.style.borderColor = ''; }, 1500);
    }
  }
}

// Touch support for mobile drag-and-drop (locks scroll while dragging)
(function initPipelineTouchDrag() {
  let dragCard = null;
  let dragClone = null;
  let startX, startY;
  let currentDropTarget = null;
  let scrollLocked = false;

  function lockPipelineScroll() {
    if (scrollLocked) return;
    scrollLocked = true;
    const wrap = document.querySelector('.pipeline-wrap');
    if (wrap) wrap.style.overflowX = 'hidden';
    // Also prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  function unlockPipelineScroll() {
    if (!scrollLocked) return;
    scrollLocked = false;
    const wrap = document.querySelector('.pipeline-wrap');
    if (wrap) wrap.style.overflowX = 'auto';
    document.body.style.overflow = '';
  }

  document.addEventListener('touchstart', function(e) {
    // On mobile (<=640px), we use move buttons instead of touch drag
    if (window.innerWidth <= 640) return;
    const card = e.target.closest('.pipeline-card');
    if (!card) return;
    dragCard = card;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!dragCard) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - startX);

    // Only start drag if moved enough horizontally
    if (!dragClone && dx < 10) return;

    e.preventDefault();

    if (!dragClone) {
      // Lock scrolling the moment drag begins
      lockPipelineScroll();
      // Create visual clone
      dragClone = dragCard.cloneNode(true);
      dragClone.style.position = 'fixed';
      dragClone.style.width = dragCard.offsetWidth + 'px';
      dragClone.style.zIndex = '99999';
      dragClone.style.pointerEvents = 'none';
      dragClone.style.opacity = '0.85';
      dragClone.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
      dragClone.style.transform = 'rotate(2deg)';
      dragClone.style.borderRadius = '10px';
      document.body.appendChild(dragClone);
      dragCard.classList.add('dragging');
      pipelineDragId = dragCard.dataset.dealId;
    }

    dragClone.style.left = (touch.clientX - dragClone.offsetWidth / 2) + 'px';
    dragClone.style.top = (touch.clientY - 20) + 'px';

    // Find which column body we're over
    document.querySelectorAll('.pipeline-col-body.drag-over').forEach(c => c.classList.remove('drag-over'));
    // Temporarily hide the clone so elementFromPoint finds the column underneath
    dragClone.style.display = 'none';
    const elUnder = document.elementFromPoint(touch.clientX, touch.clientY);
    dragClone.style.display = '';
    const colBody = elUnder?.closest('.pipeline-col-body');
    if (colBody) {
      colBody.classList.add('drag-over');
      currentDropTarget = colBody;
    } else {
      currentDropTarget = null;
    }
  }, { passive: false });

  document.addEventListener('touchend', function(e) {
    if (!dragCard) return;

    if (dragClone) {
      // Perform the drop
      if (currentDropTarget) {
        const col = currentDropTarget.closest('.pipeline-col');
        const newStatus = col?.dataset.status;
        if (newStatus) {
          onPipelineDrop({ preventDefault(){}, currentTarget: currentDropTarget, dataTransfer: { getData: () => pipelineDragId } }, newStatus, col);
        }
        currentDropTarget.classList.remove('drag-over');
      }
      dragClone.remove();
      dragClone = null;
    }

    dragCard.classList.remove('dragging');
    document.querySelectorAll('.pipeline-col-body.drag-over').forEach(c => c.classList.remove('drag-over'));
    dragCard = null;
    currentDropTarget = null;
    pipelineDragId = null;
    // Unlock scrolling
    unlockPipelineScroll();
  }, { passive: true });
})();

// =====================================================
// BRAND DEAL CRM - Analytics
// =====================================================
async function loadDealsAnalytics() {
  if (!currentUser || !isMax()) return;

  const analyticsEl = document.getElementById('deals-analytics');
  if (!analyticsEl) return;

  // Always visible - zero-state shows $0 / empty widgets so user sees the layout even before data
  analyticsEl.style.display = 'block';

  // Fetch brand deal revenue events only (exclude course/coaching)
  const { data: revenue, error } = await sb
    .from('revenue_events')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('source', 'brand_deal')
    .order('received_at', { ascending: false });

  if (error) {
    console.error('Failed to load revenue events:', error);
    return;
  }

  const revenueEvents = revenue || [];
  renderDealsAnalytics(revenueEvents);
}

function renderDealsAnalytics(revenueEvents) {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const ytdStart = new Date(now.getFullYear(), 0, 1);

  // ======= Top stats =======
  let monthTotal = 0, ytdTotal = 0, lifetimeTotal = 0, monthCount = 0, ytdCount = 0;
  revenueEvents.forEach(ev => {
    const dt = new Date(ev.received_at);
    lifetimeTotal += ev.amount_cents;
    if (dt >= ytdStart) { ytdTotal += ev.amount_cents; ytdCount++; }
    if (dt >= thisMonthStart) { monthTotal += ev.amount_cents; monthCount++; }
  });

  // Pending payment = sum of deals with payment_status='waiting' and status active/pending_contract (not draft, cancelled, or already paid completed)
  const pendingDeals = dealsList.filter(d =>
    d.payment_status === 'waiting'
    && (d.status === 'active' || d.status === 'pending_contract' || d.status === 'completed')
  );
  const pendingTotal = pendingDeals.reduce((sum, d) => sum + (d.deal_amount_cents || 0), 0);

  // Active deals count (status = active)
  const activeCount = dealsList.filter(d => d.status === 'active').length;

  document.getElementById('deals-stat-month').textContent = formatUSD(monthTotal);
  document.getElementById('deals-stat-month-sub').textContent = monthCount === 1 ? '1 deal completed' : `${monthCount} deals completed`;
  document.getElementById('deals-stat-ytd').textContent = formatUSD(ytdTotal);
  document.getElementById('deals-stat-ytd-sub').textContent = ytdCount === 1 ? '1 deal this year' : `${ytdCount} deals this year`;
  document.getElementById('deals-stat-lifetime').textContent = formatUSD(lifetimeTotal);
  document.getElementById('deals-stat-lifetime-sub').textContent = activeCount === 1 ? '1 active deal now' : `${activeCount} active deals now`;
  document.getElementById('deals-stat-pending').textContent = formatUSD(pendingTotal);
  document.getElementById('deals-stat-pending-sub').textContent = pendingDeals.length === 1 ? '1 deal awaiting payment' : `${pendingDeals.length} deals awaiting payment`;

  // ======= Revenue by month chart (last 6 months) =======
  renderRevenueChart(revenueEvents, now);

  // ======= Top brands =======
  renderTopBrands(revenueEvents);

  // ======= Deals by status breakdown =======
  renderStatusBreakdown();

  // ======= Upcoming campaign end dates =======
  renderUpcomingEnds();
}

function renderRevenueChart(revenueEvents, now) {
  const chartEl = document.getElementById('deals-revenue-chart');
  const labelsEl = document.getElementById('deals-revenue-chart-labels');
  if (!chartEl || !labelsEl) return;

  // Build last 6 months (including current)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), total: 0, label: d.toLocaleDateString('en-US', { month: 'short' }) });
  }

  revenueEvents.forEach(ev => {
    const dt = new Date(ev.received_at);
    const m = months.find(x => x.year === dt.getFullYear() && x.month === dt.getMonth());
    if (m) m.total += ev.amount_cents;
  });

  const maxCents = Math.max(...months.map(m => m.total), 1); // avoid divide-by-zero

  chartEl.innerHTML = months.map(m => {
    const pct = (m.total / maxCents) * 100;
    const heightPct = m.total === 0 ? 2 : Math.max(pct, 4); // minimum visible height when >0
    const barColor = m.total === 0 ? 'rgba(124,58,237,0.15)' : '';
    return `
      <div class="deals-bar" title="${m.label}: ${formatUSD(m.total)}">
        <div class="deals-bar-inner" style="height:${heightPct}%;${barColor ? 'background:' + barColor + ';' : ''}"></div>
      </div>
    `;
  }).join('');

  labelsEl.innerHTML = months.map(m => `<div class="deals-bar-label">${m.label}</div>`).join('');
}

function renderTopBrands(revenueEvents) {
  const el = document.getElementById('deals-top-brands');
  if (!el) return;

  // Aggregate by counterparty_name
  const brandMap = {};
  revenueEvents.forEach(ev => {
    const name = ev.counterparty_name || 'Unknown';
    brandMap[name] = (brandMap[name] || 0) + ev.amount_cents;
  });

  const topBrands = Object.entries(brandMap)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3);

  if (topBrands.length === 0) {
    el.innerHTML = '<div class="deal-s-f648da">Complete a deal to see top brands here.</div>';
    return;
  }

  const totalTop = topBrands.reduce((s, [,v]) => s + v, 0);

  el.innerHTML = topBrands.map(([name, cents], i) => {
    const pct = totalTop > 0 ? (cents / totalTop) * 100 : 0;
    const rankColors = ['#e879f9', '#a78bfa', '#7c3aed'];
    const color = rankColors[i] || '#7c3aed';
    return `
      <div>
        <div class="deal-s-5f0e18">
          <div class="deal-s-0891c6">${escapeHtml(name)}</div>
          <div class="coach-s-1bd029">${formatUSD(cents)}</div>
        </div>
        <div class="deal-s-a56a03">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderStatusBreakdown() {
  const el = document.getElementById('deals-status-breakdown');
  if (!el) return;

  // Exclude drafts per design decision
  const relevantDeals = dealsList.filter(d => d.status !== 'draft');
  if (relevantDeals.length === 0) {
    el.innerHTML = '<div class="deal-s-f648da">No deals yet (drafts excluded).</div>';
    return;
  }

  const counts = {};
  relevantDeals.forEach(d => { counts[d.status] = (counts[d.status] || 0) + 1; });
  const total = relevantDeals.length;

  const order = ['active', 'pending_contract', 'completed', 'cancelled'];
  const statusColors = {
    active: '#c4b5fd',
    pending_contract: '#fbbf24',
    completed: '#4ade80',
    cancelled: '#ef4444'
  };

  el.innerHTML = order.filter(s => counts[s]).map(status => {
    const count = counts[status];
    const pct = (count / total) * 100;
    const color = statusColors[status];
    return `
      <div>
        <div class="deal-s-f9e12a">
          <div class="prod-s-f4344e">${escapeHtml(DEAL_STATUS_LABELS[status])}</div>
          <div class="bio-s-e769ff">${count} <span class="deal-s-494cc5">(${pct.toFixed(0)}%)</span></div>
        </div>
        <div class="deal-s-a56a03">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderUpcomingEnds() {
  const el = document.getElementById('deals-upcoming-ends');
  if (!el) return;

  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Only active/completed deals with an end date in the next 30 days, not already past
  const upcoming = dealsList.filter(d => {
    if (!d.campaign_end_date) return false;
    if (d.status === 'draft' || d.status === 'cancelled') return false;
    const endDate = new Date(d.campaign_end_date + 'T00:00:00');
    return endDate >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && endDate <= in30Days;
  }).sort((a, b) => a.campaign_end_date.localeCompare(b.campaign_end_date));

  if (upcoming.length === 0) {
    el.innerHTML = '<div class="deal-s-f648da">No campaigns ending in the next 30 days.</div>';
    return;
  }

  el.innerHTML = upcoming.slice(0, 5).map(d => {
    const endDate = new Date(d.campaign_end_date + 'T00:00:00');
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((endDate - today) / (24 * 60 * 60 * 1000));
    let urgencyColor = 'var(--muted)';
    let urgencyText;
    if (diffDays === 0) { urgencyText = 'Ends today'; urgencyColor = '#fca5a5'; }
    else if (diffDays === 1) { urgencyText = 'Ends tomorrow'; urgencyColor = '#fbbf24'; }
    else if (diffDays <= 3) { urgencyText = `In ${diffDays} days`; urgencyColor = '#fbbf24'; }
    else if (diffDays <= 7) { urgencyText = `In ${diffDays} days`; urgencyColor = '#c4b5fd'; }
    else { urgencyText = formatDateShort(d.campaign_end_date); }

    return `
      <div data-deal-action="show-detail" data-deal-id="${d.id}" class="deal-s-1d6b3c deal-h-card">
        <div class="bio-s-ec9235">
          <div class="deal-s-b2ab5d">${escapeHtml(d.deal_title)}</div>
          <div class="deal-s-eca745">${escapeHtml(d.brand_name)}</div>
        </div>
        <div style="font-size:11px;color:${urgencyColor};font-weight:500;white-space:nowrap;flex-shrink:0;">${urgencyText}</div>
      </div>
    `;
  }).join('');
}

// =====================================================
// BRAND DEAL CRM - Detail View Open / Close
// =====================================================
async function showDealDetail(dealId) {
  const _gen = window.RyxaLoadGen.bump();
  currentDealId = dealId || null;
  dealsClearDetailPanel();
  setDealDetailLocked(false);
  currentDealDeliverables = [];
  dealDeliverablesLoaded = true; // reset state: empty list is real until a load says otherwise

  // Reset form fields
  document.getElementById('deal-id').value = '';
  document.getElementById('deal-title').value = '';
  document.getElementById('deal-brand-name').value = '';
  document.getElementById('deal-brand-contact-name').value = '';
  document.getElementById('deal-brand-contact-email').value = '';
  document.getElementById('deal-amount').value = '';
  document.getElementById('deal-campaign-start').value = '';
  document.getElementById('deal-campaign-end').value = '';
  document.getElementById('deal-status').value = 'draft';
  document.getElementById('deal-payment-status').value = 'waiting';
  document.getElementById('deal-payment-method').value = '';
  document.getElementById('deal-payment-details').value = '';
  document.getElementById('deal-private-notes').value = '';
  document.getElementById('deal-detail-msg').style.display = 'none';

  if (dealId) {
    const deal = dealsList.find(d => d.id === dealId);
    if (!deal) return;
    document.getElementById('deal-detail-title').textContent = 'Edit Brand Deal';
    document.getElementById('deal-id').value = deal.id;
    document.getElementById('deal-title').value = deal.deal_title || '';
    document.getElementById('deal-brand-name').value = deal.brand_name || '';
    document.getElementById('deal-brand-contact-name').value = deal.brand_contact_name || '';
    document.getElementById('deal-brand-contact-email').value = deal.brand_contact_email || '';
    document.getElementById('deal-amount').value = deal.deal_amount_cents ? (deal.deal_amount_cents / 100).toString() : '';
    document.getElementById('deal-campaign-start').value = deal.campaign_start_date || '';
    document.getElementById('deal-campaign-end').value = deal.campaign_end_date || '';
    document.getElementById('deal-status').value = deal.status || 'draft';
    document.getElementById('deal-payment-status').value = deal.payment_status || 'waiting';
    document.getElementById('deal-payment-method').value = deal.payment_method || '';
    document.getElementById('deal-payment-details').value = deal.payment_details || '';
    document.getElementById('deal-private-notes').value = deal.private_notes || '';
    document.getElementById('deal-delete-btn').style.display = 'inline-block';
    renderContractUI(deal);
    renderInvoiceUI(deal);

    // Instant paint above came from the in-memory list cache. Now fetch the
    // row FRESH behind a lock, exactly like the booking and product editors:
    // deal rows carry payment details and contract state, and saving from a
    // stale snapshot (edited in another tab or on another device) would
    // overwrite the newer data. Deliverables load separately below and have
    // their own loaded-flag guard in saveDeal.
    // Switch to the detail view BEFORE the fetch: the user must see the
    // locked form (and, on failure, the panel) - not linger on the list
    // while an invisible view loads. The function tail's own view switch
    // then runs redundantly on success, which is harmless.
    document.getElementById('deals-list-view').style.display = 'none';
    document.getElementById('deals-detail-view').style.display = 'block';
    var pipelineElEarly = document.getElementById('deals-pipeline-view');
    if (pipelineElEarly) pipelineElEarly.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'instant' });
    setDealDetailLocked(true);
    window.RyxaLoadBar.start(document.getElementById('deal-detail-msg'));
    const MAX_LOAD_ATTEMPTS = 3;
    let freshDeal = null;
    for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
      try {
        const res = await sb.from('brand_deals').select('*').eq('id', dealId).eq('user_id', currentUser.id).single();
        if (res.error) throw res.error;
        if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('deal-detail-msg')); return; }
        freshDeal = res.data;
        break;
      } catch (err) {
        if (attempt < MAX_LOAD_ATTEMPTS) {
          if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('deal-detail-msg')); return; }
          window.RyxaLoadBar.retrying(document.getElementById('deal-detail-msg'), 'Having trouble loading this deal. Retrying...');
          await new Promise(function(resolve) { setTimeout(resolve, 400 * attempt); });
          if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('deal-detail-msg')); return; }
          continue;
        }
        if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('deal-detail-msg')); return; }
        console.error('Failed to load deal:', err);
        window.RyxaLoadBar.fail(document.getElementById('deal-detail-msg'));
        dealsShowDetailFailed();
        showDashToast('error', 'Failed to load. Please retry, or contact hello@ryxa.io if it continues.');
        return;
      }
    }
    // Re-hydrate from the fresh row and refresh the list cache entry.
    const idx = dealsList.findIndex(function(d) { return d.id === dealId; });
    if (idx >= 0) dealsList[idx] = freshDeal;
    document.getElementById('deal-title').value = freshDeal.deal_title || '';
    document.getElementById('deal-brand-name').value = freshDeal.brand_name || '';
    document.getElementById('deal-brand-contact-name').value = freshDeal.brand_contact_name || '';
    document.getElementById('deal-brand-contact-email').value = freshDeal.brand_contact_email || '';
    document.getElementById('deal-amount').value = freshDeal.deal_amount_cents ? (freshDeal.deal_amount_cents / 100).toString() : '';
    document.getElementById('deal-campaign-start').value = freshDeal.campaign_start_date || '';
    document.getElementById('deal-campaign-end').value = freshDeal.campaign_end_date || '';
    document.getElementById('deal-status').value = freshDeal.status || 'draft';
    document.getElementById('deal-payment-status').value = freshDeal.payment_status || 'waiting';
    document.getElementById('deal-payment-method').value = freshDeal.payment_method || '';
    document.getElementById('deal-payment-details').value = freshDeal.payment_details || '';
    document.getElementById('deal-private-notes').value = freshDeal.private_notes || '';
    renderContractUI(freshDeal);
    renderInvoiceUI(freshDeal);
    window.RyxaLoadBar.finish(document.getElementById('deal-detail-msg'));
    setDealDetailLocked(false);
    loadDealDeliverables(dealId);
  } else {
    document.getElementById('deal-detail-title').textContent = 'New Brand Deal';
    document.getElementById('deal-delete-btn').style.display = 'none';
    renderDeliverables();
    renderContractUI(null);
    renderInvoiceUI(null);
  }

  applyDealLockState();
  updateDealDetailBadges();
  updateShareButtonVisibility();
  updateMessagesCardVisibility();
  // Load messages thread if deal is saved
  if (currentDealId) {
    dealMessagesCache = [];
    renderDealMessages();
    loadDealMessages();
  }
  // Reset composer
  const msgInput = document.getElementById('deal-message-input');
  if (msgInput) msgInput.value = '';
  updateMessageCharCount();

  // Switch views
  document.getElementById('deals-list-view').style.display = 'none';
  document.getElementById('deals-detail-view').style.display = 'block';
  // Also hide pipeline if it was active (we'll restore it on "Back to deals")
  const pipelineEl = document.getElementById('deals-pipeline-view');
  if (pipelineEl) pipelineEl.style.display = 'none';
  // Scroll to top
  const toolArea = document.querySelector('.tool-area');
  if (toolArea) toolArea.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function handleDealStatusChange() {
  applyDealLockState();
  updateDealDetailBadges();
  updateShareButtonVisibility();
  updateMessagesCardVisibility();
}

// Update the status + payment badges at the top of the detail page to reflect current form values
function updateDealDetailBadges() {
  const status = document.getElementById('deal-status').value;
  const payment = document.getElementById('deal-payment-status').value;

  const statusBadge = document.getElementById('deal-detail-status-badge');
  if (statusBadge) {
    statusBadge.textContent = DEAL_STATUS_LABELS[status] || status;
    // Swap classes - remove any prior deal-status-* and add the new one
    statusBadge.className = 'deal-status-badge deal-status-' + status;
  }

  const paymentBadge = document.getElementById('deal-detail-payment-badge');
  if (paymentBadge) {
    paymentBadge.textContent = DEAL_PAYMENT_LABELS[payment] || payment;
    paymentBadge.className = 'deal-status-badge';
    if (payment === 'paid') {
      paymentBadge.style.background = 'rgba(74,222,128,0.12)';
      paymentBadge.style.color = '#4ade80';
      paymentBadge.style.border = '1px solid rgba(74,222,128,0.3)';
    } else {
      paymentBadge.style.background = 'rgba(251,191,36,0.1)';
      paymentBadge.style.color = '#fbbf24';
      paymentBadge.style.border = '1px solid rgba(251,191,36,0.3)';
    }
  }
}

function applyDealLockState() {
  const status = document.getElementById('deal-status').value;
  const locked = status === 'completed' || status === 'cancelled';
  const lockBanner = document.getElementById('deal-locked-banner');
  const saveBtn = document.getElementById('deal-save-btn');

  // Inputs that should be disabled when locked (everything except the status itself, so they can change to a lockable state)
  const inputIds = [
    'deal-title','deal-brand-name','deal-brand-contact-name','deal-brand-contact-email',
    'deal-amount','deal-campaign-start','deal-campaign-end','deal-payment-status','deal-private-notes'
  ];

  if (locked && currentDealId) {
    // Only show lock banner for EXISTING saved locked deals, not during new-deal creation
    const savedDeal = dealsList.find(d => d.id === currentDealId);
    const wasLockedWhenOpened = savedDeal && (savedDeal.status === 'completed' || savedDeal.status === 'cancelled');
    if (wasLockedWhenOpened) {
      lockBanner.style.display = 'block';
      document.getElementById('deal-locked-title').textContent = savedDeal.status === 'completed' ? 'Deal Completed' : 'Deal Cancelled';
      inputIds.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
      document.getElementById('deal-status').disabled = true;
      if (saveBtn) saveBtn.style.display = 'none';
      // Lock contract actions (View still works for reading)
      ['deal-contract-choose-btn','deal-contract-replace-btn','deal-contract-remove-btn'].forEach(id => {
        const el = document.getElementById(id); if (el) el.disabled = true;
      });
      // Collapse all deliverables and re-render (locked state hides edit/remove buttons via renderDeliverables check below)
      currentDealDeliverables.forEach(d => { d._expanded = false; });
      renderDeliverables();
      // Hide edit and remove buttons in collapsed cards when locked
      document.querySelectorAll('#deal-deliverables-list button[aria-label="Remove deliverable"], #deal-deliverables-list button[aria-label="Edit deliverable"]').forEach(b => b.style.display = 'none');
      // Hide + Add deliverable button
      const addDelivBtn = document.getElementById('deal-deliverable-add-btn');
      if (addDelivBtn) addDelivBtn.style.display = 'none';
      return;
    }
  }

  // Not locked (or new deal being set to completed) - allow editing
  lockBanner.style.display = 'none';
  inputIds.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
  document.getElementById('deal-status').disabled = false;
  if (saveBtn) saveBtn.style.display = '';
  ['deal-contract-choose-btn','deal-contract-replace-btn','deal-contract-remove-btn'].forEach(id => {
    const el = document.getElementById(id); if (el) el.disabled = false;
  });
  document.querySelectorAll('#deal-deliverables-list button[aria-label="Remove deliverable"], #deal-deliverables-list button[aria-label="Edit deliverable"]').forEach(b => b.style.display = '');
  const addDelivBtn = document.getElementById('deal-deliverable-add-btn');
  if (addDelivBtn) addDelivBtn.style.display = '';

  // Once the deal is shared, lock the brand contact email
  // (creator must revoke share to change it)
  const emailEl = document.getElementById('deal-brand-contact-email');
  const emailHint = document.getElementById('deal-brand-email-hint');
  const savedDeal = currentDealId ? dealsList.find(d => d.id === currentDealId) : null;
  const isShared = savedDeal && savedDeal.share_token && !savedDeal.share_revoked_at;
  if (isShared && emailEl) {
    emailEl.disabled = true;
    emailEl.title = 'Locked - deal is shared with brand. Revoke sharing first to change the contact email.';
    if (emailHint) emailHint.style.display = 'block';
  } else if (emailEl) {
    emailEl.disabled = false;
    emailEl.title = '';
    if (emailHint) emailHint.style.display = 'none';
  }
}

async function revertDealToActive() {
  if (!currentDealId) return;
  const { error } = await sb.from('brand_deals').update({ status: 'active' }).eq('id', currentDealId);
  if (error) {
    showDealModalMsg('error', 'Failed to revert: ' + error.message);
    return;
  }
  // Refresh and re-open
  await loadDealsList();
  showDealDetail(currentDealId);
}

// =====================================================
// BRAND DEAL CRM - Messages Thread (Creator side)
// =====================================================
let dealMessagesCache = [];

// Decide whether to show the messages card. Only for saved deals.
function updateMessagesCardVisibility() {
  const card = document.getElementById('deal-messages-card');
  if (!card) return;
  const deal = currentDealId ? dealsList.find(d => d.id === currentDealId) : null;
  if (!deal) {
    card.style.display = 'none';
    return;
  }
  // Hide on cancelled deals (share is auto-revoked, no point messaging)
  if (deal.status === 'cancelled') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  const noShareEl = document.getElementById('deal-messages-no-share');
  const composer = document.getElementById('deal-message-composer');
  const isShared = deal.share_token && !deal.share_revoked_at;
  const brandHasAccessed = !!deal.brand_first_accessed_at;

  if (!isShared) {
    // No share token yet - show "share with brand first"
    if (noShareEl) {
      noShareEl.style.display = 'block';
      noShareEl.querySelector('div').innerHTML = 'Messages will be visible to the brand once you share this deal. Click <strong class="mk-s-e0b980">Share with brand</strong> above to generate the portal link.';
    }
    if (composer) composer.style.display = 'none';
  } else if (!brandHasAccessed) {
    // Shared but brand hasn't logged into portal yet - wait for them
    if (noShareEl) {
      noShareEl.style.display = 'block';
      noShareEl.querySelector('div').innerHTML = '<strong class="mk-s-e0b980">Chat will be enabled when the brand logs in.</strong> Send them the portal link and PIN above so they can access the deal.';
    }
    if (composer) composer.style.display = 'none';
  } else {
    // Brand has logged in - chat is fully enabled
    if (noShareEl) noShareEl.style.display = 'none';
    if (composer) composer.style.display = 'flex';
  }
}

async function loadDealMessages() {
  if (!currentDealId) return;
  const { data, error } = await sb
    .from('deal_messages')
    .select('*')
    .eq('deal_id', currentDealId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load messages:', error);
    return;
  }
  dealMessagesCache = data || [];
  renderDealMessages();

  // Mark any unread brand messages as read by creator (since they're viewing now)
  const unreadBrandMessages = dealMessagesCache.filter(m => m.author_type === 'brand' && !m.read_by_other_party);
  if (unreadBrandMessages.length > 0) {
    const ids = unreadBrandMessages.map(m => m.id);
    await sb.from('deal_messages').update({ read_by_other_party: true }).in('id', ids);
  }
}

// Refresh button wrapper: visual feedback so user knows it worked
async function refreshMessagesWithFeedback(btn) {
  if (!btn) return;
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="deal-s-b47f1d"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refreshing`;
  await loadDealMessages();
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> <span class="bio-s-f4cfc5">Updated</span>`;
  setTimeout(() => {
    btn.innerHTML = originalHTML;
    btn.disabled = false;
    btn.style.opacity = '';
  }, 1200);
}

function renderDealMessages() {
  const threadEl = document.getElementById('deal-messages-thread');
  const emptyEl = document.getElementById('deal-messages-empty');
  if (!threadEl || !emptyEl) return;

  if (dealMessagesCache.length === 0) {
    threadEl.innerHTML = '';
    threadEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  threadEl.style.display = 'flex';

  threadEl.innerHTML = dealMessagesCache.map(m => {
    const isCreator = m.author_type === 'creator';
    const bg = isCreator ? 'rgba(124,58,237,0.08)' : 'var(--surface)';
    const border = isCreator ? '1px solid rgba(124,58,237,0.25)' : '1px solid var(--border)';
    const align = isCreator ? 'flex-end' : 'flex-start';
    const nameColor = isCreator ? '#c4b5fd' : '#fbbf24';
    const roleLabel = isCreator ? 'You' : escapeHtml(m.author_name || 'Brand');
    const dt = new Date(m.created_at);
    const timeStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    // Simple text rendering with newlines preserved
    const content = escapeHtml(m.content).replace(/\n/g, '<br>');
    return `
      <div style="display:flex;justify-content:${align};">
        <div style="max-width:75%;background:${bg};border:${border};border-radius:12px;padding:10px 14px;">
          <div class="deal-s-34ce3d">
            <div style="font-size:12px;font-weight:600;color:${nameColor};">${roleLabel}</div>
            <div class="course-s-e6b2fc">${timeStr}</div>
          </div>
          <div class="deal-s-687edd">${content}</div>
        </div>
      </div>
    `;
  }).join('');

  // Scroll to bottom (newest messages)
  setTimeout(() => { threadEl.scrollTop = threadEl.scrollHeight; }, 50);
}

async function postCreatorMessage() {
  if (!currentDealId) return;
  const input = document.getElementById('deal-message-input');
  const content = (input.value || '').trim();
  if (!content) {
    input.focus();
    return;
  }
  if (content.length > 5000) {
    showDealModalMsg('error', 'Message is too long (max 5000 characters).');
    return;
  }

  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal) return;

  // Gate: chat is only enabled after brand has logged into portal once
  if (!deal.share_token || deal.share_revoked_at) {
    showDealModalMsg('error', 'Share this deal with the brand first to enable messaging.');
    return;
  }
  if (!deal.brand_first_accessed_at) {
    showDealModalMsg('error', 'Chat will be enabled once the brand opens the portal with the PIN.');
    return;
  }

  // Get creator display name - prefer profiles.username, fall back to email prefix
  let authorName = 'Creator';
  try {
    const { data: profile } = await sb.from('profiles').select('username').eq('user_id', currentUser.id).maybeSingle();
    if (profile && profile.username) {
      authorName = '@' + profile.username;
    } else if (currentUser.email) {
      authorName = currentUser.email.split('@')[0];
    }
  } catch (e) {
    // Non-fatal
  }

  const btn = document.getElementById('deal-message-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const { error } = await sb.from('deal_messages').insert({
    deal_id: currentDealId,
    user_id: currentUser.id,
    author_type: 'creator',
    author_name: authorName,
    content: content
  });

  btn.disabled = false;
  btn.textContent = 'Send';

  if (error) {
    showDealModalMsg('error', 'Failed to send message: ' + error.message);
    return;
  }

  // Fire-and-forget brand notification (smart batching enforced server-side)
  const preview = content.length > 200 ? content.slice(0, 200) + '…' : content;
  notifyBrandOfCreatorMessage(currentDealId, preview);

  // Clear input + reload thread
  input.value = '';
  updateMessageCharCount();
  await loadDealMessages();
}

function updateMessageCharCount() {
  const input = document.getElementById('deal-message-input');
  const countEl = document.getElementById('deal-message-char-count');
  if (!input || !countEl) return;
  const len = (input.value || '').length;
  countEl.textContent = `${len} / 5000`;
  countEl.style.color = len > 4900 ? '#fca5a5' : 'var(--muted)';
}

// =====================================================
// BRAND DEAL CRM - Deliverables in modal
// =====================================================
async function loadDealDeliverables(dealId) {
  dealDeliverablesLoaded = false;
  // Same RLS subtlety as the course loader: an unauthenticated select
  // returns empty data with NO error. Never trust an empty result unless
  // a live session existed when the query ran.
  const { data: _sessData } = await sb.auth.getSession();
  if (!_sessData || !_sessData.session) {
    currentDealDeliverables = [];
    if (typeof showDashToast === 'function') {
      showDashToast('error', 'Session still loading. Reopen this deal before editing deliverables.');
    }
    renderDeliverables();
    return;
  }
  const { data, error } = await sb
    .from('deal_deliverables')
    .select('*')
    .eq('deal_id', dealId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Failed to load deliverables:', error);
    currentDealDeliverables = [];
    if (typeof showDashToast === 'function') {
      showDashToast('error', 'Could not load deliverables. Saving deliverables is disabled until you reopen this deal.');
    }
  } else {
    dealDeliverablesLoaded = true;
    currentDealDeliverables = (data || []).map(d => ({
      id: d.id,
      title: d.title,
      notes: d.notes || '',
      submitted_url: d.submitted_url || '',
      due_date: d.due_date || '',
      _existing: true,
      _expanded: false
    }));
  }
  renderDeliverables();
}

function addDeliverableRow() {
  currentDealDeliverables.push({ id: null, title: '', notes: '', submitted_url: '', due_date: '', _existing: false, _expanded: true });
  renderDeliverables();
  // Focus the new title input
  setTimeout(() => {
    const inputs = document.querySelectorAll('#deal-deliverables-list input[data-field="title"]');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }, 50);
}

function removeDeliverableRow(index) {
  currentDealDeliverables.splice(index, 1);
  renderDeliverables();
}

function updateDeliverableField(index, field, value) {
  if (currentDealDeliverables[index]) {
    currentDealDeliverables[index][field] = value;
  }
}

// Collapse a deliverable to its summary card (no DB write - page-level Save persists)
function collapseDeliverable(index) {
  if (currentDealDeliverables[index]) {
    // Require at least a title to collapse
    const title = (currentDealDeliverables[index].title || '').trim();
    if (!title) {
      // Shake/flash to signal error
      const card = document.querySelector(`#deal-deliverables-list > div[data-idx="${index}"]`);
      if (card) {
        const input = card.querySelector('input[data-field="title"]');
        if (input) {
          input.style.borderColor = '#ef4444';
          input.focus();
          setTimeout(() => { input.style.borderColor = ''; }, 1800);
        }
      }
      return;
    }
    currentDealDeliverables[index]._expanded = false;
    renderDeliverables();
  }
}

function expandDeliverable(index) {
  if (currentDealDeliverables[index]) {
    currentDealDeliverables[index]._expanded = true;
    renderDeliverables();
  }
}

function renderDeliverables() {
  const listEl = document.getElementById('deal-deliverables-list');
  const emptyEl = document.getElementById('deal-deliverables-empty');
  if (!listEl || !emptyEl) return;

  if (currentDealDeliverables.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  listEl.innerHTML = currentDealDeliverables.map((d, i) => {
    if (d._expanded) {
      // EXPANDED: form for editing
      return `
        <div data-idx="${i}" class="deal-s-1c2052">
          <div class="deal-s-59e26e">
            <div class="deal-s-aabca4">Deliverable ${i + 1}</div>
            <button type="button" data-deal-action="remove-deliverable" data-deal-i="${i}" aria-label="Remove deliverable" title="Remove" class="deal-s-39243f">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </div>
          <div class="prod-s-af3fee">
            <label class="deal-label">Title *</label>
            <input type="text" data-field="title" placeholder="e.g., 1 Instagram Reel, 1 TikTok Video, Usage Rights, Exclusivity" maxlength="200" value="${escapeHtml(d.title)}"
              data-deal-action="update-deliverable" data-deal-event="input" data-deal-i="${i}" data-deal-field="title"
              aria-label="Deliverable title"
              class="deal-input">
          </div>
          <div class="prod-s-af3fee">
            <label class="deal-label">Notes <span class="deal-s-1baf67">(optional)</span></label>
            <textarea data-field="notes" rows="2" placeholder="Tone, length, dates, hashtags..." maxlength="1000"
              data-deal-action="update-deliverable" data-deal-event="input" data-deal-i="${i}" data-deal-field="notes"
              aria-label="Deliverable notes"
              class="deal-input deal-s-a72c66" >${escapeHtml(d.notes)}</textarea>
          </div>
          <div class="prod-s-af3fee">
            <label class="deal-label">Due Date <span class="deal-s-1baf67">(optional - adds to your calendar)</span></label>
            <input type="date" data-field="due_date" value="${escapeHtml(d.due_date || '')}"
              data-deal-action="update-deliverable" data-deal-event="change" data-deal-i="${i}" data-deal-field="due_date"
              aria-label="Deliverable due date"
              class="deal-input deal-s-953a23" >
          </div>
          <div class="deal-s-3ef1fa">
            <label class="deal-label">Submitted URL <span class="deal-s-1baf67">(link to posted content)</span></label>
            <input type="url" data-field="submitted_url" placeholder="https://instagram.com/p/..." maxlength="500" value="${escapeHtml(d.submitted_url)}"
              data-deal-action="update-deliverable" data-deal-event="input" data-deal-i="${i}" data-deal-field="submitted_url"
              aria-label="Deliverable submitted URL"
              class="deal-input">
          </div>
          <div class="deal-s-c2f80f">
            <button type="button" data-deal-action="collapse-deliverable" data-deal-i="${i}" class="deal-s-4f87e6">Done</button>
          </div>
        </div>
      `;
    } else {
      // COLLAPSED: summary card with edit pencil
      const notesPreview = (d.notes || '').trim();
      const notesOneLine = notesPreview.split(/\r?\n/)[0];
      const notesTrunc = notesOneLine.length > 140 ? notesOneLine.slice(0, 140) + '…' : notesOneLine;
      const hasUrl = (d.submitted_url || '').trim().length > 0;
      const safeUrl = hasUrl ? escapeHtml(d.submitted_url) : '';
      const urlDisplay = hasUrl ? escapeHtml(d.submitted_url.length > 60 ? d.submitted_url.slice(0, 57) + '…' : d.submitted_url) : '';
      const hasDueDate = !!(d.due_date && d.due_date.length);
      const dueDateLabel = hasDueDate ? new Date(d.due_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return `
        <div data-idx="${i}" class="deal-s-25f67b">
          <div class="bio-s-a07604">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:${notesPreview || hasUrl || hasDueDate ? '6px' : '0'};flex-wrap:wrap;">
              <div class="deal-s-24bb68">${escapeHtml(d.title) || '<span class="deal-s-565611">Untitled deliverable</span>'}</div>
              ${hasDueDate ? `<span class="deal-s-3a6e7e">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Due ${escapeHtml(dueDateLabel)}
              </span>` : ''}
            </div>
            ${notesTrunc ? `<div style="font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:${hasUrl ? '6px' : '0'};">${escapeHtml(notesTrunc)}</div>` : ''}
            ${hasUrl ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="deal-s-21f848">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="bio-s-f38a95"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              ${urlDisplay}
            </a>` : ''}
          </div>
          <div class="deal-s-3e89d1">
            <button type="button" data-deal-action="expand-deliverable" data-deal-i="${i}" aria-label="Edit deliverable" title="Edit" class="deal-s-39243f">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button type="button" data-deal-action="remove-deliverable" data-deal-i="${i}" aria-label="Remove deliverable" title="Remove" class="deal-s-39243f">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        </div>
      `;
    }
  }).join('');
}

// =====================================================
// BRAND DEAL CRM - Contract upload/view/remove
// =====================================================
const DEAL_CONTRACT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function renderContractUI(deal) {
  const emptyEl = document.getElementById('deal-contract-empty');
  const existingEl = document.getElementById('deal-contract-existing');
  const saveFirstEl = document.getElementById('deal-contract-save-first');
  const uploaderEl = document.getElementById('deal-contract-uploader');
  const signingEl = document.getElementById('deal-contract-signing');
  const fileInput = document.getElementById('deal-contract-input');
  if (fileInput) fileInput.value = ''; // reset so same file can be re-selected
  document.getElementById('deal-contract-progress').style.display = 'none';

  if (deal && deal.contract_file_path) {
    emptyEl.style.display = 'none';
    existingEl.style.display = 'flex';
    document.getElementById('deal-contract-filename').textContent = deal.contract_file_name || 'contract.pdf';

    // Signing status
    signingEl.style.display = 'block';
    const creatorStatusEl = document.getElementById('deal-contract-creator-status');
    const brandStatusEl = document.getElementById('deal-contract-brand-status');
    const signBtn = document.getElementById('deal-contract-sign-btn');
    const markSignedBtn = document.getElementById('deal-contract-marksigned-btn');
    const sendBtn = document.getElementById('deal-contract-send-btn');
    const lockedMsg = document.getElementById('deal-contract-locked-msg');
    const actionsEl = document.getElementById('deal-contract-sign-actions');

    const isLocked = deal.contract_locked;

    // Creator status
    if (deal.creator_signed_at) {
      const d = new Date(deal.creator_signed_at);
      creatorStatusEl.innerHTML = `<span class="bio-s-f4cfc5">Signed</span> <span class="deal-s-ad140b">${d.toLocaleDateString()}</span>`;
    } else {
      creatorStatusEl.innerHTML = '<span class="deal-s-2ddf87">Not signed</span>';
    }

    // Brand status
    if (deal.brand_signed_at) {
      const d = new Date(deal.brand_signed_at);
      brandStatusEl.innerHTML = `<span class="bio-s-f4cfc5">Signed</span> <span class="deal-s-ad140b">${d.toLocaleDateString()}</span>`;
    } else {
      brandStatusEl.innerHTML = '<span class="deal-s-2ddf87">Not signed</span>';
    }

    if (isLocked) {
      // Fully executed - hide all action buttons, show locked message
      actionsEl.style.display = 'none';
      lockedMsg.style.display = 'block';
      // Hide replace/remove buttons when locked
      const replaceBtn = document.getElementById('deal-contract-replace-btn');
      const removeBtn = document.getElementById('deal-contract-remove-btn');
      if (replaceBtn) replaceBtn.style.display = 'none';
      if (removeBtn) removeBtn.style.display = 'none';
    } else {
      actionsEl.style.display = 'flex';
      lockedMsg.style.display = 'none';
      // Show sign/mark-signed if creator hasn't signed
      signBtn.style.display = deal.creator_signed_at ? 'none' : 'inline-block';
      markSignedBtn.style.display = deal.creator_signed_at ? 'none' : 'inline-block';
      // Show send button if creator has signed and deal is shared
      const isShared = deal.share_token && !deal.share_revoked_at;
      sendBtn.style.display = (deal.creator_signed_at && isShared) ? 'inline-block' : 'none';
    }
  } else {
    existingEl.style.display = 'none';
    signingEl.style.display = 'none';
    emptyEl.style.display = 'block';
    // Always show the uploader - we auto-save as draft when needed on file select
    if (saveFirstEl) saveFirstEl.style.display = 'none';
    if (uploaderEl) uploaderEl.style.display = 'block';
  }
}

// Auto-save the current form as a Draft so the contract can be uploaded with a valid deal_id.
// Returns true on success (and sets currentDealId), false on validation/save failure.
async function autoSaveDraftForContract() {
  const title = document.getElementById('deal-title').value.trim();
  const brandName = document.getElementById('deal-brand-name').value.trim();

  if (!title) {
    showDealModalMsg('error', 'Please enter the deal title before uploading a contract.');
    document.getElementById('deal-title').focus();
    return false;
  }
  if (!brandName) {
    showDealModalMsg('error', 'Please enter the brand name before uploading a contract.');
    document.getElementById('deal-brand-name').focus();
    return false;
  }

  const brandContactName = document.getElementById('deal-brand-contact-name').value.trim();
  const brandContactEmail = document.getElementById('deal-brand-contact-email').value.trim();
  if (brandContactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brandContactEmail)) {
    showDealModalMsg('error', 'Please enter a valid brand contact email.');
    document.getElementById('deal-brand-contact-email').focus();
    return false;
  }

  const amountRaw = document.getElementById('deal-amount').value;
  const amountCents = amountRaw ? Math.round(parseFloat(amountRaw) * 100) : 0;
  const campaignStart = document.getElementById('deal-campaign-start').value || null;
  const campaignEnd = document.getElementById('deal-campaign-end').value || null;
  const paymentStatus = document.getElementById('deal-payment-status').value;
  const privateNotes = document.getElementById('deal-private-notes').value.trim();

  const payload = {
    user_id: currentUser.id,
    deal_title: title,
    brand_name: brandName,
    brand_contact_name: brandContactName || null,
    brand_contact_email: brandContactEmail || null,
    deal_amount_cents: amountCents,
    campaign_start_date: campaignStart,
    campaign_end_date: campaignEnd,
    status: 'draft',  // Auto-save always creates a draft
    payment_status: paymentStatus,
    private_notes: privateNotes || null
  };

  const { data, error } = await sb.from('brand_deals').insert(payload).select().single();
  if (error) {
    showDealModalMsg('error', 'Could not save draft: ' + error.message);
    return false;
  }

  currentDealId = data.id;
  // Refresh list cache so analytics / lists include this new draft
  await loadDealsList();
  // Update UI to "Edit" mode (show delete button, update title)
  document.getElementById('deal-detail-title').textContent = 'Edit Brand Deal';
  document.getElementById('deal-delete-btn').style.display = 'inline-block';
  document.getElementById('deal-status').value = 'draft';
  return true;
}

async function handleContractFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Validate type
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showDealModalMsg('error', 'Please upload a PDF file.');
    event.target.value = '';
    return;
  }
  // Validate size
  if (file.size > DEAL_CONTRACT_MAX_BYTES) {
    showDealModalMsg('error', 'File is too large. Maximum size is 10MB.');
    event.target.value = '';
    return;
  }

  // Auto-save as draft if this is a new (unsaved) deal - need a deal_id to scope the upload path
  if (!currentDealId) {
    const autoSaved = await autoSaveDraftForContract();
    if (!autoSaved) {
      // validation failed or save errored - error message already shown
      event.target.value = '';
      return;
    }
  }

  const progressEl = document.getElementById('deal-contract-progress');
  progressEl.style.display = 'block';
  progressEl.textContent = 'Uploading...';

  const storagePath = `${currentUser.id}/${currentDealId}.pdf`;

  // Upload (upsert = overwrite if exists)
  const { error: uploadError } = await sb.storage
    .from('deal-contracts')
    .upload(storagePath, file, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (uploadError) {
    progressEl.style.display = 'none';
    showDealModalMsg('error', 'Upload failed: ' + uploadError.message);
    event.target.value = '';
    return;
  }

  // Update the deal record with the file path + name
  const { error: updateError } = await sb
    .from('brand_deals')
    .update({ contract_file_path: storagePath, contract_file_name: file.name })
    .eq('id', currentDealId);

  if (updateError) {
    progressEl.style.display = 'none';
    showDealModalMsg('error', 'Upload succeeded but saving failed: ' + updateError.message);
    return;
  }

  // Update local cache + UI
  const dealIdx = dealsList.findIndex(d => d.id === currentDealId);
  if (dealIdx >= 0) {
    dealsList[dealIdx].contract_file_path = storagePath;
    dealsList[dealIdx].contract_file_name = file.name;
  }
  renderContractUI(dealsList[dealIdx]);
  showDealModalMsg('success', 'Contract uploaded.');
  setTimeout(() => {
    document.getElementById('deal-detail-msg').style.display = 'none';
  }, 2500);
  event.target.value = '';
}

// Download a file from a URL as a blob. Used for contracts and invoices.
// The Ryxa PWA deliberately blocks external navigation (to avoid stranding
// the user with no back button), so window.open / anchor-to-URL does not
// work in the installed app. Fetching the file as a blob and downloading
// THAT is not a navigation - it works identically in a browser and a PWA.
async function downloadFileFromUrl(url, filename) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Download failed (' + resp.status + ')');
  const blob = await resp.blob();

  // Native app: WKWebView does not support the anchor download attribute
  // (clicking would navigate to the blob and take over the screen), so the
  // file is handed across the bridge for the iOS save/share sheet instead.
  if (window.RyxaNative && window.ReactNativeWebView) {
    const base64 = await new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onload = function() { resolve(String(reader.result).split(',')[1] || ''); };
      reader.onerror = function() { reject(new Error('Could not read file')); };
      reader.readAsDataURL(blob);
    });
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'saveFile',
      filename: filename || 'document.pdf',
      mime: blob.type || 'application/pdf',
      base64: base64
    }));
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename || 'document.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the object URL after a tick so the download has started.
  setTimeout(function() { URL.revokeObjectURL(objectUrl); }, 1000);
}

async function viewContract() {
  if (!currentDealId) return;
  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal || !deal.contract_file_path) return;

  // Create a signed URL good for 1 hour
  const { data, error } = await sb.storage
    .from('deal-contracts')
    .createSignedUrl(deal.contract_file_path, 3600);

  if (error || !data?.signedUrl) {
    showDealModalMsg('error', 'Failed to download contract: ' + (error?.message || 'unknown error'));
    return;
  }
  try {
    await downloadFileFromUrl(data.signedUrl, deal.contract_file_name || 'contract.pdf');
  } catch (e) {
    showDealModalMsg('error', 'Failed to download contract: ' + (e.message || 'unknown error'));
  }
}

async function removeContract() {
  if (!currentDealId) return;
  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal || !deal.contract_file_path) return;

  // Locked contracts cannot be removed
  if (deal.contract_locked) {
    showDealModalMsg('error', 'This contract is fully executed and cannot be removed.');
    return;
  }

  const confirmed1 = await dashConfirm('Remove the uploaded contract? This cannot be undone.');
  if (!confirmed1) return;

  const path = deal.contract_file_path;

  // Delete from storage (best effort - even if this fails we still clear the DB ref)
  const { error: storageErr } = await sb.storage.from('deal-contracts').remove([path]);
  if (storageErr) console.warn('Storage delete warning:', storageErr);

  // Clear DB fields including signing status
  const { error } = await sb
    .from('brand_deals')
    .update({ contract_file_path: null, contract_file_name: null, creator_signed_at: null, brand_signed_at: null, contract_locked: false })
    .eq('id', currentDealId);

  if (error) {
    showDealModalMsg('error', 'Failed to remove: ' + error.message);
    return;
  }

  // Update cache + UI
  const dealIdx = dealsList.findIndex(d => d.id === currentDealId);
  if (dealIdx >= 0) {
    dealsList[dealIdx].contract_file_path = null;
    dealsList[dealIdx].contract_file_name = null;
    dealsList[dealIdx].creator_signed_at = null;
    dealsList[dealIdx].brand_signed_at = null;
    dealsList[dealIdx].contract_locked = false;
  }
  renderContractUI(dealsList[dealIdx]);
}

// =====================================================
// =====================================================
// BRAND DEAL CRM - Contract Signing
// =====================================================

let _dashConfirmResolve = null;
function dashConfirm(msg) {
  return new Promise(function(resolve) {
    _dashConfirmResolve = resolve;
    document.getElementById('dash-confirm-msg').textContent = msg;
    document.getElementById('dash-confirm-modal').style.display = 'flex';
  });
}
function resolveDashConfirm(val) {
  document.getElementById('dash-confirm-modal').style.display = 'none';
  if (_dashConfirmResolve) { _dashConfirmResolve(val); _dashConfirmResolve = null; }
}

// Post an automated contract event message to the deal's chat thread
async function signContractAsCreator() {
  if (!currentDealId) return;
  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal || !deal.contract_file_path) return;

  const btn = document.getElementById('deal-contract-sign-btn');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    // Wait for PDF.js
    await window.__pdfjsReady;
    if (!window.pdfjsLib) throw new Error('PDF viewer not loaded. Refresh the page.');

    // Get signed URL and fetch bytes
    const { data, error } = await sb.storage
      .from('deal-contracts')
      .createSignedUrl(deal.contract_file_path, 3600);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not load contract');

    const resp = await fetch(data.signedUrl);
    if (!resp.ok) throw new Error('Failed to download contract');
    const arrayBuffer = await resp.arrayBuffer();

    // Load into the Sign PDF tool
    pdfsignOriginalBytes = new Uint8Array(arrayBuffer);
    pdfsignFilename = deal.contract_file_name || 'contract.pdf';
    pdfsignFields = [];
    pdfsignActiveFieldType = null;

    const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(pdfsignOriginalBytes) });
    pdfsignDoc = await loadingTask.promise;

    // Mark as inited so showTool doesn't call resetPdfSign
    pdfsignInited = true;

    // Switch to Sign PDF tool (must happen BEFORE setting context)
    showTool('pdfsign');

    // NOW set context - after showTool so the cleanup check doesn't trigger
    window._contractSignContext = {
      dealId: currentDealId,
      storagePath: deal.contract_file_path,
      fileName: deal.contract_file_name || 'contract.pdf'
    };

    // Switch to editor view
    document.getElementById('pdfsign-upload').style.display = 'none';
    document.getElementById('pdfsign-editor').style.display = 'block';
    document.getElementById('pdfsign-filename').textContent = pdfsignFilename;
    document.getElementById('pdfsign-pages-info').textContent = pdfsignDoc.numPages + ' page' + (pdfsignDoc.numPages > 1 ? 's' : '');

    await renderAllPages();

    // Add the "Save & Upload to Deal" button to the palette actions
    showContractSaveButton();

  } catch (err) {
    showDealModalMsg('error', 'Failed to load contract: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function showContractSaveButton() {
  // Remove old one if present
  const old = document.getElementById('pdfsign-contract-save-btn');
  if (old) old.remove();

  // Hide "New PDF" button and privacy badge
  const newBtn = document.getElementById('pdfsign-new-btn');
  if (newBtn) newBtn.style.display = 'none';
  const privBadge = document.getElementById('pdfsign-privacy-badge');
  if (privBadge) privBadge.style.display = 'none';
  // Hide print and download buttons
  const printBtn = document.getElementById('pdfsign-print-btn');
  if (printBtn) printBtn.style.display = 'none';
  const dlBtn = document.getElementById('pdfsign-download-btn');
  if (dlBtn) dlBtn.style.display = 'none';

  // Add "Back to Brand Deal CRM" button in place of New PDF
  const oldBack = document.getElementById('pdfsign-contract-back-btn');
  if (oldBack) oldBack.remove();
  const backBtn = document.createElement('button');
  backBtn.id = 'pdfsign-contract-back-btn';
  backBtn.style.cssText = 'padding:8px 12px;background:transparent;border:1px solid var(--border-hover);color:var(--muted);border-radius:8px;font-size:12px;font-family:DM Sans,sans-serif;cursor:pointer;white-space:nowrap;';
  backBtn.textContent = '← Back to Brand Deal CRM';
  backBtn.onclick = function() {
    const ctx = window._contractSignContext;
    const dealId = ctx ? ctx.dealId : null;
    removeContractSaveButton();
    pdfsignOriginalBytes = null;
    pdfsignFields = [];
    pdfsignDoc = null;
    document.getElementById('pdfsign-upload').style.display = 'block';
    document.getElementById('pdfsign-editor').style.display = 'none';
    showTool('deals');
    if (dealId) setTimeout(() => { showDealDetail(dealId); }, 200);
  };
  if (newBtn && newBtn.parentNode) newBtn.parentNode.insertBefore(backBtn, newBtn);

  const actionsEl = document.querySelector('.pdfsign-palette-actions');
  if (!actionsEl) return;

  const saveBtn = document.createElement('button');
  saveBtn.id = 'pdfsign-contract-save-btn';
  saveBtn.className = 'pdfsign-action-btn pdfsign-action-primary';
  saveBtn.style.cssText = 'background:linear-gradient(135deg,#a78bfa,#e879f9);border:none;';
  saveBtn.setAttribute('aria-label', 'Save signed contract back to deal');
  saveBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Save & Upload to Deal';
  saveBtn.onclick = saveSignedContractBack;
  actionsEl.appendChild(saveBtn);

  // Also add a banner at top of the editor
  const editorEl = document.getElementById('pdfsign-editor');
  const oldBanner = document.getElementById('pdfsign-contract-banner');
  if (oldBanner) oldBanner.remove();

  const banner = document.createElement('div');
  banner.id = 'pdfsign-contract-banner';
  banner.style.cssText = 'padding:10px 16px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.25);border-radius:10px;margin-bottom:12px;font-size:12px;color:var(--text);display:flex;align-items:center;gap:8px;';
  banner.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span><strong class="deal-s-98f215">Contract Signing Mode</strong> - Sign the contract and click <strong>Save & Upload to Deal</strong> when done.</span>';
  editorEl.insertBefore(banner, editorEl.firstChild);
}

function removeContractSaveButton() {
  const btn = document.getElementById('pdfsign-contract-save-btn');
  if (btn) btn.remove();
  const banner = document.getElementById('pdfsign-contract-banner');
  if (banner) banner.remove();
  const backBtn = document.getElementById('pdfsign-contract-back-btn');
  if (backBtn) backBtn.remove();
  // Restore hidden elements
  const newBtn = document.getElementById('pdfsign-new-btn');
  if (newBtn) newBtn.style.display = '';
  const privBadge = document.getElementById('pdfsign-privacy-badge');
  if (privBadge) privBadge.style.display = '';
  const printBtn = document.getElementById('pdfsign-print-btn');
  if (printBtn) printBtn.style.display = '';
  const dlBtn = document.getElementById('pdfsign-download-btn');
  if (dlBtn) dlBtn.style.display = '';
  window._contractSignContext = null;
}

async function saveSignedContractBack() {
  const ctx = window._contractSignContext;
  if (!ctx) { showModalAlert('Sign contract', 'No contract context. Please try signing again from the deal.'); return; }

  const btn = document.getElementById('pdfsign-contract-save-btn');
  if (!btn) return;
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Saving...';

  try {
    const pdfBytes = await buildSignedPdfBytes();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });

    // Upload back to same path (overwrite)
    const { error: uploadError } = await sb.storage
      .from('deal-contracts')
      .upload(ctx.storagePath, blob, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    // Mark creator as signed - auto-lock + activate if brand already signed
    const now = new Date().toISOString();
    const dealIdx = dealsList.findIndex(d => d.id === ctx.dealId);
    const brandAlreadySigned = dealIdx >= 0 && dealsList[dealIdx].brand_signed_at;
    const updatePayload = { creator_signed_at: now };
    if (brandAlreadySigned) { updatePayload.contract_locked = true; updatePayload.status = 'active'; }
    const { error: updateError } = await sb
      .from('brand_deals')
      .update(updatePayload)
      .eq('id', ctx.dealId);
    if (updateError) throw new Error(updateError.message);

    // Update local cache
    if (dealIdx >= 0) {
      dealsList[dealIdx].creator_signed_at = now;
      if (brandAlreadySigned) { dealsList[dealIdx].contract_locked = true; dealsList[dealIdx].status = 'active'; }
    }

    // Clean up and go back to deals
    const dealId = ctx.dealId;
    removeContractSaveButton();

    // Reset Sign PDF tool
    pdfsignOriginalBytes = null;
    pdfsignFields = [];
    pdfsignDoc = null;
    document.getElementById('pdfsign-upload').style.display = 'block';
    document.getElementById('pdfsign-editor').style.display = 'none';

    showTool('deals');
    showDashToast('success', 'Contract signed and saved to deal.');
    // Notify brand (fire-and-forget)
    sb.functions.invoke('send-deal-notification', { body: { type: 'contract_creator_signed', deal_id: dealId } }).then(r => { console.log('Contract notification response:', r); if (r.error) console.warn('Notification error:', r.error); }).catch(e => console.warn('Notification failed:', e));

    // Re-open the deal detail
    setTimeout(() => {
      const deal = dealsList.find(d => d.id === dealId);
      if (deal) showDealDetail(dealId);
    }, 300);

  } catch (err) {
    showModalAlert('Save failed', 'Failed to save: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

async function markContractCreatorSigned() {
  if (!currentDealId) return;
  const confirmed2 = await dashConfirm('Mark the contract as signed by you? Use this if you signed the contract outside of Ryxa.');
  if (!confirmed2) return;

  try {
    const now = new Date().toISOString();
    const dealIdx = dealsList.findIndex(d => d.id === currentDealId);
    const brandAlreadySigned = dealIdx >= 0 && dealsList[dealIdx].brand_signed_at;
    const updatePayload = { creator_signed_at: now };
    if (brandAlreadySigned) { updatePayload.contract_locked = true; updatePayload.status = 'active'; }
    const { error } = await sb
      .from('brand_deals')
      .update(updatePayload)
      .eq('id', currentDealId);
    if (error) throw new Error(error.message);

    if (dealIdx >= 0) {
      dealsList[dealIdx].creator_signed_at = now;
      if (brandAlreadySigned) { dealsList[dealIdx].contract_locked = true; dealsList[dealIdx].status = 'active'; }
    }
    renderContractUI(dealsList[dealIdx]);
    showDealModalMsg('success', 'Contract marked as signed.' + (brandAlreadySigned ? ' Deal is now active.' : ''));
    sb.functions.invoke('send-deal-notification', { body: { type: 'contract_creator_signed', deal_id: currentDealId } }).catch(e => console.warn('Notification failed:', e));
    setTimeout(() => { const msg = document.getElementById('deal-detail-msg'); if (msg) msg.style.display = 'none'; }, 2500);
  } catch (err) {
    showDealModalMsg('error', 'Failed: ' + err.message);
  }
}

async function sendContractToBrand() {
  if (!currentDealId) return;
  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal || !deal.contract_file_path) return;

  if (!deal.brand_contact_email) {
    showDealModalMsg('error', 'Add a brand contact email to the deal first.');
    document.getElementById('deal-brand-contact-email').focus();
    return;
  }
  if (!deal.share_token || deal.share_revoked_at) {
    showDealModalMsg('error', 'Click "Share with brand" first to enable the brand portal.');
    return;
  }
  if (!deal.brand_first_accessed_at) {
    showDealModalMsg('error', 'Sending unlocks once the brand opens the portal with the PIN.');
    return;
  }

  const confirmed3 = await dashConfirm('Resend the contract signing email to ' + deal.brand_contact_email + '?');
  if (!confirmed3) return;

  const btn = document.getElementById('deal-contract-send-btn');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const { data, error } = await sb.functions.invoke('send-deal-notification', {
      body: { type: 'contract_creator_signed', deal_id: currentDealId }
    });
    if (error) throw new Error(error.message || 'Failed to send');
    if (data && data.error) throw new Error(data.error);

    showDealModalMsg('success', 'Brand has been notified via email at ' + deal.brand_contact_email + '.');
    setTimeout(() => { const msg = document.getElementById('deal-detail-msg'); if (msg) msg.style.display = 'none'; }, 4000);
  } catch (err) {
    showDealModalMsg('error', 'Failed to send: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// =====================================================
// BRAND DEAL CRM - Invoice upload/view/remove + send to brand
// =====================================================
const DEAL_INVOICE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function renderInvoiceUI(deal) {
  const emptyEl = document.getElementById('deal-invoice-empty');
  const existingEl = document.getElementById('deal-invoice-existing');
  const linkedEl = document.getElementById('deal-invoice-linked');
  const sendRowEl = document.getElementById('deal-invoice-send-row');
  const fileInput = document.getElementById('deal-invoice-input');
  if (fileInput) fileInput.value = '';
  document.getElementById('deal-invoice-progress').style.display = 'none';
  if (linkedEl) linkedEl.style.display = 'none';

  // State: a Ryxa invoice is linked (takes precedence; one-or-the-other with an
  // uploaded PDF). Creator sees it and can view it; no send row (the invoice is
  // sent from the Invoicing tool itself).
  if (deal && deal.linked_invoice_id && linkedEl) {
    emptyEl.style.display = 'none';
    existingEl.style.display = 'none';
    sendRowEl.style.display = 'none';
    linkedEl.style.display = 'flex';
    var nameEl = document.getElementById('deal-invoice-linked-name');
    if (nameEl) nameEl.textContent = deal.linked_invoice_number
      ? ('Invoice #' + deal.linked_invoice_number)
      : 'Invoice';
    return;
  }

  if (deal && deal.invoice_file_path) {
    emptyEl.style.display = 'none';
    existingEl.style.display = 'flex';
    document.getElementById('deal-invoice-filename').textContent = deal.invoice_file_name || 'invoice.pdf';
    // Status text reflects whether it's been sent
    const statusEl = document.getElementById('deal-invoice-status');
    const sendStatusEl = document.getElementById('deal-invoice-send-status');
    const sendBtn = document.getElementById('deal-invoice-send-btn');

    // Gate: brand must have logged into portal before invoice can be sent
    const isShared = deal.share_token && !deal.share_revoked_at;
    const brandHasAccessed = !!deal.brand_first_accessed_at;
    const canSend = isShared && brandHasAccessed;

    if (deal.invoice_sent_at) {
      const dt = new Date(deal.invoice_sent_at);
      const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      statusEl.textContent = `Sent to brand on ${dateStr}`;
      statusEl.style.color = '#86efac';
      sendStatusEl.innerHTML = `Invoice was sent to the brand on ${dateStr}. You can resend it if needed.`;
      sendBtn.textContent = 'Resend invoice';
    } else {
      statusEl.textContent = 'Invoice uploaded - not sent yet';
      statusEl.style.color = 'var(--muted)';
      if (!isShared) {
        sendStatusEl.innerHTML = '<strong class="mk-s-e0b980">Share this deal with the brand first</strong> to enable invoice sending.';
      } else if (!brandHasAccessed) {
        sendStatusEl.innerHTML = '<strong class="mk-s-e0b980">Sending unlocks once the brand opens the portal.</strong> Send them the link and PIN above.';
      } else {
        sendStatusEl.textContent = "Ready to send to the brand. They'll get an email with a link to view the invoice.";
      }
      sendBtn.textContent = 'Send invoice to brand';
    }

    // Disable + dim button if not allowed
    sendBtn.disabled = !canSend;
    sendBtn.style.opacity = canSend ? '1' : '0.45';
    sendBtn.style.cursor = canSend ? 'pointer' : 'not-allowed';

    sendRowEl.style.display = 'flex';
  } else {
    existingEl.style.display = 'none';
    emptyEl.style.display = 'block';
    sendRowEl.style.display = 'none';
  }
}

async function handleInvoiceFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showDealModalMsg('error', 'Please upload a PDF file.');
    event.target.value = '';
    return;
  }
  if (file.size > DEAL_INVOICE_MAX_BYTES) {
    showDealModalMsg('error', 'File is too large. Maximum size is 10MB.');
    event.target.value = '';
    return;
  }

  // Auto-save as draft if needed
  if (!currentDealId) {
    const autoSaved = await autoSaveDraftForContract();
    if (!autoSaved) {
      event.target.value = '';
      return;
    }
  }

  const progressEl = document.getElementById('deal-invoice-progress');
  progressEl.style.display = 'block';
  progressEl.textContent = 'Uploading...';

  // Store invoices in same bucket, separate path: {user_id}/{deal_id}_invoice.pdf
  const storagePath = `${currentUser.id}/${currentDealId}_invoice.pdf`;

  const { error: uploadError } = await sb.storage
    .from('deal-contracts')
    .upload(storagePath, file, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (uploadError) {
    progressEl.style.display = 'none';
    showDealModalMsg('error', 'Upload failed: ' + uploadError.message);
    event.target.value = '';
    return;
  }

  // If replacing, the new file invalidates the prior "sent" state
  // Reset invoice_sent_at so user can re-send the new version
  const { error: updateError } = await sb
    .from('brand_deals')
    .update({
      invoice_file_path: storagePath,
      invoice_file_name: file.name,
      invoice_sent_at: null
    })
    .eq('id', currentDealId);

  if (updateError) {
    progressEl.style.display = 'none';
    showDealModalMsg('error', 'Upload succeeded but saving failed: ' + updateError.message);
    return;
  }

  const dealIdx = dealsList.findIndex(d => d.id === currentDealId);
  if (dealIdx >= 0) {
    dealsList[dealIdx].invoice_file_path = storagePath;
    dealsList[dealIdx].invoice_file_name = file.name;
    dealsList[dealIdx].invoice_sent_at = null;
  }
  progressEl.style.display = 'none';
  renderInvoiceUI(dealsList[dealIdx]);
  showDealModalMsg('success', 'Invoice uploaded. Click "Send invoice to brand" to email it.');
  setTimeout(() => {
    const msg = document.getElementById('deal-detail-msg');
    if (msg) msg.style.display = 'none';
  }, 4000);
}

async function viewInvoice() {
  if (!currentDealId) return;
  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal || !deal.invoice_file_path) return;

  const { data, error } = await sb.storage.from('deal-contracts').createSignedUrl(deal.invoice_file_path, 3600);
  if (error || !data?.signedUrl) {
    showDealModalMsg('error', 'Could not download invoice: ' + (error?.message || 'unknown error'));
    return;
  }
  try {
    await downloadFileFromUrl(data.signedUrl, deal.invoice_file_name || 'invoice.pdf');
  } catch (e) {
    showDealModalMsg('error', 'Could not download invoice: ' + (e.message || 'unknown error'));
  }
}

async function removeInvoice() {
  if (!currentDealId) return;
  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal || !deal.invoice_file_path) return;

  if (!(await dashConfirm('Remove the uploaded invoice? This cannot be undone.'))) return;

  const path = deal.invoice_file_path;
  const { error: storageErr } = await sb.storage.from('deal-contracts').remove([path]);
  if (storageErr) console.warn('Storage delete warning:', storageErr);

  const { error } = await sb
    .from('brand_deals')
    .update({ invoice_file_path: null, invoice_file_name: null, invoice_sent_at: null })
    .eq('id', currentDealId);

  if (error) {
    showDealModalMsg('error', 'Failed to remove: ' + error.message);
    return;
  }

  const dealIdx = dealsList.findIndex(d => d.id === currentDealId);
  if (dealIdx >= 0) {
    dealsList[dealIdx].invoice_file_path = null;
    dealsList[dealIdx].invoice_file_name = null;
    dealsList[dealIdx].invoice_sent_at = null;
  }
  renderInvoiceUI(dealsList[dealIdx]);
}

// ---- Link a Ryxa invoice to this deal ----

let linkInvoicePage = 0;
const LINK_INVOICE_PAGE_SIZE = 10;
let linkInvoiceHasNext = false;

async function openLinkInvoiceModal() {
  if (!currentDealId) {
    showDealModalMsg('error', 'Save the deal first, then link an invoice.');
    return;
  }
  const modal = document.getElementById('deal-link-invoice-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  linkInvoicePage = 0;
  loadLinkInvoicePage();
}

async function loadLinkInvoicePage() {
  const loading = document.getElementById('deal-link-invoice-loading');
  const listEl = document.getElementById('deal-link-invoice-list');
  const emptyEl = document.getElementById('deal-link-invoice-empty');
  const errEl = document.getElementById('deal-link-invoice-error');
  const pagerEl = document.getElementById('deal-link-invoice-pager');
  loading.style.display = 'block';
  listEl.style.display = 'none';
  emptyEl.style.display = 'none';
  errEl.style.display = 'none';
  if (pagerEl) pagerEl.style.display = 'none';
  listEl.innerHTML = '';

  try {
    const user = (await sb.auth.getUser()).data.user;
    if (!user) throw new Error('Not signed in');
    // Fetch this page plus one extra row to detect whether a next page exists.
    const from = linkInvoicePage * LINK_INVOICE_PAGE_SIZE;
    const to = from + LINK_INVOICE_PAGE_SIZE; // inclusive -> PAGE_SIZE + 1 rows
    const { data, error } = await sb
      .from('invoices')
      .select('id, public_id, status, to_name, invoice_number, total_cents, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    loading.style.display = 'none';
    const rows = data || [];
    linkInvoiceHasNext = rows.length > LINK_INVOICE_PAGE_SIZE;
    const pageRows = linkInvoiceHasNext ? rows.slice(0, LINK_INVOICE_PAGE_SIZE) : rows;
    // If a non-first page came back empty (e.g. invoices deleted), step back.
    if (pageRows.length === 0 && linkInvoicePage > 0) {
      linkInvoicePage--;
      return loadLinkInvoicePage();
    }
    if (pageRows.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    listEl.innerHTML = pageRows.map(function (inv) {
      const name = escapeHtmlDeal(inv.to_name || 'Untitled invoice');
      const num = inv.invoice_number ? escapeHtmlDeal(inv.invoice_number) : '';
      const amt = formatMoney(inv.total_cents || 0, { alwaysShowCents: true });
      const badgeColor = inv.status === 'paid' ? '#4ade80' : inv.status === 'pending' ? '#fbbf24' : '#7a788f';
      const badgeText = inv.status === 'paid' ? 'Paid' : inv.status === 'pending' ? 'Pending' : 'Draft';
      return '<button type="button" data-deal-action="pick-invoice" data-invoice-id="' + inv.id
        + '" data-invoice-public="' + (inv.public_id || '')
        + '" data-invoice-number="' + (inv.invoice_number ? escapeHtmlDeal(inv.invoice_number) : '')
        + '" data-invoice-name="' + name
        + '" style="width:100%;display:flex;align-items:center;gap:12px;padding:12px 14px;margin-bottom:8px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;cursor:pointer;text-align:left;font-family:DM Sans,sans-serif;">'
        + '<div style="flex:1;min-width:0;"><div style="color:var(--text);font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + name + '</div>'
        + '<div style="color:var(--muted);font-size:12px;margin-top:2px;">' + (num ? num + ' &middot; ' : '') + amt + '</div></div>'
        + '<span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:' + badgeColor + ';white-space:nowrap;">' + badgeText + '</span>'
        + '</button>';
    }).join('');
    listEl.style.display = 'block';
    // Pager: show only if there's more than one page in play.
    if (pagerEl) {
      const showPager = linkInvoicePage > 0 || linkInvoiceHasNext;
      pagerEl.style.display = showPager ? 'flex' : 'none';
      const prevBtn = document.getElementById('deal-link-invoice-prev');
      const nextBtn = document.getElementById('deal-link-invoice-next');
      const infoEl = document.getElementById('deal-link-invoice-pageinfo');
      if (prevBtn) prevBtn.disabled = linkInvoicePage === 0;
      if (nextBtn) nextBtn.disabled = !linkInvoiceHasNext;
      if (infoEl) {
        const start = linkInvoicePage * LINK_INVOICE_PAGE_SIZE + 1;
        const end = linkInvoicePage * LINK_INVOICE_PAGE_SIZE + pageRows.length;
        infoEl.textContent = start + '\u2013' + end;
      }
    }
  } catch (e) {
    loading.style.display = 'none';
    errEl.textContent = 'Could not load your invoices. Please try again.';
    errEl.style.display = 'block';
    console.error('Link invoice load failed:', e);
  }
}

function closeLinkInvoiceModal() {
  const modal = document.getElementById('deal-link-invoice-modal');
  if (modal) modal.style.display = 'none';
}

// Minimal HTML escaper (deals.js scope) for invoice names in the modal.
function escapeHtmlDeal(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

async function pickInvoiceToLink(el) {
  if (!currentDealId || !el) return;
  const invoiceId = el.getAttribute('data-invoice-id');
  const publicId = el.getAttribute('data-invoice-public');
  const invNumber = el.getAttribute('data-invoice-number') || null;
  if (!invoiceId) return;
  try {
    // Linking replaces any uploaded PDF (one-or-the-other). Clear the PDF fields.
    const { error } = await sb.from('brand_deals').update({
      linked_invoice_id: invoiceId,
      linked_invoice_public_id: publicId || null,
      linked_invoice_number: invNumber,
      invoice_file_path: null,
      invoice_file_name: null,
      invoice_sent_at: null
    }).eq('id', currentDealId);
    if (error) throw error;
    const idx = dealsList.findIndex(d => d.id === currentDealId);
    if (idx >= 0) {
      dealsList[idx].linked_invoice_id = invoiceId;
      dealsList[idx].linked_invoice_public_id = publicId || null;
      dealsList[idx].linked_invoice_number = invNumber;
      dealsList[idx].invoice_file_path = null;
      dealsList[idx].invoice_file_name = null;
      dealsList[idx].invoice_sent_at = null;
    }
    closeLinkInvoiceModal();
    renderInvoiceUI(dealsList[idx]);
    showDealModalMsg('success', 'Invoice linked to this deal.');
  } catch (e) {
    const errEl = document.getElementById('deal-link-invoice-error');
    if (errEl) { errEl.textContent = 'Could not link that invoice. Please try again.'; errEl.style.display = 'block'; }
    console.error('Link invoice failed:', e);
  }
}

async function unlinkInvoice() {
  if (!currentDealId) return;
  if (!(await dashConfirm('Unlink this invoice from the deal? The invoice itself is not deleted.'))) return;
  try {
    const { error } = await sb.from('brand_deals').update({
      linked_invoice_id: null,
      linked_invoice_public_id: null,
      linked_invoice_number: null
    }).eq('id', currentDealId);
    if (error) throw error;
    const idx = dealsList.findIndex(d => d.id === currentDealId);
    if (idx >= 0) {
      dealsList[idx].linked_invoice_id = null;
      dealsList[idx].linked_invoice_public_id = null;
      dealsList[idx].linked_invoice_number = null;
    }
    renderInvoiceUI(dealsList[idx]);
  } catch (e) {
    showDealModalMsg('error', 'Could not unlink: ' + (e.message || 'unknown error'));
  }
}

function viewLinkedInvoice() {
  if (!currentDealId) return;
  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal || !deal.linked_invoice_public_id) return;
  window.open('/invoice/' + deal.linked_invoice_public_id, '_blank');
}

function createNewInvoiceFromDeal() {
  closeLinkInvoiceModal();
  // Jump to the Invoicing tool, then open a fresh new-invoice editor.
  if (typeof showTool === 'function') showTool('invoice');
  else window.location.hash = 'invoice';
  // openInvoiceEditor(null) puts the tool straight into a blank new invoice.
  if (typeof openInvoiceEditor === 'function') {
    setTimeout(function () { openInvoiceEditor(null); }, 60);
  }
}

async function sendInvoiceToBrand() {
  if (!currentDealId) return;
  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal || !deal.invoice_file_path) {
    showDealModalMsg('error', 'Upload an invoice file first.');
    return;
  }
  if (!deal.brand_contact_email) {
    showDealModalMsg('error', 'Add a brand contact email to the deal first.');
    document.getElementById('deal-brand-contact-email').focus();
    return;
  }

  // Need an active share token for the portal link in the email
  if (!deal.share_token || deal.share_revoked_at) {
    showDealModalMsg('error', 'Click "Share with brand" first to enable the brand portal link.');
    return;
  }

  // Gate: brand must have logged into the portal once before invoices can be sent
  if (!deal.brand_first_accessed_at) {
    showDealModalMsg('error', 'Sending unlocks once the brand opens the portal with the PIN.');
    return;
  }

  const isResend = !!deal.invoice_sent_at;
  const confirmMsg = isResend
    ? `Resend the invoice email to ${deal.brand_contact_email}?`
    : `Send the invoice to ${deal.brand_contact_email}?`;
  if (!(await dashConfirm(confirmMsg))) return;

  const btn = document.getElementById('deal-invoice-send-btn');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    // Call edge function
    const { data, error } = await sb.functions.invoke('send-deal-notification', {
      body: {
        type: 'invoice_uploaded',
        deal_id: currentDealId
      }
    });

    if (error) throw new Error(error.message || 'Failed to send');
    if (data && data.error) throw new Error(data.error);

    // Mark invoice as sent in DB
    const { error: markErr } = await sb.rpc('mark_invoice_sent', { p_deal_id: currentDealId });
    if (markErr) console.warn('mark_invoice_sent failed:', markErr);

    // Update local cache
    const dealIdx = dealsList.findIndex(d => d.id === currentDealId);
    if (dealIdx >= 0) {
      dealsList[dealIdx].invoice_sent_at = new Date().toISOString();
    }
    renderInvoiceUI(dealsList[dealIdx]);
    showDealModalMsg('success', `Invoice email sent to ${deal.brand_contact_email}.`);
    setTimeout(() => {
      const msg = document.getElementById('deal-detail-msg');
      if (msg) msg.style.display = 'none';
    }, 4000);
  } catch (err) {
    showDealModalMsg('error', 'Failed to send invoice: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// =====================================================
// BRAND DEAL CRM - Notifications (background, fire-and-forget)
// =====================================================
function notifyBrandOfCreatorMessage(dealId, messagePreview) {
  // Fire-and-forget - we don't block the UI on this
  sb.functions.invoke('send-deal-notification', {
    body: {
      type: 'creator_message_to_brand',
      deal_id: dealId,
      message_preview: messagePreview
    }
  }).catch(err => console.warn('Notification failed (non-fatal):', err));
}

function notifyCreatorOfBrandMessage(dealId, messagePreview) {
  sb.functions.invoke('send-deal-notification', {
    body: {
      type: 'brand_message_to_creator',
      deal_id: dealId,
      message_preview: messagePreview
    }
  }).catch(err => console.warn('Notification failed (non-fatal):', err));
}

// =====================================================
// BRAND DEAL CRM - Save
// =====================================================
async function saveDeal() {
  const title = document.getElementById('deal-title').value.trim();
  const brandName = document.getElementById('deal-brand-name').value.trim();
  const brandContactName = document.getElementById('deal-brand-contact-name').value.trim();
  const brandContactEmail = document.getElementById('deal-brand-contact-email').value.trim();
  const amountRaw = document.getElementById('deal-amount').value;
  const campaignStart = document.getElementById('deal-campaign-start').value || null;
  const campaignEnd = document.getElementById('deal-campaign-end').value || null;
  const status = document.getElementById('deal-status').value;
  const paymentStatus = document.getElementById('deal-payment-status').value;
  const paymentMethod = document.getElementById('deal-payment-method').value;
  const paymentDetails = document.getElementById('deal-payment-details').value.trim();
  const privateNotes = document.getElementById('deal-private-notes').value.trim();

  // Validation
  if (!title) return showDealModalMsg('error', 'Deal title is required.');
  if (!brandName) return showDealModalMsg('error', 'Brand name is required.');
  if (brandContactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brandContactEmail)) {
    return showDealModalMsg('error', 'Please enter a valid brand contact email.');
  }
  const amountCents = amountRaw ? Math.round(parseFloat(amountRaw) * 100) : 0;
  if (amountRaw && (isNaN(amountCents) || amountCents < 0)) {
    return showDealModalMsg('error', 'Please enter a valid amount.');
  }
  if (campaignStart && campaignEnd && campaignEnd < campaignStart) {
    return showDealModalMsg('error', 'Campaign end date cannot be before start date.');
  }

  const saveBtn = document.getElementById('deal-save-btn');
  const origBtnText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  const payload = {
    user_id: currentUser.id,
    deal_title: title,
    brand_name: brandName,
    brand_contact_name: brandContactName || null,
    brand_contact_email: brandContactEmail || null,
    deal_amount_cents: amountCents,
    campaign_start_date: campaignStart,
    campaign_end_date: campaignEnd,
    status,
    payment_status: paymentStatus,
    payment_method: paymentMethod || null,
    payment_details: paymentDetails || null,
    private_notes: privateNotes || null
  };

  let dealId = currentDealId;
  const wasNewDeal = !dealId;
  let insertedDealRow = null;
  if (dealId) {
    // Update
    // .select('id') so a zero-row update (RLS mismatch after an identity
    // change in another tab, or a deal deleted elsewhere) is a visible
    // failure rather than a silent "Saved!". Same pattern as every other tool.
    const updRes = await sb.from('brand_deals').update(payload).eq('id', dealId).select('id');
    if (updRes.error) {
      saveBtn.disabled = false; saveBtn.textContent = origBtnText;
      return showDealModalMsg('error', 'Failed to save: ' + updRes.error.message);
    }
    if (!updRes.data || updRes.data.length === 0) {
      saveBtn.disabled = false; saveBtn.textContent = origBtnText;
      return showDealModalMsg('error', 'Nothing was saved. You may have been signed out. Reload and try again.');
    }
  } else {
    // Insert
    const { data, error } = await sb.from('brand_deals').insert(payload).select().single();
    if (error) {
      saveBtn.disabled = false; saveBtn.textContent = origBtnText;
      return showDealModalMsg('error', 'Failed to create: ' + error.message);
    }
    dealId = data.id;
    currentDealId = dealId;
    insertedDealRow = data;
  }

  // Save deliverables. Full-replace semantics, but ordered so failure can
  // never destroy data: insert the new set FIRST, then delete only the old
  // rows. Insert failure leaves the old rows untouched; delete failure
  // leaves visible duplicates, which a retry cleans up. The old order
  // (delete first, insert after) silently lost all deliverables whenever
  // the insert failed, and wiped them whenever local state was stale.
  if (dealId) {
    if (!dealDeliverablesLoaded) {
      showDealModalMsg('error', 'Deal saved, but deliverables were NOT saved because they never finished loading. Reopen this deal and try again.');
    } else {
      const { data: oldRows, error: oldErr } = await sb
        .from('deal_deliverables').select('id').eq('deal_id', dealId);
      if (oldErr) {
        showDealModalMsg('error', 'Deal saved, but deliverables were NOT saved (could not read existing ones). Try saving again.');
      } else {
        const deliverablesToInsert = currentDealDeliverables
          .filter(d => (d.title || '').trim().length > 0)
          .map((d, i) => ({
            deal_id: dealId,
            user_id: currentUser.id,
            title: d.title.trim(),
            notes: (d.notes || '').trim() || null,
            submitted_url: (d.submitted_url || '').trim() || null,
            due_date: (d.due_date && d.due_date.length) ? d.due_date : null,
            sort_order: i
          }));
        let insertFailed = false;
        if (deliverablesToInsert.length > 0) {
          const { error: delivErr } = await sb.from('deal_deliverables').insert(deliverablesToInsert);
          if (delivErr) {
            insertFailed = true;
            console.error('Deliverables save failed:', delivErr);
            showDealModalMsg('error', 'Deal saved, but deliverable changes were NOT saved: ' + delivErr.message + '. Your previous deliverables are untouched.');
          }
        }
        if (!insertFailed) {
          const oldIds = (oldRows || []).map(function(r) { return r.id; });
          if (oldIds.length > 0) {
            const { error: delOldErr } = await sb.from('deal_deliverables').delete().in('id', oldIds);
            if (delOldErr) {
              console.error('Old deliverables cleanup failed:', delOldErr);
              showDealModalMsg('error', 'Deliverables saved, but old copies could not be removed and may appear duplicated. Save again to clean up.');
            }
          }
        }
      }
    }
  }

  saveBtn.disabled = false;
  saveBtn.textContent = origBtnText;

  // Update the list cache IN PLACE - no network round trip, and no loading
  // bar firing over a view the user is not looking at (the bar means "this
  // view is loading", not "a cache is refreshing somewhere"). We already
  // hold the fresh data: the payload for updates, the returned row for
  // inserts. Analytics cards refresh in the background, bar-free.
  const cacheIdx = dealsList.findIndex(function(d) { return d.id === dealId; });
  if (cacheIdx >= 0) {
    dealsList[cacheIdx] = Object.assign({}, dealsList[cacheIdx], payload);
  } else if (insertedDealRow) {
    dealsList.unshift(insertedDealRow);
  }
  renderDealsList();
  loadDealsAnalytics().catch(function(e) { console.error('loadDealsAnalytics', e); });

  // If this was a new deal, switch to "edit" mode in place (now currentDealId is set)
  if (wasNewDeal && dealId) {
    document.getElementById('deal-id').value = dealId;
    document.getElementById('deal-detail-title').textContent = 'Edit Brand Deal';
    document.getElementById('deal-delete-btn').style.display = 'inline-block';
  }

  // Refresh visibility states (Share button, Cancel→Return, email lock if shared)
  updateShareButtonVisibility();
  applyDealLockState();
  updateMessagesCardVisibility();

  // Sync calendar events for this deal
  if (dealId) {
    syncDealCalendarEvents(dealId, brandName, status, campaignStart, campaignEnd, currentDealDeliverables);
  }

  // Inline success message - stay on the detail view
  showDealModalMsg('success', 'Saved.');
}

// =====================================================
// CALENDAR SYNC FOR BRAND DEALS
// =====================================================
// Removes all existing calendar events for this deal, then creates fresh ones
// based on the current deal state. Called after saving or deleting a deal.
async function syncDealCalendarEvents(dealId, brandName, status, campaignStart, campaignEnd, deliverables) {
  if (!currentUser || !dealId) return;

  // Build an ISO timestamp that represents midnight LOCAL time on a given date
  // (not midnight UTC). This way the event displays on the correct date in the
  // user's timezone.
  function localMidnightToIso(ymd, hours, minutes) {
    if (!ymd) return null;
    var parts = ymd.split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2], hours || 0, minutes || 0, 0, 0);
    return d.toISOString();
  }

  try {
    // Always start clean: delete all existing calendar events linked to this deal
    await sb.from('calendar_events')
      .delete()
      .eq('creator_id', currentUser.id)
      .eq('event_type', 'brand_deal')
      .eq('source_id', dealId);

    // If deal is in a "dead" state, leave calendar empty
    var deadStatuses = ['cancelled', 'lost', 'rejected'];
    if (deadStatuses.indexOf((status || '').toLowerCase()) !== -1) return;

    var brand = (brandName || 'Brand Deal').trim();
    var userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    var eventsToInsert = [];

    // Campaign Start event (all-day: 12:00 AM to 11:59 PM local time)
    if (campaignStart) {
      eventsToInsert.push({
        creator_id: currentUser.id,
        title: brand + ' – Starts',
        start_at: localMidnightToIso(campaignStart, 0, 0),
        end_at: localMidnightToIso(campaignStart, 23, 59),
        event_type: 'brand_deal',
        source_id: dealId,
        color: '#a855f7',
        notes: 'Campaign start date for ' + brand,
        timezone: userTz
      });
    }

    // Campaign End event (all-day: 12:00 AM to 11:59 PM local time)
    if (campaignEnd) {
      eventsToInsert.push({
        creator_id: currentUser.id,
        title: brand + ' – Ends',
        start_at: localMidnightToIso(campaignEnd, 0, 0),
        end_at: localMidnightToIso(campaignEnd, 23, 59),
        event_type: 'brand_deal',
        source_id: dealId,
        color: '#a855f7',
        notes: 'Campaign end date for ' + brand,
        timezone: userTz
      });
    }

    // Deliverables with due dates
    if (Array.isArray(deliverables)) {
      deliverables.forEach(function(d) {
        if (d.due_date && d.due_date.length && (d.title || '').trim().length > 0) {
          eventsToInsert.push({
            creator_id: currentUser.id,
            title: brand + ' – ' + d.title.trim(),
            start_at: localMidnightToIso(d.due_date, 0, 0),
            end_at: localMidnightToIso(d.due_date, 23, 59),
            event_type: 'brand_deal',
            source_id: dealId,
            color: '#a855f7',
            notes: 'Deliverable due for ' + brand + (d.notes ? '\n\n' + d.notes : ''),
            timezone: userTz
          });
        }
      });
    }

    if (eventsToInsert.length > 0) {
      var { error: insErr } = await sb.from('calendar_events').insert(eventsToInsert);
      if (insErr) console.error('Failed to insert deal calendar events:', insErr);
    }

    // If user is currently viewing the calendar, refresh
    if (typeof calState !== 'undefined' && calState.loaded) {
      calState.loaded = false;
    }
  } catch (e) {
    console.error('syncDealCalendarEvents failed:', e);
  }
}

function showDealModalMsg(type, text) {
  // Render as a floating top-right toast instead of an inline banner. This
  // avoids the prior behavior where the banner sat far below the contract
  // uploader and triggered a smooth scroll to it on every success/error,
  // yanking the user away from what they were doing (e.g. signing a contract).
  // The inline banner element (#deal-detail-msg) is intentionally left in
  // place to keep the existing markup stable, but is no longer used here.
  // Unified into the shared slide-in toast; the custom implementation
  // below remains only as a fallback if the shell isn't loaded.
  if (typeof showDashToast === 'function') {
    showDashToast(type === 'error' ? 'error' : 'success', text);
    return;
  }
  var existing = document.getElementById('deal-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'deal-toast';
  var isError = type === 'error';
  toast.style.cssText = [
    'position:fixed',
    'top:20px',
    'right:20px',
    'z-index:10000',
    'max-width:380px',
    'padding:12px 16px',
    'border-radius:10px',
    'font-size:13px',
    'font-family:DM Sans,sans-serif',
    'line-height:1.4',
    'box-shadow:0 8px 24px rgba(0,0,0,0.3)',
    'backdrop-filter:blur(10px)',
    'opacity:0',
    'transform:translateY(-10px)',
    'transition:opacity 0.2s ease,transform 0.2s ease',
    isError
      ? 'background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);color:#fca5a5'
      : 'background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.4);color:#86efac'
  ].join(';');
  toast.textContent = text;
  document.body.appendChild(toast);
  // Force a reflow so the transition runs from the initial opacity:0
  void toast.offsetWidth;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  // Auto-dismiss after 3.5s (errors get a bit longer so users can read them)
  var dismissMs = isError ? 5000 : 3500;
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 250);
  }, dismissMs);
}

// =====================================================
// BRAND DEAL CRM - Delete
// =====================================================
function promptDeleteDeal() {
  if (!currentDealId) return;
  document.getElementById('deal-delete-confirm-input').value = '';
  document.getElementById('deal-delete-confirm-btn').disabled = true;
  document.getElementById('deal-delete-confirm-btn').style.cursor = 'not-allowed';
  document.getElementById('deal-delete-confirm-btn').style.color = 'rgba(252,165,165,0.5)';
  document.getElementById('deal-delete-modal').style.display = 'flex';
}

function closeDealDeleteModal() {
  document.getElementById('deal-delete-modal').style.display = 'none';
}

function updateDealDeleteButton() {
  const input = document.getElementById('deal-delete-confirm-input').value;
  const btn = document.getElementById('deal-delete-confirm-btn');
  if (input === 'DELETE') {
    btn.disabled = false;
    btn.style.cursor = 'pointer';
    btn.style.color = '#fca5a5';
    btn.style.background = 'rgba(239,68,68,0.15)';
  } else {
    btn.disabled = true;
    btn.style.cursor = 'not-allowed';
    btn.style.color = 'rgba(252,165,165,0.5)';
  }
}

async function confirmDeleteDeal() {
  if (!currentDealId) return;
  const btn = document.getElementById('deal-delete-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  // Clean up storage files before deleting the deal row
  const deal = dealsList.find(d => d.id === currentDealId);
  if (deal) {
    const filesToRemove = [];
    if (deal.contract_file_path) filesToRemove.push(deal.contract_file_path);
    if (deal.invoice_file_path) filesToRemove.push(deal.invoice_file_path);
    if (filesToRemove.length > 0) {
      const { error: storageErr } = await sb.storage.from('deal-contracts').remove(filesToRemove);
      if (storageErr) console.warn('Storage cleanup warning:', storageErr);
    }
  }

  // Capture deal id before delete so we can clean up calendar events
  var deletedDealId = currentDealId;

  const { error } = await sb.from('brand_deals').delete().eq('id', currentDealId);
  btn.textContent = 'Delete forever';
  if (error) {
    showModalAlert('Delete failed', 'Failed to delete: ' + error.message);
    return;
  }

  // Clean up associated calendar events
  if (deletedDealId) {
    try {
      await sb.from('calendar_events')
        .delete()
        .eq('creator_id', currentUser.id)
        .eq('event_type', 'brand_deal')
        .eq('source_id', deletedDealId);
      if (typeof calState !== 'undefined') calState.loaded = false;
    } catch (e) { console.error('Calendar cleanup failed:', e); }
  }

  closeDealDeleteModal();
  await loadDealsList();
  showDealsList();
}

// =====================================================
// BRAND DEAL CRM - Share with Brand
// =====================================================

// Show or hide the "Share with brand" button based on whether deal is saved + has brand contact
function updateShareButtonVisibility() {
  const btn = document.getElementById('deal-share-btn');
  if (!btn) return;

  // New/unsaved deal, or deal not found: hide the top share button (sharing
  // requires a saved deal).
  if (!currentDealId) { btn.style.display = 'none'; return; }
  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal) { btn.style.display = 'none'; return; }

  // Cancelled deals can't be shared (sharing is auto-revoked).
  if (deal.status === 'cancelled') { btn.style.display = 'none'; return; }

  // Saved, shareable deal: show it.
  btn.style.display = 'inline-flex';
}

async function openShareModal() {
  if (!currentDealId) return;
  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal) return;

  // Validate - must have brand contact email
  if (!deal.brand_contact_email) {
    showDealModalMsg('error', 'Please add a brand contact email to the deal before sharing.');
    document.getElementById('deal-brand-contact-email').focus();
    return;
  }

  // If deal already has an active, non-revoked share - skip confirm and open directly
  const needsNewToken = !deal.share_token || !deal.share_pin || deal.share_revoked_at;
  if (!needsNewToken) {
    proceedOpenShareModal();
    return;
  }

  // First-time share - show styled confirm modal
  document.getElementById('deal-share-confirm-email').textContent = deal.brand_contact_email;
  document.getElementById('deal-share-confirm-modal').style.display = 'flex';
}

function closeShareConfirmModal() {
  document.getElementById('deal-share-confirm-modal').style.display = 'none';
}

async function confirmShareGenerate() {
  closeShareConfirmModal();
  await proceedOpenShareModal();
}

async function proceedOpenShareModal() {
  if (!currentDealId) return;
  const deal = dealsList.find(d => d.id === currentDealId);
  if (!deal) return;

  // Set up modal
  document.getElementById('deal-share-brand-name').textContent = deal.brand_name || 'the brand';
  document.getElementById('deal-share-generating').style.display = 'block';
  document.getElementById('deal-share-content').style.display = 'none';
  document.getElementById('deal-share-error').style.display = 'none';
  document.getElementById('deal-share-modal').style.display = 'flex';

  let token = deal.share_token;
  let pin = deal.share_pin;
  const needsNewToken = !token || !pin || deal.share_revoked_at;

  if (needsNewToken) {
    const { data, error } = await sb.rpc('generate_deal_share_token', { p_deal_id: currentDealId });
    if (error || !data || data.error) {
      document.getElementById('deal-share-generating').style.display = 'none';
      const errEl = document.getElementById('deal-share-error');
      errEl.style.display = 'block';
      errEl.textContent = (data && data.error) || (error && error.message) || 'Failed to generate share link';
      return;
    }
    token = data.token;
    pin = data.pin;
    const idx = dealsList.findIndex(d => d.id === currentDealId);
    if (idx >= 0) {
      dealsList[idx].share_token = token;
      dealsList[idx].share_pin = pin;
      dealsList[idx].share_revoked_at = null;
    }
    updateMessagesCardVisibility();
    applyDealLockState();
  }

  // Populate fields
  const link = `${window.location.origin}/deal/${token}`;
  document.getElementById('deal-share-link').value = link;
  document.getElementById('deal-share-pin').value = pin;

  const message = `Hi, I've created a secure portal for our brand deal on Ryxa. You can view the deal details and communicate with me through it. ${link} (PIN: ${pin})`;
  document.getElementById('deal-share-message').value = message;

  // Reset copy button labels
  document.getElementById('deal-share-link-copy').textContent = 'Copy';
  document.getElementById('deal-share-pin-copy').textContent = 'Copy';
  document.getElementById('deal-share-copy-all-btn').textContent = 'Copy link + message';

  document.getElementById('deal-share-generating').style.display = 'none';
  document.getElementById('deal-share-content').style.display = 'block';
}

function closeShareModal() {
  document.getElementById('deal-share-modal').style.display = 'none';
}

// Generic clipboard copy with button feedback
async function _copyToClipboardWithFeedback(text, buttonId, originalLabel) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // Fallback: old-school select-and-copy
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(textarea);
  }
  const btn = document.getElementById(buttonId);
  if (btn) {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = originalLabel; }, 1800);
  }
}

function copyShareLink() {
  const link = document.getElementById('deal-share-link').value;
  _copyToClipboardWithFeedback(link, 'deal-share-link-copy', 'Copy');
}

function copySharePin() {
  const pin = document.getElementById('deal-share-pin').value;
  _copyToClipboardWithFeedback(pin, 'deal-share-pin-copy', 'Copy');
}

function copyShareMessage() {
  const msg = document.getElementById('deal-share-message').value;
  _copyToClipboardWithFeedback(msg, 'deal-share-copy-all-btn', 'Copy link + message');
}

async function revokeShareAccess() {
  if (!currentDealId) return;
  if (!(await dashConfirm('Revoke access to this deal? The brand will no longer be able to view it. You can share again later by clicking "Share with brand" again.'))) return;

  const { data, error } = await sb.rpc('revoke_deal_share_token', { p_deal_id: currentDealId });
  if (error || (data && data.error)) {
    const errEl = document.getElementById('deal-share-error');
    errEl.style.display = 'block';
    errEl.textContent = (data && data.error) || (error && error.message) || 'Failed to revoke access';
    return;
  }

  // Update local cache
  const idx = dealsList.findIndex(d => d.id === currentDealId);
  if (idx >= 0) {
    dealsList[idx].share_revoked_at = new Date().toISOString();
  }
  updateMessagesCardVisibility();

  closeShareModal();
  showDealModalMsg('success', 'Access revoked. The brand can no longer view this deal.');
  setTimeout(() => {
    const msg = document.getElementById('deal-detail-msg');
    if (msg) msg.style.display = 'none';
  }, 3000);
}


// =============================================================================
// ACTION REGISTRATIONS - wired up below as part of Phase 2
// =============================================================================

// Top-level markup buttons
dealRegisterAction('max-upgrade', (e) => handleMaxUpgradeClick(e));
dealRegisterAction('toggle-pipeline-view', () => togglePipelineView());
dealRegisterAction('new-deal', () => showDealDetail(null));
dealRegisterAction('back-to-list', () => showDealsList());
dealRegisterAction('open-share', () => openShareModal());
dealRegisterAction('revert-to-active', () => revertDealToActive());
dealRegisterAction('save', () => saveDeal());
dealRegisterAction('delete', () => promptDeleteDeal());

// Status / badges
dealRegisterAction('status-change', () => handleDealStatusChange());
dealRegisterAction('update-badges', () => updateDealDetailBadges());

// Deal list / pipeline card click (template literal)
dealRegisterAction('show-detail', (e, el) => showDealDetail(el.dataset.dealId));
// Pipeline kanban move-status buttons (template literal - event.stopPropagation
// no longer needed since dispatcher finds the closest matching action element)
dealRegisterAction('move-status', (e, el) => {
  // Don't bubble to the card's show-detail action
  e.stopPropagation();
  if (el.disabled) return;
  moveDealStatus(el.dataset.dealId, el.dataset.dealStatus);
});

dealRegisterAction('terminal-status', (e, el) => {
  // Don't bubble to the card's show-detail action
  e.stopPropagation();
  promptTerminalStatus(el.dataset.dealId, el.dataset.dealStatus);
});

dealRegisterAction('list-filter', (e, el) => {
  const f = el.dataset.dealStatus;
  if (!f || f === dealsListFilter) return;
  dealsListFilter = f;
  document.querySelectorAll('#deals-filter-chips .deals-filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderDealsList();
});

// Deliverables (in editor modal)
dealRegisterAction('add-deliverable', () => addDeliverableRow());
dealRegisterAction('remove-deliverable', (e, el) => removeDeliverableRow(parseInt(el.dataset.dealI, 10)));
dealRegisterAction('collapse-deliverable', (e, el) => collapseDeliverable(parseInt(el.dataset.dealI, 10)));
dealRegisterAction('expand-deliverable', (e, el) => expandDeliverable(parseInt(el.dataset.dealI, 10)));
dealRegisterAction('update-deliverable', (e, el) => {
  updateDeliverableField(parseInt(el.dataset.dealI, 10), el.dataset.dealField, el.value);
});

// Contract section
dealRegisterAction('contract-selected', (e) => handleContractFileSelected(e));
dealRegisterAction('trigger-contract-upload', () => document.getElementById('deal-contract-input').click());
dealRegisterAction('view-contract', () => viewContract());
dealRegisterAction('remove-contract', () => removeContract());
dealRegisterAction('sign-contract', () => signContractAsCreator());
dealRegisterAction('mark-creator-signed', () => markContractCreatorSigned());
dealRegisterAction('send-contract-to-brand', () => sendContractToBrand());

// Invoice section
dealRegisterAction('invoice-selected', (e) => handleInvoiceFileSelected(e));
dealRegisterAction('trigger-invoice-upload', () => document.getElementById('deal-invoice-input').click());
dealRegisterAction('view-invoice', () => viewInvoice());
dealRegisterAction('remove-invoice', () => removeInvoice());
dealRegisterAction('send-invoice-to-brand', () => sendInvoiceToBrand());
dealRegisterAction('open-link-invoice', () => openLinkInvoiceModal());
dealRegisterAction('close-link-invoice-modal', () => closeLinkInvoiceModal());
dealRegisterAction('pick-invoice', (e, el) => pickInvoiceToLink(el));
dealRegisterAction('unlink-invoice', () => unlinkInvoice());
dealRegisterAction('view-linked-invoice', () => viewLinkedInvoice());
dealRegisterAction('create-new-invoice', () => createNewInvoiceFromDeal());
dealRegisterAction('link-invoice-prev', () => { if (linkInvoicePage > 0) { linkInvoicePage--; loadLinkInvoicePage(); } });
dealRegisterAction('link-invoice-next', () => { if (linkInvoiceHasNext) { linkInvoicePage++; loadLinkInvoicePage(); } });

// Messages thread
dealRegisterAction('refresh-messages', (e, el) => refreshMessagesWithFeedback(el));
dealRegisterAction('message-char-count', () => updateMessageCharCount());
dealRegisterAction('post-message', () => postCreatorMessage());

// Share modal (lives outside tool-deals in the markup, but is owned by the deals tool)
dealRegisterAction('close-share-modal', () => closeShareModal());
dealRegisterAction('select-input', (e, el) => el.select());
dealRegisterAction('copy-share-link', () => copyShareLink());
dealRegisterAction('copy-share-pin', () => copySharePin());
dealRegisterAction('copy-share-message', () => copyShareMessage());
dealRegisterAction('revoke-share-access', () => revokeShareAccess());

// Share confirm modal
dealRegisterAction('confirm-share-generate', () => confirmShareGenerate());
dealRegisterAction('close-share-confirm', () => closeShareConfirmModal());

// Delete deal modal
dealRegisterAction('update-delete-button', () => updateDealDeleteButton());
dealRegisterAction('confirm-delete-deal', () => confirmDeleteDeal());
dealRegisterAction('close-delete-modal', () => closeDealDeleteModal());

// =============================================================================
// PIPELINE (KANBAN) DRAG-AND-DROP
// -----------------------------------------------------------------------------
// Pipeline cards have data-deal-drag-card; column bodies have data-deal-drop-col
// with the column key as the value. We delegate from document so dynamically-
// rendered cards/columns (re-rendered on every pipeline change) work without
// per-element rewiring.
// =============================================================================
document.addEventListener('dragstart', function(e) {
  const card = e.target.closest('[data-deal-drag-card]');
  if (!card) return;
  onPipelineDragStart(e, card.dataset.dealId);
});
document.addEventListener('dragend', function(e) {
  const card = e.target.closest('[data-deal-drag-card]');
  if (!card) return;
  onPipelineDragEnd(e);
});
document.addEventListener('dragover', function(e) {
  const col = e.target.closest('[data-deal-drop-col]');
  if (!col) return;
  onPipelineDragOver(e, col);
});
document.addEventListener('dragleave', function(e) {
  const col = e.target.closest('[data-deal-drop-col]');
  if (!col) return;
  onPipelineDragLeave(e, col);
});
document.addEventListener('drop', function(e) {
  const col = e.target.closest('[data-deal-drop-col]');
  if (!col) return;
  onPipelineDrop(e, col.dataset.dealDropCol, col);
});

