// /api/check-username.js
//
// Server-side username availability check for the homepage hero claim
// field. Replaces the direct browser query against `public_profiles`,
// which had no rate limiting (anyone could script unlimited checks).
//
// Flow:
//   1. Validate the username input.
//   2. Enforce a per-IP rate limit (Postgres-backed, same pattern as
//      /api/bio-subscribe.js).
//   3. Query public_profiles with the service role key.
//   4. Return { available: true/false } - nothing else. The endpoint
//      never returns any profile data, just the boolean.
//
// Pattern matches the rest of /api/: require() + raw fetch to Supabase
// REST. NO @supabase/supabase-js.

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

// Rate limit: 40 checks per IP per 10 minutes.
// A real user picking a username makes maybe 15-40 checks over a few
// minutes; 40 per 10 min gives generous headroom and never trips a human.
// A script wanting to enumerate the username space is hard-capped at 40
// per 10 min, which makes mass enumeration impractical.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;  // 10 minutes
const RATE_LIMIT_MAX = 40;

// Username rules - must match the client (heroCleanUsername) and the
// dashboard. Lowercase a-z, 0-9, underscore; 3-30 chars.
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

// Reserved usernames - mirrors HERO_RESERVED / BIO_RESERVED. Kept in sync
// manually. A reserved name is reported as NOT available.
const RESERVED = new Set([
  'admin','about','api','blog','contact','dashboard','deal','brand-portal','faq','findthesnakes','ryxa',
  'follower-audit','help','home','index','instructions','login','mail',
  'pricing','privacy','reset-password','root','settings','signin','signup',
  'support','terms','user','username','www',
  'youtube','instagram','tiktok','twitter','facebook','google','snake','snakes'
]);

// ============================================================
// Helpers
// ============================================================

function getServiceKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

function getClientIp(req) {
  // Vercel provides x-forwarded-for (comma-separated list, closest proxy
  // on the right) and x-real-ip. Take the first entry of x-forwarded-for.
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  const xri = req.headers['x-real-ip'];
  if (xri) return xri;
  return 'unknown';
}

function hashIp(ip) {
  // SHA-256 hex. We never store raw IPs (no PII retention).
  return crypto.createHash('sha256').update(ip).digest('hex');
}

async function sbFetch(path, options = {}) {
  const key = getServiceKey();
  const headers = Object.assign({
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
  }, options.headers || {});
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return res;
}

// ============================================================
// Rate limiting - per IP, single window.
// Returns { allowed: boolean, retryAfterSeconds?: number }.
//
// Fails OPEN on infra errors: if the rate-limit table itself has a
// problem, we allow the check through rather than block legitimate
// users. The check leaks nothing sensitive, so failing open is safe.
//
// Race condition note: two concurrent requests from one IP could both
// pass the count check before incrementing. With limit 40 the worst
// case is a few extra checks in a window - harmless.
// ============================================================

async function checkRateLimit(ipHash) {
  const selPath = 'username_check_rate_limits'
    + '?ip_hash=eq.' + encodeURIComponent(ipHash)
    + '&select=attempt_count,window_started_at&limit=1';

  const selRes = await sbFetch(selPath);
  if (!selRes.ok) {
    console.error('username-check rate-limit SELECT failed:', selRes.status);
    return { allowed: true };  // fail open
  }
  const rows = await selRes.json();
  const now = Date.now();

  if (rows.length === 0) {
    // First check from this IP. Insert a fresh row.
    const insRes = await sbFetch('username_check_rate_limits', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: { ip_hash: ipHash, attempt_count: 1, window_started_at: new Date(now).toISOString() },
    });
    if (!insRes.ok) console.error('username-check rate-limit INSERT failed:', insRes.status);
    return { allowed: true };
  }

  const row = rows[0];
  const windowStart = new Date(row.window_started_at).getTime();
  const windowAge = now - windowStart;
  const updPath = 'username_check_rate_limits?ip_hash=eq.' + encodeURIComponent(ipHash);

  if (windowAge > RATE_LIMIT_WINDOW_MS) {
    // Window expired - reset.
    const updRes = await sbFetch(updPath, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: { attempt_count: 1, window_started_at: new Date(now).toISOString() },
    });
    if (!updRes.ok) console.error('username-check rate-limit reset failed:', updRes.status);
    return { allowed: true };
  }

  if (row.attempt_count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - windowAge) / 1000);
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  // Within window, under limit - increment.
  const updRes = await sbFetch(updPath, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: { attempt_count: row.attempt_count + 1 },
  });
  if (!updRes.ok) console.error('username-check rate-limit increment failed:', updRes.status);
  return { allowed: true };
}

// ============================================================
// Main handler
// ============================================================

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body defensively.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Missing body' });
  }

  // Normalize + validate the username.
  const raw = typeof body.username === 'string' ? body.username : '';
  const username = raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
  if (!USERNAME_RE.test(username)) {
    // Invalid format - not available, but this is a cheap local check,
    // no DB query needed.
    return res.status(200).json({ available: false, reason: 'invalid' });
  }
  if (RESERVED.has(username)) {
    return res.status(200).json({ available: false, reason: 'reserved' });
  }

  // Rate limit.
  const ipHash = hashIp(getClientIp(req));
  let limit;
  try {
    limit = await checkRateLimit(ipHash);
  } catch (e) {
    console.error('username-check rate-limit error:', e);
    limit = { allowed: true };  // fail open
  }
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds || 600));
    return res.status(429).json({
      error: 'Too many checks. Please try again shortly.',
      retry_after_seconds: limit.retryAfterSeconds,
    });
  }

  // Query public_profiles with the service role key. We select only
  // user_id and return only a boolean - no profile data leaves here.
  try {
    const qPath = 'public_profiles?select=user_id&username=eq.'
      + encodeURIComponent(username) + '&limit=1';
    const qRes = await sbFetch(qPath);
    if (!qRes.ok) {
      console.error('username-check query failed:', qRes.status);
      return res.status(503).json({ error: 'Could not check right now.' });
    }
    const rows = await qRes.json();
    const available = Array.isArray(rows) && rows.length === 0;
    return res.status(200).json({ available: available });
  } catch (e) {
    console.error('username-check error:', e);
    return res.status(503).json({ error: 'Could not check right now.' });
  }
};
