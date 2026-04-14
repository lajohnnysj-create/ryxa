// Vercel serverless function
// Injects dynamic OG tags into bio.html for username URLs
// Deploy to: /api/bio.js
// Routed via vercel.json rewrite: /:username -> /api/bio?u=:username

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTcxMzEsImV4cCI6MjA5MDg5MzEzMX0.VC8mcU5lUeA56kG2gHssvl88EVWr018XttA86jpfEn0';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchProfile(username) {
  // Look up user by username
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=user_id,username`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );
  if (!profileRes.ok) return null;
  const profiles = await profileRes.json();
  if (!profiles || profiles.length === 0) return null;
  const profile = profiles[0];

  // Fetch the bio data for that user
  const bioRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bio?user_id=eq.${profile.user_id}&select=display_name,avatar_url,bio,published`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );
  if (!bioRes.ok) return { profile, bio: null };
  const bios = await bioRes.json();
  return { profile, bio: bios[0] || null };
}

module.exports = async (req, res) => {
  const username = (req.query.u || '').trim();
  if (!username) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send('Missing username');
  }

  // Reject filenames and reserved paths that may have leaked through cleanUrls normalization
  // (e.g., /brand-portal.html → /brand-portal → matches /:username catch-all)
  const RESERVED = new Set([
    'brand-portal', 'deal', 'about', 'blog', 'dashboard', 'faq', 'follower-audit',
    'index', 'instructions', 'pricing', 'privacy', 'reset-password', 'terms',
    'mediakit', 'api', 'admin', 'support', 'help', 'login', 'signin', 'signup'
  ]);
  if (username.includes('.') || username.includes('/') || RESERVED.has(username.toLowerCase())) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send('Not found');
  }

  // Read the source HTML file from project root
  const htmlPath = path.join(process.cwd(), 'bio.html');
  let html;
  try {
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (e) {
    res.status(500).send('Template not found');
    return;
  }

  // Default OG values (for unknown user)
  let title = `@${username} | Ryxa`;
  let description = `A creator's link-in-bio page on Ryxa.`;
  let image = 'https://www.ryxa.io/og-image.png';
  const url = `https://www.ryxa.io/${encodeURIComponent(username)}`;

  // Fetch real data
  try {
    const result = await fetchProfile(username);
    if (result && result.bio && result.bio.published !== false) {
      const name = result.bio.display_name || result.profile.username;
      title = `all of @${result.profile.username}'s links`;
      description = result.bio.bio
        ? result.bio.bio
        : `Find all of @${result.profile.username}'s links in one place on Ryxa.`;
      if (result.bio.avatar_url) image = result.bio.avatar_url;
    }
  } catch (e) {
    // If anything goes wrong, fall through with defaults
    console.error('bio OG fetch error', e);
  }

  // Inject OG tags
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
`;

  // Replace original title + description + og tags with our dynamic ones
  // Remove existing static ones first
  html = html
    .replace(/<title>[^<]*<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:[^"]*"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>/gi, '');

  // Inject new block right after <head>
  html = html.replace(/<head>/i, `<head>${ogBlock}`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
};
