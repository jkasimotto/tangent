import type { ConvosProvider, ProviderSupport } from "./convos-jsonl-v1.js";

export type CapabilityKey =
  | "conversations"
  | "messages.visible"
  | "messages.internal"
  | "tools.calls"
  | "tools.results"
  | "tokens.byConversation"
  | "tokens.byModel"
  | "tokens.perToolCall"
  | "permissions"
  | "subagents"
  | "compactions";

export type ProviderCapabilities = Record<CapabilityKey, ProviderSupport>;

export function capabilitiesForProvider(provider: ConvosProvider): ProviderCapabilities {
  if (provider === "claude") {
    return {
      conversations: { status: "supported", source: "hook", notes: ["Hooks provide session start/end lifecycle records."] },
      "messages.visible": { status: "partial", source: "hook", notes: ["User prompts are exact; assistant text is final visible output from Stop/SubagentStop when provided."] },
      "messages.internal": { status: "unsupported", source: "hook", notes: ["Hidden reasoning is not captured from hooks."] },
      "tools.calls": { status: "supported", source: "hook", notes: ["PreToolUse captures documented tool calls."] },
      "tools.results": { status: "supported", source: "hook", notes: ["PostToolUse captures documented tool results and duration when provided."] },
      "tokens.byConversation": { status: "unsupported", source: "hook", notes: ["Hooks do not expose token usage by default."] },
      "tokens.byModel": { status: "unsupported", source: "hook", notes: ["Hooks do not expose token usage by default."] },
      "tokens.perToolCall": { status: "unsupported", source: "hook", notes: ["Hooks do not expose token usage by default."] },
      permissions: { status: "supported", source: "hook", notes: ["PermissionRequest hooks provide structured request data."] },
      subagents: { status: "partial", source: "hook", notes: ["Hooks expose lifecycle and optional final visible message."] },
      compactions: { status: "partial", source: "hook", notes: ["PreCompact/PostCompact expose compaction lifecycle and summaries when provided."] }
    };
  }

  return {
    conversations: { status: "supported", source: "hook", notes: ["Exact start and partial end are captured from hooks."] },
    "messages.visible": { status: "partial", source: "hook", notes: ["User prompts are exact; assistant text is partial from Stop.last_assistant_message unless transcript import is used."] },
    "messages.internal": { status: "unsupported", source: "hook", notes: ["Codex hooks do not expose internal reasoning or planning messages."] },
    "tools.calls": { status: "partial", source: "hook", notes: ["Hooks cover Bash, apply_patch, and MCP tool calls."] },
    "tools.results": { status: "partial", source: "hook", notes: ["Hooks cover Bash, apply_patch, and MCP tool results."] },
    "tokens.byConversation": { status: "unsupported", source: "hook", notes: ["Codex hooks do not expose token usage."] },
    "tokens.byModel": { status: "unsupported", source: "hook", notes: ["Codex hooks do not expose token usage."] },
    "tokens.perToolCall": { status: "unsupported", source: "hook", notes: ["Codex hooks do not expose token usage."] },
    permissions: { status: "supported", source: "hook", notes: ["PermissionRequest hooks provide structured request data."] },
    subagents: { status: "partial", source: "hook", notes: ["Hooks expose lifecycle only."] },
    compactions: { status: "partial", source: "hook", notes: ["Hooks expose pre/post compaction lifecycle only."] }
  };
}
