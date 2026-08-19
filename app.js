// ---------------------------------------------------------------
// "This Week" agenda logic.
//
// State lives in localStorage as three things:
//   categories: [{ id, name, color }]
//   tasks:      [{ id, text, status, categoryId, urgency, deadline,
//                  waitingOn, completedAt }]
//     status      is one of "todo", "standby", "finished"
//     urgency     is one of "high", "medium", "low"
//     deadline    is "YYYY-MM-DD" or null
//     waitingOn   free text (who you're blocked on), only meaningful
//                 while status is "standby"
//     completedAt "YYYY-MM-DD" the task was marked finished, or null.
//                 This is what lets the Finished column be viewed one
//                 week at a time — To Do and Standby always show your
//                 full current backlog regardless of which week you're
//                 looking at, since pending work shouldn't disappear
//                 just because you navigated away from today.
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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
 *  that predates this version of the app, and renaming the old "waiting"
 *  status to "standby". Finished tasks saved before completedAt existed are
 *  treated as completed today, so they don't just vanish from view. */
function loadTasks() {
  const raw = localStorage.getItem(TASKS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((task) => {
      const status = task.status === "waiting" ? "standby" : task.status;
      return {
        ...task,
        status,
        urgency: task.urgency in URGENCY_LEVELS ? task.urgency : "medium",
        deadline: task.deadline || null,
        waitingOn: task.waitingOn || "",
        completedAt: status === "finished" ? task.completedAt || todayISO() : null,
      };
    });
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
let weekOffset = 0; // 0 = this week, -1 = last week, 1 = next week, ... (not persisted)
let openDetailIds = new Set(); // which task cards have their Details panel expanded

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
    waitingOn: "",
    completedAt: null,
  });
  saveTasks(tasks);
  render();
}

/** Move an existing task to a new column, stamping/clearing completedAt as it crosses in/out of Finished. */
function moveTask(id, newStatus) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.status = newStatus;
  task.completedAt = newStatus === "finished" ? todayISO() : null;
  if (newStatus === "finished") task.waitingOn = "";
  saveTasks(tasks);
  render();
}

function setWaitingOn(id, value) {
  const task = tasks.find((t) => t.id === id);
  if (task) task.waitingOn = value.trim();
  saveTasks(tasks);
}

/** Patch arbitrary fields on a task (used by the per-card Details panel). */
function updateTask(id, patch) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  Object.assign(task, patch);
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
// "Done" isn't here any more — that's the checkbox now (see renderItem).
const COLUMN_ACTIONS = {
  todo: [{ label: "Standby →", to: "standby" }],
  standby: [{ label: "← To do", to: "todo" }],
  finished: [],
};

const EMPTY_MESSAGES = {
  todo: "Nothing to do — add something above.",
  standby: "Nothing on standby.",
  finished: "Nothing finished this week.",
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

/** Monday–Sunday range for "today plus N weeks", as both Date objects and ISO strings. */
function getWeekRange(offset) {
  const today = new Date();
  const day = today.getDay(); // 0 = Sunday, 1 = Monday, ...
  const mondayOffset = (day === 0 ? -6 : 1 - day) + offset * 7;

  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const toISO = (d) => d.toISOString().slice(0, 10);
  return { monday, sunday, mondayISO: toISO(monday), sundayISO: toISO(sunday) };
}

/** Rebuild everything on screen from the current state. */
function render() {
  renderCategorySelect();
  renderCategoryFilters();
  renderSortSelect();
  renderWeekHeader();
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

/** Show "‹ Week of 17–23 Aug ›  This Week  · 3 finished" in the header. */
function renderWeekHeader() {
  const { monday, sunday, mondayISO, sundayISO } = getWeekRange(weekOffset);

  const fmt = (d) => d.toLocaleDateString(undefined, { day: "numeric" });
  const month = (d) => d.toLocaleDateString(undefined, { month: "short" });
  const label =
    month(monday) === month(sunday)
      ? `Week of ${fmt(monday)}–${fmt(sunday)} ${month(sunday)}`
      : `Week of ${fmt(monday)} ${month(monday)} – ${fmt(sunday)} ${month(sunday)}`;

  document.getElementById("week-range").textContent = label;

  const todayBtn = document.getElementById("week-today");
  todayBtn.classList.toggle("hidden", weekOffset === 0);

  const finishedCount = tasks.filter(
    (t) => t.status === "finished" && t.completedAt >= mondayISO && t.completedAt <= sundayISO
  ).length;
  document.getElementById("week-progress").textContent =
    finishedCount === 0 ? "" : finishedCount === 1 ? "· 1 finished" : `· ${finishedCount} finished`;
}

/** Rebuild the three columns from `tasks`, honouring the active category filter, sort, and viewed week. */
function renderBoard() {
  const { mondayISO, sundayISO } = getWeekRange(weekOffset);
  const filteredTasks =
    activeFilter === "all" ? tasks : tasks.filter((t) => t.categoryId === activeFilter);

  for (const status of STATUSES) {
    const container = document.getElementById(`items-${status}`);
    const countEl = document.getElementById(`count-${status}`);

    let columnTasks = filteredTasks.filter((t) => t.status === status);
    // To Do and Standby are your live backlog — always shown in full,
    // regardless of which week you're looking at. Finished is the one
    // column that's actually scoped to the viewed week.
    if (status === "finished") {
      columnTasks = columnTasks.filter(
        (t) => t.completedAt >= mondayISO && t.completedAt <= sundayISO
      );
    }
    columnTasks = sortTasks(columnTasks, activeSort);

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

  const liveTotal =
    (activeFilter === "all" ? tasks : tasks.filter((t) => t.categoryId === activeFilter)).filter(
      (t) => t.status !== "finished"
    ).length;
  document.getElementById("task-total").textContent =
    liveTotal === 1 ? "1 open task" : `${liveTotal} open tasks`;
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

  const row = document.createElement("div");
  row.className = "item-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "item-checkbox";
  checkbox.checked = status === "finished";
  checkbox.setAttribute("aria-label", status === "finished" ? "Reopen task" : "Mark done");
  checkbox.addEventListener("change", () => {
    moveTask(task.id, checkbox.checked ? "finished" : "todo");
  });
  row.appendChild(checkbox);

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
    const todayStr = todayISO();
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

  if (status === "standby") {
    const waitingLabel = document.createElement("label");
    waitingLabel.className = "item-waiting";

    const waitingInput = document.createElement("input");
    waitingInput.type = "text";
    waitingInput.placeholder = "Waiting on...";
    waitingInput.value = task.waitingOn || "";
    waitingInput.addEventListener("change", () => setWaitingOn(task.id, waitingInput.value));
    waitingLabel.appendChild(document.createTextNode("@ "));
    waitingLabel.appendChild(waitingInput);
    main.appendChild(waitingLabel);
  } else if (status === "finished" && task.waitingOn) {
    // Shouldn't normally happen (waitingOn clears on finish), but keep it
    // visible rather than silently dropping data if it ever does.
    const waitingEl = document.createElement("span");
    waitingEl.className = "item-deadline";
    waitingEl.textContent = `@ ${task.waitingOn}`;
    main.appendChild(waitingEl);
  }

  row.appendChild(main);
  item.appendChild(row);

  const actionsRow = document.createElement("div");
  actionsRow.className = "item-actions";

  for (const action of COLUMN_ACTIONS[status]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.addEventListener("click", () => moveTask(task.id, action.to));
    actionsRow.appendChild(btn);
  }

  const isOpen = openDetailIds.has(task.id);
  const detailsToggle = document.createElement("button");
  detailsToggle.type = "button";
  detailsToggle.textContent = isOpen ? "Hide details" : "Details";
  detailsToggle.addEventListener("click", () => {
    if (isOpen) {
      openDetailIds.delete(task.id);
    } else {
      openDetailIds.add(task.id);
    }
    render();
  });
  actionsRow.appendChild(detailsToggle);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete";
  del.textContent = "✕";
  del.title = "Delete";
  del.addEventListener("click", () => deleteTask(task.id));
  actionsRow.appendChild(del);

  item.appendChild(actionsRow);

  if (isOpen) {
    item.appendChild(renderDetailsPanel(task));
  }

  return item;
}

/** The expandable "Details" panel where urgency and deadline are set per task. */
function renderDetailsPanel(task) {
  const panel = document.createElement("div");
  panel.className = "item-details";

  const urgencyLabel = document.createElement("label");
  urgencyLabel.textContent = "Urgency";
  const urgencySelect = document.createElement("select");
  for (const [id, level] of Object.entries(URGENCY_LEVELS)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = level.label;
    option.selected = task.urgency === id;
    urgencySelect.appendChild(option);
  }
  urgencySelect.addEventListener("change", () => updateTask(task.id, { urgency: urgencySelect.value }));
  urgencyLabel.appendChild(urgencySelect);
  panel.appendChild(urgencyLabel);

  const deadlineLabel = document.createElement("label");
  deadlineLabel.textContent = "Deadline";
  const deadlineInput = document.createElement("input");
  deadlineInput.type = "date";
  deadlineInput.value = task.deadline || "";
  deadlineInput.addEventListener("change", () =>
    updateTask(task.id, { deadline: deadlineInput.value || null })
  );
  deadlineLabel.appendChild(deadlineInput);
  panel.appendChild(deadlineLabel);

  return panel;
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

// --- Wire up the "Add task" form ---
// Urgency and deadline aren't collected here any more — new tasks start
// as medium/no-deadline, and can be set via each card's "Details" toggle.
document.getElementById("add-form").addEventListener("submit", (event) => {
  event.preventDefault(); // stop the page from reloading, which is a <form>'s default behaviour
  const input = document.getElementById("add-input");
  const categorySelect = document.getElementById("add-category");
  if (!input.value.trim() || !categorySelect.value) return;

  addTask(input.value, categorySelect.value, "medium", null);

  input.value = "";
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

// --- Wire up week navigation ---
document.getElementById("week-prev").addEventListener("click", () => {
  weekOffset -= 1;
  render();
});
document.getElementById("week-next").addEventListener("click", () => {
  weekOffset += 1;
  render();
});
document.getElementById("week-today").addEventListener("click", () => {
  weekOffset = 0;
  render();
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
