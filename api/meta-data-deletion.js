// Vercel serverless function — Meta Data Deletion Callback
// ==========================================================
// Meta calls this endpoint when a user removes the Ryxa app
// from their Instagram/Facebook settings, OR when they request
// data deletion via Meta's privacy tools.
//
// The Instagram Graph API spec:
//   https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
//
// Deploy to: /api/meta-data-deletion.js
// Configure URL in Meta App Dashboard:
//   https://ryxa.io/api/meta-data-deletion
// ==========================================================

const crypto = require('crypto');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_APP_SECRET = process.env.META_APP_SECRET;
const PUBLIC_BASE_URL = 'https://ryxa.io';

// ----- helpers --------------------------------------------------

// Decode base64url, supporting both with-padding and without
function base64UrlDecode(str) {
  // Restore padding
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

// Verify Meta's signed_request HMAC and return parsed payload, or null
function parseSignedRequest(signedRequest) {
  if (!signedRequest || typeof signedRequest !== 'string') return null;
  const parts = signedRequest.split('.');
  if (parts.length !== 2) return null;

  const [encodedSig, encodedPayload] = parts;
  let expectedSig;
  let payload;
  try {
    expectedSig = base64UrlDecode(encodedSig);
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
  } catch (e) {
    console.error('Failed to decode signed_request:', e.message);
    return null;
  }

  if (!META_APP_SECRET) {
    console.error('META_APP_SECRET env var not set');
    return null;
  }

  // Meta uses HMAC-SHA256 with the app secret
  const expectedAlgorithm = (payload && payload.algorithm) || '';
  if (expectedAlgorithm.toUpperCase() !== 'HMAC-SHA256') {
    console.error('Unexpected algorithm in signed_request:', expectedAlgorithm);
    return null;
  }

  const computedSig = crypto
    .createHmac('sha256', META_APP_SECRET)
    .update(encodedPayload)
    .digest();

  // Constant-time comparison
  if (
    expectedSig.length !== computedSig.length ||
    !crypto.timingSafeEqual(expectedSig, computedSig)
  ) {
    console.error('signed_request signature mismatch');
    return null;
  }

  return payload;
}

// Generate a confirmation code: 32 lowercase alphanumeric characters
function generateConfirmationCode() {
  return crypto.randomBytes(16).toString('hex');
}

// Supabase REST helpers using fetch (no SDK to keep cold start fast)
async function sbRequest(path, init = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ----- main handler --------------------------------------------

module.exports = async function handler(req, res) {
  // CORS — Meta sends server-to-server, no browser involved, but allow OPTIONS for safety
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!META_APP_SECRET || !SUPABASE_SERVICE_KEY) {
    console.error('Missing required env vars');
    return res.status(500).json({ error: 'Server not configured' });
  }

  // Meta sends body as form-encoded with `signed_request` field
  const signedRequest =
    (req.body && (req.body.signed_request || req.body['signed_request'])) ||
    null;

  if (!signedRequest) {
    return res.status(400).json({ error: 'Missing signed_request' });
  }

  const payload = parseSignedRequest(signedRequest);
  if (!payload) {
    return res.status(400).json({ error: 'Invalid signed_request' });
  }

  // Meta payload contains user_id (Instagram-scoped user ID)
  const igUserId = payload.user_id;
  if (!igUserId) {
    console.error('signed_request missing user_id:', payload);
    return res.status(400).json({ error: 'Missing user_id in payload' });
  }

  const code = generateConfirmationCode();

  // ---- Delete the user's Instagram connection data ----
  // Note: instagram_connections table will be created in a later step
  // when we build the OAuth flow. This endpoint handles its absence
  // gracefully so it works during Meta's review process even if no
  // user has connected yet.
  let deletionNote = '';
  try {
    // Try to delete from instagram_connections (table may not exist yet during initial review)
    const igUserIdEncoded = encodeURIComponent(igUserId);
    const deleteRes = await fetch(
      SUPABASE_URL +
        '/rest/v1/instagram_connections?ig_user_id=eq.' +
        igUserIdEncoded,
      {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
          Prefer: 'return=representation'
        }
      }
    );

    if (deleteRes.ok) {
      const deletedRows = await deleteRes.json().catch(() => []);
      deletionNote = `deleted ${deletedRows.length} connection row(s)`;
    } else if (deleteRes.status === 404 || deleteRes.status === 406) {
      // Table doesn't exist yet — ok during pre-launch
      deletionNote = 'no connection table yet (pre-launch)';
    } else {
      const errText = await deleteRes.text();
      console.error('Delete error:', deleteRes.status, errText);
      deletionNote = 'delete error: ' + deleteRes.status;
    }
  } catch (e) {
    console.error('Delete exception:', e.message);
    deletionNote = 'exception: ' + e.message;
  }

  // ---- Log the deletion request for the status page ----
  try {
    await sbRequest('instagram_deletion_requests', {
      method: 'POST',
      body: JSON.stringify({
        confirmation_code: code,
        ig_user_id: String(igUserId),
        completed_at: new Date().toISOString(),
        status: 'completed',
        notes: deletionNote
      })
    });
  } catch (e) {
    // Logging failure shouldn't break the response to Meta
    console.error('Failed to log deletion request:', e.message);
  }

  // ---- Respond to Meta with the required JSON shape ----
  // Meta expects: { url: "...", confirmation_code: "..." }
  return res.status(200).json({
    url: PUBLIC_BASE_URL + '/data-deletion-status?code=' + code,
    confirmation_code: code
  });
};
