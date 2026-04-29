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
              text: `You are a thoughtful thumbnail critic helping working creators improve their click-through. Score thumbnails on how well they execute their PURPOSE — not against pro studio benchmarks.

CRITICAL FRAMING: Judge each thumbnail relative to what it's TRYING to be. A vlog thumbnail isn't trying to be a MrBeast thumbnail. A tutorial thumbnail has different goals than a comedy one. A thumbnail that does its specific job well deserves a high score.

SCORING ANCHORS (with concrete examples):

90-100 (A range): The thumbnail nails its job. Strong, varied work that stops scrolls in its target audience.
- Examples: A MrBeast challenge thumbnail (vivid expression + clear stakes), a Mark Rober science thumbnail (compelling visual + clear topic), a polished tutorial thumbnail with bold readable text and a clear focal subject.
- These thumbnails would score 90+. Don't hesitate to give A range when the work is solid.

80-89 (B range): Strong execution with one or two minor weaknesses. The level a working full-time creator hits regularly.
- Examples: A vlog thumbnail with good lighting and a clear face but slightly small text, a podcast thumbnail with strong typography but a less dynamic photo.

70-79 (C range): Solid foundation but multiple areas could improve. Many creator uploads will land here.
- Examples: A clear focal point but generic background, decent text but no emotional pull, good photo but text crowded.

60-69 (D range): Multiple meaningful issues. Generic composition, weak text, or low emotional pull.
- Examples: A busy composition without a clear subject, hard-to-read text on cluttered background.

Below 60 (F): Real problems that hurt clicks.
- Examples: Blurry/out-of-focus, no clear subject, illegible or absent text on important content.

CRITICAL RULES:
- A pro-tier thumbnail (MrBeast, top YouTubers, polished design work) MUST score 88+. If you're scoring such a thumbnail in the 70s, you're being too harsh. Recalibrate.
- Don't cluster scores around 70-75. Use the full range.
- VARY sub-category scores meaningfully. A great composition (88) can coexist with weak text (62). Don't force them within 5 points of each other.
- Be ENCOURAGING in feedback. Lead with what works, then give clear improvement direction.
- Reflect what you ACTUALLY SEE.

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
