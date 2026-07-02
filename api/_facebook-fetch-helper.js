// Shared Facebook data fetcher - imported by:
//   - api/facebook-data-fetch.js   (creator-triggered, auto + manual refresh)
//   - api/facebook-token-refresh.js does NOT use this (token-only), but the
//     daily data cron can call refreshFacebookData if/when one is added.
//
// Strategy (built to survive Meta's ongoing Page Insights deprecations):
//   1. Page-node FIELDS are the reliable core: followers_count and fan_count
//      come straight off the Page object, never from Insights, so they cannot
//      be broken by a deprecated-metric error.
//   2. Insights (reach / views / engagement) are queried ONE METRIC AT A TIME.
//      If Meta has deprecated a given metric it returns an "invalid metric"
//      error, but because each metric is its own request, a dead metric is
//      skipped instead of taking down the whole refresh. New deprecations just
//      mean that one number quietly drops out until we swap in a replacement.
//
// All Graph calls use the encrypted PAGE token stored on the connection row.
// No tokens leave the server.
//
// Usage:
//   const { refreshFacebookData } = require('./_facebook-fetch-helper.js');
//   const result = await refreshFacebookData(userId);
//   // { ok: true, data: {...} }  or  { ok: false, error: '...' }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GRAPH = 'https://graph.facebook.com/v22.0';
const { decryptToken } = require('./lib/token-crypto');

// Insight metrics to attempt, each queried independently. period days_28 gives
// a rolling 28-day figure, which is a good media-kit window. If any of these
// is deprecated, its request errors and we skip it (see fetchInsight).
const INSIGHT_METRICS = [
  { key: 'reach', metric: 'page_impressions_unique', period: 'days_28' },
  { key: 'views', metric: 'page_views_total', period: 'days_28' },
  { key: 'engagement', metric: 'page_post_engagements', period: 'days_28' }
];

function bearerHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json'
  };
}

// Graph GET. Returns parsed JSON; throws on non-200 with the Graph error message.
async function fb(path, token, extraParams) {
  const params = new URLSearchParams(Object.assign({ access_token: token }, extraParams || {}));
  const res = await fetch(GRAPH + path + '?' + params.toString());
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { body = { raw: text }; }
  if (!res.ok) {
    const msg = (body && body.error && body.error.message) || ('HTTP ' + res.status);
    const err = new Error(msg);
    err.code = body && body.error && body.error.code;
    throw err;
  }
  return body;
}

async function loadConnection(userId) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/facebook_connections?user_id=eq.' + encodeURIComponent(userId) +
    '&select=user_id,page_access_token,fb_page_id',
    { headers: bearerHeaders() }
  );
  if (!res.ok) throw new Error('Failed to load connection: ' + res.status);
  const rows = await res.json();
  return rows && rows.length ? rows[0] : null;
}

// Page-node fields. Reliable, no Insights dependency.
async function fetchPageFields(pageId, token) {
  return fb('/' + encodeURIComponent(pageId), token, {
    fields: 'id,name,followers_count,fan_count,picture{url}'
  });
}

// One insight metric, isolated. Returns the latest numeric value or null.
// A deprecated / unsupported metric throws inside fb(); we swallow it so the
// rest of the refresh proceeds.
async function fetchInsight(pageId, token, spec) {
  try {
    const body = await fb('/' + encodeURIComponent(pageId) + '/insights/' + spec.metric, token, { period: spec.period });
    const d = body && body.data && body.data[0];
    if (!d || !Array.isArray(d.values) || !d.values.length) return null;
    const v = d.values[d.values.length - 1].value;
    return (typeof v === 'number') ? v : null;
  } catch (e) {
    // Deprecated metric, no data, or Page under the 100-like insights threshold.
    return null;
  }
}

async function updateConnection(userId, fields) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/facebook_connections?user_id=eq.' + encodeURIComponent(userId),
    { method: 'PATCH', headers: bearerHeaders(), body: JSON.stringify(fields) }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Update failed: ' + res.status + ' ' + err);
  }
}

async function refreshFacebookData(userId) {
  let conn;
  try {
    conn = await loadConnection(userId);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!conn) return { ok: false, error: 'Not connected to Facebook' };
  if (!conn.page_access_token || !conn.fb_page_id) {
    return { ok: false, error: 'No Page selected yet' };
  }

  let token;
  try {
    token = decryptToken(conn.page_access_token);
  } catch (e) {
    return { ok: false, error: 'Stored token unreadable, please reconnect' };
  }

  const collected = { last_refreshed_at: new Date().toISOString() };
  const errors = [];

  // 1) Page fields (reliable)
  try {
    const page = await fetchPageFields(conn.fb_page_id, token);
    collected.followers_count = (typeof page.followers_count === 'number') ? page.followers_count : null;
    collected.fan_count = (typeof page.fan_count === 'number') ? page.fan_count : null;
    if (page.name) collected.fb_page_name = page.name;
    if (page.picture && page.picture.data && page.picture.data.url) {
      collected.profile_picture_url = page.picture.data.url;
    }
  } catch (e) {
    // If even the Page object fails, the token is likely dead/revoked.
    return { ok: false, error: 'data_fetch_error: ' + e.message };
  }

  // 2) Insights (defensive, per-metric)
  const insights = { fetched_at: new Date().toISOString() };
  for (const spec of INSIGHT_METRICS) {
    const val = await fetchInsight(conn.fb_page_id, token, spec);
    if (val != null) insights[spec.key] = val;
    else errors.push(spec.metric);
  }
  collected.cached_data = insights;

  try {
    await updateConnection(userId, collected);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  return { ok: true, data: Object.assign({}, collected, { skipped_metrics: errors }) };
}

module.exports = { refreshFacebookData };
