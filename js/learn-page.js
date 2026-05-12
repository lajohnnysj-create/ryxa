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
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
let viewerProgress = [];
let viewerEnrollmentId = null;
let currentLessonId = null;
let authMode = 'signin';

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
    await loadDashboard();
  }
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = '/learn/';
}

async function loadDashboard() {
  document.getElementById('dash-screen').style.display = 'block';
  document.getElementById('viewer-screen').style.display = 'none';

  const { data } = await sb
    .from('course_enrollments')
    .select('*, courses(*)')
    .eq('user_id', currentUser.id)
    .order('enrolled_at', { ascending: false });

  enrollments = data || [];

  // Load creator names and progress for each enrollment
  for (var i = 0; i < enrollments.length; i++) {
    var e = enrollments[i];
    if (!e.courses) continue;
    // Get creator username
    var { data: creatorProfile } = await sb.from('public_profiles').select('username').eq('user_id', e.courses.user_id).maybeSingle();
    e._creatorName = creatorProfile?.username || 'Creator';
    // Get total lessons
    var { count: totalLessons } = await sb.from('course_lessons').select('id', { count: 'exact', head: true }).eq('course_id', e.courses.id);
    // Get completed lessons
    var { count: completedLessons } = await sb.from('course_progress').select('id', { count: 'exact', head: true }).eq('enrollment_id', e.id);
    e._totalLessons = totalLessons || 0;
    e._completedLessons = completedLessons || 0;
  }

  renderDashboard();
  await loadProducts();
  await loadBookings();
}

// =====================================================
// DIGITAL PRODUCTS — buyer side
// =====================================================

// On every dashboard load, retroactively link any orphan email-only purchases
// to the buyer's user_id. (Defensive — our flow always sets buyer_user_id at
// purchase time, but this catches edge cases like email-mismatch recovery.)
async function linkOrphanDigitalPurchases() {
  try {
    await sb.rpc('link_digital_product_purchases_to_user');
  } catch (e) {
    console.warn('Could not link orphan purchases:', e);
  }
}

async function loadProducts() {
  await linkOrphanDigitalPurchases();

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

  // Load files for each purchase's product (via server-side endpoint —
  // direct DB access is RLS-blocked since buyers aren't the file owners)
  var { data: { session } } = await sb.auth.getSession();
  for (var i = 0; i < purchases.length; i++) {
    var p = purchases[i];
    var prodId = p.digital_products.id;

    try {
      var resp = await fetch('/api/list-product-files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (session?.access_token || '')
        },
        body: JSON.stringify({ product_id: prodId })
      });
      var data = await resp.json();
      p._files = (resp.ok && data && data.files) ? data.files : [];
    } catch (e) {
      console.error('Could not load files for product', prodId, e);
      p._files = [];
    }

    // Load creator name
    var { data: creatorProfile } = await sb
      .from('public_profiles')
      .select('username')
      .eq('user_id', p.digital_products.user_id)
      .maybeSingle();
    p._creatorName = creatorProfile?.username || 'Creator';
  }

  renderProducts(purchases);

  // Honor ?dp=<id>&purchased=1 deep link — scroll to the matching product
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

    // Trigger browser download via a transient link
    var a = document.createElement('a');
    a.href = data.url;
    a.download = data.filename || '';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

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

async function loadBookings() {
  var { data: bookings } = await sb
    .from('coaching_bookings')
    .select('*, coaching_services(*)')
    .eq('user_id', currentUser.id)
    .order('booked_at', { ascending: false });

  bookings = bookings || [];

  // Load creator names
  for (var i = 0; i < bookings.length; i++) {
    var b = bookings[i];
    if (!b.coaching_services) continue;
    var { data: creatorProfile } = await sb.from('public_profiles').select('username').eq('user_id', b.coaching_services.user_id).maybeSingle();
    b._creatorName = creatorProfile?.username || 'Creator';
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

    // Format the actual session date/time (if booked through Ryxa Calendar)
    var slotInfo = '';
    if (b.slot_start && b.slot_end) {
      var slotStart = new Date(b.slot_start);
      var slotEnd = new Date(b.slot_end);
      var slotDate = slotStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      var slotTime = slotStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' – ' + slotEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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

    // Meeting details block — only render if the creator set details on the service.
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
      + (progressLabel ? '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">' + progressLabel + (pct === 100 ? ' — Complete' : '') + '</div>' : '')
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

  // Load enrollment & progress
  const { data: enrollment } = await sb.from('course_enrollments').select('id').eq('course_id', courseId).eq('user_id', currentUser.id).single();
  viewerEnrollmentId = enrollment?.id || null;

  if (viewerEnrollmentId) {
    const { data: progress } = await sb.from('course_progress').select('lesson_id').eq('enrollment_id', viewerEnrollmentId);
    viewerProgress = (progress || []).map(function(p) { return p.lesson_id; });
  } else {
    viewerProgress = [];
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
    html += '<div class="viewer-text" style="margin-bottom:28px;">' + escapeHtml(viewerCourse.description) + '</div>';
  }

  // Curriculum list
  html += '<div style="margin-top:8px;">';
  html += '<h3 style="font-family:Syne,sans-serif;font-size:16px;font-weight:800;letter-spacing:-0.3px;margin-bottom:16px;">Curriculum</h3>';
  viewerModules.forEach(function(mod, mi) {
    var modLessons = viewerLessons.filter(function(l) { return l.module_id === mod.id; });
    html += '<div style="margin-bottom:16px;">';
    html += '<div style="font-size:12px;color:var(--text);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Module ' + (mi + 1) + ': ' + escapeHtml(mod.title) + '</div>';
    modLessons.forEach(function(l, li) {
      var isCompleted = viewerProgress.indexOf(l.id) !== -1;
      var icon = l.lesson_type === 'video' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
      var check = isCompleted ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '<span style="width:14px;height:14px;display:inline-block;border:1.5px solid var(--muted);border-radius:50%;"></span>';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;color:var(--text);">'
        + check + ' ' + icon + ' ' + escapeHtml(l.title || (l.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson'))
        + '</div>';
    });
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

  // Nav: no prev, next is first lesson
  var all = getAllLessonsOrdered();
  if (all.length > 0) {
    nav.innerHTML = '<div class="viewer-nav-btn viewer-nav-prev disabled"><span class="viewer-nav-label">← Previous</span><span class="viewer-nav-title"></span></div>'
      + '<a href="#" data-learn-action="select-lesson" data-learn-lesson-id="' + all[0].id + '" class="viewer-nav-btn viewer-nav-next">'
      + '<span class="viewer-nav-label">Next →</span>'
      + '<span class="viewer-nav-title">' + escapeHtml(all[0].title || (all[0].lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson')) + '</span></a>';
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

  // Nav: prev is last lesson, no next
  var all = getAllLessonsOrdered();
  if (all.length > 0) {
    var last = all[all.length - 1];
    nav.innerHTML = '<a href="#" data-learn-action="select-lesson" data-learn-lesson-id="' + last.id + '" class="viewer-nav-btn viewer-nav-prev">'
      + '<span class="viewer-nav-label">← Previous</span>'
      + '<span class="viewer-nav-title">' + escapeHtml(last.title || (last.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson')) + '</span></a>'
      + '<div class="viewer-nav-btn viewer-nav-next disabled"><span class="viewer-nav-label">Next →</span><span class="viewer-nav-title"></span></div>';
  } else {
    nav.innerHTML = '';
  }
}

function getAllLessonsOrdered() {
  var ordered = [];
  viewerModules.forEach(function(mod) {
    var modLessons = viewerLessons.filter(function(l) { return l.module_id === mod.id; });
    modLessons.forEach(function(l) { ordered.push(l); });
  });
  return ordered;
}

function getCurrentLessonIndex() {
  var all = getAllLessonsOrdered();
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === currentLessonId) return i;
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
  sidebar.innerHTML = viewerModules.map(function(mod, mi) {
    var modLessons = viewerLessons.filter(function(l) { return l.module_id === mod.id; });
    return '<div class="viewer-module-title">Module ' + (mi + 1) + ': ' + escapeHtml(mod.title) + '</div>'
      + modLessons.map(function(l) {
        var isCompleted = viewerProgress.indexOf(l.id) !== -1;
        var isActive = l.id === currentLessonId;
        var icon = l.lesson_type === 'video' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
        var check = isCompleted ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '';
        return '<button class="viewer-lesson-btn' + (isActive ? ' active' : '') + (isCompleted ? ' completed' : '') + '" data-learn-action="select-lesson" data-learn-lesson-id="' + l.id + '">'
          + '<span class="viewer-check">' + check + '</span>'
          + '<span>' + icon + ' ' + escapeHtml(l.title || (l.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson')) + '</span>'
          + '</button>';
      }).join('');
  }).join('');

  updateProgressBar();
}

// =============================================================================
// VIEWER-SIDE SANITIZATION (defense in depth)
// =============================================================================
// The editor (js/course.js) sanitizes lesson HTML before saving to the DB, so
// stored text_content is normally already clean. But trusting the stored
// content alone is a single layer — if anything ever bypasses the editor
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

var _viewerPurifyLoadPromise = null;
function ensureViewerPurifyLoaded() {
  if (typeof DOMPurify !== 'undefined') return Promise.resolve();
  if (_viewerPurifyLoadPromise) return _viewerPurifyLoadPromise;
  _viewerPurifyLoadPromise = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js';
    s.integrity = 'sha512-H+rglffZ6f5gF7UJgvH4Naa+fGCgjrHKMgoFOGmcPTRwR6oILo5R+gtzNrpDp7iMV3udbymBVjkeZGNz1Em4rQ==';
    s.crossOrigin = 'anonymous';
    s.onload = function() {
      // Install the same hook set the editor uses: filter class values to
      // a whitelist + force rel="noopener noreferrer" on target=_blank links.
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
  if (typeof DOMPurify === 'undefined') return ''; // shouldn't happen — caller awaits loader
  return DOMPurify.sanitize(html || '', VIEWER_PURIFY_CONFIG);
}

function selectLesson(lessonId) {
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
  if (lesson.lesson_type === 'video' && lesson.video_url) {
    var embedUrl = getEmbedUrl(lesson.video_url);
    if (embedUrl) {
      html += '<iframe class="viewer-video" src="' + embedUrl + '" allowfullscreen></iframe>';
    } else {
      html += '<p style="color:var(--muted);font-size:14px;margin-bottom:16px;">Video: <a href="' + escapeHtml(lesson.video_url) + '" target="_blank" style="color:var(--text);text-decoration:underline;">' + escapeHtml(lesson.video_url) + '</a></p>';
    }
  }
  if (lesson.text_content) {
    // Editor (js/course.js mountLessonEditor) sanitizes content with DOMPurify
    // before saving to text_content. We sanitize AGAIN on read here as
    // defense in depth. If anything ever puts unsanitized HTML in the DB
    // (devtools bypass, future bug, admin compromise), the viewer still
    // refuses to render it.
    // Legacy plain-text lessons (saved before the rich text editor) won't
    // contain HTML tags — wrap those in a <p> with escaped contents so they
    // render with paragraph styling instead of as one inline blob. Plain
    // text doesn't need DOMPurify (escapeHtml already neutralizes it).
    // NOTE: variable name is `richHtml`, NOT `content`, because the outer
    // function uses `content` for the DOM container — see selectLesson body.
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
  // Lesson images — text lessons only (video lessons embed the video itself).
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
  var hasImages = !isVideoLesson && lesson.images && lesson.images.length > 0;
  if (!lesson.video_url && !lesson.text_content && !hasImages) {
    html += '<p style="color:var(--muted);font-size:14px;">This lesson has no content yet.</p>';
  }

  // Complete button
  if (isCompleted) {
    html += '<div class="viewer-completed-msg"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Completed</div>';
  } else {
    html += '<button class="viewer-complete-btn" data-learn-action="mark-complete" data-learn-lesson-id="' + lessonId + '">Mark as Complete</button>';
  }

  content.innerHTML = html;

  // If the lesson has HTML text content, load DOMPurify (if not loaded yet)
  // and fill the placeholder with the sanitized HTML. The placeholder
  // approach means the empty slot briefly exists before content appears on
  // first ever view — typically <300ms. Subsequent views are instant since
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
      console.error('Lesson sanitizer failed to load — refusing to render rich content:', err);
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

function renderLessonNav() {
  var nav = document.getElementById('viewer-nav');
  var all = getAllLessonsOrdered();
  var idx = getCurrentLessonIndex();

  var prevHtml = '';
  var nextHtml = '';

  if (idx > 0) {
    var prev = all[idx - 1];
    prevHtml = '<a href="#" data-learn-action="select-lesson" data-learn-lesson-id="' + prev.id + '" class="viewer-nav-btn viewer-nav-prev">'
      + '<span class="viewer-nav-label">← Previous</span>'
      + '<span class="viewer-nav-title">' + escapeHtml(prev.title || (prev.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson')) + '</span>'
      + '</a>';
  } else {
    prevHtml = '<a href="#" data-learn-action="show-course-overview" class="viewer-nav-btn viewer-nav-prev">'
      + '<span class="viewer-nav-label">← Previous</span>'
      + '<span class="viewer-nav-title">Course Overview</span>'
      + '</a>';
  }

  if (idx < all.length - 1) {
    var next = all[idx + 1];
    nextHtml = '<a href="#" data-learn-action="select-lesson" data-learn-lesson-id="' + next.id + '" class="viewer-nav-btn viewer-nav-next">'
      + '<span class="viewer-nav-label">Next →</span>'
      + '<span class="viewer-nav-title">' + escapeHtml(next.title || (next.lesson_type === 'video' ? 'Untitled Video' : 'Untitled Lesson')) + '</span>'
      + '</a>';
  } else {
    nextHtml = '<a href="#" data-learn-action="show-course-completion" class="viewer-nav-btn viewer-nav-next">'
      + '<span class="viewer-nav-label">Next →</span>'
      + '<span class="viewer-nav-title">Course Complete</span>'
      + '</a>';
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
  loadDashboard();
}

function getEmbedUrl(url) {
  // NOTE: detectVideoPlatform() in js/course.js mirrors the regex patterns
  // below for the editor's validation indicator. If you add or modify a
  // platform here, update both functions or the editor will get out of sync
  // with what actually embeds.
  if (!url) return null;
  // YouTube — includes Shorts. The /embed/ URL works for both regular videos
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

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
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

      // Cover URL — courses/coaching use cover_image_path inside storage buckets;
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
learnRegisterAction('forgot-password', function() { handleLearnForgotPassword(); });
learnRegisterAction('auth', function() { handleAuth(); });

// Nav menu
learnRegisterAction('toggle-nav-menu', function() { toggleNavMenu(); });
learnRegisterAction('toggle-theme', function() { toggleLearnTheme(); updateThemeMenuItem(); });
learnRegisterAction('open-marketplace-from-menu', function() { openMarketplace(); toggleNavMenu(); });
learnRegisterAction('signout', function() { signOut(); });

// Marketplace
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
