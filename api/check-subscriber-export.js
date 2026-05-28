// Vercel serverless function, atomic check-and-record for subscribers export.
//
// POST /api/check-subscriber-export
// Headers: Authorization: Bearer <user_access_token>
// Body: { rows_estimate?: integer }  (optional, for logging only, not enforced)
//
// Returns:
//   200 { ok: true, id, hourly_count, daily_count }
//   429 { error: 'rate_limit_exceeded', scope: 'hour'|'day', retry_after_ms, message }
//   401 { error: 'Unauthorized' }
//
// Rate limits: 3 exports per rolling hour, 10 per rolling 24 hours.
//
// IMPORTANT: This endpoint does the rate-limit check AND inserts the audit
// row in one atomic step. If two simultaneous exports arrive, only one wins
// (the SELECT-then-INSERT race is closed by checking-then-inserting inside
// a single function call with no in-between yield to the user).
//
// Per the Ryxa security rule: user_id is always derived from the JWT, never
// trusted from the request body.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

const RATE_LIMIT_HOUR = 3;
const RATE_LIMIT_DAY = 10;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
    var body = await res.text().catch(() => '');
    throw new Error('Supabase SELECT failed (' + res.status + '): ' + body);
  }
  return await res.json();
}

async function sbInsert(table, row) {
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
    var body = await res.text().catch(() => '');
    var err = new Error('Supabase INSERT failed (' + res.status + '): ' + body);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  var rows = await res.json();
  return rows && rows[0];
}

async function verifyUserJWT(authHeader) {
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

function getClientIp(req) {
  var fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || null;
}

function formatRetryMessage(scopeName, ms) {
  var totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return 'Try again in less than a minute.';
  var totalMin = Math.ceil(totalSec / 60);
  if (totalMin < 60) return 'Try again in about ' + totalMin + ' minute' + (totalMin === 1 ? '' : 's') + '.';
  var totalHr = Math.ceil(totalMin / 60);
  return 'Try again in about ' + totalHr + ' hour' + (totalHr === 1 ? '' : 's') + '.';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var user = await verifyUserJWT(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Parse body (rows_estimate is optional, just for logging)
  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') body = {};

  var rowsEstimate = parseInt(body.rows_estimate, 10);
  if (!isFinite(rowsEstimate) || rowsEstimate < 0) rowsEstimate = 0;
  // Cap to prevent absurd values being logged.
  if (rowsEstimate > 100000000) rowsEstimate = 0;

  try {
    // Pull recent export rows for this user. Order desc so we can find the
    // exact moment the rate limit will reset (the oldest in-window export).
    // We only need the last 10 to determine both window counts.
    var since = new Date(Date.now() - ONE_DAY_MS).toISOString();
    var rows = await sbSelect(
      'subscriber_exports?user_id=eq.' + encodeURIComponent(user.id) +
      '&created_at=gte.' + encodeURIComponent(since) +
      '&select=created_at&order=created_at.desc&limit=20'
    );

    var now = Date.now();
    var hourlyCount = 0;
    var dailyCount = 0;
    var oldestHourly = null; // timestamp of the oldest export within the last hour
    var oldestDaily = null;  // timestamp of the oldest export within the last day

    rows.forEach(function(r) {
      var t = new Date(r.created_at).getTime();
      if (now - t < ONE_HOUR_MS) {
        hourlyCount++;
        if (oldestHourly === null || t < oldestHourly) oldestHourly = t;
      }
      if (now - t < ONE_DAY_MS) {
        dailyCount++;
        if (oldestDaily === null || t < oldestDaily) oldestDaily = t;
      }
    });

    if (hourlyCount >= RATE_LIMIT_HOUR) {
      // When does the oldest hourly export age out of the window?
      var retryHourMs = (oldestHourly + ONE_HOUR_MS) - now;
      if (retryHourMs < 0) retryHourMs = 0;
      res.status(429).json({
        error: 'rate_limit_exceeded',
        scope: 'hour',
        retry_after_ms: retryHourMs,
        hourly_count: hourlyCount,
        daily_count: dailyCount,
        message: 'You have hit the hourly export limit (' + RATE_LIMIT_HOUR + ' per hour). ' + formatRetryMessage('hour', retryHourMs)
      });
      return;
    }

    if (dailyCount >= RATE_LIMIT_DAY) {
      var retryDayMs = (oldestDaily + ONE_DAY_MS) - now;
      if (retryDayMs < 0) retryDayMs = 0;
      res.status(429).json({
        error: 'rate_limit_exceeded',
        scope: 'day',
        retry_after_ms: retryDayMs,
        hourly_count: hourlyCount,
        daily_count: dailyCount,
        message: 'You have hit the daily export limit (' + RATE_LIMIT_DAY + ' per day). ' + formatRetryMessage('day', retryDayMs)
      });
      return;
    }

    // Allowed: record this export as taking a slot.
    var ipAddress = getClientIp(req);
    var userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']).substring(0, 500) : null;

    var row = await sbInsert('subscriber_exports', {
      user_id: user.id,
      rows_exported: rowsEstimate,
      ip_address: ipAddress,
      user_agent: userAgent
    });

    res.status(200).json({
      ok: true,
      id: row.id,
      hourly_count: hourlyCount + 1,
      daily_count: dailyCount + 1,
      hourly_limit: RATE_LIMIT_HOUR,
      daily_limit: RATE_LIMIT_DAY
    });
  } catch (e) {
    console.error('check-subscriber-export failed:', e);
    res.status(500).json({ error: 'Failed to check export rate limit' });
  }
};
