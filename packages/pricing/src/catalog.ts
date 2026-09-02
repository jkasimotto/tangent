// The rate catalog: what a million tokens costs, by provider and model.
//
// Every rate here was read off a shipped price list or given by the account
// holder, and the source is named next to it. A model with no entry is not
// guessed at: it comes back unpriced, and the surface that shows the number
// says which model it could not price. That is the whole point of this file.
//
// These are API list prices. Under a subscription they measure the work a
// conversation did, not money that left an account.

/** What one million tokens costs, per billing bucket, in USD. */
export type TokenRate = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
};

/** One catalog entry: the models it prices, and the rate they are priced at. */
export type RateEntry = {
  provider: string;
  /** Matched against the model id the harness recorded, lowercased. */
  match: RegExp;
  rate: TokenRate;
  /** Replaces `input` and `output` when the conversation ran in fast mode. */
  fastMode?: Pick<TokenRate, "input" | "output">;
  /** Where the numbers came from, shown when a reader asks how a cost was reached. */
  source: string;
};

/**
 * Builds one rate from the order the price lists print:
 * input, output, cache write (5 minute), cache write (1 hour), cache read.
 */
function rate(input: number, output: number, cacheWrite: number, cacheWrite1h: number, cacheRead: number): TokenRate {
  return { input, output, cacheWrite, cacheWrite1h, cacheRead };
}

const ANTHROPIC = "Claude Code 2.1.258 baked price catalog, verified 2026-09-02 against three recorded cost-state totals.";
const RESETDATA = "Julian's ResetData account rates, given 2026-09-02. No separate cache-write price is published, so writes bill at the input rate.";

/**
 * The built-in rates, most specific first. `rateFor` takes the first match,
 * so a dated or suffixed model id (`claude-opus-4-5-20260101`, `glm-5.2[1m]`)
 * resolves to the family it belongs to.
 */
export const builtInRates: readonly RateEntry[] = [
  // Anthropic. Opus 4.0 and 4.1 predate the price drop, so they must be
  // matched before the general opus-4 rule.
  { provider: "anthropic", match: /^claude-opus-4-[01]\b/, rate: rate(15, 75, 18.75, 30, 1.5), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-opus-4-[67]\b/, rate: rate(5, 25, 6.25, 10, 0.5), fastMode: { input: 30, output: 150 }, source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-opus-4-[58]\b/, rate: rate(5, 25, 6.25, 10, 0.5), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-opus-5\b/, rate: rate(5, 25, 6.25, 10, 0.5), fastMode: { input: 10, output: 50 }, source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-fable-5-1\b/, rate: rate(10, 50, 12.5, 20, 0.25), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-fable-5\b/, rate: rate(10, 50, 12.5, 20, 1), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-sonnet-5\b/, rate: rate(2, 10, 2.5, 4, 0.2), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-(3|sonnet-[34])/, rate: rate(3, 15, 3.75, 6, 0.3), source: ANTHROPIC },
  { provider: "anthropic", match: /^claude-haiku-4-5\b/, rate: rate(1, 5, 1.25, 2, 0.1), source: ANTHROPIC },

  // ResetData, reached through pi-code. Julian gave input, cached and output;
  // the endpoint publishes no cache-write price, so writes bill as input.
  { provider: "resetdata-glm", match: /^zai\/glm-5\.2/, rate: rate(1.58, 4.96, 1.58, 1.58, 0.16), source: RESETDATA },
];

/** A local override, in the same shape but with the match written as a string. */
export type RateOverride = {
  provider: string;
  match: string;
  rate: TokenRate;
  fastMode?: Pick<TokenRate, "input" | "output">;
  source?: string;
};

/**
 * Merges local overrides ahead of the built-in rates.
 *
 * Codex ships no price data at all and this machine's OpenAI and gateway
 * models therefore have no verified numbers. Rather than invent them, the
 * catalog stays empty for those models and an override file supplies them
 * when the account holder knows what they are. An override matching the same
 * models as a built-in entry wins, because it was written on purpose.
 */
export function mergeRates(overrides: readonly RateOverride[] = [], base: readonly RateEntry[] = builtInRates): RateEntry[] {
  const parsed: RateEntry[] = [];
  for (const override of overrides) {
    if (!override?.provider || !override?.match || !override?.rate) continue;
    let match: RegExp;
    try {
      match = new RegExp(override.match, "i");
    } catch {
      continue;
    }
    parsed.push({
      provider: override.provider,
      match,
      rate: override.rate,
      ...(override.fastMode ? { fastMode: override.fastMode } : {}),
      source: override.source || "local override",
    });
  }
  return [...parsed, ...base];
}

/**
 * Finds the rate for one provider and model, or null when nothing prices it.
 *
 * The provider must match too: the same model id served through a different
 * account bills differently, and pricing a gateway model at the vendor's
 * direct rate would be a confident wrong answer.
 */
export function rateFor(provider: string, model: string, rates: readonly RateEntry[] = builtInRates): RateEntry | null {
  const providerId = String(provider ?? "").trim().toLowerCase();
  const modelId = String(model ?? "").trim().toLowerCase();
  if (!providerId || !modelId) return null;
  return rates.find((entry) => entry.provider.toLowerCase() === providerId && entry.match.test(modelId)) ?? null;
}
