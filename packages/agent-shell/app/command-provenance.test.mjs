import assert from "node:assert/strict";
import test from "node:test";

import { areaInboxTarget, commandActor } from "./command-provenance.mjs";

const brains = [{
  area: "neara/essential/autodesign",
  session: "autodesign-brain-g3",
  currentAttemptId: "autodesign-brain-g3",
  generations: [{ session: "autodesign-brain" }, { session: "autodesign-brain-g2" }, { session: "autodesign-brain-g3" }],
}];

test("command provenance records identity without granting by Area", () => {
  const sessions = [{ name: "essential-brain", area: "neara/essential", kind: "brain" }, { name: "worker", area: "otto/tangent", kind: "goal" }];
  assert.deepEqual(commandActor("essential-brain", { sessions, brains }), { session: "essential-brain", area: "neara/essential", role: "brain" });
  assert.deepEqual(commandActor("worker", { sessions, brains }), { session: "worker", area: "otto/tangent", role: "worker" });
  assert.deepEqual(commandActor("autodesign-brain-g2", { sessions, brains }), { session: "autodesign-brain-g2", area: "neara/essential/autodesign", role: "brain" });
  assert.deepEqual(commandActor("unknown", { sessions, brains }), { session: "unknown", area: null, role: "local-session" });
  assert.deepEqual(commandActor("", { sessions, brains }), { session: null, area: null, role: "local-shell" });
});

test("Area messages accept exact paths and known stale brain sessions only", () => {
  const areas = ["neara/essential", "neara/essential/autodesign"];
  assert.deepEqual(areaInboxTarget("neara/essential/autodesign", { areas, brains }), { area: "neara/essential/autodesign", via: "area" });
  assert.deepEqual(areaInboxTarget("autodesign-brain-g2", { areas, brains }), { area: "neara/essential/autodesign", via: "brain-session" });
  assert.equal(areaInboxTarget("autodesign", { areas, brains }), null);
  assert.equal(areaInboxTarget("gone", { areas, brains }), null);
});
