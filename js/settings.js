// =============================================================================
// /js/settings.js - Settings tool (extracted from dashboard.html, 2026-05-11)
// -----------------------------------------------------------------------------
// All JavaScript for the Settings tool. Includes:
//   • Subscription management (cancel / reactivate / upgrade to Max / downgrade to Pro)
//   • Stripe Connect OAuth (creator payout account)
//   • Instagram OAuth (Media Kit data source)
//   • Currency selection
//   • Password reset
//   • Marketing email opt-in
//   • Cloudflare Turnstile (for the cancel-subscription confirmation)
//
// History: Settings code was scattered across dashboard.html main script - never
// a single contiguous block. This file collects 13 separate code chunks that
// were spread out between unrelated code (PWA login, dashboard stats, sidebar,
// etc). The original line numbers in dashboard.html are noted on each chunk
// header for reference.
//
// CROSS-FILE DEPENDENCIES (read FROM other files / globals):
//   • sb, currentUser, currentCurrency, userTier, userStatus              (dashboard.html)
//   • isPro, isMax, fetchTier                                             (dashboard.html)
//   • showDashToast                                                       (dashboard.html)
//   • showModalAlert, showModalConfirm, dashConfirm                       (dashboard.html)
//   • applyCurrencySymbols, SUPPORTED_CURRENCIES                          (dashboard.html)
//   • startCheckout                                                       (dashboard.html)
//   • mkAudCache (read via typeof guard)                                  (js/mk.js)
//   • loadInstagramConnectionStatus is called by handleInstagramReturn IIFE
//     before the IIFE runs - but the IIFE waits via setTimeout retry until
//     showDashToast is defined, by which time this whole script is parsed.
//
// FUNCTIONS THIS FILE EXPOSES AS WINDOW GLOBALS (called from elsewhere):
//   • updateSettingsCancelBtn - called from updatePillsForTier in dashboard.html
//   • handleStripeConnectRedirect - called from dashboard init flow
//   • openSettingsModal / closeSettingsModal - no-ops kept for callsite compat
//   • All the others are only called from settings markup (via delegation)
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/settings.js
//   • Phase 2: inline onclick/onchange → data-settings-action attributes
//   • Phase 3: static inline style="..." → hash-named CSS classes
//
// INTENTIONALLY KEPT INLINE: ~10 hover handlers throughout settings markup.
//
// PRE-EXISTING DEBT NOTED (not fixed by refactor):
//   • updateSettingsCancelBtn uses cancelBtn.onmouseover = ... (programmatic
//     hover assignment). This is CSP-safe already (JS, not inline attr) but
//     could be CSS :hover. Left as-is.
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE
// =============================================================================

const settingsActions = {};

function settingsRegisterAction(action, handler) {
  settingsActions[action] = handler;
}

function settingsFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['settingsAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.settingsAction) {
        const wantEvent = el.dataset.settingsEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.settingsAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function settingsDispatchEvent(event) {
  const found = settingsFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = settingsActions[found.action];
  if (!handler) {
    console.warn('[settings] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'change', 'input', 'focus', 'blur'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, settingsDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================


// ---------- From dashboard.html L9662-9667: toggleMarketingEmails ----------
// Provides inline Saving/Saved/Error feedback. On failure, reverts the toggle
// to its previous state so the UI never lies about persistence.
var _marketingStatusTimer = null;
function _setMarketingStatus(state, text) {
  var el = document.getElementById('settings-marketing-status');
  if (!el) return;
  if (_marketingStatusTimer) { clearTimeout(_marketingStatusTimer); _marketingStatusTimer = null; }
  el.classList.remove('is-saving', 'is-saved', 'is-error', 'is-visible');
  if (!state) { el.textContent = ''; return; }
  el.textContent = text;
  el.classList.add('is-' + state, 'is-visible');
}
async function toggleMarketingEmails(checked) {
  if (!currentUser) return;
  var input = document.getElementById('settings-marketing-emails');
  var previous = !checked; // state before this toggle
  if (input) input.disabled = true;
  _setMarketingStatus('saving', 'Saving…');
  try {
    var { error } = await sb.from('profiles').update({ marketing_emails: checked }).eq('user_id', currentUser.id);
    if (error) throw error;
    _setMarketingStatus('saved', 'Saved');
    _marketingStatusTimer = setTimeout(function() { _setMarketingStatus(null); }, 1800);
  } catch (e) {
    console.error('Marketing toggle error:', e);
    // Revert toggle so UI matches actual DB state
    if (input) input.checked = previous;
    _setMarketingStatus('error', 'Error');
    _marketingStatusTimer = setTimeout(function() { _setMarketingStatus(null); }, 3000);
  } finally {
    if (input) input.disabled = false;
  }
}

// ---------- From dashboard.html L9750-9766: handleStripeConnectRedirect ----------
function handleStripeConnectRedirect() {
  const params = new URLSearchParams(window.location.search);
  const stripeConnect = params.get('stripe_connect');
  if (!stripeConnect) return;

  // Clean the URL so refreshing doesn't re-trigger
  const cleanUrl = window.location.pathname;
  window.history.replaceState({}, '', cleanUrl);

  // Show a toast popup on the dashboard
  if (stripeConnect === 'success') {
    showDashToast('success', 'Stripe connected successfully! You\'re ready to receive payouts.');
  } else {
    const reason = params.get('reason') || 'Unknown error';
    showDashToast('error', 'Failed to connect Stripe: ' + reason);
  }
}

// ---------- From dashboard.html L9897-9932: updateSettingsCancelBtn ----------
function updateSettingsCancelBtn() {
  const pro = isPro();
  const max = isMax();
  const isCancelling = pro && userStatus === 'cancelling';

  // Trial detection: trial_end is in the future. Computed at render time
  // because trials expire silently (Stripe webhooks fire on transition, but
  // we want the label to update if the user sits on the page across the
  // boundary too).
  let trialDaysLeft = null;
  if (typeof userTrialEnd !== 'undefined' && userTrialEnd) {
    const endMs = new Date(userTrialEnd).getTime();
    const nowMs = Date.now();
    if (endMs > nowMs) {
      // Round UP so a trial with 4.2 days remaining shows "5 days left"
      // (matches what users expect - "left" implies remaining whole days).
      trialDaysLeft = Math.ceil((endMs - nowMs) / (24 * 60 * 60 * 1000));
    }
  }
  const isTrialing = max && trialDaysLeft !== null;

  const cancelBtn = document.getElementById('settings-cancel-btn');
  const settingsTier = document.getElementById('settings-tier');
  if (cancelBtn) {
    if (isCancelling) {
      cancelBtn.textContent = 'Renew subscription';
      cancelBtn.style.borderColor = 'rgba(74,222,128,0.4)';
      cancelBtn.style.color = '#4ade80';
      cancelBtn.onmouseover = () => cancelBtn.style.background = 'rgba(74,222,128,0.08)';
      cancelBtn.onmouseout = () => cancelBtn.style.background = 'transparent';
    } else {
      cancelBtn.textContent = 'Cancel subscription';
      cancelBtn.style.borderColor = 'rgba(239,68,68,0.3)';
      cancelBtn.style.color = '#fca5a5';
      cancelBtn.onmouseover = () => cancelBtn.style.background = 'rgba(239,68,68,0.08)';
      cancelBtn.onmouseout = () => cancelBtn.style.background = 'transparent';
    }
  }
  if (settingsTier) {
    // Cadence suffix: shown for active paid plans (not Free, not while
    // cancelling or trialing - those states have their own labels).
    var cadence = '';
    if ((max || pro) && !isCancelling && !isTrialing) {
      var cyc = (typeof userBillingCycle !== 'undefined' ? userBillingCycle : 'monthly');
      cadence = cyc === 'annual' ? ' (Annual)' : ' (Monthly)';
    }
    if (isCancelling) {
      settingsTier.textContent = max ? 'Max (Cancelling)' : 'Pro (Cancelling)';
    } else if (isTrialing) {
      const dayWord = trialDaysLeft === 1 ? 'day' : 'days';
      settingsTier.textContent = 'Max (Trial, ' + trialDaysLeft + ' ' + dayWord + ' left)';
    } else {
      settingsTier.textContent = (max ? 'Creator Max' : pro ? 'Pro Plan' : 'Free Plan') + cadence;
    }
  }

  // Update the "You are on..." label and trailing sentence
  const subProLabel = document.getElementById('settings-sub-pro-label');
  if (subProLabel) subProLabel.textContent = max ? 'Creator Max plan' : 'Pro plan';
  const subProFeatures = document.getElementById('settings-sub-pro-features');
  if (subProFeatures) {
    // Append a renewal-cadence sentence for active paid subscriptions.
    var renewalNote = '';
    if ((max || pro) && !isCancelling) {
      var cyc2 = (typeof userBillingCycle !== 'undefined' ? userBillingCycle : 'monthly');
      renewalNote = cyc2 === 'annual'
        ? ' Renews annually.'
        : ' Renews monthly.';
    }
    subProFeatures.textContent = (max
      ? 'You have access to all tools and features.'
      : 'You have access to Pro tools and features.') + renewalNote;
  }

  // Update upgrade/downgrade button visibility
  // Hide tier-change buttons while cancelling - user is about to lose subscription anyway.
  // Subscription change is now a single "Change Plan" button (data-settings-action
  // "open-pricing") that routes to the pricing page. The pricing page is
  // current-plan aware and handles upgrade, downgrade, and cycle switches.
  // No per-tier button visibility logic needed here anymore - the single
  // button shows for all paid tiers and is only hidden while cancelling
  // (handled by the markup container, not here).
}

// ---------- Subscription management ----------
// "Upgrade Now" (free users) and "Change Plan" (paid users) both route to
// the pricing page. The pricing page handles every transition: free->paid,
// Pro<->Max, and monthly<->annual cycle switches.
function openPricingPage() {
  // Land on the plan the creator is reaching for, never at the top of the page
  // looking at Free. Free -> Pro. Pro -> Max. Max -> Max (their own plan, where
  // the cycle switch and cancel controls live).
  //
  // Note the tier value: Pro is stored as 'monthly' internally. 'pro' is
  // accepted too so this keeps working if that name is ever normalized.
  // Explicit rather than defaulted: if userTier has not loaded yet, a default
  // of 'max' would send a free creator to the Max card.
  var target = '';
  if (userTier === 'free') target = 'pro';
  else if (userTier === 'monthly' || userTier === 'pro') target = 'max';
  else if (userTier === 'max') target = 'max';
  // Settings is plan MANAGEMENT, not an upsell CTA: it keeps the direct
  // pricing hand-off (in-app: Safari link-out) rather than routing through
  // the Plans & Billing page.
  if (typeof goToPricingDirect === 'function') goToPricingDirect(target);
  else goToPricing(target);
}

// "Manage billing" opens the Stripe Customer Portal, where the user can change
// their payment method, view invoices, switch plans, or cancel/reactivate. The
// portal keeps the single existing subscription in sync (no duplicate subs).
async function handleManageBilling() {
  const btn = document.getElementById('settings-manage-billing-btn');
  const orig = btn ? btn.textContent : '';
  var inApp = !!(window.RyxaNative && window.ReactNativeWebView);
  if (btn) { btn.disabled = true; btn.textContent = 'Redirecting to website...'; }
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { showSettingsResult('error', 'Please sign in again.'); if (btn) { btn.disabled = false; btn.textContent = orig; } return; }
    const res = await fetch('/api/billing-portal', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromApp: !!(window.RyxaNative && window.ReactNativeWebView) })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      window.location.href = data.url;
      // In the app, the native layer intercepts the billing URL and opens it in
      // Safari, so THIS WebView never navigates away, the button would stay
      // stuck. Reset it shortly after handing off so it's usable when the user
      // returns from Safari.
      if (inApp && btn) {
        setTimeout(function () { btn.disabled = false; btn.textContent = orig; }, 1500);
      }
      return;
    }
    showSettingsResult('error', 'Could not open billing. Please try again.');
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  } catch (e) {
    showSettingsResult('error', 'Could not open billing. Please try again.');
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

// ---------- From dashboard.html L10685-10714: changeDisplayCurrency ----------
async function changeDisplayCurrency(newCurrency) {
  if (!SUPPORTED_CURRENCIES[newCurrency]) return;
  if (!currentUser) return;
  var prev = currentCurrency;
  currentCurrency = newCurrency;
  applyCurrencySymbols();

  try {
    var { error } = await sb.from('profiles')
      .update({ display_currency: newCurrency })
      .eq('user_id', currentUser.id);
    if (error) throw error;

    if (typeof showDashToast === 'function') {
      showDashToast('success', 'Display currency updated');
    } else {
      var msg = document.getElementById('settings-currency-msg');
      if (msg) {
        msg.style.display = 'block';
        setTimeout(function() { if (msg) msg.style.display = 'none'; }, 2500);
      }
    }

    // Re-render any data views that are currently visible so amounts refresh
    if (typeof loadDashStats === 'function') { try { loadDashStats(); } catch(e){} }
    if (typeof loadDealsStats === 'function') { try { loadDealsStats(); } catch(e){} }
    if (typeof loadAnalytics === 'function') { try { loadAnalytics(); } catch(e){} }
  } catch (e) {
    console.error('Currency save failed:', e);
    currentCurrency = prev;
    applyCurrencySymbols();
    showModalAlert('Save Failed', 'Could not save your currency preference. Please try again.');
  }
}

// ---------- From dashboard.html L11000-11006: openSettingsModal + closeSettingsModal ----------
function openSettingsModal() {
  showTool('settings');
}

function closeSettingsModal() {
  // No-op now - settings is a tool view, not a modal
}

// ---------- From dashboard.html L11013-11227: Stripe Connect block + Instagram block ----------
async function loadStripeConnectStatus() {
  const disconnectedEl = document.getElementById('settings-stripe-disconnected');
  const connectedEl = document.getElementById('settings-stripe-connected');
  const acctIdEl = document.getElementById('settings-stripe-acct-id');
  const msgEl = document.getElementById('settings-stripe-msg');
  if (msgEl) msgEl.style.display = 'none';

  if (!currentUser) return;

  try {
    const stripeStatusRes = await fetch('/api/stripe-status', {
      headers: { Authorization: 'Bearer ' + Auth.getToken() }
    });
    const status = stripeStatusRes.ok ? await stripeStatusRes.json() : { connected: false };

    if (status.connected) {
      // Connected
      if (disconnectedEl) disconnectedEl.style.display = 'none';
      if (connectedEl) connectedEl.style.display = 'block';
      if (typeof hideStripeConnectToast === 'function') hideStripeConnectToast();
      if (acctIdEl && status.masked_id) {
        acctIdEl.textContent = status.masked_id;
      }
    } else {
      // Not connected
      if (disconnectedEl) disconnectedEl.style.display = 'block';
      if (connectedEl) connectedEl.style.display = 'none';
      // The toast is dashboard-only: only slide it in when the current view is
      // the dashboard (welcome), never over Settings or other tools. It reuses
      // the dismissed check so a prior X dismiss keeps it hidden for good.
      var _dismissed = (typeof isStripeNudgeDismissed === 'function' && isStripeNudgeDismissed());
      var _onDashboard = (typeof currentTool === 'undefined') || currentTool === 'welcome' || !currentTool;
      if (!_dismissed && _onDashboard) {
        if (typeof showStripeConnectToast === 'function') showStripeConnectToast();
      } else {
        if (typeof hideStripeConnectToast === 'function') hideStripeConnectToast();
      }
    }
  } catch (err) {
    console.error('Failed to load Stripe status:', err);
  }
}

async function connectStripeAccount() {
  if (!currentUser) return;

  const btn = document.getElementById('settings-stripe-connect-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" class="ds-s-f33c30" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Redirecting to Stripe...`;
    armConnectSheetWatchdog();
  }

  try {
    // Request a signed OAuth URL from our secure backend.
    // Send the Supabase access token in the Authorization header so the
    // server can verify the session and extract user_id from it. The
    // server intentionally ignores any user_id in the body to prevent
    // an attacker from generating a state token signed with someone
    // else's user_id and hijacking their Stripe Connect binding.
    const accessToken = Auth.getToken();
    if (!accessToken) {
      throw new Error('Not signed in');
    }
    const resp = await fetch('/api/stripe-connect-start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken,
      },
    });

    const data = await resp.json();

    if (!resp.ok || !data.url) {
      throw new Error(data.error || 'Failed to start Stripe Connect');
    }

    window.location.href = data.url;
  } catch (err) {
    console.error('Stripe Connect start error:', err);
    showStripeMsg('error', 'Failed to start Stripe Connect. Please try again.');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg> Connect Stripe Account`;
    }
  }
}

function showStripeDisconnectConfirm() {
  // Modern centered confirm modal (shared showModalConfirm) instead of the
  // old inline panel. The destructive action is the primary button.
  showModalConfirm(
    'Disconnect Stripe?',
    "You won't receive payouts until you reconnect. Your Stripe account itself is not affected.",
    function() { confirmDisconnectStripe(); },
    'Yes, disconnect',
    'Keep connected',
    { logo: true, danger: true }
  );
}

async function confirmDisconnectStripe() {
  if (!currentUser) return;

  try {
    const { error } = await sb
      .from('profiles')
      .update({ stripe_account_id: null })
      .eq('user_id', currentUser.id);

    if (error) throw error;

    showStripeMsg('success', 'Stripe account disconnected.');
    showDashToast('success', 'Stripe account disconnected.');
    loadStripeConnectStatus();
  } catch (err) {
    console.error('Failed to disconnect Stripe:', err);
    showStripeMsg('error', 'Failed to disconnect. Please try again.');
  }
}

function showStripeMsg(type, text) {
  // Delegates to the dashboard's slide-in toast.
  if (typeof showDashToast === 'function') {
    showDashToast(type === 'success' ? 'success' : 'error', text);
    return;
  }
  const el = document.getElementById('settings-stripe-msg');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = text;
  if (type === 'success') {
    el.style.background = 'rgba(74,222,128,0.08)';
    el.style.color = '#4ade80';
    el.style.border = '1px solid rgba(74,222,128,0.2)';
  } else {
    el.style.background = 'rgba(239,68,68,0.08)';
    el.style.color = '#fca5a5';
    el.style.border = '1px solid rgba(239,68,68,0.2)';
  }
}

// ============================================================
// Instagram Connection (Settings)
// ============================================================

// Paint (or clear) the connection state on a connected-account card. Three
// states: 'needs' (red - genuine revocation, "Reconnection needed"), 'stale'
// (amber - no successful refresh in ~14 days, "Connection issue"), or ok
// (normal green). Accepts a legacy boolean too (true => 'needs', false => ok)
// so existing callers keep working. Cleared/reset on every load.
function setAcctReconnectState(connectedEl, defaultLabel, state) {
  if (!connectedEl) return;
  // Normalize: boolean true => 'needs', anything falsy => 'ok'.
  var st = state === true ? 'needs' : (state || 'ok');
  const labelEl = connectedEl.querySelector('.settings-s-279016');
  // The visual card is the inner .settings-s-9403ee row (it carries the green
  // background, border, and radius), NOT the outer stack wrapper.
  const cardEl = connectedEl.querySelector('.settings-s-9403ee') || connectedEl;
  if (st === 'needs') {
    cardEl.style.border = '1px solid rgba(239,68,68,0.45)';
    cardEl.style.background = 'rgba(239,68,68,0.08)';
    if (labelEl) { labelEl.textContent = 'Reconnection needed'; labelEl.style.color = '#f87171'; }
  } else if (st === 'stale') {
    cardEl.style.border = '1px solid rgba(245,166,35,0.45)';
    cardEl.style.background = 'rgba(245,166,35,0.08)';
    if (labelEl) { labelEl.textContent = 'Connection issue, try reconnecting'; labelEl.style.color = '#f5a623'; }
  } else {
    cardEl.style.border = '';
    cardEl.style.background = '';
    if (labelEl) { labelEl.textContent = defaultLabel; labelEl.style.color = ''; }
  }
}

// Given a connection row, return 'needs' | 'stale' | 'ok'. Red beats yellow:
// an explicit reconnect flag wins over staleness. Stale = a real last-fetch
// timestamp older than the threshold (a freshly connected row with a null
// timestamp is NOT stale yet).
var SETTINGS_STALE_DAYS = 14;
function acctStateFromRow(row) {
  if (!row) return 'ok';
  if (row.needs_reconnect) return 'needs';
  // Most tables track successful refreshes as data_last_fetched_at; Facebook
  // uses last_refreshed_at. Accept whichever is present.
  var ts = row.data_last_fetched_at || row.last_refreshed_at || null;
  var last = ts ? Date.parse(ts) : null;
  if (last && last < (Date.now() - SETTINGS_STALE_DAYS * 24 * 60 * 60 * 1000)) return 'stale';
  return 'ok';
}

async function loadConnectedAccountsWithSpinner() {
  const loading = document.getElementById('settings-accounts-loading');
  const list = document.getElementById('settings-accounts-list');
  if (loading) loading.style.display = 'flex';
  if (list) list.style.display = 'none';
  const run = (fn) => { try { return Promise.resolve(fn()); } catch (e) { return Promise.resolve(); } };
  const all = Promise.allSettled([
    run(loadInstagramConnectionStatus),
    run(loadFacebookConnectionStatus),
    run(loadYouTubeConnectionStatus),
    run(loadTikTokConnectionStatus),
    run(loadTwitchConnectionStatus)
  ]);
  // Fail-safe: allSettled waits for every promise to settle, but a hung network
  // request never settles. Race it against an 8s timeout so the list always
  // reveals (any still-loading row just shows its default state and corrects
  // itself when its query eventually returns) rather than spinning forever.
  const timeout = new Promise((resolve) => setTimeout(resolve, 8000));
  await Promise.race([all, timeout]);
  if (loading) loading.style.display = 'none';
  if (list) list.style.display = '';
}

async function loadInstagramConnectionStatus() {
  const disconnectedEl = document.getElementById('settings-instagram-disconnected');
  const connectedEl = document.getElementById('settings-instagram-connected');
  const usernameEl = document.getElementById('settings-instagram-username');
  const avatarEl = document.getElementById('settings-instagram-avatar');
  const msgEl = document.getElementById('settings-instagram-msg');
  if (msgEl) msgEl.style.display = 'none';

  if (!currentUser) return;

  try {
    const { data: conn } = await sb
      .from('instagram_connections')
      .select('ig_username,profile_picture_url,connected_at,needs_reconnect,data_last_fetched_at')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (conn) {
      // Connected
      if (disconnectedEl) disconnectedEl.style.display = 'none';
      if (connectedEl) connectedEl.style.display = 'block';
      setAcctReconnectState(connectedEl, 'Instagram Connected', acctStateFromRow(conn));
      if (usernameEl) usernameEl.textContent = conn.ig_username ? '@' + conn.ig_username : 'Connected';
      if (avatarEl && conn.profile_picture_url) {
        avatarEl.innerHTML = '<img src="' + escapeHtml(conn.profile_picture_url) + '" alt="" class="bio-s-0c9434">';
      }
    } else {
      // Not connected
      if (disconnectedEl) disconnectedEl.style.display = 'block';
      if (connectedEl) connectedEl.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load Instagram status:', err);
  }
}

async function connectInstagramAccount() {
  if (!currentUser) return;

  const btn = document.getElementById('settings-instagram-connect-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" class="ds-s-f33c30" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Redirecting to Instagram...';
    armConnectSheetWatchdog();
  }

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) {
      throw new Error('No session');
    }
    // Step 1: fetch a short-lived signed ticket via POST. The ticket contains
    // our user_id and expires in 5 minutes. Unlike a session token, it can't
    // be used as session auth - only to start an Instagram OAuth flow.
    const ticketRes = await fetch('/api/instagram-ticket', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token }
    });
    if (!ticketRes.ok) {
      const errBody = await ticketRes.json().catch(function() { return {}; });
      throw new Error(errBody.error || 'ticket_failed');
    }
    const ticketJson = await ticketRes.json();
    if (!ticketJson || !ticketJson.ticket) {
      throw new Error('Empty ticket response');
    }
    // Step 2: navigate to the OAuth start endpoint with the signed ticket.
    window.location.href = '/api/instagram-oauth-start?ticket=' + encodeURIComponent(ticketJson.ticket);
  } catch (err) {
    console.error('Failed to start Instagram OAuth:', err);
    showInstagramMsg('error', 'Failed to start connection. Please try again.');
    resetInstagramConnectButton(true);
  }
}

// Restore the Instagram connect button to its default "Connect Instagram" state.
// Used both by the catch-block above and by the bfcache pageshow listener below.
// `force` = true bypasses the stuck-state check (used by the immediate catch path).
function resetInstagramConnectButton(force) {
  const btn = document.getElementById('settings-instagram-connect-btn');
  if (!btn) return;
  // Only reset if explicitly forced OR the button is actually showing the "Redirecting" state
  if (!force && !/Redirecting to Instagram/i.test(btn.innerText || btn.textContent || '')) return;
  btn.disabled = false;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg> Connect Instagram';
}


// In-app OAuth sheet watchdog for connect flows: the app intercepts the
// oauth-start navigation into its sheet, so this page stays put. Tapping
// the sheet's Close resets these buttons via the app; a swipe-down
// dismissal does not (RN Modal quirk; native fix in the next app build).
// Any touch on this page after the handoff means the sheet is gone:
// restore whichever buttons are still stuck.
var _connectSheetWatchdogArmed = false;
function armConnectSheetWatchdog() {
  if (!(window.RyxaNative && window.ReactNativeWebView)) return;
  if (_connectSheetWatchdogArmed) return;
  _connectSheetWatchdogArmed = true;
  function restore() {
    _connectSheetWatchdogArmed = false;
    document.removeEventListener('pointerdown', restore, true);
    clearTimeout(t);
    try { resetStripeConnectButton(false); } catch (e) {}
    try { resetInstagramConnectButton(false); } catch (e) {}
    try { resetFacebookConnectButton(false); } catch (e) {}
    try { resetYouTubeConnectButton(false); } catch (e) {}
    try { resetTikTokConnectButton(false); } catch (e) {}
    try { resetTwitchConnectButton(false); } catch (e) {}
  }
  var t = setTimeout(restore, 90000);
  document.addEventListener('pointerdown', restore, true);
}

// Stripe connect button reset (same stuck-state pattern as the socials).
function resetStripeConnectButton(force) {
  const btn = document.getElementById('settings-stripe-connect-btn');
  if (!btn) return;
  if (!force && !/Redirecting to Stripe/i.test(btn.innerText || btn.textContent || '')) return;
  btn.disabled = false;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg> Connect Stripe Account';
}

// The bfcache reset the helpers were built for: returning via the browser
// back button restores this page from the back-forward cache with any
// "Redirecting to X..." button frozen mid-state. Non-forced calls only touch
// buttons actually stuck in that state.
window.addEventListener('pageshow', function(e) {
  if (!e.persisted) return;
  try { resetStripeConnectButton(false); } catch (err) {}
  try { resetInstagramConnectButton(false); } catch (err) {}
  try { resetFacebookConnectButton(false); } catch (err) {}
  try { resetYouTubeConnectButton(false); } catch (err) {}
  try { resetTikTokConnectButton(false); } catch (err) {}
  try { resetTwitchConnectButton(false); } catch (err) {}
});

function showInstagramDisconnectConfirm() {
  showModalConfirm(
    'Disconnect Instagram?',
    "Your photos, follower counts, and audience data will no longer sync. You can reconnect anytime.",
    function() { confirmDisconnectInstagram(); },
    'Yes, disconnect',
    'Keep connected',
    { logo: true, danger: true }
  );
}

// ---------- From dashboard.html L11255-11291: confirmDisconnectInstagram ----------
// Puts a "Yes, disconnect" button into a spinner + "Disconnecting..." state
// while the request is in flight, so it never looks frozen. Returns a restore
// function that puts the original label back (used on completion / failure).
async function confirmDisconnectInstagram() {
  if (!currentUser) return;

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) {
      throw new Error('No session');
    }
    const res = await fetch('/api/instagram-disconnect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      }
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || 'Disconnect failed');
    }
    showInstagramMsg('success', 'Instagram disconnected.');
    showDashToast('success', 'Instagram disconnected.');
    loadInstagramConnectionStatus();
    // Invalidate Media Kit Automatic-tab cache and re-render the pane so it
    // shows the "not connected" state immediately, even if the user navigates
    // back to Media Kit later. Setting cache to a known-disconnected sentinel
    // avoids showing a stale "connected" UI after disconnect.
    if (typeof mkAudCache !== 'undefined') mkAudCache = { connected: false };
    if (typeof renderAudienceAutomatic === 'function' && document.getElementById('mk-aud-auto-content')) {
      renderAudienceAutomatic();
    }
    if (typeof updateMKPreview === 'function') updateMKPreview();
  } catch (err) {
    console.error('Failed to disconnect Instagram:', err);
    showInstagramMsg('error', 'Failed to disconnect. Please try again.');
  } finally {
  }
}

// ---------- From dashboard.html L11293-11307: showInstagramMsg ----------
function showInstagramMsg(type, text) {
  // Delegates to the dashboard's slide-in toast.
  if (typeof showDashToast === 'function') {
    showDashToast(type === 'success' ? 'success' : 'error', text);
    return;
  }
  const el = document.getElementById('settings-instagram-msg');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = text;
  if (type === 'success') {
    el.style.background = 'rgba(74,222,128,0.08)';
    el.style.color = '#4ade80';
    el.style.border = '1px solid rgba(74,222,128,0.2)';
  } else {
    el.style.background = 'rgba(239,68,68,0.08)';
    el.style.color = '#fca5a5';
    el.style.border = '1px solid rgba(239,68,68,0.2)';
  }
}

// ---------- From dashboard.html L11309-11345: handleInstagramReturn IIFE ----------
// Handle ?instagram_status=... return URL params from OAuth callback
(function handleInstagramReturn() {
  try {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('instagram_status');
    if (!status) return;

    // Wait until dashboard is initialized to show toast
    function showWhenReady() {
      if (typeof showDashToast !== 'function') {
        setTimeout(showWhenReady, 200);
        return;
      }
      if (status === 'connected') {
        showDashToast('success', 'Instagram connected!');
        // Reconnecting clears this platform's red flag; re-run the check so a
        // pending yellow (stale) toast for another platform surfaces now. Small
        // delay lets the connection row settle after the callback's write.
        setTimeout(function() {
          if (typeof checkSocialReconnections === 'function' && currentUser) {
            checkSocialReconnections(currentUser.id);
          }
        }, 1200);
      } else if (status === 'cancelled') {
        showDashToast('info', 'Instagram connection cancelled.');
      } else if (status === 'error') {
        const msg = params.get('instagram_message') || 'Could not connect Instagram.';
        showDashToast('error', msg);
      }
      // Clean up URL so refresh doesn't re-trigger toast
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
      // Refresh connection display
      if (typeof loadInstagramConnectionStatus === 'function') {
        loadInstagramConnectionStatus();
      }
      // Invalidate any cached IG data in the Media Kit editor so a fresh
      // pull happens next time the creator opens that tab
      if (typeof mkAudCache !== 'undefined') mkAudCache = null;
    }
    showWhenReady();
  } catch (e) {
    console.error('handleInstagramReturn failed:', e);
  }
})();

// ============================================================
// Facebook Connection (Settings) - mirrors the Instagram block,
// with a Page picker for accounts that manage more than one Page.
// ============================================================
// Facebook connect is held back until Meta approves the app. Users were
// hitting the button and getting an opaque OAuth failure, so it is disabled
// with an explanation instead. Two accounts bypass it so the flow can still be
// exercised end to end while approval is pending.
//
// This is a UX gate, not a security boundary: the real gate is Meta, and the
// OAuth would fail for an unapproved app regardless of what the client allows.
// connectFacebookAccount() re-checks anyway so a devtools edit to the DOM
// cannot start a flow that is only going to error.
//
// TO REVERSE ON APPROVAL: set this to true. Everything below goes inert and
// the button behaves normally for everyone. The rest can then be deleted at
// leisure rather than under time pressure.
const FACEBOOK_CONNECT_OPEN = false;

// Supabase user ids rather than email addresses: this file is publicly
// readable, and a UUID in source reveals nothing worth harvesting.
const FACEBOOK_EARLY_ACCESS = [
  '2a220c21-0337-4e81-911f-28740ddeeaba',
  '81880735-a212-4ae1-87a8-ebac6a22025d'
];

function facebookConnectAllowed() {
  if (FACEBOOK_CONNECT_OPEN) return true;
  try {
    var uid = (currentUser && currentUser.id ? currentUser.id : '').toLowerCase().trim();
    return !!uid && FACEBOOK_EARLY_ACCESS.indexOf(uid) !== -1;
  } catch (e) {
    // Fail closed: an unreadable session should not open the gate.
    return false;
  }
}

// Applied every time the disconnected block renders, because that block is
// shown and hidden on each status load and would otherwise come back enabled.
function applyFacebookComingSoon() {
  var btn = document.getElementById('settings-facebook-connect-btn');
  var note = document.getElementById('settings-facebook-soon');
  if (!btn) return;
  if (facebookConnectAllowed()) {
    btn.disabled = false;
    btn.removeAttribute('title');
    btn.classList.remove('is-coming-soon');
    if (note) note.style.display = 'none';
    return;
  }
  btn.disabled = true;
  btn.classList.add('is-coming-soon');
  btn.setAttribute('title', 'Coming soon. Facebook connections are pending Meta approval.');
  // A hover tooltip alone would be invisible to most users, since touch
  // devices have no hover at all. The note carries the same message where it
  // can actually be read.
  if (note) note.style.display = 'block';
}

async function loadFacebookConnectionStatus() {
  const disconnectedEl = document.getElementById('settings-facebook-disconnected');
  const connectedEl = document.getElementById('settings-facebook-connected');
  const pickEl = document.getElementById('settings-facebook-pickpage');
  const nameEl = document.getElementById('settings-facebook-pagename');
  const avatarEl = document.getElementById('settings-facebook-avatar');
  const msgEl = document.getElementById('settings-facebook-msg');
  if (msgEl) msgEl.style.display = 'none';
  if (!currentUser) return;

  try {
    const { data: conn } = await sb
      .from('facebook_connections')
      .select('fb_page_id,fb_page_name,profile_picture_url,followers_count,needs_reconnect,last_refreshed_at')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (conn && conn.fb_page_id) {
      // Connected with a chosen Page
      if (disconnectedEl) disconnectedEl.style.display = 'none';
      if (pickEl) pickEl.style.display = 'none';
      if (connectedEl) connectedEl.style.display = 'block';
      setAcctReconnectState(connectedEl, 'Facebook Connected', acctStateFromRow(conn));
      if (nameEl) {
        nameEl.textContent = conn.fb_page_name || 'Connected';
      }
      if (avatarEl && conn.profile_picture_url) {
        avatarEl.innerHTML = '<img src="' + escapeHtml(conn.profile_picture_url) + '" alt="" class="bio-s-0c9434">';
      }
    } else if (conn) {
      // Connected but no Page chosen yet -> show the picker
      if (disconnectedEl) disconnectedEl.style.display = 'none';
      if (connectedEl) connectedEl.style.display = 'none';
      if (pickEl) pickEl.style.display = 'block';
      if (conn.needs_reconnect && msgEl) {
        msgEl.textContent = 'Reconnection needed';
        msgEl.style.display = 'block';
        msgEl.style.color = '#f87171';
      }
      loadFacebookPages();
    } else {
      // Not connected
      if (disconnectedEl) disconnectedEl.style.display = 'block';
      if (connectedEl) connectedEl.style.display = 'none';
      if (pickEl) pickEl.style.display = 'none';
      applyFacebookComingSoon();
    }
  } catch (err) {
    console.error('Failed to load Facebook status:', err);
  }
}

function fbConnectButtonDefault() {
  return '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#1877F2" d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.92-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12z"/></svg> Connect Facebook';
}

async function connectFacebookAccount() {
  if (!currentUser) return;
  // Re-checked here, not just on the button: the disabled attribute is a DOM
  // state and starting a flow that Meta will reject helps nobody.
  if (!facebookConnectAllowed()) {
    showFacebookMsg('error', 'Facebook connections are coming soon, pending Meta approval.');
    return;
  }
  const btn = document.getElementById('settings-facebook-connect-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" class="ds-s-f33c30" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Redirecting to Facebook...';
    armConnectSheetWatchdog();
  }
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) throw new Error('No session');
    const ticketRes = await fetch('/api/facebook-ticket', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token }
    });
    if (!ticketRes.ok) {
      const errBody = await ticketRes.json().catch(function() { return {}; });
      throw new Error(errBody.error || 'ticket_failed');
    }
    const ticketJson = await ticketRes.json();
    if (!ticketJson || !ticketJson.ticket) throw new Error('Empty ticket response');
    window.location.href = '/api/facebook-oauth-start?ticket=' + encodeURIComponent(ticketJson.ticket);
  } catch (err) {
    console.error('Failed to start Facebook OAuth:', err);
    showFacebookMsg('error', 'Failed to start connection. Please try again.');
    resetFacebookConnectButton(true);
  }
}

function resetFacebookConnectButton(force) {
  const btn = document.getElementById('settings-facebook-connect-btn');
  if (!btn) return;
  if (!force && !/Redirecting to Facebook/i.test(btn.innerText || btn.textContent || '')) return;
  btn.disabled = false;
  btn.innerHTML = fbConnectButtonDefault();
  // This runs after a cancelled sheet or a failed attempt and would otherwise
  // hand back an enabled button regardless of the gate.
  applyFacebookComingSoon();
}

async function loadFacebookPages() {
  const listEl = document.getElementById('settings-facebook-page-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="settings-s-c06372">Loading your Pages...</div>';
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('No session');
    const r = await fetch('/api/facebook-pages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token }
    });
    const body = await r.json().catch(function() { return {}; });
    if (!r.ok || !body.ok) throw new Error(body.error || 'Could not load Pages');
    if (!body.pages || !body.pages.length) {
      listEl.innerHTML = '<div class="settings-s-c06372">No Pages found on your account.</div>';
      return;
    }
    listEl.innerHTML = body.pages.map(function(p) {
      const followers = Number(p.followers_count || 0).toLocaleString();
      return '<button type="button" data-settings-action="select-facebook-page" data-fb-page-id="' +
        escapeHtml(String(p.id)) + '" class="settings-s-266a6c dash-h-476242">' +
        escapeHtml(p.name || 'Page') + ' (' + followers + ' followers)</button>';
    }).join('');
  } catch (e) {
    console.error('loadFacebookPages', e);
    listEl.innerHTML = '<div class="settings-s-c06372">Couldn\'t load your Pages. Try reconnecting.</div>';
  }
}

async function selectFacebookPage(pageId) {
  if (!pageId) return;
  const listEl = document.getElementById('settings-facebook-page-list');
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('No session');
    if (listEl) listEl.innerHTML = '<div class="settings-s-c06372">Connecting your Page...</div>';
    const r = await fetch('/api/facebook-select-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ page_id: pageId })
    });
    const body = await r.json().catch(function() { return {}; });
    if (!r.ok || !body.ok) throw new Error(body.error || 'Could not select Page');
    showFacebookMsg('success', 'Facebook Page connected.');
    if (typeof showDashToast === 'function') showDashToast('success', 'Facebook Page connected!');
    if (typeof mkAudCache !== 'undefined') mkAudCache = null;
    loadFacebookConnectionStatus();
  } catch (e) {
    console.error('selectFacebookPage', e);
    showFacebookMsg('error', 'Could not connect that Page. Please try again.');
    loadFacebookConnectionStatus();
  }
}

function showFacebookDisconnectConfirm() {
  showModalConfirm(
    'Disconnect Facebook?',
    "Your Page data, follower counts, and audience insights will no longer sync. You can reconnect anytime.",
    function() { confirmDisconnectFacebook(); },
    'Yes, disconnect',
    'Keep connected',
    { logo: true, danger: true }
  );
}
async function confirmDisconnectFacebook() {
  if (!currentUser) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) throw new Error('No session');
    const res = await fetch('/api/facebook-disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token }
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || 'Disconnect failed');
    }
    showFacebookMsg('success', 'Facebook disconnected.');
    if (typeof showDashToast === 'function') showDashToast('success', 'Facebook disconnected.');
    if (typeof mkAudCache !== 'undefined') mkAudCache = null;
    loadFacebookConnectionStatus();
  } catch (err) {
    console.error('Failed to disconnect Facebook:', err);
    showFacebookMsg('error', 'Failed to disconnect. Please try again.');
  } finally {
  }
}

function showFacebookMsg(type, text) {
  // Delegates to the dashboard's slide-in toast.
  if (typeof showDashToast === 'function') {
    showDashToast(type === 'success' ? 'success' : 'error', text);
    return;
  }
  const el = document.getElementById('settings-facebook-msg');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = text;
  if (type === 'success') {
    el.style.background = 'rgba(74,222,128,0.08)';
    el.style.color = '#4ade80';
    el.style.border = '1px solid rgba(74,222,128,0.2)';
  } else {
    el.style.background = 'rgba(239,68,68,0.08)';
    el.style.color = '#fca5a5';
    el.style.border = '1px solid rgba(239,68,68,0.2)';
  }
}

// Handle ?facebook_status=... return params from the OAuth callback
(function handleFacebookReturn() {
  try {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('facebook_status');
    if (!status) return;
    function showWhenReady() {
      if (typeof showDashToast !== 'function') { setTimeout(showWhenReady, 200); return; }
      if (status === 'connected') {
        showDashToast('success', 'Facebook connected!');
        // See Instagram handler: re-check so a pending yellow surfaces once this
        // reconnect clears the last red.
        setTimeout(function() {
          if (typeof checkSocialReconnections === 'function' && currentUser) {
            checkSocialReconnections(currentUser.id);
          }
        }, 1200);
      } else if (status === 'pick_page') {
        showDashToast('info', 'Almost there, choose which Page to connect.');
      } else if (status === 'no_page') {
        showDashToast('error', 'No Facebook Page found on your account.');
      } else if (status === 'cancelled') {
        showDashToast('info', 'Facebook connection cancelled.');
      } else if (status === 'error') {
        const msg = params.get('facebook_message') || 'Could not connect Facebook.';
        showDashToast('error', msg);
      }
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
      if (typeof loadFacebookConnectionStatus === 'function') loadFacebookConnectionStatus();
      if (typeof mkAudCache !== 'undefined') mkAudCache = null;
    }
    showWhenReady();
  } catch (e) {
    console.error('handleFacebookReturn failed:', e);
  }
})();


// ============================================================
// YouTube Connection (Settings) - mirrors the Instagram block
// ============================================================
async function loadYouTubeConnectionStatus() {
  const disconnectedEl = document.getElementById('settings-youtube-disconnected');
  const connectedEl = document.getElementById('settings-youtube-connected');
  const titleEl = document.getElementById('settings-youtube-title');
  const avatarEl = document.getElementById('settings-youtube-avatar');
  const msgEl = document.getElementById('settings-youtube-msg');
  if (msgEl) msgEl.style.display = 'none';

  if (!currentUser) return;

  try {
    const { data: conn } = await sb
      .from('youtube_connections')
      .select('yt_channel_title,yt_custom_url,thumbnail_url,connected_at,needs_reconnect,data_last_fetched_at')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (conn) {
      if (disconnectedEl) disconnectedEl.style.display = 'none';
      if (connectedEl) connectedEl.style.display = 'block';
      setAcctReconnectState(connectedEl, 'YouTube Connected', acctStateFromRow(conn));
      if (titleEl) titleEl.textContent = conn.yt_channel_title || (conn.yt_custom_url || 'Connected');
      if (avatarEl && conn.thumbnail_url) {
        avatarEl.innerHTML = '<img src="' + escapeHtml(conn.thumbnail_url) + '" alt="" class="bio-s-0c9434">';
      }
    } else {
      if (disconnectedEl) disconnectedEl.style.display = 'block';
      if (connectedEl) connectedEl.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load YouTube status:', err);
  }
}

async function connectYouTubeAccount() {
  if (!currentUser) return;

  const btn = document.getElementById('settings-youtube-connect-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" class="ds-s-f33c30" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Redirecting to YouTube...';
    armConnectSheetWatchdog();
  }

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) {
      throw new Error('No session');
    }
    // Step 1: short-lived signed ticket (POST). Contains our user_id, expires
    // in 5 minutes, cannot be used as session auth.
    const ticketRes = await fetch('/api/youtube-oauth-ticket', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token }
    });
    if (!ticketRes.ok) {
      const errBody = await ticketRes.json().catch(function() { return {}; });
      throw new Error(errBody.error || 'ticket_failed');
    }
    const ticketJson = await ticketRes.json();
    if (!ticketJson || !ticketJson.ticket) {
      throw new Error('Empty ticket response');
    }
    // Step 2: navigate to the OAuth start endpoint with the signed ticket.
    window.location.href = '/api/youtube-oauth-start?ticket=' + encodeURIComponent(ticketJson.ticket);
  } catch (err) {
    console.error('Failed to start YouTube OAuth:', err);
    showYouTubeMsg('error', 'Failed to start connection. Please try again.');
    resetYouTubeConnectButton(true);
  }
}

function resetYouTubeConnectButton(force) {
  const btn = document.getElementById('settings-youtube-connect-btn');
  if (!btn) return;
  if (!force && !/Redirecting to YouTube/i.test(btn.innerText || btn.textContent || '')) return;
  btn.disabled = false;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-2C18.88 4 12 4 12 4s-6.88 0-8.59.42a2.78 2.78 0 0 0-1.95 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.41 19c1.71.42 8.59.42 8.59.42s6.88 0 8.59-.42a2.78 2.78 0 0 0 1.95-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg> Connect YouTube';
}

function showYouTubeDisconnectConfirm() {
  showModalConfirm(
    'Disconnect YouTube?',
    "Your subscriber counts and channel stats will no longer sync. You can reconnect anytime.",
    function() { confirmDisconnectYouTube(); },
    'Yes, disconnect',
    'Keep connected',
    { logo: true, danger: true }
  );
}

async function confirmDisconnectYouTube() {
  if (!currentUser) return;

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) {
      throw new Error('No session');
    }
    const res = await fetch('/api/youtube-disconnect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      }
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || 'Disconnect failed');
    }
    showYouTubeMsg('success', 'YouTube disconnected.');
    showDashToast('success', 'YouTube disconnected.');
    loadYouTubeConnectionStatus();
    // Invalidate the Media Kit Automatic-tab cache so the pane re-renders
    // without the disconnected platform.
    if (typeof mkAudCache !== 'undefined') mkAudCache = null;
  } catch (err) {
    console.error('Failed to disconnect YouTube:', err);
    showYouTubeMsg('error', 'Failed to disconnect. Please try again.');
  } finally {
  }
}

function showYouTubeMsg(type, text) {
  // Delegates to the dashboard's slide-in toast.
  if (typeof showDashToast === 'function') {
    showDashToast(type === 'success' ? 'success' : 'error', text);
    return;
  }
  const el = document.getElementById('settings-youtube-msg');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = text;
  if (type === 'success') {
    el.style.background = 'rgba(74,222,128,0.08)';
    el.style.color = '#4ade80';
    el.style.border = '1px solid rgba(74,222,128,0.2)';
  } else {
    el.style.background = 'rgba(239,68,68,0.08)';
    el.style.color = '#fca5a5';
    el.style.border = '1px solid rgba(239,68,68,0.2)';
  }
}

// Handle ?youtube_status=... return params from the OAuth callback. On a
// successful connect, fire an immediate data pull so the Media Kit shows real
// stats right away (rather than waiting for the next cron / editor open).
(function handleYouTubeReturn() {
  try {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('youtube_status');
    if (!status) return;

    function showWhenReady() {
      if (typeof showDashToast !== 'function') {
        setTimeout(showWhenReady, 200);
        return;
      }
      if (status === 'connected') {
        showDashToast('success', 'YouTube connected!');
        // Fire-and-forget initial data pull.
        (async function() {
          try {
            const { data: { session } } = await sb.auth.getSession();
            if (session && session.access_token) {
              fetch('/api/youtube-data-fetch', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + session.access_token }
              }).then(function() {
                // The pull clears needs_reconnect / refreshes data_last_fetched_at,
                // so re-run the check: if this reconnect cleared the last red, a
                // pending yellow (stale) toast now surfaces in the same session.
                if (typeof checkSocialReconnections === 'function' && currentUser) {
                  checkSocialReconnections(currentUser.id);
                }
              }).catch(function(e) { console.error('Initial YouTube fetch failed (non-fatal):', e); });
            }
          } catch (e) {
            console.error('Initial YouTube fetch setup failed:', e);
          }
        })();
      } else if (status === 'cancelled') {
        showDashToast('info', 'YouTube connection cancelled.');
      } else if (status === 'error') {
        const msg = escapeHtml(params.get('youtube_message') || 'Could not connect YouTube.');
        showDashToast('error', msg);
      }
      // Clean up URL so refresh doesn't re-trigger.
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
      if (typeof loadYouTubeConnectionStatus === 'function') {
        loadYouTubeConnectionStatus();
      }
      if (typeof mkAudCache !== 'undefined') mkAudCache = null;
    }
    showWhenReady();
  } catch (e) {
    console.error('handleYouTubeReturn failed:', e);
  }
})();

// ============================================================
// TikTok Connection (Settings) - mirrors the YouTube block
// ============================================================
async function loadTikTokConnectionStatus() {
  const disconnectedEl = document.getElementById('settings-tiktok-disconnected');
  const connectedEl = document.getElementById('settings-tiktok-connected');
  const titleEl = document.getElementById('settings-tiktok-title');
  const avatarEl = document.getElementById('settings-tiktok-avatar');
  const msgEl = document.getElementById('settings-tiktok-msg');
  if (msgEl) msgEl.style.display = 'none';

  if (!currentUser) return;

  try {
    const { data: conn } = await sb
      .from('tiktok_connections')
      .select('tt_display_name,tt_avatar_url,tt_profile_web_link,connected_at,needs_reconnect,data_last_fetched_at')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (conn) {
      if (disconnectedEl) disconnectedEl.style.display = 'none';
      if (connectedEl) connectedEl.style.display = 'block';
      setAcctReconnectState(connectedEl, 'TikTok Connected', acctStateFromRow(conn));
      if (titleEl) titleEl.textContent = conn.tt_display_name || 'Connected';
      if (avatarEl && conn.tt_avatar_url) {
        avatarEl.innerHTML = '<img src="' + escapeHtml(conn.tt_avatar_url) + '" alt="" class="bio-s-0c9434">';
      }
    } else {
      if (disconnectedEl) disconnectedEl.style.display = 'block';
      if (connectedEl) connectedEl.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load TikTok status:', err);
  }
}

async function connectTikTokAccount() {
  if (!currentUser) return;

  const btn = document.getElementById('settings-tiktok-connect-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" class="ds-s-f33c30" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Redirecting to TikTok...';
    armConnectSheetWatchdog();
  }

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) {
      throw new Error('No session');
    }
    // Step 1: short-lived signed ticket (POST). Contains our user_id, expires
    // in 5 minutes, cannot be used as session auth.
    const ticketRes = await fetch('/api/tiktok-oauth-ticket', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token }
    });
    if (!ticketRes.ok) {
      const errBody = await ticketRes.json().catch(function() { return {}; });
      throw new Error(errBody.error || 'ticket_failed');
    }
    const ticketJson = await ticketRes.json();
    if (!ticketJson || !ticketJson.ticket) {
      throw new Error('Empty ticket response');
    }
    // Step 2: navigate to the OAuth start endpoint with the signed ticket.
    window.location.href = '/api/tiktok-oauth-start?ticket=' + encodeURIComponent(ticketJson.ticket);
  } catch (err) {
    console.error('Failed to start TikTok OAuth:', err);
    showTikTokMsg('error', 'Failed to start connection. Please try again.');
    resetTikTokConnectButton(true);
  }
}

function resetTikTokConnectButton(force) {
  const btn = document.getElementById('settings-tiktok-connect-btn');
  if (!btn) return;
  if (!force && !/Redirecting to TikTok/i.test(btn.innerText || btn.textContent || '')) return;
  btn.disabled = false;
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48z" fill="#25F4EE" transform="translate(-0.9,-0.9)"/><path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48z" fill="#FE2C55" transform="translate(0.9,0.9)"/><path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48z" fill="#f0eef8"/></svg> Connect TikTok';
}

function showTikTokDisconnectConfirm() {
  showModalConfirm(
    'Disconnect TikTok?',
    "Your follower counts and profile data will no longer sync. You can reconnect anytime.",
    function() { confirmDisconnectTikTok(); },
    'Yes, disconnect',
    'Keep connected',
    { logo: true, danger: true }
  );
}

async function confirmDisconnectTikTok() {
  if (!currentUser) return;

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) {
      throw new Error('No session');
    }
    const res = await fetch('/api/tiktok-disconnect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      }
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || 'Disconnect failed');
    }
    showTikTokMsg('success', 'TikTok disconnected.');
    showDashToast('success', 'TikTok disconnected.');
    loadTikTokConnectionStatus();
    if (typeof mkAudCache !== 'undefined') mkAudCache = null;
  } catch (err) {
    console.error('Failed to disconnect TikTok:', err);
    showTikTokMsg('error', 'Failed to disconnect. Please try again.');
  } finally {
  }
}

function showTikTokMsg(type, text) {
  // Delegates to the dashboard's slide-in toast.
  if (typeof showDashToast === 'function') {
    showDashToast(type === 'success' ? 'success' : 'error', text);
    return;
  }
  const el = document.getElementById('settings-tiktok-msg');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = text;
  if (type === 'success') {
    el.style.background = 'rgba(74,222,128,0.08)';
    el.style.color = '#4ade80';
    el.style.border = '1px solid rgba(74,222,128,0.2)';
  } else {
    el.style.background = 'rgba(239,68,68,0.08)';
    el.style.color = '#fca5a5';
    el.style.border = '1px solid rgba(239,68,68,0.2)';
  }
}

// Handle ?tiktok_status=... return params from the OAuth callback. On a
// successful connect, fire an immediate data pull so the Media Kit shows real
// stats right away (rather than waiting for the next cron / editor open).
(function handleTikTokReturn() {
  try {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('tiktok_status');
    if (!status) return;

    function showWhenReady() {
      if (typeof showDashToast !== 'function') {
        setTimeout(showWhenReady, 200);
        return;
      }
      if (status === 'connected') {
        showDashToast('success', 'TikTok connected!');
        (async function() {
          try {
            const { data: { session } } = await sb.auth.getSession();
            if (session && session.access_token) {
              fetch('/api/tiktok-data-fetch', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + session.access_token }
              }).then(function() {
                if (typeof checkSocialReconnections === 'function' && currentUser) {
                  checkSocialReconnections(currentUser.id);
                }
              }).catch(function(e) { console.error('Initial TikTok fetch failed (non-fatal):', e); });
            }
          } catch (e) {
            console.error('Initial TikTok fetch setup failed:', e);
          }
        })();
      } else if (status === 'cancelled') {
        showDashToast('info', 'TikTok connection cancelled.');
      } else if (status === 'error') {
        const msg = escapeHtml(params.get('tiktok_message') || 'Could not connect TikTok.');
        showDashToast('error', msg);
      }
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
      if (typeof loadTikTokConnectionStatus === 'function') {
        loadTikTokConnectionStatus();
      }
      if (typeof mkAudCache !== 'undefined') mkAudCache = null;
    }
    showWhenReady();
  } catch (e) {
    console.error('handleTikTokReturn failed:', e);
  }
})();

// ---------- From dashboard.html L11347-11348: Settings Turnstile constants ----------
const SETTINGS_TURNSTILE_SITE_KEY = '0x4AAAAAAC9W8avdI3sdVEcc';
let settingsTurnstileWidgetId = null;
let settingsResetArmed = false; // true only between a user click and the callback that sends the email

// ---------- From dashboard.html L11350-11491: Settings Turnstile + cancel/result/confirm helpers ----------
// Turnstile runs in INVISIBLE mode: there is no checkbox for the user to tick.
// The widget is rendered once with a callback, then turnstile.execute() runs
// the silent challenge. When it resolves, the callback fires the actual
// password-reset send. The flow is a single click - no "verify above" step.

// =============================================================================
// SOCIAL-ACCOUNT PASSWORD SECTION
// Accounts created with "Sign in with Google" or "Sign in with Apple" have no
// Ryxa password. Sending a reset email to such an account is confusing (for
// Google it silently CREATES a password; for Apple there is no password to
// reset at all). So for these accounts we replace the password reset controls
// with a short explanatory note instead of emailing anything.
//
// NOTE: currentUser comes from getSession(), whose user object does NOT
// reliably include the identities[] array. We therefore call getUser()
// here, which returns a complete user object with identities populated.
// (Function name kept for the existing call site in dashboard-shell.js.)
// =============================================================================
async function applyGoogleAccountPasswordUI() {
  var section = document.getElementById('settings-password-section');
  if (!section) return;

  // Fetch a complete user object. getSession()'s cached user often lacks
  // identities[]; getUser() makes a fresh call that includes it.
  var user = null;
  try {
    var res = await sb.auth.getUser();
    user = res && res.data ? res.data.user : null;
  } catch (e) {
    return; // on failure, leave the normal reset controls in place
  }
  if (!user) return;

  // Determine the providers linked to this account. Check identities[] first,
  // then fall back to app_metadata (provider / providers) which Supabase also
  // populates with the sign-up provider.
  var providers = [];
  if (Array.isArray(user.identities)) {
    for (var i = 0; i < user.identities.length; i++) {
      var p = user.identities[i] && user.identities[i].provider;
      if (p) providers.push(p);
    }
  }
  var meta = user.app_metadata || {};
  if (meta.provider) providers.push(meta.provider);
  if (Array.isArray(meta.providers)) providers = providers.concat(meta.providers);

  var hasGoogle = providers.indexOf('google') !== -1;
  var hasApple = providers.indexOf('apple') !== -1;
  var hasEmail = providers.indexOf('email') !== -1;

  // If the account has a real email/password identity, the normal reset
  // controls apply even if a social provider is also linked.
  if (hasEmail) return;

  // Otherwise, show the note for whichever social provider manages sign-in.
  // Apple is checked first so a rare Apple+Google account (no email) explains
  // the passwordless nature without implying a Google password exists.
  var providerName = null;
  var extra = '';
  if (hasApple) {
    providerName = 'Apple';
    extra = 'Your password is managed by Apple.';
  } else if (hasGoogle) {
    providerName = 'Google';
    extra = 'To change the password you use, update it in your Google account settings.';
  } else {
    return; // no social provider and no email: leave controls as-is
  }

  section.innerHTML =
    '<div class="settings-s-9c422a">Password</div>'
    + '<p class="settings-s-4fba18">You sign in to Ryxa with ' + providerName
    + ', so your account does not use a Ryxa password. ' + extra + '</p>';
}

function resetSettingsTurnstile() {
  if (typeof turnstile !== 'undefined' && settingsTurnstileWidgetId !== null) {
    try { turnstile.reset(settingsTurnstileWidgetId); } catch (e) {}
  }
}

// Render the invisible widget once. Returns true if Turnstile is available.
function ensureSettingsTurnstile() {
  if (typeof turnstile === 'undefined') return false;
  if (settingsTurnstileWidgetId !== null) return true;
  const container = document.getElementById('settings-password-turnstile');
  if (!container) return false;
  settingsTurnstileWidgetId = turnstile.render('#settings-password-turnstile', {
    sitekey: SETTINGS_TURNSTILE_SITE_KEY,
    size: 'invisible',
    callback: function(token) { onSettingsTurnstileToken(token); },
    'error-callback': function() { onSettingsTurnstileError(); }
  });
  return true;
}

// Called by Turnstile when the silent challenge succeeds.
// Turnstile fires this callback on automatic token refresh too, not only
// after a user click - so it only proceeds when a send was actually armed
// by the user. Without this guard, token refreshes send duplicate emails.
function onSettingsTurnstileToken(token) {
  if (!settingsResetArmed) return;
  settingsResetArmed = false;
  finishPasswordReset(token);
}

// Called by Turnstile if the silent challenge fails.
function onSettingsTurnstileError() {
  settingsResetArmed = false;
  const btn = document.getElementById('settings-reset-password-btn');
  const msg = document.getElementById('settings-password-msg');
  if (typeof showDashToast === 'function') {
    showDashToast('error', 'Verification failed. Please disable your ad blocker for ryxa.io and try again.');
  } else if (msg) {
    msg.textContent = 'Verification failed. Please disable your ad blocker for ryxa.io and try again.';
    msg.style.background = 'rgba(239,68,68,0.08)';
    msg.style.border = '1px solid rgba(239,68,68,0.2)';
    msg.style.color = '#fca5a5';
    msg.style.display = 'block';
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Send password reset email';
  }
  resetSettingsTurnstile();
}

async function sendPasswordReset() {
  if (!currentUser?.email) return;
  const btn = document.getElementById('settings-reset-password-btn');
  const msg = document.getElementById('settings-password-msg');

  // Guard against repeat clicks while a verification is already in flight.
  if (settingsResetArmed) return;

  // Single click: kick off the invisible challenge. The callback (above)
  // continues to finishPasswordReset once the token arrives.
  if (!ensureSettingsTurnstile()) {
    msg.textContent = 'Verification could not load. Refresh the page and try again.';
    msg.style.background = 'rgba(239,68,68,0.08)';
    msg.style.border = '1px solid rgba(239,68,68,0.2)';
    msg.style.color = '#fca5a5';
    msg.style.display = 'block';
    return;
  }

  // Arm the send. Only an armed callback will actually email; automatic
  // Turnstile token refreshes fire the callback but find it disarmed.
  settingsResetArmed = true;
  btn.disabled = true;
  btn.textContent = 'Verifying…';
  msg.style.display = 'none';
  try {
    turnstile.execute(settingsTurnstileWidgetId);
  } catch (e) {
    onSettingsTurnstileError();
  }
}

// Sends the reset email once the invisible challenge has produced a token.
async function finishPasswordReset(captchaToken) {
  if (!currentUser?.email) return;
  const btn = document.getElementById('settings-reset-password-btn');
  const msg = document.getElementById('settings-password-msg');

  if (btn) btn.textContent = 'Sending…';
  try {
    const { error } = await sb.auth.resetPasswordForEmail(currentUser.email, {
      redirectTo: window.location.origin + '/reset-password.html',
      captchaToken
    });
    if (error) throw error;
    if (typeof showDashToast === 'function') {
      showDashToast('success', 'Check your inbox, we sent a reset link to ' + currentUser.email + '.');
    } else {
      msg.innerHTML = `Check your inbox, we sent a reset link to <strong>${escapeHtml(currentUser.email)}</strong>.`;
      msg.style.background = 'rgba(74,222,128,0.08)';
      msg.style.border = '1px solid rgba(74,222,128,0.2)';
      msg.style.color = '#4ade80';
      msg.style.display = 'block';
    }
    btn.textContent = 'Email sent ✓';
    // Reset captcha - tokens are single-use.
    resetSettingsTurnstile();
    // Re-enable after 30s so they can resend if email didn't arrive
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Resend reset email';
    }, 30000);
  } catch (e) {
    console.error('Password reset error:', e);
    var emsg = e.message || 'Something went wrong. Please try again.';
    if (emsg.toLowerCase().indexOf('captcha') !== -1 || emsg.toLowerCase().indexOf('invalid-input') !== -1) {
      emsg = 'Verification failed. Please disable your ad blocker for ryxa.io and try again.';
    }
    if (typeof showDashToast === 'function') { showDashToast('error', emsg); }
    else if (msg) {
    msg.textContent = emsg;
    msg.style.background = 'rgba(239,68,68,0.08)';
    msg.style.border = '1px solid rgba(239,68,68,0.2)';
    msg.style.color = '#fca5a5';
    msg.style.display = 'block';
    }
    btn.disabled = false;
    btn.textContent = 'Send password reset email';
    // Token is spent on a failed attempt too - reset so a retry gets a fresh one.
    resetSettingsTurnstile();
  }
}

function handleSettingsCancel() {
  const isCancelling = userStatus === 'cancelling';
  dismissSettingsMsg();
  if (isCancelling) {
    document.getElementById('settings-renew-confirm').style.display = 'block';
  } else {
    document.getElementById('settings-cancel-confirm').style.display = 'block';
  }
}

function dismissSettingsMsg() {
  const els = [
    'settings-cancel-confirm',
    'settings-renew-confirm',
    'settings-result-msg',
  ];
  els.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function showSettingsResult(type, msg) {
  // Delegates to the dashboard's slide-in toast. Legacy inline banner kept
  // as fallback if the shell isn't loaded.
  if (typeof showDashToast === 'function') {
    showDashToast(type === 'success' ? 'success' : 'error', msg);
    return;
  }
  dismissSettingsMsg();
  const el = document.getElementById('settings-result-msg');
  const isSuccess = type === 'success';
  el.style.display = 'block';
  el.style.background = isSuccess ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)';
  el.style.border = isSuccess ? '1px solid rgba(74,222,128,0.25)' : '1px solid rgba(239,68,68,0.2)';
  el.style.color = isSuccess ? '#4ade80' : '#fca5a5';
  el.textContent = msg;
}

// Confirm a cancel/reactivate actually took effect by reading Stripe (the
// source of truth) via /api/subscription-verify. We poll briefly because the
// endpoint reads Stripe right after the Edge Function ran. Returns true once
// Stripe matches the expected state; false if it never confirms within the
// window, in which case the caller shows a "could not confirm" message rather
// than a false success. A bare 2xx from the cancel function is NOT proof the
// Stripe call landed, which is exactly the gap that let a cancel look done
// while Stripe stayed active.
async function verifySubscriptionCancelState(expectCancelAtPeriodEnd) {
  let token = null;
  try {
    const { data } = await sb.auth.getSession();
    token = data && data.session && data.session.access_token;
  } catch (e) { token = null; }
  if (!token) return false; // cannot verify -> treat as unconfirmed (safe)

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(function (r) { setTimeout(r, 1200); });
    try {
      const res = await fetch('/api/subscription-verify', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) continue;
      const d = await res.json();
      // A confirmed result requires a real subscription whose cancel state
      // matches what we expect. "No subscription found" is NOT treated as a
      // confirmed cancel: that ambiguity (possibly a stale pointer) is exactly
      // what produced false "cancelled!" successes before. We keep retrying,
      // and if it never confirms the caller shows "could not confirm".
      if (d.has_subscription && d.cancel_at_period_end === expectCancelAtPeriodEnd) return true;
    } catch (e) { /* transient; retry */ }
  }
  return false;
}

async function confirmSettingsCancel() {
  const wasCancelling = userStatus === 'cancelling';
  // Snapshot tier/trial state BEFORE the function call so the success
  // message reflects what they had, not what the post-call refresh might
  // look like (especially relevant for reactivating, where the state stays
  // the same but the labels are clearer to be specific).
  const wasMax = isMax();
  const wasTrialing = wasMax && userTrialEnd && new Date(userTrialEnd).getTime() > Date.now();
  // Was the user on Pro right before upgrading to Max? If so, the cancel
  // message should acknowledge they don't auto-return to Pro - they drop
  // to Free and need to resubscribe to Pro if that's what they want.
  const wasFromPro = userPreMaxTier === 'monthly';

  const btn = document.getElementById('settings-cancel-btn');
  btn.textContent = wasCancelling ? 'Reactivating...' : 'Cancelling...';
  btn.disabled = true;
  dismissSettingsMsg();
  try {
    const fn = wasCancelling ? 'reactivate-subscription' : 'cancel-subscription';
    const { error } = await sb.functions.invoke(fn, { body: { userId: currentUser.id } });
    if (error) throw error;

    // SAFEGUARD: a 2xx from the function is not proof Stripe actually applied
    // the change. Confirm against Stripe (source of truth) before claiming
    // success, so the UI can never report a cancel/reactivate that did not land.
    const expectCancel = !wasCancelling; // after a cancel we expect cancel_at_period_end === true
    const confirmed = await verifySubscriptionCancelState(expectCancel);

    await fetchTier(currentUser.id);
    updateSettingsCancelBtn();

    if (!confirmed) {
      showSettingsResult('error',
        wasCancelling
          ? 'We could not confirm your reactivation with Stripe yet. Please refresh in a moment. If it still shows cancelling, try again or email hello@ryxa.io.'
          : 'We could not confirm your cancellation with Stripe yet. Please refresh in a moment. If your plan still shows active, cancel again or email hello@ryxa.io.');
      return;
    }

    let msg;
    if (wasCancelling) {
      msg = wasMax
        ? 'Your Creator Max plan has been reactivated!'
        : 'Your Pro plan has been reactivated!';
    } else if (wasTrialing && wasFromPro) {
      // Pro→Max trial user cancels: keep Max through trial, then drop to Free.
      // Be explicit that they don't auto-return to Pro.
      msg = "Cancelled. You'll keep Creator Max access through the end of your free trial. After that, you'll be on the Free plan. You can resubscribe to Pro anytime from Settings.";
    } else if (wasTrialing) {
      // Free→Max trial user cancels: keep Max through trial, then drop to Free.
      msg = 'Cancelled. You keep Creator Max access through the end of your free trial, then no charges will be made.';
    } else if (wasMax) {
      msg = 'Cancelled. You keep Creator Max access until the end of your billing period.';
    } else {
      msg = 'Cancelled. You keep Pro access until the end of your billing period.';
    }
    showSettingsResult('success', msg);
  } catch(err) {
    console.error('Subscription error:', err);
    showSettingsResult('error', 'Something went wrong. Please email hello@ryxa.io for help.');
  } finally {
    btn.disabled = false;
  }
}

// =============================================================================
// ACTION REGISTRATIONS - wired up below as part of Phase 2
// =============================================================================

// Stripe Connect
settingsRegisterAction('connect-stripe', () => connectStripeAccount());
settingsRegisterAction('show-stripe-disconnect', () => showStripeDisconnectConfirm());
settingsRegisterAction('confirm-disconnect-stripe', () => confirmDisconnectStripe());

// Instagram
settingsRegisterAction('connect-instagram', () => connectInstagramAccount());
settingsRegisterAction('show-instagram-disconnect', () => showInstagramDisconnectConfirm());
settingsRegisterAction('confirm-disconnect-instagram', () => confirmDisconnectInstagram());
settingsRegisterAction('connect-facebook', () => connectFacebookAccount());
settingsRegisterAction('select-facebook-page', (e, el) => selectFacebookPage(el && el.dataset ? el.dataset.fbPageId : null));
settingsRegisterAction('show-facebook-disconnect', () => showFacebookDisconnectConfirm());
settingsRegisterAction('confirm-disconnect-facebook', () => confirmDisconnectFacebook());
settingsRegisterAction('connect-youtube', () => connectYouTubeAccount());
settingsRegisterAction('show-youtube-disconnect', () => showYouTubeDisconnectConfirm());
settingsRegisterAction('confirm-disconnect-youtube', () => confirmDisconnectYouTube());
async function loadTwitchConnectionStatus() {
  const disconnectedEl = document.getElementById('settings-twitch-disconnected');
  const connectedEl = document.getElementById('settings-twitch-connected');
  const titleEl = document.getElementById('settings-twitch-title');
  const avatarEl = document.getElementById('settings-twitch-avatar');
  const msgEl = document.getElementById('settings-twitch-msg');
  if (msgEl) msgEl.style.display = 'none';

  if (!currentUser) return;

  try {
    const { data: conn } = await sb
      .from('twitch_connections')
      .select('tw_display_name,tw_avatar_url,tw_profile_url,connected_at,needs_reconnect,data_last_fetched_at')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (conn) {
      if (disconnectedEl) disconnectedEl.style.display = 'none';
      if (connectedEl) connectedEl.style.display = 'block';
      setAcctReconnectState(connectedEl, 'Twitch Connected', acctStateFromRow(conn));
      if (titleEl) titleEl.textContent = conn.tw_display_name || 'Connected';
      if (avatarEl && conn.tw_avatar_url) {
        avatarEl.innerHTML = '<img src="' + escapeHtml(conn.tw_avatar_url) + '" alt="" class="bio-s-0c9434">';
      }
    } else {
      if (disconnectedEl) disconnectedEl.style.display = 'block';
      if (connectedEl) connectedEl.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load Twitch status:', err);
  }
}

async function connectTwitchAccount() {
  if (!currentUser) return;

  const btn = document.getElementById('settings-twitch-connect-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" class="ds-s-f33c30" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Redirecting to Twitch...';
    armConnectSheetWatchdog();
  }

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) {
      throw new Error('No session');
    }
    // Step 1: short-lived signed ticket (POST). Contains our user_id, expires
    // in 5 minutes, cannot be used as session auth.
    const ticketRes = await fetch('/api/twitch-oauth-ticket', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token }
    });
    if (!ticketRes.ok) {
      const errBody = await ticketRes.json().catch(function() { return {}; });
      throw new Error(errBody.error || 'ticket_failed');
    }
    const ticketJson = await ticketRes.json();
    if (!ticketJson || !ticketJson.ticket) {
      throw new Error('Empty ticket response');
    }
    // Step 2: navigate to the OAuth start endpoint with the signed ticket.
    window.location.href = '/api/twitch-oauth-start?ticket=' + encodeURIComponent(ticketJson.ticket);
  } catch (err) {
    console.error('Failed to start Twitch OAuth:', err);
    showTwitchMsg('error', 'Failed to start connection. Please try again.');
    resetTwitchConnectButton(true);
  }
}

function resetTwitchConnectButton(force) {
  const btn = document.getElementById('settings-twitch-connect-btn');
  if (!btn) return;
  if (!force && !/Redirecting to Twitch/i.test(btn.innerText || btn.textContent || '')) return;
  btn.disabled = false;
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" fill="#9146FF"/></svg> Connect Twitch';
}

function showTwitchDisconnectConfirm() {
  showModalConfirm(
    'Disconnect Twitch?',
    "Your follower counts and channel stats will no longer sync. You can reconnect anytime.",
    function() { confirmDisconnectTwitch(); },
    'Yes, disconnect',
    'Keep connected',
    { logo: true, danger: true }
  );
}

async function confirmDisconnectTwitch() {
  if (!currentUser) return;

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) {
      throw new Error('No session');
    }
    const res = await fetch('/api/twitch-disconnect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      }
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || 'Disconnect failed');
    }
    showTwitchMsg('success', 'Twitch disconnected.');
    showDashToast('success', 'Twitch disconnected.');
    loadTwitchConnectionStatus();
    if (typeof mkAudCache !== 'undefined') mkAudCache = null;
  } catch (err) {
    console.error('Failed to disconnect Twitch:', err);
    showTwitchMsg('error', 'Failed to disconnect. Please try again.');
  } finally {
  }
}

function showTwitchMsg(type, text) {
  // Delegates to the dashboard's slide-in toast.
  if (typeof showDashToast === 'function') {
    showDashToast(type === 'success' ? 'success' : 'error', text);
    return;
  }
  const el = document.getElementById('settings-twitch-msg');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = text;
  if (type === 'success') {
    el.style.background = 'rgba(74,222,128,0.08)';
    el.style.color = '#4ade80';
    el.style.border = '1px solid rgba(74,222,128,0.2)';
  } else {
    el.style.background = 'rgba(239,68,68,0.08)';
    el.style.color = '#fca5a5';
    el.style.border = '1px solid rgba(239,68,68,0.2)';
  }
}

// Handle ?twitch_status=... return params from the OAuth callback. On a
// successful connect, fire an immediate data pull so the Media Kit shows real
// stats right away (rather than waiting for the next cron / editor open).
(function handleTwitchReturn() {
  try {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('twitch_status');
    if (!status) return;

    function showWhenReady() {
      if (typeof showDashToast !== 'function') {
        setTimeout(showWhenReady, 200);
        return;
      }
      if (status === 'connected') {
        showDashToast('success', 'Twitch connected!');
        (async function() {
          try {
            const { data: { session } } = await sb.auth.getSession();
            if (session && session.access_token) {
              fetch('/api/twitch-data-fetch', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + session.access_token }
              }).then(function() {
                if (typeof checkSocialReconnections === 'function' && currentUser) {
                  checkSocialReconnections(currentUser.id);
                }
              }).catch(function(e) { console.error('Initial Twitch fetch failed (non-fatal):', e); });
            }
          } catch (e) {
            console.error('Initial Twitch fetch setup failed:', e);
          }
        })();
      } else if (status === 'cancelled') {
        showDashToast('info', 'Twitch connection cancelled.');
      } else if (status === 'error') {
        const msg = escapeHtml(params.get('twitch_message') || 'Could not connect Twitch.');
        showDashToast('error', msg);
      }
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
      if (typeof loadTwitchConnectionStatus === 'function') {
        loadTwitchConnectionStatus();
      }
      if (typeof mkAudCache !== 'undefined') mkAudCache = null;
    }
    showWhenReady();
  } catch (e) {
    console.error('handleTwitchReturn failed:', e);
  }
})();

settingsRegisterAction('connect-tiktok', () => connectTikTokAccount());
settingsRegisterAction('show-tiktok-disconnect', () => showTikTokDisconnectConfirm());
settingsRegisterAction('confirm-disconnect-tiktok', () => confirmDisconnectTikTok());
settingsRegisterAction('connect-twitch', () => connectTwitchAccount());
settingsRegisterAction('show-twitch-disconnect', () => showTwitchDisconnectConfirm());
settingsRegisterAction('confirm-disconnect-twitch', () => confirmDisconnectTwitch());

// Currency
settingsRegisterAction('change-currency', (e, el) => changeDisplayCurrency(el.value));

// Subscription / Upgrade flows
// "Upgrade Now" (free) and "Change Plan" (paid) both route to the pricing page.
settingsRegisterAction('open-pricing', (e, el) => {
  // In-app, pricing opens in Safari via a minted ticket (async), so the
  // button would sit unlabeled during the hand-off and then stuck (this
  // WebView never navigates away). Show "Redirecting to website..." and reset
  // shortly after, since the user returns to this same page from Safari.
  if (el && window.RyxaNative && window.ReactNativeWebView) {
    var orig = el.textContent;
    el.disabled = true;
    el.textContent = 'Redirecting to website...';
    setTimeout(function () { el.disabled = false; el.textContent = orig; }, 1500);
  }
  openPricingPage();
});
settingsRegisterAction('manage-billing', () => handleManageBilling());
settingsRegisterAction('handle-cancel', () => handleSettingsCancel());
settingsRegisterAction('confirm-cancel', () => confirmSettingsCancel());

// Misc
settingsRegisterAction('dismiss-msg', () => dismissSettingsMsg());
settingsRegisterAction('send-password-reset', () => sendPasswordReset());
settingsRegisterAction('toggle-marketing', (e, el) => toggleMarketingEmails(el.checked));

// =============================================================================
// DELETE ACCOUNT
// =============================================================================
// Small "Delete account" link at the bottom of Settings opens a modal that
// requires the user to type the exact phrase AND re-authenticate (password, or
// a fresh Google sign-in) before the irreversible deletion runs server-side.
//
// Flow:
//   • Password account: type phrase + password -> signInWithPassword verifies
//     identity -> POST /api/delete-account.
//   • Google account: type phrase -> Confirm triggers signInWithOAuth (redirect
//     to Google, back to dashboard.html?finish_delete=1). On return the modal
//     reopens "confirmed"; type phrase again + Delete permanently -> POST.
// =============================================================================

const DELETE_ACCOUNT_PHRASE = 'DELETE MY ACCOUNT';
var _deleteAccountMode = null; // 'password' | 'google' | 'apple'
var _deleteAccountStep = 1;    // 1 = verify identity, 2 = typed confirmation

function _delEl(id) { return document.getElementById(id); }

function _delSetMsg(text) {
  var el = _delEl('settings-delete-msg');
  if (!el) return;
  if (text) { el.textContent = text; el.classList.add('show'); }
  else { el.textContent = ''; el.classList.remove('show'); }
}

function _delSetOk(text) {
  var el = _delEl('settings-delete-ok');
  if (!el) return;
  if (text) { el.textContent = text; el.classList.add('show'); }
  else { el.textContent = ''; el.classList.remove('show'); }
}

// Invisible Turnstile for the password re-auth (this project enforces captcha on
// password sign-in, so signInWithPassword needs a token). Mirrors the PWA helper.
var _deleteTurnstileWidgetId = null;
var _deleteTurnstilePendingResolve = null;
var _deleteTurnstilePendingReject = null;

function ensureDeleteTurnstile() {
  if (typeof turnstile === 'undefined') return false;
  if (_deleteTurnstileWidgetId !== null) return true;
  var container = _delEl('settings-delete-turnstile');
  if (!container) return false;
  _deleteTurnstileWidgetId = turnstile.render('#settings-delete-turnstile', {
    sitekey: SETTINGS_TURNSTILE_SITE_KEY,
    size: 'invisible',
    callback: function(token) {
      if (_deleteTurnstilePendingResolve) {
        var r = _deleteTurnstilePendingResolve;
        _deleteTurnstilePendingResolve = null; _deleteTurnstilePendingReject = null;
        r(token);
      }
    },
    'error-callback': function() {
      if (_deleteTurnstilePendingReject) {
        var rj = _deleteTurnstilePendingReject;
        _deleteTurnstilePendingResolve = null; _deleteTurnstilePendingReject = null;
        rj(new Error('Verification failed.'));
      }
    }
  });
  return true;
}

function resetDeleteTurnstile() {
  if (typeof turnstile !== 'undefined' && _deleteTurnstileWidgetId !== null) {
    try { turnstile.reset(_deleteTurnstileWidgetId); } catch (e) {}
  }
}

function getDeleteTurnstileToken() {
  return new Promise(function(resolve, reject) {
    if (!ensureDeleteTurnstile()) { reject(new Error('Verification not ready.')); return; }
    try {
      var existing = turnstile.getResponse(_deleteTurnstileWidgetId);
      if (existing) { resolve(existing); return; }
    } catch (e) {}
    _deleteTurnstilePendingResolve = resolve;
    _deleteTurnstilePendingReject = reject;
    try { turnstile.execute(_deleteTurnstileWidgetId); }
    catch (e) { _deleteTurnstilePendingResolve = null; _deleteTurnstilePendingReject = null; reject(e); }
  });
}

async function openDeleteAccountModal(forcedMode) {
  var modal = _delEl('settings-delete-modal');
  if (!modal) return;

  // Reset fields/state.
  _delSetMsg('');
  _delSetOk('');
  var phraseInput = _delEl('settings-delete-input');
  if (phraseInput) phraseInput.value = '';
  var pwInput = _delEl('settings-delete-password');
  if (pwInput) pwInput.value = '';
  var confirmBtn = _delEl('settings-delete-confirm-btn');

  var pwBlock = _delEl('settings-delete-pw-block');
  var oauthBlock = _delEl('settings-delete-oauth-block');
  var oauthNote = _delEl('settings-delete-oauth-note');
  var confirmedBlock = _delEl('settings-delete-confirmed-block');
  var phraseBlock = _delEl('settings-delete-phrase-block');
  if (pwBlock) pwBlock.style.display = 'none';
  if (oauthBlock) oauthBlock.style.display = 'none';
  if (confirmedBlock) confirmedBlock.style.display = 'none';
  if (phraseBlock) phraseBlock.style.display = 'none';

  if (forcedMode === 'confirmed') {
    // Step 2: identity already re-confirmed (returning from Google/Apple).
    _delEnterStep2();
  } else {
    // Step 1: verify identity first. Detect the account's sign-in method,
    // including Apple (Apple-only accounts previously fell through to the
    // password prompt they could never satisfy).
    _deleteAccountStep = 1;
    var hasGoogle = false, hasApple = false, hasEmail = false;
    try {
      var res = await sb.auth.getUser();
      var user = res && res.data ? res.data.user : null;
      var providers = [];
      if (user && Array.isArray(user.identities)) {
        user.identities.forEach(function(idn) { if (idn && idn.provider) providers.push(idn.provider); });
      }
      var meta = (user && user.app_metadata) || {};
      if (meta.provider) providers.push(meta.provider);
      if (Array.isArray(meta.providers)) providers = providers.concat(meta.providers);
      hasGoogle = providers.indexOf('google') !== -1;
      hasApple = providers.indexOf('apple') !== -1;
      hasEmail = providers.indexOf('email') !== -1;
    } catch (e) {
      // If detection fails, fall back to password mode (the safer prompt).
      hasEmail = true;
    }

    if (hasEmail || (!hasGoogle && !hasApple)) {
      _deleteAccountMode = 'password';
      if (pwBlock) pwBlock.style.display = '';
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Verify identity'; }
      ensureDeleteTurnstile();
      resetDeleteTurnstile();
    } else if (hasGoogle) {
      _deleteAccountMode = 'google';
      if (oauthBlock) oauthBlock.style.display = '';
      if (oauthNote) oauthNote.textContent = 'You sign in with Google. Verify your identity with a quick Google sign-in, then you can confirm the deletion.';
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Verify with Google'; }
    } else {
      _deleteAccountMode = 'apple';
      if (oauthBlock) oauthBlock.style.display = '';
      if (oauthNote) oauthNote.textContent = 'You sign in with Apple. Verify your identity with a quick Apple sign-in, then you can confirm the deletion.';
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Verify with Apple'; }
    }
  }

  modal.classList.add('open');
  if (_deleteAccountStep === 1 && _deleteAccountMode === 'password' && pwInput) {
    pwInput.focus();
  } else if (_deleteAccountStep === 2 && phraseInput) {
    phraseInput.focus();
  }
}

// Switch the modal into step 2: identity confirmed, typed phrase required.
function _delEnterStep2() {
  _deleteAccountStep = 2;
  var pwBlock = _delEl('settings-delete-pw-block');
  var oauthBlock = _delEl('settings-delete-oauth-block');
  var confirmedBlock = _delEl('settings-delete-confirmed-block');
  var phraseBlock = _delEl('settings-delete-phrase-block');
  if (pwBlock) pwBlock.style.display = 'none';
  if (oauthBlock) oauthBlock.style.display = 'none';
  if (confirmedBlock) confirmedBlock.style.display = '';
  if (phraseBlock) phraseBlock.style.display = '';
  var confirmBtn = _delEl('settings-delete-confirm-btn');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Delete permanently'; }
  var phraseInput = _delEl('settings-delete-input');
  if (phraseInput) { phraseInput.value = ''; phraseInput.focus(); }
}

function closeDeleteAccountModal() {
  var modal = _delEl('settings-delete-modal');
  if (modal) modal.classList.remove('open');
  _deleteAccountMode = null;
  _deleteAccountStep = 1;
}

function deleteAccountInputCheck(e, el) {
  if (_deleteAccountStep !== 2) return;
  var confirmBtn = _delEl('settings-delete-confirm-btn');
  if (!confirmBtn) return;
  confirmBtn.disabled = (el.value !== DELETE_ACCOUNT_PHRASE);
}

async function confirmDeleteAccount() {
  // ---- STEP 2: identity already verified; typed phrase gates deletion. ----
  if (_deleteAccountStep === 2) {
    var phraseInput = _delEl('settings-delete-input');
    if (!phraseInput || phraseInput.value !== DELETE_ACCOUNT_PHRASE) {
      _delSetMsg('Please type ' + DELETE_ACCOUNT_PHRASE + ' exactly.');
      return;
    }
    _delSetMsg('');
    await performAccountDeletion();
    return;
  }

  // ---- STEP 1: verify identity only. Never deletes. ----
  _delSetMsg('');

  // Google/Apple: fresh provider sign-in; the modal resumes at step 2 on
  // return (?finish_delete=1). In the native app the OAuth runs in the
  // bottom sheet (a blocked full-page navigation would replay and loop,
  // same lesson as the login flow).
  if (_deleteAccountMode === 'google' || _deleteAccountMode === 'apple') {
    var provider = _deleteAccountMode;
    var providerLabel = provider === 'google' ? 'Google' : 'Apple';
    var btn = _delEl('settings-delete-confirm-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening ' + providerLabel + '...'; }
    var inApp = !!(window.RyxaNative && window.ReactNativeWebView);
    var oauthOptions = {
      redirectTo: 'https://ryxa.io/dashboard.html?finish_delete=1',
      skipBrowserRedirect: inApp
    };
    if (provider === 'google') oauthOptions.queryParams = { prompt: 'select_account' };
    var oauth = await sb.auth.signInWithOAuth({ provider: provider, options: oauthOptions });
    if (oauth && oauth.error) {
      _delSetMsg(oauth.error.message || 'Could not start ' + providerLabel + ' sign-in. Please try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Verify with ' + providerLabel; }
      return;
    }
    if (inApp && oauth && oauth.data && oauth.data.url) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'openSheet', url: oauth.data.url }));
    }
    return;
  }

  // Password account: verify the password (with captcha), then advance to
  // the typed confirmation step.
  var pwInput = _delEl('settings-delete-password');
  var password = pwInput ? pwInput.value : '';
  if (!password) { _delSetMsg('Please enter your password to continue.'); return; }

  var btn2 = _delEl('settings-delete-confirm-btn');
  if (btn2) { btn2.disabled = true; btn2.textContent = 'Verifying...'; }

  // This project enforces captcha on password sign-in, so obtain a token first.
  var captchaToken;
  try {
    captchaToken = await getDeleteTurnstileToken();
  } catch (e) {
    _delSetMsg('Verification failed. Please disable any ad blocker for ryxa.io and try again.');
    resetDeleteTurnstile();
    if (btn2) { btn2.disabled = false; btn2.textContent = 'Verify identity'; }
    return;
  }

  try {
    var email = (currentUser && currentUser.email) || '';
    var result = await sb.auth.signInWithPassword({
      email: email,
      password: password,
      options: { captchaToken: captchaToken }
    });
    resetDeleteTurnstile(); // token is single-use
    if (result.error) {
      var em = (result.error.message || '').toLowerCase();
      if (em.indexOf('captcha') !== -1) {
        _delSetMsg('Verification failed. Please disable any ad blocker for ryxa.io and try again.');
      } else {
        _delSetMsg('That password is not correct. Please try again.');
      }
      if (btn2) { btn2.disabled = false; btn2.textContent = 'Verify identity'; }
      return;
    }
  } catch (e) {
    resetDeleteTurnstile();
    _delSetMsg('Could not verify your password. Please try again.');
    if (btn2) { btn2.disabled = false; btn2.textContent = 'Verify identity'; }
    return;
  }

  // Password verified: advance to the typed confirmation step.
  _delEnterStep2();
}

async function performAccountDeletion() {
  var btn = _delEl('settings-delete-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }
  _delSetMsg('');

  try {
    var sessionRes = await sb.auth.getSession();
    var session = sessionRes && sessionRes.data ? sessionRes.data.session : null;
    if (!session || !session.access_token) {
      _delSetMsg('Your session expired. Please sign in again and retry.');
      if (btn) { btn.disabled = false; btn.textContent = 'Delete permanently'; }
      return;
    }

    var res = await fetch('/api/delete-account', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + session.access_token,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      var data = await res.json().catch(function() { return {}; });
      _delSetMsg(data.error || 'Something went wrong. Please email hello@ryxa.io.');
      if (btn) { btn.disabled = false; btn.textContent = 'Delete permanently'; }
      return;
    }

    _delSetOk('Your account has been deleted. Signing you out...');
    try { _intentionalSignOut = true; } catch (e) {}
    try { await sb.auth.signOut(); } catch (e) { /* token already invalid; ignore */ }
    setTimeout(function() { window.location.href = '/dashboard.html'; }, 1400);
  } catch (e) {
    console.error('performAccountDeletion error:', e);
    _delSetMsg('Something went wrong. Please email hello@ryxa.io.');
    if (btn) { btn.disabled = false; btn.textContent = 'Delete permanently'; }
  }
}

// Called from the dashboard init flow (dashboard-shell.js) on page load.
function handleDeleteAccountReturn() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('finish_delete') !== '1') return;

  // Strip the flag so a refresh doesn't reopen the modal.
  var cleanUrl = window.location.pathname;
  try { window.history.replaceState({}, document.title, cleanUrl); } catch (e) {}

  // Re-authentication with Google just succeeded (we have a session here).
  // Reopen the modal in "confirmed" mode for the final explicit confirmation.
  openDeleteAccountModal('confirmed');
}

settingsRegisterAction('open-delete-account', () => openDeleteAccountModal());
settingsRegisterAction('close-delete-account', () => closeDeleteAccountModal());
settingsRegisterAction('delete-input-check', (e, el) => deleteAccountInputCheck(e, el));
settingsRegisterAction('confirm-delete-account', () => confirmDeleteAccount());
