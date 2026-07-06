export type * from "./publicTypes.js";
export { buildUsageBreakdowns } from "./breakdown.js";
export { buildUsageCockpitView, buildInspectorDefaultView, buildSessionHeroView, sessionTotalTokens, timelineSteps, transcriptMessages } from "./cockpit.js";
export { buildUsageConversationView } from "./conversationView.js";
export { buildSparkline } from "./flame.js";
export { buildDiagnosticCards, primaryFinding } from "./diagnostics.js";
export { groupSessionsByProject, projectSlug, type UsageProjectRailItem } from "./projects.js";
export {
  buildInsightsFeedView,
  createInsightsApiClient,
  type UsageInsightsApiCategory,
  type UsageInsightsApiEvidence,
  type UsageInsightsApiFinding,
  type UsageInsightsApiResponse,
  type UsageInsightsCategoryView,
  type UsageInsightsClient,
  type UsageInsightsEvidenceRow,
  type UsageInsightsFeedView,
  type UsageInsightsFindingRow,
  type UsageInsightsParkResult,
  type UsageInsightsQuery
} from "./insights.js";
export { buildSessionFinderView, sessionFinderItem } from "./sessionFinder.js";
export { buildUsageSessionTimelineView } from "./sessionTimeline.js";
export { buildSessionStoryline } from "./storyline.js";
export { buildTraceWaterfall } from "./trace.js";
export { buildTranscriptHighlights } from "./transcriptHighlights.js";
export { middleTruncatePath, NO_PROJECT_LABEL } from "./format.js";
export { deriveDisplayTitle, extractCommandName, isCommandXml, isTaskNotificationXml, stripCommandMarkup, taskNotificationLabel } from "./titles.js";

import type { UsageDomainMessage, UsageDomainResult, UsageDomainSession, UsageDomainToolCall, UsageDomainTranscript } from "./domainTypes.js";
import { buildUsageCockpitView, timelineSteps, transcriptMessages } from "./cockpit.js";
import { buildUsageConversationView, projectLabel, type UsageConversationToolCall } from "./conversationView.js";
import { buildSparkline, sparklineFromPrecomputed } from "./flame.js";
import { peakContextTokens } from "./format.js";
import type { UsageInsightsApiResponse } from "./insights.js";
import { buildUsageSessionTimelineView } from "./sessionTimeline.js";
import { deriveDisplayTitle } from "./titles.js";
import type {
  UsageCockpitView,
  UsageConversationView,
  UsageMessage,
  UsageSession,
  UsageSessionTimelineView,
  UsageSparkline,
  UsageStep,
  UsageTimeline,
  UsageUiConfidence
} from "./types.js";

export type UsageSessionListQuery = {
  provider?: string;
  limit?: number;
};

export type TimelineQuery = {
  metric?: "durationMs" | "selfDurationMs" | "tokens.total" | "cost.amount";
};

export type UsageSessionTimelineQuery = {
  query?: string;
  reason?: "active" | "recent" | "costly" | "slow" | "failed";
  limit?: number;
};

export type UsageConversationQuery = {
  query?: string;
  limit?: number;
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
  lastActivityAt?: string;
  status?: string;
  durationMs?: number;
  /** Cumulative tokens the session consumed (from metrics.tokens.total), for the list card total. */
  tokensTotal?: number;
  /** Peak context-window size the session reached, not a cumulative token sum. */
  peakContext?: number;
  toolCalls?: number;
  filesTouched?: number;
  caveatCount?: number;
  /** Compact activity series for the list card / rail flame graph. */
  flame?: UsageSparkline;
  /** Project the session ran in (basename of its repo/cwd), for the card badge and project rail. */
  project?: string;
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
  commandPreview?: string;
  workdir?: string;
  preview?: string;
  resultDisplayPreview?: string;
  resultPreview?: string;
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
  tools?: {
    query(query?: unknown): Promise<UsageDomainResult<UsageDomainToolCall[]>>;
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
  getCockpit(id: string): Promise<UsageCockpitView>;
  getConversationView(id: string, query?: UsageConversationQuery): Promise<UsageConversationView>;
  getSessionTimelineView(id: string, query?: UsageSessionTimelineQuery): Promise<UsageSessionTimelineView>;
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
    /** Gets a conversation-first cockpit view through the local API. */
    getCockpit: (id) => api(`/api/usage/sessions/${encodeURIComponent(id)}/cockpit`),
    /** Gets the conversation inspector view through the local API. */
    getConversationView: (id, query = {}) => api(`/api/usage/sessions/${encodeURIComponent(id)}/conversation-view${queryString(query)}`),
    /** Gets a minimal session timeline view through the local API. */
    getSessionTimelineView: (id, query = {}) => api(`/api/usage/sessions/${encodeURIComponent(id)}/timeline-view${queryString(query)}`),
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
      // Claude writes placeholder transcripts (a lone `ai-title` record, no messages, tokens, or
      // timestamps) for title generation and aborted starts. They carry nothing to show and read as
      // token-less, time-less noise next to real sessions, so drop the completely empty ones. A
      // just-started session keeps at least its user message, so this never hides live work.
      const sessions = result.data.filter((session) => !isEmptySession(session));
      // The SQLite client returns each session's sparkline precomputed at index time, so the list
      // renders every card from that single payload with no per-card timeline query (the old N+1).
      // The in-memory client (tests, injected) has no precomputed series, so fall back to a timeline.
      const flames = await Promise.all(sessions.map((session) =>
        session.sparkline ? sparklineFromPrecomputed(session.sparkline) : sessionSparkline(usage, session.id)));
      return {
        sessions: sessions.map((session, index) => ({
          id: session.id,
          title: deriveDisplayTitle([session.title, session.firstPrompt], session.id),
          subtitle: [session.provider, session.models?.join(", ")].filter(Boolean).join(" · "),
          provider: session.provider,
          model: session.models?.[0],
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          lastActivityAt: session.lastActivityAt,
          status: session.status,
          durationMs: session.metrics.durationMs,
          tokensTotal: session.metrics.tokens?.total,
          peakContext: peakContextTokens(session.metrics.tokens),
          toolCalls: session.counts.toolCalls,
          filesTouched: session.counts.filesTouched,
          caveatCount: session.availability.notes.length,
          flame: flames[index],
          project: projectLabel(session)
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
          title: deriveDisplayTitle([session.title, session.firstPrompt], session.id),
          provider: session.provider,
          model: session.models?.[0],
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          lastActivityAt: session.lastActivityAt,
          status: session.status,
          durationMs: session.metrics.durationMs,
          peakContext: peakContextTokens(session.metrics.tokens),
          toolCalls: session.counts.toolCalls,
          filesTouched: session.counts.filesTouched,
          caveatCount: session.availability.notes.length
        },
        summaryCards: [
          { label: "Duration", value: session.metrics.durationMs, unit: "ms", confidence: session.metrics.durationConfidence },
          { label: "Peak context", value: peakContextTokens(session.metrics.tokens), unit: "tokens", confidence: session.metrics.tokens?.confidence },
          { label: "Tool calls", value: session.counts.toolCalls, unit: "count" },
          { label: "Files touched", value: session.counts.filesTouched, unit: "files" },
          { label: "Caveats", value: session.availability.notes.length, unit: "count" }
        ],
        nextActions: [
          { id: "transcript", label: "Read transcript", href: `/usage/sessions/${encodeURIComponent(session.id)}/messages` },
          { id: "timeline", label: "Inspect trace", href: `/usage/sessions/${encodeURIComponent(session.id)}/timeline` },
          { id: "compare", label: "Compare with another session", href: `/usage/sessions/${encodeURIComponent(session.id)}/compare` },
          { id: "rollup", label: "Create rollup", href: `/rollup/new?session=${encodeURIComponent(session.id)}` },
          { id: "export", label: "Export session data", href: `/api/usage/sessions/${encodeURIComponent(session.id)}/export` },
          { id: "evidence", label: "Inspect evidence", href: `/usage/sessions/${encodeURIComponent(session.id)}/evidence` }
        ],
        caveats: [...session.availability.notes, ...result.meta.warnings.map((warning) => warning.message)]
      };
    },
    /** Gets cockpit. */
    async getCockpit(id) {
      const [sessionResult, timelineResult, reportResult, listResult] = await Promise.all([
        usage.sessions.get(id),
        usage.sessions.timeline(id, { metric: "selfDurationMs" }),
        usage.sessions.report(id, { includeTools: true }),
        usage.sessions.list({ limit: 50, orderBy: [{ field: "lastActivityAt", direction: "desc" }] })
      ]);
      const session = domainSession(sessionResult.data);
      const timeline = timelineResult.data as UsageTimeline;
      const report = reportResult.data as { messages?: UsageMessage[]; caveats?: string[] };
      return buildUsageCockpitView(
        session,
        timelineSteps(timeline),
        transcriptMessages(report.messages || []),
        timeline,
        {
          sessions: listResult.data.map(domainSession),
          selectedSessionId: session.id,
          listCaveats: listResult.meta.warnings.map((warning) => warning.message),
          detailCaveats: sessionResult.meta.warnings.map((warning) => warning.message),
          timelineCaveats: [...(timeline.caveats || []), ...timelineResult.meta.warnings.map((warning) => warning.message)],
          transcriptCaveats: [...(report.caveats || []), ...reportResult.meta.warnings.map((warning) => warning.message)]
        }
      );
    },
    /** Gets conversation view. */
    async getConversationView(id, query = {}) {
      const [sessionResult, timelineResult, reportResult, listResult] = await Promise.all([
        usage.sessions.get(id),
        usage.sessions.timeline(id, { metric: "selfDurationMs" }),
        usage.sessions.report(id, { includeTools: true }),
        usage.sessions.list({ limit: query.limit || 50, orderBy: [{ field: "lastActivityAt", direction: "desc" }] })
      ]);
      const session = domainSession(sessionResult.data);
      const timeline = timelineResult.data as UsageTimeline;
      const report = reportResult.data as { messages?: UsageMessage[]; caveats?: string[] };
      const toolResult = await usage.tools?.query({ where: { sessionId: session.id } }).catch(() => undefined);
      return buildUsageConversationView(
        session,
        listResult.data.map(domainSession),
        transcriptMessages(report.messages || []),
        timelineSteps(timeline),
        {
          query: query.query,
          toolCalls: (toolResult?.data || []).map(conversationToolCall),
          caveats: [
            ...(session.availability?.notes || []),
            ...listResult.meta.warnings.map((warning) => warning.message),
            ...sessionResult.meta.warnings.map((warning) => warning.message),
            ...(timeline.caveats || []),
            ...timelineResult.meta.warnings.map((warning) => warning.message),
            ...(report.caveats || []),
            ...reportResult.meta.warnings.map((warning) => warning.message)
          ]
        }
      );
    },
    /** Gets session timeline view. */
    async getSessionTimelineView(id, query = {}) {
      const [sessionResult, timelineResult, listResult] = await Promise.all([
        usage.sessions.get(id),
        usage.sessions.timeline(id, { metric: "tokens.total" }),
        usage.sessions.list({ limit: query.limit || 50, orderBy: [{ field: "lastActivityAt", direction: "desc" }] })
      ]);
      const session = domainSession(sessionResult.data);
      const timeline = timelineResult.data as UsageTimeline;
      return buildUsageSessionTimelineView(
        session,
        timelineSteps(timeline),
        timeline,
        {
          sessions: listResult.data.map(domainSession),
          selectedSessionId: session.id,
          query: query.query,
          listCaveats: listResult.meta.warnings.map((warning) => warning.message),
          timelineCaveats: [...(timeline.caveats || []), ...timelineResult.meta.warnings.map((warning) => warning.message)]
        }
      );
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

/** Reports whether a listed session has no conversation to show: no messages and no recorded tokens. */
function isEmptySession(session: { counts?: { messages?: number }; metrics?: { tokens?: { total?: number } } }): boolean {
  const messages = session.counts?.messages ?? 0;
  const tokens = session.metrics?.tokens?.total ?? 0;
  return messages === 0 && tokens === 0;
}

/** Builds the compact activity series for one listed session, tolerating timeline failures. */
async function sessionSparkline(usage: UsageDomainClient, id: string): Promise<UsageSparkline | undefined> {
  try {
    const result = await usage.sessions.timeline(id, { metric: "selfDurationMs" });
    return buildSparkline(timelineSteps(result.data as UsageTimeline));
  } catch {
    return undefined;
  }
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
    durationMs: toolResultDuration(call.result),
    target: call.targetPaths?.[0],
    commandPreview: toolInputPreview(call.input),
    workdir: toolWorkdir(call.input) || call.targetPaths?.[0],
    preview: toolInputPreview(call.input),
    resultDisplayPreview: cleanToolResultPreview(call.result?.outputPreview),
    resultPreview: undefined
  };
}

/** Maps a domain tool call into conversation-view matching input. */
function conversationToolCall(call: UsageDomainToolCall): UsageConversationToolCall {
  return {
    id: call.id,
    stepId: call.stepId,
    resultStepId: call.resultStepId,
    toolName: call.toolName,
    name: call.name,
    status: call.status,
    input: call.input,
    plan: call.plan,
    targetPaths: call.targetPaths,
    result: call.result
      ? {
          durationMs: toolResultDuration(call.result),
          outputPreview: call.result.outputPreview
        }
      : undefined
  };
}

/** Extracts a concise preview for common tool input shapes. */
function toolInputPreview(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return typeof value === "string" ? value : undefined;
  const input = value as Record<string, unknown>;
  return stringValue(input.command) || stringValue(input.cmd) || stringValue(input.query) || stringValue(input.pattern) || stringValue(input.path) || stringValue(input.file_path);
}

/** Extracts the working directory from common command tool payloads. */
function toolWorkdir(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  return stringValue(input.workdir) || stringValue(input.cwd);
}

/** Strips provider transport boilerplate from compact tool output. */
function cleanToolResultPreview(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const inlineOutput = /\bOutput:\s*/i.exec(text);
  const displayText = inlineOutput ? text.slice(inlineOutput.index + inlineOutput[0].length) : text;
  const lines = displayText.split(/\r?\n/);
  const outputIndex = lines.findIndex((line) => line.trim() === "Output:");
  const hasBoilerplate = Boolean(inlineOutput) || outputIndex >= 0 || text.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return /^Chunk ID:/i.test(trimmed)
      || /^Wall time:/i.test(trimmed)
      || /^Process exited with code/i.test(trimmed)
      || /^Original token count:/i.test(trimmed);
  });
  const relevant = outputIndex >= 0 ? lines.slice(outputIndex + 1) : lines;
  const cleaned = relevant
    .filter((line) => {
      const trimmed = line.trim();
      return !/^Chunk ID:/i.test(trimmed)
        && !/^Wall time:/i.test(trimmed)
        && !/^Process exited with code/i.test(trimmed)
        && !/^Original token count:/i.test(trimmed)
        && trimmed !== "Output:";
    })
    .join("\n")
    .trim();
  return cleaned || (hasBoilerplate ? undefined : text);
}

/** Returns structured or parsed duration for a domain tool result. */
function toolResultDuration(result: { durationMs?: number; outputPreview?: string } | undefined): number | undefined {
  return numberValue(result?.durationMs) ?? parseWallTimeMs(result?.outputPreview);
}

/** Parses Codex exec wall-time text into milliseconds. */
function parseWallTimeMs(value: string | undefined): number | undefined {
  const match = /\bWall time:\s*([0-9]+(?:\.[0-9]+)?)\s*seconds\b/i.exec(value || "");
  if (!match) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : undefined;
}

/** Normalizes a domain session into the cockpit DTO input shape. */
function domainSession(session: UsageDomainSession): UsageSession {
  return {
    id: session.id,
    provider: session.provider,
    providerSessionId: session.providerSessionId,
    transcriptPath: session.transcriptPath,
    title: session.title,
    firstPrompt: session.firstPrompt,
    summary: session.summary,
    project: session.project,
    repo: session.repo,
    cwd: session.cwd,
    gitBranch: session.gitBranch,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lastActivityAt: session.lastActivityAt || session.endedAt || session.startedAt,
    status: session.status,
    models: session.models,
    metrics: session.metrics,
    counts: session.counts,
    availability: session.availability,
    evidence: session.evidence,
    providerFields: session.providerFields
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
