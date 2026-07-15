// =================================================================
// Ryxa pricing page - extracted from pricing.html inline <script> for CSP.
//
// CSP rules applied to pricing.html (set by vercel.json):
//   - No inline <script> tags
//   - No inline event handlers (onclick=, etc.)
// Every interaction is wired through the delegation framework below,
// keyed by data-pricing-action attributes in HTML.
// =================================================================

// -------- DELEGATION FRAMEWORK --------
var pricingActionHandlers = {};
function pricingRegisterAction(name, fn) { pricingActionHandlers[name] = fn; }

document.addEventListener('click', function(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-pricing-action]') : null;
  if (!el) return;
  var action = el.getAttribute('data-pricing-action');
  var h = pricingActionHandlers[action];
  if (h) h(e, el);
});

// =================================================================
// SUPABASE + PRICE MAP
// =================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
const { createClient } = supabase;
// autoRefreshToken stays OFF outside the dashboard. Only one page per
// origin may run the background refresh timer; multiple timers race for
// the single-use refresh token and trip Supabase reuse detection, which
// revokes the session (the random logout bug). Reads still refresh
// on demand when a real action needs a fresh token.
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: false }
});

// Stripe price ID mapping. Source of truth lives in the create-checkout-session
// edge function; this client-side map is for routing the user's plan+cycle
// selection to the right Stripe price.
var PRICE_IDS = {
  pro: {
    monthly: 'price_1TIZ8pFQ1L0aeJrZEX1bQnUI',  // $10/mo
    annual:  'price_1TWqaNFQ1L0aeJrZvUOPWHUy'   // $100/yr
  },
  max: {
    monthly: 'price_1TWqbvFQ1L0aeJrZB9ffRvyC',  // $24/mo
    annual:  'price_1TWqctFQ1L0aeJrZJ3QdI3y5'   // $240/yr
  }
};

// Display prices for each plan + cycle, used by the plan-change confirmation
// modal. These mirror the fixed prices behind the PRICE_IDS above. amount is
// the plain dollar figure; per is the billing period label.
var PLAN_PRICES = {
  pro: {
    monthly: { amount: '$10', per: 'month' },
    annual:  { amount: '$100', per: 'year' }
  },
  max: {
    monthly: { amount: '$24', per: 'month' },
    annual:  { amount: '$240', per: 'year' }
  }
};

// Current authenticated user + their subscription state. Resolved on load.
//   currentUser: the auth user object, or null
//   currentTier: 'free' | 'monthly' (= Pro) | 'max'
//   currentCycle: 'monthly' | 'annual'
//   currentStatus: 'active' | 'cancelling' | 'cancelled' | etc.
var currentUser = null;
var currentTier = 'free';
var currentCycle = 'monthly';
var currentStatus = null;
// True once we know the user's plan, from a session (web) OR a signed ticket
// snapshot (app opened this page in Safari, where there is no session). The
// card-decoration logic keys off this instead of currentUser so the Safari
// flow renders identically to a logged-in web visit.
var planKnown = false;

// Signed ticket passed by the native app when it opens this page in Safari (see
// dashboard-shell.js goToPricing). Carries the signed-in user's identity across
// the browser boundary since Safari has no Supabase session. Read once and
// cached; checkout hands it to create-checkout-session, which verifies it.
var _pricingTicket;
function getPricingTicket() {
  if (_pricingTicket === undefined) {
    try {
      _pricingTicket = new URLSearchParams(window.location.search).get('ticket') || null;
    } catch (e) {
      _pricingTicket = null;
    }
  }
  return _pricingTicket;
}

// =================================================================
// TOAST (replaces native alert - project rule: never use alert/confirm/prompt)
// =================================================================

function showPricingToast(message, type) {
  // type: 'error' (default) | 'info'
  var existing = document.getElementById('pricing-toast');
  if (existing) existing.remove();

  var toast = document.createElement('div');
  toast.id = 'pricing-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  var bg = type === 'info'
    ? 'linear-gradient(135deg,#7c3aed,#a855f7)'
    : 'linear-gradient(135deg,#dc2626,#ef4444)';
  toast.style.cssText =
    'position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);' +
    'background:' + bg + ';color:#fff;padding:13px 20px;border-radius:10px;' +
    'font-family:"DM Sans",sans-serif;font-size:14px;font-weight:500;' +
    'box-shadow:0 10px 40px rgba(0,0,0,0.35);z-index:99999;max-width:90vw;' +
    'opacity:0;transition:opacity 0.25s ease,transform 0.25s ease;';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(function() {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
  }, 5000);
}

// Self-contained confirm modal. The shared showModalConfirm helper lives in the
// dashboard bundle and is NOT available on pricing.html (which only loads
// pricing-page.js / cookie-banner.js / site-nav.js), and project rules forbid
// native confirm(). So this is a small, CSP-safe modal built here: no inline
// handlers, listeners attached in JS. Calls onConfirm() if the user proceeds;
// does nothing if they cancel or dismiss.
function showPricingConfirm(opts, onConfirm) {
  var existing = document.getElementById('pricing-confirm-overlay');
  if (existing) existing.remove();

  var title = opts.title || 'Confirm';
  var message = opts.message || '';
  // messageHtml: optional. When provided, it is used as the body instead of
  // the plain-text message. IMPORTANT: only ever pass HTML built from values
  // this code controls (plan names, fixed prices) - never user input - since
  // this is assigned via innerHTML.
  var messageHtml = opts.messageHtml || '';
  var confirmLabel = opts.confirmLabel || 'Confirm';
  var cancelLabel = opts.cancelLabel || 'Cancel';

  var overlay = document.createElement('div');
  overlay.id = 'pricing-confirm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'pricing-confirm-title');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(7,7,15,0.8);z-index:99998;' +
    'display:flex;align-items:center;justify-content:center;padding:24px;' +
    'opacity:0;transition:opacity 0.2s ease;';

  var box = document.createElement('div');
  box.style.cssText =
    'background:#0f0f1a;border:1px solid rgba(255,255,255,0.1);border-radius:16px;' +
    'max-width:420px;width:100%;padding:28px;font-family:"DM Sans",sans-serif;' +
    'box-shadow:0 20px 70px rgba(0,0,0,0.5);transform:translateY(10px);' +
    'transition:transform 0.2s ease;';

  // Brand mark at the top of every pricing modal.
  var logo = document.createElement('img');
  logo.src = '/logo.png?v=2';
  logo.alt = '';
  logo.setAttribute('aria-hidden', 'true');
  logo.style.cssText = 'display:block;height:44px;width:auto;margin:0 auto 18px;';

  var h = document.createElement('h3');
  h.id = 'pricing-confirm-title';
  h.textContent = title;
  h.style.cssText =
    'font-family:"Syne",sans-serif;font-size:19px;font-weight:800;color:#f0eef8;' +
    'margin:0 0 10px;letter-spacing:-0.4px;';

  var p = document.createElement('div');
  // messageHtml is built only from code-controlled values (plan names, fixed
  // prices), never user input - safe to assign as innerHTML. Falls back to
  // textContent for the plain-text message path.
  if (messageHtml) {
    p.innerHTML = messageHtml;
  } else {
    p.textContent = message;
  }
  p.style.cssText =
    'font-size:14px;line-height:1.6;color:#c8c6d8;margin:0 0 22px;';

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';

  var cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = cancelLabel;
  cancelBtn.style.cssText =
    'padding:10px 18px;border-radius:9px;font-size:14px;font-weight:500;' +
    'font-family:"DM Sans",sans-serif;cursor:pointer;background:#161625;' +
    'color:#f0eef8;border:1px solid rgba(255,255,255,0.12);';

  var confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.textContent = confirmLabel;
  confirmBtn.style.cssText =
    'padding:10px 18px;border-radius:9px;font-size:14px;font-weight:500;' +
    'font-family:"DM Sans",sans-serif;cursor:pointer;background:#7c3aed;' +
    'color:#fff;border:none;';

  function close() {
    overlay.style.opacity = '0';
    box.style.transform = 'translateY(10px)';
    setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 200);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) close();  // click outside the box dismisses
  });
  confirmBtn.addEventListener('click', function() {
    close();
    if (typeof onConfirm === 'function') onConfirm();
  });
  document.addEventListener('keydown', onKey);

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  box.appendChild(logo);
  box.appendChild(h);
  box.appendChild(p);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  requestAnimationFrame(function() {
    overlay.style.opacity = '1';
    box.style.transform = 'translateY(0)';
  });
  // Focus the confirm button so keyboard users can act immediately.
  confirmBtn.focus();
}

// =================================================================
// SESSION + SUBSCRIPTION STATE
// =================================================================

async function loadUserState() {
  try {
    var sessionResp = await sb.auth.getSession();
    currentUser = (sessionResp && sessionResp.data && sessionResp.data.session)
      ? sessionResp.data.session.user : null;

    // No session but a ticket present (app opened this page in Safari): read the
    // plan snapshot the app signed into the ticket, so the cards still mark the
    // user's current plan. This is display-only; checkout re-verifies the ticket
    // server-side, so a tampered snapshot could only mislabel a card, never
    // change what the user is charged.
    if (!currentUser) {
      var snap = readTicketPlanSnapshot();
      if (snap) {
        currentTier = snap.tier || 'free';
        currentCycle = snap.cycle || 'monthly';
        currentStatus = snap.status || null;
        planKnown = true;
      }
      decoratePlanCards();
      return;
    }

    planKnown = true;
    // Fetch subscription tier + cycle so we can label the user's current plan.
    var { data: subRows } = await sb
      .from('subscriptions')
      .select('tier, billing_cycle, status')
      .eq('user_id', currentUser.id)
      .limit(1);
    var sub = (subRows && subRows.length > 0) ? subRows[0] : null;
    if (sub) {
      currentTier = sub.tier || 'free';
      currentCycle = sub.billing_cycle || 'monthly';
      currentStatus = sub.status || null;
    }
  } catch (e) {
    console.warn('loadUserState failed', e);
  }
  // Once state is known, reflect it in the plan cards.
  decoratePlanCards();
}

// Reads the plan snapshot the app signed into the ticket (uid/ts/tier/cycle/
// status). Display-only: we decode the payload for the tier label but do NOT
// trust it for anything that affects billing (checkout re-verifies the ticket
// signature server-side). Returns null if no ticket or unparseable.
function readTicketPlanSnapshot() {
  var t = getPricingTicket();
  if (!t) return null;
  try {
    var b64 = t.replace(/-/g, '+').replace(/_/g, '/');
    var wrapper = JSON.parse(atob(b64));
    var payload = JSON.parse(wrapper.p);
    if (!payload || !payload.tier) return null;
    return { tier: payload.tier, cycle: payload.cycle, status: payload.status };
  } catch (e) {
    return null;
  }
}

// Maps our internal tier name to the pricing-page plan key.
//   'max'      -> 'max'
//   'monthly'  -> 'pro'  (internal name for the Pro tier is 'monthly')
//   'free'     -> null
function tierToPlanKey(tier) {
  if (tier === 'max') return 'max';
  if (tier === 'monthly') return 'pro';
  return null;
}

// Updates plan card CTAs + badges to reflect the logged-in user's current
// plan. A user already on Pro Monthly sees "Current plan" on the Pro card
// (when monthly is toggled) and "Switch to annual billing" when they toggle
// to annual. Free / logged-out users see the default CTAs.
function decoratePlanCards() {
  var userPlanKey = tierToPlanKey(currentTier);  // 'pro' | 'max' | null

  ['pro', 'max'].forEach(function(planKey) {
    var btn = document.querySelector('.plan-btn[data-plan="' + planKey + '"]');
    if (!btn) return;

    // Stash the original label once so we can restore it when toggling cycles.
    if (btn._defaultLabel === undefined) btn._defaultLabel = btn.textContent;

    var card = btn.closest('.plan');
    if (!card) return;

    // Remove any prior "current plan" marker
    var priorBadge = card.querySelector('.plan-current-badge');
    if (priorBadge) priorBadge.remove();
    card.classList.remove('is-current-plan');

    if (!planKnown || !userPlanKey) {
      // Plan unknown (logged out, no ticket), or on Free tier - default CTAs.
      btn.textContent = btn._defaultLabel;
      btn.disabled = false;
      return;
    }

    var selectedCycle = getCurrentCycle();
    var isUsersPlan = (userPlanKey === planKey);
    var isExactMatch = isUsersPlan && (currentCycle === selectedCycle);

    if (isExactMatch) {
      // Exactly what the user is already subscribed to.
      btn.textContent = 'Current plan';
      btn.disabled = true;
      card.classList.add('is-current-plan');
      var badge = document.createElement('div');
      badge.className = 'plan-current-badge';
      badge.textContent = 'Your plan';
      card.insertBefore(badge, card.firstChild);
    } else if (isUsersPlan) {
      // Same tier, different cycle - offer the switch.
      btn.textContent = selectedCycle === 'annual'
        ? 'Switch to annual billing'
        : 'Switch to monthly billing';
      btn.disabled = false;
    } else {
      // A different tier than the user currently has.
      if (planKey === 'max') {
        btn.textContent = (currentTier === 'monthly') ? 'Upgrade to Creator Max' : btn._defaultLabel;
      } else {
        // planKey === 'pro', user is on Max - this would be a downgrade.
        btn.textContent = 'Switch to Pro';
      }
      btn.disabled = false;
    }
  });

  decorateFreeCard();
}

// The Free card is handled separately from the pro/max loop above because its
// button has no data-plan attribute (it is a signup CTA, class .plan-btn.free)
// and it needs different treatment: a paid subscriber cannot "select" Free
// from the pricing page - moving to Free means cancelling their subscription
// in Settings. So for paid subscribers we disable the Free button, relabel it,
// and show a small helper line explaining the real path. Free-tier and
// logged-out users see the Free card unchanged.
//
// This function is idempotent - decoratePlanCards() runs more than once (cycle
// toggle, bfcache restore), so the helper line is always removed first and
// only re-added when applicable, never stacked.
function decorateFreeCard() {
  var btn = document.querySelector('.plan-btn.free');
  if (!btn) return;

  if (btn._defaultLabel === undefined) btn._defaultLabel = btn.textContent;

  var card = btn.closest('.plan');

  // Always clear any previously-added helper line first (idempotency).
  if (card) {
    var priorNote = card.querySelector('.plan-free-note');
    if (priorNote) priorNote.remove();
    // Also clear any prior "current plan" badge + class. This function may
    // re-run on cycle toggle or bfcache restore, and we don't want to stack
    // duplicate badges or leave a stale badge if the user's tier changed.
    var priorFreeBadge = card.querySelector('.plan-current-badge');
    if (priorFreeBadge) priorFreeBadge.remove();
    card.classList.remove('is-current-plan');
  }

  var isPaidSubscriber = (currentTier === 'monthly' || currentTier === 'max');

  if (planKnown && isPaidSubscriber) {
    // Paid subscriber: Free is not a selectable action for them.
    btn.textContent = 'Included in your plan';
    btn.disabled = true;
    if (card) {
      var note = document.createElement('div');
      note.className = 'plan-free-note';
      note.textContent =
        'You are on a paid plan. To move to Free, cancel your subscription in Settings.';
      // Place the note directly after the button.
      if (btn.nextSibling) {
        card.insertBefore(note, btn.nextSibling);
      } else {
        card.appendChild(note);
      }
    }
  } else if (planKnown) {
    // User already on the Free tier. Mirror the Pro/Max "Current
    // plan" treatment so the page reads consistently: disabled button +
    // "Your plan" badge on the card.
    btn.textContent = 'Current plan';
    btn.disabled = true;
    if (card) {
      card.classList.add('is-current-plan');
      var freeBadge = document.createElement('div');
      freeBadge.className = 'plan-current-badge';
      freeBadge.textContent = 'Your plan';
      card.insertBefore(freeBadge, card.firstChild);
    }
  } else {
    // Logged-out: default CTA, enabled, no note.
    btn.textContent = btn._defaultLabel;
    btn.disabled = false;
  }
}

// =================================================================
// BILLING CYCLE TOGGLE
// =================================================================

function getCurrentCycle() {
  return document.body.classList.contains('cycle-annual') ? 'annual' : 'monthly';
}

function setCycle(cycle) {
  document.body.classList.remove('cycle-monthly', 'cycle-annual');
  document.body.classList.add('cycle-' + cycle);
  document.querySelectorAll('[data-pricing-action="set-cycle"]').forEach(function(btn) {
    var btnCycle = btn.getAttribute('data-cycle');
    var active = btnCycle === cycle;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  // Re-decorate cards: "Current plan" vs "Switch to annual" depends on cycle.
  decoratePlanCards();
}

pricingRegisterAction('set-cycle', function(_e, el) {
  var cycle = el.getAttribute('data-cycle');
  if (cycle === 'monthly' || cycle === 'annual') setCycle(cycle);
});

// =================================================================
// PLAN SELECTION
// =================================================================

pricingRegisterAction('signup', function() {
  // Free plan CTA - no plan intent, just signup
  window.location.href = 'index.html?action=signup';
});

pricingRegisterAction('select-plan', function(_e, el) {
  if (el.disabled) return;  // "Current plan" buttons are disabled
  var plan = el.getAttribute('data-plan');  // 'pro' or 'max'
  var cycle = getCurrentCycle();             // 'monthly' or 'annual'

  if (!plan || !PRICE_IDS[plan] || !PRICE_IDS[plan][cycle]) {
    console.error('Invalid plan selection:', plan, cycle);
    return;
  }

  if (!currentUser && !getPricingTicket()) {
    // Not signed in AND no ticket - persist the intent so dashboard-shell.js can
    // auto-fire checkout after signup. JSON shape for forward-compat.
    try {
      localStorage.setItem('fts_intended_plan', JSON.stringify({ plan: plan, cycle: cycle }));
    } catch (e) {}
    window.location.href = 'index.html?action=signup';
    return;
  }

  // Ticket-identified users (opened from the app in Safari, no local session)
  // fall through to the SAME logic as web users below. Because the ticket
  // carries the plan snapshot (currentTier/currentStatus), the hasActiveSub
  // check works identically, so existing subscribers still get the plan-change
  // confirmation before anything happens, and Free-tier ticket users flow to
  // Stripe Checkout. Checkout verifies the ticket server-side either way.

  // Existing active subscribers do NOT go through a Stripe Checkout page when
  // changing plans - create-checkout-session.ts modifies their subscription
  // directly and the prorated charge happens immediately. That can feel like a
  // surprise ("I just clicked a button and got charged"). So for these users
  // we show a clear confirmation first, spelling out that the charge is
  // immediate. New / Free-tier users skip this: they go through a real Stripe
  // Checkout page, which already has its own review-and-pay step.
  var hasActiveSub = (currentTier === 'monthly' || currentTier === 'max') &&
                     (currentStatus === 'active' || currentStatus === 'cancelling');

  if (hasActiveSub) {
    var planName = (plan === 'max' ? 'Creator Max' : 'Pro');
    var planLabel = planName + (cycle === 'annual' ? ' (Annual)' : ' (Monthly)');
    var price = PLAN_PRICES[plan][cycle];

    // Plan-change confirmation. The wording is deliberately CONDITIONAL so a
    // single message is accurate across every plan-change path this app
    // supports, without pricing-page needing to know which case it is:
    //   - Upgrades (e.g. Pro -> Max, Monthly -> Annual): charged today, with
    //     a proration credit applied.
    //   - Downgrades / longer-to-shorter interval: per the Stripe Customer
    //     Portal config these WAIT until end of billing period, so the user
    //     is NOT charged today and the change is NOT immediate.
    //   - Trial-eligible Pro -> Max: a 7-day trial starts, so the user is NOT
    //     charged today.
    // Because the message hedges ("if a payment is due", "you may not be
    // charged today") it never asserts something false. The tradeoff is it is
    // vaguer than a precise figure - the exact amount/date live on the Stripe
    // receipt. The price box is framed as the PLAN'S RATE, not "today's
    // charge", so it does not contradict the hedged prose.
    var messageHtml =
      '<div style="background:#161625;border:1px solid rgba(255,255,255,0.08);' +
      'border-radius:10px;padding:14px 16px;margin-bottom:14px;">' +
        '<div style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;' +
        'color:#9b99ad;margin-bottom:6px;">Plan rate</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;">' +
          '<span style="color:#c8c6d8;">' + planName +
          ' <span style="color:#9b99ad;">(' + (cycle === 'annual' ? 'billed yearly' : 'billed monthly') + ')</span></span>' +
          '<strong style="color:#f0eef8;font-size:16px;white-space:nowrap;">' +
          price.amount + ' / ' + price.per + '</strong>' +
        '</div>' +
      '</div>' +
      '<p style="margin:0 0 8px;">You are switching to <strong style="color:#f0eef8;">' +
      planLabel + '</strong>. If a payment is due, it will be charged to your card ' +
      'on file, with any credit for unused time on your current plan applied ' +
      'automatically. If you are eligible for a trial, or your change takes effect ' +
      'at your next renewal, you may not be charged today.</p>' +
      '<p style="margin:0;color:#9b99ad;font-size:13px;">Your plan and billing will ' +
      'update to reflect this change. You can review the exact amount and date on ' +
      'your receipt from Stripe.</p>';

    showPricingConfirm({
      title: 'Switch to ' + planLabel + '?',
      messageHtml: messageHtml,
      confirmLabel: 'Confirm switch',
      cancelLabel: 'Cancel'
    }, function() {
      startCheckoutFromPricing(plan, cycle, el);
    });
    return;
  }

  startCheckoutFromPricing(plan, cycle, el);
});

// =================================================================
// CHECKOUT (signed-in users)
// =================================================================

// Native app only: the checkout button left loading when Safari opened.
var _nativeCheckoutBtn = null;
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible') return;
  if (!window.RyxaNative || !_nativeCheckoutBtn) return;
  try { clearBtnLoading(_nativeCheckoutBtn); } catch (e) {}
  _nativeCheckoutBtn = null;
});

function setBtnLoading(btn, label) {
  if (!btn) return;
  if (btn._origHtml === undefined) btn._origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = label || 'Loading...';
}

function clearBtnLoading(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.removeAttribute('aria-busy');
  if (btn._origHtml !== undefined) {
    btn.innerHTML = btn._origHtml;
    btn._origHtml = undefined;
  }
}

async function extractEdgeFunctionError(err) {
  try {
    if (err && err.context && typeof err.context.json === 'function') {
      var body = await err.context.json();
      if (body && body.error) return body.error;
    }
  } catch (_) {}
  return null;
}

async function startCheckoutFromPricing(plan, cycle, btn) {
  var priceId = PRICE_IDS[plan][cycle];
  // Existing active subscribers get an in-place subscription update (no Stripe
  // Checkout page appears), so "Opening checkout..." would be misleading, they
  // never see a checkout. Show "Processing..." for that path. New / Free-tier
  // users are redirected to a real Stripe Checkout page, so "Opening
  // checkout..." is accurate for them.
  var isInPlaceUpdate = (currentTier === 'monthly' || currentTier === 'max') &&
                        (currentStatus === 'active' || currentStatus === 'cancelling');
  setBtnLoading(btn, isInPlaceUpdate ? 'Processing...' : 'Opening checkout...');

  // When the app opened this page in Safari, there is no Supabase session here.
  // A signed ticket in the URL carries the user's identity instead. Pass it to
  // the checkout function, which verifies it server-side and uses the embedded
  // user_id. When a real session exists (normal website use), userId is sent as
  // before. Sending a ticket also means the app-opened flow behaves like the
  // native flow for success/cancel return URLs.
  var ticket = getPricingTicket();
  var openedFromApp = !!ticket || !!window.RyxaNative;

  try {
    var { data, error } = await sb.functions.invoke('create-checkout-session', {
      body: {
        priceId: priceId,
        userId: currentUser ? currentUser.id : null,
        ticket: ticket || null,
        // When opened from the app (in Safari via ticket) or running in the app
        // WebView, checkout success/cancel route through app-return.html, which
        // deep links back into the app. Otherwise use the normal web returns.
        successUrl: openedFromApp
          ? window.location.origin + '/app-return.html?status=success'
          : window.location.origin + '/dashboard.html?payment=success',
        cancelUrl: openedFromApp
          ? window.location.origin + '/app-return.html?status=cancelled'
          : window.location.origin + '/pricing.html?payment=cancelled'
      }
    });

    if (error) {
      var specificMsg = await extractEdgeFunctionError(error);
      // An expired or invalid ticket means the link from the app has aged out
      // (30 minute window). Tell the user how to recover instead of surfacing
      // the raw server code.
      if (specificMsg === 'invalid_ticket') {
        throw new Error('This upgrade link has expired. Please go back to the Ryxa app and tap the upgrade button again.');
      }
      throw new Error(specificMsg || (error.message || 'Could not start checkout'));
    }

    if (data && data.url) {
      // Whether this is a fresh Stripe Checkout URL or a redirect back to the
      // dashboard (in-place subscription update), follow it. Inside the native
      // app the checkout opens in Safari and this page stays, so remember the
      // button and restore it when the user comes back (visibilitychange).
      if (window.RyxaNative) _nativeCheckoutBtn = btn;
      window.location.href = data.url;
      return;
    }

    throw new Error('No checkout URL returned');
  } catch (e) {
    clearBtnLoading(btn);
    showPricingToast(e.message || 'Could not start checkout. Please try again.', 'error');
  }
}

// =================================================================
// INIT
// =================================================================

// True when the native app opened this page in Safari (app=1 in the URL).
function isFromApp() {
  try {
    return new URLSearchParams(window.location.search).get('app') === '1';
  } catch (e) {
    return false;
  }
}

// When the app opened this page, a DIFFERENT account may already be signed in
// here in Safari (from earlier normal web use). That ambient session must not
// be used: the app user is identified solely by the signed ticket. Sign the
// ambient session out first so no wrong-account data renders and checkout runs
// purely off the ticket, then load state. On the normal website (no app=1) this
// is skipped and the existing session is used as before.
(async function initPricing() {
  if (isFromApp()) {
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore */ }
    currentUser = null;
  }
  // Read the ticket into memory now, then remove it from the address bar so it
  // never lingers in Safari history or gets copied when the user shares the
  // URL. The cached value keeps working for checkout; app=1 and highlight stay
  // in the URL because native-app.js and the highlight scroller read them.
  if (getPricingTicket()) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.delete('ticket');
      window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* cosmetic only; ticket still expires in 5 minutes */ }
  }
  await loadUserState();
  // Fade out the "Redirecting to ryxa.io" overlay (shown by native-app.js on
  // app=1 loads) now that the ticket is read and plan cards reflect the plan.
  // Enforce a short minimum display so the hand-off reads as one smooth
  // moment instead of a flicker.
  (function hideRedirectOverlay() {
    var ov = document.getElementById('app-redirect-overlay');
    if (!ov || !ov.classList.contains('visible')) {
      // No overlay: let any waiting highlight scroll proceed immediately.
      window.__ryxaRedirDone = true;
      if (typeof window.__ryxaOnRedirDone === 'function') window.__ryxaOnRedirDone();
      return;
    }
    var shownAt = window.__ryxaRedirShownAt || 0;
    var hold = Math.max(0, 2500 - (Date.now() - shownAt));
    setTimeout(function () {
      ov.classList.add('fading');
      setTimeout(function () {
        ov.classList.remove('visible', 'fading');
        // Release the scroll lock set when the overlay appeared, THEN run the
        // deferred highlight scroll so it happens on a clean, unlocked page
        // with no fixed overlay to detach.
        if (window.__ryxaRedirScrollLock) {
          document.documentElement.style.overflow = '';
          document.body.style.overflow = '';
          window.__ryxaRedirScrollLock = false;
        }
        window.__ryxaRedirDone = true;
        if (typeof window.__ryxaOnRedirDone === 'function') window.__ryxaOnRedirDone();
      }, 300);
    }, hold);
  })();
})();

// Reset any stuck loading button ("Opening checkout..." or "Processing...")
// when the page is restored from
// the browser's back-forward cache (bfcache). When a user clicks a plan, the
// button is disabled + relabeled, then we navigate to Stripe. If they press
// the BROWSER back button, the browser may restore this page frozen exactly as
// it was left - button still disabled, still saying "Opening checkout...",
// because no JS re-ran. (Stripe's own "back" link does a real navigation, so
// pricing-page.js reloads fresh and this isn't an issue there.)
//
// pageshow fires on every show, including bfcache restores; event.persisted is
// true specifically for a bfcache restore. On that, we clear the loading state
// off every plan button so they're usable again.
window.addEventListener('pageshow', function(e) {
  if (!e.persisted) return;  // only act on bfcache restores, not normal loads
  var btns = document.querySelectorAll('.plan-btn');
  for (var i = 0; i < btns.length; i++) {
    clearBtnLoading(btns[i]);
  }
  // decoratePlanCards re-applies the correct labels / "Current plan" state /
  // disabled state for the logged-in user, so a genuinely-disabled "Current
  // plan" button is not wrongly re-enabled by the clearBtnLoading pass above.
  decoratePlanCards();
});


// =============================================================================
// ?highlight=pro|max
//
// Every upgrade path in the dashboard calls goToPricing('pro'|'max'), which has
// been appending this param for a while. Nothing consumed it, so a creator who
// clicked "Upgrade to Creator Max" landed at the top of the page looking at the
// Free plan.
//
// Two things this must NOT do:
//
//   1. Scroll on desktop. All three cards are already on screen there, so any
//      movement is noise. Only scroll when the target card is actually out of
//      view, which in practice means the stacked mobile layout.
//
//   2. Use scrollIntoView(). It scrolls every scrollable ancestor, and inside
//      the app's WebView it shoves the fixed "Back to Dashboard" bar that
//      native-app.js injects. A measured window.scrollTo leaves fixed elements
//      alone.
// =============================================================================
(function () {
  var plan;
  try {
    plan = new URLSearchParams(window.location.search).get('highlight');
  } catch (e) {
    return;
  }
  if (plan !== 'pro' && plan !== 'max') return;

  var card = document.getElementById('plan-' + plan);
  if (!card) return;

  // Height of anything pinned to the top of the viewport: the app's back bar,
  // plus the site nav if it is fixed on this page.
  function fixedTopOffset() {
    var total = 0;
    // The site nav is position:fixed INSIDE #site-header, so the wrapper has
    // no height. Measure the nav itself. The app's back bar is fixed directly.
    // The billing toggle bar is position:sticky and pins to the top while
    // scrolling, so include it too, otherwise a highlighted Pro/Max card lands
    // underneath it.
    var els = [document.getElementById('native-back-bar'),
               document.querySelector('#site-header nav'),
               document.querySelector('.billing-toggle-sticky')];
    els.forEach(function (el) {
      if (!el) return;
      var pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') {
        total = Math.max(total, el.getBoundingClientRect().bottom);
      }
    });
    return total > 0 ? total : 0;
  }

  function run() {
    card.classList.add('is-highlighted');

    var offset = fixedTopOffset();
    var rect = card.getBoundingClientRect();
    var viewport = window.innerHeight || document.documentElement.clientHeight;

    // Already fully visible below whatever is pinned up top? Then the creator
    // can see the card they asked for. Ring it and leave the page alone.
    var fullyVisible = rect.top >= offset && rect.bottom <= viewport;
    if (!fullyVisible) {
      // offset already clears the sticky bar; the bar also has a 24px
      // margin-bottom above the cards, so land the card partway into that gap
      // (pull up ~12px) instead of fully below it, which read as too low.
      var target = rect.top + window.pageYOffset - offset + 30;
      window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }

    // The ring is a landing cue, not a state.
    setTimeout(function () { card.classList.remove('is-highlighted'); }, 2600);
  }

  // The back bar is injected by native-app.js, which is also deferred. Wait a
  // frame so its height is measurable before we compute the offset. Also wait
  // for the redirect overlay (app=1 hand-off) to finish, otherwise the scroll
  // happens under a fixed overlay that iOS Safari detaches mid-scroll. If no
  // overlay is in play, __ryxaRedirDone is set true immediately by the hide
  // routine, so this runs right away as before.
  function startWhenReady() {
    requestAnimationFrame(function () { requestAnimationFrame(run); });
  }
  if (window.__ryxaRedirDone) {
    startWhenReady();
  } else {
    window.__ryxaOnRedirDone = startWhenReady;
    // Safety: never strand the highlight if the overlay callback never fires.
    setTimeout(function () {
      if (!window.__ryxaRedirDone) { window.__ryxaRedirDone = true; startWhenReady(); }
    }, 4000);
  }
})();
