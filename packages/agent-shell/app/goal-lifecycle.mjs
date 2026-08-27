const WRITABLE_GOAL_STATUSES = new Set(["open", "done", "dropped", "parked"]);
const TERMINAL_GOAL_STATUSES = new Set(["done", "dropped"]);
const DEFAULT_HIDDEN_GOAL_STATUSES = new Set(["done", "dropped", "parked"]);

/** Exposes the legacy Deferred value as Parked everywhere outside storage migration. */
export function normalizeGoalStatus(status) {
  const value = String(status ?? "open").trim() || "open";
  return value === "deferred" ? "parked" : value;
}

/** Normalizes one Goal and its relationship status projections. */
export function normalizeGoalRecord(goal) {
  if (!goal || typeof goal !== "object") return goal;
  return {
    ...goal,
    status: normalizeGoalStatus(goal.status),
    dependsOn: normalizeGoalReferences(goal.dependsOn),
    requiredBy: normalizeGoalReferences(goal.requiredBy),
    subgoalItems: normalizeGoalReferences(goal.subgoalItems),
    why: normalizeGoalReferences(goal.why),
  };
}

/** True when the Goal has a terminal outcome. Park remains reversible. */
export function goalIsTerminal(status) {
  return TERMINAL_GOAL_STATUSES.has(normalizeGoalStatus(status));
}

/** True when default Work hides this Goal. */
export function goalIsHiddenByDefault(status) {
  return DEFAULT_HIDDEN_GOAL_STATUSES.has(normalizeGoalStatus(status));
}

/** True while this Goal remains an unresolved prerequisite. */
export function goalIsUnresolved(status) {
  return normalizeGoalStatus(status) !== "done";
}

/**
 * Validates one direct lifecycle request and returns its canonical write.
 * New writes never produce the retired Deferred value.
 */
export function goalStatusChange(currentStatus, requestedStatus, reason = "") {
  const from = normalizeGoalStatus(currentStatus);
  const raw = String(requestedStatus ?? "").trim();
  if (raw === "deferred") throw lifecycleError("status-retired", "write parked instead of deferred");
  const to = normalizeGoalStatus(raw);
  if (!WRITABLE_GOAL_STATUSES.has(to)) {
    throw lifecycleError("invalid-status", `status must be open, done, dropped, or parked, got "${raw}"`);
  }
  const note = oneLine(reason);
  if (to === "dropped" && !note) {
    throw lifecycleError("reason-required", "give a brief reason before you mark this Goal won't do");
  }
  return {
    from,
    status: to,
    reason: to === "dropped" || to === "parked" ? note || null : null,
    changed: from !== to,
    reopened: to === "open" && from !== "open" && from !== "active",
  };
}

/** True when Park must warn that a live worker can be detached or retired. */
export function parkingNeedsConfirmation(goal) {
  return normalizeGoalStatus(goal?.status) === "active" || Boolean(goal?.session);
}

/** Normalizes status values embedded in Goal relationship projections. */
function normalizeGoalReferences(references) {
  return Array.isArray(references)
    ? references.map((reference) => reference && typeof reference === "object"
      ? { ...reference, status: normalizeGoalStatus(reference.status) }
      : reference)
    : references;
}

/** Collapses a short lifecycle reason to one durable line. */
function oneLine(value) {
  return String(value ?? "").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Creates one lifecycle validation error with a stable code. */
function lifecycleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
