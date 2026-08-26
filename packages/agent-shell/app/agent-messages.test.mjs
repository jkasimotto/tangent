import { test } from "node:test";
import assert from "node:assert/strict";

import { deliveryDecision, messageBanner, noticeMessage, normalizeMessage } from "./agent-messages.mjs";

test("the banner names the sender and its area", () => {
  assert.equal(
    messageBanner("dnd-entities-have-ids-collaborate", "otto/dnd", "What did you rename?"),
    "[Message from dnd-entities-have-ids-collaborate (otto/dnd)] What did you rename?"
  );
  assert.equal(messageBanner("orchestrator", null, "hi"), "[Message from orchestrator] hi");
});

test("delivery happens only into an empty composer", () => {
  assert.deepEqual(
    deliveryDecision({ name: "a", kind: "goal", state: "waiting", stateDetail: "idle" }),
    { action: "deliver", composer: "idle" }
  );
});

test("a working target with no observed composer queues", () => {
  const decision = deliveryDecision({ name: "a", kind: "goal", state: "working", stateDetail: null });
  assert.equal(decision.action, "queue");
});

test("a working brain with an empty composer is delivered to mid-turn", () => {
  // The blocked case: a worker's typed report reached a brain that had been
  // working for the whole pipeline, so its composer never went idle.
  assert.deepEqual(
    deliveryDecision({ name: "tangent-brain-g313", kind: "brain", state: "working", stateDetail: null, composer: "idle" }),
    { action: "deliver", composer: "working" }
  );
});

test("a working target composing text queues rather than corrupting it", () => {
  const decision = deliveryDecision({ name: "a", kind: "goal", state: "working", stateDetail: null, composer: "draft" });
  assert.equal(decision.action, "queue");
  assert.match(decision.reason, /unsent text/);
});

test("an idle composer still reports which composer took the message", () => {
  assert.deepEqual(
    deliveryDecision({ name: "a", kind: "goal", state: "waiting", stateDetail: "idle" }),
    { action: "deliver", composer: "idle" }
  );
});

test("a decision dialog queues rather than answers itself", () => {
  const decision = deliveryDecision({ name: "a", kind: "goal", state: "waiting", stateDetail: "decision" });
  assert.equal(decision.action, "queue");
  assert.match(decision.reason, /decision dialog/);
});

test("an unsent draft queues rather than being corrupted", () => {
  const decision = deliveryDecision({ name: "a", kind: "goal", state: "waiting", stateDetail: "draft" });
  assert.equal(decision.action, "queue");
});

test("an unrecognized static screen queues, never delivers", () => {
  const decision = deliveryDecision({ name: "a", kind: "goal", state: "waiting", stateDetail: null });
  assert.equal(decision.action, "queue");
});

test("a shell pane refuses because text would execute", () => {
  const decision = deliveryDecision({ name: "a", kind: "goal", state: "shell", stateDetail: null });
  assert.equal(decision.action, "refuse");
  assert.match(decision.error, /shell/);
});

test("process sessions and missing sessions refuse", () => {
  assert.equal(deliveryDecision({ name: "hmr", kind: "process", state: "service" }).action, "refuse");
  assert.equal(deliveryDecision(null).action, "refuse");
});

test("messages collapse whitespace and reject empties", () => {
  assert.equal(normalizeMessage("  two\n lines  "), "two lines");
  assert.throws(() => normalizeMessage("   "), /write the message/);
  assert.throws(() => normalizeMessage("x".repeat(4001)), /4000/);
});

test("a brain notice is clipped, never refused, however long its text is", () => {
  // Julian answered a Request with 9341 characters pasted from a brain
  // prompt. normalizeMessage threw, notifyBrain caught the throw, and the
  // answer was never written to the inbox: no generation ever saw it.
  const answer = `Julian wants these changes: ${"x".repeat(9000)}`;
  const notice = noticeMessage(answer);
  assert.ok(notice.length <= 4000, `clipped to ${notice.length} characters`);
  assert.match(notice, /^Julian wants these changes: x+/);
  assert.match(notice, /clipped from \d+ characters/);
  assert.equal(noticeMessage("  two\n lines  "), "two lines");
  assert.throws(() => noticeMessage("   "), /a notice needs text/);
});

test("a pane with a prompt already on its way holds every message back", () => {
  // A brain generation that is booting shows a working pane with an empty
  // composer for the whole time its activation prompt takes to arrive, so the
  // composer alone would have said "deliver" and the two texts would have
  // been typed into the pane together.
  const booting = { name: "tangent-brain-g314", kind: "brain", state: "working", composer: "idle", promptPending: true };
  const decision = deliveryDecision(booting);
  assert.equal(decision.action, "queue");
  assert.match(decision.reason, /still taking a prompt/);
  assert.equal(deliveryDecision({ ...booting, state: "waiting", stateDetail: "idle" }).action, "queue");
  assert.deepEqual(deliveryDecision({ ...booting, promptPending: false }), { action: "deliver", composer: "working" });
});
