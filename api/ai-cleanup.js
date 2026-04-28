// Vercel serverless function
// Cleans up text — fixes grammar, spelling, punctuation, and readability
// Does NOT generate new content, only polishes what's already written
// POST /api/ai-cleanup { text: "..." }

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
  const auth = await checkAndAuth(req, 'ai-cleanup');
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...(auth.extras || {}) });


  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });
  if (text.length > 10000) return res.status(400).json({ error: 'Text too long (max 10,000 characters)' });

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
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Clean up the following text. Fix grammar, spelling, punctuation, and improve readability. Do NOT add new content, change the meaning, or rewrite it in a different style. Keep the author's voice and intent. Only polish what's already there. Return ONLY the cleaned-up text with no quotes or extra formatting.

Text:
${text.trim()}`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(500).json({ error: 'AI service error' });
    }

    const data = await response.json();
    let result = data.content?.[0]?.text?.trim() || '';
    // Strip wrapping quotes if AI added them
    if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith('\u201c') && result.endsWith('\u201d'))) {
      result = result.slice(1, -1).trim();
    }
    recordUsage(auth.userId, 'ai-cleanup', auth.sb);
    return res.status(200).json({ result });
  } catch (err) {
    console.error('Cleanup error:', err);
    return res.status(500).json({ error: 'Failed to clean up text' });
  }
};
