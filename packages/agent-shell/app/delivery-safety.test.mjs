import assert from "node:assert/strict";
import test from "node:test";
import { deliveryDecision } from "./agent-messages.mjs";

test("a decision dialog never receives typed delivery", () => {
  const target = {
    name: "worker",
    kind: "goal",
    state: "waiting",
    stateDetail: "decision",
    composer: "idle",
    stateQuestion: "1. Allow once",
  };

  assert.deepEqual(deliveryDecision(target), {
    action: "queue",
    reason: "worker waits on a decision dialog",
  });
});

test("only an unexpired repair crew is eligible for Area delivery", () => {
  const liveCrew = { name: "tangent-repair", kind: "repair", state: "working", composer: "idle" };
  assert.deepEqual(deliveryDecision(liveCrew), { action: "deliver", composer: "working" });
  assert.equal(deliveryDecision({ ...liveCrew, state: "shell", composer: "none" }).action, "refuse");
});
