/* ─────────────────────────────────────────────
   Focus App — Pomodoro + Planner
   Vanilla JS, no dependencies
───────────────────────────────────────────── */

// ── Touch-to-drag polyfill ──────────────────────
(function () {
  let dragEl = null, lastTarget = null, clone = null, offsetX = 0, offsetY = 0;

  function copyDragData(src, dst) {
    const store = {};
    dst.dataTransfer = {
      _data: store,
      effectAllowed: 'move',
      dropEffect: 'move',
      setData(k, v) { store[k] = v; },
      getData(k) { return store[k] || ''; },
      setDragImage() {},
    };
    if (src._dragData) Object.assign(store, src._dragData);
  }

  function fire(type, target, touch, extra) {
    const rect = target.getBoundingClientRect();
    const ev = new MouseEvent(type, {
      bubbles: true, cancelable: true,
      clientX: touch.clientX, clientY: touch.clientY,
      screenX: touch.screenX, screenY: touch.screenY,
    });
    copyDragData(dragEl || {}, ev);
    if (extra) Object.assign(ev, extra);
    target.dispatchEvent(ev);
    return ev;
  }

  document.addEventListener('touchstart', e => {
    const el = e.target.closest('[draggable="true"]');
    if (!el) return;
    const touch = e.touches[0];
    const rect = el.getBoundingClientRect();
    offsetX = touch.clientX - rect.left;
    offsetY = touch.clientY - rect.top;
    dragEl = el;
    dragEl._dragData = {};

    const ev = new Event('dragstart', { bubbles: true, cancelable: true });
    copyDragData({}, ev);
    dragEl.dispatchEvent(ev);
    dragEl._dragData = ev.dataTransfer._data;

    // visual clone
    clone = el.cloneNode(true);
    clone.style.cssText = `
      position:fixed; pointer-events:none; z-index:9999; opacity:.8;
      width:${rect.width}px; left:${touch.clientX - offsetX}px; top:${touch.clientY - offsetY}px;
      margin:0; transform:scale(1.03); box-shadow:0 8px 24px rgba(0,0,0,.18);
      transition:none;
    `;
    document.body.appendChild(clone);
    el.classList.add('dragging');
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!dragEl) return;
    e.preventDefault();
    const touch = e.touches[0];
    clone.style.left = (touch.clientX - offsetX) + 'px';
    clone.style.top  = (touch.clientY - offsetY) + 'px';

    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!target) return;

    if (lastTarget && lastTarget !== target) {
      const ev = new Event('dragleave', { bubbles: true });
      copyDragData(dragEl, ev);
      lastTarget.dispatchEvent(ev);
    }
    const ov = new Event('dragover', { bubbles: true, cancelable: true });
    ov.clientX = touch.clientX; ov.clientY = touch.clientY;
    ov.dataTransfer = dragEl._dt || { getData: k => dragEl._dragData?.[k] || '', setData(){}, effectAllowed:'move', dropEffect:'move' };
    ov.preventDefault = () => {};
    target.dispatchEvent(ov);
    lastTarget = target;
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (!dragEl) return;
    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);

    if (target) {
      const drop = new Event('drop', { bubbles: true, cancelable: true });
      drop.clientX = touch.clientX; drop.clientY = touch.clientY;
      drop.dataTransfer = { getData: k => dragEl._dragData?.[k] || '', setData(){}, effectAllowed:'move', dropEffect:'move' };
      drop.preventDefault = () => {};
      target.dispatchEvent(drop);
    }

    const end = new Event('dragend', { bubbles: true });
    dragEl.dispatchEvent(end);
    dragEl.classList.remove('dragging');
    clone?.remove();
    clone = null; dragEl = null; lastTarget = null;
  }, { passive: true });
})();

// ── State ──────────────────────────────────────
const DEFAULT_TAB_ORDER = ['free', 'timer', 'planner', 'stats', 'calendar', 'spotify'];
const DEFAULT_PREFS = {
  appName: 'Focus',
  subtitleMode: 'clock',
  appSubtitle: '',
  theme: 'aurora',
  accent: '#3a6cff',
  showOrbs: true,
  compact: false,
  soundEnabled: true,
  defaultTab: 'timer',
  hiddenTabs: [],
  tabOrder: DEFAULT_TAB_ORDER.slice(),
};

let state = {
  // Timer
  mode: 'pomodoro',            // pomodoro | short | long
  running: false,
  timeLeft: 25 * 60,
  totalTime: 25 * 60,
  freeTask: false,
  sessionsCompleted: 0,
  durations: { pomodoro: 25, short: 5, long: 15, sessions: 4, pomBadge: 30 },
  activeTaskId: null,
  activeSubjectId: null,

  // Planner
  subjects: [],                // { id, name, color, emoji }
  tasks: [],                   // { id, subjectId, name, pomodoros, donePomodoros, priority, done }

  // Stats
  log: [],                     // { ts, subjectId, subjectName, taskId, taskName, minutes }
  todayPomodoros: 0,
  totalMinutes: 0,

  // Preferences
  prefs: {
    appName: 'Focus',
    subtitleMode: 'clock',     // clock | custom
    appSubtitle: '',
    theme: 'aurora',
    accent: '#3a6cff',
    showOrbs: true,
    compact: false,
    soundEnabled: true,
    defaultTab: 'timer',
    hiddenTabs: [],
    tabOrder: DEFAULT_TAB_ORDER.slice(),
  },
};

let timerInterval = null;
let timerStartedAt = null;   // Date.now() when timer last started
let timerBaseLeft  = null;   // timeLeft value when timer last started
let currentSubjectId = null;  // for task modal
let taskPomodoroCount = 2;
let taskPriority = 'medium';
let editingTaskId = null;
let editingSubjectId = null;
let taskFilter = 'all'; // 'all' | 'today' (linked to calendar)
let dragSrcTaskId = null;
let dragSrcTab = null;

const COLORS = [
  '#FF3B30','#FF9500','#FFCC00','#34C759',
  '#5AC8FA','#007AFF','#5856D6','#AF52DE',
  '#FF2D55','#00C7BE','#30B0C7','#32ADE6',
];
let selectedColor = COLORS[5]; // blue default
const THEME_PRESETS = {
  aurora: {
    pageBg: '#edf0f3',
    pageBgAlt: '#f7f9fc',
    orb1: 'rgba(100,130,255,.06)',
    orb2: 'rgba(180,140,255,.05)',
    orb3: 'rgba(80,200,200,.04)',
    glass: 'rgba(255,255,255,.72)',
    glassBorder: 'rgba(255,255,255,.58)',
    text: '#111111',
    text2: '#5a5a5a',
    text3: '#8d8d8d',
  },
  paper: {
    pageBg: '#f4efe7',
    pageBgAlt: '#fffaf2',
    orb1: 'rgba(255,181,112,.07)',
    orb2: 'rgba(255,120,144,.05)',
    orb3: 'rgba(110,154,255,.04)',
    glass: 'rgba(255,250,244,.76)',
    glassBorder: 'rgba(255,255,255,.52)',
    text: '#1b1612',
    text2: '#6b5c54',
    text3: '#9f8f84',
  },
  sunrise: {
    pageBg: '#f1e8db',
    pageBgAlt: '#fff5e6',
    orb1: 'rgba(255,167,87,.08)',
    orb2: 'rgba(255,116,116,.06)',
    orb3: 'rgba(255,210,120,.05)',
    glass: 'rgba(255,248,239,.78)',
    glassBorder: 'rgba(255,255,255,.5)',
    text: '#20170f',
    text2: '#6d594b',
    text3: '#a28c78',
  },
  graphite: {
    pageBg: '#191b20',
    pageBgAlt: '#22262d',
    orb1: 'rgba(74,111,255,.08)',
    orb2: 'rgba(153,89,255,.06)',
    orb3: 'rgba(0,195,175,.05)',
    glass: 'rgba(35,39,46,.74)',
    glassBorder: 'rgba(255,255,255,.08)',
    text: '#f3f4f8',
    text2: '#b7bdca',
    text3: '#7f8798',
  },
};
const ACCENT_SWATCHES = ['#3a6cff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#111827'];

// ── Persist ────────────────────────────────────
function save() {
  localStorage.setItem('focus_state', JSON.stringify(state));
}
function load() {
  const raw = localStorage.getItem('focus_state');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    // Merge only non-timer state
    state.durations    = Object.assign({}, state.durations, s.durations || {});
    state.subjects     = s.subjects     || [];
    state.tasks        = s.tasks        || [];
    state.log          = s.log          || [];
    state.todayPomodoros = s.todayPomodoros || 0;
    state.totalMinutes = s.totalMinutes || 0;
    state.sessionsCompleted = s.sessionsCompleted || 0;
    state.prefs = normalizePrefs(s.prefs || {});
    state.tabOrder = normalizeTabOrder(Array.isArray(s.tabOrder) ? s.tabOrder : state.prefs.tabOrder || []);
    state.freeTask = false;
    // Reset timer to current mode duration on load
    state.timeLeft  = state.durations[state.mode] * 60;
    state.totalTime = state.timeLeft;
  } catch(e) { /* ignore corrupt data */ }
}

function normalizePrefs(input = {}) {
  const prefs = {
    ...DEFAULT_PREFS,
    ...input,
  };
  prefs.theme = THEME_PRESETS[prefs.theme] ? prefs.theme : DEFAULT_PREFS.theme;
  prefs.accent = normalizeHexColor(prefs.accent, DEFAULT_PREFS.accent);
  prefs.showOrbs = input.showOrbs !== false;
  prefs.compact = !!input.compact;
  prefs.soundEnabled = input.soundEnabled !== false;
  prefs.defaultTab = DEFAULT_TAB_ORDER.includes(prefs.defaultTab) ? prefs.defaultTab : DEFAULT_PREFS.defaultTab;
  prefs.hiddenTabs = Array.isArray(input.hiddenTabs)
    ? input.hiddenTabs.filter(tab => DEFAULT_TAB_ORDER.includes(tab) && tab !== 'timer' && tab !== prefs.defaultTab)
    : [];
  prefs.tabOrder = normalizeTabOrder(Array.isArray(input.tabOrder) ? input.tabOrder : DEFAULT_TAB_ORDER);
  prefs.subtitleMode = input.subtitleMode === 'custom' ? 'custom' : 'clock';
  prefs.appSubtitle = typeof input.appSubtitle === 'string' ? input.appSubtitle : '';
  prefs.appName = typeof input.appName === 'string' && input.appName.trim() ? input.appName.trim() : DEFAULT_PREFS.appName;
  return prefs;
}

function normalizeHexColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : fallback;
}

function hexToRgb(hex) {
  const clean = normalizeHexColor(hex, DEFAULT_PREFS.accent).replace('#', '');
  const expanded = clean.length === 3 ? clean.split('').map(ch => ch + ch).join('') : clean;
  const int = parseInt(expanded, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function rgbaFromHex(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function formatHeaderSubtitle(date = new Date()) {
  const day = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time}`;
}

function applyThemeVars() {
  const prefs = state.prefs || DEFAULT_PREFS;
  const theme = THEME_PRESETS[prefs.theme] || THEME_PRESETS[DEFAULT_PREFS.theme];
  const root = document.documentElement;
  const accent = normalizeHexColor(prefs.accent, DEFAULT_PREFS.accent);
  const { r, g, b } = hexToRgb(accent);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  root.style.setProperty('--accent-soft', rgbaFromHex(accent, '.14'));
  root.style.setProperty('--accent-soft-2', rgbaFromHex(accent, '.08'));
  root.style.setProperty('--accent-strong', rgbaFromHex(accent, '.9'));
  root.style.setProperty('--page-bg', theme.pageBg);
  root.style.setProperty('--page-bg-alt', theme.pageBgAlt);
  root.style.setProperty('--orb-1', theme.orb1);
  root.style.setProperty('--orb-2', theme.orb2);
  root.style.setProperty('--orb-3', theme.orb3);
  root.style.setProperty('--glass-bg', theme.glass);
  root.style.setProperty('--glass-border', theme.glassBorder);
  root.style.setProperty('--ui-text', theme.text);
  root.style.setProperty('--ui-text-2', theme.text2);
  root.style.setProperty('--ui-text-3', theme.text3);
  root.style.setProperty('--text', theme.text);
  root.style.setProperty('--text2', theme.text2);
  root.style.setProperty('--text3', theme.text3);
  root.style.setProperty('--glass', theme.glass);
  root.style.setProperty('--glass-border', theme.glassBorder);
  document.body.dataset.theme = prefs.theme;
  document.body.dataset.compact = prefs.compact ? '1' : '0';
  document.body.classList.toggle('hide-orbs', !prefs.showOrbs);
  document.body.classList.toggle('compact-ui', !!prefs.compact);
  document.title = `${prefs.appName} — Pomodoro & Planner`;
}

function syncPreferenceUI() {
  const prefs = state.prefs || DEFAULT_PREFS;
  const titleEl = document.getElementById('appTitle');
  const subtitleEl = document.getElementById('appSubtitle');
  const nameInput = document.getElementById('appNameInput');
  const subtitleInput = document.getElementById('appSubtitleInput');
  const themeChoices = document.querySelectorAll('#themeChoices .settings-choice');
  const accentInput = document.getElementById('accentInput');
  const showOrbsToggle = document.getElementById('showOrbsToggle');
  const compactToggle = document.getElementById('compactToggle');
  const soundToggle = document.getElementById('soundToggle');
  const defaultTabSelect = document.getElementById('defaultTabSelect');

  if (titleEl) titleEl.textContent = prefs.appName;
  if (subtitleEl) subtitleEl.textContent = prefs.subtitleMode === 'custom' && prefs.appSubtitle.trim()
    ? prefs.appSubtitle.trim()
    : formatHeaderSubtitle();
  if (nameInput && nameInput.value !== prefs.appName) nameInput.value = prefs.appName;
  if (subtitleInput) {
    const desired = prefs.subtitleMode === 'custom' ? prefs.appSubtitle : '';
    if (subtitleInput.value !== desired) subtitleInput.value = desired;
  }
  if (accentInput && accentInput.value.toLowerCase() !== normalizeHexColor(prefs.accent, DEFAULT_PREFS.accent).toLowerCase()) {
    accentInput.value = normalizeHexColor(prefs.accent, DEFAULT_PREFS.accent);
  }
  if (showOrbsToggle) showOrbsToggle.checked = prefs.showOrbs;
  if (compactToggle) compactToggle.checked = prefs.compact;
  if (soundToggle) soundToggle.checked = prefs.soundEnabled;
  if (defaultTabSelect && defaultTabSelect.value !== prefs.defaultTab) defaultTabSelect.value = prefs.defaultTab;
  themeChoices.forEach(btn => btn.classList.toggle('active', btn.dataset.theme === prefs.theme));
  renderAccentSwatches();

  const chips = document.querySelectorAll('.tab[data-tab]');
  chips.forEach(tab => {
    const hidden = prefs.hiddenTabs.includes(tab.dataset.tab) && tab.dataset.tab !== prefs.defaultTab;
    tab.classList.toggle('is-hidden', hidden);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    const name = content.id.replace('tab-', '');
    content.dataset.hidden = prefs.hiddenTabs.includes(name) && name !== prefs.defaultTab ? '1' : '0';
  });
  renderTabOrderPreview();
}

function applyPreferences() {
  applyThemeVars();
  syncPreferenceUI();
  applyTabVisibility();
  applyTabOrder();
}

function applyTabVisibility() {
  const prefs = state.prefs || DEFAULT_PREFS;
  const visibleTabs = DEFAULT_TAB_ORDER.filter(tab => tab === 'free' || !prefs.hiddenTabs.includes(tab));
  document.querySelectorAll('.tab[data-tab]').forEach(tab => {
    const shouldShow = tab.dataset.tab === 'free' || !prefs.hiddenTabs.includes(tab.dataset.tab);
    tab.style.display = shouldShow ? '' : 'none';
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    const tabName = content.id.replace('tab-', '');
    const shouldShow = !prefs.hiddenTabs.includes(tabName);
    content.style.display = shouldShow ? '' : 'none';
  });

  const activeVisible = document.querySelector('.tab-content.active:not([style*="display: none"])');
  if (!activeVisible) {
    const fallback = prefs.defaultTab && !prefs.hiddenTabs.includes(prefs.defaultTab)
      ? prefs.defaultTab
      : visibleTabs.find(tab => tab !== 'free' && tab !== 'timer') || 'timer';
    switchTab(fallback);
  }
}

function renderTabOrderPreview() {
  const wrap = document.getElementById('tabOrderPreview');
  if (!wrap) return;
  const prefs = state.prefs || DEFAULT_PREFS;
  const labels = {
    timer: 'Timer',
    planner: 'Planner',
    stats: 'Résumé',
    calendar: 'Calendrier',
    spotify: 'Spotify',
  };
  wrap.innerHTML = getTabOrder()
    .filter(tab => tab !== 'free')
    .map(tab => {
      const hidden = prefs.hiddenTabs.includes(tab);
      return `<span class="settings-order-pill${hidden ? ' muted' : ''}">${labels[tab] || tab}</span>`;
    })
    .join('');
}

function renderAccentSwatches() {
  const wrap = document.getElementById('accentSwatches');
  if (!wrap) return;
  const current = normalizeHexColor(state.prefs?.accent || DEFAULT_PREFS.accent, DEFAULT_PREFS.accent).toLowerCase();
  wrap.innerHTML = ACCENT_SWATCHES.map(color => {
    const selected = color.toLowerCase() === current ? ' active' : '';
    return `<button type="button" class="accent-swatch${selected}" style="background:${color}" title="${color}" onclick="setAccent('${color}')"></button>`;
  }).join('');
}

function openSettingsModal() {
  syncPreferenceUI();
  openModal('settingsModal');
}

function setAppIdentity() {
  const nameInput = document.getElementById('appNameInput');
  const subtitleInput = document.getElementById('appSubtitleInput');
  const name = nameInput ? nameInput.value.trim() : '';
  const subtitle = subtitleInput ? subtitleInput.value.trim() : '';
  state.prefs.appName = name || DEFAULT_PREFS.appName;
  state.prefs.subtitleMode = subtitle ? 'custom' : 'clock';
  state.prefs.appSubtitle = subtitle;
  applyPreferences();
  save();
}

function setThemePreset(theme) {
  if (!THEME_PRESETS[theme]) return;
  state.prefs.theme = theme;
  applyPreferences();
  save();
}

function setAccent(value) {
  state.prefs.accent = normalizeHexColor(value, DEFAULT_PREFS.accent);
  applyPreferences();
  save();
}

function setShowOrbs(checked) {
  state.prefs.showOrbs = !!checked;
  applyPreferences();
  save();
}

function setCompactMode(checked) {
  state.prefs.compact = !!checked;
  applyPreferences();
  save();
}

function setSoundEnabled(checked) {
  state.prefs.soundEnabled = !!checked;
  save();
}

function setDefaultTab(tab) {
  if (!DEFAULT_TAB_ORDER.includes(tab)) return;
  state.prefs.defaultTab = tab;
  if (state.prefs.hiddenTabs.includes(tab)) {
    state.prefs.hiddenTabs = state.prefs.hiddenTabs.filter(item => item !== tab);
  }
  applyPreferences();
  save();
}

function setTabVisible(tab, visible) {
  if (!DEFAULT_TAB_ORDER.includes(tab) || tab === 'timer') return;
  const hidden = new Set(state.prefs.hiddenTabs);
  if (visible) {
    hidden.delete(tab);
  } else {
    hidden.add(tab);
  }
  state.prefs.hiddenTabs = Array.from(hidden);
  applyPreferences();
  save();
}

function resetCustomization() {
  state.prefs = normalizePrefs(DEFAULT_PREFS);
  state.tabOrder = DEFAULT_TAB_ORDER.slice();
  applyPreferences();
  save();
  showToast('Personnalisation réinitialisée');
}

async function exportCustomization() {
  const payload = JSON.stringify(state.prefs, null, 2);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(payload);
    showToast('Réglages copiés');
    return;
  }
  window.prompt('Copie les réglages', payload);
}

function importCustomization() {
  const raw = window.prompt('Colle ici les réglages JSON');
  if (!raw) return;
  try {
    state.prefs = normalizePrefs(JSON.parse(raw));
    state.tabOrder = normalizeTabOrder(state.prefs.tabOrder || DEFAULT_TAB_ORDER);
    applyPreferences();
    save();
    showToast('Réglages importés');
  } catch (error) {
    showToast('JSON invalide');
  }
}

// ── Status Bar Clock ───────────────────────────
function updateClock() {
  const subtitleEl = document.getElementById('appSubtitle');
  if (!subtitleEl) return;
  const prefs = state.prefs || DEFAULT_PREFS;
  if (prefs.subtitleMode === 'custom' && prefs.appSubtitle.trim()) {
    subtitleEl.textContent = prefs.appSubtitle.trim();
    return;
  }
  subtitleEl.textContent = formatHeaderSubtitle();
}

// ── Tab Navigation ─────────────────────────────
function switchTab(name) {
  const prefs = state.prefs || DEFAULT_PREFS;
  if (prefs.hiddenTabs.includes(name)) return;
  document.querySelectorAll('.tab:not(.tab-free)').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));
  if (name === 'stats') renderStats();
  if (name === 'planner') renderSubjects();
  if (name === 'calendar') renderCalendar();
}

function normalizeTabOrder(order) {
  const desired = DEFAULT_TAB_ORDER.slice();
  const filtered = Array.isArray(order) ? order.filter(tab => desired.includes(tab)) : [];
  const merged = [];
  filtered.forEach(tab => {
    if (!merged.includes(tab)) merged.push(tab);
  });
  desired.forEach(tab => {
    if (!merged.includes(tab)) merged.push(tab);
  });
  return merged;
}

function getTabOrder() {
  return normalizeTabOrder(state.tabOrder);
}

function applyTabOrder() {
  const tabBar = document.getElementById('tabBar');
  if (!tabBar) return;

  const tabs = Array.from(tabBar.querySelectorAll('.tab'));
  const order = getTabOrder();
  const tabByName = new Map(tabs.map(tab => [tab.dataset.tab, tab]));

  order.forEach(tabName => {
    const tab = tabByName.get(tabName);
    if (tab) tabBar.appendChild(tab);
  });

  tabs.filter(tab => !order.includes(tab.dataset.tab)).forEach(tab => tabBar.appendChild(tab));
}

function bindTabDragAndDrop() {
  const tabBar = document.getElementById('tabBar');
  if (!tabBar) return;

  tabBar.querySelectorAll('.tab').forEach(tab => {
    if (tab.dataset.dndBound === '1') return;
    tab.dataset.dndBound = '1';
    tab.draggable = true;
    tab.addEventListener('dragstart', handleTabDragStart);
    tab.addEventListener('dragend', handleTabDragEnd);
    tab.addEventListener('dragover', handleTabDragOver);
    tab.addEventListener('drop', handleTabDrop);
  });
}

function clearTabDropIndicators() {
  document.querySelectorAll('.tab.drop-before, .tab.drop-after').forEach(tab => {
    tab.classList.remove('drop-before', 'drop-after');
  });
}

function handleTabDragStart(e) {
  dragSrcTab = e.currentTarget;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', e.currentTarget.dataset.tab);
  e.currentTarget.classList.add('dragging');
}

function handleTabDragEnd(e) {
  dragSrcTab = null;
  clearTabDropIndicators();
  e.currentTarget.classList.remove('dragging');
}

function handleTabDragOver(e) {
  if (!dragSrcTab || e.currentTarget === dragSrcTab) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.currentTarget;
  const rect = target.getBoundingClientRect();
  const before = e.clientX < rect.left + rect.width / 2;
  clearTabDropIndicators();
  target.classList.add(before ? 'drop-before' : 'drop-after');
}

function handleTabDrop(e) {
  if (!dragSrcTab) return;
  e.preventDefault();
  const tabBar = document.getElementById('tabBar');
  const target = e.currentTarget;
  if (!tabBar || target === dragSrcTab) return;

  const tabs = Array.from(tabBar.querySelectorAll('.tab'));
  const currentOrder = tabs.map(tab => tab.dataset.tab);
  const dragIndex = currentOrder.indexOf(dragSrcTab.dataset.tab);
  const targetIndex = currentOrder.indexOf(target.dataset.tab);
  if (dragIndex === -1 || targetIndex === -1) return;

  const rect = target.getBoundingClientRect();
  const insertAfter = e.clientX >= rect.left + rect.width / 2;
  const nextOrder = currentOrder.slice();
  const [draggedTab] = nextOrder.splice(dragIndex, 1);
  const insertIndex = targetIndex + (insertAfter ? 1 : 0) - (dragIndex < targetIndex ? 1 : 0);
  nextOrder.splice(Math.max(0, Math.min(insertIndex, nextOrder.length)), 0, draggedTab);

  state.tabOrder = normalizeTabOrder(nextOrder);
  state.prefs.tabOrder = state.tabOrder.slice();
  applyTabOrder();
  persistTabOrder();
  clearTabDropIndicators();
}

function persistTabOrder() {
  state.prefs.tabOrder = state.tabOrder ? state.tabOrder.slice() : DEFAULT_TAB_ORDER.slice();
  save();
}

function activatePomBadge() {
  if (state.running) return;
  // Swap pomodoro duration and badge value
  const oldPomodoro = state.durations.pomodoro;
  const oldBadge    = state.durations.pomBadge;
  state.durations.pomodoro = oldBadge;
  state.durations.pomBadge = oldPomodoro;

  // Update all displays
  const pomCard = document.getElementById('durCard-pomodoro');
  if (pomCard) pomCard.textContent = state.durations.pomodoro;
  const pomEl = document.getElementById('dur-pomodoro');
  if (pomEl) pomEl.textContent = state.durations.pomodoro;
  const badgeCard = document.getElementById('durCard-pomBadge');
  if (badgeCard) badgeCard.textContent = state.durations.pomBadge;
  const badgeEl = document.getElementById('dur-pomBadge');
  if (badgeEl) badgeEl.textContent = state.durations.pomBadge;

  state.freeTask = false;
  state.mode = 'pomodoro';
  state.timeLeft  = state.durations.pomodoro * 60;
  state.totalTime = state.timeLeft;
  document.querySelectorAll('.mode-card').forEach(s => s.classList.toggle('active', s.dataset.mode === 'pomodoro'));
  document.body.dataset.mode = 'pomodoro';
  document.getElementById('timerModeLabel').textContent = 'Pomodoro';
  renderTimer();
  save();
}

// ── Timer ──────────────────────────────────────
function setMode(mode) {
  if (state.running) return; // prevent mode change while running
  state.freeTask = false;
  state.mode = mode;
  state.timeLeft = state.durations[mode] * 60;
  state.totalTime = state.timeLeft;

  document.querySelectorAll('.mode-card').forEach(s => s.classList.toggle('active', s.dataset.mode === mode));
  document.body.dataset.mode = mode;

  const labels = { pomodoro: 'Pomodoro', short: 'Pause courte', long: 'Pause longue' };
  document.getElementById('timerModeLabel').textContent = labels[mode];

  renderTimer();
}

function toggleTimer() {
  if (state.running) {
    pauseTimer();
  } else {
    startTimer();
  }
}

function scrollToTimer(delay = 80) {
  setTimeout(() => {
    const ring = document.getElementById('timerRingWrap');
    if (!ring) return;
    const target = ring.getBoundingClientRect().top + window.scrollY - (window.innerHeight / 2) + (ring.offsetHeight / 2);
    const start = window.scrollY;
    const distance = target - start;
    const duration = 700;
    let startTime = null;
    function easeIn(t) { return t * t * t; }
    function step(ts) {
      if (!startTime) startTime = ts;
      const elapsed = ts - startTime;
      const progress = Math.min(elapsed / duration, 1);
      window.scrollTo(0, start + distance * easeIn(progress));
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, delay);
}

function startTimer() {
  state.running = true;
  document.getElementById('playIcon').style.display  = 'none';
  document.getElementById('pauseIcon').style.display = '';
  const wrap = document.getElementById('timerRingWrap');
  wrap.classList.remove('ring-idle');
  wrap.classList.add('breathe');
  document.body.classList.add('is-running');
  document.body.classList.add('is-started');
  const dot = document.getElementById('activeTaskDot');
  if (dot && (state.activeTaskId || state.activeSubjectId) && !state.freeTask) {
    dot.classList.remove('running');
    void dot.offsetWidth;
    dot.classList.add('running');
  }
  timerStartedAt = Date.now();
  timerBaseLeft  = state.timeLeft;
  timerInterval = setInterval(tick, 500);
  scrollToTimer();
  const allPanel = document.getElementById('allTasksPanel');
  if (allPanel && allPanel.classList.contains('open')) {
    allPanel.classList.remove('open');
    const allBtn = document.querySelector('.subject-all-btn');
    if (allBtn) allBtn.textContent = 'Toutes ›';
  }
}

function pauseTimer() {
  syncTimerFromClock();
  state.running = false;
  document.getElementById('playIcon').style.display  = '';
  document.getElementById('pauseIcon').style.display = 'none';
  const wrap = document.getElementById('timerRingWrap');
  wrap.classList.add('ring-idle');
  wrap.classList.remove('breathe');
  document.body.classList.remove('is-running');
  const dot = document.getElementById('activeTaskDot');
  if (dot) dot.classList.remove('running');
  clearInterval(timerInterval);
  timerStartedAt = null;
}

function syncTimerFromClock() {
  if (!timerStartedAt) return;
  const elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
  if (state.freeTask) {
    state.timeLeft = timerBaseLeft + elapsed;
  } else {
    state.timeLeft = Math.max(0, timerBaseLeft - elapsed);
  }
}

function logFreeTaskSession() {
  if (!state.freeTask || state.timeLeft < 60) return;
  const mins = Math.round(state.timeLeft / 60);
  state.totalMinutes += mins;
  const entry = {
    ts: Date.now(),
    subjectId: state.activeSubjectId,
    subjectName: getSubjectName(state.activeSubjectId),
    taskId: null,
    taskName: 'Session libre',
    minutes: mins,
  };
  state.log.unshift(entry);
  if (state.log.length > 50) state.log.pop();
  save();
}

function resetTimer() {
  if (state.freeTask && state.running) logFreeTaskSession();
  pauseTimer();
  document.body.classList.remove('is-started');
  if (state.freeTask) {
    state.timeLeft = 0;
    state.totalTime = 0;
  } else {
    state.timeLeft  = state.durations[state.mode] * 60;
    state.totalTime = state.timeLeft;
  }
  renderTimer();
}

function skipTimer() {
  if (state.freeTask) {
    if (state.running) logFreeTaskSession();
    pauseTimer();
    state.timeLeft = 0;
    state.totalTime = 0;
    renderTimer();
    return;
  }
  pauseTimer();
  onTimerComplete(false);
}

function tick() {
  syncTimerFromClock();
  if (!state.freeTask && state.timeLeft <= 0) {
    onTimerComplete(true);
    return;
  }
  renderTimer();
}

function onTimerComplete(natural) {
  clearInterval(timerInterval);
  state.running = false;
  document.getElementById('playIcon').style.display  = '';
  document.getElementById('pauseIcon').style.display = 'none';
  document.body.classList.remove('is-running');
  document.body.classList.remove('is-started');
  const dot = document.getElementById('activeTaskDot');
  if (dot) dot.classList.remove('running');

  if (state.mode === 'pomodoro') {
    state.sessionsCompleted++;
    state.todayPomodoros++;
    const mins = state.durations.pomodoro;
    state.totalMinutes += mins;

    // Log the session
    const entry = {
      ts: Date.now(),
      subjectId: state.activeSubjectId,
      subjectName: getSubjectName(state.activeSubjectId),
      taskId: state.activeTaskId,
      taskName: getTaskName(state.activeTaskId),
      minutes: mins,
    };
    state.log.unshift(entry);
    if (state.log.length > 50) state.log.pop();

    // Increment task done pomodoros
    if (state.activeTaskId) {
      const t = state.tasks.find(t => t.id === state.activeTaskId);
      if (t) { t.donePomodoros = (t.donePomodoros || 0) + 1; }
    }

    if (natural) {
      playSound();
      showToast('🍅 Pomodoro terminé ! Prends une pause.');
    }

    // Auto-switch to break
    const isLong = state.sessionsCompleted % state.durations.sessions === 0;
    const nextMode = isLong ? 'long' : 'short';
    setTimeout(() => setMode(nextMode), 800);
  } else {
    if (natural) {
      playSound();
      showToast('⏰ Pause terminée ! Au travail.');
    }
    setTimeout(() => setMode('pomodoro'), 800);
  }

  renderSessionDots();
  save();
}

function renderTimer() {
  const display = formatStopwatch(state.timeLeft);
  document.getElementById('timerDisplay').textContent = display;

  // Ring r=130 → circumference = 2π×130 ≈ 816.8
  const circumference = 2 * Math.PI * 130;
  const progress = state.totalTime > 0 ? state.timeLeft / state.totalTime : 1;
  const offset = state.freeTask ? circumference : circumference * (1 - progress);
  const ring = document.getElementById('ringProgress');
  ring.style.strokeDasharray  = circumference;
  ring.style.strokeDashoffset = offset;
  ring.classList.toggle('running', state.running);
}

function renderSessionDots() {
  const container = document.getElementById('sessionDots');
  const total = state.durations.sessions;
  const done  = state.sessionsCompleted % total;
  container.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('div');
    d.className = 'session-dot' + (i < done ? ' done' : '');
    container.appendChild(d);
  }
}

// ── Duration Settings ──────────────────────────
function changeDuration(key, delta) {
  const limits = { pomodoro: [1, 60], short: [1, 30], long: [5, 60], sessions: [2, 8], pomBadge: [1, 120] };
  const [min, max] = limits[key];
  state.durations[key] = Math.min(max, Math.max(min, state.durations[key] + delta));
  const durEl = document.getElementById(`dur-${key}`);
  if (durEl) durEl.textContent = state.durations[key];
  const cardValue = document.getElementById(`durCard-${key}`);
  if (cardValue) cardValue.textContent = state.durations[key];
  // Update timer display if matching current mode
  if (state.freeTask) {
    save();
    return;
  }
  if (key === state.mode || (key !== 'sessions' && key === state.mode)) {
    if (!state.running) {
      state.timeLeft  = state.durations[state.mode] * 60;
      state.totalTime = state.timeLeft;
      renderTimer();
    }
  }
  if (key !== 'sessions' && key === state.mode && !state.running) {
    state.timeLeft = state.totalTime = state.durations[key] * 60;
    renderTimer();
  }
  renderSessionDots();
  save();
}

// ── Sound ──────────────────────────────────────
function playSound() {
  if (!(state.prefs?.soundEnabled ?? true)) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523, 659, 784]; // C E G
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      osc.start(t);
      osc.stop(t + 0.45);
    });
  } catch(e) { /* audio not available */ }
}

// ── Toast ──────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Active Task ────────────────────────────────
function setActiveTask(taskId, subjectId) {
  state.freeTask = false;
  if (state.running) pauseTimer();
  state.activeTaskId = taskId;
  state.activeSubjectId = subjectId || null;
  state.timeLeft  = state.durations[state.mode] * 60;
  state.totalTime = state.timeLeft;
  document.body.classList.remove('is-started');
  renderTimer();
  const task    = state.tasks.find(t => t.id === taskId);
  const subject = state.subjects.find(s => s.id === subjectId);
  if (!task) return;

  document.getElementById('bannerSubject').textContent = subject ? `${subject.emoji || ''} ${subject.name}`.trim() : 'Sans matière';
  document.getElementById('bannerTask').textContent    = task.name;
  document.getElementById('activeTaskBanner').style.display = 'flex';
  renderActiveTaskLinks(task);
  const dot = document.getElementById('activeTaskDot');
  if (dot) dot.classList.remove('running');

  updateFreeTaskActive();
  switchTab('timer');
  showToast(`Tâche active : ${task.name}`);
  save();
}

function clearActiveTask() {
  state.activeTaskId    = null;
  state.activeSubjectId = null;
  state.freeTask        = false;
  document.getElementById('activeTaskBanner').style.display = 'none';
  renderActiveTaskLinks(null);
  renderSubjectQuickSelect();
  updateFreeTaskActive();
  save();
}

function updateFreeTaskActive(triggerAnim = false) {
  const el = document.getElementById('freeTaskTab');
  if (!el) return;
  el.classList.remove('active');
  void el.offsetWidth;
  if (state.freeTask) el.classList.add('active');
}

function setFreeTask() {
  if (state.freeTask && state.running) {
    // Deuxième clic pendant que ça tourne : log + reset
    logFreeTaskSession();
    pauseTimer();
    state.freeTask = false;
    state.timeLeft = 0;
    state.totalTime = 0;
    document.body.classList.remove('is-started');
    updateFreeTaskActive();
    renderTimer();
    return;
  }
  pauseTimer();
  state.freeTask = true;
  state.activeTaskId = null;
  state.activeSubjectId = null;
  state.timeLeft = 0;
  state.totalTime = 0;
  document.getElementById('activeTaskBanner').style.display = 'none';
  renderActiveTaskLinks(null);
  renderFreeTaskSubtitle();
  renderSubjectQuickSelect();
  updateFreeTaskActive(true);
  renderTimer();
  switchTab('timer');
  showToast('Tâche libre activée');
  scrollToTimer();
  save();
  startTimer();
}

function renderAllTasksPanel() {
  const panel = document.getElementById('allTasksPanel');
  const inner = document.getElementById('allTasksInner');
  const btn   = document.querySelector('.subject-all-btn');
  if (!panel || !panel.classList.contains('open')) return;
  inner.innerHTML = '';
  state.subjects.forEach(s => {
    const tasks = state.tasks.filter(t => t.subjectId === s.id && !t.done);
    if (tasks.length === 0) return;
    const section = document.createElement('div');
    section.className = 'all-tasks-section';
    section.innerHTML = `<div class="all-tasks-subject"><span style="background:${s.color}" class="all-tasks-dot"></span>${esc(s.emoji ? s.emoji + ' ' : '')}${esc(s.name)}</div>`;
    tasks.forEach(t => {
      const row = document.createElement('div');
      row.className = 'all-tasks-row' + (state.activeTaskId === t.id ? ' active' : '');
      const pct = Math.min(100, t.pomodoros > 0 ? Math.round(t.donePomodoros / t.pomodoros * 100) : 0);
      row.innerHTML = `
        <span class="all-tasks-name">${esc(t.name)}</span>
        <span class="all-tasks-pom">
          <span class="all-tasks-bar"><span class="all-tasks-bar-fill" style="width:${pct}%"></span></span>
          <span class="all-tasks-pom-txt">${t.donePomodoros}/${t.pomodoros}</span>
        </span>`;
      row.onclick = () => { setActiveTask(t.id, s.id); panel.classList.remove('open'); if (btn) btn.textContent = 'Toutes ›'; };
      section.appendChild(row);
    });
    inner.appendChild(section);
  });
  // Section "Sans matière"
  const orphans = state.tasks.filter(t => !t.done && !state.subjects.find(s => s.id === t.subjectId));
  if (orphans.length > 0) {
    const section = document.createElement('div');
    section.className = 'all-tasks-section';
    const header = document.createElement('div');
    header.className = 'all-tasks-subject';
    header.style.cssText = 'cursor:pointer;user-select:none';
    header.innerHTML = `<span style="background:#8E8E93" class="all-tasks-dot"></span>Sans matière`;
    const body = document.createElement('div');
    body.style.display = 'none';
    header.onclick = () => { body.style.display = body.style.display === 'none' ? 'block' : 'none'; };
    orphans.forEach(t => {
      const row = document.createElement('div');
      row.className = 'all-tasks-row' + (state.activeTaskId === t.id ? ' active' : '');
      const pct = Math.min(100, t.pomodoros > 0 ? Math.round(t.donePomodoros / t.pomodoros * 100) : 0);
      row.innerHTML = `
        <span class="all-tasks-name">${esc(t.name)}</span>
        <span class="all-tasks-pom">
          <span class="all-tasks-bar"><span class="all-tasks-bar-fill" style="width:${pct}%"></span></span>
          <span class="all-tasks-pom-txt">${t.donePomodoros}/${t.pomodoros}</span>
        </span>`;
      row.onclick = () => { setActiveTask(t.id, null); panel.classList.remove('open'); if (btn) btn.textContent = 'Toutes ›'; };
      body.appendChild(row);
    });
    section.appendChild(header);
    section.appendChild(body);
    inner.appendChild(section);
  }
  if (inner.children.length === 0) {
    inner.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:13px">Aucune tâche</div>';
  }
}

function toggleAllTasksPanel() {
  const panel = document.getElementById('allTasksPanel');
  const inner = document.getElementById('allTasksInner');
  const btn   = document.querySelector('.subject-all-btn');
  if (!panel) return;
  panel.classList.toggle('open');
  btn.textContent = panel.classList.contains('open') ? 'Fermer ✕' : 'Toutes ›';
  renderAllTasksPanel();
  if (panel.classList.contains('open')) {
    setTimeout(() => {
      panel.querySelectorAll('.all-tasks-bar-fill').forEach(el => {
        el.style.width = el.dataset.pct + '%';
      });
    }, 50);
  }
}

function togglePersonalize() {
  const panel = document.getElementById('miniSettings');
  const btn   = document.getElementById('personalizeToggle');
  if (!panel) return;
  panel.classList.toggle('open');
  btn.textContent = panel.classList.contains('open') ? 'Fermer ✕' : 'Personnaliser ›';
}

function selectSubject(subjectId) {
  state.freeTask = false;
  if (state.running) pauseTimer();
  state.activeTaskId = null;
  state.activeSubjectId = subjectId;
  // Remettre le timer à la durée normale si on venait de tâche libre
  state.timeLeft  = state.durations[state.mode] * 60;
  state.totalTime = state.timeLeft;
  document.body.classList.remove('is-started');
  const subject = state.subjects.find(s => s.id === subjectId);
  if (subject) {
    document.getElementById('bannerSubject').textContent = `${subject.emoji || ''} ${subject.name}`.trim();
    document.getElementById('bannerTask').textContent = 'Session libre';
    document.getElementById('activeTaskBanner').style.display = 'flex';
    renderActiveTaskLinks(null);
  } else {
    document.getElementById('activeTaskBanner').style.display = 'none';
  }
  renderTimer();
  renderFreeTaskSubtitle();
  renderSubjectQuickSelect();
  updateFreeTaskActive();
  save();
}

function renderSubjectQuickSelect() {
  const wrap = document.getElementById('subjectQuick');
  if (!wrap) return;
  const selected = getSelectedSubjectId();
  closeAllPopovers();
  wrap.innerHTML = '';

  state.subjects.forEach(s => {
    const chip = document.createElement('div');
    const isActive = selected === s.id;
    chip.className = 'subject-chip' + (isActive ? ' active' : '');
    chip.dataset.subjectId = s.id;

    const top = document.createElement('div');
    top.className = 'subject-chip-top';

    const btn = document.createElement('button');
    btn.className = 'subject-chip-btn';
    btn.textContent = `${s.emoji || ''} ${s.name}`.trim();
    btn.onclick = () => selectSubject(s.id);

    const plus = document.createElement('button');
    plus.className = 'subject-chip-plus';
    const plusLabel = document.createElement('span');
    plusLabel.className = 'subject-chip-plus-label';
    plusLabel.textContent = '+';
    plus.appendChild(plusLabel);
    plus.onclick = (e) => {
      e.stopPropagation();
      const isOpen = activePopoverSubjectId === s.id;
      animatePlusToX(plus, isOpen);
      toggleTaskPopover(s.id, chip);
    };

    top.appendChild(btn);
    top.appendChild(plus);
    chip.appendChild(top);
    wrap.appendChild(chip);

  });
}

let activePopoverSubjectId = null;


function animatePlusToX(plusBtn, closing) {
  const label = plusBtn.querySelector('.subject-chip-plus-label');

  if (closing) {
    // × slides right then rotates back to +
    // closing: slide left while rotating back to 0
    label.animate([
      { transform: 'translateX(2px) rotate(45deg)' },
      { transform: 'translateX(0px) rotate(0deg)' }
    ], { duration: 1500, easing: 'cubic-bezier(.4,0,.2,1)' }).onfinish = () => {
      label.classList.remove('is-x');
    };
  } else {
    // opening: slide right while rotating to 45deg (looks like ×)
    label.animate([
      { transform: 'translateX(0px) rotate(0deg)' },
      { transform: 'translateX(2px) rotate(45deg)' }
    ], { duration: 1500, easing: 'cubic-bezier(.4,0,.2,1)' }).onfinish = () => {
      label.classList.add('is-x');
    };
  }
}

function toggleTaskPopover(subjectId, chip, isAutoOpen = false) {
  if (activePopoverSubjectId === subjectId) {
    if (!isAutoOpen) closeAllPopovers();
    return;
  }
  closeAllPopovers();
  activePopoverSubjectId = subjectId;

  const subject = state.subjects.find(s => s.id === subjectId);
  if (!subject) return;
  const tasks = state.tasks.filter(t => t.subjectId === subjectId && !t.done);

  chip.classList.add('chip-open');

  const taskList = document.createElement('div');
  taskList.className = 'chip-task-list';

  if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chip-task-item';
    empty.style.color = 'var(--text3)';
    empty.textContent = 'Aucune tâche';
    taskList.appendChild(empty);
  } else {
    tasks.forEach(t => {
      const item = document.createElement('div');
      item.className = 'chip-task-item';
      item.innerHTML = `
        <div class="chip-task-check${t.done ? ' done' : ''}"></div>
        <span class="chip-task-name${t.done ? ' done' : ''}">${esc(t.name)}</span>
        <span class="chip-task-pom">${t.donePomodoros}/${t.pomodoros}</span>`;
      item.onclick = (e) => {
        e.stopPropagation();
        closeAllPopovers();
        setActiveTask(t.id, subjectId);
      };
      taskList.appendChild(item);
    });
  }

  const footer = document.createElement('div');
  footer.className = 'chip-footer';
  footer.textContent = 'Voir dans le Planner →';
  footer.onclick = (e) => { e.stopPropagation(); closeAllPopovers(); openSubjectFromHome(subjectId); };
  taskList.appendChild(footer);

  chip.appendChild(taskList);

  if (!isAutoOpen) {
    setTimeout(() => {
      document.addEventListener('click', closeAllPopovers, { once: true });
    }, 0);
  }
}

function closeAllPopovers() {
  document.querySelectorAll('.chip-task-list').forEach(p => p.remove());
  document.querySelectorAll('.subject-chip.chip-open').forEach(c => {
    c.classList.remove('chip-open');
    const label = c.querySelector('.subject-chip-plus-label');
    if (label) {
      label.getAnimations().forEach(a => a.cancel());
      label.classList.remove('is-x');
    }
  });
  activePopoverSubjectId = null;
}

function openSubjectFromHome(subjectId) {
  selectSubject(subjectId);
  switchTab('planner');
  setTimeout(() => {
    const tasksEl = document.getElementById(`tasks-${subjectId}`);
    const chevEl  = document.getElementById(`chev-${subjectId}`);
    if (tasksEl && !tasksEl.classList.contains('open')) {
      tasksEl.classList.add('open');
      if (chevEl) chevEl.classList.add('open');
    }
    const card = tasksEl ? tasksEl.closest('.subject-card') : null;
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function renderFreeTaskSubtitle() {
  const el = document.getElementById('freeTaskSub');
  if (!el) return;
  el.textContent = 'Chronometre';
}

function getSelectedSubjectId() {
  if (state.activeTaskId) {
    const t = state.tasks.find(t => t.id === state.activeTaskId);
    return t ? t.subjectId : null;
  }
  return state.activeSubjectId || null;
}

function getSubjectName(id) {
  const s = state.subjects.find(s => s.id === id);
  return s ? s.name : 'Sans matière';
}
function getTaskName(id) {
  const t = state.tasks.find(t => t.id === id);
  return t ? t.name : 'Session libre';
}

// ── Planner: Subjects ──────────────────────────
function openSubjectModal() {
  selectedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  document.getElementById('subjectName').value  = '';
  document.getElementById('subjectEmoji').value = '';
  buildColorPicker();
  openModal('subjectModal');
  setTimeout(() => document.getElementById('subjectName').focus(), 350);
}

function buildColorPicker() {
  const wrap = document.getElementById('colorPicker');
  wrap.innerHTML = '';
  COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (c === selectedColor ? ' selected' : '');
    sw.style.background = c;
    sw.onclick = () => {
      selectedColor = c;
      wrap.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s.style.background === c || s.style.backgroundColor === c));
    };
    wrap.appendChild(sw);
  });
}

function saveSubject() {
  const name = document.getElementById('subjectName').value.trim();
  if (!name) { document.getElementById('subjectName').focus(); return; }
  const emoji = document.getElementById('subjectEmoji').value.trim();
  const subject = { id: uid(), name, color: selectedColor, emoji };
  state.subjects.push(subject);
  save();
  closeModal('subjectModal');
  renderSubjects();
  showToast(`Matière "${name}" ajoutée`);
}

function deleteSubject(id) {
  if (!confirm('Supprimer cette matière et toutes ses tâches ?')) return;
  state.subjects = state.subjects.filter(s => s.id !== id);
  state.tasks    = state.tasks.filter(t => t.subjectId !== id);
  if (state.activeSubjectId === id) clearActiveTask();
  save();
  renderSubjects();
}

// ── Planner: Tasks ─────────────────────────────
function openTaskModal(subjectId) {
  editingTaskId = null;
  currentSubjectId = subjectId;
  taskPomodoroCount = 2;
  taskPriority = 'medium';
  document.getElementById('taskName').value = '';
  document.getElementById('taskLinkMain').value = '';
  document.getElementById('taskLinkCorrection').value = '';
  document.getElementById('taskPomodoros').textContent = taskPomodoroCount;
  document.querySelectorAll('#taskModal .priority-btn').forEach(b => b.classList.toggle('active', b.dataset.p === 'medium'));
  // Initialiser le dropdown matières
  taskSubjectDropdownSelect(subjectId || null);
  document.getElementById('taskModalTitle').textContent = 'Nouvelle tâche';
  openModal('taskModal');
  setTimeout(() => document.getElementById('taskName').focus(), 350);
}

function toggleSubjectDropdown() {
  const dd = document.getElementById('taskSubjectDropdown');
  const menu = document.getElementById('taskSubjectMenu');
  const isOpen = dd.classList.contains('open');
  if (isOpen) { dd.classList.remove('open'); return; }
  // Build menu
  menu.innerHTML = '';
  const addItem = (id, label, color, emoji) => {
    const item = document.createElement('div');
    item.className = 'subject-dropdown-item' + (document.getElementById('taskSubjectSelect').value === (id||'') ? ' selected' : '');
    item.innerHTML = `<span class="subject-dropdown-item-dot" style="background:${color||'transparent'};${!color?'border:1.5px solid rgba(0,0,0,.15)':''}"></span>${emoji ? emoji + ' ' : ''}${esc(label)}`;
    item.onclick = () => { taskSubjectDropdownSelect(id); dd.classList.remove('open'); };
    menu.appendChild(item);
  };
  addItem(null, '— Sans matière —', null, '');
  state.subjects.forEach(s => addItem(s.id, s.name, s.color, s.emoji));
  dd.classList.add('open');
  // Close on outside click
  setTimeout(() => document.addEventListener('click', function handler(e) {
    if (!dd.contains(e.target)) { dd.classList.remove('open'); document.removeEventListener('click', handler); }
  }), 0);
}

function taskSubjectDropdownSelect(id) {
  document.getElementById('taskSubjectSelect').value = id || '';
  const subject = id ? state.subjects.find(s => s.id === id) : null;
  document.getElementById('taskSubjectDot').style.background = subject ? subject.color : 'transparent';
  document.getElementById('taskSubjectDot').style.border = subject ? 'none' : '1.5px solid rgba(0,0,0,.15)';
  document.getElementById('taskSubjectLabel').textContent = subject
    ? `${subject.emoji ? subject.emoji + ' ' : ''}${subject.name}`
    : '— Sans matière —';
}

function toggleEditSubjectDropdown() {
  const dd = document.getElementById('editTaskSubjectDropdown');
  const menu = document.getElementById('editTaskSubjectMenu');
  const isOpen = dd.classList.contains('open');
  if (isOpen) { dd.classList.remove('open'); return; }
  menu.innerHTML = '';
  const addItem = (id, label, color, emoji) => {
    const item = document.createElement('div');
    item.className = 'subject-dropdown-item' + (document.getElementById('editTaskSubject').value === (id||'') ? ' selected' : '');
    item.innerHTML = `<span class="subject-dropdown-item-dot" style="background:${color||'transparent'};${!color?'border:1.5px solid rgba(0,0,0,.15)':''}"></span>${emoji ? emoji + ' ' : ''}${esc(label)}`;
    item.onclick = () => { editSubjectDropdownSelect(id); dd.classList.remove('open'); };
    menu.appendChild(item);
  };
  addItem(null, '— Sans matière —', null, '');
  state.subjects.forEach(s => addItem(s.id, s.name, s.color, s.emoji));
  dd.classList.add('open');
  setTimeout(() => document.addEventListener('click', function handler(e) {
    if (!dd.contains(e.target)) { dd.classList.remove('open'); document.removeEventListener('click', handler); }
  }), 0);
}

function editSubjectDropdownSelect(id) {
  document.getElementById('editTaskSubject').value = id || '';
  const subject = id ? state.subjects.find(s => s.id === id) : null;
  document.getElementById('editTaskSubjectDot').style.background = subject ? subject.color : 'transparent';
  document.getElementById('editTaskSubjectDot').style.border = subject ? 'none' : '1.5px solid rgba(0,0,0,.15)';
  document.getElementById('editTaskSubjectLabel').textContent = subject
    ? `${subject.emoji ? subject.emoji + ' ' : ''}${subject.name}`
    : '— Sans matière —';
}

function changeTaskPomodoros(delta) {
  taskPomodoroCount = Math.max(1, Math.min(12, taskPomodoroCount + delta));
  document.getElementById('taskPomodoros').textContent = taskPomodoroCount;
}

function selectPriority(p) {
  taskPriority = p;
  document.querySelectorAll('.priority-btn').forEach(b => b.classList.toggle('active', b.dataset.p === p));
}

function saveTask() {
  const name = document.getElementById('taskName').value.trim();
  if (!name) { document.getElementById('taskName').focus(); return; }
  const linkMain = normalizeUrl(document.getElementById('taskLinkMain').value);
  const linkCorrection = normalizeUrl(document.getElementById('taskLinkCorrection').value);

  if (editingTaskId) {
    const t = state.tasks.find(t => t.id === editingTaskId);
    if (t) {
      t.name = name;
      t.pomodoros = taskPomodoroCount;
      t.priority = taskPriority;
      t.linkMain = linkMain;
      t.linkCorrection = linkCorrection;
    }
    editingTaskId = null;
    save();
    closeModal('taskModal');
    renderSubjects();
    showToast('Tâche modifiée');
    return;
  }

  const task = {
    id: uid(),
    subjectId: document.getElementById('taskSubjectSelect').value || null,
    name,
    pomodoros: taskPomodoroCount,
    donePomodoros: 0,
    priority: taskPriority,
    linkMain,
    linkCorrection,
    done: false,
    addedDate: Date.now(),
  };
  state.tasks.push(task);
  save();
  closeModal('taskModal');
  renderSubjects();
  refreshCalendarIfActive();
  showToast(`Tâche ajoutée`);
}

function openEditTaskModal(taskId) {
  const t = state.tasks.find(t => t.id === taskId);
  if (!t) return;
  editingTaskId = taskId;
  taskPomodoroCount = t.pomodoros || 2;
  taskPriority = t.priority || 'medium';
  document.getElementById('editTaskName').value = t.name || '';
  document.getElementById('editTaskLinkMain').value = t.linkMain || '';
  document.getElementById('editTaskLinkCorrection').value = t.linkCorrection || '';
  document.getElementById('editTaskPomodoros').textContent = taskPomodoroCount;
  document.querySelectorAll('#editPriorityPicker .priority-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.p === taskPriority));

  // Initialiser le dropdown matières
  editSubjectDropdownSelect(t.subjectId || null);

  document.getElementById('editTaskModalTitle').textContent = 'Modifier la tâche';
  openModal('editTaskModal');
  setTimeout(() => document.getElementById('editTaskName').focus(), 350);
}

function editSelectPriority(p) {
  taskPriority = p;
  document.querySelectorAll('#editPriorityPicker .priority-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.p === p));
}

function changeEditPomodoros(d) {
  taskPomodoroCount = Math.max(1, Math.min(12, taskPomodoroCount + d));
  document.getElementById('editTaskPomodoros').textContent = taskPomodoroCount;
}

function saveEditTask() {
  const name = document.getElementById('editTaskName').value.trim();
  if (!name) { document.getElementById('editTaskName').focus(); return; }
  const t = state.tasks.find(t => t.id === editingTaskId);
  if (!t) return;
  t.name            = name;
  t.subjectId       = document.getElementById('editTaskSubject').value || null;
  t.linkMain        = normalizeUrl(document.getElementById('editTaskLinkMain').value);
  t.linkCorrection  = normalizeUrl(document.getElementById('editTaskLinkCorrection').value);
  t.pomodoros       = taskPomodoroCount;
  t.priority        = taskPriority;
  editingTaskId = null;
  closeModal('editTaskModal');
  renderSubjects();
  refreshCalendarIfActive();
  if (state.activeTaskId === t.id) renderActiveTaskLinks(t);
  save();
  showToast('Tâche modifiée');
}

function toggleTask(taskId) {
  const t = state.tasks.find(t => t.id === taskId);
  if (!t) return;
  t.done = !t.done;
  if (t.done && state.activeTaskId === taskId) clearActiveTask();
  save();
  renderSubjects();
  refreshCalendarIfActive();
}

function deleteTask(taskId) {
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  if (state.activeTaskId === taskId) clearActiveTask();
  save();
  renderSubjects();
  refreshCalendarIfActive();
}

// ── Render: Subjects & Tasks ───────────────────
function initDragDrop() {
  // Task-row → task-row: reorder within or across subjects
  document.querySelectorAll('.task-row[draggable]').forEach(row => {
    row.addEventListener('dragstart', e => {
      e.stopPropagation();
      dragSrcTaskId = row.dataset.taskId;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.taskId);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.task-row').forEach(r => r.classList.remove('drag-over', 'drag-over-before', 'drag-over-after'));
      document.querySelectorAll('.subject-card-header').forEach(h => h.classList.remove('subject-drop-over'));
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.task-row').forEach(r => r.classList.remove('drag-over', 'drag-over-before', 'drag-over-after'));
      document.querySelectorAll('.subject-card-header').forEach(h => h.classList.remove('subject-drop-over'));
      if (row.dataset.taskId !== dragSrcTaskId) {
        const rect = row.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        row.classList.add('drag-over', before ? 'drag-over-before' : 'drag-over-after');
      }
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
      const srcId  = dragSrcTaskId;
      const destId = row.dataset.taskId;
      if (!srcId || srcId === destId) return;
      const srcIdx  = state.tasks.findIndex(t => t.id === srcId);
      const destIdx = state.tasks.findIndex(t => t.id === destId);
      if (srcIdx === -1 || destIdx === -1) return;
      // Also reassign subject to match destination task's subject
      const destTask = state.tasks[destIdx];
      const [moved] = state.tasks.splice(srcIdx, 1);
      moved.subjectId = destTask.subjectId;
      const insertIndex = state.tasks.findIndex(t => t.id === destId) + (e.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 ? 1 : 0);
      state.tasks.splice(Math.max(0, Math.min(insertIndex, state.tasks.length)), 0, moved);
      save();
      renderSubjects();
      refreshCalendarIfActive();
    });
  });

  // Task-row → subject header: reassign subject without reordering
  document.querySelectorAll('.subject-card-header').forEach(header => {
    const subjectId = header.closest('.subject-card')?.querySelector('.subject-tasks')?.id?.replace('tasks-', '');
    if (!subjectId) return;
    header.addEventListener('dragover', e => {
      if (!dragSrcTaskId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.subject-card-header').forEach(h => h.classList.remove('subject-drop-over'));
      header.classList.add('subject-drop-over');
    });
    header.addEventListener('dragleave', e => {
      if (!header.contains(e.relatedTarget)) header.classList.remove('subject-drop-over');
    });
    header.addEventListener('drop', e => {
      e.preventDefault();
      header.classList.remove('subject-drop-over');
      const srcId = dragSrcTaskId;
      if (!srcId) return;
      const task = state.tasks.find(t => t.id === srcId);
      if (!task || task.subjectId === subjectId) return;
      task.subjectId = subjectId;
      save();
      renderSubjects();
      refreshCalendarIfActive();
      const subj = state.subjects.find(s => s.id === subjectId);
      showToast(`Déplacé vers "${subj?.name || ''}"`);
    });
  });
}

function setTaskFilter(f) {
  taskFilter = f;
  document.getElementById('filterAll').classList.toggle('active', f === 'all');
  document.getElementById('filterToday').classList.toggle('active', f === 'today');
  renderSubjects();
}

function refreshCalendarIfActive() {
  if (document.getElementById('tab-calendar').classList.contains('active')) renderCalendar();
}

function taskIsScheduledOnDate(task, dateKey) {
  return task.scheduledDate === dateKey;
}

function renderSubjects() {
  const list  = document.getElementById('subjectList');
  const empty = document.getElementById('plannerEmpty');
  const openSubjectIds = new Set(
    Array.from(document.querySelectorAll('.subject-tasks.open'))
      .map(el => el.id.replace('tasks-', ''))
  );
  list.innerHTML = '';

  if (state.subjects.length === 0) {
    empty.style.display = 'flex';
    renderSubjectQuickSelect();
    return;
  }
  empty.style.display = 'none';

  const selectedSubject = getSelectedSubjectId();
  state.subjects.forEach(subject => {
    let tasks = state.tasks.filter(t => t.subjectId === subject.id);
    if (taskFilter === 'today') {
      tasks = tasks.filter(t => taskIsScheduledOnDate(t, calDateKey(new Date())));
    }
    const done  = tasks.filter(t => t.done).length;
    const isActiveSubject = selectedSubject === subject.id;

    const card = document.createElement('div');
    card.className = `subject-card${isActiveSubject ? ' active' : ''}`;
    card.innerHTML = `
      <div class="subject-card-header" onclick="toggleSubjectExpand('${subject.id}')">
        <div class="subject-color-dot" style="background:${subject.color}"></div>
        ${subject.emoji ? `<span class="subject-emoji">${subject.emoji}</span>` : ''}
        <div class="subject-card-info">
          <div class="subject-card-name">${esc(subject.name)}</div>
          <div class="subject-card-meta">${tasks.length} tâche${tasks.length !== 1 ? 's' : ''} · ${done} terminée${done !== 1 ? 's' : ''}</div>
        </div>
        <div class="subject-card-actions">
          <button class="icon-btn subject-add-task-btn" id="popbtn-${subject.id}" onclick="event.stopPropagation();toggleTaskPopover('${subject.id}',this)" title="Tâches">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="icon-btn danger" onclick="event.stopPropagation();deleteSubject('${subject.id}')" title="Supprimer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
          <svg class="chevron icon-btn" id="chev-${subject.id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:20px;height:20px;cursor:pointer"><polyline points="9,18 15,12 9,6"/></svg>
        </div>
      </div>
      <div class="subject-tasks" id="tasks-${subject.id}">
        ${tasks.map(t => renderTaskRow(t, subject)).join('')}
        <button class="add-task-btn" onclick="openTaskModal('${subject.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Ajouter une tâche
        </button>
      </div>
    `;
    list.appendChild(card);

    if (openSubjectIds.has(subject.id)) {
      const tasksEl = card.querySelector(`#tasks-${subject.id}`);
      const chevEl = card.querySelector(`#chev-${subject.id}`);
      if (tasksEl) tasksEl.classList.add('open');
      if (chevEl) chevEl.classList.add('open');
    }
  });
  // ── Carte "Sans matière" (tâches orphelines) — visible seulement dans "Toutes" ──
  const orphanTasks = state.tasks.filter(t => !state.subjects.find(s => s.id === t.subjectId));

  if (taskFilter === 'all') {
    const filteredOrphans = orphanTasks;
    empty.style.display = 'none';
    const doneSM = filteredOrphans.filter(t => t.done).length;
    const cardSM = document.createElement('div');
    cardSM.className = 'subject-card';
    cardSM.innerHTML = `
      <div class="subject-card-header" onclick="toggleSubjectExpand('__none__')">
        <div class="subject-color-dot" style="background:#8E8E93"></div>
        <div class="subject-card-info">
          <div class="subject-card-name">Sans matière</div>
          <div class="subject-card-meta">${filteredOrphans.length === 0 ? 'Aucune tâche' : `${filteredOrphans.length} tâche${filteredOrphans.length !== 1 ? 's' : ''} · ${doneSM} terminée${doneSM !== 1 ? 's' : ''}`}</div>
        </div>
        <div class="subject-card-actions">
          <svg class="chevron icon-btn" id="chev-__none__" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:20px;height:20px;cursor:pointer"><polyline points="9,18 15,12 9,6"/></svg>
        </div>
      </div>
      <div class="subject-tasks" id="tasks-__none__">
        ${filteredOrphans.map(t => renderTaskRow(t, null)).join('')}
        <button class="add-task-btn" onclick="openTaskModal(null)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Ajouter une tâche
        </button>
      </div>
    `;
    list.appendChild(cardSM);

    if (openSubjectIds.has('__none__')) {
      const tasksEl = cardSM.querySelector('#tasks-__none__');
      const chevEl  = cardSM.querySelector('#chev-__none__');
      if (tasksEl) tasksEl.classList.add('open');
      if (chevEl)  chevEl.classList.add('open');
    }
  }

  renderSubjectQuickSelect();
  renderFreeTaskSubtitle();
  initDragDrop();
  renderAllTasksPanel();
}

function renderTaskRow(task, subject) {
  const pct = Math.min(100, task.pomodoros > 0 ? Math.round(task.donePomodoros / task.pomodoros * 100) : 0);
  const prioClass = `priority-${task.priority}`;
  const prioLabel = { low: 'Basse', medium: 'Moyenne', high: 'Haute' }[task.priority];
  const isActive = state.activeTaskId === task.id;
  const isRunning = state.running && !state.freeTask;
  const pulseDot = isActive && isRunning ? '<span class="task-pulse-dot"></span>' : '';
  const links = [];
  if (task.linkMain) {
    links.push(`<a class="task-link" href="${escAttr(task.linkMain)}" target="_blank" rel="noopener">Lien</a>`);
  }
  if (task.linkCorrection) {
    links.push(`<a class="task-link" href="${escAttr(task.linkCorrection)}" target="_blank" rel="noopener">Corrige</a>`);
  }
  const linkHtml = links.length ? `<span class="task-link-group">${links.join('')}</span>` : '';
  return `
    <div class="task-row${isActive ? ' active' : ''}" draggable="true" data-task-id="${task.id}" style="${isActive ? 'background:rgba(0,0,0,.04)' : ''}">
      <div class="task-check ${task.done ? 'done' : ''}" onclick="toggleTask('${task.id}')"></div>
      <div class="task-info">
        <div class="task-name ${task.done ? 'done' : ''}">${esc(task.name)}</div>
        <div class="task-meta">
          <span class="task-pomodoro-badge">
            <span class="task-pom-bar"><span class="task-pom-bar-fill" style="width:${pct}%"></span></span>
            <span class="task-pom-txt">${task.donePomodoros}/${task.pomodoros}</span>
          </span>
          <span class="priority-badge ${prioClass}">${prioLabel}</span>
          ${isActive ? '<span style="font-size:11px;color:#111;font-weight:600">▶ Actif</span>' : ''}
          ${linkHtml}
        </div>
      </div>
      <div class="task-actions">
        ${!task.done ? `
        ${isRunning && isActive ? pulseDot : `
        <button class="icon-btn task-play-btn" onclick="setActiveTask('${task.id}','${subject ? subject.id : ''}')" title="Lancer sur le timer" style="color:${isActive ? '#111' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/></svg>
        </button>`}
        ` : ''}
        <button class="icon-btn" onclick="openEditTaskModal('${task.id}')" title="Modifier">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" onclick="deleteTask('${task.id}')" title="Supprimer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `;
}

function toggleSubjectExpand(id) {
  const tasksEl = document.getElementById(`tasks-${id}`);
  const chevEl  = document.getElementById(`chev-${id}`);
  tasksEl.classList.toggle('open');
  chevEl.classList.toggle('open');
}

// ── Render: Stats ──────────────────────────────
function renderStats() {
  // Recalculate today
  const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
  const todayLog = state.log.filter(e => e.ts >= startOfDay.getTime());
  const todayPoms = todayLog.length;
  const todayMins = todayLog.reduce((s, e) => s + e.minutes, 0);
  const doneTasks = state.tasks.filter(t => t.done).length;

  document.getElementById('statTotalPomodoros').textContent = todayPoms;
  document.getElementById('statTotalMinutes').textContent   = todayMins;
  document.getElementById('statStreak').textContent         = doneTasks;
  document.getElementById('statSubjects').textContent       = state.subjects.length;

  // Per-subject breakdown
  const breakdown = document.getElementById('statsBreakdown');
  const statsEmpty = document.getElementById('statsEmpty');
  breakdown.innerHTML = '';

  const subjectMap = {};
  state.log.forEach(e => {
    if (!e.subjectId) return;
    subjectMap[e.subjectId] = (subjectMap[e.subjectId] || 0) + 1;
  });

  const entries = Object.entries(subjectMap).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    statsEmpty.style.display = 'block';
  } else {
    statsEmpty.style.display = 'none';
    const max = entries[0][1];
    entries.forEach(([sid, count]) => {
      const subject = state.subjects.find(s => s.id === sid);
      const name = subject ? `${subject.emoji || ''} ${subject.name}`.trim() : 'Inconnu';
      const color = subject ? subject.color : '#8E8E93';
      const pct = max > 0 ? (count / max * 100) : 0;
      const row = document.createElement('div');
      row.className = 'stat-subject-row';
      row.innerHTML = `
        <div class="stat-subject-name">${esc(name)}</div>
        <div class="stat-subject-bar-wrap">
          <div class="stat-subject-bar" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="stat-subject-count">${count}</div>
      `;
      breakdown.appendChild(row);
    });
  }

  // Recent activity
  const recent = document.getElementById('recentActivity');
  const actEmpty = document.getElementById('activityEmpty');
  recent.innerHTML = '';

  if (state.log.length === 0) {
    actEmpty.style.display = 'block';
  } else {
    actEmpty.style.display = 'none';
    state.log.slice(0, 10).forEach(entry => {
      const subject = state.subjects.find(s => s.id === entry.subjectId);
      const color   = subject ? subject.color : '#8E8E93';
      const name    = entry.taskName || 'Session libre';
      const sub     = entry.subjectName || 'Sans matière';
      const time    = formatRelativeTime(entry.ts);
      const item = document.createElement('div');
      item.className = 'recent-item';
      item.innerHTML = `
        <div class="recent-dot" style="background:${color}"></div>
        <div class="recent-info">
          <div class="recent-name">${esc(name)}</div>
          <div class="recent-time">${esc(sub)} · ${time} · ${entry.minutes} min</div>
        </div>
      `;
      recent.appendChild(item);
    });
  }
}

function renderActiveTaskLinks(task) {
  const wrap    = document.getElementById('activeTaskLinks');
  const editBtn = document.querySelector('.banner-edit-btn');
  if (!wrap) return;
  if (!task) { wrap.innerHTML = ''; if (editBtn) editBtn.style.display = 'none'; return; }

  const isFree = state.freeTask;
  if (editBtn) editBtn.style.display = isFree ? 'none' : '';

  const links = [];
  if (task.linkMain) {
    links.push(`<a class="task-link" href="${escAttr(task.linkMain)}" target="_blank" rel="noopener">Lien</a>`);
  }
  if (task.linkCorrection) {
    links.push(`<a class="task-link" href="${escAttr(task.linkCorrection)}" target="_blank" rel="noopener">Corrigé</a>`);
  }
  wrap.innerHTML = links.join('');
}

function resetStats() {
  if (!confirm('Reinitialiser les statistiques ?')) return;
  state.log = [];
  state.todayPomodoros = 0;
  state.totalMinutes = 0;
  state.sessionsCompleted = 0;
  renderSessionDots();
  renderStats();
  save();
}

// ── Modal helpers ──────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('open');
  document.body.style.overflow = '';
}
function closeOnOverlay(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}

// ── Utilities ──────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) {
  return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function normalizeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}
function formatStopwatch(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'À l\'instant';
  if (m < 60) return `Il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `Il y a ${d}j`;
}

// ── Calendar ───────────────────────────────────
// task extra fields:
//   scheduledDate   (YYYY-MM-DD)
//   scheduledMinute (0–1425, multiple of 15)
//   calDurationMin  (multiple of 15, overrides pomodoro-based default when set)

const CAL_SLOT_H = 16;           // px per 15-min slot
const CAL_DAY_H  = CAL_SLOT_H * 96; // 1536 px = 24 h

let calWeekOffset  = 0;
let calView        = 7;  // 3 | 5 | 7
let calDragTaskId  = null;
let calDragOffsetY = 0;
let calResizeTaskId   = null;
let calResizeStartY   = 0;
let calResizeStartMin = 0;

// drag-to-create selection state
let calSelecting    = false;
let calSelCol       = null;   // the column element being selected
let calSelDateKey   = null;
let calSelStartMin  = 0;
let calSelEndMin    = 0;
let calSelEl        = null;   // the .cal-sel-rect DOM element

// ── Helpers ──
function calGetRangeStart(offset) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (calView === 3) {
    // 3-day: today + offset*3 days
    now.setDate(now.getDate() + offset * 3);
    return now;
  }
  // 5 / 7: Monday of week
  now.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
  return now;
}

function getResponsiveCalView() {
  return window.innerWidth <= 600 ? 3 : 7;
}

function calGetDays(rangeStart) {
  const count = calView === 3 ? 3 : calView; // 3, 5, or 7
  const days = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(rangeStart);
    d.setDate(rangeStart.getDate() + i);
    days.push(d);
  }
  return days;
}

function calDateKey(date) {
  // Use local date parts to avoid UTC offset shifting the day
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function calSnap(min) { return Math.round(min / 15) * 15; }
function calMinToPx(min) { return (min / 1440) * CAL_DAY_H; }
function calPxToMin(px)  { return calSnap(Math.round((px / CAL_DAY_H) * 1440)); }
function calMinToHHMM(min) {
  min = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;
}
function calTaskDur(task) {
  if (task.calDurationMin) return task.calDurationMin;
  return Math.max(15, calSnap((task.pomodoros||1) * (state.durations.pomodoro||25)));
}

// ── View switch ──
function calSetView(v) {
  calView = v;
  calWeekOffset = 0;
  const s = document.getElementById('calScrollArea');
  if (s) delete s.dataset.scrolled;
  document.querySelectorAll('.cal-view-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.view === v));
  renderCalendar();
}

function calNavWeek(dir) {
  calWeekOffset += dir;
  const s = document.getElementById('calScrollArea');
  if (s) delete s.dataset.scrolled;
  renderCalendar();
}

function calGoToday() {
  calWeekOffset = 0;
  const s = document.getElementById('calScrollArea');
  if (s) delete s.dataset.scrolled;
  renderCalendar();
}

// ── Main render ──
function renderCalendar() {
  const rangeStart = calGetRangeStart(calWeekOffset);
  const days       = calGetDays(rangeStart);
  const todayKey   = calDateKey(new Date());
  const nowMin     = new Date().getHours() * 60 + new Date().getMinutes();

  // Range label
  const s_  = rangeStart.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const e_  = days[days.length-1].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  document.getElementById('calWeekLabel').textContent = `${s_} – ${e_}`;

  // ── Day headers ──
  const headers = document.getElementById('calDayHeaders');
  if (!headers) return;
  headers.innerHTML = '<div class="cal-gutter-corner"></div>';
  days.forEach(d => {
    const key = calDateKey(d);
    const isToday = key === todayKey;
    const hd = document.createElement('div');
    hd.className = 'cal-day-hd' + (isToday ? ' cal-day-hd-today' : '');
    const dayName = d.toLocaleDateString('fr-FR', { weekday: 'short' });
    const dayNum  = d.getDate();
    hd.innerHTML = `<span class="cal-hd-name">${dayName}</span><span class="cal-hd-num${isToday ? ' cal-hd-today' : ''}">${dayNum}</span>`;
    headers.appendChild(hd);
  });

  // ── Grid ──
  const grid = document.getElementById('calGrid');
  if (!grid) return;
  grid.innerHTML = '';

  // Gutter
  const gutter = document.createElement('div');
  gutter.className = 'cal-gutter';
  for (let h = 0; h < 24; h++) {
    const lbl = document.createElement('div');
    lbl.className = 'cal-gutter-label';
    lbl.style.top = (h * CAL_SLOT_H * 4) + 'px';
    lbl.textContent = h === 0 ? '' : `${String(h).padStart(2,'0')}:00`;
    gutter.appendChild(lbl);
  }
  grid.appendChild(gutter);

  // Day columns
  days.forEach(d => {
    const key      = calDateKey(d);
    const isToday  = key === todayKey;
    const dayTasks = state.tasks.filter(t => t.scheduledDate === key);

    const col = document.createElement('div');
    col.className = 'cal-col' + (isToday ? ' cal-col-today' : '');
    col.dataset.dateKey = key;

    // Grid lines
    for (let h = 0; h < 24; h++) {
      const hl = document.createElement('div');
      hl.className = 'cal-hour-line' + (h === 0 ? ' cal-hour-first' : '');
      hl.style.top = (h * CAL_SLOT_H * 4) + 'px';
      col.appendChild(hl);
      for (let q = 1; q < 4; q++) {
        const ql = document.createElement('div');
        ql.className = 'cal-quarter-line' + (q === 2 ? ' cal-half-line' : '');
        ql.style.top = (h * CAL_SLOT_H * 4 + q * CAL_SLOT_H) + 'px';
        col.appendChild(ql);
      }
    }

    // Now line
    if (isToday) {
      const nl = document.createElement('div');
      nl.className = 'cal-now-line';
      nl.style.top = calMinToPx(nowMin) + 'px';
      nl.innerHTML = '<div class="cal-now-dot"></div>';
      col.appendChild(nl);
    }

    // Mousedown on empty column space → start drag-to-select
    col.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (calDragTaskId || calResizeTaskId) return;
      if (e.target.closest('.cal-chip') || e.target.closest('.cal-drop-ghost')) return;
      e.preventDefault();
      const rect = col.getBoundingClientRect();
      const startMin = Math.max(0, Math.min(1425, calPxToMin(e.clientY - rect.top)));
      calSelecting   = true;
      calSelCol      = col;
      calSelDateKey  = key;
      calSelStartMin = startMin;
      calSelEndMin   = startMin + 15;
      // Build selection rect element
      calSelEl = document.createElement('div');
      calSelEl.className = 'cal-sel-rect';
      calSelEl.style.top    = calMinToPx(startMin) + 'px';
      calSelEl.style.height = calMinToPx(15) + 'px';
      col.appendChild(calSelEl);
      document.getElementById('calGrid')?.classList.add('cal-selecting');
    });

    // Drag-over drop
    col.addEventListener('dragover', e => {
      if (calResizeTaskId) return; // ignore move-drags during resize
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('cal-col-dragover');
      const rect = col.getBoundingClientRect();
      const snappedMin = Math.max(0, Math.min(1425, calPxToMin(e.clientY - rect.top - calDragOffsetY)));
      let ghost = col.querySelector('.cal-drop-ghost');
      if (!ghost) { ghost = document.createElement('div'); ghost.className = 'cal-drop-ghost'; col.appendChild(ghost); }
      const task = calDragTaskId ? state.tasks.find(t => t.id === calDragTaskId) : null;
      ghost.style.top    = calMinToPx(snappedMin) + 'px';
      ghost.style.height = calMinToPx(task ? calTaskDur(task) : 15) + 'px';
    });
    col.addEventListener('dragleave', e => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('cal-col-dragover');
        col.querySelector('.cal-drop-ghost')?.remove();
      }
    });
    col.addEventListener('drop', e => {
      e.preventDefault();
      col.classList.remove('cal-col-dragover');
      col.querySelector('.cal-drop-ghost')?.remove();
      const taskId = e.dataTransfer.getData('text/plain') || calDragTaskId;
      if (!taskId) return;
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const rect = col.getBoundingClientRect();
      const snappedMin = Math.max(0, Math.min(1425, calPxToMin(e.clientY - rect.top - calDragOffsetY)));
      task.scheduledDate   = key;
      task.scheduledMinute = snappedMin;
      save();
      renderCalendar();
    });

    // Chips
    dayTasks.forEach(t => col.appendChild(buildCalChip(t, false)));
    grid.appendChild(col);
  });

  // ── Unscheduled sidebar ──
  const unscheduledEl = document.getElementById('calUnscheduled');
  unscheduledEl.innerHTML = '';
  const unscheduled = state.tasks.filter(t => !t.scheduledDate);

  unscheduledEl.addEventListener('dragover', e => {
    e.preventDefault();
    unscheduledEl.classList.add('cal-unsched-dragover');
  });
  unscheduledEl.addEventListener('dragleave', e => {
    if (!unscheduledEl.contains(e.relatedTarget)) unscheduledEl.classList.remove('cal-unsched-dragover');
  });
  unscheduledEl.addEventListener('drop', e => {
    e.preventDefault();
    unscheduledEl.classList.remove('cal-unsched-dragover');
    const taskId = e.dataTransfer.getData('text/plain') || calDragTaskId;
    if (!taskId) return;
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    delete task.scheduledDate;
    delete task.scheduledMinute;
    save();
    renderCalendar();
  });

  if (unscheduled.length === 0) {
    unscheduledEl.innerHTML = '<div class="cal-unscheduled-empty">Toutes planifiées ✓</div>';
  } else {
    // Group by subject, then tasks without a subject at the end
    const groups = [];
    state.subjects.forEach(s => {
      const tasks = unscheduled.filter(t => t.subjectId === s.id);
      if (tasks.length) groups.push({ subject: s, tasks });
    });
    const orphans = unscheduled.filter(t => !state.subjects.find(s => s.id === t.subjectId));

    // Subject folders
    groups.forEach(({ subject, tasks }) => {
      const folder = document.createElement('div');
      folder.className = 'cal-folder';

      const header = document.createElement('div');
      header.className = 'cal-folder-header';
      header.innerHTML = `
        <span class="cal-folder-dot" style="background:${subject.color}"></span>
        <span class="cal-folder-name">${esc(`${subject.emoji || ''} ${subject.name}`.trim())}</span>
        <span class="cal-folder-count">${tasks.length}</span>
        <svg class="cal-folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9,18 15,12 9,6"/></svg>
      `;
      header.addEventListener('click', () => folder.classList.toggle('open'));

      // Drop onto folder header → reassign subject
      header.addEventListener('dragover', e => {
        const tid = calDragTaskId || dragSrcTaskId;
        if (!tid) return;
        const task = state.tasks.find(t => t.id === tid);
        if (!task || task.subjectId === subject.id) return;
        e.preventDefault();
        e.stopPropagation();
        header.classList.add('subject-drop-over');
      });
      header.addEventListener('dragleave', e => {
        if (!header.contains(e.relatedTarget)) header.classList.remove('subject-drop-over');
      });
      header.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        header.classList.remove('subject-drop-over');
        const tid = e.dataTransfer.getData('text/plain') || calDragTaskId || dragSrcTaskId;
        if (!tid) return;
        const task = state.tasks.find(t => t.id === tid);
        if (!task || task.subjectId === subject.id) return;
        task.subjectId = subject.id;
        calDragTaskId = null;
        save();
        renderCalendar();
        renderSubjects();
        showToast(`Déplacé vers "${subject.name}"`);
      });

      const body = document.createElement('div');
      body.className = 'cal-folder-body';
      tasks.forEach(t => body.appendChild(buildCalChip(t, true)));

      // Auto-open folder on dragover so user can drop chips into it
      body.addEventListener('dragover', e => {
        e.preventDefault();
        folder.classList.add('open');
      });

      folder.appendChild(header);
      folder.appendChild(body);
      unscheduledEl.appendChild(folder);
    });

    // Orphan tasks (no subject) render as plain chips, no folder wrapper
    orphans.forEach(t => unscheduledEl.appendChild(buildCalChip(t, true)));
  }

  // Scroll to 7 am first time
  const scroll = document.getElementById('calScrollArea');
  if (scroll && scroll.dataset.scrolled !== '1') {
    scroll.scrollTop = calMinToPx(7 * 60);
    scroll.dataset.scrolled = '1';
  }
}

// ── Build chip ──
function buildCalChip(task, sidebar) {
  const subject  = state.subjects.find(s => s.id === task.subjectId);
  const color    = subject ? subject.color : '#8E8E93';
  const pct      = task.pomodoros > 0 ? Math.round((task.donePomodoros||0)/task.pomodoros*100) : 0;
  const isActive = state.activeTaskId === task.id;
  const durMin   = calTaskDur(task);
  const startMin = task.scheduledMinute || 0;
  const endMin   = startMin + durMin;
  const subLabel = subject ? `${subject.emoji||''} ${subject.name}`.trim() : '';

  const chip = document.createElement('div');
  chip.className = ['cal-chip',
    sidebar   ? 'cal-chip-sidebar' : 'cal-chip-placed',
    task.done ? 'cal-chip-done'    : '',
    isActive  ? 'cal-chip-active'  : '',
  ].filter(Boolean).join(' ');
  chip.draggable = true;
  chip.dataset.taskId = task.id;
  chip.style.setProperty('--chip-color', color);

  if (!sidebar) {
    const h = Math.max(CAL_SLOT_H, calMinToPx(durMin));
    chip.style.top    = calMinToPx(startMin) + 'px';
    chip.style.height = h + 'px';
    if (h < 32) chip.classList.add('cal-chip-tiny');
  }

  chip.addEventListener('dragstart', e => {
    // Block drag when mousedown came from the resize handle
    if (e.target.closest && e.target.closest('.cal-chip-resize')) { e.preventDefault(); return; }
    calDragTaskId  = task.id;
    calDragOffsetY = sidebar ? 0 : (e.clientY - chip.getBoundingClientRect().top);
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    chip.classList.add('cal-chip-dragging');
  });
  chip.addEventListener('dragend', () => {
    calDragTaskId = null; calDragOffsetY = 0;
    chip.classList.remove('cal-chip-dragging');
  });

  const timeRange = !sidebar ? `${calMinToHHMM(startMin)} – ${calMinToHHMM(endMin)}` : '';

  chip.innerHTML = `
    <div class="cal-chip-stripe" style="background:${color}"></div>
    <div class="cal-chip-inner">
      ${timeRange ? `<div class="cal-chip-time">${timeRange}</div>` : ''}
      <div class="cal-chip-name">${esc(task.name)}</div>
      <div class="cal-chip-sub">${esc(subLabel)}</div>
      <div class="cal-chip-foot">
        <div class="cal-chip-bar-wrap"><div class="cal-chip-bar-fill" style="width:${pct}%"></div></div>
        <span class="cal-chip-pom">${task.donePomodoros||0}/${task.pomodoros} 🍅</span>
      </div>
    </div>
    ${!task.done ? `<button class="cal-chip-btn-play" title="Activer" onclick="calActivateTask('${task.id}','${task.subjectId||''}',event)">
      <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
    </button>` : ''}
    ${!sidebar ? '<div class="cal-chip-resize" title="Redimensionner"></div>' : ''}
  `;

  // Click = inline edit popover (not on resize, not on play btn)
  chip.addEventListener('click', e => {
    if (e.target.closest('.cal-chip-resize') || e.target.closest('.cal-chip-btn-play')) return;
    calOpenInlineEdit(task.id, chip);
  });

  // Resize handle
  if (!sidebar) {
    const handle = chip.querySelector('.cal-chip-resize');
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      chip.draggable    = false; // prevent drag while resizing
      calResizeTaskId   = task.id;
      calResizeStartY   = e.clientY;
      calResizeStartMin = calTaskDur(task);
      chip.classList.add('cal-chip-resizing');
      document.addEventListener('mousemove', calOnResizeMove);
      document.addEventListener('mouseup',   calOnResizeUp);
    });
  }

  return chip;
}

// ── Resize logic ──
function calOnResizeMove(e) {
  const task = state.tasks.find(t => t.id === calResizeTaskId);
  if (!task) return;
  const deltaPx  = e.clientY - calResizeStartY;
  const deltaMin = calSnap(Math.round((deltaPx / CAL_DAY_H) * 1440));
  const newDur   = Math.max(15, calResizeStartMin + deltaMin);

  // Live-update just the chip height + time label (no full re-render)
  const chip = document.querySelector(`.cal-chip[data-task-id="${calResizeTaskId}"]`);
  if (chip) {
    const startMin = task.scheduledMinute || 0;
    chip.style.height = Math.max(CAL_SLOT_H, calMinToPx(newDur)) + 'px';
    const timeEl = chip.querySelector('.cal-chip-time');
    if (timeEl) timeEl.textContent = `${calMinToHHMM(startMin)} – ${calMinToHHMM(startMin + newDur)}`;
  }
}

function calOnResizeUp(e) {
  document.removeEventListener('mousemove', calOnResizeMove);
  document.removeEventListener('mouseup',   calOnResizeUp);
  const task = state.tasks.find(t => t.id === calResizeTaskId);
  if (task) {
    const deltaPx  = e.clientY - calResizeStartY;
    const deltaMin = calSnap(Math.round((deltaPx / CAL_DAY_H) * 1440));
    task.calDurationMin = Math.max(15, calResizeStartMin + deltaMin);
    save();
    renderCalendar();
  }
  const chip = document.querySelector(`.cal-chip[data-task-id="${calResizeTaskId}"]`);
  if (chip) { chip.classList.remove('cal-chip-resizing'); chip.draggable = true; }
  calResizeTaskId = null;
}

// ── Drag-to-select (create) logic ──
document.addEventListener('mousemove', e => {
  if (!calSelecting || !calSelCol || !calSelEl) return;
  const rect = calSelCol.getBoundingClientRect();
  const curMin  = Math.max(0, Math.min(1440, calPxToMin(e.clientY - rect.top)));
  calSelEndMin  = Math.max(calSelStartMin + 15, calSnap(curMin));
  calSelEl.style.top    = calMinToPx(calSelStartMin) + 'px';
  calSelEl.style.height = Math.max(calMinToPx(15), calMinToPx(calSelEndMin - calSelStartMin)) + 'px';
  // Show time label inside rect
  calSelEl.textContent  = `${calMinToHHMM(calSelStartMin)} – ${calMinToHHMM(calSelEndMin)}`;
});

document.addEventListener('mouseup', e => {
  if (!calSelecting) return;
  calSelecting = false;
  document.getElementById('calGrid')?.classList.remove('cal-selecting');
  const dateKey  = calSelDateKey;
  const startMin = calSelStartMin;
  const endMin   = calSelEndMin;
  if (calSelEl) { calSelEl.remove(); calSelEl = null; }
  calSelCol = null; calSelDateKey = null;
  // Only open popover if a real drag happened (at least 15 min)
  if (endMin - startMin >= 15) {
    calOpenNewTask(dateKey, startMin, endMin, e.clientX, e.clientY);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (calSelecting) {
      calSelecting = false;
      document.getElementById('calGrid')?.classList.remove('cal-selecting');
      if (calSelEl) { calSelEl.remove(); calSelEl = null; }
      calSelCol = null; calSelDateKey = null;
    }
    calCloseNewTask();
  }
});

// ── Inline edit popover ──
let calEditPopoverTaskId = null;
let calEditSubjectId = '';
let calNewSubjectId = '';
let calNewSubjectFormVisible = false;

function calRenderSubjectPicker(selectedId, pickerId, allowNew = false, variant = 'calEdit') {
  const selected = selectedId || '';
  const chips = [];
  chips.push(`<button type="button" class="cal-subject-chip${selected === '' ? ' active' : ''}" data-subject-id="" onclick="${variant}SetSubject('')">Sans matière</button>`);
  state.subjects.forEach(s => {
    const label = `${s.emoji || ''} ${s.name}`.trim();
    chips.push(`<button type="button" class="cal-subject-chip${selected === s.id ? ' active' : ''}" data-subject-id="${escAttr(s.id)}" onclick="${variant}SetSubject('${escAttr(s.id)}')">${esc(label)}</button>`);
  });
  if (allowNew) {
    chips.push(`<button type="button" class="cal-subject-chip cal-subject-chip-new" onclick="calToggleNewSubjectForm()">＋ Nouvelle…</button>`);
  }
  return `
    <div class="cal-subject-picker" id="${pickerId}" data-open="1">
      <button type="button" class="cal-subject-picker-head" onclick="calToggleSubjectPicker('${pickerId}')">
        <span>Matières</span>
        <span class="cal-subject-picker-count">${state.subjects.length + 1 + (allowNew ? 1 : 0)}</span>
        <svg class="cal-subject-picker-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9,18 15,12 9,6"/></svg>
      </button>
      <div class="cal-subject-picker-body">
        ${chips.join('')}
      </div>
    </div>`;
}

function calToggleSubjectPicker(pickerId) {
  const picker = document.getElementById(pickerId);
  if (!picker) return;
  picker.dataset.open = picker.dataset.open === '1' ? '0' : '1';
}

function calOpenInlineEdit(taskId, chipEl) {
  calCloseInlineEdit();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  calEditPopoverTaskId = taskId;
  calEditSubjectId = task.subjectId || '';

  const subject  = state.subjects.find(s => s.id === task.subjectId);
  const color    = subject ? subject.color : '#8E8E93';
  const durMin   = calTaskDur(task);
  const startMin = task.scheduledMinute || 0;
  const prio     = task.priority || 'medium';
  const poms     = task.pomodoros || 1;

  const pop = document.createElement('div');
  pop.className = 'cal-edit-pop';
  pop.id = 'calEditPop';
  pop.innerHTML = `
    <div class="cal-edit-pop-stripe" style="background:${color}"></div>
    <div class="cal-edit-pop-body">
      <input class="cal-edit-pop-input" id="calEditName" value="${esc(task.name)}" placeholder="Nom de la tâche" maxlength="80"
             onkeydown="if(event.key==='Enter')calInlineSave('${taskId}')"/>

      <div class="cal-edit-cols">
        <div class="cal-edit-col-left">
          <span class="cal-new-field-lbl">Horaire</span>
          <div class="cal-new-row-times cal-edit-row-times">
            <div class="cal-new-time-field">
              <span class="cal-new-field-lbl">Début</span>
              <input class="cal-new-time-inp cal-edit-time-input" id="calEditStart" type="time" value="${calMinToHHMM(startMin)}"/>
            </div>
            <span class="cal-new-time-dash cal-edit-time-dash">–</span>
            <div class="cal-new-time-field">
              <span class="cal-new-field-lbl">Fin</span>
              <input class="cal-new-time-inp cal-edit-time-input" id="calEditEnd" type="time" value="${calMinToHHMM(startMin + durMin)}"/>
            </div>
          </div>
          <span class="cal-new-field-lbl" style="margin-top:8px;display:block">Matière</span>
          ${calRenderSubjectPicker(calEditSubjectId, 'calEditSubjectPicker', false, 'calEdit')}
        </div>

        <div class="cal-edit-col-right">
          <span class="cal-new-field-lbl">Pomodoros</span>
          <div class="cal-new-pom cal-edit-pom-row">
            <button type="button" class="cal-new-pom-btn cal-edit-pom-btn" onclick="calEditChangePom(-1)">−</button>
            <span id="calEditPomVal">${poms}</span>
            <button type="button" class="cal-new-pom-btn cal-edit-pom-btn" onclick="calEditChangePom(1)">+</button>
          </div>

          <span class="cal-new-field-lbl" style="margin-top:8px;display:block">Priorité</span>
          <div class="cal-new-prio-col cal-edit-prio-col">
            <button type="button" class="cal-new-prio cal-edit-prio-btn${prio==='low'?' active':''}" data-p="low" onclick="calEditSetPrio('low')">Basse</button>
            <button type="button" class="cal-new-prio cal-edit-prio-btn${prio==='medium'?' active':''}" data-p="medium" onclick="calEditSetPrio('medium')">Moyenne</button>
            <button type="button" class="cal-new-prio cal-edit-prio-btn${prio==='high'?' active':''}" data-p="high" onclick="calEditSetPrio('high')">Haute</button>
          </div>

          <span class="cal-new-field-lbl" style="margin-top:8px;display:block">Liens</span>
          <input class="cal-new-link cal-edit-pop-link" id="calEditLinkMain" type="url" placeholder="Lien cours / exercice" value="${escAttr(task.linkMain||'')}"/>
          <input class="cal-new-link cal-edit-pop-link" id="calEditLinkCorr" type="url" placeholder="Lien correction (optionnel)" value="${escAttr(task.linkCorrection||'')}"/>
        </div>
      </div>

      <div class="cal-edit-pop-actions">
        <button class="cal-edit-pop-del" onclick="calInlineDelete('${taskId}')" title="Supprimer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
        <button class="cal-edit-pop-play" onclick="calActivateTask('${taskId}','${task.subjectId||''}',event)" title="Activer">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
          Lancer
        </button>
        <button class="cal-edit-pop-save" onclick="calInlineSave('${taskId}')">Enregistrer</button>
      </div>
    </div>
    <button class="cal-edit-pop-close" onclick="calCloseInlineEdit()">✕</button>
  `;

  document.body.appendChild(pop);

  // Position: prefer right of chip, flip left if no room, clamp vertically
  const chipRect = chipEl.getBoundingClientRect();
  const popW = Math.min(420, window.innerWidth - 24);
  const popH = pop.offsetHeight || 380;
  let left = chipRect.right + 10;
  if (left + popW > window.innerWidth - 12) left = Math.max(8, chipRect.left - popW - 10);
  let top = chipRect.top;
  if (top + popH > window.innerHeight - 12) top = Math.max(8, window.innerHeight - popH - 12);
  pop.style.left = left + 'px';
  pop.style.top  = top + 'px';

  setTimeout(() => document.getElementById('calEditName')?.focus(), 50);
  setTimeout(() => document.addEventListener('click', calEditOutsideClose), 10);
}

let calEditPomCount = 1;
let calEditPrioVal  = 'medium';

function calEditChangePom(d) {
  const task = state.tasks.find(t => t.id === calEditPopoverTaskId);
  if (!task) return;
  const el = document.getElementById('calEditPomVal');
  if (!el) return;
  const cur = parseInt(el.textContent) || 1;
  const next = Math.max(1, Math.min(12, cur + d));
  el.textContent = next;
}

function calEditSetPrio(p) {
  calEditPrioVal = p;
  document.querySelectorAll('#calEditPop .cal-edit-prio-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.p === p));
}

function calEditSetSubject(subjectId) {
  calEditSubjectId = subjectId || '';
  document.querySelectorAll('#calEditSubjectPicker .cal-subject-chip').forEach(b => {
    b.classList.toggle('active', (b.dataset.subjectId || '') === calEditSubjectId);
  });
}

function calEditOutsideClose(e) {
  const pop = document.getElementById('calEditPop');
  if (pop && !pop.contains(e.target)) calCloseInlineEdit();
}

function calCloseInlineEdit() {
  document.removeEventListener('click', calEditOutsideClose);
  document.getElementById('calEditPop')?.remove();
  calEditPopoverTaskId = null;
}

function calInlineSave(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  const name = document.getElementById('calEditName')?.value.trim();
  if (name) task.name = name;

  const startVal = document.getElementById('calEditStart')?.value;
  const endVal   = document.getElementById('calEditEnd')?.value;
  if (startVal) {
    const [sh, sm] = startVal.split(':').map(Number);
    task.scheduledMinute = calSnap(sh * 60 + sm);
  }
  if (startVal && endVal) {
    const [sh, sm] = startVal.split(':').map(Number);
    const [eh, em] = endVal.split(':').map(Number);
    const dur = calSnap((eh * 60 + em) - (sh * 60 + sm));
    if (dur >= 15) task.calDurationMin = dur;
  }

  const pomVal = parseInt(document.getElementById('calEditPomVal')?.textContent) || task.pomodoros;
  task.pomodoros = Math.max(1, Math.min(12, pomVal));

  const activePrio = document.querySelector('#calEditPop .cal-edit-prio-btn.active');
  if (activePrio) task.priority = activePrio.dataset.p;

  task.linkMain       = normalizeUrl(document.getElementById('calEditLinkMain')?.value || '');
  task.linkCorrection = normalizeUrl(document.getElementById('calEditLinkCorr')?.value || '');

  task.subjectId = calEditSubjectId || null;

  // If active task, refresh banner links
  if (state.activeTaskId === taskId) renderActiveTaskLinks(task);

  save();
  calCloseInlineEdit();
  renderCalendar();
  renderSubjects();
  showToast('Tâche modifiée');
}

function calInlineDelete(taskId) {
  calCloseInlineEdit();
  deleteTask(taskId);
}

// ── New task from calendar ──────────────────────
let calNewTaskColor = COLORS[5];
let calNewPrioVal = 'medium';
function calUpdateNewSubjectPicker() {
  document.querySelectorAll('#calNewSubjectPicker .cal-subject-chip').forEach(b => {
    const subjectId = b.dataset.subjectId || '';
    b.classList.toggle('active', subjectId === (calNewSubjectId || ''));
  });
}

function calToggleNewSubjectForm(forceVisible) {
  const form = document.getElementById('calNewSubjectForm');
  if (!form) return;
  calNewSubjectFormVisible = typeof forceVisible === 'boolean' ? forceVisible : !calNewSubjectFormVisible;
  form.classList.toggle('visible', calNewSubjectFormVisible);
}

function calNewSetSubject(subjectId) {
  calNewSubjectId = subjectId || '';
  calNewSubjectFormVisible = false;
  const form = document.getElementById('calNewSubjectForm');
  if (form) form.classList.remove('visible');
  calUpdateNewSubjectPicker();
}

function calOpenNewTask(dateKey, startMin, endMinOrX, clientX, clientY) {
  // calOpenNewTask(dateKey, startMin, endMin, clientX, clientY)  ← from drag-to-select
  // calOpenNewTask(dateKey, startMin, clientX, clientY)          ← legacy single-click (unused now)
  let endMin, cx, cy;
  if (clientY !== undefined) {
    // 5-arg form from drag-to-select
    endMin = endMinOrX;
    cx     = clientX;
    cy     = clientY;
  } else {
    endMin = startMin + 60;
    cx     = endMinOrX;
    cy     = clientX;
  }

  // Close any open inline edit
  calCloseInlineEdit();
  document.getElementById('calNewTaskPop')?.remove();

  calNewTaskColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  calNewPrioVal = 'medium';
  calNewSubjectId = '';
  calNewSubjectFormVisible = false;

  const subjectPicker = calRenderSubjectPicker(calNewSubjectId, 'calNewSubjectPicker', true, 'calNew');

  const pop = document.createElement('div');
  pop.className = 'cal-new-task-pop';
  pop.id = 'calNewTaskPop';
  pop.innerHTML = `
    <div class="cal-new-header">
      <span class="cal-new-time-badge-txt" id="calNewTimeBadge">${calMinToHHMM(startMin)} – ${calMinToHHMM(Math.min(1440, endMin))}</span>
      <button class="cal-new-x" onclick="calCloseNewTask()">✕</button>
    </div>

    <input class="cal-new-name-input" id="calNewName" placeholder="Nom de la tâche…" maxlength="80"
           onkeydown="if(event.key==='Enter')calSaveNewTask('${dateKey}',${startMin},${endMin})"/>

    <div class="cal-new-cols">
      <div class="cal-new-col-left">
        <span class="cal-new-field-lbl">Horaire</span>
        <div class="cal-new-row-times">
          <div class="cal-new-time-field">
            <span class="cal-new-field-lbl">Début</span>
            <input class="cal-new-time-inp" id="calNewStart" type="time" value="${calMinToHHMM(startMin)}"
                   onchange="calNewUpdateTimeBadge()"/>
          </div>
          <span class="cal-new-time-dash">–</span>
          <div class="cal-new-time-field">
            <span class="cal-new-field-lbl">Fin</span>
            <input class="cal-new-time-inp" id="calNewEnd" type="time" value="${calMinToHHMM(Math.min(1440, endMin))}"
                   onchange="calNewUpdateTimeBadge()"/>
          </div>
        </div>

        <span class="cal-new-field-lbl" style="margin-top:8px;display:block">Matière</span>
        ${subjectPicker}

        <div class="cal-new-subj-form" id="calNewSubjectForm">
          <input class="cal-new-subj-inp" id="calNewSubjectName" placeholder="Nom de la matière" maxlength="40"/>
          <div class="cal-new-color-strip" id="calNewColorPicker"></div>
        </div>
      </div>

      <div class="cal-new-col-right">
        <span class="cal-new-field-lbl">Pomodoros</span>
        <div class="cal-new-pom">
          <button type="button" class="cal-new-pom-btn" onclick="calNewChangePom(-1)">−</button>
          <span id="calNewPomVal">2</span>
          <button type="button" class="cal-new-pom-btn" onclick="calNewChangePom(1)">+</button>
        </div>

        <span class="cal-new-field-lbl" style="margin-top:8px;display:block">Priorité</span>
        <div class="cal-new-prio-col">
          <button type="button" class="cal-new-prio" data-p="low" onclick="calNewSetPrio('low')">Basse</button>
          <button type="button" class="cal-new-prio active" data-p="medium" onclick="calNewSetPrio('medium')">Moyenne</button>
          <button type="button" class="cal-new-prio" data-p="high" onclick="calNewSetPrio('high')">Haute</button>
        </div>

        <span class="cal-new-field-lbl" style="margin-top:8px;display:block">Liens</span>
        <input class="cal-new-link" id="calNewLinkMain" type="url" placeholder="Cours…"/>
        <input class="cal-new-link" id="calNewLinkCorr" type="url" placeholder="Correction…"/>
      </div>
    </div>

    <button class="cal-new-create" onclick="calSaveNewTask('${dateKey}',${startMin},${endMin})">Créer la tâche</button>
  `;

  // Append offscreen first so we can measure true height
  pop.style.visibility = 'hidden';
  pop.style.top  = '-9999px';
  pop.style.left = '-9999px';
  document.body.appendChild(pop);

  // Build color swatches for new subject
  const picker = pop.querySelector('#calNewColorPicker');
  COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'cal-new-color-swatch' + (c === calNewTaskColor ? ' selected' : '');
    sw.style.background = c;
    sw.onclick = () => {
      calNewTaskColor = c;
      picker.querySelectorAll('.cal-new-color-swatch').forEach(s => s.classList.toggle('selected', s.style.background === c || s.style.backgroundColor === c));
    };
    picker.appendChild(sw);
  });

  // Now measure and position — always fully inside viewport
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  const pad  = 10;
  // Horizontal: prefer right of cursor, flip left if it would overflow
  let left = cx + 14;
  if (left + popW > window.innerWidth - pad) left = cx - popW - 14;
  left = Math.max(pad, Math.min(left, window.innerWidth - popW - pad));
  // Vertical: prefer aligning top to cursor, shift up if it clips the bottom
  let top = cy - 10;
  if (top + popH > window.innerHeight - pad) top = window.innerHeight - popH - pad;
  top = Math.max(pad, top);
  pop.style.left = left + 'px';
  pop.style.top  = top + 'px';
  pop.style.visibility = '';

  setTimeout(() => document.getElementById('calNewName')?.focus(), 50);
  setTimeout(() => document.addEventListener('mousedown', calNewOutsideClose), 10);
}

function calNewOutsideClose(e) {
  const pop = document.getElementById('calNewTaskPop');
  if (pop && !pop.contains(e.target)) calCloseNewTask();
}

function calCloseNewTask() {
  document.removeEventListener('mousedown', calNewOutsideClose);
  document.getElementById('calNewTaskPop')?.remove();
}

function calNewSubjectChange() {
  calToggleNewSubjectForm(true);
}

function calNewUpdateTimeBadge() {
  const s = document.getElementById('calNewStart')?.value;
  const e = document.getElementById('calNewEnd')?.value;
  const badge = document.getElementById('calNewTimeBadge');
  if (badge && s && e) badge.textContent = `${s} – ${e}`;
}


function calNewChangePom(d) {
  const el = document.getElementById('calNewPomVal');
  if (!el) return;
  el.textContent = Math.max(1, Math.min(12, parseInt(el.textContent) + d));
}

function calNewSetPrio(p) {
  calNewPrioVal = p;
  document.querySelectorAll('#calNewTaskPop .cal-new-prio').forEach(b =>
    b.classList.toggle('active', b.dataset.p === p));
}

function calSaveNewTask(dateKey, fallbackStartMin, fallbackEndMin) {
  const name = document.getElementById('calNewName')?.value.trim();
  if (!name) { document.getElementById('calNewName')?.focus(); return; }

  // Resolve subject — may need to create one first
  let subjectId = calNewSubjectId || '';
  if (calNewSubjectFormVisible) {
    const sName = document.getElementById('calNewSubjectName')?.value.trim();
    if (!sName) { document.getElementById('calNewSubjectName')?.focus(); return; }
    const newSubject = { id: uid(), name: sName, color: calNewTaskColor, emoji: '' };
    state.subjects.push(newSubject);
    subjectId = newSubject.id;
    renderSubjects(); // sync planner
    showToast(`Matière "${sName}" créée`);
  }

  // Times — read from inputs (user may have edited), fall back to drag values
  const startVal = document.getElementById('calNewStart')?.value;
  const endVal   = document.getElementById('calNewEnd')?.value;
  let scheduledMinute = fallbackStartMin;
  let calDurationMin  = fallbackEndMin ? (fallbackEndMin - fallbackStartMin) : 60;
  if (startVal) {
    const [sh, sm] = startVal.split(':').map(Number);
    scheduledMinute = calSnap(sh * 60 + sm);
  }
  if (startVal && endVal) {
    const [sh, sm] = startVal.split(':').map(Number);
    const [eh, em] = endVal.split(':').map(Number);
    const dur = calSnap((eh * 60 + em) - (sh * 60 + sm));
    if (dur >= 15) calDurationMin = dur;
  }

  const poms = parseInt(document.getElementById('calNewPomVal')?.textContent) || 2;
  const prio = calNewPrioVal || document.querySelector('#calNewTaskPop .cal-new-prio.active')?.dataset.p || 'medium';
  const linkMain = normalizeUrl(document.getElementById('calNewLinkMain')?.value || '');
  const linkCorr = normalizeUrl(document.getElementById('calNewLinkCorr')?.value || '');

  const task = {
    id: uid(),
    subjectId: subjectId || null,
    name,
    pomodoros: poms,
    donePomodoros: 0,
    priority: prio,
    linkMain,
    linkCorrection: linkCorr,
    done: false,
    addedDate: Date.now(),
    scheduledDate: dateKey,
    scheduledMinute,
    calDurationMin,
  };

  state.tasks.push(task);
  save();
  calCloseNewTask();
  renderCalendar();
  renderSubjects();
  showToast('Tâche créée');
}

function calActivateTask(taskId, subjectId, e) {
  e.stopPropagation();
  setActiveTask(taskId, subjectId || null);
}

// ── Keyboard shortcuts ─────────────────────────
document.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); toggleTimer(); }
  if (e.code === 'KeyR')  resetTimer();
  if (e.code === 'Digit1') setMode('pomodoro');
  if (e.code === 'Digit2') setMode('short');
  if (e.code === 'Digit3') setMode('long');
});

// ── Spotify ────────────────────────────────────
const SP_DEFAULTS = [
  { label: 'Lo-fi study',  url: 'https://open.spotify.com/playlist/0vvXsWCC9xrXsKd4euo32G' },
  { label: 'Deep focus',   url: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ' },
  { label: 'Coding mode',  url: 'https://open.spotify.com/playlist/37i9dQZF1DX5trt9i14X7j' },
  { label: 'Jazz study',   url: 'https://open.spotify.com/playlist/37i9dQZF1DXbITWG1ZJKYt' },
];
let spEditMode = false;

function spGetPresets() {
  try {
    const raw = localStorage.getItem('focus_sp_presets');
    return raw ? JSON.parse(raw) : SP_DEFAULTS.map(p => ({ ...p }));
  } catch { return SP_DEFAULTS.map(p => ({ ...p })); }
}

function spSavePresets(list) {
  localStorage.setItem('focus_sp_presets', JSON.stringify(list));
}

function spUrlToEmbed(url) {
  try {
    url = url.trim();
    const uriMatch = url.match(/^spotify:(track|playlist|album|episode|show|artist):([A-Za-z0-9]+)$/);
    if (uriMatch) return `https://open.spotify.com/embed/${uriMatch[1]}/${uriMatch[2]}`;
    const u = new URL(url);
    if (!u.hostname.includes('spotify.com')) return null;
    const pathMatch = u.pathname.match(/^\/(track|playlist|album|episode|show|artist)\/([A-Za-z0-9]+)/);
    if (!pathMatch) return null;
    return `https://open.spotify.com/embed/${pathMatch[1]}/${pathMatch[2]}`;
  } catch { return null; }
}

function spLoad(url) {
  url = url || document.getElementById('spUrlInput')?.value || '';
  const embedUrl = spUrlToEmbed(url);
  const wrap = document.getElementById('spEmbedWrap');
  if (!embedUrl || !wrap) {
    if (url) showToast('Lien Spotify invalide');
    return;
  }
  const isTrack = embedUrl.includes('/embed/track/') || embedUrl.includes('/embed/episode/');
  const height  = isTrack ? '152' : '380';
  wrap.innerHTML = `
    <iframe
      src="${embedUrl}?utm_source=generator&theme=0"
      width="100%" height="${height}"
      frameborder="0"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      loading="lazy"
      style="border-radius:14px; display:block;">
    </iframe>`;
  localStorage.setItem('focus_spotify_url', url);
}

function spRenderPresets() {
  const wrap = document.getElementById('spPresets');
  if (!wrap) return;
  wrap.innerHTML = '';
  const presets = spGetPresets();
  presets.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'sp-preset-item';
    const btn = document.createElement('button');
    btn.className = 'sp-preset-btn';
    btn.textContent = p.label;
    btn.onclick = () => {
      if (spEditMode) return;
      document.getElementById('spUrlInput').value = p.url;
      spLoad(p.url);
    };
    item.appendChild(btn);
    if (spEditMode) {
      const del = document.createElement('button');
      del.className = 'sp-preset-del';
      del.title = 'Supprimer';
      del.innerHTML = '✕';
      del.onclick = () => {
        const list = spGetPresets();
        list.splice(i, 1);
        spSavePresets(list);
        spRenderPresets();
      };
      item.appendChild(del);
    }
    wrap.appendChild(item);
  });
}

function spToggleEdit() {
  spEditMode = !spEditMode;
  const btn  = document.getElementById('spEditBtn');
  const form = document.getElementById('spAddForm');
  if (btn)  btn.textContent = spEditMode ? 'Terminé' : 'Modifier';
  if (btn)  btn.classList.toggle('active', spEditMode);
  if (form) form.classList.toggle('visible', spEditMode);
  spRenderPresets();
}

function spAddPreset() {
  const name = document.getElementById('spAddName')?.value.trim();
  const url  = document.getElementById('spAddUrl')?.value.trim();
  if (!name) { document.getElementById('spAddName')?.focus(); return; }
  if (!spUrlToEmbed(url)) { showToast('Lien Spotify invalide'); return; }
  const list = spGetPresets();
  list.push({ label: name, url });
  spSavePresets(list);
  document.getElementById('spAddName').value = '';
  document.getElementById('spAddUrl').value  = '';
  spRenderPresets();
  showToast(`"${name}" ajouté`);
}

// ── Init ───────────────────────────────────────
function init() {
  load();

  state.prefs = normalizePrefs(state.prefs || {});
  state.tabOrder = normalizeTabOrder(state.tabOrder || state.prefs.tabOrder || DEFAULT_TAB_ORDER);
  applyPreferences();

  // Status bar clock
  updateClock();
  setInterval(updateClock, 10000);

  // Timer init
  state.timeLeft  = state.durations[state.mode] * 60;
  state.totalTime = state.timeLeft;
  document.body.dataset.mode = state.mode;

  // Duration UI
  ['pomodoro','short','long','sessions','pomBadge'].forEach(k => {
    const durEl = document.getElementById(`dur-${k}`);
    if (durEl) durEl.textContent = state.durations[k];
  });
  ['pomodoro','short','long','pomBadge'].forEach(k => {
    const cardValue = document.getElementById(`durCard-${k}`);
    if (cardValue) cardValue.textContent = state.durations[k];
  });

  renderTimer();
  renderSessionDots();
  applyTabOrder();
  bindTabDragAndDrop();
  renderSubjects();
  buildColorPicker();
  renderSubjectQuickSelect();
  renderFreeTaskSubtitle();
  updateFreeTaskActive();
  spRenderPresets();
  const lastSp = localStorage.getItem('focus_spotify_url');
  if (lastSp) {
    const inp = document.getElementById('spUrlInput');
    if (inp) inp.value = lastSp;
    spLoad(lastSp);
  }

  window.addEventListener('resize', () => {
    if (document.getElementById('tab-calendar')?.classList.contains('active')) {
      renderCalendar();
    }
  });

  switchTab((state.prefs.defaultTab && !state.prefs.hiddenTabs.includes(state.prefs.defaultTab)) ? state.prefs.defaultTab : 'timer');
}

init();
