import { rankBottlenecks } from "./bottlenecks.js";
import { cleanTitle, confidenceOrUnknown, finiteNumber, formatContextTokens, formatDateTime, formatDuration, formatMessageTokenUsage, messageTokens, peakContextTokens, stepDuration, stepKindLabel, truncateText } from "./format.js";
import { stepInputPreviews, toolInputPreview, toolWorkdir } from "./toolInput.js";
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
  toolCalls?: UsageConversationToolCall[];
};

export type UsageConversationToolCall = {
  id: string;
  stepId?: string;
  resultStepId?: string;
  toolName?: string;
  name?: string;
  status?: string;
  input?: unknown;
  plan?: string;
  targetPaths?: string[];
  result?: {
    durationMs?: number;
    outputPreview?: string;
  };
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
  const baseConversationMessages = messages.map((message, index) => conversationMessage(message, messageTurnDuration(messages, index, selectedSession.endedAt)));
  const inputPreviews = stepInputPreviews(options.toolCalls || []);
  const rows = chartRows(baseConversationMessages, messages, steps, selectedSession.endedAt, options.toolCalls || [], inputPreviews);
  const conversationMessages = withTimelineToolEvents(baseConversationMessages, rows, options.toolCalls || []);
  const tokenModeRows = withTokenModes(rows);
  const maxTokens = Math.max(1, ...tokenModeRows.map((row) => row.tokenModes.cumulative.tokens || 0));
  const maxAddedTokens = Math.max(1, ...tokenModeRows.map((row) => row.tokenModes.added.tokens || 0));
  const maxDurationMs = Math.max(1, ...rows.map((row) => row.durationMs || 0));
  const chartRowsFinal: UsageConversationChartRow[] = tokenModeRows.map((row) => ({
    ...row,
    tokens: row.tokenModes.cumulative.tokens,
    tokenLabel: row.tokenModes.cumulative.tokenLabel,
    widthShare: row.tokenModes.cumulative.tokens === undefined ? 0.02 : Math.max(0.02, row.tokenModes.cumulative.tokens / maxTokens),
    tokenModes: {
      cumulative: {
        ...row.tokenModes.cumulative,
        widthShare: row.tokenModes.cumulative.tokens === undefined ? 0.02 : Math.max(0.02, row.tokenModes.cumulative.tokens / maxTokens)
      },
      added: {
        ...row.tokenModes.added,
        widthShare: row.tokenModes.added.tokens === undefined ? 0.02 : Math.max(0.02, row.tokenModes.added.tokens / maxAddedTokens)
      }
    },
    heightShare: row.durationMs === undefined ? 0.08 : row.durationMs / maxDurationMs
  }));
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
      maxAddedTokens,
      maxDurationMs,
      rows: chartRowsFinal
    },
    bottlenecks: rankBottlenecks(chartRowsFinal, inputPreviews),
    caveats: conversationCaveats(rows, options.caveats || [])
  };
}

/** Adds cumulative and added token views to chart rows. */
function withTokenModes(rows: ChartRowDraft[]): UsageConversationChartRow[] {
  let previousContext = 0;
  return rows.map((row) => {
    const cumulative = row.tokens;
    const added = contextDelta(cumulative, previousContext);
    if (cumulative !== undefined) previousContext = cumulative;
    return {
      ...row,
      tokenModes: {
        cumulative: {
          tokens: cumulative,
          tokenLabel: formatContextTokenLabel(cumulative),
          widthShare: 0
        },
        added: {
          tokens: added,
          tokenLabel: formatAddedTokenLabel(added),
          widthShare: 0
        }
      }
    };
  });
}

/** Returns context growth, treating decreases as compaction to the current size. */
function contextDelta(current: number | undefined, previous: number): number | undefined {
  if (current === undefined) return undefined;
  return current >= previous ? current - previous : current;
}

/** Formats cumulative context tokens for the chart. */
function formatContextTokenLabel(value: number | undefined): string | undefined {
  const formatted = formatMessageTokenCount(value);
  return formatted ? `${formatted} ctx` : undefined;
}

/** Formats per-turn context additions for the chart. */
function formatAddedTokenLabel(value: number | undefined): string | undefined {
  const formatted = formatMessageTokenCount(value);
  return formatted ? `${formatted} added` : undefined;
}

/** Backfills chart-linked tool and command steps into the conversation thread. */
function withTimelineToolEvents(messages: UsageConversationMessage[], rows: ChartRowDraft[], toolCalls: UsageConversationToolCall[]): UsageConversationMessage[] {
  const eventsByMessageId = new Map<string, UsageConversationMessage["toolCalls"]>();
  const toolByStepId = new Map<string, UsageConversationToolCall>();
  for (const tool of toolCalls) {
    if (tool.stepId) toolByStepId.set(tool.stepId, tool);
    if (tool.resultStepId) toolByStepId.set(tool.resultStepId, tool);
  }
  for (const row of rows) {
    const seenToolIds = new Set<string>();
    const events: UsageConversationMessage["toolCalls"] = [];
    for (const segment of row.segments) {
      if (segment.kind === "assistant") continue;
      const tool = segment.stepId ? toolByStepId.get(segment.stepId) : undefined;
      if (tool) {
        if (seenToolIds.has(tool.id)) continue;
        seenToolIds.add(tool.id);
        events.push({
          id: tool.id,
          name: tool.toolName || tool.name || segment.label,
          status: tool.status,
          durationLabel: formatDuration(toolDuration(tool)) || segment.durationLabel,
          target: tool.targetPaths?.[0],
          commandPreview: toolInputPreview(tool.input),
          workdir: toolWorkdir(tool.input) || tool.targetPaths?.[0],
          preview: toolInputPreview(tool.input),
          resultDisplayPreview: cleanToolResultPreview(tool.result?.outputPreview),
          resultPreview: truncateText(tool.result?.outputPreview, 260) || undefined,
          plan: tool.plan
        });
        continue;
      }
      events.push({
        id: segment.stepId || segment.id,
        name: segment.label,
        status: undefined,
        durationLabel: segment.durationLabel,
        target: undefined
      });
    }
    if (events.length) eventsByMessageId.set(row.messageId, [...(eventsByMessageId.get(row.messageId) || []), ...events]);
  }
  return messages.map((message) => {
    if (message.toolCalls.length) return message;
    const events = eventsByMessageId.get(message.id);
    return events?.length ? { ...message, toolCalls: events } : message;
  });
}

/** Strips provider transport boilerplate from tool output before display. */
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
  return truncateText(cleaned || (hasBoilerplate ? "" : text), 1200) || undefined;
}

/** Returns structured or parsed duration for a tool call result. */
function toolDuration(tool: UsageConversationToolCall | NonNullable<UsageMessage["toolCalls"]>[number]): number | undefined {
  return finiteNumber(tool.result?.durationMs) ?? parseWallTimeMs(tool.result?.outputPreview);
}

/** Parses Codex exec wall-time text into milliseconds. */
function parseWallTimeMs(value: string | undefined): number | undefined {
  const match = /\bWall time:\s*([0-9]+(?:\.[0-9]+)?)\s*seconds\b/i.exec(value || "");
  if (!match) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : undefined;
}

/** Converts a session to a conversation picker row. */
function sessionItem(session: UsageSession): UsageConversationSessionItem {
  const lastActivityAt = session.lastActivityAt || session.endedAt || session.startedAt;
  return {
    id: session.id,
    title: cleanTitle(session.title || session.firstPrompt || session.id),
    provider: session.provider || "unknown",
    providerSessionId: session.providerSessionId,
    transcriptPath: session.transcriptPath,
    model: session.models?.[0],
    status: session.status,
    startedAt: session.startedAt,
    lastActivityAt,
    lastActivityLabel: formatDateTime(lastActivityAt),
    durationLabel: formatDuration(session.metrics?.durationMs),
    tokenLabel: formatContextTokens(peakContextTokens(session.metrics?.tokens)),
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

/** Builds a project label from stable session metadata. Shared with the session list so cards and the rail agree on names. */
export function projectLabel(session: Pick<UsageSession, "project" | "repo" | "cwd">): string {
  return cleanTitle(session.project || session.repo?.id || basename(session.repo?.root || session.repo?.cwd || session.cwd) || "Unknown project", "Unknown project");
}

/** Converts a message into the conversation pane DTO. */
function conversationMessage(message: UsageMessage, turnDurationMs: number | undefined): UsageConversationMessage {
  const tokens = messageTokens(message);
  const usage = message.tokenUsage || message.metrics?.tokens;
  const contextTokens = tokenContext(usage);
  const outputTokens = finiteNumber(usage?.output);
  const duration = finiteNumber(message.providerFields?.durationMs) ?? turnDurationMs;
  const calls = message.toolCalls || [];
  const callDuration = soloCallDuration(calls, duration);
  return {
    id: message.id,
    role: conversationRole(message.role),
    title: messageTitle(message),
    at: message.createdAt || message.at,
    text: message.text,
    textPreview: message.textPreview || truncateText(message.text, 500),
    thinking: message.thinking,
    thinkingPreview: message.thinkingPreview || truncateText(message.thinking, 500),
    tokenLabel: formatMessageTokenUsage(usage, tokens),
    tokens,
    contextTokens,
    outputTokens,
    callCount: calls.length || undefined,
    turnLabel: turnSummaryLabel(duration, calls.length),
    durationLabel: formatDuration(duration),
    durationMs: duration,
    confidence: confidenceOrUnknown(message.confidence || message.tokenUsage?.confidence),
    toolCalls: calls.map((call) => ({
      id: call.id,
      name: call.toolName || call.name || "tool",
      status: call.status,
      durationLabel: formatDuration(toolDuration(call) ?? callDuration),
      target: call.targetPaths?.[0],
      commandPreview: toolInputPreview(call.input),
      workdir: toolWorkdir(call.input) || call.targetPaths?.[0],
      preview: toolInputPreview(call.input),
      resultDisplayPreview: cleanToolResultPreview(call.result?.outputPreview),
      resultPreview: truncateText(call.result?.outputPreview, 260) || undefined,
      plan: call.plan
    }))
  };
}

/**
 * Returns the wall-clock duration to attribute to a single tool call, matching
 * AgentsView: a solo (non-parallel) call inherits its assistant message's turn
 * duration, while parallel siblings get no per-call timing because the native
 * transcript records no per-call result timestamps to split the turn between them.
 */
function soloCallDuration(calls: NonNullable<UsageMessage["toolCalls"]>, turnDurationMs: number | undefined): number | undefined {
  return calls.length === 1 ? turnDurationMs : undefined;
}

/** Builds the "turn 1m 10s · N calls" badge, matching AgentsView's per-message summary. */
function turnSummaryLabel(durationMs: number | undefined, callCount: number): string | undefined {
  const duration = formatDuration(durationMs);
  if (!duration && !callCount) return undefined;
  const parts: string[] = [];
  if (duration) parts.push(`turn ${duration}`);
  if (callCount) parts.push(`${callCount} call${callCount === 1 ? "" : "s"}`);
  return parts.join(" · ");
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

type ToolTimingIndex = {
  durationsByStepId: Map<string, number>;
  pairedResultStepIds: Set<string>;
};

type ChartRowDraft = Omit<UsageConversationChartRow, "tokenModes">;

/** Builds chart rows grouped by user-request work turns. */
function chartRows(conversationMessages: UsageConversationMessage[], rawMessages: UsageMessage[], steps: UsageStep[], sessionEndedAt?: string, toolCalls: UsageConversationToolCall[] = [], inputPreviews: Map<string, string> = new Map()): ChartRowDraft[] {
  const rawById = new Map(rawMessages.map((message) => [message.id, message]));
  const stepCandidates = steps.filter((step) => step.kind !== "session" && step.kind !== "turn" && step.kind !== "user_message");
  const toolTiming = toolTimingIndex(toolCalls);
  return workTurns(conversationMessages, rawMessages, sessionEndedAt).map((turn, index) => {
    const linked = linkedWorkTurnSteps(turn, rawById, steps, stepCandidates);
    const segments = chartSegments(turn.primaryMessageId, linked, toolTiming, inputPreviews);
    const duration = workTurnDuration(turn) ?? stepDurationTotal(linked, toolTiming) ?? segmentDurationTotal(segments);
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
  return tokenContext(usage) ?? finiteNumber(usage?.total) ?? sumNumbers([tokenContext(usage), finiteNumber(usage?.output)]);
}

/** Returns the lowest-confidence message state represented inside a work turn. */
function workTurnConfidence(messages: UsageConversationMessage[]): UsageConversationChartRow["confidence"] {
  return combinedConfidence(messages.map((message) => message.confidence));
}

/**
 * Returns the context-window size for a message: the provider's explicit context
 * field when present, otherwise the sum of the input token kinds. Claude reports
 * `input_tokens` (uncached) separately from the cache-read/cache-creation tokens
 * that carry the bulk of the prompt, so the true context size is their sum
 * (matching AgentsView's `input + cache_creation + cache_read`); `input` alone
 * understates a cached prompt by orders of magnitude.
 */
function tokenContext(usage: UsageTokenUsage | undefined): number | undefined {
  if (!usage) return undefined;
  return finiteNumber(usage.context) ?? sumNumbers([finiteNumber(usage.input), finiteNumber(usage.cacheRead), finiteNumber(usage.cacheCreation)]);
}

/** Formats chart token counts with compact lower-case units. */
function formatMessageTokenCount(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (Math.abs(value) < 1_000) return Intl.NumberFormat("en").format(Math.round(value));
  if (Math.abs(value) < 1_000_000) return `${trimFixed(value / 1_000, 1)}k`;
  return `${trimFixed(value / 1_000_000, 1)}M`;
}

/** Trims insignificant decimal zeros from fixed-point values. */
function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
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

/** Indexes tool-call durations onto command steps and marks paired result steps. */
function toolTimingIndex(toolCalls: UsageConversationToolCall[]): ToolTimingIndex {
  const durationsByStepId = new Map<string, number>();
  const pairedResultStepIds = new Set<string>();
  for (const tool of toolCalls) {
    const duration = toolDuration(tool);
    if (duration !== undefined) {
      if (tool.stepId) durationsByStepId.set(tool.stepId, duration);
      else if (tool.resultStepId) durationsByStepId.set(tool.resultStepId, duration);
    }
    if (tool.stepId && tool.resultStepId) pairedResultStepIds.add(tool.resultStepId);
  }
  return { durationsByStepId, pairedResultStepIds };
}

/** Resolves a step duration using timeline data first, then paired tool-call timing. */
function timedStepDuration(step: UsageStep, toolTiming: ToolTimingIndex): number | undefined {
  return stepDuration(step) ?? toolTiming.durationsByStepId.get(step.id);
}

/** Narrows undefined values out of arrays. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** Converts linked steps to proportional row segments. */
function chartSegments(messageId: string, steps: UsageStep[], toolTiming: ToolTimingIndex, inputPreviews: Map<string, string>): UsageConversationChartSegment[] {
  const visible = steps.filter((step) => step.kind !== "turn" && step.kind !== "session" && !toolTiming.pairedResultStepIds.has(step.id));
  const durations = visible.map((step) => timedStepDuration(step, toolTiming));
  const durationTotal = durations.reduce<number>((sum, value) => sum + (value || 0), 0);
  return visible.map((step, index) => {
    const duration = timedStepDuration(step, toolTiming);
    return {
      id: `${messageId}:${step.id}`,
      label: cleanTitle(step.label || step.toolName || stepKindLabel(step.kind), `Step ${index + 1}`),
      kind: segmentKind(step),
      messageId,
      stepId: step.id,
      detail: inputPreviews.get(step.id),
      durationMs: duration,
      durationLabel: formatDuration(duration),
      heightShare: durationTotal > 0 && duration !== undefined ? duration / durationTotal : 1 / Math.max(1, visible.length),
      confidence: confidenceOrUnknown(step.durationConfidence || step.confidence)
    };
  });
}

/** Builds chart caveats without hiding source warnings. */
function conversationCaveats(rows: ChartRowDraft[], existing: string[]): string[] {
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

/**
 * Derives an assistant message's turn duration from transcript timestamps, the way
 * AgentsView does: the wall-clock gap from this message to the next record (or the
 * session end for the final message). Native Claude transcripts carry no per-message
 * or per-tool-call duration, so this delta is the only available timing signal. It is
 * computed only for assistant messages that issued a tool call; a text-only reply's
 * "next record" is usually the user's next prompt, whose gap is idle time, not work.
 */
function messageTurnDuration(messages: UsageMessage[], index: number, sessionEndedAt: string | undefined): number | undefined {
  const message = messages[index];
  if (!message || conversationRole(message.role) !== "assistant" || !(message.toolCalls?.length)) return undefined;
  const start = parseTimeMs(message.createdAt || message.at);
  if (start === undefined) return undefined;
  const next = messages[index + 1];
  const end = parseTimeMs(next ? next.createdAt || next.at : sessionEndedAt);
  if (end === undefined || end < start) return undefined;
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
function stepDurationTotal(values: UsageStep[], toolTiming: ToolTimingIndex): number | undefined {
  const total = values.reduce((sum, value) => sum + (toolTiming.pairedResultStepIds.has(value.id) ? 0 : timedStepDuration(value, toolTiming) || 0), 0);
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
