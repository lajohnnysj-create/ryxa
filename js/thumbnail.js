// =============================================================================
// /js/thumbnail.js — Thumbnail Analyzer (extracted from js/design.js, 2026-05-10)
// -----------------------------------------------------------------------------
// AI-powered YouTube thumbnail analyzer. Was previously bundled into
// js/design.js because the original dashboard.html had Design Studio,
// Contract Analyzer, and Thumbnail Analyzer all inside a single <script>
// block. This file extracts Thumbnail Analyzer into its own module.
//
// Uses its own data-thumb-action delegation namespace.
//
// External dependencies on window: sb, Auth, currentUser, escapeHtml,
// getAIHeaders, showModalAlert, startCheckout.
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE
// =============================================================================

const thumbActions = {};

function thumbRegisterAction(action, handler) {
  thumbActions[action] = handler;
}

function thumbFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['thumbAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.thumbAction) {
        const wantEvent = el.dataset.thumbEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.thumbAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function thumbDispatchEvent(event) {
  const found = thumbFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = thumbActions[found.action];
  if (!handler) {
    console.warn('[thumb] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, thumbDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- Thumbnail Analyzer code (originally in js/design.js) ----------
// =====================================================
// THUMBNAIL ANALYZER
// =====================================================
var taImageData = null;

// Accepts either an HTMLInputElement (from file picker change) or a File
// (from drag-and-drop). Returns early if no file or wrong type/size.
function taHandleUpload(inputOrFile) {
  var file;
  if (inputOrFile instanceof File) {
    file = inputOrFile;
  } else if (inputOrFile && inputOrFile.files) {
    file = inputOrFile.files[0];
  }
  if (!file) return;
  if (!file.type.startsWith('image/')) { showModalAlert('Invalid File', 'Please select an image file.'); return; }
  if (file.size > 10 * 1024 * 1024) { showModalAlert('Too Large', 'Image must be under 10MB.'); return; }

  var reader = new FileReader();
  reader.onload = function(e) {
    // Compress to max 800px wide, WebP quality 0.7 before sending to API
    var img = new Image();
    img.onload = function() {
      var maxW = 800;
      var w = img.width;
      var h = img.height;
      if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; }
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      taImageData = canvas.toDataURL('image/webp', 0.7);
      // Show original quality for preview
      document.getElementById('ta-preview-img').src = e.target.result;
      document.getElementById('ta-upload-area').style.display = 'none';
      document.getElementById('ta-preview-area').style.display = 'block';
      document.getElementById('ta-results').style.display = 'none';
      document.getElementById('ta-results').innerHTML = '';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function taReset() {
  taImageData = null;
  document.getElementById('ta-file-input').value = '';
  document.getElementById('ta-upload-area').style.display = 'block';
  document.getElementById('ta-preview-area').style.display = 'none';
  document.getElementById('ta-loading').style.display = 'none';
  document.getElementById('ta-results').style.display = 'none';
  document.getElementById('ta-results').innerHTML = '';
}

function taAnalyze() {
  if (!taImageData) return;

  // Show loading with scanning animation
  document.getElementById('ta-preview-area').style.display = 'none';
  document.getElementById('ta-loading').style.display = 'block';
  document.getElementById('ta-loading-img').src = taImageData;

  // Reset all steps
  for (var i = 0; i < 4; i++) {
    var step = document.getElementById('ta-step-' + i);
    step.classList.remove('active', 'done');
  }

  // Animate steps progressively
  var stepTimers = [400, 1200, 2200, 3200];
  stepTimers.forEach(function(delay, idx) {
    setTimeout(function() {
      // Mark previous as done
      if (idx > 0) document.getElementById('ta-step-' + (idx - 1)).classList.replace('active', 'done');
      document.getElementById('ta-step-' + idx).classList.add('active');
    }, delay);
  });

  // Send to API
  fetch('/api/ai-thumbnail', {
    method: 'POST',
    headers: getAIHeaders(),
    body: JSON.stringify({ image: taImageData })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    // Complete all steps
    for (var i = 0; i < 4; i++) {
      var step = document.getElementById('ta-step-' + i);
      step.classList.remove('active');
      step.classList.add('done');
    }

    setTimeout(function() {
      document.getElementById('ta-loading').style.display = 'none';

      if (data.error) {
        showModalAlert('Error', data.error);
        document.getElementById('ta-preview-area').style.display = 'block';
        return;
      }

      taRenderResults(data.result);
    }, 600);
  })
  .catch(function(err) {
    console.error('Thumbnail analysis error:', err);
    document.getElementById('ta-loading').style.display = 'none';
    document.getElementById('ta-preview-area').style.display = 'block';
    showModalAlert('Error', 'Failed to analyze thumbnail. Please try again.');
  });
}

function taScoreToTier(score) {
  // Returns { label, color }
  if (score >= 80) return { label: 'Highly Clickable',    color: '#4ade80' };
  if (score >= 65) return { label: 'Likely Clickable',    color: '#84cc16' };
  if (score >= 50) return { label: 'Somewhat Clickable',  color: '#fbbf24' };
  return                    { label: 'Low Clickability',    color: '#f87171' };
}

function taRenderResults(r) {
  var overallTier = taScoreToTier(r.overall_score);
  var scoreColor = overallTier.color;

  var categories = [
    { key: 'composition', label: 'Composition', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>' },
    { key: 'text_readability', label: 'Text Readability', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>' },
    { key: 'emotional_impact', label: 'Emotional Impact', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>' },
    { key: 'color_contrast', label: 'Color & Contrast', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z"/></svg>' },
    { key: 'clickability', label: 'Clickability', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 15l-2 5L9 9l11 4-5 2z"/><path d="M18 13l4.35 4.35"/></svg>' }
  ];

  var categoryCards = categories.map(function(cat) {
    var d = r[cat.key] || { score: 0, feedback: '' };
    var catTier = taScoreToTier(d.score);
    var catColor = catTier.color;
    return '<div class="ds-s-4ddc27">'
      + '<div class="course-s-17b72a">'
      + '<div class="bio-s-e3f610">' + cat.icon + '<span class="ds-s-e37879">' + cat.label + '</span></div>'
      + '<div class="ds-s-498438">'
      + '<span class="ds-s-4dc889">' + d.score + '</span>'
      + '</div>'
      + '</div>'
      + '<div class="ds-s-146897">'
      + '<div style="height:100%;width:' + d.score + '%;background:' + catColor + ';border-radius:2px;transition:width 0.8s ease;"></div>'
      + '</div>'
      + '<div class="ds-s-66ae3b">' + escapeHtml(d.feedback) + '</div>'
      + '</div>';
  }).join('');

  var strengths = (r.strengths || []).map(function(s) {
    return '<div class="ds-s-eaec37"><span class="deal-s-e874c3">✓</span><span class="bio-s-e3f916">' + escapeHtml(s) + '</span></div>';
  }).join('');

  var improvements = (r.improvements || []).map(function(s) {
    return '<div class="ds-s-eaec37"><span class="ds-s-25077b">→</span><span class="bio-s-e3f916">' + escapeHtml(s) + '</span></div>';
  }).join('');

  var html = ''
    // Score header with ring
    + '<div class="ds-s-17a51c">'
    + '<div class="ds-s-9026ab">'
    + '<div class="ds-s-715ac4"><img src="' + taImageData + '" alt="Thumbnail analysis result" class="ds-s-2c7b03"></div>'
    + '<div class="ds-s-25bba7">'
    + '<div style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:999px;background:' + scoreColor + '22;border:1px solid ' + scoreColor + '66;color:' + scoreColor + ';font-family:Syne,sans-serif;font-size:18px;font-weight:800;line-height:1;letter-spacing:-0.3px;">'
    + '<span style="width:8px;height:8px;border-radius:50%;background:' + scoreColor + ';display:inline-block;"></span>'
    + overallTier.label
    + '</div>'
    + '</div>'
    + '</div>'
    + '</div>'

    // Category breakdowns
    + '<div class="ds-s-7633ad">' + categoryCards + '</div>'

    // Strengths & Improvements
    + '<div class="ds-s-1d521f">'
    + '<div class="ds-s-051894">'
    + '<div class="ds-s-779f25">Strengths</div>'
    + '<div class="mk-s-f67b86">' + strengths + '</div>'
    + '</div>'
    + '<div class="ds-s-051894">'
    + '<div class="ds-s-2d6878">Suggestions</div>'
    + '<div class="mk-s-f67b86">' + improvements + '</div>'
    + '</div>'
    + '</div>'

    // Try again
    + '<button data-thumb-action="reset" class="ds-s-5288e9">Analyze another thumbnail</button>';

  var resultsEl = document.getElementById('ta-results');
  resultsEl.innerHTML = html;
  resultsEl.style.display = 'block';
}


// =============================================================================
// ACTION REGISTRATIONS
// =============================================================================

thumbRegisterAction('start-checkout', (e, el) => goToPricing(el.dataset.thumbPlan === 'max' ? 'max' : 'pro'));
thumbRegisterAction('trigger-upload', () => {
  var input = document.getElementById('ta-file-input');
  if (input) input.click();
});
thumbRegisterAction('handle-upload', (e, el) => taHandleUpload(el));
thumbRegisterAction('analyze', () => taAnalyze());
thumbRegisterAction('reset', () => taReset());

// =============================================================================
// DRAG-AND-DROP UPLOAD
// -----------------------------------------------------------------------------
// The upload area has data-thumb-drop-zone. Wired at DOMContentLoaded.
// preventDefault on dragover is required for the drop event to fire.
//
// dragleave fires when moving over a CHILD element (the icon, the text divs).
// We check relatedTarget — if the next element under cursor is still inside
// the drop zone, we ignore the leave and keep the class. This prevents the
// drag-over class from flickering on/off as the cursor moves across children.
// =============================================================================
document.addEventListener('DOMContentLoaded', function() {
  var dz = document.querySelector('[data-thumb-drop-zone]');
  if (!dz) return;
  dz.addEventListener('dragover', function(e) {
    e.preventDefault();
    dz.classList.add('drag-over');
  });
  dz.addEventListener('dragleave', function(e) {
    // Only remove drag-over if cursor truly left the drop zone (not just
    // moved onto a child element).
    if (e.relatedTarget && dz.contains(e.relatedTarget)) return;
    dz.classList.remove('drag-over');
  });
  dz.addEventListener('drop', function(e) {
    e.preventDefault();
    dz.classList.remove('drag-over');
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) taHandleUpload(file);
  });
});
