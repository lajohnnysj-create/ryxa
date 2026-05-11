// =============================================================================
// /js/dashboard-shell.js — Dashboard shell code (extracted 2026-05-11)
// -----------------------------------------------------------------------------
// This file contains the chassis that all the tools hang off of:
//   • Supabase client setup, Auth token holder, getAIHeaders
//   • Tier management (fetchTier, updateTierUI, isPro, isMax)
//   • Tool router (showTool, showFollowerTool)
//   • Auth flow (initAuth, setUser, PWA login screen)
//   • Sidebar / topbar / modal helpers
//   • Shared utilities (escapeHtml, setBtnLoading, formatMoney, etc.)
//   • Dashboard delegation infrastructure (data-dash-action)
//   • AI Usage indicator widget
//   • Bootstrap (initAuth(), reveal-on-load, 8s auth-timeout fallback)
//
// EXECUTION TIMING:
// Loaded as a non-deferred <script src="..."> in <body> just after all tool
// markup is parsed (where it lived inline before extraction). Tool scripts
// load AFTER this file, so:
//   • Tool scripts can reference these globals at parse time and at runtime.
//   • initAuth() is called at the bottom of this file. It's async — yields
//     immediately on `await sb.auth.getSession()`. By the time it resumes,
//     all tool scripts have loaded.
//   • Top-level DOM access (document.body, document.addEventListener) is safe
//     because the script tag lives in <body> after the DOM elements it touches.
//
// EXTERNAL DEPENDENCIES (must be loaded before this script):
//   • supabase (from supabase-js CDN, loaded in <head>)
//
// GLOBALS THIS FILE EXPOSES (used by every tool script):
//   sb, Auth, currentUser, userTier, userStatus, userTrialEnd,
//   userMaxTrialUsed, userPreMaxTier, currentCurrency, SUPPORTED_CURRENCIES,
//   SUPABASE_URL, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_MAX,
//   isPro, isMax, tierLabel, escapeHtml, getAIHeaders,
//   showTool, showFollowerTool, fetchTier, updateTierUI, applyMaxTrialButtonLabels,
//   showDashToast, showProUpsell, dashConfirm (via deals.js),
//   showModalAlert, showModalConfirm (via deals.js — they live in deals.js
//   but are general-purpose),
//   setBtnLoading, clearBtnLoading, startCheckout,
//   formatMoney, formatDashUSD, getCurrencySymbol, applyCurrencySymbols,
//   openSidebar, closeSidebar, toggleSidebarMenu, closeSidebarMenu,
//   openSignoutModal, closeSignoutModal, confirmSignOut,
//   openSupportModal, closeSupportModal, copyEmail,
//   openInstallModal, closeInstallModal, handleInstallClick,
//   acceptTerms, checkTermsAcceptance,
//   showPwaLogin, hidePwaLogin, setPwaAuthMode, showPwaMsg,
//   handlePwaGoogleAuth, handlePwaAuth, handlePwaForgotPassword,
//   renderPwaTurnstile, getPwaTurnstileToken, resetPwaTurnstile,
//   fetchAiUsage, renderAiUsage, loadAiUsage, aiCleanUp, applyCleanUp,
//   handleGcalRedirect, updateDashboardAvatar,
//   promptUpgradeToMax, closeTopbarUpgradeConfirm, confirmTopbarUpgradeToMax,
//   confirmProUpsell, closeProUpsell, handleMaxUpgradeClick,
//   dashRegisterAction, dashActions, dashFindActionElement, dashDispatchEvent
//
// REFACTOR NOTE: This was extracted from a 1,859-line inline <script> block
// in dashboard.html. The block was the last major piece of inline JS. With
// this extraction, dashboard.html no longer needs 'unsafe-inline' for
// script-src (only inline drag handlers and one CSS preload onload remain,
// neither of which fires for remote-controlled events).
// =============================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
const STRIPE_PRICE_MONTHLY = 'price_1TIZ8pFQ1L0aeJrZEX1bQnUI';
const STRIPE_PRICE_MAX = 'price_1TLQdmFQ1L0aeJrZxntN3EhI';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Font preload: the stylesheet link at the top of dashboard.html has
// media="print" so it doesn't block initial render. Flip to "all" once this
// shell script runs (which happens after critical render). CSP-safe
// alternative to the old inline onload="this.media='all'" attribute.
(function() {
  var link = document.getElementById('font-preload');
  if (link) link.media = 'all';
})();

// Auth module: closure-scoped access token holder. Replaces the previous
// window._supabaseAccessToken global, which was readable by any script
// running in this page (extensions, supply-chain XSS, etc.).
//
// The token is still fundamentally accessible via sb.auth.getSession() or
// localStorage to any code in this origin — that's an unavoidable property
// of a JS-SDK auth model. But removing the named global eliminates the
// most common opportunistic exfiltration pattern (scripts that grep window
// for token-shaped values).
//
// Usage:
//   Auth.getToken()                  // current access token, or '' if not signed in
//   Auth.setToken(token)             // explicit set (used by initAuth)
//   Auth.headers()                   // {Content-Type, Authorization} for fetch
const Auth = (function() {
  var _token = '';
  return {
    getToken: function() { return _token; },
    setToken: function(t) { _token = t || ''; },
    headers: function() {
      var h = { 'Content-Type': 'application/json' };
      if (_token) h['Authorization'] = 'Bearer ' + _token;
      return h;
    }
  };
})();

// Helper: get auth headers for AI API calls
function getAIHeaders() {
  return Auth.headers();
}

// Wrap window.fetch to auto-refresh AI usage after any /api/ai- or /api/alt-text call.
// This means any AI button (caption, bio, rewrite, etc.) keeps the usage bar fresh
// without each call site needing to remember to update it.
(function() {
  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    var p = origFetch.apply(this, arguments);
    var u = (typeof url === 'string') ? url : (url && url.url) || '';
    if (u.indexOf('/api/ai-') === 0 || u.indexOf('/api/alt-text') === 0) {
      p.finally(function() {
        // Small delay so server-side reserveSlot has committed
        setTimeout(function() { if (typeof fetchAiUsage === 'function') fetchAiUsage(); }, 300);
      });
    }
    return p;
  };
})();

let currentUser = null;
let userTier = 'free';

// HTML escape utility — used everywhere to prevent XSS when rendering user content
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Tier helpers — use these everywhere instead of raw string comparison
function isPro() { return userTier === 'monthly' || userTier === 'max'; }
function isMax() { return userTier === 'max'; }
function tierLabel(t) {
  if (t === 'max') return 'Creator Max';
  if (t === 'monthly') return 'Pro';
  return 'Free';
}

// =============================================================================
// DASHBOARD-LEVEL EVENT DELEGATION
// -----------------------------------------------------------------------------
// For modals and UI elements that live in dashboard.html outside of any tool
// (sign-out modal, terms modal, generic confirm modal, support modal, etc).
// Tool-specific modals (deals, bio cropper, etc) use their own per-tool
// delegation systems. This is only for the dashboard SHELL.
//
// Markup opts in with `data-dash-action="action-name"` and optional
// `data-dash-event="change|input|focus|blur"` (defaults to click).
// =============================================================================
const dashActions = {};
function dashRegisterAction(action, handler) {
  dashActions[action] = handler;
}
function dashFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['dashAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.dashAction) {
        const wantEvent = el.dataset.dashEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.dashAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}
function dashDispatchEvent(event) {
  const found = dashFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = dashActions[found.action];
  if (!handler) {
    console.warn('[dash] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}
['click', 'change', 'input', 'focus', 'blur'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, dashDispatchEvent, useCapture);
});

let userStatus = 'free';
// ISO timestamp when the trial ends, or null when not in a trial. Source of
// truth for "is the user currently in a trial" — checked at render time
// because trials expire silently and we don't always get a webhook on tick.
let userTrialEnd = null;
// Has this user EVER used the Creator Max free trial? Sticky once true.
// Drives whether Max upgrade buttons say "Try free" or "Upgrade".
let userMaxTrialUsed = false;
// Tier the user had BEFORE upgrading into Max (null = never had a prior tier).
// Used to give Pro→Max-trial users an honest cancel message — cancel drops
// them to Free, not back to Pro, so they know to resubscribe if they want Pro.
let userPreMaxTier = null;
let currentTool = 'welcome';

const toolTitles = {
  welcome: 'Dashboard',
  bio: 'Link in Bio',
  courses: 'Courses',
  coaching: '1:1 Booking',
  products: 'Digital Products',
  mediakit: 'Media Kit',
  grid: 'Grid Planner',
  follower: 'Follow-Back Audit',
  image: 'Photo Editor',
  qr: 'QR Generator',
  invoice: 'Invoice Generator',
  pdfsign: 'Sign PDF',
  scripts: 'AI Script Builder',
  thumbanalyzer: 'AI Thumbnail Analyzer',
  contractanalyzer: 'AI Contract Analyzer',
  deals: 'Brand Deal CRM',
  analytics: 'Analytics',
    clients: 'Subscribers',
    settings: 'Settings',
    design: 'AI Design Studio',
    aichat: 'Chatbox',
    calendar: 'Calendar'
};

// Detect PWA / standalone mode
var isPwaMode = window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true
  || document.referrer.includes('android-app://');

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) { _authCompleted = true; showPwaLogin(); return; }
  Auth.setToken(session.access_token);
  await setUser(session.user);
  _authCompleted = true;
  try { sessionStorage.removeItem('_authRetry'); } catch(e) {}
  sb.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) { Auth.setToken(''); showPwaLogin(); }
    else Auth.setToken(session.access_token);
  });
}

// Rotating welcome greetings. {name} gets replaced with @username (or "creator" if no username yet).
// Tone: warm, brief, work-focused — never effusive. Mix of creator-context and neutral lines.
const DASH_GREETINGS = [
  "Welcome back, {name}.",
  "Hey {name}.",
  "Let's get to work, {name}.",
  "Good to see you, {name}.",
  "What's on your mind, {name}?",
  "Ready when you are, {name}.",
  "Back at it, {name}.",
  "Where we left off, {name}.",
  "One thing at a time, {name}.",
  "Make something today, {name}.",
  "Pick up where you left off, {name}.",
  "Good to have you back, {name}.",
  "Let's build, {name}.",
  "Hi {name}.",
  "{name}, let's go.",
  "Take it slow, {name}.",
  "Quiet focus today, {name}.",
  "Small wins add up, {name}.",
  "Plot twist: another productive day, {name}.",
  "Showing up is half of it, {name}.",
  "What's the move, {name}?",
  "What are we shipping, {name}?",
  "Welcome in, {name}.",
  "Glad you're here, {name}.",
  "Let's make it count, {name}.",
  "Take your time, {name}.",
  "One step at a time, {name}.",
  "Good morning to you, {name}.",
  "Coffee's still hot, {name}.",
  "Here goes nothing, {name}.",
  "What did you create today, {name}?",
  "Your audience is waiting, {name}.",
  "First task, then second, {name}.",
  "Build quietly, {name}.",
  "Do less, but better, {name}.",
  "Today's a good day to start, {name}.",
  "Easy does it, {name}.",
  "Dust off the to-do list, {name}.",
  "Eyes up, {name}.",
  "Block out the noise, {name}.",
  "Make it real, {name}.",
  "Just one thing today, {name}.",
  "Keep it simple, {name}.",
  "Trust the process, {name}.",
  "What's the smallest next step, {name}?",
  "Don't overthink it, {name}.",
  "Whenever you're ready, {name}.",
  "The world can wait, {name}.",
  "Pace yourself, {name}.",
  "Your work matters, {name}.",
  "Long time no see, {name}.",
  "There you are, {name}.",
  "Welcome home, {name}.",
  "Look who's back, {name}.",
  "Coffee in hand, {name}?",
  "Tea in hand, {name}?",
  "Deep breath, {name}.",
  "Phones down, {name}.",
  "Notifications off, {name}.",
  "Doors closed, focus on, {name}.",
  "Big day or small day, {name}?",
  "Light a candle, {name}.",
  "Open a tab, {name}.",
  "Crack the knuckles, {name}.",
  "Settle in, {name}.",
  "Pull up a chair, {name}.",
  "Time to make something, {name}.",
  "Today's the day, {name}.",
  "Or not. Up to you, {name}.",
  "Future you will thank you, {name}.",
  "Take the win, however small, {name}.",
  "Your audience is rooting for you, {name}.",
  "Show up for yourself, {name}.",
  "Show up for the work, {name}.",
  "Inbox can wait, {name}.",
  "Start before you're ready, {name}.",
  "Done beats perfect, {name}.",
  "Rough draft energy, {name}.",
  "First version is enough, {name}.",
  "Press publish, {name}.",
  "What's next, {name}?",
  "What needs you today, {name}?",
  "Pick the hard thing first, {name}.",
  "Or the easy thing. Just pick, {name}.",
  "What's been on your list a while, {name}?",
  "Clear one thing today, {name}.",
  "Two hours of focus is enough, {name}.",
  "Make it good. Make it shipped, {name}.",
  "Quiet hours are the best hours, {name}.",
  "Less talking, more shipping, {name}.",
  "One foot in front of the other, {name}.",
  "It compounds, {name}.",
  "Brick by brick, {name}.",
  "You don't need permission, {name}.",
  "Nobody's coming. Get to work, {name}.",
  "The work's the work, {name}.",
  "Boring done well beats clever undone, {name}.",
  "What would past-you cheer for, {name}?",
  "Every day's a chance to ship, {name}.",
  "Rest counts as work, {name}.",
  "Stretch first, {name}.",
  "Hydrate, {name}.",
  "Stand up at some point, {name}.",
  "Eat something today, {name}.",
  "Step outside later, {name}.",
  "Look at a tree this week, {name}.",
  "Touch grass eventually, {name}.",
  "Sleep is the strategy, {name}.",
  "Don't burn out, {name}.",
  "Slow is fast, {name}.",
  "Patience compounds, {name}.",
  "You're allowed to take a day, {name}.",
  "But maybe not today, {name}.",
  "Up to you, {name}.",
  "Whatever feels right, {name}.",
  "Trust your gut, {name}.",
  "Trust the work, {name}.",
  "Ignore the noise, {name}.",
  "Tune out the metrics for a sec, {name}.",
  "The numbers will follow, {name}.",
  "Make for one person today, {name}.",
  "Write like you're talking to a friend, {name}.",
  "Be specific, {name}.",
  "Be honest, {name}.",
  "Be early, {name}.",
  "Be consistent, {name}.",
  "Be yourself, but louder, {name}.",
  "What's the story today, {name}?",
  "What's worth saying, {name}?",
  "What's underrated this week, {name}?",
  "Who's it for, {name}?",
  "What would make this easier, {name}?",
  "Sharpen the saw, {name}.",
  "Tighten the loop, {name}.",
  "Stay in your lane, {name}.",
  "Build the habit, {name}.",
  "Skip the meeting, {name}.",
  "Close the extra tabs, {name}.",
  "Mute the group chat, {name}.",
  "Airplane mode for an hour, {name}?",
  "Lock in, {name}.",
  "Eyes forward, {name}.",
  "Heads down, {name}.",
  "Steady on, {name}.",
  "Onward, {name}.",
  "Carry on, {name}.",
  "Make it a good one, {name}.",
  "Don't wait for inspiration, {name}.",
  "Begin again, {name}.",
  "Today's enough, {name}."
];


async function setUser(user) {
  currentUser = user;
  // Update sidebar user info
  const email = document.getElementById('sidebar-email');
  const avatar = document.getElementById('sidebar-avatar');
  if (email) email.textContent = user.email;
  if (avatar) avatar.textContent = user.email[0].toUpperCase();
  // Also set menu popup elements
  var menuEmail = document.getElementById('sidebar-menu-email');
  var menuAvatar = document.getElementById('sidebar-menu-avatar');
  if (menuEmail) menuEmail.textContent = user.email;
  if (menuAvatar) menuAvatar.textContent = user.email[0].toUpperCase();
  await fetchTier(user.id);

  // Load avatar from bio profile
  try {
    const { data: bio } = await sb.from('link_in_bio').select('avatar_url').eq('user_id', user.id).maybeSingle();
    if (bio?.avatar_url) {
      updateDashboardAvatar(bio.avatar_url);
    }
  } catch (e) { /* keep default */ }

  // Set welcome name from profile
  try {
    const { data: profile } = await sb.from('profiles').select('username, display_currency').eq('user_id', user.id).maybeSingle();
    if (profile?.username) {
      window._ryx_username = profile.username;
      applyDashGreeting('@' + profile.username);
      var bioLinkText = document.getElementById('sidebar-menu-biolink-text');
      if (bioLinkText) bioLinkText.textContent = 'ryxa.io/' + profile.username;
      showBioLinkButtons();
    } else {
      applyDashGreeting('creator');
    }
    // Load display currency (defaults to USD if not set)
    if (profile?.display_currency && SUPPORTED_CURRENCIES[profile.display_currency]) {
      currentCurrency = profile.display_currency;
    }
  } catch (e) { /* keep default */ }

  // Apply currency symbol to all prefix elements throughout the dashboard
  applyCurrencySymbols();

  // Post-signup checkout: if user arrived with a plan intent from pricing page
  try {
    const intent = localStorage.getItem('fts_intended_plan');
    if (intent) {
      // ALWAYS clear the intent — we don't want it to persist across sessions
      localStorage.removeItem('fts_intended_plan');
      // Only auto-fire checkout if user is on Free tier AND has no active subscription.
      // This prevents accidental upgrades for Pro/Max users who happened to click a
      // pricing page button while already logged in.
      const hasActiveSub = userStatus === 'active' || userStatus === 'cancelling';
      if (userTier === 'free' && !hasActiveSub) {
        setTimeout(() => startCheckout(intent), 500);
      }
    }
  } catch (e) { console.warn('intent check', e); }

  // Load dashboard home stats (page views + revenue)
  loadDashStats();

  // Hide loading spinner, show welcome content
  var dashLoader = document.getElementById('dash-loading');
  if (dashLoader) dashLoader.style.display = 'none';
  var welcomeContent = document.getElementById('welcome-content');
  if (welcomeContent) welcomeContent.style.display = '';

  // Handle Stripe Connect callback redirect
  handleStripeConnectRedirect();

  // Handle Google Calendar OAuth callback — auto-navigate to Calendar tool
  handleGcalRedirect();

  // Check if user has accepted terms
  checkTermsAcceptance();
}

function handleGcalRedirect() {
  var params = new URLSearchParams(window.location.search);
  if (!params.get('gcal')) return;
  // Navigate to Calendar tool. initCalendarTool() will read the params
  // and surface the success/error message via gcalHandleReturnParams().
  showTool('calendar');
}

async function checkTermsAcceptance() {
  if (!currentUser) return;
  try {
    var { data } = await sb.from('profiles').select('accepted_terms, marketing_emails').eq('user_id', currentUser.id).single();
    if (data && data.accepted_terms) {
      // Load marketing preference into settings
      var toggle = document.getElementById('settings-marketing-emails');
      if (toggle) toggle.checked = !!data.marketing_emails;
      return;
    }
    // Show terms modal with existing marketing preference
    var modal = document.getElementById('terms-modal');
    if (modal) modal.style.display = 'flex';
    var marketingCheck = document.getElementById('terms-marketing-check');
    if (marketingCheck) marketingCheck.checked = !!data?.marketing_emails;
    var check = document.getElementById('terms-accept-check');
    var btn = document.getElementById('terms-accept-btn');
    if (check && btn) {
      check.addEventListener('change', function() {
        btn.disabled = !check.checked;
        btn.style.opacity = check.checked ? '1' : '0.5';
        btn.style.pointerEvents = check.checked ? 'auto' : 'none';
      });
    }
  } catch (e) { console.error('Terms check error:', e); }
}


async function acceptTerms() {
  var check = document.getElementById('terms-accept-check');
  if (!check || !check.checked) return;
  var btn = document.getElementById('terms-accept-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    var marketingCheck = document.getElementById('terms-marketing-check');
    var { error } = await sb.from('profiles').update({
      accepted_terms: true,
      marketing_emails: marketingCheck ? marketingCheck.checked : false
    }).eq('user_id', currentUser.id);
    if (error) throw error;
    var modal = document.getElementById('terms-modal');
    if (modal) modal.style.display = 'none';
  } catch (e) {
    console.error('Accept terms error:', e);
    var errEl = document.getElementById('terms-error');
    if (errEl) { errEl.textContent = 'Something went wrong. Please try again.'; errEl.style.display = 'block'; }
    if (btn) { btn.disabled = false; btn.textContent = 'Continue'; }
  }
}


function openSupportModal() {
  var overlay = document.createElement('div');
  overlay.id = 'support-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:380px;width:100%;text-align:center;">'
    + '<div style="width:48px;height:48px;margin:0 auto 16px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.25);border-radius:12px;display:flex;align-items:center;justify-content:center;"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div>'
    + '<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:800;letter-spacing:-0.3px;margin-bottom:8px;">Get Support</div>'
    + '<p style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:20px;">Have a question or need help? Reach out to us and we\'ll get back to you as soon as possible.</p>'
    + '<div class="dash-h-53f7b1" data-dash-action="copy-support-email" style="padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;font-size:14px;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;transition:border-color 0.15s;">'
    + '<span>hello@ryxa.io</span>'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
    + '</div>'
    + '<button data-dash-action="close-support" style="width:100%;padding:10px;background:transparent;border:1px solid var(--border-hover);color:var(--muted);border-radius:10px;font-size:13px;font-family:DM Sans,sans-serif;cursor:pointer;">Close</button>'
    + '</div>';
  overlay.onclick = function(e) { if (e.target === overlay) closeSupportModal(); };
  document.body.appendChild(overlay);
}

function closeSupportModal() {
  var el = document.getElementById('support-modal-overlay');
  if (el) el.remove();
}

function copyEmail(btn) {
  var email = 'hello@ryxa.io';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(email).catch(function() { fallbackCopy(email); });
  } else {
    fallbackCopy(email);
  }
  var span = btn.querySelector('span');
  if (span) {
    span.textContent = 'Copied!';
    span.style.color = '#4ade80';
    setTimeout(function() { span.textContent = email; span.style.color = ''; }, 1500);
  }
}

var dashboardAvatarUrl = ''; // cached for chatbox and other tools that need the avatar

function updateDashboardAvatar(url) {
  dashboardAvatarUrl = url || '';
  const sidebarAvatar = document.getElementById('sidebar-avatar');
  const settingsAvatar = document.getElementById('settings-avatar');
  const menuAvatar = document.getElementById('sidebar-menu-avatar');
  if (url) {
    const imgHtml = '<img src="' + escapeHtml(url) + '" alt="Profile photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
    if (sidebarAvatar) { sidebarAvatar.innerHTML = imgHtml; sidebarAvatar.style.overflow = 'hidden'; }
    if (settingsAvatar) { settingsAvatar.innerHTML = imgHtml; settingsAvatar.style.overflow = 'hidden'; }
    if (menuAvatar) { menuAvatar.innerHTML = imgHtml; }
  } else {
    const initial = currentUser ? currentUser.email[0].toUpperCase() : '?';
    if (sidebarAvatar) { sidebarAvatar.textContent = initial; sidebarAvatar.style.overflow = ''; }
    if (settingsAvatar) { settingsAvatar.textContent = initial; settingsAvatar.style.overflow = ''; }
    if (menuAvatar) { menuAvatar.textContent = initial; }
  }
}


function showDashToast(type, message) {
  // Remove existing toast if any
  const existing = document.getElementById('dash-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'dash-toast';
  const isSuccess = type === 'success';
  const bg = isSuccess ? 'rgba(74,222,128,0.12)' : 'rgba(239,68,68,0.12)';
  const border = isSuccess ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)';
  const color = isSuccess ? '#4ade80' : '#fca5a5';
  const icon = isSuccess
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

  toast.style.cssText = `position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:10000;background:${bg};border:1px solid ${border};color:${color};padding:14px 24px;border-radius:12px;font-size:14px;font-weight:500;font-family:'DM Sans',sans-serif;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,0.4);backdrop-filter:blur(12px);max-width:90vw;animation:toastIn 0.4s ease;`;
  toast.innerHTML = `${icon}<span>${message}</span>`;
  document.body.appendChild(toast);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    toast.style.transition = 'opacity 0.4s, transform 0.4s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-10px)';
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}

async function fetchTier(userId) {
  // Safety net: if fetchTier hangs or errors, ensure tier-loading is removed
  // after 5s so the UI doesn't get stuck with hidden pills forever.
  const safety = setTimeout(function() {
    document.body.classList.remove('tier-loading');
  }, 5000);
  try {
    const { data } = await sb.from('subscriptions').select('tier, status, trial_end, max_trial_used, pre_max_tier').eq('user_id', userId).limit(1);
    if (data && data.length > 0) {
      userTier = data[0].tier || 'free';
      userStatus = data[0].status || 'free';
      userTrialEnd = data[0].trial_end || null;
      userMaxTrialUsed = data[0].max_trial_used === true;
      userPreMaxTier = data[0].pre_max_tier || null;
    }
    updateTierUI();
    // Pre-load AI usage so the sidebar menu opens instantly with no layout shift.
    // Runs for ALL tiers — Free shows a locked state with upgrade CTA.
    fetchAiUsage();
  } finally {
    clearTimeout(safety);
  }
}

// Swap the label on all Max upgrade buttons based on whether the user has
// already used (or is currently using) the Max free trial. Source of truth
// is userMaxTrialUsed, populated from the subscriptions.max_trial_used column.
//
// Buttons opt in by adding `data-max-trial-cta`. Includes the topbar upgrade
// button (handled separately because its label/handler are set programmatically
// in updateTierUI, not via markup).
//
// Also updates the body of the Settings upgrade confirmation dialog, which
// needs to reflect whether a trial will be granted on confirm.
function applyMaxTrialButtonLabels() {
  const trialLabel = 'Try Creator Max Free — 7 Days';
  const noTrialLabel = 'Upgrade to Creator Max';
  const label = userMaxTrialUsed ? noTrialLabel : trialLabel;

  // Static markup buttons
  document.querySelectorAll('[data-max-trial-cta]').forEach(function(btn) {
    btn.textContent = label;
  });

  // Settings upgrade confirmation copy
  const confirmCopy = document.getElementById('settings-upgrade-max-copy');
  if (confirmCopy) {
    confirmCopy.textContent = userMaxTrialUsed
      ? "Takes effect immediately. You'll be charged a prorated amount today, then $20/month going forward. Unlocks custom themes, hero links, and full branding control."
      : "Start your 7-day free trial of Creator Max. No charge during the trial. After 7 days, your existing billing cycle continues at the $20/month Max rate. Unlocks custom themes, hero links, and full branding control.";
  }
}

function updateTierUI() {
  const pro = isPro();
  const max = isMax();
  const isCancelling = pro && userStatus === 'cancelling';
  const tierBadge = document.getElementById('topbar-tier-badge');
  const sidebarTier = document.getElementById('sidebar-tier');
  const upgradeBtn = document.getElementById('topbar-upgrade-btn');

  // Trial countdown for the topbar pill. Same logic as updateSettingsCancelBtn:
  // trial_end in the future means we're in a trial; round days UP.
  let trialDaysLeft = null;
  if (userTrialEnd) {
    const endMs = new Date(userTrialEnd).getTime();
    const nowMs = Date.now();
    if (endMs > nowMs) {
      trialDaysLeft = Math.ceil((endMs - nowMs) / (24 * 60 * 60 * 1000));
    }
  }
  const isTrialing = max && trialDaysLeft !== null;

  // Topbar pill (upper-right). Cancelling takes precedence over Trial:
  // once a trialing user cancels, the trial countdown is implicit (the
  // subscription ends with the trial anyway), and Cancelling is the more
  // urgent state to communicate.
  let badgeText;
  if (isCancelling) {
    badgeText = max ? 'Creator Max (Cancelling)' : 'Pro (Cancelling)';
  } else if (isTrialing) {
    const dayWord = trialDaysLeft === 1 ? 'day' : 'days';
    badgeText = 'Creator Max (Trial, ' + trialDaysLeft + ' ' + dayWord + ' left)';
  } else {
    badgeText = max ? 'Creator Max' : pro ? 'Pro' : 'Free';
  }

  // Sidebar / account menu label — intentionally NOT showing trial state.
  // Keeps the sidebar text short; trial info is surfaced in the topbar pill
  // and the Settings panel.
  const planText = isCancelling
    ? (max ? 'Max (Cancelling)' : 'Pro (Cancelling)')
    : max ? 'Creator Max' : pro ? 'Pro Plan' : 'Free Plan';

  if (tierBadge) {
    tierBadge.textContent = badgeText;
    tierBadge.className = 'tier-badge ' + (max ? 'max' : pro ? 'pro' : 'free');
  }
  if (sidebarTier) sidebarTier.textContent = planText;
  var menuTier = document.getElementById('sidebar-menu-tier');
  if (menuTier) menuTier.textContent = planText;
  // Toggle Creator Max styling on sidebar bottom and body
  const sidebarBottom = document.querySelector('.sidebar-bottom');
  if (sidebarBottom) {
    sidebarBottom.classList.toggle('max-mode', max);
    sidebarBottom.classList.toggle('pro-mode', pro && !max);
  }
  document.body.classList.toggle('max-user', max);
  document.body.classList.toggle('pro-user', pro && !max);
  // Welcome badge text adapts to tier
  const welcomeBadge = document.getElementById('welcome-badge');
  if (welcomeBadge) {
    welcomeBadge.innerHTML = max
      ? '&#x2728; You\'re in Control'
      : pro
        ? '&#x2728; Pro Creator'
        : 'Creator Tools';
  }
  if (upgradeBtn) {
    const maxBtn = document.getElementById('topbar-upgrade-max-btn');
    if (max) {
      upgradeBtn.style.display = 'none';
      if (maxBtn) maxBtn.style.display = 'none';
    } else if (pro) {
      // Pro user: show Max upgrade with gradient styling on the primary button.
      // Hide the secondary Free-only Max button to avoid duplicates.
      upgradeBtn.style.display = 'block';
      upgradeBtn.textContent = userMaxTrialUsed
        ? 'Upgrade to Creator Max'
        : 'Try Creator Max Free — 7 Days';
      upgradeBtn.onclick = () => promptUpgradeToMax();
      upgradeBtn.style.background = 'linear-gradient(135deg,#a78bfa,#e879f9)';
      upgradeBtn.style.boxShadow = '0 0 20px rgba(232,121,249,0.35)';
      if (maxBtn) maxBtn.style.display = 'none';
    } else {
      // Free user: show Pro upgrade with default styling, plus the secondary Max button.
      upgradeBtn.style.display = 'block';
      upgradeBtn.textContent = 'Upgrade to Pro';
      upgradeBtn.onclick = function() { startCheckout(undefined, this); };
      upgradeBtn.style.background = '';
      upgradeBtn.style.boxShadow = '';
      if (maxBtn) maxBtn.style.display = 'block';
    }
  }
  // Refresh Brand Deal CRM if it's the active tool (Max gating may have changed)
  if (currentTool === 'deals') initDealsCrm();
  if (currentTool === 'bio') { syncBrandingToggle(); renderBioThemes(); renderBioFonts(); }

  // Update cancel button in settings modal if open.
  // Guarded because settings.js loads after dashboard-shell.js in script
  // order, and fetchTier() can resolve before all <script> tags have
  // finished parsing (especially with a cached Supabase session).
  if (typeof updateSettingsCancelBtn === 'function') updateSettingsCancelBtn();

  // Sync Max upgrade CTA labels (trial vs no-trial) based on userMaxTrialUsed
  applyMaxTrialButtonLabels();

  // Tier is now resolved — reveal the appropriate pills.
  // Until this point, body.tier-loading was hiding all pills to prevent
  // a flash of incorrect pills (e.g., Max pills briefly showing for a Max user).
  document.body.classList.remove('tier-loading');
}


function showFollowerTool() {
  showTool('follower');
  if (!window._faListenersReady) {
    window._faListenersReady = true;
    faSetupListeners();
  }
  if (!window._faDataLoaded && currentUser) {
    window._faDataLoaded = true;
    faLoadData();
  }
}

function showTool(tool) {
  // Clean up any pending PDF Sign palette selection when switching tools
  if (typeof pdfsignTouchPending !== 'undefined') {
    pdfsignTouchPending = null;
    if (typeof clearPaletteSelection === 'function') clearPaletteSelection();
    if (typeof hidePdfSignStatus === 'function') hidePdfSignStatus();
  }
  // Clean up contract signing mode if navigating away from pdfsign
  if (tool !== 'pdfsign' && typeof removeContractSaveButton === 'function') {
    removeContractSaveButton();
  }
  // If clicking pdfsign from sidebar while in contract mode, reset to normal
  if (tool === 'pdfsign' && window._contractSignContext && typeof removeContractSaveButton === 'function') {
    removeContractSaveButton();
    if (typeof resetPdfSign === 'function') resetPdfSign();
  }
  // Hide all tools
  ['welcome','bio','courses','coaching','products','mediakit','grid','follower','image','design','aichat','qr','invoice','pdfsign','deals','scripts','thumbanalyzer','contractanalyzer','analytics','calendar','clients','settings'].forEach(t => {
    const el = document.getElementById('tool-' + t);
    if (el) el.style.display = 'none';
    const nav = document.getElementById('nav-' + t);
    if (nav) nav.classList.remove('active');
  });
  // Show selected
  const el = document.getElementById('tool-' + tool);
  if (el) el.style.display = 'block';
  const nav = document.getElementById('nav-' + tool);
  if (nav) nav.classList.add('active');

  // Init settings when shown
  if (tool === 'settings') {
    const pro = isPro();
    // Pre-select current currency dropdown
    var ccSel = document.getElementById('settings-currency-select');
    if (ccSel) ccSel.value = currentCurrency;
    if (currentUser) {
      // Avatar: check bioState first, then query DB
      if (typeof bioState !== 'undefined' && bioState.avatar_url) {
        updateDashboardAvatar(bioState.avatar_url);
      } else {
        // bioState might not be loaded yet — query directly
        sb.from('link_in_bio').select('avatar_url').eq('user_id', currentUser.id).maybeSingle().then(function(res) {
          if (res.data?.avatar_url) {
            updateDashboardAvatar(res.data.avatar_url);
          } else {
            document.getElementById('settings-avatar').textContent = currentUser.email[0].toUpperCase();
          }
        }).catch(function() {
          document.getElementById('settings-avatar').textContent = currentUser.email[0].toUpperCase();
        });
      }
      document.getElementById('settings-email').textContent = currentUser.email;
    }
    document.getElementById('settings-sub-free').style.display = pro ? 'none' : 'block';
    document.getElementById('settings-sub-pro').style.display = pro ? 'block' : 'none';
    if (typeof updateSettingsCancelBtn === 'function') updateSettingsCancelBtn();
    const pwBtn = document.getElementById('settings-reset-password-btn');
    const pwMsg = document.getElementById('settings-password-msg');
    const pwTurnstile = document.getElementById('settings-password-turnstile');
    if (pwBtn) { pwBtn.disabled = false; pwBtn.textContent = 'Send password reset email'; }
    if (pwMsg) pwMsg.style.display = 'none';
    if (pwTurnstile) pwTurnstile.style.display = 'none';
    if (typeof resetSettingsTurnstile === 'function') resetSettingsTurnstile();
    // Load Stripe status with error handling
    try { loadStripeConnectStatus(); } catch(e) { console.error('Stripe status error:', e); }
    try { loadInstagramConnectionStatus(); } catch(e) { console.error('Instagram status error:', e); }
    // Load marketing email preference
    try {
      sb.from('profiles').select('marketing_emails').eq('user_id', currentUser.id).single().then(function(res) {
        var toggle = document.getElementById('settings-marketing-emails');
        if (toggle && res.data) toggle.checked = !!res.data.marketing_emails;
      });
    } catch(e) {}
  }
  // Init AI Design Studio
  if (tool === 'design') {
    if (!_dsLoadedOnce) { _dsLoadedOnce = true; }
    loadDesignProjects();
  }
  // Init AI Chat
  if (tool === 'aichat') {
    initAiChat();
  }
  // Init Digital Products
  if (tool === 'products') {
    initDigitalProducts();
  }
  // Update topbar title
  const title = document.getElementById('topbar-title');
  if (title) title.textContent = toolTitles[tool] || 'Dashboard';
  currentTool = tool;
  // Adjust padding — no padding for iframe tool
  const toolArea = document.querySelector('.tool-area');
  if (toolArea) toolArea.style.padding = '32px';
  // Init tools on first open
  if (tool === 'image') initImageConverter();
  if (tool === 'qr') { initQRGenerator(); loadQRLibrary(null); }
  if (tool === 'invoice') { initInvoiceGenerator(); loadSavedLogo(); }
  if (tool === 'deals') initDealsCrm();
  if (tool === 'bio') initBioTool();
  if (tool === 'courses') initCoursesTool();
  if (tool === 'coaching') initCoachingTool();
  if (tool === 'mediakit') initMediaKitTool();
  if (tool === 'grid') initGridTool();
  if (tool === 'pdfsign') initPdfSignTool();
  if (tool === 'scripts') initScriptsTool();
  if (tool === 'analytics') initAnalyticsTool();
  if (tool === 'calendar') initCalendarTool();
  if (tool === 'thumbanalyzer') initThumbanalyzerTool();
  if (tool === 'contractanalyzer') initContractanalyzerTool();
  if (tool === 'clients') initClientsTool();
  if (tool === 'welcome') loadDashStats();
  // Close sidebar on mobile
  closeSidebar();
}

// ===== Button loading state helpers =====
// Captures the original innerHTML and disables the button while a checkout is opening.
// Inline SVG spinner is reused by every call so styling stays consistent.
const _btnLoadingState = new WeakMap();
const _btnLoadingSet = new Set();
function setBtnLoading(btn, label) {
  if (!btn || _btnLoadingState.has(btn)) return;
  _btnLoadingState.set(btn, { html: btn.innerHTML, disabled: btn.disabled, cursor: btn.style.cursor });
  _btnLoadingSet.add(btn);
  btn.disabled = true;
  btn.style.cursor = 'wait';
  btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;justify-content:center;">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" style="animation:btn-spin 0.7s linear infinite;flex-shrink:0;">' +
    '<path d="M21 12a9 9 0 1 1-6.2-8.55"/>' +
    '</svg>' +
    '<span>' + (label || 'Opening checkout…') + '</span>' +
    '</span>';
}
function clearBtnLoading(btn) {
  if (!btn) return;
  const prev = _btnLoadingState.get(btn);
  if (!prev) return;
  btn.innerHTML = prev.html;
  btn.disabled = prev.disabled;
  btn.style.cursor = prev.cursor;
  _btnLoadingState.delete(btn);
  _btnLoadingSet.delete(btn);
}
// Inject the spin keyframes once (no-op if already added).
(function ensureBtnSpinKeyframes(){
  if (document.getElementById('btn-spin-keyframes')) return;
  const style = document.createElement('style');
  style.id = 'btn-spin-keyframes';
  style.textContent = '@keyframes btn-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
})();

// When the page is restored from the browser's back-forward cache (bfcache),
// any buttons left in a loading state from a previous navigation (e.g. Stripe
// checkout) will appear stuck. Clear them all on pageshow.persisted = true.
window.addEventListener('pageshow', function(e) {
  if (!e.persisted) return;
  if (!_btnLoadingSet.size) return;
  // Snapshot before iterating since clearBtnLoading mutates the Set
  Array.from(_btnLoadingSet).forEach(function(btn) {
    try { clearBtnLoading(btn); } catch (_) {}
  });
});

async function startCheckout(plan, triggerBtn) {
  if (!currentUser) { window.location.href = 'index.html'; return; }
  // Try to find the button that triggered this call so we can show a loading state.
  const btn = triggerBtn || (typeof event !== 'undefined' && event && event.currentTarget && event.currentTarget.tagName === 'BUTTON' ? event.currentTarget : null);
  if (btn) setBtnLoading(btn, 'Opening checkout…');
  // Resolve plan: explicit arg → localStorage intent → default Pro
  let targetPlan = plan;
  if (!targetPlan) {
    try { targetPlan = localStorage.getItem('fts_intended_plan'); } catch (e) {}
  }
  targetPlan = targetPlan === 'max' ? 'max' : 'monthly';
  const priceId = targetPlan === 'max' ? STRIPE_PRICE_MAX : STRIPE_PRICE_MONTHLY;

  // Extract a user-readable error message from the Edge Function response.
  // Supabase JS SDK wraps non-2xx responses in a FunctionsHttpError where the
  // body lives at err.context (a Response). We try to JSON-parse it for the
  // "error" field — that's what our Edge Function returns. Fallback to the
  // generic message if parsing fails.
  async function extractEdgeFunctionError(err) {
    try {
      if (err && err.context && typeof err.context.json === 'function') {
        const body = await err.context.json();
        if (body && body.error) return body.error;
      }
    } catch (_) {}
    return null;
  }

  try {
    const { data, error } = await sb.functions.invoke('create-checkout-session', {
      body: {
        priceId,
        userId: currentUser.id,
        successUrl: window.location.origin + '/dashboard.html?payment=success',
        cancelUrl: window.location.origin + '/dashboard.html?payment=cancelled',
      }
    });
    if (error) {
      // Try to surface the specific error from the Edge Function (e.g. the
      // trial-downgrade block). Throw the specific message if we got one,
      // otherwise re-throw the original.
      const specificMsg = await extractEdgeFunctionError(error);
      if (specificMsg) {
        const e = new Error(specificMsg);
        e.userFacing = true;
        throw e;
      }
      throw error;
    }
    // Clear localStorage intent after successful initiation
    try { localStorage.removeItem('fts_intended_plan'); } catch (e) {}
    if (data?.url) {
      if (data.upgraded || data.alreadyOnPlan) {
        // Tier updated in-place — refresh user tier and show status inline
        await fetchTier(currentUser.id);
        let msg;
        if (data.alreadyOnPlan) {
          msg = "You're already on this plan.";
        } else if (data.trialApplied) {
          msg = data.reactivated
            ? "Upgraded to Creator Max and your cancellation was reversed. Enjoy 7 days free, then your existing billing cycle continues at the Max rate."
            : "Upgraded to Creator Max. Enjoy 7 days free, then your existing billing cycle continues at the Max rate.";
        } else if (data.reactivated) {
          msg = "Plan updated and your cancellation was reversed. You'll continue to be billed on your existing cycle.";
        } else {
          msg = "Plan updated successfully.";
        }
        // Show in settings modal if open, otherwise a subtle toast
        if (typeof showSettingsResult === 'function' && document.getElementById('tool-settings')?.style.display !== 'none') {
          showSettingsResult('success', msg);
        } else {
          // Settings modal is closed — open it so the user sees their new state
          if (typeof openSettingsModal === 'function') {
            openSettingsModal();
            setTimeout(() => showSettingsResult('success', msg), 150);
          }
        }
        clearBtnLoading(btn);
      } else {
        // Page is about to navigate away — keep the loading state so users don't double-click
        window.location.href = data.url;
      }
    } else {
      clearBtnLoading(btn);
    }
  } catch (err) {
    console.error('Checkout error:', err);
    clearBtnLoading(btn);
    // Prefer the specific Edge Function error message if we extracted one,
    // otherwise show the generic fallback.
    const message = err && err.userFacing
      ? err.message
      : 'Something went wrong. Please try again.';
    // Show inline error instead of browser alert
    if (typeof showSettingsResult === 'function' && document.getElementById('tool-settings')?.style.display !== 'none') {
      showSettingsResult('error', message);
    } else if (typeof showDashToast === 'function') {
      showDashToast('error', message);
    } else {
      alert(message);
    }
  }
}

function openSignoutModal() {
  const modal = document.getElementById('signout-modal');
  if (modal) modal.style.display = 'flex';
}

// Step 1: user clicked "Upgrade to Creator Max" — show inline confirmation

// Confirm + trigger upgrade from outside the settings modal (e.g. topbar button)
function promptUpgradeToMax() {
  const modal = document.getElementById('topbar-upgrade-confirm-modal');
  if (modal) modal.style.display = 'flex';
}

function closeTopbarUpgradeConfirm() {
  const modal = document.getElementById('topbar-upgrade-confirm-modal');
  if (modal) modal.style.display = 'none';
}

// ========================================================================
// PRO UPSELL MODAL — reusable for any Pro-locked feature.
// Call: showProUpsell({ feature: 'Custom Theme', description: '...' })
//   - feature: short name shown in title (e.g., "Custom Theme is a Pro feature")
//   - description: optional 1-2 sentence pitch shown above the feature list
//
// If called without args, shows generic "Upgrade to Pro" copy.
// ========================================================================
function showProUpsell(opts) {
  const modal = document.getElementById('pro-upsell-modal');
  if (!modal) return;
  const titleEl = document.getElementById('pro-upsell-title');
  const descEl = document.getElementById('pro-upsell-description');
  if (titleEl) {
    titleEl.textContent = opts && opts.feature
      ? `${opts.feature} is a Pro feature`
      : 'Upgrade to Pro';
  }
  if (descEl) {
    descEl.textContent = opts && opts.description
      ? opts.description
      : 'Unlock this feature and more by upgrading to Pro.';
  }
  modal.style.display = 'flex';
}

function closeProUpsell() {
  const modal = document.getElementById('pro-upsell-modal');
  if (modal) modal.style.display = 'none';
}

async function confirmProUpsell(ev) {
  const btn = ev && ev.currentTarget && ev.currentTarget.tagName === 'BUTTON' ? ev.currentTarget : null;
  // Free → Pro goes through standard Stripe checkout (new card needed).
  // The modal stays open while the redirect happens so the user sees the spinner.
  await startCheckout('monthly', btn);
  closeProUpsell();
}

async function confirmTopbarUpgradeToMax(ev) {
  const btn = ev && ev.currentTarget && ev.currentTarget.tagName === 'BUTTON' ? ev.currentTarget : null;
  // Modal stays open while loading so the spinner is visible. On success the page
  // navigates to Stripe (or in-place upgrade opens settings) — close the confirm
  // modal afterward in either case so it doesn't sit on top.
  await startCheckout('max', btn);
  closeTopbarUpgradeConfirm();
}

// Unified handler for any "Upgrade to Creator Max" button outside the topbar.
// Free users go straight to Stripe checkout (need to enter card).
// Pro users see the confirmation modal first (avoid accidental in-place upgrade).
function handleMaxUpgradeClick(ev) {
  if (isPro() && !isMax()) {
    promptUpgradeToMax();
  } else {
    const btn = ev && ev.currentTarget && ev.currentTarget.tagName === 'BUTTON' ? ev.currentTarget : null;
    startCheckout('max', btn);
  }
}

// Step 1: user clicked "Downgrade to Pro" — show inline confirmation
function closeSignoutModal() {
  const modal = document.getElementById('signout-modal');
  if (modal) modal.style.display = 'none';
}
async function confirmSignOut() {
  const btn = document.getElementById('signout-confirm-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span> Signing out...'; }
  try { await sb.auth.signOut(); } catch(e) { console.error(e); }
  // Reset tool init flags so fresh data loads on next login
  bioInited = false;
  bioState = { username: '', display_name: '', bio: '', avatar_url: '', avatar_display: 'default', theme: 'purple', font_family: 'DM Sans', socials: {}, links: [], videos: [], published: false, show_branding: true, custom_theme: null };
  bioOriginalUsername = '';
  window._ryx_username = '';
  gridInited = false;
  gridPhotos = [];
  gridLoaded = false;
  gridDirty = false;
  if (typeof mkInited !== 'undefined') mkInited = false;
  if (typeof window._faDataLoaded !== 'undefined') window._faDataLoaded = false;
  if (typeof window._faListenersReady !== 'undefined') window._faListenersReady = false;
  currentUser = null;
  userTier = 'free';
  // Clear stale DOM inputs
  var bioInput = document.getElementById('bio-username');
  if (bioInput) bioInput.value = '';
  var mkInput = document.getElementById('mk-username');
  if (mkInput) mkInput.value = '';
  if (typeof applyDashGreeting === 'function') applyDashGreeting('creator');
  showPwaLogin();
}

// =====================================================
// PWA LOGIN SCREEN
// =====================================================
var pwaAuthMode = 'signin';
var pwaTurnstileWidgetId = null;

function showPwaLogin() {
  var screen = document.getElementById('pwa-login-screen');
  if (!screen) return;
  screen.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  document.body.style.height = '100%';
  // Hide dashboard content
  var sidebar = document.getElementById('sidebar');
  var main = document.querySelector('.main');
  if (sidebar) sidebar.style.display = 'none';
  if (main) main.style.display = 'none';
  // In standalone/PWA mode, remove logo link
  var logoWrap = document.getElementById('pwa-login-logo');
  if (logoWrap && isPwaMode) {
    logoWrap.innerHTML = '<img src="/logo.png" alt="Ryxa" style="width:56px;height:56px;margin:0 auto 16px;display:block;">';
  }
  // Reset form
  var emailEl = document.getElementById('pwa-email');
  var pwEl = document.getElementById('pwa-password');
  if (emailEl) emailEl.value = '';
  if (pwEl) pwEl.value = '';
  var msg = document.getElementById('pwa-auth-msg');
  if (msg) msg.style.display = 'none';
  var btn = document.getElementById('pwa-submit-btn');
  if (btn) { btn.disabled = false; btn.textContent = pwaAuthMode === 'signin' ? 'Sign in' : 'Create account'; }
  renderPwaTurnstile();
  setTimeout(function() { if (emailEl) emailEl.focus(); }, 100);
}

function hidePwaLogin() {
  var screen = document.getElementById('pwa-login-screen');
  if (screen) screen.style.display = 'none';
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
  document.body.style.height = '';
  var sidebar = document.getElementById('sidebar');
  var main = document.querySelector('.main');
  if (sidebar) sidebar.style.display = '';
  if (main) main.style.display = '';
}

function setPwaAuthMode(mode) {
  pwaAuthMode = mode;
  var signinTab = document.getElementById('pwa-tab-signin');
  var signupTab = document.getElementById('pwa-tab-signup');
  var btn = document.getElementById('pwa-submit-btn');
  var forgot = document.getElementById('pwa-forgot-link');
  var pw = document.getElementById('pwa-password');
  if (mode === 'signin') {
    if (signinTab) { signinTab.style.background = 'var(--accent)'; signinTab.style.color = '#fff'; }
    if (signupTab) { signupTab.style.background = 'transparent'; signupTab.style.color = 'var(--muted)'; }
    if (btn) btn.textContent = 'Sign in';
    if (forgot) forgot.style.display = 'block';
    if (pw) pw.setAttribute('autocomplete', 'current-password');
  } else {
    if (signupTab) { signupTab.style.background = 'var(--accent)'; signupTab.style.color = '#fff'; }
    if (signinTab) { signinTab.style.background = 'transparent'; signinTab.style.color = 'var(--muted)'; }
    if (btn) btn.textContent = 'Create account';
    if (forgot) forgot.style.display = 'none';
    if (pw) pw.setAttribute('autocomplete', 'new-password');
  }
  var msg = document.getElementById('pwa-auth-msg');
  if (msg) msg.style.display = 'none';
}

function showPwaMsg(type, text) {
  var el = document.getElementById('pwa-auth-msg');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(74,222,128,0.1)';
  el.style.color = type === 'error' ? '#fca5a5' : '#86efac';
  el.style.border = '1px solid ' + (type === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(74,222,128,0.2)');
  el.textContent = text;
}

function renderPwaTurnstile() {
  if (typeof turnstile === 'undefined') { setTimeout(renderPwaTurnstile, 200); return; }
  var container = document.getElementById('pwa-turnstile');
  if (!container) return;
  if (pwaTurnstileWidgetId !== null) { try { turnstile.reset(pwaTurnstileWidgetId); } catch(e) {} return; }
  pwaTurnstileWidgetId = turnstile.render('#pwa-turnstile', { sitekey: '0x4AAAAAAC9W8avdI3sdVEcc', theme: 'dark', size: 'flexible' });
}

function getPwaTurnstileToken() {
  if (typeof turnstile === 'undefined' || pwaTurnstileWidgetId === null) return null;
  try { return turnstile.getResponse(pwaTurnstileWidgetId); } catch(e) { return null; }
}

function resetPwaTurnstile() {
  if (typeof turnstile !== 'undefined' && pwaTurnstileWidgetId !== null) { try { turnstile.reset(pwaTurnstileWidgetId); } catch(e) {} }
}

async function handlePwaGoogleAuth() {
  var { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'https://ryxa.io/dashboard.html',
      queryParams: { prompt: 'select_account' }
    }
  });
  if (error) showPwaMsg('error', error.message);
}

async function handlePwaAuth() {
  var email = document.getElementById('pwa-email').value.trim();
  var password = document.getElementById('pwa-password').value;
  var btn = document.getElementById('pwa-submit-btn');
  if (!email || !password) { showPwaMsg('error', 'Please enter your email and password.'); return; }
  var captchaToken = getPwaTurnstileToken();
  if (!captchaToken) { showPwaMsg('error', 'Please complete the verification check.'); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="auth-spinner"></span>' + (pwaAuthMode === 'signin' ? 'Signing in...' : 'Creating account...');
  var result = pwaAuthMode === 'signin'
    ? await sb.auth.signInWithPassword({ email: email, password: password, options: { captchaToken: captchaToken } })
    : await sb.auth.signUp({ email: email, password: password, options: { captchaToken: captchaToken, emailRedirectTo: 'https://ryxa.io/dashboard.html' } });
  btn.disabled = false;
  btn.textContent = pwaAuthMode === 'signin' ? 'Sign in' : 'Create account';
  resetPwaTurnstile();
  if (result.error) {
    var msg = result.error.message;
    if (msg.toLowerCase().indexOf('captcha') !== -1 || msg.toLowerCase().indexOf('invalid-input') !== -1) {
      msg = 'Verification failed. Please disable your ad blocker for ryxa.io and try again.';
    }
    showPwaMsg('error', msg);
    return;
  }
  if (pwaAuthMode === 'signup') {
    var identities = result.data?.user?.identities;
    if (identities && identities.length === 0) {
      showPwaMsg('error', 'An account with this email already exists. Try signing in instead.');
    } else if (result.data?.user && !result.data.session) {
      showPwaMsg('success', 'Check your email to confirm your account!');
    } else {
      hidePwaLogin();
      window.location.reload();
    }
  } else {
    hidePwaLogin();
    window.location.reload();
  }
}

async function handlePwaForgotPassword() {
  var email = document.getElementById('pwa-email').value.trim();
  if (!email) { showPwaMsg('error', 'Enter your email address above first.'); return; }
  var captchaToken = getPwaTurnstileToken();
  if (!captchaToken) { showPwaMsg('error', 'Please complete the verification check.'); return; }
  var { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://ryxa.io/reset-password.html', captchaToken: captchaToken });
  resetPwaTurnstile();
  if (error) {
    var msg = error.message;
    if (msg.toLowerCase().indexOf('captcha') !== -1 || msg.toLowerCase().indexOf('invalid-input') !== -1) {
      msg = 'Verification failed. Please disable your ad blocker for ryxa.io and try again.';
    }
    showPwaMsg('error', msg);
  } else showPwaMsg('success', 'Password reset email sent! Check your inbox.');
}

// Enter key submits PWA login
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && document.getElementById('pwa-login-screen').style.display === 'flex') handlePwaAuth();
});


// =====================================================
// CURRENCY SYSTEM (global)
// =====================================================
// Holds the current user's display currency. Loaded from profile on signin,
// updated when user changes it in Settings. Defaults to USD.
var currentCurrency = 'USD';

// Map of supported currencies → { symbol, code, locale }
var SUPPORTED_CURRENCIES = {
  USD: { symbol: '$', code: 'USD', locale: 'en-US', name: 'US Dollar' },
  EUR: { symbol: '€', code: 'EUR', locale: 'en-IE', name: 'Euro' },
  GBP: { symbol: '£', code: 'GBP', locale: 'en-GB', name: 'British Pound' },
  CAD: { symbol: 'CA$', code: 'CAD', locale: 'en-CA', name: 'Canadian Dollar' },
  AUD: { symbol: 'A$', code: 'AUD', locale: 'en-AU', name: 'Australian Dollar' },
  JPY: { symbol: '¥', code: 'JPY', locale: 'ja-JP', name: 'Japanese Yen' },
  INR: { symbol: '₹', code: 'INR', locale: 'en-IN', name: 'Indian Rupee' },
  BRL: { symbol: 'R$', code: 'BRL', locale: 'pt-BR', name: 'Brazilian Real' },
  MXN: { symbol: 'MX$', code: 'MXN', locale: 'es-MX', name: 'Mexican Peso' },
  CHF: { symbol: 'CHF', code: 'CHF', locale: 'de-CH', name: 'Swiss Franc' },
  SGD: { symbol: 'S$', code: 'SGD', locale: 'en-SG', name: 'Singapore Dollar' },
  SEK: { symbol: 'kr', code: 'SEK', locale: 'sv-SE', name: 'Swedish Krona' },
  NOK: { symbol: 'kr', code: 'NOK', locale: 'nb-NO', name: 'Norwegian Krone' },
  NZD: { symbol: 'NZ$', code: 'NZD', locale: 'en-NZ', name: 'New Zealand Dollar' },
  ZAR: { symbol: 'R', code: 'ZAR', locale: 'en-ZA', name: 'South African Rand' }
};

// Returns the currency symbol for the current display currency
function getCurrencySymbol() {
  var c = SUPPORTED_CURRENCIES[currentCurrency] || SUPPORTED_CURRENCIES.USD;
  return c.symbol;
}

// Format a value (in cents) as the user's display currency.
// fractionDigits=null = smart default (0 for whole amounts, 2 for cents).
function formatMoney(cents, opts) {
  opts = opts || {};
  if (cents == null) cents = 0;
  var amount = cents / 100;
  var fractionDigits = opts.fractionDigits;
  if (fractionDigits == null) {
    // Smart default: show cents if they're meaningful, else whole amounts
    fractionDigits = (amount % 1 === 0) ? 0 : 2;
  }
  if (opts.alwaysShowCents) fractionDigits = 2;

  var c = SUPPORTED_CURRENCIES[currentCurrency] || SUPPORTED_CURRENCIES.USD;
  // JPY has no fractional unit
  if (c.code === 'JPY') fractionDigits = 0;

  try {
    return new Intl.NumberFormat(c.locale, {
      style: 'currency',
      currency: c.code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(amount);
  } catch (e) {
    // Fallback if browser doesn't support the locale
    return c.symbol + amount.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
  }
}

// Backward-compatible alias — many places in code call formatDashUSD
function formatDashUSD(cents) {
  return formatMoney(cents, { fractionDigits: 0 });
}

// Updates all UI elements that show the currency symbol prefix (e.g., $ in price inputs)
function applyCurrencySymbols() {
  var symbol = getCurrencySymbol();
  document.querySelectorAll('.currency-symbol-prefix').forEach(function(el) {
    el.textContent = symbol;
  });
  // Also update any static $0 stat placeholders that haven't been populated yet
  document.querySelectorAll('.currency-zero-placeholder').forEach(function(el) {
    el.textContent = formatMoney(0);
  });
  // Recalculate invoice totals so the placeholders refresh in the right currency
  if (typeof calcTotals === 'function') {
    try { calcTotals(); } catch (e) { /* invoice tool not loaded yet */ }
  }
  // Pre-select current currency in the settings dropdown
  var sel = document.getElementById('settings-currency-select');
  if (sel) sel.value = currentCurrency;
}

// Called when user picks a new currency from the Settings dropdown



// LINK IN BIO
// =====================================================
const BIO_RESERVED = new Set([
  'admin','about','api','blog','contact','dashboard','deal','brand-portal','faq','findthesnakes','ryxa',
  'follower-audit','help','home','index','instructions','login','mail',
  'pricing','privacy','reset-password','root','settings','signin','signup',
  'support','terms','user','username','www',
  'youtube','instagram','tiktok','twitter','facebook','google','snake','snakes'
]);
const BIO_SOCIAL_FIELDS = [
  { key:'instagram', label:'Instagram', placeholder:'yourhandle', type:'username',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>' },
  { key:'tiktok', label:'TikTok', placeholder:'yourhandle', type:'username',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.9a4.85 4.85 0 0 1-1.84-.21Z"/></svg>' },
  { key:'youtube', label:'YouTube', placeholder:'https://youtube.com/@yourchannel', type:'url',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.54 3.58 12 3.58 12 3.58s-7.54 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3 3 0 0 0 2.1 2.12c1.86.5 9.4.5 9.4.5s7.54 0 9.4-.5a3 3 0 0 0 2.1-2.12C24 15.93 24 12 24 12s0-3.93-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"/></svg>' },
  { key:'facebook', label:'Facebook', placeholder:'https://facebook.com/yourpage', type:'url',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>' },
  { key:'snapchat', label:'Snapchat', placeholder:'yourhandle', type:'username',
    svg:'<svg viewBox="-4.4 -2.25 24 24" aria-hidden="true"><path d="M12.02 0C5.44 0 4.73 5.08 4.86 7.15c.03.5.05 1.01.06 1.52-.3.16-.79.38-1.29.38-.38 0-.75-.14-1.08-.41-.06-.05-.17-.14-.35-.14-.3 0-.65.17-.92.47-.3.34-.3.78.02 1.08.27.26.7.48 1.2.62.68.19 1.56.49 1.79 1.04.13.3-.01.69-.41 1.17a.35.35 0 0 1-.03.03c-.01.02-1.28 2.08-4.21 2.56-.22.04-.38.24-.36.46 0 .05.02.1.04.15.13.3.56.52 1.32.68.08.02.14.11.17.3.03.18.07.4.17.63.1.23.29.35.55.35.14 0 .3-.03.48-.06.25-.05.57-.11.96-.11.22 0 .44.02.68.06.45.07.83.34 1.27.65.63.45 1.35.96 2.43.96.08 0 .17 0 .26-.02.08.01.2.02.33.02 1.08 0 1.8-.51 2.43-.96.44-.31.82-.58 1.27-.65.24-.04.46-.06.68-.06.38 0 .68.05.96.11.2.04.36.06.48.06h.02c.19 0 .41-.08.53-.35.1-.22.14-.43.17-.62.02-.17.09-.28.17-.3.76-.16 1.19-.38 1.32-.68a.43.43 0 0 0 .04-.15c.02-.22-.14-.42-.36-.46-2.93-.48-4.2-2.54-4.21-2.56a.57.57 0 0 1-.03-.03c-.4-.48-.54-.87-.41-1.17.23-.55 1.11-.85 1.79-1.04.5-.14.93-.36 1.2-.62.33-.32.33-.76.03-1.08-.28-.3-.63-.47-.92-.47-.19 0-.3.08-.35.14-.32.26-.69.41-1.08.41-.5 0-.99-.22-1.29-.38.01-.51.03-1.02.06-1.52.13-2.07-.58-7.15-7.16-7.15Z"/></svg>' },
  { key:'linkedin', label:'LinkedIn', placeholder:'https://linkedin.com/in/yourname', type:'url',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.26 2.37 4.26 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"/></svg>' },
  { key:'website', label:'Website', placeholder:'https://yoursite.com', type:'url',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.93 9h-3.47a15.6 15.6 0 0 0-1.4-5.33A8 8 0 0 1 19.93 11ZM12 4a13.7 13.7 0 0 1 2.46 7h-4.92A13.7 13.7 0 0 1 12 4ZM4.26 13h3.47a15.6 15.6 0 0 0 1.4 5.33A8 8 0 0 1 4.26 13Zm0-2a8 8 0 0 1 4.87-6.33A15.6 15.6 0 0 0 7.73 11H4.26ZM12 20a13.7 13.7 0 0 1-2.46-7h4.92A13.7 13.7 0 0 1 12 20Zm2.87-1.67A15.6 15.6 0 0 0 16.27 13h3.47a8 8 0 0 1-4.87 5.33Z"/></svg>' },
  { key:'email', label:'Email', placeholder:'you@example.com', type:'email',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 4h20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm10 9.44L3.3 6H20.7L12 13.44Z"/></svg>' },
  { key:'phone', label:'Phone', placeholder:'+1 555 000 0000', type:'phone',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.98.98 0 0 0-1.01.24l-1.57 1.97a15.1 15.1 0 0 1-6.92-6.92l1.97-1.57c.27-.27.35-.66.24-1.02A11.2 11.2 0 0 1 8.62 4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.62c0-.55-.45-1-1-1Z"/></svg>' },
];





document.getElementById('signout-modal').addEventListener('click', function(e) {
  if (e.target === this) closeSignoutModal();
});

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
  closeSidebarMenu();
}

function toggleSidebarMenu() {
  var menu = document.getElementById('sidebar-user-menu');
  if (menu) {
    var willOpen = menu.style.display === 'none';
    if (willOpen) renderAiUsage();  // synchronous render from cache, before showing menu
    menu.style.display = willOpen ? 'block' : 'none';
    if (willOpen) fetchAiUsage();   // refresh in background for next open
  }
}
function closeSidebarMenu() {
  var menu = document.getElementById('sidebar-user-menu');
  if (menu) menu.style.display = 'none';
}

// AI usage state — cached so the menu opens instantly with no layout shift.
window._aiUsageCache = null;

// Fetch AI usage from server and update cache.
// Safe to call repeatedly — it's a single indexed COUNT query.
async function fetchAiUsage() {
  try {
    var { data, error } = await sb.rpc('get_ai_usage');
    if (error || !data || data.error) {
      window._aiUsageCache = { hidden: true };
    } else {
      window._aiUsageCache = data;
    }
    // If menu is currently open, refresh the rendered bar with the new data
    var menu = document.getElementById('sidebar-user-menu');
    if (menu && menu.style.display !== 'none') renderAiUsage();
  } catch (e) {
    console.error('fetchAiUsage failed:', e);
    window._aiUsageCache = { hidden: true };
  }
}

// Render AI usage bar from cache. Synchronous, no fetch.
// Free tier shows a locked state with an upgrade CTA — drives upsell visibility.
// Pro/Max tier shows the live counter.
function renderAiUsage() {
  var box = document.getElementById('sidebar-ai-usage');
  if (!box) return;
  var data = window._aiUsageCache;

  // No cache yet — keep box hidden until first fetch returns
  if (!data || data.hidden) { box.style.display = 'none'; return; }

  var bar = document.getElementById('sidebar-ai-bar');
  var pctEl = document.getElementById('sidebar-ai-pct');
  var countEl = document.getElementById('sidebar-ai-count');
  var resetEl = document.getElementById('sidebar-ai-reset');
  var lockEl = document.getElementById('sidebar-ai-lock');
  var upgradeBtn = document.getElementById('sidebar-ai-upgrade');

  var limit = Number(data.limit || 0);

  // FREE TIER — locked state, drive upgrade
  if (limit === 0) {
    var teaserLimit = 40;  // show what they'd get on Pro
    bar.style.width = '0%';
    bar.style.background = 'var(--muted)';
    pctEl.textContent = 'Locked';
    pctEl.style.color = 'var(--muted)';
    countEl.textContent = '0 / ' + teaserLimit + ' calls';
    countEl.style.opacity = '0.6';
    resetEl.textContent = '';
    if (lockEl) lockEl.style.display = '';
    if (upgradeBtn) upgradeBtn.style.display = 'block';
    box.style.display = 'block';
    return;
  }

  // PRO / MAX — live counter
  if (lockEl) lockEl.style.display = 'none';
  if (upgradeBtn) upgradeBtn.style.display = 'none';
  countEl.style.opacity = '1';

  var used = Number(data.used || 0);
  var pct = Math.min(100, Math.round((used / limit) * 100));
  var color = pct < 60 ? '#22c55e' : (pct < 85 ? '#eab308' : '#ef4444');

  bar.style.width = pct + '%';
  bar.style.background = color;
  pctEl.textContent = pct + '%';
  pctEl.style.color = color;
  countEl.textContent = used + ' / ' + limit + ' calls';

  if (data.next_reset_at && used >= limit) {
    var resetDate = new Date(data.next_reset_at);
    resetEl.textContent = 'Resets at ' + resetDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } else if (data.next_reset_at) {
    var resetDate2 = new Date(data.next_reset_at);
    resetEl.textContent = '+1 slot at ' + resetDate2.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } else {
    resetEl.textContent = '';
  }

  box.style.display = 'block';
}

// Backwards-compat: any code that calls loadAiUsage() still works
function loadAiUsage() { fetchAiUsage(); }

document.addEventListener('click', function(e) {
  var menu = document.getElementById('sidebar-user-menu');
  if (!menu || menu.style.display === 'none') return;
  var bottom = menu.closest('.sidebar-bottom');
  if (bottom && !bottom.contains(e.target)) closeSidebarMenu();
});

// Check for payment return
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('payment') === 'success') {
  setTimeout(() => fetchTier(currentUser?.id), 2000);
  history.replaceState({}, '', 'dashboard.html');
}

initAuth();
// Reveal page once layout is stable
requestAnimationFrame(function() { document.body.classList.add('ready'); });
// Fallback: if auth hasn't completed in 8s, reload once
var _authCompleted = false;
setTimeout(function() {
  if (!_authCompleted) {
    try {
      var retried = sessionStorage.getItem('_authRetry');
      if (!retried) {
        sessionStorage.setItem('_authRetry', '1');
        window.location.reload();
      } else {
        sessionStorage.removeItem('_authRetry');
        var dl = document.getElementById('dash-loading');
        if (dl) dl.innerHTML = '<div style="text-align:center;"><div style="font-size:14px;color:var(--muted);margin-bottom:12px;">Something went wrong. Please try again.</div><button data-dash-action="reload" style="padding:10px 24px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:13px;font-family:DM Sans,sans-serif;cursor:pointer;">Retry</button></div>';
      }
    } catch(e) {}
  }
}, 8000);


// =====================================================
// STRIPE CONNECT
// =====================================================
// Stripe Connect client ID is now handled server-side in /api/stripe-connect-start


// If the user clicks back from Meta's OAuth page (or from any post-redirect
// page) the browser may restore this page from the back-forward cache with
// the button still in its "Redirecting..." state. Reset it on bfcache restore.
// Same logic applied to the Stripe Connect button to handle bailing on that flow.
window.addEventListener('pageshow', function(e) {
  if (e.persisted) {
    resetInstagramConnectButton();
    // Reset Stripe Connect button only if it's actually stuck on the redirecting state
    const stripeBtn = document.getElementById('settings-stripe-connect-btn');
    if (stripeBtn && /Redirecting to Stripe/i.test(stripeBtn.innerText || stripeBtn.textContent || '')) {
      stripeBtn.disabled = false;
      stripeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg> Connect Stripe Account';
    }
  }
});










// ════════════════════════════════════════════
// TOOL INIT ON SWITCH
// ════════════════════════════════════════════



// ===== AI BIO ASSIST =====

// ===== AI CLEAN UP (Courses / Coaching) =====
function aiCleanUp(textareaId) {
  if (typeof isPro === 'function' && !isPro()) {
    showModalAlert('Pro Feature', 'AI Clean Up is a Pro feature. Upgrade to use it.');
    return;
  }

  var textarea = document.getElementById(textareaId);
  if (!textarea) return;
  var text = textarea.value.trim();
  if (!text) {
    showModalAlert('Empty Field', 'Write some content first, then use AI Clean Up to polish it.');
    return;
  }

  var overlay = document.createElement('div');
  overlay.id = 'ai-cleanup-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:440px;width:100%;max-height:calc(100vh - 80px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(124,58,237,0.4) transparent;text-align:center;">'
    + '<svg width="24" height="24" viewBox="0 0 24 24" style="animation:btn-spin 0.6s linear infinite;margin-bottom:12px;" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>'
    + '<div style="font-size:14px;color:var(--text);">Cleaning up your text...</div>'
    + '</div>';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);

  fetch('/api/ai-cleanup', {
    method: 'POST',
    headers: getAIHeaders(),
    body: JSON.stringify({ text: text })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) { overlay.remove(); showModalAlert('Error', data.error); return; }

    var inner = overlay.querySelector('div');
    inner.style.textAlign = 'left';
    inner.style.maxHeight = 'calc(100vh - 80px)';
    inner.style.overflowY = 'auto';
    inner.style.scrollbarWidth = 'thin';
    inner.innerHTML = '<div style="font-family:Syne,sans-serif;font-size:18px;font-weight:800;letter-spacing:-0.3px;margin-bottom:14px;">AI Clean Up</div>'
      + '<div style="padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:10px;">'
      + '<div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:6px;">ORIGINAL</div>'
      + '<div style="font-size:12px;color:var(--muted);line-height:1.6;white-space:pre-wrap;">' + escapeHtml(text.substring(0, 300)) + (text.length > 300 ? '...' : '') + '</div>'
      + '</div>'
      + '<div style="padding:14px;background:var(--surface);border:1px solid rgba(124,58,237,0.25);border-radius:10px;margin-bottom:16px;">'
      + '<div style="font-size:11px;color:var(--accent2);font-weight:600;margin-bottom:6px;">CLEANED UP</div>'
      + '<div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap;" id="ai-cleanup-result">' + escapeHtml(data.result) + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:8px;">'
      + '<button data-dash-action="apply-cleanup" data-ai-textarea-id="' + textareaId + '" style="flex:1;padding:11px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:500;font-family:DM Sans,sans-serif;cursor:pointer;">Apply</button>'
      + '<button data-dash-action="discard-cleanup" style="flex:1;padding:11px;background:transparent;border:1px solid var(--border-hover);color:var(--muted);border-radius:8px;font-size:14px;font-family:DM Sans,sans-serif;cursor:pointer;">Keep original</button>'
      + '</div>';
  })
  .catch(function() {
    overlay.remove();
    showModalAlert('Error', 'Failed to clean up text. Try again.');
  });
}

function applyCleanUp(textareaId) {
  var result = document.getElementById('ai-cleanup-result')?.textContent;
  if (!result) return;
  var textarea = document.getElementById(textareaId);
  if (!textarea) return;
  textarea.value = result;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('ai-cleanup-modal')?.remove();
}



// PWA Install — Chrome: deferred prompt, iOS: instruction modal
var deferredInstallPrompt = null;
var isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

// Hide install button only if currently running as standalone, otherwise show it
if (!isStandalone) {
  var btn = document.getElementById('sidebar-install-btn');
  if (btn) btn.style.display = 'flex';
}

window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  deferredInstallPrompt = e;
});

function handleInstallClick() {
  if (deferredInstallPrompt) {
    // Chrome/Android — use native prompt
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(function(result) {
      deferredInstallPrompt = null;
    });
  } else if (isIos) {
    // iOS — show instruction modal
    openInstallModal();
  } else {
    // Desktop/other with no prompt available — already installed or not supported
    showModalAlert('Already Installed', 'Ryxa is already installed on your device. Look for it in your apps or taskbar.');
  }
}

function openInstallModal() {
  var modal = document.getElementById('install-modal');
  if (modal) modal.style.display = 'flex';
}

function closeInstallModal() {
  var modal = document.getElementById('install-modal');
  if (modal) modal.style.display = 'none';
}

// Close install modal on click outside
document.addEventListener('click', function(e) {
  var modal = document.getElementById('install-modal');
  if (modal && e.target === modal) closeInstallModal();
});


document.getElementById('signout-modal').addEventListener('click', function(e) {
  if (e.target === this) closeSignoutModal();
});

// Brand Deal CRM — delete modal click-outside-to-close (attached after DOMContentLoaded since modal is below)
window.addEventListener('DOMContentLoaded', () => {
  const ddm = document.getElementById('deal-delete-modal');
  if (ddm) ddm.addEventListener('click', function(e) { if (e.target === this) closeDealDeleteModal(); });
  const dsm = document.getElementById('deal-share-modal');
  if (dsm) dsm.addEventListener('click', function(e) { if (e.target === this) closeShareModal(); });
});

// =============================================================================
// DASHBOARD-SHELL ACTION REGISTRATIONS
// -----------------------------------------------------------------------------
// Handlers for modals and UI elements that live in dashboard.html outside any
// tool. Tool-specific actions live in each tool's own JS file.
// =============================================================================

// Sign-out modal
dashRegisterAction('close-signout', () => closeSignoutModal());
dashRegisterAction('confirm-signout', () => confirmSignOut());

// Terms-of-service acceptance modal
dashRegisterAction('accept-terms', () => acceptTerms());

// PWA install instructions modal (iOS)
dashRegisterAction('close-install', () => closeInstallModal());

// Mobile sidebar overlay (click outside sidebar to close it)
dashRegisterAction('close-sidebar', () => closeSidebar());

// Generic confirm modal (resolveDashConfirm lives in js/deals.js for historical
// reasons but is used across tools via dashConfirm()).
dashRegisterAction('resolve-confirm-false', () => resolveDashConfirm(false));
dashRegisterAction('resolve-confirm-true', () => resolveDashConfirm(true));

// Error-state retry button (used inside an inline-generated error message in
// the dashboard loading flow)
dashRegisterAction('reload', () => window.location.reload());

// Support modal (dynamically generated by openSupportModal)
dashRegisterAction('copy-support-email', (e, el) => copyEmail(el));
dashRegisterAction('close-support', () => closeSupportModal());

// AI Cleanup modal (dynamically generated by aiCleanUp)
dashRegisterAction('apply-cleanup', (e, el) => applyCleanUp(el.dataset.aiTextareaId));
dashRegisterAction('discard-cleanup', () => {
  document.getElementById('ai-cleanup-modal')?.remove();
});

// Topbar upgrade-to-Max confirmation modal
dashRegisterAction('confirm-topbar-upgrade-max', (e) => confirmTopbarUpgradeToMax(e));
dashRegisterAction('close-topbar-upgrade-confirm', () => closeTopbarUpgradeConfirm());

// Pro upsell modal — triggered by showProUpsell() for Pro-locked features
dashRegisterAction('confirm-pro-upsell', (e) => confirmProUpsell(e));
dashRegisterAction('close-pro-upsell', () => closeProUpsell());
// Only close if the click target IS the backdrop element itself (not a child).
// Mirrors the original inline `if(event.target===this)closeProUpsell()`.
dashRegisterAction('close-pro-upsell-if-backdrop', (e, el) => {
  if (e.target === el) closeProUpsell();
});

// =============================================================================
// SIDEBAR ACTIONS
// -----------------------------------------------------------------------------
// Tool navigation, sidebar menu open/close, sidebar utility buttons.
// =============================================================================

// Tool navigation — generic show-tool, reads target from data-dash-tool attribute.
// Used by every sidebar tool button. Follower has its own wrapper that does
// extra setup (showFollowerTool) so it's a separate action.
dashRegisterAction('show-tool', (e, el) => {
  if (typeof showTool === 'function') showTool(el.dataset.dashTool);
});
dashRegisterAction('show-follower', () => {
  if (typeof showFollowerTool === 'function') showFollowerTool();
});

// Sidebar account menu (the popup at bottom-left)
dashRegisterAction('toggle-sidebar-menu', () => toggleSidebarMenu());
dashRegisterAction('close-sidebar-menu', () => closeSidebarMenu());

// Sidebar utility — "Copy bio link" button (calls into bio.js)
dashRegisterAction('copy-sidebar-bio-link', () => copySidebarBioLink());

// Compound actions — these combine menu-close with another action so the menu
// closes when navigating away (mimics the original inline `a();b();` pattern).
dashRegisterAction('sidebar-upgrade-pro', (e, el) => {
  closeSidebarMenu();
  startCheckout('monthly', el);
});
dashRegisterAction('sidebar-install-pwa', () => {
  handleInstallClick();
  closeSidebarMenu();
});
dashRegisterAction('sidebar-open-signout', () => {
  openSignoutModal();
  closeSidebarMenu();
});

// =============================================================================
// TOPBAR ACTIONS
// -----------------------------------------------------------------------------
// Mobile hamburger menu open, upgrade banner buttons.
// =============================================================================
dashRegisterAction('open-sidebar', () => openSidebar());
// Upgrade banner buttons (above the tool area). The Pro button passes undefined
// to let startCheckout fall back to default Pro pricing.
dashRegisterAction('checkout-pro', (e, el) => startCheckout(undefined, el));
dashRegisterAction('checkout-max', (e, el) => startCheckout('max', el));

// =============================================================================
// PWA LOGIN SCREEN ACTIONS
// -----------------------------------------------------------------------------
// Sign in / Sign up tab toggles, Google OAuth, forgot password, submit.
// =============================================================================
dashRegisterAction('pwa-auth-mode-signin', () => setPwaAuthMode('signin'));
dashRegisterAction('pwa-auth-mode-signup', () => setPwaAuthMode('signup'));
dashRegisterAction('pwa-google-auth', () => handlePwaGoogleAuth());
dashRegisterAction('pwa-forgot-password', () => handlePwaForgotPassword());
dashRegisterAction('pwa-auth', () => handlePwaAuth());
