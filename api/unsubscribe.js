// /api/unsubscribe.js
//
// One-click removal from the welcome email.
//
// WHY THIS EXISTS
//   The bio signup form is public and single opt-in. Anyone can type a
//   stranger's address into any creator's page. That stranger gets a welcome
//   email they never asked for, and until now had no way out: Ryxa does not
//   send the creator's marketing, so there is no unsubscribe link in the mail
//   that eventually reaches them, and no way to opt out through Ryxa at all.
//
// WHY IT NEEDS NO CONFIRMATION STEP
//   Suppression only ever tightens. Creating one is always the safe direction,
//   so unlike re-subscribing, this needs no token table and no double opt-in.
//   Worst case for a forged link: somebody is opted out who did not ask to be,
//   which is recoverable through the re-subscribe flow and harms nobody.
//
// SIGNATURE
//   HMAC-SHA256 over "creator_id\nemail", keyed by a value derived from the
//   service role key with a domain separator. Both parameters are covered, so
//   the holder cannot swap the email and suppress somebody else on a different
//   creator's list.

const crypto = require('crypto');
const { verify } = require('./lib/unsub-sign');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getServiceKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

async function sbFetch(path, options = {}) {
  const key = getServiceKey();
  const headers = Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
  }, options.headers || {});
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

function redirect(res, status) {
  res.writeHead(302, { Location: '/unsubscribed.html?status=' + status });
  res.end();
}

module.exports = async (req, res) => {
  if (require('./lib/rate-limit').tooMany(req, res, 'unsubscribe', 20, 60000)) return;

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const creatorId = String((req.query && req.query.c) || '');
  const email = String((req.query && req.query.e) || '').trim().toLowerCase();
  const sig = String((req.query && req.query.s) || '');

  if (!UUID_RE.test(creatorId) || !EMAIL_RE.test(email) || !sig) {
    return redirect(res, 'invalid');
  }
  if (!verify(creatorId, email, sig)) {
    return redirect(res, 'invalid');
  }

  try {
    // Upsert: clicking twice, or unsubscribing an address that is already
    // suppressed, must succeed quietly rather than 409.
    const ins = await sbFetch('subscriber_suppressions?on_conflict=creator_id,email', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: { creator_id: creatorId, email },
    });

    if (!ins.ok) {
      const body = await ins.text().catch(() => '');
      if (!(body.includes('23505') || body.toLowerCase().includes('duplicate'))) {
        throw new Error('suppression insert failed: ' + ins.status + ' ' + body.slice(0, 120));
      }
    }

    return redirect(res, 'ok');
  } catch (e) {
    console.error('unsubscribe error:', e);
    return redirect(res, 'error');
  }
};
