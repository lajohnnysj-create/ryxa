// =============================================================================
// /js/invoice.js — Invoice Generator (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Invoice Generator tool. Builds a custom invoice HTML
// document and opens it in a new tab where the user can Cmd+P / Ctrl+P to save
// as PDF. Logo is stored in Supabase Storage under user-specific path.
//
// Daily limit of 3 invoices for free users; unlimited for Pro.
//
// IMPORTANT: downloadInvoicePDF() constructs an HTML document that gets written
// to a Blob and opened in a NEW BROWSER TAB. Inline event handlers and inline
// styles INSIDE that generated HTML document are NOT part of the dashboard
// CSP scope — they apply only to the new tab document. They must stay as-is.
// Comments in the code mark this region.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/invoice.js
//   • Phase 2: inline onclick/oninput/onchange → data-invoice-action attributes
//     (only handlers in the DASHBOARD's DOM — not the Blob HTML)
//   • Phase 3: static inline class="bio-s-6eae3a" → hash-named CSS classes
//     (only styles in the DASHBOARD's DOM — not the Blob HTML)
//
// INTENTIONALLY KEPT INLINE: 2 hover handlers on the logo upload area.
//
// External dependencies on window: sb, currentUser, isPro, escapeHtml,
// showModalAlert, formatMoney. Plus `alert()` (browser native — pre-existing
// debt: should be showModalAlert per rule #6, flagged for later).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE
// =============================================================================

const invoiceActions = {};

function invoiceRegisterAction(action, handler) {
  invoiceActions[action] = handler;
}

function invoiceFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['invoiceAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.invoiceAction) {
        const wantEvent = el.dataset.invoiceEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.invoiceAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function invoiceDispatchEvent(event) {
  const found = invoiceFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = invoiceActions[found.action];
  if (!handler) {
    console.warn('[invoice] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, invoiceDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 12340-12638 (Invoice Generator) ----------
// ════════════════════════════════════════════
// INVOICE GENERATOR
// ════════════════════════════════════════════
let invItems = [];
let invLogoDataUrl = null;
let invDailyCount = 0;
const INV_LIMIT_FREE = 3;

function initInvoiceGenerator() {
  const pro = isPro();
  const key = 'fts_inv_' + new Date().toDateString();
  invDailyCount = parseInt(localStorage.getItem(key) || '0');

  // Show logo section for everyone, lock it for free users
  const logoSection = document.getElementById('logo-section');
  if (logoSection) logoSection.style.display = 'block';

  const logoUploadArea = document.getElementById('logo-upload-area');
  const logoPlaceholderText = document.getElementById('logo-placeholder-text');
  const fileInput = document.getElementById('inv-logo');

  if (pro) {
    // Pro: fully enabled
    if (logoUploadArea) { logoUploadArea.style.cursor = 'pointer'; logoUploadArea.style.opacity = '1'; }
    if (fileInput) fileInput.style.pointerEvents = 'auto';
    if (logoPlaceholderText) logoPlaceholderText.textContent = 'Logo';
  } else {
    // Free: locked
    if (logoUploadArea) { logoUploadArea.style.cursor = 'not-allowed'; logoUploadArea.style.opacity = '0.6'; }
    if (fileInput) fileInput.style.pointerEvents = 'none';
    if (logoPlaceholderText) logoPlaceholderText.textContent = 'Upgrade to Pro to add logo';
    const remaining = Math.max(0, INV_LIMIT_FREE - invDailyCount);
    document.getElementById('inv-usage').textContent = `Free: ${remaining} of ${INV_LIMIT_FREE} invoices remaining today. Upgrade to Pro for unlimited.`;
  }

  // Set default dates
  const today = new Date().toISOString().slice(0,10);
  const due = new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0,10);
  document.getElementById('inv-date').value = today;
  document.getElementById('inv-due').value = due;
  document.getElementById('inv-number').value = 'INV-' + String(Math.floor(Math.random()*900)+100);
  // Add first item
  if (invItems.length === 0) addInvoiceItem();
  calcTotals();
}

function previewLogo(input) {
  if (!input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    invLogoDataUrl = e.target.result;
    document.getElementById('logo-placeholder').style.display = 'none';
    const img = document.getElementById('logo-preview');
    img.src = invLogoDataUrl; img.style.display = 'block';
  };
  reader.readAsDataURL(input.files[0]);
}

async function uploadLogo(input) {
  if (!input.files[0] || !currentUser) return;
  const file = input.files[0];

  // Check size — 200KB max
  if (file.size > 200 * 1024) {
    alert('Logo must be under 200KB. Please resize your image and try again.');
    return;
  }

  const logoStatus = document.getElementById('logo-status');
  const logoActions = document.getElementById('logo-actions');
  if (logoStatus) logoStatus.textContent = 'Uploading...';
  if (logoActions) logoActions.style.display = 'flex';

  try {
    const path = `${currentUser.id}/logo`;
    // Upload to Supabase storage
    const { error } = await sb.storage.from('logos').upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;

    // Get public URL and show preview
    const { data } = sb.storage.from('logos').getPublicUrl(path);
    // Use signed URL for private bucket
    const { data: signedData } = await sb.storage.from('logos').createSignedUrl(path, 3600);
    if (signedData?.signedUrl) {
      invLogoDataUrl = signedData.signedUrl;
      showLogoPreview(invLogoDataUrl);
      if (logoStatus) logoStatus.textContent = 'Logo saved';
    }
  } catch (err) {
    console.error('Logo upload error:', err);
    // Fallback to local preview
    const reader = new FileReader();
    reader.onload = e => { invLogoDataUrl = e.target.result; showLogoPreview(invLogoDataUrl); };
    reader.readAsDataURL(file);
    if (logoStatus) logoStatus.textContent = 'Saved locally';
  }
}

async function loadSavedLogo() {
  if (!currentUser || !isPro()) return;
  try {
    const path = `${currentUser.id}/logo`;
    // Check if file exists first to avoid 400 noise in console
    const { data: list } = await sb.storage.from('logos').list(currentUser.id, { limit: 1, search: 'logo' });
    if (!list || list.length === 0) return; // no logo uploaded yet — silent exit

    const { data, error } = await sb.storage.from('logos').createSignedUrl(path, 3600);
    if (data?.signedUrl) {
      invLogoDataUrl = data.signedUrl;
      showLogoPreview(invLogoDataUrl);
      const logoStatus = document.getElementById('logo-status');
      if (logoStatus) logoStatus.textContent = 'Logo loaded';
    }
  } catch (err) {
    // No logo saved yet — that's fine
  }
}

function showLogoPreview(url) {
  document.getElementById('logo-placeholder').style.display = 'none';
  const img = document.getElementById('logo-preview');
  img.src = url; img.style.display = 'block';
  const logoActions = document.getElementById('logo-actions');
  if (logoActions) logoActions.style.display = 'flex';
}

async function deleteLogo() {
  if (!currentUser) return;
  if (!confirm('Delete your saved logo?')) return;
  try {
    await sb.storage.from('logos').remove([`${currentUser.id}/logo`]);
  } catch (err) {
    console.error('Delete error:', err);
  }
  invLogoDataUrl = null;
  // Reset back to plus icon
  document.getElementById('logo-placeholder').style.display = 'flex';
  const img = document.getElementById('logo-preview');
  img.src = ''; img.style.display = 'none';
  const logoActions = document.getElementById('logo-actions');
  if (logoActions) logoActions.style.display = 'none';
}

function addInvoiceItem() {
  const id = Date.now();
  invItems.push({ id, desc: '', qty: 1, rate: 0 });
  renderInvoiceItems();
}

function removeInvoiceItem(id) {
  invItems = invItems.filter(i => i.id !== id);
  renderInvoiceItems();
  calcTotals();
}

function renderInvoiceItems() {
  const container = document.getElementById('inv-items');
  container.innerHTML = invItems.map(item => `
    <div class="invoice-s-f31aea">
      <input type="text" aria-label="Service description" value="${item.desc}" placeholder="Service description" data-invoice-action-input="update-item-desc" data-invoice-item-id="${item.id}"
        class="invoice-s-9fd163">
      <input type="number" aria-label="Quantity" value="${item.qty}" min="1" data-invoice-action-input="update-item-qty" data-invoice-item-id="${item.id}"
        class="invoice-s-8e4206">
      <input type="number" aria-label="Rate" value="${item.rate}" min="0" step="0.01" placeholder="0.00" data-invoice-action-input="update-item-rate" data-invoice-item-id="${item.id}"
        class="invoice-s-f56476">
      <button data-invoice-action="remove-item" data-invoice-item-id="${item.id}" class="invoice-s-5de598">&#x2715;</button>
    </div>
  `).join('');
}

function updateItem(id, field, value) {
  const item = invItems.find(i => i.id === id);
  if (!item) return;
  item[field] = field === 'desc' ? value : parseFloat(value) || 0;
  calcTotals();
}

function calcTotals() {
  const subtotal = invItems.reduce((sum, i) => sum + (i.qty * i.rate), 0);
  const taxPct = parseFloat(document.getElementById('inv-tax')?.value || 0);
  const taxAmt = subtotal * taxPct / 100;
  const total = subtotal + taxAmt;
  const fmt = n => formatMoney(Math.round(n * 100), {alwaysShowCents:true});
  if (document.getElementById('inv-subtotal')) document.getElementById('inv-subtotal').textContent = fmt(subtotal);
  if (document.getElementById('inv-tax-amount')) document.getElementById('inv-tax-amount').textContent = fmt(taxAmt);
  if (document.getElementById('inv-total')) document.getElementById('inv-total').textContent = fmt(total);
}

function downloadInvoicePDF() {
  const pro = isPro();
  const key = 'fts_inv_' + new Date().toDateString();
  invDailyCount = parseInt(localStorage.getItem(key) || '0');
  if (!pro && invDailyCount >= INV_LIMIT_FREE) {
    alert(`You have used all ${INV_LIMIT_FREE} free invoices for today. Upgrade to Pro for unlimited.`);
    return;
  }
  const fromName = document.getElementById('inv-from-name').value || 'Your Name';
  const fromEmail = document.getElementById('inv-from-email').value || '';
  const fromAddr = document.getElementById('inv-from-address').value || '';
  const toName = document.getElementById('inv-to-name').value || 'Client Name';
  const toEmail = document.getElementById('inv-to-email').value || '';
  const toAddr = document.getElementById('inv-to-address').value || '';
  const invNum = document.getElementById('inv-number').value || 'INV-001';
  const invDate = document.getElementById('inv-date').value || '';
  const invDue = document.getElementById('inv-due').value || '';
  const notes = document.getElementById('inv-notes').value || '';
  const taxPct = parseFloat(document.getElementById('inv-tax').value || 0);
  const subtotal = invItems.reduce((sum, i) => sum + (i.qty * i.rate), 0);
  const taxAmt = subtotal * taxPct / 100;
  const total = subtotal + taxAmt;
  const fmt = n => formatMoney(Math.round(n * 100), {alwaysShowCents:true});

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ BLOB HTML ZONE — DO NOT REFACTOR HANDLERS OR STYLES IN THIS BLOCK    ║
  // ║ The HTML constructed below is written to a Blob and opened in a      ║
  // ║ new tab. Inline onclick/style attributes here apply only to the new  ║
  // ║ tab's document — they are NOT part of the dashboard CSP scope.       ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  const logoHtml = (pro && invLogoDataUrl)
    ? `<img src="${invLogoDataUrl}" alt="Invoice logo" style="max-height:60px;max-width:160px;object-fit:contain;display:block;margin-bottom:8px;">`
    : '';

  const invoiceCSS = [
    'body{font-family:Arial,sans-serif;background:#fff;color:#111;margin:0;padding:40px;}',
    '.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:48px;}',
    '.invoice-title{font-size:36px;font-weight:900;color:#111;letter-spacing:-1px;}',
    '.invoice-num{font-size:14px;color:#666;margin-top:4px;}',
    '.parties{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:40px;}',
    '.party-label{font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#555;font-weight:700;margin-bottom:8px;}',
    '.party-name{font-size:16px;font-weight:700;margin-bottom:4px;}',
    '.party-detail{font-size:13px;color:#555;line-height:1.5;}',
    'table{width:100%;border-collapse:collapse;margin-bottom:24px;}',
    'th{text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#666;border-bottom:2px solid #f0f0f0;}',
    'td{padding:12px;font-size:14px;border-bottom:1px solid #f5f5f5;}',
    '.text-right{text-align:right;} .text-center{text-align:center;}',
    '.totals{max-width:300px;margin-left:auto;}',
    '.total-row{display:flex;justify-content:space-between;padding:8px 0;font-size:14px;border-bottom:1px solid #f0f0f0;}',
    '.total-final{display:flex;justify-content:space-between;padding:12px 0;font-size:20px;font-weight:900;color:#111;}',
    '.notes{margin-top:32px;padding:16px;background:#f9f9f9;border-radius:8px;font-size:13px;color:#555;line-height:1.7;}',
    '.footer{margin-top:48px;text-align:center;font-size:11px;color:#aaa;}'
  ].join(' ');

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice ' + invNum + '</title><style>' + invoiceCSS + '</style></head><body>';
  const htmlBody = `
<div class="header">
  <div>
    ${logoHtml}
    <div class="party-name" style="font-size:20px;">${fromName}</div>
    <div class="party-detail">${fromEmail}<br>${fromAddr.replace(/\n/g,'<br>')}</div>
  </div>
  <div style="text-align:right;">
    <div class="invoice-title">INVOICE</div>
    <div class="invoice-num">${invNum}</div>
    <div style="font-size:13px;color:#666;margin-top:8px;">Issued: ${invDate}<br>Due: ${invDue}</div>
  </div>
</div>
<div class="parties">
  <div>
    <div class="party-label">Bill To</div>
    <div class="party-name">${toName}</div>
    <div class="party-detail">${toEmail}<br>${toAddr.replace(/\n/g,'<br>')}</div>
  </div>
</div>
<table>
  <thead><tr><th>Description</th><th class="text-center">Qty</th><th class="text-right">Rate</th><th class="text-right">Amount</th></tr></thead>
  <tbody>
    ${invItems.map(i => `<tr><td>${i.desc || '-'}</td><td class="text-center">${i.qty}</td><td class="text-right">${fmt(i.rate)}</td><td class="text-right">${fmt(i.qty*i.rate)}</td></tr>`).join('')}
  </tbody>
</table>
<div class="totals">
  <div class="total-row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
  ${taxPct > 0 ? `<div class="total-row"><span>Tax (${taxPct}%)</span><span>${fmt(taxAmt)}</span></div>` : ''}
  <div class="total-final"><span>Total</span><span>${fmt(total)}</span></div>
</div>
${notes ? `<div class="notes"><strong>Notes:</strong><br>${notes.replace(/\n/g,'<br>')}</div>` : ''}
<div class="footer">Generated with Ryxa Creator Tools &bull; ryxa.io</div>
` + '</body></html>';

  // Combine html head + body content
  const fullHtml = html + htmlBody;

  // Add print CSS and save button to the invoice HTML before opening
  const printHtml = fullHtml.replace('</body></html>', `
<div id="save-bar" style="position:fixed;top:0;left:0;right:0;background:#7c3aed;color:#fff;padding:10px 16px;display:flex;align-items:flex-start;flex-wrap:wrap;gap:8px;z-index:9999;font-family:Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.2);">
  <span style="font-size:13px;font-weight:500;flex:1;min-width:200px;line-height:1.5;">&#x1F4BE; <strong>Desktop:</strong> Press Ctrl+P (or Cmd+P) &rarr; Save as PDF. &nbsp;&#x1F4F1; <strong>Mobile:</strong> Tap the Share button and choose Save to Files.</span>
  <button onclick="window.print()" style="background:#fff;color:#7c3aed;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">Print / Save PDF</button>
</div>
<style id="print-styles">
  body { padding-top: 80px !important; }
  @media print { #save-bar { display:none !important; } body { padding-top: 0 !important; } }
</style>
</body></html>`);

  const blob = new Blob([printHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ END BLOB HTML ZONE                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  if (!pro) {
    invDailyCount++;
    localStorage.setItem(key, invDailyCount.toString());
    const remaining = Math.max(0, INV_LIMIT_FREE - invDailyCount);
    document.getElementById('inv-usage').textContent = `Free: ${remaining} of ${INV_LIMIT_FREE} invoices remaining today.`;
  }
}

// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Top-level buttons
invoiceRegisterAction('download-pdf', () => downloadInvoicePDF());
invoiceRegisterAction('add-item', () => addInvoiceItem());

// Logo upload area
invoiceRegisterAction('upload-logo', (e, el) => uploadLogo(el));
invoiceRegisterAction('delete-logo', () => deleteLogo());

// Tax field (oninput=calcTotals)
invoiceRegisterAction('calc-totals', () => calcTotals());

// Per-item rows (template literal — uses data-invoice-item-id)
invoiceRegisterAction('update-item-desc', (e, el) => updateItem(parseInt(el.dataset.invoiceItemId, 10), 'desc', el.value));
invoiceRegisterAction('update-item-qty', (e, el) => updateItem(parseInt(el.dataset.invoiceItemId, 10), 'qty', el.value));
invoiceRegisterAction('update-item-rate', (e, el) => updateItem(parseInt(el.dataset.invoiceItemId, 10), 'rate', el.value));
invoiceRegisterAction('remove-item', (e, el) => removeInvoiceItem(parseInt(el.dataset.invoiceItemId, 10)));
