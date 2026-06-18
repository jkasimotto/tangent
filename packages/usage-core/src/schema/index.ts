export type UsageResourceKind =
  | "workspace"
  | "repo"
  | "source"
  | "provider"
  | "session"
  | "turn"
  | "step"
  | "message"
  | "model_call"
  | "tool_call"
  | "tool_result"
  | "subagent"
  | "permission"
  | "compaction"
  | "usage_sample"
  | "file_event"
  | "artifact"
  | "raw_event";

export type UsageSourceKind = "native" | "hook" | "sdk" | "import" | "test" | "usage-jsonl" | "unknown";
export type UsageContentMode = "metadata-only" | "metadata-with-excerpts" | "full";

export type UsageConfidence =
  | "exact"
  | "provider-reported"
  | "derived"
  | "estimated"
  | "partial"
  | "unsupported"
  | "unknown";

export type UsageStepKind =
  | "session"
  | "turn"
  | "user_message"
  | "assistant_response"
  | "model_call"
  | "tool_call"
  | "tool_result"
  | "subagent"
  | "permission"
  | "compaction"
  | "file_read"
  | "file_search"
  | "file_write"
  | "command"
  | "error"
  | "unknown";

export type UsageStatus = "success" | "error" | "cancelled" | "unknown";

export type UsageActor = {
  role: "user" | "assistant" | "system" | "tool" | "subagent" | "hook" | string;
  model?: string;
  agentId?: string;
  agentType?: string;
  parentAgentId?: string;
};

export type UsageRepoRef = {
  id?: string;
  root?: string;
  rootHash?: string;
  cwd?: string;
  branch?: string;
  headSha?: string;
  worktree?: string;
};

export type UsageTokenUsage = {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cacheCreation?: number;
  reasoning?: number;
  context?: number;
  peakContext?: number;
  source: "provider-reported" | "derived" | "estimated" | "unknown";
  confidence: UsageConfidence;
};

export type UsageCost = {
  amount?: number;
  currency: "USD";
  source: "provider-reported" | "pricing-plugin" | "estimated" | "unknown";
  priced: boolean;
  unpricedModels?: string[];
};

export type UsageMetrics = {
  tokens?: UsageTokenUsage;
  cost?: UsageCost;
  durationMs?: number;
  selfDurationMs?: number;
  inputChars?: number;
  outputChars?: number;
  inputBytes?: number;
  outputBytes?: number;
  count?: number;
};

export type UsageNativeRef = {
  sourcePath?: string;
  line?: number;
  jsonPointer?: string;
  rawHash?: string;
  providerType?: string;
};

export type UsageEvidenceRef = {
  eventId: string;
  sourceId?: string;
  native?: UsageNativeRef;
  confidence: UsageConfidence;
};

export type UsageProviderCapability = {
  status: "supported" | "partial" | "unsupported";
  source: "native" | "hook" | "derived" | "none";
  confidence: UsageConfidence;
  notes: string[];
};

export type UsageProviderCapabilities = {
  provider: string;
  sourceKinds: string[];
  fields: Record<string, UsageProviderCapability>;
};

export type UsageAvailability = {
  confidence: UsageConfidence;
  missing: string[];
  notes: string[];
  providerCoverage: Record<string, UsageProviderCapability>;
};

export type UsageSourceRef = {
  id: string;
  provider?: string;
  kind?: UsageSourceKind | string;
  path?: string;
  rawHash?: string;
};

export type UsageWarning = {
  code: string;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
};

export type UsagePage = {
  nextCursor?: string;
  previousCursor?: string;
  hasMore?: boolean;
};

export type UsageResult<T> = {
  data: T;
  meta: {
    schema: string;
    generatedAt: string;
    query: unknown;
    page?: UsagePage;
    support: UsageAvailability;
    warnings: UsageWarning[];
    provenance: {
      sources: UsageSourceRef[];
      events: number;
      index?: {
        kind: "sqlite" | "memory";
        path?: string;
        version?: string;
      };
    };
  };
};

export type UsageSession = {
  schema: "tangent.usage.session.v1";
  id: string;
  provider: string;
  providerSessionId?: string;
  transcriptPath?: string;
  title?: string;
  firstPrompt?: string;
  summary?: string;
  project?: string;
  repo?: UsageRepoRef;
  cwd?: string;
  gitBranch?: string;
  parentSessionId?: string;
  relationship?: "none" | "continuation" | "fork" | "subagent" | "unknown";
  startedAt?: string;
  endedAt?: string;
  lastActivityAt?: string;
  status: "active" | "completed" | "failed" | "truncated" | "unknown";
  counts: {
    turns: number;
    messages: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    subagents: number;
    compactions: number;
    filesTouched: number;
  };
  metrics: UsageMetrics;
  availability: UsageAvailability;
  evidence: UsageEvidenceRef[];
  providerFields?: Record<string, unknown>;
};

export type UsageTurn = {
  schema: "tangent.usage.turn.v1";
  id: string;
  sessionId: string;
  provider: string;
  order: number;
  startedAt?: string;
  endedAt?: string;
  lastActivityAt?: string;
  status: "completed" | "failed" | "active" | "unknown";
  titlePreview?: string;
  sourceFingerprint: string;
  metrics: UsageMetrics;
  evidence: UsageEvidenceRef[];
  providerFields?: Record<string, unknown>;
};

export type UsageStep = {
  schema: "tangent.usage.step.v1";
  id: string;
  sessionId: string;
  turnId?: string;
  parentStepId?: string;
  order: number;
  kind: UsageStepKind;
  label: string;
  category?: string;
  status: UsageStatus;
  provider: string;
  actor?: UsageActor;
  model?: string;
  toolName?: string;
  subagentId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  selfDurationMs?: number;
  durationConfidence: UsageConfidence;
  metrics: UsageMetrics;
  targetPaths: string[];
  evidence: UsageEvidenceRef[];
  nativeRefs: UsageNativeRef[];
  providerFields?: Record<string, unknown>;
};

export type UsageMessage = {
  schema: "tangent.usage.message.v1";
  id: string;
  sessionId: string;
  turnId?: string;
  stepId?: string;
  role: "user" | "assistant" | "system" | "tool";
  ordinal: number;
  createdAt?: string;
  text?: string;
  textPreview?: string;
  textChars?: number;
  textBytes?: number;
  contentMode: UsageContentMode;
  model?: string;
  hasToolUse: boolean;
  hasThinking: boolean;
  thinking?: string;
  thinkingPreview?: string;
  thinkingSummary?: string;
  tokenUsage?: UsageTokenUsage;
  confidence: UsageConfidence;
  evidence: UsageEvidenceRef[];
  providerFields?: Record<string, unknown>;
};

export type UsageToolCall = {
  schema: "tangent.usage.tool_call.v1";
  id: string;
  sessionId: string;
  turnId?: string;
  stepId?: string;
  messageId?: string;
  provider: string;
  toolName: string;
  category: string;
  input?: unknown;
  plan?: string;
  planPreview?: string;
  targetPaths: string[];
  model?: string;
  status: UsageStatus;
  resultStepId?: string;
  result?: UsageToolResult;
  evidence: UsageEvidenceRef[];
  providerFields?: Record<string, unknown>;
};

export type UsageToolResult = {
  schema: "tangent.usage.tool_result.v1";
  id: string;
  sessionId: string;
  turnId?: string;
  stepId?: string;
  toolCallId?: string;
  provider: string;
  toolName?: string;
  status: UsageStatus;
  output?: unknown;
  outputPreview?: string;
  durationMs?: number;
  evidence: UsageEvidenceRef[];
  providerFields?: Record<string, unknown>;
};

export type UsageFileFacet = {
  path?: string;
  targetPaths?: string[];
  operation?: "read" | "search" | "write" | string;
};

export type UsageToolFacet = {
  id?: string;
  name?: string;
  category?: string;
  input?: unknown;
  output?: unknown;
  status?: string;
  targetPaths?: string[];
  durationMs?: number;
  plan?: string;
};

export type UsagePermissionFacet = {
  id?: string;
  status?: string;
  prompt?: string;
  decision?: string;
};

export type UsageCompactionFacet = {
  summary?: string;
  trigger?: string;
};

export type UsageErrorFacet = {
  message?: string;
  code?: string;
  stack?: string;
};

export type UsageEventKindV3 =
  | "session.start"
  | "session.end"
  | "turn.start"
  | "turn.end"
  | "message"
  | "model.call"
  | "tool.call"
  | "tool.result"
  | "permission"
  | "compaction"
  | "usage.sample"
  | "file.event"
  | "subagent.start"
  | "subagent.end"
  | "error"
  | "raw";

export type UsageEventV3 = {
  schema: "tangent.usage.event.v3";
  id: string;
  kind: UsageEventKindV3 | string;
  provider: string;
  source: {
    id: string;
    kind: UsageSourceKind | string;
    path?: string;
    line?: number;
    jsonPointer?: string;
    providerVersion?: string;
    schemaId?: string;
    rawHash?: string;
  };
  recordedAt: string;
  observedAt?: string;
  sequence?: number;
  scope: {
    workspaceId?: string;
    repoId?: string;
    sessionId: string;
    providerSessionId?: string;
    turnId?: string;
    stepId?: string;
    parentStepId?: string;
    messageId?: string;
    toolCallId?: string;
    subagentId?: string;
  };
  actor?: UsageActor;
  time?: {
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    confidence: UsageConfidence;
  };
  data: {
    text?: string;
    textPreview?: string;
    thinking?: string;
    thinkingPreview?: string;
    role?: string;
    model?: string;
    tool?: UsageToolFacet;
    usage?: UsageTokenUsage;
    cost?: UsageCost;
    file?: UsageFileFacet;
    permission?: UsagePermissionFacet;
    compaction?: UsageCompactionFacet;
    error?: UsageErrorFacet;
    [key: string]: unknown;
  };
  links?: {
    parentEventIds?: string[];
    relatedEventIds?: string[];
  };
  availability: UsageAvailability;
  providerFields?: Record<string, unknown>;
  nativeRaw?: unknown;
};

export type UsageSourceFile = {
  id: string;
  provider: string;
  kind: UsageSourceKind | string;
  path?: string;
  mtimeMs?: number;
  size?: number;
  rawHash?: string;
  records?: unknown[];
  events?: UsageEventV3[];
};

export type DiscoverContext = {
  repo?: string;
  workspace?: string;
  from?: Date | string;
  to?: Date | string;
  now?: Date;
};

export type UsageSourceInspection = {
  provider: string;
  sourceId: string;
  schemaId?: string;
  recordCount?: number;
  warnings: UsageWarning[];
  providerFields?: Record<string, unknown>;
};

export type NormalizeOptions = {
  contentMode: UsageContentMode;
  includeRaw?: boolean;
  now?: Date;
};

export interface UsageProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  discover?(ctx: DiscoverContext): AsyncIterable<UsageSourceFile>;
  inspect?(source: UsageSourceFile): Promise<UsageSourceInspection>;
  normalize(source: UsageSourceFile, options: NormalizeOptions): AsyncIterable<UsageEventV3>;
  capabilities(): UsageProviderCapabilities;
}

export type UsageErrorCode =
  | "USAGE_NOT_FOUND"
  | "USAGE_AMBIGUOUS_REF"
  | "USAGE_INVALID_QUERY"
  | "USAGE_UNSUPPORTED_PROVIDER"
  | "USAGE_CAPABILITY_UNAVAILABLE"
  | "USAGE_INDEX_STALE"
  | "USAGE_NATIVE_PARSE_FAILED"
  | "USAGE_INTERNAL";

export class UsageError extends Error {
  readonly code: UsageErrorCode;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(code: UsageErrorCode, message: string, options: { details?: Record<string, unknown>; retryable?: boolean } = {}) {
    super(message);
    this.name = "UsageError";
    this.code = code;
    this.details = options.details;
    this.retryable = Boolean(options.retryable);
  }
}

export const emptyAvailability: UsageAvailability = {
  confidence: "unknown",
  missing: [],
  notes: [],
  providerCoverage: {}
};

export function usageAvailability(value: Partial<UsageAvailability> = {}): UsageAvailability {
  return {
    confidence: value.confidence || "unknown",
    missing: value.missing || [],
    notes: value.notes || [],
    providerCoverage: value.providerCoverage || {}
  };
}
