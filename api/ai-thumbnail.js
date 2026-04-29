// Vercel serverless function
// Analyzes a thumbnail image for clickability, composition, text readability
// POST /api/ai-thumbnail { image: "base64..." }

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
  const auth = await checkAndAuth(req, 'ai-thumbnail');
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...(auth.extras || {}) });
  const usageId = await reserveSlot(auth.userId, 'ai-thumbnail');


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
              text: `You are a brutally honest thumbnail critic for a YouTube/social-media analysis tool. Your job is to give creators ACCURATE, VARIED scores that reflect real quality differences — not safe averages.

SCORING CALIBRATION (use the full 1-100 range):
- 90-100: Pro-tier viral thumbnails. Perfect composition, instantly readable text, strong emotion, scroll-stopping. Like top MrBeast/Mark Rober work.
- 75-89: Strong, polished thumbnails. Clear focal point, good text choices, professional lighting.
- 60-74: Decent but with noticeable issues — text too small/crowded, weak focal point, average lighting.
- 40-59: Amateur. Generic composition, hard-to-read text, low emotional pull.
- 20-39: Phone-snap quality. Out of focus, no clear subject, no text or terrible text.
- 1-19: Unusable. Blurry, no thought, viewer would scroll past instantly.

CRITICAL RULES:
- DO NOT cluster scores around 70-75. Be willing to score in the 30s, 50s, 80s, 90s when warranted.
- VARY the sub-category scores meaningfully. A thumbnail strong in composition can still be weak in text readability. Don't make all 5 categories cluster within 5 points of each other.
- Reflect what you ACTUALLY SEE. If text is unreadable, score it 30, not 65.
- The overall_score should be a weighted reflection of the sub-scores, not always the average.

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

Be specific and actionable. Reference what you actually see. If there's no text in the thumbnail, score text_readability as 0 and note that adding text would help.`
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
    const text = data.content?.[0]?.text?.trim() || '';

    // Parse JSON from response (strip markdown fences if present)
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(clean);
    return res.status(200).json({ result });
  } catch (err) {
    console.error('Thumbnail analysis error:', err);
    await refundSlot(usageId); return res.status(500).json({ error: 'Failed to analyze thumbnail' });
  }
};
