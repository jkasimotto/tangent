// One JSON file per mark, so marks are inspectable, greppable, and diffable without a database, and
// so a mark survives being copied or committed alongside the fix it justifies. The store defaults to
// `~/.tangent/marks/` but every function accepts the directory as its last argument, so tests point
// at a temp directory instead of the real home directory.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { assertMarkRecord, type MarkKind, type MarkLinks, type MarkRecord, type MarkStatus } from "./types.js";

/** Returns the directory marks are stored under, following the repo's ~/.tangent resolution pattern. */
export function marksHome(): string {
  return process.env.TANGENT_MARKS_HOME || path.join(process.env.TANGENT_HOME || path.join(homedir(), ".tangent"), "marks");
}

/** A draft mark: everything the caller knows, with id/at/status/links left to be filled by createMarkRecord. */
export type MarkDraft = {
  id?: string;
  at?: string;
  kind?: MarkKind;
  anchor: MarkRecord["anchor"];
  repo: MarkRecord["repo"];
  observed: string;
  expected?: string;
  hypothesis?: string;
  quote?: string;
  status?: MarkStatus;
  links?: Partial<MarkLinks>;
};

/**
 * Builds a full tangent.mark.v1 record from a draft, filling id/at/kind/status/links when the
 * caller did not already supply them. Both capture paths (bare CLI note, and the /mark skill's
 * `--json` stdin) converge here so a mark is always well-formed before it reaches disk.
 */
export function createMarkRecord(draft: MarkDraft, now = new Date()): MarkRecord {
  const record: MarkRecord = {
    schema: "tangent.mark.v1",
    id: draft.id || createMarkId(draft.observed, now),
    at: draft.at || now.toISOString(),
    kind: draft.kind || "failure",
    anchor: draft.anchor,
    repo: draft.repo,
    observed: draft.observed,
    expected: draft.expected,
    hypothesis: draft.hypothesis,
    quote: draft.quote,
    status: draft.status || "new",
    links: { eval: draft.links?.eval ?? null, fix: draft.links?.fix ?? null }
  };
  assertMarkRecord(record);
  return record;
}

/**
 * Generates a mark id as `<yyyymmddThhmmss>-<slug>`. The timestamp alone already guarantees
 * uniqueness to the second, so the slug only needs to be a short, readable hint: the first few
 * words of the observed text (or note), not the full sentence.
 */
export function createMarkId(sourceText: string, at = new Date()): string {
  return `${timestampSegment(at)}-${slugify(sourceText)}`;
}

/** Formats a Date as `yyyymmddThhmmss` in UTC, matching the compact ISO form used across mark ids. */
function timestampSegment(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
}

/** Reduces free text to a short, path-safe slug from its first few words. */
function slugify(text: string, maxWords = 6): string {
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
  const slug = words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "mark";
}

/** Returns the file path for a mark id under the given marks directory. */
function markFilePath(id: string, baseDir: string): string {
  return path.join(baseDir, `${id}.json`);
}

/** Writes a mark to disk as one JSON file, creating the marks directory if needed. */
export async function writeMark(mark: MarkRecord, baseDir = marksHome()): Promise<MarkRecord> {
  await mkdir(baseDir, { recursive: true });
  await writeFile(markFilePath(mark.id, baseDir), `${JSON.stringify(mark, null, 2)}\n`, "utf8");
  return mark;
}

/** Reads and validates a single mark by id. */
export async function readMark(id: string, baseDir = marksHome()): Promise<MarkRecord> {
  const raw = await readFile(markFilePath(id, baseDir), "utf8");
  const parsed: unknown = JSON.parse(raw);
  assertMarkRecord(parsed);
  return parsed;
}

export type MarkListFilter = {
  status?: MarkStatus;
  kind?: MarkKind;
  repo?: string;
};

/** Lists marks from the marks directory, optionally filtered, sorted newest first by `at`. */
export async function listMarks(filter: MarkListFilter = {}, baseDir = marksHome()): Promise<MarkRecord[]> {
  const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => []);
  const marks: MarkRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(baseDir, entry.name), "utf8");
      const parsed: unknown = JSON.parse(raw);
      assertMarkRecord(parsed);
      marks.push(parsed);
    } catch {
      // Skip unreadable or malformed mark files rather than failing the whole listing.
    }
  }
  const filtered = marks.filter((mark) =>
    (!filter.status || mark.status === filter.status) &&
    (!filter.kind || mark.kind === filter.kind) &&
    (!filter.repo || mark.repo.root === filter.repo)
  );
  return filtered.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Fields an existing mark may be partially updated with, e.g. after triage or a shipped fix. */
export type MarkUpdatePatch = Partial<Pick<MarkRecord, "status" | "observed" | "expected" | "hypothesis" | "quote">> & {
  links?: Partial<MarkLinks>;
};

/** Reads a mark, applies a partial patch, validates, and writes the result back. */
export async function updateMark(id: string, patch: MarkUpdatePatch, baseDir = marksHome()): Promise<MarkRecord> {
  const existing = await readMark(id, baseDir);
  const updated: MarkRecord = {
    ...existing,
    ...patch,
    links: { ...existing.links, ...patch.links }
  };
  assertMarkRecord(updated);
  return writeMark(updated, baseDir);
}
