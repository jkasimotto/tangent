// Small formatting helpers shared by the markdown and HTML report renderers, so a duration or a
// token count reads identically in both artifacts. Every function is pure and takes already-computed
// numbers; none of them read the clock or the filesystem, which keeps the renderers deterministic.

/** Formats a duration in milliseconds as a compact human string, e.g. "3m 12s" or "45s". Returns "-" when absent. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Formats a signed duration delta in milliseconds, e.g. "+1m 04s" or "-12s". Returns "-" when absent or zero. */
export function formatDurationDelta(ms: number | undefined): string {
  if (ms === undefined || ms === 0) return "-";
  const sign = ms > 0 ? "+" : "-";
  return `${sign}${formatDuration(Math.abs(ms))}`;
}

/** Formats a token count, abbreviating thousands as "k", e.g. "12.3k". Returns "-" when absent or zero. */
export function formatTokens(tokens: number | undefined): string {
  if (!tokens) return "-";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

/** Formats a signed token delta, e.g. "+2.1k" or "-350". Returns "-" when absent or zero. */
export function formatTokensDelta(tokens: number | undefined): string {
  if (tokens === undefined || tokens === 0) return "-";
  const sign = tokens > 0 ? "+" : "-";
  return `${sign}${formatTokens(Math.abs(tokens))}`;
}

/** Formats a signed integer delta with an explicit sign, e.g. "+3" or "-1". Returns "-" when absent or zero. */
export function formatCountDelta(count: number | undefined): string {
  if (count === undefined || count === 0) return "-";
  return count > 0 ? `+${count}` : `${count}`;
}

/** Formats a pass count out of a total as "3/5", or "-" when no criteria were evaluated. */
export function formatPassRate(passCount: number | undefined, total: number | undefined): string {
  if (passCount === undefined || total === undefined || total === 0) return "-";
  return `${passCount}/${total}`;
}

/** Formats a pass rate as a rounded percentage, e.g. "60%". Returns "-" when no criteria were evaluated. */
export function formatPassPercent(passCount: number | undefined, total: number | undefined): string {
  if (passCount === undefined || total === undefined || total === 0) return "-";
  return `${Math.round((passCount / total) * 100)}%`;
}
