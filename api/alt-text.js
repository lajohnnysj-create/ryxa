// Vercel serverless function
// Receives a base64 image, sends to Claude for alt text generation
// POST /api/alt-text { image: "data:image/...;base64,..." }

const { checkAndAuth, reserveSlot, refundSlot } = require('./_ai-rate-limit.js');

module.exports = async (req, res) => {
  // CORS
  const origin = req.headers.origin || '';
  const allowed = ['https://ryxa.io', 'https://www.ryxa.io', 'http://localhost:3000'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // Auth + rate limit
  const auth = await checkAndAuth(req, 'alt-text');
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...(auth.extras || {}) });
  const usageId = await reserveSlot(auth.userId, 'alt-text');


  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'No image provided' });

  // Extract base64 data and media type
  const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Invalid image format' });

  const mediaType = match[1];
  const base64Data = match[2];

  // Limit size (~5MB base64)
  if (base64Data.length > 7 * 1024 * 1024) {
    return res.status(400).json({ error: 'Image too large. Max 5MB.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data
              }
            },
            {
              type: 'text',
              text: 'Write a concise, descriptive alt text for this image in one sentence. Focus on what is visually depicted — the subject, action, setting, and any important details. Do not start with "An image of" or "A photo of". Just describe what is shown. Keep it under 125 characters if possible.'
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      await refundSlot(usageId); return res.status(500).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const altText = data.content?.[0]?.text?.trim() || '';
    return res.status(200).json({ alt: altText });
  } catch (err) {
    console.error('Alt text error:', err);
    await refundSlot(usageId); return res.status(500).json({ error: 'Failed to generate alt text' });
  }
};
