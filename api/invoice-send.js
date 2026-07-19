// Vercel serverless function - POST /api/invoice-send
//
// Emails a saved invoice to its Bill To recipient, exactly once. On success it
// stamps sent_at, locks the recipient email (email_locked), and moves a draft
// invoice to pending. The caller is the logged-in creator; ownership is
// verified server-side from the Supabase access token, and the invoice is
// loaded with the service role so nothing about the send is client-trusted.
//
// Body: { invoice_id }
// Auth: Authorization: Bearer <supabase user access token>
//
// The email itself carries the Ryxa branding ("Free invoicing powered by
// Ryxa") - the public invoice page stays watermark-free by design.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SITE_URL = 'https://www.ryxa.io';

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

async function verifySupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + accessToken, apikey: getServiceKey() }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.id ? data : null;
  } catch (e) {
    console.error('verifySupabaseUser failed:', e.message);
    return null;
  }
}

async function sbFetch(path, opts) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({
    headers: {
      apikey: getServiceKey(),
      Authorization: 'Bearer ' + getServiceKey(),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }
  }, opts, {
    headers: Object.assign({
      apikey: getServiceKey(),
      Authorization: 'Bearer ' + getServiceKey(),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }, (opts && opts.headers) || {})
  }));
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + text.slice(0, 200));
  return data;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(cents) {
  var n = (Number(cents) || 0) / 100;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  var dt = new Date(d + 'T12:00:00Z');
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}

const crypto = require('crypto');
const SEND_RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SEND_RL_MAX = 30;                   // sends per user per hour

function getClientIp(req) {
  var xff = req.headers['x-forwarded-for'];
  if (xff) { var first = xff.split(',')[0].trim(); if (first) return first; }
  return req.headers['x-real-ip'] || 'unknown';
}
function hashKey(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}

// Raw-fetch rate-limit helper (the module's sbFetch throws on non-2xx and
// auto-parses, which we don't want for best-effort throttle bookkeeping).
async function rlFetch(path, method, body) {
  var key = getServiceKey();
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: method || 'GET',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined
  });
}

// Per-user throttle on sending. Fails OPEN on infra errors.
async function checkSendRateLimit(userId) {
  var ipHash = hashKey('user:' + userId); // key by user, stored in the ip_hash column
  var q = 'invoice_rate_limits?ip_hash=eq.' + encodeURIComponent(ipHash)
    + '&scope=eq.send&bucket_key=eq.' + encodeURIComponent(userId);
  try {
    var selRes = await rlFetch(q + '&select=attempt_count,window_started_at&limit=1');
    if (!selRes.ok) return { allowed: true };
    var rows = await selRes.json();
    var now = Date.now();
    if (!rows || rows.length === 0) {
      await rlFetch('invoice_rate_limits', 'POST', { ip_hash: ipHash, scope: 'send', bucket_key: userId, attempt_count: 1, window_started_at: new Date(now).toISOString() });
      return { allowed: true };
    }
    var row = rows[0];
    var age = now - new Date(row.window_started_at).getTime();
    if (age > SEND_RL_WINDOW_MS) {
      await rlFetch(q, 'PATCH', { attempt_count: 1, window_started_at: new Date(now).toISOString() });
      return { allowed: true };
    }
    if (row.attempt_count >= SEND_RL_MAX) {
      return { allowed: false, retryAfterSeconds: Math.ceil((SEND_RL_WINDOW_MS - age) / 1000) };
    }
    await rlFetch(q, 'PATCH', { attempt_count: row.attempt_count + 1 });
    return { allowed: true };
  } catch (e) {
    console.error('invoice send rate-limit error (failing open):', e.message);
    return { allowed: true };
  }
}

function buildEmailHtml(inv, username, url) {
  var fromLabel = inv.from_name || ('@' + username);
  var rows = '';
  var items = Array.isArray(inv.items) ? inv.items : [];
  for (var i = 0; i < items.length && i < 12; i++) {
    var it = items[i];
    var qty = Number(it.qty) || 0;
    var rate = Number(it.rate) || 0;
    rows += '<tr>' +
      '<td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;">' + esc(it.desc || 'Service') + (qty !== 1 ? ' <span style="color:#888;font-size:12px;">(x' + esc(qty) + ')</span>' : '') + '</td>' +
      '<td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;text-align:right;">' + money(Math.round(qty * rate * 100)) + '</td>' +
    '</tr>';
  }
  return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 12px;"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;padding:32px 28px;">' +
      '<tr><td style="font-size:18px;font-weight:bold;color:#111;padding-bottom:6px;">You received an invoice from ' + esc(fromLabel) + '</td></tr>' +
      '<tr><td style="font-size:13px;color:#666;padding-bottom:20px;">Sent via Ryxa on behalf of @' + esc(username) + '</td></tr>' +
      (inv.invoice_number ? '<tr><td style="font-size:13px;color:#666;padding-bottom:4px;">Invoice #' + esc(inv.invoice_number) + '</td></tr>' : '') +
      (inv.due_date ? '<tr><td style="font-size:13px;color:#666;padding-bottom:16px;">Due ' + esc(fmtDate(inv.due_date)) + '</td></tr>' : '<tr><td style="padding-bottom:12px;"></td></tr>') +
      '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rows + '</table></td></tr>' +
      '<tr><td style="padding:14px 0 22px;font-size:17px;font-weight:bold;color:#111;text-align:right;">Total: ' + money(inv.total_cents) + '</td></tr>' +
      '<tr><td align="center" style="padding-bottom:26px;">' +
        '<a href="' + esc(url) + '" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 38px;border-radius:10px;">View Invoice</a>' +
      '</td></tr>' +
      '<tr><td style="font-size:12px;color:#999;text-align:center;border-top:1px solid #f0f0f0;padding-top:18px;">' +
        'Free Invoicing Tool powered by <a href="' + SITE_URL + '" style="color:#7c3aed;text-decoration:none;font-weight:bold;">Ryxa</a>' +
      '</td></tr>' +
    '</table>' +
    '</td></tr></table></body></html>';
}

module.exports = async (req, res) => {
  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    var user = await verifySupabaseUser(token);
    if (!user) return res.status(401).json({ error: 'Not signed in' });

    // Throttle sends per user.
    var rl = await checkSendRateLimit(user.id);
    if (!rl.allowed) {
      if (rl.retryAfterSeconds) res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many invoices sent recently. Please try again in a bit.' });
    }

    var invoiceId = (req.body && req.body.invoice_id || '').toString();
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoice_id' });

    // Load the invoice with the service role, scoped to the caller's ownership.
    var rows = await sbFetch('invoices?id=eq.' + encodeURIComponent(invoiceId)
      + '&user_id=eq.' + encodeURIComponent(user.id) + '&select=*&limit=1', { method: 'GET' });
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    var inv = rows[0];

    // One send per invoice, ever.
    if (inv.sent_at) return res.status(400).json({ error: 'This invoice has already been emailed. Invoices can only be emailed once.' });
    if (inv.status === 'paid') return res.status(400).json({ error: 'A paid invoice cannot be sent.' });
    if (!isValidEmail(inv.to_email)) return res.status(400).json({ error: 'Add a valid recipient email in Bill To first, then Save.' });

    // Creator username for the email header.
    var profs = await sbFetch('public_profiles?user_id=eq.' + encodeURIComponent(user.id) + '&select=username&limit=1', { method: 'GET' });
    var username = (profs && profs[0] && profs[0].username) || 'creator';

    var url = SITE_URL + '/invoice/' + inv.public_id;

    var resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.error('RESEND_API_KEY missing: cannot send invoice email');
      return res.status(500).json({ error: 'Email sending is not configured.' });
    }

    var emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Ryxa <hello@ryxa.io>',
        to: [inv.to_email],
        reply_to: isValidEmail(inv.from_email) ? inv.from_email : undefined,
        subject: 'You received an invoice from ' + (inv.from_name || '@' + username),
        html: buildEmailHtml(inv, username, url)
      })
    });
    if (!emailRes.ok) {
      var errText = await emailRes.text();
      console.error('Resend error:', emailRes.status, errText.slice(0, 300));
      return res.status(502).json({ error: 'The email could not be sent. Please try again.' });
    }

    // Sending always puts the invoice into pending (it is guaranteed not paid
    // here). Stamp the send, lock the recipient email, and record sent_at.
    var updated = await sbFetch('invoices?id=eq.' + encodeURIComponent(inv.id), {
      method: 'PATCH',
      body: JSON.stringify({ sent_at: new Date().toISOString(), email_locked: true, status: 'pending' })
    });

    return res.status(200).json({ ok: true, invoice: (updated && updated[0]) || null });
  } catch (err) {
    console.error('invoice-send error:', err);
    return res.status(500).json({ error: 'Could not send the invoice.' });
  }
};
