import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { attemptsInWindow, brainAttempts, jobAttempts, priceAttempts, repairAttempts } from "./job-cost.mjs";
import { claudeProjectKey } from "./harness-transcripts.mjs";
import { inWindow, summarizeCost, summarizeWorkers } from "./cost-service.mjs";

const CWD = "/Users/fixture/Projects/thing";
const AREA = "otto/tangent";

/** A scratch state root that is never the real Agent Shell state. */
async function scratchRoot() {
  return mkdtemp(path.join(os.tmpdir(), "job-cost-"));
}

/** Writes one Claude transcript whose ledger reports an exact figure. */
async function writeLedger(root, id, amount, model = "claude-opus-5") {
  const file = path.join(root, claudeProjectKey(CWD), `${id}.jsonl`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({
    type: "cost-state", totalCostUSD: amount,
    modelUsage: { [model]: { inputTokens: 1, outputTokens: 1, costUSD: amount } },
  }) + "\n", "utf8");
}

/** One attempt as a Job record stores it. */
function attempt({ id, conversation, startedAt = "2026-09-03T04:00:00.000Z", harness = "claude-otto", provider = "anthropic" }) {
  return {
    id,
    resolvedLaunch: { ref: { harness, model: "opus-5", effort: null, provider }, command: "claude", label: "Claude" },
    providerSession: conversation,
    cwd: CWD,
    startedAt,
    endedAt: null,
  };
}

/** The harness registry entry the fixture prices against. */
function registryFor(root) {
  const harnesses = [{ id: "claude-otto", transcripts: root }, { id: "codex-gw" }];
  /** Finds one fixture harness by id. */
  return (id) => harnesses.find((entry) => entry.id === id) ?? null;
}

test("a Job's cost is the sum of every conversation its attempts ran in", async () => {
  const root = await scratchRoot();
  await writeLedger(root, "conv-a", 4);
  await writeLedger(root, "conv-b", 6);
  const record = {
    goal: `${AREA}/goal-thing.md`, area: AREA,
    steps: [
      { attempts: [attempt({ id: "one", conversation: { harness: "claude-otto", id: "conv-a" } })] },
      { attempts: [attempt({ id: "two", conversation: { harness: "claude-otto", id: "conv-b" } })] },
    ],
  };
  const priced = await priceAttempts(jobAttempts(record, AREA, "thing"), { harnessFor: registryFor(root) });
  assert.equal(priced.amount, 10);
  assert.equal(priced.conversations.length, 2);
  assert.equal(priced.complete, true);
});

test("a resumed Job is charged once, because two attempts share one conversation", async () => {
  const root = await scratchRoot();
  await writeLedger(root, "conv-resumed", 7.5);
  const record = {
    goal: `${AREA}/goal-resumed.md`, area: AREA,
    steps: [{ attempts: [
      attempt({ id: "one", conversation: { harness: "claude-otto", id: "conv-resumed" } }),
      attempt({ id: "two", conversation: { harness: "claude-otto", id: "conv-resumed" } }),
    ] }],
  };
  const priced = await priceAttempts(jobAttempts(record, AREA, "resumed"), { harnessFor: registryFor(root) });
  assert.equal(priced.amount, 7.5);
  assert.equal(priced.conversations.length, 1);
  assert.equal(priced.conversations[0].attempts.length, 2);
});

test("a brain's generations are priced beside Jobs, not left out of the total", async () => {
  const root = await scratchRoot();
  await writeLedger(root, "conv-brain", 32);
  const attempts = brainAttempts({
    area: AREA,
    generations: [{ ...attempt({ id: "gen-1", conversation: { harness: "claude-otto", id: "conv-brain" } }) }],
  });
  assert.equal(attempts[0].scope, "brain");
  const priced = await priceAttempts(attempts, { harnessFor: registryFor(root) });
  assert.equal(priced.amount, 32);
});

test("an attempt that cannot be reached is named with its reason, not silently dropped", async () => {
  const root = await scratchRoot();
  await writeLedger(root, "conv-ok", 1);
  const attempts = jobAttempts({
    goal: `${AREA}/goal-mixed.md`, area: AREA,
    steps: [{ attempts: [
      attempt({ id: "ok", conversation: { harness: "claude-otto", id: "conv-ok" } }),
      attempt({ id: "no-transcripts", conversation: { harness: "codex-gw", id: "x" }, harness: "codex-gw" }),
      attempt({ id: "no-conversation", conversation: null }),
      attempt({ id: "gone", conversation: { harness: "claude-otto", id: "conv-missing" } }),
      { id: "legacy", providerSession: null, cwd: CWD, startedAt: "2026-09-03T04:00:00.000Z" },
    ] }],
  }, AREA, "mixed");
  const priced = await priceAttempts(attempts, { harnessFor: registryFor(root), discoverCodex: false });
  assert.equal(priced.amount, 1);
  assert.deepEqual(priced.unattributed.map((entry) => entry.reason).sort(), [
    "no conversation was recorded or found for this attempt",
    "the attempt recorded no harness",
    "the codex-gw harness declares no transcripts folder",
    "the transcript for this conversation is no longer on disk",
  ]);
});

test("only the attempts inside the window are read", async () => {
  const root = await scratchRoot();
  const pipelines = path.join(root, "pipelines", AREA);
  const brains = path.join(root, "brains");
  await mkdir(pipelines, { recursive: true });
  await mkdir(brains, { recursive: true });
  await writeFile(path.join(pipelines, "thing.json"), JSON.stringify({
    goal: `${AREA}/goal-thing.md`, area: AREA,
    steps: [{ attempts: [
      attempt({ id: "recent", conversation: { harness: "claude-otto", id: "a" }, startedAt: "2026-09-03T04:00:00.000Z" }),
      attempt({ id: "old", conversation: { harness: "claude-otto", id: "b" }, startedAt: "2026-01-01T00:00:00.000Z" }),
      { id: "no-start", providerSession: null, cwd: CWD, startedAt: null },
    ] }],
  }), "utf8");
  await writeFile(path.join(brains, "otto-tangent.json"), JSON.stringify({
    area: AREA, generations: [attempt({ id: "gen", conversation: { harness: "claude-otto", id: "c" }, startedAt: "2026-09-03T05:00:00.000Z" })],
  }), "utf8");
  const attempts = await attemptsInWindow({
    pipelinesRoot: path.join(root, "pipelines"),
    brainsRoot: brains,
    since: "2026-09-03T00:00:00.000Z",
  });
  assert.deepEqual(attempts.map((entry) => entry.scope).sort(), ["brain", "job"]);
});

test("the provider a launch ran on travels with the attempt", () => {
  const attempts = jobAttempts({
    goal: `${AREA}/goal-p.md`, area: AREA,
    steps: [{ attempts: [attempt({ id: "one", conversation: null, harness: "pi-code", provider: "resetdata-glm" })] }],
  }, AREA, "p");
  assert.equal(attempts[0].provider, "resetdata-glm");
  assert.equal(attempts[0].ref.harness, "pi-code");
});

/** One priced conversation, in the shape {@link priceAttempts} returns. */
function pricedConversation({ harness, amount, provider, model, priced = true, usage = {}, scope = "job", name = "goal-thing.md" }) {
  return {
    harness,
    cost: {
      amount,
      parts: [{ provider, model, priced, amount: priced ? amount : null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, ...usage } }],
    },
    attempts: [{ scope, area: AREA, name }],
  };
}

test("the summary ranks where the money went and states what the number leaves out", () => {
  const snapshot = summarizeCost({
    amount: 40,
    complete: false,
    conversations: [
      pricedConversation({ harness: "claude-otto", amount: 30, provider: "anthropic", model: "claude-opus-5" }),
      pricedConversation({ harness: "claude", amount: 10, provider: "anthropic", model: "claude-sonnet-5", name: "goal-other.md" }),
      pricedConversation({ harness: "codex", amount: 0, provider: "openai", model: "gpt-5.6-sol", priced: false, usage: { input: 1_500_000 } }),
    ],
    unattributed: [{ reason: "the codex-gw harness declares no transcripts folder" }, { reason: "the codex-gw harness declares no transcripts folder" }],
  }, { days: 1, since: "2026-09-03T00:00:00.000Z", computedAt: "2026-09-03T06:00:00.000Z" });

  assert.equal(snapshot.display, "$40");
  assert.equal(snapshot.complete, false);
  assert.deepEqual(snapshot.byHarness.map((entry) => entry.harness), ["claude-otto", "claude"]);
  assert.deepEqual(snapshot.byModel.map((entry) => entry.id), ["anthropic/claude-opus-5", "anthropic/claude-sonnet-5"]);
  assert.equal(snapshot.work[0].name, "goal-thing.md");
  // An unpriced model is named with the tokens behind it and what to do next.
  assert.equal(snapshot.excluded[0].reason, "no rate for openai/gpt-5.6-sol");
  assert.match(snapshot.excluded[0].detail, /1\.5M tokens/);
  assert.equal(snapshot.excluded[1].count, 2);
});

test("a complete summary says so, and one blocked by a broken price table does not", () => {
  const window = { days: 1, since: "2026-09-03T00:00:00.000Z", computedAt: "2026-09-03T06:00:00.000Z" };
  const conversations = [pricedConversation({ harness: "claude", amount: 3, provider: "anthropic", model: "claude-opus-5" })];
  assert.equal(summarizeCost({ amount: 3, complete: true, conversations, unattributed: [] }, window).complete, true);
  const broken = summarizeCost({ amount: 3, complete: true, conversations, unattributed: [] }, { ...window, pricingError: "pricing table is not valid JSON" });
  assert.equal(broken.complete, false);
  assert.equal(broken.excluded.at(-1).detail, "pricing table is not valid JSON");
});

test("a repair crew is priced beside Jobs and brains, because it spends while it recovers", async () => {
  const root = await scratchRoot();
  const pipelines = path.join(root, "pipelines", AREA);
  const repairs = path.join(root, "repairs");
  await mkdir(pipelines, { recursive: true });
  await mkdir(repairs, { recursive: true });
  await writeFile(path.join(pipelines, "thing.json"), JSON.stringify({
    goal: `${AREA}/goal-thing.md`, area: AREA,
    steps: [{ attempts: [attempt({ id: "one", conversation: { harness: "claude-otto", id: "a" } })] }],
  }), "utf8");
  // A repair record keeps its generations under history and current, not
  // under attempts, which is why it needs its own reader.
  await writeFile(path.join(repairs, "otto-tangent.json"), JSON.stringify({
    area: AREA,
    current: attempt({ id: "live", conversation: { harness: "claude-otto", id: "c" }, startedAt: "2026-09-03T05:30:00.000Z" }),
    history: [attempt({ id: "past", conversation: { harness: "claude-otto", id: "b" }, startedAt: "2026-09-03T05:00:00.000Z" })],
  }), "utf8");
  const attempts = await attemptsInWindow({
    pipelinesRoot: path.join(root, "pipelines"),
    brainsRoot: path.join(root, "brains"),
    repairsRoot: repairs,
    since: "2026-09-03T00:00:00.000Z",
  });
  assert.deepEqual(attempts.map((entry) => entry.scope).sort(), ["job", "repair", "repair"]);
  assert.deepEqual(repairAttempts({ area: AREA, history: [], current: null }), []);
});

test("a figure that could not use a harness ledger says so and refuses to call itself complete", () => {
  const window = { days: 1, since: "2026-09-03T00:00:00.000Z", computedAt: "2026-09-03T06:00:00.000Z" };
  const withGap = pricedConversation({ harness: "claude", amount: 3, provider: "anthropic", model: "claude-opus-5" });
  withGap.cost.gaps = [{ reason: "priced from tokens, not from Claude Code's own ledger", detail: "a floor" }];
  const second = pricedConversation({ harness: "claude", amount: 2, provider: "anthropic", model: "claude-opus-5", name: "goal-other.md" });
  second.cost.gaps = [{ reason: "priced from tokens, not from Claude Code's own ledger", detail: "a floor" }];
  const snapshot = summarizeCost({ amount: 5, complete: true, conversations: [withGap, second], unattributed: [] }, window);
  assert.equal(snapshot.complete, false);
  const gap = snapshot.excluded.find((entry) => entry.reason.startsWith("priced from tokens"));
  assert.equal(gap.count, 2);
});

test("a broken harness registry is named in the figure rather than leaving it blank forever", () => {
  const snapshot = summarizeCost({ amount: 0, complete: false, conversations: [], unattributed: [] },
    { days: 1, since: "2026-09-03T00:00:00.000Z", computedAt: "2026-09-03T06:00:00.000Z", registryError: "harness registry is invalid: duplicate id" });
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.excluded[0].detail, "harness registry is invalid: duplicate id");
});

/** One priced conversation as the worker index reads it. */
function workerConversation({ key, amount, session, file = "goal-thing.md", scope = "job", family = "claude", harness = "claude-otto", endedAt = "2026-09-03T05:00:00.000Z", startedAt = "2026-09-03T04:00:00.000Z", parts = null, gaps = [] }) {
  return {
    key,
    harness,
    cost: {
      amount, family, gaps,
      parts: parts ?? [{ provider: "anthropic", model: "claude-opus-5", priced: true, amount, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 } }],
    },
    attempts: [{ scope, area: AREA, name: file, file, session, startedAt, endedAt }],
  };
}

test("a worker index is keyed the way each surface names a worker", () => {
  const index = summarizeWorkers({
    conversations: [
      workerConversation({ key: "a", amount: 4, session: "thing-one" }),
      workerConversation({ key: "b", amount: 6, session: "thing-two" }),
      workerConversation({ key: "c", amount: 3, session: "tangent-brain-g1", scope: "brain", file: null }),
    ],
    unattributed: [],
  });
  // The Work table knows a row by its Goal file; the session layer knows a
  // worker by its tmux name.
  assert.equal(index.work[`job:${AREA}/goal-thing.md`], undefined);
  assert.equal(index.work["job:goal-thing.md"].amount, 10);
  assert.equal(index.work["job:goal-thing.md"].workers, 2);
  assert.equal(index.work[`brain:${AREA}`].amount, 3);
  assert.equal(index.sessions["thing-one"].amount, 4);
  assert.equal(index.sessions["thing-two"].amount, 6);
});

test("one conversation is charged once to a worker, however many attempts ran in it", () => {
  const shared = workerConversation({ key: "a", amount: 9, session: "thing-one" });
  shared.attempts.push({ ...shared.attempts[0], session: "thing-one" });
  const index = summarizeWorkers({ conversations: [shared], unattributed: [] });
  assert.equal(index.work["job:goal-thing.md"].amount, 9);
  assert.equal(index.sessions["thing-one"].amount, 9);
  assert.equal(index.sessions["thing-one"].conversations, 1);
});

test("a live worker's figure is a floor and says why", () => {
  const index = summarizeWorkers({
    conversations: [workerConversation({ key: "a", amount: 4, session: "thing-one", endedAt: null })],
    unattributed: [],
  });
  const worker = index.sessions["thing-one"];
  assert.equal(worker.floor, true);
  assert.equal(worker.reasons[0], "this worker is still running, so this is what it has cost so far");
  assert.match(worker.subagents, /Subagents are inside this figure/);
});

test("a worker whose model has no rate reports its tokens instead of a dollar", () => {
  const index = summarizeWorkers({
    conversations: [workerConversation({
      key: "a", amount: 0, session: "thing-one",
      parts: [{ provider: "openai", model: "gpt-5.6-sol", priced: false, amount: null, usage: { input: 1_500_000, output: 300_000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 } }],
    })],
    unattributed: [],
  });
  const worker = index.sessions["thing-one"];
  assert.equal(worker.amount, 0);
  assert.equal(worker.unpricedTokens, 1_800_000);
  assert.equal(worker.unpricedDisplay, "1.8M tok");
  assert.equal(worker.floor, true);
  assert.match(worker.reasons[0], /^no rate for openai\/gpt-5\.6-sol/);
});

test("an attempt that could not be reached is named on the worker it belonged to", () => {
  const index = summarizeWorkers({
    conversations: [workerConversation({ key: "a", amount: 4, session: "thing-one" })],
    unattributed: [
      { scope: "job", area: AREA, name: "goal-thing.md", file: "goal-thing.md", session: "thing-one", reason: "the transcript for this conversation is no longer on disk" },
      { scope: "job", area: AREA, name: "goal-thing.md", file: "goal-thing.md", session: "thing-one", reason: "the transcript for this conversation is no longer on disk" },
    ],
  });
  const worker = index.sessions["thing-one"];
  assert.equal(worker.floor, true);
  assert.equal(worker.reasons[0], "the transcript for this conversation is no longer on disk (2)");
  assert.equal(index.work["job:goal-thing.md"].floor, true);
});

test("a window taken out of one full reading keeps only the conversations that started in it", () => {
  const priced = {
    conversations: [
      workerConversation({ key: "old", amount: 5, session: "thing-old", startedAt: "2026-09-01T04:00:00.000Z" }),
      workerConversation({ key: "new", amount: 7, session: "thing-new", startedAt: "2026-09-03T04:00:00.000Z" }),
    ],
    unattributed: [
      { scope: "job", area: AREA, name: "goal-thing.md", startedAt: "2026-09-01T04:00:00.000Z", reason: "gone" },
      { scope: "job", area: AREA, name: "goal-thing.md", startedAt: "2026-09-03T04:00:00.000Z", reason: "gone" },
    ],
  };
  const sliced = inWindow(priced, "2026-09-03T00:00:00.000Z");
  assert.equal(sliced.amount, 7);
  assert.deepEqual(sliced.conversations.map((entry) => entry.key), ["new"]);
  assert.equal(sliced.unattributed.length, 1);
  // Without a window the reading passes through untouched.
  assert.equal(inWindow(priced, null), priced);
});

test("a Job's whole life is one key, so its figure does not change with the day", () => {
  const priced = {
    conversations: [
      workerConversation({ key: "old", amount: 5, session: "thing-old", startedAt: "2026-09-01T04:00:00.000Z" }),
      workerConversation({ key: "new", amount: 7, session: "thing-new", startedAt: "2026-09-03T04:00:00.000Z" }),
    ],
    unattributed: [],
  };
  assert.equal(summarizeWorkers(priced).work["job:goal-thing.md"].amount, 12);
});
