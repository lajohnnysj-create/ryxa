// =====================================================
// LINK IN BIO — CLICK ANALYTICS (Creator Pro + Max)
// Separate from the page-view/revenue Analytics tool. Shows clicks on links,
// featured links, hero, and social icons. Data flows in via record_link_click
// on the public bio page; reads come from get_link_click_stats (scoped to the
// signed-in creator). Click rate uses bio views from get_page_view_stats.
// =====================================================

let banRangeDays = 7;
let banCustomStart = null;
let banCustomEnd = null;
let banWired = false;

function getBanDateRange() {
  const end = new Date();
  const endStr = end.toISOString().slice(0, 10);
  if (banCustomStart && banCustomEnd) {
    return { start: banCustomStart, end: banCustomEnd, custom: true };
  }
  const start = new Date();
  start.setDate(start.getDate() - banRangeDays + 1);
  return { start: start.toISOString().slice(0, 10), end: endStr, custom: false };
}

function initBioAnalyticsTool() {
  const pro = typeof isPro === 'function' && isPro();
  const up = document.getElementById('ban-upsell');
  const content = document.getElementById('ban-content');
  if (up) up.style.display = pro ? 'none' : 'block';
  if (content) content.style.display = pro ? 'block' : 'none';
  if (!pro) return;

  // Wire the range controls once.
  if (!banWired) {
    banWired = true;
    document.querySelectorAll('#tool-bio-analytics [data-ban-days]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        banRangeDays = parseInt(btn.getAttribute('data-ban-days'), 10) || 7;
        banCustomStart = null; banCustomEnd = null;
        document.querySelectorAll('#tool-bio-analytics .ana-range-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        loadBioAnalyticsData();
      });
    });
    const goBtn = document.getElementById('ban-range-go');
    if (goBtn) goBtn.addEventListener('click', setBanCustomRange);
  }
  loadBioAnalyticsData();
}

function setBanCustomRange() {
  const sEl = document.getElementById('ban-range-start');
  const eEl = document.getElementById('ban-range-end');
  if (!sEl || !eEl) return;
  const sv = sEl.value, ev = eEl.value;
  if (!sv || !ev || sv > ev) return;
  banCustomStart = sv;
  banCustomEnd = ev;
  document.querySelectorAll('#tool-bio-analytics .ana-range-btn').forEach(function (b) { b.classList.remove('active'); });
  loadBioAnalyticsData();
}

function banEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function banLabel(r, linkMap) {
  if (r.link_type === 'social') {
    const n = r.link_id ? (r.link_id.charAt(0).toUpperCase() + r.link_id.slice(1)) : 'Social';
    return { name: n, type: 'Social' };
  }
  const typeLabel = r.link_type === 'hero' ? 'Hero' : (r.link_type === 'featured' ? 'Featured' : 'Link');
  const l = linkMap[r.link_id];
  if (l) {
    const name = (l.title && l.title.trim()) || l.url || 'Untitled link';
    return { name: name, type: typeLabel };
  }
  return { name: 'Removed link', type: typeLabel };
}

async function loadBioAnalyticsData() {
  if (!currentUser) return;
  const range = getBanDateRange();
  const totalEl = document.getElementById('ban-total');
  const totalSub = document.getElementById('ban-total-sub');
  const tableBody = document.getElementById('ban-table-body');

  let clickRows = [];
  let bioViews = 0;
  const linkMap = {};

  try {
    const results = await Promise.all([
      sb.rpc('get_link_click_stats', { p_start_date: range.start, p_end_date: range.end }),
      sb.rpc('get_page_view_stats', { p_start_date: range.start, p_end_date: range.end }),
      sb.from('link_in_bio').select('links').eq('user_id', currentUser.id).maybeSingle()
    ]);
    const clicksRes = results[0], viewsRes = results[1], linksRes = results[2];
    if (!clicksRes.error && Array.isArray(clicksRes.data)) clickRows = clicksRes.data;
    if (!viewsRes.error && viewsRes.data && viewsRes.data.by_page) bioViews = Number(viewsRes.data.by_page.bio) || 0;
    if (!linksRes.error && linksRes.data && Array.isArray(linksRes.data.links)) {
      linksRes.data.links.forEach(function (l) { if (l && l.lid) linkMap[l.lid] = l; });
    }
  } catch (e) {
    console.error('Bio analytics load failed:', e);
  }

  // Aggregate: per-link totals (table) and per-day totals (chart).
  const perLink = {};
  const perDay = {};
  let grandTotal = 0;
  clickRows.forEach(function (r) {
    const key = r.link_type + ':' + r.link_id;
    if (!perLink[key]) perLink[key] = { link_id: r.link_id, link_type: r.link_type, clicks: 0 };
    const c = Number(r.clicks) || 0;
    perLink[key].clicks += c;
    const day = (typeof r.day === 'string') ? r.day.slice(0, 10) : String(r.day).slice(0, 10);
    perDay[day] = (perDay[day] || 0) + c;
    grandTotal += c;
  });

  // Chart day span.
  const chartStart = range.start;
  let dayCount;
  if (range.custom) {
    dayCount = Math.max(1, Math.round((new Date(range.end + 'T00:00:00') - new Date(range.start + 'T00:00:00')) / 86400000) + 1);
  } else {
    dayCount = banRangeDays;
  }

  // Summary: total clicks + overall click rate.
  if (totalEl) totalEl.textContent = grandTotal.toLocaleString();
  if (totalSub) {
    if (bioViews > 0) {
      const rate = (grandTotal / bioViews) * 100;
      totalSub.textContent = rate.toFixed(1) + '% click rate · ' + bioViews.toLocaleString() + ' bio views';
    } else {
      totalSub.textContent = grandTotal === 0 ? 'No clicks yet' : 'No bio views in range';
    }
  }

  renderBanChart('ban-chart', perDay, chartStart, dayCount);

  // Per-link table, sorted by clicks desc.
  const rows = Object.keys(perLink).map(function (k) { return perLink[k]; }).sort(function (a, b) { return b.clicks - a.clicks; });
  if (tableBody) {
    if (rows.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="3" class="ban-empty-cell">No clicks recorded in this range yet.</td></tr>';
    } else {
      tableBody.innerHTML = rows.map(function (r) {
        const label = banLabel(r, linkMap);
        const rate = bioViews > 0 ? ((r.clicks / bioViews) * 100).toFixed(1) + '%' : '—';
        return '<tr>'
          + '<td class="ban-td-link"><span class="ban-link-label">' + banEsc(label.name) + '</span>'
          + '<span class="ban-type-badge ban-type-' + r.link_type + '">' + label.type + '</span></td>'
          + '<td class="ban-td-num">' + r.clicks.toLocaleString() + '</td>'
          + '<td class="ban-td-num">' + rate + '</td>'
          + '</tr>';
      }).join('');
    }
  }
}

// Single-line clicks-per-day chart (canvas), styled to match the existing
// analytics chart.
function renderBanChart(canvasId, perDay, startStr, dayCount) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth, h = canvas.offsetHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const startDate = new Date(startStr + 'T00:00:00');
  const vals = new Array(dayCount).fill(0);
  const dates = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(startDate); d.setDate(d.getDate() + i);
    dates.push((d.getMonth() + 1) + '/' + d.getDate());
  }
  Object.keys(perDay).forEach(function (day) {
    const idx = Math.round((new Date(day + 'T00:00:00') - startDate) / 86400000);
    if (idx >= 0 && idx < dayCount) vals[idx] = perDay[day];
  });

  const pad = { top: 10, right: 10, bottom: 20, left: 10 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const vMax = Math.max.apply(null, vals.concat([1]));
  const getX = function (i) { return pad.left + (i / Math.max(dayCount - 1, 1)) * cw; };
  const getY = function (v) { return pad.top + ch - (v / vMax) * ch; };

  ctx.clearRect(0, 0, w, h);

  // Grid
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

  // Line + fill
  ctx.beginPath(); ctx.strokeStyle = 'rgba(124,58,237,1)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  vals.forEach(function (v, i) { const x = getX(i), y = getY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.stroke();
  ctx.lineTo(getX(dayCount - 1), pad.top + ch); ctx.lineTo(getX(0), pad.top + ch); ctx.closePath();
  ctx.fillStyle = 'rgba(124,58,237,0.10)'; ctx.fill();
}
