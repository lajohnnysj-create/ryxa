// =============================================================================
// /js/scripts.js - Script Builder (extracted from dashboard.html, 2026-05-10)
// -----------------------------------------------------------------------------
// All JavaScript for the Script Builder tool (Pro/Max). Includes:
//   • Script editor (script/storyboard views, hook, items, sections, blocks)
//   • Script AI Tools (dsAIHook, dsAIAssist, runAIAssist)
//   • Teleprompter mode
//   • Cinematic mode + Cinematic Music (Tone.js)
//   • Export menu (copy/download/PDF)
//
// REFACTOR SCOPE:
//   • Phase 1: code relocation to /js/scripts.js
//   • Phase 2: inline onclick/oninput/etc → data-scripts-action attributes
//   • Phase 3: static inline class="bio-s-6eae3a" → hash-named CSS classes
//
// SHARED HELPERS THAT STAY IN dashboard.html: aiCleanUp() and applyCleanUp()
// remain in the main script as a shared utility, since they're called from
// js/course.js. Same pattern as aiBioAssist (which lives in js/bio.js but is
// reused by mk.js and coaching.js).
//
// External dependencies remain on window:
//   • sb, Auth, currentUser, isPro, isMax, escapeHtml, getAIHeaders
//   • dashConfirm, showModalAlert
//   • showDsMsg (from js/design.js) - only called at click time
//   • Tone (Tone.js - lazy-loaded by ensureToneLoaded() only when the user
//     opts into Cinematic Music, NOT eager in dashboard.html)
// =============================================================================

// =============================================================================
// EVENT DELEGATION INFRASTRUCTURE (parallel of other tools)
// =============================================================================

const scriptsActions = {};

function scriptsRegisterAction(action, handler) {
  scriptsActions[action] = handler;
}
scriptsRegisterAction('retry-load', function() { loadScriptsList(); });

function scriptsFindActionElement(target, eventType) {
  let el = target;
  while (el && el !== document.body) {
    if (el.dataset) {
      const perEvent = el.dataset['scriptsAction' + eventType.charAt(0).toUpperCase() + eventType.slice(1)];
      if (perEvent) return { element: el, action: perEvent };
      if (el.dataset.scriptsAction) {
        const wantEvent = el.dataset.scriptsEvent || 'click';
        if (wantEvent === eventType) return { element: el, action: el.dataset.scriptsAction };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function scriptsDispatchEvent(event) {
  const found = scriptsFindActionElement(event.target, event.type);
  if (!found) return;
  const handler = scriptsActions[found.action];
  if (!handler) {
    console.warn('[scripts] No handler registered for action:', found.action);
    return;
  }
  handler(event, found.element);
}

['click', 'input', 'change', 'focus', 'blur', 'keydown'].forEach(evt => {
  const useCapture = (evt === 'focus' || evt === 'blur');
  document.addEventListener(evt, scriptsDispatchEvent, useCapture);
});

// =============================================================================
// END INFRASTRUCTURE
// =============================================================================

// ---------- From dashboard.html lines 14002-14755 (Scripts core + AI tools) ----------
// ======================================================================
// SCRIPT BUILDER - Creator Max tool
// ======================================================================
const SCRIPT_BLOCKS_MAX = 50;
const SCRIPT_WPM = 150;
const SCRIPT_PLATFORMS = {
  reel:    'Instagram Reel',
  tiktok:  'TikTok',
  short:   'YouTube Short',
  long:    'YouTube (Long)',
  podcast: 'Podcast',
  other:   'Other',
};

let scriptsList = [];
let scriptsLoaded = false;
let currentScript = null;
let scriptsDirty = false;
let scriptsAutoSaveTimer = null;
let scriptsSaving = false; // single-flight guard: only one save in flight at a time
let scriptItemIdCounter = 0;
let currentScriptView = 'script';
let hookEditing = false;


function initScriptsTool() {
  const hasAccess = isPro();
  const paywall = document.getElementById('scripts-paywall');
  const editorWrap = document.getElementById('scripts-editor-wrap');
  if (!hasAccess) {
    if (paywall) paywall.style.display = 'block';
    if (editorWrap) editorWrap.style.display = 'none';
    return;
  }
  if (paywall) paywall.style.display = 'none';
  if (editorWrap) editorWrap.style.display = 'block';
  showScriptsList();
}

function showScriptsList() {
  document.getElementById('scripts-list-view').style.display = 'block';
  document.getElementById('scripts-edit-view').style.display = 'none';
  currentScript = null;
  scriptsDirty = false;
  if (!scriptsLoaded) {
    loadScriptsList();
  } else {
    // Subsequent opens render from memory - no refetch, no load bar. Matches
    // Courses / Products / Bio. In-tool saves keep the cache fresh.
    renderScriptsList();
  }
}

async function loadScriptsList() {
  if (!currentUser) return;
  const _gen = window.RyxaLoadGen.bump();
  const listEl = document.getElementById('scripts-list');
  const emptyEl = document.getElementById('scripts-empty');
  if (emptyEl) emptyEl.style.display = 'none';
  if (listEl) { listEl.innerHTML = ''; window.RyxaLoadBar.start(listEl); }
  const MAX_LOAD_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
    try {
      const res = await sb
        .from('scripts')
        .select('id, title, hook, platform, items, updated_at')
        .eq('user_id', currentUser.id)
        .order('updated_at', { ascending: false });
      if (res.error) throw res.error;
      if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('scripts-list')); return; }
      scriptsList = res.data || [];
      scriptsLoaded = true;
      window.RyxaLoadBar.finish(listEl);
      renderScriptsList();
      return;
    } catch (e) {
      if (attempt < MAX_LOAD_ATTEMPTS) {
        if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('scripts-list')); return; }
        window.RyxaLoadBar.retrying(listEl, 'Having trouble loading your scripts. Retrying...');
        await new Promise(function(r){ setTimeout(r, 400 * attempt); });
        if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('scripts-list')); return; }
        continue;
      }
      if (window.RyxaLoadGen.n !== _gen) { window.RyxaLoadBar.stop(document.getElementById('scripts-list')); return; }
      console.error('loadScriptsList', e);
      window.RyxaLoadBar.fail(listEl);
      if (emptyEl) emptyEl.style.display = 'none';
      if (listEl) {
        listEl.innerHTML = '<div role="alert" style="padding:20px;border-radius:12px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.08);">'
          + '<div style="color:#f87171;font-weight:600;font-size:15px;margin-bottom:6px;">Could not load your scripts</div>'
          + '<div style="color:rgba(255,255,255,0.7);font-size:14px;line-height:1.5;margin-bottom:14px;">Your scripts are safe; they just could not be loaded. Check your internet connection and press Retry. If the issue continues, contact us at hello@ryxa.io.</div>'
          + '<button type="button" data-scripts-action="retry-load" style="padding:9px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.06);color:#fff;font-weight:600;cursor:pointer;">Retry</button>'
          + '</div>';
      }
      if (typeof showDashToast === 'function') showDashToast('error', 'Failed to load. Please retry, or contact hello@ryxa.io if it continues.');
      return;
    }
  }
}

function renderScriptsList() {
  const listEl = document.getElementById('scripts-list');
  const emptyEl = document.getElementById('scripts-empty');
  const newBtn = document.getElementById('scripts-new-btn');
  if (!listEl) return;
  if (scriptsList.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  listEl.innerHTML = scriptsList.map(s => renderScriptCard(s)).join('');
}

function renderScriptCard(s) {
  const platform = SCRIPT_PLATFORMS[s.platform] || 'Script';
  const duration = calcScriptDuration(s);
  const blockCount = (s.items || []).filter(i => i.type === 'block').length;
  const updated = formatRelativeTime(s.updated_at);
  const title = escapeHtml(s.title || 'Untitled script');
  return `<div class="scripts-card" data-scripts-action="open-editor" data-scripts-script-id="${s.id}">
    <div class="scripts-card-main">
      <div class="scripts-card-title">${title}</div>
      <div class="scripts-card-meta">${platform} · ${duration}s · ${blockCount} ${blockCount === 1 ? 'block' : 'blocks'} · Updated ${updated}</div>
    </div>
    <div class="scripts-card-actions" data-scripts-action="noop-stop-propagation">
      <button type="button" class="scripts-card-btn" data-scripts-action="duplicate-script" data-scripts-script-id="${s.id}" aria-label="Duplicate">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button type="button" class="scripts-card-btn danger" data-scripts-action="delete-script" data-scripts-script-id="${s.id}" aria-label="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    </div>
  </div>`;
}

function calcScriptDuration(s) {
  const hook = s.hook || '';
  const items = Array.isArray(s.items) ? s.items : [];
  const totalText = hook + ' ' + items.filter(i => i.type === 'block').map(i => i.body || '').join(' ');
  const words = totalText.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / SCRIPT_WPM) * 60));
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return d.toLocaleDateString();
}

async function createNewScript() {
  if (!isMax()) return;
  try {
    const { data, error } = await sb.from('scripts').insert({
      user_id: currentUser.id,
      title: 'Untitled script',
      hook: '',
      platform: 'reel',
      items: [],
    }).select().single();
    if (error) throw error;
    scriptsList.unshift(data);
    openScriptEditor(data.id);
  } catch (e) {
    console.error(e);
    alert('Could not create script: ' + (e.message || 'unknown'));
  }
}

async function deleteScript(id) {
  const script = scriptsList.find(s => s.id === id);
  if (!script) return;
  const confirmed = await dashConfirm('Delete "' + script.title + '"? This cannot be undone.');
  if (!confirmed) return;
  try {
    const { error } = await sb.from('scripts').delete().eq('id', id);
    if (error) throw error;
    scriptsList = scriptsList.filter(s => s.id !== id);
    renderScriptsList();
  } catch (e) {
    console.error(e);
    alert('Could not delete: ' + (e.message || 'unknown'));
  }
}

async function duplicateScript(id) {
  const script = scriptsList.find(s => s.id === id);
  if (!script) return;
  try {
    const newItems = (script.items || []).map(i => ({ ...i, id: genScriptItemId(i.type) }));
    const { data, error } = await sb.from('scripts').insert({
      user_id: currentUser.id,
      title: script.title + ' (copy)',
      hook: script.hook || '',
      platform: script.platform || 'reel',
      items: newItems,
    }).select().single();
    if (error) throw error;
    scriptsList.unshift(data);
    renderScriptsList();
  } catch (e) {
    console.error(e);
    alert('Could not duplicate: ' + (e.message || 'unknown'));
  }
}

function genScriptItemId(type) {
  return (type === 'section' ? 's-' : 'b-') + Date.now() + '-' + (++scriptItemIdCounter);
}

// Full editor
async function openScriptEditor(id) {
  const script = scriptsList.find(s => s.id === id);
  if (!script) return;
  currentScript = JSON.parse(JSON.stringify(script));
  if (!Array.isArray(currentScript.items)) currentScript.items = [];
  scriptsDirty = false;
  currentScriptView = 'script';
  hookEditing = false;
  document.getElementById('scripts-list-view').style.display = 'none';
  document.getElementById('scripts-edit-view').style.display = 'block';
  renderScriptEditor();
}

function renderScriptEditor() {
  const wrap = document.getElementById('scripts-edit-view');
  if (!wrap || !currentScript) return;
  const platformOpts = Object.entries(SCRIPT_PLATFORMS)
    .map(([k, v]) => `<option value="${k}" ${currentScript.platform === k ? 'selected' : ''}>${v}</option>`)
    .join('');
  const duration = calcScriptDuration(currentScript);
  const blockCount = currentScript.items.filter(i => i.type === 'block').length;

  wrap.innerHTML = `
    <div class="scripts-editor-top">
      <button class="scripts-back-btn" data-scripts-action="exit-editor">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back to scripts
      </button>
      <div class="scripts-view-toggle">
        <button class="scripts-view-btn ${currentScriptView === 'script' ? 'active' : ''}" data-scripts-action="set-view" data-scripts-view="script">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/></svg>
          Script
        </button>
        <button class="scripts-view-btn ${currentScriptView === 'storyboard' ? 'active' : ''}" data-scripts-action="set-view" data-scripts-view="storyboard">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Storyboard
        </button>
        <button class="scripts-view-btn" data-scripts-action="open-teleprompter">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M7 10h10M7 13h7"/></svg>
          Teleprompter
        </button>
        <button class="scripts-view-btn" data-scripts-action="open-cinematic">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 9h20M7 5v4M17 5v4M7 19v-4M17 19v-4"/></svg>
          Cinematic
        </button>
      </div>
      <div class="scripts-editor-status">
        <span id="scripts-save-status"></span>
      </div>
      <div class="scripts-editor-actions">
        <div class="scripts-export-wrap">
          <button class="scripts-action-btn" data-scripts-action="toggle-export-menu" aria-haspopup="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div id="scripts-export-menu" class="scripts-export-menu bio-s-c8be1c" >
            <button data-scripts-action="export-copy-all">Copy all text</button>
            <button data-scripts-action="export-copy-spoken">Copy spoken lines only</button>
            <button data-scripts-action="export-download-txt">Download as .txt</button>
            <button data-scripts-action="export-pdf" class="primary">Save as PDF</button>
          </div>
        </div>
        <button class="scripts-action-btn primary" data-scripts-action="save-now">Save</button>
      </div>
    </div>

    <div class="scripts-editor-meta">
      <input type="text" id="scripts-title-input" class="scripts-title-input" maxlength="80" value="${escapeHtml(currentScript.title || '')}" placeholder="Untitled script" data-scripts-action-input="title-change" data-scripts-action-keydown="enter-blur" aria-label="Script title">
      <div class="scripts-meta-row">
        <select id="scripts-platform" data-scripts-action-change="platform-change" aria-label="Platform">${platformOpts}</select>
        <span class="scripts-meta-sep">·</span>
        <span class="scripts-meta-duration"><span id="scripts-total-duration">${duration}</span>s total</span>
        <span class="scripts-meta-sep">·</span>
        <span><span id="scripts-block-count">${blockCount}</span>/${SCRIPT_BLOCKS_MAX} blocks</span>
      </div>
    </div>

    <!-- SCRIPT VIEW -->
    <div id="scripts-view-script" style="display:${currentScriptView === 'script' ? 'block' : 'none'};">
      <div class="scripts-hook-wrap" id="scripts-hook-wrap">
        <div class="scripts-hook-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m13 2-2 2.5h3L12 7"/><path d="M10 14a4 4 0 1 1-4-4c1.1 0 2.5.4 2.5.4L5 17"/><path d="M7 14v0"/><circle cx="18" cy="17" r="4"/></svg>
          Hook
          <button data-scripts-action="ai-hook" class="ds-tool-btn scripts-s-aa6173" id="script-ai-hook-btn" title="AI Hook Generator" >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            AI Hook
          </button>
        </div>
        <div id="scripts-hook-display" class="scripts-hook-display" data-scripts-action="edit-hook" style="display:${(currentScript.hook && !hookEditing) ? 'block' : 'none'};">${escapeHtml(currentScript.hook || '') || '<span class="scripts-hook-placeholder">What\'s the one sentence that stops the scroll?</span>'}</div>
        <div id="scripts-hook-edit" style="display:${(currentScript.hook && !hookEditing) ? 'none' : 'block'};">
          <textarea id="scripts-hook-input" class="scripts-hook-input" maxlength="200" rows="2" placeholder="What's the one sentence that stops the scroll?" data-scripts-action-input="hook-change" data-scripts-action-keydown="cmd-enter-save-hook" aria-label="Hook">${escapeHtml(currentScript.hook || '')}</textarea>
          <div class="scripts-hook-meta">
            <span class="scripts-kbd-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> to save</span>
            <div class="scripts-hook-right">
              <span><span id="scripts-hook-count">${(currentScript.hook || '').length}</span>/200</span>
              <button class="scripts-inline-save" data-scripts-action="save-collapse-hook">Save</button>
            </div>
          </div>
        </div>
      </div>

      <div class="scripts-add-row">
        <button class="scripts-add-btn" data-scripts-action="add-section">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          Add section header
        </button>
        <button class="scripts-add-btn primary" data-scripts-action="add-block" id="scripts-add-block-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add block
        </button>
      </div>

      <div id="scripts-items-list" class="scripts-items-list"></div>
    </div>

    <!-- STORYBOARD VIEW -->
    <div id="scripts-view-storyboard" style="display:${currentScriptView === 'storyboard' ? 'block' : 'none'};">
      <div id="scripts-storyboard-content"></div>
    </div>
  `;
  if (currentScriptView === 'script') {
    renderScriptItems();
  } else {
    renderStoryboard();
  }
  // Dismiss export menu on outside click
  setTimeout(() => {
    document.addEventListener('click', scriptsExportOutsideClick);
  }, 10);
}

function setScriptView(view) {
  currentScriptView = view;
  const scriptView = document.getElementById('scripts-view-script');
  const sbView = document.getElementById('scripts-view-storyboard');
  const toggleBtns = document.querySelectorAll('.scripts-view-btn');
  if (scriptView) scriptView.style.display = view === 'script' ? 'block' : 'none';
  if (sbView) sbView.style.display = view === 'storyboard' ? 'block' : 'none';
  toggleBtns.forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && view === 'script') || (i === 1 && view === 'storyboard'));
  });
  if (view === 'storyboard') renderStoryboard();
  else renderScriptItems();
}

function renderStoryboard() {
  const wrap = document.getElementById('scripts-storyboard-content');
  if (!wrap || !currentScript) return;

  const hook = currentScript.hook || '';
  const items = currentScript.items || [];
  const blocks = items.filter(i => i.type === 'block');
  const hasAny = hook || blocks.length > 0;

  if (!hasAny) {
    wrap.innerHTML = `<div class="scripts-sb-empty">
      <div class="scripts-s-4d118a">Nothing to storyboard yet</div>
      <div class="cal-s-56e6ba">Add a hook and some blocks in Script view to see your video laid out here.</div>
    </div>`;
    return;
  }

  let html = '';

  // Hook card (full-width)
  if (hook) {
    html += `<div class="sb-hook-card" data-scripts-action="set-view" data-scripts-view="script">
      <div class="sb-hook-label">HOOK · 0:00</div>
      <div class="sb-hook-text">${escapeHtml(hook)}</div>
    </div>`;
  }

  // Walk items in order, grouping blocks by preceding section
  let sceneNum = 0;
  let runningSeconds = estimateSeconds(hook);
  let currentSection = null;
  let currentRow = [];

  function flushRow() {
    if (currentRow.length === 0) return;
    html += `<div class="sb-grid">${currentRow.join('')}</div>`;
    currentRow = [];
  }

  items.forEach(item => {
    if (item.type === 'section') {
      flushRow();
      currentSection = item.text || 'Section';
      html += `<div class="sb-section-label">${escapeHtml(currentSection)}</div>`;
    } else if (item.type === 'block') {
      sceneNum++;
      const body = (item.body || '').trim();
      const title = item.title || '';
      const wordCount = body.split(/\s+/).filter(Boolean).length;
      const seconds = Math.max(1, Math.round((wordCount / SCRIPT_WPM) * 60));
      const timecode = formatTimecode(runningSeconds);
      runningSeconds += seconds;

      const titleHtml = title
        ? `<div class="sb-card-title">${escapeHtml(title)}</div>`
        : `<div class="sb-card-title sb-card-title-dim">Scene ${sceneNum}</div>`;
      const bodyHtml = body
        ? `<div class="sb-card-body">${escapeHtml(body)}</div>`
        : `<div class="sb-card-body sb-card-empty">(empty)</div>`;

      currentRow.push(`<div class="sb-card" data-id="${item.id}" data-scripts-action="jump-to-block" data-scripts-item-id="${item.id}">
        <div class="sb-card-header">
          <span class="sb-scene-num">${sceneNum}</span>
          <span class="sb-timecode">${timecode}</span>
        </div>
        ${titleHtml}
        ${bodyHtml}
        <div class="sb-card-footer">
          <span>${wordCount} ${wordCount === 1 ? 'word' : 'words'}</span>
          <span class="sb-duration-pill">${seconds}s</span>
        </div>
      </div>`);
    }
  });

  flushRow();
  wrap.innerHTML = html;
}

function jumpToBlockInScript(id) {
  setScriptView('script');
  setTimeout(() => {
    const el = document.querySelector(`.scripts-block[data-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'box-shadow 0.3s';
      el.style.boxShadow = '0 0 0 3px rgba(232,121,249,0.3)';
      setTimeout(() => { el.style.boxShadow = ''; }, 1500);
      const textarea = el.querySelector('.scripts-block-body');
      if (textarea) textarea.focus();
    }
  }, 80);
}

function estimateSeconds(text) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / SCRIPT_WPM) * 60));
}

function formatTimecode(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function exitScriptEditor() {
  document.removeEventListener('click', scriptsExportOutsideClick);
  // If dirty, save silently before leaving
  if (scriptsDirty) {
    saveScriptNow(true).finally(() => showScriptsList());
  } else {
    showScriptsList();
  }
}

function renderScriptItems() {
  const list = document.getElementById('scripts-items-list');
  if (!list) return;
  const items = currentScript.items || [];
  if (items.length === 0) {
    list.innerHTML = `<div class="scripts-empty-items">Add a block to start writing, or a section header to organize.</div>`;
    updateScriptMeta();
    return;
  }
  list.innerHTML = items.map(i => {
    if (i.type === 'section') return renderSectionItem(i);
    return renderBlockItem(i);
  }).join('');
  // Init sortable
  if (window.Sortable) {
    if (list._sortable) list._sortable.destroy();
    list._sortable = Sortable.create(list, {
      handle: '.scripts-drag-handle',
      animation: 180,
      onEnd: () => {
        const order = [...list.children].map(c => c.dataset.id);
        const next = [];
        order.forEach(id => {
          const found = currentScript.items.find(x => x.id === id);
          if (found) next.push(found);
        });
        currentScript.items = next;
        markScriptDirty();
      },
    });
  }
  updateScriptMeta();
}

function renderSectionItem(item) {
  const text = escapeHtml(item.text || '');
  return `<div class="scripts-section" data-id="${item.id}">
    <div class="scripts-drag-handle" aria-label="Drag to reorder">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
    </div>
    <div class="scripts-section-line"></div>
    <input type="text" class="scripts-section-input" maxlength="40" value="${text}" placeholder="Section name" data-scripts-action-input="section-edit" data-scripts-item-id="${item.id}" data-scripts-action-keydown="enter-blur" aria-label="Section name">
    <div class="scripts-section-line"></div>
    <button class="scripts-remove-btn" data-scripts-action="remove-item" data-scripts-item-id="${item.id}" aria-label="Delete section">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`;
}

function renderBlockItem(item) {
  const title = escapeHtml(item.title || '');
  const body = escapeHtml(item.body || '');
  const wordCount = (item.body || '').trim().split(/\s+/).filter(Boolean).length;
  const seconds = Math.max(1, Math.round((wordCount / SCRIPT_WPM) * 60));
  const isCollapsed = !!item.collapsed;
  const bodyPreview = (item.body || '').trim().slice(0, 80) + ((item.body || '').length > 80 ? '…' : '');
  if (isCollapsed) {
    return `<div class="scripts-block collapsed" data-id="${item.id}">
      <div class="scripts-block-header">
        <div class="scripts-drag-handle" aria-label="Drag to reorder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
        </div>
        <div class="scripts-block-collapsed-main" data-scripts-action="expand-block" data-scripts-item-id="${item.id}">
          <div class="scripts-block-collapsed-title">${title || '<span class="dim">Untitled block</span>'}</div>
          <div class="scripts-block-collapsed-preview">${escapeHtml(bodyPreview) || '<span class="dim">Empty</span>'}</div>
        </div>
        <span class="scripts-block-collapsed-meta">${wordCount}w · ${seconds}s</span>
        <button class="scripts-expand-btn" data-scripts-action="expand-block" data-scripts-item-id="${item.id}" aria-label="Expand block">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button class="scripts-remove-btn" data-scripts-action="remove-item" data-scripts-item-id="${item.id}" aria-label="Delete block">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
  }
  return `<div class="scripts-block" data-id="${item.id}">
    <div class="scripts-block-header">
      <div class="scripts-drag-handle" aria-label="Drag to reorder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
      </div>
      <input type="text" class="scripts-block-title" maxlength="60" value="${title}" placeholder="Title (optional)" data-scripts-action-input="block-edit-title" data-scripts-item-id="${item.id}" data-scripts-action-keydown="enter-blur" aria-label="Block title">
      <button class="scripts-collapse-btn" data-scripts-action="collapse-block" data-scripts-item-id="${item.id}" aria-label="Collapse block" title="Collapse">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <button class="scripts-remove-btn" data-scripts-action="remove-item" data-scripts-item-id="${item.id}" aria-label="Delete block">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
    <textarea class="scripts-block-body" maxlength="1500" rows="3" placeholder="What you'll say..." data-scripts-action-input="block-edit-body" data-scripts-item-id="${item.id}" data-scripts-action-keydown="cmd-enter-save-block" aria-label="Block body">${body}</textarea>
    <div class="scripts-block-meta">
      <span class="scripts-kbd-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> to save & collapse</span>
      <div class="scripts-block-meta-right">
        <span class="scripts-block-count" data-id="${item.id}">${wordCount} words · ${seconds}s</span>
        <button class="ds-tool-btn scripts-s-3bec16" data-scripts-action="ai-assist" data-scripts-item-id="${item.id}" title="AI Assist" >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          AI
        </button>
        <button class="scripts-inline-save" data-scripts-action="save-collapse-block" data-scripts-item-id="${item.id}">Save</button>
      </div>
    </div>
  </div>`;
}

function collapseScriptBlock(id) {
  const item = currentScript.items.find(x => x.id === id);
  if (!item) return;
  item.collapsed = true;
  renderScriptItems();
  markScriptDirty();
}

function expandScriptBlock(id) {
  const item = currentScript.items.find(x => x.id === id);
  if (!item) return;
  item.collapsed = false;
  renderScriptItems();
  markScriptDirty();
  // Focus the body so user can keep typing
  setTimeout(() => {
    const textarea = document.querySelector(`.scripts-block[data-id="${id}"] .scripts-block-body`);
    if (textarea) textarea.focus();
  }, 20);
}

async function saveAndCollapseBlock(id) {
  const item = currentScript.items.find(x => x.id === id);
  if (!item) return;
  item.collapsed = true;
  renderScriptItems();
  await saveScriptNow();
}

// ===== SCRIPT AI TOOLS =====
function dsAIHook() {
  if (typeof isPro === 'function' && !isPro()) {
    if (typeof showDashToast === 'function') showDashToast('error', 'AI Hook Generator is a Pro feature. Upgrade to use it.');
    return;
  }

  var hookInput = document.getElementById('scripts-hook-input');
  var topic = hookInput ? hookInput.value.trim() : '';

  var overlay = document.createElement('div');
  overlay.id = 'script-ai-hook-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = '<div class="scripts-s-08904b">'
    + '<div class="scripts-s-760626">AI Hook Generator</div>'
    + '<p class="scripts-s-773e26">Describe your video topic and we\'ll generate scroll-stopping hooks.</p>'
    + '<input type="text" id="script-ai-hook-topic" value="' + escapeHtml(topic) + '" placeholder="e.g. How I grew to 100k followers in 6 months" maxlength="200" class="scripts-s-f9060e" data-scripts-action-focus="select-all">'
    + '<div class="course-s-b9bbe5">'
    + '<button data-scripts-action="generate-hooks" id="script-ai-hook-gen-btn" class="ds-s-a51526">Generate Hooks</button>'
    + '<button data-scripts-action="close-hook-modal" class="ds-s-dea7b5">Cancel</button>'
    + '</div>'
    + '<div id="script-ai-hook-results" class="scripts-s-8a359a"></div>'
    + '</div>';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  document.getElementById('script-ai-hook-topic').focus();
}

function generateHooks() {
  var topic = document.getElementById('script-ai-hook-topic')?.value?.trim();
  if (!topic) { return; }
  var btn = document.getElementById('script-ai-hook-gen-btn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  fetch('/api/ai-script', {
    method: 'POST',
    headers: getAIHeaders(),
    body: JSON.stringify({ mode: 'hook', topic: topic })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    btn.disabled = false;
    btn.textContent = 'Generate Hooks';
    if (data.error) { showDsMsg('error', data.error); return; }

    var sections = data.result.split(/HOOK \d+:\n?/i).filter(function(s) { return s.trim(); });
    var resultsEl = document.getElementById('script-ai-hook-results');
    resultsEl.innerHTML = sections.map(function(s, i) {
      return '<div class="scripts-s-74b3af">'
        + '<div class="bio-s-f0cb5a" id="script-hook-option-' + i + '">' + escapeHtml(s.trim()) + '</div>'
        + '<button data-scripts-action="apply-hook" data-scripts-idx="' + i + '" class="ds-s-a4361b">Use this hook</button>'
        + '<button data-scripts-action="report-hook" data-scripts-idx="' + i + '" class="scripts-report-btn">Report</button>'
        + '</div>';
    }).join('');
  })
  .catch(function() {
    btn.disabled = false;
    btn.textContent = 'Generate Hooks';
    showDsMsg('error', 'Failed to generate hooks. Try again.');
  });
}

function applyHook(idx) {
  var text = document.getElementById('script-hook-option-' + idx)?.textContent;
  if (!text || !currentScript) return;
  currentScript.hook = text;
  var hookInput = document.getElementById('scripts-hook-input');
  if (hookInput) hookInput.value = text;
  var hookCount = document.getElementById('scripts-hook-count');
  if (hookCount) hookCount.textContent = text.length;
  markScriptDirty();
  document.getElementById('script-ai-hook-modal')?.remove();
}

function dsAIAssist(blockId) {
  if (typeof isPro === 'function' && !isPro()) {
    if (typeof showDashToast === 'function') showDashToast('error', 'AI Assist is a Pro feature. Upgrade to use it.');
    return;
  }

  var item = currentScript.items.find(function(x) { return x.id === blockId; });
  if (!item || !item.body || !item.body.trim()) {
    if (typeof showDashToast === 'function') showDashToast('error', 'Write some text in the block first, then use AI to improve it.');
    return;
  }

  var overlay = document.createElement('div');
  overlay.id = 'script-ai-assist-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = '<div class="scripts-s-a40fa6">'
    + '<div class="bio-s-b3617b">AI Assist</div>'
    + '<div class="scripts-s-fea531">What would you like to do with this block?</div>'
    + '<div class="mk-s-f67b86">'
    + '<button data-scripts-action="run-ai-assist" data-scripts-block-id="' + blockId + '" data-scripts-mode="improve" class="script-ai-assist-opt scripts-s-56678c scripts-h-card">'
    + '<div class="scripts-s-c2967b">Improve</div>'
    + '<div class="bio-s-e769ff">Make it clearer and more engaging</div>'
    + '</button>'
    + '<button data-scripts-action="run-ai-assist" data-scripts-block-id="' + blockId + '" data-scripts-mode="expand" class="script-ai-assist-opt scripts-s-56678c scripts-h-card">'
    + '<div class="scripts-s-c2967b">Expand</div>'
    + '<div class="bio-s-e769ff">Add more detail and examples</div>'
    + '</button>'
    + '<button data-scripts-action="run-ai-assist" data-scripts-block-id="' + blockId + '" data-scripts-mode="shorten" class="script-ai-assist-opt scripts-s-56678c scripts-h-card">'
    + '<div class="scripts-s-c2967b">Shorten</div>'
    + '<div class="bio-s-e769ff">Make it more concise</div>'
    + '</button>'
    + '</div>'
    + '<button data-scripts-action="close-assist-modal" class="scripts-s-6fc742">Cancel</button>'
    + '</div>';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

function runAIAssist(blockId, mode) {
  var item = currentScript.items.find(function(x) { return x.id === blockId; });
  if (!item) return;

  // Replace modal content with loading
  var modal = document.getElementById('script-ai-assist-modal');
  if (!modal) return;
  var inner = modal.querySelector('div');
  inner.innerHTML = '<div class="scripts-s-8735e1">'
    + '<svg width="24" height="24" viewBox="0 0 24 24" class="bio-s-9547f9" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>'
    + '<div class="bio-s-57de93">AI is ' + (mode === 'improve' ? 'improving' : mode === 'expand' ? 'expanding' : 'shortening') + ' your text...</div>'
    + '</div>';

  fetch('/api/ai-script', {
    method: 'POST',
    headers: getAIHeaders(),
    body: JSON.stringify({ mode: mode, text: item.body })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) { modal.remove(); if (typeof showDashToast === 'function') showDashToast('error', data.error); return; }

    inner.innerHTML = '<div class="scripts-s-760626">Result</div>'
      + '<div class="scripts-s-ee4a00">'
      + '<div class="scripts-s-c9e492">Original</div>'
      + '<div class="scripts-s-87e3d9">' + escapeHtml(item.body.substring(0, 150)) + (item.body.length > 150 ? '...' : '') + '</div>'
      + '</div>'
      + '<div class="scripts-s-529896">'
      + '<div class="scripts-s-c9e492">' + (mode.charAt(0).toUpperCase() + mode.slice(1)) + 'd</div>'
      + '<div class="bio-s-f0cb5a" id="script-ai-result">' + escapeHtml(data.result) + '</div>'
      + '</div>'
      + '<div class="course-s-b9bbe5">'
      + '<button data-scripts-action="apply-ai-assist" data-scripts-block-id="' + blockId + '" class="ds-s-a51526">Apply</button>'
      + '<button data-scripts-action="close-assist-modal" class="ds-s-dea7b5">Keep original</button>'
      + '<button data-scripts-action="report-ai-result" class="scripts-report-btn">Report</button>'
      + '</div>';
  })
  .catch(function() {
    modal.remove();
    if (typeof showDashToast === 'function') showDashToast('error', 'Failed to process text. Try again.');
  });
}

function applyAIAssist(blockId) {
  var result = document.getElementById('script-ai-result')?.textContent;
  if (!result || !currentScript) return;
  var item = currentScript.items.find(function(x) { return x.id === blockId; });
  if (!item) return;
  item.body = result;
  renderScriptItems();
  markScriptDirty();
  document.getElementById('script-ai-assist-modal')?.remove();
}


// ---------- From dashboard.html lines 14827-16233 (saveAndCollapseHook through copyToClipboard) ----------
async function saveAndCollapseHook() {
  const display = document.getElementById('scripts-hook-display');
  const editWrap = document.getElementById('scripts-hook-edit');
  if (!display || !editWrap) return;
  const hookText = currentScript.hook || '';
  if (hookText.trim()) {
    display.innerHTML = escapeHtml(hookText);
    display.style.display = 'block';
    editWrap.style.display = 'none';
    hookEditing = false;
  }
  // If empty, stay in edit mode
  await saveScriptNow();
}

function editHook() {
  const display = document.getElementById('scripts-hook-display');
  const editWrap = document.getElementById('scripts-hook-edit');
  if (!display || !editWrap) return;
  display.style.display = 'none';
  editWrap.style.display = 'block';
  hookEditing = true;
  // Focus the textarea
  setTimeout(() => {
    const textarea = document.getElementById('scripts-hook-input');
    if (textarea) {
      textarea.focus();
      // Place cursor at end instead of selecting all
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
    }
  }, 20);
}

// ========== Item mutators ==========
function onScriptTitleChange(v) {
  currentScript.title = v;
  markScriptDirty();
}

function onScriptHookChange(v) {
  currentScript.hook = v;
  const counter = document.getElementById('scripts-hook-count');
  if (counter) counter.textContent = v.length;
  updateScriptMeta();
  markScriptDirty();
}

function onScriptPlatformChange(v) {
  currentScript.platform = v;
  markScriptDirty();
}

function onScriptSectionEdit(id, text) {
  const item = currentScript.items.find(x => x.id === id);
  if (item) { item.text = text; markScriptDirty(); }
}

function onScriptBlockEdit(id, field, value) {
  const item = currentScript.items.find(x => x.id === id);
  if (!item) return;
  item[field] = value;
  if (field === 'body') {
    // Update the block's own word/seconds meta inline
    const metaEl = document.querySelector(`.scripts-block-count[data-id="${id}"]`);
    if (metaEl) {
      const wordCount = (value || '').trim().split(/\s+/).filter(Boolean).length;
      const seconds = Math.max(1, Math.round((wordCount / SCRIPT_WPM) * 60));
      metaEl.textContent = `${wordCount} words · ${seconds}s`;
    }
    updateScriptMeta();
  }
  markScriptDirty();
}

function removeScriptItem(id) {
  currentScript.items = currentScript.items.filter(x => x.id !== id);
  renderScriptItems();
  markScriptDirty();
}

function addScriptSection() {
  const newId = genScriptItemId('section');
  currentScript.items.push({
    id: newId,
    type: 'section',
    text: 'New section',
  });
  renderScriptItems();
  markScriptDirty();
  // Focus + select the text of the newly added section
  setTimeout(() => {
    const el = document.querySelector(`.scripts-section[data-id="${newId}"] .scripts-section-input`);
    if (el) { el.focus(); el.select(); }
  }, 20);
}

function addScriptBlock() {
  const blockCount = currentScript.items.filter(i => i.type === 'block').length;
  if (blockCount >= SCRIPT_BLOCKS_MAX) {
    alert(`Block limit reached (${SCRIPT_BLOCKS_MAX}). Delete existing blocks to add more.`);
    return;
  }
  currentScript.items.push({
    id: genScriptItemId('block'),
    type: 'block',
    title: '',
    body: '',
  });
  renderScriptItems();
  markScriptDirty();
  // Focus new block body
  setTimeout(() => {
    const last = document.querySelector('.scripts-block:last-child .scripts-block-body');
    if (last) last.focus();
  }, 20);
}

function updateScriptMeta() {
  const duration = calcScriptDuration(currentScript);
  const blockCount = currentScript.items.filter(i => i.type === 'block').length;
  const durEl = document.getElementById('scripts-total-duration');
  const cntEl = document.getElementById('scripts-block-count');
  const addBtn = document.getElementById('scripts-add-block-btn');
  if (durEl) durEl.textContent = duration;
  if (cntEl) cntEl.textContent = blockCount;
  if (addBtn) {
    addBtn.disabled = blockCount >= SCRIPT_BLOCKS_MAX;
    addBtn.style.opacity = blockCount >= SCRIPT_BLOCKS_MAX ? 0.5 : 1;
  }
}

// ========== Save + dirty tracking ==========
function markScriptDirty() {
  scriptsDirty = true;
  updateSaveStatus('Unsaved');
  // Debounced autosave
  if (scriptsAutoSaveTimer) clearTimeout(scriptsAutoSaveTimer);
  scriptsAutoSaveTimer = setTimeout(() => {
    saveScriptNow(true);
  }, 2000);
}

function updateSaveStatus(msg, kind) {
  const el = document.getElementById('scripts-save-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'scripts-save-status ' + (kind || '');
}

async function saveScriptNow(silent) {
  if (!currentScript || !currentUser) return;
  // Single-flight: never let two saves overlap. A second save started before the
  // first returns would still carry the OLD updated_at token (the first save
  // hasn't refreshed it yet), so it would falsely fail the optimistic-concurrency
  // check and show the "changed on another device" error. If a save is already
  // running, just leave the script marked dirty; the in-flight save reschedules
  // a follow-up when it finishes so the latest edits still get persisted.
  if (scriptsSaving) {
    scriptsDirty = true;
    return;
  }
  if (scriptsAutoSaveTimer) { clearTimeout(scriptsAutoSaveTimer); scriptsAutoSaveTimer = null; }
  scriptsSaving = true;
  try {
    const payload = {
      title: (currentScript.title || 'Untitled script').slice(0, 80),
      hook: (currentScript.hook || '').slice(0, 200),
      platform: currentScript.platform || 'reel',
      items: currentScript.items || [],
    };
    let q = sb
      .from('scripts')
      .update(payload)
      .eq('id', currentScript.id)
      .eq('user_id', currentUser.id);
    // Optimistic concurrency: the update only matches if the row still has
    // the updated_at this tab loaded. If another tab or device saved a
    // newer version, zero rows match and nothing is overwritten.
    if (currentScript.updated_at) q = q.eq('updated_at', currentScript.updated_at);
    const { data, error } = await q.select().maybeSingle();
    if (error) throw error;
    if (!data) {
      // Genuine version conflict (a real newer version exists). Clear dirty so
      // the finally block doesn't reschedule a doomed retry loop; the user needs
      // to reload to get the latest version.
      scriptsDirty = false;
      if (typeof showDashToast === 'function') showDashToast('error', 'This script was changed in another tab or on another device, so this save was blocked to avoid overwriting the newer version. Reload the page to get the latest version.');
      return;
    }
    currentScript.updated_at = data.updated_at;
    // Update cached list
    const idx = scriptsList.findIndex(s => s.id === currentScript.id);
    if (idx !== -1) scriptsList[idx] = { ...scriptsList[idx], ...payload, updated_at: data.updated_at };
    scriptsDirty = false;
    // Explicit Save presses (upper-right, hook, block) confirm via toast only.
    // The silent 2-second autosave stays inline-only (no toast spam while
    // typing) and reads "Autosaved" to distinguish it from a manual save.
    if (!silent) {
      if (typeof showDashToast === 'function') showDashToast('success', 'Script saved');
    } else {
      updateSaveStatus('Autosaved', 'success');
      setTimeout(() => {
        if (!scriptsDirty) updateSaveStatus('');
      }, 2000);
    }
  } catch (e) {
    console.error(e);
    if (typeof showDashToast === 'function') showDashToast('error', 'Could not save your script. Please check your connection and try again.');
  } finally {
    scriptsSaving = false;
    // If edits came in while this save was in flight, persist them now with the
    // freshly-updated token. Silent so it doesn't toast over a manual save.
    if (scriptsDirty && currentScript) {
      if (scriptsAutoSaveTimer) clearTimeout(scriptsAutoSaveTimer);
      scriptsAutoSaveTimer = setTimeout(() => { saveScriptNow(true); }, 400);
    }
  }
}

// ========== Export menu ==========
function toggleScriptsExportMenu() {
  const menu = document.getElementById('scripts-export-menu');
  if (!menu) return;
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function scriptsExportOutsideClick(e) {
  const wrap = document.querySelector('.scripts-export-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const menu = document.getElementById('scripts-export-menu');
    if (menu) menu.style.display = 'none';
  }
}

function exportScriptCopyAll() {
  const text = buildScriptFullText();
  copyToClipboard(text);
  toggleScriptsExportMenu();
}

function exportScriptCopySpoken() {
  const parts = [];
  if (currentScript.hook) parts.push(currentScript.hook);
  currentScript.items.forEach(i => {
    if (i.type === 'block' && i.body) parts.push(i.body);
  });
  copyToClipboard(parts.join('\n\n'));
  toggleScriptsExportMenu();
}

function exportScriptDownloadTxt() {
  const text = buildScriptFullText();
  const fileName = (currentScript.title || 'script').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.txt';

  // Native app: WKWebView does not support the anchor download attribute,
  // so the text file goes across the bridge to the iOS save/share sheet.
  if (window.RyxaNative && window.ReactNativeWebView) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'saveFile',
        filename: fileName,
        mime: 'text/plain',
        base64: btoa(unescape(encodeURIComponent(text)))
      }));
    } catch (e) { console.error('export bridge', e); }
    toggleScriptsExportMenu();
    return;
  }

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toggleScriptsExportMenu();
}

function exportScriptPDF() {
  toggleScriptsExportMenu();
  if (!currentScript) return;

  // Build a clean print-ready HTML doc in a hidden iframe and trigger print
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  const html = buildScriptPrintHTML();
  doc.open();
  doc.write(html);
  doc.close();

  // Wait for fonts/layout, then print
  iframe.onload = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.error('print', e);
    }
    // Clean up the iframe after print dialog closes
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch (e) {}
    }, 1000);
  };
}

function buildScriptPrintHTML() {
  const title = escapeHtml(currentScript.title || 'Untitled script');
  const platform = SCRIPT_PLATFORMS[currentScript.platform] || 'Script';
  const duration = calcScriptDuration(currentScript);
  const blockCount = currentScript.items.filter(i => i.type === 'block').length;
  const hook = escapeHtml(currentScript.hook || '');

  const itemsHtml = currentScript.items.map(i => {
    if (i.type === 'section') {
      return `<div class="section">${escapeHtml(i.text || 'Section')}</div>`;
    }
    const bTitle = i.title ? `<div class="b-title">${escapeHtml(i.title)}</div>` : '';
    const body = escapeHtml(i.body || '').replace(/\n/g, '<br>');
    const wordCount = (i.body || '').trim().split(/\s+/).filter(Boolean).length;
    const seconds = Math.max(1, Math.round((wordCount / SCRIPT_WPM) * 60));
    return `<div class="block">${bTitle}<div class="b-body">${body || '<em class="empty">(empty)</em>'}</div><div class="b-meta">${wordCount} words · ${seconds}s</div></div>`;
  }).join('');

  const showBrand = isPro() ? false : true;  // Max removes branding; matching existing pattern
  const brandFooter = showBrand
    ? '<div class="brand-footer">Built with <strong>Ryxa</strong> · ryxa.io</div>'
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: letter; margin: 0.75in; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    color: #111;
    background: #fff;
    line-height: 1.5;
    font-size: 11pt;
    margin: 0;
    padding: 0;
  }
  .doc { max-width: 100%; }
  .title {
    font-size: 22pt;
    font-weight: 800;
    letter-spacing: -0.5px;
    margin-bottom: 4pt;
    color: #000;
  }
  .subtitle {
    font-size: 10pt;
    color: #666;
    margin-bottom: 24pt;
    padding-bottom: 12pt;
    border-bottom: 1px solid #ddd;
  }
  .hook-box {
    background: #f8f6ff;
    border-left: 3px solid #7c3aed;
    padding: 12pt 14pt;
    margin-bottom: 20pt;
    border-radius: 0 6pt 6pt 0;
  }
  .hook-label {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #7c3aed;
    font-weight: 700;
    margin-bottom: 4pt;
  }
  .hook-text {
    font-size: 13pt;
    font-weight: 500;
    color: #111;
    line-height: 1.45;
  }
  .section {
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: #888;
    font-weight: 700;
    margin: 20pt 0 10pt;
    padding-top: 8pt;
    border-top: 1px solid #eaeaea;
  }
  .section:first-of-type { margin-top: 10pt; }
  .block {
    margin-bottom: 14pt;
    padding: 10pt 12pt;
    background: #fafafa;
    border: 1px solid #eee;
    border-radius: 4pt;
  }
  .b-title {
    font-size: 10pt;
    font-weight: 700;
    color: #333;
    margin-bottom: 4pt;
  }
  .b-body {
    font-size: 11pt;
    color: #222;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .b-body .empty { color: #bbb; font-style: italic; }
  .b-meta {
    font-size: 8pt;
    color: #999;
    margin-top: 6pt;
    text-align: right;
  }
  .brand-footer {
    margin-top: 32pt;
    padding-top: 12pt;
    border-top: 1px solid #eee;
    font-size: 8pt;
    color: #999;
    text-align: center;
  }
  .brand-footer strong { color: #7c3aed; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="doc">
  <div class="title">${title}</div>
  <div class="subtitle">${platform} · ${duration}s · ${blockCount} ${blockCount === 1 ? 'block' : 'blocks'}</div>
  ${hook ? `<div class="hook-box"><div class="hook-label">Hook</div><div class="hook-text">${hook.replace(/\n/g, '<br>')}</div></div>` : ''}
  ${itemsHtml || '<div class="scripts-s-f501d4">No content yet.</div>'}
  ${brandFooter}
</div>
</body></html>`;
}

function openTeleprompter() {
  if (!currentScript) return;

  // Build the text to scroll
  const parts = [];
  if (currentScript.hook) parts.push(currentScript.hook);
  currentScript.items.forEach(i => {
    if (i.type === 'block' && i.body) parts.push(i.body);
  });
  const script = parts.join('\n\n').trim();
  if (!script) {
    alert('Add some content first - the teleprompter needs text to scroll.');
    return;
  }

  // Create fullscreen overlay
  let tp = document.getElementById('teleprompter-overlay');
  if (tp) tp.remove();

  tp = document.createElement('div');
  tp.id = 'teleprompter-overlay';
  tp.innerHTML = `
    <div class="tp-top">
      <button class="tp-close-btn" data-scripts-action="close-teleprompter" aria-label="Close teleprompter">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Exit
      </button>
      <div class="tp-title">${escapeHtml(currentScript.title || 'Untitled script')}</div>
    </div>
    <div class="tp-scroll-area" id="tp-scroll-area">
      <div class="tp-spacer-top"></div>
      <div class="tp-content" id="tp-content">${escapeHtml(script).replace(/\n/g, '<br>')}</div>
      <div class="tp-spacer-bottom"></div>
    </div>
    <div class="tp-center-line"></div>
    <div class="tp-controls">
      <button class="tp-ctrl-btn" data-scripts-action="tp-speed" data-scripts-delta="-1" aria-label="Slower">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <div class="tp-speed-display"><span id="tp-speed-val">3</span><span class="tp-speed-unit">speed</span></div>
      <button class="tp-ctrl-btn" data-scripts-action="tp-speed" data-scripts-delta="1" aria-label="Faster">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <div class="tp-divider"></div>
      <button class="tp-ctrl-btn primary" data-scripts-action="tp-toggle-play" id="tp-play-btn">
        <svg id="tp-play-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>
        <span id="tp-play-label">Play</span>
      </button>
      <button class="tp-ctrl-btn" data-scripts-action="tp-restart" aria-label="Restart">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
      </button>
      <div class="tp-divider"></div>
      <button class="tp-ctrl-btn" data-scripts-action="tp-font" data-scripts-delta="-1" aria-label="Smaller text">A<small>−</small></button>
      <button class="tp-ctrl-btn" data-scripts-action="tp-font" data-scripts-delta="1" aria-label="Larger text">A<small>+</small></button>
      <div class="tp-divider"></div>
      <button class="tp-voice-toggle" id="tp-voice-toggle" data-scripts-action="tp-toggle-voice" aria-label="Toggle voice read-aloud">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        <span id="tp-voice-label">Voice</span>
      </button>
      <div class="tp-voice-speed" id="tp-voice-speed">
        <button class="tp-voice-speed-btn" data-scripts-action="tp-voice-speed" data-scripts-delta="-0.15" aria-label="Slower voice">−</button>
        <span class="tp-voice-speed-label" id="tp-voice-speed-val">1×</span>
        <button class="tp-voice-speed-btn" data-scripts-action="tp-voice-speed" data-scripts-delta="0.15" aria-label="Faster voice">+</button>
      </div>
    </div>
    <div class="tp-hint">Space: play/pause · ↑↓: speed · V: toggle voice · Esc: exit</div>
  `;
  document.body.appendChild(tp);

  // State
  tpState = {
    playing: false,
    speed: 3,        // pixels per frame at normal
    fontSize: 48,
    rafId: null,
    keyHandler: null,
    voiceOn: false,
    voiceRate: 1.0,
    voiceParts: parts, // keep reference for voice reading
  };
  applyTpFontSize();
  tpState.keyHandler = tpOnKey;
  document.addEventListener('keydown', tpState.keyHandler);
  // Auto-scroll so first line starts at center line
  setTimeout(() => {
    const area = document.getElementById('tp-scroll-area');
    if (area) area.scrollTop = 0;
  }, 50);
}

let tpState = null;

function closeTeleprompter() {
  if (tpState?.rafId) cancelAnimationFrame(tpState.rafId);
  if (tpState?.keyHandler) document.removeEventListener('keydown', tpState.keyHandler);
  // Stop any active voice
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  tpState = null;
  const tp = document.getElementById('teleprompter-overlay');
  if (tp) tp.remove();
}

function tpTogglePlay() {
  if (!tpState) return;
  tpState.playing = !tpState.playing;
  const icon = document.getElementById('tp-play-icon');
  const label = document.getElementById('tp-play-label');
  if (tpState.playing) {
    if (icon) icon.innerHTML = '<rect x="5" y="3" width="5" height="18"/><rect x="14" y="3" width="5" height="18"/>';
    if (label) label.textContent = 'Pause';
    if (tpState.voiceOn) {
      // Voice mode: voice drives scroll
      tpStartVoice();
    } else {
      // Normal mode: plain auto-scroll
      tpTick();
    }
  } else {
    if (icon) icon.innerHTML = '<polygon points="6 3 20 12 6 21 6 3"/>';
    if (label) label.textContent = 'Play';
    if (tpState.rafId) cancelAnimationFrame(tpState.rafId);
    if (tpState.voiceOn) tpPauseVoice();
  }
}

function tpTick() {
  if (!tpState || !tpState.playing) return;
  // If voice is on, voice drives scroll - don't also auto-scroll
  if (tpState.voiceOn) return;
  const area = document.getElementById('tp-scroll-area');
  if (!area) return;
  // Accumulate fractional scroll. scrollTop is integer-pixel rounded by the
  // browser, so adding e.g. 0.125 per frame (speed 0.25) gets truncated to 0.
  // We accumulate the fraction here and only apply the whole-pixel portion.
  tpState.scrollAccumulator = (tpState.scrollAccumulator || 0) + tpState.speed * 0.5;
  if (tpState.scrollAccumulator >= 1) {
    var whole = Math.floor(tpState.scrollAccumulator);
    area.scrollTop += whole;
    tpState.scrollAccumulator -= whole;
  }
  if (area.scrollTop + area.clientHeight >= area.scrollHeight - 1) {
    tpTogglePlay();
    return;
  }
  tpState.rafId = requestAnimationFrame(tpTick);
}

function tpAdjustSpeed(delta) {
  if (!tpState) return;
  // Adaptive step: below 1, step by 0.25 (0.25, 0.5, 0.75, 1).
  // At 1 and above, step by 1 (1, 2, ..., 10).
  // The button still passes ±1 as delta - we reinterpret it here.
  var direction = delta > 0 ? 1 : -1;
  var current = tpState.speed;
  var next;
  if (direction > 0) {
    // Speeding up
    next = current < 1 ? current + 0.25 : current + 1;
  } else {
    // Slowing down
    next = current <= 1 ? current - 0.25 : current - 1;
  }
  // Clamp and round to avoid floating-point creep (e.g. 0.7500000001)
  next = Math.max(0.25, Math.min(10, Math.round(next * 100) / 100));
  tpState.speed = next;
  const el = document.getElementById('tp-speed-val');
  // Show "0.25"/"0.5"/"0.75" as-is, but show integers without trailing ".0"
  if (el) el.textContent = Number.isInteger(next) ? String(next) : String(next);
}

function tpAdjustFontSize(delta) {
  if (!tpState) return;
  tpState.fontSize = Math.max(24, Math.min(96, tpState.fontSize + delta * 4));
  applyTpFontSize();
}

function applyTpFontSize() {
  const content = document.getElementById('tp-content');
  if (content && tpState) content.style.fontSize = tpState.fontSize + 'px';
}

function tpRestart() {
  const area = document.getElementById('tp-scroll-area');
  if (area) area.scrollTop = 0;
  if (tpState) {
    tpState.voiceChunkIndex = 0;
    tpState.scrollAccumulator = 0;
    // If voice is playing, stop and rebuild from beginning
    if (tpState.voiceOn && tpState.playing) {
      tpStopVoice();
      tpState.voiceChunks = null;
      tpStartVoice();
    }
  }
  document.querySelectorAll('.tp-chunk.active').forEach(s => s.classList.remove('active'));
}

function tpOnKey(e) {
  if (!tpState) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeTeleprompter();
  } else if (e.key === ' ') {
    e.preventDefault();
    tpTogglePlay();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    tpAdjustSpeed(1);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    tpAdjustSpeed(-1);
  } else if (e.key === 'Home' || e.key === 'r') {
    e.preventDefault();
    tpRestart();
  } else if (e.key === 'v' || e.key === 'V') {
    e.preventDefault();
    tpToggleVoice();
  }
}

// ========== TELEPROMPTER VOICE ==========

function tpToggleVoice() {
  if (!tpState) return;
  tpState.voiceOn = !tpState.voiceOn;

  const btn = document.getElementById('tp-voice-toggle');
  const label = document.getElementById('tp-voice-label');
  const speedRow = document.getElementById('tp-voice-speed');

  if (tpState.voiceOn) {
    if (btn) btn.classList.add('active');
    if (label) label.textContent = 'Voice On';
    if (speedRow) speedRow.classList.add('visible');
    // If already playing, start voice now
    if (tpState.playing) {
      // Stop plain auto-scroll, let voice drive
      if (tpState.rafId) cancelAnimationFrame(tpState.rafId);
      tpStartVoice();
    }
    // Otherwise, voice starts when they press Play
  } else {
    if (btn) btn.classList.remove('active');
    if (label) label.textContent = 'Voice';
    if (speedRow) speedRow.classList.remove('visible');
    tpStopVoice();
    // If playing, resume plain auto-scroll
    if (tpState.playing) tpTick();
  }
}

function tpBuildChunkSpans() {
  // Wrap each sentence/chunk in a <span> so we can scroll to it as it's read
  const content = document.getElementById('tp-content');
  if (!content || !tpState) return;

  const text = (tpState.voiceParts || []).join('.\n\n');
  if (!text.trim()) return;

  const chunks = text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [text];
  tpState.voiceChunks = chunks;

  // Rebuild content with spans
  content.innerHTML = chunks.map((c, i) =>
    `<span class="tp-chunk" data-chunk="${i}">${escapeHtml(c.trim())}</span> `
  ).join('');
}

function tpScrollToChunk(index) {
  const area = document.getElementById('tp-scroll-area');
  const span = document.querySelector(`.tp-chunk[data-chunk="${index}"]`);
  if (!area || !span) return;

  // Highlight current chunk
  document.querySelectorAll('.tp-chunk.active').forEach(s => s.classList.remove('active'));
  span.classList.add('active');

  // Scroll so the chunk is roughly in the center of the viewport
  const areaRect = area.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  const targetScroll = area.scrollTop + (spanRect.top - areaRect.top) - (areaRect.height / 2) + (spanRect.height / 2);
  area.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
}

function tpStartVoice() {
  if (!tpState || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  // Build chunk spans if not already done
  if (!tpState.voiceChunks) tpBuildChunkSpans();
  const chunks = tpState.voiceChunks;
  if (!chunks || chunks.length === 0) return;

  // Resume from where we paused, or start from beginning
  let chunkIndex = tpState.voiceChunkIndex || 0;

  function speakNext() {
    if (!tpState || !tpState.voiceOn || !tpState.playing || chunkIndex >= chunks.length) {
      // Done speaking - pause playback
      if (tpState && chunkIndex >= chunks.length) {
        tpState.voiceChunkIndex = 0;
        tpTogglePlay(); // stop
      }
      return;
    }

    tpState.voiceChunkIndex = chunkIndex;
    tpScrollToChunk(chunkIndex);

    const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex].trim());
    utterance.rate = tpState.voiceRate;
    utterance.pitch = 1;
    utterance.volume = 1;

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang.startsWith('en') && v.name.includes('Samantha'))
      || voices.find(v => v.lang.startsWith('en-US') && !v.name.includes('Google'))
      || voices.find(v => v.lang.startsWith('en-US'))
      || voices.find(v => v.lang.startsWith('en'))
      || voices[0];
    if (preferred) utterance.voice = preferred;

    utterance.onend = function() {
      // tpState may be null if the user exited the teleprompter while this
      // utterance was still in progress - cancel() fires both onend and
      // onerror on the cancelled utterance, but by then tpState is gone.
      if (!tpState) return;
      chunkIndex++;
      tpState.voiceChunkIndex = chunkIndex;
      speakNext();
    };
    utterance.onerror = function() {
      if (!tpState) return;
      chunkIndex++;
      tpState.voiceChunkIndex = chunkIndex;
      speakNext();
    };

    window.speechSynthesis.speak(utterance);
  }

  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = function() {
      window.speechSynthesis.onvoiceschanged = null;
      speakNext();
    };
  } else {
    speakNext();
  }
}

function tpPauseVoice() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  // voiceChunkIndex is preserved so resume picks up where we left off
}

function tpStopVoice() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (tpState) {
    tpState.voiceChunkIndex = 0;
    tpState.voiceChunks = null;
  }
  // Remove chunk highlights
  document.querySelectorAll('.tp-chunk.active').forEach(s => s.classList.remove('active'));
}

function tpAdjustVoiceSpeed(delta) {
  if (!tpState) return;
  tpState.voiceRate = Math.max(0.5, Math.min(2.0, Math.round((tpState.voiceRate + delta) * 100) / 100));
  const el = document.getElementById('tp-voice-speed-val');
  if (el) el.textContent = tpState.voiceRate.toFixed(1) + '×';

  // If currently speaking, restart from current chunk with new speed
  if (tpState.voiceOn && tpState.playing && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    // voiceChunkIndex is already set - tpStartVoice will resume from there
    tpStartVoice();
  }
}

// ========== CINEMATIC MODE ==========
let cineState = null;

function openCinematic() {
  if (!currentScript) return;
  const cards = buildCinematicCards();
  if (cards.length === 0) {
    alert('Add some content first - cinematic mode needs text to play.');
    return;
  }

  let el = document.getElementById('cinematic-overlay');
  if (el) el.remove();

  el = document.createElement('div');
  el.id = 'cinematic-overlay';
  el.innerHTML = `
    <button class="cine-close-btn" data-scripts-action="close-cinematic" aria-label="Exit cinematic mode">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="cine-stage" id="cine-stage"></div>
    <div class="cine-paused bio-s-c8be1c" id="cine-paused" >
      <div class="cine-paused-inner">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        <div>Paused</div>
        <div class="cine-paused-hint">Click or press space to resume</div>
      </div>
    </div>
    <div class="cine-hover-zone" id="cine-hover-zone"></div>
    <div class="cine-bar" id="cine-bar">
      <div class="cine-bar-inner">
        <div class="cine-bar-progress">
          <div class="cine-bar-progress-fill" id="cine-progress-bar"></div>
        </div>
        <div class="cine-bar-controls">
          <button class="cine-bar-btn" data-scripts-action="cine-prev" aria-label="Previous">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="cine-bar-btn play-btn" data-scripts-action="cine-toggle-play" id="cine-bar-play">
            <svg id="cine-bar-play-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            <span id="cine-bar-play-label">Pause</span>
          </button>
          <button class="cine-bar-btn" data-scripts-action="cine-next" aria-label="Next">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="cine-bar-divider"></div>
          <span class="cine-music-label">Music</span>
          <div class="cine-music-group">
            <button class="cine-music-btn active" data-mood="none" data-scripts-action="cine-mood" data-scripts-mood="none">None</button>
            <button class="cine-music-btn" data-mood="peaceful" data-scripts-action="cine-mood" data-scripts-mood="peaceful">Peaceful</button>
            <button class="cine-music-btn" data-mood="comedy" data-scripts-action="cine-mood" data-scripts-mood="comedy">Comedy</button>
            <button class="cine-music-btn" data-mood="action" data-scripts-action="cine-mood" data-scripts-mood="action">Action</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  cineState = {
    cards,
    idx: -1,
    playing: true,
    phase: 'idle',
    phaseStart: 0,
    rafId: null,
    keyHandler: null,
    totalDuration: cards.reduce((sum, c) => sum + c.duration, 0),
    elapsedBeforeCurrent: 0,
    musicMood: null,    // null | 'peaceful' | 'comedy' | 'action'
    musicMuted: true,   // starts muted - user opts in
    barHideTimeout: null,
  };

  cineState.keyHandler = cineOnKey;
  document.addEventListener('keydown', cineState.keyHandler);

  // Click stage to pause/resume (but not the bar or close button)
  el.addEventListener('click', (e) => {
    if (e.target.closest('.cine-close-btn') || e.target.closest('.cine-bar') || e.target.closest('.cine-hover-zone')) return;
    cineTogglePlay();
  });

  // Hover zone: show bar when mouse enters bottom area, hide after leaving
  const hoverZone = document.getElementById('cine-hover-zone');
  const bar = document.getElementById('cine-bar');
  function showCineBar() {
    if (bar) bar.classList.add('visible');
    clearTimeout(cineState?.barHideTimeout);
  }
  function scheduleHideCineBar() {
    if (!cineState) return;
    cineState.barHideTimeout = setTimeout(() => {
      if (bar && !bar.matches(':hover')) bar.classList.remove('visible');
    }, 2000);
  }
  if (hoverZone) {
    hoverZone.addEventListener('mouseenter', showCineBar);
    hoverZone.addEventListener('mouseleave', scheduleHideCineBar);
  }
  if (bar) {
    bar.addEventListener('mouseenter', showCineBar);
    bar.addEventListener('mouseleave', scheduleHideCineBar);
    // On touch: tap anywhere near bottom to toggle
    bar.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  }
  // Show bar briefly on open so user knows it's there
  showCineBar();
  scheduleHideCineBar();

  // Also show bar on any mouse movement, then auto-hide
  el.addEventListener('mousemove', () => {
    showCineBar();
    scheduleHideCineBar();
  });

  // Start
  cineNextCard();
}

function buildCinematicCards() {
  const cards = [];
  const title = currentScript.title || 'Untitled script';
  const platform = SCRIPT_PLATFORMS[currentScript.platform] || '';
  const totalDuration = calcScriptDuration(currentScript);

  // Title card
  cards.push({
    kind: 'title',
    title: title,
    subtitle: `${platform} · ${totalDuration}s`,
    duration: 2500,
  });

  // Hook card
  if (currentScript.hook) {
    cards.push({
      kind: 'hook',
      label: 'HOOK',
      text: currentScript.hook,
      duration: Math.max(2500, estimateMs(currentScript.hook)),
    });
  }

  // Walk items
  (currentScript.items || []).forEach(item => {
    if (item.type === 'section') {
      cards.push({
        kind: 'section',
        text: item.text || 'Section',
        duration: 1800,
      });
    } else if (item.type === 'block') {
      const body = (item.body || '').trim();
      if (!body && !item.title) return;
      cards.push({
        kind: 'block',
        title: item.title || '',
        body: body,
        duration: Math.max(2500, estimateMs(body || item.title)),
      });
    }
  });

  // End card
  cards.push({
    kind: 'end',
    text: 'FIN',
    subtitle: `${totalDuration}s total`,
    duration: 2500,
  });

  return cards;
}

function estimateMs(text) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  // 150 wpm, so each word = 400ms. Min 2.5s, max 15s per card.
  return Math.min(15000, Math.max(2500, words * 400));
}

function cineNextCard() {
  if (!cineState) return;
  if (cineState.idx >= 0) {
    cineState.elapsedBeforeCurrent += cineState.cards[cineState.idx].duration;
  }
  cineState.idx++;
  if (cineState.idx >= cineState.cards.length) {
    closeCinematic();
    return;
  }
  renderCinematicCard();
}

function cinePrevCard() {
  if (!cineState) return;
  if (cineState.idx <= 0) return;
  cineState.idx--;
  cineState.elapsedBeforeCurrent = 0;
  for (let i = 0; i < cineState.idx; i++) {
    cineState.elapsedBeforeCurrent += cineState.cards[i].duration;
  }
  renderCinematicCard();
}

function renderCinematicCard() {
  const stage = document.getElementById('cine-stage');
  if (!stage || !cineState) return;
  const card = cineState.cards[cineState.idx];
  if (!card) return;

  let html = '';
  if (card.kind === 'title') {
    html = `<div class="cine-card cine-card-title">
      <div class="cine-title-text">${escapeHtml(card.title)}</div>
      <div class="cine-subtitle">${escapeHtml(card.subtitle)}</div>
    </div>`;
  } else if (card.kind === 'hook') {
    html = `<div class="cine-card cine-card-hook">
      <div class="cine-hook-label">${escapeHtml(card.label)}</div>
      <div class="cine-hook-text">${escapeHtml(card.text)}</div>
    </div>`;
  } else if (card.kind === 'section') {
    html = `<div class="cine-card cine-card-section">
      <div class="cine-section-line"></div>
      <div class="cine-section-text">${escapeHtml(card.text)}</div>
      <div class="cine-section-line"></div>
    </div>`;
  } else if (card.kind === 'block') {
    const titleHtml = card.title ? `<div class="cine-block-title">${escapeHtml(card.title)}</div>` : '';
    // Scale font down for longer blocks so they're more likely to fit
    const charCount = (card.body || '').length;
    let fontSize;
    if (charCount > 800) fontSize = 'clamp(18px, 2.5vw, 26px)';
    else if (charCount > 500) fontSize = 'clamp(20px, 3vw, 32px)';
    else if (charCount > 300) fontSize = 'clamp(24px, 3.5vw, 38px)';
    else fontSize = '';
    const fontStyle = fontSize ? ` style="font-size:${fontSize}"` : '';
    html = `<div class="cine-card cine-card-block">
      ${titleHtml}
      <div class="cine-block-text"${fontStyle}>${escapeHtml(card.body)}</div>
    </div>`;
  } else if (card.kind === 'end') {
    html = `<div class="cine-card cine-card-end">
      <div class="cine-end-text">${escapeHtml(card.text)}</div>
      <div class="cine-subtitle">${escapeHtml(card.subtitle)}</div>
    </div>`;
  }

  stage.innerHTML = html;
  // Scroll to top for long cards
  stage.scrollTop = 0;
  // Trigger animation
  requestAnimationFrame(() => {
    const cardEl = stage.querySelector('.cine-card');
    if (cardEl) cardEl.classList.add('visible');
  });

  cineState.phase = 'in';
  cineState.phaseStart = performance.now();
  cineTick();
}

function cineTick() {
  if (!cineState || !cineState.playing) return;
  const card = cineState.cards[cineState.idx];
  if (!card) return;

  const now = performance.now();
  const elapsed = now - cineState.phaseStart;
  const FADE = 600;
  const holdDuration = Math.max(400, card.duration - FADE * 2);

  if (cineState.phase === 'in' && elapsed >= FADE) {
    cineState.phase = 'hold';
    cineState.phaseStart = now;
  } else if (cineState.phase === 'hold' && elapsed >= holdDuration) {
    cineState.phase = 'out';
    cineState.phaseStart = now;
    const cardEl = document.querySelector('#cine-stage .cine-card');
    if (cardEl) cardEl.classList.add('fading-out');
  } else if (cineState.phase === 'out' && elapsed >= FADE) {
    cineNextCard();
    return;
  }

  // Update progress bar
  const bar = document.getElementById('cine-progress-bar');
  if (bar) {
    const cardProgress = Math.min(1, (now - (cineState.phaseStart - elapsed)) / card.duration);
    const total = cineState.totalDuration;
    const current = cineState.elapsedBeforeCurrent + (cardProgress * card.duration);
    bar.style.width = Math.min(100, (current / total) * 100) + '%';
  }

  cineState.rafId = requestAnimationFrame(cineTick);
}

function cineTogglePlay() {
  if (!cineState) return;
  cineState.playing = !cineState.playing;
  const pausedEl = document.getElementById('cine-paused');
  const barIcon = document.getElementById('cine-bar-play-icon');
  const barLabel = document.getElementById('cine-bar-play-label');
  if (cineState.playing) {
    if (pausedEl) pausedEl.style.display = 'none';
    if (barIcon) barIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    if (barLabel) barLabel.textContent = 'Pause';
    cineState.phaseStart = performance.now() - cineState.pausedElapsed;
    cineTick();
  } else {
    if (cineState.rafId) cancelAnimationFrame(cineState.rafId);
    cineState.pausedElapsed = performance.now() - cineState.phaseStart;
    if (pausedEl) pausedEl.style.display = 'flex';
    if (barIcon) barIcon.innerHTML = '<polygon points="6 3 20 12 6 21 6 3"/>';
    if (barLabel) barLabel.textContent = 'Play';
  }
}

function closeCinematic() {
  if (cineState?.rafId) cancelAnimationFrame(cineState.rafId);
  if (cineState?.keyHandler) document.removeEventListener('keydown', cineState.keyHandler);
  if (cineState?.barHideTimeout) clearTimeout(cineState.barHideTimeout);
  stopCineMusic();
  cineState = null;
  const el = document.getElementById('cinematic-overlay');
  if (el) el.remove();
}

function cineOnKey(e) {
  if (!cineState) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeCinematic();
  } else if (e.key === ' ') {
    e.preventDefault();
    cineTogglePlay();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    cineNextCard();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    cinePrevCard();
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    toggleCineMusic();
  }
}

// ========== CINEMATIC MUSIC (Tone.js) ==========
let cineMusicNodes = null;

// Tone.js is ~150KB and was previously loaded eagerly in dashboard.html, which
// caused two real problems:
//  1) Every dashboard visit fired Chrome AudioContext autoplay warnings because
//     Tone.Transport gets constructed on first access (before any user gesture).
//  2) Wasted bandwidth and parse time for the ~99% of sessions that never use
//     Cinematic Music.
// This loader injects the script tag on demand the first time the user picks
// a mood. The SRI hash matches the previous eager-loaded tag.
let _toneLoadPromise = null;
function ensureToneLoaded() {
  if (typeof Tone !== 'undefined') return Promise.resolve();
  if (_toneLoadPromise) return _toneLoadPromise;
  _toneLoadPromise = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/tone/14.7.77/Tone.js';
    s.integrity = 'sha384-OIQZlttB2MRaZyoi526rVHiNUGYEq4MAMxDbTkwghmmqxs556T5g5LY926GH7NYM';
    s.crossOrigin = 'anonymous';
    s.onload = function() { resolve(); };
    s.onerror = function() {
      // Allow a future click to retry - clear the cached failed promise.
      _toneLoadPromise = null;
      reject(new Error('Failed to load Tone.js'));
    };
    document.head.appendChild(s);
  });
  return _toneLoadPromise;
}

function setCineMood(mood) {
  if (!cineState) return;
  // Update button states
  document.querySelectorAll('.cine-music-btn').forEach(b => b.classList.toggle('active', b.dataset.mood === mood));

  cineState.musicMood = mood === 'none' ? null : mood;

  const muteBtn = document.getElementById('cine-music-mute');

  if (mood === 'none' || !mood) {
    // Stop music, mute
    cineState.musicMuted = true;
    if (muteBtn) muteBtn.classList.add('muted');
    stopCineMusic();
  } else {
    cineState.musicMuted = false;
    if (muteBtn) muteBtn.classList.remove('muted');
    stopCineMusic();
    startCineMusic(mood);
  }
}

function toggleCineMusic() {
  if (!cineState) return;

  // If no mood is selected, mute toggle does nothing meaningful
  if (!cineState.musicMood) {
    cineState.musicMuted = true;
    const muteBtn = document.getElementById('cine-music-mute');
    if (muteBtn) muteBtn.classList.add('muted');
    return;
  }

  cineState.musicMuted = !cineState.musicMuted;

  const muteBtn = document.getElementById('cine-music-mute');
  if (cineState.musicMuted) {
    if (muteBtn) muteBtn.classList.add('muted');
    stopCineMusic();
  } else {
    if (muteBtn) muteBtn.classList.remove('muted');
    startCineMusic(cineState.musicMood);
  }
}

// When stopping music, we can't dispose synths immediately because their
// last-triggered notes may still be in their release tail (envelope, reverb).
// PolySynth specifically queues its internal note-release events on the audio
// context, and disposing a synth before those fire causes
// "Synth was already disposed" errors. We defer disposal by ~5 seconds, which
// covers the longest envelope release (peaceful pad: release=3s) plus the
// longest sustained note (2n at 72 BPM = ~1.7s).
const CINE_DISPOSE_DELAY_MS = 5000;

function stopCineMusic() {
  // Stop the Transport so no NEW Loop callbacks fire.
  try { Tone.Transport.stop(); } catch(e){}
  try { Tone.Transport.cancel(0); } catch(e){}
  try { Tone.Transport.position = 0; } catch(e){}

  if (!cineMusicNodes) return;

  // Snapshot the current nodes so a fast mood-switch doesn't leak the array.
  const toDispose = cineMusicNodes;
  cineMusicNodes = null;

  // Dispose loops immediately - they're scheduled on the Transport which is
  // already stopped, so cancelling them now is safe and prevents any future
  // chord triggers from firing on synths that are about to be disposed.
  toDispose.forEach(n => {
    if (n instanceof Tone.Loop) {
      try { n.stop(0); } catch(e){}
      try { n.cancel(0); } catch(e){}
      try { n.dispose(); } catch(e){}
    }
  });

  // Defer synth/effect disposal so already-triggered notes can finish their
  // release tails. Each call schedules its OWN timer for its OWN snapshot -
  // rapid mood switches result in multiple pending timers, each disposing
  // its own batch when it fires. This guarantees no synth leaks even under
  // fast clicking.
  setTimeout(() => {
    toDispose.forEach(n => {
      if (!(n instanceof Tone.Loop)) {
        try { if (n.dispose) n.dispose(); } catch(e){}
      }
    });
  }, CINE_DISPOSE_DELAY_MS);
}

async function startCineMusic(mood) {
  stopCineMusic();

  // Lazy-load Tone.js on first use. The previous eager load fired Chrome
  // AudioContext autoplay warnings on every dashboard visit.
  try {
    await ensureToneLoaded();
  } catch (e) {
    console.error('Cinematic music unavailable: Tone.js failed to load.', e);
    return;
  }

  // Race-safety: while Tone was loading, the user may have switched moods or
  // cancelled. cineState reflects the latest mood selection; if it no longer
  // matches what we were asked to start, bail out so a stale request doesn't
  // step on a fresher one (which will have triggered its own ensureToneLoaded
  // call - already resolved since the promise is cached).
  if (!cineState || cineState.musicMood !== mood) return;

  // Ensure audio context is started (browsers require user interaction)
  try { await Tone.start(); } catch(e){ return; }
  cineMusicNodes = [];

  try {
    if (mood === 'peaceful') {
      buildPeacefulMusic();
    } else if (mood === 'comedy') {
      buildComedyMusic();
    } else if (mood === 'action') {
      buildActionMusic();
    }

    Tone.Transport.bpm.value = mood === 'action' ? 120 : mood === 'comedy' ? 110 : 72;
    Tone.Transport.start();
  } catch(e) {
    console.error('Failed to start cinematic music:', e);
  }
}

function buildPeacefulMusic() {
  // Warm pad
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 2, decay: 1, sustain: 0.8, release: 3 },
    volume: -18
  }).toDestination();
  cineMusicNodes.push(pad);

  const padChords = [
    ['C4','E4','G4','B4'],
    ['A3','C4','E4','G4'],
    ['F3','A3','C4','E4'],
    ['G3','B3','D4','F4']
  ];
  let chordIdx = 0;
  const padLoop = new Tone.Loop(time => {
    pad.triggerAttackRelease(padChords[chordIdx % padChords.length], '2n', time);
    chordIdx++;
  }, '1m');
  padLoop.start(0);
  cineMusicNodes.push(padLoop);

  // Gentle bell arpeggios
  const bell = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.01, decay: 0.8, sustain: 0, release: 1.2 },
    volume: -22
  }).toDestination();
  cineMusicNodes.push(bell);

  const arpNotes = ['E5','G5','B5','E6','B5','G5','E5','D5'];
  let arpIdx = 0;
  const arpLoop = new Tone.Loop(time => {
    bell.triggerAttackRelease(arpNotes[arpIdx % arpNotes.length], '8n', time);
    arpIdx++;
  }, '4n');
  arpLoop.start(0);
  arpLoop.probability = 0.7;
  cineMusicNodes.push(arpLoop);
}

function buildComedyMusic() {
  // Plucky pizzicato
  const pluck = new Tone.PluckSynth({ volume: -14 }).toDestination();
  cineMusicNodes.push(pluck);

  const pluckNotes = ['C4','E4','G4','C5','B4','G4','A4','F4','D4','G4','E4','C4'];
  let pluckIdx = 0;
  const pluckLoop = new Tone.Loop(time => {
    pluck.triggerAttackRelease(pluckNotes[pluckIdx % pluckNotes.length], time);
    pluckIdx++;
  }, '8n');
  pluckLoop.start(0);
  pluckLoop.probability = 0.8;
  cineMusicNodes.push(pluckLoop);

  // Quirky high blips
  const blip = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.1 },
    volume: -28
  }).toDestination();
  cineMusicNodes.push(blip);

  const blipNotes = ['G5','E6','C6','A5'];
  let blipIdx = 0;
  const blipLoop = new Tone.Loop(time => {
    blip.triggerAttackRelease(blipNotes[blipIdx % blipNotes.length], '32n', time);
    blipIdx++;
  }, '2n');
  blipLoop.start('4n');
  blipLoop.probability = 0.5;
  cineMusicNodes.push(blipLoop);

  // Soft bass bounce
  const bass = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.4 },
    volume: -20
  }).toDestination();
  cineMusicNodes.push(bass);

  const bassNotes = ['C2','C2','F2','G2'];
  let bassIdx = 0;
  const bassLoop = new Tone.Loop(time => {
    bass.triggerAttackRelease(bassNotes[bassIdx % bassNotes.length], '8n', time);
    bassIdx++;
  }, '2n');
  bassLoop.start(0);
  cineMusicNodes.push(bassLoop);
}

function buildActionMusic() {
  // Driving bass
  const bass = new Tone.Synth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.01, decay: 0.15, sustain: 0.3, release: 0.2 },
    volume: -16
  }).toDestination();
  const bassFilter = new Tone.Filter(200, 'lowpass').toDestination();
  bass.connect(bassFilter);
  cineMusicNodes.push(bass, bassFilter);

  const bassPattern = ['E2','E2','E2','G2','E2','E2','A2','B2'];
  let bassIdx = 0;
  const bassLoop = new Tone.Loop(time => {
    bass.triggerAttackRelease(bassPattern[bassIdx % bassPattern.length], '16n', time);
    bassIdx++;
  }, '8n');
  bassLoop.start(0);
  cineMusicNodes.push(bassLoop);

  // Kick-like thump
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 },
    volume: -12
  }).toDestination();
  cineMusicNodes.push(kick);

  const kickLoop = new Tone.Loop(time => {
    kick.triggerAttackRelease('C1', '8n', time);
  }, '4n');
  kickLoop.start(0);
  cineMusicNodes.push(kickLoop);

  // Hi-hat noise
  const hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 },
    volume: -24
  }).toDestination();
  cineMusicNodes.push(hat);

  const hatLoop = new Tone.Loop(time => {
    hat.triggerAttackRelease('32n', time);
  }, '8n');
  hatLoop.start(0);
  cineMusicNodes.push(hatLoop);

  // Stab chord hits
  const stab = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'square' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.3 },
    volume: -22
  }).toDestination();
  cineMusicNodes.push(stab);

  const stabChords = [['E3','B3','E4'], ['A3','C4','E4']];
  let stabIdx = 0;
  const stabLoop = new Tone.Loop(time => {
    stab.triggerAttackRelease(stabChords[stabIdx % stabChords.length], '8n', time);
    stabIdx++;
  }, '1m');
  stabLoop.start('2n');
  cineMusicNodes.push(stabLoop);
}

function buildScriptFullText() {
  const parts = [];
  parts.push(currentScript.title || 'Untitled script');
  parts.push('='.repeat((currentScript.title || 'Untitled script').length));
  parts.push('');
  if (currentScript.hook) {
    parts.push('HOOK: ' + currentScript.hook);
    parts.push('');
  }
  currentScript.items.forEach(i => {
    if (i.type === 'section') {
      parts.push('');
      parts.push('— ' + (i.text || 'Section') + ' —');
      parts.push('');
    } else {
      if (i.title) parts.push('[' + i.title + ']');
      if (i.body) parts.push(i.body);
      parts.push('');
    }
  });
  return parts.join('\n').trim();
}

function copyToClipboard(text) {
  try {
    navigator.clipboard.writeText(text);
    if (typeof showDashToast === 'function') showDashToast('success', 'Copied to clipboard');
  } catch (e) {
    console.warn('clipboard', e);
  }
}


// =============================================================================
// ACTION REGISTRATIONS - wired up below as part of Phase 2
// =============================================================================

// Paywall (markup) - startCheckout defined in dashboard.html
scriptsRegisterAction('start-checkout', (e, el) => goToPricing(el.dataset.scriptsPlan === 'max' ? 'max' : 'pro'));

// Scripts list (markup)
scriptsRegisterAction('create-new', () => createNewScript());

// Script card actions (template literal)
scriptsRegisterAction('open-editor', (e, el) => openScriptEditor(el.dataset.scriptsScriptId));
scriptsRegisterAction('delete-script', (e, el) => deleteScript(el.dataset.scriptsScriptId));
scriptsRegisterAction('duplicate-script', (e, el) => duplicateScript(el.dataset.scriptsScriptId));

// Editor top bar
scriptsRegisterAction('exit-editor', () => exitScriptEditor());
scriptsRegisterAction('save-now', () => saveScriptNow());
scriptsRegisterAction('set-view', (e, el) => setScriptView(el.dataset.scriptsView));
scriptsRegisterAction('open-teleprompter', () => openTeleprompter());
scriptsRegisterAction('open-cinematic', () => openCinematic());
scriptsRegisterAction('toggle-export-menu', () => toggleScriptsExportMenu());
scriptsRegisterAction('export-copy-all', () => exportScriptCopyAll());
scriptsRegisterAction('export-copy-spoken', () => exportScriptCopySpoken());
scriptsRegisterAction('export-download-txt', () => exportScriptDownloadTxt());
scriptsRegisterAction('export-pdf', () => exportScriptPDF());

// Script meta inputs
scriptsRegisterAction('title-change', (e, el) => onScriptTitleChange(el.value));
scriptsRegisterAction('hook-change', (e, el) => onScriptHookChange(el.value));
scriptsRegisterAction('platform-change', (e, el) => onScriptPlatformChange(el.value));

// Items / sections / blocks (template literal - uses data-scripts-item-id)
scriptsRegisterAction('add-section', () => addScriptSection());
scriptsRegisterAction('add-block', () => addScriptBlock());
scriptsRegisterAction('remove-item', (e, el) => removeScriptItem(el.dataset.scriptsItemId));
scriptsRegisterAction('section-edit', (e, el) => onScriptSectionEdit(el.dataset.scriptsItemId, el.value));
scriptsRegisterAction('block-edit-title', (e, el) => onScriptBlockEdit(el.dataset.scriptsItemId, 'title', el.value));
scriptsRegisterAction('block-edit-body', (e, el) => onScriptBlockEdit(el.dataset.scriptsItemId, 'body', el.value));
scriptsRegisterAction('collapse-block', (e, el) => collapseScriptBlock(el.dataset.scriptsItemId));
scriptsRegisterAction('expand-block', (e, el) => expandScriptBlock(el.dataset.scriptsItemId));
scriptsRegisterAction('save-collapse-block', (e, el) => saveAndCollapseBlock(el.dataset.scriptsItemId));

// Storyboard view click → jump to block
scriptsRegisterAction('jump-to-block', (e, el) => jumpToBlockInScript(el.dataset.scriptsItemId));

// Hook (collapse / edit)
scriptsRegisterAction('edit-hook', () => editHook());
scriptsRegisterAction('save-collapse-hook', () => saveAndCollapseHook());

// Keydown patterns
scriptsRegisterAction('enter-blur', (e, el) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    el.blur();
  }
});
scriptsRegisterAction('cmd-enter-save-hook', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveAndCollapseHook();
  }
});
scriptsRegisterAction('cmd-enter-save-block', (e, el) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveAndCollapseBlock(el.dataset.scriptsItemId);
  }
});

// Onfocus
scriptsRegisterAction('select-all', (e, el) => el.select());

// AI Hook modal
scriptsRegisterAction('ai-hook', () => dsAIHook());
scriptsRegisterAction('generate-hooks', () => generateHooks());
scriptsRegisterAction('apply-hook', (e, el) => applyHook(parseInt(el.dataset.scriptsIdx, 10)));
scriptsRegisterAction('report-hook', (e, el) => {
  var idx = parseInt(el.dataset.scriptsIdx, 10);
  var text = document.getElementById('script-hook-option-' + idx)?.textContent;
  ryxaReportAIOutput('script-builder', text);
});
scriptsRegisterAction('close-hook-modal', () => {
  var m = document.getElementById('script-ai-hook-modal');
  if (m) m.remove();
});

// AI Assist modal (per-block)
scriptsRegisterAction('ai-assist', (e, el) => dsAIAssist(el.dataset.scriptsItemId));
scriptsRegisterAction('run-ai-assist', (e, el) => {
  runAIAssist(el.dataset.scriptsBlockId, el.dataset.scriptsMode);
});
scriptsRegisterAction('apply-ai-assist', (e, el) => applyAIAssist(el.dataset.scriptsBlockId));
scriptsRegisterAction('report-ai-result', () => {
  var text = document.getElementById('script-ai-result')?.textContent;
  ryxaReportAIOutput('script-builder', text);
});
scriptsRegisterAction('close-assist-modal', () => {
  var m = document.getElementById('script-ai-assist-modal');
  if (m) m.remove();
});

// Teleprompter controls
scriptsRegisterAction('close-teleprompter', () => closeTeleprompter());
scriptsRegisterAction('tp-toggle-play', () => tpTogglePlay());
scriptsRegisterAction('tp-restart', () => tpRestart());
scriptsRegisterAction('tp-toggle-voice', () => tpToggleVoice());
scriptsRegisterAction('tp-speed', (e, el) => tpAdjustSpeed(parseFloat(el.dataset.scriptsDelta)));
scriptsRegisterAction('tp-font', (e, el) => tpAdjustFontSize(parseFloat(el.dataset.scriptsDelta)));
scriptsRegisterAction('tp-voice-speed', (e, el) => tpAdjustVoiceSpeed(parseFloat(el.dataset.scriptsDelta)));

// Cinematic mode controls
scriptsRegisterAction('close-cinematic', () => closeCinematic());
scriptsRegisterAction('cine-next', (e) => { e.stopPropagation(); cineNextCard(); });
scriptsRegisterAction('cine-prev', (e) => { e.stopPropagation(); cinePrevCard(); });
scriptsRegisterAction('cine-toggle-play', (e) => { e.stopPropagation(); cineTogglePlay(); });
scriptsRegisterAction('cine-mood', (e, el) => {
  e.stopPropagation();
  setCineMood(el.dataset.scriptsMood);
});
scriptsRegisterAction('noop-stop-propagation', (e) => { e.stopPropagation(); });

