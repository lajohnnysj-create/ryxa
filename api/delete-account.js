// Vercel serverless function: Delete Account
// =============================================================================
// Permanently deletes the authenticated user's account and all associated data.
//
// SECURITY:
//   • user_id is derived from the verified Bearer token, NEVER from the body.
//     A caller can only delete their own account.
//   • The destructive DB work runs inside the delete_my_account() SQL function
//     (one transaction, every statement scoped to the uid). See sql/delete-account.sql.
//
// SEQUENCE (order matters):
//   1. Cancel the Stripe subscription (hard prerequisite, abort if it fails, so
//      we never delete an account that keeps getting billed). Reuses the existing
//      cancel-subscription edge function; no Stripe code duplicated here.
//   2. Revoke OAuth (Instagram, Google Calendar), best effort.
//   3. Gather + clear external storage WHILE the rows still exist:
//        • Queue Bunny videos into bunny_pending_deletions (cron sweeps them).
//        • Delete R2 objects for the user's product files and course lesson files.
//      Best effort, orphans are swept by existing crons.
//   4. delete_my_account(uid) RPC, transactional row deletion (must succeed).
//   5. Delete the auth user (last).
//
// Idempotent: safe to re-call. Re-running hits zero rows on already-deleted
// tables, then retries the auth-user delete.
//
// Deploy to: /api/delete-account.js   Endpoint: https://ryxa.io/api/delete-account
// =============================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

const { r2DeleteObject } = require('./lib/r2-storage');

// ----- helpers ---------------------------------------------------------------

function svcHeaders(extra) {
  return Object.assign({
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
  }, extra || {});
}

// Verify a Supabase JWT and return the user_id, or null.
async function verifySupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + accessToken, apikey: SUPABASE_SERVICE_KEY }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.id ? data.id : null;
  } catch (e) {
    console.error('verifySupabaseUser failed:', e.message);
    return null;
  }
}

async function sbSelect(pathAndQuery) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + pathAndQuery, { headers: svcHeaders() });
  if (!res.ok) {
    console.warn('sbSelect non-OK:', pathAndQuery, res.status);
    return [];
  }
  return res.json().catch(() => []);
}

// Insert into bunny_pending_deletions, ignoring UNIQUE(video_id) conflicts.
async function queueBunnyDeletion(videoId) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/bunny_pending_deletions?on_conflict=video_id', {
      method: 'POST',
      headers: svcHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify({ video_id: videoId, source: 'account_deletion' })
    });
  } catch (e) {
    console.warn('queueBunnyDeletion failed (cron will not catch this one):', e.message);
  }
}

// Cancel the platform subscription if one is active. Returns true if billing is
// safely stopped (or there was nothing to stop), false if a cancel attempt failed.
async function cancelSubscriptionIfActive(userId, userToken) {
  const rows = await sbSelect(
    'subscriptions?user_id=eq.' + encodeURIComponent(userId) +
    '&status=in.(active,trialing)&select=status&limit=1'
  );
  if (!rows.length) return true; // nothing active to cancel (free, or already cancelling)

  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/cancel-subscription', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + userToken, // the user cancelling their own sub
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId: userId })
    });
    return res.ok;
  } catch (e) {
    console.error('cancel-subscription invoke failed:', e.message);
    return false;
  }
}

// Best-effort revoke of an OAuth provider via its existing disconnect route.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://ryxa.io';
async function revokeProvider(routePath, userToken) {
  try {
    await fetch(PUBLIC_BASE_URL + routePath, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + userToken, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.warn('revokeProvider best-effort failed for', routePath, e.message);
  }
}

// Gather every R2 object key owned by the user, delete each (best effort).
async function clearR2Storage(userId) {
  // Product file keys: products owned by user -> their files' storage_path.
  const products = await sbSelect(
    'digital_products?user_id=eq.' + encodeURIComponent(userId) + '&select=id'
  );
  const courses = await sbSelect(
    'courses?user_id=eq.' + encodeURIComponent(userId) + '&select=id'
  );

  const keys = [];

  if (products.length) {
    const ids = products.map(p => p.id).join(',');
    const files = await sbSelect(
      'digital_product_files?product_id=in.(' + encodeURIComponent(ids) + ')&select=storage_path'
    );
    files.forEach(f => { if (f.storage_path) keys.push(f.storage_path); });
  }

  if (courses.length) {
    const ids = courses.map(c => c.id).join(',');
    const lessonFiles = await sbSelect(
      'course_lesson_files?course_id=in.(' + encodeURIComponent(ids) + ')&select=storage_path'
    );
    lessonFiles.forEach(f => { if (f.storage_path) keys.push(f.storage_path); });
  }

  for (const key of keys) {
    try { await r2DeleteObject(key); }
    catch (e) { console.warn('R2 delete failed for key (continuing):', key, e.message); }
  }
  return { courseIds: courses.map(c => c.id), r2KeyCount: keys.length };
}

// Queue every Bunny video the user owns for deletion.
async function clearBunnyVideos(courseIds) {
  if (!courseIds.length) return 0;
  const lessons = await sbSelect(
    'course_lessons?course_id=in.(' + encodeURIComponent(courseIds.join(',')) +
    ')&bunny_video_id=not.is.null&select=bunny_video_id'
  );
  for (const l of lessons) {
    if (l.bunny_video_id) await queueBunnyDeletion(l.bunny_video_id);
  }
  return lessons.length;
}

// Every Supabase Storage bucket that stores files under a "${userId}/..." prefix.
// The transactional RPC removes DB rows but never touches Storage, and clearR2Storage
// / clearBunnyVideos only cover R2 + Bunny, so without this pass these objects orphan.
const USER_STORAGE_BUCKETS = [
  'bio-photos', 'bio-backgrounds',
  'media-kit-photos', 'mediakit-backgrounds',
  'course-covers', 'course-images',
  'coaching-covers',
  'digital-products', // cover images, nested as ${userId}/${productId}/...; the downloadable product FILES live in R2
  'deal-contracts',
  'logos',
  'grid-photos',
];

// List one prefix level of a bucket. Returns the raw entries (files + folder rows).
async function sbStorageListLevel(bucket, prefix, offset) {
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/list/' + encodeURIComponent(bucket), {
    method: 'POST',
    headers: svcHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix: prefix, limit: 100, offset: offset, sortBy: { column: 'name', order: 'asc' } })
  });
  if (!res.ok) return [];
  const items = await res.json().catch(() => []);
  return Array.isArray(items) ? items : [];
}

// Recursively collect every file path under a prefix. Folder rows (id == null) are
// walked into, so this handles flat buckets and the nested digital-products covers
// alike. Stays strictly within "${userId}/", so it can never reach another user.
async function listUserStoragePaths(bucket, prefix, depth) {
  if (depth > 6) return []; // safety; our deepest scheme is userId/productId/file (depth 2)
  const out = [];
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const items = await sbStorageListLevel(bucket, prefix, offset);
    if (!items.length) break;
    for (const it of items) {
      const name = it && it.name;
      if (!name) continue;
      const full = prefix ? (prefix + '/' + name) : name;
      if (it.id == null) {
        const nested = await listUserStoragePaths(bucket, full, depth + 1);
        for (const p of nested) out.push(p);
      } else {
        out.push(full);
      }
    }
    if (items.length < 100) break;
    offset += 100;
  }
  return out;
}

// Bulk-delete object paths from a bucket, chunked to keep request bodies small.
async function sbStorageRemove(bucket, paths) {
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    await fetch(SUPABASE_URL + '/storage/v1/object/' + encodeURIComponent(bucket), {
      method: 'DELETE',
      headers: svcHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: chunk })
    });
  }
}

// Empty every user-scoped Storage bucket for this user. Best effort and per-bucket
// isolated: one failing bucket is logged and skipped so the rest still get cleaned.
async function clearSupabaseStorage(userId) {
  for (const bucket of USER_STORAGE_BUCKETS) {
    try {
      const paths = await listUserStoragePaths(bucket, userId, 0);
      if (paths.length) await sbStorageRemove(bucket, paths);
    } catch (e) {
      console.warn('Supabase storage cleanup failed for bucket', bucket, e && e.message);
    }
  }
}

async function runDeletionRpc(userId) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/delete_my_account', {
    method: 'POST',
    headers: svcHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ p_uid: userId })
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error('delete_my_account RPC failed (' + res.status + '): ' + err);
  }
}

async function deleteAuthUser(userId) {
  const res = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
    method: 'DELETE',
    headers: svcHeaders()
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error('auth user delete failed (' + res.status + '): ' + err);
  }
}

// ----- main handler ----------------------------------------------------------

module.exports = async function handler(req, res) {
  // Per-IP rate limit: 3 requests / 600s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'delete-account', 3, 600000)) return;

  res.setHeader('Access-Control-Allow-Origin', 'https://ryxa.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace(/^Bearer\s+/i, '');
  const userId = await verifySupabaseUser(userToken);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // 1. Stop billing FIRST. If this fails, abort before deleting anything.
    const billingStopped = await cancelSubscriptionIfActive(userId, userToken);
    if (!billingStopped) {
      return res.status(502).json({
        error: 'We could not cancel your active subscription, so deletion was stopped to protect you from further charges. Please try again, or email hello@ryxa.io.'
      });
    }

    // 2. Revoke OAuth (best effort, non-blocking).
    await revokeProvider('/api/instagram-disconnect', userToken);
    await revokeProvider('/api/google-calendar-disconnect', userToken);

    // 3. Clear external storage while rows still exist (best effort).
    const { courseIds } = await clearR2Storage(userId);
    await clearBunnyVideos(courseIds);
    await clearSupabaseStorage(userId);

    // 4. Transactional row deletion (must succeed).
    await runDeletionRpc(userId);

    // 5. Delete the auth user last.
    await deleteAuthUser(userId);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('delete-account error:', e.message);
    return res.status(500).json({
      error: 'Something went wrong during deletion. Some data may have been removed. Please email hello@ryxa.io and we will finish the process.'
    });
  }
};
