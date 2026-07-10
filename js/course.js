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
// Data-loss guards. courseModulesLoaded is true only after the curriculum
// loaded successfully (or for a brand new course, where empty IS the truth).
// courseExplicitRemovals holds ids the user deliberately removed this
// session; the save may ONLY delete rows recorded here.
let courseModulesLoaded = false;
let courseExplicitRemovals = new Set();
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
    refreshCourseStorage();  // shared 10 GB indicator
  } else if (max) {
    renderCoursesList();
    refreshCourseStorage();
  }
}

// Lock/unlock the New Course button while the courses list is loading or in a
// failed state. Same pattern as the booking and products lists.
function setCoursesListLocked(locked) {
  var btn = document.getElementById('courses-create-btn');
  if (!btn) return;
  btn.disabled = locked;
  btn.style.opacity = locked ? '0.5' : '';
  btn.style.cursor = locked ? 'not-allowed' : '';
}

// Loading indicator for the courses list. Same bare spinner as the booking
// and products lists (the boxed variant is reserved for editor loaders).
function courseShowListLoading(text) {
  var grid = document.getElementById('courses-grid');
  var empty = document.getElementById('courses-empty');
  if (empty) empty.style.display = 'none';
  if (!grid) return;

  if (!document.getElementById('course-load-spin-style')) {
    var styleEl = document.createElement('style');
    styleEl.id = 'course-load-spin-style';
    styleEl.textContent = '@keyframes courseLoadSpin { to { transform: rotate(360deg); } }';
    document.head.appendChild(styleEl);
  }

  var existing = grid.querySelector('[data-course-list-loading-text]');
  if (existing) { existing.textContent = text; return; }

  grid.style.display = 'block';
  grid.innerHTML = '';
  var wrap = document.createElement('div');
  wrap.setAttribute('role', 'status');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '10px';
  wrap.style.padding = '18px 4px';

  var spinner = document.createElement('div');
  spinner.style.width = '16px';
  spinner.style.height = '16px';
  spinner.style.border = '2px solid rgba(124,58,237,0.25)';
  spinner.style.borderTopColor = '#7c3aed';
  spinner.style.borderRadius = '50%';
  spinner.style.animation = 'courseLoadSpin 0.7s linear infinite';
  spinner.style.flexShrink = '0';

  var label = document.createElement('div');
  label.setAttribute('data-course-list-loading-text', '1');
  label.style.color = 'rgba(255,255,255,0.7)';
  label.style.fontSize = '14px';
  label.textContent = text;

  wrap.appendChild(spinner);
  wrap.appendChild(label);
  grid.appendChild(wrap);
}

// Blocking failure state for the courses list. A failed load must never
// masquerade as "you have no courses". Persistent panel with Retry; the New
// Course button stays locked until a clean load.
function courseShowListFailed() {
  var grid = document.getElementById('courses-grid');
  var empty = document.getElementById('courses-empty');
  if (empty) empty.style.display = 'none';
  if (!grid) return;

  grid.style.display = 'block';
  grid.innerHTML = '';
  var panel = document.createElement('div');
  panel.setAttribute('role', 'alert');
  panel.style.padding = '20px';
  panel.style.borderRadius = '12px';
  panel.style.border = '1px solid rgba(239,68,68,0.35)';
  panel.style.background = 'rgba(239,68,68,0.08)';

  var heading = document.createElement('div');
  heading.style.color = '#f87171';
  heading.style.fontWeight = '600';
  heading.style.fontSize = '15px';
  heading.style.marginBottom = '6px';
  heading.textContent = 'Could not load your courses';

  var body = document.createElement('div');
  body.style.color = 'rgba(255,255,255,0.7)';
  body.style.fontSize = '14px';
  body.style.lineHeight = '1.5';
  body.style.marginBottom = '14px';
  body.textContent = 'Your courses are safe; they just could not be loaded right now. This is usually a brief connection hiccup.';

  var retry = document.createElement('button');
  retry.type = 'button';
  retry.setAttribute('data-course-action', 'retry-list');
  retry.textContent = 'Retry';
  retry.style.padding = '9px 18px';
  retry.style.borderRadius = '8px';
  retry.style.border = '1px solid rgba(255,255,255,0.25)';
  retry.style.background = 'rgba(255,255,255,0.06)';
  retry.style.color = '#fff';
  retry.style.fontWeight = '600';
  retry.style.cursor = 'pointer';

  panel.appendChild(heading);
  panel.appendChild(body);
  panel.appendChild(retry);
  grid.appendChild(panel);
}

courseRegisterAction('retry-list', function() { loadCoursesList(); });

async function loadCoursesList() {
  // Lock New Course and show visible loading from the first moment.
  // Unlocks only after a clean load; stays locked on failure.
  setCoursesListLocked(true);
  courseShowListLoading('Loading your courses...');

  var MAX_LOAD_ATTEMPTS = 3;
  for (var attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
    try {
      const res = await sb
        .from('courses')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });
      if (res.error) throw res.error;
      coursesList = res.data || [];

      // Load enrollment counts per course. Counts are decoration; a
      // query-level error returns { count: null } and falls back to 0. Only
      // a hard network failure rejects, which correctly triggers a retry.
      for (var i = 0; i < coursesList.length; i++) {
        var c = coursesList[i];
        var countRes = await sb.from('course_enrollments').select('id', { count: 'exact', head: true }).eq('course_id', c.id);
        c._enrollments = countRes.count || 0;
      }

      setCoursesListLocked(false);
      renderCoursesList();
      return;
    } catch (err) {
      if (attempt < MAX_LOAD_ATTEMPTS) {
        courseShowListLoading('Having trouble loading your courses. Retrying...');
        await new Promise(function(resolve) { setTimeout(resolve, 400 * attempt); });
        continue;
      }
      console.error('Failed to load courses:', err);
      courseShowListFailed();
      showCourseMsg('error', 'Failed to load your courses. Please retry.');
      return;
    }
  }
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
  courseModulesLoaded = false;
  courseExplicitRemovals = new Set();
  // Clear any load-failure state carried over from a previously opened course,
  // so Save and Add Module start enabled. For a new course they stay enabled;
  // for an existing course, loadCourseModules disables Save during the load and
  // re-enables it (or re-blocks) based on the outcome.
  setCourseModulesLoadFailed(false);
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
    courseModulesLoaded = true; // brand new course: empty curriculum is real
    document.getElementById('course-slug-notice').textContent = 'This URL is generated from your title and locked permanently once saved.';
  }

  // Mount the rich-text description editor. Runs for both new and existing
  // courses. Fire-and-forget: editor mount is async (loads Quill on first
  // call) but we don't want to block the editor open on it. If the user
  // edits the title/slug before Quill finishes loading, that's fine - the
  // description textarea is the only field that needs Quill, and it stays
  // empty until Quill is ready.
  mountCourseDescEditor().catch(function(err) {
    console.warn('Description editor failed to mount:', err);
  });
}

function closeCourseEditor() {
  unmountCourseDescEditor();
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
  // Delegates to the dashboard's slide-in toast (plain-text messages only;
  // no current caller uses isHtml). Falls back to the inline banner.
  if (!isHtml && typeof showDashToast === 'function') {
    showDashToast(type === 'error' ? 'error' : 'success', msg);
    return;
  }
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
      description: description || null,
      completion_message: completionMessage || null,
      price_cents: priceCents,
      updated_at: new Date().toISOString()
    };
    if (coverPath) payload.cover_image_path = coverPath;

    if (courseId) {
      // Update
      // .select('id') so a zero-row update (RLS mismatch, deleted course) is a
      // failure rather than a silent success.
      assertSaved(
        await sb.from('courses').update(payload).eq('id', courseId).select('id'),
        'course'
      );
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
    // Guards that already surfaced their own toast set _shownToUser; avoid
    // stacking a second "Failed to save" toast on top of it.
    if (!err._shownToUser) showCourseMsg('error', 'Failed to save: ' + err.message);
  } finally {
    // Do not re-enable Save while the curriculum is in the load-failed state:
    // setCourseModulesLoadFailed(true) owns the button until a clean load.
    // Without this check, a blocked save's cleanup would silently undo the
    // failure lockout and leave Save clickable against an unloaded course.
    if (courseModulesLoaded) { btn.disabled = false; }
    btn.textContent = 'Save';
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

  const pubRes = await sb.from('courses').update(updates).eq('id', currentCourseId).select('id');
  if (pubRes.error) { showCourseMsg('error', 'Failed: ' + pubRes.error.message); return; }
  if (!pubRes.data || pubRes.data.length === 0) {
    showCourseMsg('error', 'Nothing was saved. You may have been signed out. Reload and try again.');
    return;
  }

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
      // Was fire-and-forget. A failure here left the course unpublished but
      // still listed in the marketplace: the wrong direction to fail in.
      const unlistRes = await sb.from('courses')
        .update({ listed_in_marketplace: false })
        .eq('id', currentCourseId)
        .select('id');
      if (unlistRes.error || !unlistRes.data || unlistRes.data.length === 0) {
        showCourseMsg('error', 'Unpublished, but could not remove it from the marketplace. Reload and try again.');
        return;
      }
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

  const mkRes = await sb.from('courses')
    .update({ listed_in_marketplace: newVal })
    .eq('id', currentCourseId)
    .select('id');
  if (mkRes.error) { showCourseMsg('error', 'Failed: ' + mkRes.error.message); return; }
  if (!mkRes.data || mkRes.data.length === 0) {
    showCourseMsg('error', 'Nothing was saved. You may have been signed out. Reload and try again.');
    return;
  }
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

  const mkRes = await sb.from('coaching_services')
    .update({ listed_in_marketplace: newVal })
    .eq('id', currentCoachingId)
    .select('id');
  if (mkRes.error) { showCoachingMsg('error', 'Failed: ' + mkRes.error.message); return; }
  if (!mkRes.data || mkRes.data.length === 0) {
    showCoachingMsg('error', 'Nothing was saved. You may have been signed out. Reload and try again.');
    return;
  }
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

  const mkRes = await sb.from('digital_products')
    .update({ listed_in_marketplace: newVal })
    .eq('id', productsState.editingId)
    .select('id');
  if (mkRes.error) { showProductsMsg('error', 'Failed: ' + mkRes.error.message); return; }
  if (!mkRes.data || mkRes.data.length === 0) {
    showProductsMsg('error', 'Nothing was saved. You may have been signed out. Reload and try again.');
    return;
  }
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
      + '<img src="/logo.png?v=2" alt="" aria-hidden="true" style="display:block;height:40px;width:auto;margin:0 auto 16px;">'
      + '<div class="course-s-bc1a76">Delete Course</div>'
      + '<p class="course-s-1668a0">This will permanently delete this course, all modules, lessons, and enrollment data. This cannot be undone.</p>'
      + '<p class="course-s-7a34e5">Type <strong class="course-s-9dd120">DELETE</strong> to confirm:</p>'
      + '<input type="text" id="delete-course-input" placeholder="DELETE" aria-label="Type DELETE to confirm" class="course-s-6048ce">'
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
      // Enabled state matches the disconnect-modal danger button: translucent
      // red background with white text (readable, consistent across modals).
      if (match) { confirmBtn.style.background = 'rgba(239,68,68,0.12)'; confirmBtn.style.color = '#ffffff'; confirmBtn.style.borderColor = 'rgba(239,68,68,0.3)'; }
      else { confirmBtn.style.background = 'transparent'; confirmBtn.style.color = '#ef4444'; confirmBtn.style.borderColor = 'rgba(239,68,68,0.3)'; }
    });

    cancelBtn.onclick = function() { document.body.removeChild(overlay); resolve(); };
    overlay.onclick = function(e) { if (e.target === overlay) { document.body.removeChild(overlay); resolve(); } };

    confirmBtn.onclick = async function() {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deleting...';

      // Find the course to get cover path before deleting
      var course = coursesList.find(function(c) { return c.id === currentCourseId; });

      // Clean up R2 lesson-file objects FIRST, while the course + file rows
      // still exist (the bulk delete route validates ownership against the
      // courses table). Non-fatal if it fails; we still want the local DB
      // delete to proceed.
      try {
        var session = await sb.auth.getSession();
        var token = session && session.data && session.data.session ? session.data.session.access_token : null;
        if (token) {
          var r2Res = await fetch('/api/r2-bulk-delete', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ type: 'course', course_id: currentCourseId })
          });
          if (!r2Res.ok) {
            var errBody = await r2Res.json().catch(function() { return {}; });
            console.warn('R2 cleanup for course ' + currentCourseId + ' returned ' + r2Res.status + ':', errBody.error || '');
          }
        }
      } catch (r2Err) {
        console.warn('R2 cleanup request failed (non-fatal):', r2Err);
      }

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
            // Course already deleted here. A zero-row update means a dead course
            // link is still on the public bio page, not that the delete failed.
            var bioRes = await sb.from('link_in_bio')
              .update({ links: filtered })
              .eq('user_id', currentUser.id)
              .select('user_id');
            if (bioRes.error) throw bioRes.error;
            if (!bioRes.data || bioRes.data.length === 0) throw new Error('bio link cleanup matched no rows');
            // Also update local state if bio is loaded
            if (typeof bioState !== 'undefined' && bioState.links) {
              bioState.links = bioState.links.filter(function(l) { return !(l.isCourse && l.courseId === currentCourseId); });
            }
          }
        }
      } catch (bioErr) {
        console.error('Failed to remove the deleted course from Link in Bio:', bioErr);
        showCourseMsg('error', 'Course deleted, but its link may still be on your bio page. Open Link in Bio and remove it.');
      }

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
// Enable/disable every control that acts on this course, as one unit: Save,
// Publish/Unpublish, Add Module, the marketplace listing toggle, and Delete
// Course. Locked while the curriculum is loading and while it is in the
// failed state; unlocked only after a clean load. A course whose curriculum
// state is unknown must not accept ANY action, and the lock must be visible
// (dimmed), not just functional, so nothing looks clickable when it is not.
function setCourseEditorControlsLocked(locked) {
  const ids = ['course-save-btn', 'course-publish-btn', 'course-marketplace-btn', 'course-delete-btn'];
  const els = ids.map(function(id) { return document.getElementById(id); });
  const addBtn = document.querySelector('#course-section-modules [data-course-action="add-module"]');
  if (addBtn) els.push(addBtn);
  els.forEach(function(el) {
    if (!el) return;
    el.disabled = locked;
    el.style.opacity = locked ? '0.5' : '';
    el.style.cursor = locked ? 'not-allowed' : '';
  });
}

async function loadCourseModules(courseId) {
  courseModulesLoaded = false;
  // Clear any prior failure banner, then lock every course action (Save,
  // Publish/Unpublish, Add Module) for the duration of the load. Controls
  // unlock only if the load completes cleanly.
  setCourseModulesLoadFailed(false);
  setCourseEditorControlsLocked(true);

  // Visible feedback from the very first moment. Without this, the modules
  // area sits blank (and Save sits mysteriously disabled) for the entire load,
  // which on a struggling connection is up to ~1.2s of dead silence before
  // the failure panel appears. The indicator upgrades to a "retrying" message
  // the moment the first attempt fails, so the user always knows what state
  // the editor is in.
  showCourseModulesLoading('Loading course...');

  // Transient blips at open time (an in-flight token refresh that has not yet
  // settled, a one-off network error on a query) previously left the editor
  // permanently in a "not loaded" state, escapable only by a full page reload.
  // A reload discards unsaved work, which is the exact "built for hours,
  // cannot save, cannot recover" trap. So we retry a few times with a short
  // backoff before giving up.
  //
  // We deliberately do NOT force refreshSession() here. getSession() already
  // refreshes internally when the token is near expiry; an extra forced
  // refresh rotates the refresh token on every call, widening the "refresh
  // token already used" race behind mid-session sign-out kick-outs. Retrying
  // getSession() simply lets any in-flight, lock-coordinated refresh finish.
  const MAX_LOAD_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
    try {
      // RLS makes an unauthenticated select return EMPTY DATA with no error
      // (owner-scoped policies simply match nothing). So a load that runs
      // before the session has settled looks like a successfully empty course.
      // Require a live session before trusting anything this load returns.
      const sessRes = await sb.auth.getSession();
      const session = sessRes && sessRes.data ? sessRes.data.session : null;
      if (!session) throw new Error('course-load: no live session');

      const modRes = await sb.from('course_modules').select('*').eq('course_id', courseId).order('sort_order');
      const lesRes = await sb.from('course_lessons').select('*').eq('course_id', courseId).order('sort_order');
      // Load quizzes (creator view = raw table, includes is_correct flags so the
      // creator can edit). One quiz per module max, enforced by UNIQUE constraint.
      const quizRes = await sb.from('course_quizzes').select('*').eq('course_id', courseId);
      if (modRes.error || lesRes.error || quizRes.error) {
        throw (modRes.error || lesRes.error || quizRes.error);
      }

      const modules = modRes.data;
      const lessons = lesRes.data;
      const quizzes = quizRes.data;
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
      courseModulesLoaded = true;
      setCourseModulesLoadFailed(false);
      setCourseEditorControlsLocked(false);
      renderCourseModules();
      return;
    } catch (err) {
      if (attempt < MAX_LOAD_ATTEMPTS) {
        // Tell the user we are struggling but still working, instead of
        // leaving a silent blank area during the backoff.
        showCourseModulesLoading('Having trouble loading this course. Retrying...');
        await new Promise(resolve => setTimeout(resolve, 400 * attempt));
        continue;
      }
      // Final failure. A failed load must never masquerade as an empty
      // curriculum: saving empty local state over a populated course would
      // delete everything. Rather than a toast that slides away (which a
      // creator can miss, then unknowingly build on a broken base), show a
      // persistent blocking panel with a Retry button and keep Save and
      // Add Module disabled until a clean load succeeds.
      courseModulesLoaded = false;
      setCourseModulesLoadFailed(true);
      showCourseMsg('error', 'Failed to load course. Please retry.');
      return;
    }
  }
}

// Loading indicator for the course load. Renders in the course-editor-msg
// slot at the TOP of the editor, directly under the header, the same slot the
// failure panel uses. The user lands at the top when the editor opens, so
// every load status (loading, retrying, failed) lives there; nothing about
// the load's health is ever buried below the fold. Shows a small spinner and
// a status line ("Loading course..." initially, upgraded to a retrying
// message if attempts fail). Replaced by the failure panel on final failure;
// cleared by setCourseModulesLoadFailed(false) on success.
function showCourseModulesLoading(text) {
  const empty = document.getElementById('course-modules-empty');
  // Hide the "Add a module to start building" empty-state while loading; it
  // would be misleading next to a curriculum that has not arrived yet.
  if (empty) empty.style.display = 'none';

  const msgHost = document.getElementById('course-editor-msg');
  if (!msgHost) return;

  // One-time keyframes for the spinner. A JS-created <style> element is
  // CSP-compatible (the inline-script and style-attribute restrictions do not
  // apply to stylesheet text set on a created style node).
  if (!document.getElementById('course-load-spin-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'course-load-spin-style';
    styleEl.textContent = '@keyframes courseLoadSpin { to { transform: rotate(360deg); } }';
    document.head.appendChild(styleEl);
  }

  // If the indicator is already mounted, just update the status text. This
  // keeps the spinner animation smooth across the loading -> retrying upgrade
  // instead of remounting and visually restarting it.
  const existing = msgHost.querySelector('[data-course-loading-text]');
  if (existing) {
    existing.textContent = text;
    return;
  }

  // Take over the slot the same way the failure panel does: neutralize the
  // toast slot's own styling for the duration. Restored on clear.
  msgHost.innerHTML = '';
  msgHost.style.display = 'block';
  msgHost.style.background = 'transparent';
  msgHost.style.border = 'none';
  msgHost.style.padding = '0';

  const wrap = document.createElement('div');
  wrap.setAttribute('role', 'status');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '10px';
  wrap.style.padding = '14px 16px';
  wrap.style.borderRadius = '10px';
  wrap.style.border = '1px solid rgba(255,255,255,0.12)';
  wrap.style.background = 'rgba(255,255,255,0.04)';
  wrap.style.marginBottom = '16px';

  const spinner = document.createElement('div');
  spinner.style.width = '16px';
  spinner.style.height = '16px';
  spinner.style.border = '2px solid rgba(124,58,237,0.25)';
  spinner.style.borderTopColor = '#7c3aed';
  spinner.style.borderRadius = '50%';
  spinner.style.animation = 'courseLoadSpin 0.7s linear infinite';
  spinner.style.flexShrink = '0';

  const label = document.createElement('div');
  label.setAttribute('data-course-loading-text', '1');
  label.style.color = 'rgba(255,255,255,0.7)';
  label.style.fontSize = '14px';
  label.textContent = text;

  wrap.appendChild(spinner);
  wrap.appendChild(label);
  msgHost.appendChild(wrap);
}

// Blocking load-failure state for the course curriculum. A curriculum that did
// not load cleanly must not present itself as a normal, editable, empty
// editor: a creator could build for hours on top of it and then be unable to
// save (Guard 1 in saveCourseModules blocks the save to avoid wiping the real
// DB rows). We show a persistent panel with a Retry button and disable the
// controls that would let them build or save until a clean load succeeds.
function setCourseModulesLoadFailed(failed) {
  const list = document.getElementById('course-modules-list');
  const empty = document.getElementById('course-modules-empty');

  // Controls (Save, Publish/Unpublish, Add Module) lock and unlock as one
  // unit via setCourseEditorControlsLocked, so no course action is ever
  // available against a curriculum in an unknown or failed state.
  setCourseEditorControlsLocked(failed);

  if (!failed) {
    // Release the top message slot if a failure panel OR the loading
    // indicator is occupying it, and undo our style overrides so
    // showCourseMsg's inline-banner fallback renders normally next time it
    // uses this element.
    const msgHostClear = document.getElementById('course-editor-msg');
    if (msgHostClear && (
      msgHostClear.querySelector('[data-course-action="retry-load"]') ||
      msgHostClear.querySelector('[data-course-loading-text]')
    )) {
      msgHostClear.innerHTML = '';
      msgHostClear.style.display = 'none';
      msgHostClear.style.background = '';
      msgHostClear.style.border = '';
      msgHostClear.style.padding = '';
    }
    // The list and empty-state are owned by renderCourseModules on success and
    // by openCourseEditor on open, so there is nothing to restore here.
    return;
  }

  if (empty) empty.style.display = 'none';

  // The panel lives at the TOP of the editor (the course-editor-msg slot,
  // directly under the header and Save button), not down in the modules
  // section. On a long course the modules area is below the fold; a creator
  // landing at the top of the form must see the failure immediately, before
  // they can start typing into fields they cannot save.
  const msgHost = document.getElementById('course-editor-msg');
  if (msgHost) {
    // Neutralize the toast slot's own styling and timer-driven usage: we own
    // it for the duration of the failure state. showCourseMsg's 5s auto-hide
    // only runs for messages it shows itself, so nothing will hide this.
    msgHost.innerHTML = '';
    msgHost.style.display = 'block';
    msgHost.style.background = 'transparent';
    msgHost.style.border = 'none';
    msgHost.style.padding = '0';

    const panel = document.createElement('div');
    panel.setAttribute('role', 'alert');
    panel.style.padding = '20px';
    panel.style.borderRadius = '12px';
    panel.style.border = '1px solid rgba(239,68,68,0.35)';
    panel.style.background = 'rgba(239,68,68,0.08)';
    panel.style.marginBottom = '16px';

    const heading = document.createElement('div');
    heading.style.color = '#f87171';
    heading.style.fontWeight = '600';
    heading.style.fontSize = '15px';
    heading.style.marginBottom = '6px';
    heading.textContent = 'Could not load this course';

    const body = document.createElement('div');
    body.style.color = 'rgba(255,255,255,0.7)';
    body.style.fontSize = '14px';
    body.style.lineHeight = '1.5';
    body.style.marginBottom = '14px';
    body.textContent = 'Editing and saving are turned off until the curriculum loads, so your existing modules and lessons stay safe. This is usually a brief connection hiccup.';

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.setAttribute('data-course-action', 'retry-load');
    retry.textContent = 'Retry';
    retry.style.padding = '9px 18px';
    retry.style.borderRadius = '8px';
    retry.style.border = '1px solid rgba(255,255,255,0.25)';
    retry.style.background = 'rgba(255,255,255,0.06)';
    retry.style.color = '#fff';
    retry.style.fontWeight = '600';
    retry.style.cursor = 'pointer';

    panel.appendChild(heading);
    panel.appendChild(body);
    panel.appendChild(retry);
    msgHost.appendChild(panel);

    // Guarantee visibility even if the user is scrolled elsewhere.
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Short secondary notice in the modules section so it does not read as a
  // mysteriously empty curriculum for anyone who scrolls past the top panel.
  if (list) {
    list.innerHTML = '';
    const note = document.createElement('div');
    note.style.padding = '14px';
    note.style.borderRadius = '10px';
    note.style.border = '1px solid rgba(239,68,68,0.25)';
    note.style.color = 'rgba(255,255,255,0.7)';
    note.style.fontSize = '13px';
    note.textContent = 'Curriculum unavailable. Use the Retry button at the top of this page.';
    list.appendChild(note);
  }
}

courseRegisterAction('retry-load', function() {
  if (!currentCourseId) return;
  loadCourseModules(currentCourseId);
});

// Per-lesson text_content size cap (1 MB of sanitized HTML). This is a DoS
// safety net, no realistic lesson approaches this size (1 MB of clean HTML
// is roughly 100k words plus dozens of images). If we ever hit it, something
// is wrong (pathological paste, bug, abuse). Backed up by a Postgres CHECK
// constraint on the column for defense in depth.
var MAX_LESSON_TEXT_BYTES = 1024 * 1024;

async function saveCourseModules(courseId) {
  // Guard 1: never save a curriculum that did not finish loading. An empty
  // or partial local state would be interpreted by the diff below as mass
  // deletion.
  if (!courseModulesLoaded) {
    showCourseMsg(
      'error',
      'Saving is disabled because the course curriculum did not finish loading. This protects your modules and lessons. Use the Retry button to reload it.'
    );
    const guardErr = new Error('Curriculum not loaded; save blocked');
    guardErr._shownToUser = true;
    throw guardErr;
  }

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

  // Guard 2: the save may only delete rows the user explicitly removed in
  // this session. Anything else missing from local state means the editor
  // is out of sync with the database, and deleting would destroy content
  // the user never touched. Abort before any write happens.
  const modulesToDeleteCheck = (dbModules || [])
    .map(function(m) { return m.id; })
    .filter(function(id) { return !localModuleIds.has(id); });
  const unexpectedDeletes = modulesToDeleteCheck
    .filter(function(id) { return !courseExplicitRemovals.has(id); })
    .concat(lessonsToDelete.filter(function(id) { return !courseExplicitRemovals.has(id); }));
  if (unexpectedDeletes.length > 0) {
    showCourseMsg(
      'error',
      'Save blocked to protect your course: this save would remove modules or lessons that were not deleted in this session, so the editor is out of sync. Nothing has been changed. Refresh the page and try again.'
    );
    const syncErr = new Error('Blocked out-of-sync curriculum deletion');
    syncErr._shownToUser = true;
    throw syncErr;
  }
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
      const modRes = await sb.from('course_modules')
        .update({ title: newTitle, sort_order: mi })
        .eq('id', mod.id)
        .select('id');
      const updErr = modRes.error ||
        (!modRes.data || modRes.data.length === 0
          ? new Error('Module save matched no rows. Reload and try again.')
          : null);
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
        const lesRes = await sb.from('course_lessons')
          .update(lessonPayload)
          .eq('id', lesson.id)
          .select('id');
        const updErr = lesRes.error ||
          (!lesRes.data || lesRes.data.length === 0
            ? new Error('Lesson save matched no rows. Reload and try again.')
            : null);
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
      // Case A: deleted. Same protection as modules and lessons: only rows
      // the user explicitly removed this session may be deleted. A quiz
      // missing from local state for any other reason means the editor is
      // out of sync (two-tab editing, partial state corruption), and
      // deleting would destroy content the user never touched.
      if (!courseExplicitRemovals.has(dbQuiz.id)) {
        showModalAlert(
          'Save blocked to protect your course',
          'This save would remove a quiz that was not deleted in this editing session, which means the editor is out of sync. Refresh the page and try again.'
        );
        throw new Error('Blocked out-of-sync quiz deletion');
      }
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
        const quizRes = await sb.from('course_quizzes')
          .update(quizPayload)
          .eq('id', dbQuiz.id)
          .select('id');
        const updErr = quizRes.error ||
          (!quizRes.data || quizRes.data.length === 0
            ? new Error('Quiz save matched no rows. Reload and try again.')
            : null);
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
      + '<img src="/logo.png?v=2" alt="" aria-hidden="true" style="display:block;height:40px;width:auto;margin:0 auto 16px;">'
      + '<div class="course-s-bc1a76">' + escapeHtml(title) + '</div>'
      + '<p class="course-s-1668a0">' + escapeHtml(message) + '</p>'
      + '<p class="course-s-7a34e5">Type <strong class="course-s-9dd120">DELETE</strong> to confirm:</p>'
      + '<input type="text" id="' + inputId + '" placeholder="DELETE" aria-label="Type DELETE to confirm" class="course-s-6048ce">'
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
      // Enabled state matches the disconnect-modal danger button: translucent
      // red background with white text (readable, consistent across modals).
      if (match) { confirmBtn.style.background = 'rgba(239,68,68,0.12)'; confirmBtn.style.color = '#ffffff'; confirmBtn.style.borderColor = 'rgba(239,68,68,0.3)'; }
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
    // Record the deliberate removals so the save is allowed to delete them.
    if (mod.id) courseExplicitRemovals.add(mod.id);
    if (mod.quiz && mod.quiz.id) courseExplicitRemovals.add(mod.quiz.id);
    (mod.lessons || []).forEach(function(l) { if (l.id) courseExplicitRemovals.add(l.id); });
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
  var lesson = courseModules[modIdx] && courseModules[modIdx].lessons[lessonIdx];
  if (lesson && lesson.id) courseExplicitRemovals.add(lesson.id);
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
// The bucket is shared with Digital Products for one consolidated 10 GB
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
    if (txt) txt.textContent = window.FileValidation.formatBytes(courseStorageUsedBytes) + ' / 10 GB for downloadable files (shared with Digital Products)';
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
// account storage cap, type validation, ZIP inspection), gets a presigned R2
// URL, then PUTs the file directly to R2. The server inserts the metadata row.
//
// Returns true on success, false on any failure (the user has been alerted by
// this point via showModalAlert, so the caller doesn't need to).
async function uploadLessonFile(courseId, lessonId, file) {
  // Pre-flight: file size
  if (file.size > window.FileValidation.MAX_FILE_BYTES) {
    showModalAlert('File too large',
      '"' + file.name + '" is ' + window.FileValidation.formatBytes(file.size) + '. Max file size is 1 GB.');
    return false;
  }

  // Pre-flight: account storage cap (uses the cached value, which was
  // refreshed when the editor opened)
  if (courseStorageUsedBytes + file.size > window.FileValidation.MAX_ACCOUNT_BYTES) {
    showModalAlert('Storage full',
      'Adding "' + file.name + '" would exceed your 10 GB account storage. Delete some files first.');
    return false;
  }

  // No per-lesson file count cap. Account 10 GB cap is the backstop.
  var current = lessonFilesByLessonId[lessonId] || [];

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

  // Optimistic UI: insert a placeholder row showing "Uploading..." and
  // re-render immediately so the creator sees their file appear while the
  // network round-trip happens. The temp row is swapped for the real row
  // on success, or removed on failure. Matches the Digital Products pattern.
  var tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  if (!lessonFilesByLessonId[lessonId]) lessonFilesByLessonId[lessonId] = [];
  lessonFilesByLessonId[lessonId].push({
    id: tempId,
    filename: file.name,
    file_size_bytes: file.size,
    _uploading: true
  });
  renderCourseModules();

  try {
    // Step 1: ask server for presigned R2 upload URL. Server validates
    // ownership (creator owns course, lesson belongs to course) and account
    // storage cap (10 GB), then inserts the course_lesson_files row.
    // Returns upload_url, file_id, storage_path.
    var session = await sb.auth.getSession();
    var token = session && session.data && session.data.session ? session.data.session.access_token : null;
    if (!token) throw new Error('Not signed in');

    var urlRes = await fetch('/api/r2-upload-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        type: 'lesson',
        course_id: courseId,
        lesson_id: lessonId,
        filename: file.name,
        file_size_bytes: file.size,
        mime_type: file.type || 'application/octet-stream'
      })
    });
    if (!urlRes.ok) {
      var errBody = await urlRes.json().catch(function() { return {}; });
      throw new Error(errBody.error || ('Upload URL request failed (' + urlRes.status + ')'));
    }
    var urlData = await urlRes.json();

    // Step 2: PUT directly to R2 (file does not pass through Vercel)
    var putRes = await fetch(urlData.upload_url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' }
    });
    if (!putRes.ok) {
      // Clean up the orphan row so the lesson editor doesn't show a broken file
      try {
        await fetch('/api/r2-delete-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ type: 'lesson', file_id: urlData.file_id })
        });
      } catch (cleanupErr) { /* best-effort */ }
      throw new Error('Upload to R2 failed (' + putRes.status + ')');
    }

    // Step 3: server already inserted the row. Fetch it for the UI cache.
    var { data: row, error: rowErr } = await sb.from('course_lesson_files').select('*').eq('id', urlData.file_id).single();
    if (rowErr || !row) throw rowErr || new Error('Could not load file row after upload');

    // Swap the temp placeholder for the real row in-place (preserves position)
    var idx = lessonFilesByLessonId[lessonId].findIndex(function(f) { return f.id === tempId; });
    if (idx >= 0) lessonFilesByLessonId[lessonId][idx] = row;
    else lessonFilesByLessonId[lessonId].push(row); // fallback if temp got cleared

    courseStorageUsedBytes += file.size;
    renderCourseModules();
    return true;
  } catch (e) {
    console.error('uploadLessonFile failed:', e);
    // Remove the failed temp row so the UI doesn't show a stuck "Uploading..."
    lessonFilesByLessonId[lessonId] = (lessonFilesByLessonId[lessonId] || []).filter(function(f) { return f.id !== tempId; });
    renderCourseModules();
    // Surface friendly messages for known server-side validation errors.
    if (e && e.message && e.message.indexOf('10 GB') !== -1) {
      showModalAlert('Storage full', e.message);
    } else {
      showModalAlert('Upload failed', 'Could not upload "' + file.name + '". Please try again.');
    }
    return false;
  }
}

// Delete one lesson file via the server-side R2 delete route. The route
// validates ownership via JWT, deletes the DB row, and deletes the R2 object
// in one call. Idempotent - safe to call on an already-deleted file.
async function deleteLessonFile(lessonId, fileId) {
  var files = lessonFilesByLessonId[lessonId] || [];
  var file = files.find(function(f) { return f.id === fileId; });
  if (!file) return false;
  try {
    var session = await sb.auth.getSession();
    var token = session && session.data && session.data.session ? session.data.session.access_token : null;
    if (!token) throw new Error('Not signed in');

    var res = await fetch('/api/r2-delete-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ type: 'lesson', file_id: fileId })
    });
    if (!res.ok) {
      var errBody = await res.json().catch(function() { return {}; });
      throw new Error(errBody.error || ('Delete failed (' + res.status + ')'));
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

// Delete every lesson-file row + R2 object for the given lessonId. Called
// from confirmRemoveLesson before splicing the lesson out of local state.
// Each file goes through the r2-delete-file API (validates ownership,
// deletes DB row, deletes R2 object). Deletes in parallel.
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

    var session = await sb.auth.getSession();
    var token = session && session.data && session.data.session ? session.data.session.access_token : null;
    if (!token) throw new Error('Not signed in');

    // Delete in parallel. Each call handles both R2 + DB row.
    await Promise.all(files.map(function(f) {
      return fetch('/api/r2-delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ type: 'lesson', file_id: f.id })
      }).catch(function(err) {
        console.warn('Lesson file delete failed for ' + f.id + ':', err);
      });
    }));

    // Reduce cached storage usage figure
    var freedBytes = files.reduce(function(s, f) { return s + Number(f.file_size_bytes || 0); }, 0);
    courseStorageUsedBytes = Math.max(0, courseStorageUsedBytes - freedBytes);
    delete lessonFilesByLessonId[lessonId];
  } catch (e) {
    console.error('deleteAllFilesForLesson failed:', e);
    // Non-blocking: orphan R2 objects will eventually be swept by a future
    // cron. Not ideal but not catastrophic.
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
    purifyScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.3/purify.min.js';
    purifyScript.integrity = 'sha512-Ll+TuDvrWDNNRnFFIM8dOiw7Go7dsHyxRp4RutiIFW/wm3DgDmCnRZow6AqbXnCbpWu93yM1O34q+4ggzGeXVA==';
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

// Sanitizer for course/booking/product descriptions. Same security model as
// sanitizeLessonHtml but additionally trims trailing whitespace inside
// paragraphs and headings. Quill's editor often leaves a stray space at the
// end of each block when the cursor sits at end-of-line during typing, and
// that whitespace creates visible inconsistencies on the landing page (the
// reported "one space renders as two" issue). Strips href-less <a> tags by
// keeping their text content but unwrapping the empty anchor - prevents
// "looks like a link but isn't clickable" rendering bugs from old data.
function sanitizeDescriptionHtml(html) {
  if (typeof DOMPurify === 'undefined') return '';
  installDomPurifyHooks();
  var cleaned = (html || '');
  // Trim whitespace immediately before closing block tags. Targets <p>, <h2>,
  // <h3>, <li> since those are the block-level tags creators write in.
  cleaned = cleaned.replace(/(\s+)<\/(p|h2|h3|li)>/g, '</$2>');
  // Strip leading whitespace right after opening block tags as well.
  cleaned = cleaned.replace(/<(p|h2|h3|li)([^>]*)>\s+/g, '<$1$2>');
  // Note: we deliberately PRESERVE '<p><br></p>' empty paragraph spacers
  // here. Quill uses them as visible blank lines while editing, and
  // stripping them on save makes paragraphs visually stack on top of each
  // other when the creator re-opens the editor. The landing-page renderers
  // strip these spacers at render time instead, so the stored data keeps
  // editor-friendly spacing while the public page shows tight spacing.
  // Convert <a> tags with no href (or empty href) into plain text. These
  // happen when the saved data predates the link-sanitize patch and creates
  // visually-styled "links" that don't navigate anywhere - confusing for
  // landing-page visitors who click expecting a real link.
  cleaned = cleaned.replace(/<a(?:\s+(?!href=)[^>]*)?>(.*?)<\/a>/gi, '$1');
  cleaned = cleaned.replace(/<a\s+href=["']?["']?\s*>(.*?)<\/a>/gi, '$1');
  return DOMPurify.sanitize(cleaned, QUILL_PURIFY_CONFIG);
}

// Count <img> tags in the current Quill content (used to enforce per-lesson
// image cap). A regex is fine here, Quill output is well-formed.
function countQuillImages(quill) {
  var html = quill.root.innerHTML;
  var matches = html.match(/<img\b/g);
  return matches ? matches.length : 0;
}

// =============================================================================
// COURSE DESCRIPTION RICH-TEXT EDITOR
// =============================================================================
// The course description field uses the same Quill setup as lessons (loaded
// via ensureQuillLoaded). To keep the existing save flow and AI Cleanup
// untouched, the editor mounts INTO a div alongside a hidden textarea: Quill
// content is synced (sanitized) into the textarea's value on every change,
// and the textarea's `input` event syncs back into Quill (so when AI Cleanup
// writes the cleaned text back via textarea.value + dispatchEvent('input'),
// the rich editor picks up the change).

var _courseDescQuill = null;
var _courseDescSyncInProgress = false;
// Max stored HTML length for course descriptions. Bounded for performance
// (every landing-page view loads this column) and UX (long descriptions
// don't convert better). ~2000 visible chars after tags, generous enough
// for thorough descriptions without inviting essays.
var COURSE_DESC_MAX_HTML = 3000;
// Max <img> embeds in a single course description. Lower than the lesson cap
// (15) because course descriptions are short marketing copy, not long-form
// teaching content. Each image is a hosted WebP that loads on every landing
// page view, so we cap the count to keep TTFB tight.
var MAX_COURSE_DESC_IMAGES = 6;

async function mountCourseDescEditor() {
  // Always unmount any prior instance first. Handles re-entry from the
  // courses list (opening course B after A reuses the same host) and stale
  // state recovery. Calling Quill twice on the same host appends another
  // toolbar + body inside, producing the "editor on top of editor" bug.
  unmountCourseDescEditor();

  var host = document.getElementById('course-desc-editor');
  var textarea = document.getElementById('course-desc-input');
  if (!host || !textarea) return null;

  // Capture scroll position before mounting. Quill's clipboard.dangerouslyPasteHTML
  // (called below to load existing content) moves the selection cursor into
  // the editor, which can trigger the browser to auto-scroll the description
  // into view. We restore scroll after content load so the user lands at the
  // top of the form when opening the editor, not partway down at the
  // description. Both window-level and container-level scroll are captured
  // since either could be the scrolling context.
  var savedScrollY = window.scrollY || window.pageYOffset || 0;
  var scrollContainer = document.getElementById('courses-editor-view');
  var savedContainerScroll = scrollContainer ? scrollContainer.scrollTop : 0;

  await ensureQuillLoaded();
  if (typeof Quill === 'undefined') return null;

  // After the await, the user may have closed/reopened. Wipe again to be safe.
  host.innerHTML = '';
  // Mirror the working lesson editor pattern: create a fresh child div and
  // mount Quill into THAT, not directly into the host. Unmount removes the
  // child entirely, guaranteeing the host is empty between mounts so Quill
  // can never accidentally stack a second toolbar inside the first.
  var mountTarget = document.createElement('div');
  host.appendChild(mountTarget);

  // Override Quill's Link blot to auto-prepend https:// when a user enters a
  // URL without a scheme (e.g. "example.com" instead of "https://example.com").
  // Without this, the description sanitizer strips the href because its
  // allowlist regex requires http/https/mailto, and the link renders as
  // unclickable text on the landing page. Safe to call multiple times;
  // Quill.import returns the same class reference.
  try {
    var Link = Quill.import('formats/link');
    if (Link && !Link._ryxaSanitizePatched) {
      var origSanitize = Link.sanitize;
      Link.sanitize = function(url) {
        var u = String(url || '').trim();
        // Allow mailto, tel, anchor, and already-schemed http/https.
        if (/^(https?:|mailto:|tel:|#)/i.test(u)) return origSanitize.call(this, u);
        // Empty or scheme-less: prepend https://. Skip pure "#" or empty.
        if (!u) return origSanitize.call(this, u);
        return origSanitize.call(this, 'https://' + u);
      };
      Link._ryxaSanitizePatched = true;
    }
  } catch (e) {
    console.warn('Could not patch Quill link sanitizer:', e);
  }

  // Toolbar matches what's useful for course descriptions: emphasis, lists,
  // headings (H2/H3 only - no H1 since that's the course title), links, and
  // images (added later, mirrors the lesson editor's image-upload pipeline
  // and S/M/L sizing). 'clean' stays omitted to keep the toolbar uncluttered.
  var quill = new Quill(mountTarget, {
    theme: 'snow',
    placeholder: 'What will students learn? Why should they take this course?',
    modules: {
      toolbar: {
        container: [
          [{ 'header': [2, 3, false] }],
          ['bold', 'italic', 'underline'],
          [{ 'list': 'ordered' }, { 'list': 'bullet' }],
          ['link', 'image']
        ],
        handlers: {
          // Custom image handler. Reuses compressLessonImage (WebP 0.8,
          // 1200px max) and the course-images bucket. Same egress and
          // storage profile as lesson images. Enforces MAX_COURSE_DESC_IMAGES.
          // New images default to "small" to match lesson behavior; creator
          // clicks the image then uses S/M/L toolbar to resize.
          image: function() {
            var imgCount = countQuillImages(quill);
            if (imgCount >= MAX_COURSE_DESC_IMAGES) {
              showModalAlert('Image limit reached', 'You can add up to ' + MAX_COURSE_DESC_IMAGES + ' images per course description. Remove one before adding another.');
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
                // After insert: tag the new image with the default size class
                // and an empty alt attribute. The DOMPurify hook will also
                // backstop the alt on save, but we set it here so the editor
                // DOM matches the persisted shape immediately.
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
                    _courseDescSyncInProgress = true;
                    textarea.value = html;
                    _courseDescSyncInProgress = false;
                    updateCourseDescCounter(html.length);
                  }
                }, 50);
              } catch (e) {
                console.error('Course description image upload error:', e);
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
  // tooltip input. Same helper used by lesson editors so behavior matches.
  applyQuillA11yLabels(quill.root);

  // Block <img> embeds from paste/drop. Only the toolbar image button can
  // add images, which routes through our compress + upload pipeline with
  // a unique filename per upload. Prevents cross-content duplicate storage
  // references, clipboard-image base64 bloat, and fragile external image URLs.
  stripPastedImages(quill);

  // Initialize Quill content from whatever's currently in the textarea
  // (set by openCourseEditor before this mounts).
  var initialHtml = textarea.value || '';
  if (initialHtml) {
    var cleanInit = sanitizeDescriptionHtml(initialHtml);
    // If sanitization stripped everything (e.g., plain text saved from the
    // old textarea era), fall back to inserting it as a single paragraph.
    if (cleanInit && cleanInit.trim()) {
      withImagesAllowed(quill, function() {
        quill.clipboard.dangerouslyPasteHTML(cleanInit);
      });
    } else {
      quill.setText(initialHtml);
    }
  }

  // Re-apply image size classes after the seed paste. Same defense as the
  // lesson editor: Quill 1.x treats <img> as an Embed blot, and
  // dangerouslyPasteHTML doesn't reliably preserve custom classes on embeds.
  // We re-parse the saved HTML, extract the size class per image (matched
  // by document order, which is stable through paste), and apply it back to
  // Quill's rendered DOM so the editor preview matches what the landing page
  // will show.
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
      console.warn('Failed to re-apply description image size classes after seed:', e);
    }
  }

  // Restore scroll position captured before mount. dangerouslyPasteHTML
  // moves Quill's selection cursor which can auto-scroll the description
  // into view; we don't want that on initial editor open. Wrapped in
  // requestAnimationFrame so the restore runs AFTER the browser has
  // finished any layout-triggered scrolling.
  requestAnimationFrame(function() {
    window.scrollTo(0, savedScrollY);
    if (scrollContainer) scrollContainer.scrollTop = savedContainerScroll;
  });

  // Quill → textarea: every edit syncs sanitized HTML into the hidden
  // textarea so saveCourse and any other consumer reads the rich content.
  // Also enforces the char limit and image-count limit by undoing the last
  // edit in Quill if either is exceeded. Updates the live counter UI.
  quill.on('text-change', function(delta, oldDelta, source) {
    if (_courseDescSyncInProgress) return;

    // Image-cap enforcement on user edits only. Programmatic changes (the
    // initial seed paste, AI Cleanup, history.undo) carry source !== 'user'
    // and never trip this. Mirrors the lesson editor's post-change check at
    // line 2172. We check AFTER the change so paste-of-many-images undoes
    // cleanly without us trying to intercept the clipboard event.
    if (source === 'user') {
      var imgCount = countQuillImages(quill);
      if (imgCount > MAX_COURSE_DESC_IMAGES) {
        _courseDescSyncInProgress = true;
        try { quill.history.undo(); } catch (e) { /* no history yet */ }
        _courseDescSyncInProgress = false;
        showModalAlert('Image limit reached', 'You can add up to ' + MAX_COURSE_DESC_IMAGES + ' images per course description.');
        return;
      }
    }

    var html = sanitizeDescriptionHtml(quill.root.innerHTML);
    // Quill's empty state is '<p><br></p>' - treat as empty so saved
    // descriptions don't carry that stub.
    if (html === '<p><br></p>') html = '';

    // Enforce hard limit. If exceeded, undo the last edit in Quill - this
    // is the cleanest way to "reject" input without leaving Quill and the
    // textarea out of sync. The counter color (set below) already turned
    // red before the user hit the cap, so this only fires for paste-large
    // scenarios.
    if (html.length > COURSE_DESC_MAX_HTML) {
      _courseDescSyncInProgress = true;
      try { quill.history.undo(); } catch (e) { /* no history yet */ }
      _courseDescSyncInProgress = false;
      // Use a soft alert rather than modalAlert to avoid interrupting flow.
      var counter = document.getElementById('course-desc-counter');
      if (counter) {
        counter.textContent = 'Description must be ' + COURSE_DESC_MAX_HTML + ' characters or fewer.';
        counter.style.color = '#ef4444';
      }
      return;
    }

    _courseDescSyncInProgress = true;
    textarea.value = html;
    _courseDescSyncInProgress = false;

    // Update the live counter.
    updateCourseDescCounter(html.length);
  });

  // textarea → Quill: AI Cleanup writes cleaned text back to the textarea
  // and dispatches an 'input' event. Listen for that and re-import the new
  // text into Quill. Wrapped in the sync guard so the resulting text-change
  // from setText doesn't echo back and overwrite the textarea.
  textarea.addEventListener('input', function() {
    if (_courseDescSyncInProgress) return;
    _courseDescSyncInProgress = true;
    var incoming = textarea.value || '';
    // If the incoming value looks like HTML (e.g., came back from a save
    // round-trip), paste it as HTML. Otherwise treat as plain text so the
    // AI Cleanup output (plain prose) lands cleanly.
    if (/<[a-z][^>]*>/i.test(incoming)) {
      quill.setContents([]);
      withImagesAllowed(quill, function() {
        quill.clipboard.dangerouslyPasteHTML(sanitizeDescriptionHtml(incoming));
      });
    } else {
      quill.setText(incoming);
    }
    _courseDescSyncInProgress = false;
  });

  // Wire up S/M/L image sizing. Same toolbar widget as the lesson editor.
  // Save callback runs when the creator clicks S/M/L (Quill's text-change
  // doesn't fire for class-only attribute changes), syncing the resized
  // HTML through the sanitizer to the textarea so it persists on next save.
  // mountTarget is the same element passed to `new Quill()`, so it's now
  // classed as `.ql-container` and has the toolbar as its previousElementSibling.
  setupImageSizing(quill, mountTarget, function(rawHtml) {
    var html = sanitizeDescriptionHtml(rawHtml);
    if (html === '<p><br></p>') html = '';
    _courseDescSyncInProgress = true;
    textarea.value = html;
    _courseDescSyncInProgress = false;
    updateCourseDescCounter(html.length);
  });

  _courseDescQuill = quill;
  // Set initial counter value based on whatever's already in the textarea.
  updateCourseDescCounter((textarea.value || '').length);
  return quill;
}

// Update the visible character counter for the description editor. Colors
// shift from muted → amber → red as the user approaches the limit, giving a
// soft warning before the hard cap kicks in. Called on every text-change.
function updateCourseDescCounter(length) {
  var el = document.getElementById('course-desc-counter');
  if (!el) return;
  var remaining = COURSE_DESC_MAX_HTML - length;
  el.textContent = length + ' / ' + COURSE_DESC_MAX_HTML;
  if (length >= COURSE_DESC_MAX_HTML) {
    el.style.color = '#ef4444';
  } else if (remaining < 300) {
    el.style.color = '#fbbf24';
  } else {
    el.style.color = 'var(--muted)';
  }
}

function unmountCourseDescEditor() {
  // Always clear the host DOM, even if _courseDescQuill is null. Defends
  // against leftover Quill DOM from a previous mount whose reference was
  // lost (page navigation, error during mount, etc).
  try {
    var host = document.getElementById('course-desc-editor');
    if (host) host.innerHTML = '';
  } catch (e) { /* non-fatal */ }
  _courseDescQuill = null;
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

  // Block <img> embeds from paste/drop. Only the toolbar image button can
  // add images, which routes through our compress + upload pipeline with
  // a unique filename per upload. Prevents cross-content duplicate storage
  // references, clipboard-image base64 bloat, and fragile external image URLs.
  stripPastedImages(quill);

  // Seed initial content. Old plain-text lessons get wrapped in <p>; lessons
  // already saved as HTML pass through sanitizer (defense in depth).
  var initial = lesson.text_content || '';
  if (initial && !/<[a-z]/i.test(initial)) {
    initial = '<p>' + initial.replace(/\n/g, '<br>') + '</p>';
  }
  var sanitizedInitial = sanitizeLessonHtml(initial);
  withImagesAllowed(quill, function() {
    quill.clipboard.dangerouslyPasteHTML(0, sanitizedInitial, 'silent');
  });

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
  // applies the corresponding size class. The callback persists the resized
  // HTML through the lesson-field save path so the size class survives.
  setupImageSizing(quill, container, function(html) {
    updateLessonField(mi, li, 'text_content', sanitizeLessonHtml(html));
  });

  _courseQuillInstances[key] = quill;
  return quill;
}

// Apply standard aria-labels to a Quill 1.x Snow toolbar + tooltip. Idempotent:
// safe to call multiple times since each branch checks hasAttribute first.
// Accepts ANY element that lives inside the Quill widget - toolbar, container,
// or .ql-editor (quill.root) - since the DOM hierarchy varies depending on how
// Quill was mounted (mount target becomes .ql-container, with .ql-toolbar as
// its previous sibling; .ql-editor is nested INSIDE .ql-container, so passing
// quill.root requires walking up one level to find the toolbar).
function applyQuillA11yLabels(anyEl) {
  if (!anyEl) return;
  // Find the .ql-container ancestor (or self), then look back to find the
  // sibling .ql-toolbar. Quill always places these as adjacent siblings.
  var qlContainer = anyEl.closest ? (anyEl.closest('.ql-container') || anyEl) : anyEl;
  var toolbar = null;
  // Case 1: passed in the original mount target (now classed .ql-container).
  //         Its previousElementSibling is the toolbar.
  if (qlContainer.previousElementSibling && qlContainer.previousElementSibling.classList.contains('ql-toolbar')) {
    toolbar = qlContainer.previousElementSibling;
  }
  // Case 2: walk up looking for any sibling .ql-toolbar adjacent to a
  //         .ql-container ancestor (covers passed-in toolbar OR editor).
  if (!toolbar && anyEl.previousElementSibling && anyEl.previousElementSibling.classList && anyEl.previousElementSibling.classList.contains('ql-toolbar')) {
    toolbar = anyEl.previousElementSibling;
  }
  // Case 3: query within the parent of the container as a fallback.
  if (!toolbar && qlContainer.parentElement) {
    toolbar = qlContainer.parentElement.querySelector('.ql-toolbar');
  }
  if (!toolbar) return;

  // Icon-only toolbar buttons. List is hardcoded against Quill Snow theme
  // defaults; if new toolbar items are added in any editor config, add them
  // here so screen readers and WAVE see accessible names.
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
  // Header dropdown is a <select>, not a button. WAVE flags it as missing
  // form label otherwise.
  toolbar.querySelectorAll('select.ql-header').forEach(function(sel) {
    if (!sel.hasAttribute('aria-label')) sel.setAttribute('aria-label', 'Heading level');
  });

  // Quill's link/video/formula tooltip. It can sit inside .ql-container OR as
  // a sibling, depending on theme + version. Query everywhere reasonable.
  var tooltip = null;
  var searchRoots = [qlContainer, qlContainer.parentElement, toolbar.parentElement];
  for (var i = 0; i < searchRoots.length && !tooltip; i++) {
    if (searchRoots[i] && searchRoots[i].querySelector) {
      tooltip = searchRoots[i].querySelector('.ql-tooltip');
    }
  }
  if (tooltip) {
    var input = tooltip.querySelector('input[type="text"]');
    if (input && !input.hasAttribute('aria-label')) {
      // The placeholder shifts (Enter link URL / Embed URL / formula) as
      // Quill switches modes; "Enter URL" is a reasonable umbrella label.
      input.setAttribute('aria-label', 'Enter URL');
    }
    var preview = tooltip.querySelector('a.ql-preview');
    if (preview && !preview.hasAttribute('aria-label')) {
      preview.setAttribute('aria-label', 'Current link URL');
    }
  }
}
// Expose so other dashboard JS files (products.js, coaching.js) can call it
// without re-declaring the labeling logic per-editor.
window.applyQuillA11yLabels = applyQuillA11yLabels;

// Strip <img> embeds from anything pasted or dropped into the Quill editor.
// All four image-paste mechanics (paste from another lesson, paste from
// external page, paste clipboard image data, drag-drop file) hit Quill's
// clipboard pipeline and produce <img> embeds. By dropping them at the
// matcher layer, we guarantee that the ONLY way an image enters the editor
// is via the toolbar image button, which routes through compressLessonImage
// + a fresh upload to course-images with a unique filename. Three benefits:
//   1. No collision risk on storage cleanup. Two visually-identical uploads
//      produce two distinct storage paths, so deleting one never breaks the
//      other's reference.
//   2. No base64 bloat from clipboard image data, which would otherwise
//      eat the text_content character budget and the DB row size.
//   3. No fragile external image URLs that break when the source host
//      changes; every image is on our CDN with WebP compression applied.
// IMPORTANT: matchers run on every paste, INCLUDING quill.clipboard.dangerously-
// PasteHTML (despite the misleading "dangerously" prefix referring to input
// escaping, not matcher bypass). We use the _ryxaAllowImages flag to let our
// own programmatic seed pastes (loading saved content from the DB) keep their
// images. User-initiated paste/drop runs with the flag false and gets stripped.
function stripPastedImages(quill) {
  if (!quill || !quill.clipboard || typeof quill.clipboard.addMatcher !== 'function') return;
  quill.clipboard.addMatcher('img', function(node, delta) {
    // If our own programmatic paste set this flag, keep the image: return the
    // delta unchanged. Otherwise drop the image with an empty Delta.
    if (quill._ryxaAllowImages) return delta;
    var Delta = Quill.import('delta');
    return new Delta();
  });
}

// Run a function (typically a quill.clipboard.dangerouslyPasteHTML call) with
// the image-allow flag temporarily set, so our own programmatic seed pastes
// of saved content keep their <img> embeds intact. try/finally guarantees the
// flag goes back off even if the inner call throws, so user paste/drop after
// a failed seed still gets images stripped.
function withImagesAllowed(quill, fn) {
  if (!quill) { fn(); return; }
  var prev = quill._ryxaAllowImages;
  quill._ryxaAllowImages = true;
  try {
    fn();
  } finally {
    quill._ryxaAllowImages = prev || false;
  }
}

// Shared S/M/L image-sizing toolbar setup. Used by the lesson editor and the
// course / booking / product description editors. The function adds the
// S/M/L + Remove button group to the toolbar, wires up click-to-select-image
// behavior in the editor, and calls `saveCallback(html)` whenever the user
// resizes (since Quill's text-change event doesn't fire for class-only
// attribute changes). The callback receives the SANITIZED HTML; it owns
// deciding which sanitizer to use and where to persist it.
//
// Clicking an image also syncs Quill's selection to span the embed so
// Delete/Backspace work on the visually-selected image - without this,
// pressing Delete with an image visually selected does nothing because our
// click handler never moved Quill's cursor.
function setupImageSizing(quill, container, saveCallback) {
  var toolbar = container.previousElementSibling; // .ql-toolbar sits just before .ql-container
  if (!toolbar || !toolbar.classList.contains('ql-toolbar')) {
    // Fallback: find by query (Quill always places toolbar adjacent to container)
    toolbar = container.parentElement && container.parentElement.querySelector('.ql-toolbar');
    if (!toolbar) return;
  }

  // Apply standard Quill aria-labels (toolbar buttons, header select, tooltip
  // input + preview). Shared helper so course-description, product-description,
  // and coaching-description editors also stay accessible.
  applyQuillA11yLabels(container);

  // Inject S/M/L + Remove button group right before the "clean" button (last
  // group). For toolbars that omit the clean button (course/product/booking
  // descriptions), the group simply appends at the end. The Remove button is
  // visually separated from S/M/L (sits to the right after a divider) and
  // styled with a red tint so it reads as destructive. Trash icon is the
  // standard "delete" affordance and stays clear at small sizes.
  var group = document.createElement('span');
  group.className = 'ql-formats lesson-img-size-toolbar';
  group.innerHTML = '<button type="button" data-img-size="small" title="Small image" aria-label="Small image size">S</button>'
    + '<button type="button" data-img-size="medium" title="Medium image" aria-label="Medium image size">M</button>'
    + '<button type="button" data-img-size="large" title="Large image" aria-label="Large image size">L</button>'
    + '<button type="button" data-img-action="remove" title="Remove image" aria-label="Remove image" class="lesson-img-remove-btn">'
    + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
    + '</button>';
  // Insert before the last .ql-formats group (which is "clean" in the lesson
  // editor); if no "clean" exists (description editors), append at the end.
  var groups = toolbar.querySelectorAll('.ql-formats');
  var cleanGroup = groups[groups.length - 1];
  // Only insert-before if the last group actually contains a clean button.
  // Otherwise our S/M/L group is itself the last meaningful group and we
  // want it to render after everything else.
  if (cleanGroup && cleanGroup.querySelector('button.ql-clean')) {
    toolbar.insertBefore(group, cleanGroup);
  } else {
    toolbar.appendChild(group);
  }

  // Track the currently-selected image. Click on an image to select it.
  // Clicking elsewhere deselects. Selecting an image also moves Quill's
  // cursor to span the embed so Delete/Backspace work as expected - without
  // this, pressing Delete with an image visually selected does nothing
  // because Quill's selection range never moved.
  var selectedImg = null;
  function selectImage(img) {
    if (selectedImg) selectedImg.classList.remove('lesson-img-selected');
    selectedImg = img;
    if (selectedImg) selectedImg.classList.add('lesson-img-selected');
    // Toggle the "alive" group state, drives the CSS that lights up the
    // S/M/L + Remove buttons so creators see where to click.
    group.classList.toggle('has-selection', !!selectedImg);
    // Enable/disable buttons based on whether we have a selection. The
    // Remove button (data-img-action) and S/M/L buttons (data-img-size) all
    // share the same enabled state since they all require a selected image.
    group.querySelectorAll('button').forEach(function(btn) {
      btn.disabled = !selectedImg;
      if (btn.dataset.imgSize) {
        btn.classList.toggle('lesson-img-size-active', !!selectedImg && selectedImg.classList.contains('lesson-img-size-' + btn.dataset.imgSize));
      }
    });
    // Sync Quill's selection range to span the image embed. This lets the
    // browser's Delete/Backspace work on the visually-selected image. Wrap
    // in a try/catch because Quill.find() returns null for nodes it doesn't
    // recognize (shouldn't happen for properly-inserted images, but guard
    // against weird HTML round-trips). 'silent' source avoids re-emitting
    // selection-change events that could loop back into our handlers.
    if (selectedImg) {
      try {
        var blot = Quill.find(selectedImg);
        if (blot) {
          var idx = quill.getIndex(blot);
          if (typeof idx === 'number' && idx >= 0) {
            quill.setSelection(idx, 1, 'silent');
          }
        }
      } catch (e) { /* non-fatal: keyboard delete just won't work for this image */ }
    }
  }

  quill.root.addEventListener('click', function(e) {
    if (e.target.tagName === 'IMG') {
      selectImage(e.target);
    } else {
      selectImage(null);
    }
  });

  // S/M/L + Remove button handlers. Same listener handles both because they
  // share the same enabled-on-selection lifecycle.
  group.addEventListener('click', function(e) {
    var sizeBtn = e.target.closest('button[data-img-size]');
    var actionBtn = e.target.closest('button[data-img-action]');
    if (!selectedImg) return;

    if (sizeBtn) {
      var size = sizeBtn.dataset.imgSize;
      selectedImg.classList.remove('lesson-img-size-small', 'lesson-img-size-medium', 'lesson-img-size-large');
      selectedImg.classList.add('lesson-img-size-' + size);
      // Refresh active button state
      group.querySelectorAll('button[data-img-size]').forEach(function(b) {
        b.classList.toggle('lesson-img-size-active', b.dataset.imgSize === size);
      });
      // Trigger save (manually since text-change won't fire for class changes).
      // The caller's saveCallback decides which sanitizer to use and where to
      // persist. We hand it the raw editor HTML; caller sanitizes appropriately.
      var html = quill.root.innerHTML;
      if (html === '<p><br></p>') html = '';
      if (typeof saveCallback === 'function') saveCallback(html);
      return;
    }

    if (actionBtn && actionBtn.dataset.imgAction === 'remove') {
      // Delete via Quill's deleteText API so the operation goes through
      // Quill's history stack (Ctrl+Z restores the image). source='user'
      // makes text-change fire normally, which triggers the editor's
      // sync-to-textarea logic on the description editors and the lesson
      // editor's save callback. Find the blot's index right before delete
      // (DOM might have shifted since we cached the selection earlier).
      try {
        var blot = Quill.find(selectedImg);
        if (blot) {
          var idx = quill.getIndex(blot);
          if (typeof idx === 'number' && idx >= 0) {
            quill.deleteText(idx, 1, 'user');
          }
        }
      } catch (err) {
        console.warn('Image removal failed:', err);
      }
      // Clear our selection state regardless of delete success: the image
      // is either gone or the operation failed and the user can try again.
      selectImage(null);
      return;
    }
  });

  // Clean up stale selectedImg pointer after any edit that may have removed
  // the image (keyboard Delete/Backspace, undo, paste-replace, etc.). Without
  // this, our closure still holds a reference to a detached DOM node and the
  // S/M/L/Remove buttons stay visually enabled even though nothing's actually
  // selected. Cheap check: isConnected returns false for nodes removed from
  // the document.
  quill.on('text-change', function() {
    if (selectedImg && !selectedImg.isConnected) {
      selectImage(null);
    }
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
        + '<input type="text" maxlength="200" value="' + escapeHtml((a && a.text) || '') + '" placeholder="Answer ' + (ai + 1) + '" data-course-action="update-answer-text" data-course-event="input" data-course-mi="' + mi + '" data-course-qi="' + qi + '" data-course-ai="' + ai + '" aria-label="Answer ' + (ai + 1) + ' text" class="course-s-quiz-answer-input">'
        + '</div>';
    }).join('');

    return '<div class="course-s-quiz-question">'
      + '<div class="course-s-quiz-question-head">'
      + '<span class="course-s-quiz-qnum">Q' + (qi + 1) + '</span>'
      + '<input type="text" maxlength="300" value="' + escapeHtml(q.text || '') + '" placeholder="Question text" data-course-action="update-question-text" data-course-event="input" data-course-mi="' + mi + '" data-course-qi="' + qi + '" aria-label="Question ' + (qi + 1) + ' text" class="course-s-quiz-q-input">'
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
        + '<input type="text" maxlength="100" value="' + escapeHtml(l.title) + '" placeholder="Lesson title" data-course-action="update-lesson-field" data-course-event="input" data-course-mi="' + mi + '" data-course-li="' + li + '" data-course-field="title" aria-label="Lesson title" class="course-s-9fc438">'
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
                + '<input type="url" maxlength="500" value="' + escapeHtml(l.video_url || '') + '" placeholder="Video URL (YouTube, Vimeo, or Loom)" data-course-action="validate-video-url" data-course-event="input" data-course-action-blur="validate-video-url-blur" data-course-mi="' + mi + '" data-course-li="' + li + '" data-course-field="video_url" aria-label="Video URL" class="course-s-59ebc5">'
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
        // Downloadable files (per lesson, up to 1 GB each, shared with
        // Digital Products on the 10 GB account quota).
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
              // When _uploading is true, show "Uploading..." instead of the size
              // and hide the delete button. The temp row is swapped for the
              // real row after the R2 PUT completes (see uploadLessonFile).
              // While uploading: show "Uploading..." in muted text, no delete button.
              // When ready: show file size + green "✓ Ready" status. Matches the
              // Digital Products UX so creators get the same at-a-glance feedback
              // across both tools.
              var sizeOrStatus = f._uploading
                ? '<span class="course-s-file-size">Uploading...</span>'
                : '<span class="course-s-file-size">' + window.FileValidation.formatBytes(f.file_size_bytes)
                  + ' \u00b7 <span class="course-s-file-ready">\u2713 Ready</span></span>';
              var deleteBtn = f._uploading
                ? ''
                : '<button type="button" data-course-action="delete-lesson-file" data-course-lesson-id="' + l.id + '" data-course-file-id="' + f.id + '" class="course-s-file-del" title="Delete file" aria-label="Delete file">'
                  + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
                  + '</button>';
              return '<div class="course-s-file-row">'
                + '<svg class="course-s-file-icn" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
                + '<span class="course-s-file-name">' + escapeHtml(f.filename) + '</span>'
                + sizeOrStatus
                + deleteBtn
                + '</div>';
            }).join('');
            var addBtn = '<label class="course-s-file-add">'
              + '<input type="file" data-course-action="add-lesson-file" data-course-event="change" data-course-mi="' + mi + '" data-course-li="' + li + '" hidden>'
              + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
              + 'Add file</label>';
            return '<div class="course-s-files-panel">'
              + '<div class="course-s-files-header">'
              + '<span class="course-s-files-title">Downloads</span>'
              + '<span class="course-s-files-hint">Up to 1 GB per file. Students can download these from the lesson page.</span>'
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
      + '<input type="text" maxlength="100" value="' + escapeHtml(mod.title) + '" placeholder="Module title (e.g., Getting Started)" data-course-action="update-module-title" data-course-event="input" data-course-mi="' + mi + '" aria-label="Module title" class="course-s-ced5e0">'
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
  // selected file (we don't support multi-select for lesson files; one file at
  // a time keeps the upload UI simple). Clears input after.
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
    // uploadLessonFile already re-rendered with the real row. Just refresh
    // the account storage indicator.
    refreshCourseStorage();
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
      if (mod.quiz && mod.quiz.id) courseExplicitRemovals.add(mod.quiz.id);
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

