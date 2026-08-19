// ---------------------------------------------------------------
// "This Week" agenda logic.
//
// State lives in localStorage as three things:
//   categories: [{ id, name, color }]
//   tasks:      [{ id, text, status, categoryId, urgency, deadline }]
//     status   is one of "todo", "standby", "finished"
//     urgency  is one of "high", "medium", "low"
//     deadline is "YYYY-MM-DD" or null
//   Plus small UI preferences: which category filter and sort mode
//   are active, saved so they persist across visits.
//
// Everything on screen is just a *reflection* of that state: whenever
// it changes, we save to localStorage and re-draw from scratch.
// ---------------------------------------------------------------

const TASKS_KEY = "organiser-tasks";
const CATEGORIES_KEY = "organiser-categories";
const FILTER_KEY = "organiser-category-filter";
const SORT_KEY = "organiser-sort";

// Colours cycle through this list as new categories are added, so
// every brand/category gets a distinct tag colour automatically.
const CATEGORY_COLORS = ["#c4674f", "#8f6fae", "#4f8fc4", "#c9a63f", "#5fa89c", "#c9739a"];

const DEFAULT_CATEGORIES = [
  { id: "burberry", name: "Burberry", color: CATEGORY_COLORS[0] },
  { id: "kylie", name: "Kylie", color: CATEGORY_COLORS[1] },
  { id: "prestige", name: "Prestige", color: CATEGORY_COLORS[2] },
  { id: "admin", name: "Admin", color: CATEGORY_COLORS[3] },
  { id: "personal", name: "Personal", color: CATEGORY_COLORS[4] },
];

// Urgency is fixed (not user-editable like categories) so its colours
// can reuse the theme's existing red/amber/green palette.
const URGENCY_LEVELS = {
  high: { label: "High", color: "var(--danger)", rank: 0 },
  medium: { label: "Medium", color: "var(--amber)", rank: 1 },
  low: { label: "Low", color: "var(--finished)", rank: 2 },
};

const SORT_LABELS = {
  deadline: "Deadline",
  urgency: "Urgency",
  category: "Category",
  added: "Date added",
};

/** Create a small, good-enough-for-this-app unique id. */
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Read the saved categories from localStorage, seeding defaults on first run. */
function loadCategories() {
  const raw = localStorage.getItem(CATEGORIES_KEY);
  if (!raw) return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  } catch (err) {
    console.error("Couldn't read saved categories, using defaults.", err);
    return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  }
}

function saveCategories(list) {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(list));
}

/** Read the saved tasks from localStorage, filling in defaults for any field
 *  that predates this version of the app (e.g. tasks saved before urgency
 *  or deadline existed), and renaming the old "waiting" status to "standby". */
function loadTasks() {
  const raw = localStorage.getItem(TASKS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((task) => ({
      ...task,
      status: task.status === "waiting" ? "standby" : task.status,
      urgency: task.urgency in URGENCY_LEVELS ? task.urgency : "medium",
      deadline: task.deadline || null,
    }));
  } catch (err) {
    console.error("Couldn't read saved tasks, starting fresh.", err);
    return [];
  }
}

function saveTasks(list) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(list));
}

function loadFilter() {
  return localStorage.getItem(FILTER_KEY) || "all";
}

function saveFilter(value) {
  localStorage.setItem(FILTER_KEY, value);
}

function loadSort() {
  const saved = localStorage.getItem(SORT_KEY);
  return saved in SORT_LABELS ? saved : "deadline";
}

function saveSort(value) {
  localStorage.setItem(SORT_KEY, value);
}

// In-memory state. We mutate these, then save + render() whenever they change.
let categories = loadCategories();
let tasks = loadTasks();
let activeFilter = loadFilter(); // "all" or a category id
let activeSort = loadSort();
let manageOpen = false;

// If a task's category was deleted (or predates categories entirely),
// fall back to the first known category so it still renders sensibly.
function ensureValidCategoryIds() {
  if (!categories.length) return;
  const known = new Set(categories.map((c) => c.id));
  let changed = false;
  for (const task of tasks) {
    if (!known.has(task.categoryId)) {
      task.categoryId = categories[0].id;
      changed = true;
    }
  }
  if (changed) saveTasks(tasks);
}
ensureValidCategoryIds();

function getCategory(id) {
  return categories.find((c) => c.id === id) || categories[0];
}

/** Add a new task to the "To Do" column. */
function addTask(text, categoryId, urgency, deadline) {
  tasks.push({
    id: makeId(),
    text: text.trim(),
    status: "todo",
    categoryId,
    urgency,
    deadline: deadline || null,
  });
  saveTasks(tasks);
  render();
}

/** Move an existing task to a new column. */
function moveTask(id, newStatus) {
  const task = tasks.find((t) => t.id === id);
  if (task) task.status = newStatus;
  saveTasks(tasks);
  render();
}

/** Remove a task entirely. */
function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  saveTasks(tasks);
  render();
}

/** Add a new category, assigning it the next colour in the cycle. */
function addCategory(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  categories.push({
    id: makeId(),
    name: trimmed,
    color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length],
  });
  saveCategories(categories);
  render();
}

function renameCategory(id, name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const category = categories.find((c) => c.id === id);
  if (category) category.name = trimmed;
  saveCategories(categories);
  render();
}

/** Delete a category (must leave at least one). Its tasks fall back to the first remaining category. */
function deleteCategory(id) {
  if (categories.length <= 1) return;
  categories = categories.filter((c) => c.id !== id);
  saveCategories(categories);
  if (activeFilter === id) {
    activeFilter = "all";
    saveFilter(activeFilter);
  }
  ensureValidCategoryIds();
  render();
}

// Which button(s) each column's cards should show, and what they do.
const COLUMN_ACTIONS = {
  todo: [{ label: "Standby →", to: "standby" }, { label: "Done ✓", to: "finished" }],
  standby: [{ label: "← To do", to: "todo" }, { label: "Done ✓", to: "finished" }],
  finished: [{ label: "↩ Reopen", to: "todo" }],
};

const EMPTY_MESSAGES = {
  todo: "Nothing to do — add something above.",
  standby: "Nothing on standby.",
  finished: "Nothing finished yet.",
};

const STATUSES = ["todo", "standby", "finished"];

/** Order a list of tasks according to the active sort mode. Doesn't mutate the input. */
function sortTasks(list, sortMode) {
  const arr = [...list];

  if (sortMode === "deadline") {
    arr.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
  } else if (sortMode === "urgency") {
    arr.sort((a, b) => URGENCY_LEVELS[a.urgency].rank - URGENCY_LEVELS[b.urgency].rank);
  } else if (sortMode === "category") {
    const order = categories.map((c) => c.id);
    arr.sort((a, b) => order.indexOf(a.categoryId) - order.indexOf(b.categoryId));
  }
  // "added" (or anything else) keeps insertion order as-is.

  return arr;
}

/** Rebuild everything on screen from the current state. */
function render() {
  renderCategorySelect();
  renderCategoryFilters();
  renderSortSelect();
  renderBoard();
  renderManagePanel();
}

/** Populate the "add task" form's category dropdown. */
function renderCategorySelect() {
  const select = document.getElementById("add-category");
  const previous = select.value;
  select.innerHTML = "";
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
  }
  // Keep whatever was selected if it still exists, otherwise default to the first category.
  select.value = categories.some((c) => c.id === previous) ? previous : categories[0]?.id ?? "";
}

/** Rebuild the "All / Burberry / Kylie / ..." filter pills. */
function renderCategoryFilters() {
  const container = document.getElementById("category-filters");
  container.innerHTML = "";

  container.appendChild(makeFilterPill("all", "All", null));
  for (const category of categories) {
    container.appendChild(makeFilterPill(category.id, category.name, category.color));
  }
}

function makeFilterPill(id, label, color) {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "filter-pill" + (activeFilter === id ? " active" : "");
  if (color) {
    pill.style.setProperty("--pill-color", color);
    const dot = document.createElement("span");
    dot.className = "filter-dot";
    pill.appendChild(dot);
  }
  pill.appendChild(document.createTextNode(label));
  pill.addEventListener("click", () => {
    activeFilter = id;
    saveFilter(activeFilter);
    render();
  });
  return pill;
}

/** Sync the sort <select> with the active sort mode. */
function renderSortSelect() {
  document.getElementById("sort-select").value = activeSort;
}

/** Rebuild the three columns from `tasks`, honouring the active category filter and sort. */
function renderBoard() {
  const filteredTasks =
    activeFilter === "all" ? tasks : tasks.filter((t) => t.categoryId === activeFilter);

  for (const status of STATUSES) {
    const container = document.getElementById(`items-${status}`);
    const countEl = document.getElementById(`count-${status}`);
    const columnTasks = sortTasks(filteredTasks.filter((t) => t.status === status), activeSort);

    countEl.textContent = columnTasks.length;
    container.innerHTML = "";

    if (columnTasks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = EMPTY_MESSAGES[status];
      container.appendChild(empty);
      continue;
    }

    for (const task of columnTasks) {
      container.appendChild(renderItem(task, status));
    }
  }

  document.getElementById("task-total").textContent =
    filteredTasks.length === 1 ? "1 task" : `${filteredTasks.length} tasks`;
}

function formatDeadline(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Build the DOM element for a single task card. */
function renderItem(task, status) {
  const item = document.createElement("div");
  item.className = `item ${status}`;

  const category = getCategory(task.categoryId);
  const urgency = URGENCY_LEVELS[task.urgency];
  item.style.borderLeftColor = urgency.color;
  item.style.borderLeftWidth = "4px";

  const main = document.createElement("div");
  main.className = "item-main";

  const meta = document.createElement("div");
  meta.className = "item-meta";

  const categoryTag = document.createElement("span");
  categoryTag.className = "item-tag";
  categoryTag.style.setProperty("--tag-color", category.color);
  categoryTag.textContent = category.name;
  meta.appendChild(categoryTag);

  const urgencyTag = document.createElement("span");
  urgencyTag.className = "item-tag";
  urgencyTag.style.setProperty("--tag-color", urgency.color);
  urgencyTag.textContent = urgency.label;
  meta.appendChild(urgencyTag);

  main.appendChild(meta);

  const text = document.createElement("span");
  text.className = "item-text";
  text.textContent = task.text;
  main.appendChild(text);

  if (task.deadline) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const twoDaysStr = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const deadlineEl = document.createElement("span");
    deadlineEl.className = "item-deadline";
    if (status !== "finished" && task.deadline < todayStr) {
      deadlineEl.classList.add("overdue");
    } else if (status !== "finished" && task.deadline <= twoDaysStr) {
      deadlineEl.classList.add("due-soon");
    }
    deadlineEl.textContent = `📅 Due ${formatDeadline(task.deadline)}`;
    main.appendChild(deadlineEl);
  }

  item.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  for (const action of COLUMN_ACTIONS[status]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.addEventListener("click", () => moveTask(task.id, action.to));
    actions.appendChild(btn);
  }

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete";
  del.textContent = "✕";
  del.title = "Delete";
  del.addEventListener("click", () => deleteTask(task.id));
  actions.appendChild(del);

  item.appendChild(actions);
  return item;
}

/** Rebuild the "Manage categories" panel (rename / delete / add), if open. */
function renderManagePanel() {
  const panel = document.getElementById("manage-panel");
  const toggleBtn = document.getElementById("manage-categories-btn");
  toggleBtn.textContent = manageOpen ? "Done" : "Manage";
  panel.classList.toggle("hidden", !manageOpen);
  if (!manageOpen) {
    panel.innerHTML = "";
    return;
  }

  panel.innerHTML = "";

  for (const category of categories) {
    const row = document.createElement("div");
    row.className = "manage-row";

    const swatch = document.createElement("span");
    swatch.className = "manage-swatch";
    swatch.style.background = category.color;
    row.appendChild(swatch);

    const input = document.createElement("input");
    input.type = "text";
    input.value = category.name;
    input.addEventListener("change", () => renameCategory(category.id, input.value));
    row.appendChild(input);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "manage-delete";
    del.textContent = "✕";
    del.title = "Delete category";
    del.disabled = categories.length <= 1;
    del.addEventListener("click", () => deleteCategory(category.id));
    row.appendChild(del);

    panel.appendChild(row);
  }

  const addForm = document.createElement("form");
  addForm.className = "manage-add-form";

  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.placeholder = "New category...";
  addForm.appendChild(addInput);

  const addBtn = document.createElement("button");
  addBtn.type = "submit";
  addBtn.textContent = "Add";
  addForm.appendChild(addBtn);

  addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!addInput.value.trim()) return;
    addCategory(addInput.value);
  });

  panel.appendChild(addForm);
}

/** Show "Week of 17–23 Aug" in the header, computed from today's date. */
function renderWeekRange() {
  const today = new Date();
  const day = today.getDay(); // 0 = Sunday, 1 = Monday, ...
  const mondayOffset = day === 0 ? -6 : 1 - day;

  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = (d) => d.toLocaleDateString(undefined, { day: "numeric" });
  const month = (d) => d.toLocaleDateString(undefined, { month: "short" });

  const label =
    month(monday) === month(sunday)
      ? `Week of ${fmt(monday)}–${fmt(sunday)} ${month(sunday)}`
      : `Week of ${fmt(monday)} ${month(monday)} – ${fmt(sunday)} ${month(sunday)}`;

  document.getElementById("week-range").textContent = label;
}

// --- Wire up the "Add task" form ---
document.getElementById("add-form").addEventListener("submit", (event) => {
  event.preventDefault(); // stop the page from reloading, which is a <form>'s default behaviour
  const input = document.getElementById("add-input");
  const categorySelect = document.getElementById("add-category");
  const urgencySelect = document.getElementById("add-urgency");
  const deadlineInput = document.getElementById("add-deadline");
  if (!input.value.trim() || !categorySelect.value) return;

  addTask(input.value, categorySelect.value, urgencySelect.value, deadlineInput.value);

  input.value = "";
  urgencySelect.value = "medium";
  deadlineInput.value = "";
  input.focus();
});

// --- Wire up the sort dropdown ---
document.getElementById("sort-select").addEventListener("change", (event) => {
  activeSort = event.target.value;
  saveSort(activeSort);
  render();
});

// --- Wire up the "Manage categories" toggle ---
document.getElementById("manage-categories-btn").addEventListener("click", () => {
  manageOpen = !manageOpen;
  renderManagePanel();
});

// ---------------------------------------------------------------
// App shell: sidebar navigation between sections and the mobile
// slide-out drawer. Which section is "current" lives in the URL hash
// (e.g. #work-notes), so refreshing or sharing a link keeps you on
// the same page.
// ---------------------------------------------------------------

const SECTIONS = ["todo", "work-notes", "personal-notes", "future-me", "travel"];

function currentSection() {
  const hash = location.hash.replace("#", "");
  return SECTIONS.includes(hash) ? hash : "todo";
}

function showSection(section) {
  for (const id of SECTIONS) {
    document.getElementById(`view-${id}`).classList.toggle("active", id === section);
  }
  for (const link of document.querySelectorAll(".nav-link")) {
    link.classList.toggle("active", link.dataset.section === section);
  }
  closeSidebar();
}

window.addEventListener("hashchange", () => showSection(currentSection()));

// --- Mobile sidebar drawer ---
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const menuToggle = document.getElementById("menu-toggle");

function openSidebar() {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("open");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("open");
}

menuToggle.addEventListener("click", () => {
  sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
});
sidebarOverlay.addEventListener("click", closeSidebar);

// --- Initial paint ---
renderWeekRange();
render();
showSection(currentSection());

// --- PWA: register the service worker so the app can be installed
// and still load (from cache) with no internet connection. This is
// wrapped in a feature check because older browsers don't support it.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}
