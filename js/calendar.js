// =============================================================================
// /js/calendar.js — Calendar tool + Google Calendar OAuth integration
// -----------------------------------------------------------------------------
// All JavaScript for the Calendar tool. Extracted from dashboard.html for
// stricter CSP.
//
// IMPORTANT — OAuth integration preserved exactly as-is. The Google Calendar
// connection flow (gcalConnect / gcalDisconnect / gcalHandleReturnParams)
// uses:
//   • Supabase session access_token (verified Bearer via /api/google-calendar-ticket)
//   • Short-lived signed ticket (5 min expiry) for the OAuth start redirect
//   • /api/google-calendar-start receives ticket, never trusts request body
// Refactor only changes how the Connect/Disconnect *buttons* are wired
// (inline onclick → delegated data-cal-action); the OAuth fetch URLs, token
// handling, and auth flow are byte-for-byte unchanged.
//
// SHARED HELPERS: calBuildTimePicker and calReadTimePicker are used by
// coaching.js (availability time pickers). They remain globally accessible
// as top-level functions on window since this file loads in the same page.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/calendar.js
//   • Phase 2: inline onclick → data-cal-action attributes + delegated handlers
//   • Phase 3: inline class="bio-s-6eae3a" → hash-named CSS classes (static only)
//
// External dependencies remain on window (sb, Auth, currentUser, escapeHtml,
// escapeHtmlSimple, showModalAlert, showModalConfirm, etc).
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE (parallel of other tools)
// =============================================================================

const calActions = {};

function calRegisterAction(action, handler) {
  calActions[action] = handler;
}

function calFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['calAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.calAction) {
        const wantEvent = el.dataset.calEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.calAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function calDispatchEvent(event) {
  const found = calFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = calActions[found.action];
  if (!handler) {
    console.warn('[cal] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, calDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 17056-18033 (Calendar + GCal OAuth) ----------
// =====================
// CALENDAR
// =====================
var calState = {
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  selectedDate: null, // YYYY-MM-DD
  pickerYear: new Date().getFullYear(),
  events: [], // loaded from Supabase
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  loaded: false
};

function calToYmd(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function calFormatDayLabel(ymd) {
  var parts = ymd.split('-').map(Number);
  var date = new Date(parts[0], parts[1] - 1, parts[2]);
  var today = calToYmd(new Date());
  var prefix = ymd === today ? 'Today, ' : '';
  return prefix + date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function calFormatMonthLabel(year, month) {
  var d = new Date(year, month, 1);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Timezone preference resolution — prefer DB (so it's known to the coaching
// page), fall back to localStorage. Extracted so init can run it in parallel
// with the events load, once per session.
async function _calResolveTimezone() {
  try {
    var { data: prof } = await sb.from('profiles').select('calendar_timezone').eq('user_id', currentUser.id).maybeSingle();
    if (prof && prof.calendar_timezone) {
      calState.timezone = prof.calendar_timezone;
      try { localStorage.setItem('ryxa_cal_tz', prof.calendar_timezone); } catch (e) {}
    } else {
      // No DB value yet — check localStorage and migrate it to DB
      try {
        var saved = localStorage.getItem('ryxa_cal_tz');
        if (saved) {
          calState.timezone = saved;
          // Migrate: persist to DB for future sessions / public pages
          await sb.from('profiles').update({ calendar_timezone: saved }).eq('user_id', currentUser.id);
        }
      } catch (e) {}
    }
  } catch (e) {
    // DB read failed — fall back to localStorage only
    try {
      var saved2 = localStorage.getItem('ryxa_cal_tz');
      if (saved2) calState.timezone = saved2;
    } catch (e2) {}
  }
}

async function initCalendarTool() {
  if (currentUser) {
    // Instant paint value from localStorage while the DB copy (if needed)
    // loads; both timezone and events resolve ONCE per session, in parallel.
    // Repeat opens of the tool hit no network at all before rendering.
    try {
      var cachedTz = localStorage.getItem('ryxa_cal_tz');
      if (cachedTz) calState.timezone = cachedTz;
    } catch (e) {}
    var pending = [];
    if (!calState.tzLoaded) {
      calState.tzLoaded = true;
      pending.push(_calResolveTimezone());
    }
    if (!calState.loaded) {
      pending.push(calLoadEvents().then(function() { calState.loaded = true; }));
    }
    if (pending.length) await Promise.all(pending);
  } else {
    try {
      var saved3 = localStorage.getItem('ryxa_cal_tz');
      if (saved3) calState.timezone = saved3;
    } catch (e) {}
  }

  if (!calState.selectedDate) {
    calState.selectedDate = calToYmd(new Date());
    calState.viewYear = new Date().getFullYear();
    calState.viewMonth = new Date().getMonth();
  }

  // Deep-link from the welcome page's Upcoming events list: jump the view
  // to the event's month and select its day, then clear the flag.
  if (window._calFocusDate && /^\d{4}-\d{2}-\d{2}$/.test(window._calFocusDate)) {
    var fp = window._calFocusDate.split('-');
    calState.viewYear = parseInt(fp[0], 10);
    calState.viewMonth = parseInt(fp[1], 10) - 1;
    calState.selectedDate = window._calFocusDate;
    window._calFocusDate = null;
  }

  calRender();
  calPopulateInlineTimezone();

  // Load Google Calendar connection state (non-blocking)
  gcalLoadConnectionState();

  // Handle ?gcal=connected|error|cancelled flags from OAuth callback redirect
  gcalHandleReturnParams();
}

// ============================================================
// Google Calendar OAuth (Phase 1: connect/disconnect only)
// ============================================================

var gcalState = { connected: false, email: null, loading: true };

async function gcalLoadConnectionState() {
  var row = document.getElementById('gcal-connect-row');
  if (!row || !currentUser) return;

  gcalState.loading = true;
  gcalRenderConnectionState();

  try {
    var { data, error } = await sb
      .from('google_calendar_status')
      .select('google_email, connected_at')
      .maybeSingle();
    if (error) throw error;

    if (data) {
      gcalState.connected = true;
      gcalState.email = data.google_email || null;
    } else {
      gcalState.connected = false;
      gcalState.email = null;
    }
  } catch (e) {
    console.error('gcal status load failed:', e);
    gcalState.connected = false;
    gcalState.email = null;
  } finally {
    gcalState.loading = false;
    gcalRenderConnectionState();
  }
}

function gcalRenderConnectionState() {
  var row = document.getElementById('gcal-connect-row');
  if (!row) return;

  if (gcalState.loading) {
    row.innerHTML = '<div class="cal-s-56e6ba">Checking calendar connection…</div>';
    return;
  }

  if (gcalState.connected) {
    var emailLabel = gcalState.email ? '<span class="cal-s-3ce883">' + escapeHtmlSimple(gcalState.email) + '</span>' : '<span class="mk-s-e0b980">your Google account</span>';
    row.innerHTML =
      '<div class="cal-s-bd9395">'
      + '<span class="cal-s-d8b3b8"></span>'
      + 'Connected as ' + emailLabel
      + '</div>'
      + '<button data-cal-action="gcal-disconnect" class="cal-s-2b653b cal-h-e4ed29">Disconnect</button>';
  } else {
    row.innerHTML =
      '<button data-cal-action="gcal-connect" class="cal-s-7c77c8 cal-h-4290e9">'
      + '<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>'
      + 'Connect Google Calendar'
      + '</button>'
      + '<div class="bio-s-e769ff">Sync Ryxa events to your Google Calendar. <span class="cal-info-dot" tabindex="0" role="note" aria-label="Editing events in Google Calendar won\'t change them in Ryxa." data-tip="Editing events in Google Calendar won\'t change them in Ryxa.">i</span></div>';
  }
}

async function gcalConnect() {
  if (!currentUser) {
    gcalShowError('You need to be signed in to connect Google Calendar.');
    return;
  }
  gcalHideError();
  try {
    var { data: { session } } = await sb.auth.getSession();
    var token = session && session.access_token;
    if (!token) {
      gcalShowError('Your session has expired. Please refresh the page and try again.');
      return;
    }
    // Step 1: fetch a short-lived signed ticket via POST. The ticket contains
    // our user_id and expires in 5 minutes. Unlike a session token, it can't
    // be used for anything except starting this OAuth flow.
    var ticketRes = await fetch('/api/google-calendar-ticket', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!ticketRes.ok) {
      var errBody = await ticketRes.json().catch(function() { return {}; });
      throw new Error(errBody.error || 'ticket_failed');
    }
    var ticketJson = await ticketRes.json();
    if (!ticketJson || !ticketJson.ticket) {
      throw new Error('Empty ticket response');
    }
    // Step 2: navigate to the start endpoint with the signed ticket.
    window.location.href = '/api/google-calendar-start?ticket=' + encodeURIComponent(ticketJson.ticket);
  } catch (e) {
    console.error('gcal connect failed:', e);
    gcalShowError('Could not start connection. Please try again.');
  }
}

async function gcalDisconnect() {
  if (!gcalState.connected) return;
  showModalConfirm(
    'Disconnect Google Calendar?',
    'Ryxa will stop syncing events to your Google Calendar. The Ryxa calendar in Google will not be deleted, but new events won\'t be added.',
    gcalDoDisconnect,
    'Disconnect',
    'Cancel'
  );
}

async function gcalDoDisconnect() {
  try {
    var { data: { session } } = await sb.auth.getSession();
    var token = session && session.access_token;
    if (!token) {
      showModalAlert('Session expired', 'Please refresh the page and try again.');
      return;
    }
    var res = await fetch('/api/google-calendar-disconnect', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) {
      var err = await res.json().catch(function() { return { error: 'unknown' }; });
      throw new Error(err.error || 'Disconnect failed');
    }
    gcalState.connected = false;
    gcalState.email = null;
    gcalRenderConnectionState();
    if (typeof showDashToast === 'function') {
      showDashToast('success', 'Google Calendar disconnected');
    }
  } catch (e) {
    console.error('gcal disconnect failed:', e);
    showModalAlert('Could not disconnect', e.message || 'Please try again.');
  }
}

function gcalHandleReturnParams() {
  var params = new URLSearchParams(window.location.search);
  var flag = params.get('gcal');
  if (!flag) return;

  // Clean up URL so refresh doesn't replay
  var url = new URL(window.location.href);
  url.searchParams.delete('gcal');
  url.searchParams.delete('reason');
  url.searchParams.delete('view');
  window.history.replaceState({}, '', url.toString());

  if (flag === 'connected') {
    if (typeof showDashToast === 'function') {
      showDashToast('success', 'Google Calendar connected');
    }
    gcalLoadConnectionState();
    gcalHideError();
  } else if (flag === 'cancelled') {
    // User clicked cancel on Google's screen — silent
    gcalHideError();
  } else if (flag === 'error') {
    var reason = params.get('reason') || 'unknown';
    gcalShowError('Could not connect Google Calendar (' + reason + '). Please try again.');
  }
}

function gcalShowError(message) {
  var el = document.getElementById('gcal-connect-error');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
}

function gcalHideError() {
  var el = document.getElementById('gcal-connect-error');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

// Tiny HTML escape helper for the email label
function escapeHtmlSimple(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

async function calLoadEvents() {
  if (!currentUser) return;
  try {
    var { data, error } = await sb.from('calendar_events')
      .select('*')
      .eq('creator_id', currentUser.id)
      .order('start_at', { ascending: true });
    if (error) {
      // Table might not exist yet
      console.warn('Calendar events not loaded:', error.message);
      if (typeof showDashToast === 'function') {
        showDashToast('error', 'Could not load your calendar events. Refresh the page to try again.');
      }
      calState.events = [];
      return;
    }
    calState.events = data || [];
  } catch (e) {
    console.error('calLoadEvents:', e);
    calState.events = [];
  }
}

function calRender() {
  document.getElementById('cal-month-label').textContent = calFormatMonthLabel(calState.viewYear, calState.viewMonth);
  calRenderGrid();
  calRenderDayEvents();
}

function calRenderGrid() {
  var grid = document.getElementById('cal-grid');
  if (!grid) return;
  var firstDay = new Date(calState.viewYear, calState.viewMonth, 1);
  var lastDay = new Date(calState.viewYear, calState.viewMonth + 1, 0);
  var startWeekday = firstDay.getDay();
  var daysInMonth = lastDay.getDate();
  var prevLastDay = new Date(calState.viewYear, calState.viewMonth, 0).getDate();

  var todayYmd = calToYmd(new Date());
  var html = '';

  // Days from previous month
  for (var i = startWeekday - 1; i >= 0; i--) {
    var dayNum = prevLastDay - i;
    html += calRenderCell(calState.viewYear, calState.viewMonth - 1, dayNum, true, todayYmd);
  }
  // Current month
  for (var d = 1; d <= daysInMonth; d++) {
    html += calRenderCell(calState.viewYear, calState.viewMonth, d, false, todayYmd);
  }
  // Fill remaining cells with next month
  var totalCells = startWeekday + daysInMonth;
  var remaining = (7 - (totalCells % 7)) % 7;
  for (var n = 1; n <= remaining; n++) {
    html += calRenderCell(calState.viewYear, calState.viewMonth + 1, n, true, todayYmd);
  }
  grid.innerHTML = html;
}

function calRenderCell(year, month, day, isOtherMonth, todayYmd) {
  var date = new Date(year, month, day);
  var ymd = calToYmd(date);
  var isToday = ymd === todayYmd;
  var isSelected = ymd === calState.selectedDate;
  var dayEvents = calState.events.filter(function(e) {
    var startDate = e.start_at ? calToYmd(new Date(e.start_at)) : null;
    return startDate === ymd;
  });
  var hasEvents = dayEvents.length > 0;

  var bg = isSelected ? 'var(--accent)' : (isToday ? 'rgba(124,58,237,0.15)' : 'var(--surface2)');
  var color = isSelected ? '#fff' : (isOtherMonth ? 'var(--muted)' : 'var(--text)');
  var border = isSelected ? '1px solid var(--accent)' : (isToday ? '1px solid rgba(124,58,237,0.4)' : '1px solid var(--border)');
  var opacity = isOtherMonth ? '0.4' : '1';
  var dotColor = isSelected ? '#fff' : 'var(--accent2)';
  var dot = hasEvents ? '<div style="position:absolute;bottom:4px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:' + dotColor + ';"></div>' : '';

  return '<button data-cal-action="select-date" data-cal-ymd="' + ymd + '" class="cal-h-755342" style="position:relative;aspect-ratio:1;background:' + bg + ';border:' + border + ';border-radius:8px;color:' + color + ';font-size:13px;font-weight:500;cursor:pointer;font-family:DM Sans,sans-serif;padding:0;display:flex;align-items:center;justify-content:center;opacity:' + opacity + ';transition:all 0.15s;">' + day + dot + '</button>';
}

function calRenderDayEvents() {
  document.getElementById('cal-day-label').textContent = calFormatDayLabel(calState.selectedDate);
  var container = document.getElementById('cal-day-events');
  var dayEvents = calState.events.filter(function(e) {
    var startDate = e.start_at ? calToYmd(new Date(e.start_at)) : null;
    return startDate === calState.selectedDate;
  }).sort(function(a, b) {
    return (a.start_at || '').localeCompare(b.start_at || '');
  });

  if (dayEvents.length === 0) {
    container.innerHTML = '<div class="ana-s-cd4491">No events on this day. Click "Add Event" to create one.</div>';
    return;
  }

  container.innerHTML = dayEvents.map(function(e) {
    // Format event times in the creator's selected calendar timezone, not
    // browser-local. Matters when the creator is traveling: their saved tz
    // (e.g. LA) shouldn't display as Tokyo (browser-local) while their
    // dropdown still says LA. calState.timezone is the source of truth —
    // it matches the inline dropdown.
    var tz = calState.timezone || undefined;
    var startTime = e.start_at ? new Date(e.start_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
    var endTime = e.end_at ? new Date(e.end_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
    var timeLabel = startTime + (endTime ? ' - ' + endTime : '');
    var typeLabel = e.event_type === 'manual' ? '' : '<span class="cal-s-530832">' + escapeHtml(e.event_type === 'coaching' ? 'booking' : (e.event_type === 'brand_deal' ? 'brand deal' : (e.event_type || ''))) + '</span>';
    // Validate color is hex format only (no JS injection via style)
    var rawColor = e.color || '#7c3aed';
    var color = /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : '#7c3aed';
    return '<div class="cal-s-1fb064">'
      + '<div style="width:3px;align-self:stretch;background:' + color + ';border-radius:2px;flex-shrink:0;"></div>'
      + '<div class="cal-s-7c1d05">'
      + '<div class="bio-s-a07604">'
      + '<div class="cal-s-8699f1"><span class="cal-s-592db1">' + escapeHtml((e.title || 'Untitled').replace(/^Coaching:\s*/i, '')) + '</span>' + typeLabel + '</div>'
      + (timeLabel ? '<div class="cal-s-37775c">' + escapeHtml(timeLabel) + '</div>' : '')
      + (e.notes ? '<div class="cal-s-b35c3d">' + escapeHtml(e.notes) + '</div>' : '')
      + '</div>'
      + (function() {
          var deleteLabel = e.event_type === 'brand_deal' ? 'Remove from calendar' : 'Delete event';
          var canEdit = e.event_type !== 'brand_deal';
          // Coaching events get a "Send Meeting Details" button next to edit/delete
          var sendMsgBtn = (e.event_type === 'coaching' && e.source_id)
            ? '<button data-cal-action="open-send-message" data-cal-booking-id="' + escapeHtml(e.source_id) + '" data-cal-event-title="' + escapeHtml(e.title || '') + '" aria-label="Send meeting details to booker" title="Send meeting details" class="cal-s-2bcfbe"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>Send Details</button>'
            : '';
          var editBtn = canEdit
            ? '<button data-cal-action="open-edit-event" data-cal-event-id="' + e.id + '" aria-label="Edit event" title="Edit event" class="cal-s-c3ca24"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
            : '';
          var deleteBtn = '<button data-cal-action="delete-event" data-cal-event-id="' + e.id + '" data-cal-event-type="' + e.event_type + '" aria-label="' + deleteLabel + '" title="' + deleteLabel + '" class="cal-s-85a1b8"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>';
          return '<div class="cal-s-70662e">' + sendMsgBtn + editBtn + deleteBtn + '</div>';
        })()
      + '</div>'
      + '</div>';
  }).join('');
}

function calSelectDate(ymd) {
  calState.selectedDate = ymd;
  calRender();
  // On mobile/tablet (stacked layout), scroll the events card into view
  // so users don't have to manually scroll after tapping a day.
  if (window.innerWidth <= 900) {
    var eventsCard = document.getElementById('cal-events-card');
    if (eventsCard) {
      // Slight delay so the render finishes first
      setTimeout(function() {
        eventsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }
}

function calPrevMonth() {
  calState.viewMonth--;
  if (calState.viewMonth < 0) { calState.viewMonth = 11; calState.viewYear--; }
  calRender();
}

function calNextMonth() {
  calState.viewMonth++;
  if (calState.viewMonth > 11) { calState.viewMonth = 0; calState.viewYear++; }
  calRender();
}

function calToday() {
  var today = new Date();
  calState.viewYear = today.getFullYear();
  calState.viewMonth = today.getMonth();
  calState.selectedDate = calToYmd(today);
  calRender();
}

function calToggleMonthPicker() {
  var picker = document.getElementById('cal-month-picker');
  if (picker.style.display === 'none' || !picker.style.display) {
    calState.pickerYear = calState.viewYear;
    calRenderMonthPicker();
    picker.style.display = 'block';
  } else {
    picker.style.display = 'none';
  }
}

function calRenderMonthPicker() {
  document.getElementById('cal-picker-year').textContent = calState.pickerYear;
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('cal-picker-months').innerHTML = months.map(function(m, i) {
    var isCurrent = (i === calState.viewMonth && calState.pickerYear === calState.viewYear);
    var bg = isCurrent ? 'var(--accent)' : 'transparent';
    var color = isCurrent ? '#fff' : 'var(--text)';
    var border = isCurrent ? '1px solid var(--accent)' : '1px solid var(--border)';
    return '<button data-cal-action="pick-month" data-cal-month="' + i + '" style="padding:10px;background:' + bg + ';border:' + border + ';border-radius:6px;color:' + color + ';font-size:12px;font-weight:500;font-family:DM Sans,sans-serif;cursor:pointer;">' + m + '</button>';
  }).join('');
}

function calPickerPrevYear() {
  calState.pickerYear--;
  calRenderMonthPicker();
}

function calPickerNextYear() {
  calState.pickerYear++;
  calRenderMonthPicker();
}

function calPickMonth(month) {
  calState.viewYear = calState.pickerYear;
  calState.viewMonth = month;
  document.getElementById('cal-month-picker').style.display = 'none';
  calRender();
}

function calOpenAddEvent() {
  if (!currentUser) {
    showModalAlert('Sign in required', 'Please sign in to add calendar events.');
    return;
  }
  calOpenEventModal(null);
}

// Builds two adjacent dropdowns: one for hour (12-hr) and one for minute (15-min steps),
// plus an AM/PM toggle. Value persists in 24-hour HH:MM format for compatibility.
// Returns the HTML string. Reads the value via calReadTimePicker(prefix).
function calBuildTimePicker(prefix, selectedValue, disabled) {
  // Parse selected value (HH:MM 24-hour)
  var parts = (selectedValue || '09:00').split(':').map(Number);
  var h24 = parts[0];
  var m = parts[1];
  // Round minute to nearest 15 for spinner
  m = Math.round(m / 15) * 15;
  if (m === 60) { m = 0; h24 = (h24 + 1) % 24; }

  var period = h24 >= 12 ? 'PM' : 'AM';
  var h12 = h24 % 12;
  if (h12 === 0) h12 = 12;

  var dis = disabled ? ' disabled' : '';
  var commonSelectStyle = 'background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 22px 8px 10px;color:var(--text);font-size:13px;font-family:DM Sans,sans-serif;outline:none;cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url(\'data:image/svg+xml;utf8,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;10&quot; height=&quot;10&quot; viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;%23999&quot; stroke-width=&quot;2.2&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;><polyline points=&quot;6 9 12 15 18 9&quot;/></svg>\');background-repeat:no-repeat;background-position:right 6px center;text-align:center;text-align-last:center;';

  // Hour options (1–12)
  var hourOpts = '';
  for (var i = 1; i <= 12; i++) {
    hourOpts += '<option value="' + i + '"' + (i === h12 ? ' selected' : '') + '>' + i + '</option>';
  }

  // Minute options (00, 15, 30, 45)
  var minOpts = '';
  [0, 15, 30, 45].forEach(function(mm) {
    var label = String(mm).padStart(2, '0');
    minOpts += '<option value="' + mm + '"' + (mm === m ? ' selected' : '') + '>' + label + '</option>';
  });

  // AM/PM options
  var pmOpts = '<option value="AM"' + (period === 'AM' ? ' selected' : '') + '>AM</option>'
             + '<option value="PM"' + (period === 'PM' ? ' selected' : '') + '>PM</option>';

  return '<div class="cal-time-picker cal-s-532e4c" data-prefix="' + prefix + '" >'
    + '<select id="' + prefix + '-h"' + dis + ' aria-label="Hour" style="' + commonSelectStyle + 'flex:1;min-width:0;">' + hourOpts + '</select>'
    + '<span class="cal-s-c04715">:</span>'
    + '<select id="' + prefix + '-m"' + dis + ' aria-label="Minute" style="' + commonSelectStyle + 'flex:1;min-width:0;">' + minOpts + '</select>'
    + '<select id="' + prefix + '-p"' + dis + ' aria-label="AM or PM" style="' + commonSelectStyle + 'flex:1;min-width:0;">' + pmOpts + '</select>'
    + '</div>';
}

// Reads the current value from a time picker built by calBuildTimePicker.
// Returns "HH:MM" in 24-hour format.
function calReadTimePicker(prefix) {
  var hEl = document.getElementById(prefix + '-h');
  var mEl = document.getElementById(prefix + '-m');
  var pEl = document.getElementById(prefix + '-p');
  if (!hEl || !mEl || !pEl) return null;
  var h12 = parseInt(hEl.value, 10);
  var m = parseInt(mEl.value, 10);
  var period = pEl.value;
  var h24 = h12 % 12;
  if (period === 'PM') h24 += 12;
  return String(h24).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Builds a list of <option> tags for a 15-minute-increment time picker.
// Times shown in 12-hour format with AM/PM (more user-friendly than 24h).
// Values stay in 24-hour HH:MM so existing parse logic works unchanged.
function calBuildTimeOptions(selectedValue) {
  var html = '';
  for (var totalMin = 0; totalMin < 24 * 60; totalMin += 15) {
    var h24 = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    var value = String(h24).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    // Format for display: 12-hour with AM/PM
    var period = h24 >= 12 ? 'PM' : 'AM';
    var h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    var label = h12 + ':' + String(m).padStart(2, '0') + ' ' + period;
    var sel = (value === selectedValue) ? ' selected' : '';
    html += '<option value="' + value + '"' + sel + '>' + label + '</option>';
  }
  return html;
}

function calOpenEditEvent(eventId) {
  var event = calState.events.find(function(e) { return e.id === eventId; });
  if (!event) return;
  calOpenEventModal(event);
}

function calOpenEventModal(existingEvent) {
  // Build modal
  var existingModal = document.getElementById('cal-event-modal');
  if (existingModal) existingModal.remove();

  var isEdit = !!existingEvent;
  var defaultDate, defaultStart, defaultEnd, defaultTitle, defaultNotes, defaultColor;

  if (isEdit) {
    var startD = new Date(existingEvent.start_at);
    var endD = new Date(existingEvent.end_at);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    // Round minutes to nearest 15 to match dropdown options
    var roundTo15 = function(d) {
      var m = d.getMinutes();
      var rounded = Math.round(m / 15) * 15;
      var h = d.getHours();
      if (rounded === 60) { rounded = 0; h = (h + 1) % 24; }
      return pad(h) + ':' + pad(rounded);
    };
    defaultDate = startD.getFullYear() + '-' + pad(startD.getMonth() + 1) + '-' + pad(startD.getDate());
    defaultStart = roundTo15(startD);
    defaultEnd = roundTo15(endD);
    defaultTitle = existingEvent.title || '';
    defaultNotes = existingEvent.notes || '';
    defaultColor = existingEvent.color || '#7c3aed';
  } else {
    defaultDate = calState.selectedDate;
    defaultStart = '09:00';
    defaultEnd = '10:00';
    defaultTitle = '';
    defaultNotes = '';
    defaultColor = '#7c3aed';
  }

  // For coaching events, lock title (it comes from the coaching service)
  var isCoachingEvent = isEdit && existingEvent.event_type === 'coaching';
  // Build readonly attr separately; the input's class is composed inline below
  // so we merge readonly's styling class into the same class= attribute.
  var titleReadonlyAttr = isCoachingEvent ? ' readonly' : '';
  var titleExtraClass = isCoachingEvent ? ' cal-s-4e2c49' : '';
  var titleHint = isCoachingEvent ? '<div class="deal-s-44d600">Title is set by the coaching service.</div>' : '';

  var modal = document.createElement('div');
  modal.id = 'cal-event-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:12px;';
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
  // Store event id for save handler
  if (isEdit) modal.dataset.editingId = existingEvent.id;

  modal.innerHTML = '<div class="cal-s-744497">'
    + '<div class="cal-s-0a679d">'
    + '<h3 class="course-s-09f83d">' + (isEdit ? 'Edit Event' : 'Add Event') + '</h3>'
    + '<button data-cal-action="close-event-modal" class="course-s-a2c730">✕</button>'
    + '</div>'
    + '<div class="coach-s-a82d70"><label for="cal-modal-title" class="cal-s-0d9ec6">Title</label>'
    + '<input id="cal-modal-title" type="text" maxlength="120" placeholder="Event title" value="' + escapeHtml(defaultTitle) + '"' + titleReadonlyAttr + ' class="cal-s-367b98' + titleExtraClass + '">'
    + titleHint + '</div>'
    + '<div class="coach-s-a82d70"><label for="cal-modal-date" class="cal-s-0d9ec6">Date</label>'
    + '<input id="cal-modal-date" type="date" value="' + defaultDate + '" class="cal-s-ed0012"></div>'
    + '<div class="cal-s-ee3e80">'
    + '<div class="deal-s-367da9"><label class="cal-s-0d9ec6">Start</label>' + calBuildTimePicker('cal-modal-start', defaultStart, false) + '</div>'
    + '<div class="deal-s-367da9"><label class="cal-s-0d9ec6">End</label>' + calBuildTimePicker('cal-modal-end', defaultEnd, false) + '</div>'
    + '</div>'
    + '<div class="coach-s-a82d70"><label class="cal-s-0d9ec6">Color</label>'
    + '<div id="cal-modal-colors" role="radiogroup" aria-label="Event color" class="coach-s-088936"></div></div>'
    + '<div class="deal-s-5b6aad"><label for="cal-modal-notes" class="cal-s-0d9ec6">Notes (optional)</label>'
    + '<textarea id="cal-modal-notes" maxlength="2000" placeholder="Add notes..." rows="3" class="cal-s-e8f0a9">' + escapeHtml(defaultNotes) + '</textarea></div>'
    + (isCoachingEvent ? '' : '<div class="cal-s-77e2bc"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cal-s-be496e"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><span>Adding an event will also block out time slots for your 1:1 booking services. Bookers will see fewer available slots, but never see what you have scheduled.</span></div>')
    + '<button data-cal-action="save-event" class="cal-s-249433 cal-h-6ebecd">' + (isEdit ? 'Save Changes' : 'Save Event') + '</button>'
    + '<div id="cal-modal-error" class="cal-s-5b5ea7"></div>'
    + '</div>';
  document.body.appendChild(modal);

  // Render color picker
  var colors = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
  // If editing with a non-standard color, prepend it
  if (isEdit && colors.indexOf(defaultColor) === -1) colors.unshift(defaultColor);
  document.getElementById('cal-modal-colors').innerHTML = colors.map(function(c) {
    var selected = c === defaultColor;
    return '<button data-cal-action="select-color" data-cal-color="' + c + '" data-color="' + c + '" class="cal-color-btn" style="width:32px;height:32px;border-radius:50%;background:' + c + ';border:' + (selected ? '3px solid #fff' : '2px solid var(--border)') + ';cursor:pointer;"></button>';
  }).join('');
  window._calSelectedColor = defaultColor;

  if (!isCoachingEvent) {
    setTimeout(function() {
      var titleInput = document.getElementById('cal-modal-title');
      if (titleInput) titleInput.focus();
    }, 50);
  }

  // Auto-adjust end time when start changes:
  // If the new start is at or after the current end, bump end to start + 30min.
  // If end is still ahead of start, leave it alone (don't override user's choice).
  function calAutoAdjustEnd() {
    var startStr = calReadTimePicker('cal-modal-start');
    var endStr = calReadTimePicker('cal-modal-end');
    if (!startStr || !endStr) return;
    var sParts = startStr.split(':').map(Number);
    var eParts = endStr.split(':').map(Number);
    var sMins = sParts[0] * 60 + sParts[1];
    var eMins = eParts[0] * 60 + eParts[1];
    if (eMins <= sMins) {
      var newEndMins = sMins + 30;
      // Cap at 23:45 to fit within the picker's range (must be HH:MM in valid range)
      if (newEndMins >= 24 * 60) newEndMins = 23 * 60 + 45;
      var newH24 = Math.floor(newEndMins / 60);
      var newM = newEndMins % 60;
      // Snap to 15-min boundary just in case
      newM = Math.round(newM / 15) * 15;
      if (newM === 60) { newM = 0; newH24 = (newH24 + 1) % 24; }
      // Update the end picker spinners
      var period = newH24 >= 12 ? 'PM' : 'AM';
      var h12 = newH24 % 12; if (h12 === 0) h12 = 12;
      var hEl = document.getElementById('cal-modal-end-h');
      var mEl = document.getElementById('cal-modal-end-m');
      var pEl = document.getElementById('cal-modal-end-p');
      if (hEl) hEl.value = String(h12);
      if (mEl) mEl.value = String(newM);
      if (pEl) pEl.value = period;
    }
  }
  // Wire up listeners on each spinner of the start picker
  ['h', 'm', 'p'].forEach(function(suffix) {
    var el = document.getElementById('cal-modal-start-' + suffix);
    if (el) el.addEventListener('change', calAutoAdjustEnd);
  });
}

function calSelectColor(c) {
  window._calSelectedColor = c;
  document.querySelectorAll('.cal-color-btn').forEach(function(b) {
    b.style.border = b.dataset.color === c ? '3px solid #fff' : '2px solid var(--border)';
  });
}

async function calSaveEvent() {
  var title = document.getElementById('cal-modal-title').value.trim();
  var date = document.getElementById('cal-modal-date').value;
  var startTime = calReadTimePicker('cal-modal-start');
  var endTime = calReadTimePicker('cal-modal-end');
  var notes = document.getElementById('cal-modal-notes').value.trim();
  var color = window._calSelectedColor || '#7c3aed';

  function showError(msg) {
    var err = document.getElementById('cal-modal-error');
    if (err) {
      err.textContent = msg;
      err.style.display = 'block';
      setTimeout(function() { if (err) err.style.display = 'none'; }, 5000);
    }
  }

  if (!title) { showError('Please enter an event title.'); return; }
  if (!date) { showError('Please select a date.'); return; }
  if (!startTime || !endTime) { showError('Please set start and end times.'); return; }

  // Build ISO timestamps treating the entered Y-M-D and H:M as a wall-clock
  // time IN THE CREATOR'S SELECTED CALENDAR TIMEZONE (calState.timezone).
  // The old implementation used `new Date(y, m, d, h, m)` which interprets
  // the fields as browser-local time — wrong when the creator is traveling
  // or otherwise has browser-local != calState.timezone. With this fix:
  //   - Creator in NY (browser), saved tz LA, enters 2 PM → stored as 22:00Z
  //     (= 2 PM PT). Displays back as "2 PM" when viewing in LA, "5 PM" in NY.
  //   - Creator at home in LA (browser = saved), enters 2 PM → stored as
  //     22:00Z. Identical to old behavior. No regression.
  function localToIso(ymd, hhmm) {
    var dParts = ymd.split('-').map(Number);
    var tParts = hhmm.split(':').map(Number);
    var tz = calState.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Build a candidate UTC moment treating the local wall-clock fields
    // naively, then compute the offset between that and the same UTC
    // moment formatted in the target tz. The corrected UTC = naive + offset.
    var naiveUtc = Date.UTC(dParts[0], dParts[1] - 1, dParts[2], tParts[0], tParts[1], 0, 0);
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var fParts = {};
    dtf.formatToParts(new Date(naiveUtc)).forEach(function(p) {
      if (p.type !== 'literal') fParts[p.type] = parseInt(p.value, 10);
    });
    var asUtc = Date.UTC(
      fParts.year, fParts.month - 1, fParts.day,
      fParts.hour === 24 ? 0 : fParts.hour, fParts.minute, fParts.second
    );
    var offset = naiveUtc - asUtc;
    return new Date(naiveUtc + offset).toISOString();
  }
  var startAt = localToIso(date, startTime);
  var endAt = localToIso(date, endTime);

  if (new Date(endAt) <= new Date(startAt)) {
    showError('End time must be after start time.');
    return;
  }

  // Detect edit mode from modal data attribute
  var modal = document.getElementById('cal-event-modal');
  var editingId = modal && modal.dataset ? modal.dataset.editingId : null;

  try {
    if (editingId) {
      // EDIT mode — update existing event
      var existing = calState.events.find(function(e) { return e.id === editingId; });
      if (!existing) { showError('Event not found.'); return; }

      var updatePayload = {
        title: title,
        start_at: startAt,
        end_at: endAt,
        color: color,
        notes: notes || null
      };

      // Coaching events: don't allow title changes (locked to coaching service)
      if (existing.event_type === 'coaching') {
        delete updatePayload.title;
      }

      var { data, error } = await sb.from('calendar_events')
        .update(updatePayload)
        .eq('id', editingId)
        .select()
        .single();
      if (error) throw error;

      // For coaching events, also update the booking's slot times.
      // Reset reminder_sent_at so the cron job re-sends with the new time —
      // this prevents buyers from showing up at the original time after a reschedule.
      if (existing.event_type === 'coaching' && existing.source_id) {
        try {
          await sb.from('coaching_bookings')
            .update({ slot_start: startAt, slot_end: endAt, reminder_sent_at: null })
            .eq('id', existing.source_id);
        } catch (e) {
          console.error('Could not update coaching booking slot:', e);
          // Surface it: the calendar shows the new time but the buyer's
          // booking (and reminder email) would still carry the old one.
          if (typeof showDashToast === 'function') {
            showDashToast('error', 'Event updated, but the booking time could not sync. Please edit the event again.');
          }
        }
      }

      // Update local state
      var idx = calState.events.findIndex(function(e) { return e.id === editingId; });
      if (idx !== -1) calState.events[idx] = data;

      document.getElementById('cal-event-modal').remove();
      calState.selectedDate = date;
      var dParts = date.split('-').map(Number);
      calState.viewYear = dParts[0];
      calState.viewMonth = dParts[1] - 1;
      calRender();
      if (typeof showDashToast === 'function') showDashToast('success', 'Changes saved');
    } else {
      // ADD mode — insert new event
      var { data, error } = await sb.from('calendar_events').insert({
        creator_id: currentUser.id,
        title: title,
        start_at: startAt,
        end_at: endAt,
        event_type: 'manual',
        source_id: null,
        color: color,
        notes: notes || null,
        timezone: calState.timezone
      }).select().single();
      if (error) throw error;
      calState.events.push(data);
      document.getElementById('cal-event-modal').remove();
      calState.selectedDate = date;
      var dParts = date.split('-').map(Number);
      calState.viewYear = dParts[0];
      calState.viewMonth = dParts[1] - 1;
      calRender();
      if (typeof showDashToast === 'function') showDashToast('success', 'Event added to calendar');
    }
  } catch (e) {
    console.error('Save event failed:', e);
    showError(e.message || 'Could not save event. Please try again.');
  }
}

// Opens a modal to send a one-off "meeting details" message to the booker of a coaching event.
// The message is sent via email immediately and is not stored anywhere — purely transactional.
function calOpenSendMessage(bookingId, eventTitle) {
  var existing = document.getElementById('cal-send-msg-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'cal-send-msg-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:12px;';
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

  modal.innerHTML = '<div class="cal-s-8f3046">'
    + '<div class="course-s-4aaba5">'
    + '<h3 class="course-s-09f83d">Send Meeting Details</h3>'
    + '<button data-cal-action="close-send-msg-modal" class="course-s-a2c730" aria-label="Close">✕</button>'
    + '</div>'
    + '<p class="cal-s-e0aa1d">Send a message to the booker for <strong class="mk-s-e0b980">' + escapeHtml(eventTitle) + '</strong>. Use this for the Zoom link, address, or any last-minute instructions.</p>'
    + '<div class="coach-s-a82d70"><label for="cal-send-msg-text" class="cal-s-0d9ec6">Message</label>'
    + '<textarea id="cal-send-msg-text" rows="6" maxlength="2000" placeholder="Hi! Here&#39;s the link for our session: https://zoom.us/j/... See you soon!" class="cal-s-dff3ed"></textarea>'
    + '<div class="prod-s-69a65b">The booker will receive this as an email from Ryxa.</div></div>'
    + '<div id="cal-send-msg-error" class="cal-s-29bfd5"></div>'
    + '<div id="cal-send-msg-success" class="cal-s-fb4f75">Sent! The booker has been notified.</div>'
    + '<div class="course-s-b9bbe5">'
    + '<button data-cal-action="close-send-msg-modal" class="cal-s-1a0819">Cancel</button>'
    + '<button id="cal-send-msg-btn" data-cal-action="send-message-now" data-cal-booking-id="' + bookingId + '" class="cal-s-b8601a">Send Email</button>'
    + '</div>'
    + '</div>';

  document.body.appendChild(modal);
  setTimeout(function() {
    var ta = document.getElementById('cal-send-msg-text');
    if (ta) ta.focus();
  }, 50);
}

async function calSendMessageNow(bookingId) {
  var text = (document.getElementById('cal-send-msg-text')?.value || '').trim();
  var errEl = document.getElementById('cal-send-msg-error');
  var okEl = document.getElementById('cal-send-msg-success');
  var btn = document.getElementById('cal-send-msg-btn');

  function showError(msg) {
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
      setTimeout(function() { if (errEl) errEl.style.display = 'none'; }, 5000);
    }
  }

  if (!text) { showError('Please enter a message before sending.'); return; }
  if (!currentUser) { showError('You must be signed in.'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; btn.style.opacity = '0.6'; }

  try {
    // Call edge function to send the email
    var { data: { session } } = await sb.auth.getSession();
    var resp = await fetch('https://kjytapcgxukalwsyputk.supabase.co/functions/v1/send-booking-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (session?.access_token || '')
      },
      body: JSON.stringify({ booking_id: bookingId, message: text })
    });
    var result = await resp.json().catch(function() { return {}; });
    if (!resp.ok || result.error) throw new Error(result.error || 'Could not send email.');

    if (okEl) okEl.style.display = 'block';
    setTimeout(function() {
      var modal = document.getElementById('cal-send-msg-modal');
      if (modal) modal.remove();
    }, 1500);
  } catch (e) {
    console.error('Send message failed:', e);
    if (btn) { btn.disabled = false; btn.textContent = 'Send Email'; btn.style.opacity = '1'; }
    showError(e.message || 'Could not send. Please try again.');
  }
}

async function calDeleteEvent(eventId, eventType) {
  // Find the event in state to get source_id
  var event = calState.events.find(function(e) { return e.id === eventId; });
  if (!event) return;

  var confirmTitle, confirmMsg;
  if (eventType === 'coaching') {
    confirmTitle = 'Delete Coaching Booking';
    confirmMsg = 'This will remove the booking from your calendar and delete the booking record. If this was a paid booking, you may need to manually refund the client via Stripe.\n\nIf you\'re rescheduling, close this and use the edit button instead — your client\'s payment will stay intact. Continue with deletion?';
  } else if (eventType === 'brand_deal') {
    confirmTitle = 'Delete Brand Deal Event';
    confirmMsg = 'This will only remove this event from your calendar. To fully manage the brand deal, edit it from the Brand Deal CRM. Continue?';
  } else {
    confirmTitle = 'Delete Event';
    confirmMsg = 'Are you sure you want to delete this event?';
  }

  showModalConfirm(confirmTitle, confirmMsg, async function() {
    try {
      // Delete the calendar event
      var { error } = await sb.from('calendar_events').delete().eq('id', eventId);
      if (error) throw error;

      // For coaching events, also delete the booking record
      if (eventType === 'coaching' && event.source_id) {
        try {
          await sb.from('coaching_bookings').delete().eq('id', event.source_id);
        } catch (e) {
          console.error('Could not delete coaching booking:', e);
          // Non-fatal — calendar event already deleted
        }
      }

      calState.events = calState.events.filter(function(e) { return e.id !== eventId; });
      calRender();
      if (typeof showDashToast === 'function') showDashToast('success', 'Event removed from calendar');
    } catch (e) {
      console.error('Delete failed:', e);
      showModalAlert('Delete Failed', e.message || 'Could not delete event.');
    }
  });
}

// Common timezones for the inline picker. Curated to cover the major
// business regions worldwide without dumping the full 600-entry IANA list
// on users. Anyone whose IANA tz isn't here will still see their detected
// or saved tz pinned in its own group (see calPopulateInlineTimezone).
//
// Maintenance: if a creator reports their tz is missing, add it here.
// Order within each region roughly west-to-east; cross-region is rough
// geographic order (Americas → Europe → Africa → Asia → Oceania).
var CAL_COMMON_TZS = [
  // North America
  'America/Anchorage', 'America/Los_Angeles', 'America/Vancouver',
  'America/Denver', 'America/Phoenix', 'America/Edmonton',
  'America/Chicago', 'America/Mexico_City', 'America/Winnipeg',
  'America/New_York', 'America/Toronto', 'America/Detroit',
  'America/Halifax',
  // Central / South America
  'America/Bogota', 'America/Lima', 'America/Caracas',
  'America/Santiago', 'America/Buenos_Aires', 'America/Sao_Paulo',
  // Atlantic / Europe
  'Atlantic/Azores', 'Atlantic/Reykjavik',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon',
  'Europe/Paris', 'Europe/Madrid', 'Europe/Brussels',
  'Europe/Berlin', 'Europe/Rome', 'Europe/Amsterdam',
  'Europe/Zurich', 'Europe/Vienna', 'Europe/Stockholm',
  'Europe/Warsaw', 'Europe/Athens', 'Europe/Helsinki',
  'Europe/Bucharest', 'Europe/Istanbul', 'Europe/Moscow',
  // Africa
  'Africa/Casablanca', 'Africa/Lagos', 'Africa/Cairo',
  'Africa/Nairobi', 'Africa/Johannesburg',
  // Middle East / Asia
  'Asia/Jerusalem', 'Asia/Riyadh', 'Asia/Tehran',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata',
  'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta',
  'Asia/Manila', 'Asia/Singapore', 'Asia/Hong_Kong',
  'Asia/Shanghai', 'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo',
  // Oceania
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane',
  'Australia/Sydney', 'Australia/Melbourne',
  'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Honolulu'
];

// Get the current UTC offset for an IANA timezone, formatted as 'UTC−7'
// or 'UTC+5:30'. Uses Intl shortOffset which respects DST automatically —
// e.g. America/Los_Angeles returns 'UTC−8' in winter, 'UTC−7' in summer.
// Returns empty string if the browser can't compute it (Safari < 14.1).
function calGetTzOffsetLabel(tz) {
  try {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, timeZoneName: 'shortOffset'
    }).formatToParts(new Date());
    var tzPart = parts.find(function(p) { return p.type === 'timeZoneName'; });
    if (!tzPart) return '';
    // Browsers return 'GMT-7', 'GMT-07:30', 'UTC', etc. Normalize to 'UTC'
    // prefix and replace the ASCII hyphen with a Unicode minus for the
    // typographic minus that's visually distinct from the offset separator.
    var raw = tzPart.value.replace(/^GMT/, 'UTC');
    if (raw === 'UTC') return 'UTC'; // exactly UTC, no sign
    return raw.replace('-', '\u2212'); // U+2212 minus sign
  } catch (e) {
    return '';
  }
}

// Render the timezone as a compact label for the inline dropdown. Drops
// the IANA continent prefix and appends the current UTC offset. Example:
// 'America/Los_Angeles' → 'Los Angeles (UTC−7)'. Falls back to plain city
// name if offset can't be computed.
function calFormatTzLabel(tz) {
  if (!tz) return '';
  var idx = tz.lastIndexOf('/');
  var city = (idx >= 0 ? tz.slice(idx + 1) : tz).replace(/_/g, ' ');
  var offset = calGetTzOffsetLabel(tz);
  return offset ? city + ' (' + offset + ')' : city;
}

// Populate the inline timezone dropdown in the calendar toolbar. Structure:
//
//   [Your timezone]        ← optgroup, contains auto-detected tz
//     Los Angeles (UTC−7)
//   [Currently selected]   ← only if saved tz differs from detected AND
//     Tahiti (UTC−10)        isn't in the common list
//   [Common timezones]     ← curated list, minus any tz already shown above
//     Anchorage (UTC−9)
//     ...
//
// The "Your timezone" anchor at the top is always the browser-detected tz.
// Users can always get back to it without searching, even after they've
// manually picked a different one and reloaded.
function calPopulateInlineTimezone() {
  var sel = document.getElementById('cal-tz-inline');
  if (!sel) return;
  var saved = calState.timezone || 'UTC';
  var detected = '';
  try { detected = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}

  // Build the option lists for each group. Track everything shown so far
  // so we don't duplicate entries between groups. Although the only path
  // for these strings to be malicious is self-XSS (user editing their own
  // profiles.calendar_timezone), we escape on principle — defense in depth
  // per the Ryxa security rules.
  var shown = {};
  var html = '';

  // Group 1: "Your timezone" — the auto-detected tz, always at top.
  if (detected) {
    var detectedSelected = detected === saved ? ' selected' : '';
    html += '<optgroup label="Your timezone">'
      + '<option value="' + escapeHtmlSimple(detected) + '"' + detectedSelected + '>' + escapeHtmlSimple(calFormatTzLabel(detected)) + '</option>'
      + '</optgroup>';
    shown[detected] = true;
  }

  // Group 2: "Currently selected" — only when the saved tz isn't already
  // shown (detected) and isn't in the common list (otherwise the common
  // group will show it). Handles travelers and edge-case manual picks.
  if (saved && !shown[saved] && CAL_COMMON_TZS.indexOf(saved) === -1) {
    html += '<optgroup label="Currently selected">'
      + '<option value="' + escapeHtmlSimple(saved) + '" selected>' + escapeHtmlSimple(calFormatTzLabel(saved)) + '</option>'
      + '</optgroup>';
    shown[saved] = true;
  }

  // Group 3: "Common timezones" — curated list (hardcoded constants, safe
  // by construction) minus anything already shown above.
  var commonOpts = CAL_COMMON_TZS.filter(function(tz) { return !shown[tz]; });
  if (commonOpts.length) {
    html += '<optgroup label="Common timezones">'
      + commonOpts.map(function(tz) {
          var selected = tz === saved ? ' selected' : '';
          return '<option value="' + escapeHtmlSimple(tz) + '"' + selected + '>' + escapeHtmlSimple(calFormatTzLabel(tz)) + '</option>';
        }).join('')
      + '</optgroup>';
  }

  sel.innerHTML = html;
}

// Save the selected timezone to DB + localStorage and re-render the calendar
// so events display at the right times. No "Save" button — change is the
// commit. We update local state and re-render immediately for responsive
// UX, then the DB write happens in the background. A toast confirms the
// save (or surfaces an error — previously errors were console-only and
// invisible to the user, leaving stale DB state that the booker page
// would silently use).
async function calChangeTimezoneInline(newTz) {
  if (!newTz || newTz === calState.timezone) return;
  calState.timezone = newTz;
  // Keep the dashboard-shell global in sync so other tools (Welcome's
  // upcoming events, coaching settings hint) display in the new tz
  // immediately, without needing their own listeners.
  try { window._ryx_creator_tz = newTz; } catch (e) {}
  try { localStorage.setItem('ryxa_cal_tz', newTz); } catch (e) {}
  calRender();
  // Note: we don't manually re-render Welcome's upcoming events here.
  // showTool('welcome') already calls loadDashStats() → loadUpcomingEvents()
  // every time the user navigates back to Welcome, so the new tz is picked
  // up naturally on that re-render.
  if (currentUser) {
    try {
      // Supabase .update() returns { data, error } — it does NOT throw on
      // RLS rejection or no-matching-row. Must check error explicitly.
      var res = await sb.from('profiles').update({ calendar_timezone: newTz }).eq('user_id', currentUser.id);
      if (res && res.error) {
        console.error('Failed to save calendar_timezone:', res.error);
        if (typeof dashShowToast === 'function') {
          dashShowToast('Couldn\'t save timezone. Please try again.', 'error');
        }
        return;
      }
      if (typeof dashShowToast === 'function') {
        dashShowToast('Timezone updated');
      }
    } catch (e) {
      // Network/unexpected error path — also worth surfacing.
      console.error('Failed to save calendar_timezone:', e);
      if (typeof dashShowToast === 'function') {
        dashShowToast('Couldn\'t save timezone. Please try again.', 'error');
      }
    }
  }
}

function calOpenSettings() {
  // Deprecated. The gear-icon settings modal was replaced by an inline
  // timezone dropdown in the calendar toolbar (calPopulateInlineTimezone +
  // calChangeTimezoneInline). Kept as a stub in case some old code path
  // still references it; no-op.
}


// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Top toolbar (markup)
calRegisterAction('prev-month', () => calPrevMonth());
calRegisterAction('next-month', () => calNextMonth());
calRegisterAction('today', () => calToday());
calRegisterAction('toggle-month-picker', () => calToggleMonthPicker());
calRegisterAction('change-timezone', (e, el) => calChangeTimezoneInline(el.value));
calRegisterAction('open-add-event', () => calOpenAddEvent());
calRegisterAction('picker-prev-year', () => calPickerPrevYear());
calRegisterAction('picker-next-year', () => calPickerNextYear());

// Calendar grid cells (template literal)
calRegisterAction('select-date', (e, el) => calSelectDate(el.dataset.calYmd));
calRegisterAction('pick-month', (e, el) => calPickMonth(parseInt(el.dataset.calMonth, 10)));

// Event row buttons (template literal)
calRegisterAction('open-edit-event', (e, el) => calOpenEditEvent(el.dataset.calEventId));
calRegisterAction('delete-event', (e, el) => calDeleteEvent(el.dataset.calEventId, el.dataset.calEventType));
calRegisterAction('open-send-message', (e, el) => calOpenSendMessage(el.dataset.calBookingId, el.dataset.calEventTitle));
calRegisterAction('send-message-now', (e, el) => calSendMessageNow(el.dataset.calBookingId));

// Modal buttons (template literal)
calRegisterAction('close-event-modal', () => {
  var m = document.getElementById('cal-event-modal');
  if (m) m.remove();
});
calRegisterAction('close-send-msg-modal', () => {
  var m = document.getElementById('cal-send-msg-modal');
  if (m) m.remove();
});
calRegisterAction('save-event', () => calSaveEvent());
calRegisterAction('select-color', (e, el) => calSelectColor(el.dataset.calColor));

// Google Calendar OAuth — buttons rendered by gcalRenderConnectionState
// These trigger gcalConnect/gcalDisconnect, which use Bearer token auth
// (Supabase access_token via /api/google-calendar-ticket). The OAuth flow
// itself is byte-identical to pre-refactor; only the click trigger changed
// from inline onclick to data-cal-action.
calRegisterAction('gcal-connect', () => gcalConnect());
calRegisterAction('gcal-disconnect', () => gcalDisconnect());

