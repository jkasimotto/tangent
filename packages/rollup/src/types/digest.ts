import type { RollupPeriod } from "./period.js";

export type EvidenceRef = {
  id?: string;
  eventId?: string;
  toolCallId?: string;
  file?: string;
  quote?: string;
  kind?: string;
};

export type RollupCandidate = {
  schema: "rollup.candidate.v1";
  sourceKey: string;
  provider: "claude" | "codex" | "gemini";
  conversationId: string;
  turnId: string;
  dateBucket: string;
  startedAt?: string;
  endedAt?: string;
  lastActivityAt: string;
  titlePreview?: string;
  sourceFingerprint: string;
  priorStatus?: "processed" | "failed" | "skipped-empty" | "skipped-active";
  reason: "new" | "changed" | "previously-failed" | "forced";
  stats: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    commandCalls: number;
    filesTouched: number;
  };
};

export type RollupInput = {
  schema: "rollup.input.v1";
  messageMode: "user-only";
  period: RollupPeriod;
  purpose?: RollupPurpose;
  timezone: string;
  repo: {
    name: string;
    rootHash: string;
    branch?: string;
  };
  source: {
    generatedAt: string;
    providers: Array<"claude" | "codex" | "gemini">;
    conversationIds: string[];
    sourceFiles: string[];
    caveats: string[];
  };
  examples: Array<{
    path: string;
    markdown: string;
  }>;
  conversations: RollupUserConversation[];
};

export type RollupUserConversation = {
  schema: "rollup.user-conversation.v1";
  provider: "claude" | "codex" | "gemini";
  conversationId: string;
  providerSessionId?: string;
  turnId: string;
  sourceKey: string;
  titlePreview?: string;
  startedAt?: string;
  endedAt?: string;
  lastActivityAt: string;
  messages: RollupUserMessage[];
};

export type RollupUserMessage = {
  id: string;
  role: "user";
  at?: string;
  text: string;
  confidence: string;
  source: "native" | "hook" | "best-effort";
};

export type RollupPurpose = {
  kind?: "daily-memory" | "design-brief" | "investigation-brief" | "decision-log" | "implementation-brief";
  request: string;
  title?: string;
  focusTerms: string[];
  audience?: "self" | "engineering-team" | "future-agent";
  outputPath?: string;
};

export type RollupOutput = {
  schema: "rollup.output.v1";
  markdown: string;
  sourceCaveats: string[];
};
