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

function taHandleUpload(input) {
  var file = input.files[0];
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

function taScoreToGrade(score) {
  // Returns { letter, color }
  if (score >= 97) return { letter: 'A+', color: '#4ade80' };
  if (score >= 93) return { letter: 'A',  color: '#4ade80' };
  if (score >= 90) return { letter: 'A-', color: '#4ade80' };
  if (score >= 87) return { letter: 'B+', color: '#84cc16' };
  if (score >= 83) return { letter: 'B',  color: '#84cc16' };
  if (score >= 80) return { letter: 'B-', color: '#84cc16' };
  if (score >= 77) return { letter: 'C+', color: '#fbbf24' };
  if (score >= 73) return { letter: 'C',  color: '#fbbf24' };
  if (score >= 70) return { letter: 'C-', color: '#fbbf24' };
  if (score >= 67) return { letter: 'D+', color: '#fb923c' };
  if (score >= 60) return { letter: 'D',  color: '#fb923c' };
  return { letter: 'F', color: '#f87171' };
}

function taRenderResults(r) {
  var overallGrade = taScoreToGrade(r.overall_score);
  var scoreColor = overallGrade.color;
  var circumference = 2 * Math.PI * 36;
  var offset = circumference - (r.overall_score / 100) * circumference;

  var categories = [
    { key: 'composition', label: 'Composition', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>' },
    { key: 'text_readability', label: 'Text Readability', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>' },
    { key: 'emotional_impact', label: 'Emotional Impact', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>' },
    { key: 'color_contrast', label: 'Color & Contrast', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z"/></svg>' },
    { key: 'clickability', label: 'Clickability', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 15l-2 5L9 9l11 4-5 2z"/><path d="M18 13l4.35 4.35"/></svg>' }
  ];

  var categoryCards = categories.map(function(cat) {
    var d = r[cat.key] || { score: 0, feedback: '' };
    var catGrade = taScoreToGrade(d.score);
    var catColor = catGrade.color;
    return '<div class="ds-s-4ddc27">'
      + '<div class="course-s-17b72a">'
      + '<div class="bio-s-e3f610">' + cat.icon + '<span class="ds-s-e37879">' + cat.label + '</span></div>'
      + '<div class="ds-s-498438">'
      + '<span style="font-family:Syne,sans-serif;font-size:18px;font-weight:800;color:' + catColor + ';">' + catGrade.letter + '</span>'
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

  var verdictText = r.overall_score >= 80 ? 'Strong thumbnail. Ready to publish.'
                  : r.overall_score >= 70 ? 'Solid foundation. A few tweaks could boost clicks.'
                  : r.overall_score >= 60 ? 'Decent start. See the suggestions below.'
                  : 'Needs work. Check the suggestions below.';

  var html = ''
    // Score header with ring
    + '<div class="ds-s-17a51c">'
    + '<div class="ds-s-9026ab">'
    + '<div class="ds-s-715ac4"><img src="' + taImageData + '" alt="Thumbnail analysis result" class="ds-s-2c7b03"></div>'
    + '<div class="ds-s-25bba7">'
    + '<div class="ta-score-ring"><svg width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" fill="none" stroke="var(--surface)" stroke-width="6"/><circle cx="40" cy="40" r="36" fill="none" stroke="' + scoreColor + '" stroke-width="6" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + offset + '" stroke-linecap="round" class="ds-s-f4705b"/></svg><div class="ta-score-num" style="color:' + scoreColor + ';display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;"><span class="ds-s-6b46de">' + overallGrade.letter + '</span><span class="ds-s-49d5ef">' + r.overall_score + '/100</span></div></div>'
    + '<div><div class="ds-s-434a82">Overall Grade</div><div class="cal-s-56e6ba">' + verdictText + '</div></div>'
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

thumbRegisterAction('start-checkout', (e, el) => startCheckout(el.dataset.thumbPlan || 'monthly', el));
thumbRegisterAction('trigger-upload', () => {
  var input = document.getElementById('ta-file-input');
  if (input) input.click();
});
thumbRegisterAction('handle-upload', (e, el) => taHandleUpload(el));
thumbRegisterAction('analyze', () => taAnalyze());
thumbRegisterAction('reset', () => taReset());
