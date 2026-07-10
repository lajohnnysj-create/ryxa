// =================================================================
// Ryxa Hub (learn page) - extracted from learn/index.html inline <script> for CSP.
//
// CSP rules applied to /learn/* pages (set by vercel.json):
//   - No inline <script> tags
//   - No inline event handlers (onclick=, etc.)
// Every interaction is wired through the delegation framework below,
// keyed by data-learn-action attributes in HTML.
// =================================================================

// -------- DELEGATION FRAMEWORK --------
var learnActionHandlers = {};
function learnRegisterAction(name, fn) { learnActionHandlers[name] = fn; }

// Click delegation. Elements with <a> tags get e.preventDefault() automatically
// (replaces the inline ';return false;' pattern that was used throughout).
document.addEventListener('click', function(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-learn-action]') : null;
  if (!el) return;
  // Auto-prevent default on <a> tags so handlers don't need to worry about navigation.
  if (el.tagName === 'A') e.preventDefault();
  var action = el.getAttribute('data-learn-action');
  var h = learnActionHandlers[action];
  if (h) h(e, el);
});

// =================================================================
// ORIGINAL HUB CODE
// =================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
// autoRefreshToken stays OFF outside the dashboard. Only one page per
// origin may run the background refresh timer; multiple timers race for
// the single-use refresh token and trip Supabase reuse detection, which
// revokes the session (the random logout bug). Reads still refresh
// on demand when a real action needs a fresh token.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: false }
});

// Theme toggle
function toggleLearnTheme() {
  var isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('ryxa-learn-theme', isLight ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
}

function updateThemeMenuItem() {
  var label = document.getElementById('theme-menu-label');
  var isLight = document.body.classList.contains('light-mode');
  if (label) label.textContent = isLight ? 'Dark Mode' : 'Light Mode';
}

function toggleNavMenu() {
  var dd = document.getElementById('nav-menu-dropdown');
  if (dd) dd.classList.toggle('open');
}

document.addEventListener('click', function(e) {
  var dd = document.getElementById('nav-menu-dropdown');
  if (!dd) return;
  var wrap = dd.parentElement;
  if (wrap && !wrap.contains(e.target)) dd.classList.remove('open');
});

// Apply saved theme on load
(function() {
  var saved = localStorage.getItem('ryxa-learn-theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();

let currentUser = null;
let enrollments = [];
let viewerCourse = null;
let viewerModules = [];
let viewerLessons = [];
// Map of lessonId -> array of file rows { id, filename, file_size_bytes }.
// Loaded alongside lessons when a course viewer opens. Used by selectLesson
// to render a Downloads section per lesson, with download links that go
// through the /api/download-lesson-file endpoint (which enforces enrollment
// or free-preview status before returning a signed URL).
let viewerLessonFiles = {};
// Map of moduleId -> quiz row { id, module_id, course_id, require_pass,
// questions: [{id, text, answers: [{id, text}]}] }. is_correct is stripped
// at the database view layer (public_course_quizzes), so the client cannot
// know which answer is correct - that determination happens server-side in
// /api/grade-quiz. Each module has at most one quiz.
let viewerQuizzesByModule = {};
// Set of quiz_ids the current student has passed. Populated from
// course_quiz_passes for this enrollment. Used to gate the Next button
// when a require_pass quiz hasn't been passed yet.
let viewerPassedQuizIds = new Set();
let viewerProgress = [];
let viewerEnrollmentId = null;
let currentLessonId = null;
let authMode = 'signin';

// A buyer who clicked "Get for free" and landed on a login screen is not
// browsing: they are mid-transaction. Default them to Create Account and say
// why they are here. The Sign In tab is one click away for returning buyers.
//
// Both halves of this already existed. The redirect param was read (to send
// them back afterwards) and the tabs existed. Nothing connected them, so a
// first-time buyer met a Sign In form with no account and no explanation.
function applyLearnAuthContext() {
  var params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { return; }

  var redirect = params.get('redirect') || '';
  // Same validation as the redirect itself: relative paths only, never a
  // protocol-relative URL that would leave the site.
  if (!redirect.startsWith('/') || redirect.startsWith('//')) return;

  var msg;
  if (redirect.indexOf('/course/') === 0) msg = 'Create an account to get this course.';
  else if (redirect.indexOf('/booking/') === 0) msg = 'Create an account to book your session.';
  else if (redirect.indexOf('/product/') === 0) msg = 'Create an account to get this product.';
  else msg = 'Create an account to continue.';

  var box = document.getElementById('learn-auth-context');
  if (box) {
    // textContent, not innerHTML: the message is ours, but the habit is what
    // keeps a future version of this safe when the message is not.
    box.textContent = msg;
    box.style.display = 'block';
  }

  setLearnAuthMode('signup');
}

function setLearnAuthMode(mode) {
  authMode = mode;
  var signinTab = document.getElementById('learn-tab-signin');
  var signupTab = document.getElementById('learn-tab-signup');
  var btn = document.getElementById('auth-btn');
  if (mode === 'signin') {
    signinTab.style.background = 'var(--btn-bg)'; signinTab.style.color = 'var(--btn-text)';
    signupTab.style.background = 'transparent'; signupTab.style.color = 'var(--muted)';
    btn.textContent = 'Sign In';
  } else {
    signupTab.style.background = 'var(--btn-bg)'; signupTab.style.color = 'var(--btn-text)';
    signinTab.style.background = 'transparent'; signinTab.style.color = 'var(--muted)';
    btn.textContent = 'Create Account';
  }
  document.getElementById('auth-error').style.display = 'none';
}

// Magic link: the canonical path for accounts created by the purchase webhook
// (confirmed, but passwordless). One field, one click, and it can never route
// the buyer to an account other than the one holding their purchase, because
// the link is delivered to the purchase email itself.
async function handleLearnMagicLink() {
  var email = document.getElementById('auth-email').value.trim();
  var errEl = document.getElementById('auth-error');
  var btn = document.getElementById('magic-link-btn');
  if (!email) {
    errEl.textContent = 'Enter your email address first.';
    errEl.style.display = 'block';
    errEl.style.color = '#f87171';
    return;
  }
  errEl.textContent = 'Sending...';
  errEl.style.display = 'block';
  errEl.style.color = 'var(--muted)';
  if (btn) btn.disabled = true;

  var captchaToken;
  try {
    captchaToken = await getTurnstileToken();
  } catch (err) {
    errEl.textContent = err.message || 'Verification failed. Please try again.';
    errEl.style.color = '#f87171';
    resetTurnstile();
    if (btn) btn.disabled = false;
    return;
  }

  // Preserve any ?redirect= so a buyer who followed a course link lands there.
  var params = new URLSearchParams(window.location.search);
  var redirect = params.get('redirect');
  var emailRedirectTo = 'https://ryxa.io/learn/';
  if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
    emailRedirectTo = 'https://ryxa.io/learn/?redirect=' + encodeURIComponent(redirect);
  }

  var { error } = await sb.auth.signInWithOtp({
    email: email,
    options: { emailRedirectTo: emailRedirectTo, captchaToken: captchaToken }
  });

  if (error) {
    var msg = error.message;
    if (msg.toLowerCase().indexOf('captcha') !== -1 || msg.toLowerCase().indexOf('invalid-input') !== -1) {
      msg = 'Verification failed. Please disable your ad blocker for ryxa.io and try again.';
    }
    errEl.textContent = msg;
    errEl.style.display = 'block';
    errEl.style.color = '#f87171';
    resetTurnstile();
    if (btn) btn.disabled = false;
    return;
  }

  errEl.textContent = 'Login link sent. Check your email.';
  errEl.style.display = 'block';
  errEl.style.color = 'var(--text)';
  resetTurnstile();
  if (btn) btn.disabled = false;
}

// Reveal the de-emphasized Google/Apple buttons.
function handleLearnToggleSocial() {
  var wrap = document.getElementById('social-signin-options');
  var toggle = document.getElementById('more-signin-toggle');
  if (!wrap || !toggle) return;
  var open = !wrap.hasAttribute('hidden');
  if (open) {
    wrap.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'More sign-in options';
  } else {
    wrap.removeAttribute('hidden');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.textContent = 'Fewer sign-in options';
  }
}

async function handleLearnForgotPassword() {
  var email = document.getElementById('auth-email').value.trim();
  var errEl = document.getElementById('auth-error');
  if (!email) { errEl.textContent = 'Enter your email address first.'; errEl.style.display = 'block'; errEl.style.color = '#f87171'; return; }
  errEl.textContent = 'Sending...';
  errEl.style.display = 'block';
  errEl.style.color = 'var(--muted)';
  var captchaToken;
  try {
    captchaToken = await getTurnstileToken();
  } catch (err) {
    errEl.textContent = err.message || 'Verification failed. Please try again.';
    errEl.style.color = '#f87171';
    resetTurnstile();
    return;
  }
  var { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://ryxa.io/reset-password.html', captchaToken: captchaToken });
  if (error) {
    var msg = error.message;
    if (msg.toLowerCase().indexOf('captcha') !== -1 || msg.toLowerCase().indexOf('invalid-input') !== -1) {
      msg = 'Verification failed. Please disable your ad blocker for ryxa.io and try again.';
    }
    errEl.textContent = msg;
    errEl.style.display = 'block';
    errEl.style.color = '#f87171';
    resetTurnstile();
    return;
  }
  errEl.textContent = 'Password reset link sent. Check your email.';
  errEl.style.display = 'block';
  errEl.style.color = 'var(--text)';
  resetTurnstile();
}

async function handleLearnGoogleAuth() {
  var params = new URLSearchParams(window.location.search);
  var redirect = params.get('redirect');
  var redirectUrl = 'https://ryxa.io/learn/';
  if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) redirectUrl = 'https://ryxa.io' + redirect;
  var { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectUrl }
  });
  if (error) {
    var errEl = document.getElementById('auth-error');
    errEl.textContent = error.message;
    errEl.style.display = 'block';
    errEl.style.color = '#f87171';
  }
}
async function handleLearnAppleAuth() {
  var params = new URLSearchParams(window.location.search);
  var redirect = params.get('redirect');
  var redirectUrl = 'https://ryxa.io/learn/';
  if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) redirectUrl = 'https://ryxa.io' + redirect;
  var { error } = await sb.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: redirectUrl }
  });
  if (error) {
    var errEl = document.getElementById('auth-error');
    errEl.textContent = error.message;
    errEl.style.display = 'block';
    errEl.style.color = '#f87171';
  }
}
const TURNSTILE_SITE_KEY = '0x4AAAAAAC9W8avdI3sdVEcc';
let turnstileWidgetId = null;
let _turnstilePendingResolve = null;
let _turnstilePendingReject = null;

function renderTurnstileWidget() {
  if (typeof turnstile === 'undefined') { setTimeout(renderTurnstileWidget, 200); return; }
  var container = document.getElementById('auth-turnstile');
  if (!container) return;
  if (turnstileWidgetId !== null) { try { turnstile.reset(turnstileWidgetId); } catch(e) {} return; }
  turnstileWidgetId = turnstile.render('#auth-turnstile', {
    sitekey: TURNSTILE_SITE_KEY,
    execution: 'execute',
    callback: function(token) {
      if (_turnstilePendingResolve) {
        var resolve = _turnstilePendingResolve;
        _turnstilePendingResolve = null;
        _turnstilePendingReject = null;
        resolve(token);
      }
    },
    'error-callback': function() {
      if (_turnstilePendingReject) {
        var reject = _turnstilePendingReject;
        _turnstilePendingResolve = null;
        _turnstilePendingReject = null;
        reject(new Error('Verification failed. Please try again.'));
      }
    },
  });
}

// Returns a Promise<string> that resolves with a Turnstile token. Callers must
// already be in a loading state when awaiting because the PoW runs inside this.
function getTurnstileToken() {
  return new Promise(function(resolve, reject) {
    if (typeof turnstile === 'undefined' || turnstileWidgetId === null) {
      reject(new Error('Verification not ready. Please try again.'));
      return;
    }
    try {
      var existing = turnstile.getResponse(turnstileWidgetId);
      if (existing) { resolve(existing); return; }
    } catch(e) {}
    _turnstilePendingResolve = resolve;
    _turnstilePendingReject = reject;
    try {
      turnstile.execute(turnstileWidgetId);
    } catch(e) {
      _turnstilePendingResolve = null;
      _turnstilePendingReject = null;
      reject(e);
    }
  });
}

function resetTurnstile() {
  if (typeof turnstile !== 'undefined' && turnstileWidgetId !== null) { try { turnstile.reset(turnstileWidgetId); } catch(e) {} }
  _turnstilePendingResolve = null;
  _turnstilePendingReject = null;
}

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    await onLoggedIn();
  } else {
    showAuth();
  }

  sb.auth.onAuthStateChange(function(_event, session) {
    if (session?.user && !currentUser) {
      currentUser = session.user;
      onLoggedIn();
    } else if (!session?.user) {
      currentUser = null;
      showAuth();
    }
  });
}

function showAuth() {
  document.getElementById('auth-screen').style.display = 'block';
  document.getElementById('dash-screen').style.display = 'none';
  document.getElementById('viewer-screen').style.display = 'none';
  document.getElementById('nav-right').innerHTML = '<a href="/" class="nav-btn nav-btn-outline">Home</a>';
  renderTurnstileWidget();

  // Only when the auth screen is actually shown. A logged-in buyer never sees
  // this, and their DOM should not be touched for a banner they will not read.
  applyLearnAuthContext();
}

async function handleAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.style.display = 'none';

  if (!email || !password) { errEl.textContent = 'Please enter email and password.'; errEl.style.display = 'block'; return; }
  if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('auth-btn');
  btn.disabled = true; btn.textContent = 'Loading...';

  var captchaToken;
  try {
    captchaToken = await getTurnstileToken();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
    errEl.textContent = err.message || 'Verification failed. Please try again.';
    errEl.style.display = 'block';
    errEl.style.color = '#f87171';
    resetTurnstile();
    return;
  }

  try {
    var result;
    if (authMode === 'signup') {
      // Build redirect URL so email confirmation sends user back here
      var confirmRedirect = 'https://ryxa.io/learn/';
      var params = new URLSearchParams(window.location.search);
      var redirect = params.get('redirect');
      if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
        confirmRedirect = 'https://ryxa.io/learn/?redirect=' + encodeURIComponent(redirect);
      }
      result = await sb.auth.signUp({ email: email, password: password, options: { captchaToken: captchaToken, emailRedirectTo: confirmRedirect } });
      if (result.error) throw result.error;
      if (result.data?.user && !result.data.session) {
        // Two very different situations produce this same "user, no session"
        // shape, and telling them apart matters:
        //
        //  (a) A genuinely new signup awaiting email confirmation.
        //  (b) An email that ALREADY has an account. Buyers whose account was
        //      created by the purchase webhook are confirmed but passwordless,
        //      so they don't know they have one and click Create Account. If we
        //      tell them to "check your email for a confirmation link," they
        //      wait for a message that never meaningfully arrives while their
        //      purchases sit in an account they can't enter.
        //
        // Supabase obfuscates existing users: identities comes back empty.
        // Detect that and route them to the real recovery path instead.
        var identities = result.data.user.identities;
        var alreadyExists = Array.isArray(identities) && identities.length === 0;

        if (alreadyExists) {
          errEl.textContent = 'You already have an account with this email. Sending you a login link...';
          errEl.style.display = 'block';
          errEl.style.color = 'var(--text)';
          btn.disabled = false; btn.textContent = 'Sign Up';
          // Fresh captcha token: the previous one was consumed by signUp.
          var recoveryToken;
          try {
            resetTurnstile();
            recoveryToken = await getTurnstileToken();
          } catch (e) {
            errEl.textContent = 'You already have an account with this email. Use "Email me a login link" below to sign in.';
            errEl.style.color = '#f87171';
            return;
          }
          var otpRes = await sb.auth.signInWithOtp({
            email: email,
            options: { emailRedirectTo: confirmRedirect, captchaToken: recoveryToken }
          });
          if (otpRes.error) {
            errEl.textContent = 'You already have an account with this email. Use "Email me a login link" below to sign in.';
            errEl.style.color = '#f87171';
          } else {
            errEl.textContent = 'You already have an account. We sent a login link to ' + email + '.';
            errEl.style.color = 'var(--text)';
          }
          resetTurnstile();
          return;
        }

        errEl.textContent = 'Check your email for a confirmation link.';
        errEl.style.display = 'block';
        errEl.style.color = 'var(--text)';
        btn.disabled = false; btn.textContent = 'Sign Up';
        return;
      }
    } else {
      result = await sb.auth.signInWithPassword({ email: email, password: password, options: { captchaToken: captchaToken } });
      if (result.error) throw result.error;
    }
    currentUser = result.data.user;
    await onLoggedIn();
  } catch (err) {
    var msg = err.message || 'Authentication failed.';
    // Detect captcha verification failures (often caused by ad blockers or strict privacy extensions)
    if (msg.toLowerCase().indexOf('captcha') !== -1 || msg.toLowerCase().indexOf('invalid-input') !== -1) {
      msg = 'Verification failed. Please disable your ad blocker for ryxa.io and try again.';
    }
    errEl.textContent = msg;
    errEl.style.display = 'block';
    errEl.style.color = '#f87171';
    resetTurnstile();
  } finally {
    btn.disabled = false;
    btn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
  }
}

async function onLoggedIn() {
  // Repair orphan purchases BEFORE any loader queries by user_id, otherwise a
  // repaired row would not appear until the next page load.
  await linkOrphanPurchases();

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('nav-right').innerHTML = '<div class="nav-menu-wrap">'
    + '<button class="nav-menu-btn" data-learn-action="toggle-nav-menu" aria-label="Menu">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>'
    + '</button>'
    + '<div class="nav-menu-dropdown" id="nav-menu-dropdown">'
    + '<div class="nav-menu-email"><svg viewBox="0 0 24 24" style="width:14px;height:14px;flex-shrink:0;stroke:rgba(255,255,255,0.5);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:middle;margin-right:6px;display:inline;"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>' + escapeHtml(currentUser.email) + '</div>'
    + '<div class="nav-menu-divider"></div>'
    + '<button class="nav-menu-item" data-learn-action="toggle-theme">'
    + '<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
    + '<span id="theme-menu-label">' + (document.documentElement.getAttribute('data-theme') === 'light' ? 'Dark Mode' : 'Light Mode') + '</span>'
    + '</button>'
    + '<button class="nav-menu-item" data-learn-action="open-marketplace-from-menu">'
    + '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    + 'Search Marketplace'
    + '</button>'
    + '<a class="nav-menu-item" href="/dashboard" style="text-decoration:none;">'
    + '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>'
    + 'Creator Dashboard'
    + '</a>'
    + '<div class="nav-menu-divider"></div>'
    + '<button class="nav-menu-item" data-learn-action="signout" style="color:#f87171;">'
    + '<svg viewBox="0 0 24 24" style="stroke:#f87171;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
    + 'Sign Out'
    + '</button>'
    + '</div>'
    + '</div>';

  // Create course_users row if needed
  await sb.from('course_users').upsert({ user_id: currentUser.id, display_name: currentUser.email.split('@')[0] }, { onConflict: 'user_id' });

  // Check URL params
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect');
  const courseId = params.get('course');

  // If redirected from a course page, send them back (only allow relative paths)
  if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
    window.location.href = redirect;
    return;
  }

  if (courseId) {
    await openCourseViewer(courseId);
  } else {
    await loadAllSections();
  }
}

async function signOut() {
  await sb.auth.signOut({ scope: 'local' });
  window.location.href = '/learn/';
}

// Courses, downloads, and bookings are independent of one another. Loading them
// in parallel takes the time of the slowest, not the sum of all three.
async function loadAllSections() {
  var spinner = document.getElementById('dash-loading');
  var dash = document.getElementById('dash-screen');
  var viewer = document.getElementById('viewer-screen');

  if (viewer) viewer.style.display = 'none';
  if (dash) dash.style.display = 'none';
  if (spinner) spinner.style.display = 'block';

  try {
    await Promise.all([loadDashboard(), loadProducts(), loadBookings()]);
  } catch (e) {
    console.error('Dashboard load failed:', e);
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (dash) dash.style.display = 'block';
  }
}

async function loadDashboard() {
  document.getElementById('viewer-screen').style.display = 'none';

  const { data } = await sb
    .from('course_enrollments')
    .select('*, courses(*)')
    .eq('user_id', currentUser.id)
    .order('enrolled_at', { ascending: false });

  enrollments = data || [];

  // Creator names, lesson totals, and progress for every enrollment.
  //
  // This used to be a for-loop issuing THREE queries per enrollment, awaited
  // one at a time. Five courses meant fifteen sequential round trips, and the
  // cost grew with every course a buyer owned. Now it is three queries total,
  // regardless of how many enrollments there are, run in parallel.
  var withCourses = enrollments.filter(function (e) { return !!e.courses; });
  if (withCourses.length > 0) {
    var creatorIds = [];
    var courseIds = [];
    var enrollmentIds = [];
    withCourses.forEach(function (e) {
      if (creatorIds.indexOf(e.courses.user_id) === -1) creatorIds.push(e.courses.user_id);
      courseIds.push(e.courses.id);
      enrollmentIds.push(e.id);
    });

    var results = await Promise.all([
      sb.from('public_profiles').select('user_id, username').in('user_id', creatorIds),
      sb.from('course_lessons').select('id, course_id').in('course_id', courseIds),
      sb.from('course_progress').select('id, enrollment_id').in('enrollment_id', enrollmentIds)
    ]);

    var nameByCreator = {};
    (results[0].data || []).forEach(function (p) { nameByCreator[p.user_id] = p.username; });

    var lessonsByCourse = {};
    (results[1].data || []).forEach(function (l) {
      lessonsByCourse[l.course_id] = (lessonsByCourse[l.course_id] || 0) + 1;
    });

    var doneByEnrollment = {};
    (results[2].data || []).forEach(function (p) {
      doneByEnrollment[p.enrollment_id] = (doneByEnrollment[p.enrollment_id] || 0) + 1;
    });

    withCourses.forEach(function (e) {
      e._creatorName = nameByCreator[e.courses.user_id] || 'Creator';
      e._totalLessons = lessonsByCourse[e.courses.id] || 0;
      e._completedLessons = doneByEnrollment[e.id] || 0;
    });
  }

  renderDashboard();
}

// =====================================================
// DIGITAL PRODUCTS, buyer side
// =====================================================

// On every dashboard load, retroactively link any orphan purchases to the
// buyer's user_id, across products, courses, and bookings.
//
// This matters more since guest checkout: ownership binds by EMAIL at payment
// time, so a row whose owner was nulled (an account deleted outside
// delete_my_account) is repaired the moment the buyer signs in with the address
// they purchased with. The function derives the user from auth.uid() and only
// touches rows with a NULL owner, so it can never claim someone else's row.
async function linkOrphanPurchases() {
  try {
    await sb.rpc('link_purchases_to_user');
  } catch (e) {
    console.warn('Could not link orphan purchases:', e);
  }
}

async function loadProducts() {
  var { data: purchases, error } = await sb
    .from('digital_product_purchases')
    .select('*, digital_products(id, title, slug, description, cover_image_url, delivery_message, user_id)')
    .eq('buyer_user_id', currentUser.id)
    .eq('status', 'completed')
    .order('purchased_at', { ascending: false });

  if (error) {
    console.error('loadProducts error:', error);
    return;
  }

  purchases = purchases || [];

  // Filter out any purchases whose product was deleted
  purchases = purchases.filter(function(p) { return p.digital_products; });

  if (!purchases.length) {
    document.getElementById('dash-products-section').style.display = 'none';
    return;
  }

  // File lists come from a server endpoint (direct DB access is RLS-blocked,
  // since buyers do not own the files). One call per product is unavoidable
  // without changing that endpoint, but they no longer run one after another:
  // this used to be two sequential awaits per purchase.
  var { data: { session } } = await sb.auth.getSession();
  var token = session?.access_token || '';

  var creatorIds = [];
  purchases.forEach(function (p) {
    if (creatorIds.indexOf(p.digital_products.user_id) === -1) creatorIds.push(p.digital_products.user_id);
  });

  var fileFetches = purchases.map(function (p) {
    return fetch('/api/list-product-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ product_id: p.digital_products.id })
    })
      .then(function (resp) { return resp.ok ? resp.json() : null; })
      .then(function (data) { p._files = (data && data.files) ? data.files : []; })
      .catch(function (e) {
        console.error('Could not load files for product', p.digital_products.id, e);
        p._files = [];
      });
  });

  // Creator names in ONE query, not one per purchase.
  var namesPromise = sb.from('public_profiles').select('user_id, username').in('user_id', creatorIds);

  var settled = await Promise.all([Promise.all(fileFetches), namesPromise]);

  var nameByCreator = {};
  (settled[1].data || []).forEach(function (pr) { nameByCreator[pr.user_id] = pr.username; });
  purchases.forEach(function (p) {
    p._creatorName = nameByCreator[p.digital_products.user_id] || 'Creator';
  });

  renderProducts(purchases);

  // Honor ?dp=<id>&purchased=1 deep link, scroll to the matching product
  try {
    var params = new URLSearchParams(window.location.search);
    var dpId = params.get('dp');
    if (dpId) {
      var el = document.getElementById('dp-purchase-' + dpId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Brief highlight pulse
        el.style.transition = 'border-color 0.3s, box-shadow 0.3s';
        var origBorder = el.style.borderColor;
        var origShadow = el.style.boxShadow;
        el.style.borderColor = 'rgba(124,58,237,0.6)';
        el.style.boxShadow = '0 0 24px rgba(124,58,237,0.3)';
        setTimeout(function() {
          el.style.borderColor = origBorder;
          el.style.boxShadow = origShadow;
        }, 2400);
      }
    }
  } catch (e) { /* non-fatal */ }
}

function renderProducts(purchases) {
  var section = document.getElementById('dash-products-section');
  var container = document.getElementById('dash-products');

  if (!purchases || purchases.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  container.innerHTML = purchases.map(function(p) {
    var prod = p.digital_products;
    var coverHtml = prod.cover_image_url
      ? '<div style="width:64px;height:64px;border-radius:10px;background-image:url(' + escapeAttr(prod.cover_image_url) + ');background-size:cover;background-position:center;flex-shrink:0;"></div>'
      : '<div style="width:64px;height:64px;border-radius:10px;background:linear-gradient(135deg,rgba(124,58,237,0.18),rgba(232,121,249,0.14));display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>';

    var purchasedDate = new Date(p.purchased_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    var priceText = p.amount_cents > 0 ? '$' + (p.amount_cents / 100).toFixed(2) : 'Free';

    var filesHtml = (p._files || []).map(function(f) {
      var sizeText = formatBytes(f.file_size_bytes);
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;">'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(f.filename) + '</div>'
        + '<div style="font-size:11px;color:var(--muted);margin-top:2px;">' + sizeText + '</div>'
        + '</div>'
        + '<button data-learn-action="download-product-file" data-learn-file-id="' + f.id + '" style="padding:7px 14px;background:var(--btn-bg);color:var(--btn-text);border:none;border-radius:7px;font-size:12px;font-weight:500;font-family:DM Sans,sans-serif;cursor:pointer;flex-shrink:0;display:inline-flex;align-items:center;gap:5px;">'
        + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
        + 'Download</button>'
        + '</div>';
    }).join('');

    var deliveryHtml = '';
    if (prod.delivery_message) {
      deliveryHtml = '<div style="margin-top:12px;padding:12px 14px;background:rgba(124,58,237,0.06);border:1px solid rgba(124,58,237,0.15);border-radius:9px;font-size:13px;color:var(--text);line-height:1.5;white-space:pre-wrap;word-wrap:break-word;">' + escapeHtml(prod.delivery_message) + '</div>';
    }

    return '<div id="dp-purchase-' + p.id + '" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;">'
      + '<div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:14px;">'
      + coverHtml
      + '<div style="flex:1;min-width:0;">'
      + '<div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(prod.title) + '</div>'
      + '<div style="font-size:12px;color:var(--muted);">by <a href="/' + escapeAttr(p._creatorName) + '" style="color:inherit;text-decoration:none;border-bottom:1px solid var(--border);">' + escapeHtml(p._creatorName) + '</a> \u00b7 ' + priceText + ' \u00b7 ' + purchasedDate + '</div>'
      + '</div>'
      + '</div>'
      + (filesHtml ? '<div style="display:flex;flex-direction:column;gap:8px;">' + filesHtml + '</div>' : '<div style="font-size:12px;color:var(--muted);font-style:italic;">No files attached.</div>')
      + deliveryHtml
      + '</div>';
  }).join('');
}

function formatBytes(bytes) {
  bytes = Number(bytes || 0);
  if (bytes === 0) return '0 KB';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

async function downloadProductFile(fileId, btn) {
  if (!btn) return;
  var origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M22 12a10 10 0 0 1-10 10"/></svg> Preparing...';

  try {
    var { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) {
      throw new Error('You must be signed in to download');
    }

    var resp = await fetch('/api/download-product-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      },
      body: JSON.stringify({ file_id: fileId })
    });
    var data = await resp.json();
    if (!resp.ok || data.error) {
      throw new Error(data.error || 'Could not generate download link');
    }

    // Native app: WKWebView does not support the anchor download attribute,
    // so the file is fetched and handed across the bridge for the native
    // save/share sheet. Keys off RyxaNative so any future buyer app
    // inherits this automatically.
    if (window.RyxaNative && window.ReactNativeWebView) {
      var natResp = await fetch(data.url);
      if (!natResp.ok) throw new Error('Download failed (' + natResp.status + ')');
      var natBlob = await natResp.blob();
      var natB64 = await new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() { resolve(String(reader.result).split(',')[1] || ''); };
        reader.onerror = function() { reject(new Error('Could not read file')); };
        reader.readAsDataURL(natBlob);
      });
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'saveFile',
        filename: data.filename || 'download',
        mime: natBlob.type || 'application/octet-stream',
        base64: natB64
      }));
    } else {
      // Trigger browser download via a transient link
      var a = document.createElement('a');
      a.href = data.url;
      a.download = data.filename || '';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Started';
    setTimeout(function() {
      btn.innerHTML = origText;
      btn.disabled = false;
    }, 2000);
  } catch (err) {
    console.error('Download failed:', err);
    btn.innerHTML = origText;
    btn.disabled = false;
    alert(err.message || 'Could not download this file');
  }
}

// Download a lesson-attached file. Mirrors downloadProductFile but routes
// through /api/download-lesson-file, which gates by enrollment OR free-
// preview status. Auth header is sent if available - the server makes the
// auth decision (preview lessons allow unauthenticated downloads).
async function downloadLessonFile(fileId, btn) {
  if (!btn) return;
  var origIcon = btn.querySelector('.viewer-download-arr');
  var origIconHtml = origIcon ? origIcon.outerHTML : '';
  btn.disabled = true;
  if (origIcon) {
    origIcon.outerHTML = '<svg class="viewer-download-arr" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M22 12a10 10 0 0 1-10 10"/></svg>';
  }

  function restore() {
    btn.disabled = false;
    var icn = btn.querySelector('.viewer-download-arr');
    if (icn && origIconHtml) icn.outerHTML = origIconHtml;
  }

  try {
    var { data: { session } } = await sb.auth.getSession();
    var headers = { 'Content-Type': 'application/json' };
    if (session && session.access_token) {
      headers['Authorization'] = 'Bearer ' + session.access_token;
    }

    var resp = await fetch('/api/download-lesson-file', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ file_id: fileId })
    });
    var data = await resp.json();
    if (!resp.ok || data.error) {
      throw new Error(data.error || 'Could not generate download link');
    }

    // Fetch the signed URL as a blob and trigger an anchor-click download.
    // Using window.open + signed URL DOES NOT work in two scenarios:
    //   (1) Ryxa PWA - external navigation is intentionally blocked.
    //   (2) Mobile Safari - window.open after an `await` is treated as
    //       non-user-initiated and silently popup-blocked.
    // The blob approach sidesteps both: no popup, no navigation, just a
    // native browser download via the `download` anchor attribute. Same
    // pattern used by Brand Deals contract/invoice downloads.
    var fileResp = await fetch(data.url);
    if (!fileResp.ok) throw new Error('Download failed (' + fileResp.status + ')');
    var blob = await fileResp.blob();

    // Native app: hand the bytes across the bridge for the native
    // save/share sheet (anchor download attribute is unsupported there).
    if (window.RyxaNative && window.ReactNativeWebView) {
      var b64 = await new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() { resolve(String(reader.result).split(',')[1] || ''); };
        reader.onerror = function() { reject(new Error('Could not read file')); };
        reader.readAsDataURL(blob);
      });
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'saveFile',
        filename: data.filename || 'download',
        mime: blob.type || 'application/octet-stream',
        base64: b64
      }));
      restore();
      return;
    }

    var objectUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = objectUrl;
    a.download = data.filename || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Release the object URL after a tick so the download has started.
    setTimeout(function() { URL.revokeObjectURL(objectUrl); }, 1000);

    restore();
  } catch (err) {
    console.error('Lesson file download failed:', err);
    restore();
    alert(err.message || 'Could not download this file');
  }
}

async function loadBookings() {
  var { data: bookings } = await sb
    .from('coaching_bookings')
    .select('*, coaching_services(*)')
    .eq('user_id', currentUser.id)
    .order('booked_at', { ascending: false });

  bookings = bookings || [];

  // Creator names in ONE query, not one per booking.
  var withServices = bookings.filter(function (b) { return !!b.coaching_services; });
  if (withServices.length > 0) {
    var creatorIds = [];
    withServices.forEach(function (b) {
      if (creatorIds.indexOf(b.coaching_services.user_id) === -1) creatorIds.push(b.coaching_services.user_id);
    });
    var { data: profiles } = await sb.from('public_profiles').select('user_id, username').in('user_id', creatorIds);
    var nameByCreator = {};
    (profiles || []).forEach(function (p) { nameByCreator[p.user_id] = p.username; });
    withServices.forEach(function (b) {
      b._creatorName = nameByCreator[b.coaching_services.user_id] || 'Creator';
    });
  }

  renderBookings(bookings);
}

function renderBookings(bookings) {
  var section = document.getElementById('dash-bookings-section');
  var container = document.getElementById('dash-bookings');

  if (!bookings || bookings.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  container.innerHTML = bookings.map(function(b) {
    var c = b.coaching_services;
    if (!c) return '';
    var date = new Date(b.booked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    var priceText = b.amount_paid_cents > 0 ? '$' + (b.amount_paid_cents / 100).toFixed(2) : 'Free';

    // Format the actual session date/time (if booked through Ryxa Calendar).
    // Use the booker's saved timezone from slot_timezone, this is what they
    // picked when they booked. Browser-local was wrong when the booker
    // switched tz during booking (e.g. travel scenario) or has since
    // moved devices.
    var slotInfo = '';
    if (b.slot_start && b.slot_end) {
      var slotStart = new Date(b.slot_start);
      var slotEnd = new Date(b.slot_end);
      var slotTz = b.slot_timezone || undefined;
      var slotDate = slotStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: slotTz });
      var slotTime = slotStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: slotTz }) + ' – ' + slotEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: slotTz });
      slotInfo = slotDate + ' at ' + slotTime;
    }

    var actionHtml = '';
    if (c.booking_type === 'calendly' && c.calendly_url && !b.slot_start) {
      actionHtml = '<a href="' + escapeHtml(c.calendly_url) + '" target="_blank" style="padding:6px 14px;background:var(--btn-bg);color:var(--btn-text);border:none;border-radius:6px;font-size:12px;font-weight:500;font-family:DM Sans,sans-serif;text-decoration:none;flex-shrink:0;">Schedule</a>';
    } else if (!b.slot_start) {
      actionHtml = '<span style="font-size:11px;color:var(--muted);flex-shrink:0;">Creator will contact you</span>';
    }

    var coverHtml = '';
    if (c.cover_image_path) {
      var coverUrl = sb.storage.from('coaching-covers').getPublicUrl(c.cover_image_path).data.publicUrl;
      coverHtml = '<img src="' + escapeHtml(coverUrl) + '" alt="Booking cover" style="width:56px;height:38px;object-fit:cover;border-radius:6px;flex-shrink:0;">';
    } else {
      coverHtml = '<div style="width:56px;height:38px;border-radius:6px;background:var(--surface);border:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>';
    }

    // Meeting details block, only render if the creator set details on the service.
    // Uses pure monochrome contrast (white-on-black in dark mode, black-on-white in light mode).
    // Auto-link URLs and respect line breaks.
    var meetingDetailsHtml = '';
    if (c.meeting_details) {
      var md = String(c.meeting_details)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--text);text-decoration:underline;font-weight:500;">$1</a>')
        .replace(/\n/g, '<br>');
      meetingDetailsHtml = '<div style="margin-top:10px;padding:10px 12px;background:var(--bg);border:1px solid var(--border-hover);border-radius:8px;">'
        + '<div style="font-size:10px;font-weight:600;color:var(--muted);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;">Meeting Details</div>'
        + '<div style="font-size:12px;color:var(--text);line-height:1.5;word-break:break-word;">' + md + '</div>'
        + '</div>';
    }

    // Build the meta line: who, when booked, price, and slot info if present
    var metaParts = ['by ' + escapeHtml(b._creatorName)];
    if (slotInfo) metaParts.push(slotInfo);
    metaParts.push(priceText);

    return '<div style="padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;">'
      + '<div style="display:flex;align-items:center;gap:12px;">'
      + coverHtml
      + '<div style="flex:1;min-width:0;">'
      + '<div style="font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(c.title) + '</div>'
      + '<div style="font-size:12px;color:var(--muted);margin-top:2px;">' + metaParts.join(' · ') + '</div>'
      + '</div>'
      + actionHtml
      + '</div>'
      + meetingDetailsHtml
      + '</div>';
  }).join('');
}

function renderDashboard() {
  const grid = document.getElementById('dash-courses');
  const empty = document.getElementById('dash-empty');

  if (enrollments.length === 0) {
    grid.innerHTML = '';
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  grid.style.display = 'grid';

  grid.innerHTML = enrollments.map(function(e) {
    var c = e.courses;
    if (!c) return '';
    var coverStyle = c.cover_image_path
      ? 'background-image:url(' + sb.storage.from("course-covers").getPublicUrl(c.cover_image_path).data.publicUrl + ');background-size:cover;background-position:center;'
      : '';
    var total = e._totalLessons || 0;
    var completed = e._completedLessons || 0;
    var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    var progressLabel = total > 0 ? completed + '/' + total + ' lessons' : '';
    return '<a class="course-card" href="#" data-learn-action="open-course" data-learn-course-id="' + c.id + '">'
      + '<div class="course-card-cover" style="' + coverStyle + '">' + (c.cover_image_path ? '' : '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></svg>') + '</div>'
      + '<div class="course-card-body">'
      + '<div class="course-card-title">' + escapeHtml(c.title) + '</div>'
      + '<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">by ' + escapeHtml(e._creatorName) + '</div>'
      + (progressLabel ? '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">' + progressLabel + (pct === 100 ? ', Complete' : '') + '</div>' : '')
      + '<div class="course-card-progress"><div class="course-card-progress-bar" style="width:' + pct + '%"></div></div>'
      + '</div></a>';
  }).join('');
}

async function openCourseViewer(courseId) {
  document.getElementById('dash-screen').style.display = 'none';
  document.getElementById('viewer-screen').style.display = 'block';

  // Load course
  const { data: course } = await sb.from('courses').select('*').eq('id', courseId).single();
  if (!course) { backToDash(); return; }
  viewerCourse = course;
  document.getElementById('viewer-course-title').textContent = course.title;

  // Load modules & lessons
  const { data: modules } = await sb.from('course_modules').select('*').eq('course_id', courseId).order('sort_order');
  const { data: lessons } = await sb.from('course_lessons').select('*').eq('course_id', courseId).order('sort_order');
  viewerModules = modules || [];
  viewerLessons = lessons || [];

  // Load downloadable files for all lessons in this course (single query,
  // grouped client-side by lesson_id). RLS gates this: enrolled students
  // and the creator see all files; non-enrolled visitors see only files
  // attached to preview lessons.
  viewerLessonFiles = {};
  const { data: files } = await sb
    .from('course_lesson_files')
    .select('id, lesson_id, filename, file_size_bytes, sort_order')
    .eq('course_id', courseId)
    .order('sort_order');
  (files || []).forEach(function(f) {
    if (!viewerLessonFiles[f.lesson_id]) viewerLessonFiles[f.lesson_id] = [];
    viewerLessonFiles[f.lesson_id].push(f);
  });

  // Load quizzes via the public_course_quizzes view. The view strips
  // is_correct flags from every answer - the client never sees correct
  // answer data. Grading happens server-side in /api/grade-quiz.
  viewerQuizzesByModule = {};
  const { data: quizzes } = await sb
    .from('public_course_quizzes')
    .select('id, module_id, course_id, require_pass, questions')
    .eq('course_id', courseId);
  (quizzes || []).forEach(function(q) {
    viewerQuizzesByModule[q.module_id] = q;
  });

  // Load enrollment & progress
  const { data: enrollment } = await sb.from('course_enrollments').select('id').eq('course_id', courseId).eq('user_id', currentUser.id).single();
  viewerEnrollmentId = enrollment?.id || null;

  if (viewerEnrollmentId) {
    const { data: progress } = await sb.from('course_progress').select('lesson_id').eq('enrollment_id', viewerEnrollmentId);
    viewerProgress = (progress || []).map(function(p) { return p.lesson_id; });
    // Quiz pass records for this enrollment. RLS scopes this to "rows where
    // the parent enrollment.user_id matches the caller" so we just query
    // by enrollment_id and trust the policy.
    const { data: passes } = await sb.from('course_quiz_passes').select('quiz_id').eq('enrollment_id', viewerEnrollmentId);
    viewerPassedQuizIds = new Set((passes || []).map(function(p) { return p.quiz_id; }));
  } else {
    viewerProgress = [];
    viewerPassedQuizIds = new Set();
  }

  currentLessonId = null;
  renderViewer();
  showCourseOverview();
}

function showCourseOverview() {
  currentLessonId = null;
  renderViewer();
  var content = document.getElementById('viewer-content');
  var nav = document.getElementById('viewer-nav');

  var html = '';
  // Cover image
  if (viewerCourse.cover_image_path) {
    var coverUrl = sb.storage.from('course-covers').getPublicUrl(viewerCourse.cover_image_path).data.publicUrl;
    html += '<img src="' + coverUrl + '" alt="Course cover" style="width:100%;max-height:300px;object-fit:cover;border-radius:12px;margin-bottom:24px;">';
  }

  html += '<div class="viewer-lesson-title">' + escapeHtml(viewerCourse.title) + '</div>';
  if (viewerCourse.description) {
    // Rich-text description (saved by the dashboard's Quill editor). Apply
    // the same cleanups course-page.js uses: trim whitespace in block tags,
    // strip empty paragraph spacers, unwrap href-less <a> tags. Sanitize
    // via DOMPurify if loaded, otherwise fall back to escaped text. Trigger
    // the lazy loader so subsequent renders use the full HTML path.
    var descRaw = viewerCourse.description || '';
    descRaw = descRaw.replace(/(\s+)<\/(p|h2|h3|li)>/g, '</$2>');
    descRaw = descRaw.replace(/<(p|h2|h3|li)([^>]*)>\s+/g, '<$1$2>');
    descRaw = descRaw.replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, '');
    descRaw = descRaw.replace(/<p>\s*<\/p>/gi, '');
    descRaw = descRaw.replace(/<a(?:\s+(?!href=)[^>]*)?>(.*?)<\/a>/gi, '$1');
    descRaw = descRaw.replace(/<a\s+href=["']?["']?\s*>(.*?)<\/a>/gi, '$1');
    if (typeof DOMPurify !== 'undefined') {
      // Make sure the class-whitelist hook is installed before sanitize runs.
      // ensureViewerPurifyLoaded installs it on first DOMPurify load, but if
      // some other code path loaded DOMPurify first, this idempotent install
      // ensures the description path is safe too. The hook is the security
      // boundary for the `class` attribute: without it, any class value would
      // ride along on <img> and <span> and could be used to leverage existing
      // stylesheet rules.
      installLearnPageClassHook();
      var descClean = DOMPurify.sanitize(descRaw, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'h2', 'h3', 'ul', 'ol', 'li', 'img', 'span'],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class'],
        ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i
      });
      // Force external links to open in a new tab with rel=noopener (the
      // DOMPurify hook already enforces rel on target=_blank, but doesn't
      // ADD target=_blank to plain hrefs). Done as a string replace because
      // we're still assembling the HTML, not in the DOM yet.
      descClean = descClean.replace(/<a\s+href="(https?:[^"]+)"([^>]*)>/gi, function(m, href, rest) {
        // Skip if target is already set in `rest`.
        if (/\btarget=/i.test(rest)) return m;
        return '<a href="' + href + '" target="_blank" rel="noopener noreferrer"' + rest + '>';
      });
      html += '<div class="viewer-text" style="margin-bottom:28px;">' + descClean + '</div>';
    } else {
      // Fallback while DOMPurify lazy-loads on first viewer access. Strip
      // tags entirely so HTML doesn't render as plain text noise.
      var descPlain = descRaw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      html += '<div class="viewer-text" style="margin-bottom:28px;">' + escapeHtml(descPlain) + '</div>';
      // Kick off the loader so next render gets the rich version.
      ensureViewerPurifyLoaded().then(function() {
        // Re-render the overview now that DOMPurify is available, but only
        // if the user is still on the overview (didn't click into a lesson).
        if (currentLessonId === null) showCourseOverview();
      }).catch(function() { /* keep showing fallback */ });
    }
  }

  // Curriculum list
  html += '<div style="margin-top:8px;">';
  html += '<h3 style="font-family:Syne,sans-serif;font-size:16px;font-weight:800;letter-spacing:-0.3px;margin-bottom:16px;">Curriculum</h3>';

  // Same lock-set computation as renderViewer - items past the first
  // unpassed require_pass quiz get a lock icon and muted text.
  var overviewAll = getAllLessonsOrdered();
  var overviewLockedIds = new Set();
  var overviewBoundary = getLockBoundaryIndex();
  if (overviewBoundary !== -1) {
    for (var oi = overviewBoundary + 1; oi < overviewAll.length; oi++) {
      var oEntry = overviewAll[oi];
      overviewLockedIds.add(oEntry.kind === 'quiz' ? ('quiz:' + oEntry.item.id) : oEntry.item.id);
    }
  }
  var overviewLockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  viewerModules.forEach(function(mod, mi) {
    var modLessons = viewerLessons.filter(function(l) { return l.module_id === mod.id; });
    var modQuiz = viewerQuizzesByModule[mod.id] || null;
    html += '<div style="margin-bottom:16px;">';
    html += '<div style="font-size:12px;color:var(--text);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Module ' + (mi + 1) + ': ' + escapeHtml(mod.title) + '</div>';
    modLessons.forEach(function(l, li) {
      var isCompleted = viewerProgress.indexOf(l.id) !== -1;
      var isLocked = overviewLockedIds.has(l.id);
      var icon = l.lesson_type === 'video' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
      var check = isLocked
        ? overviewLockIcon
        : (isCompleted ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '<span style="width:14px;height:14px;display:inline-block;border:1.5px solid var(--muted);border-radius:50%;"></span>');
      var rowColor = isLocked ? 'var(--muted)' : 'var(--text)';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;color:' + rowColor + ';">'
        + check + ' ' + icon + ' ' + escapeHtml(l.title || (l.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson'))
        + '</div>';
    });
    // Quiz row at end of module (if this module has a quiz). Same shape as
    // the lesson rows: completion circle + icon + label. The completion
    // circle is filled only for require_pass quizzes the student has passed.
    if (modQuiz) {
      var quizPassed = viewerPassedQuizIds.has(modQuiz.id);
      var quizLocked = overviewLockedIds.has('quiz:' + modQuiz.id);
      var quizIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      var quizCheck = quizLocked
        ? overviewLockIcon
        : (quizPassed ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '<span style="width:14px;height:14px;display:inline-block;border:1.5px solid var(--muted);border-radius:50%;"></span>');
      var qCount = Array.isArray(modQuiz.questions) ? modQuiz.questions.length : 0;
      var requiredBadge = modQuiz.require_pass ? '<span style="display:inline-block;margin-left:6px;padding:1px 6px;font-size:10px;font-weight:600;background:rgba(124,58,237,0.12);color:#c4b5fd;border:1px solid rgba(124,58,237,0.25);border-radius:4px;letter-spacing:0.04em;">Required</span>' : '';
      var quizRowColor = quizLocked ? 'var(--muted)' : 'var(--text)';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;color:' + quizRowColor + ';">'
        + quizCheck + ' ' + quizIcon + ' Quiz &middot; ' + qCount + ' question' + (qCount === 1 ? '' : 's') + requiredBadge
        + '</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  // Progress summary
  var total = viewerLessons.length;
  var completed = viewerProgress.length;
  if (total > 0) {
    html += '<div style="margin-top:20px;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;font-size:13px;color:var(--text);">'
      + completed + ' of ' + total + ' lessons completed (' + Math.round((completed / total) * 100) + '%)'
      + '</div>';
  }

  content.innerHTML = html;

  // Nav: no prev, next is first item (lesson OR quiz)
  var all = getAllLessonsOrdered();
  if (all.length > 0) {
    var first = all[0];
    var firstAction, firstIdAttr, firstTitle;
    if (first.kind === 'quiz') {
      firstAction = 'select-quiz';
      firstIdAttr = 'data-learn-quiz-id="' + first.item.id + '"';
      firstTitle = 'Quiz';
    } else {
      firstAction = 'select-lesson';
      firstIdAttr = 'data-learn-lesson-id="' + first.item.id + '"';
      firstTitle = first.item.title || (first.item.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson');
    }
    nav.innerHTML = '<div class="viewer-nav-btn viewer-nav-prev disabled"><span class="viewer-nav-label">← Previous</span><span class="viewer-nav-title"></span></div>'
      + '<a href="#" data-learn-action="' + firstAction + '" ' + firstIdAttr + ' class="viewer-nav-btn viewer-nav-next">'
      + '<span class="viewer-nav-label">Next →</span>'
      + '<span class="viewer-nav-title">' + escapeHtml(firstTitle) + '</span></a>';
  } else {
    nav.innerHTML = '';
  }
}

function showCourseCompletion() {
  currentLessonId = null;
  renderViewer();
  var content = document.getElementById('viewer-content');
  var nav = document.getElementById('viewer-nav');

  var total = viewerLessons.length;
  var completed = viewerProgress.length;
  var pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  var html = '<div style="text-align:center;padding:20px 0;">';
  html += '<div style="width:64px;height:64px;margin:0 auto 20px;background:var(--surface);border:1px solid var(--border);border-radius:50%;display:flex;align-items:center;justify-content:center;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>';
  html += '<div class="viewer-lesson-title" style="text-align:center;">Course Complete!</div>';
  html += '<div style="font-size:15px;color:var(--text);margin-bottom:24px;">' + completed + ' of ' + total + ' lessons completed (' + pct + '%)</div>';

  if (viewerCourse.completion_message) {
    html += '<div style="text-align:left;padding:20px 24px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:24px;">';
    html += '<div class="viewer-text">' + escapeHtml(viewerCourse.completion_message) + '</div>';
    html += '</div>';
  }

  html += '<a href="#" data-learn-action="back-to-dash" style="display:inline-block;padding:12px 28px;background:var(--btn-bg);color:var(--btn-text);border:none;border-radius:10px;font-size:14px;font-weight:500;text-decoration:none;font-family:DM Sans,sans-serif;">Back to My Courses</a>';
  html += '</div>';

  content.innerHTML = html;

  // Nav: prev is last item (lesson OR quiz), no next
  var all = getAllLessonsOrdered();
  if (all.length > 0) {
    var last = all[all.length - 1];
    var lastAction, lastIdAttr, lastTitle;
    if (last.kind === 'quiz') {
      lastAction = 'select-quiz';
      lastIdAttr = 'data-learn-quiz-id="' + last.item.id + '"';
      lastTitle = 'Quiz';
    } else {
      lastAction = 'select-lesson';
      lastIdAttr = 'data-learn-lesson-id="' + last.item.id + '"';
      lastTitle = last.item.title || (last.item.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson');
    }
    nav.innerHTML = '<a href="#" data-learn-action="' + lastAction + '" ' + lastIdAttr + ' class="viewer-nav-btn viewer-nav-prev">'
      + '<span class="viewer-nav-label">← Previous</span>'
      + '<span class="viewer-nav-title">' + escapeHtml(lastTitle) + '</span></a>'
      + '<div class="viewer-nav-btn viewer-nav-next disabled"><span class="viewer-nav-label">Next →</span><span class="viewer-nav-title"></span></div>';
  } else {
    nav.innerHTML = '';
  }
}

// Returns the curriculum sequence as an ordered array of mixed items:
//   [{kind: 'lesson', item: <lesson>}, {kind: 'quiz', item: <quiz>}, ...]
// Quizzes appear at the end of their module's lesson list, matching how
// they render visually in the sidebar and course overview. Used by the
// Prev/Next nav and by the Continue button on the quiz results screen.
function getAllLessonsOrdered() {
  var ordered = [];
  viewerModules.forEach(function(mod) {
    var modLessons = viewerLessons.filter(function(l) { return l.module_id === mod.id; });
    modLessons.forEach(function(l) { ordered.push({ kind: 'lesson', item: l }); });
    var modQuiz = viewerQuizzesByModule[mod.id];
    if (modQuiz) ordered.push({ kind: 'quiz', item: modQuiz });
  });
  return ordered;
}

// Compute the curriculum index AFTER which items are locked. Lock applies
// when the student hits a require_pass quiz they haven't passed yet -
// everything PAST that quiz is locked until they pass it.
//
// The quiz itself is NOT locked (they need to reach it to take it). Lessons
// BEFORE the unpassed quiz are also not locked (re-watching prior material
// should always work).
//
// Returns the index of the FIRST unpassed require_pass quiz in the sequence,
// or -1 if no such quiz exists (everything unlocked).
//
// Multiple require_pass quizzes: each one creates a lock zone. We return the
// FIRST one - everything after that index is locked until it's passed. Once
// passed, the next render call will find the next unpassed quiz (if any) and
// the lock progresses forward through the course. That's the intended UX:
// pass module 1's quiz, unlock module 2; pass module 2's quiz, unlock module
// 3; etc.
function getLockBoundaryIndex() {
  var all = getAllLessonsOrdered();
  for (var i = 0; i < all.length; i++) {
    var entry = all[i];
    if (entry.kind === 'quiz'
        && entry.item.require_pass === true
        && !viewerPassedQuizIds.has(entry.item.id)) {
      return i;
    }
  }
  return -1;
}

// Given an index into the curriculum sequence, returns true if that item is
// locked due to an unpassed require_pass quiz earlier in the sequence.
function isCurriculumItemLocked(idx) {
  var boundary = getLockBoundaryIndex();
  if (boundary === -1) return false; // no unpassed gates
  return idx > boundary; // strictly after the gate
}

function getCurrentLessonIndex() {
  var all = getAllLessonsOrdered();
  // currentLessonId is either a raw lesson UUID OR 'quiz:<quizId>' for quiz
  // items. Distinguish by prefix.
  var isQuiz = typeof currentLessonId === 'string' && currentLessonId.indexOf('quiz:') === 0;
  var lookupId = isQuiz ? currentLessonId.slice(5) : currentLessonId;
  var lookupKind = isQuiz ? 'quiz' : 'lesson';
  for (var i = 0; i < all.length; i++) {
    if (all[i].kind === lookupKind && all[i].item.id === lookupId) return i;
  }
  return -1;
}

function getModuleForLesson(lessonId) {
  var lesson = viewerLessons.find(function(l) { return l.id === lessonId; });
  if (!lesson) return null;
  return viewerModules.find(function(m) { return m.id === lesson.module_id; });
}

function updateProgressBar() {
  var total = viewerLessons.length;
  if (total === 0) return;
  var completed = viewerProgress.length;
  var pct = Math.round((completed / total) * 100);
  var fill = document.getElementById('viewer-progress-fill');
  if (fill) fill.style.width = pct + '%';
}

function toggleToc() {
  var toc = document.getElementById('viewer-toc');
  toc.classList.toggle('open');
}

function renderViewer() {
  var sidebar = document.getElementById('viewer-sidebar');

  // Precompute the set of locked item identifiers. An item is locked when
  // there's an unpassed require_pass quiz earlier in the curriculum
  // sequence. The quiz at the gate itself is NOT locked - the student needs
  // to reach it to take it. Identifiers use the same shape as
  // currentLessonId: raw UUID for lessons, 'quiz:<id>' for quizzes.
  var all = getAllLessonsOrdered();
  var lockedIds = new Set();
  var boundary = getLockBoundaryIndex();
  if (boundary !== -1) {
    for (var li = boundary + 1; li < all.length; li++) {
      var entry = all[li];
      lockedIds.add(entry.kind === 'quiz' ? ('quiz:' + entry.item.id) : entry.item.id);
    }
  }

  // Lock icon SVG - reused for both locked lessons and locked quizzes
  var lockIconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  sidebar.innerHTML = viewerModules.map(function(mod, mi) {
    var modLessons = viewerLessons.filter(function(l) { return l.module_id === mod.id; });
    var modQuiz = viewerQuizzesByModule[mod.id] || null;
    return '<div class="viewer-module-title">Module ' + (mi + 1) + ': ' + escapeHtml(mod.title) + '</div>'
      + modLessons.map(function(l) {
        var isCompleted = viewerProgress.indexOf(l.id) !== -1;
        var isActive = l.id === currentLessonId;
        var isLocked = lockedIds.has(l.id);
        var icon = l.lesson_type === 'video' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
        var leadingIcon = isLocked
          ? lockIconHtml
          : (isCompleted ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '');
        // Locked items become a plain div (no click handler) with a tooltip
        // explaining why. Sidebar's freedom-of-navigation intent stays - the
        // student still SEES the locked item exists - but the click is gated.
        if (isLocked) {
          return '<div class="viewer-lesson-btn viewer-lesson-locked" title="Pass the required quiz to unlock">'
            + '<span class="viewer-check">' + leadingIcon + '</span>'
            + '<span>' + icon + ' ' + escapeHtml(l.title || (l.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson')) + '</span>'
            + '</div>';
        }
        return '<button class="viewer-lesson-btn' + (isActive ? ' active' : '') + (isCompleted ? ' completed' : '') + '" data-learn-action="select-lesson" data-learn-lesson-id="' + l.id + '">'
          + '<span class="viewer-check">' + leadingIcon + '</span>'
          + '<span>' + icon + ' ' + escapeHtml(l.title || (l.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson')) + '</span>'
          + '</button>';
      }).join('')
      // Quiz item, if this module has one. Always renders at the end of the
      // module's lesson list. Marked completed when the student has passed
      // (only meaningful for require_pass quizzes; for non-require-pass we
      // mark completed once they've submitted at least once - which we'll
      // track in D2 with a separate "viewed" mechanism since pass records
      // only get written for require_pass).
      + (modQuiz ? (function() {
          var hasPassed = viewerPassedQuizIds.has(modQuiz.id);
          var isActive = currentLessonId === ('quiz:' + modQuiz.id);
          var quizSidebarId = 'quiz:' + modQuiz.id;
          var isLocked = lockedIds.has(quizSidebarId);
          var qIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
          var leadingIcon = isLocked
            ? lockIconHtml
            : (hasPassed ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '');
          var requiredBadge = modQuiz.require_pass ? '<span class="viewer-quiz-required">Required</span>' : '';
          var qCount = Array.isArray(modQuiz.questions) ? modQuiz.questions.length : 0;
          if (isLocked) {
            return '<div class="viewer-lesson-btn viewer-quiz-btn viewer-lesson-locked" title="Pass the required quiz to unlock">'
              + '<span class="viewer-check">' + leadingIcon + '</span>'
              + '<span>' + qIcon + ' Quiz (' + qCount + ' question' + (qCount === 1 ? '' : 's') + ')' + requiredBadge + '</span>'
              + '</div>';
          }
          return '<button class="viewer-lesson-btn viewer-quiz-btn' + (isActive ? ' active' : '') + (hasPassed ? ' completed' : '') + '" data-learn-action="select-quiz" data-learn-quiz-id="' + modQuiz.id + '">'
            + '<span class="viewer-check">' + leadingIcon + '</span>'
            + '<span>' + qIcon + ' Quiz (' + qCount + ' question' + (qCount === 1 ? '' : 's') + ')' + requiredBadge + '</span>'
            + '</button>';
        })() : '');
  }).join('');

  updateProgressBar();
}

// =============================================================================
// VIEWER-SIDE SANITIZATION (defense in depth)
// =============================================================================
// The editor (js/course.js) sanitizes lesson HTML before saving to the DB, so
// stored text_content is normally already clean. But trusting the stored
// content alone is a single layer, if anything ever bypasses the editor
// (devtools, future bug, admin compromise, direct Supabase JS client write),
// the viewer would render unfiltered HTML to students. We sanitize on read
// too. ~25 KB loaded lazily on first text lesson view.

var ALLOWED_LESSON_CLASSES = new Set([
  'ql-align-center', 'ql-align-right',
  'lesson-img-size-small', 'lesson-img-size-medium', 'lesson-img-size-large'
]);

var VIEWER_PURIFY_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'img', 'span', 'div'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  ADD_ATTR: ['target']
};

// Idempotent install of the DOMPurify class-whitelist + safe-link + alt-default
// hook. Both ensureViewerPurifyLoaded (first DOMPurify load via the lesson
// path) and the course-description sanitize path call this. The flag guards
// against double-installation: each addHook call registers another listener
// that runs on every sanitize, so we install at most one.
var _learnPagePurifyHookInstalled = false;
function installLearnPageClassHook() {
  if (_learnPagePurifyHookInstalled || typeof DOMPurify === 'undefined') return;
  _learnPagePurifyHookInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', function(node) {
    if (node.hasAttribute && node.hasAttribute('class')) {
      var classes = (node.getAttribute('class') || '').split(/\s+/).filter(function(c) {
        return c && ALLOWED_LESSON_CLASSES.has(c);
      });
      if (classes.length) {
        node.setAttribute('class', classes.join(' '));
      } else {
        node.removeAttribute('class');
      }
    }
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
    // WCAG: ensure every <img> has an alt attribute. Mirrors the
    // editor-side hook in course.js. Existing images without alt get
    // an empty alt (decorative) on first view, regardless of when
    // they were originally inserted.
    if (node.tagName === 'IMG' && !node.hasAttribute('alt')) {
      node.setAttribute('alt', '');
    }
  });
}

var _viewerPurifyLoadPromise = null;
function ensureViewerPurifyLoaded() {
  if (typeof DOMPurify !== 'undefined') {
    // DOMPurify already loaded by some other path. Still ensure the hook is
    // installed before resolving so callers can rely on class filtering.
    installLearnPageClassHook();
    return Promise.resolve();
  }
  if (_viewerPurifyLoadPromise) return _viewerPurifyLoadPromise;
  _viewerPurifyLoadPromise = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.3/purify.min.js';
    s.integrity = 'sha512-Ll+TuDvrWDNNRnFFIM8dOiw7Go7dsHyxRp4RutiIFW/wm3DgDmCnRZow6AqbXnCbpWu93yM1O34q+4ggzGeXVA==';
    s.crossOrigin = 'anonymous';
    s.onload = function() {
      installLearnPageClassHook();
      resolve();
    };
    s.onerror = function() {
      _viewerPurifyLoadPromise = null;
      reject(new Error('Failed to load DOMPurify'));
    };
    document.head.appendChild(s);
  });
  return _viewerPurifyLoadPromise;
}

function sanitizeLessonHtmlForView(html) {
  if (typeof DOMPurify === 'undefined') return ''; // shouldn't happen, caller awaits loader
  // Apply the same render-time cleanups the description landing pages use,
  // for the same reasons:
  //   - Strip empty paragraph spacers ('<p><br></p>') that Quill inserts for
  //     visible blank lines while editing. Stored content preserves them so
  //     the editor round-trip looks right, but on render they combine with
  //     paragraph margins to create a doubled visual gap between paragraphs.
  //   - Trim whitespace at the boundaries of block tags. Quill can leave
  //     stray spaces that render as inconsistent extra spacing.
  //   - Unwrap href-less <a> tags (visually styled but unclickable, usually
  //     from old data saved before the Quill link-sanitize patch).
  var cleaned = String(html || '');
  cleaned = cleaned.replace(/(\s+)<\/(p|h2|h3|li)>/g, '</$2>');
  cleaned = cleaned.replace(/<(p|h2|h3|li)([^>]*)>\s+/g, '<$1$2>');
  cleaned = cleaned.replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, '');
  cleaned = cleaned.replace(/<p>\s*<\/p>/gi, '');
  cleaned = cleaned.replace(/<a(?:\s+(?!href=)[^>]*)?>(.*?)<\/a>/gi, '$1');
  cleaned = cleaned.replace(/<a\s+href=["']?["']?\s*>(.*?)<\/a>/gi, '$1');
  return DOMPurify.sanitize(cleaned, VIEWER_PURIFY_CONFIG);
}

function selectLesson(lessonId) {
  // Lock check - if this lesson is past an unpassed require_pass quiz,
  // bounce back to course overview rather than letting the student view
  // the content. Defense for deep-linked URLs and stale navigation state
  // (e.g., creator added a require_pass quiz after student already opened
  // a deep-linked lesson).
  var all = getAllLessonsOrdered();
  var boundary = getLockBoundaryIndex();
  if (boundary !== -1) {
    for (var i = boundary + 1; i < all.length; i++) {
      if (all[i].kind === 'lesson' && all[i].item.id === lessonId) {
        showCourseOverview();
        return;
      }
    }
  }

  currentLessonId = lessonId;
  renderViewer();
  // Close TOC on mobile after selecting
  document.getElementById('viewer-toc').classList.remove('open');

  var lesson = viewerLessons.find(function(l) { return l.id === lessonId; });
  if (!lesson) return;

  var content = document.getElementById('viewer-content');
  var isCompleted = viewerProgress.indexOf(lessonId) !== -1;
  var mod = getModuleForLesson(lessonId);
  var modIndex = viewerModules.indexOf(mod);

  // Lesson header
  var html = '';
  if (mod) {
    html += '<div class="viewer-lesson-header">Module ' + (modIndex + 1) + ': ' + escapeHtml(mod.title) + '</div>';
  }
  html += '<div class="viewer-lesson-title">' + escapeHtml(lesson.title || (lesson.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson')) + '</div>';

  // Content
  if (lesson.lesson_type === 'video') {
    if (lesson.bunny_video_id && lesson.bunny_video_status === 'failed') {
      // Genuinely failed - nothing to play.
      html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:24px;text-align:center;color:var(--muted);font-size:14px;margin-bottom:16px;">' + escapeHtml('This video failed to process. The creator has been notified.') + '</div>';
    } else if (lesson.bunny_video_id) {
      // Has a Bunny video. Render the player and let fetchBunnyPlaybackUrl
      // request a signed URL. Note: we do this even when the DB status is
      // still 'processing'/'uploading' - the token endpoint self-heals by
      // checking Bunny directly, so a stale 'processing' row that Bunny has
      // actually finished will still play. If it is genuinely not ready, the
      // token call returns 425 and fetchBunnyPlaybackUrl shows a message.
      //
      // The wrap + overlay structure exists to show a "Loading video..."
      // message while the iframe loads. Without this, the user sees a
      // black box for a few seconds during fetch+iframe-load. The overlay
      // is hidden when the iframe's load event fires (sub-second to ~3s
      // on normal connections). If the load event doesn't fire within 10
      // seconds, the message changes to a "taking longer than expected"
      // hint with a refresh suggestion - rare, but better than silent
      // abandonment.
      html += '<div class="viewer-video-wrap" id="bunny-wrap-' + escapeHtml(lesson.id) + '">'
        + '<div class="viewer-video-overlay" id="bunny-overlay-' + escapeHtml(lesson.id) + '">'
        + '<div class="viewer-video-overlay-spinner"></div>'
        + '<div class="viewer-video-overlay-text">Loading video...</div>'
        + '</div>'
        + '<iframe class="viewer-video" id="bunny-player-' + escapeHtml(lesson.id) + '" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>'
        + '</div>';
    } else if (lesson.video_url) {
      // Legacy paste-URL path (YouTube/Vimeo/Loom)
      var embedUrl = getEmbedUrl(lesson.video_url);
      if (embedUrl) {
        html += '<iframe class="viewer-video" src="' + embedUrl + '" allowfullscreen></iframe>';
      } else {
        html += '<p style="color:var(--muted);font-size:14px;margin-bottom:16px;">Video: <a href="' + escapeHtml(lesson.video_url) + '" target="_blank" style="color:var(--text);text-decoration:underline;">' + escapeHtml(lesson.video_url) + '</a></p>';
      }
    }
  }
  if (lesson.text_content) {
    // Editor (js/course.js mountLessonEditor) sanitizes content with DOMPurify
    // before saving to text_content. We sanitize AGAIN on read here as
    // defense in depth. If anything ever puts unsanitized HTML in the DB
    // (devtools bypass, future bug, admin compromise), the viewer still
    // refuses to render it.
    // Legacy plain-text lessons (saved before the rich text editor) won't
    // contain HTML tags, wrap those in a <p> with escaped contents so they
    // render with paragraph styling instead of as one inline blob. Plain
    // text doesn't need DOMPurify (escapeHtml already neutralizes it).
    // NOTE: variable name is `richHtml`, NOT `content`, because the outer
    // function uses `content` for the DOM container, see selectLesson body.
    var richHtml = lesson.text_content;
    var isHtmlContent = /<[a-z]/i.test(richHtml);
    if (!isHtmlContent) {
      richHtml = '<p>' + escapeHtml(richHtml).replace(/\n/g, '<br>') + '</p>';
      html += '<div class="viewer-text">' + richHtml + '</div>';
    } else {
      // HTML content path. Emit a placeholder slot the async renderer will
      // populate AFTER DOMPurify loads + sanitizes. The slot has a stable id
      // so we can target it without rebuilding the whole viewer-content.
      html += '<div class="viewer-text" id="viewer-text-pending"></div>';
    }
  }
  // Lesson images, text lessons only (video lessons embed the video itself).
  // Mirrors the editor-side gating in js/course.js so orphan images that may
  // exist on legacy video lessons don't leak into the viewer.
  var isVideoLesson = lesson.lesson_type === 'video';
  if (!isVideoLesson && lesson.images && lesson.images.length > 0) {
    html += '<div style="margin-top:20px;display:flex;flex-direction:column;gap:16px;">';
    lesson.images.forEach(function(url) {
      html += '<img src="' + escapeHtml(url) + '" alt="Lesson image" style="width:100%;max-width:800px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">';
    });
    html += '</div>';
  }
  // Empty-state fallback. For text lessons, count images as content; for video
  // lessons, ignore them (images don't render in viewer for video lessons).
  // A Bunny-uploaded video counts as content even when video_url is null.
  var hasImages = !isVideoLesson && lesson.images && lesson.images.length > 0;
  var hasVideo = isVideoLesson && (lesson.video_url || lesson.bunny_video_id);
  if (!hasVideo && !lesson.text_content && !hasImages) {
    html += '<p style="color:var(--muted);font-size:14px;">This lesson has no content yet.</p>';
  }

  // Downloads section. Shown only if this lesson has attached files. The
  // download action goes through /api/download-lesson-file which gates by
  // enrollment (or free-preview status). Each file becomes a row with a
  // download icon, filename, size, and a clickable download link.
  var lessonFiles = viewerLessonFiles[lesson.id] || [];
  if (lessonFiles.length > 0) {
    html += '<div class="viewer-downloads">';
    html += '<div class="viewer-downloads-title">Downloads</div>';
    html += '<div class="viewer-downloads-list">';
    lessonFiles.forEach(function(f) {
      var sizeText = formatBytesSimple(f.file_size_bytes);
      html += '<button type="button" class="viewer-download-row" data-learn-action="download-lesson-file" data-learn-file-id="' + escapeHtml(f.id) + '" aria-label="Download ' + escapeHtml(f.filename) + '">'
        + '<svg class="viewer-download-icn" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
        + '<span class="viewer-download-name">' + escapeHtml(f.filename) + '</span>'
        + '<span class="viewer-download-size">' + sizeText + '</span>'
        + '<svg class="viewer-download-arr" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
        + '</button>';
    });
    html += '</div></div>';
  }

  // Complete button
  if (isCompleted) {
    html += '<div class="viewer-completed-msg"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Completed</div>';
  } else {
    html += '<button class="viewer-complete-btn" data-learn-action="mark-complete" data-learn-lesson-id="' + lessonId + '">Mark as Complete</button>';
  }

  content.innerHTML = html;

  // If this lesson is a Bunny-hosted video, fetch the signed iframe URL
  // and inject it into the placeholder iframe element. The /api/bunny-video-token
  // endpoint verifies enrollment (or free-preview status) before returning
  // a signed URL. Without a successful token call, the iframe stays blank.
  // We pass lessonId (the function parameter, captured at call time) so the
  // race-guard inside fetchBunnyPlaybackUrl can compare against the current
  // currentLessonId and drop the result if the viewer navigated away.
  // Fetch the signed iframe URL for any Bunny video that isn't a hard
  // 'failed'. The /api/bunny-video-token endpoint verifies enrollment and
  // self-heals a stale 'processing' status by checking Bunny directly, so
  // a video Bunny has finished will play even if the DB row lagged behind.
  if (lesson.lesson_type === 'video' && lesson.bunny_video_id && lesson.bunny_video_status !== 'failed') {
    fetchBunnyPlaybackUrl(lesson.id, lessonId);
  }

  // If the lesson has HTML text content, load DOMPurify (if not loaded yet)
  // and fill the placeholder with the sanitized HTML. The placeholder
  // approach means the empty slot briefly exists before content appears on
  // first ever view, typically <300ms. Subsequent views are instant since
  // DOMPurify is cached. The slot is empty rather than showing raw HTML, so
  // we never render unfiltered content even for a frame.
  var pendingSlot = document.getElementById('viewer-text-pending');
  if (pendingSlot && lesson.text_content) {
    var lessonIdAtRender = lessonId;
    ensureViewerPurifyLoaded().then(function() {
      // Race-safety: user may have navigated to a different lesson while
      // DOMPurify was loading. Only fill if we're still on the same lesson.
      if (currentLessonId !== lessonIdAtRender) return;
      var stillThere = document.getElementById('viewer-text-pending');
      if (!stillThere) return;
      stillThere.innerHTML = sanitizeLessonHtmlForView(lesson.text_content);
      stillThere.removeAttribute('id'); // become a normal viewer-text div
    }).catch(function(err) {
      console.error('Lesson sanitizer failed to load, refusing to render rich content:', err);
      // Graceful degradation: show a message rather than risking unsanitized
      // render. Better to fail closed than fail open.
      var stillThere = document.getElementById('viewer-text-pending');
      if (stillThere && currentLessonId === lessonIdAtRender) {
        stillThere.textContent = 'Lesson content could not be loaded. Please refresh the page.';
        stillThere.style.color = 'var(--muted)';
        stillThere.style.fontSize = '14px';
        stillThere.removeAttribute('id');
      }
    });
  }

  // Render prev/next navigation
  renderLessonNav();

  // Scroll to top
  window.scrollTo(0, 0);
}

// Placeholder quiz player. The full player UI, submit handler, results
// screen, and progression gating are coming in the next deploy round (D2).
// For D1 we just confirm the quiz item flow works end-to-end:
//   - Sidebar renders the quiz item with the right metadata
//   - Clicking it routes through select-quiz -> selectQuiz()
//   - The right quiz data is available in viewerQuizzesByModule
// Quiz player. Renders an interactive quiz with radio-button answers,
// validates that all questions are answered before allowing submit, POSTs
// the submission to /api/grade-quiz, and renders a results screen.
//
// Local state lives in DOM attributes on the radio inputs - simpler than
// maintaining a parallel state object. The submit handler harvests selections
// by querying the rendered DOM at submit time.
//
// Results screen styling (per locked spec):
//   - Question student got right: green check icon next to it, no bg tint
//   - Question student got wrong: red bg tint on their pick + red X, green
//     bg tint on correct answer + green check
//   - Only available for non-require-pass quizzes (require-pass returns just
//     pass/fail to prevent iterative brute-force learning of correct answers)
function selectQuiz(quizId) {
  // Lock check - same as selectLesson, but for quizzes. The quiz AT the
  // boundary is reachable (the student needs to take it). Only quizzes
  // strictly PAST the boundary are blocked.
  var all = getAllLessonsOrdered();
  var boundary = getLockBoundaryIndex();
  if (boundary !== -1) {
    for (var i = boundary + 1; i < all.length; i++) {
      if (all[i].kind === 'quiz' && all[i].item.id === quizId) {
        showCourseOverview();
        return;
      }
    }
  }

  // Use a quiz: prefix on currentLessonId so the sidebar's active highlight
  // logic can distinguish quiz items from lesson items without collisions.
  currentLessonId = 'quiz:' + quizId;
  renderViewer();
  document.getElementById('viewer-toc').classList.remove('open');

  // Find the quiz by ID across all module quizzes
  var quiz = null;
  var moduleIds = Object.keys(viewerQuizzesByModule);
  for (var j = 0; j < moduleIds.length; j++) {
    if (viewerQuizzesByModule[moduleIds[j]].id === quizId) {
      quiz = viewerQuizzesByModule[moduleIds[j]];
      break;
    }
  }
  if (!quiz) return;
  renderQuizTaking(quiz);
  window.scrollTo(0, 0);
}

// Render the take-the-quiz screen (questions + radios + submit button).
// Separated from selectQuiz() so the retake flow can call it directly without
// re-running the find-by-id loop.
function renderQuizTaking(quiz) {
  var questions = Array.isArray(quiz.questions) ? quiz.questions : [];
  var qCount = questions.length;

  // Find the module this quiz belongs to so the header can say "Module N"
  var mod = null;
  var modIndex = -1;
  for (var i = 0; i < viewerModules.length; i++) {
    if (viewerModules[i].id === quiz.module_id) {
      mod = viewerModules[i];
      modIndex = i;
      break;
    }
  }

  var html = '';
  if (mod) {
    html += '<div class="viewer-lesson-header">Module ' + (modIndex + 1) + ': ' + escapeHtml(mod.title) + '</div>';
  }
  html += '<div class="viewer-lesson-title">Quiz</div>';
  html += '<div class="viewer-quiz-meta">'
    + qCount + ' question' + (qCount === 1 ? '' : 's')
    + (quiz.require_pass ? ' &middot; <strong>Must answer every question correctly to pass</strong>' : '')
    + '</div>';

  // Question list. Each radio has data attributes that the submit handler
  // reads to assemble the answers payload.
  html += '<div class="viewer-quiz-questions" id="viewer-quiz-questions">';
  questions.forEach(function(q, qi) {
    var answers = Array.isArray(q.answers) ? q.answers : [];
    html += '<div class="viewer-quiz-q" data-q-id="' + escapeHtml(q.id) + '">';
    html += '<div class="viewer-quiz-q-text"><span class="viewer-quiz-qnum">Q' + (qi + 1) + '.</span> ' + escapeHtml(q.text) + '</div>';
    html += '<div class="viewer-quiz-q-answers">';
    answers.forEach(function(a, ai) {
      // Radio group name uses the question id so radios within one question
      // are mutually exclusive but radios across questions don't interfere.
      var groupName = 'vq-' + q.id;
      html += '<label class="viewer-quiz-a" data-learn-action="quiz-answer-pick">'
        + '<input type="radio" name="' + escapeHtml(groupName) + '" value="' + escapeHtml(a.id) + '">'
        + '<span class="viewer-quiz-a-text">' + escapeHtml(a.text) + '</span>'
        + '</label>';
    });
    html += '</div></div>';
  });
  html += '</div>';

  // Submit button starts disabled. Enabled by quiz-answer-pick handler once
  // every question has a selection.
  html += '<div class="viewer-quiz-submit-row">'
    + '<button id="viewer-quiz-submit" data-learn-action="quiz-submit" data-learn-quiz-id="' + escapeHtml(quiz.id) + '" class="viewer-quiz-submit-btn" disabled>Submit</button>'
    + '</div>';

  var content = document.getElementById('viewer-content');
  content.innerHTML = html;

  // Render the standard Prev/Next nav. The gating logic in renderLessonNav
  // disables Next when the user is on a require_pass quiz that hasn't been
  // passed yet, so the student must submit and pass before advancing.
  renderLessonNav();
}

// Recompute the disabled state of the Submit button whenever a radio is
// picked. Submit is enabled only when every question has a selection.
function recomputeQuizSubmitState() {
  var wrap = document.getElementById('viewer-quiz-questions');
  if (!wrap) return;
  var questions = wrap.querySelectorAll('.viewer-quiz-q');
  var allAnswered = true;
  for (var i = 0; i < questions.length; i++) {
    var hasPick = questions[i].querySelector('input[type="radio"]:checked');
    if (!hasPick) { allAnswered = false; break; }
  }
  var btn = document.getElementById('viewer-quiz-submit');
  if (btn) btn.disabled = !allAnswered;
}

// Submit the quiz. Harvests selected radios from the DOM, POSTs to
// /api/grade-quiz, then renders the results screen.
async function submitQuiz(quizId) {
  var btn = document.getElementById('viewer-quiz-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Grading...'; }

  // Find the quiz in local state for the post-grade render
  var quiz = null;
  var moduleIds = Object.keys(viewerQuizzesByModule);
  for (var i = 0; i < moduleIds.length; i++) {
    if (viewerQuizzesByModule[moduleIds[i]].id === quizId) {
      quiz = viewerQuizzesByModule[moduleIds[i]];
      break;
    }
  }
  if (!quiz) { return; }

  // Harvest answers from DOM
  var wrap = document.getElementById('viewer-quiz-questions');
  var answers = [];
  if (wrap) {
    var qs = wrap.querySelectorAll('.viewer-quiz-q');
    for (var j = 0; j < qs.length; j++) {
      var qId = qs[j].getAttribute('data-q-id');
      var picked = qs[j].querySelector('input[type="radio"]:checked');
      if (qId && picked) {
        answers.push({ question_id: qId, answer_id: picked.value });
      }
    }
  }

  try {
    var sessionResp = await sb.auth.getSession();
    var token = sessionResp && sessionResp.data && sessionResp.data.session
      ? sessionResp.data.session.access_token : '';
    if (!token) {
      throw new Error('Your session has expired. Please log off and back in.');
    }

    var resp = await fetch('/api/grade-quiz', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ quiz_id: quizId, answers: answers })
    });
    var data = await resp.json();
    if (!resp.ok) {
      throw new Error((data && data.error) || 'Grading failed. Try again.');
    }

    // If passed AND require_pass, record the pass locally so the sidebar
    // checkmark updates without needing to re-fetch.
    if (data.passed && quiz.require_pass) {
      viewerPassedQuizIds.add(quiz.id);
    }

    renderQuizResults(quiz, data);
  } catch (e) {
    console.error('Quiz submit failed:', e);
    if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
    showModalAlert('Quiz error', e.message || 'Could not grade the quiz. Try again.');
  }
}

// Render the post-grade results screen. The shape depends on:
//   - quiz.require_pass:
//       true  -> only show pass/fail summary, no per-question detail
//                (server doesn't return it in this mode)
//       false -> show every question with student's pick + correct answer
//                highlighted per the locked styling spec
function renderQuizResults(quiz, gradeData) {
  var content = document.getElementById('viewer-content');
  if (!content) return;

  // Find module for header
  var mod = null;
  var modIndex = -1;
  for (var i = 0; i < viewerModules.length; i++) {
    if (viewerModules[i].id === quiz.module_id) {
      mod = viewerModules[i];
      modIndex = i;
      break;
    }
  }

  var html = '';
  if (mod) {
    html += '<div class="viewer-lesson-header">Module ' + (modIndex + 1) + ': ' + escapeHtml(mod.title) + '</div>';
  }
  html += '<div class="viewer-lesson-title">Quiz Results</div>';

  // Pass/fail banner
  if (gradeData.passed) {
    html += '<div class="viewer-quiz-banner viewer-quiz-banner-pass">'
      + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      + '<div><strong>Passed!</strong> '
      + gradeData.correct_count + ' of ' + gradeData.total_questions + ' correct.</div>'
      + '</div>';
  } else {
    html += '<div class="viewer-quiz-banner viewer-quiz-banner-fail">'
      + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      + '<div><strong>Not quite.</strong> '
      + gradeData.correct_count + ' of ' + gradeData.total_questions + ' correct.'
      + (quiz.require_pass ? ' Try again to pass this module.' : '')
      + '</div>'
      + '</div>';
  }

  // Per-question detail - only for non-require-pass quizzes. The server
  // doesn't return the results array when require_pass=true, so even if we
  // tried to render here, we'd have no data. Defense in depth.
  if (!quiz.require_pass && Array.isArray(gradeData.results)) {
    // Build a quick map of correct-answer-id and your-answer-id per question
    var resultByQId = {};
    gradeData.results.forEach(function(r) { resultByQId[r.question_id] = r; });

    var questions = Array.isArray(quiz.questions) ? quiz.questions : [];
    html += '<div class="viewer-quiz-questions">';
    questions.forEach(function(q, qi) {
      var result = resultByQId[q.id];
      // Question-level result flag from the server. Currently unused in the
      // render below (we use per-answer isCorrect/wasPicked for class
      // assignment), but kept for potential future use - e.g., adding a
      // "Q1 ✓" / "Q1 ✗" indicator next to the question text.
      // var wasCorrect = result && result.was_correct;
      var correctId = result ? result.correct_answer_id : null;
      var yourId = result ? result.your_answer_id : null;

      html += '<div class="viewer-quiz-q">';
      html += '<div class="viewer-quiz-q-text"><span class="viewer-quiz-qnum">Q' + (qi + 1) + '.</span> ' + escapeHtml(q.text) + '</div>';
      html += '<div class="viewer-quiz-q-answers">';

      var answers = Array.isArray(q.answers) ? q.answers : [];
      answers.forEach(function(a) {
        var isCorrect = (a.id === correctId);
        var wasPicked = (a.id === yourId);
        // Class assignment per the locked spec:
        //   - On a right-answered question: only the correct answer gets the
        //     ✓ icon, no bg highlight (don't dwell on success)
        //   - On a wrong-answered question: student's pick gets red bg + ✕,
        //     correct answer gets green bg + ✓
        var cls = 'viewer-quiz-a-result';
        var iconHtml = '';
        if (isCorrect && wasPicked) {
          // Right answer (got it). Light green-check, no bg.
          cls += ' viewer-quiz-a-right';
          iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        } else if (isCorrect && !wasPicked) {
          // Correct answer, but student picked something else
          cls += ' viewer-quiz-a-correct-reveal';
          iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        } else if (!isCorrect && wasPicked) {
          // Student's wrong pick
          cls += ' viewer-quiz-a-wrong';
          iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        }
        // else: neither correct nor picked - no styling, no icon

        html += '<div class="' + cls + '">'
          + '<span class="viewer-quiz-a-icon">' + iconHtml + '</span>'
          + '<span class="viewer-quiz-a-text">' + escapeHtml(a.text) + '</span>'
          + '</div>';
      });

      html += '</div></div>';
    });
    html += '</div>';
  }

  // Action row. Three cases:
  //   require_pass + failed   -> Retake only (must pass to continue)
  //   require_pass + passed   -> Continue only (pass already recorded)
  //   non-require_pass + any  -> Retake + Continue (practice freely; Retake
  //                              is optional, doesn't block progression)
  html += '<div class="viewer-quiz-submit-row">';
  if (quiz.require_pass) {
    if (gradeData.passed) {
      html += '<button data-learn-action="quiz-continue" class="viewer-quiz-submit-btn">Continue</button>';
    } else {
      html += '<button data-learn-action="quiz-retake" data-learn-quiz-id="' + escapeHtml(quiz.id) + '" class="viewer-quiz-submit-btn">Retake</button>';
    }
  } else {
    // Non-require_pass: both buttons. Retake is the secondary action (outline
    // style), Continue is primary (filled). Continue always present so the
    // student is never stuck on the results screen.
    html += '<button data-learn-action="quiz-retake" data-learn-quiz-id="' + escapeHtml(quiz.id) + '" class="viewer-quiz-submit-btn viewer-quiz-submit-btn-secondary">Retake</button>';
    html += '<button data-learn-action="quiz-continue" class="viewer-quiz-submit-btn">Continue</button>';
  }
  html += '</div>';

  content.innerHTML = html;

  // Refresh sidebar so the quiz's passed-checkmark updates if applicable
  renderViewer();
  // Render the Prev/Next nav. Gating logic in renderLessonNav reads
  // viewerPassedQuizIds, which we just updated above for require_pass passes,
  // so Next will now be enabled if the student just passed.
  renderLessonNav();
  window.scrollTo(0, 0);
}

// Builds the action attributes + display title for a single nav button
// pointing at the given curriculum item. Used by Prev and Next buttons
// across the lesson player, course overview, and course completion screens.
function buildNavButtonAttrs(navItem) {
  if (navItem.kind === 'quiz') {
    return {
      action: 'select-quiz',
      idAttr: 'data-learn-quiz-id="' + navItem.item.id + '"',
      title: 'Quiz'
    };
  }
  var l = navItem.item;
  return {
    action: 'select-lesson',
    idAttr: 'data-learn-lesson-id="' + l.id + '"',
    title: l.title || (l.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson')
  };
}

function renderLessonNav() {
  var nav = document.getElementById('viewer-nav');
  var all = getAllLessonsOrdered();
  var idx = getCurrentLessonIndex();

  var prevHtml = '';
  var nextHtml = '';

  if (idx > 0) {
    var prev = buildNavButtonAttrs(all[idx - 1]);
    prevHtml = '<a href="#" data-learn-action="' + prev.action + '" ' + prev.idAttr + ' class="viewer-nav-btn viewer-nav-prev">'
      + '<span class="viewer-nav-label">← Previous</span>'
      + '<span class="viewer-nav-title">' + escapeHtml(prev.title) + '</span>'
      + '</a>';
  } else {
    prevHtml = '<a href="#" data-learn-action="show-course-overview" class="viewer-nav-btn viewer-nav-prev">'
      + '<span class="viewer-nav-label">← Previous</span>'
      + '<span class="viewer-nav-title">Course Overview</span>'
      + '</a>';
  }

  // Next-button gating: when the current item is a require_pass quiz that
  // hasn't been passed, Next is disabled. The student must pass before
  // moving on. They can still click Previous or pick another sidebar item
  // (the sidebar is the escape hatch for re-watching prior lessons), but
  // forward motion via Next requires passing.
  var current = idx >= 0 ? all[idx] : null;
  var blockedByQuiz = current
    && current.kind === 'quiz'
    && current.item.require_pass === true
    && !viewerPassedQuizIds.has(current.item.id);

  if (idx < all.length - 1) {
    if (blockedByQuiz) {
      nextHtml = '<div class="viewer-nav-btn viewer-nav-next disabled" title="Pass this quiz to continue">'
        + '<span class="viewer-nav-label">Next →</span>'
        + '<span class="viewer-nav-title">Pass quiz to continue</span>'
        + '</div>';
    } else {
      var next = buildNavButtonAttrs(all[idx + 1]);
      nextHtml = '<a href="#" data-learn-action="' + next.action + '" ' + next.idAttr + ' class="viewer-nav-btn viewer-nav-next">'
        + '<span class="viewer-nav-label">Next →</span>'
        + '<span class="viewer-nav-title">' + escapeHtml(next.title) + '</span>'
        + '</a>';
    }
  } else {
    // No next item - either course-complete CTA, or blocked if final item is
    // a require_pass quiz that wasn't passed
    if (blockedByQuiz) {
      nextHtml = '<div class="viewer-nav-btn viewer-nav-next disabled" title="Pass this quiz to complete">'
        + '<span class="viewer-nav-label">Next →</span>'
        + '<span class="viewer-nav-title">Pass quiz to complete</span>'
        + '</div>';
    } else {
      nextHtml = '<a href="#" data-learn-action="show-course-completion" class="viewer-nav-btn viewer-nav-next">'
        + '<span class="viewer-nav-label">Next →</span>'
        + '<span class="viewer-nav-title">Course Complete</span>'
        + '</a>';
    }
  }

  nav.innerHTML = prevHtml + nextHtml;
}

async function markComplete(lessonId) {
  if (!viewerEnrollmentId) return;
  try {
    await sb.from('course_progress').insert({ enrollment_id: viewerEnrollmentId, lesson_id: lessonId });
    if (viewerProgress.indexOf(lessonId) === -1) viewerProgress.push(lessonId);
    selectLesson(lessonId);
    renderViewer();
  } catch (err) {
    console.warn('Mark complete failed:', err);
  }
}

function backToDash() {
  // Clear URL params
  window.history.replaceState({}, '', '/learn/');
  document.getElementById('viewer-screen').style.display = 'none';
  loadAllSections();
}

function getEmbedUrl(url) {
  // NOTE: detectVideoPlatform() in js/course.js mirrors the regex patterns
  // below for the editor's validation indicator. If you add or modify a
  // platform here, update both functions or the editor will get out of sync
  // with what actually embeds.
  if (!url) return null;
  // YouTube. Includes Shorts. The /embed/ URL works for both regular videos
  // and shorts; YouTube auto-handles vertical aspect when rendering.
  var ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return 'https://www.youtube.com/embed/' + ytMatch[1];
  // Vimeo
  var vmMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vmMatch) return 'https://player.vimeo.com/video/' + vmMatch[1];
  // Loom
  var loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
  if (loomMatch) return 'https://www.loom.com/embed/' + loomMatch[1];
  return null;
}

// Fetch a signed Bunny iframe playback URL for a lesson the viewer is
// enrolled in (or that's marked as a free preview). The token API verifies
// enrollment server-side; if the viewer isn't enrolled they get a 403 and
// the iframe stays blank with a friendly fallback message.
//
// lessonIdAtRender: captured at call-time so a stale fetch arriving after
// the user navigated to another lesson doesn't overwrite the new iframe.
async function fetchBunnyPlaybackUrl(lessonId, lessonIdAtRender) {
  var iframe = document.getElementById('bunny-player-' + lessonId);
  if (!iframe) return;
  // The wrap is the visual container - iframe + loading overlay live inside it.
  // Failure paths replace THE WRAP, not the iframe directly, so the layout
  // stays correct when we render an error message in its place.
  var wrap = document.getElementById('bunny-wrap-' + lessonId);
  var overlay = document.getElementById('bunny-overlay-' + lessonId);

  // Helper: replace the entire video block (wrap + overlay + iframe) with
  // an error message. Used by both 4xx/5xx and exception failure paths.
  function showError(text) {
    if (!wrap || !wrap.parentNode) return;
    var div = document.createElement('div');
    div.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:24px;text-align:center;color:var(--muted);font-size:14px;margin-bottom:16px;';
    div.textContent = text;
    wrap.parentNode.replaceChild(div, wrap);
  }

  var headers = { 'Content-Type': 'application/json' };
  // If the viewer is signed in, include the bearer token so non-preview
  // lessons can be authorized. Anonymous viewers can still get tokens for
  // free preview lessons (server checks lesson.is_preview).
  // NOTE: the learn page does NOT load dashboard-shell.js, so the global
  // `Auth` object is absent here. Use the Supabase session pattern that the
  // rest of learn-page.js uses for authed requests.
  try {
    var sessionResp = await sb.auth.getSession();
    var token = sessionResp && sessionResp.data && sessionResp.data.session
      ? sessionResp.data.session.access_token : '';
    if (token) headers.Authorization = 'Bearer ' + token;
  } catch (e) {
    // No session - we'll send the request without an Authorization header.
    // Free-preview lessons will still work; non-preview lessons will get 401.
  }
  try {
    var resp = await fetch('/api/bunny-video-token', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ lesson_id: lessonId })
    });
    var data = await resp.json();
    // Race-guard: if the viewer navigated to a different lesson while this
    // request was in flight, drop the result rather than poking at the wrong
    // iframe. currentLessonId is the canonical "what lesson is showing now."
    if (typeof currentLessonId !== 'undefined' && currentLessonId !== lessonIdAtRender) return;
    if (!resp.ok) {
      showError((data && data.error) || 'Video could not be loaded.');
      return;
    }
    if (data.iframe_url) {
      // Wire up overlay management BEFORE setting src, so we don't miss a
      // fast 'load' event on cached responses.
      if (overlay) {
        var overlayHidden = false;
        var fallbackTimer = null;

        var hideOverlay = function() {
          if (overlayHidden) return;
          overlayHidden = true;
          if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
          // Fade out (CSS handles the transition) then remove from DOM
          // so it's not over the video even with pointer-events:none on it.
          overlay.style.opacity = '0';
          setTimeout(function() {
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
          }, 250);
        };

        iframe.addEventListener('load', hideOverlay, { once: true });

        // Failsafe: if the load event never fires within 10s, change the
        // overlay message to something actionable. Common cause is a
        // network or CDN hiccup. Better than silent abandonment.
        fallbackTimer = setTimeout(function() {
          if (overlayHidden) return;
          var textEl = overlay.querySelector('.viewer-video-overlay-text');
          if (textEl) textEl.textContent = 'Video taking longer than expected. Try refreshing if it doesn\'t appear.';
          var spinner = overlay.querySelector('.viewer-video-overlay-spinner');
          if (spinner) spinner.style.display = 'none';
        }, 10000);
      }

      iframe.src = data.iframe_url;
    }
  } catch (e) {
    console.error('Bunny token fetch failed:', e);
    showError('Video could not be loaded. Check your connection and try again.');
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

// Compact byte formatter for the Downloads UI. Mirrors the digital-products
// version (FileValidation.formatBytes) but inlined here because learn-page.js
// doesn't load file-validation.js - that module is dashboard-only.
function formatBytesSimple(bytes) {
  bytes = Number(bytes || 0);
  if (bytes === 0) return '0 MB';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Handle Enter key on auth inputs
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && (e.target.id === 'auth-email' || e.target.id === 'auth-password')) {
    handleAuth();
  }
});

// =====================================================
// MARKETPLACE SEARCH
// =====================================================
let mpDebounce = null;

function openMarketplace() {
  // Hide main content, show marketplace
  document.getElementById('learn-main').style.display = 'none';
  document.getElementById('mp-screen').style.display = 'block';
  setTimeout(function() { document.getElementById('mp-search-input').focus(); }, 100);
}

function closeMarketplace() {
  document.getElementById('mp-screen').style.display = 'none';
  document.getElementById('learn-main').style.display = 'block';
  document.getElementById('mp-search-input').value = '';
  document.getElementById('mp-results').innerHTML = '<div class="mp-empty">Start typing to discover courses, bookings, and digital products from creators on Ryxa.</div>';
}

document.addEventListener('input', function(e) {
  if (e.target.id !== 'mp-search-input') return;
  clearTimeout(mpDebounce);
  var q = e.target.value.trim();
  if (q.length < 2) {
    document.getElementById('mp-results').innerHTML = '<div class="mp-empty">Start typing to discover courses, bookings, and digital products from creators on Ryxa.</div>';
    return;
  }
  mpDebounce = setTimeout(function() { searchMarketplace(q); }, 300);
});

async function searchMarketplace(query) {
  var results = document.getElementById('mp-results');
  results.innerHTML = '<div class="mp-empty">Searching...</div>';

  try {
    // Search courses
    var { data: courses, error: cErr } = await sb
      .from('courses')
      .select('id, title, slug, price_cents, cover_image_path, user_id')
      .eq('status', 'published')
      .eq('listed_in_marketplace', true)
      .ilike('title', '%' + query + '%')
      .order('created_at', { ascending: false })
      .limit(10);

    // Search coaching
    var { data: coaching, error: coErr } = await sb
      .from('coaching_services')
      .select('id, title, slug, price_cents, cover_image_path, user_id')
      .eq('status', 'published')
      .eq('listed_in_marketplace', true)
      .ilike('title', '%' + query + '%')
      .order('created_at', { ascending: false })
      .limit(10);

    // Search digital products. Note: digital_products uses is_active (not status)
    // and stores cover_image_url as a full URL (not a storage path).
    var { data: products, error: pErr } = await sb
      .from('digital_products')
      .select('id, title, slug, price_cents, cover_image_url, user_id')
      .eq('is_active', true)
      .eq('listed_in_marketplace', true)
      .ilike('title', '%' + query + '%')
      .order('updated_at', { ascending: false })
      .limit(10);

    if (cErr) throw cErr;
    if (coErr) throw coErr;
    if (pErr) throw pErr;

    var items = [];
    (courses || []).forEach(function(c) { items.push(Object.assign({}, c, { _type: 'course' })); });
    (coaching || []).forEach(function(c) { items.push(Object.assign({}, c, { _type: 'coaching' })); });
    (products || []).forEach(function(c) { items.push(Object.assign({}, c, { _type: 'product' })); });

    if (items.length === 0) {
      results.innerHTML = '<div class="mp-empty">No results found for "' + escapeHtml(query) + '"</div>';
      return;
    }

    // Fetch usernames
    var userIds = [...new Set(items.map(function(c) { return c.user_id; }))];
    var usernameMap = {};
    if (userIds.length > 0) {
      var { data: profiles } = await sb.from('public_profiles').select('user_id, username').in('user_id', userIds);
      if (profiles) profiles.forEach(function(p) { usernameMap[p.user_id] = p.username; });
    }

    var html = '';
    items.forEach(function(c) {
      var username = usernameMap[c.user_id] || 'creator';
      var price = c.price_cents > 0 ? '$' + (c.price_cents / 100).toFixed(0) : 'Free';

      // Cover URL, courses/coaching use cover_image_path inside storage buckets;
      // digital_products stores cover_image_url as a full URL.
      var coverUrl = '';
      if (c._type === 'product') {
        coverUrl = c.cover_image_url || '';
      } else {
        var bucket = c._type === 'course' ? 'course-covers' : 'coaching-covers';
        coverUrl = c.cover_image_path
          ? 'https://kjytapcgxukalwsyputk.supabase.co/storage/v1/object/public/' + bucket + '/' + c.cover_image_path
          : '';
      }

      var pageUrl;
      var typeLabel;
      var typeClass = c._type;
      if (c._type === 'course') {
        pageUrl = '/course/' + encodeURIComponent(c.slug);
        typeLabel = 'Course';
      } else if (c._type === 'coaching') {
        pageUrl = '/booking/' + encodeURIComponent(c.slug);
        typeLabel = '1:1 Booking';
      } else {
        pageUrl = '/product/' + encodeURIComponent(c.slug);
        typeLabel = 'Digital Product';
      }

      html += '<a href="' + pageUrl + '" class="mp-item">';
      if (coverUrl) {
        html += '<img src="' + escapeHtml(coverUrl) + '" class="mp-item-cover" alt="Cover">';
      } else {
        html += '<div class="mp-item-cover" style="display:flex;align-items:center;justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>';
      }
      html += '<div class="mp-item-info">';
      html += '<div class="mp-item-title">' + escapeHtml(c.title) + '</div>';
      html += '<div class="mp-item-creator">by @' + escapeHtml(username) + '</div>';
      html += '</div>';
      html += '<span class="mp-item-type ' + typeClass + '">' + typeLabel + '</span>';
      html += '<div class="mp-item-price">' + price + '</div>';
      html += '</a>';
    });

    results.innerHTML = html;
  } catch (err) {
    console.error('Marketplace search error:', err);
    results.innerHTML = '<div class="mp-empty" style="color:#f87171;">Something went wrong. Try again.</div>';
  }
}

init();


// =================================================================
// ACTION REGISTRATIONS - wire data-learn-action attributes to handlers
// =================================================================

// Auth modal
learnRegisterAction('auth-mode-signin', function() { setLearnAuthMode('signin'); });
learnRegisterAction('auth-mode-signup', function() { setLearnAuthMode('signup'); });
learnRegisterAction('google-auth', function() { handleLearnGoogleAuth(); });
learnRegisterAction('apple-auth', function() { handleLearnAppleAuth(); });
learnRegisterAction('magic-link', function() { handleLearnMagicLink(); });
learnRegisterAction('toggle-social', function() { handleLearnToggleSocial(); });
learnRegisterAction('forgot-password', function() { handleLearnForgotPassword(); });
learnRegisterAction('auth', function() { handleAuth(); });

// Nav menu
learnRegisterAction('toggle-nav-menu', function() { toggleNavMenu(); });
learnRegisterAction('toggle-theme', function() { toggleLearnTheme(); updateThemeMenuItem(); });
learnRegisterAction('open-marketplace-from-menu', function() { openMarketplace(); toggleNavMenu(); });
learnRegisterAction('signout', function() { signOut(); });

// Marketplace
learnRegisterAction('open-marketplace', function() { openMarketplace(); });
learnRegisterAction('close-marketplace', function() { closeMarketplace(); });

// Course viewer
learnRegisterAction('back-to-dash', function() { backToDash(); });
learnRegisterAction('toggle-toc', function() { toggleToc(); });
learnRegisterAction('open-course', function(e, el) {
  var id = el.getAttribute('data-learn-course-id');
  if (id) openCourseViewer(id);
});
learnRegisterAction('select-lesson', function(e, el) {
  var id = el.getAttribute('data-learn-lesson-id');
  if (id) selectLesson(id);
});
learnRegisterAction('select-quiz', function(e, el) {
  var id = el.getAttribute('data-learn-quiz-id');
  if (id) selectQuiz(id);
});
// Fires on every radio change inside the quiz - recomputes whether all
// questions are answered and enables/disables the Submit button.
learnRegisterAction('quiz-answer-pick', function(e, el) {
  recomputeQuizSubmitState();
});
learnRegisterAction('quiz-submit', function(e, el) {
  var id = el.getAttribute('data-learn-quiz-id');
  if (id) submitQuiz(id);
});
learnRegisterAction('quiz-retake', function(e, el) {
  var id = el.getAttribute('data-learn-quiz-id');
  if (id) selectQuiz(id);
});
learnRegisterAction('quiz-continue', function() {
  // Advance to the next item in the curriculum sequence. If we're already
  // at the last item, go to the course completion screen instead.
  var all = getAllLessonsOrdered();
  var idx = getCurrentLessonIndex();
  if (idx >= 0 && idx < all.length - 1) {
    var next = all[idx + 1];
    if (next.kind === 'quiz') {
      selectQuiz(next.item.id);
    } else {
      selectLesson(next.item.id);
    }
  } else {
    showCourseCompletion();
  }
});
learnRegisterAction('mark-complete', function(e, el) {
  var id = el.getAttribute('data-learn-lesson-id');
  if (id) markComplete(id);
});
learnRegisterAction('show-course-overview', function() { showCourseOverview(); });
learnRegisterAction('show-course-completion', function() { showCourseCompletion(); });

// Digital product file download
learnRegisterAction('download-product-file', function(e, el) {
  var id = el.getAttribute('data-learn-file-id');
  if (id) downloadProductFile(id, el);
});

// Course lesson file download
learnRegisterAction('download-lesson-file', function(e, el) {
  var id = el.getAttribute('data-learn-file-id');
  if (id) downloadLessonFile(id, el);
});
