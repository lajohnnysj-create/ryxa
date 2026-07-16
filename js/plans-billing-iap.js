// ============================================================================
// PLANS & BILLING - Apple IAP layer (in-app only).
// Layers onto plans-billing.js. Listens for native 'ryxa-iap' events (bridge in
// DashboardScreen), renders the "Prefer to pay with Apple?" option under the
// plan cards, and runs purchase -> server verify -> finishTransaction.
// Storefront: US shows link-out (existing) + this Apple option; non-US will
// show Apple only (link-out hiding wired at global launch using iapStorefront).
// ============================================================================

var iapStorefront = null;           // e.g. 'USA'; null until iapReady
var iapPrices = {};                 // productId -> localized display price
var iapBusy = false;

var IAP_SKUS = {
  pro: { monthly: 'io.ryxa.pro.monthly', annual: 'io.ryxa.pro.annual' },
  max: { monthly: 'io.ryxa.max.monthly', annual: 'io.ryxa.max.annual' }
};

function iapInApp() {
  return !!(window.RyxaNative && window.ReactNativeWebView);
}

function iapPost(msg) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
}

// Render the Apple pay section under the cards (in-app only, page active only).
function iapRenderSection() {
  var host = document.getElementById('plans-billing-view');
  if (!host || !iapInApp()) return;
  if (!document.body.classList.contains('plans-billing-active')) return;
  if (document.getElementById('pb-iap-section')) return;
  var body = host.querySelector('.pb-body');
  if (!body) return;

  var el = document.createElement('div');
  el.id = 'pb-iap-section';
  el.style.cssText = 'margin-top:26px;text-align:center;';
  el.innerHTML =
    '<button id="pb-iap-toggle" style="background:none;border:1px solid var(--border);' +
    'color:var(--muted);font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:600;' +
    'padding:10px 18px;border-radius:10px;cursor:pointer;">Prefer to pay with Apple?</button>' +
    '<div id="pb-iap-options" style="display:none;margin-top:14px;"></div>';
  body.appendChild(el);

  document.getElementById('pb-iap-toggle').addEventListener('click', function () {
    var opts = document.getElementById('pb-iap-options');
    if (!opts) return;
    var plan = 'pro', cycle = plansBillingCycle || 'annual';
    // Offer both tiers at the selected cycle, with Apple's localized prices.
    var rows = ['pro', 'max'].map(function (p) {
      var sku = IAP_SKUS[p][cycle];
      var price = iapPrices[sku] || '';
      var name = p === 'max' ? 'Creator Max' : 'Pro';
      return '<button class="pb-iap-buy" data-sku="' + sku + '" style="display:block;width:100%;' +
        'max-width:340px;margin:8px auto;padding:12px;border-radius:10px;border:1px solid var(--border);' +
        'background:var(--surface2);color:var(--text);font-family:\'DM Sans\',sans-serif;font-size:14px;' +
        'font-weight:600;cursor:pointer;">' + name + (price ? ' - ' + price : '') +
        (cycle === 'annual' ? ' / year' : ' / month') + '</button>';
    }).join('');
    opts.innerHTML = rows +
      '<div style="font-size:11px;color:var(--muted);margin-top:8px;">Billed through your Apple ID. ' +
      'Manage or cancel anytime in Apple Settings.</div>';
    opts.style.display = opts.style.display === 'none' ? 'block' : 'none';
  });

  el.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.pb-iap-buy') : null;
    if (!btn || iapBusy) return;
    var uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    if (!uid) return;
    iapBusy = true;
    btn.textContent = 'Opening App Store...';
    iapPost({ type: 'iapPurchase', sku: btn.dataset.sku, appAccountToken: uid });
    setTimeout(function () { iapBusy = false; iapRefreshLabels(); }, 4000);
  });
}

function iapRefreshLabels() {
  var opts = document.getElementById('pb-iap-options');
  if (opts && opts.style.display !== 'none') {
    opts.style.display = 'none';
    document.getElementById('pb-iap-toggle') && document.getElementById('pb-iap-toggle').click();
  }
}

// Purchase result from native: verify with the server, then finish.
async function iapHandlePurchase(detail) {
  try {
    var resp = await sb.functions.invoke('verify-apple-purchase', {
      body: { transactionId: detail.transactionId }
    });
    if (resp && resp.data && resp.data.ok) {
      iapPost({ type: 'iapFinish', transactionId: detail.transactionId });
      if (typeof showToast === 'function') showToast('Purchase complete. Welcome!');
      // Refresh tier so the page and nav flip (Media Kit, page hides).
      if (typeof fetchTier === 'function' && typeof currentUser !== 'undefined' && currentUser) {
        setTimeout(function () { fetchTier(currentUser.id); }, 800);
      }
      setTimeout(function () { window.location.href = '/dashboard.html?payment=success'; }, 1200);
    } else {
      alert('We could not confirm your purchase yet. It will retry automatically when you reopen the app.');
    }
  } catch (e) {
    alert('We could not confirm your purchase yet. It will retry automatically when you reopen the app.');
  } finally {
    iapBusy = false;
  }
}

// ---- Global launch: storefront gate ----------------------------------------
// In-app, only the US storefront may show the Stripe link-out. Everywhere else
// (or when the storefront is unknown: FAIL CLOSED) the page is IAP-only: the
// card CTAs/disclosures are hidden and Apple is the sole purchase method.
// Web (not in-app) is untouched; Stripe remains the web flow.
function iapUsStorefront() { return iapStorefront === 'USA'; }

var _origPlansCheckout = null;
function iapApplyStorefrontGate() {
  if (!iapInApp()) return;
  var iapOnly = !iapUsStorefront();
  document.body.classList.toggle('iap-only', iapOnly);
  if (!document.getElementById('pb-iap-gate-css')) {
    var st = document.createElement('style');
    st.id = 'pb-iap-gate-css';
    st.textContent = 'body.iap-only .pb-cta[data-plans-action="checkout"],' +
      'body.iap-only .pb-disclosure{display:none !important;}' +
      'body.iap-only #pb-iap-toggle{display:none !important;}' +
      'body.iap-only #pb-iap-options{display:block !important;margin-top:4px;}';
    document.head.appendChild(st);
  }
  // Hard block: even if a link-out element slips through, the checkout
  // function itself refuses outside the US storefront.
  if (typeof plansBillingCheckout === 'function' && !_origPlansCheckout) {
    _origPlansCheckout = plansBillingCheckout;
    // eslint-disable-next-line no-global-assign
    plansBillingCheckout = function (plan, btn) {
      if (iapInApp() && !iapUsStorefront()) return; // IAP-only market
      return _origPlansCheckout(plan, btn);
    };
  }
  // In IAP-only mode the Apple options render open as the primary buy method.
  if (iapOnly) {
    iapRenderSection();
    var opts = document.getElementById('pb-iap-options');
    var toggle = document.getElementById('pb-iap-toggle');
    if (opts && toggle && !opts.innerHTML) toggle.click();
  }
}

// Page re-renders wipe the appended section; watch and re-apply. Also covers
// the timing gap: iapReady fires at app launch (on the dashboard home), long
// before the user opens the Plans page, so the initial render is a no-op. This
// observer re-runs the render the moment the Plans page becomes active, using
// the already-cached iapStorefront/iapPrices. Belt-and-suspenders with the
// hashchange/DOMContentLoaded re-attempts below.
(function () {
  var reapply = function () {
    if (document.body.classList.contains('plans-billing-active')) {
      if (iapInApp() && !Object.keys(iapPrices).length) {
        iapPost({ type: 'iapLoadProducts' });
      }
      iapRenderSection();
      iapApplyStorefrontGate();
    }
  };
  // 1) Fire the instant the page becomes active (body class flips). Cheap:
  //    only watches body's own class attribute.
  new MutationObserver(reapply).observe(document.body, {
    attributes: true, attributeFilter: ['class'],
  });
  // 2) Re-apply when the view's content is (re)built while already active, so
  //    a cycle-toggle or tier re-render doesn't drop the IAP section. Scoped to
  //    the view container only.
  var view = document.getElementById('plans-billing-view');
  if (view) {
    new MutationObserver(reapply).observe(view, { childList: true, subtree: true });
  }
})();

// ---- Settings: swap Stripe management for Apple management --------------------
// When the user's active sub is an Apple IAP, the Stripe "Change Plan / Manage
// Billing" controls do nothing useful (and could create a conflicting Stripe
// sub), so hide them and show the Apple path instead: in-app, a button that
// deep-links to Apple's subscription settings; on desktop web, instructions
// (no native bridge to deep-link with).
async function iapApplySettingsManagement() {
  var stripeControls = document.getElementById('settings-sub-stripe-controls');
  var appleControls = document.getElementById('settings-sub-apple-controls');
  if (!stripeControls || !appleControls) return;
  var uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  if (!uid) return;
  var isApple = false;
  try {
    var q = await sb.from('subscriptions')
      .select('source, apple_expires_at')
      .eq('user_id', uid)
      .limit(1);
    if (q && q.data && q.data.length) {
      isApple = q.data[0].source === 'apple' &&
        q.data[0].apple_expires_at &&
        new Date(q.data[0].apple_expires_at).getTime() > Date.now();
    }
  } catch (e) { /* on error, leave Stripe controls (safe default) */ }

  if (isApple) {
    stripeControls.style.display = 'none';
    appleControls.style.display = 'block';
    // In-app: working deep-link button. Web: hide button, show instructions.
    var btn = document.getElementById('settings-apple-manage-btn');
    var hint = document.getElementById('settings-apple-web-hint');
    if (iapInApp()) {
      if (btn) btn.style.display = 'block';
      if (hint) hint.style.display = 'none';
    } else {
      if (btn) btn.style.display = 'none';
      if (hint) hint.style.display = 'block';
    }
  } else {
    stripeControls.style.display = 'block';
    appleControls.style.display = 'none';
  }
}

// Wire the "Manage in Apple Settings" button to the native deep-link.
document.addEventListener('click', function (e) {
  var t = e.target;
  if (t && t.getAttribute && t.getAttribute('data-settings-action') === 'manage-apple') {
    if (iapInApp()) iapPost({ type: 'iapManage' });
  }
});

// Native -> web events.
document.addEventListener('ryxa-iap', function (e) {
  var ev;
  try { ev = JSON.parse(e.detail); } catch (err) { return; }
  if (!ev || !ev.type) return;
  if (ev.type === 'iapReady') {
    iapStorefront = ev.storefront || null;
    iapRenderSection();
    iapApplyStorefrontGate();
  } else if (ev.type === 'iapProducts') {
    (ev.products || []).forEach(function (p) { iapPrices[p.id] = p.displayPrice; });
  } else if (ev.type === 'iapPurchaseResult') {
    iapHandlePurchase(ev);
  } else if (ev.type === 'iapPurchaseError') {
    iapBusy = false;
    if (ev.code !== 'user_cancelled' && ev.code !== 'E_USER_CANCELLED') {
      alert(ev.message || 'Purchase failed.');
    }
  }
});

// The page renders after iapReady in most flows; re-attempt on route changes.
window.addEventListener('hashchange', function () { setTimeout(iapRenderSection, 400); });
document.addEventListener('DOMContentLoaded', function () { setTimeout(iapRenderSection, 1600); });
