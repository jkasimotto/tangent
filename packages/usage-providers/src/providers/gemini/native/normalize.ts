import { createHash } from "node:crypto";

import type { UsageEventKind, UsageJsonlLineV1 } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { conversationId } from "@tangent/usage-core/core/ids";
import { defaultRedaction, previewText, redactUnknown } from "@tangent/usage-core/core/redaction";

import type { GeminiNativeRecord } from "./read.js";

export type { GeminiNativeRecord } from "./read.js";

export type GeminiNativeNormalizeOptions = {
  sourcePath: string;
  /** Working directory resolved from the session's projectHash via projects.json, when known. */
  cwd?: string;
  completed: boolean;
  inferredComplete: boolean;
};

/**
 * Normalizes one Gemini CLI chat session into Usage events. A session is a header record followed by
 * `user` and `gemini` message records; unlike Claude/Codex, a single `gemini` message bundles its
 * reasoning (`thoughts`), visible reply (`content`), `toolCalls` (call and result inline), and
 * provider token counts, so each one fans out into several events. Turns are synthesized from user
 * messages, the same way the Claude normalizer does, because the format has no explicit turn markers.
 */
export function normalizeGeminiNativeRecords(records: GeminiNativeRecord[], options: GeminiNativeNormalizeOptions): UsageJsonlLineV1[] {
  const header = records.find((row) => stringValue(row.record.sessionId) && !stringValue(row.record.type));
  const messages = records.filter((row) => isMessage(row.record));
  const sessionId = stringValue(header?.record.sessionId) || stringValue(messages[0]?.record.sessionId) || pathSessionId(options.sourcePath);
  const startedAt = stringValue(header?.record.startTime) || timestampFor(messages[0]?.record);
  let currentModel = messages.map((row) => stringValue(row.record.model)).find(Boolean);

  const conversation = {
    id: conversationId("gemini", sessionId),
    provider_session_id: sessionId,
    transcript_path: options.sourcePath,
    started_at: startedAt
  };
  const repo = {
    root: options.cwd,
    cwd: options.cwd,
    tracking: { enabled: true, source: "none" as const }
  };

  /** Builds one normalized event sharing this session's conversation, repo, and capture context. */
  const base = (source: GeminiNativeRecord, kind: UsageEventKind, data: unknown, extra: Partial<UsageJsonlLineV1> = {}): UsageJsonlLineV1 => {
    const timestamp = timestampFor(source.record) || startedAt || new Date().toISOString();
    return {
      schema: "usage.event.v2",
      event_id: deterministicEventId(options.sourcePath, source.line, kind, data),
      kind,
      recorded_at: timestamp,
      observed_at: timestamp,
      provider: "gemini",
      capture: {
        source: "native-import",
        scope: "native",
        usage_version: "0.1.0",
        provider_version: undefined,
        content_mode: "metadata-with-excerpts",
        confidence: extra.availability?.confidence || "partial"
      },
      repo,
      conversation,
      native: {
        type: stringValue(source.record.type) || (source === header ? "session" : undefined),
        source_path: options.sourcePath,
        line: source.line,
        raw_redacted: false,
        raw_hash: hash(JSON.stringify(source.record))
      },
      data,
      ...extra
    };
  };

  const events: UsageJsonlLineV1[] = [];
  const startRecord = header || messages[0];
  if (startRecord) {
    events.push(base(startRecord, "conversation.start", {
      kind: stringValue(startRecord.record.kind)
    }, {
      actor: { role: "system", model: currentModel },
      availability: { confidence: "partial", notes: ["Imported from Gemini CLI native chat session."] }
    }));
  }

  let currentTurnId: string | undefined;
  let lastTurnEnded = false;

  for (const source of messages) {
    const item = source.record;
    const type = stringValue(item.type);

    if (type === "user") {
      currentTurnId = stringValue(item.id) || syntheticTurnId(source.line);
      lastTurnEnded = false;
      events.push(base(source, "turn.start", { status: "started" }, {
        turn: { id: currentTurnId },
        actor: { role: "user", model: currentModel },
        availability: { confidence: "partial", notes: ["Imported from Gemini CLI native user message."] }
      }));
      const text = geminiText(item.content);
      if (text) {
        events.push(base(source, "message.user", {
          text,
          text_preview: previewText(text)
        }, {
          turn: { id: currentTurnId },
          actor: { role: "user", model: currentModel },
          links: { message_id: stringValue(item.id) },
          availability: { confidence: "partial", notes: ["Imported from Gemini CLI native user message."] }
        }));
      }
      continue;
    }

    // type === "gemini": one record bundles reasoning, reply, tool calls, and token counts. Mirror the
    // Claude normalizer and fold reasoning into the visible message's `thinking`, rather than emitting a
    // separate internal event, so the UI renders one assistant block per message instead of an empty one.
    currentModel = stringValue(item.model) || currentModel;
    const messageId = stringValue(item.id) || deterministicMessageId(options.sourcePath, source.line);
    const thoughts = geminiThoughts(item.thoughts);
    const text = geminiText(item.content);
    const toolCalls = geminiToolCalls(item.toolCalls);
    const usage = geminiUsage(item.tokens);
    if (text || thoughts || toolCalls.length || usage) {
      events.push(base(source, "message.assistant.visible", {
        text: text || "",
        text_preview: previewText(text || ""),
        ...(thoughts ? { thinking: thoughts, thinking_preview: previewText(thoughts) } : {})
      }, {
        turn: turn(currentTurnId),
        actor: { role: "assistant", model: currentModel },
        links: { message_id: messageId },
        availability: { confidence: "partial", notes: ["Imported from Gemini CLI native gemini message."] }
      }));
    }

    for (const call of toolCalls) {
      events.push(base(source, "tool.call", {
        tool_name: call.name,
        category: categorizeTool(call.name),
        input: redactUnknown(call.args, defaultRedaction),
        target_paths: extractPaths(call.args)
      }, {
        turn: turn(currentTurnId),
        actor: { role: "assistant", model: currentModel },
        links: { message_id: messageId, tool_call_id: call.id },
        availability: { confidence: "partial", notes: ["Imported from Gemini CLI native toolCalls."] }
      }));
      if (call.result !== undefined) {
        events.push(base(source, "tool.result", {
          tool_name: call.name,
          category: categorizeTool(call.name),
          output: redactUnknown(call.result, defaultRedaction),
          status: call.status,
          ...toolResultMetadata(call.result)
        }, {
          turn: turn(currentTurnId),
          actor: { role: "tool", model: currentModel },
          links: { message_id: messageId, tool_call_id: call.id },
          availability: { confidence: "partial", notes: ["Imported from Gemini CLI native toolCalls result."] }
        }));
      }
    }

    if (usage) {
      events.push(base(source, "token.usage", {
        usage,
        usageConfidence: "provider-reported",
        usageKind: "message",
        model: currentModel
      }, {
        turn: turn(currentTurnId),
        actor: { role: "assistant", model: currentModel },
        links: { message_id: messageId },
        availability: { confidence: "partial", notes: ["Imported from Gemini CLI native message token counts."] }
      }));
    }
  }

  const last = messages.at(-1) || startRecord;
  if (options.inferredComplete && currentTurnId && !lastTurnEnded && last) {
    events.push(base(last, "turn.end", {
      status: "completed",
      inferred: true,
      reason: "native transcript quiet for completion window"
    }, {
      turn: { id: currentTurnId },
      actor: { role: "assistant", model: currentModel },
      availability: { confidence: "inferred", notes: ["Inferred from native transcript quiet window."] }
    }));
  }

  if (last && (options.completed || options.inferredComplete)) {
    events.push(base(last, "conversation.end", {
      inferred: options.inferredComplete && !options.completed
    }, {
      actor: { role: "assistant", model: currentModel },
      availability: {
        confidence: options.completed ? "partial" : "inferred",
        notes: [options.completed ? "Imported from completed Gemini CLI native session." : "Inferred from native transcript quiet window."]
      }
    }));
  }

  return events;
}

/** Returns whether a record is a conversational message (a `user` or `gemini` turn). */
export function isGeminiMessage(record: Record<string, unknown>): boolean {
  return isMessage(record);
}

/** Reports whether a record is a conversational message (a `user` or `gemini` turn), not a header or update. */
function isMessage(record: Record<string, unknown>): boolean {
  const type = stringValue(record.type);
  return type === "user" || type === "gemini";
}

/** Flattens Gemini message content, which is either a plain string or an array of `{ text }` parts. */
function geminiText(content: unknown): string | undefined {
  if (typeof content === "string") return content || undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") return stringValue((part as Record<string, unknown>).text);
      return undefined;
    })
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}

/** Joins a message's reasoning thoughts into one summary string; returns undefined when there are none. */
function geminiThoughts(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((thought) => {
      if (!thought || typeof thought !== "object") return undefined;
      const record = thought as Record<string, unknown>;
      const subject = stringValue(record.subject);
      const description = stringValue(record.description);
      if (subject && description) return `${subject}: ${description}`;
      return subject || description;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join("\n\n") : undefined;
}

type GeminiToolCall = { id?: string; name: string; args: unknown; result: unknown; status: "success" | "error" | "unknown" };

/** Extracts the tool calls embedded in a `gemini` message, normalizing each call's status. */
function geminiToolCalls(value: unknown): GeminiToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const record = raw as Record<string, unknown>;
    return [{
      id: stringValue(record.id),
      name: stringValue(record.name) || "unknown",
      args: record.args,
      result: record.result,
      status: toolStatus(stringValue(record.status))
    }];
  });
}

/** Maps a Gemini toolCall status string to the Usage tool-result status vocabulary. */
function toolStatus(status: string | undefined): "success" | "error" | "unknown" {
  if (status === "success") return "success";
  if (status === "error" || status === "cancelled" || status === "failed") return "error";
  return "unknown";
}

/**
 * Maps Gemini's `tokens` block to a provider-usage object the aggregator understands. Gemini reports
 * `output` (visible) and `thoughts` (reasoning) separately; we fold them into `output_tokens` so
 * reasoning is counted as the generation cost it is, while keeping the raw splits for transparency.
 */
function geminiUsage(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const tokens = value as Record<string, unknown>;
  const input = numberValue(tokens.input);
  const output = numberValue(tokens.output);
  const thoughts = numberValue(tokens.thoughts);
  const cached = numberValue(tokens.cached);
  const tool = numberValue(tokens.tool);
  const total = numberValue(tokens.total);
  const usage: Record<string, number> = {};
  if (input !== undefined) usage.input_tokens = input;
  if (output !== undefined || thoughts !== undefined) usage.output_tokens = (output || 0) + (thoughts || 0);
  if (cached !== undefined) usage.cache_read_input_tokens = cached;
  if (output !== undefined) usage.gemini_visible_output_tokens = output;
  if (thoughts !== undefined) usage.gemini_thoughts_tokens = thoughts;
  if (tool !== undefined) usage.gemini_tool_tokens = tool;
  if (total !== undefined) usage.total_tokens = total;
  return Object.keys(usage).length ? usage : undefined;
}

/** Builds a stable event id from the source path, line, kind, and data, so re-imports are idempotent. */
function deterministicEventId(sourcePath: string, line: number, kind: UsageEventKind, data: unknown): string {
  return `evt_native_${hash(`${sourcePath}:${line}:${kind}:${JSON.stringify(data)}`)}`;
}

/** Derives a stable assistant message id for a gemini record that carries no usable id of its own. */
function deterministicMessageId(sourcePath: string, line: number): string {
  return `msg_native_${hash(`${sourcePath}:${line}:gemini-message`)}`;
}

/** Returns a short hex hash of a string, used for deterministic ids and raw-record fingerprints. */
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

/** Narrows a value to a non-empty string, or undefined. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Narrows a value to a finite number, or undefined. */
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Wraps a turn id in the event turn shape, or undefined when there is no current turn. */
function turn(id: string | undefined): { id?: string } | undefined {
  return id ? { id } : undefined;
}

/** Synthesizes a turn id from a record's line when the user message has no id. */
function syntheticTurnId(line: number): string {
  return `turn-line-${line}`;
}

/** Returns a record's timestamp, falling back to a session header's startTime. */
function timestampFor(record: Record<string, unknown> | undefined): string | undefined {
  return record ? stringValue(record.timestamp) || stringValue(record.startTime) : undefined;
}

/** Derives a session id from the transcript filename, a last resort when the header lacks one. */
function pathSessionId(sourcePath: string): string {
  const file = sourcePath.split("/").at(-1) || "unknown";
  return file.replace(/\.jsonl$/, "").replace(/\.json$/, "");
}

/** Buckets a Gemini tool name into a coarse category (command, write, read, search, other) for the UI. */
function categorizeTool(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower.includes("shell") || lower.includes("command") || lower === "bash") return "command";
  if (lower.includes("write") || lower.includes("edit") || lower.includes("replace") || lower.includes("patch")) return "write";
  if (lower.includes("read") || lower.includes("open") || lower.includes("view")) return "read";
  if (lower.includes("grep") || lower.includes("search") || lower.includes("glob") || lower.includes("find")) return "search";
  return "other";
}

/** Pulls filesystem paths out of a tool call's arguments so the UI can surface what it touched. */
function extractPaths(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return [record.file_path, record.absolute_path, record.path, record.file, record.directory]
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Summarizes a tool result's size and whether it was truncated, without storing the full output twice. */
function toolResultMetadata(output: unknown): Record<string, unknown> {
  const text = typeof output === "string" ? output : output === undefined || output === null ? "" : JSON.stringify(output);
  return {
    output_chars: text.length,
    output_bytes: Buffer.byteLength(text, "utf8"),
    truncated: /(?:tokens|characters|bytes) truncated|truncated[^\n]*output|omitted/i.test(text)
  };
}
