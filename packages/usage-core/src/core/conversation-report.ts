import type { UsageJsonlLineV1 } from "./schema/usage-jsonl-v1.js";
import type { NormalizedConversation, NormalizedConversationMessage, NormalizedToolCall, TokenUsage } from "./conversation-report-types.js";

export type {
  NormalizedConversation,
  NormalizedConversationMessage,
  NormalizedToolCall,
  TokenUsage
} from "./conversation-report-types.js";

type AnnotatedEvent = UsageJsonlLineV1 & {
  effectiveTurnId?: string;
  effectiveTurnIndex?: number;
};

type DatasetLike = {
  annotatedEvents: AnnotatedEvent[];
  warnings?: { message: string }[];
};

type ToolResultEvent = {
  event: AnnotatedEvent;
  status: "success" | "error" | "unknown";
  outputPreview?: string;
  durationMs?: number;
};

/** Builds a normalized conversation report from annotated usage events for a given conversation ID. */
export function conversationReport(
  dataset: DatasetLike,
  args: { conversationId: string; turnId?: string }
): NormalizedConversation {
  const events = dataset.annotatedEvents
    .filter((event) => event.conversation.id === args.conversationId)
    .filter((event) => !args.turnId || event.effectiveTurnId === args.turnId);
  if (!events.length) throw new Error(`No usage events found for conversation ${args.conversationId}.`);

  const first = events[0]!;
  const caveats = unique([
    ...events.flatMap((event) => event.availability?.notes || []),
    ...(dataset.warnings || []).map((warning) => warning.message)
  ]);
  const messages: NormalizedConversationMessage[] = [];
  const assistantById = new Map<string, Extract<NormalizedConversationMessage, { role: "assistant" }>>();
  const lastAssistantByTurn = new Map<string, string>();
  const toolCallsByAssistant = new Map<string, AnnotatedEvent[]>();
  const tokenEventsByAssistant = new Map<string, AnnotatedEvent[]>();
  const resultsByToolCall = collectToolResults(events);

  for (const event of events) {
    if (event.kind === "message.user") {
      messages.push({
        id: event.links?.message_id || event.event_id,
        role: "user",
        at: eventTime(event),
        text: eventText(event),
        confidence: messageConfidence(event)
      });
      continue;
    }

    if (event.kind === "message.assistant.visible") {
      const message: Extract<NormalizedConversationMessage, { role: "assistant" }> = {
        id: event.links?.message_id || event.event_id,
        role: "assistant",
        at: eventTime(event),
        model: event.actor?.model || stringValue(field(event.data, "model")),
        text: eventText(event),
        thinking: stringValue(field(event.data, "thinking")),
        toolCalls: [],
        confidence: messageConfidence(event)
      };
      messages.push(message);
      assistantById.set(message.id, message);
      lastAssistantByTurn.set(turnKey(event), message.id);
      continue;
    }

    if (event.kind === "tool.call") {
      const messageId = assistantMessageIdFor(event, lastAssistantByTurn, caveats, "tool call");
      if (!messageId) {
        caveats.push(`Tool call ${event.links?.tool_call_id || event.event_id} could not be attached to an assistant message.`);
        continue;
      }
      pushMap(toolCallsByAssistant, messageId, event);
      continue;
    }

    if (event.kind === "token.usage") {
      const messageId = assistantMessageIdFor(event, lastAssistantByTurn, caveats, "token usage");
      if (!messageId) {
        caveats.push(`Token usage event ${event.event_id} could not be attached to an assistant message.`);
        continue;
      }
      pushMap(tokenEventsByAssistant, messageId, event);
    }
  }

  for (const [messageId, tokenEvents] of tokenEventsByAssistant) {
    const message = assistantById.get(messageId);
    if (!message) continue;
    message.tokens = mergeTokenUsage(tokenEvents.map(normalizeTokenUsage).filter(isTokenUsage));
  }

  for (const [messageId, callEvents] of toolCallsByAssistant) {
    const message = assistantById.get(messageId);
    if (!message) continue;
    message.toolCalls = callEvents.map((call) => normalizedToolCall(call, resultsByToolCall.get(toolCallId(call))));
  }

  const tokenTotals = mergeTokenUsage(messages
    .filter((message): message is Extract<NormalizedConversationMessage, { role: "assistant" }> => message.role === "assistant")
    .map((message) => message.tokens)
    .filter(isTokenUsage), "assistant_message.tokens");

  return {
    schema: "usage.conversation.v1",
    provider: first.provider,
    conversationId: args.conversationId,
    providerSessionId: first.conversation.provider_session_id,
    transcriptPath: first.conversation.transcript_path || undefined,
    repo: {
      root: first.repo.root,
      cwd: first.repo.cwd,
      branch: first.repo.git?.branch
    },
    startedAt: events.find((event) => event.kind === "conversation.start")?.conversation.started_at || eventTime(events[0]!),
    endedAt: [...events].reverse().find((event) => event.kind === "conversation.end")?.conversation.ended_at || eventTime(events.at(-1)!),
    messages,
    totals: {
      userMessages: messages.filter((message) => message.role === "user").length,
      assistantMessages: messages.filter((message) => message.role === "assistant").length,
      toolCalls: messages
        .filter((message): message is Extract<NormalizedConversationMessage, { role: "assistant" }> => message.role === "assistant")
        .reduce((count, message) => count + message.toolCalls.length, 0),
      tokens: tokenTotals
    },
    caveats: unique(caveats)
  };
}

/** Indexes tool.result and tool.error events by their tool call ID. */
function collectToolResults(events: AnnotatedEvent[]): Map<string, ToolResultEvent> {
  const results = new Map<string, ToolResultEvent>();
  for (const event of events) {
    if (event.kind !== "tool.result" && event.kind !== "tool.error") continue;
    const id = event.links?.tool_call_id;
    if (!id) continue;
    results.set(id, {
      event,
      status: event.kind === "tool.error" ? "error" : statusValue(field(event.data, "status")),
      outputPreview: previewUnknown(
        field(event.data, "output") ??
          field(event.data, "tool_response") ??
          field(event.data, "response") ??
          field(event.data, "error") ??
          field(event.data, "message"),
        1000
      ),
      durationMs: numberValue(field(event.data, "duration_ms")) ?? numberValue(field(event.data, "durationMs"))
    });
  }
  return results;
}

/** Converts a tool.call event and its optional result into a NormalizedToolCall. */
function normalizedToolCall(call: AnnotatedEvent, result: ToolResultEvent | undefined): NormalizedToolCall {
  const id = toolCallId(call);
  return {
    id,
    name: stringValue(field(call.data, "tool_name")) || stringValue(field(call.data, "name")) || "unknown",
    category: stringValue(field(call.data, "category")) || "other",
    input: field(call.data, "input") ?? field(call.data, "tool_input") ?? field(call.data, "arguments"),
    plan: stringValue(field(call.data, "plan")),
    result: result ? {
      status: result.status,
      outputPreview: result.outputPreview,
      durationMs: result.durationMs
    } : undefined,
    targetPaths: stringArray(
      field(call.data, "target_paths") ??
        field(call.data, "targetPaths") ??
        field(call.data, "target_path") ??
        field(call.data, "path") ??
        field(call.data, "file")
    ),
    evidenceEventIds: unique([call.event_id, result?.event.event_id].filter((id): id is string => Boolean(id)))
  };
}

/** Returns the tool call ID from an event, falling back to the event ID. */
function toolCallId(event: AnnotatedEvent): string {
  return event.links?.tool_call_id || event.event_id;
}

/** Resolves which assistant message a tool call or token event belongs to, using links or turn fallback. */
function assistantMessageIdFor(
  event: AnnotatedEvent,
  lastAssistantByTurn: Map<string, string>,
  caveats: string[],
  label: string
): string | undefined {
  if (event.links?.message_id) return event.links.message_id;
  const fallback = lastAssistantByTurn.get(turnKey(event));
  if (fallback) {
    caveats.push(`${label} event ${event.event_id} had no links.message_id; attached to nearest previous assistant message in the same turn.`);
  }
  return fallback;
}

/** Extracts and normalizes token usage fields from a token.usage event's data payload. */
function normalizeTokenUsage(event: AnnotatedEvent): TokenUsage | undefined {
  const data = objectValue(event.data);
  const usage = objectValue(data.usage) || objectValue(data.totals) || data;
  const input = numberValue(usage.input_tokens) ?? numberValue(usage.inputTokens) ?? numberValue(usage.input);
  const output = numberValue(usage.output_tokens) ?? numberValue(usage.outputTokens) ?? numberValue(usage.output);
  const cacheRead =
    numberValue(usage.cache_read_input_tokens) ??
    numberValue(usage.cacheReadInputTokens) ??
    numberValue(usage.cacheRead) ??
    numberValue(usage.cached_input_tokens) ??
    numberValue(usage.cachedInputTokens);
  const cacheCreation =
    numberValue(usage.cache_creation_input_tokens) ??
    numberValue(usage.cacheCreationInputTokens) ??
    numberValue(usage.cacheCreation);
  const total = numberValue(usage.total_tokens) ?? numberValue(usage.totalTokens) ?? numberValue(usage.total) ?? sumDefined([input, output, cacheRead, cacheCreation]);
  if ([input, output, cacheRead, cacheCreation, total].every((value) => value === undefined)) return undefined;
  return {
    input,
    output,
    cacheRead,
    cacheCreation,
    total,
    source: stringValue(data.source) || tokenSource(event),
    confidence: tokenConfidence(stringValue(data.usageConfidence) || stringValue(data.confidence))
  };
}

/** Merges multiple TokenUsage records into one by summing their fields. */
function mergeTokenUsage(values: TokenUsage[], source = "assistant_message.tokens"): TokenUsage | undefined {
  if (!values.length) return undefined;
  if (values.length === 1) return values[0];
  return {
    input: sumToken(values, "input"),
    output: sumToken(values, "output"),
    cacheRead: sumToken(values, "cacheRead"),
    cacheCreation: sumToken(values, "cacheCreation"),
    total: sumToken(values, "total"),
    source,
    confidence: values.every((value) => value.confidence === "provider-reported") ? "derived" : "unknown"
  };
}

/** Returns a descriptive source label for a token usage event based on provider and capture method. */
function tokenSource(event: AnnotatedEvent): string {
  if (event.provider === "claude" && event.capture.source === "native-import") return "claude-native.message.usage";
  if (event.provider === "codex" && event.capture.source === "native-import") return "codex-native.token_count";
  if (event.provider === "gemini" && event.capture.source === "native-import") return "gemini-native.message.tokens";
  if (event.capture.source === "hook") return "hook.token.usage";
  return event.capture.source;
}

/** Coerces a raw confidence string to a typed TokenUsage confidence value, defaulting to "unknown". */
function tokenConfidence(value: string | undefined): TokenUsage["confidence"] {
  if (value === "provider-reported" || value === "derived" || value === "estimated") return value;
  return "unknown";
}

/** Derives a message confidence level from event availability metadata. */
function messageConfidence(event: AnnotatedEvent): NormalizedConversationMessage["confidence"] {
  const confidence = event.availability?.confidence || event.capture.confidence;
  if (confidence === "exact") return "exact";
  if (confidence === "partial" || confidence === "derived") return "partial";
  return "best-effort";
}

/** Returns the text content of an event, checking multiple possible field names. */
function eventText(event: AnnotatedEvent): string {
  return stringValue(field(event.data, "text")) || stringValue(field(event.data, "delta")) || stringValue(field(event.data, "text_preview")) || "";
}

/** Returns the best timestamp for an event, preferring observed_at over recorded_at. */
function eventTime(event: AnnotatedEvent): string | undefined {
  return event.observed_at || event.recorded_at;
}

/** Returns a compound key uniquely identifying a turn within a conversation. */
function turnKey(event: AnnotatedEvent): string {
  return `${event.conversation.id}:${event.effectiveTurnId || event.turn?.id || "turn-unknown"}`;
}

/** Coerces an unknown value to a typed tool result status string, defaulting to "unknown". */
function statusValue(value: unknown): "success" | "error" | "unknown" {
  return value === "success" || value === "error" || value === "unknown" ? value : "unknown";
}

/** Returns a named key from an object value, or undefined if the value is not an object. */
function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** Returns the value cast to a plain-object record, or an empty object if it is not one. */
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Returns the value as a non-empty string, or undefined. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Returns the value as a finite number, or undefined. */
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Collects string elements from an array or single value, dropping non-strings. */
function stringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Serializes an unknown value to a compact single-line preview, truncated to max characters. */
function previewUnknown(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

/** Sums all defined numbers in the array, returning undefined if all are absent. */
function sumDefined(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length ? present.reduce((sum, value) => sum + value, 0) : undefined;
}

/** Sums one numeric token field across an array of TokenUsage records. */
function sumToken(values: TokenUsage[], key: keyof Pick<TokenUsage, "input" | "output" | "cacheRead" | "cacheCreation" | "total">): number | undefined {
  return sumDefined(values.map((value) => value[key]));
}

/** Type guard returning true when the value is a defined TokenUsage object. */
function isTokenUsage(value: TokenUsage | undefined): value is TokenUsage {
  return Boolean(value);
}

/** Appends a value to the array stored at key in the map, creating the array if absent. */
function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const rows = map.get(key) || [];
  rows.push(value);
  map.set(key, rows);
}

/** Returns a new array with duplicate and falsy values removed. */
function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}
