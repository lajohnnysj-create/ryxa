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
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

  var h = document.createElement('h3');
  h.id = 'pricing-confirm-title';
  h.textContent = title;
  h.style.cssText =
    'font-family:"Syne",sans-serif;font-size:19px;font-weight:800;color:#f0eef8;' +
    'margin:0 0 10px;letter-spacing:-0.4px;';

  var p = document.createElement('p');
  p.textContent = message;
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
    var planLabel = (plan === 'max' ? 'Creator Max' : 'Pro') +
                    (cycle === 'annual' ? ' (Annual)' : ' (Monthly)');
    showPricingConfirm({
      title: 'Switch to ' + planLabel + '?',
      message: 'Your plan will change right away. Stripe will charge a ' +
               'prorated amount today for the new plan, with a credit applied ' +
               'for the unused time on your current plan. This is not a free ' +
               'preview - the charge happens immediately.',
      confirmLabel: 'Confirm and pay',
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
        successUrl: window.location.origin + '/dashboard.html?payment=success',
        cancelUrl:  window.location.origin + '/pricing.html?payment=cancelled'
      }
    });

    if (error) {
      var specificMsg = await extractEdgeFunctionError(error);
      throw new Error(specificMsg || (error.message || 'Could not start checkout'));
    }

    if (data && data.url) {
      // Whether this is a fresh Stripe Checkout URL or a redirect back to the
      // dashboard (in-place subscription update), follow it.
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
