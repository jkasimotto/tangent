import type { AgentRun, AttentionItem, Capture, Checkpoint, TreeObservation, WorkSession } from "@tangent/trees-schema";

export type AgentStatusProjection = {
  status: AgentRun["status"];
  reason: string;
  confidence: AgentRun["statusConfidence"];
  sourceObservationIds: string[];
  lastActivityAt?: string;
};

export type AttentionThresholds = {
  interactiveQuietMs: number;
  longRunningQuietMs: number;
  estimateMultiplier: number;
  captureAgeMs: number;
  dirtyWorktreeWarningAgeMs: number;
};

export type GenerateAttentionInput = {
  now?: string;
  agentRuns?: AgentRun[];
  workSessions?: WorkSession[];
  captures?: Capture[];
  observations?: TreeObservation[];
  checkpoints?: Checkpoint[];
  thresholds?: Partial<AttentionThresholds>;
};

export const defaultAttentionThresholds: AttentionThresholds = {
  interactiveQuietMs: 10 * 60 * 1000,
  longRunningQuietMs: 30 * 60 * 1000,
  estimateMultiplier: 1.25,
  captureAgeMs: 24 * 60 * 60 * 1000,
  dirtyWorktreeWarningAgeMs: 60 * 60 * 1000
};

/** Documents the resolveAgentRunStatus helper. */
export function resolveAgentRunStatus(input: {
  observations: TreeObservation[];
  agentRun?: AgentRun;
  quietThresholdMs?: number;
  now?: string;
}): AgentStatusProjection {
  const observations = [...input.observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const sourceObservationIds: string[] = [];
  /** Documents the latest helper. */
  const latest = (kind: TreeObservation["kind"]) => observations.filter((obs) => obs.kind === kind).at(-1);
  const openPermission = latest("agent.permission_requested");
  const permissionResolved = latest("agent.permission_resolved");
  if (openPermission && (!permissionResolved || permissionResolved.observedAt < openPermission.observedAt)) {
    return status("waiting_permission", "agent requested permission", openPermission.confidence, [openPermission.id], latestActivity(observations));
  }

  const failedStatus = findLast(observations, (obs) => obs.kind === "agent.status" && obs.data.status === "failed");
  const failedExit = findLast(observations, (obs) => obs.kind === "process.exited" && numberValue(obs.data.exitCode) !== 0);
  if (failedStatus || failedExit) {
    const obs = failedStatus || failedExit!;
    return status("failed", failedStatus ? "provider reported failure" : `process exited ${String(failedExit!.data.exitCode)}`, obs.confidence, [obs.id], latestActivity(observations));
  }

  const cancelled = findLast(observations, (obs) => obs.kind === "agent.status" && obs.data.status === "cancelled");
  if (cancelled) return status("cancelled", "provider reported cancellation", cancelled.confidence, [cancelled.id], latestActivity(observations));

  const doneStatus = findLast(observations, (obs) => obs.kind === "agent.status" && obs.data.status === "done");
  const cleanExit = findLast(observations, (obs) => obs.kind === "process.exited" && numberValue(obs.data.exitCode) === 0);
  if (doneStatus || cleanExit) {
    const obs = doneStatus || cleanExit!;
    return status("done", doneStatus ? "provider reported completion" : "process exited 0", obs.confidence, [obs.id], latestActivity(observations));
  }

  const blocked = findLast(observations, (obs) => obs.kind === "agent.status" && obs.data.status === "blocked");
  if (blocked) return status("blocked", "provider reported blocked", blocked.confidence, [blocked.id], latestActivity(observations));

  const started = latest("process.started") || findLast(observations, (obs) => obs.kind === "agent.status" && obs.data.status === "running");
  if (started || input.agentRun?.status === "running" || input.agentRun?.status === "starting") {
    sourceObservationIds.push(...(started ? [started.id] : []));
    const activity = latestActivity(observations) || input.agentRun?.lastActivityAt || input.agentRun?.startedAt;
    const quietThresholdMs = input.quietThresholdMs ?? defaultAttentionThresholds.interactiveQuietMs;
    if (activity && ageMs(activity, input.now) > quietThresholdMs) return status("quiet", "running with no recent activity", "derived", sourceObservationIds, activity);
    return status("running", "process or provider indicates running", started?.confidence || input.agentRun?.statusConfidence || "derived", sourceObservationIds, activity);
  }

  return status("unknown", "no decisive observations", "unknown", [], latestActivity(observations));
}

/** Documents the generateAttentionItems helper. */
export function generateAttentionItems(input: GenerateAttentionInput): AttentionItem[] {
  const thresholds = { ...defaultAttentionThresholds, ...input.thresholds };
  const now = input.now || new Date().toISOString();
  const observations = input.observations || [];
  const items: AttentionItem[] = [];
  for (const obs of observations) {
    if (obs.kind === "agent.permission_requested") {
      const requestId = stringValue(obs.data.permissionRequestId) || obs.id;
      items.push(attention({
        kind: "permission_requested",
        severity: "critical",
        priority: 100,
        title: "Permission requested",
        body: stringValue(obs.data.message),
        dedupeKey: `${obs.subject.agentRunId || "unknown"}:permission:${requestId}`,
        sourceObservationIds: [obs.id],
        now,
        ids: obs.subject
      }));
    }
    if (obs.kind === "process.exited" || obs.kind === "agent.status") {
      const statusValue = stringValue(obs.data.status);
      const exitCode = numberValue(obs.data.exitCode);
      if (exitCode === 0 || statusValue === "done") items.push(agentDone(obs, now));
      if ((exitCode !== undefined && exitCode !== 0) || statusValue === "failed") items.push(agentFailed(obs, now));
    }
    if (obs.kind === "git.status_changed" && obs.data.dirty === true) {
      const warningAge = ageMs(obs.observedAt, now) > thresholds.dirtyWorktreeWarningAgeMs;
      items.push(attention({
        kind: "dirty_worktree",
        severity: warningAge ? "warning" : "info",
        priority: warningAge ? 55 : 35,
        title: "Dirty worktree needs checkpoint",
        body: stringValue(obs.data.summary),
        dedupeKey: `${obs.subject.entityId || "unknown"}:dirty-worktree`,
        sourceObservationIds: [obs.id],
        now,
        ids: obs.subject
      }));
    }
  }

  for (const run of input.agentRuns || []) {
    const runObservations = observations.filter((obs) => obs.subject.agentRunId === run.id);
    const projection = resolveAgentRunStatus({ observations: runObservations, agentRun: run, quietThresholdMs: quietThreshold(run), now });
    if (projection.status === "quiet") {
      items.push(attention({
        kind: "agent_quiet",
        severity: "warning",
        priority: 60,
        title: "Agent quiet",
        body: projection.reason,
        dedupeKey: `${run.id}:quiet`,
        sourceObservationIds: projection.sourceObservationIds,
        now,
        ids: { entityId: run.entityId, workSessionId: run.workSessionId, agentRunId: run.id, terminalSessionId: run.terminalSessionId }
      }));
    }
  }

  for (const session of input.workSessions || []) {
    if (session.status === "active" && session.estimate?.minutes && ageMs(session.startedAt, now) > session.estimate.minutes * thresholds.estimateMultiplier * 60 * 1000) {
      items.push(attention({
        kind: "estimate_exceeded",
        severity: "warning",
        priority: 50,
        title: "Estimate exceeded",
        body: session.estimate.text,
        dedupeKey: `${session.id}:estimate-exceeded`,
        sourceObservationIds: [],
        now,
        ids: { entityId: session.entityId, workSessionId: session.id }
      }));
    }
  }

  for (const capture of input.captures || []) {
    if (capture.status === "open" && ageMs(capture.createdAt, now) > thresholds.captureAgeMs) {
      items.push(attention({
        kind: "capture_unresolved",
        severity: "info",
        priority: 20,
        title: "Unresolved capture",
        body: capture.text,
        dedupeKey: `${capture.id}:unresolved`,
        sourceObservationIds: [],
        now,
        ids: { entityId: capture.entityId, workSessionId: capture.workSessionId, agentRunId: capture.agentRunId }
      }));
    }
  }

  return dedupe(items);
}

/** Documents the agentDone helper. */
function agentDone(obs: TreeObservation, now: string): AttentionItem {
  return attention({
    kind: "agent_done",
    severity: "success",
    priority: 70,
    title: "Agent done",
    body: stringValue(obs.data.message),
    dedupeKey: `${obs.subject.agentRunId || obs.id}:done`,
    sourceObservationIds: [obs.id],
    now,
    ids: obs.subject
  });
}

/** Documents the agentFailed helper. */
function agentFailed(obs: TreeObservation, now: string): AttentionItem {
  return attention({
    kind: "agent_failed",
    severity: "critical",
    priority: 90,
    title: "Agent failed",
    body: stringValue(obs.data.message) || (obs.data.exitCode !== undefined ? `Process exited ${String(obs.data.exitCode)}` : undefined),
    dedupeKey: `${obs.subject.agentRunId || obs.id}:failed`,
    sourceObservationIds: [obs.id],
    now,
    ids: obs.subject
  });
}

/** Documents the attention helper. */
function attention(input: {
  kind: AttentionItem["kind"];
  severity: AttentionItem["severity"];
  priority: number;
  title: string;
  body?: string;
  dedupeKey: string;
  sourceObservationIds: string[];
  now: string;
  ids: {
    entityId?: string;
    workSessionId?: string;
    agentRunId?: string;
    terminalSessionId?: string;
  };
}): AttentionItem {
  return {
    schema: "tangent.trees.attention.v1",
    id: `attn_${hash(input.dedupeKey)}`,
    entityId: input.ids.entityId,
    workSessionId: input.ids.workSessionId,
    agentRunId: input.ids.agentRunId,
    terminalSessionId: input.ids.terminalSessionId,
    kind: input.kind,
    severity: input.severity,
    status: "open",
    title: input.title,
    body: input.body,
    dedupeKey: input.dedupeKey,
    priority: input.priority,
    createdAt: input.now,
    updatedAt: input.now,
    sourceObservationIds: input.sourceObservationIds,
    actions: defaultActions(input.kind),
    evidence: input.sourceObservationIds.map((id) => ({ id: `ev_${id}`, kind: "observation", sourceId: id }))
  };
}

/** Documents the defaultActions helper. */
function defaultActions(kind: AttentionItem["kind"]): AttentionItem["actions"] {
  if (kind === "permission_requested") return ["Approve", "Deny", "Send instruction", "Open terminal", "View evidence"].map((label) => ({ id: actionId(label), label, kind: "ui-action" }));
  if (kind === "agent_failed") return ["Open terminal", "Capture output", "Restart", "Checkpoint blocked", "Dismiss"].map((label) => ({ id: actionId(label), label, kind: "ui-action", danger: label === "Restart" }));
  if (kind === "agent_done") return ["Acknowledge", "Checkpoint", "Open terminal"].map((label) => ({ id: actionId(label), label, kind: "ui-action" }));
  return ["Open", "Dismiss"].map((label) => ({ id: actionId(label), label, kind: "ui-action" }));
}

/** Documents the status helper. */
function status(statusValue: AgentRun["status"], reason: string, confidence: AgentRun["statusConfidence"], sourceObservationIds: string[], lastActivityAt?: string): AgentStatusProjection {
  return { status: statusValue, reason, confidence, sourceObservationIds, lastActivityAt };
}

/** Documents the latestActivity helper. */
function latestActivity(observations: TreeObservation[]): string | undefined {
  return observations
    .filter((obs) => obs.kind === "terminal.output" || obs.kind === "terminal.activity" || obs.kind === "usage.metrics_updated" || obs.kind === "agent.message" || obs.kind === "process.started")
    .map((obs) => obs.observedAt)
    .sort()
    .at(-1);
}

/** Documents the quietThreshold helper. */
function quietThreshold(run: AgentRun): number {
  return run.providerFields?.longRunning === true ? defaultAttentionThresholds.longRunningQuietMs : defaultAttentionThresholds.interactiveQuietMs;
}

/** Documents the dedupe helper. */
function dedupe(items: AttentionItem[]): AttentionItem[] {
  return [...new Map(items.map((item) => [item.dedupeKey, item])).values()].sort((a, b) => b.priority - a.priority);
}

/** Documents the ageMs helper. */
function ageMs(from: string, to = new Date().toISOString()): number {
  return Math.max(0, Date.parse(to) - Date.parse(from));
}

/** Documents the numberValue helper. */
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() ? Number(value) : undefined;
}

/** Documents the stringValue helper. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Documents the actionId helper. */
function actionId(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "_");
}

/** Documents the hash helper. */
function hash(value: string): string {
  let hashValue = 2166136261;
  for (const char of value) {
    hashValue ^= char.charCodeAt(0);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return (hashValue >>> 0).toString(16).padStart(8, "0");
}

/** Documents the findLast helper. */
function findLast<T>(values: T[], predicate: (value: T) => boolean): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) return values[index];
  }
  return undefined;
}
