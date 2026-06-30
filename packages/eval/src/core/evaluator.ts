import { readFile } from "node:fs/promises";

import { gitText } from "@tangent/repo/git";

import type { EvalCriterion, EvalEvaluatorSpec } from "../types/spec.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import type { EvalEvaluation } from "../types/evaluation.js";
import type { EvalMetrics } from "../types/metrics.js";
import { resolveCriterionPoints } from "./config.js";
import { parseJudgeVerdict } from "./verdict.js";
import { formatTranscriptForJudge, reconstructVariantConversations } from "./transcript.js";
import { runJudge as defaultRunJudge } from "../runners/judge.js";

const DIFF_MAX_CHARS = 20000;

/**
 * Injectible dependencies for evaluateVariant. All three are optional; each defaults to the
 * real implementation so that tests can inject stubs without spawning real processes.
 */
export type EvaluateDeps = {
  reconstruct?: typeof reconstructVariantConversations;
  diff?: (variant: EvalRunVariantState) => Promise<string>;
  runJudge?: typeof defaultRunJudge;
};

/**
 * Builds the judge instruction prompt from a rubric, a diff, and a transcript.
 * Pure: no I/O, no side effects.
 */
export function composeJudgePrompt(args: {
  criteria: EvalCriterion[];
  diff: string;
  transcript: string;
}): string {
  const rubric = args.criteria
    .map((c, i) => `${i + 1}. [${c.id}] ${c.statement}`)
    .join("\n");

  const contract = `Respond ONLY with a JSON object in this exact shape, with no prose before or after it:
{
  "criteria": [
    { "id": "<criterion id>", "passed": true | false, "reasoning": "<one sentence>" }
  ]
}`;

  return [
    "You are a code-review judge. Score the agent's work against each criterion below.",
    "",
    "## Rubric",
    rubric,
    "",
    "## Output contract",
    contract,
    "",
    "## Diff",
    args.diff,
    "",
    "## Transcript",
    args.transcript
  ].join("\n");
}

/**
 * Reads the metrics.json for a variant, returning undefined when absent or malformed.
 * Mirrors the same small pattern used in metrics-read.ts without importing the server.
 */
async function readMetrics(variant: EvalRunVariantState): Promise<EvalMetrics | undefined> {
  try {
    const parsed = JSON.parse(await readFile(variant.metricsPath, "utf8")) as EvalMetrics;
    return parsed.schema === "eval.metrics.v1" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Builds a failed-criteria evaluation from the rubric when the judge cannot be reached. */
function failedEvaluation(
  variant: EvalRunVariantState,
  evaluator: EvalEvaluatorSpec,
  now: string,
  errorMessage: string
): EvalEvaluation {
  const criteria = evaluator.criteria.map((c) => ({
    id: c.id,
    statement: c.statement,
    points: resolveCriterionPoints(c.points),
    passed: false,
    reasoning: ""
  }));
  return {
    schema: "eval.evaluation.v1",
    caseId: variant.caseId,
    variantId: variant.variantId,
    model: evaluator.model,
    evaluatedAt: now,
    criteria,
    totalPoints: 0,
    maxPoints: criteria.reduce((sum, c) => sum + c.points, 0),
    warnings: [errorMessage]
  };
}

/**
 * Runs the judge model against a completed variant and returns a scored EvalEvaluation.
 * Never throws: any failure (git, reconstruct, judge) returns an evaluation with all criteria
 * failed and a warnings entry describing the error.
 */
export async function evaluateVariant(
  manifest: Pick<EvalRunManifest, "runDir">,
  variant: EvalRunVariantState,
  evaluator: EvalEvaluatorSpec,
  now: string,
  deps?: EvaluateDeps
): Promise<EvalEvaluation> {
  const reconstruct = deps?.reconstruct ?? reconstructVariantConversations;
  const getDiff = deps?.diff ?? ((v: EvalRunVariantState) =>
    gitText(v.worktree, ["diff", v.baseCommit, v.implementationCommit || "HEAD"])
  );
  const judge = deps?.runJudge ?? defaultRunJudge;

  try {
    const metrics = await readMetrics(variant);
    const conversationIds: Array<{ id: string }> = metrics?.conversations ?? [];

    const [{ conversations, notes }, rawDiff] = await Promise.all([
      reconstruct(variant, conversationIds),
      getDiff(variant)
    ]);

    const diff = rawDiff.length > DIFF_MAX_CHARS
      ? `${rawDiff.slice(0, DIFF_MAX_CHARS)}\n… [diff truncated]`
      : rawDiff;

    const transcript = formatTranscriptForJudge(conversations, variant.worktree);
    const prompt = composeJudgePrompt({ criteria: evaluator.criteria, diff, transcript });

    const rawVerdict = await judge({
      model: evaluator.model,
      prompt,
      cwd: manifest.runDir,
      env: process.env
    });

    const evaluation = parseJudgeVerdict(rawVerdict, {
      caseId: variant.caseId,
      variantId: variant.variantId,
      model: evaluator.model,
      criteria: evaluator.criteria,
      now
    });

    if (notes.length > 0) {
      evaluation.warnings.push(...notes);
    }

    return evaluation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedEvaluation(variant, evaluator, now, message);
  }
}
