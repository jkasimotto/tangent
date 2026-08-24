import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { answerBrainRequest, createBrainRequest, hasApprovedPlan, openBrainRequests, readBrainRequests, writeBrainRequests } from "./brain-requests.mjs";

test("a durable plan approval unlocks execution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brain-requests-"));
  const record = await readBrainRequests(root, "otto/tangent");
  const request = createBrainRequest(record, { kind: "plan", subject: "Work plan", question: "Approve this plan?", detail: "Two Goals" });
  assert.equal(openBrainRequests(record).length, 1);
  assert.equal(hasApprovedPlan(record), false);
  answerBrainRequest(record, request.id, "approve");
  assert.equal(hasApprovedPlan(record), true);
  createBrainRequest(record, { kind: "plan", subject: "Revised plan", question: "Approve this plan?", detail: "Three Goals" });
  assert.equal(hasApprovedPlan(record), false, "a newer plan needs its own approval");
  await writeBrainRequests(root, record);
  assert.equal((await readBrainRequests(root, "otto/tangent")).requests[0].answer, "approve");
});

test("a test request records the Goal file it is about", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  const withGoal = createBrainRequest(record, { kind: "test", subject: "Ramp faces", question: "Pass?", detail: "Drag the pole.", goal: "otto/dnd/goal-x.md" });
  assert.equal(withGoal.goal, "otto/dnd/goal-x.md");
  const withoutGoal = createBrainRequest(record, { kind: "test", subject: "Ramp faces", question: "Pass?", detail: "Drag the pole." });
  assert.equal(withoutGoal.goal, null);
});

test("decisions need choices and reject unknown answers", async () => {
  const record = await readBrainRequests("/missing", "otto/tangent");
  assert.throws(() => createBrainRequest(record, { kind: "decision", subject: "Behavior", question: "Which?", options: ["One"] }), /at least two/);
  const request = createBrainRequest(record, { kind: "decision", subject: "Behavior", question: "Which?", options: ["One", "Two"] });
  assert.throws(() => answerBrainRequest(record, request.id, "Three"), /One, Two/);
});
