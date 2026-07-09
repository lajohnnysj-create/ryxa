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
    if (!currentUser) return;

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

    if (!currentUser || !userPlanKey) {
      // Logged out, or on Free tier - default CTAs, no badges.
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

  if (currentUser && isPaidSubscriber) {
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
  } else if (currentUser) {
    // Logged-in user already on the Free tier. Mirror the Pro/Max "Current
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

  if (!currentUser) {
    // Not signed in - persist the intent so dashboard-shell.js can auto-fire
    // checkout after signup. JSON shape for forward-compat.
    try {
      localStorage.setItem('fts_intended_plan', JSON.stringify({ plan: plan, cycle: cycle }));
    } catch (e) {}
    window.location.href = 'index.html?action=signup';
    return;
  }

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
  setBtnLoading(btn, 'Opening checkout...');

  try {
    var { data, error } = await sb.functions.invoke('create-checkout-session', {
      body: {
        priceId: priceId,
        userId: currentUser.id,
        // Inside the native app, checkout runs in Safari, so success and
        // cancel route through app-return.html, which deep links back in.
        successUrl: window.RyxaNative
          ? window.location.origin + '/app-return.html?status=success'
          : window.location.origin + '/dashboard.html?payment=success',
        cancelUrl: window.RyxaNative
          ? window.location.origin + '/app-return.html?status=cancelled'
          : window.location.origin + '/pricing.html?payment=cancelled'
      }
    });

    if (error) {
      var specificMsg = await extractEdgeFunctionError(error);
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

loadUserState();

// Reset any stuck "Opening checkout..." button when the page is restored from
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
// Free plan. Scroll them to the plan they asked for, and ring it once so it is
// obvious which card answered their click.
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

  card.classList.add('is-highlighted');

  // block:'center' rather than 'start': these cards are tall, and pinning the
  // top edge to the viewport top hides the price on shorter screens.
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // The ring is a landing cue, not a permanent state. Leave the card unmarked
  // once the creator has had a moment to see it.
  setTimeout(function () { card.classList.remove('is-highlighted'); }, 2600);
})();
