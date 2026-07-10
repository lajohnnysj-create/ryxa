// GET /api/admin-data?action=errors|stats
// Admin-only data endpoint. Access requires a valid Supabase session whose
// verified email is the admin email AND whose identity includes Google.
// The email check happens here, server-side, against Supabase's verified
// user record. Client-side checks on the admin page are UX only.
//
// Copy into the Ryxa repo at api/admin-data.js.

const { SUPABASE_URL, getServiceKey, requireAdmin } = require('./lib/admin-auth');

// Kept as a module-level constant so the existing call sites read unchanged.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbGet(path) {
  const res = await fetch(SUPABASE_URL + path, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
      Prefer: 'count=exact'
    }
  });
  const count = res.headers.get('content-range');
  const data = res.ok ? await res.json() : null;
  return { ok: res.ok, data: data, total: count ? count.split('/')[1] : null };
}

module.exports = async (req, res) => {
  // Rate limit before the auth check: an unauthenticated flood should be
  // rejected without spending a round trip to Supabase's /auth/v1/user.
  // Generous, because "Load older" paginates and a real admin clicks it.
  if (require('./lib/rate-limit').tooMany(req, res, 'admin-data', 120, 60000)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Shared with api/admin-action.js. One rule, one place.
  const user = await requireAdmin(req, res);
  if (!user) return;

  const action = String(req.query.action || 'errors');

  if (action === 'stats') {
    const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const week = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [users, err24, err7d, earningsRes] = await Promise.all([
      sbGet('/rest/v1/profiles?select=user_id&limit=1'),
      sbGet('/rest/v1/client_errors?select=id&occurred_at=gte.' + day + '&limit=1'),
      sbGet('/rest/v1/client_errors?select=id&occurred_at=gte.' + week + '&limit=1'),
      fetch(SUPABASE_URL + '/rest/v1/rpc/admin_total_earnings', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json'
        },
        body: '{}'
      })
    ]);
    let earnings = null;
    if (earningsRes.ok) {
      const e = await earningsRes.json();
      const total =
        (e.products_cents || 0) + (e.courses_cents || 0) +
        (e.bookings_cents || 0) + (e.tips_cents || 0);
      earnings = { total_cents: total, breakdown: e };
    }
    return res.status(200).json({
      users_total: users.total,
      errors_24h: err24.total,
      errors_7d: err7d.total,
      earnings: earnings
    });
  }

  // ---------------------------------------------------------------------
  // action=threshold
  //
  // Accounts that crossed the manual-subscriber soft threshold.
  //
  // Everything here comes from the event row plus one profiles lookup for the
  // usernames. Deliberately NO live subscriber counts: Prefer:count=exact on
  // subscribers_view forces Postgres to materialize a five-table UNION with a
  // DISTINCT ON and count every row, per account, on every tab open. Cheap at
  // five accounts, ruinous at fifty large ones, and it answers a question the
  // event row already answers well enough.
  // ---------------------------------------------------------------------
  if (action === 'threshold') {
    const evRes = await fetch(
      SUPABASE_URL + '/rest/v1/manual_subscriber_threshold_events'
        + '?select=user_id,threshold_count,subscriber_count_at_crossing,created_at,flagged,attestation_version'
        + '&order=created_at.desc&limit=100',
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY } }
    );
    if (!evRes.ok) return res.status(502).json({ error: 'Threshold lookup failed' });
    const events = await evRes.json();
    if (!events || events.length === 0) return res.status(200).json({ accounts: [] });

    // An account can cross more than once if the profile flag is ever reset.
    // Keep the earliest: the first crossing is the event worth knowing about.
    const byUser = {};
    events.forEach(function (e) {
      const prev = byUser[e.user_id];
      if (!prev || new Date(e.created_at) < new Date(prev.created_at)) byUser[e.user_id] = e;
    });
    const userIds = Object.keys(byUser);

    // One query for every username. A bare UUID tells an admin nothing.
    const idList = '(' + userIds.map(encodeURIComponent).join(',') + ')';
    const prRes = await fetch(
      SUPABASE_URL + '/rest/v1/profiles?select=user_id,username&user_id=in.' + idList,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY } }
    );
    const profiles = prRes.ok ? await prRes.json() : [];
    const nameOf = {};
    profiles.forEach(function (p) { nameOf[p.user_id] = p.username; });

    const accounts = userIds.map(function (uid) {
      const e = byUser[uid];
      return {
        user_id: uid,
        username: nameOf[uid] || null,
        subscribers_at_crossing: e.subscriber_count_at_crossing,
        threshold_count: e.threshold_count,
        crossed_at: e.created_at,
        attestation_version: e.attestation_version || null,
        flagged: !!e.flagged
      };
    }).sort(function (a, b) {
      // Most recent crossing first: it is the thing that just happened.
      return new Date(b.crossed_at) - new Date(a.crossed_at);
    });

    return res.status(200).json({ accounts: accounts });
  }

  if (action === 'errors') {
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) limit = 50;
    let path = '/rest/v1/client_errors?select=*&order=occurred_at.desc&limit=' + limit;
    // Optional cursor for paging: pass the oldest occurred_at from the
    // previous page as ?before=
    const before = req.query.before;
    if (typeof before === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+/.test(before)) {
      path += '&occurred_at=lt.' + encodeURIComponent(before);
    }
    const out = await sbGet(path);
    if (!out.ok) return res.status(500).json({ error: 'Query failed' });
    return res.status(200).json({ errors: out.data, total: out.total });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
