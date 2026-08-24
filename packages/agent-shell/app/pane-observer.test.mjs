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
