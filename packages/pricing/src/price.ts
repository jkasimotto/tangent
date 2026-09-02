// Turning token counts into a dollar figure, and saying what the figure left out.

import { builtInRates, rateFor, type RateEntry, type TokenRate } from "./catalog.js";
import { isEmptyUsage, type TokenUsage } from "./usage.js";

/**
 * The per-conversation facts that change a rate rather than the token count.
 *
 * `usGeo` is Claude Code's 10% surcharge on inference served from the United
 * States, applied after the token maths. `webSearchRequests` bills per call,
 * not per token.
 */
export type PriceModifiers = {
  fastMode?: boolean;
  usGeo?: boolean;
  webSearchRequests?: number;
};

/** What one call to a model, or a whole conversation on one model, cost. */
export type PricedUsage = {
  provider: string;
  model: string;
  usage: TokenUsage;
  /** USD, or null when nothing prices this provider and model. */
  amount: number | null;
  priced: boolean;
  /** Where the rate came from, for a reader who asks how the number was reached. */
  source: string | null;
};

/** A total, and everything the total had to leave out to be honest. */
export type PricedTotal = {
  amount: number;
  currency: "USD";
  /** True only when every part that carried tokens was priced. */
  complete: boolean;
  /** `provider/model` for each part that carried tokens and had no rate. */
  unpriced: string[];
  parts: PricedUsage[];
};

const WEB_SEARCH_USD_PER_REQUEST = 0.01;
const US_GEO_MULTIPLIER = 1.1;

/**
 * Prices one model's usage.
 *
 * Reasoning tokens are never added: every provider that reports them already
 * counts them inside `output`, so charging them again would inflate the bill
 * by the exact amount the model thought.
 */
export function priceUsage(
  { provider, model, usage, modifiers = {} }: { provider: string; model: string; usage: TokenUsage; modifiers?: PriceModifiers },
  rates: readonly RateEntry[] = builtInRates,
): PricedUsage {
  const entry = rateFor(provider, model, rates);
  if (!entry) return { provider, model, usage, amount: null, priced: false, source: null };
  const applied = modifiers.fastMode && entry.fastMode ? { ...entry.rate, ...entry.fastMode } : entry.rate;
  const amount = perMillion(usage, applied) * (modifiers.usGeo ? US_GEO_MULTIPLIER : 1)
    + Math.max(0, modifiers.webSearchRequests ?? 0) * WEB_SEARCH_USD_PER_REQUEST;
  return { provider, model, usage, amount, priced: true, source: entry.source };
}

/**
 * Adds up priced parts and keeps the exclusions attached to the total.
 *
 * A part that carried no tokens is not an exclusion: an unpriced model that
 * was never used cost nothing, and naming it would make the reader chase a
 * gap that is not there.
 */
export function totalCost(parts: readonly PricedUsage[]): PricedTotal {
  let amount = 0;
  const unpriced: string[] = [];
  for (const part of parts) {
    if (part.priced && typeof part.amount === "number") amount += part.amount;
    else if (!isEmptyUsage(part.usage)) unpriced.push(`${part.provider || "unknown"}/${part.model || "unknown"}`);
  }
  return { amount, currency: "USD", complete: unpriced.length === 0, unpriced: [...new Set(unpriced)].sort(), parts: [...parts] };
}

/** The token maths itself, before any per-conversation modifier. */
function perMillion(usage: TokenUsage, applied: TokenRate): number {
  return (usage.input * applied.input
    + usage.output * applied.output
    + usage.cacheRead * applied.cacheRead
    + usage.cacheWrite * applied.cacheWrite
    + usage.cacheWrite1h * applied.cacheWrite1h) / 1_000_000;
}
