import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyStaticPane, classifyWorkingComposer, hasRunningBackgroundShell, parseContextFill, stabilizeStaticPane, staticSinceOf } from "./pane-state.mjs";

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

test("a real idle pi composer classifies as idle: no prompt character, framed by rules", () => {
  const { text, lines } = fixture("pi-idle.txt");
  const cursorY = 32;
  assert.equal(lines[cursorY].trim(), "", "pi's composer is a blank line");
  assert.match(lines[cursorY - 1], /^─{10,}/);
  assert.match(lines[cursorY + 1], /^─{10,}/);
  assert.deepEqual(classifyStaticPane({ text, cursorX: 0, cursorY }), { kind: "idle" });
  assert.equal(classifyWorkingComposer({ text, cursorX: 0, cursorY }), "idle");
  assert.equal(classifyWorkingComposer({ text, cursorX: 7, cursorY }), "draft");
});

test("a rule line in ordinary output is not a pi composer", () => {
  const text = "output\n────────────────────\nmore output\nplain text\n";
  assert.deepEqual(classifyStaticPane({ text, cursorX: 0, cursorY: 2 }), { kind: "waiting" });
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

test("a pane waiting on a background shell it started is working, never an ask", () => {
  const { text, cursorY } = fixture("claude-background-shell.txt", /^❯(\s|$)/);
  assert.ok(cursorY >= 0, "the fixture contains a composer prompt line");
  assert.deepEqual(classifyStaticPane({ text, cursorX: 2, cursorY }), { kind: "working" }, "an empty composer over a running shell is not idle");
  assert.equal(hasRunningBackgroundShell(text), true);
});

test("the background-shell markers are read one at a time, and ordinary prose is not one", () => {
  assert.equal(hasRunningBackgroundShell("  ⎿  Running in the background (↓ to manage)"), true);
  assert.equal(hasRunningBackgroundShell("✳ Sautéed for 32s · 1 shell still running"), true);
  assert.equal(hasRunningBackgroundShell("  ⏵⏵ bypass permissions on (shift+tab to cycle) · 2 shells · ← for agents"), true);
  assert.equal(hasRunningBackgroundShell("I refactored the 3 shell helpers into one module."), false);
  assert.equal(hasRunningBackgroundShell(""), false);
});

test("a dialog still asks, even while a shell it started runs", () => {
  const { text } = fixture("claude-dialog.txt");
  const withShell = `${text}\n✳ Sautéed for 32s · 1 shell still running\n`;
  assert.equal(classifyStaticPane({ text: withShell, cursorX: 0, cursorY: 0 }).kind, "decision");
});

test("parseContextFill reads the claude statusline from idle and working panes", () => {
  for (const name of ["claude-idle.txt", "claude-working.txt"]) {
    const { text } = fixture(name);
    assert.deepEqual(parseContextFill(text), { usedTokens: 78000, windowTokens: 1000000 });
  }
});

test("parseContextFill reads the pi footer", () => {
  const { text } = fixture("pi-working.txt");
  assert.deepEqual(parseContextFill(text), { usedTokens: 68000, windowTokens: 1000000 });
});

test("parseContextFill returns null for codex, which prints no fill", () => {
  const { text } = fixture("codex-idle.txt");
  assert.equal(parseContextFill(text), null);
});

test("parseContextFill returns null for an inverted or missing reading", () => {
  assert.equal(parseContextFill("[Opus 5] ░░ 8% (1200k/1000k)"), null);
  assert.equal(parseContextFill("no status line here"), null);
});

test("a working claude pane still reports its empty composer", () => {
  const { text, cursorY } = fixture("claude-working.txt", /^❯(\s|$)/);
  assert.ok(cursorY >= 0, "the working fixture keeps a composer prompt line");
  assert.equal(classifyStaticPane({ text, cursorX: 2, cursorY }).kind, "working", "the busy marker still wins the state");
  assert.equal(classifyWorkingComposer({ text, cursorX: 2, cursorY }), "idle");
});

test("a working pane whose composer holds text is a draft, never typed into", () => {
  const { text, cursorY } = fixture("claude-working.txt", /^❯(\s|$)/);
  assert.equal(classifyWorkingComposer({ text, cursorX: 24, cursorY }), "draft");
});

test("a working codex pane reads its placeholder composer as empty", () => {
  const { text, lines, cursorY } = fixture("codex-idle.txt", /^›(\s|$)/);
  const working = `${text}\n· esc to interrupt\n`;
  assert.ok(lines[cursorY].length > 2, "the composer line holds gray placeholder text");
  assert.equal(classifyWorkingComposer({ text: working, cursorX: 2, cursorY }), "idle");
});

test("a working pane showing a dialog has no composer to type into", () => {
  const { text } = fixture("claude-dialog.txt");
  assert.equal(classifyWorkingComposer({ text, cursorX: 2, cursorY: 0 }), null);
});

test("a working pane with no recognized composer reports none", () => {
  assert.equal(classifyWorkingComposer({ text: "building…\nno composer here", cursorX: 0, cursorY: 1 }), null);
});
