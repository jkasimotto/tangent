import assert from "node:assert/strict";
import test from "node:test";
import {
  appendWorkerHandoverReceipt,
  normalizeWorkerHandoverReceipts,
  pendingWorkerHandoverReceipts,
  recordWorkerHandoverNotice,
  workerHandoverReceipt,
} from "./worker-handover-receipt.mjs";

/** One accepted assignment in one exact Area queue. */
function fixture() {
  const step = { id: "assignment-1", index: 1, status: "complete", handoverReceipts: [] };
  return {
    step,
    record: { goal: "neara/portland/goal-rules.md", area: "neara/portland", controllerArea: "neara/portland", revision: 4, steps: [step] },
  };
}

test("a worker submission links its exact queue result to one pending Area notice", () => {
  const { record, step } = fixture();
  const input = {
    workerSession: "portland-rules-worker",
    idempotencyKey: "report-1",
    reportType: "implementation-result",
    queueRevisionBefore: 3,
    queueResult: "accepted",
    noticeText: "Goal rules: assignment 1 submitted implementation-result.",
    submittedAt: "2026-08-27T01:00:00.000Z",
  };
  const first = appendWorkerHandoverReceipt(record, step, input);
  const retry = appendWorkerHandoverReceipt(record, step, input);

  assert.equal(retry.duplicate, true);
  assert.equal(retry.receipt.id, first.receipt.id);
  assert.equal(step.handoverReceipts.length, 1);
  assert.equal(first.receipt.destinationArea, "neara/portland");
  assert.deepEqual(first.receipt.queue, { revisionBefore: 3, revisionAfter: 4, result: "accepted", assignmentStatus: "complete", closeGoal: false });
  assert.deepEqual(pendingWorkerHandoverReceipts(record).map(({ receipt }) => receipt.id), [first.receipt.id]);

  recordWorkerHandoverNotice(first.receipt, { id: "n7", createdAt: "2026-08-27T01:00:01.000Z" });
  assert.equal(pendingWorkerHandoverReceipts(record).length, 0);
  assert.equal(workerHandoverReceipt(record, step, input.workerSession, input.idempotencyKey)?.notice.id, "n7");
});

test("the recorded organizer Area owns a cross-Area handover receipt", () => {
  const { record, step } = fixture();
  record.organizerArea = "neara";
  const result = appendWorkerHandoverReceipt(record, step, {
    workerSession: "portland-rules-worker",
    idempotencyKey: "report-1",
    reportType: "implementation-result",
    queueRevisionBefore: 3,
    noticeText: "Report accepted.",
  });
  assert.equal(result.receipt.destinationArea, "neara");
});

test("receipt normalization preserves the notice link and rejects foreign records", () => {
  const normalized = normalizeWorkerHandoverReceipts([
    { schema: "worker-handover-receipt.v1", id: "one", notice: { text: "Accepted.", id: "n1" } },
    { schema: "foreign", id: "two" },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].notice.sourceId, "worker-handover:one");
  assert.equal(normalized[0].notice.id, "n1");
  assert.deepEqual(normalizeWorkerHandoverReceipts(null), []);
});
