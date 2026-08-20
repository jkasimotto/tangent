import test from "node:test";
import assert from "node:assert/strict";

await import("./public/goal-card-core.js");

const core = globalThis.AgentShellGoalCard;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

/** The text of the facts line, the way the card prints it. */
function line(facts, names) {
  return core.factsSegments(facts, NOW, names).map((segment) => segment.text).join(" · ");
}

test("durationLabel: minutes, hours with padded minutes, and days", () => {
  assert.equal(core.durationLabel(20_000), "<1m");
  assert.equal(core.durationLabel(12 * MINUTE), "12m");
  assert.equal(core.durationLabel(2 * HOUR + 5 * MINUTE), "2h 05m");
  assert.equal(core.durationLabel(28 * HOUR), "1d 4h");
  assert.equal(core.durationLabel(-5), "<1m");
});

test("goalCardFacts: a Goal nobody started says so", () => {
  const facts = core.goalCardFacts({ goal: { status: "active", agents: [], firstStartAt: null, lastEndAt: null }, sessions: [], pipeline: null, now: NOW });
  assert.equal(facts.agentCount, 0);
  assert.equal(facts.running, null);
  assert.equal(facts.waiting, null);
  assert.equal(line(facts), "no agent yet");
});

test("goalCardFacts: one live agent counts the commit and the session once", () => {
  const goal = { status: "active", agents: ["s1"], firstStartAt: NOW - 8 * MINUTE, lastEndAt: null };
  const sessions = [{ name: "s1", created: NOW - 8 * MINUTE, state: "working" }];
  const facts = core.goalCardFacts({ goal, sessions, pipeline: null, now: NOW });
  assert.equal(facts.agentCount, 1);
  assert.deepEqual(facts.running, { word: "running", ms: 8 * MINUTE });
  assert.equal(facts.waiting, null);
  assert.equal(line(facts, ["s1"]), "1 agent · running 8m");
});

test("goalCardFacts: a session that started before its commit landed still counts", () => {
  const goal = { status: "active", agents: [], firstStartAt: null, lastEndAt: null };
  const sessions = [{ name: "s1", created: NOW - 3 * MINUTE, state: "working" }];
  const facts = core.goalCardFacts({ goal, sessions, pipeline: null, now: NOW });
  assert.equal(facts.agentCount, 1);
  assert.deepEqual(facts.running, { word: "running", ms: 3 * MINUTE });
});

test("goalCardFacts: a waiting agent with a decision names the question", () => {
  const goal = { status: "active", agents: ["s1"], firstStartAt: NOW - HOUR, lastEndAt: null };
  const sessions = [{ name: "s1", created: NOW - HOUR, state: "waiting", stateDetail: "decision", stateQuestion: "Delete the file?", waitingSince: NOW - 12 * MINUTE }];
  const facts = core.goalCardFacts({ goal, sessions, pipeline: null, now: NOW });
  assert.equal(facts.waiting.ms, 12 * MINUTE);
  assert.match(facts.waiting.title, /^Needs your decision: Delete the file\?/);
  assert.equal(line(facts), "1 agent · running 1h 00m · waiting for you 12m");
});

test("goalCardFacts: after a server restart a wait has no start and prints no duration", () => {
  const goal = { status: "active", agents: ["s1"], firstStartAt: NOW - HOUR, lastEndAt: null };
  const sessions = [{ name: "s1", created: NOW - HOUR, state: "waiting", stateDetail: "idle", waitingSince: null }];
  const facts = core.goalCardFacts({ goal, sessions, pipeline: null, now: NOW });
  assert.equal(facts.waiting.ms, null);
  assert.equal(core.factsSegments(facts, NOW).at(-1).text, "waiting for you");
});

test("goalCardFacts: a handover with no live session waits from the last end mark", () => {
  const goal = { status: "active", agents: ["s1", "s2"], firstStartAt: NOW - 32 * HOUR, lastEndAt: NOW - 28 * HOUR, waitingOn: "Julian: the map is built\nsecond line" };
  const facts = core.goalCardFacts({ goal, sessions: [], pipeline: null, now: NOW });
  assert.deepEqual(facts.running, { word: "ran", ms: 4 * HOUR });
  assert.equal(facts.waiting.title, "Julian: the map is built");
  assert.equal(line(facts), "2 agents · ran 4h 00m · waiting for you 1d 4h");
});

test("goalCardFacts: a stopped pipeline step waits from its end time", () => {
  const goal = { status: "active", agents: ["p1"], firstStartAt: NOW - 2 * HOUR, lastEndAt: null };
  const pipeline = { steps: [{ index: 1, session: "p1", status: "stopped", startedAt: new Date(NOW - 2 * HOUR).toISOString(), endedAt: new Date(NOW - 25 * MINUTE).toISOString() }] };
  const facts = core.goalCardFacts({ goal, sessions: [], pipeline, now: NOW });
  assert.equal(facts.waiting.ms, 25 * MINUTE);
  assert.equal(facts.waiting.title, "Step 1 stopped");
  assert.deepEqual(facts.running, { word: "ran", ms: 95 * MINUTE });
});

test("goalCardFacts: every pipeline step session counts as an agent", () => {
  const goal = { status: "active", agents: ["p1"], firstStartAt: NOW - HOUR, lastEndAt: null };
  const pipeline = { steps: [
    { index: 1, session: "p1", status: "complete", startedAt: new Date(NOW - HOUR).toISOString(), endedAt: new Date(NOW - 40 * MINUTE).toISOString() },
    { index: 2, session: "p2", status: "complete", startedAt: new Date(NOW - 40 * MINUTE).toISOString(), endedAt: new Date(NOW - 20 * MINUTE).toISOString() },
    { index: 3, session: "p3", status: "running", live: true, state: "working", startedAt: new Date(NOW - 20 * MINUTE).toISOString() },
  ] };
  const sessions = [{ name: "p3", created: NOW - 20 * MINUTE, state: "working" }];
  const facts = core.goalCardFacts({ goal, sessions, pipeline, now: NOW });
  assert.equal(facts.agentCount, 3);
  assert.equal(line(facts), "3 agents · running 1h 00m");
});

test("goalCardFacts: a caller can say a stored handover no longer waits for Julian", () => {
  const goal = { status: "active", agents: ["s1"], firstStartAt: NOW - 2 * HOUR, lastEndAt: NOW - HOUR, waitingOn: "Julian: pick one" };
  assert.equal(core.goalCardFacts({ goal, sessions: [], pipeline: null, now: NOW, handoffNeedsYou: false }).waiting, null);
  assert.equal(core.goalCardFacts({ goal, sessions: [], pipeline: null, now: NOW, handoffNeedsYou: true }).waiting.ms, HOUR);
});

test("goalCardFacts: a Goal with no agent record still shows that it waits", () => {
  const goal = { status: "active", agents: [], firstStartAt: null, lastEndAt: null, waitingOn: "Julian: pick a name" };
  const facts = core.goalCardFacts({ goal, sessions: [], pipeline: null, now: NOW });
  assert.equal(line(facts), "no agent yet · waiting for you");
});

test("factsBarShares: no agent yet draws no bar", () => {
  const facts = core.goalCardFacts({ goal: { status: "active", agents: [], firstStartAt: null, lastEndAt: null }, sessions: [], pipeline: null, now: NOW });
  assert.equal(core.factsBarShares(facts, NOW), null);
});

test("factsBarShares: working right now is all worked, no wait", () => {
  const goal = { status: "active", agents: ["s1"], firstStartAt: NOW - 8 * MINUTE, lastEndAt: null };
  const sessions = [{ name: "s1", created: NOW - 8 * MINUTE, state: "working" }];
  const facts = core.goalCardFacts({ goal, sessions, pipeline: null, now: NOW });
  assert.deepEqual(core.factsBarShares(facts, NOW), { workedShare: 1, waitShare: 0, waitKind: "waiting" });
});

test("factsBarShares: splits at the start of the current wait, amber for Julian", () => {
  const goal = { status: "active", agents: ["s1"], firstStartAt: NOW - HOUR, lastEndAt: null };
  const sessions = [{ name: "s1", created: NOW - HOUR, state: "waiting", stateDetail: "idle", waitingSince: NOW - 12 * MINUTE }];
  const facts = core.goalCardFacts({ goal, sessions, pipeline: null, now: NOW });
  const shares = core.factsBarShares(facts, NOW);
  assert.equal(shares.waitKind, "waiting");
  assert.ok(Math.abs(shares.waitShare - 12 / 60) < 0.001);
  assert.ok(Math.abs(shares.workedShare - 48 / 60) < 0.001);
});

test("factsBarShares: a wait under a live brain draws gray, not amber", () => {
  const goal = { status: "active", agents: ["s1"], firstStartAt: NOW - HOUR, lastEndAt: null };
  const sessions = [{ name: "s1", created: NOW - HOUR, state: "waiting", stateDetail: "idle", waitingSince: NOW - 12 * MINUTE }];
  const facts = core.goalCardFacts({ goal, sessions, pipeline: null, now: NOW });
  const shares = core.factsBarShares(facts, NOW, { waitsForBrain: true });
  assert.equal(shares.waitKind, "fact");
});

test("factsBarShares: a handover with no live session splits at the last end mark", () => {
  const goal = { status: "active", agents: ["s1", "s2"], firstStartAt: NOW - 32 * HOUR, lastEndAt: NOW - 28 * HOUR, waitingOn: "Julian: the map is built" };
  const facts = core.goalCardFacts({ goal, sessions: [], pipeline: null, now: NOW });
  const shares = core.factsBarShares(facts, NOW);
  assert.ok(Math.abs(shares.waitShare - 28 / 32) < 0.001);
});

test("goalCardFacts: an idle pane from a finished step is no wait while a later step works", () => {
  const goal = { status: "active", agents: ["p1", "p2"], firstStartAt: NOW - 34 * MINUTE, lastEndAt: null };
  const pipeline = { steps: [
    { index: 1, session: "p1", status: "complete", startedAt: new Date(NOW - 34 * MINUTE).toISOString(), endedAt: new Date(NOW - 20 * MINUTE).toISOString() },
    { index: 2, session: "p2", status: "running", live: true, state: "working", startedAt: new Date(NOW - 20 * MINUTE).toISOString() },
  ] };
  const sessions = [
    { name: "p1", created: NOW - 34 * MINUTE, state: "waiting", stateDetail: "idle", waitingSince: NOW - 20 * MINUTE },
    { name: "p2", created: NOW - 20 * MINUTE, state: "working" },
  ];
  const facts = core.goalCardFacts({ goal, sessions, pipeline, now: NOW });
  assert.equal(facts.waiting, null);
  assert.equal(line(facts), "2 agents · running 34m");
});
