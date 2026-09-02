// How a cost is written down, so every surface writes it the same way.

/**
 * A dollar figure sized to what it is.
 *
 * A cent-rounded figure hides the difference between a free call and a
 * cheap one, and four decimals on a forty dollar day is noise. This picks
 * the precision that carries information at each magnitude.
 */
export function formatUsd(amount: number | null | undefined): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  if (amount === 0) return "$0";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 10) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount)}`;
}

/** A token count at a glance: 940, 46k, 1.2M. */
export function formatTokens(count: number | null | undefined): string {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return "0";
  if (count < 1_000) return String(Math.round(count));
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
