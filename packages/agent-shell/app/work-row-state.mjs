import { workText, WORK_LIMITS } from "./work-model.mjs";

const FINAL_ASSIGNMENTS = new Set(["complete", "ended", "skipped"]);

/** Selects the one Assignment that represents the current Job run. */
export function selectWorkAssignment(assignments, liveAgentIds = new Set()) {
  const rows = Array.isArray(assignments) ? assignments : [];
  return [...rows].reverse().find((row) => row.status === "running" && agentIdOf(row) && liveAgentIds.has(agentIdOf(row)))
    ?? [...rows].reverse().find((row) => !FINAL_ASSIGNMENTS.has(row.status) && row.startedAt)
    ?? rows.find((row) => row.status === "pending")
    ?? [...rows].reverse().find((row) => FINAL_ASSIGNMENTS.has(row.status))
    ?? null;
}

/** Derives one bounded Work Assignment from a source Assignment. */
export function projectWorkAssignment(assignment, total) {
  if (!assignment) return null;
  const attempt = [...(assignment.attempts ?? [])].reverse().find((item) => item.session === assignment.session) ?? assignment.attempts?.at(-1) ?? null;
  return {
    id: workText(assignment.id ?? `assignment-${assignment.index}`, WORK_LIMITS.identity),
    index: Math.max(0, Number(assignment.index) || 0),
    total: Math.max(0, Number(total) || 0),
    kind: assignment.kind === "review" ? "review" : "implementation",
    state: assignmentState(assignment.status),
    label: workText(assignment.label || `Step ${assignment.index ?? ""}`, WORK_LIMITS.label),
    instructionPreview: workText(assignment.instruction, WORK_LIMITS.instruction),
    launchRef: launchRefOf(assignment.launch ?? attempt?.resolvedLaunch?.ref),
    agentId: agentIdOf(assignment),
    startedAt: isoOrNull(assignment.startedAt ?? attempt?.startedAt),
    endedAt: isoOrNull(assignment.endedAt ?? attempt?.endedAt),
  };
}

/** Derives the single product row state from normalized Goal, Job, Agent, and Brain facts. */
export function deriveWorkRowState({ goal, execution, assignment, agent, brain, sourcesCurrent = true }) {
  if (!sourcesCurrent) return state("unknown", "unknown", null, "One or more required sources are degraded.");
  if (["done", "dropped"].includes(goal.lifecycle)) return state("complete", "none", goal.closedAt ?? null, goal.lifecycle);
  if (goal.lifecycle === "parked") return state("parked", "none", goal.parkedAt ?? null, "Goal is parked.");
  if (goal.lifecycle === "verify") return state("check", "user", assignment?.endedAt ?? execution?.endedAt ?? null, "Julian must check this Goal.");
  if (agent?.liveness === "live" && agent.activity === "working") return state("working", "agent", agent.activitySince, agent.evidence);
  if (agent?.liveness === "live" && agent.activityDetail === "decision") return state("decision-needed", "user", agent.activitySince, agent.evidence);
  if (agent?.liveness === "live" && agent.activityDetail === "draft") return state("holding-draft", "user", agent.activitySince, agent.evidence);
  if (agent?.liveness === "live" && agent.activity === "shell") return state("agent-shell", "user", agent.activitySince, agent.evidence);
  if (agent?.liveness === "live" && agent.activity === "waiting") {
    return state("waiting", brain?.status === "active" ? "brain" : "user", agent.activitySince, agent.evidence);
  }
  if (assignment?.state === "pending") return state("assignment-pending", "none", assignment.startedAt, assignment.label);
  if (assignment?.state === "stopped") return state("agent-stopped", "user", assignment.endedAt, assignment.label);
  if (goal.startedAt || execution) return state("preparing-validation", "none", goal.startedAt, "No Assignment is active.");
  return state("open", "none", null, null);
}

/** Maps pane facts to the bounded Work activity enum. */
export function workAgentActivity(session) {
  if (session.fresh === false) return { activity: "unknown", activityDetail: "unknown" };
  if (session.state === "shell") return { activity: "shell", activityDetail: "none" };
  if (session.state === "working") return { activity: "working", activityDetail: detailOf(session.stateDetail) };
  if (session.state === "waiting") return { activity: "waiting", activityDetail: detailOf(session.stateDetail) };
  return { activity: "starting", activityDetail: "none" };
}

/** Creates one bounded derived state. */
function state(code, owner, since, evidence) {
  return { code, owner, since: isoOrNull(since), evidence: evidence ? workText(evidence, WORK_LIMITS.detail) : null };
}

/** Normalizes the observed Agent activity detail. */
function detailOf(value) {
  return ["decision", "idle", "draft", "wall"].includes(value) ? value : value ? "unknown" : "none";
}

/** Normalizes one Assignment state. */
function assignmentState(value) {
  return ["pending", "running", "waiting", "stopped", "complete", "ended", "skipped"].includes(value) ? value : "stopped";
}

/** Returns an Assignment's owned Agent identity. */
function agentIdOf(assignment) {
  return assignment?.session ?? assignment?.attempts?.at(-1)?.session ?? null;
}

/** Returns a bounded Assignment launch reference. */
function launchRefOf(value) {
  if (!value?.harness) return null;
  return { harness: workText(value.harness, WORK_LIMITS.label), model: value.model ? workText(value.model, WORK_LIMITS.label) : null, effort: value.effort ? workText(value.effort, WORK_LIMITS.label) : null };
}

/** Normalizes an optional time. */
function isoOrNull(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
