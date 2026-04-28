// Vercel serverless function — returns the file list for a product the
// buyer owns. Verifies a completed purchase before returning.
//
// POST /api/list-product-files
// Headers: Authorization: Bearer <buyer_access_token>
// Body: { product_id }
//
// Response: { files: [{ id, filename, file_size_bytes }] }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTcxMzEsImV4cCI6MjA5MDg5MzEzMX0.VC8mcU5lUeA56kG2gHssvl88EVWr018XttA86jpfEn0';

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

module.exports = async (req, res) => {
  var origin = req.headers.origin || '';
  var allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var buyer = await verifyBuyerJWT(req.headers.authorization || '');
    if (!buyer) {
      return res.status(401).json({ error: 'You must be signed in' });
    }

    var body = req.body || {};
    var productId = body.product_id;
    if (!productId) {
      return res.status(400).json({ error: 'Missing product_id' });
    }

    // Verify buyer has a completed purchase for this product
    var purchases = await sbSelect('digital_product_purchases?product_id=eq.' + encodeURIComponent(productId) + '&buyer_user_id=eq.' + encodeURIComponent(buyer.id) + '&status=eq.completed&select=id&limit=1');
    if (!purchases || purchases.length === 0) {
      return res.status(403).json({ error: 'You do not own this product' });
    }

    // Return file metadata only (no storage paths)
    var files = await sbSelect('digital_product_files?product_id=eq.' + encodeURIComponent(productId) + '&select=id,filename,file_size_bytes,sort_order&order=sort_order.asc');

    return res.status(200).json({ files: files || [] });
  } catch (err) {
    console.error('list-product-files error:', err);
    return res.status(500).json({ error: err.message || 'Could not load files' });
  }
};
