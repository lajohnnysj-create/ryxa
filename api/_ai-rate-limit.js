// Shared AI rate limiter — imported by every /api/ai-*.js endpoint
//
// Usage:
//   const { checkAndAuth, recordUsage } = require('./_ai-rate-limit.js');
//
//   const auth = await checkAndAuth(req, 'ai-bio');
//   if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...auth.extras });
//
//   // ... do the AI call ...
//
//   await recordUsage(auth.userId, 'ai-bio');
//
// The rate limiter:
//   1. Verifies the JWT and extracts user_id
//   2. Looks up tier from subscriptions
//   3. Counts calls in last 24h
//   4. Checks global daily cost cap
//   5. Returns ok=true with userId, OR ok=false with 401/402/429/503

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

// Derived: how many global calls per day before we trip the cap
const GLOBAL_DAILY_CALL_CAP = Math.floor(GLOBAL_DAILY_COST_CAP_USD / AVG_COST_PER_CALL_USD);
// = ~4545 calls/day at $0.011/call = $50

// ============================================================
// SUPABASE CLIENT (lazy-init to avoid cold-start cost when not needed)
// ============================================================

let _serviceClient = null;
function getServiceClient() {
  if (_serviceClient) return _serviceClient;
  const { createClient } = require('@supabase/supabase-js');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  _serviceClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return _serviceClient;
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

  // 2. Verify JWT and get user_id (single round trip)
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

  // 3. Use service-role client for the rest
  let sb;
  try { sb = getServiceClient(); }
  catch (e) {
    console.error('Service client init failed:', e.message);
    return { ok: false, status: 500, error: 'Server error' };
  }

  // 4. Global cost cap check (single COUNT query, indexed)
  const { count: globalCount, error: globalErr } = await sb
    .from('ai_usage')
    .select('*', { count: 'exact', head: true })
    .gte('called_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (globalErr) {
    console.error('Global cap query failed:', globalErr);
    // Fail closed: if we can't check, deny.
    return { ok: false, status: 503, error: 'AI temporarily unavailable. Please try again in a moment.' };
  }
  if (globalCount >= GLOBAL_DAILY_CALL_CAP) {
    console.error(`GLOBAL CAP HIT: ${globalCount} calls in 24h (cap: ${GLOBAL_DAILY_CALL_CAP})`);
    return {
      ok: false,
      status: 503,
      error: 'AI features are temporarily unavailable due to high demand. Please try again later.',
      extras: { reason: 'global_cap' }
    };
  }

  // 5. Look up tier
  const { data: subRow } = await sb
    .from('subscriptions')
    .select('tier')
    .eq('user_id', userId)
    .in('status', ['active', 'cancelling', 'trialing'])
    .maybeSingle();

  const tier = subRow?.tier || 'free';
  const limit = TIER_LIMITS[tier] ?? 0;

  if (limit === 0) {
    return {
      ok: false,
      status: 402,  // Payment Required
      error: 'AI features require a Pro or Creator Max plan.',
      extras: { reason: 'no_tier', tier }
    };
  }

  // 6. Count user's calls in last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: userCount, error: userErr } = await sb
    .from('ai_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('called_at', since);

  if (userErr) {
    console.error('User count query failed:', userErr);
    return { ok: false, status: 503, error: 'AI temporarily unavailable. Please try again in a moment.' };
  }

  if (userCount >= limit) {
    // Find when the oldest call expires — that's when they get a slot back
    const { data: oldestRow } = await sb
      .from('ai_usage')
      .select('called_at')
      .eq('user_id', userId)
      .gte('called_at', since)
      .order('called_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const resetAt = oldestRow
      ? new Date(new Date(oldestRow.called_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
      : null;

    return {
      ok: false,
      status: 429,
      error: `Daily AI limit reached (${limit} calls per 24 hours).`,
      extras: {
        reason: 'rate_limit',
        used: userCount,
        limit: limit,
        tier: tier,
        next_reset_at: resetAt
      }
    };
  }

  // 7. Cleared all checks
  return {
    ok: true,
    userId: userId,
    tier: tier,
    used: userCount,
    limit: limit,
    sb: sb,  // pass through so caller can reuse
  };
}

// ============================================================
// recordUsage — call after the AI request succeeds.
// ============================================================
// We record AFTER success on purpose: if the AI call fails, we don't
// want to charge the user a slot. Drawback: a fast loop could squeeze
// extra calls in before recording. Mitigation: the global cap still
// applies, so worst-case parallel exploit is bounded.

async function recordUsage(userId, endpoint, sbClient) {
  try {
    const sb = sbClient || getServiceClient();
    const { error } = await sb.from('ai_usage').insert({
      user_id: userId,
      endpoint: endpoint
    });
    if (error) console.error('recordUsage failed:', error);
  } catch (e) {
    // Don't fail the request just because logging failed
    console.error('recordUsage threw:', e);
  }
}

module.exports = { checkAndAuth, recordUsage, TIER_LIMITS, GLOBAL_DAILY_COST_CAP_USD };
