// Turning token counts into a dollar figure, and keeping what the figure had
// to leave out attached to the figure.

import { isEmptyUsage, tokenCount } from "./token-usage.mjs";
import { rateFor, seededRates } from "./pricing-catalog.mjs";

// Claude Code adds a flat charge per web search and a 10% surcharge when
// inference was served from the United States, both after the token maths.
const WEB_SEARCH_USD_PER_REQUEST = 0.01;
const US_GEO_MULTIPLIER = 1.1;

/**
 * Prices one model's usage.
 *
 * Reasoning tokens are never added. Every provider that reports them already
 * counts them inside `output`, so charging them again would inflate the bill
 * by exactly the amount the model thought.
 */
export function priceUsage({ provider, model, usage, modifiers = {} }, rates = seededRates) {
  const entry = rateFor(provider, model, rates);
  if (!entry) return { provider, model, usage, modifiers, amount: null, priced: false, source: null };
  const applied = modifiers.fastMode && entry.fastMode ? { ...entry.rate, ...entry.fastMode } : entry.rate;
  const amount = perMillion(usage, applied) * (modifiers.usGeo ? US_GEO_MULTIPLIER : 1)
    + tokenCount(modifiers.webSearchRequests) * WEB_SEARCH_USD_PER_REQUEST;
  return { provider, model, usage, modifiers, amount, priced: true, source: entry.source };
}

/**
 * Adds up priced parts and keeps the exclusions attached to the total.
 *
 * A part that carried no tokens is not an exclusion. An unpriced model that
 * was never used cost nothing, and naming it would send the reader chasing a
 * gap that is not there.
 */
export function totalCost(parts) {
  let amount = 0;
  const unpriced = [];
  for (const part of parts) {
    if (part.priced && typeof part.amount === "number") amount += part.amount;
    else if (!isEmptyUsage(part.usage)) unpriced.push(`${part.provider || "unknown"}/${part.model || "unknown"}`);
  }
  return { amount, currency: "USD", complete: unpriced.length === 0, unpriced: [...new Set(unpriced)].sort(), parts: [...parts] };
}

/** The token maths itself, before any per-conversation modifier. */
function perMillion(usage, applied) {
  return (tokenCount(usage?.input) * applied.input
    + tokenCount(usage?.output) * applied.output
    + tokenCount(usage?.cacheRead) * applied.cacheRead
    + tokenCount(usage?.cacheWrite) * applied.cacheWrite
    + tokenCount(usage?.cacheWrite1h) * applied.cacheWrite1h) / 1_000_000;
}
