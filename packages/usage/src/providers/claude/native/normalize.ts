import { createHash } from "node:crypto";

import type { UsageEventKind, UsageJsonlLineV1 } from "../../../core/schema/usage-jsonl-v1.js";
import { conversationId } from "../../../core/ids.js";
import { defaultRedaction, previewText, redactUnknown } from "../../../core/redaction.js";

export type ClaudeNativeRecord = {
  line: number;
  record: Record<string, unknown>;
};

export type ClaudeNativeNormalizeOptions = {
  sourcePath: string;
  inferredComplete: boolean;
};

export function normalizeClaudeNativeRecords(records: ClaudeNativeRecord[], options: ClaudeNativeNormalizeOptions): UsageJsonlLineV1[] {
  const visible = records.filter((row) => !isMetaRecord(row.record));
  if (!visible.length) return [];
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
        events.push(base(source, "tool.result", result.data, {
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
      if (text) {
        events.push(base(source, "message.assistant.visible", {
          text,
          text_preview: previewText(text)
        }, {
          turn: turn(currentTurnId),
          actor: { role: "assistant", model },
          links: { message_id: stringValue(message.id) || stringValue(item.uuid) },
          availability: { confidence: "partial", notes: ["Imported from Claude Code native assistant record."] }
        }));
      }
      for (const call of toolCallsFromMessage(message)) {
        events.push(base(source, "tool.call", call.data, {
          turn: turn(currentTurnId),
          actor: { role: "assistant", model },
          links: { tool_call_id: call.toolCallId },
          availability: { confidence: "partial", notes: ["Imported from Claude Code native tool_use content."] }
        }));
      }
      const usage = objectValue(message.usage) || objectValue(item.usage);
      if (usage) {
        events.push(base(source, "token.usage", {
          usage,
          usageConfidence: "provider-reported",
          usageKind: "message",
          model
        }, {
          turn: turn(currentTurnId),
          actor: { role: "assistant", model },
          links: { message_id: stringValue(message.id) || stringValue(item.uuid) },
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
    const messageEvent: UsageJsonlLineV1 = {
      ...base,
      kind: "message.assistant.visible",
      actor: { role: "assistant", model: stringValue(objectValue(message)?.model) || stringValue(item.model) },
      data: {
        ...(contentText ? { text: contentText, text_preview: previewText(contentText) } : {}),
        ...(usage ? { usage } : {})
      },
      links: { message_id: stringValue(objectValue(message)?.id) },
      availability: { confidence: "partial", notes: ["Imported from Claude native transcript."] }
    };
    const events = [messageEvent];
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

function toolCallsFromMessage(message: Record<string, unknown>): Array<{ toolCallId?: string; data: Record<string, unknown> }> {
  const content = Array.isArray(message.content) ? message.content : [];
  return content.flatMap((part) => {
    if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "tool_use") return [];
    const record = part as Record<string, unknown>;
    const toolName = stringValue(record.name) || "unknown";
    const input = record.input;
    return [{
      toolCallId: stringValue(record.id),
      data: {
        tool_name: toolName,
        category: categorizeTool(toolName),
        input: redactUnknown(input, defaultRedaction),
        target_paths: extractPaths(input)
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
        output: redactUnknown(record.content, defaultRedaction),
        status: record.is_error === true ? "error" : "success"
      }
    }];
  });
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
function turn(id: string | undefined): { id?: string } | undefined {
  return id ? { id } : undefined;
}
function syntheticTurnId(line: number): string {
  return `turn-line-${line}`;
}
function categorizeTool(toolName: string): string {
  const lower = toolName.toLowerCase();
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
