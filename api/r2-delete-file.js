// =============================================================================
// api/r2-delete-file.js
// =============================================================================
// Deletes a file from R2 + removes the corresponding DB row.
// Handles both digital_product_files and course_lesson_files based on `type`.
//
// Auth: Bearer token (creator's Supabase JWT). user_id derived from JWT,
// never trusted from body.
//
// POST /api/r2-delete-file
// Headers: Authorization: Bearer <creator_access_token>
// Body: {
//   type: 'product' | 'lesson',
//   file_id: uuid
// }
//
// Response: { ok: true }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
const { r2DeleteObject } = require('./lib/r2-storage');

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
    var body = await res.text().catch(function () { return ''; });
    throw new Error('Supabase SELECT failed (' + res.status + '): ' + body);
  }
  return await res.json();
}

async function sbDelete(table, idColumn, idValue) {
  var key = getServiceKey();
  var res = await fetch(
    SUPABASE_URL + '/rest/v1/' + table + '?' + idColumn + '=eq.' + encodeURIComponent(idValue),
    {
      method: 'DELETE',
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    }
  );
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    throw new Error('Supabase DELETE failed (' + res.status + '): ' + body);
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

module.exports = async function (req, res) {
  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.indexOf(origin) !== -1) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var creator = await verifyCreatorJWT(req.headers.authorization || '');
    if (!creator) {
      return res.status(401).json({ error: 'You must be signed in' });
    }

    var body = req.body || {};
    var type = body.type;
    var fileId = body.file_id;

    if (type !== 'product' && type !== 'lesson') {
      return res.status(400).json({ error: 'Invalid type' });
    }
    if (!fileId) {
      return res.status(400).json({ error: 'Missing file_id' });
    }

    var storagePath = null;

    if (type === 'product') {
      // Verify ownership by joining file -> product -> creator
      var files = await sbSelect(
        'digital_product_files?id=eq.' + encodeURIComponent(fileId) +
        '&select=id,storage_path,digital_products(user_id)&limit=1'
      );
      if (!files || files.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }
      var file = files[0];
      var product = file.digital_products;
      var ownerId = product ? (Array.isArray(product) ? (product[0] && product[0].user_id) : product.user_id) : null;
      if (ownerId !== creator.id) {
        return res.status(403).json({ error: 'You do not own this file' });
      }
      storagePath = file.storage_path;

      // Delete DB row first. If R2 delete fails after, the orphan-cleanup cron
      // will eventually clean the R2 object. We never want the reverse (R2
      // gone but DB row still pointing at it: buyer download attempts will 404).
      await sbDelete('digital_product_files', 'id', fileId);
    } else {
      // type === 'lesson'
      var lessonFiles = await sbSelect(
        'course_lesson_files?id=eq.' + encodeURIComponent(fileId) +
        '&select=id,storage_path,course_lessons(course_modules(courses(user_id)))&limit=1'
      );
      if (!lessonFiles || lessonFiles.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }
      var lf = lessonFiles[0];
      // Walk down the nested chain: lesson_files -> lessons -> modules -> courses.user_id
      var lesson = lf.course_lessons;
      var lessonObj = Array.isArray(lesson) ? lesson[0] : lesson;
      var mod = lessonObj ? lessonObj.course_modules : null;
      var modObj = Array.isArray(mod) ? mod[0] : mod;
      var course = modObj ? modObj.courses : null;
      var courseObj = Array.isArray(course) ? course[0] : course;
      var lessonOwnerId = courseObj ? courseObj.user_id : null;
      if (lessonOwnerId !== creator.id) {
        return res.status(403).json({ error: 'You do not own this file' });
      }
      storagePath = lf.storage_path;

      await sbDelete('course_lesson_files', 'id', fileId);
    }

    // Delete from R2 (best-effort: DB is the source of truth, orphans cleanable)
    if (storagePath) {
      try {
        var r2res = await r2DeleteObject(storagePath);
        if (!r2res.ok) {
          console.warn('R2 delete returned non-OK for ' + storagePath + ':', r2res.status, r2res.error);
        }
      } catch (e) {
        console.warn('R2 delete threw for ' + storagePath + ':', e.message);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('r2-delete-file error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
