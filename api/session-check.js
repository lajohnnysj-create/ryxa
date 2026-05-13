// Vercel serverless function - Hub-only single-active-session check.
//
// POST /api/session-check
// Headers: Authorization: Bearer <user_access_token>
// Body: { session_id }
//
// Response: { active: true|false }
//   active=true  -> client's session is still the active one for this user
//   active=false -> a newer login has claimed this user; client must sign out
//
// Uses the check_hub_session SECURITY DEFINER RPC with the user's own JWT
// so auth.uid() inside the function returns the authenticated user.
//
// Hub-only: dashboard does NOT call this endpoint. By design, only Hub
// page enforces single-active-session.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

async function rpcAsUser(fnName, args, userToken) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + userToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args || {})
  });
  if (!res.ok) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Supabase RPC failed (' + res.status + '): ' + body);
  }
  return await res.json();
}

module.exports = async (req, res) => {
  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Extract bearer token without re-verifying it - the RPC will do that
    // via auth.uid(). If the token is invalid, check_hub_session returns false
    // (no auth.uid()) and the client signs out, which is the correct behavior.
    var authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      // No token -> not active.
      return res.status(200).json({ active: false });
    }
    var token = authHeader.split(' ')[1];

    var body = req.body || {};
    var sessionId = body.session_id;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(200).json({ active: false });
    }

    var result = await rpcAsUser('check_hub_session', { p_session_id: sessionId }, token);
    // PostgREST returns scalar as JSON value (true/false). Normalize.
    var active = (result === true);
    return res.status(200).json({ active: active });
  } catch (err) {
    console.error('session-check error:', err);
    // Fail closed on error: client treats this as "not active" and signs out.
    // Prevents stale clients from staying logged in if the check infrastructure
    // is broken. The user can simply log back in.
    return res.status(200).json({ active: false, error: 'check failed' });
  }
};
