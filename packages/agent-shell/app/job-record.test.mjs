import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { acceptCurrentAssignment, applyOperationReceipt, createJobRun, JOB_SCHEMA, jobRun, newPipeline, pipelinePath, readJob, writePipeline } from "./job-record.mjs";

const launch = { harness: "codex", model: "gpt-5.6-sol", effort: "high" };
/** Returns stable fixture fields for a new Job run. */
const fields = (instruction = "Implement it.") => ({ goal: "otto/tangent/goal-split.md", area: "otto/tangent", slug: "split", steps: [{ instruction, launch }], now: "2026-08-31T01:00:00.000Z" });

test("old records read as run 1 and first write becomes job.v1 at the same path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jobs-"));
  const old = newPipeline(fields());
  await writePipeline(root, old);
  const stored = JSON.parse(await readFile(pipelinePath(root, old.area, old.slug), "utf8"));
  assert.equal(stored.schema, JOB_SCHEMA);
  assert.equal(stored.currentRun, 1);
  assert.equal(stored.nextRun, 2);
  assert.equal(stored.runs[0].assignments[0].id, old.assignments[0].id);
  assert.equal(stored.runs[0].steps, undefined);
});

test("later runs preserve and seal earlier immutable history", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jobs-"));
  const first = newPipeline(fields("First."));
  first.assignments[0].status = "complete";
  first.status = "complete";
  first.endedAt = "2026-08-31T02:00:00.000Z";
  await writePipeline(root, first);
  const file = await readJob(root, first.area, first.slug);
  const earlier = structuredClone(jobRun(file, 1));
  const second = createJobRun(file, fields("Second."));
  await writePipeline(root, second);
  const reread = await readJob(root, first.area, first.slug);
  assert.equal(reread.currentRun, 2);
  assert.equal(reread.nextRun, 3);
  assert.deepEqual(jobRun(reread, 1).assignments, earlier.assignments);
  assert.ok(jobRun(reread, 1).sealedAt);
});

test("operation receipts replay exact input and reject conflicting input", () => {
  const target = { operations: [] };
  const first = applyOperationReceipt(target, { id: "op-1", kind: "append", input: { assignment: "a" }, resultRevision: 2, outcome: "appended" });
  const retry = applyOperationReceipt(target, { id: "op-1", kind: "append", input: { assignment: "a" }, resultRevision: 9, outcome: "different-return-is-ignored" });
  assert.equal(first.repeated, false);
  assert.equal(retry.repeated, true);
  assert.equal(retry.receipt.outcome, "appended");
  assert.throws(() => applyOperationReceipt(target, { id: "op-1", kind: "append", input: { assignment: "b" }, resultRevision: 3, outcome: "appended" }), (error) => error.code === "operation-conflict");
});

test("a Brain can accept a durable plain worker note before the next Assignment", () => {
  const record = newPipeline({ ...fields(), steps: [{ instruction: "Implement.", launch }, { instruction: "Review.", launch }] });
  const current = record.assignments[0];
  current.status = "running";
  current.session = "worker-1";
  current.attempts = [{ id: "attempt-1", session: "worker-1", endedAt: null }];
  current.handoverReceipts = [{ reportType: "note", workerSession: "worker-1", queue: { result: "note" }, notice: { id: "notice-1" } }];
  record.currentAssignmentId = current.id;
  const accepted = acceptCurrentAssignment(record, 2, "2026-08-31T02:00:00.000Z");
  assert.equal(accepted.accepted, true);
  assert.equal(current.status, "complete");
  assert.equal(current.attempts[0].result.type, "brain-accepted-note");
  assert.equal(record.assignments[1].status, "pending");
  assert.equal(record.currentAssignmentId, null);
});
