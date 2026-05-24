// Vercel serverless function - returns the Bunny encoding status for a
// lesson, scoped to lessons the calling creator owns. Used by the course
// editor UI to poll while a video transcodes.
//
// POST /api/bunny-lesson-status
// Headers: Authorization: Bearer <creator_access_token>
// Body: { lesson_id }
//
// Response: {
//   bunny_video_id: string | null,
//   bunny_video_status: 'uploading'|'processing'|'ready'|'failed'|null,
//   bunny_video_duration_seconds: number | null,
//   bunny_thumbnail_url: string | null
// }
//
// Uses the get_my_lesson_bunny_status SECURITY DEFINER RPC, which verifies
// course ownership in-query. The RPC returns no rows if the user doesn't
// own the lesson; the handler returns 404 in that case (does not leak
// the distinction between "not found" and "not yours").

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

async function verifyCreatorJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  var token = authHeader.split(' ')[1];
  try {
    var res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_ANON_KEY }
    });
    if (!res.ok) return null;
    var data = await res.json();
    return data && data.id ? { id: data.id, email: data.email, token: token } : null;
  } catch (e) {
    return null;
  }
}

async function rpcAsUser(fnName, args, userToken) {
  // Call the RPC using the user's own JWT so SECURITY DEFINER + auth.uid()
  // returns the authenticated user inside the function body. This is
  // intentional - the RPC scopes by auth.uid() and would return nothing
  // if called with service_role (where auth.uid() is null).
  var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + userToken,
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

// Map Bunny's numeric status to our status string. Mirrors bunny-webhook.js.
//   0 Created, 1 Uploaded, 2 Processing, 3 Transcoding, 4 Finished, 5/6 Error
function mapBunnyStatus(code) {
  switch (Number(code)) {
    case 0: return 'uploading';
    case 1: return 'processing';
    case 2: return 'processing';
    case 3: return 'processing';
    case 4: return 'ready';
    case 5: return 'failed';
    case 6: return 'failed';
    default: return null;
  }
}

// Ask Bunny directly for a video's current state. Used as a self-healing
// fallback when the DB still says 'processing'/'uploading' but Bunny has
// actually finished. Covers the case where the encode-complete webhook
// never arrived or was silently dropped (which happens randomly).
async function fetchBunnyStatus(videoGuid) {
  var libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  var apiKey = process.env.BUNNY_STREAM_API_KEY;
  if (!libraryId || !apiKey) return null;
  try {
    var res = await fetch('https://video.bunnycdn.com/library/' + libraryId + '/videos/' + videoGuid, {
      headers: { AccessKey: apiKey, Accept: 'application/json' }
    });
    if (!res.ok) return null;
    var meta = await res.json();
    var status = mapBunnyStatus(meta.status);
    if (!status) return null;
    var out = { bunny_video_status: status };
    if (status === 'ready') {
      if (typeof meta.length === 'number') {
        out.bunny_video_duration_seconds = Math.round(meta.length);
      }
      var cdnHost = process.env.BUNNY_STREAM_CDN_HOSTNAME;
      if (cdnHost) {
        out.bunny_thumbnail_url = 'https://' + cdnHost + '/' + videoGuid + '/thumbnail.jpg';
      }
    }
    return out;
  } catch (e) {
    return null;
  }
}

// Write the corrected status back to the lesson row using service_role, so a
// stuck 'processing' row self-heals without waiting on the webhook. Scoped
// by bunny_video_id since that's the immutable identifier Bunny gave us.
async function patchLessonByVideoId(videoGuid, update) {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return;
  try {
    await fetch(SUPABASE_URL + '/rest/v1/course_lessons?bunny_video_id=eq.' + encodeURIComponent(videoGuid), {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(update)
    });
  } catch (e) {
    // Non-fatal: the response to the client is still correct (we already
    // mutated the in-memory `row`). The row just won't be persisted this
    // round and will heal on the next poll.
  }
}

module.exports = async (req, res) => {
  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var creator = await verifyCreatorJWT(req.headers.authorization || '');
    if (!creator) return res.status(401).json({ error: 'You must be signed in' });

    var body = req.body || {};
    var lessonId = body.lesson_id;
    if (!lessonId) return res.status(400).json({ error: 'Missing lesson_id' });

    var rows = await rpcAsUser('get_my_lesson_bunny_status', { p_lesson_id: lessonId }, creator.token);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found or not yours' });
    }
    var row = rows[0];

    // Self-healing fallback. If the DB still says the video is in flight but
    // Bunny has actually finished encoding (the webhook never arrived or was
    // silently dropped, which happens randomly), ask Bunny directly and
    // correct the row in-place. Without this a video can stay 'processing'
    // in the editor forever even though it's already playable. Same pattern
    // is already used by api/bunny-video-token.js on the student playback
    // path; we keep them consistent so editor and playback never disagree.
    var dbStatus = row.bunny_video_status || null;
    if (row.bunny_video_id && (dbStatus === 'processing' || dbStatus === 'uploading')) {
      var live = await fetchBunnyStatus(row.bunny_video_id);
      if (live && live.bunny_video_status && live.bunny_video_status !== dbStatus) {
        // Persist the correction so future polls (and the public course
        // page) see the right status without re-hitting Bunny every time.
        await patchLessonByVideoId(row.bunny_video_id, live);
        row.bunny_video_status = live.bunny_video_status;
        if (live.bunny_video_duration_seconds != null) {
          row.bunny_video_duration_seconds = live.bunny_video_duration_seconds;
        }
        if (live.bunny_thumbnail_url) {
          row.bunny_thumbnail_url = live.bunny_thumbnail_url;
        }
      }
    }

    return res.status(200).json({
      bunny_video_id: row.bunny_video_id || null,
      bunny_video_status: row.bunny_video_status || null,
      bunny_video_duration_seconds: row.bunny_video_duration_seconds || null,
      bunny_thumbnail_url: row.bunny_thumbnail_url || null
    });
  } catch (err) {
    console.error('bunny-lesson-status error:', err);
    return res.status(500).json({ error: 'Could not load status' });
  }
};
