import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { ParsedThread, ThreadStatus } from "./types.js";

// Documented body-prose signals (see the design spec and package docs/architecture.md): owner is a
// "Owner: X" line; cadence is "Check in every N days"; a wake condition is a line starting "Parked",
// "Wake when", or "Wake on"; deadlines are dates written as YYYY-MM-DD anywhere in the body, or 📅
// YYYY-MM-DD.
const ownerLine = /^Owner:\s*(.+)$/im;
const cadenceLine = /check in every\s+(\d+)\s+days?/i;
const wakeLine = /^(?:Parked|Wake when|Wake on)\b.*$/im;
const emojiDeadline = /📅\s*(\d{4}-\d{2}-\d{2})/g;
const bareDeadline = /\b(\d{4}-\d{2}-\d{2})\b/g;
const maxExcerptChars = 800;

/**
 * Parses one `thread-<slug>.md` file's frontmatter and body prose signals into a ParsedThread.
 * `vaultRelativePath` locates the file's node (its parent directory) and slug (the filename minus
 * the `thread-` prefix and `.md` suffix).
 */
export function parseThreadFile(vaultRelativePath: string, content: string): ParsedThread {
  const { frontmatter, body } = parseFrontmatter(content);
  const dir = path.dirname(vaultRelativePath);
  const node = dir === "." ? "" : dir;
  const filename = path.basename(vaultRelativePath, ".md");
  const slug = filename.replace(/^thread-/, "");

  return {
    slug,
    node,
    path: vaultRelativePath,
    outcome: frontmatter.outcome || undefined,
    status: normalizeStatus(frontmatter.status),
    opened: frontmatter.opened || undefined,
    closed: frontmatter.closed || undefined,
    owner: cleanOwner(body.match(ownerLine)?.[1]),
    cadenceDays: cadenceDaysFrom(body),
    deadline: earliestDeadline(body),
    wakeCondition: body.match(wakeLine)?.[0]?.trim(),
    bodyExcerpt: excerpt(body)
  };
}

/** Coerces an unrecognized or missing frontmatter status to "open", the safe default for a thread still being tracked. */
function normalizeStatus(value: string | undefined): ThreadStatus {
  if (value === "done" || value === "dropped") return value;
  return "open";
}

/** Trims a parsed "Owner: X" match and drops a trailing sentence period, so "Owner: Will." reads as "Will". */
function cleanOwner(value: string | undefined): string | undefined {
  return value?.trim().replace(/\.$/, "") || undefined;
}

/** Returns the check-in cadence in days parsed from "Check in every N days" prose, if present. */
function cadenceDaysFrom(body: string): number | undefined {
  const match = body.match(cadenceLine);
  return match ? Number(match[1]) : undefined;
}

/** Returns the earliest date found in the body, preferring explicit 📅-marked deadlines over bare dates (YYYY-MM-DD sorts lexically, so the minimum string is the earliest date). */
export function earliestDeadline(body: string): string | undefined {
  const marked = [...body.matchAll(emojiDeadline)].map((match) => match[1]!);
  if (marked.length) return marked.sort()[0];
  const bare = [...body.matchAll(bareDeadline)].map((match) => match[1]!);
  return bare.length ? bare.sort()[0] : undefined;
}

/** Truncates a thread body to a bounded excerpt for the haiku prompt, so one long thread can't blow out the sweep's prompt size. */
function excerpt(body: string, maxChars = maxExcerptChars): string {
  const trimmed = body.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}
