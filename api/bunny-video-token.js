// Vercel serverless function. issues a signed Bunny Stream playback URL
// for an authenticated, enrolled viewer (or anyone if the lesson is marked
// as a free preview). The signed URL expires after 2 hours and is bound
// to the viewer's IP address to limit casual sharing.
//
// POST /api/bunny-video-token
// Headers: Authorization: Bearer <viewer_access_token>  (optional for previews)
// Body: { lesson_id }
//
// Response: {
//   playback_url,       // signed HLS manifest URL (.m3u8)
//   iframe_url,         // alternative. Bunny's embedded player iframe
//   thumbnail_url,      // public thumbnail (no auth needed)
//   expires_at,
//   is_preview          // true if access was granted via lesson.is_preview
// }
//
// Token signing format (Bunny Stream URL Token Authentication):
//   security_token = sha256(signing_key + video_id + expiration_unix + path + user_ip)
//
// See: https://docs.bunny.net/docs/stream-token-authentication

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

const PLAYBACK_TOKEN_EXPIRES_SECONDS = 60 * 60 * 2;  // 2 hours

// ---------- env ----------
function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}
function getBunnyLibraryId() {
  var v = process.env.BUNNY_STREAM_LIBRARY_ID;
  if (!v) throw new Error('BUNNY_STREAM_LIBRARY_ID not configured');
  return v;
}
function getBunnyTokenAuthKey() {
  // This is Bunny's "Token Authentication Key". different from the API key.
  // Found in the Stream library's API / Security settings.
  var v = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY;
  if (!v) throw new Error('BUNNY_STREAM_TOKEN_AUTH_KEY not configured');
  return v;
}
function getBunnyCdnHostname() {
  // The "Pull Zone" hostname Bunny gives you for the video library, e.g.
  // "vz-abc123def-456.b-cdn.net". Each library has its own.
  var v = process.env.BUNNY_STREAM_CDN_HOSTNAME;
  if (!v) throw new Error('BUNNY_STREAM_CDN_HOSTNAME not configured');
  return v;
}

// ---------- Supabase helpers ----------
async function sbSelect(path) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
  });
  if (!res.ok) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Supabase SELECT failed (' + res.status + '): ' + body);
  }
  return await res.json();
}

async function sbRpc(fnName, args) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args || {})
  });
  if (!res.ok) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Supabase RPC failed (' + res.status + '): ' + body);
  }
  return await res.json();
}

async function verifyViewerJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[bunny-video-token] No Bearer header. authHeader present:', !!authHeader, 'starts with Bearer:', authHeader ? authHeader.startsWith('Bearer ') : false);
    return null;
  }
  var token = authHeader.split(' ')[1];
  console.log('[bunny-video-token] Verifying token, length:', token ? token.length : 0, 'prefix:', token ? token.slice(0, 20) : '');
  try {
    var res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_ANON_KEY }
    });
    if (!res.ok) {
      var errBody = await res.text().catch(function() { return '(could not read body)'; });
      console.warn('[bunny-video-token] Supabase /auth/v1/user rejected token:', res.status, errBody.slice(0, 200));
      return null;
    }
    var data = await res.json();
    if (!data || !data.id) {
      console.warn('[bunny-video-token] Supabase returned ok but no user id. Keys:', data ? Object.keys(data).join(',') : 'null');
      return null;
    }
    return { id: data.id, email: data.email, token: token };
  } catch (e) {
    console.error('[bunny-video-token] verifyViewerJWT threw:', e && e.message ? e.message : e);
    return null;
  }
}

// ---------- Bunny URL signing ----------
// Bunny has TWO different signing schemes depending on what you're protecting:
//
// 1. CDN URL Token Authentication (for HLS .m3u8 / .ts segments):
//    SHA256(token_auth_key + url_path + expiration_unix [+ user_ip])
//    Encoded as base64url (no padding, - and _ replacements).
//    Query params: ?token=...&expires=...&token_path=...
//
// 2. Embed View Token Authentication (for iframe.mediadelivery.net/embed/...):
//    SHA256(token_auth_key + video_id + expiration_unix)
//    Encoded as plain HEX (lowercase).
//    Query params: ?token=...&expires=...
//    NOTE: no IP, no path. video_id is the bare GUID.
//
// These are two separate signature outputs even though both protect the same
// video. Bunny's docs cover them as separate features under "Stream security".

function signBunnyCdnUrl(signingKey, urlPath, expirationUnix, userIp) {
  var crypto = require('crypto');
  var hashableBase = signingKey + urlPath + expirationUnix + (userIp || '');
  var hash = crypto.createHash('sha256').update(hashableBase).digest();
  // base64url encoding for CDN tokens
  return hash.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signBunnyEmbedIframe(signingKey, videoGuid, expirationUnix) {
  var crypto = require('crypto');
  // Hex SHA256 of (key + video_id + expires). No IP. No path.
  return crypto.createHash('sha256')
    .update(signingKey + videoGuid + expirationUnix)
    .digest('hex');
}

function getClientIp(req) {
  var fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.headers['x-real-ip'] || '') || '';
}

// ---------- handler ----------
module.exports = async (req, res) => {
  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Parse body
    var body = req.body || {};
    var lessonId = body.lesson_id;
    if (!lessonId) return res.status(400).json({ error: 'Missing lesson_id' });

    // 2. Load the lesson + check it has a Bunny video
    var lessons = await sbSelect(
      'course_lessons?id=eq.' + encodeURIComponent(lessonId) +
      '&select=id,course_id,is_preview,bunny_video_id,bunny_video_status,bunny_thumbnail_url&limit=1'
    );
    if (!lessons || lessons.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    var lesson = lessons[0];
    if (!lesson.bunny_video_id) {
      return res.status(404).json({ error: 'This lesson has no video' });
    }
    if (lesson.bunny_video_status !== 'ready') {
      return res.status(425).json({
        error: 'Video is still processing. Try again in a moment.',
        status: lesson.bunny_video_status
      });
    }

    // 3. Authorize the viewer
    //    - If lesson.is_preview = TRUE, anyone can watch (no auth required)
    //    - Otherwise, the viewer must be enrolled in the course
    var viewer = await verifyViewerJWT(req.headers.authorization || '');
    var grantedViaPreview = false;

    if (lesson.is_preview === true) {
      grantedViaPreview = true;
    } else {
      if (!viewer) {
        return res.status(401).json({ error: 'You must be signed in to watch this lesson' });
      }
      // Use the SECURITY DEFINER RPC to check enrollment in one query
      var canView = await sbRpc('can_user_view_lesson', {
        p_lesson_id: lessonId,
        p_user_id: viewer.id
      });
      if (canView !== true) {
        return res.status(403).json({ error: 'You are not enrolled in this course' });
      }
    }

    // 4. Build the signed playback URL (HLS direct stream).
    //    Bunny Stream HLS path: /{video_guid}/playlist.m3u8
    //    Uses CDN Token Authentication (base64url, includes path + IP).
    var videoGuid = lesson.bunny_video_id;
    var cdnHost = getBunnyCdnHostname();
    var path = '/' + videoGuid + '/playlist.m3u8';
    var expirationUnix = Math.floor(Date.now() / 1000) + PLAYBACK_TOKEN_EXPIRES_SECONDS;
    var clientIp = getClientIp(req);

    var signingKey = getBunnyTokenAuthKey();
    var cdnToken = signBunnyCdnUrl(signingKey, path, expirationUnix, clientIp);

    var playbackUrl =
      'https://' + cdnHost + path +
      '?token=' + cdnToken +
      '&expires=' + expirationUnix +
      (clientIp ? '&token_path=' + encodeURIComponent(path) : '');

    // 5. Also build the iframe embed URL.
    //    Iframe URL: iframe.mediadelivery.net/embed/{library_id}/{video_guid}
    //    Uses Embed View Token Authentication: hex SHA256(key + video_id + expires).
    //    Separate scheme from CDN tokens - no path, no IP, no base64url.
    var libraryId = getBunnyLibraryId();
    var iframeToken = signBunnyEmbedIframe(signingKey, videoGuid, expirationUnix);
    var iframeUrl =
      'https://iframe.mediadelivery.net/embed/' + libraryId + '/' + videoGuid +
      '?token=' + iframeToken +
      '&expires=' + expirationUnix;

    return res.status(200).json({
      playback_url: playbackUrl,
      iframe_url: iframeUrl,
      thumbnail_url: lesson.bunny_thumbnail_url || null,
      expires_at: new Date(expirationUnix * 1000).toISOString(),
      is_preview: grantedViaPreview
    });
  } catch (err) {
    console.error('bunny-video-token error:', err);
    return res.status(500).json({ error: err.message || 'Could not generate playback link' });
  }
};
