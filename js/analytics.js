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
        sales.push({ date: d.received_at, buyer: d.counterparty_name || '—', product: 'Brand Deal', type: 'Brand Deal', amount: d.amount_cents || 0 });
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
anaRegisterAction('sales-page', (e, el) => {
  const dir = parseInt(el.dataset.anaDir, 10);
  anaSalesPage(dir);
});

