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
  // Compute the window in the creator's calendar timezone (not UTC) so the home
  // dashboard's "last N days" matches the Analytics tool. en-CA yields YYYY-MM-DD;
  // we resolve "today" in their tz, then step back to the window start by date.
  const tz = (typeof window !== 'undefined' && window._ryx_creator_tz) || 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const o = {};
  parts.forEach(function (p) { o[p.type] = p.value; });
  const end = o.year + '-' + o.month + '-' + o.day;
  const d = new Date(end + 'T00:00:00');
  d.setDate(d.getDate() - dashRangeDays + 1);
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const start = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  return { start: start, end: end };
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

// Sparkline renderer for dashboard stat boxes. Produces div-based bars
// (cheaper than canvas, sufficient for this small ambient chart) and
// attaches data-* attributes that the hover tooltip layer below reads.
// kind: 'count' for view bars, 'cents' for revenue bars (drives formatting).
function renderSparkline(containerId, data, kind) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!data || data.length === 0) { el.innerHTML = ''; return; }
  const vals = data.map(d => d[kind] || 0);
  const maxVal = Math.max(...vals, 1);
  el.innerHTML = data.map((d, i) => {
    const v = d[kind] || 0;
    const pct = Math.max(2, (v / maxVal) * 100);
    // data-* values escape via attribute-value normalization; numeric values
    // and ISO date strings are safe. No user-supplied content goes here.
    return `<div class="dash-sparkline-bar" style="height:${pct}%;" data-spark-value="${v}" data-spark-date="${d.date || ''}" data-spark-kind="${kind}"></div>`;
  }).join('');
  // Hook up the hover tooltip once per container. Idempotent — re-renders
  // wipe innerHTML but the parent listener stays attached.
  attachSparklineTooltip(el);
}

// One tooltip div per sparkline container, lazily created on first hover.
// Uses event delegation on the container so we don't have to wire up N
// individual bar listeners on every re-render. Hidden by default, shown on
// bar enter/move, hidden on container leave.
//
// Important: the bar render path does `el.innerHTML = ...` which wipes any
// previously-created tip child. We track the tip per container and re-append
// it on every call (cheap) so re-renders (date range change) don't break the
// tooltip on subsequent hovers.
function attachSparklineTooltip(container) {
  // Create the tip once and keep a reference on the container. On subsequent
  // calls we just re-append (since innerHTML wiped it out from the DOM).
  var tip = container._dashSparkTip;
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'dash-spark-tip';
    tip.setAttribute('role', 'tooltip');
    tip.style.display = 'none';
    container._dashSparkTip = tip;
  } else {
    tip.style.display = 'none'; // hide if it was visible during the re-render
  }
  container.appendChild(tip);

  // Bind listeners only once per container. Subsequent calls to this function
  // (on re-render) skip the listener-attach but still re-append the tip above.
  if (container._dashSparkBound) return;
  container._dashSparkBound = true;

  function formatTipDate(iso) {
    if (!iso) return '';
    // Parse YYYY-MM-DD as local-time midnight to avoid the classic
    // "shows yesterday" UTC-shift bug. We're displaying dates in the
    // creator's tz; the input is a calendar date, not an instant.
    var parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    try {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return iso; }
  }

  function formatTipValue(v, kind) {
    var n = Number(v) || 0;
    if (kind === 'cents') {
      // Reuse the dashboard's USD formatter for consistency with the
      // breakdown pills below the sparkline.
      try { return formatDashUSD(n); } catch (e) {
        return '$' + (n / 100).toFixed(2);
      }
    }
    return n.toLocaleString() + ' view' + (n === 1 ? '' : 's');
  }

  container.addEventListener('mousemove', function(e) {
    // Find which COLUMN the cursor is over by X position, rather than which
    // bar the cursor is directly on. Previously we required hovering on the
    // bar itself, which made low-value days (tiny bars) hard to hit — a $1
    // day next to a $40 day rendered at ~2.5% height was almost untargetable.
    // Now hovering anywhere in the column's vertical strip selects that day.
    var bars = container.querySelectorAll('.dash-sparkline-bar');
    if (bars.length === 0) {
      tip.style.display = 'none';
      return;
    }
    var contRect = container.getBoundingClientRect();
    var relX = e.clientX - contRect.left;
    // Clamp to container so edge moves don't go out of range
    relX = Math.max(0, Math.min(contRect.width - 1, relX));
    // Bars are equal-width via flex:1 with gap:2px. Computing the index from
    // proportional X position is robust — works regardless of the exact gap
    // because the column "claim" includes half of each adjacent gap.
    var idx = Math.floor((relX / contRect.width) * bars.length);
    if (idx < 0) idx = 0;
    if (idx >= bars.length) idx = bars.length - 1;
    var bar = bars[idx];
    if (!bar) {
      tip.style.display = 'none';
      return;
    }

    // Highlight the active column so the user has a visual anchor — without
    // this, hovering over a small bar from above shows the tip but it's
    // unclear WHICH bar you're reading. The .dash-sparkline-bar-active class
    // brightens the matched bar.
    var prevActive = container.querySelector('.dash-sparkline-bar.dash-sparkline-bar-active');
    if (prevActive && prevActive !== bar) prevActive.classList.remove('dash-sparkline-bar-active');
    bar.classList.add('dash-sparkline-bar-active');

    var v = bar.getAttribute('data-spark-value');
    var date = bar.getAttribute('data-spark-date');
    var kind = bar.getAttribute('data-spark-kind') || 'count';
    tip.innerHTML = '<div class="dash-spark-tip-val">' + formatTipValue(v, kind) + '</div>'
      + '<div class="dash-spark-tip-date">' + formatTipDate(date) + '</div>';
    tip.style.display = 'block';
    // Position the tip above the matched bar (not the cursor), so visual
    // association stays clear when the cursor is in empty space above a
    // small bar. Clamp to container bounds.
    var barRect = bar.getBoundingClientRect();
    var centerX = barRect.left + barRect.width / 2 - contRect.left;
    var tipHalf = 60;
    var clampedX = Math.max(tipHalf, Math.min(contRect.width - tipHalf, centerX));
    tip.style.left = clampedX + 'px';
    tip.style.top = '0px';
  });

  container.addEventListener('mouseleave', function() {
    tip.style.display = 'none';
    // Clean up the active-bar highlight so the chart doesn't keep a stale
    // "selected" bar after the user moves away.
    var active = container.querySelector('.dash-sparkline-bar.dash-sparkline-bar-active');
    if (active) active.classList.remove('dash-sparkline-bar-active');
  });
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
  const revenueRes = await sb.rpc('get_revenue_stats', { p_start_date: start, p_end_date: end, p_tz: window._ryx_creator_tz || 'UTC' });
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
    if (bs.tip) sources.push(`<span class="dash-stat-pill">Coffee Tips: ${formatDashUSD(bs.tip)}</span>`);
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
