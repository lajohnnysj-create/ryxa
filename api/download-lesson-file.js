// Vercel serverless function — generates a 5-minute signed download URL
// for a course lesson file. Access rules:
//   - File is on a free preview lesson (is_preview = true) -> anyone allowed,
//     including unauthenticated visitors (matches preview-video behavior).
//   - File is on a regular lesson -> caller must be authenticated AND either:
//       * the course owner, OR
//       * an enrolled student in the parent course.
//
// POST /api/download-lesson-file
// Headers: Authorization: Bearer <token>   (optional - only required for
//                                            non-preview lessons)
// Body:    { file_id }
//
// Response: { url, expires_at, filename }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

const SIGNED_URL_EXPIRES_SECONDS = 300;  // 5 minutes

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

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

// Verify a Supabase JWT and return the user id, or null if invalid/missing.
// IMPORTANT: returns null (not throws) on missing/invalid - some calls to
// this endpoint are legitimately unauthenticated (preview lesson files).
async function verifyJWT(authHeader) {
  if (!authHeader || authHeader.indexOf('Bearer ') !== 0) return null;
  var token = authHeader.split(' ')[1];
  try {
    var res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY }
    });
    if (!res.ok) return null;
    var data = await res.json();
    return data && data.id ? { id: data.id, email: data.email } : null;
  } catch (e) {
    return null;
  }
}

// Create a signed URL via Supabase Storage REST API
async function createSignedUrl(bucket, path, expiresIn) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/storage/v1/object/sign/' + bucket + '/' + encodeURI(path), {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expiresIn: expiresIn })
  });
  if (!res.ok) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Sign URL failed (' + res.status + '): ' + body);
  }
  var data = await res.json();
  if (!data || !data.signedURL) throw new Error('No signedURL in response');
  return SUPABASE_URL + '/storage/v1' + data.signedURL;
}

module.exports = async (req, res) => {
  var origin = req.headers.origin || '';
  var allowedOrigins = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowedOrigins.indexOf(origin) !== -1) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Parse body
    var body = req.body || {};
    var fileId = body.file_id;
    if (!fileId) {
      return res.status(400).json({ error: 'Missing file_id' });
    }

    // 2. Load the file row, then the parent lesson, then the parent course.
    // Three sequential queries (cheap, all by primary key). Picked this over
    // PostgREST embedded resources for clarity - the auth logic depends on
    // values from all three tables, easier to read top-to-bottom.
    var fileRows = await sbSelect(
      'course_lesson_files?id=eq.' + encodeURIComponent(fileId) +
      '&select=id,filename,storage_path,course_id,lesson_id&limit=1'
    );
    if (!fileRows || fileRows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    var file = fileRows[0];

    var lessonRows = await sbSelect(
      'course_lessons?id=eq.' + encodeURIComponent(file.lesson_id) +
      '&select=id,is_preview&limit=1'
    );
    if (!lessonRows || lessonRows.length === 0) {
      // Lesson got deleted but the file row survived (shouldn't happen with
      // ON DELETE CASCADE, but be defensive). Treat as not found.
      return res.status(404).json({ error: 'File not found' });
    }
    var isPreview = lessonRows[0].is_preview === true;

    var courseRows = await sbSelect(
      'courses?id=eq.' + encodeURIComponent(file.course_id) +
      '&select=id,user_id&limit=1'
    );
    if (!courseRows || courseRows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    var ownerId = courseRows[0].user_id;

    // 3. Authorization decision tree.
    //    (a) Preview lesson -> no auth needed, anyone allowed.
    //    (b) Owner of the course -> always allowed (auth required).
    //    (c) Enrolled student -> allowed (auth required).
    //    Otherwise -> 403.
    if (!isPreview) {
      var user = await verifyJWT(req.headers.authorization || '');
      if (!user) {
        return res.status(401).json({ error: 'You must be signed in to download this file' });
      }
      var allowed = false;

      // Owner check
      if (ownerId && user.id === ownerId) {
        allowed = true;
      }

      // Enrollment check (only if not already allowed)
      if (!allowed) {
        var enrolls = await sbSelect(
          'course_enrollments?course_id=eq.' + encodeURIComponent(file.course_id) +
          '&user_id=eq.' + encodeURIComponent(user.id) +
          '&select=id&limit=1'
        );
        if (enrolls && enrolls.length > 0) allowed = true;
      }

      if (!allowed) {
        return res.status(403).json({ error: 'You are not enrolled in this course' });
      }
    }

    // 4. Generate signed URL
    var signedUrl = await createSignedUrl('digital-products', file.storage_path, SIGNED_URL_EXPIRES_SECONDS);
    var expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRES_SECONDS * 1000).toISOString();

    return res.status(200).json({
      url: signedUrl,
      expires_at: expiresAt,
      filename: file.filename
    });
  } catch (e) {
    console.error('download-lesson-file error:', e);
    return res.status(500).json({ error: 'Could not generate download link' });
  }
};
