// Shared YouTube data fetcher - imported by:
//   - api/youtube-data-fetch.js   (creator-triggered, auto + manual refresh)
//   - api/youtube-cron-refresh.js (background cron)
//
// Pulls channel stats (Data API v3), 30-day performance + owner demographics
// (YouTube Analytics API), and recent uploads. Calculates derived metrics
// (engagement rate, avg views per video) server-side. Writes everything to the
// youtube_connections row for the given user; the public_youtube_kit_data view
// exposes the safe subset automatically.
//
// Google access tokens expire ~hourly, so unlike Instagram this helper first
// ensures a fresh access token (refreshing via the stored refresh token and
// re-encrypting at rest) before any API call. No plaintext tokens leave the
// server or get written to the DB.
//
// Usage:
//   const { refreshYouTubeData } = require('./_youtube-fetch-helper.js');
//   const result = await refreshYouTubeData(userId);
//   // result = { ok: true, data: {...} }  or  { ok: false, error: '...' }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

const DATA_API_BASE = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS_API_BASE = 'https://youtubeanalytics.googleapis.com/v2/reports';

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

function avg(nums) {
  const valid = nums.filter((n) => typeof n === 'number' && !isNaN(n));
  if (valid.length === 0) return null;
  const sum = valid.reduce((a, b) => a + b, 0);
  return Math.round((sum / valid.length) * 10) / 10;
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// GET a Data API v3 endpoint with the user's OAuth token. Throw with context.
async function ytData(path, accessToken, params) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(DATA_API_BASE + path + qs, {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    const errMsg = (body && body.error && body.error.message) || ('HTTP ' + res.status);
    const err = new Error(errMsg);
    err.status = res.status;
    throw err;
  }
  return body;
}

// GET a YouTube Analytics report with the user's OAuth token. Throw with context.
async function ytAnalytics(accessToken, query) {
  const params = new URLSearchParams(Object.assign({ ids: 'channel==MINE' }, query));
  const res = await fetch(ANALYTICS_API_BASE + '?' + params.toString(), {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    const errMsg = (body && body.error && body.error.message) || ('HTTP ' + res.status);
    const err = new Error(errMsg);
    err.status = res.status;
    throw err;
  }
  return body;
}

// Convert Analytics rows into the { keys: [...], value } shape Instagram uses,
// so the Media Kit render helpers (buildBarList) work unchanged. dimCount is
// how many leading columns are dimension keys; the value is the last column.
function rowsToKeyed(report, dimCount) {
  if (!report || !Array.isArray(report.rows)) return null;
  const out = report.rows
    .map((r) => {
      const keys = r.slice(0, dimCount).map((k) => String(k));
      const value = Number(r[r.length - 1]) || 0;
      return { keys, value };
    })
    .filter((x) => x.value !== 0);
  return out.length ? out : null;
}

// ============================================================
// LOAD CONNECTION ROW
// ============================================================

async function loadConnection(userId) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/youtube_connections?user_id=eq.' + encodeURIComponent(userId) +
      '&select=user_id,access_token,refresh_token,token_expires_at,yt_channel_id',
    { headers: bearerHeaders() }
  );
  if (!res.ok) throw new Error('Failed to load connection: ' + res.status);
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

// ============================================================
// TOKEN REFRESH (Google access tokens expire ~hourly)
// ============================================================
//
// Returns a usable plaintext access token. If the stored one is expired (or
// within a 60s skew), refreshes via the refresh token, re-encrypts the new
// access token at rest, and persists it with the new expiry. The refresh
// token itself is unchanged by Google on refresh, so it is left as-is.
async function ensureFreshToken(userId, conn) {
  let accessToken;
  let refreshToken;
  try {
    accessToken = decryptToken(conn.access_token);
    refreshToken = decryptToken(conn.refresh_token);
  } catch (e) {
    throw new Error('Token decryption failed; reconnect YouTube');
  }
  if (!refreshToken) throw new Error('No refresh token stored; reconnect YouTube');

  const expMs = conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
  const skewMs = 60 * 1000;
  if (accessToken && expMs && Date.now() < expMs - skewMs) {
    return accessToken; // still valid
  }

  // Refresh.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('YouTube token refresh failed:', tokenRes.status, errText);
    throw new Error('Token refresh failed; reconnect YouTube');
  }
  const tok = await tokenRes.json();
  if (!tok.access_token) throw new Error('Refresh returned no access token; reconnect YouTube');

  const newExpiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
  // Persist the re-encrypted access token + new expiry. Best-effort: if this
  // write fails we still return the token so this run succeeds; next run retries.
  try {
    await fetch(
      SUPABASE_URL + '/rest/v1/youtube_connections?user_id=eq.' + encodeURIComponent(userId),
      {
        method: 'PATCH',
        headers: bearerHeaders(),
        body: JSON.stringify({
          access_token: encryptToken(tok.access_token),
          token_expires_at: newExpiry,
          last_refreshed_at: new Date().toISOString(),
        }),
      }
    );
  } catch (e) {
    console.error('Persisting refreshed token failed (non-fatal):', e.message);
  }

  return tok.access_token;
}

// ============================================================
// MAIN
// ============================================================

async function refreshYouTubeData(userId) {
  if (!SUPABASE_SERVICE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return { ok: false, error: 'Server not configured' };
  }

  const conn = await loadConnection(userId);
  if (!conn) return { ok: false, error: 'Not connected to YouTube' };

  let token;
  try {
    token = await ensureFreshToken(userId, conn);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const collected = {};
  const errors = [];

  // ---- 1. Channel basics (Data API v3): identity + lifetime stats + uploads
  let uploadsPlaylistId = null;
  try {
    const chResp = await ytData('/channels', token, {
      part: 'snippet,statistics,contentDetails',
      mine: 'true',
    });
    const ch = chResp && Array.isArray(chResp.items) && chResp.items.length ? chResp.items[0] : null;
    if (ch) {
      const snippet = ch.snippet || {};
      const stats = ch.statistics || {};
      collected.yt_channel_id = ch.id || conn.yt_channel_id;
      collected.yt_channel_title = snippet.title || null;
      collected.yt_custom_url = snippet.customUrl || null;
      collected.thumbnail_url =
        (snippet.thumbnails &&
          ((snippet.thumbnails.medium && snippet.thumbnails.medium.url) ||
           (snippet.thumbnails.default && snippet.thumbnails.default.url))) || null;
      collected.subscriber_count = stats.hiddenSubscriberCount ? null : toInt(stats.subscriberCount);
      collected.view_count = toInt(stats.viewCount);
      collected.video_count = toInt(stats.videoCount);
      uploadsPlaylistId =
        (ch.contentDetails &&
          ch.contentDetails.relatedPlaylists &&
          ch.contentDetails.relatedPlaylists.uploads) || null;
    } else {
      errors.push('channel:no channel on this Google account');
    }
  } catch (e) {
    errors.push('channel:' + e.message);
  }

  // ---- 2. 30-day performance (Analytics API) ----
  const endDate = ymd(new Date());
  const startDate = ymd(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  try {
    const report = await ytAnalytics(token, {
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,likes,comments,shares',
    });
    const row = report && Array.isArray(report.rows) && report.rows.length ? report.rows[0] : null;
    if (row) {
      const views = Number(row[0]) || 0;
      const likes = Number(row[4]) || 0;
      const comments = Number(row[5]) || 0;
      const shares = Number(row[6]) || 0;
      collected.views_30d = toInt(row[0]);
      collected.watch_time_minutes_30d = toInt(row[1]);
      collected.avg_view_duration_seconds = row[2] != null ? Math.round(Number(row[2]) * 10) / 10 : null;
      collected.subscribers_gained_30d = toInt(row[3]);
      collected.likes_30d = toInt(row[4]);
      collected.comments_30d = toInt(row[5]);
      collected.shares_30d = toInt(row[6]);
      // Engagement rate over the window: (likes + comments + shares) / views.
      collected.engagement_rate =
        views > 0 ? Math.round(((likes + comments + shares) / views) * 1000) / 10 : null;
    }
  } catch (e) {
    errors.push('analytics_30d:' + e.message);
  }

  // ---- 3. Demographics (Analytics API, owner-only) ----
  // Gender + age/gender use viewerPercentage. Countries use views (the Media
  // Kit bar helper converts raw values to percentages), top 10 by views.
  try {
    const genderReport = await ytAnalytics(token, {
      startDate, endDate, metrics: 'viewerPercentage', dimensions: 'gender',
    });
    collected.demographics_gender = rowsToKeyed(genderReport, 1);
  } catch (e) {
    errors.push('demographics_gender:' + e.message);
  }

  try {
    const ageGenderReport = await ytAnalytics(token, {
      startDate, endDate, metrics: 'viewerPercentage', dimensions: 'ageGroup,gender',
    });
    collected.demographics_age_gender = rowsToKeyed(ageGenderReport, 2);
  } catch (e) {
    errors.push('demographics_age_gender:' + e.message);
  }

  try {
    const countryReport = await ytAnalytics(token, {
      startDate, endDate, metrics: 'views', dimensions: 'country',
      sort: '-views', maxResults: '10',
    });
    collected.demographics_top_countries = rowsToKeyed(countryReport, 1);
  } catch (e) {
    errors.push('demographics_country:' + e.message);
  }

  // ---- 4. Recent uploads + avg views per video (Data API v3) ----
  if (uploadsPlaylistId) {
    try {
      const playlist = await ytData('/playlistItems', token, {
        part: 'contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: '10',
      });
      const videoIds = (playlist.items || [])
        .map((it) => it.contentDetails && it.contentDetails.videoId)
        .filter(Boolean);

      if (videoIds.length) {
        const vids = await ytData('/videos', token, {
          part: 'snippet,statistics',
          id: videoIds.join(','),
        });
        const items = vids.items || [];
        const recent = items.map((v) => {
          const sn = v.snippet || {};
          const st = v.statistics || {};
          return {
            id: v.id,
            title: sn.title || '',
            thumbnail:
              (sn.thumbnails &&
                ((sn.thumbnails.medium && sn.thumbnails.medium.url) ||
                 (sn.thumbnails.default && sn.thumbnails.default.url))) || null,
            published: sn.publishedAt || null,
            views: toInt(st.viewCount),
            likes: toInt(st.likeCount),
            comments: toInt(st.commentCount),
          };
        });
        collected.recent_media = recent;
        collected.avg_views_per_video = avg(recent.map((r) => r.views).filter((n) => n != null));
      }
    } catch (e) {
      errors.push('recent_media:' + e.message);
    }
  }

  // ---- 5. Write ----
  collected.data_last_fetched_at = new Date().toISOString();
  collected.data_fetch_error = errors.length > 0 ? errors.join(' | ') : null;
  collected.last_refreshed_at = new Date().toISOString();

  const updateRes = await fetch(
    SUPABASE_URL + '/rest/v1/youtube_connections?user_id=eq.' + encodeURIComponent(userId),
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

module.exports = { refreshYouTubeData };
