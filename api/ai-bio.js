// Vercel serverless function
// Bio writing assistance — improve existing bio or generate from scratch
// POST /api/ai-bio { text: "...", maxLength: 60, mode: "improve"|"generate" }

const { checkAndAuth, recordUsage } = require('./_ai-rate-limit.js');

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
  const auth = await checkAndAuth(req, 'ai-bio');
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...(auth.extras || {}) });

  const { text, maxLength, mode } = req.body || {};
  const limit = maxLength || 60;

  let prompt;
  if (mode === 'generate') {
    prompt = `Write 3 short, engaging creator bios. Each must be under ${limit} characters. They should sound personal, confident, and authentic — not generic or corporate. Format exactly like this:\n\nBIO 1:\n[bio text]\n\nBIO 2:\n[bio text]\n\nBIO 3:\n[bio text]`;
  } else {
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });
    prompt = `Rewrite this creator bio in 3 different ways. Each version must be under ${limit} characters. Keep it personal and authentic. Do not use emojis unless the original has them.\n\nOriginal: "${text.trim()}"\n\nFormat exactly like this:\n\nBIO 1:\n[bio text]\n\nBIO 2:\n[bio text]\n\nBIO 3:\n[bio text]`;
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
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(500).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const result = data.content?.[0]?.text?.trim() || '';

    // Record usage AFTER success (fire-and-forget)
    recordUsage(auth.userId, 'ai-bio', auth.sb);

    return res.status(200).json({ result });
  } catch (err) {
    console.error('Bio AI error:', err);
    return res.status(500).json({ error: 'Failed to generate bio' });
  }
};
