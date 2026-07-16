import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { compareByUrgency } from "./render.js";
import { isoDate } from "./time.js";
import type { DerivedThread } from "./types.js";

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
 * `tangent-threads:begin`/`:end` markers: creates the file with markers when it is absent, appends
 * markers at the end when the file exists without them, and otherwise replaces exactly the
 * marker-delimited block, leaving every byte of human-authored content outside the markers untouched.
 * Returns "unchanged" (writing nothing) when the spliced result is byte-identical to what is already
 * on disk, so a caller committing the result can skip an empty commit.
 */
export async function updateSharedStateOfPlay(nodeDir: string, section: string): Promise<"written" | "unchanged"> {
  const filePath = path.join(nodeDir, "shared", "state-of-play.md");
  const existing = await readFile(filePath, "utf8").catch(() => undefined);
  const spliced = spliceMarkers(existing ?? "", section);
  if (existing === spliced) return "unchanged";
  await writeFileAtomic(filePath, spliced);
  return "written";
}

/** Replaces the marker-delimited block in `content` with `section` (appending fresh markers at the end when none are found), preserving everything outside the markers. */
function spliceMarkers(content: string, section: string): string {
  const beginIdx = content.indexOf(beginMarker);
  const endIdx = content.indexOf(endMarker);
  const block = `${beginMarker}\n${section}${endMarker}`;
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    return content.slice(0, beginIdx) + block + content.slice(endIdx + endMarker.length);
  }
  if (!content.trim()) return `${block}\n`;
  return `${content.replace(/\n*$/, "")}\n\n${block}\n`;
}
