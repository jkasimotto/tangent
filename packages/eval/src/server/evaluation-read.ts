import { readFile } from "node:fs/promises";
import path from "node:path";

import type { EvalEvaluation } from "../types/evaluation.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import { variantDir } from "../core/run-store.js";
import type { EvalEvaluationView } from "./types.js";

/**
 * Reads evaluation.json for a variant and projects it into the UI view the compare endpoint serves.
 * Returns null when the file is absent (eval had no rubric or collection has not run yet). Drops
 * caseId, variantId, evaluatedAt, and schema; the caller already has the variant identity.
 */
export async function readVariantEvaluation(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<EvalEvaluationView | null> {
  const file = path.join(variantDir(manifest, variant.caseId, variant.variantId), "evaluation.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as EvalEvaluation;
    if (parsed.schema !== "eval.evaluation.v1") return null;
    return {
      model: parsed.model,
      totalPoints: parsed.totalPoints,
      maxPoints: parsed.maxPoints,
      criteria: parsed.criteria.map((criterion) => ({
        id: criterion.id,
        statement: criterion.statement,
        points: criterion.points,
        passed: criterion.passed,
        reasoning: criterion.reasoning
      })),
      warnings: parsed.warnings
    };
  } catch {
    return null;
  }
}
