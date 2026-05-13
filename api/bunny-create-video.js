// Vercel serverless function. creates a new video container in Bunny Stream
// and returns the upload credentials. The creator's browser then uploads
// directly to Bunny (chunked, resumable) via the TUS protocol. no bytes
// transit through Vercel.
//
// POST /api/bunny-create-video
// Headers: Authorization: Bearer <creator_access_token>
// Body: { lesson_id, title, expected_size_bytes? }
//
// Response: {
//   video_id,           // Bunny's UUID. store in course_lessons.bunny_video_id
//   library_id,         // for the upload URL construction
//   upload_url,         // direct TUS endpoint on Bunny
//   upload_token,       // short-lived signed token authorizing the upload
//   expires_at          // when upload_token expires (~1 hour)
// }
//
// Server-side checks before issuing the upload URL:
// 1. Creator is authenticated (valid JWT)
// 2. Creator has an active Creator Max subscription
// 3. Creator owns the lesson's parent course
// 4. Creator's total stored Bunny video duration is under the cap (20 hours)
// 5. expected_size_bytes (if provided) is under the per-video cap (5 GB)

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;       // 5 GB per video
const MAX_TOTAL_SECONDS_PER_CREATOR = 20 * 60 * 60;   // 20 hours total per creator
const UPLOAD_TOKEN_EXPIRES_SECONDS = 60 * 60;         // 1 hour to complete upload

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
function getBunnyApiKey() {
  var v = process.env.BUNNY_STREAM_API_KEY;
  if (!v) throw new Error('BUNNY_STREAM_API_KEY not configured');
  return v;
}

// ---------- Supabase helpers (match Ryxa convention) ----------
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

// ---------- Bunny Stream API ----------
async function bunnyCreateVideo(libraryId, apiKey, title) {
  var res = await fetch('https://video.bunnycdn.com/library/' + libraryId + '/videos', {
    method: 'POST',
    headers: {
      AccessKey: apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ title: title || 'Untitled Lesson' })
  });
  if (!res.ok) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Bunny create video failed (' + res.status + '): ' + body);
  }
  var data = await res.json();
  // Bunny returns: { guid, libraryId, title, ... }
  if (!data || !data.guid) throw new Error('Bunny did not return a video guid');
  return data;
}

// TUS upload to Bunny Stream requires a signed AuthorizationSignature.
// Format: sha256(library_id + api_key + expiration_unix + video_guid)
// See: https://docs.bunny.net/reference/tus-resumable-uploads
function buildTusSignature(libraryId, apiKey, expirationUnix, videoGuid) {
  var crypto = require('crypto');
  var hash = crypto.createHash('sha256');
  hash.update(libraryId + apiKey + expirationUnix + videoGuid);
  return hash.digest('hex');
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
    // 1. Verify creator is signed in
    var creator = await verifyCreatorJWT(req.headers.authorization || '');
    if (!creator) {
      return res.status(401).json({ error: 'You must be signed in to upload videos' });
    }

    // 2. Parse body
    var body = req.body || {};
    var lessonId = body.lesson_id;
    var title = (body.title || '').toString().slice(0, 200);
    var expectedSizeBytes = Number(body.expected_size_bytes || 0);

    if (!lessonId) {
      return res.status(400).json({ error: 'Missing lesson_id' });
    }
    if (expectedSizeBytes && expectedSizeBytes > MAX_VIDEO_BYTES) {
      return res.status(413).json({
        error: 'Video file is too large. Maximum is 5 GB per video.'
      });
    }

    // 3. Verify creator has active Creator Max subscription
    var subs = await sbSelect(
      'subscriptions?user_id=eq.' + encodeURIComponent(creator.id) +
      '&select=tier,status,trial_end&limit=1'
    );
    if (!subs || subs.length === 0) {
      return res.status(403).json({ error: 'Creator Max subscription required for video hosting' });
    }
    var sub = subs[0];
    var isMax = sub.tier === 'max' && (sub.status === 'active' || sub.status === 'trialing');
    if (!isMax) {
      return res.status(403).json({ error: 'Creator Max subscription required for video hosting' });
    }

    // 4. Load the lesson + its course, verify creator owns the course
    var lessons = await sbSelect(
      'course_lessons?id=eq.' + encodeURIComponent(lessonId) +
      '&select=id,course_id,bunny_video_id&limit=1'
    );
    if (!lessons || lessons.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    var lesson = lessons[0];

    var courses = await sbSelect(
      'courses?id=eq.' + encodeURIComponent(lesson.course_id) +
      '&select=id,user_id,title&limit=1'
    );
    if (!courses || courses.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    var course = courses[0];
    if (course.user_id !== creator.id) {
      return res.status(403).json({ error: 'You do not own this course' });
    }

    // 5. If lesson already has a Bunny video, refuse. creator must delete the
    //    existing one first (prevents orphans + accidental quota burns)
    if (lesson.bunny_video_id) {
      return res.status(409).json({
        error: 'This lesson already has a video. Remove the existing video before uploading a new one.'
      });
    }

    // 6. Check creator's total Bunny Stream usage against the cap
    var usage = await sbSelect(
      'creator_bunny_stream_usage?user_id=eq.' + encodeURIComponent(creator.id) +
      '&select=total_seconds_stored,video_count&limit=1'
    );
    var totalSecondsStored = (usage && usage[0] && usage[0].total_seconds_stored) || 0;
    if (totalSecondsStored >= MAX_TOTAL_SECONDS_PER_CREATOR) {
      return res.status(403).json({
        error: 'You have reached the 20-hour video storage limit for your account. Contact support to discuss increasing it.'
      });
    }

    // 7. Create the video container on Bunny
    var libraryId = getBunnyLibraryId();
    var apiKey = getBunnyApiKey();
    var lessonTitle = title || course.title || 'Untitled Lesson';
    var bunnyVideo = await bunnyCreateVideo(libraryId, apiKey, lessonTitle);
    var videoGuid = bunnyVideo.guid;

    // 8. Update the lesson row with the new bunny_video_id + status='uploading'
    await sbUpdate('course_lessons', 'id', lessonId, {
      bunny_video_id: videoGuid,
      bunny_video_status: 'uploading',
      bunny_uploaded_at: new Date().toISOString()
    });

    // 9. Build TUS upload credentials (creator's browser will use these
    //    to upload directly to Bunny without proxying through Vercel)
    var expirationUnix = Math.floor(Date.now() / 1000) + UPLOAD_TOKEN_EXPIRES_SECONDS;
    var signature = buildTusSignature(libraryId, apiKey, expirationUnix, videoGuid);

    return res.status(200).json({
      video_id: videoGuid,
      library_id: libraryId,
      upload_url: 'https://video.bunnycdn.com/tusupload',
      upload_headers: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expirationUnix),
        VideoId: videoGuid,
        LibraryId: libraryId
      },
      expires_at: new Date(expirationUnix * 1000).toISOString()
    });
  } catch (err) {
    console.error('bunny-create-video error:', err);
    return res.status(500).json({ error: err.message || 'Could not start video upload' });
  }
};
