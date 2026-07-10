// /api/confirm-resubscribe.js
//
// The ONE place in Ryxa where a suppression is lifted.
//
// Everything else can only tighten consent: a creator opting someone out, an
// import that skips suppressed addresses, a Kit unsubscribe webhook. Only the
// subscriber can loosen it, and the proof that they are the subscriber is that
// this link arrived in their inbox.
//
// Guards, all required:
//   1. Token exists, matched by SHA-256 hash (we never store the raw token)
//   2. Not expired (24h)
//   3. Not already used (single-use, enforced by a conditional update)
//   4. Creator and email come from the TOKEN ROW, never from the request
//
// Guard 4 is the important one. A signed or unguessable link still must not
// let the holder name whose suppression to lift.

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

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

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function redirect(res, status) {
  res.writeHead(302, { Location: '/resubscribed.html?status=' + status });
  res.end();
}

module.exports = async (req, res) => {
  // Per-IP limiter: this endpoint is reachable by anyone with a URL.
  if (require('./lib/rate-limit').tooMany(req, res, 'confirm-resubscribe', 20, 60000)) return;

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const raw = (req.query && req.query.token) || '';
  if (!raw || typeof raw !== 'string' || raw.length < 20) {
    return redirect(res, 'invalid');
  }

  try {
    const tokenHash = hashToken(raw);

    // 1 + 2 + 3: find a token that is unused and unexpired.
    const lookup = await sbFetch(
      'bio_resubscribe_tokens?token_hash=eq.' + encodeURIComponent(tokenHash) +
      '&used_at=is.null&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) +
      '&select=id,creator_id,email&limit=1'
    );
    if (!lookup.ok) throw new Error('token lookup failed: ' + lookup.status);
    const rows = await lookup.json();
    if (!rows || rows.length === 0) {
      // Expired, already used, or never existed. One answer for all three: a
      // distinct "already used" message would tell a link-holder that somebody
      // confirmed, which they have no right to know.
      return redirect(res, 'invalid');
    }

    const token = rows[0];
    const creatorId = token.creator_id;   // Guard 4: from the row, not the URL
    const email = token.email;

    // Burn the token FIRST, conditional on it still being unused. If two
    // clicks race, exactly one update matches and the loser gets zero rows.
    const burn = await sbFetch(
      'bio_resubscribe_tokens?id=eq.' + encodeURIComponent(token.id) + '&used_at=is.null',
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { used_at: new Date().toISOString() },
      }
    );
    if (!burn.ok) throw new Error('token burn failed: ' + burn.status);
    const burned = await burn.json();
    if (!burned || burned.length === 0) {
      return redirect(res, 'invalid');   // lost the race; already spent
    }

    // Lift the suppression. This is the loosening, and it happens only here.
    const del = await sbFetch(
      'subscriber_suppressions?creator_id=eq.' + encodeURIComponent(creatorId) +
      '&email=ilike.' + encodeURIComponent(email),
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    );
    if (!del.ok) throw new Error('suppression delete failed: ' + del.status);

    // Record the consent, with when and where. This is the sentence that ends
    // a complaint: "they confirmed by email on the 9th."
    const ins = await sbFetch('bio_email_signups', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: {
        creator_id: creatorId,
        email,
        consented_at: new Date().toISOString(),
        consent_source: 'bio_resubscribe',
      },
    });

    if (!ins.ok) {
      const body = await ins.text().catch(() => '');
      // A row already exists (they originally signed up via the form). The
      // suppression is lifted, which is what actually governs delivery, so
      // update the audit fields rather than failing.
      if (body.includes('23505') || body.toLowerCase().includes('duplicate')) {
        await sbFetch(
          'bio_email_signups?creator_id=eq.' + encodeURIComponent(creatorId) +
          '&email=ilike.' + encodeURIComponent(email),
          {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: {
              consented_at: new Date().toISOString(),
              consent_source: 'bio_resubscribe',
            },
          }
        );
      } else {
        throw new Error('signup insert failed: ' + ins.status + ' ' + body.slice(0, 120));
      }
    }

    return redirect(res, 'ok');
  } catch (e) {
    console.error('confirm-resubscribe error:', e);
    return redirect(res, 'error');
  }
};
