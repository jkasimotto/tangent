import assert from "node:assert/strict";
import test from "node:test";
import { deriveBrainState } from "./attempt-state.mjs";

const NOW = Date.parse("2026-08-28T12:20:00.000Z");

test("undelivered notes stay with the brain before they become Julian's blocker", () => {
  const brain = { status: "active", updatedAt: "2026-08-28T12:00:00.000Z" };
  const observation = { at: NOW, fresh: true, process: "harness", activity: { lastOutputAt: NOW, source: "screen" }, composer: "draft", dialog: null, wall: null };
  const unread = [{ createdAt: "2026-08-28T12:11:00.000Z" }];
  assert.equal(deriveBrainState({ brain, observation, unread, now: NOW }).owner, "brain");
  assert.equal(deriveBrainState({ brain, observation, unread, now: NOW + 61_000 }).owner, "you");
});

test("a brain wall stops normal ownership and names repair as next actor", () => {
  const state = deriveBrainState({
    brain: { status: "active", updatedAt: "2026-08-28T12:00:00.000Z" },
    observation: { at: NOW, fresh: true, process: "harness", activity: { lastOutputAt: NOW, source: "screen" }, composer: "none", dialog: null, wall: { kind: "quota", model: "opus", text: "Quota exhausted", since: NOW - 1_000 } },
    now: NOW,
  });
  assert.equal(state.word, "Brain hit a wall");
  assert.equal(state.owner, "repair crew");
  assert.match(state.next, /repair crew/);
});
