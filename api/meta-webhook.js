// /api/meta-webhook.js
//
// Minimal webhook endpoint for Meta (Instagram Login / Facebook Graph) webhook setup.
//
// Purpose: Satisfy Meta's "Configure webhooks" requirement during app review.
// We don't currently subscribe to or act on any events — this just ensures the
// callback URL is verifiable and signature-validating per Meta's spec.
//
// Required environment variables (set in Vercel):
//   META_WEBHOOK_VERIFY_TOKEN — the verify token you entered in Meta dashboard
//   META_APP_SECRET           — your Facebook app secret (App Settings > Basic)
//
// Endpoint URL to give Meta: https://ryxa.io/api/meta-webhook

import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: false, // We need the raw body for signature verification
  },
};

// Read the raw request body as a Buffer
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Constant-time comparison so timing attacks can't probe the token
function safeEqual(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// Verify the X-Hub-Signature-256 header matches the body, signed with app secret
function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;
  if (!signatureHeader.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  try {
    return safeEqual(expected, signatureHeader);
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  // ----- GET: Meta's webhook verification challenge -----
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

    if (!expectedToken) {
      console.error('META_WEBHOOK_VERIFY_TOKEN env var is not set');
      return res.status(500).send('Server misconfigured');
    }

    if (mode === 'subscribe' && token === expectedToken) {
      // Echo back the challenge as plain text — Meta requires this exact behavior
      return res.status(200).send(challenge);
    }

    return res.status(403).send('Forbidden');
  }

  // ----- POST: Incoming webhook events -----
  if (req.method === 'POST') {
    let rawBody;
    try {
      rawBody = await readRawBody(req);
    } catch (e) {
      console.error('Failed to read webhook body:', e);
      return res.status(400).send('Bad request');
    }

    const signature = req.headers['x-hub-signature-256'];
    const appSecret = process.env.META_APP_SECRET;

    if (!appSecret) {
      console.error('META_APP_SECRET env var is not set');
      return res.status(500).send('Server misconfigured');
    }

    if (!verifySignature(rawBody, signature, appSecret)) {
      console.warn('Webhook signature verification failed');
      return res.status(401).send('Invalid signature');
    }

    // Signature is valid. Log for visibility but take no action.
    // When you're ready to act on events, parse rawBody as JSON here:
    //   const event = JSON.parse(rawBody.toString('utf8'));
    //   handle event.entry[*].changes[*] etc.
    try {
      const parsed = JSON.parse(rawBody.toString('utf8'));
      console.log('Meta webhook event received:', JSON.stringify(parsed).slice(0, 500));
    } catch (e) {
      console.log('Meta webhook event received (non-JSON body)');
    }

    // Always respond quickly — Meta retries if you don't 200 within ~20s
    return res.status(200).send('OK');
  }

  // Any other method
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).send('Method Not Allowed');
}
