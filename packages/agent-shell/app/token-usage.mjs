// The one token-usage shape every Tangent surface prices with.
//
// Each harness reports usage in its own field names and its own conventions,
// and the conventions disagree in a way that silently doubles or halves a
// bill. Anthropic reports `input_tokens` with cache reads already excluded.
// OpenAI reports `input_tokens` with the cached tokens still inside it: one
// measured codex rollout read 102,630,487 input tokens of which 100,979,072
// were cached, so 1,651,415 were charged at the full rate and the rest at the
// cache rate. pi already normalizes both into the Anthropic convention, so
// pi's shape is the one adopted here.
//
// Two meanings are fixed once, and every reader converts to them:
//   `input`     the tokens charged at the full input rate, cache excluded.
//   `reasoning` reported for a reader, never billed: every provider that
//               reports it already counts those tokens inside `output`.

/** An all-zero usage record, the identity for {@link addUsage}. */
export function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 };
}

/** Coerces one reported count to a usable number; anything else counts as zero. */
export function tokenCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Adds one usage record into another and returns the running total. */
export function addUsage(total, part) {
  if (!part) return total;
  return {
    input: total.input + tokenCount(part.input),
    output: total.output + tokenCount(part.output),
    cacheRead: total.cacheRead + tokenCount(part.cacheRead),
    cacheWrite: total.cacheWrite + tokenCount(part.cacheWrite),
    cacheWrite1h: total.cacheWrite1h + tokenCount(part.cacheWrite1h),
    reasoning: total.reasoning + tokenCount(part.reasoning),
  };
}

/** Sums a list of usage records. */
export function sumUsage(parts) {
  let total = emptyUsage();
  for (const part of parts) total = addUsage(total, part);
  return total;
}

/** The tokens that occupied the context window: everything sent, cached or not. */
export function promptTokens(usage) {
  return tokenCount(usage?.input) + tokenCount(usage?.cacheRead) + tokenCount(usage?.cacheWrite) + tokenCount(usage?.cacheWrite1h);
}

/** Every token a conversation moved, in and out. */
export function totalTokens(usage) {
  return promptTokens(usage) + tokenCount(usage?.output);
}

/** True when nothing was recorded, so a caller can tell empty from free. */
export function isEmptyUsage(usage) {
  return totalTokens(usage) === 0;
}

/**
 * A dollar figure sized to what it is.
 *
 * A cent-rounded figure hides the difference between a free call and a cheap
 * one, and four decimals on a forty dollar day is noise. This picks the
 * precision that carries information at each magnitude.
 */
export function formatUsd(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  if (amount === 0) return "$0";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 10) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount)}`;
}

/** A token count at a glance: 940, 46k, 1.2M. */
export function formatTokens(count) {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return "0";
  if (count < 1_000) return String(Math.round(count));
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
