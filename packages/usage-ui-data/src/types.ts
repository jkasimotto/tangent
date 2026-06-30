export type UsageConfidence = "exact" | "provider-reported" | "derived" | "estimated" | "partial" | "unsupported" | "unknown" | string;

export type UsageUiConfidence = "exact" | "derived" | "partial" | "estimated" | "unknown";

export type UsageSessionStatus = "active" | "complete" | "failed" | "unknown";

export type UsageStepStatus = "success" | "error" | "cancelled" | "unknown";

export type UsageTone = "neutral" | "info" | "warning" | "danger" | "success";

export type UsageActionModel = {
  id: string;
  label: string;
  href?: string;
};

export type UsageInspectorTarget = {
  kind: "session" | "metric" | "chapter" | "trace-item" | "message" | "tool" | "evidence";
  id: string;
  label?: string;
};

export type UsageSession = {
  id: string;
  provider: string;
  providerSessionId?: string;
  transcriptPath?: string;
  title?: string;
  firstPrompt?: string;
  summary?: string;
  project?: string;
  repo?: { id?: string; root?: string; cwd?: string; branch?: string };
  cwd?: string;
  gitBranch?: string;
  startedAt?: string;
  endedAt?: string;
  lastActivityAt?: string;
  status?: "active" | "completed" | "complete" | "failed" | "truncated" | "unknown" | string;
  models?: string[];
  metrics?: {
    durationMs?: number;
    durationConfidence?: UsageConfidence;
    selfDurationMs?: number;
    tokens?: UsageTokenUsage;
    cost?: { amount?: number; currency?: string; source?: string; priced?: boolean };
  };
  counts?: {
    turns?: number;
    messages?: number;
    userMessages?: number;
    assistantMessages?: number;
    toolCalls?: number;
    subagents?: number;
    compactions?: number;
    filesTouched?: number;
  };
  availability?: {
    confidence?: UsageConfidence;
    missing?: string[];
    notes?: string[];
  };
  evidence?: UsageEvidenceRef[];
  providerFields?: Record<string, unknown>;
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
  source?: string;
  confidence?: UsageConfidence;
};

export type UsageEvidenceRef = {
  eventId?: string;
  sourceId?: string;
  confidence?: UsageConfidence;
  native?: {
    sourcePath?: string;
    line?: number;
    jsonPointer?: string;
    rawHash?: string;
    providerType?: string;
  };
};

export type UsageStep = {
  id: string;
  sessionId?: string;
  turnId?: string;
  parentStepId?: string;
  order?: number;
  kind?: string;
  label?: string;
  category?: string;
  status?: UsageStepStatus | string;
  provider?: string;
  actor?: { role?: string; model?: string; agentId?: string; agentType?: string };
  model?: string;
  toolName?: string;
  subagentId?: string;
  startedAt?: string;
  endedAt?: string;
  offsetMs?: number;
  durationMs?: number;
  selfDurationMs?: number;
  widthMs?: number;
  durationConfidence?: UsageConfidence;
  confidence?: UsageConfidence;
  metricValue?: number;
  metrics?: {
    durationMs?: number;
    selfDurationMs?: number;
    tokens?: UsageTokenUsage;
    cost?: { amount?: number; currency?: string; source?: string; priced?: boolean };
  };
  targetPaths?: string[];
  evidence?: UsageEvidenceRef[];
  nativeRefs?: unknown[];
  providerFields?: Record<string, unknown>;
};

export type UsageMessage = {
  id: string;
  sessionId?: string;
  turnId?: string;
  stepId?: string;
  role: "user" | "assistant" | "system" | "tool" | string;
  ordinal?: number;
  createdAt?: string;
  at?: string;
  text?: string;
  textPreview?: string;
  textChars?: number;
  model?: string;
  hasToolUse?: boolean;
  hasThinking?: boolean;
  thinking?: string;
  thinkingPreview?: string;
  thinkingSummary?: string;
  tokenUsage?: UsageTokenUsage;
  tokens?: { label?: string; value?: number | string; unit?: string };
  metrics?: { tokens?: UsageTokenUsage };
  confidence?: UsageConfidence;
  toolCalls?: Array<{
    id: string;
    stepId?: string;
    resultStepId?: string;
    toolName?: string;
    name?: string;
    status?: string;
    result?: { durationMs?: number; outputPreview?: string };
    targetPaths?: string[];
    input?: unknown;
    plan?: string;
  }>;
  evidence?: UsageEvidenceRef[];
  providerFields?: Record<string, unknown>;
};

export type UsageTimeline = {
  schema?: string;
  sessionId?: string;
  metric?: string;
  unit?: "ms" | "tokens" | "usd" | "count" | string;
  range?: { startedAt?: string; endedAt?: string; durationMs?: number };
  items?: UsageStep[];
  totals?: unknown;
  caveats?: string[];
  [key: string]: unknown;
};

export type SessionFinderBadge = "active" | "costly" | "slow" | "failed" | "partial-data";

export type SessionFinderItem = {
  id: string;
  title: string;
  provider: string;
  status: UsageSessionStatus;
  lastActivityLabel: string;
  durationLabel?: string;
  tokenLabel?: string;
  toolCallCount?: number;
  fileCount?: number;
  caveatCount?: number;
  badges: SessionFinderBadge[];
};

export type UsageSessionFinderTabId = "active" | "recent" | "costly" | "slow" | "errors" | "starred";

export type UsageSessionFinderView = {
  tabs: Array<{ id: UsageSessionFinderTabId; label: string; count: number }>;
  activeTab: UsageSessionFinderTabId;
  searchPlaceholder: string;
  sortLabel: string;
  selectedSessionId?: string;
  groups: Array<{ id: UsageSessionFinderTabId | "empty"; label: string; items: SessionFinderItem[] }>;
  items: SessionFinderItem[];
  caveats: string[];
};

export type UsageSessionHeroView = {
  provider: string;
  status: UsageSessionStatus;
  title: string;
  subtitle: string;
  timeRangeLabel: string;
  repoLabel?: string;
  branchLabel?: string;
  summary: string;
  primaryFinding?: {
    tone: UsageTone;
    text: string;
  };
  actions: UsageActionModel[];
};

export type DiagnosticMetricCard = {
  id: string;
  label: string;
  value: string;
  unit?: string;
  confidence?: UsageUiConfidence;
  interpretation?: string;
  tone?: UsageTone;
  inspectTarget: UsageInspectorTarget;
};

export type UsageStorylineView = {
  chapters: UsageStoryChapter[];
};

export type UsageStoryChapter = {
  id: string;
  title: string;
  summary: string;
  startedAt?: string;
  endedAt?: string;
  durationLabel?: string;
  tokenLabel?: string;
  toolCallCount?: number;
  fileCount?: number;
  status: "complete" | "active" | "failed" | "unknown";
  dominantKind:
    | "prompt"
    | "planning"
    | "model"
    | "tooling"
    | "editing"
    | "validation"
    | "summary"
    | "error"
    | "unknown";
  steps: string[];
  actions: UsageActionModel[];
};

export type TraceMetric = "duration" | "selfDuration" | "tokens" | "cost";

export type TraceGrouping = "turn" | "chapter" | "stepKind" | "model" | "tool";

export type TraceWaterfallOptions = {
  metric?: TraceMetric;
  grouping?: TraceGrouping;
};

export type UsageTraceWaterfallView = {
  metric: TraceMetric;
  grouping: TraceGrouping;
  range: {
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
  };
  lanes: UsageTraceLane[];
  totals: {
    sessionDurationMs?: number;
    attributedDurationMs?: number;
    unattributedDurationMs?: number;
    totalTokens?: number;
  };
  caveats: string[];
};

export type UsageTraceLane = {
  id: string;
  label: string;
  items: UsageTraceItem[];
};

export type UsageTraceItem = {
  id: string;
  stepId: string;
  label: string;
  kind: string;
  startedAt?: string;
  endedAt?: string;
  offsetMs?: number;
  durationMs?: number;
  selfDurationMs?: number;
  tokens?: number;
  status: UsageStepStatus;
  confidence: UsageUiConfidence;
  colorRole: string;
};

export type UsageBreakdownView = {
  id: string;
  title: string;
  metric: TraceMetric;
  groupBy: "stepKind" | "chapter" | "model" | "tool" | "turn";
  unit: "ms" | "tokens" | "usd" | "count";
  items: UsageBreakdownItem[];
};

export type UsageBreakdownItem = {
  id: string;
  label: string;
  value: number;
  valueLabel: string;
  share: number;
  shareLabel: string;
  colorRole: string;
};

export type UsageTranscriptHighlightsView = {
  highlights: UsageTranscriptHighlight[];
  actions: UsageActionModel[];
};

export type UsageTranscriptHighlight = {
  id: string;
  kind: "user-prompt" | "assistant-plan" | "assistant-expensive" | "tool-cluster" | "assistant-result" | "latest";
  title: string;
  role?: "user" | "assistant" | "system" | "tool";
  summary: string;
  textPreview?: string;
  tokenLabel?: string;
  toolCallCount?: number;
  inspectTarget: UsageInspectorTarget;
};

export type UsageInspectorDefaultView = {
  title: string;
  sessionHealth: Array<{ label: string; value: string; tone?: UsageTone }>;
  anomalies: Array<{ label: string; detail: string; tone?: UsageTone }>;
  evidence: Array<{ label: string; value: string }>;
  caveats: string[];
  rawEvidenceTarget: UsageInspectorTarget;
};

export type UsageSessionTimelineView = {
  selected: {
    id: string;
    title: string;
    provider: string;
    status: "active" | "complete" | "failed" | "unknown";
    startedAt?: string;
    endedAt?: string;
    durationLabel?: string;
    tokenLabel?: string;
    summaryLabel: string;
    warning?: string;
  };
  picker: {
    query: string;
    results: Array<{
      id: string;
      title: string;
      provider: string;
      status: string;
      durationLabel?: string;
      tokenLabel?: string;
      reasonLabel?: "active" | "recent" | "costly" | "slow" | "failed";
    }>;
  };
  chart: {
    totalDurationMs: number;
    maxTokens: number;
    widthPx: number;
    heightPx: number;
    steps: UsageTimelineStepBar[];
  };
};

export type UsageTimelineStepBar = {
  id: string;
  label: string;
  kind:
    | "user"
    | "assistant"
    | "model"
    | "tool"
    | "tool_result"
    | "command"
    | "file"
    | "system"
    | "unknown";
  startedAt?: string;
  endedAt?: string;
  offsetMs: number;
  durationMs?: number;
  tokens?: number;
  durationLabel?: string;
  tokenLabel?: string;
  confidence?: "exact" | "derived" | "partial" | "estimated" | "unknown";
  detail: {
    title: string;
    subtitle?: string;
    excerpt?: string;
    toolName?: string;
    files?: string[];
    rawEventIds?: string[];
  };
};

export type UsageFlameKind = UsageTimelineStepBar["kind"];

export type UsageSparklineBucket = {
  /** Dominant step kind in this time slice, used for the bar colour. */
  kind: UsageFlameKind;
  /** Bar height for token intensity, 0..1 relative to the busiest slice. */
  tokenShare: number;
  /** Bar height fallback for duration when tokens are unavailable, 0..1. */
  durationShare: number;
};

/** Compact per-session activity series for the conversation list cards and rail. */
export type UsageSparkline = {
  /** Total active (gap-removed) duration the series represents. */
  durationMs: number;
  tokensTotal?: number;
  /** Number of compaction steps, drawn as markers on the card. */
  compactions: number;
  buckets: UsageSparklineBucket[];
};

/**
 * Wire shape of the index-precomputed sparkline that usage-core emits on a session (`session.sparkline`).
 * Mirrors usage-core's `SessionSparkline` so usage-ui-data can consume the precomputed series without
 * importing the domain core (the buckets carry the raw step `kind`, which the UI maps to a flame colour).
 */
export type PrecomputedSparkline = {
  durationMs: number;
  tokensTotal?: number;
  compactions: number;
  buckets: Array<{ kind: string; tokenShare: number; durationShare: number }>;
};

/** A slow step or work turn surfaced for the bottleneck panel, ranked by duration. */
export type UsageBottleneck = {
  /** Segment id when step-level, otherwise the work-turn row id. */
  id: string;
  rowId: string;
  /** Anchor message for linking the transcript and cross-pane scroll. */
  messageId: string;
  stepId?: string;
  label: string;
  /** The command, query, or path that actually ran; undefined for model turns. */
  detail?: string;
  kind: UsageConversationChartSegment["kind"] | "turn";
  durationMs: number;
  durationLabel?: string;
  confidence: UsageUiConfidence;
  rank: number;
};

export type UsageConversationProjectGroup = {
  id: string;
  label: string;
  sessions: UsageConversationSessionItem[];
};

export type UsageConversationSessionItem = {
  id: string;
  title: string;
  provider: string;
  providerSessionId?: string;
  transcriptPath?: string;
  model?: string;
  status?: string;
  startedAt?: string;
  lastActivityAt?: string;
  lastActivityLabel?: string;
  durationLabel?: string;
  tokenLabel?: string;
  messageCountLabel?: string;
  toolCallLabel?: string;
  summary?: string;
};

export type UsageConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  title?: string;
  at?: string;
  text?: string;
  textPreview?: string;
  thinking?: string;
  thinkingPreview?: string;
  tokenLabel?: string;
  tokens?: number;
  /** Context-window size for this message: input + cache-read + cache-creation tokens. */
  contextTokens?: number;
  /** Output tokens the model generated for this message. */
  outputTokens?: number;
  /** Number of tool calls the assistant issued in this message. */
  callCount?: number;
  /** "turn 1m 10s · N calls" summary for assistant messages, when timing is available. */
  turnLabel?: string;
  durationLabel?: string;
  durationMs?: number;
  confidence?: UsageUiConfidence;
  toolCalls: Array<{
    id: string;
    name: string;
    status?: string;
    durationLabel?: string;
    target?: string;
    commandPreview?: string;
    workdir?: string;
    preview?: string;
    resultDisplayPreview?: string;
    resultPreview?: string;
    plan?: string;
  }>;
};

export type UsageConversationChartSegment = {
  id: string;
  label: string;
  kind: "assistant" | "tool" | "tool_result" | "command" | "file" | "system" | "unknown";
  messageId: string;
  stepId?: string;
  /** The command, query, or path that ran; undefined for model/thinking steps. */
  detail?: string;
  durationMs?: number;
  durationLabel?: string;
  heightShare: number;
  confidence: UsageUiConfidence;
};

export type UsageConversationTokenMode = {
  tokens?: number;
  tokenLabel?: string;
  widthShare: number;
};

export type UsageConversationChartRow = {
  id: string;
  messageId: string;
  messageIds?: string[];
  role: "user" | "assistant" | "system" | "tool";
  label: string;
  at?: string;
  tokens?: number;
  tokenLabel?: string;
  durationMs?: number;
  durationLabel?: string;
  widthShare: number;
  tokenModes: {
    cumulative: UsageConversationTokenMode;
    added: UsageConversationTokenMode;
  };
  heightShare: number;
  anchor: boolean;
  confidence: UsageUiConfidence;
  segments: UsageConversationChartSegment[];
};

export type UsageConversationView = {
  selected: UsageConversationSessionItem & {
    model?: string;
    startedAt?: string;
    endedAt?: string;
    caveatCount?: number;
  };
  projects: UsageConversationProjectGroup[];
  messages: UsageConversationMessage[];
  chart: {
    maxTokens: number;
    maxAddedTokens: number;
    maxDurationMs: number;
    rows: UsageConversationChartRow[];
  };
  bottlenecks: UsageBottleneck[];
  caveats: string[];
};

export type UsageCockpitView = {
  session: UsageSessionHeroView;
  finder: UsageSessionFinderView;
  diagnostics: DiagnosticMetricCard[];
  storyline: UsageStorylineView;
  trace: UsageTraceWaterfallView;
  breakdowns: UsageBreakdownView[];
  transcriptHighlights: UsageTranscriptHighlightsView;
  inspector: UsageInspectorDefaultView;
};

export type UsageCockpitOptions = {
  sessions?: UsageSession[];
  selectedSessionId?: string;
  listCaveats?: string[];
  detailCaveats?: string[];
  timelineCaveats?: string[];
  transcriptCaveats?: string[];
  now?: Date | string;
};
