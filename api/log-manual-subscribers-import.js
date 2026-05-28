// Vercel serverless function, logs a CSV bulk import event with attestation.
//
// POST /api/log-manual-subscribers-import
// Headers: Authorization: Bearer <user_access_token>
// Body: {
//   rows_imported: integer,
//   attestation_text: string,
//   attestation_version: string (defaults to 'v1')
// }
//
// Returns: 200 { id, created_at } on success
//
// This endpoint NEVER trusts user_id from the request body. It always derives
// the authenticated user from the Bearer token via Supabase /auth/v1/user.
// Per the Ryxa security rule.

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

async function sbInsert(table, row) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    var err = new Error('Supabase INSERT failed (' + res.status + '): ' + body);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  var rows = await res.json();
  return rows && rows[0];
}

async function verifyUserJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  var token = authHeader.split(' ')[1];
  try {
    var res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_ANON_KEY }
    });
    if (!res.ok) return null;
    var data = await res.json();
    return data && data.id ? { id: data.id, email: data.email } : null;
  } catch (e) {
    return null;
  }
}

function getClientIp(req) {
  // Vercel forwards the real client IP in x-forwarded-for (comma-separated chain)
  var fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Verify authenticated user
  var user = await verifyUserJWT(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Parse + validate body
  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  var rowsImported = parseInt(body.rows_imported, 10);
  if (!isFinite(rowsImported) || rowsImported < 0 || rowsImported > 10000000) {
    res.status(400).json({ error: 'Invalid rows_imported' });
    return;
  }

  var attestationText = typeof body.attestation_text === 'string' ? body.attestation_text.trim() : '';
  if (!attestationText || attestationText.length > 2000) {
    res.status(400).json({ error: 'Invalid attestation_text' });
    return;
  }

  var attestationVersion = typeof body.attestation_version === 'string' && body.attestation_version.trim()
    ? body.attestation_version.trim().substring(0, 32)
    : 'v1';

  var ipAddress = getClientIp(req);
  var userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']).substring(0, 500) : null;

  try {
    var row = await sbInsert('manual_subscriber_imports', {
      user_id: user.id,
      rows_imported: rowsImported,
      attestation_text: attestationText,
      attestation_version: attestationVersion,
      ip_address: ipAddress,
      user_agent: userAgent
    });

    res.status(200).json({
      id: row.id,
      created_at: row.created_at
    });
  } catch (e) {
    console.error('log-manual-subscribers-import failed:', e);
    res.status(500).json({ error: 'Failed to log import' });
  }
};
