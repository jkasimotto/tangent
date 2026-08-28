import assert from "node:assert/strict";
import test from "node:test";
import { endRepair, extendRepairLease, newRepair, repairDispatchDecision } from "./repair-crew.mjs";

const NOW = Date.parse("2026-08-28T12:10:00.000Z");
const waiting = [{ word: "Reported done", since: NOW - 181_000, goal: "g", owner: "brain" }];

test("a crew needs waiting work, no live brain, ownership, and three minutes", () => {
  assert.equal(repairDispatchDecision({ brainWord: "Brain stopped", waiting, record: { history: [] }, owned: true, now: NOW }).dispatch, true);
  assert.equal(repairDispatchDecision({ brainWord: "Brain working", waiting, record: { history: [] }, owned: true, now: NOW }).dispatch, false);
  assert.equal(repairDispatchDecision({ brainWord: "Brain stopped", waiting: [{ ...waiting[0], since: NOW - 10_000 }], record: { history: [] }, owned: true, now: NOW }).dispatch, false);
  assert.equal(repairDispatchDecision({ brainWord: "Brain stopped", waiting, record: { history: [] }, owned: false, now: NOW }).dispatch, false);
  assert.equal(repairDispatchDecision({ brainWord: "Brain stopped", waiting, record: { history: [] }, hidden: true, owned: true, now: NOW }).dispatch, false);
  assert.equal(repairDispatchDecision({ brainWord: "Brain stopped", waiting: [{ ...waiting[0], kind: "process" }], record: { history: [] }, owned: true, now: NOW }).dispatch, false);
  assert.equal(repairDispatchDecision({ brainWord: "Brain stopped", waiting: [{ ...waiting[0], word: "Needs your decision" }], record: { history: [] }, owned: true, now: NOW }).dispatch, false);
  assert.equal(repairDispatchDecision({ brainWord: "Brain stopped", waiting, record: { history: [] }, owned: true, runningMachine: 3, now: NOW }).dispatch, false);
});

test("there is one crew per Area and two crews per stop", () => {
  const current = { endedAt: null, leaseUntil: new Date(NOW + 10_000).toISOString() };
  assert.equal(repairDispatchDecision({ brainWord: "Brain stopped", waiting, record: { current, history: [] }, owned: true, now: NOW }).dispatch, false);
  const stop = new Date(NOW - 300_000).toISOString();
  const history = [1, 2].map((ordinal) => ({ ordinal, stop: { since: stop, cause: "inactive" }, endedAt: new Date().toISOString() }));
  const decision = repairDispatchDecision({ brainWord: "Brain stopped", waiting, record: { current: null, history }, owned: true, now: NOW });
  assert.equal(decision.dispatch, false);
  assert.equal(decision.owner, "you");
});

test("a blocked crew escalates without starting the second crew", () => {
  const stop = new Date(NOW - 300_000).toISOString();
  const history = [{ ordinal: 1, stop: { since: stop, cause: "inactive" }, endedAt: new Date().toISOString(), result: "blocked", report: "Julian must choose." }];
  const decision = repairDispatchDecision({ brainWord: "Brain stopped", waiting, record: { current: null, history }, owned: true, now: NOW });
  assert.equal(decision.dispatch, false);
  assert.equal(decision.owner, "you");
});

test("commands extend a bounded lease and ending is idempotent", () => {
  const repair = newRepair({ area: "otto/tangent", stop: { since: new Date(NOW).toISOString(), cause: "inactive" }, trigger: { goals: [], reports: [], notices: [], oldestSince: new Date(NOW).toISOString() }, ordinal: 1, instanceId: "one", cwd: "/tmp", resolvedLaunch: { ref: { harness: "codex" }, command: "codex" }, now: NOW });
  const record = { current: repair, history: [] };
  assert.equal(extendRepairLease(repair, NOW), true);
  assert.equal(repair.commands, 1);
  assert.equal(endRepair(record, "done", "settled", NOW + 1), repair);
  assert.equal(endRepair(record, "done", "again", NOW + 2), null);
});

test("an expired lease permits the next bounded crew", () => {
  const stop = new Date(NOW - 300_000).toISOString();
  const expired = { ordinal: 1, stop: { since: stop, cause: "inactive" }, leaseUntil: new Date(NOW - 1).toISOString(), endedAt: null };
  const decision = repairDispatchDecision({ brainWord: "Brain stopped", brainSince: NOW - 300_000, waiting, record: { current: expired, history: [] }, owned: true, now: NOW });
  assert.equal(decision.dispatch, true);
  assert.equal(decision.ordinal, 2);
});
