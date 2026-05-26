// =============================================================================
// api/r2-bulk-delete.js
// =============================================================================
// Bulk-deletes all R2 objects belonging to either:
//   - An entire digital product (type='product')
//   - An entire course (type='course') — all lesson files across all lessons
//
// MUST be called BEFORE deleting the parent product/course row, because we
// validate ownership against the still-existing parent and look up storage
// paths from the still-existing file rows.
//
// Auth: Bearer token (creator's Supabase JWT). user_id derived from JWT,
// never trusted from body.
//
// POST /api/r2-bulk-delete
// Headers: Authorization: Bearer <creator_access_token>
// Body: {
//   type: 'product' | 'course',
//   product_id?: uuid,   // required if type === 'product'
//   course_id?: uuid     // required if type === 'course'
// }
//
// Response: { ok: true, deleted_count: number, failed_count: number }

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

async function deleteR2Paths(paths) {
  if (!paths || paths.length === 0) {
    return { deleted: 0, failed: 0 };
  }
  var promises = paths.map(function (p) {
    if (!p) return Promise.resolve({ ok: true, status: 200 });
    return r2DeleteObject(p).catch(function (e) {
      console.warn('R2 delete failed for ' + p + ':', e.message);
      return { ok: false, status: 0, error: e.message };
    });
  });
  var results = await Promise.all(promises);
  var deleted = results.filter(function (r) { return r.ok; }).length;
  var failed = results.length - deleted;
  return { deleted: deleted, failed: failed };
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
    if (type !== 'product' && type !== 'course') {
      return res.status(400).json({ error: 'Invalid type' });
    }

    if (type === 'product') {
      var productId = body.product_id;
      if (!productId) return res.status(400).json({ error: 'Missing product_id' });

      // Verify ownership against the product row (must still exist)
      var products = await sbSelect(
        'digital_products?id=eq.' + encodeURIComponent(productId) + '&select=id,user_id&limit=1'
      );
      if (!products || products.length === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
      if (products[0].user_id !== creator.id) {
        return res.status(403).json({ error: 'You do not own this product' });
      }

      // Load all file storage_paths for this product
      var files = await sbSelect(
        'digital_product_files?product_id=eq.' + encodeURIComponent(productId) +
        '&select=storage_path'
      );
      var paths = (files || []).map(function (f) { return f.storage_path; }).filter(Boolean);
      var result = await deleteR2Paths(paths);
      return res.status(200).json({ ok: true, deleted_count: result.deleted, failed_count: result.failed });
    }

    // type === 'course'
    var courseId = body.course_id;
    if (!courseId) return res.status(400).json({ error: 'Missing course_id' });

    // Verify ownership against the course row (must still exist)
    var courses = await sbSelect(
      'courses?id=eq.' + encodeURIComponent(courseId) + '&select=id,user_id&limit=1'
    );
    if (!courses || courses.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (courses[0].user_id !== creator.id) {
      return res.status(403).json({ error: 'You do not own this course' });
    }

    // Course lesson files denormalize course_id, so we can query directly
    var lessonFiles = await sbSelect(
      'course_lesson_files?course_id=eq.' + encodeURIComponent(courseId) +
      '&select=storage_path'
    );
    var coursePaths = (lessonFiles || []).map(function (f) { return f.storage_path; }).filter(Boolean);
    var courseResult = await deleteR2Paths(coursePaths);
    return res.status(200).json({ ok: true, deleted_count: courseResult.deleted, failed_count: courseResult.failed });
  } catch (e) {
    console.error('r2-bulk-delete error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
