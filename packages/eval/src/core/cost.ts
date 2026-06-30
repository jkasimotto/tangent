import type { EvalMetrics } from "../types/metrics.js";

/**
 * Why this exists: the raw token total (`tokens.total`) sums cache reads at full weight, so a
 * cache-heavy run reports millions of tokens that cost almost nothing. To give the Eval UI a figure
 * that tracks actual spend, weight each token bucket by its real price. Cache reads bill at ~0.1x the
 * input rate and cache writes at ~1.25x (5-minute ephemeral, which coding agents use), so the dollar
 * estimate is a tiny fraction of the headline token count on a run dominated by cache reads.
 */

type ModelRate = { match: RegExp; inputPerMTok: number; outputPerMTok: number };

/**
 * Published Claude per-MTok rates (input / output), ordered so the most specific family matches first.
 * Keyed by a substring of the model id (`claude-haiku-4-5-20251001`, `claude-opus-4-8`, ...) so both
 * aliases and dated snapshots resolve. Unknown models (e.g. Codex/GPT) get no rate, leaving cost
 * undefined rather than guessing.
 */
const MODEL_RATES: ModelRate[] = [
  { match: /fable-5|mythos/, inputPerMTok: 10, outputPerMTok: 50 },
  { match: /haiku-4-5/, inputPerMTok: 1, outputPerMTok: 5 },
  { match: /sonnet-4-[56]/, inputPerMTok: 3, outputPerMTok: 15 },
  { match: /opus-4/, inputPerMTok: 5, outputPerMTok: 25 }
];

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Resolves the rate entry for a model id by substring match, or undefined when no family matches. */
function rateFor(model: string): ModelRate | undefined {
  return MODEL_RATES.find((rate) => rate.match.test(model));
}

export type EvalCostEstimate = {
  /** Total cache-read tokens across every model: the cheap, dominant share of the raw token total. */
  cachedTokens: number;
  /** Estimated USD spend, or undefined when any model with token usage has no known rate (a partial figure would mislead). */
  costUsd?: number;
};

/** Estimates dollar spend from per-model token usage, weighting each bucket by its real price so cache-heavy runs are not overcounted. */
export function estimateCost(tokens: EvalMetrics["tokens"]): EvalCostEstimate {
  let cachedTokens = 0;
  let costUsd = 0;
  let allPriced = true;
  for (const row of tokens.byModel) {
    cachedTokens += row.cacheRead || 0;
    const used = (row.input || 0) + (row.output || 0) + (row.cacheRead || 0) + (row.cacheCreation || 0);
    if (used === 0) continue;
    const rate = rateFor(row.model);
    if (!rate) {
      allPriced = false;
      continue;
    }
    costUsd +=
      ((row.input || 0) * rate.inputPerMTok +
        (row.cacheCreation || 0) * rate.inputPerMTok * CACHE_WRITE_MULTIPLIER +
        (row.cacheRead || 0) * rate.inputPerMTok * CACHE_READ_MULTIPLIER +
        (row.output || 0) * rate.outputPerMTok) /
      1_000_000;
  }
  return { cachedTokens, costUsd: allPriced ? costUsd : undefined };
}
