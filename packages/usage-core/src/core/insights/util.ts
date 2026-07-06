import path from "node:path";

import type { NormalizedConversation, NormalizedToolCall } from "../conversation-report-types.js";

const CHARS_PER_TOKEN_ESTIMATE = 4;

// A finding title that shows a raw absolute path outside the conversation's repo still needs to
// tell the reader which file it is; showing the last few segments with this marker keeps the title
// short without pretending the path does not exist.
const OUTSIDE_ROOT_ELLIPSIS = "…";
const OUTSIDE_ROOT_TAIL_SEGMENTS = 3;

/** Returns all tool calls across a conversation's assistant messages, in message order. */
export function flattenToolCalls(conversation: NormalizedConversation): NormalizedToolCall[] {
  return conversation.messages.flatMap((message) => (message.role === "assistant" ? message.toolCalls : []));
}

/**
 * Returns the text of the last assistant message in a conversation. Used as the "did this path get
 * referenced in the final answer" half of the downstream-use proxy (the other half is: did a later
 * write call touch the same path).
 */
export function lastAssistantText(conversation: NormalizedConversation): string | undefined {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]!;
    if (message.role === "assistant") return message.text;
  }
  return undefined;
}

/** Sums a list of numbers. */
export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Returns the median of a list of numbers, 0 for an empty list. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Estimates a token count from result text length. Providers do not report exact per-tool-call
 * token usage, so this is always a rough estimate; callers must label it "est." wherever it is
 * shown, per the mark-loop design's honesty constraint.
 */
export function estimateTokensFromText(text: string | undefined): number {
  if (!text) return 0;
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length ? Math.ceil(compact.length / CHARS_PER_TOKEN_ESTIMATE) : 0;
}

/**
 * Formats a millisecond duration as a compact label for finding titles: sub-second durations as
 * "<1s" (and exactly zero as "0s") so a fast tool call never misleadingly renders as "0m", whole
 * seconds below a minute as "Ns", minutes as "Nm", and durations of an hour or more as "N.Yh".
 */
export function formatFindingDuration(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 1_000) return "<1s";
  const seconds = ms / 1_000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

/**
 * Returns the basename of a repo root (or cwd) path as a short human project label, e.g.
 * "/Users/x/repo/polez-pgande" -> "polez-pgande". Undefined input (or a path with no basename,
 * such as "/") returns undefined so callers can fall back to a generic phrase.
 */
export function projectLabelForRoot(root: string | undefined): string | undefined {
  if (!root) return undefined;
  const trimmed = root.replace(/[\\/]+$/, "");
  const base = path.basename(trimmed);
  return base || undefined;
}

/**
 * Returns the project label for a single conversation: the basename of its repo root, falling back
 * to the basename of its cwd when the root is unknown. Used by generators scoped to one
 * conversation (an info-finding-heavy session, a re-read-churn file); cross-conversation generators
 * should use `projectLabelForRoot` on their already-grouped repo instead, since a cwd fallback is
 * only meaningful when there is a single conversation to read it from.
 */
export function projectLabelForConversation(conversation: NormalizedConversation): string | undefined {
  return projectLabelForRoot(conversation.repo?.root) ?? projectLabelForRoot(conversation.repo?.cwd);
}

/**
 * Builds a project-scoped session lead-in like "One session in polez-pgande", replacing a raw
 * session/conversation UUID that used to open this title. The id itself still travels in the
 * finding's evidence array; only the human-facing title text changes. Falls back to "One session"
 * when the conversation has no resolvable project label.
 */
export function oneSessionInPhrase(projectLabel: string | undefined): string {
  return projectLabel ? `One session in ${projectLabel}` : "One session";
}

/**
 * Builds a project-scoped session phrase like "A polez-pgande session", replacing a raw
 * session/conversation UUID that used to open this title. The id itself still travels in the
 * finding's evidence array; only the human-facing title text changes. Falls back to "A session"
 * when the conversation has no resolvable project label.
 */
export function aProjectSessionPhrase(projectLabel: string | undefined): string {
  return projectLabel ? `A ${projectLabel} session` : "A session";
}

/**
 * Relativizes a file path against a repo root for display in a finding title, so titles never leak
 * an absolute filesystem path. Paths inside the root render relative to it ("src/util.ts"); paths
 * outside the root (or when no root is known) render as the last few path segments prefixed with an
 * ellipsis ("…/a/b/c.ts") so the title still names the file without exposing the full path.
 */
export function relativizeFilePathAgainstRoot(filePath: string, root: string | undefined): string {
  // An already-relative path has nothing absolute to strip, and `path.relative` would otherwise
  // resolve it against `process.cwd()`, making the result depend on where the process happens to
  // run rather than on the conversation's repo.
  if (!path.isAbsolute(filePath)) return toDisplaySeparators(filePath);
  if (root) {
    const relative = path.relative(root, filePath);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return toDisplaySeparators(relative);
  }
  return tailSegments(filePath);
}

/**
 * Relativizes a file path against a conversation's repo root, falling back to its cwd, for use in
 * finding titles scoped to a single conversation.
 */
export function relativizeFilePathForConversation(filePath: string, conversation: NormalizedConversation): string {
  return relativizeFilePathAgainstRoot(filePath, conversation.repo?.root || conversation.repo?.cwd);
}

/** Returns the last few segments of a path, ellipsis-prefixed, for a path that falls outside the known repo root. */
function tailSegments(filePath: string): string {
  const segments = filePath.split(/[\\/]+/).filter(Boolean);
  const tail = segments.slice(-OUTSIDE_ROOT_TAIL_SEGMENTS);
  return tail.length ? `${OUTSIDE_ROOT_ELLIPSIS}/${tail.join("/")}` : OUTSIDE_ROOT_ELLIPSIS;
}

/** Normalizes a relative path's separators to forward slashes for display, regardless of platform. */
function toDisplaySeparators(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}
