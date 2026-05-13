// =============================================================================
// /js/image.js — Photo Editor (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Photo Editor tool. (Internal section name in the
// original was "IMAGE CONVERTER" — kept the imgXxx() and img-* DOM ID naming
// convention for consistency.) Extracted from dashboard.html for stricter CSP.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/image.js
//   • Phase 2: inline onclick/oninput → data-image-action attributes
//   • Phase 3: static inline class="bio-s-6eae3a" → hash-named CSS classes
//
// External dependencies on window: none (self-contained tool — uses only
// browser APIs: Image, FileReader, Blob, URL, Canvas, etc).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE
// =============================================================================

const imageActions = {};

function imageRegisterAction(action, handler) {
  imageActions[action] = handler;
}

function imageFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['imageAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.imageAction) {
        const wantEvent = el.dataset.imageEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.imageAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function imageDispatchEvent(event) {
  const found = imageFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = imageActions[found.action];
  if (!handler) {
    console.warn('[image] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, imageDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 12687-13564 (Photo Editor) ----------
// ════════════════════════════════════════════
// IMAGE CONVERTER
// ════════════════════════════════════════════
let imgFile = null;

function initImageConverter() {
  // Detect which output formats this browser actually supports via canvas.toDataURL
  // and remove unsupported options from the dropdown so users only see what works.
  (function pruneUnsupportedFormats() {
    const formatSelect = document.getElementById('img-format');
    if (!formatSelect || formatSelect.__pdfsignFormatsPruned) return;
    formatSelect.__pdfsignFormatsPruned = true;
    const testCanvas = document.createElement('canvas');
    testCanvas.width = testCanvas.height = 2;
    // JPEG and PNG are universally supported — never remove them.
    const skip = new Set(['image/jpeg', 'image/png']);
    Array.from(formatSelect.options).forEach(opt => {
      const mime = opt.value;
      if (skip.has(mime)) return;
      let supported = false;
      try {
        const dataUrl = testCanvas.toDataURL(mime);
        // If browser doesn't support it, toDataURL silently returns a PNG instead.
        supported = dataUrl.startsWith(`data:${mime}`);
      } catch (_) { supported = false; }
      if (!supported) opt.remove();
    });
    // Update the format-change handler to handle remaining options correctly
    // (already correct — it uses .value lookup, no list dependency)
  })();

  // img-limit-note removed per copy update; hide the element so it doesn't leave a gap
  (function(){ var n = document.getElementById('img-limit-note'); if (n) { n.textContent = ''; n.style.display = 'none'; } })();
  // Build the supported-formats note dynamically based on the pruned dropdown
  const supportedNote = (function() {
    const sel = document.getElementById('img-format');
    if (!sel) return 'JPEG, PNG, WebP';
    const labels = Array.from(sel.options).map(o => o.textContent.replace(/\s*\(.*\)/, '').trim());
    return labels.join(', ');
  })();
  const sizeNote = document.getElementById('img-size-note');
  if (sizeNote) sizeNote.textContent = `Supports ${supportedNote}`;
  document.getElementById('img-usage').textContent = '';
  document.getElementById('img-format').addEventListener('change', function() {
    const noQuality = ['image/png','image/gif','image/bmp','image/x-icon','image/tiff']; document.getElementById('quality-group').style.display = noQuality.includes(this.value) ? 'none' : 'block';
  });

  // Aspect ratio buttons use inline onclick handlers (no listener needed here).

  // Zoom slider
  const zoomSlider = document.getElementById('img-crop-zoom');
  if (zoomSlider && !zoomSlider.__wired) {
    zoomSlider.__wired = true;
    zoomSlider.addEventListener('input', function() {
      applyCropZoom(parseInt(this.value));
      // Update stage cursor based on zoom level
      const stage = document.getElementById('img-crop-stage');
      if (stage) stage.style.cursor = imgCropZoom > 1 ? 'grab' : 'default';
    });
  }

  // Stage pan (click anywhere outside crop box to drag image around when zoomed in)
  const stage = document.getElementById('img-crop-stage');
  if (stage && !stage.__panWired) {
    stage.__panWired = true;
    stage.addEventListener('mousedown', startStagePan);
    stage.addEventListener('touchstart', startStagePan, { passive: false });
  }

  // Adjust sliders (brightness / contrast / saturation)
  ['brightness', 'contrast', 'saturation'].forEach(kind => {
    const el = document.getElementById('img-' + kind);
    if (!el || el.__wired) return;
    el.__wired = true;
    el.addEventListener('input', function() {
      const v = parseInt(this.value) || 0;
      if (kind === 'brightness') imgBrightness = v;
      if (kind === 'contrast')   imgContrast   = v;
      if (kind === 'saturation') imgSaturation = v;
      updateAdjustLabels();
      applyImageVisualEffects();
    });
  });

  // Crop box drag (move + resize handles)
  const cropBoxEl = document.getElementById('img-crop-box');
  if (cropBoxEl && !cropBoxEl.__wired) {
    cropBoxEl.__wired = true;
    cropBoxEl.addEventListener('mousedown', function(e) {
      if (e.target.classList.contains('img-crop-handle')) {
        startCropInteraction(e, 'resize', e.target.getAttribute('data-handle'));
      } else {
        startCropInteraction(e, 'move');
      }
    });
    cropBoxEl.addEventListener('touchstart', function(e) {
      if (e.target.classList.contains('img-crop-handle')) {
        startCropInteraction(e, 'resize', e.target.getAttribute('data-handle'));
      } else {
        startCropInteraction(e, 'move');
      }
    }, { passive: false });
  }

  // Re-render crop box on window resize (layout could change)
  if (!window.__imgStudioResize) {
    window.__imgStudioResize = true;
    window.addEventListener('resize', () => { if (imgCropBox) renderCropBox(); });
  }
  document.getElementById('img-input').addEventListener('change', function(e) {
    if (e.target.files[0]) handleImageFile(e.target.files[0]);
  });
  const dz = document.getElementById('img-dropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor = 'rgba(124,58,237,0.4)'; });
  dz.addEventListener('drop', e => { e.preventDefault(); dz.style.borderColor = 'rgba(124,58,237,0.4)'; if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]); });
}

function handleImageFile(file) {
  imgFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('img-preview').src = e.target.result;
    document.getElementById('img-preview-area').style.display = 'block';
    document.getElementById('img-editor').style.display = 'block';
    document.getElementById('img-convert-btn').style.display = 'block';
    document.getElementById('img-result').style.display = 'none';
    document.getElementById('img-filename').textContent = file.name;
    document.getElementById('img-filesize').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';
    // Always default to Crop tab on new image load
    switchImgTab('crop');
    // Set up crop stage with full-size image
    setupCropStage(e.target.result);
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  imgFile = null;
  document.getElementById('img-preview-area').style.display = 'none';
  const editor = document.getElementById('img-editor');
  if (editor) editor.style.display = 'none';
  document.getElementById('img-convert-btn').style.display = 'none';
  document.getElementById('img-result').style.display = 'none';
  document.getElementById('img-input').value = '';
  document.getElementById('img-width').value = '';
  document.getElementById('img-height').value = '';
  imgNatural = { w: 0, h: 0 };
  // Reset zoom state
  const zoomSlider = document.getElementById('img-crop-zoom');
  if (zoomSlider) zoomSlider.value = '100';
  const inner = document.getElementById('img-crop-inner');
  if (inner) inner.style.transform = 'translate(0px,0px) scale(1)';
  imgCropZoom = 1;
  imgCropPan = { x: 0, y: 0 };
  // Reset adjustments
  imgBrightness = 0; imgContrast = 0; imgSaturation = 0;
  imgRotation = 0; imgFlipH = false; imgFlipV = false;
  const imgEl = document.getElementById('img-crop-src');
  if (imgEl) { imgEl.style.filter = ''; imgEl.style.transform = ''; }
}

// ───── Crop box state ─────
let imgNatural = { w: 0, h: 0 };    // Original image dimensions
let imgCropBox = null;              // { x, y, w, h } in pixels relative to the DISPLAYED (scaled) image
let imgDisplaySize = { w: 0, h: 0 };// Displayed image size in CSS pixels
let imgAspectLock = null;           // e.g. 1 for 1:1, 9/16 for 9:16, null for free
let imgCropMode = 'original';       // 'free' | '1:1' | '4:5' | '9:16' | '16:9' | '3:1' | 'original'
let imgCropLocked = false;          // true = crop committed; box can't move or resize
let imgCropZoom = 1;                // 1 = 100%, scales the image + crop box together
let imgCropPan = { x: 0, y: 0 };    // Translation offset in CSS pixels (screen space)
let imgBrightness = 0;              // -100 to +100
let imgContrast = 0;                // -100 to +100
let imgSaturation = 0;              // -100 to +100
let imgRotation = 0;                // 0, 90, 180, 270 degrees
let imgFlipH = false;
let imgFlipV = false;

function switchImgTab(tabName) {
  const panels = ['crop', 'adjust', 'output'];
  panels.forEach(name => {
    const panel = document.getElementById('img-tab-' + name);
    if (panel) panel.style.display = (name === tabName) ? 'block' : 'none';
  });
  document.querySelectorAll('.img-tab').forEach(btn => {
    const isActive = btn.getAttribute('data-tab') === tabName;
    if (isActive) {
      btn.classList.add('img-tab-active');
      btn.style.background = 'var(--accent)';
      btn.style.color = '#fff';
      btn.style.boxShadow = '0 2px 8px rgba(124,58,237,0.3)';
    } else {
      btn.classList.remove('img-tab-active');
      btn.style.background = 'transparent';
      btn.style.color = 'var(--muted)';
      btn.style.boxShadow = 'none';
    }
  });
}

function setupCropStage(dataUrl) {
  const stageImg = document.getElementById('img-crop-src');
  const stage = document.getElementById('img-crop-stage');

  stageImg.onload = () => {
    imgNatural = { w: stageImg.naturalWidth, h: stageImg.naturalHeight };
    // Wait one frame for layout to settle, THEN measure displayed size
    requestAnimationFrame(() => {
      imgDisplaySize = { w: stageImg.clientWidth, h: stageImg.clientHeight };
      // Fallback: if still zero (edge case), derive from natural + container bounds
      if (!imgDisplaySize.w || !imgDisplaySize.h) {
        const maxH = 540;
        const containerW = stage.clientWidth || 640;
        const scale = Math.min(containerW / imgNatural.w, maxH / imgNatural.h, 1);
        imgDisplaySize = {
          w: Math.round(imgNatural.w * scale),
          h: Math.round(imgNatural.h * scale)
        };
      }
      // Initialize crop box (will be overwritten by applyAspectPreset below)
      imgCropBox = { x: 0, y: 0, w: imgDisplaySize.w, h: imgDisplaySize.h };
      // Reset all adjustments for new image
      resetAllAdjustments();
      // Reset zoom to 100% for new image
      resetCropZoom();
      // Default new images to "Original" (full image, no crop applied by default)
      applyAspectPreset('original');
    });
  };
  stageImg.src = dataUrl;
}

function resetCropBox() {
  const stage = document.getElementById('img-crop-stage');
  if (!stage) return;
  imgAspectLock = null;
  imgCropMode = 'free';
  imgCropLocked = false;
  updateAspectButtonsUI();
  updateLockButtonUI();
  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;
  // Default: a centered 80% box sized to the stage (where the image sits)
  const w = stageW * 0.7;
  const h = stageH * 0.7;
  imgCropBox = {
    x: (stageW - w) / 2,
    y: (stageH - h) / 2,
    w, h
  };
  renderCropBox();
}

function applyAspectPreset(preset) {
  const stage = document.getElementById('img-crop-stage');
  if (!stage || !imgDisplaySize.w) return;
  // Selecting a preset always unlocks (user is picking a new ratio)
  imgCropLocked = false;
  imgCropMode = preset;
  updateAspectButtonsUI();
  updateLockButtonUI();

  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;

  if (preset === 'free') {
    imgAspectLock = null;
    // Keep current box if one exists
    if (!imgCropBox) {
      const w = stageW * 0.7;
      const h = stageH * 0.7;
      imgCropBox = { x: (stageW - w) / 2, y: (stageH - h) / 2, w, h };
    }
    renderCropBox();
    return;
  }
  if (preset === 'original') {
    imgAspectLock = null;
    // Fit the crop box to exactly cover the displayed image
    imgCropBox = {
      x: (stageW - imgDisplaySize.w) / 2,
      y: (stageH - imgDisplaySize.h) / 2,
      w: imgDisplaySize.w,
      h: imgDisplaySize.h
    };
    renderCropBox();
    return;
  }
  const [a, b] = preset.split(':').map(Number);
  imgAspectLock = a / b;
  // Center an aspect-ratio box of up to 80% of the stage (not the image)
  let cw = stageW * 0.85;
  let ch = cw / imgAspectLock;
  if (ch > stageH * 0.85) {
    ch = stageH * 0.85;
    cw = ch * imgAspectLock;
  }
  imgCropBox = {
    x: (stageW - cw) / 2,
    y: (stageH - ch) / 2,
    w: cw, h: ch
  };
  renderCropBox();
}

function updateAspectButtonsUI() {
  const btns = document.querySelectorAll('.img-aspect-btn');
  btns.forEach(btn => {
    const isActive = btn.getAttribute('data-aspect') === imgCropMode;
    if (isActive) {
      btn.classList.add('img-aspect-active');
      btn.style.background = 'var(--accent)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--accent)';
    } else {
      btn.classList.remove('img-aspect-active');
      btn.style.background = 'var(--surface)';
      btn.style.color = 'var(--muted)';
      btn.style.borderColor = 'var(--border-hover)';
    }
  });
}

function updateLockButtonUI() {
  const btn = document.getElementById('img-crop-lock-btn');
  if (!btn) return;
  if (imgCropLocked) {
    btn.textContent = 'Unlock crop';
    btn.style.background = 'rgba(124,58,237,0.12)';
    btn.style.color = 'var(--accent2)';
    btn.style.borderColor = 'rgba(124,58,237,0.4)';
  } else {
    btn.textContent = 'Lock crop';
    btn.style.background = 'var(--surface)';
    btn.style.color = 'var(--text)';
    btn.style.borderColor = 'var(--border-hover)';
  }
}

function toggleCropLock() {
  // Simply toggle — preserve the current crop box either way.
  // User can keep refining the crop after unlocking without losing position.
  imgCropLocked = !imgCropLocked;
  updateLockButtonUI();
  renderCropBox();
}

function renderCropBox() {
  if (!imgCropBox) return;
  const stage = document.getElementById('img-crop-stage');
  const stageImg = document.getElementById('img-crop-src');
  const box = document.getElementById('img-crop-box');
  // Refresh display size each render in case of layout changes
  if (stageImg.clientWidth && stageImg.clientHeight) {
    imgDisplaySize = { w: stageImg.clientWidth, h: stageImg.clientHeight };
  }
  if (!imgDisplaySize.w || !imgDisplaySize.h) return;
  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;
  // Clamp box size to not exceed the stage
  imgCropBox.w = Math.min(imgCropBox.w, stageW);
  imgCropBox.h = Math.min(imgCropBox.h, stageH);
  // Clamp box position to stay within stage
  imgCropBox.x = Math.max(0, Math.min(stageW - imgCropBox.w, imgCropBox.x));
  imgCropBox.y = Math.max(0, Math.min(stageH - imgCropBox.h, imgCropBox.y));
  box.style.display = 'block';
  box.style.left = imgCropBox.x + 'px';
  box.style.top = imgCropBox.y + 'px';
  box.style.width = imgCropBox.w + 'px';
  box.style.height = imgCropBox.h + 'px';
  // Visual state: dashed/purple when locked, solid white when active
  if (imgCropLocked) {
    box.style.cursor = 'default';
    box.style.borderColor = '#a78bfa';
    box.style.borderStyle = 'dashed';
  } else {
    box.style.cursor = 'move';
    box.style.borderColor = '#fff';
    box.style.borderStyle = 'solid';
  }
  // Show resize handles ONLY when in Free mode and not locked
  const handlesVisible = (imgCropMode === 'free' && !imgCropLocked);
  document.querySelectorAll('.img-crop-handle').forEach(h => {
    h.style.display = handlesVisible ? 'block' : 'none';
  });
  // Update dimensions readout — calculated from crop region in natural-pixel space
  const region = computeCropRegionInNaturalPixels();
  const dims = document.getElementById('img-crop-dims');
  if (dims) dims.textContent = `Crop: ${region.w} × ${region.h} px`;
}

// Compute what region of the ORIGINAL image lies inside the stage-fixed crop box,
// accounting for current zoom and pan of the image (and rotation).
// Returns {x, y, w, h} in natural-pixel coordinates of the original image AFTER rotation/flip.
function computeCropRegionInNaturalPixels() {
  const stage = document.getElementById('img-crop-stage');
  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;
  const effDisp = getEffectiveImageDisplaySize();
  const effNat = getEffectiveNaturalSize();
  // Image center in stage CSS pixels (image is flex-centered, then translated)
  const imgCenterX = stageW / 2 + imgCropPan.x;
  const imgCenterY = stageH / 2 + imgCropPan.y;
  // Scaled image dimensions in stage space (using effective dims due to rotation)
  const scaledImgW = effDisp.w * imgCropZoom;
  const scaledImgH = effDisp.h * imgCropZoom;
  // Top-left of image in stage space
  const imgLeft = imgCenterX - scaledImgW / 2;
  const imgTop  = imgCenterY - scaledImgH / 2;
  // Crop box corners in stage space
  const cropLeft = imgCropBox.x;
  const cropTop  = imgCropBox.y;
  const cropRight = imgCropBox.x + imgCropBox.w;
  const cropBottom = imgCropBox.y + imgCropBox.h;
  // Convert to EFFECTIVE displayed-image space
  const dispX1 = (cropLeft   - imgLeft) / imgCropZoom;
  const dispY1 = (cropTop    - imgTop)  / imgCropZoom;
  const dispX2 = (cropRight  - imgLeft) / imgCropZoom;
  const dispY2 = (cropBottom - imgTop)  / imgCropZoom;
  // Clip to effective displayed image bounds
  const clipX1 = Math.max(0, Math.min(effDisp.w, dispX1));
  const clipY1 = Math.max(0, Math.min(effDisp.h, dispY1));
  const clipX2 = Math.max(0, Math.min(effDisp.w, dispX2));
  const clipY2 = Math.max(0, Math.min(effDisp.h, dispY2));
  // Map to effective natural image pixels (post-rotation)
  const scale = effNat.w / effDisp.w;
  return {
    x: Math.round(clipX1 * scale),
    y: Math.round(clipY1 * scale),
    w: Math.round((clipX2 - clipX1) * scale),
    h: Math.round((clipY2 - clipY1) * scale),
  };
}

// Returns the effective on-screen dimensions of the image, accounting for rotation.
// When rotated 90° or 270°, width and height are visually swapped.
function getEffectiveImageDisplaySize() {
  if (imgRotation === 90 || imgRotation === 270) {
    return { w: imgDisplaySize.h, h: imgDisplaySize.w };
  }
  return { w: imgDisplaySize.w, h: imgDisplaySize.h };
}

// Returns effective natural dimensions after rotation
function getEffectiveNaturalSize() {
  if (imgRotation === 90 || imgRotation === 270) {
    return { w: imgNatural.h, h: imgNatural.w };
  }
  return { w: imgNatural.w, h: imgNatural.h };
}

function applyInnerTransform() {
  const inner = document.getElementById('img-crop-inner');
  if (!inner) return;
  // Translate + zoom
  inner.style.transform = `translate(${imgCropPan.x}px, ${imgCropPan.y}px) scale(${imgCropZoom})`;
  // Re-render crop box so dimensions readout reflects current image position
  if (imgCropBox) renderCropBox();
  // Apply image-level transforms (rotation, flip) and filters (brightness/contrast/saturation)
  applyImageVisualEffects();
}

// Build a CSS filter string from current brightness/contrast/saturation values
function buildImageFilterString() {
  // Slider range -100..+100 maps to CSS:
  //   brightness: 0..2 (1 = unchanged)
  //   contrast:   0..2 (1 = unchanged)
  //   saturate:   0..2 (1 = unchanged)
  const b = 1 + (imgBrightness / 100);
  const c = 1 + (imgContrast / 100);
  const s = 1 + (imgSaturation / 100);
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
}

// Apply filter + rotation/flip to the image element for live preview
function applyImageVisualEffects() {
  const imgEl = document.getElementById('img-crop-src');
  if (!imgEl) return;
  imgEl.style.filter = buildImageFilterString();
  // Apply rotation/flip via a separate transform on the IMAGE itself.
  // Zoom/pan lives on #img-crop-inner; this keeps them independent.
  const sx = imgFlipH ? -1 : 1;
  const sy = imgFlipV ? -1 : 1;
  imgEl.style.transform = `rotate(${imgRotation}deg) scale(${sx}, ${sy})`;
  imgEl.style.transformOrigin = 'center center';
}

function updateAdjustLabels() {
  const b = document.getElementById('img-brightness-val');
  const c = document.getElementById('img-contrast-val');
  const s = document.getElementById('img-saturation-val');
  if (b) b.textContent = imgBrightness > 0 ? `+${imgBrightness}` : `${imgBrightness}`;
  if (c) c.textContent = imgContrast > 0 ? `+${imgContrast}` : `${imgContrast}`;
  if (s) s.textContent = imgSaturation > 0 ? `+${imgSaturation}` : `${imgSaturation}`;
}

function resetAllAdjustments() {
  imgBrightness = 0;
  imgContrast = 0;
  imgSaturation = 0;
  imgRotation = 0;
  imgFlipH = false;
  imgFlipV = false;
  const b = document.getElementById('img-brightness');
  const c = document.getElementById('img-contrast');
  const s = document.getElementById('img-saturation');
  if (b) b.value = '0';
  if (c) c.value = '0';
  if (s) s.value = '0';
  updateAdjustLabels();
  applyImageVisualEffects();
  // Rotation changed the effective image dimensions, so re-center the crop
  if (imgCropBox) applyAspectPreset(imgCropMode);
}

function rotateImage90() {
  imgRotation = (imgRotation + 90) % 360;
  applyImageVisualEffects();
  // Rotating 90° swaps width and height effectively. Reset crop to fit new orientation.
  if (imgCropBox) applyAspectPreset(imgCropMode);
}

function flipImageH() {
  imgFlipH = !imgFlipH;
  applyImageVisualEffects();
}

function flipImageV() {
  imgFlipV = !imgFlipV;
  applyImageVisualEffects();
}

function clampPan() {
  // Allow the image to be panned but keep at least some portion visible
  const stage = document.getElementById('img-crop-stage');
  const inner = document.getElementById('img-crop-inner');
  if (!stage || !inner) return;
  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;
  const scaledW = imgDisplaySize.w * imgCropZoom;
  const scaledH = imgDisplaySize.h * imgCropZoom;
  // When not zoomed (image fits in stage), no panning allowed
  if (scaledW <= stageW) imgCropPan.x = 0;
  else {
    const maxX = (scaledW - stageW) / 2;
    imgCropPan.x = Math.max(-maxX, Math.min(maxX, imgCropPan.x));
  }
  if (scaledH <= stageH) imgCropPan.y = 0;
  else {
    const maxY = (scaledH - stageH) / 2;
    imgCropPan.y = Math.max(-maxY, Math.min(maxY, imgCropPan.y));
  }
}

function applyCropZoom(zoomPct) {
  const prevZoom = imgCropZoom;
  imgCropZoom = zoomPct / 100;
  // When zooming out to 100%, reset pan (no panning needed)
  if (imgCropZoom <= 1) imgCropPan = { x: 0, y: 0 };
  else {
    // Scale existing pan proportionally so view stays roughly centered on the same spot
    if (prevZoom > 0) {
      const ratio = imgCropZoom / prevZoom;
      imgCropPan.x *= ratio;
      imgCropPan.y *= ratio;
    }
    clampPan();
  }
  applyInnerTransform();
  const valEl = document.getElementById('img-crop-zoom-val');
  if (valEl) valEl.textContent = `${zoomPct}%`;
}

function resetCropZoom() {
  const slider = document.getElementById('img-crop-zoom');
  if (slider) slider.value = '100';
  imgCropPan = { x: 0, y: 0 };
  applyCropZoom(100);
}

function startStagePan(e) {
  // Only pan if clicking inside the stage but NOT on the crop box or its handles
  if (e.target.closest('#img-crop-box')) return;
  // Don't pan if zoomed out fully (nothing to pan)
  if (imgCropZoom <= 1) return;
  e.preventDefault();
  const stage = document.getElementById('img-crop-stage');
  const startX = e.touches ? e.touches[0].clientX : e.clientX;
  const startY = e.touches ? e.touches[0].clientY : e.clientY;
  const origPan = { ...imgCropPan };
  stage.style.cursor = 'grabbing';

  function onMove(ev) {
    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
    imgCropPan.x = origPan.x + (cx - startX);
    imgCropPan.y = origPan.y + (cy - startY);
    clampPan();
    applyInnerTransform();
    ev.preventDefault();
  }
  function onEnd() {
    stage.style.cursor = 'grab';
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

function startCropInteraction(e, mode, handle) {
  // When locked, no interaction allowed
  if (imgCropLocked) { e.preventDefault(); return; }
  // Resize only allowed in free mode; preset crops can only be moved
  if (mode === 'resize' && imgCropMode !== 'free') { e.preventDefault(); return; }
  e.preventDefault();
  e.stopPropagation();
  if (!imgCropBox) return;
  const startX = e.touches ? e.touches[0].clientX : e.clientX;
  const startY = e.touches ? e.touches[0].clientY : e.clientY;
  const origBox = { ...imgCropBox };

  function onMove(ev) {
    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
    // Crop box lives in stage space; mouse deltas translate 1:1
    const dx = cx - startX;
    const dy = cy - startY;

    if (mode === 'move') {
      imgCropBox.x = origBox.x + dx;
      imgCropBox.y = origBox.y + dy;
    } else if (mode === 'resize') {
      let newX = origBox.x, newY = origBox.y, newW = origBox.w, newH = origBox.h;
      if (handle.includes('e')) newW = Math.max(20, origBox.w + dx);
      if (handle.includes('w')) { newW = Math.max(20, origBox.w - dx); newX = origBox.x + (origBox.w - newW); }
      if (handle.includes('s')) newH = Math.max(20, origBox.h + dy);
      if (handle.includes('n')) { newH = Math.max(20, origBox.h - dy); newY = origBox.y + (origBox.h - newH); }

      // If aspect locked, adjust H from W (or W from H based on which edge was primary)
      if (imgAspectLock) {
        if (handle === 'e' || handle === 'w' || handle === 'ne' || handle === 'se' || handle === 'nw' || handle === 'sw') {
          newH = newW / imgAspectLock;
          if (handle.includes('n')) newY = origBox.y + (origBox.h - newH);
        }
      }
      imgCropBox = { x: newX, y: newY, w: newW, h: newH };
    }
    renderCropBox();
    ev.preventDefault();
  }
  function onEnd() {
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

function setResizePreset(pixels) {
  const wInput = document.getElementById('img-width');
  const hInput = document.getElementById('img-height');
  const lock = document.getElementById('img-resize-lock').checked;
  wInput.value = pixels;
  if (lock && imgNatural.w && imgCropBox) {
    const region = computeCropRegionInNaturalPixels();
    if (region.w > 0 && region.h > 0) {
      hInput.value = Math.round(pixels * (region.h / region.w));
      return;
    }
  }
  if (lock && imgNatural.w) {
    hInput.value = Math.round(pixels * (imgNatural.h / imgNatural.w));
  }
}
function clearResize() {
  document.getElementById('img-width').value = '';
  document.getElementById('img-height').value = '';
}

async function imgRemoveBg() {
  if (!imgFile) return;

  if (typeof isPro === 'function' && !isPro()) {
    if (typeof showModalAlert === 'function') {
      showModalAlert('Background removal is a Pro feature. Upgrade to use it.');
    } else {
      alert('Background removal is a Pro feature. Upgrade to use it.');
    }
    return;
  }

  var btn = document.getElementById('img-removebg-btn');

  function resetBtn() {
    btn.disabled = false;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l14 14M2 12a10 10 0 0 1 10-10M22 12a10 10 0 0 1-10 10"/></svg> <span id="img-removebg-label">Remove Background</span>';
  }

  function doRemoval() {
    btn.disabled = true;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" class="ds-s-f33c30" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Processing...';

    window._dsBgRemoveFunc(imgFile).then(function(resultBlob) {
      var newName = imgFile.name.replace(/\.[^/.]+$/, '') + '_no-bg.png';
      var newFile = new File([resultBlob], newName, { type: 'image/png' });
      imgFile = newFile;

      var reader = new FileReader();
      reader.onload = function(e) {
        document.getElementById('img-preview').src = e.target.result;
        document.getElementById('img-filename').textContent = newName;
        document.getElementById('img-filesize').textContent = (newFile.size / 1024 / 1024).toFixed(2) + ' MB';
        var formatSel = document.getElementById('img-format');
        if (formatSel) formatSel.value = 'image/png';
        setupCropStage(e.target.result);
        resetBtn();
        var usageEl = document.getElementById('img-usage');
        if (usageEl) {
          usageEl.textContent = 'Background removed.';
          usageEl.style.color = '#4ade80';
          setTimeout(function() {
            if (usageEl) { usageEl.textContent = ''; usageEl.style.color = ''; }
          }, 3000);
        }
      };
      reader.readAsDataURL(newFile);
    }).catch(function(err) {
      console.error('BG removal error:', err);
      resetBtn();
      var usageEl = document.getElementById('img-usage');
      if (usageEl) {
        usageEl.textContent = 'Background removal failed. Try a different image.';
        usageEl.style.color = '#f87171';
        setTimeout(function() {
          if (usageEl) { usageEl.textContent = ''; usageEl.style.color = ''; }
        }, 4000);
      }
    });
  }

  if (_dsBgRemovalReady && window._dsBgRemoveFunc) {
    doRemoval();
    return;
  }

  if (_dsBgRemovalLoading) {
    var usageEl = document.getElementById('img-usage');
    if (usageEl) usageEl.textContent = 'Still loading. Please wait...';
    return;
  }

  _dsBgRemovalLoading = true;
  btn.disabled = true;
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" class="ds-s-f33c30" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Loading...';

  // Dynamic import() of the ESM module. Works under strict CSP (no inline
  // <script> needed), as long as 'https://esm.sh' is in script-src. The
  // module is cached on first import, so subsequent calls are instant.
  // 30s timeout matches the design.js behavior for the same library.
  var timedOut = false;
  var timeoutId = setTimeout(function() {
    timedOut = true;
    _dsBgRemovalLoading = false;
    btn.disabled = false;
    var usageEl = document.getElementById('img-usage');
    if (usageEl) {
      usageEl.textContent = 'Failed to load. Try again.';
      usageEl.style.color = '#f87171';
      setTimeout(function() { if (usageEl) { usageEl.textContent = ''; usageEl.style.color = ''; } }, 4000);
    }
  }, 30000);

  import('https://esm.sh/@imgly/background-removal@1.4.5')
    .then(function(mod) {
      if (timedOut) return;
      clearTimeout(timeoutId);
      _dsBgRemoveFunc = mod.removeBackground;
      _dsBgRemovalReady = true;
      _dsBgRemovalLoading = false;
      doRemoval();
    })
    .catch(function(err) {
      if (timedOut) return;
      clearTimeout(timeoutId);
      _dsBgRemovalLoading = false;
      btn.disabled = false;
      var usageEl = document.getElementById('img-usage');
      if (usageEl) {
        usageEl.textContent = 'Failed to load. Try again.';
        usageEl.style.color = '#f87171';
        setTimeout(function() { if (usageEl) { usageEl.textContent = ''; usageEl.style.color = ''; } }, 4000);
      }
      console.error('[image] background-removal import failed:', err);
    });
}

async function convertImage() {
  if (!imgFile) return;
  const btn = document.getElementById('img-convert-btn');
  const format = document.getElementById('img-format').value;
  const quality = parseInt(document.getElementById('img-quality').value) / 100;

  // PNG and WebP preserve transparency — gate to Pro
  if ((format === 'image/png' || format === 'image/webp') && typeof isPro === 'function' && !isPro()) {
    if (typeof showModalAlert === 'function') {
      showModalAlert('PNG and WebP export are Pro features (they preserve transparency). Free users can export as JPG.');
    } else {
      alert('PNG and WebP export are Pro features. Free users can export as JPG.');
    }
    return;
  }

  btn.textContent = 'Processing...'; btn.disabled = true;
  const img = new Image();
  img.onload = () => {
    // Pre-stage: if rotation or flip is applied, render them to an intermediate canvas first.
    // This gives us a "transformed source" that the crop math can work from normally.
    let sourceCanvas;
    if (imgRotation !== 0 || imgFlipH || imgFlipV) {
      sourceCanvas = document.createElement('canvas');
      // Rotated canvas dimensions
      const isSideways = (imgRotation === 90 || imgRotation === 270);
      sourceCanvas.width  = isSideways ? img.height : img.width;
      sourceCanvas.height = isSideways ? img.width  : img.height;
      const srcCtx = sourceCanvas.getContext('2d');
      srcCtx.imageSmoothingEnabled = true;
      srcCtx.imageSmoothingQuality = 'high';
      // Move to center of output canvas, rotate, flip, draw
      srcCtx.translate(sourceCanvas.width / 2, sourceCanvas.height / 2);
      srcCtx.rotate((imgRotation * Math.PI) / 180);
      srcCtx.scale(imgFlipH ? -1 : 1, imgFlipV ? -1 : 1);
      srcCtx.drawImage(img, -img.width / 2, -img.height / 2);
    } else {
      sourceCanvas = img; // Use original image directly
    }
    const sourceW = sourceCanvas.width;
    const sourceH = sourceCanvas.height;

    // Step 1: Figure out crop rect in NATURAL (post-transform) pixel coordinates
    let cropX = 0, cropY = 0, cropW = sourceW, cropH = sourceH;
    if (imgCropBox && imgDisplaySize.w > 0) {
      const region = computeCropRegionInNaturalPixels();
      if (region.w > 0 && region.h > 0) {
        cropX = region.x;
        cropY = region.y;
        cropW = region.w;
        cropH = region.h;
      }
    }

    // Step 2: Figure out final output size (resize)
    let outW = cropW, outH = cropH;
    const wInput = document.getElementById('img-width').value;
    const hInput = document.getElementById('img-height').value;
    const lock = document.getElementById('img-resize-lock').checked;
    if (wInput && hInput) {
      outW = parseInt(wInput); outH = parseInt(hInput);
    } else if (wInput) {
      outW = parseInt(wInput);
      outH = lock ? Math.round(cropH * (outW / cropW)) : cropH;
    } else if (hInput) {
      outH = parseInt(hInput);
      outW = lock ? Math.round(cropW * (outH / cropH)) : cropW;
    }
    outW = Math.max(1, outW); outH = Math.max(1, outH);

    // Step 3: Draw cropped-and-resized image onto final canvas WITH filters applied
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Fill white background for formats that don't support transparency
    if (['image/jpeg', 'image/bmp', 'image/tiff', 'image/x-icon'].includes(format)) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
    }
    // Apply brightness/contrast/saturation filter during drawImage
    if (imgBrightness !== 0 || imgContrast !== 0 || imgSaturation !== 0) {
      ctx.filter = buildImageFilterString();
    }
    ctx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
    ctx.filter = 'none';

    // Step 4: Export
    const extMap = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tiff',
      'image/avif': 'avif', 'image/x-icon': 'ico'
    };
    const ext = extMap[format] || 'jpg';
    let dataUrl;
    try {
      dataUrl = canvas.toDataURL(format, quality);
      if (dataUrl === 'data:,' || (dataUrl.startsWith('data:image/png') && format !== 'image/png')) {
        throw new Error('Format not supported');
      }
    } catch(e) {
      alert(`Unable to convert to ${ext.toUpperCase()} on this device. Try JPEG, PNG, or WebP.`);
      btn.textContent = 'Download Image'; btn.disabled = false;
      return;
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = imgFile.name.replace(/\.[^/.]+$/, '') + '_edited.' + ext;
    a.click();
    document.getElementById('img-usage').textContent = '';
    btn.textContent = 'Download Image'; btn.disabled = false;
  };
  img.src = URL.createObjectURL(imgFile);
}


// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Tab switching
imageRegisterAction('switch-tab', (e, el) => switchImgTab(el.dataset.imageTab));

// Crop aspect presets
imageRegisterAction('aspect-preset', (e, el) => applyAspectPreset(el.dataset.imageAspect));
imageRegisterAction('toggle-crop-lock', () => toggleCropLock());
imageRegisterAction('reset-zoom', () => resetCropZoom());

// Adjustments
imageRegisterAction('flip-h', () => flipImageH());
imageRegisterAction('flip-v', () => flipImageV());
imageRegisterAction('rotate-90', () => rotateImage90());
imageRegisterAction('reset-adjustments', () => resetAllAdjustments());

// Background removal
imageRegisterAction('remove-bg', () => imgRemoveBg());

// Output
imageRegisterAction('convert', () => convertImage());

// Top-level
imageRegisterAction('clear', () => clearImage());

// Quality slider — just updates the display value next to it
imageRegisterAction('quality-display', (e, el) => {
  var out = document.getElementById('quality-val');
  if (out) out.textContent = el.value;
});

