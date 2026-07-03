// =============================================================================
// /js/coaching.js — 1:1 Booking (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the 1:1 Booking tool (formerly "Coaching", Max tier).
// Extracted from dashboard.html for stricter CSP and easier maintenance.
//
// Note: internal naming (functions, vars, DB tables) still uses "coaching" /
// "Coaching" / "coaching_services" prefix for SEO/URL preservation per memory
// rule. User-facing surfaces say "1:1 Booking".
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/coaching.js
//   • Phase 2: replaced inline onclick/oninput/etc with data-coach-action
//     attributes + delegated event handlers (CSP-strict)
//   • Phase 3: replaced inline class="bio-s-6eae3a" attributes with hash-named CSS
//     classes in dashboard.html's <style> block (CSP-strict)
//
// External dependencies remain on window (sb, Auth, currentUser, isMax,
// escapeHtml, showModalAlert, showModalConfirm, formatMoney, etc).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE (parallel of bio/mk/course)
// =============================================================================

const coachActions = {};

function coachRegisterAction(action, handler) {
  coachActions[action] = handler;
}

function coachFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['coachAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.coachAction) {
        const wantEvent = el.dataset.coachEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.coachAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function coachDispatchEvent(event) {
  const found = coachFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = coachActions[found.action];
  if (!handler) {
    console.warn('[coach] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur', 'keydown', 'mouseover', 'mouseout'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, coachDispatchEvent, useCapture);
});

// =============================================================================
// CSP-STRICT STYLE APPLICATION (Phase 3)
// =============================================================================
const COACH_DATA_STYLE_MAP = {
  bg: 'background', color: 'color', border: 'border', shadow: 'box-shadow',
  padding: 'padding', radius: 'border-radius', display: 'display', fontFamily: 'font-family',
};

function coachApplyDataStyles(root) {
  root = root || document;
  const selectors = Object.keys(COACH_DATA_STYLE_MAP)
    .map(k => `[data-coach-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}]`)
    .join(',');
  const els = root.querySelectorAll(selectors);
  els.forEach(el => {
    Object.entries(COACH_DATA_STYLE_MAP).forEach(([camelName, cssProp]) => {
      const val = el.dataset['coach' + camelName.charAt(0).toUpperCase() + camelName.slice(1)];
      if (val) el.style.setProperty(cssProp, val);
    });
  });
}

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 13475-13478 (Coaching state) ----------
let coachingList = [];
let currentCoachingId = null;
let coachingCoverFile = null;
let coachingBookingType = 'manual';

// ---------- From dashboard.html lines 13480-14028 (Coaching functions) ----------
function initCoachingTool() {
  const max = isMax();
  document.getElementById('coaching-upsell').style.display = max ? 'none' : 'block';
  document.getElementById('coaching-list-view').style.display = max ? 'block' : 'none';
  document.getElementById('coaching-editor-view').style.display = 'none';
  if (max) loadCoachingList();
}

async function loadCoachingList() {
  const { data, error } = await sb.from('coaching_services').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if (error) { console.error('Failed to load coaching:', error); return; }
  coachingList = data || [];

  for (var i = 0; i < coachingList.length; i++) {
    var c = coachingList[i];
    var { count } = await sb.from('coaching_bookings').select('id', { count: 'exact', head: true }).eq('coaching_id', c.id);
    c._bookings = count || 0;
  }

  renderCoachingList();
}

function renderCoachingList() {
  const grid = document.getElementById('coaching-grid');
  const empty = document.getElementById('coaching-empty');
  if (coachingList.length === 0) {
    grid.innerHTML = '';
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = coachingList.map(c => {
    const statusColor = c.status === 'published' ? '#4ade80' : '#fbbf24';
    const statusLabel = c.status.charAt(0).toUpperCase() + c.status.slice(1);
    const price = c.price_cents === 0 ? 'Free' : formatMoney(c.price_cents, {alwaysShowCents:true});
    const coverBg = c.cover_image_path
      ? 'background-image:url(' + sb.storage.from("coaching-covers").getPublicUrl(c.cover_image_path).data.publicUrl + ');background-size:cover;background-position:center;'
      : 'background:linear-gradient(135deg,rgba(124,58,237,0.15),rgba(232,121,249,0.1));display:flex;align-items:center;justify-content:center;';
    const bookingLabel = c.booking_type === 'ryxa_calendar' ? 'Ryxa Calendar' : (c.booking_type === 'calendly' ? 'Scheduling Link' : 'Manual');
    return '<div data-coach-action="open-editor" data-coach-id="' + escapeHtml(c.id) + '" class="coach-card-clickable course-s-259ee6">'
      + '<div style="height:140px;' + coverBg + '">' + (c.cover_image_path ? '' : '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>') + '</div>'
      + '<div class="course-s-4680c6">'
      + '<div class="course-s-c420c8">' + escapeHtml(c.title || 'Untitled Service') + '</div>'
      + '<div class="course-s-3522d7">'
      + '<span style="font-size:12px;color:' + statusColor + ';font-weight:600;">' + statusLabel + '</span>'
      + '<span class="course-s-b78524">' + price + '</span>'
      + '</div>'
      + '<div class="bio-s-5f3468">Total Bookings: ' + (c._bookings || 0) + ' · ' + bookingLabel + '</div>'
      + '</div></div>';
  }).join('');
}

function openCoachingEditor(coachingId) {
  document.getElementById('coaching-list-view').style.display = 'none';
  document.getElementById('coaching-editor-view').style.display = 'block';
  currentCoachingId = coachingId || null;
  coachingCoverFile = null;

  // Reset fields
  document.getElementById('coaching-id').value = '';
  document.getElementById('coaching-title-input').value = '';
  document.getElementById('coaching-slug-input').value = '';
  document.getElementById('coaching-desc-input').value = '';
  document.getElementById('coaching-price-input').value = '';
  document.getElementById('coaching-calendly-input').value = '';
  document.getElementById('coaching-duration-input').value = '30';
  var mdInput = document.getElementById('coaching-meeting-details-input');
  if (mdInput) mdInput.value = '';
  document.getElementById('coaching-cover-preview').style.display = 'none';
  document.getElementById('coaching-cover-img').src = '';
  var uploadBtn = document.getElementById('coaching-cover-upload-btn');
  if (uploadBtn) uploadBtn.style.display = 'flex';
  document.getElementById('coaching-danger-zone').style.display = 'none';
  document.getElementById('coaching-publish-btn').style.display = 'none';
  document.getElementById('coaching-editor-msg').style.display = 'none';
  document.getElementById('coaching-marketplace-toggle').style.display = 'none';
  updateMarketplaceToggleUI('coaching', false);
  loadAvailabilityIntoUI(null); // reset to defaults
  setCoachingBookingType('ryxa_calendar');

  if (coachingId) {
    document.getElementById('coaching-editor-title').textContent = 'Edit Service';
    const coaching = coachingList.find(c => c.id === coachingId);
    if (!coaching) return;
    document.getElementById('coaching-id').value = coaching.id;
    document.getElementById('coaching-title-input').value = coaching.title || '';
    document.getElementById('coaching-slug-input').value = coaching.slug || '';
    var slugNoticeEdit = document.getElementById('coaching-slug-notice');
    if (slugNoticeEdit) slugNoticeEdit.textContent = 'This URL is permanently locked and cannot be changed.';
    document.getElementById('coaching-desc-input').value = coaching.description || '';
    document.getElementById('coaching-price-input').value = coaching.price_cents ? (coaching.price_cents / 100).toString() : '';
    document.getElementById('coaching-calendly-input').value = coaching.calendly_url || '';
    document.getElementById('coaching-duration-input').value = coaching.duration_minutes ? String(coaching.duration_minutes) : '30';
    var mdInputLoad = document.getElementById('coaching-meeting-details-input');
    if (mdInputLoad) mdInputLoad.value = coaching.meeting_details || '';
    loadAvailabilityIntoUI(coaching.availability_settings);
    setCoachingBookingType(coaching.booking_type || 'manual');

    if (coaching.cover_image_path) {
      const url = sb.storage.from('coaching-covers').getPublicUrl(coaching.cover_image_path).data.publicUrl;
      document.getElementById('coaching-cover-img').src = url;
      document.getElementById('coaching-cover-preview').style.display = 'block';
      if (uploadBtn) uploadBtn.style.display = 'none';
    }

    const pubBtn = document.getElementById('coaching-publish-btn');
    pubBtn.style.display = 'inline-block';
    if (coaching.status === 'published') {
      pubBtn.textContent = 'Unpublish';
      pubBtn.style.borderColor = 'rgba(239,68,68,0.4)';
      pubBtn.style.color = '#ef4444';
      document.getElementById('coaching-marketplace-toggle').style.display = 'block';
      updateMarketplaceToggleUI('coaching', !!coaching.listed_in_marketplace);
      updateMarketplaceCountDisplay();
    } else {
      pubBtn.textContent = 'Publish';
      pubBtn.style.borderColor = 'rgba(74,222,128,0.4)';
      pubBtn.style.color = '#4ade80';
    }

    document.getElementById('coaching-danger-zone').style.display = 'block';
  } else {
    document.getElementById('coaching-editor-title').textContent = 'New Service';
    var slugNoticeNew = document.getElementById('coaching-slug-notice');
    if (slugNoticeNew) slugNoticeNew.textContent = 'This URL is generated from your title and locked permanently once saved.';
  }

  // Auto-generate slug from title
  document.getElementById('coaching-title-input').oninput = function(e) {
    if (!currentCoachingId) {
      document.getElementById('coaching-slug-input').value = generateSlug(e.target.value);
    }
  };

  // Mount the rich-text description editor. Reuses course.js's
  // ensureQuillLoaded + sanitizeDescriptionHtml (course.js loads earlier
  // in dashboard.html). The hidden textarea was already populated above
  // and Quill picks up that content on mount.
  mountCoachingDescEditor().catch(function(err) {
    console.warn('Coaching description editor failed to mount:', err);
  });
}

function closeCoachingEditor() {
  unmountCoachingDescEditor();
  document.getElementById('coaching-editor-view').style.display = 'none';
  document.getElementById('coaching-list-view').style.display = 'block';
  currentCoachingId = null;
  renderCoachingList();
}

// =====================================================
// COACHING DESCRIPTION RICH-TEXT EDITOR
// =====================================================
// Mirrors the course/product description editor pattern. Reuses course.js's
// ensureQuillLoaded + sanitizeDescriptionHtml globals (course.js loads
// before coaching.js on the dashboard). The Quill editor mounts into a
// FRESH child div appended to the host on every mount, and unmount removes
// that child entirely. This guarantees a clean DOM on every re-entry and
// prevents the stacking-editor bug we hit with the persistent-host pattern.

var _coachingDescQuill = null;
var _coachingDescSyncInProgress = false;
var COACHING_DESC_MAX_HTML = 3000;
// Max <img> embeds in a single booking description. Same cap as course
// descriptions; booking descriptions are short marketing copy, image-heavy
// pages slow the public landing TTFB which directly affects conversion.
var MAX_COACHING_DESC_IMAGES = 6;

async function mountCoachingDescEditor() {
  // Always unmount first so the host is guaranteed empty.
  unmountCoachingDescEditor();

  var host = document.getElementById('coaching-desc-editor');
  var textarea = document.getElementById('coaching-desc-input');
  if (!host || !textarea) return null;

  // Capture scroll position before mounting. Quill's clipboard.dangerouslyPasteHTML
  // (called below to load existing content) moves the selection cursor into
  // the editor, which can trigger the browser to auto-scroll the description
  // into view. We restore scroll after content load so the user lands at the
  // top of the form when opening the editor, not partway down at the
  // description.
  var savedScrollY = window.scrollY || window.pageYOffset || 0;
  var scrollContainer = document.getElementById('coaching-editor-view');
  var savedContainerScroll = scrollContainer ? scrollContainer.scrollTop : 0;

  if (typeof ensureQuillLoaded !== 'function') {
    console.warn('ensureQuillLoaded not available; course.js must load before coaching.js.');
    return null;
  }
  await ensureQuillLoaded();
  if (typeof Quill === 'undefined') return null;

  // After the await, user may have closed/reopened. Wipe again to be safe.
  host.innerHTML = '';
  // Create a fresh inner div and mount Quill into THAT, not the host
  // directly. Mirrors the working lesson editor pattern. Unmount removes
  // this child, guaranteeing the host stays empty between mounts.
  var mountTarget = document.createElement('div');
  host.appendChild(mountTarget);

  // Patch Quill's Link sanitize to auto-prepend https:// for scheme-less
  // URLs. Idempotency guard handles the case where course.js already patched.
  try {
    var Link = Quill.import('formats/link');
    if (Link && !Link._ryxaSanitizePatched) {
      var origSanitize = Link.sanitize;
      Link.sanitize = function(url) {
        var u = String(url || '').trim();
        if (/^(https?:|mailto:|tel:|#)/i.test(u)) return origSanitize.call(this, u);
        if (!u) return origSanitize.call(this, u);
        return origSanitize.call(this, 'https://' + u);
      };
      Link._ryxaSanitizePatched = true;
    }
  } catch (e) {
    console.warn('Could not patch Quill link sanitizer:', e);
  }

  // Same toolbar as courses/products: emphasis, lists, headings (H2/H3
  // only), links, and images. The image button routes through the same
  // compressLessonImage + course-images bucket pipeline used by the
  // course-description and lesson editors. Default image size is "small";
  // creator clicks the image to use the S/M/L toolbar. Bucket is shared
  // across courses, products, and booking descriptions for simplicity.
  var quill = new Quill(mountTarget, {
    theme: 'snow',
    placeholder: 'Describe what the buyer will get. What will you cover? What should they prepare?',
    modules: {
      toolbar: {
        container: [
          [{ 'header': [2, 3, false] }],
          ['bold', 'italic', 'underline'],
          [{ 'list': 'ordered' }, { 'list': 'bullet' }],
          ['link', 'image']
        ],
        handlers: {
          image: function() {
            var imgCount = (typeof countQuillImages === 'function') ? countQuillImages(quill) : 0;
            if (imgCount >= MAX_COACHING_DESC_IMAGES) {
              showModalAlert('Image limit reached', 'You can add up to ' + MAX_COACHING_DESC_IMAGES + ' images per booking description. Remove one before adding another.');
              return;
            }
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async function() {
              var file = input.files && input.files[0];
              if (!file) return;
              if (!file.type.startsWith('image/')) { showModalAlert('Invalid File', 'Please upload an image file.'); return; }
              try {
                var blob = await compressLessonImage(file);
                if (!blob) throw new Error('Compression failed');
                var path = currentUser.id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.webp';
                var upRes = await sb.storage.from('course-images').upload(path, blob, { contentType: 'image/webp', upsert: false });
                if (upRes.error) throw upRes.error;
                var urlData = sb.storage.from('course-images').getPublicUrl(path);
                var range = quill.getSelection(true);
                quill.insertEmbed(range.index, 'image', urlData.data.publicUrl, 'user');
                quill.setSelection(range.index + 1, 0);
                // Tag the new image with the default size class and empty alt.
                // The DOMPurify hook backstops the alt on save, but we set it
                // here so the editor DOM matches the persisted shape immediately.
                setTimeout(function() {
                  var imgs = quill.root.querySelectorAll('img');
                  var lastImg = imgs[imgs.length - 1];
                  if (lastImg) {
                    if (!lastImg.classList.contains('lesson-img-size-small') && !lastImg.classList.contains('lesson-img-size-medium') && !lastImg.classList.contains('lesson-img-size-large')) {
                      lastImg.classList.add('lesson-img-size-large');
                    }
                    if (!lastImg.hasAttribute('alt')) lastImg.setAttribute('alt', '');
                    // Force a sync to textarea so the class/alt persist
                    // (text-change already fired before we added the class).
                    var html = sanitizeDescriptionHtml(quill.root.innerHTML);
                    if (html === '<p><br></p>') html = '';
                    _coachingDescSyncInProgress = true;
                    textarea.value = html;
                    _coachingDescSyncInProgress = false;
                    updateCoachingDescCounter(html.length);
                  }
                }, 50);
              } catch (e) {
                console.error('Booking description image upload error:', e);
                showModalAlert('Upload Failed', 'Could not upload image. Please try again.');
              }
            };
            input.click();
          }
        }
      }
    }
  });

  // WCAG: label Quill's toolbar buttons + hidden header <select> + link
  // tooltip input. Shared helper defined in course.js so behavior matches
  // across all description editors.
  if (typeof window.applyQuillA11yLabels === 'function') {
    window.applyQuillA11yLabels(quill.root);
  }

  // Block <img> embeds from paste/drop. Only the toolbar image button can
  // add images, which routes through our compress + upload pipeline with
  // a unique filename per upload. Helper defined in course.js. Without this,
  // pasted images would either land as fragile external URLs, base64 bloat,
  // or duplicate references to existing storage objects.
  if (typeof stripPastedImages === 'function') stripPastedImages(quill);

  // Initialize from the textarea content (already set by openCoachingEditor).
  var initialHtml = textarea.value || '';
  if (initialHtml) {
    var cleanInit = sanitizeDescriptionHtml(initialHtml);
    if (cleanInit && cleanInit.trim()) {
      if (typeof withImagesAllowed === 'function') {
        withImagesAllowed(quill, function() {
          quill.clipboard.dangerouslyPasteHTML(cleanInit);
        });
      } else {
        quill.clipboard.dangerouslyPasteHTML(cleanInit);
      }
    } else {
      quill.setText(initialHtml);
    }
  }

  // Re-apply image size classes after the seed paste. Quill 1.x treats <img>
  // as an Embed blot, and dangerouslyPasteHTML doesn't reliably preserve
  // custom classes on embeds. We re-parse the saved HTML and apply size
  // classes back to Quill's rendered DOM so the editor preview matches what
  // the landing page will show.
  if (cleanInit && /<img/i.test(cleanInit)) {
    try {
      var parser = new DOMParser();
      var parsedDoc = parser.parseFromString('<div>' + cleanInit + '</div>', 'text/html');
      var savedImgs = parsedDoc.querySelectorAll('img');
      var quillImgs = quill.root.querySelectorAll('img');
      for (var i = 0; i < quillImgs.length && i < savedImgs.length; i++) {
        var savedCls = savedImgs[i].className || '';
        var sizeMatch = savedCls.match(/\blesson-img-size-(small|medium|large)\b/);
        if (sizeMatch) {
          quillImgs[i].classList.remove('lesson-img-size-small', 'lesson-img-size-medium', 'lesson-img-size-large');
          quillImgs[i].classList.add('lesson-img-size-' + sizeMatch[1]);
        }
      }
    } catch (e) {
      console.warn('Failed to re-apply booking description image size classes after seed:', e);
    }
  }

  // Restore scroll position captured before mount. dangerouslyPasteHTML
  // moves Quill's selection cursor which can auto-scroll the description
  // into view; we don't want that on initial editor open.
  requestAnimationFrame(function() {
    window.scrollTo(0, savedScrollY);
    if (scrollContainer) scrollContainer.scrollTop = savedContainerScroll;
  });

  // Quill -> textarea sync with char-limit + image-cap enforcement.
  // Image-cap is gated on source === 'user' so the initial seed paste
  // (programmatic, source !== 'user') doesn't trip the cap and undo its
  // own work. Catches paste/drag-and-drop that adds images past the cap.
  quill.on('text-change', function(delta, oldDelta, source) {
    if (_coachingDescSyncInProgress) return;

    if (source === 'user') {
      var imgCount = (typeof countQuillImages === 'function') ? countQuillImages(quill) : 0;
      if (imgCount > MAX_COACHING_DESC_IMAGES) {
        _coachingDescSyncInProgress = true;
        try { quill.history.undo(); } catch (e) { /* no history yet */ }
        _coachingDescSyncInProgress = false;
        showModalAlert('Image limit reached', 'You can add up to ' + MAX_COACHING_DESC_IMAGES + ' images per booking description.');
        return;
      }
    }

    var html = sanitizeDescriptionHtml(quill.root.innerHTML);
    if (html === '<p><br></p>') html = '';

    if (html.length > COACHING_DESC_MAX_HTML) {
      _coachingDescSyncInProgress = true;
      try { quill.history.undo(); } catch (e) { /* no history yet */ }
      _coachingDescSyncInProgress = false;
      var counter = document.getElementById('coaching-desc-counter');
      if (counter) {
        counter.textContent = 'Description must be ' + COACHING_DESC_MAX_HTML + ' characters or fewer.';
        counter.style.color = '#ef4444';
      }
      return;
    }

    _coachingDescSyncInProgress = true;
    textarea.value = html;
    _coachingDescSyncInProgress = false;
    updateCoachingDescCounter(html.length);
  });

  // textarea -> Quill sync (AI Cleanup writes back via textarea + input event).
  textarea.addEventListener('input', function() {
    if (_coachingDescSyncInProgress) return;
    _coachingDescSyncInProgress = true;
    var incoming = textarea.value || '';
    if (/<[a-z][^>]*>/i.test(incoming)) {
      quill.setContents([]);
      if (typeof withImagesAllowed === 'function') {
        withImagesAllowed(quill, function() {
          quill.clipboard.dangerouslyPasteHTML(sanitizeDescriptionHtml(incoming));
        });
      } else {
        quill.clipboard.dangerouslyPasteHTML(sanitizeDescriptionHtml(incoming));
      }
    } else {
      quill.setText(incoming);
    }
    _coachingDescSyncInProgress = false;
  });

  // Wire up S/M/L image sizing. Same toolbar widget as the course-desc and
  // lesson editors. Save callback runs when the creator clicks S/M/L (Quill's
  // text-change doesn't fire for class-only attribute changes), syncing the
  // resized HTML through the sanitizer to the textarea.
  if (typeof setupImageSizing === 'function') {
    setupImageSizing(quill, mountTarget, function(rawHtml) {
      var html = sanitizeDescriptionHtml(rawHtml);
      if (html === '<p><br></p>') html = '';
      _coachingDescSyncInProgress = true;
      textarea.value = html;
      _coachingDescSyncInProgress = false;
      updateCoachingDescCounter(html.length);
    });
  }

  _coachingDescQuill = quill;
  updateCoachingDescCounter((textarea.value || '').length);
  return quill;
}

function updateCoachingDescCounter(length) {
  var el = document.getElementById('coaching-desc-counter');
  if (!el) return;
  var remaining = COACHING_DESC_MAX_HTML - length;
  el.textContent = length + ' / ' + COACHING_DESC_MAX_HTML;
  if (length >= COACHING_DESC_MAX_HTML) {
    el.style.color = '#ef4444';
  } else if (remaining < 300) {
    el.style.color = '#fbbf24';
  } else {
    el.style.color = 'var(--muted)';
  }
}

function unmountCoachingDescEditor() {
  // Always clear the host DOM unconditionally. Defends against leftover
  // Quill DOM from a previous mount whose reference was lost.
  try {
    var host = document.getElementById('coaching-desc-editor');
    if (host) host.innerHTML = '';
  } catch (e) { /* non-fatal */ }
  _coachingDescQuill = null;
}

function setCoachingBookingType(type) {
  coachingBookingType = type;
  var ryxaBtn = document.getElementById('coaching-type-ryxa');
  var calBtn = document.getElementById('coaching-type-calendly');
  var manBtn = document.getElementById('coaching-type-manual');
  var ryxaSection = document.getElementById('coaching-ryxa-section');
  var calSection = document.getElementById('coaching-calendly-section');
  var manSection = document.getElementById('coaching-manual-section');

  // Reset all to inactive
  [ryxaBtn, calBtn, manBtn].forEach(function(btn) {
    if (btn) { btn.style.borderColor = 'var(--border-hover)'; btn.style.color = 'var(--muted)'; }
  });

  // Hide all sections
  if (ryxaSection) ryxaSection.style.display = 'none';
  if (calSection) calSection.style.display = 'none';
  if (manSection) manSection.style.display = 'none';

  // Activate selected
  if (type === 'ryxa_calendar') {
    if (ryxaBtn) { ryxaBtn.style.borderColor = 'var(--accent)'; ryxaBtn.style.color = 'var(--text)'; }
    if (ryxaSection) ryxaSection.style.display = 'block';
    renderAvailabilityDays();
  } else if (type === 'calendly') {
    if (calBtn) { calBtn.style.borderColor = 'var(--accent)'; calBtn.style.color = 'var(--text)'; }
    if (calSection) calSection.style.display = 'block';
  } else {
    if (manBtn) { manBtn.style.borderColor = 'var(--accent)'; manBtn.style.color = 'var(--text)'; }
    if (manSection) manSection.style.display = 'block';
  }
}

// Default availability state
var coachingAvailability = {
  duration_minutes: 30,
  buffer_minutes: 0,
  booking_window_days: 14,
  lead_time_hours: 24,
  days: {
    sun: { enabled: false, start: '09:00', end: '17:00' },
    mon: { enabled: true, start: '09:00', end: '17:00' },
    tue: { enabled: true, start: '09:00', end: '17:00' },
    wed: { enabled: true, start: '09:00', end: '17:00' },
    thu: { enabled: true, start: '09:00', end: '17:00' },
    fri: { enabled: true, start: '09:00', end: '17:00' },
    sat: { enabled: false, start: '09:00', end: '17:00' }
  }
};

// Populate the timezone hint shown above the Weekly Availability section.
// Reads the current timezone from (in order): localStorage cache (set by
// calendar.js when the creator changes it there), browser auto-detect as
// fallback. Includes a link to switch to the Calendar tool where the
// timezone selector lives. Single source of truth: the Calendar tool.
function setCoachingTzHint() {
  var el = document.getElementById('coaching-tz-hint');
  if (!el) return;
  // Read tz in order of preference: dashboard-shell global (set by setUser
  // and kept in sync by calChangeTimezoneInline) → localStorage (calendar.js
  // cache) → browser detection. The global is always fresh; the others
  // are safety nets.
  var tz = '';
  try { tz = window._ryx_creator_tz || ''; } catch (e) {}
  if (!tz) {
    try { tz = localStorage.getItem('ryxa_cal_tz') || ''; } catch (e) {}
  }
  if (!tz) {
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  }
  // Display label: drop the IANA continent prefix and append the current
  // UTC offset for confirmation (handles DST automatically via Intl).
  // Example: 'America/Los_Angeles' → 'Los Angeles (UTC−7)'. Mirrors
  // calFormatTzLabel in calendar.js — kept inline to avoid cross-file deps.
  var label = tz;
  if (tz) {
    var idx = tz.lastIndexOf('/');
    var city = (idx >= 0 ? tz.slice(idx + 1) : tz).replace(/_/g, ' ');
    var offset = '';
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, timeZoneName: 'shortOffset'
      }).formatToParts(new Date());
      var tzPart = parts.find(function(p) { return p.type === 'timeZoneName'; });
      if (tzPart) {
        var raw = tzPart.value.replace(/^GMT/, 'UTC');
        offset = (raw === 'UTC') ? 'UTC' : raw.replace('-', '\u2212');
      }
    } catch (e) {}
    label = offset ? (city + ' (' + offset + ')') : city;
  }
  // The body of the hint explains what bookers see + offers a way to change
  // the timezone if the creator picked the wrong one. Link uses the dash
  // tool router (show-tool action) so it switches to Calendar without a
  // page reload. href="#" keeps native <a> keyboard semantics (Enter fires
  // a click event); the show-tool handler in dashboard-shell.js calls
  // preventDefault to stop the hash from being appended.
  el.innerHTML = (tz
    ? 'Times shown in <strong>' + escapeHtml(label) + '</strong>. '
    : '')
    + 'Clients book in their own timezone, Ryxa converts automatically. '
    + '<a href="#" data-dash-action="show-tool" data-dash-tool="calendar" class="coach-s-tz-link">Change in Calendar →</a>';
}

function renderAvailabilityDays() {
  // Keep the timezone hint in sync with each render — covers fresh open,
  // toggling availability days, and any other re-render path.
  setCoachingTzHint();
  var container = document.getElementById('coaching-avail-days');
  if (!container) return;
  var dayKeys = ['sun','mon','tue','wed','thu','fri','sat'];
  var dayLabels = { sun:'Sunday', mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday' };
  container.innerHTML = dayKeys.map(function(k) {
    var d = coachingAvailability.days[k];
    var enabled = d.enabled;
    // Enabled/disabled visual state expressed via a class modifier instead of
    // inline style — CSP-strict. `.coach-avail-row.is-disabled` handles the
    // dimmed bg and reduced opacity on the right pane.
    var rowClass = 'coach-avail-row' + (enabled ? '' : ' is-disabled');
    // Layout: checkbox + day name on the left (fixed width), Start/End pickers
    // stacked vertically on the right. This keeps each row compact even with
    // the 3-spinner picker, and is mobile-friendly without needing media queries.
    return '<div class="' + rowClass + '">'
      + '<label class="coach-s-fd27c0">'
      + '<input type="checkbox" ' + (enabled ? 'checked' : '') + ' data-coach-action="toggle-avail-day" data-coach-event="change" data-coach-day-key="' + k + '" class="coach-s-d73cb1">'
      + '<span class="coach-s-1bd029">' + dayLabels[k] + '</span>'
      + '</label>'
      + '<div class="coach-avail-row-pickers">'
      + '<div class="coach-s-9b120d">'
      + '<span class="coach-s-a65625">Start</span>'
      + calBuildTimePicker('avail-' + k + '-start', d.start, !enabled)
      + '</div>'
      + '<div class="coach-s-9b120d">'
      + '<span class="coach-s-a65625">End</span>'
      + calBuildTimePicker('avail-' + k + '-end', d.end, !enabled)
      + '</div>'
      + '</div>'
      + '</div>';
  }).join('');

  // Wire up change handlers for the new picker dropdowns
  dayKeys.forEach(function(k) {
    ['start', 'end'].forEach(function(which) {
      var prefix = 'avail-' + k + '-' + which;
      ['h', 'm', 'p'].forEach(function(suffix) {
        var el = document.getElementById(prefix + '-' + suffix);
        if (el) {
          el.addEventListener('change', function() {
            var newVal = calReadTimePicker(prefix);
            if (newVal) setAvailTime(k, which, newVal);

            // If the user changed the START time, auto-adjust END time when it's
            // now equal to or before the new start (bumps end to start + 30 min).
            // Won't override end if it's already ahead of start.
            if (which === 'start') {
              var startStr = calReadTimePicker('avail-' + k + '-start');
              var endStr = calReadTimePicker('avail-' + k + '-end');
              if (startStr && endStr) {
                var sP = startStr.split(':').map(Number);
                var eP = endStr.split(':').map(Number);
                var sMins = sP[0] * 60 + sP[1];
                var eMins = eP[0] * 60 + eP[1];
                if (eMins <= sMins) {
                  var newEndMins = sMins + 30;
                  if (newEndMins >= 24 * 60) newEndMins = 23 * 60 + 45;
                  var nh24 = Math.floor(newEndMins / 60);
                  var nm = newEndMins % 60;
                  nm = Math.round(nm / 15) * 15;
                  if (nm === 60) { nm = 0; nh24 = (nh24 + 1) % 24; }
                  var period = nh24 >= 12 ? 'PM' : 'AM';
                  var h12 = nh24 % 12; if (h12 === 0) h12 = 12;
                  var endPrefix = 'avail-' + k + '-end';
                  var hEl = document.getElementById(endPrefix + '-h');
                  var mEl = document.getElementById(endPrefix + '-m');
                  var pEl = document.getElementById(endPrefix + '-p');
                  if (hEl) hEl.value = String(h12);
                  if (mEl) mEl.value = String(nm);
                  if (pEl) pEl.value = period;
                  // Persist the new end value in state too
                  var newEndStr = String(nh24).padStart(2, '0') + ':' + String(nm).padStart(2, '0');
                  setAvailTime(k, 'end', newEndStr);
                }
              }
            }
          });
        }
      });
    });
  });
}

function toggleAvailDay(key, enabled) {
  coachingAvailability.days[key].enabled = enabled;
  renderAvailabilityDays();
}

function setAvailTime(key, which, value) {
  coachingAvailability.days[key][which] = value;
}

function onAvailChanged() {
  var dur = document.getElementById('coaching-duration-input');
  var buf = document.getElementById('coaching-avail-buffer');
  var win = document.getElementById('coaching-avail-window');
  var lead = document.getElementById('coaching-avail-leadtime');
  if (dur) coachingAvailability.duration_minutes = parseInt(dur.value, 10) || 30;
  if (buf) coachingAvailability.buffer_minutes = parseInt(buf.value, 10);
  if (win) coachingAvailability.booking_window_days = parseInt(win.value, 10);
  if (lead) coachingAvailability.lead_time_hours = parseInt(lead.value, 10);
}

function loadAvailabilityIntoUI(avail) {
  if (!avail) avail = {};
  // Merge with defaults
  coachingAvailability = {
    duration_minutes: avail.duration_minutes || 30,
    buffer_minutes: typeof avail.buffer_minutes === 'number' ? avail.buffer_minutes : 0,
    booking_window_days: avail.booking_window_days || 14,
    lead_time_hours: typeof avail.lead_time_hours === 'number' ? avail.lead_time_hours : 24,
    days: avail.days || {
      sun: { enabled: false, start: '09:00', end: '17:00' },
      mon: { enabled: true, start: '09:00', end: '17:00' },
      tue: { enabled: true, start: '09:00', end: '17:00' },
      wed: { enabled: true, start: '09:00', end: '17:00' },
      thu: { enabled: true, start: '09:00', end: '17:00' },
      fri: { enabled: true, start: '09:00', end: '17:00' },
      sat: { enabled: false, start: '09:00', end: '17:00' }
    }
  };
  var buf = document.getElementById('coaching-avail-buffer');
  var win = document.getElementById('coaching-avail-window');
  var lead = document.getElementById('coaching-avail-leadtime');
  if (buf) buf.value = String(coachingAvailability.buffer_minutes);
  if (win) win.value = String(coachingAvailability.booking_window_days);
  if (lead) lead.value = String(coachingAvailability.lead_time_hours);
  renderAvailabilityDays();
}

function showCoachingMsg(type, msg, isHtml) {
  // Delegates to the dashboard's slide-in toast (plain-text messages only).
  // Falls back to the inline banner for any HTML-mode caller.
  if (!isHtml && typeof showDashToast === 'function') {
    showDashToast(type === 'error' ? 'error' : 'success', msg);
    return;
  }
  const el = document.getElementById('coaching-editor-msg');
  el.style.display = 'block';
  el.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(74,222,128,0.1)';
  el.style.color = type === 'error' ? '#f87171' : '#4ade80';
  el.style.border = '1px solid ' + (type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(74,222,128,0.3)');
  if (isHtml) { el.innerHTML = msg; } else { el.textContent = msg; }
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function copyCoachingUrl() {
  var slug = document.getElementById('coaching-slug-input').value;
  if (!slug) return;
  var url = 'https://www.ryxa.io/booking/' + slug;
  navigator.clipboard.writeText(url).then(function() {
    var btn = document.getElementById('coaching-copy-url-btn');
    var orig = btn.innerHTML;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied';
    btn.style.color = '#4ade80';
    setTimeout(function() { btn.innerHTML = orig; btn.style.color = 'var(--muted)'; }, 1500);
  });
}

function onCoachingCoverSelect(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showCoachingMsg('error', 'Image must be under 10MB.'); return; }
  const img = new Image();
  img.onload = function() {
    const MAX_W = 1200, MAX_H = 800;
    let w = img.width, h = img.height;
    if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
    if (h > MAX_H) { w = Math.round(w * MAX_H / h); h = MAX_H; }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    canvas.toBlob(function(blob) {
      if (!blob) { showCoachingMsg('error', 'Failed to process image.'); return; }
      coachingCoverFile = new File([blob], 'cover.jpg', { type: 'image/jpeg' });
      document.getElementById('coaching-cover-img').src = URL.createObjectURL(blob);
      document.getElementById('coaching-cover-preview').style.display = 'block';
      var btn = document.getElementById('coaching-cover-upload-btn');
      if (btn) btn.style.display = 'none';
    }, 'image/jpeg', 0.8);
  };
  img.onerror = function() { showCoachingMsg('error', 'Could not read image file.'); };
  img.src = URL.createObjectURL(file);
}

function removeCoachingCover() {
  coachingCoverFile = null;
  document.getElementById('coaching-cover-preview').style.display = 'none';
  document.getElementById('coaching-cover-file').value = '';
  document.getElementById('coaching-cover-img').src = '';
  var btn = document.getElementById('coaching-cover-upload-btn');
  if (btn) btn.style.display = 'flex';
}

async function saveCoaching() {
  const title = document.getElementById('coaching-title-input').value.trim();
  const slug = document.getElementById('coaching-slug-input').value.trim();
  const description = document.getElementById('coaching-desc-input').value.trim();
  const priceStr = document.getElementById('coaching-price-input').value;
  const priceCents = Math.round(parseFloat(priceStr || '0') * 100);
  const calendlyUrl = document.getElementById('coaching-calendly-input').value.trim();

  if (!title) { showCoachingMsg('error', 'Please enter a service title.'); return; }
  if (!slug) { showCoachingMsg('error', 'URL slug is empty. Please enter a title.'); return; }
  if (coachingBookingType === 'calendly' && !calendlyUrl) { showCoachingMsg('error', 'Please enter your scheduling link.'); return; }
  if (coachingBookingType === 'ryxa_calendar') {
    onAvailChanged();
    var enabledDays = Object.keys(coachingAvailability.days).filter(function(k) { return coachingAvailability.days[k].enabled; });
    if (enabledDays.length === 0) { showCoachingMsg('error', 'Please enable at least one day in your weekly availability.'); return; }
  }

  const btn = document.getElementById('coaching-save-btn');
  btn.disabled = true; btn.textContent = 'Saving...';

  try {
    let coverPath = null;
    if (coachingCoverFile) {
      const path = currentUser.id + '/' + (currentCoachingId || 'new') + '_' + Date.now() + '.jpg';
      const { error: uploadErr } = await sb.storage.from('coaching-covers').upload(path, coachingCoverFile, { upsert: true, contentType: 'image/jpeg' });
      if (uploadErr) throw new Error('Cover upload failed: ' + uploadErr.message);
      coverPath = path;
    }

    const durationMinutes = parseInt(document.getElementById('coaching-duration-input').value) || 30;
    const meetingDetails = (document.getElementById('coaching-meeting-details-input')?.value || '').trim();

    // Read current availability values from inputs before saving
    onAvailChanged();

    const payload = {
      title,
      description: description || null,
      price_cents: priceCents,
      duration_minutes: durationMinutes,
      meeting_details: meetingDetails || null,
      booking_type: coachingBookingType,
      calendly_url: coachingBookingType === 'calendly' ? calendlyUrl : '',
      availability_settings: coachingBookingType === 'ryxa_calendar' ? coachingAvailability : null,
      updated_at: new Date().toISOString()
    };
    if (coverPath) payload.cover_image_path = coverPath;

    if (currentCoachingId) {
      const { error } = await sb.from('coaching_services').update(payload).eq('id', currentCoachingId);
      if (error) throw error;
      const idx = coachingList.findIndex(c => c.id === currentCoachingId);
      if (idx >= 0) Object.assign(coachingList[idx], payload);
    } else {
      payload.user_id = currentUser.id;
      payload.slug = slug;
      payload.status = 'draft';
      const { data, error } = await sb.from('coaching_services').insert(payload).select().single();
      if (error) throw error;
      currentCoachingId = data.id;
      coachingList.unshift(data);
      document.getElementById('coaching-id').value = data.id;
      document.getElementById('coaching-editor-title').textContent = 'Edit Service';
      document.getElementById('coaching-danger-zone').style.display = 'block';
      // Slug is now permanently locked. Update the notice to match courses.
      var slugNoticeSaved = document.getElementById('coaching-slug-notice');
      if (slugNoticeSaved) slugNoticeSaved.textContent = 'This URL is permanently locked and cannot be changed.';
      const pubBtn = document.getElementById('coaching-publish-btn');
      pubBtn.style.display = 'inline-block';
      pubBtn.textContent = 'Publish';
      pubBtn.style.borderColor = 'rgba(74,222,128,0.4)';
      pubBtn.style.color = '#4ade80';
    }

    coachingCoverFile = null;
    showCoachingMsg('success', 'Saved!');
  } catch (err) {
    showCoachingMsg('error', err.message || 'Failed to save.');
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

async function toggleCoachingPublish() {
  if (!currentCoachingId) return;
  const coaching = coachingList.find(c => c.id === currentCoachingId);
  const newStatus = (coaching && coaching.status === 'published') ? 'draft' : 'published';

  if (newStatus === 'published') {
    if (!bioOriginalUsername && !window._ryx_username) {
      showCoachingMsg('error', 'Set up your username in Link in Bio before publishing.');
      return;
    }

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
        + '<p class="course-s-8b98d3">You need to connect your Stripe account before you can publish a paid service.</p>'
        + '<button id="coaching-stripe-settings-btn" class="course-s-6673c3">Go to Settings</button>'
        + '<button id="coaching-stripe-cancel-btn" class="course-s-9f3ba9">Cancel</button>'
        + '</div>';
      document.body.appendChild(stripeOverlay);
      document.getElementById('coaching-stripe-settings-btn').onclick = function() { stripeOverlay.remove(); openSettingsModal(); };
      document.getElementById('coaching-stripe-cancel-btn').onclick = function() { stripeOverlay.remove(); };
      stripeOverlay.onclick = function(e) { if (e.target === stripeOverlay) stripeOverlay.remove(); };
      return;
    }
  }

  const updates = { status: newStatus };
  if (newStatus === 'published') updates.published_at = new Date().toISOString();

  const { error } = await sb.from('coaching_services').update(updates).eq('id', currentCoachingId);
  if (error) { showCoachingMsg('error', 'Failed: ' + error.message); return; }

  if (coaching) coaching.status = newStatus;
  const pubBtn = document.getElementById('coaching-publish-btn');
  if (newStatus === 'published') {
    pubBtn.textContent = 'Unpublish';
    pubBtn.style.borderColor = 'rgba(239,68,68,0.4)';
    pubBtn.style.color = '#ef4444';
    document.getElementById('coaching-marketplace-toggle').style.display = 'block';
    updateMarketplaceCountDisplay();
    showCoachingMsg('success', 'Published! Landing page: ryxa.io/booking/' + (coaching?.slug || '') + ' <button data-coach-action="copy-publish-url" data-coach-url="https://ryxa.io/booking/' + (coaching?.slug || '') + '" class="course-s-e57ade">Copy</button>', true);
  } else {
    pubBtn.textContent = 'Publish';
    pubBtn.style.borderColor = 'rgba(74,222,128,0.4)';
    pubBtn.style.color = '#4ade80';
    if (coaching && coaching.listed_in_marketplace) {
      await sb.from('coaching_services').update({ listed_in_marketplace: false }).eq('id', currentCoachingId);
      coaching.listed_in_marketplace = false;
    }
    document.getElementById('coaching-marketplace-toggle').style.display = 'none';
    updateMarketplaceToggleUI('coaching', false);
    showCoachingMsg('success', 'Unpublished.');
  }
}

async function deleteCoaching() {
  if (!currentCoachingId) return;
  // Typed-DELETE failsafe, same pattern courses uses for course/module/lesson
  // deletes and products uses for product delete. confirmTypedDelete is
  // defined in js/course.js (loads earlier on the dashboard) and returns a
  // Promise that resolves true if the user typed DELETE and clicked confirm.
  var confirmed = await confirmTypedDelete(
    'Delete Service',
    'This will permanently delete this booking service, all bookings, and associated data. Past buyers will lose access. This cannot be undone.',
    'Delete Service'
  );
  if (!confirmed) return;

  var coaching = coachingList.find(function(c) { return c.id === currentCoachingId; });
  if (coaching && coaching.cover_image_path) {
    await sb.storage.from('coaching-covers').remove([coaching.cover_image_path]);
  }

  await sb.from('coaching_bookings').delete().eq('coaching_id', currentCoachingId);
  var { error } = await sb.from('coaching_services').delete().eq('id', currentCoachingId);
  if (error) { showCoachingMsg('error', 'Failed: ' + error.message); return; }

  // Remove from bio links if present
  try {
    var { data: bioData } = await sb.from('link_in_bio').select('links').eq('user_id', currentUser.id).maybeSingle();
    if (bioData && Array.isArray(bioData.links)) {
      var filtered = bioData.links.filter(function(l) { return !(l.isCoaching && l.coachingId === currentCoachingId); });
      if (filtered.length !== bioData.links.length) {
        await sb.from('link_in_bio').update({ links: filtered }).eq('user_id', currentUser.id);
        if (typeof bioState !== 'undefined' && bioState.links) {
          bioState.links = bioState.links.filter(function(l) { return !(l.isCoaching && l.coachingId === currentCoachingId); });
        }
      }
    }
  } catch (bioErr) { console.warn('Failed to clean bio link:', bioErr); }

  coachingList = coachingList.filter(function(c) { return c.id !== currentCoachingId; });
  closeCoachingEditor();
}


// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Markup buttons
coachRegisterAction('max-upgrade', (e) => handleMaxUpgradeClick(e));
coachRegisterAction('open-editor', (e, el) => openCoachingEditor(el.dataset.coachId || undefined));
coachRegisterAction('close-editor', () => closeCoachingEditor());
coachRegisterAction('save', () => saveCoaching());
coachRegisterAction('toggle-publish', () => toggleCoachingPublish());
coachRegisterAction('toggle-marketplace', () => toggleCoachingMarketplace());
coachRegisterAction('copy-url', () => copyCoachingUrl());
coachRegisterAction('remove-cover', () => removeCoachingCover());
coachRegisterAction('trigger-cover-upload', () => document.getElementById('coaching-cover-file').click());
coachRegisterAction('cover-selected', (e, el) => onCoachingCoverSelect(el.files[0]));
coachRegisterAction('set-booking-type', (e, el) => setCoachingBookingType(el.dataset.coachType));
coachRegisterAction('avail-changed', () => onAvailChanged());
coachRegisterAction('delete', () => deleteCoaching());

// Template-literal-rendered buttons
coachRegisterAction('toggle-avail-day', (e, el) => toggleAvailDay(el.dataset.coachDayKey, el.checked));
coachRegisterAction('copy-publish-url', (e, el) => copyPublishUrl(el.dataset.coachUrl, el));

