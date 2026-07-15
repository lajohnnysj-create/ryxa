// ============================================================================
// PLANS & BILLING - dedicated in-dashboard upgrade page (Spotify-style).
//
// STATUS: hidden pre-launch build. Gated to the admin account only via
// plansBillingAllowed(). Reached by a gated hash route (#plans-billing), no
// visible button, so it renders for nobody else while we test and wait on
// Apple approval. Designed so launch = widening plansBillingAllowed() (and
// later adding the iOS US-storefront check), NOT unhiding a concealed
// payment surface. This page is INTENDED to become visible and reviewed.
//
// Behavior today (US external-link model): plan cards + CTAs that link out to
// the existing pricing/checkout flow in the browser, through the "Redirecting
// to ryxa.io" overlay. No in-app payment. The later global build adds the
// compliant dead-end variant keyed on storefront.
// ============================================================================

// Immutable admin gate. user_id is the durable identity (email can change), so
// we match on it; email is accepted too as a convenience for the same account.
var PLANS_BILLING_ADMIN_ID = '81880735-a212-4ae1-87a8-ebac6a22025d';
var PLANS_BILLING_ADMIN_EMAIL = 'johnny@johnnyla.com';

function plansBillingAllowed() {
  try {
    var u = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
    if (!u) return false;
    if (u.id && u.id === PLANS_BILLING_ADMIN_ID) return true;
    if (u.email && u.email.toLowerCase() === PLANS_BILLING_ADMIN_EMAIL) return true;
    return false;
  } catch (e) { return false; }
}

// Plan data mirrors pricing.html (kept in sync manually). Prices shown per the
// selected cycle; annual shows the effective monthly rate plus the billed
// total, matching the pricing page.
var PLANS_BILLING_DATA = {
  pro: {
    name: 'Pro',
    accent: '#a855f7',
    tagline: 'For creators ready to take control of their branding.',
    monthly: { big: '$10', suffix: '/ month', sub: '' },
    annual:  { big: '$8.33', suffix: '/ month', sub: '$100 billed annually' },
    features: [
      '40 daily AI credits',
      'Everything in Free',
      'Media Kit with Daily Updating',
      'Analytics for Link in Bio',
      'Follow-Back Audit with Full List',
      'AI Chatbox',
      'Script Builder',
      'AI Thumbnail Analyzer',
      'AI Contract Analyzer',
      'Remove Ryxa branding',
      'Apply for a verified blue check',
      'Unlock Hero Link & Profile Picture for Link in Bio',
      'Custom themes for Link in Bio & Media Kit',
      'Background removal in Design Studio & Photo Editor',
      'Invoice logo + QR custom colors',
      'Save photos in Grid Planner'
    ]
  },
  max: {
    name: 'Max',
    accent: '#e879f9',
    tagline: 'For creators ready to sell and scale.',
    monthly: { big: '$24', suffix: '/ month', sub: '' },
    annual:  { big: '$20', suffix: '/ month', sub: '$240 billed annually' },
    features: [
      '85 daily AI credits',
      'Everything in Pro',
      'Sell Courses with Video Hosting',
      'Sell 1:1 Sessions',
      'Sell Digital Products',
      'Brand Deal CRM',
      'Store Analytics',
      'Ryxa takes 0% transaction fees'
    ]
  }
};

var plansBillingCycle = 'annual'; // default matches pricing.html

function plansBillingCheckIcon() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:2px;"><polyline points="20 6 9 17 4 12"/></svg>';
}

function plansBillingExtIcon() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-left:7px;vertical-align:-2px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
}

function plansBillingCard(key) {
  var p = PLANS_BILLING_DATA[key];
  var price = p[plansBillingCycle];
  var featuresHtml = p.features.map(function (f) {
    return '<div class="pb-feature"><span class="pb-check" style="color:' + p.accent + ';">'
      + plansBillingCheckIcon() + '</span><span>' + escapeHtml(f) + '</span></div>';
  }).join('');

  var subHtml = price.sub
    ? '<div class="pb-price-sub">' + escapeHtml(price.sub) + '</div>' : '';

  return '<div class="pb-card">'
    + '<div class="pb-card-head">'
    + '<img src="/logo.png?v=2" alt="" class="pb-card-logo">'
    + '<span class="pb-card-brand">Ryxa</span>'
    + '</div>'
    + '<div class="pb-tier" style="color:' + p.accent + ';">' + p.name + '</div>'
    + '<div class="pb-price"><span class="pb-price-big">' + price.big + '</span> '
    + '<span class="pb-price-suffix">' + price.suffix + '</span></div>'
    + subHtml
    + '<div class="pb-divider"></div>'
    + '<div class="pb-features">' + featuresHtml + '</div>'
    + '<button class="pb-cta pb-cta-' + key + '" data-plans-action="checkout" data-plan="' + key + '">'
    + 'Get ' + p.name + plansBillingExtIcon() + '</button>'
    + '<div class="pb-disclosure">By clicking this button you\'ll be taken to our website.</div>'
    + '</div>';
}

function renderPlansBilling() {
  var host = document.getElementById('plans-billing-view');
  if (!host) return;

  // Hard gate: never render for anyone but the admin account.
  if (!plansBillingAllowed()) {
    host.innerHTML = '';
    host.style.display = 'none';
    return;
  }
  host.style.display = 'block';

  var cyc = plansBillingCycle;
  host.innerHTML =
    '<div class="pb-hero">'
    + '<img src="/ryxamodel.webp" alt="" class="pb-hero-img">'
    + '<div class="pb-hero-fade"></div>'
    + '<div class="pb-hero-row">'
    + '<div class="pb-hero-brand"><img src="/logo.png?v=2" alt="Ryxa" class="pb-hero-logo"><span>Ryxa</span></div>'
    + '<div class="pb-hero-tag">Max</div>'
    + '</div>'
    + '</div>'
    + '<div class="pb-body">'
    + '<h1 class="pb-title">Get more out of your creator business with Ryxa Pro or Max.</h1>'
    + '<div class="pb-section-head">'
    + '<h2>Available plans</h2>'
    + '<div class="pb-cycle" role="tablist" aria-label="Billing cycle">'
    + '<button class="pb-cycle-btn' + (cyc === 'monthly' ? ' active' : '') + '" role="tab" aria-selected="' + (cyc === 'monthly') + '" data-plans-action="set-cycle" data-cycle="monthly">Monthly</button>'
    + '<button class="pb-cycle-btn' + (cyc === 'annual' ? ' active' : '') + '" role="tab" aria-selected="' + (cyc === 'annual') + '" data-plans-action="set-cycle" data-cycle="annual">Yearly</button>'
    + '</div>'
    + '</div>'
    + '<div class="pb-cards">'
    + plansBillingCard('pro')
    + plansBillingCard('max')
    + '</div>'
    + '</div>';
}

// ---- Actions -------------------------------------------------------------

function plansBillingSetCycle(cycle) {
  if (cycle !== 'monthly' && cycle !== 'annual') return;
  plansBillingCycle = cycle;
  renderPlansBilling();
}

// Link out to the existing pricing/checkout flow, pre-selecting plan + cycle,
// through the redirect overlay. Reuses mintPricingTicketThenOpen (the proven
// path the rest of the app uses): it mints an account ticket, appends app=1,
// and navigates, which the native layer intercepts to open Safari. Direct-to-
// Stripe-Checkout is the later optimization.
function plansBillingCheckout(plan, btn) {
  if (!plan) return;
  var inApp = !!(window.RyxaNative && window.ReactNativeWebView);
  if (btn) {
    btn.disabled = true;
    btn.dataset._label = btn.innerHTML;
    btn.textContent = 'Redirecting to website...';
  }
  var resetBtn = function () {
    if (btn) {
      btn.disabled = false;
      if (btn.dataset._label) btn.innerHTML = btn.dataset._label;
    }
  };

  // mintPricingTicketThenOpen takes a QUERY STRING (e.g. "?plan=pro&cycle=annual").
  var query = '?plan=' + encodeURIComponent(plan) + '&cycle=' + encodeURIComponent(plansBillingCycle);
  try {
    if (typeof mintPricingTicketThenOpen === 'function') {
      mintPricingTicketThenOpen(query);
      // In-app the WebView stays put (native opened Safari), so reset the
      // button after the hand-off; on web the page navigates away anyway.
      if (inApp) setTimeout(resetBtn, 1500);
      return;
    }
  } catch (e) { /* fall through */ }

  // Fallback: plain navigation if the mint helper isn't present.
  window.location.href = 'https://ryxa.io/pricing.html' + query;
}

// ---- Wiring --------------------------------------------------------------

function plansBillingHandleAction(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-plans-action]') : null;
  if (!el) return;
  var action = el.dataset.plansAction;
  if (action === 'set-cycle') {
    plansBillingSetCycle(el.dataset.cycle);
  } else if (action === 'checkout') {
    if (!plansBillingAllowed()) return; // defensive: never checkout for non-admin
    plansBillingCheckout(el.dataset.plan, el);
  }
}

// Gated hash route: #plans-billing shows the page ONLY for the admin account.
function plansBillingRouteCheck() {
  var host = document.getElementById('plans-billing-view');
  if (!host) return;
  var wanted = (window.location.hash || '').replace('#', '') === 'plans-billing';
  if (wanted && plansBillingAllowed()) {
    // Hide the normal tool views so this page stands alone.
    document.querySelectorAll('[id^="tool-"]').forEach(function (t) {
      t.style.display = 'none';
    });
    renderPlansBilling();
    host.scrollIntoView({ block: 'start' });
  } else if (wanted && !plansBillingAllowed()) {
    // Non-admin trying the hash: strip it, render nothing.
    try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
    host.innerHTML = '';
    host.style.display = 'none';
  }
}

document.addEventListener('click', plansBillingHandleAction);
window.addEventListener('hashchange', plansBillingRouteCheck);
document.addEventListener('DOMContentLoaded', function () {
  // Delay slightly so currentUser is populated by dashboard-shell before the
  // gate evaluates on a direct load with the hash present.
  setTimeout(plansBillingRouteCheck, 800);
});
