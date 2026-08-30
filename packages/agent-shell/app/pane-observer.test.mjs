import assert from "node:assert/strict";
import test from "node:test";
import { createPaneObserver } from "./pane-observer.mjs";

test("pane observer owns samples and forgets sessions that ended", async () => {
  let at = 1_000;
  let text = "working frame";
  const observer = createPaneObserver({
    /** Returns fixture pane text and cursor coordinates. */
    runTmux: async (args) => args[0] === "capture-pane" ? { stdout: text } : { stdout: "0 0" },
    shellCommands: new Set(["zsh"]),
    minSampleMs: 10,
    waitStableMs: 0,
    /** Returns the mutable fixture clock. */
    now: () => at,
  });
  const session = { name: "agent", command: "claude", kind: "goal" };
  assert.equal((await observer.enrich([session]))[0].state, "working");
  at += 20;
  assert.equal((await observer.enrich([session]))[0].state, "waiting");
  assert.equal((await observer.enrich([{ name: "shell", command: "zsh", kind: "goal" }]))[0].state, "shell");
  assert.equal(observer.context("agent"), null, "an ended session's sample is forgotten");
});

test("pane observer leaves process sessions out of agent classification", async () => {
  const observer = createPaneObserver({
    /** Rejects unexpected process-pane sampling. */
    runTmux: async () => { throw new Error("process panes are not sampled"); },
    shellCommands: new Set(["zsh"]),
  });
  const [running, stopped] = await observer.enrich([
    { name: "server", command: "node", kind: "process" },
    { name: "done", command: "zsh", kind: "command" },
  ]);
  assert.equal(running.state, "service");
  assert.equal(stopped.state, "stopped");
});

test("pane observer bounds capture fan-out for a large session snapshot", async () => {
  let active = 0;
  let peak = 0;
  const observer = createPaneObserver({
    /** Records how many synthetic tmux captures overlap. */
    runTmux: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { stdout: "working" };
    },
    shellCommands: new Set(["zsh"]),
    concurrency: 8,
  });
  const sessions = Array.from({ length: 200 }, (_, index) => ({ name: `agent-${index}`, command: "claude", kind: "goal" }));
  assert.equal((await observer.enrich(sessions)).length, 200);
  assert.equal(peak, 8);
});

test("pane observer reports the composer of a brain that keeps working", async () => {
  // Without this the message queue cannot tell a busy brain with an empty
  // composer from one whose composer holds Julian's half-typed words.
  let at = 1_000;
  let frame = 0;
  let cursorX = 2;
  const observer = createPaneObserver({
    /** Repaints a claude working screen with a composer at row 1. */
    runTmux: async (args) => args[0] === "capture-pane"
      ? { stdout: `✳ Simmering… (esc to interrupt · ${(frame += 1)}s)\n❯ \n` }
      : { stdout: `${cursorX} 1` },
    shellCommands: new Set(["zsh"]),
    minSampleMs: 10,
    waitStableMs: 0,
    /** Returns the mutable fixture clock. */
    now: () => at,
  });
  const brain = { name: "tangent-brain-g313", command: "claude", kind: "brain" };
  const working = (await observer.enrich([brain]))[0];
  assert.equal(working.state, "working");
  assert.equal(working.composer, "idle");
  at += 20;
  cursorX = 24;
  const composing = (await observer.enrich([brain]))[0];
  assert.equal(composing.state, "working");
  assert.equal(composing.composer, "draft");
});

test("one unchanged quota wall keeps its original observation time", async () => {
  let at = 1_000;
  const observer = createPaneObserver({
    /** Returns one deterministic pane sample for this fixture. */
    runTmux: async (args) => args[0] === "capture-pane" ? { stdout: "You've reached your Opus limit" } : { stdout: "0 0" },
    shellCommands: new Set(["zsh"]),
    minSampleMs: 10,
    waitStableMs: 0,
    /** Returns the fixture clock. */
    now: () => at,
  });
  const session = { name: "agent", command: "claude", kind: "goal", launchRef: "claude-otto/opus" };
  await observer.enrich([session]);
  at += 20;
  const first = (await observer.enrich([session]))[0];
  assert.equal(first.observation.wall.since, 1_020);
  assert.equal(first.observation.wall.harness, "claude-otto");
  assert.equal(first.observation.wall.pattern, "claude-quota-reached-v1");
  at += 20;
  const second = (await observer.enrich([session]))[0];
  assert.equal(second.observation.wall.since, 1_020);
});

test("active output clears wall text and an observer restart requires a new static sample", async () => {
  let at = 1_000;
  let text = "You've reached your Opus limit";
  const options = {
    /** Returns the mutable pane and its cursor. */
    runTmux: async (args) => args[0] === "capture-pane" ? { stdout: text } : { stdout: "0 0" },
    shellCommands: new Set(["zsh"]), minSampleMs: 10, waitStableMs: 0,
    /** Returns the fixture clock. */
    now: () => at,
  };
  const session = { name: "agent", command: "claude", kind: "goal", launchRef: "claude/opus" };
  const observer = createPaneObserver(options);
  await observer.enrich([session]);
  at += 20;
  assert.ok((await observer.enrich([session]))[0].observation.wall);
  text += "\nnew output";
  at += 20;
  const active = (await observer.enrich([session]))[0];
  assert.equal(active.state, "working");
  assert.equal(active.observation.wall, null);
  const restarted = createPaneObserver(options);
  at += 20;
  assert.equal((await restarted.enrich([session]))[0].observation.wall, null);
});

test("a shell exit wins over retained wall scrollback", async () => {
  const observer = createPaneObserver({
    /** Rejects a capture after the observer identifies the shell. */
    runTmux: async () => { throw new Error("must not capture shell"); },
    shellCommands: new Set(["zsh"]),
    /** Returns a fixed fixture time. */
    now: () => 1_000,
  });
  const result = (await observer.enrich([{ name: "agent", command: "zsh", kind: "goal", launchRef: "claude/opus" }]))[0];
  assert.equal(result.state, "shell");
  assert.equal(result.observation.wall, null);
});
