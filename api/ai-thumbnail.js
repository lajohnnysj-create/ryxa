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
              text: `You are a thoughtful, encouraging thumbnail critic for working creators. Your goal is HONEST, VARIED scores that reflect real differences between thumbnails — not safe averages, but also not punishingly harsh. You're advising a creator who is actively trying, not judging against pro studio work.

SCORING CALIBRATION (use the full range, but center your distribution around 65-80 for typical creator uploads):
- 90-100: Exceptional. Pro-tier execution — perfect composition, instantly readable text, scroll-stopping emotion. Rare. Reserve for genuinely outstanding work.
- 80-89: Very strong. Polished, clear focal point, good text hierarchy, solid emotional pull. The level a successful working creator hits regularly.
- 70-79: Solid. Well-executed with one or two areas to improve. This is the realistic creator average — not "average quality" but "doing the fundamentals right with room to grow."
- 60-69: Decent foundation but needs work. Composition or text or emotion is noticeably weak.
- 45-59: Multiple meaningful issues. Generic composition, hard-to-read text, low emotional pull.
- 25-44: Significant problems. Blurry focal point, unreadable or absent text, no emotional hook.
- 1-24: Unusable. No thought, would be scrolled past instantly.

CRITICAL RULES:
- DON'T cluster every thumbnail at 70 OR at 50. Be honest about what's actually strong vs. weak.
- VARY the sub-category scores meaningfully. A thumbnail can be strong in composition (80) but weak in text readability (55). Don't make all 5 cluster within 5 points of each other unless they genuinely are.
- The overall_score should reflect the WEIGHTED reality of the sub-scores, but lean slightly toward what would feel motivating and actionable.
- Be ENCOURAGING in feedback even when scoring lower — point out what works, then give clear improvement direction.
- Reflect what you ACTUALLY SEE. If text is unreadable, score it accordingly — but don't pile on.

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
