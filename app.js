// ---------------------------------------------------------------
// Organiser app logic.
//
// The whole app works with two arrays kept in localStorage:
//   categories: [{ id, name, color }]   e.g. { id: "burberry", name: "Burberry", color: "#c4674f" }
//   tasks:      [{ id, text, status, categoryId }]
// status is always one of "todo", "waiting", "finished".
//
// Everything on screen is just a *reflection* of that state: whenever
// it changes, we save to localStorage and re-draw everything from
// scratch. That "single source of truth -> re-render" pattern is the
// same idea used by bigger frameworks like React — you're already
// doing the real thing, just by hand.
// ---------------------------------------------------------------

const TASKS_KEY = "organiser-tasks";
const CATEGORIES_KEY = "organiser-categories";
const FILTER_KEY = "organiser-filter";

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

/** Read the saved tasks from localStorage (or return an empty list). */
function loadTasks() {
  const raw = localStorage.getItem(TASKS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
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

// In-memory state. We mutate these, then save + render() whenever they change.
let categories = loadCategories();
let tasks = loadTasks();
let activeFilter = loadFilter(); // "all" or a category id
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

/** Add a new task to the "To Do" column under the given category. */
function addTask(text, categoryId) {
  tasks.push({ id: makeId(), text: text.trim(), status: "todo", categoryId });
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
// This makes render() below generic instead of writing three near-
// identical blocks of HTML.
const COLUMN_ACTIONS = {
  todo: [{ label: "Start waiting →", to: "waiting" }, { label: "Done ✓", to: "finished" }],
  waiting: [{ label: "← To do", to: "todo" }, { label: "Done ✓", to: "finished" }],
  finished: [{ label: "↩ Reopen", to: "todo" }],
};

const EMPTY_MESSAGES = {
  todo: "Nothing to do — add something above.",
  waiting: "Nothing you're waiting on.",
  finished: "Nothing finished yet.",
};

/** Rebuild everything on screen from the current state. */
function render() {
  renderCategorySelect();
  renderFilters();
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
function renderFilters() {
  const container = document.getElementById("category-filters");
  container.innerHTML = "";

  const allPill = makeFilterPill("all", "All", null);
  container.appendChild(allPill);

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
  }
  if (color) {
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

/** Rebuild the three columns on screen from the current `tasks` array, honouring the active filter. */
function renderBoard() {
  const visibleTasks =
    activeFilter === "all" ? tasks : tasks.filter((t) => t.categoryId === activeFilter);

  for (const status of ["todo", "waiting", "finished"]) {
    const container = document.getElementById(`items-${status}`);
    const countEl = document.getElementById(`count-${status}`);
    const columnTasks = visibleTasks.filter((t) => t.status === status);

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
    visibleTasks.length === 1 ? "1 task" : `${visibleTasks.length} tasks`;
}

/** Build the DOM element for a single task card. */
function renderItem(task, status) {
  const item = document.createElement("div");
  item.className = `item ${status}`;

  const category = getCategory(task.categoryId);
  const tag = document.createElement("span");
  tag.className = "item-tag";
  tag.style.setProperty("--tag-color", category.color);
  tag.textContent = category.name;

  const text = document.createElement("span");
  text.className = "item-text";
  text.textContent = task.text;

  const main = document.createElement("div");
  main.className = "item-main";
  main.appendChild(tag);
  main.appendChild(text);
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
  const select = document.getElementById("add-category");
  if (!input.value.trim() || !select.value) return;
  addTask(input.value, select.value);
  input.value = "";
  input.focus();
});

// --- Wire up the "Manage categories" toggle ---
document.getElementById("manage-categories-btn").addEventListener("click", () => {
  manageOpen = !manageOpen;
  renderManagePanel();
});

// --- Initial paint ---
renderWeekRange();
render();

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
