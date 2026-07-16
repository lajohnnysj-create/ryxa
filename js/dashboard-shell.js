// =============================================================================
// /js/dashboard-shell.js - Dashboard shell code (extracted 2026-05-11)
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
//   • initAuth() is called at the bottom of this file. It's async - yields
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
//   showModalAlert, showModalConfirm (via deals.js - they live in deals.js
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

// Stripe price IDs for the 4 subscription options. Source of truth for prices
// is the create-checkout-session edge function; this client map exists so we
// can route the user's plan+cycle selection to the right Stripe price.
const PRICE_IDS = {
  pro: {
    monthly: 'price_1TIZ8pFQ1L0aeJrZEX1bQnUI',  // $10/mo
    annual:  'price_1TWqaNFQ1L0aeJrZvUOPWHUy'   // $100/yr
  },
  max: {
    monthly: 'price_1TWqbvFQ1L0aeJrZB9ffRvyC',  // $24/mo
    annual:  'price_1TWqctFQ1L0aeJrZJ3QdI3y5'   // $240/yr
  }
};

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
// localStorage to any code in this origin - that's an unavoidable property
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

// Shared "report this AI output" flow used by the generative tools (Bio writer,
// Script Builder, etc.). Confirms, then posts to /api/report-content; the
// reporter is derived server-side from the token. source is a short tag the
// route allow-lists (e.g. 'bio-writer', 'script-builder').
function ryxaReportAIOutput(source, contentText) {
  var text = String(contentText || '').trim();
  if (!text) return;
  showModalConfirm(
    'Report this response?',
    'This sends the AI output to the Ryxa team for review. Use it if the output is harmful, offensive, or inappropriate.',
    async function() {
      try {
        var resp = await fetch('/api/report-content', {
          method: 'POST',
          headers: getAIHeaders(),
          body: JSON.stringify({ source: source, reported_content: text.slice(0, 5000) })
        });
        if (!resp.ok) {
          var data = await resp.json().catch(function() { return {}; });
          showModalAlert('Could not report', data.error || 'Please try again.');
          return;
        }
        showModalAlert('Reported', 'Thanks. Our team will review this response.');
      } catch (e) {
        showModalAlert('Could not report', 'Please try again.');
      }
    },
    'Report',
    'Cancel'
  );
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

// HTML escape utility - used everywhere to prevent XSS when rendering user content
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Generic dashboard toast - brief notification at the bottom of the screen.
// Use for success confirmations after auto-save actions where the visual
// re-render alone isn't enough confirmation (e.g. timezone change saves to
// DB and re-renders, but the user can't tell the DB write actually landed).
//
// Types:
//   'success' (default) - green accent, auto-dismisses after 2.5s
//   'error'             - red accent, auto-dismisses after 5s (longer for
//                         readability; errors are rare and worth showing)
//
// Multiple calls in quick succession replace the previous toast rather
// than stacking - avoids the "10 toasts on top of each other" mess.
function dashShowToast(message, type) {
  type = type || 'success';
  // Legacy bottom-center toast, retired: all callers now route to the
  // slide-in toast for one consistent notification style.
  if (typeof showDashToast === 'function') {
    showDashToast(type === 'error' ? 'error' : 'success', message);
    return;
  }
  document.querySelectorAll('.dash-toast').forEach(function(t) { t.remove(); });
  var t = document.createElement('div');
  t.className = 'dash-toast dash-toast-' + type;
  // role="status" for success (polite live region), "alert" for errors
  // (assertive live region - screen readers interrupt to announce).
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  t.textContent = message;
  document.body.appendChild(t);
  var duration = type === 'error' ? 5000 : 2500;
  setTimeout(function() {
    // Fade out via class, then remove. CSS handles the transition.
    t.classList.add('dash-toast-leaving');
    setTimeout(function() { if (t.parentNode) t.remove(); }, 250);
  }, duration);
}

// Tier helpers - use these everywhere instead of raw string comparison
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
// truth for "is the user currently in a trial" - checked at render time
// because trials expire silently and we don't always get a webhook on tick.
let userTrialEnd = null;
let userBillingCycle = 'monthly';
// Has this user EVER used the Creator Max free trial? Sticky once true.
// Drives whether Max upgrade buttons say "Try free" or "Upgrade".
let userMaxTrialUsed = false;
// Tier the user had BEFORE upgrading into Max (null = never had a prior tier).
// Used to give Pro→Max-trial users an honest cancel message - cancel drops
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
  scripts: 'Script Builder',
  thumbanalyzer: 'AI Thumbnail Analyzer',
  contractanalyzer: 'AI Contract Analyzer',
  deals: 'Brand Deal CRM',
  analytics: 'Analytics',
  'bio-analytics': 'Analytics',
    clients: 'Subscribers',
    settings: 'Settings',
    design: 'Design Studio',
    aichat: 'Chatbox',
    calendar: 'Calendar',
    moretools: 'More Tools'
};

// Detect PWA / standalone mode
var isPwaMode = window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true
  || document.referrer.includes('android-app://');

// ---------------------------------------------------------------------------
// iOS PWA cold-start auth recovery
//
// When a standalone PWA is backgrounded, iOS usually TERMINATES it (not just
// suspends). Reopening is therefore a cold start: a full reload, and initAuth()
// runs again. By then the access token has typically expired, so the session
// has to be refreshed over the network. The catch: on iOS the network radio is
// often not ready in the first ~second after launch, so that refresh fetch
// fails transiently even though the refresh token in localStorage is perfectly
// valid. Giving up after one attempt bounces the user to the login screen on
// essentially every reopen.
//
// The fix below is patient and discerning: if a refresh token is persisted, we
// retry the refresh across the cold-start network window, and we only show the
// login screen when there is genuinely nothing stored or the SERVER explicitly
// rejects the token (400/401/403). Pure network/fetch failures are retried.
// ---------------------------------------------------------------------------

// ===========================================================================
// TEMP AUTH DIAGNOSTICS (remove once the iOS PWA logout cause is identified)
// Captures, on each (re)open, exactly why auto-login succeeded or failed and
// renders it on the PWA login screen so it can be read on-device (no Mac).
// Distinguishes: no stored token (storage eviction) | lock timeout (Web Locks
// hang, ~5000ms + NavigatorLockAcquireTimeoutError) | 400/401/403 rejected
// token (refresh-token rotation) | network/fetch failure.
// ===========================================================================

// WKWebView occasionally leaves position:fixed elements anchored to stale
// viewport geometry after momentum scrolls or viewport-height changes (the
// bottom nav visibly "floats" with content, then snaps back). Nudging the
// nav's transform for one frame forces the compositor to re-anchor it.
(function () {
  var _navNudgeT = null;
  function nudgeBottomNav() {
    var nav = document.getElementById('mobile-bottom-nav');
    if (!nav || getComputedStyle(nav).display === 'none') return;
    nav.style.transform = 'translateZ(0.01px)';
    requestAnimationFrame(function () { nav.style.transform = ''; });
  }
  function scheduleNudge() {
    clearTimeout(_navNudgeT);
    _navNudgeT = setTimeout(nudgeBottomNav, 160);
  }
  // On app resume/cold-restore, WKWebView repaints the page with position:fixed
  // still anchored to stale (suspended) viewport geometry, so the bottom nav
  // floats detached until something else triggers a re-anchor. Neither 'scroll'
  // nor a visualViewport 'resize' reliably fires on resume (geometry can look
  // unchanged), so the existing triggers miss this case. Re-anchor explicitly
  // when the page becomes visible again or is restored. Nudge twice - once now,
  // once a beat later - because resume geometry can settle a frame or two after
  // the visibility event.
  function nudgeOnResume() {
    nudgeBottomNav();
    setTimeout(nudgeBottomNav, 200);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleNudge);
    // Keyboard detection: when the iOS keyboard opens, the visual viewport
    // shrinks while the layout viewport (window.innerHeight) does not, so a
    // large height gap means the keyboard is up. Hide the floating chrome
    // (bottom nav + Live Preview pill) while typing, native iOS tab-bar
    // behavior, and restore on close. 150px threshold so URL-bar show/hide
    // (~60px) never false-triggers it. The hide is opacity-only CSS (class
    // on <html>) so it can never fight the nudge's inline transform.
    var _kbOpen = false;
    // Force the keyboard-open state off and restore the chrome. Used by the
    // self-heal paths below when the "keyboard closed" resize event is missed
    // (a WKWebView quirk, e.g. after Save blurs a field without a clean resize),
    // which would otherwise leave the nav + Live Preview pill hidden until the
    // user manually reopens and closes the keyboard.
    function forceKbClosed() {
      if (!_kbOpen) return;
      _kbOpen = false;
      document.documentElement.classList.remove('kb-open');
      scheduleNudge();
    }
    // True only when a real text-entry element is focused. If nothing is
    // focused (or focus is on a non-input), the keyboard cannot be open.
    function anInputIsFocused() {
      var el = document.activeElement;
      if (!el) return false;
      var tag = el.tagName;
      if (tag === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      if (tag === 'INPUT') {
        var t = (el.getAttribute('type') || 'text').toLowerCase();
        // Button-like inputs don't summon the keyboard.
        return ['button', 'submit', 'checkbox', 'radio', 'file', 'range',
                'color', 'reset', 'image'].indexOf(t) === -1;
      }
      return false;
    }
    window.visualViewport.addEventListener('resize', function () {
      var gap = window.innerHeight - window.visualViewport.height;
      var open = gap > 150;
      if (open !== _kbOpen) {
        _kbOpen = open;
        document.documentElement.classList.toggle('kb-open', open);
        // Re-anchor the nav right after the keyboard closes; its fixed
        // position is often stale at that moment (same WKWebView quirk).
        if (!open) scheduleNudge();
      }
    });
    // Self-heal #1: when focus leaves a field, the keyboard is closing. Verify
    // shortly after (focus can move between fields) that nothing is focused,
    // and if so force the closed state, covering the missed-resize case.
    document.addEventListener('focusout', function () {
      setTimeout(function () {
        if (!anInputIsFocused()) forceKbClosed();
      }, 250);
    });
    // Self-heal #2: any tap or scroll while chrome is stuck hidden but no input
    // is focused clears the stuck state immediately.
    var healOnInteract = function () {
      if (_kbOpen && !anInputIsFocused()) forceKbClosed();
    };
    document.addEventListener('touchend', healOnInteract, { passive: true });
    window.addEventListener('scroll', healOnInteract, { passive: true });
  }
  window.addEventListener('scroll', scheduleNudge, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') nudgeOnResume();
  });
  // pageshow fires on bfcache/suspend restores; persisted=true means the page
  // was resumed from cache rather than freshly loaded (the exact float case).
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) nudgeOnResume();
  });
})();

// Instant tier paint: the sidebar plan label is hidden by body.tier-loading
// until the tier resolves. For returning users, paint the cached label
// immediately (inline visibility beats the hiding rule); the fresh fetch
// corrects it in the rare case the plan changed since last visit.
(function () {
  try {
    var cached = localStorage.getItem('ryxa_tier_label');
    if (!cached) return;
    var el = document.getElementById('sidebar-tier');
    if (el) { el.textContent = cached; el.style.visibility = 'visible'; }
    var mel = document.getElementById('sidebar-menu-tier');
    if (mel) { mel.textContent = cached; mel.style.visibility = 'visible'; }
  } catch (e) {}
})();

var _authDiag = [];
var _authDiagT0 = Date.now();
function _diag(m) { try { _authDiag.push('+' + (Date.now() - _authDiagT0) + 'ms ' + m); } catch (e) {} }
function _errInfo(e) {
  if (!e) return 'none';
  var parts = [];
  if (e.name) parts.push(e.name);
  if (e.status !== undefined && e.status !== null) parts.push('status=' + e.status);
  if (e.code) parts.push('code=' + e.code);
  if (e.message) parts.push(String(e.message).slice(0, 80));
  return parts.join('/') || 'err';
}
function _diagStoredToken() {
  try {
    var found = null;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k)) { found = k; break; }
    }
    if (!found) { _diag('stored: NO key (storage empty/evicted)'); return; }
    var raw = localStorage.getItem(found);
    if (!raw) { _diag('stored: key present but empty'); return; }
    var p = JSON.parse(raw);
    var hasRt = !!(p && p.refresh_token);
    var expd = (p && p.expires_at) ? (p.expires_at * 1000 < Date.now()) : '?';
    _coldStartStored = (p && p.access_token && p.refresh_token) ? { access_token: p.access_token, refresh_token: p.refresh_token } : null;
    _diag('stored: rt=' + hasRt + ' expired=' + expd);
  } catch (e) { _diag('stored: parse-fail ' + _errInfo(e)); }
}
function _renderAuthDiag() {
  try {
    var screen = document.getElementById('pwa-login-screen');
    if (!screen) return;
    var box = document.getElementById('pwa-auth-diag');
    if (!box) {
      box = document.createElement('div');
      box.id = 'pwa-auth-diag';
      box.style.cssText = 'display:none;position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top,0px) + 8px);z-index:10002;max-width:360px;max-height:38vh;overflow:auto;margin:0 auto;font-size:10px;line-height:1.5;color:rgba(255,255,255,0.85);text-align:left;white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,0.72);border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:10px;cursor:pointer;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);';
      screen.appendChild(box);
    }
    var text = 'auth diagnostics (tap to copy)\n' + _authDiag.join('\n');
    box.textContent = text;
    box.addEventListener('click', function () {
      try { navigator.clipboard.writeText(text); box.style.borderColor = '#6ee7b7'; } catch (e) {}
    });
  } catch (e) {}
}

function togglePwaDiag() {
  _renderAuthDiag();
  var box = document.getElementById('pwa-auth-diag');
  if (box) box.style.display = (box.style.display === 'none' || !box.style.display) ? 'block' : 'none';
}

function _sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// Wait (bounded) for connectivity to come back if the device reports offline.
function _waitForOnline(maxMs) {
  return new Promise(function (resolve) {
    try { if (navigator.onLine !== false) return resolve(); } catch (e) { return resolve(); }
    var done = false;
    function finish() { if (done) return; done = true; try { window.removeEventListener('online', finish); } catch (e) {} resolve(); }
    try { window.addEventListener('online', finish); } catch (e) {}
    setTimeout(finish, maxMs);
  });
}

// Locate Supabase's persisted session key (sb-<project-ref>-auth-token) and
// report whether a refresh token is stored. A stored refresh token means the
// user intended to stay logged in, so a failed cold-start refresh is almost
// certainly a transient network race rather than a real logout.
function _hasStoredRefreshToken() {
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k)) {
        var raw = localStorage.getItem(k);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        if (parsed && parsed.refresh_token) return true;
      }
    }
  } catch (e) {}
  return false;
}

// A refresh failure is permanent (a genuine logout) only when the server
// explicitly rejects the token. Network / fetch / 5xx / offline are transient.
function _isPermanentAuthError(err) {
  if (!err) return false;
  if ((err.name || '') === 'AuthRetryableFetchError') return false;
  var status = err.status;
  return status === 400 || status === 401 || status === 403;
}

// ---- Involuntary sign-out recovery -----------------------------------------
// iOS can suspend a PWA and drop the in-memory/persisted session even though
// the refresh token is still valid; Supabase then emits SIGNED_OUT. To avoid
// bouncing the user to the login screen in that case, we cache the last good
// tokens and, on an INVOLUNTARY SIGNED_OUT, try to re-establish the session
// from them. A genuine logout (the user signing out, or a server-revoked
// token) still ends at login: setSession returns an error and we fall through.
var _lastGoodSession = null;     // { access_token, refresh_token }
var _intentionalSignOut = false; // set true right before our own signOut() calls
var _recovering = false;         // guard so a re-emitted SIGNED_OUT cannot loop
// Tokens read from storage at cold start, BEFORE getSession() runs. getSession()
// wipes the stored token if its internal refresh fails (even transiently), which
// would otherwise rob our retry path of anything to work with. Captured here so
// a transient cold-start failure can still be retried from this copy.
var _coldStartStored = null;     // { access_token, refresh_token }

function _cacheGoodSession(s) {
  if (s && s.access_token && s.refresh_token) {
    _lastGoodSession = { access_token: s.access_token, refresh_token: s.refresh_token };
  }
}

// Try to restore the session from the cached tokens. Resolves true ONLY if a
// live user session comes back. Never throws. setSession refreshes the token
// internally if the cached access token has expired, and returns an error if
// the refresh token has been revoked (a real logout), in which case we give up.
async function _attemptSignOutRecovery() {
  var cached = _lastGoodSession;
  if (!cached || !cached.access_token || !cached.refresh_token) { _diag('recovery: no cached session'); return false; }
  try { if (navigator.onLine === false) { _diag('recovery: offline, waiting'); await _waitForOnline(3000); } } catch (e) {}
  var delays = [0, 600, 1500];
  for (var i = 0; i < delays.length; i++) {
    if (delays[i]) { await _sleep(delays[i]); }
    var _t0 = Date.now();
    try {
      var res = await sb.auth.setSession({ access_token: cached.access_token, refresh_token: cached.refresh_token });
      if (res && res.data && res.data.session && res.data.session.user) {
        _diag('recovery#' + i + ' ' + (Date.now() - _t0) + 'ms OK');
        return true;
      }
      _diag('recovery#' + i + ' ' + (Date.now() - _t0) + 'ms null err=' + _errInfo(res && res.error));
      if (_isPermanentAuthError(res && res.error)) { _diag('recovery: permanent, give up'); return false; }
    } catch (e) {
      _diag('recovery#' + i + ' ' + (Date.now() - _t0) + 'ms THREW ' + _errInfo(e));
      if (_isPermanentAuthError(e)) { _diag('recovery: permanent, give up'); return false; }
    }
  }
  return false;
}

// Cold-start counterpart to _attemptSignOutRecovery: getSession() consumed and
// wiped the stored token while trying (and failing) to refresh it. If that
// failure was transient the token is still valid, so retry from the copy we
// captured before getSession ran. Returns a live session or null. A genuinely
// rejected token fails permanently here and we give up (login is correct).
async function _retryRefreshFromTokens(tokens) {
  if (!tokens || !tokens.access_token || !tokens.refresh_token) return null;
  try { if (navigator.onLine === false) { _diag('cold retry: offline, waiting'); await _waitForOnline(3000); } } catch (e) {}
  var delays = [0, 700, 1600];
  for (var i = 0; i < delays.length; i++) {
    if (delays[i]) { await _sleep(delays[i]); }
    var _t0 = Date.now();
    try {
      var res = await sb.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
      if (res && res.data && res.data.session && res.data.session.user) {
        _diag('cold retry#' + i + ' ' + (Date.now() - _t0) + 'ms OK');
        return res.data.session;
      }
      _diag('cold retry#' + i + ' ' + (Date.now() - _t0) + 'ms null err=' + _errInfo(res && res.error));
      if (_isPermanentAuthError(res && res.error)) { _diag('cold retry: permanent, give up'); return null; }
    } catch (e) {
      _diag('cold retry#' + i + ' ' + (Date.now() - _t0) + 'ms THREW ' + _errInfo(e));
      if (_isPermanentAuthError(e)) { _diag('cold retry: permanent, give up'); return null; }
    }
  }
  return null;
}

// Retry refreshSession() across the cold-start network-not-ready window.
// Returns a live session, or null if it never recovered. Bails out early only
// on a permanent auth error.
async function _retryRefreshSession() {
  var delays = [250, 600, 1200, 2500]; // patient but bounded (~4.5s of retries)
  for (var i = 0; i < delays.length; i++) {
    try { if (navigator.onLine === false) { _diag('offline; waiting'); await _waitForOnline(delays[i]); } } catch (e) {}
    var _t0 = Date.now();
    try {
      var res = await sb.auth.refreshSession();
      if (res && res.data && res.data.session && res.data.session.user) { _diag('refresh#' + i + ' ' + (Date.now() - _t0) + 'ms OK'); return res.data.session; }
      _diag('refresh#' + i + ' ' + (Date.now() - _t0) + 'ms null err=' + _errInfo(res && res.error));
      if (_isPermanentAuthError(res && res.error)) { _diag('permanent; stop'); return null; }
    } catch (e) {
      _diag('refresh#' + i + ' ' + (Date.now() - _t0) + 'ms THREW ' + _errInfo(e));
      if (_isPermanentAuthError(e)) { _diag('permanent; stop'); return null; }
    }
    await _sleep(delays[i]);
  }
  var _tf = Date.now();
  try {
    var last = await sb.auth.refreshSession();
    if (last && last.data && last.data.session && last.data.session.user) { _diag('refresh#final ' + (Date.now() - _tf) + 'ms OK'); return last.data.session; }
    _diag('refresh#final ' + (Date.now() - _tf) + 'ms null err=' + _errInfo(last && last.error));
  } catch (e) { _diag('refresh#final THREW ' + _errInfo(e)); }
  return null;
}

async function initAuth() {
  _diag('init online=' + (typeof navigator !== 'undefined' && navigator.onLine !== false));
  _diagStoredToken();
  let session = null;
  var _gT0 = Date.now();
  try {
    session = (await sb.auth.getSession())?.data?.session || null;
    _diag('getSession ' + (Date.now() - _gT0) + 'ms -> ' + (session && session.user ? 'user' : 'null'));
  } catch (e) { _diag('getSession ' + (Date.now() - _gT0) + 'ms THREW ' + _errInfo(e)); }

  // No live session yet. If credentials are persisted, ride out the cold-start
  // network race with retries before ever showing login. If nothing is stored,
  // a single refresh attempt is enough to confirm there is truly no session.
  if (!session?.user) {
    if (_hasStoredRefreshToken()) {
      session = await _retryRefreshSession();
    } else if (_coldStartStored && _coldStartStored.refresh_token) {
      // getSession() wiped the stored token while its refresh failed. Retry from
      // the copy captured before getSession ran: rescues a transient failure,
      // and surfaces the real error if the token was genuinely rejected.
      _diag('stored rt wiped by getSession; retry from captured token');
      session = await _retryRefreshFromTokens(_coldStartStored);
    } else {
      _diag('no stored rt; one refresh');
      try {
        const { data } = await sb.auth.refreshSession();
        session = data?.session || null;
        _diag('one refresh -> ' + (session && session.user ? 'user' : 'null'));
      } catch (e) { _diag('one refresh THREW ' + _errInfo(e)); }
    }
  }

  if (!session?.user) { _diag('DECISION: show login'); _authCompleted = true; showPwaLogin(); return; }
  _diag('DECISION: authed');
  Auth.setToken(session.access_token);
  _cacheGoodSession(session);
  await setUser(session.user);
  _authCompleted = true;
  try { sessionStorage.removeItem('_authRetry'); } catch(e) {}
  // Only an explicit SIGNED_OUT logs the UI out. Supabase fires SIGNED_OUT only
  // when it removes the session on a NON-retryable error; transient network
  // refresh failures keep the session and auto-retry, so they must not bounce
  // the user. INITIAL_SESSION with null is already handled by initAuth() above.
  sb.auth.onAuthStateChange((event, session) => {
    _diag('authchange: ' + event + ' -> ' + (session?.user ? 'user' : 'null'));
    if (session?.user) {
      // IDENTITY SWAP GUARD
      //
      // The Supabase session lives in localStorage, keyed per origin, and is
      // shared across tabs. Sign in as somebody else in tab B (a magic link,
      // a test account) and tab A silently starts sending that person's token.
      //
      // Nothing corrupts, because every write policy is auth.uid() = user_id,
      // so the UPDATE matches zero rows. But zero rows is not an error:
      // PostgREST returns 200, supabase-js returns { error: null }, and the
      // dashboard says "Saved" while saving nothing.
      //
      // A page whose identity changed underneath it must not keep accepting
      // edits. Reload into whoever is now signed in.
      if (currentUser && currentUser.id && session.user.id !== currentUser.id) {
        _diag('IDENTITY SWAP: ' + currentUser.id + ' -> ' + session.user.id + ', reloading');
        window.location.reload();
        return;
      }

      Auth.setToken(session.access_token);
      _cacheGoodSession(session);
      _intentionalSignOut = false; // a fresh sign-in re-arms recovery
      // If the login screen is showing when a session arrives (the app's
      // sheet login writes the session to shared storage while this page
      // sits on the login view), reload into the dashboard. Without this,
      // the user is authenticated but still staring at the login screen.
      var loginScreen = document.getElementById('pwa-login-screen');
      if (loginScreen && loginScreen.style.display === 'flex') {
        _diag('SIGNED_IN while login showing -> reloading into dashboard');
        window.location.href = '/dashboard.html';
      }
      return;
    }
    if (event === 'SIGNED_OUT') {
      // (a) User-initiated sign-out or a deleted account: honor it, no recovery.
      if (_intentionalSignOut) {
        _diag('SIGNED_OUT (intentional) -> login');
        _intentionalSignOut = false;
        _lastGoodSession = null;
        Auth.setToken('');
        showPwaLogin();
        return;
      }
      // (b) A SIGNED_OUT re-emitted while a recovery is already running (e.g.
      // setSession's own failed refresh): ignore it; the in-flight attempt owns
      // the outcome. Without this guard the failure could re-enter and loop.
      if (_recovering) { _diag('SIGNED_OUT during recovery -> ignored'); return; }
      // (c) Involuntary SIGNED_OUT (the kick-out). Try to restore the session
      // from cached tokens before showing login. Only bounce to login if that
      // fails. A revoked token makes recovery fail, so real logouts still land
      // on login and we never keep a dead session alive.
      _diag('SIGNED_OUT (involuntary) -> attempting recovery');
      _recovering = true;
      _attemptSignOutRecovery().then(function (ok) {
        _recovering = false;
        if (ok) { _diag('recovery succeeded -> staying signed in'); return; }
        _diag('recovery failed -> showing login');
        _lastGoodSession = null;
        Auth.setToken('');
        showPwaLogin();
      }).catch(function (e) {
        _recovering = false;
        _diag('recovery threw -> showing login ' + _errInfo(e));
        _lastGoodSession = null;
        Auth.setToken('');
        showPwaLogin();
      });
    }
  });
}

// =============================================================================
// PWA RESUME DIAGNOSTIC (observation only)
//
// We previously called refreshSession() here on every resume-from-suspend to
// get ahead of an expired JWT. That was counterproductive: supabase-js ALREADY
// refreshes on visibilitychange (_recoverAndRefresh) when the token is near
// expiry, single-flight and lock-coordinated. Our extra forced refresh rotated
// the refresh token on EVERY resume, widening the rotation-race window that
// yields "refresh token already used" -> SIGNED_OUT mid-session kick-outs.
//
// So we no longer refresh here. We only record the resume and how long we were
// backgrounded, so a future kick-out can be correlated with a suspend/resume.
// The supabase client owns refresh; onAuthStateChange still owns logout.
// =============================================================================
var _pwaHiddenAt = null;

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden') {
    _pwaHiddenAt = Date.now();
    return;
  }
  if (document.visibilityState !== 'visible') return;
  if (!_authCompleted) return; // initAuth still owns the first session
  if (!_pwaHiddenAt) return;   // never went hidden, nothing to record
  var hiddenFor = Date.now() - _pwaHiddenAt;
  _pwaHiddenAt = null;
  // Observation only. We no longer force a refresh on resume: supabase-js
  // already refreshes on visibilitychange (single-flight, lock-coordinated),
  // and our extra refreshSession() was rotating the refresh token every resume,
  // widening the rotation-race window behind the SIGNED_OUT kick-outs.
  _diag('resume visible after ' + Math.round(hiddenFor / 1000) + 's hidden');
});

// Rotating welcome greetings. {name} gets replaced with @username (or "creator" if no username yet).
// Tone: warm, brief, work-focused - never effusive. Mix of creator-context and neutral lines.
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
  // Surface dead social connections right at login: one combined error toast
  // naming every platform whose token has died, so a paused connection is
  // hard to miss without waiting for the user to visit Settings or Media Kit.
  // Fired on a delay so it lands after (rather than getting replaced by, or
  // replacing) any toast the login flow itself shows: showDashToast is a
  // single-slot notification, a new toast removes the current one.
  setTimeout(function() { checkSocialReconnections(user.id); }, 2500);
  // Long-lived sessions: periodic + resume re-checks (guarded to start once).
  startSocialHealthMonitor();
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
    const { data: profile } = await sb.from('profiles').select('username, display_currency, calendar_timezone').eq('user_id', user.id).maybeSingle();
    if (profile?.username) {
      window._ryx_username = profile.username;
      applyDashGreeting('@' + profile.username);
      var bioLinkText = document.getElementById('sidebar-menu-biolink-text');
      if (bioLinkText) bioLinkText.textContent = 'ryxa.io/' + profile.username;
      var dashBioText = document.getElementById('dash-welcome-biolink-text');
      if (dashBioText) dashBioText.textContent = 'ryxa.io/' + profile.username;
      var dashBioRow = document.getElementById('dash-welcome-biolink');
      if (dashBioRow) dashBioRow.style.display = 'block';
      showBioLinkButtons();
    } else {
      applyDashGreeting('creator');
    }
    // Load display currency (defaults to USD if not set)
    if (profile?.display_currency && SUPPORTED_CURRENCIES[profile.display_currency]) {
      currentCurrency = profile.display_currency;
    }
    // Stash creator's calendar timezone globally so any tool can read it
    // without its own DB call. Welcome's upcoming events list and the
    // coaching tz hint both consume this. Falls back to browser-detected
    // tz if profile row doesn't have one yet (will get backfilled by the
    // auto-detect block below).
    try {
      window._ryx_creator_tz = (profile && profile.calendar_timezone)
        ? profile.calendar_timezone
        : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      // Also keep localStorage in sync so calendar.js' fallback path works
      // even before the user opens the Calendar tool.
      try { localStorage.setItem('ryxa_cal_tz', window._ryx_creator_tz); } catch (e) {}
    } catch (e) { window._ryx_creator_tz = 'UTC'; }
    // Auto-detect calendar timezone for first-time users. We only write if
    // calendar_timezone is missing - never overwrite. This means:
    //   - New accounts: get a sensible default based on browser locale.
    //   - Existing accounts with a NULL value (created before this field):
    //     backfilled on next login.
    //   - Existing accounts with a value already: untouched, preserves
    //     manual choice and prevents travel-based silent overrides.
    // Fire-and-forget; the calendar tool will use whatever's there when
    // the creator opens it.
    if (!profile?.calendar_timezone) {
      try {
        var detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (detectedTz) {
          // profiles.username is NOT NULL, so a profiles row cannot be
          // created without a username. A first-run user has no row yet
          // (their row is created when they complete the terms modal).
          // So we can only UPDATE an existing row here, never insert one -
          // an upsert that tried to insert would fail the NOT NULL
          // constraint. If there is no row yet, we skip; the timezone gets
          // saved on a later load once onboarding created the row.
          sb.from('profiles')
            .update({ calendar_timezone: detectedTz })
            .eq('user_id', user.id)
            .then(function(res) {
              if (res.error) console.error('Auto-detect timezone save failed:', res.error);
            });
        }
      } catch (e) { console.error('Timezone auto-detect failed:', e); }
    }
  } catch (e) { /* keep default */ }

  // Apply currency symbol to all prefix elements throughout the dashboard
  applyCurrencySymbols();

  // Post-signup checkout: if user arrived with a plan intent from pricing page.
  // Two sources, in priority order:
  //   1. URL params (?plan=max&cycle=annual) - set by index-page.js as the
  //      signup emailRedirectTo. These survive a device switch because they
  //      travel inside the email confirmation link itself.
  //   2. localStorage fts_intended_plan - the same-device path. Still works
  //      when the user confirms email in the same browser they signed up in.
  try {
    let intentObj = null;

    // Source 1: URL params
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlPlan = urlParams.get('plan');
      const urlCycle = urlParams.get('cycle');
      if (urlPlan === 'max' || urlPlan === 'pro') {
        intentObj = {
          plan: urlPlan,
          cycle: urlCycle === 'annual' ? 'annual' : 'monthly'
        };
        // Strip the plan params from the URL so a refresh doesn't re-trigger
        // checkout - but PRESERVE ?username= if present, because the terms
        // modal (checkTermsAcceptance) still needs to read it. Without this,
        // a user who signed up with both a plan and a hero-claimed username
        // would lose the username pre-fill.
        try {
          var keptUsername = urlParams.get('username');
          var cleanSearch = keptUsername
            ? '?username=' + encodeURIComponent(keptUsername)
            : '';
          const cleanUrl = window.location.pathname + cleanSearch + window.location.hash;
          window.history.replaceState({}, document.title, cleanUrl);
        } catch (_) {}
      }
    } catch (_) {}

    // Source 2: localStorage (fallback, same-device path)
    const intentRaw = localStorage.getItem('fts_intended_plan');
    if (intentRaw) {
      // ALWAYS clear the intent - we don't want it to persist across sessions
      localStorage.removeItem('fts_intended_plan');
      // Only use localStorage if URL params didn't already give us an intent.
      if (!intentObj) {
        // Parse the intent. New shape is JSON {plan, cycle}; legacy shape is a
        // bare string ('max' / 'monthly').
        try {
          const parsed = JSON.parse(intentRaw);
          if (parsed && parsed.plan) {
            intentObj = {
              plan: parsed.plan === 'max' ? 'max' : 'pro',
              cycle: parsed.cycle === 'annual' ? 'annual' : 'monthly'
            };
          }
        } catch (_) {
          // Legacy bare-string shape
          if (intentRaw === 'max') intentObj = { plan: 'max', cycle: 'monthly' };
          else if (intentRaw === 'monthly' || intentRaw === 'pro') intentObj = { plan: 'pro', cycle: 'monthly' };
        }
      }
    }

    if (intentObj) {
      // Only auto-fire checkout if user is on Free tier AND has no active
      // subscription. Prevents accidental upgrades for Pro/Max users who
      // happened to arrive with a stale intent.
      const hasActiveSub = userStatus === 'active' || userStatus === 'cancelling';
      if (userTier === 'free' && !hasActiveSub) {
        // Do NOT fire checkout here directly. A brand-new user also has the
        // first-run terms modal about to appear, and the Terms of Service
        // must be accepted BEFORE the user is sent to pay. So we stash the
        // intent as a one-shot token; it is consumed (and the redirect
        // fired) by maybeRunPendingCheckout() - called either right after
        // terms are accepted, or immediately if terms were already accepted.
        window._ryx_pendingCheckoutIntent = intentObj;
      }
    }
  } catch (e) { console.warn('intent check', e); }

  // Load home stats + Stripe status, then reveal. Awaiting these before hiding
  // the spinner keeps content (the stats and the Stripe nudge) from popping in
  // after the spinner disappears. Capped so a slow or failed request can't stall
  // the reveal, and allSettled means one failure won't block the other.
  try {
    await Promise.race([
      Promise.allSettled([ loadDashStats(), loadStripeConnectStatus() ]),
      new Promise(function(resolve){ setTimeout(resolve, 4000); })
    ]);
  } catch (e) { console.warn('dash reveal wait', e); }

  // Hide loading spinner, show welcome content
  var dashLoader = document.getElementById('dash-loading');
  if (dashLoader) dashLoader.style.display = 'none';
  var welcomeContent = document.getElementById('welcome-content');
  if (welcomeContent) { welcomeContent.style.display = ''; welcomeContent.classList.add('dash-fade-in'); }

  // Cross-file calls below are typeof-guarded: if a sibling script file
  // failed to load (network blip, extension), init degrades gracefully for
  // that session instead of aborting here. (client_errors showed exactly
  // this: "handleStripeConnectRedirect is not defined" when settings.js
  // didn't execute.)

  // Handle Stripe Connect callback redirect
  if (typeof handleStripeConnectRedirect === 'function') handleStripeConnectRedirect();

  // Resume account deletion after a Google re-authentication redirect
  if (typeof handleDeleteAccountReturn === 'function') handleDeleteAccountReturn();

  // Handle Google Calendar OAuth callback - auto-navigate to Calendar tool
  if (typeof handleGcalRedirect === 'function') handleGcalRedirect();

  // Check if user has accepted terms
  if (typeof checkTermsAcceptance === 'function') checkTermsAcceptance();
}

function handleGcalRedirect() {
  var params = new URLSearchParams(window.location.search);
  if (!params.get('gcal')) return;
  // The Google Calendar connection UI lives in Settings > Calendar. The
  // Settings init calls gcalHandleReturnParams(), which reads the params and
  // surfaces the success/error message, and gcalLoadConnectionState(), which
  // renders the connected/disconnected row.
  showTool('settings');
}

// Username claim in the first-run terms modal. A username may have been
// chosen on the homepage hero - it arrives as ?username= on the URL (works
// across device / email confirmation / OAuth) or in localStorage (same
// device). We pre-fill it, run the same availability check the dashboard
// already uses elsewhere, and the actual save happens in acceptTerms().
var termsUsernameCheckTimer = null;
var termsUsernameCheckToken = 0;
var termsUsernameState = 'empty';  // 'empty'|'invalid'|'checking'|'available'|'taken'|'error'

function termsCleanUsername(raw) {
  return (raw || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
}

function termsSetUsernameHint(text, kind) {
  var hint = document.getElementById('terms-username-hint');
  var field = document.getElementById('terms-username-field');
  if (hint) {
    hint.textContent = text || '';
    hint.style.color = kind === 'ok' ? '#4ade80'
      : kind === 'bad' ? '#fca5a5'
      : 'var(--muted)';
  }
  if (field) {
    field.style.borderColor = kind === 'ok' ? '#4ade80'
      : kind === 'bad' ? '#f87171'
      : 'rgba(255,255,255,0.14)';
  }
}

// Enable the Continue button only when terms are checked AND the username
// is in a passable state. Username is mandatory (profiles.username is NOT
// NULL), so 'empty'/'invalid'/'taken'/'checking' all block; only
// 'available' (or 'error', which acceptTerms re-validates) lets it through.
function termsSyncContinueButton() {
  var check = document.getElementById('terms-accept-check');
  var btn = document.getElementById('terms-accept-btn');
  if (!check || !btn) return;
  var usernameBlocks = (termsUsernameState === 'checking'
    || termsUsernameState === 'invalid'
    || termsUsernameState === 'empty'
    || termsUsernameState === 'taken');
  var ok = check.checked && !usernameBlocks;
  btn.disabled = !ok;
  btn.style.opacity = ok ? '1' : '0.5';
  btn.style.pointerEvents = ok ? 'auto' : 'none';
}

function termsOnUsernameInput() {
  var input = document.getElementById('terms-username');
  if (!input) return;
  var cleaned = termsCleanUsername(input.value);
  if (cleaned !== input.value) input.value = cleaned;

  clearTimeout(termsUsernameCheckTimer);
  termsUsernameCheckToken++;

  if (!cleaned) {
    // Username is mandatory: profiles.username is NOT NULL, so the row
    // cannot be created (and terms cannot be saved) without one.
    termsUsernameState = 'invalid';
    termsSetUsernameHint('Choose a username to continue.', null);
    termsSyncContinueButton();
    return;
  }
  if (cleaned.length < 3) {
    termsUsernameState = 'invalid';
    termsSetUsernameHint('Too short, minimum 3 characters.', 'bad');
    termsSyncContinueButton();
    return;
  }
  if (typeof BIO_RESERVED !== 'undefined' && BIO_RESERVED.has(cleaned)) {
    termsUsernameState = 'invalid';
    termsSetUsernameHint('That username is reserved. Pick another.', 'bad');
    termsSyncContinueButton();
    return;
  }
  if (window.RyxaUsernameFilter && !window.RyxaUsernameFilter.isUsernameClean(cleaned)) {
    termsUsernameState = 'invalid';
    termsSetUsernameHint('That username is not allowed. Pick another.', 'bad');
    termsSyncContinueButton();
    return;
  }
  termsUsernameState = 'checking';
  termsSetUsernameHint('Checking availability...', null);
  termsSyncContinueButton();
  var myToken = termsUsernameCheckToken;
  termsUsernameCheckTimer = setTimeout(function() {
    termsCheckUsernameAvailability(cleaned, myToken);
  }, 500);
}

async function termsCheckUsernameAvailability(username, token) {
  try {
    var res = await sb.from('public_profiles').select('user_id').eq('username', username).maybeSingle();
    if (token !== termsUsernameCheckToken) return;
    if (res.error) {
      termsUsernameState = 'error';
      termsSetUsernameHint('Could not check right now. We will verify when you continue.', null);
      termsSyncContinueButton();
      return;
    }
    if (!res.data || res.data.user_id === currentUser?.id) {
      termsUsernameState = 'available';
      termsSetUsernameHint('ryxa.io/' + username + ' is available.', 'ok');
    } else {
      termsUsernameState = 'taken';
      termsSetUsernameHint('That username is taken, try another.', 'bad');
    }
    termsSyncContinueButton();
  } catch (e) {
    if (token !== termsUsernameCheckToken) return;
    termsUsernameState = 'error';
    termsSetUsernameHint('Could not check right now. We will verify when you continue.', null);
    termsSyncContinueButton();
  }
}

// Consume the deferred post-signup checkout intent, if any, and start
// checkout. The intent is a ONE-SHOT token: it is cleared here BEFORE the
// redirect fires, so abandoning Stripe checkout leaves nothing behind to
// re-trigger on the next login (no infinite redirect loop). If the user
// bails, they simply remain a free user and can choose a plan again
// deliberately from the pricing page.
//
// Called from two places:
//   - checkTermsAcceptance(): if the user had ALREADY accepted terms (a
//     returning user), fire immediately - there is no terms gate for them.
//   - acceptTerms(): right after a brand-new user accepts terms, so the
//     Terms of Service are always accepted BEFORE the user is sent to pay.
function maybeRunPendingCheckout() {
  var intent = window._ryx_pendingCheckoutIntent;
  if (!intent) return;
  // Consume the token NOW, before redirecting. This is the line that
  // prevents the infinite loop.
  window._ryx_pendingCheckoutIntent = null;
  // Mark a redirect as in flight. There is a 400ms gap before startCheckout
  // navigates away; maybeShowOnboarding() checks this flag so the onboarding
  // modal never flashes for a split second before the user is sent to Stripe.
  window._ryx_checkoutRedirecting = true;
  setTimeout(function() { startCheckout(intent); }, 400);
}

// =============================================================================
// ONBOARDING MODAL (first-run only)
// Fires the "What would you like to do first?" modal for brand-new users.
// Shows ONLY when: onboarding not yet completed, no post-signup checkout is
// pending, and no Stripe redirect is in flight. The persistent flag
// profiles.onboarding_completed (not a timing trick) guarantees once-only.
// =============================================================================
function maybeShowOnboarding(onboardingDone) {
  // Already completed -> never show again.
  if (onboardingDone) return;
  // A paid signup is mid-checkout: do not show. The modal will get its turn
  // on the post-Stripe dashboard load, when no checkout is pending.
  if (window._ryx_pendingCheckoutIntent) return;
  if (window._ryx_checkoutRedirecting) return;
  var modal = document.getElementById('onboarding-modal');
  if (modal) {
    // Personalize the greeting with the username, if we have one.
    var greetEl = document.getElementById('onboarding-greeting');
    if (greetEl) {
      var uname = window._ryx_username || '';
      greetEl.textContent = uname ? (', ' + uname) : '';
    }
    modal.style.display = 'flex';
  }
}

// Handles a choice from the onboarding modal. Marks onboarding complete so it
// never shows again, closes the modal, then deep-links to the chosen tool.
// An empty tool value ("Explore all the tools") just closes the modal.
async function onboardingChoose(tool) {
  var modal = document.getElementById('onboarding-modal');
  if (modal) modal.style.display = 'none';

  // Persist completion. The Supabase query only sends its HTTP request when
  // awaited - a bare un-awaited builder never executes. Await it and check
  // the result so a real failure is visible instead of silent.
  if (currentUser) {
    try {
      var { error } = await sb.from('profiles')
        .update({ onboarding_completed: true })
        .eq('user_id', currentUser.id);
      if (error) console.error('onboarding flag write failed:', error);
    } catch (e) {
      console.error('onboarding flag write threw:', e);
    }
  }

  // Deep-link to the chosen tool. Empty -> stay on the dashboard home.
  // 'follower' needs showFollowerTool() (extra setup); others use showTool().
  if (tool === 'follower') {
    if (typeof showFollowerTool === 'function') showFollowerTool();
  } else if (tool === 'settings-stripe') {
    // Settings is a long page. Opening it and leaving the buyer at the top
    // means the thing they just asked for is below the fold.
    if (typeof showTool === 'function') showTool('settings');
    setTimeout(function () {
      var el = document.getElementById('settings-stripe-section');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);
  } else if (tool && typeof showTool === 'function') {
    showTool(tool);
  }
}

async function checkTermsAcceptance() {
  if (!currentUser) return;
  try {
    // maybeSingle (not single): a first-run user has NO profiles row yet -
    // the row is created by acceptTerms below. single() would 406 on zero
    // rows; maybeSingle returns null cleanly.
    var { data } = await sb.from('profiles').select('accepted_terms, marketing_emails, username, onboarding_completed').eq('user_id', currentUser.id).maybeSingle();
    if (data && data.accepted_terms) {
      // Load marketing preference into settings
      var toggle = document.getElementById('settings-marketing-emails');
      if (toggle) toggle.checked = !!data.marketing_emails;
      // Terms already accepted (returning user, no terms gate for them) -
      // if a post-signup checkout intent is pending, fire it now.
      maybeRunPendingCheckout();
      // First-run onboarding modal. maybeShowOnboarding bails on its own if a
      // checkout is pending / a redirect is in flight, so a paid user mid-
      // checkout will not see it here - it shows on the post-Stripe load.
      maybeShowOnboarding(data.onboarding_completed);
      return;
    }
    // Show terms modal with existing marketing preference
    var modal = document.getElementById('terms-modal');
    if (modal) modal.style.display = 'flex';
    var marketingCheck = document.getElementById('terms-marketing-check');
    if (marketingCheck) marketingCheck.checked = !!data?.marketing_emails;

    // Pre-fill the username field. Priority: a username already on the
    // profile (rare at first-run, but respect it) > ?username= URL param >
    // localStorage. The URL param and localStorage carry the hero-claimed
    // username across signup / email confirmation / OAuth.
    var input = document.getElementById('terms-username');
    if (input) {
      var prefill = '';
      if (data && data.username) {
        prefill = data.username;
      } else {
        try {
          var fromUrl = new URLSearchParams(window.location.search).get('username');
          var fromStore = localStorage.getItem('ryx_intended_username');
          prefill = fromUrl || fromStore || '';
        } catch (e) { /* storage/URL unavailable */ }
      }
      input.value = termsCleanUsername(prefill);
      // The input starts readonly to block browser / password-manager
      // autofill (Chrome ignores autocomplete=off but will not autofill a
      // readonly field). Remove readonly on focus so the user can edit it.
      input.addEventListener('focus', function() {
        input.removeAttribute('readonly');
      });
      input.addEventListener('input', termsOnUsernameInput);
      // Run an initial check so a pre-filled username shows its state.
      termsOnUsernameInput();
    }

    var check = document.getElementById('terms-accept-check');
    var btn = document.getElementById('terms-accept-btn');
    if (check && btn) {
      check.addEventListener('change', termsSyncContinueButton);
    }
    termsSyncContinueButton();
  } catch (e) { console.error('Terms check error:', e); }
}


// Escape hatch for the first-run terms modal. The modal is a hard gate -
// a user who does not want to accept (or wants to switch accounts) would
// otherwise be stuck seeing it on every visit. This signs them out and
// sends them back to the homepage, cleanly ending the session.
async function termsLogout() {
  var btn = document.getElementById('terms-logout-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Logging out...'; }
  try {
    _intentionalSignOut = true;
    // scope 'local': sign out this device only. The default 'global' scope
    // revokes every session on every device, which is why signing out in
    // the app was killing web sessions (and vice versa).
    await sb.auth.signOut({ scope: 'local' });
  } catch (e) {
    console.error('Terms-modal logout error:', e);
  }
  // Full navigation back to the dashboard so it reloads signed-out: this lands
  // on the login screen with fresh state (no stuck modal / stale in-memory data).
  window.location.href = '/dashboard.html';
}

async function acceptTerms() {  var check = document.getElementById('terms-accept-check');
  if (!check || !check.checked) return;
  var btn = document.getElementById('terms-accept-btn');
  var errEl = document.getElementById('terms-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    var marketingCheck = document.getElementById('terms-marketing-check');
    var input = document.getElementById('terms-username');
    var uname = input ? termsCleanUsername(input.value) : '';

    // Username is MANDATORY here. profiles.username is NOT NULL, so the
    // profiles row literally cannot be created without one - and a
    // first-run user has no row yet, so we must create it. Validate hard.
    if (!uname) {
      throw new Error('Please choose a username to continue.');
    }
    if (uname.length < 3) {
      throw new Error('Username is too short. Use at least 3 characters.');
    }
    if (typeof BIO_RESERVED !== 'undefined' && BIO_RESERVED.has(uname)) {
      throw new Error('That username is reserved. Please pick another.');
    }
    if (window.RyxaUsernameFilter && !window.RyxaUsernameFilter.isUsernameClean(uname)) {
      throw new Error('That username is not allowed. Please pick another.');
    }
    // Re-check availability now - the homepage/pre-fill check may be stale.
    var avail = await sb.from('public_profiles').select('user_id').eq('username', uname).maybeSingle();
    if (avail.error) {
      throw new Error('Could not verify that username right now. Please try again.');
    }
    if (avail.data && avail.data.user_id !== currentUser.id) {
      throw new Error('That username was just taken. Please choose another.');
    }

    // upsert (NOT update): a first-run user has no profiles row, so update()
    // would silently match zero rows and save nothing. upsert creates the
    // row if missing, updates it if present. user_id is the conflict key.
    var { error } = await sb.from('profiles').upsert({
      user_id: currentUser.id,
      username: uname,
      accepted_terms: true,
      marketing_emails: marketingCheck ? marketingCheck.checked : false
    }, { onConflict: 'user_id' });
    if (error) throw error;

    // Clear the carried-forward username now that it is saved.
    try { localStorage.removeItem('ryx_intended_username'); } catch (e) {}

    // Keep in-memory username + topbar link in sync.
    window._ryx_username = uname;
    var bioLinkEl = document.getElementById('topbar-bio-link');
    if (bioLinkEl) bioLinkEl.textContent = 'ryxa.io/' + uname;
    var bioLinkMobile = document.getElementById('ana-bio-link');
    if (bioLinkMobile) bioLinkMobile.textContent = 'ryxa.io/' + uname;

    // A brand-new user's setUser() ran before this username existed, so the
    // welcome greeting + bio-link row never populated. Mirror setUser()'s
    // username branch here so the dashboard updates immediately on accept,
    // without needing a page refresh.
    applyDashGreeting('@' + uname);
    var sidebarBioText = document.getElementById('sidebar-menu-biolink-text');
    if (sidebarBioText) sidebarBioText.textContent = 'ryxa.io/' + uname;
    var dashBioText = document.getElementById('dash-welcome-biolink-text');
    if (dashBioText) dashBioText.textContent = 'ryxa.io/' + uname;
    var dashBioRow = document.getElementById('dash-welcome-biolink');
    if (dashBioRow) dashBioRow.style.display = 'block';
    showBioLinkButtons();

    var modal = document.getElementById('terms-modal');
    if (modal) modal.style.display = 'none';

    // Terms are now accepted. If the user came from the pricing page with a
    // plan intent, NOW is the correct moment to send them to checkout -
    // after the Terms of Service have been accepted, never before.
    maybeRunPendingCheckout();
    // First-run onboarding modal. A brand-new user's profiles row was just
    // created with onboarding_completed = false (column default), so pass
    // false. If a paid checkout is now pending, maybeShowOnboarding bails and
    // the modal shows instead on the post-Stripe dashboard load.
    maybeShowOnboarding(false);
  } catch (e) {
    console.error('Accept terms error:', e);
    if (errEl) {
      errEl.textContent = e.message || 'Something went wrong. Please try again.';
      errEl.style.display = 'block';
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Continue'; }
    return;
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

// Silhouette placeholder for the dashboard welcome avatar when no bio photo is set.
var DASH_AVATAR_PLACEHOLDER = '<svg width="56" height="56" viewBox="0 0 24 24" fill="var(--muted)" aria-hidden="true"><path d="M12 12.2a4.6 4.6 0 1 0 0-9.2 4.6 4.6 0 0 0 0 9.2z"/><path d="M12 13.8c-4.8 0-8.4 2.5-8.4 5.8V21h16.8v-1.4c0-3.3-3.6-5.8-8.4-5.8z"/></svg>';

function updateDashboardAvatar(url) {
  dashboardAvatarUrl = url || '';
  const sidebarAvatar = document.getElementById('sidebar-avatar');
  const settingsAvatar = document.getElementById('settings-avatar');
  const menuAvatar = document.getElementById('sidebar-menu-avatar');
  const welcomeAvatar = document.getElementById('dash-welcome-avatar');
  if (url) {
    const imgHtml = '<img src="' + escapeHtml(url) + '" alt="Profile photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
    if (sidebarAvatar) { sidebarAvatar.innerHTML = imgHtml; sidebarAvatar.style.overflow = 'hidden'; }
    if (settingsAvatar) { settingsAvatar.innerHTML = imgHtml; settingsAvatar.style.overflow = 'hidden'; }
    if (menuAvatar) { menuAvatar.innerHTML = imgHtml; }
    if (welcomeAvatar) { welcomeAvatar.innerHTML = imgHtml; }
  } else {
    const initial = currentUser ? currentUser.email[0].toUpperCase() : '?';
    if (sidebarAvatar) { sidebarAvatar.textContent = initial; sidebarAvatar.style.overflow = ''; }
    if (settingsAvatar) { settingsAvatar.textContent = initial; settingsAvatar.style.overflow = ''; }
    if (menuAvatar) { menuAvatar.textContent = initial; }
    if (welcomeAvatar) { welcomeAvatar.innerHTML = DASH_AVATAR_PLACEHOLDER; }
  }
}


function copyWelcomeBioLink() {
  var textEl = document.getElementById('dash-welcome-biolink-text');
  if (!textEl) return;
  var linkText = textEl.textContent;
  if (!linkText || linkText === 'ryxa.io/...') return;
  var fullUrl = 'https://' + linkText;
  function showCopied() {
    var orig = linkText;
    textEl.textContent = 'Copied!';
    textEl.style.color = '#4ade80';
    setTimeout(function() { textEl.textContent = orig; textEl.style.color = ''; }, 1500);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullUrl).then(showCopied).catch(function() { fallbackCopy(fullUrl); showCopied(); });
  } else {
    fallbackCopy(fullUrl);
    showCopied();
  }
}



// =============================================================================
// RyxaLoadBar: ONE global trickle progress bar for every tool/data loader
// (courses, booking, products, link in bio, media kit; lists and editors).
//
// Design decisions (agreed 2026-07-10):
//   - GLOBAL and edge-anchored: a single 3px bar fixed at the very top of the
//     content pane (directly under the topbar), Figma/GitHub style. Progress
//     bars read as intentional at an edge and misplaced floating mid-content.
//   - The bar is THEATRICAL: loads are 1-3 queries with no real progress, so
//     it sprints to ~30%, trickles toward 84%, and snaps to 100% when done.
//   - Always completes: even an 80ms load gets a smooth sweep to 100% over a
//     minimum of ~400ms total, so fast loads read as one motion, no flash.
//   - Text only when something is wrong: no "Loading..." in the happy path.
//     A status pill ("Having trouble... Retrying...") appears under the bar
//     only once a retry is underway. Failure panels/toasts stay local to the
//     surface that failed; the bar is only the ambient signal.
//   - REFCOUNTED: concurrent loads share the bar. It runs while any load is
//     active and completes when the last one finishes. The per-surface API
//     (start/retrying/finish/fail/stop/isActive, keyed by an anchor element)
//     is unchanged, so the five tool files need no knowledge of this.
// =============================================================================
// Cancellation generation for surface data loaders. Every loader captures
// the generation when it starts; any navigation (tool switch, editor back)
// or newer load bumps it, and in-flight loops abort silently when their
// generation is stale: no bar, no panel, no toast, no state writes against
// a view the user already left.
window.RyxaLoadGen = {
  n: 0,
  bump: function() {
    this.n++;
    // Kill the bar in the same frame. Loader starts remount right after;
    // navigations must not leave a bar trickling over the new view.
    if (window.RyxaLoadBar && typeof window.RyxaLoadBar.cancelAll === 'function') {
      window.RyxaLoadBar.cancelAll();
    }
    return this.n;
  }
};

window.RyxaLoadBar = (function() {
  const TRICKLE_MS = 180;
  const MIN_VISIBLE_MS = 400;
  const FALLBACK_TOKEN = {};

  let ui = null;          // { wrap, bar, text }
  let tokens = new Set(); // anchors with an active load
  let t0 = 0;
  let trickleTimer = null;
  let cleanupTimer = null;
  let ending = false;

  function tok(anchor) { return anchor || FALLBACK_TOKEN; }

  function positionWrap(wrap) {
    // Track the real topbar rect so the bar spans the content pane and sits
    // right under the header (safe-area aware inside the app). Fallback:
    // full-width at the very top of the viewport.
    const bar = document.querySelector('.topbar');
    if (bar) {
      const r = bar.getBoundingClientRect();
      wrap.style.top = r.bottom + 'px';
      wrap.style.left = r.left + 'px';
      wrap.style.width = r.width + 'px';
    } else {
      wrap.style.top = 'env(safe-area-inset-top, 0px)';
      wrap.style.left = '0';
      wrap.style.width = '100vw';
    }
  }

  let repositionHandler = null;
  let topbarObserver = null;

  function mount() {
    destroy();
    const wrap = document.createElement('div');
    wrap.setAttribute('data-ryxa-loadbar', '1');
    wrap.style.cssText = 'position:fixed;z-index:10005;pointer-events:none;';
    positionWrap(wrap);
    // Track the topbar LIVE, not just at mount: window resizes (including
    // devtools opening) and topbar rect changes (sidebar collapse, layout
    // shifts) must reposition the bar immediately or it slides relative to
    // the header it is supposed to hug. Listeners live only while the bar
    // is mounted; destroy() removes them.
    repositionHandler = function() { positionWrap(wrap); };
    window.addEventListener('resize', repositionHandler);
    const topbarEl = document.querySelector('.topbar');
    if (topbarEl && typeof ResizeObserver !== 'undefined') {
      topbarObserver = new ResizeObserver(repositionHandler);
      topbarObserver.observe(topbarEl);
    }
    const bar = document.createElement('div');
    bar.style.cssText = 'width:4%;height:3px;border-radius:0 99px 99px 0;background:#7c3aed;transition:width 0.25s ease;box-shadow:0 0 8px rgba(124,58,237,0.6);';
    const text = document.createElement('div');
    text.setAttribute('role', 'status');
    // Gold/amber: this pill only ever shows "having trouble... retrying"
    // states, so it should read as a warning, not muted status chatter.
    text.style.cssText = 'display:none;margin:8px 0 0 12px;padding:6px 12px;width:fit-content;'
      + 'color:#fbbf24;font-size:13px;font-weight:500;font-family:\'DM Sans\',sans-serif;'
      + 'background:rgba(16,16,26,0.92);border:1px solid rgba(251,191,36,0.35);border-radius:8px;';
    wrap.appendChild(bar);
    wrap.appendChild(text);
    document.body.appendChild(wrap);
    ui = { wrap: wrap, bar: bar, text: text };
  }

  function destroy() {
    clearInterval(trickleTimer);
    clearTimeout(cleanupTimer);
    trickleTimer = null;
    cleanupTimer = null;
    ending = false;
    if (repositionHandler) {
      window.removeEventListener('resize', repositionHandler);
      repositionHandler = null;
    }
    if (topbarObserver) {
      topbarObserver.disconnect();
      topbarObserver = null;
    }
    if (ui && ui.wrap.parentNode) ui.wrap.remove();
    ui = null;
  }

  function beginTrickle() {
    requestAnimationFrame(function() { if (ui) ui.bar.style.width = '30%'; });
    let w = 30;
    trickleTimer = setInterval(function() {
      if (!ui) return;
      w = Math.min(84, w + (84 - w) * 0.12);
      ui.bar.style.width = w + '%';
    }, TRICKLE_MS);
  }

  function start(anchor) {
    const t = tok(anchor);
    if (tokens.has(t) && ui && !ending) return; // this surface already loading
    tokens.add(t);
    if (!ui || ending) {
      // First active load (or a new load arriving mid-completion): fresh bar.
      tokens = new Set([t]);
      mount();
      t0 = Date.now();
      beginTrickle();
    }
  }

  function isActive(anchor) {
    return !!(ui && !ending && tokens.has(tok(anchor)));
  }

  function retrying(anchor, msg) {
    if (!isActive(anchor)) return;
    ui.text.style.display = 'block';
    ui.text.textContent = msg;
  }

  function release(anchor) {
    tokens.delete(tok(anchor));
    return tokens.size === 0;
  }

  function finish(anchor) {
    if (!ui || ending || !tokens.has(tok(anchor))) { tokens.delete(tok(anchor)); return; }
    if (!release(anchor)) return; // other loads still running; keep trickling
    ending = true;
    clearInterval(trickleTimer);
    ui.text.style.display = 'none';
    const remaining = Math.max(150, MIN_VISIBLE_MS - (Date.now() - t0));
    ui.bar.style.transition = 'width ' + remaining + 'ms ease';
    ui.bar.style.width = '100%';
    cleanupTimer = setTimeout(function() {
      if (!ui) return;
      ui.wrap.style.transition = 'opacity 0.2s ease';
      ui.wrap.style.opacity = '0';
      cleanupTimer = setTimeout(destroy, 220);
    }, remaining + 40);
  }

  function fail(anchor) {
    if (!ui || ending || !tokens.has(tok(anchor))) { tokens.delete(tok(anchor)); return; }
    if (!release(anchor)) return; // another surface is still loading; its bar continues
    ending = true;
    clearInterval(trickleTimer);
    ui.text.style.display = 'none';
    ui.bar.style.background = '#ef4444';
    ui.bar.style.boxShadow = '0 0 8px rgba(239,68,68,0.6)';
    ui.bar.style.width = '100%';
    cleanupTimer = setTimeout(destroy, 700);
  }

  function stop(anchor) {
    if (release(anchor) && ui) destroy();
  }

  // Instant teardown: kills the bar and forgets every active load. Called
  // by RyxaLoadGen.bump() so any navigation removes the bar in the same
  // frame, rather than waiting for the orphaned loop to hit its next stale
  // checkpoint (which can be seconds away mid-backoff or mid-request).
  function cancelAll() {
    tokens = new Set();
    destroy();
  }

  return { start: start, retrying: retrying, finish: finish, fail: fail, stop: stop, isActive: isActive, cancelAll: cancelAll };
})();

// Check all five social connection tables for needs_reconnect flags and, if
// any are set, show ONE combined error toast listing the affected platforms.
// A single combined toast (rather than one per platform) is deliberate:
// showDashToast keeps only one toast on screen at a time, so sequential
// per-platform toasts would replace each other and only the last would be seen.
// Check all five social connection tables and classify each into one of three
// states: RED (needs_reconnect flag set by a genuine provider revocation),
// YELLOW (no successful data refresh in STALE_DAYS despite the cron running -
// the connection may be silently failing without an explicit revocation), or
// green (fine). Red is definitive; yellow is a soft "maybe reconnect" for the
// in-between case the helpers can't hard-confirm. Per account, red beats yellow.
//
// Toast priority (single-slot toast system): if ANY red exists, show only the
// red toast (urgent first); the yellow ones surface on the next check once red
// is cleared (checkSocialReconnections re-runs after a successful reconnect).
// Settings shows the full per-account picture via badges regardless.
const SOCIAL_STALE_DAYS = 14;
// Episode-scoped alert suppression. Once a platform+severity has been included
// in a shown toast, it is not toasted again for the same continuous episode,
// whether the user dismissed the toast or it is still on screen. Marks clear
// only on CONFIRMED recovery (a check that reads the platform as green), so a
// genuinely new degradation later in the same session surfaces again. Marks
// are per-severity so a dismissed yellow can never hide a later red escalation
// for the same platform. Keys look like 'Twitch:yellow'.
var _socialAlertShown = {};
var _lastSocialCheckAt = 0;
async function checkSocialReconnections(userId) {
  _lastSocialCheckAt = Date.now();
  const tables = [
    ['instagram_connections', 'Instagram', 'data_last_fetched_at'],
    ['youtube_connections', 'YouTube', 'data_last_fetched_at'],
    ['tiktok_connections', 'TikTok', 'data_last_fetched_at'],
    ['twitch_connections', 'Twitch', 'data_last_fetched_at'],
    ['facebook_connections', 'Facebook', 'last_refreshed_at'],
  ];
  const staleCutoff = Date.now() - SOCIAL_STALE_DAYS * 24 * 60 * 60 * 1000;
  try {
    const results = await Promise.all(tables.map(function(t) {
      const tsCol = t[2];
      // maybeSingle returns the row if the account is connected at all. We read
      // both the flag and the last-success timestamp to classify the state.
      return sb.from(t[0]).select('needs_reconnect,' + tsCol).eq('user_id', userId).maybeSingle()
        .then(function(res) {
          // A query-level error (res.error) must never classify as a problem
          // AND must never look like a recovery: 'unknown' neither toasts nor
          // clears suppression marks. Otherwise a transient read failure would
          // either false-alarm or reset marks and re-nag on the next tick.
          if (!res || res.error) return { name: t[1], state: 'unknown' };
          const row = res.data;
          if (!row) return { name: t[1], state: 'green' }; // not connected = nothing to warn about
          if (row.needs_reconnect) return { name: t[1], state: 'red' };
          // Stale = connected, not flagged, but no successful refresh in the
          // window. A never-fetched row (null) that's freshly connected isn't
          // stale yet; only treat as stale if the timestamp exists and is old.
          const ts = row[tsCol];
          const last = ts ? Date.parse(ts) : null;
          if (last && last < staleCutoff) return { name: t[1], state: 'yellow' };
          return { name: t[1], state: 'green' };
        })
        .catch(function() { return { name: t[1], state: 'unknown' }; });
    }));

    // Suppression-mark maintenance. Clear only on CONFIRMED states:
    // green ends the episode entirely; yellow ends a previous red episode
    // (downgrade) so a later re-escalation to red surfaces again. 'unknown'
    // leaves everything untouched.
    results.forEach(function(r) {
      if (r.state === 'green') {
        delete _socialAlertShown[r.name + ':red'];
        delete _socialAlertShown[r.name + ':yellow'];
      } else if (r.state === 'yellow') {
        delete _socialAlertShown[r.name + ':red'];
      }
    });

    const red = results.filter(function(r) { return r.state === 'red'; }).map(function(r) { return r.name; });
    const yellow = results.filter(function(r) { return r.state === 'yellow'; }).map(function(r) { return r.name; });

    function joinNames(arr) {
      return arr.length === 1 ? arr[0]
        : arr.length === 2 ? arr[0] + ' and ' + arr[1]
        : arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
    }

    // Red takes the toast slot when present; yellow waits for a clean run
    // (surfaced by the post-reconnect re-check or a later periodic tick).
    // Within a severity, toast only if at least one listed platform hasn't
    // been surfaced this episode; re-showing names every current platform of
    // that severity and marks them all, so an unchanged set never re-fires.
    if (red.length) {
      const hasNewRed = red.some(function(n) { return !_socialAlertShown[n + ':red']; });
      if (hasNewRed) {
        showDashToast('error', 'Reconnection needed: ' + joinNames(red) + '. Data updates are paused. Go to Settings to reconnect.', { sticky: true });
        red.forEach(function(n) { _socialAlertShown[n + ':red'] = true; });
      }
    } else if (yellow.length) {
      const hasNewYellow = yellow.some(function(n) { return !_socialAlertShown[n + ':yellow']; });
      if (hasNewYellow) {
        showDashToast('warning', 'Connection issue with ' + joinNames(yellow) + ', please try reconnecting in Settings.', { sticky: true });
        yellow.forEach(function(n) { _socialAlertShown[n + ':yellow'] = true; });
      }
    }
  } catch (e) {
    console.error('checkSocialReconnections', e);
  }
}

// Keeps long-lived sessions honest: the load-time check only runs once, so an
// app that stays open (or backgrounded) for days would never surface a
// connection that goes red or stale mid-session. A low-frequency interval plus
// a throttled resume check close that gap. The suppression marks above make
// repeated checks safe: an unchanged condition never re-fires the toast.
var _socialMonitorStarted = false;
function startSocialHealthMonitor() {
  if (_socialMonitorStarted) return; // one timer ever, even if setUser re-runs
  _socialMonitorStarted = true;
  var THREE_HOURS = 3 * 60 * 60 * 1000;
  var RESUME_MIN_GAP = 2 * 60 * 1000;
  setInterval(function() {
    try { if (currentUser) checkSocialReconnections(currentUser.id); } catch (e) {}
  }, THREE_HOURS);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState !== 'visible') return;
    if (!currentUser) return;
    // Throttle: quick app-switching shouldn't spam queries. The last-check
    // timestamp also covers the load-time check, so a resume right after
    // load doesn't double-fire.
    if (Date.now() - _lastSocialCheckAt < RESUME_MIN_GAP) return;
    try { checkSocialReconnections(currentUser.id); } catch (e) {}
  });
  window.addEventListener('pageshow', function(e) {
    if (!e.persisted || !currentUser) return;
    if (Date.now() - _lastSocialCheckAt < RESUME_MIN_GAP) return;
    try { checkSocialReconnections(currentUser.id); } catch (e) {}
  });
}

function showDashToast(type, message, opts) {
  // opts.sticky: the toast stays until tapped (no auto-hide). Used for
  // must-see alerts like dead social connections; the whole toast is
  // click-to-dismiss.
  // Slide-in notification tab, anchored to the right edge (GeForce style).
  // Safe-area aware so it clears the notch inside the mobile app.
  const existing = document.getElementById('dash-toast');
  if (existing) existing.remove();

  const isSuccess = type === 'success';
  const isWarning = type === 'warning';
  // success = green, warning = amber (soft "maybe reconnect"), error = red.
  const accent = isSuccess ? '#4ade80' : (isWarning ? '#f5a623' : '#e5484d');
  const icon = isSuccess
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : (isWarning
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>');

  const toast = document.createElement('div');
  toast.id = 'dash-toast';
  toast.setAttribute('role', (isSuccess || isWarning) ? 'status' : 'alert');
  // Anchor slightly below the topbar, measured live so it tracks the real
  // header height (which includes the safe-area inset inside the app).
  const bar = document.querySelector('.topbar');
  const topPos = bar
    ? (bar.getBoundingClientRect().bottom + 12) + 'px'
    : 'calc(76px + env(safe-area-inset-top, 0px))';
  toast.style.cssText = 'position:fixed;right:0;top:' + topPos + ';z-index:10010;'
    + 'background:#1b1b26;color:#ffffff;border-left:3px solid ' + accent + ';'
    + 'border-radius:12px 0 0 12px;padding:14px 18px 14px 14px;'
    + 'font-size:14px;font-weight:500;font-family:\'DM Sans\',sans-serif;'
    + 'display:flex;align-items:center;gap:10px;max-width:min(340px, 86vw);'
    + 'box-shadow:0 8px 32px rgba(0,0,0,0.45);cursor:pointer;'
    + 'transform:translateX(110%);transition:transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);';
  // Icon is a static SVG literal; the message is rendered as TEXT so
  // interpolated strings (server error messages etc.) can never inject HTML.
  const iconWrap = document.createElement('span');
  iconWrap.style.cssText = 'color:' + accent + ';display:inline-flex;flex-shrink:0;';
  iconWrap.innerHTML = icon;
  const msgWrap = document.createElement('span');
  msgWrap.style.lineHeight = '1.4';
  msgWrap.textContent = message;
  toast.appendChild(iconWrap);
  toast.appendChild(msgWrap);
  const sticky = !!(opts && opts.sticky);
  document.body.appendChild(toast);

  // Next frame: slide in from the right edge.
  requestAnimationFrame(function() {
    requestAnimationFrame(function() { toast.style.transform = 'translateX(0)'; });
  });

  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    toast.style.transform = 'translateX(110%)';
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 400);
  }
  // Tap anywhere on the tab to dismiss early.
  toast.addEventListener('click', dismiss);
  // Sticky toasts have no auto-hide; they stay until tapped.
  if (!sticky) {
    // Successes are short confirmations: 3s. Errors get 6s plus extra time
    // for long messages (reading time scales with length), capped at 10s.
    const duration = isSuccess
      ? 3000
      : Math.min(10000, 6000 + Math.max(0, message.length - 60) * 40);
    setTimeout(dismiss, duration);
  }
}

async function fetchTier(userId) {
  // Safety net: if fetchTier hangs or errors, ensure tier-loading is removed
  // after 5s so the UI doesn't get stuck with hidden pills forever.
  const safety = setTimeout(function() {
    document.body.classList.remove('tier-loading');
  }, 5000);
  try {
    const { data } = await sb.from('subscriptions').select('tier, status, trial_end, max_trial_used, pre_max_tier, billing_cycle').eq('user_id', userId).limit(1);
    if (data && data.length > 0) {
      userTier = data[0].tier || 'free';
      userStatus = data[0].status || 'free';
      userTrialEnd = data[0].trial_end || null;
      userMaxTrialUsed = data[0].max_trial_used === true;
      userPreMaxTier = data[0].pre_max_tier || null;
      userBillingCycle = data[0].billing_cycle || 'monthly';
    }
    updateTierUI();
    // Pre-load AI usage so the sidebar menu opens instantly with no layout shift.
    // Runs for ALL tiers - Free shows a locked state with upgrade CTA.
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
  const trialLabel = 'Try Creator Max Free - 7 Days';
  const noTrialLabel = 'Upgrade to Creator Max';
  const label = userMaxTrialUsed ? noTrialLabel : trialLabel;

  // Static markup buttons
  document.querySelectorAll('[data-max-trial-cta]').forEach(function(btn) {
    btn.textContent = label;
  });
  // Note: the old Settings "upgrade confirmation copy" element was removed
  // when Settings moved to a single "Change Plan" button that routes to the
  // pricing page. No per-state copy to update here anymore.
}

function updateTierUI() {
  const pro = isPro();
  const max = isMax();
  const isCancelling = pro && userStatus === 'cancelling';
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

  // Sidebar / account menu label - intentionally NOT showing trial state.
  // Keeps the sidebar text short; trial info is surfaced in the topbar pill
  // and the Settings panel.
  const planText = isCancelling
    ? (max ? 'Max (Cancelling)' : 'Pro (Cancelling)')
    : max ? 'Creator Max' : pro ? 'Pro Plan' : 'Free Plan';

  if (sidebarTier) { sidebarTier.textContent = planText; sidebarTier.style.visibility = ''; }
  var menuTier = document.getElementById('sidebar-menu-tier');
  if (menuTier) { menuTier.textContent = planText; menuTier.style.visibility = ''; }
  // Cache for instant paint on the next load (prevents the Free Plan flash).
  try { localStorage.setItem('ryxa_tier_label', planText); } catch (e) {}
  // Toggle Creator Max styling on sidebar bottom and body
  const sidebarBottom = document.querySelector('.sidebar-bottom');
  if (sidebarBottom) {
    sidebarBottom.classList.toggle('max-mode', max);
    sidebarBottom.classList.toggle('pro-mode', pro && !max);
  }
  document.body.classList.toggle('max-user', max);
  document.body.classList.toggle('pro-user', pro && !max);

  // Bottom-nav "Plans" button swaps to "Media Kit" for paid users. Free users
  // keep "Plans" (their entry to the Plans & Billing page). The click handler
  // (show-plans-nav) also routes by tier, so label and behavior stay in sync.
  var planNavLabel = document.getElementById('bnav-plans-label');
  var planNavBtn = document.getElementById('bnav-plans');
  var planNavIcon = document.getElementById('bnav-plans-icon');
  if (planNavLabel && planNavBtn) {
    if (pro) {
      planNavLabel.textContent = 'Media Kit';
      planNavBtn.setAttribute('aria-label', 'Media Kit');
      if (planNavIcon) {
        planNavIcon.innerHTML = '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M8 4v5"/>';
      }
    } else {
      planNavLabel.textContent = 'Plans';
      planNavBtn.setAttribute('aria-label', 'Plans');
      if (planNavIcon) {
        planNavIcon.innerHTML = '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91 0z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>';
      }
    }
  }
  // Free users: hide the Settings Subscription section (Plans page is their
  // single upgrade surface). Paid users keep it.
  if (typeof plansBillingApplySettingsVisibility === 'function') {
    plansBillingApplySettingsVisibility();
  }
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
        : 'Try Creator Max Free - 7 Days';
      upgradeBtn.onclick = () => promptUpgradeToMax();
      upgradeBtn.style.background = 'linear-gradient(135deg,#a78bfa,#e879f9)';
      upgradeBtn.style.boxShadow = '0 0 20px rgba(232,121,249,0.35)';
      if (maxBtn) maxBtn.style.display = 'none';
    } else {
      // Free user: show Pro upgrade with default styling, plus the secondary Max button.
      upgradeBtn.style.display = 'block';
      upgradeBtn.textContent = 'Upgrade to Pro';
      upgradeBtn.onclick = function() { goToPricing('pro'); };
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

  // Tier is now resolved - reveal the appropriate pills.
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
  // Tier gate: tools above the user's plan don't render a locked preview;
  // they route straight to Plans & Billing (the single upgrade surface).
  // Unknown tier (still loading) falls through and renders normally.
  var TOOL_MIN_TIER = { mediakit: 'pro', courses: 'max', coaching: 'max', products: 'max', deals: 'max' };
  var _needs = TOOL_MIN_TIER[tool];
  if (_needs && typeof userTier !== 'undefined' && userTier) {
    var _t = (userTier === 'monthly' || userTier === 'pro') ? 'pro' : userTier;
    var _locked = (_needs === 'pro' && _t === 'free') || (_needs === 'max' && _t !== 'max');
    if (_locked) {
      if (typeof closeSidebar === 'function') closeSidebar();
      goToPricing(_needs);
      return;
    }
  }
  // Leaving the Plans & Billing page (a hash-routed view that sits outside the
  // normal tool system): restore the topbar/padding it hid and clear its hash
  // so the tool renders normally.
  if (document.body.classList.contains('plans-billing-active')) {
    document.body.classList.remove('plans-billing-active');
    var _pbView = document.getElementById('plans-billing-view');
    if (_pbView) { _pbView.style.display = 'none'; }
    if ((window.location.hash || '').replace('#', '') === 'plans-billing') {
      try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
    }
    // Clear the Plans tab highlight; the tool being opened lights its own.
    var _pbNav = document.getElementById('bnav-plans');
    if (_pbNav) _pbNav.classList.remove('active');
  }
  // Cancel any in-flight surface loads from the view being left, but ONLY when
  // the tool actually changes. A fast double-tap on the same nav item would
  // otherwise bump the generation and cancel the tool's OWN in-flight load,
  // while the init guards (bioInited/mkInited) prevent a reload, freezing the
  // editor in its locked "Loading..." state until another tap. Re-selecting the
  // already-active tool must never cancel its own load.
  if (tool !== currentTool) window.RyxaLoadGen.bump();
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
  ['welcome','bio','bio-analytics','courses','coaching','products','mediakit','grid','follower','image','design','aichat','qr','invoice','pdfsign','deals','scripts','thumbanalyzer','contractanalyzer','analytics','calendar','clients','moretools','settings'].forEach(t => {
    const el = document.getElementById('tool-' + t);
    if (el) el.style.display = 'none';
    const nav = document.getElementById('nav-' + t);
    if (nav) nav.classList.remove('active');
    const bnav = document.getElementById('bnav-' + t);
    if (bnav) bnav.classList.remove('active');
  });
  // The Analytics parent toggle isn't a nav-{tool} id; reset it fully here.
  // For analytics tools the branch below re-lights it and re-opens the
  // submenu; for every other tool this collapses the drawer and clears it.
  const _anaToggleClear = document.getElementById('nav-analytics-toggle');
  const _anaSubClear = document.getElementById('nav-analytics-submenu');
  if (_anaToggleClear) {
    _anaToggleClear.classList.remove('active');
    _anaToggleClear.setAttribute('aria-expanded', 'false');
  }
  if (_anaSubClear) _anaSubClear.classList.remove('open');
  // The dual-purpose bottom-nav button (bnav-plans, which acts as Media Kit for
  // paid users) isn't a bnav-{tool} id, so clear its active state here unless
  // we're showing mediakit (its own handler re-lights it).
  if (tool !== 'mediakit') {
    var _bpClear = document.getElementById('bnav-plans');
    if (_bpClear) _bpClear.classList.remove('active');
  }
  // Show selected
  const el = document.getElementById('tool-' + tool);
  if (el) {
    el.style.display = 'block';
    // Fade the tool in on every switch. Remove + reflow + re-add so the
    // animation replays each time the same tool element is re-shown.
    el.classList.remove('dash-tool-fade-in');
    void el.offsetWidth;
    el.classList.add('dash-tool-fade-in');
  }
  const nav = document.getElementById('nav-' + tool);
  if (nav) nav.classList.add('active');
  // Sync the mobile bottom-nav tab (only welcome/bio/calendar/clients exist there;
  // on any other tool no tab is highlighted, which is the intended behavior).
  const bnav = document.getElementById('bnav-' + tool);
  if (bnav) bnav.classList.add('active');
  positionBnavPill();
  // Keep the Analytics submenu expanded whenever an analytics page is shown
  if (tool === 'analytics' || tool === 'bio-analytics') {
    const anaSub = document.getElementById('nav-analytics-submenu');
    const anaToggle = document.getElementById('nav-analytics-toggle');
    if (anaSub) anaSub.classList.add('open');
    if (anaToggle) {
      anaToggle.setAttribute('aria-expanded', 'true');
      // The toggle isn't a nav-{tool} item, so the generic active-class pass
      // never lights it. Without this, touch devices (where hover is gated)
      // get zero highlight on the Analytics parent while its tool is open.
      anaToggle.classList.add('active');
    }
  }

  // Init settings when shown
  if (tool === 'settings') {
    // Open Settings at the top. showTool doesn't reset the window scroll, so a
    // scrolled-down previous view would otherwise carry its offset into Settings.
    // Instant (not smooth) so it doesn't animate against the html smooth-scroll.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const pro = isPro();
    // Pre-select current currency dropdown
    var ccSel = document.getElementById('settings-currency-select');
    if (ccSel) ccSel.value = currentCurrency;
    // Calendar section: populate the timezone dropdown and render the Google
    // Calendar connection state. Both functions live in calendar.js (loaded on
    // this page); typeof-guarded defensively. calPopulateInlineTimezone reads
    // window._ryx_creator_tz, which this shell set from profiles.calendar_timezone
    // on load, so the dropdown shows the saved tz even if the Calendar tool has
    // never been opened this session.
    try { if (typeof calPopulateInlineTimezone === 'function') calPopulateInlineTimezone(); } catch (e) { console.error('Settings tz populate error:', e); }
    try { if (typeof gcalLoadConnectionState === 'function') gcalLoadConnectionState(); } catch (e) { console.error('Settings gcal state error:', e); }
    try { if (typeof gcalHandleReturnParams === 'function') gcalHandleReturnParams(); } catch (e) { console.error('Settings gcal params error:', e); }
    if (currentUser) {
      // Avatar: check bioState first, then query DB
      if (typeof bioState !== 'undefined' && bioState.avatar_url) {
        updateDashboardAvatar(bioState.avatar_url);
      } else {
        // bioState might not be loaded yet - query directly
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
    if (pro && typeof iapApplySettingsManagement === 'function') iapApplySettingsManagement();
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
    try {
      var _accountsLoad = loadConnectedAccountsWithSpinner();
      // If we arrived here from the Calendar gear icon, scroll to the Calendar
      // section only AFTER the accounts section has finished loading (and thus
      // reached its final height). Waiting on the actual load promise removes
      // the layout-shift race entirely - no fixed timeout to guess at. The
      // extra requestAnimationFrame catches any last reflow after the rows paint.
      if (_accountsLoad && typeof _accountsLoad.then === 'function') {
        _accountsLoad.then(function() {
          if (!window._scrollToCalendarSettings) return;
          window._scrollToCalendarSettings = false;
          requestAnimationFrame(function() {
            var sec = document.getElementById('settings-calendar-section');
            if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        });
      }
    } catch(e) { console.error('Connected accounts error:', e); }
    // Adjust the password section for Google-login accounts (no Ryxa password to reset)
    try { applyGoogleAccountPasswordUI(); } catch(e) { console.error('Password UI error:', e); }
    // Load marketing email preference
    try {
      sb.from('profiles').select('marketing_emails').eq('user_id', currentUser.id).single().then(function(res) {
        var toggle = document.getElementById('settings-marketing-emails');
        if (toggle && res.data) toggle.checked = !!res.data.marketing_emails;
      });
    } catch(e) {}
  }
  // Init Design Studio
  if (tool === 'design') {
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
  // Show the chat sidebar toggle (in the topbar) only on the Chatbox tool, and
  // start collapsed each time the tool is opened.
  var chatSideToggle = document.getElementById('aichat-side-toggle');
  if (chatSideToggle) chatSideToggle.style.display = (tool === 'aichat') ? 'inline-flex' : 'none';
  if (tool === 'aichat') {
    var aichatSideEl = document.getElementById('aichat-side');
    if (aichatSideEl) aichatSideEl.classList.remove('aichat-side-open');
    if (chatSideToggle) chatSideToggle.setAttribute('aria-expanded', 'false');
  }
  currentTool = tool;
  // Let the responsive CSS gutter govern. Previously this hardcoded 32px
  // (the desktop value), which overrode the mobile gutter on every tool switch.
  const toolArea = document.querySelector('.tool-area');
  if (toolArea) toolArea.style.padding = '';
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
  if (tool === 'bio-analytics' && typeof initBioAnalyticsTool === 'function') initBioAnalyticsTool();
  if (tool === 'calendar') initCalendarTool();
  if (tool === 'thumbanalyzer') initThumbanalyzerTool();
  if (tool === 'contractanalyzer') initContractanalyzerTool();
  if (tool === 'clients') initClientsTool();
  if (tool === 'welcome') loadDashStats();
  // Close sidebar on mobile
  closeSidebar();
}

// Slide the bottom-nav pill to the active tab. The pill is 20% wide (one of five
// tabs), so translateX(index * 100%) lands it under the active tab. When the
// active tool is not on the bar, the pill fades out.
function positionBnavPill() {
  var bar = document.getElementById('mobile-bottom-nav');
  var pill = document.getElementById('bnav-pill');
  if (!bar || !pill) return;
  var items = bar.querySelectorAll('.mobile-bottom-nav-item');
  var idx = -1;
  for (var i = 0; i < items.length; i++) {
    if (items[i].classList.contains('active')) { idx = i; break; }
  }
  if (idx < 0) { pill.style.opacity = '0'; return; }
  pill.style.opacity = '1';
  pill.style.transform = 'translateX(' + (idx * 100) + '%)';
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

// Native app only: checkout link-outs open Safari while this page stays put,
// so pageshow never fires and loading buttons stay stuck. Restore them all
// whenever the app comes back to the foreground.
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible') return;
  if (!window.RyxaNative || !_btnLoadingSet.size) return;
  Array.from(_btnLoadingSet).forEach(function (btn) {
    try { clearBtnLoading(btn); } catch (_) {}
  });
});

// =============================================================================
// goToPricing - the new SaaS-standard upgrade entry point.
//
// Instead of upsell buttons triggering Stripe Checkout directly, they now
// send the user to /pricing.html where they pick plan + billing cycle. The
// pricing page handles the rest (logged-in users get in-place updates or
// fresh checkout; logged-out users go through signup with stored intent).
//
// Optional highlightPlan ('pro' | 'max') adds a query param the pricing
// page could use to visually emphasize a plan. Harmless if unused.
// =============================================================================
function goToPricing(highlightPlan) {
  // SINGLE SOURCE OF TRUTH: every upsell CTA routes to the in-dashboard Plans &
  // Billing page. From there, free users buy (dual-rail/IAP by storefront) and
  // paid Stripe users get the "See plans" link-out to the pricing page. The
  // direct pricing link-out lives in goToPricingDirect (used by "See plans").
  if (window.location.hash !== '#plans-billing') {
    window.location.hash = 'plans-billing';
  } else if (typeof plansBillingRouteCheck === 'function') {
    plansBillingRouteCheck();
  }
}

// The original pricing-page hand-off (in-app: Safari link-out with a signed
// ticket; web: normal navigation). Called by the Plans & Billing "See plans"
// button, not by upsell CTAs directly.
function goToPricingDirect(highlightPlan) {
  var query = '';
  if (highlightPlan === 'pro' || highlightPlan === 'max') {
    query = '?highlight=' + highlightPlan;
  }
  // Inside the native app, pricing must open in the external browser (Safari),
  // not render in the app WebView, so no purchase surface lives inside the app.
  // Safari does NOT share the app WebView's Supabase session, so without help
  // the pricing page would see a logged-out visitor and bounce to signup. Mint
  // a short-lived signed ticket (same pattern as the OAuth ticket endpoints)
  // that carries the signed-in user's identity across to Safari, and append it
  // to the URL. The pricing page hands it to checkout, which verifies it
  // server-side. On the website this branch is skipped entirely.
  if (window.RyxaNative) {
    mintPricingTicketThenOpen(query);
    return;
  }
  window.location.href = '/pricing.html' + query;
}

// Fetches a signed pricing ticket for the current user, then opens the pricing
// page in Safari with it. Falls back to opening pricing without a ticket if the
// mint fails (the pricing page will then prompt for login rather than break).
async function mintPricingTicketThenOpen(query) {
  // app=1 marks this as opened-from-the-app so the pricing page, now in Safari
  // (where window.RyxaNative does not exist), still hides the site nav, footer,
  // and chat widget for a clean app-like view. No Back to Dashboard bar is
  // added in this case: Safari is a separate page with its own controls.
  var base = 'https://www.ryxa.io/pricing.html' + query + (query ? '&' : '?') + 'app=1';
  try {
    var sessionResp = await sb.auth.getSession();
    var accessToken = sessionResp && sessionResp.data && sessionResp.data.session
      ? sessionResp.data.session.access_token : null;
    if (accessToken) {
      var r = await fetch('/api/pricing-ticket', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken }
      });
      if (r.ok) {
        var j = await r.json();
        if (j && j.ticket) {
          base += '&ticket=' + encodeURIComponent(j.ticket);
        }
      }
    }
  } catch (e) {
    // Network/auth failure: open pricing without a ticket. The pricing page
    // handles the logged-out case by prompting login, so nothing breaks.
  }
  window.location.href = base;
}

// Native app only: relabel upgrade buttons to neutral tier names and strip
// prices. Apple treats purchase-verb CTAs ("Upgrade Now", "Upgrade to Pro,
// $10/mo") and in-app price references as In-App-Purchase / metadata problems
// (guidelines 3.1.1 and 2.3.7). Naming the tier plainly ("Ryxa Pro" / "Ryxa
// Max") reads as navigation, not a purchase prompt, matching how compliant
// competitor apps present their upgrade entry point. The buttons still work,
// they just open the pricing page in Safari (see goToPricing). On the website
// (no window.RyxaNative) none of this runs, so web labels and prices are
// unchanged.
(function relabelUpgradeUiInApp() {
  if (!window.RyxaNative) return;

  function tierFor(el) {
    // Max if the action or any nearby data attribute names 'max'; else Pro.
    var attrs = '';
    for (var i = 0; i < el.attributes.length; i++) {
      attrs += ' ' + el.attributes[i].name + '=' + el.attributes[i].value;
    }
    return /max/i.test(attrs) ? 'Ryxa Max' : 'Ryxa Pro';
  }

  function relabel() {
    // Buttons whose action is an upgrade/checkout/pricing entry point. These
    // are the tappable CTAs the reviewer would read as "buy".
    var sel = [
      '[data-mk-action="start-checkout"]',
      '[data-grid-action="start-checkout"]',
      '[data-thumb-action="start-checkout"]',
      '[data-contract-action="start-checkout"]',
      '[data-chat-action="start-checkout"]',
      '[data-scripts-action="start-checkout"]',
      '[data-follower-action="start-checkout"]',
      '[data-settings-action="open-pricing"]',
      '[data-bio-action="verify-upsell-upgrade"]',
      '[data-bio-action="hero-upsell-upgrade"]',
      '[data-bio-action="hero-link-upsell-upgrade"]',
      '[data-bio-action="ban-upgrade"]',
      '[data-dash-action="sidebar-upgrade-pro"]',
      '[data-course-action="max-upgrade"]',
      '[data-coach-action="max-upgrade"]',
      '[data-prod-action="max-upgrade"]',
      '[data-deal-action="max-upgrade"]',
      '[data-ana-action="max-upgrade"]',
      '[data-dash-action="confirm-pro-upsell"]'
    ].join(',');

    document.querySelectorAll(sel).forEach(function (el) {
      // "Change Plan" is management, not a purchase CTA; leave it as-is.
      var current = (el.textContent || '').trim();
      if (/change plan/i.test(current)) return;
      // The Settings entry point is a neutral navigation item, label it "Plans"
      // (reads as account management, not a purchase CTA). Other upgrade buttons
      // use the tier name.
      var label = el.getAttribute('data-settings-action') === 'open-pricing'
        ? 'Plans'
        : tierFor(el);
      // Only rewrite if it currently reads as an upgrade/price CTA, so we don't
      // clobber unrelated labels if a selector is ever reused.
      if (/upgrade|\$\d|\/mo|unlock/i.test(current) || current === '') {
        el.textContent = label;
      }
    });

    // External-link affordances (Apple link-out compliance, Spotify pattern):
    // every purchase/billing CTA opens Safari, so each gets the standard
    // external-link glyph inside the button and a one-line disclosure under
    // it. The icon is (re)appended on every pass because the textContent
    // assignments above wipe it; the disclosure div lives OUTSIDE the button
    // so it survives relabeling. In-app only (this whole function is gated on
    // RyxaNative); web buttons never get any of this.
    var EXT_ICON = '<svg class="ryxa-ext-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-left:6px;vertical-align:-1px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    function decorateExternalCta(el, note) {
      if (!el.querySelector('.ryxa-ext-ico')) {
        el.insertAdjacentHTML('beforeend', EXT_ICON);
      }
      var next = el.nextElementSibling;
      if (!(next && next.classList && next.classList.contains('ryxa-ext-note'))) {
        // Pull the button's own bottom margin off so the disclosure sits
        // directly under it (button -> text -> space), not (button -> space
        // -> text). The gap goes below the note instead.
        el.style.marginBottom = '0';
        var div = document.createElement('div');
        div.className = 'ryxa-ext-note';
        div.textContent = note;
        div.style.cssText = 'font-size:11px;color:var(--muted);margin:4px 0 16px;line-height:1.4;';
        if (el.parentNode) el.parentNode.insertBefore(div, el.nextSibling);
      }
    }
    document.querySelectorAll(sel).forEach(function (el) {
      // These upsell buttons now route to the IN-APP Plans & Billing page (via
      // goToPricing), not out to Safari, so they must NOT carry the external
      // glyph or the "taken to our website" disclosure - that wrongly implied a
      // Stripe link-out. Strip any stale decoration a previous pass added.
      var glyph = el.querySelector('.ryxa-ext-ico');
      if (glyph) glyph.remove();
      var maybeNote = el.nextElementSibling;
      if (maybeNote && maybeNote.classList && maybeNote.classList.contains('ryxa-ext-note')) {
        maybeNote.remove();
      }
    });
    // Only the genuine link-out (Manage Billing opens the browser) keeps the
    // external affordance.
    document.querySelectorAll('[data-settings-action="manage-billing"]').forEach(function (el) {
      decorateExternalCta(el, 'By clicking this button you\'ll be taken to your browser.');
    });

    // Neutralize upgrade-y titles, descriptions, and banner copy (not buttons).
    // Maximum-safety pass so no in-app surface reads as a purchase pitch. Each
    // entry maps a target to its neutral in-app text. Web is untouched.
    var texts = [
      ['#pro-upsell-title', 'Ryxa Pro'],
      ['#pro-upsell-description', 'This is a Ryxa Pro feature.'],
      ['#pro-upsell-price-line', 'Cancel anytime.'],
      ['.settings-s-a74d40', 'You are on the Free plan.']
    ];
    texts.forEach(function (pair) {
      document.querySelectorAll(pair[0]).forEach(function (el) {
        if (el.textContent.trim() !== pair[1]) el.textContent = pair[1];
      });
    });

    // Text-matched neutralizations for elements without stable ids/classes.
    // Replace only the exact known upgrade sentences, leaving everything else.
    var phraseMap = [
      ['Upgrade to Creator Max?', 'Ryxa Max'],
      ['The footer link helps other creators find Ryxa. Upgrade to Pro to remove it.',
       'The footer link helps other creators find Ryxa. Removing it is a Ryxa Pro feature.'],
      ['Free users can plan in this session, upgrade to Pro to save and return later.',
       'Saving and returning to this session later is a Ryxa Pro feature.']
    ];
    // Hide the "View live page" links in the app (Link in Bio + Media Kit).
    // They open the real public page in the in-app browser, which renders
    // functional tip/purchase surfaces (Apple 3.1.1). Creators still open their
    // live page from a real browser on the website.
    ['#bio-view-live', '#mk-view-live'].forEach(function (id) {
      document.querySelectorAll(id).forEach(function (el) { el.style.display = 'none'; });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', relabel);
  } else {
    relabel();
  }
  // Tools render their upsell buttons lazily when their section first opens,
  // so re-run when the DOM changes. Debounced to one pass per animation frame
  // so a busy dashboard never triggers repeated heavy scans.
  try {
    var scheduled = false;
    var mo = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () { scheduled = false; relabel(); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  } catch (e) { /* observer unsupported: initial pass still covers most */ }
})();

async function startCheckout(planOrIntent, cycleOrBtn, maybeBtn) {
  if (!currentUser) { window.location.href = 'index.html'; return; }

  // Resolve arguments. This function has been called from many callers across
  // the codebase with varying signatures over time. Support all of them:
  //
  //   startCheckout()                          - read intent from localStorage
  //   startCheckout('max')                     - legacy: plan only
  //   startCheckout('monthly')                 - legacy: 'monthly' means Pro
  //   startCheckout(undefined, btnEl)          - legacy with explicit btn
  //   startCheckout('max', btnEl)              - legacy plan + btn
  //   startCheckout('max', 'monthly', btnEl)   - new: plan, cycle, btn
  //   startCheckout('max', 'annual', btnEl)    - new: plan, cycle, btn
  //   startCheckout({plan, cycle}, btnEl)      - new: full intent object
  //
  // Returns resolved {plan, cycle, btn}.
  function resolveArgs(a, b, c) {
    var resolved = { plan: null, cycle: 'monthly', btn: null };

    // Determine if first arg is an intent object
    if (a && typeof a === 'object' && a.plan) {
      resolved.plan = (a.plan === 'max') ? 'max' : 'pro';
      resolved.cycle = (a.cycle === 'annual') ? 'annual' : 'monthly';
      // Second arg is the button if present
      if (b && b.tagName === 'BUTTON') resolved.btn = b;
      return resolved;
    }

    // First arg is a plan string (or undefined)
    var planArg = a;
    // Legacy: 'monthly' means Pro tier on monthly cycle
    if (planArg === 'monthly') { resolved.plan = 'pro'; resolved.cycle = 'monthly'; }
    else if (planArg === 'max') { resolved.plan = 'max'; }
    else if (planArg === 'pro') { resolved.plan = 'pro'; }
    // else planArg is null/undefined - will be resolved from localStorage below

    // Second arg: cycle ('monthly'/'annual') or button element
    if (b === 'monthly' || b === 'annual') {
      resolved.cycle = b;
      if (c && c.tagName === 'BUTTON') resolved.btn = c;
    } else if (b && b.tagName === 'BUTTON') {
      resolved.btn = b;
    }

    return resolved;
  }

  var resolved = resolveArgs(planOrIntent, cycleOrBtn, maybeBtn);

  // If plan still unresolved, read localStorage intent. Supports both the new
  // JSON shape ({plan, cycle}) and the legacy string shape ('max'/'monthly').
  if (!resolved.plan) {
    try {
      var raw = localStorage.getItem('fts_intended_plan');
      if (raw) {
        // Try JSON parse first (new shape)
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        if (parsed && parsed.plan) {
          resolved.plan = (parsed.plan === 'max') ? 'max' : 'pro';
          resolved.cycle = (parsed.cycle === 'annual') ? 'annual' : 'monthly';
        } else {
          // Legacy string shape
          if (raw === 'max') { resolved.plan = 'max'; }
          else if (raw === 'monthly' || raw === 'pro') { resolved.plan = 'pro'; }
        }
      }
    } catch (e) {}
  }

  // Final default if still unresolved
  if (!resolved.plan) resolved.plan = 'pro';

  // Try to find the button that triggered this call so we can show a loading state.
  const btn = resolved.btn || (typeof event !== 'undefined' && event && event.currentTarget && event.currentTarget.tagName === 'BUTTON' ? event.currentTarget : null);
  if (btn) setBtnLoading(btn, 'Opening checkout…');

  // Resolve to a Stripe price ID via the 4-price map
  const priceId = PRICE_IDS[resolved.plan] && PRICE_IDS[resolved.plan][resolved.cycle];
  if (!priceId) {
    console.error('No Stripe price found for', resolved.plan, resolved.cycle);
    try { clearBtnLoading(btn); } catch (_) {}
    return;
  }

  // Extract a user-readable error message from the Edge Function response.
  // Supabase JS SDK wraps non-2xx responses in a FunctionsHttpError where the
  // body lives at err.context (a Response). We try to JSON-parse it for the
  // "error" field - that's what our Edge Function returns. Fallback to the
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
        // Inside the native app, Stripe checkout runs in Safari, so success and
        // cancel route through app-return.html, which deep links back into the app.
        successUrl: window.RyxaNative
          ? window.location.origin + '/app-return.html?status=success'
          : window.location.origin + '/dashboard.html?payment=success',
        cancelUrl: window.RyxaNative
          ? window.location.origin + '/app-return.html?status=cancelled'
          : window.location.origin + '/dashboard.html?payment=cancelled',
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
        // Tier updated in-place - refresh user tier and show status inline
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
          // Settings modal is closed - open it so the user sees their new state
          if (typeof openSettingsModal === 'function') {
            openSettingsModal();
            setTimeout(() => showSettingsResult('success', msg), 150);
          }
        }
        clearBtnLoading(btn);
      } else {
        // Page is about to navigate away - keep the loading state so users don't double-click
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

// Step 1: user clicked "Upgrade to Creator Max" - show inline confirmation

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
// PRO UPSELL MODAL - reusable for any Pro-locked feature.
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
  // New flow: all upgrades route through the pricing page where the user
  // picks plan + billing cycle. (Previously this fired Stripe checkout
  // directly for Pro Monthly.)
  closeProUpsell();
  goToPricing('pro');
}

async function confirmTopbarUpgradeToMax(ev) {
  // New flow: route to pricing page instead of firing checkout directly.
  closeTopbarUpgradeConfirm();
  goToPricing('max');
}

// Unified handler for any "Upgrade to Creator Max" button outside the topbar.
// New flow: everyone goes to the pricing page to pick plan + billing cycle.
function handleMaxUpgradeClick(ev) {
  goToPricing('max');
}

// Step 1: user clicked "Downgrade to Pro" - show inline confirmation
function closeSignoutModal() {
  const modal = document.getElementById('signout-modal');
  if (modal) modal.style.display = 'none';
}
async function confirmSignOut() {
  const btn = document.getElementById('signout-confirm-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span> Signing out...'; }
  _intentionalSignOut = true;
  try { await sb.auth.signOut({ scope: 'local' }); } catch(e) { console.error(e); }
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
  try { localStorage.removeItem('ryxa_tier_label'); } catch (e) {}
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
  // Clean up any leftover sign-out UI beneath this overlay. Without this,
  // the still-open "Signing out..." modal flashes when the next login
  // reveals or reloads the dashboard underneath.
  closeSignoutModal();
  var soBtn = document.getElementById('signout-confirm-btn');
  if (soBtn) { soBtn.disabled = false; soBtn.textContent = 'Yes, sign me out'; }
  var staleConfirm = document.getElementById('modal-confirm-overlay');
  if (staleConfirm) staleConfirm.remove();
  // Reset form
  var emailEl = document.getElementById('pwa-email');
  var pwEl = document.getElementById('pwa-password');
  if (emailEl) emailEl.value = '';
  if (pwEl) pwEl.value = '';
  var msg = document.getElementById('pwa-auth-msg');
  if (msg) msg.style.display = 'none';
  var btn = document.getElementById('pwa-submit-btn');
  if (btn) { btn.disabled = false; btn.textContent = pwaAuthMode === 'signin' ? 'Sign in' : 'Create account'; }
  // Always start collapsed: email form hidden, the "email ID" toggle visible.
  var emForm = document.getElementById('pwa-email-form');
  var emToggle = document.getElementById('pwa-email-toggle');
  if (emForm) emForm.style.display = 'none';
  if (emToggle) emToggle.style.display = 'block';
  renderPwaTurnstile();
  if (isPwaMode) _renderAuthDiag();
}

// Reveal the email/password form when the user taps "Sign in or sign up with
// email ID". Hides the toggle and focuses the email field.
function showPwaEmailForm() {
  var form = document.getElementById('pwa-email-form');
  var toggle = document.getElementById('pwa-email-toggle');
  if (form) form.style.display = 'block';
  if (toggle) toggle.style.display = 'none';
  var emailEl = document.getElementById('pwa-email');
  setTimeout(function() { if (emailEl) emailEl.focus(); }, 60);
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
  pwaTurnstileWidgetId = turnstile.render('#pwa-turnstile', {
    sitekey: '0x4AAAAAAC9W8avdI3sdVEcc',
    execution: 'execute',
    callback: function(token) {
      if (_pwaTurnstilePendingResolve) {
        var resolve = _pwaTurnstilePendingResolve;
        _pwaTurnstilePendingResolve = null;
        _pwaTurnstilePendingReject = null;
        resolve(token);
      }
    },
    'error-callback': function() {
      if (_pwaTurnstilePendingReject) {
        var reject = _pwaTurnstilePendingReject;
        _pwaTurnstilePendingResolve = null;
        _pwaTurnstilePendingReject = null;
        reject(new Error('Verification failed. Please try again.'));
      }
    },
  });
}

var _pwaTurnstilePendingResolve = null;
var _pwaTurnstilePendingReject = null;

// Returns a Promise<string> that resolves with a Turnstile token. Callers must
// already be in a loading state when awaiting because the PoW runs inside this.
function getPwaTurnstileToken() {
  return new Promise(function(resolve, reject) {
    if (typeof turnstile === 'undefined' || pwaTurnstileWidgetId === null) {
      reject(new Error('Verification not ready. Please try again.'));
      return;
    }
    try {
      var existing = turnstile.getResponse(pwaTurnstileWidgetId);
      if (existing) { resolve(existing); return; }
    } catch(e) {}
    _pwaTurnstilePendingResolve = resolve;
    _pwaTurnstilePendingReject = reject;
    try {
      turnstile.execute(pwaTurnstileWidgetId);
    } catch(e) {
      _pwaTurnstilePendingResolve = null;
      _pwaTurnstilePendingReject = null;
      reject(e);
    }
  });
}

function resetPwaTurnstile() {
  if (typeof turnstile !== 'undefined' && pwaTurnstileWidgetId !== null) { try { turnstile.reset(pwaTurnstileWidgetId); } catch(e) {} }
  _pwaTurnstilePendingResolve = null;
  _pwaTurnstilePendingReject = null;
}


// Spinner state for the PWA login OAuth buttons. Reset on error, on

// In-app OAuth sheet watchdog: the app's own reset fires on the sheet's
// Close button but NOT on an iOS swipe-down dismissal (RN Modal quirk;
// native fix ships in the next app build). The page under the sheet can't
// be touched while it's presented, so the next pointer event here means
// the sheet is gone: restore the login buttons if still stuck.
var _pwaSheetWatchdogArmed = false;
function armPwaSheetWatchdog() {
  if (_pwaSheetWatchdogArmed) return;
  _pwaSheetWatchdogArmed = true;
  function restore() {
    _pwaSheetWatchdogArmed = false;
    document.removeEventListener('pointerdown', restore, true);
    clearTimeout(t);
    setPwaAuthBtnLoading('pwa-google-btn', false);
    setPwaAuthBtnLoading('pwa-apple-btn', false);
  }
  var t = setTimeout(restore, 90000);
  document.addEventListener('pointerdown', restore, true);
}

// back/forward-cache returns, and by the app when its auth sheet closes.
function setPwaAuthBtnLoading(id, on) {
  var b = document.getElementById(id);
  if (!b) return;
  b.classList.toggle('auth-btn-loading', on);
  b.disabled = on;
}
window.addEventListener('pageshow', function(e) {
  if (e.persisted) {
    setPwaAuthBtnLoading('pwa-google-btn', false);
    setPwaAuthBtnLoading('pwa-apple-btn', false);
  }
});

async function handlePwaGoogleAuth() {
  setPwaAuthBtnLoading('pwa-google-btn', true);
  // Native app: don't navigate this page to the OAuth URL (a blocked
  // navigation replays when the sheet closes, reopening it in a loop).
  // Instead ask Supabase for the URL and hand it to the sheet directly.
  var inApp = !!(window.RyxaNative && window.ReactNativeWebView);
  var { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'https://ryxa.io/dashboard.html',
      queryParams: { prompt: 'select_account' },
      skipBrowserRedirect: inApp
    }
  });
  if (error) {
    setPwaAuthBtnLoading('pwa-google-btn', false);
    showPwaMsg('error', error.message);
    return;
  }
  if (inApp && data && data.url) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'openSheet', url: data.url }));
    armPwaSheetWatchdog();
  }
}

async function handlePwaAppleAuth() {
  setPwaAuthBtnLoading('pwa-apple-btn', true);
  var inApp = !!(window.RyxaNative && window.ReactNativeWebView);

  if (inApp) {
    // Native Sign in with Apple (App Review Guideline 2.1/4.8): the app shows
    // Apple's system AuthenticationServices sheet and hands the identity
    // token back here, where Supabase exchanges it for a session. The web
    // OAuth sheet is NOT used in-app; it only remains as a fallback when the
    // native API is unavailable.
    window.__ryxaAppleAuthResult = async function (raw) {
      window.__ryxaAppleAuthResult = null;
      var payload = null;
      try { payload = JSON.parse(raw); } catch (e) { /* malformed */ }
      if (!payload || payload.canceled) {
        setPwaAuthBtnLoading('pwa-apple-btn', false);
        return;
      }
      if (payload.fallback) { startPwaAppleWebFlow(); return; }
      if (!payload.ok || !payload.identityToken) {
        setPwaAuthBtnLoading('pwa-apple-btn', false);
        showPwaMsg('error', payload.error || 'Apple sign-in failed. Please try again.');
        return;
      }
      var { error } = await sb.auth.signInWithIdToken({
        provider: 'apple',
        token: payload.identityToken
      });
      if (error) {
        setPwaAuthBtnLoading('pwa-apple-btn', false);
        showPwaMsg('error', error.message);
        return;
      }
      hidePwaLogin();
      window.location.reload();
    };
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'appleSignInNative' }));
    // Safety: if the native side never responds (e.g. sheet dismissed in a
    // way that produced no callback), clear the stuck loading state.
    setTimeout(function () {
      if (window.__ryxaAppleAuthResult) {
        window.__ryxaAppleAuthResult = null;
        setPwaAuthBtnLoading('pwa-apple-btn', false);
      }
    }, 120000);
    return;
  }

  startPwaAppleWebFlow();
}

// Web-browser Apple sign-in (Supabase OAuth redirect). Also the in-app
// fallback if the native Apple API is unavailable on the device.
async function startPwaAppleWebFlow() {
  var inApp = !!(window.RyxaNative && window.ReactNativeWebView);
  var { data, error } = await sb.auth.signInWithOAuth({
    provider: 'apple',
    options: {
      redirectTo: 'https://ryxa.io/dashboard.html',
      skipBrowserRedirect: inApp
    }
  });
  if (error) {
    setPwaAuthBtnLoading('pwa-apple-btn', false);
    showPwaMsg('error', error.message);
    return;
  }
  if (inApp && data && data.url) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'openSheet', url: data.url }));
    armPwaSheetWatchdog();
  }
}

async function handlePwaAuth() {
  var email = document.getElementById('pwa-email').value.trim();
  var password = document.getElementById('pwa-password').value;
  var btn = document.getElementById('pwa-submit-btn');
  if (!email || !password) { showPwaMsg('error', 'Please enter your email and password.'); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="auth-spinner"></span>' + (pwaAuthMode === 'signin' ? 'Signing in...' : 'Creating account...');
  var captchaToken;
  try {
    captchaToken = await getPwaTurnstileToken();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = pwaAuthMode === 'signin' ? 'Sign in' : 'Create account';
    showPwaMsg('error', err.message || 'Verification failed. Please try again.');
    resetPwaTurnstile();
    return;
  }
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
    // Anti-enumeration: an email that already has an account comes back from
    // Supabase as a user object with an empty identities array and no session
    // (no signup occurs; Supabase emails that user a "did you mean to sign
    // in?" nudge). That shape falls into the same generic branch below on
    // purpose, a distinct "already exists" message would let anyone probe
    // which emails have Ryxa accounts.
    if (result.data?.user && !result.data.session) {
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
  showPwaMsg('success', 'Sending...');
  var captchaToken;
  try {
    captchaToken = await getPwaTurnstileToken();
  } catch (err) {
    showPwaMsg('error', err.message || 'Verification failed. Please try again.');
    resetPwaTurnstile();
    return;
  }
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

// Backward-compatible alias - many places in code call formatDashUSD
// ---------------------------------------------------------------------------
// Chart series: fill the gaps.
//
// The stats RPCs return one row per day that HAS data, not one row per day in
// the requested range. A chart drawn straight from that array silently omits
// quiet days: four data points get stretched across a 30-day axis and read as
// a month of steady traffic. A zero day and a missing day also render
// identically, which they should not.
//
// Every analytics product zero-fills. This is the client-side version of the
// generate_series() left join the RPC would ideally do itself.
//
//   daily  : [{ date: 'YYYY-MM-DD', <key>: n }, ...]  sparse, ascending
//   start  : 'YYYY-MM-DD'  inclusive
//   end    : 'YYYY-MM-DD'  inclusive
//   key    : the value field, e.g. 'count' or 'cents'
function densifyDailySeries(daily, start, end, key) {
  if (!start || !end) return daily || [];

  var byDate = {};
  (daily || []).forEach(function (row) {
    if (row && row.date) byDate[String(row.date).slice(0, 10)] = row;
  });

  // Iterate in UTC at noon: adding days at midnight can skip or repeat a date
  // when the browser's zone crosses a DST boundary.
  var out = [];
  var p = start.split('-');
  var cur = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
  var last = end.split('-');
  var stop = new Date(Date.UTC(+last[0], +last[1] - 1, +last[2], 12));
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var guard = 0;

  while (cur <= stop && guard++ < 400) {
    var ymd = cur.getUTCFullYear() + '-' + pad(cur.getUTCMonth() + 1) + '-' + pad(cur.getUTCDate());
    var row = byDate[ymd];
    if (row) {
      out.push(row);
    } else {
      var filled = { date: ymd };
      filled[key] = 0;
      out.push(filled);
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Save verification
//
// supabase-js returns { data: null, error: null } for an UPDATE that matched
// ZERO rows. It is byte-identical to a successful one. So a save blocked by
// RLS, or aimed at a row that no longer exists, returns "success" and the UI
// says "Saved" while nothing was written.
//
// This is not hypothetical: signing into a second account in another tab
// swaps the shared session, every subsequent update matches zero rows under
// auth.uid() = user_id, and the dashboard cheerfully reports saving for as
// long as you keep typing.
//
// The fix is to ask which rows were touched (.select() on the chain) and treat
// an empty result as a failure. Every update in this app targets a specific
// row by id or user_id, so zero rows always means something is wrong.
//
//   const res = await sb.from('courses')
//     .update(payload)
//     .eq('id', courseId)
//     .select('id');            // <- ask
//   assertSaved(res, 'course');  // <- verify
function assertSaved(res, what) {
  if (res && res.error) throw new Error(res.error.message);
  if (!res || !res.data || res.data.length === 0) {
    throw new Error(
      'Nothing was saved' + (what ? ' (' + what + ')' : '') +
      '. You may have been signed out, or this item was deleted. Reload and try again.'
    );
  }
  return res.data;
}

// Bulk variant: a partial write is not a success. Reordering ten links and
// writing three of them is a corrupted list, not a saved one.
function assertAllSaved(res, expected, what) {
  var rows = assertSaved(res, what);
  if (rows.length !== expected) {
    throw new Error(
      'Only ' + rows.length + ' of ' + expected + ' items saved' +
      (what ? ' (' + what + ')' : '') + '. Reload and try again.'
    );
  }
  return rows;
}

function formatDashUSD(cents) {
  return formatMoney(cents, { alwaysShowCents: true });
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
  { key:'instagram', label:'Instagram', placeholder:'yourhandle', type:'username', urlBase:'instagram.com/',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.22.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.05.41 2.22.06 1.26.07 1.64.07 4.82s-.01 3.57-.07 4.82c-.05 1.17-.25 1.8-.41 2.22a3.72 3.72 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.05.36-2.22.41-1.26.06-1.64.07-4.82.07s-3.57-.01-4.82-.07c-1.17-.05-1.8-.25-2.22-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.05-.41-2.22C2.21 15.57 2.2 15.19 2.2 12s.01-3.57.07-4.82c.05-1.17.25-1.8.41-2.22.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.05-.36 2.22-.41C8.43 2.21 8.81 2.2 12 2.2M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.92 5.92 0 0 0-2.13 1.39A5.92 5.92 0 0 0 .62 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.06 1.27.26 2.15.56 2.91a5.92 5.92 0 0 0 1.39 2.13c.66.66 1.32 1.06 2.13 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 1.27-.06 2.15-.26 2.91-.56a5.92 5.92 0 0 0 2.13-1.39c.66-.66 1.06-1.32 1.39-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.92 5.92 0 0 0-1.39-2.13A5.92 5.92 0 0 0 19.86.62c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.88a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"/></svg>' },
  { key:'tiktok', label:'TikTok', placeholder:'yourhandle', type:'username', urlBase:'tiktok.com/@',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.9a4.85 4.85 0 0 1-1.84-.21Z"/></svg>' },
  { key:'x', label:'X', placeholder:'yourhandle', type:'username', urlBase:'x.com/',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93Zm-1.29 19.5h2.04L6.48 3.24H4.3L17.61 20.65Z"/></svg>' },
  { key:'threads', label:'Threads', placeholder:'yourhandle', type:'username', urlBase:'threads.net/@',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.3 11.2c-.1-.05-.2-.1-.3-.14-.18-3.27-1.96-5.14-4.96-5.16-2.04-.01-3.73.85-4.77 2.43l1.84 1.26c.78-1.18 2-1.43 2.94-1.43h.03c1.17.01 2.05.35 2.62 1.01.41.49.69 1.16.82 2-1-.17-2.08-.22-3.24-.15-3.26.19-5.36 2.09-5.22 4.73.07 1.34.74 2.49 1.88 3.24.97.63 2.21.94 3.5.87 1.71-.09 3.05-.74 3.99-1.93.71-.9 1.16-2.07 1.36-3.54.81.49 1.41 1.13 1.74 1.91.57 1.32.6 3.49-1.17 5.26-1.55 1.55-3.42 2.22-6.24 2.24-3.13-.02-5.5-1.03-7.04-2.99C2.83 17.61 2.09 15.04 2.06 12c.03-3.04.77-5.61 2.19-7.42C5.79 2.62 8.16 1.61 11.29 1.59c3.15.02 5.56 1.04 7.16 3.02.79.98 1.38 2.21 1.77 3.65l2.16-.58c-.47-1.77-1.21-3.3-2.23-4.55C18.26 1.94 15.31.65 11.3.63h-.01C7.29.65 4.37 1.94 2.62 4.49 1.06 6.76.25 9.91.21 13.99v.02c.04 4.08.85 7.24 2.41 9.51 1.75 2.55 4.67 3.84 8.68 3.86h.01c3.57-.02 6.08-.96 8.15-3.03 2.71-2.71 2.63-6.1 1.74-8.19-.64-1.5-1.86-2.72-3.53-3.53Zm-5.43 5.66c-1.43.08-2.91-.56-2.99-1.95-.05-1.03.74-2.18 3.08-2.31.27-.02.53-.02.79-.02.85 0 1.64.08 2.36.24-.27 3.35-1.84 3.97-3.24 4.04Z"/></svg>' },
  { key:'youtube', label:'YouTube', placeholder:'Paste your full channel URL', type:'url',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.54 3.58 12 3.58 12 3.58s-7.54 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3 3 0 0 0 2.1 2.12c1.86.5 9.4.5 9.4.5s7.54 0 9.4-.5a3 3 0 0 0 2.1-2.12C24 15.93 24 12 24 12s0-3.93-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"/></svg>' },
  { key:'facebook', label:'Facebook', placeholder:'Paste your full page URL', type:'url',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>' },
  { key:'snapchat', label:'Snapchat', placeholder:'yourhandle', type:'username', urlBase:'snapchat.com/add/',
    svg:'<svg viewBox="-4.4 -2.25 24 24" aria-hidden="true"><path d="M12.02 0C5.44 0 4.73 5.08 4.86 7.15c.03.5.05 1.01.06 1.52-.3.16-.79.38-1.29.38-.38 0-.75-.14-1.08-.41-.06-.05-.17-.14-.35-.14-.3 0-.65.17-.92.47-.3.34-.3.78.02 1.08.27.26.7.48 1.2.62.68.19 1.56.49 1.79 1.04.13.3-.01.69-.41 1.17a.35.35 0 0 1-.03.03c-.01.02-1.28 2.08-4.21 2.56-.22.04-.38.24-.36.46 0 .05.02.1.04.15.13.3.56.52 1.32.68.08.02.14.11.17.3.03.18.07.4.17.63.1.23.29.35.55.35.14 0 .3-.03.48-.06.25-.05.57-.11.96-.11.22 0 .44.02.68.06.45.07.83.34 1.27.65.63.45 1.35.96 2.43.96.08 0 .17 0 .26-.02.08.01.2.02.33.02 1.08 0 1.8-.51 2.43-.96.44-.31.82-.58 1.27-.65.24-.04.46-.06.68-.06.38 0 .68.05.96.11.2.04.36.06.48.06h.02c.19 0 .41-.08.53-.35.1-.22.14-.43.17-.62.02-.17.09-.28.17-.3.76-.16 1.19-.38 1.32-.68a.43.43 0 0 0 .04-.15c.02-.22-.14-.42-.36-.46-2.93-.48-4.2-2.54-4.21-2.56a.57.57 0 0 1-.03-.03c-.4-.48-.54-.87-.41-1.17.23-.55 1.11-.85 1.79-1.04.5-.14.93-.36 1.2-.62.33-.32.33-.76.03-1.08-.28-.3-.63-.47-.92-.47-.19 0-.3.08-.35.14-.32.26-.69.41-1.08.41-.5 0-.99-.22-1.29-.38.01-.51.03-1.02.06-1.52.13-2.07-.58-7.15-7.16-7.15Z"/></svg>' },
  { key:'linkedin', label:'LinkedIn', placeholder:'yourname', type:'username', urlBase:'linkedin.com/in/',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.26 2.37 4.26 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"/></svg>' },
  { key:'pinterest', label:'Pinterest', placeholder:'yourhandle', type:'username', urlBase:'pinterest.com/',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>' },
  { key:'twitch', label:'Twitch', placeholder:'yourhandle', type:'username', urlBase:'twitch.tv/',
    svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>' },
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
  // Lock background scroll with overflow:hidden ONLY. Do not set the body to
  // position:fixed: that collapses the body and makes iOS yank both the page
  // content and the fixed bottom bar to the top when the page was scrolled.
  // overflow:hidden freezes scrolling in place without moving anything.
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  closeSidebarMenu();
}

function toggleSidebarMenu() {
  var menu = document.getElementById('sidebar-user-menu');
  if (menu) {
    var willOpen = menu.style.display === 'none';
    if (willOpen) { renderAiUsage(); renderFileStorage(); }  // synchronous render from cache, before showing menu
    menu.style.display = willOpen ? 'block' : 'none';
    if (willOpen) { fetchAiUsage(); fetchFileStorage(); }   // refresh in background for next open
  }
}
function closeSidebarMenu() {
  var menu = document.getElementById('sidebar-user-menu');
  if (menu) menu.style.display = 'none';
}

// AI usage state - cached so the menu opens instantly with no layout shift.
window._aiUsageCache = null;

// File storage state - cached so the menu opens instantly, mirroring AI usage.
window._fileStorageCache = null;
window.FILE_STORAGE_MAX_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB shared cap

function fsFormatBytes(bytes) {
  if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Render the File Storage bar from cache. Synchronous, no fetch.
function renderFileStorage() {
  var box = document.getElementById('sidebar-file-storage');
  if (!box) return;
  box.style.display = 'block';
  var used = window._fileStorageCache;
  var max = window.FILE_STORAGE_MAX_BYTES;
  // Before the first fetch returns, show a neutral placeholder rather than
  // hiding the box (avoids the box popping in a beat after the menu opens).
  if (used == null) {
    var barP = document.getElementById('sidebar-storage-bar');
    var pctP = document.getElementById('sidebar-storage-pct');
    var countP = document.getElementById('sidebar-storage-count');
    if (barP) { barP.style.width = '0%'; barP.style.background = 'var(--muted)'; }
    if (pctP) { pctP.textContent = '—'; pctP.style.color = 'var(--muted)'; }
    if (countP) countP.textContent = 'Loading…';
    return;
  }
  var pct = Math.min(100, Math.round((used / max) * 100));
  var color = pct < 60 ? '#22c55e' : (pct < 85 ? '#eab308' : '#ef4444');
  var bar = document.getElementById('sidebar-storage-bar');
  var pctEl = document.getElementById('sidebar-storage-pct');
  var countEl = document.getElementById('sidebar-storage-count');
  if (bar) { bar.style.width = pct + '%'; bar.style.background = color; }
  if (pctEl) { pctEl.textContent = pct + '%'; pctEl.style.color = color; }
  if (countEl) countEl.textContent = fsFormatBytes(used) + ' / 10 GB';
}

// Fetch storage from server and update cache. Single RPC shared with the
// course/product upload validators.
async function fetchFileStorage() {
  try {
    var { data, error } = await sb.rpc('get_creator_storage_used');
    if (error) { window._fileStorageCache = null; }
    else { window._fileStorageCache = Number(data || 0); }
    var menu = document.getElementById('sidebar-user-menu');
    if (menu && menu.style.display !== 'none') renderFileStorage();
  } catch (e) {
    console.error('fetchFileStorage failed:', e);
  }
}
window.fetchFileStorage = fetchFileStorage;
window.renderFileStorage = renderFileStorage;

// Fetch AI usage from server and update cache.
// Safe to call repeatedly - it's a single indexed COUNT query.
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
// Free tier shows a locked state with an upgrade CTA - drives upsell visibility.
// Pro/Max tier shows the live counter.
function renderAiUsage() {
  var box = document.getElementById('sidebar-ai-usage');
  if (!box) return;
  var data = window._aiUsageCache;

  // No cache yet - keep box hidden until first fetch returns
  if (!data || data.hidden) { box.style.display = 'none'; return; }

  var bar = document.getElementById('sidebar-ai-bar');
  var pctEl = document.getElementById('sidebar-ai-pct');
  var countEl = document.getElementById('sidebar-ai-count');
  var resetEl = document.getElementById('sidebar-ai-reset');
  var lockEl = document.getElementById('sidebar-ai-lock');
  var upgradeBtn = document.getElementById('sidebar-ai-upgrade');

  var limit = Number(data.limit || 0);

  // FREE TIER - locked state, drive upgrade
  if (limit === 0) {
    var teaserLimit = 40;  // show what they'd get on Pro
    bar.style.width = '0%';
    bar.style.background = 'var(--muted)';
    pctEl.textContent = '';
    pctEl.style.color = 'var(--muted)';
    countEl.textContent = '0 / ' + teaserLimit + ' calls';
    countEl.style.opacity = '0.6';
    resetEl.textContent = '';
    if (lockEl) lockEl.style.display = '';
    if (upgradeBtn) upgradeBtn.style.display = 'block';
    box.style.display = 'block';
    return;
  }

  // PRO / MAX - live counter
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

// Absolute failsafe: if the loading spinner is somehow still up after 12s (e.g. a
// request inside setUser that never resolves), force-reveal so the user is never
// stuck. Skips the case where the auth retry UI is already showing.
setTimeout(function() {
  var dl = document.getElementById('dash-loading');
  if (dl && dl.style.display !== 'none' && !dl.querySelector('[data-dash-action="reload"]')) {
    dl.style.display = 'none';
    var wc = document.getElementById('welcome-content');
    if (wc) { wc.style.display = ''; wc.classList.add('dash-fade-in'); }
  }
}, 12000);


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



// PWA Install - Chrome: deferred prompt, iOS: instruction modal
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
    // Chrome/Android - use native prompt
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(function(result) {
      deferredInstallPrompt = null;
    });
  } else if (isIos) {
    // iOS - show instruction modal
    openInstallModal();
  } else {
    // Desktop/other with no prompt available - already installed or not supported
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

// Brand Deal CRM - delete modal click-outside-to-close (attached after DOMContentLoaded since modal is below)
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
dashRegisterAction('terms-logout', () => termsLogout());

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

// Pro upsell modal - triggered by showProUpsell() for Pro-locked features
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

// Tool navigation - generic show-tool, reads target from data-dash-tool attribute.
// Used by every sidebar tool button. Follower has its own wrapper that does
// extra setup (showFollowerTool) so it's a separate action.
dashRegisterAction('show-tool', (e, el) => {
  // preventDefault so anchor-tag triggers (e.g. the "Change in Settings"
  // link inside the coaching tz hint) don't navigate to #. Buttons ignore
  // this no-op call. Without it, clicking the tz hint link would change
  // the URL from /dashboard to /dashboard# on every click.
  if (e && e.preventDefault) e.preventDefault();
  // Optional: land on Settings' Calendar section (same behavior as the
  // calendar's gear button), used by links that point at the timezone setting.
  if (el.dataset.dashScrollCalendar === '1') window._scrollToCalendarSettings = true;
  if (typeof showTool === 'function') showTool(el.dataset.dashTool);
});

// Bottom-nav "Plans" button (replaces the old Subscribers slot). Tier-aware:
// free users go to the in-dashboard Plans & Billing page; paid users, whose
// button reads "Media Kit", go to the Media Kit tool. The label/behavior swap
// is applied in updateTierUI once tier is known; this handler routes by the
// current tier at click time as the source of truth.
dashRegisterAction('show-plans-nav', (e, el) => {
  if (e && e.preventDefault) e.preventDefault();
  if (isPro()) {
    // Paid: acts as the Media Kit entry point. showTool highlights nav-mediakit
    // (hidden here), but the button actually tapped is bnav-plans, so light it
    // explicitly and clear the other bottom-nav tabs.
    if (typeof showTool === 'function') showTool('mediakit');
    document.querySelectorAll('.mobile-bottom-nav-item.active')
      .forEach(function (b) { b.classList.remove('active'); });
    var _bp = document.getElementById('bnav-plans');
    if (_bp) _bp.classList.add('active');
    if (typeof positionBnavPill === 'function') positionBnavPill();
  } else {
    // Free: open the Plans & Billing page via its hash route.
    if (window.location.hash !== '#plans-billing') {
      window.location.hash = 'plans-billing';
    } else if (typeof plansBillingRouteCheck === 'function') {
      plansBillingRouteCheck();
    }
    // Highlight the Plans tab. It sits outside the tool system (hash route), so
    // clear any tool-driven bnav highlight, then light this one.
    document.querySelectorAll('.mobile-bottom-nav-item.active')
      .forEach(function (b) { b.classList.remove('active'); });
    var _pb = document.getElementById('bnav-plans');
    if (_pb) _pb.classList.add('active');
    if (typeof positionBnavPill === 'function') positionBnavPill();
  }
});

dashRegisterAction('toggle-analytics-menu', (e, el) => {
  const submenu = document.getElementById('nav-analytics-submenu');
  const expanded = el.getAttribute('aria-expanded') === 'true';
  el.setAttribute('aria-expanded', expanded ? 'false' : 'true');
  if (submenu) submenu.classList.toggle('open', !expanded);
  if (!expanded) {
    // Expanding: menu focus moves to Analytics. Clear every other sidebar
    // pill and light this toggle. No navigation happens here.
    document.querySelectorAll('.sidebar-item.active').forEach(function (it) {
      if (it !== el) it.classList.remove('active');
    });
    el.classList.add('active');
  } else {
    // Collapsing: the toggle stays lit only if one of its views is the
    // currently open tool.
    const childActive = submenu && submenu.querySelector('.active');
    el.classList.toggle('active', !!childActive);
  }
});
dashRegisterAction('show-follower', () => {
  if (typeof showFollowerTool === 'function') showFollowerTool();
});

dashRegisterAction('onboarding-choose', (e, el) => {
  var tool = el && el.dataset ? (el.dataset.onbTool || '') : '';
  onboardingChoose(tool);
});

// Sidebar account menu (the popup at bottom-left)
dashRegisterAction('toggle-sidebar-menu', () => toggleSidebarMenu());
dashRegisterAction('close-sidebar-menu', () => closeSidebarMenu());

// Sidebar utility - "Copy bio link" button (calls into bio.js)
dashRegisterAction('copy-sidebar-bio-link', () => copySidebarBioLink());
dashRegisterAction('copy-welcome-bio-link', () => copyWelcomeBioLink());
dashRegisterAction('go-connect-stripe', () => {
  if (typeof showTool === 'function') showTool('settings');
  setTimeout(() => {
    const target = document.getElementById('settings-stripe-section');
    if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
});
// Stripe nudge: permanent dismiss (per-device, localStorage). Overrides the Stripe-status check.
function isStripeNudgeDismissed() {
  try { return localStorage.getItem('ryxa_stripe_nudge_dismissed') === '1'; } catch (e) { return false; }
}
dashRegisterAction('dismiss-stripe-nudge', () => {
  try { localStorage.setItem('ryxa_stripe_nudge_dismissed', '1'); } catch (e) {}
  const n = document.getElementById('dash-stripe-nudge');
  if (n) n.style.display = 'none';
});

// Compound actions - these combine menu-close with another action so the menu
// closes when navigating away (mimics the original inline `a();b();` pattern).
dashRegisterAction('sidebar-upgrade-pro', (e, el) => {
  closeSidebarMenu();
  goToPricing('pro');
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
// Upgrade banner buttons (above the tool area). Both route to the pricing
// page where the user picks plan + billing cycle.
dashRegisterAction('checkout-pro', () => goToPricing('pro'));
dashRegisterAction('checkout-max', () => goToPricing('max'));

// =============================================================================
// PWA LOGIN SCREEN ACTIONS
// -----------------------------------------------------------------------------
// Sign in / Sign up tab toggles, Google OAuth, forgot password, submit.
// =============================================================================
dashRegisterAction('pwa-auth-mode-signin', () => setPwaAuthMode('signin'));
dashRegisterAction('pwa-auth-mode-signup', () => setPwaAuthMode('signup'));
dashRegisterAction('pwa-google-auth', () => handlePwaGoogleAuth());
dashRegisterAction('pwa-apple-auth', () => handlePwaAppleAuth());
dashRegisterAction('pwa-show-email-form', () => showPwaEmailForm());
dashRegisterAction('pwa-toggle-diag', () => togglePwaDiag());
dashRegisterAction('pwa-forgot-password', () => handlePwaForgotPassword());
dashRegisterAction('pwa-auth', () => handlePwaAuth());
