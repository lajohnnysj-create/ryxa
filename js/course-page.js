// =================================================================
// Ryxa course landing - extracted from course/index.html inline <script> for CSP.
//
// CSP rules applied to /course/:slug pages (set by vercel.json):
//   - No inline <script> tags
//   - No inline event handlers (onclick=, etc.)
// Every interaction is wired through the delegation framework below,
// keyed by data-course-action attributes in HTML.
// =================================================================

// -------- DELEGATION FRAMEWORK --------
// Pattern: data-course-action="foo-bar" -> handler registered via courseRegisterAction
var courseActionHandlers = {};
function courseRegisterAction(name, fn) { courseActionHandlers[name] = fn; }

document.addEventListener('click', function(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-course-action]') : null;
  if (!el) return;
  var action = el.getAttribute('data-course-action');
  var h = courseActionHandlers[action];
  if (h) h(e, el);
});

// =================================================================
// ORIGINAL COURSE LANDING CODE (extracted from course/index.html)
// =================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
// autoRefreshToken stays OFF on public pages. This page only READS the
// shared session (enrolled/booked state); letting it also refresh tokens
// made it race the dashboard tab for the single-use refresh token, which
// triggers Supabase's reuse detection and revokes the whole session
// (the random logout bug).
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: false }
});

let courseData = null;
let isEnrolled = false;

async function init() {
  // Get slug from URL path: /course/my-slug or /course/my-slug/
  const pathParts = window.location.pathname.replace(/\/$/, '').split('/');
  const slug = pathParts[pathParts.length - 1];

  if (!slug || slug === 'course') {
    showError();
    return;
  }

  // Load course
  const { data: course, error } = await sb
    .from('courses')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();

  if (error || !course) {
    showError();
    return;
  }

  courseData = course;

  // Get creator info
  const { data: profile } = await sb
    .from('public_profiles')
    .select('username, display_currency')
    .eq('user_id', course.user_id)
    .maybeSingle();

  const creatorName = profile?.username || 'Creator';
  // Stash creator currency for price formatting
  window._creatorCurrency = (profile && profile.display_currency) ? profile.display_currency : 'USD';

  // Load modules & lessons via the public_* views. These views expose ONLY
  // curriculum-display columns (no text_content, no video_url, no Bunny IDs)
  // and only for published courses. The raw course_modules / course_lessons
  // tables remain locked down to enrolled users + the owner.
  const { data: modules } = await sb
    .from('public_course_modules')
    .select('*')
    .eq('course_id', course.id)
    .order('sort_order');

  const { data: lessons } = await sb
    .from('public_course_lessons')
    .select('id, module_id, title, lesson_type, sort_order')
    .eq('course_id', course.id)
    .order('sort_order');

  // Quizzes - same public view used by the lesson player. Strips is_correct
  // flags so the marketing curriculum can show "Quiz - 3 questions" without
  // leaking which answers are correct.
  const { data: quizzes } = await sb
    .from('public_course_quizzes')
    .select('id, module_id, require_pass, questions')
    .eq('course_id', course.id);

  // Check enrollment
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    hydrateSigninChip(session.user.email || '');
    const { data: enrollment } = await sb
      .from('course_enrollments')
      .select('id')
      .eq('course_id', course.id)
      .eq('user_id', session.user.id)
      .maybeSingle();
    isEnrolled = !!enrollment;
  }

  // Update page meta
  document.title = course.title + ' - Ryxa';
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    // Description may now contain HTML (from the rich-text editor). Strip
    // tags for the meta description, which must be plain text.
    var descPlain = (course.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    metaDesc.content = descPlain.slice(0, 160);
  }

  // Render
  renderCourse(course, creatorName, modules || [], lessons || [], quizzes || [], session);

  // Track page view (fire-and-forget)
  if (creatorName && creatorName !== 'Creator') {
    trackPageView(creatorName, 'course', course.id);
  }
}

// Page view tracking with visitor dedup (same as bio.html)
async function trackPageView(username, pageType, productId) {
  try {
    var visitorHash;
    try {
      var raw = [
        navigator.userAgent || '',
        navigator.language || '',
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset().toString()
      ].join('|');
      var msgBuf = new TextEncoder().encode(raw);
      var hashBuf = await crypto.subtle.digest('SHA-256', msgBuf);
      var hashArr = Array.from(new Uint8Array(hashBuf));
      visitorHash = hashArr.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (hashErr) {
      visitorHash = 'fb-' + btoa(navigator.userAgent + screen.width + screen.height).slice(0, 32);
    }
    var params = {
      p_username: username,
      p_page_type: pageType,
      p_visitor_hash: visitorHash
    };
    if (productId) params.p_product_id = productId;
    var result = await sb.rpc('record_page_view', params);
    if (result.error) console.error('Page view tracking error:', result.error.message);
  } catch (e) {
    console.error('trackPageView failed:', e);
  }
}

function showError() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('error-page').style.display = 'flex';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

// Signed-in chip on top right
function hydrateSigninChip(email) {
  if (!email) return;
  document.getElementById('signin-chip-email').textContent = email;
  document.getElementById('signin-chip-avatar').textContent = (email[0] || 'U').toUpperCase();
  document.getElementById('signin-chip').style.display = 'inline-flex';
  document.getElementById('signin-popover-email').textContent = email;
}
function toggleSigninPopover(evt) {
  if (evt) evt.stopPropagation();
  var pop = document.getElementById('signin-popover');
  pop.style.display = pop.style.display === 'block' ? 'none' : 'block';
}
document.addEventListener('click', function(e) {
  var pop = document.getElementById('signin-popover');
  var chip = document.getElementById('signin-chip');
  if (pop && pop.style.display === 'block' && !pop.contains(e.target) && !chip.contains(e.target)) {
    pop.style.display = 'none';
  }
});
async function signOutAndReload() {
  await sb.auth.signOut({ scope: 'local' });
  window.location.reload();
}

function renderCourse(course, creatorName, modules, lessons, quizzes, session) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('course-page').style.display = 'block';

  // Cover
  const coverEl = document.getElementById('cp-cover');
  if (course.cover_image_path) {
    const url = sb.storage.from('course-covers').getPublicUrl(course.cover_image_path).data.publicUrl;
    coverEl.innerHTML = '<img class="course-cover" src="' + url + '" alt="Course cover">';
  } else {
    coverEl.innerHTML = '<div class="course-cover-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></svg></div>';
  }

  // Title, creator, description
  document.getElementById('cp-title').textContent = course.title;
  document.getElementById('cp-creator').innerHTML = 'by <a href="/' + escapeHtml(creatorName) + '" style="color:inherit;text-decoration:none;"><strong>' + escapeHtml(creatorName) + '</strong></a>';
  // Description is rich-text HTML (sanitized when saved by the dashboard's
  // Quill editor). Sanitize again on render as defense in depth - never
  // trust HTML alone, even our own. Also clean up two known issues from
  // older saved data: trailing whitespace inside block tags (looks like
  // double spaces on render), and href-less <a> tags (visible styled text
  // that doesn't navigate).
  var descRaw = course.description || '';
  // Trim whitespace inside block tags.
  descRaw = descRaw.replace(/(\s+)<\/(p|h2|h3|li)>/g, '</$2>');
  descRaw = descRaw.replace(/<(p|h2|h3|li)([^>]*)>\s+/g, '<$1$2>');
  // Strip empty paragraph spacers ('<p><br></p>' from Quill blank lines).
  // These render as a full extra line gap between paragraphs that combines
  // with paragraph margins to produce a visibly doubled space.
  descRaw = descRaw.replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, '');
  descRaw = descRaw.replace(/<p>\s*<\/p>/gi, '');
  // Unwrap broken <a> tags (no href or empty href).
  descRaw = descRaw.replace(/<a(?:\s+(?!href=)[^>]*)?>(.*?)<\/a>/gi, '$1');
  descRaw = descRaw.replace(/<a\s+href=["']?["']?\s*>(.*?)<\/a>/gi, '$1');
  var descEl = document.getElementById('cp-desc');
  if (typeof DOMPurify !== 'undefined') {
    // Install a one-time hook that filters class values to a tight whitelist
    // and ensures every <img> has an alt attribute. The hook is global to
    // DOMPurify so we mark it via a window flag to keep it idempotent across
    // re-renders of this page. Only the three image-size classes are kept;
    // anything else is stripped. Mirrors the editor-side hook in course.js
    // (sanitizeLessonHtml path) so creator output and viewer rendering share
    // the same class-allowlist contract.
    if (!window._courseDescPurifyHookInstalled) {
      window._courseDescPurifyHookInstalled = true;
      var ALLOWED_DESC_CLASSES = { 'lesson-img-size-small': 1, 'lesson-img-size-medium': 1, 'lesson-img-size-large': 1 };
      DOMPurify.addHook('afterSanitizeAttributes', function(node) {
        if (node.hasAttribute && node.hasAttribute('class')) {
          var keep = (node.getAttribute('class') || '').split(/\s+/).filter(function(c) {
            return c && ALLOWED_DESC_CLASSES[c];
          });
          if (keep.length) {
            node.setAttribute('class', keep.join(' '));
          } else {
            node.removeAttribute('class');
          }
        }
        // WCAG: every <img> must have an alt attribute. Default missing alts
        // to empty string (= decorative; screen readers will skip).
        if (node.tagName === 'IMG' && !node.hasAttribute('alt')) {
          node.setAttribute('alt', '');
        }
      });
    }
    descEl.innerHTML = DOMPurify.sanitize(descRaw, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'h2', 'h3', 'ul', 'ol', 'li', 'img', 'span'],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class'],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i
    });
    // Enforce noopener noreferrer on every target=_blank link, and force
    // external links to open in a new tab.
    descEl.querySelectorAll('a[href]').forEach(function(a) {
      var href = a.getAttribute('href') || '';
      if (/^https?:/i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
  } else {
    descEl.textContent = descRaw.replace(/<[^>]*>/g, '');
  }

  // Price & buy
  const priceEl = document.getElementById('cp-price');
  const buyArea = document.getElementById('cp-buy-area');

  // Format a cents amount in the creator's currency
  function fmtPrice(cents) {
    var code = window._creatorCurrency || 'USD';
    var localeMap = { USD:'en-US', EUR:'en-IE', GBP:'en-GB', CAD:'en-CA', AUD:'en-AU', JPY:'ja-JP', INR:'en-IN', BRL:'pt-BR', MXN:'es-MX', CHF:'de-CH', SGD:'en-SG', SEK:'sv-SE', NOK:'nb-NO', NZD:'en-NZ', ZAR:'en-ZA' };
    var locale = localeMap[code] || 'en-US';
    var fractionDigits = (code === 'JPY') ? 0 : 2;
    try {
      return new Intl.NumberFormat(locale, { style:'currency', currency:code, minimumFractionDigits:fractionDigits, maximumFractionDigits:fractionDigits }).format(cents / 100);
    } catch (e) {
      return '$' + (cents / 100).toFixed(fractionDigits);
    }
  }

  if (course.price_cents === 0) {
    priceEl.innerHTML = '<span class="course-price-free">Free</span>';
  } else {
    priceEl.textContent = fmtPrice(course.price_cents);
  }

  var isLoggedIn = !!session?.user;

  var consentHtml = isLoggedIn ? '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer;font-size:13px;color:var(--muted);"><input type="checkbox" id="marketing-consent" style="accent-color:#7c3aed;width:16px;height:16px;cursor:pointer;"> Get updates from this creator</label>' : '';

  if (isEnrolled) {
    buyArea.innerHTML = '<a href="/learn/?course=' + course.id + '" class="course-enrolled-badge" style="text-decoration:none;cursor:pointer;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Go to Course</a>';
  } else if (course.price_cents === 0) {
    buyArea.innerHTML = '<button class="course-buy-btn" data-course-action="enroll-free">' + (isLoggedIn ? 'Proceed to Enrollment' : 'Enroll for Free') + '</button>' + consentHtml;
  } else {
    buyArea.innerHTML = '<button class="course-buy-btn" data-course-action="buy-course">' + (isLoggedIn ? 'Proceed to Checkout' : 'Enroll Now') + '</button>' + consentHtml;
  }

  // Curriculum
  const curriculumEl = document.getElementById('cp-curriculum');
  if (modules.length === 0) {
    curriculumEl.innerHTML = '<p style="color:var(--muted);font-size:14px;text-align:center;padding:24px;">Curriculum coming soon.</p>';
    return;
  }

  curriculumEl.innerHTML = modules.map(function(mod, mi) {
    const modLessons = lessons.filter(function(l) { return l.module_id === mod.id; });
    const modQuiz = quizzes.find(function(q) { return q.module_id === mod.id; }) || null;
    const lessonsHtml = modLessons.map(function(l) {
      const icon = l.lesson_type === 'video'
        ? '<svg class="lesson-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
        : '<svg class="lesson-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
      const lockedClass = !isEnrolled ? ' lesson-locked' : '';
      return '<div class="lesson-row' + lockedClass + '">'
        + icon
        + '<span class="lesson-title">' + escapeHtml(l.title || 'Untitled Lesson') + '</span>'
        + '</div>';
    }).join('');

    // Quiz row, if present. Marketing-display only - no click handler, no
    // completion state. Shows question count and Required pill (when set)
    // as a signal of course structure.
    let quizHtml = '';
    if (modQuiz) {
      const qCount = Array.isArray(modQuiz.questions) ? modQuiz.questions.length : 0;
      const quizIcon = '<svg class="lesson-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      const requiredBadge = modQuiz.require_pass ? '<span class="lesson-quiz-required">Required</span>' : '';
      const lockedClass = !isEnrolled ? ' lesson-locked' : '';
      quizHtml = '<div class="lesson-row' + lockedClass + '">'
        + quizIcon
        + '<span class="lesson-title">Quiz &middot; ' + qCount + ' question' + (qCount === 1 ? '' : 's') + '</span>'
        + requiredBadge
        + '</div>';
    }

    return '<div class="module-card">'
      + '<div class="module-header"><span class="module-number">Module ' + (mi + 1) + '</span> ' + escapeHtml(mod.title || '') + '</div>'
      + lessonsHtml
      + quizHtml
      + '</div>';
  }).join('');
}

async function enrollFree() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) {
    window.location.href = '/learn/?redirect=' + encodeURIComponent(window.location.pathname);
    return;
  }

  const btn = document.querySelector('.course-buy-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enrolling...'; }

  try {
    // Create course_users row if needed
    await sb.from('course_users').upsert({ user_id: session.user.id, display_name: session.user.email.split('@')[0] }, { onConflict: 'user_id' });

    // Create enrollment
    var consentCheck = document.getElementById('marketing-consent');
    const { error } = await sb.from('course_enrollments').insert({
      course_id: courseData.id,
      user_id: session.user.id,
      amount_paid_cents: 0,
      buyer_email: session.user.email || '',
      marketing_consent: consentCheck ? consentCheck.checked : false
    });

    if (error) {
      if (error.code === '23505') {
        // Already enrolled
        isEnrolled = true;
      } else {
        throw error;
      }
    } else {
      isEnrolled = true;
    }

    // Redirect to course viewer
    window.location.href = '/learn/?course=' + courseData.id;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Enroll for Free'; }
    alert('Failed to enroll: ' + err.message);
  }
}

async function buyCourse() {
  // GUEST CHECKOUT: no login wall on paid courses. Stripe collects the email,
  // and the webhook binds the enrollment to an account under it. Free
  // enrollment (enrollFree) still requires an account: there is no Stripe
  // session to carry an email or to prove the claim.
  const { data: { session } } = await sb.auth.getSession();

  const btn = document.querySelector('.course-buy-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading checkout...'; }

  try {
    // Call edge function to create Stripe checkout session
    var consentCheck = document.getElementById('marketing-consent');
    const { data, error } = await sb.functions.invoke('create-course-checkout', {
      body: {
        course_id: courseData.id,
        marketing_consent: consentCheck ? consentCheck.checked : false,
        // Only used for logged-in buyers. The edge function rewrites the guest
        // success_url to the purchase-complete page, which works logged out.
        success_url: window.location.origin + '/learn/?course=' + courseData.id + '&enrolled=1',
        cancel_url: window.location.href
      }
    });

    if (error || !data || data.error) {
      throw new Error((data && data.error) || error?.message || 'Failed to create checkout');
    }

    window.location.href = data.checkout_url;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Enroll Now'; }
    alert('Failed: ' + err.message);
  }
}

init();


// =================================================================
// ACTION REGISTRATIONS - wire data-course-action attributes to handlers
// =================================================================

courseRegisterAction('toggle-signin-popover', function(e) {
  toggleSigninPopover(e);
});

courseRegisterAction('signout', function() {
  signOutAndReload();
});

courseRegisterAction('enroll-free', function() {
  enrollFree();
});

courseRegisterAction('buy-course', function() {
  buyCourse();
});
