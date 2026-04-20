// Vercel serverless function
// Receives text, returns 3 rewritten variations
// POST /api/ai-rewrite { text: "..." }

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
      return res.status(500).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const result = data.content?.[0]?.text?.trim() || '';

    return res.status(200).json({ rewrites: result });
  } catch (err) {
    console.error('Rewrite error:', err);
    return res.status(500).json({ error: 'Failed to generate rewrites' });
  }
};
