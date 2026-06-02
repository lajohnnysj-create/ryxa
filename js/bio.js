// =============================================================================
// /js/bio.js — Link in Bio editor (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// This file contains all JavaScript for the Link in Bio editor inside the
// Ryxa dashboard. It was extracted from dashboard.html as part of the Phase 1
// dashboard refactor to reduce single-file size and prepare for stricter CSP.
//
// Phase 1 SCOPE: code relocation only — no behavioral changes.
// Phase 2 SCOPE (2026-05-10): replaced inline onclick/oninput/etc with
//   delegated event handling so the bio tool is compatible with strict CSP
//   (no `unsafe-inline` for script-src). See "EVENT DELEGATION" section below.
//
// External dependencies remain on `window` (sb, Auth, currentUser,
// escapeHtml, isPro, isMax, currentTier, BIO_THEMES, BIO_FONTS,
// showModalAlert, showModalConfirm, etc).
//
// Future phases (NOT YET DONE):
//   • Phase 3: replace inline style attributes with CSS classes
//   • Phase 4: ship strict CSP header for the bio tool
//
// Order of code below matches original line order in dashboard.html so diffs
// stay minimal and review is easy.
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE
// -----------------------------------------------------------------------------
// All bio-tool buttons, inputs, and other interactive elements use
// `data-bio-action="..."` attributes instead of inline onclick/oninput/etc.
//
// Single document-level listener per event type dispatches to a handler
// function registered in `bioActions`. Parameters are read from `data-bio-*`
// attributes on the target element.
//
// Why this matters: Inline handlers like onclick="foo()" require CSP
// `script-src 'unsafe-inline'`. Delegated handlers run from this file
// (a `'self'`-sourced script), so CSP can be locked down to script-src 'self'
// for the bio tool surface.
// =============================================================================

// Registry of action handlers. Each function receives (event, element).
// `element` is the element with the data-bio-action attribute (may differ
// from event.target if the user clicked a child element, e.g., an SVG icon
// inside a button).
const bioActions = {};

/**
 * Register a handler for a data-bio-action value.
 * @param {string} action - The data-bio-action string (e.g., "save").
 * @param {function(Event, Element): void} handler
 */
function bioRegisterAction(action, handler) {
  bioActions[action] = handler;
}

/**
 * Find the closest ancestor element with a bio action matching the given
 * event type. Returns { element, action } or null if none.
 *
 * Supports two attribute styles on the same element:
 *   1. Per-event:  data-bio-action-input="username-input"
 *                  data-bio-action-focus="remove-readonly"
 *   2. Generic:    data-bio-action="save"  (defaults to click)
 *                  data-bio-action="username-input" data-bio-event="input"
 *
 * Style 1 lets a single element have different handlers for different events
 * (e.g. an <input> with both an input handler and a focus handler).
 * Style 2 is the common case for buttons / single-event elements.
 */
function bioFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      // Style 1: per-event attribute (data-bio-action-input, etc.)
      const perEvent = el.dataset['bioAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      // Style 2: generic data-bio-action with optional data-bio-event
      if (el.dataset.bioAction) {
        const wantEvent = el.dataset.bioEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.bioAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Generic event dispatcher. Wired up below to multiple event types.
 */
function bioDispatchEvent(event) {
  // Drag handle guard: the entire collapsed link row has
  // data-bio-action="expand-link", which means a click on the drag handle
  // (which is INSIDE the row) would expand the link. SortableJS's drag start
  // also fires click events on touch devices, so without this guard the link
  // would un-collapse every time the user tries to grab and drag. Skip
  // dispatch when the click originated inside the drag handle.
  if (event.type === 'click' && event.target.closest && event.target.closest('.bio-link-drag')) {
    return;
  }
  const found = bioFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = bioActions[found.action];
  if (!handler) {
    console.warn('[bio] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

// Wire up document-level delegation. Using document (not #tool-bio) because
// bio modals are inserted into document.body, not into the bio tool root.
// Capture: false — we want bubbling so child elements get to handle their
// own events first if needed.
['click', 'input', 'change', 'focus', 'blur', 'keydown', 'mouseover', 'mouseout'].forEach(evt => {
  // 'focus' and 'blur' don't bubble; use capture phase for those.
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, bioDispatchEvent, useCapture);
});

// =============================================================================
// END EVENT DELEGATION INFRASTRUCTURE
// =============================================================================

// =============================================================================
// CSP-STRICT STYLE APPLICATION (Phase 3)
// -----------------------------------------------------------------------------
// Some elements need styles that depend on dynamic data (theme colors, image
// URLs, etc.). With strict CSP (`style-src 'self'`), inline `style="..."`
// attributes are blocked. So we render with `data-bio-*` attributes and apply
// them programmatically after insertion. JS property assignments are NOT
// blocked by CSP.
//
// Map: data-bio-{name} → CSS property to set
// =============================================================================
const BIO_DATA_STYLE_MAP = {
  bg:          'background',
  color:       'color',
  border:      'border',
  shadow:      'box-shadow',
  padding:     'padding',
  radius:      'border-radius',
  display:     'display',
  fontFamily:  'font-family',
  // Add more as needed when extending dynamic styles
};

/**
 * Walk all descendants of `root` (or `document` if omitted) and apply any
 * `data-bio-{name}` attributes from BIO_DATA_STYLE_MAP as inline style
 * properties via JS (CSP-safe).
 *
 * Idempotent — calling repeatedly is fine. Only sets properties that have
 * a data-bio-* attribute on the element.
 */
function bioApplyDataStyles(root) {
  root = root || document;
  // Collect all elements that have at least one mapped data-bio-* attr
  const selectors = Object.keys(BIO_DATA_STYLE_MAP)
    .map(k => `[data-bio-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}]`)
    .join(',');
  const els = root.querySelectorAll(selectors);
  els.forEach(el => {
    Object.entries(BIO_DATA_STYLE_MAP).forEach(([camelName, cssProp]) => {
      const dashName = camelName.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
      const val = el.dataset['bio' + camelName.charAt(0).toUpperCase() + camelName.slice(1)];
      if (val) el.style.setProperty(cssProp, val);
    });
  });
}

// =============================================================================
// END CSP-STRICT STYLE APPLICATION
// =============================================================================

// ---------- From dashboard.html lines 8415-8466 ----------
function copySidebarBioLink() {
  var textEl = document.getElementById('sidebar-menu-biolink-text');
  if (!textEl) return;
  var linkText = textEl.textContent;
  if (!linkText || linkText === 'ryxa.io/...') return;
  var fullUrl = 'https://' + linkText;

  function showCopied() {
    var orig = linkText;
    textEl.textContent = 'Copied!';
    textEl.style.color = '#4ade80';
    setTimeout(function() { textEl.textContent = orig; textEl.style.color = ''; }, 1500);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullUrl).then(showCopied).catch(function() {
      fallbackCopy(fullUrl);
      showCopied();
    });
  } else {
    fallbackCopy(fullUrl);
    showCopied();
  }
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;left:-9999px;';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function copyPublishUrl(url, btn) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function() {
      btn.textContent = 'Copied!';
      setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
    }).catch(function() { fallbackCopy(url); btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = 'Copy'; }, 1500); });
  } else {
    fallbackCopy(url);
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
  }
}

function showBioLinkButtons() {
  var el = document.getElementById('sidebar-menu-biolink');
  if (el) el.style.display = 'block';
}

// ---------- From dashboard.html lines 9614-12781 ----------
let bioState = {
  username: '',
  display_name: '',
  bio: '',
  avatar_url: '',
  avatar_display: 'default',
  theme: 'purple',
  font_family: 'DM Sans',
  socials: {},
  links: [],
  videos: [],
  published: false,
  show_branding: true,
  sensitive_content: false,
  custom_theme: null, // { bgUrl, bgOpacity, colors: {bg, card, text, accent}, applied: bool }
};
let bioStaleBgs = []; // queue old bg urls to delete on save
let bioInited = false;
let bioCropper = null;
let bioCropTarget = null;  // 'avatar' or {type:'featured', linkId}
let bioCropSource = null;  // original File object
let bioOriginalUsername = ''; // for rename detection
let bioDraggingLink = false;
let bioPreviewTimer = null;
let linkIdSeq = 1;

// =====================================================
// LINK IN BIO — Collapsible Sections
// =====================================================
const BIO_COLLAPSE_KEY = 'ryxa_bio_collapsed';

function getBioCollapsed() {
  try {
    return JSON.parse(localStorage.getItem(BIO_COLLAPSE_KEY)) || [];
  } catch { return []; }
}

function saveBioCollapsed(list) {
  try { localStorage.setItem(BIO_COLLAPSE_KEY, JSON.stringify(list)); } catch {}
}

function toggleBioSection(name) {
  const body = document.getElementById('bio-body-' + name);
  if (!body) return;
  const btn = body.previousElementSibling;
  // Use computed style instead of inline style. Bio sections currently
  // start expanded by default, but if any are ever hidden via a CSS class
  // (rather than inline body.style.display = 'none'), reading the inline
  // style would return '' on fresh load and the first toggle would be a
  // no-op. Same bug as toggleMKSection had. Defensive fix to keep both
  // tools robust.
  const isOpen = window.getComputedStyle(body).display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (btn) btn.setAttribute('aria-expanded', !isOpen);

  // Save to localStorage
  let collapsed = getBioCollapsed();
  if (isOpen) {
    if (!collapsed.includes(name)) collapsed.push(name);
  } else {
    collapsed = collapsed.filter(s => s !== name);
  }
  saveBioCollapsed(collapsed);
}

function restoreBioCollapsed() {
  const collapsed = getBioCollapsed();
  collapsed.forEach(name => {
    const body = document.getElementById('bio-body-' + name);
    if (!body) return;
    body.style.display = 'none';
    const btn = body.previousElementSibling;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

// =====================================================
// Mobile Preview Relocation
// Moves preview to sit right after Profile on narrow screens
// =====================================================
let bioPreviewRelocated = false;
let mkPreviewRelocated = false;

function relocatePreviewForMobile() {
  const isMobile = window.innerWidth <= 1100;

  // Bio preview
  const bioPreview = document.getElementById('bio-preview-col');
  const bioProfile = document.getElementById('bio-section-profile');
  const bioFormCol = bioProfile?.parentElement;
  if (bioPreview && bioProfile && bioFormCol) {
    if (isMobile && !bioPreviewRelocated) {
      // Insert preview right after Profile section
      bioProfile.insertAdjacentElement('afterend', bioPreview);
      bioPreview.style.position = 'static';
      bioPreviewRelocated = true;
    } else if (!isMobile && bioPreviewRelocated) {
      // Move back to grid as second column
      const bioGrid = bioFormCol.parentElement;
      if (bioGrid) {
        bioGrid.appendChild(bioPreview);
        bioPreview.style.position = 'sticky';
      }
      bioPreviewRelocated = false;
    }
  }

  // MK preview
  const mkPreview = document.getElementById('mk-preview-col');
  const mkProfile = document.getElementById('mk-section-profile');
  const mkFormCol = mkProfile?.parentElement;
  if (mkPreview && mkProfile && mkFormCol) {
    if (isMobile && !mkPreviewRelocated) {
      mkProfile.insertAdjacentElement('afterend', mkPreview);
      mkPreview.style.position = 'static';
      mkPreviewRelocated = true;
    } else if (!isMobile && mkPreviewRelocated) {
      const mkGrid = mkFormCol.parentElement;
      if (mkGrid) {
        mkGrid.appendChild(mkPreview);
        mkPreview.style.position = 'sticky';
      }
      mkPreviewRelocated = false;
    }
  }
}

// Run on load and resize
window.addEventListener('resize', relocatePreviewForMobile);
document.addEventListener('DOMContentLoaded', () => setTimeout(relocatePreviewForMobile, 100));

function initBioTool() {
  if (bioInited) {
    // Re-sync username from profiles in case it was changed in the Media Kit tool
    resyncBioUsername();
    // Reset username hint to default
    var bioHint = document.getElementById('bio-username-hint');
    if (bioHint) { bioHint.textContent = 'Same username as your Media Kit. You can change it up to 2 times per week.'; bioHint.style.color = 'var(--muted)'; }
    updateBioPreview();
    return;
  }
  bioInited = true;
  restoreBioCollapsed();
  renderBioThemes();
  renderBioFonts();
  renderBioSocials();
  renderBioLinks();
  loadBioData();
  loadBioVerification();
  document.getElementById('bio-avatar-inner').addEventListener('click', () => {
    document.getElementById('bio-avatar-input').click();
  });

  // Delegated click handler: clicking the header bar of an expanded link
  // row collapses it (with save). Lets users dismiss the editor without
  // hunting for the Save button. Inputs, buttons, and the drag handle
  // intercept their own clicks via stopPropagation in their markup.
  const linksList = document.getElementById('bio-links-list');
  if (linksList) {
    linksList.addEventListener('click', function(e) {
      // Find the closest .bio-link-header that we clicked inside
      const header = e.target.closest('.bio-link-header');
      if (!header) return;
      // Skip if click came from a button or input inside the header
      if (e.target.closest('button, input, .bio-link-drag, a')) return;
      // Find the row id from the parent .bio-link-row
      const row = header.closest('.bio-link-row');
      if (!row) return;
      const idAttr = row.getAttribute('data-id');
      const id = parseInt(idAttr, 10);
      if (!isFinite(id)) return;
      // Only collapse if this row is currently expanded (i.e., not a collapsed view header)
      if (!bioExpandedLinks.has(id)) return;
      // Use saveLinkRow — handles validation + save + collapse + preview update
      if (typeof saveLinkRow === 'function') saveLinkRow(id);
    });
  }
}

// Pulls the latest username from the Media Kit input (if present) or profiles table,
// then refreshes the publish UI. Called every time the Link in Bio tool is reopened.
async function resyncBioUsername() {
  const input = document.getElementById('bio-username');
  if (!input || !currentUser) return;
  // Priority 1: use the Media Kit input's current value (covers unsaved edits)
  const mkInput = document.getElementById('mk-username');
  if (mkInput && mkInput.value) {
    input.value = mkInput.value;
    bioState.username = mkInput.value;
    updatePublishUI();
    updateMediaKitLinkButton();
    return;
  }
  // Fallback: query profiles table
  try {
    const { data: profile } = await sb.from('profiles').select('username').eq('user_id', currentUser.id).maybeSingle();
    if (profile?.username) {
      input.value = profile.username;
      bioState.username = profile.username;
      bioOriginalUsername = profile.username;
    }
  } catch (e) { console.warn('resyncBioUsername', e); }
  updatePublishUI();
  updateMediaKitLinkButton();
  // Override browser autofill
  setTimeout(function() {
    var el = document.getElementById('bio-username');
    if (el && bioState.username && el.value !== bioState.username) {
      el.value = bioState.username;
      updatePublishUI();
    }
  }, 500);
}

// Resolve live cover/headshot URLs for bio links that reference a source
// table (courses, coaching services, digital products, media kit). Mirrors
// the public bio resolver in api/bio.js and bio.html — keeps the editor's
// link thumbnails AND the iframe preview in sync with current images.
// Mutates `links` in place; only overwrites photoUrl when a live value is
// found, falling back to the stored snapshot otherwise.
async function resolveBioLinkLiveCovers(creatorUserId, links, creatorUsername) {
  if (!Array.isArray(links) || links.length === 0) return;

  var courseIds = [];
  var coachingIds = [];
  var productIds = [];
  var needsMediaKit = false;

  for (var i = 0; i < links.length; i++) {
    var l = links[i];
    if (!l) continue;
    if (l.isCourse && l.courseId) courseIds.push(l.courseId);
    if (l.isCoaching && l.coachingId) coachingIds.push(l.coachingId);
    if (l.isProduct && l.productId) productIds.push(l.productId);
    if (l.isMediaKit) needsMediaKit = true;
  }

  function buildPublicUrl(bucket, path) {
    if (!path) return null;
    return 'https://kjytapcgxukalwsyputk.supabase.co/storage/v1/object/public/' + bucket + '/' + path;
  }

  var promises = [];

  if (courseIds.length > 0) {
    promises.push(
      sb.from('courses').select('id, title, price_cents, cover_image_path').in('id', courseIds)
        .then(function(r) {
          var rows = r.data || [];
          var map = {};
          rows.forEach(function(row) {
            map[row.id] = {
              title: row.title,
              price: row.price_cents,
              photo: buildPublicUrl('course-covers', row.cover_image_path),
            };
          });
          return { type: 'course', map: map };
        })
        .catch(function() { return { type: 'course', map: {} }; })
    );
  }

  if (coachingIds.length > 0) {
    promises.push(
      sb.from('coaching_services').select('id, title, price_cents, cover_image_path').in('id', coachingIds)
        .then(function(r) {
          var rows = r.data || [];
          var map = {};
          rows.forEach(function(row) {
            map[row.id] = {
              title: row.title,
              price: row.price_cents,
              photo: buildPublicUrl('coaching-covers', row.cover_image_path),
            };
          });
          return { type: 'coaching', map: map };
        })
        .catch(function() { return { type: 'coaching', map: {} }; })
    );
  }

  if (productIds.length > 0) {
    promises.push(
      sb.from('digital_products').select('id, title, price_cents, cover_image_url').in('id', productIds)
        .then(function(r) {
          var rows = r.data || [];
          var map = {};
          rows.forEach(function(row) {
            map[row.id] = {
              title: row.title,
              price: row.price_cents,
              photo: row.cover_image_url || null,
            };
          });
          return { type: 'product', map: map };
        })
        .catch(function() { return { type: 'product', map: {} }; })
    );
  }

  if (needsMediaKit && creatorUserId) {
    promises.push(
      sb.from('media_kit').select('headshot_url').eq('user_id', creatorUserId).maybeSingle()
        .then(function(r) {
          return { type: 'mediakit', url: r.data ? (r.data.headshot_url || null) : null };
        })
        .catch(function() { return { type: 'mediakit', url: null }; })
    );
  }

  if (promises.length === 0) return;

  // 1.5-second timeout. If any source-table query hangs, give up and let
  // the editor render with snapshot URLs. Better stale photo than hung page.
  var TIMEOUT_SENTINEL = {};
  var timeoutPromise = new Promise(function(resolve) {
    setTimeout(function() { resolve(TIMEOUT_SENTINEL); }, 1500);
  });
  var settled = await Promise.race([Promise.all(promises), timeoutPromise]);
  if (settled === TIMEOUT_SENTINEL) {
    console.warn('cover URL resolver timed out at 1.5s, using snapshots');
    return;
  }
  var results = settled;
  var courseMap = (results.find(function(r) { return r.type === 'course'; }) || {}).map;
  var coachingMap = (results.find(function(r) { return r.type === 'coaching'; }) || {}).map;
  var productMap = (results.find(function(r) { return r.type === 'product'; }) || {}).map;
  var mediaKitUrl = (results.find(function(r) { return r.type === 'mediakit'; }) || {}).url;

  for (var j = 0; j < links.length; j++) {
    var link = links[j];
    if (!link) continue;
    if (link.isCourse && link.courseId && courseMap) {
      var liveCourse = courseMap[link.courseId];
      if (liveCourse) {
        if (typeof liveCourse.title === 'string' && liveCourse.title.length > 0) link.title = liveCourse.title;
        if (typeof liveCourse.price === 'number') link.coursePrice = liveCourse.price;
        if (liveCourse.photo) link.photoUrl = liveCourse.photo;
      }
    } else if (link.isCoaching && link.coachingId && coachingMap) {
      var liveCoaching = coachingMap[link.coachingId];
      if (liveCoaching) {
        if (typeof liveCoaching.title === 'string' && liveCoaching.title.length > 0) link.title = liveCoaching.title;
        if (typeof liveCoaching.price === 'number') link.coachingPrice = liveCoaching.price;
        if (liveCoaching.photo) link.photoUrl = liveCoaching.photo;
      }
    } else if (link.isProduct && link.productId && productMap) {
      var liveProduct = productMap[link.productId];
      if (liveProduct) {
        if (typeof liveProduct.title === 'string' && liveProduct.title.length > 0) link.title = liveProduct.title;
        if (typeof liveProduct.price === 'number') link.productPrice = liveProduct.price;
        if (liveProduct.photo) link.photoUrl = liveProduct.photo;
      }
    } else if (link.isMediaKit) {
      if (mediaKitUrl) link.photoUrl = mediaKitUrl;
      // Rebuild URL from the live username so a creator-renamed bio link still
      // points at the right /mediakit/<username> page (the old username 404s).
      if (typeof creatorUsername === 'string' && creatorUsername.length > 0) {
        link.url = 'https://www.ryxa.io/mediakit/' + creatorUsername;
      }
    }
  }
}

async function loadBioData() {
  if (!currentUser) return;
  try {
    const { data: profile } = await sb.from('profiles').select('username').eq('user_id', currentUser.id).maybeSingle();
    if (profile?.username) {
      bioState.username = profile.username;
      bioOriginalUsername = profile.username;
      document.getElementById('bio-username').value = profile.username;
      // Override browser autofill which may fire after our set
      setTimeout(function() {
        var el = document.getElementById('bio-username');
        if (el && el.value !== bioState.username) el.value = bioState.username;
      }, 500);
      setTimeout(function() {
        var el = document.getElementById('bio-username');
        if (el && el.value !== bioState.username) el.value = bioState.username;
      }, 1500);
    }
    const { data: bio } = await sb.from('link_in_bio').select('*').eq('user_id', currentUser.id).maybeSingle();
    if (bio) {
      bioState.display_name = bio.display_name || '';
      bioState.bio = bio.bio || '';
      bioState.avatar_url = bio.avatar_url || '';
      bioState.avatar_display = bio.avatar_display || 'default';
      bioState.theme = bio.theme || 'purple';
      bioState.font_family = bio.font_family || 'DM Sans';
      bioState.socials = bio.socials || {};
      bioState.links = Array.isArray(bio.links) ? bio.links.map(l => ({ ...l, _id: linkIdSeq++ })) : [];
      // Old videos array is no longer used — YouTube embeds now live as
      // isVideoBlock entries inside bioState.links. Wipe any legacy data.
      bioState.videos = [];
      bioState.published = !!bio.published;
      bioState.show_branding = bio.show_branding !== false;
      bioState.sensitive_content = bio.sensitive_content === true;
      bioState.custom_theme = bio.custom_theme || null;
      // Guard: if user selected custom but is no longer Pro, revert to purple
      if (bioState.theme === 'custom' && !isPro()) {
        bioState.theme = 'purple';
      }

      // Resolve live cover URLs for course/coaching/product/mediakit links.
      // Bio links snapshot photoUrl at link-add time, so when the source
      // image is updated the bio still shows the old one. Fetch fresh URLs
      // from the canonical tables and overwrite. Same logic as the public
      // bio render path. Wrapped in try/catch so a slow lookup never blocks
      // the editor from loading.
      try {
        await resolveBioLinkLiveCovers(currentUser.id, bioState.links, bioState.username);
      } catch (e) {
        console.error('cover URL resolver failed in dashboard:', e);
      }
    }
  } catch (e) { console.error('loadBioData', e); }
  syncBioForm();
  // Reset username hint to default message
  var bioHint = document.getElementById('bio-username-hint');
  if (bioHint) { bioHint.textContent = 'Same username as your Media Kit. You can change it up to 2 times per week.'; bioHint.style.color = 'var(--muted)'; }
  renderBioThemes();
  renderBioFonts();
  syncBioCustomEditorUI();
  renderBioSocials();
  renderBioLinks();
  updatePublishUI();
  updateBioPreview();
  updateMediaKitLinkButton();
  updateSubscribeBtn();
}

function syncBioForm() {
  document.getElementById('bio-display-name').value = bioState.display_name;
  document.getElementById('bio-bio').value = bioState.bio;
  document.getElementById('bio-name-count').textContent = bioState.display_name.length;
  document.getElementById('bio-bio-count').textContent = bioState.bio.length;
  renderAvatarPreview();
  updateAvatarDisplayUI();
  renderBioThemes();
  renderBioFonts();
  // branding toggle — Free users: disabled/greyed + always checked; Pro users: interactive
  syncBrandingToggle();
  // sensitive content toggle — available to all tiers
  syncSensitiveToggle();
}

function syncBrandingToggle() {
  const pro = isPro();
  const cb = document.getElementById('bio-show-branding');
  const label = document.getElementById('bio-branding-label');
  const pill = document.getElementById('bio-branding-pro-pill');
  const hint = document.getElementById('bio-branding-hint');
  if (!cb) return;

  if (pro) {
    cb.disabled = false;
    cb.checked = bioState.show_branding;
    label.style.opacity = '1';
    label.style.cursor = 'pointer';
    if (pill) pill.style.display = 'none';
    if (hint) hint.textContent = "Uncheck to hide the \"Get your free link-in-bio\" footer on your public page.";
  } else {
    // Free: force checked on, disabled
    cb.checked = true;
    cb.disabled = true;
    label.style.opacity = '0.65';
    label.style.cursor = 'not-allowed';
    if (pill) pill.style.display = 'inline-flex';
    if (hint) hint.textContent = "The footer link helps other creators find Ryxa. Upgrade to Pro to remove it.";
    // Ensure state matches the forced-on checkbox
    bioState.show_branding = true;
  }
}

function onBrandingToggle() {
  const pro = isPro();
  if (!pro) {
    // Shouldn't be able to toggle, but force it back on if it somehow fires
    document.getElementById('bio-show-branding').checked = true;
    bioState.show_branding = true;
    return;
  }
  bioState.show_branding = document.getElementById('bio-show-branding').checked;
  schedulePreviewUpdate();
}

// Sensitive content toggle — available to all tiers, no gating.
function syncSensitiveToggle() {
  const cb = document.getElementById('bio-sensitive-content');
  if (!cb) return;
  cb.checked = !!bioState.sensitive_content;
}

function onSensitiveToggle() {
  const cb = document.getElementById('bio-sensitive-content');
  if (!cb) return;
  bioState.sensitive_content = cb.checked;
}

function renderAvatarPreview() {
  const inner = document.getElementById('bio-avatar-inner');
  const removeBtn = document.getElementById('bio-avatar-remove');
  if (bioState.avatar_url) {
    inner.innerHTML = `<img alt="Profile photo" src="${escapeHtml(bioState.avatar_url)}" class="bio-s-0c9434">`;
    removeBtn.style.display = 'inline-block';
  } else {
    const name = bioState.display_name || bioState.username || '?';
    inner.textContent = (name[0] || '?').toUpperCase();
    removeBtn.style.display = 'none';
  }
}

function onBioFieldChange() {
  bioState.display_name = document.getElementById('bio-display-name').value;
  const bioEl = document.getElementById('bio-bio');
  let bioVal = bioEl.value;
  // Keep to 3 lines WITHOUT deleting text: extra line breaks (e.g. from a
  // paste) fold into the third line as spaces instead of truncating content.
  const parts = bioVal.split('\n');
  if (parts.length > 3) {
    bioVal = parts.slice(0, 2).join('\n') + '\n' + parts.slice(2).join(' ');
    bioEl.value = bioVal;
  }
  bioState.bio = bioVal;
  document.getElementById('bio-name-count').textContent = bioState.display_name.length;
  document.getElementById('bio-bio-count').textContent = bioState.bio.length;
  if (!bioState.avatar_url) renderAvatarPreview(); // update fallback initial
  schedulePreviewUpdate();
}

// Username change rate limiting: 2 changes per 7 days
const USERNAME_CHANGE_LIMIT = 2;
const USERNAME_CHANGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function checkUsernameChangeLimit() {
  const { data: profile } = await sb.from('profiles').select('username_changes').eq('user_id', currentUser.id).maybeSingle();
  const changes = (profile?.username_changes || []).filter(ts => {
    return (Date.now() - new Date(ts).getTime()) < USERNAME_CHANGE_WINDOW_MS;
  });
  return { allowed: changes.length < USERNAME_CHANGE_LIMIT, remaining: USERNAME_CHANGE_LIMIT - changes.length, changes };
}

async function recordUsernameChange() {
  const { data: profile } = await sb.from('profiles').select('username_changes').eq('user_id', currentUser.id).maybeSingle();
  const now = new Date().toISOString();
  // Keep only changes within the window, then add the new one
  const changes = (profile?.username_changes || []).filter(ts => {
    return (Date.now() - new Date(ts).getTime()) < USERNAME_CHANGE_WINDOW_MS;
  });
  changes.push(now);
  await sb.from('profiles').update({ username_changes: changes }).eq('user_id', currentUser.id);
}

function formatNextChangeTime(changes) {
  // Find the oldest change in the window — that's the one that will expire first
  const sorted = changes.map(ts => new Date(ts).getTime()).sort((a, b) => a - b);
  const earliest = sorted[0];
  const availableAt = new Date(earliest + USERNAME_CHANGE_WINDOW_MS);
  const diff = availableAt - Date.now();
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  if (days <= 1) {
    const hours = Math.ceil(diff / (60 * 60 * 1000));
    return hours <= 1 ? 'in about an hour' : `in about ${hours} hours`;
  }
  return `in ${days} day${days > 1 ? 's' : ''}`;
}

function formatNextChangeDate(changes) {
  const sorted = changes.map(ts => new Date(ts).getTime()).sort((a, b) => a - b);
  const earliest = sorted[0];
  const availableAt = new Date(earliest + USERNAME_CHANGE_WINDOW_MS);
  return availableAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

let bioUsernameCheckTimer = null;
let bioUsernameCheckToken = 0; // handles out-of-order async responses

function onUsernameInput() {
  const raw = document.getElementById('bio-username').value;
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
  if (cleaned !== raw) document.getElementById('bio-username').value = cleaned;
  bioState.username = cleaned;
  // Keep the Media Kit input in sync if it's been initialized
  const mkInput = document.getElementById('mk-username');
  if (mkInput && mkInput.value !== cleaned) mkInput.value = cleaned;
  const hint = document.getElementById('bio-username-hint');

  // Cancel any pending availability check
  clearTimeout(bioUsernameCheckTimer);
  bioUsernameCheckToken++;

  if (!cleaned) {
    hint.textContent = 'Same username as your Media Kit. Changing it here updates both.';
    hint.style.color = 'var(--muted)';
  } else if (cleaned.length < 3) {
    hint.textContent = 'Too short, minimum 3 characters';
    hint.style.color = '#fca5a5';
  } else if (BIO_RESERVED.has(cleaned)) {
    hint.textContent = 'That username is reserved. Pick another.';
    hint.style.color = '#fca5a5';
  } else if (window.RyxaUsernameFilter && !window.RyxaUsernameFilter.isUsernameClean(cleaned)) {
    hint.textContent = 'That username is not allowed. Pick another.';
    hint.style.color = '#fca5a5';
  } else if (cleaned === bioOriginalUsername) {
    // User's own current username — no need to check
    renderUsernameAvailable(cleaned);
  } else {
    // Show "Checking..." state, then query Supabase after a 500ms pause
    hint.innerHTML = `<span class="bio-s-e3f916">Checking <strong>ryxa.io/${cleaned}</strong>…</span>`;
    hint.style.color = 'var(--muted)';
    const myToken = bioUsernameCheckToken;
    bioUsernameCheckTimer = setTimeout(() => checkUsernameAvailability(cleaned, myToken), 500);
  }
  // If the user's page is currently published, re-render the "Live at" text + View Live link
  if (bioState.published) updatePublishUI();
  schedulePreviewUpdate();
}

async function checkUsernameAvailability(username, token) {
  const hint = document.getElementById('bio-username-hint');
  try {
    const { data, error } = await sb
      .from('public_profiles')
      .select('user_id')
      .eq('username', username)
      .maybeSingle();
    // Ignore if the user kept typing after this request fired
    if (token !== bioUsernameCheckToken) return;
    if (error) {
      hint.innerHTML = `<span class="bio-s-e3f916">Couldn't check availability. Will verify on save.</span>`;
      return;
    }
    if (!data || data.user_id === currentUser?.id) {
      // Name is available — but check rate limit before showing green
      const { allowed, changes } = await checkUsernameChangeLimit();
      if (token !== bioUsernameCheckToken) return;
      if (!allowed) {
        const nextDate = formatNextChangeDate(changes);
        hint.innerHTML = `<span class="bio-s-dbc3a0">You've reached the max username changes. Try again on ${nextDate}.</span>`;
        // Revert input to current username so save still works for other changes
        document.getElementById('bio-username').value = bioOriginalUsername;
        bioState.username = bioOriginalUsername;
        const mkInput = document.getElementById('mk-username');
        if (mkInput) mkInput.value = bioOriginalUsername;
        return;
      }
      renderUsernameAvailable(username);
    } else {
      hint.innerHTML = `<span class="bio-s-dbc3a0">✕ <strong>${username}</strong> is already taken, try another.</span>`;
    }
  } catch (e) {
    if (token !== bioUsernameCheckToken) return;
    hint.innerHTML = `<span class="bio-s-e3f916">Couldn't check availability. Will verify on save.</span>`;
  }
}

function renderUsernameAvailable(cleaned) {
  const hint = document.getElementById('bio-username-hint');
  const fullUrl = `https://www.ryxa.io/${cleaned}`;
  const isChanged = cleaned !== bioOriginalUsername;
  hint.innerHTML = `
    <div class="bio-s-6b6f9f">
      <span class="bio-s-f4cfc5">✓</span>
      <span>Your page will be at <strong class="bio-s-313aee">ryxa.io/${cleaned}</strong></span>
      <button type="button" data-bio-action="copy-bio-link" data-bio-url="${fullUrl}"
        class="bio-s-8911f1">
        Copy link
      </button>
    </div>${isChanged ? '<div class="bio-s-19cf92">Press save to change username</div>' : ''}`;
  hint.style.color = 'var(--muted)';
}

async function copyBioLink(url, btn) {
  try {
    await navigator.clipboard.writeText(url);
    const original = btn.textContent;
    btn.textContent = 'Copied ✓';
    btn.style.background = 'rgba(74,222,128,0.15)';
    btn.style.borderColor = 'rgba(74,222,128,0.4)';
    btn.style.color = '#4ade80';
    setTimeout(() => {
      btn.textContent = original;
      btn.style.background = 'rgba(124,58,237,0.1)';
      btn.style.borderColor = 'rgba(124,58,237,0.3)';
      btn.style.color = '#c4b5fd';
    }, 1500);
  } catch (e) {
    // Fallback for browsers without clipboard API
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); btn.textContent = 'Copied ✓'; }
    catch { btn.textContent = 'Copy failed'; }
    document.body.removeChild(ta);
    setTimeout(() => { btn.textContent = 'Copy link'; }, 1500);
  }
}

// All themes — color presets are Free, image themes are Free, Custom is Pro
// Image themes use the same 4-color schema (bg, card, text, accent) as Custom,
// plus an `image` field pointing to the background image. Server-side rendering
// recognizes these by `key` and applies the right CSS.
const BIO_THEMES = [
  { key:'custom',     name:'Custom',     bg:'#07070f', bg2:'#161625', grad:'linear-gradient(135deg,#a78bfa,#e879f9)', pro:true },
  // ----- Image themes (free for all) -----
  { key:'paperwhite', name:'Cloud',    image:'/bgtemplates/1.webp', colors:{bg:'#FFFFFF',card:'#F5F5F8',text:'#1A1A2E',accent:'#6366F1'}, pro:false },
  { key:'ember',      name:'Onyx',     image:'/bgtemplates/2.webp', colors:{bg:'#1A1A1C',card:'#262628',text:'#F5F2ED',accent:'#F97316'}, pro:false },
  { key:'sapphire',   name:'Riviera',  image:'/bgtemplates/3.webp', colors:{bg:'#1E3A8A',card:'#172554',text:'#F5EFE0',accent:'#D4AF37'}, pro:false },
  { key:'blossom',    name:'Sakura',   image:'/bgtemplates/4.webp', colors:{bg:'#FCE7EB',card:'#F8D7DD',text:'#5C2E3D',accent:'#C9A961'}, pro:false },
  { key:'honey',      name:'Sunbeam',  image:'/bgtemplates/5.webp', colors:{bg:'#FCEFC0',card:'#F8E48E',text:'#5C3F17',accent:'#B45309'}, pro:false },
  // ----- Color themes (free) -----
  { key:'purple',   name:'Purple',   bg:'#07070f', bg2:'#161625', grad:'linear-gradient(135deg,#a78bfa,#e879f9)', pro:false },
  { key:'midnight', name:'Midnight', bg:'#050508', bg2:'#13131b', grad:'linear-gradient(135deg,#9ca3af,#e5e7eb)', pro:false },
  { key:'sunset',   name:'Sunset',   bg:'#120808', bg2:'#251414', grad:'linear-gradient(135deg,#fb923c,#f472b6)', pro:false },
  { key:'ocean',    name:'Ocean',    bg:'#040a14', bg2:'#111d33', grad:'linear-gradient(135deg,#22d3ee,#60a5fa)', pro:false },
  { key:'forest',   name:'Forest',   bg:'#040a06', bg2:'#11211a', grad:'linear-gradient(135deg,#34d399,#a7f3d0)', pro:false },
  { key:'rose',     name:'Rose',     bg:'#140710', bg2:'#2a1624', grad:'linear-gradient(135deg,#fb7185,#fda4af)', pro:false },
  { key:'amber',    name:'Amber',    bg:'#0f0a04', bg2:'#251b0e', grad:'linear-gradient(135deg,#fbbf24,#fde68a)', pro:false },
  { key:'crimson',  name:'Crimson',  bg:'#0f0405', bg2:'#260c10', grad:'linear-gradient(135deg,#ef4444,#fca5a5)', pro:false },
  { key:'electric', name:'Electric', bg:'#050814', bg2:'#111a38', grad:'linear-gradient(135deg,#60a5fa,#a5b4fc)', pro:false },
  { key:'mint',     name:'Mint',     bg:'#030e0c', bg2:'#102623', grad:'linear-gradient(135deg,#2dd4bf,#a7f3d0)', pro:false },
  { key:'violet',   name:'Violet',   bg:'#0c0418', bg2:'#220f37', grad:'linear-gradient(135deg,#c084fc,#e9d5ff)', pro:false },
  { key:'graphite', name:'Graphite', bg:'#0a0a0a', bg2:'#1e1e1e', grad:'linear-gradient(135deg,#d1d5db,#f3f4f6)', pro:false },
];

// =====================================================================
// BIO_FONTS — curated Google Fonts list available to all tiers (Free, Pro, Max).
// Used by Link in Bio AND Media Kit. Single source of truth.
//
// Each entry:
//   key:    Stable identifier saved to DB (matches Google Fonts family name).
//           When changing, update the migration backfill too.
//   name:   Label shown in the picker.
//   gfont:  Google Fonts family name as it appears in the URL parameter
//           (e.g. "Plus Jakarta Sans" -> "Plus+Jakarta+Sans").
//   weights: Comma-separated weights to load. Keep narrow to limit page weight.
//   stack:  CSS font-family value applied to the body. Includes safe fallbacks.
//   sample: Short string to render in the picker so users see the font.
//
// To add a font: append a new entry, list it on Google Fonts to confirm it's
// available, pick the weights you actually use (300/400/500/600/700/800), test
// in preview. No DB change required — font_family is plain TEXT.
// =====================================================================
const BIO_FONTS = [
  // Default first — most users will land here.
  { key:'DM Sans',             name:'Ryxa default (Syne + DM Sans)', gfont:'DM+Sans',             weights:'300;400;500;600;700', stack:"'DM Sans', sans-serif" },
  // The rest alphabetical.
  { key:'Abril Fatface',       name:'Abril Fatface',       gfont:'Abril+Fatface',       weights:'400', stack:"'Abril Fatface', serif" },
  { key:'Anton',               name:'Anton',               gfont:'Anton',               weights:'400', stack:"'Anton', sans-serif" },
  { key:'Archivo Black',       name:'Archivo Black',       gfont:'Archivo+Black',       weights:'400', stack:"'Archivo Black', sans-serif" },
  { key:'Bebas Neue',          name:'Bebas Neue',          gfont:'Bebas+Neue',          weights:'400', stack:"'Bebas Neue', sans-serif" },
  { key:'Bricolage Grotesque', name:'Bricolage Grotesque', gfont:'Bricolage+Grotesque', weights:'400;500;600;700;800', stack:"'Bricolage Grotesque', sans-serif" },
  { key:'Caveat',              name:'Caveat (handwritten)',gfont:'Caveat',              weights:'400;500;600;700', stack:"'Caveat', cursive" },
  { key:'Cormorant',           name:'Cormorant',           gfont:'Cormorant',           weights:'400;500;600;700', stack:"'Cormorant', serif" },
  { key:'Fraunces',            name:'Fraunces',            gfont:'Fraunces',            weights:'300;400;500;600;700', stack:"'Fraunces', serif" },
  { key:'Inter',               name:'Inter',               gfont:'Inter',               weights:'300;400;500;600;700', stack:"'Inter', sans-serif" },
  { key:'JetBrains Mono',      name:'JetBrains Mono',      gfont:'JetBrains+Mono',      weights:'300;400;500;600;700', stack:"'JetBrains Mono', monospace" },
  { key:'Lora',                name:'Lora',                gfont:'Lora',                weights:'400;500;600;700', stack:"'Lora', serif" },
  { key:'Monoton',             name:'Monoton (retro)',     gfont:'Monoton',             weights:'400', stack:"'Monoton', sans-serif" },
  { key:'Nunito',              name:'Nunito',              gfont:'Nunito',              weights:'300;400;600;700;800', stack:"'Nunito', sans-serif" },
  { key:'Outfit',              name:'Outfit',              gfont:'Outfit',              weights:'300;400;500;600;700;800', stack:"'Outfit', sans-serif" },
  { key:'Pacifico',            name:'Pacifico (script)',   gfont:'Pacifico',            weights:'400', stack:"'Pacifico', cursive" },
  { key:'Playfair Display',    name:'Playfair Display',    gfont:'Playfair+Display',    weights:'400;500;600;700;800', stack:"'Playfair Display', serif" },
  { key:'Plus Jakarta Sans',   name:'Plus Jakarta Sans',   gfont:'Plus+Jakarta+Sans',   weights:'300;400;500;600;700;800', stack:"'Plus Jakarta Sans', sans-serif" },
  { key:'Rubik Mono One',      name:'Rubik Mono One (Y2K)',gfont:'Rubik+Mono+One',      weights:'400', stack:"'Rubik Mono One', sans-serif" },
  { key:'Space Grotesk',       name:'Space Grotesk',       gfont:'Space+Grotesk',       weights:'300;400;500;600;700', stack:"'Space Grotesk', sans-serif" },
];

// Helper: Look up a font by key. Falls back to default ('DM Sans').
function getBioFont(key) {
  return BIO_FONTS.find(f => f.key === key) || BIO_FONTS[0];
}

// Helper: Build a Google Fonts <link> URL for a given font key.
// Always also loads Syne (used for headings throughout bio + media kit) so
// existing Syne-styled elements don't break when a different body font is picked.
// Used by the preview iframes in dashboard. Public pages have their own loader
// (see bio.html / mediakit.html / bio.js / mediakit.js).
function buildBioFontLink(fontKey) {
  const font = getBioFont(fontKey);
  // Always include Syne (existing heading font). Skip duplicate if user picked Syne (not in list, but defense).
  const families = [];
  families.push('Syne:wght@400;500;600;700;800');
  families.push(`${font.gfont}:wght@${font.weights}`);
  return `https://fonts.googleapis.com/css2?${families.map(f => 'family=' + f).join('&')}&display=swap`;
}

// Helper: build the same theme vars used by `custom` for any image theme.
// Returns the same shape as buildCustomThemeVars() so the rest of the code
// can treat builtin image themes identically to a Pro user's custom theme.
function buildImageThemeVars(themeKey) {
  const theme = BIO_THEMES.find(x => x.key === themeKey);
  if (!theme || !theme.colors) return null;
  const c = theme.colors;
  return {
    bg: c.bg,
    surface: c.card,
    surface2: c.card,
    text: c.text,
    muted: hexAlpha(c.text, 0.65),
    muted2: hexAlpha(c.text, 0.8),
    accent: c.accent,
    accent2: c.accent,
    glow: hexAlpha(c.accent, 0.3),
    border: hexAlpha(c.text, 0.1),
    avatarBorder: `linear-gradient(135deg, ${c.accent}, ${c.accent})`,
    bgUrl: theme.image,
    _customColors: c,
  };
}

// Returns true if this theme key is one of the builtin image themes
function isImageTheme(themeKey) {
  const theme = BIO_THEMES.find(x => x.key === themeKey);
  return !!(theme && theme.image && theme.colors);
}

// Default colors for custom theme
const CUSTOM_THEME_DEFAULTS = {
  bg:     '#07070f',  // page background
  card:   '#161625',  // card/surface background
  text:   '#ffffff',  // primary text
  accent: '#a78bfa',  // accent/button color
};

// Given the 4 user-picked colors, derive the full theme object
function deriveThemeFromCustom(colors) {
  const c = { ...CUSTOM_THEME_DEFAULTS, ...(colors || {}) };
  return {
    bg: c.bg,
    bg2: c.card,
    surface: c.card,
    surface2: c.card,
    border: hexAlpha(c.text, 0.1),
    muted: hexAlpha(c.text, 0.6),
    text: c.text,
    accent: c.accent,
    accent2: c.accent,
    grad: `linear-gradient(135deg, ${c.accent}, ${c.accent})`,
    _colors: c,
  };
}

function hexAlpha(hex, alpha) {
  // Convert #RRGGBB to rgba(r,g,b,a)
  const h = (hex || '#ffffff').replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Build the full theme var object used by preview/public pages from the 4 user-picked colors
function buildCustomThemeVars(customTheme) {
  const colors = customTheme?.colors || CUSTOM_THEME_DEFAULTS;
  const c = { ...CUSTOM_THEME_DEFAULTS, ...colors };
  return {
    bg: c.bg,
    surface: c.card,
    surface2: c.card,
    text: c.text,
    muted: hexAlpha(c.text, 0.65),
    muted2: hexAlpha(c.text, 0.8),
    accent: c.accent,
    accent2: c.accent,
    glow: hexAlpha(c.accent, 0.3),
    border: hexAlpha(c.text, 0.1),
    avatarBorder: `linear-gradient(135deg, ${c.accent}, ${c.accent})`,
    _customColors: c,
  };
}

function renderBioThemes() {
  const container = document.getElementById('bio-themes');
  if (!container) return;
  const pro = isPro();
  const max = isMax();
  container.innerHTML = BIO_THEMES.map(t => {
    // Free-locked OR Max-locked
    const locked = (t.pro && !pro) || (t.max && !max);
    const selected = bioState.theme === t.key ? 'selected' : '';
    const lockedClass = locked ? 'locked' : '';
    const lock = locked ? `<div class="bio-theme-lock" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>` : '';
    const maxBadge = t.max ? '<div class="bio-theme-max-badge">MAX</div>' : '';

    let swatch, btnBg, nameStyle = '';
    if (t.key === 'custom') {
      swatch = '<div class="bio-theme-swatch bio-s-74a83e" ></div>';
      btnBg = `linear-gradient(135deg,${t.bg},${t.bg2})`;
    } else if (t.image && t.colors) {
      // Image theme — show the bg image as both the swatch and button background.
      // Label gets a colored pill backdrop using the theme's bg color so it
      // stays readable against the busy image, with the theme's own text color.
      swatch = `<div class="bio-theme-swatch" data-bio-bg="url('${t.image}') center/cover" data-bio-border="1.5px solid rgba(0,0,0,0.4)" data-bio-shadow="0 1px 3px rgba(0,0,0,0.25)"></div>`;
      btnBg = `url('${t.image}') center/cover`;
      // Encode the multi-property nameStyle as multiple data-bio-* attrs that
      // will be applied via JS. CSP-safe; no inline style attribute.
      nameStyle = `data-bio-color="${t.colors.text}" data-bio-bg="${hexAlpha(t.colors.bg,0.85)}" data-bio-padding="2px 6px" data-bio-radius="6px" data-bio-display="inline-block"`;
    } else {
      swatch = `<div class="bio-theme-swatch" data-bio-bg="${t.grad}"></div>`;
      btnBg = `linear-gradient(135deg,${t.bg},${t.bg2})`;
      nameStyle = '';
    }

    return `<button type="button" class="bio-theme-btn ${selected} ${lockedClass}" data-theme="${t.key}" data-bio-action="pick-theme" data-bio-theme="${t.key}"
      data-bio-bg="${btnBg}">
      ${swatch}
      <div class="bio-theme-name" ${nameStyle}>${t.name}</div>
      ${maxBadge}
      ${lock}
    </button>`;
  }).join('');

  // Apply data-bio-* style attributes to their elements after rendering.
  // This replaces the inline style="..." attributes that strict CSP blocks.
  bioApplyDataStyles(container);

  // Show/hide custom editor panel based on selected theme + tier
  const editor = document.getElementById('bio-custom-editor');
  if (editor) editor.style.display = (bioState.theme === 'custom' && pro) ? 'block' : 'none';
}

function pickTheme(t) {
  const theme = BIO_THEMES.find(x => x.key === t);
  if (!theme) return;
  const pro = isPro();
  const max = isMax();
  if (theme.pro && !pro) {
    showProUpsell({
      feature: 'Custom Theme',
      description: 'Build a fully custom theme with your own colors, background image, and avatar style. Available on Pro and Creator Max.'
    });
    return;
  }
  if (theme.max && !max) {
    showBioStatus('error', 'Custom theme is a Creator Max feature. Upgrade to unlock full branding control.');
    setTimeout(() => { try { openSettingsModal(); } catch(e){} }, 200);
    return;
  }
  bioState.theme = t;
  // If picking custom for the first time, init state with defaults
  if (t === 'custom' && !bioState.custom_theme) {
    bioState.custom_theme = { bgUrl: '', bgOpacity: 0.4, colors: { ...CUSTOM_THEME_DEFAULTS }, applied: true };
  }
  renderBioThemes();
  syncBioCustomEditorUI();
  schedulePreviewUpdate();
}

// =====================================================================
// Font picker (bio) — dropdown that lists all fonts. When closed, the
// select itself shows the currently chosen font (matches what's saved).
// When opened, each <option> renders in its own font for browsing.
// Live preview iframe shows the actual page font in real time.
// =====================================================================
function renderBioFonts() {
  const select = document.getElementById('bio-font-select');
  if (!select) return;
  select.innerHTML = BIO_FONTS.map(f => {
    const sel = bioState.font_family === f.key ? ' selected' : '';
    // option font-family applied programmatically after innerHTML to keep CSP-strict
    return `<option value="${escapeHtml(f.key)}" data-bio-font-family="${f.stack}"${sel}>${escapeHtml(f.name)}</option>`;
  }).join('');
  // Apply the option font-family attributes programmatically (CSP-strict; can't use inline style)
  Array.from(select.options).forEach(opt => {
    const ff = opt.dataset.bioFontFamily;
    if (ff) opt.style.fontFamily = ff;
  });
  // Set the select element's own font-family so the resting state shows
  // the currently chosen font, not just the option label.
  const font = getBioFont(bioState.font_family);
  select.style.fontFamily = font.stack;
  // Lazily inject Google Fonts <link>s for each picker font into the dashboard <head>
  // so the option labels and the resting select render in the actual fonts.
  injectBioPickerFonts();
}

// One-time loader: inject all picker fonts into the parent dashboard so the
// option text and the resting select render in their real face. Only runs once
// per page load.
let _bioPickerFontsInjected = false;
function injectBioPickerFonts() {
  if (_bioPickerFontsInjected) return;
  _bioPickerFontsInjected = true;
  const families = BIO_FONTS.map(f => `family=${f.gfont}:wght@${f.weights}`).join('&');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  document.head.appendChild(link);
}

function pickBioFont(key) {
  const font = BIO_FONTS.find(f => f.key === key);
  if (!font) return;
  bioState.font_family = font.key;
  // Update the dropdown's own font-family so the resting state reflects the new pick
  const select = document.getElementById('bio-font-select');
  if (select) select.style.fontFamily = font.stack;
  schedulePreviewUpdate();
}

// Populate the custom editor inputs from bioState.custom_theme
function syncBioCustomEditorUI() {
  if (!bioState.custom_theme) return;
  const ct = bioState.custom_theme;
  const colors = ct.colors || CUSTOM_THEME_DEFAULTS;
  ['bg','card','text','accent'].forEach(k => {
    const input = document.getElementById(`bio-color-${k}`);
    const hex = document.getElementById(`bio-color-${k}-hex`);
    if (input) input.value = colors[k] || CUSTOM_THEME_DEFAULTS[k];
    if (hex) hex.textContent = (colors[k] || CUSTOM_THEME_DEFAULTS[k]).toLowerCase();
  });
  const bgThumb = document.getElementById('bio-custom-bg-thumb');
  const bgStatus = document.getElementById('bio-custom-bg-status');
  const bgRemove = document.getElementById('bio-custom-bg-remove');
  if (ct.bgUrl) {
    if (bgThumb) bgThumb.style.backgroundImage = `url("${ct.bgUrl}")`;
    if (bgStatus) bgStatus.textContent = 'Background uploaded';
    if (bgRemove) bgRemove.style.display = 'inline-block';
  } else {
    if (bgThumb) bgThumb.style.backgroundImage = '';
    if (bgStatus) bgStatus.textContent = 'No background uploaded';
    if (bgRemove) bgRemove.style.display = 'none';
  }
  const opIn = document.getElementById('bio-custom-bg-opacity');
  const opVal = document.getElementById('bio-custom-bg-opacity-val');
  const op = ct.bgOpacity != null ? ct.bgOpacity : 0.4;
  if (opIn) opIn.value = op;
  if (opVal) opVal.textContent = Math.round(op * 100) + '%';
}

function onBioColorChange(slot, value) {
  if (!bioState.custom_theme) bioState.custom_theme = { bgUrl: '', bgOpacity: 0.4, colors: { ...CUSTOM_THEME_DEFAULTS }, applied: true };
  if (!bioState.custom_theme.colors) bioState.custom_theme.colors = { ...CUSTOM_THEME_DEFAULTS };
  bioState.custom_theme.colors[slot] = value;
  const hex = document.getElementById(`bio-color-${slot}-hex`);
  if (hex) hex.textContent = value.toLowerCase();
  schedulePreviewUpdate();
}

function resetBioCustomColors() {
  if (!bioState.custom_theme) bioState.custom_theme = { bgUrl: '', bgOpacity: 0.4, colors: { ...CUSTOM_THEME_DEFAULTS }, applied: true };
  bioState.custom_theme.colors = { ...CUSTOM_THEME_DEFAULTS };
  syncBioCustomEditorUI();
  schedulePreviewUpdate();
}

function onBioCustomOpacityChange(val) {
  if (!bioState.custom_theme) return;
  bioState.custom_theme.bgOpacity = parseFloat(val);
  const opVal = document.getElementById('bio-custom-bg-opacity-val');
  if (opVal) opVal.textContent = Math.round(bioState.custom_theme.bgOpacity * 100) + '%';
  schedulePreviewUpdate();
}

// Compress image to very small WebP and upload to bio-backgrounds bucket
async function onBioCustomBgSelected(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  if (!isPro()) { showBioStatus('error', 'Custom background is a Pro feature.'); return; }
  if (!file.type.startsWith('image/')) { showBioStatus('error', 'Please upload an image file.'); return; }
  if (file.size > 25 * 1024 * 1024) { showBioStatus('error', 'Image is too large (25MB max).'); return; }

  const btnLabel = document.querySelector('.custom-bg-btn.primary');
  const origText = btnLabel ? btnLabel.firstChild.textContent : '';
  if (btnLabel) btnLabel.firstChild.textContent = 'Uploading...';

  try {
    // Compress to ~250KB WebP, max 1600x900
    const blob = await compressBgImage(file, 1600, 900, 250 * 1024);
    // Upload
    const fileName = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const path = `${currentUser.id}/${fileName}`;
    const { error: upErr } = await sb.storage.from('bio-backgrounds').upload(path, blob, {
      contentType: 'image/webp', upsert: false,
    });
    if (upErr) throw upErr;
    const { data: { publicUrl } } = sb.storage.from('bio-backgrounds').getPublicUrl(path);

    // Queue old bg for cleanup on save
    if (bioState.custom_theme?.bgUrl) bioStaleBgs.push(bioState.custom_theme.bgUrl);
    if (!bioState.custom_theme) bioState.custom_theme = { bgUrl: '', bgOpacity: 0.4, colors: { ...CUSTOM_THEME_DEFAULTS }, applied: true };
    bioState.custom_theme.bgUrl = publicUrl;
    syncBioCustomEditorUI();
    schedulePreviewUpdate();
    showBioStatus('success', 'Background uploaded. Remember to save.');
  } catch (e) {
    console.error(e);
    showBioStatus('error', `Upload failed: ${e.message || 'unknown'}`);
  } finally {
    if (btnLabel) btnLabel.firstChild.textContent = origText || 'Upload';
  }
}

function removeBioCustomBg() {
  if (!bioState.custom_theme) return;
  if (bioState.custom_theme.bgUrl) bioStaleBgs.push(bioState.custom_theme.bgUrl);
  bioState.custom_theme.bgUrl = '';
  syncBioCustomEditorUI();
  schedulePreviewUpdate();
}

// Shared image compressor — scales down and outputs WebP targeting a size
async function compressBgImage(file, maxW, maxH, targetBytes) {
  const imgUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read image'));
      i.src = imgUrl;
    });
    // Fit within box while preserving aspect
    let w = img.width, h = img.height;
    const scale = Math.min(maxW / w, maxH / h, 1);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    // Binary-search quality until under target size
    let q = 0.82, lo = 0.3, hi = 0.95;
    let blob = await new Promise(res => canvas.toBlob(res, 'image/webp', q));
    for (let i = 0; i < 6 && blob; i++) {
      if (blob.size > targetBytes) {
        hi = q; q = (lo + q) / 2;
      } else if (blob.size < targetBytes * 0.75) {
        lo = q; q = (q + hi) / 2;
      } else break;
      blob = await new Promise(res => canvas.toBlob(res, 'image/webp', q));
    }
    if (!blob) throw new Error('Could not compress image');
    return blob;
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

function renderBioSocials() {
  const container = document.getElementById('bio-socials-form');
  if (!container) return;
  container.innerHTML = BIO_SOCIAL_FIELDS.map(f => {
    const val = escapeHtml(bioState.socials[f.key] || '');
    // Handle-type fields show a fixed URL prefix so it's clear the user
    // only types their handle; url/email/phone fields are plain inputs.
    if (f.type === 'username' && f.urlBase) {
      return `
    <div class="bio-social-row">
      <div class="bio-social-icon">${f.svg}</div>
      <div class="bio-social-prefixwrap">
        <span class="bio-social-prefix">${escapeHtml(f.urlBase)}</span>
        <input type="text" aria-label="${f.label}" placeholder="${escapeHtml(f.placeholder)}"
          value="${val}"
          data-bio-action="social-change" data-bio-event="input" data-bio-social="${f.key}">
      </div>
    </div>`;
    }
    return `
    <div class="bio-social-row">
      <div class="bio-social-icon">${f.svg}</div>
      <input type="text" aria-label="${f.label}" placeholder="${f.label}: ${escapeHtml(f.placeholder)}"
        value="${val}"
        data-bio-action="social-change" data-bio-event="input" data-bio-social="${f.key}">
    </div>`;
  }).join('');
}

function onSocialChange(key, val) {
  let v = (val || '').trim();
  if (v) {
    const field = BIO_SOCIAL_FIELDS.find(f => f.key === key);
    // For handle-type fields: if the user pasted a full URL, reduce it to
    // just the handle. Also strip a leading @. This keeps stored values as
    // clean handles, and is tolerant of older data saved as full URLs.
    if (field && field.type === 'username') {
      // Strip protocol and any known domain path, keep the last path segment.
      v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
      if (v.indexOf('/') !== -1) {
        const parts = v.split('/').filter(Boolean);
        v = parts[parts.length - 1] || '';
      }
      v = v.replace(/^@/, '').replace(/[?#].*$/, '').trim();
    }
  }
  if (v) bioState.socials[key] = v;
  else delete bioState.socials[key];
  schedulePreviewUpdate();
}

// ====== LINKS ======
function bioLimits() {
  const pro = isPro();
  const max = isMax();
  return {
    maxLinks: max ? 1000 : (pro ? 1000 : 100),
    maxFeatured: max ? 10 : (pro ? 3 : 1),
    maxHero: max ? 1 : 0,
    maxVideos: pro ? 20 : 5,
    pro: pro,
    isMax: max,
  };
}

function addHeader() {
  // Headers are unlimited but capped at 10 to prevent abuse
  const headerCount = bioState.links.filter(l => l.isHeader).length;
  if (headerCount >= 10) {
    showBioStatus('error', 'Header limit reached (10).');
    return;
  }
  const newId = linkIdSeq++;
  bioState.links.push({
    _id: newId,
    title: '',
    isHeader: true,
  });
  bioExpandedLinks.add(newId);
  renderBioLinks();
  schedulePreviewUpdate();
}

function addLink(isFeatured, isHero) {
  const { maxLinks, maxFeatured, maxHero } = bioLimits();
  const regularCount = bioState.links.filter(l => !l.featured && !l.isHero).length;
  const featuredCount = bioState.links.filter(l => l.featured).length;
  const heroCount = bioState.links.filter(l => l.isHero).length;

  if (isHero) {
    if (!isMax()) {
      showBioStatus('error', 'Hero links are a Creator Max feature.');
      setTimeout(() => { try { openSettingsModal(); } catch(e){} }, 200);
      return;
    }
    if (heroCount >= maxHero) {
      showBioStatus('error', `Hero link limit reached (${maxHero}).`);
      return;
    }
  } else if (isFeatured) {
    if (featuredCount >= maxFeatured) {
      showBioStatus('error', `Featured link limit reached (${maxFeatured}). ${!isPro() ? 'Upgrade to Pro for 3.' : ''}`);
      return;
    }
  } else {
    if (regularCount >= maxLinks) {
      showBioStatus('error', `Link limit reached (${maxLinks}). ${!isPro() ? 'Upgrade to Pro for 200.' : ''}`);
      return;
    }
  }
  const newId = linkIdSeq++;
  bioState.links.push({
    _id: newId,
    title: '',
    description: '',
    url: '',
    featured: !!isFeatured,
    isHero: !!isHero,
    photoUrl: '',
  });
  bioExpandedLinks.add(newId);
  renderBioLinks();
  schedulePreviewUpdate();
}

// If user has a published Media Kit, add a pre-filled link to it
function addSubscribeBlock() {
  if (bioState.links.some(l => l.isSubscribe)) return;
  bioState.links.push({
    _id: linkIdSeq++,
    isSubscribe: true,
    title: 'Subscribe to my newsletter',
    url: ''
  });
  updateSubscribeBtn();
  renderBioLinks();
  schedulePreviewUpdate();
  showBioStatus('saved', 'Subscribe block added');
}

function updateSubscribeBtn() {
  var btn = document.getElementById('bio-add-subscribe-btn');
  if (!btn) return;
  var hasSubscribe = bioState.links.some(l => l.isSubscribe);
  btn.disabled = hasSubscribe;
  btn.style.opacity = hasSubscribe ? '0.4' : '1';
  btn.style.cursor = hasSubscribe ? 'default' : 'pointer';
}

// ---- Video Block (YouTube carousel inside the link list) ----
// Each block holds up to 10 YouTube URLs. One block per page on all plans;
// the add button is disabled while a block exists. The block count is also
// constrained naturally by maxLinks.
function addVideoBlock() {
  const { maxLinks } = bioLimits();
  const totalLinkCount = bioState.links.length;
  if (totalLinkCount >= maxLinks) {
    showBioStatus('error', `Link limit reached (${maxLinks}).`);
    return;
  }
  // One YouTube block per page (all plans). The add button is disabled when
  // one exists; this guard is the backstop.
  if (bioState.links.some(l => l.isVideoBlock)) return;
  const newId = linkIdSeq++;
  bioState.links.push({
    _id: newId,
    isVideoBlock: true,
    videos: [{ url: '' }]  // start with one empty input
  });
  bioExpandedLinks.add(newId);
  renderBioLinks();
  schedulePreviewUpdate();
  showBioStatus('saved', 'YouTube block added');
}

// TikTok block — parallel to the YouTube block. Same gating (one per page,
// all plans) and the same videos[] shape, so it reuses the shared video-array
// helpers (update/add/remove) below.
function addTikTokBlock() {
  const { maxLinks } = bioLimits();
  const totalLinkCount = bioState.links.length;
  if (totalLinkCount >= maxLinks) {
    showBioStatus('error', `Link limit reached (${maxLinks}).`);
    return;
  }
  // One TikTok block per page (all plans). The add button is disabled when
  // one exists; this guard is the backstop.
  if (bioState.links.some(l => l.isTikTokBlock)) return;
  const newId = linkIdSeq++;
  bioState.links.push({
    _id: newId,
    isTikTokBlock: true,
    videos: [{ url: '' }]
  });
  bioExpandedLinks.add(newId);
  renderBioLinks();
  schedulePreviewUpdate();
  showBioStatus('saved', 'TikTok block added');
}

// Instagram Reels block — parallel to the TikTok block, same gating and the
// same videos[] shape, so it reuses the shared video-array helpers below.
function addInstagramBlock() {
  const { maxLinks } = bioLimits();
  const totalLinkCount = bioState.links.length;
  if (totalLinkCount >= maxLinks) {
    showBioStatus('error', `Link limit reached (${maxLinks}).`);
    return;
  }
  // One Instagram block per page (all plans). The add button is disabled when
  // one exists; this guard is the backstop.
  if (bioState.links.some(l => l.isInstagramBlock)) return;
  const newId = linkIdSeq++;
  bioState.links.push({
    _id: newId,
    isInstagramBlock: true,
    videos: [{ url: '' }]
  });
  bioExpandedLinks.add(newId);
  renderBioLinks();
  schedulePreviewUpdate();
  showBioStatus('saved', 'Instagram block added');
}

// Spotify embed — a single track/album/playlist/artist/episode/show. Unlike
// the video blocks it's one URL, not a list. One per page (all plans); the
// modal item is disabled when one exists, this guard is the backstop.
function addSpotifyBlock() {
  const { maxLinks } = bioLimits();
  if (bioState.links.length >= maxLinks) {
    showBioStatus('error', `Link limit reached (${maxLinks}).`);
    return;
  }
  if (bioState.links.some(l => l.isSpotifyBlock)) return;
  const newId = linkIdSeq++;
  bioState.links.push({
    _id: newId,
    isSpotifyBlock: true,
    url: ''
  });
  bioExpandedLinks.add(newId);
  renderBioLinks();
  schedulePreviewUpdate();
  showBioStatus('saved', 'Spotify added');
}

// "More" modal — houses widgets beyond the core add row, grouped by category.
// Items inside use data-bio-action like everything else; opening refreshes any
// per-item disabled state (e.g. Spotify is one-per-page).
function openBioMoreModal() {
  const modal = document.getElementById('bio-more-modal');
  if (!modal) return;
  const spotifyItem = document.getElementById('bio-more-spotify');
  if (spotifyItem) {
    const used = bioState.links.some(l => l.isSpotifyBlock);
    spotifyItem.disabled = used;
    spotifyItem.classList.toggle('is-used', used);
  }
  modal.classList.add('is-open');
}
function closeBioMoreModal() {
  const modal = document.getElementById('bio-more-modal');
  if (modal) modal.classList.remove('is-open');
}

// Update the URL of a video at a given index inside a video block link.
function updateVideoBlockUrl(linkId, idx, url) {
  const link = bioState.links.find(l => l._id === linkId);
  if (!link || !(link.isVideoBlock || link.isTikTokBlock || link.isInstagramBlock) || !Array.isArray(link.videos)) return;
  if (idx < 0 || idx >= link.videos.length) return;
  link.videos[idx].url = url;
  schedulePreviewUpdate();
}

// Add another empty URL slot to a video block (max 10).
function addVideoToBlock(linkId) {
  const link = bioState.links.find(l => l._id === linkId);
  if (!link || !(link.isVideoBlock || link.isTikTokBlock || link.isInstagramBlock)) return;
  if (!Array.isArray(link.videos)) link.videos = [];
  if (link.videos.length >= 10) return;
  link.videos.push({ url: '' });
  renderBioLinks();
  schedulePreviewUpdate();
}

// Remove a single video URL from a video block. If it was the last one, leave
// one empty slot so the block stays editable (creator can also delete the
// whole block via the row's Remove button).
function removeVideoFromBlock(linkId, idx) {
  const link = bioState.links.find(l => l._id === linkId);
  if (!link || !(link.isVideoBlock || link.isTikTokBlock || link.isInstagramBlock) || !Array.isArray(link.videos)) return;
  link.videos.splice(idx, 1);
  if (link.videos.length === 0) link.videos.push({ url: '' });
  renderBioLinks();
  schedulePreviewUpdate();
}

async function addMediaKitLink() {
  if (!isPro()) {
    showBioStatus('error', 'Media Kit is a Pro feature.');
    return;
  }
  if (!currentUser) return;
  // Already added? ignore (button should be disabled but defensive check)
  if (bioState.links.some(l => l.isMediaKit)) return;

  const { maxLinks } = bioLimits();
  const regularCount = bioState.links.filter(l => !l.featured).length;
  if (regularCount >= maxLinks) {
    showBioStatus('error', `Link limit reached (${maxLinks}).`);
    return;
  }

  // Get username (prefer Link in Bio's input, fallback to profile)
  let uname = document.getElementById('bio-username').value.trim();
  if (!uname) {
    try {
      const { data: profile } = await sb.from('profiles').select('username').eq('user_id', currentUser.id).maybeSingle();
      uname = profile?.username || '';
    } catch (e) {}
  }
  if (!uname) {
    showBioStatus('error', 'Set your username first.');
    return;
  }

  // Check if media kit is published + get headshot
  let headshotUrl = '';
  try {
    const { data: kit } = await sb.from('media_kit').select('published, headshot_url').eq('user_id', currentUser.id).maybeSingle();
    if (!kit || !kit.published) {
      showBioStatus('error', 'Publish your Media Kit first.');
      return;
    }
    headshotUrl = kit.headshot_url || '';
  } catch (e) {
    showBioStatus('error', 'Could not check Media Kit. Try again.');
    return;
  }

  // Don't add duplicate
  const mediaKitUrl = `https://www.ryxa.io/mediakit/${uname}`;
  const existing = bioState.links.find(l => l.isMediaKit);
  if (existing) {
    showBioStatus('error', 'Media Kit link already added.');
    return;
  }

  const newId = linkIdSeq++;
  bioState.links.push({
    _id: newId,
    title: 'My Media Kit',
    description: 'Audience stats, rate card, contact info',
    url: mediaKitUrl,
    featured: false,
    photoUrl: headshotUrl,
    isMediaKit: true,
  });
  renderBioLinks();
  schedulePreviewUpdate();
  updateMediaKitLinkButton();
  showBioStatus('success', 'Media Kit link added, remember to save.');
}

// Toggle Media Kit link button visibility based on tier + media kit status
async function updateMediaKitLinkButton() {
  const btn = document.getElementById('bio-add-mediakit-link');
  if (!btn) return;
  const pro = isPro();
  if (!pro || !currentUser) {
    btn.style.display = 'none';
    return;
  }
  // Check published status first — if no MK, hide entirely
  let published = false;
  try {
    const { data: kit } = await sb.from('media_kit').select('published').eq('user_id', currentUser.id).maybeSingle();
    published = !!(kit && kit.published);
  } catch (e) {
    btn.style.display = 'none';
    return;
  }
  if (!published) {
    btn.style.display = 'none';
    return;
  }
  // Pro + published MK: always show. Grey out if already added.
  btn.style.display = 'flex';
  const alreadyAdded = bioState.links.some(l => l.isMediaKit);
  if (alreadyAdded) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    btn.setAttribute('aria-disabled', 'true');
    // Update text to show status
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> Media Kit link added';
  } else {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor = 'pointer';
    btn.removeAttribute('aria-disabled');
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="17" x2="8" y2="13"/><line x1="12" y1="17" x2="12" y2="11"/><line x1="16" y1="17" x2="16" y2="15"/></svg> Add Media Kit';
  }
}

// Course picker modal for adding course links to bio
async function openCoursePickerModal() {
  if (!isMax()) {
    showBioStatus('error', 'Course links are a Creator Max feature.');
    return;
  }
  if (!currentUser) return;

  // Load published courses
  const { data: courses } = await sb.from('courses').select('id, title, slug, price_cents, cover_image_path').eq('user_id', currentUser.id).eq('status', 'published').order('created_at', { ascending: false });

  if (!courses || courses.length === 0) {
    showModalAlert('No courses yet', 'You need to create and publish a course before you can add it to your bio. Head to the Course Builder tool to get started.');
    return;
  }

  // Check which courses are already added
  const addedCourseIds = bioState.links.filter(l => l.isCourse).map(l => l.courseId);

  let modalHtml = '<div class="bio-s-9998de">Add Course to Bio</div>';
  modalHtml += '<div class="bio-s-b32a60">';

  courses.forEach(function(c) {
    const isAdded = addedCourseIds.indexOf(c.id) !== -1;
    const coverUrl = c.cover_image_path ? sb.storage.from('course-covers').getPublicUrl(c.cover_image_path).data.publicUrl : '';
    const coverHtml = coverUrl
      ? '<img src="' + escapeHtml(coverUrl) + '" alt="Course thumbnail" class="bio-s-f28e64">'
      : '<div class="bio-s-fd8ea7"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>';
    const priceText = c.price_cents > 0 ? formatMoney(c.price_cents, {alwaysShowCents:true}) : 'Free';

    modalHtml += '<div class="bio-s-dd07a9">'
      + coverHtml
      + '<div class="bio-s-a07604">'
      + '<div class="bio-s-3fe262">' + escapeHtml(c.title) + '</div>'
      + '<div class="bio-s-e769ff">' + priceText + '</div>'
      + '</div>';

    if (isAdded) {
      modalHtml += '<span class="bio-s-da6517">Added</span>';
    } else {
      // Stash all course params on data-bio-* attributes; handler reads them on click.
      // escapeHtml ensures titles with quotes / HTML special chars don't break the attribute.
      modalHtml += '<button data-bio-action="add-course-to-links"'
        + ' data-bio-course-id="' + escapeHtml(c.id) + '"'
        + ' data-bio-title="' + escapeHtml(c.title) + '"'
        + ' data-bio-price="' + c.price_cents + '"'
        + ' data-bio-slug="' + escapeHtml(c.slug) + '"'
        + ' data-bio-cover="' + escapeHtml(coverUrl) + '"'
        + ' class="bio-s-a788c4">Add</button>';
    }

    modalHtml += '</div>';
  });

  modalHtml += '</div>';
  modalHtml += '<button data-bio-action="close-course-picker" class="bio-s-6b029c">Close</button>';

  // Show modal
  let overlay = document.getElementById('course-picker-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'course-picker-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
    overlay.onclick = function(e) { if (e.target === overlay) closeCoursePickerModal(); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = '<div class="bio-s-78ed66">' + modalHtml + '</div>';
  overlay.style.display = 'flex';
}

function closeCoursePickerModal() {
  const overlay = document.getElementById('course-picker-overlay');
  if (overlay) overlay.style.display = 'none';
}

function addCourseToLinks(courseId, title, priceCents, slug, coverUrl) {
  // Check not already added
  if (bioState.links.some(l => l.isCourse && l.courseId === courseId)) {
    showBioStatus('error', 'This course is already in your links.');
    return;
  }

  const newId = linkIdSeq++;
  const priceDisplay = priceCents > 0 ? formatMoney(priceCents, {alwaysShowCents:true}) : 'Free';
  bioState.links.push({
    _id: newId,
    title: title,
    description: priceDisplay,
    url: 'https://www.ryxa.io/course/' + slug,
    featured: false,
    photoUrl: coverUrl || '',
    isCourse: true,
    courseId: courseId,
    coursePrice: priceCents,
    courseCrossoutPrice: 0,
  });
  bioExpandedLinks.add(newId);
  renderBioLinks();
  schedulePreviewUpdate();
  closeCoursePickerModal();
  showBioStatus('success', 'Course added to your links. Remember to save.');
}

async function openCoachingPickerModal() {
  if (!isMax()) {
    handleMaxUpgradeClick(event);
    return;
  }
  if (!currentUser) return;

  const { data: services } = await sb.from('coaching_services').select('id, title, slug, price_cents, cover_image_path, duration_minutes').eq('user_id', currentUser.id).eq('status', 'published').order('created_at', { ascending: false });

  if (!services || services.length === 0) {
    showModalAlert('No bookings yet', 'You need to create and publish a 1:1 booking before you can add it to your bio. Head to the 1:1 Booking tool to get started.');
    return;
  }

  const addedIds = bioState.links.filter(l => l.isCoaching).map(l => l.coachingId);

  let modalHtml = '<div class="bio-s-9998de">Add Booking to Bio</div>';
  modalHtml += '<div class="bio-s-b32a60">';

  services.forEach(function(c) {
    const isAdded = addedIds.indexOf(c.id) !== -1;
    const coverUrl = c.cover_image_path ? sb.storage.from('coaching-covers').getPublicUrl(c.cover_image_path).data.publicUrl : '';
    const coverHtml = coverUrl
      ? '<img src="' + escapeHtml(coverUrl) + '" alt="Booking thumbnail" class="bio-s-f28e64">'
      : '<div class="bio-s-fd8ea7"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>';
    const priceText = c.price_cents > 0 ? formatMoney(c.price_cents, {alwaysShowCents:true}) : 'Free';

    modalHtml += '<div class="bio-s-dd07a9">'
      + coverHtml
      + '<div class="bio-s-a07604">'
      + '<div class="bio-s-3fe262">' + escapeHtml(c.title) + '</div>'
      + '<div class="bio-s-e769ff">' + priceText + '</div>'
      + '</div>';

    if (isAdded) {
      modalHtml += '<span class="bio-s-da6517">Added</span>';
    } else {
      modalHtml += '<button data-bio-action="add-coaching-to-links"'
        + ' data-bio-coaching-id="' + escapeHtml(c.id) + '"'
        + ' data-bio-title="' + escapeHtml(c.title) + '"'
        + ' data-bio-price="' + c.price_cents + '"'
        + ' data-bio-slug="' + escapeHtml(c.slug) + '"'
        + ' data-bio-cover="' + escapeHtml(coverUrl) + '"'
        + ' class="bio-s-a788c4">Add</button>';
    }

    modalHtml += '</div>';
  });

  modalHtml += '</div>';
  modalHtml += '<button data-bio-action="close-coaching-picker" class="bio-s-6b029c">Close</button>';

  let overlay = document.getElementById('coaching-picker-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'coaching-picker-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
    overlay.onclick = function(e) { if (e.target === overlay) closeCoachingPickerModal(); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = '<div class="bio-s-78ed66">' + modalHtml + '</div>';
  overlay.style.display = 'flex';
}

function closeCoachingPickerModal() {
  const overlay = document.getElementById('coaching-picker-overlay');
  if (overlay) overlay.style.display = 'none';
}

function addCoachingToLinks(coachingId, title, priceCents, slug, coverUrl) {
  if (bioState.links.some(l => l.isCoaching && l.coachingId === coachingId)) {
    showBioStatus('error', 'This booking is already in your links.');
    return;
  }

  const newId = linkIdSeq++;
  const priceDisplay = priceCents > 0 ? formatMoney(priceCents, {alwaysShowCents:true}) : 'Free';
  bioState.links.push({
    _id: newId,
    title: title,
    description: priceDisplay,
    url: 'https://www.ryxa.io/booking/' + slug,
    featured: false,
    photoUrl: coverUrl || '',
    isCoaching: true,
    coachingId: coachingId,
    coachingPrice: priceCents,
  });
  bioExpandedLinks.add(newId);
  renderBioLinks();
  schedulePreviewUpdate();
  closeCoachingPickerModal();
  showBioStatus('success', 'Booking added to your links. Remember to save.');
}

async function openProductPickerModal() {
  if (!isMax()) {
    handleMaxUpgradeClick(event);
    return;
  }
  if (!currentUser) return;

  // Load active digital products
  const { data: products } = await sb.from('digital_products').select('id, title, slug, price_cents, cover_image_url').eq('user_id', currentUser.id).eq('is_active', true).order('updated_at', { ascending: false });

  if (!products || products.length === 0) {
    showModalAlert('No digital products yet', 'You need to create and publish a digital product before you can add it to your bio. Head to the Digital Products tool to get started.');
    return;
  }

  const addedProductIds = bioState.links.filter(l => l.isProduct).map(l => l.productId);

  let modalHtml = '<div class="bio-s-9998de">Add Digital Product to Bio</div>';
  modalHtml += '<div class="bio-s-b32a60">';

  products.forEach(function(p) {
    const isAdded = addedProductIds.indexOf(p.id) !== -1;
    const coverUrl = p.cover_image_url || '';
    const coverHtml = coverUrl
      ? '<img src="' + escapeHtml(coverUrl) + '" alt="Product thumbnail" class="bio-s-f28e64">'
      : '<div class="bio-s-fd8ea7"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>';
    const priceText = p.price_cents > 0 ? formatMoney(p.price_cents, {alwaysShowCents:true}) : 'Free';

    modalHtml += '<div class="bio-s-dd07a9">'
      + coverHtml
      + '<div class="bio-s-a07604">'
      + '<div class="bio-s-3fe262">' + escapeHtml(p.title) + '</div>'
      + '<div class="bio-s-e769ff">' + priceText + '</div>'
      + '</div>';

    if (isAdded) {
      modalHtml += '<span class="bio-s-da6517">Added</span>';
    } else {
      modalHtml += '<button data-bio-action="add-product-to-links"'
        + ' data-bio-product-id="' + escapeHtml(p.id) + '"'
        + ' data-bio-title="' + escapeHtml(p.title) + '"'
        + ' data-bio-price="' + p.price_cents + '"'
        + ' data-bio-slug="' + escapeHtml(p.slug) + '"'
        + ' data-bio-cover="' + escapeHtml(coverUrl) + '"'
        + ' class="bio-s-a788c4">Add</button>';
    }

    modalHtml += '</div>';
  });

  modalHtml += '</div>';
  modalHtml += '<button data-bio-action="close-product-picker" class="bio-s-6b029c">Close</button>';

  let overlay = document.getElementById('product-picker-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'product-picker-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
    overlay.onclick = function(e) { if (e.target === overlay) closeProductPickerModal(); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = '<div class="bio-s-78ed66">' + modalHtml + '</div>';
  overlay.style.display = 'flex';
}

function closeProductPickerModal() {
  const overlay = document.getElementById('product-picker-overlay');
  if (overlay) overlay.style.display = 'none';
}

function addProductToLinks(productId, title, priceCents, slug, coverUrl) {
  if (bioState.links.some(l => l.isProduct && l.productId === productId)) {
    showBioStatus('error', 'This product is already in your links.');
    return;
  }

  const newId = linkIdSeq++;
  const priceDisplay = priceCents > 0 ? formatMoney(priceCents, {alwaysShowCents:true}) : 'Free';
  bioState.links.push({
    _id: newId,
    title: title,
    description: priceDisplay,
    url: 'https://www.ryxa.io/product/' + slug,
    featured: false,
    photoUrl: coverUrl || '',
    isProduct: true,
    productId: productId,
    productPrice: priceCents,
  });
  bioExpandedLinks.add(newId);
  renderBioLinks();
  schedulePreviewUpdate();
  closeProductPickerModal();
  showBioStatus('success', 'Digital product added to your links. Remember to save.');
}

function removeLink(id) {
  const link = bioState.links.find(l => l._id === id);
  if (link?.photoUrl) {
    bioStalePhotos.push(link.photoUrl);
  }
  bioState.links = bioState.links.filter(l => l._id !== id);
  renderBioLinks();
  schedulePreviewUpdate();
  updateMediaKitLinkButton();
  updateSubscribeBtn();
}

function updateLinkField(id, field, val) {
  const link = bioState.links.find(l => l._id === id);
  if (!link) return;
  link[field] = val;
  schedulePreviewUpdate();
}

// Toggle half-width on a link. Re-renders the editor and the live preview.
function toggleLinkHalfWidth(id, checked) {
  const link = bioState.links.find(l => l._id === id);
  if (!link) return;
  if (checked) link.halfWidth = true;
  else delete link.halfWidth;
  // Re-render so the badge in the row header updates immediately
  renderBioLinks();
  schedulePreviewUpdate();
}

// Small "½" indicator for the collapsed link row when half-width is enabled.
// Renders as a tiny inline tag at the row's right edge — not a chunky pill.
// Skipped entirely on row types that don't support half-width (Media Kit,
// Hero, Header, Subscribe, Featured, Videos) to prevent stale flags from
// rendering UI for a feature their expanded view doesn't expose.
function bioHalfBadge(link) {
  if (!link.halfWidth) return '';
  if (link.isMediaKit || link.isHero || link.isHeader || link.isSubscribe ||
      link.isVideoBlock || link.isTikTokBlock || link.isInstagramBlock || link.isSpotifyBlock || link.featured) {
    return '';
  }
  return '<span class="bio-row-half" title="Half width" aria-label="Half width">&frac12;</span>';
}

// Resolve the type metadata for a link row. Single source of truth for the
// type label and the icon SVG used in the collapsed view.
//
// All icons are stroke-based, monochrome, ~14px, matching the rest of the
// dashboard's icon language. The row's left-border accent is a single
// brand color (var(--accent2)) applied uniformly across all types — it's
// decorative, not a type signal. Type is conveyed through the icon + title.
function bioRowTypeMeta(link) {
  // Order matters — first match wins. Featured is a flag that can apply to
  // a regular link, so it's checked late.
  if (link.isHeader) {
    return {
      key: 'header',
      label: 'Header',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="18" x2="14" y2="18"/></svg>'
    };
  }
  if (link.isVideoBlock) {
    return {
      key: 'video',
      label: 'Videos',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'
    };
  }
  if (link.isTikTokBlock) {
    return {
      key: 'tiktok',
      label: 'TikTok',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>'
    };
  }
  if (link.isInstagramBlock) {
    const ig = 'igrow-' + String(link._id).replace(/[^a-zA-Z0-9_-]/g, '');
    return {
      key: 'instagram',
      label: 'Instagram',
      icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${ig}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".25" stop-color="#FA7E1E"/><stop offset=".5" stop-color="#D62976"/><stop offset=".75" stop-color="#962FBF"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="6" fill="url(#${ig})"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" stroke-width="2"/><circle cx="17.4" cy="6.6" r="1.3" fill="#fff"/></svg>`
    };
  }
  if (link.isSpotifyBlock) {
    return {
      key: 'spotify',
      label: 'Spotify',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1DB954"/><path d="M6.4 9.3c3.6-1.05 7.7-0.72 10.8 1.05" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M7 12.6c3-0.85 6.2-0.5 8.7 1.0" stroke="#fff" stroke-width="1.35" fill="none" stroke-linecap="round"/><path d="M7.5 15.7c2.4-0.62 4.8-0.4 6.7 0.8" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>'
    };
  }
  if (link.isSubscribe) {
    return {
      key: 'subscribe',
      label: 'Subscribe',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>'
    };
  }
  if (link.isHero) {
    return {
      key: 'hero',
      label: 'Hero',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
    };
  }
  if (link.isCourse) {
    return {
      key: 'course',
      label: 'Course',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'
    };
  }
  if (link.isCoaching) {
    return {
      key: 'coaching',
      label: 'Booking',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    };
  }
  if (link.isProduct) {
    return {
      key: 'product',
      label: 'Product',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>'
    };
  }
  if (link.isMediaKit) {
    return {
      key: 'mediakit',
      label: 'Media Kit',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="17" x2="8" y2="13"/><line x1="12" y1="17" x2="12" y2="11"/><line x1="16" y1="17" x2="16" y2="15"/></svg>'
    };
  }
  if (link.featured) {
    return {
      key: 'featured',
      label: 'Featured',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
    };
  }
  // Default: regular link
  return {
    key: 'link',
    label: 'Link',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
  };
}

// Trash-can SVG used as the row "remove" affordance. Replaces the prior
// pill-style "Remove" button. Inline-styled so it renders correctly even
// when the surrounding row CSS gets overridden.
const BIO_TRASH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';

// Returns the HTML for a half-width toggle row (used inside the expanded
// editor for links/courses/bookings/products). Two consecutive halves end up
// side-by-side; a half next to a full-width link is half with empty space.
function bioHalfWidthToggle(link) {
  const isOn = !!link.halfWidth;
  return `<label class="bio-half-toggle bio-s-1adb5f" >
    <span class="bio-s-e3f610">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="8" height="12" rx="1.5"/><rect x="13" y="6" width="8" height="12" rx="1.5"/></svg>
      Half width
    </span>
    <span class="bio-half-switch bio-half-track ${isOn ? 'on' : ''}" aria-hidden="true">
      <span class="bio-half-thumb ${isOn ? 'on' : ''}"></span>
    </span>
    <input type="checkbox" ${isOn ? 'checked' : ''} data-bio-action="toggle-link-half-width" data-bio-event="change" data-bio-id="${link._id}" aria-label="Half width" class="bio-s-12c53e">
  </label>`;
}

let bioStalePhotos = []; // photos to delete on next save
let bioExpandedLinks = new Set(); // _ids of links currently expanded for editing

function renderBioLinks() {
  const el = document.getElementById('bio-links-list');
  if (!el) return;
  const counts = document.getElementById('bio-links-counts');
  const { maxLinks, maxFeatured, maxHero, pro, isMax: max } = bioLimits();
  const regularCount = bioState.links.filter(l => !l.featured && !l.isHero).length;
  const featuredCount = bioState.links.filter(l => l.featured).length;
  const heroCount = bioState.links.filter(l => l.isHero).length;
  if (counts) {
    const parts = [`${regularCount}/${maxLinks} links`, `${featuredCount}/${maxFeatured} featured`];
    counts.textContent = parts.join(' · ');
  }

  if (bioState.links.length === 0) {
    el.innerHTML = '<div class="bio-s-bc2256">No links yet. Click below to add one.</div>';
  } else {
    el.innerHTML = bioState.links.map(l => renderLinkRow(l)).join('');
    // Apply any data-bio-color / data-bio-bg / etc on the just-rendered rows
    bioApplyDataStyles(el);
  }
  // Toggle add buttons
  document.getElementById('bio-add-link-btn').disabled = regularCount >= maxLinks;
  document.getElementById('bio-add-link-btn').style.opacity = regularCount >= maxLinks ? 0.5 : 1;
  document.getElementById('bio-add-featured-btn').disabled = featuredCount >= maxFeatured;
  document.getElementById('bio-add-featured-btn').style.opacity = featuredCount >= maxFeatured ? 0.5 : 1;
  // Hero button: visible only for Max users
  const heroBtn = document.getElementById('bio-add-hero-btn');
  if (heroBtn) {
    heroBtn.style.display = max ? 'flex' : 'none';
    heroBtn.disabled = heroCount >= maxHero;
    heroBtn.style.opacity = heroCount >= maxHero ? 0.5 : 1;
  }
  // YouTube / TikTok / Instagram: one block per platform (all plans). The add
  // button is disabled while a block of that type exists and re-enables when
  // it's removed.
  const setBlockBtn = (id, exists) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = exists;
    b.style.opacity = exists ? 0.5 : 1;
  };
  setBlockBtn('bio-add-video-link', bioState.links.some(l => l.isVideoBlock));
  setBlockBtn('bio-add-tiktok-link', bioState.links.some(l => l.isTikTokBlock));
  setBlockBtn('bio-add-instagram-link', bioState.links.some(l => l.isInstagramBlock));
  // Media Kit button
  const mkBtn = document.getElementById('bio-add-mediakit-link');
  if (mkBtn) mkBtn.style.display = pro || max ? 'flex' : 'none';
  // Course button: visible for Max users
  const courseBtn = document.getElementById('bio-add-course-link');
  if (courseBtn) courseBtn.style.display = max ? 'flex' : 'none';
  const coachingBtn = document.getElementById('bio-add-coaching-link');
  if (coachingBtn) coachingBtn.style.display = max ? 'flex' : 'none';
  const productBtn = document.getElementById('bio-add-product-link');
  if (productBtn) productBtn.style.display = max ? 'flex' : 'none';
  // Show the Tools group wrapper if any tool button is visible (Pro or Max).
  const toolsWrap = document.getElementById('bio-tools-group-wrap');
  if (toolsWrap) toolsWrap.style.display = (pro || max) ? 'block' : 'none';
  // Enable Sortable (reinit)
  if (window.Sortable) {
    const prev = el._sortable;
    if (prev) prev.destroy();
    // Auto-scroll is desktop-only. SortableJS's auto-scroll on iOS Safari
    // fights with native touch scrolling and feels broken, so on touch devices
    // we disable it entirely. Mobile users scroll manually mid-drag (release,
    // scroll, re-grab) — same pattern as Instagram, Notion, LinkedIn mobile.
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    el._sortable = Sortable.create(el, {
      handle: '.bio-link-drag',
      animation: 180,
      scroll: isTouchDevice ? false : (document.scrollingElement || document.documentElement),
      scrollSensitivity: 80,
      scrollSpeed: 16,
      forceAutoScrollFallback: !isTouchDevice,
      onEnd: () => {
        const order = [...el.children].map(c => parseInt(c.dataset.id));
        bioState.links.sort((a, b) => order.indexOf(a._id) - order.indexOf(b._id));
        schedulePreviewUpdate();
      }
    });
  }
}

function renderLinkRow(link) {
  const dragSvg = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>';
  const editSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const isExpanded = bioExpandedLinks.has(link._id);

  if (isExpanded) {
    return renderLinkExpanded(link, dragSvg);
  }
  return renderLinkCollapsed(link, dragSvg, editSvg);
}

function renderLinkCollapsed(link, dragSvg, editSvg) {
  const meta = bioRowTypeMeta(link);

  // Per-type subline: what's shown under the title. Each branch here
  // computes the secondary text (URL, video count, price, etc.) and the
  // optional thumbnail. Everything else is shared by all row types.
  let subline = '';
  let thumb = '';
  let title = escapeHtml(link.title || 'Untitled');
  let titleColor = 'var(--text)';

  if (link.isHeader) {
    if (!link.title) { title = 'Empty header'; titleColor = '#fca5a5'; }
    title = escapeHtml(link.title || 'Empty header');
  } else if (link.isVideoBlock) {
    const videos = Array.isArray(link.videos) ? link.videos : [];
    const filledCount = videos.filter(v => v && v.url && v.url.trim()).length;
    const firstId = (() => {
      for (const v of videos) {
        const id = extractYouTubeIdDash(v && v.url);
        if (id) return id;
      }
      return null;
    })();
    thumb = firstId
      ? `<img alt="YouTube preview" src="https://i.ytimg.com/vi/${firstId}/default.jpg" class="bio-s-11a000" data-bio-onerror="hide-thumb-bg">`
      : '';
    title = 'YouTube videos';
    subline = filledCount === 0 ? 'No videos yet' : (filledCount === 1 ? '1 video' : filledCount + ' videos');
  } else if (link.isTikTokBlock) {
    const videos = Array.isArray(link.videos) ? link.videos : [];
    const filledCount = videos.filter(v => v && v.url && v.url.trim() && extractTikTokId(v.url)).length;
    // Show the first video's thumbnail, resolved via /api/tiktok-oembed (cached
    // per session). Falls back to the TikTok type icon until it resolves or if
    // it's unavailable; the row re-renders when the fetch lands.
    const firstTikTokUrl = (() => {
      for (const v of videos) { if (v && v.url && extractTikTokId(v.url)) return v.url; }
      return null;
    })();
    if (firstTikTokUrl) {
      ensureTikTokThumb(firstTikTokUrl);
      const tt = tiktokThumbCache[firstTikTokUrl];
      if (tt) thumb = `<img alt="TikTok preview" src="${escapeHtml(tt)}" class="bio-s-11a000" data-bio-onerror="hide-thumb-bg">`;
    }
    title = 'TikTok videos';
    subline = filledCount === 0 ? 'No videos yet' : (filledCount === 1 ? '1 video' : filledCount + ' videos');
  } else if (link.isInstagramBlock) {
    const videos = Array.isArray(link.videos) ? link.videos : [];
    const filledCount = videos.filter(v => v && v.url && v.url.trim() && extractInstagramId(v.url)).length;
    title = 'Instagram reels';
    subline = filledCount === 0 ? 'No reels yet' : (filledCount === 1 ? '1 reel' : filledCount + ' reels');
  } else if (link.isSpotifyBlock) {
    const sp = extractSpotify(link.url);
    title = 'Spotify';
    subline = sp ? (sp.type.charAt(0).toUpperCase() + sp.type.slice(1)) : '<span class="bio-s-dbc3a0">No link yet</span>';
  } else if (link.isSubscribe) {
    title = escapeHtml(link.title || 'Subscribe to my newsletter');
  } else if (link.isHero) {
    if (link.photoUrl) {
      thumb = `<img alt="Hero thumbnail" src="${escapeHtml(link.photoUrl)}" class="bio-s-3323bf">`;
    }
    const url = (link.url || '').trim();
    subline = url
      ? escapeHtml(url.length > 50 ? url.slice(0, 47) + '…' : url)
      : '<span class="bio-s-dbc3a0">No URL set</span>';
  } else if (link.isCourse) {
    if (link.photoUrl) {
      thumb = `<img alt="Course thumbnail" src="${escapeHtml(link.photoUrl)}" class="bio-s-11a000">`;
    }
    const priceText = link.coursePrice > 0 ? formatMoney(link.coursePrice, {alwaysShowCents:true}) : 'Free';
    const crossoutText = link.courseCrossoutPrice > 0 ? '<span class="bio-s-3c891d">$' + (link.courseCrossoutPrice / 100).toFixed(2) + '</span>' : '';
    subline = priceText + crossoutText;
  } else if (link.isCoaching) {
    if (link.photoUrl) {
      thumb = `<img alt="Booking thumbnail" src="${escapeHtml(link.photoUrl)}" class="bio-s-11a000">`;
    }
    subline = link.coachingPrice > 0 ? formatMoney(link.coachingPrice, {alwaysShowCents:true}) : 'Free';
  } else if (link.isProduct) {
    if (link.photoUrl) {
      thumb = `<img alt="Product thumbnail" src="${escapeHtml(link.photoUrl)}" class="bio-s-11a000">`;
    }
    subline = link.productPrice > 0 ? formatMoney(link.productPrice, {alwaysShowCents:true}) : 'Free';
  } else {
    // Regular link / featured / mediakit
    if (!link.isMediaKit && link.photoUrl) {
      thumb = `<img alt="" src="${escapeHtml(link.photoUrl)}" loading="lazy" data-bio-onerror="hide" class="bio-s-fc4450">`;
    }
    const url = (link.url || '').trim();
    subline = url
      ? escapeHtml(url.length > 50 ? url.slice(0, 47) + '…' : url)
      : '<span class="bio-s-dbc3a0">No URL set</span>';
  }

  // Type icon — shown if there's no thumbnail (otherwise thumbnail carries the visual weight)
  const typeIconHtml = thumb
    ? thumb
    : `<div class="bio-row-typeicon">${meta.icon}</div>`;

  const sublineHtml = subline
    ? `<div class="bio-row-subline">${subline}</div>`
    : '';

  return `<div class="bio-link-row bio-link-collapsed bio-row-typed" data-id="${link._id}" data-type="${meta.key}" data-bio-action="expand-link" data-bio-id="${link._id}">
    <div class="bio-link-drag" aria-label="Drag to reorder">${dragSvg}</div>
    ${typeIconHtml}
    <div class="bio-row-body">
      <div class="bio-row-title" data-bio-color="${titleColor}">${title}</div>
      ${sublineHtml}
    </div>
    ${bioHalfBadge(link)}
    <button type="button" class="bio-row-edit" aria-label="Edit" data-bio-action="expand-link" data-bio-id="${link._id}">${editSvg}</button>
    <button type="button" class="bio-row-trash" aria-label="Remove" title="Remove" data-bio-action="remove-link" data-bio-id="${link._id}">${BIO_TRASH_SVG}</button>
  </div>`;
}

async function onLinkThumbSelected(input, linkId) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { showBioStatus('error', 'Please upload an image.'); return; }
  if (file.size > 25 * 1024 * 1024) { showBioStatus('error', 'Image is too large (25MB max).'); return; }

  // Check 10 link photo limit
  var photoCount = bioState.links.filter(function(l) { return l.photoUrl && !l.featured && !l.isHero && !l.isCourse && !l.isCoaching && !l.isProduct; }).length;
  if (photoCount >= 20) { showBioStatus('error', 'Thumbnail limit reached (20 links).'); return; }

  var link = bioState.links.find(function(l) { return l._id === linkId; });
  if (!link) return;

  try {
    showBioStatus('info', 'Uploading…');
    var blob = await compressBgImage(file, 200, 200, 30 * 1024);
    var fileName = 'thumb-' + linkId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,8) + '.webp';
    var path = currentUser.id + '/' + fileName;
    var { error: upErr } = await sb.storage.from('bio-photos').upload(path, blob, { contentType: 'image/webp', upsert: false });
    if (upErr) throw upErr;
    var { data: { publicUrl } } = sb.storage.from('bio-photos').getPublicUrl(path);

    if (link.photoUrl) bioStalePhotos.push(link.photoUrl);
    link.photoUrl = publicUrl;
    renderBioLinks();
    schedulePreviewUpdate();
    showBioStatus('success', 'Thumbnail added. Remember to save.');
  } catch (e) {
    console.error(e);
    showBioStatus('error', 'Upload failed: ' + (e.message || 'unknown'));
  }
}

function removeLinkThumb(linkId) {
  var link = bioState.links.find(function(l) { return l._id === linkId; });
  if (!link || !link.photoUrl) return;
  bioStalePhotos.push(link.photoUrl);
  link.photoUrl = '';
  renderBioLinks();
  schedulePreviewUpdate();
  showBioStatus('info', 'Thumbnail removed. Remember to save.');
}

async function onHeroPhotoSelected(input, linkId) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  if (!isMax()) { showBioStatus('error', 'Hero links are a Creator Max feature.'); return; }
  if (!file.type.startsWith('image/')) { showBioStatus('error', 'Please upload an image.'); return; }
  if (file.size > 25 * 1024 * 1024) { showBioStatus('error', 'Image is too large (25MB max).'); return; }

  const link = bioState.links.find(l => l._id === linkId);
  if (!link) return;

  try {
    showBioStatus('info', 'Uploading…');
    // Compress aggressively since we may have up to 10 hero photos
    const blob = await compressBgImage(file, 800, 800, 180 * 1024);
    const fileName = `hero-${linkId}-${Date.now()}-${Math.random().toString(36).slice(2,8)}.webp`;
    const path = `${currentUser.id}/${fileName}`;
    const { error: upErr } = await sb.storage.from('bio-photos').upload(path, blob, { contentType: 'image/webp', upsert: false });
    if (upErr) throw upErr;
    const { data: { publicUrl } } = sb.storage.from('bio-photos').getPublicUrl(path);

    // Queue old photo for cleanup if replacing
    if (link.photoUrl) bioStalePhotos.push(link.photoUrl);
    link.photoUrl = publicUrl;
    renderBioLinks();
    schedulePreviewUpdate();
    showBioStatus('success', 'Hero photo uploaded. Remember to save.');
  } catch (e) {
    console.error(e);
    showBioStatus('error', `Upload failed: ${e.message || 'unknown'}`);
  }
}

function renderLinkExpanded(link, dragSvg) {
  // Header — single text input, no URL/photo/description
  if (link.isHeader) {
    return `<div class="bio-link-row bio-link-header-row bio-s-44d745" data-id="${link._id}" >
      <div class="bio-link-header">
        <div class="bio-link-drag" aria-label="Drag to reorder">${dragSvg}</div>
        <span class="bio-featured-badge bio-s-3a0b91" >Header</span>
        <div class="bio-s-7623f0"></div>
        <button class="bio-link-remove" data-bio-action="remove-link" data-bio-id="${link._id}">Remove</button>
      </div>
      <input type="text" placeholder="Section header (e.g. My Socials)" maxlength="60" value="${escapeHtml(link.title || '')}"
        data-bio-action="update-link-field" data-bio-event="input" data-bio-id="${link._id}" data-bio-field="title" aria-label="Header text" class="bio-s-6c002e">
      <button type="button" data-bio-action="save-link-row" data-bio-id="${link._id}"
        class="bio-s-c7cf47">
        Save header
      </button>
    </div>`;
  }

  // Subscribe block — just a title/label field
  if (link.isSubscribe) {
    return `<div class="bio-link-row bio-s-dc2eb3" data-id="${link._id}" >
      <div class="bio-link-header">
        <div class="bio-link-drag" aria-label="Drag to reorder">${dragSvg}</div>
        <span class="bio-featured-badge bio-s-3a0b91" >Subscribe</span>
        <div class="bio-s-7623f0"></div>
        <button class="bio-link-remove" data-bio-action="remove-link" data-bio-id="${link._id}">Remove</button>
      </div>
      <input type="text" placeholder="Subscribe heading (e.g. Join my newsletter)" maxlength="80" value="${escapeHtml(link.title || '')}"
        data-bio-action="update-link-field" data-bio-event="input" data-bio-id="${link._id}" data-bio-field="title" aria-label="Subscribe heading" class="bio-s-6c002e">
      <div class="bio-s-7728fb">Visitors will see an email input and subscribe button styled to your theme.</div>
      <button type="button" data-bio-action="save-link-row" data-bio-id="${link._id}"
        class="bio-s-c7cf47">
        Save
      </button>
    </div>`;
  }

  // Video block — list of up to 10 YouTube URL inputs, each removable. An
  // "Add another video" button appears at the bottom when fewer than 10 are
  // present. The whole block can be removed via the row's Remove button.
  if (link.isVideoBlock) {
    const videos = Array.isArray(link.videos) && link.videos.length ? link.videos : [{ url: '' }];
    const atMax = videos.length >= 10;
    const inputsHtml = videos.map((v, idx) => {
      const value = escapeHtml(v && v.url ? v.url : '');
      return `<div class="bio-s-302bc1">
        <input type="url" placeholder="https://youtube.com/watch?v=..." value="${value}"
          data-bio-action="update-video-url" data-bio-event="input" data-bio-id="${link._id}" data-bio-idx="${idx}"
          aria-label="YouTube URL ${idx + 1}"
          class="bio-s-d3db56">
        <button type="button" aria-label="Remove this video" data-bio-action="remove-video" data-bio-id="${link._id}" data-bio-idx="${idx}"
          class="bio-s-09aacd">×</button>
      </div>`;
    }).join('');
    return `<div class="bio-link-row" data-id="${link._id}">
      <div class="bio-link-header">
        <div class="bio-link-drag" aria-label="Drag to reorder">${dragSvg}</div>
        <span class="bio-featured-badge bio-s-04da54" >YouTube</span>
        <div class="bio-s-7623f0"></div>
        <button class="bio-link-remove" data-bio-action="remove-link" data-bio-id="${link._id}">Remove</button>
      </div>
      <div class="bio-s-e289c0">Add up to 10 YouTube videos or shorts as a carousel.</div>
      ${inputsHtml}
      <button type="button" data-bio-action="add-video-to-block" data-bio-id="${link._id}" ${atMax ? 'disabled' : ''}
        class="bio-add-video-btn ${atMax ? 'is-disabled' : ''}">
        ${atMax ? '10 video limit reached' : '+ Add another video'}
      </button>
      <button type="button" data-bio-action="save-link-row" data-bio-id="${link._id}"
        class="bio-s-c7cf47">
        Save
      </button>
    </div>`;
  }

  if (link.isTikTokBlock) {
    const videos = Array.isArray(link.videos) && link.videos.length ? link.videos : [{ url: '' }];
    const atMax = videos.length >= 10;
    const inputsHtml = videos.map((v, idx) => {
      const value = escapeHtml(v && v.url ? v.url : '');
      return `<div class="bio-s-302bc1">
        <input type="url" placeholder="https://www.tiktok.com/@user/video/..." value="${value}"
          data-bio-action="update-video-url" data-bio-event="input" data-bio-id="${link._id}" data-bio-idx="${idx}"
          aria-label="TikTok URL ${idx + 1}"
          class="bio-s-d3db56">
        <button type="button" aria-label="Remove this video" data-bio-action="remove-video" data-bio-id="${link._id}" data-bio-idx="${idx}"
          class="bio-s-09aacd">×</button>
      </div>`;
    }).join('');
    return `<div class="bio-link-row" data-id="${link._id}">
      <div class="bio-link-header">
        <div class="bio-link-drag" aria-label="Drag to reorder">${dragSvg}</div>
        <span class="bio-featured-badge bio-s-04da54" >TikTok</span>
        <div class="bio-s-7623f0"></div>
        <button class="bio-link-remove" data-bio-action="remove-link" data-bio-id="${link._id}">Remove</button>
      </div>
      <div class="bio-s-e289c0">Add up to 10 TikTok videos as a carousel. Paste the full video link (www.tiktok.com/@user/video/...).</div>
      ${inputsHtml}
      <button type="button" data-bio-action="add-video-to-block" data-bio-id="${link._id}" ${atMax ? 'disabled' : ''}
        class="bio-add-video-btn ${atMax ? 'is-disabled' : ''}">
        ${atMax ? '10 video limit reached' : '+ Add another video'}
      </button>
      <button type="button" data-bio-action="save-link-row" data-bio-id="${link._id}"
        class="bio-s-c7cf47">
        Save
      </button>
    </div>`;
  }

  if (link.isInstagramBlock) {
    const videos = Array.isArray(link.videos) && link.videos.length ? link.videos : [{ url: '' }];
    const atMax = videos.length >= 10;
    const inputsHtml = videos.map((v, idx) => {
      const value = escapeHtml(v && v.url ? v.url : '');
      return `<div class="bio-s-302bc1">
        <input type="url" placeholder="https://www.instagram.com/reel/..." value="${value}"
          data-bio-action="update-video-url" data-bio-event="input" data-bio-id="${link._id}" data-bio-idx="${idx}"
          aria-label="Instagram reel URL ${idx + 1}"
          class="bio-s-d3db56">
        <button type="button" aria-label="Remove this reel" data-bio-action="remove-video" data-bio-id="${link._id}" data-bio-idx="${idx}"
          class="bio-s-09aacd">×</button>
      </div>`;
    }).join('');
    return `<div class="bio-link-row" data-id="${link._id}">
      <div class="bio-link-header">
        <div class="bio-link-drag" aria-label="Drag to reorder">${dragSvg}</div>
        <span class="bio-featured-badge bio-s-04da54" >Instagram</span>
        <div class="bio-s-7623f0"></div>
        <button class="bio-link-remove" data-bio-action="remove-link" data-bio-id="${link._id}">Remove</button>
      </div>
      <div class="bio-s-e289c0">Add up to 10 Instagram reels as a carousel. Paste the full reel link (instagram.com/reel/...). The reel must be public.</div>
      ${inputsHtml}
      <button type="button" data-bio-action="add-video-to-block" data-bio-id="${link._id}" ${atMax ? 'disabled' : ''}
        class="bio-add-video-btn ${atMax ? 'is-disabled' : ''}">
        ${atMax ? '10 reel limit reached' : '+ Add another reel'}
      </button>
      <button type="button" data-bio-action="save-link-row" data-bio-id="${link._id}"
        class="bio-s-c7cf47">
        Save
      </button>
    </div>`;
  }

  if (link.isSpotifyBlock) {
    return `<div class="bio-link-row" data-id="${link._id}">
      <div class="bio-link-header">
        <div class="bio-link-drag" aria-label="Drag to reorder">${dragSvg}</div>
        <span class="bio-featured-badge bio-s-04da54" >Spotify</span>
        <div class="bio-s-7623f0"></div>
        <button class="bio-link-remove" data-bio-action="remove-link" data-bio-id="${link._id}">Remove</button>
      </div>
      <div class="bio-s-e289c0">Paste a Spotify share link, a track, album, playlist, artist, or podcast. Tracks show a compact player; albums and playlists show a scrollable tracklist.</div>
      <input type="url" placeholder="https://open.spotify.com/..." value="${escapeHtml(link.url || '')}"
        data-bio-action="update-link-field" data-bio-event="input" data-bio-id="${link._id}" data-bio-field="url"
        aria-label="Spotify link" class="bio-s-6c002e">
      <button type="button" data-bio-action="save-link-row" data-bio-id="${link._id}"
        class="bio-s-c7cf47">
        Save
      </button>
    </div>`;
  }

  let photoSlot = '';
  if (link.isCourse) {

    // Course link — show cover, locked title/URL, crossout price option
    const coverHtml = link.photoUrl
      ? `<img alt="Link cover" src="${escapeHtml(link.photoUrl)}" class="bio-s-f31042">`
      : '';
    const priceDisplay = link.coursePrice > 0 ? formatMoney(link.coursePrice, {alwaysShowCents:true}) : 'Free';
    const crossoutVal = link.courseCrossoutPrice > 0 ? (link.courseCrossoutPrice / 100).toFixed(2) : '';
    return `<div class="bio-link-row" data-id="${link._id}">
      <div class="bio-link-header">
        <div class="bio-link-drag" aria-label="Drag to reorder">${dragSvg}</div>
        <span class="bio-featured-badge bio-s-3a0b91" >Course</span>${bioHalfBadge(link)}
        <div class="bio-s-7623f0"></div>
        <button class="bio-link-remove" data-bio-action="remove-link" data-bio-id="${link._id}">Remove</button>
      </div>
      ${coverHtml}
      <input type="text" value="${escapeHtml(link.title || '')}" readonly class="bio-s-5973a5" aria-label="Course title">
      <div class="bio-s-57a11c">
        <div class="bio-s-598868">
          <span class="bio-s-dc6286">Price:</span>
          <span class="bio-s-b80e2b">${priceDisplay}</span>
        </div>
        <div class="bio-s-598868">
          <span class="bio-s-dc6286">Crossout $</span>
          <input type="text" inputmode="decimal" value="${crossoutVal}" placeholder="99.99"
            data-bio-action="update-link-crossout-price" data-bio-event="input" data-bio-id="${link._id}"
            aria-label="Crossout price" class="bio-s-09cb7b">
        </div>
      </div>
      ${bioHalfWidthToggle(link)}
      <button type="button" data-bio-action="save-link-row" data-bio-id="${link._id}"
        class="bio-s-c7cf47">
        Save link
      </button>
    </div>`;
  }
  if (link.isCoaching) {
    const coverHtml = link.photoUrl
      ? `<img alt="Link cover" src="${escapeHtml(link.photoUrl)}" class="bio-s-f31042">`
      : '';
    const priceDisplay = link.coachingPrice > 0 ? formatMoney(link.coachingPrice, {alwaysShowCents:true}) : 'Free';
    return `<div class="bio-link-row" data-id="${link._id}">
      <div class="bio-link-header">
        <div class="bio-link-drag" aria-label="Drag to reorder">${dragSvg}</div>
        <span class="bio-featured-badge bio-s-3a0b91" >Booking</span>${bioHalfBadge(link)}
        <div class="bio-s-7623f0"></div>
        <button class="bio-link-remove" data-bio-action="remove-link" data-bio-id="${link._id}">Remove</button>
      </div>
      ${coverHtml}
      <input type="text" value="${escapeHtml(link.title || '')}" readonly class="bio-s-5973a5" aria-label="Coaching title">
      <div class="bio-s-d2b7d2">
        <span class="bio-s-dc6286">Price:</span>
        <span class="bio-s-b80e2b">${priceDisplay}</span>
      </div>
      ${bioHalfWidthToggle(link)}
      <button type="button" data-bio-action="save-link-row" data-bio-id="${link._id}"
        class="bio-s-c7cf47">
        Save link
      </button>
    </div>`;
  }
  if (link.isProduct) {
    const coverHtml = link.photoUrl
      ? `<img alt="Link cover" src="${escapeHtml(link.photoUrl)}" class="bio-s-f31042">`
      : '';
    const priceDisplay = link.productPrice > 0 ? formatMoney(link.productPrice, {alwaysShowCents:true}) : 'Free';
    return `<div class="bio-link-row" data-id="${link._id}">
      <div class="bio-link-header">
        <div class="bio-link-drag" aria-label="Drag to reorder">${dragSvg}</div>
        <span class="bio-featured-badge bio-s-3a0b91" >Product</span>${bioHalfBadge(link)}
        <div class="bio-s-7623f0"></div>
        <button class="bio-link-remove" data-bio-action="remove-link" data-bio-id="${link._id}">Remove</button>
      </div>
      ${coverHtml}
      <input type="text" value="${escapeHtml(link.title || '')}" readonly class="bio-s-5973a5" aria-label="Product title">
      <div class="bio-s-d2b7d2">
        <span class="bio-s-dc6286">Price:</span>
        <span class="bio-s-b80e2b">${priceDisplay}</span>
      </div>
      ${bioHalfWidthToggle(link)}
      <button type="button" data-bio-action="save-link-row" data-bio-id="${link._id}"
        class="bio-s-c7cf47">
        Save link
      </button>
    </div>`;
  }
  if (link.featured) {
    photoSlot = `
    <div class="bio-featured-photo-slot">
      ${link.photoUrl
        ? `<img alt="Link thumbnail" src="${escapeHtml(link.photoUrl)}">`
        : '<span>+ Upload 16:9 photo</span>'}
      <input type="file" accept="image/*" aria-label="Upload featured photo" data-bio-action="open-cropper-featured" data-bio-event="change" data-bio-id="${link._id}">
    </div>`;
  } else if (link.isHero) {
    photoSlot = `
    <div class="bio-hero-photo-slot">
      ${link.photoUrl
        ? `<img alt="Link thumbnail" src="${escapeHtml(link.photoUrl)}">`
        : '<span>+ Upload hero image</span>'}
      <input type="file" accept="image/*" aria-label="Upload hero photo" data-bio-action="hero-photo-selected" data-bio-event="change" data-bio-id="${link._id}">
    </div>`;
  }
  return `<div class="bio-link-row${link.isHero ? ' bio-link-hero' : ''}" data-id="${link._id}">
    <div class="bio-link-header">
      <div class="bio-link-drag" aria-label="Drag to reorder">${dragSvg}</div>
      ${link.featured ? '<span class="bio-featured-badge">Featured</span>' : ''}
      ${link.isHero ? '<span class="bio-hero-badge">Hero</span>' : ''}
      <div class="bio-s-7623f0"></div>
      <button class="bio-link-remove" data-bio-action="remove-link" data-bio-id="${link._id}">Remove</button>
    </div>
    ${photoSlot}
    ${!link.featured && !link.isHero ? `<div class="bio-s-41ec1b">
      ${link.photoUrl
        ? `<img alt="Link thumbnail" src="${escapeHtml(link.photoUrl)}" class="bio-s-19345c">
           <button type="button" data-bio-action="remove-link-thumb" data-bio-id="${link._id}" class="bio-s-851be4">Remove</button>`
        : `<label class="bio-thumb-upload-label bio-s-d914e0" >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            Add Thumbnail
            <input type="file" accept="image/*" data-bio-action="link-thumb-selected" data-bio-event="change" data-bio-id="${link._id}" class="bio-s-c8be1c">
          </label>`}
    </div>` : ''}
    <input type="text" placeholder="Title" maxlength="80" value="${escapeHtml(link.title || '')}"
      data-bio-action="update-link-field" data-bio-event="input" data-bio-id="${link._id}" data-bio-field="title" aria-label="Link title">
    <input type="text" placeholder="Description (optional)" maxlength="120" value="${escapeHtml(link.description || '')}"
      data-bio-action="update-link-field" data-bio-event="input" data-bio-id="${link._id}" data-bio-field="description" aria-label="Link description">
    <input type="url" placeholder="https://..." value="${escapeHtml(link.url || '')}"
      data-bio-action="update-link-field" data-bio-event="input" data-bio-id="${link._id}" data-bio-field="url" aria-label="Link URL" class="bio-s-6c002e">
    ${(!link.featured && !link.isHero && !link.isMediaKit) ? bioHalfWidthToggle(link) : ''}
    <div id="bio-link-err-${link._id}" class="bio-s-f62f0b"></div>
    <button type="button" data-bio-action="save-link-row" data-bio-id="${link._id}"
      class="bio-s-c7cf47">
      Save link
    </button>
  </div>`;
}

function expandLink(id) {
  bioExpandedLinks.add(id);
  renderBioLinks();
}

function saveLinkRow(id) {
  const link = bioState.links.find(l => l._id === id);
  if (!link) return;

  // Headers, subscribe blocks, and video/TikTok blocks don't require a URL
  if (link.isHeader || link.isSubscribe || link.isVideoBlock || link.isTikTokBlock || link.isInstagramBlock || link.isSpotifyBlock) {
    bioExpandedLinks.delete(id);
    renderBioLinks();
    schedulePreviewUpdate();
    return;
  }

  const url = (link.url || '').trim();
  if (!url) {
    const err = document.getElementById('bio-link-err-' + id);
    if (err) {
      err.textContent = 'URL is required to save this link.';
      err.style.display = 'block';
    }
    return;
  }
  bioExpandedLinks.delete(id);
  renderBioLinks();
  schedulePreviewUpdate();
}

// ====== VIDEOS ======
// Helper for extracting a YouTube ID — used by video block renderers in
// both the editor (collapsed thumb) and the live preview.
function extractYouTubeIdDash(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// A Short is identified by the /shorts/ URL form the creator pasted. Used to
// default the vertical (9:16) layout; the creator can still toggle it.
function isShortsUrl(url) {
  return /youtube\.com\/shorts\//i.test(String(url || ''));
}

// Numeric TikTok post id from a full video URL (/@user/video/ID, /embed/ID,
// /embed/v2/ID, /v/ID). Short share links can't be resolved client-side.
function extractTikTokId(url) {
  if (!url) return null;
  const m = String(url).match(/tiktok\.com\/(?:.*\/video\/|embed\/(?:v2\/)?|v\/)(\d{6,})/i);
  return m ? m[1] : null;
}

// Instagram shortcode from a reel/post URL (/reel/CODE, /reels/CODE, /p/CODE,
// /tv/CODE). Embed works for public content only.
function extractInstagramId(url) {
  if (!url) return null;
  const m = String(url).match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

// Spotify type + id from a share URL (track/album/playlist/artist/episode/show,
// with an optional /intl-xx/ locale prefix). Embed = open.spotify.com/embed/...
function extractSpotify(url) {
  if (!url) return null;
  const m = String(url).match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/i);
  return m ? { type: m[1].toLowerCase(), id: m[2] } : null;
}

// Editor-preview thumbnails for TikTok. The browser can't hit TikTok oEmbed
// directly (no CORS), so we resolve through our own /api/tiktok-oembed route
// and cache per session. When a thumbnail resolves we refresh the preview so
// the real image replaces the placeholder. Cached lookups (incl. failures,
// stored as null) never refetch, so there's no render loop.
const tiktokThumbCache = {};   // url -> thumbnail_url string, or null if unavailable
const tiktokThumbPending = {}; // url -> true while a fetch is in flight
function ensureTikTokThumb(url) {
  if (!url || !extractTikTokId(url)) return;
  if (Object.prototype.hasOwnProperty.call(tiktokThumbCache, url)) return;
  if (tiktokThumbPending[url]) return;
  tiktokThumbPending[url] = true;
  fetch('/api/tiktok-oembed?url=' + encodeURIComponent(url))
    .then(r => (r.ok ? r.json() : null))
    .then(data => { tiktokThumbCache[url] = (data && data.thumbnail_url) ? data.thumbnail_url : null; })
    .catch(() => { tiktokThumbCache[url] = null; })
    .finally(() => { delete tiktokThumbPending[url]; renderBioLinks(); schedulePreviewUpdate(); });
}

function setAvatarDisplay(mode) {
  if (mode === 'hero' && !isPro()) {
    // Free user clicked Hero. Open the upsell modal (with sample image)
    // instead of toasting an error. The Default/Hero buttons are visible
    // for everyone now; the gate is here at click-time.
    showHeroUpsell();
    return;
  }
  bioState.avatar_display = mode;
  updateAvatarDisplayUI();
  schedulePreviewUpdate();
}

// Hero/themes upsell. Shown when a free user clicks the Hero avatar
// display button. Markup lives in dashboard.html (#hero-upsell-modal).
function showHeroUpsell() {
  const modal = document.getElementById('hero-upsell-modal');
  if (modal) modal.style.display = 'flex';
}
function closeHeroUpsell() {
  const modal = document.getElementById('hero-upsell-modal');
  if (modal) modal.style.display = 'none';
}

function updateAvatarDisplayUI() {
  const wrap = document.getElementById('bio-avatar-display-wrap');
  const btnDefault = document.getElementById('bio-avatar-mode-default');
  const btnHero = document.getElementById('bio-avatar-mode-hero');
  if (!wrap) return;
  // Display style controls are visible to ALL users with an avatar.
  // The Hero button is shown but, for free users, clicking it opens the
  // upsell modal instead of switching modes. See setAvatarDisplay().
  wrap.style.display = bioState.avatar_url ? 'block' : 'none';
  if (btnDefault && btnHero) {
    // Visual selected state mirrors actual saved state, which can only be
    // 'hero' if the user is (or was) Pro. Free users will always show
    // Default highlighted regardless of clicks.
    const isHero = bioState.avatar_display === 'hero';
    btnDefault.style.background = isHero ? 'transparent' : 'var(--accent)';
    btnDefault.style.color = isHero ? 'var(--muted)' : '#fff';
    btnDefault.style.borderColor = isHero ? 'var(--border-hover)' : 'var(--accent)';
    // Hero button: Creator Max gradient when selected, purple border when not
    btnHero.style.background = isHero ? 'linear-gradient(135deg, #a78bfa, #e879f9)' : 'transparent';
    btnHero.style.color = isHero ? '#fff' : '#f0abfc';
    btnHero.style.borderColor = isHero ? 'transparent' : 'rgba(232,121,249,0.4)';
    btnHero.style.boxShadow = isHero ? '0 0 14px rgba(232,121,249,0.3)' : 'none';
  }
}

function removeAvatar() {
  if (bioState.avatar_url) bioStalePhotos.push(bioState.avatar_url);
  bioState.avatar_url = '';
  bioState.avatar_display = 'default';
  renderAvatarPreview();
  updateAvatarDisplayUI();
  updateDashboardAvatar(null);
  schedulePreviewUpdate();
}

// ====== CROPPER ======
function resetCropperButton() {
  const btn = document.getElementById('bio-cropper-confirm');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Use photo';
  }
  const err = document.getElementById('bio-cropper-error');
  if (err) {
    err.style.display = 'none';
    err.textContent = '';
  }
}

function openCropper(input, target, linkId) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 25 * 1024 * 1024) {
    alert('Image too large (max 25MB). Please pick a smaller file.');
    input.value = '';
    return;
  }
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file.');
    input.value = '';
    return;
  }
  // Always reset the confirm button + error in case previous upload failed or hung
  resetCropperButton();
  bioCropSource = file;
  // Targets: 'avatar' (1:1), 'headshot' (1:1), or featured {type, linkId} (16:9)
  if (target === 'avatar' || target === 'headshot') {
    bioCropTarget = target;
  } else {
    bioCropTarget = { type: 'featured', linkId };
  }
  const reader = new FileReader();
  reader.onload = e => {
    const modal = document.getElementById('bio-cropper-modal');
    modal.style.display = 'flex';
    const img = document.getElementById('bio-cropper-img');
    img.src = e.target.result;
    if (bioCropper) { bioCropper.destroy(); bioCropper = null; }
    // Wait for image to load before initializing cropper
    img.onload = () => {
      const is1to1 = (target === 'avatar' || target === 'headshot');
      bioCropper = new Cropper(img, {
        aspectRatio: is1to1 ? 1 : 16/9,
        viewMode: 1,
        background: false,
        autoCropArea: 1,
        movable: true,
        zoomable: true,
        scalable: false,
        rotatable: false,
      });
    };
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function closeCropper() {
  if (bioCropper) { bioCropper.destroy(); bioCropper = null; }
  document.getElementById('bio-cropper-modal').style.display = 'none';
  resetCropperButton();
  bioCropSource = null;
  bioCropTarget = null;
}

async function confirmCrop() {
  if (!bioCropper || !currentUser) return;
  const isAvatar = bioCropTarget === 'avatar';
  const isHeadshot = bioCropTarget === 'headshot';
  // Sizes: avatar 800x800, headshot 600x600, featured 800x450
  const targetW = isAvatar ? 800 : isHeadshot ? 600 : 800;
  const targetH = isAvatar ? 800 : isHeadshot ? 600 : 450;
  const btn = document.getElementById('bio-cropper-confirm');
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  const err = document.getElementById('bio-cropper-error');
  err.style.display = 'none';

  try {
    const canvas = bioCropper.getCroppedCanvas({ width: targetW, height: targetH, imageSmoothingQuality: 'high' });
    if (!canvas) throw new Error('Could not read cropped image. Try a different photo.');

    // Convert canvas to WebP blob, with a 15-second safety timeout
    const blob = await Promise.race([
      new Promise((resolve, reject) => {
        canvas.toBlob(b => {
          if (b) resolve(b);
          else reject(new Error('Browser could not encode image. Try a PNG or JPEG.'));
        }, 'image/webp', 0.85);
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Image processing timed out.')), 15000))
    ]);

    if (!blob) throw new Error('Could not process image.');

    // Choose bucket + filename based on target
    const bucket = isHeadshot ? 'media-kit-photos' : 'bio-photos';
    const kind = isAvatar ? 'avatar' : isHeadshot ? 'headshot' : 'featured';
    const fileName = `${currentUser.id}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2,8)}.webp`;

    const { error: upErr } = await sb.storage.from(bucket).upload(fileName, blob, {
      contentType: 'image/webp',
      upsert: false
    });
    if (upErr) throw new Error(upErr.message || 'Upload rejected. Please try again.');

    const { data: urlData } = sb.storage.from(bucket).getPublicUrl(fileName);
    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) throw new Error('Could not get photo URL.');

    if (isAvatar) {
      if (bioState.avatar_url) bioStalePhotos.push(bioState.avatar_url);
      bioState.avatar_url = publicUrl;
      renderAvatarPreview();
      updateAvatarDisplayUI();
      updateDashboardAvatar(publicUrl);
      schedulePreviewUpdate();
    } else if (isHeadshot) {
      if (mkState.headshot_url) mkStalePhotos.push(mkState.headshot_url);
      mkState.headshot_url = publicUrl;
      renderMKHeadshotPreview();
      scheduleMKPreview();
    } else {
      const link = bioState.links.find(l => l._id === bioCropTarget.linkId);
      if (link) {
        if (link.photoUrl) bioStalePhotos.push(link.photoUrl);
        link.photoUrl = publicUrl;
      }
      renderBioLinks();
      schedulePreviewUpdate();
    }
    closeCropper();
  } catch (e) {
    console.error('Upload error:', e);
    err.textContent = e.message || 'Upload failed. Please try again.';
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Use photo';
  }
}

// Delete stale photos from Supabase Storage (old avatars, removed featured photos)
// Delete any photos in the user's bio-photos folder that are NOT currently
// referenced in bioState (avatar + any featured link photos).
// This handles both "replaced photo" and "abandoned upload" orphan cases.
async function deleteStalePhotos() {
  if (!currentUser) return;
  try {
    // List all files in the user's bio-photos folder
    const { data: files, error: listErr } = await sb.storage.from('bio-photos').list(currentUser.id, { limit: 100 });
    if (listErr || !Array.isArray(files)) {
      bioStalePhotos = [];
      return;
    }
    // Build the set of photos currently in use
    const inUse = new Set();
    const extractPath = (url) => {
      if (!url) return null;
      const m = url.match(/bio-photos\/(.+)$/);
      return m ? m[1] : null;
    };
    const addInUse = (url) => {
      const p = extractPath(url);
      if (p) inUse.add(p);
    };
    addInUse(bioState.avatar_url);
    // Include featured, hero, AND regular link photos as in-use
    bioState.links.forEach(l => {
      if (l.photoUrl) addInUse(l.photoUrl);
    });

    // Any file not in the in-use set is stale and safe to delete
    const toDelete = files
      .map(f => `${currentUser.id}/${f.name}`)
      .filter(path => !inUse.has(path));

    if (toDelete.length > 0) {
      await sb.storage.from('bio-photos').remove(toDelete);
    }
  } catch (e) {
    console.warn('Failed to cleanup stale photos', e);
  }
  bioStalePhotos = [];
}

// ====== SAVE / PUBLISH ======
function showBioStatus(kind, msg) {
  const el = document.getElementById('bio-save-status');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = kind === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(74,222,128,0.1)';
  el.style.color = kind === 'error' ? '#f87171' : '#4ade80';
  el.style.border = '1px solid ' + (kind === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(74,222,128,0.3)');
  el.textContent = msg;
  setTimeout(() => {
    if (el.textContent === msg) el.style.display = 'none';
  }, 5000);
}

async function saveBio() {
  if (!currentUser) return;
  const btn = document.getElementById('bio-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    // Validate username if one is entered (required if they want to publish, optional as draft)
    const uname = bioState.username.trim();
    if (!uname && bioOriginalUsername) {
      throw new Error('Username cannot be removed once set.');
    }
    if (uname) {
      if (uname.length < 3) throw new Error('Username must be at least 3 characters.');
      if (!/^[a-z0-9_]+$/.test(uname)) throw new Error('Username: lowercase letters, numbers, underscore only.');
      if (BIO_RESERVED.has(uname)) throw new Error('That username is reserved.');
      if (window.RyxaUsernameFilter && !window.RyxaUsernameFilter.isUsernameClean(uname)) {
        throw new Error('That username is not allowed. Please pick another.');
      }
    }

    // Username upsert (if changed or not set)
    if (uname && uname !== bioOriginalUsername) {
      // Rate limit: 2 changes per 7 days
      const { allowed, remaining, changes } = await checkUsernameChangeLimit();
      if (!allowed) {
        const nextDate = formatNextChangeDate(changes);
        throw new Error(`You've reached the max username changes. Try again on ${nextDate}.`);
      }
      // Check availability
      const { data: existing } = await sb.from('public_profiles').select('user_id').eq('username', uname).maybeSingle();
      if (existing && existing.user_id !== currentUser.id) {
        throw new Error('That username is already taken.');
      }
      const { error: upErr } = await sb.from('profiles').upsert({
        user_id: currentUser.id, username: uname
      }, { onConflict: 'user_id' });
      if (upErr) throw upErr;
      await recordUsernameChange();
      bioOriginalUsername = uname;
      // Update topbar bio link
      window._ryx_username = uname;
      var bioLinkEl = document.getElementById('topbar-bio-link');
      if (bioLinkEl) bioLinkEl.textContent = 'ryxa.io/' + uname;
      var bioLinkMobile = document.getElementById('ana-bio-link');
      if (bioLinkMobile) bioLinkMobile.textContent = 'ryxa.io/' + uname;
      showBioLinkButtons();
    }

    // Clean links/videos before save: strip internal _id, require URL for links
    const normalizeUrl = (u) => {
      const s = (u || '').trim();
      if (!s) return '';
      // If already has a scheme, leave as-is; otherwise prepend https://
      if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
      return 'https://' + s;
    };
    const cleanLinks = bioState.links
      .filter(l => (l.title || '').trim() || (l.url || '').trim() || l.isVideoBlock || l.isTikTokBlock || l.isInstagramBlock || l.isSpotifyBlock || l.isHeader || l.isSubscribe || l.isMediaKit)
      .map(l => ({
        title: (l.title || '').slice(0, 80),
        description: (l.description || '').slice(0, 120),
        url: normalizeUrl(l.url),
        featured: !!l.featured,
        photoUrl: l.photoUrl || '',
        ...(l.isMediaKit ? { isMediaKit: true } : {}),
        ...(l.isHero ? { isHero: true } : {}),
        ...(l.isHeader ? { isHeader: true } : {}),
        ...(l.isCourse ? { isCourse: true, courseId: l.courseId, coursePrice: l.coursePrice || 0, courseCrossoutPrice: l.courseCrossoutPrice || 0 } : {}),
        ...(l.isCoaching ? { isCoaching: true, coachingId: l.coachingId, coachingPrice: l.coachingPrice || 0 } : {}),
        ...(l.isProduct ? { isProduct: true, productId: l.productId, productPrice: l.productPrice || 0 } : {}),
        ...(l.halfWidth ? { halfWidth: true } : {}),
        ...(l.isSubscribe ? { isSubscribe: true } : {}),
        // Video block — array of YouTube URLs (capped at 5 by the editor).
        // Filter out empty/blank URL slots so the saved payload never carries
        // partially-filled rows.
        ...(l.isVideoBlock ? {
          isVideoBlock: true,
          videos: (Array.isArray(l.videos) ? l.videos : [])
            .map(v => ({ url: (v && v.url ? v.url : '').trim() }))
            .filter(v => v.url)
            .slice(0, 10)
        } : {}),
        ...(l.isTikTokBlock ? {
          isTikTokBlock: true,
          videos: (Array.isArray(l.videos) ? l.videos : [])
            .map(v => ({ url: (v && v.url ? v.url : '').trim() }))
            .filter(v => v.url)
            .slice(0, 10)
        } : {}),
        ...(l.isInstagramBlock ? {
          isInstagramBlock: true,
          videos: (Array.isArray(l.videos) ? l.videos : [])
            .map(v => ({ url: (v && v.url ? v.url : '').trim() }))
            .filter(v => v.url)
            .slice(0, 10)
        } : {}),
        ...(l.isSpotifyBlock ? { isSpotifyBlock: true } : {}),
      }));
    // Old top-level videos array is no longer used — videos now live inside
    // isVideoBlock entries in `links`. Always write empty so legacy data clears.
    const cleanVideos = [];

    const payload = {
      user_id: currentUser.id,
      display_name: bioState.display_name || null,
      bio: bioState.bio || null,
      avatar_url: bioState.avatar_url || null,
      avatar_display: isPro() ? (bioState.avatar_display || 'default') : 'default',
      theme: (() => {
        // Defense-in-depth: Free users cannot save a Pro theme
        const chosen = BIO_THEMES.find(x => x.key === bioState.theme);
        if (!chosen) return 'purple';
        if (chosen.pro && !isPro()) return 'purple';
        if (chosen.max && !isMax()) return 'purple';
        return bioState.theme;
      })(),
      font_family: (() => {
        // Validate against the allowed font list. Falls back to default if unknown.
        const f = BIO_FONTS.find(x => x.key === bioState.font_family);
        return f ? f.key : 'DM Sans';
      })(),
      socials: bioState.socials,
      links: cleanLinks,
      videos: cleanVideos,
      published: bioState.published,
      // Free users cannot hide branding — force true regardless of client state
      show_branding: isPro() ? !!bioState.show_branding : true,
      // Sensitive content flag — available to all tiers (safety feature, not gated)
      sensitive_content: !!bioState.sensitive_content,
      // Pro users can save custom_theme. Preserve for downgraded users but blank-out on write for non-Pro to avoid RLS overreach
      custom_theme: isPro() ? (bioState.custom_theme || null) : (bioState.custom_theme || null),
    };
    const { error } = await sb.from('link_in_bio').upsert(payload, { onConflict: 'user_id' });
    if (error) throw error;

    await deleteStalePhotos();
    await deleteStaleBios();

    updatePublishUI();
    showBioStatus('success', 'Saved ✓');
    // Re-render username hint so "Press save to change username" disappears
    if (bioState.username) renderUsernameAvailable(bioState.username);
  } catch (e) {
    console.error(e);
    showBioStatus('error', e.message || 'Save failed.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// Delete queued stale background URLs from storage
async function deleteStaleBios() {
  if (!bioStaleBgs.length) return;
  const paths = bioStaleBgs
    .map(url => {
      // Extract storage path from public URL
      const m = url.match(/\/bio-backgrounds\/(.+)$/);
      return m ? m[1] : null;
    })
    .filter(Boolean);
  if (paths.length) {
    try { await sb.storage.from('bio-backgrounds').remove(paths); } catch (e) { console.warn('bg cleanup', e); }
  }
  bioStaleBgs = [];
}

async function togglePublish() {
  if (!currentUser) return;
  const wantPublish = !bioState.published;
  if (wantPublish) {
    if (!bioState.username) { showBioStatus('error', 'Pick a username first.'); return; }
    if (bioState.username.length < 3) { showBioStatus('error', 'Username must be at least 3 characters.'); return; }
    if (BIO_RESERVED.has(bioState.username)) { showBioStatus('error', 'That username is reserved.'); return; }
    if (window.RyxaUsernameFilter && !window.RyxaUsernameFilter.isUsernameClean(bioState.username)) { showBioStatus('error', 'That username is not allowed. Please pick another.'); return; }
  }
  const btn = document.getElementById('bio-publish-btn');
  btn.disabled = true;
  btn.textContent = wantPublish ? 'Publishing…' : 'Unpublishing…';
  try {
    bioState.published = wantPublish;
    await saveBio();
    updatePublishUI();
    showBioStatus('success', wantPublish ? 'Your page is live 🎉' : 'Page unpublished.');
  } catch (e) {
    bioState.published = !wantPublish;
    showBioStatus('error', 'Failed to ' + (wantPublish ? 'publish' : 'unpublish'));
  } finally {
    btn.disabled = false;
    updatePublishUI();
  }
}

function updatePublishUI() {
  const dot = document.getElementById('bio-status-dot');
  const label = document.getElementById('bio-status-label');
  const sub = document.getElementById('bio-status-sub');
  const btn = document.getElementById('bio-publish-btn');
  const viewLink = document.getElementById('bio-view-live');
  if (bioState.published) {
    dot.style.background = '#4ade80';
    label.textContent = 'Published';
    sub.innerHTML = bioState.username
      ? 'Live at <strong class="bio-s-313aee">ryxa.io/' + bioState.username + '</strong> <button type="button" data-bio-action="copy-bio-link" data-bio-url="https://ryxa.io/' + bioState.username + '" class="bio-s-eaca75">Copy</button>'
      : 'Your page is live.';
    btn.textContent = 'Unpublish';
    btn.style.background = 'transparent';
    btn.style.border = '1px solid var(--border-hover)';
    btn.style.color = 'var(--muted)';
    if (viewLink && bioState.username) {
      var bioFullUrl = 'https://www.ryxa.io/' + bioState.username;
      if (isPwaMode) {
        viewLink.href = '#';
        viewLink.removeAttribute('target');
        viewLink.textContent = 'Copy link';
        viewLink.onclick = function(e) {
          e.preventDefault();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(bioFullUrl).then(function() {
              viewLink.textContent = 'Copied!';
              setTimeout(function() { viewLink.textContent = 'Copy link'; }, 1500);
            }).catch(function() { fallbackCopy(bioFullUrl); viewLink.textContent = 'Copied!'; setTimeout(function() { viewLink.textContent = 'Copy link'; }, 1500); });
          } else {
            fallbackCopy(bioFullUrl);
            viewLink.textContent = 'Copied!';
            setTimeout(function() { viewLink.textContent = 'Copy link'; }, 1500);
          }
        };
      } else {
        viewLink.href = '/' + bioState.username;
        viewLink.setAttribute('target', '_blank');
        viewLink.textContent = 'View live page \u2197';
        viewLink.onclick = null;
      }
      viewLink.style.display = 'inline-flex';
    }
  } else {
    dot.style.background = 'var(--muted2)';
    label.textContent = 'Not published';
    sub.textContent = "Your page isn't live yet. Publish to share it.";
    btn.textContent = 'Publish';
    btn.style.background = 'var(--accent)';
    btn.style.border = 'none';
    btn.style.color = '#fff';
    if (viewLink) viewLink.style.display = 'none';
  }
}

// ====== LIVE PREVIEW ======
function schedulePreviewUpdate() {
  clearTimeout(bioPreviewTimer);
  bioPreviewTimer = setTimeout(updateBioPreview, 200);
}

function updateBioPreview() {
  const iframe = document.getElementById('bio-preview-iframe');
  if (!iframe) return;
  iframe.srcdoc = buildPreviewHTML();
}

// Verified blue check for the editor preview (mirrors the public renderers).
function nameWithBadge(rawName, badge) {
  const n = rawName || '';
  if (!badge) return escapeHtml(n);
  const i = n.lastIndexOf(' ');
  if (i === -1) return `<span style="white-space:nowrap;">${escapeHtml(n)}${badge}</span>`;
  return `${escapeHtml(n.slice(0, i + 1))}<span style="white-space:nowrap;">${escapeHtml(n.slice(i + 1))}${badge}</span>`;
}

function bioPreviewVerifiedBadge() {
  return ' <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Verified" width="0.9em" height="0.9em" style="display:inline-block;vertical-align:-0.1em;flex-shrink:0;">' +
    '<title>This profile is verified as belonging to the creator</title>' +
    '<g>' +
    '<circle cx="24.00" cy="8.70" r="4.4" fill="#1d9bf0"/><circle cx="30.64" cy="10.22" r="4.4" fill="#1d9bf0"/>' +
    '<circle cx="35.96" cy="14.46" r="4.4" fill="#1d9bf0"/><circle cx="38.92" cy="20.60" r="4.4" fill="#1d9bf0"/>' +
    '<circle cx="38.92" cy="27.40" r="4.4" fill="#1d9bf0"/><circle cx="35.96" cy="33.54" r="4.4" fill="#1d9bf0"/>' +
    '<circle cx="30.64" cy="37.78" r="4.4" fill="#1d9bf0"/><circle cx="24.00" cy="39.30" r="4.4" fill="#1d9bf0"/>' +
    '<circle cx="17.36" cy="37.78" r="4.4" fill="#1d9bf0"/><circle cx="12.04" cy="33.54" r="4.4" fill="#1d9bf0"/>' +
    '<circle cx="9.08" cy="27.40" r="4.4" fill="#1d9bf0"/><circle cx="9.08" cy="20.60" r="4.4" fill="#1d9bf0"/>' +
    '<circle cx="12.04" cy="14.46" r="4.4" fill="#1d9bf0"/><circle cx="17.36" cy="10.22" r="4.4" fill="#1d9bf0"/>' +
    '<circle cx="24" cy="24" r="15.4" fill="#1d9bf0"/>' +
    '</g>' +
    '<path d="M15 24.5 L21.2 31 L34 17.8" fill="none" stroke="#0b6db2" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(0.8,1.4)" opacity="0.35"/>' +
    '<path d="M15 24.5 L21.2 31 L34 17.8" fill="none" stroke="#ffffff" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
}

function buildPreviewHTML() {
  const themes = {
    purple:   { bg:'#07070f', surface:'#0f0f1a', surface2:'#161625', text:'#f0eef8', muted:'#b4b2c8', muted2:'#c9c7dc', accent:'#7c3aed', accent2:'#a855f7', glow:'rgba(124,58,237,0.3)', border:'rgba(255,255,255,0.1)', avatarBorder:'linear-gradient(135deg,#a78bfa,#e879f9)' },
    midnight: { bg:'#050508', surface:'#0c0c12', surface2:'#13131b', text:'#f3f4f6', muted:'#c9ccd4', muted2:'#dde0e6', accent:'#4b5563', accent2:'#9ca3af', glow:'rgba(156,163,175,0.25)', border:'rgba(255,255,255,0.09)', avatarBorder:'linear-gradient(135deg,#9ca3af,#e5e7eb)' },
    sunset:   { bg:'#120808', surface:'#1c0e0e', surface2:'#251414', text:'#fff6f0', muted:'#f3c8b2', muted2:'#f7dcca', accent:'#f97316', accent2:'#ec4899', glow:'rgba(249,115,22,0.3)', border:'rgba(255,180,150,0.12)', avatarBorder:'linear-gradient(135deg,#fb923c,#f472b6)' },
    ocean:    { bg:'#040a14', surface:'#0b1424', surface2:'#111d33', text:'#eaf6ff', muted:'#a5c8e0', muted2:'#c3dcf0', accent:'#0891b2', accent2:'#22d3ee', glow:'rgba(34,211,238,0.3)',  border:'rgba(150,200,255,0.12)', avatarBorder:'linear-gradient(135deg,#22d3ee,#60a5fa)' },
    forest:   { bg:'#040a06', surface:'#0b1610', surface2:'#11211a', text:'#eefaf2', muted:'#a8ccb7', muted2:'#c5dfd0', accent:'#10b981', accent2:'#34d399', glow:'rgba(52,211,153,0.3)',  border:'rgba(150,255,180,0.1)',  avatarBorder:'linear-gradient(135deg,#34d399,#a7f3d0)' },
    rose:     { bg:'#140710', surface:'#1e0f1a', surface2:'#2a1624', text:'#fff0f5', muted:'#f0bfd1', muted2:'#f7d5e0', accent:'#e11d48', accent2:'#fb7185', glow:'rgba(251,113,133,0.3)', border:'rgba(255,180,210,0.12)', avatarBorder:'linear-gradient(135deg,#fb7185,#fda4af)' },
    amber:    { bg:'#0f0a04', surface:'#1a1208', surface2:'#251b0e', text:'#fff8ec', muted:'#e7c9a1', muted2:'#f1dcc0', accent:'#d97706', accent2:'#fbbf24', glow:'rgba(251,191,36,0.3)',  border:'rgba(255,210,150,0.12)', avatarBorder:'linear-gradient(135deg,#fbbf24,#fde68a)' },
    crimson:  { bg:'#0f0405', surface:'#1a080a', surface2:'#260c10', text:'#fff0f0', muted:'#ecb9b9', muted2:'#f5d0d0', accent:'#b91c1c', accent2:'#ef4444', glow:'rgba(239,68,68,0.3)',   border:'rgba(255,160,160,0.12)', avatarBorder:'linear-gradient(135deg,#ef4444,#fca5a5)' },
    electric: { bg:'#050814', surface:'#0b1124', surface2:'#111a38', text:'#eaf0ff', muted:'#a8bce0', muted2:'#c5d4ee', accent:'#2563eb', accent2:'#60a5fa', glow:'rgba(96,165,250,0.35)', border:'rgba(150,180,255,0.14)', avatarBorder:'linear-gradient(135deg,#60a5fa,#a5b4fc)' },
    mint:     { bg:'#030e0c', surface:'#0a1a18', surface2:'#102623', text:'#ecfefa', muted:'#a4d6cd', muted2:'#c3e4de', accent:'#0d9488', accent2:'#2dd4bf', glow:'rgba(45,212,191,0.3)',  border:'rgba(150,255,230,0.12)', avatarBorder:'linear-gradient(135deg,#2dd4bf,#a7f3d0)' },
    violet:   { bg:'#0c0418', surface:'#170a26', surface2:'#220f37', text:'#f5ecff', muted:'#c9b8e6', muted2:'#dccdf0', accent:'#6d28d9', accent2:'#c084fc', glow:'rgba(192,132,252,0.3)', border:'rgba(200,170,255,0.12)', avatarBorder:'linear-gradient(135deg,#c084fc,#e9d5ff)' },
    graphite: { bg:'#0a0a0a', surface:'#141414', surface2:'#1e1e1e', text:'#f5f5f5', muted:'#b3b3b3', muted2:'#d1d1d1', accent:'#6b7280', accent2:'#d1d5db', glow:'rgba(209,213,219,0.2)', border:'rgba(255,255,255,0.08)', avatarBorder:'linear-gradient(135deg,#d1d5db,#f3f4f6)' },
  };
  // Build custom theme from bioState.custom_theme if tier allows
  let t;
  let bgImageCSS = '';
  let bgOverlayCSS = '';
  if (bioState.theme === 'custom' && isPro() && bioState.custom_theme) {
    t = buildCustomThemeVars(bioState.custom_theme);
    if (bioState.custom_theme.bgUrl) {
      bgImageCSS = `body::after{content:'';position:fixed;inset:0;background-image:url("${escapeHtml(bioState.custom_theme.bgUrl)}");background-size:cover;background-position:center;z-index:-2;}`;
      const darkness = 1 - (bioState.custom_theme.bgOpacity || 0.4);
      bgOverlayCSS = `body::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,${darkness.toFixed(2)});z-index:-1;}`;
    }
  } else if (isImageTheme(bioState.theme)) {
    // Builtin image theme — same pipeline as custom, but with hardcoded
    // colors and image. Free for all users.
    t = buildImageThemeVars(bioState.theme);
    if (t && t.bgUrl) {
      bgImageCSS = `body::after{content:'';position:fixed;inset:0;background-image:url("${escapeHtml(t.bgUrl)}");background-size:cover;background-position:center;z-index:-2;}`;
      // No overlay — image themes are pre-tuned for legibility without darkening
      bgOverlayCSS = '';
    }
  } else {
    t = themes[bioState.theme] || themes.purple;
  }
  const name = bioState.display_name || bioState.username || 'Your name';
  const initial = (name[0] || '?').toUpperCase();
  const vbadge = (bioVerifyState && bioVerifyState.verified) ? bioPreviewVerifiedBadge() : '';
  const avatarHtml = bioState.avatar_url
    ? `<img src="${escapeHtml(bioState.avatar_url)}" alt="Profile photo" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">`
    : `<div style="width:100%;height:100%;border-radius:50%;background:${t.surface2};display:flex;align-items:center;justify-content:center;font-family:Syne,sans-serif;font-size:36px;font-weight:800;color:${t.text};">${escapeHtml(initial)}</div>`;
  const socialsHtml = buildPreviewSocials(t);
  const linksHtml = bioState.links.filter(l => l.isHeader || l.isSubscribe || l.isVideoBlock || l.isTikTokBlock || l.isInstagramBlock || l.isSpotifyBlock || (l.url || '').trim()).map(l => buildPreviewLink(l, t)).join('');

  // For custom themes with a bg image, we dim the radial glow (since bg image is already bg)
  const glowCSS = ((bioState.theme === 'custom' && isPro() && bioState.custom_theme?.bgUrl) || isImageTheme(bioState.theme))
    ? '' // no radial glow when bg image is set
    : `body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 0%,${t.glow} 0%,transparent 60%);pointer-events:none;z-index:0;}`;

  // Resolve selected font with safe fallback
  const _bioFont = getBioFont(bioState.font_family);
  const _bioFontHref = `https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=${_bioFont.gfont}:wght@${_bioFont.weights}&display=swap`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="${_bioFontHref}" rel="stylesheet">
  <style>
  html{scrollbar-width:thin;scrollbar-color:rgba(124,58,237,0.3) transparent;}
  ::-webkit-scrollbar{width:6px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:rgba(124,58,237,0.3);border-radius:3px;}
  ::-webkit-scrollbar-thumb:hover{background:rgba(124,58,237,0.5);}
  body{margin:0;padding:${(bioState.avatar_display === 'hero' && bioState.avatar_url) ? '0 0' : '40px 18px'} ${bioState.show_branding ? '80px' : '24px'};font-family:'DM Sans',sans-serif;background:${t.bg};color:${t.text};min-height:100vh;}
  /* When user picks a non-default font, force it on every element. With the
     DM Sans default, skip this so the name stays in Syne (matching the public
     bio page's signature heading style). */
  ${(bioState.font_family && bioState.font_family !== 'DM Sans') ? `body, body * { font-family: ${_bioFont.stack} !important; } .banner, .banner *, .brand-banner, .brand-banner * { font-family: 'DM Sans', sans-serif !important; }` : ''}
  ${bgImageCSS}
  ${bgOverlayCSS || glowCSS}
  .w{position:relative;z-index:1;max-width:480px;margin:0 auto;display:flex;flex-direction:column;align-items:center;gap:14px;}
  .hero-wrap{position:relative;overflow:hidden;${(bioState.avatar_display === 'hero' && bioState.avatar_url) ? 'width:100vw;max-width:100vw;margin-left:0;' : ''}}
  .avfr{width:100px;height:100px;border-radius:50%;padding:3px;background:${t.avatarBorder};margin-bottom:6px;}
  .nm{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.4px;text-align:center;word-break:break-word;}
  .bio-line{font-size:13px;color:${t.muted2};text-align:center;line-height:1.4;max-width:340px;word-break:break-word;white-space:pre-line;}
  .socials{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:2px 0 4px;}
  .sb{width:34px;height:34px;border-radius:50%;background:${t.surface};border:1px solid ${t.border};display:flex;align-items:center;justify-content:center;color:${t.text};}
  .sb svg{width:16px;height:16px;fill:currentColor;}
  .links{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:4px;max-width:480px;padding:0 18px;box-sizing:border-box;align-self:center;}
  .links > *{grid-column:span 2;}
  .links > .link-half{grid-column:span 1;}
  /* Half-width thumb-variant: image-on-top + text-below, matches courses/products */
  .lk.lk-thumb.link-half{flex-direction:column;align-items:stretch;min-height:120px;}
  .lk.lk-thumb.link-half .lk-thumb-img{width:100%;height:auto;aspect-ratio:16/9;border-top-left-radius:13px;border-top-right-radius:13px;border-bottom-left-radius:0;}
  .lk.lk-thumb.link-half .lk-thumb-body{flex:1;padding:8px 12px;justify-content:center;}
  /* Half-width text-only link gets a min-height for row alignment */
  .lk.link-half:not(.lk-thumb){min-height:56px;display:flex;flex-direction:column;justify-content:center;}
  /* Half-width preview course/coaching/product cards — column layout matches halves */
  .pcc.link-half{min-height:120px;display:flex;flex-direction:column;}
  .pcc.link-half > div{flex:1;}
  .pcc .pcc-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .pcc.link-half .pcc-body{flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:8px 10px;}
  .pcc.link-half .pcc-title{white-space:normal;text-align:center;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:clip;flex:none;}
  .pcc.link-half .pcc-price{margin-left:0;}
  .hdr{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:${t.text};text-transform:uppercase;letter-spacing:0.1em;text-align:center;padding:14px 8px 6px;opacity:0.85;word-break:break-word;}
  .lk{background:${t.surface};border:1px solid ${t.border};border-radius:13px;padding:14px 18px;color:${t.text};text-align:center;}
  .lk-t{font-size:14px;font-weight:600;}
  .lk-d{font-size:12px;color:${t.muted};line-height:1.4;margin-top:2px;word-break:break-word;}
  .lk.lk-thumb{display:flex;flex-direction:row;align-items:stretch;padding:0;overflow:hidden;min-height:46px;}
  .lk-thumb-img{align-self:stretch;width:46px;height:auto;object-fit:cover;flex-shrink:0;display:block;border-top-left-radius:13px;border-bottom-left-radius:13px;}
  .lk-thumb-body{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:8px 18px;gap:2px;}
  .fl{background:${t.surface};border:1px solid ${t.border};border-radius:16px;overflow:hidden;}
  .fl img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:${t.surface2};}
  .fl-b{padding:14px 18px 16px;text-align:center;}
  .fl-t{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;letter-spacing:-0.2px;word-break:break-word;}
  .fl-d{font-size:12px;color:${t.muted};line-height:1.4;margin-top:3px;word-break:break-word;}
  .mkh{position:relative;border-radius:14px;overflow:hidden;min-height:90px;background:#000;border:1px solid ${t.accent};box-shadow:0 0 20px ${t.glow};}
  .mkh-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;display:block;}
  .mkh-ov{position:absolute;inset:0;z-index:1;background:linear-gradient(135deg,rgba(0,0,0,0.65) 0%,rgba(0,0,0,0.55) 50%,rgba(124,58,237,0.45) 100%);}
  .mkh-c{position:relative;z-index:2;display:flex;align-items:center;gap:12px;padding:18px 18px;}
  .mkh-i{width:20px;height:20px;color:#fff;flex-shrink:0;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5));}
  .mkh-b{flex:1;min-width:0;}
  .mkh-t{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.4);letter-spacing:-0.2px;}
  .mkh-d{font-size:12px;color:rgba(255,255,255,0.85);text-shadow:0 1px 3px rgba(0,0,0,0.4);line-height:1.4;margin-top:3px;word-break:break-word;}
  .hl{position:relative;border-radius:14px;overflow:hidden;aspect-ratio:3/2;background:#000;border:1px solid ${t.accent};box-shadow:0 0 22px 2px ${t.glow};animation:heroGlow 3s ease-in-out infinite,heroNudge 5s ease-in-out infinite;will-change:transform;}
  .hl::after{content:'';position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(115deg,transparent 35%,${t.accent2} 47%,rgba(255,255,255,0.4) 50%,${t.accent2} 53%,transparent 65%);background-size:220% 100%;background-repeat:no-repeat;background-position:150% 0;mix-blend-mode:screen;opacity:0.6;animation:heroSheen 5s ease-in-out infinite;}
  .hl:hover{animation:none;transform:translateY(-3px);border-color:${t.accent2};box-shadow:0 0 38px 4px ${t.glow};}
  @keyframes heroGlow{0%,100%{box-shadow:0 0 15px 1px ${t.glow};}50%{box-shadow:0 0 38px 5px ${t.glow};}}
  @keyframes heroSheen{0%,55%{background-position:150% 0;}82%,100%{background-position:-90% 0;}}
  @keyframes heroNudge{0%,80%,100%{transform:rotate(0deg);}86%{transform:rotate(-2.5deg);}92%{transform:rotate(1.6deg);}97%{transform:rotate(-0.6deg);}}
  @media (prefers-reduced-motion:reduce){.hl{animation:none;}.hl::after{animation:none;opacity:0;}}
  .hl-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;display:block;}
  .hl-ov{position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(0,0,0,0.15) 0%,rgba(0,0,0,0.65) 100%);}
  .hl-c{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;padding:20px;justify-content:flex-end;}
  .hl-t{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,0.5);letter-spacing:-0.3px;}
  .hl-d{font-size:13px;color:rgba(255,255,255,0.9);text-shadow:0 1px 4px rgba(0,0,0,0.5);line-height:1.35;margin-top:4px;word-break:break-word;}
  .vids{width:100%;position:relative;}
  .vids-r{display:flex;align-items:center;gap:10px;padding:2px 0;overflow-x:auto;scrollbar-width:none;}
  .vids-r::-webkit-scrollbar{display:none;}
  .vc{flex:0 0 270px;background:${t.surface};border:1px solid ${t.border};border-radius:12px;overflow:hidden;}
  .vc.vc-vertical{flex-basis:200px;}
  .vc img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:${t.surface2};}
  .vc.vc-vertical img{aspect-ratio:9/16;}
  /* Preview arrow buttons — small since the preview is itself small */
  .vids-arrow{position:absolute;top:50%;transform:translateY(-50%);width:28px;height:28px;border-radius:50%;border:1px solid ${t.border};background:${t.surface};color:${t.text};cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2;box-shadow:0 2px 6px rgba(0,0,0,0.2);padding:0;transition:opacity 0.15s,background 0.15s;}
  .vids-arrow:hover{background:${t.surface2};}
  .vids-arrow:disabled{opacity:0.35;cursor:default;}
  .vids-arrow:disabled:hover{background:${t.surface};}
  .vids-arrow-l{left:2px;}
  .vids-arrow-r{right:2px;}
  .banner{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);padding:12px 24px;background:#0a0a14;border:1px solid ${t.border};border-radius:100px;font-size:13px;color:rgba(255,255,255,0.7);text-decoration:none;display:inline-flex;align-items:center;gap:10px;z-index:100;box-shadow:0 4px 20px rgba(0,0,0,0.3);white-space:nowrap;}
  .banner strong{color:#fff;font-weight:600;}
  .banner img{width:18px;height:18px;border-radius:4px;}
  /* Hero avatar display */
  .hero-wrap{position:relative;width:100%;margin-bottom:0;border-radius:0;overflow:hidden;}
  .hero-img{width:100%;aspect-ratio:1/1;object-fit:cover;object-position:center top;display:block;-webkit-mask-image:linear-gradient(to bottom,black 0%,black 55%,transparent 100%);mask-image:linear-gradient(to bottom,black 0%,black 55%,transparent 100%);}
  .hero-fade{display:none;}
  .hero-info{position:absolute;bottom:-30px;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:6px;z-index:2;padding:0 20px 0;}
  .hero-info .nm{text-shadow:0 2px 10px rgba(0,0,0,0.6);}
  .hero-info .bio-line{text-shadow:0 1px 6px rgba(0,0,0,0.5);}
  .hero-info .sb{background:rgba(0,0,0,0.35);border-color:rgba(255,255,255,0.2);backdrop-filter:blur(6px);}
  .hero-info{display:none;}
  .hero-below{margin-top:-60px;position:relative;z-index:3;display:flex;flex-direction:column;align-items:center;gap:3px;padding:0 18px;width:100%;box-sizing:border-box;}
  </style></head><body>
  <div class="w">
    ${(bioState.avatar_display === 'hero' && bioState.avatar_url) ? `
    <div class="hero-wrap">
      <img class="hero-img" src="${escapeHtml(bioState.avatar_url)}" alt="Profile photo">
      <div class="hero-fade"></div>
    </div>
    <div class="hero-below">
      <div class="nm">${nameWithBadge(name, vbadge)}</div>
      ${socialsHtml}
      ${bioState.bio ? `<div class="bio-line">${escapeHtml(bioState.bio)}</div>` : ''}
    </div>` : `
    <div class="avfr">${avatarHtml}</div>
    <div class="nm">${nameWithBadge(name, vbadge)}</div>
    ${socialsHtml}
    ${bioState.bio ? `<div class="bio-line">${escapeHtml(bioState.bio)}</div>` : ''}`}
    ${linksHtml ? `<div class="links">${linksHtml}</div>` : ''}
    ${bioState.show_branding ? '<div class="banner"><img src="logo.png" alt="Ryxa"><span>Get your free link-in-bio at <strong>Ryxa</strong></span></div>' : ''}
  </div>
  <\u0073cript src="/js/bio-preview-runtime.js"></\u0073cript>
</body></html>`;
}

function buildPreviewSocials(t) {
  const items = BIO_SOCIAL_FIELDS
    .filter(f => (bioState.socials[f.key] || '').trim())
    .map(f => `<div class="sb">${f.svg}</div>`);
  return items.length ? `<div class="socials">${items.join('')}</div>` : '';
}

function buildPreviewLink(l, t) {
  // Half-width modifier — applies the .link-half class on the four eligible
  // link types so the preview matches the public bio's grid layout.
  const halfClass = l.halfWidth ? 'link-half' : '';
  // Header — text divider, no link, no clickable target
  if (l.isHeader) {
    if (!l.title) return '';
    return `<div class="hdr">${escapeHtml(l.title)}</div>`;
  }
  // Subscribe block
  if (l.isSubscribe) {
    return `<div style="background:${t.surface};border:1px solid ${t.border};border-radius:10px;padding:14px;text-align:center;margin-bottom:8px;">
      <div style="font-size:11px;font-weight:600;color:${t.text};margin-bottom:8px;">${escapeHtml(l.title || 'Subscribe to my newsletter')}</div>
      <div style="display:flex;gap:4px;">
        <div style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid ${t.border};background:${t.bg};color:${t.muted};font-size:9px;text-align:left;">Your email</div>
        <div style="padding:6px 10px;background:${t.accent};color:#fff;border-radius:6px;font-size:9px;font-weight:600;">Subscribe</div>
      </div>
    </div>`;
  }

  // Video block — horizontal-scrollable carousel of up to 10 YouTube thumbnails.
  // Renders as a child of .links and respects the link's drag order, so when
  // the creator reorders, the entire carousel moves with it.
  if (l.isVideoBlock) {
    const videos = Array.isArray(l.videos) ? l.videos : [];
    const cards = videos.map(v => {
      const id = extractYouTubeIdDash(v && v.url);
      if (!id) return '';
      const vert = isShortsUrl(v && v.url);
      return `<div class="vc${vert ? ' vc-vertical' : ''}"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="YouTube video thumbnail" data-bio-onerror="fallback-src" data-bio-fallback-src="https://i.ytimg.com/vi/${id}/default.jpg"></div>`;
    }).filter(Boolean).join('');
    if (!cards) {
      // Empty placeholder — only shown in editor preview when a block was just
      // added with no URLs yet
      return `<div style="background:${t.surface};border:1px dashed ${t.border};border-radius:10px;padding:14px;text-align:center;color:${t.muted};font-size:11px;">YouTube videos will appear here</div>`;
    }
    return `<div class="vids">
      <button type="button" class="vids-arrow vids-arrow-l" aria-label="Scroll left" tabindex="-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></button>
      <button type="button" class="vids-arrow vids-arrow-r" aria-label="Scroll right" tabindex="-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>
      <div class="vids-r">${cards}</div>
    </div>`;
  }
  if (l.isTikTokBlock) {
    const videos = Array.isArray(l.videos) ? l.videos : [];
    const cards = videos.map(v => {
      const id = extractTikTokId(v && v.url);
      if (!id) return '';
      // Resolve the real thumbnail via /api/tiktok-oembed (cached per session).
      // Until it arrives, show a lightweight branded placeholder. The live page
      // always embeds the real player; we avoid loading iframes in the editor.
      ensureTikTokThumb(v.url);
      const thumb = tiktokThumbCache[v.url];
      if (thumb) {
        return `<div class="vc vc-vertical"><img src="${escapeHtml(thumb)}" alt="TikTok video thumbnail" data-bio-onerror="hide-thumb-bg"></div>`;
      }
      return `<div class="vc vc-vertical"><div style="width:100%;aspect-ratio:9/16;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:#111;color:#fff;font-size:10px;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
        TikTok</div></div>`;
    }).filter(Boolean).join('');
    if (!cards) {
      return `<div style="background:${t.surface};border:1px dashed ${t.border};border-radius:10px;padding:14px;text-align:center;color:${t.muted};font-size:11px;">TikTok videos will appear here</div>`;
    }
    return `<div class="vids">
      <button type="button" class="vids-arrow vids-arrow-l" aria-label="Scroll left" tabindex="-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></button>
      <button type="button" class="vids-arrow vids-arrow-r" aria-label="Scroll right" tabindex="-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>
      <div class="vids-r">${cards}</div>
    </div>`;
  }
  if (l.isSpotifyBlock) {
    const sp = extractSpotify(l.url);
    if (!sp) {
      // No valid link yet — show a branded placeholder so the slot is visible.
      return `<div style="background:#191414;border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:10px;color:#fff;font-size:12px;">
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1DB954"/><path d="M6.4 9.3c3.6-1.05 7.7-0.72 10.8 1.05" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M7 12.6c3-0.85 6.2-0.5 8.7 1.0" stroke="#fff" stroke-width="1.35" fill="none" stroke-linecap="round"/><path d="M7.5 15.7c2.4-0.62 4.8-0.4 6.7 0.8" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>
        <span>Spotify &middot; Add a Spotify link</span>
      </div>`;
    }
    // Real player. The preview rebuilds on edits so it reloads then; that's
    // cosmetic. Allowed via open.spotify.com in the dashboard frame-src.
    const tall = (sp.type === 'album' || sp.type === 'playlist' || sp.type === 'artist' || sp.type === 'show');
    const h = tall ? 352 : 152;
    return `<div style="width:100%;height:${h}px;border-radius:12px;overflow:hidden;">
      <iframe src="https://open.spotify.com/embed/${sp.type}/${sp.id}" loading="lazy" title="Spotify player" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" style="width:100%;height:100%;border:0;display:block;"></iframe>
    </div>`;
  }
  if (l.isInstagramBlock) {
    const videos = Array.isArray(l.videos) ? l.videos : [];
    const cards = videos.map(v => {
      const id = extractInstagramId(v && v.url);
      if (!id) return '';
      // Preview shows a branded placeholder; the live page embeds the real
      // Instagram card (loading IG iframes in the editor is heavy + CSP-blocked).
      return `<div class="vc vc-vertical"><div style="width:100%;aspect-ratio:3/5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:#1a1320;color:#fff;font-size:10px;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.6"/></svg>
        Instagram</div></div>`;
    }).filter(Boolean).join('');
    if (!cards) {
      return `<div style="background:${t.surface};border:1px dashed ${t.border};border-radius:10px;padding:14px;text-align:center;color:${t.muted};font-size:11px;">Instagram reels will appear here</div>`;
    }
    return `<div class="vids">
      <button type="button" class="vids-arrow vids-arrow-l" aria-label="Scroll left" tabindex="-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></button>
      <button type="button" class="vids-arrow vids-arrow-r" aria-label="Scroll right" tabindex="-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>
      <div class="vids-r">${cards}</div>
    </div>`;
  }
  if (l.isHero && l.photoUrl) {
    return `<div class="hl">
      <img class="hl-bg" src="${escapeHtml(l.photoUrl)}" alt="Link background">
      <div class="hl-ov"></div>
      <div class="hl-c">
        <div class="hl-t">${escapeHtml(l.title || 'Untitled')}</div>
        ${l.description ? `<div class="hl-d">${escapeHtml(l.description)}</div>` : ''}
      </div>
    </div>`;
  }
  if (l.isCourse) {
    const priceDisplay = l.coursePrice > 0 ? formatMoney(l.coursePrice, {alwaysShowCents:true}) : 'Free';
    const crossoutHtml = l.courseCrossoutPrice > 0 ? `<span style="text-decoration:line-through;color:${t.muted};font-size:11px;margin-right:4px;">${formatMoney(l.courseCrossoutPrice, {alwaysShowCents:true})}</span>` : '';
    const coverHtml = l.photoUrl ? `<img src="${escapeHtml(l.photoUrl)}" alt="Link cover" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px 8px 0 0;">` : '';
    return `<div class="pcc ${halfClass}" style="background:${t.surface};border:1px solid ${t.border};border-radius:10px;overflow:hidden;">
      ${coverHtml}
      <div class="pcc-body" style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;" >
        <div style="min-width:0;flex:1;">
          <div class="pcc-title" style="font-size:12px;font-weight:600;color:${t.text};">${escapeHtml(l.title || 'Untitled')}</div>
        </div>
        <div class="pcc-price" style="font-size:12px;font-weight:600;color:${t.text};flex-shrink:0;margin-left:8px;">${crossoutHtml}${priceDisplay}</div>
      </div>
    </div>`;
  }
  if (l.isCoaching) {
    const priceDisplay = l.coachingPrice > 0 ? formatMoney(l.coachingPrice, {alwaysShowCents:true}) : 'Free';
    const coverHtml = l.photoUrl ? `<img src="${escapeHtml(l.photoUrl)}" alt="Link cover" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px 8px 0 0;">` : '';
    return `<div class="pcc ${halfClass}" style="background:${t.surface};border:1px solid ${t.border};border-radius:10px;overflow:hidden;">
      ${coverHtml}
      <div class="pcc-body" style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;" >
        <div style="min-width:0;flex:1;">
          <div class="pcc-title" style="font-size:12px;font-weight:600;color:${t.text};">${escapeHtml(l.title || 'Untitled')}</div>
        </div>
        <div class="pcc-price" style="font-size:12px;font-weight:600;color:${t.text};flex-shrink:0;margin-left:8px;">${priceDisplay}</div>
      </div>
    </div>`;
  }
  if (l.isProduct) {
    const priceDisplay = l.productPrice > 0 ? formatMoney(l.productPrice, {alwaysShowCents:true}) : 'Free';
    const coverHtml = l.photoUrl ? `<img src="${escapeHtml(l.photoUrl)}" alt="Link cover" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px 8px 0 0;">` : '';
    return `<div class="pcc ${halfClass}" style="background:${t.surface};border:1px solid ${t.border};border-radius:10px;overflow:hidden;">
      ${coverHtml}
      <div class="pcc-body" style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;" >
        <div style="min-width:0;flex:1;">
          <div class="pcc-title" style="font-size:12px;font-weight:600;color:${t.text};">${escapeHtml(l.title || 'Untitled')}</div>
        </div>
        <div class="pcc-price" style="font-size:12px;font-weight:600;color:${t.text};flex-shrink:0;margin-left:8px;">${priceDisplay}</div>
      </div>
    </div>`;
  }
  if (l.featured && l.photoUrl) {
    return `<div class="fl">
      <img src="${escapeHtml(l.photoUrl)}" alt="Link thumbnail">
      <div class="fl-b">
        <div class="fl-t">${escapeHtml(l.title || 'Untitled')}</div>
        ${l.description ? `<div class="fl-d">${escapeHtml(l.description)}</div>` : ''}
      </div>
    </div>`;
  }
  if (l.isMediaKit && l.photoUrl) {
    return `<div class="mkh">
      <img class="mkh-bg" src="${escapeHtml(l.photoUrl)}" alt="Link background">
      <div class="mkh-ov"></div>
      <div class="mkh-c">
        <svg class="mkh-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="17" x2="8" y2="13"/><line x1="12" y1="17" x2="12" y2="11"/><line x1="16" y1="17" x2="16" y2="15"/></svg>
        <div class="mkh-b">
          <div class="mkh-t">${escapeHtml(l.title || 'Untitled')}</div>
          ${l.description ? `<div class="mkh-d">${escapeHtml(l.description)}</div>` : ''}
        </div>
      </div>
    </div>`;
  }
  if (l.photoUrl && !l.featured && !l.isHero && !l.isCourse && !l.isCoaching && !l.isProduct && !l.isMediaKit) {
    // Seamless thumb-variant: square image flush-left, content centered to the right
    return `<div class="lk lk-thumb ${halfClass}">
      <img src="${escapeHtml(l.photoUrl)}" alt="" class="lk-thumb-img">
      <div class="lk-thumb-body">
        <div class="lk-t">${escapeHtml(l.title || 'Untitled')}</div>
        ${l.description ? `<div class="lk-d">${escapeHtml(l.description)}</div>` : ''}
      </div>
    </div>`;
  }
  return `<div class="lk ${halfClass}">
    <div class="lk-t">${escapeHtml(l.title || 'Untitled')}</div>
    ${l.description ? `<div class="lk-d">${escapeHtml(l.description)}</div>` : ''}
  </div>`;
}

// =====================================================
// MEDIA KIT
// =====================================================
const MK_SOCIAL_PLATFORMS = [
  { key:'instagram', label:'Instagram', urlPrefix:'https://instagram.com/', type:'username', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>' },
  { key:'tiktok', label:'TikTok', urlPrefix:'https://tiktok.com/@', type:'username', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.9a4.85 4.85 0 0 1-1.84-.21Z"/></svg>' },
  { key:'twitter', label:'X', urlPrefix:'https://x.com/', type:'username', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
  { key:'threads', label:'Threads', urlPrefix:'https://threads.net/@', type:'username', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291 1.034-.06 1.995 0 2.917.175-.084-.689-.302-1.235-.646-1.62-.523-.584-1.252-.823-2.196-.734a3.62 3.62 0 0 0-1.907.795l-1.078-1.66c.845-.621 2.027-.964 3.158-.988 1.692-.035 2.979.492 3.853 1.575.781.968 1.147 2.329 1.09 4.039 1.32.639 2.316 1.674 2.854 2.972.768 1.855.82 4.84-1.639 7.245-1.876 1.834-4.215 2.658-7.39 2.678z"/></svg>' },
  { key:'youtube', label:'YouTube', urlPrefix:'', type:'url', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.54 3.58 12 3.58 12 3.58s-7.54 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3 3 0 0 0 2.1 2.12c1.86.5 9.4.5 9.4.5s7.54 0 9.4-.5a3 3 0 0 0 2.1-2.12C24 15.93 24 12 24 12s0-3.93-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"/></svg>' },
  { key:'facebook', label:'Facebook', urlPrefix:'https://facebook.com/', type:'url', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>' },
  { key:'snapchat', label:'Snapchat', urlPrefix:'https://snapchat.com/add/', type:'username', svg:'<svg viewBox="-4.4 -2.25 24 24" aria-hidden="true"><path d="M12.02 0C5.44 0 4.73 5.08 4.86 7.15c.03.5.05 1.01.06 1.52-.3.16-.79.38-1.29.38-.38 0-.75-.14-1.08-.41-.06-.05-.17-.14-.35-.14-.3 0-.65.17-.92.47-.3.34-.3.78.02 1.08.27.26.7.48 1.2.62.68.19 1.56.49 1.79 1.04.13.3-.01.69-.41 1.17a.35.35 0 0 1-.03.03c-.01.02-1.28 2.08-4.21 2.56-.22.04-.38.24-.36.46 0 .05.02.1.04.15.13.3.56.52 1.32.68.08.02.14.11.17.3.03.18.07.4.17.63.1.23.29.35.55.35.14 0 .3-.03.48-.06.25-.05.57-.11.96-.11.22 0 .44.02.68.06.45.07.83.34 1.27.65.63.45 1.35.96 2.43.96.08 0 .17 0 .26-.02.08.01.2.02.33.02 1.08 0 1.8-.51 2.43-.96.44-.31.82-.58 1.27-.65.24-.04.46-.06.68-.06.38 0 .68.05.96.11.2.04.36.06.48.06h.02c.19 0 .41-.08.53-.35.1-.22.14-.43.17-.62.02-.17.09-.28.17-.3.76-.16 1.19-.38 1.32-.68a.43.43 0 0 0 .04-.15c.02-.22-.14-.42-.36-.46-2.93-.48-4.2-2.54-4.21-2.56a.57.57 0 0 1-.03-.03c-.4-.48-.54-.87-.41-1.17.23-.55 1.11-.85 1.79-1.04.5-.14.93-.36 1.2-.62.33-.32.33-.76.03-1.08-.28-.3-.63-.47-.92-.47-.19 0-.3.08-.35.14-.32.26-.69.41-1.08.41-.5 0-.99-.22-1.29-.38.01-.51.03-1.02.06-1.52.13-2.07-.58-7.15-7.16-7.15Z"/></svg>' },
  { key:'linkedin', label:'LinkedIn', urlPrefix:'https://linkedin.com/in/', type:'username', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.26 2.37 4.26 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"/></svg>' },
  { key:'pinterest', label:'Pinterest', urlPrefix:'https://pinterest.com/', type:'username', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>' },
  { key:'twitch', label:'Twitch', urlPrefix:'https://twitch.tv/', type:'username', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>' },
];

const MK_PREDEFINED_RATES = [
  { id:'ig_reel',  label:'Instagram Reel' },
  { id:'ig_post',  label:'Instagram Post' },
  { id:'ig_story', label:'Instagram Story' },
  { id:'tiktok',   label:'TikTok Video' },
  { id:'youtube',  label:'YouTube Video' },
];


// Pulls the latest username from the Link in Bio input (if present) or profiles table,
// then refreshes the publish UI. Called every time the Media Kit tool is reopened.

// ---------- From dashboard.html lines 22618-22683 ----------
function aiBioAssist(textareaId, maxLen) {
  if (typeof isPro === 'function' && !isPro()) {
    showModalAlert('Pro Feature', 'AI Bio Assist is a Pro feature. Upgrade to use it.');
    return;
  }

  var textarea = document.getElementById(textareaId);
  if (!textarea) return;
  var currentText = textarea.value.trim();
  var mode = currentText ? 'improve' : 'generate';

  var overlay = document.createElement('div');
  overlay.id = 'ai-bio-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:440px;width:100%;max-height:calc(100vh - 80px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(124,58,237,0.4) transparent;text-align:center;">'
    + '<svg width="24" height="24" viewBox="0 0 24 24" style="animation:btn-spin 0.6s linear infinite;margin-bottom:12px;" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>'
    + '<div style="font-size:14px;color:var(--text);">' + (mode === 'generate' ? 'Generating bio ideas...' : 'Rewriting your bio...') + '</div>'
    + '</div>';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);

  fetch('/api/ai-bio', {
    method: 'POST',
    headers: getAIHeaders(),
    body: JSON.stringify({ text: currentText, maxLength: maxLen, mode: mode })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) { overlay.remove(); showModalAlert('Error', data.error); return; }

    var sections = data.result.split(/BIO \d+:\n?/i).filter(function(s) { return s.trim(); });
    var cards = sections.map(function(s, i) {
      var bio = s.trim();
      var charCount = bio.length;
      var overLimit = charCount > maxLen;
      return '<div style="padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;text-align:left;">'
        + '<div style="font-size:13px;color:var(--text);line-height:1.6;" id="ai-bio-option-' + i + '">' + escapeHtml(bio) + '</div>'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">'
        + '<span style="font-size:11px;color:' + (overLimit ? '#f87171' : 'var(--muted)') + ';">' + charCount + '/' + maxLen + '</span>'
        + '<span style="display:flex;gap:6px;">'
        + '<button data-bio-action="report-ai-bio" data-bio-option-idx="' + i + '" style="padding:5px 12px;background:transparent;border:1px solid var(--border);color:var(--muted);border-radius:6px;font-size:11px;font-family:DM Sans,sans-serif;cursor:pointer;">Report</button>'
        + '<button data-bio-action="apply-ai-bio" data-bio-textarea-id="' + escapeHtml(textareaId) + '" data-bio-option-idx="' + i + '" style="padding:5px 12px;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);color:#c4b5fd;border-radius:6px;font-size:11px;font-family:DM Sans,sans-serif;cursor:pointer;">Use this</button>'
        + '</span>'
        + '</div>'
        + '</div>';
    }).join('');

    var inner = overlay.querySelector('div');
    inner.style.textAlign = 'left';
    inner.innerHTML = '<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:800;letter-spacing:-0.3px;margin-bottom:6px;">AI Bio Suggestions</div>'
      + (currentText ? '<div style="font-size:12px;color:var(--muted);margin-bottom:16px;">Based on: "' + escapeHtml(currentText.substring(0, 50)) + (currentText.length > 50 ? '...' : '') + '"</div>' : '<div style="font-size:12px;color:var(--muted);margin-bottom:16px;">Here are some ideas to get you started.</div>')
      + cards
      + '<button data-bio-action="close-ai-bio-modal" style="width:100%;padding:10px;background:transparent;border:1px solid var(--border-hover);color:var(--muted);border-radius:8px;font-size:13px;font-family:DM Sans,sans-serif;cursor:pointer;margin-top:4px;">Cancel</button>';
  })
  .catch(function() {
    overlay.remove();
    showModalAlert('Error', 'Failed to generate bio suggestions. Try again.');
  });
}

function applyAIBio(textareaId, idx) {
  var text = document.getElementById('ai-bio-option-' + idx)?.textContent;
  if (!text) return;
  var textarea = document.getElementById(textareaId);
  if (!textarea) return;
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('ai-bio-modal')?.remove();
}


// =============================================================================
// ACTION REGISTRATIONS (Phase 2)
// -----------------------------------------------------------------------------
// Each registered handler corresponds to a data-bio-action="..." in markup.
// Handler signature: (event, element) — element is the one with data-bio-action.
// Read parameters from element.dataset.* attributes.
// =============================================================================

bioRegisterAction('save', () => saveBio());
bioRegisterAction('toggle-publish', () => togglePublish());
bioRegisterAction('remove-readonly', (e, el) => el.removeAttribute('readonly'));
bioRegisterAction('username-input', () => onUsernameInput());
bioRegisterAction('toggle-section', (e, el) => toggleBioSection(el.dataset.bioSection));
bioRegisterAction('open-cropper-avatar', (e, el) => openCropper(el, 'avatar'));
bioRegisterAction('remove-avatar', () => removeAvatar());
bioRegisterAction('set-avatar-display', (e, el) => setAvatarDisplay(el.dataset.bioMode));
bioRegisterAction('close-hero-upsell', () => closeHeroUpsell());
bioRegisterAction('close-hero-upsell-if-backdrop', (e) => { if (e.target.id === 'hero-upsell-modal') closeHeroUpsell(); });
bioRegisterAction('field-change', () => onBioFieldChange());
// Block Enter once the bio already has 3 lines, so the line break simply
// doesn't happen rather than truncating anything the user typed.
bioRegisterAction('bio-line-guard', (e, el) => {
  if (e.key === 'Enter' && el.value.split('\n').length >= 3) {
    e.preventDefault();
  }
});
bioRegisterAction('ai-bio-assist', () => aiBioAssist('bio-bio', 200));
bioRegisterAction('custom-bg-selected', (e, el) => onBioCustomBgSelected(el));
bioRegisterAction('remove-custom-bg', () => removeBioCustomBg());
bioRegisterAction('custom-opacity', (e, el) => onBioCustomOpacityChange(el.value));
bioRegisterAction('custom-color', (e, el) => onBioColorChange(el.dataset.bioSlot, el.value));
bioRegisterAction('reset-custom-colors', () => resetBioCustomColors());
bioRegisterAction('pick-font', (e, el) => pickBioFont(el.value));
bioRegisterAction('add-link', (e, el) => {
  const featured = el.dataset.bioFeatured === 'true';
  const hero = el.dataset.bioHero === 'true';
  if (hero) addLink(featured, true);
  else addLink(featured);
});
bioRegisterAction('add-header', () => addHeader());
bioRegisterAction('add-video-block', () => addVideoBlock());
bioRegisterAction('add-tiktok-block', () => addTikTokBlock());
bioRegisterAction('add-instagram-block', () => addInstagramBlock());
bioRegisterAction('add-spotify-block', () => { closeBioMoreModal(); addSpotifyBlock(); });
bioRegisterAction('open-more-modal', () => openBioMoreModal());
bioRegisterAction('close-more-modal', () => closeBioMoreModal());
bioRegisterAction('close-more-if-backdrop', (e) => { if (e.target && e.target.id === 'bio-more-modal') closeBioMoreModal(); });
bioRegisterAction('add-subscribe-block', () => addSubscribeBlock());
bioRegisterAction('open-course-picker', () => openCoursePickerModal());
bioRegisterAction('open-coaching-picker', () => openCoachingPickerModal());
bioRegisterAction('open-product-picker', () => openProductPickerModal());
bioRegisterAction('add-mediakit-link', () => addMediaKitLink());
bioRegisterAction('branding-toggle', () => onBrandingToggle());
bioRegisterAction('sensitive-toggle', () => onSensitiveToggle());

// ----- Phase 2b: actions for dynamically rendered link rows + modals -----

// Link row interactions
bioRegisterAction('expand-link', (e, el) => expandLink(parseInt(el.dataset.bioId, 10)));
bioRegisterAction('remove-link', (e, el) => removeLink(parseInt(el.dataset.bioId, 10)));
bioRegisterAction('save-link-row', (e, el) => saveLinkRow(parseInt(el.dataset.bioId, 10)));
bioRegisterAction('update-link-field', (e, el) => {
  updateLinkField(parseInt(el.dataset.bioId, 10), el.dataset.bioField, el.value);
});
bioRegisterAction('update-link-crossout-price', (e, el) => {
  const cents = Math.round(parseFloat(el.value || 0) * 100);
  updateLinkField(parseInt(el.dataset.bioId, 10), 'courseCrossoutPrice', cents);
});
bioRegisterAction('toggle-link-half-width', (e, el) => {
  toggleLinkHalfWidth(parseInt(el.dataset.bioId, 10), el.checked);
});
bioRegisterAction('open-cropper-featured', (e, el) => openCropper(el, 'featured', parseInt(el.dataset.bioId, 10)));
bioRegisterAction('hero-photo-selected', (e, el) => onHeroPhotoSelected(el, parseInt(el.dataset.bioId, 10)));
bioRegisterAction('link-thumb-selected', (e, el) => onLinkThumbSelected(el, parseInt(el.dataset.bioId, 10)));
bioRegisterAction('remove-link-thumb', (e, el) => removeLinkThumb(parseInt(el.dataset.bioId, 10)));

// Video block actions
bioRegisterAction('update-video-url', (e, el) => {
  updateVideoBlockUrl(parseInt(el.dataset.bioId, 10), parseInt(el.dataset.bioIdx, 10), el.value);
});
bioRegisterAction('remove-video', (e, el) => {
  removeVideoFromBlock(parseInt(el.dataset.bioId, 10), parseInt(el.dataset.bioIdx, 10));
});
bioRegisterAction('add-video-to-block', (e, el) => addVideoToBlock(parseInt(el.dataset.bioId, 10)));

// Theme + socials
bioRegisterAction('pick-theme', (e, el) => pickTheme(el.dataset.bioTheme));
bioRegisterAction('social-change', (e, el) => onSocialChange(el.dataset.bioSocial, el.value));

// Picker modal close buttons
bioRegisterAction('close-course-picker', () => closeCoursePickerModal());
bioRegisterAction('close-coaching-picker', () => closeCoachingPickerModal());
bioRegisterAction('close-product-picker', () => closeProductPickerModal());

// ----- Picker "Add" buttons (course/coaching/product) -----
// Each reads its data-bio-* attributes and calls the appropriate adder.
bioRegisterAction('add-course-to-links', (e, el) => {
  addCourseToLinks(
    el.dataset.bioCourseId,
    el.dataset.bioTitle,
    parseInt(el.dataset.bioPrice, 10),
    el.dataset.bioSlug,
    el.dataset.bioCover
  );
});
bioRegisterAction('add-coaching-to-links', (e, el) => {
  addCoachingToLinks(
    el.dataset.bioCoachingId,
    el.dataset.bioTitle,
    parseInt(el.dataset.bioPrice, 10),
    el.dataset.bioSlug,
    el.dataset.bioCover
  );
});
bioRegisterAction('add-product-to-links', (e, el) => {
  addProductToLinks(
    el.dataset.bioProductId,
    el.dataset.bioTitle,
    parseInt(el.dataset.bioPrice, 10),
    el.dataset.bioSlug,
    el.dataset.bioCover
  );
});

// ----- Copy bio link button (used in username hint + publish UI) -----
bioRegisterAction('copy-bio-link', (e, el) => copyBioLink(el.dataset.bioUrl, el));

// ----- AI Bio modal -----
bioRegisterAction('apply-ai-bio', (e, el) => {
  applyAIBio(el.dataset.bioTextareaId, parseInt(el.dataset.bioOptionIdx, 10));
});
bioRegisterAction('report-ai-bio', (e, el) => {
  var idx = parseInt(el.dataset.bioOptionIdx, 10);
  var text = document.getElementById('ai-bio-option-' + idx)?.textContent;
  ryxaReportAIOutput('bio-writer', text);
});

// ---------------------------------------------------------------------------
// Verification (blue check) application
// ---------------------------------------------------------------------------
let bioVerifyState = { loaded: false, verified: false, status: null, method: 'connected_account', igHandle: undefined };

async function loadBioVerification() {
  if (!currentUser) return;
  try {
    const [profRes, reqRes] = await Promise.all([
      sb.from('profiles').select('verified').eq('user_id', currentUser.id).maybeSingle(),
      sb.from('verification_requests').select('status').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    ]);
    bioVerifyState.verified = !!(profRes.data && profRes.data.verified);
    bioVerifyState.status = reqRes.data ? reqRes.data.status : null;
  } catch (e) {
    bioVerifyState.verified = false;
    bioVerifyState.status = null;
  }
  bioVerifyState.loaded = true;
  renderBioVerification();
  // Reflect the badge in the live preview once verified status is known.
  if (typeof updateBioPreview === 'function') updateBioPreview();
}

function renderBioVerification() {
  const c = document.getElementById('bio-verify-container');
  if (!c) return;

  if (bioVerifyState.verified) {
    c.innerHTML = '<div class="bio-verify-status bio-verify-ok">'
      + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1d9bf0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      + '<div><strong>Profile is verified</strong><div class="bio-verify-substatus">Your blue check is live on your public page.</div></div>'
      + '</div>';
    return;
  }

  if (bioVerifyState.status === 'pending' || bioVerifyState.status === 'approved') {
    c.innerHTML = '<div class="bio-verify-status bio-verify-pending">'
      + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
      + '<div><strong>Verification pending review</strong><div class="bio-verify-substatus">We\'ll review your request within 3-5 business days and add your badge if approved.</div></div>'
      + '</div>';
    return;
  }

  // Not verified, no active request: show a button that opens the modal form.
  const rejected = bioVerifyState.status === 'rejected';
  c.innerHTML =
    (rejected ? '<div class="bio-verify-rejected-note">Your previous request was not approved. You can submit a new one.</div>' : '')
    + '<div class="bio-verify-intro">The blue check confirms your Link in Bio belongs to the real you. Requires a Pro or Max plan. <a class="bio-verify-policy-link" href="/help/verification" target="_blank" rel="noopener">See verification policy</a></div>'
    + '<button type="button" class="bio-verify-open-btn" data-bio-action="open-verify-modal">Submit for verification</button>';
}

function renderVerifyModalForm() {
  const body = document.getElementById('bio-verify-modal-body');
  if (!body) return;
  const m = bioVerifyState.method;
  const ig = bioVerifyState.igHandle;

  let methodBlock;
  if (m === 'connected_account') {
    methodBlock = (ig
      ? '<div class="bio-verify-method-help">We\'ll verify your identity using your connected Instagram: <strong>@' + escapeHtml(ig) + '</strong>.</div>'
      : '<div class="bio-verify-method-help bio-verify-warn">No Instagram account is connected. Connect it under Connected Accounts in Settings, then come back.</div>');
  } else {
    methodBlock = '<div class="bio-verify-method-help">Add a link to your Ryxa page in your public social bio, then paste that profile\'s URL below. This route is reviewed more strictly.</div>';
  }

  body.innerHTML =
    '<div class="bio-verify-methods">'
    +   '<button type="button" class="bio-verify-method-btn ' + (m === 'connected_account' ? 'active' : '') + '" data-bio-action="verify-method" data-bio-method="connected_account">Connected account<span class="bio-verify-method-sub">Best method</span></button>'
    +   '<button type="button" class="bio-verify-method-btn ' + (m === 'profile_link' ? 'active' : '') + '" data-bio-action="verify-method" data-bio-method="profile_link">Profile link<span class="bio-verify-method-sub">Tougher process</span></button>'
    + '</div>'
    + methodBlock
    + '<div class="bio-verify-row">'
    +   '<div class="bio-verify-field"><label for="bio-verify-first">First name</label><input type="text" id="bio-verify-first" maxlength="60" autocomplete="given-name" placeholder="Jane"></div>'
    +   '<div class="bio-verify-field"><label for="bio-verify-last">Last name</label><input type="text" id="bio-verify-last" maxlength="60" autocomplete="family-name" placeholder="Doe"></div>'
    + '</div>'
    + (m === 'profile_link'
        ? '<div class="bio-verify-field"><label for="bio-verify-handle">Social handle</label><input type="text" id="bio-verify-handle" maxlength="80" placeholder="@yourhandle"></div>'
          + '<div class="bio-verify-field"><label for="bio-verify-url">Profile URL (links back to Ryxa)</label><input type="url" id="bio-verify-url" maxlength="300" placeholder="https://instagram.com/yourhandle"></div>'
        : '')
    + '<label class="bio-verify-agree"><input type="checkbox" id="bio-verify-agree"><span>I confirm the information above is accurate, and I understand that impersonating another person can result in account termination.</span></label>'
    + '<button type="button" class="bio-verify-submit" data-bio-action="verify-submit">Submit for verification</button>'
    + '<div class="bio-verify-msg" id="bio-verify-msg"></div>';
}

async function openVerifyModal() {
  if (!isPro()) {
    showModalAlert('Pro or Max required', 'Verification requires a Pro or Max plan. Upgrade to request your blue check.');
    return;
  }
  bioVerifyState.method = 'connected_account';
  // Resolve the user's connected Instagram handle (if any) to show in the form.
  if (bioVerifyState.igHandle === undefined) {
    try {
      const { data } = await sb.from('instagram_connections').select('ig_username').eq('user_id', currentUser.id).maybeSingle();
      bioVerifyState.igHandle = data && data.ig_username ? data.ig_username : null;
    } catch (e) {
      bioVerifyState.igHandle = null;
    }
  }
  renderVerifyModalForm();
  const modal = document.getElementById('bio-verify-modal');
  if (modal) modal.classList.add('open');
}

function closeVerifyModal() {
  const modal = document.getElementById('bio-verify-modal');
  if (modal) modal.classList.remove('open');
}

function bioVerifyShowMsg(text) {
  const el = document.getElementById('bio-verify-msg');
  if (el) { el.textContent = text; el.classList.add('show'); }
}

async function submitBioVerification() {
  const first = (document.getElementById('bio-verify-first')?.value || '').trim();
  const last = (document.getElementById('bio-verify-last')?.value || '').trim();
  const agreed = !!document.getElementById('bio-verify-agree')?.checked;
  const method = bioVerifyState.method;
  // These fields only exist on the profile_link form.
  const handle = (document.getElementById('bio-verify-handle')?.value || '').trim();
  const url = (document.getElementById('bio-verify-url')?.value || '').trim();

  const msg = document.getElementById('bio-verify-msg');
  if (msg) msg.classList.remove('show');

  if (!isPro()) { bioVerifyShowMsg('Verification requires a Pro or Max plan.'); return; }
  if (!first || !last) { bioVerifyShowMsg('Please enter your first and last name.'); return; }

  if (method === 'connected_account') {
    if (!bioVerifyState.igHandle) {
      bioVerifyShowMsg('Connect your Instagram account in Settings first, then come back.');
      return;
    }
  } else {
    if (!handle) { bioVerifyShowMsg('Please enter your social handle.'); return; }
    if (!url) { bioVerifyShowMsg('Please paste the profile URL that links back to Ryxa.'); return; }
  }
  if (!agreed) { bioVerifyShowMsg('Please confirm the agreement to continue.'); return; }

  const btn = document.querySelector('[data-bio-action="verify-submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  const payload = {
    first_name: first,
    last_name: last,
    verification_method: method,
    agreed: true
  };
  if (method === 'profile_link') {
    payload.social_handle = handle;
    payload.profile_url = url;
  }

  try {
    const resp = await fetch('/api/submit-verification', {
      method: 'POST',
      headers: getAIHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit for verification'; }
      bioVerifyShowMsg(data.error || 'Could not submit your request. Please try again.');
      return;
    }
    // ok (including already_pending) -> close modal, show pending state.
    closeVerifyModal();
    bioVerifyState.status = 'pending';
    renderBioVerification();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit for verification'; }
    bioVerifyShowMsg('Could not submit your request. Please try again.');
  }
}

bioRegisterAction('open-verify-modal', () => openVerifyModal());
bioRegisterAction('close-verify-modal', () => closeVerifyModal());
bioRegisterAction('verify-method', (e, el) => {
  bioVerifyState.method = el.dataset.bioMethod === 'connected_account' ? 'connected_account' : 'profile_link';
  renderVerifyModalForm();
});
bioRegisterAction('verify-submit', () => submitBioVerification());
bioRegisterAction('close-ai-bio-modal', () => {
  document.getElementById('ai-bio-modal')?.remove();
});

// ----- Photo cropper modal (lives in dashboard.html outside tool-bio) -----
bioRegisterAction('close-cropper', () => closeCropper());
bioRegisterAction('confirm-crop', () => confirmCrop());

// ----- Image error fallbacks (replaces inline onerror=) -----
// Image error events do NOT bubble, so we need a capture-phase listener.
// Elements opt-in via data-bio-onerror with one of these modes:
//   "hide"           — set display:none on the img
//   "hide-thumb-bg"  — clear src, paint a placeholder background
//   "fallback-src"   — swap to data-bio-fallback-src then clear the attribute
//                      (so a second failure doesn't loop)
document.addEventListener('error', function(e) {
  const target = e.target;
  if (!(target instanceof HTMLImageElement)) return;
  const mode = target.dataset && target.dataset.bioOnerror;
  if (!mode) return;
  if (mode === 'hide') {
    target.style.display = 'none';
  } else if (mode === 'hide-thumb-bg') {
    target.style.background = 'var(--surface2)';
    target.removeAttribute('src');
  } else if (mode === 'fallback-src') {
    const fallback = target.dataset.bioFallbackSrc;
    if (fallback) {
      // Clear the data attr first so a second error (on the fallback URL)
      // doesn't loop indefinitely.
      target.removeAttribute('data-bio-fallback-src');
      target.removeAttribute('data-bio-onerror');
      target.src = fallback;
    }
  }
}, true); // capture phase

// =============================================================================
// END ACTION REGISTRATIONS
// =============================================================================


// =============================================================================
// GLOBAL EXPOSURE — preserve inline onclick handlers in dashboard.html
// -----------------------------------------------------------------------------
// Phase 2 converted bio markup in dashboard.html to use data-bio-action.
// HOWEVER, bio.js itself still emits inline handlers in template literals
// (e.g., renderBioLinks builds HTML strings with onclick="..."). Those are
// converted in Phase 2b. Until then, those template-literal inline handlers
// still need top-level functions to be globals.
//
// Because /js/bio.js is loaded as a regular <script> (not type="module"),
// all top-level function declarations are already on window automatically.
// This block is a paranoia-check + explicit list so future-Claude knows
// exactly which symbols are part of the public API.
// =============================================================================
// Functions (no-op assignments — declarations are already global):
//   copySidebarBioLink, showBioLinkButtons, getBioCollapsed, saveBioCollapsed,
//   toggleBioSection, restoreBioCollapsed, initBioTool, resyncBioUsername,
//   resolveBioLinkLiveCovers, loadBioData, syncBioForm, syncBrandingToggle,
//   onBrandingToggle, renderAvatarPreview, onBioFieldChange, copyBioLink,
//   getBioFont, buildBioFontLink, renderBioThemes, renderBioFonts,
//   injectBioPickerFonts, pickBioFont, syncBioCustomEditorUI, onBioColorChange,
//   resetBioCustomColors, onBioCustomOpacityChange, onBioCustomBgSelected,
//   removeBioCustomBg, renderBioSocials, bioLimits, bioHalfBadge,
//   bioRowTypeMeta, bioHalfWidthToggle, renderBioLinks, showBioStatus, saveBio,
//   deleteStaleBios, updateBioPreview, buildPreviewHTML, buildPreviewSocials,
//   buildPreviewLink, schedulePreviewUpdate, addLink, addHeader,
//   addMediaKitLink, addVideoBlock, addSubscribeBlock, removeAvatar,
//   setAvatarDisplay, togglePublish, aiBioAssist, applyAIBio, etc.
// State (also already global):
//   bioState, bioStaleBgs, bioInited, bioCropper, bioCropTarget,
//   bioCropSource, bioOriginalUsername, bioDraggingLink, bioPreviewTimer,
//   bioPreviewRelocated, bioUsernameCheckTimer, bioUsernameCheckToken,
//   bioStalePhotos, bioExpandedLinks
// =============================================================================
