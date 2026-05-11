// =================================================================
// Ryxa booking landing - extracted from booking/index.html inline <script> for CSP.
//
// CSP rules applied to /booking/:slug pages (set by vercel.json):
//   - No inline <script> tags
//   - No inline event handlers (onclick=, etc.)
// Every interaction is wired through the delegation framework below,
// keyed by data-booking-action attributes in HTML.
// =================================================================

// -------- DELEGATION FRAMEWORK --------
var bookingActionHandlers = {};
function bookingRegisterAction(name, fn) { bookingActionHandlers[name] = fn; }

document.addEventListener('click', function(e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-booking-action]') : null;
  if (!el) return;
  var action = el.getAttribute('data-booking-action');
  var h = bookingActionHandlers[action];
  if (h) h(e, el);
});

// =================================================================
// ORIGINAL BOOKING LANDING CODE (extracted from booking/index.html)
// =================================================================

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let coachingData = null;

async function init() {
  const params = new URLSearchParams(window.location.search);

  // Check if returning from successful checkout
  if (params.get('success') === '1') {
    await showConfirmation(params.get('coaching_id'));
    return;
  }

  // Get slug from URL path
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const slug = pathParts[pathParts.length - 1];
  if (!slug || slug === 'coaching') { showError(); return; }

  // Load coaching service
  const { data: coaching, error } = await sb
    .from('coaching_services')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();

  if (error || !coaching) { showError(); return; }
  coachingData = coaching;

  // Load creator name and currency
  const { data: profile } = await sb.from('public_profiles').select('username, display_currency, calendar_timezone').eq('user_id', coaching.user_id).maybeSingle();
  const creatorName = profile?.username || 'Creator';
  // Stash the creator's display currency for price formatting
  window._creatorCurrency = (profile && profile.display_currency) ? profile.display_currency : 'USD';
  // Stash the creator's timezone — slot generation uses this so bookers in any
  // timezone see the creator's actual working hours (converted to their local).
  // Fall back to UTC if not set (older accounts before this field existed).
  window._creatorTimezone = (profile && profile.calendar_timezone) ? profile.calendar_timezone : 'UTC';

  document.title = coaching.title + ' — Ryxa';
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = (coaching.description || '').slice(0, 160);

  // Check auth state for button text
  var { data: { session } } = await sb.auth.getSession();
  if (session?.user) hydrateSigninChip(session.user.email || '');
  renderCoaching(coaching, creatorName, !!session?.user);

  // Track page view
  if (creatorName && creatorName !== 'Creator') {
    trackPageView(creatorName, 'coaching', coaching.id);
  }
}

async function trackPageView(username, pageType, productId) {
  try {
    var raw = [navigator.userAgent || '', navigator.language || '', screen.width + 'x' + screen.height, new Date().getTimezoneOffset().toString()].join('|');
    var msgBuf = new TextEncoder().encode(raw);
    var hashBuf = await crypto.subtle.digest('SHA-256', msgBuf);
    var hashArr = Array.from(new Uint8Array(hashBuf));
    var visitorHash = hashArr.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    var params = { p_username: username, p_page_type: pageType, p_visitor_hash: visitorHash };
    if (productId) params.p_product_id = productId;
    await sb.rpc('record_page_view', params);
  } catch (e) { console.error('trackPageView failed:', e); }
}

function showError() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('error-page').style.display = 'flex';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

// Signed-in chip on top right
function hydrateSigninChip(email) {
  if (!email) return;
  document.getElementById('signin-chip-email').textContent = email;
  document.getElementById('signin-chip-avatar').textContent = (email[0] || 'U').toUpperCase();
  document.getElementById('signin-chip').style.display = 'inline-flex';
  document.getElementById('signin-popover-email').textContent = email;
}
function toggleSigninPopover(evt) {
  if (evt) evt.stopPropagation();
  var pop = document.getElementById('signin-popover');
  pop.style.display = pop.style.display === 'block' ? 'none' : 'block';
}
document.addEventListener('click', function(e) {
  var pop = document.getElementById('signin-popover');
  var chip = document.getElementById('signin-chip');
  if (pop && pop.style.display === 'block' && !pop.contains(e.target) && !chip.contains(e.target)) {
    pop.style.display = 'none';
  }
});
async function signOutAndReload() {
  await sb.auth.signOut();
  window.location.reload();
}

function formatDuration(minutes) {
  if (!minutes) return '';
  if (minutes < 60) return minutes + ' min';
  var hrs = Math.floor(minutes / 60);
  var mins = minutes % 60;
  if (mins === 0) return hrs + ' hour' + (hrs > 1 ? 's' : '');
  return hrs + 'h ' + mins + 'min';
}

function renderCoaching(coaching, creatorName, isLoggedIn) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('coaching-page').style.display = 'block';

  // Format a cents amount in the creator's currency
  function fmtPrice(cents) {
    var code = window._creatorCurrency || 'USD';
    var localeMap = { USD:'en-US', EUR:'en-IE', GBP:'en-GB', CAD:'en-CA', AUD:'en-AU', JPY:'ja-JP', INR:'en-IN', BRL:'pt-BR', MXN:'es-MX', CHF:'de-CH', SGD:'en-SG', SEK:'sv-SE', NOK:'nb-NO', NZD:'en-NZ', ZAR:'en-ZA' };
    var locale = localeMap[code] || 'en-US';
    var fractionDigits = (code === 'JPY') ? 0 : 2;
    try {
      return new Intl.NumberFormat(locale, { style:'currency', currency:code, minimumFractionDigits:fractionDigits, maximumFractionDigits:fractionDigits }).format(cents / 100);
    } catch (e) {
      return '$' + (cents / 100).toFixed(fractionDigits);
    }
  }

  // Cover
  var coverEl = document.getElementById('cp-cover');
  if (coaching.cover_image_path) {
    var url = sb.storage.from('coaching-covers').getPublicUrl(coaching.cover_image_path).data.publicUrl;
    coverEl.innerHTML = '<img class="coaching-cover" src="' + url + '" alt="Coaching session cover">';
  } else {
    coverEl.innerHTML = '<div class="coaching-cover-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>';
  }

  // Title & creator
  document.getElementById('cp-title').textContent = coaching.title;
  document.getElementById('cp-creator').innerHTML = 'by <a href="/' + escapeHtml(creatorName) + '">' + escapeHtml(creatorName) + '</a>';

  // Meta (price + duration)
  var metaHtml = '';
  if (coaching.price_cents > 0) {
    metaHtml += '<div class="coaching-price">' + fmtPrice(coaching.price_cents) + '</div>';
  } else {
    metaHtml += '<div class="coaching-price" style="color:#4ade80;">Free</div>';
  }
  if (coaching.duration_minutes) {
    metaHtml += '<div class="coaching-meta-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' + formatDuration(coaching.duration_minutes) + '</div>';
  }
  var bookingLabel = coaching.booking_type === 'ryxa_calendar' ? 'Pick a Time' : (coaching.booking_type === 'calendly' ? 'Scheduling Link' : 'Manual Booking');
  metaHtml += '<div class="coaching-meta-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' + bookingLabel + '</div>';
  document.getElementById('cp-meta').innerHTML = metaHtml;

  // Description
  document.getElementById('cp-desc').textContent = coaching.description || '';

  // Buy button
  var buyArea = document.getElementById('cp-buy-area');
  var consentHtml = isLoggedIn ? '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer;font-size:13px;color:var(--muted);"><input type="checkbox" id="marketing-consent" style="accent-color:#7c3aed;width:16px;height:16px;cursor:pointer;"> Get updates from this creator</label>' : '';
  if (coaching.price_cents === 0) {
    buyArea.innerHTML = '<button class="coaching-buy-btn" data-booking-action="book">' + (isLoggedIn ? 'Proceed to Booking' : 'Book for Free') + '</button>' + consentHtml;
  } else {
    buyArea.innerHTML = '<button class="coaching-buy-btn" data-booking-action="book">' + (isLoggedIn ? 'Proceed to Booking' : 'Book Now') + '</button>' + consentHtml;
  }
}

async function bookCoaching() {
  var { data: { session } } = await sb.auth.getSession();
  if (!session?.user) {
    window.location.href = '/learn/?redirect=' + encodeURIComponent(window.location.pathname);
    return;
  }

  // For Ryxa Calendar bookings, show the date/time picker first
  if (coachingData.booking_type === 'ryxa_calendar') {
    showPicker();
    return;
  }

  await proceedWithBooking(null);
}

async function proceedWithBooking(slotInfo) {
  var btn = document.querySelector('.coaching-buy-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Booking...'; }

  try {
    var consentCheck = document.getElementById('marketing-consent');
    var marketingConsent = consentCheck ? consentCheck.checked : false;

    var requestBody = {
      coaching_id: coachingData.id,
      marketing_consent: marketingConsent
    };

    // Add slot info for Ryxa Calendar bookings
    if (slotInfo) {
      requestBody.slot_start = slotInfo.start_at;
      requestBody.slot_end = slotInfo.end_at;
      requestBody.slot_timezone = slotInfo.timezone;
      requestBody.reservation_id = slotInfo.reservation_id;
    }

    if (coachingData.price_cents === 0) {
      // Free booking
      requestBody.free_booking = true;
      var { data, error } = await sb.functions.invoke('create-coaching-checkout', { body: requestBody });
      if (error || !data || data.error) {
        throw new Error((data && data.error) || error?.message || 'Failed to book');
      }
      window.location.href = '/booking/' + coachingData.slug + '?success=1&coaching_id=' + coachingData.id;
      return;
    }

    // Paid booking — Stripe checkout
    requestBody.success_url = window.location.origin + '/booking/' + coachingData.slug + '?success=1&coaching_id=' + coachingData.id;
    requestBody.cancel_url = window.location.href;

    var { data, error } = await sb.functions.invoke('create-coaching-checkout', { body: requestBody });
    if (error || !data || data.error) {
      throw new Error((data && data.error) || error?.message || 'Failed to create checkout');
    }
    window.location.href = data.checkout_url;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Book Now'; }
    alert('Failed: ' + err.message);
  }
}

// =====================
// RYXA CALENDAR PICKER
// =====================
var pickerState = {
  selectedDate: null, // YYYY-MM-DD
  selectedTime: null, // ISO start
  selectedSlot: null, // full slot object
  bookedSlots: [], // existing bookings { start_at, end_at }
  reservedSlots: [], // active reservations { start_at, end_at }
  bookerTz: Intl.DateTimeFormat().resolvedOptions().timeZone
};

async function showPicker() {
  document.getElementById('coaching-page').style.display = 'none';
  document.getElementById('picker-page').style.display = 'block';
  document.getElementById('picker-tz-name').textContent = pickerState.bookerTz.replace(/_/g, ' ');

  // Get marketing consent before navigating away
  var consentCheck = document.getElementById('marketing-consent');
  pickerState.marketingConsent = consentCheck ? consentCheck.checked : false;

  // Load existing bookings + active reservations
  await loadBookedSlots();

  renderPickerDates();
  document.getElementById('picker-times-wrap').innerHTML = '<div class="picker-empty">Select a date to see available times.</div>';
  document.getElementById('picker-summary-wrap').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closePicker() {
  document.getElementById('picker-page').style.display = 'none';
  document.getElementById('coaching-page').style.display = 'block';
  pickerState.selectedDate = null;
  pickerState.selectedTime = null;
  pickerState.selectedSlot = null;
}

async function loadBookedSlots() {
  pickerState.bookedSlots = [];
  pickerState.reservedSlots = [];
  try {
    // Step 1: get all of this creator's coaching service IDs.
    // We need this so we can find bookings/reservations across ALL their services
    // (not just the one being viewed) to prevent double-booking.
    var { data: services } = await sb.from('coaching_services')
      .select('id')
      .eq('user_id', coachingData.user_id);
    var serviceIds = (services || []).map(function(s) { return s.id; });

    // Existing confirmed bookings across all of the creator's services.
    // Read through `public_coaching_booked_slots` view which exposes only
    // slot timing columns (no buyer_email, no payment data) and pre-filters
    // bookings without a scheduled slot.
    if (serviceIds.length > 0) {
      var { data: bookings } = await sb.from('public_coaching_booked_slots')
        .select('slot_start, slot_end')
        .in('coaching_id', serviceIds);
      if (bookings) {
        pickerState.bookedSlots = pickerState.bookedSlots.concat(bookings.map(function(b) {
          return { start_at: b.slot_start, end_at: b.slot_end };
        }));
      }
    }

    // Calendar events — manually added events also block slots so the creator
    // doesn't get double-booked over personal events. We use an RPC that returns
    // only start/end times (no titles or notes) to keep events private.
    var { data: busyEvents } = await sb.rpc('get_creator_busy_slots', {
      p_creator_id: coachingData.user_id
    });
    if (busyEvents && busyEvents.length) {
      pickerState.bookedSlots = pickerState.bookedSlots.concat(busyEvents.map(function(e) {
        return { start_at: e.start_at, end_at: e.end_at };
      }));
    }

    // Active reservations (not yet expired). Read through the
    // `public_coaching_availability` view which exposes only slot
    // timing columns (no booker_id) and pre-filters expired holds.
    if (serviceIds.length > 0) {
      var { data: reservations } = await sb.from('public_coaching_availability')
        .select('slot_start, slot_end')
        .in('coaching_id', serviceIds);
      if (reservations) {
        pickerState.reservedSlots = reservations.map(function(r) {
          return { start_at: r.slot_start, end_at: r.slot_end };
        });
      }
    }
  } catch (e) {
    console.warn('Could not load existing slots:', e);
  }
}

function renderPickerDates() {
  var avail = coachingData.availability_settings || {};
  var windowDays = avail.booking_window_days || 14;
  var leadHours = typeof avail.lead_time_hours === 'number' ? avail.lead_time_hours : 24;
  var dayKeys = ['sun','mon','tue','wed','thu','fri','sat'];
  var monthsShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  var earliest = new Date(Date.now() + leadHours * 60 * 60 * 1000);
  var html = '';
  var hasAny = false;

  for (var i = 0; i < windowDays; i++) {
    var date = new Date();
    date.setDate(date.getDate() + i);
    date.setHours(0, 0, 0, 0);

    var dayKey = dayKeys[date.getDay()];
    var dayConf = (avail.days && avail.days[dayKey]) || { enabled: false };
    var ymd = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');

    // Disable if day not enabled, or if entire day is before lead time
    var dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    var disabled = !dayConf.enabled || dayEnd < earliest;

    var weekdayLabel = ['SUN','MON','TUE','WED','THU','FRI','SAT'][date.getDay()];
    var btnClass = 'picker-date-btn' + (disabled ? ' disabled' : '') + (pickerState.selectedDate === ymd ? ' selected' : '');
    var onClick = disabled ? '' : ' data-booking-action="pick-date" data-booking-date="' + ymd + '"';

    html += '<button class="' + btnClass + '"' + onClick + '>'
      + '<div class="picker-date-day">' + weekdayLabel + '</div>'
      + '<div class="picker-date-num">' + date.getDate() + '</div>'
      + '<div class="picker-date-mo">' + monthsShort[date.getMonth()] + '</div>'
      + '</button>';
    if (!disabled) hasAny = true;
  }

  document.getElementById('picker-dates').innerHTML = html;
  if (!hasAny) {
    document.getElementById('picker-times-wrap').innerHTML = '<div class="picker-empty">No available dates in the booking window. Please contact the creator directly.</div>';
  }
}

function selectPickerDate(ymd) {
  pickerState.selectedDate = ymd;
  pickerState.selectedTime = null;
  pickerState.selectedSlot = null;
  document.getElementById('picker-summary-wrap').style.display = 'none';
  renderPickerDates();
  renderPickerTimes();
}

// Build a UTC Date object for a given local time in a specific IANA timezone.
// E.g., creatorLocalToUtc('2026-04-29', 9, 0, 'America/Los_Angeles') returns
// the Date corresponding to "9:00 AM PDT on April 29, 2026" in UTC.
function creatorLocalToUtc(ymd, hours, minutes, timezone) {
  var parts = ymd.split('-').map(Number);
  // First, build a candidate UTC time treating the local fields naively
  var naiveUtc = Date.UTC(parts[0], parts[1] - 1, parts[2], hours, minutes, 0, 0);
  // Now figure out what that same instant looks like in the target timezone
  // and compute the offset between naive and actual
  var dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  var fParts = {};
  dtf.formatToParts(new Date(naiveUtc)).forEach(function(p) {
    if (p.type !== 'literal') fParts[p.type] = parseInt(p.value, 10);
  });
  // Treat fParts as if it's UTC, find the difference from naiveUtc
  var asUtc = Date.UTC(
    fParts.year, fParts.month - 1, fParts.day,
    fParts.hour === 24 ? 0 : fParts.hour, fParts.minute, fParts.second
  );
  var offset = naiveUtc - asUtc;
  // The actual UTC moment is naiveUtc + offset
  return new Date(naiveUtc + offset);
}

// Get the day-of-week (0=Sun..6=Sat) for a YYYY-MM-DD date as it falls in a specific timezone
function dayOfWeekInTz(ymd, timezone) {
  // Use noon UTC of that date to avoid edge-case timezone shifts crossing midnight
  var parts = ymd.split('-').map(Number);
  var noonUtc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  var dayName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(noonUtc);
  var map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return map[dayName] != null ? map[dayName] : new Date(parts[0], parts[1] - 1, parts[2]).getDay();
}

function renderPickerTimes() {
  var avail = coachingData.availability_settings || {};
  var duration = avail.duration_minutes || 30;
  var buffer = typeof avail.buffer_minutes === 'number' ? avail.buffer_minutes : 0;
  var leadHours = typeof avail.lead_time_hours === 'number' ? avail.lead_time_hours : 24;
  var dayKeys = ['sun','mon','tue','wed','thu','fri','sat'];

  var creatorTz = window._creatorTimezone || 'UTC';
  // Day-of-week is determined in the CREATOR's timezone — that's whose schedule we follow
  var dayKey = dayKeys[dayOfWeekInTz(pickerState.selectedDate, creatorTz)];
  var dayConf = (avail.days && avail.days[dayKey]) || null;

  if (!dayConf || !dayConf.enabled) {
    document.getElementById('picker-times-wrap').innerHTML = '<div class="picker-empty">Not available on this day.</div>';
    return;
  }

  var startParts = (dayConf.start || '09:00').split(':').map(Number);
  var endParts = (dayConf.end || '17:00').split(':').map(Number);

  // Generate slots in CREATOR's timezone (their working hours), then display in BOOKER's local time
  // Each slot's start/end is a real UTC moment, regardless of who's viewing
  var slotStart = creatorLocalToUtc(pickerState.selectedDate, startParts[0], startParts[1], creatorTz);
  var dayEnd = creatorLocalToUtc(pickerState.selectedDate, endParts[0], endParts[1], creatorTz);

  var earliest = new Date(Date.now() + leadHours * 60 * 60 * 1000);
  var slots = [];

  while (slotStart.getTime() + duration * 60 * 1000 <= dayEnd.getTime()) {
    var slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

    // Check lead time
    if (slotStart < earliest) {
      slotStart = new Date(slotStart.getTime() + 15 * 60 * 1000);
      continue;
    }

    // Check if conflicts with booked or reserved slot
    var startIso = slotStart.toISOString();
    var endIso = slotEnd.toISOString();
    var conflict = false;
    var allBlocked = pickerState.bookedSlots.concat(pickerState.reservedSlots);
    for (var i = 0; i < allBlocked.length; i++) {
      var bs = new Date(allBlocked[i].start_at).getTime();
      var be = new Date(allBlocked[i].end_at).getTime();
      var ss = slotStart.getTime();
      var se = slotEnd.getTime();
      // Overlap check
      if (ss < be && se > bs) { conflict = true; break; }
    }

    if (!conflict) {
      slots.push({ start: new Date(slotStart), end: slotEnd });
    }

    // Advance by duration + buffer
    slotStart = new Date(slotStart.getTime() + (duration + buffer) * 60 * 1000);
  }

  if (slots.length === 0) {
    document.getElementById('picker-times-wrap').innerHTML = '<div class="picker-empty">No available times on this date. Try another day.</div>';
    return;
  }

  var html = '<div class="picker-time-grid">';
  slots.forEach(function(s) {
    // Display in the BOOKER's local timezone (toLocaleTimeString defaults to local)
    var label = s.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    var iso = s.start.toISOString();
    var endIso = s.end.toISOString();
    var selectedClass = pickerState.selectedTime === iso ? ' selected' : '';
    html += '<button class="picker-time-btn' + selectedClass + '" data-booking-action="pick-time" data-booking-iso="' + iso + '" data-booking-end-iso="' + endIso + '">' + label + '</button>';
  });
  html += '</div>';
  document.getElementById('picker-times-wrap').innerHTML = html;
}

function selectPickerTime(startIso, endIso) {
  pickerState.selectedTime = startIso;
  pickerState.selectedSlot = { start_at: startIso, end_at: endIso, timezone: pickerState.bookerTz };
  renderPickerTimes();

  // Show summary
  var startDate = new Date(startIso);
  var endDate = new Date(endIso);
  var dateStr = startDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  var timeStr = startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' - ' + endDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  document.getElementById('picker-summary-text').textContent = dateStr + ' at ' + timeStr;
  document.getElementById('picker-summary-wrap').style.display = 'block';
}

async function confirmPickerSelection() {
  if (!pickerState.selectedSlot) return;

  var btn = document.getElementById('picker-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Reserving slot...';

  try {
    // Create slot reservation (10-min hold)
    var { data: { session } } = await sb.auth.getSession();
    if (!session?.user) throw new Error('Sign in required');

    var expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    var { data: reservation, error } = await sb.from('coaching_slot_reservations').insert({
      coaching_id: coachingData.id,
      booker_id: session.user.id,
      slot_start: pickerState.selectedSlot.start_at,
      slot_end: pickerState.selectedSlot.end_at,
      booker_timezone: pickerState.bookerTz,
      expires_at: expiresAt
    }).select().single();

    if (error) throw error;

    // Pass reservation info to checkout flow
    pickerState.selectedSlot.reservation_id = reservation.id;

    // Restore consent state for proceedWithBooking
    var consentCheck = document.getElementById('marketing-consent');
    if (consentCheck) consentCheck.checked = pickerState.marketingConsent;

    await proceedWithBooking(pickerState.selectedSlot);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Continue to Checkout';
    alert('Could not reserve slot: ' + err.message + '. Someone may have just booked it. Please pick another time.');
    // Reload booked slots in case it was taken
    await loadBookedSlots();
    renderPickerTimes();
  }
}

async function showConfirmation(coachingId) {
  document.getElementById('loading').style.display = 'none';

  // Load coaching data for confirmation
  if (coachingId) {
    var { data: coaching } = await sb.from('coaching_services').select('*').eq('id', coachingId).maybeSingle();
    if (coaching) {
      document.getElementById('confirm-sub').textContent = 'Your payment for "' + coaching.title + '" was successful.';

      // Get creator contact info
      var { data: creatorProfile } = await sb.from('public_profiles').select('username').eq('user_id', coaching.user_id).maybeSingle();
      var creatorName = creatorProfile?.username || '';

      // Build the "Having trouble booking?" contact card. We surface the
      // creator's bio page link so the booker can reach out if needed.
      var contactHtml = '<div style="margin-top:20px;margin-bottom:24px;padding:14px 18px;background:var(--surface);border:1px solid var(--border);border-radius:10px;text-align:center;">'
        + '<p style="font-size:13px;color:var(--muted);margin-bottom:6px;">Having trouble booking?</p>';
      if (creatorName) {
        contactHtml += '<p style="font-size:13px;color:var(--muted);">Visit the creator\'s page: <a href="/' + escapeHtml(creatorName) + '" style="color:var(--accent2);text-decoration:none;font-weight:600;">@' + escapeHtml(creatorName) + '</a></p>';
      }
      contactHtml += '</div>';

      var bodyEl = document.getElementById('confirm-body');
      if (coaching.booking_type === 'ryxa_calendar') {
        // Look up the booking with slot info
        try {
          var { data: { session } } = await sb.auth.getSession();
          if (session?.user) {
            var { data: booking } = await sb.from('coaching_bookings')
              .select('slot_start, slot_end')
              .eq('coaching_id', coachingId)
              .eq('user_id', session.user.id)
              .order('booked_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (booking && booking.slot_start) {
              var startDate = new Date(booking.slot_start);
              var endDate = new Date(booking.slot_end);
              var dateStr = startDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
              var timeStr = startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' - ' + endDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
              bodyEl.innerHTML = '<div class="confirm-manual">'
                + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:10px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
                + '<p style="font-size:15px;color:var(--text);margin-bottom:8px;font-weight:600;">' + escapeHtml(dateStr) + '</p>'
                + '<p style="font-size:14px;color:var(--muted);">' + escapeHtml(timeStr) + '</p>'
                + '<p style="font-size:13px;color:var(--muted);margin-top:14px;">Your session is confirmed. The creator will reach out with meeting details.</p>'
                + '</div>' + contactHtml;
            } else {
              bodyEl.innerHTML = '<div class="confirm-manual"><p>Your booking is confirmed. The creator will reach out shortly.</p></div>' + contactHtml;
            }
          }
        } catch (e) {
          bodyEl.innerHTML = '<div class="confirm-manual"><p>Your booking is confirmed. The creator will reach out shortly.</p></div>' + contactHtml;
        }
      } else if (coaching.booking_type === 'calendly' && coaching.calendly_url) {
        bodyEl.innerHTML = '<div class="calendly-embed" style="min-height:600px;"><iframe src="' + escapeHtml(coaching.calendly_url) + '" width="100%" height="700" frameborder="0" style="border-radius:12px;" id="scheduling-iframe"></iframe></div>'
          + '<p style="font-size:13px;color:var(--muted);margin-bottom:8px;">Pick a time that works for you above.</p>'
          + '<p style="font-size:12px;color:var(--muted);margin-bottom:4px;">If the scheduler doesn\'t load, <a href="' + escapeHtml(coaching.calendly_url) + '" target="_blank" style="color:var(--accent2);">click here to open it directly</a>.</p>'
          + contactHtml;
      } else {
        // Manual booking message
        bodyEl.innerHTML = '<div class="confirm-manual">'
          + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:10px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>'
          + '<p>The creator will reach out to you via email to schedule your session. Keep an eye on your inbox!</p>'
          + '</div>'
          + contactHtml;
      }
    }
  }

  document.getElementById('confirm-page').style.display = 'block';
}

init();


// =================================================================
// ACTION REGISTRATIONS - wire data-booking-action attributes to handlers
// =================================================================

bookingRegisterAction('toggle-signin-popover', function(e) {
  toggleSigninPopover(e);
});

bookingRegisterAction('signout', function() {
  signOutAndReload();
});

bookingRegisterAction('book', function() {
  bookCoaching();
});

bookingRegisterAction('close-picker', function() {
  closePicker();
});

bookingRegisterAction('confirm-picker', function() {
  confirmPickerSelection();
});

bookingRegisterAction('pick-date', function(e, el) {
  var ymd = el.getAttribute('data-booking-date');
  if (ymd) selectPickerDate(ymd);
});

bookingRegisterAction('pick-time', function(e, el) {
  var iso = el.getAttribute('data-booking-iso');
  var endIso = el.getAttribute('data-booking-end-iso');
  if (iso && endIso) selectPickerTime(iso, endIso);
});
