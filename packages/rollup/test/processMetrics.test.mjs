import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { processMetrics } from "../dist/sdk/processMetrics.js";

/** Points the rollup cache at an isolated temporary home and returns a usable repo path. */
async function isolatedRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), "metrics-test-"));
  process.env.TANGENT_ROLLUP_HOME = path.join(dir, "rollup-home");
  return dir;
}

/** Builds a fake user-message reader returning the given conversations verbatim. */
function fakeReader(conversations) {
  return async () => conversations;
}

/** Builds a correction runner stub that records calls and returns scripted results by conversation id. */
function fakeRunner(byId) {
  const calls = [];
  return {
    calls,
    /** Records the call and returns or throws the scripted result for the conversation. */
    analyze: async (input) => {
      calls.push(input.conversationId);
      const scripted = byId[input.conversationId];
      if (scripted instanceof Error) throw scripted;
      return scripted;
    }
  };
}

/** Builds an ordered list of user messages with synthetic timestamps from the given texts. */
function userMessages(...texts) {
  return texts.map((text, index) => ({ at: `2026-06-28T0${index}:00:00.000Z`, text }));
}

test("counts corrections, derives first-pass, and aggregates", async () => {
  const repo = await isolatedRepo();
  const reader = fakeReader([
    { conversationId: "a", title: "Feature A", userMessages: userMessages("do the thing", "no, not like that", "ok now ship it") },
    { conversationId: "b", title: "Feature B", userMessages: userMessages("build B", "add a test") }
  ]);
  const runner = fakeRunner({
    a: { correctionCount: 1, corrections: [{ quote: "no, not like that", why: "rejects the approach" }] },
    b: { correctionCount: 0, corrections: [] }
  });

  const result = await processMetrics({ repo, conversationIds: ["a", "b"], readMessages: reader, runner });

  assert.equal(result.schema, "metrics.rollup.v1");
  const a = result.perConversation.find((row) => row.conversationId === "a");
  const b = result.perConversation.find((row) => row.conversationId === "b");
  assert.equal(a.status, "analyzed");
  assert.equal(a.correctionCount, 1);
  assert.equal(a.firstPass, false);
  assert.equal(a.corrections[0].quote, "no, not like that");
  assert.equal(b.correctionCount, 0);
  assert.equal(b.firstPass, true);
  assert.equal(result.aggregate.conversationsAnalyzed, 2);
  assert.equal(result.aggregate.totalCorrections, 1);
  assert.equal(result.aggregate.firstPassRate, 0.5);
});

test("short-circuits conversations with fewer than two user messages without calling the runner", async () => {
  const repo = await isolatedRepo();
  const reader = fakeReader([
    { conversationId: "solo", title: "One message", userMessages: userMessages("just one prompt") }
  ]);
  const runner = fakeRunner({});

  const result = await processMetrics({ repo, conversationIds: ["solo"], readMessages: reader, runner });

  assert.equal(runner.calls.length, 0);
  assert.equal(result.perConversation[0].correctionCount, 0);
  assert.equal(result.perConversation[0].firstPass, true);
  assert.equal(result.aggregate.firstPassRate, 1);
});

test("reuses an unchanged conversation from cache on the second run", async () => {
  const repo = await isolatedRepo();
  const conversations = [
    { conversationId: "a", title: "Feature A", userMessages: userMessages("do it", "wrong, redo it") }
  ];
  const runner = fakeRunner({ a: { correctionCount: 1, corrections: [{ quote: "wrong, redo it", why: "rejects result" }] } });

  const first = await processMetrics({ repo, conversationIds: ["a"], readMessages: fakeReader(conversations), runner });
  assert.equal(first.perConversation[0].status, "analyzed");
  assert.equal(runner.calls.length, 1);

  const second = await processMetrics({ repo, conversationIds: ["a"], readMessages: fakeReader(conversations), runner });
  assert.equal(second.perConversation[0].status, "cached");
  assert.equal(second.perConversation[0].correctionCount, 1);
  assert.equal(runner.calls.length, 1, "runner is not called again for unchanged input");
});

test("re-analyzes when the user messages change", async () => {
  const repo = await isolatedRepo();
  const runner = fakeRunner({ a: { correctionCount: 0, corrections: [] } });

  await processMetrics({ repo, conversationIds: ["a"], readMessages: fakeReader([{ conversationId: "a", userMessages: userMessages("do it", "fine") }]), runner });
  const changed = await processMetrics({ repo, conversationIds: ["a"], readMessages: fakeReader([{ conversationId: "a", userMessages: userMessages("do it", "fine", "no, revert") }]), runner });

  assert.equal(changed.perConversation[0].status, "analyzed");
  assert.equal(runner.calls.length, 2);
});

test("reports a failed conversation and excludes it from the aggregate", async () => {
  const repo = await isolatedRepo();
  const reader = fakeReader([
    { conversationId: "ok", userMessages: userMessages("do it", "great") },
    { conversationId: "bad", userMessages: userMessages("do it", "hmm") }
  ]);
  const runner = fakeRunner({
    ok: { correctionCount: 0, corrections: [] },
    bad: new Error("judge timed out")
  });

  const result = await processMetrics({ repo, conversationIds: ["ok", "bad"], readMessages: reader, runner });

  const bad = result.perConversation.find((row) => row.conversationId === "bad");
  assert.equal(bad.status, "failed");
  assert.match(bad.error, /judge timed out/);
  assert.equal(result.aggregate.conversationsAnalyzed, 1, "failed conversation is excluded");
  assert.equal(result.aggregate.firstPassRate, 1);
});
