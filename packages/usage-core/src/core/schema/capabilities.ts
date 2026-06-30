import type { UsageProvider, ProviderSupport } from "./usage-jsonl-v1.js";

export type CapabilityKey =
  | "conversations"
  | "messages.visible"
  | "messages.internal"
  | "tools.calls"
  | "tools.results"
  | "tokens.byConversation"
  | "tokens.byModel"
  | "permissions"
  | "subagents"
  | "compactions";

export type ProviderCapabilities = Record<CapabilityKey, ProviderSupport>;

/** Returns the capability map for a given provider, describing what data each query supports. */
export function capabilitiesForProvider(provider: UsageProvider): ProviderCapabilities {
  if (provider === "claude") {
    return {
      conversations: { status: "supported", source: "native", notes: ["Native Claude Code transcripts provide session records and quiet-window completion inference."] },
      "messages.visible": { status: "supported", source: "native", notes: ["Native Claude Code transcripts include user and assistant visible message content."] },
      "messages.internal": { status: "unsupported", source: "native", notes: ["Hidden reasoning is not exposed from native transcripts."] },
      "tools.calls": { status: "partial", source: "native", notes: ["Native Claude Code assistant messages expose tool_use content when present."] },
      "tools.results": { status: "partial", source: "native", notes: ["Native Claude Code user messages expose tool_result content when present."] },
      "tokens.byConversation": { status: "supported", source: "native", notes: ["Native Claude Code assistant messages include provider-reported usage fields when present."] },
      "tokens.byModel": { status: "supported", source: "native", notes: ["Native Claude Code assistant messages include provider-reported usage fields when present."] },
      permissions: { status: "partial", source: "native", notes: ["Permission mode records may appear in native transcripts, but request decisions are not normalized yet."] },
      subagents: { status: "partial", source: "native", notes: ["Sidechain and agent records are present in native transcripts and parsed permissively."] },
      compactions: { status: "partial", source: "native", notes: ["Native transcript summary records may expose compaction-like state."] }
    };
  }

  if (provider === "gemini") {
    return {
      conversations: { status: "supported", source: "native", notes: ["Native Gemini CLI chat session files include a session header and quiet-window completion inference."] },
      "messages.visible": { status: "supported", source: "native", notes: ["Native Gemini CLI sessions include user and gemini visible message content."] },
      "messages.internal": { status: "supported", source: "native", notes: ["Native Gemini CLI messages expose reasoning thought summaries (subject and description), folded into the assistant message's thinking."] },
      "tools.calls": { status: "supported", source: "native", notes: ["Native Gemini CLI messages carry toolCalls with name and args."] },
      "tools.results": { status: "supported", source: "native", notes: ["Native Gemini CLI toolCalls carry their result inline."] },
      "tokens.byConversation": { status: "supported", source: "native", notes: ["Native Gemini CLI messages include provider-reported token counts (input, output, thoughts, cached)."] },
      "tokens.byModel": { status: "supported", source: "native", notes: ["Native Gemini CLI messages record the model alongside provider-reported token counts."] },
      permissions: { status: "unsupported", source: "native", notes: ["Permission decisions are not present in native Gemini CLI session files."] },
      subagents: { status: "unsupported", source: "native", notes: ["Subagent activity is not distinguished in native Gemini CLI session files."] },
      compactions: { status: "unsupported", source: "native", notes: ["Compaction state is not present in native Gemini CLI session files."] }
    };
  }

  return {
    conversations: { status: "supported", source: "native", notes: ["Native Codex rollout transcripts include session and task lifecycle records."] },
    "messages.visible": { status: "supported", source: "native", notes: ["Native Codex rollout transcripts include user_message and agent_message events."] },
    "messages.internal": { status: "partial", source: "native", notes: ["Only safe reasoning summaries are exposed; encrypted reasoning content is not exposed."] },
    "tools.calls": { status: "supported", source: "native", notes: ["Native Codex response_item records include function_call tool calls."] },
    "tools.results": { status: "supported", source: "native", notes: ["Native Codex response_item records include function_call_output tool results."] },
    "tokens.byConversation": { status: "supported", source: "native", notes: ["Native Codex token_count records include provider-reported per-model-call usage snapshots."] },
    "tokens.byModel": { status: "supported", source: "native", notes: ["Native Codex token_count records include provider-reported per-model-call usage snapshots."] },
    permissions: { status: "partial", source: "native", notes: ["Permission context may appear in native records, but request decisions are not normalized yet."] },
    subagents: { status: "partial", source: "native", notes: ["Subagent activity may appear as native tool calls or transcript records."] },
    compactions: { status: "partial", source: "native", notes: ["Native compacted records expose compaction summaries when present."] }
  };
}
