export type UsageSessionListQuery = {
  provider?: string;
  limit?: number;
};

export type TimelineQuery = {
  metric?: "durationMs" | "selfDurationMs" | "tokens.total" | "cost.amount";
};

export type TranscriptQuery = {
  includeTools?: boolean;
  previewChars?: number;
};

export type MessageSelectionQuery = {
  role?: "user" | "assistant" | "system" | "tool";
  minTokens?: number;
  maxTokens?: number;
  contains?: string;
};

export type UsageSessionListItem = {
  id: string;
  title: string;
  subtitle?: string;
  provider?: string;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  tokensTotal?: number;
  toolCalls?: number;
  caveatCount?: number;
};

export type UsageSessionListView = {
  sessions: UsageSessionListItem[];
  caveats: string[];
};

export type UsageToolCallSummaryView = {
  id: string;
  name: string;
  status?: string;
  durationMs?: number;
  target?: string;
};

export type UsageTranscriptMessageView = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  at?: string;
  title?: string;
  text?: string;
  textPreview?: string;
  tokens?: { label: string; value?: number | string; unit?: "tokens" };
  toolCalls?: UsageToolCallSummaryView[];
  confidence?: string;
};

export type UsageTimelineItemView = {
  id: string;
  label: string;
  kind: string;
  startedAt?: string;
  endedAt?: string;
  offsetMs?: number;
  durationMs?: number;
  metricValue?: number;
  depth?: number;
  status?: string;
  confidence?: string;
};

type UsageDomainResult<T> = {
  data: T;
  meta: {
    warnings: Array<{ message: string }>;
  };
};

type UsageDomainSession = {
  id: string;
  provider: string;
  providerSessionId?: string;
  title?: string;
  firstPrompt?: string;
  startedAt?: string;
  endedAt?: string;
  models?: string[];
  metrics: {
    durationMs?: number;
    durationConfidence?: string;
    tokens?: { total?: number; confidence?: string };
  };
  counts: {
    userMessages?: number;
    assistantMessages?: number;
    toolCalls?: number;
    filesTouched?: number;
  };
  availability: {
    notes: string[];
  };
};

type UsageDomainMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | string;
  createdAt?: string;
  model?: string;
  text?: string;
  textPreview?: string;
  tokenUsage?: { total?: number; confidence?: string };
  metrics?: { tokens?: { total?: number } };
  confidence?: string;
  toolCalls?: Array<{
    id: string;
    toolName?: string;
    name?: string;
    status?: string;
    result?: { durationMs?: number };
    targetPaths?: string[];
  }>;
};

type UsageDomainTranscript = {
  schema: string;
  session?: unknown;
  messages: UsageDomainMessage[];
  totals?: unknown;
  caveats: string[];
  [key: string]: unknown;
};

export type UsageDomainClient = {
  sessions: {
    list(query?: unknown): Promise<UsageDomainResult<UsageDomainSession[]>>;
    get(id: string): Promise<UsageDomainResult<UsageDomainSession>>;
    timeline(id: string, query?: unknown): Promise<UsageDomainResult<UsageTimelineView>>;
    report(id: string, query?: unknown): Promise<UsageDomainResult<UsageDomainTranscript>>;
  };
  messages: {
    query(query?: unknown): Promise<UsageDomainResult<UsageDomainMessage[]>>;
  };
};

export type UsageSessionDetailView = {
  session: UsageSessionListItem & {
    durationMs?: number;
    filesTouched?: number;
  };
  summaryCards: Array<{ label: string; value?: string | number; unit?: "ms" | "tokens" | "count" | "files"; confidence?: string }>;
  nextActions: Array<{ id: string; label: string; href?: string }>;
  caveats: string[];
};

export type UsageTimelineView = {
  schema: string;
  metric?: string;
  unit?: string;
  items: UsageTimelineItemView[];
  caveats?: string[];
  [key: string]: unknown;
};
export type UsageTranscriptView = {
  schema: string;
  session?: unknown;
  messages: UsageTranscriptMessageView[];
  totals?: unknown;
  caveats: string[];
  [key: string]: unknown;
};
export type MessageSelectionView = {
  messages: Array<{ id: string; role: string; preview?: string; tokens?: number; reason?: string }>;
  caveats: string[];
};

export interface UsageUiClient {
  listSessions(query?: UsageSessionListQuery): Promise<UsageSessionListView>;
  getSession(id: string): Promise<UsageSessionDetailView>;
  getSessionTimeline(id: string, query?: TimelineQuery): Promise<UsageTimelineView>;
  getTranscript(id: string, query?: TranscriptQuery): Promise<UsageTranscriptView>;
  getMessageSelection(query: MessageSelectionQuery): Promise<MessageSelectionView>;
}

/** Creates a browser API client for Usage UI view models. */
export function createUsageApiClient(baseUrl = ""): UsageUiClient {
  /** Requests JSON from the local Usage UI API. */
  const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, init);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) throw new Error(await response.text());
    if (!contentType.includes("application/json")) {
      const body = await response.text();
      const hint = body.trimStart().startsWith("<!doctype") || contentType.includes("text/html")
        ? "Usage API unavailable. Start the app with `tangent usage ui`; the standalone Vite server only serves the shell."
        : `Usage API returned ${contentType || "unknown content type"}.`;
      throw new Error(hint);
    }
    return response.json() as Promise<T>;
  };
  return {
    /** Lists sessions through the local API. */
    listSessions: (query = {}) => api(`/api/usage/sessions${queryString(query)}`),
    /** Gets a session detail view through the local API. */
    getSession: (id) => api(`/api/usage/sessions/${encodeURIComponent(id)}`),
    /** Gets a session timeline through the local API. */
    getSessionTimeline: (id, query = {}) => api(`/api/usage/sessions/${encodeURIComponent(id)}/timeline${queryString(query)}`),
    /** Gets a transcript through the local API. */
    getTranscript: (id, query = {}) => api(`/api/usage/sessions/${encodeURIComponent(id)}/transcript${queryString(query)}`),
    /** Gets message selection through the local API. */
    getMessageSelection: (query) => api(`/api/usage/messages/selection${queryString(query)}`)
  };
}

/** Creates create usage ui client. */
export function createUsageUiClient(usage: UsageDomainClient): UsageUiClient {
  return {
    /** Lists sessions. */
    async listSessions(query = {}) {
      const result = await usage.sessions.list({ provider: query.provider, limit: query.limit, orderBy: [{ field: "lastActivityAt", direction: "desc" }] });
      return {
        sessions: result.data.map((session) => ({
          id: session.id,
          title: session.title || session.firstPrompt || session.id,
          subtitle: [session.provider, session.models?.join(", ")].filter(Boolean).join(" · "),
          provider: session.provider,
          model: session.models?.[0],
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          tokensTotal: session.metrics.tokens?.total,
          toolCalls: session.counts.toolCalls,
          caveatCount: session.availability.notes.length
        })),
        caveats: result.meta.warnings.map((warning) => warning.message)
      };
    },
    /** Gets session. */
    async getSession(id) {
      const result = await usage.sessions.get(id);
      const session = result.data;
      return {
        session: {
          id: session.id,
          title: session.title || session.firstPrompt || session.id,
          provider: session.provider,
          model: session.models?.[0],
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          durationMs: session.metrics.durationMs,
          tokensTotal: session.metrics.tokens?.total,
          toolCalls: session.counts.toolCalls,
          filesTouched: session.counts.filesTouched,
          caveatCount: session.availability.notes.length
        },
        summaryCards: [
          { label: "Duration", value: session.metrics.durationMs, unit: "ms", confidence: session.metrics.durationConfidence },
          { label: "Tokens", value: session.metrics.tokens?.total, unit: "tokens", confidence: session.metrics.tokens?.confidence },
          { label: "Tool calls", value: session.counts.toolCalls, unit: "count" },
          { label: "Files touched", value: session.counts.filesTouched, unit: "files" },
          { label: "Caveats", value: session.availability.notes.length, unit: "count" }
        ],
        nextActions: [
          { id: "transcript", label: "Open transcript", href: `/usage/sessions/${encodeURIComponent(session.id)}/messages` },
          { id: "timeline", label: "Open timeline", href: `/usage/sessions/${encodeURIComponent(session.id)}/timeline` },
          { id: "compare", label: "Compare session", href: `/usage/sessions/${encodeURIComponent(session.id)}/compare` },
          { id: "rollup", label: "Create rollup from this session", href: `/rollup/new?session=${encodeURIComponent(session.id)}` },
          { id: "export", label: "Export JSON/CSV", href: `/api/usage/sessions/${encodeURIComponent(session.id)}/export` }
        ],
        caveats: [...session.availability.notes, ...result.meta.warnings.map((warning) => warning.message)]
      };
    },
    /** Gets session timeline. */
    async getSessionTimeline(id, query = {}) {
      const result = await usage.sessions.timeline(id, query);
      const data = result.data as UsageTimelineView & { items?: unknown[] };
      return {
        ...data,
        items: (data.items || []).map(timelineItem),
        caveats: [...(data.caveats || []), ...result.meta.warnings.map((warning) => warning.message)]
      };
    },
    /** Gets transcript. */
    async getTranscript(id, query = {}) {
      const result = await usage.sessions.report(id, { includeTools: query.includeTools !== false });
      const data = result.data as UsageTranscriptView & { messages?: UsageDomainMessage[] };
      return {
        ...data,
        schema: data.schema || "tangent.usage.transcript.v1",
        messages: (data.messages || []).map(transcriptMessage),
        caveats: [...(data.caveats || []), ...result.meta.warnings.map((warning) => warning.message)]
      };
    },
    /** Gets message selection. */
    async getMessageSelection(query) {
      const result = await usage.messages.query({ where: { role: query.role, textChars: { gte: 0 } }, limit: 200 });
      const contains = query.contains?.toLowerCase();
      return {
        messages: result.data
          .filter((message) => !contains || (message.text || message.textPreview || "").toLowerCase().includes(contains))
          .map((message) => ({
            id: message.id,
            role: message.role,
            preview: message.textPreview || message.text,
            tokens: message.metrics?.tokens?.total,
            reason: "matches query"
          })),
        caveats: result.meta.warnings.map((warning) => warning.message)
      };
    }
  };
}

/** Builds a query string from defined scalar values. */
function queryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === false) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Maps a Usage timeline item into the chart DTO. */
function timelineItem(value: unknown): UsageTimelineItemView {
  const item = objectValue(value);
  return {
    id: stringValue(item.id) || stringValue(item.stepId) || "unknown",
    label: stringValue(item.label) || stringValue(item.kind) || "Step",
    kind: stringValue(item.kind) || "unknown",
    startedAt: stringValue(item.startedAt),
    endedAt: stringValue(item.endedAt),
    offsetMs: numberValue(item.offsetMs),
    durationMs: numberValue(item.durationMs),
    metricValue: numberValue(item.metricValue),
    depth: numberValue(item.depth),
    status: stringValue(item.status),
    confidence: stringValue(item.durationConfidence) || stringValue(item.confidence)
  };
}

/** Maps a Usage message into a transcript DTO. */
function transcriptMessage(message: UsageDomainMessage): UsageTranscriptMessageView {
  const totalTokens = message.tokenUsage?.total ?? message.metrics?.tokens?.total;
  return {
    id: message.id,
    role: roleValue(message.role),
    at: message.createdAt,
    title: message.model,
    text: message.text,
    textPreview: message.textPreview || message.text,
    tokens: totalTokens === undefined ? undefined : { label: "Tokens", value: totalTokens, unit: "tokens" },
    toolCalls: message.toolCalls?.map(toolCall),
    confidence: message.confidence || message.tokenUsage?.confidence
  };
}

/** Maps a Usage tool call into a compact transcript summary. */
function toolCall(call: NonNullable<UsageDomainMessage["toolCalls"]>[number]): UsageToolCallSummaryView {
  return {
    id: call.id,
    name: call.toolName || call.name || "tool",
    status: call.status,
    durationMs: call.result?.durationMs,
    target: call.targetPaths?.[0]
  };
}

/** Normalizes arbitrary role strings to transcript roles. */
function roleValue(value: string): UsageTranscriptMessageView["role"] {
  return value === "user" || value === "assistant" || value === "system" || value === "tool" ? value : "assistant";
}

/** Returns an object view of an unknown value. */
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** Returns a string value when present. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Returns a number value when present. */
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
