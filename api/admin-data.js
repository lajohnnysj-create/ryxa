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
  // action=creator&username=<exact>
  //
  // EXACT match only, deliberately. A prefix or fuzzy search would let anyone
  // who reached this panel enumerate every creator on Ryxa by typing letters.
  // The admin knows the username they are looking for; the tool should not
  // help anyone discover usernames they do not already know.
  // ---------------------------------------------------------------------
  if (action === 'creator') {
    const raw = String(req.query.username || '').trim();

    // Strip the leading @ people paste out of habit.
    const username = raw.replace(/^@+/, '');

    // Usernames are stored lowercase and validated as /^[a-z0-9_]+$/ when a
    // creator sets one, so normalize and match that alphabet exactly.
    const lower = username.toLowerCase();
    if (!lower || !/^[a-z0-9_]{1,64}$/.test(lower)) {
      return res.status(400).json({ error: 'Invalid username' });
    }

    // eq, not ilike. In ilike, "_" is a single-character wildcard, so
    // "the_johnny" would also match "theXjohnny". Usernames legitimately
    // contain underscores, so an exact match is both safer and correct.
    // This mirrors how api/bio.js resolves a public page.
    const url = SUPABASE_URL + '/rest/v1/profiles'
      + '?username=eq.' + encodeURIComponent(lower)
      + '&select=user_id,username,verified,display_currency,created_at'
      + '&limit=1';

    const r = await fetch(url, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY },
    });
    if (!r.ok) {
      return res.status(502).json({ error: 'Lookup failed' });
    }
    const rows = await r.json();
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No creator with that username' });
    }
    return res.status(200).json({ creator: rows[0] });
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

  // ---------------------------------------------------------------------
  // action=reports
  //
  // AI content reports. reported_content is user-supplied and can be long, so
  // it is truncated server-side: an admin scanning a list does not need 40KB
  // of transcript, and shipping it to the browser costs the same whether it is
  // read or not.
  // ---------------------------------------------------------------------
  if (action === 'reports') {
    const rRes = await fetch(
      SUPABASE_URL + '/rest/v1/content_reports'
        + '?select=id,reporter_id,source,conversation_id,reported_content,reason,status,created_at'
        + '&order=created_at.desc&limit=100',
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY } }
    );
    if (!rRes.ok) return res.status(502).json({ error: 'Reports lookup failed' });
    const rows = await rRes.json();
    if (!rows || rows.length === 0) return res.status(200).json({ reports: [] });

    // Usernames, one query. A bare reporter UUID tells an admin nothing.
    const ids = Array.from(new Set(rows.map(function (r) { return r.reporter_id; }).filter(Boolean)));
    let nameOf = {};
    if (ids.length > 0) {
      const idList = '(' + ids.map(encodeURIComponent).join(',') + ')';
      const prRes = await fetch(
        SUPABASE_URL + '/rest/v1/profiles?select=user_id,username&user_id=in.' + idList,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY } }
      );
      if (prRes.ok) {
        const profiles = await prRes.json();
        profiles.forEach(function (p) { nameOf[p.user_id] = p.username; });
      }
    }

    const MAX = 4000;
    const reports = rows.map(function (r) {
      const content = r.reported_content || '';
      return {
        id: r.id,
        reporter_id: r.reporter_id,
        reporter: nameOf[r.reporter_id] || null,
        source: r.source,
        conversation_id: r.conversation_id,
        reason: r.reason || '',
        content: content.length > MAX ? content.slice(0, MAX) + '\n\n[truncated]' : content,
        status: r.status,
        created_at: r.created_at
      };
    });

    return res.status(200).json({ reports: reports });
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
