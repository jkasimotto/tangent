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
  role: string;
  text?: string;
  textPreview?: string;
  metrics?: { tokens?: { total?: number } };
};

export type UsageDomainClient = {
  sessions: {
    list(query?: unknown): Promise<UsageDomainResult<UsageDomainSession[]>>;
    get(id: string): Promise<UsageDomainResult<UsageDomainSession>>;
    timeline(id: string, query?: unknown): Promise<UsageDomainResult<UsageTimelineView>>;
    report(id: string, query?: unknown): Promise<UsageDomainResult<UsageTranscriptView>>;
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
  items: unknown[];
  caveats?: string[];
  [key: string]: unknown;
};
export type UsageTranscriptView = {
  schema: string;
  session?: unknown;
  messages: unknown[];
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

/** Creates create usage ui client. */
export function createUsageUiClient(usage: UsageDomainClient): UsageUiClient {
  return {
    /** Lists sessions. */
    async listSessions(query = {}) {
      const result = await usage.sessions.list({ provider: query.provider, limit: query.limit });
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
      return (await usage.sessions.timeline(id, query)).data as UsageTimelineView;
    },
    /** Gets transcript. */
    async getTranscript(id, query = {}) {
      return (await usage.sessions.report(id, { includeTools: query.includeTools !== false })).data;
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
