// =============================================================================
// /js/pdfsign.js — PDF Sign (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the PDF Sign tool. Lets users upload a PDF, drop or
// click-to-place fields (signature, text, date, checkbox, crossout), then
// download or print the signed/filled PDF.
//
// Uses PDF.js (rendering) and PDF-lib (final stamping) — both loaded at top
// of dashboard.html.
//
// CROSS-TOOL DEPENDENCY:
//   • js/deals.js (Brand Deals CRM) reuses PDF Sign infrastructure for the
//     "sign contract" flow inside a deal. It reads/writes these globals:
//       pdfsignDoc, pdfsignOriginalBytes, pdfsignFields, pdfsignFilename,
//       pdfsignInited, pdfsignActiveFieldType
//     And calls these functions:
//       renderAllPages, resetPdfSign (indirectly via the New PDF button)
//   • All of the above are declared at module-scope here. Because this file
//     is loaded as a regular <script> (not module), those become window
//     globals just like they were when this code lived in dashboard.html.
//     No changes needed in deals.js.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/pdfsign.js
//   • Phase 2: inline onclick/onchange/oninput/onkeydown → data-pdfsign-action
//   • Phase 3: static inline style="..." → hash-named CSS classes
//
// INTENTIONALLY KEPT INLINE:
//   • ondrop / ondragover / ondragleave on the upload dropzone — drag is
//     timing-sensitive and the existing handlers do event.preventDefault().
//   • ondragstart on palette items — HTML5 native drag, needs the inline
//     attribute (or a much more invasive rewrite) to work.
//
// External dependencies on window: sb, currentUser, isPro, escapeHtml,
// showModalAlert, plus the libraries `window.pdfjsLib` and `window.PDFLib`.
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE
// =============================================================================

const pdfsignActions = {};

function pdfsignRegisterAction(action, handler) {
  pdfsignActions[action] = handler;
}

function pdfsignFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['pdfsignAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.pdfsignAction) {
        const wantEvent = el.dataset.pdfsignEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.pdfsignAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function pdfsignDispatchEvent(event) {
  const found = pdfsignFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = pdfsignActions[found.action];
  if (!handler) {
    console.warn('[pdfsign] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur', 'keydown'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, pdfsignDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 10801-11731 (PDF Sign) ----------
// =====================================================
// PDF SIGN
// =====================================================
const PDFSIGN_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const PDFSIGN_RENDER_SCALE = 1.5; // Higher = sharper rendering

let pdfsignDoc = null; // PDF.js document
let pdfsignOriginalBytes = null; // Uint8Array of original PDF, kept for final merge
let pdfsignFilename = 'document.pdf';
let pdfsignInited = false;
let pdfsignFields = []; // Array of field objects, see createField()
let pdfsignFieldIdSeq = 1;
let pdfsignSessionSig = null; // Data URL of saved signature for this session
let pdfsignActiveFieldId = null; // For modal editing
let pdfsignDragType = null; // Palette item being dragged ('signature' | 'text' | 'date' | 'checkbox')
let pdfsignPageDimensions = []; // PDF original page sizes in points (for PDF-lib stamping)

function initPdfSignTool() {
  if (pdfsignInited) return;
  pdfsignInited = true;
  // Set up signature canvas when needed
  resetPdfSign();
}

function resetPdfSign() {
  // Clean up previous PDF
  if (pdfsignDoc) {
    try { pdfsignDoc.destroy(); } catch (e) {}
    pdfsignDoc = null;
  }
  pdfsignOriginalBytes = null;
  pdfsignFields = [];
  pdfsignPageDimensions = [];
  pdfsignActiveFieldId = null;
  pdfsignFilename = 'document.pdf';
  // Show upload, hide editor
  document.getElementById('pdfsign-upload').style.display = 'block';
  document.getElementById('pdfsign-editor').style.display = 'none';
  document.getElementById('pdfsign-upload-error').style.display = 'none';
  document.getElementById('pdfsign-pages').innerHTML = '';
}

// ======== UPLOAD ========
function onPdfDragOver(e) {
  e.preventDefault();
  document.getElementById('pdfsign-dropzone').classList.add('drag-over');
}
function onPdfDragLeave(e) {
  document.getElementById('pdfsign-dropzone').classList.remove('drag-over');
}
function onPdfDrop(e) {
  e.preventDefault();
  document.getElementById('pdfsign-dropzone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) onPdfFile(file);
}

async function onPdfFile(file) {
  const err = document.getElementById('pdfsign-upload-error');
  err.style.display = 'none';
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    err.textContent = 'Please upload a PDF file.';
    err.style.display = 'block';
    return;
  }
  if (file.size > PDFSIGN_MAX_SIZE) {
    err.textContent = `File is too large. Max ${PDFSIGN_MAX_SIZE / 1024 / 1024}MB.`;
    err.style.display = 'block';
    return;
  }
  try {
    // Wait for PDF.js to load
    await window.__pdfjsReady;
    if (!window.pdfjsLib) throw new Error('PDF viewer not loaded. Refresh the page.');

    const arrayBuffer = await file.arrayBuffer();
    pdfsignOriginalBytes = new Uint8Array(arrayBuffer);
    pdfsignFilename = file.name;

    // Load with PDF.js (pass a copy since PDF.js transfers ownership)
    const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(pdfsignOriginalBytes) });
    pdfsignDoc = await loadingTask.promise;

    // Switch to editor view
    document.getElementById('pdfsign-upload').style.display = 'none';
    document.getElementById('pdfsign-editor').style.display = 'block';
    document.getElementById('pdfsign-filename').textContent = file.name;
    document.getElementById('pdfsign-pages-info').textContent = `${pdfsignDoc.numPages} page${pdfsignDoc.numPages > 1 ? 's' : ''} · ${(file.size / 1024).toFixed(0)}KB`;

    await renderAllPages();
  } catch (e) {
    console.error('PDF load error', e);
    err.textContent = e.message || 'Could not read PDF. The file may be corrupted or password-protected.';
    err.style.display = 'block';
  }
}

async function renderAllPages() {
  const container = document.getElementById('pdfsign-pages');
  container.innerHTML = '';
  pdfsignPageDimensions = [];
  for (let i = 1; i <= pdfsignDoc.numPages; i++) {
    const page = await pdfsignDoc.getPage(i);
    const origViewport = page.getViewport({ scale: 1 });
    pdfsignPageDimensions.push({ width: origViewport.width, height: origViewport.height });

    const viewport = page.getViewport({ scale: PDFSIGN_RENDER_SCALE });
    const wrap = document.createElement('div');
    wrap.className = 'pdfsign-page-wrap';
    wrap.dataset.pageIndex = i - 1;
    // Let the canvas define intrinsic size; CSS handles responsive scaling
    wrap.style.aspectRatio = `${viewport.width} / ${viewport.height}`;

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.setAttribute('aria-label', `Page ${i} of ${pdfsignDoc.numPages}`);
    wrap.appendChild(canvas);

    const overlay = document.createElement('div');
    overlay.className = 'pdfsign-field-overlay';
    overlay.dataset.pageIndex = i - 1;
    // Allow drag-drop from palette onto this page (desktop)
    overlay.addEventListener('dragover', (e) => e.preventDefault());
    overlay.addEventListener('drop', (e) => onDropOnPage(e, i - 1));
    // Mobile: tap palette item, then tap on page to place
    overlay.addEventListener('click', (e) => {
      if (!pdfsignTouchPending) return;
      // Only trigger when tapping empty overlay, not an existing field
      if (e.target !== overlay) return;
      const rect = overlay.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const fieldType = pdfsignTouchPending;
      pdfsignTouchPending = null;
      clearPaletteSelection();
      hidePdfSignStatus();
      addFieldAt(i - 1, fieldType, x, y);
    });
    wrap.appendChild(overlay);

    container.appendChild(wrap);

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
  }
  renderAllFields();
}

// ======== PALETTE DRAG ========
function onPaletteDragStart(e, fieldType) {
  pdfsignDragType = fieldType;
  pdfsignJustDragged = true;
  setTimeout(() => { pdfsignJustDragged = false; }, 300);
  e.dataTransfer.setData('text/plain', fieldType);
  e.dataTransfer.effectAllowed = 'copy';
}

// Universal click handler — works for both mouse and touch
let pdfsignTouchPending = null;
let pdfsignJustDragged = false;
function onPaletteClick(e, fieldType) {
  // Ignore clicks synthesized after a drag-drop operation
  if (pdfsignJustDragged) { pdfsignJustDragged = false; return; }
  e.stopPropagation();
  // Toggle: if tapping the same type again, cancel
  if (pdfsignTouchPending === fieldType) {
    pdfsignTouchPending = null;
    clearPaletteSelection();
    hidePdfSignStatus();
    return;
  }
  pdfsignTouchPending = fieldType;
  clearPaletteSelection();
  const item = e.currentTarget;
  if (item) item.classList.add('selected');
  showPdfSignStatus(`Drag or tap on the PDF where you want the ${fieldType}. Tap this message to cancel.`);
}

function clearPaletteSelection() {
  document.querySelectorAll('.pdfsign-palette-item.selected').forEach(el => el.classList.remove('selected'));
}

function showPdfSignStatus(msg) {
  let toast = document.getElementById('pdfsign-status-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pdfsign-status-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(124,58,237,0.95);color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;font-family:DM Sans,sans-serif;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.4);max-width:calc(100vw - 40px);text-align:center;cursor:pointer;';
    toast.onclick = () => {
      pdfsignTouchPending = null;
      clearPaletteSelection();
      hidePdfSignStatus();
    };
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.display = 'block';
}

function hidePdfSignStatus() {
  const toast = document.getElementById('pdfsign-status-toast');
  if (toast) toast.style.display = 'none';
}

function onDropOnPage(e, pageIndex) {
  e.preventDefault();
  const fieldType = e.dataTransfer.getData('text/plain') || pdfsignDragType;
  if (!fieldType) return;
  const overlay = e.currentTarget;
  const rect = overlay.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width; // normalized 0-1
  const y = (e.clientY - rect.top) / rect.height;
  addFieldAt(pageIndex, fieldType, x, y);
  pdfsignDragType = null;
  pdfsignTouchPending = null;
  clearPaletteSelection();
  hidePdfSignStatus();
}

function addFieldAt(pageIndex, fieldType, normX, normY) {
  // Default sizes (normalized 0-1 of page dimensions)
  const defaults = {
    signature: { w: 0.25, h: 0.08 },
    text:      { w: 0.25, h: 0.04 },
    date:      { w: 0.15, h: 0.04 },
    checkbox:  { w: 0.04, h: 0.04 },
    crossout:  { w: 0.30, h: 0.025 },
  };
  const d = defaults[fieldType] || defaults.text;
  const field = {
    id: pdfsignFieldIdSeq++,
    pageIndex,
    type: fieldType,
    x: Math.max(0, Math.min(1 - d.w, normX - d.w / 2)),
    y: Math.max(0, Math.min(1 - d.h, normY - d.h / 2)),
    w: d.w,
    h: d.h,
    value: (fieldType === 'date')
      ? new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : (fieldType === 'checkbox' ? true : (fieldType === 'crossout' ? true : '')),
  };
  pdfsignFields.push(field);
  renderAllFields();
  // For convenience, immediately open editor for text/signature/date fields
  if (fieldType === 'signature') openSigModal(field.id);
  else if (fieldType === 'text') openTextModal(field.id, 'text');
  else if (fieldType === 'date') openTextModal(field.id, 'date');
}

// ======== RENDER FIELDS ========
function renderAllFields() {
  // Clear all overlays
  document.querySelectorAll('.pdfsign-field-overlay').forEach(o => {
    o.innerHTML = '';
  });
  pdfsignFields.forEach(f => renderField(f));
}

function renderField(field) {
  const overlay = document.querySelector(`.pdfsign-field-overlay[data-page-index="${field.pageIndex}"]`);
  if (!overlay) return;
  const el = document.createElement('div');
  el.className = 'pdfsign-field' + (hasFieldValue(field) ? ' filled' : '');
  el.dataset.fieldId = field.id;
  el.style.left = (field.x * 100) + '%';
  el.style.top = (field.y * 100) + '%';
  el.style.width = (field.w * 100) + '%';
  el.style.height = (field.h * 100) + '%';

  // Type label
  const label = document.createElement('div');
  label.className = 'pdfsign-field-type-label';
  label.textContent = field.type;
  el.appendChild(label);

  // Content
  const content = document.createElement('div');
  content.className = 'pdfsign-field-content';
  renderFieldContent(field, content);
  el.appendChild(content);

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'pdfsign-field-delete';
  delBtn.type = 'button';
  delBtn.setAttribute('aria-label', 'Delete field');
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteField(field.id);
  });
  el.appendChild(delBtn);

  // Resize handle
  const resize = document.createElement('div');
  resize.className = 'pdfsign-field-resize';
  resize.addEventListener('mousedown', (e) => startResize(e, field.id));
  resize.addEventListener('touchstart', (e) => startResize(e, field.id), { passive: false });
  el.appendChild(resize);

  // Click to edit
  el.addEventListener('click', (e) => {
    if (e.target === delBtn || delBtn.contains(e.target)) return;
    if (e.target === resize) return;
    // If a drag just happened, suppress the modal — drag, don't edit
    if (el.__pdfsignJustDragged) return;
    if (field.type === 'checkbox') {
      field.value = !field.value;
      renderAllFields();
    } else if (field.type === 'signature') {
      openSigModal(field.id);
    } else if (field.type === 'crossout') {
      // No edit action — crossout is positioned/resized only
      return;
    } else {
      // text, date
      openTextModal(field.id, field.type);
    }
  });

  // Drag to move
  el.addEventListener('mousedown', (e) => startMove(e, field.id, el));
  el.addEventListener('touchstart', (e) => startMove(e, field.id, el), { passive: false });

  overlay.appendChild(el);
}

function renderFieldContent(field, container) {
  container.innerHTML = '';
  if (field.type === 'signature') {
    if (field.value) {
      const img = document.createElement('img');
      img.src = field.value;
      img.alt = 'Signature';
      container.appendChild(img);
    } else {
      container.textContent = 'Signature';
    }
  } else if (field.type === 'checkbox') {
    if (field.value) {
      const t = document.createElement('div');
      t.className = 'pdfsign-field-checkbox-on';
      t.textContent = '✓';
      container.appendChild(t);
    } else {
      container.textContent = '☐';
    }
  } else if (field.type === 'crossout') {
    // Solid black horizontal line spanning the full width, centered vertically
    const line = document.createElement('div');
    line.style.cssText = 'width:100%;height:2px;background:#000;align-self:center;margin:auto 0;';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.appendChild(line);
  } else {
    // text / date
    const t = document.createElement('div');
    t.className = 'pdfsign-field-text';
    t.textContent = field.value || field.type;
    container.appendChild(t);
  }
}

function hasFieldValue(f) {
  if (f.type === 'checkbox') return f.value === true;
  if (f.type === 'crossout') return true;
  return !!f.value;
}

function deleteField(id) {
  pdfsignFields = pdfsignFields.filter(f => f.id !== id);
  renderAllFields();
}

// ======== MOVE / RESIZE ========
function getPageFromEvent(e, fieldEl) {
  // Returns the overlay element this field is inside
  return fieldEl.closest('.pdfsign-field-overlay');
}

function startMove(e, fieldId, fieldEl) {
  // Ignore if target is delete button or resize handle
  const target = e.target;
  if (target.classList.contains('pdfsign-field-delete') ||
      target.classList.contains('pdfsign-field-resize')) return;

  e.preventDefault();
  const field = pdfsignFields.find(f => f.id === fieldId);
  if (!field) return;
  const overlay = getPageFromEvent(e, fieldEl);
  if (!overlay) return;

  const rect = overlay.getBoundingClientRect();
  const startX = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const startY = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  const startFieldX = field.x;
  const startFieldY = field.y;
  let moved = false;

  function onMove(ev) {
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const dx = (clientX - rect.left - startX) / rect.width;
    const dy = (clientY - rect.top - startY) / rect.height;
    if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) moved = true;
    field.x = Math.max(0, Math.min(1 - field.w, startFieldX + dx));
    field.y = Math.max(0, Math.min(1 - field.h, startFieldY + dy));
    fieldEl.style.left = (field.x * 100) + '%';
    fieldEl.style.top = (field.y * 100) + '%';
    ev.preventDefault();
  }
  function onEnd() {
    // If the user actually dragged, flag the element so the click
    // that immediately follows doesn't open the edit modal.
    if (moved) {
      fieldEl.__pdfsignJustDragged = true;
      // Clear after a short delay (after the click event fires)
      setTimeout(() => { fieldEl.__pdfsignJustDragged = false; }, 50);
    }
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}

function startResize(e, fieldId) {
  e.stopPropagation();
  e.preventDefault();
  const field = pdfsignFields.find(f => f.id === fieldId);
  if (!field) return;
  const fieldEl = document.querySelector(`.pdfsign-field[data-field-id="${fieldId}"]`);
  const overlay = getPageFromEvent(e, fieldEl);
  if (!overlay) return;
  const rect = overlay.getBoundingClientRect();
  const startX = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const startY = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  const startW = field.w;
  const startH = field.h;

  function onResize(ev) {
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const dx = (clientX - rect.left - startX) / rect.width;
    const dy = (clientY - rect.top - startY) / rect.height;
    field.w = Math.max(0.02, Math.min(1 - field.x, startW + dx));
    field.h = Math.max(0.02, Math.min(1 - field.y, startH + dy));
    fieldEl.style.width = (field.w * 100) + '%';
    fieldEl.style.height = (field.h * 100) + '%';
    ev.preventDefault();
  }
  function onEnd() {
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onResize);
    document.removeEventListener('touchend', onEnd);
  }
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchmove', onResize, { passive: false });
  document.addEventListener('touchend', onEnd);
}

// ======== TEXT / DATE MODAL ========
function openTextModal(fieldId, type) {
  pdfsignActiveFieldId = fieldId;
  const field = pdfsignFields.find(f => f.id === fieldId);
  if (!field) return;
  document.getElementById('pdfsign-text-title').textContent = type === 'date' ? 'Enter date' : 'Enter text';
  const input = document.getElementById('pdfsign-text-input');
  input.type = 'text';
  input.value = field.value || '';
  input.placeholder = type === 'date' ? 'e.g. October 15, 2026' : 'Enter text…';
  document.getElementById('pdfsign-text-modal').style.display = 'flex';
  setTimeout(() => input.focus(), 50);
}
function closeTextModal() {
  document.getElementById('pdfsign-text-modal').style.display = 'none';
  pdfsignActiveFieldId = null;
}
function applyTextToField() {
  const field = pdfsignFields.find(f => f.id === pdfsignActiveFieldId);
  if (field) {
    field.value = document.getElementById('pdfsign-text-input').value;
    renderAllFields();
  }
  closeTextModal();
}

// ======== SIGNATURE MODAL ========
let pdfsignSigMode = 'draw';
let pdfsignSigCtx = null;
let pdfsignSigDrawing = false;
let pdfsignSigHasStrokes = false;

function openSigModal(fieldId) {
  pdfsignActiveFieldId = fieldId;
  document.getElementById('pdfsign-sig-modal').style.display = 'flex';
  // If we have a session signature, pre-populate the draw canvas with it
  switchSigMode('draw');
  if (pdfsignSessionSig) {
    loadSessionSigIntoCanvas();
  } else {
    clearSigCanvas();
  }
  setupSigCanvas();
}

function closeSigModal() {
  document.getElementById('pdfsign-sig-modal').style.display = 'none';
  pdfsignActiveFieldId = null;
}

function switchSigMode(mode) {
  pdfsignSigMode = mode;
  document.querySelectorAll('.pdfsign-sig-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  document.getElementById('pdfsign-sig-draw').style.display = mode === 'draw' ? 'block' : 'none';
  document.getElementById('pdfsign-sig-type').style.display = mode === 'type' ? 'block' : 'none';
  document.getElementById('pdfsign-sig-upload').style.display = mode === 'upload' ? 'block' : 'none';
  if (mode === 'draw') setTimeout(setupSigCanvas, 10);
}

function setupSigCanvas() {
  const canvas = document.getElementById('pdfsign-sig-canvas');
  if (!canvas) return;
  // Set internal pixel dimensions to match display size for crisp drawing
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== rect.width * dpr) {
    canvas.width = rect.width * dpr;
    canvas.height = 180 * dpr;
    pdfsignSigCtx = canvas.getContext('2d');
    pdfsignSigCtx.scale(dpr, dpr);
    pdfsignSigCtx.fillStyle = '#fff';
    pdfsignSigCtx.fillRect(0, 0, rect.width, 180);
    pdfsignSigCtx.strokeStyle = '#000';
    pdfsignSigCtx.lineWidth = 2.2;
    pdfsignSigCtx.lineCap = 'round';
    pdfsignSigCtx.lineJoin = 'round';
  } else if (!pdfsignSigCtx) {
    pdfsignSigCtx = canvas.getContext('2d');
    pdfsignSigCtx.strokeStyle = '#000';
    pdfsignSigCtx.lineWidth = 2.2;
    pdfsignSigCtx.lineCap = 'round';
    pdfsignSigCtx.lineJoin = 'round';
  }
  // Ensure handlers attached (idempotent)
  if (!canvas.__pdfsignSetup) {
    canvas.__pdfsignSetup = true;
    // Use pointer events with capture so drawing continues
    // when the cursor leaves the canvas and re-enters while held.
    canvas.addEventListener('pointerdown', (e) => {
      // Only respond to primary button (left click / first touch / pen tip)
      if (e.button !== undefined && e.button !== 0) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      sigStart(e);
    });
    canvas.addEventListener('pointermove', sigMove);
    canvas.addEventListener('pointerup', (e) => {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      sigEnd();
    });
    canvas.addEventListener('pointercancel', (e) => {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      sigEnd();
    });
  }
}

function sigPoint(e) {
  const canvas = document.getElementById('pdfsign-sig-canvas');
  const rect = canvas.getBoundingClientRect();
  // PointerEvent always provides clientX/clientY (works for mouse, touch, pen)
  const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
  const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function sigStart(e) {
  e.preventDefault();
  pdfsignSigDrawing = true;
  pdfsignSigHasStrokes = true;
  const p = sigPoint(e);
  pdfsignSigCtx.beginPath();
  pdfsignSigCtx.moveTo(p.x, p.y);
}

function sigMove(e) {
  if (!pdfsignSigDrawing) return;
  e.preventDefault();
  const p = sigPoint(e);
  pdfsignSigCtx.lineTo(p.x, p.y);
  pdfsignSigCtx.stroke();
}

function sigEnd() {
  pdfsignSigDrawing = false;
}

function clearSigCanvas() {
  const canvas = document.getElementById('pdfsign-sig-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  pdfsignSigCtx = canvas.getContext('2d');
  pdfsignSigCtx.setTransform(1, 0, 0, 1, 0, 0);
  pdfsignSigCtx.fillStyle = '#fff';
  pdfsignSigCtx.fillRect(0, 0, canvas.width, canvas.height);
  const dpr = window.devicePixelRatio || 1;
  pdfsignSigCtx.scale(dpr, dpr);
  pdfsignSigCtx.strokeStyle = '#000';
  pdfsignSigCtx.lineWidth = 2.2;
  pdfsignSigCtx.lineCap = 'round';
  pdfsignSigCtx.lineJoin = 'round';
  pdfsignSigHasStrokes = false;
}

function loadSessionSigIntoCanvas() {
  if (!pdfsignSessionSig) return;
  const canvas = document.getElementById('pdfsign-sig-canvas');
  if (!canvas) return;
  setupSigCanvas();
  const img = new Image();
  img.onload = () => {
    clearSigCanvas();
    const rect = canvas.getBoundingClientRect();
    // Fit image proportionally
    const scale = Math.min(rect.width / img.width, 180 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    pdfsignSigCtx.drawImage(img, (rect.width - w) / 2, (180 - h) / 2, w, h);
    pdfsignSigHasStrokes = true;
  };
  img.src = pdfsignSessionSig;
}

function updateTypedSig() {
  const input = document.getElementById('pdfsign-sig-type-input');
  const preview = document.getElementById('pdfsign-sig-type-preview');
  preview.textContent = input.value || 'Type to preview';
}

function onSigUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('pdfsign-sig-upload-img').src = e.target.result;
    document.getElementById('pdfsign-sig-upload-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function applySigToField() {
  const field = pdfsignFields.find(f => f.id === pdfsignActiveFieldId);
  if (!field) { closeSigModal(); return; }
  let dataUrl = null;

  if (pdfsignSigMode === 'draw') {
    if (!pdfsignSigHasStrokes) {
      alert('Draw your signature first.');
      return;
    }
    dataUrl = await trimSigCanvasToDataUrl();
  } else if (pdfsignSigMode === 'type') {
    const input = document.getElementById('pdfsign-sig-type-input');
    const text = input.value.trim();
    if (!text) { alert('Type your name first.'); return; }
    dataUrl = renderTypedSigToDataUrl(text);
  } else if (pdfsignSigMode === 'upload') {
    const img = document.getElementById('pdfsign-sig-upload-img');
    if (!img.src) { alert('Upload a signature image first.'); return; }
    dataUrl = await normalizeUploadedSig(img.src);
  }

  if (dataUrl) {
    field.value = dataUrl;
    pdfsignSessionSig = dataUrl;
    renderAllFields();
  }
  closeSigModal();
}

async function trimSigCanvasToDataUrl() {
  // Crop to ink bounds so signature doesn't have huge whitespace
  const canvas = document.getElementById('pdfsign-sig-canvas');
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = img;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Non-white (not pure 255,255,255) = ink
      if (data[i] < 240 || data[i+1] < 240 || data[i+2] < 240) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null; // blank
  // Pad
  const pad = 10;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const cropped = document.createElement('canvas');
  cropped.width = maxX - minX + 1;
  cropped.height = maxY - minY + 1;
  const cctx = cropped.getContext('2d');
  // Transparent background — keep only ink
  const imgData = ctx.getImageData(minX, minY, cropped.width, cropped.height);
  // Convert white to transparent
  const cd = imgData.data;
  for (let i = 0; i < cd.length; i += 4) {
    const r = cd[i], g = cd[i+1], b = cd[i+2];
    if (r > 240 && g > 240 && b > 240) {
      cd[i+3] = 0; // make transparent
    }
  }
  cctx.putImageData(imgData, 0, 0);
  return cropped.toDataURL('image/png');
}

function renderTypedSigToDataUrl(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  // Try cursive fonts available by default
  ctx.font = 'italic 80px "Brush Script MT", "Lucida Handwriting", "Segoe Script", cursive';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  return canvas.toDataURL('image/png');
}

async function normalizeUploadedSig(src) {
  // Convert white-ish background to transparent
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] > 235 && d[i+1] > 235 && d[i+2] > 235) d[i+3] = 0;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        // CORS or other issue — just return original
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

// ======== BUILD SIGNED PDF ========
async function buildSignedPdfBytes() {
  if (!window.PDFLib) throw new Error('PDF editor not loaded. Refresh and try again.');
  if (!pdfsignOriginalBytes) throw new Error('No PDF loaded');
  const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
  const pdfDoc = await PDFDocument.load(pdfsignOriginalBytes);
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const field of pdfsignFields) {
    if (!hasFieldValue(field)) continue;
    const page = pages[field.pageIndex];
    if (!page) continue;
    const { width: pW, height: pH } = page.getSize();

    // Normalized coords: field.x/y is top-left in page-space.
    // PDF-lib origin is bottom-left.
    const absX = field.x * pW;
    const absY = pH - (field.y * pH) - (field.h * pH);
    const absW = field.w * pW;
    const absH = field.h * pH;

    if (field.type === 'signature') {
      // Embed signature PNG
      if (field.value && field.value.startsWith('data:image/')) {
        const pngBytes = dataUrlToBytes(field.value);
        const img = await pdfDoc.embedPng(pngBytes);
        // Fit proportionally inside box
        const scale = Math.min(absW / img.width, absH / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        page.drawImage(img, {
          x: absX + (absW - drawW) / 2,
          y: absY + (absH - drawH) / 2,
          width: drawW,
          height: drawH,
        });
      }
    } else if (field.type === 'checkbox') {
      // Draw a check mark centered — size fits box but cap at reasonable max
      const size = Math.min(absW, absH, 18) * 0.9;
      page.drawText('X', {
        x: absX + (absW - size * 0.55) / 2,
        y: absY + (absH - size) / 2 + size * 0.1,
        size: size,
        font: helv,
        color: rgb(0, 0, 0),
      });
    } else if (field.type === 'crossout') {
      // Draw a solid black horizontal line centered vertically across the field width
      const lineThickness = Math.max(1, Math.min(absH * 0.4, 2.5));
      page.drawLine({
        start: { x: absX, y: absY + absH / 2 },
        end:   { x: absX + absW, y: absY + absH / 2 },
        thickness: lineThickness,
        color: rgb(0, 0, 0),
      });
    } else {
      // text / date
      const text = String(field.value || '');
      // Target ~9-10pt — matches the editor's 13px CSS preview.
      // Still auto-shrinks to fit if text is too long.
      let fontSize = Math.min(10, absH * 0.65);
      let textWidth = helv.widthOfTextAtSize(text, fontSize);
      while (textWidth > absW - 4 && fontSize > 4) {
        fontSize -= 0.5;
        textWidth = helv.widthOfTextAtSize(text, fontSize);
      }
      page.drawText(text, {
        x: absX + 2,
        y: absY + (absH - fontSize) / 2 + fontSize * 0.25,
        size: fontSize,
        font: helv,
        color: rgb(0, 0, 0),
      });
    }
  }

  return await pdfDoc.save();
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function downloadSignedPdf() {
  const btn = document.getElementById('pdfsign-download-btn');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Preparing…';
  try {
    const pdfBytes = await buildSignedPdfBytes();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdfsignFilename.replace(/\.pdf$/i, '') + '-signed.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error(e);
    alert(e.message || 'Could not generate PDF.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

async function printSignedPdf() {
  const btn = document.getElementById('pdfsign-print-btn');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Preparing…';
  try {
    const pdfBytes = await buildSignedPdfBytes();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    // Open in hidden iframe for printing
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        // Fallback: open in new tab for manual print
        window.open(url, '_blank');
      }
      setTimeout(() => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(url);
      }, 60000);
    };
  } catch (e) {
    console.error(e);
    alert(e.message || 'Could not prepare PDF for printing.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Upload (the file input change handler — replaces the original
// `this.value=''` after-call which let users re-select the same file)
pdfsignRegisterAction('handle-file', (e, el) => {
  onPdfFile(el.files[0]);
  el.value = '';
});

// New PDF / reset
pdfsignRegisterAction('reset', () => resetPdfSign());

// Palette items — click to add to center of current page
// (ondragstart for HTML5 drag is kept inline; data-pdfsign-field-type carries
// the field type for both this action and any future tooling)
pdfsignRegisterAction('palette-click', (e, el) => onPaletteClick(e, el.dataset.pdfsignFieldType));

// Toolbar (Print / Download)
pdfsignRegisterAction('print', () => printSignedPdf());
pdfsignRegisterAction('download', () => downloadSignedPdf());

// Signature modal
pdfsignRegisterAction('close-sig-modal', () => closeSigModal());
pdfsignRegisterAction('switch-sig-mode', (e, el) => switchSigMode(el.dataset.pdfsignMode));
pdfsignRegisterAction('clear-sig-canvas', () => clearSigCanvas());
pdfsignRegisterAction('update-typed-sig', () => updateTypedSig());
pdfsignRegisterAction('sig-upload', (e, el) => onSigUpload(el.files[0]));
pdfsignRegisterAction('apply-sig', () => applySigToField());

// Text modal
pdfsignRegisterAction('close-text-modal', () => closeTextModal());
pdfsignRegisterAction('apply-text', () => applyTextToField());
pdfsignRegisterAction('enter-apply-text', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyTextToField();
  }
});
