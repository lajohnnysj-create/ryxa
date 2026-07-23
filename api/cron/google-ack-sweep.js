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
const NOTIFICATION_TO = 'hello@ryxa.io';
const NOTIFICATION_FROM = 'Ryxa <hello@ryxa.io>';

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

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Only sent when something needed a late acknowledgement or one failed. A
// normal run is silent, so mail arriving means the inline acknowledge in
// verify-google-purchase is not landing, and purchases were within hours of
// being auto-refunded by Google.
async function sendAckAlert(body) {
  var key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('RESEND_API_KEY not set, skipping ack alert'); return; }
  var atRisk = Array.isArray(body.atRisk) ? body.atRisk : [];
  var html =
    '<h2>Google Play acknowledgement sweep needed to act</h2>' +
    '<p>Google auto-refunds any purchase left unacknowledged for 72 hours. ' +
    'verify-google-purchase acknowledges inline, so this sweep having work to ' +
    'do means that path is failing.</p>' +
    '<ul>' +
    '<li>Checked: ' + escapeHtml(body.checked) + '</li>' +
    '<li>Acknowledged late: <strong>' + escapeHtml(body.acknowledged) + '</strong></li>' +
    '<li>Already fine: ' + escapeHtml(body.alreadyOk) + '</li>' +
    '<li>Failed: <strong>' + escapeHtml(body.failed) + '</strong></li>' +
    '</ul>' +
    (atRisk.length
      ? '<p style="color:#b00;"><strong>Past 48 hours unacknowledged:</strong><br>' +
        escapeHtml(atRisk.join(', ')) + '</p>'
      : '') +
    '<p style="color:#666;font-size:12px;">Acknowledgement only. No tier was changed.</p>';
  try {
    var r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: NOTIFICATION_FROM,
        to: [NOTIFICATION_TO],
        subject: 'Google Play ack sweep: ' + body.acknowledged + ' late, ' + body.failed + ' failed',
        html: html
      })
    });
    if (!r.ok) console.warn('ack alert email failed:', r.status);
  } catch (e) {
    console.warn('ack alert email exception (non-fatal):', e.message);
  }
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
    // Alert only when the sweep actually had to do something, or could not.
    // A clean run stays silent so the mail keeps its meaning.
    if (body && ((body.acknowledged || 0) > 0 || (body.failed || 0) > 0)) {
      await sendAckAlert(body);
    }

    res.status(200).json(body);
  } catch (e) {
    console.error('ack sweep error:', e && e.message ? e.message : e);
    res.status(500).json({ error: 'sweep_error' });
  }
};
