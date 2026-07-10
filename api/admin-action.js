// /api/admin-action.js
//
// The admin panel's WRITE endpoint. Deliberately a separate file from
// admin-data.js, which is GET-only and should stay that way: keeping reads and
// writes apart means the read endpoint's method gate is a real guarantee
// rather than a comment.
//
// Currently supports one action:
//
//   POST { action: 'set_verified', user_id, verified }
//
// SECURITY
//   * Same identity check as the read endpoint, shared from lib/admin-auth so
//     the two can never drift apart.
//   * POST only. A GET that mutates state is a link someone can be tricked
//     into clicking.
//   * The service role key never leaves the server.
//   * No CSRF token needed: authorization comes from a Bearer token that the
//     browser does not attach automatically, unlike a cookie.
//
// AUDIT
//   Every write is recorded in admin_audit_log before it is applied. If the
//   log write fails, the action does not happen. An unlogged admin action is
//   indistinguishable from an attacker's.

const { SUPABASE_URL, getServiceKey, requireAdmin } = require('./lib/admin-auth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sbFetch(path, options = {}) {
  const key = getServiceKey();
  const headers = Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
  }, options.headers || {});
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

// Record first, act second. Ordering matters: a failed audit write must abort
// the action, not follow it.
async function audit(adminEmail, action, targetUserId, details) {
  const res = await sbFetch('admin_audit_log', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: {
      admin_email: adminEmail,
      action: action,
      target_user_id: targetUserId,
      details: details || null,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('audit write failed: ' + res.status + ' ' + body.slice(0, 120));
  }
}

module.exports = async (req, res) => {
  // Writes are rarer than reads and more consequential. Tight limit, applied
  // before the auth check so a flood costs us nothing but a counter.
  if (require('./lib/rate-limit').tooMany(req, res, 'admin-action', 30, 60000)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAdmin(req, res);
  if (!user) return;   // requireAdmin already responded

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Missing body' });
  }

  const action = String(body.action || '');

  // -------------------------------------------------------------------------
  // set_verified: grant or revoke the blue check.
  // -------------------------------------------------------------------------
  if (action === 'set_verified') {
    const userId = String(body.user_id || '');
    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    if (typeof body.verified !== 'boolean') {
      return res.status(400).json({ error: 'verified must be true or false' });
    }
    const verified = body.verified;

    try {
      await audit(user.email, 'set_verified', userId, { verified: verified });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not record the action' });
    }

    // return=representation so we can confirm a row actually matched. A PATCH
    // against a nonexistent user_id succeeds with zero rows, which would look
    // like success from the status code alone.
    const upd = await sbFetch(
      'profiles?user_id=eq.' + encodeURIComponent(userId),
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { verified: verified },
      }
    );

    if (!upd.ok) {
      const t = await upd.text().catch(() => '');
      console.error('set_verified failed:', upd.status, t.slice(0, 160));
      return res.status(502).json({ error: 'Update failed' });
    }
    const rows = await upd.json();
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No creator with that id' });
    }

    return res.status(200).json({ ok: true, verified: rows[0].verified });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
