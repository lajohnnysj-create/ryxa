// Vercel serverless function - Facebook Select Page (finalize picker)
// =====================================================================
// Finalizes the Page the user chose in the dashboard picker. Reads the stored
// long-lived USER token, re-lists the user's Pages server-side, finds the
// chosen page_id, encrypts that Page's access token, and writes the page
// fields onto the connection row. The page token is fetched here (server-side)
// and never travels through the client.
//
// Deploy to: /api/facebook-select-page.js
// Endpoint:  POST https://ryxa.io/api/facebook-select-page
// Header:    Authorization: Bearer <supabase-jwt>
// Body:      { "page_id": "<id from facebook-pages>" }
// =====================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GRAPH = 'https://graph.facebook.com/v22.0';
const { encryptToken, decryptToken } = require('./lib/token-crypto');

async function verifySupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + accessToken, apikey: SUPABASE_SERVICE_KEY }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.id ? data.id : null;
  } catch (e) {
    console.error('verifySupabaseUser failed:', e.message);
    return null;
  }
}

function readBody(req) {
  return new Promise(function (resolve) {
    if (req.body) {
      if (typeof req.body === 'object') return resolve(req.body);
      try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve({}); }
    }
    let data = '';
    req.on('data', function (c) { data += c; });
    req.on('end', function () { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', function () { resolve({}); });
  });
}

async function fetchUserToken(userId) {
  const url = SUPABASE_URL + '/rest/v1/facebook_connections?user_id=eq.' +
    encodeURIComponent(userId) + '&select=user_access_token&limit=1';
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY }
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows && rows.length ? rows[0] : null;
}

async function fetchPages(userToken) {
  const fields = 'id,name,access_token,followers_count,fan_count,picture{url}';
  const res = await fetch(
    GRAPH + '/me/accounts?fields=' + encodeURIComponent(fields) +
    '&limit=100&access_token=' + encodeURIComponent(userToken)
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Pages fetch failed: ' + res.status + ' ' + err);
  }
  const data = await res.json();
  return Array.isArray(data.data) ? data.data : [];
}

async function updatePage(userId, fields) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/facebook_connections?user_id=eq.' + encodeURIComponent(userId),
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(fields)
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Update failed: ' + res.status + ' ' + err);
  }
  return res.json();
}

module.exports = async function handler(req, res) {
  // Per-IP rate limit: 10 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'fb-select-page', 10, 60000)) return;

  res.setHeader('Access-Control-Allow-Origin', 'https://ryxa.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ ok: false, error: 'Server not configured' });

  const authHeader = req.headers.authorization || '';
  const userId = await verifySupabaseUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (!userId) return res.status(401).json({ ok: false, error: 'Not authenticated' });

  const body = await readBody(req);
  const pageId = body && body.page_id ? String(body.page_id) : null;
  if (!pageId) return res.status(400).json({ ok: false, error: 'Missing page_id' });

  const conn = await fetchUserToken(userId);
  if (!conn || !conn.user_access_token) {
    return res.status(404).json({ ok: false, error: 'Not connected to Facebook' });
  }

  let userToken;
  try {
    userToken = decryptToken(conn.user_access_token);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Stored token unreadable, please reconnect' });
  }

  let pages;
  try {
    pages = await fetchPages(userToken);
  } catch (e) {
    console.error('facebook-select-page fetch failed:', e.message);
    return res.status(502).json({ ok: false, error: 'Could not read your Pages' });
  }

  // Must match a Page the user actually administers (prevents picking a Page
  // they don't control by passing an arbitrary id).
  const page = pages.find(function (p) { return String(p.id) === pageId; });
  if (!page || !page.access_token) {
    return res.status(400).json({ ok: false, error: 'That Page is not available on your account' });
  }

  try {
    await updatePage(userId, {
      fb_page_id: String(page.id),
      fb_page_name: page.name || null,
      page_access_token: encryptToken(page.access_token),
      followers_count: Number(page.followers_count) || null,
      fan_count: Number(page.fan_count) || null,
      profile_picture_url: (page.picture && page.picture.data && page.picture.data.url) || null,
      last_refreshed_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('facebook-select-page update failed:', e.message);
    return res.status(500).json({ ok: false, error: 'Could not save your Page' });
  }

  return res.status(200).json({
    ok: true,
    page: { id: String(page.id), name: page.name || '', followers_count: Number(page.followers_count) || 0 }
  });
};
