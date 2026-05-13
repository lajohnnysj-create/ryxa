// Vercel serverless function. receives webhook events from Bunny Stream
// when video processing transitions state (uploaded, encoded, ready, failed).
// Updates the matching course_lessons row so the UI reflects status.
//
// POST /api/bunny-webhook
// Headers: signed by Bunny's webhook signing key (see Stream library settings)
// Body (Bunny webhook payload):
//   {
//     VideoLibraryId: 123456,
//     VideoGuid: "...",
//     Status: 0|1|2|3|4|5,    // see BUNNY_STATUS_MAP below
//     ...
//   }
//
// Bunny status codes (per their docs):
//   0 = Created
//   1 = Uploaded
//   2 = Processing
//   3 = Transcoding
//   4 = Finished (= "ready")
//   5 = Error (= "failed")
//   6 = UploadFailed (= "failed")
//
// We update lesson.bunny_video_status to: 'uploading' | 'processing' | 'ready' | 'failed'

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}
function getBunnyWebhookSecret() {
  // Per Bunny's current docs (https://docs.bunny.net/stream/webhooks):
  // the webhook signing secret IS the library's Read-Only API Key.
  // There is no separate "webhook secret"; paste the library's
  // Read-Only API Key into BUNNY_STREAM_WEBHOOK_SECRET in Vercel.
  var v = process.env.BUNNY_STREAM_WEBHOOK_SECRET;
  if (!v) throw new Error('BUNNY_STREAM_WEBHOOK_SECRET not configured');
  return v;
}
function getBunnyApiKey() {
  var v = process.env.BUNNY_STREAM_API_KEY;
  if (!v) throw new Error('BUNNY_STREAM_API_KEY not configured');
  return v;
}
function getBunnyLibraryId() {
  var v = process.env.BUNNY_STREAM_LIBRARY_ID;
  if (!v) throw new Error('BUNNY_STREAM_LIBRARY_ID not configured');
  return v;
}

// ---------- Supabase ----------
async function sbUpdate(table, idCol, idVal, row) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + idCol + '=eq.' + encodeURIComponent(idVal), {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Supabase UPDATE failed (' + res.status + '): ' + body);
  }
}

// ---------- Webhook signature verification ----------
// Bunny Stream signs every webhook payload with HMAC-SHA256 using the
// library's Read-Only API Key as the signing secret. The signature is
// hex-encoded (lowercase) and arrives in the x-bunnystream-signature header,
// along with x-bunnystream-signature-version (must be "v1") and
// x-bunnystream-signature-algorithm (must be "hmac-sha256").
// Reference: https://docs.bunny.net/stream/webhooks
function verifyWebhookSignature(rawBody, signatureHeader, versionHeader, algorithmHeader, signingSecret) {
  if (versionHeader !== 'v1') return false;
  if (algorithmHeader !== 'hmac-sha256') return false;
  if (typeof signatureHeader !== 'string') return false;
  if (!/^[0-9a-f]+$/.test(signatureHeader)) return false;

  var crypto = require('crypto');
  var expectedHex = crypto.createHmac('sha256', signingSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  if (signatureHeader.length !== expectedHex.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedHex, 'utf8'),
      Buffer.from(signatureHeader, 'utf8')
    );
  } catch (e) {
    return false;
  }
}

// ---------- Bunny status → our status ----------
function mapBunnyStatus(code) {
  switch (Number(code)) {
    case 0: return 'uploading';   // Created (no upload yet. shouldn't trigger webhook)
    case 1: return 'processing';  // Uploaded, awaiting transcode
    case 2: return 'processing';  // Processing
    case 3: return 'processing';  // Transcoding
    case 4: return 'ready';       // Finished. playable
    case 5: return 'failed';      // Error
    case 6: return 'failed';      // UploadFailed
    default: return null;
  }
}

// ---------- Fetch full video metadata when encoding completes ----------
async function fetchBunnyVideoMeta(libraryId, apiKey, videoGuid) {
  var res = await fetch('https://video.bunnycdn.com/library/' + libraryId + '/videos/' + videoGuid, {
    headers: { AccessKey: apiKey, Accept: 'application/json' }
  });
  if (!res.ok) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Bunny fetch video failed (' + res.status + '): ' + body);
  }
  return await res.json();
}

// ---------- Vercel raw body reader ----------
// Vercel's default body parser would mutate JSON before we hashed it,
// breaking signature verification. We read the raw body ourselves.
function readRawBody(req) {
  return new Promise(function(resolve, reject) {
    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

// Tell Vercel not to parse the body for us (we need the raw bytes for HMAC)
module.exports.config = { api: { bodyParser: false } };

// ---------- handler ----------
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Read raw body and verify signature
    var rawBody = await readRawBody(req);
    var sig = req.headers['x-bunnystream-signature'];
    var sigVersion = req.headers['x-bunnystream-signature-version'];
    var sigAlgorithm = req.headers['x-bunnystream-signature-algorithm'];
    var secret = getBunnyWebhookSecret();

    if (!verifyWebhookSignature(rawBody, sig, sigVersion, sigAlgorithm, secret)) {
      console.warn('bunny-webhook: signature verification failed', {
        hasSig: !!sig,
        version: sigVersion,
        algorithm: sigAlgorithm
      });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 2. Parse payload
    var payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    var videoGuid = payload.VideoGuid || payload.videoGuid;
    var statusCode = payload.Status !== undefined ? payload.Status : payload.status;

    if (!videoGuid) {
      return res.status(400).json({ error: 'Missing VideoGuid' });
    }

    var ourStatus = mapBunnyStatus(statusCode);
    if (!ourStatus) {
      // Unknown status. acknowledge but don't update
      console.warn('bunny-webhook: unknown status code', statusCode);
      return res.status(200).json({ ok: true, ignored: 'unknown status' });
    }

    // 3. Build the update payload
    var update = { bunny_video_status: ourStatus };

    // 4. On 'ready', fetch full metadata to get duration + thumbnail
    if (ourStatus === 'ready') {
      try {
        var meta = await fetchBunnyVideoMeta(getBunnyLibraryId(), getBunnyApiKey(), videoGuid);
        // Bunny returns: { length, thumbnailFileName, ... }
        if (meta && typeof meta.length === 'number') {
          update.bunny_video_duration_seconds = Math.round(meta.length);
        }
        // Construct the public thumbnail URL (Bunny serves them off the CDN)
        // Pattern: https://{cdn_hostname}/{video_guid}/{thumbnailFileName}
        // But the canonical thumbnail is just /thumbnail.jpg
        var cdnHost = process.env.BUNNY_STREAM_CDN_HOSTNAME;
        if (cdnHost) {
          update.bunny_thumbnail_url =
            'https://' + cdnHost + '/' + videoGuid + '/thumbnail.jpg';
        }
      } catch (metaErr) {
        // Don't fail the whole webhook if metadata fetch hiccups -
        // we'll still mark the video as ready, and metadata can be
        // backfilled later or retrieved on first playback.
        console.warn('bunny-webhook: metadata fetch failed (non-fatal):', metaErr.message);
      }
    }

    // 5. Update the matching lesson row
    await sbUpdate('course_lessons', 'bunny_video_id', videoGuid, update);

    return res.status(200).json({ ok: true, status: ourStatus });
  } catch (err) {
    console.error('bunny-webhook error:', err);
    // Return 200 anyway? No. return 500 so Bunny will retry. They'll
    // retry transient failures, and we want that.
    return res.status(500).json({ error: err.message || 'Webhook processing failed' });
  }
};
