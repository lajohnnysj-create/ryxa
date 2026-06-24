// /api/tiktok-oauth-callback.js
//
// Handles TikTok's redirect after the user grants/denies consent.
// Served at the locked redirect URI https://ryxa.io/auth/tiktok/callback via a
// vercel.json rewrite (apex 308s to www; the rewrite maps the path here).
//
// Flow:
//   1. Verify the state cookie matches the HMAC-signed state param (CSRF).
//   2. Exchange the auth code for access_token + refresh_token.
//   3. Fetch the profile identity + headline stats (Display API user/info).
//   4. Encrypt both tokens and upsert into tiktok_connections.
//   5. Redirect back to the dashboard with a success/error flag.
//
// TikTok specifics:
//   - Token endpoint returns FLAT JSON (access_token, refresh_token, open_id,
//     expires_in, refresh_expires_in, scope, token_type).
//   - The refresh_token ROTATES on every refresh; the fetch helper persists the
//     new one each time. (Here at connect we just store the first pair.)
//   - user/info returns { data: { user }, error: { code, message } }.
//
// Tokens are AES-256-GCM encrypted at rest via lib/token-crypto. Plaintext
// tokens never touch the database.

const crypto = require('crypto');
const { encryptToken } = require('./lib/token-crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_OAUTH_REDIRECT_URI;
const TICKET_SIGNING_SECRET = process.env.TIKTOK_TICKET_SIGNING_SECRET;

const DASHBOARD_URL = 'https://ryxa.io/dashboard.html';

const TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
const USERINFO_ENDPOINT = 'https://open.tiktokapis.com/v2/user/info/';
const USERINFO_FIELDS = [
  'open_id', 'union_id', 'avatar_url', 'display_name',
  'profile_deep_link', 'profile_web_link', 'bio_description', 'is_verified',
  'follower_count', 'following_count', 'likes_count', 'video_count',
].join(',');

// State token TTL: reject states older than 10 minutes.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Must match the prefix in tiktok-oauth-start.js getStateSigningKey().
function getStateSigningKey() {
  return crypto.createHash('sha256').update('ryxa_tt_state_' + TICKET_SIGNING_SECRET).digest();
}

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
      console.error('TikTok state HMAC mismatch');
      return null;
    }

    const payload = JSON.parse(payloadStr);
    if (!payload || !payload.uid || !payload.n || !payload.ts) return null;

    const age = Date.now() - Number(payload.ts);
    if (!isFinite(age) || age < 0 || age > STATE_MAX_AGE_MS) {
      console.error('TikTok state expired, age:', age);
      return null;
    }

    return payload;
  } catch (e) {
    console.error('TikTok verifyState failed:', e.message);
    return null;
  }
}

function redirectWithFlag(res, flag, reason) {
  const url = new URL(DASHBOARD_URL);
  url.searchParams.set('tiktok_status', flag);
  if (reason) url.searchParams.set('tiktok_message', reason);
  res.setHeader('Set-Cookie', 'ryxa_tt_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return res.redirect(302, url.toString());
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET || !TIKTOK_REDIRECT_URI ||
      !TICKET_SIGNING_SECRET || !SUPABASE_SERVICE_KEY) {
    console.error('Missing env vars');
    return redirectWithFlag(res, 'error', 'misconfigured');
  }

  const { code, state, error: ttError } = req.query || {};

  if (ttError) {
    return redirectWithFlag(res, 'cancelled', String(ttError));
  }
  if (!code || !state) {
    return redirectWithFlag(res, 'error', 'missing_params');
  }

  // CSRF: cookie nonce must be present and match the signed state nonce.
  const cookieHeader = req.headers.cookie || '';
  const cookieMatch = cookieHeader.match(/ryxa_tt_state=([^;]+)/);
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

  // Exchange auth code for tokens (flat JSON response).
  let tokens;
  try {
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code: String(code),
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_REDIRECT_URI,
      }),
    });

    const tokenText = await tokenRes.text();
    try { tokens = JSON.parse(tokenText); } catch { tokens = null; }

    if (!tokenRes.ok || !tokens || tokens.error) {
      // tokens.error is TikTok's error code string (e.g. invalid_request);
      // never reflect tokens.error_description into the client redirect.
      console.error('TikTok token exchange failed:', tokenRes.status, tokenText);
      return redirectWithFlag(res, 'error', 'token_exchange_failed');
    }
  } catch (e) {
    console.error('Token exchange error:', e);
    return redirectWithFlag(res, 'error', 'token_exchange_failed');
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    console.error('Missing tokens in TikTok response. Got keys:', Object.keys(tokens));
    return redirectWithFlag(res, 'error', 'incomplete_tokens');
  }

  // Fetch profile identity + headline stats (Display API user/info).
  let user = null;
  try {
    const infoRes = await fetch(USERINFO_ENDPOINT + '?fields=' + encodeURIComponent(USERINFO_FIELDS), {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
    });
    const infoText = await infoRes.text();
    let infoBody;
    try { infoBody = JSON.parse(infoText); } catch { infoBody = null; }

    const errCode = infoBody && infoBody.error && infoBody.error.code;
    if (infoRes.ok && infoBody && (errCode === 'ok' || errCode === undefined) &&
        infoBody.data && infoBody.data.user) {
      user = infoBody.data.user;
    } else {
      console.error('TikTok user/info fetch failed:', infoRes.status, infoText);
    }
  } catch (e) {
    console.error('TikTok user/info error:', e);
  }

  if (!user || !user.open_id) {
    return redirectWithFlag(res, 'error', 'no_profile');
  }

  const nowIso = new Date().toISOString();
  const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in || 86400) * 1000).toISOString();
  const refreshExpiresAt = new Date(Date.now() + (tokens.refresh_expires_in || 365 * 24 * 3600) * 1000).toISOString();
  const scopesArr = tokens.scope ? String(tokens.scope).split(',').map((s) => s.trim()).filter(Boolean) : null;

  const followerCount = toInt(user.follower_count);
  const likesCount = toInt(user.likes_count);
  const videoCount = toInt(user.video_count);
  const avgLikesPerVideo =
    likesCount != null && videoCount && videoCount > 0
      ? Math.round((likesCount / videoCount) * 10) / 10
      : null;

  try {
    const upsertRes = await fetch(
      SUPABASE_URL + '/rest/v1/tiktok_connections?on_conflict=user_id',
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
          open_id: user.open_id,
          union_id: user.union_id || null,
          tt_display_name: user.display_name || null,
          tt_avatar_url: user.avatar_url || null,
          tt_profile_deep_link: user.profile_deep_link || null,
          tt_profile_web_link: user.profile_web_link || null,
          tt_bio_description: user.bio_description || null,
          tt_is_verified: typeof user.is_verified === 'boolean' ? user.is_verified : null,
          access_token: encryptToken(tokens.access_token),
          refresh_token: encryptToken(tokens.refresh_token),
          scopes: scopesArr,
          token_expires_at: tokenExpiresAt,
          refresh_expires_at: refreshExpiresAt,
          connected_at: nowIso,
          last_refreshed_at: nowIso,
          follower_count: followerCount,
          following_count: toInt(user.following_count),
          likes_count: likesCount,
          video_count: videoCount,
          avg_likes_per_video: avgLikesPerVideo,
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
