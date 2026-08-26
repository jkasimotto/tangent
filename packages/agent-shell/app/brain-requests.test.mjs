import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { answerBrainRequest, beginRequestEffect, brainRequestAnswerNotice, closeBrainRequests, closeGoalRequests, createBrainRequest, dismissBrainRequest, finishRequestEffect, handoverBrainRequests, openBrainRequests, readBrainRequests, requestIsApproved, withdrawBrainRequest, writeBrainRequests } from "./brain-requests.mjs";

test("each durable approval stays attached to its own proposal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brain-requests-"));
  const record = await readBrainRequests(root, "otto/tangent");
  const request = createBrainRequest(record, { kind: "plan", subject: "Work plan", question: "Approve this plan?", proposal: "Start the two planned Goals.", detail: "Two Goals", conversationAnchor: { area: "otto/tangent", session: "tangent-brain", generation: 2 }, precedingContext: "The brain described the staged plan." });
  assert.equal(openBrainRequests(record).length, 1);
  assert.equal(requestIsApproved(record, request.id), false);
  assert.equal(request.conversationAnchor.session, "tangent-brain");
  assert.equal(request.precedingContext, "The brain described the staged plan.");
  answerBrainRequest(record, request.id, "approve");
  assert.equal(requestIsApproved(record, request.id), true);
  const newer = createBrainRequest(record, { kind: "plan", subject: "Unrelated plan", question: "Approve this plan?", proposal: "Start an unrelated Goal.", detail: "One Goal" });
  assert.equal(requestIsApproved(record, request.id), true, "a newer Request does not revoke an earlier approval");
  assert.equal(requestIsApproved(record, newer.id), false, "the newer proposal needs its own answer");
  answerBrainRequest(record, newer.id, "changes", "Use a smaller Goal.");
  assert.equal(requestIsApproved(record, newer.id), false, "requested changes apply to the newer proposal only");
  assert.equal(requestIsApproved(record, request.id), true);
  await writeBrainRequests(root, record);
  assert.equal((await readBrainRequests(root, "otto/tangent")).requests[0].answer, "approve");
});

test("a test request records the Goal file it is about", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  const withGoal = createBrainRequest(record, { kind: "test", subject: "Ramp faces", question: "Approve this result?", proposal: "Close the Goal as done.", detail: "Drag the pole.", goal: "otto/dnd/goal-x.md" });
  assert.equal(withGoal.goal, "otto/dnd/goal-x.md");
  assert.deepEqual(withGoal.subjectRef, { type: "goal", goal: "otto/dnd/goal-x.md" });
  assert.deepEqual(withGoal.ownerRef, { type: "brain", area: "otto/tangent", generation: null });
  const withoutGoal = createBrainRequest(record, { kind: "test", subject: "Ramp faces", question: "Approve this result?", proposal: "Accept the result.", detail: "Drag the pole." });
  assert.equal(withoutGoal.goal, null);
  assert.deepEqual(withoutGoal.subjectRef, { type: "brain", area: "otto/tangent", generation: null });
});

test("Goal closure closes only open Requests about that Goal", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  const closed = createBrainRequest(record, { kind: "test", subject: "A", question: "Accept A?", proposal: "Close A.", goal: "otto/a/goal-a.md" });
  const other = createBrainRequest(record, { kind: "test", subject: "B", question: "Accept B?", proposal: "Close B.", goal: "otto/a/goal-b.md" });
  assert.deepEqual(closeGoalRequests(record, "otto/a/goal-a.md", "goal-dropped", "2026-08-25T00:00:00.000Z"), [closed]);
  assert.equal(closed.status, "closed");
  assert.equal(closed.closedReason, "goal-dropped");
  assert.equal(other.status, "open");
});

test("brain Requests hand over deliberately or close when their brain ends", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  const request = createBrainRequest(record, { kind: "decision", subject: "Choice", question: "Approve it?", proposal: "Use it.", brainGeneration: 3 });
  const goalRequest = createBrainRequest(record, { kind: "test", subject: "Goal", question: "Accept it?", proposal: "Close it.", goal: "otto/tangent/goal-x.md", brainGeneration: 3 });
  assert.deepEqual(handoverBrainRequests(record, record.area, 3, 4), [request, goalRequest]);
  assert.deepEqual(request.subjectRef, { type: "brain", area: record.area, generation: null });
  assert.deepEqual(request.ownerRef, { type: "brain", area: record.area, generation: null });
  assert.deepEqual(goalRequest.subjectRef, { type: "goal", goal: "otto/tangent/goal-x.md" }, "handover preserves the Goal subject");
  assert.deepEqual(closeBrainRequests(record, record.area, 4, "brain-ended", "2026-08-25T00:00:00.000Z"), [request, goalRequest]);
  assert.equal(openBrainRequests(record).length, 0);
});

test("brain withdrawal and Julian dismissal are distinct durable transitions", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  const withdrawn = createBrainRequest(record, { kind: "approval", subject: "Old", question: "Approve old?", proposal: "Use old." });
  const dismissed = createBrainRequest(record, { kind: "approval", subject: "No", question: "Approve no?", proposal: "Use no." });
  withdrawBrainRequest(record, withdrawn.id, "Handled elsewhere.", "2026-08-25T00:00:00.000Z");
  dismissBrainRequest(record, dismissed.id, "2026-08-25T00:01:00.000Z");
  assert.deepEqual([withdrawn.status, withdrawn.closedReason, withdrawn.closedBy], ["closed", "withdrawn", "brain"]);
  assert.deepEqual([dismissed.status, dismissed.closedReason, dismissed.closedBy], ["closed", "dismissed", "julian"]);
});

test("legacy records gain subject identity without losing live or answered state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brain-requests-legacy-"));
  await writeBrainRequests(root, { schema: "area-brain-requests.v1", area: "otto/tangent", requests: [
    { id: "goal", goal: "otto/tangent/goal-x.md", status: "open" },
    { id: "brain", goal: null, status: "answered", answer: "approve" },
  ] });
  const record = await readBrainRequests(root, "otto/tangent");
  assert.deepEqual(record.requests[0].subjectRef, { type: "goal", goal: "otto/tangent/goal-x.md" });
  assert.deepEqual(record.requests[0].ownerRef, { type: "brain", area: "otto/tangent", generation: null });
  assert.deepEqual(record.requests[1].subjectRef, { type: "brain", area: "otto/tangent", generation: null });
  assert.deepEqual(record.requests.map((item) => item.status), ["open", "answered"]);
});

test("new requests need a concrete proposal", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  assert.throws(() => createBrainRequest(record, { kind: "approval", subject: "Behavior", question: "Which?" }), /proposal is required/);
});

test("legacy requests use approval or typed changes", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  const request = createBrainRequest(record, { kind: "test", subject: "Diagrams", question: "Approve this result?", proposal: "Close the Goal as done.", detail: "Open one Document." });
  assert.throws(() => answerBrainRequest(record, request.id, "changes"), /need text/);
  const answered = answerBrainRequest(record, request.id, "changes", "Labels overlap.");
  assert.equal(answered.answer, "changes");
  assert.equal(answered.note, "Labels overlap.");
  assert.equal(brainRequestAnswerNotice(answered), 'Julian wants these changes: Labels overlap. for "Diagrams".');
});

test("an exact effect accepts free text and rejects a stale revision", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  const effect = createBrainRequest(record, { kind: "approval", subject: "Deploy", question: "Deploy this commit?", proposal: "Deploy commit abc.", effect: { type: "deploy", commit: "abc" } });
  assert.throws(() => answerBrainRequest(record, effect.id, "authorize", "", undefined, "old"), /stale/);
  const reply = createBrainRequest(record, { kind: "decision", subject: "Scope", question: "Which scope?", proposal: "Use the Area." });
  answerBrainRequest(record, reply.id, "reply", "Use the child Area.");
  assert.equal(reply.response.text, "Use the child Area.");
});

test("an exact effect records intent, survives a problem, and retries", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  const request = createBrainRequest(record, { kind: "approval", subject: "Deploy", question: "Deploy this commit?", proposal: "Deploy commit abc.", effect: { type: "deploy", commit: "abc" } });
  beginRequestEffect(record, request.id, request.effectRevision, "effect-1", "2026-08-26T01:00:00.000Z");
  finishRequestEffect(record, request.id, { problem: "offline", now: "2026-08-26T01:01:00.000Z" });
  assert.equal(request.status, "open");
  assert.equal(request.effectOperation.status, "failed");
  beginRequestEffect(record, request.id, request.effectRevision, "effect-2", "2026-08-26T01:02:00.000Z");
  finishRequestEffect(record, request.id, { result: { deployed: "abc" }, now: "2026-08-26T01:03:00.000Z" });
  assert.equal(request.effectOperation.status, "succeeded");
  assert.equal(request.effectOperation.attempts, 2);
});

test("a brain prompt clips a long answer and still names its Request", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  const request = createBrainRequest(record, { kind: "test", subject: "Diagrams", question: "Approve this result?", proposal: "Close the Goal as done.", detail: "Open one Document." });
  // What Julian pastes when he answers "changes" with a whole review.
  const pasted = `${"Every label overlaps its neighbour. ".repeat(120)}Fix the worst first.`;
  const answered = answerBrainRequest(record, request.id, "changes", pasted);

  const line = brainRequestAnswerNotice(answered, { answerChars: 240 });
  assert.ok(line.length < 340, `one answered Request is one short line, not a quarter of the prompt: ${line.length} characters`);
  assert.match(line, /^Julian wants these changes: Every label overlaps its neighbour\./);
  assert.match(line, /clipped; the Request on Julian's desk holds his full answer/);
  // The subject sits at the end of the sentence, so a caller that clipped the
  // finished line would leave the brain an answer with no Request attached.
  assert.match(line, /for "Diagrams"\.$/);

  // The notice Julian's answer delivers to a live brain keeps every word.
  assert.ok(brainRequestAnswerNotice(answered).includes(pasted), "the notice path is untouched");
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
