import type { NormalizedConversation } from "@tangent/usage";
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
  provider: "claude" | "codex";
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
    providers: Array<"claude" | "codex">;
    conversationIds: string[];
    sourceFiles: string[];
    caveats: string[];
  };
  examples: Array<{
    path: string;
    markdown: string;
  }>;
  conversations: NormalizedConversation[];
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
