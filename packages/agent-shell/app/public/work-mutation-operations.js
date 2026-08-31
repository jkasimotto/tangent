/** Owns safe optimistic Work mutations until a fresh projection proves them. */
export function createWorkMutationOperations({ now = () => performance.now(), record = () => {}, onWarning = () => {}, schedule = globalThis.setTimeout?.bind(globalThis), cancel = globalThis.clearTimeout?.bind(globalThis) } = {}) {
  const operations = new Map();

  /** Returns the stable in-memory key for one semantic target. */
  function key(kind, target) { return `${kind}:${target}`; }

  /** Starts one semantic operation. Repeated final input joins the first request. */
  function begin(kind, target, detail = {}) {
    const identity = key(kind, target);
    const existing = operations.get(identity);
    if (existing && !["rolled-back", "complete"].includes(existing.state)) {
      record("work-mutation", "duplicate-suppressed", { operationId: existing.operationId, phase: kind });
      return { operation: existing, repeated: true };
    }
    const operation = {
      kind, target, operationId: crypto.randomUUID(), state: "submitting", startedAt: now(),
      detail, response: null, warning: "",
    };
    operations.set(identity, operation);
    record("work-mutation", "final-input", { operationId: operation.operationId, phase: kind });
    if (schedule) {
      operation.timers = [schedule(() => {
        if (operation.state === "submitting") { operation.warning = `Still ${kind}ing`; onWarning(operation); }
      }, 2_000),
      schedule(() => {
        if (["submitting", "reconciling"].includes(operation.state)) { operation.warning = `${kind} is taking longer than expected. Use Refresh to reconcile.`; onWarning(operation); }
      }, 5_000)];
    }
    return { operation, repeated: false };
  }

  /** Records the authoritative response but keeps the overlay until Work converges. */
  function committed(operation, response) {
    if (operations.get(key(operation.kind, operation.target)) !== operation) {
      record("work-mutation", "stale-response-suppressed", { operationId: operation.operationId, phase: operation.kind });
      return false;
    }
    operation.response = response;
    for (const timer of operation.timers ?? []) cancel?.(timer);
    operation.timers = [];
    operation.state = response?.state === "cleanup-pending" ? "reconciling" : "reconciling";
    if (schedule) operation.timers = [schedule(() => {
      if (operation.state === "reconciling") { operation.warning = `${operation.kind} is taking longer than expected. Use Refresh to reconcile.`; onWarning(operation); }
    }, 5_000)];
    record("work-mutation", "mutation-effect", { operationId: operation.operationId, phase: operation.kind, durationMs: now() - operation.startedAt, outcome: response?.state ?? "committed" });
    return true;
  }

  /** Removes one rejected overlay so the saved projection paints again. */
  function rollback(operation, error) {
    if (operations.get(key(operation.kind, operation.target)) !== operation) return false;
    operation.state = "rolled-back";
    for (const timer of operation.timers ?? []) cancel?.(timer);
    operation.error = String(error?.message ?? error ?? "The action was rejected.");
    operations.delete(key(operation.kind, operation.target));
    record("work-mutation", "rollback", { operationId: operation.operationId, phase: operation.kind, durationMs: now() - operation.startedAt, outcome: "rejected" });
    return true;
  }

  /** True when an unmodified projection proves the operation's intended effect. */
  function converged(operation, vault, sessions) {
    if (operation.kind === "dismiss") {
      return !(vault?.areas ?? []).some((area) => (area.presentations ?? []).some((item) => `${area.path}\0${item.file}` === operation.target)
        || (area.goals ?? []).some((goal) => (goal.presentations ?? []).some((item) => `${goal.file}\0${item.file}` === operation.target)));
    }
    if (operation.kind === "park") return !(vault?.areas ?? []).some((area) => (area.goals ?? []).some((goal) => goal.file === operation.target && goal.status !== "parked"));
    if (operation.kind === "stop") return !(sessions ?? []).some((session) => `${session.name}\0${session.target ?? ""}` === operation.target);
    return false;
  }

  /** Merges pending effects into any Work response, so stale data cannot resurrect rows. */
  function merge(vault, sessions) {
    for (const operation of [...operations.values()]) {
      if (operation.state === "reconciling" && converged(operation, vault, sessions)) {
        for (const timer of operation.timers ?? []) cancel?.(timer);
        operation.state = "complete";
        operations.delete(key(operation.kind, operation.target));
        record("work-mutation", "projection-converged", { operationId: operation.operationId, phase: operation.kind, durationMs: now() - operation.startedAt, outcome: "committed" });
        continue;
      }
      if (operation.kind === "dismiss") {
        for (const area of vault?.areas ?? []) {
          area.presentations = (area.presentations ?? []).filter((item) => `${area.path}\0${item.file}` !== operation.target);
          for (const goal of area.goals ?? []) goal.presentations = (goal.presentations ?? []).filter((item) => `${goal.file}\0${item.file}` !== operation.target);
        }
      } else if (operation.kind === "park") {
        for (const area of vault?.areas ?? []) area.goals = (area.goals ?? []).filter((goal) => goal.file !== operation.target);
      } else if (operation.kind === "stop") {
        for (const session of sessions ?? []) {
          if (`${session.name}\0${session.target ?? ""}` !== operation.target) continue;
          session.pendingStop = true;
          for (const area of vault?.areas ?? []) if (area.brain?.session === session.name) area.brain.pendingStop = true;
        }
      }
    }
    return { vault, sessions };
  }

  return { begin, committed, merge, rollback, operations };
}

export default { createWorkMutationOperations };
