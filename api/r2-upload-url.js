// =============================================================================
// api/r2-upload-url.js
// =============================================================================
// Returns a presigned R2 upload URL for the creator's browser to PUT a file
// directly to Cloudflare R2. The file does not pass through Vercel.
//
// Handles both upload destinations:
//   - Digital Products: inserts row into digital_product_files
//   - Course Lessons:   inserts row into course_lesson_files
//
// Auth: Bearer token (creator's Supabase JWT). user_id is derived from the
// JWT, NEVER trusted from the request body.
//
// Pre-validates ownership: creator must own the product OR the course/lesson
// they're uploading to. Returns 403 otherwise.
//
// POST /api/r2-upload-url
// Headers: Authorization: Bearer <creator_access_token>
// Body: {
//   type: 'product' | 'lesson',
//   product_id?: uuid,           // required if type === 'product'
//   course_id?: uuid,            // required if type === 'lesson'
//   lesson_id?: uuid,            // required if type === 'lesson'
//   filename: string,
//   file_size_bytes: number,
//   mime_type: string
// }
//
// Response: {
//   upload_url: string,    // presigned R2 URL the client PUTs to
//   file_id: uuid,         // the new digital_product_files / course_lesson_files row id
//   storage_path: string   // the R2 object key, also stored on the row
// }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
const { r2SignedUploadUrl } = require('./lib/r2-storage');

// Server-side caps. Client also enforces these (UX), server is the source of truth.
// Per-file: 1 GB technical ceiling for single-shot PUT reliability.
// Per-account: 10 GB shared between Digital Products and Course Lesson Files.
// No per-product or per-lesson caps. Account cap is the backstop.
const MAX_FILE_BYTES = 1024 * 1024 * 1024;            // 1 GB per file
const MAX_ACCOUNT_BYTES = 10 * 1024 * 1024 * 1024;    // 10 GB per creator (shared across products + courses)
const UPLOAD_URL_EXPIRES_SECONDS = 600;               // 10 min to complete upload

// MIME types that are allowed for digital product / lesson downloads.
// Mirror of js/file-validation.js. Client validates first, server re-validates.
const ALLOWED_MIME_PREFIXES = [
  'image/',
  'audio/',
  'video/',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/epub+zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.',
  'application/vnd.ms-',
  'text/',
  'application/json',
  'application/rtf'
];

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

async function sbInsertReturning(table, row) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    var body = await res.text().catch(function () { return ''; });
    throw new Error('Supabase INSERT failed (' + res.status + '): ' + body);
  }
  var data = await res.json();
  return Array.isArray(data) ? data[0] : data;
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

function isAllowedMimeType(mime) {
  if (!mime) return false;
  var lower = String(mime).toLowerCase();
  for (var i = 0; i < ALLOWED_MIME_PREFIXES.length; i++) {
    if (lower.indexOf(ALLOWED_MIME_PREFIXES[i]) === 0) return true;
  }
  return false;
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

// Sum of bytes used across both tables (account-level cap). Two-step query
// for each table to avoid fragile nested PostgREST filters.
async function getCreatorStorageUsed(userId) {
  // Digital products owned by this creator
  var products = await sbSelect(
    'digital_products?user_id=eq.' + encodeURIComponent(userId) + '&select=id'
  );
  var productIds = (products || []).map(function (p) { return p.id; });
  var productBytes = 0;
  if (productIds.length > 0) {
    var productFiles = await sbSelect(
      'digital_product_files?product_id=in.(' + productIds.join(',') + ')&select=file_size_bytes'
    );
    productBytes = (productFiles || []).reduce(function (n, f) {
      return n + Number(f.file_size_bytes || 0);
    }, 0);
  }

  // Courses owned by this creator, then lessons in those courses, then files in those lessons
  var courses = await sbSelect(
    'courses?user_id=eq.' + encodeURIComponent(userId) + '&select=id'
  );
  var courseIds = (courses || []).map(function (c) { return c.id; });
  var lessonBytes = 0;
  if (courseIds.length > 0) {
    var modules = await sbSelect(
      'course_modules?course_id=in.(' + courseIds.join(',') + ')&select=id'
    );
    var moduleIds = (modules || []).map(function (m) { return m.id; });
    if (moduleIds.length > 0) {
      var lessons = await sbSelect(
        'course_lessons?module_id=in.(' + moduleIds.join(',') + ')&select=id'
      );
      var lessonIds = (lessons || []).map(function (l) { return l.id; });
      if (lessonIds.length > 0) {
        var lessonFiles = await sbSelect(
          'course_lesson_files?lesson_id=in.(' + lessonIds.join(',') + ')&select=file_size_bytes'
        );
        lessonBytes = (lessonFiles || []).reduce(function (n, f) {
          return n + Number(f.file_size_bytes || 0);
        }, 0);
      }
    }
  }

  return productBytes + lessonBytes;
}

async function getLessonFileCount(lessonId) {
  var files = await sbSelect('course_lesson_files?lesson_id=eq.' + encodeURIComponent(lessonId) + '&select=id');
  return (files || []).length;
}

module.exports = async function (req, res) {
  // Per-IP rate limit: 60 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'r2-upload', 60, 60000)) return;

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
    var filename = body.filename;
    var fileSizeBytes = Number(body.file_size_bytes);
    var mimeType = body.mime_type || 'application/octet-stream';

    if (type !== 'product' && type !== 'lesson') {
      return res.status(400).json({ error: 'Invalid type' });
    }
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Missing filename' });
    }
    if (!fileSizeBytes || fileSizeBytes <= 0 || !Number.isFinite(fileSizeBytes)) {
      return res.status(400).json({ error: 'Missing or invalid file_size_bytes' });
    }
    if (fileSizeBytes > MAX_FILE_BYTES) {
      return res.status(413).json({ error: 'File exceeds 1 GB limit' });
    }
    if (!isAllowedMimeType(mimeType)) {
      return res.status(415).json({ error: 'File type not allowed' });
    }

    // Account-level cap (shared between products + lessons)
    var used = await getCreatorStorageUsed(creator.id);
    if (used + fileSizeBytes > MAX_ACCOUNT_BYTES) {
      return res.status(413).json({ error: 'Adding this file would exceed your 10 GB account storage limit' });
    }

    var storagePath;
    var fileId;
    var ext = (filename.split('.').pop() || 'bin').toLowerCase();
    var slug = slugify(filename.replace(/\.[^.]+$/, ''));
    var stamp = Date.now();

    if (type === 'product') {
      var productId = body.product_id;
      if (!productId) return res.status(400).json({ error: 'Missing product_id' });

      // Verify creator owns the product
      var products = await sbSelect('digital_products?id=eq.' + encodeURIComponent(productId) + '&select=id,user_id&limit=1');
      if (!products || products.length === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
      if (products[0].user_id !== creator.id) {
        return res.status(403).json({ error: 'You do not own this product' });
      }

      storagePath = 'products/' + creator.id + '/' + productId + '/' + stamp + '-' + slug + '.' + ext;

      // Insert the file row immediately. If client never completes the PUT,
      // a cleanup cron will detect orphan rows (no matching R2 object) and
      // delete them. Sort order placed at the end.
      var existingFiles = await sbSelect('digital_product_files?product_id=eq.' + encodeURIComponent(productId) + '&select=id&order=sort_order.desc&limit=1');
      var nextSort = (existingFiles && existingFiles.length ? (existingFiles[0].sort_order || 0) + 1 : 0);

      var row = await sbInsertReturning('digital_product_files', {
        product_id: productId,
        filename: filename,
        storage_path: storagePath,
        file_size_bytes: fileSizeBytes,
        mime_type: mimeType,
        scan_status: 'clean',
        sort_order: nextSort
      });
      fileId = row.id;
    } else {
      // type === 'lesson'
      var courseId = body.course_id;
      var lessonId = body.lesson_id;
      if (!courseId || !lessonId) return res.status(400).json({ error: 'Missing course_id or lesson_id' });

      // Verify creator owns the course
      var courses = await sbSelect('courses?id=eq.' + encodeURIComponent(courseId) + '&select=id,user_id&limit=1');
      if (!courses || courses.length === 0) {
        return res.status(404).json({ error: 'Course not found' });
      }
      if (courses[0].user_id !== creator.id) {
        return res.status(403).json({ error: 'You do not own this course' });
      }

      // Verify the lesson belongs to this course (defensive)
      var lessons = await sbSelect('course_lessons?id=eq.' + encodeURIComponent(lessonId) + '&select=id,module_id,course_modules(course_id)&limit=1');
      if (!lessons || lessons.length === 0) {
        return res.status(404).json({ error: 'Lesson not found' });
      }
      // The nested select returns course_modules as either an object or array; tolerate both.
      var mod = lessons[0].course_modules;
      var lessonCourseId = mod ? (Array.isArray(mod) ? (mod[0] && mod[0].course_id) : mod.course_id) : null;
      if (lessonCourseId !== courseId) {
        return res.status(403).json({ error: 'Lesson does not belong to this course' });
      }

      // Get current file count for sort_order (no cap, just ordering)
      var lessonFileCount = await getLessonFileCount(lessonId);

      storagePath = 'courses/' + creator.id + '/' + courseId + '/' + lessonId + '/' + stamp + '-' + slug + '.' + ext;

      var lessonRow = await sbInsertReturning('course_lesson_files', {
        lesson_id: lessonId,
        course_id: courseId,
        filename: filename,
        storage_path: storagePath,
        file_size_bytes: fileSizeBytes,
        mime_type: mimeType,
        sort_order: lessonFileCount
      });
      fileId = lessonRow.id;
    }

    // Generate the presigned URL the browser will PUT to
    var uploadUrl = r2SignedUploadUrl(storagePath, UPLOAD_URL_EXPIRES_SECONDS);

    return res.status(200).json({
      upload_url: uploadUrl,
      file_id: fileId,
      storage_path: storagePath
    });
  } catch (e) {
    console.error('r2-upload-url error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
