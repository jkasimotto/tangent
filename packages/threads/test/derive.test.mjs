import assert from "node:assert/strict";
import test from "node:test";

import { deriveThreadStates } from "../dist/core/derive.js";

const now = new Date("2026-07-16T12:00:00Z");

/** Builds a minimal ParsedThread fixture, overridable per test. */
function thread(overrides = {}) {
  return {
    slug: "slug",
    node: "neara/pgande",
    path: "neara/pgande/thread-slug.md",
    status: "open",
    bodyExcerpt: "",
    ...overrides
  };
}

test("working: registered session active and not waiting", () => {
  const [derived] = deriveThreadStates([{
    thread: thread({ slug: "autodesign", owner: "Chris" }),
    sessionState: { status: "active", idleMs: 1000, lastStepKind: "other" }
  }], now);
  assert.equal(derived.state, "working");
});

test("working: human-owned thread with cadence not yet elapsed", () => {
  const [derived] = deriveThreadStates([{
    thread: thread({ slug: "stay-tool", owner: "Will", cadenceDays: 5, opened: "2026-07-15" }),
    latestNoteDateInNode: "2026-07-15"
  }], now);
  assert.equal(derived.state, "working");
  assert.match(derived.templateWhy, /check-in due in 4d/);
});

test("blocked-on-you: registered session idle at a question for more than 5 minutes", () => {
  const [derived] = deriveThreadStates([{
    thread: thread({ slug: "clearances" }),
    sessionState: { status: "active", idleMs: 6 * 60 * 1000, lastStepKind: "assistant_response" }
  }], now);
  assert.equal(derived.state, "blocked-on-you");
});

test("blocked-on-you: registered session idle at an unresolved permission prompt", () => {
  const [derived] = deriveThreadStates([{
    thread: thread({ slug: "clearances-tmpl" }),
    sessionState: { status: "active", idleMs: 10 * 60 * 1000, lastStepKind: "permission" }
  }], now);
  assert.equal(derived.state, "blocked-on-you");
});

test("not blocked: session idle at a question for under 5 minutes stays working", () => {
  const [derived] = deriveThreadStates([{
    thread: thread({ slug: "clearances" }),
    sessionState: { status: "active", idleMs: 2 * 60 * 1000, lastStepKind: "assistant_response" }
  }], now);
  assert.equal(derived.state, "working");
});

test("ready-for-you: registered session ended, thread still open", () => {
  const [derived] = deriveThreadStates([{
    thread: thread({ slug: "snap-points" }),
    sessionState: { status: "ended", idleMs: 0 }
  }], now);
  assert.equal(derived.state, "ready-for-you");
});

test("needs-you: hard deadline is today", () => {
  const [derived] = deriveThreadStates([{
    thread: thread({ slug: "guy-wires", owner: "Will", deadline: "2026-07-16" })
  }], now);
  assert.equal(derived.state, "needs-you");
  assert.match(derived.templateWhy, /deadline 2026-07-16/);
});

test("needs-you: hard deadline is in the past", () => {
  const [derived] = deriveThreadStates([{
    thread: thread({ slug: "guy-wires", owner: "Will", deadline: "2026-07-10" })
  }], now);
  assert.equal(derived.state, "needs-you");
});

test("needs-you: check-in cadence elapsed since the newest note in the thread's node", () => {
  const [derived] = deriveThreadStates([{
    thread: thread({ slug: "guy-wires", owner: "Will", cadenceDays: 2, opened: "2026-07-01" }),
    latestNoteDateInNode: "2026-07-13"
  }], now);
  assert.equal(derived.state, "needs-you");
  assert.match(derived.templateWhy, /check-in overdue/);
});

test("needs-you: deadline contributed only by an owned overview item is merged", () => {
  const [derived] = deriveThreadStates([{
    thread: thread({ slug: "staging-merge" }),
    extraDeadlines: ["2026-07-16"]
  }], now);
  assert.equal(derived.state, "needs-you");
});

test("parked: explicit wake condition in body prose", () => {
  const [derived] = deriveThreadStates([{
    thread: thread({ slug: "error-remediation", wakeCondition: "pgande-staging lands on main" })
  }], now);
  assert.equal(derived.state, "parked");
  assert.match(derived.templateWhy, /pgande-staging lands on main/);
});

test("done: closed threads are derived but marked done for the sweep to exclude", () => {
  const doneThread = deriveThreadStates([{ thread: thread({ slug: "old-one", status: "done" }) }], now)[0];
  const droppedThread = deriveThreadStates([{ thread: thread({ slug: "dropped-one", status: "dropped" }) }], now)[0];
  assert.equal(doneThread.state, "done");
  assert.equal(droppedThread.state, "done");
});

test("owner defaults to \"you\" when the body has no Owner line", () => {
  const [derived] = deriveThreadStates([{ thread: thread({ slug: "staging-merge" }) }], now);
  assert.equal(derived.owner, "you");
});
