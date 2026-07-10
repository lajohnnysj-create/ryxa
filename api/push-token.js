// POST   /api/push-token  { token, platform }  registers this device for push
// DELETE /api/push-token  { token }            removes this device
//
// Auth: Supabase access token as Bearer header. The user id is ALWAYS derived
// from the verified token, never from the request body.
//
// Copy this file into the Ryxa repo at api/push-token.js.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getUserIdFromBearer(req) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    const accessToken = auth.slice(7);
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + accessToken, apikey: SUPABASE_SERVICE_KEY }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.id ? data.id : null;
  } catch (e) {
    return null;
  }
}

function isValidExpoToken(token) {
  return (
    typeof token === 'string' &&
    token.length < 200 &&
    /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(token)
  );
}

module.exports = async (req, res) => {
  // Authenticated, but a token upsert loop is still a write loop.
  if (require('./lib/rate-limit').tooMany(req, res, 'push-token', 20, 60000)) return;

  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const userId = await getUserIdFromBearer(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const token = body.token;

  if (!isValidExpoToken(token)) {
    return res.status(400).json({ error: 'Invalid push token' });
  }

  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json'
  };

  if (req.method === 'DELETE') {
    const del = await fetch(
      SUPABASE_URL +
        '/rest/v1/push_tokens?user_id=eq.' +
        userId +
        '&token=eq.' +
        encodeURIComponent(token),
      { method: 'DELETE', headers }
    );
    if (!del.ok) return res.status(500).json({ error: 'Failed to remove token' });
    return res.status(200).json({ ok: true });
  }

  const platform = body.platform === 'android' ? 'android' : 'ios';

  // Upsert on the unique token column. If a device changes owners
  // (logout, login as someone else), the row moves to the new user.
  const upsert = await fetch(
    SUPABASE_URL + '/rest/v1/push_tokens?on_conflict=token',
    {
      method: 'POST',
      headers: {
        ...headers,
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        user_id: userId,
        token: token,
        platform: platform,
        updated_at: new Date().toISOString()
      })
    }
  );

  if (!upsert.ok) {
    return res.status(500).json({ error: 'Failed to register token' });
  }
  return res.status(200).json({ ok: true });
};
