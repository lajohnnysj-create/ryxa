// =============================================================================
// /js/course.js, Course Builder (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Course Builder tool (Max tier). Extracted from
// dashboard.html for stricter CSP and easier maintenance.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/course.js
//   • Phase 2: replaced inline onclick/oninput/etc with data-course-action
//     attributes + delegated event handlers (CSP-strict)
//   • Phase 3: replaced inline class="bio-s-6eae3a" attributes with hash-named CSS
//     classes in dashboard.html's <style> block, or post-render JS
//     application for dynamic styles (CSP-strict)
//
// External dependencies remain on window (sb, Auth, currentUser, isMax,
// escapeHtml, showModalAlert, showModalConfirm, formatMoney, etc).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE (parallel of bio/mk; namespaced course-*)
// =============================================================================

const courseActions = {};

function courseRegisterAction(action, handler) {
  courseActions[action] = handler;
}

function courseFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['courseAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.courseAction) {
        const wantEvent = el.dataset.courseEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.courseAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function courseDispatchEvent(event) {
  const found = courseFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = courseActions[found.action];
  if (!handler) {
    console.warn('[course] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur', 'keydown', 'mouseover', 'mouseout'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, courseDispatchEvent, useCapture);
});

// =============================================================================
// CSP-STRICT STYLE APPLICATION (Phase 3)
// =============================================================================
const COURSE_DATA_STYLE_MAP = {
  bg: 'background', color: 'color', border: 'border', shadow: 'box-shadow',
  padding: 'padding', radius: 'border-radius', display: 'display', fontFamily: 'font-family',
};

function courseApplyDataStyles(root) {
  root = root || document;
  const selectors = Object.keys(COURSE_DATA_STYLE_MAP)
    .map(k => `[data-course-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}]`)
    .join(',');
  const els = root.querySelectorAll(selectors);
  els.forEach(el => {
    Object.entries(COURSE_DATA_STYLE_MAP).forEach(([camelName, cssProp]) => {
      const val = el.dataset['course' + camelName.charAt(0).toUpperCase() + camelName.slice(1)];
      if (val) el.style.setProperty(cssProp, val);
    });
  });
}

// =============================================================================
// END INFRASTRUCTURE, Course state + functions follow
// =============================================================================

// ---------- From dashboard.html lines 13313-13320 (Course state) ----------
// =====================================================
// COURSES, Creator Course Builder (Max only)
// =====================================================
let coursesList = [];
let currentCourseId = null;
let courseModules = []; // local working copy: [{id, title, sort_order, lessons: [...], quiz: null|{id, require_pass, questions: [...]}}]
let courseCoverFile = null;
let coursesInited = false;

// ---------------------------------------------------------------------------
// Lesson files state (downloadable attachments per lesson)
// ---------------------------------------------------------------------------
// In-memory cache: { lessonId -> [file row, ...] }. Populated when an editor
// opens for an existing-DB lesson; never populated for new_* lessons (they
// don't have a DB id to attach files to yet).
//
// Account storage usage in bytes (sum of all digital_product_files +
// course_lesson_files for the current user, via get_creator_storage_used
// RPC). Refreshed when the editor opens and after every upload/delete so the
// storage indicator and pre-flight cap checks stay current.
var lessonFilesByLessonId = {};
var courseStorageUsedBytes = 0;

// ---------- From dashboard.html lines 13880-14773 (Course functions) ----------
function initCoursesTool() {
  const max = isMax();
  document.getElementById('courses-upsell').style.display = max ? 'none' : 'block';
  document.getElementById('courses-list-view').style.display = max ? 'block' : 'none';
  document.getElementById('courses-editor-view').style.display = 'none';
  if (max && !coursesInited) {
    coursesInited = true;
    loadCoursesList();
    refreshCourseStorage();  // shared 500 MB indicator
  } else if (max) {
    renderCoursesList();
    refreshCourseStorage();
  }
}

async function loadCoursesList() {
  const { data, error } = await sb
    .from('courses')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (error) { console.error('Failed to load courses:', error); return; }
  coursesList = data || [];

  // Load enrollment counts per course
  for (var i = 0; i < coursesList.length; i++) {
    var c = coursesList[i];
    var { count } = await sb.from('course_enrollments').select('id', { count: 'exact', head: true }).eq('course_id', c.id);
    c._enrollments = count || 0;
  }

  renderCoursesList();
}

function renderCoursesList() {
  const grid = document.getElementById('courses-grid');
  const empty = document.getElementById('courses-empty');
  if (coursesList.length === 0) {
    grid.innerHTML = '';
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = coursesList.map(c => {
    const statusColor = c.status === 'published' ? '#4ade80' : c.status === 'archived' ? '#f87171' : '#fbbf24';
    const statusLabel = c.status.charAt(0).toUpperCase() + c.status.slice(1);
    const price = c.price_cents === 0 ? 'Free' : formatMoney(c.price_cents, {alwaysShowCents:true});
    // Cover background: either an image URL or a gradient. Encoded as data-course-bg
    // (applied via JS post-render, CSP-strict, no inline style attribute).
    const coverBg = c.cover_image_path
      ? 'url(' + sb.storage.from("course-covers").getPublicUrl(c.cover_image_path).data.publicUrl + ') center/cover'
      : 'linear-gradient(135deg,rgba(124,58,237,0.15),rgba(232,121,249,0.1))';
    const enrollText = 'Total Enrollment: ' + (c._enrollments || 0);
    return '<div data-course-action="open-editor" data-course-id="' + escapeHtml(c.id) + '" class="course-s-259ee6 course-card-clickable">'
      + '<div class="course-s-cover" data-course-bg="' + escapeHtml(coverBg) + '">' + (c.cover_image_path ? '' : '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></svg>') + '</div>'
      + '<div class="course-s-4680c6">'
      + '<div class="course-s-c420c8">' + escapeHtml(c.title || 'Untitled Course') + '</div>'
      + '<div class="course-s-3522d7">'
      + '<span class="course-card-status" data-course-color="' + escapeHtml(statusColor) + '">' + statusLabel + '</span>'
      + '<span class="course-s-b78524">' + price + '</span>'
      + '</div>'
      + '<div class="bio-s-5f3468">' + enrollText + '</div>'
      + '</div></div>';
  }).join('');
  // Apply dynamic data-course-* styles + hover class for cards
  courseApplyDataStyles(grid);
}

async function openCourseEditor(courseId) {
  currentCourseId = courseId || null;
  courseCoverFile = null;
  courseModules = [];
  document.getElementById('courses-list-view').style.display = 'none';
  document.getElementById('courses-editor-view').style.display = 'block';
  document.getElementById('course-editor-msg').style.display = 'none';

  // Reset form
  document.getElementById('course-id').value = '';
  document.getElementById('course-title-input').value = '';
  document.getElementById('course-slug-input').value = '';
  document.getElementById('course-desc-input').value = '';
  document.getElementById('course-completion-msg').value = '';
  document.getElementById('course-price-input').value = '';
  document.getElementById('course-cover-preview').style.display = 'none';
  document.getElementById('course-cover-file').value = '';
  var resetUploadBtn = document.getElementById('course-cover-upload-btn');
  if (resetUploadBtn) resetUploadBtn.style.display = 'flex';
  document.getElementById('course-modules-list').innerHTML = '';
  document.getElementById('course-modules-empty').style.display = 'block';
  document.getElementById('course-danger-zone').style.display = 'none';
  document.getElementById('course-publish-btn').style.display = 'none';
  document.getElementById('course-marketplace-toggle').style.display = 'none';
  updateMarketplaceToggleUI('course', false);

  if (courseId) {
    // Edit existing
    const course = coursesList.find(c => c.id === courseId);
    if (!course) return;
    document.getElementById('courses-editor-title').textContent = 'Edit Course';
    document.getElementById('course-id').value = course.id;
    document.getElementById('course-title-input').value = course.title || '';
    document.getElementById('course-slug-input').value = course.slug || '';
    document.getElementById('course-slug-notice').textContent = 'This URL is permanently locked and cannot be changed.';
    document.getElementById('course-desc-input').value = course.description || '';
    document.getElementById('course-completion-msg').value = course.completion_message || '';
    document.getElementById('course-price-input').value = course.price_cents ? (course.price_cents / 100).toString() : '';
    document.getElementById('course-danger-zone').style.display = 'block';

    // Cover image
    if (course.cover_image_path) {
      const url = sb.storage.from('course-covers').getPublicUrl(course.cover_image_path).data.publicUrl;
      document.getElementById('course-cover-img').src = url;
      document.getElementById('course-cover-preview').style.display = 'block';
      var uploadBtn = document.getElementById('course-cover-upload-btn');
      if (uploadBtn) uploadBtn.style.display = 'none';
    }

    // Publish button
    const pubBtn = document.getElementById('course-publish-btn');
    pubBtn.style.display = 'inline-block';
    if (course.status === 'published') {
      pubBtn.textContent = 'Unpublish';
      pubBtn.style.borderColor = 'rgba(239,68,68,0.4)';
      pubBtn.style.color = '#ef4444';
      // Show marketplace toggle only when published
      document.getElementById('course-marketplace-toggle').style.display = 'block';
      updateMarketplaceToggleUI('course', !!course.listed_in_marketplace);
      updateMarketplaceCountDisplay();
    } else {
      pubBtn.textContent = 'Publish';
      pubBtn.style.borderColor = 'rgba(74,222,128,0.4)';
      pubBtn.style.color = '#4ade80';
    }

    // Load modules & lessons
    await loadCourseModules(courseId);
  } else {
    document.getElementById('courses-editor-title').textContent = 'New Course';
    document.getElementById('course-slug-notice').textContent = 'This URL is generated from your title and locked permanently once saved.';
  }
}

function closeCourseEditor() {
  document.getElementById('courses-editor-view').style.display = 'none';
  document.getElementById('courses-list-view').style.display = 'block';
  currentCourseId = null;
  loadCoursesList();
}

function copyCourseUrl() {
  var slug = document.getElementById('course-slug-input').value;
  if (!slug) return;
  var url = 'https://www.ryxa.io/course/' + slug;
  navigator.clipboard.writeText(url).then(function() {
    var btn = document.getElementById('course-copy-url-btn');
    var orig = btn.innerHTML;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied';
    btn.style.color = '#4ade80';
    setTimeout(function() { btn.innerHTML = orig; btn.style.color = 'var(--muted)'; }, 1500);
  });
}

function toggleCourseSection(section) {
  var body = document.getElementById('course-section-' + section);
  var chevron = document.getElementById('course-chevron-' + section);
  if (!body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  body.style.padding = isOpen ? '0 24px' : '0 24px 24px';
  if (chevron) chevron.style.transform = isOpen ? 'rotate(-90deg)' : '';
}

function showCourseMsg(type, msg, isHtml) {
  const el = document.getElementById('course-editor-msg');
  el.style.display = 'block';
  el.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(74,222,128,0.1)';
  el.style.color = type === 'error' ? '#f87171' : '#4ade80';
  el.style.border = '1px solid ' + (type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(74,222,128,0.3)');
  if (isHtml) { el.innerHTML = msg; } else { el.textContent = msg; }
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function generateSlug(text) {
  var base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 68);
  var rand = Math.random().toString(36).slice(2, 6);
  return base ? (base + '-' + rand).slice(0, 80) : '';
}

// Auto-generate slug from title (only for new courses, slug is locked once saved)
document.addEventListener('input', function(e) {
  if (e.target.id === 'course-title-input' && !currentCourseId) {
    document.getElementById('course-slug-input').value = generateSlug(e.target.value);
  }
});

function onCourseCoverSelect(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showCourseMsg('error', 'Image must be under 10MB.'); return; }
  // Compress: resize to max 1200px wide, JPEG at 80% quality
  const img = new Image();
  img.onload = function() {
    const MAX_W = 1200;
    const MAX_H = 800;
    let w = img.width, h = img.height;
    if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
    if (h > MAX_H) { w = Math.round(w * MAX_H / h); h = MAX_H; }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    canvas.toBlob(function(blob) {
      if (!blob) { showCourseMsg('error', 'Failed to process image.'); return; }
      courseCoverFile = new File([blob], 'cover.jpg', { type: 'image/jpeg' });
      document.getElementById('course-cover-img').src = URL.createObjectURL(blob);
      document.getElementById('course-cover-preview').style.display = 'block';
      var uploadBtn = document.getElementById('course-cover-upload-btn');
      if (uploadBtn) uploadBtn.style.display = 'none';
    }, 'image/jpeg', 0.8);
  };
  img.onerror = function() { showCourseMsg('error', 'Could not read image file.'); };
  img.src = URL.createObjectURL(file);
}

function removeCourseCover() {
  courseCoverFile = null;
  document.getElementById('course-cover-preview').style.display = 'none';
  document.getElementById('course-cover-file').value = '';
  document.getElementById('course-cover-img').src = '';
  var uploadBtn = document.getElementById('course-cover-upload-btn');
  if (uploadBtn) uploadBtn.style.display = 'flex';
}

// Re-entrance guard for saveCourse. Manual saves disable the Save button to
// prevent double-clicks, but saveCourse() is also called programmatically by
// auto-save flows (Bunny upload completion, course-active toggle, etc.). If
// one of those auto-saves fires while a manual save is in progress, two
// concurrent flows would race against the same DB rows. The flag below
// short-circuits any reentrant call until the in-flight save finishes.
let _saveCourseInProgress = false;

async function saveCourse(opts) {
  // `opts.silent` (default false): when true, this is a programmatic save
  // (e.g., post-upload autosave, post-encode autosave) and the editor UI
  // should not be disturbed. Specifically, we skip the
  // collapseAllOtherLessons() call that otherwise force-closes any expanded
  // lesson card. Without this, a creator watching their upload progress
  // would see their lesson snap shut the moment the upload finishes, and
  // again when encoding completes. Manual saves (no opts arg) keep the
  // legacy "settle the editor" behavior.
  var silent = !!(opts && opts.silent);
  if (_saveCourseInProgress) return;
  _saveCourseInProgress = true;

  const title = document.getElementById('course-title-input').value.trim();
  const slug = document.getElementById('course-slug-input').value.trim();
  const description = document.getElementById('course-desc-input').value.trim();
  const completionMessage = document.getElementById('course-completion-msg').value.trim();
  const priceStr = document.getElementById('course-price-input').value;
  const priceCents = Math.round(parseFloat(priceStr || '0') * 100);

  if (!title) { _saveCourseInProgress = false; showCourseMsg('error', 'Please enter a course title.'); return; }
  if (!slug) { _saveCourseInProgress = false; showCourseMsg('error', 'URL slug is empty. Please enter a title.'); return; }

  const btn = document.getElementById('course-save-btn');
  btn.disabled = true; btn.textContent = 'Saving...';

  try {
    let courseId = currentCourseId;

    // Upload cover image if new file selected
    let coverPath = null;
    if (courseCoverFile) {
      const path = currentUser.id + '/' + (courseId || 'new') + '_' + Date.now() + '.jpg';
      const { error: uploadErr } = await sb.storage.from('course-covers').upload(path, courseCoverFile, { upsert: true, contentType: 'image/jpeg' });
      if (uploadErr) throw new Error('Cover upload failed: ' + uploadErr.message);
      coverPath = path;
    }

    const payload = {
      title,
      description,
      completion_message: completionMessage,
      price_cents: priceCents,
      updated_at: new Date().toISOString()
    };
    if (coverPath) payload.cover_image_path = coverPath;

    if (courseId) {
      // Update
      const { error } = await sb.from('courses').update(payload).eq('id', courseId);
      if (error) throw new Error(error.message);
    } else {
      // Insert, slug is set once and locked permanently
      payload.user_id = currentUser.id;
      payload.status = 'draft';
      payload.slug = slug;
      const { data, error } = await sb.from('courses').insert(payload).select().single();
      if (error) {
        if (error.message && error.message.includes('duplicate')) {
          throw new Error('This URL slug is already taken. Try changing your title slightly.');
        }
        throw new Error(error.message);
      }
      courseId = data.id;
      currentCourseId = courseId;
      // Add the new course to the in-memory list so subsequent operations
      // (publish toggle, marketplace toggle, etc.) can read its current
      // status without a round-trip to the DB. Without this, clicking
      // Publish immediately after Save would flip to 'published' correctly,
      // but a subsequent Unpublish click would not know the course was
      // already published (since coursesList.find returns undefined) and
      // would re-run the publish branch.
      coursesList.push(data);
      document.getElementById('course-id').value = courseId;
      document.getElementById('courses-editor-title').textContent = 'Edit Course';
      document.getElementById('course-danger-zone').style.display = 'block';
      document.getElementById('course-slug-notice').textContent = 'This URL is permanently locked and cannot be changed.';
      // Show publish button
      const pubBtn = document.getElementById('course-publish-btn');
      pubBtn.style.display = 'inline-block';
      pubBtn.textContent = 'Publish';
      pubBtn.style.borderColor = 'rgba(74,222,128,0.4)';
      pubBtn.style.color = '#4ade80';
    }

    // Save modules & lessons
    await saveCourseModules(courseId);

    // Collapse all expanded lessons before re-rendering. Same mechanism as
    // the accordion - keeps Quill from re-mounting and focus-scrolling, which
    // would yank the page to the top of the expanded lesson. Saving is a
    // natural checkpoint anyway; creators expect Save to "settle" the editor.
    // Quiz cards intentionally left alone (no Quill, no scroll bug).
    // Skipped when `silent` (programmatic saves from upload/encode flows)
    // so creators don't see their currently-watched lesson snap shut.
    if (!silent) collapseAllOtherLessons(null, null);

    // Re-render so any lessons that were "new" before this save now reflect
    // their real DB ids in the UI. Without this, an expanded just-saved
    // lesson keeps showing the "Save first to attach files" message because
    // its rendered HTML was built before the save completed.
    renderCourseModules();

    showCourseMsg('success', 'Course saved!');
    courseCoverFile = null;
  } catch (err) {
    showCourseMsg('error', 'Failed to save: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
    _saveCourseInProgress = false;
  }
}

async function toggleCoursePublish() {
  if (!currentCourseId) return;
  const course = coursesList.find(c => c.id === currentCourseId);
  const newStatus = (course && course.status === 'published') ? 'draft' : 'published';

  // If publishing, check username exists
  if (newStatus === 'published') {
    if (!bioOriginalUsername && !window._ryx_username) {
      showCourseMsg('error', 'Set up your username in Link in Bio before publishing.');
      return;
    }

    // Check Stripe is connected
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
        + '<p class="course-s-8b98d3">You need to connect your Stripe account before you can publish a paid course. This lets you accept payments from students.</p>'
        + '<button id="stripe-modal-settings-btn" class="course-s-6673c3">Go to Settings</button>'
        + '<button id="stripe-modal-cancel-btn" class="course-s-9f3ba9">Cancel</button>'
        + '</div>';
      document.body.appendChild(stripeOverlay);
      document.getElementById('stripe-modal-settings-btn').onclick = function() { stripeOverlay.remove(); openSettingsModal(); };
      document.getElementById('stripe-modal-cancel-btn').onclick = function() { stripeOverlay.remove(); };
      stripeOverlay.onclick = function(e) { if (e.target === stripeOverlay) stripeOverlay.remove(); };
      return;
    }
  }

  const updates = { status: newStatus };
  if (newStatus === 'published') updates.published_at = new Date().toISOString();

  const { error } = await sb.from('courses').update(updates).eq('id', currentCourseId);
  if (error) { showCourseMsg('error', 'Failed: ' + error.message); return; }

  if (course) course.status = newStatus;
  const pubBtn = document.getElementById('course-publish-btn');
  if (newStatus === 'published') {
    pubBtn.textContent = 'Unpublish';
    pubBtn.style.borderColor = 'rgba(239,68,68,0.4)';
    pubBtn.style.color = '#ef4444';
    document.getElementById('course-marketplace-toggle').style.display = 'block';
    updateMarketplaceCountDisplay();
    showCourseMsg('success', 'Course published!');
  } else {
    pubBtn.textContent = 'Publish';
    pubBtn.style.borderColor = 'rgba(74,222,128,0.4)';
    pubBtn.style.color = '#4ade80';
    // Unpublishing also unlists from marketplace
    if (course && course.listed_in_marketplace) {
      await sb.from('courses').update({ listed_in_marketplace: false }).eq('id', currentCourseId);
      course.listed_in_marketplace = false;
    }
    document.getElementById('course-marketplace-toggle').style.display = 'none';
    updateMarketplaceToggleUI('course', false);
    showCourseMsg('success', 'Course unpublished.');
  }
}

// =====================================================
// MARKETPLACE LISTING (Courses + Coaching)
// =====================================================
const MARKETPLACE_MAX = 20;

async function getMarketplaceCount() {
  if (!currentUser) return 0;
  const { data, error } = await sb.rpc('get_published_content_count', { p_user_id: currentUser.id });
  if (error) { console.error('Marketplace count error:', error); return 0; }
  return data || 0;
}

function updateMarketplaceToggleUI(prefix, isListed) {
  const btn = document.getElementById(prefix + '-marketplace-btn');
  const thumb = document.getElementById(prefix + '-marketplace-thumb');
  if (!btn || !thumb) return;
  if (isListed) {
    btn.style.background = 'linear-gradient(135deg,#a78bfa,#e879f9)';
    thumb.style.transform = 'translateX(20px)';
  } else {
    btn.style.background = 'rgba(255,255,255,0.15)';
    thumb.style.transform = 'translateX(0)';
  }
}

async function updateMarketplaceCountDisplay() {
  const count = await getMarketplaceCount();
  const countEl1 = document.getElementById('course-marketplace-count');
  const countEl2 = document.getElementById('coaching-marketplace-count');
  const countEl3 = document.getElementById('products-marketplace-count');
  const label = count + '/' + MARKETPLACE_MAX + ' listed';
  if (countEl1) countEl1.textContent = label;
  if (countEl2) countEl2.textContent = label;
  if (countEl3) countEl3.textContent = label;
  return count;
}

async function toggleCourseMarketplace() {
  if (!currentCourseId) return;
  const course = coursesList.find(c => c.id === currentCourseId);
  if (!course) return;
  const newVal = !(course.listed_in_marketplace);

  if (newVal) {
    const count = await getMarketplaceCount();
    if (count >= MARKETPLACE_MAX) {
      showCourseMsg('error', 'You\'ve reached the maximum of ' + MARKETPLACE_MAX + ' marketplace listings. Unlist another course, booking, or product first.');
      return;
    }
  }

  const { error } = await sb.from('courses').update({ listed_in_marketplace: newVal }).eq('id', currentCourseId);
  if (error) { showCourseMsg('error', 'Failed: ' + error.message); return; }
  course.listed_in_marketplace = newVal;
  updateMarketplaceToggleUI('course', newVal);
  updateMarketplaceCountDisplay();
  showCourseMsg('success', newVal ? 'Course listed in marketplace.' : 'Course removed from marketplace.');
}

async function toggleCoachingMarketplace() {
  if (!currentCoachingId) return;
  const coaching = coachingList.find(c => c.id === currentCoachingId);
  if (!coaching) return;
  const newVal = !(coaching.listed_in_marketplace);

  if (newVal) {
    const count = await getMarketplaceCount();
    if (count >= MARKETPLACE_MAX) {
      showCoachingMsg('error', 'You\'ve reached the maximum of ' + MARKETPLACE_MAX + ' marketplace listings. Unlist another course, booking, or product first.');
      return;
    }
  }

  const { error } = await sb.from('coaching_services').update({ listed_in_marketplace: newVal }).eq('id', currentCoachingId);
  if (error) { showCoachingMsg('error', 'Failed: ' + error.message); return; }
  coaching.listed_in_marketplace = newVal;
  updateMarketplaceToggleUI('coaching', newVal);
  updateMarketplaceCountDisplay();
  showCoachingMsg('success', newVal ? 'Service listed in marketplace.' : 'Service removed from marketplace.');
}

async function toggleProductMarketplace() {
  if (!productsState.editingId || !productsState.editing) return;
  const newVal = !(productsState.editing.listed_in_marketplace);

  if (newVal) {
    const count = await getMarketplaceCount();
    if (count >= MARKETPLACE_MAX) {
      showProductsMsg('error', 'You\'ve reached the maximum of ' + MARKETPLACE_MAX + ' marketplace listings. Unlist another course, booking, or product first.');
      return;
    }
  }

  const { error } = await sb.from('digital_products').update({ listed_in_marketplace: newVal }).eq('id', productsState.editingId);
  if (error) { showProductsMsg('error', 'Failed: ' + error.message); return; }
  productsState.editing.listed_in_marketplace = newVal;
  updateMarketplaceToggleUI('products', newVal);
  updateMarketplaceCountDisplay();
  showProductsMsg('success', newVal ? 'Product listed in marketplace.' : 'Product removed from marketplace.');
}

async function deleteCourse() {
  if (!currentCourseId) return;

  // Show modal with DELETE text input
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
    overlay.innerHTML = '<div class="course-s-a25ccd">'
      + '<div class="course-s-bc1a76">Delete Course</div>'
      + '<p class="course-s-1668a0">This will permanently delete this course, all modules, lessons, and enrollment data. This cannot be undone.</p>'
      + '<p class="course-s-7a34e5">Type <strong class="course-s-9dd120">DELETE</strong> to confirm:</p>'
      + '<input type="text" id="delete-course-input" placeholder="DELETE" class="course-s-6048ce">'
      + '<div class="course-s-b9bbe5">'
      + '<button id="delete-course-cancel" class="course-s-d25d01">Cancel</button>'
      + '<button id="delete-course-confirm" class="course-s-e05efc" disabled>Delete Course</button>'
      + '</div></div>';
    document.body.appendChild(overlay);

    var input = document.getElementById('delete-course-input');
    var confirmBtn = document.getElementById('delete-course-confirm');
    var cancelBtn = document.getElementById('delete-course-cancel');

    input.addEventListener('input', function() {
      var match = input.value.trim() === 'DELETE';
      confirmBtn.disabled = !match;
      confirmBtn.style.opacity = match ? '1' : '0.4';
      if (match) { confirmBtn.style.background = '#ef4444'; confirmBtn.style.color = '#fff'; confirmBtn.style.borderColor = '#ef4444'; }
      else { confirmBtn.style.background = 'transparent'; confirmBtn.style.color = '#ef4444'; confirmBtn.style.borderColor = 'rgba(239,68,68,0.3)'; }
    });

    cancelBtn.onclick = function() { document.body.removeChild(overlay); resolve(); };
    overlay.onclick = function(e) { if (e.target === overlay) { document.body.removeChild(overlay); resolve(); } };

    confirmBtn.onclick = async function() {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deleting...';

      // Find the course to get cover path before deleting
      var course = coursesList.find(function(c) { return c.id === currentCourseId; });

      // Delete cover image from storage
      if (course && course.cover_image_path) {
        await sb.storage.from('course-covers').remove([course.cover_image_path]);
      }

      // Delete lessons, modules, then course
      await sb.from('course_progress').delete().in('enrollment_id',
        (await sb.from('course_enrollments').select('id').eq('course_id', currentCourseId)).data?.map(function(e) { return e.id; }) || []
      );
      await sb.from('course_enrollments').delete().eq('course_id', currentCourseId);
      await sb.from('course_lessons').delete().eq('course_id', currentCourseId);
      await sb.from('course_modules').delete().eq('course_id', currentCourseId);
      var { error } = await sb.from('courses').delete().eq('id', currentCourseId);

      // Remove course link from bio if it exists
      try {
        var { data: bioData } = await sb.from('link_in_bio').select('links').eq('user_id', currentUser.id).maybeSingle();
        if (bioData && Array.isArray(bioData.links)) {
          var filtered = bioData.links.filter(function(l) { return !(l.isCourse && l.courseId === currentCourseId); });
          if (filtered.length !== bioData.links.length) {
            await sb.from('link_in_bio').update({ links: filtered }).eq('user_id', currentUser.id);
            // Also update local state if bio is loaded
            if (typeof bioState !== 'undefined' && bioState.links) {
              bioState.links = bioState.links.filter(function(l) { return !(l.isCourse && l.courseId === currentCourseId); });
            }
          }
        }
      } catch (bioErr) { console.warn('Failed to clean bio link:', bioErr); }

      document.body.removeChild(overlay);
      if (error) { showCourseMsg('error', 'Failed: ' + error.message); return resolve(); }
      coursesList = coursesList.filter(function(c) { return c.id !== currentCourseId; });
      closeCourseEditor();
      resolve();
    };

    input.focus();
  });
}

// ---- Modules & Lessons ----
async function loadCourseModules(courseId) {
  const { data: modules } = await sb.from('course_modules').select('*').eq('course_id', courseId).order('sort_order');
  const { data: lessons } = await sb.from('course_lessons').select('*').eq('course_id', courseId).order('sort_order');
  // Load quizzes (creator view = raw table, includes is_correct flags so the
  // creator can edit). One quiz per module max, enforced by UNIQUE constraint.
  const { data: quizzes } = await sb.from('course_quizzes').select('*').eq('course_id', courseId);

  courseModules = (modules || []).map(m => {
    const moduleQuiz = (quizzes || []).find(q => q.module_id === m.id) || null;
    return {
      ...m,
      lessons: (lessons || []).filter(l => l.module_id === m.id).map(l => ({ ...l, _collapsed: true })),
      // quiz is null when no quiz exists for this module. When present, the
      // shape is { id, course_id, module_id, require_pass, questions, _collapsed }.
      // _collapsed is local-only UI state, same pattern as lessons.
      quiz: moduleQuiz ? { ...moduleQuiz, _collapsed: true } : null
    };
  });
  renderCourseModules();
}

// Per-lesson text_content size cap (1 MB of sanitized HTML). This is a DoS
// safety net, no realistic lesson approaches this size (1 MB of clean HTML
// is roughly 100k words plus dozens of images). If we ever hit it, something
// is wrong (pathological paste, bug, abuse). Backed up by a Postgres CHECK
// constraint on the column for defense in depth.
var MAX_LESSON_TEXT_BYTES = 1024 * 1024;

async function saveCourseModules(courseId) {
  // Pre-flight: validate every lesson's text_content size before we start
  // any DB writes. Catches oversize content with a clear error and leaves
  // the existing DB rows intact (because no writes have happened yet).
  for (let mi = 0; mi < courseModules.length; mi++) {
    const mod = courseModules[mi];
    for (let li = 0; li < (mod.lessons || []).length; li++) {
      const lesson = mod.lessons[li];
      if (lesson.text_content && lesson.text_content.length > MAX_LESSON_TEXT_BYTES) {
        showModalAlert(
          'Lesson too large',
          'Lesson ' + (li + 1) + ' in module ' + (mi + 1) + ' is over the 1 MB content limit. Remove some images or trim the text and try again.'
        );
        throw new Error('Lesson exceeds size cap');
      }
    }
    // Pre-flight: quiz structure validation. We skip empty questions
    // (creator added a slot but typed nothing) at save time, but partially-
    // filled questions must have exactly 4 answers and exactly one correct.
    if (mod.quiz && Array.isArray(mod.quiz.questions)) {
      const filled = mod.quiz.questions.filter(q => q && q.text && q.text.trim());
      if (filled.length > 10) {
        showModalAlert('Too many questions', 'Module ' + (mi + 1) + ' quiz has more than 10 questions. Remove some and try again.');
        throw new Error('Quiz exceeds question cap');
      }
      for (let qi = 0; qi < filled.length; qi++) {
        const question = filled[qi];
        const answers = Array.isArray(question.answers) ? question.answers : [];
        if (answers.length !== 4) {
          showModalAlert('Incomplete quiz question', 'Module ' + (mi + 1) + ' quiz question ' + (qi + 1) + ' must have exactly 4 answers.');
          throw new Error('Quiz question malformed');
        }
        const filledAnswers = answers.filter(a => a && a.text && a.text.trim());
        if (filledAnswers.length !== 4) {
          showModalAlert('Incomplete quiz question', 'Module ' + (mi + 1) + ' quiz question ' + (qi + 1) + ' has empty answer choices. Fill all 4 or remove the question.');
          throw new Error('Quiz answer empty');
        }
        const correctCount = answers.filter(a => a && a.is_correct === true).length;
        if (correctCount !== 1) {
          showModalAlert('Mark a correct answer', 'Module ' + (mi + 1) + ' quiz question ' + (qi + 1) + ' needs exactly one answer marked correct.');
          throw new Error('Quiz correct answer not marked');
        }
      }
    }
  }

  // Diff-and-sync approach. Previously this function wiped all modules and
  // lessons and re-inserted them, which generated fresh UUIDs on every save.
  // That made it impossible for any related table (like course_lesson_files)
  // to hold a stable foreign key to a lesson - the IDs would change on every
  // save and ON DELETE CASCADE would wipe related rows. Diffing preserves IDs
  // for existing rows, only deleting what's been removed in local state and
  // only inserting what's genuinely new.

  // Step 1: load current DB state and build lookup maps by id
  const { data: dbModules, error: dbModErr } = await sb
    .from('course_modules')
    .select('id, title, sort_order')
    .eq('course_id', courseId);
  if (dbModErr) throw dbModErr;
  const dbModulesById = {};
  (dbModules || []).forEach(function(m) { dbModulesById[m.id] = m; });

  const { data: dbLessons, error: dbLessErr } = await sb
    .from('course_lessons')
    .select('id, module_id')
    .eq('course_id', courseId);
  if (dbLessErr) throw dbLessErr;
  const dbLessonsById = {};
  (dbLessons || []).forEach(function(l) { dbLessonsById[l.id] = l; });

  // Step 2: classify local state. A "new_*" id means the row was added
  // client-side and hasn't been persisted yet. A UUID means it's an existing
  // DB row (possibly with edits we need to UPDATE).
  function isNewId(id) {
    return typeof id === 'string' && id.indexOf('new_') === 0;
  }

  // Step 3: figure out what needs to be deleted (in DB but not in local state).
  // We do this BEFORE inserts/updates so that the cascade from course_lessons
  // to course_lesson_files (which we'll add in a parallel migration) fires
  // only for genuinely removed lessons - not for every lesson on every save.
  const localModuleIds = new Set();
  const localLessonIds = new Set();
  for (let mi = 0; mi < courseModules.length; mi++) {
    const mod = courseModules[mi];
    if (!isNewId(mod.id)) localModuleIds.add(mod.id);
    for (let li = 0; li < (mod.lessons || []).length; li++) {
      const lesson = mod.lessons[li];
      if (!isNewId(lesson.id)) localLessonIds.add(lesson.id);
    }
  }

  const lessonsToDelete = (dbLessons || [])
    .map(function(l) { return l.id; })
    .filter(function(id) { return !localLessonIds.has(id); });
  if (lessonsToDelete.length > 0) {
    const { error: delLErr } = await sb.from('course_lessons').delete().in('id', lessonsToDelete);
    if (delLErr) throw delLErr;
  }

  const modulesToDelete = (dbModules || [])
    .map(function(m) { return m.id; })
    .filter(function(id) { return !localModuleIds.has(id); });
  if (modulesToDelete.length > 0) {
    const { error: delMErr } = await sb.from('course_modules').delete().in('id', modulesToDelete);
    if (delMErr) throw delMErr;
  }

  // Step 4: insert new modules first (lessons need module_id, including for
  // existing lessons that may have moved to a new module). Capture new ids
  // back into local state.
  for (let mi = 0; mi < courseModules.length; mi++) {
    const mod = courseModules[mi];
    if (isNewId(mod.id)) {
      const { data: savedMod, error: insErr } = await sb.from('course_modules').insert({
        course_id: courseId,
        title: mod.title || 'Untitled Module',
        sort_order: mi
      }).select('id').single();
      if (insErr || !savedMod) throw (insErr || new Error('Module insert returned no row'));
      mod.id = savedMod.id;
    }
  }

  // Step 5: update existing modules (title or sort_order may have changed).
  // Skip rows whose title and sort_order match the DB exactly - small optim,
  // also avoids unnecessary updated_at churn.
  for (let mi = 0; mi < courseModules.length; mi++) {
    const mod = courseModules[mi];
    if (isNewId(mod.id)) continue;  // already handled in step 4
    const dbMod = dbModulesById[mod.id];
    const newTitle = mod.title || 'Untitled Module';
    if (!dbMod || dbMod.title !== newTitle || dbMod.sort_order !== mi) {
      const { error: updErr } = await sb.from('course_modules')
        .update({ title: newTitle, sort_order: mi })
        .eq('id', mod.id);
      if (updErr) throw updErr;
    }
  }

  // Step 6: insert new lessons, then update existing lessons. Done module-
  // by-module so module_id is always the freshly-persisted id from step 4.
  for (let mi = 0; mi < courseModules.length; mi++) {
    const mod = courseModules[mi];
    for (let li = 0; li < (mod.lessons || []).length; li++) {
      const lesson = mod.lessons[li];
      const lessonPayload = {
        course_id: courseId,
        module_id: mod.id,
        title: lesson.title || (lesson.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson'),
        lesson_type: lesson.lesson_type || 'video',
        video_url: lesson.video_url || null,
        text_content: lesson.text_content || '',
        sort_order: li,
        is_preview: !!lesson.is_preview,
        images: lesson.images || [],
        // Preserve Bunny Stream fields across save. Without this, every
        // course save orphans the Bunny video.
        bunny_video_id: lesson.bunny_video_id || null,
        bunny_video_status: lesson.bunny_video_status || null,
        bunny_video_duration_seconds: lesson.bunny_video_duration_seconds || null,
        bunny_thumbnail_url: lesson.bunny_thumbnail_url || null,
        bunny_uploaded_at: lesson.bunny_uploaded_at || null
      };

      if (isNewId(lesson.id)) {
        const { data: savedLesson, error: insErr } = await sb.from('course_lessons')
          .insert(lessonPayload)
          .select('id')
          .single();
        if (insErr || !savedLesson) throw (insErr || new Error('Lesson insert returned no row'));
        lesson.id = savedLesson.id;
      } else {
        const { error: updErr } = await sb.from('course_lessons')
          .update(lessonPayload)
          .eq('id', lesson.id);
        if (updErr) throw updErr;
      }
    }
  }

  // Step 7: quiz diff-and-sync. Done AFTER lessons because the quiz's
  // module_id might point at a module that was just inserted in step 4.
  // Three cases per module:
  //   (A) DB has quiz, local doesn't  -> DELETE
  //   (B) DB has quiz, local has same -> UPDATE (always - small payload)
  //   (C) DB has no quiz, local has   -> INSERT
  //   (D) Neither                     -> noop
  const { data: dbQuizzes, error: dbQuizErr } = await sb
    .from('course_quizzes')
    .select('id, module_id')
    .eq('course_id', courseId);
  if (dbQuizErr) throw dbQuizErr;
  const dbQuizByModule = {};
  (dbQuizzes || []).forEach(function(q) { dbQuizByModule[q.module_id] = q; });

  for (let mi = 0; mi < courseModules.length; mi++) {
    const mod = courseModules[mi];
    const dbQuiz = dbQuizByModule[mod.id] || null;
    const localQuiz = mod.quiz || null;

    if (dbQuiz && !localQuiz) {
      // Case A: deleted
      const { error: delErr } = await sb.from('course_quizzes').delete().eq('id', dbQuiz.id);
      if (delErr) throw delErr;
    } else if (localQuiz) {
      // Strip _collapsed and other UI-only fields before write. Also drop
      // empty questions (creator added a slot but never typed) since
      // pre-flight validation already passed everything that's non-empty.
      const cleanQuestions = (Array.isArray(localQuiz.questions) ? localQuiz.questions : [])
        .filter(q => q && q.text && q.text.trim())
        .map(q => ({
          id: q.id,
          text: q.text.trim(),
          answers: (q.answers || []).map(a => ({
            id: a.id,
            text: (a.text || '').trim(),
            is_correct: a.is_correct === true
          }))
        }));

      // Auto-delete quizzes that have zero filled questions. A quiz with no
      // questions is functionally meaningless to students and creates
      // confusing edge cases downstream. Treat "empty quiz" as "no quiz."
      // If the creator wants to keep a quiz scaffold around to fill in
      // later, they should add at least one question first.
      if (cleanQuestions.length === 0) {
        if (dbQuiz) {
          // Was saved with content before; now empty - delete the row
          const { error: delErr } = await sb.from('course_quizzes').delete().eq('id', dbQuiz.id);
          if (delErr) throw delErr;
        }
        // Also clear local state so the UI reflects "no quiz" after save
        mod.quiz = null;
        continue;
      }

      const quizPayload = {
        course_id: courseId,
        module_id: mod.id,
        require_pass: !!localQuiz.require_pass,
        questions: cleanQuestions
      };

      if (!dbQuiz) {
        // Case C: insert (no existing DB row for this module)
        const { data: savedQuiz, error: insErr } = await sb.from('course_quizzes')
          .insert(quizPayload)
          .select('id')
          .single();
        if (insErr || !savedQuiz) throw (insErr || new Error('Quiz insert returned no row'));
        localQuiz.id = savedQuiz.id;
      } else {
        // Case B: update existing DB row. This path also covers the
        // delete-then-recreate flow: if the user trashed a quiz and
        // immediately created a new one before saving, the local quiz
        // has a 'new_...' id but the DB row for this module_id still
        // exists. The UNIQUE constraint on module_id means we MUST
        // update in place rather than insert. Adopt the DB id.
        const { error: updErr } = await sb.from('course_quizzes')
          .update(quizPayload)
          .eq('id', dbQuiz.id);
        if (updErr) throw updErr;
        localQuiz.id = dbQuiz.id;
      }
    }
    // Case D: no-op
  }
}

function addCourseModule() {
  courseModules.push({ id: 'new_' + Date.now(), title: '', lessons: [] });
  renderCourseModules();
}

// Reusable typed-DELETE confirmation modal. Same UX as deleteCourse (input
// field, must type DELETE to enable confirm button). Used for destructive
// actions where showModalConfirm's single click would be too easy to
// trigger accidentally - e.g., a missed double-click on the wrong button.
//
// title: modal heading (e.g., "Delete Module")
// message: explanatory text about what will be lost
// confirmLabel: button text (e.g., "Delete Module")
// Returns a Promise that resolves to true if confirmed, false if canceled.
function confirmTypedDelete(title, message, confirmLabel) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
    var inputId = 'typed-delete-input-' + Date.now();
    var confirmId = 'typed-delete-confirm-' + Date.now();
    var cancelId = 'typed-delete-cancel-' + Date.now();
    overlay.innerHTML = '<div class="course-s-a25ccd">'
      + '<div class="course-s-bc1a76">' + escapeHtml(title) + '</div>'
      + '<p class="course-s-1668a0">' + escapeHtml(message) + '</p>'
      + '<p class="course-s-7a34e5">Type <strong class="course-s-9dd120">DELETE</strong> to confirm:</p>'
      + '<input type="text" id="' + inputId + '" placeholder="DELETE" class="course-s-6048ce">'
      + '<div class="course-s-b9bbe5">'
      + '<button id="' + cancelId + '" class="course-s-d25d01">Cancel</button>'
      + '<button id="' + confirmId + '" class="course-s-e05efc" disabled>' + escapeHtml(confirmLabel) + '</button>'
      + '</div></div>';
    document.body.appendChild(overlay);

    var input = document.getElementById(inputId);
    var confirmBtn = document.getElementById(confirmId);
    var cancelBtn = document.getElementById(cancelId);

    input.addEventListener('input', function() {
      var match = input.value.trim() === 'DELETE';
      confirmBtn.disabled = !match;
      confirmBtn.style.opacity = match ? '1' : '0.4';
      if (match) { confirmBtn.style.background = '#ef4444'; confirmBtn.style.color = '#fff'; confirmBtn.style.borderColor = '#ef4444'; }
      else { confirmBtn.style.background = 'transparent'; confirmBtn.style.color = '#ef4444'; confirmBtn.style.borderColor = 'rgba(239,68,68,0.3)'; }
    });

    function close(result) {
      if (overlay.parentNode) document.body.removeChild(overlay);
      resolve(result);
    }
    cancelBtn.onclick = function() { close(false); };
    overlay.onclick = function(e) { if (e.target === overlay) close(false); };
    confirmBtn.onclick = function() {
      if (confirmBtn.disabled) return;
      close(true);
    };

    // Focus the input so the user can type immediately
    setTimeout(function() { input.focus(); }, 50);
  });
}

function removeCourseModule(idx) {
  var mod = courseModules[idx];
  if (!mod) return;
  var lessonCount = (mod.lessons || []).length;
  var hasQuiz = !!mod.quiz;
  var modLabel = mod.title ? '"' + mod.title + '"' : 'this module';
  var detail = 'This will permanently delete ' + modLabel
    + ' and ' + lessonCount + ' lesson' + (lessonCount === 1 ? '' : 's')
    + (hasQuiz ? ' plus the attached quiz' : '')
    + '. This cannot be undone.';
  confirmTypedDelete('Delete Module', detail, 'Delete Module').then(function(confirmed) {
    if (!confirmed) return;
    courseModules.splice(idx, 1);
    renderCourseModules();
  });
}

function addCourseLesson(modIdx, type) {
  courseModules[modIdx].lessons.push({
    id: 'new_' + Date.now(),
    title: '',
    lesson_type: type || 'video',
    video_url: '',
    text_content: '',
    is_preview: false,
    images: []
  });
  renderCourseModules();
}

function removeCourseLesson(modIdx, lessonIdx) {
  courseModules[modIdx].lessons.splice(lessonIdx, 1);
  renderCourseModules();
}

function confirmRemoveLesson(modIdx, lessonIdx) {
  var lesson = courseModules[modIdx] && courseModules[modIdx].lessons[lessonIdx];
  if (!lesson) return;
  var lessonLabel = lesson.title ? '"' + lesson.title + '"' : 'this lesson';
  var detail = 'This will permanently delete ' + lessonLabel + ' and any attached download files. This cannot be undone.';
  confirmTypedDelete('Delete Lesson', detail, 'Delete Lesson').then(async function(confirmed) {
    if (!confirmed) return;
    // Capture the lesson id BEFORE the splice, so we can clean up its files.
    // For new_* lessons this is a no-op inside deleteAllFilesForLesson.
    var lessonId = lesson.id;
    if (lessonId) {
      await deleteAllFilesForLesson(lessonId);
      // refreshCourseStorage updates the indicator and the pre-flight cache
      refreshCourseStorage();
    }
    removeCourseLesson(modIdx, lessonIdx);
  });
}

async function handleLessonImage(files, modIdx, lessonIdx) {
  if (!files || !files.length) return;
  var lesson = courseModules[modIdx]?.lessons?.[lessonIdx];
  if (!lesson) return;
  if (!lesson.images) lesson.images = [];
  if (lesson.images.length >= 5) { showModalAlert('Limit Reached', 'Maximum 5 images per lesson.'); return; }

  var file = files[0];
  if (!file.type.startsWith('image/')) { showModalAlert('Invalid File', 'Please upload an image file.'); return; }

  try {
    var blob = await compressLessonImage(file);
    if (!blob) throw new Error('Compression failed');

    var ext = 'webp';
    var path = currentUser.id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    var { error: upErr } = await sb.storage.from('course-images').upload(path, blob, { contentType: 'image/webp', upsert: false });
    if (upErr) throw upErr;

    var { data: urlData } = sb.storage.from('course-images').getPublicUrl(path);
    lesson.images.push(urlData.publicUrl);
    renderCourseModules();
  } catch (e) {
    console.error('Lesson image upload error:', e);
    showModalAlert('Upload Failed', 'Could not upload image. Please try again.');
  }
}

function compressLessonImage(file) {
  return new Promise(function(resolve) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var maxW = 1200;
        var w = img.width;
        var h = img.height;
        if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob) { resolve(blob); }, 'image/webp', 0.8);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function removeLessonImage(modIdx, lessonIdx, imgIdx) {
  var lesson = courseModules[modIdx]?.lessons?.[lessonIdx];
  if (!lesson || !lesson.images) return;
  var url = lesson.images[imgIdx];
  lesson.images.splice(imgIdx, 1);
  // Delete from storage (fire-and-forget)
  if (url && currentUser) {
    try {
      var parts = url.split('/course-images/');
      if (parts[1]) sb.storage.from('course-images').remove([decodeURIComponent(parts[1])]);
    } catch (e) { console.error('Image delete error:', e); }
  }
  renderCourseModules();
}

// ---------------------------------------------------------------------------
// Lesson files (downloadable attachments per lesson)
// ---------------------------------------------------------------------------
// Files live in the 'digital-products' Supabase bucket under path
//   courses/{course_id}/lessons/{lesson_id}/{timestamp}-{slug}.{ext}
// The bucket is shared with Digital Products for one consolidated 500 MB
// per-account quota. The course_lesson_files DB table stores metadata
// (filename, storage_path, size, etc.) and has cascade-delete from
// course_lessons via the FK, so removing a lesson auto-cleans the DB rows
// (storage cleanup is handled separately in confirmRemoveLesson).

// Refresh the shared storage usage figure. Updates the courses-page storage
// indicator (if present) and the in-memory pre-flight check value. Idempotent
// and cheap (one RPC call).
async function refreshCourseStorage() {
  try {
    var { data, error } = await sb.rpc('get_creator_storage_used');
    if (error) throw error;
    courseStorageUsedBytes = Number(data || 0);
    var pct = Math.min(100, Math.round((courseStorageUsedBytes / window.FileValidation.MAX_ACCOUNT_BYTES) * 100));
    var color = pct < 60 ? '#22c55e' : (pct < 85 ? '#eab308' : '#ef4444');
    var fill = document.getElementById('course-storage-fill');
    var txt = document.getElementById('course-storage-text');
    if (fill) { fill.style.width = pct + '%'; fill.style.background = color; }
    if (txt) txt.textContent = window.FileValidation.formatBytes(courseStorageUsedBytes) + ' / 500 MB for downloadable files (shared with Digital Products)';
  } catch (e) {
    console.error('refreshCourseStorage failed:', e);
  }
}

// Load files for a given lesson into the in-memory cache. Called when a
// lesson editor opens. Safe to call repeatedly - re-fetches fresh.
// Lessons with new_* ids (not yet saved) return immediately with an empty
// array since they have no DB id to query against.
async function loadLessonFiles(lessonId) {
  if (!lessonId || (typeof lessonId === 'string' && lessonId.indexOf('new_') === 0)) {
    return [];
  }
  try {
    var { data, error } = await sb
      .from('course_lesson_files')
      .select('id, lesson_id, filename, storage_path, file_size_bytes, mime_type, sort_order')
      .eq('lesson_id', lessonId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    lessonFilesByLessonId[lessonId] = data || [];
    return lessonFilesByLessonId[lessonId];
  } catch (e) {
    console.error('loadLessonFiles failed:', e);
    return [];
  }
}

// Upload one file as a lesson attachment. Runs pre-flight checks (size cap,
// account storage cap, per-lesson 5-file cap, type validation, ZIP inspection),
// uploads to storage, then inserts the metadata row. On any failure after the
// storage upload, the storage object is cleaned up so we don't orphan bytes.
//
// Returns true on success, false on any failure (the user has been alerted by
// this point via showModalAlert, so the caller doesn't need to).
async function uploadLessonFile(courseId, lessonId, file) {
  // Pre-flight: file size
  if (file.size > window.FileValidation.MAX_FILE_BYTES) {
    showModalAlert('File too large',
      '"' + file.name + '" is ' + window.FileValidation.formatBytes(file.size) + '. Max file size is 50 MB.');
    return false;
  }

  // Pre-flight: account storage cap (uses the cached value, which was
  // refreshed when the editor opened)
  if (courseStorageUsedBytes + file.size > window.FileValidation.MAX_ACCOUNT_BYTES) {
    showModalAlert('Storage full',
      'Adding "' + file.name + '" would exceed your 500 MB account storage. Delete some files first.');
    return false;
  }

  // Pre-flight: 5-file-per-lesson cap (UI gate, DB trigger is the backstop)
  var current = lessonFilesByLessonId[lessonId] || [];
  if (current.length >= 5) {
    showModalAlert('Lesson is full',
      'You have reached the 5-file limit for this lesson. Delete a file first if you need to add a new one.');
    return false;
  }

  // Pre-flight: extension + magic-byte validation
  var validation = await window.FileValidation.validateFileType(file);
  if (!validation.ok) {
    showModalAlert('File rejected', validation.error);
    return false;
  }

  // Pre-flight: ZIP inspection for blocked content
  var ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'zip') {
    var zipCheck = await window.FileValidation.inspectZipContents(file);
    if (!zipCheck.ok) {
      showModalAlert('ZIP rejected', zipCheck.error);
      return false;
    }
  }

  // Build the storage path. Same convention as digital products: user-scoped
  // root segment is REQUIRED by the digital-products bucket's storage RLS
  // policy (writes must be under {auth.uid()}/...). Then a timestamp + slug
  // to prevent collisions if a creator uploads two files with the same name.
  var path = currentUser.id + '/courses/' + courseId + '/lessons/' + lessonId + '/' +
             Date.now() + '-' + window.FileValidation.slugify(file.name.replace(/\.[^.]+$/, '')) + '.' + ext;

  try {
    var { error: upErr } = await sb.storage.from('digital-products').upload(path, file, {
      cacheControl: '0',
      upsert: false,
      contentType: file.type || 'application/octet-stream'
    });
    if (upErr) throw upErr;

    var { data: row, error: insErr } = await sb.from('course_lesson_files').insert({
      lesson_id: lessonId,
      course_id: courseId,
      filename: file.name,
      storage_path: path,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      sort_order: current.length
    }).select().single();

    if (insErr) {
      // Storage upload succeeded but DB row failed. Clean up the orphan.
      await sb.storage.from('digital-products').remove([path]);
      throw insErr;
    }

    // Update in-memory cache and storage usage
    if (!lessonFilesByLessonId[lessonId]) lessonFilesByLessonId[lessonId] = [];
    lessonFilesByLessonId[lessonId].push(row);
    courseStorageUsedBytes += file.size;
    return true;
  } catch (e) {
    console.error('uploadLessonFile failed:', e);
    // Helpful error message for the common cases. The DB trigger that
    // enforces the 5-file cap throws with error code 23514; surface that
    // as a friendlier message than the raw error.
    if (e && e.code === '23514' && e.message && e.message.indexOf('Lesson file limit') !== -1) {
      showModalAlert('Lesson is full', 'You have reached the 5-file limit for this lesson.');
    } else {
      showModalAlert('Upload failed', 'Could not upload "' + file.name + '". Please try again.');
    }
    return false;
  }
}

// Delete one lesson file. Removes from DB first (so RLS is the gate), then
// cleans up storage. Updates in-memory cache. Idempotent - safe to call on
// an already-deleted file (the DB delete is a no-op).
async function deleteLessonFile(lessonId, fileId) {
  var files = lessonFilesByLessonId[lessonId] || [];
  var file = files.find(function(f) { return f.id === fileId; });
  if (!file) return false;
  try {
    var { error: delErr } = await sb.from('course_lesson_files').delete().eq('id', fileId);
    if (delErr) throw delErr;
    // Best-effort storage cleanup
    try {
      await sb.storage.from('digital-products').remove([file.storage_path]);
    } catch (storeErr) {
      console.error('Storage cleanup failed (file row already deleted):', storeErr);
    }
    // Update cache + storage usage
    lessonFilesByLessonId[lessonId] = files.filter(function(f) { return f.id !== fileId; });
    courseStorageUsedBytes = Math.max(0, courseStorageUsedBytes - Number(file.file_size_bytes || 0));
    return true;
  } catch (e) {
    console.error('deleteLessonFile failed:', e);
    showModalAlert('Delete failed', 'Could not delete "' + file.filename + '". Please try again.');
    return false;
  }
}

// Delete every lesson-file row + storage object for the given lessonId.
// Called from confirmRemoveLesson before splicing the lesson out of local
// state, so a creator deleting a lesson doesn't orphan files in storage.
// The DB has ON DELETE CASCADE on the FK from course_lesson_files to
// course_lessons, so the rows would clean up on next course save anyway,
// but storage objects don't cascade and have to be explicitly removed.
async function deleteAllFilesForLesson(lessonId) {
  if (!lessonId || (typeof lessonId === 'string' && lessonId.indexOf('new_') === 0)) {
    return;  // unsaved lesson has no DB files
  }
  try {
    var { data: files } = await sb
      .from('course_lesson_files')
      .select('id, storage_path, file_size_bytes')
      .eq('lesson_id', lessonId);
    if (!files || files.length === 0) return;

    // Remove from storage in one batch call
    var paths = files.map(function(f) { return f.storage_path; });
    try {
      await sb.storage.from('digital-products').remove(paths);
    } catch (storeErr) {
      console.error('Bulk storage cleanup failed:', storeErr);
    }
    // DB rows: cascade will handle them when the lesson row is deleted on
    // next save. But delete explicitly too so storage usage updates now
    // (don't wait for next save).
    await sb.from('course_lesson_files').delete().eq('lesson_id', lessonId);

    // Reduce cached storage usage figure
    var freedBytes = files.reduce(function(s, f) { return s + Number(f.file_size_bytes || 0); }, 0);
    courseStorageUsedBytes = Math.max(0, courseStorageUsedBytes - freedBytes);
    delete lessonFilesByLessonId[lessonId];
  } catch (e) {
    console.error('deleteAllFilesForLesson failed:', e);
    // Non-blocking: the lesson can still be removed from local state. Orphan
    // storage files will eventually count against the creator's quota until
    // they're manually cleaned up. Not ideal but not catastrophic.
  }
}

function updateModuleTitle(modIdx, val) {
  courseModules[modIdx].title = val;
}

function updateLessonField(modIdx, lessonIdx, field, val) {
  courseModules[modIdx].lessons[lessonIdx][field] = val;
}

function collapseLesson(modIdx, lessonIdx) {
  // Tear down the Quill instance (if any) before the host div is removed
  // by the upcoming re-render. Prevents stale references piling up across
  // expand/collapse cycles.
  unmountLessonEditor(modIdx, lessonIdx);
  courseModules[modIdx].lessons[lessonIdx]._collapsed = true;
  renderCourseModules();
}

// Collapse every expanded lesson EXCEPT the one identified by the
// skip-target (mi/li). Used by the accordion behavior: when the user
// expands any item (lesson, video, or quiz), all other expanded lessons
// collapse first. Quiz cards are deliberately not collapsed by this -
// the accordion rule applies to lessons only, since lessons are what
// host Quill and the heavy editing surface.
//
// skipMi/skipLi can be null when no lesson is the target (e.g., a quiz
// is being expanded). In that case every expanded lesson collapses.
function collapseAllOtherLessons(skipMi, skipLi) {
  for (var mi = 0; mi < courseModules.length; mi++) {
    var mod = courseModules[mi];
    if (!mod.lessons) continue;
    for (var li = 0; li < mod.lessons.length; li++) {
      // Skip the target lesson (if any) - it's the one being expanded.
      if (skipMi !== null && skipLi !== null && mi === skipMi && li === skipLi) continue;
      var other = mod.lessons[li];
      if (other && !other._collapsed) {
        // Unmount Quill on this lesson if it has one - same teardown
        // path collapseLesson uses. Skipping this would leave stale
        // Quill instances pointing at detached DOM nodes after the
        // upcoming re-render.
        unmountLessonEditor(mi, li);
        other._collapsed = true;
      }
    }
  }
}

// Scrolls a card into view by its rendered ID. Used after expand actions
// so the newly-expanded item lands in view from the top. Wrapped in a
// short timeout to let the re-render commit before we try to find the
// element - innerHTML replacements are synchronous, but browsers want a
// frame to lay out before scrollIntoView gives accurate positions.
function scrollItemIntoView(elementId) {
  setTimeout(function() {
    var el = document.getElementById(elementId);
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 50);
}

function expandLesson(modIdx, lessonIdx) {
  // Accordion: collapse all other expanded lessons before opening this one.
  // Keeps the editing surface clean and (as a side effect) avoids the
  // scroll-jump bug where a Quill editor on an expanded lesson far up the
  // page would re-focus during the re-render and yank the page back to
  // its position.
  collapseAllOtherLessons(modIdx, lessonIdx);

  courseModules[modIdx].lessons[lessonIdx]._collapsed = false;
  renderCourseModules();
  // Scroll the newly-expanded card into view from its top. This matches
  // the behavior for videos that previously had no scroll (videos have no
  // Quill, so they got no focus-induced scroll), and gives consistent UX
  // across all item types - the thing you just opened lands at the top.
  scrollItemIntoView('course-item-' + modIdx + '-' + lessonIdx);
  // Load this lesson's downloadable files (if any) in the background. The
  // editor markup already showed a "Loading..." or empty state by this point;
  // when the fetch returns we re-render so the files appear. No-op for
  // lessons with new_* ids (not yet saved to the DB).
  var lesson = courseModules[modIdx].lessons[lessonIdx];
  if (lesson && lesson.id && (typeof lesson.id !== 'string' || lesson.id.indexOf('new_') !== 0)) {
    loadLessonFiles(lesson.id).then(function() {
      // Re-render so the freshly-loaded files appear. Cheap (full-tree
      // render but no DB writes).
      renderCourseModules();
    });
  }
}

function moveLessonUp(modIdx, lessonIdx) {
  if (lessonIdx <= 0) return;
  var lessons = courseModules[modIdx].lessons;
  var temp = lessons[lessonIdx];
  lessons[lessonIdx] = lessons[lessonIdx - 1];
  lessons[lessonIdx - 1] = temp;
  renderCourseModules();
}

function moveLessonDown(modIdx, lessonIdx) {
  var lessons = courseModules[modIdx].lessons;
  if (lessonIdx >= lessons.length - 1) return;
  var temp = lessons[lessonIdx];
  lessons[lessonIdx] = lessons[lessonIdx + 1];
  lessons[lessonIdx + 1] = temp;
  renderCourseModules();
}

function moveModuleUp(modIdx) {
  if (modIdx <= 0) return;
  var temp = courseModules[modIdx];
  courseModules[modIdx] = courseModules[modIdx - 1];
  courseModules[modIdx - 1] = temp;
  renderCourseModules();
}

function moveModuleDown(modIdx) {
  if (modIdx >= courseModules.length - 1) return;
  var temp = courseModules[modIdx];
  courseModules[modIdx] = courseModules[modIdx + 1];
  courseModules[modIdx + 1] = temp;
  renderCourseModules();
}

function toggleLessonType(modIdx, lessonIdx) {
  const lesson = courseModules[modIdx].lessons[lessonIdx];
  lesson.lesson_type = lesson.lesson_type === 'video' ? 'text' : 'video';
  renderCourseModules();
}

// Returns the platform name ('YouTube', 'Vimeo', 'Loom') if the URL is
// recognized as embeddable, otherwise null. Mirrors getEmbedUrl() in
// js/learn-page.js, keep the two in sync if either is updated, since the
// editor's validation indicator must match what the viewer can actually embed.
function detectVideoPlatform(url) {
  if (!url) return null;
  if (/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/.test(url)) return 'YouTube';
  if (/vimeo\.com\/(\d+)/.test(url)) return 'Vimeo';
  if (/loom\.com\/share\/([a-zA-Z0-9]+)/.test(url)) return 'Loom';
  return null;
}

// =============================================================================
// RICH TEXT EDITOR (Quill 1.3.7), text lessons
// =============================================================================
// Quill and DOMPurify are lazy-loaded on first text-lesson expansion, mirroring
// the Tone.js pattern in scripts.js. Saves ~75KB on every dashboard load that
// doesn't open a text lesson. Both libraries are loaded from cdnjs (already
// permitted by the dashboard's script-src CSP).
//
// SECURITY: every HTML payload from a creator passes through DOMPurify before
// (a) being saved to text_content, and (b) being rendered to students in
// learn-page.js. Defense in depth, never trust HTML alone, even our own.

var MAX_LESSON_IMAGES = 15;
var _courseQuillInstances = {}; // key: 'mi-li' → Quill instance
var _courseQuillLoadPromise = null;

function ensureQuillLoaded() {
  if (typeof Quill !== 'undefined' && typeof DOMPurify !== 'undefined') return Promise.resolve();
  if (_courseQuillLoadPromise) return _courseQuillLoadPromise;
  _courseQuillLoadPromise = new Promise(function(resolve, reject) {
    // Inject stylesheet first (Quill needs its CSS to render the toolbar/editor
    // correctly). Snow theme is the standard one with the inline toolbar.
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/quill/1.3.7/quill.snow.min.css';
    css.integrity = 'sha512-/FHUK/LsH78K9XTqsR9hbzr21J8B8RwHR/r8Jv9fzry6NVAOVIGFKQCNINsbhK7a1xubVu2r5QZcz2T9cKpubw==';
    css.crossOrigin = 'anonymous';
    document.head.appendChild(css);

    var loaded = 0;
    function done() {
      if (++loaded === 2) {
        // Both Quill and DOMPurify are now on window. Before resolving, teach
        // Quill about our custom image-size class so it preserves the
        // lesson-img-size-* class on images during paste/parse. Without this,
        // Quill's parchment strips unknown classes from <img> elements and
        // images reload as full-width because their saved size class is lost.
        try {
          var Parchment = Quill.import('parchment');
          var ImgSizeAttr = new Parchment.Attributor.Class('imgSize', 'lesson-img-size', {
            scope: Parchment.Scope.INLINE,
            whitelist: ['small', 'medium', 'large']
          });
          Quill.register(ImgSizeAttr, true);
        } catch (e) {
          // Non-fatal, editor still works, images just won't remember size.
          console.warn('Failed to register Quill image-size attributor:', e);
        }
        resolve();
      }
    }
    function fail(libName) {
      _courseQuillLoadPromise = null;
      reject(new Error(libName + ' failed to load'));
    }

    var quillScript = document.createElement('script');
    quillScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/quill/1.3.7/quill.min.js';
    quillScript.integrity = 'sha512-P2W2rr8ikUPfa31PLBo5bcBQrsa+TNj8jiKadtaIrHQGMo6hQM6RdPjQYxlNguwHz8AwSQ28VkBK6kHBLgd/8g==';
    quillScript.crossOrigin = 'anonymous';
    quillScript.onload = done;
    quillScript.onerror = function() { fail('Quill'); };
    document.head.appendChild(quillScript);

    var purifyScript = document.createElement('script');
    purifyScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js';
    purifyScript.integrity = 'sha512-H+rglffZ6f5gF7UJgvH4Naa+fGCgjrHKMgoFOGmcPTRwR6oILo5R+gtzNrpDp7iMV3udbymBVjkeZGNz1Em4rQ==';
    purifyScript.crossOrigin = 'anonymous';
    purifyScript.onload = done;
    purifyScript.onerror = function() { fail('DOMPurify'); };
    document.head.appendChild(purifyScript);
  });
  return _courseQuillLoadPromise;
}

// DOMPurify config, what creators can produce, students can see. The class
// attribute is allowed but VALUES are filtered by the hook below, only the
// specific Quill alignment classes and our lesson-img-size classes are kept.
// Anything outside this list gets stripped.
var QUILL_PURIFY_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'img', 'span', 'div'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  ADD_ATTR: ['target'],
};

// Hard whitelist of class values that creator content may carry. Any other
// class value (including ones that match unrelated stylesheet rules) is
// stripped. Future-proofs against accidental "global stylesheet leverage"
// attacks where a creator picks a class that triggers dangerous layout.
var ALLOWED_LESSON_CLASSES = new Set([
  'ql-align-center', 'ql-align-right',
  'lesson-img-size-small', 'lesson-img-size-medium', 'lesson-img-size-large'
]);

// Install DOMPurify hooks ONCE per page load. The hook runs on every
// sanitize() call to filter class values and enforce safe link attrs.
var _dompurifyHooksInstalled = false;
function installDomPurifyHooks() {
  if (_dompurifyHooksInstalled || typeof DOMPurify === 'undefined') return;
  _dompurifyHooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', function(node) {
    // Filter class values down to the whitelist. Removes the attribute if no
    // allowed classes remain.
    if (node.hasAttribute && node.hasAttribute('class')) {
      var classes = (node.getAttribute('class') || '').split(/\s+/).filter(function(c) {
        return c && ALLOWED_LESSON_CLASSES.has(c);
      });
      if (classes.length) {
        node.setAttribute('class', classes.join(' '));
      } else {
        node.removeAttribute('class');
      }
    }
    // Enforce safe rel on every target=_blank link. Prevents reverse
    // tabnabbing (where the linked site uses window.opener to redirect the
    // original tab to a phishing page).
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
    // WCAG: every <img> needs an alt attribute. We can't infer descriptive
    // alt text after the fact, so we default missing alts to empty string
    // (= "decorative, screen readers should skip"). This is the right
    // default since creators don't currently have a way to enter alt text
    // when inserting images. Existing images without alt get fixed on
    // first save after this hook is installed.
    if (node.tagName === 'IMG' && !node.hasAttribute('alt')) {
      node.setAttribute('alt', '');
    }
  });
}

function sanitizeLessonHtml(html) {
  if (typeof DOMPurify === 'undefined') return ''; // editor not loaded yet
  installDomPurifyHooks();
  // Strip the editor-only 'lesson-img-selected' class so it never persists
  // to the DB. The class is used only by the editor to outline a selected
  // image; viewers never need it. Removing as a string before sanitize is
  // simpler than configuring DOMPurify to strip a single class value.
  var cleaned = (html || '').replace(/\blesson-img-selected\b/g, '').replace(/class="\s*"/g, '');
  return DOMPurify.sanitize(cleaned, QUILL_PURIFY_CONFIG);
}

// Count <img> tags in the current Quill content (used to enforce per-lesson
// image cap). A regex is fine here, Quill output is well-formed.
function countQuillImages(quill) {
  var html = quill.root.innerHTML;
  var matches = html.match(/<img\b/g);
  return matches ? matches.length : 0;
}

// Initialize a Quill editor inside the placeholder div for a given lesson.
// Called after Quill is loaded AND after the lesson body is in the DOM.
function mountLessonEditor(mi, li) {
  var key = mi + '-' + li;
  var existing = _courseQuillInstances[key];
  if (existing) {
    // Defensive check: if a re-render replaced the host div without going
    // through collapseLesson (which unmounts), the cached instance is now
    // attached to a detached DOM node. We detect that via isConnected and
    // drop the stale reference so the mount proceeds against the live host.
    if (existing.root && existing.root.isConnected) {
      return existing; // still live, real idempotency
    }
    delete _courseQuillInstances[key];
  }

  var container = document.getElementById('lesson-editor-' + key);
  if (!container) return null;

  var lesson = courseModules[mi] && courseModules[mi].lessons[li];
  if (!lesson) return null;

  var quill = new Quill(container, {
    theme: 'snow',
    placeholder: 'Lesson content...',
    modules: {
      toolbar: {
        container: [
          [{ 'header': [1, 2, 3, false] }],
          ['bold', 'italic', 'underline'],
          [{ 'list': 'ordered' }, { 'list': 'bullet' }],
          [{ 'align': '' }, { 'align': 'center' }, { 'align': 'right' }],
          ['link', 'image'],
          ['clean']
        ],
        handlers: {
          // Custom image handler, runs our existing compressLessonImage pipeline
          // (WebP 0.8, 1200px max) and uploads to course-images bucket. Same
          // egress profile as the old standalone Images section.
          image: function() {
            var imgCount = countQuillImages(quill);
            if (imgCount >= MAX_LESSON_IMAGES) {
              showModalAlert('Image limit reached', 'You can add up to ' + MAX_LESSON_IMAGES + ' images per lesson. Remove one before adding another.');
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
                // Default newly-inserted images to "small". Creator can click
                // the image and use the S/M/L toolbar to resize.
                setTimeout(function() {
                  var imgs = quill.root.querySelectorAll('img');
                  var lastImg = imgs[imgs.length - 1];
                  if (lastImg) {
                    // Default newly-inserted images to "small". Creator can click
                    // the image and use the S/M/L toolbar to resize.
                    if (!lastImg.classList.contains('lesson-img-size-small') && !lastImg.classList.contains('lesson-img-size-medium') && !lastImg.classList.contains('lesson-img-size-large')) {
                      lastImg.classList.add('lesson-img-size-small');
                    }
                    // WCAG: every <img> needs an alt attribute. We don't have
                    // a way for the creator to enter alt text during insert,
                    // so we default to empty string (alt="" marks the image
                    // as decorative, screen readers will skip it). The
                    // afterSanitizeAttributes DOMPurify hook also enforces
                    // this on read, so the rule survives any HTML round-trip.
                    if (!lastImg.hasAttribute('alt')) lastImg.setAttribute('alt', '');
                    // Trigger save so the class + alt persist
                    var html = quill.root.innerHTML;
                    if (html === '<p><br></p>') html = '';
                    updateLessonField(mi, li, 'text_content', sanitizeLessonHtml(html));
                  }
                }, 50);
              } catch (e) {
                console.error('Lesson image upload error:', e);
                showModalAlert('Upload Failed', 'Could not upload image. Please try again.');
              }
            };
            input.click();
          }
        }
      }
    }
  });

  // Seed initial content. Old plain-text lessons get wrapped in <p>; lessons
  // already saved as HTML pass through sanitizer (defense in depth).
  var initial = lesson.text_content || '';
  if (initial && !/<[a-z]/i.test(initial)) {
    initial = '<p>' + initial.replace(/\n/g, '<br>') + '</p>';
  }
  var sanitizedInitial = sanitizeLessonHtml(initial);
  quill.clipboard.dangerouslyPasteHTML(0, sanitizedInitial, 'silent');

  // Belt-and-suspenders: re-apply image size classes after the seed. Quill 1.x
  // treats images as Embed blots which don't preserve custom classes through
  // dangerouslyPasteHTML, the Parchment attributor we registered helps for
  // copy/paste WITHIN the editor but is unreliable for the initial seed. We
  // re-parse our saved HTML, extract the size class for each image by index,
  // and apply it directly to Quill's rendered DOM.
  if (sanitizedInitial && /<img/i.test(sanitizedInitial)) {
    try {
      var parser = new DOMParser();
      var parsedDoc = parser.parseFromString('<div>' + sanitizedInitial + '</div>', 'text/html');
      var savedImgs = parsedDoc.querySelectorAll('img');
      var quillImgs = quill.root.querySelectorAll('img');
      // Match by position. Order is stable because dangerouslyPasteHTML
      // preserves the document order of embeds.
      for (var i = 0; i < quillImgs.length && i < savedImgs.length; i++) {
        var savedCls = savedImgs[i].className || '';
        var sizeMatch = savedCls.match(/\blesson-img-size-(small|medium|large)\b/);
        if (sizeMatch) {
          // Strip any leftover size classes first, then apply the saved one.
          quillImgs[i].classList.remove('lesson-img-size-small', 'lesson-img-size-medium', 'lesson-img-size-large');
          quillImgs[i].classList.add('lesson-img-size-' + sizeMatch[1]);
        }
      }
    } catch (e) {
      console.warn('Failed to re-apply image size classes after seed:', e);
    }
  }

  // Save on every edit. We sanitize on the way IN to the data model so the
  // stored value is already clean. learn-page.js sanitizes again on render
  // (defense in depth).
  quill.on('text-change', function(delta, oldDelta, source) {
    if (source !== 'user') return; // ignore programmatic changes (initial seed)
    // Block paste/drag-and-drop of images that would push us over the cap.
    // We check AFTER the change so we can yank the last one if it pushed us
    // over. This is the cleanest UX in Quill, preventing image-paste at the
    // event level is much messier.
    var imgCount = countQuillImages(quill);
    if (imgCount > MAX_LESSON_IMAGES) {
      // Undo the last paste/insert
      quill.history.undo();
      showModalAlert('Image limit reached', 'You can add up to ' + MAX_LESSON_IMAGES + ' images per lesson.');
      return;
    }
    var html = quill.root.innerHTML;
    // Treat completely empty Quill state as empty string (Quill represents
    // "empty" as '<p><br></p>' which would otherwise persist as junk).
    if (html === '<p><br></p>') html = '';
    updateLessonField(mi, li, 'text_content', sanitizeLessonHtml(html));
  });

  // Wire up image sizing. Adds S/M/L buttons to the toolbar (after Quill has
  // built it) and listens for clicks on images inside the editor so creators
  // can resize them. The selected image gets an outline; clicking S/M/L
  // applies the corresponding size class.
  setupImageSizing(quill, mi, li, container);

  _courseQuillInstances[key] = quill;
  return quill;
}

function setupImageSizing(quill, mi, li, container) {
  var toolbar = container.previousElementSibling; // .ql-toolbar sits just before .ql-container
  if (!toolbar || !toolbar.classList.contains('ql-toolbar')) {
    // Fallback: find by query (Quill always places toolbar adjacent to container)
    toolbar = container.parentElement && container.parentElement.querySelector('.ql-toolbar');
    if (!toolbar) return;
  }

  // WCAG: Quill builds its toolbar with icon-only <button>s that have no
  // accessible name. Screen readers announce them as "button" with no
  // function, and WAVE flags them as "empty button". We add aria-label on
  // each known button class after Quill builds the toolbar. Same for the
  // header <select> which lacks a label. List is hardcoded against Quill
  // Snow theme defaults, keep in sync with the toolbar config above.
  var ariaLabels = {
    'ql-bold': 'Bold',
    'ql-italic': 'Italic',
    'ql-underline': 'Underline',
    'ql-strike': 'Strikethrough',
    'ql-link': 'Insert link',
    'ql-image': 'Insert image',
    'ql-clean': 'Remove formatting',
    'ql-blockquote': 'Blockquote',
    'ql-code-block': 'Code block'
  };
  Object.keys(ariaLabels).forEach(function(cls) {
    toolbar.querySelectorAll('button.' + cls).forEach(function(btn) {
      if (!btn.hasAttribute('aria-label')) btn.setAttribute('aria-label', ariaLabels[cls]);
    });
  });
  // List buttons disambiguate via value attribute
  toolbar.querySelectorAll('button.ql-list[value="ordered"]').forEach(function(btn) {
    if (!btn.hasAttribute('aria-label')) btn.setAttribute('aria-label', 'Ordered list');
  });
  toolbar.querySelectorAll('button.ql-list[value="bullet"]').forEach(function(btn) {
    if (!btn.hasAttribute('aria-label')) btn.setAttribute('aria-label', 'Bullet list');
  });
  // Align buttons disambiguate via value attribute (default '' = left)
  toolbar.querySelectorAll('button.ql-align').forEach(function(btn) {
    if (btn.hasAttribute('aria-label')) return;
    var val = btn.getAttribute('value') || '';
    var label = val === 'center' ? 'Align center'
              : val === 'right' ? 'Align right'
              : val === 'justify' ? 'Justify'
              : 'Align left';
    btn.setAttribute('aria-label', label);
  });
  // Header dropdown, a <select>, not a button. Needs its own label.
  toolbar.querySelectorAll('select.ql-header').forEach(function(sel) {
    if (!sel.hasAttribute('aria-label')) sel.setAttribute('aria-label', 'Heading level');
  });

  // Quill's link/video/formula tooltip, a hidden popover that appears when
  // the user clicks the link button or an existing link in the editor.
  // It contains an unlabeled <input> for the URL and an empty <a> preview.
  // Both are flagged by WAVE even when display:none, because WAVE scans the
  // DOM not the visual state. We label the input + give the empty preview
  // anchor a fallback name. Tooltip placement varies by Quill version -
  // check toolbar's parent, container's parent, and finally container itself.
  var tooltip = null;
  var searchRoots = [toolbar.parentElement, container.parentElement, container];
  for (var i = 0; i < searchRoots.length && !tooltip; i++) {
    if (searchRoots[i]) tooltip = searchRoots[i].querySelector('.ql-tooltip');
  }
  if (tooltip) {
    var input = tooltip.querySelector('input[type="text"]');
    if (input && !input.hasAttribute('aria-label')) {
      // The placeholder shifts (Enter link URL / Embed URL / formula) as
      // Quill switches modes, "Enter URL" is a reasonable umbrella label.
      input.setAttribute('aria-label', 'Enter URL');
    }
    // The preview anchor is empty until a link is entered. Give it an
    // accessible name so WAVE stops flagging it; the visible <a class=
    // "ql-action"> next to it is the actual interactive element. We pick
    // aria-label because the preview becomes meaningful when populated
    // (it shows the current URL).
    var preview = tooltip.querySelector('a.ql-preview');
    if (preview && !preview.hasAttribute('aria-label')) {
      preview.setAttribute('aria-label', 'Current link URL');
    }
  }

  // Inject S/M/L button group right before the "clean" button (last group).
  var group = document.createElement('span');
  group.className = 'ql-formats lesson-img-size-toolbar';
  group.innerHTML = '<button type="button" data-img-size="small" title="Small image" aria-label="Small image size">S</button>'
    + '<button type="button" data-img-size="medium" title="Medium image" aria-label="Medium image size">M</button>'
    + '<button type="button" data-img-size="large" title="Large image" aria-label="Large image size">L</button>';
  // Insert before the last .ql-formats group (which is "clean")
  var groups = toolbar.querySelectorAll('.ql-formats');
  var cleanGroup = groups[groups.length - 1];
  if (cleanGroup) {
    toolbar.insertBefore(group, cleanGroup);
  } else {
    toolbar.appendChild(group);
  }

  // Track the currently-selected image. Click on an image to select it.
  // Clicking elsewhere deselects.
  var selectedImg = null;
  function selectImage(img) {
    if (selectedImg) selectedImg.classList.remove('lesson-img-selected');
    selectedImg = img;
    if (selectedImg) selectedImg.classList.add('lesson-img-selected');
    // Toggle the "alive" group state, drives the CSS that lights up the
    // S/M/L buttons in solid purple so creators see where to click.
    group.classList.toggle('has-selection', !!selectedImg);
    // Enable/disable the S/M/L buttons based on whether we have a selection
    group.querySelectorAll('button').forEach(function(btn) {
      btn.disabled = !selectedImg;
      btn.classList.toggle('lesson-img-size-active', !!selectedImg && selectedImg.classList.contains('lesson-img-size-' + btn.dataset.imgSize));
    });
  }

  quill.root.addEventListener('click', function(e) {
    if (e.target.tagName === 'IMG') {
      selectImage(e.target);
    } else {
      selectImage(null);
    }
  });

  // S/M/L button handlers
  group.addEventListener('click', function(e) {
    var btn = e.target.closest('button[data-img-size]');
    if (!btn || !selectedImg) return;
    var size = btn.dataset.imgSize;
    selectedImg.classList.remove('lesson-img-size-small', 'lesson-img-size-medium', 'lesson-img-size-large');
    selectedImg.classList.add('lesson-img-size-' + size);
    // Refresh active button state
    group.querySelectorAll('button').forEach(function(b) {
      b.classList.toggle('lesson-img-size-active', b.dataset.imgSize === size);
    });
    // Trigger save (manually since text-change won't fire for class changes)
    var html = quill.root.innerHTML;
    if (html === '<p><br></p>') html = '';
    updateLessonField(mi, li, 'text_content', sanitizeLessonHtml(html));
  });

  // Initialize buttons disabled (no image selected yet)
  group.querySelectorAll('button').forEach(function(btn) { btn.disabled = true; });
}

// Tear down a Quill instance when its lesson collapses. Prevents stale
// instances and DOM listeners accumulating as creators expand/collapse
// repeatedly.
function unmountLessonEditor(mi, li) {
  var key = mi + '-' + li;
  var quill = _courseQuillInstances[key];
  if (!quill) return;
  // Quill 1.x has no public destroy(). Best-effort cleanup: remove the
  // toolbar element and clear the reference. The container div itself
  // gets removed on re-render.
  try { quill.off('text-change'); } catch (e) {}
  delete _courseQuillInstances[key];
}

// Quiz card render helper. One quiz per module, always rendered after the
// lessons list (above the Add Video / Add Lesson / Add Quiz button row).
// Visually consistent with lesson cards but distinguished by a QUIZ pill
// and question-count badge in the collapsed state.
function renderQuizCard(quiz, mi) {
  if (!quiz) return '';
  var collapsed = quiz._collapsed !== false;
  var questions = Array.isArray(quiz.questions) ? quiz.questions : [];
  var qCount = questions.length;
  var requireBadge = quiz.require_pass
    ? '<span class="course-s-quiz-badge" title="Required to pass" aria-label="Required to pass"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg></span>'
    : '';

  // Header. Trash button only appears when expanded (matches lesson card
  // pattern - collapsed view stays clean). Caret rotates via CSS when
  // expanded. Layout matches lesson cards: descriptive content on the
  // left, type pill near the right, caret at the far right.
  var trashBtn = collapsed
    ? ''
    : '<span><button data-course-action="remove-quiz" data-course-mi="' + mi + '" class="course-s-f3bc45" title="Delete quiz" aria-label="Delete quiz"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></span>';
  var header = '<div class="course-s-quiz-header" data-course-action="toggle-quiz-collapse" data-course-mi="' + mi + '">'
    + '<span class="course-s-quiz-count">' + qCount + ' question' + (qCount === 1 ? '' : 's') + '</span>'
    + requireBadge
    + '<span class="course-s-quiz-pill" title="Quiz" aria-label="Quiz"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></span>'
    + trashBtn
    + '<svg class="course-s-quiz-caret' + (collapsed ? '' : ' open') + '" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
    + '</div>';

  if (collapsed) {
    return '<div id="course-quiz-' + mi + '" class="course-s-quiz-card">' + header + '</div>';
  }

  // Expanded view: require-pass toggle row, then each question with its 4
  // answers, then Add Question (if room) + Remove Quiz buttons.
  var requireToggle = '<label class="course-s-quiz-require">'
    + '<input type="checkbox" data-course-action="toggle-require-pass" data-course-event="change" data-course-mi="' + mi + '"' + (quiz.require_pass ? ' checked' : '') + '>'
    + '<span class="course-s-quiz-require-text">'
    + '<strong>Require students to pass before continuing</strong>'
    + '<small>If on, the student must get every answer right (unlimited retakes). If off, results show correct answers for any wrong picks then Next unlocks.</small>'
    + '</span>'
    + '</label>';

  var questionsHtml = questions.map(function(q, qi) {
    var answersHtml = (Array.isArray(q.answers) ? q.answers : []).map(function(a, ai) {
      // Radio name is per-question (uses question index for uniqueness across
      // the page). Marking one answer correct visually replaces all other
      // is_correct flags in that question via the mark-answer-correct handler.
      var radioName = 'q-correct-m' + mi + '-q' + qi;
      return '<div class="course-s-quiz-answer-row">'
        + '<input type="radio" name="' + escapeHtml(radioName) + '" data-course-action="mark-answer-correct" data-course-event="change" data-course-mi="' + mi + '" data-course-qi="' + qi + '" data-course-ai="' + ai + '"' + (a && a.is_correct ? ' checked' : '') + ' aria-label="Mark answer ' + (ai + 1) + ' as correct">'
        + '<input type="text" value="' + escapeHtml((a && a.text) || '') + '" placeholder="Answer ' + (ai + 1) + '" data-course-action="update-answer-text" data-course-event="input" data-course-mi="' + mi + '" data-course-qi="' + qi + '" data-course-ai="' + ai + '" aria-label="Answer ' + (ai + 1) + ' text" class="course-s-quiz-answer-input">'
        + '</div>';
    }).join('');

    return '<div class="course-s-quiz-question">'
      + '<div class="course-s-quiz-question-head">'
      + '<span class="course-s-quiz-qnum">Q' + (qi + 1) + '</span>'
      + '<input type="text" value="' + escapeHtml(q.text || '') + '" placeholder="Question text" data-course-action="update-question-text" data-course-event="input" data-course-mi="' + mi + '" data-course-qi="' + qi + '" aria-label="Question ' + (qi + 1) + ' text" class="course-s-quiz-q-input">'
      + '<button type="button" data-course-action="remove-question" data-course-mi="' + mi + '" data-course-qi="' + qi + '" class="course-s-quiz-q-remove" aria-label="Remove question ' + (qi + 1) + '">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>'
      + '</button>'
      + '</div>'
      + '<div class="course-s-quiz-answers">' + answersHtml + '</div>'
      + '</div>';
  }).join('');

  var addQuestionBtn = qCount < 10
    ? '<button type="button" data-course-action="add-question" data-course-mi="' + mi + '" class="course-s-quiz-add-q">'
      + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
      + 'Add Question</button>'
    : '<div class="course-s-quiz-q-cap">Maximum 10 questions reached</div>';

  return '<div id="course-quiz-' + mi + '" class="course-s-quiz-card expanded">'
    + header
    + '<div class="course-s-quiz-body">'
    + requireToggle
    + (qCount > 0 ? questionsHtml : '<div class="course-s-quiz-empty">No questions yet. Click Add Question below to create one.</div>')
    + '<div class="course-s-quiz-actions">'
    + addQuestionBtn
    + '<button type="button" data-course-action="toggle-quiz-collapse" data-course-mi="' + mi + '" class="course-s-eb7439">Done</button>'
    + '</div>'
    + '</div>'
    + '</div>';
}

function renderCourseModules() {
  const container = document.getElementById('course-modules-list');
  const empty = document.getElementById('course-modules-empty');

  if (courseModules.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  container.innerHTML = courseModules.map((mod, mi) => {
    const lessonsHtml = (mod.lessons || []).map((l, li) => {
      const isVideo = l.lesson_type === 'video';
      const typeLabel = isVideo
        ? '<span class="course-s-955d08" title="Video lesson" aria-label="Video lesson"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg></span>'
        : '<span class="course-s-e89353" title="Text lesson" aria-label="Text lesson"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg></span>';
      const isCollapsed = l._collapsed;
      // For text lessons, strip HTML tags before slicing for the preview.
      // text_content is now rich HTML; without stripping, the preview shows
      // literal `<p>` / `<br>` markup which is ugly and confusing.
      var previewSource = isVideo
        ? (l.video_url || (l.bunny_video_id ? 'Hosted on Ryxa' : ''))
        : (l.text_content || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const preview = previewSource.slice(0, isVideo ? 40 : 50);

      if (isCollapsed) {
        // Collapsed view. Works for empty lessons too - the title span below
        // falls back to "Untitled Video" / "Untitled Lesson" when l.title is
        // blank, so an empty collapsed lesson still renders sensibly.
        return '<div id="course-item-' + mi + '-' + li + '" data-course-action="expand-lesson" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-fce34d">'
          + '<div class="bio-s-e3f610">'
          + '<span class="course-s-229509">' + (li + 1) + '.</span>'
          + '<span class="course-s-d63d24">' + escapeHtml(l.title || (isVideo ? 'Untitled Video' : 'Untitled Lesson')) + '</span>'
          + typeLabel 
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="bio-s-f38a95"><polyline points="6 9 12 15 18 9"/></svg>'
          + '</div>'
          + (preview ? '<div class="course-s-bd2dcd">' + escapeHtml(preview) + (previewSource.length > preview.length ? '...' : '') + '</div>' : '')
          + '</div>';
      }

      // Expanded view
      return '<div id="course-item-' + mi + '-' + li + '" class="course-s-8ed674">'
        + '<div data-course-action="collapse-lesson" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-60e468">'
        + '<span class="course-s-229509">' + (li + 1) + '.</span>'
        + '<span class="course-s-d63d24">' + escapeHtml(l.title || (isVideo ? 'Untitled Video' : 'Untitled Lesson')) + '</span>'
        + typeLabel 
        + '<span><button data-course-action="remove-lesson" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-f3bc45" title="Delete lesson" aria-label="Delete lesson"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></span>'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="bio-s-f38a95"><polyline points="18 15 12 9 6 15"/></svg>'
        + '</div>'
        + '<div class="course-s-c42e2a">'
        + '<div class="mk-s-e4ad4a">'
        + '<input type="text" value="' + escapeHtml(l.title) + '" placeholder="Lesson title" data-course-action="update-lesson-field" data-course-event="input" data-course-mi="' + mi + '" data-course-li="' + li + '" data-course-field="title" aria-label="Lesson title" class="course-s-9fc438">'
        + '</div>'
        + (isVideo
          ? (function() {
              // Two-tab video UI: "Upload to Ryxa" (primary) | "Paste URL" (secondary).
              // Upload tab states: idle (drop zone) -> uploading (progress) ->
              // processing (Bunny encoding) -> ready (thumbnail + replace button).
              // Paste URL tab keeps the legacy YouTube/Vimeo/Loom paste flow intact.
              // Default-active tab: "Upload" unless the lesson already has a paste-URL
              // and no Bunny video (creator returning to existing work shouldn't be
              // jolted away from where their content already lives).
              var hasBunny = !!l.bunny_video_id;
              var hasPasteUrl = !!(l.video_url || '').trim();
              var defaultTab = (hasPasteUrl && !hasBunny) ? 'paste' : 'upload';
              var lessonId = l.id || '';

              // Paste-URL panel (unchanged from legacy flow)
              var platform = detectVideoPlatform(l.video_url || '');
              var pasteStatusHtml = '';
              if (platform) {
                pasteStatusHtml = '<div class="course-s-vurl-status valid" id="vurl-status-' + mi + '-' + li + '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' + platform + '</div>';
              } else if (hasPasteUrl) {
                pasteStatusHtml = '<div class="course-s-vurl-status invalid" id="vurl-status-' + mi + '-' + li + '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Paste a YouTube, Vimeo, or Loom link</div>';
              } else {
                pasteStatusHtml = '<div class="course-s-vurl-status" id="vurl-status-' + mi + '-' + li + '"></div>';
              }
              var pastePanel = '<div class="course-vid-panel" data-vid-panel="paste" aria-hidden="' + (defaultTab === 'paste' ? 'false' : 'true') + '">'
                + '<div class="course-s-vurl-wrap">'
                + '<input type="url" value="' + escapeHtml(l.video_url || '') + '" placeholder="Video URL (YouTube, Vimeo, or Loom)" data-course-action="validate-video-url" data-course-event="input" data-course-action-blur="validate-video-url-blur" data-course-mi="' + mi + '" data-course-li="' + li + '" data-course-field="video_url" aria-label="Video URL" class="course-s-59ebc5">'
                + pasteStatusHtml
                + '</div>'
                + '</div>';

              // Upload panel state
              var uploadContent = '';
              if (l.bunny_video_status === 'ready' && l.bunny_video_id) {
                // Ready: show thumbnail + duration + replace button
                var dur = l.bunny_video_duration_seconds ? formatVideoDuration(l.bunny_video_duration_seconds) : '';
                var thumbStyle = l.bunny_thumbnail_url ? ('background-image:url(' + escapeHtml(l.bunny_thumbnail_url) + ');') : '';
                var thumbInner = l.bunny_thumbnail_url ? '' :
                  '<div class="course-vid-ready-thumb-fallback"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>';
                uploadContent = '<div class="course-vid-ready" id="vid-ready-' + mi + '-' + li + '">'
                  + '<div class="course-vid-ready-thumb" style="' + thumbStyle + '">' + thumbInner + '</div>'
                  + '<div class="course-vid-ready-meta">'
                  + '<div class="course-vid-ready-title"><svg class="course-vid-ready-title-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Video ready</div>'
                  + '<div class="course-vid-ready-sub">' + escapeHtml(dur || 'Hosted on Ryxa') + '</div>'
                  + '</div>'
                  + '<button type="button" data-course-action="replace-bunny-video" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-vid-ready-replace">Replace</button>'
                  + '</div>';
              } else if (l.bunny_video_status === 'processing' || l.bunny_video_status === 'uploading') {
                // Processing on Bunny side (encoding), set up a polling indicator
                uploadContent = '<div class="course-vid-processing" id="vid-processing-' + mi + '-' + li + '" data-lesson-id="' + escapeHtml(lessonId) + '">'
                  + '<div class="course-vid-processing-spin"></div>'
                  + '<div class="course-vid-processing-text">'
                  + '<span>Processing video</span>'
                  + '<span class="course-vid-processing-sub">This usually takes 1-3 minutes. You can keep editing.</span>'
                  + '</div>'
                  + '</div>';
              } else if (l.bunny_video_status === 'failed') {
                uploadContent = '<div class="course-vid-failed">'
                  + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
                  + '<span>Video processing failed. Try uploading again.</span>'
                  + '<button type="button" data-course-action="reset-bunny-video" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-vid-failed-retry">Reset</button>'
                  + '</div>';
              } else {
                // Idle: drop zone
                uploadContent = '<div class="course-vid-drop" data-course-action="open-bunny-picker" data-course-mi="' + mi + '" data-course-li="' + li + '" role="button" tabindex="0" aria-label="Upload video">'
                  + '<svg class="course-vid-drop-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
                  + '<div class="course-vid-drop-title">Drop a video here or click to upload</div>'
                  + '<div class="course-vid-drop-hint">MP4, MOV, or WebM. <strong>Up to 5 GB.</strong> We compress and stream automatically.</div>'
                  + '<div class="course-vid-drop-hint" style="margin-top:4px;">After upload, videos take a few minutes to process before they\'re ready to play.</div>'
                  + '</div>';
              }

              var uploadPanel = '<div class="course-vid-panel" data-vid-panel="upload" aria-hidden="' + (defaultTab === 'upload' ? 'false' : 'true') + '">'
                + uploadContent
                + '</div>';

              return '<div data-course-vid-host="' + mi + '-' + li + '" data-course-mi="' + mi + '" data-course-li="' + li + '">'
                + '<div class="course-vid-tabs" role="tablist">'
                + '<button type="button" role="tab" aria-selected="' + (defaultTab === 'upload' ? 'true' : 'false') + '" data-course-action="switch-vid-tab" data-vid-tab="upload" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-vid-tab">Upload to Ryxa</button>'
                + '<button type="button" role="tab" aria-selected="' + (defaultTab === 'paste' ? 'true' : 'false') + '" data-course-action="switch-vid-tab" data-vid-tab="paste" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-vid-tab">Paste URL</button>'
                + '</div>'
                + uploadPanel
                + pastePanel
                + '</div>';
            })()
          : '<div id="lesson-editor-' + mi + '-' + li + '" class="course-s-quill-host" data-course-mi="' + mi + '" data-course-li="' + li + '"></div>')
        // Downloadable files (per lesson, max 5, 50 MB each, shared with
        // Digital Products on the 500 MB account quota).
        + (function() {
            // Files only available for saved lessons (need a DB lesson id).
            var isNew = typeof l.id === 'string' && l.id.indexOf('new_') === 0;
            if (isNew) {
              return '<div class="course-s-files-panel">'
                + '<div class="course-s-files-header">'
                + '<span class="course-s-files-title">Downloads</span>'
                + '<span class="course-s-files-locked">Save the course first to attach files to this lesson</span>'
                + '</div>'
                + '</div>';
            }
            var files = lessonFilesByLessonId[l.id] || [];
            var fileRows = files.map(function(f) {
              return '<div class="course-s-file-row">'
                + '<svg class="course-s-file-icn" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
                + '<span class="course-s-file-name">' + escapeHtml(f.filename) + '</span>'
                + '<span class="course-s-file-size">' + window.FileValidation.formatBytes(f.file_size_bytes) + '</span>'
                + '<button type="button" data-course-action="delete-lesson-file" data-course-lesson-id="' + l.id + '" data-course-file-id="' + f.id + '" class="course-s-file-del" title="Delete file" aria-label="Delete file">'
                + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
                + '</button>'
                + '</div>';
            }).join('');
            var canAddMore = files.length < 5;
            var addBtn = canAddMore
              ? '<label class="course-s-file-add">'
                + '<input type="file" data-course-action="add-lesson-file" data-course-event="change" data-course-mi="' + mi + '" data-course-li="' + li + '" hidden>'
                + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
                + 'Add file</label>'
              : '<span class="course-s-file-limit">5-file limit reached</span>';
            return '<div class="course-s-files-panel">'
              + '<div class="course-s-files-header">'
              + '<span class="course-s-files-title">Downloads</span>'
              + '<span class="course-s-files-hint">Max 5 files, 50 MB each. Students can download these from the lesson page.</span>'
              + '</div>'
              + (fileRows ? '<div class="course-s-files-list">' + fileRows + '</div>' : '')
              + '<div class="course-s-files-actions">' + addBtn + '</div>'
              + '</div>';
          })()
        // Move / info / done buttons. Icon-only to keep the row compact -
        // labels were redundant with the well-known up/down/info glyphs and
        // ate horizontal space. "Done" collapses the lesson (state is already
        // saved on every keystroke via update-lesson-field; this is a UX cue
        // for the user, not a real persistence step).
        + '<div class="course-s-f5e487">'
        + (li > 0 ? '<button data-course-action="move-lesson-up" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-1de440" title="Move lesson up" aria-label="Move lesson up"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>' : '')
        + (li < (mod.lessons.length - 1) ? '<button data-course-action="move-lesson-down" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-1de440" title="Move lesson down" aria-label="Move lesson down"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>' : '')
        + '<div class="bio-s-7623f0"></div>'
        + '<button data-course-action="collapse-lesson" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-eb7439" title="Done editing">Done</button>'
        + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    return '<div class="course-s-be7f41">'
      + '<div class="course-s-4368db">'
      + '<div class="course-s-d97d4b">'
      + (mi > 0 ? '<button data-course-action="move-module-up" data-course-mi="' + mi + '" class="course-s-f1cd5a" title="Move module up" aria-label="Move module up"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>' : '<div class="course-s-0a4e53"></div>')
      + (mi < (courseModules.length - 1) ? '<button data-course-action="move-module-down" data-course-mi="' + mi + '" class="course-s-f1cd5a" title="Move module down" aria-label="Move module down"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>' : '<div class="course-s-0a4e53"></div>')
      + '</div>'
      + '<span class="course-s-2653e1">Module ' + (mi + 1) + '</span>'
      + '<input type="text" value="' + escapeHtml(mod.title) + '" placeholder="Module title (e.g., Getting Started)" data-course-action="update-module-title" data-course-event="input" data-course-mi="' + mi + '" aria-label="Module title" class="course-s-ced5e0">'
      + '<button data-course-action="remove-module" data-course-mi="' + mi + '" class="course-s-02ecf5" title="Remove module" aria-label="Remove module"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
      + '</div>'
      + lessonsHtml
      + (mod.quiz ? renderQuizCard(mod.quiz, mi) : '')
      + '<div class="course-s-3fed56">'
      + '<button data-course-action="add-lesson" data-course-mi="' + mi + '" data-course-lesson-type="video" class="course-s-be13d8">'
      + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
      + 'Add Video</button>'
      + '<button data-course-action="add-lesson" data-course-mi="' + mi + '" data-course-lesson-type="text" class="course-s-be13d8">'
      + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>'
      + 'Add Lesson</button>'
      // Add Quiz button - hidden when a quiz already exists for this module
      // (UNIQUE constraint on module_id enforces 1 quiz per module).
      + (!mod.quiz ? ('<button data-course-action="add-quiz" data-course-mi="' + mi + '" class="course-s-be13d8">'
        + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
        + 'Add Quiz</button>') : '')
      + '</div>'
      + '</div>';
  }).join('');

  // Mount Quill editors for any text lessons that are currently expanded.
  // Runs every render, idempotent (mountLessonEditor skips already-mounted
  // hosts). On first call, lazy-loads Quill+DOMPurify; subsequent calls
  // resolve instantly from the cached promise.
  var hosts = container.querySelectorAll('.course-s-quill-host');
  if (hosts.length > 0) {
    ensureQuillLoaded().then(function() {
      hosts.forEach(function(host) {
        var mi = parseInt(host.dataset.courseMi, 10);
        var li = parseInt(host.dataset.courseLi, 10);
        mountLessonEditor(mi, li);
      });
    }).catch(function(err) {
      console.error('Lesson editor failed to load:', err);
      // Fallback: replace each Quill host with a plain textarea so the
      // creator can still edit. Better than a blank box.
      hosts.forEach(function(host) {
        var mi = parseInt(host.dataset.courseMi, 10);
        var li = parseInt(host.dataset.courseLi, 10);
        var lesson = courseModules[mi] && courseModules[mi].lessons[li];
        var current = (lesson && lesson.text_content) || '';
        // Strip HTML tags for the fallback textarea
        var asText = current.replace(/<[^>]+>/g, '').trim();
        var ta = document.createElement('textarea');
        ta.value = asText;
        ta.placeholder = 'Lesson content (editor failed to load)...';
        ta.className = 'course-s-2e11f6';
        ta.rows = 6;
        ta.oninput = function() { updateLessonField(mi, li, 'text_content', ta.value); };
        host.replaceWith(ta);
      });
    });
  }

  // Wire Bunny drop zones and resume any in-flight encoding polls.
  // Safe to call on every render: wireBunnyDropZones is idempotent
  // (skips elements already wired), and poll-resumption checks for
  // existing polls before starting new ones.
  bunnyPostRenderSetup(container);
}


// =============================================================================
// BUNNY STREAM UPLOAD MODULE
// =============================================================================
// Creator-side upload flow for course video lessons. Tab UI (Upload to Ryxa |
// Paste URL), drag-and-drop, TUS chunked uploads direct to Bunny, progress
// bar, post-upload status polling, replace flow.
//
// Server endpoints used:
//   POST /api/bunny-create-video    - get TUS upload credentials
//   POST /api/bunny-lesson-status   - poll encoding status
//   POST /api/bunny-delete-video    - remove existing video before re-upload
//
// Security: all server endpoints verify auth + ownership. Per-video size
// cap (5 GB) and per-creator quota (20 hours) enforced server-side. Client
// caps are UX hints only.
// =============================================================================

var BUNNY_MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
var BUNNY_ALLOWED_MIME_PREFIXES = ['video/'];
var BUNNY_POLL_INTERVAL_MS = 5000;  // 5s between status polls
var BUNNY_POLL_MAX_DURATION_MS = 20 * 60 * 1000;  // give up polling after 20 min
var _bunnyUploadsByLesson = {};  // lessonKey -> {tusUpload, controller, hostEl}
var _bunnyPollsByLesson = {};    // lessonKey -> {timerId, startedAt}

function lessonKey(mi, li) { return mi + '-' + li; }

function formatVideoDuration(totalSeconds) {
  totalSeconds = Math.max(0, parseInt(totalSeconds, 10) || 0);
  var h = Math.floor(totalSeconds / 3600);
  var m = Math.floor((totalSeconds % 3600) / 60);
  var s = totalSeconds % 60;
  if (h > 0) {
    return h + 'h ' + (m < 10 ? '0' + m : m) + 'm';
  }
  return m + ':' + (s < 10 ? '0' + s : s);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Switch between the Upload tab and Paste URL tab inside a lesson card
courseRegisterAction('switch-vid-tab', (e, el) => {
  var mi = parseInt(el.dataset.courseMi, 10);
  var li = parseInt(el.dataset.courseLi, 10);
  var tab = el.dataset.vidTab; // 'upload' or 'paste'
  var host = document.querySelector('[data-course-vid-host="' + lessonKey(mi, li) + '"]');
  if (!host) return;
  var tabs = host.querySelectorAll('.course-vid-tab');
  tabs.forEach(function(t) {
    t.setAttribute('aria-selected', t.dataset.vidTab === tab ? 'true' : 'false');
  });
  var panels = host.querySelectorAll('.course-vid-panel');
  panels.forEach(function(p) {
    p.setAttribute('aria-hidden', p.dataset.vidPanel === tab ? 'false' : 'true');
  });
});

// Open the native file picker for the drop zone
courseRegisterAction('open-bunny-picker', (e, el) => {
  var mi = parseInt(el.dataset.courseMi, 10);
  var li = parseInt(el.dataset.courseLi, 10);
  openBunnyFilePicker(mi, li);
});

function openBunnyFilePicker(mi, li) {
  // Reuse a hidden file input so we don't pile up DOM nodes across opens
  var input = document.getElementById('bunny-file-picker');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'bunny-file-picker';
    input.accept = 'video/*';
    input.style.display = 'none';
    document.body.appendChild(input);
  }
  // Replace the change handler each open so it targets the right lesson
  input.onchange = function() {
    var file = input.files && input.files[0];
    input.value = '';  // allow re-selecting the same file
    if (!file) return;
    startBunnyUpload(mi, li, file);
  };
  input.click();
}

// Drag-and-drop wiring: attach listeners to the drop zone after every render
function wireBunnyDropZones(container) {
  if (!container) return;
  var zones = container.querySelectorAll('.course-vid-drop');
  zones.forEach(function(zone) {
    if (zone._bunnyWired) return;
    zone._bunnyWired = true;
    zone.addEventListener('dragover', function(ev) {
      ev.preventDefault();
      zone.classList.add('is-drag');
    });
    zone.addEventListener('dragleave', function() {
      zone.classList.remove('is-drag');
    });
    zone.addEventListener('drop', function(ev) {
      ev.preventDefault();
      zone.classList.remove('is-drag');
      var file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (!file) return;
      var mi = parseInt(zone.dataset.courseMi, 10);
      var li = parseInt(zone.dataset.courseLi, 10);
      startBunnyUpload(mi, li, file);
    });
    // Keyboard: Space or Enter on the focused drop zone opens the picker
    zone.addEventListener('keydown', function(ev) {
      if (ev.key === ' ' || ev.key === 'Enter') {
        ev.preventDefault();
        var mi = parseInt(zone.dataset.courseMi, 10);
        var li = parseInt(zone.dataset.courseLi, 10);
        openBunnyFilePicker(mi, li);
      }
    });
  });
}

async function startBunnyUpload(mi, li, file) {
  var lesson = courseModules[mi] && courseModules[mi].lessons[li];
  if (!lesson) {
    showModalAlert('Upload failed', 'Could not find the lesson. Try refreshing the page.');
    return;
  }

  // Client-side guards (server enforces too; these are UX hints)
  if (!file.type || !BUNNY_ALLOWED_MIME_PREFIXES.some(function(p) { return file.type.indexOf(p) === 0; })) {
    showModalAlert('Unsupported file', 'Please choose a video file (MP4, MOV, WebM, or similar).');
    return;
  }
  if (file.size > BUNNY_MAX_VIDEO_BYTES) {
    showModalAlert('Video is too large', 'Maximum is 5 GB per video. Your file is ' + formatBytes(file.size) + '. Try compressing the video before uploading.');
    return;
  }

  // The lesson must be saved (have a real UUID) before we can upload to it.
  // If the lesson is unsaved (new and never persisted), save the course
  // first so the lesson gets a real DB id.
  if (!lesson.id || String(lesson.id).indexOf('new_') === 0) {
    var hostBeforeSave = document.querySelector('[data-course-vid-host="' + lessonKey(mi, li) + '"]');
    if (hostBeforeSave) renderUploadProgress(hostBeforeSave, 0, file.size, 'Saving lesson...');
    try {
      await saveCourse({ silent: true });
    } catch (e) {
      showModalAlert('Could not save lesson', 'Save your course first, then try the upload again.');
      renderUploadIdle(mi, li);
      return;
    }
    // saveCourse re-renders. Re-fetch the lesson from working state and
    // verify it now has a real UUID (saveCourse should have populated it).
    lesson = courseModules[mi] && courseModules[mi].lessons[li];
    if (!lesson || !lesson.id || String(lesson.id).indexOf('new_') === 0) {
      showModalAlert('Could not save lesson', 'The lesson did not save correctly. Please save your course manually, then try uploading again.');
      renderUploadIdle(mi, li);
      return;
    }
  }

  var host = document.querySelector('[data-course-vid-host="' + lessonKey(mi, li) + '"]');
  if (!host) return;
  renderUploadProgress(host, 0, file.size, 'Preparing upload...');

  // Step 1: ask server for TUS credentials
  var token = Auth.getToken();
  var createRes;
  try {
    var resp = await fetch('/api/bunny-create-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({
        lesson_id: lesson.id,
        title: lesson.title || 'Untitled Video',
        expected_size_bytes: file.size
      })
    });
    createRes = await resp.json();
    if (!resp.ok) {
      showModalAlert('Upload failed', createRes.error || 'Could not start upload. Try again.');
      renderUploadIdle(mi, li);
      return;
    }
  } catch (e) {
    showModalAlert('Upload failed', 'Network error. Check your connection and try again.');
    renderUploadIdle(mi, li);
    return;
  }

  // Step 2: locally update lesson state so the bunny_video_id is in working
  // memory immediately. The DB row was already updated by the API on success.
  lesson.bunny_video_id = createRes.video_id;
  lesson.bunny_video_status = 'uploading';
  lesson.bunny_uploaded_at = new Date().toISOString();

  // Step 3: kick off the TUS upload
  if (typeof tus === 'undefined' || !tus.Upload) {
    showModalAlert('Upload failed', 'Upload library failed to load. Refresh the page and try again.');
    renderUploadIdle(mi, li);
    return;
  }

  var upload = new tus.Upload(file, {
    endpoint: createRes.upload_url,
    headers: createRes.upload_headers,
    chunkSize: 50 * 1024 * 1024,  // 50 MB chunks (Bunny's recommended size)
    retryDelays: [0, 3000, 5000, 10000, 20000],
    metadata: {
      filetype: file.type,
      title: lesson.title || 'Untitled Video'
    },
    onError: function(err) {
      console.error('Bunny TUS upload error:', err);
      var hostNow = document.querySelector('[data-course-vid-host="' + lessonKey(mi, li) + '"]');
      if (hostNow) {
        var panel = hostNow.querySelector('[data-vid-panel="upload"]');
        if (panel) {
          panel.innerHTML = '<div class="course-vid-failed">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
            + '<span>Upload failed. ' + escapeHtml((err && err.message) ? err.message.slice(0, 100) : 'Try again.') + '</span>'
            + '<button type="button" data-course-action="reset-bunny-video" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-vid-failed-retry">Try again</button>'
            + '</div>';
        }
      }
      delete _bunnyUploadsByLesson[lessonKey(mi, li)];
    },
    onProgress: function(uploaded, total) {
      var hostNow = document.querySelector('[data-course-vid-host="' + lessonKey(mi, li) + '"]');
      if (hostNow) renderUploadProgress(hostNow, uploaded, total, null);
    },
    onSuccess: function() {
      delete _bunnyUploadsByLesson[lessonKey(mi, li)];
      // Switch UI to "processing" and start polling for encode completion
      lesson.bunny_video_status = 'processing';
      var hostNow = document.querySelector('[data-course-vid-host="' + lessonKey(mi, li) + '"]');
      if (hostNow) {
        var panel = hostNow.querySelector('[data-vid-panel="upload"]');
        if (panel) {
          panel.innerHTML = '<div class="course-vid-processing">'
            + '<div class="course-vid-processing-spin"></div>'
            + '<div class="course-vid-processing-text">'
            + '<span>Processing video</span>'
            + '<span class="course-vid-processing-sub">This usually takes 1-3 minutes. You can keep editing.</span>'
            + '</div>'
            + '</div>';
        }
      }
      startBunnyStatusPoll(mi, li, lesson.id);

      // Auto-save the course so the upload result is persisted even if the
      // creator forgets to click Save. Prevents losing other in-memory edits
      // (title changes, preview toggles, etc.) made before the upload, and
      // gives the creator confidence that the video is "saved" without them
      // having to do anything else. Failures here are non-fatal: the Bunny
      // side is already persisted (webhook wrote bunny_video_id to the DB);
      // a failed autosave just means the creator's OTHER in-memory edits
      // would need a manual save to persist.
      saveCourse({ silent: true }).catch(function(err) {
        console.warn('Post-upload autosave failed (non-fatal):', err);
      });
    }
  });
  _bunnyUploadsByLesson[lessonKey(mi, li)] = { tusUpload: upload };
  upload.start();
}

function renderUploadProgress(host, uploaded, total, customLabel) {
  var panel = host.querySelector('[data-vid-panel="upload"]');
  if (!panel) return;
  var pct = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 0;
  var label = customLabel || ('Uploading ' + formatBytes(uploaded) + ' / ' + formatBytes(total));
  panel.innerHTML = '<div class="course-vid-progress-wrap">'
    + '<div class="course-vid-progress-head">'
    + '<span>' + escapeHtml(label) + '</span>'
    + '<span class="course-vid-progress-pct">' + pct + '%</span>'
    + '</div>'
    + '<div class="course-vid-progress-bar"><div class="course-vid-progress-fill" style="width:' + pct + '%"></div></div>'
    + '<div class="course-vid-progress-foot">'
    + '<span>' + (customLabel ? '' : 'Uploading to Ryxa') + '</span>'
    + '<button type="button" data-course-action="cancel-bunny-upload" data-course-mi="' + host.dataset.courseMi + '" data-course-li="' + host.dataset.courseLi + '" class="course-vid-progress-cancel">Cancel</button>'
    + '</div>'
    + '</div>';
}

function renderUploadIdle(mi, li) {
  var host = document.querySelector('[data-course-vid-host="' + lessonKey(mi, li) + '"]');
  if (!host) return;
  var panel = host.querySelector('[data-vid-panel="upload"]');
  if (!panel) return;
  panel.innerHTML = '<div class="course-vid-drop" data-course-action="open-bunny-picker" data-course-mi="' + mi + '" data-course-li="' + li + '" role="button" tabindex="0" aria-label="Upload video">'
    + '<svg class="course-vid-drop-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
    + '<div class="course-vid-drop-title">Drop a video here or click to upload</div>'
    + '<div class="course-vid-drop-hint">MP4, MOV, or WebM. <strong>Up to 5 GB.</strong> We compress and stream automatically.</div>'
    + '<div class="course-vid-drop-hint" style="margin-top:4px;">After upload, videos take a few minutes to process before they\'re ready to play.</div>'
    + '</div>';
  wireBunnyDropZones(host);
}

courseRegisterAction('cancel-bunny-upload', (e, el) => {
  var mi = parseInt(el.dataset.courseMi, 10);
  var li = parseInt(el.dataset.courseLi, 10);
  var key = lessonKey(mi, li);
  var entry = _bunnyUploadsByLesson[key];
  if (entry && entry.tusUpload) {
    try { entry.tusUpload.abort(true); } catch (e2) {}
  }
  delete _bunnyUploadsByLesson[key];
  // The DB row still has bunny_video_id pointing at an incomplete Bunny video.
  // Trigger an immediate cleanup via the delete-video API so we don't leak.
  cleanupOrphanedBunnyVideo(mi, li);
});

courseRegisterAction('reset-bunny-video', (e, el) => {
  var mi = parseInt(el.dataset.courseMi, 10);
  var li = parseInt(el.dataset.courseLi, 10);
  cleanupOrphanedBunnyVideo(mi, li);
});

courseRegisterAction('replace-bunny-video', (e, el) => {
  var mi = parseInt(el.dataset.courseMi, 10);
  var li = parseInt(el.dataset.courseLi, 10);
  showModalConfirm(
    'Replace video?',
    'This will delete the current video. Anyone watching this lesson will lose access until you upload a new one. Continue?',
    function() {
      cleanupOrphanedBunnyVideo(mi, li, function() {
        openBunnyFilePicker(mi, li);
      });
    }
  );
});

async function cleanupOrphanedBunnyVideo(mi, li, onDone) {
  var lesson = courseModules[mi] && courseModules[mi].lessons[li];
  if (!lesson || !lesson.id) {
    renderUploadIdle(mi, li);
    if (onDone) onDone();
    return;
  }
  // Stop any in-flight poll
  stopBunnyStatusPoll(mi, li);
  // Clear local lesson state immediately for UI snappiness
  lesson.bunny_video_id = null;
  lesson.bunny_video_status = null;
  lesson.bunny_video_duration_seconds = null;
  lesson.bunny_thumbnail_url = null;
  lesson.bunny_uploaded_at = null;
  renderUploadIdle(mi, li);
  // Fire-and-forget the server-side cleanup
  try {
    await fetch('/api/bunny-delete-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + Auth.getToken()
      },
      body: JSON.stringify({ lesson_id: lesson.id })
    });
  } catch (e) {
    console.warn('bunny-delete-video call failed (non-fatal, cron will retry):', e);
  }
  if (onDone) onDone();
}

function startBunnyStatusPoll(mi, li, lessonId) {
  var key = lessonKey(mi, li);
  stopBunnyStatusPoll(mi, li);  // safety: kill any prior poll
  var startedAt = Date.now();
  var consecutiveFailures = 0;
  var MAX_CONSECUTIVE_FAILURES = 3;
  var tick = async function() {
    if (Date.now() - startedAt > BUNNY_POLL_MAX_DURATION_MS) {
      stopBunnyStatusPoll(mi, li);
      return;
    }
    // Re-resolve the lesson id every tick. The course save uses a
    // DELETE-then-INSERT pattern, so each save (including the auto-save that
    // runs right after an upload) gives the lesson a brand-new DB id. The id
    // captured when the poll started goes stale and 404s. Reading the current
    // id from working state keeps the poll pointed at the live row.
    var currentLesson = courseModules[mi] && courseModules[mi].lessons[li];
    var activeLessonId = (currentLesson && currentLesson.id) ? currentLesson.id : lessonId;
    var success = false;
    try {
      var resp = await fetch('/api/bunny-lesson-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + Auth.getToken()
        },
        body: JSON.stringify({ lesson_id: activeLessonId })
      });
      if (resp.ok) {
        success = true;
        consecutiveFailures = 0;
        var data = await resp.json();
        var lesson = courseModules[mi] && courseModules[mi].lessons[li];
        if (lesson) {
          lesson.bunny_video_status = data.bunny_video_status;
          lesson.bunny_video_duration_seconds = data.bunny_video_duration_seconds;
          lesson.bunny_thumbnail_url = data.bunny_thumbnail_url;
        }
        if (data.bunny_video_status === 'ready' || data.bunny_video_status === 'failed') {
          stopBunnyStatusPoll(mi, li);
          renderBunnyFinalState(mi, li);
          return;
        }
      }
    } catch (e) {
      // transient network blip; counted as failure below
    }
    if (!success) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Give up. Likely the status endpoint isn't deployed or the lesson
        // doesn't exist anymore. Stop polling and show a friendly message
        // so the creator can refresh or contact support.
        console.warn('Bunny status polling stopped after ' + consecutiveFailures + ' consecutive failures for lesson ' + lessonId);
        stopBunnyStatusPoll(mi, li);
        var host = document.querySelector('[data-course-vid-host="' + lessonKey(mi, li) + '"]');
        if (host) {
          var panel = host.querySelector('[data-vid-panel="upload"]');
          if (panel) {
            panel.innerHTML = '<div class="course-vid-processing">'
              + '<div class="course-vid-processing-spin"></div>'
              + '<div class="course-vid-processing-text">'
              + '<span>Still processing</span>'
              + '<span class="course-vid-processing-sub">Refresh the page in a few minutes to see the latest status.</span>'
              + '</div>'
              + '</div>';
          }
        }
        return;
      }
    }
    _bunnyPollsByLesson[key] = {
      timerId: setTimeout(tick, BUNNY_POLL_INTERVAL_MS),
      startedAt: startedAt
    };
  };
  _bunnyPollsByLesson[key] = {
    timerId: setTimeout(tick, BUNNY_POLL_INTERVAL_MS),
    startedAt: startedAt
  };
}

function stopBunnyStatusPoll(mi, li) {
  var key = lessonKey(mi, li);
  var entry = _bunnyPollsByLesson[key];
  if (entry && entry.timerId) clearTimeout(entry.timerId);
  delete _bunnyPollsByLesson[key];
}

function renderBunnyFinalState(mi, li) {
  var lesson = courseModules[mi] && courseModules[mi].lessons[li];
  if (!lesson) return;
  var host = document.querySelector('[data-course-vid-host="' + lessonKey(mi, li) + '"]');
  if (!host) return;
  var panel = host.querySelector('[data-vid-panel="upload"]');
  if (!panel) return;
  if (lesson.bunny_video_status === 'ready') {
    var dur = lesson.bunny_video_duration_seconds ? formatVideoDuration(lesson.bunny_video_duration_seconds) : '';
    var thumbStyle = lesson.bunny_thumbnail_url ? ('background-image:url(' + escapeHtml(lesson.bunny_thumbnail_url) + ');') : '';
    var thumbInner = lesson.bunny_thumbnail_url ? '' :
      '<div class="course-vid-ready-thumb-fallback"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>';
    panel.innerHTML = '<div class="course-vid-ready">'
      + '<div class="course-vid-ready-thumb" style="' + thumbStyle + '">' + thumbInner + '</div>'
      + '<div class="course-vid-ready-meta">'
      + '<div class="course-vid-ready-title"><svg class="course-vid-ready-title-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Video ready</div>'
      + '<div class="course-vid-ready-sub">' + escapeHtml(dur || 'Hosted on Ryxa') + '</div>'
      + '</div>'
      + '<button type="button" data-course-action="replace-bunny-video" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-vid-ready-replace">Replace</button>'
      + '</div>';
    // Persist the finished state. Without this, if the creator does not press
    // Save after the video finishes, the DB row stays 'processing' and buyers
    // see a stale "still being processed" message. Auto-saving here keeps the
    // published course in sync. Non-blocking and non-fatal - a failure just
    // means the creator still needs to Save manually, as before.
    if (typeof saveCourse === 'function') {
      try { saveCourse({ silent: true }); } catch (e) { /* non-fatal */ }
    }
  } else if (lesson.bunny_video_status === 'failed') {
    panel.innerHTML = '<div class="course-vid-failed">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      + '<span>Video processing failed. Try uploading again.</span>'
      + '<button type="button" data-course-action="reset-bunny-video" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-vid-failed-retry">Reset</button>'
      + '</div>';
  }
}

// After every render, wire up drop zones and (re-)start polls for any lessons
// that are currently in 'uploading' or 'processing' state. This handles the
// case where the creator reloads the page mid-encode.
function bunnyPostRenderSetup(container) {
  wireBunnyDropZones(container);
  // Look for processing indicators and (re-)attach polls
  var processingEls = container.querySelectorAll('.course-vid-processing[data-lesson-id]');
  processingEls.forEach(function(el) {
    var lessonId = el.dataset.lessonId;
    if (!lessonId) return;
    // Find which mi/li this lesson belongs to in current working state
    for (var mi = 0; mi < courseModules.length; mi++) {
      var mod = courseModules[mi];
      for (var li = 0; li < (mod.lessons || []).length; li++) {
        if (mod.lessons[li].id === lessonId) {
          // Only start a poll if the lesson genuinely has a video that is
          // still encoding. Restarting purely off the DOM element caused a
          // poll (and a 404 against bunny-lesson-status) on lessons with no
          // video at all. Check the data, not just the rendered element.
          var lsn = mod.lessons[li];
          var stillEncoding = lsn.bunny_video_id
            && (lsn.bunny_video_status === 'processing' || lsn.bunny_video_status === 'uploading');
          if (stillEncoding && !_bunnyPollsByLesson[lessonKey(mi, li)]) {
            startBunnyStatusPoll(mi, li, lessonId);
          }
          return;
        }
      }
    }
  });
}



// Markup buttons
courseRegisterAction('max-upgrade', (e) => handleMaxUpgradeClick(e));
courseRegisterAction('open-editor', (e, el) => openCourseEditor(el.dataset.courseId || undefined));
courseRegisterAction('close-editor', () => closeCourseEditor());
courseRegisterAction('save', () => saveCourse());
courseRegisterAction('toggle-publish', () => toggleCoursePublish());
courseRegisterAction('toggle-marketplace', () => toggleCourseMarketplace());
courseRegisterAction('toggle-section', (e, el) => toggleCourseSection(el.dataset.courseSection));
courseRegisterAction('copy-url', () => copyCourseUrl());
courseRegisterAction('ai-cleanup', (e, el) => aiCleanUp(el.dataset.courseTarget));
courseRegisterAction('remove-cover', () => removeCourseCover());
courseRegisterAction('trigger-cover-upload', () => document.getElementById('course-cover-file').click());
courseRegisterAction('cover-selected', (e, el) => onCourseCoverSelect(el.files[0]));
courseRegisterAction('add-module', () => addCourseModule());
courseRegisterAction('delete', () => deleteCourse());

// Generic modal close (used by various dynamically-created modals)
courseRegisterAction('close-modal', (e, el) => {
  const modal = el.closest('div[style*=fixed]');
  if (modal) modal.remove();
});
courseRegisterAction('close-fixed-modal', (e, el) => {
  const modal = el.closest('div[style*=fixed]');
  if (modal) modal.remove();
});

// Lesson interactions (dynamically rendered)
courseRegisterAction('expand-lesson', (e, el) => {
  expandLesson(parseInt(el.dataset.courseMi, 10), parseInt(el.dataset.courseLi, 10));
});
courseRegisterAction('collapse-lesson', (e, el) => {
  collapseLesson(parseInt(el.dataset.courseMi, 10), parseInt(el.dataset.courseLi, 10));
});
courseRegisterAction('remove-lesson', (e, el) => {
  confirmRemoveLesson(parseInt(el.dataset.courseMi, 10), parseInt(el.dataset.courseLi, 10));
});
courseRegisterAction('add-lesson-file', async (e, el) => {
  // Triggered by the hidden <input type="file"> changing. Uploads the first
  // selected file (we don't support multi-select for lesson files since the
  // 5-file cap means batch upload is rarely useful). Clears input after.
  var files = Array.from(el.files || []);
  el.value = '';
  if (!files.length) return;
  var mi = parseInt(el.dataset.courseMi, 10);
  var li = parseInt(el.dataset.courseLi, 10);
  var lesson = courseModules[mi] && courseModules[mi].lessons[li];
  if (!lesson || !lesson.id) return;
  if (typeof lesson.id === 'string' && lesson.id.indexOf('new_') === 0) {
    showModalAlert('Save first', 'Save the course first to attach files to this lesson.');
    return;
  }
  // Refresh storage usage right before the cap check, so the pre-flight
  // doesn't rely on stale data (e.g. if another tab uploaded something).
  await refreshCourseStorage();
  var ok = await uploadLessonFile(currentCourseId, lesson.id, files[0]);
  if (ok) {
    refreshCourseStorage();
    renderCourseModules();
  }
});
courseRegisterAction('delete-lesson-file', async (e, el) => {
  var lessonId = el.dataset.courseLessonId;
  var fileId = el.dataset.courseFileId;
  if (!lessonId || !fileId) return;
  showModalConfirm('Delete File', 'Are you sure you want to delete this file?', async function() {
    var ok = await deleteLessonFile(lessonId, fileId);
    if (ok) {
      refreshCourseStorage();
      renderCourseModules();
    }
  });
});
courseRegisterAction('update-lesson-field', (e, el) => {
  updateLessonField(
    parseInt(el.dataset.courseMi, 10),
    parseInt(el.dataset.courseLi, 10),
    el.dataset.courseField,
    el.value
  );
});
// Video URL input: on every keystroke, save the value AND show a green check
// + platform name when the URL matches a supported platform. We don't show
// red mid-type, that would flash a "wrong" state at every character. The
// blur-time handler below covers the post-typing red state.
courseRegisterAction('validate-video-url', (e, el) => {
  var mi = parseInt(el.dataset.courseMi, 10);
  var li = parseInt(el.dataset.courseLi, 10);
  updateLessonField(mi, li, 'video_url', el.value);
  var status = document.getElementById('vurl-status-' + mi + '-' + li);
  if (!status) return;
  var platform = detectVideoPlatform(el.value);
  if (platform) {
    status.className = 'course-s-vurl-status valid';
    status.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' + platform;
  } else {
    // Stay neutral while the user is still typing, blur-time will set red.
    status.className = 'course-s-vurl-status';
    status.innerHTML = '';
  }
});
// Blur-time check: if the field has content but doesn't match any platform,
// surface the helpful warning. Cleared fields stay neutral.
courseRegisterAction('validate-video-url-blur', (e, el) => {
  var mi = parseInt(el.dataset.courseMi, 10);
  var li = parseInt(el.dataset.courseLi, 10);
  var status = document.getElementById('vurl-status-' + mi + '-' + li);
  if (!status) return;
  var val = (el.value || '').trim();
  var platform = detectVideoPlatform(val);
  if (platform) return; // valid state already shown by input handler
  if (val) {
    status.className = 'course-s-vurl-status invalid';
    status.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Paste a YouTube, Vimeo, or Loom link';
  } else {
    status.className = 'course-s-vurl-status';
    status.innerHTML = '';
  }
});
courseRegisterAction('move-lesson-up', (e, el) => {
  moveLessonUp(parseInt(el.dataset.courseMi, 10), parseInt(el.dataset.courseLi, 10));
});
courseRegisterAction('move-lesson-down', (e, el) => {
  moveLessonDown(parseInt(el.dataset.courseMi, 10), parseInt(el.dataset.courseLi, 10));
});
courseRegisterAction('add-lesson', (e, el) => {
  addCourseLesson(parseInt(el.dataset.courseMi, 10), el.dataset.courseLessonType);
});

// Module interactions
courseRegisterAction('move-module-up', (e, el) => moveModuleUp(parseInt(el.dataset.courseMi, 10)));
courseRegisterAction('move-module-down', (e, el) => moveModuleDown(parseInt(el.dataset.courseMi, 10)));
courseRegisterAction('update-module-title', (e, el) => updateModuleTitle(parseInt(el.dataset.courseMi, 10), el.value));
courseRegisterAction('remove-module', (e, el) => removeCourseModule(parseInt(el.dataset.courseMi, 10)));

// ============================================================================
// Quiz action handlers
// ============================================================================
// All quiz state changes mutate courseModules[mi].quiz and call
// renderCourseModules() to re-render. Most are simple state mutations; the
// only one that confirms before destruction is remove-quiz.

courseRegisterAction('add-quiz', (e, el) => {
  const mi = parseInt(el.dataset.courseMi, 10);
  const mod = courseModules[mi];
  if (!mod || mod.quiz) return; // UI should prevent this but defense in depth
  // New quiz starts expanded, so apply accordion (collapse all expanded
  // lessons) and scroll to the new quiz card after render.
  collapseAllOtherLessons(null, null);
  mod.quiz = {
    id: 'new_' + Date.now(),
    require_pass: false,
    questions: [],
    _collapsed: false // open by default so creator can start adding questions
  };
  renderCourseModules();
  scrollItemIntoView('course-quiz-' + mi);
});

courseRegisterAction('remove-quiz', (e, el) => {
  const mi = parseInt(el.dataset.courseMi, 10);
  const mod = courseModules[mi];
  if (!mod || !mod.quiz) return;
  showModalConfirm(
    'Remove Quiz',
    'Are you sure you want to remove this quiz? All questions and answers will be deleted.',
    function() {
      mod.quiz = null;
      renderCourseModules();
    }
  );
});

courseRegisterAction('toggle-quiz-collapse', (e, el) => {
  const mi = parseInt(el.dataset.courseMi, 10);
  const mod = courseModules[mi];
  if (!mod || !mod.quiz) return;
  // Detect direction: was collapsed, now expanding. Only the expand
  // direction triggers accordion + scroll. Collapsing a quiz shouldn't
  // touch lessons or scroll the page.
  var wasCollapsed = !!mod.quiz._collapsed;
  if (wasCollapsed) {
    collapseAllOtherLessons(null, null);
  }
  mod.quiz._collapsed = !mod.quiz._collapsed;
  renderCourseModules();
  if (wasCollapsed) {
    scrollItemIntoView('course-quiz-' + mi);
  }
});

courseRegisterAction('toggle-require-pass', (e, el) => {
  const mi = parseInt(el.dataset.courseMi, 10);
  const mod = courseModules[mi];
  if (!mod || !mod.quiz) return;
  mod.quiz.require_pass = !!el.checked;
  // No re-render needed - the checkbox state is already correct in the DOM
  // and the only visible change is the "Required to pass" badge in the
  // collapsed header, which the user won't see while the card is open.
  // Re-render anyway for the live badge update when they collapse.
  renderCourseModules();
});

courseRegisterAction('add-question', (e, el) => {
  const mi = parseInt(el.dataset.courseMi, 10);
  const mod = courseModules[mi];
  if (!mod || !mod.quiz) return;
  if (!Array.isArray(mod.quiz.questions)) mod.quiz.questions = [];
  if (mod.quiz.questions.length >= 10) return; // UI should prevent this
  // Default new question: empty text, 4 empty answers, first one marked
  // correct (creator can change). Pre-marking one satisfies the "exactly
  // one correct" rule from the moment of creation, so the question is
  // valid as soon as the creator types answer text.
  mod.quiz.questions.push({
    id: 'new_q_' + Date.now() + '_' + mod.quiz.questions.length,
    text: '',
    answers: [
      { id: 'new_a_' + Date.now() + '_0', text: '', is_correct: true },
      { id: 'new_a_' + Date.now() + '_1', text: '', is_correct: false },
      { id: 'new_a_' + Date.now() + '_2', text: '', is_correct: false },
      { id: 'new_a_' + Date.now() + '_3', text: '', is_correct: false }
    ]
  });
  renderCourseModules();
});

courseRegisterAction('remove-question', (e, el) => {
  const mi = parseInt(el.dataset.courseMi, 10);
  const qi = parseInt(el.dataset.courseQi, 10);
  const mod = courseModules[mi];
  if (!mod || !mod.quiz || !Array.isArray(mod.quiz.questions)) return;
  if (qi < 0 || qi >= mod.quiz.questions.length) return;
  mod.quiz.questions.splice(qi, 1);
  renderCourseModules();
});

courseRegisterAction('update-question-text', (e, el) => {
  const mi = parseInt(el.dataset.courseMi, 10);
  const qi = parseInt(el.dataset.courseQi, 10);
  const mod = courseModules[mi];
  if (!mod || !mod.quiz || !mod.quiz.questions[qi]) return;
  // Mutate state but DON'T re-render. Re-rendering on every keystroke would
  // blow away the input's cursor position. Save flow will read this value
  // from state when the user clicks Save.
  mod.quiz.questions[qi].text = el.value;
});

courseRegisterAction('update-answer-text', (e, el) => {
  const mi = parseInt(el.dataset.courseMi, 10);
  const qi = parseInt(el.dataset.courseQi, 10);
  const ai = parseInt(el.dataset.courseAi, 10);
  const mod = courseModules[mi];
  if (!mod || !mod.quiz || !mod.quiz.questions[qi] || !mod.quiz.questions[qi].answers[ai]) return;
  mod.quiz.questions[qi].answers[ai].text = el.value;
  // Same as update-question-text: mutate-only, no re-render, preserve cursor.
});

courseRegisterAction('mark-answer-correct', (e, el) => {
  const mi = parseInt(el.dataset.courseMi, 10);
  const qi = parseInt(el.dataset.courseQi, 10);
  const ai = parseInt(el.dataset.courseAi, 10);
  const mod = courseModules[mi];
  if (!mod || !mod.quiz || !mod.quiz.questions[qi]) return;
  const answers = mod.quiz.questions[qi].answers || [];
  // Walk all 4 answers, setting is_correct=true on the selected one and
  // false on the rest. Enforces the "exactly one correct" rule.
  for (let i = 0; i < answers.length; i++) {
    answers[i].is_correct = (i === ai);
  }
  // No re-render - the radio's native :checked state already reflects the
  // change in the DOM. Re-rendering would lose any in-progress text input
  // (e.g., creator was typing in an answer field when they clicked the radio).
});

