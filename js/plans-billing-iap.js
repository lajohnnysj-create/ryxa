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
var iapRevealOpen = {};             // plan -> bool, preserves toggle state across re-renders
var iapLastErrSig = '';             // dedupe: last purchase-error signature
var iapLastErrAt = 0;               // dedupe: timestamp of last error alert
var iapLastLoadAt = 0;              // throttle: last iapLoadProducts request time

var IAP_SKUS = {
  pro: { monthly: 'io.ryxa.pro.monthly', annual: 'io.ryxa.pro.annual' },
  max: { monthly: 'io.ryxa.max.monthly', annual: 'io.ryxa.max.annual' }
};

// Apple logo (inline SVG), sized to sit left of button text. currentColor so it
// matches whatever text color the button uses.
var APPLE_LOGO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" ' +
  'style="margin-right:8px;flex:0 0 auto;" aria-hidden="true">' +
  '<path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>';

function iapInApp() {
  return !!(window.RyxaNative && window.ReactNativeWebView);
}

function iapPost(msg) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
}

// Render the Apple pay section under the cards (in-app only, page active only).
// Fill each plan card's Apple-pay slot with that tier's button at the CURRENT
// cycle. plans-billing re-renders cards on every monthly/annual toggle, so the
// slots regenerate empty and we refill them. US dual-rail: a compact "Prefer to
// pay with Apple?" toggle that reveals the Apple button. IAP-only: the Apple
// button shows directly (Stripe CTA is hidden by the gate).
function iapRenderSection() {
  var host = document.getElementById('plans-billing-view');
  if (!host || !iapInApp()) return;
  if (!document.body.classList.contains('plans-billing-active')) return;
  var slots = host.querySelectorAll('.pb-iap-slot');
  if (!slots.length) return;
  var cycle = (typeof plansBillingCycle !== 'undefined' && plansBillingCycle) ? plansBillingCycle : 'annual';
  var us = iapUsStorefront();

  slots.forEach(function (slot) {
    var plan = slot.getAttribute('data-iap-plan'); // 'pro' | 'max'
    if (!IAP_SKUS[plan]) return;
    var sku = IAP_SKUS[plan][cycle];
    var price = iapPrices[sku] || '';
    var cycleWord = cycle === 'annual' ? 'year' : 'month';
    var priceLabel = (price ? ' - ' + price : '') + ' / ' + cycleWord;

    // Idempotency signature: only rewrite this slot's DOM when something that
    // affects its markup actually changed. Rewriting innerHTML on every render
    // destroys the elements mid-tap and eats clicks (the toggle glitch), so we
    // skip the rewrite when nothing changed and just leave the live DOM alone.
    var sig = [us ? 'us' : 'iap', sku, price, (iapRevealOpen[plan] ? 'open' : 'shut')].join('|');
    if (slot._iapSig === sig) return;
    slot._iapSig = sig;

    // Dynamic disclosure: reflect the real price + renewal terms Apple returns.
    var note = price
      ? ('Auto-renews at ' + price + ' / ' + cycleWord + ' through your Apple ID until cancelled. Manage in Apple Settings.')
      : ('Billed through your Apple ID. Manage or cancel anytime in Apple Settings.');

    var buyBtn =
      '<button class="pb-iap-buy" data-sku="' + sku + '" style="display:flex;' +
      'align-items:center;justify-content:center;width:100%;margin-top:10px;padding:12px;' +
      'border-radius:10px;border:1px solid var(--border);background:var(--surface2);' +
      'color:var(--text);font-family:\'DM Sans\',sans-serif;font-size:14px;font-weight:600;' +
      'cursor:pointer;">' + APPLE_LOGO + '<span>Pay with Apple' + priceLabel + '</span></button>' +
      '<div class="pb-iap-note" style="margin-top:6px;font-size:11px;color:var(--muted);">' +
      note + '</div>';

    if (us) {
      // Dual-rail: secondary, behind a plain-text toggle (no underline, no
      // border) so the Stripe CTA stays primary. Open state preserved per plan.
      var openClass = (iapRevealOpen[plan]) ? ' pb-iap-open' : '';
      slot.innerHTML =
        '<button class="pb-iap-toggle" data-iap-plan="' + plan + '" style="display:block;' +
        'width:100%;margin-top:10px;background:none;border:none;color:var(--muted);' +
        'font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:600;padding:8px;' +
        'text-align:center;cursor:pointer;">' +
        'Prefer to pay with Apple?</button>' +
        '<div class="pb-iap-reveal' + openClass + '">' + buyBtn + '</div>';
    } else {
      // IAP-only: Apple button is the primary buy action, shown directly.
      slot.innerHTML = buyBtn;
      // The card's headline price is the US web price; in IAP-only markets the
      // user pays the Apple price, so override the big price on this card to
      // match what they'll actually be charged. Only when Apple returned one.
      if (price) {
        var card = slot.closest('.pb-card');
        if (card) {
          var big = card.querySelector('.pb-price-big');
          var suf = card.querySelector('.pb-price-suffix');
          if (big) big.textContent = price;
          if (suf) suf.textContent = '/ ' + cycleWord;
          // The hardcoded US billing disclosure ("Billed $100/year", "7-day
          // free trial, then $240/year") and the "$X billed annually" subline
          // are wrong in IAP-only markets. Replace them with Apple's price.
          var bill = card.querySelector('.pb-disclosure-bill');
          if (bill) {
            bill.textContent = (plan === 'max')
              ? ('7-day free trial, then ' + price + ' / ' + cycleWord + '. Cancel anytime in Apple Settings.')
              : ('Billed ' + price + ' / ' + cycleWord + '. Cancel anytime in Apple Settings.');
          }
          var subl = card.querySelector('.pb-price-sub');
          if (subl) subl.textContent = (cycle === 'annual') ? (price + ' billed annually') : '';
        }
      }
    }
  });

  // Delegate clicks once (toggles reveal; buy posts purchase).
  if (!host._iapBound) {
    host._iapBound = true;
    host.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      var tgl = e.target.closest('.pb-iap-toggle');
      if (tgl) {
        var plan = tgl.getAttribute('data-iap-plan');
        iapRevealOpen[plan] = !iapRevealOpen[plan];
        var rev = tgl.parentNode.querySelector('.pb-iap-reveal');
        if (rev) rev.classList.toggle('pb-iap-open', iapRevealOpen[plan]);
        // Keep the signature in sync so the next render doesn't rewrite (which
        // would reset this toggle we just changed).
        var slot = tgl.closest('.pb-iap-slot');
        if (slot) slot._iapSig = null;
        return;
      }
      var btn = e.target.closest('.pb-iap-buy');
      if (!btn || iapBusy) return;
      var uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
      if (!uid) return;
      iapBusy = true;
      var span = btn.querySelector('span');
      if (span) span.textContent = 'Opening App Store...';
      iapPost({ type: 'iapPurchase', sku: btn.dataset.sku, appAccountToken: uid });
      setTimeout(function () { iapBusy = false; }, 4000);
    });
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

  // --- TESTING DEBUG READOUT (remove before public launch) ---
  // Shows the storefront StoreKit reported. TAP IT to force-cycle the value
  // (USA -> CAN -> null) so you can preview each layout on-device, since iOS 18+
  // sandbox wrongly reports USA. Forcing sets a manual override that wins over
  // the real value until you reload. Delete this block to remove.
  (function () {
    var host = document.getElementById('plans-billing-view');
    if (!host) return;
    var dbg = document.getElementById('pb-iap-debug');
    if (!dbg) {
      dbg = document.createElement('div');
      dbg.id = 'pb-iap-debug';
      dbg.style.cssText = 'margin:14px auto;max-width:340px;padding:8px 12px;border-radius:8px;' +
        'background:#1a1a2e;border:1px dashed #7c3aed;color:#c4b5fd;font:600 12px \'DM Sans\',sans-serif;' +
        'text-align:center;cursor:pointer;';
      var body = host.querySelector('.pb-body');
      if (body) body.appendChild(dbg);
      // Tap to cycle the forced storefront and re-render.
      dbg.addEventListener('click', function () {
        var cur = window.__iapForceStorefront === undefined ? iapStorefront : window.__iapForceStorefront;
        var next = cur === 'USA' ? 'CAN' : (cur === 'CAN' ? null : 'USA');
        window.__iapForceStorefront = next;
        iapStorefront = next;
        iapApplyStorefrontGate();
      });
    }
    var forced = window.__iapForceStorefront !== undefined;
    dbg.textContent = 'DEBUG' + (forced ? ' (FORCED, tap to cycle)' : ' (tap to force)') +
      ' - storefront: ' + (iapStorefront === null ? 'unknown (null)' : iapStorefront) +
      '  |  mode: ' + (iapOnly ? 'IAP-only' : 'US dual-rail') +
      '  |  prices: ' + Object.keys(iapPrices).length;
  })();
  // --- END TESTING DEBUG ---

  if (!document.getElementById('pb-iap-gate-css')) {
    var st = document.createElement('style');
    st.id = 'pb-iap-gate-css';
    st.textContent =
      // Reveal is collapsed by default; open state adds pb-iap-open.
      '.pb-iap-reveal{display:none;}' +
      '.pb-iap-reveal.pb-iap-open{display:block;}' +
      // Hide the Stripe CTA and its link-out disclosure in IAP-only markets.
      'body.iap-only .pb-cta[data-plans-action="checkout"],' +
      'body.iap-only .pb-disclosure-ext{display:none !important;}' +
      // In IAP-only mode the per-card Apple toggle is not used (button shows
      // directly), so hide any stray toggle and force reveals open.
      'body.iap-only .pb-iap-toggle{display:none !important;}' +
      'body.iap-only .pb-iap-reveal{display:block !important;}';
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
  // In IAP-only mode the per-card Apple buttons are the primary buy action;
  // (re)render the slots so they show directly under each card.
  if (iapOnly) {
    iapRenderSection();
  }
}

// Page re-renders wipe the appended section; watch and re-apply. Also covers
// the timing gap: iapReady fires at app launch (on the dashboard home), long
// before the user opens the Plans page, so the initial render is a no-op. This
// observer re-runs the render the moment the Plans page becomes active, using
// the already-cached iapStorefront/iapPrices. Belt-and-suspenders with the
// hashchange/DOMContentLoaded re-attempts below.
(function () {
  var applying = false;
  var view = document.getElementById('plans-billing-view');
  var bodyObs, viewObs;
  var reapply = function () {
    // Guard: our own DOM writes (buttons, gate CSS) land inside the observed
    // view, which would re-trigger the observer and infinite-loop the main
    // thread. Skip re-entrant calls, and pause the view observer while we write.
    if (applying) return;
    if (!document.body.classList.contains('plans-billing-active')) return;
    applying = true;
    if (viewObs) viewObs.disconnect();
    try {
      // Request products at most once every 6s. Without this, while products
      // are failing to load (prices stay empty), every DOM mutation re-fires
      // iapLoadProducts, producing a storm of "couldn't communicate" errors.
      if (iapInApp() && (!Object.keys(iapPrices).length || iapStorefront === null)) {
        var now = Date.now();
        if (now - iapLastLoadAt > 6000) {
          iapLastLoadAt = now;
          iapPost({ type: 'iapLoadProducts' });
        }
      }
      iapRenderSection();
      iapApplyStorefrontGate();
    } catch (e) { /* never let a render error wedge the page */ }
    // Reconnect on the next tick so the writes we just made have settled and
    // don't immediately re-fire the observer.
    setTimeout(function () {
      if (viewObs && view) viewObs.observe(view, { childList: true, subtree: true });
      applying = false;
    }, 0);
  };
  // 1) Fire when the page becomes active (body class flips). Body attributes
  //    only, so our writes inside the view never trigger this one.
  bodyObs = new MutationObserver(reapply);
  bodyObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // 2) Re-apply when the view's content is rebuilt (cycle toggle, tier
  //    re-render). Paused during our own writes via the guard above.
  if (view) {
    viewObs = new MutationObserver(reapply);
    viewObs.observe(view, { childList: true, subtree: true });
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
    // Testing override: if the debug readout forced a storefront, keep it
    // instead of the real (sandbox-buggy) value. Remove with the debug block.
    iapStorefront = (window.__iapForceStorefront !== undefined)
      ? window.__iapForceStorefront
      : (ev.storefront || null);
    iapRenderSection();
    iapApplyStorefrontGate();
  } else if (ev.type === 'iapProducts') {
    (ev.products || []).forEach(function (p) { iapPrices[p.id] = p.displayPrice; });
    // Prices just arrived: re-render so buttons and (IAP-only) card prices show
    // the real Apple price instead of blank.
    iapRenderSection();
  } else if (ev.type === 'iapPurchaseResult') {
    iapHandlePurchase(ev);
  } else if (ev.type === 'iapPurchaseError') {
    iapBusy = false;
    if (ev.code !== 'user_cancelled' && ev.code !== 'E_USER_CANCELLED') {
      // Dedupe: suppress an identical error fired within 3s (guards against any
      // double-emit from the native layer producing two alerts).
      var sig = String(ev.code) + '|' + String(ev.message);
      var now = Date.now();
      if (!(sig === iapLastErrSig && now - iapLastErrAt < 3000)) {
        iapLastErrSig = sig;
        iapLastErrAt = now;
        alert(ev.message || 'Purchase failed.');
      }
    }
  }
});

// The page renders after iapReady in most flows; re-attempt on route changes.
window.addEventListener('hashchange', function () { setTimeout(iapRenderSection, 400); });
document.addEventListener('DOMContentLoaded', function () { setTimeout(iapRenderSection, 1600); });
