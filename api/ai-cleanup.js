// Vercel serverless function
// Cleans up text — fixes grammar, spelling, punctuation, and readability
// Does NOT generate new content, only polishes what's already written
// POST /api/ai-cleanup { text: "..." }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

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
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Clean up the following text. Fix grammar, spelling, punctuation, and improve readability. Do NOT add new content, change the meaning, or rewrite it in a different style. Keep the author's voice and intent. Only polish what's already there. Return ONLY the cleaned-up text, nothing else.

Text: "${text.trim()}"`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(500).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const result = data.content?.[0]?.text?.trim() || '';
    return res.status(200).json({ result });
  } catch (err) {
    console.error('Cleanup error:', err);
    return res.status(500).json({ error: 'Failed to clean up text' });
  }
};
