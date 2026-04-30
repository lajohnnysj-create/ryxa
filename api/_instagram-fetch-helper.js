// Shared Instagram data fetcher — imported by:
//   - api/instagram-data-fetch.js  (creator-triggered, auto + manual refresh)
//   - api/instagram-cron-refresh.js (background cron, every 3 days)
//
// Calls the Instagram Graph API to pull profile basics, 30-day insights,
// follower demographics, and recent media. Calculates derived metrics
// (avg likes, avg comments, avg reel views, engagement rate) server-side.
// Writes everything to the instagram_connections row for the given user.
//
// All Graph API calls use the long-lived access token stored in the user's
// instagram_connections row. No tokens leave the server.
//
// Usage:
//   const { refreshInstagramData } = require('./_instagram-fetch-helper.js');
//   const result = await refreshInstagramData(userId);
//   // result = { ok: true, data: {...} }  or  { ok: false, error: '...' }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GRAPH_API_BASE = 'https://graph.instagram.com/v22.0';

// ============================================================
// HELPERS
// ============================================================

function bearerHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json'
  };
}

// Fetch a Graph API endpoint, return parsed JSON or throw with context
async function ig(path, accessToken, extraParams) {
  const params = new URLSearchParams(Object.assign({ access_token: accessToken }, extraParams || {}));
  const url = GRAPH_API_BASE + path + '?' + params.toString();
  const res = await fetch(url);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    const errMsg = (body && body.error && body.error.message) || ('HTTP ' + res.status);
    const err = new Error(errMsg);
    err.code = (body && body.error && body.error.code) || null;
    err.subcode = (body && body.error && body.error.error_subcode) || null;
    err.status = res.status;
    throw err;
  }
  return body;
}

// Average a list of numbers, ignoring null/undefined; round to 1 decimal
function avg(nums) {
  const valid = nums.filter(n => typeof n === 'number' && !isNaN(n));
  if (valid.length === 0) return null;
  const sum = valid.reduce((a, b) => a + b, 0);
  return Math.round((sum / valid.length) * 10) / 10;
}

// ============================================================
// LOAD CONNECTION ROW
// ============================================================

async function loadConnection(userId) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/instagram_connections?user_id=eq.' + encodeURIComponent(userId) + '&select=user_id,access_token,ig_user_id',
    { headers: bearerHeaders() }
  );
  if (!res.ok) throw new Error('Failed to load connection: ' + res.status);
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

// ============================================================
// FETCH BLOCKS — each isolated so partial failures don't kill the whole refresh
// ============================================================

async function fetchProfile(token) {
  // Profile basics + counts. account_type, profile_picture_url updated here too
  // in case the creator changed them since OAuth.
  return ig('/me', token, {
    fields: 'id,username,account_type,profile_picture_url,name,followers_count,follows_count,media_count'
  });
}

async function fetchAccountInsights(token) {
  // 30-day account insights. metric_type=total_value returns a single rolled-up number.
  // Uses 'days_28' period (Instagram's only supported rolling-window period).
  // 'views' replaces deprecated 'impressions'.
  return ig('/me/insights', token, {
    metric: 'reach,total_interactions,views,profile_views',
    period: 'days_28',
    metric_type: 'total_value'
  });
}

async function fetchDemographics(token, breakdown) {
  // Follower demographics. Requires 100+ followers — Instagram returns an error otherwise.
  // We catch that error in the calling function and treat it as "not enough data".
  return ig('/me/insights', token, {
    metric: 'follower_demographics',
    period: 'lifetime',
    breakdown: breakdown,
    metric_type: 'total_value'
  });
}

async function fetchRecentMedia(token) {
  // Last 25 posts for averaging engagement.
  return ig('/me/media', token, {
    fields: 'id,media_type,media_product_type,like_count,comments_count,timestamp',
    limit: '25'
  });
}

async function fetchReelViews(token, mediaId) {
  // Per-reel view count. Wrapped in try/catch by caller — some reels return
  // permission errors depending on age/privacy, which is fine to skip.
  return ig('/' + mediaId + '/insights', token, {
    metric: 'ig_reels_video_view_total_count'
  });
}

async function fetchActiveStories(token) {
  // Stories expire in 24h. Returns up to ~24h worth.
  return ig('/me/stories', token, {
    fields: 'id,media_type,timestamp'
  });
}

async function fetchStoryViews(token, storyId) {
  return ig('/' + storyId + '/insights', token, { metric: 'views' });
}

// ============================================================
// PARSE INSIGHTS RESPONSE
// ============================================================

// Account-level insights come back as { data: [{ name, total_value: { value } }, ...] }
function pickInsightValue(insightsResponse, metricName) {
  if (!insightsResponse || !Array.isArray(insightsResponse.data)) return null;
  const m = insightsResponse.data.find(d => d.name === metricName);
  if (!m) return null;
  if (m.total_value && typeof m.total_value.value === 'number') return m.total_value.value;
  // Fallback for older response shapes
  if (Array.isArray(m.values) && m.values.length > 0 && typeof m.values[0].value === 'number') {
    return m.values[0].value;
  }
  return null;
}

// Demographics come back as { data: [{ name: 'follower_demographics',
//   total_value: { breakdowns: [{ dimension_keys: [...], results: [{ dimension_values: [...], value }] }] } }] }
function pickDemographics(insightsResponse) {
  if (!insightsResponse || !Array.isArray(insightsResponse.data)) return null;
  const m = insightsResponse.data[0];
  if (!m || !m.total_value || !Array.isArray(m.total_value.breakdowns)) return null;
  const bd = m.total_value.breakdowns[0];
  if (!bd || !Array.isArray(bd.results)) return null;
  // Return as array of { keys: [...], value } for easy rendering downstream
  return bd.results.map(r => ({
    keys: r.dimension_values || [],
    value: r.value
  }));
}

// ============================================================
// MAIN REFRESH FUNCTION
// ============================================================

async function refreshInstagramData(userId) {
  if (!SUPABASE_SERVICE_KEY) {
    return { ok: false, error: 'Server not configured' };
  }

  const conn = await loadConnection(userId);
  if (!conn) return { ok: false, error: 'Not connected to Instagram' };

  const token = conn.access_token;
  const collected = {};
  const errors = [];

  // ---- 1. Profile basics ----
  let profile;
  try {
    profile = await fetchProfile(token);
    collected.followers_count = profile.followers_count || null;
    collected.follows_count = profile.follows_count || null;
    collected.media_count = profile.media_count || null;
    collected.ig_username = profile.username || null;
    collected.account_type = profile.account_type || null;
    collected.profile_picture_url = profile.profile_picture_url || null;
  } catch (e) {
    return { ok: false, error: 'Profile fetch failed: ' + e.message };
  }

  // ---- 2. 30-day account insights ----
  try {
    const acct = await fetchAccountInsights(token);
    collected.reach_30d = pickInsightValue(acct, 'reach');
    collected.total_interactions_30d = pickInsightValue(acct, 'total_interactions');
    collected.views_30d = pickInsightValue(acct, 'views');
    collected.profile_views_30d = pickInsightValue(acct, 'profile_views');
  } catch (e) {
    errors.push('insights:' + e.message);
  }

  // ---- 3. Recent media + averages ----
  try {
    const media = await fetchRecentMedia(token);
    const items = (media && media.data) || [];
    collected.recent_media = items.slice(0, 25);

    const likes = items.map(m => typeof m.like_count === 'number' ? m.like_count : null);
    const comments = items.map(m => typeof m.comments_count === 'number' ? m.comments_count : null);
    collected.avg_likes = avg(likes);
    collected.avg_comments = avg(comments);

    // Reel views — fetch per-reel insights for items that are reels
    const reels = items.filter(m => m.media_product_type === 'REELS');
    const reelViewPromises = reels.slice(0, 10).map(async r => {
      try {
        const v = await fetchReelViews(token, r.id);
        return pickInsightValue(v, 'ig_reels_video_view_total_count');
      } catch { return null; }
    });
    const reelViews = await Promise.all(reelViewPromises);
    collected.avg_reel_views = avg(reelViews);
  } catch (e) {
    errors.push('media:' + e.message);
    collected.avg_likes = null;
    collected.avg_comments = null;
    collected.avg_reel_views = null;
  }

  // ---- 4. Engagement rate (calculated, not from API) ----
  // Formula: (avg_likes + avg_comments) / followers * 100
  if (
    typeof collected.avg_likes === 'number' &&
    typeof collected.avg_comments === 'number' &&
    typeof collected.followers_count === 'number' &&
    collected.followers_count > 0
  ) {
    const rate = ((collected.avg_likes + collected.avg_comments) / collected.followers_count) * 100;
    collected.engagement_rate = Math.round(rate * 100) / 100; // 2 decimal places
  } else {
    collected.engagement_rate = null;
  }

  // ---- 5. Active stories (only if any are live) ----
  try {
    const stories = await fetchActiveStories(token);
    const items = (stories && stories.data) || [];
    if (items.length > 0) {
      const viewPromises = items.map(async s => {
        try {
          const v = await fetchStoryViews(token, s.id);
          return pickInsightValue(v, 'views');
        } catch { return null; }
      });
      const views = await Promise.all(viewPromises);
      collected.avg_story_views = avg(views);
    } else {
      collected.avg_story_views = null;
    }
  } catch (e) {
    // Story endpoint can 400 if there are no stories — non-fatal
    collected.avg_story_views = null;
  }

  // ---- 6. Demographics — 4 separate calls, gracefully handle <100 follower error ----
  // Instagram returns code 10 / subcode 2207050 when account has under 100 followers.
  let demographicsErrorNoted = false;
  const demographicsBreakdowns = [
    { key: 'demographics_age_gender', breakdown: 'age,gender' },
    { key: 'demographics_gender', breakdown: 'gender' },
    { key: 'demographics_top_countries', breakdown: 'country' },
    { key: 'demographics_top_cities', breakdown: 'city' }
  ];

  for (const b of demographicsBreakdowns) {
    try {
      const resp = await fetchDemographics(token, b.breakdown);
      collected[b.key] = pickDemographics(resp);
    } catch (e) {
      collected[b.key] = null;
      // First demographics error → likely the 100-follower threshold; record once
      if (!demographicsErrorNoted) {
        if (e.subcode === 2207050 || /100 follower/i.test(e.message)) {
          errors.push('demographics:Audience insights require 100+ followers');
        } else {
          errors.push('demographics:' + e.message);
        }
        demographicsErrorNoted = true;
      }
    }
  }

  // ---- 7. Write everything back to the DB ----
  collected.data_last_fetched_at = new Date().toISOString();
  collected.data_fetch_error = errors.length > 0 ? errors.join(' | ') : null;
  collected.last_refreshed_at = new Date().toISOString();

  const updateRes = await fetch(
    SUPABASE_URL + '/rest/v1/instagram_connections?user_id=eq.' + encodeURIComponent(userId),
    {
      method: 'PATCH',
      headers: Object.assign({}, bearerHeaders(), { Prefer: 'return=representation' }),
      body: JSON.stringify(collected)
    }
  );

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    return { ok: false, error: 'DB write failed: ' + errText };
  }

  const updated = await updateRes.json();
  return { ok: true, data: updated[0] || collected };
}

module.exports = { refreshInstagramData };
