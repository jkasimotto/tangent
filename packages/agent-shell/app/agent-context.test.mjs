import assert from "node:assert/strict";
import test from "node:test";

import { resolveAgentContext, unassignedAgentContext } from "./agent-context.mjs";
import { workerShellExitNotice } from "./agent-recovery.mjs";
import { appendNotice, newInbox } from "./brain-inbox.mjs";

test("brain recovery context includes current unread durable notices without a live-session check", () => {
  const context = resolveAgentContext({
    session: "tangent-brain-g2",
    brains: [{
      area: "otto/tangent",
      status: "active",
      session: "tangent-brain-g2",
      generation: 2,
      foundingInstruction: { text: "Organize the Area." },
      checkpoint: { text: "Step one is under review." },
      generations: [{ generation: 1, session: "tangent-brain", handover: "First facts." }, { generation: 2, session: "tangent-brain-g2", startedAt: "2026-08-27T00:00:00.000Z" }],
    }],
    notices: [
      { id: "n1", text: "Worker finished.", createdAt: "2026-08-27T00:01:00.000Z", deliveredAt: null },
      { id: "n2", text: "Already read.", deliveredAt: "2026-08-27T00:02:00.000Z" },
    ],
  });

  assert.equal(context.role, "brain");
  assert.equal(context.current, true);
  assert.equal(context.brain.foundingInstruction, "Organize the Area.");
  assert.equal(context.brain.checkpoint, "Step one is under review.");
  assert.deepEqual(context.unreadNotices.map((notice) => notice.text), ["Worker finished."]);
  assert.equal(context.unreadNotices[0].area, "otto/tangent");
});

test("historical brain context keeps its own handover and never receives the current brain inbox", () => {
  const context = resolveAgentContext({
    session: "tangent-brain-g1",
    brains: [{
      area: "otto/tangent",
      status: "active",
      session: "tangent-brain-g2",
      checkpoint: { text: "Current generation checkpoint." },
      generations: [
        { generation: 1, session: "tangent-brain-g1", handover: "Generation one facts." },
        { generation: 2, session: "tangent-brain-g2" },
      ],
    }],
    notices: [{ id: "n3", text: "Current work only.", deliveredAt: null }],
  });
  assert.equal(context.current, false);
  assert.equal(context.brain.checkpoint, "Generation one facts.");
  assert.deepEqual(context.unreadNotices, []);
});

test("worker context chooses the current assignment and carries exact instructions and earlier handovers", () => {
  const context = resolveAgentContext({
    session: "shared-worker",
    goals: [
      { file: "otto/tangent/goal-proof.md", slug: "proof", area: "otto/tangent", title: "Prove recovery", status: "active", doneWhen: "Recovery keeps the facts." },
      { file: "otto/tangent/goal-extra-a.md", slug: "extra-a", area: "otto/tangent", title: "Extra A", status: "open", doneWhen: "A is complete." },
      { file: "otto/tangent/goal-extra-b.md", slug: "extra-b", area: "otto/tangent", title: "Extra B", status: "open", doneWhen: "B is complete." },
      { file: "otto/tangent/goal-extra-c.md", slug: "extra-c", area: "otto/tangent", title: "Extra C", status: "active", session: "shared-worker", doneWhen: "C is complete." },
    ],
    pipelines: [{
      goal: "otto/tangent/goal-proof.md",
      slug: "proof",
      area: "otto/tangent",
      controllerArea: "otto/tangent",
      status: "open",
      revision: 7,
      currentAssignmentId: "a2",
      extraFiles: ["otto/tangent/goal-extra-b.md", "otto/tangent/goal-extra-a.md"],
      steps: [
        { id: "a1", index: 1, status: "complete", session: "shared-worker", instruction: "Investigate.", handover: "The queue is durable.", reports: [] },
        { id: "a2", index: 2, status: "running", session: "shared-worker", instruction: "Implement recovery.", kind: "implementation", attempts: [{ id: "try-2", session: "shared-worker" }], reports: [] },
      ],
    }],
  });

  assert.equal(context.role, "worker");
  assert.equal(context.current, true);
  assert.equal(context.assignment.id, "a2");
  assert.equal(context.assignment.instruction, "Implement recovery.");
  assert.equal(context.queue.revision, 7);
  assert.equal(context.goal.doneWhen, "Recovery keeps the facts.");
  assert.deepEqual(context.queue.extraFiles, ["otto/tangent/goal-extra-b.md", "otto/tangent/goal-extra-a.md"]);
  assert.deepEqual(context.extraGoals.map((goal) => goal.file), [
    "otto/tangent/goal-extra-b.md",
    "otto/tangent/goal-extra-a.md",
    "otto/tangent/goal-extra-c.md",
  ]);
  assert.deepEqual(context.priorHandovers.map((entry) => entry.handover), ["The queue is durable."]);
});

test("a historical queue attempt and a plain Goal binding remain recoverable", () => {
  const historical = resolveAgentContext({
    session: "old-worker",
    pipelines: [{
      goal: "otto/tangent/goal-proof.md", slug: "proof", area: "otto/tangent", status: "complete", revision: 8,
      steps: [{ id: "a1", index: 1, status: "complete", session: "new-worker", instruction: "Prove it.", attempts: [{ id: "old", session: "old-worker" }, { id: "new", session: "new-worker" }], reports: [] }],
    }],
  });
  assert.equal(historical.source, "goal-queue");
  assert.equal(historical.current, false);
  assert.equal(historical.assignment.attempt.id, "old");

  const plain = resolveAgentContext({ session: "solo", goals: [{ session: "solo", status: "active", area: "otto/tangent", file: "otto/tangent/goal-solo.md", slug: "solo", title: "Solo", doneWhen: "Done." }] });
  assert.equal(plain.source, "goal-record");
  assert.equal(plain.goal.title, "Solo");
  assert.equal(resolveAgentContext({ session: "missing" }), null);
  assert.deepEqual(unassignedAgentContext("plain-shell"), {
    schema: "tangent-agent-context.v1",
    source: "live-session",
    session: "plain-shell",
    role: "unassigned",
    area: null,
    current: true,
    prompt: null,
    unreadNotices: [],
    message: "This live tmux session has no durable Tangent brain or Goal assignment.",
  });
});

test("a shared plain session recovers every co-assigned Goal once", () => {
  const context = resolveAgentContext({
    session: "shared-solo",
    goals: [
      { session: "shared-solo", status: "active", area: "otto/tangent", file: "otto/tangent/goal-primary.md", slug: "primary", title: "Primary", doneWhen: "Primary is complete." },
      { session: "shared-solo", status: "active", area: "otto/tangent", file: "otto/tangent/goal-extra-a.md", slug: "extra-a", title: "Extra A", doneWhen: "A is complete." },
      { session: "shared-solo", status: "active", area: "otto/tangent", file: "otto/tangent/goal-extra-b.md", slug: "extra-b", title: "Extra B", doneWhen: "B is complete." },
      { session: "another-worker", status: "active", area: "otto/tangent", file: "otto/tangent/goal-unrelated.md", slug: "unrelated", title: "Unrelated", doneWhen: "Unrelated is complete." },
    ],
  });

  assert.equal(context.source, "goal-record");
  assert.equal(context.goal.file, "otto/tangent/goal-primary.md");
  assert.deepEqual(context.extraGoals.map((goal) => goal.file), [
    "otto/tangent/goal-extra-a.md",
    "otto/tangent/goal-extra-b.md",
  ]);
});

test("a running worker at its shell produces one stable durable notice without changing the queue", () => {
  const record = {
    goal: "otto/tangent/goal-proof.md",
    slug: "proof",
    steps: [{ id: "a1", index: 1, status: "running", session: "worker-proof", startedAt: "2026-08-27T00:00:00.000Z", attempts: [{ id: "try-1", session: "worker-proof" }] }],
  };
  const before = structuredClone(record);
  const event = workerShellExitNotice(record, record.steps[0], { name: "worker-proof", state: "shell" });
  const repeated = workerShellExitNotice(record, record.steps[0], { name: "worker-proof", state: "shell" });
  assert.deepEqual(record, before, "recovery observation does not mutate queue state");
  assert.equal(repeated.sourceId, event.sourceId);
  assert.match(event.text, /tmux session and durable assignment remain intact/i);

  const inbox = newInbox("otto/tangent");
  appendNotice(inbox, event.text, "2026-08-27T00:01:00.000Z", event.sourceId);
  const duplicate = appendNotice(inbox, event.text, "2026-08-27T00:02:00.000Z", event.sourceId);
  assert.equal(duplicate.duplicate, true);
  assert.equal(inbox.notices.length, 1, "the stable source ID makes the durable notice idempotent");
  assert.equal(workerShellExitNotice(record, record.steps[0], { name: "worker-proof", state: "working" }), null);
});
