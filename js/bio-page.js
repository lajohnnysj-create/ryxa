// =================================================================
// Ryxa bio page — extracted from bio.html inline <script> for CSP.
//
// CSP rules applied to bio pages (set by api/bio.js):
//   - No inline <script> tags
//   - No inline event handlers (onclick=, onerror=, etc.)
// Every interaction is wired through the delegation framework below,
// keyed by data-bio-action / data-bio-onerror attributes in HTML.
//
// Bootstrap values that were previously injected as an inline <script>
// (window._creatorCurrency, etc.) are now passed via <meta> tags written
// by api/bio.js, and read here on load.
// =================================================================

// -------- BOOTSTRAP FROM <meta> TAGS --------
(function bootstrapFromMeta() {
  function metaContent(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? el.getAttribute('content') : null;
  }
  var currency = metaContent('ryxa-creator-currency');
  if (currency) window._creatorCurrency = currency;
  var ssrUser = metaContent('ryxa-ssr-username');
  if (ssrUser) window._ssrUsername = ssrUser;
  if (metaContent('ryxa-ssr-hydrated') === 'true') window._ssrHydrated = true;
})();

// -------- DELEGATION FRAMEWORK --------
// Pattern: data-bio-action="foo-bar" → handler registered via bioRegisterAction
// Patches the gap left by removing inline onclick/onkeydown/onerror handlers.
var bioActionHandlers = {};
function bioRegisterAction(name, fn) { bioActionHandlers[name] = fn; }

var bioOnErrorHandlers = {};
function bioRegisterOnError(name, fn) { bioOnErrorHandlers[name] = fn; }

document.addEventListener('click', function(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-bio-action]') : null;
  if (!el) return;
  var action = el.getAttribute('data-bio-action');
  var h = bioActionHandlers[action];
  if (h) h(e, el);
});

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var el = e.target && e.target.closest ? e.target.closest('[data-bio-action]') : null;
  if (!el) return;
  // Only intercept keydown for button-role elements that opted in.
  if (el.getAttribute('role') !== 'button') return;
  var action = el.getAttribute('data-bio-action');
  var h = bioActionHandlers[action];
  if (h) {
    e.preventDefault();
    h(e, el);
  }
});

// onerror can't be delegated via event bubbling (error events don't bubble for <img>).
// Instead we use a capture-phase listener on the document, scoped to elements
// carrying data-bio-onerror.
document.addEventListener('error', function(e) {
  var el = e.target;
  if (!el || !el.getAttribute) return;
  var name = el.getAttribute('data-bio-onerror');
  if (!name) return;
  var h = bioOnErrorHandlers[name];
  if (h) h(e, el);
}, true);

// =================================================================
// ORIGINAL BIO PAGE CODE (extracted from bio.html)
// =================================================================
const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Get username from either a URL query param (?u=username) or from the path segment.
// Returns a strictly sanitized lowercase string of [a-z0-9_] only, or null.
function getUsername() {
  let raw = null;
  const params = new URLSearchParams(window.location.search);
  if (params.has('u')) raw = params.get('u');
  else {
    const m = window.location.pathname.match(/^\/@?([^/?#]+)/);
    if (m) raw = m[1];
  }
  if (!raw) return null;
  const cleaned = String(raw).replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
  return cleaned || null;
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function validUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch { return null; }
}

// Image URLs are restricted to our own Supabase Storage buckets.
// Format a cents amount in the creator's currency
function fmtPrice(cents) {
  var code = window._creatorCurrency || 'USD';
  var localeMap = { USD:'en-US', EUR:'en-IE', GBP:'en-GB', CAD:'en-CA', AUD:'en-AU', JPY:'ja-JP', INR:'en-IN', BRL:'pt-BR', MXN:'es-MX', CHF:'de-CH', SGD:'en-SG', SEK:'sv-SE', NOK:'nb-NO', NZD:'en-NZ', ZAR:'en-ZA' };
  var locale = localeMap[code] || 'en-US';
  var fractionDigits = (code === 'JPY') ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, { style:'currency', currency:code, minimumFractionDigits:fractionDigits, maximumFractionDigits:fractionDigits }).format(cents / 100);
  } catch (e) {
    return '$' + (cents / 100).toFixed(fractionDigits);
  }
}

// Allowed: bio-photos (link-in-bio), media-kit-photos (headshots cross-referenced),
// and bio-backgrounds (Creator Max custom backgrounds — forward-compat).
function validImageUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return null;
    const expectedHost = 'kjytapcgxukalwsyputk.supabase.co';
    if (url.hostname !== expectedHost) return null;
    const allowedBuckets = [
      '/storage/v1/object/public/bio-photos/',
      '/storage/v1/object/public/media-kit-photos/',
      '/storage/v1/object/public/bio-backgrounds/',
      '/storage/v1/object/public/course-covers/',
      '/storage/v1/object/public/coaching-covers/',
      '/storage/v1/object/sign/digital-products/',
    ];
    if (!allowedBuckets.some(b => url.pathname.includes(b))) return null;
    return url.toString();
  } catch { return null; }
}

function extractYouTubeId(url) {
  if (!url) return null;
  // youtube.com/watch?v=ID  |  youtu.be/ID  |  youtube.com/shorts/ID
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function renderNotFound(username) {
  document.title = 'Page not found | Ryxa';
  document.getElementById('wrap').innerHTML = `
    <div class="state notfound">
      <a href="https://www.ryxa.io" class="notfound-logo-link" aria-label="Ryxa home">
        <img src="https://www.ryxa.io/logo.png" alt="Ryxa" class="notfound-logo">
      </a>
      <div class="notfound-orb" aria-hidden="true"></div>
      <h1 class="notfound-title">Hey! This page doesn't exist&hellip;</h1>
      <p class="notfound-sub">${username ? `Looks like <strong>@${esc(username)}</strong> hasn't claimed this Ryxa page yet.` : `Looks like this URL hasn't been claimed yet.`}</p>
      <div class="notfound-actions">
        <div class="notfound-action-row">
          <span class="notfound-action-label">Looking for your store?</span>
          <a class="notfound-btn notfound-btn-secondary" href="https://www.ryxa.io/dashboard.html">Log in to publish</a>
        </div>
        <div class="notfound-action-row">
          <span class="notfound-action-label">Claim your Ryxa page today</span>
          <a class="notfound-btn notfound-btn-primary" href="https://www.ryxa.io/?signup=1">Sign up free &rarr;</a>
        </div>
      </div>
    </div>
  `;
}

function buildAvatar(profile, bio) {
  const name = bio.display_name || profile.username || '';
  const initial = (name[0] || profile.username[0] || '?').toUpperCase();
  const safeAvatar = validImageUrl(bio.avatar_url);
  const isMaxTier = profile.tier === 'max';
  const isHero = bio.avatar_display === 'hero' && safeAvatar && isMaxTier;

  if (isHero) {
    return ''; // hero is rendered separately in the wrap
  }
  if (safeAvatar) {
    return `<div class="avatar-frame">
      <img class="avatar" src="${esc(safeAvatar)}" alt="${esc(name)}">
    </div>`;
  }
  return `<div class="avatar-frame"><div class="avatar-fallback">${esc(initial)}</div></div>`;
}

function buildHeroHeader(profile, bio, socialsHtml) {
  const safeAvatar = validImageUrl(bio.avatar_url);
  const name = bio.display_name || profile.username || '';
  if (!safeAvatar) return '';
  return `<div class="hero-header">
    <img class="hero-header-img" src="${esc(safeAvatar)}" alt="${esc(name)}">
    <div class="hero-header-fade"></div>
  </div>`;
}

// Verified blue check. Shown only when the creator is verified AND on a paid
// plan (Pro or Max); the cancellation webhook flips verified off, but this is a
// second guard so a stale flag can never show a badge on a downgraded account.
// Scales with the surrounding name font via em sizing.
function nameWithBadge(rawName, badge) {
  const n = rawName || '';
  if (!badge) return esc(n);
  const i = n.lastIndexOf(' ');
  if (i === -1) return `<span style="white-space:nowrap;">${esc(n)}${badge}</span>`;
  return `${esc(n.slice(0, i + 1))}<span style="white-space:nowrap;">${esc(n.slice(i + 1))}${badge}</span>`;
}

function verifiedBadgeHtml() {
  return ' <svg class="verified-badge" viewBox="0 0 48 48" role="img" aria-label="Verified"' +
    ' width="0.92em" height="0.92em" style="display:inline-block;vertical-align:-0.1em;flex-shrink:0;">' +
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

function buildLink(link) {
  // Half-width modifier — only used by the four eligible link types: regular
  // links, course cards, booking cards, and digital product cards. Hero,
  // featured, mediakit, subscribe, and headers are full-width only.
  const halfClass = link.halfWidth ? ' link-half' : '';
  // Header — text divider, no link, no clickable anchor
  if (link.isHeader) {
    if (!link.title) return '';
    return `<div class="link-header">${esc(link.title)}</div>`;
  }

  // Subscribe block — email signup form
  if (link.isSubscribe) {
    const heading = esc(link.title || 'Subscribe to my newsletter');
    return `<div class="subscribe-block" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center;">
      <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:12px;">${heading}</div>
      <div style="display:flex;gap:8px;max-width:360px;margin:0 auto;" id="subscribe-form">
        <input type="email" id="subscribe-email" placeholder="Your email" aria-label="Email address" required style="flex:1;padding:10px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:16px;font-family:inherit;outline:none;min-width:0;">
        <button data-bio-action="subscribe-submit" style="padding:10px 18px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;font-family:inherit;cursor:pointer;white-space:nowrap;transition:opacity 0.15s;" id="subscribe-btn">Subscribe</button>
      </div>
      <input type="text" id="subscribe-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;">
      <div id="subscribe-msg" style="display:none;font-size:12px;margin-top:8px;"></div>
    </div>`;
  }

  // Video block — horizontal-scrollable carousel of up to 5 YouTube videos.
  // Sits inline inside the .links container so reordering moves the whole
  // block. Renders nothing (filtered out) when there are no valid videos.
  if (link.isVideoBlock) {
    const videos = Array.isArray(link.videos) ? link.videos : [];
    const cards = videos.map(v => {
      const id = extractYouTubeId(v && (v.url || v.videoId));
      if (!id) return '';
      const thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      return `<div class="video-card" tabindex="0" role="button" aria-label="Play video"
                data-bio-action="play-video" data-bio-video-id="${id}">
        <div class="video-thumb-wrap">
          <img class="video-thumb" src="${thumb}" alt="YouTube video thumbnail" loading="lazy" data-bio-onerror="thumb-fallback" data-bio-video-id="${id}">
          <div class="video-play"><div class="video-play-icon"></div></div>
        </div>
      </div>`;
    }).filter(Boolean).join('');
    if (!cards) return '';
    return `<div class="videos">
      <button type="button" class="videos-arrow videos-arrow-l" aria-label="Scroll left" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></button>
      <button type="button" class="videos-arrow videos-arrow-r" aria-label="Scroll right" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>
      <div class="videos-scroll">${cards}</div>
    </div>`;
  }

  const url = validUrl(link.url);
  if (!url) return '';
  const title = esc(link.title || '');
  const desc = link.description ? `<div class="link-desc">${esc(link.description)}</div>` : '';

  // Hero link — full-image background, no icon
  if (link.isHero) {
    const safePhoto = validImageUrl(link.photoUrl);
    if (safePhoto) {
      return `<a class="link-btn hero-link" href="${esc(url)}" target="_blank" rel="noopener nofollow">
        <img class="hero-bg" src="${esc(safePhoto)}" alt="Link background" loading="lazy">
        <div class="hero-overlay"></div>
        <div class="hero-content">
          <div class="link-title">${title}</div>
          ${desc}
        </div>
      </a>`;
    }
    // Hero without photo falls through to regular style
  }

  if (link.featured) {
    const safePhoto = validImageUrl(link.photoUrl);
    if (safePhoto) {
      return `<a class="featured-link" href="${esc(url)}" target="_blank" rel="noopener nofollow">
        <img class="featured-photo" src="${esc(safePhoto)}" alt="Featured link" loading="lazy">
        <div class="featured-body">
          <div class="featured-title">${title}</div>
          ${link.description ? `<div class="featured-desc">${esc(link.description)}</div>` : ''}
        </div>
      </a>`;
    }
    // Featured without a valid photo falls back to regular style
  }
  // Course link — cover image card with price
  if (link.isCourse) {
    const safePhoto = validImageUrl(link.photoUrl);
    const priceDisplay = link.coursePrice > 0 ? fmtPrice(link.coursePrice) : 'Free';
    const crossoutHtml = link.courseCrossoutPrice > 0 ? '<span style="text-decoration:line-through;opacity:0.5;font-size:12px;margin-right:4px;">' + fmtPrice(link.courseCrossoutPrice) + '</span>' : '';
    const coverHtml = safePhoto ? '<img src="' + esc(safePhoto) + '" alt="Link cover" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px 10px 0 0;display:block;">' : '';
    return '<a class="course-link-card' + halfClass + '" href="' + esc(url) + '" target="_blank" rel="noopener nofollow" style="display:block;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--text);transition:transform 0.15s,border-color 0.15s;">'
      + coverHtml
      + '<div class="clc-body" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">'
      + '<div class="clc-title" style="font-size:13px;font-weight:600;flex:1;min-width:0;">' + title + '</div>'
      + '<div class="clc-price" style="font-size:13px;font-weight:600;flex-shrink:0;margin-left:8px;">' + crossoutHtml + priceDisplay + '</div>'
      + '</div></a>';
  }
  // Coaching link — same card style as courses
  if (link.isCoaching) {
    const safePhoto = validImageUrl(link.photoUrl);
    const priceDisplay = link.coachingPrice > 0 ? fmtPrice(link.coachingPrice) : 'Free';
    const coverHtml = safePhoto ? '<img src="' + esc(safePhoto) + '" alt="Link cover" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px 10px 0 0;display:block;">' : '';
    return '<a class="course-link-card' + halfClass + '" href="' + esc(url) + '" target="_blank" rel="noopener nofollow" style="display:block;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--text);transition:transform 0.15s,border-color 0.15s;">'
      + coverHtml
      + '<div class="clc-body" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">'
      + '<div class="clc-title" style="font-size:13px;font-weight:600;flex:1;min-width:0;">' + title + '</div>'
      + '<div class="clc-price" style="font-size:13px;font-weight:600;flex-shrink:0;margin-left:8px;">' + priceDisplay + '</div>'
      + '</div></a>';
  }
  // Digital Product link — same card style as courses/coaching
  if (link.isProduct) {
    const safePhoto = validImageUrl(link.photoUrl);
    const priceDisplay = link.productPrice > 0 ? fmtPrice(link.productPrice) : 'Free';
    const coverHtml = safePhoto ? '<img src="' + esc(safePhoto) + '" alt="Link cover" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px 10px 0 0;display:block;">' : '';
    return '<a class="course-link-card' + halfClass + '" href="' + esc(url) + '" target="_blank" rel="noopener nofollow" style="display:block;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--text);transition:transform 0.15s,border-color 0.15s;">'
      + coverHtml
      + '<div class="clc-body" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">'
      + '<div class="clc-title" style="font-size:13px;font-weight:600;flex:1;min-width:0;">' + title + '</div>'
      + '<div class="clc-price" style="font-size:13px;font-weight:600;flex-shrink:0;margin-left:8px;">' + priceDisplay + '</div>'
      + '</div></a>';
  }
  // Media Kit link gets a distinct style — headshot background if available, gradient fallback
  if (link.isMediaKit) {
    const mkIconSvg = '<svg class="mediakit-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="17" x2="8" y2="13"/><line x1="12" y1="17" x2="12" y2="11"/><line x1="16" y1="17" x2="16" y2="15"/></svg>';
    const safePhoto = validImageUrl(link.photoUrl);
    if (safePhoto) {
      // Hero style: headshot fills the card, darkened, text/icon in front
      return `<a class="link-btn mediakit-link mediakit-hero" href="${esc(url)}" target="_blank" rel="noopener nofollow" aria-label="View Media Kit">
        <img class="mediakit-hero-bg" src="${esc(safePhoto)}" alt="Link background" loading="lazy">
        <div class="mediakit-hero-overlay"></div>
        <div class="mediakit-hero-content">
          ${mkIconSvg}
          <div class="mediakit-body">
            <div class="link-title">${title}</div>
            ${desc}
          </div>
        </div>
      </a>`;
    }
    // No headshot — purple gradient fallback (original style)
    return `<a class="link-btn mediakit-link" href="${esc(url)}" target="_blank" rel="noopener nofollow">
      ${mkIconSvg}
      <div class="mediakit-body">
        <div class="link-title">${title}</div>
        ${desc}
      </div>
    </a>`;
  }
  const thumbUrl = validImageUrl(link.photoUrl);
  if (thumbUrl) {
    // Image on the left (square, flush to box edge, shares rounded corners with the box).
    // Title/desc fill the rest of the row, padding restored, text centered.
    return `<a class="link-btn link-btn-thumb${halfClass}" href="${esc(url)}" target="_blank" rel="noopener nofollow">
      <img class="link-thumb-img" src="${esc(thumbUrl)}" alt="" loading="lazy">
      <div class="link-thumb-body">
        <div class="link-title">${title}</div>
        ${desc}
      </div>
    </a>`;
  }
  return `<a class="link-btn${halfClass}" href="${esc(url)}" target="_blank" rel="noopener nofollow">
    <div class="link-title">${title}</div>
    ${desc}
  </a>`;
}

// Social icons (SVG, stylized — no trademarked logos)
const SOCIAL_ICONS = {
  instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.9a4.85 4.85 0 0 1-1.84-.21Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93Zm-1.29 19.5h2.04L6.48 3.24H4.3L17.61 20.65Z"/></svg>',
  threads: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.3 11.2c-.1-.05-.2-.1-.3-.14-.18-3.27-1.96-5.14-4.96-5.16-2.04-.01-3.73.85-4.77 2.43l1.84 1.26c.78-1.18 2-1.43 2.94-1.43h.03c1.17.01 2.05.35 2.62 1.01.41.49.69 1.16.82 2-1-.17-2.08-.22-3.24-.15-3.26.19-5.36 2.09-5.22 4.73.07 1.34.74 2.49 1.88 3.24.97.63 2.21.94 3.5.87 1.71-.09 3.05-.74 3.99-1.93.71-.9 1.16-2.07 1.36-3.54.81.49 1.41 1.13 1.74 1.91.57 1.32.6 3.49-1.17 5.26-1.55 1.55-3.42 2.22-6.24 2.24-3.13-.02-5.5-1.03-7.04-2.99C2.83 17.61 2.09 15.04 2.06 12c.03-3.04.77-5.61 2.19-7.42C5.79 2.62 8.16 1.61 11.29 1.59c3.15.02 5.56 1.04 7.16 3.02.79.98 1.38 2.21 1.77 3.65l2.16-.58c-.47-1.77-1.21-3.3-2.23-4.55C18.26 1.94 15.31.65 11.3.63h-.01C7.29.65 4.37 1.94 2.62 4.49 1.06 6.76.25 9.91.21 13.99v.02c.04 4.08.85 7.24 2.41 9.51 1.75 2.55 4.67 3.84 8.68 3.86h.01c3.57-.02 6.08-.96 8.15-3.03 2.71-2.71 2.63-6.1 1.74-8.19-.64-1.5-1.86-2.72-3.53-3.53Zm-5.43 5.66c-1.43.08-2.91-.56-2.99-1.95-.05-1.03.74-2.18 3.08-2.31.27-.02.53-.02.79-.02.85 0 1.64.08 2.36.24-.27 3.35-1.84 3.97-3.24 4.04Z"/></svg>',
  pinterest: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>',
  twitch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.54 3.58 12 3.58 12 3.58s-7.54 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3 3 0 0 0 2.1 2.12c1.86.5 9.4.5 9.4.5s7.54 0 9.4-.5a3 3 0 0 0 2.1-2.12C24 15.93 24 12 24 12s0-3.93-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>',
  snapchat: '<svg viewBox="-4.4 -2.25 24 24" aria-hidden="true"><path d="M12.02 0C5.44 0 4.73 5.08 4.86 7.15c.03.5.05 1.01.06 1.52-.3.16-.79.38-1.29.38-.38 0-.75-.14-1.08-.41-.06-.05-.17-.14-.35-.14-.3 0-.65.17-.92.47-.3.34-.3.78.02 1.08.27.26.7.48 1.2.62.68.19 1.56.49 1.79 1.04.13.3-.01.69-.41 1.17a.35.35 0 0 1-.03.03c-.01.02-1.28 2.08-4.21 2.56-.22.04-.38.24-.36.46 0 .05.02.1.04.15.13.3.56.52 1.32.68.08.02.14.11.17.3.03.18.07.4.17.63.1.23.29.35.55.35.14 0 .3-.03.48-.06.25-.05.57-.11.96-.11.22 0 .44.02.68.06.45.07.83.34 1.27.65.63.45 1.35.96 2.43.96.08 0 .17 0 .26-.02.08.01.2.02.33.02 1.08 0 1.8-.51 2.43-.96.44-.31.82-.58 1.27-.65.24-.04.46-.06.68-.06.38 0 .68.05.96.11.2.04.36.06.48.06h.02c.19 0 .41-.08.53-.35.1-.22.14-.43.17-.62.02-.17.09-.28.17-.3.76-.16 1.19-.38 1.32-.68a.43.43 0 0 0 .04-.15c.02-.22-.14-.42-.36-.46-2.93-.48-4.2-2.54-4.21-2.56a.57.57 0 0 1-.03-.03c-.4-.48-.54-.87-.41-1.17.23-.55 1.11-.85 1.79-1.04.5-.14.93-.36 1.2-.62.33-.32.33-.76.03-1.08-.28-.3-.63-.47-.92-.47-.19 0-.3.08-.35.14-.32.26-.69.41-1.08.41-.5 0-.99-.22-1.29-.38.01-.51.03-1.02.06-1.52.13-2.07-.58-7.15-7.16-7.15Z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.26 2.37 4.26 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"/></svg>',
  website: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.93 9h-3.47a15.6 15.6 0 0 0-1.4-5.33A8 8 0 0 1 19.93 11ZM12 4a13.7 13.7 0 0 1 2.46 7h-4.92A13.7 13.7 0 0 1 12 4ZM4.26 13h3.47a15.6 15.6 0 0 0 1.4 5.33A8 8 0 0 1 4.26 13Zm0-2a8 8 0 0 1 4.87-6.33A15.6 15.6 0 0 0 7.73 11H4.26ZM12 20a13.7 13.7 0 0 1-2.46-7h4.92A13.7 13.7 0 0 1 12 20Zm2.87-1.67A15.6 15.6 0 0 0 16.27 13h3.47a8 8 0 0 1-4.87 5.33Z"/></svg>',
  email: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 4h20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm10 9.44L3.3 6H20.7L12 13.44ZM2 7.6v10.02L8.35 12 2 7.6Zm8.18 5.93L2.74 19h18.52l-7.44-5.48L12 15.14l-1.82-1.61Zm5.47-1.53L22 17.62V7.6l-6.35 4.4Z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.98.98 0 0 0-1.01.24l-1.57 1.97a15.1 15.1 0 0 1-6.92-6.92l1.97-1.57c.27-.27.35-.66.24-1.02A11.2 11.2 0 0 1 8.62 4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.62c0-.55-.45-1-1-1ZM19 12h2a9 9 0 0 0-9-9v2c3.87 0 7 3.13 7 7Zm-4 0h2c0-2.76-2.24-5-5-5v2c1.66 0 3 1.34 3 3Z"/></svg>'
};

function buildSocials(socials) {
  if (!socials || typeof socials !== 'object') return '';
  const order = ['instagram','tiktok','x','threads','youtube','facebook','snapchat','linkedin','pinterest','twitch','website','email','phone'];
  const items = [];
  for (const key of order) {
    const val = socials[key];
    if (!val || typeof val !== 'string' || !val.trim()) continue;
    const href = buildSocialHref(key, val.trim());
    if (!href) continue;
    const target = (key === 'email' || key === 'phone') ? '' : ' target="_blank" rel="noopener nofollow"';
    items.push(`<a class="social-btn" href="${esc(href)}" aria-label="${key}"${target}>${SOCIAL_ICONS[key]}</a>`);
  }
  if (!items.length) return '';
  return `<div class="socials">${items.join('')}</div>`;
}

function buildSocialHref(key, val) {
  const clean = val.replace(/^@/, '').trim();
  // For handle-based platforms, tolerate an old saved value that is a full
  // URL by reducing it to the last path segment (the handle).
  function handleOnly(v) {
    let h = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    if (h.indexOf('/') !== -1) {
      const parts = h.split('/').filter(Boolean);
      h = parts[parts.length - 1] || '';
    }
    return h.replace(/^@/, '').replace(/[?#].*$/, '').trim();
  }
  switch (key) {
    case 'instagram': return 'https://instagram.com/' + encodeURIComponent(handleOnly(clean));
    case 'tiktok':    return 'https://tiktok.com/@' + encodeURIComponent(handleOnly(clean));
    case 'snapchat':  return 'https://snapchat.com/add/' + encodeURIComponent(handleOnly(clean));
    case 'x':         return 'https://x.com/' + encodeURIComponent(handleOnly(clean));
    case 'threads':   return 'https://threads.net/@' + encodeURIComponent(handleOnly(clean));
    case 'linkedin':  return 'https://linkedin.com/in/' + encodeURIComponent(handleOnly(clean));
    case 'pinterest': return 'https://pinterest.com/' + encodeURIComponent(handleOnly(clean));
    case 'twitch':    return 'https://twitch.tv/' + encodeURIComponent(handleOnly(clean));
    case 'youtube':
    case 'facebook':
    case 'website': {
      const u = validUrl(clean) || validUrl('https://' + clean);
      return u;
    }
    case 'email': {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return 'mailto:' + clean;
      return null;
    }
    case 'phone': {
      const digits = clean.replace(/[^\d+]/g, '');
      if (!digits) return null;
      return 'tel:' + digits;
    }
    default: return null;
  }
}

function playVideo(cardEl, videoId) {
  cardEl.innerHTML = `<div class="video-thumb-wrap">
    <iframe class="video-iframe"
      src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1"
      title="YouTube video player"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen loading="lazy"></iframe>
  </div>`;
}

function hexAlpha(hex, alpha) {
  const h = (hex || '#ffffff').replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function applyCustomTheme(ct) {
  const colors = ct?.colors || {};
  const bg = colors.bg || '#07070f';
  const card = colors.card || '#161625';
  const text = colors.text || '#ffffff';
  const accent = colors.accent || '#a78bfa';

  const root = document.documentElement;
  root.style.setProperty('--bg', bg);
  root.style.setProperty('--surface', card);
  root.style.setProperty('--surface2', card);
  root.style.setProperty('--text', text);
  root.style.setProperty('--muted', hexAlpha(text, 0.65));
  root.style.setProperty('--muted2', hexAlpha(text, 0.8));
  root.style.setProperty('--border', hexAlpha(text, 0.1));
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent2', accent);
  root.style.setProperty('--accent-glow', hexAlpha(accent, 0.3));
  root.style.setProperty('--avatar-border', `linear-gradient(135deg, ${accent}, ${accent})`);

  // Custom background image
  if (ct.bgUrl) {
    const op = ct.bgOpacity != null ? ct.bgOpacity : 0.4;
    const darkness = 1 - op;
    // Inject a style tag for the bg image
    let bgStyle = document.getElementById('custom-bg-style');
    if (!bgStyle) {
      bgStyle = document.createElement('style');
      bgStyle.id = 'custom-bg-style';
      document.head.appendChild(bgStyle);
    }
    bgStyle.textContent = `
      :root[data-theme="custom"] body::before {
        content: '';
        position: fixed;
        inset: 0;
        background-image: url("${ct.bgUrl.replace(/"/g, '&quot;')}");
        background-size: cover;
        background-position: center;
        background-color: transparent;
        z-index: -2;
      }
      :root[data-theme="custom"] body::after {
        content: '';
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,${darkness.toFixed(2)});
        z-index: -1;
      }
    `;
  }
}

// Builtin image themes — free for all tiers.
// Mirror of BUILTIN_IMAGE_THEMES in api/bio.js — keep in sync.
const BUILTIN_IMAGE_THEMES = {
  paperwhite: { image:'/bgtemplates/1.webp', colors:{bg:'#FFFFFF',card:'#F5F5F8',text:'#1A1A2E',accent:'#6366F1'} },
  ember:      { image:'/bgtemplates/2.webp', colors:{bg:'#1A1A1C',card:'#262628',text:'#F5F2ED',accent:'#F97316'} },
  sapphire:   { image:'/bgtemplates/3.webp', colors:{bg:'#1E3A8A',card:'#172554',text:'#F5EFE0',accent:'#D4AF37'} },
  blossom:    { image:'/bgtemplates/4.webp', colors:{bg:'#FCE7EB',card:'#F8D7DD',text:'#5C2E3D',accent:'#C9A961'} },
  honey:      { image:'/bgtemplates/5.webp', colors:{bg:'#FCEFC0',card:'#F8E48E',text:'#5C3F17',accent:'#B45309'} },
};

function applyImageTheme(themeKey) {
  const theme = BUILTIN_IMAGE_THEMES[themeKey];
  if (!theme) return false;
  // Reuse the same custom theme pipeline — image themes are just custom
  // themes with hardcoded values and an image. No overlay (overlay opacity 0).
  applyCustomTheme({
    colors: theme.colors,
    bgUrl: theme.image,
    bgOpacity: 1, // 1 means "no overlay darkening"
  });
  return true;
}

// Mirrors BIO_FONTS_SSR in bio.js. Keep in sync when adding new fonts.
const BIO_FONTS_CLIENT = {
  'DM Sans':             { gfont:'DM+Sans',             weights:'300;400;500;600;700', stack:"'DM Sans', sans-serif" },
  'Abril Fatface':       { gfont:'Abril+Fatface',       weights:'400', stack:"'Abril Fatface', serif" },
  'Anton':               { gfont:'Anton',               weights:'400', stack:"'Anton', sans-serif" },
  'Archivo Black':       { gfont:'Archivo+Black',       weights:'400', stack:"'Archivo Black', sans-serif" },
  'Bebas Neue':          { gfont:'Bebas+Neue',          weights:'400', stack:"'Bebas Neue', sans-serif" },
  'Bricolage Grotesque': { gfont:'Bricolage+Grotesque', weights:'400;500;600;700;800', stack:"'Bricolage Grotesque', sans-serif" },
  'Caveat':              { gfont:'Caveat',              weights:'400;500;600;700', stack:"'Caveat', cursive" },
  'Cormorant':           { gfont:'Cormorant',           weights:'400;500;600;700', stack:"'Cormorant', serif" },
  'Fraunces':            { gfont:'Fraunces',            weights:'300;400;500;600;700', stack:"'Fraunces', serif" },
  'Inter':               { gfont:'Inter',               weights:'300;400;500;600;700', stack:"'Inter', sans-serif" },
  'JetBrains Mono':      { gfont:'JetBrains+Mono',      weights:'300;400;500;600;700', stack:"'JetBrains Mono', monospace" },
  'Lora':                { gfont:'Lora',                weights:'400;500;600;700', stack:"'Lora', serif" },
  'Monoton':             { gfont:'Monoton',             weights:'400', stack:"'Monoton', sans-serif" },
  'Nunito':              { gfont:'Nunito',              weights:'300;400;600;700;800', stack:"'Nunito', sans-serif" },
  'Outfit':              { gfont:'Outfit',              weights:'300;400;500;600;700;800', stack:"'Outfit', sans-serif" },
  'Pacifico':            { gfont:'Pacifico',            weights:'400', stack:"'Pacifico', cursive" },
  'Playfair Display':    { gfont:'Playfair+Display',    weights:'400;500;600;700;800', stack:"'Playfair Display', serif" },
  'Plus Jakarta Sans':   { gfont:'Plus+Jakarta+Sans',   weights:'300;400;500;600;700;800', stack:"'Plus Jakarta Sans', sans-serif" },
  'Rubik Mono One':      { gfont:'Rubik+Mono+One',      weights:'400', stack:"'Rubik Mono One', sans-serif" },
  'Space Grotesk':       { gfont:'Space+Grotesk',       weights:'300;400;500;600;700', stack:"'Space Grotesk', sans-serif" },
};

// Apply creator's chosen font (client-side fallback path). When SSR runs,
// the font is already injected — this function checks for that and skips.
// Falls back to default DM Sans if key invalid or not provided.
function applyBioFont(fontKey) {
  // If SSR already injected the override style, do nothing
  if (document.getElementById('bio-font-override')) return;
  // Default ('DM Sans' or null/unknown): no override. The static stylesheet
  // already paints DM Sans on body + Syne on headings for Ryxa's signature look.
  if (!fontKey || fontKey === 'DM Sans') return;
  const font = BIO_FONTS_CLIENT[fontKey] || BIO_FONTS_CLIENT['DM Sans'];
  // Load the Google Font
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${font.gfont}:wght@${font.weights}&display=swap`;
  document.head.appendChild(link);
  // Override the body font with high specificity
  const style = document.createElement('style');
  style.id = 'bio-font-override';
  style.textContent = `body, body * { font-family: ${font.stack} !important; } .brand-banner, .brand-banner * { font-family: 'DM Sans', sans-serif !important; }`;
  document.head.appendChild(style);
}

function updateOgTags({ title, description, image, url }) {
  const setMeta = (property, content) => {
    if (!content) return;
    let el = document.querySelector(`meta[property="${property}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('property', property);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };
  const setName = (name, content) => {
    if (!content) return;
    let el = document.querySelector(`meta[name="${name}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };
  setMeta('og:title', title);
  setMeta('og:description', description);
  setMeta('og:type', 'profile');
  if (url) setMeta('og:url', url);
  if (image) {
    setMeta('og:image', image);
    setMeta('og:image:width', '800');
    setMeta('og:image:height', '800');
  }
  // Twitter card
  setName('twitter:card', image ? 'summary_large_image' : 'summary');
  setName('twitter:title', title);
  setName('twitter:description', description);
  if (image) setName('twitter:image', image);
  // Standard description
  setName('description', description);
}

function render(profile, bio, userTier) {
  const name = bio.display_name || profile.username || '';
  const username = profile.username || '';
  const title = `all of ${username ? '@' + username : name}'s links`;
  document.title = `${name} | Ryxa`;
  const avatar = validImageUrl(bio.avatar_url);
  updateOgTags({
    title: title,
    description: bio.bio || `Find all of ${username ? '@' + username : name}'s links in one place on Ryxa.`,
    image: avatar,
    url: window.location.href,
  });

  // Apply theme — custom theme only honored if user is Max tier
  // Image themes (paperwhite, ember, sapphire, blossom, honey) are free for all.
  const isMaxTier = userTier === 'max';
  if (bio.theme === 'custom' && isMaxTier && bio.custom_theme) {
    applyCustomTheme(bio.custom_theme);
    document.documentElement.setAttribute('data-theme', 'custom');
  } else if (BUILTIN_IMAGE_THEMES[bio.theme]) {
    // Builtin image theme — apply via the same pipeline as custom theme
    applyImageTheme(bio.theme);
    document.documentElement.setAttribute('data-theme', 'custom');
  } else {
    // Theme was custom but user isn't Max, or just a normal preset
    const theme = (bio.theme === 'custom' && !isMaxTier) ? 'purple' : (bio.theme || 'purple');
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Apply font — no-op if SSR already injected. Falls back to default if invalid.
  applyBioFont(bio.font_family);

  // Meta tags
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute('content', title);
  if (bio.bio) {
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', bio.bio);
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', bio.bio);
  }

  const links = Array.isArray(bio.links) ? bio.links : [];
  const socialsHtml = buildSocials(bio.socials);

  const linksHtml = links.map(buildLink).filter(Boolean).join('');

  // Banner rule: always show for non-Pro users (downgrade reverts branding).
  // Pro and Max users can opt out via show_branding=false.
  const isPaid = profile.tier === 'monthly' || profile.tier === 'max';
  const showBanner = !isPaid || bio.show_branding !== false;
  const banner = showBanner ? `<a class="brand-banner" href="https://www.ryxa.io"><img src="https://www.ryxa.io/logo.png" alt="Ryxa" class="brand-banner-logo"><span>Get your free link-in-bio at <strong>Ryxa</strong></span></a>` : '';
  if (showBanner) document.body.style.paddingBottom = '80px';

  const isHeroMode = bio.avatar_display === 'hero' && validImageUrl(bio.avatar_url) && isMaxTier;

  // Verified badge: only when verified AND on a paid plan (Pro = 'monthly', Max = 'max').
  const showVerified = !!profile.verified && (userTier === 'monthly' || userTier === 'max');
  const nameBadge = showVerified ? verifiedBadgeHtml() : '';

  if (isHeroMode) {
    document.getElementById('wrap').classList.add('hero-mode');
    document.getElementById('wrap').innerHTML = `
      ${buildHeroHeader(profile, bio, socialsHtml)}
      <div class="hero-content-below">
        <div class="name">${nameWithBadge(name, nameBadge)}</div>
        ${socialsHtml}
        ${bio.bio ? `<div class="bio">${esc(bio.bio)}</div>` : ''}
        ${linksHtml ? `<div class="links">${linksHtml}</div>` : ''}
        ${banner}
      </div>
    `;
  } else {
    document.getElementById('wrap').innerHTML = `
      ${buildAvatar(profile, bio)}
      <div class="name">${nameWithBadge(name, nameBadge)}</div>
      ${socialsHtml}
      ${bio.bio ? `<div class="bio">${esc(bio.bio)}</div>` : ''}
      ${linksHtml ? `<div class="links">${linksHtml}</div>` : ''}
      ${banner}
    `;
  }
  initVideoArrows();
}

// Wire up the desktop arrow buttons on every YouTube carousel. Each .videos
// block has a left + right arrow that scrolls the inner .videos-scroll by
// roughly one card width. Buttons disable when there's no more room to
// scroll in that direction.
function initVideoArrows() {
  const blocks = document.querySelectorAll('.videos');
  blocks.forEach(block => {
    if (block.dataset.arrowsInit) return;
    block.dataset.arrowsInit = '1';
    const scroller = block.querySelector('.videos-scroll');
    const left = block.querySelector('.videos-arrow-l');
    const right = block.querySelector('.videos-arrow-r');
    if (!scroller || !left || !right) return;

    const cardWidth = 272; // 260px card + 12px gap
    const updateState = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      // Tolerance for sub-pixel rounding
      left.disabled = scroller.scrollLeft <= 1;
      right.disabled = scroller.scrollLeft >= max - 1;
    };
    left.addEventListener('click', e => {
      e.preventDefault();
      scroller.scrollBy({ left: -cardWidth, behavior: 'smooth' });
    });
    right.addEventListener('click', e => {
      e.preventDefault();
      scroller.scrollBy({ left: cardWidth, behavior: 'smooth' });
    });
    scroller.addEventListener('scroll', updateState, { passive: true });
    window.addEventListener('resize', updateState);
    updateState();
  });
}

// Resolve live cover/headshot URLs for bio links that reference a source
// table (courses, coaching services, digital products, media kit).
// Mirrors the server-side resolver in api/bio.js. Mutates `links` in place,
// only overwriting `photoUrl` when a live value is found, falling back to
// the stored snapshot otherwise.
async function resolveLiveCoverUrls(creatorUserId, links, creatorUsername) {
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
    return SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + path;
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
  // the bio render with snapshot URLs. Better stale photo than hung page.
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

async function load() {
  const username = getUsername();
  if (!username) { renderNotFound(null); return; }

  // FAST PATH: server-side rendered. Skip the data fetch + render entirely.
  // The page is already painted with the creator's content; we only need to
  // track the page view (which has to happen client-side so we don't count
  // bots or CDN cache warmers as views).
  if (window._ssrHydrated && window._ssrUsername) {
    trackPageView(window._ssrUsername, 'bio');
    initVideoArrows();
    return;
  }

  // FALLBACK PATH: server-side render failed or wasn't applied (e.g., direct
  // load of /bio.html, or the SSR fetch timed out). Render client-side.

  // 1) Look up the profile + tier via the public view (one query, no sensitive data exposed)
  const { data: profile, error: pErr } = await sb
    .from('public_profile_tiers')
    .select('user_id, username, tier, display_currency, verified')
    .eq('username', username)
    .maybeSingle();

  if (pErr || !profile) { renderNotFound(username); return; }

  // Set creator's display currency for price formatting
  window._creatorCurrency = profile.display_currency || 'USD';

  // 2) Fetch their published link-in-bio page
  const { data: bio, error: bErr } = await sb
    .from('link_in_bio')
    .select('display_name, bio, avatar_url, avatar_display, theme, links, videos, socials, show_branding, published, custom_theme, sensitive_content')
    .eq('user_id', profile.user_id)
    .eq('published', true)
    .maybeSingle();

  if (bErr || !bio) { renderNotFound(username); return; }

  // Resolve live cover URLs for course/coaching/product/mediakit links.
  // Mirrors the server-side resolver in api/bio.js. Mutates bio.links in
  // place so render() picks up live values instead of stored snapshots.
  try {
    await resolveLiveCoverUrls(profile.user_id, bio.links, profile.username);
  } catch (e) {
    console.error('cover URL resolver failed, using snapshots:', e);
  }

  render(profile, bio, profile.tier);

  // Sensitive content gate, fallback render path. On the SSR path this is
  // handled from the <meta> tag; here the value arrives with the bio fetch.
  if (bio.sensitive_content === true) showSensitiveGate();

  // Track page view (fire-and-forget, non-blocking)
  trackPageView(username, 'bio');
}

// Page view tracking with visitor dedup
async function trackPageView(username, pageType) {
  try {
    // Generate a visitor hash from available browser signals (no PII stored)
    let visitorHash;
    try {
      const raw = [
        navigator.userAgent || '',
        navigator.language || '',
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset().toString()
      ].join('|');
      const msgBuf = new TextEncoder().encode(raw);
      const hashBuf = await crypto.subtle.digest('SHA-256', msgBuf);
      const hashArr = Array.from(new Uint8Array(hashBuf));
      visitorHash = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (hashErr) {
      // Fallback if crypto.subtle is unavailable (e.g. non-HTTPS context)
      visitorHash = 'fb-' + btoa(navigator.userAgent + screen.width + screen.height).slice(0, 32);
    }

    const { error } = await sb.rpc('record_page_view', {
      p_username: username,
      p_page_type: pageType,
      p_visitor_hash: visitorHash
    });
    if (error) console.error('Page view tracking error:', error.message);
  } catch (e) {
    console.error('trackPageView failed:', e);
  }
}

load().catch(err => {
  console.error(err);
  renderNotFound(getUsername());
});

async function submitSubscribe() {
  var emailInput = document.getElementById('subscribe-email');
  var btn = document.getElementById('subscribe-btn');
  var msg = document.getElementById('subscribe-msg');
  if (!emailInput || !btn) return;

  var email = emailInput.value.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    msg.textContent = 'Please enter a valid email.';
    msg.style.color = '#fca5a5';
    msg.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = '...';

  try {
    var username = getUsername();
    var { data: profile } = await sb.from('public_profiles').select('user_id').eq('username', username).single();
    if (!profile) throw new Error('Creator not found');

    var hpEl = document.getElementById('subscribe-hp');
    var hp = hpEl ? hpEl.value : '';

    var resp = await fetch('/api/bio-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creator_id: profile.user_id,
        email: email,
        hp: hp
      })
    });

    var payload = {};
    try { payload = await resp.json(); } catch (e) { /* ignore */ }

    if (resp.status === 429) {
      msg.textContent = "Too many attempts. Please try again later.";
      msg.style.color = '#fca5a5';
    } else if (resp.ok && payload.already_subscribed) {
      msg.textContent = "You're already subscribed!";
      msg.style.color = 'var(--accent)';
    } else if (resp.ok) {
      msg.textContent = 'Thanks for subscribing!';
      msg.style.color = '#4ade80';
      emailInput.value = '';
    } else {
      throw new Error(payload.error || 'Subscription failed');
    }
    msg.style.display = 'block';
  } catch (e) {
    console.error('Subscribe error:', e);
    msg.textContent = 'Something went wrong. Try again.';
    msg.style.color = '#fca5a5';
    msg.style.display = 'block';
  }
  btn.disabled = false;
  btn.textContent = 'Subscribe';
}


// =================================================================
// ACTION REGISTRATIONS — wire data-bio-* attributes to handlers
// =================================================================

bioRegisterAction('subscribe-submit', function() {
  submitSubscribe();
});

bioRegisterAction('play-video', function(e, el) {
  var id = el.getAttribute('data-bio-video-id');
  if (id) playVideo(el, id);
});

bioRegisterOnError('thumb-fallback', function(e, el) {
  var id = el.getAttribute('data-bio-video-id');
  if (!id) return;
  var fallback = 'https://i.ytimg.com/vi/' + id + '/default.jpg';
  // Guard against infinite onerror loop if the fallback also 404s.
  if (el.src !== fallback) el.src = fallback;
  else el.removeAttribute('data-bio-onerror');
});


// =================================================================
// SENSITIVE CONTENT GATE
// Shown on every visit when the creator enabled sensitive_content.
// No memory of a prior answer, by design. It appears each load.
//   - "Yes, 18+"  → hide the gate, reveal the page for this pageview
//   - "No"        → leave ryxa.io
// While visible, page scroll is locked so the content behind stays
// unreadable. There is intentionally no close (X) and no click-out.
// =================================================================
function showSensitiveGate() {
  var gate = document.getElementById('sensitive-gate');
  if (!gate || gate.classList.contains('is-visible')) return;
  gate.classList.add('is-visible');
  // Lock scroll on the page behind the gate.
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  // Move focus into the gate for keyboard + screen-reader users.
  var confirmBtn = gate.querySelector('.sg-confirm');
  if (confirmBtn) { try { confirmBtn.focus(); } catch (e) {} }
}

function hideSensitiveGate() {
  var gate = document.getElementById('sensitive-gate');
  if (gate) gate.classList.remove('is-visible');
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
}

bioRegisterAction('sensitive-confirm', function() {
  hideSensitiveGate();
});

bioRegisterAction('sensitive-deny', function() {
  window.location.href = 'https://www.ryxa.io';
});

// Trigger for the SSR path: the value is in a <meta> tag written by
// api/bio.js and is available the moment this script runs.
(function sensitiveGateFromMeta() {
  var el = document.querySelector('meta[name="ryxa-sensitive"]');
  if (el && el.getAttribute('content') === 'true') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showSensitiveGate);
    } else {
      showSensitiveGate();
    }
  }
})();
