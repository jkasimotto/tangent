// Pure view-model helpers for the Marks inbox (MarksInbox.svelte). Kept separate from the component so
// the age formatting, status-chip mapping, and the usage/to-eval link text are unit-testable without
// mounting Svelte. See docs/superpowers/specs/2026-07-05-mark-loop-design.md, "The marks inbox (eval UI)".

import type { MarkKind, MarkRecord, MarkStatus } from "./client.js";

/** The shell's route for the Usage app. No per-conversation deep link exists there yet (see AGENTS.md / design doc), so a mark links to the app root and shows its session id as copyable text instead. */
export const USAGE_APP_ROUTE = "/usage";

/** The CLI command a user copies to scaffold an eval from a mark; the UI never creates evals itself. */
export function toEvalCommand(id: string): string {
  return `tangent mark to-eval ${id}`;
}

/** Human label for a mark status chip. */
export function statusLabel(status: MarkStatus): string {
  if (status === "new") return "new";
  if (status === "suggested") return "suggested";
  if (status === "triaged") return "triaged";
  if (status === "eval-created") return "eval created";
  if (status === "fixed") return "fixed";
  return "dismissed";
}

/** Human label for a mark kind. */
export function kindLabel(kind: MarkKind): string {
  return kind === "candidate" ? "candidate" : "failure";
}

/**
 * CSS class for a status chip's color, the single color-bearing element on a mark row (per the design
 * doc's "color encodes exactly one thing" rule). Everything else on the row stays neutral.
 */
export function statusChipClass(status: MarkStatus): string {
  return `mark-status mark-status-${status}`;
}

/** Short relative age (e.g. "2h", "3d") for a mark's `at` timestamp, so the newest marks read at a glance. */
export function markAge(at: string, now: number = Date.now()): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return "";
  const deltaMs = Math.max(0, now - then);
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** The repo's last path segment, for a compact "which project" label on a mark row. */
export function repoLabel(root: string): string {
  const segments = root.split("/").filter(Boolean);
  return segments[segments.length - 1] || root;
}

/** Whether a status-changing row action should be disabled because the mark is already in that status. */
export function actionDisabled(mark: MarkRecord, target: MarkStatus): boolean {
  return mark.status === target;
}

/** Sorts marks newest-first by `at`. The server already returns this order; kept as a defensive, pure re-sort for callers (e.g. tests) that build a list directly. */
export function sortMarksNewestFirst(marks: MarkRecord[]): MarkRecord[] {
  return [...marks].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
