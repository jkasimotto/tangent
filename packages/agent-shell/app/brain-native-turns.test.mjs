import assert from "node:assert/strict";
import test from "node:test";
import { claudeTranscriptPath, createRememberedTurnMonitor, rememberedUserTurns, requestsTurnMemory } from "./brain-native-turns.mjs";

test("remember this selects the complete native turn and preserves its line breaks", () => {
  const text = "I keep repeating this.\nRemember this.\nI am still unsure.";
  assert.equal(requestsTurnMemory(text), true);
  assert.equal(requestsTurnMemory("Can you remember that conclusion?"), false);
  assert.equal(requestsTurnMemory("/remember the whole current turn"), true);
  assert.deepEqual(rememberedUserTurns([
    { id: "plain", role: "user", text: "An ordinary question." },
    { id: "native-1", role: "user", text, createdAt: "2026-08-28T04:00:00.000Z" },
  ]), [{ id: "native-1", text, createdAt: "2026-08-28T04:00:00.000Z" }]);
});

test("Claude transcript resolution keeps the native session id and exact vault cwd", () => {
  assert.equal(
    claudeTranscriptPath("/profiles/claude/projects", "/Users/me/.tangent/trees/otto/tangent", "session-1"),
    "/profiles/claude/projects/-Users-me--tangent-trees-otto-tangent/session-1.jsonl",
  );
});

test("a failed commit receives no success state and remains retryable", async () => {
  const attempts = [];
  let clock = 0;
  const monitor = createRememberedTurnMonitor({
    /** Supplies the owning harness. */
    harnessFor: async () => ({ id: "claude", transcripts: "/profiles/claude/projects" }),
    /** Supplies an unchanged native file. */
    fileStat: async () => ({ mtimeMs: 1 }),
    /** Supplies one marked native message. */
    readMessages: async () => [{ id: "native-1", role: "user", text: "Remember this.\nExact." }],
    /** Refuses the first commit and accepts the retry. */
    capture: async (_record, turn) => {
      attempts.push(turn.id);
      return attempts.length === 1 ? { route: "not-committed", commitError: "refused" } : { route: "duplicate" };
    },
    /** The test needs no delivery side effect. */
    failure: async () => {},
    /** Controls the retry clock. */
    now: () => clock,
  });
  const record = {
    area: "otto/tangent", status: "active", session: "brain",
    generations: [{ generation: 1, session: "brain", cwd: "/Users/me/.tangent/trees/otto/tangent", providerSession: { id: "session-1" }, resolvedLaunch: { ref: { harness: "claude" } } }],
  };
  await monitor.check(record);
  await monitor.check(record);
  assert.deepEqual(attempts, ["native-1"], "the immediate poll does not claim or repeat success");
  clock = 5_000;
  await monitor.check(record);
  assert.deepEqual(attempts, ["native-1", "native-1"], "the unchanged native turn retries after a failed commit");
});
