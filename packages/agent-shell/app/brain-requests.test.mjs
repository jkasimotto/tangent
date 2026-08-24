import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { answerBrainRequest, createBrainRequest, hasApprovedPlan, openBrainRequests, readBrainRequests, writeBrainRequests } from "./brain-requests.mjs";

test("a durable plan approval unlocks execution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brain-requests-"));
  const record = await readBrainRequests(root, "otto/tangent");
  const request = createBrainRequest(record, { kind: "plan", subject: "Work plan", question: "Approve this plan?", proposal: "Start the two planned Goals.", detail: "Two Goals" });
  assert.equal(openBrainRequests(record).length, 1);
  assert.equal(hasApprovedPlan(record), false);
  answerBrainRequest(record, request.id, "approve");
  assert.equal(hasApprovedPlan(record), true);
  createBrainRequest(record, { kind: "plan", subject: "Revised plan", question: "Approve this plan?", proposal: "Start the three planned Goals.", detail: "Three Goals" });
  assert.equal(hasApprovedPlan(record), false, "a newer plan needs its own approval");
  await writeBrainRequests(root, record);
  assert.equal((await readBrainRequests(root, "otto/tangent")).requests[0].answer, "approve");
});

test("a test request records the Goal file it is about", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  const withGoal = createBrainRequest(record, { kind: "test", subject: "Ramp faces", question: "Approve this result?", proposal: "Close the Goal as done.", detail: "Drag the pole.", goal: "otto/dnd/goal-x.md" });
  assert.equal(withGoal.goal, "otto/dnd/goal-x.md");
  const withoutGoal = createBrainRequest(record, { kind: "test", subject: "Ramp faces", question: "Approve this result?", proposal: "Accept the result.", detail: "Drag the pole." });
  assert.equal(withoutGoal.goal, null);
});

test("new requests need a concrete proposal", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  assert.throws(() => createBrainRequest(record, { kind: "approval", subject: "Behavior", question: "Which?" }), /proposal is required/);
});

test("all requests use approval or typed changes", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  const request = createBrainRequest(record, { kind: "test", subject: "Diagrams", question: "Approve this result?", proposal: "Close the Goal as done.", detail: "Open one Document." });
  assert.throws(() => answerBrainRequest(record, request.id, "changes"), /need text/);
  const answered = answerBrainRequest(record, request.id, "changes", "Labels overlap.");
  assert.equal(answered.answer, "changes");
  assert.equal(answered.note, "Labels overlap.");
});

test("a request cannot contain an agent report", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  assert.throws(() => createBrainRequest(record, {
    kind: "test",
    subject: "Diagrams",
    question: "Do diagrams render?",
    proposal: "Close the Goal as done.",
    detail: "x".repeat(301),
  }), /300 characters/);
});

test("a stored choice Request keeps its named answers", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  record.requests.push({ id: "legacy", kind: "decision", subject: "Goal state", question: "Which did you mean?", detail: "", options: ["Keep it open", "Close it"], status: "open" });
  const answered = answerBrainRequest(record, "legacy", "Close it");
  assert.deepEqual(answered.response, { answer: "Close it", text: null, answeredAt: answered.answeredAt });
});
