// The report view-model: one shape assembled from a run's sidecars (run.json, each variant's
// metrics.json and evaluation.json) that both the markdown and the HTML renderer read from. Building
// the model once and rendering it twice keeps the two artifacts in agreement and keeps the renderers
// themselves free of file I/O. See docs/superpowers/specs/2026-07-05-mark-loop-design.md, "The report
// artifact (what a reviewer sees)".

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { EvalEvaluation } from "../types/evaluation.js";
import type { EvalMetrics } from "../types/metrics.js";
import type { EvalRunManifest, EvalRunStatus, EvalRunVariantState } from "../types/run.js";
import { variantDir } from "../core/run-store.js";
import type { ConversationView } from "../server/conversation-view.js";
import type { EvalDiffLineView } from "../server/types.js";

/** A variant's metrics, projected to only the fields the report shows. */
export type ReportVariantMetrics = {
  status: EvalRunStatus;
  durationMs?: number;
  tokensTotal?: number;
  toolCallsTotal?: number;
  toolCallsByCategory: Record<string, number>;
};

/** A variant's judge scoring, projected to only the fields the report shows. */
export type ReportVariantEvaluation = {
  model: string;
  passCount: number;
  criteriaTotal: number;
  totalPoints: number;
  maxPoints: number;
};

/** How one non-baseline variant compares to the designated baseline. Undefined fields mean the underlying pair was not comparable (one side missing that sidecar). */
export type ReportVariantDelta = {
  durationMs?: number;
  tokensTotal?: number;
  toolCallsTotal?: number;
  passCount?: number;
};

/** One variant row in the report: identity, metrics, scoring, and its delta against the baseline. */
export type ReportVariant = {
  caseId: string;
  variantId: string;
  /** Stable join key (`${caseId}::${variantId}`) used to match this variant across criteria cells, transcripts, and context diffs. */
  key: string;
  /** Display label: `variantId` alone for a single-case run, `caseId/variantId` when the run has more than one case. */
  label: string;
  isBaseline: boolean;
  /** Absent when metrics.json could not be read; the renderers must label this absent, never fabricate a zero. */
  metrics?: ReportVariantMetrics;
  /** Absent when evaluation.json could not be read, e.g. the eval defines no evaluator or collection has not scored it yet. */
  evaluation?: ReportVariantEvaluation;
  delta?: ReportVariantDelta;
};

/** One variant's verdict for one criterion. `passed` is undefined when that variant has no evaluation data for this criterion, which the renderers must show as absent, not as a failure. */
export type ReportCriterionCell = {
  variantKey: string;
  passed?: boolean;
  reasoning?: string;
};

/** One rubric criterion as a row across all variants. */
export type ReportCriterion = {
  id: string;
  statement: string;
  /** True when at least two variants have a known verdict for this criterion and they disagree. Drives the discriminating-first sort. */
  discriminating: boolean;
  cells: ReportCriterionCell[];
};

/** One variant's reconstructed conversations, for the HTML report's transcript drill-down. */
export type ReportTranscript = {
  variantKey: string;
  conversations: ConversationView[];
  notes: string[];
};

/** One context file that differs between the baseline and another variant. */
export type ReportContextDiffFile = {
  path: string;
  status: "added" | "removed" | "changed";
  /** Line-level diff, when both sides' content could be read. Absent for a binary or unreadable file; the status is still meaningful. */
  lines?: EvalDiffLineView[];
};

/** The context files that differ between the baseline and one other variant. */
export type ReportContextDiff = {
  variantKey: string;
  files: ReportContextDiffFile[];
};

/** The task header: what the run was proving, and where it came from. */
export type ReportTask = {
  summary: string;
  repoRoot?: string;
  branch?: string;
  /** The originating mark id, when the eval spec was scaffolded via `tangent mark to-eval`. */
  markId?: string;
};

/** The full report view-model. Markdown reads header, task, variants, and criteria; HTML also reads transcripts and contextDiffs when present. */
export type ReportModel = {
  runId: string;
  runName: string;
  createdAt: string;
  task: ReportTask;
  baselineKey: string;
  variants: ReportVariant[];
  criteria: ReportCriterion[];
  /** Sidecar-read problems surfaced to the reader instead of silently dropped, e.g. "variant X has no evaluation.json". */
  warnings: string[];
  transcripts?: ReportTranscript[];
  contextDiffs?: ReportContextDiff[];
};

/** One variant's sidecar data, already read from disk (or supplied directly by a test). */
export type ReportVariantSidecars = {
  variant: EvalRunVariantState;
  metrics?: EvalMetrics;
  evaluation?: EvalEvaluation;
};

/** Options controlling which optional, I/O-heavy sections `loadReportModel` populates. */
export type LoadReportModelOptions = {
  /** Reconstruct and attach per-variant conversation transcripts (the HTML report's drill-down). */
  includeTranscripts?: boolean;
  /** Compute and attach the context-file diff between the baseline and each other variant (the HTML report's drill-down). */
  includeContextDiff?: boolean;
};

/**
 * Builds the report view-model from already-loaded sidecar data. Pure: no file or git I/O, so tests can
 * exercise the sorting, baseline-selection, and delta rules with plain fixture objects. `loadReportModel`
 * is the I/O-performing counterpart that reads the sidecars off disk and calls this.
 */
export function buildReportModel(args: {
  manifest: Pick<EvalRunManifest, "id" | "name" | "createdAt" | "spec">;
  sidecars: ReportVariantSidecars[];
  taskSummary: string;
}): ReportModel {
  const warnings: string[] = [];
  const singleCase = new Set(args.sidecars.map((row) => row.variant.caseId)).size <= 1;
  const variants = args.sidecars.map((row) => projectVariant(row, singleCase, warnings));
  const baselineKey = selectBaselineKey(args.sidecars);
  applyDeltas(variants, baselineKey);

  const criteriaIds = collectCriterionIds(args.manifest, args.sidecars);
  const criteria = criteriaIds.map((id) => buildCriterionRow(id, args.sidecars));
  sortDiscriminatingFirst(criteria);

  const baselineVariant = args.sidecars.find((row) => variantKey(row.variant) === baselineKey)?.variant;
  return {
    runId: args.manifest.id,
    runName: args.manifest.name,
    createdAt: args.manifest.createdAt,
    task: {
      summary: args.taskSummary,
      repoRoot: baselineVariant?.repoRoot,
      branch: baselineVariant?.branch,
      markId: args.manifest.spec?.markId
    },
    baselineKey,
    variants,
    criteria,
    warnings
  };
}

/** Loads a run's sidecars from disk and builds the report model. The only async, file-reading entry point in this module. */
export async function loadReportModel(
  manifest: EvalRunManifest,
  options: LoadReportModelOptions = {}
): Promise<ReportModel> {
  const sidecars: ReportVariantSidecars[] = [];
  for (const variant of manifest.variants) {
    const metrics = await readVariantMetrics(manifest, variant);
    const evaluation = await readVariantEvaluation(manifest, variant);
    sidecars.push({ variant, metrics, evaluation });
  }
  const taskSummary = await resolveTaskSummary(manifest, sidecars);
  const model = buildReportModel({ manifest, sidecars, taskSummary });

  if (options.includeTranscripts) {
    const { loadReportTranscripts } = await import("./transcripts.js");
    model.transcripts = await loadReportTranscripts(sidecars);
  }
  if (options.includeContextDiff) {
    const { loadReportContextDiffs } = await import("./context-diff.js");
    model.contextDiffs = await loadReportContextDiffs(sidecars, model.baselineKey);
  }
  return model;
}

/** Builds the `${caseId}::${variantId}` join key shared by variants, criteria cells, transcripts, and context diffs. */
export function variantKey(variant: Pick<EvalRunVariantState, "caseId" | "variantId">): string {
  return `${variant.caseId}::${variant.variantId}`;
}

/** Projects one variant's sidecars into its report row, recording a warning when evaluation.json is absent. */
function projectVariant(row: ReportVariantSidecars, singleCase: boolean, warnings: string[]): ReportVariant {
  const key = variantKey(row.variant);
  const label = singleCase ? row.variant.variantId : `${row.variant.caseId}/${row.variant.variantId}`;
  if (!row.evaluation) warnings.push(`${label}: no evaluation.json (no rubric scoring for this variant).`);
  if (!row.metrics) warnings.push(`${label}: no metrics.json (no collected metrics for this variant).`);
  return {
    caseId: row.variant.caseId,
    variantId: row.variant.variantId,
    key,
    label,
    isBaseline: false,
    metrics: row.metrics && projectMetrics(row.metrics),
    evaluation: row.evaluation && projectEvaluation(row.evaluation)
  };
}

/** Projects raw metrics.json down to the fields the report shows. */
function projectMetrics(metrics: EvalMetrics): ReportVariantMetrics {
  return {
    status: metrics.status,
    durationMs: metrics.time.durationMs,
    tokensTotal: metrics.tokens.total,
    toolCallsTotal: metrics.tools.total,
    toolCallsByCategory: metrics.tools.byCategory
  };
}

/** Projects raw evaluation.json down to the fields the report shows. */
function projectEvaluation(evaluation: EvalEvaluation): ReportVariantEvaluation {
  return {
    model: evaluation.model,
    passCount: evaluation.criteria.filter((criterion) => criterion.passed).length,
    criteriaTotal: evaluation.criteria.length,
    totalPoints: evaluation.totalPoints,
    maxPoints: evaluation.maxPoints
  };
}

/** Picks the designated baseline: the variant named "baseline" if one exists, else the first variant in manifest order. */
function selectBaselineKey(sidecars: ReportVariantSidecars[]): string {
  const named = sidecars.find((row) => row.variant.variantId === "baseline");
  const chosen = named ?? sidecars[0];
  if (!chosen) throw new Error("Cannot build a report for a run with no variants.");
  return variantKey(chosen.variant);
}

/** Marks the baseline row and fills in every other row's delta against it, when both sides have the relevant sidecar. */
function applyDeltas(variants: ReportVariant[], baselineKey: string): void {
  const baseline = variants.find((variant) => variant.key === baselineKey);
  for (const variant of variants) {
    if (variant.key === baselineKey) {
      variant.isBaseline = true;
      continue;
    }
    if (!baseline) continue;
    variant.delta = {
      durationMs: numericDelta(variant.metrics?.durationMs, baseline.metrics?.durationMs),
      tokensTotal: numericDelta(variant.metrics?.tokensTotal, baseline.metrics?.tokensTotal),
      toolCallsTotal: numericDelta(variant.metrics?.toolCallsTotal, baseline.metrics?.toolCallsTotal),
      passCount: numericDelta(variant.evaluation?.passCount, baseline.evaluation?.passCount)
    };
  }
}

/** Returns `value - base`, or undefined when either side is missing. */
function numericDelta(value: number | undefined, base: number | undefined): number | undefined {
  if (value === undefined || base === undefined) return undefined;
  return value - base;
}

/**
 * The subset of `EvalEvaluation` the criteria-matrix builders need: any evaluation-shaped object works,
 * whether it is a raw sidecar (`EvalEvaluation`) or a server-projected view (`EvalEvaluationView`), so a
 * caller with only the latter (e.g. the scoring endpoint, which already has UI-view evaluations in hand
 * from `readVariantEvaluation`) can still reuse this matrix logic without reshaping its data.
 */
export type EvaluationLike = { criteria: Array<{ id: string; statement: string; passed: boolean; reasoning: string }> };

/** One column's identity and evaluation for `buildScoringMatrix`, keyed the same way as `ReportCriterionCell`. */
export type ScoringMatrixEntry = { key: string; evaluation?: EvaluationLike };

/**
 * Builds criteria rows across an arbitrary number of evaluation columns (N variants, not just baseline vs.
 * one other), sorted discriminating-first. This is the same matrix `buildReportModel` builds for the report
 * artifact, generalized to take bare `{key, evaluation}` entries instead of full run sidecars, so the eval
 * server's N-way scoring endpoint (`server/scoring-view.ts`) can reuse it without constructing a fake
 * `EvalRunManifest`/`EvalRunVariantState` just to satisfy `ReportVariantSidecars`.
 */
export function buildScoringMatrix(entries: ScoringMatrixEntry[]): ReportCriterion[] {
  const criteria = criterionIdsFromEntries(entries).map((id) => criterionRowFromEntries(id, entries));
  sortDiscriminatingFirst(criteria);
  return criteria;
}

/**
 * Lists criterion ids in a stable order: from the spec's evaluator when the manifest still carries one,
 * else the first-seen order across every variant's evaluation.json (a fallback for a run whose manifest
 * was persisted before the spec was embedded, or was loaded from a bare run id).
 */
function collectCriterionIds(manifest: Pick<EvalRunManifest, "spec">, sidecars: ReportVariantSidecars[]): string[] {
  const fromSpec = manifest.spec?.evaluator?.criteria?.map((criterion) => criterion.id);
  if (fromSpec && fromSpec.length > 0) return fromSpec;
  return criterionIdsFromEntries(sidecars.map((row) => ({ key: variantKey(row.variant), evaluation: row.evaluation })));
}

/** First-seen criterion id order across a set of evaluation entries. */
function criterionIdsFromEntries(entries: ScoringMatrixEntry[]): string[] {
  const seen: string[] = [];
  const known = new Set<string>();
  for (const entry of entries) {
    for (const criterion of entry.evaluation?.criteria ?? []) {
      if (known.has(criterion.id)) continue;
      known.add(criterion.id);
      seen.push(criterion.id);
    }
  }
  return seen;
}

/** Builds one criterion's row: its statement (from whichever variant recorded it) and its per-variant cells. */
function buildCriterionRow(id: string, sidecars: ReportVariantSidecars[]): ReportCriterion {
  return criterionRowFromEntries(id, sidecars.map((row) => ({ key: variantKey(row.variant), evaluation: row.evaluation })));
}

/** Builds one criterion's row from bare `{key, evaluation}` entries, the shared core of `buildCriterionRow` and `buildScoringMatrix`. */
function criterionRowFromEntries(id: string, entries: ScoringMatrixEntry[]): ReportCriterion {
  const cells: ReportCriterionCell[] = entries.map((entry) => {
    const verdict = entry.evaluation?.criteria.find((criterion) => criterion.id === id);
    return { variantKey: entry.key, passed: verdict?.passed, reasoning: verdict?.reasoning };
  });
  const statement = entries
    .flatMap((entry) => entry.evaluation?.criteria ?? [])
    .find((criterion) => criterion.id === id)?.statement ?? id;
  return { id, statement, discriminating: isDiscriminating(cells), cells };
}

/** True when at least two variants have a known verdict for a criterion and those verdicts disagree. */
function isDiscriminating(cells: ReportCriterionCell[]): boolean {
  const known = cells.map((cell) => cell.passed).filter((passed): passed is boolean => passed !== undefined);
  return known.length >= 2 && known.some((passed) => passed !== known[0]);
}

/** Stable-sorts criteria so discriminating rows float to the top; ties keep their original relative order (Array.sort is stable in Node). */
function sortDiscriminatingFirst(criteria: ReportCriterion[]): void {
  criteria.sort((a, b) => Number(b.discriminating) - Number(a.discriminating));
}

/** Reads a variant's metrics.json, returning undefined when it is absent or malformed. Duplicates the small pattern also used in core/evaluator.ts and server/*-read.ts, which each read this same sidecar without a shared helper. */
async function readVariantMetrics(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<EvalMetrics | undefined> {
  const file = path.join(variantDir(manifest, variant.caseId, variant.variantId), "metrics.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as EvalMetrics;
    return parsed.schema === "eval.metrics.v1" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a variant's evaluation.json, returning undefined when it is absent or malformed. */
async function readVariantEvaluation(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<EvalEvaluation | undefined> {
  const file = path.join(variantDir(manifest, variant.caseId, variant.variantId), "evaluation.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as EvalEvaluation;
    return parsed.schema === "eval.evaluation.v1" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the one-line task summary the header shows: the case's own prompt text when the manifest
 * still carries the spec, else the first line of the baseline variant's prompt file on disk. Falls back
 * to a generic label rather than throwing, since a report must still render for a run whose prompt file
 * has since been removed.
 */
async function resolveTaskSummary(manifest: EvalRunManifest, sidecars: ReportVariantSidecars[]): Promise<string> {
  const firstCaseId = sidecars[0]?.variant.caseId;
  const fromSpec = manifest.spec?.cases.find((testCase) => testCase.id === firstCaseId)?.prompt;
  if (fromSpec) return firstLine(fromSpec);

  const promptPath = sidecars[0]?.variant.promptPath;
  if (promptPath) {
    try {
      return firstLine(await readFile(promptPath, "utf8"));
    } catch {
      // Fall through to the generic label below.
    }
  }
  return manifest.name;
}

/** Returns the first non-empty line of a text block, trimmed. */
function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0);
  return line ? line.trim() : text.trim();
}
