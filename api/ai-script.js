// Vercel serverless function
// Script writing assistance — hook generation and text improvement
// POST /api/ai-script { mode: "hook"|"improve"|"expand"|"shorten", text: "...", topic: "..." }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { mode, text, topic } = req.body || {};
  if (!mode) return res.status(400).json({ error: 'No mode specified' });

  let prompt;
  switch (mode) {
    case 'hook':
      if (!topic || !topic.trim()) return res.status(400).json({ error: 'Provide a topic for hook generation' });
      prompt = `Generate 3 short, scroll-stopping hooks for a social media video about: "${topic.trim()}"

Each hook should be 1-2 sentences max, designed to grab attention in the first 2 seconds. Make them feel natural and conversational, not clickbaity.

Format exactly like this with no other text:

HOOK 1:
[hook text]

HOOK 2:
[hook text]

HOOK 3:
[hook text]`;
      break;

    case 'improve':
      if (!text || !text.trim()) return res.status(400).json({ error: 'No text to improve' });
      prompt = `Improve this script section to be clearer, more engaging, and better for speaking aloud on camera. Keep roughly the same length. Keep the same meaning and voice. Return ONLY the improved text, nothing else.

Original: "${text.trim()}"`;
      break;

    case 'expand':
      if (!text || !text.trim()) return res.status(400).json({ error: 'No text to expand' });
      prompt = `Expand this script section with more detail, examples, or explanation. Make it about 2x longer. Keep it conversational and easy to speak aloud. Return ONLY the expanded text, nothing else.

Original: "${text.trim()}"`;
      break;

    case 'shorten':
      if (!text || !text.trim()) return res.status(400).json({ error: 'No text to shorten' });
      prompt = `Shorten this script section to about half its length. Keep the key points and make every word count. Return ONLY the shortened text, nothing else.

Original: "${text.trim()}"`;
      break;

    default:
      return res.status(400).json({ error: 'Invalid mode' });
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
        max_tokens: 500,
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

    return res.status(200).json({ result });
  } catch (err) {
    console.error('Script AI error:', err);
    return res.status(500).json({ error: 'Failed to generate content' });
  }
};
