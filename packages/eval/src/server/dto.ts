import type { EvalMetrics } from "../types/metrics.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";

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
