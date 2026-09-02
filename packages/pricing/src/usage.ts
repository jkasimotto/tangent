// The one token-usage shape every Tangent app prices with.
//
// Each harness reports usage in its own field names and its own conventions,
// and the conventions disagree in a way that silently doubles or halves a
// bill. Anthropic reports `input_tokens` with cache reads already excluded;
// OpenAI reports `input_tokens` with cached tokens still inside it. So this
// shape fixes one meaning and makes every reader normalize to it: `input` is
// the tokens that were charged at the full input rate, and nothing else.

/**
 * One conversation's token counts, in the units this package prices.
 *
 * `input` excludes cache reads and cache writes. `reasoning` is reported for
 * the reader, never billed: every provider that reports it already counts
 * those tokens inside `output`.
 */
export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
  reasoning: number;
};

/** An all-zero usage record, the identity for {@link addUsage}. */
export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 };
}

/** Adds one usage record into another and returns the running total. */
export function addUsage(total: TokenUsage, part: Partial<TokenUsage> | null | undefined): TokenUsage {
  if (!part) return total;
  return {
    input: total.input + finite(part.input),
    output: total.output + finite(part.output),
    cacheRead: total.cacheRead + finite(part.cacheRead),
    cacheWrite: total.cacheWrite + finite(part.cacheWrite),
    cacheWrite1h: total.cacheWrite1h + finite(part.cacheWrite1h),
    reasoning: total.reasoning + finite(part.reasoning),
  };
}

/** Sums a list of usage records. */
export function sumUsage(parts: Iterable<Partial<TokenUsage> | null | undefined>): TokenUsage {
  let total = emptyUsage();
  for (const part of parts) total = addUsage(total, part);
  return total;
}

/** The tokens that occupied the context window: everything sent, cached or not. */
export function promptTokens(usage: TokenUsage): number {
  return usage.input + usage.cacheRead + usage.cacheWrite + usage.cacheWrite1h;
}

/** Every token the conversation moved, in and out. */
export function totalTokens(usage: TokenUsage): number {
  return promptTokens(usage) + usage.output;
}

/** True when nothing was recorded, so callers can tell empty from free. */
export function isEmptyUsage(usage: TokenUsage): boolean {
  return totalTokens(usage) === 0;
}

/** Coerces one reported count to a usable number; anything else counts as zero. */
function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
