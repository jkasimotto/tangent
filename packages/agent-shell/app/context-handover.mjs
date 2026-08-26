// Pure rules for the worker context handover (design-worker-context-handover):
// when a reminder is due, the reminder and repeat text, the fresh session's
// derived name, and the prompt section a continued session reads. No fs, no
// tmux, no HTTP; the server owns time, spawning, and records.

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
 * Whether a reminder is due for a session, and which level. Null (never
 * remind) when the fill is unknown, the session's window is at or under the
 * threshold (small-window exemption: that model just uses its full window),
 * or a number fails to parse. "first" fires once at the threshold; "repeat"
 * fires once more a tenth past it. State never clears once set, so a
 * compaction dip never re-arms a level that already fired.
 */
export function reminderDue({ fill, thresholdTokens, reminders }) {
  if (!fill) return null;
  const { usedTokens, windowTokens } = fill;
  if (!Number.isFinite(usedTokens) || !Number.isFinite(windowTokens) || !Number.isFinite(thresholdTokens)) return null;
  if (windowTokens <= thresholdTokens) return null;
  if (usedTokens >= thresholdTokens && !reminders?.firstAt) return "first";
  if (usedTokens >= thresholdTokens * 1.1 && reminders?.firstAt && !reminders?.repeatAt) return "repeat";
  return null;
}

/** The first-level reminder sends context risk to the authoritative controller. */
export function contextReminderText({ usedTokens, windowTokens, subject }) {
  const used = Math.round(usedTokens / 1000);
  const window = Math.round(windowTokens / 1000);
  const pct = Math.round((usedTokens / windowTokens) * 100);
  return `Your context is at ${used}k of ${window}k (${pct}%). At the next natural pause, submit a typed context-risk report with the durable facts. The exact Area brain chooses and starts any fresh attempt; do not replace yourself. If the ${subject} is nearly done, finish it and submit the normal typed result.`;
}

/** The second, stronger reminder once carried context is a tenth past the threshold. */
export function contextRepeatText({ usedTokens, thresholdTokens, subject }) {
  const used = Math.round(usedTokens / 1000);
  const threshold = Math.round(thresholdTokens / 1000);
  return `Your context is well past ${threshold}k tokens (${used}k). Submit a typed context-risk report now. The exact Area brain chooses and starts any fresh attempt; do not replace yourself.`;
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
