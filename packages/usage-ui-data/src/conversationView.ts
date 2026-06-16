import { cleanTitle, confidenceOrUnknown, formatDuration, formatMessageTokenUsage, formatTokens, messageTokens, stepDuration, stepKindLabel, truncateText } from "./format.js";
import type {
  UsageConversationChartRow,
  UsageConversationChartSegment,
  UsageConversationMessage,
  UsageConversationProjectGroup,
  UsageConversationSessionItem,
  UsageConversationView,
  UsageMessage,
  UsageSession,
  UsageStep
} from "./types.js";

export type UsageConversationViewOptions = {
  query?: string;
  caveats?: string[];
};

/** Builds the Svelte Usage conversation workspace DTO. */
export function buildUsageConversationView(
  selectedSession: UsageSession,
  sessions: UsageSession[],
  messages: UsageMessage[],
  steps: UsageStep[],
  options: UsageConversationViewOptions = {}
): UsageConversationView {
  const query = (options.query || "").trim().toLowerCase();
  const visibleSessions = query ? sessions.filter((session) => sessionMatches(session, query)) : sessions;
  const conversationMessages = messages.map(conversationMessage);
  const rows = chartRows(conversationMessages, messages, steps, selectedSession.endedAt);
  const maxTokens = Math.max(1, ...rows.map((row) => row.tokens || 0));
  const maxDurationMs = Math.max(1, ...rows.map((row) => row.durationMs || 0));
  return {
    selected: {
      ...sessionItem(selectedSession),
      model: selectedSession.models?.[0],
      startedAt: selectedSession.startedAt,
      endedAt: selectedSession.endedAt,
      caveatCount: (selectedSession.availability?.notes || []).length
    },
    projects: projectGroups(visibleSessions, selectedSession.id),
    messages: conversationMessages,
    chart: {
      maxTokens,
      maxDurationMs,
      rows: rows.map((row) => ({
        ...row,
        widthShare: row.tokens === undefined ? 0.02 : Math.max(0.02, row.tokens / maxTokens),
        heightShare: row.durationMs === undefined ? 0.08 : row.durationMs / maxDurationMs
      }))
    },
    caveats: conversationCaveats(rows, options.caveats || [])
  };
}

/** Converts a session to a conversation picker row. */
function sessionItem(session: UsageSession): UsageConversationSessionItem {
  return {
    id: session.id,
    title: cleanTitle(session.title || session.firstPrompt || session.id),
    provider: session.provider || "unknown",
    status: session.status,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt || session.endedAt || session.startedAt,
    durationLabel: formatDuration(session.metrics?.durationMs),
    tokenLabel: formatTokens(session.metrics?.tokens?.total),
    summary: truncateText(session.summary || session.firstPrompt, 140) || undefined
  };
}

/** Groups sessions by project/repo for the left pane. */
function projectGroups(sessions: UsageSession[], selectedSessionId: string): UsageConversationProjectGroup[] {
  const groups = new Map<string, UsageConversationProjectGroup>();
  const sorted = [...sessions].sort((left, right) => (right.lastActivityAt || right.endedAt || right.startedAt || "").localeCompare(left.lastActivityAt || left.endedAt || left.startedAt || ""));
  for (const session of sorted) {
    const label = projectLabel(session);
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown";
    const group = groups.get(id) || { id, label, sessions: [] };
    group.sessions.push(sessionItem(session));
    groups.set(id, group);
  }
  if (![...groups.values()].some((group) => group.sessions.some((session) => session.id === selectedSessionId))) groups.set("selected", { id: "selected", label: "Selected session", sessions: [] });
  return [...groups.values()];
}

/** Builds a project label from stable session metadata. */
function projectLabel(session: Pick<UsageSession, "project" | "repo" | "cwd">): string {
  return cleanTitle(session.project || session.repo?.id || basename(session.repo?.root || session.repo?.cwd || session.cwd) || "Unknown project", "Unknown project");
}

/** Converts a message into the conversation pane DTO. */
function conversationMessage(message: UsageMessage): UsageConversationMessage {
  const tokens = messageTokens(message);
  const duration = messageDuration(message);
  return {
    id: message.id,
    role: conversationRole(message.role),
    title: messageTitle(message),
    at: message.createdAt || message.at,
    text: message.text,
    textPreview: message.textPreview || truncateText(message.text, 500),
    tokenLabel: formatMessageTokenUsage(message.tokenUsage || message.metrics?.tokens, tokens),
    tokens,
    durationLabel: formatDuration(duration),
    durationMs: duration,
    confidence: confidenceOrUnknown(message.confidence || message.tokenUsage?.confidence),
    toolCalls: (message.toolCalls || []).map((call) => ({
      id: call.id,
      name: call.toolName || call.name || "tool",
      status: call.status,
      durationLabel: formatDuration(call.result?.durationMs),
      target: call.targetPaths?.[0]
    }))
  };
}

/** Builds chart rows from messages and their linked steps. */
function chartRows(conversationMessages: UsageConversationMessage[], rawMessages: UsageMessage[], steps: UsageStep[], sessionEndedAt?: string): UsageConversationChartRow[] {
  const rawById = new Map(rawMessages.map((message) => [message.id, message]));
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const stepCandidates = steps.filter((step) => step.kind !== "session" && step.kind !== "turn" && step.kind !== "user_message");
  return conversationMessages.map((message, index) => {
    const raw = rawById.get(message.id);
    if (message.role !== "assistant") {
      return {
        id: `anchor:${message.id}`,
        messageId: message.id,
        role: message.role,
        label: message.title || `Message ${index + 1}`,
        at: message.at,
        tokens: message.tokens,
        tokenLabel: message.tokenLabel,
        durationMs: message.durationMs,
        durationLabel: message.durationLabel,
        widthShare: 0.02,
        heightShare: 0.08,
        anchor: true,
        confidence: message.confidence || "unknown",
        segments: []
      };
    }

    const startMs = parseTimeMs(message.at);
    const endMs = parseTimeMs(conversationMessages[index + 1]?.at) ?? parseTimeMs(sessionEndedAt);
    const linked = linkedMessageSteps(raw, stepById, stepCandidates, startMs, endMs);
    const segments = chartSegments(message.id, linked);
    const duration = message.durationMs ?? stepDurationTotal(linked) ?? segmentDurationTotal(segments) ?? elapsedUntilNextMessage(conversationMessages, index, sessionEndedAt);
    return {
      id: `row:${message.id}`,
      messageId: message.id,
      role: "assistant",
      label: message.title || `Assistant ${index + 1}`,
      at: message.at,
      tokens: message.tokens,
      tokenLabel: message.tokenLabel,
      durationMs: duration,
      durationLabel: formatDuration(duration),
      widthShare: 0,
      heightShare: 0,
      anchor: false,
      confidence: message.confidence || "unknown",
      segments
    };
  });
}

/** Finds message-owned and turn-owned steps for an assistant row. */
function linkedMessageSteps(message: UsageMessage | undefined, stepById: Map<string, UsageStep>, steps: UsageStep[], startMs: number | undefined, endMs: number | undefined): UsageStep[] {
  if (!message) return [];
  const direct = message.stepId ? stepById.get(message.stepId) : undefined;
  const result = new Map<string, UsageStep>();
  if (direct) result.set(direct.id, direct);
  for (const call of message.toolCalls || []) {
    const callStep = call.stepId ? stepById.get(call.stepId) : undefined;
    const resultStep = call.resultStepId ? stepById.get(call.resultStepId) : undefined;
    if (callStep) result.set(callStep.id, callStep);
    if (resultStep) result.set(resultStep.id, resultStep);
  }
  if (result.size <= 1 && startMs !== undefined && endMs !== undefined && endMs >= startMs) {
    for (const step of steps) {
      const stepMs = parseTimeMs(step.startedAt);
      if (stepMs === undefined || stepMs < startMs || stepMs >= endMs) continue;
      result.set(step.id, step);
    }
  }
  return [...result.values()].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || (left.startedAt || "").localeCompare(right.startedAt || ""));
}

/** Converts linked steps to proportional row segments. */
function chartSegments(messageId: string, steps: UsageStep[]): UsageConversationChartSegment[] {
  const visible = steps.filter((step) => step.kind !== "turn" && step.kind !== "session");
  const durations = visible.map((step) => stepDuration(step));
  const durationTotal = durations.reduce<number>((sum, value) => sum + (value || 0), 0);
  return visible.map((step, index) => {
    const duration = stepDuration(step);
    return {
      id: `${messageId}:${step.id}`,
      label: cleanTitle(step.label || step.toolName || stepKindLabel(step.kind), `Step ${index + 1}`),
      kind: segmentKind(step),
      messageId,
      stepId: step.id,
      durationMs: duration,
      durationLabel: formatDuration(duration),
      heightShare: durationTotal > 0 && duration !== undefined ? Math.max(0.04, duration / durationTotal) : 1 / Math.max(1, visible.length),
      confidence: confidenceOrUnknown(step.durationConfidence || step.confidence)
    };
  });
}

/** Builds chart caveats without hiding source warnings. */
function conversationCaveats(rows: UsageConversationChartRow[], existing: string[]): string[] {
  const caveats = new Set(existing.filter(Boolean));
  if (rows.some((row) => row.role === "assistant" && row.tokens === undefined)) caveats.add("Some assistant messages do not include provider token totals.");
  if (rows.some((row) => row.role === "assistant" && row.durationMs === undefined)) caveats.add("Some assistant message durations are unavailable; chart heights use a fallback.");
  if (rows.some((row) => row.segments.length > 1 && row.segments.some((segment) => segment.durationMs === undefined))) caveats.add("Some step durations are unavailable; internal step bars are evenly sized.");
  return [...caveats];
}

/** Normalizes message roles for the conversation UI. */
function conversationRole(value: string): UsageConversationMessage["role"] {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") return value;
  return "assistant";
}

/** Builds a compact message title. */
function messageTitle(message: UsageMessage): string {
  if (message.role === "user") return "User";
  if (message.role === "assistant") return message.model ? `Assistant · ${message.model}` : "Assistant";
  if (message.role === "system") return "System";
  if (message.role === "tool") return "Tool";
  return cleanTitle(message.role, "Message");
}

/** Resolves message duration from its own fields or tool-call results. */
function messageDuration(message: UsageMessage): number | undefined {
  const direct = typeof message.providerFields?.durationMs === "number" ? message.providerFields.durationMs : undefined;
  const toolTotal = (message.toolCalls || []).reduce((sum, call) => sum + (call.result?.durationMs || 0), 0);
  return direct ?? (toolTotal || undefined);
}

/** Derives message work time from this message timestamp to the next message or session end. */
function elapsedUntilNextMessage(messages: UsageConversationMessage[], index: number, sessionEndedAt: string | undefined): number | undefined {
  const start = parseTimeMs(messages[index]?.at);
  const end = parseTimeMs(messages[index + 1]?.at) ?? parseTimeMs(sessionEndedAt);
  if (start === undefined || end === undefined || end < start) return undefined;
  return end - start;
}

/** Maps a step to an internal chart segment kind. */
function segmentKind(step: UsageStep): UsageConversationChartSegment["kind"] {
  if (step.kind === "assistant_response" || step.kind === "model_call" || step.kind === "subagent") return "assistant";
  if (step.kind === "tool_call" || step.kind === "permission") return "tool";
  if (step.kind === "tool_result") return "tool_result";
  if (step.kind === "command") return "command";
  if (step.kind === "file_read" || step.kind === "file_search" || step.kind === "file_write") return "file";
  if (step.kind === "compaction" || step.kind === "error") return "system";
  return "unknown";
}

/** Sums linked Usage step durations. */
function stepDurationTotal(values: UsageStep[]): number | undefined {
  const total = values.reduce((sum, value) => sum + (stepDuration(value) || 0), 0);
  return total || undefined;
}

/** Sums chart segment durations. */
function segmentDurationTotal(values: UsageConversationChartSegment[]): number | undefined {
  const total = values.reduce((sum, value) => sum + (value.durationMs || 0), 0);
  return total || undefined;
}

/** Parses a timestamp into epoch milliseconds. */
function parseTimeMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Returns whether a session matches a picker query. */
function sessionMatches(session: UsageSession, query: string): boolean {
  return [session.title, session.firstPrompt, session.summary, session.provider, session.status, session.project, session.repo?.root, session.cwd]
    .some((value) => (value || "").toLowerCase().includes(query));
}

/** Returns a path basename without importing Node path into browser DTO code. */
function basename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.split(/[\\/]/).filter(Boolean).at(-1);
}

/** Groups values by a stable key. */
function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) groups.set(key(value), [...(groups.get(key(value)) || []), value]);
  return groups;
}
