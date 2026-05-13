// Vercel cron - drains the bunny_pending_deletions queue.
//
// Runs daily via vercel.json cron schedule. Two phases per run:
// 1. RECLAIM: call reclaim_in_use_bunny_videos() to remove queued IDs
//    that turn out to still be referenced by course_lessons (the save-flow
//    DELETE-then-INSERT pattern re-creates the same bunny_video_id).
// 2. DELETE: fetch up to N orphans via next_bunny_deletion_batch(), call
//    Bunny's delete API for each, remove successes from queue, log failures.
//
// Auth: Vercel cron requests carry the CRON_SECRET header. We verify that
// before doing anything. Without this anyone could POST to this endpoint
// and drain our queue (mostly harmless, but still abuse vector).
//
// GET /api/cron/bunny-cleanup
// Headers: Authorization: Bearer <CRON_SECRET>
//
// Response: { reclaimed, attempted, deleted, failed, kept_for_retry }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const BATCH_SIZE = 50;

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}
function getCronSecret() {
  var v = process.env.CRON_SECRET;
  if (!v) throw new Error('CRON_SECRET not configured');
  return v;
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

async function sbDeleteRow(table, idCol, idVal) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + idCol + '=eq.' + encodeURIComponent(idVal), {
    method: 'DELETE',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Prefer: 'return=minimal'
    }
  });
  if (!res.ok) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Supabase DELETE failed (' + res.status + '): ' + body);
  }
}

async function sbUpdateAttempt(rowId, error) {
  var key = getServiceKey();
  var update = {
    last_attempt_at: new Date().toISOString(),
    last_error: (error || '').toString().slice(0, 500)
  };
  // Increment attempts via RPC-style update using an RLS-bypassing direct PATCH.
  // PostgREST doesn't natively do x = x + 1; we read-modify-write.
  // Cheap because we just selected this row in next_bunny_deletion_batch.
  // To avoid a round trip we use a tiny RPC instead. But simpler: PATCH
  // with the attempts value (will be passed from the caller).
  var res = await fetch(SUPABASE_URL + '/rest/v1/bunny_pending_deletions?id=eq.' + encodeURIComponent(rowId), {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(update)
  });
  if (!res.ok) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Attempt update failed (' + res.status + '): ' + body);
  }
}

// Atomic increment helper - calls a tiny inline RPC pattern via raw SQL
// would be ideal, but PostgREST handles this with a simple UPDATE.
// We do a separate small RPC for atomicity.
async function sbIncrementAttempts(rowId, errorText) {
  // Use a single PATCH that sets last_attempt_at, last_error, and
  // attempts. Bunny errors are rare enough that the read-then-write
  // race (two crons running at once) is not a real concern - Vercel
  // schedules them at the same minute and the function is idempotent.
  var key = getServiceKey();

  // Read current attempts value
  var readRes = await fetch(
    SUPABASE_URL + '/rest/v1/bunny_pending_deletions?id=eq.' + encodeURIComponent(rowId) + '&select=attempts',
    { headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' } }
  );
  if (!readRes.ok) return;
  var rows = await readRes.json();
  if (!rows || !rows.length) return;
  var nextAttempts = (rows[0].attempts || 0) + 1;

  await fetch(SUPABASE_URL + '/rest/v1/bunny_pending_deletions?id=eq.' + encodeURIComponent(rowId), {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      attempts: nextAttempts,
      last_attempt_at: new Date().toISOString(),
      last_error: (errorText || '').toString().slice(0, 500)
    })
  });
}

// ---------- Bunny ----------
async function bunnyDeleteVideo(libraryId, apiKey, videoGuid) {
  var res = await fetch('https://video.bunnycdn.com/library/' + libraryId + '/videos/' + videoGuid, {
    method: 'DELETE',
    headers: { AccessKey: apiKey, Accept: 'application/json' }
  });
  // 200 OK or 404 already gone = success for cleanup
  if (res.ok || res.status === 404) return true;
  var body = await res.text().catch(function() { return ''; });
  throw new Error('Bunny delete ' + res.status + ': ' + body.slice(0, 200));
}

// ---------- handler ----------
module.exports = async (req, res) => {
  // 1. Verify it's actually Vercel cron (or a manual admin call with the
  //    same secret). The Authorization header should be Bearer <CRON_SECRET>.
  var auth = req.headers.authorization || '';
  var expected = 'Bearer ' + getCronSecret();
  if (auth !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. Allow GET (Vercel cron uses GET) or POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var result = {
    reclaimed: 0,
    attempted: 0,
    deleted: 0,
    failed: 0,
    kept_for_retry: 0
  };

  try {
    // Phase 1: reclaim any queued videos that turned out to still be in use.
    // (Happens routinely during course saves due to the DELETE-then-INSERT
    //  pattern in course.js -> saveCourse.)
    result.reclaimed = await sbRpc('reclaim_in_use_bunny_videos', {});

    // Phase 2: fetch batch of pending deletions
    var batch = await sbRpc('next_bunny_deletion_batch', { p_limit: BATCH_SIZE });
    result.attempted = batch.length;

    var libraryId = getBunnyLibraryId();
    var apiKey = getBunnyApiKey();

    for (var i = 0; i < batch.length; i++) {
      var row = batch[i];
      try {
        await bunnyDeleteVideo(libraryId, apiKey, row.video_id);
        // Success - remove from queue
        await sbDeleteRow('bunny_pending_deletions', 'id', row.id);
        result.deleted++;
      } catch (delErr) {
        result.failed++;
        result.kept_for_retry++;
        // Log attempt; the exponential backoff in next_bunny_deletion_batch
        // will gate the next retry.
        try {
          await sbIncrementAttempts(row.id, delErr.message);
        } catch (updateErr) {
          // Even logging the attempt failed - just continue.
          console.error('bunny-cleanup: attempt update failed:', updateErr.message);
        }
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('bunny-cleanup cron error:', err);
    return res.status(500).json({ error: err.message, partial: result });
  }
};
