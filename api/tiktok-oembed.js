// =============================================================================
// api/tiktok-oembed.js
// =============================================================================
// Resolves the thumbnail (and basic meta) for a TikTok video via TikTok's
// public oEmbed API. The browser can't call oEmbed directly because TikTok
// sends no CORS headers, so the dashboard preview calls this same-origin route,
// which fetches oEmbed server-side and returns only the safe fields.
//
// GET /api/tiktok-oembed?url=https://www.tiktok.com/@user/video/1234567890
// Response: { thumbnail_url, title, author_name }  (thumbnail_url may be null)
//
// SSRF guard: only canonical TikTok video URLs are accepted, and the outbound
// request always targets www.tiktok.com/oembed — never the caller's raw host.
// =============================================================================

// Validate a TikTok video URL and pull its numeric id. Doubles as the SSRF
// allow-list: anything that isn't a tiktok.com video URL is rejected.
function tiktokVideoId(url) {
  const m = String(url || '').match(/^https?:\/\/(?:www\.|m\.)?tiktok\.com\/(?:.*\/video\/|embed\/(?:v2\/)?|v\/)(\d{6,})/i);
  return m ? m[1] : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = (req.query && req.query.url ? String(req.query.url) : '').trim();
  if (!url || !tiktokVideoId(url)) {
    return res.status(400).json({ error: 'A full TikTok video URL is required.' });
  }

  try {
    const oembedUrl = 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(url);
    const r = await fetch(oembedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RyxaBot/1.0; +https://www.ryxa.io)' }
    });
    if (!r.ok) {
      // Soft-fail so the client simply keeps its placeholder.
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return res.status(200).json({ thumbnail_url: null, title: '', author_name: '' });
    }
    const data = await r.json();
    // Edge-cache the resolved thumbnail to limit oEmbed calls. TikTok thumbnail
    // URLs are signed/expiring, so the TTL is kept modest to avoid serving a
    // stale link for too long.
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({
      thumbnail_url: data && data.thumbnail_url ? String(data.thumbnail_url) : null,
      title: data && data.title ? String(data.title).slice(0, 200) : '',
      author_name: data && data.author_name ? String(data.author_name).slice(0, 80) : ''
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.status(200).json({ thumbnail_url: null, title: '', author_name: '' });
  }
};
