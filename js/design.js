// =============================================================================
// /js/design.js — Design Studio (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Design Studio tool. Extracted from dashboard.html
// for stricter CSP.
//
// HISTORY NOTE: This file previously also contained Contract Analyzer and
// Thumbnail Analyzer code (they shared the original <script> block in
// dashboard.html). On 2026-05-10 they were extracted into their own files:
//   • js/contract.js  — Contract Analyzer (data-contract-action namespace)
//   • js/thumbnail.js — Thumbnail Analyzer (data-thumb-action namespace)
// design.js now contains only Design Studio code.
//
// Canvas library: Fabric.js 5.3.1 (loaded from cdnjs.cloudflare.com in
// dashboard.html, BEFORE this file). The `fabric` global is required.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/design.js
//   • Phase 2: inline onclick/oninput/onchange/onkeydown/onfocus →
//     data-ds-action attributes + delegated handlers
//   • Phase 3: static inline class="bio-s-6eae3a" → hash-named CSS classes
//
// INTENTIONALLY KEPT INLINE (preserving working behavior):
//   • onmouseover / onmouseout — hover styling (would need CSS :hover)
//   • onmousedown / ontouchstart — drag-to-place pairs in markup AND in
//     dynamically-rendered icon results. dsDragStart() does e.preventDefault()
//     and has 150ms hold-to-drag timing. Going through the dispatcher could
//     break this. Leave as-is.
//   • ondragstart / ondragover / ondragleave / ondrop — Layers panel
//     drag-to-reorder. Same reasoning as Brand Deals kanban.
//   • Dynamic styles in template literals (anything with ${...} or string
//     concatenation) — same reasoning as every other tool's cover renders.
//
// External dependencies remain on window (sb, Auth, currentUser, isMax, isPro,
// escapeHtml, getAIHeaders, showModalAlert, showModalConfirm, formatMoney,
// plus the `fabric` global from Fabric.js).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE (parallel of other tools)
// =============================================================================

const dsActions = {};

function dsRegisterAction(action, handler) {
  dsActions[action] = handler;
}

function dsFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['dsAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.dsAction) {
        const wantEvent = el.dataset.dsEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.dsAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function dsDispatchEvent(event) {
  const found = dsFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = dsActions[found.action];
  if (!handler) {
    console.warn('[ds] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur', 'keydown'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, dsDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 17777-20789 (Design Studio) ----------
// =====================================================
// DESIGN STUDIO
// =====================================================
var dsCanvas = null;
var dsProjectW = 1080, dsProjectH = 1350;
var dsCurrentProjectId = null;
var dsProjectName = 'Untitled';
var dsSaveLimit = { free: 10, pro: 50, max: 100 };
var dsPendingJSON = null;
// Save deduplication. Flipped to true by canvas mutations, false after a
// successful save (or on fresh load of an existing project). saveDesignProject
// short-circuits when this is false and a project_id already exists, so users
// who click Save repeatedly without making changes don't re-upload the same
// project JSON to Supabase. Egress savings are real at scale.
var _dsDirty = false;

var DS_FONTS = [
  'DM Sans','Inter','Poppins','Montserrat','Bebas Neue','Oswald','Caveat','Dancing Script',
  'Playfair Display','Lora','Roboto','Open Sans','Raleway','Nunito','Quicksand',
  'Pacifico','Lobster','Permanent Marker','Righteous','Abril Fatface','Comfortaa'
];

function initDesignFontSelect() {
  var sel = document.getElementById('ds-font-select');
  if (!sel || sel.options.length > 1) return;
  sel.innerHTML = '';
  DS_FONTS.forEach(function(f) {
    var opt = document.createElement('option');
    opt.value = f; opt.textContent = f; opt.style.fontFamily = f;
    sel.appendChild(opt);
  });
}

function startDesignProject(w, h, name) {
  dsProjectW = w;
  dsProjectH = h;
  dsProjectName = name;
  dsCurrentProjectId = null;
  dsUndoStack = [];
  dsRedoStack = [];
  dsPendingJSON = null;
  // Fresh canvas — nothing on it yet, so nothing to save.
  _dsDirty = false;
  document.getElementById('ds-project-name').textContent = name;
  document.getElementById('design-start').style.display = 'none';
  document.getElementById('design-editor').style.display = 'block';
  initDesignCanvas();
}

function openCustomSizeModal() {
  var overlay = document.createElement('div');
  overlay.id = 'ds-custom-size-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = '<div class="ds-s-4e2bac">'
    + '<div class="ds-s-b0ef76">Custom Size</div>'
    + '<div class="ds-s-59bbd8">'
    + '<div class="bio-s-7623f0"><label class="ds-s-dfd210">Width (px)</label><input type="number" id="ds-custom-w" value="1080" min="100" max="4000" class="ds-s-fb75b4" data-ds-action-focus="select-all"></div>'
    + '<div class="bio-s-7623f0"><label class="ds-s-dfd210">Height (px)</label><input type="number" id="ds-custom-h" value="1080" min="100" max="4000" class="ds-s-fb75b4" data-ds-action-focus="select-all"></div>'
    + '</div>'
    + '<div class="course-s-b9bbe5">'
    + '<button data-ds-action="confirm-custom-size" class="ds-s-a51526">Create</button>'
    + '<button data-ds-action="close-custom-size" class="ds-s-dea7b5">Cancel</button>'
    + '</div>'
    + '</div>';
  overlay.onclick = function(e) { if (e.target === overlay) closeCustomSizeModal(); };
  document.body.appendChild(overlay);
  setTimeout(function() { document.getElementById('ds-custom-w').focus(); }, 100);
}

function closeCustomSizeModal() {
  var el = document.getElementById('ds-custom-size-modal');
  if (el) el.remove();
}

function confirmCustomSize() {
  var w = Math.min(Math.max(parseInt(document.getElementById('ds-custom-w').value) || 1080, 100), 4000);
  var h = Math.min(Math.max(parseInt(document.getElementById('ds-custom-h').value) || 1080, 100), 4000);
  closeCustomSizeModal();
  startDesignProject(w, h, w + ' × ' + h);
}

function initDesignCanvas(onReady) {
  initDesignFontSelect();
  // Delay so layout has rendered and flex container has width
  setTimeout(function() {
    dsResizeCanvas();
    if (!dsCanvas) { if (onReady) onReady(); return; }

    dsCanvas.on('selection:created', function() { dsOnSelect(); dsRefreshLayersIfOpen(); });
    dsCanvas.on('selection:updated', function() { dsOnSelect(); dsRefreshLayersIfOpen(); });
    dsCanvas.on('selection:cleared', function() { dsOnDeselect(); dsRefreshLayersIfOpen(); });
    dsCanvas.on('object:modified', function() { _dsDirty = true; dsCanvas.renderAll(); dsSaveState(); });

  // Save state on add/remove. Mark project dirty so the next save click
  // actually persists; if nothing changed since the last save, the save
  // button short-circuits to avoid wasted egress (Supabase egress was the
  // main motivator).
  dsCanvas.on('object:added', function(e) { if (!e.target._isGuideLine) { _dsDirty = true; dsSaveState(); dsRefreshLayersIfOpen(); } });
  dsCanvas.on('object:removed', function(e) { if (!e.target._isGuideLine) { _dsDirty = true; dsSaveState(); dsRefreshLayersIfOpen(); } });

  // Snap guidelines
  dsInitGuidelines();

  // Prevent text scaling — convert scale to font size and width changes
  dsCanvas.on('object:scaling', function(e) {
    var obj = e.target;
    if (obj && (obj.type === 'textbox' || obj.type === 'i-text')) {
      var newWidth = obj.width * obj.scaleX;
      var newFontSize = Math.round(obj.fontSize * obj.scaleY);
      obj.set({
        width: newWidth,
        fontSize: newFontSize,
        scaleX: 1,
        scaleY: 1
      });
      obj.setCoords();
      // Update font size input
      var fsInput = document.getElementById('ds-font-size');
      if (fsInput) fsInput.value = newFontSize;
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', dsKeyHandler);

  // Bigger control handles
  fabric.Object.prototype.set({
    cornerSize: 14,
    cornerStyle: 'circle',
    cornerColor: '#ffffff',
    cornerStrokeColor: 'rgba(0,0,0,0.3)',
    transparentCorners: false,
    borderColor: '#7c3aed',
    borderScaleFactor: 1.5,
    padding: 6
  });

  // Custom rotation control — Canva-style below the object
  var rotateIcon = new Image();
  rotateIcon.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>');

  // Move rotation to bottom center
  fabric.Object.prototype.controls.mtr = new fabric.Control({
    x: 0,
    y: 0.5,
    offsetY: 30,
    cursorStyleHandler: fabric.controlsUtils.rotationStyleHandler,
    actionHandler: fabric.controlsUtils.rotationWithSnapping,
    actionName: 'rotate',
    render: function(ctx, left, top, styleOverride, fabricObject) {
      var size = 20;
      ctx.save();
      ctx.translate(left, top);
      // White pill background
      ctx.beginPath();
      ctx.arc(0, 0, size / 2 + 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Draw icon
      if (rotateIcon.complete) {
        ctx.drawImage(rotateIcon, -size / 2, -size / 2, size, size);
      }
      ctx.restore();
    },
    cornerSize: 28
  });

  // Draw a line connecting bottom center of object to the rotate control
  // Hover highlight — dashed purple border around hovered object
  var dsHoveredObj = null;

  dsCanvas.on('mouse:over', function(e) {
    if (!e.target || e.target._isGuideLine) return;
    if (dsCanvas.getActiveObject() === e.target) return;
    dsHoveredObj = e.target;
    dsCanvas.renderAll();
  });

  dsCanvas.on('mouse:out', function(e) {
    if (dsHoveredObj) {
      dsHoveredObj = null;
      dsCanvas.renderAll();
    }
  });

  dsCanvas.on('after:render', function() {
    var ctx = dsCanvas.contextContainer;

    // Draw connector line from object to rotate control
    var active = dsCanvas.getActiveObject();
    if (active) {
      var bound = active.getBoundingRect();
      var bottomCenterX = bound.left + bound.width / 2;
      var bottomCenterY = bound.top + bound.height;
      ctx.save();
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(bottomCenterX, bottomCenterY);
      ctx.lineTo(bottomCenterX, bottomCenterY + 24);
      ctx.stroke();
      ctx.restore();
    }

    // Draw hover highlight
    if (dsHoveredObj && dsCanvas.getObjects().indexOf(dsHoveredObj) !== -1 && dsCanvas.getActiveObject() !== dsHoveredObj) {
      var hBound = dsHoveredObj.getBoundingRect();
      ctx.save();
      ctx.strokeStyle = 'rgba(124,58,237,0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(hBound.left - 1, hBound.top - 1, hBound.width + 2, hBound.height + 2);
      ctx.restore();
    }
  });

  // Load pending project JSON if opening a saved project
  if (dsPendingJSON) {
    var json = dsPendingJSON;
    dsPendingJSON = null;
    dsCanvas.loadFromJSON(json, function() {
      // Rescale objects from 1:1 project coordinates to current display scale
      var loadScale = dsCanvas._projectScale || 1;
      if (loadScale !== 1) {
        dsCanvas.getObjects().forEach(function(obj) {
          if (obj._isGuideLine) return;
          if (obj.type === 'textbox' || obj.type === 'i-text') {
            obj.set({ fontSize: Math.round(obj.fontSize * loadScale), width: obj.width * loadScale, left: obj.left * loadScale, top: obj.top * loadScale });
          } else {
            obj.set({ left: obj.left * loadScale, top: obj.top * loadScale, scaleX: obj.scaleX * loadScale, scaleY: obj.scaleY * loadScale });
          }
          obj.setCoords();
        });
      }
      dsCanvas.renderAll();
      // loadFromJSON fires object:added for each deserialized object, which
      // sets _dsDirty=true via our listener. Reset here so a freshly-loaded
      // project is correctly treated as unchanged until the user edits it.
      _dsDirty = false;
      // Fire the ready callback AFTER everything is on-screen. This is what
      // hides the loading overlay so the user only ever sees the finished canvas.
      if (onReady) onReady();
    });
  } else {
    // No pending JSON (new project) — canvas is already ready.
    if (onReady) onReady();
  }
  }, 50); // end setTimeout
}

var dsGuideLines = [];
var dsSnapThreshold = 6;
var dsTransparentBg = false;

function dsSetBgColor(color) {
  if (!dsCanvas) return;
  dsTransparentBg = false;
  document.getElementById('ds-transparent-btn').classList.remove('active');
  dsCanvas.backgroundColor = color;
  document.getElementById('ds-canvas-wrap').style.backgroundImage = 'none';
  dsCanvas.renderAll();
}

function dsToggleTransparent() {
  if (!dsCanvas) return;

  if (typeof isPro === 'function' && !isPro()) {
    showDsMsg('error', 'Transparent background is a Pro feature. Upgrade to use it.');
    return;
  }

  dsTransparentBg = !dsTransparentBg;
  var btn = document.getElementById('ds-transparent-btn');
  btn.classList.toggle('active', dsTransparentBg);

  if (dsTransparentBg) {
    dsCanvas.backgroundColor = null;
    // Show checkerboard pattern on canvas wrap
    document.getElementById('ds-canvas-wrap').style.backgroundImage = 'repeating-conic-gradient(#808080 0% 25%, #b0b0b0 0% 50%)';
    document.getElementById('ds-canvas-wrap').style.backgroundSize = '16px 16px';
  } else {
    var color = document.getElementById('ds-bg-color').value || '#ffffff';
    dsCanvas.backgroundColor = color;
    document.getElementById('ds-canvas-wrap').style.backgroundImage = 'none';
  }
  dsCanvas.renderAll();
}

function dsInitGuidelines() {
  dsCanvas.on('object:moving', function(e) {
    dsClearGuidelines();
    var obj = e.target;
    if (!obj) return;

    var objBound = obj.getBoundingRect(true);
    var objLeft = objBound.left;
    var objTop = objBound.top;
    var objRight = objBound.left + objBound.width;
    var objBottom = objBound.top + objBound.height;
    var objCenterX = objLeft + objBound.width / 2;
    var objCenterY = objTop + objBound.height / 2;

    var canvasCenterX = dsCanvas.width / 2;
    var canvasCenterY = dsCanvas.height / 2;
    var lines = [];
    var snappedX = false;
    var snappedY = false;

    // Canvas center vertical
    if (Math.abs(objCenterX - canvasCenterX) < dsSnapThreshold) {
      obj.set('left', canvasCenterX - (objCenterX - obj.left));
      lines.push(dsMakeLine(canvasCenterX, 0, canvasCenterX, dsCanvas.height));
      snappedX = true;
    }
    // Canvas center horizontal
    if (Math.abs(objCenterY - canvasCenterY) < dsSnapThreshold) {
      obj.set('top', canvasCenterY - (objCenterY - obj.top));
      lines.push(dsMakeLine(0, canvasCenterY, dsCanvas.width, canvasCenterY));
      snappedY = true;
    }

    // Snap to other objects
    dsCanvas.getObjects().forEach(function(other) {
      if (other === obj || other._isGuideLine) return;
      var ob = other.getBoundingRect(true);
      var otherCenterX = ob.left + ob.width / 2;
      var otherCenterY = ob.top + ob.height / 2;
      var otherLeft = ob.left;
      var otherRight = ob.left + ob.width;
      var otherTop = ob.top;
      var otherBottom = ob.top + ob.height;

      // Center to center vertical
      if (!snappedX && Math.abs(objCenterX - otherCenterX) < dsSnapThreshold) {
        obj.set('left', otherCenterX - (objCenterX - obj.left));
        lines.push(dsMakeLine(otherCenterX, Math.min(objTop, otherTop), otherCenterX, Math.max(objBottom, otherBottom)));
        snappedX = true;
      }
      // Center to center horizontal
      if (!snappedY && Math.abs(objCenterY - otherCenterY) < dsSnapThreshold) {
        obj.set('top', otherCenterY - (objCenterY - obj.top));
        lines.push(dsMakeLine(Math.min(objLeft, otherLeft), otherCenterY, Math.max(objRight, otherRight), otherCenterY));
        snappedY = true;
      }
      // Left edge to left edge
      if (!snappedX && Math.abs(objLeft - otherLeft) < dsSnapThreshold) {
        obj.set('left', otherLeft - (objLeft - obj.left));
        lines.push(dsMakeLine(otherLeft, Math.min(objTop, otherTop), otherLeft, Math.max(objBottom, otherBottom)));
        snappedX = true;
      }
      // Right edge to right edge
      if (!snappedX && Math.abs(objRight - otherRight) < dsSnapThreshold) {
        obj.set('left', otherRight - objBound.width - (objLeft - obj.left));
        lines.push(dsMakeLine(otherRight, Math.min(objTop, otherTop), otherRight, Math.max(objBottom, otherBottom)));
        snappedX = true;
      }
      // Top edge to top edge
      if (!snappedY && Math.abs(objTop - otherTop) < dsSnapThreshold) {
        obj.set('top', otherTop - (objTop - obj.top));
        lines.push(dsMakeLine(Math.min(objLeft, otherLeft), otherTop, Math.max(objRight, otherRight), otherTop));
        snappedY = true;
      }
      // Bottom edge to bottom edge
      if (!snappedY && Math.abs(objBottom - otherBottom) < dsSnapThreshold) {
        obj.set('top', otherBottom - objBound.height - (objTop - obj.top));
        lines.push(dsMakeLine(Math.min(objLeft, otherLeft), otherBottom, Math.max(objRight, otherRight), otherBottom));
        snappedY = true;
      }
      // Left to right
      if (!snappedX && Math.abs(objLeft - otherRight) < dsSnapThreshold) {
        obj.set('left', otherRight - (objLeft - obj.left));
        lines.push(dsMakeLine(otherRight, Math.min(objTop, otherTop), otherRight, Math.max(objBottom, otherBottom)));
        snappedX = true;
      }
      // Right to left
      if (!snappedX && Math.abs(objRight - otherLeft) < dsSnapThreshold) {
        obj.set('left', otherLeft - objBound.width - (objLeft - obj.left));
        lines.push(dsMakeLine(otherLeft, Math.min(objTop, otherTop), otherLeft, Math.max(objBottom, otherBottom)));
        snappedX = true;
      }
      // Top to bottom
      if (!snappedY && Math.abs(objTop - otherBottom) < dsSnapThreshold) {
        obj.set('top', otherBottom - (objTop - obj.top));
        lines.push(dsMakeLine(Math.min(objLeft, otherLeft), otherBottom, Math.max(objRight, otherRight), otherBottom));
        snappedY = true;
      }
      // Bottom to top
      if (!snappedY && Math.abs(objBottom - otherTop) < dsSnapThreshold) {
        obj.set('top', otherTop - objBound.height - (objTop - obj.top));
        lines.push(dsMakeLine(Math.min(objLeft, otherLeft), otherTop, Math.max(objRight, otherRight), otherTop));
        snappedY = true;
      }
    });

    lines.forEach(function(l) { dsCanvas.add(l); });
    dsGuideLines = lines;
    obj.setCoords();
  });

  dsCanvas.on('object:modified', function() { dsClearGuidelines(); });
  dsCanvas.on('mouse:up', function() { dsClearGuidelines(); });
}

function dsMakeLine(x1, y1, x2, y2) {
  var line = new fabric.Line([x1, y1, x2, y2], {
    stroke: '#ff3b5c',
    strokeWidth: 1,
    strokeDashArray: [4, 3],
    selectable: false,
    evented: false,
    excludeFromExport: true
  });
  line._isGuideLine = true;
  return line;
}

function dsClearGuidelines() {
  dsGuideLines.forEach(function(l) { dsCanvas.remove(l); });
  dsGuideLines = [];
}

var _dsResizeTimer = null;

function dsResizeCanvas() {
  var wrap = document.getElementById('ds-canvas-wrap');
  var outer = document.getElementById('ds-canvas-outer');
  if (!wrap || !outer) return;
  var flexParent = document.getElementById('ds-canvas-flex');
  var maxW = (flexParent ? flexParent.offsetWidth : 800) - 2;
  var maxH = window.innerHeight - 260;
  if (maxH < 300) maxH = 300;

  // For landscape/wide canvases, fit to width
  // For tall/square canvases, use more width — allow vertical scroll
  var scale;
  var aspectRatio = dsProjectW / dsProjectH;
  if (aspectRatio >= 1) {
    // Landscape or square — fit both dimensions
    scale = Math.min(maxW / dsProjectW, maxH / dsProjectH, 1);
  } else {
    // Portrait/tall — prioritize width, allow taller canvas
    var tallMaxH = window.innerHeight - 180;
    if (tallMaxH < 400) tallMaxH = 400;
    scale = Math.min(maxW / dsProjectW, tallMaxH / dsProjectH, 1);
    // But don't let it get wider than 85% of available width for portraits
    var widthScale = (maxW * 0.85) / dsProjectW;
    scale = Math.min(scale, widthScale);
  }

  var dispW = Math.round(dsProjectW * scale);
  var dispH = Math.round(dsProjectH * scale);

  // Enforce minimum 50% zoom so tall canvases don't look tiny
  if (scale < 0.5) scale = 0.5;
  dispW = Math.round(dsProjectW * scale);
  dispH = Math.round(dsProjectH * scale);
  wrap.style.width = dispW + 'px';
  wrap.style.height = dispH + 'px';
  wrap.style.transform = 'none';
  outer.style.width = dispW + 'px';
  outer.style.height = dispH + 'px';

  if (!dsCanvas) {
    dsCanvas = new fabric.Canvas('ds-canvas', {
      width: dispW, height: dispH,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true
    });
    dsCanvas._projectScale = scale;
    dsCurrentZoom = scale;
    var label = document.getElementById('ds-zoom-label');
    if (label) label.textContent = Math.round(scale * 100) + '%';
  }
}

// ===== ZOOM =====
var dsCurrentZoom = 1;

function dsZoomIn() {
  dsSetZoom(dsCurrentZoom + 0.15);
}

function dsZoomOut() {
  dsSetZoom(dsCurrentZoom - 0.15);
}

function dsZoomFit() {
  var flexParent = document.getElementById('ds-canvas-flex');
  if (!flexParent || !dsCanvas) return;
  var maxW = flexParent.offsetWidth - 20;
  var maxH = flexParent.offsetHeight || (window.innerHeight - 260);
  if (maxH < 300) maxH = 300;
  var fitScale = Math.min(maxW / dsProjectW, maxH / dsProjectH, 1);
  dsSetZoom(fitScale);
}

function dsSetZoom(newZoom) {
  if (!dsCanvas) return;
  newZoom = Math.max(0.1, Math.min(3, newZoom));
  dsCurrentZoom = newZoom;

  var dispW = Math.round(dsProjectW * newZoom);
  var dispH = Math.round(dsProjectH * newZoom);

  // Save canvas state
  var json = dsCanvas.toJSON(['_dsShape', '_dsShapeType', '_dsIconName', '_dsIconColor']);
  var oldW = dsCanvas.width;
  var oldH = dsCanvas.height;
  var ratio = newZoom / (dsCanvas._projectScale || 1);

  dsCanvas.setWidth(dispW);
  dsCanvas.setHeight(dispH);
  dsCanvas._projectScale = newZoom;

  // Rescale all objects
  dsCanvas.getObjects().forEach(function(obj) {
    if (obj._isGuideLine) return;
    obj.set({
      left: obj.left * ratio,
      top: obj.top * ratio,
      scaleX: obj.scaleX * ratio,
      scaleY: obj.scaleY * ratio
    });
    if (obj.type === 'textbox' || obj.type === 'i-text') {
      obj.set({ fontSize: Math.round(obj.fontSize * ratio), width: obj.width * ratio, scaleX: 1, scaleY: 1 });
    }
    obj.setCoords();
  });

  var wrap = document.getElementById('ds-canvas-wrap');
  var outer = document.getElementById('ds-canvas-outer');
  if (wrap) { wrap.style.width = dispW + 'px'; wrap.style.height = dispH + 'px'; }
  if (outer) { outer.style.width = dispW + 'px'; outer.style.height = dispH + 'px'; }

  dsCanvas.renderAll();

  var label = document.getElementById('ds-zoom-label');
  if (label) label.textContent = Math.round(newZoom * 100) + '%';
}

var dsClipboard = null;

function dsKeyHandler(e) {
  if (!dsCanvas || document.getElementById('design-editor').style.display === 'none') return;
  // Allow typing in text objects
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  // Don't intercept copy/paste when editing text on canvas
  var activeObj = dsCanvas.getActiveObject();
  if (activeObj && activeObj.isEditing) return;

  if (e.key === 'Delete' || e.key === 'Backspace') { dsDeleteSelected(); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'd') { dsDuplicate(); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { dsUndo(); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'z' && e.shiftKey) { dsRedo(); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'y') { dsRedo(); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'c') { dsCopy(); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'v') { dsPaste(); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'x') { dsCut(); e.preventDefault(); }
  if (e.ctrlKey && (e.key === '=' || e.key === '+')) { dsZoomIn(); e.preventDefault(); }
  if (e.ctrlKey && e.key === '-') { dsZoomOut(); e.preventDefault(); }
  if (e.ctrlKey && e.key === '0') { dsZoomFit(); e.preventDefault(); }
}

function dsCopy() {
  if (!dsCanvas) return;
  var obj = dsCanvas.getActiveObject();
  if (!obj) return;
  obj.clone(function(cloned) {
    dsClipboard = cloned;
  });
}

function dsPaste() {
  if (!dsCanvas || !dsClipboard) return;
  dsClipboard.clone(function(cloned) {
    cloned.set({ left: cloned.left + 20, top: cloned.top + 20 });
    if (cloned.type === 'image' && dsCountImages() >= DS_MAX_IMAGES) {
      showDsMsg('error', 'Maximum ' + DS_MAX_IMAGES + ' images per project.');
      return;
    }
    dsCanvas.add(cloned);
    dsCanvas.setActiveObject(cloned);
    dsCanvas.renderAll();
  });
}

function dsCut() {
  if (!dsCanvas) return;
  var obj = dsCanvas.getActiveObject();
  if (!obj) return;
  obj.clone(function(cloned) {
    dsClipboard = cloned;
    dsCanvas.remove(obj);
    dsCanvas.discardActiveObject();
    dsCanvas.renderAll();
  });
}

function dsOnSelect() {
  var obj = dsCanvas.getActiveObject();
  var tc = document.getElementById('ds-text-controls');
  var ic = document.getElementById('ds-image-controls');
  var shc = document.getElementById('ds-shape-controls');
  var sc = document.getElementById('ds-shared-controls');
  var hint = document.getElementById('ds-context-default');

  if (obj && !obj._isGuideLine) {
    if (hint) hint.style.display = 'none';
    sc.style.display = 'flex';
    document.getElementById('ds-opacity').value = Math.round((obj.opacity || 1) * 100);
    document.getElementById('ds-opacity-val').textContent = Math.round((obj.opacity || 1) * 100) + '%';
    document.getElementById('ds-lock-btn').classList.toggle('active', !!obj.lockMovementX);
  } else {
    if (hint) hint.style.display = 'block';
    sc.style.display = 'none';
  }

  var isShape = obj && obj._dsShape;

  if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
    tc.style.display = 'flex';
    ic.style.display = 'none';
    shc.style.display = 'none';
    document.getElementById('ds-font-select').value = obj.fontFamily || 'DM Sans';
    document.getElementById('ds-font-size').value = Math.round(obj.fontSize || 24);
    document.getElementById('ds-text-color').value = obj.fill || '#ffffff';
    document.getElementById('ds-bold-btn').classList.toggle('active', obj.fontWeight === 'bold');
    document.getElementById('ds-italic-btn').classList.toggle('active', obj.fontStyle === 'italic');
    document.getElementById('ds-underline-btn').classList.toggle('active', !!obj.underline);
    document.getElementById('ds-stroke-color').value = obj.stroke || '#000000';
    document.getElementById('ds-stroke-width').value = obj.strokeWidth || 0;
    document.getElementById('ds-effects-btn').classList.toggle('active', !!(obj.shadow || obj.strokeWidth));
  } else if (isShape) {
    tc.style.display = 'none';
    ic.style.display = 'none';
    shc.style.display = 'flex';
    var isLineType = obj._dsShapeType === 'line';
    var isIconType = obj._dsShapeType === 'icon';
    document.getElementById('ds-shape-fill-group').style.display = isLineType ? 'none' : 'flex';
    document.getElementById('ds-shape-radius-group').style.display = obj._dsShapeType === 'rect' ? 'flex' : 'none';
    // Icons are raster images — stroke and "no fill" don't have a meaningful
    // effect on them, so hide those controls. Fill still works (it re-fetches
    // a recolored icon from Iconify).
    document.getElementById('ds-shape-stroke-group').style.display = isIconType ? 'none' : 'flex';
    document.getElementById('ds-shape-nofill-wrap').style.display = isIconType ? 'none' : 'flex';
    if (!isLineType) {
      var fillVal = isIconType
        ? (obj._dsIconColor || '#000000')
        : ((obj.fill && obj.fill !== 'transparent') ? obj.fill : '#7c3aed');
      document.getElementById('ds-shape-fill').value = fillVal;
      document.getElementById('ds-shape-nofill-btn').classList.toggle('active', !isIconType && (obj.fill === 'transparent' || obj.fill === ''));
    }
    document.getElementById('ds-shape-stroke-color').value = obj.stroke || '#ffffff';
    document.getElementById('ds-shape-stroke-width').value = obj.strokeWidth || 0;
    if (obj._dsShapeType === 'rect') document.getElementById('ds-shape-radius').value = obj.rx || 0;
  } else if (obj && obj.type === 'image') {
    tc.style.display = 'none';
    ic.style.display = 'flex';
    shc.style.display = 'none';
  } else {
    tc.style.display = 'none';
    ic.style.display = 'none';
    shc.style.display = 'none';
  }
}

function dsOnDeselect() {
  document.getElementById('ds-text-controls').style.display = 'none';
  document.getElementById('ds-image-controls').style.display = 'none';
  document.getElementById('ds-shape-controls').style.display = 'none';
  document.getElementById('ds-shared-controls').style.display = 'none';
  var hint = document.getElementById('ds-context-default');
  if (hint) hint.style.display = 'block';
  dsCloseShapeMenu();
}

// =====================================================
// DRAG-TO-PLACE (click = default pos, click+hold+drag = place at cursor)
// =====================================================
var dsDragState = { type: null, dragging: false, ghost: null, timer: null, startX: 0, startY: 0 };

function dsDragStart(e, type) {
  e.preventDefault();
  var touch = e.touches ? e.touches[0] : e;
  dsDragState.type = type;
  dsDragState.dragging = false;
  dsDragState.startX = touch.clientX;
  dsDragState.startY = touch.clientY;

  // After 150ms of holding, enter drag mode
  dsDragState.timer = setTimeout(function() {
    dsDragState.dragging = true;
    // Create ghost element
    var ghost = document.createElement('div');
    ghost.id = 'ds-drag-ghost';
    ghost.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;opacity:0.7;font-size:12px;font-weight:600;color:#c4b5fd;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.4);border-radius:8px;padding:6px 12px;white-space:nowrap;';
    var labels = { text:'Text', rect:'Rectangle', circle:'Circle', triangle:'Triangle', line:'Line', arrow:'Arrow', star:'Star' };
    ghost.textContent = type.startsWith('icon:') ? 'Icon' : (labels[type] || type);
    ghost.style.left = touch.clientX + 'px';
    ghost.style.top = touch.clientY + 'px';
    ghost.style.transform = 'translate(-50%,-50%)';
    document.body.appendChild(ghost);
    dsDragState.ghost = ghost;
    document.body.style.cursor = 'grabbing';
  }, 150);

  document.addEventListener('mousemove', dsDragMove);
  document.addEventListener('touchmove', dsDragMove, { passive: false });
  document.addEventListener('mouseup', dsDragEnd);
  document.addEventListener('touchend', dsDragEnd);
}

function dsDragMove(e) {
  if (!dsDragState.dragging) return;
  e.preventDefault();
  var touch = e.touches ? e.touches[0] : e;
  if (dsDragState.ghost) {
    dsDragState.ghost.style.left = touch.clientX + 'px';
    dsDragState.ghost.style.top = touch.clientY + 'px';
  }
}

function dsDragEnd(e) {
  document.removeEventListener('mousemove', dsDragMove);
  document.removeEventListener('touchmove', dsDragMove);
  document.removeEventListener('mouseup', dsDragEnd);
  document.removeEventListener('touchend', dsDragEnd);
  clearTimeout(dsDragState.timer);

  var wasDragging = dsDragState.dragging;
  var type = dsDragState.type;

  // Clean up ghost
  if (dsDragState.ghost) {
    dsDragState.ghost.remove();
    dsDragState.ghost = null;
  }
  document.body.style.cursor = '';

  if (!type) return;

  if (wasDragging) {
    // Dropped — find position on canvas
    var touch = e.changedTouches ? e.changedTouches[0] : e;
    var canvasEl = document.querySelector('#ds-canvas-wrap canvas');
    if (!canvasEl) canvasEl = document.getElementById('ds-canvas');
    if (!canvasEl) return;
    var rect = canvasEl.getBoundingClientRect();
    // Canvas coordinates = mouse position relative to canvas element, 
    // scaled by the ratio of internal canvas size to display size
    var scaleX = dsCanvas.getWidth() / rect.width;
    var scaleY = dsCanvas.getHeight() / rect.height;
    var x = (touch.clientX - rect.left) * scaleX;
    var y = (touch.clientY - rect.top) * scaleY;

    // Clamp to canvas bounds
    x = Math.max(10, Math.min(x, dsCanvas.getWidth() - 10));
    y = Math.max(10, Math.min(y, dsCanvas.getHeight() - 10));

    if (type === 'text') {
      dsAddTextAt(x - 100, y - 12);
    } else if (type.startsWith('icon:')) {
      dsAddIconAt(type.substring(5), x, y);
    } else {
      dsAddShapeAt(type, x, y, true);
    }
    dsCloseShapeMenu();
  } else {
    // Quick click — add at default position
    if (type === 'text') {
      dsAddText();
    } else if (type.startsWith('icon:')) {
      dsAddIcon(type.substring(5));
    } else {
      dsAddShape(type);
    }
  }

  dsDragState.type = null;
  dsDragState.dragging = false;
}

function dsAddTextAt(x, y) {
  if (!dsCanvas) return;
  var text = new fabric.Textbox('Your text', {
    left: x, top: y,
    width: 200,
    fontFamily: document.getElementById('ds-font-select')?.value || 'DM Sans',
    fontSize: 24,
    fill: '#000000',
    editable: true,
    lockScalingFlip: true
  });
  dsCanvas.add(text);
  dsCanvas.setActiveObject(text);
  dsCanvas.renderAll();
}

function dsAddShapeAt(type, x, y, center) {
  if (!dsCanvas) return;
  dsCloseShapeMenu();
  var fill = '#7c3aed';
  var stroke = '#ffffff';
  var sw = 0;
  var obj;

  switch (type) {
    case 'rect':
      obj = new fabric.Rect({ left:x, top:y, width:150, height:100, fill:fill, stroke:stroke, strokeWidth:sw, rx:0, ry:0 });
      break;
    case 'circle':
      obj = new fabric.Circle({ left:x, top:y, radius:60, fill:fill, stroke:stroke, strokeWidth:sw });
      break;
    case 'triangle':
      obj = new fabric.Triangle({ left:x, top:y, width:120, height:120, fill:fill, stroke:stroke, strokeWidth:sw });
      break;
    case 'line':
      obj = new fabric.Line([50,50,250,50], { left:x, top:y, stroke:'#000000', strokeWidth:3, fill:'' });
      break;
    case 'arrow':
      obj = new fabric.Path('M 0 10 L 80 10 L 80 0 L 100 15 L 80 30 L 80 20 L 0 20 Z', {
        left: x, top: y, fill: '#000000', stroke: '', strokeWidth: 0
      });
      obj._dsShapeType = 'arrow';
      break;
    case 'star':
      var points = dsStarPoints(5, 50, 22);
      obj = new fabric.Polygon(points, { left:x, top:y, fill:fill, stroke:stroke, strokeWidth:sw });
      break;
    default:
      return;
  }

  obj._dsShape = true;
  if (!obj._dsShapeType) obj._dsShapeType = type;
  obj.set({ lockScalingFlip: true });
  if (center) {
    obj.set({ originX: 'center', originY: 'center' });
  }
  dsCanvas.add(obj);
  dsCanvas.setActiveObject(obj);
  dsCanvas.renderAll();
  dsSaveState();
}

// =====================================================
// COLOR SWATCHES
// =====================================================
var DS_SWATCHES = [
  '#000000','#ffffff','#f87171','#ef4444','#dc2626','#b91c1c',
  '#fb923c','#f97316','#fbbf24','#eab308','#a3e635','#4ade80',
  '#22c55e','#16a34a','#2dd4bf','#06b6d4','#38bdf8','#3b82f6',
  '#6366f1','#7c3aed','#a855f7','#c084fc','#e879f9','#ec4899',
  '#334155','#475569','#64748b','#94a3b8','#cbd5e1','#f1f5f9',
  'transparent'
];

function dsInitSwatches(gridId, onPick) {
  var grid = document.getElementById(gridId);
  if (!grid || grid.children.length > 0) return;
  DS_SWATCHES.forEach(function(color) {
    var btn = document.createElement('button');
    btn.className = 'ds-swatch';
    btn.setAttribute('aria-label', color === 'transparent' ? 'Transparent' : color);
    if (color === 'transparent') {
      btn.style.background = 'repeating-conic-gradient(#808080 0% 25%, #b0b0b0 0% 50%)';
      btn.style.backgroundSize = '8px 8px';
    } else {
      btn.style.background = color;
    }
    btn.onclick = function() { onPick(color); };
    grid.appendChild(btn);
  });
}

function dsToggleSwatches(panelId) {
  var panel = document.getElementById(panelId);
  if (!panel) return;
  // Close other swatch panels
  document.querySelectorAll('.ds-swatches-panel').forEach(function(p) {
    if (p.id !== panelId) p.style.display = 'none';
  });
  if (panel.style.display === 'block') {
    panel.style.display = 'none';
  } else {
    panel.style.display = 'block';
    // Init swatches on first open
    if (panelId === 'ds-text-swatches') {
      dsInitSwatches('ds-text-swatch-grid', function(color) {
        document.getElementById('ds-text-color').value = color === 'transparent' ? '#000000' : color;
        dsSetTextColor(color === 'transparent' ? '#000000' : color);
        document.getElementById('ds-text-swatches').style.display = 'none';
      });
    } else if (panelId === 'ds-shape-swatches') {
      dsInitSwatches('ds-shape-swatch-grid', function(color) {
        if (color === 'transparent') {
          dsToggleShapeFill();
        } else {
          document.getElementById('ds-shape-fill').value = color;
          dsSetShapeFill(color);
        }
        document.getElementById('ds-shape-swatches').style.display = 'none';
      });
    }
  }
}

// =====================================================
// TEXT EFFECTS
// =====================================================
function dsToggleEffectsMenu() {
  var menu = document.getElementById('ds-effects-menu');
  var btn = document.getElementById('ds-effects-btn');
  if (menu.style.display === 'block') {
    menu.style.display = 'none';
    btn.classList.remove('active');
  } else {
    menu.style.display = 'block';
    btn.classList.add('active');
  }
}

function dsCloseEffectsMenu() {
  var menu = document.getElementById('ds-effects-menu');
  var btn = document.getElementById('ds-effects-btn');
  if (menu) menu.style.display = 'none';
  if (btn) btn.classList.remove('active');
}

function dsApplyEffect(effect) {
  if (!dsCanvas) return;
  var obj = dsCanvas.getActiveObject();
  if (!obj || (obj.type !== 'i-text' && obj.type !== 'textbox')) return;
  dsCloseEffectsMenu();

  switch (effect) {
    case 'shadow':
      if (obj.shadow) {
        obj.set('shadow', null);
      } else {
        obj.set('shadow', new fabric.Shadow({ color: 'rgba(0,0,0,0.6)', blur: 8, offsetX: 3, offsetY: 3 }));
      }
      break;
    case 'outline':
      obj.set({ stroke: '#000000', strokeWidth: 3 });
      document.getElementById('ds-stroke-color').value = '#000000';
      document.getElementById('ds-stroke-width').value = 3;
      break;
    case 'neon':
      var glowColor = obj.fill || '#e879f9';
      obj.set('shadow', new fabric.Shadow({ color: glowColor, blur: 20, offsetX: 0, offsetY: 0 }));
      obj.set({ stroke: glowColor, strokeWidth: 1 });
      document.getElementById('ds-stroke-color').value = glowColor;
      document.getElementById('ds-stroke-width').value = 1;
      break;
    case 'retro':
      obj.set('shadow', new fabric.Shadow({ color: 'rgba(0,0,0,0.9)', blur: 0, offsetX: 4, offsetY: 4 }));
      obj.set({ stroke: '#000000', strokeWidth: 2 });
      document.getElementById('ds-stroke-color').value = '#000000';
      document.getElementById('ds-stroke-width').value = 2;
      break;
    case 'none':
      obj.set({ shadow: null, stroke: '', strokeWidth: 0 });
      document.getElementById('ds-stroke-color').value = '#000000';
      document.getElementById('ds-stroke-width').value = 0;
      break;
  }

  // Update effects button state without re-running full dsOnSelect
  document.getElementById('ds-effects-btn').classList.toggle('active', !!(obj.shadow || obj.strokeWidth));
  dsCanvas.renderAll();
  dsSaveState();
}

// Close effects menu and swatches on outside click
document.addEventListener('click', function(e) {
  var effectsMenu = document.getElementById('ds-effects-menu');
  var effectsBtn = document.getElementById('ds-effects-btn');
  if (effectsMenu && effectsMenu.style.display === 'block' && !effectsMenu.contains(e.target) && !effectsBtn.contains(e.target)) {
    dsCloseEffectsMenu();
  }
  document.querySelectorAll('.ds-swatches-panel').forEach(function(panel) {
    if (panel.style.display === 'block' && !panel.contains(e.target) && !panel.previousElementSibling?.contains(e.target) && !panel.parentElement?.querySelector('input[type=color]')?.contains(e.target)) {
      panel.style.display = 'none';
    }
  });
});

// =====================================================
// SET IMAGE AS BACKGROUND
// =====================================================
function dsSetAsBg() {
  if (!dsCanvas) return;
  var obj = dsCanvas.getActiveObject();
  if (!obj || obj.type !== 'image') return;

  // Remove existing background image if any
  var objects = dsCanvas.getObjects();
  for (var i = 0; i < objects.length; i++) {
    if (objects[i]._dsBgImage) {
      dsCanvas.remove(objects[i]);
      break;
    }
  }

  // Scale image to cover the canvas
  var canvasW = dsCanvas.getWidth();
  var canvasH = dsCanvas.getHeight();
  var scaleX = canvasW / obj.width;
  var scaleY = canvasH / obj.height;
  var scale = Math.max(scaleX, scaleY);

  obj.set({
    left: canvasW / 2,
    top: canvasH / 2,
    originX: 'center',
    originY: 'center',
    scaleX: scale,
    scaleY: scale,
    selectable: false,
    evented: false,
    lockMovementX: true,
    lockMovementY: true,
    hasControls: false,
    hasBorders: false,
    _dsBgImage: true
  });

  // Send to back
  dsCanvas.sendToBack(obj);
  dsCanvas.discardActiveObject();
  dsCanvas.renderAll();
  dsRefreshLayersIfOpen();
  dsSaveState();
  showDsMsg('success', 'Image set as background. It\'s locked behind all other layers.');
}

// Allow unlocking background image from layers panel
function dsUnsetBg(idx) {
  if (!dsCanvas) return;
  var objects = dsCanvas.getObjects().filter(function(o) { return !o._isGuideLine; });
  var obj = objects[idx];
  if (!obj || !obj._dsBgImage) return;
  obj.set({
    selectable: true,
    evented: true,
    lockMovementX: false,
    lockMovementY: false,
    hasControls: true,
    hasBorders: true,
    originX: 'left',
    originY: 'top',
    _dsBgImage: false
  });
  // Recalculate position since we changed origin
  var bound = obj.getBoundingRect();
  obj.set({ left: bound.left, top: bound.top });
  obj.setCoords();
  dsCanvas.setActiveObject(obj);
  dsCanvas.renderAll();
  dsRefreshLayersIfOpen();
  dsSaveState();
}

// =====================================================
// LAYERS PANEL
// =====================================================
function dsToggleLayers() {
  var panel = document.getElementById('ds-layers-panel');
  var btn = document.getElementById('ds-layers-btn');
  if (panel.style.display === 'block') {
    panel.style.display = 'none';
    btn.classList.remove('active');
  } else {
    panel.style.display = 'block';
    btn.classList.add('active');
    dsRenderLayers();
  }
}

function dsGetLayerName(obj) {
  if (obj.type === 'textbox' || obj.type === 'i-text') {
    var txt = (obj.text || '').substring(0, 20);
    return txt || 'Text';
  }
  if (obj.type === 'image') return 'Image';
  if (obj._dsShape) {
    var names = { rect:'Rectangle', circle:'Circle', triangle:'Triangle', line:'Line', arrow:'Arrow', star:'Star', icon:'Icon' };
    return names[obj._dsShapeType] || 'Shape';
  }
  return 'Object';
}

function dsGetLayerIcon(obj) {
  if (obj.type === 'textbox' || obj.type === 'i-text') return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>';
  if (obj.type === 'image') return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>';
  if (obj._dsShapeType === 'rect') return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
  if (obj._dsShapeType === 'circle') return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
  if (obj._dsShapeType === 'triangle') return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 22h20z"/></svg>';
  if (obj._dsShapeType === 'line') return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/></svg>';
  if (obj._dsShapeType === 'arrow') return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
  if (obj._dsShapeType === 'star') return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
}

function dsRenderLayers() {
  var list = document.getElementById('ds-layers-list');
  if (!list || !dsCanvas) return;
  var objects = dsCanvas.getObjects().filter(function(o) { return !o._isGuideLine; });
  var active = dsCanvas.getActiveObject();

  if (objects.length === 0) {
    list.innerHTML = '<div class="ds-s-5ac182">No layers yet. Add text, images, or shapes.</div>';
    return;
  }

  // Render in reverse order (top layer first)
  var html = '';
  for (var i = objects.length - 1; i >= 0; i--) {
    var obj = objects[i];
    var isActive = obj === active;
    var isVisible = obj.visible !== false;
    var isBg = obj._dsBgImage;
    var name = isBg ? 'Background' : dsGetLayerName(obj);
    var icon = dsGetLayerIcon(obj);
    html += '<div class="ds-layer-item' + (isActive ? ' active' : '') + '" data-layer-idx="' + i + '"' + (isBg ? '' : ' draggable="true"')
      + (isBg ? '' : ' data-ds-action="select-layer" data-ds-layer-idx="' + i + '"')
      + (isBg ? '' : ' data-ds-layer-drag="' + i + '"')
      + '>'
      + (isBg ? '<div class="ds-layer-grip ds-s-ba9903" ><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/></svg></div>'
        : '<div class="ds-layer-grip" title="Drag to reorder"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/></svg></div>')
      + '<div class="ds-layer-icon">' + icon + '</div>'
      + '<div class="ds-layer-name">' + escapeHtml(name) + (isBg ? ' <span class="ds-s-793127">🔒</span>' : '') + '</div>'
      + (isBg ? '<button data-ds-action="unset-bg" data-ds-layer-idx="' + i + '" class="ds-s-bfe723" title="Unlock background">Unlock</button>'
        : '<button class="ds-layer-vis' + (isVisible ? '' : ' hidden') + '" data-ds-action="toggle-layer-vis" data-ds-layer-idx="' + i + '" title="' + (isVisible ? 'Hide' : 'Show') + '" aria-label="' + (isVisible ? 'Hide layer' : 'Show layer') + '">'
        + (isVisible ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
          : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>')
        + '</button>')
      + '</div>';
  }
  list.innerHTML = html;
}

function dsSelectLayer(idx) {
  if (!dsCanvas) return;
  var objects = dsCanvas.getObjects().filter(function(o) { return !o._isGuideLine; });
  if (idx >= 0 && idx < objects.length) {
    dsCanvas.setActiveObject(objects[idx]);
    dsCanvas.renderAll();
    dsRenderLayers();
  }
}

function dsToggleLayerVis(idx) {
  if (!dsCanvas) return;
  var objects = dsCanvas.getObjects().filter(function(o) { return !o._isGuideLine; });
  if (idx >= 0 && idx < objects.length) {
    var obj = objects[idx];
    obj.visible = !obj.visible;
    if (!obj.visible) {
      obj.evented = false;
      if (dsCanvas.getActiveObject() === obj) dsCanvas.discardActiveObject();
    } else {
      obj.evented = true;
    }
    dsCanvas.renderAll();
    dsRenderLayers();
    dsSaveState();
  }
}

// Drag and drop reorder
var dsLayerDragIdx = -1;

function dsLayerDragStart(e, idx) {
  dsLayerDragIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', idx);
  e.target.style.opacity = '0.5';
  setTimeout(function() { e.target.style.opacity = '0.5'; }, 0);
}

function dsLayerDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var item = e.target.closest('.ds-layer-item');
  if (item) item.classList.add('drag-over');
}

function dsLayerDragLeave(e) {
  var item = e.target.closest('.ds-layer-item');
  if (item) item.classList.remove('drag-over');
}

function dsLayerDrop(e, targetIdx) {
  e.preventDefault();
  var item = e.target.closest('.ds-layer-item');
  if (item) item.classList.remove('drag-over');

  if (dsLayerDragIdx === -1 || dsLayerDragIdx === targetIdx) return;

  var objects = dsCanvas.getObjects().filter(function(o) { return !o._isGuideLine; });
  var srcObj = objects[dsLayerDragIdx];
  if (!srcObj) return;

  // Remove and re-insert at target position
  dsCanvas.remove(srcObj);
  var allObjs = dsCanvas.getObjects();
  // Count non-guideline objects to find the real insert index
  var realTargetIdx = 0;
  var count = 0;
  for (var i = 0; i < allObjs.length; i++) {
    if (!allObjs[i]._isGuideLine) {
      if (count === targetIdx) { realTargetIdx = i; break; }
      count++;
    }
    realTargetIdx = i + 1;
  }
  dsCanvas.insertAt(srcObj, realTargetIdx);
  dsCanvas.setActiveObject(srcObj);
  dsCanvas.renderAll();
  dsRenderLayers();
  dsSaveState();
  dsLayerDragIdx = -1;
}

// Refresh layers panel when objects change
function dsRefreshLayersIfOpen() {
  var panel = document.getElementById('ds-layers-panel');
  if (panel && panel.style.display === 'block') dsRenderLayers();
}

// =====================================================
// SHAPE TOOLS
// =====================================================
function dsToggleShapeMenu() {
  var menu = document.getElementById('ds-shape-menu');
  if (menu.style.display === 'block') { dsCloseShapeMenu(); }
  else { menu.style.display = 'block'; document.getElementById('ds-shapes-btn').classList.add('active'); }
}
function dsCloseShapeMenu() {
  var menu = document.getElementById('ds-shape-menu');
  if (menu) menu.style.display = 'none';
  var btn = document.getElementById('ds-shapes-btn');
  if (btn) btn.classList.remove('active');
  // Reset search
  var input = document.getElementById('ds-icon-search');
  if (input) input.value = '';
  var results = document.getElementById('ds-icon-results');
  if (results) results.innerHTML = '<div class="ds-s-c615be">Search over 200,000+ icons through Iconify</div>';
}

// =====================================================
// ICON SEARCH (Iconify API)
// =====================================================
var dsIconSearchTimeout = null;

function dsDebounceIconSearch() {
  clearTimeout(dsIconSearchTimeout);
  var query = (document.getElementById('ds-icon-search').value || '').trim();
  if (query.length < 2) return;
  dsIconSearchTimeout = setTimeout(dsSearchIcons, 400);
}

function dsSearchIcons() {
  var query = (document.getElementById('ds-icon-search').value || '').trim();
  if (!query) return;
  var results = document.getElementById('ds-icon-results');
  results.innerHTML = '<div class="ds-s-d89f31"><svg width="20" height="20" viewBox="0 0 24 24" class="ds-s-f33c30" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div>';

  fetch('https://api.iconify.design/search?query=' + encodeURIComponent(query) + '&limit=48')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.icons || data.icons.length === 0) {
        results.innerHTML = '<div class="ds-s-c615be">No icons found. Try a different keyword.</div>';
        return;
      }
      var grid = '<div class="ds-s-3b466c">';
      data.icons.forEach(function(iconName) {
        // Escape both the data attribute value (for HTML) and the title.
        // We use escapeHtml here because iconName comes from the Iconify API.
        var safeName = escapeHtml(iconName);
        grid += '<button class="ds-icon-item" data-ds-drag="icon:' + safeName + '" title="' + escapeHtml(iconName.split(':')[1] || iconName) + '">'
          + '<img src="https://api.iconify.design/' + safeName + '.svg?color=%23f0eef8" alt="' + safeName + ' icon" class="ds-s-9294d4" loading="lazy">'
          + '</button>';
      });
      grid += '</div>';
      results.innerHTML = grid;
    })
    .catch(function() {
      results.innerHTML = '<div class="ds-s-c615be">Failed to search. Check your connection.</div>';
    });
}

function dsAddIcon(iconName) {
  if (!dsCanvas) return;
  var url = 'https://api.iconify.design/' + iconName + '.svg?color=%23000000&height=120';

  fabric.Image.fromURL(url, function(img) {
    if (!img) { showDsMsg('error', 'Failed to load icon.'); return; }
    img.set({
      left: 80,
      top: 80,
      lockScalingFlip: true
    });
    img._dsShape = true;
    img._dsShapeType = 'icon';
    img._dsIconName = iconName;
    img._dsIconColor = '#000000';
    dsCanvas.add(img);
    dsCanvas.setActiveObject(img);
    dsCanvas.renderAll();
    dsSaveState();
    dsCloseShapeMenu();
  }, { crossOrigin: 'anonymous' });
}

function dsAddIconAt(iconName, x, y) {
  if (!dsCanvas) return;
  var url = 'https://api.iconify.design/' + iconName + '.svg?color=%23000000&height=120';

  fabric.Image.fromURL(url, function(img) {
    if (!img) { showDsMsg('error', 'Failed to load icon.'); return; }
    img.set({
      left: x,
      top: y,
      originX: 'center',
      originY: 'center',
      lockScalingFlip: true
    });
    img._dsShape = true;
    img._dsShapeType = 'icon';
    img._dsIconName = iconName;
    img._dsIconColor = '#000000';
    dsCanvas.add(img);
    dsCanvas.setActiveObject(img);
    dsCanvas.renderAll();
    dsSaveState();
  }, { crossOrigin: 'anonymous' });
}

function dsAddShape(type) {
  if (!dsCanvas) return;
  dsCloseShapeMenu();
  var fill = '#7c3aed';
  var stroke = '#ffffff';
  var sw = 0;
  var obj;

  switch (type) {
    case 'rect':
      obj = new fabric.Rect({ left:80, top:80, width:150, height:100, fill:fill, stroke:stroke, strokeWidth:sw, rx:0, ry:0 });
      break;
    case 'circle':
      obj = new fabric.Circle({ left:80, top:80, radius:60, fill:fill, stroke:stroke, strokeWidth:sw });
      break;
    case 'triangle':
      obj = new fabric.Triangle({ left:80, top:80, width:120, height:120, fill:fill, stroke:stroke, strokeWidth:sw });
      break;
    case 'line':
      obj = new fabric.Line([50,50,250,50], { left:80, top:80, stroke:'#000000', strokeWidth:3, fill:'' });
      fill = '';
      break;
    case 'arrow':
      // Arrow as a single path
      obj = new fabric.Path('M 0 10 L 80 10 L 80 0 L 100 15 L 80 30 L 80 20 L 0 20 Z', {
        left: 80, top: 80, fill: '#000000', stroke: '', strokeWidth: 0
      });
      obj._dsShapeType = 'arrow';
      break;
    case 'star':
      var points = dsStarPoints(5, 50, 22);
      obj = new fabric.Polygon(points, { left:80, top:80, fill:fill, stroke:stroke, strokeWidth:sw });
      break;
    default:
      return;
  }

  obj._dsShape = true;
  obj._dsShapeType = type;
  obj.set({ lockScalingFlip: true });
  dsCanvas.add(obj);
  dsCanvas.setActiveObject(obj);
  dsCanvas.renderAll();
  dsSaveState();
}

function dsStarPoints(spikes, outerR, innerR) {
  var points = [];
  var step = Math.PI / spikes;
  for (var i = 0; i < 2 * spikes; i++) {
    var r = i % 2 === 0 ? outerR : innerR;
    var angle = i * step - Math.PI / 2;
    points.push({ x: outerR + r * Math.cos(angle), y: outerR + r * Math.sin(angle) });
  }
  return points;
}

function dsSetShapeFill(color) {
  if (!dsCanvas) return;
  var obj = dsCanvas.getActiveObject();
  if (!obj || !obj._dsShape) return;

  // Icons are raster images of SVGs — setting `fill` does nothing visually.
  // Re-fetch from Iconify with the new color and swap the underlying image
  // element in place. Position, scale, rotation are preserved.
  if (obj._dsShapeType === 'icon' && obj._dsIconName) {
    var iconName = obj._dsIconName;
    var hex = (color || '#000000').replace('#', '%23');
    var url = 'https://api.iconify.design/' + iconName + '.svg?color=' + hex + '&height=120';
    fabric.Image.fromURL(url, function(img) {
      if (!img || !img._element) return;
      // Verify the icon is still the active object — user may have clicked
      // away while the fetch was in flight.
      if (dsCanvas.getActiveObject() !== obj) return;
      obj.setElement(img._element);
      obj._dsIconColor = color;
      dsCanvas.renderAll();
      dsSaveState();
    }, { crossOrigin: 'anonymous' });
    return;
  }

  obj.set('fill', color);
  document.getElementById('ds-shape-nofill-btn').classList.remove('active');
  dsCanvas.renderAll();
  dsSaveState();
}

function dsToggleShapeFill() {
  if (!dsCanvas) return;
  var obj = dsCanvas.getActiveObject();
  if (!obj || !obj._dsShape) return;
  var btn = document.getElementById('ds-shape-nofill-btn');
  if (obj.fill === 'transparent' || obj.fill === '') {
    obj.set('fill', document.getElementById('ds-shape-fill').value || '#7c3aed');
    btn.classList.remove('active');
  } else {
    obj.set('fill', 'transparent');
    btn.classList.add('active');
  }
  dsCanvas.renderAll();
  dsSaveState();
}

function dsSetShapeStroke() {
  if (!dsCanvas) return;
  var obj = dsCanvas.getActiveObject();
  if (!obj || !obj._dsShape) return;
  var color = document.getElementById('ds-shape-stroke-color').value;
  var width = parseInt(document.getElementById('ds-shape-stroke-width').value) || 0;
  obj.set({ stroke: color, strokeWidth: width });
  dsCanvas.renderAll();
  dsSaveState();
}

function dsSetShapeRadius(val) {
  if (!dsCanvas) return;
  var obj = dsCanvas.getActiveObject();
  if (!obj || !obj._dsShape || obj._dsShapeType !== 'rect') return;
  var r = parseInt(val) || 0;
  obj.set({ rx: r, ry: r });
  dsCanvas.renderAll();
  dsSaveState();
}

// Close shape menu on click outside
document.addEventListener('click', function(e) {
  var menu = document.getElementById('ds-shape-menu');
  var btn = document.getElementById('ds-shapes-btn');
  if (menu && menu.style.display === 'block' && !menu.contains(e.target) && !btn.contains(e.target)) {
    dsCloseShapeMenu();
  }
});

function dsAddText() {
  if (!dsCanvas) return;
  var text = new fabric.Textbox('Your text', {
    left: 50, top: 50,
    width: 200,
    fontFamily: document.getElementById('ds-font-select')?.value || 'DM Sans',
    fontSize: 24,
    fill: '#000000',
    editable: true,
    lockScalingFlip: true
  });
  dsCanvas.add(text);
  dsCanvas.setActiveObject(text);
  dsCanvas.renderAll();
}

var DS_MAX_IMAGES = 15;
var DS_MAX_IMG_PX = 1500;

function dsCountImages() {
  if (!dsCanvas) return 0;
  return dsCanvas.getObjects().filter(function(o) { return o.type === 'image'; }).length;
}

function dsCompressImage(file, callback) {
  var img = new Image();
  var objectUrl = URL.createObjectURL(file);
  img.onload = function() {
    // Release the object URL as soon as the image is decoded. Without this,
    // each upload leaks a blob reference for the life of the tab.
    URL.revokeObjectURL(objectUrl);
    var w = img.width, h = img.height;
    if (w > DS_MAX_IMG_PX || h > DS_MAX_IMG_PX) {
      var ratio = Math.min(DS_MAX_IMG_PX / w, DS_MAX_IMG_PX / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    var dataUrl = c.toDataURL('image/webp', 0.8);
    callback(dataUrl);
  };
  img.onerror = function() {
    // Still revoke on error so we don't leak even when decode fails.
    URL.revokeObjectURL(objectUrl);
    showDsMsg('error', 'Could not load that image. Try a different file.');
  };
  img.src = objectUrl;
}

function dsAddImage() {
  if (dsCountImages() >= DS_MAX_IMAGES) {
    showDsMsg('error', 'Maximum ' + DS_MAX_IMAGES + ' images per project.');
    return;
  }
  document.getElementById('ds-image-input').onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (dsCountImages() >= DS_MAX_IMAGES) {
      showDsMsg('error', 'Maximum ' + DS_MAX_IMAGES + ' images per project.');
      e.target.value = '';
      return;
    }
    dsCompressImage(file, function(dataUrl) {
      fabric.Image.fromURL(dataUrl, function(img) {
        var maxDim = Math.min(dsCanvas.width, dsCanvas.height) * 0.6;
        var imgScale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        img.set({ left: 30, top: 30, scaleX: imgScale, scaleY: imgScale });
        dsCanvas.add(img);
        dsCanvas.setActiveObject(img);
        dsCanvas.renderAll();
      });
    });
    e.target.value = '';
  };
  document.getElementById('ds-image-input').click();
}

function dsSetFont(f) {
  var obj = dsCanvas?.getActiveObject();
  if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) { obj.set('fontFamily', f); dsCanvas.renderAll(); }
}

function dsSetFontSize(s) {
  var obj = dsCanvas?.getActiveObject();
  if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) { obj.set('fontSize', parseInt(s) || 24); dsCanvas.renderAll(); }
}

function dsToggleBold() {
  var obj = dsCanvas?.getActiveObject();
  if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
    obj.set('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold');
    document.getElementById('ds-bold-btn').classList.toggle('active');
    dsCanvas.renderAll();
  }
}

function dsToggleItalic() {
  var obj = dsCanvas?.getActiveObject();
  if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
    obj.set('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic');
    document.getElementById('ds-italic-btn').classList.toggle('active');
    dsCanvas.renderAll();
  }
}

function dsToggleUnderline() {
  var obj = dsCanvas?.getActiveObject();
  if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
    obj.set('underline', !obj.underline);
    document.getElementById('ds-underline-btn').classList.toggle('active');
    dsCanvas.renderAll();
  }
}

function dsSetAlign(align) {
  var obj = dsCanvas?.getActiveObject();
  if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) { obj.set('textAlign', align); dsCanvas.renderAll(); }
}

function dsSetTextColor(color) {
  var obj = dsCanvas?.getActiveObject();
  if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) { obj.set('fill', color); dsCanvas.renderAll(); }
}

function dsDeleteSelected() {
  if (!dsCanvas) return;
  var obj = dsCanvas.getActiveObject();
  if (obj) {
    dsCanvas.remove(obj);
    dsCanvas.discardActiveObject();
    // Clear hover highlight reference to prevent lingering border
    if (typeof dsHoveredObj !== 'undefined') dsHoveredObj = null;
    dsCanvas.renderAll();
    dsSaveState();
  }
}

function dsDuplicate() {
  if (!dsCanvas) return;
  var obj = dsCanvas.getActiveObject();
  if (!obj) return;
  if (obj.type === 'image' && dsCountImages() >= DS_MAX_IMAGES) {
    showDsMsg('error', 'Maximum ' + DS_MAX_IMAGES + ' images per project.');
    return;
  }
  obj.clone(function(cloned) {
    cloned.set({ left: obj.left + 20, top: obj.top + 20 });
    dsCanvas.add(cloned);
    dsCanvas.setActiveObject(cloned);
    dsCanvas.renderAll();
  });
}

// ===== UNDO / REDO =====
var dsUndoStack = [];
var dsRedoStack = [];
var dsUndoLock = false;

function dsSaveState() {
  if (dsUndoLock || !dsCanvas) return;
  dsUndoStack.push(JSON.stringify(dsCanvas.toJSON(['_dsShape', '_dsShapeType', '_dsIconName', '_dsIconColor'])));
  if (dsUndoStack.length > 40) dsUndoStack.shift();
  dsRedoStack = [];
}

function dsUndo() {
  if (!dsCanvas || dsUndoStack.length === 0) return;
  dsRedoStack.push(JSON.stringify(dsCanvas.toJSON(['_dsShape', '_dsShapeType', '_dsIconName', '_dsIconColor'])));
  var state = dsUndoStack.pop();
  dsUndoLock = true;
  dsCanvas.loadFromJSON(state, function() {
    dsCanvas.renderAll();
    dsUndoLock = false;
  });
}

function dsRedo() {
  if (!dsCanvas || dsRedoStack.length === 0) return;
  dsUndoStack.push(JSON.stringify(dsCanvas.toJSON(['_dsShape', '_dsShapeType', '_dsIconName', '_dsIconColor'])));
  var state = dsRedoStack.pop();
  dsUndoLock = true;
  dsCanvas.loadFromJSON(state, function() {
    dsCanvas.renderAll();
    dsUndoLock = false;
  });
}

// ===== STROKE =====
function dsSetStroke() {
  var obj = dsCanvas?.getActiveObject();
  if (!obj || (obj.type !== 'i-text' && obj.type !== 'textbox')) return;
  var color = document.getElementById('ds-stroke-color').value;
  var width = parseInt(document.getElementById('ds-stroke-width').value) || 0;
  obj.set({ stroke: width > 0 ? color : null, strokeWidth: width });
  dsCanvas.renderAll();
}

// ===== SHADOW =====
// Shadow toggle now handled by dsApplyEffect('shadow') in Effects menu

// ===== OPACITY =====
function dsSetOpacity(val) {
  var obj = dsCanvas?.getActiveObject();
  if (!obj) return;
  obj.set('opacity', val / 100);
  document.getElementById('ds-opacity-val').textContent = val + '%';
  dsCanvas.renderAll();
}

// ===== LOCK / UNLOCK =====
function dsToggleLock() {
  var obj = dsCanvas?.getActiveObject();
  if (!obj) return;
  var locked = !obj.lockMovementX;
  obj.set({
    lockMovementX: locked,
    lockMovementY: locked,
    lockScalingX: locked,
    lockScalingY: locked,
    lockRotation: locked,
    hasControls: !locked
  });
  document.getElementById('ds-lock-btn').classList.toggle('active', locked);
  dsCanvas.renderAll();
}

function dsBringForward() {
  var obj = dsCanvas?.getActiveObject();
  if (obj) { dsCanvas.bringForward(obj); dsCanvas.renderAll(); }
}

function dsSendBackward() {
  var obj = dsCanvas?.getActiveObject();
  if (obj) { dsCanvas.sendBackwards(obj); dsCanvas.renderAll(); }
}

var dsExportFormat = 'png';

function dsToggleExportMenu() {
  var menu = document.getElementById('ds-export-menu');
  if (menu.style.display === 'block') {
    menu.style.display = 'none';
  } else {
    menu.style.display = 'block';
  }
}

function dsSetExportFormat(fmt) {
  dsExportFormat = fmt;
  document.querySelectorAll('.ds-fmt-btn').forEach(function(b) { b.classList.remove('active'); });
  document.getElementById('ds-fmt-' + (fmt === 'jpeg' ? 'jpg' : fmt)).classList.add('active');

  var qualityRow = document.getElementById('ds-quality-row');
  var info = document.getElementById('ds-export-info');

  if (fmt === 'png') {
    qualityRow.style.display = 'none';
    info.textContent = 'Lossless. Supports transparency.';
  } else if (fmt === 'jpeg') {
    qualityRow.style.display = 'block';
    info.textContent = 'Smaller file size. No transparency.';
  } else if (fmt === 'webp') {
    qualityRow.style.display = 'block';
    info.textContent = 'Modern format. Smallest size. Supports transparency.';
  }
}

function exportDesign() {
  if (!dsCanvas) return;
  var scale = dsCanvas._projectScale || 1;
  var multiplier = 1 / scale;
  var fmt = dsExportFormat || 'png';
  var quality = fmt === 'png' ? 1 : (parseInt(document.getElementById('ds-quality-slider').value) || 90) / 100;
  var ext = fmt === 'jpeg' ? 'jpg' : fmt;

  var dataUrl = dsCanvas.toDataURL({ format: fmt, multiplier: multiplier, quality: quality });
  var a = document.createElement('a');
  a.download = (dsProjectName || 'design').replace(/[^a-zA-Z0-9_-]/g, '_') + '.' + ext;
  a.href = dataUrl;
  a.click();
  document.getElementById('ds-export-menu').style.display = 'none';
}

// Close export menu on outside click
document.addEventListener('click', function(e) {
  var menu = document.getElementById('ds-export-menu');
  var btn = document.getElementById('ds-export-btn');
  if (menu && menu.style.display === 'block' && !menu.contains(e.target) && !btn.contains(e.target)) {
    menu.style.display = 'none';
  }
});



function dsEditProjectName() {
  var el = document.getElementById('ds-project-name');
  var current = el.textContent;
  el.style.borderColor = 'transparent';
  el.removeAttribute('onclick');

  var input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.maxLength = 60;
  input.style.cssText = 'font-family:Syne,sans-serif;font-size:18px;font-weight:800;letter-spacing:-0.3px;background:var(--surface);border:1px solid rgba(124,58,237,0.4);border-radius:6px;padding:4px 8px;color:var(--text);outline:none;width:100%;min-width:120px;';
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();

  function save() {
    var val = input.value.trim() || 'Untitled';
    dsProjectName = val;
    el.textContent = val;
    el.setAttribute('onclick', 'dsEditProjectName()');
    // Update in DB if project is saved
    if (dsCurrentProjectId && currentUser) {
      sb.from('design_projects').update({ name: val }).eq('id', dsCurrentProjectId);
    }
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

function closeDesignEditor() {
  document.getElementById('design-editor').style.display = 'none';
  document.getElementById('design-start').style.display = 'block';
  document.getElementById('ds-canvas-wrap').style.backgroundImage = 'none';
  // Reset loading overlay so it doesn't appear when entering a fresh project next time.
  var overlay = document.getElementById('ds-loading-overlay');
  if (overlay) overlay.classList.remove('active');
  dsTransparentBg = false;
  var tbtn = document.getElementById('ds-transparent-btn');
  if (tbtn) tbtn.classList.remove('active');
  if (dsCanvas) { dsCanvas.dispose(); dsCanvas = null; }
  document.removeEventListener('keydown', dsKeyHandler);
  loadDesignProjects();
}

// =====================================================
// REUSABLE MODAL CONFIRM / ALERT (replaces browser popups)
// =====================================================
function showModalConfirm(title, message, onConfirm, confirmText, cancelText) {
  var overlay = document.createElement('div');
  overlay.id = 'modal-confirm-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
  // Convert \n\n into paragraph breaks for cleaner formatting
  var msgHtml = (message || 'Are you sure?').split(/\n\n+/).map(function(p) {
    return '<p class="ds-s-f6f597">' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');
  overlay.innerHTML = '<div class="ds-s-6646ca">'
    + '<div class="ds-s-85e627">' + (title || 'Confirm') + '</div>'
    + '<div class="mk-s-e4ad4a">' + msgHtml + '</div>'
    + '<div class="course-s-b9bbe5">'
    + '<button id="modal-confirm-yes" class="ds-s-6e0dd5">' + (confirmText || 'Delete') + '</button>'
    + '<button id="modal-confirm-no" class="ds-s-dea7b5">' + (cancelText || 'Cancel') + '</button>'
    + '</div>'
    + '</div>';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  document.getElementById('modal-confirm-yes').onclick = function() { overlay.remove(); if (onConfirm) onConfirm(); };
  document.getElementById('modal-confirm-no').onclick = function() { overlay.remove(); };
}

function showCompatibleFilesModal() {
  var existing = document.getElementById('modal-compat-overlay');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'modal-compat-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
  var groups = [
    ['Documents & ebooks', 'PDF, EPUB, MOBI, TXT, MD, DOCX, Pages'],
    ['Spreadsheets', 'CSV, XLSX, Numbers'],
    ['Presentations', 'PPTX, Keynote'],
    ['Images', 'JPG, PNG, GIF, WEBP, SVG'],
    ['Design files', 'PSD, AI, INDD, Sketch, Figma, Affinity Photo, Affinity Designer'],
    ['LUTs & color presets', 'CUBE, 3DL, Lightroom (LRTEMPLATE), XMP, DNG'],
    ['Photoshop assets', 'Actions (ATN), Brushes (ABR), Layer Styles (ASL), Templates (TPL)'],
    ['DaVinci Resolve', 'DRP presets'],
    ['Audio', 'MP3, WAV, AIFF, M4A, FLAC'],
    ['Video', 'MP4, MOV, WEBM, M4V, AVI, MKV'],
    ['Fonts', 'OTF, TTF, WOFF, WOFF2'],
    ['Procreate', 'Brushes (BRUSH), Brush Sets (BRUSHSET), Procreate files (PROCREATE)'],
    ['3D models', 'BLEND, OBJ, FBX, STL, GLB, GLTF'],
    ['Archives', 'ZIP, RAR, 7Z']
  ];
  var rows = groups.map(function(g) {
    return '<div class="ds-s-502221">'
      + '<div class="ds-s-75f473">' + g[0] + '</div>'
      + '<div class="ds-s-a26cbd">' + g[1] + '</div>'
      + '</div>';
  }).join('');
  overlay.innerHTML = '<div class="ds-s-83df60">'
    + '<div class="bio-s-b3617b">Compatible files</div>'
    + '<div class="ds-s-8f1f4d">Files are checked for safety on upload. Executables and scripts are blocked.</div>'
    + '<div class="deal-s-5b6aad">' + rows + '</div>'
    + '<button data-ds-action="close-modal-compat" class="ds-s-ee713d">Close</button>'
    + '</div>';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

function showModalAlert(title, message) {
  var overlay = document.createElement('div');
  overlay.id = 'modal-alert-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
  // Convert \n\n into paragraph breaks
  var msgHtml = (message || '').split(/\n\n+/).map(function(p) {
    return '<p class="ds-s-f6f597">' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');
  overlay.innerHTML = '<div class="ds-s-6646ca">'
    + '<div class="ds-s-85e627">' + (title || 'Notice') + '</div>'
    + '<div class="mk-s-e4ad4a">' + msgHtml + '</div>'
    + '<button data-ds-action="close-modal-alert" class="ds-s-ee713d">OK</button>'
    + '</div>';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

function showDsMsg(type, msg) {
  // Delegates to the dashboard's slide-in toast. Falls back to the inline
  // banner if the shell isn't loaded.
  if (typeof showDashToast === 'function') {
    showDashToast(type === 'error' ? 'error' : 'success', msg);
    return;
  }
  var el = document.getElementById('ds-editor-msg');
  el.style.display = 'block';
  el.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(74,222,128,0.1)';
  el.style.color = type === 'error' ? '#f87171' : '#4ade80';
  el.style.border = '1px solid ' + (type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(74,222,128,0.3)');
  el.textContent = msg;
  setTimeout(function() { el.style.display = 'none'; }, 4000);
}

function getDsSaveMax() {
  if (typeof isMax === 'function' && isMax()) return dsSaveLimit.max;
  if (typeof isPro === 'function' && isPro()) return dsSaveLimit.pro;
  return dsSaveLimit.free;
}

async function saveDesignProject() {
  if (!dsCanvas || !currentUser) return;
  // Short-circuit: if the project is already saved (has an id) AND nothing
  // has been modified since the last successful save, skip the network
  // round-trip entirely. Stops anxious-clicker scenarios from racking up
  // egress on identical content. The dirty flag is set true by any canvas
  // mutation (object:added/removed/modified).
  if (!_dsDirty && dsCurrentProjectId) {
    showDsMsg('success', 'Already saved.');
    return;
  }
  var btn = document.getElementById('ds-save-btn');
  btn.disabled = true; btn.textContent = 'Saving...';

  try {
    var max = getDsSaveMax();
    // Check limit if new project
    if (!dsCurrentProjectId) {
      var { count } = await sb.from('design_projects').select('id', { count: 'exact', head: true }).eq('user_id', currentUser.id);
      if (count >= max) {
        throw new Error('You\'ve reached your save limit (' + max + ' projects). Delete a project to save a new one.');
      }
    }

    // Normalize canvas to 1:1 project scale before saving
    var saveZoom = dsCurrentZoom;
    if (saveZoom !== 1) {
      var ratio = 1 / dsCanvas._projectScale;
      dsCanvas.getObjects().forEach(function(obj) {
        if (obj._isGuideLine) return;
        if (obj.type === 'textbox' || obj.type === 'i-text') {
          obj.set({ fontSize: Math.round(obj.fontSize * ratio), width: obj.width * ratio, left: obj.left * ratio, top: obj.top * ratio });
        } else {
          obj.set({ left: obj.left * ratio, top: obj.top * ratio, scaleX: obj.scaleX * ratio, scaleY: obj.scaleY * ratio });
        }
        obj.setCoords();
      });
      dsCanvas.setWidth(dsProjectW);
      dsCanvas.setHeight(dsProjectH);
      dsCanvas._projectScale = 1;
    }

    var canvasJSON = JSON.stringify(dsCanvas.toJSON(['_dsShape', '_dsShapeType', '_dsIconName', '_dsIconColor']));

    // Restore zoom after capturing JSON
    if (saveZoom !== 1) {
      dsSetZoom(saveZoom);
    }
    // Reject if project data is too large (10MB).
    // 10MB is plenty for ~10-15 images at WebP 0.85 quality. Postgres rows can
    // hold far more, but capping here keeps saves fast and bandwidth reasonable.
    if (canvasJSON.length > 10 * 1024 * 1024) {
      throw new Error('Project is too large to save. Try removing some images.');
    }
    // Generate thumbnail
    var thumbScale = 200 / Math.max(dsCanvas.width, dsCanvas.height);
    var thumbUrl = dsCanvas.toDataURL({ format: 'webp', quality: 0.6, multiplier: thumbScale });

    var payload = {
      user_id: currentUser.id,
      name: dsProjectName,
      canvas_width: dsProjectW,
      canvas_height: dsProjectH,
      canvas_json: canvasJSON,
      thumbnail: thumbUrl
    };

    if (dsCurrentProjectId) {
      var { error } = await sb.from('design_projects').update(payload).eq('id', dsCurrentProjectId);
      if (error) throw error;
    } else {
      var { data, error } = await sb.from('design_projects').insert(payload).select('id').single();
      if (error) throw error;
      dsCurrentProjectId = data.id;
    }

    showDsMsg('success', 'Project saved!');
    // Mark clean so subsequent identical save clicks short-circuit.
    _dsDirty = false;
  } catch (e) {
    showDsMsg('error', e.message || 'Save failed.');
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

async function loadDesignProjects() {
  if (!currentUser) return;
  var list = document.getElementById('ds-projects-list');
  var empty = document.getElementById('ds-projects-empty');
  var countEl = document.getElementById('ds-save-count');

  var { data, error } = await sb.from('design_projects')
    .select('id, name, canvas_width, canvas_height, thumbnail, updated_at')
    .eq('user_id', currentUser.id)
    .order('updated_at', { ascending: false });

  if (error || !data) { data = []; }

  var max = getDsSaveMax();
  countEl.textContent = '(' + data.length + '/' + max + ')';

  if (data.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = data.map(function(p) {
    var date = new Date(p.updated_at).toLocaleDateString();
    var thumb = p.thumbnail || '';
    return '<div class="ds-project-card" data-ds-action="open-project" data-ds-project-id="' + escapeHtml(p.id) + '">'
      + (thumb ? '<img src="' + escapeHtml(thumb) + '" class="ds-s-c574ca" alt="Contract thumbnail">' : '<div class="ds-s-94aaf8"></div>')
      + '<div class="bio-s-a07604">'
      + '<div class="ds-s-926d39">' + escapeHtml(p.name) + '</div>'
      + '<div class="course-s-5ae0d7">' + p.canvas_width + ' × ' + p.canvas_height + ' · ' + date + '</div>'
      + '</div>'
      + '<button data-ds-action="delete-project" data-ds-project-id="' + escapeHtml(p.id) + '" class="ds-s-2e42ff" title="Delete">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
      + '</button>'
      + '</div>';
  }).join('');
}

async function openDesignProject(id) {
  // Show the editor shell with a loading overlay so the user knows their
  // click registered. Large projects with embedded base64 images can take
  // 1-3 seconds to fetch and deserialize; the overlay covers the canvas area
  // until everything is ready so users never see a half-rendered state.
  var startEl = document.getElementById('design-start');
  var editorEl = document.getElementById('design-editor');
  var nameEl = document.getElementById('ds-project-name');
  var overlay = document.getElementById('ds-loading-overlay');

  startEl.style.display = 'none';
  editorEl.style.display = 'block';
  nameEl.textContent = '';
  if (overlay) overlay.classList.add('active');

  var { data, error } = await sb.from('design_projects').select('*').eq('id', id).eq('user_id', currentUser.id).single();
  if (error || !data) {
    // Revert the optimistic UI and show the error
    if (overlay) overlay.classList.remove('active');
    editorEl.style.display = 'none';
    startEl.style.display = 'block';
    showModalAlert('Error', 'Could not load project. Please try again.');
    return;
  }

  dsProjectW = data.canvas_width || 1080;
  dsProjectH = data.canvas_height || 1350;
  dsProjectName = data.name;
  dsCurrentProjectId = data.id;
  dsPendingJSON = data.canvas_json;
  nameEl.textContent = data.name;

  // Pass a ready callback so we only hide the overlay once the canvas is
  // fully populated (post loadFromJSON + final renderAll).
  initDesignCanvas(function() {
    if (overlay) overlay.classList.remove('active');
  });
}

async function deleteDesignProject(id) {
  showModalConfirm('Delete Project', 'This project will be permanently deleted. This cannot be undone.', async function() {
    await sb.from('design_projects').delete().eq('id', id);
    loadDesignProjects();
  });
}

// Background removal state
var _dsBgRemovalReady = false;
var _dsBgRemovalLoading = false;
var _dsBgRemoveFunc = null;

function dsRemoveBg() {
  if (!dsCanvas) return;
  var obj = dsCanvas.getActiveObject();
  if (!obj || obj.type !== 'image') { showDsMsg('error', 'Select an image first.'); return; }

  if (typeof isPro === 'function' && !isPro()) {
    showDsMsg('error', 'Background removal is a Pro feature. Upgrade to use it.');
    return;
  }

  var btn = document.getElementById('ds-removebg-btn');
  btn.disabled = true;

  function doRemoval() {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" class="ds-s-f33c30" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Processing...';

    var imgEl = obj.getElement();
    var c = document.createElement('canvas');
    c.width = imgEl.naturalWidth || imgEl.width;
    c.height = imgEl.naturalHeight || imgEl.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(imgEl, 0, 0);
    c.toBlob(function(blob) {
      _dsBgRemoveFunc(blob).then(function(resultBlob) {
        // The model returns a PNG blob with alpha. PNG of a transparent
        // photographic subject is large (often 2-5 MB), and that blob ends up
        // as a base64 data URL inside the project JSON via fabric.toJSON, so
        // every save uploads and every load downloads that full payload to
        // Supabase. Re-encode as WebP with alpha at 0.9 quality before
        // serializing — visually indistinguishable from PNG for creator content,
        // but typically 70–90% smaller. Drops egress proportionally.
        var pngImg = new Image();
        pngImg.onload = function() {
          var c2 = document.createElement('canvas');
          c2.width = pngImg.naturalWidth;
          c2.height = pngImg.naturalHeight;
          c2.getContext('2d').drawImage(pngImg, 0, 0);
          c2.toBlob(function(webpBlob) {
            // The PNG resultBlob object URL is no longer needed once we've
            // decoded it; revoke to free memory.
            URL.revokeObjectURL(pngImg.src);
            // If WebP encoding ever fails on a niche browser (very unlikely in
            // 2026 — universal canvas WebP support), webpBlob will be null.
            // Bail with a clear error rather than silently storing a broken src.
            if (!webpBlob) {
              dsResetBgBtn(btn);
              showDsMsg('error', 'Background removal failed (could not encode result). Try again.');
              return;
            }
            var reader = new FileReader();
            reader.onload = function(e) {
              var dataUrl = e.target.result;
              fabric.Image.fromURL(dataUrl, function(newImg) {
                newImg.set({
                  left: obj.left, top: obj.top,
                  scaleX: obj.scaleX, scaleY: obj.scaleY,
                  angle: obj.angle
                });
                dsCanvas.remove(obj);
                dsCanvas.add(newImg);
                dsCanvas.setActiveObject(newImg);
                dsCanvas.renderAll();
                dsResetBgBtn(btn);
                showDsMsg('success', 'Background removed.');
              });
            };
            reader.onerror = function() {
              dsResetBgBtn(btn);
              showDsMsg('error', 'Background removal failed. Try a different image.');
            };
            reader.readAsDataURL(webpBlob);
          }, 'image/webp', 0.9);
        };
        pngImg.onerror = function() {
          dsResetBgBtn(btn);
          showDsMsg('error', 'Background removal failed. Try a different image.');
        };
        pngImg.src = URL.createObjectURL(resultBlob);
      }).catch(function(err) {
        console.error('BG removal error:', err);
        dsResetBgBtn(btn);
        showDsMsg('error', 'Background removal failed. Try a different image.');
      });
    }, 'image/png');
  }

  function dsResetBgBtn(b) {
    b.disabled = false;
    b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l14 14M2 12a10 10 0 0 1 10-10M22 12a10 10 0 0 1-10 10"/></svg> Remove Background';
  }

  if (_dsBgRemovalReady && _dsBgRemoveFunc) {
    doRemoval();
    return;
  }

  if (_dsBgRemovalLoading) {
    showDsMsg('error', 'Still loading the background removal model. Please wait...');
    btn.disabled = false;
    return;
  }

  _dsBgRemovalLoading = true;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" class="ds-s-f33c30" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Loading model...';
  showDsMsg('success', 'Loading the model. This may take a moment on first use...');

  // Dynamic import() of the ESM module. Works under strict CSP (no inline
  // <script> needed), as long as 'https://esm.sh' is in script-src.
  // Note: import() returns a Promise that resolves to the module namespace
  // object. The dynamic-import URL must be a string literal or template
  // literal — we hard-code it here. Pinned version so we don't break on
  // upstream changes.
  //
  // 60-second timeout: covers slow mobile connections downloading the ~60MB
  // ONNX model on first run. Subsequent runs hit the browser cache and finish
  // in milliseconds. Desktop typically completes in 5-15s on fiber, but mobile
  // on 4G can take 30-50s legitimately — 30s was tripping false negatives.
  var timedOut = false;
  var timeoutId = setTimeout(function() {
    timedOut = true;
    _dsBgRemovalLoading = false;
    dsResetBgBtn(btn);
    showDsMsg('error', 'Failed to load background removal. Try again.');
  }, 60000);

  import('https://esm.sh/@imgly/background-removal@1.4.5')
    .then(function(mod) {
      if (timedOut) return; // user already saw the timeout error
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
      dsResetBgBtn(btn);
      showDsMsg('error', 'Failed to load background removal. Try again.');
      console.error('[design] background-removal import failed:', err);
    });
}


// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Start screen — preset size buttons
dsRegisterAction('start-preset', (e, el) => {
  const w = parseInt(el.dataset.dsW, 10);
  const h = parseInt(el.dataset.dsH, 10);
  const name = el.dataset.dsName;
  startDesignProject(w, h, name);
});
dsRegisterAction('open-custom-size', () => openCustomSizeModal());
dsRegisterAction('confirm-custom-size', () => confirmCustomSize());
dsRegisterAction('close-custom-size', () => closeCustomSizeModal());

// Top bar
dsRegisterAction('close-editor', () => closeDesignEditor());
dsRegisterAction('edit-project-name', () => dsEditProjectName());
dsRegisterAction('save-project', () => saveDesignProject());

// Export menu
dsRegisterAction('toggle-export-menu', () => dsToggleExportMenu());
dsRegisterAction('set-export-format', (e, el) => dsSetExportFormat(el.dataset.dsFmt));
dsRegisterAction('quality-slider', (e, el) => {
  // Original inline: document.getElementById('ds-quality-val').textContent=this.value+'%'
  var out = document.getElementById('ds-quality-val');
  if (out) out.textContent = el.value + '%';
});
dsRegisterAction('export', () => exportDesign());

// Font / text controls
dsRegisterAction('set-font', (e, el) => dsSetFont(el.value));
dsRegisterAction('set-font-size', (e, el) => dsSetFontSize(el.value));
dsRegisterAction('toggle-bold', () => dsToggleBold());
dsRegisterAction('toggle-italic', () => dsToggleItalic());
dsRegisterAction('toggle-underline', () => dsToggleUnderline());
dsRegisterAction('align', (e, el) => dsSetAlign(el.dataset.dsAlign));
dsRegisterAction('set-text-color', (e, el) => dsSetTextColor(el.value));
dsRegisterAction('toggle-swatches', (e, el) => dsToggleSwatches(el.dataset.dsPanel));

// Stroke
dsRegisterAction('set-stroke', () => dsSetStroke());

// Effects
dsRegisterAction('toggle-effects-menu', () => dsToggleEffectsMenu());
dsRegisterAction('apply-effect', (e, el) => dsApplyEffect(el.dataset.dsEffect));

// Image tools
dsRegisterAction('remove-bg', () => dsRemoveBg());
dsRegisterAction('set-as-bg', () => dsSetAsBg());

// Shape controls
dsRegisterAction('set-shape-fill', (e, el) => dsSetShapeFill(el.value));
dsRegisterAction('toggle-shape-fill', () => dsToggleShapeFill());
dsRegisterAction('set-shape-stroke', () => dsSetShapeStroke());
dsRegisterAction('set-shape-radius', (e, el) => dsSetShapeRadius(el.value));
dsRegisterAction('set-opacity', (e, el) => dsSetOpacity(el.value));
dsRegisterAction('toggle-lock', () => dsToggleLock());

// Sidebar
dsRegisterAction('add-image', () => dsAddImage());
dsRegisterAction('toggle-shape-menu', () => dsToggleShapeMenu());

// Icon search
dsRegisterAction('debounce-icon-search', () => dsDebounceIconSearch());
dsRegisterAction('icon-search-keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(dsIconSearchTimeout);
    dsSearchIcons();
  }
});
dsRegisterAction('search-icons', () => dsSearchIcons());

// Background
dsRegisterAction('set-bg-color', (e, el) => dsSetBgColor(el.value));
dsRegisterAction('toggle-transparent', () => dsToggleTransparent());

// Bottom toolbar
dsRegisterAction('undo', () => dsUndo());
dsRegisterAction('redo', () => dsRedo());
dsRegisterAction('delete-selected', () => dsDeleteSelected());
dsRegisterAction('duplicate', () => dsDuplicate());
dsRegisterAction('bring-forward', () => dsBringForward());
dsRegisterAction('send-backward', () => dsSendBackward());
dsRegisterAction('toggle-layers', () => dsToggleLayers());
dsRegisterAction('zoom-in', () => dsZoomIn());
dsRegisterAction('zoom-out', () => dsZoomOut());
dsRegisterAction('zoom-fit', () => dsZoomFit());

// Layer panel (template literal rendered)
dsRegisterAction('select-layer', (e, el) => {
  var idx = parseInt(el.dataset.dsLayerIdx, 10);
  dsSelectLayer(idx);
});
dsRegisterAction('toggle-layer-vis', (e, el) => {
  e.stopPropagation();  // Don't bubble to the layer-item's select-layer click
  var idx = parseInt(el.dataset.dsLayerIdx, 10);
  dsToggleLayerVis(idx);
});
dsRegisterAction('unset-bg', (e, el) => {
  e.stopPropagation();
  var idx = parseInt(el.dataset.dsLayerIdx, 10);
  dsUnsetBg(idx);
});

// Project list (template literal rendered)
dsRegisterAction('open-project', (e, el) => openDesignProject(el.dataset.dsProjectId));
dsRegisterAction('delete-project', (e, el) => {
  e.stopPropagation();  // Don't bubble to the card's open-project click
  deleteDesignProject(el.dataset.dsProjectId);
});

// Modal close / utility
dsRegisterAction('close-modal-compat', (e, el) => {
  var m = el.closest('[id=modal-compat-overlay]');
  if (m) m.remove();
});
dsRegisterAction('close-modal-alert', (e, el) => {
  var m = el.closest('[id=modal-alert-overlay]');
  if (m) m.remove();
});




// Misc
dsRegisterAction('window-print', () => window.print());

// Drag-to-canvas for shapes/text/icons. The drag source can be either a static
// button in the shape palette (data-ds-drag="rect", "text", etc.) or a
// dynamically-rendered icon search result (data-ds-drag="icon:..."). We
// delegate from document so dynamic elements work without per-element wiring.
//
// dsDragStart() does its own e.preventDefault() handling for both mousedown
// and touchstart and reads the shape type from the second argument, so we
// just pass the type from the dataset.
document.addEventListener('mousedown', function(e) {
  const el = e.target.closest('[data-ds-drag]');
  if (!el) return;
  dsDragStart(e, el.dataset.dsDrag);
});
document.addEventListener('touchstart', function(e) {
  const el = e.target.closest('[data-ds-drag]');
  if (!el) return;
  dsDragStart(e, el.dataset.dsDrag);
}, { passive: false });
dsRegisterAction('select-all', (e, el) => el.select());

// =============================================================================
// LAYER PANEL DRAG-AND-DROP (reorder layers via dragging in the Layers list)
// -----------------------------------------------------------------------------
// Each draggable layer has data-ds-layer-drag="<idx>" where <idx> is the layer
// index. We delegate from document so dynamically-rendered layer items work
// without per-element rewiring.
//
// dsLayerDragStart(event, idx), dsLayerDragOver(event), dsLayerDragLeave(event),
// dsLayerDrop(event, idx) are all defined in this file. The drag-over/leave
// handlers take only the event; the drag-start/drop handlers also need the
// target layer index, which we read from the data attribute.
// =============================================================================
document.addEventListener('dragstart', function(e) {
  const el = e.target.closest('[data-ds-layer-drag]');
  if (!el) return;
  dsLayerDragStart(e, parseInt(el.dataset.dsLayerDrag, 10));
});
document.addEventListener('dragover', function(e) {
  const el = e.target.closest('[data-ds-layer-drag]');
  if (!el) return;
  dsLayerDragOver(e);
});
document.addEventListener('dragleave', function(e) {
  const el = e.target.closest('[data-ds-layer-drag]');
  if (!el) return;
  dsLayerDragLeave(e);
});
document.addEventListener('drop', function(e) {
  const el = e.target.closest('[data-ds-layer-drag]');
  if (!el) return;
  dsLayerDrop(e, parseInt(el.dataset.dsLayerDrag, 10));
});

