import assert from "node:assert/strict";
import test from "node:test";
import { deriveAttemptState, deriveBrainState } from "./attempt-state.mjs";

const NOW = Date.parse("2026-08-28T12:10:00.000Z");

test("queue words beat screen words", () => {
  const state = deriveAttemptState({
    assignment: { status: "complete", reports: [{ type: "implementation-result", status: "done", summary: "done", reportedAt: "2026-08-28T12:09:00.000Z" }] },
    observation: { at: NOW, fresh: true, process: "harness", activity: { lastOutputAt: NOW, source: "screen" }, composer: "idle", dialog: null, wall: null },
    brain: { status: "active", live: true },
    now: NOW,
  });
  assert.equal(state.word, "Reported done");
  assert.equal(state.owner, "brain");
  assert.equal(state.evidence.source, "queue");
});

test("an answered worker question never remains Asked the brain", () => {
  const state = deriveAttemptState({
    assignment: {
      status: "running",
      reports: [{
        type: "question-needed", summary: "Use A or B?", reportedAt: "2026-08-28T12:09:00.000Z",
        questionState: { answer: { text: "Use A." } },
      }],
    },
    observation: { at: NOW, fresh: true, process: "harness", activity: { lastOutputAt: NOW, source: "screen" }, composer: "draft", dialog: null, wall: null },
    now: NOW,
  });
  assert.equal(state.word, "Working");
});

test("a stale observation is Unknown and never Working", () => {
  const state = deriveAttemptState({
    assignment: { status: "running" },
    observation: { at: NOW - 121_000, fresh: false, process: "harness", activity: { lastOutputAt: NOW, source: "screen" }, composer: "none", dialog: null, wall: null },
    now: NOW,
  });
  assert.equal(state.word, "Unknown");
  assert.equal(state.owner, "tangent", "a short observer outage does not create a Julian task");
});

test("only an old unknown or unhandled report becomes Julian's row", () => {
  const oldUnknown = deriveAttemptState({
    assignment: { status: "running" },
    observation: { at: NOW - 11 * 60_000, fresh: false, process: "harness", activity: { lastOutputAt: null, source: "none" }, composer: "none", dialog: null, wall: null },
    now: NOW,
  });
  assert.equal(oldUnknown.owner, "you");
  const recentReport = { status: "complete", reports: [{ type: "implementation-result", status: "complete", summary: "done", reportedAt: "2026-08-28T12:01:00.000Z" }] };
  assert.equal(deriveAttemptState({ assignment: recentReport, brain: { status: "active", live: true }, now: NOW - 1 }).owner, "brain");
  assert.equal(deriveAttemptState({ assignment: recentReport, brain: { status: "active", live: true }, now: NOW + 61_000 }).owner, "you");
});

test("Idle needs 90 seconds and an empty composer", () => {
  const base = { assignment: { status: "running", startedAt: NOW - 200_000 }, now: NOW };
  assert.equal(deriveAttemptState({ ...base, observation: { at: NOW, fresh: true, process: "harness", activity: { lastOutputAt: NOW - 89_000, source: "screen" }, composer: "idle", dialog: null, wall: null } }).word, "Working");
  assert.equal(deriveAttemptState({ ...base, observation: { at: NOW, fresh: true, process: "harness", activity: { lastOutputAt: NOW - 91_000, source: "screen" }, composer: "idle", dialog: null, wall: null } }).word, "Idle");
});

test("fresh work beats a contradictory retained wall", () => {
  const result = deriveAttemptState({
    assignment: { status: "running" }, now: NOW,
    observation: { at: NOW, fresh: true, process: "harness", activity: { lastOutputAt: NOW, source: "screen" }, composer: "none", dialog: null, wall: { kind: "auth", text: "old auth line", since: NOW - 1_000 } },
  });
  assert.equal(result.word, "Working");
});

test("a dialog under a live brain belongs to Julian", () => {
  const state = deriveAttemptState({
    assignment: { status: "running" },
    observation: { at: NOW, fresh: true, process: "harness", activity: { lastOutputAt: null, source: "none" }, composer: "none", dialog: { question: "Approve?", source: "screen" }, wall: null },
    brain: { status: "active", live: true },
    now: NOW,
  });
  assert.equal(state.word, "Needs your decision");
  assert.equal(state.owner, "you");
});

test("a stopped brain gives a reported row to the repair crew after three minutes", () => {
  const assignment = { status: "complete", reports: [{ type: "implementation-result", status: "done", summary: "done", reportedAt: "2026-08-28T12:00:00.000Z" }] };
  const brain = { status: "inactive", updatedAt: "2026-08-28T12:05:00.000Z", live: false };
  assert.equal(deriveAttemptState({ assignment, brain, now: NOW }).owner, "repair crew");
});

test("brain state names idle, dialog, wall, and stopped truthfully", () => {
  const idle = deriveBrainState({ brain: { status: "active", updatedAt: "2026-08-28T12:00:00.000Z" }, observation: { at: NOW, fresh: true, process: "harness", activity: { lastOutputAt: NOW - 100_000, source: "screen" }, composer: "idle", dialog: null, wall: null }, now: NOW });
  assert.equal(idle.word, "Brain idle");
  assert.equal(deriveBrainState({ brain: { status: "inactive", updatedAt: "2026-08-28T12:00:00.000Z" }, now: NOW }).word, "Brain stopped");
});

test("an unread brain inbox stays low-noise for ten minutes", () => {
  const brain = { status: "active", updatedAt: "2026-08-28T12:00:00.000Z" };
  const observation = { at: NOW, fresh: true, process: "harness", activity: { lastOutputAt: NOW, source: "screen" }, composer: "draft", dialog: null, wall: null };
  const unread = [{ createdAt: "2026-08-28T12:01:00.000Z" }];
  assert.equal(deriveBrainState({ brain, observation, unread, now: NOW }).owner, "brain");
  assert.equal(deriveBrainState({ brain, observation, unread, now: NOW + 61_000 }).owner, "you");
});
