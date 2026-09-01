import { test } from "node:test";
import assert from "node:assert/strict";

import { PROBE_CHARS, TYPE_CHUNK_CHARS, activeComposer, promptArrived, promptStaged, readyForText, splitPrompt, submissionReceipt, typeChunks } from "./prompt-delivery.mjs";

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

test("literal terminal input is chunked without losing or reordering text", () => {
  const input = "brain prompt ".repeat(2_000);
  const chunks = typeChunks(input);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= TYPE_CHUNK_CHARS));
  assert.equal(chunks.join(""), input);
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

test("old matching output cannot prove that the active composer holds this attempt", () => {
  const text = [
    `old output: ${PROMPT}`,
    "task finished",
    "› Ask Codex to do anything",
    "gpt-5.6-sol high · /private/tmp/work",
  ].join("\n");
  const sample = { text, cursorX: 2, cursorY: text.split("\n").length - 2, composer: "idle" };
  assert.equal(promptArrived(text, PROMPT), true, "the old whole-pane receipt would pass");
  assert.equal(promptStaged(sample, PROMPT), false, "the active empty editor does not pass");
  assert.equal(activeComposer(sample).text, "› Ask Codex to do anything");
});

test("a wrapped draft remains staged after its prompt marker scrolls away", () => {
  const tail = PROMPT.slice(-40);
  const lines = Array.from({ length: 18 }, (_, index) => `wrapped editor row ${index}`);
  lines[17] = tail;
  const sample = { text: lines.join("\n"), cursorX: tail.length, cursorY: 17, composer: null };
  assert.equal(promptStaged(sample, PROMPT), true);
});

test("collapsed paste is staged until a positive post-submit receipt appears", () => {
  const staged = {
    text: claudePane("# Work with JulianThis[Pasted text #2 +22 lines]"),
    cursorX: 58,
    cursorY: 2,
    composer: "draft",
  };
  assert.equal(promptStaged(staged, PROMPT), true);
  assert.equal(submissionReceipt(staged, staged, PROMPT), "staged", "a paste marker is not a submission receipt");
  const submitted = {
    text: `${staged.text.replace("❯ # Work with JulianThis[Pasted text #2 +22 lines]", "SUBMITTED\n❯ ")}`,
    cursorX: 2,
    cursorY: 3,
    composer: "idle",
  };
  assert.equal(submissionReceipt(staged, submitted, PROMPT), "submitted");
});

test("a redraw that only clears the editor is ambiguous", () => {
  const before = { text: "> exact draft\nstatus", cursorX: 13, cursorY: 0, composer: "draft" };
  const after = { text: "> \nstatus", cursorX: 2, cursorY: 0, composer: "idle" };
  assert.equal(submissionReceipt(before, after, "exact draft"), "ambiguous");
});

test("a pre-existing busy marker or changing timer is not a submission receipt", () => {
  const before = { text: "> exact draft\nesc to interrupt\nWorking… 1s", cursorX: 13, cursorY: 0, composer: "draft" };
  const sameMarker = { text: "> \nesc to interrupt\nWorking… 1s", cursorX: 2, cursorY: 0, composer: "idle" };
  const changedTimer = { text: "> \nesc to interrupt\nWorking… 2s", cursorX: 2, cursorY: 0, composer: "idle" };
  assert.equal(submissionReceipt(before, sameMarker, "exact draft"), "ambiguous");
  assert.equal(submissionReceipt(before, changedTimer, "exact draft"), "ambiguous");
});

test("each supported harness shape supplies new prompt-specific submission evidence", () => {
  const prompt = "exact harness prompt";
  const shapes = [
    { harness: "Claude", before: "❯ exact harness prompt", after: "exact harness prompt\n✳ Working… esc to interrupt\n❯ " },
    { harness: "Codex", before: "› exact harness prompt", after: "exact harness prompt\nesc to interrupt\n› " },
    { harness: "Pi", before: "────────────\nexact harness prompt\n────────────", beforeY: 1, after: "exact harness prompt\nWorking…\n────────────\n\n────────────", afterY: 3 },
    { harness: "Agy/generic", before: "> exact harness prompt", after: "exact harness prompt\n> " },
  ];
  for (const { harness, before: beforeText, beforeY, after: afterText, afterY } of shapes) {
    const beforeLines = beforeText.split("\n");
    const afterLines = afterText.split("\n");
    const beforeCursorY = beforeY ?? beforeLines.length - 1;
    const afterCursorY = afterY ?? afterLines.length - 1;
    const before = { text: beforeText, cursorX: beforeLines[beforeCursorY].length, cursorY: beforeCursorY, composer: "draft" };
    const after = { text: afterText, cursorX: afterLines[afterCursorY].length, cursorY: afterCursorY, composer: "idle" };
    assert.equal(submissionReceipt(before, after, prompt), "submitted", harness);
  }
});

test("a partially taken prompt is not delivered", () => {
  assert.equal(promptArrived(claudePane("# Work with JulianThis session covers the complete Goal and"), PROMPT), false);
  assert.equal(promptArrived(claudePane(""), PROMPT), false);
});

test("a mid-turn pane is typed into only while its composer is still empty", () => {
  // Read fresh at the moment of typing: the delivery decision's sample can be
  // older than the moment Julian started typing.
  const shellCommands = new Set(["zsh", "bash"]);
  assert.equal(readyForText({ command: "claude", composer: "idle", shellCommands }), true);
  assert.equal(readyForText({ command: "claude", composer: "draft", shellCommands }), false, "words already in the composer are never typed over");
  assert.equal(readyForText({ command: "claude", composer: null, shellCommands }), false, "an unrecognized composer is never typed into");
});

test("a mid-turn pane sitting at a shell is never typed into", () => {
  const shellCommands = new Set(["zsh", "bash"]);
  assert.equal(readyForText({ command: "zsh", composer: "idle", shellCommands }), false);
  assert.equal(readyForText({ command: "", composer: "idle", shellCommands }), false, "a gone session takes nothing");
});
