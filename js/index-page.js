// =================================================================
// Ryxa homepage - extracted from index.html inline <script> blocks for CSP.
//
// CSP rules applied to / (set by vercel.json):
//   - No inline <script> tags
//   - No inline event handlers (onclick=, etc.)
// Every interaction is wired through the delegation framework below,
// keyed by data-home-action attributes in HTML.
// =================================================================

// -------- DELEGATION FRAMEWORK --------
var homeActionHandlers = {};
function homeRegisterAction(name, fn) { homeActionHandlers[name] = fn; }

document.addEventListener('click', function(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-home-action]') : null;
  if (!el) return;
  var action = el.getAttribute('data-home-action');
  var h = homeActionHandlers[action];
  if (h) h(e, el);
});

// =================================================================
// AUTH MODAL + TESTIMONIALS (originally inline at L1898-2211)
// =================================================================

// Testimonials: scroll left/right
function scrollTestimonials(dir) {
  const track = document.getElementById('testimonials-track');
  if (!track) return;
  const card = track.querySelector('.testimonial-card');
  const scrollAmount = card ? card.offsetWidth + 20 : 400;
  const maxScroll = track.scrollWidth - track.clientWidth;
  if (dir === -1 && track.scrollLeft <= 0) return;
  if (dir === 1 && track.scrollLeft >= maxScroll - 1) return;
  track.scrollBy({ left: dir * scrollAmount, behavior: 'smooth' });
}

// Desktop drag-to-scroll
document.addEventListener('DOMContentLoaded', () => {
  const track = document.getElementById('testimonials-track');
  if (!track) return;
  let isDown = false, startX, scrollStart;
  track.addEventListener('mousedown', (e) => {
    isDown = true;
    track.style.cursor = 'grabbing';
    startX = e.pageX - track.offsetLeft;
    scrollStart = track.scrollLeft;
    e.preventDefault();
  });
  track.addEventListener('mouseleave', () => { isDown = false; track.style.cursor = 'grab'; });
  track.addEventListener('mouseup', () => { isDown = false; track.style.cursor = 'grab'; });
  track.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    const x = e.pageX - track.offsetLeft;
    const walk = (x - startX) * 1.5;
    track.scrollLeft = scrollStart - walk;
  });
  track.style.cursor = 'grab';

  // Mobile only: zoom background on the most visible card
  if (window.innerWidth <= 600) {
    const cards = track.querySelectorAll('.testimonial-card');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        entry.target.classList.toggle('testimonial-active', entry.isIntersecting);
      });
    }, { root: track, threshold: 0.6 });
    cards.forEach(card => observer.observe(card));
  }
});

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let authMode = 'signin';
let currentUser = null;

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) { currentUser = session.user; window.location.href = 'dashboard.html'; return; }
  sb.auth.onAuthStateChange((_event, session) => {
    if (_event === 'SIGNED_IN' && session?.user) window.location.href = 'dashboard.html';
  });
}

function requireAuth(e) { if (!currentUser) { e.preventDefault(); openAuthModal(); } }

// =====================
// AUTH MODAL: focus trap, inert background, focus return (WAI-ARIA Dialog pattern)
// Uses a focusin listener on document — fires for ANY focus change (including
// after Tab moves into iframes like Cloudflare Turnstile and out the other side).
// If focus lands outside the modal while it's open, redirect it back inside.
// =====================
let _authModalLastFocus = null;

function _authModalGetFocusable() {
  const modal = document.querySelector('#auth-modal .modal');
  if (!modal) return [];
  return Array.from(modal.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
  )).filter(el => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

function _authModalIsOpen() {
  const m = document.getElementById('auth-modal');
  return m && m.classList.contains('open');
}

function _authModalEnforceFocus(e) {
  if (!_authModalIsOpen()) return;
  const modal = document.getElementById('auth-modal');
  // If focus moved to something outside the modal, pull it back
  if (e.target && modal && !modal.contains(e.target)) {
    e.stopPropagation();
    const focusable = _authModalGetFocusable();
    if (focusable.length) focusable[0].focus();
  }
}

function _authModalTrapTab(e) {
  if (e.key !== 'Tab' || !_authModalIsOpen()) return;
  const focusable = _authModalGetFocusable();
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  // If active element isn't in our list (e.g. focus is inside an iframe),
  // bail — the focusin handler will catch the boundary.
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

function _authModalSetBackgroundInert(on) {
  // Make everything outside the modal unreachable to keyboard / screen readers
  document.querySelectorAll('body > *').forEach(el => {
    if (el.id === 'auth-modal' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
    if (on) {
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
    }
  });
}

function _authModalAttachListeners() {
  document.addEventListener('keydown', _authModalTrapTab);
  document.addEventListener('focusin', _authModalEnforceFocus, true);
}

function _authModalDetachListeners() {
  document.removeEventListener('keydown', _authModalTrapTab);
  document.removeEventListener('focusin', _authModalEnforceFocus, true);
}

function openAuthModal() {
  _authModalLastFocus = document.activeElement;
  authMode = 'signin'; syncAuthModal();
  document.getElementById('auth-modal').classList.add('open');
  _authModalSetBackgroundInert(true);
  setTimeout(() => document.getElementById('auth-email')?.focus(), 100);
  _authModalAttachListeners();
  renderTurnstileWidget();
}

function openSignupModal() {
  _authModalLastFocus = document.activeElement;
  authMode = 'signup'; syncAuthModal();
  document.getElementById('auth-modal').classList.add('open');
  _authModalSetBackgroundInert(true);
  setTimeout(() => document.getElementById('auth-email')?.focus(), 100);
  _authModalAttachListeners();
  renderTurnstileWidget();
}

// Open signup modal if URL has #signup OR ?action=signup (from external page links)
// Also supports ?action=signin
window.addEventListener('load', () => {
  if (currentUser) return;
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  if (window.location.hash === '#signup' || action === 'signup') {
    setTimeout(openSignupModal, 300);
  } else if (action === 'signin') {
    setTimeout(openAuthModal, 300);
  }
});

function closeAuthModal() {
  document.getElementById('auth-modal').classList.remove('open');
  _authModalSetBackgroundInert(false);
  _authModalDetachListeners();
  const el = document.getElementById('auth-msg'); if (el) el.style.display = 'none';
  const btn = document.getElementById('auth-submit-btn'); if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
  // Return focus to whatever opened the modal
  if (_authModalLastFocus && typeof _authModalLastFocus.focus === 'function') {
    try { _authModalLastFocus.focus(); } catch (e) {}
  }
  _authModalLastFocus = null;
}

function syncAuthModal() {
  const isSignIn = authMode === 'signin';
  document.getElementById('auth-submit-btn').textContent = isSignIn ? 'Sign in' : 'Create account';
  document.getElementById('auth-msg').style.display = 'none';
  const fl = document.getElementById('forgot-password-link'); if (fl) fl.style.display = isSignIn ? 'block' : 'none';
  // Update tab active states
  const signinTab = document.getElementById('auth-tab-signin');
  const signupTab = document.getElementById('auth-tab-signup');
  if (signinTab) signinTab.classList.toggle('active', isSignIn);
  if (signupTab) signupTab.classList.toggle('active', !isSignIn);
  // Update password autocomplete hint to help browser pickers
  const pw = document.getElementById('auth-password');
  if (pw) pw.setAttribute('autocomplete', isSignIn ? 'current-password' : 'new-password');
}

function setAuthMode(mode) { authMode = mode; syncAuthModal(); }

function toggleAuthMode() { authMode = authMode === 'signin' ? 'signup' : 'signin'; syncAuthModal(); }

function showAuthMsg(type, msg) {
  const el = document.getElementById('auth-msg'); if (!el) return;
  el.style.display = 'block'; el.className = 'modal-msg ' + type; el.textContent = msg;
}

// Cloudflare Turnstile (invisible + execute mode)
// Mode is set to "Invisible" on the Cloudflare dashboard for this sitekey, and
// execution:'execute' here means the proof-of-work challenge only runs when we
// explicitly call turnstile.execute() — not at widget render time. This avoids
// the multi-second mobile main-thread freeze that the visible/managed mode
// caused when the modal opened. The PoW now runs inside the submit spinner,
// which the user already perceives as normal auth latency.
const TURNSTILE_SITE_KEY = '0x4AAAAAAC9W8avdI3sdVEcc';
let turnstileWidgetId = null;
let _turnstilePendingResolve = null;
let _turnstilePendingReject = null;

function renderTurnstileWidget() {
  if (typeof turnstile === 'undefined') {
    // Script not loaded yet — try again shortly
    setTimeout(renderTurnstileWidget, 200);
    return;
  }
  const container = document.getElementById('auth-turnstile');
  if (!container) return;
  // If already rendered, reset instead of re-rendering
  if (turnstileWidgetId !== null) {
    try { turnstile.reset(turnstileWidgetId); } catch (e) {}
    return;
  }
  turnstileWidgetId = turnstile.render('#auth-turnstile', {
    sitekey: TURNSTILE_SITE_KEY,
    execution: 'execute',
    callback: function(token) {
      if (_turnstilePendingResolve) {
        const resolve = _turnstilePendingResolve;
        _turnstilePendingResolve = null;
        _turnstilePendingReject = null;
        resolve(token);
      }
    },
    'error-callback': function() {
      if (_turnstilePendingReject) {
        const reject = _turnstilePendingReject;
        _turnstilePendingResolve = null;
        _turnstilePendingReject = null;
        reject(new Error('Verification failed. Please try again.'));
      }
    },
  });
}

// Returns a Promise<string> that resolves with a Turnstile token. The PoW runs
// inside this call, so callers must already be in a loading state when awaiting.
function getTurnstileToken() {
  return new Promise(function(resolve, reject) {
    if (typeof turnstile === 'undefined' || turnstileWidgetId === null) {
      reject(new Error('Verification not ready. Please try again.'));
      return;
    }
    // If a token is already available (e.g. cached from a recent execute), use it
    try {
      const existing = turnstile.getResponse(turnstileWidgetId);
      if (existing) { resolve(existing); return; }
    } catch (e) {}
    // Otherwise execute the challenge — token arrives via callback
    _turnstilePendingResolve = resolve;
    _turnstilePendingReject = reject;
    try {
      turnstile.execute(turnstileWidgetId);
    } catch (e) {
      _turnstilePendingResolve = null;
      _turnstilePendingReject = null;
      reject(e);
    }
  });
}

function resetTurnstile() {
  if (typeof turnstile !== 'undefined' && turnstileWidgetId !== null) {
    try { turnstile.reset(turnstileWidgetId); } catch (e) {}
  }
  _turnstilePendingResolve = null;
  _turnstilePendingReject = null;
}

async function handleGoogleAuth() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'https://ryxa.io/dashboard.html',
    },
  });
  if (error) showAuthMsg('error', error.message);
}

async function handleAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const btn = document.getElementById('auth-submit-btn');
  if (!email || !password) { showAuthMsg('error', 'Please enter your email and password.'); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="auth-spinner"></span>' + (authMode === 'signin' ? 'Signing in...' : 'Creating account...');
  let captchaToken;
  try {
    captchaToken = await getTurnstileToken();
  } catch (err) {
    btn.disabled = false; btn.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
    showAuthMsg('error', err.message || 'Verification failed. Please try again.');
    resetTurnstile();
    return;
  }
  const result = authMode === 'signin'
    ? await sb.auth.signInWithPassword({ email, password, options: { captchaToken } })
    : await sb.auth.signUp({ email, password, options: { captchaToken } });
  btn.disabled = false; btn.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
  // CAPTCHA token is single-use — always reset for next attempt
  resetTurnstile();
  if (result.error) { showAuthMsg('error', result.error.message); }
  else if (authMode === 'signup') {
    // Supabase returns a user object with empty identities array when email already exists
    // (this is intentional anti-enumeration behavior, no actual signup occurs).
    const identities = result.data?.user?.identities;
    if (identities && identities.length === 0) {
      showAuthMsg('error', 'An account with this email already exists. Try signing in instead.');
    } else {
      showAuthMsg('success', 'Check your email to confirm your account!');
    }
  }
  else {
    closeAuthModal();
    // Honor ?redirect=... if provided (used by gated pages like follower-audit).
    // Only allow same-origin relative paths to prevent open-redirect abuse.
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    const safe = redirect && redirect.startsWith('/') && !redirect.startsWith('//');
    window.location.href = safe ? redirect : 'dashboard.html';
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('auth-email').value.trim();
  if (!email) { showAuthMsg('error', 'Enter your email address above first.'); return; }
  const link = document.getElementById('forgot-password-link');
  const originalText = link ? link.textContent : '';
  if (link) { link.disabled = true; link.textContent = 'Sending...'; }
  let captchaToken;
  try {
    captchaToken = await getTurnstileToken();
  } catch (err) {
    if (link) { link.disabled = false; link.textContent = originalText || 'Forgot password?'; }
    showAuthMsg('error', err.message || 'Verification failed. Please try again.');
    resetTurnstile();
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://ryxa.io/reset-password.html', captchaToken });
  if (link) { link.disabled = false; link.textContent = originalText || 'Forgot password?'; }
  resetTurnstile();
  if (error) showAuthMsg('error', error.message);
  else showAuthMsg('success', 'Password reset email sent! Check your inbox.');
}

// Auth modal stays open until user explicitly closes via X button (prevents accidental dismiss while typing credentials)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAuthModal();
  if (e.key === 'Enter' && document.getElementById('auth-modal').classList.contains('open')) handleAuth();
});

// Mobile menu handled by site-nav.js

initAuth();


// =================================================================
// ACTION REGISTRATIONS
// =================================================================
homeRegisterAction('close-auth-modal', function() { closeAuthModal(); });
homeRegisterAction('auth-mode-signin', function() { setAuthMode('signin'); });
homeRegisterAction('auth-mode-signup', function() { setAuthMode('signup'); });
homeRegisterAction('google-auth', function() { handleGoogleAuth(); });
homeRegisterAction('forgot-password', function() { handleForgotPassword(); });
homeRegisterAction('auth', function() { handleAuth(); });
homeRegisterAction('open-signup', function() { openSignupModal(); });
homeRegisterAction('open-signin', function() { openAuthModal(); });
homeRegisterAction('scroll-testimonials-left', function() { scrollTestimonials(-1); });
homeRegisterAction('scroll-testimonials-right', function() { scrollTestimonials(1); });

// =================================================================
// BINARY RAIN ANIMATION (originally inline at L1226-1351)
// Decorative canvas animation, IIFE-wrapped
// =================================================================
  (function() {
    var canvas = document.getElementById('binary-rain');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W, H, columns, drops;
    function resize() {
      W = canvas.offsetWidth; H = canvas.offsetHeight;
      canvas.width = W * 2; canvas.height = H * 2;
      ctx.scale(2, 2);
      columns = Math.floor(W / 14);
      drops = [];
      for (var i = 0; i < columns; i++) drops[i] = Math.random() * -50;
    }
    resize();
    window.addEventListener('resize', resize);
    function draw() {
      ctx.fillStyle = 'rgba(10,10,20,0.12)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#7c3aed';
      ctx.font = '11px monospace';
      for (var i = 0; i < columns; i++) {
        var char = Math.random() > 0.5 ? '1' : '0';
        ctx.fillText(char, i * 14, drops[i] * 14);
        if (drops[i] * 14 > H && Math.random() > 0.97) drops[i] = 0;
        drops[i] += 0.4;
      }
      requestAnimationFrame(draw);
    }
    setTimeout(draw, 500);
  })();

  // Revenue counter animation
  (function() {
    var el = document.getElementById('rev-counter');
    var sparkCanvas = document.getElementById('rev-sparkline');
    if (!el || !sparkCanvas) return;
    var sCtx = sparkCanvas.getContext('2d');
    var points = [];
    var maxPoints = 30;

    function randomRange(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

    function runCycle() {
      var startVal = randomRange(120, 280);
      var endVal = randomRange(550, 850);
      var duration = randomRange(4000, 6000);
      var startTime = performance.now();
      points = [];

      function tick(now) {
        var elapsed = now - startTime;
        var progress = Math.min(elapsed / duration, 1);
        // Ease out cubic for natural feel
        var eased = 1 - Math.pow(1 - progress, 3);
        var current = startVal + (endVal - startVal) * eased;
        // Add small random jitter
        var jitter = (Math.random() - 0.5) * 8;
        var display = Math.round(current + jitter);
        el.textContent = '$' + display.toLocaleString();

        // Sparkline
        points.push(current);
        if (points.length > maxPoints) points.shift();
        drawSparkline();

        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          // Hold at peak briefly, then restart
          setTimeout(function() {
            el.style.transition = 'opacity 0.4s';
            el.style.opacity = '0.3';
            setTimeout(function() {
              el.style.opacity = '1';
              runCycle();
            }, 600);
          }, randomRange(1500, 3000));
        }
      }
      requestAnimationFrame(tick);
    }

    function drawSparkline() {
      var w = sparkCanvas.offsetWidth;
      var h = sparkCanvas.offsetHeight;
      var dpr = window.devicePixelRatio || 1;
      sparkCanvas.width = w * dpr;
      sparkCanvas.height = h * dpr;
      sCtx.scale(dpr, dpr);
      sCtx.clearRect(0, 0, w, h);
      if (points.length < 2) return;
      var min = Math.min.apply(null, points);
      var max = Math.max.apply(null, points);
      var range = max - min || 1;

      // Area fill
      sCtx.beginPath();
      points.forEach(function(v, i) {
        var x = (i / (maxPoints - 1)) * w;
        var y = h - ((v - min) / range) * (h - 4) - 2;
        if (i === 0) sCtx.moveTo(x, y); else sCtx.lineTo(x, y);
      });
      var lastX = ((points.length - 1) / (maxPoints - 1)) * w;
      sCtx.lineTo(lastX, h);
      sCtx.lineTo(0, h);
      sCtx.closePath();
      sCtx.fillStyle = 'rgba(167,139,250,0.08)';
      sCtx.fill();

      // Line
      sCtx.beginPath();
      points.forEach(function(v, i) {
        var x = (i / (maxPoints - 1)) * w;
        var y = h - ((v - min) / range) * (h - 4) - 2;
        if (i === 0) sCtx.moveTo(x, y); else sCtx.lineTo(x, y);
      });
      sCtx.strokeStyle = '#a78bfa';
      sCtx.lineWidth = 1.5;
      sCtx.lineJoin = 'round';
      sCtx.stroke();
    }

    setTimeout(runCycle, 1500);
  })();
