/** Returns the static eval UI asset for a request path. */
export function staticResponse(pathname: string): { contentType: string; body: string } | undefined {
  if (pathname !== "/" && pathname !== "/index.html" && pathname !== "/app.js" && pathname !== "/styles.css") return undefined;
  if (pathname === "/app.js") return { contentType: "text/javascript; charset=utf-8", body: appJs };
  if (pathname === "/styles.css") return { contentType: "text/css; charset=utf-8", body: stylesCss };
  return { contentType: "text/html; charset=utf-8", body: indexHtml };
}

const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tangent Eval</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
`;

const stylesCss = `
:root {
  color-scheme: light;
  --bg: #f5f6f8;
  --sidebar: #fafbfc;
  --surface: #ffffff;
  --surface-2: #eef1f4;
  --surface-3: #f8fafc;
  --text: #16181d;
  --muted: #66707c;
  --line: #d6dce3;
  --accent: #2563eb;
  --accent-soft: #e8f0ff;
  --good: #0f766e;
  --good-soft: #e8f7f1;
  --bad: #b42318;
  --bad-soft: #fff0ed;
  --warn: #a15c07;
  --warn-soft: #fff7e6;
  --code-bg: #fbfcfe;
  --diff-add: #e9f8ef;
  --diff-del: #fff0ee;
  --diff-hunk: #edf5ff;
  --diff-meta: #f0f2f5;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
button, select, textarea, input { font: inherit; }
button, select { min-height: 32px; border: 1px solid var(--line); background: var(--surface); color: var(--text); border-radius: 6px; padding: 0 10px; }
button { cursor: pointer; }
button.primary { border-color: var(--accent); background: var(--accent); color: white; }
.shell { min-height: 100vh; display: grid; grid-template-columns: 280px minmax(0, 1fr); }
.sidebar { border-right: 1px solid var(--line); padding: 16px 12px; background: var(--sidebar); overflow: auto; }
.brand { font-size: 18px; font-weight: 700; margin-bottom: 16px; }
.run-list { display: grid; gap: 6px; }
.run-row { width: 100%; text-align: left; padding: 9px 10px; height: auto; border-color: transparent; background: transparent; }
.run-row:hover, .run-row.selected { background: var(--surface-2); border-color: var(--line); }
.run-name { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.run-meta, .muted { color: var(--muted); font-size: 12px; }
.main { min-width: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
.topbar { padding: 16px 22px 10px; border-bottom: 1px solid var(--line); background: rgba(245,246,248,0.94); position: sticky; top: 0; z-index: 3; backdrop-filter: blur(8px); }
.title { display: flex; gap: 12px; align-items: baseline; min-width: 0; }
.title h1 { font-size: 20px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
.cases { padding: 10px 22px; border-bottom: 1px solid var(--line); display: grid; gap: 10px; max-height: 210px; overflow: auto; background: var(--surface-3); }
.case-block { display: grid; gap: 7px; }
.case-heading { font-size: 12px; text-transform: uppercase; letter-spacing: 0; color: var(--muted); }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); font-size: 13px; vertical-align: top; }
th { background: #edf0f3; color: #343941; font-weight: 650; }
tr:last-child td { border-bottom: 0; }
tr.selected-variant td { background: #f7fbff; }
.compare { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.summary { padding: 12px 22px; background: var(--surface); border-bottom: 1px solid var(--line); display: grid; gap: 10px; }
.summary-head { display: flex; justify-content: space-between; gap: 16px; align-items: end; min-width: 0; }
.summary-title { min-width: 0; }
.summary-title h2 { margin: 2px 0 0; font-size: 16px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eyebrow { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
.phase-chip { border: 1px solid var(--line); border-radius: 999px; padding: 4px 9px; color: var(--muted); background: var(--surface-3); font-size: 12px; white-space: nowrap; }
.summary-wrap { overflow-x: auto; }
.summary-table { min-width: 680px; }
.summary-table th:first-child, .summary-table td:first-child { width: 180px; color: var(--muted); }
.metric-value { font-weight: 700; white-space: nowrap; }
.delta { font-weight: 700; white-space: nowrap; }
.delta-good { color: var(--good); background: var(--good-soft); }
.delta-bad { color: var(--bad); background: var(--bad-soft); }
.delta-neutral { color: var(--muted); }
.workspace { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); padding: 0 22px 22px; }
.tabs { display: flex; gap: 4px; padding: 12px 0 10px; overflow-x: auto; }
.tabs button.active { background: var(--accent-soft); border-color: var(--accent); }
.pane-grid { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.pane, .single-pane, .diff-pane { min-height: 0; border: 1px solid var(--line); background: var(--surface); border-radius: 6px; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.pane-title { padding: 8px 10px; border-bottom: 1px solid var(--line); background: var(--surface-3); font-weight: 650; font-size: 13px; display: flex; justify-content: space-between; gap: 8px; }
pre { margin: 0; padding: 12px; overflow: auto; white-space: pre-wrap; word-break: break-word; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.diff-code { padding: 0; background: var(--code-bg); white-space: pre; word-break: normal; line-height: 1.48; }
.diff-line { display: block; min-height: 18px; padding: 0 12px; border-left: 3px solid transparent; }
.diff-add { background: var(--diff-add); color: #14532d; border-left-color: var(--good); }
.diff-del { background: var(--diff-del); color: #7f1d1d; border-left-color: var(--bad); }
.diff-hunk { background: var(--diff-hunk); color: #1d4ed8; font-weight: 650; }
.diff-meta { background: var(--diff-meta); color: #343941; font-weight: 650; }
.diff-warn { background: var(--warn-soft); color: var(--warn); }
.single-pane { min-height: 360px; }
.files { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.file-list { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; overflow: hidden; }
.file-list h3 { margin: 0; padding: 8px 10px; font-size: 13px; background: var(--surface-3); border-bottom: 1px solid var(--line); }
.file-list ul { margin: 0; padding: 8px 10px 10px 24px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.empty { color: var(--muted); padding: 24px; }
.status-done { color: var(--good); font-weight: 650; }
.status-failed { color: var(--bad); font-weight: 650; }
.status-running, .status-prepared, .status-manual { color: var(--warn); font-weight: 650; }
@media (max-width: 900px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar { border-right: 0; border-bottom: 1px solid var(--line); max-height: 220px; }
  .summary-head { align-items: start; flex-direction: column; }
  .pane-grid, .files { grid-template-columns: 1fr; }
}
`;

const appJs = `
const state = { runs: [], run: null, selectedRunId: null, caseId: null, left: null, right: null, phase: "all", tab: "diff", comparison: null };
const app = document.getElementById("app");

async function api(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function fmtMs(ms) {
  if (ms === undefined || ms === null) return "-";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? m + "m " + String(r).padStart(2, "0") + "s" : s + "s";
}

function fmtNum(n) {
  if (n === undefined || n === null) return "-";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function fmtSignedMs(ms) {
  if (ms === undefined || ms === null) return "-";
  const sign = ms > 0 ? "+" : ms < 0 ? "-" : "";
  return sign + fmtMs(Math.abs(ms));
}

function fmtSignedNum(n) {
  if (n === undefined || n === null) return "-";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return sign + fmtNum(Math.abs(n));
}

function deltaClass(value) {
  if (value === undefined || value === null || value === 0) return "delta-neutral";
  return value < 0 ? "delta-good" : "delta-bad";
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}

async function loadRuns() {
  state.runs = await api("/api/eval/runs");
  state.selectedRunId ||= state.runs[0]?.id;
  if (state.selectedRunId) await loadRun(state.selectedRunId);
  render();
}

async function loadRun(id) {
  state.selectedRunId = id;
  state.run = await api("/api/eval/runs/" + encodeURIComponent(id));
  const firstCase = state.run.cases[0];
  state.caseId = firstCase?.caseId;
  state.left = firstCase?.variants[0]?.variantId;
  state.right = firstCase?.variants[1]?.variantId || firstCase?.variants[0]?.variantId;
  await loadComparison();
}

async function loadComparison() {
  if (!state.run || !state.caseId || !state.left || !state.right) {
    state.comparison = null;
    return;
  }
  const params = new URLSearchParams({ caseId: state.caseId, a: state.left, b: state.right, phase: state.phase });
  state.comparison = await api("/api/eval/runs/" + encodeURIComponent(state.selectedRunId) + "/compare?" + params);
}

function render() {
  app.innerHTML = '<div class="shell">' + renderSidebar() + '<main class="main">' + renderMain() + '</main></div>';
  bind();
}

function renderSidebar() {
  return '<aside class="sidebar"><div class="brand">Tangent Eval</div><div class="run-list">' + state.runs.map(run => (
    '<button class="run-row ' + (run.id === state.selectedRunId ? "selected" : "") + '" data-run="' + esc(run.id) + '">' +
    '<div class="run-name">' + esc(run.name) + '</div><div class="run-meta">' + esc(run.id) + '</div><div class="run-meta">' + run.variants + ' variants</div></button>'
  )).join("") + '</div></aside>';
}

function renderMain() {
  if (!state.run) return '<div class="empty">No eval runs found.</div>';
  return renderTopbar() + renderCases() + renderCompare();
}

function renderTopbar() {
  const variants = caseVariants();
  return '<section class="topbar"><div class="title"><h1>' + esc(state.run.run.name) + '</h1><span class="muted">' + esc(state.run.run.id) + '</span></div>' +
    '<div class="controls"><select id="case">' + state.run.cases.map(c => '<option ' + (c.caseId === state.caseId ? "selected" : "") + '>' + esc(c.caseId) + '</option>').join("") + '</select>' +
    '<select id="left">' + variants.map(v => '<option ' + (v.variantId === state.left ? "selected" : "") + '>' + esc(v.variantId) + '</option>').join("") + '</select>' +
    '<select id="right">' + variants.map(v => '<option ' + (v.variantId === state.right ? "selected" : "") + '>' + esc(v.variantId) + '</option>').join("") + '</select>' +
    '<select id="phase">' + ["all","impl","plan","context"].map(p => '<option ' + (p === state.phase ? "selected" : "") + '>' + p + '</option>').join("") + '</select>' +
    '<button class="primary" id="refresh">Refresh</button></div></section>';
}

function renderCases() {
  return '<section class="cases">' + state.run.cases.map(c => '<div class="case-block"><div class="case-heading">' + esc(c.caseId) + '</div>' + variantTable(c.variants) + '</div>').join("") + '</section>';
}

function variantTable(variants) {
  return '<table><thead><tr><th>Variant</th><th>Status</th><th>Tokens</th><th>Wall</th><th>Agent</th><th>Tools</th><th>Files</th><th>Failures</th></tr></thead><tbody>' +
    variants.map(v => '<tr class="' + (v.variantId === state.left || v.variantId === state.right ? "selected-variant" : "") + '"><td>' + esc(v.variantId) + '</td><td class="status-' + esc(v.status) + '">' + esc(v.status) + '</td><td>' + fmtNum(v.summary.tokensTotal) + '</td><td>' + fmtMs(v.summary.wallTimeMs) + '</td><td>' + fmtMs(v.summary.activeAgentTimeMs) + '</td><td>' + v.summary.toolCalls + '</td><td>' + v.summary.filesChanged + '</td><td>' + v.summary.commandFailures + '</td></tr>').join("") +
    '</tbody></table>';
}

function renderCompare() {
  const c = state.comparison;
  if (!c) return '<section class="empty">Choose two variants to compare.</section>';
  return '<section class="compare">' + renderMetrics(c) + '<div class="workspace">' + renderTabs() + renderTab(c) + '</div></section>';
}

function renderMetrics(c) {
  const rows = [
    ["Status", esc(c.left.status), esc(c.right.status), c.left.status === c.right.status ? "same" : "changed", "delta-neutral"],
    ["Wall time", fmtMs(c.left.summary.wallTimeMs), fmtMs(c.right.summary.wallTimeMs), fmtSignedMs(c.metricsDelta.wallTimeMs), deltaClass(c.metricsDelta.wallTimeMs)],
    ["Active agent", fmtMs(c.left.summary.activeAgentTimeMs), fmtMs(c.right.summary.activeAgentTimeMs), fmtSignedMs(c.metricsDelta.activeAgentTimeMs), deltaClass(c.metricsDelta.activeAgentTimeMs)],
    ["Tokens", fmtNum(c.left.summary.tokensTotal), fmtNum(c.right.summary.tokensTotal), fmtSignedNum(c.metricsDelta.tokensTotal), deltaClass(c.metricsDelta.tokensTotal)],
    ["Tool calls", String(c.left.summary.toolCalls), String(c.right.summary.toolCalls), fmtSignedNum(c.metricsDelta.toolCalls), deltaClass(c.metricsDelta.toolCalls)],
    ["Files changed", String(c.left.summary.filesChanged), String(c.right.summary.filesChanged), fmtSignedNum(c.metricsDelta.filesChanged), deltaClass(c.metricsDelta.filesChanged)],
    ["Cmd failures", String(c.left.summary.commandFailures), String(c.right.summary.commandFailures), fmtSignedNum(c.metricsDelta.commandFailures), deltaClass(c.metricsDelta.commandFailures)]
  ];
  return '<section class="summary"><div class="summary-head"><div class="summary-title"><span class="eyebrow">Selected comparison</span><h2>' + esc(c.left.variantId) + ' vs ' + esc(c.right.variantId) + '</h2></div><div class="phase-chip">' + esc(c.phase) + ' phase</div></div>' +
    '<div class="summary-wrap"><table class="summary-table"><thead><tr><th>Metric</th><th>' + esc(c.left.variantId) + '</th><th>' + esc(c.right.variantId) + '</th><th>Right - left</th></tr></thead><tbody>' +
    rows.map(([label, left, right, delta, tone]) => '<tr><td>' + esc(label) + '</td><td class="metric-value">' + left + '</td><td class="metric-value">' + right + '</td><td class="delta ' + tone + '">' + esc(delta) + '</td></tr>').join("") +
    '</tbody></table></div></section>';
}

function renderTabs() {
  const tabs = [["diff", "Code diff"], ["patches", "Patches"], ["outputs", "Outputs"], ["files", "Files"], ["warnings", "Warnings"]];
  return '<div class="tabs">' + tabs.map(([tab, label]) => '<button data-tab="' + tab + '" class="' + (state.tab === tab ? "active" : "") + '">' + label + '</button>').join("") + '</div>';
}

function renderTab(c) {
  if (state.tab === "diff") return diffPane("Candidate diff", c.git.comparisonDiff || "No candidate diff for selected phase.");
  if (state.tab === "patches") return '<div class="pane-grid">' + diffPane(c.left.variantId + " patch", c.git.leftPatch || "No patch for selected phase.") + diffPane(c.right.variantId + " patch", c.git.rightPatch || "No patch for selected phase.") + '</div>';
  if (state.tab === "files") return '<div class="files">' + fileList("Shared", c.git.changedFiles.shared) + fileList("Only left", c.git.changedFiles.onlyLeft) + fileList("Only right", c.git.changedFiles.onlyRight) + '</div>';
  if (state.tab === "warnings") return '<div class="single-pane"><div class="pane-title">Warnings</div><pre>' + esc((c.warnings || []).join("\\n") || "No warnings.") + '</pre></div>';
  return '<div class="pane-grid">' + pane(c.left.variantId, c.outputs.leftImplementation || c.outputs.leftPlan || "") + pane(c.right.variantId, c.outputs.rightImplementation || c.outputs.rightPlan || "") + '</div>';
}

function pane(title, body) {
  return '<div class="pane"><div class="pane-title"><span>' + esc(title) + '</span></div><pre>' + esc(body || "No output artifact.") + '</pre></div>';
}

function diffPane(title, body) {
  return '<div class="diff-pane"><div class="pane-title"><span>' + esc(title) + '</span></div>' + renderDiff(body) + '</div>';
}

function renderDiff(body) {
  const text = body && String(body).trim() ? String(body) : "No diff for selected phase.";
  return '<pre class="diff-code">' + text.split("\\n").map(line => '<span class="diff-line ' + diffLineClass(line) + '">' + (line ? esc(line) : " ") + '</span>').join("") + '</pre>';
}

function diffLineClass(line) {
  if (line.startsWith("diff unavailable:")) return "diff-warn";
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) return "diff-meta";
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("+")) return "diff-add";
  if (line.startsWith("-")) return "diff-del";
  return "diff-context";
}

function fileList(title, files) {
  return '<div class="file-list"><h3>' + esc(title) + '</h3><ul>' + (files.length ? files.map(file => '<li>' + esc(file) + '</li>').join("") : '<li class="muted">None</li>') + '</ul></div>';
}

function caseVariants() {
  return state.run?.cases.find(c => c.caseId === state.caseId)?.variants || [];
}

function bind() {
  document.querySelectorAll("[data-run]").forEach(button => button.addEventListener("click", async () => { await loadRun(button.dataset.run); render(); }));
  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => { state.tab = button.dataset.tab; render(); }));
  document.getElementById("case")?.addEventListener("change", async e => {
    state.caseId = e.target.value;
    const variants = caseVariants();
    state.left = variants[0]?.variantId;
    state.right = variants[1]?.variantId || variants[0]?.variantId;
    await loadComparison();
    render();
  });
  for (const id of ["left","right","phase"]) {
    document.getElementById(id)?.addEventListener("change", async e => { state[id === "phase" ? "phase" : id] = e.target.value; await loadComparison(); render(); });
  }
  document.getElementById("refresh")?.addEventListener("click", async () => { await loadRun(state.selectedRunId); render(); });
}

loadRuns().catch(error => { app.innerHTML = '<pre class="empty">' + esc(error.stack || error.message) + '</pre>'; });
`;
