import { cleanTitle, confidenceOrUnknown, finiteNumber, formatDateTime, formatDuration, formatMessageTokenUsage, formatTokens, messageTokens, stepDuration, stepKindLabel, truncateText } from "./format.js";
import type {
  UsageConversationChartRow,
  UsageConversationChartSegment,
  UsageConversationMessage,
  UsageConversationProjectGroup,
  UsageConversationSessionItem,
  UsageConversationView,
  UsageMessage,
  UsageSession,
  UsageStep,
  UsageTokenUsage
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
  const lastActivityAt = session.lastActivityAt || session.endedAt || session.startedAt;
  return {
    id: session.id,
    title: cleanTitle(session.title || session.firstPrompt || session.id),
    provider: session.provider || "unknown",
    status: session.status,
    startedAt: session.startedAt,
    lastActivityAt,
    lastActivityLabel: formatDateTime(lastActivityAt),
    durationLabel: formatDuration(session.metrics?.durationMs),
    tokenLabel: formatTokens(session.metrics?.tokens?.total),
    messageCountLabel: countLabel(session.counts?.messages, "message"),
    toolCallLabel: countLabel(session.counts?.toolCalls, "tool call"),
    summary: truncateText(session.summary || session.firstPrompt, 140) || undefined
  };
}

/** Formats a compact singular/plural count label when the value is known. */
function countLabel(value: number | undefined, unit: string): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const rounded = Math.max(0, Math.round(value));
  return `${Intl.NumberFormat("en").format(rounded)} ${unit}${rounded === 1 ? "" : "s"}`;
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

type WorkTurn = {
  id: string;
  label: string;
  primaryMessageId: string;
  messageIds: string[];
  startMs?: number;
  endMs?: number;
  at?: string;
  rawMessages: UsageMessage[];
  messages: UsageConversationMessage[];
};

/** Builds chart rows grouped by user-request work turns. */
function chartRows(conversationMessages: UsageConversationMessage[], rawMessages: UsageMessage[], steps: UsageStep[], sessionEndedAt?: string): UsageConversationChartRow[] {
  const rawById = new Map(rawMessages.map((message) => [message.id, message]));
  const stepCandidates = steps.filter((step) => step.kind !== "session" && step.kind !== "turn" && step.kind !== "user_message");
  return workTurns(conversationMessages, rawMessages, sessionEndedAt).map((turn, index) => {
    const linked = linkedWorkTurnSteps(turn, rawById, steps, stepCandidates);
    const segments = chartSegments(turn.primaryMessageId, linked);
    const duration = workTurnDuration(turn) ?? stepDurationTotal(linked) ?? segmentDurationTotal(segments);
    const tokenUsage = workTurnTokenUsage(turn.rawMessages);
    const tokens = workTurnTokens(tokenUsage);
    return {
      id: `work-turn:${turn.primaryMessageId}`,
      messageId: turn.primaryMessageId,
      messageIds: turn.messageIds,
      role: "assistant",
      label: turn.label || `Work turn ${index + 1}`,
      at: turn.at,
      tokens,
      tokenLabel: formatMessageTokenUsage(tokenUsage, tokens),
      durationMs: duration,
      durationLabel: formatDuration(duration),
      widthShare: 0,
      heightShare: 0,
      anchor: false,
      confidence: workTurnConfidence(turn.messages),
      segments
    };
  });
}

/** Builds user-request work turns from ordered conversation messages. */
function workTurns(conversationMessages: UsageConversationMessage[], rawMessages: UsageMessage[], sessionEndedAt?: string): WorkTurn[] {
  const rawById = new Map(rawMessages.map((message) => [message.id, message]));
  const turns: WorkTurn[] = [];
  let current: WorkTurn | undefined;
  for (const [index, message] of conversationMessages.entries()) {
    if (message.role === "user" || !current) {
      if (current) turns.push(finalizeWorkTurn(current, message.at));
      const primary = nextNonUserMessage(conversationMessages, index + 1);
      current = {
        id: `work-turn:${message.id}`,
        label: truncateText(message.textPreview || message.text || `Work turn ${turns.length + 1}`, 80) || `Work turn ${turns.length + 1}`,
        primaryMessageId: primary?.id || message.id,
        messageIds: [message.id],
        startMs: parseTimeMs(message.at),
        at: message.at,
        rawMessages: [rawById.get(message.id)].filter(isDefined),
        messages: [message]
      };
      continue;
    }
    current.messageIds.push(message.id);
    current.rawMessages.push(...[rawById.get(message.id)].filter(isDefined));
    current.messages.push(message);
    if (current.primaryMessageId === current.messageIds[0]) current.primaryMessageId = message.id;
  }
  if (current) turns.push(finalizeWorkTurn(current, sessionEndedAt));
  return turns.filter((turn) => turn.messages.some((message) => message.role !== "user"));
}

/** Finalizes a work turn with an exclusive end timestamp. */
function finalizeWorkTurn(turn: WorkTurn, endedAt: string | undefined): WorkTurn {
  return { ...turn, endMs: parseTimeMs(endedAt) };
}

/** Returns the next non-user message after an index. */
function nextNonUserMessage(messages: UsageConversationMessage[], startIndex: number): UsageConversationMessage | undefined {
  for (const message of messages.slice(startIndex)) {
    if (message.role === "user") return undefined;
    return message;
  }
  return undefined;
}

/** Finds message-owned and timestamp-window steps for a work turn. */
function linkedWorkTurnSteps(turn: WorkTurn, rawById: Map<string, UsageMessage>, steps: UsageStep[], candidates: UsageStep[]): UsageStep[] {
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const result = new Map<string, UsageStep>();
  for (const messageId of turn.messageIds) {
    const message = rawById.get(messageId);
    const direct = message?.stepId ? stepById.get(message.stepId) : undefined;
    if (direct && direct.kind !== "user_message") result.set(direct.id, direct);
    for (const call of message?.toolCalls || []) {
      const callStep = call.stepId ? stepById.get(call.stepId) : undefined;
      const resultStep = call.resultStepId ? stepById.get(call.resultStepId) : undefined;
      if (callStep) result.set(callStep.id, callStep);
      if (resultStep) result.set(resultStep.id, resultStep);
    }
  }
  if (turn.startMs !== undefined && turn.endMs !== undefined && turn.endMs >= turn.startMs) {
    for (const step of candidates) {
      const stepMs = parseTimeMs(step.startedAt);
      if (stepMs === undefined || stepMs < turn.startMs || stepMs >= turn.endMs) continue;
      result.set(step.id, step);
    }
  }
  return [...result.values()].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || (left.startedAt || "").localeCompare(right.startedAt || ""));
}

/** Derives a work turn duration from its exclusive timestamp boundary. */
function workTurnDuration(turn: WorkTurn): number | undefined {
  if (turn.startMs === undefined || turn.endMs === undefined || turn.endMs < turn.startMs) return undefined;
  return turn.endMs - turn.startMs;
}

/** Aggregates assistant message token usage for one user-request work turn. */
function workTurnTokenUsage(messages: UsageMessage[]): UsageTokenUsage | undefined {
  const usages = messages
    .filter((message) => conversationRole(message.role) === "assistant")
    .map((message) => message.tokenUsage || message.metrics?.tokens)
    .filter(isDefined);
  if (!usages.length) return undefined;

  const context = maxNumbers(usages.map(tokenContext));
  const output = sumNumbers(usages.map((usage) => finiteNumber(usage.output)));
  const cacheRead = sumNumbers(usages.map((usage) => finiteNumber(usage.cacheRead)));
  const cacheCreation = sumNumbers(usages.map((usage) => finiteNumber(usage.cacheCreation)));
  const reasoning = sumNumbers(usages.map((usage) => finiteNumber(usage.reasoning)));
  const explicitTotal = maxNumbers(usages.map((usage) => finiteNumber(usage.total)));
  const total = sumNumbers([context, output]) ?? explicitTotal;
  return {
    context,
    input: context,
    output,
    total,
    cacheRead,
    cacheCreation,
    reasoning,
    confidence: combinedConfidence(usages.map((usage) => usage.confidence)),
    source: usages.map((usage) => usage.source).filter(isDefined)[0]
  };
}

/** Returns the token total that should drive work-turn bar width. */
function workTurnTokens(usage: UsageTokenUsage | undefined): number | undefined {
  return finiteNumber(usage?.total) ?? sumNumbers([tokenContext(usage), finiteNumber(usage?.output)]);
}

/** Returns the lowest-confidence message state represented inside a work turn. */
function workTurnConfidence(messages: UsageConversationMessage[]): UsageConversationChartRow["confidence"] {
  return combinedConfidence(messages.map((message) => message.confidence));
}

/** Returns the context token count from all compatible Usage token fields. */
function tokenContext(usage: UsageTokenUsage | undefined): number | undefined {
  if (!usage) return undefined;
  return finiteNumber(usage.context) ?? finiteNumber(usage.input) ?? sumNumbers([finiteNumber(usage.cacheRead), finiteNumber(usage.cacheCreation)]);
}

/** Collapses mixed source confidence to the most conservative UI value. */
function combinedConfidence(values: Array<string | undefined>): UsageConversationChartRow["confidence"] {
  const normalized = values.map((value) => confidenceOrUnknown(value)).filter(isDefined);
  if (normalized.includes("partial")) return "partial";
  if (normalized.includes("estimated")) return "estimated";
  if (normalized.includes("unknown")) return "unknown";
  if (normalized.includes("derived")) return "derived";
  return normalized[0] || "unknown";
}

/** Sums finite numeric values when at least one value is present. */
function sumNumbers(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) : undefined;
}

/** Returns the maximum finite numeric value when at least one value is present. */
function maxNumbers(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return present.length ? Math.max(...present) : undefined;
}

/** Narrows undefined values out of arrays. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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
