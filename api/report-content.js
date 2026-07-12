// Vercel serverless function: Report AI Content
// =============================================================================
// Records a user report of objectionable AI output (Apple Guideline 1.2). The
// reporter is identified from the verified Bearer token, never the body. Each
// report is written to content_reports (service role) and emailed to
// hello@ryxa.io so it is seen and actionable.
//
// Deploy to: /api/report-content.js   Endpoint: https://ryxa.io/api/report-content
// =============================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const NOTIFICATION_TO = 'hello@ryxa.io';
const NOTIFICATION_FROM = 'Ryxa <hello@ryxa.io>';

const ALLOWED_SOURCES = ['chatbox', 'script-builder', 'bio-writer', 'design-studio', 'thumbnail-analyzer', 'contract-analyzer'];
const MAX_CONTENT_CHARS = 5000;
const MAX_REASON_CHARS = 1000;
const RATE_LIMIT_PER_HOUR = 20;

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

async function countRecentReports(reporterId) {
  const sinceIso = new Date(Date.now() - 3600 * 1000).toISOString();
  const url = SUPABASE_URL + '/rest/v1/content_reports?reporter_id=eq.' +
    encodeURIComponent(reporterId) + '&created_at=gte.' + encodeURIComponent(sinceIso) +
    '&select=id';
  const res = await fetch(url, { headers: svcHeaders({ Prefer: 'count=exact' }) });
  if (!res.ok) return 0;
  // Content-Range looks like "0-19/42"; parse the total after the slash.
  const range = res.headers.get('content-range') || '';
  const total = range.split('/')[1];
  return total ? parseInt(total, 10) || 0 : 0;
}

async function insertReport(row) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/content_reports', {
    method: 'POST',
    headers: svcHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error('content_reports insert failed (' + res.status + '): ' + err);
  }
}

async function sendNotificationEmail(report, reporterEmail) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('RESEND_API_KEY not set, skipping report email'); return; }
  const html =
    '<h2>New AI content report</h2>' +
    '<p><strong>Source:</strong> ' + escapeHtml(report.source) + '</p>' +
    '<p><strong>Reporter:</strong> ' + escapeHtml(reporterEmail || report.reporter_id) +
    ' (' + escapeHtml(report.reporter_id) + ')</p>' +
    (report.conversation_id ? '<p><strong>Conversation:</strong> ' + escapeHtml(report.conversation_id) + '</p>' : '') +
    (report.reason ? '<p><strong>Reason:</strong> ' + escapeHtml(report.reason) + '</p>' : '') +
    '<p><strong>Reported content:</strong></p>' +
    '<pre style="white-space:pre-wrap;background:#f4f4f5;padding:12px;border-radius:8px;">' +
    escapeHtml(report.reported_content || '(none provided)') + '</pre>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: NOTIFICATION_FROM,
        to: [NOTIFICATION_TO],
        subject: 'AI content report (' + report.source + ')',
        html: html
      })
    });
    if (!res.ok) console.warn('Report email failed:', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.warn('Report email exception (non-fatal):', e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://ryxa.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // After the preflight, deliberately. A 429 on an OPTIONS request means the
  // browser never sends the real one, and the user sees a CORS error instead
  // of a rate limit.
  //
  // Reports are a moderation queue. Unlimited, one person can bury a creator.
  if (require('./lib/rate-limit').tooMany(req, res, 'report-content', 5, 60000)) return;
  if (!SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  const user = await verifySupabaseUser(accessToken);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const body = req.body || {};
  let source = String(body.source || 'chatbox');
  if (ALLOWED_SOURCES.indexOf(source) === -1) source = 'chatbox';

  const reportedContent = body.reported_content != null ? String(body.reported_content).slice(0, MAX_CONTENT_CHARS) : '';
  const reason = body.reason != null ? String(body.reason).slice(0, MAX_REASON_CHARS) : null;
  const conversationId = (typeof body.conversation_id === 'string' && body.conversation_id) ? body.conversation_id : null;

  if (!reportedContent.trim()) {
    return res.status(400).json({ error: 'Nothing to report.' });
  }

  // Light per-user rate limit to prevent report spam.
  try {
    const recent = await countRecentReports(user.id);
    if (recent >= RATE_LIMIT_PER_HOUR) {
      return res.status(429).json({ error: 'You have submitted several reports recently. Please try again later.' });
    }
  } catch (e) {
    // If the count check fails, do not block a legitimate report.
    console.warn('rate-limit check failed (allowing):', e.message);
  }

  const row = {
    reporter_id: user.id,
    source: source,
    conversation_id: conversationId,
    reported_content: reportedContent,
    reason: reason,
    status: 'pending'
  };

  try {
    await insertReport(row);
  } catch (e) {
    console.error('report-content insert error:', e.message);
    return res.status(500).json({ error: 'Could not submit your report. Please try again.' });
  }

  // Email is best-effort and must not fail the request.
  await sendNotificationEmail(row, user.email);

  return res.status(200).json({ ok: true });
};
