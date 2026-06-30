import { createHash } from "node:crypto";

import type { UsageJsonlLineV1 } from "./schema/usage-jsonl-v1.js";
import {
  usageAvailability,
  type UsageContentMode,
  type UsageCost,
  type UsageEventV3,
  type UsageNativeRef,
  type UsageTokenUsage
} from "../schema/index.js";

/** Converts a legacy UsageJsonlLineV1 event to the canonical UsageEventV3 format. */
export function toUsageEventV3(event: UsageEventV3 | UsageJsonlLineV1, index = 0, contentMode: UsageContentMode = "metadata-with-excerpts"): UsageEventV3 {
  if ((event as UsageEventV3).schema === "tangent.usage.event.v3") return event as UsageEventV3;
  const legacy = event as UsageJsonlLineV1;
  const data = objectValue(legacy.data) || {};
  const native = legacy.native;
  const usage = normalizeTokenUsage(field(data, "usage") || (legacy.kind === "token.usage" ? field(data, "totals") || data : undefined), data, legacy);
  const tool = legacy.kind.startsWith("tool.") ? {
    id: legacy.links?.tool_call_id,
    name: stringValue(field(data, "tool_name")) || stringValue(field(data, "name")),
    category: stringValue(field(data, "category")),
    input: field(data, "input") ?? field(data, "tool_input") ?? field(data, "arguments"),
    output: field(data, "output") ?? field(data, "tool_response") ?? field(data, "response"),
    status: stringValue(field(data, "status")),
    targetPaths: pathsForData(data),
    durationMs: numberValue(field(data, "duration_ms")) ?? numberValue(field(data, "durationMs")),
    plan: stringValue(field(data, "plan"))
  } : undefined;
  const role = roleForLegacyEvent(legacy);
  const observedAt = legacy.observed_at || legacy.recorded_at;
  const nativeRef: UsageNativeRef | undefined = native ? {
    sourcePath: native.source_path,
    line: native.line,
    jsonPointer: native.json_pointer,
    rawHash: native.raw_hash,
    providerType: native.type || native.hook_event_name
  } : undefined;
  return {
    schema: "tangent.usage.event.v3",
    id: legacy.event_id || stableId(`${legacy.provider}:${legacy.kind}:${index}`),
    kind: legacyKindToV3(legacy.kind),
    provider: legacy.provider,
    source: {
      id: native?.source_path || legacy.conversation.transcript_path || legacy.event_id || stableId(JSON.stringify(legacy)),
      kind: legacy.capture.source === "hook" ? "hook" : legacy.capture.source === "native-import" ? "native" : "import",
      path: native?.source_path || legacy.conversation.transcript_path || undefined,
      line: native?.line,
      jsonPointer: native?.json_pointer,
      providerVersion: legacy.capture.provider_version,
      rawHash: native?.raw_hash
    },
    recordedAt: legacy.recorded_at,
    observedAt,
    sequence: legacy.sequence,
    scope: {
      sessionId: legacy.conversation.id,
      providerSessionId: legacy.conversation.provider_session_id,
      turnId: legacy.turn?.id,
      messageId: legacy.links?.message_id,
      toolCallId: legacy.links?.tool_call_id,
      subagentId: legacy.links?.subagent_id
    },
    actor: legacy.actor ? {
      role: legacy.actor.role,
      model: legacy.actor.model,
      agentId: legacy.actor.agent_id,
      agentType: legacy.actor.agent_type,
      parentAgentId: legacy.actor.parent_agent_id
    } : undefined,
    time: {
      startedAt: observedAt,
      endedAt: legacy.kind === "turn.end" || legacy.kind === "conversation.end" ? observedAt : undefined,
      durationMs: numberValue(field(data, "duration_ms")) ?? numberValue(field(data, "durationMs")),
      confidence: legacyConfidence(legacy.availability?.confidence || legacy.capture.confidence)
    },
    data: {
      ...data,
      role,
      text: contentMode === "metadata-only" ? undefined : stringValue(field(data, "text")) || stringValue(field(data, "delta")),
      textPreview: stringValue(field(data, "text_preview")) || preview(stringValue(field(data, "text")) || stringValue(field(data, "delta"))),
      thinking: contentMode === "metadata-only" ? undefined : stringValue(field(data, "thinking")),
      thinkingPreview: stringValue(field(data, "thinking_preview")) || preview(stringValue(field(data, "thinking"))),
      model: legacy.actor?.model || stringValue(field(data, "model")),
      tool,
      usage,
      cost: normalizeCost(field(data, "cost")),
      file: fileFacet(legacy, data),
      compaction: legacy.kind.startsWith("compact.") ? {
        summary: stringValue(field(data, "summary")),
        trigger: stringValue(field(data, "trigger"))
      } : undefined,
      error: legacy.kind === "error" || legacy.kind === "tool.error" ? {
        message: stringValue(field(data, "message")) || stringValue(field(data, "error")),
        code: stringValue(field(data, "code"))
      } : undefined
    },
    links: {
      parentEventIds: legacy.links?.parent_message_id ? [legacy.links.parent_message_id] : undefined,
      relatedEventIds: legacy.links?.related_event_ids
    },
    availability: usageAvailability({
      confidence: legacyConfidence(legacy.availability?.confidence || legacy.capture.confidence),
      missing: legacy.availability?.missing || [],
      notes: legacy.availability?.notes || [],
      providerCoverage: {}
    }),
    providerFields: {
      legacyKind: legacy.kind,
      capture: legacy.capture,
      repo: legacy.repo,
      conversation: legacy.conversation,
      turn: legacy.turn,
      native: nativeRef
    },
    nativeRaw: contentMode === "full" ? native?.raw : undefined
  };
}

/** Extracts and normalizes token usage fields from a raw event data value. */
function normalizeTokenUsage(value: unknown, data: Record<string, unknown>, event: UsageJsonlLineV1): UsageTokenUsage | undefined {
  const usage = objectValue(value);
  if (!usage) return undefined;
  const input = numberValue(field(usage, "input")) ?? numberValue(field(usage, "input_tokens")) ?? numberValue(field(usage, "inputTokens"));
  const output = numberValue(field(usage, "output")) ?? numberValue(field(usage, "output_tokens")) ?? numberValue(field(usage, "outputTokens"));
  const cacheRead = numberValue(field(usage, "cacheRead")) ?? numberValue(field(usage, "cache_read_input_tokens")) ?? numberValue(field(usage, "cached_input_tokens"));
  const cacheCreation = numberValue(field(usage, "cacheCreation")) ?? numberValue(field(usage, "cache_creation_input_tokens"));
  const reasoning = numberValue(field(usage, "reasoning")) ?? numberValue(field(usage, "reasoning_tokens"));
  // Claude and Codex never report a context-window size, only the per-call token kinds. The
  // resident context is the sum of uncached input plus the cache-read and cache-creation prefix,
  // so derive it here when no explicit field exists. This lets session aggregates take a max over
  // turns and surface peak context, instead of summing cache reads into a meaningless grand total.
  const explicitContext = numberValue(field(usage, "context")) ?? numberValue(field(usage, "context_tokens"));
  const context = explicitContext ?? sum([input, cacheRead, cacheCreation]);
  const peakContext = numberValue(field(usage, "peakContext")) ?? numberValue(field(usage, "peak_context_tokens"));
  const total = numberValue(field(usage, "total")) ?? numberValue(field(usage, "total_tokens")) ?? sum([input, output, cacheRead, cacheCreation, reasoning]);
  if ([input, output, cacheRead, cacheCreation, reasoning, context, peakContext, total].every((item) => item === undefined)) return undefined;
  const confidence = stringValue(field(data, "usageConfidence")) || stringValue(field(data, "confidence"));
  return {
    input,
    output,
    total,
    cacheRead,
    cacheCreation,
    reasoning,
    context,
    peakContext,
    source: event.capture.source === "native-import" ? "provider-reported" : confidence === "estimated" ? "estimated" : "derived",
    confidence: confidence === "estimated" ? "estimated" : confidence === "derived" ? "derived" : event.capture.source === "native-import" ? "provider-reported" : "unknown"
  };
}

/** Normalizes a raw cost object into a typed UsageCost, returning undefined if no cost data is present. */
function normalizeCost(value: unknown): UsageCost | undefined {
  const cost = objectValue(value);
  if (!cost) return undefined;
  const amount = numberValue(field(cost, "amount")) ?? numberValue(field(cost, "usd")) ?? numberValue(field(cost, "cost_usd"));
  return {
    amount,
    currency: "USD",
    source: stringUnion(field(cost, "source"), ["provider-reported", "pricing-plugin", "estimated", "unknown"]) || "unknown",
    priced: Boolean(field(cost, "priced") ?? amount !== undefined),
    unpricedModels: stringArray(field(cost, "unpricedModels"))
  };
}

/** Maps a legacy event kind string to its canonical v3 kind string. */
function legacyKindToV3(kind: string): string {
  if (kind === "conversation.start") return "session.start";
  if (kind === "conversation.end") return "session.end";
  if (kind === "message.user" || kind === "message.assistant.visible" || kind === "message.assistant.internal" || kind === "message.system") return "message";
  if (kind === "tool.call") return "tool.call";
  if (kind === "tool.result" || kind === "tool.error") return "tool.result";
  if (kind === "token.usage") return "model.call";
  if (kind.startsWith("compact.")) return "compaction";
  if (kind.startsWith("permission.")) return "permission";
  if (kind.startsWith("file.")) return "file.event";
  if (kind === "subagent.start") return "subagent.start";
  if (kind === "subagent.stop") return "subagent.end";
  if (kind === "command.exec") return "tool.call";
  return kind;
}

/** Returns the actor role string for a legacy event kind, or undefined for non-message events. */
function roleForLegacyEvent(event: UsageJsonlLineV1): string | undefined {
  if (event.kind === "message.user") return "user";
  if (event.kind === "message.assistant.visible" || event.kind === "message.assistant.internal") return "assistant";
  if (event.kind === "message.system") return "system";
  return event.actor?.role;
}

/** Builds the file facet for a file.* event, or returns undefined for other event kinds. */
function fileFacet(event: UsageJsonlLineV1, data: Record<string, unknown>): UsageEventV3["data"]["file"] {
  if (!event.kind.startsWith("file.")) return undefined;
  return {
    path: stringValue(field(data, "path")) || stringValue(field(data, "file")) || stringValue(field(data, "target_path")),
    targetPaths: pathsForData(data),
    operation: event.kind === "file.read" ? "read" : event.kind === "file.search" ? "search" : event.kind === "file.write" ? "write" : undefined
  };
}

/** Collects all path-like strings from an arbitrary data object by walking known path keys. */
function pathsForData(data: unknown): string[] {
  const rows: string[] = [];
  collectPaths(data, rows);
  return unique(rows.map((row) => row.trim()).filter(Boolean));
}

/** Recursively walks a value, pushing strings found under known path keys into rows. */
function collectPaths(value: unknown, rows: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, rows);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (["path", "paths", "file", "file_path", "file_paths", "target_path", "target_paths", "glob"].includes(key)) {
      if (typeof nested === "string") rows.push(nested);
      if (Array.isArray(nested)) rows.push(...nested.filter((item): item is string => typeof item === "string"));
    }
    if (key === "input" || key === "tool_input" || key === "arguments" || key === "command") collectPaths(nested, rows);
  }
}

/** Coerces a legacy confidence string to the canonical UsageEventV3 confidence type. */
function legacyConfidence(value: unknown): UsageEventV3["availability"]["confidence"] {
  if (value === "exact" || value === "provider-reported" || value === "derived" || value === "estimated" || value === "partial" || value === "unsupported" || value === "unknown") return value;
  if (value === "inferred") return "estimated";
  return "unknown";
}

/** Returns a single-line preview of a string truncated to length characters, or undefined if not a string. */
function preview(value: unknown, length = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > length ? `${singleLine.slice(0, length - 1)}...` : singleLine;
}

/** Returns a SHA-256 hex digest of a string for use as a stable deterministic ID. */
function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Sums all defined finite numbers in the array, returning undefined if none are present. */
function sum(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!present.length) return undefined;
  return present.reduce((total, value) => total + value, 0);
}

/** Returns a new array with duplicate and nullish values removed. */
function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter((value): value is T & {} => value !== undefined && value !== null))];
}

/** Returns the value as a plain object record, or undefined if it is an array or non-object. */
function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Returns a named key from an object-like value, or undefined if value is not an object. */
function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** Returns the value as a non-empty string, or undefined. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Returns the value as a finite number, or undefined. */
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Returns an array of strings from the value, or undefined if the value is not an array. */
function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

/** Returns the value if it is one of the allowed union options, otherwise undefined. */
function stringUnion<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === "string" && options.includes(value as T) ? value as T : undefined;
}
