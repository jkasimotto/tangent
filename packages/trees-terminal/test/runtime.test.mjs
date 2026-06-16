import assert from "node:assert/strict";
import test from "node:test";

import { createProcessRuntimeAdapter, sanitizeTmuxEnvironment, tmuxSessionNameForEntityPath } from "../dist/index.js";

test("tmux session names are deterministic and safe", () => {
  const first = tmuxSessionNameForEntityPath("project/feature/api");
  const second = tmuxSessionNameForEntityPath("project/feature/api");
  assert.equal(first, second);
  assert.match(first, /^tt-project-feature-api-[a-f0-9]+$/);
});

test("tmux environment strips inherited tmux state", () => {
  const env = sanitizeTmuxEnvironment({ TMUX: "x", TMUX_PANE: "%1", KEEP: "yes" });
  assert.equal(env.TMUX, undefined);
  assert.equal(env.TMUX_PANE, undefined);
  assert.equal(env.KEEP, "yes");
});

test("process runtime captures output", async () => {
  const runtime = createProcessRuntimeAdapter();
  const session = await runtime.create({ id: "term_test", cwd: process.cwd() });
  await runtime.start(session.id, { command: "node", args: ["-e", "console.log('trees-process-output')"], cwd: process.cwd() });

  const capture = await waitForCapture(runtime, session.id, /trees-process-output/);
  assert.match(capture.text, /trees-process-output/);
});

async function waitForCapture(runtime, sessionId, pattern) {
  const deadline = Date.now() + 2000;
  let capture = await runtime.capture(sessionId);
  while (!pattern.test(capture.text) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    capture = await runtime.capture(sessionId);
  }
  return capture;
}
