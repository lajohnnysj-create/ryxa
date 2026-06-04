// =============================================================================
// /js/analytics.js — Analytics tool (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Analytics tool (Max tier). Extracted from
// dashboard.html for stricter CSP.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/analytics.js
//   • Phase 2: replaced inline onclick with data-ana-action attributes
//   • Phase 3: replaced inline class="bio-s-6eae3a" with hash-named CSS classes
//
// External dependencies remain on window (sb, Auth, currentUser, isMax,
// escapeHtml, formatMoney, etc).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE (parallel of other tools)
// =============================================================================

const anaActions = {};

function anaRegisterAction(action, handler) {
  anaActions[action] = handler;
}

function anaFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['anaAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.anaAction) {
        const wantEvent = el.dataset.anaEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.anaAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function anaDispatchEvent(event) {
  const found = anaFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = anaActions[found.action];
  if (!handler) {
    console.warn('[ana] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, anaDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 16993-17402 (Analytics) ----------
// =====================================================
// ANALYTICS
// =====================================================
let anaRangeDays = 7;
let anaCustomStart = null;
let anaCustomEnd = null;

function getAnaDateRange() {
  if (anaCustomStart && anaCustomEnd) return { start: anaCustomStart, end: anaCustomEnd };
  const end = new Date(); const start = new Date();
  start.setDate(start.getDate() - anaRangeDays + 1);
  return { start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10) };
}

function setAnalyticsRange(days, btn) {
  anaRangeDays = days;
  anaCustomStart = null; anaCustomEnd = null;
  document.querySelectorAll('.ana-range-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadAnalyticsData();
}

function setAnalyticsCustomRange() {
  const s = document.getElementById('ana-range-start').value;
  const e = document.getElementById('ana-range-end').value;
  if (!s || !e || s > e) return;
  anaCustomStart = s; anaCustomEnd = e;
  document.querySelectorAll('.ana-range-btn').forEach(b => b.classList.remove('active'));
  loadAnalyticsData();
}

function initAnalyticsTool() {
  const isMax = userTier === 'max';
  document.getElementById('analytics-upsell').style.display = isMax ? 'none' : 'block';
  document.getElementById('analytics-content').style.display = isMax ? 'block' : 'none';
  if (isMax) loadAnalyticsData();
}

function initThumbanalyzerTool() {
  const pro = typeof isPro === 'function' && isPro();
  document.getElementById('thumbanalyzer-upsell').style.display = pro ? 'none' : 'block';
  document.getElementById('thumbanalyzer-content').style.display = pro ? 'block' : 'none';
}

function initContractanalyzerTool() {
  const pro = typeof isPro === 'function' && isPro();
  document.getElementById('contractanalyzer-upsell').style.display = pro ? 'none' : 'block';
  document.getElementById('contractanalyzer-content').style.display = pro ? 'block' : 'none';
}

async function loadAnalyticsData() {
  if (!currentUser) return;
  const { start, end } = getAnaDateRange();
  const dayCount = anaCustomStart ? Math.ceil((new Date(end) - new Date(start)) / 86400000) + 1 : anaRangeDays;

  // Load page views
  const viewsRes = await sb.rpc('get_page_view_stats', { p_start_date: start, p_end_date: end });
  const vTotal = document.getElementById('ana-views-total');
  const vSub = document.getElementById('ana-views-sub');
  let viewsDaily = [];
  if (!viewsRes.error && viewsRes.data) {
    const v = viewsRes.data;
    vTotal.textContent = (v.total || 0).toLocaleString();
    const avg = v.total > 0 ? Math.round(v.total / dayCount) : 0;
    vSub.textContent = '~' + avg + '/day avg over ' + dayCount + ' days';
    viewsDaily = v.daily || [];
  } else {
    vTotal.textContent = '—'; vSub.textContent = 'Could not load';
  }

  // Load revenue
  const revRes = await sb.rpc('get_revenue_stats', { p_start_date: start, p_end_date: end });
  const rTotal = document.getElementById('ana-revenue-total');
  const rSub = document.getElementById('ana-revenue-sub');
  let revDaily = [];
  let bySource = {};
  if (!revRes.error && revRes.data) {
    const r = revRes.data;
    rTotal.textContent = formatDashUSD(r.total_cents || 0);
    rSub.textContent = (r.total_cents > 0 ? Object.keys(r.by_source || {}).length + ' source(s)' : 'No revenue') + ' over ' + dayCount + ' days';
    revDaily = r.daily || [];
    bySource = r.by_source || {};
  } else {
    rTotal.textContent = '—'; rSub.textContent = 'Could not load';
  }

  // Mini chart totals
  document.getElementById('ana-courses-total').textContent = formatDashUSD(bySource.course || 0);
  document.getElementById('ana-coaching-total').textContent = formatDashUSD(bySource.coaching || 0);
  document.getElementById('ana-dp-total').textContent = formatDashUSD(bySource.digital_product || 0);
  document.getElementById('ana-deals-total').textContent = formatDashUSD(bySource.brand_deal || 0);

  // Page view totals by source
  const byPage = (viewsRes && !viewsRes.error && viewsRes.data) ? (viewsRes.data.by_page || {}) : {};
  document.getElementById('ana-pv-bio-total').textContent = (byPage.bio || 0).toLocaleString();
  document.getElementById('ana-pv-courses-total').textContent = (byPage.course || 0).toLocaleString();
  document.getElementById('ana-pv-coaching-total').textContent = (byPage.coaching || 0).toLocaleString();
  document.getElementById('ana-pv-dp-total').textContent = (byPage.digital_product || 0).toLocaleString();
  document.getElementById('ana-pv-mediakit-total').textContent = (byPage.mediakit || 0).toLocaleString();

  // Render main chart (dual line)
  renderAnaLineChart('ana-main-chart', viewsDaily, revDaily, dayCount);

  // Render revenue mini charts
  renderAnaMiniChart('ana-courses-chart', revDaily, 'course', '#a78bfa');
  renderAnaMiniChart('ana-coaching-chart', revDaily, 'coaching', '#e879f9');
  renderAnaMiniChart('ana-dp-chart', revDaily, 'digital_product', '#f0abfc');
  renderAnaMiniChart('ana-deals-chart', revDaily, 'brand_deal', '#7c3aed');

  // Render page view mini charts (uses overall daily views as trend line)
  renderAnaMiniChart('ana-pv-bio-chart', viewsDaily, 'count', '#e879f9');
  renderAnaMiniChart('ana-pv-courses-chart', viewsDaily, 'count', '#a78bfa');
  renderAnaMiniChart('ana-pv-coaching-chart', viewsDaily, 'count', '#c084fc');
  renderAnaMiniChart('ana-pv-dp-chart', viewsDaily, 'count', '#f0abfc');
  renderAnaMiniChart('ana-pv-mediakit-chart', viewsDaily, 'count', '#818cf8');

  // Load latest sales
  anaSalesAllData = [];
  anaSalesCurrentPage = 0;
  loadAnalyticsSales(start, end);
  loadProductPerformance(start, end);
}

var anaSalesAllData = [];
var anaSalesCurrentPage = 0;
var ANA_SALES_PER_PAGE = 50;

function anaSalesPage(dir) {
  var maxPage = Math.floor((anaSalesAllData.length - 1) / ANA_SALES_PER_PAGE);
  anaSalesCurrentPage = Math.max(0, Math.min(maxPage, anaSalesCurrentPage + dir));
  renderAnalyticsSalesPage();
}

function renderAnalyticsSalesPage() {
  var tbody = document.getElementById('ana-sales-tbody');
  if (!tbody) return;
  var start = anaSalesCurrentPage * ANA_SALES_PER_PAGE;
  var page = anaSalesAllData.slice(start, start + ANA_SALES_PER_PAGE);
  var maxPage = Math.floor((anaSalesAllData.length - 1) / ANA_SALES_PER_PAGE);

  tbody.innerHTML = page.map(function(s) {
    var d = new Date(s.date);
    var date = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
    var buyer = s.buyer;
    var amount = formatMoney(s.amount, {alwaysShowCents:true});
    var pillStyle = '';
    if (s.type === 'Course') pillStyle = 'background:rgba(167,139,250,0.15);color:#c4b5fd;';
    else if (s.type === 'Booking') pillStyle = 'background:rgba(232,121,249,0.15);color:#e879f9;';
    else pillStyle = 'background:rgba(124,58,237,0.15);color:#a78bfa;';
    return '<tr class="ana-s-a56f95">'
      + '<td class="ana-s-14ba36">' + date + '</td>'
      + '<td class="ana-s-46cd6d">' + buyer + '</td>'
      + '<td class="ana-s-695113">' + s.product + '</td>'
      + '<td class="ana-s-a49932"><span style="padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;' + pillStyle + '">' + s.type + '</span></td>'
      + '<td class="ana-s-986abe">' + amount + '</td>'
      + '</tr>';
  }).join('');

  // Pagination controls
  var pagination = document.getElementById('ana-sales-pagination');
  if (anaSalesAllData.length > ANA_SALES_PER_PAGE) {
    pagination.style.display = 'flex';
    document.getElementById('ana-sales-prev').style.visibility = anaSalesCurrentPage > 0 ? 'visible' : 'hidden';
    document.getElementById('ana-sales-next').style.visibility = anaSalesCurrentPage < maxPage ? 'visible' : 'hidden';
    document.getElementById('ana-sales-page-info').textContent = (start + 1) + '–' + Math.min(start + ANA_SALES_PER_PAGE, anaSalesAllData.length) + ' of ' + anaSalesAllData.length;
  } else {
    pagination.style.display = 'none';
  }
}

async function loadAnalyticsSales(start, end) {
  const tbody = document.getElementById('ana-sales-tbody');
  if (!tbody || !currentUser) return;
  tbody.innerHTML = '<tr><td colspan="5" class="ana-s-cd4491">Loading...</td></tr>';
  document.getElementById('ana-sales-pagination').style.display = 'none';
  try {
    const sales = [];

    // Fetch course enrollments with course title
    const { data: enrollments } = await sb
      .from('course_enrollments')
      .select('enrolled_at, amount_paid_cents, user_id, course_id, courses(title, user_id)')
      .eq('courses.user_id', currentUser.id)
      .gte('enrolled_at', start + 'T00:00:00')
      .lte('enrolled_at', end + 'T23:59:59')
      .order('enrolled_at', { ascending: false });
    if (enrollments) {
      enrollments.forEach(function(e) {
        if (!e.courses || e.courses.user_id !== currentUser.id) return;
        sales.push({ date: e.enrolled_at, buyer: e.user_id, product: e.courses.title || 'Untitled Course', type: 'Course', amount: e.amount_paid_cents || 0 });
      });
    }

    // Fetch coaching bookings with coaching title
    const { data: bookings } = await sb
      .from('coaching_bookings')
      .select('booked_at, amount_paid_cents, buyer_email, coaching_id, coaching_services(title, user_id)')
      .eq('coaching_services.user_id', currentUser.id)
      .gte('booked_at', start + 'T00:00:00')
      .lte('booked_at', end + 'T23:59:59')
      .order('booked_at', { ascending: false });
    if (bookings) {
      bookings.forEach(function(b) {
        if (!b.coaching_services || b.coaching_services.user_id !== currentUser.id) return;
        sales.push({ date: b.booked_at, buyer: b.buyer_email || '—', product: b.coaching_services.title || '1:1 Booking', type: 'Booking', amount: b.amount_paid_cents || 0 });
      });
    }

    // Fetch digital product purchases
    const { data: dpPurchases } = await sb
      .from('digital_product_purchases')
      .select('purchased_at, amount_cents, buyer_email, status, product_id, digital_products(title, user_id)')
      .eq('digital_products.user_id', currentUser.id)
      .eq('status', 'completed')
      .gte('purchased_at', start + 'T00:00:00')
      .lte('purchased_at', end + 'T23:59:59')
      .order('purchased_at', { ascending: false });
    if (dpPurchases) {
      dpPurchases.forEach(function(p) {
        if (!p.digital_products || p.digital_products.user_id !== currentUser.id) return;
        sales.push({ date: p.purchased_at, buyer: p.buyer_email || '—', product: p.digital_products.title || 'Digital Product', type: 'Digital', amount: p.amount_cents || 0 });
      });
    }

    // Fetch brand deal revenue
    const { data: deals } = await sb
      .from('revenue_events')
      .select('received_at, amount_cents, counterparty_name, source')
      .eq('user_id', currentUser.id)
      .eq('source', 'brand_deal')
      .gte('received_at', start + 'T00:00:00')
      .lte('received_at', end + 'T23:59:59')
      .order('received_at', { ascending: false });
    if (deals) {
      deals.forEach(function(d) {
        sales.push({ date: d.received_at, buyer: d.counterparty_name || '—', product: 'Brand Deal', type: 'Brand', amount: d.amount_cents || 0 });
      });
    }

    // Sort by date descending
    sales.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

    if (sales.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="ana-s-cd4491">No earnings in this period</td></tr>';
      return;
    }

    // For course enrollments, buyer is a user_id — resolve usernames
    const buyerIds = sales.filter(function(s) { return s.type === 'Course' && s.buyer && s.buyer.length > 20; }).map(function(s) { return s.buyer; });
    if (buyerIds.length > 0) {
      const { data: profiles } = await sb
        .from('public_profiles')
        .select('user_id, username')
        .in('user_id', buyerIds);
      if (profiles) {
        var emailMap = {};
        profiles.forEach(function(p) { emailMap[p.user_id] = p.username || p.user_id.slice(0, 8); });
        sales.forEach(function(s) {
          if (s.type === 'Course' && emailMap[s.buyer]) s.buyer = emailMap[s.buyer];
          else if (s.type === 'Course' && s.buyer.length > 20) s.buyer = s.buyer.slice(0, 8) + '...';
        });
      }
    }

    anaSalesAllData = sales;
    anaSalesCurrentPage = 0;
    renderAnalyticsSalesPage();
  } catch (e) {
    console.error('Sales load error:', e);
    tbody.innerHTML = '<tr><td colspan="5" class="ana-s-cd4491">Could not load earnings</td></tr>';
  }
}

async function loadProductPerformance(start, end) {
  const tbody = document.getElementById('ana-product-perf-tbody');
  if (!tbody || !currentUser) return;
  tbody.innerHTML = '<tr><td colspan="6" class="ana-s-cd4491">Loading...</td></tr>';
  try {
    const products = [];

    // Get creator's courses
    const { data: courses } = await sb
      .from('courses')
      .select('id, title, price_cents')
      .eq('user_id', currentUser.id);

    if (courses && courses.length > 0) {
      for (const course of courses) {
        // Get enrollments for this course in date range
        const { data: enrollments, count: orderCount } = await sb
          .from('course_enrollments')
          .select('amount_paid_cents', { count: 'exact' })
          .eq('course_id', course.id)
          .gte('enrolled_at', start + 'T00:00:00')
          .lte('enrolled_at', end + 'T23:59:59');

        const orders = orderCount || 0;
        const revenue = enrollments ? enrollments.reduce(function(sum, e) { return sum + (e.amount_paid_cents || 0); }, 0) : 0;

        // Get per-product page views
        const { data: viewRows } = await sb
          .from('page_view_counts')
          .select('view_count')
          .eq('user_id', currentUser.id)
          .eq('page_type', 'course')
          .eq('product_id', course.id)
          .gte('view_date', start)
          .lte('view_date', end);
        const views = viewRows ? viewRows.reduce(function(sum, r) { return sum + (r.view_count || 0); }, 0) : 0;

        products.push({ title: course.title || 'Untitled Course', type: 'Course', views: views, orders: orders, revenue: revenue });
      }
    }

    // Get creator's coaching services
    const { data: services } = await sb
      .from('coaching_services')
      .select('id, title, price_cents')
      .eq('user_id', currentUser.id);

    if (services && services.length > 0) {
      for (const svc of services) {
        const { data: bookings, count: bookCount } = await sb
          .from('coaching_bookings')
          .select('amount_paid_cents', { count: 'exact' })
          .eq('coaching_id', svc.id)
          .gte('booked_at', start + 'T00:00:00')
          .lte('booked_at', end + 'T23:59:59');

        const orders = bookCount || 0;
        const revenue = bookings ? bookings.reduce(function(sum, b) { return sum + (b.amount_paid_cents || 0); }, 0) : 0;

        const { data: viewRows } = await sb
          .from('page_view_counts')
          .select('view_count')
          .eq('user_id', currentUser.id)
          .eq('page_type', 'coaching')
          .eq('product_id', svc.id)
          .gte('view_date', start)
          .lte('view_date', end);
        const views = viewRows ? viewRows.reduce(function(sum, r) { return sum + (r.view_count || 0); }, 0) : 0;

        products.push({ title: svc.title || '1:1 Booking', type: 'Booking', views: views, orders: orders, revenue: revenue });
      }
    }

    // Get creator's digital products
    const { data: digitalProducts } = await sb
      .from('digital_products')
      .select('id, title, price_cents')
      .eq('user_id', currentUser.id);

    if (digitalProducts && digitalProducts.length > 0) {
      for (const dp of digitalProducts) {
        const { data: dpPurchases, count: dpCount } = await sb
          .from('digital_product_purchases')
          .select('amount_cents', { count: 'exact' })
          .eq('product_id', dp.id)
          .eq('status', 'completed')
          .gte('purchased_at', start + 'T00:00:00')
          .lte('purchased_at', end + 'T23:59:59');

        const orders = dpCount || 0;
        const revenue = dpPurchases ? dpPurchases.reduce(function(sum, p) { return sum + (p.amount_cents || 0); }, 0) : 0;

        const { data: viewRows } = await sb
          .from('page_view_counts')
          .select('view_count')
          .eq('user_id', currentUser.id)
          .eq('page_type', 'digital_product')
          .eq('product_id', dp.id)
          .gte('view_date', start)
          .lte('view_date', end);
        const views = viewRows ? viewRows.reduce(function(sum, r) { return sum + (r.view_count || 0); }, 0) : 0;

        products.push({ title: dp.title || 'Digital Product', type: 'Digital', views: views, orders: orders, revenue: revenue });
      }
    }

    if (products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="ana-s-cd4491">No products found</td></tr>';
      return;
    }

    // Sort by revenue descending
    products.sort(function(a, b) { return b.revenue - a.revenue; });

    tbody.innerHTML = products.map(function(p) {
      var convRate = p.views > 0 ? ((p.orders / p.views) * 100).toFixed(1) + '%' : '—';
      var viewsText = p.views > 0 ? p.views.toLocaleString() : '0';
      var amount = formatMoney(p.revenue, {alwaysShowCents:true});
      var pillStyle;
      if (p.type === 'Course') pillStyle = 'background:rgba(167,139,250,0.15);color:#c4b5fd;';
      else if (p.type === 'Booking') pillStyle = 'background:rgba(232,121,249,0.15);color:#e879f9;';
      else if (p.type === 'Digital') pillStyle = 'background:rgba(240,171,252,0.15);color:#f0abfc;';
      else pillStyle = 'background:rgba(124,58,237,0.15);color:#c4b5fd;';
      return '<tr class="ana-s-a56f95">'
        + '<td class="ana-s-695113">' + p.title + '</td>'
        + '<td class="ana-s-a49932"><span style="padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;' + pillStyle + '">' + p.type + '</span></td>'
        + '<td class="ana-s-1d36bf">' + viewsText + '</td>'
        + '<td class="ana-s-82645b">' + p.orders + '</td>'
        + '<td class="ana-s-1d36bf">' + convRate + '</td>'
        + '<td class="ana-s-986abe">' + amount + '</td>'
        + '</tr>';
    }).join('');
  } catch (e) {
    console.error('Product performance error:', e);
    tbody.innerHTML = '<tr><td colspan="6" class="ana-s-cd4491">Could not load product data</td></tr>';
  }
}


// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

anaRegisterAction('max-upgrade', (e) => handleMaxUpgradeClick(e));
anaRegisterAction('set-range', (e, el) => {
  const days = parseInt(el.dataset.anaDays, 10);
  setAnalyticsRange(days, el);
});
anaRegisterAction('set-custom-range', () => setAnalyticsCustomRange());
anaRegisterAction('refresh', async (e, el) => {
  if (el) { el.classList.add('is-refreshing'); el.disabled = true; }
  try {
    await Promise.all([loadAnalyticsData(), new Promise(r => setTimeout(r, 450))]);
  } catch (err) {
    console.error('Analytics refresh failed:', err);
  } finally {
    if (el) { el.classList.remove('is-refreshing'); el.disabled = false; }
  }
});
anaRegisterAction('sales-page', (e, el) => {
  const dir = parseInt(el.dataset.anaDir, 10);
  anaSalesPage(dir);
});



// =============================================================================
// CHART RENDERERS
// -----------------------------------------------------------------------------
// renderAnaLineChart  — main Page Views + Revenue chart at the top
// renderAnaMiniChart  — small revenue/views sparklines on category cards
//
// Moved here from dashboard.html (2026-05-11). Previously these lived in a
// stray <script> block at the bottom of dashboard.html — leftover from the
// follower-audit refactor that should have been moved with the analytics tool.
// =============================================================================

function renderAnaLineChart(canvasId, viewsDaily, revDaily, dayCount) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const tooltip = document.getElementById('ana-main-tooltip');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth; const h = canvas.offsetHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const vVals = new Array(dayCount).fill(0);
  const rVals = new Array(dayCount).fill(0);
  const dates = [];
  const { start } = getAnaDateRange();
  const startDate = new Date(start + 'T00:00:00');

  for (let i = 0; i < dayCount; i++) {
    const d = new Date(startDate); d.setDate(d.getDate() + i);
    dates.push((d.getMonth() + 1) + '/' + d.getDate());
  }

  (viewsDaily || []).forEach(d => {
    const idx = Math.round((new Date(d.date + 'T00:00:00') - startDate) / 86400000);
    if (idx >= 0 && idx < dayCount) vVals[idx] = d.count || 0;
  });
  (revDaily || []).forEach(d => {
    const idx = Math.round((new Date(d.date + 'T00:00:00') - startDate) / 86400000);
    if (idx >= 0 && idx < dayCount) rVals[idx] = (d.cents || 0) / 100;
  });

  const pad = { top: 10, right: 10, bottom: 20, left: 10 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const vMax = Math.max(...vVals, 1);
  const rMax = Math.max(...rVals, 1);

  function getX(i) { return pad.left + (i / Math.max(dayCount - 1, 1)) * cw; }
  function getVY(v) { return pad.top + ch - (v / vMax) * ch; }
  function getRY(v) { return pad.top + ch - (v / rMax) * ch; }

  function draw(hoverIdx) {
    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = pad.top + (i / 3) * ch;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
    }

    // Date labels
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '9px DM Sans, sans-serif'; ctx.textAlign = 'center';
    const labelCount = Math.min(dayCount, 7);
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.round(i * (dayCount - 1) / Math.max(labelCount - 1, 1));
      ctx.fillText(dates[idx], getX(idx), h - 4);
    }

    // Views line + fill
    ctx.beginPath(); ctx.strokeStyle = 'rgba(232,121,249,1)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    vVals.forEach((v, i) => { const x = getX(i), y = getVY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();
    ctx.lineTo(getX(dayCount - 1), pad.top + ch); ctx.lineTo(getX(0), pad.top + ch); ctx.closePath();
    ctx.fillStyle = 'rgba(232,121,249,0.06)'; ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1;

    // Revenue line + fill
    ctx.beginPath(); ctx.strokeStyle = 'rgba(124,58,237,1)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    rVals.forEach((v, i) => { const x = getX(i), y = getRY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();
    ctx.lineTo(getX(dayCount - 1), pad.top + ch); ctx.lineTo(getX(0), pad.top + ch); ctx.closePath();
    ctx.fillStyle = 'rgba(124,58,237,0.06)'; ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1;

    // Hover
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < dayCount) {
      const hx = getX(hoverIdx);
      ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]); ctx.moveTo(hx, pad.top); ctx.lineTo(hx, pad.top + ch); ctx.stroke(); ctx.setLineDash([]);

      const vy = getVY(vVals[hoverIdx]); const ry = getRY(rVals[hoverIdx]);
      [{ y: vy, c: '#e879f9' }, { y: ry, c: '#7c3aed' }].forEach(dot => {
        ctx.beginPath(); ctx.arc(hx, dot.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = dot.c; ctx.fill(); ctx.strokeStyle = '#0a0a14'; ctx.lineWidth = 2; ctx.stroke();
      });

      // HTML tooltip
      if (tooltip) {
        tooltip.style.display = 'block';
        tooltip.innerHTML = '<div style="color:rgba(255,255,255,0.5);margin-bottom:4px;">' + dates[hoverIdx] + '</div>'
          + '<div style="color:#e879f9;">' + vVals[hoverIdx].toLocaleString() + ' views</div>'
          + '<div style="color:#a78bfa;">$' + rVals[hoverIdx].toLocaleString() + '</div>';
        let tx = hx - tooltip.offsetWidth / 2;
        if (tx < 0) tx = 0;
        if (tx + tooltip.offsetWidth > w) tx = w - tooltip.offsetWidth;
        tooltip.style.left = tx + 'px';
        tooltip.style.bottom = (h - Math.min(vy, ry) + 10) + 'px';
        tooltip.style.top = 'auto';
      }
    } else if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  draw(null);

  function getHoverIdx(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    return Math.round(((mx - pad.left) / cw) * (dayCount - 1));
  }

  canvas.onmousemove = function(e) { draw(getHoverIdx(e)); };
  canvas.onmouseleave = function() { draw(null); };
  canvas.ontouchmove = function(e) { e.preventDefault(); draw(getHoverIdx(e.touches[0])); };
  canvas.ontouchend = function() { draw(null); };
  canvas.style.cursor = 'crosshair';
}

function renderAnaMiniChart(canvasId, dailyData, valKey, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const tipEl = document.getElementById(canvasId + '-tip');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth; const h = canvas.offsetHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const { start } = getAnaDateRange();
  const startDate = new Date(start + 'T00:00:00');
  const dayCount = anaCustomStart ? Math.ceil((new Date(getAnaDateRange().end) - startDate) / 86400000) + 1 : anaRangeDays;
  const vals = new Array(dayCount).fill(0);
  const dates = [];

  for (let i = 0; i < dayCount; i++) {
    const d = new Date(startDate); d.setDate(d.getDate() + i);
    dates.push((d.getMonth() + 1) + '/' + d.getDate());
  }

  const isCurrency = (valKey === 'cents' || valKey === 'course' || valKey === 'coaching' || valKey === 'brand_deal');
  (dailyData || []).forEach(d => {
    const idx = Math.round((new Date(d.date + 'T00:00:00') - startDate) / 86400000);
    if (idx >= 0 && idx < dayCount) vals[idx] = isCurrency ? (d.cents || 0) / 100 : (d[valKey] || 0);
  });

  const maxV = Math.max(...vals, 1);
  const p = 4;
  const cw = w - p * 2; const ch = h - p * 2;

  function getX(i) { return p + (i / Math.max(dayCount - 1, 1)) * cw; }
  function getY(v) { return p + ch - (v / maxV) * ch; }

  function draw(hoverIdx) {
    ctx.clearRect(0, 0, w, h);

    // Area fill
    ctx.beginPath();
    vals.forEach((v, i) => { const x = getX(i), y = getY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.lineTo(getX(dayCount - 1), p + ch); ctx.lineTo(getX(0), p + ch); ctx.closePath();
    ctx.fillStyle = color + '15'; ctx.fill();

    // Line
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    vals.forEach((v, i) => { const x = getX(i), y = getY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();

    // Hover
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < dayCount) {
      const hx = getX(hoverIdx); const hy = getY(vals[hoverIdx]);
      ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#0a0a14'; ctx.lineWidth = 1.5; ctx.stroke();

      if (tipEl) {
        const valText = isCurrency ? formatMoney(Math.round(vals[hoverIdx] * 100), {fractionDigits:0}) : vals[hoverIdx].toLocaleString();
        tipEl.style.display = 'block';
        tipEl.innerHTML = '<span style="color:rgba(255,255,255,0.5);">' + dates[hoverIdx] + '</span> <span style="color:' + color + ';font-weight:600;">' + valText + '</span>';
        let tx = hx - tipEl.offsetWidth / 2;
        if (tx < 0) tx = 0;
        if (tx + tipEl.offsetWidth > w) tx = w - tipEl.offsetWidth;
        tipEl.style.left = tx + 'px';
        tipEl.style.bottom = (h - hy + 8) + 'px';
        tipEl.style.top = 'auto';
      }
    } else if (tipEl) {
      tipEl.style.display = 'none';
    }
  }

  draw(null);

  function getHoverIdx(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    return Math.round(((mx - p) / cw) * (dayCount - 1));
  }

  canvas.onmousemove = function(e) { draw(getHoverIdx(e)); };
  canvas.onmouseleave = function() { draw(null); };
  canvas.ontouchmove = function(e) { e.preventDefault(); draw(getHoverIdx(e.touches[0])); };
  canvas.ontouchend = function() { draw(null); };
  canvas.style.cursor = 'crosshair';
}
