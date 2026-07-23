// Vercel cron - reconciles Stripe against the subscriptions table.
//
// WHY THIS EXISTS. The billing-drift-audit SQL can only find rows that
// contradict THEMSELVES. A Stripe subscription that was cancelled or has been
// failing payment at Stripe, whose webhook never arrived, looks perfectly
// healthy in the database: the row still carries its stripe_subscription_id
// and nothing internally disagrees. The only way to catch that is to ask
// Stripe what it actually believes and compare.
//
// REPORT ONLY. This never writes. A reconciler that auto-corrects is one bug
// away from mass-downgrading paying customers, and the failure would look like
// a working job. Everything here is surfaced for a human to act on.
//
// Both directions are checked, and the second matters more than it first
// appears:
//   OVER-GRANTED  paid tier in the DB, nothing live at Stripe. Costs money.
//   UNDER-GRANTED live subscription at Stripe, tier missing. Costs a customer,
//                 and they typically churn rather than write in.
//
// Auth: Vercel cron sends CRON_SECRET, same pattern as bunny-cleanup.
//
// GET /api/cron/stripe-reconcile
// Headers: Authorization: Bearer <CRON_SECRET>
//
// Response: { summary: {...}, issues: [ { issue, user_id, ... } ] }
// The response contains user ids, so treat it as customer data.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

// Price -> tier. MUST stay in sync with create-checkout-session.ts. If a new
// price is added there and not here, its subscribers get reported as tier
// mismatches, which is the safe direction to fail but still noise.
const PRICE_TIER = {
  'price_1TIZ8pFQ1L0aeJrZEX1bQnUI': 'monthly', // Pro monthly
  'price_1TWqaNFQ1L0aeJrZvUOPWHUy': 'monthly', // Pro annual
  'price_1TWqbvFQ1L0aeJrZB9ffRvyC': 'max',     // Max monthly
  'price_1TWqctFQ1L0aeJrZJ3QdI3y5': 'max'      // Max annual
};

// Stripe statuses that should correspond to a granted tier.
const ENTITLED = ['active', 'trialing'];
// Payment is failing but access is usually kept while Stripe retries. Not an
// error, but worth surfacing: these are the ones about to become churn.
const AT_RISK = ['past_due', 'unpaid'];

const MAX_PAGES = 20; // 100 per page, so 2000 subscriptions before truncating

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}
function getStripeKey() {
  var k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error('STRIPE_SECRET_KEY not configured');
  return k;
}
function getCronSecret() {
  var v = process.env.CRON_SECRET;
  if (!v) throw new Error('CRON_SECRET not configured');
  return v;
}

// Every subscription Stripe has not cancelled. Omitting the status filter is
// deliberate: it returns active, trialing, past_due, unpaid and incomplete in
// one pass, and each is classified below from the status on the object.
async function fetchStripeSubscriptions(key) {
  var all = [];
  var startingAfter = null;
  for (var page = 0; page < MAX_PAGES; page++) {
    var url = 'https://api.stripe.com/v1/subscriptions?limit=100';
    if (startingAfter) url += '&starting_after=' + encodeURIComponent(startingAfter);
    var r = await fetch(url, { headers: { Authorization: 'Bearer ' + key } });
    if (!r.ok) {
      throw new Error('stripe list failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
    }
    var body = await r.json();
    var data = body.data || [];
    for (var i = 0; i < data.length; i++) all.push(data[i]);
    if (!body.has_more || data.length === 0) return { subs: all, truncated: false };
    startingAfter = data[data.length - 1].id;
  }
  return { subs: all, truncated: true };
}

async function fetchDbRows(serviceKey) {
  var url = SUPABASE_URL + '/rest/v1/subscriptions' +
    '?select=user_id,tier,status,source,stripe_subscription_id' +
    '&source=eq.stripe';
  var r = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey }
  });
  if (!r.ok) throw new Error('supabase read failed: ' + r.status);
  return await r.json();
}

function priceOf(sub) {
  try {
    var item = sub.items && sub.items.data && sub.items.data[0];
    return (item && item.price && item.price.id) || null;
  } catch (e) { return null; }
}

module.exports = async function handler(req, res) {
  try {
    var expected = 'Bearer ' + getCronSecret();
    if ((req.headers.authorization || '') !== expected) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  } catch (e) {
    res.status(500).json({ error: 'cron secret not configured' });
    return;
  }

  try {
    var stripeKey = getStripeKey();
    var serviceKey = getServiceKey();

    var listed = await fetchStripeSubscriptions(stripeKey);
    var stripeSubs = listed.subs;
    var dbRows = await fetchDbRows(serviceKey);

    // Index both sides by Stripe subscription id.
    var byStripeId = {};
    for (var i = 0; i < stripeSubs.length; i++) {
      byStripeId[stripeSubs[i].id] = stripeSubs[i];
    }
    var dbByStripeId = {};
    for (var j = 0; j < dbRows.length; j++) {
      var sid = dbRows[j].stripe_subscription_id;
      if (sid) dbByStripeId[sid] = dbRows[j];
    }

    var issues = [];

    // ---- Direction 1: what the database claims, checked against Stripe ----
    for (var k = 0; k < dbRows.length; k++) {
      var row = dbRows[k];
      if (!row.tier || row.tier === 'free') continue;

      if (!row.stripe_subscription_id) {
        issues.push({ issue: 'paid_tier_no_stripe_id', user_id: row.user_id, tier: row.tier });
        continue;
      }
      var sub = byStripeId[row.stripe_subscription_id];
      if (!sub) {
        // Stripe has no such live subscription. Either it was cancelled and
        // the webhook never landed, or the id is stale.
        issues.push({
          issue: 'paid_tier_not_live_at_stripe',
          user_id: row.user_id, tier: row.tier, stripe_status: 'absent'
        });
        continue;
      }
      if (AT_RISK.indexOf(sub.status) !== -1) {
        issues.push({
          issue: 'payment_failing', user_id: row.user_id,
          tier: row.tier, stripe_status: sub.status
        });
        continue;
      }
      if (ENTITLED.indexOf(sub.status) === -1) {
        issues.push({
          issue: 'paid_tier_stripe_not_entitled', user_id: row.user_id,
          tier: row.tier, stripe_status: sub.status
        });
        continue;
      }
      var expectTier = PRICE_TIER[priceOf(sub)];
      if (expectTier && expectTier !== row.tier) {
        issues.push({
          issue: 'tier_mismatch', user_id: row.user_id,
          tier: row.tier, stripe_tier: expectTier
        });
      }
    }

    // ---- Direction 2: what Stripe is billing, checked against the database ----
    // The expensive failure. Someone is being charged and has no access.
    for (var m = 0; m < stripeSubs.length; m++) {
      var s = stripeSubs[m];
      if (ENTITLED.indexOf(s.status) === -1) continue;
      var priceId = priceOf(s);
      if (!PRICE_TIER[priceId]) continue; // not one of our plan prices

      var dbRow = dbByStripeId[s.id];
      if (!dbRow) {
        issues.push({
          issue: 'stripe_active_no_db_row', stripe_subscription: s.id,
          stripe_customer: s.customer, stripe_tier: PRICE_TIER[priceId]
        });
      } else if (!dbRow.tier || dbRow.tier === 'free') {
        issues.push({
          issue: 'paying_but_no_tier', user_id: dbRow.user_id,
          stripe_tier: PRICE_TIER[priceId]
        });
      }
    }

    var counts = {};
    for (var n = 0; n < issues.length; n++) {
      counts[issues[n].issue] = (counts[issues[n].issue] || 0) + 1;
    }

    var summary = {
      stripe_subscriptions_seen: stripeSubs.length,
      db_stripe_rows: dbRows.length,
      truncated: listed.truncated,
      issue_counts: counts,
      total_issues: issues.length
    };

    if (issues.length) {
      console.error('STRIPE RECONCILE ISSUES:', JSON.stringify(summary.issue_counts));
      console.error('detail:', JSON.stringify(issues));
    } else {
      console.log('stripe reconcile clean:', JSON.stringify(summary));
    }
    if (listed.truncated) {
      console.error('STRIPE RECONCILE TRUNCATED: more than ' + (MAX_PAGES * 100) +
        ' subscriptions, raise MAX_PAGES');
    }

    res.status(200).json({ summary: summary, issues: issues });
  } catch (e) {
    console.error('stripe reconcile error:', e && e.message ? e.message : e);
    res.status(500).json({ error: 'reconcile_error', message: e && e.message ? e.message : 'unknown' });
  }
};
