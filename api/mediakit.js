// Vercel serverless function — Server-side rendered media kit
//
// Renders the entire media kit HTML server-side and serves it through the
// Vercel CDN with stale-while-revalidate caching. Same pattern as api/bio.js.
//
// Routed via vercel.json rewrite: /mediakit/:username -> /api/mediakit?u=:username
//
// Cache: s-maxage=60, stale-while-revalidate=300 — fresh for 60s, serve
// stale up to 5 more minutes while CDN revalidates in the background. Edits
// take ~1 minute to appear; viral surges hit the cache, not the database.

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTcxMzEsImV4cCI6MjA5MDg5MzEzMX0.VC8mcU5lUeA56kG2gHssvl88EVWr018XttA86jpfEn0';

// ==========================================================================
// HELPERS
// ==========================================================================

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Image URLs are restricted to our own Supabase Storage buckets.
// Mirrors mediakit.html's validImageUrl exactly.
function validImageUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'kjytapcgxukalwsyputk.supabase.co') return null;
    const allowedBuckets = [
      '/storage/v1/object/public/bio-photos/',
      '/storage/v1/object/public/media-kit-photos/',
      '/storage/v1/object/public/bio-backgrounds/',
    ];
    if (!allowedBuckets.some(b => url.pathname.includes(b))) return null;
    return url.toString();
  } catch { return null; }
}

// External URLs (any http/https) — used for social profile links
function validExternalUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch { return null; }
}

function formatNumber(n) {
  const num = parseInt(n);
  if (!num || num < 0) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'K';
  return String(num);
}

function formatPrice(p, currency) {
  const num = parseFloat(p);
  if (!isFinite(num) || num < 0) return '';
  const code = currency || 'USD';
  const localeMap = { USD:'en-US', EUR:'en-IE', GBP:'en-GB', CAD:'en-CA', AUD:'en-AU', JPY:'ja-JP', INR:'en-IN', BRL:'pt-BR', MXN:'es-MX', CHF:'de-CH', SGD:'en-SG', SEK:'sv-SE', NOK:'nb-NO', NZD:'en-NZ', ZAR:'en-ZA' };
  const locale = localeMap[code] || 'en-US';
  try {
    return new Intl.NumberFormat(locale, { style:'currency', currency:code, minimumFractionDigits:0, maximumFractionDigits:0 }).format(Math.round(num));
  } catch (e) {
    return '$' + Math.round(num).toLocaleString('en-US');
  }
}

// ==========================================================================
// SOCIAL PLATFORMS (mirror of mediakit.html SOCIAL_PLATFORMS)
// ==========================================================================

const SOCIAL_PLATFORMS = [
  { key:'instagram', label:'Instagram', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>' },
  { key:'tiktok', label:'TikTok', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.9a4.85 4.85 0 0 1-1.84-.21Z"/></svg>' },
  { key:'youtube', label:'YouTube', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.54 3.58 12 3.58 12 3.58s-7.54 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3 3 0 0 0 2.1 2.12c1.86.5 9.4.5 9.4.5s7.54 0 9.4-.5a3 3 0 0 0 2.1-2.12C24 15.93 24 12 24 12s0-3.93-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"/></svg>' },
  { key:'twitter', label:'Twitter/X', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
  { key:'facebook', label:'Facebook', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>' },
  { key:'threads', label:'Threads', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291 1.034-.06 1.995 0 2.917.175-.084-.689-.302-1.235-.646-1.62-.523-.584-1.252-.823-2.196-.734a3.62 3.62 0 0 0-1.907.795l-1.078-1.66c.845-.621 2.027-.964 3.158-.988 1.692-.035 2.979.492 3.853 1.575.781.968 1.147 2.329 1.09 4.039 1.32.639 2.316 1.674 2.854 2.972.768 1.855.82 4.84-1.639 7.245-1.876 1.834-4.215 2.658-7.39 2.678zm2.62-12.395c-.457-.03-.987-.04-1.557-.006-1.034.06-1.868.327-2.357.746-.456.39-.63.9-.598 1.477.034.604.299 1.04.863 1.406.518.34 1.24.516 2.053.47.988-.055 1.739-.426 2.294-1.125.538-.676.85-1.694.846-2.895l-.004-.073h-1.54z"/></svg>' },
  { key:'snapchat', label:'Snapchat', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.02 0C5.44 0 4.73 5.08 4.86 7.15c.03.5.05 1.01.06 1.52-.3.16-.79.38-1.29.38-.38 0-.75-.14-1.08-.41-.06-.05-.17-.14-.35-.14-.3 0-.65.17-.92.47-.3.34-.3.78.02 1.08.27.26.7.48 1.2.62.68.19 1.56.49 1.79 1.04.13.3-.01.69-.41 1.17a.35.35 0 0 1-.03.03c-.01.02-1.28 2.08-4.21 2.56-.22.04-.38.24-.36.46 0 .05.02.1.04.15.13.3.56.52 1.32.68.08.02.14.11.17.3.03.18.07.4.17.63.1.23.29.35.55.35.14 0 .3-.03.48-.06.25-.05.57-.11.96-.11.22 0 .44.02.68.06.45.07.83.34 1.27.65.63.45 1.35.96 2.43.96.08 0 .17 0 .26-.02.08.01.2.02.33.02 1.08 0 1.8-.51 2.43-.96.44-.31.82-.58 1.27-.65.24-.04.46-.06.68-.06.38 0 .68.05.96.11.2.04.36.06.48.06h.02c.19 0 .41-.08.53-.35.1-.22.14-.43.17-.62.02-.17.09-.28.17-.3.76-.16 1.19-.38 1.32-.68a.43.43 0 0 0 .04-.15c.02-.22-.14-.42-.36-.46-2.93-.48-4.2-2.54-4.21-2.56a.57.57 0 0 1-.03-.03c-.4-.48-.54-.87-.41-1.17.23-.55 1.11-.85 1.79-1.04.5-.14.93-.36 1.2-.62.33-.32.33-.76.03-1.08-.28-.3-.63-.47-.92-.47-.19 0-.3.08-.35.14-.32.26-.69.41-1.08.41-.5 0-.99-.22-1.29-.38.01-.51.03-1.02.06-1.52.13-2.07-.58-7.15-7.16-7.15Z"/></svg>' },
  { key:'pinterest', label:'Pinterest', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>' },
  { key:'linkedin', label:'LinkedIn', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.26 2.37 4.26 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"/></svg>' },
  { key:'twitch', label:'Twitch', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>' },
];

const PREDEFINED_RATES = {
  'ig_reel':     'Instagram Reel',
  'ig_post':     'Instagram Post',
  'ig_story':    'Instagram Story',
  'tiktok':      'TikTok Video',
  'youtube':     'YouTube Video',
};

// ==========================================================================
// SECTION BUILDERS — mirror mediakit.html
// ==========================================================================

function buildHero(kit, headshot) {
  const name = kit.display_name || '';
  const initial = (name[0] || '?').toUpperCase();
  const headshotHtml = headshot
    ? `<img class="headshot" src="${esc(headshot)}" alt="${esc(name)}">`
    : `<div class="headshot-fallback">${esc(initial)}</div>`;
  return `<div class="hero">
    <div class="headshot-frame">${headshotHtml}</div>
    <div class="hero-body">
      <div class="hero-name">${esc(name || 'Creator')}</div>
      ${kit.handle ? `<div class="hero-handle">${esc(kit.handle)}</div>` : ''}
      ${kit.category ? `<div class="hero-category">${esc(kit.category)}</div>` : ''}
      ${kit.bio ? `<div class="hero-bio">${esc(kit.bio)}</div>` : ''}
    </div>
  </div>`;
}

function buildAudience(kit) {
  const rawSocials = kit.socials || {};
  const normalized = {};
  for (const key of Object.keys(rawSocials)) {
    const v = rawSocials[key];
    if (typeof v === 'number') normalized[key] = { count: v, url: '' };
    else if (v && typeof v === 'object') normalized[key] = { count: parseInt(v.count) || 0, url: v.url || '' };
  }

  const filled = SOCIAL_PLATFORMS
    .map(p => ({ ...p, data: normalized[p.key] || { count: 0, url: '' } }))
    .filter(p => p.data.count > 0);

  if (filled.length === 0 && !kit.engagement_rate) return '';

  const total = filled.reduce((sum, p) => sum + p.data.count, 0);

  const totalHtml = total > 0 ? `<div class="total-followers">
    <div class="total-followers-num">${formatNumber(total)}</div>
    <div class="total-followers-label">Total Followers</div>
  </div>` : '';

  const statsHtml = filled.length > 0 ? `<div class="stats-grid">
    ${filled.map(p => {
      const inner = `<div class="stat-icon">${p.svg}</div>
      <div class="stat-text">
        <div class="stat-num">${formatNumber(p.data.count)}</div>
        <div class="stat-label">${esc(p.label)}</div>
      </div>`;
      const safeUrl = validExternalUrl(p.data.url);
      if (safeUrl) {
        return `<a class="stat-card stat-link" href="${esc(safeUrl)}" target="_blank" rel="noopener nofollow" aria-label="${esc(p.label)} profile">${inner}</a>`;
      }
      return `<div class="stat-card">${inner}</div>`;
    }).join('')}
  </div>` : '';

  const engagementHtml = (kit.engagement_rate && parseFloat(kit.engagement_rate) > 0) ? `<div class="engagement-row">
    <div class="engagement-label">Engagement Rate</div>
    <div class="engagement-value">${parseFloat(kit.engagement_rate).toFixed(2)}%</div>
  </div>` : '';

  return `<div class="section">
    <div class="section-title">Audience</div>
    ${totalHtml}
    ${statsHtml}
    ${engagementHtml}
  </div>`;
}

function buildRateCard(kit, currency) {
  const rates = Array.isArray(kit.rate_card) ? kit.rate_card : [];
  const valid = rates.filter(r => {
    const p = parseFloat(r.price);
    return isFinite(p) && p > 0;
  });
  if (valid.length === 0) return '';

  return `<div class="section">
    <div class="section-title">Rate Card</div>
    ${valid.map(r => {
      const label = PREDEFINED_RATES[r.id] || r.label || 'Custom';
      return `<div class="rate-row">
        <div>
          <div class="rate-label">${esc(label)}</div>
          ${r.note ? `<div class="rate-note">${esc(r.note)}</div>` : ''}
        </div>
        <div class="rate-price">${esc(formatPrice(r.price, currency))}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function buildContact(kit) {
  if (!kit.contact_email) return '';
  const safeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kit.contact_email) ? kit.contact_email : null;
  if (!safeEmail) return '';

  const mailIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 4h20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm10 9.44L3.3 6H20.7L12 13.44Z"/></svg>';

  return `<div class="section">
    <div class="section-title">Contact</div>
    <a class="contact-email" href="mailto:${esc(safeEmail)}">
      ${mailIcon}
      <span>${esc(safeEmail)}</span>
    </a>
    ${kit.contact_note ? `<div class="contact-note">${esc(kit.contact_note)}</div>` : ''}
  </div>`;
}

// ==========================================================================
// CUSTOM THEME (Max tier only) — emit a <style> block with theme overrides
// ==========================================================================

function hexAlpha(hex, alpha) {
  const h = (hex || '#ffffff').replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildCustomThemeStyle(ct) {
  if (!ct) return '';
  const colors = ct.colors || {};
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
  }`;

  if (ct.bgUrl) {
    const op = ct.bgOpacity != null ? ct.bgOpacity : 0.4;
    const darkness = 1 - op;
    css += `
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image: url("${String(ct.bgUrl).replace(/"/g, '&quot;')}");
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
// MAIN RENDER — produces inner HTML for the #wrap div
// ==========================================================================

function renderMediaKitContent(profile, kit) {
  const headshot = validImageUrl(kit.headshot_url);

  const isPaid = profile.tier === 'monthly' || profile.tier === 'max';
  // Banner rule: always on for non-Pro. Pro/Max can opt out via show_branding=true (note the inversion).
  const showBanner = !isPaid || kit.show_branding === true;

  const bannerHtml = showBanner ? `<div class="banner-wrap">
    <a class="brand-banner" href="https://www.ryxa.io"><img src="https://www.ryxa.io/logo.png" alt="Ryxa" class="brand-banner-logo"><span>Media Kit powered by <strong>Ryxa</strong></span></a>
  </div>` : '';

  const inner = `<div class="top-actions">
      <button class="btn-dl" onclick="window.print()" aria-label="Download as PDF">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download PDF
      </button>
    </div>
    ${buildHero(kit, headshot)}
    ${buildAudience(kit)}
    ${buildRateCard(kit, profile.display_currency || 'USD')}
    ${buildContact(kit)}
    ${bannerHtml}`;

  return { inner, showBanner };
}

// ==========================================================================
// SUPABASE FETCH — load profile + kit in parallel via REST.
// Single 3-second timeout for the whole operation; falls back to client
// rendering if anything goes wrong.
// ==========================================================================

function fetchOpts(signal) {
  return {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    signal,
  };
}

async function fetchMediaKitData(username) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    // Step 1: profile lookup via public view (returns user_id, username, tier, display_currency)
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/public_profile_tiers?username=eq.${encodeURIComponent(username)}&select=user_id,username,tier,display_currency`,
      fetchOpts(controller.signal)
    );
    if (!profileRes.ok) { clearTimeout(timeout); return null; }
    const profiles = await profileRes.json();
    if (!profiles || profiles.length === 0) { clearTimeout(timeout); return null; }
    const profile = profiles[0];

    // Step 2: media_kit data, only if published
    const kitRes = await fetch(
      `${SUPABASE_URL}/rest/v1/media_kit?user_id=eq.${profile.user_id}&published=eq.true&select=headshot_url,display_name,handle,bio,category,socials,engagement_rate,rate_card,contact_email,contact_note,theme,show_branding,published,custom_theme`,
      fetchOpts(controller.signal)
    );
    clearTimeout(timeout);
    if (!kitRes.ok) return { profile, kit: null };
    const kits = await kitRes.json();
    return { profile, kit: kits[0] || null };
  } catch (e) {
    clearTimeout(timeout);
    console.error('mediakit fetch error', e);
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

  const htmlPath = path.join(process.cwd(), 'mediakit.html');
  let html;
  try {
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (e) {
    res.status(500).send('Template not found');
    return;
  }

  // Default OG values (used if user not found OR fetch fails)
  let title = `@${username}. Media Kit | Ryxa`;
  let description = `A creator's media kit on Ryxa.`;
  let image = 'https://www.ryxa.io/og-image.png';
  const url = `https://www.ryxa.io/mediakit/${encodeURIComponent(username)}`;

  // Fetch the data
  const result = await fetchMediaKitData(username);

  let renderedInner = null;
  let theme = 'purple';
  let customThemeStyle = '';

  if (result && result.kit && result.kit.published !== false) {
    const { profile, kit } = result;

    // Update OG metadata for social previews
    const name = kit.display_name || profile.username;
    title = `${name}. Media Kit | Ryxa`;
    description = kit.bio
      ? kit.bio
      : `${name}'s creator media kit — collaborations, audience stats, and rates.`;
    if (kit.headshot_url) image = kit.headshot_url;

    // Pick theme: custom theme honored only for Max tier
    const isMaxTier = profile.tier === 'max';
    if (kit.theme === 'custom' && isMaxTier && kit.custom_theme) {
      theme = 'custom';
      customThemeStyle = buildCustomThemeStyle(kit.custom_theme);
    } else if (kit.theme === 'custom' && !isMaxTier) {
      theme = 'purple';
    } else {
      theme = kit.theme || 'purple';
    }

    // Render the media kit content server-side
    const rendered = renderMediaKitContent(profile, kit);
    renderedInner = rendered.inner;

    // Bootstrap script: stash creator currency + signal SSR hydration so
    // the client JS skips its own fetch+render and only fires trackPageView.
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
  html = html.replace(/<html(\s[^>]*)?>/i, `<html lang="en" data-theme="${esc(theme)}">`);

  // 3. Replace the loading placeholder inside <div id="wrap"> with rendered content.
  // The wrap currently contains an inner state div, so we match all the way up
  // to the closing </div> that precedes <script>. The lookahead anchors on
  // <script> to avoid greedy-matching past it into the body.
  if (renderedInner) {
    html = html.replace(
      /<div class="wrap" id="wrap">[\s\S]*?<\/div>\s*<\/div>\s*<script>/m,
      `<div class="wrap" id="wrap">${renderedInner}</div>\n<script>`
    );
  }
  // If no renderedInner, leave the loading placeholder — client JS will fetch + render.

  // 4. Cache headers — fresh for 60s, serve stale up to 5 more minutes while revalidating
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.status(200).send(html);
};
