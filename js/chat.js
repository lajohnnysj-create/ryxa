// =============================================================================
// /js/chat.js — Chatbox / AI Chat (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Chatbox AI assistant tool (Pro/Max). Extracted from
// dashboard.html for stricter CSP.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/chat.js
//   • Phase 2: inline onclick/oninput/onkeydown → data-chat-action attributes
//   • Phase 3: static inline class="bio-s-6eae3a" → hash-named CSS classes
//
// External dependencies remain on window (sb, Auth, currentUser, isPro, isMax,
// escapeHtml, startCheckout, getAIHeaders, etc).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE (parallel of other tools)
// =============================================================================

const chatActions = {};

function chatRegisterAction(action, handler) {
  chatActions[action] = handler;
}

function chatFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['chatAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.chatAction) {
        const wantEvent = el.dataset.chatEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.chatAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function chatDispatchEvent(event) {
  const found = chatFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = chatActions[found.action];
  if (!handler) {
    console.warn('[chat] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur', 'keydown'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, chatDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 17506-17925 (AI Chat / Chatbox) ----------
// =====================================================
// AI CHAT
// =====================================================
var aichatState = {
  inited: false,
  conversationId: null,
  conversations: [],
  isLoading: false,
};

function initAiChat() {
  if (!isPro() && !isMax()) {
    document.getElementById('aichat-paywall').style.display = 'block';
    document.getElementById('aichat-content').style.display = 'none';
    return;
  }
  document.getElementById('aichat-paywall').style.display = 'none';
  document.getElementById('aichat-content').style.display = 'flex';
  if (!aichatState.inited) {
    aichatState.inited = true;
    aichatLoadConversations();
  }
  // Show one-time disclaimer the first time this user opens Chatbox.
  // Stored in localStorage keyed to user id so it shows once per account.
  try {
    var key = 'aichat_disclaimer_v1_' + (currentUser?.id || 'anon');
    if (!localStorage.getItem(key)) {
      showAichatDisclaimer(function() {
        try { localStorage.setItem(key, '1'); } catch (e) {}
      });
    }
  } catch (e) { /* localStorage may be disabled — non-fatal */ }
}

// First-time disclaimer modal shown before a user can use Chatbox.
// They must click "I understand" to dismiss; we record their acknowledgment.
function showAichatDisclaimer(onAccept) {
  var overlay = document.createElement('div');
  overlay.id = 'aichat-disclaimer-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = '<div class="chat-s-615a28">'
    + '<div class="chat-s-c0bd7f">'
    + '<div class="chat-s-fcd3fe">'
    + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    + '</div>'
    + '<div class="course-s-09f83d">Before you use Ryxa AI</div>'
    + '</div>'
    + '<div class="chat-s-bf3ed3">'
    + '<p class="deal-s-3ef1fa">Ryxa AI is an AI-powered assistant designed to help with creator-related questions like content ideas, pricing, scripts, and brand outreach.</p>'
    + '<p class="deal-s-3ef1fa"><strong class="mk-s-e0b980">It is not a substitute for professional advice.</strong> Ryxa AI does not provide:</p>'
    + '<ul class="chat-s-5f795c">'
    + '<li class="chat-s-d98293">Medical, mental health, or therapeutic advice</li>'
    + '<li class="chat-s-d98293">Legal advice or contract interpretation</li>'
    + '<li class="chat-s-d98293">Financial, tax, or investment advice</li>'
    + '</ul>'
    + '<p class="mk-s-76084e">For those topics, please consult a qualified professional. AI responses can also be inaccurate — always verify important information independently.</p>'
    + '</div>'
    + '<button id="aichat-disclaimer-accept" class="chat-s-c3e278">I understand</button>'
    + '</div>';
  document.body.appendChild(overlay);
  document.getElementById('aichat-disclaimer-accept').onclick = function() {
    overlay.remove();
    if (onAccept) onAccept();
  };
}

async function aichatLoadConversations() {
  var listEl = document.getElementById('aichat-conv-list');
  try {
    var { data, error } = await sb
      .from('ai_chat_conversations')
      .select('id, title, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    aichatState.conversations = data || [];
    aichatRenderConversationList();
  } catch (e) {
    console.error('Failed to load conversations:', e);
    listEl.innerHTML = '<div class="chat-s-5fa9fd">Could not load conversations</div>';
  }
}

function aichatRenderConversationList() {
  var listEl = document.getElementById('aichat-conv-list');
  if (!aichatState.conversations.length) {
    listEl.innerHTML = '<div class="chat-s-3f41bf">No chats yet.<br>Start a new one!</div>';
    return;
  }
  var html = '';
  aichatState.conversations.forEach(function(c) {
    var active = c.id === aichatState.conversationId ? ' active' : '';
    html += '<div class="aichat-conv-item' + active + '" data-chat-action="load-conversation" data-chat-conv-id="' + escapeHtml(c.id) + '" title="' + escapeHtml(c.title) + '">'
      + escapeHtml(c.title)
      + '<button class="aichat-conv-delete" data-chat-action="delete-conversation" data-chat-conv-id="' + escapeHtml(c.id) + '" title="Delete chat" aria-label="Delete chat">'
      + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>'
      + '</button>'
      + '</div>';
  });
  listEl.innerHTML = html;
}

function aichatNewConversation() {
  aichatState.conversationId = null;
  document.getElementById('aichat-empty').style.display = 'flex';
  document.getElementById('aichat-messages').style.display = 'none';
  document.getElementById('aichat-messages').innerHTML = '';
  aichatRenderConversationList();
  aichatToggleSide(false);
  var titleEl = document.getElementById('aichat-mobile-title');
  if (titleEl) titleEl.textContent = 'Ryxa AI';
  var inp = document.getElementById('aichat-input');
  if (inp) inp.focus();
}

// Mobile sidebar toggle
function aichatToggleSide(forceState) {
  var side = document.getElementById('aichat-side');
  var backdrop = document.getElementById('aichat-side-backdrop');
  if (!side || !backdrop) return;
  var open = (forceState === undefined)
    ? !side.classList.contains('aichat-side-open')
    : !!forceState;
  if (open) {
    side.classList.add('aichat-side-open');
    backdrop.classList.add('aichat-side-open');
  } else {
    side.classList.remove('aichat-side-open');
    backdrop.classList.remove('aichat-side-open');
  }
  var toggleBtn = document.getElementById('aichat-side-toggle');
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

async function aichatLoadConversation(convId) {
  aichatState.conversationId = convId;
  aichatRenderConversationList();
  aichatToggleSide(false);
  // Set the mobile header title from the conversation list
  var convInList = (aichatState.conversations || []).find(function(c) { return c.id === convId; });
  var titleEl = document.getElementById('aichat-mobile-title');
  if (titleEl) titleEl.textContent = (convInList && convInList.title) ? convInList.title : 'Ryxa AI';
  var messagesEl = document.getElementById('aichat-messages');
  document.getElementById('aichat-empty').style.display = 'none';
  messagesEl.style.display = 'block';
  messagesEl.innerHTML = '<div class="chat-s-c27877">Loading...</div>';
  try {
    var { data, error } = await sb
      .from('ai_chat_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    var html = '';
    (data || []).forEach(function(m) {
      html += aichatRenderMessage(m.role, m.content);
    });
    messagesEl.innerHTML = html;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (e) {
    console.error('Failed to load messages:', e);
    messagesEl.innerHTML = '<div class="chat-s-4651a1">Could not load this chat</div>';
  }
}

async function aichatDeleteConversation(convId) {
  showModalConfirm('Delete this chat?', 'This conversation and all its messages will be permanently deleted.', async function() {
    try {
      var { error } = await sb.from('ai_chat_conversations').delete().eq('id', convId);
      if (error) throw error;
      aichatState.conversations = aichatState.conversations.filter(function(c) { return c.id !== convId; });
      if (aichatState.conversationId === convId) {
        aichatNewConversation();
      } else {
        aichatRenderConversationList();
      }
    } catch (e) {
      console.error('Delete failed:', e);
      showModalAlert('Error', 'Could not delete this chat. Please try again.');
    }
  });
}

function aichatRenderMessage(role, content) {
  var avatarHtml;
  if (role === 'user') {
    var userAvatarUrl = (typeof dashboardAvatarUrl === 'string' && dashboardAvatarUrl) ? dashboardAvatarUrl : '';
    if (userAvatarUrl) {
      avatarHtml = '<div class="aichat-msg-avatar chat-s-f3a426" ><img src="' + escapeHtml(userAvatarUrl) + '" alt="Your profile photo" class="bio-s-0c9434"></div>';
    } else {
      var avatarLetter = currentUser?.email?.[0]?.toUpperCase() || 'U';
      avatarHtml = '<div class="aichat-msg-avatar">' + escapeHtml(avatarLetter) + '</div>';
    }
  } else {
    avatarHtml = '<div class="aichat-msg-avatar chat-s-f3a426" ><img src="/chatbox-avatar.webp" alt="Ryxa AI" class="bio-s-0c9434"></div>';
  }
  var bodyHtml = role === 'assistant' ? aichatMarkdownToHtml(content) : '<p>' + escapeHtml(content).replace(/\n/g, '<br>') + '</p>';
  if (role === 'assistant') {
    return '<div class="aichat-msg assistant">'
      + avatarHtml
      + '<div class="aichat-msg-col">'
      +   '<div class="aichat-msg-body">' + bodyHtml + '</div>'
      +   aichatReportControlHtml()
      + '</div>'
      + '</div>';
  }
  return '<div class="aichat-msg ' + role + '">'
    + avatarHtml
    + '<div class="aichat-msg-body">' + bodyHtml + '</div>'
    + '</div>';
}

// Small "Report" control shown under each AI response (Apple Guideline 1.2
// moderation path). Lives as a sibling of the body so the streaming reveal,
// which rewrites the body's innerHTML, never clobbers it.
function aichatReportControlHtml() {
  return '<div class="aichat-msg-footer">'
    + '<button type="button" class="aichat-report-btn" data-chat-action="report-message" title="Report this response" aria-label="Report this response">Report</button>'
    + '</div>';
}

// Progressively reveal an assistant message word-by-word.
// Total reveal time scales with response length: ~0.6s for short, ~1.5s max for long.
function aichatRevealMessage(bodyEl, fullText) {
  var text = String(fullText || '');
  if (!text) return;
  // Split into word+whitespace tokens to preserve spacing
  var tokens = text.split(/(\s+)/);
  var wordCount = tokens.filter(function(t) { return t.trim().length > 0; }).length;
  if (wordCount === 0) {
    bodyEl.innerHTML = aichatMarkdownToHtml(text);
    return;
  }
  // Animate over 600-1500ms. ~25-50 tokens/sec feels smooth without dragging.
  var totalDuration = Math.min(1500, Math.max(600, wordCount * 25));
  // Reveal in chunks proportional to length so total stays in budget
  var ticksPerSec = 30; // updates per second
  var totalTicks = Math.max(1, Math.round(totalDuration / 1000 * ticksPerSec));
  var tokensPerTick = Math.max(1, Math.ceil(tokens.length / totalTicks));
  var tickDelay = totalDuration / totalTicks;

  var i = 0;
  var messagesEl = document.getElementById('aichat-messages');
  function tick() {
    i = Math.min(tokens.length, i + tokensPerTick);
    var partial = tokens.slice(0, i).join('');
    bodyEl.innerHTML = aichatMarkdownToHtml(partial);
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    if (i < tokens.length) {
      setTimeout(tick, tickDelay);
    } else {
      // Ensure final render is the full text (in case partial markdown was malformed)
      bodyEl.innerHTML = aichatMarkdownToHtml(text);
    }
  }
  setTimeout(tick, tickDelay);
}

// Minimal markdown renderer — handles paragraphs, bold, italic, code, lists, links
function aichatMarkdownToHtml(md) {
  var s = String(md || '');
  // Escape HTML first
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Code blocks (```)
  s = s.replace(/```([\s\S]*?)```/g, function(_, code) {
    return '<pre><code>' + code.replace(/\n$/, '') + '</code></pre>';
  });
  // Inline code (`...`)
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Bold (**...**)
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic (*...*) — non-greedy, single-line
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, text, url) {
    var safe = url.replace(/"/g, '&quot;');
    return '<a href="' + safe + '" target="_blank" rel="noopener nofollow">' + text + '</a>';
  });
  // Split into lines, group lists, paragraphs
  var lines = s.split(/\n/);
  var out = [];
  var inList = null; // 'ul' or 'ol'
  var paragraph = [];
  function flushPara() {
    if (paragraph.length) { out.push('<p>' + paragraph.join('<br>') + '</p>'); paragraph = []; }
  }
  function closeList() {
    if (inList) { out.push('</' + inList + '>'); inList = null; }
  }
  lines.forEach(function(line) {
    var ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
    var olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ulMatch) {
      flushPara();
      if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
      out.push('<li>' + ulMatch[1] + '</li>');
    } else if (olMatch) {
      flushPara();
      if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
      out.push('<li>' + olMatch[1] + '</li>');
    } else if (line.trim() === '') {
      flushPara();
      closeList();
    } else {
      closeList();
      paragraph.push(line);
    }
  });
  flushPara();
  closeList();
  return out.join('\n');
}

function aichatUseExample(btn) {
  var prompt = btn.getAttribute('data-prompt') || '';
  var inp = document.getElementById('aichat-input');
  inp.value = prompt;
  aichatAutosizeInput(inp);
  inp.focus();
}

function aichatAutosizeInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(160, el.scrollHeight) + 'px';
}

function aichatHandleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    aichatSend();
  }
}

async function aichatSend() {
  if (aichatState.isLoading) return;
  var inp = document.getElementById('aichat-input');
  var text = (inp.value || '').trim();
  if (!text) return;
  if (text.length > 4000) {
    showModalAlert('Message too long', 'Keep messages under 4000 characters.');
    return;
  }

  aichatState.isLoading = true;
  inp.disabled = true;
  document.getElementById('aichat-send-btn').disabled = true;
  document.getElementById('aichat-send-btn').style.opacity = '0.6';

  // Show conversation view if not already
  document.getElementById('aichat-empty').style.display = 'none';
  var messagesEl = document.getElementById('aichat-messages');
  messagesEl.style.display = 'block';

  // Append user message immediately
  messagesEl.insertAdjacentHTML('beforeend', aichatRenderMessage('user', text));
  // Append typing indicator
  var typingHtml = '<div class="aichat-msg assistant" id="aichat-typing">'
    + '<div class="aichat-msg-avatar chat-s-f3a426" ><img src="/chatbox-avatar.webp" alt="Ryxa AI" class="bio-s-0c9434"></div>'
    + '<div class="aichat-msg-body"><div class="aichat-typing"><span></span><span></span><span></span></div></div>'
    + '</div>';
  messagesEl.insertAdjacentHTML('beforeend', typingHtml);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  inp.value = '';
  aichatAutosizeInput(inp);

  try {
    var resp = await fetch('/api/ai-chat', {
      method: 'POST',
      headers: getAIHeaders(),
      body: JSON.stringify({
        conversation_id: aichatState.conversationId,
        message: text,
      }),
    });
    var data = await resp.json();

    // Remove typing indicator
    var typingEl = document.getElementById('aichat-typing');
    if (typingEl) typingEl.remove();

    if (!resp.ok || data.error) {
      var errMsg = data.error || 'Something went wrong.';
      // Append error inline as an assistant-style message
      messagesEl.insertAdjacentHTML('beforeend',
        '<div class="aichat-msg assistant"><div class="aichat-msg-avatar chat-s-35147d" >!</div><div class="aichat-msg-body chat-s-9c5c75" >' + escapeHtml(errMsg) + '</div></div>'
      );
      messagesEl.scrollTop = messagesEl.scrollHeight;

      // If rate-limited, also surface the helpful info via the usage bar refresh
      if (resp.status === 429 && data.next_reset_at) {
        // Already wrapped fetch refreshes usage bar
      }
      return;
    }

    // Insert assistant bubble with empty body, then animate text in
    var emptyBubble = '<div class="aichat-msg assistant">'
      + '<div class="aichat-msg-avatar chat-s-f3a426" ><img src="/chatbox-avatar.webp" alt="Ryxa AI" class="bio-s-0c9434"></div>'
      + '<div class="aichat-msg-col">'
      +   '<div class="aichat-msg-body"></div>'
      +   aichatReportControlHtml()
      + '</div>'
      + '</div>';
    messagesEl.insertAdjacentHTML('beforeend', emptyBubble);
    var allBubbles = messagesEl.querySelectorAll('.aichat-msg.assistant .aichat-msg-body');
    var lastBody = allBubbles[allBubbles.length - 1];
    if (lastBody) {
      aichatRevealMessage(lastBody, data.response);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // If new conversation, set state and refresh sidebar
    if (data.is_new && data.conversation_id) {
      aichatState.conversationId = data.conversation_id;
      // Reload conversations to pick up the new one
      aichatLoadConversations();
    } else {
      // Move this conversation to the top of the list (it just got an update)
      var idx = aichatState.conversations.findIndex(function(c) { return c.id === aichatState.conversationId; });
      if (idx >= 0) {
        var c = aichatState.conversations[idx];
        c.updated_at = new Date().toISOString();
        aichatState.conversations.splice(idx, 1);
        aichatState.conversations.unshift(c);
        aichatRenderConversationList();
      }
    }
  } catch (e) {
    console.error('aichat send error:', e);
    var typingEl2 = document.getElementById('aichat-typing');
    if (typingEl2) typingEl2.remove();
    messagesEl.insertAdjacentHTML('beforeend',
      '<div class="aichat-msg assistant"><div class="aichat-msg-avatar chat-s-35147d" >!</div><div class="aichat-msg-body chat-s-9c5c75" >Network error. Please try again.</div></div>'
    );
  } finally {
    aichatState.isLoading = false;
    inp.disabled = false;
    document.getElementById('aichat-send-btn').disabled = false;
    document.getElementById('aichat-send-btn').style.opacity = '1';
    inp.focus();
  }
}


// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Paywall — external startCheckout function (defined in dashboard.html)
chatRegisterAction('start-checkout', (e, el) => goToPricing(el.dataset.chatPlan === 'max' ? 'max' : 'pro'));

// Sidebar toggle
chatRegisterAction('toggle-side', () => aichatToggleSide());
chatRegisterAction('toggle-side-open', () => aichatToggleSide(true));
chatRegisterAction('toggle-side-close', () => aichatToggleSide(false));

// Conversation management
chatRegisterAction('new-conversation', () => aichatNewConversation());
chatRegisterAction('load-conversation', (e, el) => aichatLoadConversation(el.dataset.chatConvId));
chatRegisterAction('delete-conversation', (e, el) => {
  // Don't bubble to the parent .aichat-conv-item which has its own load action
  e.stopPropagation();
  aichatDeleteConversation(el.dataset.chatConvId);
});

// Input UX
chatRegisterAction('use-example', (e, el) => aichatUseExample(el));
chatRegisterAction('autosize-input', (e, el) => aichatAutosizeInput(el));
chatRegisterAction('handle-key', (e) => aichatHandleKey(e));
chatRegisterAction('send', () => aichatSend());
chatRegisterAction('report-message', (e, el) => aichatReportMessage(e, el));

// Report an AI response for review. Reads the response text from the DOM,
// confirms, then posts to /api/report-content (reporter derived from the token).
function aichatReportMessage(e, el) {
  var msgEl = el.closest('.aichat-msg');
  if (!msgEl) return;
  var bodyEl = msgEl.querySelector('.aichat-msg-body');
  var contentText = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '';
  if (!contentText) return;

  showModalConfirm(
    'Report this response?',
    'This sends the AI response to the Ryxa team for review. Use it if the response is harmful, offensive, or inappropriate.',
    async function() {
      el.disabled = true;
      el.textContent = 'Reporting...';
      try {
        var resp = await fetch('/api/report-content', {
          method: 'POST',
          headers: getAIHeaders(),
          body: JSON.stringify({
            source: 'chatbox',
            conversation_id: aichatState.conversationId || null,
            reported_content: contentText.slice(0, 5000)
          })
        });
        if (!resp.ok) {
          var data = await resp.json().catch(function() { return {}; });
          showModalAlert('Could not report', data.error || 'Please try again.');
          el.disabled = false;
          el.textContent = 'Report';
          return;
        }
        el.textContent = 'Reported';
        el.classList.add('reported');
      } catch (err) {
        showModalAlert('Could not report', 'Please try again.');
        el.disabled = false;
        el.textContent = 'Report';
      }
    },
    'Report',
    'Cancel'
  );
}

