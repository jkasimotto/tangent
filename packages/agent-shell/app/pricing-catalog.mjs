// What a million tokens costs, by provider and model.
//
// A rate is written in exactly two places. The seed below ships with Tangent
// so a fresh machine prices something rather than nothing, and the vault
// Document ~/.tangent/trees/pricing.md overrides it, so Julian can correct a
// rate without a rebuild and vault git records when the rate changed. The
// Document always wins (decision.md, decision 1).
//
// A model with no entry in either place is not guessed at. It comes back
// unpriced and the surface that shows the number names the model it could not
// price. That is the whole point of this file: Codex ships no price data at
// all, and inventing a number for it would be a confident wrong answer.
//
// These are API list prices. Under a subscription they measure the work a
// conversation did, not money that left an account.

import { fencedBlock } from "./launch-environment.mjs";

/** The pricing block tag the vault Document carries. */
export const PRICING_TAG = "tangent.pricing.v1";

/**
 * Builds one rate from the order the price lists print it:
 * input, output, cache write (5 minute), cache write (1 hour), cache read.
 * Every number is dollars for one million tokens.
 */
function rate(input, output, cacheWrite, cacheWrite1h, cacheRead) {
  return { input, output, cacheWrite, cacheWrite1h, cacheRead };
}

const ANTHROPIC = "Claude Code 2.1.258 baked price catalog, verified against recorded cost-state totals.";
const RESETDATA = "Julian's ResetData account rates, given 2026-09-02. The endpoint publishes no separate cache-write price, so writes bill at the input rate.";

/**
 * The shipped rates, most specific first. {@link rateFor} takes the first
 * match, so a dated or suffixed model id resolves to the family it belongs
 * to: `claude-opus-4-5-20260101` and `claude-opus-5[1m]` both find their
 * family. The `[1m]` long-context SKU bills at its family's rate, derived by
 * solving a recorded cost-state total (decision.md, decision 5).
 *
 * `provider` is the account that served the model, not the vendor that built
 * it: the same model id billed through a gateway bills at a different rate,
 * so a rate is only ever found when the provider matches too.
 */
export const seededRates = Object.freeze([
  // Anthropic. Opus 4.0 and 4.1 predate the price drop, so they are matched
  // before the general Opus 4 rule.
  { provider: "anthropic", match: /^claude-opus-4-[01]\b/, rate: rate(15, 75, 18.75, 30, 1.5), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-opus-4-[67]\b/, rate: rate(5, 25, 6.25, 10, 0.5), fastMode: { input: 30, output: 150 }, source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-opus-4-[58]\b/, rate: rate(5, 25, 6.25, 10, 0.5), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-opus-5\b/, rate: rate(5, 25, 6.25, 10, 0.5), fastMode: { input: 10, output: 50 }, source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-fable-5-1\b/, rate: rate(10, 50, 12.5, 20, 0.25), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-fable-5\b/, rate: rate(10, 50, 12.5, 20, 1), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-sonnet-5\b/, rate: rate(2, 10, 2.5, 4, 0.2), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-(3|sonnet-[34])/, rate: rate(3, 15, 3.75, 6, 0.3), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-haiku-4-5\b/, rate: rate(1, 5, 1.25, 2, 0.1), source: ANTHROPIC },

  // ResetData GLM, reached through pi-code. Julian gave input, cached and
  // output. No cache-write price is published for that endpoint.
  { provider: "resetdata-glm", match: /^zai\/glm-5\.2/, rate: rate(1.58, 4.96, 1.58, 1.58, 0.16), source: RESETDATA },

  // openai and litellm are deliberately absent. Codex publishes no rates and
  // this repository has none to seed, so codex work reports tokens and no
  // dollars until a rate is written into pricing.md.
]);

/** The five buckets a rate must name, in the order the price lists print them. */
const RATE_FIELDS = ["input", "output", "cacheWrite", "cacheWrite1h", "cacheRead"];

/**
 * Reads the `tangent.pricing.v1` block out of the pricing Document.
 *
 * Returns `{ rates }` on success, `{ error }` when the block is malformed,
 * and null when the text carries no pricing block at all. A malformed block
 * never silently prices at zero: the caller keeps the seed and shows the
 * error, which is how `parseHarnessRegistry` already behaves.
 */
export function parsePricingDocument(text) {
  const raw = fencedBlock(text, PRICING_TAG);
  if (raw === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { error: `pricing table is not valid JSON: ${error.message}` };
  }
  if (parsed.version !== 1) return { error: "pricing table needs version 1" };
  const providers = parsed.providers && typeof parsed.providers === "object" ? parsed.providers : null;
  if (!providers) return { error: "pricing table needs a providers object" };
  const rates = [];
  for (const [provider, entry] of Object.entries(providers)) {
    const models = entry?.models && typeof entry.models === "object" ? entry.models : {};
    for (const [model, declared] of Object.entries(models)) {
      const problem = rateProblem(provider, model, declared);
      if (problem) return { error: problem };
      if (declared === null) continue;
      rates.push({
        provider,
        model,
        match: prefixMatcher(model),
        rate: Object.fromEntries(RATE_FIELDS.map((field) => [field, Number(declared[field] ?? 0)])),
        ...(declared.fastMode ? { fastMode: { input: Number(declared.fastMode.input ?? 0), output: Number(declared.fastMode.output ?? 0) } } : {}),
        source: `~/.tangent/trees/pricing.md, ${provider}/${model}`,
      });
    }
  }
  // Longest model key first, so a specific SKU beats the family it sits in
  // however the Document happens to be ordered.
  rates.sort((left, right) => right.model.length - left.model.length);
  return { rates };
}

/** The first problem with one declared rate, or null when it is usable. */
function rateProblem(provider, model, declared) {
  if (declared === null) return null;
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) return `rate for ${provider}/${model} must be an object or null`;
  for (const field of RATE_FIELDS) {
    const value = declared[field];
    if (value === undefined || value === null) return `rate for ${provider}/${model} is missing ${field}; write null for the whole model when the rate is unknown`;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return `rate for ${provider}/${model} has a bad ${field}`;
  }
  return null;
}

/**
 * Matches a Document model key against a recorded model id by prefix.
 *
 * Harnesses record dated and suffixed ids (`claude-opus-4-5-20260101`,
 * `claude-opus-5[1m]`), so an exact key would price almost nothing. A prefix
 * with the longest key winning is the rule a person can hold in their head
 * while editing the Document by hand.
 */
function prefixMatcher(model) {
  const key = String(model).trim().toLowerCase();
  /** True when a recorded model id belongs to this Document entry. */
  const test = (candidate) => candidate.startsWith(key);
  return { test };
}

/**
 * Puts the Document's rates in front of the seeded ones.
 *
 * A Document entry that matches the same model as a seeded entry wins,
 * because it was written on purpose by the person who holds the account.
 */
export function mergeRates(documentRates = [], base = seededRates) {
  return [...documentRates, ...base];
}

/**
 * Finds the rate for one provider and model, or null when nothing prices it.
 *
 * The provider must match as well as the model: the same model id served
 * through a different account bills at a different rate, so pricing a gateway
 * model at the vendor's direct rate would be a confident wrong answer.
 */
export function rateFor(provider, model, rates = seededRates) {
  const providerId = String(provider ?? "").trim().toLowerCase();
  const modelId = String(model ?? "").trim().toLowerCase();
  if (!providerId || !modelId) return null;
  return rates.find((entry) => entry.provider.toLowerCase() === providerId && entry.match.test(modelId)) ?? null;
}
