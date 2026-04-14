/* ===========================
   TASKS v3 — app.js
   完全日本語版 + 繰り返し強化
   =========================== */

// 古いService Workerのキャッシュを全削除（バージョンアップ時の残骸対策）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  });
  caches.keys().then(keys => {
    keys.filter(k => k !== 'tasks-v3').forEach(k => caches.delete(k));
  });
}

// ─────────────────────────────────────────────────────
// 状態
// ─────────────────────────────────────────────────────

let tasks          = [];
let filter         = 'all';
let autoReset      = false;
let editTarget     = null;
let autoResetTimer = null;
let dragSrcIndex   = null;
let lastResetDate  = null;
const expandedTasks = new Set();

const STORAGE_KEY  = 'tasks_v3';
const SETTINGS_KEY = 'tasks_settings_v3';

// 優先度ラベル
const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' };

// 繰り返しラベル
const INTERVAL_LABEL = {
  daily:      '毎日',
  every2days: '2日に1回',
  every3days: '3日に1回',
  weekdays:   '曜日指定',
  monthly:    '毎月1日'
};

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// ─────────────────────────────────────────────────────
// DOM参照
// ─────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const taskInput         = $('taskInput');
const prioritySelect    = $('prioritySelect');
const expandInputBtn    = $('expandInputBtn');
const inputExtra        = $('inputExtra');
const dueDateInput      = $('dueDateInput');
const recurringToggle   = $('recurringToggle');
const recurringInterval = $('recurringInterval');
const weekdayPicker     = $('weekdayPicker');
const notesInput        = $('notesInput');
const addBtn            = $('addBtn');
const taskList          = $('taskList');
const emptyState        = $('emptyState');
const emptyMsg          = $('emptyMsg');
const emptySubMsg       = $('emptySubMsg');
const autoResetToggle   = $('autoResetToggle');
const autoInfo          = $('autoInfo');
const nextResetTime     = $('nextResetTime');
const clearDoneBtn      = $('clearDoneBtn');
const resetAllBtn       = $('resetAllBtn');
const filterBtns        = document.querySelectorAll('.filter-btn');
const totalCount        = $('totalCount');
const pendingCount      = $('pendingCount');
const doneCount         = $('doneCount');
const overdueCount      = $('overdueCount');
const progressFill      = $('progressFill');
const lastSaved         = $('lastSaved');
const searchInput       = $('searchInput');
const clearSearch       = $('clearSearch');
const sortSelect        = $('sortSelect');
const modalOverlay      = $('modalOverlay');
const editInput         = $('editInput');
const editPriority      = $('editPriority');
const editDueDate       = $('editDueDate');
const editRecurring     = $('editRecurring');
const editRecurringInt  = $('editRecurringInterval');
const editWeekdayPicker = $('editWeekdayPicker');
const editNotes         = $('editNotes');
const saveEditBtn       = $('saveEditBtn');
const cancelEditBtn     = $('cancelEditBtn');
const modalClose        = $('modalClose');
const pwaInstallBtn     = $('pwaInstallBtn');

// ─────────────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────────────

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function getTodayStr() { return new Date().toISOString().slice(0, 10); }

function getDueStatus(dueDate) {
  if (!dueDate) return null;
  const today = getTodayStr();
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return 'future';
}

function getDueLabelText(dueDate) {
  const s = getDueStatus(dueDate);
  const [, m, d] = dueDate.split('-');
  if (s === 'today')   return '今日';
  if (s === 'overdue') {
    const diff = Math.floor((new Date(getTodayStr()) - new Date(dueDate)) / 86400000);
    return diff === 1 ? '昨日' : `${diff}日超過`;
  }
  return `${m}/${d}`;
}

// 曜日の選択状態を取得（チェックされた value の配列）
function getSelectedDays(picker) {
  return Array.from(picker.querySelectorAll('input[type="checkbox"]:checked'))
    .map(cb => parseInt(cb.value));
}

// 曜日ボタンの選択状態をUIに反映
function applySelectedDays(picker, days) {
  picker.querySelectorAll('.weekday-btn').forEach(btn => {
    const day = parseInt(btn.dataset.day);
    const cb  = btn.querySelector('input[type="checkbox"]');
    const isSelected = days.includes(day);
    cb.checked = isSelected;
    btn.classList.toggle('selected', isSelected);
  });
}

// ─────────────────────────────────────────────────────
// ストレージ
// ─────────────────────────────────────────────────────

function save() {
  localStorage.setItem(STORAGE_KEY,  JSON.stringify(tasks));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoReset, lastResetDate }));
  const now = new Date();
  const hms = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  lastSaved.textContent = `保存済み ${hms}`;
}

function pad(n) { return n.toString().padStart(2, '0'); }

function loadFromStorage() {
  const rawTasks    = localStorage.getItem(STORAGE_KEY);
  const rawSettings = localStorage.getItem(SETTINGS_KEY);
  if (rawTasks) {
    try { tasks = JSON.parse(rawTasks).map(migrateTask); }
    catch { tasks = []; }
  }
  if (rawSettings) {
    try {
      const s = JSON.parse(rawSettings);
      autoReset     = s.autoReset     ?? false;
      lastResetDate = s.lastResetDate ?? null;
      autoResetToggle.checked = autoReset;
    } catch {}
  }
}

function migrateTask(t) {
  return {
    dueDate:           null,
    notes:             '',
    recurring:         false,
    recurringInterval: 'daily',
    recurringDays:     [],   // 曜日指定用: [0-6]の配列
    lastResetDate:     null, // タスク個別の最終リセット日
    subtasks:          [],
    ...t
  };
}

// ─────────────────────────────────────────────────────
// タスク操作
// ─────────────────────────────────────────────────────

function addTask() {
  const text = taskInput.value.trim();
  if (!text) { taskInput.focus(); return; }

  const task = {
    id:                uid(),
    text,
    priority:          prioritySelect.value,
    done:              false,
    createdAt:         new Date().toISOString(),
    dueDate:           dueDateInput.value || null,
    notes:             notesInput.value.trim(),
    recurring:         recurringToggle.checked,
    recurringInterval: recurringInterval.value,
    recurringDays:     recurringToggle.checked && recurringInterval.value === 'weekdays'
                         ? getSelectedDays(weekdayPicker)
                         : [],
    lastResetDate:     null,
    subtasks:          []
  };

  tasks.unshift(task);
  save();
  render();

  // 入力リセット
  taskInput.value    = '';
  dueDateInput.value = '';
  notesInput.value   = '';
  recurringToggle.checked = false;
  syncRecurringUI(recurringToggle, recurringInterval, weekdayPicker);
  taskInput.focus();
  showToast('タスクを追加しました', 'success');
}

function toggleTask(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  t.done = !t.done;
  save(); render();
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  expandedTasks.delete(id);
  save(); render();
  showToast('タスクを削除しました');
}

function openEditModal(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  editTarget = id;
  editInput.value           = t.text;
  editPriority.value        = t.priority;
  editDueDate.value         = t.dueDate || '';
  editRecurring.checked     = t.recurring;
  editRecurringInt.value    = t.recurringInterval;
  editNotes.value           = t.notes || '';
  applySelectedDays(editWeekdayPicker, t.recurringDays || []);
  syncRecurringUI(editRecurring, editRecurringInt, editWeekdayPicker);
  modalOverlay.classList.add('open');
  editInput.focus(); editInput.select();
}

function saveEdit() {
  const t = tasks.find(t => t.id === editTarget);
  if (!t) return;
  const newText = editInput.value.trim();
  if (!newText) return;
  t.text             = newText;
  t.priority         = editPriority.value;
  t.dueDate          = editDueDate.value || null;
  t.recurring        = editRecurring.checked;
  t.recurringInterval= editRecurringInt.value;
  t.recurringDays    = editRecurring.checked && editRecurringInt.value === 'weekdays'
                         ? getSelectedDays(editWeekdayPicker)
                         : [];
  t.notes            = editNotes.value.trim();
  save(); render();
  closeModal();
  showToast('タスクを更新しました', 'success');
}

function closeModal() {
  modalOverlay.classList.remove('open');
  editTarget = null;
}

function clearDone() {
  const n = tasks.filter(t => t.done).length;
  if (!n) { showToast('完了済みタスクがありません', 'warn'); return; }
  tasks.filter(t => t.done).forEach(t => expandedTasks.delete(t.id));
  tasks = tasks.filter(t => !t.done);
  save(); render();
  showToast(`${n}件の完了済みタスクを削除しました`);
}

function resetAll() {
  const n = tasks.filter(t => t.done).length;
  if (!n) { showToast('チェック済みタスクがありません', 'warn'); return; }
  tasks.forEach(t => t.done = false);
  save(); render();
  showToast('全チェックをリセットしました', 'success');
}

// ─────────────────────────────────────────────────────
// サブタスク
// ─────────────────────────────────────────────────────

function addSubtask(taskId, text) {
  text = text.trim();
  if (!text) return false;
  const t = tasks.find(t => t.id === taskId);
  if (!t) return false;
  t.subtasks.push({ id: uid(), text, done: false });
  save(); render();
  return true;
}

function toggleSubtask(taskId, subId) {
  const t = tasks.find(t => t.id === taskId);
  if (!t) return;
  const s = t.subtasks.find(s => s.id === subId);
  if (!s) return;
  s.done = !s.done;
  save(); render();
}

function deleteSubtask(taskId, subId) {
  const t = tasks.find(t => t.id === taskId);
  if (!t) return;
  t.subtasks = t.subtasks.filter(s => s.id !== subId);
  save(); render();
}

// ─────────────────────────────────────────────────────
// フィルター・並び替え
// ─────────────────────────────────────────────────────

function getVisibleTasks() {
  const query = searchInput.value.trim().toLowerCase();
  const today = getTodayStr();
  let result = [...tasks];

  if (query) {
    result = result.filter(t =>
      t.text.toLowerCase().includes(query) ||
      (t.notes && t.notes.toLowerCase().includes(query)) ||
      t.subtasks.some(s => s.text.toLowerCase().includes(query))
    );
  }

  switch (filter) {
    case 'done':      result = result.filter(t => t.done); break;
    case 'pending':   result = result.filter(t => !t.done); break;
    case 'overdue':   result = result.filter(t => !t.done && t.dueDate && t.dueDate < today); break;
    case 'recurring': result = result.filter(t => t.recurring); break;
  }

  return sortTasks(result);
}

function sortTasks(arr) {
  const s = sortSelect.value;
  if (s === 'default') return arr;
  const copy    = [...arr];
  const pOrder  = { high: 0, medium: 1, low: 2 };
  switch (s) {
    case 'priority': return copy.sort((a, b) => pOrder[a.priority] - pOrder[b.priority]);
    case 'dueDate':
      return copy.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    case 'name':    return copy.sort((a, b) => a.text.localeCompare(b.text, 'ja'));
    case 'created': return copy.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    default:        return arr;
  }
}

// ─────────────────────────────────────────────────────
// 繰り返しリセットロジック
// ─────────────────────────────────────────────────────

function shouldResetToday(task) {
  if (!task.recurring) return false;
  const now = new Date();
  const today = getTodayStr();

  // 既に今日リセット済みならスキップ
  if (task.lastResetDate === today) return false;

  switch (task.recurringInterval) {
    case 'daily':
      return true;

    case 'every2days': {
      // 基準日からの経過日数が2の倍数
      const base = new Date(task.createdAt || task.lastResetDate || today);
      base.setHours(0,0,0,0);
      const diff = Math.floor((new Date(today) - base) / 86400000);
      return diff % 2 === 0;
    }

    case 'every3days': {
      const base = new Date(task.createdAt || task.lastResetDate || today);
      base.setHours(0,0,0,0);
      const diff = Math.floor((new Date(today) - base) / 86400000);
      return diff % 3 === 0;
    }

    case 'weekdays': {
      const todayDay = now.getDay();
      const days = task.recurringDays || [];
      return days.includes(todayDay);
    }

    case 'monthly':
      return now.getDate() === 1;

    default:
      return true;
  }
}

function runAutoReset(silent = false) {
  let n = 0;
  const today = getTodayStr();
  tasks.forEach(t => {
    if (shouldResetToday(t)) {
      if (t.done) { t.done = false; n++; }
      t.lastResetDate = today;
    }
  });
  lastResetDate = today;
  save();
  if (n > 0) {
    render();
    if (!silent) showToast(`自動リセット完了（${n}件）`, 'success');
  }
  scheduleAutoReset();
}

function checkMissedReset() {
  if (!autoReset) return;
  const today = getTodayStr();
  if (lastResetDate !== today) {
    runAutoReset(true);
  }
}

function scheduleAutoReset() {
  if (autoResetTimer) clearTimeout(autoResetTimer);
  const now  = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 100);
  autoResetTimer = setTimeout(() => runAutoReset(false), next.getTime() - now.getTime());
  updateAutoInfo();
}

function updateAutoInfo() {
  autoInfo.style.display = autoReset ? 'flex' : 'none';
  if (!autoReset) return;
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  nextResetTime.textContent = `${next.getMonth()+1}/${next.getDate()} 0:00`;
}

// ─────────────────────────────────────────────────────
// 繰り返しUIの同期
// ─────────────────────────────────────────────────────

function syncRecurringUI(toggle, select, picker) {
  const on = toggle.checked;
  select.disabled = !on;
  select.style.opacity = on ? '1' : '0.4';
  // 曜日ピッカーの表示切替
  const showPicker = on && select.value === 'weekdays';
  picker.style.display = showPicker ? 'flex' : 'none';
}

// ─────────────────────────────────────────────────────
// 繰り返しラベル生成
// ─────────────────────────────────────────────────────

function getRecurringDisplayLabel(task) {
  const base = INTERVAL_LABEL[task.recurringInterval] || task.recurringInterval;
  if (task.recurringInterval === 'weekdays' && task.recurringDays && task.recurringDays.length > 0) {
    const names = task.recurringDays.sort((a,b)=>a-b).map(d => DAY_NAMES[d]).join('・');
    return `毎週 ${names}`;
  }
  return base;
}

// ─────────────────────────────────────────────────────
// レンダリング
// ─────────────────────────────────────────────────────

function render() {
  const today   = getTodayStr();
  const total   = tasks.length;
  const done    = tasks.filter(t => t.done).length;
  const pending = total - done;
  const overdue = tasks.filter(t => !t.done && t.dueDate && t.dueDate < today).length;

  totalCount.textContent   = total;
  doneCount.textContent    = done;
  pendingCount.textContent = pending;
  overdueCount.textContent = overdue;
  overdueCount.style.color = overdue > 0 ? 'var(--red)' : 'var(--text-muted)';
  progressFill.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';

  const visible = getVisibleTasks();
  taskList.innerHTML = '';

  if (visible.length === 0) {
    emptyState.classList.add('visible');
    const query = searchInput.value.trim();
    if (query) {
      emptyMsg.textContent    = `「${query}」に一致するタスクがありません`;
      emptySubMsg.textContent = '検索ワードを変えてみてください';
    } else {
      const msgs = {
        all:       ['タスクがありません', '上のフォームから追加してください'],
        pending:   ['未完了タスクはありません', 'すべて完了しています！'],
        done:      ['完了済みタスクはありません', 'タスクをチェックしてみましょう'],
        overdue:   ['期限超過タスクはありません', 'いいペースです！'],
        recurring: ['繰り返しタスクはありません', 'タスク追加時に繰り返しを設定できます']
      };
      const [m, s] = msgs[filter] || msgs.all;
      emptyMsg.textContent    = m;
      emptySubMsg.textContent = s;
    }
  } else {
    emptyState.classList.remove('visible');
    visible.forEach(task => taskList.appendChild(buildTaskItem(task)));
  }
}

// ─────────────────────────────────────────────────────
// タスクアイテム構築
// ─────────────────────────────────────────────────────

function el(tag, cls = '', txt = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt) e.textContent = txt;
  return e;
}

function buildTaskItem(task) {
  const today     = getTodayStr();
  const dueStatus = getDueStatus(task.dueDate);
  const isOverdue = dueStatus === 'overdue' && !task.done;

  const li = document.createElement('li');
  li.className = ['task-item', task.done ? 'done' : '', isOverdue ? 'overdue' : ''].filter(Boolean).join(' ');
  li.dataset.id = task.id;
  li.draggable  = true;

  // メイン行
  const main = el('div', 'task-main');

  const dot = el('span', `priority-dot ${task.priority}`);

  const check = document.createElement('input');
  check.type = 'checkbox'; check.className = 'task-check'; check.checked = task.done;
  check.addEventListener('change', () => toggleTask(task.id));

  const text = el('span', 'task-text', task.text);
  main.append(dot, check, text);

  // 期限バッジ
  if (task.dueDate) {
    const badge = el('span', `due-badge ${dueStatus}`);
    badge.textContent = getDueLabelText(task.dueDate);
    badge.title = task.dueDate;
    main.appendChild(badge);
  }

  // 繰り返しアイコン
  if (task.recurring) {
    const ri = el('span', 'recurring-icon', '↻');
    ri.title = `繰り返し: ${getRecurringDisplayLabel(task)}`;
    main.appendChild(ri);
  }

  // 優先度バッジ
  const pbadge = el('span', `priority-badge ${task.priority}`, PRIORITY_LABEL[task.priority] || task.priority);
  main.appendChild(pbadge);

  // アクションボタン
  const actions = el('div', 'task-actions');
  const editBtn = el('button', 'task-action-btn');
  editBtn.title = '編集'; editBtn.textContent = '✎';
  editBtn.addEventListener('click', () => openEditModal(task.id));
  const delBtn = el('button', 'task-action-btn delete');
  delBtn.title = '削除'; delBtn.textContent = '✕';
  delBtn.addEventListener('click', () => deleteTask(task.id));
  actions.append(editBtn, delBtn);
  main.appendChild(actions);

  // ドラッグハンドル
  const handle = el('span', 'drag-handle', '⋮⋮');
  handle.title = 'ドラッグで並び替え';
  main.appendChild(handle);

  li.appendChild(main);

  // メモ
  if (task.notes) {
    const na = el('div', 'task-notes-area');
    na.append(el('span', 'notes-prefix', '✎'), el('p', 'task-notes-text', task.notes));
    li.appendChild(na);
  }

  // サブタスク
  li.appendChild(buildSubtaskSection(task));

  // ドラッグイベント
  li.addEventListener('dragstart', onDragStart);
  li.addEventListener('dragover',  onDragOver);
  li.addEventListener('dragleave', onDragLeave);
  li.addEventListener('drop',      onDrop);
  li.addEventListener('dragend',   onDragEnd);

  return li;
}

function buildSubtaskSection(task) {
  const section = el('div', 'subtask-section');
  const isOpen  = expandedTasks.has(task.id);
  const total   = task.subtasks.length;
  const done    = task.subtasks.filter(s => s.done).length;

  const arrow = total > 0 ? (isOpen ? '▾' : '▸') : '▸';
  const label = total > 0 ? `${arrow} サブタスク ${done}/${total}` : `${arrow} サブタスクを追加`;
  const toggleBtn = el('button', 'subtask-toggle-btn', label);
  toggleBtn.addEventListener('click', () => {
    expandedTasks.has(task.id) ? expandedTasks.delete(task.id) : expandedTasks.add(task.id);
    render();
  });
  section.appendChild(toggleBtn);

  const area = el('div', `subtask-area${isOpen ? ' open' : ''}`);

  if (total > 0) {
    const ul = el('ul', 'subtask-list');
    task.subtasks.forEach(s => {
      const sli = el('li', `subtask-item${s.done ? ' done' : ''}`);
      const sc = document.createElement('input');
      sc.type = 'checkbox'; sc.className = 'subtask-check'; sc.checked = s.done;
      sc.addEventListener('change', () => toggleSubtask(task.id, s.id));
      const st  = el('span', 'subtask-text', s.text);
      const sd  = el('button', 'subtask-del-btn', '✕');
      sd.title = 'サブタスクを削除';
      sd.addEventListener('click', () => deleteSubtask(task.id, s.id));
      sli.append(sc, st, sd);
      ul.appendChild(sli);
    });
    area.appendChild(ul);
  }

  // サブタスク追加行
  const addRow = el('div', 'subtask-add-row');
  const inp    = el('input', 'subtask-input');
  inp.type = 'text'; inp.placeholder = 'サブタスクを追加... (Enter)'; inp.maxLength = 100;
  const addBtn2 = el('button', 'subtask-add-confirm', '+');
  addBtn2.title = '追加';

  function submit() {
    if (addSubtask(task.id, inp.value)) expandedTasks.add(task.id);
  }
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  addBtn2.addEventListener('click', submit);
  addRow.append(inp, addBtn2);
  area.appendChild(addRow);
  section.appendChild(area);

  return section;
}

// ─────────────────────────────────────────────────────
// ドラッグ＆ドロップ
// ─────────────────────────────────────────────────────

function idxById(id) { return tasks.findIndex(t => t.id === id); }

function onDragStart(e) { dragSrcIndex = idxById(this.dataset.id); this.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
function onDragOver(e)  { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; this.classList.add('drag-over'); }
function onDragLeave()  { this.classList.remove('drag-over'); }
function onDragEnd()    { this.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(e => e.classList.remove('drag-over')); dragSrcIndex = null; }

function onDrop(e) {
  e.preventDefault(); this.classList.remove('drag-over');
  const ti = idxById(this.dataset.id);
  if (dragSrcIndex === null || dragSrcIndex === ti) return;
  const [moved] = tasks.splice(dragSrcIndex, 1);
  tasks.splice(ti, 0, moved);
  save(); render();
}

// ─────────────────────────────────────────────────────
// トースト
// ─────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = '') {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  if (toastTimer) clearTimeout(toastTimer);
  t.textContent = msg;
  t.className   = `toast${type ? ' ' + type : ''}`;
  requestAnimationFrame(() => t.classList.add('show'));
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ─────────────────────────────────────────────────────
// PWA
// ─────────────────────────────────────────────────────

let deferredInstall = null;

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('[SW]', err));
    });
  }
}

// ─────────────────────────────────────────────────────
// 曜日ピッカーのクリックイベント設定
// ─────────────────────────────────────────────────────

function setupWeekdayPicker(picker) {
  picker.querySelectorAll('.weekday-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const cb = btn.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      btn.classList.toggle('selected', cb.checked);
    });
  });
}

// ─────────────────────────────────────────────────────
// イベントバインディング
// ─────────────────────────────────────────────────────

function bindEvents() {
  // タスク追加
  addBtn.addEventListener('click', addTask);
  taskInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });

  // 詳細パネル開閉
  expandInputBtn.addEventListener('click', () => {
    const isOpen = inputExtra.classList.toggle('open');
    expandInputBtn.classList.toggle('active', isOpen);
    expandInputBtn.textContent = isOpen ? '▴ 詳細を閉じる' : '▾ 詳細を開く';
  });

  // 繰り返しトグル（追加フォーム）
  recurringToggle.addEventListener('change', () => syncRecurringUI(recurringToggle, recurringInterval, weekdayPicker));
  recurringInterval.addEventListener('change', () => syncRecurringUI(recurringToggle, recurringInterval, weekdayPicker));

  // 繰り返しトグル（編集モーダル）
  editRecurring.addEventListener('change', () => syncRecurringUI(editRecurring, editRecurringInt, editWeekdayPicker));
  editRecurringInt.addEventListener('change', () => syncRecurringUI(editRecurring, editRecurringInt, editWeekdayPicker));

  // 曜日ピッカー
  setupWeekdayPicker(weekdayPicker);
  setupWeekdayPicker(editWeekdayPicker);

  // 検索
  searchInput.addEventListener('input', () => {
    clearSearch.style.display = searchInput.value ? 'block' : 'none';
    render();
  });
  clearSearch.addEventListener('click', () => {
    searchInput.value = ''; clearSearch.style.display = 'none'; render(); searchInput.focus();
  });

  // 並び替え
  sortSelect.addEventListener('change', render);

  // フィルター
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });

  // 一括操作
  clearDoneBtn.addEventListener('click', clearDone);
  resetAllBtn.addEventListener('click',  resetAll);

  // 自動リセットトグル
  autoResetToggle.addEventListener('change', () => {
    autoReset = autoResetToggle.checked;
    if (autoReset) {
      scheduleAutoReset();
    } else {
      if (autoResetTimer) clearTimeout(autoResetTimer);
      autoResetTimer = null;
    }
    updateAutoInfo(); save();
    showToast(autoReset ? '自動リセット ON（繰り返しタスク対象）' : '手動リセットに切り替えました', 'success');
  });

  // モーダル
  saveEditBtn.addEventListener('click',   saveEdit);
  cancelEditBtn.addEventListener('click', closeModal);
  modalClose.addEventListener('click',    closeModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
  editInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal(); });

  // PWAインストール
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredInstall = e; pwaInstallBtn.style.display = 'block';
  });
  pwaInstallBtn.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === 'accepted') { pwaInstallBtn.style.display = 'none'; showToast('アプリをインストールしました！', 'success'); }
    deferredInstall = null;
  });
  window.addEventListener('appinstalled', () => { pwaInstallBtn.style.display = 'none'; });
}

// ─────────────────────────────────────────────────────
// 初期化
// ─────────────────────────────────────────────────────

function init() {
  loadFromStorage();
  syncRecurringUI(recurringToggle, recurringInterval, weekdayPicker);
  syncRecurringUI(editRecurring,   editRecurringInt,  editWeekdayPicker);
  checkMissedReset();
  render();
  bindEvents();
  if (autoReset) scheduleAutoReset();
  updateAutoInfo();
  registerServiceWorker();
}

init();
