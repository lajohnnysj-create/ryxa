// Vercel serverless function - YouTube Cron Refresh (background)
// =====================================================================
// Called daily by Supabase pg_cron. Looks for any youtube_connections rows
// where data_last_fetched_at is null OR older than the stale threshold, and
// refreshes each one in turn (token refresh + channel stats + analytics +
// demographics + recent uploads, via the shared fetch helper).
//
// Authenticated via X-Cron-Secret header, must match CRON_SECRET env var.
// No user JWT involved; this is a server-to-server call.
//
// Endpoint: POST https://ryxa.io/api/youtube-cron-refresh
// Headers:  X-Cron-Secret: <secret>
//
// Returns { ok: true, refreshed: N, failed: M, details: [...] }
// =====================================================================

const { refreshYouTubeData } = require('./_youtube-fetch-helper.js');
const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Cap per run in case the queue grows large. YouTube refreshes make more API
// calls than Instagram (channel + several analytics reports + recent uploads),
// so keep the cap conservative. We're on Vercel Pro (300s timeout).
const MAX_REFRESHES_PER_RUN = 40;

// Stale threshold, must match the pg_cron schedule cadence in the migration.
const STALE_THRESHOLD_DAYS = 3;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!CRON_SECRET) {
    return res.status(500).json({ ok: false, error: 'Cron secret not configured' });
  }
  const provided = req.headers['x-cron-secret'] || req.headers['X-Cron-Secret'] || '';
  // timingSafeEqual to prevent timing-attack inference. Length-mismatch returns
  // early (constant time), then byte-compare runs in constant time.
  let validSecret = false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(CRON_SECRET);
    if (a.length === b.length) {
      validSecret = crypto.timingSafeEqual(a, b);
    }
  } catch (e) { /* validSecret stays false */ }
  if (!validSecret) {
    return res.status(401).json({ ok: false, error: 'Invalid cron secret' });
  }

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  // ---- Find stale rows ----
  const cutoffIso = new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // PostgREST: data_last_fetched_at IS NULL OR data_last_fetched_at < cutoff
  const filter = 'or=(data_last_fetched_at.is.null,data_last_fetched_at.lt.' + cutoffIso + ')';
  const queryUrl =
    SUPABASE_URL +
    '/rest/v1/youtube_connections?' +
    filter +
    '&select=user_id&order=data_last_fetched_at.asc.nullsfirst&limit=' +
    MAX_REFRESHES_PER_RUN;

  let staleRows;
  try {
    const r = await fetch(queryUrl, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
      },
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('Stale row query failed:', r.status, errText);
      return res.status(500).json({ ok: false, error: 'Query failed' });
    }
    staleRows = await r.json();
  } catch (e) {
    console.error('Stale row fetch threw:', e.message);
    return res.status(500).json({ ok: false, error: 'Query threw: ' + e.message });
  }

  if (!Array.isArray(staleRows) || staleRows.length === 0) {
    return res.status(200).json({ ok: true, refreshed: 0, failed: 0, message: 'Nothing stale' });
  }

  // ---- Refresh each one sequentially (don't parallel-flood Google) ----
  let refreshed = 0;
  let failed = 0;
  const details = [];

  for (const row of staleRows) {
    try {
      const result = await refreshYouTubeData(row.user_id);
      if (result.ok) {
        refreshed++;
      } else {
        failed++;
        details.push({ user_id: row.user_id, error: result.error });
        // Auth-related errors (token revoked) won't fix themselves on retry;
        // the user must reconnect. data_fetch_error records this for visibility.
      }
    } catch (e) {
      failed++;
      details.push({ user_id: row.user_id, error: e.message });
    }

    // Small delay between users to be polite to Google's rate limits.
    await new Promise(r => setTimeout(r, 250));
  }

  return res.status(200).json({
    ok: true,
    refreshed: refreshed,
    failed: failed,
    total: staleRows.length,
    details: details.slice(0, 20),
  });
};
