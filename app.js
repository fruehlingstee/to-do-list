/* ===========================
   TASKS v2 — app.js
   All features:
   ・期限日   ・検索
   ・並び替え ・サブタスク
   ・繰り返し ・メモ
   ・PWA
   =========================== */

// ─────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────

let tasks         = [];
let filter        = 'all';
let autoReset     = false;
let editTarget    = null;
let autoResetTimer = null;
let dragSrcIndex  = null;
const expandedTasks = new Set(); // task IDs with subtasks expanded

const STORAGE_KEY  = 'tasks_v2';
const SETTINGS_KEY = 'tasks_settings_v2';

// ─────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const taskInput        = $('taskInput');
const prioritySelect   = $('prioritySelect');
const expandInputBtn   = $('expandInputBtn');
const inputExtra       = $('inputExtra');
const dueDateInput     = $('dueDateInput');
const recurringToggle  = $('recurringToggle');
const recurringInterval= $('recurringInterval');
const notesInput       = $('notesInput');
const addBtn           = $('addBtn');
const taskList         = $('taskList');
const emptyState       = $('emptyState');
const emptyMsg         = $('emptyMsg');
const emptySubMsg      = $('emptySubMsg');
const autoResetToggle  = $('autoResetToggle');
const autoInfo         = $('autoInfo');
const nextResetTime    = $('nextResetTime');
const clearDoneBtn     = $('clearDoneBtn');
const resetAllBtn      = $('resetAllBtn');
const filterBtns       = document.querySelectorAll('.filter-btn');
const totalCount       = $('totalCount');
const pendingCount     = $('pendingCount');
const doneCount        = $('doneCount');
const overdueCount     = $('overdueCount');
const progressFill     = $('progressFill');
const lastSaved        = $('lastSaved');
const searchInput      = $('searchInput');
const clearSearch      = $('clearSearch');
const sortSelect       = $('sortSelect');
const modalOverlay     = $('modalOverlay');
const editInput        = $('editInput');
const editPriority     = $('editPriority');
const editDueDate      = $('editDueDate');
const editRecurring    = $('editRecurring');
const editRecurringInt = $('editRecurringInterval');
const editNotes        = $('editNotes');
const saveEditBtn      = $('saveEditBtn');
const cancelEditBtn    = $('cancelEditBtn');
const modalClose       = $('modalClose');
const pwaInstallBtn    = $('pwaInstallBtn');

// ─────────────────────────────────────────────────────
// Helpers
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

function formatDueDate(dueDate) {
  const [, m, d] = dueDate.split('-');
  return `${m}/${d}`;
}

function getDueLabelText(dueDate) {
  const s = getDueStatus(dueDate);
  if (s === 'today') return '今日';
  if (s === 'overdue') {
    const diff = Math.floor((new Date(getTodayStr()) - new Date(dueDate)) / 86400000);
    return diff === 1 ? '昨日' : `${diff}日超過`;
  }
  return formatDueDate(dueDate);
}

function getRecurringLabel(interval) {
  return { daily: '毎日', weekly: '毎週月曜', monthly: '毎月1日' }[interval] || interval;
}

// ─────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────

function save() {
  localStorage.setItem(STORAGE_KEY,  JSON.stringify(tasks));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoReset }));
  const now = new Date();
  lastSaved.textContent = `saved ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
}

function loadFromStorage() {
  const rawTasks    = localStorage.getItem(STORAGE_KEY);
  const rawSettings = localStorage.getItem(SETTINGS_KEY);
  if (rawTasks) {
    try {
      const parsed = JSON.parse(rawTasks);
      tasks = parsed.map(migrateTask);
    } catch { tasks = []; }
  }
  if (rawSettings) {
    try {
      const s = JSON.parse(rawSettings);
      autoReset = s.autoReset ?? false;
      autoResetToggle.checked = autoReset;
    } catch {}
  }
}

/** Add missing fields to tasks saved by v1 */
function migrateTask(t) {
  return {
    dueDate:           null,
    notes:             '',
    recurring:         false,
    recurringInterval: 'daily',
    subtasks:          [],
    ...t
  };
}

// ─────────────────────────────────────────────────────
// Task CRUD
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
    subtasks:          []
  };

  tasks.unshift(task);
  save();
  render();

  // Reset inputs
  taskInput.value   = '';
  dueDateInput.value= '';
  notesInput.value  = '';
  recurringToggle.checked = false;
  syncRecurringInterval(recurringToggle, recurringInterval);
  taskInput.focus();
  showToast('タスクを追加しました', 'success');
}

function toggleTask(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  t.done = !t.done;
  save();
  render();
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  expandedTasks.delete(id);
  save();
  render();
  showToast('削除しました');
}

function openEditModal(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  editTarget = id;
  editInput.value            = t.text;
  editPriority.value         = t.priority;
  editDueDate.value          = t.dueDate || '';
  editRecurring.checked      = t.recurring;
  editRecurringInt.value     = t.recurringInterval;
  editNotes.value            = t.notes || '';
  syncRecurringInterval(editRecurring, editRecurringInt);
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
  t.notes            = editNotes.value.trim();
  save();
  render();
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
// Subtask CRUD
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

function toggleSubtask(taskId, subtaskId) {
  const t = tasks.find(t => t.id === taskId);
  if (!t) return;
  const s = t.subtasks.find(s => s.id === subtaskId);
  if (!s) return;
  s.done = !s.done;
  save(); render();
}

function deleteSubtask(taskId, subtaskId) {
  const t = tasks.find(t => t.id === taskId);
  if (!t) return;
  t.subtasks = t.subtasks.filter(s => s.id !== subtaskId);
  save(); render();
}

// ─────────────────────────────────────────────────────
// Filtering / Sorting
// ─────────────────────────────────────────────────────

function getVisibleTasks() {
  const query = searchInput.value.trim().toLowerCase();
  const today = getTodayStr();

  let result = [...tasks];

  // Search
  if (query) {
    result = result.filter(t =>
      t.text.toLowerCase().includes(query) ||
      (t.notes && t.notes.toLowerCase().includes(query)) ||
      t.subtasks.some(s => s.text.toLowerCase().includes(query))
    );
  }

  // Tab filter
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
  const copy = [...arr];
  const pOrder = { high: 0, medium: 1, low: 2 };
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
// Auto Reset
// ─────────────────────────────────────────────────────

function shouldResetToday(task) {
  if (!task.recurring) return false;
  const now = new Date();
  switch (task.recurringInterval) {
    case 'daily':   return true;
    case 'weekly':  return now.getDay() === 1;   // Monday
    case 'monthly': return now.getDate() === 1;  // 1st of month
    default:        return true;
  }
}

function runAutoReset() {
  let n = 0;
  tasks.forEach(t => {
    if (shouldResetToday(t) && t.done) { t.done = false; n++; }
  });
  if (n > 0) { save(); render(); showToast(`自動リセット完了（${n}件）`, 'success'); }
  scheduleAutoReset(); // reschedule for next midnight
}

function scheduleAutoReset() {
  if (autoResetTimer) clearTimeout(autoResetTimer);
  const now  = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 100);
  autoResetTimer = setTimeout(runAutoReset, next.getTime() - now.getTime());
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
// Render
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
  progressFill.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';

  // Update overdue badge color
  overdueCount.style.color = overdue > 0 ? 'var(--red)' : 'var(--text-muted)';

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
// Build task item
// ─────────────────────────────────────────────────────

function buildTaskItem(task) {
  const today     = getTodayStr();
  const dueStatus = getDueStatus(task.dueDate);
  const isOverdue = dueStatus === 'overdue' && !task.done;

  const li = document.createElement('li');
  li.className = [
    'task-item',
    task.done    ? 'done'    : '',
    isOverdue    ? 'overdue' : ''
  ].filter(Boolean).join(' ');
  li.dataset.id = task.id;
  li.draggable  = true;

  // ── Main row
  const main = document.createElement('div');
  main.className = 'task-main';

  // Priority dot
  const dot = el('span', `priority-dot ${task.priority}`);

  // Checkbox
  const check = document.createElement('input');
  check.type = 'checkbox'; check.className = 'task-check'; check.checked = task.done;
  check.addEventListener('change', () => toggleTask(task.id));

  // Text
  const text = el('span', 'task-text', task.text);

  // Due badge
  if (task.dueDate) {
    const badge = el('span', `due-badge ${dueStatus}`);
    badge.textContent = getDueLabelText(task.dueDate);
    badge.title       = task.dueDate;
    main.append(dot, check, text, badge);
  } else {
    main.append(dot, check, text);
  }

  // Recurring icon
  if (task.recurring) {
    const ri = el('span', 'recurring-icon');
    ri.textContent = '↻';
    ri.title       = `繰り返し: ${getRecurringLabel(task.recurringInterval)}`;
    main.appendChild(ri);
  }

  // Priority badge
  const badge = el('span', `priority-badge ${task.priority}`);
  badge.textContent = task.priority.toUpperCase();
  main.appendChild(badge);

  // Actions
  const actions = el('div', 'task-actions');

  const editBtn = el('button', 'task-action-btn'); editBtn.title = '編集'; editBtn.textContent = '✎';
  editBtn.addEventListener('click', () => openEditModal(task.id));

  const delBtn = el('button', 'task-action-btn delete'); delBtn.title = '削除'; delBtn.textContent = '✕';
  delBtn.addEventListener('click', () => deleteTask(task.id));

  actions.append(editBtn, delBtn);
  main.appendChild(actions);

  // Drag handle
  const handle = el('span', 'drag-handle');
  handle.textContent = '⋮⋮'; handle.title = 'ドラッグして並び替え';
  main.appendChild(handle);

  li.appendChild(main);

  // ── Notes
  if (task.notes) {
    const notesArea = el('div', 'task-notes-area');
    notesArea.append(el('span', 'notes-prefix', '✎'), el('p', 'task-notes-text', task.notes));
    li.appendChild(notesArea);
  }

  // ── Subtasks
  const sub = buildSubtaskSection(task);
  li.appendChild(sub);

  // ── Drag events
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

  // Toggle button
  const toggleBtn = el('button', 'subtask-toggle-btn');
  const arrow = total > 0 ? (isOpen ? '▾' : '▸') : '▸';
  toggleBtn.textContent = total > 0
    ? `${arrow} サブタスク ${done}/${total}`
    : `${arrow} サブタスク追加`;
  toggleBtn.addEventListener('click', () => {
    if (expandedTasks.has(task.id)) expandedTasks.delete(task.id);
    else expandedTasks.add(task.id);
    render();
  });
  section.appendChild(toggleBtn);

  // Collapsible area
  const area = el('div', `subtask-area${isOpen ? ' open' : ''}`);

  // Subtask list
  if (total > 0) {
    const ul = el('ul', 'subtask-list');
    task.subtasks.forEach(s => {
      const sli = el('li', `subtask-item${s.done ? ' done' : ''}`);

      const sc = document.createElement('input');
      sc.type = 'checkbox'; sc.className = 'subtask-check'; sc.checked = s.done;
      sc.addEventListener('change', () => toggleSubtask(task.id, s.id));

      const st = el('span', 'subtask-text', s.text);

      const sd = el('button', 'subtask-del-btn');
      sd.textContent = '✕'; sd.title = 'サブタスクを削除';
      sd.addEventListener('click', () => deleteSubtask(task.id, s.id));

      sli.append(sc, st, sd);
      ul.appendChild(sli);
    });
    area.appendChild(ul);
  }

  // Add row
  const addRow = el('div', 'subtask-add-row');
  const input  = el('input', 'subtask-input');
  input.type        = 'text';
  input.placeholder = 'サブタスクを追加... (Enter)';
  input.maxLength   = 100;

  const addSubBtn = el('button', 'subtask-add-confirm');
  addSubBtn.textContent = '+'; addSubBtn.title = '追加';

  function submitSubtask() {
    if (addSubtask(task.id, input.value)) {
      expandedTasks.add(task.id); // keep open
    }
  }

  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitSubtask(); } });
  addSubBtn.addEventListener('click', submitSubtask);

  addRow.append(input, addSubBtn);
  area.appendChild(addRow);
  section.appendChild(area);

  return section;
}

// Tiny element factory
function el(tag, className = '', text = '') {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text)      e.textContent = text;
  return e;
}

// ─────────────────────────────────────────────────────
// Drag & Drop
// ─────────────────────────────────────────────────────

function taskIndexById(id) { return tasks.findIndex(t => t.id === id); }

function onDragStart(e) {
  dragSrcIndex = taskIndexById(this.dataset.id);
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.classList.add('drag-over');
}

function onDragLeave() { this.classList.remove('drag-over'); }

function onDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  const targetIdx = taskIndexById(this.dataset.id);
  if (dragSrcIndex === null || dragSrcIndex === targetIdx) return;
  const [moved] = tasks.splice(dragSrcIndex, 1);
  tasks.splice(targetIdx, 0, moved);
  save(); render();
}

function onDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(e => e.classList.remove('drag-over'));
  dragSrcIndex = null;
}

// ─────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────

let toastTimer = null;

function showToast(msg, type = '') {
  let toast = document.querySelector('.toast');
  if (!toast) { toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast); }
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className   = `toast${type ? ' ' + type : ''}`;
  requestAnimationFrame(() => toast.classList.add('show'));
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

// ─────────────────────────────────────────────────────
// Recurring interval sync helper
// ─────────────────────────────────────────────────────

function syncRecurringInterval(toggle, select) {
  select.disabled = !toggle.checked;
  if (!toggle.checked) select.style.opacity = '0.4';
  else                  select.style.opacity = '1';
}

// ─────────────────────────────────────────────────────
// PWA
// ─────────────────────────────────────────────────────

let deferredInstall = null;

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.warn('[SW] Registration failed:', err);
      });
    });
  }
}

// ─────────────────────────────────────────────────────
// Event bindings
// ─────────────────────────────────────────────────────

function bindEvents() {
  // Add task
  addBtn.addEventListener('click', addTask);
  taskInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });

  // Expand input panel
  expandInputBtn.addEventListener('click', () => {
    const isOpen = inputExtra.classList.toggle('open');
    expandInputBtn.classList.toggle('active', isOpen);
    expandInputBtn.textContent = isOpen ? '▴ 詳細' : '▾ 詳細';
  });

  // Recurring toggle sync (add form)
  recurringToggle.addEventListener('change', () => syncRecurringInterval(recurringToggle, recurringInterval));

  // Recurring toggle sync (edit modal)
  editRecurring.addEventListener('change', () => syncRecurringInterval(editRecurring, editRecurringInt));

  // Search
  searchInput.addEventListener('input', () => {
    clearSearch.style.display = searchInput.value ? 'block' : 'none';
    render();
  });
  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    clearSearch.style.display = 'none';
    render();
    searchInput.focus();
  });

  // Sort
  sortSelect.addEventListener('change', render);

  // Filters
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });

  // Bulk actions
  clearDoneBtn.addEventListener('click', clearDone);
  resetAllBtn.addEventListener('click',  resetAll);

  // Auto reset toggle
  autoResetToggle.addEventListener('change', () => {
    autoReset = autoResetToggle.checked;
    if (autoReset) {
      scheduleAutoReset();
    } else {
      if (autoResetTimer) clearTimeout(autoResetTimer);
      autoResetTimer = null;
    }
    updateAutoInfo(); save();
    showToast(autoReset ? '自動リセット ON（繰り返しタスク対象）' : '手動リセット に切替', 'success');
  });

  // Modal
  saveEditBtn.addEventListener('click',   saveEdit);
  cancelEditBtn.addEventListener('click', closeModal);
  modalClose.addEventListener('click',    closeModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
  editInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal(); });

  // PWA install prompt
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    pwaInstallBtn.style.display = 'block';
  });

  pwaInstallBtn.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === 'accepted') {
      pwaInstallBtn.style.display = 'none';
      showToast('アプリをインストールしました！', 'success');
    }
    deferredInstall = null;
  });

  window.addEventListener('appinstalled', () => {
    pwaInstallBtn.style.display = 'none';
  });
}

// ─────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────

function init() {
  loadFromStorage();
  // Sync disabled state for recurring selects
  syncRecurringInterval(recurringToggle,  recurringInterval);
  syncRecurringInterval(editRecurring,    editRecurringInt);
  render();
  bindEvents();
  if (autoReset) scheduleAutoReset();
  updateAutoInfo();
  registerServiceWorker();
}

init();
