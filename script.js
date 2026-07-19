// ---------- State ----------

const STORAGE_KEY = "ledger.tasks.v1";

let tasks = loadTasks();
let currentView = "all";
let currentCategory = null; // when set, overrides view filtering by category
let searchTerm = "";
let editingId = null;

const CATEGORY_PALETTE = ["#2F6F63", "#C1503A", "#B98A2E", "#62815E", "#4B6EA8", "#8A5FA8", "#B0567C"];

// ---------- Persistence ----------

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Could not read saved tasks:", e);
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (e) {
    console.error("Could not save tasks:", e);
  }
}

// ---------- Helpers ----------

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function categoryColor(name) {
  if (!name) return "#999";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length];
}

function formatDueDate(iso) {
  if (!iso) return null;
  const due = new Date(iso + "T00:00:00");
  const today = new Date(todayISO() + "T00:00:00");
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays < 0) return due.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · overdue";
  if (diffDays > 0 && diffDays < 7) return due.toLocaleDateString(undefined, { weekday: "short" });
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isOverdue(task) {
  return task.dueDate && !task.completed && task.dueDate < todayISO();
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

// ---------- DOM refs ----------

const taskGroupsEl = document.getElementById("task-groups");
const emptyStateEl = document.getElementById("empty-state");
const emptyTextEl = document.getElementById("empty-text");
const viewTitleEl = document.getElementById("view-title");
const viewSubtitleEl = document.getElementById("view-subtitle");
const categoryListEl = document.getElementById("category-list");
const categorySuggestions = document.getElementById("category-suggestions");
const searchInput = document.getElementById("search-input");
const addForm = document.getElementById("add-form");
const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");

// ---------- Filtering ----------

function getFilteredTasks() {
  let list = tasks.slice();

  if (currentCategory) {
    list = list.filter(t => t.category === currentCategory);
  } else {
    switch (currentView) {
      case "today":
        list = list.filter(t => !t.completed && t.dueDate === todayISO());
        break;
      case "upcoming":
        list = list.filter(t => !t.completed && t.dueDate && t.dueDate > todayISO());
        break;
      case "noDate":
        list = list.filter(t => !t.completed && !t.dueDate);
        break;
      case "completed":
        list = list.filter(t => t.completed);
        break;
      default:
        list = list.filter(t => !t.completed);
    }
  }

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(t =>
      t.text.toLowerCase().includes(q) ||
      (t.category && t.category.toLowerCase().includes(q)) ||
      (t.notes && t.notes.toLowerCase().includes(q))
    );
  }

  return list;
}

function groupTasks(list) {
  // Groups only make sense for the "all" view; elsewhere return a single group.
  if (currentView !== "all" || currentCategory) {
    return [{ label: null, items: sortWithinGroup(list) }];
  }
  const groups = { overdue: [], today: [], upcoming: [], noDate: [] };
  list.forEach(t => {
    if (isOverdue(t)) groups.overdue.push(t);
    else if (t.dueDate === todayISO()) groups.today.push(t);
    else if (t.dueDate && t.dueDate > todayISO()) groups.upcoming.push(t);
    else groups.noDate.push(t);
  });
  const labeled = [
    { label: "Overdue", items: sortWithinGroup(groups.overdue) },
    { label: "Today", items: sortWithinGroup(groups.today) },
    { label: "Upcoming", items: sortWithinGroup(groups.upcoming) },
    { label: "No date", items: sortWithinGroup(groups.noDate) },
  ];
  return labeled.filter(g => g.items.length > 0);
}

function sortWithinGroup(list) {
  return list.slice().sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.createdAt - a.createdAt;
  });
}

// ---------- Rendering ----------

function render() {
  renderCounts();
  renderCategories();
  renderTitle();
  renderTaskList();
  saveTasks();
}

function renderCounts() {
  const active = tasks.filter(t => !t.completed);
  document.getElementById("count-all").textContent = active.length;
  document.getElementById("count-today").textContent = active.filter(t => t.dueDate === todayISO()).length;
  document.getElementById("count-upcoming").textContent = active.filter(t => t.dueDate && t.dueDate > todayISO()).length;
  document.getElementById("count-noDate").textContent = active.filter(t => !t.dueDate).length;
  document.getElementById("count-completed").textContent = tasks.filter(t => t.completed).length;
}

function renderCategories() {
  const counts = {};
  tasks.forEach(t => {
    if (t.category) counts[t.category] = (counts[t.category] || 0) + (t.completed ? 0 : 1);
  });
  const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));

  categorySuggestions.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">`).join("");

  if (names.length === 0) {
    categoryListEl.innerHTML = `<div class="category-empty">No categories yet</div>`;
    return;
  }

  categoryListEl.innerHTML = names.map(name => `
    <button class="category-chip ${currentCategory === name ? "active" : ""}" data-category="${escapeHtml(name)}">
      <span class="category-dot" style="background:${categoryColor(name)}"></span>
      <span>${escapeHtml(name)}</span>
      <span class="count">${counts[name]}</span>
    </button>
  `).join("");

  categoryListEl.querySelectorAll(".category-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.category;
      currentCategory = currentCategory === name ? null : name;
      if (currentCategory) {
        document.querySelectorAll(".view-btn").forEach(b => b.classList.remove("active"));
      } else {
        document.querySelector(`.view-btn[data-view="${currentView}"]`).classList.add("active");
      }
      render();
    });
  });
}

function renderTitle() {
  const titles = { all: "All tasks", today: "Today", upcoming: "Upcoming", noDate: "No date", completed: "Completed" };
  if (currentCategory) {
    viewTitleEl.textContent = currentCategory;
    viewSubtitleEl.textContent = "category";
  } else {
    viewTitleEl.textContent = titles[currentView];
    viewSubtitleEl.textContent = "";
  }
}

function renderTaskList() {
  const filtered = getFilteredTasks();
  const groups = groupTasks(filtered);
  const hasTasks = filtered.length > 0;

  taskGroupsEl.hidden = !hasTasks;
  emptyStateEl.hidden = hasTasks;

  if (!hasTasks) {
    emptyTextEl.textContent = searchTerm
      ? `No tasks match "${searchTerm}".`
      : currentView === "completed"
        ? "No completed tasks yet."
        : "Nothing here. Add a task above to get started.";
    taskGroupsEl.innerHTML = "";
    return;
  }

  taskGroupsEl.innerHTML = groups.map(group => `
    <div class="task-group">
      ${group.label ? `<div class="task-group-label">${group.label}</div>` : ""}
      <div class="task-list">
        ${group.items.map(renderTaskCard).join("")}
      </div>
    </div>
  `).join("");

  // Wire up events
  taskGroupsEl.querySelectorAll(".check-btn").forEach(btn => {
    btn.addEventListener("click", () => toggleComplete(btn.dataset.id));
  });
  taskGroupsEl.querySelectorAll(".task-main").forEach(el => {
    el.addEventListener("click", () => openEditDialog(el.dataset.id));
  });
  taskGroupsEl.querySelectorAll(".task-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteTask(btn.dataset.id);
    });
  });
}

function renderTaskCard(task) {
  const dueLabel = formatDueDate(task.dueDate);
  return `
    <div class="task-card ${task.completed ? "completed" : ""}">
      <button class="check-btn" data-id="${task.id}" aria-label="Toggle complete">
        <svg viewBox="0 0 20 20"><path d="M4 10.5 8 14.5 16 5.5" /></svg>
      </button>
      <div class="task-main" data-id="${task.id}">
        <div class="task-text">${escapeHtml(task.text)}</div>
        ${task.notes ? `<div class="task-notes">${escapeHtml(task.notes)}</div>` : ""}
        <div class="task-meta">
          ${dueLabel ? `<span class="badge badge-due ${isOverdue(task) ? "overdue" : ""}">${dueLabel}</span>` : ""}
          <span class="badge badge-priority-${task.priority}">${task.priority}</span>
          ${task.category ? `<span class="badge badge-category"><span class="category-dot" style="background:${categoryColor(task.category)}"></span>${escapeHtml(task.category)}</span>` : ""}
        </div>
      </div>
      <button class="task-delete" data-id="${task.id}" aria-label="Delete task">✕</button>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Actions ----------

function addTask({ text, dueDate, priority, category }) {
  tasks.push({
    id: uid(),
    text: text.trim(),
    notes: "",
    dueDate: dueDate || null,
    priority: priority || "medium",
    category: category ? category.trim() : "",
    completed: false,
    createdAt: Date.now(),
  });
  render();
}

function toggleComplete(id) {
  const t = tasks.find(t => t.id === id);
  if (t) t.completed = !t.completed;
  render();
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  render();
}

function updateTask(id, updates) {
  const t = tasks.find(t => t.id === id);
  if (t) Object.assign(t, updates);
  render();
}

// ---------- Edit dialog ----------

function openEditDialog(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  editingId = id;
  document.getElementById("edit-text").value = t.text;
  document.getElementById("edit-date").value = t.dueDate || "";
  document.getElementById("edit-priority").value = t.priority;
  document.getElementById("edit-category").value = t.category || "";
  document.getElementById("edit-notes").value = t.notes || "";
  editDialog.showModal();
}

editForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!editingId) return;
  updateTask(editingId, {
    text: document.getElementById("edit-text").value.trim(),
    dueDate: document.getElementById("edit-date").value || null,
    priority: document.getElementById("edit-priority").value,
    category: document.getElementById("edit-category").value.trim(),
    notes: document.getElementById("edit-notes").value.trim(),
  });
  editDialog.close();
  editingId = null;
});

document.getElementById("edit-cancel").addEventListener("click", () => {
  editDialog.close();
  editingId = null;
});

// ---------- Event wiring ----------

document.querySelectorAll(".view-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentView = btn.dataset.view;
    currentCategory = null;
    document.querySelectorAll(".view-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    render();
  });
});

searchInput.addEventListener("input", (e) => {
  searchTerm = e.target.value.trim();
  render();
});

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const textInput = document.getElementById("task-input");
  const dateInput = document.getElementById("task-date");
  const priorityInput = document.getElementById("task-priority");
  const categoryInput = document.getElementById("task-category");

  if (!textInput.value.trim()) return;

  addTask({
    text: textInput.value,
    dueDate: dateInput.value,
    priority: priorityInput.value,
    category: categoryInput.value,
  });

  textInput.value = "";
  dateInput.value = "";
  priorityInput.value = "medium";
  categoryInput.value = "";
  textInput.focus();
});

// ---------- Init ----------

document.getElementById("today-date").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long", month: "long", day: "numeric"
});

render();
