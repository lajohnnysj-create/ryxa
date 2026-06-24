// Vercel serverless function - TikTok Cron Refresh (background)
// =====================================================================
// Called daily by Supabase pg_cron. Refreshes any tiktok_connections rows
// where data_last_fetched_at is null OR older than the stale threshold, via the
// shared fetch helper (token refresh + profile + headline stats).
//
// Authenticated via X-Cron-Secret header, must match CRON_SECRET env var.
// Server-to-server; no user JWT involved.
//
// Endpoint: POST https://www.ryxa.io/api/tiktok-cron-refresh
// Headers:  X-Cron-Secret: <secret>
//
// Returns { ok: true, refreshed: N, failed: M, details: [...] }
// =====================================================================

const { refreshTikTokData } = require('./_tiktok-fetch-helper.js');
const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const MAX_REFRESHES_PER_RUN = 50;

// Must align with the pg_cron cadence in sql/tiktok-cron-schedule.sql.
const STALE_THRESHOLD_DAYS = 3;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!CRON_SECRET) {
    return res.status(500).json({ ok: false, error: 'Cron secret not configured' });
  }
  const provided = req.headers['x-cron-secret'] || req.headers['X-Cron-Secret'] || '';
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

  const cutoffIso = new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const filter = 'or=(data_last_fetched_at.is.null,data_last_fetched_at.lt.' + cutoffIso + ')';
  const queryUrl =
    SUPABASE_URL +
    '/rest/v1/tiktok_connections?' +
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

  let refreshed = 0;
  let failed = 0;
  const details = [];

  for (const row of staleRows) {
    try {
      const result = await refreshTikTokData(row.user_id);
      if (result.ok) {
        refreshed++;
      } else {
        failed++;
        details.push({ user_id: row.user_id, error: result.error });
      }
    } catch (e) {
      failed++;
      details.push({ user_id: row.user_id, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return res.status(200).json({
    ok: true,
    refreshed: refreshed,
    failed: failed,
    total: staleRows.length,
    details: details.slice(0, 20),
  });
};
