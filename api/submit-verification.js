// Vercel serverless function: Submit Verification Request
// =============================================================================
// Records a creator's request for the verified badge. The applicant is
// identified from the verified Bearer token, never the body. The row is written
// to verification_requests (service role) and emailed to hello@ryxa.io for
// manual review. The Pro/Max requirement is enforced here server-side.
//
// Deploy to: /api/submit-verification.js  Endpoint: https://ryxa.io/api/submit-verification
// =============================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const NOTIFICATION_TO = 'hello@ryxa.io';
const NOTIFICATION_FROM = 'Ryxa <no-reply@ryxa.io>';

const ALLOWED_METHODS = ['profile_link', 'connected_account'];
const MAX_NAME = 60;
const MAX_HANDLE = 80;
const MAX_URL = 300;

function svcHeaders(extra) {
  return Object.assign({
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
  }, extra || {});
}

async function verifySupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + accessToken, apikey: SUPABASE_SERVICE_KEY }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.id ? data : null;
  } catch (e) {
    console.error('verifySupabaseUser failed:', e.message);
    return null;
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Server-side Pro/Max check via the existing public view (tier lives there).
async function getUserTier(uid) {
  try {
    const url = SUPABASE_URL + '/rest/v1/public_profile_tiers?user_id=eq.' +
      encodeURIComponent(uid) + '&select=tier';
    const res = await fetch(url, { headers: svcHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows && rows[0] ? rows[0].tier : null;
  } catch (e) {
    console.error('getUserTier failed:', e.message);
    return null;
  }
}

// Resolve the user's OAuth-verified Instagram handle (the trustworthy value,
// not a typed claim). Returns the ig_username or null if none connected.
async function getInstagramHandle(uid) {
  try {
    const url = SUPABASE_URL + '/rest/v1/instagram_connections?user_id=eq.' +
      encodeURIComponent(uid) + '&select=ig_username';
    const res = await fetch(url, { headers: svcHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows && rows[0] && rows[0].ig_username ? rows[0].ig_username : null;
  } catch (e) {
    console.error('getInstagramHandle failed:', e.message);
    return null;
  }
}

async function insertRequest(row) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/verification_requests', {
    method: 'POST',
    headers: svcHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(row)
  });
  return res;
}

async function sendNotificationEmail(row, email) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('RESEND_API_KEY not set, skipping verification email'); return; }
  const isConnected = row.verification_method === 'connected_account';
  const html =
    '<h2>New verification request</h2>' +
    '<p><strong>Name:</strong> ' + escapeHtml(row.first_name) + ' ' + escapeHtml(row.last_name) + '</p>' +
    '<p><strong>Account:</strong> ' + escapeHtml(email || row.user_id) + ' (' + escapeHtml(row.user_id) + ')</p>' +
    '<p><strong>Method:</strong> ' + (isConnected ? 'Connected account (OAuth-verified Instagram)' : 'Public profile link (manual, verify the URL links back to Ryxa)') + '</p>' +
    '<p><strong>' + (isConnected ? 'Verified Instagram' : 'Social handle') + ':</strong> ' + escapeHtml(row.social_handle) + '</p>' +
    (row.profile_url ? '<p><strong>Profile URL:</strong> <a href="' + escapeHtml(row.profile_url) + '">' + escapeHtml(row.profile_url) + '</a></p>' : '') +
    '<p style="color:#666;font-size:13px;">Review, then in the SQL editor: <code>update profiles set verified=true where user_id=\'' + escapeHtml(row.user_id) + '\';</code> and set this request to approved.</p>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: NOTIFICATION_FROM,
        to: [NOTIFICATION_TO],
        subject: 'Verification request: ' + (row.first_name || '') + ' ' + (row.last_name || ''),
        html: html
      })
    });
    if (!res.ok) console.warn('Verification email failed:', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.warn('Verification email exception (non-fatal):', e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://ryxa.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  const user = await verifySupabaseUser(accessToken);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const body = req.body || {};
  const firstName = String(body.first_name || '').trim().slice(0, MAX_NAME);
  const lastName = String(body.last_name || '').trim().slice(0, MAX_NAME);
  let method = String(body.verification_method || '');
  if (ALLOWED_METHODS.indexOf(method) === -1) method = 'connected_account';
  const agreed = body.agreed === true;

  if (!firstName || !lastName) return res.status(400).json({ error: 'Please enter your first and last name.' });
  if (!agreed) return res.status(400).json({ error: 'Please confirm the agreement to continue.' });

  // Pro/Max requirement, enforced server-side.
  const tier = await getUserTier(user.id);
  if (tier !== 'monthly' && tier !== 'max') {
    return res.status(403).json({ error: 'Verification requires a Pro or Max plan.' });
  }

  // Resolve the proof depending on method.
  let socialHandle;
  let profileUrl;
  if (method === 'connected_account') {
    // Use the OAuth-verified Instagram handle, never a typed claim.
    const igHandle = await getInstagramHandle(user.id);
    if (!igHandle) {
      return res.status(400).json({ error: 'No Instagram account is connected. Connect it under Connected Accounts in Settings, then try again.' });
    }
    socialHandle = '@' + igHandle;
    profileUrl = 'https://www.instagram.com/' + igHandle + '/';
  } else {
    // profile_link: a typed handle plus the public URL that links back to Ryxa.
    socialHandle = String(body.social_handle || '').trim().slice(0, MAX_HANDLE);
    profileUrl = String(body.profile_url || '').trim().slice(0, MAX_URL);
    if (!socialHandle) return res.status(400).json({ error: 'Please enter your social handle.' });
    if (!profileUrl) return res.status(400).json({ error: 'Please include the profile URL that links back to Ryxa.' });
  }

  const row = {
    user_id: user.id,
    social_handle: socialHandle,
    first_name: firstName,
    last_name: lastName,
    verification_method: method,
    profile_url: profileUrl,
    agreed: true,
    status: 'pending'
  };

  const insertRes = await insertRequest(row);

  if (insertRes.status === 409) {
    // Unique index: an active (pending/approved) request already exists.
    return res.status(200).json({ ok: true, already_pending: true });
  }
  if (!insertRes.ok) {
    const err = await insertRes.text().catch(() => '');
    console.error('verification insert error:', insertRes.status, err);
    return res.status(500).json({ error: 'Could not submit your request. Please try again.' });
  }

  // Email is best-effort and must not fail the request.
  await sendNotificationEmail(row, user.email);

  return res.status(200).json({ ok: true });
};
