// Vercel serverless function
// Analyzes a brand deal contract PDF text and returns structured report
// POST /api/ai-contract { text: "extracted PDF text..." }

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
  const auth = await checkAndAuth(req, 'ai-contract');
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...(auth.extras || {}) });


  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'No contract text provided' });

  // Limit text to ~15000 chars to keep costs down
  const contractText = text.trim().substring(0, 15000);

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
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `You are a contract analysis expert for content creators. Analyze this brand deal contract and extract key details.

Respond ONLY with valid JSON in this exact format, no other text:
{
  "parties": {
    "brand": "<brand/company name or 'Not specified'>",
    "creator": "<creator name or 'Not specified'>"
  },
  "payment": {
    "amount": "<payment amount or 'Not specified'>",
    "schedule": "<when payment is due, e.g. 'Net 30 after delivery' or 'Not specified'>",
    "kill_fee": "<kill fee terms or 'None mentioned'>"
  },
  "deliverables": [
    "<deliverable 1, e.g. '1 Instagram Reel, 30-60 seconds'>",
    "<deliverable 2>",
    "<deliverable 3>"
  ],
  "timeline": {
    "start_date": "<start date or 'Not specified'>",
    "end_date": "<end date or 'Not specified'>",
    "content_deadline": "<when content must be delivered or 'Not specified'>",
    "review_period": "<how long brand has to review or 'Not specified'>"
  },
  "usage_rights": {
    "summary": "<1-2 sentence summary of how the brand can use the content>",
    "duration": "<how long they can use it, e.g. '12 months', 'perpetual', or 'Not specified'>",
    "platforms": "<where they can use it or 'Not specified'>"
  },
  "exclusivity": {
    "has_exclusivity": true/false,
    "details": "<exclusivity terms or 'No exclusivity clause found'>",
    "duration": "<exclusivity period or 'N/A'>"
  },
  "content_ownership": "<who owns the content after creation>",
  "termination": "<how either party can end the contract>",
  "red_flags": [
    "<red flag 1 — specific concern with why it matters>",
    "<red flag 2>"
  ],
  "misc_details": [
    "<any other notable clause or detail 1>",
    "<detail 2>",
    "<detail 3>"
  ],
  "overall_assessment": "<2-3 sentence overall take on the contract from a creator's perspective>"
}

Be specific. Reference actual terms from the contract. If a section is not covered in the contract, say "Not specified" or "Not mentioned". For red_flags, only include genuine concerns — don't manufacture issues.

Contract text:
"""
${contractText}
"""`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(500).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const resultText = data.content?.[0]?.text?.trim() || '';
    const clean = resultText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(clean);

    recordUsage(auth.userId, 'ai-contract');
    return res.status(200).json({ result });
  } catch (err) {
    console.error('Contract analysis error:', err);
    return res.status(500).json({ error: 'Failed to analyze contract' });
  }
};
