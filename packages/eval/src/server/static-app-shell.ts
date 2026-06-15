export const appShellJs = `
const state = {
  specs: [],
  spec: null,
  runs: [],
  run: null,
  view: "spec",
  selectedSpecId: null,
  selectedRunId: null,
  caseId: null,
  left: null,
  right: null,
  phase: "all",
  tab: "diff",
  comparison: null,
  job: null,
  jobEvents: [],
  jobManifest: null,
  lastEventSeq: 0,
  logTail: "",
  actionError: null,
  contextLeftKey: null,
  contextRightKey: null,
  contextLeft: null,
  contextRight: null,
  contextFile: null
};
const app = document.getElementById("app");
let pollTimer = null;

async function api(path, options) {
  const response = await fetch(path, options);
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

async function loadAll() {
  await Promise.all([loadSpecs(), loadRuns()]);
  if (state.specs.length) {
    state.view = "spec";
    await loadSpec(state.selectedSpecId || state.specs[0].id);
  } else if (state.runs.length) {
    state.view = "run";
    await loadRun(state.selectedRunId || state.runs[0].id);
  }
  render();
}

async function loadSpecs() {
  state.specs = await api("/api/eval/specs");
  if (!state.selectedSpecId && state.specs.length) state.selectedSpecId = state.specs[0].id;
}

async function loadSpec(id) {
  state.selectedSpecId = id;
  state.spec = await api("/api/eval/specs/" + encodeURIComponent(id));
  selectDefaultContexts();
  await loadSelectedContexts().catch(error => { state.actionError = error.message; });
}

function selectDefaultContexts() {
  const variants = snapshotVariants();
  if (!variants.some(v => contextKey(v) === state.contextLeftKey)) state.contextLeftKey = variants[0] ? contextKey(variants[0]) : null;
  if (!variants.some(v => contextKey(v) === state.contextRightKey)) state.contextRightKey = variants[1] ? contextKey(variants[1]) : state.contextLeftKey;
  state.contextLeft = null;
  state.contextRight = null;
  state.contextFile = null;
}

async function loadSelectedContexts() {
  const left = snapshotVariantByKey(state.contextLeftKey);
  const right = snapshotVariantByKey(state.contextRightKey);
  state.contextLeft = left ? await loadContextSnapshot(left) : null;
  state.contextRight = right ? await loadContextSnapshot(right) : null;
  const files = contextFiles();
  if (!files.includes(state.contextFile)) state.contextFile = files[0] || null;
}

async function loadContextSnapshot(variant) {
  const params = new URLSearchParams({ caseId: variant.caseId, variantId: variant.variantId });
  return api("/api/eval/specs/" + encodeURIComponent(state.selectedSpecId) + "/context?" + params);
}

async function loadRuns() {
  state.runs = await api("/api/eval/runs");
  if (!state.selectedRunId && state.runs.length) state.selectedRunId = state.runs[0].id;
}

async function loadRun(id) {
  state.selectedRunId = id;
  state.view = "run";
  state.run = await api("/api/eval/runs/" + encodeURIComponent(id));
  const firstCase = state.run.cases.find(c => c.caseId === state.caseId) || state.run.cases[0];
  state.caseId = firstCase?.caseId;
  const variants = firstCase?.variants || [];
  if (!variants.some(v => v.variantId === state.left)) state.left = variants[0]?.variantId;
  if (!variants.some(v => v.variantId === state.right)) state.right = variants[1]?.variantId || variants[0]?.variantId;
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
  return '<aside class="sidebar"><div class="brand">Tangent Eval</div>' +
    '<div class="nav-section"><span class="nav-heading">Eval specs</span><button id="refresh-specs">Refresh</button></div>' +
    '<div class="run-list">' + (state.specs.length ? state.specs.map(spec => (
    '<button class="run-row ' + (state.view === "spec" && spec.id === state.selectedSpecId ? "selected" : "") + '" data-spec="' + esc(spec.id) + '">' +
    '<div class="run-name">' + esc(spec.name || spec.relativePath) + '</div><div class="run-meta">' + esc(spec.relativePath) + '</div><div class="run-meta ' + (spec.error ? "error-text" : "") + '">' + (spec.error ? "invalid" : ((spec.caseCount || 0) + ' cases / ' + (spec.variantCount || 0) + ' variants')) + '</div></button>'
  )).join("") : '<div class="empty">No eval specs under evals/.</div>') + '</div>' +
    '<div class="nav-section"><span class="nav-heading">Runs</span></div>' +
    '<div class="run-list">' + (state.runs.length ? state.runs.map(run => (
    '<button class="run-row ' + (state.view === "run" && run.id === state.selectedRunId ? "selected" : "") + '" data-run="' + esc(run.id) + '">' +
    '<div class="run-name">' + esc(run.name) + '</div><div class="run-meta">' + esc(run.id) + '</div><div class="run-meta">' + run.variants + ' variants</div></button>'
  )).join("") : '<div class="empty">No eval runs found.</div>') + '</div></aside>';
}

function renderMain() {
  if (state.view === "spec") return renderSpecMain();
  if (!state.run) return '<div class="empty">No eval runs found.</div>';
  return renderTopbar() + renderCases() + renderCompare();
}

function renderSpecMain() {
  if (!state.spec) return '<div class="empty">No eval spec selected.</div>';
  const disabled = state.spec.error || (state.job && state.job.status === "running");
  return '<section class="topbar"><div class="title"><h1>' + esc(state.spec.name || "Eval spec") + '</h1><span class="muted">' + esc(state.spec.relativePath) + '</span></div>' +
    '<div class="controls"><button class="primary" id="run-spec" ' + (disabled ? "disabled" : "") + '>Run eval</button><button id="refresh-spec">Refresh</button></div></section>' +
    '<section class="spec-workspace">' + renderJobPanel() + renderSpecError() + renderSpecOverview() + renderContextCompare() + renderSpecCases() + '</section>';
}

function renderSpecError() {
  const error = state.actionError || state.spec?.error;
  if (!error) return "";
  return '<div class="section-panel"><div class="section-title error-text">Error</div><div class="detail-body error-text">' + esc(error) + '</div></div>';
}

function renderSpecOverview() {
  const firstCase = state.spec.cases[0];
  return '<div class="split"><div class="section-panel"><div class="section-title"><span>Task prompt</span><span class="muted">' + esc(firstCase?.caseId || "") + '</span></div>' +
    '<pre class="prompt-preview">' + esc(firstCase?.prompt || "No prompt loaded.") + '</pre></div>' +
    '<div class="section-panel"><div class="section-title">Resolved defaults</div><div class="detail-body"><div class="kv">' +
    '<div>Path</div><div class="code-inline">' + esc(state.spec.path) + '</div>' +
    '<div>Repo</div><div class="code-inline">' + esc(repoLabel(state.spec.defaults?.repo)) + '</div>' +
    '<div>CWD</div><div class="code-inline">' + esc(state.spec.defaults?.cwd || ".") + '</div>' +
    '<div>Agent</div><div>' + esc(agentLabel(state.spec.defaults?.agent)) + '</div>' +
    '<div>Phases</div><div>' + esc(phaseList(state.spec.defaults?.phases)) + '</div>' +
    '</div></div></div></div>';
}

function renderSpecCases() {
  if (!state.spec?.cases.length) return "";
  return state.spec.cases.map(c => '<div class="section-panel"><div class="section-title"><span>' + esc(c.caseId) + '</span><span class="muted">' + c.variants.length + ' variants</span></div>' +
    '<div class="summary-wrap"><table class="summary-table"><thead><tr><th>Variant</th><th>Context</th><th>Repo</th><th>CWD</th><th>Agent</th><th>Phases</th></tr></thead><tbody>' +
    c.variants.map(v => '<tr><td class="metric-value">' + esc(v.variantId) + '</td><td>' + contextCell(v.context) + '</td><td class="code-inline">' + esc(repoLabel(v.repo)) + '</td><td class="code-inline">' + esc(v.cwd) + '</td><td>' + esc(agentLabel(v.agent)) + '</td><td>' + esc(v.phases.map(p => p.id + ":" + p.mode).join(", ")) + '</td></tr>').join("") +
    '</tbody></table></div></div>').join("");
}

function renderContextCompare() {
  const variants = snapshotVariants();
  if (!variants.length) return "";
  const files = contextFiles();
  return '<div class="section-panel"><div class="section-title"><span>Snapshot contexts</span><span class="muted">' + variants.length + ' snapshots</span></div>' +
    '<div class="detail-body"><div class="controls">' +
    '<select id="context-left">' + variants.map(v => '<option value="' + esc(contextKey(v)) + '" ' + (contextKey(v) === state.contextLeftKey ? "selected" : "") + '>' + esc(contextLabel(v)) + '</option>').join("") + '</select>' +
    '<select id="context-right">' + variants.map(v => '<option value="' + esc(contextKey(v)) + '" ' + (contextKey(v) === state.contextRightKey ? "selected" : "") + '>' + esc(contextLabel(v)) + '</option>').join("") + '</select>' +
    '<select id="context-file">' + files.map(file => '<option value="' + esc(file) + '" ' + (file === state.contextFile ? "selected" : "") + '>' + esc(file) + '</option>').join("") + '</select>' +
    '</div>' + renderContextPanes() + '</div></div>';
}

function renderContextPanes() {
  return '<div class="pane-grid">' + contextPane("Left", state.contextLeft) + contextPane("Right", state.contextRight) + '</div>';
}

function contextPane(label, snapshot) {
  const file = snapshot?.files?.find(item => item.snapshotPath === state.contextFile);
  const title = label + (snapshot ? ": " + snapshot.ref : "");
  const body = file ? file.content : snapshot ? "File is not present in this snapshot." : "No snapshot loaded.";
  return pane(title, body);
}

function renderJobPanel() {
  if (!state.job) return "";
  const running = state.job.status === "running";
  return '<div class="job-strip"><div class="job-head"><div class="job-title"><strong>Run job: ' + esc(state.job.status) + '</strong><span class="muted">' + esc(state.job.runId || state.job.id) + '</span></div>' +
    '<div class="controls">' + (running ? '<button class="danger" id="cancel-job">Cancel</button>' : '') + (state.job.runId ? '<button id="open-job-run">Open run</button>' : '') + '</div></div>' +
    renderJobProgress() + renderTimeline() + '<pre class="log-tail">' + esc(state.logTail || "No runner output yet.") + '</pre></div>';
}

function renderJobProgress() {
  if (!state.jobManifest?.variants?.length) return "";
  const variants = state.jobManifest.variants;
  return '<div class="summary-wrap"><table class="summary-table"><thead><tr><th>Variant</th><th>Status</th><th>Plan</th><th>Implement</th><th>Elapsed</th></tr></thead><tbody>' +
    variants.map(v => '<tr><td>' + esc(v.caseId + "/" + v.variantId) + '</td><td class="status-' + esc(v.status) + '">' + esc(v.status) + '</td><td>' + phaseStatus(v, "plan") + '</td><td>' + phaseStatus(v, "implement") + '</td><td>' + fmtVariantElapsed(v) + '</td></tr>').join("") +
    '</tbody></table></div>';
}

function renderTimeline() {
  const events = state.jobEvents.slice(-60).filter(e => e.type !== "phase.output");
  if (!events.length) return '<ol class="timeline"><li>No progress events yet.</li></ol>';
  return '<ol class="timeline">' + events.map(e => '<li>' + esc(eventText(e)) + '</li>').join("") + '</ol>';
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

function repoLabel(repo) {
  if (!repo) return "-";
  return (repo.path || ".") + " @ " + (repo.ref || "HEAD");
}

function agentLabel(agent) {
  if (!agent) return "manual";
  if (agent.kind === "manual") return "manual";
  const parts = [agent.kind, agent.model];
  if (agent.profile) parts.push("profile " + agent.profile);
  if (agent.sandbox) parts.push(agent.sandbox);
  if (agent.permissionMode) parts.push(agent.permissionMode);
  if (agent.timeoutMs) parts.push(String(agent.timeoutMs) + "ms");
  return parts.filter(Boolean).join(" / ");
}

function phaseList(phases) {
  if (!phases || !phases.length) return "implement";
  return phases.map(phase => typeof phase === "string" ? phase : phase.id + ":" + (phase.mode || "default")).join(", ");
}

function contextCell(context) {
  const label = context.mode === "snapshot" ? "snapshot " + context.ref : context.mode === "git-ref" ? "git-ref " + context.ref : context.mode;
  const files = context.files?.length ? '<div class="muted">' + context.files.length + ' files</div>' : "";
  const error = context.error ? '<div class="error-text">' + esc(context.error) + '</div>' : "";
  return '<div>' + esc(label) + files + error + '</div>';
}

function snapshotVariants() {
  return (state.spec?.cases || []).flatMap(c => c.variants.map(v => ({ ...v, caseId: c.caseId }))).filter(v => v.context?.mode === "snapshot");
}

function snapshotVariantByKey(key) {
  return snapshotVariants().find(v => contextKey(v) === key);
}

function contextKey(variant) {
  return variant.caseId + "||" + variant.variantId;
}

function contextLabel(variant) {
  return variant.variantId + " / " + variant.context.ref;
}

function contextFiles() {
  const rows = new Set();
  for (const snapshot of [state.contextLeft, state.contextRight]) {
    for (const file of snapshot?.files || []) rows.add(file.snapshotPath);
  }
  return [...rows].sort();
}

function phaseStatus(variant, id) {
  const phase = variant.phases?.find(p => p.id === id);
  if (!phase) return '<span class="muted">-</span>';
  return '<span class="status-' + esc(phase.status || "prepared") + '">' + esc(phase.status || "prepared") + '</span>';
}

function fmtVariantElapsed(variant) {
  const start = variant.startedAt && Date.parse(variant.startedAt);
  const end = variant.endedAt ? Date.parse(variant.endedAt) : Date.now();
  if (!start || Number.isNaN(start) || Number.isNaN(end)) return "-";
  return fmtMs(Math.max(0, end - start));
}

function eventText(event) {
  const target = [event.caseId, event.variantId].filter(Boolean).join("/");
  const phase = event.phase ? " " + event.phase : "";
  const message = event.message ? " - " + event.message : "";
  return event.type + (target ? " " + target : "") + phase + message;
}
`;
