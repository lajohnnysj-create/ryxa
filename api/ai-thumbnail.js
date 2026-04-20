// Vercel serverless function
// Analyzes a thumbnail image for clickability, composition, text readability
// POST /api/ai-thumbnail { image: "base64..." }

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

  // Auth: verify Supabase JWT
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const authRes = await fetch('https://kjytapcgxukalwsyputk.supabase.co/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXRhcGNneHVrYWx3c3lwdXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTcxMzEsImV4cCI6MjA5MDg5MzEzMX0.VC8mcU5lUeA56kG2gHssvl88EVWr018XttA86jpfEn0' }
    });
    if (!authRes.ok) return res.status(401).json({ error: 'Unauthorized' });
  } catch (e) { return res.status(401).json({ error: 'Auth verification failed' }); }


  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'No image provided' });
  if (image.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max 5MB)' });

  // Strip data URL prefix if present
  const base64Data = image.replace(/^data:image\/[a-z]+;base64,/, '');
  const mediaType = image.startsWith('data:image/png') ? 'image/png'
    : image.startsWith('data:image/webp') ? 'image/webp'
    : 'image/jpeg';

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
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data }
            },
            {
              type: 'text',
              text: `You are a thumbnail analysis expert. Analyze this thumbnail image and rate it.

Respond ONLY with valid JSON in this exact format, no other text:
{
  "overall_score": <number 1-100>,
  "composition": { "score": <number 1-100>, "feedback": "<1-2 sentences>" },
  "text_readability": { "score": <number 1-100>, "feedback": "<1-2 sentences>" },
  "emotional_impact": { "score": <number 1-100>, "feedback": "<1-2 sentences>" },
  "color_contrast": { "score": <number 1-100>, "feedback": "<1-2 sentences>" },
  "clickability": { "score": <number 1-100>, "feedback": "<1-2 sentences>" },
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>", "<improvement 3>"]
}

Be specific and actionable. Reference what you actually see in the image. If there's no text in the thumbnail, score text_readability as 0 and note that adding text would help.`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(500).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text?.trim() || '';

    // Parse JSON from response (strip markdown fences if present)
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json({ result });
  } catch (err) {
    console.error('Thumbnail analysis error:', err);
    return res.status(500).json({ error: 'Failed to analyze thumbnail' });
  }
};
