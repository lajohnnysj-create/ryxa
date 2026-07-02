// Vercel serverless function - Facebook Pages (picker list)
// ===========================================================
// Returns the list of Pages the connected user administers, so the dashboard
// can show a Page picker. Uses the long-lived USER token stored during the
// OAuth callback. IMPORTANT: page access tokens are NEVER returned to the
// client; only display fields (id, name, follower counts, picture).
//
// Deploy to: /api/facebook-pages.js
// Endpoint:  POST https://ryxa.io/api/facebook-pages
// Header:    Authorization: Bearer <supabase-jwt>
// ===========================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GRAPH = 'https://graph.facebook.com/v22.0';
const { decryptToken } = require('./lib/token-crypto');

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
  const fields = 'id,name,followers_count,fan_count,picture{url}';
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://ryxa.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ ok: false, error: 'Server not configured' });

  const authHeader = req.headers.authorization || '';
  const userId = await verifySupabaseUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (!userId) return res.status(401).json({ ok: false, error: 'Not authenticated' });

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
    console.error('facebook-pages failed:', e.message);
    return res.status(502).json({ ok: false, error: 'Could not read your Pages' });
  }

  // Strip tokens; return only what the picker needs to display.
  const safe = pages.map(function (p) {
    return {
      id: String(p.id),
      name: p.name || '',
      followers_count: Number(p.followers_count) || 0,
      fan_count: Number(p.fan_count) || 0,
      picture_url: (p.picture && p.picture.data && p.picture.data.url) || null
    };
  });

  return res.status(200).json({ ok: true, pages: safe });
};
