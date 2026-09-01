import { escapeHtml } from "./text-format.js";

const STATE_LABELS = {
  open: "Open", check: "Check it", working: "Working", waiting: "Waiting", "decision-needed": "Decision needed",
  "holding-draft": "Holding draft", "agent-shell": "Agent shell", "agent-stopped": "Agent stopped",
  "assignment-pending": "Assignment pending", "preparing-validation": "Preparing validation", complete: "Complete",
  parked: "Parked", unknown: "Unknown",
};

/** Renders WorkSnapshotV3 directly without rebuilding another projection. */
export function renderWorkV3({ snapshot, metadata, filters = {}, foldedAreas = new Set(), collapsedGoals = new Set() }) {
  if (!snapshot) return `<section class="work-page"><div class="empty-state">Work is not ready.</div></section>`;
  const areaById = new Map(snapshot.areas.map((area) => [area.id, area]));
  const goalsByArea = new Map(snapshot.areas.map((area) => [area.id, []]));
  for (const goal of snapshot.goals) {
    if (!goalsByArea.has(goal.areaId)) goalsByArea.set(goal.areaId, []);
    goalsByArea.get(goal.areaId).push(goal);
  }
  const goalIds = new Set(snapshot.goals.map((goal) => goal.id));
  const childCount = new Map();
  for (const goal of snapshot.goals) if (goal.parentGoalId && goalIds.has(goal.parentGoalId)) childCount.set(goal.parentGoalId, (childCount.get(goal.parentGoalId) ?? 0) + 1);
  const agentsByArea = new Map();
  for (const agent of snapshot.agents.filter((row) => row.role === "definition" || row.owner.kind === "unresolved" || row.owner.kind === "none")) {
    const area = agent.areaId || "";
    if (!agentsByArea.has(area)) agentsByArea.set(area, []);
    agentsByArea.get(area).push(agent);
  }
  const brains = new Map(snapshot.brains.map((brain) => [brain.areaId, brain]));
  const processesByArea = new Map();
  for (const process of snapshot.processes) {
    if (!processesByArea.has(process.areaId)) processesByArea.set(process.areaId, []);
    processesByArea.get(process.areaId).push(process);
  }
  const visibleAreas = snapshot.areas.filter((area) => inFocus(area.id, filters.areaFocus, filters.areaFocusOnly));
  const groups = visibleAreas.map((area) => {
    let goals = goalsByArea.get(area.id) ?? [];
    if (filters.activeOnly) goals = goals.filter((goal) => ["working", "waiting", "decision-needed", "holding-draft", "agent-shell", "agent-stopped", "assignment-pending"].includes(goal.workState.code));
    if (filters.workFilter === "active") goals = goals.filter((goal) => !["open", "complete", "parked"].includes(goal.workState.code));
    if (filters.workFilter === "inactive") goals = goals.filter((goal) => ["open", "complete", "parked"].includes(goal.workState.code));
    const processes = processesByArea.get(area.id) ?? [];
    const agents = agentsByArea.get(area.id) ?? [];
    if (!goals.length && !processes.length && !agents.length && area.visibility !== "work" && !brains.has(area.id)) return "";
    return areaGroup({ area, goals, agents, brain: brains.get(area.id), processes, folded: foldedAreas.has(area.id), collapsedGoals, childCount });
  }).join("");
  const problem = snapshot.problems.length ? problemBanner(snapshot.problems) : "";
  const stale = metadata?.state && metadata.state !== "current"
    ? `<div class="work-stale" role="status"><strong>Last known</strong><span>${escapeHtml(staleReason(metadata))}</span></div>` : "";
  const count = snapshot.goals.filter((goal) => ["open", "verify"].includes(goal.lifecycle)).length;
  return `<section class="work-page" data-work-schema="agent-shell-work.v3">
    ${stale}${problem}
    <table class="work-table">
      <caption class="work-caption"><span class="work-caption-scope"><span>Work</span><span class="work-caption-count">${count} ${count === 1 ? "Goal" : "Goals"}</span></span><span class="work-keyboard-hint">revision ${snapshot.revision}</span></caption>
      <colgroup><col class="work-col-name"><col class="work-col-state"><col class="work-col-action"></colgroup>
      <thead><tr><th scope="col">Work</th><th scope="col">State</th><th scope="col">Open</th></tr></thead>
      ${groups || `<tbody><tr><td colspan="3"><div class="empty-state">No open work.</div></td></tr></tbody>`}
    </table>
  </section>`;
}

/** Renders one Area and its bounded Work rows. */
function areaGroup({ area, goals, agents, brain, processes, folded, collapsedGoals, childCount }) {
  const question = brain?.attentionCount ? `<button type="button" data-review-questions="${escapeHtml(area.id)}">${brain.attentionCount} ${brain.attentionCount === 1 ? "question" : "questions"}</button>` : "";
  const brainState = brain ? `<button class="work-group-brain" type="button" data-open-area-brain="${escapeHtml(area.id)}">${escapeHtml(brain.workState)}</button>` : `<button class="work-group-brain" type="button" data-open-area-brain="${escapeHtml(area.id)}">Start brain</button>`;
  const children = folded ? "" : [
    ...visibleGoalRows(goals, collapsedGoals).map(({ goal, depth }) => goalRow(goal, { depth, hasChildren: childCount.has(goal.id), collapsed: collapsedGoals.has(goal.id) })),
    ...agents.map(agentRow),
    ...processes.map(processRow),
    ...area.presented.map((item) => presentationRow(item, area.id, null)),
  ].join("");
  return `<tbody data-work-group="${escapeHtml(area.id)}">
    <tr class="work-group-row" data-work-cursor="area:${escapeHtml(area.id)}" data-work-area="${escapeHtml(area.id)}">
      <th scope="row"><button class="work-fold" type="button" data-work-tree-action="${folded ? "expand" : "collapse"}" data-work-tree-area="${escapeHtml(area.id)}" aria-expanded="${!folded}">${folded ? "▸" : "▾"}</button><button type="button" data-work-row-title data-open-area="${escapeHtml(area.id)}">${escapeHtml(area.label)}</button></th>
      <td>${brainState} ${question}</td><td><button type="button" data-work-object-actions aria-label="Actions for ${escapeHtml(area.label)}">•••</button></td>
    </tr>${children}
  </tbody>`;
}

/** Returns visible Goal rows after hierarchy folding. */
function visibleGoalRows(goals, collapsedGoals) {
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  return goals.flatMap((goal) => {
    let depth = 0;
    let parent = goal.parentGoalId;
    const visited = new Set([goal.id]);
    while (parent && byId.has(parent) && !visited.has(parent)) {
      if (collapsedGoals.has(parent)) return [];
      visited.add(parent);
      depth += 1;
      parent = byId.get(parent).parentGoalId;
    }
    return [{ goal, depth }];
  });
}

/** Renders one Goal summary row. */
function goalRow(goal, { depth, hasChildren, collapsed }) {
  const execution = goal.execution;
  const assignment = execution?.assignment;
  const state = STATE_LABELS[goal.workState.code] ?? goal.workState.code;
  const detail = [assignment?.label, goal.workState.evidence].filter(Boolean).join(" · ");
  return `<tr class="work-goal-row state-${escapeHtml(goal.workState.code)}${depth ? " subgoal" : " root-goal"}" data-work-cursor="goal:${escapeHtml(goal.id)}" data-goal-anchor="${escapeHtml(goal.id)}" data-work-area="${escapeHtml(goal.areaId)}"${goal.parentGoalId ? ` data-subgoal-of="${escapeHtml(goal.parentGoalId)}"` : ""}>
    <th scope="row" style="--work-goal-depth:${depth}">${hasChildren ? `<button class="work-fold" type="button" data-work-tree-action="${collapsed ? "expand" : "collapse"}" data-work-tree-goal="${escapeHtml(goal.id)}" aria-expanded="${!collapsed}">${collapsed ? "▸" : "▾"}</button>` : `<span class="work-fold-space"></span>`}<button type="button" data-work-row-title data-reveal-goal="${escapeHtml(goal.id)}">${escapeHtml(goal.title)}</button></th>
    <td><span class="work-state">${escapeHtml(state)}</span>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</td>
    <td><button type="button" data-open-goal-run="${escapeHtml(goal.id)}">${assignment?.agentId ? "Open Agent" : "Open Goal"}</button></td>
  </tr>${goal.presented.map((item) => presentationRow(item, goal.areaId, goal.id)).join("")}`;
}

/** Renders one Agent definition or unresolved row. */
function agentRow(agent) {
  return `<tr class="work-agent-row" data-work-cursor="agent:${escapeHtml(agent.id)}" data-work-area="${escapeHtml(agent.areaId || "")}">
    <th scope="row"><span class="work-fold-space"></span><button type="button" data-work-row-title data-open-work-agent="${escapeHtml(agent.id)}">${escapeHtml(agent.workTitle || agent.id)}</button></th>
    <td><span class="work-state">${escapeHtml(agent.activity)}</span>${agent.evidence ? `<small>${escapeHtml(agent.evidence)}</small>` : ""}</td><td><button type="button" data-open-work-agent="${escapeHtml(agent.id)}">Open Agent</button></td>
  </tr>`;
}

/** Renders one Process summary row. */
function processRow(process) {
  const identity = `data-process-area="${escapeHtml(process.areaId)}" data-process-slug="${escapeHtml(process.slug)}" data-process-file="${escapeHtml(process.id)}" data-process-revision="${process.revision}"`;
  const action = process.status === "paused" ? "resume" : "pause";
  return `<tr class="work-process-row" data-work-cursor="process:${escapeHtml(process.id)}" data-process-file="${escapeHtml(process.id)}" data-work-area="${escapeHtml(process.areaId)}">
    <th scope="row"><span class="work-fold-space"></span><span data-work-row-title tabindex="0">${escapeHtml(process.title)}</span></th>
    <td><span class="work-state">${escapeHtml(process.state)}</span>${process.stateDetail ? `<small>${escapeHtml(process.stateDetail)}</small>` : ""}</td>
    <td><button type="button" data-control-process data-process-action="${action}" ${identity}>${action === "pause" ? "Pause" : "Resume"}</button></td>
  </tr>`;
}

/** Renders one bounded presentation summary. */
function presentationRow(item, area, goal) {
  if (item.type === "document") return `<tr class="work-presentation-row" data-work-cursor="presentation:${escapeHtml(item.id)}" data-work-area="${escapeHtml(area)}" data-presentation-file="${escapeHtml(item.file)}"${goal ? ` data-goal-anchor="${escapeHtml(goal)}"` : ""}><th scope="row"><span class="work-fold-space"></span><button type="button" data-work-row-title data-open-document="${escapeHtml(item.file)}">${escapeHtml(item.title)}</button></th><td>${item.note ? escapeHtml(item.note) : "Presented"}</td><td><button type="button" data-open-document="${escapeHtml(item.file)}">Read</button></td></tr>`;
  return `<tr class="work-presentation-row" data-work-cursor="card:${escapeHtml(item.id)}" data-work-area="${escapeHtml(area)}"${goal ? ` data-card-goal="${escapeHtml(goal)}" data-card-id="${escapeHtml(item.id)}"` : ""}><th scope="row"><span class="work-fold-space"></span><span data-work-row-title tabindex="0">${escapeHtml(item.title)}</span></th><td>${escapeHtml(item.summary)}</td><td>${goal ? `<button type="button" data-open-goal-run="${escapeHtml(goal)}">Inspect</button>` : ""}</td></tr>`;
}

/** Renders bounded source problems. */
function problemBanner(problems) {
  return `<div class="work-problems" role="status"><strong>Some Work facts need inspection.</strong><ul>${problems.map((item) => `<li>${escapeHtml(item.source)} · ${escapeHtml(item.code)} · ${item.count}</li>`).join("")}</ul></div>`;
}

/** Returns whether an Area is in the selected subtree. */
function inFocus(area, roots, only) {
  if (!only || !Array.isArray(roots) || !roots.length) return true;
  return roots.some((root) => area === root || area.startsWith(`${root}/`));
}
/** Returns the visible freshness explanation. */
function staleReason(metadata) { return metadata.state === "degraded" ? "One or more sources use retained facts." : metadata.staleReason === "source-change-pending" ? "A source change is pending." : "The controller is reconnecting."; }
