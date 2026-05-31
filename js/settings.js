// =============================================================================
// /js/settings.js — Settings tool (extracted from dashboard.html, 2026-05-11)
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
// History: Settings code was scattered across dashboard.html main script — never
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
//     before the IIFE runs — but the IIFE waits via setTimeout retry until
//     showDashToast is defined, by which time this whole script is parsed.
//
// FUNCTIONS THIS FILE EXPOSES AS WINDOW GLOBALS (called from elsewhere):
//   • updateSettingsCancelBtn — called from updatePillsForTier in dashboard.html
//   • handleStripeConnectRedirect — called from dashboard init flow
//   • openSettingsModal / closeSettingsModal — no-ops kept for callsite compat
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
      // (matches what users expect — "left" implies remaining whole days).
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
  // Hide tier-change buttons while cancelling — user is about to lose subscription anyway.
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
  goToPricing();
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

    var msg = document.getElementById('settings-currency-msg');
    if (msg) {
      msg.style.display = 'block';
      setTimeout(function() { if (msg) msg.style.display = 'none'; }, 2500);
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
  // No-op now — settings is a tool view, not a modal
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
      if (acctIdEl && status.masked_id) {
        acctIdEl.textContent = status.masked_id;
      }
    } else {
      // Not connected
      if (disconnectedEl) disconnectedEl.style.display = 'block';
      if (connectedEl) connectedEl.style.display = 'none';
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
  const confirm = document.getElementById('stripe-disconnect-confirm');
  const btn = document.getElementById('stripe-disconnect-btn');
  if (confirm) confirm.style.display = 'block';
  if (btn) btn.style.display = 'none';
}

function hideStripeDisconnectConfirm() {
  const confirm = document.getElementById('stripe-disconnect-confirm');
  const btn = document.getElementById('stripe-disconnect-btn');
  if (confirm) confirm.style.display = 'none';
  if (btn) btn.style.display = 'block';
}

async function confirmDisconnectStripe() {
  if (!currentUser) return;

  try {
    const { error } = await sb
      .from('profiles')
      .update({ stripe_account_id: null })
      .eq('user_id', currentUser.id);

    if (error) throw error;

    hideStripeDisconnectConfirm();
    showStripeMsg('success', 'Stripe account disconnected.');
    showDashToast('success', 'Stripe account disconnected.');
    loadStripeConnectStatus();
  } catch (err) {
    console.error('Failed to disconnect Stripe:', err);
    showStripeMsg('error', 'Failed to disconnect. Please try again.');
  }
}

function showStripeMsg(type, text) {
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
      .select('ig_username,profile_picture_url,connected_at')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (conn) {
      // Connected
      if (disconnectedEl) disconnectedEl.style.display = 'none';
      if (connectedEl) connectedEl.style.display = 'block';
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
  }

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) {
      throw new Error('No session');
    }
    // Step 1: fetch a short-lived signed ticket via POST. The ticket contains
    // our user_id and expires in 5 minutes. Unlike a session token, it can't
    // be used as session auth — only to start an Instagram OAuth flow.
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

// ---------- From dashboard.html L11245-11253: show/hideInstagramDisconnectConfirm ----------
function showInstagramDisconnectConfirm() {
  const el = document.getElementById('instagram-disconnect-confirm');
  if (el) el.style.display = 'block';
}

function hideInstagramDisconnectConfirm() {
  const el = document.getElementById('instagram-disconnect-confirm');
  if (el) el.style.display = 'none';
}

// ---------- From dashboard.html L11255-11291: confirmDisconnectInstagram ----------
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
    hideInstagramDisconnectConfirm();
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
  }
}

// ---------- From dashboard.html L11293-11307: showInstagramMsg ----------
function showInstagramMsg(type, text) {
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
// GOOGLE-ACCOUNT PASSWORD SECTION
// Accounts created with "Sign in with Google" have no Ryxa password. Sending a
// reset email to such an account silently CREATES a password, which is
// confusing and unexpected. So for Google accounts we replace the password
// reset controls with a short explanatory note instead.
//
// NOTE: currentUser comes from getSession(), whose user object does NOT
// reliably include the identities[] array. We therefore call getUser()
// here, which returns a complete user object with identities populated.
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
  var hasEmail = providers.indexOf('email') !== -1;

  // Only treat as a Google-managed account when Google is present and there
  // is no email/password identity. If an email provider also exists, the
  // account has a real password and the normal reset controls should stay.
  if (!hasGoogle || hasEmail) return;

  // Replace the reset controls with an explanatory note.
  section.innerHTML =
    '<div class="settings-s-9c422a">Password</div>'
    + '<p class="settings-s-4fba18">You sign in to Ryxa with Google, so your '
    + 'account does not use a Ryxa password. To change the password you use, '
    + 'update it in your Google account settings.</p>';
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
  if (msg) {
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
    msg.innerHTML = `Check your inbox, we sent a reset link to <strong>${escapeHtml(currentUser.email)}</strong>.`;
    msg.style.background = 'rgba(74,222,128,0.08)';
    msg.style.border = '1px solid rgba(74,222,128,0.2)';
    msg.style.color = '#4ade80';
    msg.style.display = 'block';
    btn.textContent = 'Email sent ✓';
    // Reset captcha — tokens are single-use.
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
    msg.textContent = emsg;
    msg.style.background = 'rgba(239,68,68,0.08)';
    msg.style.border = '1px solid rgba(239,68,68,0.2)';
    msg.style.color = '#fca5a5';
    msg.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Send password reset email';
    // Token is spent on a failed attempt too — reset so a retry gets a fresh one.
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
  dismissSettingsMsg();
  const el = document.getElementById('settings-result-msg');
  const isSuccess = type === 'success';
  el.style.display = 'block';
  el.style.background = isSuccess ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)';
  el.style.border = isSuccess ? '1px solid rgba(74,222,128,0.25)' : '1px solid rgba(239,68,68,0.2)';
  el.style.color = isSuccess ? '#4ade80' : '#fca5a5';
  el.textContent = msg;
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
  // message should acknowledge they don't auto-return to Pro — they drop
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
    await fetchTier(currentUser.id);
    updateSettingsCancelBtn();

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
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Stripe Connect
settingsRegisterAction('connect-stripe', () => connectStripeAccount());
settingsRegisterAction('show-stripe-disconnect', () => showStripeDisconnectConfirm());
settingsRegisterAction('hide-stripe-disconnect', () => hideStripeDisconnectConfirm());
settingsRegisterAction('confirm-disconnect-stripe', () => confirmDisconnectStripe());

// Instagram
settingsRegisterAction('connect-instagram', () => connectInstagramAccount());
settingsRegisterAction('show-instagram-disconnect', () => showInstagramDisconnectConfirm());
settingsRegisterAction('hide-instagram-disconnect', () => hideInstagramDisconnectConfirm());
settingsRegisterAction('confirm-disconnect-instagram', () => confirmDisconnectInstagram());

// Currency
settingsRegisterAction('change-currency', (e, el) => changeDisplayCurrency(el.value));

// Subscription / Upgrade flows
// "Upgrade Now" (free) and "Change Plan" (paid) both route to the pricing page.
settingsRegisterAction('open-pricing', () => openPricingPage());
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
var _deleteAccountMode = null; // 'password' | 'google' | 'confirmed'

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
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Delete permanently'; }

  var pwBlock = _delEl('settings-delete-pw-block');
  var googleBlock = _delEl('settings-delete-google-block');
  var confirmedBlock = _delEl('settings-delete-confirmed-block');
  if (pwBlock) pwBlock.style.display = 'none';
  if (googleBlock) googleBlock.style.display = 'none';
  if (confirmedBlock) confirmedBlock.style.display = 'none';

  if (forcedMode === 'confirmed') {
    // Returning from a fresh Google re-auth.
    _deleteAccountMode = 'confirmed';
    if (confirmedBlock) confirmedBlock.style.display = '';
  } else {
    // Detect whether this is a Google-managed account (no password) or a
    // password account. Mirrors applyGoogleAccountPasswordUI's detection.
    var hasGoogle = false, hasEmail = false;
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
      hasEmail = providers.indexOf('email') !== -1;
    } catch (e) {
      // If detection fails, fall back to password mode (the safer prompt).
      hasEmail = true;
    }

    if (hasGoogle && !hasEmail) {
      _deleteAccountMode = 'google';
      if (googleBlock) googleBlock.style.display = '';
    } else {
      _deleteAccountMode = 'password';
      if (pwBlock) pwBlock.style.display = '';
      ensureDeleteTurnstile();
      resetDeleteTurnstile();
    }
  }

  modal.classList.add('open');
  if (phraseInput) phraseInput.focus();
}

function closeDeleteAccountModal() {
  var modal = _delEl('settings-delete-modal');
  if (modal) modal.classList.remove('open');
  _deleteAccountMode = null;
}

function deleteAccountInputCheck(e, el) {
  var confirmBtn = _delEl('settings-delete-confirm-btn');
  if (!confirmBtn) return;
  confirmBtn.disabled = (el.value !== DELETE_ACCOUNT_PHRASE);
}

async function confirmDeleteAccount() {
  var phraseInput = _delEl('settings-delete-input');
  if (!phraseInput || phraseInput.value !== DELETE_ACCOUNT_PHRASE) {
    _delSetMsg('Please type ' + DELETE_ACCOUNT_PHRASE + ' exactly.');
    return;
  }
  _delSetMsg('');

  // Already re-authenticated via Google on this return, proceed straight to deletion.
  if (_deleteAccountMode === 'confirmed') {
    await performAccountDeletion();
    return;
  }

  // Google account: kick off a fresh Google sign-in. Deletion resumes on return.
  if (_deleteAccountMode === 'google') {
    var btn = _delEl('settings-delete-confirm-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Redirecting to Google...'; }
    var oauth = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://ryxa.io/dashboard.html?finish_delete=1',
        queryParams: { prompt: 'select_account' }
      }
    });
    if (oauth && oauth.error) {
      _delSetMsg(oauth.error.message || 'Could not start Google sign-in. Please try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Delete permanently'; }
    }
    return;
  }

  // Password account: verify the password (with captcha) before deleting.
  var pwInput = _delEl('settings-delete-password');
  var password = pwInput ? pwInput.value : '';
  if (!password) { _delSetMsg('Please enter your password to confirm.'); return; }

  var btn2 = _delEl('settings-delete-confirm-btn');
  if (btn2) { btn2.disabled = true; btn2.textContent = 'Verifying...'; }

  // This project enforces captcha on password sign-in, so obtain a token first.
  var captchaToken;
  try {
    captchaToken = await getDeleteTurnstileToken();
  } catch (e) {
    _delSetMsg('Verification failed. Please disable any ad blocker for ryxa.io and try again.');
    resetDeleteTurnstile();
    if (btn2) { btn2.disabled = false; btn2.textContent = 'Delete permanently'; }
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
      if (btn2) { btn2.disabled = false; btn2.textContent = 'Delete permanently'; }
      return;
    }
  } catch (e) {
    resetDeleteTurnstile();
    _delSetMsg('Could not verify your password. Please try again.');
    if (btn2) { btn2.disabled = false; btn2.textContent = 'Delete permanently'; }
    return;
  }

  await performAccountDeletion();
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
    try { await sb.auth.signOut(); } catch (e) { /* token already invalid; ignore */ }
    setTimeout(function() { window.location.href = '/'; }, 1400);
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
