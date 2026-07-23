// Vercel cron - triggers the Google Play acknowledgement sweep.
//
// Google auto-refunds any purchase left unacknowledged for 3 days and revokes
// the subscription. verify-google-purchase acknowledges inline, so this only
// matters when that call did not land (cold start killed mid-request, network
// blip, Google briefly down). Without this, the grant sits in the database
// looking healthy while Google counts down to a refund, and nothing notices.
//
// This endpoint holds no Google credentials. It authenticates the cron caller
// and forwards to the google-ack-sweep edge function, which already has the
// service account key. Keeping that credential in exactly one place is the
// point: duplicating it into Vercel env would mean two copies to rotate.
//
// Auth: Vercel cron requests carry CRON_SECRET, same as bunny-cleanup. The
// onward call uses the service_role key, which the edge function accepts as a
// normal Supabase JWT, so no new secret is introduced anywhere.
//
// GET /api/cron/google-ack-sweep
// Headers: Authorization: Bearer <CRON_SECRET>
//
// Response: { checked, acknowledged, alreadyOk, failed, atRisk }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}
function getCronSecret() {
  var v = process.env.CRON_SECRET;
  if (!v) throw new Error('CRON_SECRET not configured');
  return v;
}

module.exports = async function handler(req, res) {
  try {
    var expected = 'Bearer ' + getCronSecret();
    var got = req.headers.authorization || '';
    if (got !== expected) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  } catch (e) {
    res.status(500).json({ error: 'cron secret not configured' });
    return;
  }

  try {
    var key = getServiceKey();
    var r = await fetch(SUPABASE_URL + '/functions/v1/google-ack-sweep', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    var text = await r.text();
    if (!r.ok) {
      console.error('ack sweep failed:', r.status, text);
      res.status(502).json({ error: 'sweep_failed', status: r.status });
      return;
    }
    var body;
    try { body = JSON.parse(text); } catch (e) { body = { raw: text }; }

    // Surface at-risk purchases in the Vercel log too, so they are visible
    // without opening the Supabase dashboard. These are purchases past 48
    // hours unacknowledged, meaning the inline acknowledge has been failing
    // and the sweep is the only thing preventing a refund.
    if (body && Array.isArray(body.atRisk) && body.atRisk.length) {
      console.error('UNACKNOWLEDGED PURCHASES NEAR DEADLINE:', body.atRisk.join(', '));
    }

    res.status(200).json(body);
  } catch (e) {
    console.error('ack sweep error:', e && e.message ? e.message : e);
    res.status(500).json({ error: 'sweep_error' });
  }
};
