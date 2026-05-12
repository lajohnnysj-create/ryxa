// =============================================================================
// /js/course.js — Course Builder (extracted from dashboard.html, 2026-05-10)
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
// END INFRASTRUCTURE — Course state + functions follow
// =============================================================================

// ---------- From dashboard.html lines 13313-13320 (Course state) ----------
// =====================================================
// COURSES — Creator Course Builder (Max only)
// =====================================================
let coursesList = [];
let currentCourseId = null;
let courseModules = []; // local working copy: [{id, title, sort_order, lessons: [{id, title, lesson_type, video_url, text_content, sort_order, is_preview}]}]
let courseCoverFile = null;
let coursesInited = false;

// ---------- From dashboard.html lines 13880-14773 (Course functions) ----------
function initCoursesTool() {
  const max = isMax();
  document.getElementById('courses-upsell').style.display = max ? 'none' : 'block';
  document.getElementById('courses-list-view').style.display = max ? 'block' : 'none';
  document.getElementById('courses-editor-view').style.display = 'none';
  if (max && !coursesInited) {
    coursesInited = true;
    loadCoursesList();
  } else if (max) {
    renderCoursesList();
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
    // (applied via JS post-render — CSP-strict, no inline style attribute).
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

// Auto-generate slug from title (only for new courses — slug is locked once saved)
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

async function saveCourse() {
  const title = document.getElementById('course-title-input').value.trim();
  const slug = document.getElementById('course-slug-input').value.trim();
  const description = document.getElementById('course-desc-input').value.trim();
  const completionMessage = document.getElementById('course-completion-msg').value.trim();
  const priceStr = document.getElementById('course-price-input').value;
  const priceCents = Math.round(parseFloat(priceStr || '0') * 100);

  if (!title) { showCourseMsg('error', 'Please enter a course title.'); return; }
  if (!slug) { showCourseMsg('error', 'URL slug is empty. Please enter a title.'); return; }

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
      // Insert — slug is set once and locked permanently
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

    showCourseMsg('success', 'Course saved!');
    courseCoverFile = null;
  } catch (err) {
    showCourseMsg('error', 'Failed to save: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
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
    showCourseMsg('success', 'Course published! Landing page: ryxa.io/course/' + (course?.slug || '') + ' <button data-course-action="copy-publish-url" data-course-url="https://ryxa.io/course/' + (course?.slug || '') + '" class="course-s-e57ade">Copy</button>', true);
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

  courseModules = (modules || []).map(m => ({
    ...m,
    lessons: (lessons || []).filter(l => l.module_id === m.id).map(l => ({ ...l, _collapsed: true }))
  }));
  renderCourseModules();
}

async function saveCourseModules(courseId) {
  // Delete existing and re-insert (simplest approach for MVP)
  await sb.from('course_lessons').delete().eq('course_id', courseId);
  await sb.from('course_modules').delete().eq('course_id', courseId);

  for (let mi = 0; mi < courseModules.length; mi++) {
    const mod = courseModules[mi];
    const { data: savedMod, error: modErr } = await sb.from('course_modules').insert({
      course_id: courseId,
      title: mod.title || 'Untitled Module',
      sort_order: mi
    }).select().single();
    if (modErr || !savedMod) continue;
    mod.id = savedMod.id;

    for (let li = 0; li < (mod.lessons || []).length; li++) {
      const lesson = mod.lessons[li];
      await sb.from('course_lessons').insert({
        course_id: courseId,
        module_id: savedMod.id,
        title: lesson.title || (lesson.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson'),
        lesson_type: lesson.lesson_type || 'video',
        video_url: lesson.video_url || null,
        text_content: lesson.text_content || '',
        sort_order: li,
        is_preview: !!lesson.is_preview,
        images: lesson.images || []
      });
    }
  }
}

function addCourseModule() {
  courseModules.push({ id: 'new_' + Date.now(), title: '', lessons: [] });
  renderCourseModules();
}

function removeCourseModule(idx) {
  showModalConfirm('Delete Module', 'Are you sure you want to delete this module and all its lessons?', function() {
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
  showModalConfirm('Delete Lesson', 'Are you sure you want to delete this lesson?', function() {
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

function updateModuleTitle(modIdx, val) {
  courseModules[modIdx].title = val;
}

function updateLessonField(modIdx, lessonIdx, field, val) {
  courseModules[modIdx].lessons[lessonIdx][field] = val;
}

function toggleLessonPreview(modIdx, lessonIdx) {
  courseModules[modIdx].lessons[lessonIdx].is_preview = !courseModules[modIdx].lessons[lessonIdx].is_preview;
  renderCourseModules();
}

function collapseLesson(modIdx, lessonIdx) {
  // Tear down the Quill instance (if any) before the host div is removed
  // by the upcoming re-render. Prevents stale references piling up across
  // expand/collapse cycles.
  unmountLessonEditor(modIdx, lessonIdx);
  courseModules[modIdx].lessons[lessonIdx]._collapsed = true;
  renderCourseModules();
}

function expandLesson(modIdx, lessonIdx) {
  courseModules[modIdx].lessons[lessonIdx]._collapsed = false;
  renderCourseModules();
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

function showEmbedInfo() {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = '<div class="course-s-df9ce6">'
    + '<div class="course-s-4aaba5">'
    + '<h3 class="course-s-09f83d">Video Embedding</h3>'
    + '<button data-course-action="close-fixed-modal" class="course-s-a2c730">✕</button>'
    + '</div>'
    + '<div class="course-s-5423bf">'
    + '<p class="course-s-6da853">Ryxa embeds videos from YouTube, Vimeo, and Loom to keep hosting costs low for creators. You host your videos on those platforms and paste the link into your lesson. The video plays directly inside your course.</p>'
    + '<p class="course-s-6da853"><strong class="course-s-9d9c33"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> YouTube</strong>Upload your video as "Unlisted." It won\'t appear in search results. Only people viewing it embedded in your course can watch it. YouTube Shorts URLs also work.</p>'
    + '<p class="course-s-6da853"><strong class="course-s-9d9c33"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="#fff"/></svg> Loom</strong>Great for quick walkthroughs and screen recordings. Paste any Loom share link (loom.com/share/...) and it embeds directly. Note: Loom share links are publicly viewable by default, so for premium course content where leak prevention matters, prefer Vimeo with domain restriction.</p>'
    + '<p class="course-s-6da853"><strong class="course-s-9d9c33"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg> Vimeo (recommended for extra security)</strong>Vimeo offers domain-level privacy, which restricts where your video can be embedded. This prevents anyone from copying your embed link and playing it on their own site.</p>'
    + '<p class="course-s-e9cdf8">Vimeo Domain Restriction Setup:</p>'
    + '<div class="course-s-72a4a4">'
    + '1. Go to your video\'s settings on Vimeo<br>'
    + '2. Click the <strong class="mk-s-e0b980">Share</strong> button at the top<br>'
    + '3. Under "Where can this be embedded?" select <strong class="mk-s-e0b980">Specific domains</strong><br>'
    + '4. Add <strong class="course-s-701ab3">ryxa.io</strong> as an allowed domain<br>'
    + '5. Save — your video now only plays on your course page'
    + '</div>'
    + '<p class="course-s-5d130a">Domain-level privacy requires a paid Vimeo plan. YouTube\'s Unlisted setting is free and works well for most creators.</p>'
    + '</div>'
    + '</div>';
  document.body.appendChild(overlay);
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
// js/learn-page.js — keep the two in sync if either is updated, since the
// editor's validation indicator must match what the viewer can actually embed.
function detectVideoPlatform(url) {
  if (!url) return null;
  if (/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/.test(url)) return 'YouTube';
  if (/vimeo\.com\/(\d+)/.test(url)) return 'Vimeo';
  if (/loom\.com\/share\/([a-zA-Z0-9]+)/.test(url)) return 'Loom';
  return null;
}

// =============================================================================
// RICH TEXT EDITOR (Quill 1.3.7) — text lessons
// =============================================================================
// Quill and DOMPurify are lazy-loaded on first text-lesson expansion, mirroring
// the Tone.js pattern in scripts.js. Saves ~75KB on every dashboard load that
// doesn't open a text lesson. Both libraries are loaded from cdnjs (already
// permitted by the dashboard's script-src CSP).
//
// SECURITY: every HTML payload from a creator passes through DOMPurify before
// (a) being saved to text_content, and (b) being rendered to students in
// learn-page.js. Defense in depth — never trust HTML alone, even our own.

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
    function done() { if (++loaded === 2) resolve(); }
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

// DOMPurify config — what creators can produce, students can see. Whitelist
// matches Quill's output exactly (headings, lists, links, images, alignment
// classes, basic inline marks). Anything outside this list gets stripped.
var QUILL_PURIFY_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'img', 'span', 'div'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  // Quill applies alignment via 'ql-align-center', 'ql-align-right' classes.
  // Whitelist those (and only those) class values so creators can't inject
  // arbitrary CSS via class names that match third-party stylesheets.
  ADD_ATTR: ['target'],
  // Force all external links to open with rel="noopener noreferrer".
  // DOMPurify hook below applies this for any <a> tag with target=_blank.
};

function sanitizeLessonHtml(html) {
  if (typeof DOMPurify === 'undefined') return ''; // editor not loaded yet
  // Strip the editor-only 'lesson-img-selected' class so it never persists
  // to the DB. The class is used only by the editor to outline a selected
  // image; viewers never need it. Removing as a string before sanitize is
  // simpler than configuring DOMPurify to strip a single class value.
  var cleaned = (html || '').replace(/\blesson-img-selected\b/g, '').replace(/class="\s*"/g, '');
  return DOMPurify.sanitize(cleaned, QUILL_PURIFY_CONFIG);
}

// Count <img> tags in the current Quill content (used to enforce per-lesson
// image cap). A regex is fine here — Quill output is well-formed.
function countQuillImages(quill) {
  var html = quill.root.innerHTML;
  var matches = html.match(/<img\b/g);
  return matches ? matches.length : 0;
}

// Initialize a Quill editor inside the placeholder div for a given lesson.
// Called after Quill is loaded AND after the lesson body is in the DOM.
function mountLessonEditor(mi, li) {
  var key = mi + '-' + li;
  if (_courseQuillInstances[key]) return _courseQuillInstances[key]; // already mounted

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
          // Custom image handler — runs our existing compressLessonImage pipeline
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
                  if (lastImg && !lastImg.classList.contains('lesson-img-size-small') && !lastImg.classList.contains('lesson-img-size-medium') && !lastImg.classList.contains('lesson-img-size-large')) {
                    lastImg.classList.add('lesson-img-size-small');
                    // Trigger save so the class persists
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
  quill.clipboard.dangerouslyPasteHTML(0, sanitizeLessonHtml(initial), 'silent');

  // Save on every edit. We sanitize on the way IN to the data model so the
  // stored value is already clean. learn-page.js sanitizes again on render
  // (defense in depth).
  quill.on('text-change', function(delta, oldDelta, source) {
    if (source !== 'user') return; // ignore programmatic changes (initial seed)
    // Block paste/drag-and-drop of images that would push us over the cap.
    // We check AFTER the change so we can yank the last one if it pushed us
    // over. This is the cleanest UX in Quill — preventing image-paste at the
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

  // Inject S/M/L button group right before the "clean" button (last group).
  var group = document.createElement('span');
  group.className = 'ql-formats lesson-img-size-toolbar';
  group.innerHTML = '<button type="button" data-img-size="small" title="Small image">S</button>'
    + '<button type="button" data-img-size="medium" title="Medium image">M</button>'
    + '<button type="button" data-img-size="large" title="Large image">L</button>';
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
    // Toggle the "alive" group state — drives the CSS that lights up the
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
      const previewBadge = l.is_preview ? '<span class="course-s-6862c6">PREVIEW</span>' : '';
      const typeLabel = isVideo ? '<span class="course-s-955d08">VIDEO</span>' : '<span class="course-s-e89353">LESSON</span>';
      const isCollapsed = l._collapsed;
      const hasContent = isVideo ? !!(l.video_url) : !!(l.text_content);
      const preview = isVideo ? (l.video_url || '').slice(0, 40) : (l.text_content || '').slice(0, 50).replace(/\n/g, ' ');

      if (isCollapsed && (l.title || hasContent)) {
        // Collapsed view
        return '<div data-course-action="expand-lesson" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-fce34d">'
          + '<div class="bio-s-e3f610">'
          + '<span class="course-s-229509">' + (li + 1) + '.</span>'
          + '<span class="course-s-d63d24">' + escapeHtml(l.title || (isVideo ? 'Untitled Video' : 'Untitled Lesson')) + '</span>'
          + typeLabel + ' ' + previewBadge
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="bio-s-f38a95"><polyline points="6 9 12 15 18 9"/></svg>'
          + '</div>'
          + (preview ? '<div class="course-s-bd2dcd">' + escapeHtml(preview) + (preview.length >= 40 ? '...' : '') + '</div>' : '')
          + '</div>';
      }

      // Expanded view
      return '<div class="course-s-8ed674">'
        + '<div data-course-action="collapse-lesson" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-60e468">'
        + '<span class="course-s-229509">' + (li + 1) + '.</span>'
        + '<span class="course-s-d63d24">' + escapeHtml(l.title || (isVideo ? 'Untitled Video' : 'Untitled Lesson')) + '</span>'
        + typeLabel + ' ' + previewBadge
        + '<span><button data-course-action="remove-lesson" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-f3bc45" title="Delete lesson"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></span>'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="bio-s-f38a95"><polyline points="18 15 12 9 6 15"/></svg>'
        + '</div>'
        + '<div class="course-s-c42e2a">'
        + '<div class="mk-s-e4ad4a">'
        + '<input type="text" value="' + escapeHtml(l.title) + '" placeholder="Lesson title" data-course-action="update-lesson-field" data-course-event="input" data-course-mi="' + mi + '" data-course-li="' + li + '" data-course-field="title" aria-label="Lesson title" class="course-s-9fc438">'
        + '</div>'
        + '<div class="course-s-88348d">'
        + '<button data-course-action="toggle-lesson-preview" data-course-mi="' + mi + '" data-course-li="' + li + '" title="' + (l.is_preview ? 'Remove preview' : 'Mark as free preview') + '" class="course-s-82a6e1">' + (l.is_preview ? 'Paid' : 'Free') + '</button>'
        + '</div>'
        + (isVideo
          ? (function() {
              // Compute initial validation state so saved URLs show their status
              // immediately on render (no flash). Updates live via the
              // validate-video-url action on each keystroke (green appears
              // instantly when valid) and on blur (red appears for invalid
              // URLs once the user has stopped typing).
              var platform = detectVideoPlatform(l.video_url || '');
              var hasContent = !!(l.video_url || '').trim();
              var statusHtml = '';
              if (platform) {
                statusHtml = '<div class="course-s-vurl-status valid" id="vurl-status-' + mi + '-' + li + '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' + platform + '</div>';
              } else if (hasContent) {
                statusHtml = '<div class="course-s-vurl-status invalid" id="vurl-status-' + mi + '-' + li + '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Paste a YouTube, Vimeo, or Loom link</div>';
              } else {
                statusHtml = '<div class="course-s-vurl-status" id="vurl-status-' + mi + '-' + li + '"></div>';
              }
              return '<div class="course-s-vurl-wrap">'
                + '<input type="url" value="' + escapeHtml(l.video_url || '') + '" placeholder="Video URL (YouTube, Vimeo, or Loom)" data-course-action="validate-video-url" data-course-event="input" data-course-action-blur="validate-video-url-blur" data-course-mi="' + mi + '" data-course-li="' + li + '" data-course-field="video_url" aria-label="Video URL" class="course-s-59ebc5">'
                + statusHtml
                + '</div>';
            })()
          : '<div id="lesson-editor-' + mi + '-' + li + '" class="course-s-quill-host" data-course-mi="' + mi + '" data-course-li="' + li + '"></div>')
        // Move / info / done buttons. Icon-only to keep the row compact —
        // labels were redundant with the well-known up/down/info glyphs and
        // ate horizontal space. "Done" collapses the lesson (state is already
        // saved on every keystroke via update-lesson-field; this is a UX cue
        // for the user, not a real persistence step).
        + '<div class="course-s-f5e487">'
        + (li > 0 ? '<button data-course-action="move-lesson-up" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-1de440" title="Move lesson up" aria-label="Move lesson up"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>' : '')
        + (li < (mod.lessons.length - 1) ? '<button data-course-action="move-lesson-down" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-1de440" title="Move lesson down" aria-label="Move lesson down"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>' : '')
        + '<div class="bio-s-7623f0"></div>'
        + '<button data-course-action="show-embed-info" class="course-s-1de440" title="Embed info" aria-label="Embed info"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></button>'
        + '<button data-course-action="collapse-lesson" data-course-mi="' + mi + '" data-course-li="' + li + '" class="course-s-eb7439" title="Done editing">Done</button>'
        + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    return '<div class="course-s-be7f41">'
      + '<div class="course-s-4368db">'
      + '<div class="course-s-d97d4b">'
      + (mi > 0 ? '<button data-course-action="move-module-up" data-course-mi="' + mi + '" class="course-s-f1cd5a" title="Move module up"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>' : '<div class="course-s-0a4e53"></div>')
      + (mi < (courseModules.length - 1) ? '<button data-course-action="move-module-down" data-course-mi="' + mi + '" class="course-s-f1cd5a" title="Move module down"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>' : '<div class="course-s-0a4e53"></div>')
      + '</div>'
      + '<span class="course-s-2653e1">Module ' + (mi + 1) + '</span>'
      + '<input type="text" value="' + escapeHtml(mod.title) + '" placeholder="Module title (e.g., Getting Started)" data-course-action="update-module-title" data-course-event="input" data-course-mi="' + mi + '" aria-label="Module title" class="course-s-ced5e0">'
      + '<button data-course-action="remove-module" data-course-mi="' + mi + '" class="course-s-02ecf5">Remove</button>'
      + '</div>'
      + lessonsHtml
      + '<div class="course-s-3fed56">'
      + '<button data-course-action="add-lesson" data-course-mi="' + mi + '" data-course-lesson-type="video" class="course-s-be13d8">'
      + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
      + 'Add Video</button>'
      + '<button data-course-action="add-lesson" data-course-mi="' + mi + '" data-course-lesson-type="text" class="course-s-be13d8">'
      + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>'
      + 'Add Lesson</button>'
      + '</div>'
      + '</div>';
  }).join('');

  // Mount Quill editors for any text lessons that are currently expanded.
  // Runs every render — idempotent (mountLessonEditor skips already-mounted
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
}


// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

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

// Modal close (Embed Info modal)
courseRegisterAction('close-modal', (e, el) => {
  const modal = el.closest('div[style*=fixed]');
  if (modal) modal.remove();
});
courseRegisterAction('close-fixed-modal', (e, el) => {
  const modal = el.closest('div[style*=fixed]');
  if (modal) modal.remove();
});

// Copy publish URL (from publish success toast)
courseRegisterAction('copy-publish-url', (e, el) => copyPublishUrl(el.dataset.courseUrl, el));

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
// red mid-type — that would flash a "wrong" state at every character. The
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
    // Stay neutral while the user is still typing — blur-time will set red.
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
courseRegisterAction('toggle-lesson-preview', (e, el) => {
  toggleLessonPreview(parseInt(el.dataset.courseMi, 10), parseInt(el.dataset.courseLi, 10));
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
courseRegisterAction('show-embed-info', () => showEmbedInfo());

// Module interactions
courseRegisterAction('move-module-up', (e, el) => moveModuleUp(parseInt(el.dataset.courseMi, 10)));
courseRegisterAction('move-module-down', (e, el) => moveModuleDown(parseInt(el.dataset.courseMi, 10)));
courseRegisterAction('update-module-title', (e, el) => updateModuleTitle(parseInt(el.dataset.courseMi, 10), el.value));
courseRegisterAction('remove-module', (e, el) => removeCourseModule(parseInt(el.dataset.courseMi, 10)));

