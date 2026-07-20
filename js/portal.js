// =============================================================================
// /js/portal.js — Brand Deal Portal
// -----------------------------------------------------------------------------
// Extracted from inline <script> in portal/index.html as part of the May 11
// 2026 CSP refactor. Same delegation pattern as the dashboard tool extractions
// (see /js/dashboard-shell.js, /js/deals.js etc.):
//
//   • Markup uses data-portal-action="<action-name>" instead of inline onclick.
//   • Special-case handlers use data-portal-{input,change,keydown,dragstart}.
//   • Each handler is registered via portalRegisterAction(...) at the bottom
//     of this file and dispatched via a single document-level event listener.
//
// Why: strict CSP forbids inline event handlers (XSS hardening). After this
// refactor, portal/index.html has zero inline JS and can be served with the
// same script-src 'self' policy as the dashboard.
// =============================================================================

// ============================================================
// CONFIG
// ============================================================
const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});

// PIN security: 5 attempts → 15 min lockout, tracked client-side per token
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// State
let dealToken = null;
let dealPin = null;
let dealData = null;

// ============================================================
// HELPERS
// ============================================================
function showPortalToast(type, message) {
  const old = document.querySelector('.portal-toast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.className = 'portal-toast ' + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { requestAnimationFrame(() => { toast.classList.add('show'); }); });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.remove(); }, 300);
  }, 4000);
}

let _portalConfirmResolve = null;
function portalConfirm(msg) {
  return new Promise(function(resolve) {
    _portalConfirmResolve = resolve;
    document.getElementById('portal-confirm-msg').textContent = msg;
    document.getElementById('portal-confirm-modal').style.display = 'flex';
  });
}
function resolvePortalConfirm(val) {
  document.getElementById('portal-confirm-modal').style.display = 'none';
  if (_portalConfirmResolve) { _portalConfirmResolve(val); _portalConfirmResolve = null; }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatUSD(cents) {
  if (!cents) return '$0';
  return '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusLabel(s) {
  return ({
    draft: 'Draft',
    pending_contract: 'Pending Contract',
    active: 'Active',
    completed: 'Completed',
    cancelled: 'Cancelled'
  })[s] || s;
}

function paymentLabel(s) {
  return s === 'paid' ? 'Paid' : 'Waiting for Payment';
}

// ============================================================
// LOCKOUT
// ============================================================
function getLockoutKey() { return 'ryxa_portal_lockout_' + dealToken; }
function getAttemptsKey() { return 'ryxa_portal_attempts_' + dealToken; }

function isLockedOut() {
  if (!dealToken) return false;
  try {
    const until = parseInt(localStorage.getItem(getLockoutKey()) || '0', 10);
    return until > Date.now();
  } catch (e) { return false; }
}

function getLockoutTimeRemaining() {
  try {
    const until = parseInt(localStorage.getItem(getLockoutKey()) || '0', 10);
    return Math.max(0, until - Date.now());
  } catch (e) { return 0; }
}

function recordFailedAttempt() {
  try {
    const attempts = parseInt(localStorage.getItem(getAttemptsKey()) || '0', 10) + 1;
    localStorage.setItem(getAttemptsKey(), String(attempts));
    if (attempts >= MAX_PIN_ATTEMPTS) {
      localStorage.setItem(getLockoutKey(), String(Date.now() + LOCKOUT_MS));
    }
    return attempts;
  } catch (e) { return 0; }
}

function clearAttempts() {
  try {
    localStorage.removeItem(getAttemptsKey());
    localStorage.removeItem(getLockoutKey());
  } catch (e) {}
}

function formatLockoutMins(ms) {
  const mins = Math.ceil(ms / 60000);
  return mins === 1 ? '1 minute' : `${mins} minutes`;
}

// ============================================================
// PIN PERSISTENCE (sessionStorage — persists across refresh, not new tab)
// ============================================================
function getPinKey() { return 'ryxa_portal_pin_' + dealToken; }
function savePinToSession(pin) {
  try { sessionStorage.setItem(getPinKey(), pin); } catch (e) {}
}
function getPinFromSession() {
  try { return sessionStorage.getItem(getPinKey()); } catch (e) { return null; }
}
function clearPinFromSession() {
  try { sessionStorage.removeItem(getPinKey()); } catch (e) {}
}

// ============================================================
// LOAD DEAL VIA RPC
// ============================================================
async function loadDeal() {
  const { data, error } = await sb.rpc('get_deal_by_token', { p_token: dealToken, p_pin: dealPin });
  if (error) {
    return { ok: false, message: error.message || 'Network error' };
  }
  if (data && data.error) {
    return { ok: false, message: data.error };
  }
  return { ok: true, data };
}

// ============================================================
// RENDER PORTAL
// ============================================================
function renderPortal() {
  const deal = dealData.deal;
  document.getElementById('portal-creator-name').textContent = deal.creator_display || 'Creator';
  document.getElementById('portal-deal-title').textContent = deal.deal_title;
  document.getElementById('portal-brand-name').textContent = 'For ' + deal.brand_name;

  const statusBadge = document.getElementById('portal-status-badge');
  statusBadge.textContent = statusLabel(deal.status);
  statusBadge.className = 'badge badge-status-' + deal.status;

  const payBadge = document.getElementById('portal-payment-badge');
  payBadge.textContent = paymentLabel(deal.payment_status);
  payBadge.className = 'badge badge-payment-' + deal.payment_status;

  document.getElementById('portal-amount').textContent = formatUSD(deal.deal_amount_cents);
  document.getElementById('portal-contact-name').textContent = deal.brand_contact_name || '—';
  document.getElementById('portal-start-date').textContent = formatDate(deal.campaign_start_date);
  document.getElementById('portal-end-date').textContent = formatDate(deal.campaign_end_date);

  const methodLabels = { ryxa_invoicing: 'Ryxa Invoicing', ach: 'ACH / Bank Transfer', venmo: 'Venmo', paypal: 'PayPal', zelle: 'Zelle', cashapp: 'Cash App', wire: 'Wire Transfer', check: 'Check', crypto: 'Crypto', other: 'Other' };
  document.getElementById('portal-payment-method').textContent = methodLabels[deal.payment_method] || '—';
  document.getElementById('portal-payment-details').textContent = deal.payment_details || '—';

  // Deliverables
  renderDeliverables(dealData.deliverables || []);

  // Contract
  if (deal.contract_file_path) {
    document.getElementById('portal-contract-card').style.display = 'block';
    document.getElementById('portal-contract-filename').textContent = deal.contract_file_name || 'contract.pdf';
    renderPortalContractStatus(deal);
  } else {
    document.getElementById('portal-contract-card').style.display = 'none';
  }

  // Invoice: either a linked Ryxa invoice (View opens its public page) or an
  // uploaded PDF (Download). One or the other.
  var invCard = document.getElementById('portal-invoice-card');
  var invDlBtn = document.getElementById('portal-invoice-dl-btn');
  var invViewBtn = document.getElementById('portal-invoice-view-btn');
  if (deal.linked_invoice_public_id) {
    invCard.style.display = 'block';
    document.getElementById('portal-invoice-filename').textContent =
      deal.linked_invoice_number ? ('Invoice #' + deal.linked_invoice_number) : 'Invoice';
    if (invDlBtn) invDlBtn.style.display = 'none';
    if (invViewBtn) {
      invViewBtn.style.display = '';
      invViewBtn.setAttribute('data-invoice-public', deal.linked_invoice_public_id);
    }
  } else if (deal.invoice_file_path) {
    invCard.style.display = 'block';
    document.getElementById('portal-invoice-filename').textContent = deal.invoice_file_name || 'invoice.pdf';
    if (invDlBtn) invDlBtn.style.display = '';
    if (invViewBtn) invViewBtn.style.display = 'none';
  } else {
    invCard.style.display = 'none';
  }

  // Messages
  renderMessages(dealData.messages || []);

  // Show
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('pin-screen').style.display = 'none';
  document.getElementById('portal-main').style.display = 'block';
}

function renderDeliverables(items) {
  const listEl = document.getElementById('portal-deliverables-list');
  const emptyEl = document.getElementById('portal-deliverables-empty');
  if (items.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = items.map(d => {
    const url = (d.submitted_url || '').trim();
    const safeUrl = escapeHtml(url);
    const urlDisplay = url.length > 60 ? url.slice(0, 57) + '…' : url;
    return `
      <div class="deliv-card">
        <div class="deliv-title">${escapeHtml(d.title) || '<span style="color:var(--muted);font-style:italic;">Untitled</span>'}</div>
        ${d.notes ? `<div class="deliv-notes">${escapeHtml(d.notes)}</div>` : ''}
        ${url ? `<a class="deliv-url" href="${safeUrl}" target="_blank" rel="noopener noreferrer">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          ${escapeHtml(urlDisplay)}
        </a>` : ''}
      </div>
    `;
  }).join('');
}

function renderMessages(messages) {
  const threadEl = document.getElementById('portal-messages-thread');
  const emptyEl = document.getElementById('portal-messages-empty');
  if (messages.length === 0) {
    threadEl.innerHTML = '';
    threadEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  threadEl.style.display = 'flex';
  threadEl.innerHTML = messages.map(m => {
    const isBrand = m.author_type === 'brand';
    const dt = new Date(m.created_at);
    const timeStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const authorLabel = isBrand ? 'You' : escapeHtml(m.author_name || 'Creator');
    return `
      <div class="msg-bubble-wrap ${isBrand ? 'brand' : 'creator'}">
        <div class="msg-bubble ${isBrand ? 'brand' : 'creator'}">
          <div class="msg-meta">
            <div class="msg-author ${isBrand ? 'brand' : 'creator'}">${authorLabel}</div>
            <div class="msg-time">${timeStr}</div>
          </div>
          <div class="msg-content">${escapeHtml(m.content)}</div>
        </div>
      </div>
    `;
  }).join('');
  setTimeout(() => { threadEl.scrollTop = threadEl.scrollHeight; }, 50);
}

// ============================================================
// REFRESH MESSAGES (via re-fetching whole deal)
// ============================================================
async function refreshMessages(btn) {
  if (!btn) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.7s linear infinite;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refreshing`;

  const result = await loadDeal();
  if (result.ok) {
    dealData = result.data;
    renderMessages(dealData.messages || []);
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> <span style="color:#4ade80;">Updated</span>`;
  } else {
    btn.innerHTML = `<span style="color:#fca5a5;">Failed</span>`;
  }
  setTimeout(() => {
    btn.innerHTML = original;
    btn.disabled = false;
    btn.style.opacity = '';
  }, 1200);
}

// ============================================================
// FILE DOWNLOAD (calls deal-file-url edge function)
// ============================================================
async function downloadDealFile(fileType, btn) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    const { data, error } = await sb.functions.invoke('deal-file-url', {
      body: { token: dealToken, pin: dealPin, file_type: fileType }
    });

    if (error) throw new Error(error.message || 'Failed to load download');
    if (data && data.error) throw new Error(data.error);
    if (!data || !data.url) throw new Error('No download URL returned');

    // Trigger download by opening in new tab (the URL has Content-Disposition: attachment)
    window.open(data.url, '_blank', 'noopener,noreferrer');
    btn.textContent = 'Downloaded';
  } catch (err) {
    console.error('Download failed', err);
    btn.textContent = 'Failed';
    showPortalToast('error', 'Could not download file: ' + err.message);
  } finally {
    setTimeout(() => {
      btn.textContent = orig;
      btn.disabled = false;
    }, 1500);
  }
}

// ============================================================
// SEND MESSAGE
// ============================================================
function updateMsgCharCount() {
  const input = document.getElementById('msg-input');
  const countEl = document.getElementById('msg-char');
  const len = (input.value || '').length;
  countEl.textContent = `${len} / 5000`;
  countEl.style.color = len > 4900 ? '#fca5a5' : 'var(--muted)';
}

async function sendMessage() {
  const input = document.getElementById('msg-input');
  const content = (input.value || '').trim();
  const errEl = document.getElementById('msg-error');
  errEl.style.display = 'none';

  if (!content) {
    input.focus();
    return;
  }
  if (content.length > 5000) {
    errEl.textContent = 'Message too long (max 5000 characters).';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('msg-send');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const { data, error } = await sb.rpc('post_brand_message', {
    p_token: dealToken,
    p_pin: dealPin,
    p_content: content
  });

  btn.disabled = false;
  btn.textContent = 'Send';

  if (error) {
    errEl.textContent = error.message || 'Failed to send message.';
    errEl.style.display = 'block';
    return;
  }
  if (data && data.error) {
    errEl.textContent = data.error;
    errEl.style.display = 'block';
    return;
  }

  // Clear input and refresh thread
  input.value = '';
  updateMsgCharCount();

  // Fire-and-forget creator notification (smart batching enforced server-side)
  const preview = content.length > 200 ? content.slice(0, 200) + '…' : content;
  sb.functions.invoke('send-deal-notification', {
    body: {
      type: 'brand_message_to_creator',
      deal_id: dealData.deal.id,
      message_preview: preview,
      share_token: dealToken,
      share_pin: dealPin
    }
  }).catch(err => console.warn('Notification failed (non-fatal):', err));

  // Re-fetch full deal to get the latest message list
  const result = await loadDeal();
  if (result.ok) {
    dealData = result.data;
    renderMessages(dealData.messages || []);
  }
}

// ============================================================
// PIN ENTRY FLOW
// ============================================================
async function attemptUnlock(pin) {
  if (isLockedOut()) {
    showLockoutMessage();
    return;
  }
  const submitBtn = document.getElementById('pin-submit');
  const errEl = document.getElementById('pin-error');
  const infoEl = document.getElementById('pin-info');
  errEl.style.display = 'none';
  infoEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Verifying...';

  dealPin = pin;
  const result = await loadDeal();

  submitBtn.disabled = false;
  submitBtn.textContent = 'Unlock portal';

  if (!result.ok) {
    if (result.message && (result.message.toLowerCase().includes('revoked') || result.message.toLowerCase().includes('access'))) {
      // Revoked deals are a permanent error — show full screen
      showFullError('Access Revoked', result.message);
      return;
    }
    // Wrong PIN or invalid token
    const attempts = recordFailedAttempt();
    const remaining = MAX_PIN_ATTEMPTS - attempts;
    if (remaining <= 0) {
      showLockoutMessage();
    } else {
      errEl.textContent = `${result.message}. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`;
      errEl.style.display = 'block';
    }
    dealPin = null;
    return;
  }

  // Success
  clearAttempts();
  savePinToSession(pin);
  dealData = result.data;
  renderPortal();
}

function showLockoutMessage() {
  const remaining = getLockoutTimeRemaining();
  const errEl = document.getElementById('pin-error');
  const submitBtn = document.getElementById('pin-submit');
  errEl.textContent = `Too many incorrect attempts. Please try again in ${formatLockoutMins(remaining)}.`;
  errEl.style.display = 'block';
  submitBtn.disabled = true;
  document.getElementById('pin-input').disabled = true;
}

function showFullError(title, message) {
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('pin-screen').style.display = 'none';
  document.getElementById('portal-main').style.display = 'none';
  document.getElementById('full-error-title').textContent = title;
  document.getElementById('full-error-msg').textContent = message;
  document.getElementById('full-error').style.display = 'flex';
}

// ============================================================
// INIT
// ============================================================
function getTokenFromUrl() {
  // Try query param first (e.g., /portal/?t=abc123 or direct /brand-portal.html?t=abc123)
  const params = new URLSearchParams(window.location.search);
  const queryToken = params.get('t');
  if (queryToken) return queryToken;

  // Otherwise, parse from path (e.g., /deal/abc123 — Vercel rewrites preserve user-facing URL)
  const pathMatch = window.location.pathname.match(/^\/deal\/([a-zA-Z0-9_-]+)/);
  if (pathMatch) return pathMatch[1];

  return null;
}

async function init() {
  dealToken = getTokenFromUrl();
  if (!dealToken || dealToken.length < 10) {
    showFullError('Invalid Link', 'This portal link appears to be malformed or incomplete.');
    return;
  }

  // Check lockout
  if (isLockedOut()) {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('pin-screen').style.display = 'flex';
    showLockoutMessage();
    return;
  }

  // Try cached PIN from sessionStorage first
  const cachedPin = getPinFromSession();
  if (cachedPin) {
    dealPin = cachedPin;
    const result = await loadDeal();
    if (result.ok) {
      dealData = result.data;
      renderPortal();
      return;
    }
    // Cached PIN failed (e.g., new token issued) — clear and fall through to PIN entry
    clearPinFromSession();
    dealPin = null;
  }

  // Show PIN entry
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('pin-screen').style.display = 'flex';
  document.getElementById('pin-input').focus();
}

document.addEventListener('DOMContentLoaded', () => {
  init();

  // PIN form submission
  const submitBtn = document.getElementById('pin-submit');
  const input = document.getElementById('pin-input');
  // Strip non-digits as they type
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.length === 6) submitBtn.click();
  });
  submitBtn.addEventListener('click', () => {
    const pin = input.value.trim();
    if (pin.length !== 6) {
      const errEl = document.getElementById('pin-error');
      errEl.textContent = 'Please enter the full 6-digit PIN.';
      errEl.style.display = 'block';
      return;
    }
    attemptUnlock(pin);
  });
});

// ============================================================
// CONTRACT SIGNING (Brand Side)
// ============================================================
// CONTRACT SIGNING — Full PDF Sign Tool Port
// ============================================================

// State
let psmFields = [];
let psmFieldIdSeq = 1;
let psmPdfBytes = null;
let psmPdfDoc = null;
let psmPageDimensions = [];
let psmSessionSig = null;
let psmActiveFieldId = null;
let psmDragType = null;
let psmTouchPending = null;
let psmLastMoveEnd = 0;

const PSM_FIELD_DEFAULTS = {
  signature: { w: 0.22, h: 0.055 },
  text:      { w: 0.18, h: 0.028 },
  date:      { w: 0.13, h: 0.028 },
  checkbox:  { w: 0.018, h: 0.022 },
  crossout:  { w: 0.20, h: 0.012 },
};

function renderPortalContractStatus(deal) {
  const creatorEl = document.getElementById('portal-creator-sign-status');
  const brandEl = document.getElementById('portal-brand-sign-status');
  const signBtn = document.getElementById('portal-contract-sign-btn');
  const markBtn = document.getElementById('portal-contract-marksigned-btn');
  const lockedEl = document.getElementById('portal-contract-locked');
  const isLocked = deal.contract_locked;

  if (deal.creator_signed_at) {
    const d = new Date(deal.creator_signed_at);
    creatorEl.innerHTML = '<span style="color:#4ade80;">Signed</span> <span style="color:var(--muted);font-weight:400;">' + d.toLocaleDateString() + '</span>';
  } else {
    creatorEl.innerHTML = '<span style="color:#fbbf24;">Not signed</span>';
  }
  if (deal.brand_signed_at) {
    const d = new Date(deal.brand_signed_at);
    brandEl.innerHTML = '<span style="color:#4ade80;">Signed</span> <span style="color:var(--muted);font-weight:400;">' + d.toLocaleDateString() + '</span>';
  } else {
    brandEl.innerHTML = '<span style="color:#fbbf24;">Not signed</span>';
  }
  if (isLocked) {
    signBtn.style.display = 'none'; markBtn.style.display = 'none'; lockedEl.style.display = 'block';
  } else if (!deal.brand_signed_at) {
    signBtn.style.display = 'inline-block'; markBtn.style.display = 'inline-block'; lockedEl.style.display = 'none';
  } else {
    signBtn.style.display = 'none'; markBtn.style.display = 'none'; lockedEl.style.display = 'none';
  }
}

async function viewPortalContract() {
  const deal = dealData.deal;
  if (!deal || !deal.contract_file_path) return;
  const btn = document.getElementById('portal-contract-view-btn');
  btn.disabled = true; btn.textContent = 'Loading...';
  try {
    const { data, error } = await sb.functions.invoke('deal-file-url', { body: { token: dealToken, pin: dealPin, file_type: 'contract' } });
    if (error) throw new Error(error.message || 'Failed');
    if (data && data.error) throw new Error(data.error);
    if (!data || !data.url) throw new Error('No URL returned');
    window.open(data.url, '_blank', 'noopener,noreferrer');
  } catch (err) { showPortalToast('error', 'Failed to open contract: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'View'; }
}

// ---- Open signing modal & render PDF ----
async function openPortalSignModal() {
  const deal = dealData.deal;
  if (!deal || !deal.contract_file_path) return;
  const btn = document.getElementById('portal-contract-sign-btn');
  btn.disabled = true; btn.textContent = 'Loading...';

  try {
    const { data, error } = await sb.functions.invoke('deal-file-url', { body: { token: dealToken, pin: dealPin, file_type: 'contract' } });
    if (error) throw new Error(error.message || 'Failed');
    if (data && data.error) throw new Error(data.error);
    if (!data || !data.url) throw new Error('No URL returned');

    const resp = await fetch(data.url);
    if (!resp.ok) throw new Error('Failed to download');
    psmPdfBytes = new Uint8Array(await resp.arrayBuffer());
    psmFields = []; psmFieldIdSeq = 1; psmPageDimensions = [];

    document.getElementById('portal-sign-filename').textContent = deal.contract_file_name || 'contract.pdf';

    const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(psmPdfBytes) });
    psmPdfDoc = await loadingTask.promise;

    const container = document.getElementById('portal-sign-pages');
    container.innerHTML = '';

    for (let i = 0; i < psmPdfDoc.numPages; i++) {
      const page = await psmPdfDoc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      psmPageDimensions.push({ width: vp.width, height: vp.height });
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      canvas.style.cssText = 'display:block;width:100%;height:auto;border-radius:6px;';
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const pageWrap = document.createElement('div');
      pageWrap.className = 'pdfsign-page-wrap';
      pageWrap.dataset.pageIndex = i;
      pageWrap.appendChild(canvas);

      const overlay = document.createElement('div');
      overlay.className = 'pdfsign-field-overlay';
      overlay.addEventListener('dragover', function(e) { e.preventDefault(); });
      overlay.addEventListener('drop', function(e) { e.preventDefault(); psmHandleDrop(e, i, overlay); });
      overlay.addEventListener('click', function(e) { psmHandleOverlayClick(e, i); });
      pageWrap.appendChild(overlay);
      container.appendChild(pageWrap);
    }

    document.getElementById('portal-sign-modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
  } catch (err) { showPortalToast('error', 'Failed to load contract: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Sign Contract'; }
}

function closePortalSignModal() {
  document.getElementById('portal-sign-modal').style.display = 'none';
  document.body.style.overflow = '';
  psmFields = []; psmPdfBytes = null; psmPdfDoc = null; psmPageDimensions = [];
  psmTouchPending = null; psmClearPaletteSelection();
  document.getElementById('portal-sign-pages').innerHTML = '';
}

// ---- Palette interactions ----
function psmDragStart(e, fieldType) {
  psmDragType = fieldType;
  e.dataTransfer.setData('text/plain', fieldType);
  e.dataTransfer.effectAllowed = 'copy';
}

function psmPaletteClick(e, fieldType, el) {
  // `el` is the palette item element (passed by the action dispatcher).
  // `e.currentTarget` would be `document` (the dispatcher's listener target),
  // not the palette item, so we cannot use it to find which item was clicked.
  if (!el) return;
  const wasSelected = el.classList.contains('selected');
  psmClearPaletteSelection();
  if (!wasSelected) {
    el.classList.add('selected');
    psmTouchPending = fieldType;
    psmShowStatus('Tap on the document to place the ' + fieldType + ' field.');
  } else {
    psmTouchPending = null;
    psmHideStatus();
  }
}

function psmClearPaletteSelection() {
  document.querySelectorAll('.psm-palette-item').forEach(function(el) { el.classList.remove('selected'); });
  psmTouchPending = null;
}

function psmShowStatus(msg) {
  const el = document.getElementById('psm-status');
  el.textContent = msg; el.style.display = 'block';
}
function psmHideStatus() {
  document.getElementById('psm-status').style.display = 'none';
}

function psmHandleDrop(e, pageIndex, overlay) {
  const rect = overlay.getBoundingClientRect();
  const normX = (e.clientX - rect.left) / rect.width;
  const normY = (e.clientY - rect.top) / rect.height;
  const fieldType = psmDragType || e.dataTransfer.getData('text/plain');
  const validTypes = ['signature', 'text', 'date', 'checkbox', 'crossout'];
  if (!fieldType || validTypes.indexOf(fieldType) === -1) return;
  psmAddField(pageIndex, fieldType, normX, normY);
  psmDragType = null;
}

function psmHandleOverlayClick(e, pageIndex) {
  if (Date.now() - psmLastMoveEnd < 200) return;
  if (!psmTouchPending) return;
  if (e.target.closest('.pdfsign-field')) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const normX = (e.clientX - rect.left) / rect.width;
  const normY = (e.clientY - rect.top) / rect.height;
  psmAddField(pageIndex, psmTouchPending, normX, normY);
  psmClearPaletteSelection();
  psmHideStatus();
}

// ---- Field management ----
function psmAddField(pageIndex, type, normX, normY) {
  const d = PSM_FIELD_DEFAULTS[type] || PSM_FIELD_DEFAULTS.text;
  const field = {
    id: 'f' + (psmFieldIdSeq++),
    type: type,
    pageIndex: pageIndex,
    x: Math.max(0, Math.min(normX - d.w/2, 1 - d.w)),
    y: Math.max(0, Math.min(normY - d.h/2, 1 - d.h)),
    w: d.w, h: d.h,
    value: type === 'checkbox' ? true : (type === 'crossout' ? true : (type === 'date' ? new Date().toLocaleDateString('en-US') : ''))
  };
  psmFields.push(field);
  psmRenderField(field);

  // Auto-open editor for signature/text/date
  if (type === 'signature') { if (!psmSessionSig) psmOpenSigModal(field.id); else { field.value = psmSessionSig; psmRenderFieldContent(field); } }
  else if (type === 'text') psmOpenTextModal(field.id, 'text');
  else if (type === 'date') psmOpenTextModal(field.id, 'date');
}

function psmRenderField(field) {
  const pageWrap = document.querySelector('.pdfsign-page-wrap[data-page-index="' + field.pageIndex + '"]');
  if (!pageWrap) return;
  const overlay = pageWrap.querySelector('.pdfsign-field-overlay');
  if (!overlay) return;

  const el = document.createElement('div');
  el.className = 'pdfsign-field' + (psmHasValue(field) ? ' filled' : '');
  el.id = 'psm-' + field.id;
  el.draggable = false;
  el.style.left = (field.x*100)+'%'; el.style.top = (field.y*100)+'%';
  el.style.width = (field.w*100)+'%'; el.style.height = (field.h*100)+'%';

  // Type label
  const label = document.createElement('div');
  label.className = 'pdfsign-field-type-label';
  label.textContent = field.type;
  el.appendChild(label);

  // Content container (populated after DOM insertion)
  const content = document.createElement('div');
  content.className = 'pdfsign-field-content';
  el.appendChild(content);

  // Delete button
  const del = document.createElement('button');
  del.className = 'pdfsign-field-delete';
  del.textContent = '\u00d7';
  del.addEventListener('click', function(e) { e.stopPropagation(); psmDeleteField(field.id); });
  el.appendChild(del);

  // Resize handle
  const resize = document.createElement('div');
  resize.className = 'pdfsign-field-resize';
  resize.addEventListener('mousedown', function(e) { e.stopPropagation(); e.preventDefault(); psmStartResize(e, field.id); });
  resize.addEventListener('touchstart', function(e) { e.stopPropagation(); e.preventDefault(); psmStartResize(e.touches[0], field.id); }, { passive: false });
  el.appendChild(resize);

  // Move via drag
  el.addEventListener('mousedown', function(e) { if (e.target.closest('.pdfsign-field-delete,.pdfsign-field-resize')) return; e.preventDefault(); psmStartMove(e, field.id, el); });
  el.addEventListener('touchstart', function(e) { if (e.target.closest('.pdfsign-field-delete,.pdfsign-field-resize')) return; e.preventDefault(); psmStartMove(e.touches[0], field.id, el); }, { passive: false });

  // Click to edit
  el.addEventListener('dblclick', function(e) { e.stopPropagation(); psmEditField(field); });
  el.addEventListener('click', function(e) {
    e.stopPropagation();
    if (Date.now() - psmLastMoveEnd < 200) return;
    if (field.type === 'checkbox') { field.value = !field.value; psmRenderFieldContent(field); }
    else if (field.type === 'crossout') { /* toggle not needed */ }
  });

  overlay.appendChild(el);

  // Render content AFTER element is in the DOM (getElementById needs it)
  psmRenderFieldContent(field);
}

function psmRenderFieldContent(field) {
  const el = document.getElementById('psm-' + field.id);
  if (!el) return;
  const content = el.querySelector('.pdfsign-field-content');
  if (!content) return;
  content.innerHTML = '';
  el.className = 'pdfsign-field' + (psmHasValue(field) ? ' filled' : '');

  if (field.type === 'signature' && field.value) {
    if (field.value.indexOf('data:image') === 0) {
      var img = document.createElement('img');
      img.src = field.value;
      img.alt = '';
      img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;display:block;';
      content.appendChild(img);
    } else {
      content.innerHTML = '<span class="pdfsign-field-text" style="font-family:Brush Script MT,cursive;font-style:italic;font-size:18px;">' + escapeHtml(field.value) + '</span>';
    }
  } else if (field.type === 'text' && field.value) {
    content.innerHTML = '<span class="pdfsign-field-text">' + escapeHtml(field.value) + '</span>';
  } else if (field.type === 'date' && field.value) {
    content.innerHTML = '<span class="pdfsign-field-text">' + escapeHtml(field.value) + '</span>';
  } else if (field.type === 'checkbox') {
    content.innerHTML = field.value ? '<span class="pdfsign-field-checkbox-on">X</span>' : '';
  } else if (field.type === 'crossout') {
    content.innerHTML = '<div style="width:100%;height:2px;background:#000;"></div>';
  } else {
    content.innerHTML = '<span style="font-size:10px;opacity:0.5;">' + field.type + '</span>';
  }
}

function psmHasValue(f) {
  if (f.type === 'checkbox' || f.type === 'crossout') return true;
  return !!f.value;
}

function psmDeleteField(id) {
  psmFields = psmFields.filter(function(f) { return f.id !== id; });
  var el = document.getElementById('psm-' + id);
  if (el) el.remove();
}

function psmEditField(field) {
  if (field.type === 'signature') psmOpenSigModal(field.id);
  else if (field.type === 'text' || field.type === 'date') psmOpenTextModal(field.id, field.type);
}

// ---- Move & Resize ----
function psmStartMove(e, fieldId, fieldEl) {
  const field = psmFields.find(function(f) { return f.id === fieldId; });
  if (!field) return;
  const overlay = fieldEl.closest('.pdfsign-field-overlay');
  if (!overlay) return;
  const rect = overlay.getBoundingClientRect();
  const startX = (e.clientX || e.pageX) - rect.left;
  const startY = (e.clientY || e.pageY) - rect.top;
  const origX = field.x, origY = field.y;

  function onMove(ev) {
    const cx = (ev.clientX || (ev.touches && ev.touches[0].clientX)) - rect.left;
    const cy = (ev.clientY || (ev.touches && ev.touches[0].clientY)) - rect.top;
    field.x = Math.max(0, Math.min(origX + (cx - startX)/rect.width, 1 - field.w));
    field.y = Math.max(0, Math.min(origY + (cy - startY)/rect.height, 1 - field.h));
    fieldEl.style.left = (field.x*100)+'%'; fieldEl.style.top = (field.y*100)+'%';
  }
  function onUp() { psmLastMoveEnd = Date.now(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp); }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);
}

function psmStartResize(e, fieldId) {
  const field = psmFields.find(function(f) { return f.id === fieldId; });
  if (!field) return;
  const fieldEl = document.getElementById('psm-' + fieldId);
  const overlay = fieldEl.closest('.pdfsign-field-overlay');
  if (!overlay) return;
  const rect = overlay.getBoundingClientRect();
  const startX = e.clientX || e.pageX;
  const startY = e.clientY || e.pageY;
  const origW = field.w, origH = field.h;

  function onMove(ev) {
    const cx = (ev.clientX || (ev.touches && ev.touches[0].clientX));
    const cy = (ev.clientY || (ev.touches && ev.touches[0].clientY));
    field.w = Math.max(0.02, Math.min(origW + (cx - startX)/rect.width, 1 - field.x));
    field.h = Math.max(0.015, Math.min(origH + (cy - startY)/rect.height, 1 - field.y));
    fieldEl.style.width = (field.w*100)+'%'; fieldEl.style.height = (field.h*100)+'%';
  }
  function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp); }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);
}

// ---- Text/Date modal ----
function psmOpenTextModal(fieldId, type) {
  psmActiveFieldId = fieldId;
  var field = psmFields.find(function(f) { return f.id === fieldId; });
  document.getElementById('psm-text-title').textContent = type === 'date' ? 'Enter date' : 'Enter text';
  var inp = document.getElementById('psm-text-input');
  inp.value = field ? (field.value || '') : '';
  document.getElementById('psm-text-modal').style.display = 'flex';
  setTimeout(function() { inp.focus(); }, 100);
}
function psmCloseTextModal() {
  document.getElementById('psm-text-modal').style.display = 'none';
  psmActiveFieldId = null;
}
function psmApplyText() {
  var field = psmFields.find(function(f) { return f.id === psmActiveFieldId; });
  if (field) {
    field.value = document.getElementById('psm-text-input').value;
    psmRenderFieldContent(field);
  }
  psmCloseTextModal();
}

// ---- Signature modal ----
function psmOpenSigModal(fieldId) {
  psmActiveFieldId = fieldId;
  document.getElementById('psm-sig-modal').style.display = 'flex';
  psmSwitchSigMode('draw');
  psmSetupSigCanvas();
}
function psmCloseSigModal() {
  document.getElementById('psm-sig-modal').style.display = 'none';
  psmActiveFieldId = null;
}

function psmSwitchSigMode(mode) {
  document.querySelectorAll('#psm-sig-modal .pdfsign-sig-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.mode === mode); });
  document.getElementById('psm-sig-draw').style.display = mode === 'draw' ? 'block' : 'none';
  document.getElementById('psm-sig-type').style.display = mode === 'type' ? 'block' : 'none';
  document.getElementById('psm-sig-upload').style.display = mode === 'upload' ? 'block' : 'none';
  if (mode === 'draw') psmSetupSigCanvas();
  if (mode === 'type') { var inp = document.getElementById('psm-sig-type-input'); inp.value = ''; document.getElementById('psm-sig-type-preview').textContent = 'Type to preview'; setTimeout(function() { inp.focus(); }, 100); }
}

let psmSigDrawing = false;
let psmSigCtx = null;

function psmSetupSigCanvas() {
  var canvas = document.getElementById('psm-sig-canvas');
  var ctx = canvas.getContext('2d');
  psmSigCtx = ctx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  canvas.onpointerdown = function(e) { psmSigDrawing = true; ctx.beginPath(); var p = psmSigPoint(e, canvas); ctx.moveTo(p.x, p.y); e.preventDefault(); };
  canvas.onpointermove = function(e) { if (!psmSigDrawing) return; var p = psmSigPoint(e, canvas); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
  canvas.onpointerup = function() { psmSigDrawing = false; };
  canvas.onpointerleave = function() { psmSigDrawing = false; };
}

function psmSigPoint(e, canvas) {
  var rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) };
}

function psmClearSigCanvas() {
  var canvas = document.getElementById('psm-sig-canvas');
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function psmUpdateTypedSig() {
  var text = document.getElementById('psm-sig-type-input').value;
  var preview = document.getElementById('psm-sig-type-preview');
  preview.textContent = text || 'Type to preview';
}

function psmOnSigUpload(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function() {
    document.getElementById('psm-sig-upload-img').src = reader.result;
    document.getElementById('psm-sig-upload-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function psmApplySig() {
  var activePanel = document.querySelector('#psm-sig-modal .pdfsign-sig-tab.active');
  var mode = activePanel ? activePanel.dataset.mode : 'draw';
  var dataUrl = null;

  if (mode === 'draw') {
    dataUrl = await psmTrimSigCanvas();
    if (!dataUrl) { showPortalToast('info', 'Please draw your signature first.'); return; }
  } else if (mode === 'type') {
    var text = document.getElementById('psm-sig-type-input').value.trim();
    if (!text) { showPortalToast('info', 'Please type your name.'); return; }
    dataUrl = psmRenderTypedSig(text);
  } else if (mode === 'upload') {
    var img = document.getElementById('psm-sig-upload-img');
    if (!img.src || img.src === '') { showPortalToast('info', 'Please upload an image.'); return; }
    dataUrl = img.src;
  }

  if (dataUrl) {
    psmSessionSig = dataUrl;
    var field = psmFields.find(function(f) { return f.id === psmActiveFieldId; });
    if (field) { field.value = dataUrl; psmRenderFieldContent(field); }
  }
  psmCloseSigModal();
}

async function psmTrimSigCanvas() {
  var canvas = document.getElementById('psm-sig-canvas');
  var ctx = canvas.getContext('2d');
  var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  var d = imgData.data;
  var minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
  var found = false;
  for (var y = 0; y < canvas.height; y++) {
    for (var x = 0; x < canvas.width; x++) {
      var i = (y * canvas.width + x) * 4;
      if (d[i] < 240 || d[i+1] < 240 || d[i+2] < 240) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  if (!found) return null;
  var pad = 10;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(canvas.width, maxX + pad); maxY = Math.min(canvas.height, maxY + pad);
  var w = maxX - minX, h = maxY - minY;
  var trimmed = document.createElement('canvas');
  trimmed.width = w; trimmed.height = h;
  var tCtx = trimmed.getContext('2d');
  // Make transparent background
  tCtx.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  // Remove white pixels
  var td = tCtx.getImageData(0, 0, w, h);
  for (var j = 0; j < td.data.length; j += 4) {
    if (td.data[j] > 240 && td.data[j+1] > 240 && td.data[j+2] > 240) {
      td.data[j+3] = 0;
    }
  }
  tCtx.putImageData(td, 0, 0);
  return trimmed.toDataURL('image/png');
}

function psmRenderTypedSig(text) {
  var canvas = document.createElement('canvas');
  canvas.width = 480; canvas.height = 120;
  var ctx = canvas.getContext('2d');
  ctx.font = 'italic 48px "Brush Script MT", cursive';
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, 60);
  return canvas.toDataURL('image/png');
}

// escapeHtml defined above

// ---- Build signed PDF bytes ----
function dataUrlToBytes(dataUrl) {
  var base64 = dataUrl.split(',')[1];
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- Save ----
async function savePortalSignature() {
  if (psmFields.length === 0) { showPortalToast('info', 'Please add at least one field to the document.'); return; }
  if (!psmPdfBytes) { showPortalToast('error', 'No PDF loaded.'); return; }

  var btn = document.getElementById('portal-sign-save-btn');
  btn.disabled = true; btn.textContent = 'Saving...';

  try {
    if (!window.PDFLib) throw new Error('PDF editor not loaded. Refresh the page.');
    var PDFLib = window.PDFLib;
    var pdfDoc = await PDFLib.PDFDocument.load(psmPdfBytes);
    var helv = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
    var pages = pdfDoc.getPages();

    for (var fi = 0; fi < psmFields.length; fi++) {
      var field = psmFields[fi];
      if (!psmHasValue(field)) continue;
      var page = pages[field.pageIndex];
      if (!page) continue;
      var ps = page.getSize();
      var pW = ps.width, pH = ps.height;
      var absX = field.x * pW, absY = pH - (field.y * pH) - (field.h * pH);
      var absW = field.w * pW, absH = field.h * pH;

      if (field.type === 'signature' && field.value) {
        if (field.value.startsWith('data:image/')) {
          var pngBytes = dataUrlToBytes(field.value);
          var img = await pdfDoc.embedPng(pngBytes);
          var scale = Math.min(absW / img.width, absH / img.height);
          var drawW = img.width * scale, drawH = img.height * scale;
          page.drawImage(img, { x: absX + (absW-drawW)/2, y: absY + (absH-drawH)/2, width: drawW, height: drawH });
        }
      } else if (field.type === 'checkbox') {
        if (field.value) {
          var size = Math.min(absW, absH, 18) * 0.9;
          page.drawText('X', { x: absX + (absW - size*0.55)/2, y: absY + (absH - size)/2 + size*0.1, size: size, font: helv, color: PDFLib.rgb(0,0,0) });
        }
      } else if (field.type === 'crossout') {
        var thickness = Math.max(1, Math.min(absH * 0.4, 2.5));
        page.drawLine({ start: { x: absX, y: absY + absH/2 }, end: { x: absX + absW, y: absY + absH/2 }, thickness: thickness, color: PDFLib.rgb(0,0,0) });
      } else {
        var text = String(field.value || '');
        if (!text) continue;
        var fontSize = Math.min(10, absH * 0.65);
        var tw = helv.widthOfTextAtSize(text, fontSize);
        while (tw > absW - 4 && fontSize > 4) { fontSize -= 0.5; tw = helv.widthOfTextAtSize(text, fontSize); }
        page.drawText(text, { x: absX + 2, y: absY + (absH - fontSize)/2 + fontSize*0.25, size: fontSize, font: helv, color: PDFLib.rgb(0,0,0) });
      }
    }

    var signedBytes = await pdfDoc.save();
    var deal = dealData.deal;

    // Convert to base64
    var binary = '';
    var bytes = new Uint8Array(signedBytes);
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    var base64Pdf = btoa(binary);

    var now = new Date().toISOString();
    var shouldLock = !!deal.creator_signed_at;
    var result = await sb.functions.invoke('brand-sign-contract', {
      body: { token: dealToken, pin: dealPin, deal_id: deal.id, signed_pdf_base64: base64Pdf, signed_at: now, lock: shouldLock }
    });
    if (result.error) throw new Error(result.error.message || 'Failed to save');
    if (result.data && result.data.error) throw new Error(result.data.error);

    deal.brand_signed_at = now;
    if (shouldLock) { deal.contract_locked = true; deal.status = 'active'; }

    closePortalSignModal();
    renderPortalContractStatus(deal);
    showPortalToast('success', 'Contract signed successfully!' + (shouldLock ? ' The contract is now fully executed and the deal is active.' : ''));
    sb.functions.invoke('send-deal-notification', { body: { type: 'contract_brand_signed', deal_id: deal.id, share_token: dealToken, share_pin: dealPin } }).then(function(r) { if (r.error) console.warn('Notification failed:', r.error); });
  } catch (err) {
    showPortalToast('error', 'Failed to save signature: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save & Upload';
  }
}

async function markPortalBrandSigned() {
  const confirmed = await portalConfirm('Mark the contract as signed by your organization? Use this if you signed outside of this portal.');
  if (!confirmed) return;
  try {
    var deal = dealData.deal;
    var now = new Date().toISOString();
    var shouldLock = !!deal.creator_signed_at;
    var result = await sb.functions.invoke('brand-sign-contract', {
      body: { token: dealToken, pin: dealPin, deal_id: deal.id, signed_at: now, lock: shouldLock, mark_only: true }
    });
    if (result.error) throw new Error(result.error.message || 'Failed');
    if (result.data && result.data.error) throw new Error(result.data.error);

    deal.brand_signed_at = now;
    if (shouldLock) { deal.contract_locked = true; deal.status = 'active'; }
    renderPortalContractStatus(deal);
    showPortalToast('success', 'Contract marked as signed.' + (shouldLock ? ' The contract is now fully executed and the deal is active.' : ''));
    sb.functions.invoke('send-deal-notification', { body: { type: 'contract_brand_signed', deal_id: deal.id, share_token: dealToken, share_pin: dealPin } }).then(function(r) { if (r.error) console.warn('Notification failed:', r.error); });
  } catch (err) { showPortalToast('error', err.message); }
}


// =============================================================================
// EVENT DELEGATION DISPATCHER
// -----------------------------------------------------------------------------
// One listener per event type. Walks up the DOM from the event target until
// it finds an element with the matching data-portal-* attribute, then calls
// the registered handler. Handlers receive (event, element, ...extras).
//
// Supports four event styles:
//   • data-portal-action       — fires on click (default)
//   • data-portal-input        — fires on input
//   • data-portal-change       — fires on change
//   • data-portal-keydown      — fires on keydown
//   • data-portal-dragstart    — fires on dragstart
// =============================================================================
const portalActions = {};
const portalInputs = {};
const portalChanges = {};
const portalKeydowns = {};
const portalDragstarts = {};

function portalRegisterAction(name, handler)    { portalActions[name] = handler; }
function portalRegisterInput(name, handler)     { portalInputs[name] = handler; }
function portalRegisterChange(name, handler)    { portalChanges[name] = handler; }
function portalRegisterKeydown(name, handler)   { portalKeydowns[name] = handler; }
function portalRegisterDragstart(name, handler) { portalDragstarts[name] = handler; }

function portalFindAttr(target, dataAttr) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset && el.dataset[dataAttr]) return { element: el, value: el.dataset[dataAttr] };
    el = el.parentElement;
  }
  return null;
}

document.addEventListener('click', function(e) {
  const found = portalFindAttr(e.target, 'portalAction');
  if (!found) return;
  const handler = portalActions[found.value];
  if (handler) handler(e, found.element);
});

document.addEventListener('input', function(e) {
  const found = portalFindAttr(e.target, 'portalInput');
  if (!found) return;
  const handler = portalInputs[found.value];
  if (handler) handler(e, found.element);
});

document.addEventListener('change', function(e) {
  const found = portalFindAttr(e.target, 'portalChange');
  if (!found) return;
  const handler = portalChanges[found.value];
  if (handler) handler(e, found.element);
});

document.addEventListener('keydown', function(e) {
  const found = portalFindAttr(e.target, 'portalKeydown');
  if (!found) return;
  const handler = portalKeydowns[found.value];
  if (handler) handler(e, found.element);
});

document.addEventListener('dragstart', function(e) {
  const found = portalFindAttr(e.target, 'portalDragstart');
  if (!found) return;
  const handler = portalDragstarts[found.value];
  if (handler) handler(e, found.element);
});

// =============================================================================
// ACTION REGISTRATIONS
// -----------------------------------------------------------------------------
// One line per inline-handler that existed in the original portal/index.html.
// Click handlers below; per-event-type handlers further down.
// =============================================================================

// Contract row actions (rendered in renderPortalContractStatus)
portalRegisterAction('view-contract',      () => viewPortalContract());
portalRegisterAction('open-sign-modal',    () => openPortalSignModal());
portalRegisterAction('mark-brand-signed',  () => markPortalBrandSigned());

// Portal sign modal (psm = portal-sign-modal)
portalRegisterAction('close-sign-modal',   () => closePortalSignModal());
portalRegisterAction('save-signature',     () => savePortalSignature());

// Palette items — click to enter placement mode, drag to drop on PDF
portalRegisterAction('palette-click',     (e, el) => psmPaletteClick(e, el.dataset.portalFtype, el));
portalRegisterDragstart('palette-drag',   (e, el) => psmDragStart(e, el.dataset.portalFtype));

// Signature sub-modal (draw/type/upload signature)
portalRegisterAction('close-sig-modal',    () => psmCloseSigModal());
portalRegisterAction('switch-sig-mode',   (e, el) => psmSwitchSigMode(el.dataset.portalMode));
portalRegisterAction('clear-sig-canvas',   () => psmClearSigCanvas());
portalRegisterAction('apply-sig',          () => psmApplySig());
portalRegisterInput('update-typed-sig',    () => psmUpdateTypedSig());
portalRegisterChange('sig-upload',        (e, el) => psmOnSigUpload(el.files[0]));

// Text sub-modal (text/date field content)
portalRegisterAction('close-text-modal',   () => psmCloseTextModal());
portalRegisterAction('apply-text',         () => psmApplyText());
portalRegisterKeydown('enter-apply-text', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); psmApplyText(); }
});

// Generic confirm modal (portalConfirm/resolvePortalConfirm)
portalRegisterAction('resolve-confirm',   (e, el) => resolvePortalConfirm(el.dataset.portalVal === 'true'));

// File downloads (invoice button — currently only "invoice" used, but keep it
// flexible for future file types like contract-signed-final.pdf)
portalRegisterAction('download-file',     (e, el) => downloadDealFile(el.dataset.portalFile, el));
portalRegisterAction('view-linked-invoice', (e, el) => {
  var pub = el.getAttribute('data-invoice-public');
  if (pub) window.open('https://www.ryxa.io/invoice/' + pub, '_blank');
});

// Messaging
portalRegisterAction('refresh-messages',  (e, el) => refreshMessages(el));
portalRegisterInput('update-msg-count',    () => updateMsgCharCount());
portalRegisterAction('send-message',       () => sendMessage());
