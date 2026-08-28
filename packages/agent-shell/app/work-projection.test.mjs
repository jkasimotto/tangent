import assert from "node:assert/strict";
import test from "node:test";
import { projectWork } from "./work-projection.mjs";

test("Work projection excludes durable queue and brain history bodies", () => {
  const handover = "h".repeat(100_000);
  const report = { text: "r".repeat(100_000) };
  const projected = projectWork({
    vault: {
      areas: [{ path: "otto", goals: [{ file: "otto/goal.md", area: "otto", slug: "goal", title: "Goal", status: "open", storyText: "Story" }], documents: [] }],
      map: [{ path: "otto", goals: [{ file: "otto/goal.md", title: "Goal", status: "open" }] }],
      documents: [],
    },
    session: {
      sessions: [],
      pipelines: [{ goal: "otto/goal.md", area: "otto", slug: "goal", revision: 3, status: "open", assignments: [{ id: "a1", index: 1, status: "running", instruction: "Do work", handover, reports: [report], attempts: [{ report }], handoverReceipts: [{ notice: { text: handover } }] }] }],
      brains: [{ area: "otto", status: "active", session: "brain", generations: [{ handover, notices: [{ text: handover }] }], forJulian: [], requests: [] }],
    },
    programs: { operations: [] },
  });

  assert.ok(projected.bytes < 10_000, `expected compact Work bytes, got ${projected.bytes}`);
  assert.doesNotMatch(projected.body, /hhh{100}/);
  assert.doesNotMatch(projected.body, /rrr{100}/);
  assert.equal(projected.value.vault.areas[0].goals[0].run.steps[0].attemptCount, 1);
  assert.equal(projected.value.vault.areas[0].goals[0].run.assignments, undefined);
  assert.equal(projected.value.vault.areas[0].brain.generations, undefined);
  assert.equal(projected.value.session.pipelines, undefined);
  assert.equal(projected.value.session.brains, undefined);
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
