// Vercel serverless function — AI Chat for creators
// Handles a single user message: loads conversation history, calls Claude (Haiku),
// saves both messages, returns the response.
//
// POST /api/ai-chat
// Body: { conversation_id?: string, message: string }
//   - If conversation_id is null/missing, creates a new conversation
//   - Returns: { conversation_id, message_id, response, title }

const { checkAndAuth, reserveSlot, refundSlot } = require('./_ai-rate-limit.js');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';

// Bound the cost per request:
// - Don't load more than this many past messages into the prompt
// - Each user message > this length is rejected
// - Cap Claude's output so it can't ramble forever
const MAX_HISTORY_MESSAGES = 20;
const MAX_USER_MESSAGE_LENGTH = 4000;
const MAX_OUTPUT_TOKENS = 1024;

// ============================================================
// SYSTEM PROMPT — defines who Ryxa AI is
// ============================================================

const SYSTEM_PROMPT = `You are Ryxa AI, an assistant built into Ryxa — a platform for online content creators.

WHO YOU'RE TALKING WITH:
You're talking with content creators: Instagrammers, TikTokers, YouTubers, podcasters, course creators, coaches, and other independent creatives. They use Ryxa for link-in-bio, brand deal CRM, course hosting, 1:1 booking, and other creator tools.

WHAT YOU HELP WITH:
- Creator economy questions: brand deal rates, contract red flags, negotiation tactics, sponsorship strategy
- Content ideation: hooks, scripts, video angles, captions, thumbnails, posting cadence
- Business questions: pricing courses/coaching, taxes (general — not legal advice), cold outreach, building newsletters
- Writing in creator-friendly voice: rewriting bios, DMs to brands, sales copy, course descriptions
- Tactical platform-specific advice (Instagram Reels, TikTok algorithm, YouTube SEO, etc.)

HOW TO RESPOND:
- Be direct. No "Great question!" filler. Get to the answer.
- Specific over generic. If asked about rates, give numbers and frameworks (CPM ranges, audience-size benchmarks). If you don't have the data, say so.
- Practical. Creators want actionable advice, not academic frameworks.
- Match their energy. Casual creator vibe, not corporate.
- Use lists and bullets when they help, prose when they don't.
- Don't overuse emojis. One or two when natural is fine.
- Keep responses focused — answer the question, then stop.

ABOUT RYXA SPECIFICALLY:
If a creator asks about Ryxa features, here's what the platform offers:
- Link in Bio (custom landing page)
- 1:1 Booking (sell time / coaching / consultations)
- Course hosting and selling
- Brand Deal CRM (track deals, contracts, invoices)
- Media Kit builder
- AI tools: bio writer, caption generator, contract analyzer, thumbnail analyzer, design studio
- Free plan available; Pro is $10/mo, Creator Max is $20/mo

WHAT YOU DON'T DO:
- Don't claim to access the user's actual data (calendar, bookings, revenue, etc.) — you can't.
- Don't give legal or tax advice that requires a professional. Recommend they talk to one for those.
- Don't make up specific numbers if you genuinely don't know — give a framework instead.
- Don't be sycophantic. Honest, useful responses beat flattery.`;

// ============================================================
// SUPABASE HELPERS — raw fetch, no dependencies
// ============================================================

function getServiceKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

async function sbSelect(path) {
  const key = getServiceKey();
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Supabase SELECT failed (' + res.status + '): ' + body);
  }
  return await res.json();
}

async function sbInsert(table, row, returning) {
  const key = getServiceKey();
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': returning ? 'return=representation' : 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Supabase INSERT failed (' + res.status + '): ' + body);
  }
  if (returning) {
    const rows = await res.json();
    return rows?.[0] || null;
  }
}

async function sbUpdate(table, query, patch) {
  const key = getServiceKey();
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + query, {
    method: 'PATCH',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Supabase UPDATE failed (' + res.status + '): ' + body);
  }
}

// ============================================================
// HANDLER
// ============================================================

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

  // 1. Auth + rate limit
  const auth = await checkAndAuth(req, 'ai-chat');
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...(auth.extras || {}) });

  // 2. Reserve a slot upfront — refund on failure
  const usageId = await reserveSlot(auth.userId, 'ai-chat');

  try {
    // 3. Validate input
    const body = req.body || {};
    const userMessage = (body.message || '').trim();
    let conversationId = body.conversation_id || null;

    if (!userMessage) {
      await refundSlot(usageId);
      return res.status(400).json({ error: 'Message is required' });
    }
    if (userMessage.length > MAX_USER_MESSAGE_LENGTH) {
      await refundSlot(usageId);
      return res.status(400).json({ error: 'Message too long (max ' + MAX_USER_MESSAGE_LENGTH + ' characters)' });
    }

    // 4. Resolve / create conversation
    let isNewConversation = false;
    let convTitle = null;

    if (conversationId) {
      // Verify the conversation belongs to this user
      const rows = await sbSelect('ai_chat_conversations?id=eq.' + conversationId + '&user_id=eq.' + auth.userId + '&select=id,title');
      if (!rows || rows.length === 0) {
        await refundSlot(usageId);
        return res.status(404).json({ error: 'Conversation not found' });
      }
      convTitle = rows[0].title;
    } else {
      // Create a new conversation. Title is the first user message, truncated.
      const newTitle = userMessage.length > 60 ? userMessage.slice(0, 57) + '...' : userMessage;
      const created = await sbInsert('ai_chat_conversations', {
        user_id: auth.userId,
        title: newTitle,
      }, true);
      if (!created) {
        await refundSlot(usageId);
        return res.status(500).json({ error: 'Could not start conversation' });
      }
      conversationId = created.id;
      convTitle = newTitle;
      isNewConversation = true;
    }

    // 5. Load message history (oldest first), capped
    const history = isNewConversation ? [] : await sbSelect(
      'ai_chat_messages?conversation_id=eq.' + conversationId + '&order=created_at.desc&limit=' + MAX_HISTORY_MESSAGES + '&select=role,content'
    );
    // Reverse to oldest-first for the prompt
    const orderedHistory = (history || []).reverse();

    // 6. Build messages array for Claude
    const claudeMessages = orderedHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));
    claudeMessages.push({ role: 'user', content: userMessage });

    // 7. Save the user's message before calling Claude (so it's persisted even if Claude fails)
    await sbInsert('ai_chat_messages', {
      conversation_id: conversationId,
      role: 'user',
      content: userMessage,
    });

    // 8. Call Claude
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: claudeMessages,
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API error:', errText);
      await refundSlot(usageId);
      return res.status(500).json({ error: 'AI service error. Please try again.' });
    }

    const data = await claudeRes.json();
    const assistantText = (data.content?.[0]?.text || '').trim();
    if (!assistantText) {
      await refundSlot(usageId);
      return res.status(500).json({ error: 'Empty response from AI' });
    }

    // 9. Save assistant's response
    const saved = await sbInsert('ai_chat_messages', {
      conversation_id: conversationId,
      role: 'assistant',
      content: assistantText,
    }, true);

    return res.status(200).json({
      conversation_id: conversationId,
      message_id: saved?.id || null,
      response: assistantText,
      title: convTitle,
      is_new: isNewConversation,
    });
  } catch (err) {
    console.error('AI chat error:', err);
    await refundSlot(usageId);
    return res.status(500).json({ error: 'Failed to process message' });
  }
};
