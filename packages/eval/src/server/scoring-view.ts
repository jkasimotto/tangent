// The N-way scoring view: one case's criteria matrix across every variant in that case (not just a
// selected pair), for the Eval UI's Scoring section. Reuses the report model's discriminating-first sort
// (`buildScoringMatrix` in ../report/model.ts) rather than re-sorting criteria here, so the eval UI's
// scoring matrix and the report artifact's verdict matrix always agree on row order. See
// docs/superpowers/specs/2026-07-05-mark-loop-design.md, "The report artifact" and "N-way compare".

import { buildScoringMatrix, type ReportCriterion } from "../report/model.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import { readVariantEvaluation } from "./evaluation-read.js";

/** One variant column in the N-way scoring matrix. */
export type EvalScoringVariantColumn = {
  key: string;
  variantId: string;
  label: string;
  isBaseline: boolean;
  totalPoints?: number;
  maxPoints?: number;
};

/** The N-way scoring view for one case: every variant as a column, criteria as rows, baseline flagged. */
export type EvalScoringView = {
  caseId: string;
  baselineKey: string;
  variants: EvalScoringVariantColumn[];
  criteria: ReportCriterion[];
  warnings: string[];
};

/**
 * Builds the scoring matrix for every variant in `caseId`, across the whole run (not a selected pair).
 * The baseline is the variant named "baseline" if one exists in the case, else the first variant in
 * manifest order, matching the report model's baseline rule so the two surfaces never disagree.
 */
export async function scoringView(manifest: EvalRunManifest, caseId: string): Promise<EvalScoringView> {
  const variants = manifest.variants.filter((variant) => variant.caseId === caseId);
  if (variants.length === 0) {
    const error = new Error(`No variants found for case ${caseId}.`) as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  const evaluations = await Promise.all(variants.map((variant) => readVariantEvaluation(manifest, variant)));
  const warnings: string[] = [];
  evaluations.forEach((evaluation, index) => {
    if (!evaluation) warnings.push(`${variants[index]!.variantId}: no evaluation.json (no rubric scoring for this variant).`);
  });

  const baselineKey = keyOf(pickBaseline(variants));
  const criteria = buildScoringMatrix(variants.map((variant, index) => ({ key: keyOf(variant), evaluation: evaluations[index] ?? undefined })));

  return {
    caseId,
    baselineKey,
    variants: variants.map((variant, index) => ({
      key: keyOf(variant),
      variantId: variant.variantId,
      label: variant.variantId,
      isBaseline: keyOf(variant) === baselineKey,
      totalPoints: evaluations[index]?.totalPoints,
      maxPoints: evaluations[index]?.maxPoints
    })),
    criteria,
    warnings
  };
}

/** Picks the designated baseline variant: named "baseline" if present in the case, else the first. */
function pickBaseline(variants: EvalRunVariantState[]): EvalRunVariantState {
  return variants.find((variant) => variant.variantId === "baseline") ?? variants[0]!;
}

/** The join key shared with report-model's `variantKey`: `${caseId}::${variantId}`. */
function keyOf(variant: Pick<EvalRunVariantState, "caseId" | "variantId">): string {
  return `${variant.caseId}::${variant.variantId}`;
}
