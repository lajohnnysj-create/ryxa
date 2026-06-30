// =============================================================================
// /js/mk.js — Media Kit editor (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// This file contains all JavaScript for the Media Kit editor inside the
// Ryxa dashboard. Extracted from dashboard.html (and a chunk that previously
// lived in bio.js) as part of the dashboard refactor for stricter CSP.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/mk.js
//   • Phase 2: replaced inline onclick/oninput/etc with data-mk-action
//     attributes + delegated event handlers (CSP-strict script-src 'self' compatible)
//   • Phase 3: replaced inline class="bio-s-6eae3a" attributes with hash-named CSS classes
//     in dashboard.html's <style> block, or post-render JS application for
//     dynamic styles (CSP-strict style-src 'self' compatible)
//
// External dependencies remain on `window` (sb, Auth, currentUser,
// escapeHtml, isPro, isMax, currentTier, BIO_SOCIAL_FIELDS, BIO_THEMES,
// BIO_FONTS, getBioFont, showModalAlert, showModalConfirm, etc).
//
// The preview iframe (buildMKPreviewHTML) renders content in its own
// document context, so inline styles there don't affect the dashboard's CSP.
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE (mirror of bio.js's; namespaced to mk-*)
// -----------------------------------------------------------------------------
// All MK-tool buttons and inputs use `data-mk-action="..."` attributes instead
// of inline onclick/oninput/etc. A single document-level listener per event
// type dispatches to a handler function registered in `mkActions`.
// Parameters are read from `data-mk-*` attributes on the target element.
// =============================================================================

const mkActions = {};

function mkRegisterAction(action, handler) {
  mkActions[action] = handler;
}

function mkFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      // Per-event attribute style: data-mk-action-input="...", data-mk-action-focus="..."
      const perEvent = el.dataset['mkAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      // Generic data-mk-action with optional data-mk-event
      if (el.dataset.mkAction) {
        const wantEvent = el.dataset.mkEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.mkAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function mkDispatchEvent(event) {
  const found = mkFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = mkActions[found.action];
  if (!handler) {
    console.warn('[mk] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur', 'keydown', 'mouseover', 'mouseout'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, mkDispatchEvent, useCapture);
});

// =============================================================================
// CSP-STRICT STYLE APPLICATION (Phase 3) — parallel of bio's bioApplyDataStyles
// -----------------------------------------------------------------------------
const MK_DATA_STYLE_MAP = {
  bg:          'background',
  color:       'color',
  border:      'border',
  shadow:      'box-shadow',
  padding:     'padding',
  radius:      'border-radius',
  display:     'display',
  fontFamily:  'font-family',
};

function mkApplyDataStyles(root) {
  root = root || document;
  const selectors = Object.keys(MK_DATA_STYLE_MAP)
    .map(k => `[data-mk-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}]`)
    .join(',');
  const els = root.querySelectorAll(selectors);
  els.forEach(el => {
    Object.entries(MK_DATA_STYLE_MAP).forEach(([camelName, cssProp]) => {
      const val = el.dataset['mk' + camelName.charAt(0).toUpperCase() + camelName.slice(1)];
      if (val) el.style.setProperty(cssProp, val);
    });
  });
}

// =============================================================================
// END INFRASTRUCTURE — actual MK code follows
// =============================================================================

// ---------- From bio.js lines 3354-3420 (mkState + initMediaKitTool) ----------
let mkState = {
  headshot_url: '',
  display_name: '',
  handle: '',
  bio: '',
  category: '',
  socials: {}, // { instagram: { count: N, url: "...", engagement: "..." }, ... }
  audience_mode: 'automatic', // 'manual' | 'automatic' — chosen tab in Audience & Stats. Defaults to 'automatic' to encourage Instagram connection.
  rate_card: [], // array of {id, label, price, note}
  contact_email: '',
  contact_note: '',
  theme: 'purple',
  font_family: 'DM Sans',
  show_branding: true,
  published: false,
  custom_theme: null,
  videos: { youtube: [], tiktok: [] }, // editor rows are {_id,url}; saved as { youtube:[url], tiktok:[url] }
  carousel: [], // photo carousel: [{photoUrl,w,h}]
};
let mkStaleBgs = [];
let mkInited = false;
let mkPreviewTimer = null;
let mkStalePhotos = [];
let mkRateIdSeq = 1;
let mkVideoIdSeq = 1;
let mkEditingVideoId = null; // _id of the video row currently expanded for editing (cosmetic only)

function initMediaKitTool() {
  const pro = isPro();
  document.getElementById('mediakit-paywall').style.display = pro ? 'none' : 'block';
  document.getElementById('mediakit-editor').style.display = pro ? 'block' : 'none';
  if (!pro) return;

  if (mkInited) {
    // Re-sync username from profiles in case it was changed in the Link in Bio tool
    resyncMKUsername();
    // Reset username hint to default
    var mkHint = document.getElementById('mk-username-hint');
    if (mkHint) { mkHint.textContent = 'Same username as your Link in Bio. You can change it up to 2 times per week.'; mkHint.style.color = 'var(--muted)'; }
    renderMKSocials();
    renderMKRates();
    renderMKVideos();
    renderMKCarousel();
    renderMKThemes();
    renderMKFonts();
    // If the audience pane is in Automatic mode, refresh its connection status.
    // Catches the case where the creator disconnected/connected Instagram in
    // Settings between visits — the pane might otherwise show stale state.
    if (mkState.audience_mode === 'automatic' && typeof loadAudienceAutomatic === 'function') {
      mkAudCache = null;
      loadAudienceAutomatic();
    }
    updateMKPreview();
    return;
  }
  mkInited = true;

  // Seed predefined rate card rows (all blank — user fills in what they charge for)
  if (mkState.rate_card.length === 0) {
    mkState.rate_card = MK_PREDEFINED_RATES.map(r => ({ _id: mkRateIdSeq++, id: r.id, label: r.label, price: '', note: '' }));
  }

  renderMKSocials();
  renderMKRates();
  renderMKVideos();
  renderMKCarousel();
  renderMKThemes();
  renderMKFonts();
  loadMediaKit();

  document.getElementById('mk-headshot-inner').addEventListener('click', () => {
    document.getElementById('mk-headshot-input').click();
  });
}

// ---------- From dashboard.html lines 9711-11142 (main MK block) ----------
async function resyncMKUsername() {
  const input = document.getElementById('mk-username');
  if (!input || !currentUser) return;
  var uname = '';
  const bioInput = document.getElementById('bio-username');
  if (bioInput && bioInput.value) {
    uname = bioInput.value;
    input.value = uname;
  } else if (typeof bioOriginalUsername !== 'undefined' && bioOriginalUsername) {
    uname = bioOriginalUsername;
    input.value = uname;
  } else {
    try {
      const { data: profile } = await sb.from('profiles').select('username').eq('user_id', currentUser.id).maybeSingle();
      if (profile?.username) {
        uname = profile.username;
        input.value = uname;
        if (typeof bioOriginalUsername !== 'undefined') bioOriginalUsername = uname;
      }
    } catch (e) { console.warn('resyncMKUsername', e); }
  }
  updateMKPublishUI();
}

async function loadMediaKit() {
  if (!currentUser) return;
  try {
    // Load shared username from profiles
    const { data: profile } = await sb.from('profiles').select('username').eq('user_id', currentUser.id).maybeSingle();
    if (profile?.username) {
      document.getElementById('mk-username').value = profile.username;
      // Keep bioOriginalUsername in sync (Link in Bio uses this)
      if (typeof bioOriginalUsername !== 'undefined') bioOriginalUsername = profile.username;
      if (typeof bioState !== 'undefined') bioState.username = profile.username;
    }
    // Load media kit data
    const { data: kit } = await sb.from('media_kit').select('*').eq('user_id', currentUser.id).maybeSingle();
    if (kit) {
      mkState.headshot_url = kit.headshot_url || '';
      mkState.display_name = kit.display_name || '';
      mkState.handle = kit.handle || '';
      mkState.bio = kit.bio || '';
      mkState.category = kit.category || '';
      // Migrate legacy number-only socials to {count, url}
      const rawSocials = kit.socials || {};
      const socials = {};
      for (const key of Object.keys(rawSocials)) {
        const v = rawSocials[key];
        if (typeof v === 'number') socials[key] = { count: v, url: '', engagement: '' };
        else if (v && typeof v === 'object') socials[key] = { count: parseInt(v.count) || 0, url: v.url || '', engagement: (v.engagement != null ? String(v.engagement) : '') };
      }
      mkState.socials = socials;
      mkState.audience_mode = (kit.audience_mode === 'automatic') ? 'automatic' : 'manual';
      mkState.contact_email = kit.contact_email || '';
      mkState.contact_note = kit.contact_note || '';
      mkState.theme = kit.theme || 'purple';
      mkState.font_family = kit.font_family || 'DM Sans';
      mkState.show_branding = !!kit.show_branding;
      mkState.published = !!kit.published;
      mkState.custom_theme = kit.custom_theme || null;
      if (mkState.theme === 'custom' && !isPro()) mkState.theme = 'purple';
      // Merge DB rate card with predefined rows
      const dbRates = Array.isArray(kit.rate_card) ? kit.rate_card : [];
      mkState.rate_card = MK_PREDEFINED_RATES.map(r => {
        const existing = dbRates.find(x => x.id === r.id);
        return { _id: mkRateIdSeq++, id: r.id, label: r.label, price: existing?.price || '', note: existing?.note || '' };
      });
      // Add any custom rates
      dbRates.filter(r => !MK_PREDEFINED_RATES.find(p => p.id === r.id)).forEach(r => {
        mkState.rate_card.push({ _id: mkRateIdSeq++, id: r.id || ('custom-' + Date.now() + '-' + Math.random().toString(36).slice(2,6)), label: r.label || 'Custom', price: r.price || '', note: r.note || '' });
      });
      // Videos: stored as { youtube:[url], tiktok:[url] }; hydrate into editor rows.
      const dbVideos = (kit.videos && typeof kit.videos === 'object') ? kit.videos : {};
      mkState.videos = {
        youtube: (Array.isArray(dbVideos.youtube) ? dbVideos.youtube : []).slice(0, 10).map(u => ({ _id: mkVideoIdSeq++, url: String(u || '') })),
        tiktok: (Array.isArray(dbVideos.tiktok) ? dbVideos.tiktok : []).slice(0, 10).map(u => ({ _id: mkVideoIdSeq++, url: String(u || '') })),
      };
      // Photo carousel: array of {photoUrl,w,h}
      mkState.carousel = (Array.isArray(kit.carousel) ? kit.carousel : [])
        .filter(im => im && im.photoUrl)
        .slice(0, 10)
        .map(im => ({ photoUrl: String(im.photoUrl), w: parseInt(im.w) || 0, h: parseInt(im.h) || 0 }));
    }
  } catch (e) { console.error('loadMediaKit', e); }
  syncMKForm();
  // Reset username hint to default
  var mkHint2 = document.getElementById('mk-username-hint');
  if (mkHint2) { mkHint2.textContent = 'Same username as your Link in Bio. You can change it up to 2 times per week.'; mkHint2.style.color = 'var(--muted)'; }
  renderMKSocials();
  renderMKRates();
  renderMKVideos();
  renderMKCarousel();
  renderMKThemes();
  renderMKFonts();
  syncMKCustomEditorUI();
  syncAudienceModeUI();
  updateMKPublishUI();
  updateMKPreview();
}

function syncMKForm() {
  document.getElementById('mk-display-name').value = mkState.display_name;
  document.getElementById('mk-handle').value = mkState.handle;
  document.getElementById('mk-category').value = mkState.category;
  document.getElementById('mk-bio').value = mkState.bio;
  document.getElementById('mk-category-count').textContent = mkState.category.length;
  document.getElementById('mk-bio-count').textContent = mkState.bio.length;
  document.getElementById('mk-contact-email').value = mkState.contact_email;
  document.getElementById('mk-contact-note').value = mkState.contact_note;
  document.getElementById('mk-show-branding').checked = mkState.show_branding;
  renderMKHeadshotPreview();
}

function renderMKHeadshotPreview() {
  const inner = document.getElementById('mk-headshot-inner');
  const removeBtn = document.getElementById('mk-headshot-remove');
  if (mkState.headshot_url) {
    inner.innerHTML = `<img alt="Media kit headshot" src="${escapeHtml(mkState.headshot_url)}" class="mk-s-5138f3">`;
    removeBtn.style.display = 'flex';
  } else {
    // Empty state: a "+" affordance (click the headshot to upload) instead of an initial.
    inner.innerHTML = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    removeBtn.style.display = 'none';
  }
}

function onMKField() {
  mkState.display_name = document.getElementById('mk-display-name').value;
  mkState.handle = document.getElementById('mk-handle').value;
  mkState.category = document.getElementById('mk-category').value;
  mkState.bio = document.getElementById('mk-bio').value;
  mkState.contact_email = document.getElementById('mk-contact-email').value;
  mkState.contact_note = document.getElementById('mk-contact-note').value;
  mkState.show_branding = document.getElementById('mk-show-branding').checked;
  document.getElementById('mk-category-count').textContent = mkState.category.length;
  document.getElementById('mk-bio-count').textContent = mkState.bio.length;
  if (!mkState.headshot_url) renderMKHeadshotPreview();
  scheduleMKPreview();
}

function toggleMKSection(name) {
  const body = document.getElementById('mk-body-' + name);
  const btn = body.previousElementSibling;
  // Check computed style, not inline style. Some sections start collapsed
  // via a CSS class (e.g. bio-s-c8be1c { display:none; }) rather than an
  // inline style. Reading body.style.display would return '' for those on
  // fresh load, so the toggle would think they were open and "close" them
  // again - leaving them hidden but with aria-expanded flipped to true.
  // That manifests as "first click highlights but doesn't expand, second
  // click expands." Computed style returns the actual rendered value.
  const isOpen = window.getComputedStyle(body).display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  btn.setAttribute('aria-expanded', !isOpen);
}

function removeHeadshot() {
  if (mkState.headshot_url) mkStalePhotos.push(mkState.headshot_url);
  mkState.headshot_url = '';
  renderMKHeadshotPreview();
  scheduleMKPreview();
}

// ==== Username sync with Link in Bio ====
let mkUsernameCheckTimer = null;
let mkUsernameCheckToken = 0;
function onMKUsernameInput() {
  const raw = document.getElementById('mk-username').value;
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
  if (cleaned !== raw) document.getElementById('mk-username').value = cleaned;
  // Keep Link in Bio state in sync (since it's the same profile row)
  if (typeof bioState !== 'undefined') bioState.username = cleaned;
  // Update Link in Bio's input if the tool has been initialized
  const bioInput = document.getElementById('bio-username');
  if (bioInput && bioInput.value !== cleaned) bioInput.value = cleaned;

  const hint = document.getElementById('mk-username-hint');
  clearTimeout(mkUsernameCheckTimer);
  mkUsernameCheckToken++;

  if (!cleaned) {
    hint.textContent = 'Same username as your Link in Bio. Changing it here updates both.';
    hint.style.color = 'var(--muted)';
  } else if (cleaned.length < 3) {
    hint.textContent = 'Too short, minimum 3 characters';
    hint.style.color = '#fca5a5';
  } else if (typeof BIO_RESERVED !== 'undefined' && BIO_RESERVED.has(cleaned)) {
    hint.textContent = 'That username is reserved. Pick another.';
    hint.style.color = '#fca5a5';
  } else if (typeof bioOriginalUsername !== 'undefined' && cleaned === bioOriginalUsername) {
    renderMKUsernameAvailable(cleaned);
  } else {
    hint.innerHTML = `<span class="bio-s-e3f916">Checking <strong>${cleaned}</strong>…</span>`;
    hint.style.color = 'var(--muted)';
    const myToken = mkUsernameCheckToken;
    mkUsernameCheckTimer = setTimeout(() => checkMKUsernameAvailability(cleaned, myToken), 500);
  }
  // If the media kit is currently published, re-render the "Live at" text + View Live link
  if (mkState.published) updateMKPublishUI();
  scheduleMKPreview();
}

async function checkMKUsernameAvailability(username, token) {
  const hint = document.getElementById('mk-username-hint');
  try {
    const { data, error } = await sb.from('public_profiles').select('user_id').eq('username', username).maybeSingle();
    if (token !== mkUsernameCheckToken) return;
    if (error) {
      hint.innerHTML = `<span class="bio-s-e3f916">Couldn't check availability. Will verify on save.</span>`;
      return;
    }
    if (!data || data.user_id === currentUser?.id) {
      // Name is available — but check rate limit before showing green
      const { allowed, changes } = await checkUsernameChangeLimit();
      if (token !== mkUsernameCheckToken) return;
      if (!allowed) {
        const nextDate = formatNextChangeDate(changes);
        hint.innerHTML = `<span class="bio-s-dbc3a0">You've reached the max username changes. Try again on ${nextDate}.</span>`;
        // Revert input to current username so save still works for other changes
        const originalUname = (typeof bioOriginalUsername !== 'undefined') ? bioOriginalUsername : '';
        document.getElementById('mk-username').value = originalUname;
        if (typeof bioState !== 'undefined') bioState.username = originalUname;
        const bioInput = document.getElementById('bio-username');
        if (bioInput) bioInput.value = originalUname;
        return;
      }
      renderMKUsernameAvailable(username);
    } else {
      hint.innerHTML = `<span class="bio-s-dbc3a0">✕ <strong>${escapeHtml(username)}</strong> is taken, try another.</span>`;
    }
  } catch (e) {
    if (token !== mkUsernameCheckToken) return;
  }
}

function renderMKUsernameAvailable(cleaned) {
  const hint = document.getElementById('mk-username-hint');
  const fullUrl = `https://www.ryxa.io/mediakit/${cleaned}`;
  const originalUname = (typeof bioOriginalUsername !== 'undefined') ? bioOriginalUsername : '';
  const isChanged = cleaned !== originalUname;
  hint.innerHTML = `
    <div class="bio-s-6b6f9f">
      <span class="bio-s-f4cfc5">✓</span>
      <span>Media kit URL: <strong class="bio-s-313aee">ryxa.io/mediakit/${escapeHtml(cleaned)}</strong></span>
      <button type="button" data-mk-action="copy-mk-link" data-mk-url="${fullUrl}"
        class="bio-s-8911f1">
        Copy link
      </button>
    </div>${isChanged ? '<div class="bio-s-19cf92">Press save to change username</div>' : ''}`;
  hint.style.color = 'var(--muted)';
}

// ==== Socials ====
function renderMKSocials() {
  const container = document.getElementById('mk-socials-form');
  if (!container) return;
  container.innerHTML = MK_SOCIAL_PLATFORMS.map(p => {
    const data = mkState.socials[p.key] || { count: 0, url: '', engagement: '' };
    // Handle-type platforms show a fixed URL prefix and take just the handle;
    // url-type (YouTube, Facebook) take a full pasted URL.
    let urlInput;
    if (p.type === 'username' && p.urlPrefix) {
      // Display prefix without the protocol, e.g. "instagram.com/"
      const shownPrefix = p.urlPrefix.replace(/^https?:\/\//i, '');
      urlInput = `<div class="bio-social-prefixwrap">
        <span class="bio-social-prefix">${escapeHtml(shownPrefix)}</span>
        <input type="text" maxlength="80" placeholder="yourhandle"
          value="${escapeHtml(data.url || '')}"
          data-mk-action="social-url" data-mk-event="input" data-mk-social="${p.key}"
          aria-label="${p.label} handle">
      </div>`;
    } else {
      urlInput = `<input type="url" placeholder="Paste your full ${escapeHtml(p.label)} URL"
        value="${escapeHtml(data.url || '')}"
        data-mk-action="social-url" data-mk-event="input" data-mk-social="${p.key}"
        aria-label="${p.label} profile URL"
        class="mk-s-2f0e33" maxlength="500">`;
    }
    return `<div class="mk-s-bbc25c">
      <div class="mk-social-row bio-s-6c002e" >
        <div class="mk-social-icon">${p.svg}</div>
        <div class="mk-social-label">${p.label}</div>
        <input type="number" min="0" placeholder="Follower count"
          value="${data.count || ''}"
          data-mk-action="social-count" data-mk-event="input" data-mk-social="${p.key}"
          aria-label="${p.label} follower count">
        <input type="number" min="0" max="100" step="0.01" placeholder="Eng. %"
          value="${data.engagement || ''}"
          data-mk-action="social-engagement" data-mk-event="input" data-mk-social="${p.key}"
          aria-label="${p.label} engagement rate percentage"
          class="mk-social-eng-input">
      </div>
      ${urlInput}
    </div>`;
  }).join('');
  updateMKTotalDisplay();
}

function onMKSocialCount(key, val) {
  // Hard cap at 9 digits - no real creator account exceeds this (largest in
  // existence is ~660M followers). Reject anything longer.
  if (typeof val === 'string' && val.length > 9) {
    const el = document.querySelector('[data-mk-action="social-count"][data-mk-social="' + key + '"]');
    if (el) el.value = (mkState.socials[key] && mkState.socials[key].count) ? mkState.socials[key].count : '';
    return;
  }
  const n = parseInt(val);
  if (!mkState.socials[key]) mkState.socials[key] = { count: 0, url: '', engagement: '' };
  mkState.socials[key].count = isFinite(n) && n > 0 ? n : 0;
  // If all fields empty, drop the whole entry
  if (!mkState.socials[key].count && !mkState.socials[key].url && !mkState.socials[key].engagement) delete mkState.socials[key];
  updateMKTotalDisplay();
  scheduleMKPreview();
}

// Pull the creator's manual follower counts from their Link in Bio "Follower
// count" block into the Media Kit social fields. One-way import; mirrors the
// "Pull from Media Kit" button on the bio side.
async function pullSocialsFromBio() {
  if (!currentUser) return;
  try {
    const { data } = await sb.from('link_in_bio').select('links').eq('user_id', currentUser.id).maybeSingle();
    const links = (data && Array.isArray(data.links)) ? data.links : [];
    const block = links.find(l => l && l.isFollowerBlock);
    const counts = (block && block.followerCounts && typeof block.followerCounts === 'object') ? block.followerCounts : {};
    let filled = 0;
    MK_SOCIAL_PLATFORMS.forEach(p => {
      const n = parseInt(counts[p.key], 10);
      if (n && n > 0) {
        if (!mkState.socials[p.key]) mkState.socials[p.key] = { count: 0, url: '', engagement: '' };
        mkState.socials[p.key].count = n;
        filled++;
      }
    });
    if (filled > 0) {
      renderMKSocials();
      scheduleMKPreview();
      showMKStatus('success', `Pulled ${filled} count${filled === 1 ? '' : 's'} from your Link in Bio`);
    } else {
      showMKStatus('error', 'No follower counts found in your Link in Bio');
    }
  } catch (e) {
    showMKStatus('error', 'Could not load your Link in Bio');
  }
}

function onMKSocialEngagement(key, val) {
  if (!mkState.socials[key]) mkState.socials[key] = { count: 0, url: '', engagement: '' };
  // Hard cap at 5 characters - covers values like "99.99" or "100.0".
  // Reject anything longer so users can't type a 6+ digit rate.
  if (typeof val === 'string' && val.length > 5) {
    // Restore the displayed value to whatever's stored (rejects the extra char).
    const el = document.querySelector('[data-mk-action="social-engagement"][data-mk-social="' + key + '"]');
    if (el) el.value = mkState.socials[key].engagement || '';
    return;
  }
  const n = parseFloat(val);
  // Engagement rate is a percentage: only keep a valid 0-100 value.
  mkState.socials[key].engagement = (isFinite(n) && n >= 0 && n <= 100) ? String(val).trim() : '';
  if (!mkState.socials[key].count && !mkState.socials[key].url && !mkState.socials[key].engagement) delete mkState.socials[key];
  scheduleMKPreview();
}

function onMKSocialUrl(key, val) {
  if (!mkState.socials[key]) mkState.socials[key] = { count: 0, url: '', engagement: '' };
  let v = (val || '').trim();
  // For handle-type platforms, reduce a pasted full URL to just the handle
  // and strip a leading @. Tolerant of older data saved as full URLs.
  const platform = MK_SOCIAL_PLATFORMS.find(p => p.key === key);
  if (v && platform && platform.type === 'username') {
    v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    if (v.indexOf('/') !== -1) {
      const parts = v.split('/').filter(Boolean);
      v = parts[parts.length - 1] || '';
    }
    v = v.replace(/^@/, '').replace(/[?#].*$/, '').trim();
  }
  mkState.socials[key].url = v;
  if (!mkState.socials[key].count && !mkState.socials[key].url && !mkState.socials[key].engagement) delete mkState.socials[key];
  scheduleMKPreview();
}

function updateMKTotalDisplay() {
  const total = Object.values(mkState.socials).reduce((sum, s) => sum + (parseInt(s.count) || 0), 0);
  const el = document.getElementById('mk-total-display');
  if (!el) return;
  if (total > 0) {
    el.textContent = formatNumberShort(total) + ' total';
  } else {
    el.textContent = '';
  }
}

function formatNumberShort(n) {
  const num = parseInt(n);
  if (!num || num < 0) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'K';
  return String(num);
}

// ==== Rate card ====
function addCustomRate() {
  mkState.rate_card.push({
    _id: mkRateIdSeq++,
    id: 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
    label: '',
    price: '',
    note: ''
  });
  renderMKRates();
  scheduleMKPreview();
}

function removeRate(id) {
  mkState.rate_card = mkState.rate_card.filter(r => r._id !== id);
  renderMKRates();
  scheduleMKPreview();
}

function onRateField(id, field, val) {
  const r = mkState.rate_card.find(x => x._id === id);
  if (!r) return;
  r[field] = val;
  scheduleMKPreview();
}

function renderMKRates() {
  const el = document.getElementById('mk-rates-list');
  const counts = document.getElementById('mk-rates-count');
  if (!el) return;
  const filled = mkState.rate_card.filter(r => parseFloat(r.price) > 0).length;
  if (counts) counts.textContent = filled > 0 ? `${filled} active` : '';

  el.innerHTML = mkState.rate_card.map(r => {
    const isPredefined = MK_PREDEFINED_RATES.some(p => p.id === r.id);

    // Header row: label + action button
    let headerHtml;
    if (isPredefined) {
      headerHtml = `<div class="mk-rate-top">
        <div class="mk-rate-label-text">${escapeHtml(r.label)}</div>
        <button class="mk-rate-remove" data-mk-action="clear-rate" data-mk-id="${r._id}" aria-label="Clear this rate">Clear</button>
      </div>`;
    } else {
      headerHtml = `<div class="mk-rate-top">
        <input type="text" class="mk-rate-label-input mk-s-301af4" placeholder="Rate label (e.g. Podcast Integration)" maxlength="60"
          value="${escapeHtml(r.label || '')}"
          data-mk-action="rate-field" data-mk-event="input" data-mk-id="${r._id}" data-mk-field="label"
          aria-label="Rate label"
          >
        <button class="mk-rate-remove" data-mk-action="remove-rate" data-mk-id="${r._id}" aria-label="Delete this custom rate">Delete</button>
      </div>`;
    }

    return `<div class="mk-rate-row">
      ${headerHtml}
      <div class="mk-rate-price-row">
        <span class="mk-rate-prefix currency-symbol-prefix">${getCurrencySymbol()}</span>
        <input type="number" min="0" step="1" placeholder="Price"
          value="${escapeHtml(r.price ? String(r.price) : '')}"
          data-mk-action="rate-field" data-mk-event="input" data-mk-id="${r._id}" data-mk-field="price"
          aria-label="Price"
          class="bio-s-7623f0">
      </div>
      <input type="text" placeholder="Note (optional, e.g. Includes 14-day usage rights)" maxlength="120"
        value="${escapeHtml(r.note || '')}"
        data-mk-action="rate-field" data-mk-event="input" data-mk-id="${r._id}" data-mk-field="note"
        aria-label="Rate note"
        class="mk-s-76084e">
    </div>`;
  }).join('');
}

function clearRate(id) {
  const r = mkState.rate_card.find(x => x._id === id);
  if (!r) return;
  r.price = '';
  r.note = '';
  renderMKRates();
  scheduleMKPreview();
}

// ==== Videos (YouTube + TikTok) ====
// Mirrors the Link in Bio video/TikTok blocks: up to 10 URLs per platform.
// mk-prefixed extractors avoid colliding with the globals bio.js defines
// (both scripts share the dashboard's global scope).
function mkExtractYouTubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function mkExtractTikTokId(url) {
  if (!url) return null;
  const m = String(url).match(/tiktok\.com\/(?:.*\/video\/|embed\/(?:v2\/)?|v\/)(\d{6,})/i);
  return m ? m[1] : null;
}
const MK_VIDEO_PLATFORMS = {
  youtube: { extract: mkExtractYouTubeId, placeholder: 'https://youtube.com/watch?v=...', label: 'YouTube video URL' },
  tiktok:  { extract: mkExtractTikTokId, placeholder: 'https://www.tiktok.com/@user/video/...', label: 'TikTok video URL' },
};
function mkVideoArr(platform) {
  if (!mkState.videos || typeof mkState.videos !== 'object') mkState.videos = { youtube: [], tiktok: [] };
  if (!Array.isArray(mkState.videos[platform])) mkState.videos[platform] = [];
  return mkState.videos[platform];
}
function addVideo(platform) {
  if (!MK_VIDEO_PLATFORMS[platform]) return;
  const arr = mkVideoArr(platform);
  if (arr.length >= 10) return;
  arr.push({ _id: mkVideoIdSeq++, url: '' });
  renderMKVideos();
  scheduleMKPreview();
}
function removeVideo(platform, id) {
  const arr = mkVideoArr(platform);
  mkState.videos[platform] = arr.filter(v => v._id !== id);
  renderMKVideos();
  scheduleMKPreview();
}
function onVideoField(platform, id, val) {
  const v = mkVideoArr(platform).find(x => x._id === id);
  if (!v) return;
  v.url = val;
  updateMKVideoCount();
  scheduleMKPreview();
}
// Click a collapsed chip -> expand that row's input for editing.
function onMKVideoEdit(platform, id) {
  mkEditingVideoId = id;
  const row = document.querySelector('.mk-vid-row[data-mk-vid-row="' + id + '"]');
  if (!row) return;
  row.classList.remove('is-collapsed');
  const input = row.querySelector('.mk-vid-input');
  if (input) { input.focus(); input.select(); }
}
// Blur the input -> collapse back to the chip if the link is valid; if it is invalid
// (or empty with text), keep it expanded so the typo stays visible and fixable.
function onMKVideoBlur(input) {
  if (mkEditingVideoId === parseInt(input.dataset.mkId, 10)) mkEditingVideoId = null;
  const row = input.closest('.mk-vid-row');
  if (!row) return;
  const meta = MK_VIDEO_PLATFORMS[input.dataset.mkPlatform];
  const vidId = meta ? meta.extract((input.value || '').trim()) : '';
  if (vidId) {
    let idEl = row.querySelector('.mk-vid-chip-id');
    if (!idEl) {
      idEl = document.createElement('span');
      idEl.className = 'mk-vid-chip-id';
      const chip = row.querySelector('.mk-vid-chip');
      if (chip) chip.appendChild(idEl);
    }
    idEl.textContent = '\u00b7 ' + vidId;
    row.classList.add('is-collapsed');
    row.classList.remove('is-invalid');
  } else {
    row.classList.remove('is-collapsed');
    row.classList.toggle('is-invalid', !!(input.value || '').trim());
  }
}
function mkCountValidVideos() {
  let n = 0;
  for (const p of Object.keys(MK_VIDEO_PLATFORMS)) {
    const ex = MK_VIDEO_PLATFORMS[p].extract;
    n += mkVideoArr(p).filter(v => v.url && v.url.trim() && ex(v.url.trim())).length;
  }
  return n;
}
function updateMKVideoCount() {
  const counts = document.getElementById('mk-videos-count');
  if (!counts) return;
  const n = mkCountValidVideos();
  counts.textContent = n > 0 ? (n + (n === 1 ? ' video' : ' videos')) : '';
}
function renderMKVideoList(platform) {
  const el = document.getElementById('mk-videos-' + platform + '-list');
  if (!el) return;
  const meta = MK_VIDEO_PLATFORMS[platform];
  const arr = mkVideoArr(platform);
  // Each row collapses to a tidy chip (video glyph + "Video N" + the parsed ID) when
  // it holds a valid link and is not being edited, so the raw URLs stay hidden. The
  // saved value is always the raw URL; the chip is purely cosmetic. Clicking the chip
  // (or an empty/invalid row) reveals the input; blurring it collapses again.
  el.innerHTML = arr.map((v, idx) => {
    const vidId = meta.extract(v.url || '');
    const valid = !!vidId;
    const hasText = !!(v.url || '').trim();
    const collapsed = valid && v._id !== mkEditingVideoId;
    const n = idx + 1;
    const rowCls = 'mk-vid-row' + (collapsed ? ' is-collapsed' : '') + (!valid && hasText ? ' is-invalid' : '');
    return `<div class="${rowCls}" data-mk-vid-row="${v._id}">
      <button type="button" class="mk-vid-chip" data-mk-action="edit-video" data-mk-platform="${platform}" data-mk-id="${v._id}" aria-label="Video ${n}, click to show the link">
        <svg class="mk-vid-chip-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>
        <span class="mk-vid-chip-label">Video ${n}</span>
        ${valid ? `<span class="mk-vid-chip-id">\u00b7 ${escapeHtml(vidId)}</span>` : ''}
      </button>
      <input type="url" placeholder="${meta.placeholder}" value="${escapeHtml(v.url || '')}"
        data-mk-action="video-field" data-mk-event="input" data-mk-platform="${platform}" data-mk-id="${v._id}"
        aria-label="${meta.label}" class="mk-vid-input" maxlength="500">
      <button type="button" class="mk-vid-del" data-mk-action="remove-video" data-mk-platform="${platform}" data-mk-id="${v._id}" aria-label="Remove this video"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    </div>`;
  }).join('');
  const addBtn = document.querySelector('[data-mk-action="add-video"][data-mk-platform="' + platform + '"]');
  if (addBtn) addBtn.disabled = arr.length >= 10;
}
function renderMKVideos() {
  renderMKVideoList('youtube');
  renderMKVideoList('tiktok');
  updateMKVideoCount();
}

// TikTok thumbnails for the editor preview. TikTok has no thumbnail-by-id URL,
// so resolve through our own /api/tiktok-oembed route (same as Link in Bio).
// Cached per session; the branded placeholder shows until the real thumb lands.
const mkTiktokThumbCache = {};   // url -> thumbnail_url string, or null if unavailable
const mkTiktokThumbPending = {};
function mkEnsureTikTokThumb(url) {
  if (!url || !mkExtractTikTokId(url)) return;
  if (Object.prototype.hasOwnProperty.call(mkTiktokThumbCache, url)) return;
  if (mkTiktokThumbPending[url]) return;
  mkTiktokThumbPending[url] = true;
  fetch('/api/tiktok-oembed?url=' + encodeURIComponent(url))
    .then(r => (r.ok ? r.json() : null))
    .then(data => { mkTiktokThumbCache[url] = (data && data.thumbnail_url) ? data.thumbnail_url : null; })
    .catch(() => { mkTiktokThumbCache[url] = null; })
    .finally(() => { delete mkTiktokThumbPending[url]; scheduleMKPreview(); });
}

// ==== Photo carousel (mirrors the Link in Bio image carousel) ====
// Up to 10 images, compressed to WebP (max 1200px, ~120KB) and uploaded to the
// media-kit-photos bucket beside the headshot. Stored as [{photoUrl,w,h}].
function mkCarouselArr() {
  if (!Array.isArray(mkState.carousel)) mkState.carousel = [];
  return mkState.carousel;
}
// Inline status shown inside the Photos section (not a toast), so users can see it.
function setMKCarouselMsg(type, text) {
  const el = document.getElementById('mk-carousel-msg');
  if (!el) return;
  if (!text) { el.hidden = true; el.textContent = ''; el.className = 'mk-carousel-msg'; return; }
  el.hidden = false;
  el.textContent = text;
  el.className = 'mk-carousel-msg is-' + type;
}
async function onMKCarouselImageSelected(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length || !currentUser) return;
  const arr = mkCarouselArr();
  const readDims = (blob) => new Promise((res) => {
    const u = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => { res({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(u); };
    im.onerror = () => { res({ w: 0, h: 0 }); URL.revokeObjectURL(u); };
    im.src = u;
  });
  try {
    for (const file of files) {
      if (arr.length >= 10) { setMKCarouselMsg('info', 'Carousel is full (10 images max).'); break; }
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 25 * 1024 * 1024) { setMKCarouselMsg('error', 'An image was over 25MB and was skipped.'); continue; }
      setMKCarouselMsg('info', `Uploading image ${arr.length + 1}...`);
      const blob = await compressBgImage(file, 1200, 1200, 120 * 1024);
      const dims = await readDims(blob);
      const fileName = `carousel-${Date.now()}-${Math.random().toString(36).slice(2,8)}.webp`;
      const path = `${currentUser.id}/${fileName}`;
      const { error: upErr } = await sb.storage.from('media-kit-photos').upload(path, blob, { contentType: 'image/webp', upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = sb.storage.from('media-kit-photos').getPublicUrl(path);
      arr.push({ photoUrl: publicUrl, w: dims.w, h: dims.h });
    }
    renderMKCarousel();
    scheduleMKPreview();
    setMKCarouselMsg('success', 'Images uploaded. Remember to save.');
  } catch (e) {
    console.error('mk carousel upload', e);
    setMKCarouselMsg('error', `Upload failed: ${e.message || 'unknown'}`);
  }
}
function moveMKCarouselImage(idx, dir) {
  const arr = mkCarouselArr();
  const j = idx + dir;
  if (j < 0 || j >= arr.length) return;
  const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp;
  renderMKCarousel();
  scheduleMKPreview();
}
function removeMKCarouselImage(idx) {
  const arr = mkCarouselArr();
  arr.splice(idx, 1);
  // Removed files orphan in media-kit-photos and are swept by deleteMKStalePhotos()
  // on the next save (it removes any file in the user's folder that is not in use).
  renderMKCarousel();
  scheduleMKPreview();
}
function updateMKCarouselCount() {
  const el = document.getElementById('mk-carousel-count');
  if (!el) return;
  const n = mkCarouselArr().filter(im => im && im.photoUrl).length;
  el.textContent = n > 0 ? (n + (n === 1 ? ' photo' : ' photos')) : '';
}
function renderMKCarousel() {
  const grid = document.getElementById('mk-carousel-thumbs');
  const slot = document.getElementById('mk-carousel-add');
  const arr = mkCarouselArr();
  if (grid) {
    grid.innerHTML = arr.map((im, idx) => `<div class="bio-carousel-thumb">
        <img src="${escapeHtml(im.photoUrl)}" alt="">
        <div class="bio-carousel-thumb-bar">
          <button type="button" aria-label="Move left" data-mk-action="move-carousel-image" data-mk-idx="${idx}" data-mk-dir="-1"${idx === 0 ? ' disabled' : ''}>&lsaquo;</button>
          <button type="button" aria-label="Move right" data-mk-action="move-carousel-image" data-mk-idx="${idx}" data-mk-dir="1"${idx === arr.length - 1 ? ' disabled' : ''}>&rsaquo;</button>
        </div>
        <button type="button" aria-label="Remove image" data-mk-action="remove-carousel-image" data-mk-idx="${idx}" class="bio-carousel-thumb-x">&times;</button>
      </div>`).join('');
    grid.style.display = arr.length ? 'flex' : 'none';
  }
  if (slot) {
    const atMax = arr.length >= 10;
    slot.innerHTML = `<span>${atMax ? 'Carousel full (10 max)' : (arr.length ? '+ Add more images' : '+ Add images')}</span>` +
      (atMax ? '' : `<input type="file" accept="image/*" multiple aria-label="Add carousel images" data-mk-action="carousel-image-selected" data-mk-event="change">`);
  }
  updateMKCarouselCount();
}

// ==== Theme ====
function renderMKThemes() {
  const container = document.getElementById('mk-themes');
  if (!container) return;
  const max = isMax();
  const pro = isPro();
  // All 12 themes unlocked for Pro (Media Kit is Pro-only). Custom is Pro.
  container.innerHTML = BIO_THEMES.map(t => {
    const locked = t.max && !max;
    const selected = mkState.theme === t.key ? 'selected' : '';
    const lockedClass = locked ? 'locked' : '';
    const lock = locked ? `<div class="bio-theme-lock" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>` : '';
    const maxBadge = t.max ? '<div class="bio-theme-max-badge">MAX</div>' : '';

    let swatch, btnBg, nameStyle = '';
    if (t.key === 'custom') {
      swatch = '<div class="bio-theme-swatch bio-s-74a83e" ></div>';
      btnBg = `linear-gradient(135deg,${t.bg},${t.bg2})`;
    } else if (t.image && t.colors) {
      swatch = `<div class="bio-theme-swatch" data-mk-bg="url('${t.image}') center/cover" data-mk-border="1.5px solid rgba(0,0,0,0.4)" data-mk-shadow="0 1px 3px rgba(0,0,0,0.25)"></div>`;
      btnBg = `url('${t.image}') center/cover`;
      // Multi-property nameStyle encoded as data-mk-* attrs (CSP-safe; applied via JS)
      nameStyle = `data-mk-color="${t.colors.text}" data-mk-bg="${hexAlpha(t.colors.bg,0.85)}" data-mk-padding="2px 6px" data-mk-radius="6px" data-mk-display="inline-block"`;
    } else {
      swatch = `<div class="bio-theme-swatch" data-mk-bg="${t.grad}"></div>`;
      btnBg = `linear-gradient(135deg,${t.bg},${t.bg2})`;
      nameStyle = '';
    }

    return `<button type="button" class="bio-theme-btn ${selected} ${lockedClass}" data-theme="${t.key}" data-mk-action="pick-theme" data-mk-theme="${t.key}"
      data-mk-bg="${btnBg}">
      ${swatch}
      <div class="bio-theme-name" ${nameStyle}>${t.name}</div>
      ${maxBadge}
      ${lock}
    </button>`;
  }).join('');

  // Apply data-mk-* style attributes to their elements after rendering.
  // Replaces inline style="..." attributes that strict CSP blocks.
  mkApplyDataStyles(container);

  // Show/hide custom editor panel
  const editor = document.getElementById('mk-custom-editor');
  if (editor) editor.style.display = (mkState.theme === 'custom' && pro) ? 'block' : 'none';
}

function pickMKTheme(t) {
  const theme = BIO_THEMES.find(x => x.key === t);
  if (!theme) return;
  if (theme.pro && !isPro()) {
    showMKStatus('error', `${theme.name} is a Pro feature. Upgrade to unlock.`);
    setTimeout(() => { try { openSettingsModal(); } catch(e){} }, 200);
    return;
  }
  if (theme.max && !isMax()) {
    showMKStatus('error', 'This is a Creator Max feature.');
    setTimeout(() => { try { openSettingsModal(); } catch(e){} }, 200);
    return;
  }
  mkState.theme = t;
  if (t === 'custom' && !mkState.custom_theme) {
    mkState.custom_theme = { bgUrl: '', bgOpacity: 0.4, colors: { ...CUSTOM_THEME_DEFAULTS }, applied: true };
  }
  renderMKThemes();
  syncMKCustomEditorUI();
  scheduleMKPreview();
}

// =====================================================================
// Font picker (media kit) — same dropdown pattern as bio. All free.
// =====================================================================
function renderMKFonts() {
  const select = document.getElementById('mk-font-select');
  if (!select) return;
  select.innerHTML = BIO_FONTS.map(f => {
    const sel = mkState.font_family === f.key ? ' selected' : '';
    // font-family applied programmatically below (CSP-strict)
    return `<option value="${escapeHtml(f.key)}" data-mk-font-family="${f.stack}"${sel}>${escapeHtml(f.name)}</option>`;
  }).join('');
  // Apply per-option font-family programmatically (no inline style attrs)
  Array.from(select.options).forEach(opt => {
    const ff = opt.dataset.mkFontFamily;
    if (ff) opt.style.fontFamily = ff;
  });
  // Resting font-family on the select itself
  const font = getBioFont(mkState.font_family);
  select.style.fontFamily = font.stack;
  injectBioPickerFonts(); // shared loader, no-op after first call
}

function pickMKFont(key) {
  const font = BIO_FONTS.find(f => f.key === key);
  if (!font) return;
  mkState.font_family = font.key;
  const select = document.getElementById('mk-font-select');
  if (select) select.style.fontFamily = font.stack;
  scheduleMKPreview();
}

function syncMKCustomEditorUI() {
  if (!mkState.custom_theme) return;
  const ct = mkState.custom_theme;
  const colors = ct.colors || CUSTOM_THEME_DEFAULTS;
  ['bg','card','text','accent'].forEach(k => {
    const input = document.getElementById(`mk-color-${k}`);
    const hex = document.getElementById(`mk-color-${k}-hex`);
    if (input) input.value = colors[k] || CUSTOM_THEME_DEFAULTS[k];
    if (hex) hex.textContent = (colors[k] || CUSTOM_THEME_DEFAULTS[k]).toLowerCase();
  });
  const bgThumb = document.getElementById('mk-custom-bg-thumb');
  const bgStatus = document.getElementById('mk-custom-bg-status');
  const bgRemove = document.getElementById('mk-custom-bg-remove');
  if (ct.bgUrl) {
    if (bgThumb) bgThumb.style.backgroundImage = `url("${ct.bgUrl}")`;
    if (bgStatus) bgStatus.textContent = 'Background uploaded';
    if (bgRemove) bgRemove.style.display = 'inline-block';
  } else {
    if (bgThumb) bgThumb.style.backgroundImage = '';
    if (bgStatus) bgStatus.textContent = 'No background uploaded';
    if (bgRemove) bgRemove.style.display = 'none';
  }
  const opIn = document.getElementById('mk-custom-bg-opacity');
  const opVal = document.getElementById('mk-custom-bg-opacity-val');
  const op = ct.bgOpacity != null ? ct.bgOpacity : 0.4;
  if (opIn) opIn.value = op;
  if (opVal) opVal.textContent = Math.round(op * 100) + '%';
}

function onMKColorChange(slot, value) {
  if (!mkState.custom_theme) mkState.custom_theme = { bgUrl: '', bgOpacity: 0.4, colors: { ...CUSTOM_THEME_DEFAULTS }, applied: true };
  if (!mkState.custom_theme.colors) mkState.custom_theme.colors = { ...CUSTOM_THEME_DEFAULTS };
  mkState.custom_theme.colors[slot] = value;
  const hex = document.getElementById(`mk-color-${slot}-hex`);
  if (hex) hex.textContent = value.toLowerCase();
  scheduleMKPreview();
}

function resetMKCustomColors() {
  if (!mkState.custom_theme) mkState.custom_theme = { bgUrl: '', bgOpacity: 0.4, colors: { ...CUSTOM_THEME_DEFAULTS }, applied: true };
  mkState.custom_theme.colors = { ...CUSTOM_THEME_DEFAULTS };
  syncMKCustomEditorUI();
  scheduleMKPreview();
}

function onMKCustomOpacityChange(val) {
  if (!mkState.custom_theme) return;
  mkState.custom_theme.bgOpacity = parseFloat(val);
  const opVal = document.getElementById('mk-custom-bg-opacity-val');
  if (opVal) opVal.textContent = Math.round(mkState.custom_theme.bgOpacity * 100) + '%';
  scheduleMKPreview();
}

async function onMKCustomBgSelected(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  if (!isPro()) { showMKStatus('error', 'Custom background is a Pro feature.'); return; }
  if (!file.type.startsWith('image/')) { showMKStatus('error', 'Please upload an image file.'); return; }
  if (file.size > 25 * 1024 * 1024) { showMKStatus('error', 'Image is too large (25MB max).'); return; }

  try {
    showMKStatus('info', 'Uploading…');
    const blob = await compressBgImage(file, 1920, 1280, 450 * 1024);
    const fileName = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const path = `${currentUser.id}/${fileName}`;
    const { error: upErr } = await sb.storage.from('mediakit-backgrounds').upload(path, blob, {
      contentType: 'image/webp', upsert: false,
    });
    if (upErr) throw upErr;
    const { data: { publicUrl } } = sb.storage.from('mediakit-backgrounds').getPublicUrl(path);

    if (mkState.custom_theme?.bgUrl) mkStaleBgs.push(mkState.custom_theme.bgUrl);
    if (!mkState.custom_theme) mkState.custom_theme = { bgUrl: '', bgOpacity: 0.4, colors: { ...CUSTOM_THEME_DEFAULTS }, applied: true };
    mkState.custom_theme.bgUrl = publicUrl;
    syncMKCustomEditorUI();
    scheduleMKPreview();
    showMKStatus('success', 'Background uploaded. Remember to save.');
  } catch (e) {
    console.error(e);
    showMKStatus('error', `Upload failed: ${e.message || 'unknown'}`);
  }
}

function removeMKCustomBg() {
  if (!mkState.custom_theme) return;
  if (mkState.custom_theme.bgUrl) mkStaleBgs.push(mkState.custom_theme.bgUrl);
  mkState.custom_theme.bgUrl = '';
  syncMKCustomEditorUI();
  scheduleMKPreview();
}

// ==== Save / Publish ====
function showMKStatus(kind, msg) {
  const el = document.getElementById('mk-save-status');
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

async function saveMediaKit() {
  if (!currentUser) return;
  if (!isPro()) { showMKStatus('error', 'Media Kit is a Pro feature.'); return; }
  const btn = document.getElementById('mk-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    // Username (shared with Link in Bio)
    const uname = document.getElementById('mk-username').value.trim();
    const originalUname = (typeof bioOriginalUsername !== 'undefined') ? bioOriginalUsername : '';
    if (!uname && originalUname) {
      throw new Error('Username cannot be removed once set.');
    }
    // Contact email is OPTIONAL. But IF entered, must look valid - otherwise
    // it silently disappears from the published kit (buildContact rejects
    // invalid format), which leaves the creator confused about why their
    // email isn't showing. Block at save time to surface the typo
    // immediately, matching the validation already on the publish flow.
    if (mkState.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mkState.contact_email)) {
      throw new Error('Contact email looks invalid.');
    }
    if (uname) {
      if (uname.length < 3) throw new Error('Username must be at least 3 characters.');
      if (!/^[a-z0-9_]+$/.test(uname)) throw new Error('Username: lowercase letters, numbers, underscore only.');
      if (typeof BIO_RESERVED !== 'undefined' && BIO_RESERVED.has(uname)) throw new Error('That username is reserved.');
      // Check availability if changed
      if (uname !== originalUname) {
        // Rate limit: 2 changes per 7 days
        const { allowed, remaining, changes } = await checkUsernameChangeLimit();
        if (!allowed) {
          throw new Error(`You've reached the max username changes. Try again on ${formatNextChangeDate(changes)}.`);
        }
        const { data: existing } = await sb.from('public_profiles').select('user_id').eq('username', uname).maybeSingle();
        if (existing && existing.user_id !== currentUser.id) throw new Error('That username is already taken.');
        const { error: upErr } = await sb.from('profiles').upsert({ user_id: currentUser.id, username: uname }, { onConflict: 'user_id' });
        if (upErr) throw upErr;
        await recordUsernameChange();
        if (typeof bioOriginalUsername !== 'undefined') bioOriginalUsername = uname;
        if (typeof bioState !== 'undefined') bioState.username = uname;
      }
    }

    // Clean rate card — strip _id, only save rows with valid price or note
    const cleanRates = mkState.rate_card
      .filter(r => {
        const p = parseFloat(r.price);
        return (isFinite(p) && p > 0) || (r.note && r.note.trim());
      })
      .map(r => ({
        id: r.id,
        label: (r.label || '').slice(0, 60),
        price: parseFloat(r.price) || 0,
        note: (r.note || '').slice(0, 120),
      }));

    // Normalize social URLs before save
    const cleanSocials = {};
    for (const key of Object.keys(mkState.socials)) {
      const s = mkState.socials[key];
      const count = parseInt(s.count) || 0;
      let url = (s.url || '').trim();
      const platform = MK_SOCIAL_PLATFORMS.find(p => p.key === key);
      // Handle-type platforms store a bare handle, not a URL - leave it as is.
      // url-type platforms get protocol-prepended and URL-validated.
      if (url && !(platform && platform.type === 'username')) {
        // If no protocol, try to prepend https://
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
        // Basic URL validation
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') url = '';
        } catch { url = ''; }
      }
      // Per-platform engagement: keep a clean numeric value if valid.
      let engagement = '';
      if (platform) {
        const eng = parseFloat(s.engagement);
        if (isFinite(eng) && eng >= 0) engagement = eng;
      }
      if (count > 0 || url || engagement !== '') cleanSocials[key] = { count, url, engagement };
    }

    const payload = {
      user_id: currentUser.id,
      headshot_url: mkState.headshot_url || null,
      display_name: mkState.display_name || null,
      handle: mkState.handle || null,
      bio: mkState.bio || null,
      category: mkState.category || null,
      socials: cleanSocials,
      engagement_rate: null,
      audience_mode: mkState.audience_mode === 'automatic' ? 'automatic' : 'manual',
      rate_card: cleanRates,
      videos: (() => {
        const yt = mkVideoArr('youtube').map(v => (v.url || '').trim()).filter(u => u && mkExtractYouTubeId(u)).slice(0, 10);
        const tt = mkVideoArr('tiktok').map(v => (v.url || '').trim()).filter(u => u && mkExtractTikTokId(u)).slice(0, 10);
        return (yt.length || tt.length) ? { youtube: yt, tiktok: tt } : null;
      })(),
      carousel: (() => {
        const imgs = mkCarouselArr().filter(im => im && im.photoUrl).slice(0, 10)
          .map(im => ({ photoUrl: im.photoUrl, w: parseInt(im.w) || 0, h: parseInt(im.h) || 0 }));
        return imgs.length ? imgs : null;
      })(),
      contact_email: mkState.contact_email || null,
      contact_note: mkState.contact_note || null,
      theme: (() => {
        const chosen = BIO_THEMES.find(x => x.key === mkState.theme);
        if (!chosen) return 'purple';
        if (chosen.pro && !isPro()) return 'purple';
        if (chosen.max && !isMax()) return 'purple';
        return mkState.theme;
      })(),
      font_family: (() => {
        const f = BIO_FONTS.find(x => x.key === mkState.font_family);
        return f ? f.key : 'DM Sans';
      })(),
      show_branding: !!mkState.show_branding,
      published: mkState.published,
      custom_theme: mkState.custom_theme || null,
    };
    const { error } = await sb.from('media_kit').upsert(payload, { onConflict: 'user_id' });
    if (error) throw error;

    await deleteMKStalePhotos();
    await deleteMKStaleBgs();
    updateMKPublishUI();
    showMKStatus('success', 'Saved ✓');
    // Re-render username hint so "Press save to change username" disappears
    const mkUname = document.getElementById('mk-username')?.value?.trim();
    if (mkUname) renderMKUsernameAvailable(mkUname);
  } catch (e) {
    console.error(e);
    showMKStatus('error', e.message || 'Save failed.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

async function deleteMKStaleBgs() {
  if (!mkStaleBgs.length) return;
  const paths = mkStaleBgs
    .map(url => {
      const m = url.match(/\/mediakit-backgrounds\/(.+)$/);
      return m ? m[1] : null;
    })
    .filter(Boolean);
  if (paths.length) {
    try { await sb.storage.from('mediakit-backgrounds').remove(paths); } catch (e) { console.warn('mk bg cleanup', e); }
  }
  mkStaleBgs = [];
}

// ============================================================================
// MEDIA KIT — AUDIENCE & STATS: Manual / Automatic mode
// ============================================================================
//
// Two-tab control inside the Audience & Stats collapsible section.
//   - 'manual'    → existing socials + engagement_rate form (unchanged)
//   - 'automatic' → pulls cached IG data from instagram_connections via
//                   /api/instagram-data-fetch and renders inline preview
//
// State lives on mkState.audience_mode and is persisted on saveMediaKit().
// Whichever tab is active at save time becomes the mode shown on the public
// Media Kit page.
//
// Refresh strategy:
//   - On opening the editor, if cache > 24h old or missing, auto-trigger fetch
//   - Manual "Refresh from Instagram" button with 5-minute client-side cooldown
//   - Background pg_cron refreshes every 3 days as a backstop

let mkAudCache = null;        // last-fetched IG data {connected, data, error}
let mkAudInflight = false;    // prevent overlapping fetches
let mkAudRefreshLockUntil = 0; // unix ms; refresh button disabled while in future
let mkYtRefreshLockUntil = 0;  // unix ms; YouTube refresh button cooldown
let mkTtRefreshLockUntil = 0;  // unix ms; TikTok refresh button cooldown
let mkTwRefreshLockUntil = 0;  // unix ms; Twitch refresh button cooldown

function setAudienceMode(mode) {
  mkState.audience_mode = (mode === 'automatic') ? 'automatic' : 'manual';
  // Toggle tab visuals
  const tA = document.getElementById('mk-aud-tab-automatic');
  const tM = document.getElementById('mk-aud-tab-manual');
  const pA = document.getElementById('mk-aud-pane-automatic');
  const pM = document.getElementById('mk-aud-pane-manual');
  if (!tA || !tM || !pA || !pM) return;
  if (mkState.audience_mode === 'automatic') {
    tA.classList.add('mk-aud-tab-active'); tA.setAttribute('aria-selected', 'true');
    tM.classList.remove('mk-aud-tab-active'); tM.setAttribute('aria-selected', 'false');
    pA.style.display = ''; pM.style.display = 'none';
    // Lazy-load the data on first switch in
    if (!mkAudCache && !mkAudInflight) loadAudienceAutomatic();
  } else {
    tM.classList.add('mk-aud-tab-active'); tM.setAttribute('aria-selected', 'true');
    tA.classList.remove('mk-aud-tab-active'); tA.setAttribute('aria-selected', 'false');
    pM.style.display = ''; pA.style.display = 'none';
  }
  if (typeof onMKField === 'function') onMKField();
}

// Apply persisted audience_mode after loadMediaKit. Called from initMediaKitTool.
function syncAudienceModeUI() {
  // Default to automatic in the UI even if mode is manual on first edit, per UX requirement.
  // But if creator has explicitly saved 'manual', respect that.
  const mode = mkState.audience_mode || 'automatic';
  setAudienceMode(mode);
}

async function loadAudienceAutomatic() {
  const mount = document.getElementById('mk-aud-auto-content');
  if (!mount) return;
  mkAudInflight = true;
  mount.innerHTML = '<div class="mk-aud-loading">Pulling your social media data&hellip;</div>';

  try {
    // First check connection status from instagram_connections via Supabase client
    // (cheap read, gives us current cached data without calling Meta if cache is fresh)
    const { data: conn, error } = await sb
      .from('instagram_connections')
      .select('ig_username,profile_picture_url,followers_count,follows_count,media_count,reach_30d,total_interactions_30d,views_30d,profile_views_30d,avg_likes,avg_comments,avg_reel_views,avg_story_views,engagement_rate,demographics_age_gender,demographics_gender,demographics_top_countries,demographics_top_cities,data_last_fetched_at,data_fetch_error')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (error) throw error;

    // YouTube connection (parallel to Instagram). Safe public-ish columns only.
    let ytConn = null;
    try {
      const { data: yc } = await sb
        .from('youtube_connections')
        .select('yt_channel_title,yt_custom_url,thumbnail_url,subscriber_count,view_count,video_count,views_30d,watch_time_minutes_30d,avg_view_duration_seconds,subscribers_gained_30d,likes_30d,comments_30d,shares_30d,engagement_rate,avg_views_per_video,demographics_age_gender,demographics_gender,demographics_top_countries,recent_media,data_last_fetched_at,data_fetch_error')
        .eq('user_id', currentUser.id)
        .maybeSingle();
      ytConn = yc || null;
    } catch (e) {
      console.error('loadAudienceAutomatic YT', e);
    }

    // TikTok connection (parallel). Headline-only columns (no demographics).
    let ttConn = null;
    try {
      const { data: tc } = await sb
        .from('tiktok_connections')
        .select('tt_display_name,tt_avatar_url,tt_profile_web_link,tt_bio_description,tt_is_verified,follower_count,following_count,likes_count,video_count,avg_likes_per_video,recent_media,data_last_fetched_at,data_fetch_error')
        .eq('user_id', currentUser.id)
        .maybeSingle();
      ttConn = tc || null;
    } catch (e) {
      console.error('loadAudienceAutomatic TikTok', e);
    }

    // Twitch connection (parallel). Headline-light columns (followers + profile).
    let twConn = null;
    try {
      const { data: wc } = await sb
        .from('twitch_connections')
        .select('tw_display_name,tw_login,tw_avatar_url,tw_description,tw_broadcaster_type,tw_profile_url,tw_primary_game,tw_created_at,follower_count,recent_media,top_clips,data_last_fetched_at,data_fetch_error')
        .eq('user_id', currentUser.id)
        .maybeSingle();
      twConn = wc || null;
    } catch (e) {
      console.error('loadAudienceAutomatic Twitch', e);
    }

    const STALE_MS = 24 * 60 * 60 * 1000; // 24h, shared by both platforms

    // ---- Instagram: refresh if stale, else use cached row ----
    let igResult = null;
    if (conn) {
      const cacheTs = conn.data_last_fetched_at ? new Date(conn.data_last_fetched_at).getTime() : 0;
      const cacheStale = !cacheTs || (Date.now() - cacheTs) > STALE_MS;
      if (cacheStale) {
        const refreshed = await refreshIGData();
        igResult = (refreshed && refreshed.ok && refreshed.data) ? refreshed.data : conn;
      } else {
        igResult = conn;
      }
    }

    // ---- YouTube: refresh if stale, else use cached row ----
    let ytResult = null;
    if (ytConn) {
      const ytTs = ytConn.data_last_fetched_at ? new Date(ytConn.data_last_fetched_at).getTime() : 0;
      const ytStale = !ytTs || (Date.now() - ytTs) > STALE_MS;
      if (ytStale) {
        const r = await refreshYTData();
        ytResult = (r && r.ok && r.data) ? r.data : ytConn;
      } else {
        ytResult = ytConn;
      }
    }

    // ---- TikTok: refresh if stale, else use cached row ----
    let ttResult = null;
    if (ttConn) {
      const ttTs = ttConn.data_last_fetched_at ? new Date(ttConn.data_last_fetched_at).getTime() : 0;
      const ttStale = !ttTs || (Date.now() - ttTs) > STALE_MS;
      if (ttStale) {
        const r = await refreshTTData();
        ttResult = (r && r.ok && r.data) ? r.data : ttConn;
      } else {
        ttResult = ttConn;
      }
    }

    // ---- Twitch: refresh if stale, else use cached row ----
    let twResult = null;
    if (twConn) {
      const twTs = twConn.data_last_fetched_at ? new Date(twConn.data_last_fetched_at).getTime() : 0;
      const twStale = !twTs || (Date.now() - twTs) > STALE_MS;
      if (twStale) {
        const r = await refreshTWData();
        twResult = (r && r.ok && r.data) ? r.data : twConn;
      } else {
        twResult = twConn;
      }
    }

    mkAudCache = {
      connected: !!igResult,
      data: igResult || null,
      ytConnected: !!ytResult,
      yt: ytResult || null,
      ttConnected: !!ttResult,
      tt: ttResult || null,
      twConnected: !!twResult,
      tw: twResult || null,
    };
    renderAudienceAutomatic();
  } catch (e) {
    console.error('loadAudienceAutomatic', e);
    mount.innerHTML = '<div class="mk-aud-error-note">Couldn\'t load your social data right now. Try again in a moment.</div>';
  } finally {
    mkAudInflight = false;
  }
}

async function refreshIGData() {
  try {
    const session = (await sb.auth.getSession()).data.session;
    if (!session) return { ok: false, error: 'Not authenticated' };
    const r = await fetch('/api/instagram-data-fetch', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token }
    });
    const body = await r.json().catch(() => ({}));
    return body;
  } catch (e) {
    console.error('refreshIGData', e);
    return { ok: false, error: e.message };
  }
}

async function refreshYTData() {
  try {
    const session = (await sb.auth.getSession()).data.session;
    if (!session) return { ok: false, error: 'Not authenticated' };
    const r = await fetch('/api/youtube-data-fetch', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token }
    });
    const body = await r.json().catch(() => ({}));
    return body;
  } catch (e) {
    console.error('refreshYTData', e);
    return { ok: false, error: e.message };
  }
}

async function manualRefreshYT() {
  const btn = document.getElementById('mk-aud-refresh-yt-btn');
  if (!btn) return;
  if (Date.now() < mkYtRefreshLockUntil) return;

  btn.disabled = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg><span class="mk-aud-row-refresh-label">Refreshing&hellip;</span>';

  const res = await refreshYTData();
  if (res && res.ok && res.data) {
    if (mkAudCache) { mkAudCache.ytConnected = true; mkAudCache.yt = res.data; }
    else mkAudCache = { connected: false, data: null, ytConnected: true, yt: res.data };
  }
  mkYtRefreshLockUntil = Date.now() + 5 * 60 * 1000;
  renderAudienceAutomatic();
  setTimeout(() => {
    const b = document.getElementById('mk-aud-refresh-yt-btn');
    if (b) { b.disabled = false; }
    renderAudienceAutomatic();
  }, 5 * 60 * 1000);
}

async function refreshTTData() {
  try {
    const session = (await sb.auth.getSession()).data.session;
    if (!session) return { ok: false, error: 'Not authenticated' };
    const r = await fetch('/api/tiktok-data-fetch', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token }
    });
    const body = await r.json().catch(() => ({}));
    return body;
  } catch (e) {
    console.error('refreshTTData', e);
    return { ok: false, error: e.message };
  }
}

async function manualRefreshTT() {
  const btn = document.getElementById('mk-aud-refresh-tt-btn');
  if (!btn) return;
  if (Date.now() < mkTtRefreshLockUntil) return;

  btn.disabled = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg><span class="mk-aud-row-refresh-label">Refreshing&hellip;</span>';

  const res = await refreshTTData();
  if (res && res.ok && res.data) {
    if (mkAudCache) { mkAudCache.ttConnected = true; mkAudCache.tt = res.data; }
    else mkAudCache = { connected: false, data: null, ttConnected: true, tt: res.data };
  }
  mkTtRefreshLockUntil = Date.now() + 5 * 60 * 1000;
  renderAudienceAutomatic();
  setTimeout(() => {
    const b = document.getElementById('mk-aud-refresh-tt-btn');
    if (b) { b.disabled = false; }
    renderAudienceAutomatic();
  }, 5 * 60 * 1000);
}

async function refreshTWData() {
  try {
    const session = (await sb.auth.getSession()).data.session;
    if (!session) return { ok: false, error: 'Not authenticated' };
    const r = await fetch('/api/twitch-data-fetch', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token }
    });
    const body = await r.json().catch(() => ({}));
    return body;
  } catch (e) {
    console.error('refreshTWData', e);
    return { ok: false, error: e.message };
  }
}

async function manualRefreshTW() {
  const btn = document.getElementById('mk-aud-refresh-tw-btn');
  if (!btn) return;
  if (Date.now() < mkTwRefreshLockUntil) return;

  btn.disabled = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg><span class="mk-aud-row-refresh-label">Refreshing&hellip;</span>';

  const res = await refreshTWData();
  if (res && res.ok && res.data) {
    if (mkAudCache) { mkAudCache.twConnected = true; mkAudCache.tw = res.data; }
    else mkAudCache = { connected: false, data: null, twConnected: true, tw: res.data };
  }
  mkTwRefreshLockUntil = Date.now() + 5 * 60 * 1000;
  renderAudienceAutomatic();
  setTimeout(() => {
    const b = document.getElementById('mk-aud-refresh-tw-btn');
    if (b) { b.disabled = false; }
    renderAudienceAutomatic();
  }, 5 * 60 * 1000);
}

async function manualRefreshIG() {
  const btn = document.getElementById('mk-aud-refresh-btn');
  if (!btn) return;
  if (Date.now() < mkAudRefreshLockUntil) return;

  btn.disabled = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg><span class="mk-aud-row-refresh-label">Refreshing&hellip;</span>';

  const res = await refreshIGData();
  if (res && res.ok && res.data) {
    mkAudCache = { connected: true, data: res.data };
  }
  // Result is communicated by the button state itself: success = data updates
  // on screen + button enters its cooldown countdown; failure = data stays as
  // it was + button just becomes clickable again. No toast needed (and toasts
  // collide with the iOS non-safe zone on devices with a notch).
  // 5-minute cooldown regardless of success — protects rate limits
  mkAudRefreshLockUntil = Date.now() + 5 * 60 * 1000;
  renderAudienceAutomatic();
  // Re-enable after cooldown
  setTimeout(() => {
    const b = document.getElementById('mk-aud-refresh-btn');
    if (b) { b.disabled = false; }
    renderAudienceAutomatic();
  }, 5 * 60 * 1000);
}

function formatLastRefreshed(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const day = d.getDate();
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${month} ${day} at ${hours}:${minutes} ${ampm}`;
}

function fmtNum(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
  return String(Math.round(n));
}

function renderAudienceAutomatic() {
  const mount = document.getElementById('mk-aud-auto-content');
  if (!mount) return;

  if (!mkAudCache) {
    mount.innerHTML = '<div class="mk-aud-loading">Loading&hellip;</div>';
    return;
  }

  // ---- State: not connected ----
  if (!mkAudCache.connected && !mkAudCache.ytConnected && !mkAudCache.ttConnected && !mkAudCache.twConnected) {
    mount.innerHTML = `
      <div class="mk-aud-empty">
        <div class="mk-aud-empty-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3" fill="currentColor"/><circle cx="6" cy="12" r="3" fill="currentColor"/><circle cx="18" cy="19" r="3" fill="currentColor"/><line x1="8.6" y1="10.7" x2="15.4" y2="6.3" stroke="currentColor" stroke-width="2"/><line x1="8.6" y1="13.3" x2="15.4" y2="17.7" stroke="currentColor" stroke-width="2"/></svg>
        </div>
        <div class="mk-aud-empty-title">Sync your social media accounts to auto-fill</div>
        <div class="mk-aud-empty-msg">Connect your social media accounts in settings so Ryxa can sync your follower count, engagement, and audience insights to your media kit. Data refreshes every 24 hours.</div>
        <button type="button" class="mk-aud-cta" data-mk-action="go-to-instagram-connect">Settings</button>
      </div>`;
    return;
  }

  // ---- State: connected, render data ----
  const d = mkAudCache.data || {};
  const handle = d.ig_username ? '@' + d.ig_username : 'Instagram';

  // Format the last-refreshed timestamp as "Apr 30 at 9:45 AM" or hide if none.
  const freshLabel = formatLastRefreshed(d.data_last_fetched_at);

  // Refresh button state — disabled during cooldown
  const remainingMs = Math.max(0, mkAudRefreshLockUntil - Date.now());
  const refreshDisabled = remainingMs > 0;
  const refreshLabel = refreshDisabled
    ? 'Wait ' + Math.ceil(remainingMs / 1000) + 's'
    : 'Refresh';
  const refreshTooltip = 'Auto-refreshes every 24 hours. Click to refresh now.';
  const refreshSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';

  // Friendly "100+ follower" / partial-fetch note
  let errorNoteHtml = '';
  if (d.data_fetch_error) {
    const friendly = /100\+? followers/i.test(d.data_fetch_error)
      ? 'Audience demographics will appear once your account has 100+ followers (Instagram requires this to share demographic data).'
      : 'Some data couldn\'t be loaded — your connection may need refreshing. Click Refresh or reconnect Instagram in Settings.';
    errorNoteHtml = `<div class="mk-aud-error-note">${escapeHtml(friendly)}</div>`;
  }

  // Helper: build one platform row. `connected` rows get a working refresh button;
  // "soon" rows show a disabled refresh slot for visual consistency.
  function platformRow(opts) {
    // Every row here is an OAuth-connected platform (we no longer render
    // "Coming soon" placeholders for unconnected ones).
    const statusHtml = `<div class="mk-aud-platform-status mk-aud-platform-status-connected"><span class="mk-aud-status-dot"></span>Connected</div>`;

    // Sublabel under platform name: handle for connected, "Last refreshed ..." second line
    const subParts = [];
    if (opts.handle) subParts.push(`<div class="mk-aud-platform-handle">${escapeHtml(opts.handle)}</div>`);
    if (opts.refreshedLabel) subParts.push(`<div class="mk-aud-platform-fresh">Last refreshed ${escapeHtml(opts.refreshedLabel)}</div>`);

    // Refresh button. CSP-strict: dispatches via data-mk-action (set from
    // opts.action) rather than an inline onclick attribute. Caller passes the
    // action name (e.g. 'manual-refresh-ig').
    const refreshBtnHtml = `<button type="button" id="${opts.btnId || ''}" class="mk-aud-row-refresh" data-mk-action="${opts.action || ''}" title="${escapeHtml(refreshTooltip)}" aria-label="Refresh ${escapeHtml(opts.name)} data" ${opts.disabled ? 'disabled' : ''}>
        ${refreshSvg}<span class="mk-aud-row-refresh-label">${escapeHtml(opts.label || 'Refresh')}</span>
      </button>`;

    return `<div class="mk-aud-platform-row mk-aud-platform-active">
      <div class="mk-aud-platform-left">
        <div class="mk-aud-platform-icon ${opts.iconClass}" aria-hidden="true">${opts.iconSvg}</div>
        <div class="mk-aud-platform-text">
          <div class="mk-aud-platform-name">${escapeHtml(opts.name)}</div>
          ${subParts.join('')}
        </div>
      </div>
      <div class="mk-aud-platform-right">
        ${statusHtml}
        ${refreshBtnHtml}
      </div>
    </div>`;
  }

  // SVG sources (kept inline for copy-paste consistency with the rest of the file)
  const igSvg = '<svg viewBox="0 0 24 24"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>';

  // Only OAuth-connected platforms render here. Today that is Instagram (via
  // instagram_connections). When another platform's OAuth lands, add a
  // platformRow for it gated on that platform's connection data, the same way
  // the Instagram row below is. We intentionally do not render disabled
  // "Coming soon" placeholder rows for platforms that are not connected.
  // YouTube SVG + row computations (rendered only when connected).
  const ytSvg = '<svg viewBox="0 0 24 24"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.54 3.58 12 3.58 12 3.58s-7.54 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3 3 0 0 0 2.1 2.12c1.86.5 9.4.5 9.4.5s7.54 0 9.4-.5a3 3 0 0 0 2.1-2.12C24 15.93 24 12 24 12s0-3.93-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"/></svg>';
  const ytData = mkAudCache.yt || {};
  const ytHandle = ytData.yt_channel_title || (ytData.yt_custom_url || 'YouTube');
  const ytFreshLabel = (typeof formatLastRefreshed === 'function') ? formatLastRefreshed(ytData.data_last_fetched_at) : '';
  const ytRemainingMs = Math.max(0, mkYtRefreshLockUntil - Date.now());
  const ytRefreshDisabled = ytRemainingMs > 0;
  const ytRefreshLabel = ytRefreshDisabled ? 'Wait ' + Math.ceil(ytRemainingMs / 1000) + 's' : 'Refresh';

  // Combined partial-data note (Instagram + YouTube).
  let ytErrorNoteHtml = '';
  if (mkAudCache.ytConnected && ytData.data_fetch_error) {
    const ytFriendly = /demograph/i.test(ytData.data_fetch_error)
      ? 'YouTube audience demographics appear once your channel has enough traffic (YouTube withholds them below a threshold).'
      : 'Some YouTube data couldn\'t be loaded. Click Refresh, or reconnect YouTube in Settings.';
    ytErrorNoteHtml = `<div class="mk-aud-error-note">${escapeHtml(ytFriendly)}</div>`;
  }

  // TikTok SVG + row computations (rendered only when connected). Headline-only.
  const ttSvg = '<svg viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.9a4.85 4.85 0 0 1-1.84-.21Z"/></svg>';
  const ttData = mkAudCache.tt || {};
  const ttHandle = ttData.tt_display_name || 'TikTok';
  const ttFreshLabel = (typeof formatLastRefreshed === 'function') ? formatLastRefreshed(ttData.data_last_fetched_at) : '';
  const ttRemainingMs = Math.max(0, mkTtRefreshLockUntil - Date.now());
  const ttRefreshDisabled = ttRemainingMs > 0;
  const ttRefreshLabel = ttRefreshDisabled ? 'Wait ' + Math.ceil(ttRemainingMs / 1000) + 's' : 'Refresh';

  let ttErrorNoteHtml = '';
  if (mkAudCache.ttConnected && ttData.data_fetch_error) {
    ttErrorNoteHtml = `<div class="mk-aud-error-note">${escapeHtml('Some TikTok data couldn\'t be loaded. Click Refresh, or reconnect TikTok in Settings.')}</div>`;
  }

  // Twitch SVG + row computations (rendered only when connected). Headline-light.
  const twSvg = '<svg viewBox="0 0 24 24"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>';
  const twData = mkAudCache.tw || {};
  const twHandle = twData.tw_display_name || 'Twitch';
  const twFreshLabel = (typeof formatLastRefreshed === 'function') ? formatLastRefreshed(twData.data_last_fetched_at) : '';
  const twRemainingMs = Math.max(0, mkTwRefreshLockUntil - Date.now());
  const twRefreshDisabled = twRemainingMs > 0;
  const twRefreshLabel = twRefreshDisabled ? 'Wait ' + Math.ceil(twRemainingMs / 1000) + 's' : 'Refresh';

  let twErrorNoteHtml = '';
  if (mkAudCache.twConnected && twData.data_fetch_error) {
    twErrorNoteHtml = `<div class="mk-aud-error-note">${escapeHtml('Some Twitch data couldn\'t be loaded. Click Refresh, or reconnect Twitch in Settings.')}</div>`;
  }

  const igRowHtml = mkAudCache.connected ? platformRow({
    name: 'Instagram',
    iconClass: 'mk-aud-platform-ig',
    iconSvg: igSvg,
    connected: true,
    handle: handle,
    refreshedLabel: freshLabel,
    btnId: 'mk-aud-refresh-btn',
    action: 'manual-refresh-ig',
    disabled: refreshDisabled,
    label: refreshLabel
  }) : '';

  const ytRowHtml = mkAudCache.ytConnected ? platformRow({
    name: 'YouTube',
    iconClass: 'mk-aud-platform-yt',
    iconSvg: ytSvg,
    connected: true,
    handle: ytHandle,
    refreshedLabel: ytFreshLabel,
    btnId: 'mk-aud-refresh-yt-btn',
    action: 'manual-refresh-yt',
    disabled: ytRefreshDisabled,
    label: ytRefreshLabel
  }) : '';

  const ttRowHtml = mkAudCache.ttConnected ? platformRow({
    name: 'TikTok',
    iconClass: 'mk-aud-platform-tt',
    iconSvg: ttSvg,
    connected: true,
    handle: ttHandle,
    refreshedLabel: ttFreshLabel,
    btnId: 'mk-aud-refresh-tt-btn',
    action: 'manual-refresh-tt',
    disabled: ttRefreshDisabled,
    label: ttRefreshLabel
  }) : '';

  const twRowHtml = mkAudCache.twConnected ? platformRow({
    name: 'Twitch',
    iconClass: 'mk-aud-platform-tw',
    iconSvg: twSvg,
    connected: true,
    handle: twHandle,
    refreshedLabel: twFreshLabel,
    btnId: 'mk-aud-refresh-tw-btn',
    action: 'manual-refresh-tw',
    disabled: twRefreshDisabled,
    label: twRefreshLabel
  }) : '';

  mount.innerHTML = `
    <div class="mk-aud-connected">
      <div class="mk-aud-toolbar">
        <button type="button" class="mk-aud-add-btn" data-mk-action="add-social-media">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Social Media
        </button>
      </div>
      <div class="mk-aud-platforms">
        ${igRowHtml}
        ${ytRowHtml}
        ${ttRowHtml}
        ${twRowHtml}
      </div>
      ${errorNoteHtml}
      ${ytErrorNoteHtml}
      ${ttErrorNoteHtml}
      ${twErrorNoteHtml}
    </div>`;

  // Now that the cache may have changed, re-render the live preview so
  // the Automatic-mode preview reflects the latest data.
  if (typeof updateMKPreview === 'function') updateMKPreview();
}

function goToInstagramConnect() {
  // Switch to Settings tool and scroll to Connected Accounts box
  if (typeof showTool === 'function') showTool('settings');
  setTimeout(() => {
    const target = document.getElementById('settings-connected-accounts');
    if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

async function toggleMediaKitPublish() {
  if (!currentUser) return;
  if (!isPro()) { showMKStatus('error', 'Media Kit is a Pro feature.'); return; }
  const wantPublish = !mkState.published;
  if (wantPublish) {
    const uname = document.getElementById('mk-username').value.trim();
    if (!uname) { showMKStatus('error', 'Pick a username first.'); return; }
    if (uname.length < 3) { showMKStatus('error', 'Username must be at least 3 characters.'); return; }
    // Contact email is OPTIONAL on publish. If creators leave it blank, the
    // Contact section just doesn't render on the public media kit (handled
    // by the buildContact helper in api/mediakit.js and the contactHtml
    // guard in the live preview). But IF they did enter an email, validate
    // its format so we don't publish a typo like "john@gmail" (no TLD).
    if (mkState.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mkState.contact_email)) {
      // Inline error renders right under the Publish button at the top of
      // the form. Do NOT scroll/focus the email input - that would push the
      // user past the error message they need to see.
      showMKStatus('error', 'Contact email looks invalid.');
      return;
    }
  }
  const btn = document.getElementById('mk-publish-btn');
  btn.disabled = true;
  btn.textContent = wantPublish ? 'Publishing…' : 'Unpublishing…';
  try {
    mkState.published = wantPublish;
    await saveMediaKit();
    updateMKPublishUI();
    showMKStatus('success', wantPublish ? 'Your media kit is live 🎉' : 'Media kit unpublished.');
  } catch (e) {
    mkState.published = !wantPublish;
    showMKStatus('error', 'Failed to ' + (wantPublish ? 'publish' : 'unpublish'));
  } finally {
    btn.disabled = false;
    updateMKPublishUI();
  }
}

function updateMKPublishUI() {
  const dot = document.getElementById('mk-status-dot');
  const label = document.getElementById('mk-status-label');
  const sub = document.getElementById('mk-status-sub');
  const btn = document.getElementById('mk-publish-btn');
  const viewLink = document.getElementById('mk-view-live');
  const uname = document.getElementById('mk-username').value.trim();
  if (mkState.published) {
    dot.style.background = '#4ade80';
    label.textContent = 'Published';
    sub.innerHTML = uname
      ? `Live at <strong class="bio-s-313aee">ryxa.io/mediakit/${escapeHtml(uname)}</strong> <button type="button" data-mk-action="copy-mk-link" data-mk-url="https://ryxa.io/mediakit/${escapeHtml(uname)}" class="bio-s-eaca75">Copy</button>`
      : 'Your media kit is live.';
    btn.textContent = 'Unpublish';
    btn.style.background = 'transparent';
    btn.style.border = '1px solid var(--border-hover)';
    btn.style.color = 'var(--muted)';
    if (viewLink && uname) {
      var mkFullUrl = 'https://www.ryxa.io/mediakit/' + uname;
      if (isPwaMode) {
        viewLink.href = '#';
        viewLink.removeAttribute('target');
        viewLink.textContent = 'Copy link';
        viewLink.onclick = function(e) {
          e.preventDefault();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(mkFullUrl).then(function() {
              viewLink.textContent = 'Copied!';
              setTimeout(function() { viewLink.textContent = 'Copy link'; }, 1500);
            }).catch(function() { fallbackCopy(mkFullUrl); viewLink.textContent = 'Copied!'; setTimeout(function() { viewLink.textContent = 'Copy link'; }, 1500); });
          } else {
            fallbackCopy(mkFullUrl);
            viewLink.textContent = 'Copied!';
            setTimeout(function() { viewLink.textContent = 'Copy link'; }, 1500);
          }
        };
      } else {
        viewLink.href = '/mediakit/' + uname;
        viewLink.setAttribute('target', '_blank');
        viewLink.textContent = 'View live page \u2197';
        viewLink.onclick = null;
      }
      viewLink.style.display = 'inline-flex';
    } else if (viewLink) {
      viewLink.style.display = 'none';
    }
  } else {
    dot.style.background = 'var(--muted2)';
    label.textContent = 'Not published';
    sub.textContent = "Your media kit isn't live yet. Publish to share it.";
    btn.textContent = 'Publish';
    btn.style.background = 'var(--accent)';
    btn.style.border = 'none';
    btn.style.color = '#fff';
    if (viewLink) viewLink.style.display = 'none';
  }
}

// Delete stale media-kit-photos
async function deleteMKStalePhotos() {
  if (!currentUser) return;
  try {
    const { data: files, error: listErr } = await sb.storage.from('media-kit-photos').list(currentUser.id, { limit: 100 });
    if (listErr || !Array.isArray(files)) { mkStalePhotos = []; return; }
    const inUse = new Set();
    const extractPath = (url) => {
      if (!url) return null;
      const m = url.match(/media-kit-photos\/(.+)$/);
      return m ? m[1] : null;
    };
    const p = extractPath(mkState.headshot_url);
    if (p) inUse.add(p);
    // Keep carousel images: same bucket/folder as the headshot.
    (Array.isArray(mkState.carousel) ? mkState.carousel : []).forEach(im => {
      const cp = extractPath(im && im.photoUrl);
      if (cp) inUse.add(cp);
    });
    const toDelete = files.map(f => `${currentUser.id}/${f.name}`).filter(path => !inUse.has(path));
    if (toDelete.length > 0) await sb.storage.from('media-kit-photos').remove(toDelete);
  } catch (e) { console.warn('Failed to cleanup MK stale photos', e); }
  mkStalePhotos = [];
}

// ==== Live preview ====
function scheduleMKPreview() {
  clearTimeout(mkPreviewTimer);
  mkPreviewTimer = setTimeout(updateMKPreview, 200);
}

function updateMKPreview() {
  const iframe = document.getElementById('mk-preview-iframe');
  if (!iframe) return;
  iframe.srcdoc = buildMKPreviewHTML();
}

function buildMKPreviewHTML() {
  const themes = {
    purple:   { bg:'#07070f', surface:'#0f0f1a', surface2:'#161625', text:'#f0eef8', muted:'#b4b2c8', muted2:'#c9c7dc', accent:'#7c3aed', accent2:'#a855f7', glow:'rgba(124,58,237,0.3)', border:'rgba(255,255,255,0.1)', avatarBorder:'linear-gradient(135deg,#a78bfa,#e879f9)' },
    midnight: { bg:'#050508', surface:'#0c0c12', surface2:'#13131b', text:'#f3f4f6', muted:'#c9ccd4', muted2:'#dde0e6', accent:'#4b5563', accent2:'#9ca3af', glow:'rgba(156,163,175,0.25)', border:'rgba(255,255,255,0.09)', avatarBorder:'linear-gradient(135deg,#9ca3af,#e5e7eb)' },
    sunset:   { bg:'#120808', surface:'#1c0e0e', surface2:'#251414', text:'#fff6f0', muted:'#f3c8b2', muted2:'#f7dcca', accent:'#f97316', accent2:'#ec4899', glow:'rgba(249,115,22,0.3)', border:'rgba(255,180,150,0.12)', avatarBorder:'linear-gradient(135deg,#fb923c,#f472b6)' },
    ocean:    { bg:'#040a14', surface:'#0b1424', surface2:'#111d33', text:'#eaf6ff', muted:'#a5c8e0', muted2:'#c3dcf0', accent:'#0891b2', accent2:'#22d3ee', glow:'rgba(34,211,238,0.3)', border:'rgba(150,200,255,0.12)', avatarBorder:'linear-gradient(135deg,#22d3ee,#60a5fa)' },
    forest:   { bg:'#040a06', surface:'#0b1610', surface2:'#11211a', text:'#eefaf2', muted:'#a8ccb7', muted2:'#c5dfd0', accent:'#10b981', accent2:'#34d399', glow:'rgba(52,211,153,0.3)', border:'rgba(150,255,180,0.1)', avatarBorder:'linear-gradient(135deg,#34d399,#a7f3d0)' },
    rose:     { bg:'#140710', surface:'#1e0f1a', surface2:'#2a1624', text:'#fff0f5', muted:'#f0bfd1', muted2:'#f7d5e0', accent:'#e11d48', accent2:'#fb7185', glow:'rgba(251,113,133,0.3)', border:'rgba(255,180,210,0.12)', avatarBorder:'linear-gradient(135deg,#fb7185,#fda4af)' },
    amber:    { bg:'#0f0a04', surface:'#1a1208', surface2:'#251b0e', text:'#fff8ec', muted:'#e7c9a1', muted2:'#f1dcc0', accent:'#d97706', accent2:'#fbbf24', glow:'rgba(251,191,36,0.3)', border:'rgba(255,210,150,0.12)', avatarBorder:'linear-gradient(135deg,#fbbf24,#fde68a)' },
    crimson:  { bg:'#0f0405', surface:'#1a080a', surface2:'#260c10', text:'#fff0f0', muted:'#ecb9b9', muted2:'#f5d0d0', accent:'#b91c1c', accent2:'#ef4444', glow:'rgba(239,68,68,0.3)', border:'rgba(255,160,160,0.12)', avatarBorder:'linear-gradient(135deg,#ef4444,#fca5a5)' },
    electric: { bg:'#050814', surface:'#0b1124', surface2:'#111a38', text:'#eaf0ff', muted:'#a8bce0', muted2:'#c5d4ee', accent:'#2563eb', accent2:'#60a5fa', glow:'rgba(96,165,250,0.35)', border:'rgba(150,180,255,0.14)', avatarBorder:'linear-gradient(135deg,#60a5fa,#a5b4fc)' },
    mint:     { bg:'#030e0c', surface:'#0a1a18', surface2:'#102623', text:'#ecfefa', muted:'#a4d6cd', muted2:'#c3e4de', accent:'#0d9488', accent2:'#2dd4bf', glow:'rgba(45,212,191,0.3)', border:'rgba(150,255,230,0.12)', avatarBorder:'linear-gradient(135deg,#2dd4bf,#a7f3d0)' },
    violet:   { bg:'#0c0418', surface:'#170a26', surface2:'#220f37', text:'#f5ecff', muted:'#c9b8e6', muted2:'#dccdf0', accent:'#6d28d9', accent2:'#c084fc', glow:'rgba(192,132,252,0.3)', border:'rgba(200,170,255,0.12)', avatarBorder:'linear-gradient(135deg,#c084fc,#e9d5ff)' },
    graphite: { bg:'#0a0a0a', surface:'#141414', surface2:'#1e1e1e', text:'#f5f5f5', muted:'#b3b3b3', muted2:'#d1d1d1', accent:'#6b7280', accent2:'#d1d5db', glow:'rgba(209,213,219,0.2)', border:'rgba(255,255,255,0.08)', avatarBorder:'linear-gradient(135deg,#d1d5db,#f3f4f6)' },
  };
  // Apply custom theme if Pro + selected
  let t;
  let bgImageCSS = '';
  let bgOverlayCSS = '';
  if (mkState.theme === 'custom' && isPro() && mkState.custom_theme) {
    t = buildCustomThemeVars(mkState.custom_theme);
    if (mkState.custom_theme.bgUrl) {
      bgImageCSS = `body::after{content:'';position:fixed;inset:0;background-image:url("${escapeHtml(mkState.custom_theme.bgUrl)}");background-size:cover;background-position:center;z-index:-2;}`;
      const darkness = 1 - (mkState.custom_theme.bgOpacity || 0.4);
      bgOverlayCSS = `body::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,${darkness.toFixed(2)});z-index:-1;}`;
    }
  } else if (isImageTheme(mkState.theme)) {
    // Builtin image theme — same pipeline as custom, but with hardcoded
    // colors and image. Free for all users.
    t = buildImageThemeVars(mkState.theme);
    if (t && t.bgUrl) {
      bgImageCSS = `body::after{content:'';position:fixed;inset:0;background-image:url("${escapeHtml(t.bgUrl)}");background-size:cover;background-position:center;z-index:-2;}`;
      bgOverlayCSS = '';
    }
  } else {
    t = themes[mkState.theme] || themes.purple;
  }
  const name = mkState.display_name || 'Your name';
  const initial = (name[0] || '?').toUpperCase();
  const headshot = mkState.headshot_url
    ? `<img src="${escapeHtml(mkState.headshot_url)}" alt="Media kit headshot" style="width:100%;height:100%;border-radius:10px;object-fit:cover;display:block;">`
    : `<div style="width:100%;height:100%;border-radius:10px;background:${t.surface2};display:flex;align-items:center;justify-content:center;font-family:Syne,sans-serif;font-size:40px;font-weight:800;color:${t.text};">${escapeHtml(initial)}</div>`;

  // Audience — branches on audience_mode
  let audienceHtml = '';
  if (mkState.audience_mode === 'automatic') {
    // Build a compact panel per connected platform from the client cache.
    const igData = (typeof mkAudCache !== 'undefined' && mkAudCache && mkAudCache.connected) ? mkAudCache.data : null;
    const ytData = (typeof mkAudCache !== 'undefined' && mkAudCache && mkAudCache.ytConnected) ? mkAudCache.yt : null;
    const ttData = (typeof mkAudCache !== 'undefined' && mkAudCache && mkAudCache.ttConnected) ? mkAudCache.tt : null;
    const twData = (typeof mkAudCache !== 'undefined' && mkAudCache && mkAudCache.twConnected) ? mkAudCache.tw : null;

    const igPath = 'M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z';
    const ytPath = 'M23.5 6.2a3 3 0 0 0-2.1-2.12C19.54 3.58 12 3.58 12 3.58s-7.54 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3 3 0 0 0 2.1 2.12c1.86.5 9.4.5 9.4.5s7.54 0 9.4-.5a3 3 0 0 0 2.1-2.12C24 15.93 24 12 24 12s0-3.93-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z';
    const ttPath = 'M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.9a4.85 4.85 0 0 1-1.84-.21Z';
    const twPath = 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z';
    const svgFor = (path, sz) => `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="currentColor"><path d="${path}"></path></svg>`;

    const panels = [];

    if (igData) {
      const stats = [];
      if (typeof igData.followers_count === 'number') stats.push({ n: formatNumberShort(igData.followers_count), l: 'Followers' });
      if (typeof igData.engagement_rate === 'number') stats.push({ n: igData.engagement_rate.toFixed(2) + '%', l: 'Engagement' });
      if (typeof igData.reach_30d === 'number') stats.push({ n: formatNumberShort(igData.reach_30d), l: '30d Reach' });
      if (typeof igData.total_interactions_30d === 'number') stats.push({ n: formatNumberShort(igData.total_interactions_30d), l: '30d Engagements' });
      if (typeof igData.views_30d === 'number') stats.push({ n: formatNumberShort(igData.views_30d), l: '30d Impressions' });
      if (typeof igData.avg_likes === 'number') stats.push({ n: formatNumberShort(Math.round(igData.avg_likes)), l: 'Avg Likes' });
      if (typeof igData.avg_comments === 'number') stats.push({ n: formatNumberShort(Math.round(igData.avg_comments)), l: 'Avg Comments' });
      const lastSync = (typeof formatLastRefreshed === 'function') ? formatLastRefreshed(igData.data_last_fetched_at) : '';
      panels.push({
        key: 'instagram', label: 'Instagram', path: igPath,
        grad: 'linear-gradient(135deg,#833ab4,#fd1d1d 50%,#fcb045)',
        handle: igData.ig_username ? '@' + igData.ig_username : 'Instagram',
        attribution: lastSync ? 'Verified by Instagram &bull; Last synced ' + escapeHtml(lastSync) : 'Verified by Instagram',
        stats: stats,
        hasDemo: !!(igData.demographics_gender || igData.demographics_top_countries),
      });
    }

    if (ytData) {
      const stats = [];
      if (typeof ytData.subscriber_count === 'number') stats.push({ n: formatNumberShort(ytData.subscriber_count), l: 'Subscribers' });
      if (typeof ytData.view_count === 'number') stats.push({ n: formatNumberShort(ytData.view_count), l: 'Total Views' });
      if (typeof ytData.views_30d === 'number') stats.push({ n: formatNumberShort(ytData.views_30d), l: '30d Views' });
      if (typeof ytData.watch_time_minutes_30d === 'number') stats.push({ n: formatNumberShort(Math.round(ytData.watch_time_minutes_30d / 60)), l: 'Watch Hours' });
      if (typeof ytData.engagement_rate === 'number') stats.push({ n: ytData.engagement_rate.toFixed(2) + '%', l: 'Engagement' });
      if (typeof ytData.avg_views_per_video === 'number') stats.push({ n: formatNumberShort(Math.round(ytData.avg_views_per_video)), l: 'Avg Views/Video' });
      const lastSync = (typeof formatLastRefreshed === 'function') ? formatLastRefreshed(ytData.data_last_fetched_at) : '';
      panels.push({
        key: 'youtube', label: 'YouTube', path: ytPath,
        grad: '#ff0000',
        handle: ytData.yt_channel_title || ytData.yt_custom_url || 'YouTube',
        attribution: lastSync ? 'Verified by YouTube &bull; Last synced ' + escapeHtml(lastSync) : 'Verified by YouTube',
        stats: stats,
        hasDemo: !!(ytData.demographics_gender || ytData.demographics_top_countries),
      });
    }

    if (ttData) {
      const stats = [];
      if (typeof ttData.follower_count === 'number') stats.push({ n: formatNumberShort(ttData.follower_count), l: 'Followers' });
      if (typeof ttData.likes_count === 'number') stats.push({ n: formatNumberShort(ttData.likes_count), l: 'Total Likes' });
      // Recent Engagement from recent_media per-video stats (view-based, with a
      // followers-based fallback). Mirrors computeTtRecentEngagement in mediakit.js.
      (function () {
        const vids = Array.isArray(ttData.recent_media) ? ttData.recent_media : [];
        let sv = 0, sl = 0, sc = 0, nn = 0;
        for (const v of vids) {
          if (!v) continue;
          const lk = (typeof v.likes === 'number') ? v.likes : null;
          const cm = (typeof v.comments === 'number') ? v.comments : null;
          if (lk == null && cm == null) continue;
          sl += lk || 0; sc += cm || 0;
          if (typeof v.views === 'number' && v.views > 0) sv += v.views;
          nn++;
        }
        let er = null;
        if (nn > 0) {
          if (sv > 0) er = ((sl + sc) / sv) * 100;
          else if (typeof ttData.follower_count === 'number' && ttData.follower_count > 0) er = (((sl + sc) / nn) / ttData.follower_count) * 100;
        }
        if (er != null) stats.push({ n: er.toFixed(2) + '%', l: 'Recent Engagement' });
      })();
      if (typeof ttData.video_count === 'number') stats.push({ n: formatNumberShort(ttData.video_count), l: 'Videos' });
      if (typeof ttData.following_count === 'number') stats.push({ n: formatNumberShort(ttData.following_count), l: 'Following' });
      if (typeof ttData.avg_likes_per_video === 'number') stats.push({ n: formatNumberShort(Math.round(ttData.avg_likes_per_video)), l: 'Avg Likes/Video' });
      const lastSync = (typeof formatLastRefreshed === 'function') ? formatLastRefreshed(ttData.data_last_fetched_at) : '';
      panels.push({
        key: 'tiktok', label: 'TikTok', path: ttPath,
        grad: '#010101',
        handle: ttData.tt_display_name || 'TikTok',
        attribution: lastSync ? 'Verified by TikTok &bull; Last synced ' + escapeHtml(lastSync) : 'Verified by TikTok',
        stats: stats,
        hasDemo: false,
        recent: Array.isArray(ttData.recent_media) ? ttData.recent_media.filter(v => v && v.cover).slice(0, 6) : [],
      });
    }

    if (twData) {
      const stats = [];
      if (typeof twData.follower_count === 'number') stats.push({ n: formatNumberShort(twData.follower_count), l: 'Followers' });
      const bt = (twData.tw_broadcaster_type || '').toLowerCase();
      if (bt === 'partner' || bt === 'affiliate') stats.push({ n: bt.charAt(0).toUpperCase() + bt.slice(1), l: 'Channel' });
      const lastSync = (typeof formatLastRefreshed === 'function') ? formatLastRefreshed(twData.data_last_fetched_at) : '';
      const twMetaParts = [];
      if (twData.tw_primary_game && String(twData.tw_primary_game).trim()) twMetaParts.push('Streams ' + escapeHtml(String(twData.tw_primary_game)));
      const twSinceYear = twData.tw_created_at ? new Date(twData.tw_created_at).getFullYear() : null;
      if (twSinceYear && !isNaN(twSinceYear)) twMetaParts.push('On Twitch since ' + twSinceYear);
      panels.push({
        key: 'twitch', label: 'Twitch', path: twPath,
        grad: '#9146FF',
        handle: twData.tw_display_name || 'Twitch',
        attribution: lastSync ? 'Verified by Twitch &bull; Last synced ' + escapeHtml(lastSync) : 'Verified by Twitch',
        stats: stats,
        hasDemo: false,
        meta: twMetaParts.join(' &bull; '),
        recent: Array.isArray(twData.recent_media) ? twData.recent_media.filter(v => v && v.cover).slice(0, 6) : [],
        recentLabel: 'Recent Streams',
        recentAspect: '16/9',
        clips: Array.isArray(twData.top_clips) ? twData.top_clips.filter(v => v && v.cover).slice(0, 6) : [],
        clipsLabel: 'Top Clips',
      });
    }

    if (panels.length === 0) {
      // Not connected (or cache not loaded yet) — friendly placeholder
      audienceHtml = `<div class="sec">
        <div class="sec-t">Audience &amp; Stats</div>
        <div style="padding:14px;background:${t.surface2};border:1px dashed ${t.border};border-radius:10px;text-align:center;font-size:10px;color:${t.muted};">
          Sync your social media accounts to auto-fill this section.
        </div>
      </div>`;
    } else {
      // Tab chips (one per connected platform). The preview is static, so the
      // first platform's panel is shown; switching is interactive on the
      // published page. With a single platform, no chip strip is shown.
      const chipsHtml = panels.length > 1 ? `<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
        ${panels.map((p, i) => `<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:999px;font-size:9px;font-family:'DM Sans',sans-serif;border:1px solid ${i === 0 ? t.accent2 : t.border};background:${i === 0 ? t.surface : t.surface2};color:${i === 0 ? t.text : t.muted};">
          <span style="display:inline-flex;">${svgFor(p.path, 11)}</span>${escapeHtml(p.label)}
        </span>`).join('')}
      </div>` : '';

      const active = panels[0];

      const headerHtml = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="width:24px;height:24px;border-radius:6px;background:${active.grad};display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;">
          ${svgFor(active.path, 12)}
        </div>
        <div style="min-width:0;flex:1;">
          <div style="font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:${t.text};">${escapeHtml(active.handle)}</div>
          <div style="font-size:8px;color:${t.muted};text-transform:uppercase;letter-spacing:0.06em;">${active.attribution}</div>
        </div>
      </div>`;

      const statsHtml = active.stats.length > 0 ? `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
        ${active.stats.map(s => `<div style="background:${t.surface2};border:1px solid ${t.border};border-radius:8px;padding:8px 10px;">
          <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:${t.text};">${escapeHtml(s.n)}</div>
          <div style="font-size:8px;color:${t.muted};text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">${escapeHtml(s.l)}</div>
        </div>`).join('')}
      </div>` : '';

      const demoHint = active.hasDemo ? `<div style="margin-top:8px;padding:8px 10px;background:${t.surface2};border:1px solid ${t.border};border-radius:8px;font-size:9px;color:${t.muted};text-align:center;">+ Audience demographics shown on published page</div>` : '';

      const recentHtml = (active.recent && active.recent.length) ? `<div style="margin-top:10px;">
        <div style="font-size:8px;color:${t.muted};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;">${escapeHtml(active.recentLabel || 'Recent Videos')}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;">
          ${active.recent.slice(0, 6).map(v => `<div style="aspect-ratio:${active.recentAspect || '9/16'};border-radius:6px;overflow:hidden;background:${t.surface2};border:1px solid ${t.border};"><img src="${escapeHtml(v.cover)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;"></div>`).join('')}
        </div>
      </div>` : '';

      const clipsHtml = (active.clips && active.clips.length) ? `<div style="margin-top:10px;">
        <div style="font-size:8px;color:${t.muted};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;">${escapeHtml(active.clipsLabel || 'Top Clips')}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;">
          ${active.clips.slice(0, 6).map(v => `<div style="aspect-ratio:${active.recentAspect || '16/9'};border-radius:6px;overflow:hidden;background:${t.surface2};border:1px solid ${t.border};"><img src="${escapeHtml(v.cover)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;"></div>`).join('')}
        </div>
      </div>` : '';

      // Cross-platform follower-split donut (mirrors api/mediakit.js). Dynamic:
      // any connected platform with followers joins; renders at 2+ platforms.
      const splitReg = [
        { name: 'Instagram', color: '#E1306C', count: (igData && typeof igData.followers_count === 'number') ? igData.followers_count : 0 },
        { name: 'YouTube', color: '#FF0000', count: (ytData && typeof ytData.subscriber_count === 'number') ? ytData.subscriber_count : 0 },
        { name: 'TikTok', color: '#25F4EE', count: (ttData && typeof ttData.follower_count === 'number') ? ttData.follower_count : 0 },
        { name: 'Twitch', color: '#9146FF', count: (twData && typeof twData.follower_count === 'number') ? twData.follower_count : 0 },
      ];
      const splitSlices = splitReg.filter(s => s.count > 0);
      let splitDonutHtml = '';
      if (splitSlices.length >= 2) {
        const splitTotal = splitSlices.reduce((a, b) => a + b.count, 0);
        const dsize = 120, dstroke = 18, dr = (dsize - dstroke) / 2, dcx = dsize / 2, dcy = dsize / 2, dcirc = 2 * Math.PI * dr;
        let dcum = 0;
        const dsegs = splitSlices.map(s => {
          const dash = (s.count / splitTotal) * dcirc;
          const seg = `<circle cx="${dcx}" cy="${dcy}" r="${dr}" fill="none" stroke="${s.color}" stroke-width="${dstroke}" stroke-dasharray="${dash.toFixed(2)} ${(dcirc - dash).toFixed(2)}" stroke-dashoffset="${(-dcum).toFixed(2)}"></circle>`;
          dcum += dash;
          return seg;
        }).join('');
        const dlegend = splitSlices.map(s => {
          const pct = Math.round((s.count / splitTotal) * 100);
          return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0;"></span>
            <span style="font-size:9px;color:${t.text};flex:1;">${escapeHtml(s.name)}</span>
            <span style="font-family:'Syne',sans-serif;font-size:9px;color:${t.text};font-weight:800;">${pct}%</span>
          </div>`;
        }).join('');
        splitDonutHtml = `<div style="margin-top:12px;padding:12px;background:${t.surface2};border:1px solid ${t.border};border-radius:10px;">
          <div style="font-size:8px;color:${t.muted};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Audience Split</div>
          <div style="display:flex;align-items:center;gap:14px;">
            <svg viewBox="0 0 ${dsize} ${dsize}" width="84" height="84" style="flex-shrink:0;">
              <g transform="rotate(-90 ${dcx} ${dcy})">
                <circle cx="${dcx}" cy="${dcy}" r="${dr}" fill="none" stroke="${t.border}" stroke-width="${dstroke}"></circle>
                ${dsegs}
              </g>
            </svg>
            <div style="flex:1;">${dlegend}</div>
          </div>
        </div>`;
      }

      const metaHtml = active.meta ? `<div style="font-size:9px;color:${t.muted};margin:-4px 0 10px;line-height:1.5;">${active.meta}</div>` : '';

      audienceHtml = `<div class="sec">
        <div class="sec-t">Audience &amp; Stats</div>
        ${chipsHtml}
        ${headerHtml}
        ${metaHtml}
        ${statsHtml}
        ${demoHint}
        ${recentHtml}
        ${clipsHtml}
        ${splitDonutHtml}
      </div>`;
    }
  } else {
    // Manual mode — original behavior
    const filledSocials = MK_SOCIAL_PLATFORMS
      .map(p => ({ ...p, data: mkState.socials[p.key] || { count: 0, url: '', engagement: '' } }))
      .filter(p => (parseInt(p.data.count) || 0) > 0);
    const total = filledSocials.reduce((s, p) => s + (parseInt(p.data.count) || 0), 0);
    if (total > 0) {
      const totalHtml = total > 0 ? `<div class="total-block">
        <div class="total-num">${formatNumberShort(total)}</div>
        <div class="total-lbl">Total Followers</div>
      </div>` : '';
      const socialsHtml = filledSocials.length > 0 ? `<div class="stats-list">
        ${filledSocials.map(p => {
          const eng = parseFloat(p.data.engagement);
          const engCell = (isFinite(eng) && eng > 0)
            ? `<div class="stat-eng"><span class="stat-eng-n">${(+eng.toFixed(2))}%</span><span class="stat-eng-l">eng</span></div>`
            : '';
          return `<div class="stat-row">
          <div class="stat-icn">${p.svg}</div>
          <div class="stat-name">${p.label}</div>
          <div class="stat-foll"><span class="stat-foll-n">${formatNumberShort(p.data.count)}</span><span class="stat-foll-l">followers</span></div>
          ${engCell}
        </div>`;
        }).join('')}
      </div>` : '';
      audienceHtml = `<div class="sec">
        <div class="sec-t">Audience</div>
        ${totalHtml}
        ${socialsHtml}
      </div>`;
    }
  }

  // Total Followers strip — only renders in Automatic mode with at least one
  // connected platform. Mirrors api/mediakit.js buildTotalFollowers() output.
  let totalFollowersStripHtml = '';
  if (mkState.audience_mode === 'automatic') {
    const sources = [];
    const igData = (typeof mkAudCache !== 'undefined' && mkAudCache && mkAudCache.connected) ? mkAudCache.data : null;
    if (igData && typeof igData.followers_count === 'number' && igData.followers_count > 0) {
      sources.push({ platform: 'Instagram', count: igData.followers_count });
    }
    const ytTotData = (typeof mkAudCache !== 'undefined' && mkAudCache && mkAudCache.ytConnected) ? mkAudCache.yt : null;
    if (ytTotData && typeof ytTotData.subscriber_count === 'number' && ytTotData.subscriber_count > 0) {
      sources.push({ platform: 'YouTube', count: ytTotData.subscriber_count });
    }
    const ttTotData = (typeof mkAudCache !== 'undefined' && mkAudCache && mkAudCache.ttConnected) ? mkAudCache.tt : null;
    if (ttTotData && typeof ttTotData.follower_count === 'number' && ttTotData.follower_count > 0) {
      sources.push({ platform: 'TikTok', count: ttTotData.follower_count });
    }
    const twTotData = (typeof mkAudCache !== 'undefined' && mkAudCache && mkAudCache.twConnected) ? mkAudCache.tw : null;
    if (twTotData && typeof twTotData.follower_count === 'number' && twTotData.follower_count > 0) {
      sources.push({ platform: 'Twitch', count: twTotData.follower_count });
    }
    if (sources.length > 0) {
      const totalCount = sources.reduce((s, x) => s + x.count, 0);
      totalFollowersStripHtml = `<div class="tfs">
        <div class="tfs-l">Total Followers</div>
        <div class="tfs-v">${formatNumberShort(totalCount)}</div>
        <div class="tfs-s">Combined across all platforms</div>
      </div>`;
    }
  }

  // Rate card
  const validRates = mkState.rate_card.filter(r => parseFloat(r.price) > 0);
  const ratesHtml = validRates.length > 0 ? `<div class="sec">
    <div class="sec-t">Rate Card</div>
    ${validRates.map(r => {
      const lbl = r.label || 'Custom';
      const priceStr = formatMoney(Math.round(parseFloat(r.price)) * 100, {fractionDigits:0});
      return `<div class="rate-r">
        <div>
          <div class="rate-lbl">${escapeHtml(lbl)}</div>
          ${r.note ? `<div class="rate-n">${escapeHtml(r.note)}</div>` : ''}
        </div>
        <div class="rate-p">${priceStr}</div>
      </div>`;
    }).join('')}
  </div>` : '';

  // Videos. Mimics the Link in Bio editor preview exactly: YouTube as i.ytimg
  // thumbnails, TikTok as its real oEmbed thumbnail (via /api/tiktok-oembed, with
  // a branded placeholder until it loads). Static thumbnails only; nothing plays
  // in the preview (the srcdoc has no runtime and the dashboard CSP blocks the
  // YouTube/TikTok player iframes).
  const _ytPrev = (Array.isArray(mkState.videos && mkState.videos.youtube) ? mkState.videos.youtube : [])
    .map(v => (v.url || '').trim()).filter(u => u && mkExtractYouTubeId(u)).slice(0, 10);
  const _ttPrev = (Array.isArray(mkState.videos && mkState.videos.tiktok) ? mkState.videos.tiktok : [])
    .map(v => (v.url || '').trim()).filter(u => u && mkExtractTikTokId(u)).slice(0, 10);
  const _ytPrevCards = _ytPrev.map(u => {
    const id = mkExtractYouTubeId(u);
    const vert = /youtube\.com\/shorts\//i.test(u) ? ' vc-vertical' : '';
    return `<div class="vc${vert}"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="YouTube video thumbnail"></div>`;
  }).join('');
  const _ttPrevCards = _ttPrev.map(u => {
    mkEnsureTikTokThumb(u);
    const thumb = mkTiktokThumbCache[u];
    if (thumb) return `<div class="vc vc-vertical"><img src="${escapeHtml(thumb)}" alt="TikTok video thumbnail"></div>`;
    return `<div class="vc vc-vertical"><div style="width:100%;aspect-ratio:9/16;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:#111;color:#fff;font-size:10px;"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>TikTok</div></div>`;
  }).join('');
  // Carousel arrow buttons, identical to the Link in Bio editor preview.
  const _prevArrows = '<button type="button" class="vids-arrow vids-arrow-l" aria-label="Scroll left" tabindex="-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></button><button type="button" class="vids-arrow vids-arrow-r" aria-label="Scroll right" tabindex="-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>';
  const videosHtml = (_ytPrevCards || _ttPrevCards) ? `<div class="sec">
    <div class="sec-t">Videos</div>
    ${_ytPrevCards ? `<div class="vids">${_prevArrows}<div class="vids-r">${_ytPrevCards}</div></div>` : ''}
    ${_ttPrevCards ? `<div class="vids">${_prevArrows}<div class="vids-r">${_ttPrevCards}</div></div>` : ''}
  </div>` : '';

  // Photos. Mirrors the Link in Bio image carousel: each image keeps its natural
  // aspect (width/height), horizontal and vertical mix freely. Hidden when empty.
  const _carPrev = (Array.isArray(mkState.carousel) ? mkState.carousel : []).filter(im => im && im.photoUrl).slice(0, 10);
  const carouselHtml = _carPrev.length ? `<div class="sec">
    <div class="sec-t">Photos</div>
    <div class="vids">${_prevArrows}<div class="vids-r">${_carPrev.map(im => { const dim = (im.w && im.h) ? ` width="${im.w}" height="${im.h}"` : ''; return `<div class="ic"><img src="${escapeHtml(im.photoUrl)}"${dim} alt="" style="width:100%;height:auto;display:block;"></div>`; }).join('')}</div></div>
  </div>` : '';

  // Contact
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mkState.contact_email || '');
  // Render the Contact section when EITHER a valid email OR a note is
  // present. Previously the note was treated as a supplement to the email
  // and never rendered alone. Now creators can use the note as a standalone
  // "how to reach me" message (e.g., "DM me on Instagram") without needing
  // to expose an email address.
  const hasContent = emailValid || !!mkState.contact_note;
  const contactHtml = hasContent ? `<div class="sec">
    <div class="sec-t">Contact</div>
    ${emailValid ? `<div class="contact-box">${escapeHtml(mkState.contact_email)}</div>` : ''}
    ${mkState.contact_note ? `<div class="contact-n">${escapeHtml(mkState.contact_note)}</div>` : ''}
  </div>` : '';

  const bannerHtml = mkState.show_branding ? `<div class="banner-wrap"><div class="banner"><img src="logo.png" alt="Ryxa" style="width:12px;height:12px;border-radius:3px;"><span>Media Kit powered by <strong>Ryxa</strong></span></div></div>` : '';

  // Resolve selected font with safe fallback
  const _mkFont = getBioFont(mkState.font_family);
  const _mkFontHref = `https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=${_mkFont.gfont}:wght@${_mkFont.weights}&display=swap`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="${_mkFontHref}" rel="stylesheet">
  <style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html{scrollbar-width:thin;scrollbar-color:rgba(124,58,237,0.3) transparent;}
  ::-webkit-scrollbar{width:6px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:rgba(124,58,237,0.3);border-radius:3px;}
  ::-webkit-scrollbar-thumb:hover{background:rgba(124,58,237,0.5);}
  body{font-family:'DM Sans',sans-serif;background:${t.bg};color:${t.text};min-height:100vh;padding:24px 14px;overflow-x:hidden;}
  /* When user picks a non-default font, force it on every element. With the
     DM Sans default, skip this so headings stay in Syne (matching the public
     media kit page's signature heading style). */
  ${(mkState.font_family && mkState.font_family !== 'DM Sans') ? `body, body * { font-family: ${_mkFont.stack} !important; } .banner, .banner *, .banner-wrap, .banner-wrap *, .brand-banner, .brand-banner * { font-family: 'DM Sans', sans-serif !important; }` : ''}
  ${bgImageCSS}
  ${bgOverlayCSS || `body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 50% at 50% 0%,${t.glow} 0%,transparent 60%);pointer-events:none;z-index:0;}`}
  .w{position:relative;z-index:1;max-width:100%;}
  .hero{display:flex;gap:14px;align-items:center;padding:16px;background:${t.surface};border:1px solid ${t.border};border-radius:14px;margin-bottom:10px;}
  .hs-frame{width:80px;height:80px;padding:2px;border-radius:12px;background:${t.avatarBorder};flex-shrink:0;}
  .hs-frame > *{width:100%;height:100%;}
  .h-body{flex:1;min-width:0;}
  .h-name{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;letter-spacing:-0.3px;word-break:break-word;}
  .h-handle{font-size:11px;color:${t.accent2};font-weight:500;margin-top:2px;word-break:break-word;}
  .h-cat{font-size:10px;color:${t.muted};text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;word-break:break-word;}
  .h-bio{font-size:11px;color:${t.muted2};line-height:1.5;margin-top:6px;word-break:break-word;}
  .tfs{background:${t.surface};border:1px solid ${t.border};border-radius:14px;padding:14px 16px;margin-bottom:10px;text-align:center;}
  .tfs-l{font-size:9px;color:${t.muted};text-transform:uppercase;letter-spacing:0.08em;font-weight:600;}
  .tfs-v{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:${t.accent2};letter-spacing:-0.6px;line-height:1.1;margin-top:4px;}
  .tfs-s{font-size:9px;color:${t.muted2};margin-top:3px;}
  .sec{background:${t.surface};border:1px solid ${t.border};border-radius:14px;padding:14px 16px;margin-bottom:10px;}
  .sec-t{font-family:'Syne',sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:${t.accent2};font-weight:700;margin-bottom:10px;}
  .total-block{padding:12px;background:${t.surface2};border:1px solid ${t.border};border-radius:10px;text-align:center;margin-bottom:8px;}
  .total-num{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;letter-spacing:-0.8px;background:${t.avatarBorder};-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1;}
  .total-lbl{font-size:9px;color:${t.muted};text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;}
  .stats-list{display:flex;flex-direction:column;gap:6px;}
  .stat-row{padding:9px 12px;display:flex;align-items:center;gap:10px;}
  .stat-icn{width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:${t.muted2};flex-shrink:0;}
  .stat-icn svg{width:12px;height:12px;fill:currentColor;}
  .stat-name{font-size:11px;font-weight:600;color:${t.text};flex:1;min-width:0;}
  .stat-foll{text-align:right;flex-shrink:0;}
  .stat-foll-n{font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:${t.text};display:block;line-height:1.1;}
  .stat-foll-l{font-size:8px;color:${t.muted};text-transform:uppercase;letter-spacing:0.04em;}
  .stat-eng{text-align:right;flex-shrink:0;min-width:48px;}
  .stat-eng-n{font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:${t.text};display:block;line-height:1.1;}
  .stat-eng-l{font-size:8px;color:${t.muted};text-transform:uppercase;letter-spacing:0.04em;}
  .rate-r{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:start;padding:10px 0;border-bottom:1px solid ${t.border};}
  .rate-r:last-child{border-bottom:none;}
  .rate-lbl{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:${t.text};letter-spacing:-0.1px;word-break:break-word;}
  .rate-n{font-size:10px;color:${t.muted};margin-top:2px;line-height:1.4;word-break:break-word;}
  .rate-p{font-family:'Syne',sans-serif;font-size:14px;font-weight:800;color:${t.accent2};letter-spacing:-0.2px;white-space:nowrap;}
  .vids{width:100%;position:relative;margin-top:6px;}
  .vids + .vids{margin-top:8px;}
  .vids-r{display:flex;align-items:center;gap:10px;padding:2px 0;overflow-x:auto;scrollbar-width:none;}
  .vids-r::-webkit-scrollbar{display:none;}
  .vids-r > :only-child{margin-left:auto;margin-right:auto;}
  .vc{flex:0 0 270px;background:${t.surface};border:1px solid ${t.border};border-radius:12px;overflow:hidden;}
  .vc.vc-vertical{flex-basis:200px;}
  .vc img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:${t.surface2};}
  .vc.vc-vertical img{aspect-ratio:9/16;}
  .ic{flex:0 0 200px;border-radius:10px;overflow:hidden;}
  .ic img{width:100%;height:auto;display:block;}
  /* Preview carousel arrows, small since the preview is itself small (matches Link in Bio). */
  .vids-arrow{position:absolute;top:50%;transform:translateY(-50%);width:28px;height:28px;border-radius:50%;border:1px solid ${t.border};background:${t.surface};color:${t.text};cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2;box-shadow:0 2px 6px rgba(0,0,0,0.2);padding:0;transition:opacity 0.15s,background 0.15s;}
  .vids-arrow:hover{background:${t.surface2};}
  .vids-arrow:disabled{opacity:0.35;cursor:default;}
  .vids-arrow-l{left:2px;}
  .vids-arrow-r{right:2px;}
  .contact-box{display:inline-block;padding:10px 14px;background:${t.surface2};border:1px solid ${t.border};border-radius:8px;color:${t.text};font-size:11px;font-weight:500;word-break:break-all;}
  .contact-n{margin-top:8px;font-size:10px;color:${t.muted2};line-height:1.5;}
  .banner-wrap{text-align:center;margin-top:14px;}
  .banner{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:#0a0a14;border:1px solid ${t.border};border-radius:100px;font-size:9px;color:rgba(255,255,255,0.7);}
  .banner strong{color:#fff;font-weight:600;}
  </style></head><body>
  <div class="w">
    <div class="hero">
      <div class="hs-frame">${headshot}</div>
      <div class="h-body">
        <div class="h-name">${escapeHtml(name)}</div>
        ${mkState.handle ? `<div class="h-handle">${escapeHtml(mkState.handle)}</div>` : ''}
        ${mkState.category ? `<div class="h-cat">${escapeHtml(mkState.category)}</div>` : ''}
        ${mkState.bio ? `<div class="h-bio">${escapeHtml(mkState.bio)}</div>` : ''}
      </div>
    </div>
    ${totalFollowersStripHtml}
    ${audienceHtml}
    ${ratesHtml}
    ${videosHtml}
    ${carouselHtml}
    ${contactHtml}
    ${bannerHtml}
  </div>
  <\u0073cript src="/js/bio-preview-runtime.js"></\u0073cript>
</body></html>`;
}


// =============================================================================
// ACTION REGISTRATIONS (Phase 2) — wires up data-mk-action attributes
// =============================================================================

// Top-of-tool buttons
mkRegisterAction('start-checkout', (e, el) => goToPricing('pro'));
mkRegisterAction('save', () => saveMediaKit());
mkRegisterAction('toggle-publish', () => toggleMediaKitPublish());

// Username input — two handlers via per-event style
mkRegisterAction('remove-readonly', (e, el) => el.removeAttribute('readonly'));
mkRegisterAction('username-input', () => onMKUsernameInput());

// Section accordions
mkRegisterAction('toggle-section', (e, el) => toggleMKSection(el.dataset.mkSection));

// Profile section
mkRegisterAction('open-cropper-headshot', (e, el) => openCropper(el, 'headshot'));
mkRegisterAction('remove-headshot', () => removeHeadshot());
mkRegisterAction('field-change', () => onMKField());
mkRegisterAction('ai-mk-assist', () => aiBioAssist('mk-bio', 300));

// Theme section
mkRegisterAction('custom-bg-selected', (e, el) => onMKCustomBgSelected(el));
mkRegisterAction('remove-custom-bg', () => removeMKCustomBg());
mkRegisterAction('custom-opacity', (e, el) => onMKCustomOpacityChange(el.value));
mkRegisterAction('custom-color', (e, el) => onMKColorChange(el.dataset.mkSlot, el.value));
mkRegisterAction('reset-custom-colors', () => resetMKCustomColors());

// Font section
mkRegisterAction('pick-font', (e, el) => pickMKFont(el.value));

// Theme picker (template literal)
mkRegisterAction('pick-theme', (e, el) => pickMKTheme(el.dataset.mkTheme));

// Audience tabs
mkRegisterAction('set-audience-mode', (e, el) => setAudienceMode(el.dataset.mkMode));
mkRegisterAction('social-engagement', (e, el) => onMKSocialEngagement(el.dataset.mkSocial, el.value));

// Social inputs (template literal)
mkRegisterAction('social-count', (e, el) => onMKSocialCount(el.dataset.mkSocial, el.value));
mkRegisterAction('pull-socials-from-bio', () => pullSocialsFromBio());
mkRegisterAction('social-url', (e, el) => onMKSocialUrl(el.dataset.mkSocial, el.value));

// Rate card (template literal)
mkRegisterAction('add-custom-rate', () => addCustomRate());
mkRegisterAction('clear-rate', (e, el) => clearRate(parseInt(el.dataset.mkId, 10)));
mkRegisterAction('remove-rate', (e, el) => removeRate(parseInt(el.dataset.mkId, 10)));
mkRegisterAction('rate-field', (e, el) => onRateField(parseInt(el.dataset.mkId, 10), el.dataset.mkField, el.value));
mkRegisterAction('add-video', (e, el) => addVideo(el.dataset.mkPlatform));
mkRegisterAction('remove-video', (e, el) => removeVideo(el.dataset.mkPlatform, parseInt(el.dataset.mkId, 10)));
mkRegisterAction('video-field', (e, el) => onVideoField(el.dataset.mkPlatform, parseInt(el.dataset.mkId, 10), el.value));
mkRegisterAction('edit-video', (e, el) => onMKVideoEdit(el.dataset.mkPlatform, parseInt(el.dataset.mkId, 10)));
// Collapse a video row when its input loses focus. focusout bubbles (unlike blur), so
// one delegated listener covers every row, including ones added later.
document.addEventListener('focusout', (e) => {
  const t = e.target;
  if (t && t.classList && t.classList.contains('mk-vid-input')) onMKVideoBlur(t);
});
mkRegisterAction('carousel-image-selected', (e, el) => onMKCarouselImageSelected(el));
mkRegisterAction('move-carousel-image', (e, el) => moveMKCarouselImage(parseInt(el.dataset.mkIdx, 10), parseInt(el.dataset.mkDir, 10)));
mkRegisterAction('remove-carousel-image', (e, el) => removeMKCarouselImage(parseInt(el.dataset.mkIdx, 10)));

// Instagram connection
mkRegisterAction('go-to-instagram-connect', () => goToInstagramConnect());
mkRegisterAction('add-social-media', () => goToInstagramConnect());
mkRegisterAction('manual-refresh-ig', () => manualRefreshIG());
mkRegisterAction('manual-refresh-yt', () => manualRefreshYT());
mkRegisterAction('manual-refresh-tt', () => manualRefreshTT());
mkRegisterAction('manual-refresh-tw', () => manualRefreshTW());

// Copy media kit link (template literal)
mkRegisterAction('copy-mk-link', (e, el) => copyBioLink(el.dataset.mkUrl, el));

