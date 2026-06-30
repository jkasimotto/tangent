import { createHash } from "node:crypto";

import type { UsageJsonlLineV1, UsageEventKind } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { conversationId } from "@tangent/usage-core/core/ids";
import { defaultRedaction, previewText, redactUnknown } from "@tangent/usage-core/core/redaction";

export type CodexNativeRecord = {
  line: number;
  record: Record<string, unknown>;
};

export type CodexNativeNormalizeOptions = {
  sourcePath: string;
  completed: boolean;
  inferredComplete: boolean;
};

/** Converts a sequence of Codex native rollout records into structured usage events. */
export function normalizeCodexNativeRecords(records: CodexNativeRecord[], options: CodexNativeNormalizeOptions): UsageJsonlLineV1[] {
  const session = sessionInfo(records);
  if (!session.id) return [];

  const events: UsageJsonlLineV1[] = [];
  const conversation = {
    id: conversationId("codex", session.id),
    provider_session_id: session.id,
    transcript_path: options.sourcePath,
    started_at: session.startedAt
  };
  const repo = {
    root: session.cwd,
    cwd: session.cwd,
    git: {
      branch: session.branch,
      head_sha: session.headSha,
      origin_url_hash: undefined
    },
    tracking: { enabled: true, source: "none" as const }
  };
  let currentTurnId: string | undefined;
  let currentModel = session.model;
  let lastActivityAt = session.startedAt;
  let lastTurnEnded = false;
  let tokenSnapshotIndex = 0;
  let lastTokenUsageRaw: string | undefined;
  let cumulativeFallbackToken: { source: CodexNativeRecord; payload: Record<string, unknown> } | undefined;
  const toolCallsById = new Map<string, { toolName: string; category: string; input: unknown; targetPaths: string[] }>();

  /** Builds a base event envelope from a source record, kind, and data payload. */
  const base = (source: CodexNativeRecord, kind: UsageEventKind, data: unknown, extra: Partial<UsageJsonlLineV1> = {}): UsageJsonlLineV1 => {
    const timestamp = stringValue(source.record.timestamp) || lastActivityAt || new Date().toISOString();
    return {
      schema: "usage.event.v2",
      event_id: deterministicEventId(options.sourcePath, source.line, kind, data),
      kind,
      recorded_at: timestamp,
      observed_at: timestamp,
      provider: "codex",
      capture: {
        source: "native-import",
        scope: "native",
        usage_version: "0.1.0",
        provider_version: session.version,
        content_mode: "metadata-with-excerpts",
        confidence: extra.availability?.confidence || "partial"
      },
      repo,
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

  const startRecord = records.find((row) => stringValue(row.record.type) === "session_meta") || records[0];
  if (startRecord) {
    events.push(base(startRecord, "conversation.start", {
      source: session.source,
      originator: session.originator,
      thread_source: session.threadSource
    }, {
      actor: { role: "system", model: currentModel },
      availability: { confidence: "partial", notes: ["Imported from Codex native transcript session metadata."] }
    }));
  }

  for (const source of records) {
    const type = stringValue(source.record.type);
    const payload = objectValue(source.record.payload);
    const timestamp = stringValue(source.record.timestamp);
    if (timestamp) lastActivityAt = timestamp;

    if (type === "turn_context") {
      currentTurnId = stringValue(payload?.turn_id) || currentTurnId;
      currentModel = stringValue(payload?.model) || currentModel;
      lastTurnEnded = false;
      continue;
    }

    if (type === "event_msg") {
      const payloadType = stringValue(payload?.type);
      if (payloadType === "task_started") {
        currentTurnId = stringValue(payload?.turn_id) || currentTurnId || syntheticTurnId(source.line);
        lastTurnEnded = false;
        events.push(base(source, "turn.start", {
          status: "started",
          model_context_window: numberValue(payload?.model_context_window),
          collaboration_mode_kind: stringValue(payload?.collaboration_mode_kind)
        }, {
          turn: { id: currentTurnId },
          actor: { role: "user", model: currentModel },
          availability: { confidence: "partial", notes: ["Imported from Codex native task_started event."] }
        }));
        continue;
      }
      if (payloadType === "user_message") {
        const text = stringValue(payload?.message);
        if (text) {
          events.push(base(source, "message.user", {
            text,
            text_preview: previewText(text)
          }, {
            turn: turn(currentTurnId),
            actor: { role: "user", model: currentModel },
            availability: { confidence: "partial", notes: ["Imported from Codex native user_message event."] }
          }));
        }
        continue;
      }
      if (payloadType === "agent_message") {
        const text = stringValue(payload?.message);
        if (text) {
          events.push(base(source, "message.assistant.visible", {
            text,
            text_preview: previewText(text),
            phase: stringValue(payload?.phase)
          }, {
            turn: turn(currentTurnId),
            actor: { role: "assistant", model: currentModel },
            availability: { confidence: "partial", notes: ["Imported from Codex native agent_message event."] }
          }));
        }
        continue;
      }
      if (payloadType === "token_count") {
        const emitted = codexTokenUsageEvent(source, payload || {}, {
          snapshotIndex: tokenSnapshotIndex + 1,
          currentModel,
          currentTurnId,
          lastTokenUsageRaw,
          base
        });
        if (emitted.event) {
          tokenSnapshotIndex += 1;
          lastTokenUsageRaw = emitted.lastTokenUsageRaw;
          events.push(emitted.event);
        } else if (emitted.cumulativeOnly) {
          cumulativeFallbackToken = { source, payload: payload || {} };
        }
        continue;
      }
      if (payloadType === "task_complete") {
        const turnId = stringValue(payload?.turn_id) || currentTurnId;
        events.push(base(source, "turn.end", {
          status: "completed",
          duration_ms: numberValue(payload?.duration_ms),
          time_to_first_token_ms: numberValue(payload?.time_to_first_token_ms)
        }, {
          turn: turn(turnId),
          actor: { role: "assistant", model: currentModel },
          availability: { confidence: "partial", notes: ["Imported from Codex native task_complete event."] }
        }));
        lastTurnEnded = true;
        continue;
      }
    }

    if (type === "response_item") {
      const payloadType = stringValue(payload?.type);
      if (payloadType === "function_call") {
        const callId = stringValue(payload?.call_id);
        const toolName = stringValue(payload?.name) || "unknown";
        const input = parseArguments(payload?.arguments);
        const category = categorizeTool(toolName);
        const targetPaths = extractPaths(input);
        if (callId) toolCallsById.set(callId, { toolName, category, input, targetPaths });
        events.push(base(source, "tool.call", {
          tool_name: toolName,
          category,
          input: redactUnknown(input, defaultRedaction),
          target_paths: targetPaths
        }, {
          turn: turn(currentTurnId),
          actor: { role: "assistant", model: currentModel },
          links: { tool_call_id: callId },
          availability: { confidence: "partial", notes: ["Imported from Codex native function_call response item."] }
        }));
        continue;
      }
      if (payloadType === "function_call_output") {
        const callId = stringValue(payload?.call_id);
        const call = callId ? toolCallsById.get(callId) : undefined;
        const output = payload?.output;
        const metadata = toolResultMetadata(output);
        events.push(base(source, "tool.result", {
          tool_name: call?.toolName || "unknown",
          category: call?.category || "other",
          output: redactUnknown(output, defaultRedaction),
          status: inferToolStatus(output),
          ...metadata
        }, {
          turn: turn(currentTurnId),
          actor: { role: "tool", model: currentModel },
          links: { tool_call_id: stringValue(payload?.call_id) },
          availability: { confidence: "partial", notes: ["Imported from Codex native function_call_output response item."] }
        }));
        continue;
      }
      if (payloadType === "reasoning") {
        const summary = summaryText(payload?.summary);
        if (summary) {
          events.push(base(source, "message.assistant.internal", {
            summary,
            encrypted_content_present: typeof payload?.encrypted_content === "string"
          }, {
            turn: turn(currentTurnId),
            actor: { role: "assistant", model: currentModel },
            availability: { confidence: "partial", notes: ["Imported from Codex native reasoning summary; encrypted reasoning content was not exposed."] }
          }));
        }
      }
    }

    if (type === "compacted") {
      events.push(base(source, "compact.post", {
        summary: stringValue(payload?.summary),
        trigger: stringValue(payload?.trigger) || "unknown"
      }, {
        turn: turn(currentTurnId),
        actor: { role: "assistant", model: currentModel },
        availability: { confidence: "partial", notes: ["Imported from Codex native compacted record."] }
      }));
    }
  }

  if (!tokenSnapshotIndex && cumulativeFallbackToken) {
    const info = objectValue(cumulativeFallbackToken.payload.info);
    const usage = objectValue(info?.total_token_usage);
    if (usage) {
      events.push(base(cumulativeFallbackToken.source, "token.usage", {
        usage,
        usageConfidence: "provider-reported",
        usageKind: "final-cumulative",
        cumulativeUsage: usage,
        snapshotIndex: 1,
        model: currentModel,
        model_context_window: numberValue(info?.model_context_window)
      }, {
        turn: turn(currentTurnId),
        actor: { role: "assistant", model: currentModel },
        availability: { confidence: "partial", notes: ["Imported from Codex native cumulative token_count event; per-call usage was not exposed."] }
      }));
    }
  }

  if (options.inferredComplete && currentTurnId && !lastTurnEnded) {
    const source = records.at(-1);
    if (source) {
      events.push(base(source, "turn.end", {
        status: "completed",
        inferred: true,
        reason: "native transcript quiet for completion window"
      }, {
        turn: turn(currentTurnId),
        actor: { role: "assistant", model: currentModel },
        availability: { confidence: "inferred", notes: ["Inferred from native transcript quiet window."] }
      }));
    }
  }

  const endRecord = records.at(-1);
  if (endRecord && (options.completed || options.inferredComplete)) {
    events.push(base(endRecord, "conversation.end", {
      inferred: options.inferredComplete && !options.completed
    }, {
      actor: { role: "assistant", model: currentModel },
      availability: {
        confidence: options.completed ? "partial" : "inferred",
        notes: [options.completed ? "Imported from completed Codex native transcript." : "Inferred from native transcript quiet window."]
      }
    }));
  }

  return events;
}

/** Derives a token.usage event from a Codex token_count payload, deduplicating identical snapshots. */
function codexTokenUsageEvent(
  source: CodexNativeRecord,
  payload: Record<string, unknown>,
  options: {
    snapshotIndex: number;
    currentModel?: string;
    currentTurnId?: string;
    lastTokenUsageRaw?: string;
    base: (source: CodexNativeRecord, kind: UsageEventKind, data: unknown, extra?: Partial<UsageJsonlLineV1>) => UsageJsonlLineV1;
  }
): { event?: UsageJsonlLineV1; lastTokenUsageRaw?: string; cumulativeOnly?: boolean } {
  const info = objectValue(payload.info);
  const lastUsage = objectValue(info?.last_token_usage);
  const cumulativeUsage = objectValue(info?.total_token_usage);
  if (!lastUsage) return { cumulativeOnly: Boolean(cumulativeUsage), lastTokenUsageRaw: options.lastTokenUsageRaw };

  const raw = JSON.stringify(lastUsage);
  if (raw === options.lastTokenUsageRaw) return { lastTokenUsageRaw: options.lastTokenUsageRaw };

  return {
    lastTokenUsageRaw: raw,
    event: options.base(source, "token.usage", {
      usage: lastUsage,
      usageConfidence: "provider-reported",
      usageKind: "model-call",
      cumulativeUsage,
      snapshotIndex: options.snapshotIndex,
      model: options.currentModel,
      model_context_window: numberValue(info?.model_context_window)
    }, {
      turn: turn(options.currentTurnId),
      actor: { role: "assistant", model: options.currentModel },
      availability: { confidence: "partial", notes: ["Imported from Codex native token_count last_token_usage snapshot."] }
    })
  };
}

/** Extracts session-level metadata from the session_meta and turn_context records. */
function sessionInfo(records: CodexNativeRecord[]): {
  id?: string;
  cwd?: string;
  startedAt?: string;
  version?: string;
  source?: string;
  originator?: string;
  threadSource?: string;
  branch?: string;
  headSha?: string;
  model?: string;
} {
  const session = records.find((row) => stringValue(row.record.type) === "session_meta");
  const payload = objectValue(session?.record.payload);
  const turnContext = records.map((row) => objectValue(row.record.payload)).find((payload) => stringValue(payload?.model));
  const git = objectValue(payload?.git);
  return {
    id: stringValue(payload?.id),
    cwd: stringValue(payload?.cwd),
    startedAt: stringValue(payload?.timestamp) || stringValue(session?.record.timestamp),
    version: stringValue(payload?.cli_version),
    source: stringValue(payload?.source),
    originator: stringValue(payload?.originator),
    threadSource: stringValue(payload?.thread_source),
    branch: stringValue(git?.branch),
    headSha: stringValue(git?.commit_hash),
    model: stringValue(turnContext?.model)
  };
}

/** Computes a deterministic event ID from a source path, line number, event kind, and data payload. */
function deterministicEventId(sourcePath: string, line: number, kind: UsageEventKind, data: unknown): string {
  return `evt_native_${hash(`${sourcePath}:${line}:${kind}:${JSON.stringify(data)}`)}`;
}

/** Returns a 24-character hex SHA-256 digest of the given string. */
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

/** Returns the value as a plain object, or undefined if it is an array or non-object. */
function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Returns the value as a non-empty string, or undefined. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Returns the value as a number, or undefined if it is not a number. */
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Returns a turn object with the given id, or undefined if the id is absent. */
function turn(id: string | undefined): { id?: string } | undefined {
  return id ? { id } : undefined;
}

/** Generates a synthetic turn ID from a line number for records without an explicit turn ID. */
function syntheticTurnId(line: number): string {
  return `turn-line-${line}`;
}

/** Parses a JSON-encoded arguments string, returning the original value if it cannot be parsed. */
function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Maps a Codex tool name to a broad category string. */
function categorizeTool(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower === "exec_command" || lower === "bash" || lower.includes("shell")) return "command";
  if (lower.includes("apply_patch") || lower.includes("edit") || lower.includes("write")) return "write";
  if (lower.includes("read") || lower.includes("open") || lower.includes("view")) return "read";
  if (lower.includes("search") || lower.includes("rg") || lower.includes("grep")) return "search";
  return "other";
}

/** Extracts file path strings from a tool input object. */
function extractPaths(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return [record.path, record.file, record.filePath, record.workdir]
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Infers whether a tool call succeeded or failed from its output text. */
function inferToolStatus(output: unknown): "success" | "error" | "unknown" {
  if (typeof output !== "string") return "unknown";
  const match = /Process exited with code (\d+)/.exec(output);
  if (!match) return "unknown";
  return match[1] === "0" ? "success" : "error";
}

/** Computes character count, byte count, and truncation flag for a tool output value. */
function toolResultMetadata(output: unknown): Record<string, unknown> {
  const text = typeof output === "string" ? output : output === undefined || output === null ? "" : JSON.stringify(output);
  const bytes = Buffer.byteLength(text, "utf8");
  const truncation = /(?:tokens|characters|bytes) truncated|truncated[^\n]*output|omitted/i.test(text);
  return {
    output_chars: text.length,
    output_bytes: bytes,
    truncated: truncation
  };
}

/** Extracts plain text from a reasoning summary value, which may be a string or an array of blocks. */
function summaryText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const text = value.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return undefined;
    return stringValue((item as Record<string, unknown>).text) || stringValue((item as Record<string, unknown>).summary);
  }).filter(Boolean).join("\n");
  return text || undefined;
}
