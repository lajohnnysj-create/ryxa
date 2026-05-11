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
// ORIGINAL PRICING PAGE CODE
// =================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// If user is already logged in, send them to the dashboard
sb.auth.getSession().then(({ data: { session } }) => {
  if (session?.user) {
    window.location.href = 'dashboard.html';
  }
});

// Mobile menu handled by site-nav.js

// Auth modal fallbacks — redirect to homepage
function openSignupModal() { window.location.href = 'index.html?action=signup'; }
function openAuthModal() { window.location.href = 'index.html?action=signin'; }


// =================================================================
// ACTION REGISTRATIONS
// =================================================================
pricingRegisterAction('signup', function() {
  openSignupModal();
});
