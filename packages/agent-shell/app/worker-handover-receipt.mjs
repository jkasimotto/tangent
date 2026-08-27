// Durable worker-handover evidence lives inside the authoritative Goal queue.
// The queue record links one worker submission to one exact-Area inbox notice.
// The inbox later records which brain generation read that notice.

import { createHash } from "node:crypto";

export const WORKER_HANDOVER_RECEIPT_SCHEMA = "worker-handover-receipt.v1";

/** Stable identity for one worker's exact retry of one assignment result. */
export function workerHandoverSubmissionId(goal, assignmentId, workerSession, idempotencyKey) {
  return createHash("sha256")
    .update(`${String(goal ?? "")}\0${String(assignmentId ?? "")}\0${String(workerSession ?? "")}\0${String(idempotencyKey ?? "")}`)
    .digest("hex");
}

/** Adds one pending notice receipt after the queue accepts a worker submission. */
export function appendWorkerHandoverReceipt(record, step, input) {
  const id = workerHandoverSubmissionId(record.goal, step.id, input.workerSession, input.idempotencyKey);
  const existing = (step.handoverReceipts ?? []).find((receipt) => receipt.id === id);
  if (existing) return { receipt: existing, duplicate: true };
  const destinationArea = String(record.controllerArea ?? record.area ?? "");
  if (!destinationArea || destinationArea !== record.area) throw new Error("worker-handover-destination-mismatch");
  const receipt = {
    schema: WORKER_HANDOVER_RECEIPT_SCHEMA,
    id,
    submittedAt: input.submittedAt ?? new Date().toISOString(),
    workerSession: String(input.workerSession ?? ""),
    goal: record.goal,
    assignmentId: step.id,
    assignmentIndex: step.index,
    reportType: String(input.reportType ?? "note"),
    queue: {
      revisionBefore: Number(input.queueRevisionBefore),
      revisionAfter: Number(record.revision),
      result: String(input.queueResult ?? "accepted"),
      assignmentStatus: step.status,
      closeGoal: input.closeGoal === true,
    },
    destinationArea,
    notice: {
      sourceId: `worker-handover:${id}`,
      text: String(input.noticeText ?? "").trim(),
      id: null,
      recordedAt: null,
    },
  };
  if (!receipt.workerSession || !receipt.notice.text) throw new Error("worker-handover-receipt-incomplete");
  step.handoverReceipts = [...(step.handoverReceipts ?? []), receipt];
  return { receipt, duplicate: false };
}

/** Finds one receipt by its stable submission identity. */
export function workerHandoverReceipt(record, step, workerSession, idempotencyKey) {
  const id = workerHandoverSubmissionId(record.goal, step.id, workerSession, idempotencyKey);
  return (step.handoverReceipts ?? []).find((receipt) => receipt.id === id) ?? null;
}

/** Every receipt whose exact inbox notice is not linked yet. */
export function pendingWorkerHandoverReceipts(record) {
  const pending = [];
  for (const step of record?.steps ?? []) {
    for (const receipt of step.handoverReceipts ?? []) {
      if (!receipt.notice?.id) pending.push({ step, receipt });
    }
  }
  return pending;
}

/** Links a queue receipt to the durable notice that represents it. */
export function recordWorkerHandoverNotice(receipt, notice) {
  if (!notice?.id) throw new Error("worker-handover-notice-missing");
  receipt.notice.id = String(notice.id);
  receipt.notice.recordedAt = notice.createdAt ?? new Date().toISOString();
  return receipt;
}

/** Adds safe defaults to receipts read from an older additive queue record. */
export function normalizeWorkerHandoverReceipts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((receipt) => receipt && typeof receipt === "object" && receipt.schema === WORKER_HANDOVER_RECEIPT_SCHEMA && receipt.id)
    .map((receipt) => ({
      ...receipt,
      notice: {
        sourceId: String(receipt.notice?.sourceId ?? `worker-handover:${receipt.id}`),
        text: String(receipt.notice?.text ?? ""),
        id: receipt.notice?.id ?? null,
        recordedAt: receipt.notice?.recordedAt ?? null,
      },
    }));
}
