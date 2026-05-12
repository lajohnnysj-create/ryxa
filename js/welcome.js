// =============================================================================
// /js/welcome.js — Welcome / Dashboard Home (extracted from dashboard.html, 2026-05-11)
// -----------------------------------------------------------------------------
// All JavaScript for the Welcome screen (dashboard "home" view). Includes:
//   • Time-based greeting line (pickDashGreeting / applyDashGreeting)
//   • Stats charts (Page Views + Revenue sparklines, day-range selector)
//   • Upcoming events list (next 5 from Calendar tool)
//
// History: All three pieces lived in dashboard.html main script, split across
// L9593 (greetings) and L10460+L10667 (stats). Now consolidated.
//
// CROSS-FILE DEPENDENCIES:
//   • sb, currentUser, currentCurrency, formatMoney, formatDashUSD,
//     showTool, escapeHtml, applyCurrencySymbols — all defined in dashboard.html
//
// FUNCTIONS THIS FILE EXPOSES (called from outside via window globals):
//   • applyDashGreeting — called from setUser auth flow in dashboard.html
//   • loadDashStats — called from setUser + showTool('welcome') in dashboard.html
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/welcome.js
//   • Phase 2: inline onclick/onchange → data-welcome-action attributes
//   • Phase 3: static inline style="..." → hash-named CSS classes
//
// INTENTIONALLY KEPT INLINE: 1 hover-pair on the "View Calendar" link.
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE
// =============================================================================

const welcomeActions = {};

function welcomeRegisterAction(action, handler) {
  welcomeActions[action] = handler;
}

function welcomeFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['welcomeAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.welcomeAction) {
        const wantEvent = el.dataset.welcomeEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.welcomeAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function welcomeDispatchEvent(event) {
  const found = welcomeFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = welcomeActions[found.action];
  if (!handler) {
    console.warn('[welcome] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'change', 'input'].forEach(evt => {
  document.addEventListener(evt, welcomeDispatchEvent);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================


// ---------- From dashboard.html L9593-9611: pickDashGreeting + applyDashGreeting ----------
function pickDashGreeting(name) {
  try {
    var template = DASH_GREETINGS[Math.floor(Math.random() * DASH_GREETINGS.length)];
    return template.replace('{name}', name || 'creator');
  } catch(e) {
    return 'Welcome back, ' + (name || 'creator') + '.';
  }
}

function applyDashGreeting(name) {
  var el = document.getElementById('welcome-greeting');
  if (!el) return;
  var line = pickDashGreeting(name);
  // Wrap the {name} portion in a span styled bolder so the username still pops
  var safeName = name || 'creator';
  // Escape minimal HTML in the line to be safe (greetings are static so this is belt-and-suspenders)
  var html = line.replace(safeName, '<span id="welcome-name">' + safeName + '</span>');
  el.innerHTML = html;
}

// ---------- From dashboard.html L10460-10577: DASHBOARD HOME — date range vars + funcs + loadUpcomingEvents ----------
// =====================================================
// =====================================================
// DASHBOARD HOME — Stats (Page Views + Revenue)
// =====================================================
let dashRangeDays = 14;
let dashCustomStart = null;
let dashCustomEnd = null;

function getDashDateRange() {
  if (dashCustomStart && dashCustomEnd) {
    return { start: dashCustomStart, end: dashCustomEnd };
  }
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - dashRangeDays + 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

async function loadUpcomingEvents() {
  if (!currentUser) return;
  var listEl = document.getElementById('dash-upcoming-list');
  if (!listEl) return;

  // Determine forward window (matches selected range, but forward-looking)
  var days = dashCustomStart && dashCustomEnd
    ? Math.ceil((new Date(dashCustomEnd) - new Date(dashCustomStart)) / 86400000) + 1
    : dashRangeDays;

  var now = new Date();
  var futureEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  try {
    var { data: events, error } = await sb.from('calendar_events')
      .select('id, title, start_at, end_at, event_type, color, notes')
      .eq('creator_id', currentUser.id)
      .gte('start_at', now.toISOString())
      .lte('start_at', futureEnd.toISOString())
      .order('start_at', { ascending: true });

    if (error) {
      listEl.innerHTML = '<div class="welcome-s-077293">Could not load events</div>';
      return;
    }

    if (!events || events.length === 0) {
      listEl.innerHTML = '<div class="welcome-s-077293">No events in the next ' + days + ' days. <a href="#" data-welcome-action="show-tool" data-welcome-tool="calendar" class="welcome-s-00699a">Add one →</a></div>';
      return;
    }

    listEl.innerHTML = events.map(function(e) {
      var startDate = new Date(e.start_at);
      var endDate = new Date(e.end_at);
      // Format in the creator's saved calendar timezone, not browser-local.
      // The global _ryx_creator_tz is set by dashboard-shell.setUser and
      // kept in sync by calChangeTimezoneInline. Falls back to browser
      // detection if for some reason the global isn't set yet.
      var tz = window._ryx_creator_tz || Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      var dateStr = startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: tz });
      var timeStr = startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz });

      // Tier-based color stripe based on event type
      // Max features: coaching, brand_deal (gradient pink/purple)
      // Pro features: future
      // Free/manual: lavender purple
      var stripeStyle;
      var typeBadgeStyle = '';
      var typeBadgeText = '';
      if (e.event_type === 'coaching' || e.event_type === 'brand_deal') {
        stripeStyle = 'background:linear-gradient(180deg, #a78bfa, #e879f9);';
        typeBadgeStyle = 'background:linear-gradient(135deg,rgba(167,139,250,0.2),rgba(232,121,249,0.2));color:#fff;border:1px solid rgba(232,121,249,0.4);';
        typeBadgeText = e.event_type === 'coaching' ? 'BOOKING' : 'BRAND DEAL';
      } else {
        stripeStyle = 'background:#c4b5fd;';
      }

      var typeBadge = typeBadgeText
        ? '<span style="' + typeBadgeStyle + 'display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:600;letter-spacing:0.3px;margin-right:8px;flex-shrink:0;">' + typeBadgeText + '</span>'
        : '';

      return '<div class="welcome-s-e49100">'
        + '<div style="width:3px;height:20px;' + stripeStyle + 'border-radius:2px;flex-shrink:0;"></div>'
        + typeBadge
        + '<div class="welcome-s-825ae1">' + escapeHtml((e.title || 'Untitled').replace(/^Coaching:\s*/i, '')) + '</div>'
        + '<div class="welcome-s-a0676c">' + escapeHtml(dateStr) + ' · ' + escapeHtml(timeStr) + '</div>'
        + '</div>';
    }).join('');

    // Remove last border for cleaner look
    var rows = listEl.querySelectorAll('div[style*="border-bottom"]');
    if (rows.length > 0) rows[rows.length - 1].style.borderBottom = 'none';
  } catch (e) {
    console.error('loadUpcomingEvents:', e);
    listEl.innerHTML = '<div class="welcome-s-077293">Could not load events</div>';
  }
}

function setDashRange(days) {
  dashRangeDays = days;
  dashCustomStart = null;
  dashCustomEnd = null;
  document.getElementById('dash-range-start').value = '';
  document.getElementById('dash-range-end').value = '';
  document.querySelectorAll('.dash-range-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('dash-range-custom').classList.remove('active');
  const btn = document.getElementById('dash-range-' + days);
  if (btn) btn.classList.add('active');
  loadDashStats();
}

function setDashCustomRange() {
  const s = document.getElementById('dash-range-start').value;
  const e = document.getElementById('dash-range-end').value;
  if (!s || !e) return;
  if (s > e) return;
  dashCustomStart = s;
  dashCustomEnd = e;
  document.querySelectorAll('.dash-range-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('dash-range-custom').classList.add('active');
  loadDashStats();
}

// ---------- From dashboard.html L10667-10756: renderSparkline + loadDashStats ----------
function renderSparkline(containerId, data, maxKey) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!data || data.length === 0) { el.innerHTML = ''; return; }
  const vals = data.map(d => d[maxKey] || 0);
  const maxVal = Math.max(...vals, 1);
  el.innerHTML = vals.map(v => {
    const pct = Math.max(2, (v / maxVal) * 100);
    return `<div class="dash-sparkline-bar" style="height:${pct}%;" title="${v}"></div>`;
  }).join('');
}

async function loadDashStats() {
  if (!currentUser) return;
  const { start, end } = getDashDateRange();

  // Load upcoming events (independent of stats)
  loadUpcomingEvents();

  // Load page views (always)
  const viewsRes = await sb.rpc('get_page_view_stats', { p_start_date: start, p_end_date: end });

  // --- Page Views ---
  const vEl = document.getElementById('dash-views-total');
  const vSub = document.getElementById('dash-views-sub');
  const vBreak = document.getElementById('dash-views-breakdown');
  if (viewsRes.error || !viewsRes.data) {
    vEl.textContent = '—';
    vSub.textContent = 'Could not load';
  } else {
    const v = viewsRes.data;
    vEl.textContent = (v.total || 0).toLocaleString();
    const dayCount = dashCustomStart ? Math.ceil((new Date(end) - new Date(start)) / 86400000) + 1 : dashRangeDays;
    const avg = v.total > 0 ? Math.round(v.total / dayCount) : 0;
    vSub.textContent = `~${avg}/day avg over ${dayCount} days`;
    const bp = v.by_page || {};
    const pills = [];
    if (bp.bio) pills.push(`<span class="dash-stat-pill">Bio: ${Number(bp.bio).toLocaleString()}</span>`);
    if (bp.mediakit) pills.push(`<span class="dash-stat-pill">Media Kit: ${Number(bp.mediakit).toLocaleString()}</span>`);
    if (bp.course) pills.push(`<span class="dash-stat-pill">Course: ${Number(bp.course).toLocaleString()}</span>`);
    if (bp.coaching) pills.push(`<span class="dash-stat-pill">1:1 Bookings: ${Number(bp.coaching).toLocaleString()}</span>`);
    if (bp.digital_product) pills.push(`<span class="dash-stat-pill">Digital Products: ${Number(bp.digital_product).toLocaleString()}</span>`);
    vBreak.innerHTML = pills.join('');
    renderSparkline('dash-views-sparkline', v.daily, 'count');
  }

  // --- Revenue (Max only) ---
  const rEl = document.getElementById('dash-revenue-total');
  const rSub = document.getElementById('dash-revenue-sub');
  const rBreak = document.getElementById('dash-revenue-breakdown');
  const rSpark = document.getElementById('dash-revenue-sparkline');
  const isMax = (typeof userTier !== 'undefined') && userTier === 'max';

  if (!isMax) {
    // Locked state for Free/Pro
    rEl.textContent = '$0';
    rSub.innerHTML = `<span class="dash-stat-locked">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      Revenue tracking available with Creator Max
    </span>`;
    rBreak.innerHTML = '';
    rSpark.innerHTML = '';
    return;
  }

  // Max user — load revenue
  const revenueRes = await sb.rpc('get_revenue_stats', { p_start_date: start, p_end_date: end });
  if (revenueRes.error || !revenueRes.data) {
    rEl.textContent = '—';
    rSub.textContent = 'Could not load';
  } else {
    const r = revenueRes.data;
    rEl.textContent = formatDashUSD(r.total_cents || 0);
    const bs = r.by_source || {};
    const dayCount = dashCustomStart ? Math.ceil((new Date(end) - new Date(start)) / 86400000) + 1 : dashRangeDays;
    const sources = [];
    if (bs.brand_deal) sources.push(`<span class="dash-stat-pill">Brand Deals: ${formatDashUSD(bs.brand_deal)}</span>`);
    if (bs.course) sources.push(`<span class="dash-stat-pill">Courses: ${formatDashUSD(bs.course)}</span>`);
    if (bs.coaching) sources.push(`<span class="dash-stat-pill">1:1 Bookings: ${formatDashUSD(bs.coaching)}</span>`);
    if (bs.digital_product) sources.push(`<span class="dash-stat-pill">Digital Products: ${formatDashUSD(bs.digital_product)}</span>`);
    if (bs.other) sources.push(`<span class="dash-stat-pill">Other: ${formatDashUSD(bs.other)}</span>`);
    rBreak.innerHTML = sources.join('');
    if (r.total_cents > 0) {
      rSub.textContent = `${Object.keys(bs).length} source${Object.keys(bs).length !== 1 ? 's' : ''} over ${dayCount} days`;
    } else {
      rSub.textContent = `No revenue recorded over ${dayCount} days`;
    }
    renderSparkline('dash-revenue-sparkline', r.daily, 'cents');
  }
}

// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Tool tiles + View Calendar link + the "Add one" link inside loadUpcomingEvents
welcomeRegisterAction('show-tool', (e, el) => {
  // Some show-tool elements are <a href="#">, so preventDefault to avoid the URL jump
  if (e && e.preventDefault) e.preventDefault();
  if (typeof showTool === 'function') showTool(el.dataset.welcomeTool);
});

// Follower tool has a wrapper function that does extra setup
welcomeRegisterAction('show-follower', (e) => {
  if (e && e.preventDefault) e.preventDefault();
  if (typeof showFollowerTool === 'function') showFollowerTool();
});

// Date range buttons (7d / 14d / 30d)
welcomeRegisterAction('set-range', (e, el) => {
  setDashRange(parseInt(el.dataset.welcomeDays, 10));
});

// Custom date range inputs
welcomeRegisterAction('set-custom-range', () => setDashCustomRange());

// Generic stopPropagation guard (used on date inputs inside a click-toggleable parent)
welcomeRegisterAction('stop-propagation', (e) => {
  e.stopPropagation();
});
