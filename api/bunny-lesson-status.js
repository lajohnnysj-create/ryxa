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
