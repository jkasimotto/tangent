export const appCompareJs = `function renderCompare() {
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

async function startSpecRun() {
  if (!state.selectedSpecId) return;
  state.actionError = null;
  try {
    state.job = await api("/api/eval/specs/" + encodeURIComponent(state.selectedSpecId) + "/runs", { method: "POST" });
  } catch (error) {
    state.actionError = error.message;
    render();
    return;
  }
  state.jobEvents = [];
  state.jobManifest = null;
  state.lastEventSeq = 0;
  state.logTail = "";
  await pollJob();
}

async function cancelJob() {
  if (!state.job) return;
  state.actionError = null;
  try {
    state.job = await api("/api/eval/jobs/" + encodeURIComponent(state.job.id) + "/cancel", { method: "POST" });
  } catch (error) {
    state.actionError = error.message;
    render();
    return;
  }
  await pollJob();
}

async function pollJob() {
  if (!state.job) return;
  clearTimeout(pollTimer);
  state.job = await api("/api/eval/jobs/" + encodeURIComponent(state.job.id));
  const events = await api("/api/eval/jobs/" + encodeURIComponent(state.job.id) + "/events?after=" + state.lastEventSeq);
  processJobEvents(events);
  if (state.job.runId) {
    state.jobManifest = await api("/api/eval/runs/" + encodeURIComponent(state.job.runId) + "/status").catch(() => state.jobManifest);
  }
  if (state.job.status === "done" && state.job.runId) {
    await loadRuns();
    await loadRun(state.job.runId);
  } else if (state.job.status !== "running") {
    await loadRuns();
  }
  render();
  if (state.job?.status === "running") pollTimer = setTimeout(() => { void pollJob(); }, 1000);
}

function processJobEvents(events) {
  for (const event of events) {
    state.lastEventSeq = Math.max(state.lastEventSeq, event.seq);
    state.jobEvents.push(event);
    if (event.type === "phase.output" && event.chunk) {
      state.logTail += "[" + (event.stream || "stdout") + "] " + event.chunk;
      if (state.logTail.length > 40000) state.logTail = state.logTail.slice(-40000);
    }
  }
  if (state.jobEvents.length > 400) state.jobEvents = state.jobEvents.slice(-400);
}

function bind() {
  document.querySelectorAll("[data-spec]").forEach(button => button.addEventListener("click", async () => { state.view = "spec"; await loadSpec(button.dataset.spec); render(); }));
  document.querySelectorAll("[data-run]").forEach(button => button.addEventListener("click", async () => { await loadRun(button.dataset.run); render(); }));
  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => { state.tab = button.dataset.tab; render(); }));
  document.getElementById("run-spec")?.addEventListener("click", async () => { await startSpecRun(); });
  document.getElementById("cancel-job")?.addEventListener("click", async () => { await cancelJob(); });
  document.getElementById("open-job-run")?.addEventListener("click", async () => { if (state.job?.runId) { await loadRun(state.job.runId); render(); } });
  document.getElementById("refresh-specs")?.addEventListener("click", async () => { await loadSpecs(); if (state.selectedSpecId) await loadSpec(state.selectedSpecId); render(); });
  document.getElementById("refresh-spec")?.addEventListener("click", async () => { if (state.selectedSpecId) await loadSpec(state.selectedSpecId); render(); });
  document.getElementById("context-left")?.addEventListener("change", async e => { state.contextLeftKey = e.target.value; await loadSelectedContexts(); render(); });
  document.getElementById("context-right")?.addEventListener("change", async e => { state.contextRightKey = e.target.value; await loadSelectedContexts(); render(); });
  document.getElementById("context-file")?.addEventListener("change", e => { state.contextFile = e.target.value; render(); });
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

loadAll().catch(error => { app.innerHTML = '<pre class="empty">' + esc(error.stack || error.message) + '</pre>'; });
`;
