import type { EvalCriterion } from "../types/spec.js";
import type { EvalEvaluation, EvalCriterionVerdict } from "../types/evaluation.js";
import { resolveCriterionPoints } from "./config.js";

type JudgeCtx = { caseId: string; variantId: string; model: string; criteria: EvalCriterion[]; now: string };

/** Maps a judge model's free text to a scored evaluation. Tolerates prose and code fences around the JSON; never throws. */
export function parseJudgeVerdict(rawText: string, ctx: JudgeCtx): EvalEvaluation {
  const warnings: string[] = [];
  const byId = extractVerdictMap(rawText, warnings);
  const criteria: EvalCriterionVerdict[] = ctx.criteria.map((criterion) => {
    const points = resolveCriterionPoints(criterion.points);
    const found = byId.get(criterion.id);
    if (!found) warnings.push(`Judge did not return a verdict for criterion ${criterion.id}; scored as not passed.`);
    return {
      id: criterion.id,
      statement: criterion.statement,
      points,
      passed: Boolean(found?.passed),
      reasoning: typeof found?.reasoning === "string" ? found.reasoning : ""
    };
  });
  return {
    schema: "eval.evaluation.v1",
    caseId: ctx.caseId,
    variantId: ctx.variantId,
    model: ctx.model,
    evaluatedAt: ctx.now,
    criteria,
    totalPoints: criteria.reduce((sum, c) => sum + (c.passed ? c.points : 0), 0),
    maxPoints: criteria.reduce((sum, c) => sum + c.points, 0),
    warnings
  };
}

/** Pulls the first JSON object/array out of model text and indexes its criteria verdicts by id. */
function extractVerdictMap(rawText: string, warnings: string[]): Map<string, { passed?: boolean; reasoning?: unknown }> {
  const map = new Map();
  const json = firstJsonBlock(rawText);
  if (!json) { warnings.push("Judge output contained no parseable JSON; all criteria scored as not passed."); return map; }
  let parsed;
  try { parsed = JSON.parse(json); } catch { warnings.push("Judge JSON failed to parse; all criteria scored as not passed."); return map; }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.criteria) ? parsed.criteria : [];
  for (const row of list) {
    if (row && typeof row.id === "string") map.set(row.id, { passed: row.passed === true, reasoning: row.reasoning });
  }
  if (map.size === 0) warnings.push("Judge JSON had no recognizable criteria verdicts.");
  return map;
}

/** Returns the substring spanning the first balanced {...} or [...] in the text, or undefined. Skips characters inside double-quoted strings so a delimiter inside a reasoning value does not truncate the block. */
function firstJsonBlock(text: string): string | undefined {
  const start = text.search(/[\[{]/);
  if (start < 0) return undefined;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === '"') inString = false;
    } else {
      if (ch === '"') { inString = true; continue; }
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}
