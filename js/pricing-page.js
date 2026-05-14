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

// Current authenticated user (or null). Resolved on page load.
var currentUser = null;
sb.auth.getSession().then(function(r) {
  currentUser = (r && r.data && r.data.session) ? r.data.session.user : null;
});

// =================================================================
// BILLING CYCLE TOGGLE
// =================================================================
// Reads/writes a body class (cycle-monthly | cycle-annual) which the CSS
// uses to show/hide the relevant .plan-price-* spans. Each plan card has
// both monthly and annual price markup; CSS reveals one at a time.

function getCurrentCycle() {
  return document.body.classList.contains('cycle-annual') ? 'annual' : 'monthly';
}

function setCycle(cycle) {
  document.body.classList.remove('cycle-monthly', 'cycle-annual');
  document.body.classList.add('cycle-' + cycle);
  // Update toggle button visual state + aria
  document.querySelectorAll('[data-pricing-action="set-cycle"]').forEach(function(btn) {
    var btnCycle = btn.getAttribute('data-cycle');
    var active = btnCycle === cycle;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

pricingRegisterAction('set-cycle', function(_e, el) {
  var cycle = el.getAttribute('data-cycle');
  if (cycle === 'monthly' || cycle === 'annual') setCycle(cycle);
});

// =================================================================
// PLAN SELECTION
// =================================================================
// User clicks a plan's CTA -> figure out:
//   1. Which plan + cycle they selected
//   2. Are they signed in?
//      - Not signed in: store intent, redirect to signup
//      - Signed in: call create-checkout-session edge function directly
//
// Free plan is handled separately - it always goes to signup.

pricingRegisterAction('signup', function() {
  // Free plan CTA - no plan intent, just signup
  window.location.href = 'index.html?action=signup';
});

pricingRegisterAction('select-plan', function(_e, el) {
  var plan = el.getAttribute('data-plan');  // 'pro' or 'max'
  var cycle = getCurrentCycle();             // 'monthly' or 'annual'

  if (!plan || !PRICE_IDS[plan] || !PRICE_IDS[plan][cycle]) {
    console.error('Invalid plan selection:', plan, cycle);
    return;
  }

  if (!currentUser) {
    // Not signed in - persist the intent in localStorage so dashboard-shell.js
    // can auto-fire checkout after signup completes. Using a JSON shape
    // for forward-compat (was: just a string like 'monthly').
    try {
      localStorage.setItem('fts_intended_plan', JSON.stringify({
        plan: plan,
        cycle: cycle
      }));
    } catch (e) {}
    window.location.href = 'index.html?action=signup';
    return;
  }

  // Signed in - kick off checkout immediately
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
      // Whether this is a fresh Stripe Checkout URL or a redirect back to
      // the dashboard (in-place update), follow it.
      window.location.href = data.url;
      return;
    }

    throw new Error('No checkout URL returned');
  } catch (e) {
    clearBtnLoading(btn);
    alert(e.message || 'Could not start checkout. Please try again.');
  }
}
