/**
 * Adapts bounded Work v3 facts to the established Work desk model.
 *
 * This is a browser view model only. It does not read source records and it
 * does not rebuild the server projection. Deliberate interactions use the
 * existing detail routes for facts that the bounded snapshot omits.
 */
export function workV3DeskModel(snapshot) {
  if (!snapshot || snapshot.schema !== "agent-shell-work.v3") return emptyDeskModel();
  const agentById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const goalsById = new Map(snapshot.goals.map((goal) => [goal.id, goal]));
  const goalDepth = new Map();

  /** Returns one Goal's depth without trusting malformed parent cycles. */
  function depthOf(goal, seen = new Set()) {
    if (!goal?.parentGoalId || seen.has(goal.id)) return 0;
    if (goalDepth.has(goal.id)) return goalDepth.get(goal.id);
    const next = new Set(seen).add(goal.id);
    const depth = 1 + depthOf(goalsById.get(goal.parentGoalId), next);
    goalDepth.set(goal.id, depth);
    return depth;
  }

  const goals = snapshot.goals.map((goal) => deskGoal(goal, depthOf(goal), agentById));
  const goalsByArea = new Map(snapshot.areas.map((area) => [area.id, []]));
  for (const goal of goals) {
    if (!goalsByArea.has(goal.area)) goalsByArea.set(goal.area, []);
    goalsByArea.get(goal.area).push(goal);
  }
  const areas = snapshot.areas.map((area) => deskArea(area, goalsByArea.get(area.id) ?? []));
  const sessions = snapshot.agents.filter((agent) => agent.liveness === "live").map(deskSession);
  const pipelines = goals.filter((goal) => goal.execution).map((goal) => deskPipeline(goal, agentById));
  const brains = snapshot.brains.map((brain) => deskBrain(brain, agentById));
  const processes = snapshot.processes.map(deskProcess);

  return {
    vault: {
      areas,
      map: areas.map((area) => ({ path: area.path, name: area.name, goals: area.goals })),
      documents: [],
    },
    sessions,
    pipelines,
    brains,
    programs: { operations: [], processes, problems: [], areas: [], liveCount: sessions.length },
  };
}

/** Returns the neutral model before Work is ready. */
function emptyDeskModel() {
  return { vault: { areas: [], map: [], documents: [] }, sessions: [], pipelines: [], brains: [], programs: { operations: [], processes: [], problems: [], areas: [], liveCount: 0 } };
}

/** Converts one bounded Area to the fields used by the mature hierarchy. */
function deskArea(area, goals) {
  const presented = presentedRows(area.presented);
  return {
    id: area.id,
    path: area.id,
    name: area.label,
    status: area.state === "open" ? "active" : area.state,
    goals,
    documents: [],
    presentations: presented.documents,
    cards: presented.cards,
  };
}

/** Converts one bounded Goal without inventing omitted source text. */
function deskGoal(goal, depth, agentById) {
  const presented = presentedRows(goal.presented);
  const assignment = goal.execution?.assignment ?? null;
  const agent = assignment?.agentId ? agentById.get(assignment.agentId) ?? null : null;
  return {
    ...goal,
    file: goal.id,
    area: goal.areaId,
    slug: goal.id.split("/").at(-1)?.replace(/^(?:goal|outcome)-/, "").replace(/\.md$/, "") ?? goal.id,
    status: goal.legacyStatus ?? (goal.lifecycle === "open" ? "active" : goal.lifecycle === "parked" ? "deferred" : goal.lifecycle),
    depth,
    doneWhen: goal.legacyDoneWhen ?? "",
    waitingOn: goal.legacyWaitingOn ?? (goal.workState.owner === "user" ? goal.workState.evidence ?? "Waiting for you" : ""),
    dependsOn: [],
    firstStartAt: timeNumber(goal.legacyFirstStartAt ?? goal.startedAt),
    lastEndAt: timeNumber(goal.legacyLastEndAt ?? assignment?.endedAt),
    agents: goal.legacyAgents ?? (assignment?.agentId ? [assignment.agentId] : []),
    session: agent?.liveness === "live" ? agent.id : null,
    presentations: presented.documents,
    cards: presented.cards,
    mtime: goal.legacyChangedAt ?? goal.rank,
    changedAt: goal.legacyChangedAt ?? goal.rank,
  };
}

/** Converts one bounded Agent to the established session vocabulary. */
function deskSession(agent) {
  const kind = agent.role === "definition" ? "work-definition" : ["brain", "repair"].includes(agent.role) ? agent.role : "goal";
  return {
    ...agent,
    name: agent.id,
    area: agent.areaId,
    goal: agent.owner.kind === "assignment" ? agent.owner.goalId : null,
    kind,
    state: agent.activity,
    stateDetail: agent.activityDetail,
    waitingSince: timeNumber(agent.activitySince),
    idleSince: agent.activityDetail === "idle" ? timeNumber(agent.activitySince) : null,
    created: timeNumber(agent.createdAt),
    launch: agent.launchRef,
    command: launchText(agent.launchRef),
  };
}

/** Converts one bounded Job summary to the mature current-Assignment view. */
function deskPipeline(goal, agentById) {
  const execution = goal.execution;
  const selected = execution.assignment;
  const total = Math.max(1, Number(execution.counts?.total) || Number(selected?.total) || 1);
  const selectedIndex = Math.min(total, Math.max(1, Number(selected?.index) || 1));
  const steps = Array.from({ length: total }, (_, offset) => {
    const index = offset + 1;
    if (selected && index === selectedIndex) return deskAssignment(selected, agentById.get(selected.agentId));
    const final = index < selectedIndex || (!selected && index <= Number(execution.counts?.final));
    return { id: `bounded-assignment-${index}`, index, label: `Assignment ${index}`, instruction: "", status: final ? "complete" : "pending", session: null, launch: null, startedAt: null, endedAt: null, live: false, state: null, stateDetail: null };
  });
  return {
    goal: goal.file,
    area: goal.area,
    slug: goal.slug,
    run: execution.run,
    revision: execution.revision,
    status: execution.state,
    steps,
    assignments: steps,
    currentAssignmentId: selected?.id ?? null,
    startedAt: goal.startedAt,
    updatedAt: goal.workState.since ?? goal.startedAt,
  };
}

/** Converts the selected bounded Assignment and its observed Agent. */
function deskAssignment(assignment, agent) {
  return {
    id: assignment.id,
    index: assignment.index,
    kind: assignment.kind,
    label: assignment.label,
    instruction: assignment.instructionPreview,
    status: assignment.state,
    session: assignment.agentId,
    launch: assignment.launchRef,
    startedAt: assignment.startedAt,
    endedAt: assignment.endedAt,
    live: agent?.liveness === "live",
    state: agent?.activity ?? null,
    stateDetail: agent?.activityDetail ?? null,
    waitingSince: timeNumber(agent?.activitySince),
    idleSince: agent?.activityDetail === "idle" ? timeNumber(agent.activitySince) : null,
  };
}

/** Converts one bounded Brain and preserves only its visible summary. */
function deskBrain(brain, agentById) {
  const agent = brain.agentId ? agentById.get(brain.agentId) ?? null : null;
  return {
    ...brain,
    area: brain.areaId,
    session: brain.agentId,
    live: agent?.liveness === "live",
    state: agent?.activity ?? brain.workState,
    stateDetail: agent?.activityDetail ?? null,
    currentAttemptId: brain.attemptId,
    requests: Array.from({ length: brain.attentionCount }, (_, index) => ({ id: `bounded-question-${index + 1}`, status: "open", question: "Question" })),
    forJulian: [],
  };
}

/** Converts one bounded Process to the mature process row fields. */
function deskProcess(process) {
  return {
    ...process,
    area: process.areaId,
    file: process.id,
    when: process.whenLabel,
    every: process.loop ? process.whenLabel : null,
    body: process.bodyPreview ?? "",
    state: process.legacyState ?? processStateLabel(process),
    error: process.state === "broken" ? process.stateDetail ?? "The process note is invalid." : null,
  };
}

/** Uses product words for Process state and Brain availability. */
function processStateLabel(process) {
  if (process.status === "paused" || process.state === "paused") return "Paused";
  if (process.state === "waiting-for-brain") return "Brain off";
  if (process.state === "needs-user") return "Needs you";
  if (process.state === "did-not-start") return "Did not start";
  if (process.state === "could-not-start") return "Could not start";
  if (process.state === "loop") return process.brainLive ? "Brain on" : "Brain off";
  return process.state.split("-").map(capitalize).join(" ");
}

/** Splits bounded presentation summaries into the mature child-row kinds. */
function presentedRows(items = []) {
  const documents = [];
  const cards = [];
  for (const item of items) {
    if (item.type === "document") documents.push({ ...item, presentedBy: { session: item.presentedBy } });
    if (item.type === "card") cards.push({ ...item, presentedBy: { session: item.presentedBy } });
  }
  return { documents, cards };
}

/** Returns an epoch number for mature elapsed-time helpers. */
function timeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const result = Date.parse(String(value ?? ""));
  return Number.isFinite(result) ? result : null;
}

/** Returns the bounded launch identity as one readable string. */
function launchText(value) { return value ? [value.harness, value.model, value.effort].filter(Boolean).join("/") : ""; }
/** Capitalizes one controlled state segment. */
function capitalize(value) { return value ? `${value[0].toUpperCase()}${value.slice(1)}` : ""; }
