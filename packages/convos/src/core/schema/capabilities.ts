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
      conversations: { status: "supported", source: "native", notes: ["Claude native JSONL provides session records."] },
      "messages.visible": { status: "supported", source: "native", notes: ["User and assistant messages are available from native JSONL."] },
      "messages.internal": { status: "partial", source: "native", notes: ["Provider-exposed thinking/plans may be present; hidden reasoning is not reconstructed."] },
      "tools.calls": { status: "supported", source: "native", notes: ["Tool uses are available from native JSONL."] },
      "tools.results": { status: "supported", source: "native", notes: ["Tool results are available from native JSONL."] },
      "tokens.byConversation": { status: "supported", source: "native", notes: ["Assistant usage can be aggregated with message-id deduplication."] },
      "tokens.byModel": { status: "supported", source: "native", notes: ["Usage is model-scoped where exposed."] },
      "tokens.perToolCall": { status: "partial", source: "native", notes: ["Ordinary tool-call token causality is attribution, not exact causality."] },
      permissions: { status: "partial", source: "native", notes: ["Hooks improve permission fidelity when installed."] },
      subagents: { status: "partial", source: "native", notes: ["Subagent detail depends on native transcript content and hooks."] },
      compactions: { status: "partial", source: "native", notes: ["Compaction summaries may be present in native data or hooks."] }
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
