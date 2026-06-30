import type { EvalAgentConfig } from "../types/provider.js";
import type { EvalContextMode } from "../types/context.js";
import type { EvalRunStatus } from "../types/run.js";

export type EvalRunSummaryView = {
  id: string;
  name: string;
  createdAt: string;
  runDir: string;
  specPath?: string;
  variantCount: number;
  caseCount: number;
  statuses: Record<EvalRunStatus, number>;
};

export type EvalCompareArtifactKind = "prompt" | "context" | "code";

export type EvalCompareArtifactStatus = "same" | "changed" | "left-only" | "right-only";

export type EvalSparklineKind = "assistant" | "tool" | "command" | "file" | "unknown";

export type EvalSparklineBucket = {
  kind: EvalSparklineKind;
  tokenShare: number;
  durationShare: number;
};

export type EvalSparkline = {
  durationMs: number;
  tokensTotal?: number;
  buckets: EvalSparklineBucket[];
};

export type EvalEvaluationView = {
  model: string;
  totalPoints: number;
  maxPoints: number;
  criteria: Array<{ id: string; statement: string; points: number; passed: boolean; reasoning: string }>;
  warnings: string[];
};

export type EvalVariantMetricsView = {
  durationMs?: number;
  activeAgentDurationMs?: number;
  tokensTotal?: number;
  /** Cache-read tokens (the cheap, dominant share of tokensTotal); shown so the big token count reads honestly. */
  cachedTokens?: number;
  /** Estimated USD spend, weighting each token bucket by its real price. Undefined when a model has no known rate. */
  costUsd?: number;
  peakContextTokens?: number;
  filesChanged: number;
  filesRead: number;
  diffStat?: string;
  conversationIds: string[];
  sparkline?: EvalSparkline;
};

export type EvalSpecSummaryView = {
  path: string;
  name: string;
  caseCount: number;
  variantCount: number;
};

export type EvalLaunchResultView = {
  runId: string;
};

export type EvalCompareArtifactView = {
  id: string;
  kind: EvalCompareArtifactKind;
  path: string;
  label: string;
  status?: EvalCompareArtifactStatus;
  /** For code artifacts: whether the left/right variant's agent changed this file (context -> implementation). */
  changedLeft?: boolean;
  changedRight?: boolean;
  /** For code artifacts: added/removed line counts from the agent's own change (context -> implementation). Undefined when not a changed code file or when binary. */
  addedLeft?: number;
  removedLeft?: number;
  addedRight?: number;
  removedRight?: number;
};

export type EvalVariantPhaseView = {
  id: "plan" | "implement";
  status?: EvalRunStatus;
  agentDurationMs?: number;
};

export type EvalVariantSummaryView = {
  caseId: string;
  variantId: string;
  label: string;
  status: EvalRunStatus;
  agent: EvalAgentConfig;
  model?: string;
  context: EvalContextMode;
  branch: string;
  worktree: string;
  executionCwd: string;
  baseCommit: string;
  contextCommit?: string;
  startedAt?: string;
  endedAt?: string;
  phases: EvalVariantPhaseView[];
  error?: string;
  promptArtifacts: EvalCompareArtifactView[];
  metrics?: EvalVariantMetricsView | null;
  evaluation?: EvalEvaluationView | null;
  warnings: string[];
};

export type EvalSpecPromptView = {
  id: string;
  label: string;
  path: string;
  content: string;
};

export type EvalSpecPromptsView = {
  specPath: string;
  name: string;
  prompts: EvalSpecPromptView[];
};

export type EvalCaseView = {
  id: string;
  variants: EvalVariantSummaryView[];
};

export type EvalRunDetailView = EvalRunSummaryView & {
  cases: EvalCaseView[];
};

export type EvalCompareView = {
  run: EvalRunSummaryView;
  caseId: string;
  left: EvalVariantSummaryView;
  right: EvalVariantSummaryView;
  artifacts: EvalCompareArtifactView[];
};

export type EvalDiffLineView = {
  kind: "equal" | "changed" | "add" | "delete";
  leftNumber?: number;
  rightNumber?: number;
  left?: string;
  right?: string;
};

export type EvalDiffView = {
  artifact: EvalCompareArtifactView;
  left: { variantId: string; label: string };
  right: { variantId: string; label: string };
  lines: EvalDiffLineView[];
};
