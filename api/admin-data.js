// GET /api/admin-data?action=errors|stats
// Admin-only data endpoint. Access requires a valid Supabase session whose
// verified email is the admin email AND whose identity includes Google.
// The email check happens here, server-side, against Supabase's verified
// user record. Client-side checks on the admin page are UX only.
//
// Copy into the Ryxa repo at api/admin-data.js.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_EMAIL = 'johnnyla@mrla-media.com';

async function getVerifiedUser(req) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: auth, apikey: SUPABASE_SERVICE_KEY }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function isAdmin(user) {
  if (!user || !user.email) return false;
  if (user.email.toLowerCase() !== ADMIN_EMAIL) return false;
  // Require the Google identity specifically. An email/password account
  // created with the same address (unverifiable, but belt and suspenders)
  // does not qualify.
  const identities = Array.isArray(user.identities) ? user.identities : [];
  const hasGoogle = identities.some(function (i) { return i.provider === 'google'; });
  return hasGoogle;
}

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
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const user = await getVerifiedUser(req);
  if (!isAdmin(user)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

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
