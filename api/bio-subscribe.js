// /api/bio-subscribe.js
//
// Server-side endpoint for the bio page email signup form.
// Replaces direct browser writes to `bio_email_signups`, which used to
// be wide open (`USING(true)` INSERT policy = unlimited spam).
//
// Validates input, enforces a per-IP-per-creator rate limit, then
// writes to bio_email_signups using the service role key (bypasses RLS).
//
// Pattern matches the rest of /api/: require() + raw fetch to Supabase
// REST. NO @supabase/supabase-js.

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

// Rate limit: 5 signups per IP per creator per hour.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;  // 1 hour
const RATE_LIMIT_MAX = 5;

// Email regex: simple but practical. Catches obvious garbage without
// being so strict it rejects valid edge cases.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// UUID regex for creator_id validation.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// Helpers
// ============================================================

function getServiceKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

function getClientIp(req) {
  // Vercel provides x-forwarded-for and x-real-ip. x-forwarded-for can be
  // a comma-separated list (closest proxy on the right); take the first.
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
  // SHA-256 hex. We don't store raw IPs (no PII retention).
  // The hash is deterministic, so the same IP always maps to the same
  // bucket within the same creator scope.
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
// Rate limiting
// ============================================================
//
// Returns { allowed: boolean, retryAfterSeconds?: number }.
//
// Logic:
//   1. SELECT the row for (ip_hash, creator_id)
//   2. If no row: INSERT one with count=1, allow.
//   3. If row exists and window started > 1hr ago: reset count=1, allow.
//   4. If row exists and within window:
//        - If count < limit: increment, allow.
//        - If count >= limit: block, return retry hint.
//
// Race condition: two concurrent requests from same IP could both pass
// the count check before incrementing. With limit=5, worst case is 6
// instead of 5 in a window. Acceptable; the upsert is atomic from the
// DB's view, just not from our read-then-write logic.

async function checkRateLimit(ipHash, creatorId) {
  const path = 'subscribe_rate_limits'
    + '?ip_hash=eq.' + encodeURIComponent(ipHash)
    + '&creator_id=eq.' + encodeURIComponent(creatorId)
    + '&select=attempt_count,window_started_at&limit=1';

  const selRes = await sbFetch(path);
  if (!selRes.ok) {
    // Fail open on rate-limit infra errors. Better to let signups through
    // than to block legitimate users if the rate-limit table has issues.
    console.error('rate-limit SELECT failed:', selRes.status);
    return { allowed: true };
  }
  const rows = await selRes.json();
  const now = Date.now();

  if (rows.length === 0) {
    // First attempt for this (ip, creator). Insert.
    const insRes = await sbFetch('subscribe_rate_limits', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: { ip_hash: ipHash, creator_id: creatorId, attempt_count: 1, window_started_at: new Date(now).toISOString() },
    });
    if (!insRes.ok) console.error('rate-limit INSERT failed:', insRes.status);
    return { allowed: true };
  }

  const row = rows[0];
  const windowStart = new Date(row.window_started_at).getTime();
  const windowAge = now - windowStart;

  if (windowAge > RATE_LIMIT_WINDOW_MS) {
    // Window expired. Reset.
    const updRes = await sbFetch(path.replace('&select=attempt_count,window_started_at&limit=1', ''), {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: { attempt_count: 1, window_started_at: new Date(now).toISOString() },
    });
    if (!updRes.ok) console.error('rate-limit reset PATCH failed:', updRes.status);
    return { allowed: true };
  }

  if (row.attempt_count >= RATE_LIMIT_MAX) {
    // Blocked.
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - windowAge) / 1000);
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  // Increment.
  const updRes = await sbFetch(path.replace('&select=attempt_count,window_started_at&limit=1', ''), {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: { attempt_count: row.attempt_count + 1 },
  });
  if (!updRes.ok) console.error('rate-limit increment PATCH failed:', updRes.status);
  return { allowed: true };
}

// ============================================================
// Main handler
// ============================================================

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body. Vercel parses JSON automatically when content-type is
  // application/json, but be defensive.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Missing body' });
  }

  const { creator_id, email, hp } = body;

  // Honeypot: a hidden field on the form that humans never fill in.
  // If it has a value, it's a bot. Reject silently with 200 so the bot
  // thinks it succeeded and doesn't retry.
  if (hp) {
    return res.status(200).json({ success: true });
  }

  // Input validation.
  if (!creator_id || !UUID_RE.test(creator_id)) {
    return res.status(400).json({ error: 'Invalid creator_id' });
  }
  if (!email || typeof email !== 'string' || email.length > 254) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  const trimmedEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmedEmail)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  // Rate limit check.
  const ip = getClientIp(req);
  const ipHash = hashIp(ip);
  const limit = await checkRateLimit(ipHash, creator_id);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds || 3600));
    return res.status(429).json({
      error: 'Too many attempts. Please try again later.',
      retry_after_seconds: limit.retryAfterSeconds,
    });
  }

  // Insert the signup.
  try {
    const insRes = await sbFetch('bio_email_signups', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: { creator_id, email: trimmedEmail },
    });

    if (insRes.ok) {
      return res.status(200).json({ success: true });
    }

    // Read the body to distinguish duplicate (23505) from real errors.
    const errBody = await insRes.text().catch(() => '');
    if (errBody.includes('23505') || errBody.toLowerCase().includes('duplicate')) {
      // Already subscribed. Treat as success (non-leaky) so the form's
      // duplicate handling can kick in.
      return res.status(200).json({ success: true, already_subscribed: true });
    }

    console.error('bio_email_signups INSERT failed:', insRes.status, errBody);
    return res.status(500).json({ error: 'Subscription failed' });
  } catch (e) {
    console.error('bio-subscribe error:', e);
    return res.status(500).json({ error: 'Subscription failed' });
  }
};
