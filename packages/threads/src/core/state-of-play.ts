import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { compareByUrgency } from "./render.js";
import { isoDate } from "./time.js";
import type { DerivedThread, StateOfPlaySpliceResult } from "./types.js";

/** Opens the generated block spliced into a shared node's state-of-play.md. */
const beginMarker = "<!-- tangent-threads:begin -->";

/** Closes the generated block spliced into a shared node's state-of-play.md. */
const endMarker = "<!-- tangent-threads:end -->";

/**
 * Renders the "Delegated threads" section a team sees in a shared node's state-of-play.md: one line
 * per (already non-done) thread, most-urgent-first with slug as the tiebreak (reusing
 * `compareByUrgency`, the same order threads.md uses), naming the owner, state, and either the
 * thread's recorded outcome or its why-line when no outcome has been written yet. This mirrors what
 * the thread's owner sees in threads.md, for teammates who only have access to the shared repo.
 */
export function renderStateOfPlaySection(threads: DerivedThread[], whyLines: Record<string, string>, now: Date): string {
  const sorted = [...threads].sort((a, b) => compareByUrgency(a, b) || a.slug.localeCompare(b.slug));
  const lines = [`## Delegated threads (generated ${isoDate(now)})`];
  for (const thread of sorted) {
    const detail = thread.outcome || whyLines[thread.slug] || thread.templateWhy;
    lines.push(`- **${thread.slug}** (${thread.owner}, ${thread.state}): ${detail}`);
  }
  return lines.join("\n");
}

/**
 * Read-modify-writes `<nodeDir>/shared/state-of-play.md`, splicing `section` between
 * `tangent-threads:begin`/`:end` markers. Conservative by design: the file is only ever touched when
 * its marker state is unambiguous. That is exactly two shapes: no markers at all (creates the file,
 * or appends a fresh marker pair at the end of an existing file, preserving all of its content), or
 * exactly one begin marker before exactly one end marker (replaces only the block between them,
 * leaving every byte outside the markers untouched). Any other marker state - an orphaned single
 * marker (a human mid-edit deleted its pair), more than one of either marker, or an end marker before
 * its begin - is refused entirely: the file is never written, and the result reports "malformed" with
 * the marker counts found, so a caller can log a precise diagnostic instead of guessing which pair is
 * real. This refusal is what stops the failure mode an orphaned marker used to cause: a naive splice
 * would append a second marker pair next to the orphan, and the following sweep would then splice
 * from the orphaned begin all the way to the new pair's end, silently deleting every byte of human
 * content in between. Returns "unchanged" (writing nothing) when the spliced result is byte-identical
 * to what is already on disk, so a caller committing the result can skip an empty commit.
 */
export async function updateSharedStateOfPlay(nodeDir: string, section: string): Promise<StateOfPlaySpliceResult> {
  const filePath = path.join(nodeDir, "shared", "state-of-play.md");
  const existing = await readFile(filePath, "utf8").catch(() => undefined);
  const outcome = spliceMarkers(existing ?? "", section);
  if (!outcome.ok) return { status: "malformed", beginCount: outcome.beginCount, endCount: outcome.endCount };
  if (existing === outcome.content) return "unchanged";
  await writeFileAtomic(filePath, outcome.content);
  return "written";
}

/** The result of classifying and (when safe) splicing a marker-delimited block: either the spliced content, or a refusal carrying the marker counts that made the state ambiguous. */
type SpliceOutcome = { ok: true; content: string } | { ok: false; beginCount: number; endCount: number };

/**
 * Classifies `content`'s begin/end marker state and, only when it is exactly "no markers" or "one
 * matched pair", produces the spliced result; every other marker count or ordering is reported as a
 * refusal rather than guessed at. See `updateSharedStateOfPlay` for why this conservatism matters.
 */
function spliceMarkers(content: string, section: string): SpliceOutcome {
  const beginCount = countOccurrences(content, beginMarker);
  const endCount = countOccurrences(content, endMarker);
  const block = `${beginMarker}\n${section}${endMarker}`;

  if (beginCount === 0 && endCount === 0) {
    const appended = !content.trim() ? `${block}\n` : `${content.replace(/\n*$/, "")}\n\n${block}\n`;
    return { ok: true, content: appended };
  }

  if (beginCount === 1 && endCount === 1) {
    const beginIdx = content.indexOf(beginMarker);
    const endIdx = content.indexOf(endMarker);
    if (endIdx > beginIdx) {
      return { ok: true, content: content.slice(0, beginIdx) + block + content.slice(endIdx + endMarker.length) };
    }
  }

  return { ok: false, beginCount, endCount };
}

/** Counts non-overlapping occurrences of `marker` in `content`. */
function countOccurrences(content: string, marker: string): number {
  let count = 0;
  let idx = content.indexOf(marker);
  while (idx !== -1) {
    count += 1;
    idx = content.indexOf(marker, idx + marker.length);
  }
  return count;
}
