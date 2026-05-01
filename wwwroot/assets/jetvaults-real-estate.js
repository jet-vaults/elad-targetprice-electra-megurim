// JetVaults Real Estate — embeddable widget. Drop this single tag anywhere
// in your page (WordPress shortcode, static HTML, etc.) and the widget
// renders in place:
//
//   <script src="https://.../app.js"
//           data-container="picuick"
//           data-project="abc-123"></script>
//
// Programmatic alternative: JetVaultsRealEstate.mount({ container, project, target })

(function (global) {
"use strict";

// Capture the script tag that loaded us, synchronously at module-load time.
// Used as the default anchor when no target is supplied — the widget renders
// right where the <script> tag lives in the document (shortcode-style embed).
const SCRIPT_EL = document.currentScript;

const DEFAULT_ACCOUNT_URL = "https://jetvaults.blob.core.windows.net";
const PROJECTS_ROOT = "real-estate-projects";
const ITEMS_PER_PAGE = 50;
const FETCH_TIMEOUT_MS = 15000;
const FILE_COLUMN = "קובץ";
const PLAN_COLUMN = "תוכנית דירה";

const G4_ID_FIELD = "__jvG4Id";
const G4_NAME_FIELD = "__jvG4Name";

// Runtime state (compatible with original project-view.js patterns).
let apartmentsData = [];
let filteredApartments = [];
let currentPage = 1;
let totalPages = 1;
let lamishtakenExists = false;
let projectG4s = [];
const itemsPerPage = ITEMS_PER_PAGE;
const DEBUG_PREFIX = "[fake-public-site]";
let debugRequestSequence = 0;
const NATURAL_LABEL_COLLATOR = new Intl.Collator("he", { numeric: true, sensitivity: "base" });

// Floor helpers (verbatim from original project-view.js) -----------------------
const FLOOR_GROUND_LABELS = new Map([
  ["קרקע", 0],
  ["ground", 0],
  ["g", 0],
  ["G", 0]
]);
const UNKNOWN_FLOOR_SORT_KEY = -1000000;

function extractFloorNumbers(label) {
  if (label == null) return [];
  const s = String(label).trim().replace(/[()]/g, "");
  const matches = s.match(/-?\d+/g);
  return matches ? matches.map((n) => parseInt(n, 10)) : [];
}

function namedFloorSortKey(label) {
  const raw = String(label == null ? "" : label).trim();
  const normalized = raw.toLowerCase();
  const exact = FLOOR_GROUND_LABELS.get(raw) ?? FLOOR_GROUND_LABELS.get(normalized);
  if (typeof exact === "number") return exact;

  const isGround = normalized.includes("קרקע") || normalized.includes("ground");
  if (!isGround) return null;
  if (normalized.includes("עליונה") || normalized.includes("upper")) return 0.5;
  if (normalized.includes("תחתונה") || normalized.includes("lower")) return -0.5;
  return 0;
}

function floorSortKey(label) {
  const nums = extractFloorNumbers(label);
  if (nums.length === 1) return nums[0];
  if (nums.length > 1) return (Math.min(...nums) + Math.max(...nums)) / 2;
  return namedFloorSortKey(label) ?? UNKNOWN_FLOOR_SORT_KEY;
}

function compareFloorLabels(a, b) {
  const ka = floorSortKey(a);
  const kb = floorSortKey(b);
  if (ka !== kb && Number.isFinite(ka - kb)) return ka - kb;
  if (Number.isFinite(ka) !== Number.isFinite(kb)) return Number.isFinite(ka) ? -1 : 1;
  const alen = extractFloorNumbers(a).length;
  const blen = extractFloorNumbers(b).length;
  if (alen !== blen) return alen - blen;
  return String(a).localeCompare(String(b), "he");
}

function compareNaturalLabels(a, b) {
  return NATURAL_LABEL_COLLATOR.compare(String(a || "").trim(), String(b || "").trim());
}

function compareApartmentRows(a, b) {
  return compareNaturalLabels(rowCell(a, JV_APARTMENT_INDEX), rowCell(b, JV_APARTMENT_INDEX));
}

function parseNumber(str) {
  if (!str) return 0;
  const num = parseFloat(String(str).replace(/[\s\u00a0,]/g, "").replace(/[^\d.-]/g, ""));
  return isNaN(num) ? 0 : num;
}

const PRICE_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatPrice(value) {
  const price = parseNumber(value);
  return price > 0 ? `₪${PRICE_FORMATTER.format(price)}` : "—";
}

function parseBooleanValue(value) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  const positiveValues = [
    "true",
    "1",
    "נמכר",
    "נמכרה",
    "כן",
    "למשתכן"
  ];
  const negativeValues = [
    "false",
    "0",
    "לא",
    "פנויה"
  ];
  if (positiveValues.includes(normalized)) return true;
  if (negativeValues.includes(normalized)) return false;
  return false;
}

const CELL_MAX_CHARS = 200;
function escapeHtml(value) {
  const raw = value == null ? "" : String(value);
  const clipped = raw.length > CELL_MAX_CHARS ? raw.slice(0, CELL_MAX_CHARS) + "…" : raw;
  return clipped
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function safeHref(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  if (/^(https?:|mailto:|tel:|\/|\.|#)/i.test(raw)) return escapeHtml(raw);
  return "";
}

function debugLog(message, details) {
  if (details !== undefined) {
    console.log(`${DEBUG_PREFIX} ${message}`, details);
    return;
  }
  console.log(`${DEBUG_PREFIX} ${message}`);
}

function debugWarn(message, details) {
  if (details !== undefined) {
    console.warn(`${DEBUG_PREFIX} ${message}`, details);
    return;
  }
  console.warn(`${DEBUG_PREFIX} ${message}`);
}

function debugError(message, details) {
  if (details !== undefined) {
    console.error(`${DEBUG_PREFIX} ${message}`, details);
    return;
  }
  console.error(`${DEBUG_PREFIX} ${message}`);
}

window.addEventListener("error", (event) => {
  debugError("window error", {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error && event.error.stack ? event.error.stack : ""
  });
});

window.addEventListener("unhandledrejection", (event) => {
  debugError("unhandled rejection", {
    reason: event.reason && event.reason.stack ? event.reason.stack : String(event.reason || "")
  });
});

// Mount + runtime scope ---------------------------------------------------------
let widgetRoot = null;
let syncQueryString = true;
let applyingQueryString = false;

function mount(options) {
  options = options || {};
  const projectId = options.project;
  if (!projectId) throw new Error("JetVaultsRealEstate.mount: project is required");

  let containerUrl;
  try {
    containerUrl = resolveContainerUrl(options);
  } catch (err) {
    throw new Error("JetVaultsRealEstate.mount: " + err.message);
  }

  const target = resolveTarget(options.target);
  syncQueryString = options.syncQueryString !== false;

  ensureStylesInjected();
  ensureDependenciesInjected();
  widgetRoot = renderSkeleton(target);

  debugLog("mount", { container: containerUrl, project: projectId, target: describeTarget(target) });

  loadProject(containerUrl, projectId).catch((err) => {
    console.error(err);
    setStatus(err && err.message ? err.message : String(err), true);
  });
}

function resolveContainerUrl(options) {
  if (options.containerUrl) {
    return normalizeAzureBlobContainerUrl(options.containerUrl);
  }
  const container = options.container;
  if (!container) throw new Error("container is required");
  if (/^https?:\/\//i.test(container)) {
    return normalizeAzureBlobContainerUrl(container);
  }
  const account = (options.accountUrl || DEFAULT_ACCOUNT_URL).replace(/\/+$/, "");
  return normalizeAzureBlobContainerUrl(`${account}/${encodeURIComponent(container)}`);
}

function resolveTarget(target) {
  if (!target) return inlineTargetFromScript() || document.body;
  if (typeof target === "string") {
    const el = document.querySelector(target);
    if (!el) throw new Error(`JetVaultsRealEstate.mount: target '${target}' not found`);
    return el;
  }
  if (target instanceof Element) return target;
  throw new Error("JetVaultsRealEstate.mount: target must be a selector or Element");
}

// For shortcode-style embeds: create a placeholder <div> right after the
// script tag that loaded us and return it. The widget renders at the exact
// spot in the host page where the <script> lives.
function inlineTargetFromScript() {
  if (!SCRIPT_EL || !SCRIPT_EL.parentNode) return null;
  const placeholder = document.createElement("div");
  placeholder.className = "jv-realestate-mount";
  SCRIPT_EL.parentNode.insertBefore(placeholder, SCRIPT_EL.nextSibling);
  return placeholder;
}

function describeTarget(target) {
  if (target === document.body) return "<body>";
  return target.id ? `#${target.id}` : target.tagName.toLowerCase();
}

const WIDGET_HTML = `
<div id="status" class="status" role="status" aria-live="polite" aria-label="Loading"><div class="jv-spinner"></div></div>
<div id="app" style="display:none;">
  <div class="view-toggle text-center mb-3">
    <button id="building-view-btn" class="btn btn-primary active mx-2 display-btn" type="button">
      <i class="fas fa-building"></i> &nbsp; לפי בניין
    </button>
    <button id="list-view-btn" class="btn btn-secondary mx-2 display-btn" type="button">
      <i class="fa-solid fa-arrow-down-wide-short"></i> &nbsp; סינון דירות
    </button>
  </div>
  <div id="building-view" class="view-section">
    <div class="row justify-content-center mb-3">
      <div class="col-md-4 col-lg-3" id="building-file-select-container" style="display:none;">
        <label for="building-file-select" class="form-label" id="g4-label-building"></label>
        <select id="building-file-select" class="form-select"></select>
      </div>
      <div class="col-md-4 col-lg-3" id="building-select-container">
        <label for="building-select" class="form-label">בניין:</label>
        <select id="building-select" class="form-select"></select>
      </div>
    </div>
    <div id="floors-container"></div>
  </div>
  <div id="list-view" class="view-section" style="display:none;">
    <div class="filters mb-3">
      <div class="row justify-content-center">
        <div class="col-md-2" id="filter-file-container" style="display:none;">
          <label for="filter-file" class="form-label" id="g4-label-filter"></label>
          <select id="filter-file" class="form-select"><option value="">הכל</option></select>
        </div>
        <div class="col-md-2" id="filter-building-container" style="display:none;">
          <label for="filter-building" class="form-label">בניין:</label>
          <select id="filter-building" class="form-select"><option value="">הכל</option></select>
        </div>
        <div class="col-md-2" id="filter-rooms-container" style="display:none;">
          <label for="filter-rooms" class="form-label">מספר חדרים:</label>
          <select id="filter-rooms" class="form-select"><option value="">הכל</option></select>
        </div>
        <div class="col-md-2" id="filter-type-container" style="display:none;">
          <label for="filter-type" class="form-label">סוג דירה:</label>
          <select id="filter-type" class="form-select"><option value="">הכל</option></select>
        </div>
        <div class="col-md-2" id="order-by-container">
          <label for="order-by" class="form-label">מיין לפי:</label>
          <select id="order-by" class="form-select">
            <option value="price_asc">מחיר - מהזול ליקר</option>
            <option value="price_desc">מחיר - מהיקר לזול</option>
            <option value="rooms_asc">חדרים - מהפחות ליותר</option>
            <option value="rooms_desc">חדרים - מהיותר לפחות</option>
            <option value="size_asc">שטח דירה - מהקטן לגדול</option>
            <option value="size_desc">שטח דירה - מהגדול לקטן</option>
          </select>
        </div>
      </div>
    </div>
    <div id="apartments-list" class="apartments-row-filter"></div>
    <nav id="pagination" aria-label="Page navigation">
      <ul class="pagination justify-content-center"></ul>
    </nav>
  </div>
</div>
<div class="modal fade" id="apartmentModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 id="apartmentModalLabel" class="modal-title">פרטי דירה</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="סגור"></button>
      </div>
      <div class="modal-body"></div>
    </div>
  </div>
</div>`;

function renderSkeleton(target) {
  const existing = target.querySelector(":scope > .jv-realestate-root");
  if (existing) existing.remove();

  const root = document.createElement("div");
  root.className = "jv-realestate-root";
  root.dir = "rtl";
  root.lang = "he";
  root.innerHTML = WIDGET_HTML;
  target.appendChild(root);
  return root;
}

function ensureDependenciesInjected() {
  const head = document.head;
  addLinkOnce(head, "jv-bootstrap", "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css");
  addLinkOnce(head, "jv-fontawesome", "https://use.fontawesome.com/releases/v6.4.0/css/all.css");
  addLinkOnce(head, "jv-google-font", "https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;700&display=swap");
  addScriptOnce(head, "jv-bootstrap-js", "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js");
}

function addLinkOnce(parent, id, href) {
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  parent.appendChild(link);
}

function addScriptOnce(parent, id, src) {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.src = src;
  script.defer = true;
  parent.appendChild(script);
}

const WIDGET_STYLES = `
:root {
  --light-color: #f8f9fa;
  --main-color: #3498db;
  --secondary-color: #2ecc71;
  --dark-color: #333;
  --danger-color: #e74c3c;
  --font-family: "Assistant", "Noto Sans Hebrew", "Segoe UI", sans-serif;
}
.jv-realestate-root, .jv-realestate-root * { font-family: var(--font-family); }
.jv-realestate-root { color: var(--dark-color); }
.jv-realestate-root .status {
  display: flex; align-items: center; justify-content: center;
  padding: 4rem 1rem; color: #777; font-size: 1rem;
  min-height: 220px; white-space: pre-wrap; overflow-wrap: anywhere;
}
.jv-realestate-root .status.error { color: var(--danger-color); }
.jv-realestate-root .jv-spinner {
  width: 44px; height: 44px;
  border: 3px solid rgba(0,0,0,0.08);
  border-top-color: var(--main-color);
  border-radius: 50%;
  animation: jv-spin 0.9s linear infinite;
}
@keyframes jv-spin { to { transform: rotate(360deg); } }
.jv-realestate-root .view-toggle {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 0.75rem;
  margin-top: 1.25rem !important;
}
.jv-realestate-root .filters { margin-bottom: 2.25rem !important; }
.jv-realestate-root #building-view > .row {
  margin-bottom: 2.25rem !important;
  row-gap: 0.75rem;
}
.jv-realestate-root .form-label { margin-top: 0.5rem; }
.jv-realestate-root .pagination {
  flex-wrap: wrap;
  --bs-pagination-color: var(--main-color) !important;
  --bs-pagination-focus-color: var(--main-color) !important;
  --bs-pagination-active-bg: var(--main-color) !important;
  --bs-pagination-active-border-color: var(--main-color) !important;
}
.jv-realestate-root .apartment-card {
  position: relative; transition: transform 0.3s, box-shadow 0.3s;
  background-color: var(--light-color); margin: 10px; padding: 15px;
  width: 290px; box-sizing: border-box; display: flex; flex-direction: column;
  justify-content: space-between; border-radius: 10px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden;
}
.jv-realestate-root .apartment-card:hover {
  transform: translateY(-5px); box-shadow: 0 6px 12px rgba(0,0,0,0.15);
}
.jv-realestate-root .apartment-card.sold { opacity: 0.7; }
.jv-realestate-root .apartment-card.sold::before {
  content: 'נמכרה'; position: absolute; top: 16px; left: -38px;
  transform: rotate(-45deg); background: var(--danger-color); color: #fff;
  padding: 5px 50px; font-weight: bold; z-index: 1; font-size: 0.9rem;
}
.jv-realestate-root .apartment-details {
  text-align: center; flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between;
}
.jv-realestate-root .apartment-details a { color: var(--main-color); text-decoration: none; }
.jv-realestate-root .apartment-title {
  font-size: 1.4rem; font-weight: bold; margin-bottom: 15px; color: var(--main-color);
}
.jv-realestate-root .apartment-info {
  font-size: 0.9rem; color: var(--dark-color); list-style: none; padding: 0; margin-bottom: 15px;
  display: flex; flex-wrap: wrap; justify-content: center; gap: 10px;
}
.jv-realestate-root .apartment-info li {
  display: flex; align-items: center; background-color: rgba(0,0,0,0.05);
  padding: 5px 10px; border-radius: 10px;
}
.jv-realestate-root .apartment-info li i { color: var(--secondary-color); margin-left: 5px; }
.jv-realestate-root .apartment-price {
  font-size: 1.3rem; font-weight: bold; color: var(--main-color); margin-bottom: 15px;
}
.jv-realestate-root .apartment-plan {
  font-weight: 700; padding: 5px 10px; margin: 0 10px -25px 10px; vertical-align: middle;
  background-color: rgba(0,0,0,0.05); border-radius: 10px;
}
.jv-realestate-root .apartment-plan div { margin-bottom: 10px; }
.jv-realestate-root .apartment-type { padding: 5px; color: var(--main-color); margin-top: -10px; font-size: 0.9rem; }
.jv-realestate-root .lamishtaken { padding: 5px; color: var(--danger-color); margin-top: -10px; font-size: 0.9rem; }
.jv-realestate-root .free-market { padding: 5px; color: grey; margin-top: -10px; font-size: 0.9rem; }
.jv-realestate-root .floor-section { margin-bottom: 30px; text-align: center; }
.jv-realestate-root .floor-title {
  background-color: var(--main-color); color: #fff; padding: 15px;
  font-size: 1.5rem; font-weight: bold; text-align: center; border-radius: 10px 10px 0 0;
}
.jv-realestate-root .apartments-row {
  display: flex; flex-wrap: wrap; justify-content: center;
  border: solid; border-color: var(--main-color); padding: 20px;
}
.jv-realestate-root .apartments-row-filter {
  display: flex; flex-wrap: wrap; justify-content: center; padding: 20px;
}
.jv-realestate-root .display-btn {
  width: 130px; padding: 10px;
  background-color: var(--light-color) !important;
  color: var(--main-color) !important;
  border-color: var(--main-color) !important;
}
.jv-realestate-root .display-btn.active {
  width: 130px; padding: 10px;
  background-color: var(--main-color) !important;
  color: var(--light-color) !important;
}
@media (max-width: 767px) {
  .jv-realestate-root .view-toggle { gap: 0.85rem; }
  .jv-realestate-root .display-btn { margin-bottom: 0.35rem; }
  .jv-realestate-root .apartment-card { width: 100%; max-width: 300px; }
}`;

function ensureStylesInjected() {
  if (document.getElementById("jv-realestate-styles")) return;
  const style = document.createElement("style");
  style.id = "jv-realestate-styles";
  style.textContent = WIDGET_STYLES;
  document.head.appendChild(style);
}

function setStatus(text, isError = false) {
  if (isError) debugError("status", text);
  else debugLog("status", text);
  const el = widgetRoot ? widgetRoot.querySelector("#status") : document.getElementById("status");
  if (!el) return;
  if (!isError) return; // keep the spinner visible during loading — no chatty progress text
  el.classList.add("error");
  el.textContent = text;
}

// Auto-mount from our own <script> tag's data attributes, if present.
// Runs synchronously so the widget renders at the exact script tag position
// (the shortcode pattern: any <script src="app.js" data-container=".."
// data-project=".."></script> turns into an in-place widget).
function tryAutoMount() {
  if (!SCRIPT_EL) return;
  const container = SCRIPT_EL.getAttribute("data-container");
  const project = SCRIPT_EL.getAttribute("data-project");
  if (!container || !project) return;
  try {
    mount({
      container,
      project,
      accountUrl: SCRIPT_EL.getAttribute("data-account-url") || undefined,
      target: SCRIPT_EL.getAttribute("data-target") || undefined,
      syncQueryString: SCRIPT_EL.getAttribute("data-sync-query") !== "false"
    });
  } catch (err) {
    console.error("[JetVaultsRealEstate] auto-mount failed", err);
  }
}

tryAutoMount();

function normalizeAzureBlobContainerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("container must be an absolute Azure Blob container URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("container must use http or https.");
  }

  if (!url.hostname.endsWith(".blob.core.windows.net")) {
    throw new Error("container must point to an Azure Blob Storage host.");
  }

  if (url.pathname.replace(/^\/+|\/+$/g, "").length === 0) {
    throw new Error("container URL must include the public container name.");
  }

  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function blobUrl(container, ...segments) {
  const path = segments
    .reduce((parts, segment) => parts.concat(String(segment).replace(/^\/+|\/+$/g, "").split("/")), [])
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${container}/${path}`;
}

function isAbsoluteUrl(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//");
}

function resolvePlanUrl(container, projectId, g4Id, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (isAbsoluteUrl(raw)) return raw;
  const fileName = raw.replace(/^.*[\\/]/, "");
  if (!fileName) return "";
  return blobUrl(container, PROJECTS_ROOT, projectId, "plans", g4Id, fileName);
}

function planColumnFor(row) {
  return Object.prototype.hasOwnProperty.call(row, PLAN_COLUMN)
    ? PLAN_COLUMN
    : Object.keys(row)[Object.keys(row).length - 1];
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveG4Id(value) {
  const raw = String(value || "").trim();
  if (!raw || isAbsoluteUrl(raw)) return "";

  const byId = projectG4s.find((g4) => g4.id === raw);
  if (byId) return byId.id;

  const normalized = normalizeText(raw);
  const byName = projectG4s.find((g4) => normalizeText(g4.name) === normalized);
  return byName ? byName.id : "";
}

function g4Options() {
  return projectG4s.map((g4) => ({ id: g4.id, name: g4.name || g4.id }));
}

function filterApartmentsByG4(g4Id, source = apartmentsData) {
  if (!g4Id) return source;
  return source.filter((apt) => apt[G4_ID_FIELD] === g4Id);
}

async function loadProject(container, projectId) {
  const projectUrl = blobUrl(container, PROJECTS_ROOT, projectId, "project.json");
  debugLog("loadProject:start", { container, projectId, projectUrl });
  setStatus(`Loading project.json from Azure...\n${projectUrl}`);
  const project = await fetchJson(projectUrl);
  debugLog("loadProject:project.json loaded", {
    g4Label: project && project.g4Label ? project.g4Label : "",
    g4Count: Array.isArray(project && project.g4s) ? project.g4s.length : 0,
    g4s: Array.isArray(project && project.g4s)
      ? project.g4s.map((g4) => ({ id: g4.id, name: g4.name }))
      : []
  });
  applyProjectTheme(project);

  // Load every g4 CSV and merge into one apartmentsData array,
  // adding a synthetic "קובץ" column with the g4's user-facing name
  // so the original UI (filters, selectors) that expects that column just works.
  const g4s = Array.isArray(project.g4s) ? project.g4s : [];
  projectG4s = g4s.map((g4) => ({ id: String(g4.id || ""), name: String(g4.name || g4.id || "") }));
  const csvTexts = [];
  for (let i = 0; i < g4s.length; i++) {
    const g4 = g4s[i];
    const csvUrl = blobUrl(container, PROJECTS_ROOT, projectId, `${g4.id}.csv`);
    debugLog("loadProject:g4 fetch start", {
      index: i + 1,
      total: g4s.length,
      g4Id: g4.id,
      g4Name: g4.name || g4.id,
      csvUrl
    });
    setStatus(`Loading G4 CSV ${i + 1} of ${g4s.length} from Azure...\n${csvUrl}`);
    try {
      const csvText = await fetchText(csvUrl);
      debugLog("loadProject:g4 fetch success", {
        index: i + 1,
        total: g4s.length,
        g4Id: g4.id,
        g4Name: g4.name || g4.id,
        chars: csvText.length
      });
      csvTexts.push(csvText);
    } catch (err) {
      debugError("loadProject:g4 fetch failed", {
        index: i + 1,
        total: g4s.length,
        g4Id: g4.id,
        g4Name: g4.name || g4.id,
        csvUrl,
        error: err && err.stack ? err.stack : String(err)
      });
      csvTexts.push("");
    }
  }

  setStatus(`Processing ${g4s.length} G4 CSV file${g4s.length === 1 ? "" : "s"}...`);
  debugLog("loadProject:processing csv texts", {
    g4Count: g4s.length,
    csvCharCounts: csvTexts.map((text) => text.length)
  });

  apartmentsData = [];
  for (let i = 0; i < g4s.length; i++) {
    const rows = parseCsv(csvTexts[i]);
    debugLog("loadProject:g4 parsed", {
      index: i + 1,
      total: g4s.length,
      g4Id: g4s[i].id,
      g4Name: g4s[i].name || g4s[i].id,
      rows: rows.length,
      firstRowKeys: rows[0] ? Object.keys(rows[0]) : [],
      firstRow: rows[0] || null
    });
    for (const row of rows) {
      const planColumn = planColumnFor(row);
      row[G4_ID_FIELD] = g4s[i].id;
      row[G4_NAME_FIELD] = g4s[i].name || g4s[i].id;
      row["קובץ"] = g4s[i].name || g4s[i].id;
      if (planColumn) {
        row[planColumn] = resolvePlanUrl(container, projectId, g4s[i].id, row[planColumn]);
      }
      apartmentsData.push(row);
    }
  }

  lamishtakenExists = apartmentsData.some((apt) => parseBooleanValue(apt["למשתכן"]));

  debugLog("loadProject:merged apartments", {
    apartments: apartmentsData.length,
    lamishtakenExists
  });
  // Show the app and hide the status line.
  document.getElementById("status").style.display = "none";
  document.getElementById("app").style.display = "";

  debugLog("loadProject:initializing ui", {
    g4Label: project.g4Label || "",
    query: window.location.search
  });
  debugLog("loadProject:initializeFilters:start", { g4Label: project.g4Label || "" });
  initializeFilters(project.g4Label);
  debugLog("loadProject:initializeFilters:done");
  debugLog("loadProject:initializeViews:start", { g4Label: project.g4Label || "" });
  applyingQueryString = true;
  try {
    initializeViews(project.g4Label);
  } finally {
    applyingQueryString = false;
  }
  debugLog("loadProject:initializeViews:done");
  debugLog("loadProject:setFiltersFromQueryString:start", { query: window.location.search });
  setFiltersFromQueryString();
  debugLog("loadProject:setFiltersFromQueryString:done");

  debugLog("loadProject:wireViewToggles:start");
  wireViewToggles();
  debugLog("loadProject:complete", {
    apartments: apartmentsData.length,
    filtered: filteredApartments.length,
    currentPage
  });
}

function applyProjectTheme(project) {
  const scope = (widgetRoot || document.documentElement).style;
  if (project.lightColor) scope.setProperty("--light-color", project.lightColor);
  if (project.mainColor) scope.setProperty("--main-color", project.mainColor);
  if (project.secondaryColor) scope.setProperty("--secondary-color", project.secondaryColor);
}

function wireViewToggles() {
  document.getElementById("building-view-btn").addEventListener("click", function () {
    showBuildingView();
    this.classList.add("btn-primary", "active");
    this.classList.remove("btn-secondary");
    document.getElementById("list-view-btn").classList.remove("btn-primary", "active");
    document.getElementById("list-view-btn").classList.add("btn-secondary");
    updateQueryString();
    const selectedBuilding = document.getElementById("building-select").value || "";
    renderBuildingView(selectedBuilding);
  });

  document.getElementById("list-view-btn").addEventListener("click", function () {
    showListView();
    this.classList.add("btn-primary", "active");
    this.classList.remove("btn-secondary");
    document.getElementById("building-view-btn").classList.remove("btn-primary", "active");
    document.getElementById("building-view-btn").classList.add("btn-secondary");
    updateQueryString();
    applyFilters();
  });

  window.addEventListener("popstate", () => setFiltersFromQueryString());
}

// Network helpers --------------------------------------------------------------
function request(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const requestId = ++debugRequestSequence;
    const startedAt = Date.now();
    let settled = false;
    let lastReadyState = 0;
    debugLog(`request:start #${requestId}`, { method, url });
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      xhr.abort();
      debugError(`request:timeout #${requestId}`, {
        method,
        url,
        elapsedMs: Date.now() - startedAt
      });
      reject(new Error(`${method} ${url} timed out after ${FETCH_TIMEOUT_MS / 1000}s`));
    }, FETCH_TIMEOUT_MS);

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      callback();
    };

    xhr.open(method, url, true);
    xhr.responseType = "text";
    xhr.onreadystatechange = () => {
      if (xhr.readyState === lastReadyState) return;
      lastReadyState = xhr.readyState;
      debugLog(`request:readyState #${requestId}`, {
        method,
        url,
        readyState: xhr.readyState,
        status: xhr.status || 0
      });
    };
    xhr.onload = () =>
      finish(() => {
        const responseText = xhr.responseText ?? "";
        debugLog(`request:load #${requestId}`, {
          method,
          url,
          status: xhr.status || 0,
          elapsedMs: Date.now() - startedAt,
          responseLength: responseText.length
        });
        resolve({ status: xhr.status || 0, text: responseText });
      });
    xhr.onerror = () =>
      finish(() => {
        debugError(`request:error #${requestId}`, {
          method,
          url,
          status: xhr.status || 0,
          elapsedMs: Date.now() - startedAt
        });
        reject(new Error(`${method} ${url} failed`));
      });
    xhr.onabort = () =>
      finish(() => {
        debugWarn(`request:abort #${requestId}`, {
          method,
          url,
          status: xhr.status || 0,
          elapsedMs: Date.now() - startedAt
        });
        reject(new Error(`${method} ${url} was aborted`));
      });
    xhr.send();
  });
}

async function requestStatus(url) {
  const response = await request(url, "HEAD");
  return response.status;
}

function requestText(url) {
  return request(url, "GET").then((response) => {
    if (response.status >= 200 && response.status < 300) {
      return response.text;
    }
    throw new Error(`GET ${url} → ${response.status}`);
  });
}

async function fetchJson(url) {
  const text = await requestText(url);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON at ${url}: ${err && err.message ? err.message : err}`);
  }
}

async function fetchText(url) {
  return requestText(url);
}

// CSV ----------------------------------------------------------------------------
function parseCsv(text) {
  if (!text) return [];
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const headers = [
    "בניין",
    "דירה",
    "סוג דירה",
    "קומה",
    "חדרים",
    "שטח דירה",
    "שטח מרפסת",
    "שטח גינה",
    "שטח מחסן",
    "כמות חניות",
    "מחיר",
    "למשתכן",
    "נמכרה",
    "תוכנית דירה"
  ];
  const lines = parseCsvRows(stripped).filter((row) => row.some((cell) => String(cell || "").trim() !== ""));
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i];
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ? values[idx].trim() : "";
    });
    out.push(row);
  }
  return out;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function updatePagination() {
  totalPages = Math.ceil(filteredApartments.length / itemsPerPage);
  const pagination = document.getElementById("pagination");
  const paginationList = pagination.querySelector(".pagination");
  paginationList.innerHTML = "";
  if (totalPages <= 1) {
    pagination.style.display = "none";
    return;
  }
  pagination.style.display = "block";

  const makePage = (label, onClick, options = {}) => {
    const li = document.createElement("li");
    li.classList.add("page-item");
    if (options.disabled) li.classList.add("disabled");
    if (options.active) li.classList.add("active");
    const a = document.createElement("a");
    a.classList.add("page-link");
    a.href = "#";
    a.innerHTML = label;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      onClick();
    });
    li.appendChild(a);
    return li;
  };

  paginationList.appendChild(
    makePage("&laquo;", () => {
      if (currentPage > 1) {
        currentPage--;
        renderListView();
        updatePagination();
        updateQueryString();
      }
    }, { disabled: currentPage === 1 })
  );
  for (let i = 1; i <= totalPages; i++) {
    paginationList.appendChild(
      makePage(String(i), () => {
        currentPage = i;
        renderListView();
        updatePagination();
        updateQueryString();
      }, { active: i === currentPage })
    );
  }
  paginationList.appendChild(
    makePage("&raquo;", () => {
      if (currentPage < totalPages) {
        currentPage++;
        renderListView();
        updatePagination();
        updateQueryString();
      }
    }, { disabled: currentPage === totalPages })
  );
}

function renderListView() {
  const apartmentsList = document.getElementById("apartments-list");
  apartmentsList.innerHTML = "";
  const startIndex = (currentPage - 1) * itemsPerPage;
  const pageApartments = filteredApartments.slice(startIndex, startIndex + itemsPerPage);
  pageApartments.forEach((apt) => apartmentsList.appendChild(createApartmentCard(apt, "fullWithFloor")));
}

function createApartmentCard(apartment, mode = "full") {
  let cardHTML = "";
  const soldClass = parseBooleanValue(apartment["נמכרה"]) ? "sold" : "";

  const rooms = escapeHtml(apartment["חדרים"]);
  const apartmentArea = escapeHtml(apartment["שטח דירה"]);
  const balconyArea = escapeHtml(apartment["שטח מרפסת"]);
  const gardenArea = escapeHtml(apartment["שטח גינה"]);
  const storageArea = escapeHtml(apartment["שטח מחסן"]);
  const apartmentNumber = escapeHtml(apartment["דירה"]);
  const apartmentType = escapeHtml(apartment["סוג דירה"]);
  const buildingLabel = escapeHtml(apartment["בניין"]);
  const floorLabel = escapeHtml(apartment["קומה"]);

  const infoBits = `
    ${apartment["חדרים"] ? `<li><i class="fas fa-bed"></i>${rooms} חדרים</li>` : ""}
    ${apartment["שטח דירה"] ? `<li><i class="fas fa-vector-square"></i>${apartmentArea} מ״ר</li>` : ""}
    ${apartment["שטח מרפסת"] > 0 ? `<li><i class="fas fa-sun"></i>${balconyArea} מ״ר מרפסת</li>` : ""}
    ${apartment["שטח גינה"] > 0 ? `<li><i class="fas fa-tree"></i>${gardenArea} מ״ר גינה</li>` : ""}
    ${apartment["שטח מחסן"] > 0 ? `<li><i class="fas fa-boxes-packing"></i>${storageArea} מ״ר מחסן</li>` : ""}
    ${apartment["כמות חניות"] ? `<li>${'<i class="fas fa-car" style="margin: 0 2px;"></i>'.repeat(Math.max(0, Math.min(20, parseInt(apartment["כמות חניות"]) || 0)))}</li>` : ""}
  `;

  const priceLine = `<div class="apartment-price">${formatPrice(apartment["מחיר"])}</div>`;

  const planHref = safeHref(apartment["תוכנית דירה"]);
  const planLink = planHref
    ? `<a href="${planHref}" target="_blank" rel="noopener noreferrer">
         <div class="apartment-plan"><div>תוכנית דירה</div></div>
       </a>`
    : "";

  const mishtaken = lamishtakenExists
    ? parseBooleanValue(apartment["למשתכן"])
      ? `<h6 class="lamishtaken">- מחיר למשתכן -</h6>`
      : `<h6 class="free-market">- שוק חופשי -</h6>`
    : "";

  if (mode === "full") {
    cardHTML = `
      <div class="apartment-card ${soldClass}">
        <div class="apartment-details">
          <h5 class="apartment-title">דירה ${apartmentNumber}</h5>
          ${apartment["סוג דירה"] ? `<h6 class="apartment-type">${apartmentType}</h6>` : ""}
          ${mishtaken}
          <ul class="apartment-info">${infoBits}</ul>
          ${priceLine}
          ${planLink}
        </div>
      </div>`;
  } else {
    cardHTML = `
      <div class="apartment-card ${soldClass}">
        ${apartment["קומה"]
          ? `<div class="floor-info" style="position:absolute;top:10px;right:10px;color:var(--main-color);font-size:0.8em;font-weight:bold;">
               <i class="fas fa-building"></i> בניין ${buildingLabel} &nbsp; &nbsp;
               <i class="fas fa-layer-group"></i> קומה ${floorLabel}
             </div>`
          : ""}
        <div class="apartment-details" style="margin-top:20px;">
          <h5 class="apartment-title">דירה ${apartmentNumber}</h5>
          ${apartment["סוג דירה"] ? `<h6 class="apartment-type">${apartmentType}</h6>` : ""}
          ${mishtaken}
          <ul class="apartment-info">${infoBits}</ul>
          ${priceLine}
          ${planLink}
        </div>
      </div>`;
  }

  const wrapper = document.createElement("div");
  wrapper.innerHTML = cardHTML.trim();
  return wrapper.firstElementChild;
}

function showBuildingView() {
  document.getElementById("building-view").style.display = "block";
  document.getElementById("list-view").style.display = "none";
}
function showListView() {
  document.getElementById("building-view").style.display = "none";
  document.getElementById("list-view").style.display = "block";
}

function initializeViews(g4Label) {
  const label = g4Label || FILE_COLUMN;
  const buildingLbl = document.getElementById("g4-label-building");
  if (buildingLbl) buildingLbl.textContent = label + ":";

  const filesList = g4Options();
  const fileSelectContainer = document.getElementById("building-file-select-container");
  const fileSelect = document.getElementById("building-file-select");
  const buildingSelect = document.getElementById("building-select");

  fileSelect.innerHTML = "";
  if (filesList.length > 1) {
    fileSelectContainer.style.display = "block";
    filesList.forEach((file) => {
      const option = document.createElement("option");
      option.value = file.name;
      option.textContent = file.name;
      fileSelect.appendChild(option);
    });
    fileSelect.addEventListener("change", () => {
      syncBuildingViewSelection(fileSelect.value || "", "");
    });
  } else {
    fileSelectContainer.style.display = "none";
  }

  syncBuildingViewSelection(fileSelect.value || "", buildingSelect.value || "");
  buildingSelect.addEventListener("change", function () {
    renderBuildingView(this.value);
  });
}

function populateBuildingSelect() {
  const buildingSelect = document.getElementById("building-select");
  const current = buildingSelect.value;
  buildingSelect.innerHTML = "";

  const fileSelect = document.getElementById("building-file-select");
  const selectedFile = fileSelect ? fileSelect.value : "";
  const apartments = filterApartmentsByG4Name(selectedFile);
  const buildings = [...new Set(apartments.map((apartment) => rowCell(apartment, JV_BUILDING_INDEX)).filter(Boolean))]
    .sort(compareNaturalLabels);

  buildings.forEach((building) => {
    const option = document.createElement("option");
    option.value = building;
    option.textContent = building;
    buildingSelect.appendChild(option);
  });

  buildingSelect.value = buildings.includes(current) ? current : buildings[0] || "";
  return buildings;
}

function renderBuildingView(selectedBuilding) {
  const floorsContainer = document.getElementById("floors-container");
  floorsContainer.innerHTML = "";

  const fileSelect = document.getElementById("building-file-select");
  const selectedFile = fileSelect ? fileSelect.value : "";
  const buildingSelect = document.getElementById("building-select");

  let apartments = filterApartmentsByG4Name(selectedFile);
  const availableBuildings = [
    ...new Set(apartments.map((apartment) => rowCell(apartment, JV_BUILDING_INDEX)).filter(Boolean))
  ].sort(compareNaturalLabels);
  const effectiveBuilding = selectedBuilding || buildingSelect?.value || availableBuildings[0] || "";

  if (buildingSelect && effectiveBuilding) {
    const exists = Array.from(buildingSelect.options).some((option) => option.value === effectiveBuilding);
    if (exists) {
      buildingSelect.value = effectiveBuilding;
    }
  }

  if (effectiveBuilding) {
    apartments = apartments.filter((apartment) => rowCell(apartment, JV_BUILDING_INDEX) === effectiveBuilding);
  }

  const apartmentsByFloor = new Map();
  apartments.forEach((apartment) => {
    const floor = String(rowCell(apartment, JV_FLOOR_INDEX)).trim();
    if (!floor) return;
    if (!apartmentsByFloor.has(floor)) {
      apartmentsByFloor.set(floor, []);
    }
    apartmentsByFloor.get(floor).push(apartment);
  });

  const floors = [...apartmentsByFloor.keys()].sort((a, b) => compareFloorLabels(b, a));
  const fragment = document.createDocumentFragment();

  floors.forEach((floor) => {
    const section = document.createElement("div");
    section.classList.add("floor-section");

    const title = document.createElement("div");
    title.classList.add("floor-title");
    title.textContent = floor;
    section.appendChild(title);

    const floorApartments = apartmentsByFloor.get(floor).sort(compareApartmentRows);

    const row = document.createElement("div");
    row.classList.add("apartments-row");
    floorApartments.forEach((apartment) => row.appendChild(createApartmentCard(apartment, "full")));
    section.appendChild(row);
    fragment.appendChild(section);
  });

  floorsContainer.appendChild(fragment);

  updateQueryString();
}

function initializeFilters(g4Label) {
  const label = g4Label || FILE_COLUMN;
  const filterLbl = document.getElementById("g4-label-filter");
  if (filterLbl) filterLbl.textContent = label + ":";

  const filesList = g4Options();
  const filterFileContainer = document.getElementById("filter-file-container");
  const filterFile = document.getElementById("filter-file");
  resetSelectWithDefault(filterFile);

  if (filesList.length > 1) {
    filterFileContainer.style.display = "block";
    filesList.forEach((file) => {
      const option = document.createElement("option");
      option.value = file.name;
      option.textContent = file.name;
      filterFile.appendChild(option);
    });
    filterFile.addEventListener("change", () => {
      currentPage = 1;
      updateFilterOptions();
      applyFilters();
    });
  } else {
    filterFileContainer.style.display = "none";
  }

  const buildings = [...new Set(apartmentsData.map((apartment) => rowCell(apartment, JV_BUILDING_INDEX)).filter(Boolean))]
    .sort(compareNaturalLabels);
  if (buildings.length > 0) {
    document.getElementById("filter-building-container").style.display = "block";
    const filterBuilding = document.getElementById("filter-building");
    resetSelectWithDefault(filterBuilding);
    buildings.forEach((building) => {
      const option = document.createElement("option");
      option.value = building;
      option.textContent = building;
      filterBuilding.appendChild(option);
    });
    filterBuilding.addEventListener("change", () => {
      currentPage = 1;
      applyFilters();
    });
  }

  const roomsList = [...new Set(apartmentsData.map((apartment) => rowCell(apartment, JV_ROOMS_INDEX)).filter(Boolean))];
  if (roomsList.length > 0) {
    document.getElementById("filter-rooms-container").style.display = "block";
    const filterRooms = document.getElementById("filter-rooms");
    resetSelectWithDefault(filterRooms);
    roomsList.forEach((rooms) => {
      const option = document.createElement("option");
      option.value = rooms;
      option.textContent = rooms;
      filterRooms.appendChild(option);
    });
    filterRooms.addEventListener("change", () => {
      currentPage = 1;
      applyFilters();
    });
  }

  const typesList = [...new Set(apartmentsData.map((apartment) => rowCell(apartment, JV_TYPE_INDEX)).filter(Boolean))];
  if (typesList.length > 0) {
    document.getElementById("filter-type-container").style.display = "block";
    const filterType = document.getElementById("filter-type");
    resetSelectWithDefault(filterType);
    typesList.forEach((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      filterType.appendChild(option);
    });
    filterType.addEventListener("change", () => {
      currentPage = 1;
      applyFilters();
    });
  }

  document.getElementById("order-by").addEventListener("change", () => {
    currentPage = 1;
    applyFilters();
  });

  updateFilterOptions();
}

function updateFilterOptions() {
  const filterFileElement = document.getElementById("filter-file");
  const filterFileValue = filterFileElement ? filterFileElement.value : "";
  const apartments = filterApartmentsByG4Name(filterFileValue);

  const filterBuilding = document.getElementById("filter-building");
  if (filterBuilding) {
    const current = filterBuilding.value;
    const buildings = [...new Set(apartments.map((apartment) => rowCell(apartment, JV_BUILDING_INDEX)).filter(Boolean))]
      .sort(compareNaturalLabels);
    resetSelectWithDefault(filterBuilding);
    buildings.forEach((building) => {
      const option = document.createElement("option");
      option.value = building;
      option.textContent = building;
      filterBuilding.appendChild(option);
    });
    setSelectValueIfPresent(filterBuilding, current);
  }

  const filterRooms = document.getElementById("filter-rooms");
  if (filterRooms) {
    const current = filterRooms.value;
    const roomsList = [...new Set(apartments.map((apartment) => rowCell(apartment, JV_ROOMS_INDEX)).filter(Boolean))];
    resetSelectWithDefault(filterRooms);
    roomsList.forEach((rooms) => {
      const option = document.createElement("option");
      option.value = rooms;
      option.textContent = rooms;
      filterRooms.appendChild(option);
    });
    setSelectValueIfPresent(filterRooms, current);
  }

  const filterType = document.getElementById("filter-type");
  if (filterType) {
    const current = filterType.value;
    const typesList = [...new Set(apartments.map((apartment) => rowCell(apartment, JV_TYPE_INDEX)).filter(Boolean))];
    resetSelectWithDefault(filterType);
    typesList.forEach((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      filterType.appendChild(option);
    });
    setSelectValueIfPresent(filterType, current);
  }
}

function applyFilters() {
  const filterBuildingElement = document.getElementById("filter-building");
  const filterRoomsElement = document.getElementById("filter-rooms");
  const filterTypeElement = document.getElementById("filter-type");
  const filterFileElement = document.getElementById("filter-file");
  const orderBy = document.getElementById("order-by").value;

  const filterBuilding = filterBuildingElement ? filterBuildingElement.value : "";
  const filterRooms = filterRoomsElement ? filterRoomsElement.value : "";
  const filterType = filterTypeElement ? filterTypeElement.value : "";
  const filterFile = filterFileElement ? filterFileElement.value : "";

  filteredApartments = apartmentsData.filter(
    (apartment) =>
      (!filterBuilding || rowCell(apartment, JV_BUILDING_INDEX) === filterBuilding) &&
      (!filterRooms || rowCell(apartment, JV_ROOMS_INDEX) === filterRooms) &&
      (!filterType || rowCell(apartment, JV_TYPE_INDEX) === filterType) &&
      (!filterFile || apartment[G4_NAME_FIELD] === filterFile)
  );

  const cmpPrice = (direction) => (a, b) => {
    const priceA = parseNumber(rowCell(a, JV_PRICE_INDEX));
    const priceB = parseNumber(rowCell(b, JV_PRICE_INDEX));
    if (isNaN(priceA) || priceA === 0) return 1;
    if (isNaN(priceB) || priceB === 0) return -1;
    return direction === "asc" ? priceA - priceB : priceB - priceA;
  };

  if (orderBy === "price_asc") {
    filteredApartments.sort(cmpPrice("asc"));
  } else if (orderBy === "price_desc") {
    filteredApartments.sort(cmpPrice("desc"));
  } else if (orderBy === "rooms_asc") {
    filteredApartments.sort((a, b) => parseNumber(rowCell(a, JV_ROOMS_INDEX)) - parseNumber(rowCell(b, JV_ROOMS_INDEX)));
  } else if (orderBy === "rooms_desc") {
    filteredApartments.sort((a, b) => parseNumber(rowCell(b, JV_ROOMS_INDEX)) - parseNumber(rowCell(a, JV_ROOMS_INDEX)));
  } else if (orderBy === "size_asc") {
    filteredApartments.sort(
      (a, b) => parseNumber(rowCell(a, JV_APARTMENT_AREA_INDEX)) - parseNumber(rowCell(b, JV_APARTMENT_AREA_INDEX))
    );
  } else if (orderBy === "size_desc") {
    filteredApartments.sort(
      (a, b) => parseNumber(rowCell(b, JV_APARTMENT_AREA_INDEX)) - parseNumber(rowCell(a, JV_APARTMENT_AREA_INDEX))
    );
  }

  updatePagination();
  renderListView();
  updateQueryString();
}

function updateQueryString() {
  if (!syncQueryString || applyingQueryString) return;
  const urlParams = new URLSearchParams(window.location.search);
  const currentView =
    document.getElementById("building-view").style.display === "none" ? "list" : "building";
  urlParams.set("view", currentView);

  if (currentView === "list") {
    urlParams.delete("bview_building");
    urlParams.delete("bview_file");

    const filterBuildingElement = document.getElementById("filter-building");
    const filterRoomsElement = document.getElementById("filter-rooms");
    const filterTypeElement = document.getElementById("filter-type");
    const filterFileElement = document.getElementById("filter-file");
    const filterBuilding = filterBuildingElement ? filterBuildingElement.value : "";
    const filterRooms = filterRoomsElement ? filterRoomsElement.value : "";
    const filterType = filterTypeElement ? filterTypeElement.value : "";
    const filterFile = filterFileElement ? filterFileElement.value : "";
    const orderBy = document.getElementById("order-by").value;

    if (filterBuilding) urlParams.set("building", filterBuilding);
    else urlParams.delete("building");

    if (filterRooms) urlParams.set("rooms", filterRooms);
    else urlParams.delete("rooms");

    if (filterType) urlParams.set("type", filterType);
    else urlParams.delete("type");

    if (filterFile) urlParams.set("file", filterFile);
    else urlParams.delete("file");

    if (orderBy) urlParams.set("orderby", orderBy);
    else urlParams.delete("orderby");

    if (currentPage > 1) urlParams.set("page", String(currentPage));
    else urlParams.delete("page");
  } else {
    urlParams.delete("building");
    urlParams.delete("rooms");
    urlParams.delete("type");
    urlParams.delete("file");
    urlParams.delete("orderby");
    urlParams.delete("page");

    const buildingFileSelect = document.getElementById("building-file-select");
    const buildingSelect = document.getElementById("building-select");
    const selectedFile = buildingFileSelect ? buildingFileSelect.value : "";
    const selectedBuilding = buildingSelect ? buildingSelect.value : "";

    if (selectedFile) urlParams.set("bview_file", selectedFile);
    else urlParams.delete("bview_file");

    if (selectedBuilding) urlParams.set("bview_building", selectedBuilding);
    else urlParams.delete("bview_building");
  }

  const nextQuery = urlParams.toString();
  const newUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
  history.replaceState(null, "", newUrl);
}

function setFiltersFromQueryString() {
  if (!syncQueryString) return;
  applyingQueryString = true;
  const urlParams = new URLSearchParams(window.location.search);
  const view = urlParams.get("view") || "building";

  try {
    if (view === "list") {
      showListView();
      document.getElementById("list-view-btn").classList.add("btn-primary", "active");
      document.getElementById("list-view-btn").classList.remove("btn-secondary");
      document.getElementById("building-view-btn").classList.remove("btn-primary", "active");
      document.getElementById("building-view-btn").classList.add("btn-secondary");

      const filterFile = document.getElementById("filter-file");
      if (filterFile) {
        setSelectValueIfPresent(filterFile, resolveG4Name(urlParams.get("file")));
        updateFilterOptions();
      }

      const filterBuilding = document.getElementById("filter-building");
      const filterRooms = document.getElementById("filter-rooms");
      const filterType = document.getElementById("filter-type");
      if (filterBuilding) setSelectValueIfPresent(filterBuilding, urlParams.get("building") || "");
      if (filterRooms) setSelectValueIfPresent(filterRooms, urlParams.get("rooms") || "");
      if (filterType) setSelectValueIfPresent(filterType, urlParams.get("type") || "");

      const orderBy = urlParams.get("orderby");
      if (orderBy) document.getElementById("order-by").value = orderBy;

      const page = parseInt(urlParams.get("page") || "", 10);
      currentPage = Number.isFinite(page) && page > 0 ? page : 1;
      applyFilters();
      return;
    }

    showBuildingView();
    document.getElementById("building-view-btn").classList.add("btn-primary", "active");
    document.getElementById("building-view-btn").classList.remove("btn-secondary");
    document.getElementById("list-view-btn").classList.remove("btn-primary", "active");
    document.getElementById("list-view-btn").classList.add("btn-secondary");

    const buildingFileSelect = document.getElementById("building-file-select");
    const buildingSelect = document.getElementById("building-select");
    const selectedG4Name = resolveG4Name(urlParams.get("bview_file"));
    const selectedBuilding = urlParams.get("bview_building") || "";

    if (buildingFileSelect && selectedG4Name) {
      setSelectValueIfPresent(buildingFileSelect, selectedG4Name);
    }

    syncBuildingViewSelection(
      buildingFileSelect ? buildingFileSelect.value || "" : "",
      buildingSelect && selectedBuilding ? selectedBuilding : ""
    );
  } finally {
    applyingQueryString = false;
  }
}

const JV_BUILDING_INDEX = 0;
const JV_APARTMENT_INDEX = 1;
const JV_TYPE_INDEX = 2;
const JV_FLOOR_INDEX = 3;
const JV_ROOMS_INDEX = 4;
const JV_APARTMENT_AREA_INDEX = 5;
const JV_PRICE_INDEX = 10;

function rowContentKeys(row) {
  return Object.keys(row).filter((key) => !key.startsWith("__"));
}

function rowCell(row, index) {
  const key = rowContentKeys(row)[index];
  return key ? row[key] : "";
}

function resolveG4Name(value) {
  const raw = String(value || "").trim();
  if (!raw || isAbsoluteUrl(raw)) return "";

  const byName = projectG4s.find((g4) => g4.name === raw);
  if (byName) return byName.name;

  const byId = projectG4s.find((g4) => g4.id === raw);
  if (byId) return byId.name;

  const normalized = normalizeText(raw);
  const byNormalizedName = projectG4s.find((g4) => normalizeText(g4.name) === normalized);
  return byNormalizedName ? byNormalizedName.name : "";
}

function filterApartmentsByG4Name(g4Name, source = apartmentsData) {
  if (!g4Name) return source;
  return source.filter((apt) => apt[G4_NAME_FIELD] === g4Name);
}

function defaultOptionLabel(select) {
  if (!select.dataset.defaultLabel) {
    select.dataset.defaultLabel = select.querySelector("option")?.textContent || "";
  }
  return select.dataset.defaultLabel;
}

function resetSelectWithDefault(select) {
  const label = defaultOptionLabel(select);
  select.innerHTML = "";
  if (label) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = label;
    select.appendChild(option);
  }
}

function setSelectValueIfPresent(select, value) {
  const normalized = String(value || "");
  const exists = Array.from(select.options).some((option) => option.value === normalized);
  select.value = exists ? normalized : "";
}

function syncBuildingViewSelection(preferredFile, preferredBuilding) {
  const buildingFileSelect = document.getElementById("building-file-select");
  const buildingSelect = document.getElementById("building-select");
  debugLog("syncBuildingViewSelection:start", {
    preferredFile,
    preferredBuilding,
    currentFile: buildingFileSelect ? buildingFileSelect.value : "",
    currentBuilding: buildingSelect ? buildingSelect.value : ""
  });

  if (buildingFileSelect && preferredFile) {
    setSelectValueIfPresent(buildingFileSelect, preferredFile);
  }

  const buildings = populateBuildingSelect();
  const nextBuilding = buildings.includes(preferredBuilding) ? preferredBuilding : buildingSelect?.value || buildings[0] || "";

  if (buildingSelect && nextBuilding) {
    setSelectValueIfPresent(buildingSelect, nextBuilding);
  }

  debugLog("syncBuildingViewSelection:resolved", {
    file: buildingFileSelect ? buildingFileSelect.value : "",
    nextBuilding,
    buildings
  });
  renderBuildingView(nextBuilding);
}


// Final debug wrappers so the live functions report their progress in DevTools.
const __debugRequestText = requestText;
requestText = function (url) {
  debugLog("requestText:start", { url });
  return __debugRequestText(url)
    .then((text) => {
      debugLog("requestText:done", {
        url,
        chars: text.length,
        preview: text.slice(0, 120)
      });
      return text;
    })
    .catch((err) => {
      debugError("requestText:failed", {
        url,
        error: err && err.stack ? err.stack : String(err)
      });
      throw err;
    });
};

const __debugFetchJson = fetchJson;
fetchJson = async function (url) {
  debugLog("fetchJson:start", { url });
  try {
    const parsed = await __debugFetchJson(url);
    debugLog("fetchJson:done", {
      url,
      keys: parsed && typeof parsed === "object" ? Object.keys(parsed) : []
    });
    return parsed;
  } catch (err) {
    debugError("fetchJson:failed", {
      url,
      error: err && err.stack ? err.stack : String(err)
    });
    throw err;
  }
};

const __debugFetchText = fetchText;
fetchText = async function (url) {
  debugLog("fetchText:start", { url });
  try {
    const text = await __debugFetchText(url);
    debugLog("fetchText:done", {
      url,
      chars: text.length,
      preview: text.slice(0, 120)
    });
    return text;
  } catch (err) {
    debugError("fetchText:failed", {
      url,
      error: err && err.stack ? err.stack : String(err)
    });
    throw err;
  }
};

const __debugParseCsv = parseCsv;
parseCsv = function (text) {
  debugLog("parseCsv:start", {
    chars: text ? text.length : 0
  });
  const rows = __debugParseCsv(text);
  debugLog("parseCsv:done", {
    rows: rows.length,
    sampleKeys: rows[0] ? Object.keys(rows[0]) : []
  });
  return rows;
};

const __debugInitializeFilters = initializeFilters;
initializeFilters = function (g4Label) {
  debugLog("initializeFilters:start", {
    g4Label: g4Label || "",
    apartments: apartmentsData.length
  });
  const result = __debugInitializeFilters(g4Label);
  debugLog("initializeFilters:done");
  return result;
};

const __debugInitializeViews = initializeViews;
initializeViews = function (g4Label) {
  debugLog("initializeViews:start", {
    g4Label: g4Label || "",
    g4Options: g4Options().map((g4) => g4.name)
  });
  const result = __debugInitializeViews(g4Label);
  debugLog("initializeViews:done");
  return result;
};

const __debugPopulateBuildingSelect = populateBuildingSelect;
populateBuildingSelect = function () {
  const selectedFile = document.getElementById("building-file-select")?.value || "";
  debugLog("populateBuildingSelect:start", { selectedFile });
  const result = __debugPopulateBuildingSelect();
  const options = Array.from(document.getElementById("building-select")?.options || []).map((option) => option.value);
  debugLog("populateBuildingSelect:done", {
    selectedFile,
    buildings: options
  });
  return result;
};

const __debugRenderBuildingView = renderBuildingView;
renderBuildingView = function (selectedBuilding) {
  const selectedFile = document.getElementById("building-file-select")?.value || "";
  debugLog("renderBuildingView:start", {
    selectedFile,
    selectedBuilding
  });
  const result = __debugRenderBuildingView(selectedBuilding);
  debugLog("renderBuildingView:done", {
    selectedFile,
    selectedBuilding,
    floorSections: document.querySelectorAll("#floors-container .floor-section").length
  });
  return result;
};

const __debugSetFiltersFromQueryString = setFiltersFromQueryString;
setFiltersFromQueryString = function () {
  debugLog("setFiltersFromQueryString:start", {
    search: window.location.search
  });
  const result = __debugSetFiltersFromQueryString();
  debugLog("setFiltersFromQueryString:done", {
    view: document.getElementById("building-view").style.display === "none" ? "list" : "building",
    file: document.getElementById("filter-file")?.value || document.getElementById("building-file-select")?.value || "",
    building: document.getElementById("filter-building")?.value || document.getElementById("building-select")?.value || ""
  });
  return result;
};

// Public API -------------------------------------------------------------------
global.JetVaultsRealEstate = { mount };

})(typeof window !== "undefined" ? window : globalThis);
