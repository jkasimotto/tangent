import type { RepoInfo } from "../core/repo.js";
import { conversationId, eventId } from "../core/ids.js";
import { previewText, redactUnknown, type RedactionOptions } from "../core/redaction.js";
import type {
  CaptureScope,
  ConvosEventKind,
  ConvosJsonlLineV1,
  ConvosProvider,
  TrackingSource
} from "../core/schema/convos-jsonl-v1.js";

type NormalizeContext = {
  provider: ConvosProvider;
  scope: CaptureScope;
  repo: RepoInfo;
  tracking: {
    enabled: boolean;
    source: TrackingSource;
  };
  redaction: RedactionOptions;
  convosVersion: string;
};

export function normalizeHookInput(input: Record<string, unknown>, context: NormalizeContext): ConvosJsonlLineV1[] {
  const providerSessionId = String(input.session_id || "unknown");
  const hookName = String(input.hook_event_name || "unknown");
  const now = new Date().toISOString();
  const base = {
    schema: "convos.event.v1" as const,
    recorded_at: now,
    provider: context.provider,
    capture: {
      source: "hook" as const,
      scope: context.scope,
      convos_version: context.convosVersion,
      provider_hook_event_name: hookName,
      content_mode: context.redaction.contentMode
    },
    repo: {
      root: context.repo.root,
      cwd: typeof input.cwd === "string" ? input.cwd : context.repo.cwd,
      git: {
        branch: context.repo.branch,
        head_sha: context.repo.headSha,
        origin_url_hash: context.repo.originUrlHash
      },
      tracking: context.tracking
    },
    conversation: {
      id: conversationId(context.provider, providerSessionId),
      provider_session_id: providerSessionId,
      transcript_path: typeof input.transcript_path === "string" ? input.transcript_path : null
    },
    native: {
      type: hookName,
      hook_event_name: hookName,
      raw: redactUnknown(input, context.redaction),
      raw_redacted: true
    }
  };

  const line = (kind: ConvosEventKind, data: unknown, extra: Partial<ConvosJsonlLineV1> = {}): ConvosJsonlLineV1 => ({
    ...base,
    event_id: eventId(),
    kind,
    data,
    availability: { confidence: "exact" },
    ...extra
  });

  switch (hookName) {
    case "SessionStart":
      return [line("conversation.start", { source: input.source }, actor(input))];
    case "UserPromptSubmit": {
      const text = typeof input.prompt === "string" ? input.prompt : undefined;
      return [
        line(
          "message.user",
          text
            ? { text, text_preview: previewText(text) }
            : { prompt: redactUnknown(input.prompt, context.redaction) },
          { turn: turn(input), actor: { role: "user", model: asString(input.model) } }
        )
      ];
    }
    case "PreToolUse":
      return [
        line(
          "tool.call",
          toolData(input, context.redaction, "input"),
          { turn: turn(input), actor: { role: "assistant", model: asString(input.model) }, links: { tool_call_id: asString(input.tool_use_id) } }
        )
      ];
    case "PostToolUse":
      return [
        line(
          "tool.result",
          toolData(input, context.redaction, "result"),
          { turn: turn(input), actor: { role: "tool", model: asString(input.model) }, links: { tool_call_id: asString(input.tool_use_id) } }
        )
      ];
    case "PermissionRequest":
      return [
        line(
          "permission.request",
          {
            tool_name: input.tool_name,
            tool_input: redactUnknown(input.tool_input, context.redaction),
            description: maybeDescription(input.tool_input)
          },
          { turn: turn(input), actor: { role: "assistant", model: asString(input.model) } }
        )
      ];
    case "PreCompact":
      return [line("compact.pre", { trigger: input.trigger }, { turn: turn(input), actor: actor(input).actor })];
    case "PostCompact":
      return [line("compact.post", { trigger: input.trigger }, { turn: turn(input), actor: actor(input).actor })];
    case "SubagentStart":
      return [
        line("subagent.start", { agent_id: input.agent_id, agent_type: input.agent_type }, {
          turn: turn(input),
          actor: { role: "subagent", model: asString(input.model), agent_id: asString(input.agent_id), agent_type: asString(input.agent_type) },
          links: { subagent_id: asString(input.agent_id) }
        })
      ];
    case "SubagentStop": {
      const last = typeof input.last_assistant_message === "string" ? input.last_assistant_message : undefined;
      const events = [
        line("subagent.stop", {
          agent_id: input.agent_id,
          agent_type: input.agent_type,
          agent_transcript_path: input.agent_transcript_path,
          stop_hook_active: input.stop_hook_active
        }, {
          turn: turn(input),
          actor: { role: "subagent", model: asString(input.model), agent_id: asString(input.agent_id), agent_type: asString(input.agent_type) },
          links: { subagent_id: asString(input.agent_id) }
        })
      ];
      if (last) {
        events.push(line("message.assistant.visible", { text: last, text_preview: previewText(last) }, {
          turn: turn(input),
          actor: { role: "assistant", model: asString(input.model), agent_id: asString(input.agent_id) },
          availability: { confidence: "partial", notes: ["Captured from SubagentStop.last_assistant_message."] }
        }));
      }
      return events;
    }
    case "Stop": {
      const last = typeof input.last_assistant_message === "string" ? input.last_assistant_message : undefined;
      const events = [line("conversation.end", { stop_hook_active: input.stop_hook_active }, { turn: turn(input), actor: actor(input).actor, availability: { confidence: "partial" } })];
      if (last) {
        events.push(line("message.assistant.visible", { text: last, text_preview: previewText(last) }, {
          turn: turn(input),
          actor: { role: "assistant", model: asString(input.model) },
          availability: { confidence: "partial", notes: ["Captured from Stop.last_assistant_message."] }
        }));
      }
      return events;
    }
    case "MessageDisplay": {
      const delta = typeof input.delta === "string" ? input.delta : undefined;
      return [
        line("message.assistant.visible", {
          delta,
          final: input.final,
          index: input.index
        }, {
          turn: turn(input),
          actor: { role: "assistant", model: asString(input.model) },
          links: { message_id: asString(input.message_id) }
        })
      ];
    }
    case "SessionEnd":
      return [line("conversation.end", {}, { actor: actor(input).actor })];
    default:
      return [line("unknown", redactUnknown(input, context.redaction), { availability: { confidence: "unknown" } })];
  }
}

function actor(input: Record<string, unknown>): Partial<ConvosJsonlLineV1> {
  return { actor: { role: "hook", model: asString(input.model) } };
}

function turn(input: Record<string, unknown>): { id?: string } | undefined {
  const id = asString(input.turn_id);
  return id ? { id } : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function maybeDescription(toolInput: unknown): string | null | undefined {
  if (toolInput && typeof toolInput === "object" && "description" in toolInput) {
    const value = (toolInput as { description?: unknown }).description;
    return typeof value === "string" || value == null ? value : undefined;
  }
  return undefined;
}

function toolData(input: Record<string, unknown>, redaction: RedactionOptions, mode: "input" | "result"): Record<string, unknown> {
  const toolName = String(input.tool_name || "unknown");
  const data: Record<string, unknown> = {
    tool_name: toolName,
    category: categorizeTool(toolName),
    target_paths: [],
    input: redactUnknown(input.tool_input, redaction)
  };
  if (mode === "result") {
    data.output = redactUnknown(input.tool_response, redaction);
    data.status = inferToolStatus(input.tool_response);
  }
  const command = commandText(toolName, input.tool_input);
  if (command) {
    data.command = {
      text: command,
      classification: {
        is_test: /\b(test|spec|jest|vitest|pytest|go test|cargo test)\b/i.test(command),
        is_build: /\b(build|tsc|webpack|vite build)\b/i.test(command),
        is_lint: /\b(lint|eslint|prettier|ruff)\b/i.test(command),
        is_destructive: /\b(rm\s+-rf|git\s+reset\s+--hard|drop\s+database|kubectl\s+delete)\b/i.test(command)
      }
    };
  }
  return data;
}

function categorizeTool(toolName: string): string {
  if (/bash|shell|exec/i.test(toolName)) return "command";
  if (/apply_patch|edit|write/i.test(toolName)) return "file_write";
  if (/read/i.test(toolName)) return "file_read";
  if (/search|grep|glob|rg/i.test(toolName)) return "file_search";
  if (/mcp/i.test(toolName)) return "mcp";
  if (/web/i.test(toolName)) return "web";
  return "other";
}

function commandText(toolName: string, toolInput: unknown): string | undefined {
  if (!/bash|shell|exec/i.test(toolName)) return undefined;
  if (toolInput && typeof toolInput === "object") {
    const command = (toolInput as { command?: unknown; cmd?: unknown }).command ?? (toolInput as { cmd?: unknown }).cmd;
    if (typeof command === "string") return command;
  }
  return undefined;
}

function inferToolStatus(toolResponse: unknown): "success" | "error" | "unknown" {
  if (toolResponse && typeof toolResponse === "object") {
    const record = toolResponse as Record<string, unknown>;
    if (record.error || record.is_error === true || record.exit_code) return "error";
    return "success";
  }
  return "unknown";
}
