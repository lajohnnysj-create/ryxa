// =============================================================================
// /js/products.js — Digital Products (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Digital Products tool (Max tier). Extracted from
// dashboard.html for stricter CSP.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/products.js
//   • Phase 2: replaced inline onclick/oninput/etc with data-prod-action
//     attributes + delegated event handlers (CSP-strict)
//   • Phase 3: replaced inline class="bio-s-6eae3a" attributes with hash-named CSS
//     classes in dashboard.html's <style> block (CSP-strict)
//
// External dependencies remain on window (sb, Auth, currentUser, isMax,
// escapeHtml, showModalAlert, showModalConfirm, formatMoney, etc).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE (parallel of bio/mk/course/coach)
// =============================================================================

const prodActions = {};

function prodRegisterAction(action, handler) {
  prodActions[action] = handler;
}

function prodFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['prodAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.prodAction) {
        const wantEvent = el.dataset.prodEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.prodAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function prodDispatchEvent(event) {
  const found = prodFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = prodActions[found.action];
  if (!handler) {
    console.warn('[prod] No handler registered for action:', found.action);
    return;
  }
  // Auto-preventDefault on <a> click events so handlers using data-prod-action
  // can use href="#" without scrolling to top, and CSP doesn't have to allow
  // javascript: URIs. Replaces the old href="javascript:void(0)" pattern.
  if (event.type === 'click' && found.element.tagName === 'A') {
    event.preventDefault();
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur', 'keydown', 'mouseover', 'mouseout'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, prodDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 21282-22313 (Digital Products) ----------
// =====================================================
// DIGITAL PRODUCTS
// =====================================================

// Hard limits — must match SQL bucket config and migration
var DP_MAX_FILE_BYTES    = 100 * 1024 * 1024;   // 100 MB
var DP_MAX_PRODUCT_BYTES = 300 * 1024 * 1024;   // 300 MB
var DP_MAX_ACCOUNT_BYTES = 500 * 1024 * 1024;  // 500 MB

// Allowed file extensions (lowercase). MUST match docs in marketing copy.
var DP_ALLOWED_EXTS = [
  'pdf','epub','mobi','txt','md','docx','pages',
  'csv','xlsx','numbers',
  'pptx','key',
  'jpg','jpeg','png','gif','webp','svg',
  'psd','ai','indd','sketch','fig','afphoto','afdesign',
  'cube','3dl','lrtemplate','xmp','dng',
  'atn','abr','asl','tpl',
  'drp',
  'mp3','wav','aiff','m4a','flac',
  'mp4','mov','webm',
  'otf','ttf','woff','woff2',
  'brush','brushset','procreate',
  'blend','obj','fbx','stl','glb','gltf',
  'zip','rar','7z'
];

// Magic byte signatures for MIME validation
var DP_MAGIC_BYTES = {
  pdf:  ['25504446'],
  zip:  ['504B0304', '504B0506', '504B0708'],
  rar:  ['526172211A0700', '526172211A070100'],
  '7z': ['377ABCAF271C'],
  png:  ['89504E470D0A1A0A'],
  gif:  ['474946383761', '474946383961'],
  jpg:  ['FFD8FF'],
  jpeg: ['FFD8FF'],
  webp: ['52494646'],
  docx: ['504B0304'],
  xlsx: ['504B0304'],
  pptx: ['504B0304'],
  epub: ['504B0304'],
  psd:  ['38425053'],
  mp3:  ['494433', 'FFFB', 'FFF3', 'FFF2'],
  wav:  ['52494646'],
  aiff: ['464F524D'],
  flac: ['664C6143'],
  m4a:  ['00000020667479704D344120', '0000001C667479704D344120'],
  // Video files — ftyp box at offset 4 means we check bytes 4-11 (skip first 4 size bytes)
  // mp4: various ftyp brands
  mp4:  ['000000186674797069736F6D', '0000001C6674797069736F6D', '00000020667479706D703432', '0000001C667479706D703432'],
  mov:  ['0000001466747970717420', '0000001466747970717420', '00000020667479707174'],
  webm: ['1A45DFA3'],
  otf:  ['4F54544F'],
  ttf:  ['00010000', '74727565'],
  woff: ['774F4646'],
  woff2:['774F4632'],
  // Procreate brushes/brushsets/files are zip-based
  brush:    ['504B0304'],
  brushset: ['504B0304'],
  procreate:['504B0304'],
  // 3D files: BLEND has magic bytes, others vary
  blend:['424C454E444552'],
  glb:  ['676C5446'],
  // obj, fbx, stl, gltf, drp are text or proprietary binary; rely on extension only
};

var productsState = {
  inited: false,
  list: [],
  storageBytes: 0,
  editingId: null,
  editing: null,
  editingFiles: [],
  editingProductBytes: 0,
  coverFile: null,           // In-memory File object until Save
  coverPreviewUrl: null,     // Blob URL for preview (revoked on close)
  coverRemoved: false        // True if user clicked Remove on an existing cover
};

function initDigitalProducts() {
  if (!isMax()) {
    document.getElementById('products-upsell').style.display = 'block';
    document.getElementById('products-list-view').style.display = 'none';
    document.getElementById('products-editor-view').style.display = 'none';
    return;
  }
  document.getElementById('products-upsell').style.display = 'none';
  document.getElementById('products-editor-view').style.display = 'none';
  document.getElementById('products-list-view').style.display = 'block';
  if (!productsState.inited) {
    productsState.inited = true;
  }
  loadProductsList();
  refreshProductsStorage();
}

async function loadProductsList() {
  var listEl = document.getElementById('products-list');
  var emptyEl = document.getElementById('products-empty');
  listEl.innerHTML = '<div class="prod-s-8e22b6">Loading...</div>';
  try {
    var { data, error } = await sb
      .from('digital_products')
      .select('id, slug, title, description, cover_image_url, price_cents, currency, is_active, total_size_bytes, updated_at')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    productsState.list = data || [];
    if (!productsState.list.length) {
      listEl.innerHTML = '';
      listEl.style.display = 'none';
      emptyEl.style.display = 'block';
      return;
    }
    listEl.style.display = 'grid';
    emptyEl.style.display = 'none';
    renderProductsList();
  } catch (e) {
    console.error('loadProductsList failed:', e);
    listEl.innerHTML = '<div class="prod-s-988306">Could not load your products</div>';
  }
}

function renderProductsList() {
  var listEl = document.getElementById('products-list');
  var html = productsState.list.map(function(p) {
    var price = p.price_cents > 0 ? '$' + (p.price_cents / 100).toFixed(2) : 'Free';
    var statusBadge = p.is_active
      ? '<span class="prod-s-f11ff4">Live</span>'
      : '<span class="prod-s-f8de43">Draft</span>';
    var coverStyle = p.cover_image_url
      ? 'background-image:url(' + dpEscapeHtml(p.cover_image_url) + ');background-size:cover;background-position:center;'
      : 'background:linear-gradient(135deg,rgba(124,58,237,0.18),rgba(232,121,249,0.14));display:flex;align-items:center;justify-content:center;';
    var coverInner = p.cover_image_url ? '' : '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
    return '<div data-prod-action="open-editor" data-prod-id="' + dpEscapeHtml(p.id) + '" class="prod-s-783a04 prod-h-card">'
      + '<div style="width:100%;aspect-ratio:16/9;' + coverStyle + '">' + coverInner + '</div>'
      + '<div class="prod-s-67ae14">'
      + '<div class="prod-s-518da5">'
      + '<div class="prod-s-fea2c8">' + dpEscapeHtml(p.title || 'Untitled') + '</div>'
      + statusBadge
      + '</div>'
      + '<div class="bio-s-e769ff">' + price + ' \u00b7 ' + dpFormatBytes(p.total_size_bytes) + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
  listEl.innerHTML = html;
}

async function refreshProductsStorage() {
  try {
    var { data, error } = await sb.rpc('get_digital_products_storage_used');
    if (error) throw error;
    productsState.storageBytes = Number(data || 0);
    var pct = Math.min(100, Math.round((productsState.storageBytes / DP_MAX_ACCOUNT_BYTES) * 100));
    var color = pct < 60 ? '#22c55e' : (pct < 85 ? '#eab308' : '#ef4444');
    var fill = document.getElementById('products-storage-fill');
    var txt = document.getElementById('products-storage-text');
    if (fill) { fill.style.width = pct + '%'; fill.style.background = color; }
    if (txt) txt.textContent = dpFormatBytes(productsState.storageBytes) + ' / 500 MB';
  } catch (e) {
    console.error('refreshProductsStorage failed:', e);
  }
}

async function openProductEditor(productId) {
  document.getElementById('products-list-view').style.display = 'none';
  document.getElementById('products-editor-view').style.display = 'block';
  // Reset cover in-memory state
  if (productsState.coverPreviewUrl) {
    try { URL.revokeObjectURL(productsState.coverPreviewUrl); } catch (e) {}
  }
  productsState.editingFiles = [];
  productsState.editingProductBytes = 0;
  productsState.coverFile = null;
  productsState.coverPreviewUrl = null;
  productsState.coverRemoved = false;

  if (productId) {
    productsState.editingId = productId;
    document.getElementById('products-editor-title').textContent = 'Edit Product';
    document.getElementById('products-delete-btn').style.display = 'inline-block';
    try {
      var { data: prod, error: e1 } = await sb.from('digital_products').select('*').eq('id', productId).eq('user_id', currentUser.id).single();
      if (e1) throw e1;
      productsState.editing = prod;
      var { data: files, error: e2 } = await sb.from('digital_product_files').select('*').eq('product_id', productId).order('sort_order', { ascending: true });
      if (e2) throw e2;
      productsState.editingFiles = files || [];
      productsState.editingProductBytes = (files || []).reduce(function(s,f){return s + Number(f.file_size_bytes || 0);}, 0);
      hydrateProductEditor(prod);
    } catch (e) {
      console.error('Load product failed:', e);
      showModalAlert('Error', 'Could not load this product.');
      closeProductEditor();
      return;
    }
  } else {
    productsState.editingId = null;
    productsState.editing = null;
    document.getElementById('products-editor-title').textContent = 'New Product';
    document.getElementById('products-delete-btn').style.display = 'none';
    hydrateProductEditor(null);
  }
  renderProductFiles();
}

function hydrateProductEditor(prod) {
  document.getElementById('products-title').value = prod ? (prod.title || '') : '';
  document.getElementById('products-slug').value = prod ? (prod.slug || '') : '';
  document.getElementById('products-description').value = prod ? (prod.description || '') : '';
  document.getElementById('products-price').value = prod ? (prod.price_cents > 0 ? (prod.price_cents / 100).toFixed(2) : '') : '';
  document.getElementById('products-delivery-message').value = prod ? (prod.delivery_message || '') : '';

  var coverEl = document.getElementById('products-cover-preview');
  var removeBtn = document.getElementById('products-cover-remove');
  if (prod && prod.cover_image_url) {
    coverEl.style.backgroundImage = 'url(' + prod.cover_image_url + ')';
    coverEl.textContent = '';
    removeBtn.style.display = 'inline-block';
  } else {
    coverEl.style.backgroundImage = '';
    coverEl.textContent = 'Click to upload (1280\u00d7720 recommended)';
    removeBtn.style.display = 'none';
  }

  dpUpdateLinkButtons();
  updateProductPublishButton();
}

// Show or hide the inline Copy button based on whether the product has been
// saved (has an editingId) and has a non-empty slug.
function dpUpdateLinkButtons() {
  var slug = (document.getElementById('products-slug').value || '').trim();
  var btn = document.getElementById('products-copy-url-btn');
  if (!btn) return;
  if (productsState.editingId && slug) {
    btn.style.display = 'flex';
  } else {
    btn.style.display = 'none';
  }
}

// Hide the link button while the slug is being edited so there's no confusion
// about which slug the link points to. Reappears after save.
document.addEventListener('input', function(e) {
  if (e.target && e.target.id === 'products-slug') dpUpdateLinkButtons();
});

function copyProductUrl() {
  var slug = (document.getElementById('products-slug').value || '').trim();
  if (!productsState.editingId || !slug) return;
  var url = 'https://www.ryxa.io/product/' + slug;
  navigator.clipboard.writeText(url).then(function() {
    var btn = document.getElementById('products-copy-url-btn');
    var orig = btn.innerHTML;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied';
    btn.style.color = '#4ade80';
    setTimeout(function() { btn.innerHTML = orig; btn.style.color = 'var(--muted)'; }, 1500);
  });
}

function closeProductEditor() {
  document.getElementById('products-editor-view').style.display = 'none';
  document.getElementById('products-list-view').style.display = 'block';
  // Revoke the in-memory cover preview URL to free memory
  if (productsState.coverPreviewUrl) {
    try { URL.revokeObjectURL(productsState.coverPreviewUrl); } catch (e) {}
  }
  productsState.editingId = null;
  productsState.editing = null;
  productsState.editingFiles = [];
  productsState.editingProductBytes = 0;
  productsState.coverFile = null;
  productsState.coverPreviewUrl = null;
  productsState.coverRemoved = false;
  loadProductsList();
  refreshProductsStorage();
}

var _dpSlugManuallyEdited = false;
function autoUpdateProductSlug() {
  if (productsState.editingId) return;
  var slugEl = document.getElementById('products-slug');
  if (_dpSlugManuallyEdited && slugEl.value) return;
  var title = document.getElementById('products-title').value;
  slugEl.value = dpSlugify(title);
}
document.addEventListener('input', function(e) {
  if (e.target && e.target.id === 'products-slug') _dpSlugManuallyEdited = true;
});

function dpSlugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function dpFormatBytes(bytes) {
  bytes = Number(bytes || 0);
  if (bytes === 0) return '0 MB';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function dpEscapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function dpReadMagicBytes(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var bytes = new Uint8Array(e.target.result);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0').toUpperCase();
      resolve(hex);
    };
    reader.onerror = function() { reject(new Error('Could not read file')); };
    reader.readAsArrayBuffer(file.slice(0, 16));
  });
}

async function dpValidateFileType(file) {
  var name = file.name.toLowerCase();
  var ext = name.split('.').pop();
  if (DP_ALLOWED_EXTS.indexOf(ext) === -1) {
    return { ok: false, error: 'File type ".' + ext + '" not allowed. Only ebooks, templates, presets, and design files are accepted.' };
  }
  var sigList = DP_MAGIC_BYTES[ext];
  if (sigList) {
    try {
      var hex = await dpReadMagicBytes(file);
      var matches = sigList.some(function(sig) { return hex.startsWith(sig); });
      if (!matches) return { ok: false, error: 'File "' + file.name + '" appears to be corrupt or its content does not match the .' + ext + ' extension.' };
    } catch (e) {
      return { ok: false, error: 'Could not verify file content. Please try again.' };
    }
  }
  return { ok: true };
}

async function dpInspectZipContents(file) {
  var BLOCKED = ['exe','msi','bat','cmd','com','scr','cpl','ps1','vbs','wsf','app','dmg','pkg','sh','run','bin','jar','apk','ipa','iso','html','htm'];
  try {
    var size = file.size;
    var readStart = Math.max(0, size - 65536);
    var buf = await file.slice(readStart).arrayBuffer();
    var text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    var pattern = new RegExp('[a-zA-Z0-9_\\-\\. /\\\\]+\\.(' + BLOCKED.join('|') + ')(?=\\x00|\\x01|\\x02|\\x03|PK)', 'gi');
    var matches = text.match(pattern);
    if (matches && matches.length > 0) {
      return { ok: false, error: 'ZIP file contains blocked file types (' + matches.slice(0, 3).join(', ') + '). Remove these and re-upload.' };
    }
    return { ok: true };
  } catch (e) {
    console.error('ZIP inspection failed:', e);
    return { ok: false, error: 'Could not inspect ZIP contents. Please try again or use an uncompressed file.' };
  }
}

async function uploadProductFiles(input) {
  var files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;

  if (!productsState.editingId) {
    var savedOk = await saveProductDraftSilently();
    if (!savedOk) {
      showModalAlert('Could not start upload', 'Please add a title and try again.');
      return;
    }
  }

  for (var i = 0; i < files.length; i++) {
    await uploadSingleFile(files[i]);
  }
  renderProductFiles();
  await refreshProductsStorage();
}

async function uploadSingleFile(file) {
  if (file.size > DP_MAX_FILE_BYTES) {
    showModalAlert('File too large', '"' + file.name + '" is ' + dpFormatBytes(file.size) + '. Max file size is 100 MB.');
    return;
  }
  if (productsState.editingProductBytes + file.size > DP_MAX_PRODUCT_BYTES) {
    showModalAlert('Product is full', 'Adding "' + file.name + '" would exceed the 300 MB per-product limit. Remove a file first or split into a separate product.');
    return;
  }
  if (productsState.storageBytes + file.size > DP_MAX_ACCOUNT_BYTES) {
    showModalAlert('Storage full', 'Adding "' + file.name + '" would exceed your 500 MB account storage. Delete some files first.');
    return;
  }
  var validation = await dpValidateFileType(file);
  if (!validation.ok) {
    showModalAlert('File rejected', validation.error);
    return;
  }
  var ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'zip') {
    var zipCheck = await dpInspectZipContents(file);
    if (!zipCheck.ok) {
      showModalAlert('ZIP rejected', zipCheck.error);
      return;
    }
  }

  var tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  productsState.editingFiles.push({
    id: tempId,
    filename: file.name,
    file_size_bytes: file.size,
    _uploading: true
  });
  productsState.editingProductBytes += file.size;
  renderProductFiles();

  try {
    var path = currentUser.id + '/' + productsState.editingId + '/' + Date.now() + '-' + dpSlugify(file.name.replace(/\.[^.]+$/, '')) + '.' + ext;
    var { error: upErr } = await sb.storage.from('digital-products').upload(path, file, {
      cacheControl: '0',
      upsert: false,
      contentType: file.type || 'application/octet-stream'
    });
    if (upErr) throw upErr;

    var { data: row, error: insErr } = await sb.from('digital_product_files').insert({
      product_id: productsState.editingId,
      filename: file.name,
      storage_path: path,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      scan_status: 'clean',
      sort_order: productsState.editingFiles.length
    }).select().single();
    if (insErr) {
      await sb.storage.from('digital-products').remove([path]);
      throw insErr;
    }

    var idx = productsState.editingFiles.findIndex(function(f) { return f.id === tempId; });
    if (idx >= 0) productsState.editingFiles[idx] = row;
  } catch (e) {
    console.error('Upload failed:', e);
    productsState.editingFiles = productsState.editingFiles.filter(function(f) { return f.id !== tempId; });
    productsState.editingProductBytes -= file.size;
    showModalAlert('Upload failed', 'Could not upload "' + file.name + '": ' + (e.message || 'Unknown error'));
  }
  renderProductFiles();
}

function renderProductFiles() {
  var listEl = document.getElementById('products-files-list');
  var countEl = document.getElementById('products-files-count');
  var sizeEl = document.getElementById('products-files-size');
  if (!listEl) return;

  countEl.textContent = '(' + productsState.editingFiles.length + ')';
  sizeEl.textContent = dpFormatBytes(productsState.editingProductBytes) + " used of this product's 300 MB";

  if (!productsState.editingFiles.length) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = productsState.editingFiles.map(function(f) {
    var status = f._uploading
      ? '<span class="prod-s-6c6a73">Uploading...</span>'
      : '<span class="prod-s-9d033f">\u2713 Ready</span>';
    var deleteBtn = f._uploading ? '' : '<button data-prod-action="remove-file" data-prod-file-id="' + dpEscapeHtml(f.id) + '" class="prod-s-0c201d">Remove</button>';
    return '<div class="prod-s-345ecc">'
      + '<div class="bio-s-a07604">'
      + '<div class="prod-s-bacfd9">' + dpEscapeHtml(f.filename) + '</div>'
      + '<div class="prod-s-79fe1a">' + dpFormatBytes(f.file_size_bytes) + ' \u00b7 ' + status + '</div>'
      + '</div>'
      + deleteBtn
      + '</div>';
  }).join('');
}

async function removeProductFile(fileId) {
  showModalConfirm('Remove file?', 'This file will be permanently deleted.', async function() {
    var f = productsState.editingFiles.find(function(x) { return x.id === fileId; });
    if (!f) return;
    try {
      // Delete DB row FIRST so a failed storage delete doesn't leave a dangling
      // DB row pointing at a missing object. If the storage delete fails after,
      // we get a harmless orphan storage object instead of a broken file row.
      var { error } = await sb.from('digital_product_files').delete().eq('id', fileId);
      if (error) throw error;
      if (f.storage_path) {
        try {
          await sb.storage.from('digital-products').remove([f.storage_path]);
        } catch (storageErr) {
          // Non-fatal — the DB row is already gone, so the buyer side won't
          // see it. Log for cleanup but don't block the UI.
          console.warn('Storage cleanup failed for', f.storage_path, storageErr);
        }
      }
      productsState.editingFiles = productsState.editingFiles.filter(function(x) { return x.id !== fileId; });
      productsState.editingProductBytes -= Number(f.file_size_bytes || 0);
      renderProductFiles();
      await refreshProductsStorage();
    } catch (e) {
      console.error('Remove file failed:', e);
      showModalAlert('Error', 'Could not delete this file.');
    }
  });
}

// Guard helpers — title is required before any upload because we need a
// product ID to namespace the storage path. Show a clear message and
// focus the title input if it's missing.
function dpRequireTitleBeforeUpload() {
  if (productsState.editingId) return true;
  var titleEl = document.getElementById('products-title');
  if (titleEl && titleEl.value.trim()) return true;
  showModalAlert('Add a title first', 'Please give your product a title before uploading files. The title can be changed at any time.');
  if (titleEl) {
    titleEl.focus();
    titleEl.style.borderColor = 'rgba(239,68,68,0.6)';
    setTimeout(function() { titleEl.style.borderColor = ''; }, 2000);
  }
  return false;
}
function dpClickCover() {
  // Cover is held in memory until Save, so no title required up-front
  document.getElementById('products-cover-input').click();
}
function dpClickAddFile() {
  if (!dpRequireTitleBeforeUpload()) return;
  document.getElementById('products-file-input').click();
}

// Client-side cover image compression. Resizes to max 1600px wide and
// re-encodes JPEGs at quality 0.82. Preserves transparency for PNG/WebP.
// Returns a new File ready for upload. Falls back to the original if
// compression fails or the file is already small enough.
async function dpCompressCoverImage(file) {
  // Skip if already small + reasonable
  if (file.size < 200 * 1024) {
    return file;
  }

  return new Promise(function(resolve) {
    var img = new Image();
    var url = URL.createObjectURL(file);

    img.onload = function() {
      try {
        URL.revokeObjectURL(url);

        var maxWidth = 1600;
        var w = img.naturalWidth;
        var h = img.naturalHeight;

        // Skip if already small enough in both dims and under 500KB
        if (w <= maxWidth && file.size < 500 * 1024) {
          resolve(file);
          return;
        }

        // Compute new dimensions preserving aspect ratio
        if (w > maxWidth) {
          h = Math.round(h * (maxWidth / w));
          w = maxWidth;
        }

        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // Decide output format
        var outputType, quality, outputExt;
        if (file.type === 'image/png') {
          outputType = 'image/png';
          quality = undefined;  // PNG ignores quality
          outputExt = 'png';
        } else if (file.type === 'image/webp') {
          outputType = 'image/webp';
          quality = 0.85;
          outputExt = 'webp';
        } else {
          // Default: JPEG (best compression for photos)
          outputType = 'image/jpeg';
          quality = 0.82;
          outputExt = 'jpg';
        }

        canvas.toBlob(function(blob) {
          if (!blob) {
            resolve(file);
            return;
          }
          // Only use the compressed version if it's actually smaller
          if (blob.size >= file.size) {
            resolve(file);
            return;
          }
          var newName = file.name.replace(/\.[^.]+$/, '') + '-compressed.' + outputExt;
          var compressed = new File([blob], newName, { type: outputType });
          resolve(compressed);
        }, outputType, quality);
      } catch (e) {
        console.error('Compression failed:', e);
        resolve(file);
      }
    };

    img.onerror = function() {
      URL.revokeObjectURL(url);
      resolve(file);  // fallback: upload original
    };

    img.src = url;
  });
}

// Cover image select — held in memory until Save (matches Course/Coaching pattern).
// Reads the file, compresses it, generates a preview blob URL, and stores
// the File on productsState. Actual upload happens in saveProduct().
async function onProductCoverSelect(input) {
  var file = (input.files || [])[0];
  input.value = '';
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showModalAlert('Image too large', 'Cover images must be under 5 MB.');
    return;
  }
  if (['image/jpeg','image/png','image/webp'].indexOf(file.type) === -1) {
    showModalAlert('Invalid format', 'Cover must be JPG, PNG, or WebP.');
    return;
  }

  try {
    var compressed = await dpCompressCoverImage(file);

    // Revoke previous preview URL if any
    if (productsState.coverPreviewUrl) {
      try { URL.revokeObjectURL(productsState.coverPreviewUrl); } catch (e) {}
    }

    productsState.coverFile = compressed;
    productsState.coverPreviewUrl = URL.createObjectURL(compressed);
    productsState.coverRemoved = false;  // user picked a new cover, override any pending remove

    var coverEl = document.getElementById('products-cover-preview');
    coverEl.style.backgroundImage = 'url(' + productsState.coverPreviewUrl + ')';
    coverEl.textContent = '';
    document.getElementById('products-cover-remove').style.display = 'inline-block';
  } catch (e) {
    console.error('Cover select failed:', e);
    showModalAlert('Image error', 'Could not process this image: ' + (e.message || 'Unknown error'));
  }
}

// Remove cover — clears the in-memory File and the preview. The actual storage
// object (if any) is deleted when the user hits Save.
function removeProductCover() {
  showModalConfirm('Remove cover image?', 'The cover image will be removed when you save.', function() {
    if (productsState.coverPreviewUrl) {
      try { URL.revokeObjectURL(productsState.coverPreviewUrl); } catch (e) {}
    }
    productsState.coverFile = null;
    productsState.coverPreviewUrl = null;
    // If there's an existing cover in the DB, mark it for removal on save
    if (productsState.editing && productsState.editing.cover_image_url) {
      productsState.coverRemoved = true;
    }
    var coverEl = document.getElementById('products-cover-preview');
    coverEl.style.backgroundImage = '';
    coverEl.textContent = 'Click to upload (1280\u00d7720 recommended)';
    document.getElementById('products-cover-remove').style.display = 'none';
  });
}

async function saveProductDraftSilently() {
  var title = (document.getElementById('products-title').value || '').trim();
  var slug = (document.getElementById('products-slug').value || '').trim();
  if (!title) return false;
  if (!slug) slug = dpSlugify(title);
  slug = await ensureUniqueProductSlug(slug);

  try {
    var { data, error } = await sb.from('digital_products').insert({
      user_id: currentUser.id,
      title: title,
      slug: slug,
      is_active: false
    }).select().single();
    if (error) throw error;
    productsState.editingId = data.id;
    productsState.editing = data;
    document.getElementById('products-slug').value = slug;
    document.getElementById('products-editor-title').textContent = 'Edit Product';
    document.getElementById('products-delete-btn').style.display = 'inline-block';
    dpUpdateLinkButtons();
    return true;
  } catch (e) {
    console.error('Silent draft save failed:', e);
    return false;
  }
}

async function ensureUniqueProductSlug(baseSlug) {
  var slug = baseSlug;
  for (var attempt = 0; attempt < 20; attempt++) {
    var { data: ok } = await sb.rpc('is_digital_product_slug_available', { p_slug: slug, p_exclude_id: productsState.editingId || null });
    if (ok) return slug;
    slug = baseSlug + '-' + Math.random().toString(36).slice(2, 6);
  }
  return baseSlug + '-' + Date.now();
}

async function saveProduct() {
  var title = (document.getElementById('products-title').value || '').trim();
  var slug = (document.getElementById('products-slug').value || '').trim();
  var description = (document.getElementById('products-description').value || '').trim();
  var priceStr = (document.getElementById('products-price').value || '').trim();
  var deliveryMessage = (document.getElementById('products-delivery-message').value || '').trim();

  if (!title) {
    showModalAlert('Title required', 'Please add a title for your product.');
    return;
  }
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    showModalAlert('Invalid URL slug', 'Slug must be lowercase letters, numbers, and hyphens only.');
    return;
  }

  var { data: slugOk } = await sb.rpc('is_digital_product_slug_available', { p_slug: slug, p_exclude_id: productsState.editingId || null });
  if (!slugOk) {
    showModalAlert('URL taken', 'This URL slug is already in use. Please choose a different one.');
    return;
  }

  var priceCents = 0;
  if (priceStr !== '') {
    var n = Number(priceStr);
    if (isNaN(n) || n < 0) {
      showModalAlert('Invalid price', 'Price must be 0 or greater.');
      return;
    }
    priceCents = Math.round(n * 100);
  }

  var saveBtn = document.getElementById('products-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    // Handle cover changes BEFORE writing the DB row, since we need the
    // resulting URL (or null) for the DB update.
    var newCoverUrl = null;          // URL to set in DB (if uploading new cover)
    var clearCoverInDb = false;       // Set cover_image_url=null in DB (if user clicked Remove)
    var oldCoverPath = null;          // Storage path of the previous cover, to delete after success

    // If we have a saved product with an existing cover, capture its storage path
    // so we can clean it up after a successful replace or removal.
    if (productsState.editing && productsState.editing.cover_image_url) {
      oldCoverPath = parseStoragePathFromCoverUrl(productsState.editing.cover_image_url);
    }

    if (productsState.coverFile) {
      // We need a product_id to namespace the storage path. If it's a new
      // product, we'll do the cover upload AFTER inserting the DB row below
      // (handled in step 2). For existing products, do it now.
      if (productsState.editingId) {
        var ext = (productsState.coverFile.name.split('.').pop() || 'jpg').toLowerCase();
        var path = currentUser.id + '/' + productsState.editingId + '/cover-' + Date.now() + '.' + ext;
        var { error: upErr } = await sb.storage.from('digital-products').upload(path, productsState.coverFile, {
          upsert: true,
          contentType: productsState.coverFile.type
        });
        if (upErr) throw upErr;
        var { data: signedData } = await sb.storage.from('digital-products').createSignedUrl(path, 60 * 60 * 24 * 365);
        newCoverUrl = signedData && signedData.signedUrl ? signedData.signedUrl : '';
      }
      // For new products, defer the upload until after we have the ID (below)
    } else if (productsState.coverRemoved) {
      clearCoverInDb = true;
    }

    var payload = {
      title: title,
      slug: slug,
      description: description || null,
      price_cents: priceCents,
      delivery_message: deliveryMessage || null
      // is_active is left alone — managed by the Publish/Unpublish toggle separately
    };
    if (newCoverUrl !== null) payload.cover_image_url = newCoverUrl;
    if (clearCoverInDb) payload.cover_image_url = null;

    var savedId;
    if (productsState.editingId) {
      var { error } = await sb.from('digital_products').update(payload).eq('id', productsState.editingId);
      if (error) throw error;
      savedId = productsState.editingId;
    } else {
      payload.user_id = currentUser.id;
      payload.is_active = false;  // New products start as draft
      var { data, error: e2 } = await sb.from('digital_products').insert(payload).select().single();
      if (e2) throw e2;
      savedId = data.id;
      productsState.editingId = savedId;
      productsState.editing = data;

      // For new products with a cover, upload it now that we have the ID
      if (productsState.coverFile) {
        var ext2 = (productsState.coverFile.name.split('.').pop() || 'jpg').toLowerCase();
        var path2 = currentUser.id + '/' + savedId + '/cover-' + Date.now() + '.' + ext2;
        var { error: upErr2 } = await sb.storage.from('digital-products').upload(path2, productsState.coverFile, {
          upsert: true,
          contentType: productsState.coverFile.type
        });
        if (upErr2) throw upErr2;
        var { data: signedData2 } = await sb.storage.from('digital-products').createSignedUrl(path2, 60 * 60 * 24 * 365);
        var coverUrl2 = signedData2 && signedData2.signedUrl ? signedData2.signedUrl : '';
        var { error: updErr2 } = await sb.from('digital_products').update({ cover_image_url: coverUrl2 }).eq('id', savedId);
        if (updErr2) throw updErr2;
        productsState.editing.cover_image_url = coverUrl2;
      }
    }

    // Refresh in-memory editing state with what we just saved
    if (newCoverUrl !== null) productsState.editing.cover_image_url = newCoverUrl;
    if (clearCoverInDb) productsState.editing.cover_image_url = null;
    Object.assign(productsState.editing, payload);

    // Best-effort cleanup of the previous cover storage object
    // (only after the new cover/null write succeeded — prevents orphan loss
    //  on failure, prevents orphan accumulation on success).
    if (oldCoverPath && (newCoverUrl !== null || clearCoverInDb)) {
      try {
        await sb.storage.from('digital-products').remove([oldCoverPath]);
      } catch (cleanupErr) {
        console.warn('Old cover cleanup failed:', cleanupErr);
      }
    }

    // Clear in-memory cover state (no longer pending)
    if (productsState.coverPreviewUrl) {
      try { URL.revokeObjectURL(productsState.coverPreviewUrl); } catch (e) {}
    }
    productsState.coverFile = null;
    productsState.coverPreviewUrl = null;
    productsState.coverRemoved = false;

    // Update the editor UI to reflect saved state
    var coverEl = document.getElementById('products-cover-preview');
    if (productsState.editing.cover_image_url) {
      coverEl.style.backgroundImage = 'url(' + productsState.editing.cover_image_url + ')';
      coverEl.textContent = '';
      document.getElementById('products-cover-remove').style.display = 'inline-block';
    } else {
      coverEl.style.backgroundImage = '';
      coverEl.textContent = 'Click to upload (1280\u00d7720 recommended)';
      document.getElementById('products-cover-remove').style.display = 'none';
    }

    // Show Publish button + Delete button now that we have a saved row
    document.getElementById('products-editor-title').textContent = 'Edit Product';
    document.getElementById('products-delete-btn').style.display = 'inline-block';
    updateProductPublishButton();
    dpUpdateLinkButtons();

    saveBtn.disabled = false;
    saveBtn.textContent = 'Saved!';
    setTimeout(function() { saveBtn.textContent = 'Save'; }, 1500);
  } catch (e) {
    console.error('Save failed:', e);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    showModalAlert('Save failed', e.message || 'Could not save this product.');
  }
}

// Parse a storage path out of a signed cover URL. Signed URLs look like:
//   https://<project>.supabase.co/storage/v1/object/sign/digital-products/<userId>/<productId>/cover-<ts>.<ext>?token=...
// We extract the part after "/digital-products/" and before "?".
function parseStoragePathFromCoverUrl(url) {
  if (!url) return null;
  try {
    var marker = '/digital-products/';
    var idx = url.indexOf(marker);
    if (idx === -1) return null;
    var rest = url.substring(idx + marker.length);
    var queryIdx = rest.indexOf('?');
    if (queryIdx >= 0) rest = rest.substring(0, queryIdx);
    return rest ? decodeURIComponent(rest) : null;
  } catch (e) {
    return null;
  }
}

// Show/style the Publish button based on the current is_active state
function updateProductPublishButton() {
  var btn = document.getElementById('products-publish-btn');
  var marketplaceToggle = document.getElementById('products-marketplace-toggle');
  if (!btn) return;
  if (!productsState.editingId || !productsState.editing) {
    btn.style.display = 'none';
    if (marketplaceToggle) marketplaceToggle.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-block';
  if (productsState.editing.is_active) {
    btn.textContent = 'Unpublish';
    btn.style.borderColor = 'rgba(239,68,68,0.4)';
    btn.style.color = '#ef4444';
    // Show marketplace toggle only when product is published
    if (marketplaceToggle) {
      marketplaceToggle.style.display = 'block';
      updateMarketplaceToggleUI('products', !!productsState.editing.listed_in_marketplace);
      updateMarketplaceCountDisplay();
    }
  } else {
    btn.textContent = 'Publish';
    btn.style.borderColor = 'rgba(74,222,128,0.4)';
    btn.style.color = '#4ade80';
    if (marketplaceToggle) marketplaceToggle.style.display = 'none';
  }
}

// Toggle is_active on the current product. Requires at least one file to publish.
async function toggleProductPublish() {
  if (!productsState.editingId || !productsState.editing) return;
  var goingLive = !productsState.editing.is_active;

  if (goingLive && productsState.editingFiles.length === 0) {
    showModalAlert('Add at least one file', 'You need to upload at least one file before publishing this product.');
    return;
  }

  // If publishing, check Stripe is connected (matches courses + coaching publish gate)
  if (goingLive) {
    var stripeStatusRes = await fetch('/api/stripe-status', {
      headers: { Authorization: 'Bearer ' + Auth.getToken() }
    });
    var stripeStatus = stripeStatusRes.ok ? await stripeStatusRes.json() : { connected: false };
    if (!stripeStatus.connected) {
      var stripeOverlay = document.createElement('div');
      stripeOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
      stripeOverlay.innerHTML = '<div class="course-s-cf97d8">'
        + '<div class="course-s-0c5d23"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>'
        + '<div class="course-s-bc1a76">Connect Stripe to Publish</div>'
        + '<p class="course-s-8b98d3">You need to connect your Stripe account before you can publish a digital product. This lets you accept payments from buyers.</p>'
        + '<button id="dp-stripe-settings-btn" class="course-s-6673c3">Go to Settings</button>'
        + '<button id="dp-stripe-cancel-btn" class="course-s-9f3ba9">Cancel</button>'
        + '</div>';
      document.body.appendChild(stripeOverlay);
      document.getElementById('dp-stripe-settings-btn').onclick = function() { stripeOverlay.remove(); openSettingsModal(); };
      document.getElementById('dp-stripe-cancel-btn').onclick = function() { stripeOverlay.remove(); };
      stripeOverlay.onclick = function(e) { if (e.target === stripeOverlay) stripeOverlay.remove(); };
      return;
    }
  }

  var btn = document.getElementById('products-publish-btn');
  btn.disabled = true;
  var origText = btn.textContent;
  btn.textContent = goingLive ? 'Publishing...' : 'Unpublishing...';

  try {
    // When unpublishing, also unlist from marketplace (matches Course/Coaching pattern)
    var updates = { is_active: goingLive };
    if (!goingLive) updates.listed_in_marketplace = false;

    var { error } = await sb.from('digital_products').update(updates).eq('id', productsState.editingId);
    if (error) throw error;
    productsState.editing.is_active = goingLive;
    if (!goingLive) productsState.editing.listed_in_marketplace = false;
    updateProductPublishButton();
  } catch (e) {
    console.error('Publish toggle failed:', e);
    btn.textContent = origText;
    showModalAlert('Could not update', e.message || 'Failed to change publish status.');
  } finally {
    btn.disabled = false;
  }
}

async function deleteProduct() {
  if (!productsState.editingId) return;
  showModalConfirm(
    'Delete this product?',
    'This will permanently delete the product and all its files. Buyers who already purchased will lose access. This cannot be undone.',
    async function() {
      try {
        var paths = productsState.editingFiles.map(function(f) { return f.storage_path; }).filter(Boolean);
        var deletedId = productsState.editingId;
        var { error } = await sb.from('digital_products').delete().eq('id', deletedId);
        if (error) throw error;
        if (paths.length) {
          await sb.storage.from('digital-products').remove(paths);
        }
        try {
          var folder = currentUser.id + '/' + deletedId;
          var { data: folderItems } = await sb.storage.from('digital-products').list(folder);
          if (folderItems && folderItems.length) {
            var leftover = folderItems.map(function(it) { return folder + '/' + it.name; });
            await sb.storage.from('digital-products').remove(leftover);
          }
        } catch (cleanupErr) { }

        // Remove from bio links if present (matches Course/Coaching cleanup pattern)
        try {
          var { data: bioData } = await sb.from('link_in_bio').select('links').eq('user_id', currentUser.id).maybeSingle();
          if (bioData && Array.isArray(bioData.links)) {
            var filtered = bioData.links.filter(function(l) { return !(l.isProduct && l.productId === deletedId); });
            if (filtered.length !== bioData.links.length) {
              await sb.from('link_in_bio').update({ links: filtered }).eq('user_id', currentUser.id);
              if (typeof bioState !== 'undefined' && bioState.links) {
                bioState.links = bioState.links.filter(function(l) { return !(l.isProduct && l.productId === deletedId); });
              }
            }
          }
        } catch (bioErr) { console.warn('Failed to clean bio link:', bioErr); }

        closeProductEditor();
      } catch (e) {
        console.error('Delete failed:', e);
        showModalAlert('Delete failed', e.message || 'Could not delete this product.');
      }
    },
    'Delete'
  );
}


// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Markup buttons
prodRegisterAction('max-upgrade', (e) => handleMaxUpgradeClick(e));
prodRegisterAction('open-editor', (e, el) => openProductEditor(el.dataset.prodId || undefined));
prodRegisterAction('close-editor', () => closeProductEditor());
prodRegisterAction('save', () => saveProduct());
prodRegisterAction('toggle-publish', () => toggleProductPublish());
prodRegisterAction('toggle-marketplace', () => {
  // Pre-existing: toggleProductMarketplace is referenced from markup but never
  // defined anywhere in dashboard.html. Wired here as a no-op + warn to match
  // existing behavior (would throw `not defined` if called pre-refactor too).
  if (typeof toggleProductMarketplace === 'function') {
    toggleProductMarketplace();
  } else {
    console.warn('toggleProductMarketplace is not defined');
  }
});
prodRegisterAction('delete', () => deleteProduct());
prodRegisterAction('copy-url', () => copyProductUrl());
prodRegisterAction('auto-update-slug', () => autoUpdateProductSlug());

// Cover image
prodRegisterAction('click-cover', () => dpClickCover());
prodRegisterAction('cover-selected', (e, el) => onProductCoverSelect(el));
prodRegisterAction('remove-cover', () => removeProductCover());

// Files
prodRegisterAction('click-add-file', () => dpClickAddFile());
prodRegisterAction('upload-files', (e, el) => uploadProductFiles(el));
prodRegisterAction('show-compatible-modal', () => {
  if (typeof showCompatibleFilesModal === 'function') {
    showCompatibleFilesModal();
  } else {
    console.warn('showCompatibleFilesModal is not defined');
  }
});
prodRegisterAction('remove-file', (e, el) => removeProductFile(el.dataset.prodFileId));

