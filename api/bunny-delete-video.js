// Vercel serverless function - creator-initiated video deletion. Used when
// the creator clicks "Replace video" or removes a lesson directly.
//
// POST /api/bunny-delete-video
// Headers: Authorization: Bearer <creator_access_token>
// Body: { lesson_id }
//
// Response: { ok: true, immediate: boolean }
//   immediate=true  -> Bunny accepted the delete, lesson row Bunny columns nulled
//   immediate=false -> Bunny call failed, video queued for cron retry (still safe)
//
// Verifies:
// 1. Creator is authenticated
// 2. Creator owns the lesson's parent course
// 3. Lesson has a bunny_video_id to delete
//
// On Bunny call failure: never blocks the user. Queues the video for the
// cleanup cron, nulls the lesson row's Bunny columns anyway, returns
// immediate=false so the UI can decide whether to surface that.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

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
function getBunnyApiKey() {
  var v = process.env.BUNNY_STREAM_API_KEY;
  if (!v) throw new Error('BUNNY_STREAM_API_KEY not configured');
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
async function sbUpdate(table, idCol, idVal, row) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + idCol + '=eq.' + encodeURIComponent(idVal), {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Supabase UPDATE failed (' + res.status + '): ' + body);
  }
}
async function sbInsertIgnoreDup(table, row) {
  // Bunny pending deletions has UNIQUE(video_id). Use PostgREST's
  // on_conflict=do_nothing semantics via the Prefer header.
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=video_id', {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify(row)
  });
  // 201 created or 409 conflict are both fine; only true failures matter
  if (!res.ok && res.status !== 409) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Supabase INSERT failed (' + res.status + '): ' + body);
  }
}
async function verifyCreatorJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  var token = authHeader.split(' ')[1];
  try {
    var res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_ANON_KEY }
    });
    if (!res.ok) return null;
    var data = await res.json();
    return data && data.id ? { id: data.id, email: data.email } : null;
  } catch (e) {
    return null;
  }
}

// ---------- Bunny ----------
async function bunnyDeleteVideo(libraryId, apiKey, videoGuid) {
  var res = await fetch('https://video.bunnycdn.com/library/' + libraryId + '/videos/' + videoGuid, {
    method: 'DELETE',
    headers: { AccessKey: apiKey, Accept: 'application/json' }
  });
  // 200 = deleted, 404 = already gone (both are success for our purposes)
  if (res.ok || res.status === 404) return true;
  var body = await res.text().catch(function() { return ''; });
  throw new Error('Bunny delete failed (' + res.status + '): ' + body);
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
    // 1. Auth
    var creator = await verifyCreatorJWT(req.headers.authorization || '');
    if (!creator) {
      return res.status(401).json({ error: 'You must be signed in' });
    }

    // 2. Parse body
    var body = req.body || {};
    var lessonId = body.lesson_id;
    if (!lessonId) return res.status(400).json({ error: 'Missing lesson_id' });

    // 3. Load lesson + verify ownership
    var lessons = await sbSelect(
      'course_lessons?id=eq.' + encodeURIComponent(lessonId) +
      '&select=id,course_id,bunny_video_id&limit=1'
    );
    if (!lessons || lessons.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    var lesson = lessons[0];
    if (!lesson.bunny_video_id) {
      // Nothing to delete - return success so UI can proceed
      return res.status(200).json({ ok: true, immediate: true, note: 'No video to delete' });
    }

    var courses = await sbSelect(
      'courses?id=eq.' + encodeURIComponent(lesson.course_id) +
      '&select=id,user_id&limit=1'
    );
    if (!courses || courses.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (courses[0].user_id !== creator.id) {
      return res.status(403).json({ error: 'You do not own this course' });
    }

    var videoGuid = lesson.bunny_video_id;

    // 4. Attempt immediate Bunny delete. If it fails, queue for cron retry.
    var immediate = false;
    try {
      await bunnyDeleteVideo(getBunnyLibraryId(), getBunnyApiKey(), videoGuid);
      immediate = true;
    } catch (bunnyErr) {
      console.warn('bunny-delete-video: immediate delete failed, queuing for cron:', bunnyErr.message);
      try {
        await sbInsertIgnoreDup('bunny_pending_deletions', {
          video_id: videoGuid,
          source: 'replace_flow_fallback'
        });
      } catch (queueErr) {
        // Even queueing failed - log but continue. The next-time the
        // course is saved, the row will be DELETE-then-INSERTed and the
        // trigger will queue it then.
        console.error('bunny-delete-video: queue insert also failed:', queueErr);
      }
    }

    // 5. Null out the lesson's Bunny columns regardless. The video is
    //    either deleted on Bunny already or queued for cleanup; either
    //    way the lesson row should no longer reference it.
    await sbUpdate('course_lessons', 'id', lessonId, {
      bunny_video_id: null,
      bunny_video_status: null,
      bunny_video_duration_seconds: null,
      bunny_thumbnail_url: null,
      bunny_uploaded_at: null
    });

    return res.status(200).json({ ok: true, immediate: immediate });
  } catch (err) {
    console.error('bunny-delete-video error:', err);
    return res.status(500).json({ error: err.message || 'Could not delete video' });
  }
};
