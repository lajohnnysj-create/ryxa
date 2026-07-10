// POST /api/log-error
// Receives client-side JavaScript errors from the dashboard and stores them
// in client_errors. Auth is optional (errors can happen before login), but
// when a Bearer token is present the user id is derived from it server-side,
// never from the body. Copy into the Ryxa repo at api/log-error.js.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Simple per-IP rate limit: 20 errors/minute. In-memory per lambda instance,
// which is imperfect but adequate to stop floods and abuse.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowStart = now - 60000;
  const list = (hits.get(ip) || []).filter((t) => t > windowStart);
  list.push(now);
  hits.set(ip, list);
  return list.length > 20;
}

async function getUserIdFromBearer(req) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: auth, apikey: SUPABASE_SERVICE_KEY }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.id ? data.id : null;
  } catch (e) {
    return null;
  }
}

function clip(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

module.exports = async (req, res) => {
  // Every call writes a row, into a table that already grows without bound.
  // A loop here fills the database and buries real errors in the admin panel.
  // 30/min is far above what a broken page produces and far below a flood.
  if (require('./lib/rate-limit').tooMany(req, res, 'log-error', 30, 60000)) return;

  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many reports' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const message = clip(body.message, 1000);
  if (!message) {
    return res.status(400).json({ error: 'message required' });
  }

  const userId = await getUserIdFromBearer(req);

  const row = {
    user_id: userId,
    page: clip(body.page, 300),
    message: message,
    stack: clip(body.stack, 5000),
    user_agent: clip(req.headers['user-agent'], 400),
    app_version: clip(body.app_version, 40)
  };

  const ins = await fetch(SUPABASE_URL + '/rest/v1/client_errors', {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  });

  if (!ins.ok) {
    return res.status(500).json({ error: 'Failed to store' });
  }
  return res.status(204).end();
};
