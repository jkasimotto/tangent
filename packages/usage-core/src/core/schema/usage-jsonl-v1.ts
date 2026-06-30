export type UsageProvider = "claude" | "codex" | "gemini";

/** Every provider Tangent ingests natively. The single source of truth for default provider lists, so adding a provider does not require updating scattered `["claude", "codex"]` literals. */
export const usageProviders: readonly UsageProvider[] = ["claude", "codex", "gemini"];

/** Type guard narrowing an arbitrary value to a known usage provider. */
export function isUsageProvider(value: unknown): value is UsageProvider {
  return value === "claude" || value === "codex" || value === "gemini";
}

export type UsageEventKind =
  | "conversation.start"
  | "conversation.end"
  | "turn.start"
  | "turn.end"
  | "message.user"
  | "message.assistant.visible"
  | "message.assistant.internal"
  | "message.system"
  | "tool.call"
  | "tool.result"
  | "tool.error"
  | "permission.request"
  | "permission.decision"
  | "compact.pre"
  | "compact.post"
  | "subagent.start"
  | "subagent.stop"
  | "token.usage"
  | "file.read"
  | "file.search"
  | "file.write"
  | "command.exec"
  | "error"
  | "capability.notice"
  | "unknown";

export type UsageCaptureConfidence =
  | "exact"
  | "derived"
  | "inferred"
  | "partial"
  | "unsupported"
  | "unknown";

export type UsageConfidence =
  | "exact"
  | "provider-reported"
  | "derived"
  | "estimated"
  | "unsupported";

export type TrackingSource =
  | "global-default"
  | "global-allowlist"
  | "global-denylist"
  | "repo-local"
  | "repo-shared"
  | "env"
  | "none";

export type CaptureScope = "global" | "repo-local" | "repo-shared" | "native";
export type ContentMode = "metadata-only" | "metadata-with-excerpts" | "full";

export type UsageJsonlLineV2 = {
  schema: "usage.event.v2";
  event_id: string;
  source_event_id?: string;
  kind: UsageEventKind;
  recorded_at: string;
  observed_at?: string;
  sequence?: number;
  provider: UsageProvider;
  capture: {
    source:
      | "native-import"
      | "hook"
      | "sdk"
      | "merged";
    scope?: CaptureScope;
    usage_version: string;
    provider_hook_event_name?: string;
    provider_version?: string;
    content_mode: ContentMode;
    confidence: UsageCaptureConfidence;
  };
  repo: {
    root?: string;
    root_hash?: string;
    cwd?: string;
    git?: {
      branch?: string;
      head_sha?: string;
      origin_url_hash?: string;
      worktree?: string;
    };
    tracking: {
      enabled: boolean;
      source: TrackingSource;
    };
  };
  conversation: {
    id: string;
    provider_session_id?: string;
    provider_thread_id?: string;
    transcript_path?: string | null;
    started_at?: string;
    ended_at?: string;
    title?: string;
    summary?: string;
  };
  turn?: {
    id?: string;
    index?: number;
    synthetic?: boolean;
  };
  actor?: {
    role: "user" | "assistant" | "system" | "tool" | "subagent" | "hook";
    model?: string;
    agent_id?: string;
    agent_type?: string;
    parent_agent_id?: string;
  };
  data: unknown;
  links?: {
    message_id?: string;
    parent_message_id?: string;
    tool_call_id?: string;
    parent_tool_call_id?: string;
    subagent_id?: string;
    related_event_ids?: string[];
  };
  availability?: {
    confidence: UsageCaptureConfidence;
    notes?: string[];
    missing?: string[];
  };
  native?: {
    type?: string;
    hook_event_name?: string;
    source_path?: string;
    line?: number;
    json_pointer?: string;
    raw?: unknown;
    raw_redacted?: boolean;
    raw_hash?: string;
  };
};

export type UsageJsonlLineV1 = UsageJsonlLineV2;

export type ProviderSupport = {
  status: "supported" | "partial" | "unsupported";
  source: "native" | "hook" | "best-effort" | "none";
  notes: string[];
};

export type QuerySupport = {
  status: "supported" | "partial" | "unsupported";
  providerCoverage: Partial<Record<UsageProvider, ProviderSupport>>;
};

export type UsageWarning = {
  code: string;
  message: string;
  path?: string;
};

export type QueryResult<T> = {
  data: T;
  support: QuerySupport;
  warnings: UsageWarning[];
  provenance: {
    sourceFiles: string[];
    indexVersion: string;
    generatedAt: string;
  };
};
