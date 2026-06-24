// /api/youtube-oauth-callback.js
//
// Handles Google's redirect after the user grants/denies YouTube consent.
//
// Flow:
//   1. Verify the state cookie matches the HMAC-signed state param (CSRF).
//   2. Exchange the auth code for access_token + refresh_token.
//   3. Fetch the channel identity + basic statistics (Data API v3).
//   4. Encrypt both tokens and upsert into youtube_connections.
//   5. Redirect back to the dashboard with a success/error flag.
//
// The rich 30-day metrics and demographics (YouTube Analytics API) are pulled
// separately by the YouTube fetch helper, mirroring how Instagram's callback
// stores identity + basic stats and the fetch helper does the heavy data.
//
// Tokens are AES-256-GCM encrypted at rest via lib/token-crypto. Plaintext
// tokens never touch the database.

const crypto = require('crypto');
const { encryptToken } = require('./lib/token-crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const YT_REDIRECT_URI = process.env.YT_OAUTH_REDIRECT_URI;
const TICKET_SIGNING_SECRET = process.env.YT_TICKET_SIGNING_SECRET;

const DASHBOARD_URL = 'https://ryxa.io/dashboard.html';

// State token TTL: reject states older than 10 minutes.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Must match the prefix in youtube-oauth-start.js getStateSigningKey().
function getStateSigningKey() {
  return crypto.createHash('sha256').update('ryxa_yt_state_' + TICKET_SIGNING_SECRET).digest();
}

// Verify HMAC-signed state and return { uid, n, ts }, or null on any failure.
function verifyState(stateRaw) {
  if (!stateRaw) return null;
  try {
    const decoded = Buffer.from(String(stateRaw), 'base64url').toString('utf8');
    const wrapper = JSON.parse(decoded);
    if (!wrapper || !wrapper.p || !wrapper.h) return null;

    const payloadStr = wrapper.p;
    const receivedHmac = wrapper.h;
    const expectedHmac = crypto
      .createHmac('sha256', getStateSigningKey())
      .update(payloadStr)
      .digest('hex');

    if (
      receivedHmac.length !== expectedHmac.length ||
      !crypto.timingSafeEqual(
        Buffer.from(receivedHmac, 'hex'),
        Buffer.from(expectedHmac, 'hex')
      )
    ) {
      console.error('YouTube state HMAC mismatch');
      return null;
    }

    const payload = JSON.parse(payloadStr);
    if (!payload || !payload.uid || !payload.n || !payload.ts) return null;

    const age = Date.now() - Number(payload.ts);
    if (!isFinite(age) || age < 0 || age > STATE_MAX_AGE_MS) {
      console.error('YouTube state expired, age:', age);
      return null;
    }

    return payload;
  } catch (e) {
    console.error('YouTube verifyState failed:', e.message);
    return null;
  }
}

function redirectWithFlag(res, flag, reason) {
  const url = new URL(DASHBOARD_URL);
  url.searchParams.set('youtube_status', flag);
  if (reason) url.searchParams.set('youtube_message', reason);
  res.setHeader('Set-Cookie', 'ryxa_yt_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return res.redirect(302, url.toString());
}

// Safe integer parse for the string counts the Data API returns.
function toInt(v) {
  if (v === null || v === undefined) return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !YT_REDIRECT_URI ||
      !TICKET_SIGNING_SECRET || !SUPABASE_SERVICE_KEY) {
    console.error('Missing env vars');
    return redirectWithFlag(res, 'error', 'misconfigured');
  }

  const { code, state, error: googleError } = req.query || {};

  if (googleError) {
    return redirectWithFlag(res, 'cancelled', String(googleError));
  }
  if (!code || !state) {
    return redirectWithFlag(res, 'error', 'missing_params');
  }

  // CSRF: cookie nonce must be present and match the signed state nonce.
  const cookieHeader = req.headers.cookie || '';
  const cookieMatch = cookieHeader.match(/ryxa_yt_state=([^;]+)/);
  const cookieNonce = cookieMatch ? cookieMatch[1] : null;
  if (!cookieNonce) {
    return redirectWithFlag(res, 'error', 'state_missing');
  }

  const stateData = verifyState(state);
  if (!stateData) {
    return redirectWithFlag(res, 'error', 'state_invalid');
  }
  if (stateData.n !== cookieNonce) {
    return redirectWithFlag(res, 'error', 'state_mismatch');
  }

  const userId = stateData.uid;

  // Exchange auth code for tokens.
  let tokens;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: YT_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Google token exchange failed:', tokenRes.status, errText);
      return redirectWithFlag(res, 'error', 'token_exchange_failed');
    }
    tokens = await tokenRes.json();
  } catch (e) {
    console.error('Token exchange error:', e);
    return redirectWithFlag(res, 'error', 'token_exchange_failed');
  }

  // access_type=offline + prompt=consent forces a refresh_token every time.
  if (!tokens.access_token || !tokens.refresh_token) {
    console.error('Missing tokens in Google response. Got keys:', Object.keys(tokens));
    return redirectWithFlag(res, 'error', 'incomplete_tokens');
  }

  // Fetch channel identity + basic statistics (Data API v3).
  let channel = null;
  try {
    const chRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      { headers: { Authorization: 'Bearer ' + tokens.access_token } }
    );
    if (chRes.ok) {
      const data = await chRes.json();
      channel = data && Array.isArray(data.items) && data.items.length ? data.items[0] : null;
    } else {
      const errText = await chRes.text();
      console.error('YouTube channel fetch failed:', chRes.status, errText);
    }
  } catch (e) {
    console.error('YouTube channel fetch error:', e);
  }

  // The Google account may have no YouTube channel at all.
  if (!channel || !channel.id) {
    return redirectWithFlag(res, 'error', 'no_channel');
  }

  const snippet = channel.snippet || {};
  const stats = channel.statistics || {};
  const thumb =
    (snippet.thumbnails &&
      ((snippet.thumbnails.medium && snippet.thumbnails.medium.url) ||
       (snippet.thumbnails.default && snippet.thumbnails.default.url))) || null;

  // hiddenSubscriberCount => subscriberCount is absent/unreliable; store null.
  const subscriberCount = stats.hiddenSubscriberCount ? null : toInt(stats.subscriberCount);

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  const scopesArr = tokens.scope ? String(tokens.scope).split(' ').filter(Boolean) : null;

  // Upsert. Tokens encrypted at rest; the fetch helper / refresh path decrypt
  // in-memory before calling Google. Rich 30d + demographics left null here,
  // populated by the YouTube fetch helper.
  try {
    const upsertRes = await fetch(
      SUPABASE_URL + '/rest/v1/youtube_connections?on_conflict=user_id',
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          user_id: userId,
          yt_channel_id: channel.id,
          yt_channel_title: snippet.title || null,
          yt_custom_url: snippet.customUrl || null,
          thumbnail_url: thumb,
          access_token: encryptToken(tokens.access_token),
          refresh_token: encryptToken(tokens.refresh_token),
          scopes: scopesArr,
          token_expires_at: expiresAt,
          connected_at: nowIso,
          last_refreshed_at: nowIso,
          subscriber_count: subscriberCount,
          view_count: toInt(stats.viewCount),
          video_count: toInt(stats.videoCount),
          data_last_fetched_at: nowIso,
          data_fetch_error: null,
        }),
      }
    );

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error('Supabase upsert failed:', upsertRes.status, errText);
      return redirectWithFlag(res, 'error', 'db_write_failed');
    }
  } catch (e) {
    console.error('DB write error:', e);
    return redirectWithFlag(res, 'error', 'db_write_failed');
  }

  return redirectWithFlag(res, 'connected');
};
