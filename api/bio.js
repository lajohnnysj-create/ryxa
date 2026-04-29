// Vercel serverless function — server-side rendered link-in-bio page
// Renders the full creator bio HTML at the edge so visitors get content on first paint.
// Cached at the Vercel CDN per-URL: s-maxage=60, stale-while-revalidate=300
// Routed via vercel.json rewrite: /:username -> /api/bio?u=:username

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTcxMzEsImV4cCI6MjA5MDg5MzEzMX0.VC8mcU5lUeA56kG2gHssvl88EVWr018XttA86jpfEn0';

// ==========================================================================
// HELPERS — mirror the client-side helpers in bio.html so the server renders
// byte-identical HTML to what the client would render.
// ==========================================================================

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
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
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function fmtPrice(cents, currency) {
  const code = currency || 'USD';
  const localeMap = { USD:'en-US', EUR:'en-IE', GBP:'en-GB', CAD:'en-CA', AUD:'en-AU', JPY:'ja-JP', INR:'en-IN', BRL:'pt-BR', MXN:'es-MX', CHF:'de-CH', SGD:'en-SG', SEK:'sv-SE', NOK:'nb-NO', NZD:'en-NZ', ZAR:'en-ZA' };
  const locale = localeMap[code] || 'en-US';
  const fractionDigits = (code === 'JPY') ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(cents / 100);
  } catch (e) {
    return '$' + (cents / 100).toFixed(fractionDigits);
  }
}

function hexAlpha(hex, alpha) {
  const h = (hex || '#ffffff').replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ==========================================================================
// SOCIAL ICONS — copied verbatim from bio.html so server output matches client
// ==========================================================================

const SOCIAL_ICONS = {
  instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.9a4.85 4.85 0 0 1-1.84-.21Z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.54 3.58 12 3.58 12 3.58s-7.54 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3 3 0 0 0 2.1 2.12c1.86.5 9.4.5 9.4.5s7.54 0 9.4-.5a3 3 0 0 0 2.1-2.12C24 15.93 24 12 24 12s0-3.93-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>',
  snapchat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.02 0C5.44 0 4.73 5.08 4.86 7.15c.03.5.05 1.01.06 1.52-.3.16-.79.38-1.29.38-.38 0-.75-.14-1.08-.41-.06-.05-.17-.14-.35-.14-.3 0-.65.17-.92.47-.3.34-.3.78.02 1.08.27.26.7.48 1.2.62.68.19 1.56.49 1.79 1.04.13.3-.01.69-.41 1.17a.35.35 0 0 1-.03.03c-.01.02-1.28 2.08-4.21 2.56-.22.04-.38.24-.36.46 0 .05.02.1.04.15.13.3.56.52 1.32.68.08.02.14.11.17.3.03.18.07.4.17.63.1.23.29.35.55.35.14 0 .3-.03.48-.06.25-.05.57-.11.96-.11.22 0 .44.02.68.06.45.07.83.34 1.27.65.63.45 1.35.96 2.43.96.08 0 .17 0 .26-.02.08.01.2.02.33.02 1.08 0 1.8-.51 2.43-.96.44-.31.82-.58 1.27-.65.24-.04.46-.06.68-.06.38 0 .68.05.96.11.2.04.36.06.48.06h.02c.19 0 .41-.08.53-.35.1-.22.14-.43.17-.62.02-.17.09-.28.17-.3.76-.16 1.19-.38 1.32-.68a.43.43 0 0 0 .04-.15c.02-.22-.14-.42-.36-.46-2.93-.48-4.2-2.54-4.21-2.56a.57.57 0 0 1-.03-.03c-.4-.48-.54-.87-.41-1.17.23-.55 1.11-.85 1.79-1.04.5-.14.93-.36 1.2-.62.33-.32.33-.76.03-1.08-.28-.3-.63-.47-.92-.47-.19 0-.3.08-.35.14-.32.26-.69.41-1.08.41-.5 0-.99-.22-1.29-.38.01-.51.03-1.02.06-1.52.13-2.07-.58-7.15-7.16-7.15Z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.26 2.37 4.26 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"/></svg>',
  website: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.93 9h-3.47a15.6 15.6 0 0 0-1.4-5.33A8 8 0 0 1 19.93 11ZM12 4a13.7 13.7 0 0 1 2.46 7h-4.92A13.7 13.7 0 0 1 12 4ZM4.26 13h3.47a15.6 15.6 0 0 0 1.4 5.33A8 8 0 0 1 4.26 13Zm0-2a8 8 0 0 1 4.87-6.33A15.6 15.6 0 0 0 7.73 11H4.26ZM12 20a13.7 13.7 0 0 1-2.46-7h4.92A13.7 13.7 0 0 1 12 20Zm2.87-1.67A15.6 15.6 0 0 0 16.27 13h3.47a8 8 0 0 1-4.87 5.33Z"/></svg>',
  email: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 4h20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm10 9.44L3.3 6H20.7L12 13.44ZM2 7.6v10.02L8.35 12 2 7.6Zm8.18 5.93L2.74 19h18.52l-7.44-5.48L12 15.14l-1.82-1.61Zm5.47-1.53L22 17.62V7.6l-6.35 4.4Z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.98.98 0 0 0-1.01.24l-1.57 1.97a15.1 15.1 0 0 1-6.92-6.92l1.97-1.57c.27-.27.35-.66.24-1.02A11.2 11.2 0 0 1 8.62 4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.62c0-.55-.45-1-1-1ZM19 12h2a9 9 0 0 0-9-9v2c3.87 0 7 3.13 7 7Zm-4 0h2c0-2.76-2.24-5-5-5v2c1.66 0 3 1.34 3 3Z"/></svg>'
};

function buildSocialHref(key, val) {
  const clean = val.replace(/^@/, '').trim();
  switch (key) {
    case 'instagram': return 'https://instagram.com/' + encodeURIComponent(clean);
    case 'tiktok':    return 'https://tiktok.com/@' + encodeURIComponent(clean);
    case 'snapchat':  return 'https://snapchat.com/add/' + encodeURIComponent(clean);
    case 'youtube':
    case 'facebook':
    case 'linkedin':
    case 'website': {
      return validUrl(clean) || validUrl('https://' + clean);
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

function buildSocials(socials) {
  if (!socials || typeof socials !== 'object') return '';
  const order = ['instagram','tiktok','youtube','facebook','snapchat','linkedin','website','email','phone'];
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

// ==========================================================================
// AVATAR + HERO HEADER
// ==========================================================================

function buildAvatar(profile, bio) {
  const name = bio.display_name || profile.username || '';
  const initial = (name[0] || profile.username[0] || '?').toUpperCase();
  const safeAvatar = validImageUrl(bio.avatar_url);
  const isMaxTier = profile.tier === 'max';
  const isHero = bio.avatar_display === 'hero' && safeAvatar && isMaxTier;

  if (isHero) return ''; // hero is rendered separately
  if (safeAvatar) {
    return `<div class="avatar-frame">
      <img class="avatar" src="${esc(safeAvatar)}" alt="${esc(name)}">
    </div>`;
  }
  return `<div class="avatar-frame"><div class="avatar-fallback">${esc(initial)}</div></div>`;
}

function buildHeroHeader(profile, bio) {
  const safeAvatar = validImageUrl(bio.avatar_url);
  const name = bio.display_name || profile.username || '';
  if (!safeAvatar) return '';
  return `<div class="hero-header">
    <img class="hero-header-img" src="${esc(safeAvatar)}" alt="${esc(name)}">
    <div class="hero-header-fade"></div>
  </div>`;
}

// ==========================================================================
// LINK BUILDERS — every link variant (header, subscribe, hero, featured,
// course, coaching, mediakit, regular w/ thumb, regular w/o thumb)
// ==========================================================================

function buildLink(link, currency) {
  // Half-width modifier — only used by the four eligible link types: regular
  // links, course cards, booking cards, and digital product cards. Hero,
  // featured, mediakit, subscribe, and headers are full-width only.
  const halfClass = link.halfWidth ? ' link-half' : '';
  // Header — text divider, no link
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
        <input type="email" id="subscribe-email" placeholder="Your email" aria-label="Email address" required style="flex:1;padding:10px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;font-family:inherit;outline:none;min-width:0;">
        <button onclick="submitSubscribe()" style="padding:10px 18px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;white-space:nowrap;transition:opacity 0.15s;" id="subscribe-btn">Subscribe</button>
      </div>
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
                onclick="playVideo(this,'${id}')"
                onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();playVideo(this,'${id}')}">
        <div class="video-thumb-wrap">
          <img class="video-thumb" src="${thumb}" alt="YouTube video thumbnail" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${id}/default.jpg'">
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
  }

  // Featured — large card with thumbnail
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
  }

  // Course link — cover image card with price
  if (link.isCourse) {
    const safePhoto = validImageUrl(link.photoUrl);
    const priceDisplay = link.coursePrice > 0 ? fmtPrice(link.coursePrice, currency) : 'Free';
    const crossoutHtml = link.courseCrossoutPrice > 0 ? '<span style="text-decoration:line-through;opacity:0.5;font-size:12px;margin-right:4px;">' + fmtPrice(link.courseCrossoutPrice, currency) + '</span>' : '';
    const coverHtml = safePhoto ? '<img src="' + esc(safePhoto) + '" alt="Link cover" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px 10px 0 0;display:block;">' : '';
    return '<a class="course-link-card' + halfClass + '" href="' + esc(url) + '" target="_blank" rel="noopener nofollow" style="display:block;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--text);transition:transform 0.15s,border-color 0.15s;" onmouseover="this.style.transform=\'translateY(-2px)\';this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.transform=\'\';this.style.borderColor=\'var(--border)\'">'
      + coverHtml
      + '<div class="clc-body" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">'
      + '<div class="clc-title" style="font-size:13px;font-weight:600;flex:1;min-width:0;">' + title + '</div>'
      + '<div class="clc-price" style="font-size:13px;font-weight:600;flex-shrink:0;margin-left:8px;">' + crossoutHtml + priceDisplay + '</div>'
      + '</div></a>';
  }

  // Coaching link — same card style as courses
  if (link.isCoaching) {
    const safePhoto = validImageUrl(link.photoUrl);
    const priceDisplay = link.coachingPrice > 0 ? fmtPrice(link.coachingPrice, currency) : 'Free';
    const coverHtml = safePhoto ? '<img src="' + esc(safePhoto) + '" alt="Link cover" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px 10px 0 0;display:block;">' : '';
    return '<a class="course-link-card' + halfClass + '" href="' + esc(url) + '" target="_blank" rel="noopener nofollow" style="display:block;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--text);transition:transform 0.15s,border-color 0.15s;" onmouseover="this.style.transform=\'translateY(-2px)\';this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.transform=\'\';this.style.borderColor=\'var(--border)\'">'
      + coverHtml
      + '<div class="clc-body" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">'
      + '<div class="clc-title" style="font-size:13px;font-weight:600;flex:1;min-width:0;">' + title + '</div>'
      + '<div class="clc-price" style="font-size:13px;font-weight:600;flex-shrink:0;margin-left:8px;">' + priceDisplay + '</div>'
      + '</div></a>';
  }

  // Digital Product link — same card style as courses/coaching
  if (link.isProduct) {
    const safePhoto = validImageUrl(link.photoUrl);
    const priceDisplay = link.productPrice > 0 ? fmtPrice(link.productPrice, currency) : 'Free';
    const coverHtml = safePhoto ? '<img src="' + esc(safePhoto) + '" alt="Link cover" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px 10px 0 0;display:block;">' : '';
    return '<a class="course-link-card' + halfClass + '" href="' + esc(url) + '" target="_blank" rel="noopener nofollow" style="display:block;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--text);transition:transform 0.15s,border-color 0.15s;" onmouseover="this.style.transform=\'translateY(-2px)\';this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.transform=\'\';this.style.borderColor=\'var(--border)\'">'
      + coverHtml
      + '<div class="clc-body" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">'
      + '<div class="clc-title" style="font-size:13px;font-weight:600;flex:1;min-width:0;">' + title + '</div>'
      + '<div class="clc-price" style="font-size:13px;font-weight:600;flex-shrink:0;margin-left:8px;">' + priceDisplay + '</div>'
      + '</div></a>';
  }

  // Media Kit link — distinct style
  if (link.isMediaKit) {
    const mkIconSvg = '<svg class="mediakit-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="17" x2="8" y2="13"/><line x1="12" y1="17" x2="12" y2="11"/><line x1="16" y1="17" x2="16" y2="15"/></svg>';
    const safePhoto = validImageUrl(link.photoUrl);
    if (safePhoto) {
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
    return `<a class="link-btn mediakit-link" href="${esc(url)}" target="_blank" rel="noopener nofollow">
      ${mkIconSvg}
      <div class="mediakit-body">
        <div class="link-title">${title}</div>
        ${desc}
      </div>
    </a>`;
  }

  // Regular link — with or without thumbnail
  const thumbUrl = validImageUrl(link.photoUrl);
  if (thumbUrl) {
    // Image on the left (square, flush to box edge, shares rounded corners with the box).
    // Title/desc fill the rest of the row, padding restored, text centered. CSS lives in bio.html.
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

// ==========================================================================
// CUSTOM THEME (Max tier only) — emit a <style> block with theme overrides
// so colors are correct on first paint, before client JS runs.
// ==========================================================================

function buildCustomThemeStyle(ct) {
  const colors = ct?.colors || {};
  const bg = colors.bg || '#07070f';
  const card = colors.card || '#161625';
  const text = colors.text || '#ffffff';
  const accent = colors.accent || '#a78bfa';

  let css = `:root[data-theme="custom"] {
    --bg: ${bg};
    --surface: ${card};
    --surface2: ${card};
    --text: ${text};
    --muted: ${hexAlpha(text, 0.65)};
    --muted2: ${hexAlpha(text, 0.8)};
    --border: ${hexAlpha(text, 0.1)};
    --accent: ${accent};
    --accent2: ${accent};
    --accent-glow: ${hexAlpha(accent, 0.3)};
    --avatar-border: linear-gradient(135deg, ${accent}, ${accent});
  }`;

  if (ct.bgUrl) {
    const op = ct.bgOpacity != null ? ct.bgOpacity : 0.4;
    const darkness = 1 - op;
    const safeBgUrl = String(ct.bgUrl).replace(/"/g, '&quot;');
    css += `
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image: url("${safeBgUrl}");
      background-size: cover;
      background-position: center;
      z-index: -2;
    }
    body::after {
      content: '';
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,${darkness.toFixed(2)});
      z-index: -1;
    }`;
  }

  return `<style id="custom-bg-style">${css}</style>`;
}

// ==========================================================================
// MAIN RENDER — produces the full inner HTML for the #wrap div
// ==========================================================================

function renderBioContent(profile, bio) {
  const name = bio.display_name || profile.username || '';
  const currency = profile.display_currency || 'USD';

  const isMaxTier = profile.tier === 'max';
  const isHeroMode = bio.avatar_display === 'hero' && validImageUrl(bio.avatar_url) && isMaxTier;

  const links = Array.isArray(bio.links) ? bio.links : [];
  const socialsHtml = buildSocials(bio.socials);
  const linksHtml = links.map(l => buildLink(l, currency)).filter(Boolean).join('');

  // Branding banner: free users always show it; Pro/Max can opt out
  const isPaid = profile.tier === 'monthly' || profile.tier === 'max';
  const showBanner = !isPaid || bio.show_branding !== false;
  const banner = showBanner
    ? `<a class="brand-banner" href="https://www.ryxa.io"><img src="https://www.ryxa.io/logo.png" alt="Ryxa" class="brand-banner-logo"><span>Get your free link-in-bio at <strong>Ryxa</strong></span></a>`
    : '';

  let inner;
  if (isHeroMode) {
    inner = `${buildHeroHeader(profile, bio)}
      <div class="hero-content-below">
        <div class="name">${esc(name)}</div>
        ${socialsHtml}
        ${bio.bio ? `<div class="bio">${esc(bio.bio)}</div>` : ''}
        ${linksHtml ? `<div class="links">${linksHtml}</div>` : ''}
        ${banner}
      </div>`;
  } else {
    inner = `${buildAvatar(profile, bio)}
      <div class="name">${esc(name)}</div>
      ${socialsHtml}
      ${bio.bio ? `<div class="bio">${esc(bio.bio)}</div>` : ''}
      ${linksHtml ? `<div class="links">${linksHtml}</div>` : ''}
      ${banner}`;
  }

  return { inner, isHeroMode, showBanner };
}

// ==========================================================================
// SUPABASE FETCH — load profile (via public_profile_tiers view) + bio in parallel.
// Uses anon key so it's safe; the view itself filters out private columns.
// Single 3-second timeout for the whole operation.
// ==========================================================================

async function fetchBioData(username) {
  const fetchOpts = (signal) => ({
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    signal,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    // Step 1: profile lookup via public view
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/public_profile_tiers?username=eq.${encodeURIComponent(username)}&select=user_id,username,tier,display_currency`,
      fetchOpts(controller.signal)
    );
    if (!profileRes.ok) { clearTimeout(timeout); return null; }
    const profiles = await profileRes.json();
    if (!profiles || profiles.length === 0) { clearTimeout(timeout); return null; }
    const profile = profiles[0];

    // Step 2: bio data for that user, only if published
    const bioRes = await fetch(
      `${SUPABASE_URL}/rest/v1/link_in_bio?user_id=eq.${profile.user_id}&published=eq.true&select=display_name,bio,avatar_url,avatar_display,theme,links,videos,socials,show_branding,published,custom_theme`,
      fetchOpts(controller.signal)
    );
    clearTimeout(timeout);
    if (!bioRes.ok) return { profile, bio: null };
    const bios = await bioRes.json();
    return { profile, bio: bios[0] || null };
  } catch (e) {
    clearTimeout(timeout);
    console.error('bio fetch error', e);
    return null;
  }
}

// ==========================================================================
// HANDLER
// ==========================================================================

module.exports = async (req, res) => {
  const username = (req.query.u || '').trim();
  if (!username) {
    res.writeHead(301, { Location: 'https://www.ryxa.io/' });
    return res.end();
  }

  // Reject anything that doesn't look like a valid username
  if (!/^[a-zA-Z0-9._-]{1,30}$/.test(username)) {
    res.writeHead(301, { Location: 'https://www.ryxa.io/' });
    return res.end();
  }

  // Reject reserved paths that may have leaked through cleanUrls normalization
  const RESERVED = new Set([
    'brand-portal', 'deal', 'about', 'blog', 'dashboard', 'faq', 'follower-audit',
    'index', 'instructions', 'pricing', 'privacy', 'reset-password', 'terms',
    'mediakit', 'bio', 'brand-deal-crm', 'api', 'admin', 'support', 'help', 'login', 'signin', 'signup',
    'tools', 'tools-link-in-bio', 'tools-course-builder', 'tools-coaching', 'tools-brand-deal-crm',
    'tools-media-kit', 'tools-script-builder', 'tools-ai-design-studio', 'tools-grid-planner',
    'tools-follower-audit', 'tools-photo-editor', 'tools-qr-generator',
    'tools-invoice-generator', 'tools-sign-pdf', 'tools-thumbnail-analyzer', 'tools-contract-analyzer',
    'tools-digital-products', 'tools-image-studio', 'data-deletion-status', 'testimonials',
    'blog-best-linktree-alternatives', 'blog-why-did-my-friends-unfollow-me',
    'learn', 'cookie-banner', 'site-nav', 'booking', 'course', 'portal'
  ]);
  if (username.includes('.') || username.includes('/') || RESERVED.has(username.toLowerCase())) {
    res.writeHead(301, { Location: 'https://www.ryxa.io/' + username });
    return res.end();
  }

  // Read the source HTML template
  const htmlPath = path.join(process.cwd(), 'bio.html');
  let html;
  try {
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (e) {
    res.status(500).send('Template not found');
    return;
  }

  // Default OG values (used if user not found OR fetch fails)
  let title = `@${username} | Ryxa`;
  let description = `A creator's link-in-bio page on Ryxa.`;
  let image = 'https://www.ryxa.io/og-image.png';
  const url = `https://www.ryxa.io/${encodeURIComponent(username)}`;

  // Fetch the data
  const result = await fetchBioData(username);

  let renderedInner = null;
  let theme = 'purple';
  let customThemeStyle = '';

  if (result && result.bio && result.bio.published !== false) {
    const { profile, bio } = result;

    // Update OG metadata for social previews
    title = `all of @${profile.username}'s links`;
    description = bio.bio || `Find all of @${profile.username}'s links in one place on Ryxa.`;
    if (bio.avatar_url) image = bio.avatar_url;

    // Pick theme: custom theme honored only for Max tier
    const isMaxTier = profile.tier === 'max';
    if (bio.theme === 'custom' && isMaxTier && bio.custom_theme) {
      theme = 'custom';
      customThemeStyle = buildCustomThemeStyle(bio.custom_theme);
    } else if (bio.theme === 'custom' && !isMaxTier) {
      theme = 'purple';
    } else {
      theme = bio.theme || 'purple';
    }

    // Render the bio content server-side
    const rendered = renderBioContent(profile, bio);
    renderedInner = rendered.inner;

    // Stash currency + tier for client JS so trackPageView/subscribe still work
    // and so any client-side post-hydration logic has access to it.
    const bootstrap = `<script>
      window._creatorCurrency = ${JSON.stringify(profile.display_currency || 'USD')};
      window._ssrUsername = ${JSON.stringify(profile.username)};
      window._ssrHydrated = true;
    </script>`;

    customThemeStyle = customThemeStyle + bootstrap;
  }

  // ============================================================
  // Inject everything into the HTML template
  // ============================================================

  // 1. Replace existing <title>, <meta name="description">, OG tags, twitter tags
  html = html
    .replace(/<title>[^<]*<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:[^"]*"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>/gi, '');

  const ogBlock = `
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="800">
<meta property="og:image:height" content="800">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
${customThemeStyle}
`;

  html = html.replace(/<head>/i, `<head>${ogBlock}`);

  // 2. Set data-theme on <html>
  html = html.replace(/<html\s+lang="en">/i, `<html lang="en" data-theme="${esc(theme)}">`);

  // 3. Replace the loading placeholder inside <div id="wrap"> with rendered content
  if (renderedInner) {
    // If hero mode, the wrap needs a class — handle by reading from the rendered output
    const wrapClass = renderedInner.includes('hero-header') ? 'wrap hero-mode' : 'wrap';
    const showsBanner = renderedInner.includes('brand-banner');
    const bodyStyle = showsBanner ? ' style="padding-bottom:80px;"' : '';

    html = html.replace(
      /<body>\s*<div class="wrap" id="wrap">[\s\S]*?<\/div>\s*<script>/m,
      `<body${bodyStyle}>\n<div class="${wrapClass}" id="wrap">${renderedInner}</div>\n<script>`
    );
  }
  // If no renderedInner, leave the loading placeholder — client JS will fetch + render.

  // 4. Cache headers — fresh for 60s, serve stale up to 5 more minutes while revalidating
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.status(200).send(html);
};
