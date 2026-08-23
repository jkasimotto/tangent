import { test } from "node:test";
import assert from "node:assert/strict";

import { PROBE_CHARS, promptArrived, splitPrompt } from "./prompt-delivery.mjs";

const PROMPT =
  "# Work with Julian\n\nThis session covers the complete Goal and all linked Documents.\n\n" +
  "## Sources\n\n- Goal: /Users/julianotto/.tangent/trees/otto/tangent/goal-x.md\n\n" +
  "## How to work\n\nRead the goal first, then the area notes from nearest to farthest.";

/** A Claude Code pane around its composer line, as capture-pane returns it. */
function claudePane(composer) {
  return [
    " ▎ https://code.claude.com/docs/en/permission-modes",
    "─".repeat(120),
    `❯ ${composer}`,
    "─".repeat(120),
    "  [Fable 5] ░░░░░░░░░░ 0% (0k/1000k) $0.00 ⌛threads /private/tmp/…",
    "  paste again to expand",
  ].join("\n");
}

test("the probe is the first 24 characters", () => {
  const { probe, rest } = splitPrompt(PROMPT);
  assert.equal(probe.length, PROBE_CHARS);
  assert.equal(probe + rest, PROMPT);
});

test("a short prompt is delivered when its tail is visible", () => {
  assert.equal(promptArrived(claudePane("Read the goal first, then the area notes from nearest to farthest."), "Read the goal first, then the area notes from nearest to farthest."), true);
});

test("a long prompt is delivered when its tail is visible past line wrapping", () => {
  const pane = claudePane("…## How to workRead the goal first, then the area notes from\n  nearest to farthest.");
  assert.equal(promptArrived(pane, PROMPT), true);
});

test("Claude Code collapsing the remainder into a pasted-text marker counts as delivered", () => {
  // Real capture: send-keys strips the newlines, so the marker has no line count.
  assert.equal(promptArrived(claudePane("# Work with JulianThis[Pasted text #1]"), PROMPT), true);
  // Real capture of a bracketed paste, where the line count is shown.
  assert.equal(promptArrived(claudePane("# Work with JulianThis[Pasted text #2 +22 lines]"), PROMPT), true);
});

test("codex collapsing the remainder into a pasted-content marker counts as delivered", () => {
  const pane = ["› # Work with Julian", "  This[Pasted Content 3976 chars]", "  gpt-5.6-sol low · /private/tmp/…"].join("\n");
  assert.equal(promptArrived(pane, PROMPT), true);
});

test("a marker after a wrapped probe still counts", () => {
  const pane = claudePane("# Work with Julian\n  This[Pasted text #3 +20 lines]");
  assert.equal(promptArrived(pane, PROMPT), true);
});

test("a marker that does not follow this attempt's probe is not proof", () => {
  // The marker belongs to an earlier paste; the probe stands alone after it.
  assert.equal(promptArrived(claudePane("[Pasted text #1 +22 lines] # Work with JulianThis"), PROMPT), false);
  // The pane shows a marker but never the probe.
  assert.equal(promptArrived(claudePane("[Pasted text #1]"), PROMPT), false);
});

test("a partially taken prompt is not delivered", () => {
  assert.equal(promptArrived(claudePane("# Work with JulianThis session covers the complete Goal and"), PROMPT), false);
  assert.equal(promptArrived(claudePane(""), PROMPT), false);
});
