import assert from "node:assert/strict";
import test from "node:test";

import { addUsage, emptyUsage, formatTokens, formatUsd, isEmptyUsage, promptTokens, totalTokens } from "./token-usage.mjs";
import { mergeRates, parsePricingDocument, rateFor, seededRates } from "./pricing-catalog.mjs";
import { priceUsage, totalCost } from "./token-pricing.mjs";

/** One usage record with the named buckets filled and the rest at zero. */
function usage(parts) {
  return addUsage(emptyUsage(), parts);
}

// Four `modelUsage` rows lifted verbatim from `cost-state` records in
// Julian's own transcripts, with the cost Claude Code itself recorded for
// them. These are the ground truth for the seeded Anthropic rates.
const RECORDED_LEDGER_ROWS = [
  { model: "claude-haiku-4-5-20251001", usage: { input: 1446, output: 16 }, recorded: 0.001526 },
  { model: "claude-sonnet-5", usage: { input: 142, output: 12_030, cacheRead: 1_702_459, cacheWrite1h: 55_423 }, recorded: 0.6827678 },
  { model: "claude-opus-5[1m]", usage: { input: 79_088, output: 82_092, cacheRead: 5_517_916, cacheWrite: 314_851 }, recorded: 7.17451675 },
  { model: "claude-fable-5-1", usage: { input: 3904, output: 77_241, cacheRead: 3_852_055, cacheWrite1h: 244_513 }, recorded: 9.75436375 },
];

test("the seeded Anthropic rates reproduce recorded cost-state totals to the last digit", () => {
  for (const row of RECORDED_LEDGER_ROWS) {
    const priced = priceUsage({ provider: "anthropic", model: row.model, usage: usage(row.usage) });
    assert.equal(priced.priced, true, `${row.model} has no seeded rate`);
    assert.equal(priced.amount, row.recorded, `${row.model} did not reproduce its recorded cost`);
  }
});

test("the [1m] long-context SKU bills at its family's rate, not at a doubled one", () => {
  // The claude-opus-5[1m] row above reproduces exactly at the plain Opus 5
  // rate. A separate long-context rate would be out by a whole factor.
  assert.equal(rateFor("anthropic", "claude-opus-5[1m]")?.rate.output, rateFor("anthropic", "claude-opus-5")?.rate.output);
});

test("a dated model id resolves to the family that prices it", () => {
  assert.equal(rateFor("anthropic", "claude-opus-4-5-20260101")?.rate.input, 5);
  // Opus 4.0 and 4.1 predate the price drop and must not fall into Opus 4.5.
  assert.equal(rateFor("anthropic", "claude-opus-4-1-20250805")?.rate.input, 15);
});

test("reasoning tokens are never billed, because output already contains them", () => {
  const withoutReasoning = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ output: 1_000_000 }) });
  const withReasoning = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ output: 1_000_000, reasoning: 900_000 }) });
  assert.equal(withReasoning.amount, withoutReasoning.amount);
  assert.equal(withReasoning.amount, 25);
});

test("fast mode and United States inference change the rate, not the token count", () => {
  const standard = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ input: 1_000_000 }) });
  const fast = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ input: 1_000_000 }), modifiers: { fastMode: true } });
  const us = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ input: 1_000_000 }), modifiers: { usGeo: true } });
  assert.equal(standard.amount, 5);
  assert.equal(fast.amount, 10);
  assert.equal(Number(us.amount.toFixed(6)), 5.5);
});

test("a web search bills per call and not per token", () => {
  const priced = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: emptyUsage(), modifiers: { webSearchRequests: 7 } });
  assert.equal(Number(priced.amount.toFixed(6)), 0.07);
});

test("the same model served by another provider is never priced at the vendor's rate", () => {
  assert.equal(rateFor("litellm", "claude-opus-5"), null);
  const priced = priceUsage({ provider: "litellm", model: "claude-opus-5", usage: usage({ output: 1_000_000 }) });
  assert.equal(priced.priced, false);
  assert.equal(priced.amount, null);
});

test("codex models are seeded with no rate at all, rather than a guessed one", () => {
  assert.equal(seededRates.some((entry) => entry.provider === "openai"), false);
  assert.equal(rateFor("openai", "gpt-5.6-sol"), null);
});

test("a total names the models it could not price and refuses to call itself complete", () => {
  const total = totalCost([
    priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ output: 1_000_000 }) }),
    priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: usage({ output: 500_000 }) }),
  ]);
  assert.equal(total.amount, 25);
  assert.equal(total.complete, false);
  assert.deepEqual(total.unpriced, ["openai/gpt-5.6-sol"]);
});

test("an unpriced model that carried no tokens is not reported as an exclusion", () => {
  const total = totalCost([priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: emptyUsage() })]);
  assert.deepEqual(total.unpriced, []);
  assert.equal(total.complete, true);
});

test("the pricing Document overrides a seeded rate and adds a model the seed has never seen", () => {
  const parsed = parsePricingDocument([
    "# Pricing", "",
    "```tangent.pricing.v1",
    JSON.stringify({
      version: 1,
      providers: {
        openai: { models: { "gpt-5.6-sol": { input: 1.25, output: 10, cacheWrite: 1.25, cacheWrite1h: 1.25, cacheRead: 0.125 } } },
        anthropic: { models: { "claude-opus-5": { input: 99, output: 99, cacheWrite: 99, cacheWrite1h: 99, cacheRead: 99 } } },
      },
    }, null, 2),
    "```",
  ].join("\n"));
  assert.equal(parsed.error, undefined);
  const rates = mergeRates(parsed.rates);
  assert.equal(priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: usage({ output: 1_000_000 }) }, rates).amount, 10);
  assert.equal(priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ output: 1_000_000 }) }, rates).amount, 99);
  // The seed still prices everything the Document did not mention.
  assert.equal(priceUsage({ provider: "anthropic", model: "claude-sonnet-5", usage: usage({ output: 1_000_000 }) }, rates).amount, 10);
});

test("the Document carries the fast-mode rate, because it replaces a seeded rate outright", () => {
  // The Document wins over the seed for a model it names, so a model whose
  // seeded rate has a fast-mode override must repeat that override here or
  // fast work silently bills at the standard rate.
  const parsed = parsePricingDocument([
    "```tangent.pricing.v1",
    JSON.stringify({
      version: 1,
      providers: { anthropic: { models: { "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5, fastMode: { input: 10, output: 50 } } } } },
    }, null, 2),
    "```",
  ].join("\n"));
  const rates = mergeRates(parsed.rates);
  const priced = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ input: 1_000_000, output: 1_000_000 }), modifiers: { fastMode: true } }, rates);
  assert.equal(priced.amount, 60);
  // The cache rates are untouched by fast mode; only input and output move.
  assert.equal(priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ cacheRead: 1_000_000 }), modifiers: { fastMode: true } }, rates).amount, 0.5);
});

test("the longest matching Document key wins, so a specific SKU beats its family", () => {
  const parsed = parsePricingDocument([
    "```tangent.pricing.v1",
    JSON.stringify({
      version: 1,
      providers: {
        zai: {
          models: {
            "glm-5.2": { input: 1, output: 1, cacheWrite: 1, cacheWrite1h: 1, cacheRead: 1 },
            "glm-5.2[1m]": { input: 2, output: 2, cacheWrite: 2, cacheWrite1h: 2, cacheRead: 2 },
          },
        },
      },
    }),
    "```",
  ].join("\n"));
  const rates = mergeRates(parsed.rates);
  assert.equal(priceUsage({ provider: "zai", model: "glm-5.2[1m]", usage: usage({ output: 1_000_000 }) }, rates).amount, 2);
  assert.equal(priceUsage({ provider: "zai", model: "glm-5.2", usage: usage({ output: 1_000_000 }) }, rates).amount, 1);
});

test("a model declared null in the Document stays unpriced instead of pricing at zero", () => {
  const parsed = parsePricingDocument(["```tangent.pricing.v1", JSON.stringify({ version: 1, providers: { openai: { models: { "gpt-5.6-sol": null } } } }), "```"].join("\n"));
  assert.deepEqual(parsed.rates, []);
  assert.equal(priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: usage({ output: 10 }) }, mergeRates(parsed.rates)).priced, false);
});

test("a malformed pricing Document reports the problem and never yields a zero rate", () => {
  assert.match(parsePricingDocument(["```tangent.pricing.v1", "{ not json", "```"].join("\n")).error, /not valid JSON/);
  assert.match(parsePricingDocument(["```tangent.pricing.v1", JSON.stringify({ version: 2, providers: {} }), "```"].join("\n")).error, /version 1/);
  const missing = parsePricingDocument(["```tangent.pricing.v1", JSON.stringify({ version: 1, providers: { openai: { models: { a: { input: 1 } } } } }), "```"].join("\n"));
  assert.match(missing.error, /missing output/);
  assert.equal(parsePricingDocument("# Pricing\n\nNo block here.\n"), null);
});

test("the usage shape adds, measures and reports the way every reader assumes", () => {
  const total = addUsage(usage({ input: 10, cacheRead: 5 }), { output: 3, cacheWrite: 2, reasoning: 1 });
  assert.equal(promptTokens(total), 17);
  assert.equal(totalTokens(total), 20);
  assert.equal(isEmptyUsage(emptyUsage()), true);
  assert.equal(isEmptyUsage(total), false);
  // A negative or absent count is read as zero rather than subtracting.
  assert.equal(addUsage(emptyUsage(), { input: -5, output: null }).input, 0);
});

test("a figure is written at the precision that carries information", () => {
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.0024), "$0.0024");
  assert.equal(formatUsd(4.567), "$4.57");
  assert.equal(formatUsd(388.1), "$388");
  assert.equal(formatUsd(null), "—");
  assert.equal(formatTokens(940), "940");
  assert.equal(formatTokens(46_400), "46k");
  assert.equal(formatTokens(1_240_000), "1.2M");
});
