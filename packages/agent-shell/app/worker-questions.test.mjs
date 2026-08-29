import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acknowledgeWorkerQuestion,
  answerWorkerQuestion,
  latestWorkerQuestion,
  openWorkerQuestion,
  transferWorkerQuestions,
  workerQuestionDelivery,
  workerQuestionId,
  workerQuestionPrompt,
} from "./worker-questions.mjs";
import { readPipeline, writePipeline } from "./pipeline-record.mjs";
import { deriveAttemptState } from "./attempt-state.mjs";

const NOW = "2026-08-29T10:00:00.000Z";

/** One queue that reproduces a worker question ending its source attempt. */
function fixture() {
  const report = openWorkerQuestion({
    type: "question-needed",
    summary: "Use A or B?",
    question: "Use A or B?",
    idempotencyKey: "report:worker:question",
    reportedAt: NOW,
  }, { attempt: { id: "attempt-1", session: "worker-1" }, session: "worker-1", now: NOW });
  const attempt = { id: "attempt-1", session: "worker-1", endedAt: NOW, result: structuredClone(report), report: structuredClone(report) };
  return {
    schema: "area-goal-queue.v2",
    goal: "otto/goal-probe.md",
    area: "otto",
    slug: "probe",
    revision: 3,
    status: "open",
    currentAssignmentId: "assignment-1",
    idempotencyKeys: [report.idempotencyKey],
    steps: [{ id: "assignment-1", index: 1, status: "waiting", session: "worker-1", endedAt: NOW, reports: [report], attempts: [attempt] }],
  };
}

test("an answer resolves the queue and the exact current attempt acknowledges it", () => {
  const queue = fixture();
  const answered = answerWorkerQuestion(queue, { targetSession: "worker-1", text: "Use A.", brainSession: "otto-brain", operationId: "answer-1", now: NOW });
  assert.equal(answered.state, "answered");
  assert.equal(queue.steps[0].status, "running");
  assert.equal(queue.currentAssignmentId, "assignment-1");
  assert.equal(queue.steps[0].attempts[0].endedAt, null, "the same live attempt resumes");
  assert.equal(latestWorkerQuestion(queue.steps[0]).state.answer.text, "Use A.");
  const delivery = workerQuestionDelivery(queue, { questionId: answered.question.id, attemptId: "attempt-1", session: "worker-1" });
  assert.equal(delivery.status, "answered");
  assert.equal(delivery.answer.text, "Use A.");
  const acknowledged = acknowledgeWorkerQuestion(queue, { questionId: answered.question.id, attemptId: "attempt-1", session: "worker-1", operationId: "ack-1", now: NOW });
  assert.equal(acknowledged.state, "acknowledged");
  assert.equal(workerQuestionDelivery(queue, { questionId: answered.question.id, attemptId: "attempt-1", session: "worker-1" }).status, "acknowledged");
});

test("duplicate and concurrent different answers are deterministic", () => {
  const queue = fixture();
  const first = answerWorkerQuestion(queue, { targetSession: "worker-1", text: "Use A.", brainSession: "otto-brain", operationId: "answer-1", now: NOW });
  const retry = answerWorkerQuestion(queue, { targetSession: "worker-1", text: "Use A.", brainSession: "otto-brain", operationId: "answer-2", now: NOW });
  assert.equal(retry.state, "repeated", "a repeated command cannot add an answer");
  assert.equal(queue.revision, 4);
  assert.throws(() => answerWorkerQuestion(queue, { targetSession: "worker-1", text: "Use B.", brainSession: "otto-brain", operationId: "answer-3", now: NOW }), (error) => error.code === "question-already-answered");
  assert.equal(latestWorkerQuestion(queue.steps[0]).state.answer.operationId, first.question.answer.operationId);
});

test("a replacement receives an open question and its later answer", () => {
  const queue = fixture();
  const replacement = { id: "attempt-2", session: "worker-2", endedAt: null, result: null };
  queue.steps[0].attempts.push(replacement);
  queue.steps[0].session = replacement.session;
  transferWorkerQuestions(queue.steps[0], replacement, "2026-08-29T10:01:00.000Z");
  const id = workerQuestionId(queue.steps[0].reports[0]);
  assert.equal(workerQuestionDelivery(queue, { questionId: id, attemptId: "attempt-1", session: "worker-1" }).status, "transferred");
  assert.equal(workerQuestionDelivery(queue, { questionId: id, attemptId: "attempt-2", session: "worker-2" }).status, "open");
  const answer = answerWorkerQuestion(queue, { targetSession: "worker-1", text: "Use A.", brainSession: "otto-brain", operationId: "answer-1", now: NOW });
  assert.equal(answer.question.recipient.session, "worker-2", "a stale source target resolves to the current replacement");
  assert.equal(workerQuestionDelivery(queue, { questionId: id, attemptId: "attempt-2", session: "worker-2" }).answer.text, "Use A.");
});

test("an answer with no live attempt survives for a future attempt and its prompt", () => {
  const queue = fixture();
  queue.status = "parked";
  queue.currentAssignmentId = null;
  queue.steps[0].status = "stopped";
  queue.steps[0].session = null;
  queue.steps[0].attempts[0].endedAt = NOW;
  const answered = answerWorkerQuestion(queue, { targetSession: "worker-1", text: "Use A.", brainSession: "otto-brain", operationId: "answer-1", now: NOW });
  assert.equal(answered.question.recipient, null);
  assert.equal(queue.status, "parked");
  const fresh = { id: "attempt-2", session: "worker-2", endedAt: null, result: null };
  queue.steps[0].attempts.push(fresh);
  queue.steps[0].session = fresh.session;
  transferWorkerQuestions(queue.steps[0], fresh, "2026-08-29T10:02:00.000Z");
  assert.match(workerQuestionPrompt(queue.steps[0]), /Answer from otto-brain: Use A\./);
  assert.equal(workerQuestionDelivery(queue, { questionId: answered.question.id, attemptId: "attempt-2", session: "worker-2" }).status, "answered");
});

test("legacy question reports derive stable state and open prompts", () => {
  const queue = fixture();
  delete queue.steps[0].reports[0].questionState;
  delete queue.steps[0].attempts[0].result.questionState;
  const first = latestWorkerQuestion(queue.steps[0]).state;
  const second = latestWorkerQuestion(structuredClone(queue.steps[0])).state;
  assert.equal(first.id, second.id);
  assert.equal(first.status, "open");
  assert.match(workerQuestionPrompt(queue.steps[0]), /This question still waits for the brain/);
});

test("an unrelated session remains an ordinary non-question target", () => {
  const queue = fixture();
  assert.equal(answerWorkerQuestion(queue, { targetSession: "other-worker", text: "Hello.", brainSession: "otto-brain", operationId: "message-1", now: NOW }).state, "not-question");
  assert.equal(queue.revision, 3);
});

test("an answer and its acknowledgement survive a controller restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "worker-question-restart-"));
  const queue = fixture();
  const answered = answerWorkerQuestion(queue, { targetSession: "worker-1", text: "Use A.", brainSession: "otto-brain", operationId: "answer-1", now: NOW });
  await writePipeline(root, queue);
  const restarted = await readPipeline(root, queue.area, queue.slug);
  assert.equal(workerQuestionDelivery(restarted, { questionId: answered.question.id, attemptId: "attempt-1", session: "worker-1" }).answer.text, "Use A.");
  acknowledgeWorkerQuestion(restarted, { questionId: answered.question.id, attemptId: "attempt-1", session: "worker-1", operationId: "ack-1", now: NOW });
  await writePipeline(root, restarted);
  const twiceRestarted = await readPipeline(root, queue.area, queue.slug);
  assert.equal(latestWorkerQuestion(twiceRestarted.steps[0]).state.status, "acknowledged");
});

test("the control channel is identical for every observed harness family", () => {
  for (const harness of ["claude-otto", "codex", "pi"]) {
    const queue = fixture();
    queue.steps[0].attempts[0].resolvedLaunch = { ref: { harness }, command: harness };
    const answered = answerWorkerQuestion(queue, { targetSession: "worker-1", text: `Answer for ${harness}.`, brainSession: "otto-brain", operationId: `answer-${harness}`, now: NOW });
    const delivery = workerQuestionDelivery(queue, { questionId: answered.question.id, attemptId: "attempt-1", session: "worker-1" });
    assert.equal(delivery.answer.text, `Answer for ${harness}.`);
  }
});

test("the reported four-attempt replacement failure resolves from the original target", () => {
  const queue = fixture();
  const assignment = queue.steps[0];
  for (let number = 2; number <= 4; number += 1) {
    const prior = assignment.attempts.at(-1);
    prior.endedAt = `2026-08-29T10:0${number}:00.000Z`;
    prior.disposition = { type: "replaced", replacementAttemptId: `attempt-${number}` };
    const replacement = { id: `attempt-${number}`, session: `worker-${number}`, endedAt: null, result: null, report: null };
    assignment.attempts.push(replacement);
    assignment.session = replacement.session;
    transferWorkerQuestions(assignment, replacement, `2026-08-29T10:0${number}:00.000Z`);
  }
  const answered = answerWorkerQuestion(queue, {
    targetSession: "worker-1",
    text: "Install only the compatible modules and keep the other cases in their own fixture.",
    brainSession: "standards-brain-g2",
    operationId: "answer-after-four-attempts",
    now: "2026-08-29T10:05:00.000Z",
  });
  assert.equal(answered.question.recipient.attemptId, "attempt-4");
  assert.equal(answered.question.recipient.session, "worker-4");
  const projected = deriveAttemptState({
    assignment: queue.steps[0],
    observation: { at: Date.parse("2026-08-29T10:05:01.000Z"), fresh: true, process: "harness", activity: { lastOutputAt: Date.parse("2026-08-29T10:05:01.000Z"), source: "screen" }, composer: "draft", dialog: null, wall: null },
    now: Date.parse("2026-08-29T10:05:01.000Z"),
  });
  assert.equal(projected.word, "Working");
  assert.notEqual(projected.word, "Asked the brain");
});
