// Vercel serverless function — Instagram Token Refresh (background)
// =====================================================================
// Called daily by Supabase pg_cron. Finds instagram_connections whose
// long-lived token (~60 day life) is within REFRESH_WINDOW_DAYS of expiry
// and still valid, then calls Instagram's refresh endpoint to extend each
// one another ~60 days. The new token is re-encrypted and written back
// together with its new token_expires_at and last_refreshed_at.
//
// Why a window instead of refreshing exactly at expiry: a token in the
// window stays eligible every day until it succeeds, so one missed run or
// a transient Meta error does not lose the connection. Once refreshed, the
// new expiry jumps ~60 days out and the row drops out of the window until
// it ages back in, so each token is effectively refreshed once per cycle.
//
// Using a token for normal API calls does NOT extend it; only this refresh
// call does. Tokens that have already expired or been revoked cannot be
// refreshed (only a fresh OAuth can); those surface via the daily data
// cron's data_fetch_error, which the dashboard can use for a reconnect nudge.
//
// Authenticated via X-Cron-Secret header — must match CRON_SECRET env var.
// No user JWT involved; this is a server-to-server call.
//
// Endpoint: POST https://www.ryxa.io/api/instagram-token-refresh
// Headers:  X-Cron-Secret: <secret>
//
// Returns { ok: true, refreshed: N, failed: M, total: T, details: [...] }
// =====================================================================

const { encryptToken, decryptToken } = require('./lib/token-crypto.js');
const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Refresh any token expiring within this many days. Wider is safer (more
// daily attempts before a token can lapse); a refreshed token leaves the
// window immediately, so there is no downside to a generous value.
const REFRESH_WINDOW_DAYS = 10;

// Instagram will not refresh a token younger than 24 hours. In the window a
// token is ~50 days old so this is virtually always satisfied, but we guard
// anyway to avoid a guaranteed-failing call.
const MIN_TOKEN_AGE_HOURS = 24;

// Batch cap per run. Token refresh is one lightweight call each, so this can
// be higher than the data cron's cap. Vercel Pro allows a 300s timeout.
const MAX_REFRESHES_PER_RUN = 100;

module.exports = async function handler(req, res) {
  // Per-IP rate limit: 6 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'ig-refresh', 6, 60000)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ---- Auth: verify cron secret (timing-safe) ----
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

  // ---- Find tokens nearing expiry (still valid, expiring within the window) ----
  // token_expires_at >= now()  AND  token_expires_at <= now() + window.
  // Rows with a NULL token_expires_at do not match and are left alone; they
  // fall back to the data cron's reconnect path if they ever break.
  const nowIso = new Date().toISOString();
  const windowIso = new Date(Date.now() + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const queryUrl =
    SUPABASE_URL +
    '/rest/v1/instagram_connections?token_expires_at=gte.' + nowIso +
    '&token_expires_at=lte.' + windowIso +
    '&select=user_id,access_token,token_expires_at,connected_at,last_refreshed_at' +
    '&order=token_expires_at.asc&limit=' + MAX_REFRESHES_PER_RUN;

  let rows;
  try {
    const r = await fetch(queryUrl, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
      }
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('IG token-refresh query failed:', r.status, errText);
      return res.status(500).json({ ok: false, error: 'Query failed' });
    }
    rows = await r.json();
  } catch (e) {
    console.error('IG token-refresh query threw:', e.message);
    return res.status(500).json({ ok: false, error: 'Query threw: ' + e.message });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(200).json({ ok: true, refreshed: 0, failed: 0, message: 'No tokens nearing expiry' });
  }

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;
  const details = [];

  for (const row of rows) {
    try {
      // 24h-age guard against the freshest timestamp we have.
      const refAge = row.last_refreshed_at || row.connected_at;
      if (refAge && (Date.now() - new Date(refAge).getTime()) < MIN_TOKEN_AGE_HOURS * 60 * 60 * 1000) {
        skipped++;
        details.push({ user_id: row.user_id, skipped: 'token younger than 24h' });
        continue;
      }

      let plain;
      try {
        plain = decryptToken(row.access_token);
      } catch (e) {
        failed++;
        details.push({ user_id: row.user_id, error: 'token decrypt failed' });
        continue;
      }

      // Instagram Login API refresh. No client_secret required for this grant.
      const refreshUrl =
        'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' +
        encodeURIComponent(plain);

      const r = await fetch(refreshUrl);
      const body = await r.json().catch(() => null);

      if (!r.ok || !body || !body.access_token) {
        // Almost always: already expired or the user revoked access. Refresh
        // cannot recover those, only a fresh OAuth can. The daily data cron
        // records data_fetch_error for the same row, so the broken state is
        // already visible for a reconnect prompt; nothing to do here but log.
        failed++;
        details.push({
          user_id: row.user_id,
          error: (body && body.error && body.error.message) || ('refresh HTTP ' + r.status)
        });
        await new Promise(rs => setTimeout(rs, 200));
        continue;
      }

      const expiresIn = Number(body.expires_in) || 60 * 24 * 60 * 60; // 60 days default
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      const patchUrl =
        SUPABASE_URL + '/rest/v1/instagram_connections?user_id=eq.' + encodeURIComponent(row.user_id);
      const pr = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          access_token: encryptToken(body.access_token),
          token_expires_at: newExpiresAt,
          last_refreshed_at: new Date().toISOString()
        })
      });

      if (!pr.ok) {
        const errText = await pr.text();
        console.error('IG token-refresh DB write failed for', row.user_id, pr.status, errText);
        failed++;
        details.push({ user_id: row.user_id, error: 'DB write failed ' + pr.status });
      } else {
        refreshed++;
      }
    } catch (e) {
      failed++;
      details.push({ user_id: row.user_id, error: e.message });
    }

    // Be polite to Meta between calls.
    await new Promise(rs => setTimeout(rs, 200));
  }

  return res.status(200).json({
    ok: true,
    refreshed: refreshed,
    failed: failed,
    skipped: skipped,
    total: rows.length,
    details: details.slice(0, 30)
  });
};
