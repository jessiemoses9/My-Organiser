// ---------------------------------------------------------------
// Organiser app logic.
//
// The whole app works with one array of "task" objects, e.g.:
//   { id: "1234", text: "Book dentist", status: "todo" }
// status is always one of "todo", "waiting", "finished".
//
// Everything on screen is just a *reflection* of that array: whenever
// the array changes, we save it to localStorage and re-draw the
// columns from scratch. That "single source of truth -> re-render"
// pattern is the same idea used by bigger frameworks like React —
// you're already doing the real thing, just by hand.
// ---------------------------------------------------------------

const STORAGE_KEY = "organiser-tasks";

/** Read the saved tasks from localStorage (or return an empty list). */
function loadTasks() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("Couldn't read saved tasks, starting fresh.", err);
    return [];
  }
}

/** Save the current tasks array to localStorage. */
function saveTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// This is the in-memory copy of the data. We mutate this array, then
// call saveTasks() + render() any time it changes.
let tasks = loadTasks();

/** Create a small, good-enough-for-this-app unique id. */
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Add a new task to the "To Do" column. */
function addTask(text) {
  tasks.push({ id: makeId(), text: text.trim(), status: "todo" });
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

/** Rebuild the three columns on screen from the current `tasks` array. */
function render() {
  for (const status of ["todo", "waiting", "finished"]) {
    const container = document.getElementById(`items-${status}`);
    const countEl = document.getElementById(`count-${status}`);
    const columnTasks = tasks.filter((t) => t.status === status);

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
    tasks.length === 1 ? "1 task" : `${tasks.length} tasks`;
}

/** Build the DOM element for a single task card. */
function renderItem(task, status) {
  const item = document.createElement("div");
  item.className = `item ${status}`;

  const text = document.createElement("span");
  text.className = "item-text";
  text.textContent = task.text;
  item.appendChild(text);

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
  if (!input.value.trim()) return;
  addTask(input.value);
  input.value = "";
  input.focus();
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
