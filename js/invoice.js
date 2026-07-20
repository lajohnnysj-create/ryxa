// =============================================================================
// /js/invoice.js — Invoice Generator (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Invoice Generator tool. Builds a custom invoice HTML
// document and opens it in a new tab where the user can Cmd+P / Ctrl+P to save
// as PDF. Logo is stored in Supabase Storage under user-specific path.
//
// Unlimited for all users. Pro still gets logo upload; Free invoices generate
// without a logo. Previously had a daily cap of 3 for free; removed pre-launch.
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
let invItemSeq = 1; // monotonic counter for guaranteed-unique line-item IDs
let invLogoDataUrl = null;

function initInvoiceGenerator() {
  const pro = isPro();

  // Show logo section for everyone, lock it for free users.
  // Logo upload remains the Pro differentiator; count cap was removed.
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
    // Free: logo locked
    if (logoUploadArea) { logoUploadArea.style.cursor = 'not-allowed'; logoUploadArea.style.opacity = '0.6'; }
    if (fileInput) fileInput.style.pointerEvents = 'none';
    if (logoPlaceholderText) logoPlaceholderText.textContent = 'Upgrade to Pro to add logo';
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

// Compress a logo image client-side before upload: cap its dimensions and
// re-encode so even a large source file ends up small in storage. Logos with
// transparency stay PNG; opaque ones become JPEG (much smaller). Returns a Blob.
function compressLogo(file) {
  return new Promise(function (resolve, reject) {
    const MAX_DIM = 512;        // plenty for an invoice logo
    const TARGET_BYTES = 150 * 1024; // aim well under the old 200KB cap
    const reader = new FileReader();
    reader.onerror = function () { reject(new Error('Could not read the image.')); };
    reader.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error('That image could not be loaded.')); };
      img.onload = function () {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (!w || !h) { reject(new Error('That image has no dimensions.')); return; }
        // Scale down so the longest side is at most MAX_DIM (never scale up).
        const scale = Math.min(1, MAX_DIM / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // Detect transparency: if any pixel is not fully opaque, keep PNG so the
        // logo's transparent background is preserved. Otherwise use JPEG.
        let hasAlpha = false;
        try {
          const data = ctx.getImageData(0, 0, w, h).data;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) { hasAlpha = true; break; }
          }
        } catch (e) {
          // getImageData can throw on tainted canvases; assume alpha to be safe.
          hasAlpha = true;
        }

        if (hasAlpha) {
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error('Compression failed.')); return; }
            resolve(blob);
          }, 'image/png');
          return;
        }

        // Opaque: step JPEG quality down until it fits the target (or bottoms out).
        const qualities = [0.85, 0.72, 0.6, 0.5];
        let qi = 0;
        const tryQuality = function () {
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error('Compression failed.')); return; }
            if (blob.size <= TARGET_BYTES || qi >= qualities.length - 1) {
              resolve(blob);
            } else {
              qi++;
              tryQuality();
            }
          }, 'image/jpeg', qualities[qi]);
        };
        tryQuality();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadLogo(input) {
  if (!input.files[0] || !currentUser) return;
  const file = input.files[0];

  // Accept a generous source size (up to 5MB); we compress it down below.
  if (file.size > 5 * 1024 * 1024) {
    alert('Logo must be under 5MB. Please choose a smaller image.');
    return;
  }
  if (!/^image\//.test(file.type)) {
    alert('Please choose an image file for your logo.');
    return;
  }

  // Compress before upload. If compression fails for any reason, fall back to
  // the original file (still under 5MB).
  let uploadBlob = file;
  let contentType = file.type;
  try {
    const compressed = await compressLogo(file);
    // Only use the compressed version if it actually came out smaller.
    if (compressed && compressed.size < file.size) {
      uploadBlob = compressed;
      contentType = compressed.type || contentType;
    }
  } catch (e) {
    console.warn('Logo compression skipped:', e);
  }

  try {
    const path = `${currentUser.id}/logo`;
    // Upload the compressed blob to Supabase storage
    const { error } = await sb.storage.from('logos').upload(path, uploadBlob, { upsert: true, contentType: contentType });
    if (error) throw error;

    // logos is a public bucket, so use the permanent public URL (works for the
    // brand viewing the public invoice page without auth). The path is always
    // {userId}/logo, so append a cache-buster whenever the logo changes,
    // otherwise a replaced logo would keep showing the old cached image.
    const { data } = sb.storage.from('logos').getPublicUrl(path);
    if (data?.publicUrl) {
      invLogoDataUrl = data.publicUrl + '?v=' + Date.now();
      showLogoPreview(invLogoDataUrl);
      if (typeof showDashToast === 'function') showDashToast('success', 'Logo uploaded. Your logo will be used for all invoices.');
    }
  } catch (err) {
    console.error('Logo upload error:', err);
    // Fallback to local preview
    const reader = new FileReader();
    reader.onload = e => { invLogoDataUrl = e.target.result; showLogoPreview(invLogoDataUrl); };
    reader.readAsDataURL(uploadBlob);
    if (typeof showDashToast === 'function') showDashToast('success', 'Logo uploaded. Your logo will be used for all invoices.');
  }
}

async function loadSavedLogo() {
  if (!currentUser || !isPro()) return;
  try {
    const path = `${currentUser.id}/logo`;
    // Check if file exists first to avoid 400 noise in console
    const { data: list } = await sb.storage.from('logos').list(currentUser.id, { limit: 1, search: 'logo' });
    if (!list || list.length === 0) return; // no logo uploaded yet, silent exit

    // Public bucket: use the permanent public URL. Cache-bust with the file's
    // last-updated time so a replaced logo refreshes instead of showing stale.
    const { data } = sb.storage.from('logos').getPublicUrl(path);
    if (data?.publicUrl) {
      const ver = list[0] && list[0].updated_at ? new Date(list[0].updated_at).getTime() : Date.now();
      invLogoDataUrl = data.publicUrl + '?v=' + ver;
      showLogoPreview(invLogoDataUrl);
    }
  } catch (err) {
    // No logo saved yet, that's fine
  }
}

function showLogoPreview(url) {
  document.getElementById('logo-placeholder').style.display = 'none';
  const img = document.getElementById('logo-preview');
  img.src = url; img.style.display = 'block';
  const trash = document.getElementById('inv-logo-remove');
  if (trash) trash.style.display = 'flex';
}

async function deleteLogo() {
  if (!currentUser) return;
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
  const trash = document.getElementById('inv-logo-remove');
  if (trash) trash.style.display = 'none';
  if (typeof showDashToast === 'function') showDashToast('success', 'Logo removed from all invoices.');
}

function addInvoiceItem() {
  const id = invItemSeq++;
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
  const locked = !!(currentInvoiceRow && currentInvoiceRow.status === 'paid');
  container.innerHTML = invItems.map(item => `
    <div class="invoice-s-f31aea">
      <input type="text" maxlength="200" aria-label="Service description" value="${item.desc}" placeholder="Service description" data-invoice-action-input="update-item-desc" data-invoice-item-id="${item.id}"${locked ? ' disabled' : ''}
        class="invoice-s-9fd163">
      <input type="text" inputmode="numeric" maxlength="6" aria-label="Quantity" value="${item.qty}" data-invoice-action-input="update-item-qty" data-invoice-item-id="${item.id}"${locked ? ' disabled' : ''}
        class="invoice-s-8e4206">
      <input type="text" inputmode="decimal" maxlength="12" aria-label="Rate" value="${item.rate}" placeholder="0.00" data-invoice-action-input="update-item-rate" data-invoice-item-id="${item.id}"${locked ? ' disabled' : ''}
        class="invoice-s-f56476">
      ${locked ? '' : `<button data-invoice-action="remove-item" data-invoice-item-id="${item.id}" class="invoice-s-5de598">&#x2715;</button>`}
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
${pro ? '' : '<div class="footer">Generated with Ryxa Creator Tools &bull; ryxa.io</div>'}
` + '</body></html>';

  // Combine html head + body content
  const fullHtml = html + htmlBody;

  // Add print CSS and save button to the invoice HTML before opening.
  // The print button uses addEventListener (wired by an inline script inside
  // the generated HTML) rather than inline onclick — that way if/when blob
  // URLs inherit the parent page's strict CSP, this still works.
  const printHtml = fullHtml.replace('</body></html>', `
<div id="save-bar" style="position:fixed;top:0;left:0;right:0;background:#7c3aed;color:#fff;padding:10px 16px;display:flex;align-items:flex-start;flex-wrap:wrap;gap:8px;z-index:9999;font-family:Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.2);">
  <span style="font-size:13px;font-weight:500;flex:1;min-width:200px;line-height:1.5;">&#x1F4BE; <strong>Desktop:</strong> Press Ctrl+P (or Cmd+P) &rarr; Save as PDF. &nbsp;&#x1F4F1; <strong>Mobile:</strong> Tap the Share button and choose Save to Files.</span>
  <button id="ryxa-print-btn" style="background:#fff;color:#7c3aed;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">Print / Save PDF</button>
</div>
<style id="print-styles">
  body { padding-top: 80px !important; }
  @media print { #save-bar { display:none !important; } body { padding-top: 0 !important; } }
</style>
<script>
  document.getElementById('ryxa-print-btn').addEventListener('click', function() { window.print(); });
</script>
</body></html>`);

  const blob = new Blob([printHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ END BLOB HTML ZONE                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════╝
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

// =============================================================================
// INVOICE DASHBOARD (Phase 1): list view, save to DB, public URL, status,
// payment collection, delete. The editor above is unchanged; this layer wraps
// it with persistence. Public page: /invoice/<public_id> (invoice-view.html),
// which reads via the get_public_invoice RPC.
// =============================================================================

let invoiceList = [];
let invoicePage = 0;              // zero-based page index
const INVOICE_PAGE_SIZE = 50;     // rows per page (server-side, keeps loads cheap)
let invoiceHasNextPage = false;   // whether a page after the current one exists
let currentInvoiceRow = null;   // the DB row being edited (null = new, unsaved)
let invStatus = 'draft';        // editor's selected status (saved on Save)
let invStripeConnected = null;  // null = unknown, then true/false

function initInvoiceTool() {
  invoicePage = 0;
  // Re-check Stripe connection once per tool entry (not per invoice open), so a
  // user who just connected Stripe in Settings sees the option without a reload.
  invStripeConnected = null;
  showInvoiceListView();
  loadInvoiceList();
}

function showInvoiceListView() {
  const list = document.getElementById('invoice-list-view');
  const editor = document.getElementById('invoice-editor-view');
  if (list) list.style.display = 'block';
  if (editor) editor.style.display = 'none';
}

function showInvoiceEditorView() {
  const list = document.getElementById('invoice-list-view');
  const editor = document.getElementById('invoice-editor-view');
  if (list) list.style.display = 'none';
  if (editor) editor.style.display = 'block';
}

async function loadInvoiceList() {
  if (!currentUser) return;
  const _gen = window.RyxaLoadGen.bump();
  const _anchor = document.getElementById('invoice-list-view');
  window.RyxaLoadBar.start(_anchor);

  // Server-side pagination: fetch only this page's 50 rows. We request one
  // extra row (51) to cheaply detect whether a next page exists, then drop it.
  const from = invoicePage * INVOICE_PAGE_SIZE;
  const to = from + INVOICE_PAGE_SIZE; // inclusive range -> 51 rows

  const MAX_LOAD_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
    try {
      const { data, error } = await sb
        .from('invoices')
        .select('id, public_id, status, to_name, invoice_number, total_cents, updated_at')
        .eq('user_id', currentUser.id)
        .order('updated_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(_anchor); return; }
      const rows = data || [];
      invoiceHasNextPage = rows.length > INVOICE_PAGE_SIZE;
      invoiceList = invoiceHasNextPage ? rows.slice(0, INVOICE_PAGE_SIZE) : rows;
      // If we landed on an empty page beyond the first (e.g. deleted the last row
      // on this page), step back and reload so the user isn't stranded on a blank page.
      if (invoiceList.length === 0 && invoicePage > 0) {
        invoicePage--;
        return loadInvoiceList();
      }
      window.RyxaLoadBar.finish(_anchor);
      renderInvoiceList();
      renderInvoicePager();
      return;
    } catch (e) {
      if (attempt < MAX_LOAD_ATTEMPTS) {
        if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(_anchor); return; }
        window.RyxaLoadBar.retrying(_anchor, 'Having trouble loading your invoices. Retrying...');
        await new Promise(function (resolve) { setTimeout(resolve, 400 * attempt); });
        if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(_anchor); return; }
        continue;
      }
      if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(_anchor); return; }
      console.error('Load invoices failed:', e);
      window.RyxaLoadBar.fail(_anchor);
      invoiceList = [];
      invoiceHasNextPage = false;
      renderInvoiceList();
      renderInvoicePager();
      return;
    }
  }
}

function renderInvoicePager() {
  const pager = document.getElementById('invoice-pager');
  const info = document.getElementById('invoice-pager-info');
  const prev = document.getElementById('invoice-prev-btn');
  const next = document.getElementById('invoice-next-btn');
  if (!pager) return;
  // Only show the pager when there's more than one page in play.
  const show = invoicePage > 0 || invoiceHasNextPage;
  pager.style.display = show ? 'flex' : 'none';
  if (!show) return;
  const start = invoicePage * INVOICE_PAGE_SIZE + 1;
  const end = invoicePage * INVOICE_PAGE_SIZE + invoiceList.length;
  if (info) info.textContent = 'Showing ' + start + '\u2013' + end;
  if (prev) prev.disabled = invoicePage === 0;
  if (next) next.disabled = !invoiceHasNextPage;
}

function renderInvoiceList() {
  const listEl = document.getElementById('invoice-list');
  const emptyEl = document.getElementById('invoice-empty');
  if (!listEl) return;
  if (!invoiceList.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = invoicePage === 0 ? 'block' : 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const header = '<div class="inv-row-header">' +
    '<div>Recipient</div><div>Invoice #</div><div>Amount</div><div>Status</div><div></div>' +
    '</div>';

  const rows = invoiceList.map(function (inv) {
    const recipient = escapeHtml(inv.to_name || 'Untitled invoice');
    const num = inv.invoice_number ? escapeHtml(inv.invoice_number) : '\u2014';
    const dt = inv.updated_at ? new Date(inv.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const amt = formatMoney(inv.total_cents || 0, { alwaysShowCents: true });
    const badge = inv.status === 'paid' ? '<span class="inv-badge paid">Paid</span>'
      : inv.status === 'pending' ? '<span class="inv-badge pending">Pending</span>'
      : '<span class="inv-badge">Draft</span>';
    return '<div class="inv-row" data-invoice-action="open-invoice" data-invoice-id="' + inv.id + '">' +
      '<div class="inv-row-recipient">' + recipient + (dt ? '<div class="bio-s-5f3468">' + dt + '</div>' : '') + '</div>' +
      '<div class="inv-row-num">' + num + '</div>' +
      '<div class="inv-row-amt">' + amt + '</div>' +
      '<div class="inv-row-status-cell">' + badge + '</div>' +
      '<div class="inv-row-actions">' +
        '<button class="inv-del-btn" data-invoice-action="delete-invoice" data-invoice-id="' + inv.id + '" title="Delete invoice" aria-label="Delete invoice">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');

  listEl.innerHTML = '<div class="inv-table">' + header + rows + '</div>';
}

function genInvPublicId() {
  // 16 chars of base-36 from cryptographically-random bytes. ~82 bits of
  // entropy, so collisions against the public_id unique index are astronomically
  // unlikely. If the unique constraint ever does reject an insert, saveInvoice
  // surfaces the error and the user can retry (a fresh id is generated).
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += alphabet[bytes[i] % 36];
  return s;
}

function openInvoiceEditor(row) {
  currentInvoiceRow = row || null;
  showInvoiceEditorView();
  // Base init (dates, default number, first empty item)
  invItems = [];
  initInvoiceGenerator();
  loadSavedLogo();

  const setVal = function (id, v) { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };

  if (row) {
    setVal('inv-from-name', row.from_name); setVal('inv-from-email', row.from_email); setVal('inv-from-address', row.from_address);
    setVal('inv-to-name', row.to_name); setVal('inv-to-email', row.to_email); setVal('inv-to-address', row.to_address);
    setVal('inv-number', row.invoice_number); setVal('inv-date', row.issue_date || ''); setVal('inv-due', row.due_date || '');
    setVal('inv-tax', row.tax_pct || 0); setVal('inv-notes', row.notes);
    invItems = (Array.isArray(row.items) ? row.items : []).map(function (it) {
      return { id: invItemSeq++, desc: it.desc || '', qty: Number(it.qty) || 0, rate: Number(it.rate) || 0 };
    });
    if (!invItems.length) addInvoiceItem(); else { renderInvoiceItems(); calcTotals(); }
    invStatus = row.status || 'draft';
    setInvPayMethodUI(row.payment_method || 'none', row.payment_details || '');
  } else {
    setVal('inv-from-name', ''); setVal('inv-from-email', ''); setVal('inv-from-address', '');
    setVal('inv-to-name', ''); setVal('inv-to-email', ''); setVal('inv-to-address', '');
    setVal('inv-notes', ''); setVal('inv-tax', 0);
    invStatus = 'draft';
    setInvPayMethodUI('none', '');
    calcTotals();
  }
  updateInvStatusUI();
  updateInvUrlBar();
  updateInvEmailLock();
  updateInvSendUI();
  refreshInvStripeOption();
  applyInvPaidLock();
  // Sliders need a settled layout to measure button positions; nudge them once
  // the editor is painted (and again shortly after, for font/reflow).
  requestAnimationFrame(repositionInvSliders);
  setTimeout(repositionInvSliders, 120);
}

// A paid invoice is locked: its details, amounts, and status can't change
// (they must stay in sync with the recorded revenue and what the payer paid).
// The form is made read-only and Save/Send are hidden.
function applyInvPaidLock() {
  const paid = !!(currentInvoiceRow && currentInvoiceRow.status === 'paid');
  const editor = document.getElementById('invoice-editor-view');
  if (!editor) return;
  const fields = editor.querySelectorAll('input, textarea');
  fields.forEach(function (el) {
    if (el.id === 'inv-url-input') return; // the read-only URL field stays copyable
    if (el.id === 'inv-to-email') {
      // Email locks when paid (all fields lock) OR when sent (handled by
      // updateInvEmailLock). For a non-paid invoice, defer to updateInvEmailLock.
      if (paid) el.disabled = true;
      return;
    }
    el.disabled = paid;
  });
  // Re-enable non-paid case handled by updateInvEmailLock / status logic on open,
  // so only apply disabling here; a fresh open of a non-paid invoice starts clean.
  const saveBtn = document.getElementById('inv-save-btn');
  const sendBtn = document.getElementById('inv-send-btn');
  const addItemBtn = editor.querySelector('[data-invoice-action="add-item"]');
  if (saveBtn) saveBtn.style.display = paid ? 'none' : '';
  if (sendBtn && paid) sendBtn.style.display = 'none';
  if (addItemBtn) addItemBtn.style.display = paid ? 'none' : '';
  // Payment method control: disable all when paid. When NOT paid, re-enable the
  // non-Stripe buttons here (the Stripe button's enabled state is owned by
  // refreshInvStripeOption, which runs alongside this on open).
  document.querySelectorAll('#inv-pay-options .inv-seg-btn').forEach(function (b) {
    if (b.id === 'inv-pay-stripe-btn') { if (paid) b.disabled = true; return; }
    b.disabled = paid;
  });
  // Show a paid-lock banner
  let banner = document.getElementById('inv-paid-lock-banner');
  if (paid && !banner) {
    banner = document.createElement('div');
    banner.id = 'inv-paid-lock-banner';
    banner.className = 'inv-paid-lock-banner';
    banner.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> This invoice is paid and locked. Its details can no longer be changed.';
    const topbar = editor.querySelector('.inv-editor-topbar');
    if (topbar && topbar.nextSibling) editor.insertBefore(banner, topbar.nextSibling);
    else editor.appendChild(banner);
  } else if (!paid && banner) {
    banner.remove();
  }
}

function repositionInvSliders() {
  const payActive = document.querySelector('#inv-pay-options .inv-seg-btn.active');
  positionInvSlider('inv-pay-options', 'inv-pay-slider', payActive, false);
  const stActive = document.querySelector('#inv-status-seg .inv-seg-btn.active');
  positionInvSlider('inv-status-seg', 'inv-status-slider', stActive, invStatus === 'paid');
}

// Once an invoice has been emailed, the Bill To email is locked for good.
function updateInvEmailLock() {
  const emailEl = document.getElementById('inv-to-email');
  const lockEl = document.getElementById('inv-email-lock');
  if (!emailEl) return;
  const locked = !!(currentInvoiceRow && currentInvoiceRow.email_locked);
  emailEl.disabled = locked;
  emailEl.title = locked ? 'This email is locked because the invoice was already sent.' : '';
  emailEl.style.paddingRight = locked ? '38px' : '';
  if (lockEl) lockEl.style.display = locked ? 'flex' : 'none';
}

// Send Invoice: visible once the invoice is saved. Enabled until it has been
// sent (invoices can only be emailed once); after that it reads "Sent".
function updateInvSendUI() {
  const btn = document.getElementById('inv-send-btn');
  if (!btn) return;
  if (!currentInvoiceRow || !currentInvoiceRow.id) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = '';
  if (currentInvoiceRow.sent_at) {
    btn.disabled = true;
    btn.textContent = 'Invoice Sent';
    btn.classList.add('inv-sent-disabled');
  } else {
    btn.disabled = false;
    btn.textContent = 'Send Invoice';
    btn.classList.remove('inv-sent-disabled');
  }
}

async function sendInvoice() {
  if (!currentInvoiceRow || !currentInvoiceRow.id || currentInvoiceRow.sent_at) return;
  // A paid invoice can't be sent - there's nothing to request payment for.
  if (currentInvoiceRow.status === 'paid') {
    if (typeof showDashToast === 'function') showDashToast('error', 'This invoice is already paid and cannot be sent.');
    return;
  }
  const toEmail = (document.getElementById('inv-to-email') || {}).value || currentInvoiceRow.to_email || '';
  if (!toEmail.trim()) {
    if (typeof showDashToast === 'function') showDashToast('error', 'Add the recipient email in Bill To, then Save, before sending.');
    return;
  }
  const doSend = async function () {
    const btn = document.getElementById('inv-send-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
      // Sending an invoice means requesting payment, so it must be pending -
      // never save it as paid just because the status toggle was left there.
      // (A paid invoice can't be sent anyway.)
      if (invStatus === 'paid') invStatus = 'pending';
      updateInvStatusUI();
      // Save first so the email reflects exactly what is on screen. Use the
      // direct save (send happens on pending invoices, not the paid transition).
      await doSaveInvoice();
      if (!currentInvoiceRow || !currentInvoiceRow.id) throw new Error('not saved');
      const headers = Object.assign({ 'Content-Type': 'application/json' },
        (typeof Auth !== 'undefined' && Auth.headers) ? Auth.headers() : {});
      const r = await fetch('/api/invoice-send', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ invoice_id: currentInvoiceRow.id })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error((j && j.error) || 'send failed');
      if (j.invoice) currentInvoiceRow = j.invoice;
      invStatus = currentInvoiceRow.status || invStatus;
      updateInvStatusUI();
      updateInvEmailLock();
      updateInvSendUI();
      if (typeof showDashToast === 'function') showDashToast('success', 'Invoice emailed to ' + (currentInvoiceRow.to_email || 'the recipient'));
    } catch (e) {
      console.error('Send invoice failed:', e);
      if (typeof showDashToast === 'function') showDashToast('error', e.message && e.message !== 'send failed' ? e.message : 'Could not send the invoice. Please try again.');
      updateInvSendUI();
    }
  };
  if (typeof showModalConfirm === 'function') {
    showModalConfirm('Send this invoice?',
      'It will be emailed to ' + toEmail.trim() + ' with a link to the public invoice page. Invoices can only be emailed once, and the recipient email locks after sending.',
      doSend, 'Send Invoice', 'Cancel', { danger: false, success: true });
  } else if (confirm('Email this invoice to ' + toEmail.trim() + '? Invoices can only be emailed once.')) {
    doSend();
  }
}

function updateInvUrlBar() {
  const bar = document.getElementById('inv-url-bar');
  const input = document.getElementById('inv-url-input');
  if (!bar || !input) return;
  if (currentInvoiceRow && currentInvoiceRow.public_id) {
    input.value = currentInvoiceRow.public_id;
    bar.style.display = 'block';
  } else {
    bar.style.display = 'none';
  }
}

// Move a segmented control's sliding highlight under its active button.
// isPaid tints the slider green (used for the Paid status).
function positionInvSlider(segId, sliderId, activeBtn, isPaid) {
  const seg = document.getElementById(segId);
  const slider = document.getElementById(sliderId);
  if (!seg || !slider || !activeBtn) return;
  // If the control has wrapped onto multiple rows, a single-row slider can't
  // track it; hide the slider (CSS) and fall back to a flat fill on the active
  // button instead. Detect wrap by comparing the active button's vertical
  // offset within the control against the first button's.
  const firstBtn = seg.querySelector('.inv-seg-btn');
  const wrapped = firstBtn && Math.abs(activeBtn.offsetTop - firstBtn.offsetTop) > 2;
  if (wrapped) {
    seg.classList.add('no-slider');
    slider.style.width = '0';
    return;
  }
  seg.classList.remove('no-slider');
  slider.style.left = activeBtn.offsetLeft + 'px';
  slider.style.top = activeBtn.offsetTop + 'px';
  slider.style.width = activeBtn.offsetWidth + 'px';
  slider.style.height = activeBtn.offsetHeight + 'px';
  slider.classList.toggle('paid', !!isPaid);
}

function updateInvStatusUI() {
  const sent = !!(currentInvoiceRow && currentInvoiceRow.sent_at);
  // The hard lock applies only when the invoice is ALREADY saved as paid (or was
  // paid via Stripe). The in-editor selector value (invStatus) does not lock
  // anything, so you can freely toggle Pending <-> Paid before saving.
  const savedPaid = !!(currentInvoiceRow && currentInvoiceRow.status === 'paid');
  let active = null;
  document.querySelectorAll('#inv-status-seg .inv-seg-btn').forEach(function (b) {
    const val = b.getAttribute('data-invoice-status');
    const on = val === invStatus;
    b.classList.toggle('active', on);
    b.classList.toggle('paid-active', on && invStatus === 'paid');
    if (on) active = b;
    let disabled = false;
    // Draft is unavailable once the invoice has been sent (it moved to pending
    // and can't go back to draft).
    if (val === 'draft' && sent) disabled = true;
    // Once genuinely paid, the status is locked in.
    if (savedPaid) disabled = (val !== 'paid');
    b.disabled = disabled;
  });
  positionInvSlider('inv-status-seg', 'inv-status-slider', active, invStatus === 'paid');
}

function setInvPayMethodUI(method, details) {
  // Stripe can only be selected when connected; fall back to None otherwise.
  const stripeBtn = document.getElementById('inv-pay-stripe-btn');
  if (method === 'stripe' && stripeBtn && stripeBtn.disabled) method = 'none';
  setInvPayMethod(method);
  const detailsEl = document.getElementById('inv-pay-details');
  if (detailsEl) detailsEl.value = details || '';
  applyInvPayDetailsVisibility();
}

function setInvPayMethod(method) {
  const hidden = document.getElementById('inv-pay-method-value');
  if (hidden) hidden.value = method;
  let active = null;
  document.querySelectorAll('#inv-pay-options .inv-seg-btn').forEach(function (b) {
    const on = b.getAttribute('data-invoice-method') === method;
    b.classList.toggle('active', on);
    if (on) active = b;
  });
  positionInvSlider('inv-pay-options', 'inv-pay-slider', active, false);
  applyInvPayDetailsVisibility();
}

function currentInvPayMethod() {
  const hidden = document.getElementById('inv-pay-method-value');
  return hidden ? hidden.value : 'none';
}

function applyInvPayDetailsVisibility() {
  const method = currentInvPayMethod();
  const detailsEl = document.getElementById('inv-pay-details');
  if (!detailsEl) return;
  if (method === 'zelle' || method === 'venmo' || method === 'other') {
    detailsEl.style.display = 'block';
    detailsEl.placeholder = method === 'zelle' ? 'Your Zelle email or phone number'
      : method === 'venmo' ? 'Your Venmo @handle'
      : 'Payment instructions shown to the recipient';
  } else {
    detailsEl.style.display = 'none';
  }
}

// Stripe option: enabled when the creator's Stripe account is connected (the
// public page then shows a card checkout). Not connected -> disabled + nudge.
async function refreshInvStripeOption() {
  const note = document.getElementById('inv-pay-stripe-note');
  const stripeBtn = document.getElementById('inv-pay-stripe-btn');
  if (invStripeConnected === null) {
    try {
      const headers = (typeof Auth !== 'undefined' && Auth.headers) ? Auth.headers() : {};
      const r = await fetch('/api/stripe-status', { headers: headers });
      const j = await r.json();
      invStripeConnected = !!(j && j.connected);
    } catch (e) { invStripeConnected = false; }
  }
  if (stripeBtn) stripeBtn.disabled = !invStripeConnected;
  if (note) {
    note.textContent = invStripeConnected
      ? 'Recipients can pay this invoice by card on its public page.'
      : 'Connect Stripe to collect invoice payments';
    note.style.display = '';
  }
  if (invStripeConnected) {
    if (currentInvoiceRow && currentInvoiceRow.payment_method === 'stripe') {
      // saved Stripe invoice: reflect it now that the button is enabled
      setInvPayMethod('stripe');
    } else if (!currentInvoiceRow && currentInvPayMethod() === 'none') {
      // brand-new invoice with Stripe connected: default to Stripe
      setInvPayMethod('stripe');
    }
  }
}

function collectInvoicePayload() {
  const val = function (id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const items = invItems.map(function (i) { return { desc: i.desc || '', qty: Number(i.qty) || 0, rate: Number(i.rate) || 0 }; });
  const subtotal = items.reduce(function (s, i) { return s + i.qty * i.rate; }, 0);
  const taxPct = parseFloat(val('inv-tax')) || 0;
  const total = subtotal + subtotal * taxPct / 100;
  const checked = currentInvPayMethod();
  return {
    from_name: val('inv-from-name').slice(0, 200),
    from_email: val('inv-from-email').slice(0, 254),
    from_address: val('inv-from-address').slice(0, 300),
    to_name: val('inv-to-name').slice(0, 200),
    to_email: val('inv-to-email').slice(0, 254),
    to_address: val('inv-to-address').slice(0, 300),
    invoice_number: val('inv-number').slice(0, 24),
    issue_date: val('inv-date') || null,
    due_date: val('inv-due') || null,
    items: items,
    tax_pct: taxPct,
    subtotal_cents: Math.round(subtotal * 100),
    total_cents: Math.round(total * 100),
    notes: val('inv-notes').slice(0, 2000),
    payment_method: checked || 'none',
    payment_details: val('inv-pay-details').slice(0, 300),
    status: invStatus,
    // Persist the logo URL so it renders on the public invoice page. Only store
    // a real uploaded URL (http/https), never a base64 data: URL, which would
    // bloat the row. Pro-gated at the UI level.
    logo_url: (typeof isPro === 'function' && isPro() && invLogoDataUrl && /^https?:\/\//.test(invLogoDataUrl)) ? invLogoDataUrl : ''
  };
}

async function saveInvoice() {
  if (!currentUser) return;
  // A paid invoice is locked and cannot be re-saved with changes.
  if (currentInvoiceRow && currentInvoiceRow.status === 'paid') {
    if (typeof showDashToast === 'function') showDashToast('error', 'This invoice is paid and locked. It cannot be changed.');
    return;
  }
  // Marking an invoice paid is a one-way action: it records revenue and locks
  // the invoice from further edits. Confirm before saving that transition.
  const enteringPaid = invStatus === 'paid' && !(currentInvoiceRow && currentInvoiceRow.status === 'paid');
  if (enteringPaid && typeof showModalConfirm === 'function') {
    // Revert the toggle to its saved value up front, so that if the user
    // cancels (the shared modal has no cancel callback), no stale 'paid' is
    // left in memory to leak into a later Save or Send. We only re-commit
    // 'paid' inside the confirm handler.
    const savedStatus = (currentInvoiceRow && currentInvoiceRow.status) || 'pending';
    invStatus = savedStatus;
    updateInvStatusUI();
    showModalConfirm(
      'Mark as paid?',
      'This invoice will be marked paid, recorded in your revenue, and locked from further edits. You will not be able to change it afterward.',
      function () { invStatus = 'paid'; updateInvStatusUI(); doSaveInvoice(); },
      'Mark as Paid', 'Cancel', { danger: false, success: true }
    );
    return;
  }
  doSaveInvoice();
}

async function doSaveInvoice() {
  if (!currentUser) return;
  const btn = document.getElementById('inv-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    const payload = collectInvoicePayload();
    // A sent invoice's recipient email is locked; never overwrite it.
    if (currentInvoiceRow && currentInvoiceRow.email_locked) {
      payload.to_email = currentInvoiceRow.to_email;
    }
    if (currentInvoiceRow && currentInvoiceRow.id) {
      const { data, error } = await sb.from('invoices')
        .update(payload)
        .eq('id', currentInvoiceRow.id)
        .eq('user_id', currentUser.id)
        .select().single();
      if (error) throw error;
      currentInvoiceRow = data;
    } else {
      payload.user_id = currentUser.id;
      payload.public_id = genInvPublicId();
      const { data, error } = await sb.from('invoices').insert(payload).select().single();
      if (error) throw error;
      currentInvoiceRow = data;
    }
    updateInvUrlBar();
    updateInvSendUI();
    // If this save just made the invoice paid, lock the editor immediately
    // (no need to reopen it) so its now-locked state is reflected at once.
    if (currentInvoiceRow && currentInvoiceRow.status === 'paid') {
      updateInvStatusUI();
      renderInvoiceItems(); // re-render so the remove-item X is removed
      calcTotals();
      applyInvPaidLock();
    }
    if (typeof showDashToast === 'function') showDashToast('success', 'Invoice saved');
  } catch (e) {
    console.error('Save invoice failed:', e, '| message:', e && e.message, '| details:', e && e.details, '| hint:', e && e.hint, '| code:', e && e.code);
    var msg = (e && (e.message || e.details)) ? (e.message || e.details) : 'Could not save the invoice. Please try again.';
    if (typeof showDashToast === 'function') showDashToast('error', msg);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}

function copyInvoiceUrl() {
  if (!currentInvoiceRow || !currentInvoiceRow.public_id) return;
  const url = 'https://www.ryxa.io/invoice/' + currentInvoiceRow.public_id;
  const done = function () { if (typeof showDashToast === 'function') showDashToast('success', 'Invoice URL copied'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(function () {});
  } else {
    const ta = document.createElement('textarea');
    ta.value = url; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    ta.remove();
  }
}

function deleteInvoiceById(id) {
  const doDelete = async function () {
    try {
      const { error } = await sb.from('invoices').delete().eq('id', id).eq('user_id', currentUser.id);
      if (error) throw error;
      // Revenue cleanup happens in the DB trigger (paid invoices remove their
      // revenue_events row on delete), so analytics stay consistent.
      if (typeof showDashToast === 'function') showDashToast('success', 'Invoice deleted');
    } catch (e) {
      console.error('Delete invoice failed:', e);
      if (typeof showDashToast === 'function') showDashToast('error', 'Could not delete the invoice.');
    }
    loadInvoiceList();
  };
  if (typeof showModalConfirm === 'function') {
    showModalConfirm('Delete this invoice?', 'This removes the invoice and its public page. If it was marked Paid, it is also removed from your revenue analytics. This cannot be undone.', doDelete);
  } else if (confirm('Delete this invoice? This cannot be undone.')) {
    doDelete();
  }
}

// ---- Action registrations (dashboard DOM only) ------------------------------
invoiceRegisterAction('create-new', function () { openInvoiceEditor(null); });
invoiceRegisterAction('open-invoice', function (e, el) {
  const id = el.getAttribute('data-invoice-id');
  const row = invoiceList.find(function (r) { return r.id === id; });
  if (!row) return;
  const _gen = window.RyxaLoadGen.bump();
  const _anchor = document.getElementById('invoice-editor-view');
  window.RyxaLoadBar.start(_anchor);
  // Fetch the full row (the list query is a slim projection).
  sb.from('invoices').select('*').eq('id', id).eq('user_id', currentUser.id).single()
    .then(function (res) {
      if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(_anchor); return; }
      if (res.error || !res.data) {
        window.RyxaLoadBar.fail(_anchor);
        console.error('Open invoice failed:', res.error);
        if (typeof showDashToast === 'function') showDashToast('error', 'Could not open that invoice. It may have been deleted.');
        loadInvoiceList();
        return;
      }
      window.RyxaLoadBar.finish(_anchor);
      openInvoiceEditor(res.data);
    })
    .catch(function (err) {
      if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(_anchor); return; }
      window.RyxaLoadBar.fail(_anchor);
      console.error('Open invoice error:', err);
      if (typeof showDashToast === 'function') showDashToast('error', 'Could not open that invoice. Please try again.');
    });
});
invoiceRegisterAction('delete-invoice', function (e, el) {
  e.stopPropagation();
  deleteInvoiceById(el.getAttribute('data-invoice-id'));
});
invoiceRegisterAction('back-to-list', function () {
  showInvoiceListView();
  loadInvoiceList();
});
invoiceRegisterAction('page-prev', function () {
  if (invoicePage > 0) { invoicePage--; loadInvoiceList(); }
});
invoiceRegisterAction('page-next', function () {
  if (invoiceHasNextPage) { invoicePage++; loadInvoiceList(); }
});
invoiceRegisterAction('save-invoice', function () { saveInvoice(); });
invoiceRegisterAction('send-invoice', function () { sendInvoice(); });
invoiceRegisterAction('copy-url', function () { copyInvoiceUrl(); });
invoiceRegisterAction('pay-method-set', function (e, el) {
  const m = el.getAttribute('data-invoice-method') || 'none';
  if (el.disabled) return;
  setInvPayMethod(m);
});
invoiceRegisterAction('set-status', function (e, el) {
  if (el.disabled) return;
  invStatus = el.getAttribute('data-invoice-status') || 'draft';
  updateInvStatusUI();
});
// Keep the sliding highlights aligned if the viewport / layout changes.
window.addEventListener('resize', function () {
  if (typeof repositionInvSliders === 'function'
      && document.getElementById('invoice-editor-view')
      && document.getElementById('invoice-editor-view').style.display !== 'none') {
    repositionInvSliders();
  }
});

// =============================================================================
// DIRECT PDF DOWNLOAD (Phase 2 UX): generate a real .pdf with pdf-lib (already
// loaded globally as window.PDFLib for the pdf-sign tool) and download it
// straight to the user's device - no new browser tab, no print dialog.
// =============================================================================

function toggleInvDownloadMenu() {
  const menu = document.getElementById('inv-download-menu');
  if (!menu) return;
  const open = window.getComputedStyle(menu).display !== 'none';
  menu.style.display = open ? 'none' : 'block';
}
function closeInvDownloadMenu() {
  const menu = document.getElementById('inv-download-menu');
  if (menu) menu.style.display = 'none';
}

async function downloadInvoicePDFFile() {
  closeInvDownloadMenu();
  if (!window.PDFLib) {
    // Fallback to the legacy print approach if the library isn't ready.
    if (typeof downloadInvoicePDF === 'function') downloadInvoicePDF();
    return;
  }
  const val = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
  const fromName = val('inv-from-name') || 'Your Name';
  const fromEmail = val('inv-from-email');
  const fromAddr = val('inv-from-address');
  const toName = val('inv-to-name') || 'Client Name';
  const toEmail = val('inv-to-email');
  const toAddr = val('inv-to-address');
  const invNum = val('inv-number') || 'INV-001';
  const invDate = val('inv-date');
  const invDue = val('inv-due');
  const notes = val('inv-notes');
  const taxPct = parseFloat(val('inv-tax')) || 0;
  const subtotal = invItems.reduce(function (s, i) { return s + i.qty * i.rate; }, 0);
  const taxAmt = subtotal * taxPct / 100;
  const total = subtotal + taxAmt;
  const fmt = function (n) { return formatMoney(Math.round(n * 100), { alwaysShowCents: true }); };

  try {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    let page = doc.addPage([595, 842]); // A4 portrait, points
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const M = 50;                 // margin
    const W = 595;
    const dark = rgb(0.07, 0.07, 0.07);
    const gray = rgb(0.42, 0.42, 0.42);
    const line = rgb(0.9, 0.9, 0.9);
    let y = 792;

    const text = function (s, x, yy, opts) {
      opts = opts || {};
      page.drawText(String(s == null ? '' : s), {
        x: x, y: yy, size: opts.size || 10, font: opts.bold ? bold : font,
        color: opts.color || dark
      });
    };
    const rightText = function (s, xRight, yy, opts) {
      opts = opts || {};
      s = String(s == null ? '' : s);
      const size = opts.size || 10;
      const w = (opts.bold ? bold : font).widthOfTextAtSize(s, size);
      text(s, xRight - w, yy, opts);
    };
    const ensureRoom = function (needed) {
      if (y - needed < 60) { page = doc.addPage([595, 842]); y = 792; }
    };

    // Header
    text('INVOICE', M, y, { size: 26, bold: true });
    rightText('#' + invNum, W - M, y + 6, { size: 11, color: gray });
    y -= 14;
    if (invDate) { rightText('Issued: ' + invDate, W - M, y, { size: 9, color: gray }); y -= 12; }
    if (invDue) { rightText('Due: ' + invDue, W - M, y, { size: 9, color: gray }); }
    y -= 34;

    // Parties
    const colR = 320;
    text('FROM', M, y, { size: 8, bold: true, color: gray });
    text('BILL TO', colR, y, { size: 8, bold: true, color: gray });
    y -= 15;
    text(fromName, M, y, { size: 12, bold: true });
    text(toName, colR, y, { size: 12, bold: true });
    y -= 14;
    [fromEmail, fromAddr].filter(Boolean).forEach(function (l, i) { text(l, M, y - i * 12, { size: 9, color: gray }); });
    [toEmail, toAddr].filter(Boolean).forEach(function (l, i) { text(l, colR, y - i * 12, { size: 9, color: gray }); });
    y -= 46;

    // Items header
    page.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 1, color: line });
    y -= 16;
    text('DESCRIPTION', M, y, { size: 8, bold: true, color: gray });
    rightText('QTY', 380, y, { size: 8, bold: true, color: gray });
    rightText('RATE', 470, y, { size: 8, bold: true, color: gray });
    rightText('AMOUNT', W - M, y, { size: 8, bold: true, color: gray });
    y -= 8;
    page.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 1, color: line });
    y -= 18;

    invItems.forEach(function (it) {
      ensureRoom(18);
      const desc = (it.desc || 'Service').slice(0, 60);
      text(desc, M, y, { size: 10 });
      rightText(String(it.qty), 380, y, { size: 10, color: gray });
      rightText(fmt(it.rate), 470, y, { size: 10, color: gray });
      rightText(fmt(it.qty * it.rate), W - M, y, { size: 10 });
      y -= 10;
      page.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 0.5, color: line });
      y -= 14;
    });

    // Totals
    y -= 6;
    ensureRoom(60);
    rightText('Subtotal', W - M - 90, y, { size: 10, color: gray });
    rightText(fmt(subtotal), W - M, y, { size: 10 });
    y -= 16;
    if (taxPct > 0) {
      rightText('Tax (' + taxPct + '%)', W - M - 90, y, { size: 10, color: gray });
      rightText(fmt(taxAmt), W - M, y, { size: 10 });
      y -= 16;
    }
    rightText('Total', W - M - 90, y, { size: 13, bold: true });
    rightText(fmt(total), W - M, y, { size: 13, bold: true });
    y -= 30;

    // Notes
    if (notes) {
      ensureRoom(40);
      text('NOTES', M, y, { size: 8, bold: true, color: gray });
      y -= 14;
      String(notes).split('\n').forEach(function (l) {
        // simple wrap at ~90 chars
        const chunks = l.match(/.{1,90}(\s|$)/g) || [l];
        chunks.forEach(function (c) { ensureRoom(14); text(c.trim(), M, y, { size: 9, color: gray }); y -= 12; });
      });
    }

    const bytes = await doc.save();
    const fileName = 'Invoice-' + (invNum || '001').replace(/[^\w\-]/g, '') + '.pdf';
    const blob = new Blob([bytes], { type: 'application/pdf' });

    // On iOS, an <a download> click just opens the PDF in the viewer (the
    // download attribute is ignored). The Web Share API opens the native share
    // sheet instead, where "Save to Files" (and Photos, Mail, etc.) is offered.
    // Use it when the browser can share this file; otherwise fall back to the
    // classic anchor download (desktop, Android).
    try {
      const file = new File([blob], fileName, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName });
        return;
      }
    } catch (shareErr) {
      // User cancelled the share sheet, or share failed: fall through to the
      // anchor download below. A cancel is not an error worth surfacing.
      if (shareErr && shareErr.name === 'AbortError') return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  } catch (e) {
    console.error('PDF generation failed:', e);
    if (typeof showDashToast === 'function') showDashToast('error', 'Could not generate the PDF. Please try again.');
  }
}

invoiceRegisterAction('toggle-download-menu', function (e) {
  if (e && e.stopImmediatePropagation) e.stopImmediatePropagation();
  toggleInvDownloadMenu();
});
// Route the menu item to the direct-file generator (overrides the legacy
// window-opening download-pdf action for this button).
invoiceRegisterAction('download-pdf', function () { downloadInvoicePDFFile(); });
// Close the menu on any outside click.
document.addEventListener('click', function (e) {
  const wrap = e.target.closest ? e.target.closest('.inv-download-wrap') : null;
  if (!wrap) closeInvDownloadMenu();
});
