import assert from "node:assert/strict";
import test from "node:test";
import { createPaneWriteQueue } from "./pane-writes.mjs";

/** Resolves after the given number of event-loop turns. */
async function turns(count) {
  for (let turn = 0; turn < count; turn += 1) await Promise.resolve();
}

test("two writers into one pane never overlap", async () => {
  const queue = createPaneWriteQueue();
  const trace = [];
  let openFirst;
  let openSecond;
  /** Records one write's span around a gate the test opens by hand. */
  const write = (label, gate) => async () => {
    trace.push(`${label}:start`);
    await gate;
    trace.push(`${label}:end`);
    return label;
  };
  const first = queue.run("brain", write("prompt", new Promise((resolve) => { openFirst = resolve; })));
  const second = queue.run("brain", write("notice", new Promise((resolve) => { openSecond = resolve; })));

  await turns(4);
  assert.deepEqual(trace, ["prompt:start"], "the second writer waits for the first");
  assert.equal(queue.busy("brain"), true);

  openFirst();
  await turns(4);
  assert.deepEqual(trace, ["prompt:start", "prompt:end", "notice:start"]);

  openSecond();
  assert.deepEqual(await Promise.all([first, second]), ["prompt", "notice"]);
  await turns(4);
  assert.equal(queue.busy("brain"), false, "the pane is free once its writes settle");
});

test("panes are independent and a failed write does not block the pane", async () => {
  const queue = createPaneWriteQueue();
  const done = [];
  /** Fails once, so the writer behind it must still run. */
  const boom = async () => { throw new Error("tmux went away"); };
  const failed = queue.run("brain", boom);
  await assert.rejects(failed, /tmux went away/);
  assert.equal(await queue.run("brain", async () => { done.push("after"); return "after"; }), "after");
  assert.equal(await queue.run("worker", async () => "elsewhere"), "elsewhere");
  assert.deepEqual(done, ["after"]);
  assert.equal(queue.busy("brain"), false);
  assert.equal(queue.busy("worker"), false);
});
