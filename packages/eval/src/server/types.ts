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

export type EvalCompareArtifactKind = "prompt" | "context";

export type EvalCompareArtifactStatus = "same" | "changed" | "left-only" | "right-only";

export type EvalCompareArtifactView = {
  id: string;
  kind: EvalCompareArtifactKind;
  path: string;
  label: string;
  status?: EvalCompareArtifactStatus;
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
  promptArtifacts: EvalCompareArtifactView[];
  warnings: string[];
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
