export type Confidence =
  | "exact"
  | "provider-reported"
  | "adapter-parsed"
  | "derived"
  | "estimated"
  | "imported"
  | "partial"
  | "unknown";

export type ActorRef = {
  id: string;
  kind: "user" | "agent" | "system" | "mcp" | "import" | "unknown";
  displayName?: string;
};

export type ObservationSourceRef = {
  id: string;
  kind:
    | "trees-cli"
    | "trees-ui"
    | "trees-mcp"
    | "terminal-runtime"
    | "agent-adapter"
    | "usage"
    | "git"
    | "review-provider"
    | "import"
    | "manual";
  adapterId?: string;
  sourcePath?: string;
  line?: number;
  rawHash?: string;
};

export type EvidenceRef = {
  id: string;
  kind: "event" | "observation" | "file" | "terminal-output" | "git" | "usage" | "import" | "manual";
  sourceId?: string;
  path?: string;
  line?: number;
  rawHash?: string;
  text?: string;
};

export type ActionModel = {
  id: string;
  label: string;
  kind: "command" | "link" | "terminal" | "mcp-tool" | "ui-action";
  command?: string;
  href?: string;
  input?: Record<string, unknown>;
  danger?: boolean;
};

export type EntityStatusSummary = {
  status?: string;
  reason?: string;
  confidence?: Confidence;
  attentionOpen?: number;
  activeAgentRuns?: number;
  activeWorkSessions?: number;
};

export type EntityMetricsSummary = {
  tokensTotal?: number;
  contextPct?: number;
  costUsd?: number;
  filesTouched?: number;
  commits?: number;
};

export type TreeEntityKind = "group" | "work" | "review_queue" | "eval" | "rollup" | "note" | "custom";

export type TreeEntity = {
  schema: "tangent.trees.entity.v1";
  id: string;
  path: string;
  parentPath?: string;
  title: string;
  kind: TreeEntityKind;
  projectId?: string;
  repoRoot?: string;
  worktreePath?: string;
  branch?: string;
  agentDefaults?: {
    adapterId?: string;
    model?: string;
    runtimeId?: string;
    sandboxId?: string;
  };
  description?: string;
  statusSummary?: EntityStatusSummary;
  metricsSummary?: EntityMetricsSummary;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  providerFields?: Record<string, unknown>;
};

export type ProjectRef = {
  schema: "tangent.trees.project.v1";
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  evidence: EvidenceRef[];
};

export type WorkSession = {
  schema: "tangent.trees.workSession.v1";
  id: string;
  entityId: string;
  entityPath: string;
  status: "active" | "paused" | "done" | "blocked" | "abandoned" | "cancelled";
  intent?: string;
  doneWhen?: string;
  estimate?: {
    text?: string;
    minutes?: number;
    source: "user" | "agent" | "derived" | "unknown";
  };
  startedAt: string;
  endedAt?: string;
  startedBy: ActorRef;
  endedBy?: ActorRef;
  agentRunIds: string[];
  terminalSessionIds: string[];
  usageSessionIds: string[];
  checkpointIds: string[];
  captureIds: string[];
  createdAt: string;
  updatedAt: string;
  evidence: EvidenceRef[];
};

export type Checkpoint = {
  schema: "tangent.trees.checkpoint.v1";
  id: string;
  workSessionId: string;
  entityId: string;
  kind: "progress" | "pause" | "done" | "blocked" | "decision" | "handoff" | "abandoned";
  outcome: "continue" | "paused" | "done" | "blocked" | "abandoned";
  actual?: { text?: string; minutes?: number };
  did?: string;
  learned?: string;
  evidenceText?: string;
  next?: string;
  blocker?: string;
  raw?: string;
  linkedCaptureIds: string[];
  linkedAttentionItemIds: string[];
  createdAt: string;
  createdBy: ActorRef;
  source: ObservationSourceRef;
  evidence: EvidenceRef[];
};

export type Capture = {
  schema: "tangent.trees.capture.v1";
  id: string;
  entityId?: string;
  workSessionId?: string;
  agentRunId?: string;
  kind: "note" | "thought" | "finding" | "question" | "evidence" | "next" | "risk" | "blocker" | "decision" | "raw";
  text: string;
  status: "open" | "linked" | "resolved" | "dismissed";
  source: ObservationSourceRef;
  createdBy: ActorRef;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: ActorRef;
  resolution?: {
    kind: "checkpoint" | "attention" | "entity" | "dismissed" | "other";
    targetId?: string;
    note?: string;
  };
  evidence: EvidenceRef[];
};

export type AgentRun = {
  schema: "tangent.trees.agentRun.v1";
  id: string;
  entityId: string;
  workSessionId?: string;
  terminalSessionId?: string;
  adapterId: string;
  provider?: string;
  model?: string;
  status: "starting" | "running" | "quiet" | "waiting_permission" | "blocked" | "done" | "failed" | "cancelled" | "unknown";
  statusReason?: string;
  statusUpdatedAt?: string;
  statusConfidence: Confidence;
  prompt?: { text?: string; source: "user" | "eval" | "rollup" | "mcp" | "script" | "unknown" };
  startedAt: string;
  lastActivityAt?: string;
  endedAt?: string;
  usageSessionIds: string[];
  permissionRequestIds: string[];
  attentionItemIds: string[];
  metrics: {
    durationMs?: number;
    terminalOutputLines?: number;
    tokensTotal?: number;
    contextPct?: number;
    costUsd?: number;
    filesTouched?: number;
    commits?: number;
  };
  createdAt: string;
  updatedAt: string;
  evidence: EvidenceRef[];
  providerFields?: Record<string, unknown>;
};

export type TerminalSession = {
  schema: "tangent.trees.terminalSession.v1";
  id: string;
  runtimeId: "tmux" | "pty" | "process" | string;
  hostId?: "web" | "native-terminal" | "iterm2" | "wezterm" | "vscode" | string;
  entityId?: string;
  agentRunId?: string;
  workSessionId?: string;
  cwd?: string;
  command?: string;
  runtimeRef: {
    tmuxSessionName?: string;
    ptyId?: string;
    processPid?: number;
  };
  status: "starting" | "attached" | "detached" | "running" | "exited" | "killed" | "unknown";
  startedAt: string;
  lastOutputAt?: string;
  endedAt?: string;
  exitCode?: number;
  evidence: EvidenceRef[];
};

export type TreeObservation = {
  schema: "tangent.trees.observation.v1";
  id: string;
  observedAt: string;
  recordedAt: string;
  source: ObservationSourceRef;
  subject: {
    entityId?: string;
    workSessionId?: string;
    agentRunId?: string;
    terminalSessionId?: string;
    usageSessionId?: string;
    reviewItemId?: string;
  };
  kind:
    | "process.started"
    | "process.exited"
    | "terminal.output"
    | "terminal.activity"
    | "agent.status"
    | "agent.permission_requested"
    | "agent.permission_resolved"
    | "agent.message"
    | "usage.session_linked"
    | "usage.metrics_updated"
    | "git.status_changed"
    | "git.commit_created"
    | "workSession.started"
    | "workSession.checkpointed"
    | "capture.created"
    | "review.updated"
    | "user.action"
    | "system.heartbeat";
  data: Record<string, unknown>;
  confidence: Confidence;
  evidence: EvidenceRef[];
};

export type AttentionItem = {
  schema: "tangent.trees.attention.v1";
  id: string;
  entityId?: string;
  workSessionId?: string;
  agentRunId?: string;
  terminalSessionId?: string;
  kind:
    | "permission_requested"
    | "agent_done"
    | "agent_failed"
    | "agent_blocked"
    | "agent_quiet"
    | "estimate_exceeded"
    | "dirty_worktree"
    | "checkpoint_due"
    | "capture_unresolved"
    | "review_requested"
    | "review_approved"
    | "review_needs_changes";
  severity: "info" | "success" | "warning" | "critical";
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  title: string;
  body?: string;
  dedupeKey: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  sourceObservationIds: string[];
  actions: ActionModel[];
  evidence: EvidenceRef[];
};

export type TreeEvent = {
  schema: "tangent.trees.event.v1";
  id: string;
  type: string;
  at: string;
  actor: ActorRef;
  source: ObservationSourceRef;
  entityId?: string;
  workSessionId?: string;
  agentRunId?: string;
  terminalSessionId?: string;
  attentionItemId?: string;
  captureId?: string;
  checkpointId?: string;
  data: Record<string, unknown>;
  causationId?: string;
  correlationId?: string;
  evidence: EvidenceRef[];
};

export const treeResourceSchemas = {
  entity: "tangent.trees.entity.v1",
  project: "tangent.trees.project.v1",
  workSession: "tangent.trees.workSession.v1",
  checkpoint: "tangent.trees.checkpoint.v1",
  capture: "tangent.trees.capture.v1",
  agentRun: "tangent.trees.agentRun.v1",
  terminalSession: "tangent.trees.terminalSession.v1",
  observation: "tangent.trees.observation.v1",
  attention: "tangent.trees.attention.v1",
  event: "tangent.trees.event.v1"
} as const;

/** Documents the validateEntityPath helper. */
export function validateEntityPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Tree entity path is required.");
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) throw new Error(`Tree entity path must be relative: ${path}`);
  const parts = trimmed.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`Invalid tree entity path: ${path}`);
  if (parts.some((part) => /[\0\\]/.test(part))) throw new Error(`Tree entity path contains unsupported characters: ${path}`);
  return parts.join("/");
}

/** Documents the parentPathFor helper. */
export function parentPathFor(path: string): string | undefined {
  const normalized = validateEntityPath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : undefined;
}

/** Documents the titleFromPath helper. */
export function titleFromPath(path: string): string {
  return validateEntityPath(path).split("/").at(-1)!;
}

/** Documents the isTreeEntityKind helper. */
export function isTreeEntityKind(value: string): value is TreeEntityKind {
  return ["group", "work", "review_queue", "eval", "rollup", "note", "custom"].includes(value);
}

/** Documents the normalizeTreeEntityKind helper. */
export function normalizeTreeEntityKind(value: string | undefined): TreeEntityKind {
  if (!value) return "work";
  const normalized = value.replace("-", "_");
  if (isTreeEntityKind(normalized)) return normalized;
  throw new Error(`Unknown tree entity kind: ${value}`);
}

/** Documents the isTreeEvent helper. */
export function isTreeEvent(value: unknown): value is TreeEvent {
  return Boolean(value && typeof value === "object" && (value as { schema?: unknown }).schema === treeResourceSchemas.event);
}

export * from "./adapters.js";
