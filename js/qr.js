// =============================================================================
// /js/qr.js — QR Code Generator (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the QR Code Generator tool. Two modes: a Link mode (any
// URL becomes a QR code) and a vCard mode (contact card QR with name/phone/
// email/etc). Unlimited for all users. Pro gets custom foreground/background
// colors; Free is locked to the default black-on-white.
//
// Uses the QRious library, loaded on-demand from cdnjs the first time the
// user opens the tool or generates a QR (loadQRLibrary defers the script
// fetch so first-paint of the dashboard isn't affected).
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/qr.js
//   • Phase 2: inline onclick/oninput/onkeydown/onfocus/onblur →
//     data-qr-action attributes
//   • Phase 3: static inline style="..." → hash-named CSS classes
//
// External dependencies on window: sb, currentUser, isPro, escapeHtml,
// showModalAlert, plus QRious (loaded by loadQRLibrary on demand).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE
// =============================================================================

const qrActions = {};

function qrRegisterAction(action, handler) {
  qrActions[action] = handler;
}

function qrFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['qrAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.qrAction) {
        const wantEvent = el.dataset.qrEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.qrAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function qrDispatchEvent(event) {
  const found = qrFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = qrActions[found.action];
  if (!handler) {
    console.warn('[qr] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur', 'keydown'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, qrDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 12314-12502 (QR Code Generator) ----------
// ════════════════════════════════════════════
// QR CODE GENERATOR
// ════════════════════════════════════════════
// Unlimited for all users. Pro still gets custom foreground/background
// colors; Free is locked to black-on-white. Previously had a daily cap
// of 3 for free; that's been removed pre-launch — count-based gating
// added friction without driving conversions in proportion. Color
// customization remains the Pro differentiator.

let qrCurrentTab = 'link';

function switchQRTab(tab) {
  qrCurrentTab = tab;
  document.getElementById('qr-mode-link').style.display = tab === 'link' ? 'block' : 'none';
  document.getElementById('qr-mode-vcard').style.display = tab === 'vcard' ? 'block' : 'none';
  const linkBtn = document.getElementById('qr-tab-link');
  const vcardBtn = document.getElementById('qr-tab-vcard');
  if (tab === 'link') {
    linkBtn.style.background = 'var(--accent)'; linkBtn.style.color = '#fff';
    vcardBtn.style.background = 'transparent'; vcardBtn.style.color = 'var(--muted)';
  } else {
    vcardBtn.style.background = 'var(--accent)'; vcardBtn.style.color = '#fff';
    linkBtn.style.background = 'transparent'; linkBtn.style.color = 'var(--muted)';
  }
  // Reset preview
  document.getElementById('qr-preview-area').style.display = 'none';
  document.getElementById('qr-empty').style.display = 'block';
  document.getElementById('qr-empty').textContent = tab === 'link' ? 'Type a URL above to generate your QR code' : 'Fill in the fields above to generate a contact card QR';
}

function buildVCardString() {
  const first = (document.getElementById('qr-vc-first').value || '').trim();
  const last = (document.getElementById('qr-vc-last').value || '').trim();
  const phone = (document.getElementById('qr-vc-phone').value || '').trim();
  const email = (document.getElementById('qr-vc-email').value || '').trim();
  const website = (document.getElementById('qr-vc-website').value || '').trim();
  const company = (document.getElementById('qr-vc-company').value || '').trim();
  const title = (document.getElementById('qr-vc-title').value || '').trim();
  const address = (document.getElementById('qr-vc-address').value || '').trim();
  const instagram = (document.getElementById('qr-vc-instagram').value || '').trim();
  const tiktok = (document.getElementById('qr-vc-tiktok').value || '').trim();
  const youtube = (document.getElementById('qr-vc-youtube').value || '').trim();
  const linkedin = (document.getElementById('qr-vc-linkedin').value || '').trim();
  const twitter = (document.getElementById('qr-vc-twitter').value || '').trim();
  const facebook = (document.getElementById('qr-vc-facebook').value || '').trim();
  const note = (document.getElementById('qr-vc-note').value || '').trim();
  if (!first && !last) return null;
  let vcard = 'BEGIN:VCARD\nVERSION:3.0\n';
  vcard += 'N:' + last + ';' + first + ';;;\n';
  vcard += 'FN:' + (first + ' ' + last).trim() + '\n';
  if (company) vcard += 'ORG:' + company + '\n';
  if (title) vcard += 'TITLE:' + title + '\n';
  if (phone) vcard += 'TEL;TYPE=CELL:' + phone + '\n';
  if (email) vcard += 'EMAIL:' + email + '\n';
  if (website) vcard += 'URL:' + website + '\n';
  if (address) vcard += 'ADR;TYPE=HOME:;;' + address + ';;;;\n';
  if (instagram) vcard += 'URL;TYPE=Instagram:' + instagram + '\n';
  if (tiktok) vcard += 'URL;TYPE=TikTok:' + tiktok + '\n';
  if (youtube) vcard += 'URL;TYPE=YouTube:' + youtube + '\n';
  if (linkedin) vcard += 'URL;TYPE=LinkedIn:' + linkedin + '\n';
  if (twitter) vcard += 'URL;TYPE=X:' + twitter + '\n';
  if (facebook) vcard += 'URL;TYPE=Facebook:' + facebook + '\n';
  if (note) vcard += 'NOTE:' + note.replace(/\n/g, ' ') + '\n';
  vcard += 'END:VCARD';
  return vcard;
}

function generateVCardQR() {
  const vcard = buildVCardString();
  if (!vcard) {
    showDashToast('error', 'Please enter at least a first or last name.');
    return;
  }
  if (typeof QRious === 'undefined') {
    loadQRLibrary(() => renderQRCanvas(vcard));
  } else {
    renderQRCanvas(vcard);
  }
}

function initQRGenerator() {
  const pro = isPro();
  // Pro gets foreground/background color pickers. Free is locked to the
  // default black-on-white but otherwise has no usage cap.
  if (pro) document.getElementById('qr-pro-options').style.display = 'grid';
  document.getElementById('qr-fg-color')?.addEventListener('input', function() {
    document.getElementById('qr-fg-hex').textContent = this.value.toUpperCase();
    previewQR();
  });
  document.getElementById('qr-bg-color')?.addEventListener('input', function() {
    document.getElementById('qr-bg-hex').textContent = this.value.toUpperCase();
    previewQR();
  });
}

function generateQR() {
  let text;
  if (qrCurrentTab === 'vcard') {
    text = buildVCardString();
    if (!text) {
      document.getElementById('qr-preview-area').style.display = 'none';
      document.getElementById('qr-empty').style.display = 'block';
      return;
    }
  } else {
    text = document.getElementById('qr-text').value.trim();
    if (!text) {
      document.getElementById('qr-preview-area').style.display = 'none';
      document.getElementById('qr-empty').style.display = 'block';
      return;
    }
  }
  // Load library if not loaded yet
  if (typeof QRious === 'undefined') {
    loadQRLibrary(() => renderQRCanvas(text));
  } else {
    renderQRCanvas(text);
  }
}

function renderQRCanvas(text) {
  const pro = isPro();
  const fg = pro ? (document.getElementById('qr-fg-color')?.value || '#000000') : '#000000';
  const bg = pro ? (document.getElementById('qr-bg-color')?.value || '#ffffff') : '#ffffff';
  const canvas = document.getElementById('qr-canvas');
  try {
    new QRious({
      element: canvas,
      value: text,
      size: 256,
      foreground: fg,
      background: bg,
      level: 'H'
    });
    document.getElementById('qr-empty').style.display = 'none';
    document.getElementById('qr-preview-area').style.display = 'block';
  } catch(e) {
    console.error('QR error:', e);
  }
}

function downloadQR() {
  var hasContent = false;
  if (qrCurrentTab === 'vcard') {
    hasContent = !!buildVCardString();
  } else {
    hasContent = !!document.getElementById('qr-text').value.trim();
  }
  if (!hasContent) return;
  const canvas = document.getElementById('qr-canvas');
  const dataUrl = canvas.toDataURL('image/png');

  // Native app: WKWebView does not support the anchor download attribute,
  // so the PNG goes across the bridge to the iOS save/share sheet. Covers
  // both link and contact card QR codes (same canvas, same path).
  if (window.RyxaNative && window.ReactNativeWebView) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'saveFile',
        filename: 'qrcode.png',
        mime: 'image/png',
        base64: dataUrl.split(',')[1] || ''
      }));
    } catch (e) { console.error('qr bridge', e); }
    return;
  }

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'qrcode.png';
  a.click();
}

function clearQR() {
  // Clear link input
  document.getElementById('qr-text').value = '';
  // Clear all vCard fields
  ['qr-vc-first','qr-vc-last','qr-vc-phone','qr-vc-email','qr-vc-website','qr-vc-company','qr-vc-title','qr-vc-address','qr-vc-instagram','qr-vc-tiktok','qr-vc-youtube','qr-vc-linkedin','qr-vc-twitter','qr-vc-facebook'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var noteEl = document.getElementById('qr-vc-note');
  if (noteEl) noteEl.value = '';
  // Hide preview, show empty message
  document.getElementById('qr-preview-area').style.display = 'none';
  document.getElementById('qr-empty').style.display = 'block';
}

// ---------- loadQRLibrary (was at dashboard.html L12809, mis-placed there) ----------
function loadQRLibrary(callback) {
  if (typeof QRious !== 'undefined') { if (callback) callback(); return; }
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js';
  // TODO: add integrity hash per memory rule #19. Fetch from srihash.org:
  //   https://www.srihash.org/?url=https%3A%2F%2Fcdnjs.cloudflare.com%2Fajax%2Flibs%2Fqrious%2F4.0.2%2Fqrious.min.js
  // Then set: script.integrity = 'sha384-...'; script.crossOrigin = 'anonymous';
  script.onload = () => { if (callback) callback(); };
  script.onerror = () => console.error('Failed to load QR library');
  document.head.appendChild(script);
}

// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Tab switching
qrRegisterAction('switch-tab', (e, el) => switchQRTab(el.dataset.qrTab));

// Generate
qrRegisterAction('generate', () => generateQR());
qrRegisterAction('generate-vcard', () => generateVCardQR());

// vCard fields — call generateQR on each input to live-update (this matches
// the original behavior; note that generateQR also reads link-mode input,
// but it's a no-op if the mode is vcard / fields are empty)
qrRegisterAction('enter-generate', (e) => {
  if (e.key === 'Enter') generateQR();
});

// URL input focus/blur — preserves original behavior of changing the border
// color on focus. Ideally this would be a CSS :focus rule, but preserving
// behavior 1:1 here. Left for future cleanup.
qrRegisterAction('focus-border', (e, el) => {
  el.style.borderColor = 'var(--accent)';
});
qrRegisterAction('blur-border', (e, el) => {
  el.style.borderColor = 'var(--border-hover)';
});

// Download / clear
qrRegisterAction('download', () => downloadQR());
qrRegisterAction('clear', () => clearQR());

