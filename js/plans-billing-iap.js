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
// Android only. Whether Google reports the external content links program
// available for this user, which is simultaneously the enrollment check and
// the US eligibility check. Defaults false and STAYS false on any error or
// non-answer: the Stripe link-out is US only, so an unknown region must fall
// back to Play Billing, never to Stripe.
var iapExternalLinksAvailable = false;
var iapExternalLinksResolved = false;

var IAP_SKUS = {
  pro: { monthly: 'io.ryxa.pro.monthly', annual: 'io.ryxa.pro.annual' },
  max: { monthly: 'io.ryxa.max.monthly', annual: 'io.ryxa.max.annual' }
};

// Apple logo (inline SVG), sized to sit left of button text. currentColor so it
// matches whatever text color the button uses.
var APPLE_LOGO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" ' +
  'style="margin-right:8px;flex:0 0 auto;" aria-hidden="true">' +
  '<path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>';

// Google Play triangle, same sizing treatment as the Apple mark above.
var PLAY_LOGO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" ' +
  'style="margin-right:8px;flex:0 0 auto;" aria-hidden="true">' +
  '<path d="M3.6 1.8a1 1 0 0 0-.5.9v18.6a1 1 0 0 0 .5.9l10-10.2-10-10.2zM15 8.9 5.4 1.4l11.1 6.4L15 8.9zm0 6.2 1.5 1.1-11.1 6.4L15 15.1zm2.9-4.6 3 1.7a1 1 0 0 1 0 1.7l-3 1.7-2-1.4-1.1-1.1 1.1-1.1 2-1.5z"/></svg>';

function iapInApp() {
  return !!(window.RyxaNative && window.ReactNativeWebView);
}

// Which native platform the shell reports ('ios' | 'android'), set by the app
// in window.RyxaNative. Everything in this file is the APPLE purchase rail, so
// it must only ever render on iOS. Android has its own billing path and gets
// the standard web/Stripe page instead. Without this check Android fell into
// the non-US branch (getStorefront is iOS only, so the storefront resolves to
// null there), which showed Apple UI and blocked Stripe checkout.
function iapNativePlatform() {
  try {
    return (window.RyxaNative && window.RyxaNative.platform) || '';
  } catch (e) {
    return '';
  }
}
function iapAppleAvailable() {
  return iapInApp() && iapNativePlatform() === 'ios';
}
function iapGoogleAvailable() {
  return iapInApp() && iapNativePlatform() === 'android';
}

// Whether a native store button (Apple IAP or Play Billing) is shown at all.
// iOS always shows one: in the US as a secondary option beside Stripe, outside
// it as the only option. Android shows one ONLY when the Stripe link-out is
// unavailable, because the two are mutually exclusive there: US Android links
// out under Google's external content links program, everywhere else pays
// through Play Billing. Fail closed, so an unresolved signal shows Play.
function iapNativeSectionVisible() {
  if (!iapInApp()) return false;
  if (iapGoogleAvailable()) return !iapExternalLinksAvailable;
  return iapAppleAvailable();
}

// Whether the native store is the ONLY way to pay, which hides the Stripe CTA
// and blocks Stripe checkout. Same rule as above, minus the US iOS dual rail.
function iapNativeOnly() {
  if (!iapInApp()) return false;
  if (iapGoogleAvailable()) return !iapExternalLinksAvailable;
  return iapAppleAvailable() && !iapUsStorefront();
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
  var acct = iapGoogleAvailable() ? 'Google Play account' : 'Apple ID';
  var where = iapGoogleAvailable() ? 'the Play Store' : 'Apple Settings';
  if (!price) return 'Billed through your ' + acct + '. Manage or cancel anytime in ' + where + '.';
  if (plan === 'max') {
    return '7-day free trial, then ' + price + ' / ' + cycleWord +
      '. Auto-renews through your ' + acct + ' until cancelled. Manage in ' + where + '.';
  }
  return 'Billed ' + price + ' / ' + cycleWord +
    '. Auto-renews through your ' + acct + ' until cancelled. Manage in ' + where + '.';
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
  if (!host) return;
  if (!iapNativeSectionVisible()) {
    // No native rail here (web, or US Android where checkout links out to
    // Stripe): clear any store markup left from a previous render, then leave
    // the page alone.
    //
    // (When the rail IS visible, the reveal CSS is ensured below before any
    // button markup is written.)
    try {
      host.querySelectorAll('.pb-iap-slot').forEach(function (s) { s.innerHTML = ''; });
    } catch (e) {}
    return;
  }
  if (!document.body.classList.contains('plans-billing-active')) return;
  // The collapsed-by-default CSS must exist before any store button markup is
  // written. Every event path runs the gate (which injects it) alongside this
  // render, but the 1.6s DOMContentLoaded fallback calls this function alone,
  // and on a slow native init that could paint the buttons expanded until
  // iapReady arrived. Idempotent, so calling it here too costs nothing.
  iapEnsureGateCss();
  var slots = host.querySelectorAll('.pb-iap-slot');
  if (!slots.length) return;
  var cycle = (typeof plansBillingCycle !== 'undefined' && plansBillingCycle) ? plansBillingCycle : 'annual';
  // The US dual rail (Stripe primary, store button behind a toggle) exists
  // only on iOS. On Android the two rails are mutually exclusive, so whenever
  // the store button renders there it is the only option and shows directly.
  var us = iapAppleAvailable() && iapUsStorefront();

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
    // storefrontUnknown is an Apple concept (getStorefront is iOS only), so on
    // Android an absent price just means products have not loaded yet.
    if (iapGoogleAvailable()) note = iapAppleSubtext(plan, price, cycleWord);

    // Button text. The Play label is longer than Apple's, and the price is
    // already stated in the disclosure directly above the button and again in
    // the note directly below it, so repeating it here only pushed the label
    // onto a second line. Worse in currencies with longer strings. Apple keeps
    // the price because its label is short enough to stay on one line.
    var btnLabel = iapGoogleAvailable()
      ? 'Pay with Google Play'
      : ('Pay with Apple' + priceLabel);

    var buyBtn =
      '<button class="pb-iap-buy" data-sku="' + sku + '" style="display:flex;' +
      'align-items:center;justify-content:center;width:100%;margin-top:10px;padding:12px;' +
      'border-radius:10px;border:1px solid var(--border);background:var(--surface2);' +
      'color:var(--text);font-family:\'DM Sans\',sans-serif;font-size:14px;font-weight:600;' +
      'cursor:pointer;">' + (iapGoogleAvailable() ? PLAY_LOGO : APPLE_LOGO) +
      '<span>' + btnLabel + '</span></button>' +
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
            var cancelWhere = iapGoogleAvailable() ? 'the Play Store' : 'Apple Settings';
            bill.textContent = (plan === 'max')
              ? ('7-day free trial, then ' + price + ' / ' + cycleWord + '. Cancel anytime in ' + cancelWhere + '.')
              : ('Billed ' + price + ' / ' + cycleWord + '. Cancel anytime in ' + cancelWhere + '.');
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
          var storeName = iapGoogleAvailable() ? 'Google Play' : 'the App Store';
          var storeAcct = iapGoogleAvailable() ? 'your Google Play account' : 'your Apple ID';
          if (bigP) bigP.textContent = iapGoogleAvailable() ? 'See Google Play' : 'See App Store';
          if (sufP) sufP.textContent = '';
          if (subP) subP.textContent = '';
          if (billP) billP.textContent = (plan === 'max')
            ? ('7-day free trial. Pricing shown in ' + storeName + ' at checkout, billed through ' + storeAcct + '.')
            : ('Pricing shown in ' + storeName + ' at checkout, billed through ' + storeAcct + '.');
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
      if (span) span.textContent = iapGoogleAvailable() ? 'Opening Google Play...' : 'Opening App Store...';
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
    // Which store rail this purchase came from decides which verifier runs.
    // Apple identifies a purchase by transactionId and the server re-fetches
    // the signed transaction from Apple. Google has no id-only fetch: the
    // purchaseToken IS the lookup key, so that is what gets sent. Both servers
    // then treat the STORE's answer as authoritative, never the client's.
    var isGoogleRail = iapNativePlatform() === 'android';
    var verifyFn = isGoogleRail ? 'verify-google-purchase' : 'verify-apple-purchase';
    var verifyBody = isGoogleRail
      ? { purchaseToken: detail.purchaseToken }
      : { transactionId: detail.transactionId };
    var resp = await sb.functions.invoke(verifyFn, { body: verifyBody });
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
      console.error(verifyFn + ' HTTP error', status, bodyText);
      // Reasons that are never actionable for the user on a redelivered/background
      // transaction get cleared SILENTLY (force-finished, no popup):
      //  - transaction_not_found (404): a cancelled/never-completed purchase, no
      //    valid transaction exists in Apple's system.
      //  - account_mismatch (403): the transaction is bound to a different Ryxa
      //    account (e.g. multi-account sandbox testing on one Apple ID). Apple
      //    blocks genuine duplicate purchases before this, so real users don't
      //    hit it; silently clearing avoids a false alarm on app reload.
      if (bodyText.indexOf('transaction_not_found') !== -1 ||
          bodyText.indexOf('purchase_not_found') !== -1 ||
          bodyText.indexOf('account_mismatch') !== -1) {
        iapPost({ type: 'iapForceFinish', transactionId: detail.transactionId });
        return;
      }
      var permReasons = ['wrong_bundle', 'unknown_product', 'expired', 'not_active'];
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
      console.error(verifyFn + ' not ok:', reason);
      // PERMANENT failures mean this transaction can NEVER be granted to this
      // user (e.g. its embedded appAccountToken belongs to a different/old
      // account). Left unfinished, it redelivers forever and BLOCKS all new
      // purchases of the same product. Force-finish it to clear the block.
      // Transient failures (network, 500) are NOT force-finished - they should
      // retry on the next redelivery.
      var reasonStr = (typeof reason === 'string') ? reason : (reason && reason.error) || '';
      // Silently clear (no popup) the reasons that are never actionable on a
      // redelivered/background transaction: transaction_not_found (cancelled) and
      // account_mismatch (bound to a different Ryxa account; sandbox multi-account
      // artifact, real users don't hit it since Apple blocks duplicates first).
      if (reasonStr === 'transaction_not_found' || reasonStr === 'purchase_not_found' ||
          reasonStr === 'account_mismatch') {
        iapPost({ type: 'iapForceFinish', transactionId: detail.transactionId });
        return;
      }
      var permanent = ['wrong_bundle', 'unknown_product', 'expired', 'not_active'];
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
// The reveal CSS must exist wherever a store button can render, NOT only in
// store-only markets. US iOS shows the Apple button behind a "Prefer to pay
// with Apple?" toggle, and these two rules are what collapse it by default and
// open it on pb-iap-open. Injecting them after the store-only early return
// left the US dual rail with no collapsed state: the button rendered open and
// the toggle did nothing.
function iapEnsureGateCss() {
  if (document.getElementById('pb-iap-gate-css')) return;
  var st = document.createElement('style');
  st.id = 'pb-iap-gate-css';
  st.textContent =
    // Reveal is collapsed by default; open state adds pb-iap-open.
    '.pb-iap-reveal{display:none;}' +
    '.pb-iap-reveal.pb-iap-open{display:block;}' +
    // Hide the Stripe CTA and its link-out disclosure in store-only markets.
    'body.iap-only .pb-cta[data-plans-action="checkout"],' +
    'body.iap-only .pb-disclosure-ext{display:none !important;}' +
    // In store-only mode the per-card toggle is not used (the button shows
    // directly), so hide any stray toggle and force reveals open.
    'body.iap-only .pb-iap-toggle{display:none !important;}' +
    'body.iap-only .pb-iap-reveal{display:block !important;}';
  document.head.appendChild(st);
}

function iapApplyStorefrontGate() {
  // Always, before any early return: the dual rail needs these rules too.
  if (iapNativeSectionVisible()) iapEnsureGateCss();

  if (!iapNativeOnly()) {
    // Stripe is available here (web, US iOS, US Android). Clear the gate in
    // case a previous render set it, so the Stripe CTA is never hidden.
    document.body.classList.remove('iap-only');
    return;
  }
  // iOS: until the storefront actually resolves, hold the dual-rail (Stripe)
  // layout rather than flashing IAP-only. Every card already has valid Stripe
  // prices, so this shows something correct immediately and only flips if the
  // resolved storefront is confirmed non-US. Avoids the load-time flash.
  // Android: no such grace. This line is only reached when iapNativeOnly() is
  // already true, which on Android means Google has not confirmed external
  // links for this user. Showing the Stripe CTA there, even briefly, would
  // offer a rail the user may not be permitted to use, so it stays closed.
  var iapOnly = iapGoogleAvailable()
    ? true
    : (iapStorefrontResolved && !iapUsStorefront());
  document.body.classList.toggle('iap-only', iapOnly);

  // Hard block: even if a link-out element slips through, the checkout
  // function itself refuses outside the US storefront.
  if (typeof plansBillingCheckout === 'function' && !_origPlansCheckout) {
    _origPlansCheckout = plansBillingCheckout;
    // eslint-disable-next-line no-global-assign
    plansBillingCheckout = function (plan, btn) {
      // Block wherever the native store is the only permitted rail: iOS
      // outside the US, and Android wherever Google has not confirmed the
      // external content links program applies to this user.
      if (iapNativeOnly()) return; // store-only market
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
      // Null storefront only means "still resolving" on Apple: getStorefront
      // does not exist on Android, so there the storefront is null forever and
      // keying the retry on it produced an endless 6s reload loop (visible as
      // repeated external-links re-checks in the native logs). On Android the
      // only reason to re-request is prices genuinely missing.
      if (iapNativeSectionVisible() &&
          (!Object.keys(iapPrices).length || (iapAppleAvailable() && iapStorefront === null))) {
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
  // A subscription bought through either store is managed by that store, not
  // by the Stripe portal. Google subscriptions have to be included here or an
  // Android subscriber would be shown Stripe controls that cannot touch their
  // plan at all.
  var isStoreManaged = false;
  var storeSource = '';
  try {
    var q = await sb.from('subscriptions')
      .select('source, apple_expires_at, google_expires_at')
      .eq('user_id', uid)
      .limit(1);
    if (q && q.data && q.data.length) {
      var rowS = q.data[0];
      var appleLive = rowS.source === 'apple' && rowS.apple_expires_at &&
        new Date(rowS.apple_expires_at).getTime() > Date.now();
      var googleLive = rowS.source === 'google' && rowS.google_expires_at &&
        new Date(rowS.google_expires_at).getTime() > Date.now();
      isStoreManaged = appleLive || googleLive;
      storeSource = appleLive ? 'apple' : (googleLive ? 'google' : '');
    }
  } catch (e) { /* on error, leave Stripe controls (safe default) */ }

  if (isStoreManaged) {
    stripeControls.style.display = 'none';
    appleControls.style.display = 'block';
    // In-app: working deep-link button. Web: hide button, show instructions.
    var btn = document.getElementById('settings-apple-manage-btn');
    var hint = document.getElementById('settings-apple-web-hint');
    var canDeepLink =
      (storeSource === 'apple' && iapAppleAvailable()) ||
      (storeSource === 'google' && iapGoogleAvailable());
    if (canDeepLink) {
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
    if (iapAppleAvailable() || iapGoogleAvailable()) iapPost({ type: 'iapManage' });
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
  } else if (ev.type === 'iapExternalLinks') {
    // Android only. Decides which rail this user gets, so a full re-render is
    // needed: the answer can arrive after the plans page has already drawn.
    iapExternalLinksAvailable = ev.available === true;
    iapExternalLinksResolved = true;
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
    // Capture the busy flag BEFORE resetting it: iapResetBusy() clears it.
    var wasPurchasing = iapBusy;
    iapResetBusy();
    // A store error with no purchase underway is not a failed purchase. The
    // native layer emits these for connection and catalog level problems (for
    // example Play Billing reporting an unavailable catalog at launch), and
    // alerting on them showed "The purchase did not go through" to users who
    // were only sitting on the login screen. Log and ignore.
    if (!wasPurchasing) {
      try { console.warn('IAP error with no purchase in progress:', ev.code, ev.message); } catch (e) {}
      return;
    }
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
