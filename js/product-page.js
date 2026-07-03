// =================================================================
// Ryxa product landing - extracted from api/product.js inline <script> for CSP.
//
// CSP rules applied to /product/:slug pages (set by api/product.js response):
//   - No inline <script> tags
//   - No inline event handlers (onclick=, etc.)
// Every interaction is wired through the delegation framework below,
// keyed by data-product-action attributes in HTML.
//
// Product-specific values (id, slug, isFree) are injected by the server
// via <meta> tags and read by the bootstrap block below.
// =================================================================

// -------- DELEGATION FRAMEWORK --------
var productActionHandlers = {};
function productRegisterAction(name, fn) { productActionHandlers[name] = fn; }

document.addEventListener('click', function(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-product-action]') : null;
  if (!el) return;
  var action = el.getAttribute('data-product-action');
  var h = productActionHandlers[action];
  if (h) h(e, el);
});

// =================================================================
// ORIGINAL PRODUCT LANDING CODE
// =================================================================

// -------- BOOTSTRAP FROM <meta> TAGS --------
// Server injects product-specific values via meta tags so this script
// can remain a static file (CSP-friendly, cacheable, no inline scripts).
function _metaContent(name) {
  var el = document.querySelector('meta[name="' + name + '"]');
  return el ? el.getAttribute('content') : '';
}
const PRODUCT_ID = _metaContent('ryxa-product-id');
const PRODUCT_SLUG = _metaContent('ryxa-product-slug');
const IS_FREE = _metaContent('ryxa-product-is-free') === 'true';

// Public Supabase config — anon key is meant to be browser-visible
const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
// autoRefreshToken stays OFF outside the dashboard. Only one page per
// origin may run the background refresh timer; multiple timers race for
// the single-use refresh token and trip Supabase reuse detection, which
// revokes the session (the random logout bug). Reads still refresh
// on demand when a real action needs a fresh token.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: false }
});

function showToast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + (type || '');
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 5000);
}

// Signed-in indicator
function toggleSigninPopover(evt) {
  if (evt) evt.stopPropagation();
  var pop = document.getElementById('signin-popover');
  pop.style.display = pop.style.display === 'block' ? 'none' : 'block';
}
document.addEventListener('click', function(e) {
  var pop = document.getElementById('signin-popover');
  var chip = document.getElementById('signin-chip');
  if (pop.style.display === 'block' && !pop.contains(e.target) && !chip.contains(e.target)) {
    pop.style.display = 'none';
  }
});

async function signOutAndReload() {
  await sb.auth.signOut();
  window.location.reload();
}

// On load: detect existing session, update UI
async function init() {
  try {
    var { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      var email = session.user.email || '';
      document.getElementById('signin-chip-email').textContent = email;
      document.getElementById('signin-chip-avatar').textContent = (email[0] || 'U').toUpperCase();
      document.getElementById('signin-chip').style.display = 'inline-flex';
      document.getElementById('signin-popover-email').textContent = email;
      document.getElementById('consent-row').style.display = 'flex';

      // If already purchased, swap button for "Go to Ryxa Hub" link
      try {
        var { data: existing } = await sb.from('digital_product_purchases')
          .select('id')
          .eq('product_id', PRODUCT_ID)
          .eq('buyer_user_id', session.user.id)
          .limit(1);
        if (existing && existing.length > 0) {
          document.getElementById('dp-buy-area').innerHTML = '<a href="/learn/?dp=' + PRODUCT_ID + '" class="dp-purchased-badge"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Go to your download</a>';
          document.getElementById('consent-row').style.display = 'none';
        }
      } catch (e) { /* non-fatal */ }
    }
  } catch (e) {
    console.error('Session check failed:', e);
  }
}
init();

// Page view tracking (fire-and-forget, same visitor dedup pattern as course/booking)
async function trackPageView() {
  try {
    var visitorHash;
    try {
      var raw = [
        navigator.userAgent || '',
        navigator.language || '',
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset().toString()
      ].join('|');
      var msgBuf = new TextEncoder().encode(raw);
      var hashBuf = await crypto.subtle.digest('SHA-256', msgBuf);
      var hashArr = Array.from(new Uint8Array(hashBuf));
      visitorHash = hashArr.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (hashErr) {
      visitorHash = 'fb-' + btoa(navigator.userAgent + screen.width + screen.height).slice(0, 32);
    }
    await sb.rpc('record_page_view', {
      p_username: _metaContent('ryxa-product-creator-name'),
      p_page_type: 'digital_product',
      p_visitor_hash: visitorHash,
      p_product_id: PRODUCT_ID
    });
  } catch (e) {
    console.error('trackPageView failed:', e);
  }
}
trackPageView();

async function handleBuyClick() {
  var { data: { session } } = await sb.auth.getSession();
  if (!session?.user) {
    window.location.href = '/learn/?redirect=' + encodeURIComponent(window.location.pathname);
    return;
  }

  var consentEl = document.getElementById('marketing-consent');
  var consent = consentEl ? consentEl.checked : false;
  var btn = document.getElementById('buy-btn');
  btn.disabled = true;
  btn.textContent = IS_FREE ? 'Processing...' : 'Loading checkout...';

  try {
    if (IS_FREE) {
      var resp = await fetch('/api/claim-free-product', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token
        },
        body: JSON.stringify({
          product_id: PRODUCT_ID,
          marketing_consent: consent
        })
      });
      var data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Could not process request');
      }
      window.location.href = '/learn/?dp=' + PRODUCT_ID + '&purchased=1';
      return;
    }

    var resp = await fetch('/api/digital-product-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      },
      body: JSON.stringify({
        product_id: PRODUCT_ID,
        marketing_consent: consent,
        success_url: window.location.origin + '/learn/?dp=' + PRODUCT_ID + '&purchased=1',
        cancel_url: window.location.href
      })
    });
    var data = await resp.json();
    if (!resp.ok || data.error) {
      throw new Error(data.error || 'Could not start checkout');
    }
    window.location.href = data.checkout_url;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = IS_FREE ? 'Get for free' : 'Buy now';
    showToast(err.message || 'Something went wrong', 'error');
  }
}


// =================================================================
// ACTION REGISTRATIONS - wire data-product-action attributes to handlers
// =================================================================

productRegisterAction('toggle-signin-popover', function(e) {
  toggleSigninPopover(e);
});

productRegisterAction('signout', function() {
  signOutAndReload();
});

productRegisterAction('buy', function() {
  handleBuyClick();
});
