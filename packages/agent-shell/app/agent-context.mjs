// Durable recovery context for a Tangent-managed tmux session. This module is
// pure: it projects brain, Goal, and queue records without observing, claiming,
// typing into, or otherwise mutating the live session.

import { normalizeGoalStatus } from "./goal-lifecycle.mjs";

export const AGENT_CONTEXT_SCHEMA = "tangent-agent-context.v1";

const CURRENT_ASSIGNMENT_STATUSES = new Set(["running", "waiting"]);

/**
 * Resolves the durable work that belongs to one session name. Current records
 * win over historical attempts, so a continued queue that reused one tmux
 * session resumes its newest current assignment.
 */
export function resolveAgentContext({ session, brains = [], pipelines = [], goals = [], notices = [] } = {}) {
  const name = String(session ?? "").trim();
  if (!name) return null;

  const brain = currentBrainMatch(brains, name) ?? historicalBrainMatch(brains, name);
  if (brain) return brainContext(name, brain.record, brain.generation, notices);

  const queueMatch = pipelineMatch(pipelines, name);
  if (queueMatch) return assignmentContext(name, queueMatch, goals);

  const boundGoals = goals.filter((item) => item?.session === name);
  return boundGoals.length ? plainGoalContext(name, boundGoals[0], boundGoals) : null;
}

/** Projects a live tmux session that has no durable Tangent work binding. */
export function unassignedAgentContext(session) {
  const name = String(session ?? "").trim();
  if (!name) return null;
  return {
    schema: AGENT_CONTEXT_SCHEMA,
    source: "live-session",
    session: name,
    role: "unassigned",
    area: null,
    current: true,
    prompt: null,
    unreadNotices: [],
    message: "This live tmux session has no durable Tangent brain or Goal assignment.",
  };
}

/** Returns the current brain generation bound to a session, if one exists. */
function currentBrainMatch(brains, session) {
  const record = brains.find((item) => item?.session === session);
  if (!record) return null;
  const generation = [...(record.generations ?? [])].reverse().find((item) => item?.session === session) ?? null;
  return { record, generation };
}

/** Returns a historical brain generation bound to a session, if one exists. */
function historicalBrainMatch(brains, session) {
  for (const record of brains) {
    const generation = [...(record?.generations ?? [])].reverse().find((item) => item?.session === session);
    if (generation) return { record, generation };
  }
  return null;
}

/** Projects one logical brain and every currently unread durable notice. */
function brainContext(session, record, generation, notices) {
  const current = record.status === "active" && record.session === session;
  return {
    schema: AGENT_CONTEXT_SCHEMA,
    source: "brain-record",
    session,
    role: "brain",
    area: record.area,
    current,
    brain: {
      status: record.status,
      generation: generation?.generation ?? (record.session === session ? record.generation ?? null : null),
      planFile: record.planFile ?? null,
      foundingInstruction: String(record.foundingInstruction?.text ?? record.instruction ?? ""),
      checkpoint: String(current ? record.checkpoint?.text ?? generation?.handover ?? "" : generation?.handover ?? ""),
      attempt: generation ? projectBrainGeneration(generation) : null,
    },
    unreadNotices: (current ? notices : [])
      .filter((notice) => !notice?.deliveredAt)
      .map((notice) => ({
        id: notice.id,
        area: notice.area ?? record.area,
        text: String(notice.text ?? ""),
        createdAt: notice.createdAt ?? null,
        sourceId: notice.sourceId ?? null,
      })),
  };
}

/** Keeps only durable generation facts useful to a replacement harness. */
function projectBrainGeneration(generation) {
  return {
    generation: generation.generation ?? null,
    session: generation.session ?? null,
    startedAt: generation.startedAt ?? null,
    endedAt: generation.endedAt ?? null,
    handover: generation.handover ?? null,
    resolvedLaunch: generation.resolvedLaunch ?? null,
  };
}

/** Finds the best queue assignment associated with one current or old session. */
function pipelineMatch(pipelines, session) {
  const matches = [];
  for (const record of pipelines) {
    for (const assignment of record?.steps ?? record?.assignments ?? []) {
      const attempt = [...(assignment.attempts ?? [])].reverse().find((item) => item?.session === session) ?? null;
      if (assignment.session !== session && !attempt) continue;
      const current = assignment.session === session && CURRENT_ASSIGNMENT_STATUSES.has(assignment.status);
      matches.push({ record, assignment, attempt, current });
    }
  }
  matches.sort((left, right) => Number(right.current) - Number(left.current)
    || Number(right.assignment.index ?? 0) - Number(left.assignment.index ?? 0));
  return matches[0] ?? null;
}

/** Projects one managed queue assignment with its exact durable input and history. */
function assignmentContext(session, { record, assignment, attempt, current }, goals) {
  const steps = record.steps ?? record.assignments ?? [];
  const goal = goals.find((item) => item?.file === record.goal) ?? null;
  const extraGoals = coAssignedGoals({
    session,
    primaryFile: record.goal,
    explicitFiles: record.extraFiles,
    goals,
  });
  return {
    schema: AGENT_CONTEXT_SCHEMA,
    source: "goal-queue",
    session,
    role: "worker",
    area: record.area,
    current,
    goal: projectGoal(goal, record),
    queue: {
      goal: record.goal,
      slug: record.slug ?? goal?.slug ?? null,
      status: record.status,
      revision: record.revision ?? null,
      currentAssignmentId: record.currentAssignmentId ?? null,
      controllerArea: record.controllerArea ?? record.area,
      extraFiles: [...(record.extraFiles ?? [])].map(String),
      assignments: steps.map(projectAssignmentSummary),
    },
    extraGoals,
    assignment: {
      id: assignment.id,
      index: assignment.index,
      total: steps.length,
      kind: assignment.kind ?? "implementation",
      status: assignment.status,
      instruction: String(assignment.instruction ?? ""),
      session: assignment.session ?? null,
      startedAt: assignment.startedAt ?? null,
      endedAt: assignment.endedAt ?? null,
      launch: assignment.launch ?? null,
      launchDisclosure: assignment.launchDisclosure ?? null,
      command: assignment.command ?? "",
      label: assignment.label ?? "",
      path: assignment.path ?? null,
      attempt: attempt ?? [...(assignment.attempts ?? [])].reverse().find((item) => item?.session === session) ?? null,
      reports: [...(assignment.reports ?? [])],
    },
    priorHandovers: steps
      .filter((item) => Number(item.index) < Number(assignment.index) && (item.handover || item.reports?.length))
      .map((item) => ({
        assignmentId: item.id,
        index: item.index,
        status: item.status,
        handover: item.handover ?? null,
        reports: [...(item.reports ?? [])],
      })),
  };
}

/** Projects the fields that let a replacement understand the whole queue. */
function projectAssignmentSummary(assignment) {
  return {
    id: assignment.id,
    index: assignment.index,
    kind: assignment.kind ?? "implementation",
    status: assignment.status,
    instruction: String(assignment.instruction ?? ""),
    session: assignment.session ?? null,
    handover: assignment.handover ?? null,
  };
}

/** Projects one Goal without exposing unrelated parser or filesystem fields. */
function projectGoal(goal, record = null) {
  return {
    slug: goal?.slug ?? record?.slug ?? null,
    file: goal?.file ?? record?.goal ?? null,
    area: goal?.area ?? record?.area ?? null,
    title: goal?.title ?? record?.slug ?? "",
    status: goal?.status == null ? null : normalizeGoalStatus(goal.status),
    doneWhen: goal?.doneWhen ?? "",
    myUnderstanding: goal?.myUnderstanding ?? "",
    subgoals: [...(goal?.subgoals ?? [])],
  };
}

/** Projects a non-queue Goal binding for legacy and conversational workers. */
function plainGoalContext(session, goal, boundGoals) {
  return {
    schema: AGENT_CONTEXT_SCHEMA,
    source: "goal-record",
    session,
    role: "worker",
    area: goal.area,
    current: goal.status === "active" && goal.session === session,
    goal: projectGoal(goal),
    extraGoals: coAssignedGoals({ session, primaryFile: goal.file, goals: boundGoals }),
    queue: null,
    assignment: null,
    priorHandovers: [],
  };
}

/**
 * Projects every other Goal assigned to the same worker session. A queue's
 * `extraFiles` order is authoritative and survives after Goal bindings move;
 * any additional same-session bindings follow in their durable vault order.
 */
function coAssignedGoals({ session, primaryFile, explicitFiles = [], goals = [] }) {
  const byFile = new Map(goals.filter((goal) => goal?.file).map((goal) => [goal.file, goal]));
  const files = [
    ...(Array.isArray(explicitFiles) ? explicitFiles : []),
    ...goals.filter((goal) => goal?.session === session).map((goal) => goal.file),
  ];
  const seen = new Set([primaryFile]);
  const projected = [];
  for (const value of files) {
    const file = String(value ?? "").trim();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const goal = byFile.get(file);
    if (goal) projected.push(projectGoal(goal));
  }
  return projected;
}
