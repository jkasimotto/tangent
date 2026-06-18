import { createHash } from "node:crypto";

import type { UsageEventKind, UsageJsonlLineV1 } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { conversationId } from "@tangent/usage-core/core/ids";
import { previewText } from "@tangent/usage-core/core/redaction";

export type ClaudeNativeRecord = {
  line: number;
  record: Record<string, unknown>;
};

export type ClaudeNativeNormalizeOptions = {
  sourcePath: string;
  inferredComplete: boolean;
};

export function normalizeClaudeNativeRecords(records: ClaudeNativeRecord[], options: ClaudeNativeNormalizeOptions): UsageJsonlLineV1[] {
  const visible = mergeClaudeAssistantChunks(records.filter((row) => !isMetaRecord(row.record)));
  if (!visible.length) return [];
  // Each tool_use is written on its own line with its own timestamp; the matching tool_result
  // arrives later on a user line. Capturing the first timestamp per tool_use id (before chunk
  // merging collapses them) lets us derive a real per-call duration = result time - call time,
  // which is the only per-tool-call timing Claude records. Subagent (Task) calls are excluded:
  // their main-thread result is logged near-instantly while the real work runs in a sidechain, so
  // the delta would read as a few milliseconds; those fall back to the turn duration downstream.
  const { starts: toolUseStartByCallId, subagentCallIds } = indexToolUseStarts(records);
  const first = visible[0]!;
  const last = visible.at(-1)!;
  const sessionId = stringValue(first.record.sessionId) || stringValue(first.record.session_id) || pathSessionId(options.sourcePath);
  const conversation = {
    id: conversationId("claude", sessionId),
    provider_session_id: sessionId,
    transcript_path: options.sourcePath,
    started_at: timestampFor(first.record)
  };
  const events: UsageJsonlLineV1[] = [];
  let currentTurnId: string | undefined;
  let lastTurnEnded = false;

  const base = (source: ClaudeNativeRecord, kind: UsageEventKind, data: unknown, extra: Partial<UsageJsonlLineV1> = {}): UsageJsonlLineV1 => {
    const timestamp = timestampFor(source.record) || new Date().toISOString();
    return {
      schema: "usage.event.v2",
      event_id: deterministicEventId(options.sourcePath, source.line, kind, data),
      kind,
      recorded_at: timestamp,
      observed_at: timestamp,
      provider: "claude",
      capture: {
        source: "native-import",
        scope: "native",
        usage_version: "0.1.0",
        provider_version: stringValue(source.record.version),
        content_mode: "metadata-with-excerpts",
        confidence: extra.availability?.confidence || "partial"
      },
      repo: {
        cwd: stringValue(source.record.cwd),
        git: { branch: stringValue(source.record.gitBranch) },
        tracking: { enabled: true, source: "none" as const }
      },
      conversation,
      native: {
        type: stringValue(source.record.type),
        source_path: options.sourcePath,
        line: source.line,
        raw_redacted: false,
        raw_hash: hash(JSON.stringify(source.record))
      },
      data,
      ...extra
    };
  };

  events.push(base(first, "conversation.start", {
    entrypoint: stringValue(first.record.entrypoint),
    user_type: stringValue(first.record.userType)
  }, {
    actor: { role: "system" },
    availability: { confidence: "partial", notes: ["Imported from Claude Code native transcript."] }
  }));

  for (const source of visible) {
    const item = source.record;
    if (stringValue(item.type) === "local_command" || stringValue(item.role) === "local_command") continue;
    const role = stringValue(item.type) || stringValue(item.role);
    const message = objectValue(item.message) || item;

    if (role === "user") {
      currentTurnId = stringValue(item.promptId) || stringValue(item.uuid) || syntheticTurnId(source.line);
      lastTurnEnded = false;
      events.push(base(source, "turn.start", { status: "started" }, {
        turn: { id: currentTurnId },
        actor: { role: "user" },
        availability: { confidence: "partial", notes: ["Imported from Claude Code native user record."] }
      }));
      const text = extractText(message, "user");
      if (text) {
        events.push(base(source, "message.user", {
          text,
          text_preview: previewText(text)
        }, {
          turn: { id: currentTurnId },
          actor: { role: "user" },
          links: { message_id: stringValue(item.uuid) },
          availability: { confidence: "partial", notes: ["Imported from Claude Code native user record."] }
        }));
      }
      for (const result of toolResultsFromMessage(message)) {
        const durationMs = result.toolCallId && subagentCallIds.has(result.toolCallId)
          ? undefined
          : toolCallDurationMs(toolUseStartByCallId, result.toolCallId, timestampFor(item));
        events.push(base(source, "tool.result", durationMs !== undefined ? { ...result.data, duration_ms: durationMs } : result.data, {
          turn: { id: currentTurnId },
          actor: { role: "tool" },
          links: { tool_call_id: result.toolCallId },
          availability: { confidence: "partial", notes: ["Imported from Claude Code native tool_result content."] }
        }));
      }
      continue;
    }

    if (role === "assistant") {
      const model = stringValue(message.model) || stringValue(item.model);
      const text = extractText(message, "assistant");
      const thinking = extractThinking(message);
      const toolCalls = toolCallsFromMessage(message);
      const usage = objectValue(message.usage) || objectValue(item.usage);
      const assistantMessageId =
        stringValue(message.id) ||
        stringValue(item.uuid) ||
        deterministicMessageId(options.sourcePath, source.line);
      if (text || thinking || toolCalls.length || usage) {
        events.push(base(source, "message.assistant.visible", {
          text: text || "",
          text_preview: previewText(text || ""),
          ...(thinking ? { thinking, thinking_preview: previewText(thinking) } : {})
        }, {
          turn: turn(currentTurnId),
          actor: { role: "assistant", model },
          links: { message_id: assistantMessageId },
          availability: { confidence: "partial", notes: ["Imported from Claude Code native assistant record."] }
        }));
      }
      for (const call of toolCalls) {
        events.push(base(source, "tool.call", call.data, {
          turn: turn(currentTurnId),
          actor: { role: "assistant", model },
          links: { message_id: assistantMessageId, tool_call_id: call.toolCallId },
          availability: { confidence: "partial", notes: ["Imported from Claude Code native tool_use content."] }
        }));
      }
      if (usage) {
        events.push(base(source, "token.usage", {
          usage,
          usageConfidence: "provider-reported",
          usageKind: "message",
          model
        }, {
          turn: turn(currentTurnId),
          actor: { role: "assistant", model },
          links: { message_id: assistantMessageId },
          availability: { confidence: "partial", notes: ["Imported from Claude Code native assistant usage fields."] }
        }));
      }
      const stopReason = stringValue(message.stop_reason);
      if (currentTurnId && (stopReason === "end_turn" || stopReason === "stop_sequence")) {
        events.push(base(source, "turn.end", {
          status: "completed",
          stop_reason: stopReason
        }, {
          turn: { id: currentTurnId },
          actor: { role: "assistant", model },
          availability: { confidence: "partial", notes: ["Imported from Claude Code native assistant stop_reason."] }
        }));
        lastTurnEnded = true;
      }
    }
  }

  if (options.inferredComplete && currentTurnId && !lastTurnEnded) {
    events.push(base(last, "turn.end", {
      status: "completed",
      inferred: true,
      reason: "native transcript quiet for completion window"
    }, {
      turn: { id: currentTurnId },
      actor: { role: "assistant" },
      availability: { confidence: "inferred", notes: ["Inferred from native transcript quiet window."] }
    }));
  }

  if (options.inferredComplete) {
    events.push(base(last, "conversation.end", {
      inferred: true
    }, {
      actor: { role: "assistant" },
      availability: { confidence: "inferred", notes: ["Inferred from native transcript quiet window."] }
    }));
  }

  return events;
}

export function normalizeClaudeNativeRecord(record: unknown, sourcePath: string, line: number): UsageJsonlLineV1[] {
  if (!record || typeof record !== "object") return [];
  const item = record as Record<string, unknown>;
  if (isMetaRecord(item)) return [];
  if (stringValue(item.type) === "local_command" || stringValue(item.role) === "local_command") return [];

  const sessionId = stringValue(item.sessionId) || stringValue(item.session_id) || pathSessionId(sourcePath);
  const role = stringValue(item.type) || stringValue(item.role);
  const timestamp = stringValue(item.timestamp) || stringValue(item.created_at);
  const message = objectValue(item.message) || item;
  const contentText = extractText(message);
  const base = {
    schema: "usage.event.v2" as const,
    event_id: deterministicEventId(sourcePath, line, record),
    recorded_at: timestamp || new Date().toISOString(),
    observed_at: timestamp,
    provider: "claude" as const,
    capture: {
      source: "native-import" as const,
      scope: "native" as const,
      usage_version: "0.1.0",
      content_mode: "metadata-with-excerpts" as const,
      confidence: "partial" as const
    },
    repo: {
      cwd: stringValue(item.cwd),
      tracking: { enabled: true, source: "none" as const }
    },
    conversation: {
      id: conversationId("claude", sessionId),
      provider_session_id: sessionId,
      transcript_path: sourcePath
    },
    native: {
      type: role,
      source_path: sourcePath,
      line,
      raw_redacted: false,
      raw_hash: hash(JSON.stringify(record))
    }
  };

  if (role === "user") {
    return [{
      ...base,
      kind: "message.user",
      actor: { role: "user" },
      data: contentText ? { text: contentText, text_preview: previewText(contentText) } : { raw: record },
      availability: { confidence: "partial", notes: ["Imported from Claude native transcript."] }
    }];
  }

  if (role === "assistant") {
    const usage = objectValue(message)?.usage || item.usage;
    const thinkingText = extractThinking(message);
    const assistantMessageId = stringValue(objectValue(message)?.id) || stringValue(item.uuid) || deterministicMessageId(sourcePath, line);
    const toolCalls = toolCallsFromMessage(objectValue(message) || item);
    const messageEvent: UsageJsonlLineV1 = {
      ...base,
      kind: "message.assistant.visible",
      actor: { role: "assistant", model: stringValue(objectValue(message)?.model) || stringValue(item.model) },
      data: {
        ...(contentText ? { text: contentText, text_preview: previewText(contentText) } : {}),
        ...(thinkingText ? { thinking: thinkingText, thinking_preview: previewText(thinkingText) } : {}),
        ...(usage ? { usage } : {})
      },
      links: { message_id: assistantMessageId },
      availability: { confidence: "partial", notes: ["Imported from Claude native transcript."] }
    };
    const events = [messageEvent];
    for (const call of toolCalls) {
      events.push({
        ...base,
        event_id: deterministicEventId(sourcePath, line, "tool.call", call.data),
        kind: "tool.call",
        actor: messageEvent.actor,
        data: call.data,
        links: { message_id: assistantMessageId, tool_call_id: call.toolCallId },
        availability: { confidence: "partial", notes: ["Imported from Claude native transcript tool_use content."] }
      });
    }
    if (usage) {
      events.push({
        ...base,
        event_id: deterministicEventId(sourcePath, line, { usage }),
        kind: "token.usage",
        actor: messageEvent.actor,
        data: {
          usage,
          usageConfidence: "provider-reported",
          model: messageEvent.actor?.model
        },
        links: messageEvent.links,
        availability: { confidence: "partial", notes: ["Imported from Claude native transcript usage fields."] }
      });
    }
    return events;
  }

  if (role === "tool_use" || item.toolUseResult || item.tool_use_id) {
    return [{
      ...base,
      kind: item.toolUseResult ? "tool.result" : "tool.call",
      actor: { role: item.toolUseResult ? "tool" : "assistant" },
      links: { tool_call_id: stringValue(item.tool_use_id) || stringValue(item.id) },
      data: record,
      availability: { confidence: "partial", notes: ["Imported from Claude native transcript."] }
    }];
  }

  return [];
}

function deterministicEventId(sourcePath: string, line: number, record: unknown): string;
function deterministicEventId(sourcePath: string, line: number, kind: UsageEventKind, data: unknown): string;
function deterministicEventId(sourcePath: string, line: number, third: unknown, fourth?: unknown): string {
  const value = fourth === undefined ? third : `${String(third)}:${JSON.stringify(fourth)}`;
  return `evt_native_${hash(`${sourcePath}:${line}:${JSON.stringify(value)}`)}`;
}

function deterministicMessageId(sourcePath: string, line: number): string {
  return `msg_native_${hash(`${sourcePath}:${line}:assistant-message`)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function extractText(value: unknown, mode: "user" | "assistant" = "assistant"): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) {
    return record.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
          return stringValue((part as { text?: unknown }).text);
        }
        if (mode === "user" && part && typeof part === "object" && (part as { type?: unknown }).type === "tool_result") {
          return undefined;
        }
        return undefined;
      })
      .filter(Boolean)
      .join("\n");
  }
  return undefined;
}

/**
 * Collapses the streamed chunks of one assistant turn into a single record.
 * Claude writes one assistant turn across several JSONL lines sharing a
 * `message.id` (a thinking line, a text line, then each tool_use on its own
 * line), and every line repeats the identical `usage` object. Emitting events
 * per line therefore duplicates the message, splits its text, and multiplies
 * token totals. A `message.id` is unique per API response, so all records that
 * carry it belong to one turn even when interleaved tool_result lines separate
 * them (parallel tool calls). This groups every same-id assistant record,
 * regardless of contiguity, into one record emitted at the turn's first
 * occurrence, so the rest of the pipeline sees a single message, all distinct
 * tool calls, and one usage reading.
 */
function mergeClaudeAssistantChunks(records: ClaudeNativeRecord[]): ClaudeNativeRecord[] {
  const groups = new Map<string, ClaudeNativeRecord[]>();
  const slots: Array<{ record?: ClaudeNativeRecord; id?: string }> = [];
  for (const row of records) {
    const mid = assistantRunMessageId(row.record);
    if (!mid) {
      slots.push({ record: row });
      continue;
    }
    if (!groups.has(mid)) {
      groups.set(mid, []);
      slots.push({ id: mid });
    }
    groups.get(mid)!.push(row);
  }
  return slots.map((slot) => (slot.record ? slot.record : mergeAssistantRun(groups.get(slot.id!)!)));
}

/** Returns the assistant `message.id` for a record, or undefined for non-assistant records and records without an id. */
function assistantRunMessageId(record: Record<string, unknown>): string | undefined {
  if (stringValue(record.type) !== "assistant") return undefined;
  return stringValue(objectValue(record.message)?.id);
}

/** Builds one record from all chunks of an assistant turn: first chunk's envelope, last chunk's message metadata, merged content blocks. */
function mergeAssistantRun(run: ClaudeNativeRecord[]): ClaudeNativeRecord {
  if (run.length === 1) return run[0]!;
  const lastMessage = objectValue(run.at(-1)!.record.message) || {};
  const blocks = mergeClaudeContentBlocks(run.map((row) => objectValue(row.record.message)?.content));
  return {
    line: run[0]!.line,
    record: { ...run[0]!.record, message: { ...lastMessage, content: blocks } }
  };
}

/**
 * Merges content blocks across chunks, deduplicating by alignment so neither
 * additive chunks (distinct block per line) nor cumulative snapshots (each line
 * repeats prior blocks) double-count. Text blocks align by prefix and keep the
 * longest; tool_use blocks align by id and keep the latest; other blocks align
 * only on deep equality.
 */
function mergeClaudeContentBlocks(contents: Array<unknown>): unknown[] {
  const merged: Record<string, unknown>[] = [];
  for (const content of contents) {
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      const block = objectValue(raw);
      if (!block) continue;
      const index = merged.findIndex((existing) => blocksAlign(existing, block));
      if (index === -1) merged.push(block);
      else merged[index] = pickLatestBlock(merged[index]!, block);
    }
  }
  return merged;
}

/** Reports whether two content blocks represent the same logical block (text prefix, tool_use id, else deep equality). */
function blocksAlign(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const type = stringValue(a.type);
  if (type !== stringValue(b.type)) return false;
  if (type === "text") {
    const ta = stringValue(a.text) || "";
    const tb = stringValue(b.text) || "";
    return ta === tb || tb.startsWith(ta) || ta.startsWith(tb);
  }
  if (type === "tool_use") {
    const ida = stringValue(a.id);
    const idb = stringValue(b.id);
    if (ida && idb) return ida === idb;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Picks the more complete of two aligned blocks: the longer text, the latest tool_use, otherwise the existing block. */
function pickLatestBlock(existing: Record<string, unknown>, candidate: Record<string, unknown>): Record<string, unknown> {
  const type = stringValue(existing.type);
  if (type === "text") {
    return (stringValue(candidate.text) || "").length >= (stringValue(existing.text) || "").length ? candidate : existing;
  }
  if (type === "tool_use") return candidate;
  return existing;
}

/** Concatenates the text of any `thinking` content blocks on an assistant message; returns undefined when none carry plaintext. */
function extractThinking(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.content)) return undefined;
  const parts = record.content
    .map((part) => {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "thinking") {
        return stringValue((part as { thinking?: unknown }).thinking);
      }
      return undefined;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join("\n\n") : undefined;
}

/** Lifts the markdown plan from an ExitPlanMode tool input so it can be surfaced as first-class content. */
function planText(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  return stringValue((input as Record<string, unknown>).plan);
}

function toolCallsFromMessage(message: Record<string, unknown>): Array<{ toolCallId?: string; data: Record<string, unknown> }> {
  const content = Array.isArray(message.content) ? message.content : [];
  return content.flatMap((part) => {
    if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "tool_use") return [];
    const record = part as Record<string, unknown>;
    const toolName = stringValue(record.name) || "unknown";
    const input = record.input;
    const plan = toolName === "ExitPlanMode" ? planText(input) : undefined;
    return [{
      toolCallId: stringValue(record.id),
      data: {
        tool_name: toolName,
        category: categorizeTool(toolName),
        input,
        target_paths: extractPaths(input),
        ...(plan ? { plan, plan_preview: previewText(plan) } : {})
      }
    }];
  });
}

function toolResultsFromMessage(message: Record<string, unknown>): Array<{ toolCallId?: string; data: Record<string, unknown> }> {
  const content = Array.isArray(message.content) ? message.content : [];
  return content.flatMap((part) => {
    if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "tool_result") return [];
    const record = part as Record<string, unknown>;
    return [{
      toolCallId: stringValue(record.tool_use_id),
      data: {
        tool_name: "unknown",
        category: "other",
        output: record.content,
        status: record.is_error === true ? "error" : "success",
        ...toolResultMetadata(record.content)
      }
    }];
  });
}

function toolResultMetadata(output: unknown): Record<string, unknown> {
  const text = typeof output === "string" ? output : output === undefined || output === null ? "" : JSON.stringify(output);
  return {
    output_chars: text.length,
    output_bytes: Buffer.byteLength(text, "utf8"),
    truncated: /(?:tokens|characters|bytes) truncated|truncated[^\n]*output|omitted/i.test(text)
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function pathSessionId(sourcePath: string): string {
  const file = sourcePath.split("/").at(-1) || "unknown";
  return file.replace(/\.jsonl$/, "");
}

function timestampFor(record: Record<string, unknown>): string | undefined {
  return stringValue(record.timestamp) || stringValue(record.created_at);
}
function isMetaRecord(item: Record<string, unknown>): boolean {
  return item.isMeta === true || item.is_meta === true;
}

/**
 * Indexes the earliest timestamp at which each tool_use id appeared across the raw records, and flags
 * the ids that are subagent (Task) calls. Claude streams one tool_use per assistant line with its own
 * timestamp, and chunk merging later keeps only the turn's first timestamp, so this captures the
 * per-call start time before that information is lost. Subagent ids are tracked separately because
 * their result timestamp does not reflect the subagent's real runtime.
 */
function indexToolUseStarts(records: ClaudeNativeRecord[]): { starts: Map<string, string>; subagentCallIds: Set<string> } {
  const starts = new Map<string, string>();
  const subagentCallIds = new Set<string>();
  for (const row of records) {
    const item = row.record;
    if (isMetaRecord(item) || stringValue(item.type) !== "assistant") continue;
    const message = objectValue(item.message) || item;
    const content = Array.isArray(message.content) ? message.content : [];
    const ts = timestampFor(item);
    for (const part of content) {
      if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "tool_use") continue;
      const block = part as Record<string, unknown>;
      const id = stringValue(block.id);
      if (!id) continue;
      if (isSubagentTool(stringValue(block.name))) subagentCallIds.add(id);
      if (ts && !starts.has(id)) starts.set(id, ts);
    }
  }
  return { starts, subagentCallIds };
}

/** Reports whether a tool name denotes a subagent dispatch, whose result time does not reflect its runtime. */
function isSubagentTool(name: string | undefined): boolean {
  const lower = (name || "").toLowerCase();
  return lower === "task" || lower === "agent";
}

/** Returns the non-negative milliseconds a tool call took: its result timestamp minus its call timestamp. */
function toolCallDurationMs(starts: Map<string, string>, callId: string | undefined, resultTs: string | undefined): number | undefined {
  if (!callId || !resultTs) return undefined;
  const startTs = starts.get(callId);
  if (!startTs) return undefined;
  const start = Date.parse(startTs);
  const end = Date.parse(resultTs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return end - start;
}
function turn(id: string | undefined): { id?: string } | undefined {
  return id ? { id } : undefined;
}
function syntheticTurnId(line: number): string {
  return `turn-line-${line}`;
}
function categorizeTool(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower === "exitplanmode") return "plan";
  if (lower === "bash" || lower === "exec_command" || lower.includes("shell")) return "command";
  if (lower.includes("edit") || lower.includes("write") || lower.includes("patch")) return "write";
  if (lower.includes("read") || lower.includes("open") || lower.includes("view")) return "read";
  if (lower.includes("grep") || lower.includes("search") || lower.includes("glob")) return "search";
  return "other";
}

function extractPaths(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return [record.file_path, record.path, record.file, record.notebook_path]
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .filter((item): item is string => typeof item === "string" && item.length > 0);
}
