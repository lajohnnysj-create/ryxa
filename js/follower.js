// =============================================================================
// /js/follower.js — Follow-Back Audit (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Follow-Back Audit tool.
//
// History: this tool started life as its own standalone follower-audit.html
// page, was inlined into dashboard.html (single-page experience), and is now
// extracted back out to its own JS module. The markup still lives in
// dashboard.html for now (in two pieces: the main tool block and the
// instructions modal at body level).
//
// Behavior preserved:
//   • The audit code's native ZIP drag-and-drop listeners use
//     addEventListener('dragover'/'dragleave'/'drop') on the zip-zone — not
//     inline on* attributes. They are preserved as-is.
//   • The audit code has its own document-level keydown listener for the ESC
//     key (closes the instructions modal). Preserved.
//   • The audit's existing per-row JS template handlers (toggle/submit/note
//     buttons) are converted to data-follower-action attributes; the
//     delegation infrastructure is namespaced 'follower' to avoid collisions
//     with any other tool.
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/follower.js
//   • Phase 2: inline onclick/oninput/onkeydown → data-follower-action attrs
//   • Phase 3: static inline class="bio-s-6eae3a" → hash-named CSS classes
//
// INTENTIONALLY KEPT INLINE: 2 hover handlers on the instructions-link button.
//
// External dependencies on window:
//   • sb, currentUser, userTier, isPro, escapeHtml, startCheckout
//   • JSZip (CDN, loaded at top of dashboard.html with defer)
//   • showModalConfirm (defined in js/design.js)
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE
// =============================================================================

const followerActions = {};

function followerRegisterAction(action, handler) {
  followerActions[action] = handler;
}

function followerFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['followerAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.followerAction) {
        const wantEvent = el.dataset.followerEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.followerAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function followerDispatchEvent(event) {
  const found = followerFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = followerActions[found.action];
  if (!handler) {
    console.warn('[follower] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur', 'keydown'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, followerDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- Follower Audit code begins here ----------
// All DOM IDs are prefixed `fa-` to avoid collisions with other tools.

// Instructions modal
function faOpenInstructions() {
  const m = document.getElementById('fa-instr-modal');
  if (!m) return;
  m.classList.add('open');
  const scrollEl = m.querySelector('.fa-instr-modal-scroll');
  if (scrollEl) scrollEl.scrollTop = 0;
  document.body.style.overflow = 'hidden';
}
function faCloseInstructions() {
  const m = document.getElementById('fa-instr-modal');
  if (!m) return;
  m.classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const m = document.getElementById('fa-instr-modal');
    if (m && m.classList.contains('open')) faCloseInstructions();
  }
});

// ── STATE ──
let faFollowersData = [];
let faFollowingData = [];
let faAllResults = [];
let faCurrentFilter = 'unfollowers';
let faUserWhitelist = new Set();
let faAccountNotes = {};
let faAuditHistory = [];
let faLastAuditUnfollowers = new Set();
let faUnfollowerLog = [];
let faCurrentLogFilter = 'all';
let faUserSnakeList = new Set();
let faSnakeListDates = {};

const FA_FREE_LIMIT = 10;

// ── INIT (called once when tool first opened) ──
// ── SETUP LISTENERS (always runs, no auth needed) ──
function faSetupListeners() {
  const zipInput = document.getElementById('fa-zip-input');
  const zipZone = document.getElementById('fa-zip-zone');
  if (zipZone) {
    zipZone.addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
      zipZone.classList.add('drag-over');
    });
    zipZone.addEventListener('dragleave', e => {
      e.preventDefault();
      e.stopPropagation();
      // Ignore dragleave when moving onto a child element. Without this,
      // the class flickers on/off as the cursor crosses children (icon,
      // label, sublabel, the invisible file input that overlays everything).
      if (e.relatedTarget && zipZone.contains(e.relatedTarget)) return;
      zipZone.classList.remove('drag-over');
    });
    zipZone.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      zipZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) faHandleZip(file);
    });
  }
  if (zipInput) {
    zipInput.addEventListener('change', () => {
      if (zipInput.files[0]) faHandleZip(zipInput.files[0]);
    });
  }
}

// ── LOAD DATA (needs auth) ──
async function faLoadData() {
  if (!currentUser) return;

  await Promise.all([
    faLoadWhitelist(),
    faLoadAuditHistory(),
    faLoadNotes(),
    faLoadSnakeList(),
  ]);

  faShowDashboard();
}

function faShowDashboard() {
  const results = document.getElementById('fa-results');
  if (results) results.style.display = 'block';

  // Upgrade banner
  const upgradeBanner = document.getElementById('fa-upgrade-banner');
  if (upgradeBanner) upgradeBanner.classList.toggle('visible', !isPro());

  // Last audit date
  const lastAuditMsg = document.getElementById('fa-last-audit-msg');
  if (lastAuditMsg) {
    if (isPro() && faAuditHistory.length > 0) {
      const lastDate = new Date(faAuditHistory[0].created_at);
      const formatted = lastDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      lastAuditMsg.innerHTML = `, you last ran an audit on <strong class="follower-s-f045bb">${formatted}</strong>`;
    } else {
      lastAuditMsg.innerHTML = '';
    }
  }

  const welcome = document.getElementById('fa-dashboard-welcome');
  if (welcome) welcome.classList.add('visible');

  faUpdateToolBtns();

  if (!faAllResults.length) {
    const scroll = document.getElementById('fa-results-list-scroll');
    if (scroll) scroll.innerHTML = `<div class="fa-no-analysis-msg">
      <span class="emoji"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>
      No analysis yet. Upload your Instagram JSON files above and click <strong>Analyze Now</strong> to see your results.<br><br>
      <a href="#" data-follower-action="open-instructions">Need help getting your files? →</a>
    </div>`;

    if (faUserWhitelist.size > 0) {
      const wlTab = document.getElementById('fa-whitelist-tab');
      if (wlTab) faSetFilter('whitelist', wlTab);
    } else if (faUserSnakeList.size > 0 && isPro()) {
      const snakeTab = document.getElementById('fa-snake-tab');
      if (snakeTab) faSetFilter('snakes', snakeTab);
    }
  }
}

// ── WHITELIST ──
async function faLoadWhitelist() {
  if (!currentUser) return;
  const { data } = await sb.from('whitelist').select('handle').eq('user_id', currentUser.id);
  if (data) {
    faUserWhitelist = new Set(data.map(r => r.handle.toLowerCase()));
    faUpdateWhitelistTabCount();
    faFilterResults();
  }
}
function faUpdateWhitelistTabCount() {
  const wlTabCount = document.getElementById('fa-wl-tab-count');
  if (wlTabCount) {
    if (faUserWhitelist.size > 0) { wlTabCount.textContent = faUserWhitelist.size; wlTabCount.style.display = 'inline'; }
    else wlTabCount.style.display = 'none';
  }
}
async function faToggleWhitelist(handle) {
  if (!currentUser || !isPro()) return;
  handle = handle.toLowerCase();
  if (faUserWhitelist.has(handle)) {
    faUserWhitelist.delete(handle);
    faShowMiniToast(`@${handle} removed from whitelist`);
    faFilterResults();
    if (faCurrentFilter === 'whitelist') faRenderWhitelistSection();
    sb.functions.invoke('manage-whitelist', { body: { userId: currentUser.id, handle, action: 'remove' } });
  } else {
    faUserWhitelist.add(handle);
    faShowMiniToast(`@${handle} added to whitelist, hidden from results`);
    faFilterResults();
    if (faCurrentFilter === 'whitelist') faRenderWhitelistSection();
    sb.functions.invoke('manage-whitelist', { body: { userId: currentUser.id, handle, action: 'add' } });
  }
  faUpdateWhitelistTabCount();
}
async function faClearWhitelist() {
  if (!currentUser || !isPro()) return;
  showModalConfirm(
    'Clear whitelist?',
    'This will remove every account from your whitelist. Hidden accounts will reappear in your audit results. This cannot be undone.',
    function() {
      sb.functions.invoke('manage-whitelist', { body: { userId: currentUser.id, action: 'clear' } });
      faUserWhitelist.clear();
      faShowMiniToast('Whitelist cleared');
      faFilterResults();
    },
    'Clear whitelist',
    'Cancel'
  );
}
function faShowMiniToast(msg) {
  // Delegates to the dashboard's slide-in toast for a consistent style.
  if (typeof showDashToast === 'function') {
    showDashToast('success', msg);
    return;
  }
  document.querySelectorAll('.fa-whitelist-toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'fa-whitelist-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── AUDIT HISTORY ──
async function faSaveAudit() {
  if (!currentUser || !isPro()) return;
  const unfollowerCount = faAllResults.filter(r => !r.mutual && !r.followerOnly).length;
  const mutualCount = faAllResults.filter(r => r.mutual).length;
  const followerOnlyCount = faAllResults.filter(r => r.followerOnly).length;
  await sb.functions.invoke('save-audit', {
    body: {
      userId: currentUser.id, unfollowerCount, mutualCount, followerOnlyCount,
      totalFollowing: faAllResults.filter(r => !r.followerOnly).length,
      totalFollowers: faAllResults.filter(r => r.mutual || r.followerOnly).length,
    }
  });
  await faLoadAuditHistory();
}
async function faLoadAuditHistory() {
  if (!currentUser || !isPro()) return;
  const { data } = await sb.from('audits')
    .select('id, created_at, unfollower_count, mutual_count, follower_only_count, total_following, total_followers')
    .eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(1);
  if (data) {
    faAuditHistory = data;
    faLastAuditUnfollowers = new Set();
    const lastAuditMsg = document.getElementById('fa-last-audit-msg');
    if (lastAuditMsg && faAuditHistory.length > 0) {
      const lastDate = new Date(faAuditHistory[0].created_at);
      const formatted = lastDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      lastAuditMsg.innerHTML = `, you last ran an audit on <strong class="follower-s-f045bb">${formatted}</strong>`;
    }
    faRenderAuditHistory();
  }
}
function faRenderAuditHistory() {
  const el = document.getElementById('fa-history-list');
  if (!el) return;
  if (!faAuditHistory.length) { el.innerHTML = '<div class="fa-history-empty">No audits yet. Run your first analysis to start tracking!</div>'; return; }
  el.innerHTML = faAuditHistory.slice(0, 1).map((audit) => {
    const date = new Date(audit.created_at);
    const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `<div class="fa-audit-card open" id="fa-audit-${audit.id}">
      <div class="fa-audit-card-header">
        <div class="fa-audit-card-left"><div><div class="fa-audit-date">${dateStr} <span class="follower-s-c1a430">${timeStr}</span></div><div class="fa-audit-meta">${audit.total_following} following · ${audit.total_followers} followers</div></div></div>
        <div class="follower-s-f62967"><div class="fa-audit-stats"><div class="fa-audit-stat danger"><strong>${audit.unfollower_count}</strong> not following back</div><div class="fa-audit-stat"><strong>${audit.mutual_count}</strong> mutual</div></div><button class="fa-audit-delete-btn" data-follower-action="delete-audit" data-follower-audit-id="${audit.id}">Delete</button></div>
      </div>
      <div class="fa-audit-body"><div class="follower-s-ce2f3d">Run a new audit anytime to see the full updated list. Individual usernames aren't stored, only counts, to keep your data private.</div></div>
    </div>`;
  }).join('');
}
async function faDeleteAudit(id, e) {
  e.stopPropagation();
  showModalConfirm(
    'Delete this audit?',
    'This audit will be permanently removed from your history. This cannot be undone.',
    async function() {
      await sb.from('audits').delete().eq('id', id).eq('user_id', currentUser.id);
      faAuditHistory = faAuditHistory.filter(a => a.id !== id);
      faRenderAuditHistory();
    },
    'Delete',
    'Cancel'
  );
}

// ── NOTES ──
async function faLoadNotes() {
  if (!currentUser || !isPro()) return;
  const { data } = await sb.from('account_notes').select('handle, note').eq('user_id', currentUser.id);
  if (data) {
    faAccountNotes = {};
    data.forEach(r => { faAccountNotes[r.handle.toLowerCase()] = r.note; });
    if (faAllResults.length) faFilterResults();
  }
}
async function faSaveNote(handle, note) {
  if (!currentUser || !isPro()) return;
  handle = handle.toLowerCase();
  if (note.trim() === '') {
    delete faAccountNotes[handle];
    faShowMiniToast(`Note removed for @${handle}`);
    sb.from('account_notes').delete().eq('user_id', currentUser.id).eq('handle', handle);
  } else {
    faAccountNotes[handle] = note.trim();
    faShowMiniToast(`Note saved for @${handle}`);
    sb.from('account_notes').upsert({ user_id: currentUser.id, handle, note: note.trim(), updated_at: new Date().toISOString() }, { onConflict: 'user_id,handle' });
  }
  if (faCurrentFilter === 'snakes') faRenderSnakeList();
  else if (faCurrentFilter === 'whitelist') faRenderWhitelistSection();
  else faFilterResults();
}
function faToggleNoteRow(handle) {
  if (!isPro()) { faShowMiniToast('Notes are available on the Pro plan'); return; }
  const row = document.getElementById('fa-note-row-' + handle);
  if (!row) return;
  const isVisible = row.classList.contains('visible');
  document.querySelectorAll('#tool-follower .fa-note-row.visible').forEach(r => r.classList.remove('visible'));
  if (!isVisible) row.classList.add('visible');
}
function faSubmitNote(handle) {
  const input = document.getElementById('fa-note-input-' + handle);
  if (!input) return;
  faSaveNote(handle, input.value);
  const row = document.getElementById('fa-note-row-' + handle);
  if (row) row.classList.remove('visible');
}

// ── UNFOLLOWER LOG ──
async function faLoadUnfollowerLog() { return; }
function faSetLogFilter(f, btn) {
  faCurrentLogFilter = f;
  document.querySelectorAll('#fa-log-section .fa-filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  faRenderUnfollowerLog();
}
function faRenderUnfollowerLog() {
  const el = document.getElementById('fa-log-list-scroll');
  if (!el) return;
  const query = (document.getElementById('fa-log-search')?.value || '').toLowerCase().trim();
  let filtered = [...faUnfollowerLog];
  if (faCurrentLogFilter === 'active') filtered = filtered.filter(r => r.status === 'active');
  if (faCurrentLogFilter === 'gone') filtered = filtered.filter(r => r.status === 'gone');
  if (query) filtered = filtered.filter(r => r.handle.includes(query));
  if (!filtered.length) { el.innerHTML = '<div class="follower-s-e3378c">No unfollowers found.</div>'; return; }
  el.innerHTML = filtered.map(r => {
    const firstSeen = new Date(r.first_seen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const lastSeen = new Date(r.last_seen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const statusBadge = r.status === 'active' ? '<span class="follower-s-984c11">● Still not following</span>' : '<span class="follower-s-ff2e10">✓ Now following</span>';
    const note = faAccountNotes[r.handle] ? `<div class="follower-s-993847"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="follower-s-94ae5b"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>${faAccountNotes[r.handle]}</div>` : '';
    return `<div class="follower-s-0304e5"><div><a href="https://instagram.com/${r.handle}" target="_blank" rel="noopener" class="follower-s-e20266">@${r.handle}</a>${note}</div><div class="bio-s-e769ff">${firstSeen}</div><div class="bio-s-e769ff">${lastSeen}</div><div>${statusBadge}</div></div>`;
  }).join('');
}

// ── SNAKE LIST ──
async function faLoadSnakeList() {
  if (!currentUser) return;
  const { data } = await sb.from('snake_list').select('handle, created_at').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if (data && data.length > 0) {
    faUserSnakeList = new Set(data.map(r => r.handle.toLowerCase()));
    data.forEach(r => { faSnakeListDates[r.handle.toLowerCase()] = r.created_at; });
    faUpdateSnakeTabCount();
    if (faAllResults.length) faFilterResults();
  }
}
function faUpdateSnakeTabCount() {
  const badge = document.getElementById('fa-snake-tab-count');
  if (badge) {
    if (faUserSnakeList.size > 0 && isPro()) { badge.textContent = faUserSnakeList.size; badge.style.display = 'inline'; }
    else badge.style.display = 'none';
  }
}
async function faToggleSnakeList(handle) {
  if (!currentUser || !isPro()) return;
  handle = handle.toLowerCase();
  if (faUserSnakeList.has(handle)) {
    faUserSnakeList.delete(handle); delete faSnakeListDates[handle];
    faShowMiniToast(`@${handle} removed from Snake List`);
    faUpdateSnakeTabCount();
    if (faCurrentFilter === 'snakes') faRenderSnakeList(); else faFilterResults();
    sb.functions.invoke('manage-snake-list', { body: { userId: currentUser.id, handle, action: 'remove' } });
  } else {
    faUserSnakeList.add(handle); faSnakeListDates[handle] = new Date().toISOString();
    faShowMiniToast(`@${handle} added to your Snake List`);
    faUpdateSnakeTabCount();
    if (faCurrentFilter === 'snakes') faRenderSnakeList(); else faFilterResults();
    sb.functions.invoke('manage-snake-list', { body: { userId: currentUser.id, handle, action: 'add' } });
  }
}
function faBuildNoteEditor(handle, onSave) {
  const note = faAccountNotes[handle.toLowerCase()] || '';
  return `${note ? `<div class="fa-note-display course-s-a3a556" ><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="follower-s-84da42"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>${note}</div>` : ''}
    <div class="fa-note-row follower-s-2fd778" id="fa-section-note-row-${handle}" >
      <div class="fa-note-input-wrap"><input class="fa-note-input" maxlength="200" aria-label="Note for @${handle}" id="fa-section-note-input-${handle}" value="${note.replace(/"/g, '&quot;')}" placeholder="Add a private note…" data-follower-action-keydown="enter-submit-section-note" data-follower-handle="${handle}"><button class="fa-note-save-btn" data-follower-action="submit-section-note" data-follower-handle="${handle}">Save</button></div>
    </div>`;
}
function faSubmitSectionNote(handle) {
  const input = document.getElementById('fa-section-note-input-' + handle);
  if (!input) return;
  const row = document.getElementById('fa-section-note-row-' + handle);
  if (row) row.classList.remove('visible');
  faSaveNote(handle, input.value);
}
function faToggleSectionNoteRow(handle) {
  const row = document.getElementById('fa-section-note-row-' + handle);
  if (!row) return;
  document.querySelectorAll('#tool-follower .fa-note-row.visible').forEach(r => r.classList.remove('visible'));
  row.classList.toggle('visible');
}
function faRenderSnakeList() {
  const el = document.getElementById('fa-snake-list-container');
  if (!el) return;
  if (faUserSnakeList.size === 0) { el.innerHTML = '<div class="fa-snake-empty"><span class="emoji"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/></svg></span>Your Snake List is empty.<br>Add accounts from your results by clicking the user icon next to them.</div>'; return; }
  const items = [...faUserSnakeList].map(handle => ({ handle, created_at: faSnakeListDates[handle] || new Date().toISOString() }));
  el.innerHTML = `<div class="fa-snake-list-wrap"><div class="fa-snake-list-header"><span>Username</span><span>Added</span><span></span></div>
    ${items.map(r => {
      const date = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const hasNote = faAccountNotes[r.handle.toLowerCase()];
      return `<div class="fa-snake-list-item follower-s-cbf200" ><div class="follower-s-579542"><div class="bio-s-7623f0"><div class="bio-s-e3f610"><a href="https://instagram.com/${r.handle}" target="_blank" rel="noopener" class="follower-s-0a828c">@${r.handle}</a><button class="fa-note-icon-btn${hasNote ? ' has-note' : ''}" title="${hasNote ? 'Edit note' : 'Add note'}" data-follower-action="toggle-section-note-row" data-follower-handle="${r.handle}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button></div>${faBuildNoteEditor(r.handle, 'snake')}</div><div class="follower-s-18a77f"><span class="fa-snake-added-date">${date}</span><button class="fa-snake-remove-btn" title="Remove from Snake List" data-follower-action="toggle-snake" data-follower-handle="${r.handle}">✕</button></div></div></div>`;
    }).join('')}</div>`;
}
async function faClearSnakeList() {
  showModalConfirm(
    'Clear Snake List?',
    'This will remove every account from your Snake List. This cannot be undone.',
    function() {
      faUserSnakeList.clear(); faSnakeListDates = {};
      faUpdateSnakeTabCount(); faRenderSnakeList();
      faShowMiniToast('Snake List cleared');
      sb.functions.invoke('manage-snake-list', { body: { userId: currentUser.id, action: 'clear' } });
    },
    'Clear Snake List',
    'Cancel'
  );
}

// ── START OVER ──
function faStartOver() {
  faAllResults = [];
  faFollowersData = []; faFollowingData = [];
  const zipInput = document.getElementById('fa-zip-input');
  if (zipInput) zipInput.value = '';
  const zipFileList = document.getElementById('fa-zip-file-list');
  if (zipFileList) zipFileList.innerHTML = '';
  const zipStatus = document.getElementById('fa-zip-status');
  if (zipStatus) { zipStatus.textContent = ''; zipStatus.style.color = ''; }
  const btn = document.getElementById('fa-analyze-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '✦ &nbsp;Analyze Now'; }
  const sob = document.getElementById('fa-start-over-btn');
  if (sob) sob.classList.remove('visible');
  const scroll = document.getElementById('fa-results-list-scroll');
  const paywall = document.getElementById('fa-paywall-container');
  const statsRow = document.getElementById('fa-stats-row');
  const badge = document.getElementById('fa-results-badge');
  const newBadge = document.getElementById('fa-new-unfollower-badge');
  if (statsRow) statsRow.innerHTML = '';
  if (badge) { badge.textContent = ''; badge.style.display = 'none'; }
  if (newBadge) newBadge.style.display = 'none';
  if (paywall) paywall.innerHTML = '';
  if (isPro()) {
    if (scroll) scroll.innerHTML = `<div class="fa-no-analysis-msg"><span class="emoji"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>Upload your Instagram JSON files above and click <strong>Analyze Now</strong> to run a new analysis.<br><br><a href="#" data-follower-action="open-instructions">Need help getting your files? →</a></div>`;
    const welcome = document.getElementById('fa-dashboard-welcome');
    if (welcome) welcome.classList.add('visible');
    document.querySelectorAll('#tool-follower .fa-filter-tab').forEach(b => b.classList.remove('active'));
    const unfollowTab = document.querySelector('#tool-follower .fa-filter-tab');
    if (unfollowTab) unfollowTab.classList.add('active');
    faCurrentFilter = 'unfollowers';
  }
  document.getElementById('fa-zip-zone').scrollIntoView({ behavior: 'smooth' });
}

// ── TOOL BUTTONS ──
function faUpdateToolBtns() {
  faUpdateWhitelistTab();
  const isPaid = isPro();
  ['fa-print-btn', 'fa-csv-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (isPaid) btn.classList.remove('locked'); else btn.classList.add('locked');
  });
}
function faHandleToolBtn(type) {
  const isPaid = isPro();
  if (!isPaid) return;
  if (type === 'print') faPrintReport();
  if (type === 'csv') faExportCSV();
}

// ── CSV EXPORT ──
function faExportCSV() {
  const isPaid = isPro();
  if (!isPaid) return;
  const isMonthly = isPro();
  const date = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const rows = [];
  rows.push(['Ryxa. Full Export', '', '', '', '']);
  rows.push(['Generated:', date, '', '', '']);
  rows.push([]);
  const unfollowers = faAllResults.filter(r => !r.mutual && !r.followerOnly);
  const mutuals = faAllResults.filter(r => r.mutual);
  const followerOnly = faAllResults.filter(r => r.followerOnly);
  rows.push(['=== CURRENT ANALYSIS ===', '', '', '', '']);
  rows.push(['Total analyzed:', faAllResults.length, '', '', '']);
  rows.push(['Not following back:', unfollowers.length, '', '', '']);
  rows.push(['Mutual:', mutuals.length, '', '', '']);
  rows.push(['Follows you only:', followerOnly.length, '', '', '']);
  rows.push([]);
  rows.push(['--- NOT FOLLOWING BACK ---', '', '', '', '']);
  const nfbHeaders = ['Username', 'Instagram URL', 'Whitelisted'];
  if (isMonthly) { nfbHeaders.push('Note'); nfbHeaders.push('In Snake List'); }
  rows.push(nfbHeaders);
  unfollowers.forEach(r => {
    const row = [r.handle, 'https://instagram.com/' + r.handle, faUserWhitelist.has(r.handle.toLowerCase()) ? 'Yes' : 'No'];
    if (isMonthly) { row.push(faAccountNotes[r.handle.toLowerCase()] || ''); row.push(faUserSnakeList.has(r.handle.toLowerCase()) ? 'Yes' : 'No'); }
    rows.push(row);
  });
  rows.push([]);
  rows.push(['--- MUTUALS ---', '', '', '', '']);
  rows.push(['Username', 'Instagram URL', isMonthly ? 'Note' : '']);
  mutuals.forEach(r => { const row = [r.handle, 'https://instagram.com/' + r.handle]; if (isMonthly) row.push(faAccountNotes[r.handle.toLowerCase()] || ''); rows.push(row); });
  rows.push([]);
  rows.push(['--- FOLLOWS YOU ONLY ---', '', '', '', '']);
  rows.push(['Username', 'Instagram URL']);
  followerOnly.forEach(r => rows.push([r.handle, 'https://instagram.com/' + r.handle]));
  rows.push([]);
  if (isMonthly) {
    rows.push(['=== WHITELIST ===', '', '', '', '']);
    rows.push(['Total whitelisted:', faUserWhitelist.size]);
    rows.push([]);
    if (faUserWhitelist.size > 0) { rows.push(['Username', 'Instagram URL', 'Note']); faUserWhitelist.forEach(handle => { rows.push([handle, 'https://instagram.com/' + handle, faAccountNotes[handle] || '']); }); }
    rows.push([]);
    rows.push(['=== SNAKE LIST ===', '', '', '', '']);
    rows.push(['Total snakes:', faUserSnakeList.size]);
    rows.push([]);
    if (faUserSnakeList.size > 0) { rows.push(['Username', 'Instagram URL', 'Note']); faUserSnakeList.forEach(handle => { rows.push([handle, 'https://instagram.com/' + handle, faAccountNotes[handle] || '']); }); }
    rows.push([]);
    const noteEntries = Object.entries(faAccountNotes);
    rows.push(['=== ACCOUNT NOTES ===', '', '', '', '']);
    rows.push(['Total notes:', noteEntries.length]);
    rows.push([]);
    if (noteEntries.length > 0) { rows.push(['Username', 'Instagram URL', 'Note']); noteEntries.forEach(([handle, note]) => { rows.push([handle, 'https://instagram.com/' + handle, note]); }); }
    rows.push([]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const filename = 'ryxa-full-export-' + new Date().toISOString().slice(0,10) + '.csv';

  // Native app: WKWebView does not support the anchor download attribute,
  // so the CSV goes across the bridge to the iOS save/share sheet.
  if (window.RyxaNative && window.ReactNativeWebView) {
    const reader = new FileReader();
    reader.onload = function() {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'saveFile',
          filename: filename,
          mime: 'text/csv',
          base64: String(reader.result).split(',')[1] || ''
        }));
      } catch (e) { console.error('export bridge', e); }
    };
    reader.readAsDataURL(blob);
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);
}

// ── PRINT ──
function faPrintReport() {
  // Build a clean print-ready HTML doc in a hidden iframe and trigger print.
  // Same pattern as Contract Analyzer's caPrintReport — avoids the dashboard's
  // dark theme bleeding into the print output. All black text, white background.
  var iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  var doc = iframe.contentDocument || iframe.contentWindow.document;
  var html = buildFaPrintHTML();
  doc.open();
  doc.write(html);
  doc.close();

  iframe.onload = function() {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.error('print', e);
    }
    setTimeout(function() {
      try { document.body.removeChild(iframe); } catch (e) {}
    }, 1000);
  };
}

function buildFaPrintHTML() {
  // Cap each list section to this many rows. The print engine struggles to
  // paginate huge tables (thousands of rows = browser freeze). The full list
  // is always available via CSV Export.
  var PRINT_MAX_ROWS_PER_SECTION = 100;

  function esc(v) {
    if (v == null) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var pro = isPro();
  var date = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  var unfollowers = faAllResults.filter(function(r) { return !r.mutual && !r.followerOnly; });
  var mutuals = faAllResults.filter(function(r) { return r.mutual; });
  var followerOnly = faAllResults.filter(function(r) { return r.followerOnly; });

  function rowSection(title, rows, opts) {
    if (rows.length === 0) {
      return '<section><h2>' + esc(title) + '</h2><p class="muted">None.</p></section>';
    }
    var totalRows = rows.length;
    var displayRows = rows.slice(0, PRINT_MAX_ROWS_PER_SECTION);
    var truncated = totalRows > PRINT_MAX_ROWS_PER_SECTION;

    var head = '<tr><th>Username</th>';
    if (opts && opts.showWhitelist) head += '<th>Whitelist</th>';
    if (opts && opts.showSnake) head += '<th>Snake</th>';
    if (opts && opts.showNote) head += '<th>Note</th>';
    head += '</tr>';

    var body = displayRows.map(function(r) {
      var h = (r.handle || '').toLowerCase();
      var cells = '<td>@' + esc(r.handle) + '</td>';
      if (opts && opts.showWhitelist) cells += '<td>' + (faUserWhitelist.has(h) ? 'Yes' : '') + '</td>';
      if (opts && opts.showSnake) cells += '<td>' + (faUserSnakeList.has(h) ? 'Yes' : '') + '</td>';
      if (opts && opts.showNote) cells += '<td>' + esc(faAccountNotes[h] || '') + '</td>';
      return '<tr>' + cells + '</tr>';
    }).join('');

    var footer = '';
    if (truncated) {
      var more = totalRows - PRINT_MAX_ROWS_PER_SECTION;
      footer = '<p class="truncation">Showing first ' + PRINT_MAX_ROWS_PER_SECTION
        + ' of ' + totalRows + '. ' + more + ' more not shown — use CSV Export for the full list.</p>';
    }

    return '<section><h2>' + esc(title) + ' <span class="count">(' + totalRows + ')</span></h2>'
      + '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>'
      + footer + '</section>';
  }

  var summaryHtml = '<div class="summary"><div><strong>Not following back:</strong> ' + unfollowers.length + '</div>'
    + '<div><strong>Mutual:</strong> ' + mutuals.length + '</div>'
    + '<div><strong>Follows you only:</strong> ' + followerOnly.length + '</div>';
  if (pro) {
    summaryHtml += '<div><strong>Whitelisted:</strong> ' + faUserWhitelist.size + '</div>'
      + '<div><strong>Snake List:</strong> ' + faUserSnakeList.size + '</div>'
      + '<div><strong>Notes:</strong> ' + Object.keys(faAccountNotes).length + '</div>';
  }
  summaryHtml += '</div>';

  // For Pro users: include extra sections (Whitelist, Snake List, Notes)
  var extraSections = '';
  if (pro) {
    if (faUserWhitelist.size > 0) {
      var wlRows = Array.from(faUserWhitelist).map(function(h) { return { handle: h }; });
      extraSections += rowSection('Whitelist', wlRows, { showNote: true });
    }
    if (faUserSnakeList.size > 0) {
      var snRows = Array.from(faUserSnakeList).map(function(h) { return { handle: h }; });
      extraSections += rowSection('Snake List', snRows, { showNote: true });
    }
    var noteEntries = Object.entries(faAccountNotes);
    if (noteEntries.length > 0) {
      var notesRows = noteEntries.map(function(entry) { return { handle: entry[0] }; });
      extraSections += rowSection('Account Notes', notesRows, { showNote: true });
    }
  }

  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<title>Follow-Back Audit Report</title>'
    + '<style>'
    + '* { box-sizing: border-box; }'
    + 'html, body { margin: 0; padding: 0; background: #fff; color: #000; }'
    + 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.45; padding: 28px 36px; }'
    + 'h1 { font-size: 20pt; margin: 0 0 4px 0; font-weight: 700; }'
    + 'h2 { font-size: 13pt; margin: 20px 0 6px 0; padding-bottom: 4px; border-bottom: 1px solid #000; font-weight: 700; }'
    + 'h2 .count { font-weight: 400; font-size: 10pt; }'
    + '.meta { font-size: 10pt; margin-bottom: 12px; }'
    + '.summary { display: flex; flex-wrap: wrap; gap: 12px 24px; padding: 10px 0; border-top: 2px solid #000; border-bottom: 1px solid #000; margin-bottom: 4px; font-size: 10.5pt; }'
    + '.summary > div { white-space: nowrap; }'
    + 'section { margin-bottom: 4px; }'
    + 'table { width: 100%; border-collapse: collapse; font-size: 10pt; }'
    + 'thead { display: table-header-group; }'
    + 'tr { page-break-inside: avoid; }'
    + 'th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid #ddd; vertical-align: top; word-break: break-word; }'
    + 'th { font-weight: 700; background: #f3f3f3; }'
    + 'tr:last-child td { border-bottom: none; }'
    + '.muted { font-size: 10pt; font-style: italic; margin: 4px 0 8px 0; }'
    + '.truncation { font-size: 9pt; font-style: italic; color: #444; margin: 6px 0 4px 0; }'
    + '@page { margin: 0.5in; }'
    + '@media print { body { padding: 0; } }'
    + '</style></head><body>'
    + '<h1>Follow-Back Audit Report</h1>'
    + '<div class="meta">Generated on ' + esc(date) + '</div>'
    + summaryHtml
    + rowSection('Not Following Back', unfollowers, { showWhitelist: pro, showSnake: pro, showNote: pro })
    + rowSection('Mutuals', mutuals, { showNote: pro })
    + rowSection('Follows You Only', followerOnly)
    + extraSections
    + '</body></html>';
}

// ── FILE HANDLING ──
async function faHandleZip(file) {
  if (!file.name.endsWith('.zip')) { faShowError('Please upload a ZIP file.'); return; }
  faHideError();
  faFollowersData = []; faFollowingData = [];
  const statusEl = document.getElementById('fa-zip-status');
  const listEl = document.getElementById('fa-zip-file-list');
  listEl.innerHTML = '';
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = 'Reading ZIP file...';
  try {
    const zip = await JSZip.loadAsync(file);
    const found = [];
    zip.forEach((path, entry) => {
      if (entry.dir) return;
      const name = path.split('/').pop();
      if (/^followers_\d+\.json$/i.test(name) || /^following.*\.json$/i.test(name)) found.push({ path, name, entry });
    });
    if (found.length === 0) { faShowError('No followers or following files found in this ZIP.'); statusEl.textContent = ''; return; }
    for (const { name, entry } of found) {
      const text = await entry.async('string');
      try {
        const json = JSON.parse(text);
        if (/^followers_/i.test(name)) faFollowersData.push({ name, data: json });
        else faFollowingData.push({ name, data: json });
      } catch(e) { console.warn('Could not parse', name, e); }
    }
    if (faFollowersData.length === 0 || faFollowingData.length === 0) { faShowError(`Found files but missing ${faFollowersData.length === 0 ? 'followers' : 'following'} data.`); statusEl.textContent = ''; return; }
    listEl.innerHTML = `<div class="follower-s-e4a987"><div class="follower-s-287b38"><span class="follower-s-f3ba69"></span><span class="follower-s-7c9ac0">${faFollowersData.length} followers file${faFollowersData.length > 1 ? 's' : ''}</span></div><div class="follower-s-0c0252"><span class="follower-s-7668aa"></span><span class="follower-s-04ca32">${faFollowingData.length} following file${faFollowingData.length > 1 ? 's' : ''}</span></div></div>`;
    statusEl.style.color = '#4ade80';
    statusEl.textContent = `✓ Found ${faFollowersData.length} followers file${faFollowersData.length > 1 ? 's' : ''} and ${faFollowingData.length} following file${faFollowingData.length > 1 ? 's' : ''}, ready to analyze`;
    document.getElementById('fa-analyze-btn').disabled = false;
  } catch(err) { console.error('ZIP error:', err); faShowError('Could not read the ZIP file.'); statusEl.textContent = ''; }
}

// ── PARSE & ANALYZE ──
function faExtractHandles(datasets) {
  const handles = new Set();
  datasets.forEach(({ data }) => {
    const tryParse = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(item => {
          if (item.string_list_data) item.string_list_data.forEach(d => { if (d.value) handles.add(d.value.toLowerCase()); });
          if (item.title) handles.add(item.title.toLowerCase());
          if (typeof item === 'string') handles.add(item.toLowerCase());
        });
      } else if (typeof node === 'object') { Object.values(node).forEach(v => tryParse(v)); }
    };
    tryParse(data);
  });
  return handles;
}

function faAnalyze() {
  faHideError();
  const btn = document.getElementById('fa-analyze-btn');
  btn.disabled = true; btn.classList.add('processing');
  btn.innerHTML = '<span class="fa-btn-spinner"></span><span class="fa-processing-dots">Processing</span>';
  setTimeout(async () => {
    try {
      const followers = faExtractHandles(faFollowersData);
      const following = faExtractHandles(faFollowingData);
      if (followers.size === 0 || following.size === 0) { faShowError('Could not read usernames from the files.'); btn.disabled = false; btn.classList.remove('processing'); btn.innerHTML = '✦ &nbsp;Analyze Now'; return; }
      faAllResults = [];
      following.forEach(handle => { faAllResults.push({ handle, mutual: followers.has(handle) }); });
      followers.forEach(handle => { if (!following.has(handle)) faAllResults.push({ handle, followerOnly: true }); });
      faAllResults.sort((a, b) => a.handle.localeCompare(b.handle));
      faRenderResults();
      if (isPro()) { faSaveAudit(); }
    } catch(err) { console.error('Analysis error:', err); faShowError('Something went wrong during analysis.'); }
    finally {
      btn.disabled = true; btn.classList.remove('processing'); btn.innerHTML = '✦ &nbsp;Analyze Now';
      faFollowersData = []; faFollowingData = [];
      const zipInput = document.getElementById('fa-zip-input');
      if (zipInput) zipInput.value = '';
      document.getElementById('fa-zip-file-list').innerHTML = '';
      const zipStatus = document.getElementById('fa-zip-status');
      if (zipStatus) { zipStatus.textContent = ''; zipStatus.style.color = ''; }
    }
  }, 80);
}

// ── ANALYTICS ──
function faRenderAnalytics() {
  const grid = document.getElementById('fa-analytics-grid');
  if (!grid) return;
  const totalFollowing = faAllResults.filter(r => !r.followerOnly).length;
  const mutuals = faAllResults.filter(r => r.mutual).length;
  const followBackRate = totalFollowing > 0 ? Math.round((mutuals / totalFollowing) * 100) : 0;
  const totalAccounts = faAllResults.filter(r => !r.followerOnly).length;
  const snakes = faAllResults.filter(r => !r.mutual && !r.followerOnly).length;
  const snakeFreePercent = totalAccounts > 0 ? Math.round(((totalAccounts - snakes) / totalAccounts) * 100) : 100;
  const cards = [
    { icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`, label: 'Follow back rate', value: followBackRate + '%', valueClass: followBackRate >= 50 ? 'positive' : followBackRate >= 30 ? 'neutral' : 'negative', sub: `<strong>${mutuals.toLocaleString()}</strong> of ${totalFollowing.toLocaleString()} accounts you follow, follow you back` },
    { icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`, label: 'Snake-free score', value: snakeFreePercent + '%', valueClass: snakeFreePercent >= 80 ? 'positive' : snakeFreePercent >= 60 ? 'neutral' : 'negative', sub: `Your feed is <strong>${snakeFreePercent}% snake-free</strong>. ${snakeFreePercent >= 80 ? 'Looking clean!' : 'Time to do some cleaning.'}` },
  ];
  grid.innerHTML = cards.map(c => `<div class="fa-analytics-card"><div class="fa-analytics-card-icon">${c.icon}</div><div class="fa-analytics-card-label">${c.label}</div><div class="fa-analytics-card-value ${c.valueClass}">${c.value}</div><div class="fa-analytics-card-sub">${c.sub}</div></div>`).join('');
}

// ── RENDER RESULTS ──
function faRenderResults() {
  const welcome = document.getElementById('fa-dashboard-welcome');
  if (welcome) welcome.classList.remove('visible');
  const sob = document.getElementById('fa-start-over-btn');
  if (sob) sob.classList.add('visible');
  const unfollowers = faAllResults.filter(r => !r.mutual && !r.followerOnly);
  const mutuals = faAllResults.filter(r => r.mutual);
  const followerOnly = faAllResults.filter(r => r.followerOnly);
  const totalFollowing = faAllResults.filter(r => !r.followerOnly).length;
  const followBackRate = totalFollowing > 0 ? Math.round((mutuals.length / totalFollowing) * 100) : 0;
  document.getElementById('fa-stats-row').innerHTML = `<div class="fa-stat-card danger"><div class="num">${unfollowers.length}</div><div class="lbl">Not following back</div></div><div class="fa-stat-card safe"><div class="num">${mutuals.length}</div><div class="lbl">Mutual followers</div></div><div class="fa-stat-card"><div class="num">${followerOnly.length}</div><div class="lbl">Follow you only</div></div><div class="fa-stat-card"><div class="num">${followBackRate}%</div><div class="lbl">Follow back rate</div></div>`;
  const badge = document.getElementById('fa-results-badge');
  if (badge) { badge.style.display = 'inline-flex'; badge.textContent = `${faAllResults.length} accounts analyzed`; }
  const _results = document.getElementById('fa-results');
  if (_results) _results.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const isPaid = isPro();
    const paywallEl = document.getElementById('fa-paywall-container');
    const target = (!isPaid && paywallEl && paywallEl.children.length > 0) ? paywallEl : document.getElementById('fa-results');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  faUpdateToolBtns();
  faCurrentFilter = 'unfollowers';
  document.querySelectorAll('#tool-follower .fa-filter-tab').forEach(b => b.classList.remove('active'));
  const unfollowTab = document.querySelector('#tool-follower .fa-filter-tab');
  if (unfollowTab) unfollowTab.classList.add('active');
  ['fa-history-section', 'fa-log-section', 'fa-snake-section', 'fa-whitelist-section'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  const resultsList = document.getElementById('fa-results-list-scroll');
  const headerRow = document.querySelector('#tool-follower .fa-result-header-row');
  if (resultsList) resultsList.style.display = 'block';
  if (headerRow) headerRow.style.display = 'grid';
  faFilterResults();
}

function faFilterResults() {
  const isPaid = isPro();
  faUpdateWhitelistTabCount();
  let filtered = [...faAllResults];
  if (faCurrentFilter === 'whitelist') filtered = filtered.filter(r => faUserWhitelist.has(r.handle.toLowerCase()));
  else {
    if (faCurrentFilter === 'unfollowers') filtered = filtered.filter(r => !r.mutual && !r.followerOnly && !faUserWhitelist.has(r.handle.toLowerCase()));
    if (faCurrentFilter === 'mutual') filtered = filtered.filter(r => r.mutual);
  }
  const el = document.getElementById('fa-results-list-scroll');
  const paywallEl = document.getElementById('fa-paywall-container');
  if (!filtered.length) { el.innerHTML = `<div class="fa-empty-state"><span class="emoji"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>No results match your search.</div>`; paywallEl.innerHTML = ''; return; }
  if (faCurrentFilter === 'whitelist') {
    if (faUserWhitelist.size === 0) { el.innerHTML = '<div class="fa-empty-state"><span class="emoji"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>Your whitelist is empty.</div>'; paywallEl.innerHTML = ''; return; }
    const wlRows = [...faUserWhitelist].map(handle => {
      const result = faAllResults.find(r => r.handle.toLowerCase() === handle.toLowerCase());
      if (result) return faBuildRow(result, false);
      const note = faAccountNotes[handle.toLowerCase()] || '';
      return `<div class="fa-result-item"><div><div class="fa-result-handle"><a href="https://instagram.com/${handle}" target="_blank" rel="noopener">@${handle}</a></div>${note ? `<div class="fa-note-display"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="follower-s-84da42"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>${note}</div>` : ''}</div><div><span class="fa-tag unfollow follower-s-776600" >Whitelisted</span></div><div><button class="fa-whitelist-btn whitelisted" data-follower-action="toggle-wl" data-follower-handle="${handle}">✓ Unhide</button></div><div><button class="fa-note-icon-btn" data-follower-action="toggle-note-row" data-follower-handle="${handle}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button></div><div></div></div>`;
    });
    el.innerHTML = wlRows.join(''); paywallEl.innerHTML = ''; return;
  }
  const unfollowerResults = filtered.filter(r => !r.mutual && !r.followerOnly && !faUserWhitelist.has(r.handle.toLowerCase()));
  const otherResults = filtered.filter(r => r.mutual || r.followerOnly);
  const limit = isPaid ? Infinity : FA_FREE_LIMIT;
  let html = '';
  otherResults.forEach(r => { html += faBuildRow(r, false); });
  unfollowerResults.forEach((r, i) => { const shouldBlur = !isPaid && i >= FA_FREE_LIMIT; html += faBuildRow(r, shouldBlur); });
  el.innerHTML = html;
  const hiddenCount = isPaid ? 0 : Math.max(0, unfollowerResults.length - FA_FREE_LIMIT);
  if (hiddenCount > 0) paywallEl.innerHTML = faBuildPaywall(hiddenCount, unfollowerResults.length);
  else paywallEl.innerHTML = '';
  const wlCount = faUserWhitelist.size;
  const wlBanner = document.getElementById('fa-wl-banner');
  if (wlBanner) {
    if (wlCount > 0 && isPro()) { wlBanner.style.display = 'flex'; wlBanner.querySelector('span').textContent = `${wlCount} account${wlCount > 1 ? 's' : ''} hidden by your whitelist`; }
    else wlBanner.style.display = 'none';
  }
}

function faBuildRow(r, blurred) {
  const tag = r.mutual ? `<span class="fa-tag mutual">✓ Mutual</span>` : r.followerOnly ? `<span class="fa-tag mutual">Follows you</span>` : `<span class="fa-tag unfollow">Not following back or profile disabled</span>`;
  const link = blurred ? `<span class="follower-s-57f9e3">@••••••••••</span>` : `<a href="https://instagram.com/${r.handle}" target="_blank" rel="noopener">@${r.handle}</a>`;
  const isMonthly = isPro();
  const isWhitelisted = faUserWhitelist.has(r.handle.toLowerCase());
  const existingNote = faAccountNotes[r.handle.toLowerCase()] || '';
  let wlBtn = '', noteBtn = '', noteRow = '';
  if (!blurred) {
    if (isMonthly) {
      const isWlTab = faCurrentFilter === 'whitelist';
      wlBtn = `<button class="fa-whitelist-btn${isWhitelisted ? ' whitelisted' : ''}" title="${isWhitelisted ? 'Remove from whitelist' : 'Add to whitelist'}" data-follower-action="toggle-wl" data-follower-handle="${r.handle}">${isWhitelisted ? (isWlTab ? '✓ Unhide' : '✓ Hidden') : '+ Hide'}</button>`;
      noteBtn = `<button class="fa-note-icon-btn${existingNote ? ' has-note' : ''}" title="${existingNote ? 'Edit note' : 'Add note'}" data-follower-action="toggle-note-row" data-follower-handle="${r.handle}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>`;
      noteRow = `${existingNote ? `<div class="fa-note-display follower-s-8eace7" ><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="follower-s-84da42"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>${existingNote}</div>` : ''}<div class="fa-note-row course-s-b1ecc4" id="fa-note-row-${r.handle}" ><div class="fa-note-input-wrap"><input class="fa-note-input" maxlength="200" aria-label="Note for @${r.handle}" id="fa-note-input-${r.handle}" value="${existingNote.replace(/"/g, '&quot;')}" placeholder="Add a private note about @${r.handle}…" data-follower-action-keydown="enter-submit-note" data-follower-handle="${r.handle}"><button class="fa-note-save-btn" data-follower-action="submit-note" data-follower-handle="${r.handle}">Save</button></div></div>`;
    } else {
      wlBtn = `<button class="fa-whitelist-btn locked-wl" title="Whitelist available on Pro plan" data-follower-action="toast-wl-pro">+ Hide</button>`;
      noteBtn = `<button class="fa-note-icon-btn follower-s-0aa8e9"  title="Notes available on Pro plan" data-follower-action="toast-notes-pro"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>`;
    }
  } else { wlBtn = '<span></span>'; noteBtn = '<span></span>'; }
  let snakeBtn = '';
  if (!blurred) {
    const inSnakeList = faUserSnakeList.has(r.handle.toLowerCase());
    if (isMonthly) snakeBtn = `<button class="fa-snake-btn${inSnakeList ? ' in-snake-list' : ''}" title="${inSnakeList ? 'Remove from Snake List' : 'Add to Snake List'}" data-follower-action="toggle-snake" data-follower-handle="${r.handle}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/></svg></button>`;
    else snakeBtn = `<button class="fa-snake-btn locked-snake" title="Snake List available on Pro plan" data-follower-action="toast-snake-pro"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/></svg></button>`;
  } else snakeBtn = '<span></span>';
  return `<div class="fa-result-item${blurred ? ' blurred' : ''}"><div><div class="fa-result-handle">${link}</div>${noteRow}</div><div>${tag}</div><div>${wlBtn}</div><div>${noteBtn}</div><div>${snakeBtn}</div></div>`;
}

function faBuildPaywall(hiddenCount, totalUnfollowers) {
  return `<div class="fa-paywall-gate"><div class="fa-paywall-lock"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div><div class="fa-paywall-count">${hiddenCount}</div><div class="fa-paywall-count-label">more people not following you back</div><h3>Unlock your full list</h3><p>You've seen the first ${FA_FREE_LIMIT} of ${totalUnfollowers} people not following you back. Upgrade to Pro to see everyone.</p><div class="fa-paywall-btns"><button class="fa-paywall-btn primary" data-follower-action="start-checkout" data-follower-plan="monthly" style="display:inline-flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:7px;flex-shrink:0;"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91 0z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg><span>Ryxa Pro</span></button></div>${!currentUser ? `<p class="follower-s-6c0a2a">Already paid? <a href="#" data-follower-action="goto-signin" class="follower-s-a80552">Sign in to restore access</a></p>` : ''}</div>`;
}

function faSetFilter(f, btn) {
  const isPaid = isPro();
  if (f === 'analytics' && !isPro()) { faShowMiniToast('Analytics is available on the Pro plan'); return; }
  if (f === 'mutual' && !isPaid) { faShowMiniToast('Unlock to see your Mutual followers'); return; }
  if (f === 'whitelist' && !isPro()) { faShowMiniToast('Whitelist is available on the Pro plan'); return; }
  if (f === 'snakes' && !isPro()) { faShowMiniToast('Snake List is available on the Pro plan'); return; }
  faCurrentFilter = f;
  document.querySelectorAll('#tool-follower .fa-filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const historySection = document.getElementById('fa-history-section');
  const resultsList = document.getElementById('fa-results-list-scroll');
  const paywallContainer = document.getElementById('fa-paywall-container');
  const wlBanner = document.getElementById('fa-wl-banner');
  const analyticsSection = document.getElementById('fa-analytics-section');
  const logSection = document.getElementById('fa-log-section');
  const snakeSection = document.getElementById('fa-snake-section');
  if (historySection) historySection.style.display = 'none';
  if (logSection) logSection.style.display = 'none';
  if (snakeSection) snakeSection.style.display = 'none';
  if (analyticsSection) analyticsSection.style.display = 'none';
  const whitelistSection = document.getElementById('fa-whitelist-section');
  if (whitelistSection) whitelistSection.style.display = 'none';
  if (f === 'history') {
    if (historySection) historySection.style.display = 'block';
    if (resultsList) resultsList.style.display = 'none';
    if (paywallContainer) paywallContainer.style.display = 'none';
    if (wlBanner) wlBanner.style.display = 'none';
    const hr = document.querySelector('#tool-follower .fa-result-header-row');
    if (hr) hr.style.display = 'none';
  } else if (f === 'analytics') {
    if (resultsList) resultsList.style.display = 'none';
    if (paywallContainer) paywallContainer.style.display = 'none';
    if (wlBanner) wlBanner.style.display = 'none';
    const hr = document.querySelector('#tool-follower .fa-result-header-row');
    if (hr) hr.style.display = 'none';
    if (analyticsSection) analyticsSection.style.display = 'block';
    faRenderAnalytics();
  } else if (f === 'log') {
    if (logSection) logSection.style.display = 'block';
    if (resultsList) resultsList.style.display = 'none';
    if (paywallContainer) paywallContainer.style.display = 'none';
    if (wlBanner) wlBanner.style.display = 'none';
    const hr = document.querySelector('#tool-follower .fa-result-header-row');
    if (hr) hr.style.display = 'none';
    faRenderUnfollowerLog();
  } else if (f === 'snakes') {
    if (snakeSection) snakeSection.style.display = 'block';
    if (resultsList) resultsList.style.display = 'none';
    if (paywallContainer) paywallContainer.style.display = 'none';
    if (wlBanner) wlBanner.style.display = 'none';
    const hr = document.querySelector('#tool-follower .fa-result-header-row');
    if (hr) hr.style.display = 'none';
    faRenderSnakeList();
  } else if (f === 'whitelist') {
    if (resultsList) resultsList.style.display = 'none';
    if (paywallContainer) paywallContainer.style.display = 'none';
    if (wlBanner) wlBanner.style.display = 'none';
    const hr = document.querySelector('#tool-follower .fa-result-header-row');
    if (hr) hr.style.display = 'none';
    faRenderWhitelistSection();
  } else {
    if (resultsList) resultsList.style.display = 'block';
    if (paywallContainer) paywallContainer.style.display = 'block';
    const hr = document.querySelector('#tool-follower .fa-result-header-row');
    if (hr) hr.style.display = 'grid';
    faFilterResults();
  }
}

function faRenderWhitelistSection() {
  const el = document.getElementById('fa-whitelist-section');
  const listEl = document.getElementById('fa-whitelist-section-list');
  if (!el || !listEl) return;
  el.style.display = 'block';
  if (faUserWhitelist.size === 0) { listEl.innerHTML = '<div class="fa-snake-empty"><span class="emoji"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>Your whitelist is empty.<br>Add accounts by clicking the "+ Hide" button on any result row.</div>'; return; }
  listEl.innerHTML = `<div class="fa-snake-list-wrap"><div class="fa-snake-list-header"><span>Username</span><span></span></div>
    ${[...faUserWhitelist].map(handle => {
      const hasNote = faAccountNotes[handle.toLowerCase()];
      return `<div class="fa-snake-list-item follower-s-cbf200" ><div class="follower-s-579542"><div class="bio-s-7623f0"><div class="bio-s-e3f610"><a href="https://instagram.com/${handle}" target="_blank" rel="noopener" class="follower-s-0a828c">@${handle}</a><button class="fa-note-icon-btn${hasNote ? ' has-note' : ''}" title="${hasNote ? 'Edit note' : 'Add note'}" data-follower-action="toggle-section-note-row" data-follower-handle="${handle}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button></div>${faBuildNoteEditor(handle, 'whitelist')}</div><button class="fa-snake-remove-btn" title="Remove from whitelist" data-follower-action="toggle-wl-and-rerender" data-follower-handle="${handle}">✕</button></div></div>`;
    }).join('')}</div>`;
}

function faUpdateWhitelistTab() {
  const isPaid = isPro();
  const tab = document.getElementById('fa-whitelist-tab');
  if (tab) {
    if (!isPro()) { tab.classList.add('wl-locked'); tab.title = 'Whitelist available on Pro plan'; }
    else { tab.classList.remove('wl-locked'); tab.title = ''; }
  }
  const mutualTab = document.getElementById('fa-mutual-tab');
  if (mutualTab) {
    if (!isPaid) { mutualTab.classList.add('wl-locked'); mutualTab.title = 'Unlock to see Mutual followers'; }
    else { mutualTab.classList.remove('wl-locked'); mutualTab.title = ''; }
  }
  const snakeTab = document.getElementById('fa-snake-tab');
  if (snakeTab) {
    if (!isPro()) { snakeTab.classList.add('wl-locked'); snakeTab.title = 'Snake List available on Pro plan'; }
    else { snakeTab.classList.remove('wl-locked'); snakeTab.title = ''; }
  }
}

function faShowError(msg) { const el = document.getElementById('fa-error-box'); el.textContent = '⚠ ' + msg; el.style.display = 'block'; }
function faHideError() { const el = document.getElementById('fa-error-box'); if (el) el.style.display = 'none'; }




// =============================================================================
// ACTION REGISTRATIONS — wired up below as part of Phase 2
// =============================================================================

// Instructions modal
followerRegisterAction('open-instructions', (e) => {
  // Original handler also called e.preventDefault() because the trigger was an <a href="#">
  if (e && e.preventDefault) e.preventDefault();
  faOpenInstructions();
});
followerRegisterAction('close-instructions', () => faCloseInstructions());
followerRegisterAction('close-instructions-backdrop', (e, el) => {
  // Only close if user clicked the backdrop itself, not a child element
  if (e.target === el) faCloseInstructions();
});

// Main tool buttons
followerRegisterAction('analyze', () => faAnalyze());
followerRegisterAction('start-over', () => faStartOver());
followerRegisterAction('scroll-to-zip', () => {
  var el = document.getElementById('fa-zip-zone');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
});

// Tool buttons (print / csv)
followerRegisterAction('tool-btn', (e, el) => faHandleToolBtn(el.dataset.followerTool));

// Result filters
followerRegisterAction('set-filter', (e, el) => faSetFilter(el.dataset.followerFilter, el));
followerRegisterAction('set-log-filter', (e, el) => faSetLogFilter(el.dataset.followerLogFilter, el));

// Whitelist/Snake list section actions
followerRegisterAction('clear-whitelist', () => faClearWhitelist());
followerRegisterAction('clear-snake-list', () => faClearSnakeList());

// Unfollower log filter input
followerRegisterAction('render-log', () => faRenderUnfollowerLog());

// Per-row toggle / submit (template literals — use data-follower-handle)
followerRegisterAction('toggle-wl', (e, el) => faToggleWhitelist(el.dataset.followerHandle));
followerRegisterAction('toggle-wl-and-rerender', (e, el) => {
  faToggleWhitelist(el.dataset.followerHandle);
  faRenderWhitelistSection();
});
followerRegisterAction('toggle-snake', (e, el) => faToggleSnakeList(el.dataset.followerHandle));
followerRegisterAction('toggle-note-row', (e, el) => faToggleNoteRow(el.dataset.followerHandle));
followerRegisterAction('submit-note', (e, el) => faSubmitNote(el.dataset.followerHandle));
followerRegisterAction('toggle-section-note-row', (e, el) => faToggleSectionNoteRow(el.dataset.followerHandle));
followerRegisterAction('submit-section-note', (e, el) => faSubmitSectionNote(el.dataset.followerHandle));

// Note input keydown: Enter to submit
followerRegisterAction('enter-submit-note', (e, el) => {
  if (e.key === 'Enter') faSubmitNote(el.dataset.followerHandle);
});
followerRegisterAction('enter-submit-section-note', (e, el) => {
  if (e.key === 'Enter') faSubmitSectionNote(el.dataset.followerHandle);
});

// Audit history row delete
followerRegisterAction('delete-audit', (e, el) => {
  faDeleteAudit(el.dataset.followerAuditId, e);
});

// Pro-feature locked toasts (free users see these)
followerRegisterAction('toast-notes-pro', () => faShowMiniToast('Notes are available on the Pro plan'));
followerRegisterAction('toast-snake-pro', () => faShowMiniToast('Snake List is available on the Pro plan'));
followerRegisterAction('toast-wl-pro', () => faShowMiniToast('Whitelist is available on the Pro plan'));

// Paywall checkout buttons
followerRegisterAction('start-checkout', (e, el) => goToPricing(el.dataset.followerPlan === 'max' ? 'max' : 'pro'));

// Signed-out redirect ("Sign in" link inside paywall)
followerRegisterAction('goto-signin', (e) => {
  if (e && e.preventDefault) e.preventDefault();
  window.location.href = 'index.html?action=signin';
});

