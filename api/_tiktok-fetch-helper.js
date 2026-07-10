// Shared TikTok data fetcher - imported by:
//   - api/tiktok-data-fetch.js   (creator-triggered, auto + manual refresh)
//   - api/tiktok-cron-refresh.js (background cron)
//
// Pulls the TikTok profile identity + headline stats (follower / following /
// likes / video counts) via the Display API user/info endpoint, computes a
// derived avg-likes-per-video, and writes everything to the tiktok_connections
// row. The public_tiktok_kit_data view exposes the safe subset automatically.
//
// TikTok access tokens expire ~24h, so this helper first ensures a fresh access
// token before any API call. IMPORTANT: TikTok ROTATES the refresh token on
// every refresh, so we persist BOTH the new access token AND the new refresh
// token (re-encrypted) plus both new expiries. No plaintext tokens leave the
// server or get written to the DB.
//
// Usage:
//   const { refreshTikTokData } = require('./_tiktok-fetch-helper.js');
//   const result = await refreshTikTokData(userId);
//   // result = { ok: true, data: {...} }  or  { ok: false, error: '...' }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;

const TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
const USERINFO_ENDPOINT = 'https://open.tiktokapis.com/v2/user/info/';
const VIDEOLIST_ENDPOINT = 'https://open.tiktokapis.com/v2/video/list/';
const VIDEOLIST_FIELDS = [
  'id', 'title', 'video_description', 'duration', 'cover_image_url',
  'embed_link', 'share_url', 'create_time', 'view_count', 'like_count', 'comment_count',
].join(',');
const RECENT_VIDEO_COUNT = 6;
const USERINFO_FIELDS = [
  'open_id', 'union_id', 'avatar_url', 'display_name',
  'profile_deep_link', 'profile_web_link', 'bio_description', 'is_verified',
  'follower_count', 'following_count', 'likes_count', 'video_count',
].join(',');

const { decryptToken, encryptToken } = require('./lib/token-crypto');

// ============================================================
// HELPERS
// ============================================================

function bearerHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

// ============================================================
// LOAD CONNECTION ROW
// ============================================================

async function loadConnection(userId) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/tiktok_connections?user_id=eq.' + encodeURIComponent(userId) +
      '&select=user_id,access_token,refresh_token,token_expires_at,refresh_expires_at,open_id',
    { headers: bearerHeaders() }
  );
  if (!res.ok) throw new Error('Failed to load connection: ' + res.status);
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

// ============================================================
// TOKEN REFRESH (TikTok access tokens expire ~24h; refresh token ROTATES)
// ============================================================
//
// Returns a usable plaintext access token. If the stored one is expired (or
// within a 5-min skew), refreshes via the refresh token, then persists the
// re-encrypted NEW access token AND NEW refresh token (TikTok rotates it) with
// both new expiries.
async function ensureFreshToken(userId, conn, _retried) {
  let accessToken;
  let refreshToken;
  try {
    accessToken = decryptToken(conn.access_token);
    refreshToken = decryptToken(conn.refresh_token);
  } catch (e) {
    throw new Error('Token decryption failed; reconnect TikTok');
  }
  if (!refreshToken) throw new Error('No refresh token stored; reconnect TikTok');

  const expMs = conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
  const skewMs = 5 * 60 * 1000;
  if (accessToken && expMs && Date.now() < expMs - skewMs) {
    return accessToken; // still valid
  }

  // Refresh.
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: new URLSearchParams({
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const text = await tokenRes.text();
  let tok;
  try { tok = JSON.parse(text); } catch { tok = null; }

  if (!tokenRes.ok || !tok || tok.error || !tok.access_token) {
    console.error('TikTok token refresh failed:', tokenRes.status, text);
    // Rotation-race recovery: TikTok refresh tokens are single-use. If a
    // parallel run (cron + a client-triggered fetch, or two overlapping
    // client calls) rotated and persisted a NEWER refresh token between our
    // row read and this exchange, the token we just presented is the consumed
    // old one. Re-read the row; if the stored token differs from the one we
    // tried, retry ONCE with the fresh one instead of failing the run.
    if (!_retried) {
      try {
        const freshConn = await loadConnection(userId);
        if (freshConn) {
          let freshRT = null;
          try { freshRT = decryptToken(freshConn.refresh_token); } catch (e2) { freshRT = null; }
          if (freshRT && freshRT !== refreshToken) {
            console.error('TikTok refresh: stored token changed mid-flight; retrying with the newer one.');
            return await ensureFreshToken(userId, freshConn, true);
          }
        }
      } catch (e3) {
        console.error('TikTok refresh: rotation-race re-read failed:', e3.message);
      }
    }
    throw new Error('Token refresh failed; reconnect TikTok');
  }

  const newTokenExpiry = new Date(Date.now() + (tok.expires_in || 86400) * 1000).toISOString();
  // TikTok rotates the refresh token; persist the new one if present, else keep
  // the existing one. Re-encrypt everything. Best-effort: if this write fails we
  // still return the token so this run succeeds; next run retries.
  const patch = {
    access_token: encryptToken(tok.access_token),
    token_expires_at: newTokenExpiry,
    last_refreshed_at: new Date().toISOString(),
  };
  if (tok.refresh_token) {
    patch.refresh_token = encryptToken(tok.refresh_token);
    patch.refresh_expires_at =
      new Date(Date.now() + (tok.refresh_expires_in || 365 * 24 * 3600) * 1000).toISOString();
  }
  // Persisting is NOT best-effort for TikTok: the refresh token rotates and
  // the old one is already consumed, so a lost persist permanently bricks the
  // connection (the next run presents a dead token, forever). Check the HTTP
  // status (fetch only rejects on network failure, not on 4xx/5xx), retry
  // once, and if both attempts fail, log at maximum severity so it is
  // findable in the Vercel logs before the user hits the dead-token state.
  async function persistRotatedTokens() {
    const pres = await fetch(
      SUPABASE_URL + '/rest/v1/tiktok_connections?user_id=eq.' + encodeURIComponent(userId),
      { method: 'PATCH', headers: bearerHeaders(), body: JSON.stringify(patch) }
    );
    if (!pres.ok) {
      const errText = await pres.text().catch(() => '');
      throw new Error('HTTP ' + pres.status + ' ' + errText.slice(0, 200));
    }
  }
  try {
    await persistRotatedTokens();
  } catch (e) {
    console.error('TikTok token persist attempt 1 FAILED:', e.message);
    try {
      await persistRotatedTokens();
    } catch (e2) {
      console.error(
        'CRITICAL: TikTok rotated-token persist FAILED TWICE for user ' + userId +
        '. The stored refresh token is now consumed and this connection will be ' +
        'dead on the next refresh unless the user reconnects TikTok. Error: ' + e2.message
      );
    }
  }

  return tok.access_token;
}

// ============================================================
// MAIN
// ============================================================

async function refreshTikTokData(userId) {
  if (!SUPABASE_SERVICE_KEY || !TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
    return { ok: false, error: 'Server not configured' };
  }

  const conn = await loadConnection(userId);
  if (!conn) return { ok: false, error: 'Not connected to TikTok' };

  let token;
  try {
    token = await ensureFreshToken(userId, conn);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const collected = {};
  const errors = [];

  // ---- Profile identity + headline stats (Display API user/info) ----
  try {
    const infoRes = await fetch(USERINFO_ENDPOINT + '?fields=' + encodeURIComponent(USERINFO_FIELDS), {
      headers: { Authorization: 'Bearer ' + token },
    });
    const infoText = await infoRes.text();
    let infoBody;
    try { infoBody = JSON.parse(infoText); } catch { infoBody = null; }

    const errCode = infoBody && infoBody.error && infoBody.error.code;
    if (infoRes.ok && infoBody && (errCode === 'ok' || errCode === undefined) &&
        infoBody.data && infoBody.data.user) {
      const u = infoBody.data.user;
      collected.open_id = u.open_id || conn.open_id;
      collected.union_id = u.union_id || null;
      collected.tt_display_name = u.display_name || null;
      collected.tt_avatar_url = u.avatar_url || null;
      collected.tt_profile_deep_link = u.profile_deep_link || null;
      collected.tt_profile_web_link = u.profile_web_link || null;
      collected.tt_bio_description = u.bio_description || null;
      collected.tt_is_verified = typeof u.is_verified === 'boolean' ? u.is_verified : null;
      collected.follower_count = toInt(u.follower_count);
      collected.following_count = toInt(u.following_count);
      collected.likes_count = toInt(u.likes_count);
      collected.video_count = toInt(u.video_count);
      collected.avg_likes_per_video =
        collected.likes_count != null && collected.video_count && collected.video_count > 0
          ? Math.round((collected.likes_count / collected.video_count) * 10) / 10
          : null;
    } else {
      errors.push('user_info:' + ((errCode && String(errCode)) || ('HTTP ' + infoRes.status)));
    }
  } catch (e) {
    errors.push('user_info:' + e.message);
  }

  // ---- Recent public videos (video.list scope) ----
  // Sorted newest-first by TikTok. Cover image URLs are signed and expire (~6d);
  // the cron refresh cadence keeps them live. We store metadata only.
  try {
    const vidRes = await fetch(VIDEOLIST_ENDPOINT + '?fields=' + encodeURIComponent(VIDEOLIST_FIELDS), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ max_count: RECENT_VIDEO_COUNT }),
    });
    const vidText = await vidRes.text();
    let vidBody;
    try { vidBody = JSON.parse(vidText); } catch { vidBody = null; }

    const vErr = vidBody && vidBody.error && vidBody.error.code;
    if (vidRes.ok && vidBody && (vErr === 'ok' || vErr === undefined) &&
        vidBody.data && Array.isArray(vidBody.data.videos)) {
      const profileUrl = collected.tt_profile_web_link || null;
      collected.recent_media = vidBody.data.videos.slice(0, RECENT_VIDEO_COUNT).map((v) => {
        const id = v.id ? String(v.id) : null;
        const link = v.share_url
          || (profileUrl && id ? (String(profileUrl).replace(/\/$/, '') + '/video/' + id) : (v.embed_link || null));
        return {
          id: id,
          cover: v.cover_image_url || null,
          caption: v.title || v.video_description || '',
          created: typeof v.create_time === 'number' ? v.create_time : null,
          link: link,
          duration: toInt(v.duration),
          views: toInt(v.view_count),
          likes: toInt(v.like_count),
          comments: toInt(v.comment_count),
        };
      });
    } else {
      errors.push('video_list:' + ((vErr && String(vErr)) || ('HTTP ' + vidRes.status)));
    }
  } catch (e) {
    errors.push('video_list:' + e.message);
  }

  // ---- Write ----
  collected.data_last_fetched_at = new Date().toISOString();
  collected.data_fetch_error = errors.length > 0 ? errors.join(' | ') : null;
  collected.last_refreshed_at = new Date().toISOString();

  const updateRes = await fetch(
    SUPABASE_URL + '/rest/v1/tiktok_connections?user_id=eq.' + encodeURIComponent(userId),
    {
      method: 'PATCH',
      headers: Object.assign({}, bearerHeaders(), { Prefer: 'return=representation' }),
      body: JSON.stringify(collected),
    }
  );

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    return { ok: false, error: 'DB write failed: ' + errText };
  }

  const updated = await updateRes.json();
  return { ok: true, data: updated[0] || collected };
}

module.exports = { refreshTikTokData };
