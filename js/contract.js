// =============================================================================
// /js/contract.js — Contract Analyzer (extracted from js/design.js, 2026-05-10)
// -----------------------------------------------------------------------------
// AI-powered contract review tool. Was previously bundled into js/design.js
// because the original dashboard.html had Design Studio, Contract Analyzer,
// and Thumbnail Analyzer all inside a single <script> block. This file
// extracts Contract Analyzer into its own module.
//
// Uses its own data-contract-action delegation namespace.
//
// External dependencies on window: sb, Auth, currentUser, escapeHtml,
// getAIHeaders, showModalAlert, startCheckout, plus pdfjsLib (loaded
// dynamically via CDN inside caExtractPdfText).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE
// =============================================================================

const contractActions = {};

function contractRegisterAction(action, handler) {
  contractActions[action] = handler;
}

function contractFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['contractAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.contractAction) {
        const wantEvent = el.dataset.contractEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.contractAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function contractDispatchEvent(event) {
  const found = contractFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = contractActions[found.action];
  if (!handler) {
    console.warn('[contract] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, contractDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- Contract Analyzer code (originally in js/design.js) ----------
// =====================================================
// CONTRACT ANALYZER
// =====================================================
var caFileData = null;

function caHandleUpload(input) {
  var file = input.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf') { showModalAlert('Invalid File', 'Please upload a PDF file.'); return; }
  if (file.size > 15 * 1024 * 1024) { showModalAlert('Too Large', 'PDF must be under 15MB.'); return; }

  caFileData = file;
  document.getElementById('ca-filename').textContent = file.name;
  document.getElementById('ca-filesize').textContent = (file.size / 1024 / 1024).toFixed(1) + ' MB';
  document.getElementById('ca-upload-area').style.display = 'none';
  document.getElementById('ca-preview-area').style.display = 'block';
  document.getElementById('ca-results').style.display = 'none';
  document.getElementById('ca-results').innerHTML = '';
}

function caReset() {
  caFileData = null;
  document.getElementById('ca-file-input').value = '';
  document.getElementById('ca-upload-area').style.display = 'block';
  document.getElementById('ca-preview-area').style.display = 'none';
  document.getElementById('ca-loading').style.display = 'none';
  document.getElementById('ca-results').style.display = 'none';
  document.getElementById('ca-results').innerHTML = '';
}

async function caAnalyze() {
  if (!caFileData) return;

  document.getElementById('ca-preview-area').style.display = 'none';
  document.getElementById('ca-loading').style.display = 'block';

  // Reset steps
  for (var i = 0; i < 5; i++) {
    document.getElementById('ca-step-' + i).classList.remove('active', 'done');
  }

  // Animate steps
  var stepTimers = [300, 1000, 2000, 3000, 4000];
  stepTimers.forEach(function(delay, idx) {
    setTimeout(function() {
      if (idx > 0) document.getElementById('ca-step-' + (idx - 1)).classList.replace('active', 'done');
      document.getElementById('ca-step-' + idx).classList.add('active');
    }, delay);
  });

  // Extract text from PDF client-side using pdf.js
  try {
    var text = await caExtractPdfText(caFileData);
    if (!text || text.trim().length < 50) {
      document.getElementById('ca-loading').style.display = 'none';
      document.getElementById('ca-preview-area').style.display = 'block';
      showModalAlert('Cannot Read', 'Could not extract text from this PDF. It may be a scanned document or image-only PDF. Text found: ' + (text ? text.trim().length : 0) + ' characters.');
      return;
    }

    var response = await fetch('/api/ai-contract', {
      method: 'POST',
      headers: getAIHeaders(),
      body: JSON.stringify({ text: text })
    });
    var data = await response.json();

    // Complete all steps
    for (var j = 0; j < 5; j++) {
      document.getElementById('ca-step-' + j).classList.remove('active');
      document.getElementById('ca-step-' + j).classList.add('done');
    }

    setTimeout(function() {
      document.getElementById('ca-loading').style.display = 'none';
      if (data.error) {
        showModalAlert('Error', data.error);
        document.getElementById('ca-preview-area').style.display = 'block';
        return;
      }
      caRenderResults(data.result);
    }, 600);

  } catch (err) {
    console.error('Contract analysis error:', err);
    document.getElementById('ca-loading').style.display = 'none';
    document.getElementById('ca-preview-area').style.display = 'block';
    showModalAlert('Error', 'Failed to analyze contract: ' + (err.message || 'Unknown error') + '. Please try again.');
  }
}

async function caExtractPdfText(file) {
  // Load pdf.js if not already loaded
  if (!window.pdfjsLib) {
    await new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  }

  var arrayBuffer = await file.arrayBuffer();
  var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  var text = '';
  var maxPages = Math.min(pdf.numPages, 20);
  for (var i = 1; i <= maxPages; i++) {
    var page = await pdf.getPage(i);
    var content = await page.getTextContent();
    text += content.items.map(function(item) { return item.str; }).join(' ') + '\n\n';
  }
  return text;
}

function caRenderResults(r) {
  function field(label, value) {
    return '<div class="ds-s-c9146c">'
      + '<div class="ds-s-6f2bd3">' + label + '</div>'
      + '<div class="deal-s-8cb67d">' + escapeHtml(value || 'Not specified') + '</div>'
      + '</div>';
  }

  function section(title, icon, content) {
    return '<div class="ds-s-00f3d0">'
      + '<div class="ds-s-74f23c">' + icon + ' ' + title + '</div>'
      + content
      + '</div>';
  }

  // Parties
  var partiesHtml = field('Brand', r.parties?.brand) + field('Creator', r.parties?.creator);

  // Payment
  var paymentHtml = field('Amount', r.payment?.amount) + field('Schedule', r.payment?.schedule) + field('Kill Fee', r.payment?.kill_fee);

  // Deliverables
  var deliverablesHtml = (r.deliverables || []).map(function(d, i) {
    return '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;' + (i < (r.deliverables.length - 1) ? 'border-bottom:1px solid var(--border);' : '') + '">'
      + '<span class="ds-s-d4c078">' + (i + 1) + '.</span>'
      + '<span class="deal-s-8cb67d">' + escapeHtml(d) + '</span>'
      + '</div>';
  }).join('');

  // Timeline
  var timelineHtml = field('Start Date', r.timeline?.start_date) + field('End Date', r.timeline?.end_date) + field('Content Deadline', r.timeline?.content_deadline) + field('Review Period', r.timeline?.review_period);

  // Usage Rights
  var usageHtml = field('Summary', r.usage_rights?.summary) + field('Duration', r.usage_rights?.duration) + field('Platforms', r.usage_rights?.platforms);

  // Exclusivity
  var exclColor = r.exclusivity?.has_exclusivity ? '#fbbf24' : '#4ade80';
  var exclHtml = '<div class="ds-s-9b7c22">'
    + '<div class="ds-s-6f2bd3">Status</div>'
    + '<div style="font-size:13px;font-weight:600;color:' + exclColor + ';">' + (r.exclusivity?.has_exclusivity ? '⚠ Exclusivity clause found' : '✓ No exclusivity') + '</div>'
    + '</div>'
    + field('Details', r.exclusivity?.details)
    + field('Duration', r.exclusivity?.duration);

  // Ownership + Termination
  var otherHtml = field('Content Ownership', r.content_ownership) + field('Termination', r.termination);

  // Red flags
  var redFlagsHtml = (r.red_flags || []).length > 0
    ? (r.red_flags || []).map(function(f) {
      return '<div class="ds-s-224164">'
        + '<span class="ds-s-c2b2c8">⚠</span>'
        + '<span class="deal-s-8cb67d">' + escapeHtml(f) + '</span>'
        + '</div>';
    }).join('')
    : '<div class="ds-s-50a145">✓ No major red flags detected</div>';

  // Misc details
  var miscHtml = (r.misc_details || []).length > 0
    ? (r.misc_details || []).map(function(d) {
      return '<div class="ds-s-224164">'
        + '<span class="ds-s-d90bc1">•</span>'
        + '<span class="deal-s-8cb67d">' + escapeHtml(d) + '</span>'
        + '</div>';
    }).join('')
    : '<div class="ds-s-c52853">No additional details noted.</div>';

  var html = ''
    // Overall assessment
    + '<div class="ds-s-a14710">'
    + '<div class="ds-s-7fd4a0">Overall Assessment</div>'
    + '<div class="ds-s-057df1">' + escapeHtml(r.overall_assessment || '') + '</div>'
    + '</div>'

    + section('Parties', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', partiesHtml)
    + section('Payment', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>', paymentHtml)
    + section('Deliverables', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>', deliverablesHtml)
    + section('Timeline', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>', timelineHtml)
    + section('Usage Rights', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>', usageHtml)
    + section('Exclusivity', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>', exclHtml)
    + section('Ownership & Termination', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', otherHtml)
    + section('Red Flags', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>', redFlagsHtml)
    + section('Other Details', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>', miscHtml)

    // Disclaimer + actions
    + '<div class="ds-s-288a4b">This analysis is AI-generated and is not legal advice. Always consult a qualified lawyer before signing contracts.</div>'
    + '<div class="ds-s-6b00e7">'
    + '<button data-ds-action="window-print" class="ds-s-4ff341">Print Report</button>'
    + '<button data-contract-action="reset" class="ds-s-35389e">Analyze another</button>'
    + '</div>';

  var resultsEl = document.getElementById('ca-results');
  resultsEl.innerHTML = html;
  resultsEl.style.display = 'block';
}


// =============================================================================
// ACTION REGISTRATIONS
// =============================================================================

contractRegisterAction('start-checkout', (e, el) => startCheckout(el.dataset.contractPlan || 'monthly', el));
contractRegisterAction('trigger-upload', () => {
  var input = document.getElementById('ca-file-input');
  if (input) input.click();
});
contractRegisterAction('handle-upload', (e, el) => caHandleUpload(el));
contractRegisterAction('analyze', () => caAnalyze());
contractRegisterAction('reset', () => caReset());
