import type { UsageProvider } from "./schema/usage-jsonl-v1.js";

export type TokenUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreation?: number;
  total?: number;
  source: string;
  confidence: "provider-reported" | "derived" | "allocated" | "estimated" | "unknown";
};

export type ToolTokenAttribution = {
  exact: false;
  allocatedOutput?: number;
  allocatedInput?: number;
  nextInputDelta?: number;
  nextInputTotal?: number;
  nextInputCached?: number;
  nextModelCallEventId?: string;
  resultEstimatedTokens?: number;
  resultOutputChars?: number;
  resultOutputBytes?: number;
  originalTokenCount?: number;
  truncated?: boolean;
  allocationMethod?: "proportional_serialized_tool_use_bytes" | "proportional_tool_result_tokens" | "single_tool_result" | "equal_split" | "none";
  sourceAssistantMessageId: string;
  source: string;
  confidence: "allocated" | "estimated" | "unknown";
  notes: string[];
};

export type NormalizedToolCall = {
  id: string;
  name: string;
  category: string;
  input?: unknown;
  result?: {
    status: "success" | "error" | "unknown";
    outputPreview?: string;
    durationMs?: number;
  };
  targetPaths: string[];
  tokens: ToolTokenAttribution;
  evidenceEventIds: string[];
};

export type NormalizedConversationMessage =
  | {
      id: string;
      role: "user";
      at?: string;
      text: string;
      confidence: "exact" | "partial" | "best-effort";
    }
  | {
      id: string;
      role: "assistant";
      at?: string;
      model?: string;
      text: string;
      tokens?: TokenUsage;
      toolCalls: NormalizedToolCall[];
      confidence: "exact" | "partial" | "best-effort";
    };

export type NormalizedConversation = {
  schema: "usage.conversation.v1";
  provider: UsageProvider;
  conversationId: string;
  providerSessionId?: string;
  transcriptPath?: string;
  repo?: {
    root?: string;
    cwd?: string;
    branch?: string;
  };
  startedAt?: string;
  endedAt?: string;
  messages: NormalizedConversationMessage[];
  totals: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    tokens?: TokenUsage;
  };
  caveats: string[];
};
