// Vercel serverless function — Instagram Cron Refresh (background)
// =====================================================================
// Called daily by Supabase pg_cron at 3am UTC. Looks for any
// instagram_connections rows where data_last_fetched_at is null OR
// older than 3 days, and refreshes each one in turn.
//
// Authenticated via X-Cron-Secret header — must match CRON_SECRET env var.
// No user JWT involved; this is a server-to-server call.
//
// Endpoint: POST https://ryxa.io/api/instagram-cron-refresh
// Headers:  X-Cron-Secret: <secret>
//
// Returns { ok: true, refreshed: N, failed: M, details: [...] }
// =====================================================================

const { refreshInstagramData } = require('./_instagram-fetch-helper.js');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Cap how many we process per cron run, in case the queue grows large.
// At 8-12 IG API calls per refresh and ~5-10 seconds per refresh,
// 50 = roughly 5-8 minutes of work. Vercel max timeout is 60s on hobby,
// 300s on Pro. We're on Pro.
const MAX_REFRESHES_PER_RUN = 50;

// Stale threshold — must match the pg_cron WHERE clause in the migration.
const STALE_THRESHOLD_DAYS = 3;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Auth: verify cron secret
  if (!CRON_SECRET) {
    return res.status(500).json({ ok: false, error: 'Cron secret not configured' });
  }
  const provided = req.headers['x-cron-secret'] || req.headers['X-Cron-Secret'] || '';
  if (provided !== CRON_SECRET) {
    return res.status(401).json({ ok: false, error: 'Invalid cron secret' });
  }

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  // ---- Find stale rows ----
  const cutoffIso = new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // PostgREST: data_last_fetched_at IS NULL OR data_last_fetched_at < cutoff
  // Encoded as `or=(data_last_fetched_at.is.null,data_last_fetched_at.lt.<iso>)`
  const filter = 'or=(data_last_fetched_at.is.null,data_last_fetched_at.lt.' + cutoffIso + ')';
  const queryUrl =
    SUPABASE_URL +
    '/rest/v1/instagram_connections?' +
    filter +
    '&select=user_id&order=data_last_fetched_at.asc.nullsfirst&limit=' +
    MAX_REFRESHES_PER_RUN;

  let staleRows;
  try {
    const r = await fetch(queryUrl, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
      }
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

  // ---- Refresh each one sequentially (don't parallel-flood Meta) ----
  let refreshed = 0;
  let failed = 0;
  const details = [];

  for (const row of staleRows) {
    try {
      const result = await refreshInstagramData(row.user_id);
      if (result.ok) {
        refreshed++;
      } else {
        failed++;
        details.push({ user_id: row.user_id, error: result.error });
        // If the error is auth-related (token expired/revoked), there's no point
        // retrying it for the next 3 days. The user needs to reconnect manually.
        // The data_fetch_error column already records this for visibility.
      }
    } catch (e) {
      failed++;
      details.push({ user_id: row.user_id, error: e.message });
    }

    // Small delay between users to be polite to Meta's rate limits
    await new Promise(r => setTimeout(r, 250));
  }

  return res.status(200).json({
    ok: true,
    refreshed: refreshed,
    failed: failed,
    total: staleRows.length,
    details: details.slice(0, 20) // truncate for log readability
  });
};
