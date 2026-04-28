// Vercel serverless function — generates a 5-minute signed download URL
// for a digital product file. Verifies that the requesting buyer owns
// a completed purchase of the product, then returns a signed URL.
//
// POST /api/download-product-file
// Headers: Authorization: Bearer <buyer_access_token>
// Body: { file_id }
//
// Response: { url, expires_at }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTcxMzEsImV4cCI6MjA5MDg5MzEzMX0.VC8mcU5lUeA56kG2gHssvl88EVWr018XttA86jpfEn0';

const SIGNED_URL_EXPIRES_SECONDS = 300;  // 5 minutes

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

async function sbSelect(path) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    throw new Error('Supabase SELECT failed (' + res.status + '): ' + body);
  }
  return await res.json();
}

async function sbInsert(table, row) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    throw new Error('Supabase INSERT failed (' + res.status + '): ' + body);
  }
  return res.status === 201;
}

async function sbUpdate(table, id, row) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    throw new Error('Supabase UPDATE failed (' + res.status + '): ' + body);
  }
}

async function verifyBuyerJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  var token = authHeader.split(' ')[1];
  try {
    var res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY }
    });
    if (!res.ok) return null;
    var data = await res.json();
    return data?.id ? { id: data.id, email: data.email } : null;
  } catch (e) {
    return null;
  }
}

// Create a signed URL via Supabase Storage REST API
async function createSignedUrl(bucket, path, expiresIn) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/storage/v1/object/sign/' + bucket + '/' + encodeURI(path), {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expiresIn: expiresIn })
  });
  if (!res.ok) {
    var body = await res.text().catch(() => '');
    throw new Error('Sign URL failed (' + res.status + '): ' + body);
  }
  var data = await res.json();
  // Returns { signedURL: "/object/sign/..." } — prefix with SUPABASE_URL/storage/v1
  if (!data?.signedURL) throw new Error('No signedURL in response');
  return SUPABASE_URL + '/storage/v1' + data.signedURL;
}

module.exports = async (req, res) => {
  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Verify buyer is signed in
    var buyer = await verifyBuyerJWT(req.headers.authorization || '');
    if (!buyer) {
      return res.status(401).json({ error: 'You must be signed in to download' });
    }

    // 2. Parse body
    var body = req.body || {};
    var fileId = body.file_id;
    if (!fileId) {
      return res.status(400).json({ error: 'Missing file_id' });
    }

    // 3. Load the file + its product
    var files = await sbSelect('digital_product_files?id=eq.' + encodeURIComponent(fileId) + '&select=id,product_id,filename,storage_path,scan_status&limit=1');
    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    var file = files[0];

    // 4. Block if file is flagged (Phase 4 virus scanning will use this)
    if (file.scan_status === 'infected') {
      return res.status(403).json({ error: 'This file is unavailable. Please contact the creator.' });
    }
    if (file.scan_status === 'pending') {
      return res.status(425).json({ error: 'This file is still being scanned. Try again in a moment.' });
    }

    // 5. Verify the buyer has a completed purchase for this product
    var purchases = await sbSelect('digital_product_purchases?product_id=eq.' + encodeURIComponent(file.product_id) + '&buyer_user_id=eq.' + encodeURIComponent(buyer.id) + '&status=eq.completed&select=id&limit=1');
    if (!purchases || purchases.length === 0) {
      return res.status(403).json({ error: 'You do not own this product' });
    }
    var purchase = purchases[0];

    // 6. Generate signed URL
    var signedUrl = await createSignedUrl('digital-products', file.storage_path, SIGNED_URL_EXPIRES_SECONDS);
    var expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRES_SECONDS * 1000).toISOString();

    // 7. Log the download (best-effort — don't block on logging failures)
    try {
      var ipAddress = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.headers['x-real-ip'] || '');
      var userAgent = (req.headers['user-agent'] || '').slice(0, 500);

      await sbInsert('digital_product_download_log', {
        purchase_id: purchase.id,
        product_id: file.product_id,
        file_id: file.id,
        buyer_user_id: buyer.id,
        ip_address: ipAddress || null,
        user_agent: userAgent || null
      });

      // Bump download_count + last_downloaded_at on the purchase row
      var nowIso = new Date().toISOString();
      var key = getServiceKey();
      await fetch(SUPABASE_URL + '/rest/v1/rpc/increment_dpp_download_count', {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_purchase_id: purchase.id })
      }).catch(function() { /* RPC might not exist yet — ignore */ });
    } catch (logErr) {
      console.error('Download log failed (non-fatal):', logErr);
    }

    return res.status(200).json({
      url: signedUrl,
      filename: file.filename,
      expires_at: expiresAt
    });
  } catch (err) {
    console.error('download-product-file error:', err);
    return res.status(500).json({ error: err.message || 'Could not generate download link' });
  }
};
