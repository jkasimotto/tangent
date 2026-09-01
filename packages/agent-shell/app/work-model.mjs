import { createHash } from "node:crypto";

export const WORK_SCHEMA = "agent-shell-work.v3";
export const WORK_STORE_SCHEMA = "agent-shell-work-store.v1";
export const WORK_LIVE_TARGET_BYTES = 512 * 1024;
export const WORK_HARD_LIMIT_BYTES = 1024 * 1024;

export const WORK_LIMITS = Object.freeze({
  title: 160,
  label: 120,
  detail: 240,
  instruction: 160,
  identity: 512,
  presented: 3,
  problemSamples: 3,
});

export const WORK_DOMAINS = Object.freeze(["areas", "goals", "jobs", "agents", "brains", "processes", "presentations"]);
export const WORK_PROBLEM_CODES = Object.freeze([
  "source-enumeration-failed",
  "source-record-invalid",
  "agent-observation-failed",
  "agent-pane-failed",
  "job-goal-missing",
  "agent-owner-unresolved",
  "agent-owner-duplicate",
  "brain-agent-missing",
  "process-goal-missing",
]);

const AREA_STATES = new Set(["open", "done", "archived"]);
const AREA_VISIBILITY = new Set(["work", "ancestor"]);
const GOAL_LIFECYCLES = new Set(["open", "verify", "done", "dropped", "parked"]);
const GOAL_VISIBILITY = new Set(["work", "ancestor", "runtime-context"]);
const ROW_CODES = new Set(["open", "check", "working", "waiting", "decision-needed", "holding-draft", "agent-shell", "agent-stopped", "assignment-pending", "preparing-validation", "complete", "parked", "unknown"]);
const ROW_OWNERS = new Set(["agent", "brain", "user", "none", "unknown"]);
const JOB_STATES = new Set(["open", "stopped", "complete", "parked", "unknown"]);
const ASSIGNMENT_STATES = new Set(["pending", "running", "waiting", "stopped", "complete", "ended", "skipped"]);
const AGENT_ROLES = new Set(["worker", "brain", "repair", "definition", "unassigned"]);
const AGENT_LIVENESS = new Set(["live", "absent", "unknown"]);
const AGENT_ACTIVITY = new Set(["working", "waiting", "shell", "starting", "unknown"]);
const AGENT_DETAILS = new Set(["decision", "idle", "draft", "wall", "none", "unknown"]);
const BRAIN_STATUS = new Set(["active", "inactive", "stopping", "failed"]);
const BRAIN_WORK = new Set(["working", "waiting", "stopped", "repairing", "failed", "unknown"]);
const PROCESS_STATES = new Set(["loop", "waiting-for-brain", "waiting", "running", "starting", "did-not-start", "could-not-start", "needs-user", "deferred", "paused", "broken"]);
const CARD_KINDS = new Set(["copy", "link", "links", "progress", "checklist", "commits", "reviews"]);
const OWNER_KINDS = new Set(["assignment", "brain", "repair", "definition", "unresolved", "none"]);

/** Returns a bounded one-line string. */
export function workText(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

/** Stable JSON for semantic hashes and source fences. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 over canonical JSON, encoded for headers and file names. */
export function workHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url");
}

/** Hashes a candidate without transport-owned revision fields. */
export function workSemanticHash(candidate) {
  return workHash(candidate);
}

/** Validates one candidate at the gateway trust boundary. */
export function validateWorkCandidate(candidate, { hardLimit = WORK_HARD_LIMIT_BYTES } = {}) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { ok: false, code: "candidate-shape", errors: ["candidate must be an object"] };
  exactKeys(candidate, ["schema", "fence", "areas", "goals", "agents", "brains", "processes", "problems"], "candidate", errors);
  if (candidate.schema !== WORK_SCHEMA) errors.push(`schema must be ${WORK_SCHEMA}`);
  const arrays = ["areas", "goals", "agents", "brains", "processes", "problems"];
  for (const key of arrays) if (!Array.isArray(candidate[key])) errors.push(`${key} must be an array`);
  validateFence(candidate.fence, errors);
  if (errors.length) return { ok: false, code: "candidate-shape", errors };

  const areaIds = uniqueIds(candidate.areas, "id", "areas", errors);
  const goalIds = uniqueIds(candidate.goals, "id", "goals", errors);
  const agentIds = uniqueIds(candidate.agents, "id", "agents", errors);
  const brainAreas = uniqueIds(candidate.brains, "areaId", "brains", errors);
  uniqueIds(candidate.processes, "id", "processes", errors);

  for (const [index, area] of candidate.areas.entries()) {
    exactKeys(area, ["id", "parentId", "label", "state", "visibility", "presented", "morePresentedCount"], `areas[${index}]`, errors);
    bounded(area.id, WORK_LIMITS.identity, `areas[${index}].id`, errors);
    nullableBounded(area.parentId, WORK_LIMITS.identity, `areas[${index}].parentId`, errors);
    bounded(area.label, WORK_LIMITS.label, `areas[${index}].label`, errors);
    enumValue(area.state, AREA_STATES, `areas[${index}].state`, errors);
    enumValue(area.visibility, AREA_VISIBILITY, `areas[${index}].visibility`, errors);
    if (area.parentId !== null && !areaIds.has(area.parentId)) errors.push(`areas[${index}].parentId is missing`);
    validatePresented(area, `areas[${index}]`, errors);
  }
  for (const [index, goal] of candidate.goals.entries()) {
    exactKeys(goal, ["id", "areaId", "parentGoalId", "title", "lifecycle", "verify", "visibility", "rank", "blockers", "startedAt", "workState", "execution", "presented", "morePresentedCount"], `goals[${index}]`, errors);
    bounded(goal.id, WORK_LIMITS.identity, `goals[${index}].id`, errors);
    bounded(goal.areaId, WORK_LIMITS.identity, `goals[${index}].areaId`, errors);
    nullableBounded(goal.parentGoalId, WORK_LIMITS.identity, `goals[${index}].parentGoalId`, errors);
    bounded(goal.title, WORK_LIMITS.title, `goals[${index}].title`, errors);
    enumValue(goal.lifecycle, GOAL_LIFECYCLES, `goals[${index}].lifecycle`, errors);
    enumValue(goal.visibility, GOAL_VISIBILITY, `goals[${index}].visibility`, errors);
    if (typeof goal.verify !== "boolean") errors.push(`goals[${index}].verify must be a boolean`);
    exactKeys(goal.blockers, ["state", "count"], `goals[${index}].blockers`, errors);
    enumValue(goal.blockers?.state, new Set(["ready", "blocked", "broken", "cycle"]), `goals[${index}].blockers.state`, errors);
    nonNegative(goal.blockers?.count, `goals[${index}].blockers.count`, errors);
    nullableTime(goal.startedAt, `goals[${index}].startedAt`, errors);
    if (!areaIds.has(goal.areaId)) errors.push(`goals[${index}].areaId is missing`);
    if (goal.parentGoalId !== null && !goalIds.has(goal.parentGoalId)) errors.push(`goals[${index}].parentGoalId is missing`);
    if (!Number.isInteger(goal.rank) || goal.rank < 0) errors.push(`goals[${index}].rank must be a non-negative integer`);
    validateRowState(goal.workState, `goals[${index}].workState`, errors);
    validateExecution(goal.execution, agentIds, `goals[${index}].execution`, errors);
    validatePresented(goal, `goals[${index}]`, errors);
  }
  for (const [index, agent] of candidate.agents.entries()) validateAgent(agent, areaIds, goalIds, brainAreas, `agents[${index}]`, errors);
  for (const [index, brain] of candidate.brains.entries()) {
    exactKeys(brain, ["areaId", "status", "generation", "attemptId", "agentId", "workState", "attentionCount"], `brains[${index}]`, errors);
    if (!areaIds.has(brain.areaId)) errors.push(`brains[${index}].areaId is missing`);
    enumValue(brain.status, BRAIN_STATUS, `brains[${index}].status`, errors);
    enumValue(brain.workState, BRAIN_WORK, `brains[${index}].workState`, errors);
    if (brain.agentId !== null && !agentIds.has(brain.agentId)) errors.push(`brains[${index}].agentId is missing`);
    nullableBounded(brain.attemptId, WORK_LIMITS.identity, `brains[${index}].attemptId`, errors);
    nonNegative(brain.generation, `brains[${index}].generation`, errors);
    nonNegative(brain.attentionCount, `brains[${index}].attentionCount`, errors);
  }
  for (const [index, process] of candidate.processes.entries()) {
    exactKeys(process, ["id", "areaId", "slug", "title", "status", "state", "stateDetail", "whenLabel", "loop", "bodyPreview", "visibleInWork", "due", "brainLive", "eventId", "revision", "missedCount", "missedSince"], `processes[${index}]`, errors);
    bounded(process.id, WORK_LIMITS.identity, `processes[${index}].id`, errors);
    if (!areaIds.has(process.areaId)) errors.push(`processes[${index}].areaId is missing`);
    bounded(process.slug, WORK_LIMITS.label, `processes[${index}].slug`, errors);
    bounded(process.title, WORK_LIMITS.title, `processes[${index}].title`, errors);
    enumValue(process.status, new Set(["active", "paused"]), `processes[${index}].status`, errors);
    enumValue(process.state, PROCESS_STATES, `processes[${index}].state`, errors);
    nullableBounded(process.stateDetail, WORK_LIMITS.detail, `processes[${index}].stateDetail`, errors);
    bounded(process.whenLabel, WORK_LIMITS.label, `processes[${index}].whenLabel`, errors);
    nullableBounded(process.bodyPreview, WORK_LIMITS.instruction, `processes[${index}].bodyPreview`, errors);
    for (const name of ["loop", "visibleInWork", "due", "brainLive"]) if (typeof process[name] !== "boolean") errors.push(`processes[${index}].${name} must be a boolean`);
    nullableBounded(process.eventId, WORK_LIMITS.identity, `processes[${index}].eventId`, errors);
    nullableTime(process.missedSince, `processes[${index}].missedSince`, errors);
    nonNegative(process.revision, `processes[${index}].revision`, errors);
    nonNegative(process.missedCount, `processes[${index}].missedCount`, errors);
  }
  for (const [index, problem] of candidate.problems.entries()) {
    exactKeys(problem, ["code", "source", "count", "sampleIds"], `problems[${index}]`, errors);
    enumValue(problem.code, new Set(WORK_PROBLEM_CODES), `problems[${index}].code`, errors);
    enumValue(problem.source, new Set([...WORK_DOMAINS, "model"]), `problems[${index}].source`, errors);
    nonNegative(problem.count, `problems[${index}].count`, errors);
    if (!Array.isArray(problem.sampleIds) || problem.sampleIds.length > WORK_LIMITS.problemSamples) errors.push(`problems[${index}].sampleIds exceeds its bound`);
    for (const sample of problem.sampleIds ?? []) bounded(sample, WORK_LIMITS.identity, `problems[${index}].sampleIds`, errors);
  }
  ordered(candidate.areas, (row) => row.id, "areas", errors);
  ordered(candidate.goals, (row) => `${String(row.rank).padStart(12, "0")}\0${row.title}\0${row.id}`, "goals", errors);
  ordered(candidate.agents, (row) => `${String(row.createdAt ?? "").padEnd(32)}\0${row.id}`, "agents", errors);
  ordered(candidate.brains, (row) => row.areaId, "brains", errors);
  ordered(candidate.processes, (row) => `${row.areaId}\0${row.id}`, "processes", errors);
  ordered(candidate.problems, (row) => `${row.source}\0${row.code}`, "problems", errors);
  const bodyBytes = Buffer.byteLength(JSON.stringify({ ...candidate, epoch: "00000000-0000-4000-8000-000000000000", revision: Number.MAX_SAFE_INTEGER, publishedAt: "2000-01-01T00:00:00.000Z" }));
  if (bodyBytes > hardLimit) return { ok: false, code: "candidate-too-large", errors: [`candidate is ${bodyBytes} bytes; limit is ${hardLimit}`], bytes: bodyBytes };
  return errors.length ? { ok: false, code: "candidate-invalid", errors, bytes: bodyBytes } : { ok: true, bytes: bodyBytes };
}

/** Validates a complete public snapshot. */
export function validateWorkSnapshot(snapshot, options) {
  if (!snapshot || typeof snapshot !== "object") return { ok: false, code: "snapshot-shape", errors: ["snapshot must be an object"] };
  if (typeof snapshot.epoch !== "string" || !snapshot.epoch) return { ok: false, code: "snapshot-epoch", errors: ["epoch is required"] };
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) return { ok: false, code: "snapshot-revision", errors: ["revision must be positive"] };
  if (!validTime(snapshot.publishedAt)) return { ok: false, code: "snapshot-time", errors: ["publishedAt must be an ISO time"] };
  const { epoch: _epoch, revision: _revision, publishedAt: _publishedAt, ...candidate } = snapshot;
  return validateWorkCandidate(candidate, options);
}

/** Validates all source-fence fields. */
function validateFence(fence, errors) {
  if (!fence || typeof fence !== "object") { errors.push("fence must be an object"); return; }
  exactKeys(fence, WORK_DOMAINS, "fence", errors);
  for (const domain of WORK_DOMAINS) {
    const source = fence[domain];
    if (!source || typeof source !== "object") { errors.push(`fence.${domain} is required`); continue; }
    exactKeys(source, ["version", "condition"], `fence.${domain}`, errors);
    bounded(source.version, WORK_LIMITS.identity, `fence.${domain}.version`, errors);
    enumValue(source.condition, new Set(["current", "degraded"]), `fence.${domain}.condition`, errors);
  }
}

/** Validates one derived Goal state. */
function validateRowState(state, field, errors) {
  if (!state || typeof state !== "object") { errors.push(`${field} is required`); return; }
  exactKeys(state, ["code", "owner", "since", "evidence"], field, errors);
  enumValue(state.code, ROW_CODES, `${field}.code`, errors);
  enumValue(state.owner, ROW_OWNERS, `${field}.owner`, errors);
  nullableBounded(state.evidence, WORK_LIMITS.detail, `${field}.evidence`, errors);
  if (state.since !== null && !validTime(state.since)) errors.push(`${field}.since must be an ISO time or null`);
}

/** Validates one bounded Job summary. */
function validateExecution(execution, agentIds, field, errors) {
  if (execution === null) return;
  if (!execution || typeof execution !== "object") { errors.push(`${field} must be an object or null`); return; }
  exactKeys(execution, ["run", "revision", "state", "assignment", "counts"], field, errors);
  nonNegative(execution.run, `${field}.run`, errors);
  nonNegative(execution.revision, `${field}.revision`, errors);
  enumValue(execution.state, JOB_STATES, `${field}.state`, errors);
  exactKeys(execution.counts, ["total", "final", "pending"], `${field}.counts`, errors);
  for (const name of ["total", "final", "pending"]) nonNegative(execution.counts?.[name], `${field}.counts.${name}`, errors);
  const assignment = execution.assignment;
  if (assignment === null) return;
  if (!assignment || typeof assignment !== "object") { errors.push(`${field}.assignment must be an object or null`); return; }
  exactKeys(assignment, ["id", "index", "total", "kind", "state", "label", "instructionPreview", "launchRef", "agentId", "startedAt", "endedAt"], `${field}.assignment`, errors);
  bounded(assignment.id, WORK_LIMITS.identity, `${field}.assignment.id`, errors);
  nonNegative(assignment.index, `${field}.assignment.index`, errors);
  nonNegative(assignment.total, `${field}.assignment.total`, errors);
  enumValue(assignment.kind, new Set(["implementation", "review"]), `${field}.assignment.kind`, errors);
  enumValue(assignment.state, ASSIGNMENT_STATES, `${field}.assignment.state`, errors);
  bounded(assignment.label, WORK_LIMITS.label, `${field}.assignment.label`, errors);
  bounded(assignment.instructionPreview, WORK_LIMITS.instruction, `${field}.assignment.instructionPreview`, errors);
  validateLaunchRef(assignment.launchRef, `${field}.assignment.launchRef`, errors);
  if (assignment.agentId !== null && !agentIds.has(assignment.agentId)) errors.push(`${field}.assignment.agentId is missing`);
  nullableTime(assignment.startedAt, `${field}.assignment.startedAt`, errors);
  nullableTime(assignment.endedAt, `${field}.assignment.endedAt`, errors);
}

/** Validates one Agent row and its owner reference. */
function validateAgent(agent, areaIds, goalIds, brainAreas, field, errors) {
  exactKeys(agent, ["id", "target", "role", "areaId", "owner", "liveness", "activity", "activityDetail", "activitySince", "evidence", "observedAt", "contextUsedTokens", "cwd", "launchRef", "createdAt", "workTitle"], field, errors);
  bounded(agent.id, WORK_LIMITS.identity, `${field}.id`, errors);
  bounded(agent.target, WORK_LIMITS.identity, `${field}.target`, errors);
  enumValue(agent.role, AGENT_ROLES, `${field}.role`, errors);
  nullableBounded(agent.areaId, WORK_LIMITS.identity, `${field}.areaId`, errors);
  if (agent.areaId !== null && !areaIds.has(agent.areaId)) errors.push(`${field}.areaId is missing`);
  enumValue(agent.liveness, AGENT_LIVENESS, `${field}.liveness`, errors);
  enumValue(agent.activity, AGENT_ACTIVITY, `${field}.activity`, errors);
  enumValue(agent.activityDetail, AGENT_DETAILS, `${field}.activityDetail`, errors);
  nullableBounded(agent.evidence, WORK_LIMITS.detail, `${field}.evidence`, errors);
  nullableTime(agent.activitySince, `${field}.activitySince`, errors);
  nullableTime(agent.observedAt, `${field}.observedAt`, errors);
  if (agent.contextUsedTokens !== null) nonNegative(agent.contextUsedTokens, `${field}.contextUsedTokens`, errors);
  nullableBounded(agent.cwd, WORK_LIMITS.identity, `${field}.cwd`, errors);
  validateLaunchRef(agent.launchRef, `${field}.launchRef`, errors);
  nullableTime(agent.createdAt, `${field}.createdAt`, errors);
  nullableBounded(agent.workTitle, WORK_LIMITS.title, `${field}.workTitle`, errors);
  if (!agent.owner || !OWNER_KINDS.has(agent.owner.kind)) errors.push(`${field}.owner is invalid`);
  else {
    const ownerKeys = agent.owner.kind === "assignment" ? ["kind", "goalId", "run", "assignmentId"] : ["kind", "id"];
    exactKeys(agent.owner, ownerKeys, `${field}.owner`, errors);
    if (agent.owner.kind === "assignment") {
      if (!goalIds.has(agent.owner.goalId)) errors.push(`${field}.owner.goalId is missing`);
      nonNegative(agent.owner.run, `${field}.owner.run`, errors);
      bounded(agent.owner.assignmentId, WORK_LIMITS.identity, `${field}.owner.assignmentId`, errors);
    } else {
      if (agent.owner.kind === "none" && agent.owner.id !== null) errors.push(`${field}.owner.id must be null`);
      if (agent.owner.kind !== "none") bounded(agent.owner.id, WORK_LIMITS.identity, `${field}.owner.id`, errors);
      if (["brain", "repair"].includes(agent.owner.kind) && !brainAreas.has(agent.owner.id)) errors.push(`${field}.owner.id is missing`);
    }
  }
}

/** Validates bounded presentation summaries for one owner. */
function validatePresented(owner, field, errors) {
  if (!Array.isArray(owner.presented) || owner.presented.length > WORK_LIMITS.presented) errors.push(`${field}.presented exceeds its bound`);
  nonNegative(owner.morePresentedCount, `${field}.morePresentedCount`, errors);
  for (const [index, item] of (owner.presented ?? []).entries()) {
    const at = `${field}.presented[${index}]`;
    if (!item || typeof item !== "object") { errors.push(`${at} must be an object`); continue; }
    if (item.type === "document") {
      exactKeys(item, ["type", "id", "file", "root", "repository", "title", "note", "presentedBy", "presentedHash"], at, errors);
      bounded(item.id, WORK_LIMITS.identity, `${at}.id`, errors);
      bounded(item.file, WORK_LIMITS.identity, `${at}.file`, errors);
      enumValue(item.root, new Set(["vault", "repository"]), `${at}.root`, errors);
      nullableBounded(item.repository, WORK_LIMITS.identity, `${at}.repository`, errors);
      bounded(item.title, WORK_LIMITS.title, `${at}.title`, errors);
      nullableBounded(item.note, WORK_LIMITS.detail, `${at}.note`, errors);
      bounded(item.presentedBy, WORK_LIMITS.identity, `${at}.presentedBy`, errors);
      bounded(item.presentedHash, WORK_LIMITS.identity, `${at}.presentedHash`, errors);
    } else if (item.type === "card") {
      exactKeys(item, ["type", "id", "kind", "title", "summary", "presentedBy", "presenterLive"], at, errors);
      bounded(item.id, WORK_LIMITS.identity, `${at}.id`, errors);
      enumValue(item.kind, CARD_KINDS, `${at}.kind`, errors);
      bounded(item.title, WORK_LIMITS.title, `${at}.title`, errors);
      bounded(item.summary, WORK_LIMITS.detail, `${at}.summary`, errors);
      bounded(item.presentedBy, WORK_LIMITS.identity, `${at}.presentedBy`, errors);
      if (item.presenterLive !== null && typeof item.presenterLive !== "boolean") errors.push(`${at}.presenterLive must be a boolean or null`);
    } else errors.push(`${at}.type is invalid`);
  }
}

/** Validates one optional harness launch reference. */
function validateLaunchRef(value, field, errors) {
  if (value === null) return;
  if (!value || typeof value !== "object") { errors.push(`${field} must be an object or null`); return; }
  exactKeys(value, ["harness", "model", "effort"], field, errors);
  bounded(value.harness, WORK_LIMITS.label, `${field}.harness`, errors);
  nullableBounded(value.model, WORK_LIMITS.label, `${field}.model`, errors);
  nullableBounded(value.effort, WORK_LIMITS.label, `${field}.effort`, errors);
}

/** Rejects missing and extra object fields. */
function exactKeys(value, allowed, field, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push(`${field} must be an object`); return; }
  const expected = new Set(allowed);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${field}.${key} is not allowed`);
  for (const key of expected) if (!Object.hasOwn(value, key)) errors.push(`${field}.${key} is required`);
}

/** Collects unique row identities and records duplicates. */
function uniqueIds(rows, key, label, errors) {
  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    const id = row?.[key];
    if (typeof id !== "string" || !id) errors.push(`${label}[${index}].${key} is required`);
    else if (ids.has(id)) errors.push(`${label}[${index}].${key} is duplicated`);
    else ids.add(id);
  }
  return ids;
}

/** Validates one required bounded string. */
function bounded(value, limit, field, errors) {
  if (typeof value !== "string" || !value) errors.push(`${field} must be a non-empty string`);
  else if (value.length > limit) errors.push(`${field} exceeds ${limit} characters`);
}

/** Validates one optional bounded string. */
function nullableBounded(value, limit, field, errors) {
  if (value === null) return;
  if (typeof value !== "string" || value.length > limit) errors.push(`${field} must be null or at most ${limit} characters`);
}

/** Validates one optional ISO time. */
function nullableTime(value, field, errors) {
  if (value !== null && !validTime(value)) errors.push(`${field} must be an ISO time or null`);
}

/** Validates one enum member. */
function enumValue(value, values, field, errors) {
  if (!values.has(value)) errors.push(`${field} is invalid`);
}

/** Validates one non-negative integer. */
function nonNegative(value, field, errors) {
  if (!Number.isInteger(value) || value < 0) errors.push(`${field} must be a non-negative integer`);
}

/** Validates deterministic row ordering. */
function ordered(rows, key, label, errors) {
  for (let index = 1; index < rows.length; index += 1) if (key(rows[index - 1]) > key(rows[index])) {
    errors.push(`${label} are not in canonical order`);
    return;
  }
}

/** Returns whether a value is a valid ISO-compatible time. */
function validTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
