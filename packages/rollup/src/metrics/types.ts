import type { ConversationUserMessage } from "@tangent/usage-index-sqlite";

/** A single user message judged to redirect, reject, or fix what the agent had done. */
export type CorrectionEvidence = {
  quote: string;
  why: string;
};

/** What the correction runner is asked to judge for one conversation: its ordered user messages. */
export type CorrectionRunnerInput = {
  conversationId: string;
  title?: string;
  userMessages: ConversationUserMessage[];
};

/** The runner's raw judgment for one conversation. */
export type CorrectionRunnerResult = {
  correctionCount: number;
  corrections: CorrectionEvidence[];
};

/** Runs a correction judgment over one conversation's user messages. Injectable for tests. */
export interface CorrectionRunner {
  analyze(input: CorrectionRunnerInput): Promise<CorrectionRunnerResult>;
}

/** Per-conversation correction metrics returned to the caller. */
export type ConversationMetrics = {
  conversationId: string;
  title?: string;
  /** "analyzed" ran the judge, "cached" reused an unchanged prior result, "failed" could not be judged. */
  status: "analyzed" | "cached" | "failed";
  correctionCount: number;
  corrections: CorrectionEvidence[];
  /** True when the user never had to correct the agent (zero corrections). */
  firstPass: boolean;
  error?: string;
};

/** The headline aggregate over the selected conversations. */
export type MetricsAggregate = {
  conversationsAnalyzed: number;
  totalCorrections: number;
  /** Share of successfully analyzed conversations with zero corrections. */
  firstPassRate: number;
};

export type MetricsRollupResult = {
  schema: "metrics.rollup.v1";
  perConversation: ConversationMetrics[];
  aggregate: MetricsAggregate;
};
