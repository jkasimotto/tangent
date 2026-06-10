import type { UsageJsonlLineV1 } from "./schema/usage-jsonl-v1.js";
import type { NormalizedConversation, NormalizedConversationMessage, NormalizedToolCall, TokenUsage } from "./conversation-report-types.js";
import { toolTokenAttributions } from "./tool-token-attribution.js";

export type {
  NormalizedConversation,
  NormalizedConversationMessage,
  NormalizedToolCall,
  TokenUsage,
  ToolTokenAttribution
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
  const tokenAttributionByToolCall = new Map(toolTokenAttributions(events).map((row) => [row.toolCallId, row]));

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
    message.toolCalls = callEvents.map((call) => normalizedToolCall(call, resultsByToolCall.get(toolCallId(call)), messageId));
    allocateToolOutputTokens(message.tokens?.output, message.toolCalls);
    for (const toolCall of message.toolCalls) {
      const attribution = tokenAttributionByToolCall.get(toolCall.id);
      if (!attribution) continue;
      toolCall.tokens = {
        ...toolCall.tokens,
        allocatedInput: attribution.allocatedInputTokens,
        nextInputDelta: attribution.nextInputDelta,
        nextInputTotal: attribution.nextModelCall?.inputTokens,
        nextInputCached: attribution.nextModelCall?.cachedInputTokens,
        nextModelCallEventId: attribution.nextModelCall?.eventId,
        resultEstimatedTokens: attribution.result?.estimatedOutputTokens,
        resultOutputChars: attribution.result?.outputChars,
        resultOutputBytes: attribution.result?.outputBytes,
        originalTokenCount: attribution.result?.originalTokenCount,
        truncated: attribution.result?.truncated,
        allocationMethod: attribution.allocationMethod === "none" ? toolCall.tokens.allocationMethod : attribution.allocationMethod,
        source: attribution.nextModelCall ? "tool_result.next_model_call.input" : toolCall.tokens.source,
        confidence: attribution.confidence === "unknown" ? toolCall.tokens.confidence : attribution.confidence,
        notes: unique([...toolCall.tokens.notes, ...attribution.notes])
      };
      toolCall.evidenceEventIds = unique([...toolCall.evidenceEventIds, ...attribution.evidenceEventIds]);
    }
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

export function allocateToolOutputTokens(
  assistantOutputTokens: number | undefined,
  toolCalls: NormalizedToolCall[]
): Map<string, number | undefined> {
  const allocations = new Map<string, number | undefined>();
  if (!assistantOutputTokens || toolCalls.length === 0) return allocations;

  const weights = toolCalls.map((tool) =>
    Math.max(1, Buffer.byteLength(JSON.stringify({ name: tool.name, input: tool.input })))
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  for (const [index, tool] of toolCalls.entries()) {
    const allocated = Math.round(assistantOutputTokens * weights[index]! / totalWeight);
    tool.tokens = {
      exact: false,
      allocatedOutput: allocated,
      allocationMethod: "proportional_serialized_tool_use_bytes",
      sourceAssistantMessageId: tool.tokens.sourceAssistantMessageId,
      source: "assistant_message.tokens.output",
      confidence: "allocated",
      notes: [
        "Provider token usage is reported at assistant-message level; this per-tool-call value is allocated, not exact."
      ]
    };
    allocations.set(tool.id, allocated);
  }

  return allocations;
}

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

function normalizedToolCall(call: AnnotatedEvent, result: ToolResultEvent | undefined, sourceAssistantMessageId: string): NormalizedToolCall {
  const id = toolCallId(call);
  return {
    id,
    name: stringValue(field(call.data, "tool_name")) || stringValue(field(call.data, "name")) || "unknown",
    category: stringValue(field(call.data, "category")) || "other",
    input: field(call.data, "input") ?? field(call.data, "tool_input") ?? field(call.data, "arguments"),
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
    tokens: {
      exact: false,
      allocationMethod: "none",
      sourceAssistantMessageId,
      source: "assistant_message.tokens.output",
      confidence: "unknown",
      notes: [
        "No provider-reported per-tool-call token usage was available."
      ]
    },
    evidenceEventIds: unique([call.event_id, result?.event.event_id].filter((id): id is string => Boolean(id)))
  };
}

function toolCallId(event: AnnotatedEvent): string {
  return event.links?.tool_call_id || event.event_id;
}

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

function tokenSource(event: AnnotatedEvent): string {
  if (event.provider === "claude" && event.capture.source === "native-import") return "claude-native.message.usage";
  if (event.provider === "codex" && event.capture.source === "native-import") return "codex-native.token_count";
  if (event.capture.source === "hook") return "hook.token.usage";
  return event.capture.source;
}

function tokenConfidence(value: string | undefined): TokenUsage["confidence"] {
  if (value === "provider-reported" || value === "derived" || value === "allocated" || value === "estimated") return value;
  return "unknown";
}

function messageConfidence(event: AnnotatedEvent): NormalizedConversationMessage["confidence"] {
  const confidence = event.availability?.confidence || event.capture.confidence;
  if (confidence === "exact") return "exact";
  if (confidence === "partial" || confidence === "derived") return "partial";
  return "best-effort";
}

function eventText(event: AnnotatedEvent): string {
  return stringValue(field(event.data, "text")) || stringValue(field(event.data, "delta")) || stringValue(field(event.data, "text_preview")) || "";
}

function eventTime(event: AnnotatedEvent): string | undefined {
  return event.observed_at || event.recorded_at;
}

function turnKey(event: AnnotatedEvent): string {
  return `${event.conversation.id}:${event.effectiveTurnId || event.turn?.id || "turn-unknown"}`;
}

function statusValue(value: unknown): "success" | "error" | "unknown" {
  return value === "success" || value === "error" || value === "unknown" ? value : "unknown";
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function previewUnknown(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length ? present.reduce((sum, value) => sum + value, 0) : undefined;
}

function sumToken(values: TokenUsage[], key: keyof Pick<TokenUsage, "input" | "output" | "cacheRead" | "cacheCreation" | "total">): number | undefined {
  return sumDefined(values.map((value) => value[key]));
}

function isTokenUsage(value: TokenUsage | undefined): value is TokenUsage {
  return Boolean(value);
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const rows = map.get(key) || [];
  rows.push(value);
  map.set(key, rows);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}
