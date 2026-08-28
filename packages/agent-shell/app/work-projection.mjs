import { createHash } from "node:crypto";

const FINAL_ASSIGNMENT = new Set(["complete", "ended", "skipped"]);

/** Keeps one Goal's fields that current Work and navigation surfaces read. */
export function projectWorkGoal(goal) {
  const fields = [
    "file", "slug", "area", "title", "status", "doneWhen", "verify", "process",
    "depth", "order", "subgoals", "subgoalItems", "dependencySlugs", "dependsOn",
    "requiredBy", "unresolvedDependencies", "waitingOn", "session", "brainSessionBinding",
    "due", "agents",
    "mtime", "changedAt", "createdAt", "firstStartAt", "lastEndAt", "presentations", "cards",
  ];
  return Object.fromEntries(fields.filter((field) => goal?.[field] !== undefined).map((field) => [field, goal[field]]));
}

/** Keeps only the Document metadata required by list and link surfaces. */
function projectWorkDocument(document) {
  const fields = ["file", "title", "kind", "area", "docKind", "mtime", "changedAt", "root", "repository", "presentedBy", "presentedAt", "note"];
  return Object.fromEntries(fields.filter((field) => document?.[field] !== undefined).map((field) => [field, document[field]]));
}

/** Removes complete Markdown and duplicate Goal bodies from the vault read model. */
export function projectWorkVault(vault) {
  const areas = (vault?.areas ?? []).map((area) => ({
    path: area.path,
    name: area.name,
    parent: area.parent ?? null,
    children: area.children ?? [],
    status: area.status ?? "",
    type: area.type,
    purpose: area.purpose ?? "",
    current: area.current ?? "",
    people: area.people ?? "",
    noteSignal: area.noteSignal ?? null,
    presentations: area.presentations ?? [],
    goals: (area.goals ?? []).map(projectWorkGoal),
    documentFiles: (area.documents ?? []).map((document) => document.file),
  }));
  const goals = new Map(areas.flatMap((area) => area.goals.map((goal) => [goal.file, goal])));
  const map = (vault?.map ?? []).map((group) => ({
    path: group.path,
    goalFiles: (group.goals ?? []).map((goal) => goal.file).filter((file) => goals.has(file)),
  }));
  return {
    areas,
    map,
    documents: (vault?.documents ?? []).map(projectWorkDocument),
    desk: vault?.desk ?? { attention: {}, panels: [] },
    closes: vault?.closes ?? [],
    recentCloses: vault?.recentCloses ?? [],
    projection: vault?.projection ?? null,
  };
}

/** Projects one assignment without durable report, attempt, or handover bodies. */
export function projectWorkAssignment(step) {
  return {
    id: step.id,
    index: step.index,
    kind: step.kind,
    status: step.status,
    instruction: String(step.instruction ?? "").slice(0, 240),
    command: step.command ?? null,
    launch: step.launch ?? null,
    launchSource: step.launchSource ?? null,
    launchDisclosure: step.launchDisclosure ?? null,
    path: step.path ?? null,
    session: step.session ?? null,
    startedAt: step.startedAt ?? null,
    endedAt: step.endedAt ?? null,
    live: Boolean(step.live),
    state: step.state ?? null,
    stateDetail: step.stateDetail ?? null,
    idleSince: step.idleSince ?? null,
    waitingSince: step.waitingSince ?? null,
    context: step.context ?? null,
    attemptCount: step.attempts?.length ?? 0,
    reportCount: step.reports?.length ?? 0,
  };
}

/** Projects queue state for Work without serializing its historical text. */
export function projectWorkQueue(record) {
  const source = record?.assignments ?? record?.steps ?? [];
  const steps = source.filter((step) => !FINAL_ASSIGNMENT.has(step.status)).map(projectWorkAssignment);
  return {
    schema: "agent-shell-work-queue.v1",
    goal: record.goal,
    area: record.area,
    slug: record.slug,
    revision: record.revision,
    status: record.status,
    migrationProblem: record.migrationProblem ?? null,
    currentAssignmentId: record.currentAssignmentId ?? null,
    updatedAt: record.updatedAt ?? null,
    counts: {
      total: steps.length,
      final: source.filter((step) => FINAL_ASSIGNMENT.has(step.status)).length,
      pending: source.filter((step) => step.status === "pending").length,
    },
    steps,
  };
}

/** Removes durable generations and notice bodies from one live brain row. */
export function projectWorkBrain(brain) {
  const fields = [
    "area", "status", "session", "generation", "currentAttemptId", "updatedAt", "resolvedLaunch",
    "live", "state", "stateDetail", "stateQuestion", "idleSince", "waitingSince", "health", "recovery",
    "forJulian", "requests",
  ];
  return Object.fromEntries(fields.filter((field) => brain?.[field] !== undefined).map((field) => [field, brain[field]]));
}

/** Creates one compact browser refresh response and its semantic content hash. */
export function projectWork({ vault, session, programs }) {
  const projectedVault = projectWorkVault(vault);
  const queues = new Map((session?.pipelines ?? []).map(projectWorkQueue).map((queue) => [queue.goal, queue]));
  const brains = new Map((session?.brains ?? []).map(projectWorkBrain).map((brain) => [brain.area, brain]));
  projectedVault.areas = projectedVault.areas.map((area) => ({
    ...area,
    brain: brains.get(area.path) ?? null,
    goals: area.goals.map((goal) => ({ ...goal, run: queues.get(goal.file) ?? null })),
  }));
  const runtime = session?.runtime ? {
    instanceId: session.runtime.instanceId,
    ownershipKey: session.runtime.ownershipKey,
  } : undefined;
  const { pipelines: _pipelines, brains: _brains, ...sessionSummary } = session ?? {};
  const value = {
    schema: "agent-shell-work.v1",
    vault: projectedVault,
    session: {
      ...sessionSummary,
      runtime,
    },
    programs,
  };
  const body = JSON.stringify(value);
  return { value, body, etag: `"${createHash("sha256").update(body).digest("hex")}"`, bytes: Buffer.byteLength(body) };
}
