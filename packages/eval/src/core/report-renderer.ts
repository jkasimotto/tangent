import type { EvalMetrics } from "../types/metrics.js";

/** Renders an eval run report as a fixed-width text table. */
export function renderReport(runId: string, metrics: EvalMetrics[]): string {
  const headers = ["case", "variant", "status", "duration", "tokens", "tools", "files read", "files changed", "branch"];
  const rows = metrics.map((item) => [
    item.caseId,
    item.variantId,
    item.status,
    formatDuration(item.time.durationMs),
    formatTokens(item.tokens.total),
    String(item.tools.total),
    String(item.files.read.length),
    String(item.files.changed.length),
    item.git.branch
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]!.length)));
  const lines = [`Run: ${runId}`, "", formatRow(headers, widths), ...rows.map((row) => formatRow(row, widths))];
  return lines.join("\n");
}

/** Formats a single table row by padding each cell to its column width. */
function formatRow(row: string[], widths: number[]): string {
  return row.map((cell, index) => cell.padEnd(widths[index]!)).join("  ").trimEnd();
}

/** Formats a duration in milliseconds as a human-readable string. */
function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "-";
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

/** Formats a token count, abbreviating thousands with 'k'. */
function formatTokens(tokens: number | undefined): string {
  if (!tokens) return "-";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}
