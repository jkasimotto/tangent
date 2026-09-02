import assert from "node:assert/strict";
import { test } from "node:test";

import { addUsage, emptyUsage, formatUsd, mergeRates, priceUsage, rateFor, sumUsage, totalCost } from "../dist/index.js";

/** Builds one usage record from the buckets a test cares about. */
function usage(fields) {
  return { ...emptyUsage(), ...fields };
}

/**
 * Real `cost-state` totals from Julian's transcripts, 2026-09-02. Claude Code
 * computes these locally and they are the only independent check on the rate
 * catalog. `cacheCreationInputTokens` in a cost-state record is one sum over
 * both cache-write buckets, so the bucket each session actually used was
 * recovered by solving for the rate that reproduces the recorded cost, and is
 * stated here.
 */
const recorded = [
  {
    name: "haiku 4.5, no cache",
    model: "claude-haiku-4-5-20251001",
    usage: usage({ input: 1539, output: 17 }),
    costUsd: 0.001624,
  },
  {
    name: "fable 5, one-hour cache writes",
    model: "claude-fable-5",
    usage: usage({ input: 536, output: 23182, cacheRead: 1730774, cacheWrite1h: 127344 }),
    costUsd: 5.442114,
  },
  {
    name: "opus 5, one-hour cache writes",
    model: "claude-opus-5",
    usage: usage({ input: 104, output: 27770, cacheRead: 5711723, cacheWrite1h: 132787 }),
    costUsd: 4.878501500000001,
  },
  {
    name: "sonnet 5, five-minute cache writes",
    model: "claude-sonnet-5",
    usage: usage({ input: 242842, output: 283421, cacheRead: 26230293, cacheWrite: 1268434 }),
    costUsd: 11.737037599999997,
  },
  {
    name: "haiku 4.5, five-minute cache writes",
    model: "claude-haiku-4-5-20251001",
    usage: usage({ input: 59770, output: 59592, cacheRead: 1263384, cacheWrite: 221618 }),
    costUsd: 0.7610909000000001,
  },
];

for (const record of recorded) {
  test(`prices ${record.name} to the recorded total`, () => {
    const priced = priceUsage({ provider: "anthropic", model: record.model, usage: record.usage });
    assert.equal(priced.priced, true);
    assert.ok(Math.abs(priced.amount - record.costUsd) < 1e-9, `${priced.amount} is not ${record.costUsd}`);
  });
}

test("reasoning tokens are never billed twice", () => {
  const withThinking = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ output: 27770, reasoning: 11929 }) });
  const without = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ output: 27770 }) });
  assert.equal(withThinking.amount, without.amount);
});

test("fast mode changes only the models that have a fast rate", () => {
  const normal = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ input: 1_000_000 }) });
  const fast = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ input: 1_000_000 }), modifiers: { fastMode: true } });
  assert.equal(normal.amount, 5);
  assert.equal(fast.amount, 10);
  const sonnet = priceUsage({ provider: "anthropic", model: "claude-sonnet-5", usage: usage({ input: 1_000_000 }), modifiers: { fastMode: true } });
  assert.equal(sonnet.amount, 2);
});

test("United States inference adds ten percent and web search bills per request", () => {
  const geo = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ input: 1_000_000 }), modifiers: { usGeo: true } });
  assert.ok(Math.abs(geo.amount - 5.5) < 1e-9);
  const search = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({}), modifiers: { webSearchRequests: 3 } });
  assert.ok(Math.abs(search.amount - 0.03) < 1e-9);
});

test("the ResetData GLM rate comes from the account holder's own numbers", () => {
  const priced = priceUsage({ provider: "resetdata-glm", model: "zai/glm-5.2", usage: usage({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000 }) });
  assert.ok(Math.abs(priced.amount - (1.58 + 4.96 + 0.16)) < 1e-9);
});

test("a model with no rate stays unpriced instead of being guessed at", () => {
  const priced = priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: usage({ input: 1_000_000 }) });
  assert.equal(priced.priced, false);
  assert.equal(priced.amount, null);
});

test("the same model on a different provider is not priced at the first provider's rate", () => {
  assert.equal(rateFor("zai-openai", "glm-5.2"), null);
  assert.ok(rateFor("resetdata-glm", "zai/glm-5.2"));
});

test("a local override supplies a rate the catalog cannot verify, and wins over a built-in", () => {
  const rates = mergeRates([
    { provider: "openai", match: "^gpt-5\\.6", rate: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25, cacheWrite1h: 1.25 } },
    { provider: "anthropic", match: "^claude-opus-5", rate: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, cacheWrite1h: 1 }, source: "deliberate test override" },
  ]);
  const codex = priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: usage({ input: 1_000_000 }) }, rates);
  assert.equal(codex.amount, 1.25);
  const opus = priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ input: 1_000_000 }) }, rates);
  assert.equal(opus.amount, 1);
  assert.equal(opus.source, "deliberate test override");
});

test("a total names what it could not price, and ignores unpriced models that spent nothing", () => {
  const parts = [
    priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ input: 1_000_000 }) }),
    priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: usage({ input: 500_000 }) }),
    priceUsage({ provider: "openai", model: "gpt-5.6-luna", usage: usage({}) }),
  ];
  const total = totalCost(parts);
  assert.equal(total.amount, 5);
  assert.equal(total.complete, false);
  assert.deepEqual(total.unpriced, ["openai/gpt-5.6-sol"]);
});

test("a total over fully priced parts is complete", () => {
  const total = totalCost([priceUsage({ provider: "anthropic", model: "claude-opus-5", usage: usage({ input: 1_000_000 }) })]);
  assert.equal(total.complete, true);
  assert.deepEqual(total.unpriced, []);
});

test("usage adds up and ignores missing or nonsense counts", () => {
  const total = sumUsage([usage({ input: 10 }), { output: 5 }, null, { input: Number.NaN, cacheRead: -3 }]);
  assert.deepEqual(total, { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 });
  assert.deepEqual(addUsage(emptyUsage(), undefined), emptyUsage());
});

test("a dollar figure keeps the precision that carries information", () => {
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.0023), "$0.0023");
  assert.equal(formatUsd(4.878), "$4.88");
  assert.equal(formatUsd(41.6), "$42");
  assert.equal(formatUsd(null), "—");
});
