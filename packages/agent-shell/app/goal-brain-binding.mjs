import { SETTLED_GOAL_STATUSES } from "./goal-lifecycle.mjs";

/** Quarantines an invalid Area-brain binding without changing its source. */
export function withoutBrainGoalBinding(goal, brainSessions) {
  const session = String(goal?.session ?? "").trim();
  if (!session || !brainSessions?.has(session)) return goal;
  return {
    ...goal,
    status: SETTLED_GOAL_STATUSES.has(goal.status) ? goal.status : "open",
    session: null,
    brainSessionBinding: session,
  };
}

/** Quarantines every Goal copy in the cached vault projection. */
export function withoutBrainGoalBindings(vault, brainSessions) {
  if (!brainSessions?.size) return vault;
  /** Projects the Goal list for each Area-shaped row. */
  const projectRows = (rows) => (rows ?? []).map((row) => ({
    ...row,
    goals: (row.goals ?? []).map((goal) => withoutBrainGoalBinding(goal, brainSessions)),
  }));
  return { ...vault, areas: projectRows(vault.areas), map: projectRows(vault.map) };
}
