import type { UsageJsonlLineV1, UsageProvider } from "./schema/usage-jsonl-v1.js";

export type TokenUsageSnapshot = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreation?: number;
  total?: number;
};

export type ToolTokenAttributionRow = {
  schema: "usage.tool-tokens.v1";
  provider: UsageProvider;
  conversationId: string;
  turnId?: string;
  toolCallId: string;
  toolName: string;
  category: string;
  targetPaths: string[];
  model?: string;
  result?: {
    status: "success" | "error" | "unknown";
    outputPreview?: string;
    outputChars?: number;
    outputBytes?: number;
    estimatedOutputTokens?: number;
    originalTokenCount?: number;
    truncated?: boolean;
    outputTokenSource?: string;
  };
  assistantOutputTokens?: number;
  nextModelCall?: {
    eventId: string;
    snapshotIndex?: number;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningOutputTokens?: number;
    totalTokens?: number;
  };
  previousModelInputTokens?: number;
  nextInputDelta?: number;
  allocatedInputTokens?: number;
  allocationMethod: "single_tool_result" | "proportional_tool_result_tokens" | "none";
  confidence: "estimated" | "allocated" | "unknown";
  notes: string[];
  evidenceEventIds: string[];
};

export type AttributionEvent = UsageJsonlLineV1 & {
  effectiveTurnId?: string;
  effectiveTurnIndex?: number;
};

type MutableToolTokenAttributionRow = ToolTokenAttributionRow & {
  readyForNextModelCall?: boolean;
};

export function toolTokenAttributions(events: AttributionEvent[]): ToolTokenAttributionRow[] {
  const rows = new Map<string, MutableToolTokenAttributionRow>();
  const pendingResults: MutableToolTokenAttributionRow[] = [];
  let previousUsage: { event: AttributionEvent; usage: TokenUsageSnapshot } | undefined;

  for (const event of events) {
    if (event.kind === "tool.call") {
      const row = toolRowFromCall(event);
      rows.set(row.toolCallId, row);
      continue;
    }

    if (event.kind === "tool.result" || event.kind === "tool.error") {
      const row = ensureToolRow(rows, event);
      row.result = resultInfo(event);
      row.evidenceEventIds = unique([...row.evidenceEventIds, event.event_id]);
      row.confidence = row.result.estimatedOutputTokens !== undefined ? "estimated" : row.confidence;
      pendingResults.push(row);
      continue;
    }

    if (isModelActivity(event)) {
      for (const pending of pendingResults) pending.readyForNextModelCall = true;
      continue;
    }

    if (event.kind === "token.usage") {
      const usage = usageSnapshot(event);
      const ready = pendingResults.filter((row) => row.readyForNextModelCall);
      if (ready.length) {
        assignNextModelCall(ready, event, usage, previousUsage?.usage);
        for (const row of ready) {
          const index = pendingResults.indexOf(row);
          if (index >= 0) pendingResults.splice(index, 1);
        }
      }
      previousUsage = { event, usage };
    }
  }

  return [...rows.values()]
    .map(({ readyForNextModelCall: _readyForNextModelCall, ...row }) => row)
    .sort((a, b) =>
      (b.allocatedInputTokens || 0) - (a.allocatedInputTokens || 0) ||
      (b.result?.estimatedOutputTokens || 0) - (a.result?.estimatedOutputTokens || 0) ||
      a.toolCallId.localeCompare(b.toolCallId)
    );
}

function toolRowFromCall(event: AttributionEvent): MutableToolTokenAttributionRow {
  const id = toolCallId(event);
  return {
    schema: "usage.tool-tokens.v1",
    provider: event.provider,
    conversationId: event.conversation.id,
    turnId: event.effectiveTurnId || event.turn?.id,
    toolCallId: id,
    toolName: stringValue(field(event.data, "tool_name")) || stringValue(field(event.data, "name")) || "unknown",
    category: stringValue(field(event.data, "category")) || "other",
    targetPaths: stringArray(field(event.data, "target_paths")),
    model: event.actor?.model,
    allocationMethod: "none",
    confidence: "unknown",
    notes: ["No following model-call token usage was available for this tool call."],
    evidenceEventIds: [event.event_id]
  };
}

function ensureToolRow(rows: Map<string, MutableToolTokenAttributionRow>, event: AttributionEvent): MutableToolTokenAttributionRow {
  const id = toolCallId(event);
  const existing = rows.get(id);
  if (existing) return existing;
  const row: MutableToolTokenAttributionRow = {
    schema: "usage.tool-tokens.v1",
    provider: event.provider,
    conversationId: event.conversation.id,
    turnId: event.effectiveTurnId || event.turn?.id,
    toolCallId: id,
    toolName: stringValue(field(event.data, "tool_name")) || "unknown",
    category: stringValue(field(event.data, "category")) || "other",
    targetPaths: stringArray(field(event.data, "target_paths")),
    model: event.actor?.model,
    allocationMethod: "none",
    confidence: "unknown",
    notes: ["Tool result had no matching normalized tool.call event."],
    evidenceEventIds: [event.event_id]
  };
  rows.set(id, row);
  return row;
}

function resultInfo(event: AttributionEvent): NonNullable<ToolTokenAttributionRow["result"]> {
  const output = field(event.data, "output") ?? field(event.data, "tool_response") ?? field(event.data, "response") ?? field(event.data, "error") ?? field(event.data, "message");
  return {
    status: event.kind === "tool.error" ? "error" : statusValue(field(event.data, "status")),
    outputPreview: previewUnknown(output, 1000),
    outputChars: numberValue(field(event.data, "output_chars")),
    outputBytes: numberValue(field(event.data, "output_bytes")),
    estimatedOutputTokens: numberValue(field(event.data, "estimated_output_tokens")) ?? estimateOutputTokens(output),
    originalTokenCount: numberValue(field(event.data, "original_token_count")),
    truncated: booleanValue(field(event.data, "truncated")),
    outputTokenSource: stringValue(field(event.data, "output_token_source"))
  };
}

function assignNextModelCall(
  rows: MutableToolTokenAttributionRow[],
  usageEvent: AttributionEvent,
  usage: TokenUsageSnapshot,
  previousUsage: TokenUsageSnapshot | undefined
): void {
  const delta = usage.input !== undefined && previousUsage?.input !== undefined ? Math.max(0, usage.input - previousUsage.input) : undefined;
  const weights = rows.map((row) => resultWeight(row));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  for (const [index, row] of rows.entries()) {
    const allocatedInput = delta === undefined
      ? undefined
      : rows.length === 1
        ? delta
        : Math.round(delta * weights[index]! / totalWeight);
    row.previousModelInputTokens = previousUsage?.input;
    row.nextInputDelta = delta;
    row.allocatedInputTokens = allocatedInput;
    row.nextModelCall = {
      eventId: usageEvent.event_id,
      snapshotIndex: numberValue(field(usageEvent.data, "snapshotIndex")),
      inputTokens: usage.input,
      cachedInputTokens: usage.cacheRead,
      outputTokens: usage.output,
      reasoningOutputTokens: numberValue(field(objectValue(field(usageEvent.data, "usage")), "reasoning_output_tokens")),
      totalTokens: usage.total
    };
    row.allocationMethod = rows.length === 1 ? "single_tool_result" : "proportional_tool_result_tokens";
    row.confidence = rows.length === 1 ? "estimated" : "allocated";
    row.notes = [
      delta === undefined
        ? "Provider reported the following model-call usage, but no previous input snapshot was available to derive a delta."
        : "Allocated from the input-token delta on the next model call after this tool result; this is diagnostic, not exact billing."
    ];
    row.evidenceEventIds = unique([...row.evidenceEventIds, usageEvent.event_id]);
  }
}

function isModelActivity(event: AttributionEvent): boolean {
  return event.kind === "message.assistant.visible" ||
    event.kind === "message.assistant.internal" ||
    event.kind === "tool.call";
}

function usageSnapshot(event: AttributionEvent): TokenUsageSnapshot {
  const data = objectValue(event.data);
  const usage = objectValue(data.usage) || objectValue(data.totals) || data;
  return {
    input: numberValue(usage.input_tokens) ?? numberValue(usage.inputTokens) ?? numberValue(usage.input),
    output: numberValue(usage.output_tokens) ?? numberValue(usage.outputTokens) ?? numberValue(usage.output),
    cacheRead:
      numberValue(usage.cache_read_input_tokens) ??
      numberValue(usage.cacheReadInputTokens) ??
      numberValue(usage.cacheRead) ??
      numberValue(usage.cached_input_tokens) ??
      numberValue(usage.cachedInputTokens),
    cacheCreation:
      numberValue(usage.cache_creation_input_tokens) ??
      numberValue(usage.cacheCreationInputTokens) ??
      numberValue(usage.cacheCreation),
    total: numberValue(usage.total_tokens) ?? numberValue(usage.totalTokens) ?? numberValue(usage.total)
  };
}

function resultWeight(row: ToolTokenAttributionRow): number {
  return Math.max(1, row.result?.estimatedOutputTokens || row.result?.outputBytes || 1);
}

function toolCallId(event: AttributionEvent): string {
  return event.links?.tool_call_id || event.event_id;
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

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function statusValue(value: unknown): "success" | "error" | "unknown" {
  return value === "success" || value === "error" || value === "unknown" ? value : "unknown";
}

function previewUnknown(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function estimateOutputTokens(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const compact = text.replace(/\s+/g, " ").trim();
  return compact ? Math.max(1, Math.ceil(compact.length / 4)) : 0;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}
