// Compatibility helpers for explicit worker continuation records. No fs, no
// tmux, and no HTTP. Token fill never invokes these helpers.

import { boundedSessionName } from "./session-names.mjs";

/** Same normalization pipelineStepSessionName (server.mjs) uses for tmux names. */
function normName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Strips a trailing collision suffix (-r<digits>) and generation suffix
 * (-g<digits>), repeatedly. One or more dashes before the letter, since
 * normName collapses a doubled "--" separator to one dash.
 */
function stemOf(name) {
  let stem = String(name ?? "");
  let changed = true;
  while (changed) {
    changed = false;
    const withoutR = stem.replace(/-+r\d+$/, "");
    if (withoutR !== stem) { stem = withoutR; changed = true; }
    const withoutG = stem.replace(/-+g\d+$/, "");
    if (withoutG !== stem) { stem = withoutG; changed = true; }
  }
  return stem;
}

/**
 * The fresh session's derived name: strip `current`'s generation suffix to
 * get the stem, then `<stem>-g<n>` for the smallest n >= 2 not already live.
 * The base is truncated first so the generation suffix stays inside 60 characters. The
 * caller passes its own (already live) name as part of `current`'s lineage,
 * so a second continuation naturally lands on g3, not a repeat of g2.
 */
export function continuationSessionName(current, liveNames) {
  const stem = stemOf(current);
  for (let generation = 2; generation <= liveNames.size + 2; generation += 1) {
    const candidate = boundedSessionName(normName(stem), `-g${generation}`, 60);
    if (!liveNames.has(candidate)) return candidate;
  }
  throw new Error("could not allocate a continuation session name");
}

/**
 * The `## Continuing this step` (or Goal) prompt section: every non-failed
 * continuation's facts, in order, so a fresh session starts from written
 * memory instead of a compacted transcript (design D5).
 */
export function continuationSection({ index, total, entries, subject }) {
  const heading = subject === "Goal" ? "## Continuing this Goal" : "## Continuing this step";
  const intro = subject === "Goal"
    ? "You are a fresh session continuing this Goal. An earlier session did part of the work and handed over these facts."
    : `You are a fresh session continuing step ${index} of ${total}. An earlier session did part of the work and handed over these facts.`;
  const live = (entries ?? []).filter((entry) => !entry.failed);
  const blocks = live.map((entry, position) => `### Continuation ${position + 1} (from ${entry.session})\n\n${entry.facts}`);
  const closing = "The working tree already holds that session's uncommitted work. Continue; do not repeat commits or work the facts call finished.";
  return [heading, "", intro, "", ...blocks.flatMap((block) => [block, ""]), closing].join("\n");
}
