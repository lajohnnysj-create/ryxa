// Shared AI rate limiter — imported by every /api/ai-*.js endpoint.
//
// No dependencies — uses raw fetch to talk to Supabase REST API,
// matching the pattern of the rest of the api/ folder.
//
// Usage:
//   const { checkAndAuth, recordUsage } = require('./_ai-rate-limit.js');
//
//   const auth = await checkAndAuth(req, 'ai-bio');
//   if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...(auth.extras || {}) });
//
//   // ... do the AI call ...
//
//   recordUsage(auth.userId, 'ai-bio');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTcxMzEsImV4cCI6MjA5MDg5MzEzMX0.VC8mcU5lUeA56kG2gHssvl88EVWr018XttA86jpfEn0';

// ============================================================
// CONFIGURATION — edit these to change limits
// ============================================================

const TIER_LIMITS = {
  max: 200,         // Creator Max: 200 calls per rolling 24h
  monthly: 100,     // Pro: 100 calls per rolling 24h
  free: 0,          // Free: no AI access
};

// Global daily cost cap (kill switch).
// Above this estimated spend, ALL AI endpoints freeze and return 503.
// Conservative starting value — raise as you grow.
const GLOBAL_DAILY_COST_CAP_USD = 50;

// Conservative average cost per call across all endpoints.
// Real average is ~$0.005, using $0.011 worst-case so the cap kicks in earlier.
const AVG_COST_PER_CALL_USD = 0.011;

const GLOBAL_DAILY_CALL_CAP = Math.floor(GLOBAL_DAILY_COST_CAP_USD / AVG_COST_PER_CALL_USD);
// = ~4545 calls/day at $0.011/call = $50

// ============================================================
// Tiny helper: make an authenticated REST call to Supabase
// ============================================================

function getServiceKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

// SELECT with optional Prefer: count=exact for COUNT queries
async function sbSelect(path, options = {}) {
  const key = getServiceKey();
  const headers = {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Accept': 'application/json',
  };
  if (options.count) {
    headers['Prefer'] = 'count=exact';
    headers['Range-Unit'] = 'items';
    headers['Range'] = '0-0';  // we only need the count, not rows
  }
  const url = SUPABASE_URL + '/rest/v1/' + path;
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Supabase SELECT failed (' + res.status + '): ' + body);
  }
  // Parse Content-Range to extract count if requested
  let count = null;
  if (options.count) {
    const cr = res.headers.get('content-range') || '';
    const m = cr.match(/\/(\d+|\*)$/);
    if (m && m[1] !== '*') count = parseInt(m[1], 10);
  }
  const rows = await res.json();
  return { rows, count };
}

// INSERT a row and return its id
async function sbInsertReturningId(table, row) {
  const key = getServiceKey();
  const url = SUPABASE_URL + '/rest/v1/' + table;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Supabase INSERT failed (' + res.status + '): ' + body);
  }
  const rows = await res.json();
  return rows?.[0]?.id || null;
}

// INSERT a row
async function sbInsert(table, row) {
  const key = getServiceKey();
  const url = SUPABASE_URL + '/rest/v1/' + table;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Supabase INSERT failed (' + res.status + '): ' + body);
  }
}

// ============================================================
// MAIN: checkAndAuth — call this at the top of every AI endpoint
// ============================================================

async function checkAndAuth(req, endpointName) {
  // 1. Extract JWT
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  const token = authHeader.split(' ')[1];

  // 2. Verify JWT and get user_id
  let userId;
  try {
    const authRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY }
    });
    if (!authRes.ok) return { ok: false, status: 401, error: 'Unauthorized' };
    const userData = await authRes.json();
    userId = userData?.id;
    if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };
  } catch (e) {
    return { ok: false, status: 401, error: 'Auth verification failed' };
  }

  // 3. Global cost cap check
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const { count: globalCount } = await sbSelect(
      'ai_usage?select=id&called_at=gte.' + encodeURIComponent(since),
      { count: true }
    );
    if (globalCount !== null && globalCount >= GLOBAL_DAILY_CALL_CAP) {
      console.error('GLOBAL CAP HIT: ' + globalCount + ' calls in 24h (cap: ' + GLOBAL_DAILY_CALL_CAP + ')');
      return {
        ok: false,
        status: 503,
        error: 'AI features are temporarily unavailable due to high demand. Please try again later.',
        extras: { reason: 'global_cap' }
      };
    }
  } catch (e) {
    console.error('Global cap query failed:', e.message);
    // Fail closed
    return { ok: false, status: 503, error: 'AI temporarily unavailable. Please try again in a moment.' };
  }

  // 4. Look up tier
  let tier = 'free';
  try {
    const { rows: subRows } = await sbSelect(
      'subscriptions?select=tier&user_id=eq.' + userId + '&status=in.(active,cancelling,trialing)&limit=1'
    );
    if (subRows && subRows.length > 0) tier = subRows[0].tier || 'free';
  } catch (e) {
    console.error('Tier lookup failed:', e.message);
    return { ok: false, status: 503, error: 'AI temporarily unavailable. Please try again in a moment.' };
  }

  const limit = TIER_LIMITS[tier] ?? 0;
  if (limit === 0) {
    return {
      ok: false,
      status: 402,
      error: 'AI features require a Pro or Creator Max plan.',
      extras: { reason: 'no_tier', tier }
    };
  }

  // 5. Count user's calls in last 24h
  let userCount;
  try {
    const result = await sbSelect(
      'ai_usage?select=id&user_id=eq.' + userId + '&called_at=gte.' + encodeURIComponent(since),
      { count: true }
    );
    userCount = result.count || 0;
  } catch (e) {
    console.error('User count query failed:', e.message);
    return { ok: false, status: 503, error: 'AI temporarily unavailable. Please try again in a moment.' };
  }

  if (userCount >= limit) {
    // Find oldest call within window for reset time
    let resetAt = null;
    try {
      const { rows: oldestRows } = await sbSelect(
        'ai_usage?select=called_at&user_id=eq.' + userId + '&called_at=gte.' + encodeURIComponent(since) + '&order=called_at.asc&limit=1'
      );
      if (oldestRows && oldestRows.length > 0) {
        resetAt = new Date(new Date(oldestRows[0].called_at).getTime() + 24 * 60 * 60 * 1000).toISOString();
      }
    } catch (e) { /* non-fatal */ }

    return {
      ok: false,
      status: 429,
      error: 'Daily AI limit reached (' + limit + ' calls per 24 hours).',
      extras: {
        reason: 'rate_limit',
        used: userCount,
        limit: limit,
        tier: tier,
        next_reset_at: resetAt
      }
    };
  }

  return {
    ok: true,
    userId: userId,
    tier: tier,
    used: userCount,
    limit: limit,
    usageId: null,  // set below after recording
  };
}

// ============================================================
// reserveSlot — call this RIGHT AFTER checkAndAuth returns ok.
// Records the usage row immediately so the slot is reserved
// before the long-running AI call. Returns the row id so the
// caller can refund on failure.
// ============================================================

async function reserveSlot(userId, endpoint) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const id = await sbInsertReturningId('ai_usage', { user_id: userId, endpoint: endpoint });
      return id;
    } catch (e) {
      if (attempt === 2) {
        console.error('reserveSlot failed after retry: ' + endpoint + ' user=' + userId + ' — ' + e.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

// ============================================================
// refundSlot — call this if the AI call fails, so the user
// doesn't get charged for a call that didn't deliver value.
// ============================================================

async function refundSlot(usageId) {
  if (!usageId) return;
  try {
    const key = getServiceKey();
    await fetch(SUPABASE_URL + '/rest/v1/ai_usage?id=eq.' + encodeURIComponent(usageId), {
      method: 'DELETE',
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
      },
    });
  } catch (e) {
    console.error('refundSlot failed:', e.message);
  }
}

module.exports = { checkAndAuth, reserveSlot, refundSlot, TIER_LIMITS, GLOBAL_DAILY_COST_CAP_USD };
