import { normalizeGoalRecord, normalizeGoalStatus } from "./goal-lifecycle.mjs";

/**
 * Builds the complete Goal reader model from authoritative server inputs.
 * The caller reads files and runtime state. This pure projection keeps the
 * browser and CLI from recalculating status, blockers, or command reasons.
 */
export function projectGoalDetail({
  goal,
  markdown = "",
  relatedDocuments = null,
  cards = null,
  commands = null,
} = {}) {
  if (!goal?.file) throw new Error("Goal detail needs one Goal record.");
  const normalizedGoal = normalizeGoalRecord(goal);
  const prerequisites = normalizedGoal.dependsOn ?? [];
  const unresolvedReferences = [...(normalizedGoal.unresolvedDependencies ?? [])];
  const unfinished = prerequisites.filter((item) => normalizeGoalStatus(item.status) !== "done");
  const broken = unfinished.filter((item) => normalizeGoalStatus(item.status) === "dropped");
  const blockers = [
    ...unfinished,
    ...unresolvedReferences.map((slug) => ({ kind: "missing", slug, title: slug, status: "missing" })),
  ];
  const dependencies = {
    prerequisites,
    requiredBy: normalizedGoal.requiredBy ?? [],
    unresolvedReferences,
    blockers,
    broken,
    blocked: blockers.length > 0,
  };
  return {
    goal: normalizedGoal,
    markdown: String(markdown || goal.text || ""),
    dependencies,
    relatedDocuments: structuredClone(relatedDocuments ?? normalizedGoal.documents ?? []),
    cards: structuredClone(cards ?? normalizedGoal.cards ?? []),
    commands: normalizeCommands(commands ?? defaultGoalCommands()),
  };
}

/** Derives baseline command availability from Goal and queue authority. */
function defaultGoalCommands() {
  return [
    { id: "read", label: "Read Goal", enabled: true, reason: null },
    { id: "status", label: "Goal status", enabled: true, reason: null },
  ];
}

/** Gives every command an explicit enabled state and disabled reason. */
function normalizeCommands(commands) {
  return (Array.isArray(commands) ? commands : []).map((command) => {
    const enabled = command?.enabled !== false;
    return {
      ...command,
      id: String(command?.id ?? ""),
      label: String(command?.label ?? command?.id ?? ""),
      enabled,
      reason: enabled ? null : String(command?.reason ?? "This action is unavailable."),
    };
  });
}
