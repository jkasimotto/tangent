import type { EvalMetrics } from "../types/metrics.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import type { EvalAgentConfig } from "../types/provider.js";
import type { EvalContextFile, EvalContextMode } from "../types/context.js";
import type { EvalPhaseSpec, EvalRepoSpec, EvalSpec, ResolvedEvalVariant } from "../types/spec.js";

export type EvalVariantSummary = {
  caseId: string;
  variantId: string;
  status: EvalRunVariantState["status"];
  branch: string;
  agent: EvalRunVariantState["agent"];
  summary: {
    tokensTotal?: number;
    wallTimeMs?: number;
    activeAgentTimeMs?: number;
    toolCalls: number;
    filesChanged: number;
    commandFailures: number;
  };
  artifacts: {
    promptPath: string;
    planPath?: string;
    implementationOutputPath?: string;
    metricsPath: string;
    worktree: string;
  };
  warnings: string[];
};

export type EvalRunListItem = {
  id: string;
  name: string;
  createdAt: string;
  runDir: string;
  variants: number;
  statuses: Record<string, number>;
};

export type EvalRunView = {
  run: EvalRunManifest;
  metrics: EvalMetrics[];
  cases: Array<{
    caseId: string;
    variants: EvalVariantSummary[];
  }>;
};

export type EvalSpecListItem = {
  id: string;
  name?: string;
  path: string;
  relativePath: string;
  caseCount?: number;
  variantCount?: number;
  error?: string;
};

export type EvalSpecView = {
  id: string;
  name?: string;
  path: string;
  relativePath: string;
  error?: string;
  spec?: EvalSpec;
  defaults?: EvalSpec["defaults"];
  cases: EvalSpecCaseView[];
};

export type EvalSpecCaseView = {
  caseId: string;
  promptPath: string;
  prompt: string;
  variants: EvalSpecVariantView[];
};

export type EvalSpecVariantView = {
  caseId: string;
  variantId: string;
  promptPath: string;
  repo: EvalRepoSpec;
  cwd: string;
  context: EvalContextView;
  agent: EvalAgentConfig;
  phases: ResolvedEvalVariant["phases"];
  rawPhases?: EvalPhaseSpec[];
};

export type EvalContextView = EvalContextMode & {
  files?: EvalContextFile[];
  error?: string;
};

export type EvalContextSnapshotView = {
  specId: string;
  caseId: string;
  variantId: string;
  ref: string;
  files: Array<EvalContextFile & { content: string }>;
  error?: string;
};

export type EvalUiJobStatus = "running" | "done" | "failed" | "cancelled";

export type EvalUiJobEvent = {
  seq: number;
  at: string;
  type: string;
  message?: string;
  runId?: string;
  caseId?: string;
  variantId?: string;
  phase?: "plan" | "implement";
  stream?: "stdout" | "stderr";
  chunk?: string;
};

export type EvalUiJobView = {
  id: string;
  specId: string;
  status: EvalUiJobStatus;
  startedAt: string;
  endedAt?: string;
  runId?: string;
  error?: string;
  eventCount: number;
};

export type EvalComparisonView = {
  runId: string;
  caseId: string;
  phase: "context" | "plan" | "impl" | "all";
  left: EvalVariantSummary;
  right: EvalVariantSummary;
  outputs: {
    leftImplementation?: string;
    rightImplementation?: string;
    leftPlan?: string;
    rightPlan?: string;
  };
  git: {
    leftCommit?: string;
    rightCommit?: string;
    comparisonDiff?: string;
    leftPatch?: string;
    rightPatch?: string;
    diffStat?: string;
    changedFiles: {
      left: string[];
      right: string[];
      shared: string[];
      onlyLeft: string[];
      onlyRight: string[];
    };
  };
  metricsDelta: {
    tokensTotal?: number;
    wallTimeMs?: number;
    activeAgentTimeMs?: number;
    toolCalls?: number;
    commandFailures?: number;
    filesChanged?: number;
  };
  warnings: string[];
};

export function variantSummary(variant: EvalRunVariantState, metrics?: EvalMetrics): EvalVariantSummary {
  const implPhase = variant.phases.find((phase) => phase.id === "implement");
  return {
    caseId: variant.caseId,
    variantId: variant.variantId,
    status: variant.status,
    branch: variant.branch,
    agent: variant.agent,
    summary: {
      tokensTotal: metrics?.tokens.total,
      wallTimeMs: metrics?.time.durationMs,
      activeAgentTimeMs: metrics?.time.activeAgentDurationMs,
      toolCalls: metrics?.tools.total || 0,
      filesChanged: metrics?.files.changed.length || 0,
      commandFailures: metrics?.commands.failures || 0
    },
    artifacts: {
      promptPath: variant.promptPath,
      planPath: variant.planPath,
      implementationOutputPath: implPhase?.outputPath,
      metricsPath: variant.metricsPath,
      worktree: variant.worktree
    },
    warnings: [...new Set([...(variant.warnings || []), ...(metrics?.warnings || [])])]
  };
}
