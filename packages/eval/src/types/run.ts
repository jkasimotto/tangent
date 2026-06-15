import type { EvalAgentConfig } from "./provider.js";
import type { EvalContextMode } from "./context.js";
import type { EvalSpec } from "./spec.js";

export type EvalRunStatus = "prepared" | "running" | "done" | "failed" | "manual" | "cancelled";

export type EvalPhaseRunState = {
  id: "plan" | "implement";
  mode?: "read-only" | "workspace-write" | "danger-full-access";
  startedAt?: string;
  endedAt?: string;
  agentStartedAt?: string;
  agentEndedAt?: string;
  agentDurationMs?: number;
  status?: EvalRunStatus;
  outputPath?: string;
  promptPath?: string;
  commit?: string;
  error?: string;
};

export type EvalRunVariantState = {
  caseId: string;
  variantId: string;
  status: EvalRunStatus;
  branch: string;
  repoRoot: string;
  baseCommit: string;
  contextCommit?: string;
  planCommit?: string;
  implementationCommit?: string;
  workParent: string;
  worktree: string;
  executionCwd: string;
  promptPath: string;
  planPath?: string;
  metricsPath: string;
  context: EvalContextMode;
  agent: EvalAgentConfig;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  phases: EvalPhaseRunState[];
  warnings: string[];
};

export type EvalRunManifest = {
  schema: "eval.run.v1";
  id: string;
  name: string;
  createdAt: string;
  specPath?: string;
  spec?: EvalSpec;
  runDir: string;
  variants: EvalRunVariantState[];
};
