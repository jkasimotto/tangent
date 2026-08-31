import assert from "node:assert/strict";
import test from "node:test";
import { projectWork } from "./work-projection.mjs";

test("Work projection excludes durable queue and brain history bodies", () => {
  const handover = "h".repeat(100_000);
  const report = { text: "r".repeat(100_000) };
  const repairReport = "x".repeat(100_000);
  const projected = projectWork({
    vault: {
      areas: [{ path: "otto", goals: [{ file: "otto/goal.md", area: "otto", slug: "goal", title: "Goal", status: "open", storyText: "Story" }], documents: [] }],
      map: [{ path: "otto", goals: [{ file: "otto/goal.md", title: "Goal", status: "open" }] }],
      documents: [],
    },
    session: {
      sessions: [{ name: "brain", kind: "brain", fresh: false }],
      pipelines: [{ goal: "otto/goal.md", area: "otto", slug: "goal", revision: 3, status: "open", assignments: [{ id: "a1", index: 1, status: "running", instruction: "Do work", handover, reports: [report], attempts: [{ report }], handoverReceipts: [{ notice: { text: handover } }] }] }],
      brains: [{
        area: "otto",
        status: "active",
        session: "brain",
        authority: { live: false, state: "absent", evidence: { observedAt: "2026-08-30T00:00:00.000Z" } },
        generations: [{ handover, notices: [{ text: handover }] }],
        repair: {
          schema: "area-repair.v1",
          area: "otto",
          current: { session: "otto-repair", firstMessage: repairReport, audit: [{ report: repairReport }] },
          history: [
            { endedAt: "2026-08-29T00:00:00.000Z", result: "done", report: repairReport },
            { endedAt: "2026-08-30T00:00:00.000Z", result: "blocked", report: repairReport },
          ],
        },
        forJulian: [],
        requests: [],
      }],
    },
    programs: { operations: [] },
  });

  assert.ok(projected.bytes < 10_000, `expected compact Work bytes, got ${projected.bytes}`);
  assert.doesNotMatch(projected.body, /hhh{100}/);
  assert.doesNotMatch(projected.body, /rrr{100}/);
  assert.equal(projected.value.schema, "agent-shell-work.v2");
  assert.equal(projected.value.vault.areas[0].goals[0].run, undefined, "Goal intent does not contain Job execution");
  assert.equal(projected.value.runtime.jobs[0].assignments[0].attemptCount, 1);
  assert.equal(projected.value.runtime.agents.some((session) => session.kind === "brain"), false);
  assert.deepEqual(projected.value.runtime.brains[0].repair, {
    schema: "area-repair.v1",
    area: "otto",
    current: { session: "otto-repair" },
    history: [{ endedAt: "2026-08-30T00:00:00.000Z", result: "blocked", report: "x".repeat(240) }],
  });
  assert.doesNotMatch(projected.body, /xxx{1000}/);
  assert.equal(projected.value.runtime.jobs[0].steps, undefined);
  assert.equal(projected.value.compatibility.v1.schema, "agent-shell-work.v1");
});

test("Work projection ETag changes only when semantic row data changes", () => {
  const input = { vault: { areas: [], map: [], documents: [] }, session: { sessions: [], pipelines: [], brains: [], runtime: { instanceId: "one", ownershipKey: "owner", sessions: { loadedAt: 1 } } }, programs: { operations: [] } };
  const first = projectWork(input);
  input.session.runtime.sessions.loadedAt = 2;
  const second = projectWork(input);
  assert.equal(second.etag, first.etag);
  input.session.sessions.push({ name: "worker", state: "working" });
  assert.notEqual(projectWork(input).etag, first.etag);
});

test("Work projects the enriched authoritative Assignment view", () => {
  const projected = projectWork({
    vault: { areas: [], map: [], documents: [] },
    session: {
      sessions: [],
      pipelines: [{
        goal: "otto/tangent/goal-live.md", area: "otto/tangent", slug: "live", revision: 2, status: "running",
        assignments: [{ id: "assignment-1", index: 1, status: "running", session: "worker" }],
        steps: [{
          id: "assignment-1", index: 1, status: "running", session: "worker", live: true,
          attemptState: { word: "Hit a wall", owner: "brain", evidence: { source: "screen", text: "capacity" }, next: "Replace it." },
        }],
      }],
      brains: [],
    },
    programs: { operations: [] },
  });

  assert.equal(projected.value.runtime.jobs[0].assignments[0].live, true);
  assert.equal(projected.value.runtime.jobs[0].assignments[0].attemptState.word, "Hit a wall");
});
