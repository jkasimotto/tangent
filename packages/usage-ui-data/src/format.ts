import type { UsageConfidence, UsageSession, UsageSessionStatus, UsageStep, UsageStepStatus, UsageTokenUsage, UsageUiConfidence } from "./types.js";

/** Normalizes the confidence. */
export function normalizeConfidence(value: UsageConfidence | undefined): UsageUiConfidence | undefined {
  if (value === "exact" || value === "derived" || value === "partial" || value === "estimated" || value === "unknown") return value;
  if (value === "provider-reported") return "exact";
  if (value === "unsupported") return "unknown";
  return undefined;
}

/** Supports the confidence or unknown helper. */
export function confidenceOrUnknown(value: UsageConfidence | undefined): UsageUiConfidence {
  return normalizeConfidence(value) || "unknown";
}

/** Normalizes the session status. */
export function normalizeSessionStatus(value: UsageSession["status"]): UsageSessionStatus {
  if (value === "active") return "active";
  if (value === "completed" || value === "complete") return "complete";
  if (value === "failed" || value === "truncated") return "failed";
  return "unknown";
}

/** Normalizes the step status. */
export function normalizeStepStatus(value: UsageStep["status"]): UsageStepStatus {
  if (value === "success" || value === "error" || value === "cancelled") return value;
  return "unknown";
}

/** Formats the duration. */
export function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  const rounded = Math.max(0, Math.round(ms));
  if (rounded < 1000) return `${rounded}ms`;
  const seconds = Math.round(rounded / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/** Formats the tokens. */
export function formatTokens(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (Math.abs(value) >= 1_000_000) return `${trimFixed(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(value) >= 1_000) return `${trimFixed(value / 1_000, value >= 10_000 ? 0 : 1)}K`;
  return Intl.NumberFormat("en").format(Math.round(value));
}

/**
 * Returns a session's peak context-window size: the largest single-turn context the run reached.
 * Aggregate token usage maxes per-turn context, so this is the honest "how big did this conversation
 * get" figure, unlike `tokens.total`, which sums cache reads across every turn into a number that
 * dwarfs the real working set.
 */
export function peakContextTokens(usage: UsageTokenUsage | undefined): number | undefined {
  return finiteNumber(usage?.peakContext) ?? finiteNumber(usage?.context);
}

/** Formats a context-window size with a trailing `ctx`, matching the per-turn labels. */
export function formatContextTokens(value: number | undefined): string | undefined {
  const formatted = formatTokens(value);
  return formatted === undefined ? undefined : `${formatted} ctx`;
}

/** Formats message-level token usage. */
export function formatMessageTokenUsage(usage: UsageTokenUsage | undefined, fallbackTotal?: number): string | undefined {
  const context = tokenContext(usage);
  const output = finiteNumber(usage?.output);
  if (context !== undefined || output !== undefined) {
    return `${context === undefined ? "- ctx" : `${formatMessageTokenCount(context)} ctx`} / ${output === undefined ? "- out" : `${formatMessageTokenCount(output)} out`}`;
  }
  return formatTokens(finiteNumber(usage?.total) ?? fallbackTotal);
}

/** Formats the count. */
export function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "Unknown";
  return Intl.NumberFormat("en").format(Math.round(value));
}

/** Formats the date time. */
export function formatDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

/** Formats the time range. */
export function formatTimeRange(startedAt: string | undefined, endedAt: string | undefined): string {
  const start = formatDateTime(startedAt);
  const end = formatDateTime(endedAt);
  if (start && end) return `${start} -> ${end}`;
  if (start) return `Started ${start}`;
  return "Time range unknown";
}

/** Supports the last activity label helper. */
export function lastActivityLabel(session: UsageSession, now: Date = new Date()): string {
  const value = session.lastActivityAt || session.endedAt || session.startedAt;
  if (!value) return "Activity unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaMs = now.getTime() - date.getTime();
  if (deltaMs < 0) return formatDateTime(value) || value;
  const minutes = Math.round(deltaMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateTime(value) || value;
}

/** Cleans the title. */
export function cleanTitle(value: string | undefined, fallback = "Untitled session"): string {
  const text = (value || fallback).replace(/\s+/g, " ").trim();
  return text.length > 150 ? `${text.slice(0, 149)}...` : text;
}

/** Truncates the text. */
export function truncateText(value: string | undefined, length = 240): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > length ? `${text.slice(0, Math.max(0, length - 3))}...` : text;
}

/** Supports the step duration helper. */
export function stepDuration(step: UsageStep): number | undefined {
  return finiteNumber(step.durationMs) ?? finiteNumber(step.metrics?.durationMs);
}

/** Supports the step self duration helper. */
export function stepSelfDuration(step: UsageStep): number | undefined {
  return finiteNumber(step.selfDurationMs) ?? finiteNumber(step.metrics?.selfDurationMs) ?? stepDuration(step);
}

/** Supports the step tokens helper. */
export function stepTokens(step: UsageStep): number | undefined {
  return finiteNumber(step.metrics?.tokens?.total);
}

/** Supports the message tokens helper. */
export function messageTokens(message: { tokenUsage?: { total?: number }; metrics?: { tokens?: { total?: number } }; tokens?: { value?: number | string } }): number | undefined {
  const tokenValue = typeof message.tokens?.value === "number" ? message.tokens.value : undefined;
  return finiteNumber(message.tokenUsage?.total) ?? finiteNumber(message.metrics?.tokens?.total) ?? tokenValue;
}

/**
 * Returns the context-window size for a message: the provider's explicit context
 * field when present, otherwise the sum of the input token kinds. Claude reports
 * `input_tokens` (uncached, often single digits) separately from
 * `cache_read_input_tokens`/`cache_creation_input_tokens` (the bulk of the prompt),
 * so the true context size is their sum, matching AgentsView's
 * `input + cache_creation + cache_read`. Using `input` alone would report ~2 tokens
 * for a 300k-token prompt.
 */
function tokenContext(usage: UsageTokenUsage | undefined): number | undefined {
  if (!usage) return undefined;
  return finiteNumber(usage.context) ?? sumTokens([usage.input, usage.cacheRead, usage.cacheCreation]);
}

/** Sums finite token counts when at least one value is present. */
function sumTokens(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) : undefined;
}

/** Formats a message token count with AgentsView-style compact units. */
function formatMessageTokenCount(value: number): string {
  if (Math.abs(value) < 1_000) return Intl.NumberFormat("en").format(Math.round(value));
  if (Math.abs(value) < 1_000_000) return `${trimFixed(value / 1_000, 1)}k`;
  return `${trimFixed(value / 1_000_000, 1)}M`;
}

/** Returns unique values. */
export function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/** Returns unique paths. */
export function uniquePaths(steps: UsageStep[]): string[] {
  return uniqueValues(steps.flatMap((step) => step.targetPaths || []));
}

/** Supports the step kind label helper. */
export function stepKindLabel(kind: string | undefined): string {
  const normalized = kind || "unknown";
  if (normalized === "assistant_response") return "Assistant responses";
  if (normalized === "user_message") return "User prompts";
  if (normalized === "model_call") return "Model calls";
  if (normalized === "tool_call") return "Tool calls";
  if (normalized === "tool_result") return "Tool results";
  if (normalized === "file_read") return "File reads";
  if (normalized === "file_search") return "File searches";
  if (normalized === "file_write") return "File writes";
  if (normalized === "command") return "Commands";
  if (normalized === "subagent") return "Subagents";
  if (normalized === "compaction") return "Compactions";
  if (normalized === "permission") return "Permissions";
  if (normalized === "error") return "Errors";
  if (normalized === "session") return "Session envelope";
  if (normalized === "turn") return "Turns";
  return titleCase(normalized.replace(/[_-]/g, " "));
}

/** Supports the status label helper. */
export function statusLabel(status: UsageSessionStatus): string {
  if (status === "complete") return "Complete";
  return titleCase(status);
}

/** Supports the finite number helper. */
export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Supports the trim fixed helper. */
function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

/** Supports the title case helper. */
function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
