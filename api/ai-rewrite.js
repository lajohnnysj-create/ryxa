// Vercel serverless function
// Receives text, returns 3 rewritten variations
// POST /api/ai-rewrite { text: "..." }

const { checkAndAuth, reserveSlot, refundSlot } = require('./_ai-rate-limit.js');

module.exports = async (req, res) => {
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
  const auth = await checkAndAuth(req, 'ai-rewrite');
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...(auth.extras || {}) });
  const usageId = await reserveSlot(auth.userId, 'ai-rewrite');


  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });

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
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: 'Rewrite this text in 3 different ways. Keep each version roughly the same length as the original. Format your response exactly like this with no other text:\n\nPROFESSIONAL:\n[rewrite]\n\nCASUAL:\n[rewrite]\n\nCREATIVE:\n[rewrite]\n\nOriginal text: "' + text.trim() + '"'
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      await refundSlot(usageId); return res.status(500).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const result = data.content?.[0]?.text?.trim() || '';
    return res.status(200).json({ rewrites: result });
  } catch (err) {
    console.error('Rewrite error:', err);
    await refundSlot(usageId); return res.status(500).json({ error: 'Failed to generate rewrites' });
  }
};
