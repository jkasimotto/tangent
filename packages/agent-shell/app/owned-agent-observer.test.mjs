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

test("transport-only observation times do not invalidate Work", async () => {
  let pass = 0;
  let notifications = 0;
  const observer = createOwnedAgentObserver({
    /** Returns equal Agent facts with a new raw observation time. */
    load: async () => [{ ...session, observedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, pass++)).toISOString() }],
  });
  observer.subscribe(() => { notifications += 1; });

  const first = await observer.observe();
  const second = await observer.observe();

  assert.equal(notifications, 1);
  assert.equal(second.rows[0], first.rows[0]);
  assert.equal(second.rows[0].observedAt, first.rows[0].observedAt);
  assert.equal(second.rows[0].activitySince, null);
  assert.notEqual(second.observedAt, null);
});
