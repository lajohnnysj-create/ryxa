// =============================================================================
// /js/grid.js - Grid Planner (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Grid Planner tool. Lets users arrange and preview
// their Instagram feed (up to 18 photos). Pro tier can save grids to DB.
// Extracted from dashboard.html for stricter CSP.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/grid.js
//   • Phase 2: inline onclick/onchange/onerror → data-grid-action attributes
//   • Phase 3: static inline class="bio-s-6eae3a" → hash-named CSS classes
//
// INTENTIONALLY KEPT INLINE:
//   • ondrop / ondragover / ondragleave - file drop zone. Same reasoning as
//     Brand Deals kanban and Design Studio Layers panel: timing-sensitive
//     event.preventDefault() and dispatch order would risk breakage.
//
// External dependencies on window: sb, Auth, currentUser, isPro, escapeHtml,
// showModalAlert, showModalConfirm, startCheckout, plus the global Sortable
// from SortableJS (loaded at top of dashboard.html with defer).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE
// =============================================================================

const gridActions = {};

function gridRegisterAction(action, handler) {
  gridActions[action] = handler;
}

function gridFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['gridAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.gridAction) {
        const wantEvent = el.dataset.gridEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.gridAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function gridDispatchEvent(event) {
  const found = gridFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = gridActions[found.action];
  if (!handler) {
    console.warn('[grid] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

// Note: 'error' must use capture phase because img onerror does not bubble.
['click', 'input', 'change', 'focus', 'blur'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, gridDispatchEvent, useCapture);
});
document.addEventListener('error', gridDispatchEvent, true);

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 10631-11152 (Grid Planner) ----------
// =====================================================
// GRID PLANNER
// =====================================================
const GRID_MAX_PHOTOS = 18;
const GRID_TARGET_PX = 400;
const GRID_QUALITY = 0.65;
const GRID_MAX_FILE_SIZE = 100 * 1024; // 100KB (matches bucket limit)
const GRID_UPLOAD_TIMEOUT = 20000; // 20 seconds per file
const GRID_SIGNED_URL_TTL = 24 * 60 * 60; // 24 hours, in seconds. Long enough that a user keeping the dashboard tab open all day still sees images. Short enough that a leaked URL becomes useless within a day.

let gridPhotos = []; // Array of {id, url, isSaved}, url is Supabase public URL for saved, or blob: URL for unsaved
let gridInited = false;
let gridIdSeq = 1;
let gridSortable = null;
let gridDirty = false; // true if there are unsaved changes (for Pro users)
let gridLoaded = false; // has data been loaded from DB yet

function initGridTool() {
  const pro = isPro();
  document.getElementById('grid-free-banner').style.display = pro ? 'none' : 'flex';
  document.getElementById('grid-save-btn').style.display = pro ? 'inline-block' : 'none';
  updateGridHandle();
  if (gridInited) { renderGrid(); return; }
  gridInited = true;
  if (pro) loadSavedGrid();
  renderGrid();
}

function updateGridHandle() {
  const el = document.getElementById('grid-phone-username');
  if (!el) return;
  // Use Link in Bio username if available, else fallback
  const uname = (typeof bioState !== 'undefined' && bioState.username)
    ? bioState.username
    : (typeof bioOriginalUsername !== 'undefined' ? bioOriginalUsername : 'yourhandle');
  el.textContent = uname || 'yourhandle';
}

// ======== FILE UPLOAD + COMPRESSION ========
function onGridDragOver(e) {
  e.preventDefault();
  document.getElementById('grid-drop-zone').classList.add('drag-over');
}
function onGridDragLeave(e) {
  // Ignore dragleave when moving onto a child element. Otherwise the
  // drag-over class flickers on/off as the cursor crosses children.
  var dz = document.getElementById('grid-drop-zone');
  if (e.relatedTarget && dz && dz.contains(e.relatedTarget)) return;
  if (dz) dz.classList.remove('drag-over');
}
function onGridDrop(e) {
  e.preventDefault();
  document.getElementById('grid-drop-zone').classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
  onGridFiles(files);
}

async function onGridFiles(files) {
  const list = Array.from(files);
  if (!list.length) return;

  const isFull = gridPhotos.length >= GRID_MAX_PHOTOS;
  let toProcess;
  let skipped = 0;

  if (isFull) {
    // Grid is full - accept only 1 photo, remove the last, prepend the new one
    toProcess = [list[0]];
    if (list.length > 1) skipped = list.length - 1;
  } else {
    const remainingSlots = GRID_MAX_PHOTOS - gridPhotos.length;
    toProcess = list.slice(0, remainingSlots);
    skipped = list.length - toProcess.length;
  }

  const empty = document.getElementById('grid-drop-empty');
  const proc = document.getElementById('grid-processing');
  const bar = document.getElementById('grid-progress-bar');
  const txt = document.getElementById('grid-processing-text');
  empty.style.display = 'none';
  proc.style.display = 'block';

  for (let i = 0; i < toProcess.length; i++) {
    txt.textContent = `Processing ${i + 1}/${toProcess.length}…`;
    bar.style.width = `${((i) / toProcess.length) * 100}%`;
    try {
      const blob = await compressGridImage(toProcess[i]);
      if (!blob) throw new Error('Could not compress');
      const url = URL.createObjectURL(blob);
      if (isFull) {
        // Remove last photo and prepend new one
        const removed = gridPhotos.pop();
        if (removed && removed.url && removed.url.startsWith('blob:')) URL.revokeObjectURL(removed.url);
        gridPhotos.unshift({ id: gridIdSeq++, url, blob, isSaved: false });
      } else {
        gridPhotos.push({ id: gridIdSeq++, url, blob, isSaved: false });
      }
      gridDirty = true;
    } catch (e) {
      console.error('Grid compression failed for file', i, e);
    }
  }
  bar.style.width = '100%';
  setTimeout(() => {
    proc.style.display = 'none';
    empty.style.display = 'block';
    bar.style.width = '0';
  }, 300);

  if (skipped > 0 && !isFull) {
    showGridStatus('error', `${skipped} photo${skipped > 1 ? 's' : ''} skipped, grid is limited to ${GRID_MAX_PHOTOS}.`);
  }
  renderGrid();
}

async function compressGridImage(file) {
  // Load image
  const imgUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load image'));
      image.src = imgUrl;
    });

    // Resize maintaining aspect ratio, max 400px on the longest side
    const scale = Math.min(1, GRID_TARGET_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await Promise.race([
      new Promise((resolve, reject) => {
        canvas.toBlob(b => {
          if (b) resolve(b);
          else reject(new Error('Encode failed'));
        }, 'image/webp', GRID_QUALITY);
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Compression timeout')), 10000))
    ]);
    if (!blob) throw new Error('No blob');

    // Safety net: if still over 100KB, recompress at lower quality
    if (blob.size > GRID_MAX_FILE_SIZE) {
      const smaller = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Encode failed')), 'image/webp', 0.5);
      });
      return smaller;
    }
    return blob;
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

// ======== REMOVE / CLEAR ========
function removeGridPhoto(id) {
  const photo = gridPhotos.find(p => p.id === id);
  if (!photo) return;
  if (photo.url.startsWith('blob:')) URL.revokeObjectURL(photo.url);
  gridPhotos = gridPhotos.filter(p => p.id !== id);
  gridDirty = true;
  renderGrid();
}

async function clearGrid() {
  if (gridPhotos.length === 0) return;
  if (!confirm('Remove all photos from the grid?')) return;

  // Revoke any blob URLs
  gridPhotos.forEach(p => {
    if (p.url.startsWith('blob:')) URL.revokeObjectURL(p.url);
  });
  gridPhotos = [];
  gridDirty = true;
  renderGrid();

  // If Pro + user has a saved grid, delete it from Supabase
  if (isPro() && currentUser) {
    const btn = document.getElementById('grid-clear-btn');
    if (btn) { btn.disabled = true; }
    try {
      // Delete DB row
      const { error: dbErr } = await sb.from('grid_plan').delete().eq('user_id', currentUser.id);
      if (dbErr) throw dbErr;
      // Delete all files in user's grid-photos folder
      await deleteStaleGridPhotos();
      gridDirty = false;
      gridLoaded = true;
      showGridStatus('success', 'Grid cleared');
      renderGrid();
    } catch (e) {
      console.error('clearGrid', e);
      showGridStatus('error', 'Failed to clear saved grid. Try again.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }
}

// ======== RENDER ========
// Recovery handler for grid thumbnail load failures. The stored src is a
// signed URL with a 24h TTL; the common failure is an EXPIRED token (tab left
// open past a day, or a URL signed near expiry). Cache-busting the same dead
// URL does not help - the token is still expired - so instead we re-sign the
// underlying storage path to mint a fresh token and swap it in. Falls back to
// a one-time cache-bust for the rare non-expiry blip, and gives up after one
// re-sign attempt to avoid loops.
function gridImgRetry(img) {
  if (img.dataset.retried) return;
  img.dataset.retried = '1';
  var path = (typeof gridPhotoPath === 'function') ? gridPhotoPath(img.src) : null;
  if (path && typeof sb !== 'undefined') {
    sb.storage.from('grid-photos').createSignedUrl(path, GRID_SIGNED_URL_TTL)
      .then(function(res) {
        if (res && res.data && res.data.signedUrl) {
          // Keep the in-memory photo record fresh too, so a re-render (and the
          // next save) uses the new URL rather than the dead one.
          var fresh = res.data.signedUrl;
          if (typeof gridPhotos !== 'undefined' && Array.isArray(gridPhotos)) {
            var oldPath = gridPhotoPath(img.src);
            gridPhotos.forEach(function(p) {
              if (p && p.url && gridPhotoPath(p.url) === oldPath) p.url = fresh;
            });
          }
          img.src = fresh;
        } else {
          gridImgCacheBust(img);
        }
      })
      .catch(function() { gridImgCacheBust(img); });
    return;
  }
  gridImgCacheBust(img);
}

// Fallback for a genuine transient blip (not expiry): retry the same URL once
// with a cache-busting param.
function gridImgCacheBust(img) {
  var sep = img.src.indexOf('?') === -1 ? '?' : '&';
  img.src = img.src + sep + 'r=' + Date.now();
}

function renderGrid() {
  const thumbsEl = document.getElementById('grid-thumbnails');
  const emptyHint = document.getElementById('grid-empty-hint');
  const countEl = document.getElementById('grid-count');
  const clearBtn = document.getElementById('grid-clear-btn');
  const emptyDrop = document.getElementById('grid-drop-empty');
  const saveBtn = document.getElementById('grid-save-btn');
  if (!thumbsEl) return;

  // Counter
  countEl.textContent = gridPhotos.length > 0
    ? `(${gridPhotos.length}/${GRID_MAX_PHOTOS})`
    : '';
  clearBtn.style.display = gridPhotos.length > 0 ? 'inline-block' : 'none';
  emptyHint.style.display = gridPhotos.length === 0 ? 'block' : 'none';

  // Swap drop zone text when photos exist
  if (gridPhotos.length > 0) {
    const remaining = GRID_MAX_PHOTOS - gridPhotos.length;
    if (remaining > 0) {
      emptyDrop.innerHTML = `<div class="grid-s-d717a9">
        <div class="bio-s-e769ff">Drop more photos · ${remaining} slot${remaining > 1 ? 's' : ''} left</div>
        <label class="grid-s-8ead71">
          Browse
          <input type="file" accept="image/*" multiple data-grid-action="handle-files" data-grid-event="change" aria-label="Upload more photos" class="bio-s-c8be1c">
        </label>
      </div>`;
    } else {
      emptyDrop.innerHTML = `<div class="grid-s-d717a9">
        <div class="bio-s-e769ff">Upload your next post to update grid. (Last photo will be removed)</div>
        <label class="grid-s-8ead71">
          Browse
          <input type="file" accept="image/*" data-grid-action="handle-files" data-grid-event="change" aria-label="Upload next post" class="bio-s-c8be1c">
        </label>
      </div>`;
    }
  } else {
    // Restore original empty state (compact inline)
    emptyDrop.innerHTML = `
      <div class="grid-s-3b3f68">
        <div class="grid-s-5ff865">
          <div class="grid-s-fbda79">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <div class="grid-s-c28bd9">
            <div class="grid-s-469ab5">Drop photos here or
              <label class="grid-s-8f8dfb">browse<input type="file" accept="image/*" multiple data-grid-action="handle-files" data-grid-event="change" aria-label="Upload photos" class="bio-s-c8be1c"></label>
            </div>
            <div class="bio-s-5f3468">Up to ${GRID_MAX_PHOTOS} photos · JPG, PNG, WebP, HEIC</div>
          </div>
        </div>
      </div>`;
  }

  // Thumbnails (draggable)
  thumbsEl.innerHTML = gridPhotos.map((p, i) => `
    <div class="grid-thumb" data-id="${p.id}">
      <div class="grid-thumb-order">${i + 1}</div>
      <img src="${escapeHtml(p.url)}" alt="Photo ${i + 1}" loading="lazy" data-grid-action="img-retry" data-grid-event="error">
      <button class="grid-thumb-remove" data-grid-action="remove-photo" data-grid-photo-id="${p.id}" aria-label="Remove photo">&#x2715;</button>
    </div>
  `).join('');

  // Init SortableJS (once)
  if (typeof Sortable !== 'undefined') {
    if (gridSortable) gridSortable.destroy();
    gridSortable = new Sortable(thumbsEl, {
      animation: 150,
      delay: 50,
      delayOnTouchOnly: true,
      onEnd: () => {
        const order = Array.from(thumbsEl.children).map(el => parseInt(el.dataset.id));
        gridPhotos = order.map(id => gridPhotos.find(p => p.id === id)).filter(Boolean);
        gridDirty = true;
        renderPhonePreview();
        updateGridSaveButton();
      }
    });
  }

  updateGridSaveButton();
  renderPhonePreview();
}

function updateGridSaveButton() {
  const saveBtn = document.getElementById('grid-save-btn');
  if (!saveBtn) return;
  if (gridDirty && gridPhotos.length > 0) {
    saveBtn.textContent = 'Save';
    saveBtn.disabled = false;
    saveBtn.style.opacity = '1';
  } else if (gridLoaded && !gridDirty) {
    saveBtn.textContent = 'Saved ✓';
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.6';
  } else {
    saveBtn.textContent = 'Save';
    saveBtn.disabled = gridPhotos.length === 0;
    saveBtn.style.opacity = gridPhotos.length === 0 ? '0.5' : '1';
  }
}

function renderPhonePreview() {
  const grid = document.getElementById('grid-phone-grid');
  const countEl = document.getElementById('grid-phone-post-count');
  if (!grid) return;
  countEl.textContent = gridPhotos.length;

  // Show all uploaded + empty placeholders to fill out the 3-column pattern
  const cells = [];
  gridPhotos.forEach(p => {
    cells.push(`<div class="grid-phone-cell"><img src="${escapeHtml(p.url)}" alt="Grid post"></div>`);
  });
  // Pad to a multiple of 3 with empty cells (at least 3 rows visible)
  const minRows = 3;
  const targetCount = Math.max(gridPhotos.length, minRows * 3);
  const padToMultiple = Math.ceil(targetCount / 3) * 3;
  while (cells.length < padToMultiple) {
    cells.push(`<div class="grid-phone-cell empty"></div>`);
  }
  grid.innerHTML = cells.join('');
}

function showGridStatus(kind, msg) {
  // Delegates to the dashboard's slide-in toast. Falls back to the inline
  // status element if the shell isn't loaded.
  if (typeof showDashToast === 'function') {
    showDashToast(kind === 'error' ? 'error' : 'success', msg);
    return;
  }
  const el = document.getElementById('grid-save-status');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.color = kind === 'error' ? '#fca5a5' : kind === 'success' ? '#4ade80' : 'var(--muted)';
  if (kind !== 'error') setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.style.display = 'none'; } }, 3000);
  if (kind === 'error') setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.style.display = 'none'; } }, 5000);
}

// ======== SAVE / LOAD (Pro only) ========
// ---- Standard load treatment (whole-state saver, like Bio / Media Kit) ----

// Lock/unlock the grid's controls while the saved grid is loading or failed:
// Save, Clear, the drop zone, and the file input. A failed load must never
// present an editable grid, because saving would overwrite the real saved
// grid with a blank one.
function setGridControlsLocked(locked) {
  ['grid-save-btn', 'grid-clear-btn'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.disabled = locked;
    el.style.opacity = locked ? '0.5' : '';
    el.style.cursor = locked ? 'not-allowed' : '';
  });
  var drop = document.getElementById('grid-drop-zone');
  if (drop) { drop.style.pointerEvents = locked ? 'none' : ''; drop.style.opacity = locked ? '0.5' : ''; }
  var thumbs = document.getElementById('grid-thumbnails');
  if (thumbs) { thumbs.style.pointerEvents = locked ? 'none' : ''; thumbs.style.opacity = locked ? '0.5' : ''; }
}

function gridClearStatusSlot() {
  var el = document.getElementById('grid-save-status');
  if (!el) return;
  el.style.display = 'none';
  el.innerHTML = '';
  el.style.background = '';
  el.style.border = '';
  el.style.padding = '';
}

// Blocking failure state: red panel with Retry in the status slot at the top.
function gridShowLoadFailed() {
  var el = document.getElementById('grid-save-status');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = 'transparent';
  el.style.border = 'none';
  el.style.padding = '0';
  el.innerHTML = '<div role="alert" style="padding:20px;border-radius:12px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.08);margin-bottom:16px;">'
    + '<div style="color:#f87171;font-weight:600;font-size:15px;margin-bottom:6px;">Could not load your saved grid</div>'
    + '<div style="color:rgba(255,255,255,0.7);font-size:14px;line-height:1.5;margin-bottom:14px;">Editing and saving are turned off until it loads, so your existing grid stays safe. Check your internet connection and press Retry. If the issue continues, contact us at hello@ryxa.io.</div>'
    + '<button type="button" data-grid-action="retry-load" style="padding:9px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.06);color:#fff;font-weight:600;cursor:pointer;">Retry</button>'
    + '</div>';
}

gridRegisterAction('retry-load', function() { gridInited = false; gridLoaded = false; loadSavedGrid(); });

async function loadSavedGrid() {
  if (!currentUser) return;
  const _gen = window.RyxaLoadGen.bump();
  setGridControlsLocked(true);
  gridClearStatusSlot();
  window.RyxaLoadBar.start(document.getElementById('grid-save-status'));

  // Retry transient blips. A null session is retryable, not fatal: RLS
  // returns EMPTY SUCCESS to a session-less query, which would render a blank
  // grid over a real saved one, and the next save would overwrite the real
  // grid with the blank. A FAILED load never counts as loaded.
  let data = null;
  const MAX_LOAD_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
    try {
      const sess = await sb.auth.getSession();
      if (!sess || !sess.data || !sess.data.session) throw new Error('grid-load: no live session');
      const res = await sb.from('grid_plan').select('photo_urls').eq('user_id', currentUser.id).maybeSingle();
      if (res.error) throw res.error;
      if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('grid-save-status')); gridInited = false; return; }
      data = res.data;
      break;
    } catch (err) {
      if (attempt < MAX_LOAD_ATTEMPTS) {
        if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('grid-save-status')); gridInited = false; return; }
        window.RyxaLoadBar.retrying(document.getElementById('grid-save-status'), 'Having trouble loading your grid. Retrying...');
        await new Promise(function(r){ setTimeout(r, 400 * attempt); });
        if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('grid-save-status')); gridInited = false; return; }
        continue;
      }
      if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('grid-save-status')); gridInited = false; return; }
      console.warn('loadSavedGrid', err);
      window.RyxaLoadBar.fail(document.getElementById('grid-save-status'));
      gridShowLoadFailed();
      showGridStatus('error', 'Failed to load. Please retry, or contact hello@ryxa.io if it continues.');
      return;
    }
  }

  try {
    if (!data) { gridLoaded = true; window.RyxaLoadBar.finish(document.getElementById('grid-save-status')); gridClearStatusSlot(); setGridControlsLocked(false); return; } // no saved grid yet: empty is real
    const urls = Array.isArray(data.photo_urls) ? data.photo_urls : [];
    // Validate URLs (only from grid-photos bucket).
    const valid = urls.filter(validGridPhotoUrl);

    // Bucket is private. Re-sign each stored URL to a fresh 24h signed URL.
    // Stored values may be either old /public/ URLs or previously-signed
    // URLs whose token has expired; both parse to the same path. Sign in
    // parallel for speed. If a sign fails, drop that photo (the file may
    // have been deleted from storage).
    const signedPhotos = [];
    if (valid.length > 0) {
      const signResults = await Promise.all(valid.map(async (storedUrl) => {
        const path = gridPhotoPath(storedUrl);
        if (!path) return null;
        try {
          const { data: s, error: sErr } = await sb.storage
            .from('grid-photos')
            .createSignedUrl(path, GRID_SIGNED_URL_TTL);
          if (sErr || !s?.signedUrl) return null;
          return s.signedUrl;
        } catch { return null; }
      }));
      signResults.forEach(u => { if (u) signedPhotos.push(u); });
    }

    gridPhotos = signedPhotos.map(url => ({ id: gridIdSeq++, url, isSaved: true }));
    gridDirty = false;
    gridLoaded = true;
    window.RyxaLoadBar.finish(document.getElementById('grid-save-status'));
    gridClearStatusSlot();
    setGridControlsLocked(false);
    renderGrid();
  } catch (e) {
    // Hydration/signing failed after a successful fetch: treat as a load
    // failure. A failed load must never count as loaded; saving stays disabled
    // to protect the existing saved grid.
    console.warn('loadSavedGrid', e);
    window.RyxaLoadBar.fail(document.getElementById('grid-save-status'));
    gridShowLoadFailed();
    showGridStatus('error', 'Failed to load. Please retry, or contact hello@ryxa.io if it continues.');
  }
}

function validGridPhotoUrl(u) {
  if (!u || typeof u !== 'string') return false;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return false;
    if (url.hostname !== 'kjytapcgxukalwsyputk.supabase.co') return false;
    // Accept both public and signed URL paths. The bucket is now private
    // and we re-sign on load, but stored values may still contain old
    // /public/ URLs from before the migration. Either format parses to
    // the same path via gridPhotoPath() below.
    if (!url.pathname.includes('/storage/v1/object/public/grid-photos/')
        && !url.pathname.includes('/storage/v1/object/sign/grid-photos/')) return false;
    return true;
  } catch { return false; }
}

// Extract the storage path from any grid-photos URL (public OR signed).
// Returns just the path part after `grid-photos/`, e.g. "abc123/photo-456.webp".
// Returns null if the URL doesn't match.
function gridPhotoPath(u) {
  if (!u || typeof u !== 'string') return null;
  // Signed URLs have ?token=... - match before the query string.
  const m = u.match(/\/grid-photos\/([^?]+)/);
  return m ? m[1] : null;
}

let gridLastSaveAt = 0;
const GRID_SAVE_COOLDOWN_MS = 3000; // min 3s between saves

async function saveGrid() {
  if (!isPro()) { showGridStatus('error', 'Upgrade to Pro to save your grid.'); return; }
  if (!currentUser) return;
  if (!gridLoaded) {
    showGridStatus('error', 'Saving is disabled because your saved grid did not finish loading. This protects your existing grid from being overwritten. Use the Retry button at the top to reload it.');
    return;
  }
  if (gridPhotos.length === 0) { showGridStatus('error', 'Add at least one photo first.'); return; }

  const now = Date.now();
  const timeSinceLast = now - gridLastSaveAt;
  if (timeSinceLast < GRID_SAVE_COOLDOWN_MS) {
    const wait = Math.ceil((GRID_SAVE_COOLDOWN_MS - timeSinceLast) / 1000);
    showGridStatus('error', `Please wait ${wait}s before saving again.`);
    return;
  }
  gridLastSaveAt = now;

  const btn = document.getElementById('grid-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    // 1. Upload any new (unsaved) photos
    for (let i = 0; i < gridPhotos.length; i++) {
      const p = gridPhotos[i];
      if (p.isSaved) continue;
      btn.textContent = `Uploading ${i + 1}/${gridPhotos.length}…`;
      const fileName = `${currentUser.id}/photo-${Date.now()}-${Math.random().toString(36).slice(2,8)}.webp`;
      const uploadPromise = sb.storage.from('grid-photos').upload(fileName, p.blob, {
        contentType: 'image/webp',
        upsert: false
      });
      const { error: upErr } = await Promise.race([
        uploadPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Upload timeout')), GRID_UPLOAD_TIMEOUT))
      ]);
      if (upErr) throw new Error(upErr.message || 'Upload failed');
      // Bucket is private; sign a 24h URL for immediate display.
      const { data: signedData, error: signErr } = await sb.storage
        .from('grid-photos')
        .createSignedUrl(fileName, GRID_SIGNED_URL_TTL);
      if (signErr || !signedData?.signedUrl) throw new Error('Could not sign photo URL');
      // Replace blob URL with the signed one; keep blob alive until after DB save succeeds
      if (p.url.startsWith('blob:')) URL.revokeObjectURL(p.url);
      p.url = signedData.signedUrl;
      p.blob = null;
      p.isSaved = true;
    }

    btn.textContent = 'Saving…';

    // 2. Upsert DB row with the new URL list
    const payload = {
      user_id: currentUser.id,
      photo_urls: gridPhotos.map(p => p.url)
    };
    const { error: dbErr } = await sb.from('grid_plan').upsert(payload, { onConflict: 'user_id' });
    if (dbErr) throw dbErr;

    // 3. Clean up any photos in the user's folder that aren't referenced anymore
    await deleteStaleGridPhotos();

    gridDirty = false;
    gridLoaded = true;
    showGridStatus('success', 'Grid saved');
    renderGrid();
  } catch (e) {
    console.error('saveGrid', e);
    showGridStatus('error', e.message || 'Save failed.');
  } finally {
    btn.disabled = false;
  }
}

async function deleteStaleGridPhotos() {
  if (!currentUser) return;
  try {
    const inUse = new Set();
    gridPhotos.forEach(p => {
      // Use shared helper so it strips ?token=... from signed URLs too.
      const path = gridPhotoPath(p.url);
      if (path) inUse.add(path);
    });

    // Paginate through the user's folder in case of accumulated orphans
    let offset = 0;
    const pageSize = 100;
    const toDelete = [];
    while (true) {
      const { data: files, error: listErr } = await sb.storage
        .from('grid-photos')
        .list(currentUser.id, { limit: pageSize, offset });
      if (listErr || !Array.isArray(files) || files.length === 0) break;
      for (const f of files) {
        const path = `${currentUser.id}/${f.name}`;
        if (!inUse.has(path)) toDelete.push(path);
      }
      if (files.length < pageSize) break;
      offset += pageSize;
      // Safety cap - don't loop forever if something goes wrong
      if (offset > 500) break;
    }
    if (toDelete.length > 0) {
      // Delete in batches of 100 (Supabase remove() has a practical limit)
      for (let i = 0; i < toDelete.length; i += 100) {
        await sb.storage.from('grid-photos').remove(toDelete.slice(i, i + 100));
      }
    }
  } catch (e) { console.warn('deleteStaleGridPhotos', e); }
}

// =============================================================================
// ACTION REGISTRATIONS - wired up below as part of Phase 2
// =============================================================================

// Toolbar actions
gridRegisterAction('clear', () => clearGrid());
gridRegisterAction('save', () => saveGrid());

// Paywall - uses startCheckout fallback (passing nothing lets it pick up
// localStorage intent or default to monthly Pro)
gridRegisterAction('start-checkout', (e, el) => goToPricing('pro'));

// File input change handlers (multiple file inputs in different render states)
gridRegisterAction('handle-files', (e, el) => {
  onGridFiles(el.files);
  el.value = '';
});

// Per-thumbnail remove (template literal)
gridRegisterAction('remove-photo', (e, el) => {
  removeGridPhoto(parseInt(el.dataset.gridPhotoId, 10));
});

// Image onerror handler - signed URL refresh
gridRegisterAction('img-retry', (e, el) => gridImgRetry(el));

// Drop zone for uploading photos. The element has data-grid-drop-zone (no value)
// and we wire native HTML5 drag-and-drop events via addEventListener.
// Done at DOMContentLoaded because the element exists in initial markup.
document.addEventListener('DOMContentLoaded', function() {
  const dz = document.querySelector('[data-grid-drop-zone]');
  if (!dz) return;
  dz.addEventListener('drop', onGridDrop);
  dz.addEventListener('dragover', onGridDragOver);
  dz.addEventListener('dragleave', onGridDragLeave);
});
