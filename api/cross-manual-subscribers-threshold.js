// Vercel serverless function, records a soft-threshold crossing event and
// sends a notification email to hello@ryxa.io.
//
// POST /api/cross-manual-subscribers-threshold
// Headers: Authorization: Bearer <user_access_token>
// Body: {
//   threshold_count: integer (defaults to 5000),
//   subscriber_count_at_crossing: integer (required),
//   attestation_text: string,
//   attestation_version: string (defaults to 'v1')
// }
//
// Returns: 200 { id, created_at, already_cleared } on success
//
// Idempotent: if the user's profile already has manual_subscribers_threshold_cleared_at
// set, this returns 200 { already_cleared: true } without re-logging or re-emailing.
//
// On the email side: if Resend fails or is unconfigured, this still returns 200,
// the DB event is still recorded, and the profile flag is still set. The email
// is a best-effort notification, not a blocker.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
const NOTIFICATION_TO = 'hello@ryxa.io';
const NOTIFICATION_FROM = 'Ryxa <no-reply@ryxa.io>';

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

function getResendKey() {
  return process.env.RESEND_API_KEY || '';
}

async function sbSelect(path) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    throw new Error('Supabase SELECT failed (' + res.status + '): ' + body);
  }
  return await res.json();
}

async function sbInsert(table, row) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    var err = new Error('Supabase INSERT failed (' + res.status + '): ' + body);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  var rows = await res.json();
  return rows && rows[0];
}

async function sbPatch(path, payload) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    throw new Error('Supabase PATCH failed (' + res.status + '): ' + body);
  }
}

async function verifyUserJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  var token = authHeader.split(' ')[1];
  try {
    var res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_ANON_KEY }
    });
    if (!res.ok) return null;
    var data = await res.json();
    return data && data.id ? { id: data.id, email: data.email } : null;
  } catch (e) {
    return null;
  }
}

function getClientIp(req) {
  var fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || null;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildNotificationHtml(data) {
  // data fields: userEmail, username, userId, subscriberCount, attestationText,
  //              attestationVersion, ipAddress, createdAt
  return `
<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f7;margin:0;padding:32px 16px;color:#1d1d1f;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px 28px;border:1px solid #e5e5ea;">
    <div style="font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#86868b;margin-bottom:8px;">Ryxa account event</div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 20px;color:#1d1d1f;">5k manual subscribers threshold crossed</h1>

    <p style="font-size:15px;line-height:1.6;color:#3a3a3c;margin:0 0 20px;">
      An account just crossed the 5,000 manual subscribers soft threshold and attested to having permission. This is for your awareness, no action required unless something looks off.
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px;">
      <tr><td style="padding:8px 0;color:#86868b;width:40%;">Email</td><td style="padding:8px 0;color:#1d1d1f;font-weight:500;">${escapeHtml(data.userEmail)}</td></tr>
      <tr><td style="padding:8px 0;color:#86868b;">Username</td><td style="padding:8px 0;color:#1d1d1f;font-weight:500;">${escapeHtml(data.username || '(not set)')}</td></tr>
      <tr><td style="padding:8px 0;color:#86868b;">User ID</td><td style="padding:8px 0;color:#1d1d1f;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12px;">${escapeHtml(data.userId)}</td></tr>
      <tr><td style="padding:8px 0;color:#86868b;">Count at crossing</td><td style="padding:8px 0;color:#1d1d1f;font-weight:600;">${escapeHtml(String(data.subscriberCount))}</td></tr>
      <tr><td style="padding:8px 0;color:#86868b;">IP</td><td style="padding:8px 0;color:#1d1d1f;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12px;">${escapeHtml(data.ipAddress || '(unknown)')}</td></tr>
      <tr><td style="padding:8px 0;color:#86868b;">Time</td><td style="padding:8px 0;color:#1d1d1f;">${escapeHtml(data.createdAt)}</td></tr>
      <tr><td style="padding:8px 0;color:#86868b;">Attestation</td><td style="padding:8px 0;color:#1d1d1f;">version ${escapeHtml(data.attestationVersion)}</td></tr>
    </table>

    <div style="background:#f5f5f7;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:12px;font-weight:600;color:#86868b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Attestation text</div>
      <div style="font-size:14px;line-height:1.6;color:#3a3a3c;font-style:italic;">"${escapeHtml(data.attestationText)}"</div>
    </div>

    <p style="font-size:13px;line-height:1.55;color:#86868b;margin:0;">
      The full audit log entry is in <code style="background:#f5f5f7;padding:2px 6px;border-radius:4px;font-family:'SF Mono',Menlo,Consolas,monospace;">manual_subscriber_threshold_events</code> in Supabase. The user's profile flag <code style="background:#f5f5f7;padding:2px 6px;border-radius:4px;font-family:'SF Mono',Menlo,Consolas,monospace;">manual_subscribers_threshold_cleared_at</code> has been set, they will not see the attestation modal again.
    </p>
  </div>
</body>
</html>
  `.trim();
}

async function sendNotificationEmail(data) {
  var key = getResendKey();
  if (!key) {
    console.warn('RESEND_API_KEY not set, skipping notification email');
    return;
  }

  var html = buildNotificationHtml(data);
  var subject = 'Ryxa: account crossed 5k manual subscribers (' + (data.userEmail || data.userId) + ')';

  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: NOTIFICATION_FROM,
      to: [NOTIFICATION_TO],
      subject: subject,
      html: html
    })
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    throw new Error('Resend error (' + res.status + '): ' + body);
  }
}

module.exports = async function handler(req, res) {
  // Per-IP rate limit: 20 requests / 60s. See api/lib/rate-limit.js.
  if (require('./lib/rate-limit').tooMany(req, res, 'subs-threshold', 20, 60000)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Verify authenticated user
  var user = await verifyUserJWT(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Parse + validate body
  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  var thresholdCount = parseInt(body.threshold_count, 10);
  if (!isFinite(thresholdCount) || thresholdCount < 1) thresholdCount = 5000;

  var subscriberCount = parseInt(body.subscriber_count_at_crossing, 10);
  if (!isFinite(subscriberCount) || subscriberCount < 0 || subscriberCount > 10000000) {
    res.status(400).json({ error: 'Invalid subscriber_count_at_crossing' });
    return;
  }

  var attestationText = typeof body.attestation_text === 'string' ? body.attestation_text.trim() : '';
  if (!attestationText || attestationText.length > 2000) {
    res.status(400).json({ error: 'Invalid attestation_text' });
    return;
  }

  var attestationVersion = typeof body.attestation_version === 'string' && body.attestation_version.trim()
    ? body.attestation_version.trim().substring(0, 32)
    : 'v1';

  var ipAddress = getClientIp(req);
  var userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']).substring(0, 500) : null;

  try {
    // Check if user's profile already has the flag set (idempotency)
    var profiles = await sbSelect(
      'profiles?user_id=eq.' + encodeURIComponent(user.id) +
      '&select=user_id,username,manual_subscribers_threshold_cleared_at'
    );

    if (!profiles || profiles.length === 0) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    var profile = profiles[0];

    if (profile.manual_subscribers_threshold_cleared_at) {
      // Already cleared, no-op
      res.status(200).json({ already_cleared: true });
      return;
    }

    // Insert audit log row
    var eventRow = await sbInsert('manual_subscriber_threshold_events', {
      user_id: user.id,
      threshold_count: thresholdCount,
      subscriber_count_at_crossing: subscriberCount,
      attestation_text: attestationText,
      attestation_version: attestationVersion,
      ip_address: ipAddress,
      user_agent: userAgent
    });

    // Set the flag on profile so user never sees the modal again
    await sbPatch(
      'profiles?user_id=eq.' + encodeURIComponent(user.id),
      { manual_subscribers_threshold_cleared_at: new Date().toISOString() }
    );

    // Send notification email, best-effort, do not block response on failure
    try {
      await sendNotificationEmail({
        userEmail: user.email || '(unknown)',
        username: profile.username,
        userId: user.id,
        subscriberCount: subscriberCount,
        attestationText: attestationText,
        attestationVersion: attestationVersion,
        ipAddress: ipAddress,
        createdAt: eventRow.created_at
      });
    } catch (emailErr) {
      console.error('Notification email failed (event still logged):', emailErr);
    }

    res.status(200).json({
      id: eventRow.id,
      created_at: eventRow.created_at,
      already_cleared: false
    });
  } catch (e) {
    console.error('cross-manual-subscribers-threshold failed:', e);
    res.status(500).json({ error: 'Failed to record threshold crossing' });
  }
};
