// Vercel serverless function
// Injects dynamic OG tags into mediakit.html

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

module.exports = async (req, res) => {
  const username = (req.query.u || '').trim();
  if (!username) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send('Missing username');
  }

  const htmlPath = path.join(process.cwd(), 'mediakit.html');
  let html;
  try {
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (e) {
    res.status(500).send('Template not found');
    return;
  }

  let title = `@${username}. Media Kit | FindTheSnakes`;
  let description = `A creator's media kit on FindTheSnakes.`;
  let image = 'https://www.findthesnakes.com/og-image.png';
  let debug = { step: 'start' };
  const url = `https://www.findthesnakes.com/mediakit/${encodeURIComponent(username)}`;

  try {
    debug.step = 'fetching_profile';
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=user_id,username`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    debug.profileStatus = profileRes.status;
    const profiles = await profileRes.json();
    debug.profileCount = profiles?.length || 0;

    if (profiles && profiles.length > 0) {
      const profile = profiles[0];
      debug.userId = profile.user_id;
      debug.step = 'fetching_kit';

      const mkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/media_kit?user_id=eq.${profile.user_id}&select=display_name,headshot_url,bio,published`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      debug.kitStatus = mkRes.status;
      const kits = await mkRes.json();
      debug.kitCount = kits?.length || 0;

      if (kits && kits.length > 0) {
        const kit = kits[0];
        debug.hasHeadshot = !!kit.headshot_url;
        debug.published = kit.published;

        if (kit.published) {
          const name = kit.display_name || profile.username;
          title = `${name}. Media Kit | FindTheSnakes`;
          description = kit.bio
            ? kit.bio
            : `${name}'s creator media kit — collaborations, audience stats, and rates.`;
          if (kit.headshot_url) {
            image = kit.headshot_url;
            debug.imageSet = true;
          }
        }
      }
    }
    debug.step = 'done';
  } catch (e) {
    debug.error = String(e.message || e);
    console.error('mediakit OG error', e);
  }

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
<!-- debug: ${esc(JSON.stringify(debug))} -->
`;

  html = html
    .replace(/<title>[^<]*<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:[^"]*"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>/gi, '');

  html = html.replace(/<head>/i, `<head>${ogBlock}`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(html);
};
