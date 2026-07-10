// /api/lib/unsub-sign.js
//
// One implementation of the unsubscribe link signature, shared by the endpoint
// that verifies it and the mailer that builds it. Two copies of a signature
// scheme is one copy too many: they drift, and the failure is silent.
//
// HMAC-SHA256 over "creator_id\nemail". Both parameters are covered, so a link
// holder cannot swap the email and suppress somebody else, or reuse a
// signature across creators.
//
// The key is derived from the service role secret with a domain separator, so
// it can never collide with any other use of that secret. A dedicated env var
// would be marginally cleaner; this avoids adding one to every environment.

const crypto = require('crypto');

function signingKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return crypto.createHash('sha256').update('ryxa_unsub_v1|' + k).digest();
}

function sign(creatorId, emailLc) {
  return crypto.createHmac('sha256', signingKey())
    .update(String(creatorId) + '\n' + String(emailLc))
    .digest('base64url');
}

// Constant time. Length is checked first because timingSafeEqual throws on a
// length mismatch, and a thrown error is itself an oracle.
function verify(creatorId, emailLc, provided) {
  const expected = Buffer.from(sign(creatorId, emailLc));
  const given = Buffer.from(String(provided || ''));
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

// Absolute link for an email. Always https://www.ryxa.io so it works from any
// mail client, and encoded because an email address may contain "+".
function unsubscribeUrl(creatorId, emailLc) {
  return 'https://www.ryxa.io/api/unsubscribe'
    + '?c=' + encodeURIComponent(creatorId)
    + '&e=' + encodeURIComponent(emailLc)
    + '&s=' + encodeURIComponent(sign(creatorId, emailLc));
}

module.exports = { sign, verify, unsubscribeUrl };
