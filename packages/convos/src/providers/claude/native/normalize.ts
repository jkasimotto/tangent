import { createHash } from "node:crypto";

import type { ConvosJsonlLineV1 } from "../../../core/schema/convos-jsonl-v1.js";
import { conversationId } from "../../../core/ids.js";
import { previewText } from "../../../core/redaction.js";

export function normalizeClaudeNativeRecord(record: unknown, sourcePath: string, line: number): ConvosJsonlLineV1 | undefined {
  if (!record || typeof record !== "object") return undefined;
  const item = record as Record<string, unknown>;
  if (item.isMeta === true || item.is_meta === true) return undefined;
  if (stringValue(item.type) === "local_command" || stringValue(item.role) === "local_command") return undefined;

  const sessionId = stringValue(item.sessionId) || stringValue(item.session_id) || pathSessionId(sourcePath);
  const role = stringValue(item.type) || stringValue(item.role);
  const timestamp = stringValue(item.timestamp) || stringValue(item.created_at);
  const message = objectValue(item.message) || item;
  const contentText = extractText(message);
  const base = {
    schema: "convos.event.v2" as const,
    event_id: deterministicEventId(sourcePath, line, record),
    recorded_at: timestamp || new Date().toISOString(),
    observed_at: timestamp,
    provider: "claude" as const,
    capture: {
      source: "native-import" as const,
      scope: "native" as const,
      convos_version: "0.1.0",
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
    return {
      ...base,
      kind: "message.user",
      actor: { role: "user" },
      data: contentText ? { text: contentText, text_preview: previewText(contentText) } : { raw: record },
      availability: { confidence: "partial", notes: ["Imported from Claude native transcript."] }
    };
  }

  if (role === "assistant") {
    const usage = objectValue(message)?.usage || item.usage;
    return {
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
  }

  if (role === "tool_use" || item.toolUseResult || item.tool_use_id) {
    return {
      ...base,
      kind: item.toolUseResult ? "tool.result" : "tool.call",
      actor: { role: item.toolUseResult ? "tool" : "assistant" },
      links: { tool_call_id: stringValue(item.tool_use_id) || stringValue(item.id) },
      data: record,
      availability: { confidence: "partial", notes: ["Imported from Claude native transcript."] }
    };
  }

  return undefined;
}

function deterministicEventId(sourcePath: string, line: number, record: unknown): string {
  return `evt_native_${hash(`${sourcePath}:${line}:${JSON.stringify(record)}`)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function extractText(value: unknown): string | undefined {
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
        return undefined;
      })
      .filter(Boolean)
      .join("\n");
  }
  return undefined;
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
