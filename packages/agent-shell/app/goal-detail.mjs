import { normalizeGoalRecord, normalizeGoalStatus } from "./goal-lifecycle.mjs";
import { resumeCommand } from "./harness-conversation.mjs";

/**
 * Builds the complete Goal reader model from authoritative server inputs.
 * The caller reads files and runtime state. This pure projection keeps the
 * browser and CLI from recalculating status, blockers, or command reasons.
 */
export function projectGoalDetail({
  goal,
  markdown = "",
  queue = null,
  sessions = [],
  relatedDocuments = null,
  commands = null,
  registry = null,
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
  const assignments = queue?.steps ?? queue?.assignments ?? [];
  const currentAssignment = assignments.find((assignment) => assignment.id === queue?.currentAssignmentId)
    ?? assignments.find((assignment) => ["running", "waiting", "stopped"].includes(assignment.status))
    ?? null;
  const currentAttempt = currentAssignment?.attempts?.findLast?.((attempt) => !attempt.endedAt)
    ?? currentAssignment?.attempts?.at(-1)
    ?? null;
  const sessionNames = new Set([
    normalizedGoal.session,
    ...assignments.flatMap((assignment) => [assignment.session, ...(assignment.attempts ?? []).map((attempt) => attempt.session)]),
  ].filter(Boolean));
  const relatedSessions = sessions.filter((session) => sessionNames.has(session.name) || session.goal === normalizedGoal.file);
  const liveNames = new Set(sessions.map((session) => session.name));
  const attempts = assignments.flatMap((assignment) => (assignment.attempts ?? []).map((attempt) => ({
    assignmentId: assignment.id,
    assignmentIndex: assignment.index,
    assignmentInstruction: assignment.instruction,
    assignmentStatus: assignment.status,
    ...structuredClone(attempt),
    resolvedLaunch: attempt.resolvedLaunch ?? null,
    current: assignment.id === currentAssignment?.id && attempt.id === currentAttempt?.id,
    resume: attemptResume(attempt, registry, liveNames),
  })));
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
    queue: queue ? structuredClone(queue) : null,
    sessions: structuredClone(relatedSessions),
    attempts,
    current: currentAssignment ? {
      assignmentId: currentAssignment.id,
      attemptId: currentAttempt?.id ?? null,
      session: currentAttempt?.session ?? currentAssignment.session ?? normalizedGoal.session ?? null,
    } : null,
    commands: normalizeCommands(commands ?? defaultGoalCommands(normalizedGoal, dependencies, currentAssignment, currentAttempt)),
  };
}

/**
 * How one attempt is resumed (ADR-0042): attach while its session lives, else
 * the harness's resume command with the attempt's conversation id. `command`
 * is null when the harness has no `resume` or no id was recorded.
 */
function attemptResume(attempt, registry, liveNames) {
  const harnessId = attempt?.resolvedLaunch?.ref?.harness ?? null;
  const harness = (registry?.harnesses ?? []).find((entry) => entry.id === harnessId) ?? null;
  const live = Boolean(attempt?.session && liveNames.has(attempt.session) && !attempt.endedAt);
  return {
    live,
    session: attempt?.session ?? null,
    cwd: attempt?.cwd ?? null,
    harness: harnessId,
    conversationId: attempt?.providerSession?.id ?? null,
    command: resumeCommand(harness, { command: attempt?.resolvedLaunch?.command ?? "", id: attempt?.providerSession?.id ?? "" }),
    contextFill: attempt?.contextFill ?? null,
  };
}

/** Derives baseline command availability from Goal and queue authority. */
function defaultGoalCommands(goal, dependencies, assignment, attempt) {
  const status = normalizeGoalStatus(goal.status);
  const startReason = status !== "open"
    ? status === "active" ? "This Goal already has a live owner." : `This Goal is ${status}.`
    : dependencies.blocked ? "This Goal has unfinished or missing prerequisites."
      : assignment ? "This Goal already has a current assignment." : null;
  return [
    { id: "read", label: "Read Goal", enabled: true, reason: null },
    { id: "start", label: "Start agent", enabled: !startReason, reason: startReason },
    { id: "change-agent", label: "Change agent", enabled: Boolean(assignment && attempt), reason: assignment && attempt ? null : "This Goal has no current attempt." },
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
