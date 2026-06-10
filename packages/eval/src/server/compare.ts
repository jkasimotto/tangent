import { readFile } from "node:fs/promises";
import { gitRaw } from "@tangent/repo/git";

import type { EvalMetrics } from "../types/metrics.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import { findVariant } from "../core/run-store.js";
import { variantSummary, type EvalComparisonView } from "./dto.js";

export async function buildComparisonView(args: {
  manifest: EvalRunManifest;
  metrics: EvalMetrics[];
  caseId: string;
  left: string;
  right: string;
  phase: "context" | "plan" | "impl" | "all";
}): Promise<EvalComparisonView> {
  const leftVariant = findVariant(args.manifest, args.left, args.caseId);
  const rightVariant = findVariant(args.manifest, args.right, args.caseId);
  const leftMetrics = metricFor(args.metrics, leftVariant);
  const rightMetrics = metricFor(args.metrics, rightVariant);
  const left = variantSummary(leftVariant, leftMetrics);
  const right = variantSummary(rightVariant, rightMetrics);
  const leftFiles = leftMetrics?.files.changed || [];
  const rightFiles = rightMetrics?.files.changed || [];
  return {
    runId: args.manifest.id,
    caseId: args.caseId,
    phase: args.phase,
    left,
    right,
    outputs: {
      leftImplementation: await readOptional(left.artifacts.implementationOutputPath),
      rightImplementation: await readOptional(right.artifacts.implementationOutputPath),
      leftPlan: await readOptional(left.artifacts.planPath),
      rightPlan: await readOptional(right.artifacts.planPath)
    },
    git: {
      leftCommit: endCommit(leftVariant),
      rightCommit: endCommit(rightVariant),
      comparisonDiff: await comparisonDiff(leftVariant, rightVariant, args.phase),
      leftPatch: await variantPatch(leftVariant, args.phase),
      rightPatch: await variantPatch(rightVariant, args.phase),
      diffStat: [leftMetrics?.git.diffStat, rightMetrics?.git.diffStat].filter(Boolean).join("\n\n") || undefined,
      changedFiles: {
        left: leftFiles,
        right: rightFiles,
        shared: leftFiles.filter((file) => rightFiles.includes(file)),
        onlyLeft: leftFiles.filter((file) => !rightFiles.includes(file)),
        onlyRight: rightFiles.filter((file) => !leftFiles.includes(file))
      }
    },
    metricsDelta: {
      tokensTotal: delta(left.summary.tokensTotal, right.summary.tokensTotal),
      wallTimeMs: delta(left.summary.wallTimeMs, right.summary.wallTimeMs),
      activeAgentTimeMs: delta(left.summary.activeAgentTimeMs, right.summary.activeAgentTimeMs),
      toolCalls: delta(left.summary.toolCalls, right.summary.toolCalls),
      commandFailures: delta(left.summary.commandFailures, right.summary.commandFailures),
      filesChanged: delta(left.summary.filesChanged, right.summary.filesChanged)
    },
    warnings: [...new Set([...left.warnings, ...right.warnings])]
  };
}

function metricFor(metrics: EvalMetrics[], variant: EvalRunVariantState): EvalMetrics | undefined {
  return metrics.find((metric) => metric.caseId === variant.caseId && metric.variantId === variant.variantId);
}

async function readOptional(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  return readFile(filePath, "utf8").catch(() => undefined);
}

async function comparisonDiff(a: EvalRunVariantState, b: EvalRunVariantState, phase: EvalComparisonView["phase"]): Promise<string | undefined> {
  try {
    if (phase === "all") return await gitRaw(a.worktree, ["diff", endCommit(a), endCommit(b)]);
    if (phase === "context") return await gitRaw(a.worktree, ["range-diff", `${a.baseCommit}..${a.contextCommit || a.baseCommit}`, `${b.baseCommit}..${b.contextCommit || b.baseCommit}`]);
    if (phase === "plan") return await gitRaw(a.worktree, ["range-diff", `${a.contextCommit || a.baseCommit}..${a.planCommit || a.contextCommit || a.baseCommit}`, `${b.contextCommit || b.baseCommit}..${b.planCommit || b.contextCommit || b.baseCommit}`]);
    return await gitRaw(a.worktree, ["range-diff", `${a.planCommit || a.contextCommit || a.baseCommit}..${a.implementationCommit || endCommit(a)}`, `${b.planCommit || b.contextCommit || b.baseCommit}..${b.implementationCommit || endCommit(b)}`]);
  } catch (error) {
    return `diff unavailable: ${(error as Error).message}`;
  }
}

async function variantPatch(variant: EvalRunVariantState, phase: EvalComparisonView["phase"]): Promise<string | undefined> {
  const [from, to] = phaseRange(variant, phase);
  if (from === to) return "";
  return gitRaw(variant.worktree, ["diff", `${from}..${to}`]).catch((error) => `diff unavailable: ${(error as Error).message}`);
}

function phaseRange(variant: EvalRunVariantState, phase: EvalComparisonView["phase"]): [string, string] {
  if (phase === "context") return [variant.baseCommit, variant.contextCommit || variant.baseCommit];
  if (phase === "plan") return [variant.contextCommit || variant.baseCommit, variant.planCommit || variant.contextCommit || variant.baseCommit];
  if (phase === "impl") return [variant.planCommit || variant.contextCommit || variant.baseCommit, variant.implementationCommit || endCommit(variant)];
  return [variant.baseCommit, endCommit(variant)];
}

function endCommit(variant: EvalRunVariantState): string {
  return variant.implementationCommit || variant.planCommit || variant.contextCommit || variant.baseCommit;
}

function delta(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined || right === undefined) return undefined;
  return right - left;
}
