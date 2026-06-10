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
  --bg: #f7f7f4;
  --surface: #ffffff;
  --surface-2: #eeeeea;
  --text: #171717;
  --muted: #666660;
  --line: #d8d8d1;
  --accent: #0f766e;
  --accent-soft: #d8f2ed;
  --bad: #a33b2f;
  --warn: #936d12;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
button, select, textarea, input { font: inherit; }
button, select { min-height: 32px; border: 1px solid var(--line); background: var(--surface); color: var(--text); border-radius: 6px; padding: 0 10px; }
button { cursor: pointer; }
button.primary { border-color: var(--accent); background: var(--accent); color: white; }
.shell { min-height: 100vh; display: grid; grid-template-columns: 300px minmax(0, 1fr); }
.sidebar { border-right: 1px solid var(--line); padding: 18px 14px; background: #fbfbf8; overflow: auto; }
.brand { font-size: 18px; font-weight: 700; margin-bottom: 16px; }
.run-list { display: grid; gap: 6px; }
.run-row { width: 100%; text-align: left; padding: 9px 10px; height: auto; border-color: transparent; background: transparent; }
.run-row:hover, .run-row.selected { background: var(--surface-2); border-color: var(--line); }
.run-name { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.run-meta, .muted { color: var(--muted); font-size: 12px; }
.main { min-width: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
.topbar { padding: 18px 22px 10px; border-bottom: 1px solid var(--line); background: rgba(247,247,244,0.92); position: sticky; top: 0; z-index: 3; }
.title { display: flex; gap: 12px; align-items: baseline; min-width: 0; }
.title h1 { font-size: 20px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
.cases { padding: 12px 22px; border-bottom: 1px solid var(--line); display: grid; gap: 12px; }
.case-block { display: grid; gap: 7px; }
.case-heading { font-size: 12px; text-transform: uppercase; letter-spacing: 0; color: var(--muted); }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); font-size: 13px; vertical-align: top; }
th { background: #f0f0eb; color: #3b3b36; font-weight: 650; }
tr:last-child td { border-bottom: 0; }
.compare { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.metrics { padding: 12px 22px; display: grid; grid-template-columns: repeat(6, minmax(110px, 1fr)); gap: 8px; background: #fcfcf9; border-bottom: 1px solid var(--line); }
.metric { border-left: 3px solid var(--accent); padding: 5px 8px; background: var(--surface); min-width: 0; }
.metric-label { color: var(--muted); font-size: 11px; }
.metric-value { font-weight: 700; font-size: 15px; overflow-wrap: anywhere; }
.workspace { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); padding: 0 22px 22px; }
.tabs { display: flex; gap: 4px; padding: 12px 0 10px; }
.tabs button.active { background: var(--accent-soft); border-color: var(--accent); }
.pane-grid { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.pane, .single-pane { min-height: 0; border: 1px solid var(--line); background: var(--surface); border-radius: 6px; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.pane-title { padding: 8px 10px; border-bottom: 1px solid var(--line); background: #f4f4ef; font-weight: 650; font-size: 13px; display: flex; justify-content: space-between; gap: 8px; }
pre { margin: 0; padding: 12px; overflow: auto; white-space: pre-wrap; word-break: break-word; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.single-pane { min-height: 360px; }
.files { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.file-list { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; overflow: hidden; }
.file-list h3 { margin: 0; padding: 8px 10px; font-size: 13px; background: #f4f4ef; border-bottom: 1px solid var(--line); }
.file-list ul { margin: 0; padding: 8px 10px 10px 24px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.empty { color: var(--muted); padding: 24px; }
.status-done { color: var(--accent); font-weight: 650; }
.status-failed { color: var(--bad); font-weight: 650; }
@media (max-width: 900px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar { border-right: 0; border-bottom: 1px solid var(--line); max-height: 220px; }
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pane-grid, .files { grid-template-columns: 1fr; }
}
`;

const appJs = `
const state = { runs: [], run: null, selectedRunId: null, caseId: null, left: null, right: null, phase: "impl", tab: "outputs", comparison: null };
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
    '<select id="phase">' + ["impl","plan","context","all"].map(p => '<option ' + (p === state.phase ? "selected" : "") + '>' + p + '</option>').join("") + '</select>' +
    '<button class="primary" id="refresh">Refresh</button></div></section>';
}

function renderCases() {
  return '<section class="cases">' + state.run.cases.map(c => '<div class="case-block"><div class="case-heading">' + esc(c.caseId) + '</div>' + variantTable(c.variants) + '</div>').join("") + '</section>';
}

function variantTable(variants) {
  return '<table><thead><tr><th>Variant</th><th>Status</th><th>Tokens</th><th>Wall</th><th>Agent</th><th>Tools</th><th>Files</th><th>Failures</th></tr></thead><tbody>' +
    variants.map(v => '<tr><td>' + esc(v.variantId) + '</td><td class="status-' + esc(v.status) + '">' + esc(v.status) + '</td><td>' + fmtNum(v.summary.tokensTotal) + '</td><td>' + fmtMs(v.summary.wallTimeMs) + '</td><td>' + fmtMs(v.summary.activeAgentTimeMs) + '</td><td>' + v.summary.toolCalls + '</td><td>' + v.summary.filesChanged + '</td><td>' + v.summary.commandFailures + '</td></tr>').join("") +
    '</tbody></table>';
}

function renderCompare() {
  const c = state.comparison;
  if (!c) return '<section class="empty">Choose two variants to compare.</section>';
  return '<section class="compare">' + renderMetrics(c) + '<div class="workspace">' + renderTabs() + renderTab(c) + '</div></section>';
}

function renderMetrics(c) {
  const rows = [
    ["Status", c.left.status + " / " + c.right.status],
    ["Tokens", fmtNum(c.left.summary.tokensTotal) + " / " + fmtNum(c.right.summary.tokensTotal)],
    ["Wall time", fmtMs(c.left.summary.wallTimeMs) + " / " + fmtMs(c.right.summary.wallTimeMs)],
    ["Agent time", fmtMs(c.left.summary.activeAgentTimeMs) + " / " + fmtMs(c.right.summary.activeAgentTimeMs)],
    ["Tool calls", c.left.summary.toolCalls + " / " + c.right.summary.toolCalls],
    ["Cmd failures", c.left.summary.commandFailures + " / " + c.right.summary.commandFailures]
  ];
  return '<div class="metrics">' + rows.map(([label, value]) => '<div class="metric"><div class="metric-label">' + label + '</div><div class="metric-value">' + esc(value) + '</div></div>').join("") + '</div>';
}

function renderTabs() {
  return '<div class="tabs">' + ["outputs","diff","files","warnings"].map(tab => '<button data-tab="' + tab + '" class="' + (state.tab === tab ? "active" : "") + '">' + tab + '</button>').join("") + '</div>';
}

function renderTab(c) {
  if (state.tab === "diff") return '<div class="pane-grid">' + pane(c.left.variantId + " patch", c.git.leftPatch || "No patch for selected phase.") + pane(c.right.variantId + " patch", c.git.rightPatch || "No patch for selected phase.") + '</div>';
  if (state.tab === "files") return '<div class="files">' + fileList("Shared", c.git.changedFiles.shared) + fileList("Only left", c.git.changedFiles.onlyLeft) + fileList("Only right", c.git.changedFiles.onlyRight) + '</div>';
  if (state.tab === "warnings") return '<div class="single-pane"><div class="pane-title">Warnings</div><pre>' + esc((c.warnings || []).join("\\n") || "No warnings.") + '</pre></div>';
  return '<div class="pane-grid">' + pane(c.left.variantId, c.outputs.leftImplementation || c.outputs.leftPlan || "") + pane(c.right.variantId, c.outputs.rightImplementation || c.outputs.rightPlan || "") + '</div>';
}

function pane(title, body) {
  return '<div class="pane"><div class="pane-title"><span>' + esc(title) + '</span></div><pre>' + esc(body || "No output artifact.") + '</pre></div>';
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
