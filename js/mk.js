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
};
let mkStaleBgs = [];
let mkInited = false;
let mkPreviewTimer = null;
let mkStalePhotos = [];
let mkRateIdSeq = 1;

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
    }
  } catch (e) { console.error('loadMediaKit', e); }
  syncMKForm();
  // Reset username hint to default
  var mkHint2 = document.getElementById('mk-username-hint');
  if (mkHint2) { mkHint2.textContent = 'Same username as your Link in Bio. You can change it up to 2 times per week.'; mkHint2.style.color = 'var(--muted)'; }
  renderMKSocials();
  renderMKRates();
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
    removeBtn.style.display = 'inline-block';
  } else {
    const name = mkState.display_name || '?';
    inner.textContent = (name[0] || '?').toUpperCase();
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
  const isOpen = body.style.display !== 'none';
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
        <input type="text" placeholder="yourhandle"
          value="${escapeHtml(data.url || '')}"
          data-mk-action="social-url" data-mk-event="input" data-mk-social="${p.key}"
          aria-label="${p.label} handle">
      </div>`;
    } else {
      urlInput = `<input type="url" placeholder="Paste your full ${escapeHtml(p.label)} URL"
        value="${escapeHtml(data.url || '')}"
        data-mk-action="social-url" data-mk-event="input" data-mk-social="${p.key}"
        aria-label="${p.label} profile URL"
        class="mk-s-2f0e33">`;
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
    showDashToast('success', 'Media Kit changes saved.');
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
  mount.innerHTML = '<div class="mk-aud-loading">Pulling your Instagram data&hellip;</div>';

  try {
    // First check connection status from instagram_connections via Supabase client
    // (cheap read, gives us current cached data without calling Meta if cache is fresh)
    const { data: conn, error } = await sb
      .from('instagram_connections')
      .select('ig_username,profile_picture_url,followers_count,follows_count,media_count,reach_30d,total_interactions_30d,views_30d,profile_views_30d,avg_likes,avg_comments,avg_reel_views,avg_story_views,engagement_rate,demographics_age_gender,demographics_gender,demographics_top_countries,demographics_top_cities,data_last_fetched_at,data_fetch_error')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (error) throw error;

    if (!conn) {
      mkAudCache = { connected: false };
      renderAudienceAutomatic();
      return;
    }

    // Decide: do we need to refresh from Meta, or is cache fresh enough?
    const cacheTs = conn.data_last_fetched_at ? new Date(conn.data_last_fetched_at).getTime() : 0;
    const ageMs = Date.now() - cacheTs;
    const STALE_MS = 24 * 60 * 60 * 1000; // 24h
    const cacheStale = !cacheTs || ageMs > STALE_MS;

    if (cacheStale) {
      // Trigger a fresh fetch in the background
      const refreshed = await refreshIGData();
      if (refreshed && refreshed.ok && refreshed.data) {
        mkAudCache = { connected: true, data: refreshed.data };
      } else {
        // Fall back to whatever is in DB (might still have partial data)
        mkAudCache = { connected: true, data: conn };
      }
    } else {
      mkAudCache = { connected: true, data: conn };
    }
    renderAudienceAutomatic();
  } catch (e) {
    console.error('loadAudienceAutomatic', e);
    mount.innerHTML = '<div class="mk-aud-error-note">Couldn\'t load Instagram data right now. Try again in a moment.</div>';
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

async function manualRefreshIG() {
  const btn = document.getElementById('mk-aud-refresh-btn');
  if (!btn) return;
  if (Date.now() < mkAudRefreshLockUntil) return;

  btn.disabled = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg><span class="mk-aud-row-refresh-label">Refreshing&hellip;</span>';

  const res = await refreshIGData();
  if (res && res.ok && res.data) {
    mkAudCache = { connected: true, data: res.data };
    showDashToast('success', 'Instagram data refreshed.');
  } else {
    showDashToast('error', (res && res.error) || 'Could not refresh Instagram data.');
  }
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
  if (!mkAudCache.connected) {
    mount.innerHTML = `
      <div class="mk-aud-empty">
        <div class="mk-aud-empty-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>
        </div>
        <div class="mk-aud-empty-title">Sync Instagram to auto-fill</div>
        <div class="mk-aud-empty-msg">Connect your Instagram account so Ryxa can sync your follower count, engagement, and audience insights to your media kit. Data refreshes every 24 hours.</div>
        <button type="button" class="mk-aud-cta" data-mk-action="go-to-instagram-connect">Connect Instagram</button>
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
    const isConnected = !!opts.connected;
    const rowClass = isConnected ? 'mk-aud-platform-active' : 'mk-aud-platform-soon';
    const statusHtml = isConnected
      ? `<div class="mk-aud-platform-status mk-aud-platform-status-connected"><span class="mk-aud-status-dot"></span>Connected</div>`
      : `<div class="mk-aud-platform-status">Coming soon</div>`;

    // Sublabel under platform name: handle for connected, "Last refreshed ..." second line
    const subParts = [];
    if (isConnected && opts.handle) subParts.push(`<div class="mk-aud-platform-handle">${escapeHtml(opts.handle)}</div>`);
    if (isConnected && opts.refreshedLabel) subParts.push(`<div class="mk-aud-platform-fresh">Last refreshed ${escapeHtml(opts.refreshedLabel)}</div>`);

    // Refresh button — only Instagram is wired up for now. Coming-soon rows render
    // a disabled placeholder so the row alignment matches. CSP-strict: the button
    // dispatches via data-mk-action (set from opts.action) rather than an inline
    // onclick attribute. Caller passes action name (e.g. 'manual-refresh-ig').
    let refreshBtnHtml;
    if (isConnected) {
      refreshBtnHtml = `<button type="button" id="${opts.btnId || ''}" class="mk-aud-row-refresh" data-mk-action="${opts.action || ''}" title="${escapeHtml(refreshTooltip)}" aria-label="Refresh ${escapeHtml(opts.name)} data" ${opts.disabled ? 'disabled' : ''}>
        ${refreshSvg}<span class="mk-aud-row-refresh-label">${escapeHtml(opts.label || 'Refresh')}</span>
      </button>`;
    } else {
      refreshBtnHtml = `<button type="button" class="mk-aud-row-refresh" disabled aria-hidden="true" tabindex="-1">
        ${refreshSvg}<span class="mk-aud-row-refresh-label">Refresh</span>
      </button>`;
    }

    return `<div class="mk-aud-platform-row ${rowClass}">
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
  const ytSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.54 3.58 12 3.58 12 3.58s-7.54 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3 3 0 0 0 2.1 2.12c1.86.5 9.4.5 9.4.5s7.54 0 9.4-.5a3 3 0 0 0 2.1-2.12C24 15.93 24 12 24 12s0-3.93-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"/></svg>';
  const ttSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.9a4.85 4.85 0 0 1-1.84-.21Z"/></svg>';
  const fbSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>';
  const liSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.26 2.37 4.26 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"/></svg>';

  mount.innerHTML = `
    <div class="mk-aud-connected">
      <div class="mk-aud-platforms">
        ${platformRow({
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
        })}
        ${platformRow({ name: 'YouTube',  iconClass: 'mk-aud-platform-yt', iconSvg: ytSvg })}
        ${platformRow({ name: 'TikTok',   iconClass: 'mk-aud-platform-tt', iconSvg: ttSvg })}
        ${platformRow({ name: 'Facebook', iconClass: 'mk-aud-platform-fb', iconSvg: fbSvg })}
        ${platformRow({ name: 'LinkedIn', iconClass: 'mk-aud-platform-li', iconSvg: liSvg })}
      </div>
      ${errorNoteHtml}
    </div>`;

  // Now that the IG cache may have changed, re-render the live preview so
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
    if (!mkState.contact_email) {
      // Expand contact section, scroll to it, focus the email input, flash it
      const header = document.querySelector('[onclick*="toggleMKSection(\'contact\')"]');
      const body = document.getElementById('mk-body-contact');
      if (body && body.style.display === 'none') {
        toggleMKSection('contact');
      }
      const emailInput = document.getElementById('mk-contact-email');
      if (emailInput) {
        setTimeout(() => {
          emailInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          emailInput.focus();
          emailInput.style.transition = 'box-shadow 0.3s, border-color 0.3s';
          emailInput.style.borderColor = '#ef4444';
          emailInput.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.2)';
          setTimeout(() => {
            emailInput.style.borderColor = '';
            emailInput.style.boxShadow = '';
          }, 2500);
        }, 200);
      }
      showMKStatus('error', 'Add a contact email before publishing.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mkState.contact_email)) {
      const emailInput = document.getElementById('mk-contact-email');
      if (emailInput) {
        emailInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        emailInput.focus();
      }
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
    // Pull from cached IG data on the client (already loaded into mkAudCache)
    const ig = (typeof mkAudCache !== 'undefined' && mkAudCache && mkAudCache.connected) ? mkAudCache.data : null;
    if (!ig) {
      // Not connected (or cache not loaded yet) — show a friendly placeholder in the preview
      audienceHtml = `<div class="sec">
        <div class="sec-t">Audience &amp; Stats</div>
        <div style="padding:14px;background:${t.surface2};border:1px dashed ${t.border};border-radius:10px;text-align:center;font-size:10px;color:${t.muted};">
          Sync Instagram to auto-fill this section.
        </div>
      </div>`;
    } else {
      // Compact preview rendering of the IG data
      const stats = [];
      if (typeof ig.followers_count === 'number') stats.push({ n: formatNumberShort(ig.followers_count), l: 'Followers' });
      if (typeof ig.engagement_rate === 'number') stats.push({ n: ig.engagement_rate.toFixed(2) + '%', l: 'Engagement' });
      if (typeof ig.reach_30d === 'number') stats.push({ n: formatNumberShort(ig.reach_30d), l: '30d Reach' });
      if (typeof ig.total_interactions_30d === 'number') stats.push({ n: formatNumberShort(ig.total_interactions_30d), l: '30d Engagements' });
      if (typeof ig.views_30d === 'number') stats.push({ n: formatNumberShort(ig.views_30d), l: '30d Impressions' });
      if (typeof ig.avg_likes === 'number') stats.push({ n: formatNumberShort(Math.round(ig.avg_likes)), l: 'Avg Likes' });
      if (typeof ig.avg_comments === 'number') stats.push({ n: formatNumberShort(Math.round(ig.avg_comments)), l: 'Avg Comments' });
      if (typeof ig.avg_reel_views === 'number') stats.push({ n: formatNumberShort(Math.round(ig.avg_reel_views)), l: 'Avg Reel Views' });

      const igHandle = ig.ig_username ? '@' + ig.ig_username : 'Instagram';
      // Match the public page: "Verified by Instagram • Last synced Apr 30 at 9:45 AM"
      const lastSyncedLabel = (typeof formatLastRefreshed === 'function')
        ? formatLastRefreshed(ig.data_last_fetched_at)
        : '';
      const attributionInner = lastSyncedLabel
        ? 'Verified by Instagram &bull; Last synced ' + escapeHtml(lastSyncedLabel)
        : 'Verified by Instagram';

      // Compact platform-dots strip — Instagram active, others "coming soon".
      // Mirrors the public page's full tab strip but in a tighter visual that
      // fits the narrow preview column.
      const dotBase = `width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;`;
      const platformDotsHtml = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
        <div title="Instagram (Active)" style="${dotBase}background:linear-gradient(135deg,#833ab4,#fd1d1d 50%,#fcb045);box-shadow:0 0 0 2px ${t.bg}, 0 0 0 3px ${t.accent2};">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>
        </div>
        <div title="YouTube (Coming soon)" style="${dotBase}background:#ff0000;opacity:0.35;">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.54 3.58 12 3.58 12 3.58s-7.54 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3 3 0 0 0 2.1 2.12c1.86.5 9.4.5 9.4.5s7.54 0 9.4-.5a3 3 0 0 0 2.1-2.12C24 15.93 24 12 24 12s0-3.93-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"/></svg>
        </div>
        <div title="TikTok (Coming soon)" style="${dotBase}background:#000;opacity:0.35;">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.9a4.85 4.85 0 0 1-1.84-.21Z"/></svg>
        </div>
        <div title="Facebook (Coming soon)" style="${dotBase}background:#1877f2;opacity:0.35;">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>
        </div>
        <div title="LinkedIn (Coming soon)" style="${dotBase}background:#0a66c2;opacity:0.35;">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.26 2.37 4.26 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"/></svg>
        </div>
      </div>`;

      const headerHtml = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="width:24px;height:24px;border-radius:6px;background:linear-gradient(135deg,#833ab4,#fd1d1d 50%,#fcb045);display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>
        </div>
        <div style="min-width:0;flex:1;">
          <div style="font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:${t.text};">${escapeHtml(igHandle)}</div>
          <div style="font-size:8px;color:${t.muted};text-transform:uppercase;letter-spacing:0.06em;">${attributionInner}</div>
        </div>
      </div>`;

      const statsHtml = stats.length > 0 ? `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
        ${stats.map(s => `<div style="background:${t.surface2};border:1px solid ${t.border};border-radius:8px;padding:8px 10px;">
          <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:${t.text};">${escapeHtml(s.n)}</div>
          <div style="font-size:8px;color:${t.muted};text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">${escapeHtml(s.l)}</div>
        </div>`).join('')}
      </div>` : '';

      // Tiny demographic teaser if we have any
      const hasDemo = ig.demographics_gender || ig.demographics_top_countries;
      const demoHint = hasDemo ? `<div style="margin-top:8px;padding:8px 10px;background:${t.surface2};border:1px solid ${t.border};border-radius:8px;font-size:9px;color:${t.muted};text-align:center;">+ Audience demographics shown on published page</div>` : '';

      audienceHtml = `<div class="sec">
        <div class="sec-t">Audience &amp; Stats</div>
        ${platformDotsHtml}
        ${headerHtml}
        ${statsHtml}
        ${demoHint}
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
            : '<div class="stat-eng"></div>';
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
    // Future: push more rows as platforms come online.
    if (sources.length > 0) {
      const totalCount = sources.reduce((s, x) => s + x.count, 0);
      const platformList = sources.map(s => s.platform).join(', ');
      totalFollowersStripHtml = `<div class="tfs">
        <div class="tfs-l">Total Followers</div>
        <div class="tfs-v">${formatNumberShort(totalCount)}</div>
        <div class="tfs-s">Combined across ${escapeHtml(platformList)}</div>
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

  // Contact
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mkState.contact_email || '');
  const contactHtml = emailValid ? `<div class="sec">
    <div class="sec-t">Contact</div>
    <div class="contact-box">${escapeHtml(mkState.contact_email)}</div>
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
    ${contactHtml}
    ${bannerHtml}
  </div>
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
mkRegisterAction('social-url', (e, el) => onMKSocialUrl(el.dataset.mkSocial, el.value));

// Rate card (template literal)
mkRegisterAction('add-custom-rate', () => addCustomRate());
mkRegisterAction('clear-rate', (e, el) => clearRate(parseInt(el.dataset.mkId, 10)));
mkRegisterAction('remove-rate', (e, el) => removeRate(parseInt(el.dataset.mkId, 10)));
mkRegisterAction('rate-field', (e, el) => onRateField(parseInt(el.dataset.mkId, 10), el.dataset.mkField, el.value));

// Instagram connection
mkRegisterAction('go-to-instagram-connect', () => goToInstagramConnect());
mkRegisterAction('manual-refresh-ig', () => manualRefreshIG());

// Copy media kit link (template literal)
mkRegisterAction('copy-mk-link', (e, el) => copyBioLink(el.dataset.mkUrl, el));

