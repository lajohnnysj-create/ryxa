// Vercel serverless function — server-side rendered link-in-bio page
// Renders the full creator bio HTML at the edge so visitors get content on first paint.
// Cached at the Vercel CDN per-URL: s-maxage=60, stale-while-revalidate=300
// Routed via vercel.json rewrite: /:username -> /api/bio?u=:username

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

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

function isShortsUrl(url) {
  return /youtube\.com\/shorts\//i.test(String(url || ''));
}

// Pull the numeric TikTok post id from a full video URL. Supports
// /@user/video/ID, /embed/ID, /embed/v2/ID, /v/ID. Short share links
// (vm.tiktok.com/...) can't be resolved here, so they return null.
function extractTikTokId(url) {
  if (!url) return null;
  const m = String(url).match(/tiktok\.com\/(?:.*\/video\/|embed\/(?:v2\/)?|v\/)(\d{6,})/i);
  return m ? m[1] : null;
}

// Pull the Instagram shortcode from a reel/post URL (/reel/CODE, /reels/CODE,
// /p/CODE, /tv/CODE). The embed only works for public content.
function extractInstagramId(url) {
  if (!url) return null;
  const m = String(url).match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

// Pull the Spotify type + id from a share URL. Handles track/album/playlist/
// artist/episode/show and an optional /intl-xx/ locale prefix. The embed URL
// is open.spotify.com/embed/{type}/{id}.
function extractSpotify(url) {
  if (!url) return null;
  const m = String(url).match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/i);
  return m ? { type: m[1].toLowerCase(), id: m[2] } : null;
}

// Apple Music type + embed src. Embed = same link on embed.music.apple.com,
// keeping the storefront/type/slug/id path and ?i= track selector. Single
// songs get the compact player.
function extractAppleMusic(url) {
  if (!url) return null;
  const s = String(url);
  const m = s.match(/music\.apple\.com\/([a-z]{2})\/(album|playlist|song|artist|music-video|station)\/([^/?#]+)\/([^/?#]+)/i);
  if (!m) return null;
  const type = m[2].toLowerCase();
  const iMatch = s.match(/[?&]i=(\d+)/);
  const src = `https://embed.music.apple.com/${m[1]}/${type}/${m[3]}/${m[4]}` + (iMatch ? `?i=${iMatch[1]}` : '');
  return { type, src, song: !!iMatch || type === 'song' };
}

// SoundCloud embed. The widget takes the full track URL as a query param on
// w.soundcloud.com/player. Accepts track, set (playlist), and profile links;
// sets get the taller tracklist player.
function extractSoundCloud(url) {
  if (!url) return null;
  const m = String(url).trim().match(/^https?:\/\/(?:www\.)?soundcloud\.com\/[^?#\s]+/i);
  if (!m) return null;
  const clean = m[0];
  const isSet = /\/sets\//i.test(clean);
  const src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(clean)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`;
  return { isSet, src };
}

// Resolve a Twitch URL to an embed target: a live channel, a VOD (video), or
// a clip. Order matters — clips/videos are checked before the bare-channel
// pattern, and reserved path segments are excluded from channel matching.
function extractTwitch(url) {
  if (!url) return null;
  const s = String(url);
  let m = s.match(/clips\.twitch\.tv\/(?:embed\?clip=)?([A-Za-z0-9_-]+)/i);
  if (m) return { kind: 'clip', id: m[1] };
  m = s.match(/twitch\.tv\/[A-Za-z0-9_]+\/clip\/([A-Za-z0-9_-]+)/i);
  if (m) return { kind: 'clip', id: m[1] };
  m = s.match(/twitch\.tv\/videos\/(\d+)/i);
  if (m) return { kind: 'video', id: m[1] };
  m = s.match(/twitch\.tv\/([A-Za-z0-9_]{2,25})(?:[/?#]|$)/i);
  if (m) {
    const reserved = ['videos', 'directory', 'settings', 'subscriptions', 'clips', 'embed', 'p', 'u', 'collections', 'following', 'friends', 'downloads', 'jobs', 'turbo'];
    if (!reserved.includes(m[1].toLowerCase())) return { kind: 'channel', id: m[1] };
  }
  return null;
}

// Build the Twitch embed iframe src. parent must match the hosting domain or
// Twitch refuses to play; bios are served on www.ryxa.io. autoplay is off so a
// live channel never blasts on page load.
function twitchEmbedSrc(t) {
  const p = 'parent=www.ryxa.io&parent=ryxa.io';
  if (t.kind === 'clip') return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(t.id)}&${p}&autoplay=false`;
  if (t.kind === 'video') return `https://player.twitch.tv/?video=${encodeURIComponent(t.id)}&${p}&autoplay=false`;
  return `https://player.twitch.tv/?channel=${encodeURIComponent(t.id)}&${p}&autoplay=false`;
}

// Numeric status id from an X / Twitter post URL (twitter.com or x.com,
// /status/ or legacy /statuses/). Used for the platform.twitter.com Tweet.html
// iframe embed — the no-script endpoint X's own widget uses internally.
function extractTweetId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:twitter|x)\.com\/[A-Za-z0-9_]+\/status(?:es)?\/(\d+)/i);
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

// ==========================================================================
// FONTS — must mirror BIO_FONTS in dashboard.html. Keep in sync when adding new fonts.
// Each entry maps a key (saved in DB) to a Google Fonts family + weights + CSS stack.
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

// Returns { link, style } strings to inject into <head>. Falls back to default if key invalid.
function buildFontInjection(fontKey) {
  // When the chosen font is the default ('DM Sans' or null/unknown), inject
  // nothing. The static bio.html stylesheet already paints DM Sans on the body
  // and 'Syne' on headings (.name, .hero-name, .hero-handle) for Ryxa's
  // signature visual hierarchy. Skipping the override preserves that look.
  if (!fontKey || fontKey === 'DM Sans') return '';
  const font = BIO_FONTS_SSR[fontKey] || BIO_FONTS_SSR['DM Sans'];
  const link = `<link href="https://fonts.googleapis.com/css2?family=${font.gfont}:wght@${font.weights}&display=swap" rel="stylesheet">`;
  // Body font is overridden via inline <style> with high specificity
  // so it wins against the default DM Sans declaration in bio.html's stylesheet.
  // The wildcard `body *` ensures every element on the page picks up the
  // creator's chosen font, including Syne-styled headings (.name, .hero-name,
  // section labels, etc). The .brand-banner Ryxa logo banner is excluded so
  // it stays in DM Sans for cross-site consistency.
  const style = `<style id="bio-font-override">body, body * { font-family: ${font.stack} !important; } .brand-banner, .brand-banner * { font-family: 'DM Sans', sans-serif !important; }</style>`;
  return link + style;
}

// ==========================================================================
// SOCIAL ICONS — copied verbatim from bio.html so server output matches client
// ==========================================================================

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

function buildSocialHref(key, val) {
  const clean = val.replace(/^@/, '').trim();
  // Reduce an old saved full-URL value to just the handle for handle-based
  // platforms, keeping the public render consistent with the editor.
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

// ==========================================================================
// AVATAR + HERO HEADER
// ==========================================================================

function buildAvatar(profile, bio) {
  const name = bio.display_name || profile.username || '';
  const initial = (name[0] || profile.username[0] || '?').toUpperCase();
  const safeAvatar = validImageUrl(bio.avatar_url);
  const isPaidTier = profile.tier === 'monthly' || profile.tier === 'max';
  const isHero = bio.avatar_display === 'hero' && safeAvatar && isPaidTier;

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
      const vert = isShortsUrl(v && (v.url || v.videoId));
      const thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      return `<div class="video-card${vert ? ' vertical' : ''}" tabindex="0" role="button" aria-label="Play video"
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

  // TikTok block — same vertical (9:16) carousel as YouTube Shorts, but each
  // card embeds TikTok's official player iframe (lazy-loaded; it shows its own
  // poster frame and play button). No thumbnail fetch needed.
  if (link.isTikTokBlock) {
    const videos = Array.isArray(link.videos) ? link.videos : [];
    const cards = videos.map(v => {
      const id = extractTikTokId(v && v.url);
      if (!id) return '';
      return `<div class="video-card vertical tiktok-card">
        <div class="video-thumb-wrap">
          <iframe class="video-iframe" src="https://www.tiktok.com/player/v1/${id}" loading="lazy"
            title="TikTok video player" allow="fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>
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

  // Instagram block — official Instagram embed card per reel (lazy iframe).
  // Not a clean 9:16 tile: Instagram only offers its full embed card (header,
  // media, caption). Public reels only; private/blocked render empty.
  if (link.isInstagramBlock) {
    const videos = Array.isArray(link.videos) ? link.videos : [];
    const cards = videos.map(v => {
      const id = extractInstagramId(v && v.url);
      if (!id) return '';
      return `<div class="ig-embed-card">
        <div class="ig-embed-placeholder" aria-hidden="true"><svg class="ig-embed-ph-glyph" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none"/></svg></div>
        <iframe class="ig-embed-frame" src="https://www.instagram.com/reel/${id}/embed/" loading="lazy"
          title="Instagram reel" scrolling="no" allowtransparency="true" allow="encrypted-media; picture-in-picture; fullscreen"></iframe>
      </div>`;
    }).filter(Boolean).join('');
    if (!cards) return '';
    return `<div class="videos">
      <button type="button" class="videos-arrow videos-arrow-l" aria-label="Scroll left" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></button>
      <button type="button" class="videos-arrow videos-arrow-r" aria-label="Scroll right" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>
      <div class="videos-scroll">${cards}</div>
    </div>`;
  }

  // Spotify embed — a single track/album/playlist/artist/episode/show. Tracks
  // and episodes get a compact player; the rest get the taller tracklist player.
  if (link.isSpotifyBlock) {
    const sp = extractSpotify(link.url);
    if (!sp) return '';
    const tall = (sp.type === 'album' || sp.type === 'playlist' || sp.type === 'artist' || sp.type === 'show');
    return `<div class="spotify-embed${tall ? ' tall' : ''}">
      <iframe class="spotify-frame" src="https://open.spotify.com/embed/${sp.type}/${sp.id}" loading="lazy" title="Spotify player" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
    </div>`;
  }

  // Apple Music embed — a single song/album/playlist/artist. Songs get a
  // compact player; albums and playlists get the taller tracklist player.
  if (link.isAppleMusicBlock) {
    const am = extractAppleMusic(link.url);
    if (!am) return '';
    const tall = !am.song;
    return `<div class="apple-music-embed${tall ? ' tall' : ''}">
      <iframe class="apple-music-frame" src="${am.src}" loading="lazy" title="Apple Music player" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
    </div>`;
  }

  // SoundCloud embed — track (compact) or set/playlist (taller tracklist).
  if (link.isSoundCloudBlock) {
    const sc = extractSoundCloud(link.url);
    if (!sc) return '';
    const tall = sc.isSet;
    return `<div class="soundcloud-embed${tall ? ' tall' : ''}">
      <iframe class="soundcloud-frame" src="${sc.src}" loading="lazy" title="SoundCloud player" allow="autoplay"></iframe>
    </div>`;
  }

  // Single image — uploaded photo at full column width. width/height attrs
  // reserve the aspect ratio so the page doesn't reflow as it loads.
  if (link.isImageBlock) {
    if (!link.photoUrl) return '';
    const dim = (link.imgW && link.imgH) ? ` width="${link.imgW}" height="${link.imgH}"` : '';
    return `<div class="bio-image"><img class="bio-image-img" src="${esc(link.photoUrl)}"${dim} loading="lazy" alt=""></div>`;
  }

  // Twitch embeds — up to 10 in a carousel (channels, VODs, clips). All 16:9.
  if (link.isTwitchBlock) {
    const videos = Array.isArray(link.videos) ? link.videos : (link.url ? [{ url: link.url }] : []);
    const cards = videos.map(v => {
      const tw = extractTwitch(v && v.url);
      if (!tw) return '';
      return `<div class="twitch-card"><iframe class="twitch-frame" src="${twitchEmbedSrc(tw)}" loading="lazy" title="Twitch player" allow="autoplay; fullscreen" allowfullscreen></iframe></div>`;
    }).filter(Boolean).join('');
    if (!cards) return '';
    return `<div class="videos">
      <button type="button" class="videos-arrow videos-arrow-l" aria-label="Scroll left" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg></button>
      <button type="button" class="videos-arrow videos-arrow-r" aria-label="Scroll right" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>
      <div class="videos-scroll">${cards}</div>
    </div>`;
  }

  // X (Twitter) posts — up to 10 in a carousel. Pure-iframe Tweet.html embeds
  // (no widgets.js → no SRI conflict); fixed-height cards so the row stays even.
  if (link.isTweetBlock) {
    const videos = Array.isArray(link.videos) ? link.videos : (link.url ? [{ url: link.url }] : []);
    const cards = videos.map(v => {
      const id = extractTweetId(v && v.url);
      if (!id) return '';
      return `<div class="tweet-card"><iframe class="tweet-frame" src="https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true" loading="lazy" title="Post on X"></iframe></div>`;
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
    const priceDisplay = link.coachingPrice > 0 ? fmtPrice(link.coachingPrice, currency) : 'Free';
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
    const priceDisplay = link.productPrice > 0 ? fmtPrice(link.productPrice, currency) : 'Free';
    const coverHtml = safePhoto ? '<img src="' + esc(safePhoto) + '" alt="Link cover" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px 10px 0 0;display:block;">' : '';
    return '<a class="course-link-card' + halfClass + '" href="' + esc(url) + '" target="_blank" rel="noopener nofollow" style="display:block;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--text);transition:transform 0.15s,border-color 0.15s;">'
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
      background-color: transparent;
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
// Each theme has a fixed set of 4 colors (bg, card, text, accent) + an image.
// Renders the same CSS pipeline as the custom theme, but for free users and
// keyed by theme.key (paperwhite, ember, sapphire, blossom, honey).
// Mirror of BIO_THEMES in dashboard.html — keep in sync.
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

  // Image themes use the same selector as custom (data-theme="custom")
  // so the same downstream CSS rules pick them up.
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
    background-color: transparent;
    z-index: -2;
  }`;

  return `<style id="custom-bg-style">${css}</style>`;
}

function isBuiltinImageTheme(key) {
  return !!BUILTIN_IMAGE_THEMES[key];
}

// ==========================================================================
// MAIN RENDER — produces the full inner HTML for the #wrap div
// ==========================================================================

function renderBioContent(profile, bio) {
  const name = bio.display_name || profile.username || '';
  const currency = profile.display_currency || 'USD';

  const isPaidTier = profile.tier === 'monthly' || profile.tier === 'max';
  const isHeroMode = bio.avatar_display === 'hero' && validImageUrl(bio.avatar_url) && isPaidTier;

  // Verified badge: shown whenever the profile is verified. Verification is a
  // manual, admin-controlled flag (only set via SQL / service role behind the
  // guard trigger), so it stands on its own and is not tied to plan tier.
  const showVerified = !!profile.verified;
  const nameBadge = showVerified ? verifiedBadgeSvg() : '';

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
        <div class="name">${nameWithBadge(name, nameBadge)}</div>
        ${socialsHtml}
        ${bio.bio ? `<div class="bio">${esc(bio.bio)}</div>` : ''}
        ${linksHtml ? `<div class="links">${linksHtml}</div>` : ''}
        ${banner}
      </div>`;
  } else {
    inner = `${buildAvatar(profile, bio)}
      <div class="name">${nameWithBadge(name, nameBadge)}</div>
      ${socialsHtml}
      ${bio.bio ? `<div class="bio">${esc(bio.bio)}</div>` : ''}
      ${linksHtml ? `<div class="links">${linksHtml}</div>` : ''}
      ${banner}`;
  }

  return { inner, isHeroMode, showBanner };
}

// Weld the badge to the LAST word of the name so it never wraps onto its own
// line. Earlier words wrap normally; the full name is always shown in full.
function nameWithBadge(rawName, badge) {
  const n = rawName || '';
  if (!badge) return esc(n);
  const i = n.lastIndexOf(' ');
  if (i === -1) return `<span style="white-space:nowrap;">${esc(n)}${badge}</span>`;
  return `${esc(n.slice(0, i + 1))}<span style="white-space:nowrap;">${esc(n.slice(i + 1))}${badge}</span>`;
}

// Verified blue check (SSR). Identical markup to the client renderer; inline
// styles keep it self-contained in the server-generated HTML.
function verifiedBadgeSvg() {
  return ' <svg class="verified-badge" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Verified"' +
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
      `${SUPABASE_URL}/rest/v1/public_profile_tiers?username=eq.${encodeURIComponent(username)}&select=user_id,username,tier,display_currency,verified`,
      fetchOpts(controller.signal)
    );
    if (!profileRes.ok) { clearTimeout(timeout); return null; }
    const profiles = await profileRes.json();
    if (!profiles || profiles.length === 0) { clearTimeout(timeout); return null; }
    const profile = profiles[0];

    // Step 2: bio data for that user, only if published
    const bioRes = await fetch(
      `${SUPABASE_URL}/rest/v1/link_in_bio?user_id=eq.${profile.user_id}&published=eq.true&select=display_name,bio,avatar_url,avatar_display,theme,font_family,links,videos,socials,show_branding,published,custom_theme,sensitive_content`,
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
// LIVE COVER URL RESOLVER
// ==========================================================================
// Bio links for courses, coaching services, digital products, and the media
// kit used to snapshot the cover/headshot URL into `link.photoUrl` at the
// moment the link was added. When the source updated its image, the bio
// link kept pointing at the old (now possibly deleted) file.
//
// This resolver fetches the LIVE cover URL from each source table at render
// time and mutates the bio links' photoUrl in place. If the source row no
// longer exists, the existing snapshot value is left as a fallback.
//
// Strategy: one batched query per source type, only if at least one link
// of that type is present. Up to 4 fetches per render, all in parallel.
// ==========================================================================

// Resolve live data for course/coaching/product/mediakit links by fetching the
// authoritative source tables. Mutates `links` in place. Updates title, price,
// and photo from the source tables — these were previously snapshots taken
// at link-add time, so editing the source row (e.g. renaming a course) didn't
// propagate to the bio page until the user deleted and re-added the link.
//
// IMPORTANT: link-specific fields like `courseCrossoutPrice` are NOT overwritten.
// Those are intentional bio-level overrides set by the creator when adding the
// link, separate from anything in the source table.
async function resolveLiveCoverUrls(creatorUserId, links, fetchOpts, creatorUsername) {
  if (!Array.isArray(links) || links.length === 0) return;

  const courseIds = [];
  const coachingIds = [];
  const productIds = [];
  let needsMediaKit = false;

  for (const link of links) {
    if (link && link.isCourse && link.courseId) courseIds.push(link.courseId);
    if (link && link.isCoaching && link.coachingId) coachingIds.push(link.coachingId);
    if (link && link.isProduct && link.productId) productIds.push(link.productId);
    if (link && link.isMediaKit) needsMediaKit = true;
  }

  // Build storage public URL for path-based covers (course-covers, coaching-covers).
  const buildPublicUrl = (bucket, path) => {
    if (!path) return null;
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  };

  // Batched fetches in parallel. Each promise resolves to a Map keyed by id.
  const fetches = [];

  if (courseIds.length > 0) {
    const ids = courseIds.map(encodeURIComponent).join(',');
    fetches.push(
      fetch(`${SUPABASE_URL}/rest/v1/courses?id=in.(${ids})&select=id,title,price_cents,cover_image_path`, fetchOpts())
        .then(r => r.ok ? r.json() : [])
        .then(rows => ({
          type: 'course',
          map: new Map(rows.map(r => [r.id, {
            title: r.title,
            price: r.price_cents,
            photo: buildPublicUrl('course-covers', r.cover_image_path),
          }]))
        }))
        .catch(() => ({ type: 'course', map: new Map() }))
    );
  }

  if (coachingIds.length > 0) {
    const ids = coachingIds.map(encodeURIComponent).join(',');
    fetches.push(
      fetch(`${SUPABASE_URL}/rest/v1/coaching_services?id=in.(${ids})&select=id,title,price_cents,cover_image_path`, fetchOpts())
        .then(r => r.ok ? r.json() : [])
        .then(rows => ({
          type: 'coaching',
          map: new Map(rows.map(r => [r.id, {
            title: r.title,
            price: r.price_cents,
            photo: buildPublicUrl('coaching-covers', r.cover_image_path),
          }]))
        }))
        .catch(() => ({ type: 'coaching', map: new Map() }))
    );
  }

  if (productIds.length > 0) {
    // Digital products use cover_image_url (signed URL stored directly), not a path.
    const ids = productIds.map(encodeURIComponent).join(',');
    fetches.push(
      fetch(`${SUPABASE_URL}/rest/v1/digital_products?id=in.(${ids})&select=id,title,price_cents,cover_image_url`, fetchOpts())
        .then(r => r.ok ? r.json() : [])
        .then(rows => ({
          type: 'product',
          map: new Map(rows.map(r => [r.id, {
            title: r.title,
            price: r.price_cents,
            photo: r.cover_image_url || null,
          }]))
        }))
        .catch(() => ({ type: 'product', map: new Map() }))
    );
  }

  if (needsMediaKit && creatorUserId) {
    fetches.push(
      fetch(`${SUPABASE_URL}/rest/v1/media_kit?user_id=eq.${encodeURIComponent(creatorUserId)}&select=headshot_url&limit=1`, fetchOpts())
        .then(r => r.ok ? r.json() : [])
        .then(rows => ({
          type: 'mediakit',
          url: rows[0] ? (rows[0].headshot_url || null) : null
        }))
        .catch(() => ({ type: 'mediakit', url: null }))
    );
  }

  if (fetches.length === 0) return;

  // 1.5-second timeout. If any source-table query hangs (Supabase outage,
  // slow query, etc.), give up and let the bio render with snapshot URLs.
  // Better to show a slightly stale photo than hang the entire page.
  const TIMEOUT_SENTINEL = Symbol('resolver-timeout');
  const timeoutPromise = new Promise(resolve => {
    setTimeout(() => resolve(TIMEOUT_SENTINEL), 1500);
  });
  const settled = await Promise.race([Promise.all(fetches), timeoutPromise]);
  if (settled === TIMEOUT_SENTINEL) {
    console.warn('cover URL resolver timed out at 1.5s, using snapshots');
    return;
  }
  const results = settled;
  const courseMap = results.find(r => r.type === 'course')?.map;
  const coachingMap = results.find(r => r.type === 'coaching')?.map;
  const productMap = results.find(r => r.type === 'product')?.map;
  const mediaKitUrl = results.find(r => r.type === 'mediakit')?.url;

  // Mutate the links in place. For each field, only overwrite when we got a
  // live value back. If a course/coaching/product was deleted from the source
  // table, the map.get() returns undefined and we keep the snapshot as fallback
  // so the bio renders something rather than going blank.
  for (const link of links) {
    if (!link) continue;
    if (link.isCourse && link.courseId && courseMap) {
      const live = courseMap.get(link.courseId);
      if (live) {
        if (typeof live.title === 'string' && live.title.length > 0) link.title = live.title;
        if (typeof live.price === 'number') link.coursePrice = live.price;
        if (live.photo) link.photoUrl = live.photo;
      }
    } else if (link.isCoaching && link.coachingId && coachingMap) {
      const live = coachingMap.get(link.coachingId);
      if (live) {
        if (typeof live.title === 'string' && live.title.length > 0) link.title = live.title;
        if (typeof live.price === 'number') link.coachingPrice = live.price;
        if (live.photo) link.photoUrl = live.photo;
      }
    } else if (link.isProduct && link.productId && productMap) {
      const live = productMap.get(link.productId);
      if (live) {
        if (typeof live.title === 'string' && live.title.length > 0) link.title = live.title;
        if (typeof live.price === 'number') link.productPrice = live.price;
        if (live.photo) link.photoUrl = live.photo;
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

    // Pick theme: custom theme honored for Pro and Max tiers
    const isPaidTier = profile.tier === 'monthly' || profile.tier === 'max';
    if (bio.theme === 'custom' && isPaidTier && bio.custom_theme) {
      theme = 'custom';
      customThemeStyle = buildCustomThemeStyle(bio.custom_theme);
    } else if (bio.theme === 'custom' && !isPaidTier) {
      theme = 'purple';
    } else if (isBuiltinImageTheme(bio.theme)) {
      // Builtin image themes are free for all tiers. They use the same
      // [data-theme="custom"] CSS selector as the Pro custom theme, but with
      // hardcoded values from BUILTIN_IMAGE_THEMES.
      theme = 'custom';
      customThemeStyle = buildImageThemeStyle(bio.theme);
    } else {
      theme = bio.theme || 'purple';
    }

    // Resolve live cover URLs for course/coaching/product/mediakit links.
    // This mutates bio.links in place so renderBioContent picks up the
    // current values instead of the snapshot stored at link-add time.
    // Wrapped in try/catch so a slow/failed lookup never breaks the bio.
    try {
      const resolverFetchOpts = () => ({
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });
      await resolveLiveCoverUrls(profile.user_id, bio.links, resolverFetchOpts, profile.username);
    } catch (e) {
      console.error('cover URL resolver failed, falling back to snapshots:', e);
    }

    // Render the bio content server-side
    const rendered = renderBioContent(profile, bio);
    renderedInner = rendered.inner;

    // Stash currency + tier for client JS so trackPageView/subscribe still work
    // and so any client-side post-hydration logic has access to it. Previously
    // this was an inline <script>, but strict CSP forbids inline scripts. Now
    // these values flow into the page as <meta> tags; js/bio-page.js reads
    // them at load time and populates window._creatorCurrency etc.
    const bootstrap = `
      <meta name="ryxa-creator-currency" content="${esc(profile.display_currency || 'USD')}">
      <meta name="ryxa-ssr-username" content="${esc(profile.username)}">
      <meta name="ryxa-sensitive" content="${bio.sensitive_content === true ? 'true' : 'false'}">
      <meta name="ryxa-ssr-hydrated" content="true">`;

    // Inject creator's chosen font (link + override style). Falls back to default
    // if font_family is null or unknown — buildFontInjection handles validation.
    const fontInjection = buildFontInjection(bio.font_family);

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
  html = html.replace(/<html\s+lang="en">/i, `<html lang="en" data-theme="${esc(theme)}">`);

  // 3. Replace the loading placeholder inside <div id="wrap"> with rendered content
  if (renderedInner) {
    // If hero mode, the wrap needs a class — handle by reading from the rendered output
    const wrapClass = renderedInner.includes('hero-header') ? 'wrap hero-mode' : 'wrap';
    const showsBanner = renderedInner.includes('brand-banner');
    const bodyStyle = showsBanner ? ' style="padding-bottom:80px;"' : '';

    // Match: <body> ... <div class="wrap" id="wrap"> ...loading state... </div>
    // and replace with: <body...> <div class="wrapClass" id="wrap">renderedInner</div>
    // Does NOT touch anything after the closing </div> (script tags etc.). Previously
    // the regex anchored on the following inline <script>, but that script is now
    // an external <script src="/js/bio-page.js">, so we anchor on the wrap structure
    // alone. The replacement only includes the wrap so trailing markup is preserved.
    html = html.replace(
      /<body>\s*<div class="wrap" id="wrap">[\s\S]*?<\/div>\s*<\/div>/m,
      `<body${bodyStyle}>\n<div class="${wrapClass}" id="wrap">${renderedInner}</div>`
    );
  }
  // If no renderedInner, leave the loading placeholder — client JS will fetch + render.

  // 4. Cache headers — fresh for 60s, serve stale up to 5 more minutes while revalidating
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  // 5. Content Security Policy — ENFORCED.
  // Bio pages are PUBLIC and render user-supplied content (links, names, descriptions,
  // custom colors, custom backgrounds). Strict CSP is the primary defense against XSS
  // via injected <script> tags in user content.
  //
  // To roll back to Report-Only mode (if breakage is reported), change the header
  // name below from 'Content-Security-Policy' to 'Content-Security-Policy-Report-Only'.
  //
  // Allowed origins explanation:
  //   script-src — Supabase SDK (cdn.jsdelivr.net) + own /js/ + cookie-banner.js
  //   style-src 'unsafe-inline' — required because user color values are inlined
  //     into a <style> tag generated server-side (already hardened via safeHexColor)
  //   font-src — Google Fonts (creator can pick a custom font)
  //   img-src — Supabase Storage (user avatars, backgrounds), i.ytimg.com (YouTube thumbnails)
  //   frame-src — YouTube embeds for video links
  //   connect-src — Supabase API for analytics, subscribe, fetching bio data
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://www.ryxa.io https://kjytapcgxukalwsyputk.supabase.co https://i.ytimg.com",
      "connect-src 'self' https://kjytapcgxukalwsyputk.supabase.co https://cdn.jsdelivr.net",
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://www.tiktok.com https://www.instagram.com https://open.spotify.com https://embed.music.apple.com https://w.soundcloud.com https://player.twitch.tv https://clips.twitch.tv https://platform.twitter.com https://platform.x.com",
      "media-src 'self' blob: https://kjytapcgxukalwsyputk.supabase.co",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );

  res.status(200).send(html);
};
