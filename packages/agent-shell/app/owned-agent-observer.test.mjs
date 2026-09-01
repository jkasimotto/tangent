import assert from "node:assert/strict";
import test from "node:test";
import { createOwnedAgentObserver } from "./owned-agent-observer.mjs";

const session = { name: "agent-a", target: "$1", area: "otto", kind: "goal", goal: "otto/goal-one.md", pipeline: "otto/goal-one.md", assignment: "assignment-1", step: 1, state: "working", stateDetail: "none", fresh: true };

test("a failed complete observation keeps the Agent and marks only its observation unknown", async () => {
  let fails = false;
  const observer = createOwnedAgentObserver({
    /** Returns the controlled complete observation. */
    load: async () => { if (fails) throw new Error("tmux failed"); return [session]; },
    /** Suppresses the expected injected error. */
    report: () => {},
  });
  await observer.observe();
  fails = true;
  await observer.observe();
  assert.equal(observer.snapshot().rows.length, 1);
  assert.equal(observer.snapshot().rows[0].liveness, "unknown");
  assert.equal(observer.snapshot().rows[0].activity, "unknown");
  assert.equal(observer.snapshot().raw[0].name, "agent-a");
});

test("overlapping callers share one complete observation", async () => {
  let calls = 0;
  let release;
  const observer = createOwnedAgentObserver({
    /** Holds one controlled observation open. */
    load: () => { calls += 1; return new Promise((resolve) => { release = () => resolve([session]); }); },
  });
  const first = observer.observe();
  const second = observer.observe();
  release();
  assert.equal(await first, await second);
  assert.equal(calls, 1);
});
