// /api/bio-subscribe.js
//
// Server-side endpoint for the bio page email signup form.
// Replaces direct browser writes to `bio_email_signups`, which used to
// be wide open (`USING(true)` INSERT policy = unlimited spam).
//
// Validates input, enforces a per-IP-per-creator rate limit, then
// writes to bio_email_signups using the service role key (bypasses RLS).
//
// Pattern matches the rest of /api/: require() + raw fetch to Supabase
// REST. NO @supabase/supabase-js.

const crypto = require('crypto');
const { unsubscribeUrl } = require('./lib/unsub-sign');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

// Rate limit: 5 signups per IP per creator per hour.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;  // 1 hour
const RATE_LIMIT_MAX = 5;

// Email regex: simple but practical. Catches obvious garbage without
// being so strict it rejects valid edge cases.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// UUID regex for creator_id validation.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// Helpers
// ============================================================

function getServiceKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

function getClientIp(req) {
  // Vercel provides x-forwarded-for and x-real-ip. x-forwarded-for can be
  // a comma-separated list (closest proxy on the right); take the first.
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  const xri = req.headers['x-real-ip'];
  if (xri) return xri;
  return 'unknown';
}

function hashIp(ip) {
  // SHA-256 hex. We don't store raw IPs (no PII retention).
  // The hash is deterministic, so the same IP always maps to the same
  // bucket within the same creator scope.
  return crypto.createHash('sha256').update(ip).digest('hex');
}

async function sbFetch(path, options = {}) {
  const key = getServiceKey();
  const headers = Object.assign({
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
  }, options.headers || {});
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return res;
}

// ============================================================
// Rate limiting
// ============================================================
//
// Returns { allowed: boolean, retryAfterSeconds?: number }.
//
// Logic:
//   1. SELECT the row for (ip_hash, creator_id)
//   2. If no row: INSERT one with count=1, allow.
//   3. If row exists and window started > 1hr ago: reset count=1, allow.
//   4. If row exists and within window:
//        - If count < limit: increment, allow.
//        - If count >= limit: block, return retry hint.
//
// Race condition: two concurrent requests from same IP could both pass
// the count check before incrementing. With limit=5, worst case is 6
// instead of 5 in a window. Acceptable; the upsert is atomic from the
// DB's view, just not from our read-then-write logic.

async function checkRateLimit(ipHash, creatorId) {
  const path = 'subscribe_rate_limits'
    + '?ip_hash=eq.' + encodeURIComponent(ipHash)
    + '&creator_id=eq.' + encodeURIComponent(creatorId)
    + '&select=attempt_count,window_started_at&limit=1';

  const selRes = await sbFetch(path);
  if (!selRes.ok) {
    // Fail open on rate-limit infra errors. Better to let signups through
    // than to block legitimate users if the rate-limit table has issues.
    console.error('rate-limit SELECT failed:', selRes.status);
    return { allowed: true };
  }
  const rows = await selRes.json();
  const now = Date.now();

  if (rows.length === 0) {
    // First attempt for this (ip, creator). Insert.
    const insRes = await sbFetch('subscribe_rate_limits', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: { ip_hash: ipHash, creator_id: creatorId, attempt_count: 1, window_started_at: new Date(now).toISOString() },
    });
    if (!insRes.ok) console.error('rate-limit INSERT failed:', insRes.status);
    return { allowed: true };
  }

  const row = rows[0];
  const windowStart = new Date(row.window_started_at).getTime();
  const windowAge = now - windowStart;

  if (windowAge > RATE_LIMIT_WINDOW_MS) {
    // Window expired. Reset.
    const updRes = await sbFetch(path.replace('&select=attempt_count,window_started_at&limit=1', ''), {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: { attempt_count: 1, window_started_at: new Date(now).toISOString() },
    });
    if (!updRes.ok) console.error('rate-limit reset PATCH failed:', updRes.status);
    return { allowed: true };
  }

  if (row.attempt_count >= RATE_LIMIT_MAX) {
    // Blocked.
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - windowAge) / 1000);
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  // Increment.
  const updRes = await sbFetch(path.replace('&select=attempt_count,window_started_at&limit=1', ''), {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: { attempt_count: row.attempt_count + 1 },
  });
  if (!updRes.ok) console.error('rate-limit increment PATCH failed:', updRes.status);
  return { allowed: true };
}

// ============================================================
// Main handler
// ============================================================


// ============================================================
// Re-subscribe after opting out
//
// A person who previously opted out cannot be resubscribed by the creator, or
// by anyone typing their address into a form. Only they can undo it, and the
// proof is that they can receive mail at that address. So the form never
// resubscribes a suppressed email: it emails them a single-use confirmation
// link, and nothing changes until they click it.
//
// The endpoint's RESPONSE is identical in every case. If it said "you opted
// out before", anyone could type any address and learn whether that person is
// on a creator's list. That is an enumeration leak, and this form is public.
// ============================================================

const RESUB_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Store the hash, never the token. A leaked table then proves nothing and
// cannot be used to confirm anybody's resubscription.
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function isSuppressed(creatorId, emailLc) {
  const res = await sbFetch(
    'subscriber_suppressions?creator_id=eq.' + encodeURIComponent(creatorId) +
    '&email=ilike.' + encodeURIComponent(emailLc) + '&select=id&limit=1'
  );
  if (!res.ok) throw new Error('suppression lookup failed: ' + res.status);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

// Has an unspent link already gone to this address recently? Without this,
// submitting a stranger's email fifty times mails them fifty links.
async function hasPendingToken(creatorId, emailLc) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const res = await sbFetch(
    'bio_resubscribe_tokens?creator_id=eq.' + encodeURIComponent(creatorId) +
    '&email=ilike.' + encodeURIComponent(emailLc) +
    '&used_at=is.null&created_at=gte.' + encodeURIComponent(since) +
    '&select=id&limit=1'
  );
  if (!res.ok) return false;   // never block a real signup on this check
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

// Shared layout, matching the Supabase auth templates: table-based (Outlook
// renders divs unpredictably), 560px, black header carrying the wordmark, a
// white card with a soft shadow, then a rule and a muted footer.
//
// NOTE ON ESCAPING: heading, sub, cardHtml, ctaHtml and footHtml are
// interpolated RAW, because the footer carries an <a> and the card carries
// markup. Every caller must escapeHtml() any user-controlled value before
// passing it in. Both current call sites do.
function renderEmail({ preheader, heading, sub, cardHtml, ctaHtml, linkHtml, footHtml }) {
  return '' +
'<!DOCTYPE html>' +
'<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
'<body style="margin:0; padding:0; background-color:#f4f4f7; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;">' +
  // The grey line a mail client shows beside the subject. Without it, the
  // client grabs the first text it finds, which was the logo's alt attribute.
  '<div style="display:none; max-height:0; overflow:hidden; opacity:0;">' + escapeHtml(preheader || '') + '</div>' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7; padding:40px 20px;">' +
    '<tr><td align="center">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.06);">' +

        '<tr>' +
          '<td bgcolor="#0f0f1a" style="background-color:#0f0f1a; padding:48px 40px; text-align:center;">' +
            '<a href="https://www.ryxa.io" style="display:inline-block; text-decoration:none;">' +
              '<img src="https://www.ryxa.io/ryxa-email.png" alt="Ryxa" style="max-height:48px; max-width:180px; display:inline-block; border:0;">' +
            '</a>' +
          '</td>' +
        '</tr>' +

        '<tr>' +
          '<td style="padding:48px 40px 32px 40px; text-align:center;">' +
            '<h1 style="margin:0 0 16px 0; font-size:26px; font-weight:700; color:#111827; letter-spacing:-0.3px;">' + heading + '</h1>' +
            '<p style="margin:0 0 32px 0; font-size:16px; line-height:1.6; color:#4b5563;">' + sub + '</p>' +
            (cardHtml || '') +
            (ctaHtml || '') +
            (linkHtml || '') +
          '</td>' +
        '</tr>' +

        '<tr><td style="padding:0 40px;"><hr style="border:none; border-top:1px solid #e5e7eb; margin:0;"></td></tr>' +

        '<tr>' +
          '<td style="padding:24px 40px 40px 40px; text-align:center;">' +
            '<p style="margin:0; font-size:13px; line-height:1.6; color:#9ca3af;">' + (footHtml || '') + '</p>' +
            '<p style="margin:16px 0 0 0; font-size:12px; color:#9ca3af;">Sent by Ryxa on behalf of the creator you subscribed to.</p>' +
          '</td>' +
        '</tr>' +

      '</table>' +
    '</td></tr>' +
  '</table>' +
'</body></html>';
}

// Whose list is this? On the confirmation email that is the entire question,
// so the creator gets a card rather than a passing mention.
function creatorCard(creatorName) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">' +
           '<tr><td style="background-color:#f8f8fb; border:1px solid #e9e9ee; border-radius:12px; padding:16px 18px; text-align:center;">' +
             '<div style="font-size:11px; font-weight:600; color:#9ca3af; letter-spacing:0.07em; text-transform:uppercase; margin-bottom:6px;">Creator</div>' +
             '<div style="font-size:16px; font-weight:600; color:#111827;">' + escapeHtml(creatorName) + '</div>' +
           '</td></tr>' +
         '</table>';
}

function ctaButton(href, label) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">' +
           '<tr><td style="border-radius:10px; background-color:#7c3aed;">' +
             '<a href="' + href + '" style="display:inline-block; padding:14px 36px; font-size:15px; font-weight:500; color:#ffffff; text-decoration:none; border-radius:10px;">' + label + '</a>' +
           '</td></tr>' +
         '</table>';
}

// Some mail clients strip buttons, and some people do not trust them. The raw
// URL is the fallback, and it is the same link.
function fallbackLink(href) {
  return '<p style="margin:32px 0 0 0; font-size:14px; line-height:1.6; color:#6b7280;">Or copy and paste this link into your browser:</p>' +
         '<p style="margin:8px 0 0 0; font-size:13px; line-height:1.5; color:#7c3aed; word-break:break-all;">' +
           '<a href="' + href + '" style="color:#7c3aed; text-decoration:none;">' + href + '</a>' +
         '</p>';
}

async function sendResubscribeEmail(creatorId, emailLc) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('RESEND_API_KEY missing: cannot send re-subscribe confirmation');
    return;
  }

  // Creator display name for the email. Public view, safe fields only.
  let creatorName = 'this creator';
  try {
    const pr = await sbFetch('public_profiles?user_id=eq.' + encodeURIComponent(creatorId) + '&select=username&limit=1');
    if (pr.ok) {
      const rows = await pr.json();
      if (rows && rows[0] && rows[0].username) creatorName = rows[0].username;
    }
  } catch (e) { /* name is cosmetic */ }

  const raw = crypto.randomBytes(32).toString('base64url');
  const ins = await sbFetch('bio_resubscribe_tokens', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: {
      creator_id: creatorId,
      email: emailLc,
      token_hash: hashToken(raw),
      expires_at: new Date(Date.now() + RESUB_TOKEN_TTL_MS).toISOString(),
    },
  });
  if (!ins.ok) {
    console.error('resubscribe token insert failed', ins.status);
    return;
  }

  const link = 'https://www.ryxa.io/api/confirm-resubscribe?token=' + encodeURIComponent(raw);

  const html = renderEmail({
    preheader: 'Confirm you want emails from ' + creatorName + ' again.',
    heading: 'Confirm you want these emails',
    sub: 'Someone entered this address on ' + escapeHtml(creatorName) + '\'s page. You previously asked to stop receiving their emails, so nothing changes unless you confirm.',
    cardHtml: creatorCard(creatorName),
    ctaHtml: ctaButton(link, 'Yes, subscribe me again'),
    linkHtml: fallbackLink(link),
    footHtml: 'If this was not you, ignore this email. You will stay unsubscribed and we will not email you about it again. This link expires in 24 hours and can be used once.',
  });

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Ryxa <no-reply@ryxa.io>',
        to: [emailLc],
        subject: 'Confirm you want emails from ' + creatorName,
        html,
      }),
    });
  } catch (e) {
    console.error('resubscribe email send failed', e);
  }
}

async function sendWelcomeEmail(creatorId, emailLc) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  let creatorName = 'this creator';
  try {
    const pr = await sbFetch('public_profiles?user_id=eq.' + encodeURIComponent(creatorId) + '&select=username&limit=1');
    if (pr.ok) {
      const rows = await pr.json();
      if (rows && rows[0] && rows[0].username) creatorName = rows[0].username;
    }
  } catch (e) { /* cosmetic */ }

  const unsubUrl = unsubscribeUrl(creatorId, emailLc);

  const html = renderEmail({
    preheader: 'You subscribed to updates from ' + creatorName + '.',
    heading: "You're on the list",
    sub: 'You subscribed to updates from ' + escapeHtml(creatorName) + '. They will email you directly from here on.',
    cardHtml: creatorCard(creatorName),
    ctaHtml: '',
    linkHtml: '',
    // The bio signup form is public and single opt-in, so this email is the
    // only place an unwanted subscriber can be reached with a way out.
    footHtml: 'Did not sign up? <a href="' + unsubUrl + '" style="color:#7c3aed; font-weight:600; text-decoration:none;">Remove me from this list</a>. One click, no account needed.',
  });

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Ryxa <no-reply@ryxa.io>',
        to: [emailLc],
        subject: 'You subscribed to ' + creatorName,
        html,
      }),
    });
  } catch (e) {
    console.error('welcome email send failed', e);
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body. Vercel parses JSON automatically when content-type is
  // application/json, but be defensive.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Missing body' });
  }

  const { creator_id, email, hp } = body;

  // Honeypot: a hidden field on the form that humans never fill in.
  // If it has a value, it's a bot. Reject silently with 200 so the bot
  // thinks it succeeded and doesn't retry.
  if (hp) {
    return res.status(200).json({ success: true });
  }

  // Input validation.
  if (!creator_id || !UUID_RE.test(creator_id)) {
    return res.status(400).json({ error: 'Invalid creator_id' });
  }
  if (!email || typeof email !== 'string' || email.length > 254) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  const trimmedEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmedEmail)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  // Rate limit check.
  const ip = getClientIp(req);
  const ipHash = hashIp(ip);
  const limit = await checkRateLimit(ipHash, creator_id);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds || 3600));
    return res.status(429).json({
      error: 'Too many attempts. Please try again later.',
      retry_after_seconds: limit.retryAfterSeconds,
    });
  }

  // Previously opted out? Do not resubscribe. Email them a confirmation link
  // and return the ordinary success response, so the form reveals nothing
  // about who is or is not on this creator's list.
  try {
    if (await isSuppressed(creator_id, trimmedEmail)) {
      // Awaited, not fired and forgotten. A Vercel function can freeze the
      // instant the response is sent, so background work is not guaranteed to
      // run, and a confirmation email that never arrives is worse than a
      // slower response. The welcome email on the normal path is awaited too,
      // so both branches spend one mail-provider round trip and the response
      // time does not answer the question the response body refuses to.
      try {
        if (!(await hasPendingToken(creator_id, trimmedEmail))) {
          await sendResubscribeEmail(creator_id, trimmedEmail);
        }
      } catch (e) {
        console.error('resubscribe flow failed:', e);
      }
      return res.status(200).json({ success: true });
    }
  } catch (e) {
    // A failed suppression check must never fall through to the insert: that
    // would resubscribe someone who opted out. Fail closed.
    console.error('suppression check failed, refusing signup:', e);
    return res.status(500).json({ error: 'Subscription failed' });
  }

  // Insert the signup.
  try {
    const insRes = await sbFetch('bio_email_signups', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: {
        creator_id,
        email: trimmedEmail,
        consented_at: new Date().toISOString(),
        consent_source: 'bio_form',
      },
    });

    if (insRes.ok) {
      // Awaited so the send actually happens (a serverless function may freeze
      // once the response is written), and so this path costs the same round
      // trip as the suppressed one.
      await sendWelcomeEmail(creator_id, trimmedEmail);
      return res.status(200).json({ success: true });
    }

    // Read the body to distinguish duplicate (23505) from real errors.
    const errBody = await insRes.text().catch(() => '');
    if (errBody.includes('23505') || errBody.toLowerCase().includes('duplicate')) {
      // Already subscribed. Return the SAME body as a fresh signup.
      //
      // It used to answer { already_subscribed: true }, and the form said
      // "You're already subscribed!". That is an enumeration leak in a
      // friendly voice: type any address into any creator's page and learn
      // whether that person is on their list. Every branch of this endpoint
      // now answers identically.
      return res.status(200).json({ success: true });
    }

    console.error('bio_email_signups INSERT failed:', insRes.status, errBody);
    return res.status(500).json({ error: 'Subscription failed' });
  } catch (e) {
    console.error('bio-subscribe error:', e);
    return res.status(500).json({ error: 'Subscription failed' });
  }
};
