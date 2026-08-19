import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyStaticPane, stabilizeStaticPane, staticSinceOf } from "./pane-state.mjs";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "panes");

/** Loads a fixture and derives the cursor row from its composer prompt line. */
function fixture(name, promptPattern) {
  const text = readFileSync(path.join(fixturesDir, name), "utf8");
  const lines = text.split("\n");
  const cursorY = promptPattern ? lines.findIndex((line) => promptPattern.test(line)) : 0;
  return { text, lines, cursorY };
}

test("a real idle claude composer classifies as idle", () => {
  const { text, cursorY } = fixture("claude-idle.txt", /^❯(\s|$)/);
  assert.ok(cursorY >= 0, "the fixture contains a composer prompt line");
  assert.deepEqual(classifyStaticPane({ text, cursorX: 2, cursorY }), { kind: "idle" });
});

test("a real idle codex composer classifies as idle despite placeholder text", () => {
  const { text, lines, cursorY } = fixture("codex-idle.txt", /^›(\s|$)/);
  assert.ok(cursorY >= 0, "the fixture contains a composer prompt line");
  assert.ok(lines[cursorY].length > 2, "the composer line holds gray placeholder text");
  assert.deepEqual(classifyStaticPane({ text, cursorX: 2, cursorY }), { kind: "idle" });
});

test("a claude permission dialog classifies as decision with its question", () => {
  const { text } = fixture("claude-dialog.txt");
  const result = classifyStaticPane({ text, cursorX: 0, cursorY: 0 });
  assert.equal(result.kind, "decision");
  assert.match(result.question, /Do you want to proceed\?/);
});

test("a busy marker beats the composer even on a static screen", () => {
  const { text, cursorY } = fixture("claude-working.txt", /^❯(\s|$)/);
  assert.deepEqual(classifyStaticPane({ text, cursorX: 2, cursorY }), { kind: "working" });
});

test("a paused pi working screen remains working", () => {
  const { text } = fixture("pi-working.txt");
  assert.deepEqual(classifyStaticPane({ text, cursorX: 0, cursorY: 2 }), { kind: "working" });
});

test("a composer with unsent text classifies as draft", () => {
  const { text, cursorY } = fixture("claude-draft.txt", /^❯(\s|$)/);
  assert.deepEqual(classifyStaticPane({ text, cursorX: 25, cursorY }), { kind: "draft" });
});

test("an unrecognized static screen stays plain waiting", () => {
  const text = "some TUI\nwith unknown chrome\nand no prompt";
  assert.deepEqual(classifyStaticPane({ text, cursorX: 0, cursorY: 2 }), { kind: "waiting" });
});

test("an unrecognized static pane must remain quiet before it waits", () => {
  const pending = stabilizeStaticPane({
    classification: { kind: "waiting" },
    now: 10_000,
    thresholdMs: 8_000,
  });
  assert.deepEqual(pending, { classification: { kind: "working" }, quietSince: 10_000 });
  assert.deepEqual(stabilizeStaticPane({
    classification: { kind: "waiting" },
    quietSince: pending.quietSince,
    now: 17_999,
    thresholdMs: 8_000,
  }), { classification: { kind: "working" }, quietSince: 10_000 });
  assert.deepEqual(stabilizeStaticPane({
    classification: { kind: "waiting" },
    quietSince: pending.quietSince,
    now: 18_000,
    thresholdMs: 8_000,
  }), { classification: { kind: "waiting" }, quietSince: 10_000 });
});

test("positive static-pane signals bypass the generic wait delay", () => {
  for (const classification of [{ kind: "idle" }, { kind: "draft" }, { kind: "decision", question: "Continue?" }, { kind: "working" }]) {
    assert.deepEqual(
      stabilizeStaticPane({ classification, quietSince: 1, now: 2, thresholdMs: 8_000 }),
      { classification, quietSince: null },
    );
  }
});

test("a dialog wins over the composer prompt on the same screen", () => {
  const { text } = fixture("claude-dialog.txt");
  // The selected option row starts with the same ❯ character as the composer.
  const result = classifyStaticPane({ text, cursorX: 2, cursorY: 7 });
  assert.equal(result.kind, "decision");
});

test("staticSinceOf: the first equal hash starts the clock, a later one keeps it", () => {
  assert.equal(staticSinceOf({ previous: { hash: "a", state: "working" }, hash: "a", now: 500 }), 500);
  assert.equal(staticSinceOf({ previous: { hash: "a", state: "waiting", staticSince: 500 }, hash: "a", now: 900 }), 500);
});

test("staticSinceOf: a repaint, a missing sample, or a shell sample has no static start", () => {
  assert.equal(staticSinceOf({ previous: { hash: "a", state: "waiting", staticSince: 500 }, hash: "b", now: 900 }), null);
  assert.equal(staticSinceOf({ previous: undefined, hash: "a", now: 900 }), null);
  assert.equal(staticSinceOf({ previous: { hash: "a", state: "shell", staticSince: 500 }, hash: "a", now: 900 }), null);
});
