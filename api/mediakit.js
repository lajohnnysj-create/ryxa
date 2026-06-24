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
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

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
      '/storage/v1/object/public/mediakit-backgrounds/',
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

// ==========================================================================
// FONTS — must mirror BIO_FONTS in dashboard.html. Keep in sync when adding new fonts.
// Same shape as bio.js's BIO_FONTS_SSR — both files share the same font list since
// bio + media kit pages should let creators pick from the same set.
// ==========================================================================
const BIO_FONTS_SSR = {
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

// Returns a string of <link> + <style> tags to inject into the <head>.
// Falls back to default if key invalid. Style uses !important so it overrides
// the default DM Sans declaration in mediakit.html's stylesheet on body, .name,
// .bio, etc. — anything that should pick up the creator's chosen font.
function buildFontInjection(fontKey) {
  // When the chosen font is the default ('DM Sans' or null/unknown), inject
  // nothing. The static mediakit.html stylesheet already paints DM Sans on
  // the body and 'Syne' on headings (.hero-name, .hero-handle, etc) for
  // Ryxa's signature visual hierarchy. Skipping the override preserves that look.
  if (!fontKey || fontKey === 'DM Sans') return '';
  const font = BIO_FONTS_SSR[fontKey] || BIO_FONTS_SSR['DM Sans'];
  const link = `<link href="https://fonts.googleapis.com/css2?family=${font.gfont}:wght@${font.weights}&display=swap" rel="stylesheet">`;
  // Wildcard `body *` ensures every element picks up the creator's chosen
  // font (including Syne-styled headings, stat values, rate labels, etc).
  // .brand-banner stays DM Sans for Ryxa branding consistency.
  const style = `<style id="mk-font-override">body, body * { font-family: ${font.stack} !important; } .brand-banner, .brand-banner * { font-family: 'DM Sans', sans-serif !important; }</style>`;
  return link + style;
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
  { key:'instagram', label:'Instagram', type:'username', urlPrefix:'https://instagram.com/', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>' },
  { key:'tiktok', label:'TikTok', type:'username', urlPrefix:'https://tiktok.com/@', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.9a4.85 4.85 0 0 1-1.84-.21Z"/></svg>' },
  { key:'twitter', label:'X', type:'username', urlPrefix:'https://x.com/', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
  { key:'threads', label:'Threads', type:'username', urlPrefix:'https://threads.net/@', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291 1.034-.06 1.995 0 2.917.175-.084-.689-.302-1.235-.646-1.62-.523-.584-1.252-.823-2.196-.734a3.62 3.62 0 0 0-1.907.795l-1.078-1.66c.845-.621 2.027-.964 3.158-.988 1.692-.035 2.979.492 3.853 1.575.781.968 1.147 2.329 1.09 4.039 1.32.639 2.316 1.674 2.854 2.972.768 1.855.82 4.84-1.639 7.245-1.876 1.834-4.215 2.658-7.39 2.678zm2.62-12.395c-.457-.03-.987-.04-1.557-.006-1.034.06-1.868.327-2.357.746-.456.39-.63.9-.598 1.477.034.604.299 1.04.863 1.406.518.34 1.24.516 2.053.47.988-.055 1.739-.426 2.294-1.125.538-.676.85-1.694.846-2.895l-.004-.073h-1.54z"/></svg>' },
  { key:'youtube', label:'YouTube', type:'url', urlPrefix:'', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.54 3.58 12 3.58 12 3.58s-7.54 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3 3 0 0 0 2.1 2.12c1.86.5 9.4.5 9.4.5s7.54 0 9.4-.5a3 3 0 0 0 2.1-2.12C24 15.93 24 12 24 12s0-3.93-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"/></svg>' },
  { key:'facebook', label:'Facebook', type:'url', urlPrefix:'', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>' },
  { key:'snapchat', label:'Snapchat', type:'username', urlPrefix:'https://snapchat.com/add/', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.02 0C5.44 0 4.73 5.08 4.86 7.15c.03.5.05 1.01.06 1.52-.3.16-.79.38-1.29.38-.38 0-.75-.14-1.08-.41-.06-.05-.17-.14-.35-.14-.3 0-.65.17-.92.47-.3.34-.3.78.02 1.08.27.26.7.48 1.2.62.68.19 1.56.49 1.79 1.04.13.3-.01.69-.41 1.17a.35.35 0 0 1-.03.03c-.01.02-1.28 2.08-4.21 2.56-.22.04-.38.24-.36.46 0 .05.02.1.04.15.13.3.56.52 1.32.68.08.02.14.11.17.3.03.18.07.4.17.63.1.23.29.35.55.35.14 0 .3-.03.48-.06.25-.05.57-.11.96-.11.22 0 .44.02.68.06.45.07.83.34 1.27.65.63.45 1.35.96 2.43.96.08 0 .17 0 .26-.02.08.01.2.02.33.02 1.08 0 1.8-.51 2.43-.96.44-.31.82-.58 1.27-.65.24-.04.46-.06.68-.06.38 0 .68.05.96.11.2.04.36.06.48.06h.02c.19 0 .41-.08.53-.35.1-.22.14-.43.17-.62.02-.17.09-.28.17-.3.76-.16 1.19-.38 1.32-.68a.43.43 0 0 0 .04-.15c.02-.22-.14-.42-.36-.46-2.93-.48-4.2-2.54-4.21-2.56a.57.57 0 0 1-.03-.03c-.4-.48-.54-.87-.41-1.17.23-.55 1.11-.85 1.79-1.04.5-.14.93-.36 1.2-.62.33-.32.33-.76.03-1.08-.28-.3-.63-.47-.92-.47-.19 0-.3.08-.35.14-.32.26-.69.41-1.08.41-.5 0-.99-.22-1.29-.38.01-.51.03-1.02.06-1.52.13-2.07-.58-7.15-7.16-7.15Z"/></svg>' },
  { key:'linkedin', label:'LinkedIn', type:'username', urlPrefix:'https://linkedin.com/in/', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.26 2.37 4.26 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"/></svg>' },
  { key:'pinterest', label:'Pinterest', type:'username', urlPrefix:'https://pinterest.com/', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>' },
  { key:'twitch', label:'Twitch', type:'username', urlPrefix:'https://twitch.tv/', svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>' },
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
    if (typeof v === 'number') normalized[key] = { count: v, url: '', engagement: '' };
    else if (v && typeof v === 'object') normalized[key] = { count: parseInt(v.count) || 0, url: v.url || '', engagement: (v.engagement != null ? v.engagement : '') };
  }

  const filled = SOCIAL_PLATFORMS
    .map(p => ({ ...p, data: normalized[p.key] || { count: 0, url: '', engagement: '' } }))
    .filter(p => p.data.count > 0);

  if (filled.length === 0) return '';

  const total = filled.reduce((sum, p) => sum + p.data.count, 0);

  const totalHtml = total > 0 ? `<div class="total-followers">
    <div class="total-followers-num">${formatNumber(total)}</div>
    <div class="total-followers-label">Total Followers</div>
  </div>` : '';

  const statsHtml = filled.length > 0 ? `<div class="stats-list" style="display:flex;flex-direction:column;gap:8px;">
    ${filled.map(p => {
      const engNum = parseFloat(p.data.engagement);
      const engCell = (isFinite(engNum) && engNum > 0)
        ? `<div style="text-align:right;flex-shrink:0;min-width:64px;">
             <div style="font-weight:800;font-size:16px;line-height:1.1;">${(+engNum.toFixed(2))}%</div>
             <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.05em;opacity:0.6;">engagement</div>
           </div>`
        : '';
      const sizedSvg = (p.svg || '').replace('<svg ', '<svg width="16" height="16" fill="currentColor" ');
      const inner = `<div class="stat-icon" style="flex-shrink:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:var(--text);">${sizedSvg}</div>
      <div class="stat-name" style="flex:1;min-width:0;font-weight:600;font-size:14px;">${esc(p.label)}</div>
      <div style="text-align:right;flex-shrink:0;min-width:80px;">
        <div style="font-weight:800;font-size:16px;line-height:1.1;">${formatNumber(p.data.count)}</div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.05em;opacity:0.6;">followers</div>
      </div>
      ${engCell}`;
      // Handle-type platforms store a bare handle; build the full URL with the
      // platform's prefix. url-type platforms store a full URL already.
      let linkUrl = '';
      const raw = (p.data.url || '').trim();
      if (raw) {
        if (p.type === 'username' && p.urlPrefix) {
          const handle = raw.replace(/^@/, '').replace(/^https?:\/\/[^/]+\//i, '').replace(/[?#].*$/, '').trim();
          if (handle) linkUrl = validExternalUrl(p.urlPrefix + handle);
        } else {
          linkUrl = validExternalUrl(raw);
        }
      }
      const rowStyle = 'display:flex;align-items:center;gap:12px;padding:12px 14px;';
      if (linkUrl) {
        return `<a class="stat-row stat-link" href="${esc(linkUrl)}" target="_blank" rel="noopener nofollow" aria-label="${esc(p.label)} profile" style="${rowStyle}text-decoration:none;color:inherit;">${inner}</a>`;
      }
      return `<div class="stat-row" style="${rowStyle}">${inner}</div>`;
    }).join('')}
  </div>` : '';

  return `<div class="section">
    <div class="section-title">Audience</div>
    ${totalHtml}
    ${statsHtml}
  </div>`;
}

// ----- Automatic audience: rendered from cached Instagram data ----------
//
// Renders when media_kit.audience_mode = 'automatic'. All numbers come from
// the instagram_connections row populated by api/_instagram-fetch-helper.js.
// Falls back gracefully when individual fields are null (e.g. demographics
// require 100+ followers; story views only exist when stories are active).
//
// Layout:
//   1. Platform tabs strip (Instagram active, others "Coming soon")
//   2. IG header (handle + verified-by-Instagram attribution)
//   3. Primary stats grid (followers, engagement rate, reach, etc.)
//   4. Per-post averages
//   5. Audience demographics (gender split, age x gender chart with tabs,
//      top countries bar list, top cities bar list)
//
// All charts are SSR'd as CSS bars — works in print/PDF and without JS.
// The age/gender chart's All/Male/Female tabs are wired client-side
// in mediakit.html (a small inline script reads the JSON payload).

// Platform tab strip — Instagram active, others coming soon
// Renders the "Audience by platform" tablist. Only OAuth-connected platforms
// appear here (today, Instagram). The caller (buildAudienceAutomatic) only
// includes this when a connection exists, so tabs never show when nothing is
// connected. When another platform's OAuth lands, add its tab here. We do not
// render disabled placeholder tabs for unconnected platforms.
function buildPlatformTabsHtml(platforms) {
  if (!Array.isArray(platforms) || platforms.length === 0) return '';
  return `<div class="ig-platform-tabs" role="tablist" aria-label="Audience by platform">
    ${platforms.map((p, i) => `<button type="button" class="ig-platform-tab${i === 0 ? ' is-active' : ''}" role="tab" aria-selected="${i === 0 ? 'true' : 'false'}" data-platform-tab="${esc(p.key)}">${p.svg}${esc(p.label)}</button>`).join('')}
  </div>`;
}

// Format a duration in seconds as M:SS (used by the YouTube panel).
function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ':' + (sec < 10 ? '0' + sec : '' + sec);
}

// Gender stacked-bar block. Shared by all platform panels. Expects the stored
// shape [{ keys: ['M'|'F'|'O'], value }].
function buildGenderBlock(genderArr) {
  if (!Array.isArray(genderArr) || genderArr.length === 0) return '';
  const total = genderArr.reduce((s, g) => s + (Number(g.value) || 0), 0);
  if (total <= 0) return '';
  const segs = genderArr
    .map(g => {
      const k = (g.keys && g.keys[0]) || '';
      const v = Number(g.value) || 0;
      return { key: (k || 'U').toUpperCase(), pct: (v / total) * 100 };
    })
    .filter(s => s.pct > 0);
  const segClass = k => (k === 'M' ? 'ig-gender-seg-male' : k === 'F' ? 'ig-gender-seg-female' : 'ig-gender-seg-other');
  const segLabel = k => (k === 'M' ? 'Male' : k === 'F' ? 'Female' : 'Other');
  const barSegs = segs.map(s =>
    `<div class="${segClass(s.key)}" style="width:${s.pct.toFixed(1)}%" title="${segLabel(s.key)} ${s.pct.toFixed(1)}%"></div>`
  ).join('');
  const legendHtml = segs.map(s =>
    `<span class="ig-gender-legend-item">
      <span class="ig-gender-legend-dot ${segClass(s.key)}"></span>
      ${esc(segLabel(s.key))} <strong style="color:var(--text);margin-left:2px;">${s.pct.toFixed(1)}%</strong>
    </span>`
  ).join('');
  return `<div class="ig-demo-block">
    <div class="ig-demo-block-title">Gender</div>
    <div class="ig-gender-split">${barSegs}</div>
    <div class="ig-gender-legend">${legendHtml}</div>
  </div>`;
}

// Age x Gender block with All/Male/Female tabs. Shared by all platform panels.
// Expects the stored shape [{ keys: ['18-24','M'], value }]. SSR renders the
// "All" tab; the client swaps Male/Female from the JSON payload.
function buildAgeGenderBlock(ageGenderArr) {
  if (!Array.isArray(ageGenderArr) || ageGenderArr.length === 0) return '';
  const buckets = { all: {}, M: {}, F: {}, U: {} };
  for (const item of ageGenderArr) {
    const k1 = (item.keys && item.keys[0]) || '';
    const k2 = (item.keys && item.keys[1]) || '';
    const isAgeFirst = /-/.test(k1);
    const age = isAgeFirst ? k1 : k2;
    const gender = (isAgeFirst ? k2 : k1).toUpperCase();
    const v = Number(item.value) || 0;
    if (!age) continue;
    buckets.all[age] = (buckets.all[age] || 0) + v;
    const g = (gender === 'M' || gender === 'F') ? gender : 'U';
    buckets[g][age] = (buckets[g][age] || 0) + v;
  }
  function bucketToBars(b) {
    const ageOrder = ['13-17','18-24','25-34','35-44','45-54','55-64','65+'];
    const arr = ageOrder.map(age => ({ age, value: b[age] || 0 })).filter(x => x.value > 0);
    const total = arr.reduce((s, x) => s + x.value, 0);
    if (total === 0) return null;
    return arr.map(x => ({ label: x.age, value: x.value, pct: Math.round((x.value / total) * 1000) / 10 }));
  }
  const allBars = bucketToBars(buckets.all);
  const maleBars = bucketToBars(buckets.M);
  const femaleBars = bucketToBars(buckets.F);
  if (!allBars || allBars.length === 0) return '';
  const payload = JSON.stringify({ all: allBars, male: maleBars, female: femaleBars });
  return `<div class="ig-demo-block">
    <div class="ig-demo-block-title">Age &amp; Gender</div>
    <div class="ig-demo-tabs" role="tablist" data-ag-tabs>
      <button class="ig-demo-tab is-active" type="button" role="tab" data-ag-tab="all">All</button>
      ${maleBars ? '<button class="ig-demo-tab" type="button" role="tab" data-ag-tab="male">Male</button>' : ''}
      ${femaleBars ? '<button class="ig-demo-tab" type="button" role="tab" data-ag-tab="female">Female</button>' : ''}
    </div>
    <div class="ig-ag-mount" data-ag-payload='${esc(payload)}'>${renderBarList(allBars)}</div>
  </div>`;
}

// Convert demographics array (from instagram_connections) to a simple
// {label, value, pct} list, sorted by value desc and capped at top N.
function buildBarList(demoArray, topN) {
  if (!Array.isArray(demoArray) || demoArray.length === 0) return null;
  const items = demoArray
    .map(item => {
      // keys is an array; for single-dimension breakdowns there's one key
      const label = (item.keys && item.keys[0]) || '';
      return { label: label, value: Number(item.value) || 0 };
    })
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, topN || 8);
  if (items.length === 0) return null;
  const total = items.reduce((s, x) => s + x.value, 0);
  return items.map(x => ({
    label: x.label,
    value: x.value,
    pct: total > 0 ? Math.round((x.value / total) * 1000) / 10 : 0
  }));
}

// Render a bar list block
function renderBarList(items, options) {
  if (!items || items.length === 0) return '';
  const labelMap = (options && options.labelMap) || (k => k);
  return `<div class="ig-bar-list">
    ${items.map(it => `<div class="ig-bar-row">
      <div class="ig-bar-label">${esc(labelMap(it.label))}</div>
      <div class="ig-bar-track"><div class="ig-bar-fill" style="width:${it.pct}%"></div></div>
      <div class="ig-bar-pct">${it.pct.toFixed(1)}%</div>
    </div>`).join('')}
  </div>`;
}

// Country code → display name (just the most common ones; fall back to code)
const COUNTRY_NAMES = {
  US:'United States', GB:'United Kingdom', CA:'Canada', AU:'Australia', DE:'Germany',
  FR:'France', IT:'Italy', ES:'Spain', NL:'Netherlands', BR:'Brazil', MX:'Mexico',
  IN:'India', JP:'Japan', KR:'South Korea', CN:'China', PH:'Philippines',
  ID:'Indonesia', TH:'Thailand', VN:'Vietnam', SG:'Singapore', MY:'Malaysia',
  AR:'Argentina', CL:'Chile', CO:'Colombia', PE:'Peru', NG:'Nigeria',
  ZA:'South Africa', EG:'Egypt', AE:'United Arab Emirates', SA:'Saudi Arabia',
  TR:'Turkey', PL:'Poland', SE:'Sweden', NO:'Norway', DK:'Denmark', FI:'Finland',
  IE:'Ireland', PT:'Portugal', GR:'Greece', BE:'Belgium', AT:'Austria',
  CH:'Switzerland', NZ:'New Zealand', RU:'Russia', UA:'Ukraine'
};
function countryLabel(code) {
  if (!code) return '';
  return COUNTRY_NAMES[code] || code;
}

// Instagram audience panel (inner HTML, no section wrapper). Demographics use
// the shared buildGenderBlock / buildAgeGenderBlock helpers; output markup is
// unchanged from the prior single-platform renderer.
function buildIgPanel(ig) {
  const igHandle = ig.ig_username ? '@' + ig.ig_username : '';
  const igUrl = ig.ig_username ? 'https://instagram.com/' + encodeURIComponent(ig.ig_username) : null;
  const lastSynced = formatLastSynced(ig.data_last_fetched_at);

  const attributionInner = lastSynced
    ? `Verified by Instagram <span class="ig-attr-sep" aria-hidden="true">&bull;</span> Last synced ${esc(lastSynced)}`
    : 'Verified by Instagram';

  const headerHtml = `<div class="ig-header">
    <div class="ig-header-icon" aria-hidden="true">${SOCIAL_PLATFORMS[0].svg}</div>
    <div class="ig-header-body">
      ${igHandle ? (igUrl
        ? `<a class="ig-handle" href="${esc(igUrl)}" target="_blank" rel="noopener nofollow">${esc(igHandle)}</a>`
        : `<span class="ig-handle">${esc(igHandle)}</span>`) : ''}
      <span class="ig-attribution">${attributionInner}</span>
    </div>
  </div>`;

  const primaryStats = [];
  if (typeof ig.followers_count === 'number') {
    primaryStats.push({ label: 'Followers', value: formatNumber(ig.followers_count) });
  }
  if (typeof ig.engagement_rate === 'number') {
    primaryStats.push({ label: 'Engagement Rate', value: ig.engagement_rate.toFixed(2) + '%' });
  }
  if (typeof ig.reach_30d === 'number') {
    primaryStats.push({ label: '30-Day Reach', value: formatNumber(ig.reach_30d) });
  }
  if (typeof ig.total_interactions_30d === 'number') {
    primaryStats.push({ label: 'Total Engagements (30d)', value: formatNumber(ig.total_interactions_30d) });
  }
  if (typeof ig.views_30d === 'number') {
    primaryStats.push({ label: 'Total Impressions (30d)', value: formatNumber(ig.views_30d) });
  }

  const primaryHtml = primaryStats.length > 0 ? `<div class="ig-stats-grid">
    ${primaryStats.map(s => `<div class="ig-stat-card">
      <div class="ig-stat-num">${esc(s.value)}</div>
      <div class="ig-stat-label">${esc(s.label)}</div>
    </div>`).join('')}
  </div>` : '';

  const avgStats = [];
  if (typeof ig.avg_likes === 'number') avgStats.push({ label: 'Avg Likes', value: formatNumber(Math.round(ig.avg_likes)) });
  if (typeof ig.avg_comments === 'number') avgStats.push({ label: 'Avg Comments', value: formatNumber(Math.round(ig.avg_comments)) });
  if (typeof ig.avg_reel_views === 'number') avgStats.push({ label: 'Avg Reel Views', value: formatNumber(Math.round(ig.avg_reel_views)) });
  if (typeof ig.avg_story_views === 'number') avgStats.push({ label: 'Avg Story Views', value: formatNumber(Math.round(ig.avg_story_views)) });

  const avgHtml = avgStats.length > 0 ? `<div class="ig-subsection">
    <div class="ig-subtitle">Per-Post Averages</div>
    <div class="ig-stats-grid">
      ${avgStats.map(s => `<div class="ig-stat-card">
        <div class="ig-stat-num">${esc(s.value)}</div>
        <div class="ig-stat-label">${esc(s.label)}</div>
      </div>`).join('')}
    </div>
  </div>` : '';

  const genderHtml = buildGenderBlock(ig.demographics_gender);
  const ageGenderHtml = buildAgeGenderBlock(ig.demographics_age_gender);

  let countriesHtml = '';
  const countryItems = buildBarList(ig.demographics_top_countries, 6);
  if (countryItems) {
    countriesHtml = `<div class="ig-demo-block">
      <div class="ig-demo-block-title">Top Countries</div>
      ${renderBarList(countryItems, { labelMap: countryLabel })}
    </div>`;
  }

  let citiesHtml = '';
  const cityItems = buildBarList(ig.demographics_top_cities, 6);
  if (cityItems) {
    citiesHtml = `<div class="ig-demo-block">
      <div class="ig-demo-block-title">Top Cities</div>
      ${renderBarList(cityItems)}
    </div>`;
  }

  const demoBlocks = [genderHtml, ageGenderHtml, countriesHtml, citiesHtml].filter(Boolean);
  const demographicsBlock = demoBlocks.length > 0 ? `<div class="ig-subsection">
    <div class="ig-subtitle">Audience Demographics</div>
    <div class="ig-demo-grid">${demoBlocks.join('')}</div>
  </div>` : '';

  const demographicsNotAvailable = demoBlocks.length === 0 && typeof ig.followers_count === 'number' && ig.followers_count < 100
    ? `<div class="ig-note">Audience demographics are not available yet. Instagram requires 100+ followers to share these insights.</div>`
    : '';

  return `${headerHtml}${primaryHtml}${avgHtml}${demographicsBlock}${demographicsNotAvailable}`;
}

// YouTube audience panel (inner HTML, no section wrapper). Same structure and
// classes as the Instagram panel, with YouTube-appropriate stat labels and no
// "Top Cities" block (YouTube Analytics does not provide city-level data).
function buildYtPanel(yt) {
  const title = yt.yt_channel_title || 'YouTube';
  let url = null;
  if (yt.yt_custom_url) {
    const cu = String(yt.yt_custom_url);
    url = cu.charAt(0) === '@'
      ? 'https://youtube.com/' + encodeURIComponent(cu)
      : 'https://youtube.com/' + cu.split('/').map(encodeURIComponent).join('/');
  }
  const lastSynced = formatLastSynced(yt.data_last_fetched_at);

  const attributionInner = lastSynced
    ? `Verified by YouTube <span class="ig-attr-sep" aria-hidden="true">&bull;</span> Last synced ${esc(lastSynced)}`
    : 'Verified by YouTube';

  const ytSvg = (SOCIAL_PLATFORMS.find(p => p.key === 'youtube') || {}).svg || '';

  const headerHtml = `<div class="ig-header">
    <div class="ig-header-icon" aria-hidden="true">${ytSvg}</div>
    <div class="ig-header-body">
      ${url
        ? `<a class="ig-handle" href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(title)}</a>`
        : `<span class="ig-handle">${esc(title)}</span>`}
      <span class="ig-attribution">${attributionInner}</span>
    </div>
  </div>`;

  const primaryStats = [];
  if (typeof yt.subscriber_count === 'number') primaryStats.push({ label: 'Subscribers', value: formatNumber(yt.subscriber_count) });
  if (typeof yt.view_count === 'number') primaryStats.push({ label: 'Total Views', value: formatNumber(yt.view_count) });
  if (typeof yt.views_30d === 'number') primaryStats.push({ label: '30-Day Views', value: formatNumber(yt.views_30d) });
  if (typeof yt.watch_time_minutes_30d === 'number') primaryStats.push({ label: 'Watch Hours (30d)', value: formatNumber(Math.round(yt.watch_time_minutes_30d / 60)) });
  if (typeof yt.avg_view_duration_seconds === 'number') primaryStats.push({ label: 'Avg View Duration', value: fmtDuration(yt.avg_view_duration_seconds) });
  if (typeof yt.engagement_rate === 'number') primaryStats.push({ label: 'Engagement Rate', value: yt.engagement_rate.toFixed(2) + '%' });

  const primaryHtml = primaryStats.length > 0 ? `<div class="ig-stats-grid">
    ${primaryStats.map(s => `<div class="ig-stat-card">
      <div class="ig-stat-num">${esc(s.value)}</div>
      <div class="ig-stat-label">${esc(s.label)}</div>
    </div>`).join('')}
  </div>` : '';

  const avgStats = [];
  if (typeof yt.avg_views_per_video === 'number') avgStats.push({ label: 'Avg Views / Video', value: formatNumber(Math.round(yt.avg_views_per_video)) });
  if (Array.isArray(yt.recent_media) && yt.recent_media.length) {
    const likes = yt.recent_media.map(v => Number(v.likes)).filter(n => !isNaN(n));
    const comments = yt.recent_media.map(v => Number(v.comments)).filter(n => !isNaN(n));
    if (likes.length) avgStats.push({ label: 'Avg Likes', value: formatNumber(Math.round(likes.reduce((a, b) => a + b, 0) / likes.length)) });
    if (comments.length) avgStats.push({ label: 'Avg Comments', value: formatNumber(Math.round(comments.reduce((a, b) => a + b, 0) / comments.length)) });
  }
  if (typeof yt.subscribers_gained_30d === 'number') avgStats.push({ label: 'Subscribers Gained (30d)', value: formatNumber(yt.subscribers_gained_30d) });

  const avgHtml = avgStats.length > 0 ? `<div class="ig-subsection">
    <div class="ig-subtitle">Performance</div>
    <div class="ig-stats-grid">
      ${avgStats.map(s => `<div class="ig-stat-card">
        <div class="ig-stat-num">${esc(s.value)}</div>
        <div class="ig-stat-label">${esc(s.label)}</div>
      </div>`).join('')}
    </div>
  </div>` : '';

  const genderHtml = buildGenderBlock(yt.demographics_gender);
  const ageGenderHtml = buildAgeGenderBlock(yt.demographics_age_gender);

  let countriesHtml = '';
  const countryItems = buildBarList(yt.demographics_top_countries, 6);
  if (countryItems) {
    countriesHtml = `<div class="ig-demo-block">
      <div class="ig-demo-block-title">Top Countries</div>
      ${renderBarList(countryItems, { labelMap: countryLabel })}
    </div>`;
  }

  const demoBlocks = [genderHtml, ageGenderHtml, countriesHtml].filter(Boolean);
  const demographicsBlock = demoBlocks.length > 0 ? `<div class="ig-subsection">
    <div class="ig-subtitle">Audience Demographics</div>
    <div class="ig-demo-grid">${demoBlocks.join('')}</div>
  </div>` : '';

  return `${headerHtml}${primaryHtml}${avgHtml}${demographicsBlock}`;
}

// Renders when media_kit.audience_mode = 'automatic'. Accepts a map of platform
// data ({ instagram, youtube }); renders one tab + panel per connected platform.
// The first connected platform's panel is visible; the rest are hidden and
// revealed by the client-side platform-tab switcher.
// Recent Engagement rate from per-video stats in recent_media.
// View-based (likes+comments / views) when TikTok returns per-video views;
// otherwise followers-based (avg engagements per recent video / followers).
// Returns a percentage number, or null if nothing usable.
function computeTtRecentEngagement(tt) {
  const vids = (tt && Array.isArray(tt.recent_media)) ? tt.recent_media : [];
  let sumViews = 0, sumLikes = 0, sumComments = 0, n = 0;
  for (const v of vids) {
    if (!v) continue;
    const likes = (typeof v.likes === 'number') ? v.likes : null;
    const comments = (typeof v.comments === 'number') ? v.comments : null;
    if (likes == null && comments == null) continue;
    sumLikes += likes || 0;
    sumComments += comments || 0;
    if (typeof v.views === 'number' && v.views > 0) sumViews += v.views;
    n++;
  }
  if (n === 0) return null;
  if (sumViews > 0) {
    return ((sumLikes + sumComments) / sumViews) * 100;
  }
  if (typeof tt.follower_count === 'number' && tt.follower_count > 0) {
    return (((sumLikes + sumComments) / n) / tt.follower_count) * 100;
  }
  return null;
}

function buildTtPanel(tt) {
  const title = tt.tt_display_name || 'TikTok';
  const url = tt.tt_profile_web_link ? String(tt.tt_profile_web_link) : null;
  const lastSynced = formatLastSynced(tt.data_last_fetched_at);

  const attributionInner = lastSynced
    ? `Verified by TikTok <span class="ig-attr-sep" aria-hidden="true">&bull;</span> Last synced ${esc(lastSynced)}`
    : 'Verified by TikTok';

  const ttSvg = (SOCIAL_PLATFORMS.find(p => p.key === 'tiktok') || {}).svg || '';

  const headerHtml = `<div class="ig-header">
    <div class="ig-header-icon" aria-hidden="true">${ttSvg}</div>
    <div class="ig-header-body">
      ${url
        ? `<a class="ig-handle" href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(title)}</a>`
        : `<span class="ig-handle">${esc(title)}</span>`}
      <span class="ig-attribution">${attributionInner}</span>
    </div>
  </div>`;

  // Recent Engagement, computed from the per-video stats in recent_media (the
  // same videos we fetch via video.list). Preferred: view-based (likes+comments
  // over views), the industry-standard TikTok rate. Falls back to a
  // followers-based rate on those recent videos if TikTok withholds per-video
  // views. Returns null when there are no usable recent stats. This replaces the
  // old lifetime-likes proxy, which distorted the number (cumulative likes vs.
  // current followers).
  const ttEngagement = computeTtRecentEngagement(tt);

  const primaryStats = [];
  if (typeof tt.follower_count === 'number') primaryStats.push({ label: 'Followers', value: formatNumber(tt.follower_count) });
  if (typeof tt.likes_count === 'number') primaryStats.push({ label: 'Total Likes', value: formatNumber(tt.likes_count) });
  if (ttEngagement != null) primaryStats.push({ label: 'Engagement Rate', value: ttEngagement.toFixed(2) + '%' });
  if (typeof tt.video_count === 'number') primaryStats.push({ label: 'Videos', value: formatNumber(tt.video_count) });
  if (typeof tt.following_count === 'number') primaryStats.push({ label: 'Following', value: formatNumber(tt.following_count) });
  if (typeof tt.avg_likes_per_video === 'number') primaryStats.push({ label: 'Avg Likes / Video', value: formatNumber(Math.round(tt.avg_likes_per_video)) });

  const primaryHtml = primaryStats.length > 0 ? `<div class="ig-stats-grid">
    ${primaryStats.map(s => `<div class="ig-stat-card">
      <div class="ig-stat-num">${esc(s.value)}</div>
      <div class="ig-stat-label">${esc(s.label)}</div>
    </div>`).join('')}
  </div>` : '';

  // Recent public videos (video.list). Thumbnail grid linking out to TikTok.
  let recentHtml = '';
  const vids = Array.isArray(tt.recent_media) ? tt.recent_media.filter(v => v && v.cover) : [];
  if (vids.length) {
    const cards = vids.slice(0, 6).map(v => {
      const cover = esc(v.cover);
      const link = validExternalUrl(v.link);
      const views = (typeof v.views === 'number') ? formatNumber(v.views) : null;
      const metaHtml = views ? `<div class="tt-vid-meta"><span class="tt-vid-views">${esc(views)} views</span></div>` : '';
      const inner = `<div class="tt-vid-thumb"><img src="${cover}" alt="" loading="lazy"></div>${metaHtml}`;
      return link
        ? `<a class="tt-vid-card" href="${esc(link)}" target="_blank" rel="noopener nofollow">${inner}</a>`
        : `<div class="tt-vid-card">${inner}</div>`;
    }).join('');
    recentHtml = `<div class="ig-subsection">
      <div class="ig-subtitle">Recent Videos</div>
      <div class="tt-vid-grid">${cards}</div>
    </div>`;
  }

  return `${headerHtml}${primaryHtml}${recentHtml}`;
}

function buildAudienceAutomatic(kit, data) {
  data = data || {};
  const ig = data.instagram || null;
  const yt = data.youtube || null;
  const tt = data.tiktok || null;

  const platforms = [];
  if (ig) platforms.push({ key: 'instagram', label: 'Instagram', svg: SOCIAL_PLATFORMS[0].svg, panel: buildIgPanel(ig) });
  if (yt) platforms.push({ key: 'youtube', label: 'YouTube', svg: (SOCIAL_PLATFORMS.find(p => p.key === 'youtube') || {}).svg || '', panel: buildYtPanel(yt) });
  if (tt) platforms.push({ key: 'tiktok', label: 'TikTok', svg: (SOCIAL_PLATFORMS.find(p => p.key === 'tiktok') || {}).svg || '', panel: buildTtPanel(tt) });

  if (platforms.length === 0) {
    return `<div class="section ig-section">
      <div class="section-title">Audience &amp; Stats</div>
      <div class="ig-empty">Audience data is not yet available. The creator hasn't connected an account, or data is still syncing.</div>
    </div>`;
  }

  const tabs = platforms.length > 1 ? buildPlatformTabsHtml(platforms) : '';
  const panels = platforms.map((p, i) =>
    `<div class="ig-platform-panel" data-platform-panel="${esc(p.key)}"${i === 0 ? '' : ' hidden'}>${p.panel}</div>`
  ).join('');

  const donut = buildFollowerSplitDonut(data);

  return `<div class="section ig-section">
    <div class="section-title">Audience &amp; Stats</div>
    ${tabs}
    ${panels}
    ${donut}
  </div>`;
}

// ==== Videos (YouTube + TikTok): mirrors the Link in Bio embeds ====
function extractYouTubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function extractTikTokId(url) {
  if (!url) return null;
  const m = String(url).match(/tiktok\.com\/(?:.*\/video\/|embed\/(?:v2\/)?|v\/)(\d{6,})/i);
  return m ? m[1] : null;
}
function isShortsUrl(url) {
  return /youtube\.com\/shorts\//i.test(String(url || ''));
}
function buildVideos(kit) {
  const v = (kit && kit.videos && typeof kit.videos === 'object') ? kit.videos : {};
  const yt = Array.isArray(v.youtube) ? v.youtube : [];
  const tt = Array.isArray(v.tiktok) ? v.tiktok : [];
  const ytCards = yt.map(url => {
    const id = extractYouTubeId(url);
    if (!id) return '';
    const vert = isShortsUrl(url) ? ' vertical' : '';
    const thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    return `<div class="video-card${vert}" tabindex="0" role="button" aria-label="Play video" data-mk-action="play-video" data-mk-video-id="${id}">
        <div class="video-thumb-wrap">
          <img class="video-thumb" src="${thumb}" alt="YouTube video thumbnail" loading="lazy">
          <div class="video-play"><div class="video-play-icon"></div></div>
        </div>
      </div>`;
  }).filter(Boolean).join('');
  const ttCards = tt.map(url => {
    const id = extractTikTokId(url);
    if (!id) return '';
    return `<div class="video-card vertical tiktok-card">
        <div class="video-thumb-wrap">
          <iframe class="video-iframe" src="https://www.tiktok.com/player/v1/${id}" loading="lazy" title="TikTok video player" allow="fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>
        </div>
      </div>`;
  }).filter(Boolean).join('');
  if (!ytCards && !ttCards) return '';
  const arrows = '<button type="button" class="videos-arrow videos-arrow-l" aria-label="Scroll left" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></button><button type="button" class="videos-arrow videos-arrow-r" aria-label="Scroll right" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>';
  const ytBlock = ytCards ? `<div class="videos">${arrows}<div class="videos-scroll">${ytCards}</div></div>` : '';
  const ttBlock = ttCards ? `<div class="videos">${arrows}<div class="videos-scroll">${ttCards}</div></div>` : '';
  return `<div class="section">
    <div class="section-title">Videos</div>
    ${ytBlock}
    ${ttBlock}
  </div>`;
}

// Photos. Mirrors the Link in Bio image carousel: reuses the .videos chrome so the
// existing arrow wiring covers it; each image keeps its natural aspect ratio.
function buildCarousel(kit) {
  const imgs = (kit && Array.isArray(kit.carousel)) ? kit.carousel : [];
  const cards = imgs.filter(im => im && im.photoUrl).slice(0, 10).map(im => {
    const dim = (im.w && im.h) ? ` width="${im.w}" height="${im.h}"` : '';
    return `<div class="img-card"><img class="img-card-img" src="${esc(im.photoUrl)}"${dim} loading="lazy" alt=""></div>`;
  }).join('');
  if (!cards) return '';
  const arrows = '<button type="button" class="videos-arrow videos-arrow-l" aria-label="Scroll left" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></button><button type="button" class="videos-arrow videos-arrow-r" aria-label="Scroll right" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>';
  return `<div class="section">
    <div class="section-title">Photos</div>
    <div class="videos">${arrows}<div class="videos-scroll">${cards}</div></div>
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
  // Render the Contact section when EITHER a valid email OR a note is
  // present. Creators can use the note as a standalone "how to reach me"
  // message (e.g., "DM me on Instagram") without needing to expose an email.
  const safeEmail = kit.contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kit.contact_email) ? kit.contact_email : null;
  const note = kit.contact_note ? String(kit.contact_note).trim() : '';
  if (!safeEmail && !note) return '';

  const mailIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 4h20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm10 9.44L3.3 6H20.7L12 13.44Z"/></svg>';

  return `<div class="section">
    <div class="section-title">Contact</div>
    ${safeEmail ? `<a class="contact-email" href="mailto:${esc(safeEmail)}">
      ${mailIcon}
      <span>${esc(safeEmail)}</span>
    </a>` : ''}
    ${note ? `<div class="contact-note">${esc(note)}</div>` : ''}
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

// Strict hex color validator. Returns the input if it matches #RRGGBB / #RGB / #RRGGBBAA / #RGBA,
// otherwise returns the fallback. Prevents CSS injection via user-supplied color values
// (e.g. `red; } body { background: url(...) } /*` breaking out of the property).
function safeHexColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return value;
  }
  return fallback;
}

// Strict opacity validator. Returns a number in [0, 1] or the fallback.
// Rejects null/undefined explicitly (they should mean "use default" rather than 0).
function safeOpacity(value, fallback) {
  if (value == null) return fallback;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return fallback;
}

function buildCustomThemeStyle(ct) {
  if (!ct) return '';
  const colors = ct.colors || {};
  // Validate every color input strictly. Anything that isn't #RRGGBB/#RGB
  // falls back to the default. Prevents CSS injection like
  //   accent: "red; } body { background: url(evil) } /*"
  const bg = safeHexColor(colors.bg, '#07070f');
  const card = safeHexColor(colors.card, '#161625');
  const text = safeHexColor(colors.text, '#ffffff');
  const accent = safeHexColor(colors.accent, '#a78bfa');

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
    // bgUrl must pass our strict validator (https + our own Supabase bucket).
    // If it doesn't, we just omit the bg image rather than risk CSS injection
    // via a URL containing `)` or `}`.
    const safeBgUrl = validImageUrl(ct.bgUrl);
    if (safeBgUrl) {
      const op = safeOpacity(ct.bgOpacity, 0.4);
      const darkness = 1 - op;
      css += `
    :root[data-theme="custom"] body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image: url("${safeBgUrl}");
      background-size: cover;
      background-position: center;
      z-index: -2;
    }
    :root[data-theme="custom"] body::after {
      content: '';
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,${darkness.toFixed(2)});
      z-index: -1;
    }`;
    }
  }

  return `<style id="custom-bg-style">${css}</style>`;
}

// ==========================================================================
// BUILTIN IMAGE THEMES — free for all tiers
// Mirror of BIO_THEMES image entries in dashboard.html — keep in sync.
// ==========================================================================

const BUILTIN_IMAGE_THEMES = {
  paperwhite: { image:'/bgtemplates/1.webp', colors:{bg:'#FFFFFF',card:'#F5F5F8',text:'#1A1A2E',accent:'#6366F1'} },
  ember:      { image:'/bgtemplates/2.webp', colors:{bg:'#1A1A1C',card:'#262628',text:'#F5F2ED',accent:'#F97316'} },
  sapphire:   { image:'/bgtemplates/3.webp', colors:{bg:'#1E3A8A',card:'#172554',text:'#F5EFE0',accent:'#D4AF37'} },
  blossom:    { image:'/bgtemplates/4.webp', colors:{bg:'#FCE7EB',card:'#F8D7DD',text:'#5C2E3D',accent:'#C9A961'} },
  honey:      { image:'/bgtemplates/5.webp', colors:{bg:'#FCEFC0',card:'#F8E48E',text:'#5C3F17',accent:'#B45309'} },
};

function buildImageThemeStyle(themeKey) {
  const theme = BUILTIN_IMAGE_THEMES[themeKey];
  if (!theme) return '';
  const { bg, card, text, accent } = theme.colors;
  const safeBgUrl = String(theme.image).replace(/"/g, '&quot;');

  const css = `:root[data-theme="custom"] {
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
  }
  :root[data-theme="custom"] body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image: url("${safeBgUrl}");
    background-size: cover;
    background-position: center;
    z-index: -2;
  }`;

  return `<style id="custom-bg-style">${css}</style>`;
}

function isBuiltinImageTheme(key) {
  return !!BUILTIN_IMAGE_THEMES[key];
}

// ==========================================================================
// MAIN RENDER — produces inner HTML for the #wrap div
// ==========================================================================

function renderMediaKitContent(profile, kit, ig, yt, tt) {
  const headshot = validImageUrl(kit.headshot_url);

  const isPaid = profile.tier === 'monthly' || profile.tier === 'max';
  // Banner rule: always on for non-Pro. Pro/Max can opt out via show_branding=true (note the inversion).
  const showBanner = !isPaid || kit.show_branding === true;

  const bannerHtml = showBanner ? `<div class="banner-wrap">
    <a class="brand-banner" href="https://www.ryxa.io"><img src="https://www.ryxa.io/logo.png" alt="Ryxa" class="brand-banner-logo"><span>Media Kit powered by <strong>Ryxa</strong></span></a>
  </div>` : '';

  // Choose audience renderer based on creator's saved mode.
  // 'automatic' → pull from instagram_connections cache (ig param).
  // 'manual' (or unset) → use kit.socials + kit.engagement_rate from the kit row.
  const audienceHtml = kit.audience_mode === 'automatic'
    ? buildAudienceAutomatic(kit, { instagram: ig, youtube: yt, tiktok: tt })
    : buildAudience(kit);

  // Total Followers strip — sum across all connected platforms. For now only
  // Instagram is wired up, but the structure already accumulates so future
  // platforms (TikTok, YouTube, etc.) can each contribute their followers_count.
  const totalFollowersHtml = kit.audience_mode === 'automatic'
    ? buildTotalFollowers(kit, ig, yt, tt)
    : '';

  const inner = `<div class="top-actions">
      <button class="btn-dl" data-mk-action="print" aria-label="Download as PDF">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download PDF
      </button>
    </div>
    ${buildHero(kit, headshot)}
    ${totalFollowersHtml}
    ${audienceHtml}
    ${buildRateCard(kit, profile.display_currency || 'USD')}
    ${buildVideos(kit)}
    ${buildCarousel(kit)}
    ${buildContact(kit)}
    ${bannerHtml}`;

  return { inner, showBanner };
}

// Total Followers strip — appears below the hero, summing follower counts
// across every connected platform. Currently only Instagram is wired up,
// but this is structured to accept additional sources later (TikTok,
// YouTube, etc.) by adding to the `sources` array.
//
// Renders only when at least one source has a follower count.
// ==========================================================================
// Cross-platform follower-split donut.
//
// Dynamic and registry-driven: any platform with a positive follower count
// joins automatically, and disconnected platforms (null data) drop out. To add
// a future platform, add one line to FOLLOWER_SPLIT_REGISTRY — no other change.
// Reads only the in-memory follower counts already loaded for this render, so
// there is nothing to persist. Renders only when 2+ platforms have followers
// (a single platform is just "100% X"). Pure inline SVG so it survives the
// page CSP and the PDF export.
// ==========================================================================
const FOLLOWER_SPLIT_REGISTRY = [
  { platform: 'Instagram', color: '#E1306C', get: (d) => d.instagram && d.instagram.followers_count },
  { platform: 'YouTube',   color: '#FF0000', get: (d) => d.youtube && d.youtube.subscriber_count },
  { platform: 'TikTok',    color: '#25F4EE', get: (d) => d.tiktok && d.tiktok.follower_count },
  // Future platforms plug in here, e.g.:
  // { platform: 'Pinterest', color: '#E60023', get: (d) => d.pinterest && d.pinterest.follower_count },
  // { platform: 'Facebook',  color: '#1877F2', get: (d) => d.facebook && d.facebook.follower_count },
];

function buildFollowerSplitDonut(data) {
  data = data || {};
  const slices = [];
  for (const entry of FOLLOWER_SPLIT_REGISTRY) {
    const c = entry.get(data);
    if (typeof c === 'number' && c > 0) slices.push({ platform: entry.platform, color: entry.color, count: c });
  }
  if (slices.length < 2) return '';

  const total = slices.reduce((s, x) => s + x.count, 0);
  const size = 188, stroke = 28, radius = (size - stroke) / 2, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * radius;

  let cumulative = 0;
  const segs = slices.map((s) => {
    const dash = (s.count / total) * circ;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${s.color}" stroke-width="${stroke}" stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" stroke-dashoffset="${(-cumulative).toFixed(2)}"></circle>`;
    cumulative += dash;
    return seg;
  }).join('');

  const legend = slices.map((s) => {
    const pct = Math.round((s.count / total) * 100);
    return `<div class="fsd-row">
      <span class="fsd-dot" style="background:${s.color}"></span>
      <span class="fsd-name">${esc(s.platform)}</span>
      <span class="fsd-pct">${pct}%</span>
      <span class="fsd-count">${esc(formatNumber(s.count))}</span>
    </div>`;
  }).join('');

  return `<div class="fsd">
    <div class="fsd-title">Audience Split</div>
    <div class="fsd-body">
      <div class="fsd-chart">
        <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Share of total followers by platform">
          <g transform="rotate(-90 ${cx} ${cy})">
            <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="var(--border)" stroke-width="${stroke}"></circle>
            ${segs}
          </g>
          <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="fsd-cnum">${esc(formatNumber(total))}</text>
          <text x="${cx}" y="${cy + 15}" text-anchor="middle" class="fsd-clbl">Total</text>
        </svg>
      </div>
      <div class="fsd-legend">${legend}</div>
    </div>
  </div>`;
}

function buildTotalFollowers(kit, ig, yt, tt) {
  const sources = [];
  if (ig && typeof ig.followers_count === 'number' && ig.followers_count > 0) {
    sources.push({ platform: 'Instagram', count: ig.followers_count });
  }
  if (yt && typeof yt.subscriber_count === 'number' && yt.subscriber_count > 0) {
    sources.push({ platform: 'YouTube', count: yt.subscriber_count });
  }
  if (tt && typeof tt.follower_count === 'number' && tt.follower_count > 0) {
    sources.push({ platform: 'TikTok', count: tt.follower_count });
  }
  // Future: push more rows here as platforms come online.

  if (sources.length === 0) return '';

  const total = sources.reduce((s, x) => s + x.count, 0);

  return `<div class="total-followers-strip">
    <div class="total-followers-label">Total Followers</div>
    <div class="total-followers-value">${esc(formatNumber(total))}</div>
    <div class="total-followers-sub">Combined across all platforms</div>
  </div>`;
}

// Format a UTC timestamp for the public Media Kit page as
// "Apr 30 at 9:45 AM" — note this renders server-side in the
// container's TZ (UTC). For display on the public page that's
// fine; we label it explicitly with the date.
function formatLastSynced(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = months[d.getUTCMonth()];
  const day = d.getUTCDate();
  let hours = d.getUTCHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day} at ${hours}:${minutes} ${ampm} UTC`;
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

    // Step 2: media_kit data, only if published. audience_mode added.
    const kitRes = await fetch(
      `${SUPABASE_URL}/rest/v1/media_kit?user_id=eq.${profile.user_id}&published=eq.true&select=headshot_url,display_name,handle,bio,category,socials,engagement_rate,rate_card,contact_email,contact_note,theme,font_family,show_branding,published,custom_theme,audience_mode,videos,carousel`,
      fetchOpts(controller.signal)
    );
    if (!kitRes.ok) { clearTimeout(timeout); return { profile, kit: null, ig: null }; }
    const kits = await kitRes.json();
    const kit = kits[0] || null;

    // Step 3: if media kit is in automatic mode, also pull cached IG data.
    // Reads from public_instagram_kit_data view (RLS-safe — exposes only
    // the non-sensitive fields needed for public display). The underlying
    // instagram_connections table has owner-only RLS, which would block
    // this anon-key request.
    let ig = null;
    if (kit && kit.audience_mode === 'automatic') {
      try {
        const igRes = await fetch(
          `${SUPABASE_URL}/rest/v1/public_instagram_kit_data?user_id=eq.${profile.user_id}&select=ig_username,profile_picture_url,account_type,followers_count,follows_count,media_count,reach_30d,total_interactions_30d,views_30d,profile_views_30d,avg_likes,avg_comments,avg_reel_views,avg_story_views,engagement_rate,demographics_age_gender,demographics_gender,demographics_top_countries,demographics_top_cities,data_last_fetched_at,data_fetch_error`,
          fetchOpts(controller.signal)
        );
        if (igRes.ok) {
          const igRows = await igRes.json();
          ig = igRows[0] || null;
        }
      } catch (e) {
        // Non-fatal — fall back to whatever buildAudienceAutomatic renders without data
        console.error('mediakit IG fetch error', e);
      }
    }

    // Step 3b: YouTube cached data (same automatic mode). Reads from the
    // public_youtube_kit_data view (safe columns only); the private
    // youtube_connections table is owner-only RLS.
    let yt = null;
    if (kit && kit.audience_mode === 'automatic') {
      try {
        const ytRes = await fetch(
          `${SUPABASE_URL}/rest/v1/public_youtube_kit_data?user_id=eq.${profile.user_id}&select=yt_channel_title,yt_custom_url,thumbnail_url,subscriber_count,view_count,video_count,views_30d,watch_time_minutes_30d,avg_view_duration_seconds,subscribers_gained_30d,likes_30d,comments_30d,shares_30d,engagement_rate,avg_views_per_video,demographics_age_gender,demographics_gender,demographics_top_countries,recent_media,data_last_fetched_at,data_fetch_error`,
          fetchOpts(controller.signal)
        );
        if (ytRes.ok) {
          const ytRows = await ytRes.json();
          yt = ytRows[0] || null;
        }
      } catch (e) {
        console.error('mediakit YT fetch error', e);
      }
    }

    // Step 3c: TikTok cached data (same automatic mode). Reads from the
    // public_tiktok_kit_data view (safe columns only); the private
    // tiktok_connections table is owner-only RLS. Headline-only (no demographics).
    let tt = null;
    if (kit && kit.audience_mode === 'automatic') {
      try {
        const ttRes = await fetch(
          `${SUPABASE_URL}/rest/v1/public_tiktok_kit_data?user_id=eq.${profile.user_id}&select=tt_display_name,tt_avatar_url,tt_profile_web_link,tt_bio_description,tt_is_verified,follower_count,following_count,likes_count,video_count,avg_likes_per_video,recent_media,data_last_fetched_at,data_fetch_error`,
          fetchOpts(controller.signal)
        );
        if (ttRes.ok) {
          const ttRows = await ttRes.json();
          tt = ttRows[0] || null;
        }
      } catch (e) {
        console.error('mediakit TikTok fetch error', e);
      }
    }

    clearTimeout(timeout);
    return { profile, kit, ig, yt, tt };
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
    const { profile, kit, ig, yt, tt } = result;

    // Update OG metadata for social previews
    const name = kit.display_name || profile.username;
    title = `${name}. Media Kit | Ryxa`;
    description = kit.bio
      ? kit.bio
      : `${name}'s creator media kit — collaborations, audience stats, and rates.`;
    if (kit.headshot_url) image = kit.headshot_url;

    // Pick theme: custom theme honored for Pro and Max tiers
    const isPaidTier = profile.tier === 'monthly' || profile.tier === 'max';
    if (kit.theme === 'custom' && isPaidTier && kit.custom_theme) {
      theme = 'custom';
      customThemeStyle = buildCustomThemeStyle(kit.custom_theme);
    } else if (kit.theme === 'custom' && !isPaidTier) {
      theme = 'purple';
    } else if (isBuiltinImageTheme(kit.theme)) {
      // Builtin image themes are free for all tiers. They use the same
      // [data-theme="custom"] CSS selector as the Pro custom theme, but with
      // hardcoded values from BUILTIN_IMAGE_THEMES.
      theme = 'custom';
      customThemeStyle = buildImageThemeStyle(kit.theme);
    } else {
      theme = kit.theme || 'purple';
    }

    // Render the media kit content server-side
    const rendered = renderMediaKitContent(profile, kit, ig, yt, tt);
    renderedInner = rendered.inner;

    // Bootstrap meta tags: stash creator currency + signal SSR hydration so
    // the client JS skips its own fetch+render and only fires trackPageView.
    // Previously this was an inline <script>, but strict CSP forbids inline
    // scripts. Now these values flow into the page as <meta> tags;
    // js/mediakit-page.js reads them at load time and populates
    // window._creatorCurrency etc.
    const bootstrap = `
      <meta name="ryxa-creator-currency" content="${esc(profile.display_currency || 'USD')}">
      <meta name="ryxa-ssr-username" content="${esc(profile.username)}">
      <meta name="ryxa-ssr-hydrated" content="true">`;

    // Inject creator's chosen font (link + override style). Falls back to default
    // if font_family is null or unknown — buildFontInjection handles validation.
    const fontInjection = buildFontInjection(kit.font_family);

    customThemeStyle = fontInjection + customThemeStyle + bootstrap;
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
  // Match: <div class="wrap" id="wrap"> ... <inner state> ... </inner state> </wrap>
  // Does NOT depend on the next tag's shape. Previously this regex anchored on
  // the following inline <script>, but that script is now an external
  // <script src="/js/mediakit-page.js">, so we match the wrap structure alone.
  if (renderedInner) {
    html = html.replace(
      /<div class="wrap" id="wrap">[\s\S]*?<\/div>\s*<\/div>/m,
      `<div class="wrap" id="wrap">${renderedInner}</div>`
    );
  }
  // If no renderedInner, leave the loading placeholder — client JS will fetch + render.

  // 4. Cache headers — fresh for 60s, serve stale up to 5 more minutes while revalidating
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  // 5. Content Security Policy — ENFORCED.
  // Media kit pages are PUBLIC and render user-supplied content (display name,
  // bio, handle, category, contact note, rate descriptions, custom colors,
  // custom backgrounds). Strict CSP is the primary defense against XSS via
  // injected <script> tags in user content.
  //
  // To roll back to Report-Only mode (if breakage is reported), change the
  // header name below from 'Content-Security-Policy' to
  // 'Content-Security-Policy-Report-Only'.
  //
  // Allowed origins explanation:
  //   script-src — Supabase SDK (cdn.jsdelivr.net) + own /js/ + cookie-banner.js
  //   style-src 'unsafe-inline' — required because user color values are inlined
  //     into a <style> tag generated server-side (already hardened via safeHexColor)
  //   font-src — Google Fonts (creator can pick a custom font)
  //   img-src — Supabase Storage (headshot, bg images), www.ryxa.io (logo)
  //   connect-src — Supabase API for analytics + fetching kit data, cdn.jsdelivr.net
  //     for Supabase SDK sourcemap fetches (silences a console error)
  //   frame-src: YouTube + TikTok players for the Videos section
  //   img-src: also i.ytimg.com for YouTube thumbnails
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://www.ryxa.io https://kjytapcgxukalwsyputk.supabase.co https://i.ytimg.com https://*.tiktokcdn.com https://*.tiktokcdn-us.com",
      "connect-src 'self' https://kjytapcgxukalwsyputk.supabase.co https://cdn.jsdelivr.net",
      "media-src 'self' blob: https://kjytapcgxukalwsyputk.supabase.co",
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://www.tiktok.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );

  res.status(200).send(html);
};
