// Vercel serverless function - Facebook Token Refresh (background)
// =====================================================================
// Called daily by Supabase pg_cron. Finds facebook_connections whose
// long-lived USER token (~60 day life) is within REFRESH_WINDOW_DAYS of
// expiry and still valid, re-extends it via fb_exchange_token, then
// re-derives the PAGE token from /me/accounts (page tokens follow the user
// token). Both are re-encrypted and written back with the new expiry.
//
// Mirrors instagram-token-refresh.js. Authenticated via X-Cron-Secret.
//
// Endpoint: POST https://www.ryxa.io/api/facebook-token-refresh
// Header:   X-Cron-Secret: <secret>
// Returns { ok, refreshed, failed, total }
// =====================================================================

const { encryptToken, decryptToken } = require('./lib/token-crypto.js');
const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const GRAPH = 'https://graph.facebook.com/v22.0';

const REFRESH_WINDOW_DAYS = 10;
const MAX_REFRESHES_PER_RUN = 100;

function bearerHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json'
  };
}

// Extend the long-lived user token another ~60 days.
async function extendUserToken(userToken) {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: FACEBOOK_APP_ID,
    client_secret: FACEBOOK_APP_SECRET,
    fb_exchange_token: userToken
  });
  const res = await fetch(GRAPH + '/oauth/access_token?' + params.toString());
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error((body.error && body.error.message) || ('HTTP ' + res.status));
  }
  return body; // { access_token, expires_in }
}

// Re-derive the token for the connection's chosen Page from the fresh user token.
async function derivePageToken(userToken, pageId) {
  const res = await fetch(
    GRAPH + '/me/accounts?fields=id,access_token&limit=100&access_token=' + encodeURIComponent(userToken)
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.error && body.error.message) || ('HTTP ' + res.status));
  const pages = Array.isArray(body.data) ? body.data : [];
  const match = pages.find(p => String(p.id) === String(pageId));
  return match && match.access_token ? match.access_token : null;
}

module.exports = async function handler(req, res) {
  // Per-IP rate limit: 6 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'fb-refresh', 6, 60000)) return;

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!CRON_SECRET) return res.status(500).json({ ok: false, error: 'Cron secret not configured' });
  const provided = req.headers['x-cron-secret'] || req.headers['X-Cron-Secret'] || '';
  let validSecret = false;
  try {
    const a = Buffer.from(String(provided));
    const b = Buffer.from(CRON_SECRET);
    validSecret = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { validSecret = false; }
  if (!validSecret) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    return res.status(500).json({ ok: false, error: 'Facebook app credentials not configured' });
  }

  // Rows expiring within the window (still valid). NULL expiries are left alone.
  const nowIso = new Date().toISOString();
  const windowIso = new Date(Date.now() + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const listRes = await fetch(
    SUPABASE_URL + '/rest/v1/facebook_connections?token_expires_at=gte.' + encodeURIComponent(nowIso) +
    '&token_expires_at=lte.' + encodeURIComponent(windowIso) +
    '&select=user_id,user_access_token,fb_page_id&limit=' + MAX_REFRESHES_PER_RUN,
    { headers: bearerHeaders() }
  );
  if (!listRes.ok) {
    return res.status(500).json({ ok: false, error: 'List failed: ' + listRes.status });
  }
  const rows = await listRes.json();

  let refreshed = 0, failed = 0;
  for (const row of rows) {
    try {
      const userToken = decryptToken(row.user_access_token);
      const extended = await extendUserToken(userToken);
      const newUserToken = extended.access_token;
      const expiresIn = Number(extended.expires_in) || 60 * 24 * 60 * 60;
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      const patch = {
        user_access_token: encryptToken(newUserToken),
        token_expires_at: expiresAt,
        last_refreshed_at: new Date().toISOString()
      };
      // Re-derive the page token if a Page is selected (best-effort).
      if (row.fb_page_id) {
        const pageToken = await derivePageToken(newUserToken, row.fb_page_id);
        if (pageToken) patch.page_access_token = encryptToken(pageToken);
      }

      const upRes = await fetch(
        SUPABASE_URL + '/rest/v1/facebook_connections?user_id=eq.' + encodeURIComponent(row.user_id),
        { method: 'PATCH', headers: bearerHeaders(), body: JSON.stringify(patch) }
      );
      if (!upRes.ok) throw new Error('PATCH ' + upRes.status);
      refreshed++;
    } catch (e) {
      console.error('FB refresh failed for user', row.user_id, e.message);
      failed++;
    }
  }

  return res.status(200).json({ ok: true, refreshed: refreshed, failed: failed, total: rows.length });
};
