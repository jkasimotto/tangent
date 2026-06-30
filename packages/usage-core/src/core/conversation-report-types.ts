import type { UsageProvider } from "./schema/usage-jsonl-v1.js";

export type TokenUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreation?: number;
  total?: number;
  source: string;
  confidence: "provider-reported" | "derived" | "estimated" | "unknown";
};

export type NormalizedToolCall = {
  id: string;
  name: string;
  category: string;
  input?: unknown;
  plan?: string;
  result?: {
    status: "success" | "error" | "unknown";
    outputPreview?: string;
    durationMs?: number;
  };
  targetPaths: string[];
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
      thinking?: string;
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
