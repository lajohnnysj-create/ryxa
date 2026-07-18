// ============================================================================
// PLANS & BILLING - Apple IAP layer (in-app only).
// Layers onto plans-billing.js. Listens for native 'ryxa-iap' events (bridge in
// DashboardScreen), renders the "Prefer to pay with Apple?" option under the
// plan cards, and runs purchase -> server verify -> finishTransaction.
// Storefront: US shows link-out (existing) + this Apple option; non-US will
// show Apple only (link-out hiding wired at global launch using iapStorefront).
// ============================================================================

var iapStorefront = null;           // e.g. 'USA'; null until iapReady
var iapStorefrontResolved = false;  // true once iapReady has reported (even if null)
var iapPrices = {};                 // productId -> localized display price
var iapBusy = false;
var iapBusyBtn = null;              // the buy button currently mid-purchase
var iapBusyLabel = '';              // its label to restore on completion/error
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
// Build the Apple button's own subtext for a card: real billed amount + trial.
// Max plans carry the 7-day free trial; Pro does not.
function iapAppleSubtext(plan, price, cycleWord) {
  if (!price) return 'Billed through your Apple ID. Manage or cancel anytime in Apple Settings.';
  if (plan === 'max') {
    return '7-day free trial, then ' + price + ' / ' + cycleWord +
      '. Auto-renews through your Apple ID until cancelled. Manage in Apple Settings.';
  }
  return 'Billed ' + price + ' / ' + cycleWord +
    '. Auto-renews through your Apple ID until cancelled. Manage in Apple Settings.';
}

// US dual-rail: when the Apple option is opened on a card, swap that card to
// Apple (hide the Stripe button + Stripe disclosure, show the Apple price as
// the headline). When closed, revert to the original Stripe values. Originals
// are stashed on the card the first time so revert is exact.
function iapApplyCardRail(card, plan, appleOpen) {
  if (!card) return;
  var cycle = (typeof plansBillingCycle !== 'undefined' && plansBillingCycle) ? plansBillingCycle : 'annual';
  var cycleWord = cycle === 'annual' ? 'year' : 'month';
  var sku = IAP_SKUS[plan] ? IAP_SKUS[plan][cycle] : null;
  var price = sku ? (iapPrices[sku] || '') : '';

  var big = card.querySelector('.pb-price-big');
  var suf = card.querySelector('.pb-price-suffix');
  var sub = card.querySelector('.pb-price-sub');
  var cta = card.querySelector('.pb-cta');
  var bill = card.querySelector('.pb-disclosure-bill');
  var ext = card.querySelector('.pb-disclosure-ext');

  // Stash originals once.
  if (card._stripeStash === undefined) {
    card._stripeStash = {
      big: big ? big.textContent : '',
      suf: suf ? suf.textContent : '',
      sub: sub ? sub.textContent : ''
    };
  }

  if (appleOpen) {
    // Hide the Stripe rail (button + its billing/link-out disclosures) whenever
    // the Apple option is open, even before Apple's price has loaded.
    if (cta) cta.style.display = 'none';
    if (bill) bill.style.display = 'none';
    if (ext) ext.style.display = 'none';
    // Swap the headline to the Apple price only once we actually have one.
    if (price) {
      if (big) big.textContent = price;
      if (suf) suf.textContent = '/ ' + cycleWord;
      if (sub) sub.textContent = '';
    }
  } else {
    // Revert to Stripe.
    if (big && card._stripeStash) big.textContent = card._stripeStash.big;
    if (suf && card._stripeStash) suf.textContent = card._stripeStash.suf;
    if (sub && card._stripeStash) sub.textContent = card._stripeStash.sub;
    if (cta) cta.style.display = '';
    if (bill) bill.style.display = '';
    if (ext) ext.style.display = '';
  }
}

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
    // "Unknown" means the storefront has RESOLVED but came back null - only
    // then do we defer pricing. Before resolution we're just still loading, so
    // don't show the deferral (it would flash "See App Store" then swap).
    var storefrontUnknown = (iapStorefrontResolved && iapStorefront === null);
    var priceLabel;
    if (price) {
      priceLabel = ' - ' + price + ' / ' + cycleWord;
    } else if (storefrontUnknown) {
      priceLabel = ''; // button reads just "Pay with Apple"; note explains
    } else {
      priceLabel = ' / ' + cycleWord;
    }

    // Idempotency signature: only rewrite this slot's DOM when something that
    // affects its markup actually changed. Rewriting innerHTML on every render
    // destroys the elements mid-tap and eats clicks (the toggle glitch), so we
    // skip the rewrite when nothing changed and just leave the live DOM alone.
    var sig = [us ? 'us' : 'iap', sku, price, (storefrontUnknown ? 'unk' : 'kn'), (iapRevealOpen[plan] ? 'open' : 'shut')].join('|');
    if (slot._iapSig === sig) return;
    slot._iapSig = sig;

    // Apple button subtext: real billed amount + trial (Max) + renewal terms.
    // When storefront is unknown, defer pricing to the App Store instead of a
    // possibly-wrong number.
    var note = (!price && storefrontUnknown)
      ? 'Pricing shown in the App Store at checkout. Billed through your Apple ID.'
      : iapAppleSubtext(plan, price, cycleWord);

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
      var toggleLabel = iapRevealOpen[plan] ? '&larr; Back to card payment' : 'Prefer to pay with Apple?';
      slot.innerHTML =
        '<button class="pb-iap-toggle" data-iap-plan="' + plan + '" style="display:block;' +
        'width:100%;margin-top:10px;background:none;border:none;color:var(--muted);' +
        'font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:600;padding:8px;' +
        'text-align:center;cursor:pointer;">' +
        toggleLabel + '</button>' +
        '<div class="pb-iap-reveal' + openClass + '">' + buyBtn + '</div>';
      // Re-apply the Apple rail if it's open. Do NOT reset the stash here: the
      // stash must hold the Stripe original, and this render may run while the
      // Apple price is already displayed (e.g. when prices load), so wiping it
      // would capture the Apple price as the "original" and break revert.
      var _card = slot.closest('.pb-card');
      if (_card) { iapApplyCardRail(_card, plan, iapRevealOpen[plan]); }
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
          // Headline already shows the full annual price + "/ year", so the
          // "$X billed annually" subline would be redundant. Clear it.
          var subl = card.querySelector('.pb-price-sub');
          if (subl) subl.textContent = '';
        }
      } else {
        // IAP-only market (or forced non-US) but Apple's price hasn't loaded
        // yet. Don't leave the hardcoded US disclosure ("7-day free trial,
        // billed $100/year") showing - that dollar amount is wrong here. Defer
        // to the App Store until the real localized price arrives.
        var cardP = slot.closest('.pb-card');
        if (cardP) {
          var bigP = cardP.querySelector('.pb-price-big');
          var sufP = cardP.querySelector('.pb-price-suffix');
          var subP = cardP.querySelector('.pb-price-sub');
          var billP = cardP.querySelector('.pb-disclosure-bill');
          if (bigP) bigP.textContent = 'See App Store';
          if (sufP) sufP.textContent = '';
          if (subP) subP.textContent = '';
          if (billP) billP.textContent = (plan === 'max')
            ? '7-day free trial. Pricing shown in the App Store at checkout, billed through your Apple ID.'
            : 'Pricing shown in the App Store at checkout, billed through your Apple ID.';
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
        // Update the toggle label to match the new state (prompt vs back).
        tgl.innerHTML = iapRevealOpen[plan] ? '&larr; Back to card payment' : 'Prefer to pay with Apple?';
        // Swap the whole card rail to Apple (or back to Stripe) so price,
        // button, and disclosure all reflect the chosen payment method.
        iapApplyCardRail(tgl.closest('.pb-card'), plan, iapRevealOpen[plan]);
        // Keep the signature in sync so the next render doesn't rewrite (which
        // would reset this toggle we just changed).
        var slot = tgl.closest('.pb-iap-slot');
        if (slot) slot._iapSig = null;
        return;
      }
      var btn = e.target.closest('.pb-iap-buy');
      if (!btn || iapBusy) return;
      var uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
      if (!uid) { alert('Please sign in before subscribing.'); return; }
      iapBusy = true;
      var span = btn.querySelector('span');
      // Remember this button + its label so any end path (result, error, cancel,
      // timeout) can restore it instead of leaving "Opening App Store..." stuck.
      iapBusyBtn = btn;
      iapBusyLabel = span ? span.textContent : '';
      if (span) span.textContent = 'Opening App Store...';
      iapPost({ type: 'iapPurchase', sku: btn.dataset.sku, appAccountToken: uid });
      // Safety timeout: if no result/error/cancel event arrives (e.g. the user
      // backgrounds the app at the sheet), un-stick the button.
      setTimeout(function () { iapResetBusy(); }, 8000);
    });
  }
}

// Reset the purchase busy state and restore the button label. Safe to call
// multiple times / from any end path.
function iapResetBusy() {
  iapBusy = false;
  if (iapBusyBtn) {
    var s = iapBusyBtn.querySelector('span');
    if (s && iapBusyLabel) s.textContent = iapBusyLabel;
    iapBusyBtn = null;
    iapBusyLabel = '';
  }
}

// Purchase result from native: verify with the server, then finish.
async function iapHandlePurchase(detail) {
  try {
    // A transaction can redeliver at app launch (StoreKit re-sends unfinished
    // ones) BEFORE the user has signed in. Verify requires an auth session, so
    // calling it now would 401 and show a scary "could not confirm" error on
    // the login screen. Instead, hold: leave the transaction unfinished (do NOT
    // finish it) so StoreKit redelivers it again after the user signs in, when
    // verify can succeed. Silent, no user-facing error.
    var signedIn = false;
    try {
      var sess = await sb.auth.getSession();
      signedIn = !!(sess && sess.data && sess.data.session);
    } catch (e) { signedIn = false; }
    if (!signedIn) {
      return; // wait for a session; the transaction stays pending for retry
    }
    var resp = await sb.functions.invoke('verify-apple-purchase', {
      body: { transactionId: detail.transactionId }
    });
    // supabase-js puts a non-2xx into resp.error as a FunctionsHttpError whose
    // .context is the raw Response. The real reason (account_mismatch,
    // transaction_not_found, etc.) is in that response BODY, not resp.error.message
    // (which is just "non-2xx status code"). Pull it out so we can see it.
    if (resp && resp.error) {
      var status = '';
      var bodyText = '';
      try {
        if (resp.error.context && typeof resp.error.context.status !== 'undefined') {
          status = resp.error.context.status;
        }
        if (resp.error.context && typeof resp.error.context.text === 'function') {
          bodyText = await resp.error.context.text();
        }
      } catch (x) { bodyText = '(could not read body)'; }
      console.error('verify-apple-purchase HTTP error', status, bodyText);
      // A cancelled or never-completed purchase has no valid transaction in
      // Apple's system, so verify returns transaction_not_found (404). The user
      // cancelled - there's nothing to apply and nothing to warn about. Clear it
      // silently so it stops redelivering, with no alarming message.
      if (bodyText.indexOf('transaction_not_found') !== -1) {
        iapPost({ type: 'iapForceFinish', transactionId: detail.transactionId });
        return;
      }
      var permReasons = ['account_mismatch', 'wrong_bundle', 'unknown_product', 'expired'];
      var hitPerm = permReasons.some(function (r) { return bodyText.indexOf(r) !== -1; });
      if (hitPerm) {
        iapPost({ type: 'iapForceFinish', transactionId: detail.transactionId });
        alert('This purchase could not be applied and was cleared. If you were charged, contact hello@ryxa.io.');
      } else {
        alert('We could not confirm your purchase. Please try again in a moment, or contact hello@ryxa.io if you were charged.');
      }
      return;
    }
    if (resp && resp.data && resp.data.ok) {
      iapPost({ type: 'iapFinish', transactionId: detail.transactionId });
      if (typeof showToast === 'function') showToast('Purchase complete. Welcome!');
      // Refresh tier so the page and nav flip (Media Kit, page hides).
      if (typeof fetchTier === 'function' && typeof currentUser !== 'undefined' && currentUser) {
        setTimeout(function () { fetchTier(currentUser.id); }, 800);
      }
      setTimeout(function () { window.location.href = '/dashboard.html?payment=success'; }, 1200);
    } else {
      // Verify ran but did not return ok: surface the reason for debugging.
      var reason = (resp && (resp.error || (resp.data && resp.data.error))) || 'unknown';
      console.error('verify-apple-purchase not ok:', reason);
      // PERMANENT failures mean this transaction can NEVER be granted to this
      // user (e.g. its embedded appAccountToken belongs to a different/old
      // account). Left unfinished, it redelivers forever and BLOCKS all new
      // purchases of the same product. Force-finish it to clear the block.
      // Transient failures (network, 500) are NOT force-finished - they should
      // retry on the next redelivery.
      var reasonStr = (typeof reason === 'string') ? reason : (reason && reason.error) || '';
      // Cancelled/never-completed purchase: clear silently, no message.
      if (reasonStr === 'transaction_not_found') {
        iapPost({ type: 'iapForceFinish', transactionId: detail.transactionId });
        return;
      }
      var permanent = ['account_mismatch', 'wrong_bundle', 'unknown_product', 'expired'];
      if (permanent.indexOf(reasonStr) !== -1) {
        iapPost({ type: 'iapForceFinish', transactionId: detail.transactionId });
        alert('This purchase could not be applied and was cleared. If you were charged, contact hello@ryxa.io.');
      } else {
        alert('We could not confirm your purchase. Please try again in a moment, or contact hello@ryxa.io if you were charged.');
      }
    }
  } catch (e) {
    // The invoke itself failed (auth/session/network) - never reached the
    // function, which is why the server logs are empty. Show it directly.
    console.error('verify-apple-purchase invoke threw:', e && (e.message || e));
    alert('We could not reach the store to confirm your purchase. Please check your connection and try again.');
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
  // Until the storefront actually resolves, hold the dual-rail (Stripe) layout
  // rather than flashing IAP-only: every card already has valid Stripe prices,
  // so this shows something correct immediately, then only flips to IAP-only if
  // the resolved storefront is confirmed non-US. Avoids the load-time flash.
  var iapOnly = iapStorefrontResolved && !iapUsStorefront();
  document.body.classList.toggle('iap-only', iapOnly);


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
// Process a single native IAP event (deduped). Exposed so both the live
// CustomEvent path AND the window-queue drain (for events that arrived while
// the page was loading/navigating) funnel through one place.
var _iapSeen = {};
function _ryxaHandleIapDetail(detailStr) {
  var ev;
  try { ev = JSON.parse(detailStr); } catch (err) { return; }
  if (!ev || !ev.type) return;
  // Dedup purchase result/error by transaction id so the native retry loop
  // can't process the same purchase twice.
  if (ev.type === 'iapPurchaseResult' || ev.type === 'iapPurchaseError') {
    var key = ev.type + '|' + (ev.transactionId || ev.code || '') + '|' + (ev.message || '');
    if (_iapSeen[key]) return;
    _iapSeen[key] = true;
  }
  _ryxaDispatchIap(ev);
}

// Drain any events the native side queued on window (covers events injected
// while this page was still loading, which the live listener would have missed).
window.__ryxaDrainIap = function () {
  try {
    var q = window.__ryxaIapQueue || [];
    for (var i = 0; i < q.length; i++) { _ryxaHandleIapDetail(q[i]); }
    window.__ryxaIapQueue = [];
  } catch (e) {}
};

document.addEventListener('ryxa-iap', function (e) {
  _ryxaHandleIapDetail(e.detail);
});

// Drain the native queue REPEATEDLY after load. The native side may inject a
// redelivered transaction (e.g. on cold relaunch) before OR after this script
// attaches; a single drain can miss that race. Poll for ~15s so the queued
// event is caught whenever it lands, then rely on the live listener.
(function () {
  var drains = 0;
  var t = setInterval(function () {
    drains += 1;
    if (window.__ryxaDrainIap) window.__ryxaDrainIap();
    if (drains >= 30) clearInterval(t); // 30 x 500ms = 15s
  }, 500);
  // Also drain immediately.
  if (window.__ryxaDrainIap) window.__ryxaDrainIap();
})();

function _ryxaDispatchIap(ev) {
  if (ev.type === 'iapReady') {
    iapStorefront = ev.storefront || null;
    iapStorefrontResolved = true;
    // Full re-render so cards rebuild for the resolved storefront (US shows
    // Stripe prices; non-US applies the IAP deferral / Apple price).
    if (typeof renderPlansBilling === 'function' &&
        document.body.classList.contains('plans-billing-active')) {
      renderPlansBilling();
    }
    iapRenderSection();
    iapApplyStorefrontGate();
  } else if (ev.type === 'iapProducts') {
    (ev.products || []).forEach(function (p) { iapPrices[p.id] = p.displayPrice; });
    // Prices just arrived: re-render so buttons and (IAP-only) card prices show
    // the real Apple price instead of blank.
    iapRenderSection();
  } else if (ev.type === 'iapPurchaseResult') {
    iapResetBusy();
    iapHandlePurchase(ev);
  } else if (ev.type === 'iapPurchaseError') {
    iapResetBusy();
    if (ev.code !== 'user_cancelled' && ev.code !== 'E_USER_CANCELLED') {
      // Dedupe: suppress an identical error fired within 3s (guards against any
      // double-emit from the native layer producing two alerts).
      var sig = String(ev.code) + '|' + String(ev.message);
      var now = Date.now();
      if (!(sig === iapLastErrSig && now - iapLastErrAt < 3000)) {
        iapLastErrSig = sig;
        iapLastErrAt = now;
        alert('The purchase did not go through. Please try again, or contact hello@ryxa.io if the problem continues.');
      }
    }
  }
}

// The page renders after iapReady in most flows; re-attempt on route changes.
window.addEventListener('hashchange', function () { setTimeout(iapRenderSection, 400); });
document.addEventListener('DOMContentLoaded', function () { setTimeout(iapRenderSection, 1600); });
