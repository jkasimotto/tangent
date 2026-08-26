import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PIPELINE_SCHEMA,
  RECONCILE_GRACE_MS,
  appendSteps,
  currentStep,
  deletePipeline,
  endPipeline,
  goalBindingGoneFromSnapshot,
  newPipeline,
  nextPendingStep,
  reclaimLiveSteps,
  snapshotCanJudgeAbsence,
  pipelineFinished,
  pipelinePath,
  pipelineStatus,
  queueNormalizationChanged,
  readAllPipelines,
  readPipeline,
  stepGoneFromSnapshot,
  stepStartedWithinGrace,
  validateSteps,
  withinReconcileGrace,
  writePipeline
} from "./pipeline-record.mjs";

const claude = { harness: "claude", model: "fable-5", effort: null };

/** Two valid input steps used across tests. */
function sampleSteps() {
  return [
    { instruction: "/design this Goal.", launch: claude },
    { instruction: "Review the design.", command: "codex --model gpt-5.6-sol", continueFrom: 1 }
  ];
}

/** A hand-built record whose steps carry the given statuses and sessions. */
function recordWith(statuses, sessions = []) {
  return {
    schema: PIPELINE_SCHEMA,
    area: "otto/tangent",
    slug: "x",
    steps: statuses.map((status, i) => ({ index: i + 1, status, session: sessions[i] ?? null }))
  };
}

test("read and write round trip through the area path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pipelines-"));
  const record = newPipeline({
    goal: "otto/tangent/goal-agent-pipelines.md",
    area: "otto/tangent",
    slug: "agent-pipelines",
    steps: sampleSteps(),
    now: "2026-08-15T10:00:00.000Z"
  });
  const written = await writePipeline(root, record);
  assert.equal(written, record);
  assert.notEqual(record.updatedAt, "2026-08-15T10:00:00.000Z");
  assert.equal(record.createdAt, "2026-08-15T10:00:00.000Z");

  const file = pipelinePath(root, "otto/tangent", "agent-pipelines");
  assert.equal(file, path.join(root, "otto/tangent/agent-pipelines.json"));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), record);
  assert.deepEqual(await readPipeline(root, "otto/tangent", "agent-pipelines"), record);

  const leftovers = (await readdir(path.dirname(file))).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], "atomic write leaves no tmp file");

  await deletePipeline(root, "otto/tangent", "agent-pipelines");
  assert.equal(await readPipeline(root, "otto/tangent", "agent-pipelines"), null);
  await deletePipeline(root, "otto/tangent", "agent-pipelines");
});

test("readAllPipelines walks every area and skips junk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pipelines-"));
  await writePipeline(root, newPipeline({ goal: "a.md", area: "otto/tangent", slug: "one", steps: sampleSteps() }));
  await writePipeline(root, newPipeline({ goal: "b.md", area: "neara/pgande", slug: "two", steps: sampleSteps() }));
  await writeFile(path.join(root, "otto/tangent/notes.txt"), "not json");
  await writeFile(path.join(root, "otto/tangent/broken.json"), "{ nope");
  const all = await readAllPipelines(root);
  assert.deepEqual(all.map((r) => `${r.area}/${r.slug}`).sort(), ["neara/pgande/two", "otto/tangent/one"]);
});

test("readAllPipelines is empty when the root is missing", async () => {
  const root = path.join(await mkdtemp(path.join(tmpdir(), "pipelines-")), "missing");
  assert.deepEqual(await readAllPipelines(root), []);
});

test("readPipeline returns null for a missing or unparsable file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pipelines-"));
  assert.equal(await readPipeline(root, "otto/tangent", "nope"), null);
  await mkdir(path.join(root, "otto/tangent"), { recursive: true });
  await writeFile(pipelinePath(root, "otto/tangent", "bad"), "{");
  assert.equal(await readPipeline(root, "otto/tangent", "bad"), null);
});

test("validateSteps enforces the step count", () => {
  assert.equal(validateSteps([]), "a pipeline needs 1 to 20 steps");
  assert.equal(validateSteps(null), "a pipeline needs 1 to 20 steps");
  const many = Array.from({ length: 21 }, () => ({ instruction: "x", launch: claude }));
  assert.equal(validateSteps(many), "a pipeline needs 1 to 20 steps");
  assert.equal(validateSteps(many.slice(0, 20)), null);
});

test("validateSteps rejects empty and oversized instructions", () => {
  assert.equal(validateSteps([{ instruction: "ok", launch: claude }, { instruction: "  ", launch: claude }, { instruction: "", launch: claude }]), "step 2: instruction is empty");
  assert.equal(validateSteps([{ launch: claude }]), "step 1: instruction is empty");
  assert.equal(validateSteps([{ instruction: "x".repeat(2001), launch: claude }]), "step 1: instruction is longer than 2000 characters");
  assert.equal(validateSteps([{ instruction: "x".repeat(2000), launch: claude }]), null);
});

test("validateSteps requires a launch or a command", () => {
  assert.equal(validateSteps([{ instruction: "a", launch: claude }, { instruction: "b" }]), "step 2: needs a launch or a command");
  assert.equal(validateSteps([{ instruction: "a", launch: { harness: "" } }]), "step 1: needs a launch or a command");
  assert.equal(validateSteps([{ instruction: "a", launch: null, command: "  " }]), "step 1: needs a launch or a command");
  assert.equal(validateSteps([{ instruction: "a", command: "claude" }]), null);
  assert.equal(validateSteps([{ instruction: "a", launch: { harness: "codex" } }]), null);
});

test("validateSteps requires continueFrom to name an earlier step", () => {
  assert.equal(validateSteps([{ instruction: "a", launch: claude, continueFrom: 1 }]), "step 1: continueFrom must name an earlier step");
  assert.equal(validateSteps([{ instruction: "a", launch: claude }, { instruction: "b", launch: claude, continueFrom: 2 }]), "step 2: continueFrom must name an earlier step");
  assert.equal(validateSteps([{ instruction: "a", launch: claude }, { instruction: "b", launch: claude, continueFrom: 0 }]), "step 2: continueFrom must name an earlier step");
  assert.equal(validateSteps([{ instruction: "a", launch: claude }, { instruction: "b", launch: claude, continueFrom: "1" }]), "step 2: continueFrom must name an earlier step");
  assert.equal(validateSteps([{ instruction: "a", launch: claude }, { instruction: "b", launch: claude, continueFrom: 1 }]), null);
  assert.equal(validateSteps([{ instruction: "a", launch: claude, continueFrom: null }, { instruction: "b", launch: claude }]), null);
});

test("newPipeline normalizes steps into the pending shape", () => {
  const record = newPipeline({
    goal: "otto/tangent/goal-x.md",
    area: "otto/tangent",
    slug: "x",
    steps: [
      { instruction: "  /design this Goal.  ", launch: { harness: " claude ", model: "fable-5" }, command: "ignored", path: "  /tmp/other-repo  " },
      { instruction: "Review.", command: "  codex --model sol ", continueFrom: 1 }
    ],
    now: "2026-08-15T10:00:00.000Z"
  });
  assert.equal(record.schema, PIPELINE_SCHEMA);
  assert.equal(record.controllerArea, "otto/tangent");
  assert.equal(record.revision, 1);
  assert.equal(record.status, "open");
  assert.equal(record.completionPolicy, "review-pass");
  assert.equal(record.goal, "otto/tangent/goal-x.md");
  assert.equal(record.createdAt, "2026-08-15T10:00:00.000Z");
  assert.equal(record.updatedAt, "2026-08-15T10:00:00.000Z");
  assert.deepEqual(record.extraFiles, []);
  assert.deepEqual(record.steps[0], {
    id: record.steps[0].id,
    index: 1,
    kind: "implementation",
    designatedReview: false,
    instruction: "/design this Goal.",
    launch: { harness: "claude", model: "fable-5", effort: null },
    command: "",
    label: "",
    launchSource: "explicit",
    path: "/tmp/other-repo",
    continueFrom: null,
    status: "pending",
    session: null,
    startedAt: null,
    endedAt: null,
    handover: null,
    handoverSource: null,
    attempts: [],
    reports: [],
    handoverReceipts: []
  });
  assert.equal(record.steps[1].index, 2);
  assert.equal(record.steps[1].launch, null);
  assert.equal(record.steps[1].command, "codex --model sol");
  assert.equal(record.steps[1].path, null);
  assert.equal(record.steps[1].continueFrom, 1);
  assert.equal(record.steps[1].launchSource, "explicit");
});

test("newPipeline keeps the harness a brain lent to an assignment", () => {
  const record = newPipeline({
    goal: "otto/tangent/goal-x.md",
    area: "otto/tangent",
    slug: "x",
    steps: [
      { instruction: "Do the work.", launch: { harness: "claude-otto", model: "fable-5" }, launchSource: "brain-default" },
      { instruction: "Review it.", launch: { harness: "claude", model: "opus-5" }, launchSource: "made up" }
    ]
  });
  assert.equal(record.steps[0].launchSource, "brain-default", "an applied default is recorded, never inferred later");
  assert.equal(record.steps[1].launchSource, "explicit", "an unknown source falls back to the caller's own choice");
});

test("newPipeline throws the validation message", () => {
  assert.throws(() => newPipeline({ goal: "g", area: "a", slug: "s", steps: [{ instruction: "" , launch: claude }] }), /step 1: instruction is empty/);
});

test("legacy queues gain open status and invalid authority pauses", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pipelines-"));
  const legacy = newPipeline({ goal: "otto/tangent/goal-x.md", area: "otto/tangent", slug: "x", steps: sampleSteps() });
  delete legacy.status;
  await mkdir(path.dirname(pipelinePath(root, "otto/tangent", "x")), { recursive: true });
  await writeFile(pipelinePath(root, "otto/tangent", "x"), `${JSON.stringify(legacy)}\n`);
  assert.equal((await readPipeline(root, "otto/tangent", "x")).status, "open");

  legacy.controllerArea = "otto";
  await writeFile(pipelinePath(root, "otto/tangent", "x"), `${JSON.stringify(legacy)}\n`);
  const invalid = await readPipeline(root, "otto/tangent", "x");
  assert.equal(invalid.status, "paused");
  assert.match(invalid.migrationProblem, /does not match exact Area/);
});

test("a later started assignment supersedes a historical legacy wait", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pipelines-"));
  const legacy = newPipeline({ goal: "otto/tangent/goal-x.md", area: "otto/tangent", slug: "x", steps: [
    { instruction: "Implement.", launch: claude },
    { instruction: "Correct the implementation.", launch: claude },
    { instruction: "Review.", launch: claude, kind: "review" },
  ] });
  legacy.steps[0].status = "waiting";
  legacy.steps[0].session = "worker-1";
  legacy.steps[0].reports = [{ type: "implementation-result", status: "blocked", reportedAt: "2026-08-26T01:00:00.000Z" }];
  legacy.steps[1].status = "complete";
  legacy.steps[1].session = "worker-2";
  legacy.steps[1].startedAt = "2026-08-26T02:00:00.000Z";
  legacy.steps[2].status = "running";
  legacy.steps[2].session = "worker-3";
  legacy.steps[2].startedAt = "2026-08-26T03:00:00.000Z";
  legacy.currentAssignmentId = legacy.steps[0].id;
  legacy.status = "paused";
  legacy.migrationProblem = "Queue has 2 current attempts.";
  await mkdir(path.dirname(pipelinePath(root, "otto/tangent", "x")), { recursive: true });
  await writeFile(pipelinePath(root, "otto/tangent", "x"), `${JSON.stringify(legacy)}\n`);

  const migrated = await readPipeline(root, "otto/tangent", "x");
  assert.equal(migrated.steps[0].status, "ended");
  assert.deepEqual(migrated.steps[0].migrationResolution, {
    kind: "superseded-by-later-assignment",
    successorAssignmentId: migrated.steps[1].id,
  });
  assert.equal(migrated.steps[0].reports[0].status, "blocked", "typed audit evidence stays attached");
  assert.equal(migrated.currentAssignmentId, migrated.steps[2].id);
  assert.equal(migrated.status, "open");
  assert.equal(migrated.migrationProblem, null);
  assert.equal(queueNormalizationChanged(migrated), true);

  await writePipeline(root, migrated);
  const persisted = await readPipeline(root, "otto/tangent", "x");
  assert.equal(queueNormalizationChanged(persisted), false, "the canonical migration is a single write");
  assert.equal(persisted.steps[0].status, "ended");
});

test("currentStep prefers running or stopped, then the first pending", () => {
  assert.equal(currentStep(recordWith(["complete", "running", "pending"])).index, 2);
  assert.equal(currentStep(recordWith(["complete", "stopped", "pending"])).index, 2);
  assert.equal(currentStep(recordWith(["complete", "skipped", "pending", "pending"])).index, 3);
  assert.equal(currentStep(recordWith(["complete", "skipped"])), null);
  assert.equal(currentStep(recordWith(["complete", "waiting", "pending"])).index, 2);
  assert.equal(currentStep({ steps: [] }), null);
});

test("nextPendingStep finds the first pending step after an index", () => {
  const record = recordWith(["complete", "skipped", "pending", "pending"]);
  assert.equal(nextPendingStep(record, 1).index, 3);
  assert.equal(nextPendingStep(record, 3).index, 4);
  assert.equal(nextPendingStep(record, 4), null);
  assert.equal(nextPendingStep(recordWith(["complete"]), 0), null);
});

test("pipelineStatus derives from step statuses and session liveness", () => {
  /** Every session is live. */
  const live = () => true;
  /** Every session is gone. */
  const dead = () => false;
  assert.equal(pipelineStatus(recordWith(["complete", "complete"]), live), "complete");
  assert.equal(pipelineStatus(recordWith(["complete", "skipped"]), live), "complete");
  assert.equal(pipelineStatus(recordWith(["complete", "running", "pending"], [null, "s2"]), live), "running");
  assert.equal(pipelineStatus(recordWith(["complete", "waiting", "pending"], [null, "s2"]), live), "running");
  assert.equal(pipelineStatus(recordWith(["complete", "running", "pending"], [null, "s2"]), dead), "stopped");
  assert.equal(pipelineStatus(recordWith(["complete", "stopped", "pending"]), live), "stopped");
  assert.equal(pipelineStatus(recordWith(["pending", "pending"]), live), "pending");
  const asked = [];
  pipelineStatus(recordWith(["complete", "running"], [null, "s2"]), (name) => { asked.push(name); return true; });
  assert.deepEqual(asked, ["s2"]);
});

test("appendSteps adds pending steps after the ones that already ran", () => {
  const record = newPipeline({ goal: "g", area: "otto/tangent", slug: "x", steps: sampleSteps(), now: "2026-08-16T10:00:00.000Z" });
  record.steps[0].status = "complete";
  record.steps[0].handover = "Design written.";
  record.steps[1].status = "running";
  record.steps[1].session = "tangent--x--s2";
  const added = appendSteps(record, [
    { instruction: "  Prove it.  ", launch: claude, continueFrom: 2 },
    { instruction: "Ship it.", command: "codex" }
  ]);
  assert.equal(record.steps.length, 4);
  assert.deepEqual(added.map((step) => [step.index, step.status, step.instruction, step.continueFrom]), [[3, "pending", "Prove it.", 2], [4, "pending", "Ship it.", null]]);
  assert.equal(record.steps[2], added[0]);
  // What already ran is untouched.
  assert.equal(record.steps[0].status, "complete");
  assert.equal(record.steps[0].handover, "Design written.");
  assert.equal(record.steps[1].session, "tangent--x--s2");
});

test("appendSteps validates the new steps in their final numbering", () => {
  const record = newPipeline({ goal: "g", area: "a", slug: "s", steps: sampleSteps() });
  assert.throws(() => appendSteps(record, []), /at least one step/);
  assert.throws(() => appendSteps(record, [{ instruction: "", launch: claude }]), /step 3: instruction is empty/);
  assert.throws(() => appendSteps(record, [{ instruction: "x", launch: claude, continueFrom: 3 }]), /step 3: continueFrom must name an earlier step/);
  assert.throws(() => appendSteps(record, [{ instruction: "x" }]), /step 3: needs a launch or a command/);
  const full = newPipeline({ goal: "g", area: "a", slug: "s", steps: Array.from({ length: 20 }, () => ({ instruction: "x", launch: claude })) });
  assert.throws(() => appendSteps(full, [{ instruction: "one more", launch: claude }]), /1 to 20 steps/);
  assert.equal(record.steps.length, 2, "a rejected append leaves the record as it was");
});

test("pipelineFinished is true only when every step is complete, skipped, or ended", () => {
  assert.equal(pipelineFinished(recordWith(["complete", "skipped"])), true);
  assert.equal(pipelineFinished(recordWith(["complete", "ended", "ended"])), true);
  assert.equal(pipelineFinished(recordWith(["complete", "running"])), false);
  assert.equal(pipelineFinished(recordWith(["complete", "pending"])), false);
  assert.equal(pipelineFinished(recordWith(["complete", "stopped"])), false);
  assert.equal(pipelineFinished({ steps: [] }), false);
});

test("withinReconcileGrace is true only for a recent timestamp", () => {
  const now = Date.parse("2026-08-19T13:14:00.000Z");
  assert.equal(withinReconcileGrace(now - 1, now), true);
  assert.equal(withinReconcileGrace(now - (RECONCILE_GRACE_MS - 1), now), true);
  assert.equal(withinReconcileGrace(now - RECONCILE_GRACE_MS, now), false);
  assert.equal(withinReconcileGrace(now - RECONCILE_GRACE_MS - 1, now), false);
  assert.equal(withinReconcileGrace(undefined, now), false);
  assert.equal(withinReconcileGrace(NaN, now), false);
});

test("stepStartedWithinGrace reproduces the race: a step started after a stale sessions snapshot is not yet gone", () => {
  // Mirrors the 2026-08-19 incident: startPipelineStep records startedAt,
  // then a reconcile pass runs 240 ms later against a sessions list gathered
  // before the tmux session existed. The step must not read as gone yet.
  const startedAt = "2026-08-19T13:13:51.000Z";
  const reconcileRanAt = Date.parse(startedAt) + 240;
  const step = { status: "running", session: "tangent--shift-enter", startedAt };
  assert.equal(stepStartedWithinGrace(step, reconcileRanAt), true);

  // A step that is genuinely gone (its session never reappears) still gets
  // reaped once the grace period passes.
  const laterReconcile = Date.parse(startedAt) + RECONCILE_GRACE_MS + 1;
  assert.equal(stepStartedWithinGrace(step, laterReconcile), false);
});

test("a stopped step returns to running when its exact session is live", () => {
  const record = recordWith(["complete", "stopped", "stopped"]);
  record.steps[1].session = "worker-live";
  record.steps[1].endedAt = "2026-08-25T00:00:00.000Z";
  record.steps[2].session = "worker-gone";
  assert.equal(reclaimLiveSteps(record, new Set(["worker-live"])), true);
  assert.equal(record.steps[1].status, "running");
  assert.equal(record.steps[1].endedAt, null);
  assert.equal(record.steps[2].status, "stopped");
  assert.equal(reclaimLiveSteps(record, new Set(["worker-live"])), false);
});

test("a snapshot captured before a replacement attempt started never judges it gone", () => {
  // The worker was restarted or replaced under the same Goal and step
  // identity after this snapshot was captured: the snapshot cannot see the
  // new session, and however old the wall clock says the pass is, judging
  // absence against the capture time keeps the live attempt authoritative.
  const startedAt = "2026-08-24T21:00:00.000Z";
  const capturedBeforeStart = Date.parse(startedAt) - 5 * 60_000;
  const oldSnapshot = new Set(["some-other-session"]);
  const step = { index: 1, status: "running", session: "worker-replacement", startedAt };
  assert.equal(stepGoneFromSnapshot(step, oldSnapshot, capturedBeforeStart), false);
  const goal = { status: "active", session: "worker-replacement", mtime: Date.parse(startedAt) };
  assert.equal(goalBindingGoneFromSnapshot(goal, oldSnapshot, capturedBeforeStart), false);
});

test("an empty sessions snapshot can never testify that a session ended", () => {
  // A wrong world (a test's isolated tmux socket, a sandbox, a dead tmux
  // server) shows zero sessions; a real world holds at least the other
  // sessions. Absence-based transitions must refuse the empty snapshot.
  assert.equal(snapshotCanJudgeAbsence([]), false);
  assert.equal(snapshotCanJudgeAbsence(null), false);
  assert.equal(snapshotCanJudgeAbsence(undefined), false);
  assert.equal(snapshotCanJudgeAbsence([{ name: "unrelated" }]), true);
});

test("reconcile against a stale sessions snapshot leaves a just-started step and its Goal binding alone", () => {
  // The race itself: the snapshot was listed before startPipelineStep created
  // the tmux session and wrote the step and the Goal binding; reconcile then
  // runs 240 ms after the start with that stale list.
  const startedAt = "2026-08-19T13:13:51.000Z";
  const started = Date.parse(startedAt);
  const staleSnapshot = new Map([["tangent-brain-g2", { name: "tangent-brain-g2" }]]);
  const step = { index: 1, status: "running", session: "tangent-shift-enter-s1", startedAt };
  const goal = { status: "active", session: "tangent-shift-enter-s1", mtime: started + 5 };
  assert.equal(stepGoneFromSnapshot(step, staleSnapshot, started + 240), false);
  assert.equal(goalBindingGoneFromSnapshot(goal, staleSnapshot, started + 240), false);

  // The next poll lists the new session: still not gone, long after the grace.
  const freshSnapshot = new Set(["tangent-brain-g2", "tangent-shift-enter-s1"]);
  assert.equal(stepGoneFromSnapshot(step, freshSnapshot, started + 10 * RECONCILE_GRACE_MS), false);
  assert.equal(goalBindingGoneFromSnapshot(goal, freshSnapshot, started + 10 * RECONCILE_GRACE_MS), false);

  // A session that never shows up is reaped once the grace period passes.
  assert.equal(stepGoneFromSnapshot(step, staleSnapshot, started + RECONCILE_GRACE_MS + 1), true);
  assert.equal(goalBindingGoneFromSnapshot(goal, staleSnapshot, goal.mtime + RECONCILE_GRACE_MS + 1), true);

  // Never a candidate: a step without a session, a Goal that is not active or unbound.
  assert.equal(stepGoneFromSnapshot({ status: "running", session: null, startedAt }, staleSnapshot, started + RECONCILE_GRACE_MS + 1), false);
  assert.equal(goalBindingGoneFromSnapshot({ status: "open", session: "x", mtime: 0 }, staleSnapshot, started), false);
  assert.equal(goalBindingGoneFromSnapshot({ status: "active", session: null, mtime: 0 }, staleSnapshot, started), false);
});

test("stepStartedWithinGrace is false without a usable startedAt", () => {
  assert.equal(stepStartedWithinGrace({ status: "running", session: "s" }), false);
  assert.equal(stepStartedWithinGrace({ status: "running", session: "s", startedAt: null }), false);
  assert.equal(stepStartedWithinGrace({ status: "running", session: "s", startedAt: "not a date" }), false);
});

test("stepStartedWithinGrace also covers the newest continuation's at time", () => {
  // A continuation moves step.session to a fresh tmux session while
  // startedAt stays old; a reconcile pass inside the swap window must not
  // read the step as gone.
  const startedAt = "2026-08-19T13:13:51.000Z";
  const continuedAt = "2026-08-23T09:00:00.000Z";
  const step = {
    status: "running",
    session: "tangent--x--s2--g2",
    startedAt,
    continuations: [{ session: "tangent--x--s2", next: "tangent--x--s2--g2", facts: "done part 1", at: continuedAt }]
  };
  assert.equal(stepStartedWithinGrace(step, Date.parse(continuedAt) + 240), true);
  assert.equal(stepStartedWithinGrace(step, Date.parse(continuedAt) + RECONCILE_GRACE_MS + 1), false);

  // With both timestamps old, the step is outside grace.
  const stale = { ...step, continuations: [{ ...step.continuations[0], at: startedAt }] };
  assert.equal(stepStartedWithinGrace(stale, Date.parse(startedAt) + RECONCILE_GRACE_MS + 1), false);
});

test("endPipeline ends what has not run and leaves history alone", () => {
  const record = recordWith(["complete", "stopped", "pending", "skipped", "running"]);
  record.steps[4].attempts = [{ id: "attempt-5", session: "worker-5", endedAt: null, result: null }];
  record.steps[0].handover = "Design written.";
  record.steps[1].handover = "Half a review.";
  assert.deepEqual(endPipeline(record, "2026-08-17T10:00:00.000Z"), [2, 3, 5]);
  assert.deepEqual(record.steps.map((step) => step.status), ["complete", "ended", "ended", "skipped", "ended"]);
  assert.equal(record.steps[1].handover, "Half a review.", "an ended step keeps its handover");
  assert.equal(record.steps[1].endedAt, "2026-08-17T10:00:00.000Z");
  assert.deepEqual(record.steps[4].attempts[0].result, { type: "canceled", summary: "The Goal queue was ended." });
  assert.equal(record.updatedAt, "2026-08-17T10:00:00.000Z");
  assert.equal(pipelineFinished(record), true);
  assert.equal(currentStep(record), null, "nothing is current after the run ends");
  assert.equal(pipelineStatus(record, () => false), "complete");
  assert.deepEqual(endPipeline(record), [], "ending twice changes nothing");
});
