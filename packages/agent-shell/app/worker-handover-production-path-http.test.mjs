// Regression for the neara/portland incident shape. The child Area owns the
// durable queue and inbox while the nearest live ancestor owns delivery.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readInbox, unreadNotices } from "./brain-inbox.mjs";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { readPipeline } from "./job-record.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const area = "neara/portland";

/** Posts JSON and returns both the HTTP status and parsed body. */
async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Writes the nested parent/child Area shape from the routing incident. */
async function buildVault(root) {
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  await mkdir(path.join(trees, area), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), "# Harnesses\n\n```tangent.harnesses.v1\n{\"version\":1,\"harnesses\":[{\"id\":\"test\",\"label\":\"Test\",\"command\":\"true\"}]}\n```\n", "utf8");
  await writeFile(path.join(trees, "neara", "neara.md"), "---\ntype: area\n---\n\n# Neara\n\n```tangent.environment.v2\n{\"version\":2,\"allow\":[\"test\"]}\n```\n", "utf8");
  await writeFile(path.join(trees, area, "portland.md"), `---\ntype: area\n---\n\n# Portland\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  await mkdir(path.join(trees, "neara", "seattle"), { recursive: true });
  await writeFile(path.join(trees, "neara", "seattle", "seattle.md"), "---\ntype: area\n---\n\n# Seattle\n", "utf8");
  return { trees, workspace };
}

/** Creates one exact-Area Goal and starts its sole managed assignment. */
async function startWorker(base, brain, openedSessions, title, kind = "implementation") {
  const created = await post(base, "/api/goals/create", {
    area,
    caller: brain,
    goal: { title, doneWhen: `${title} is proved.` },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const started = await post(base, "/api/goals/start", {
    file: created.body.file,
    caller: brain,
    steps: [{ instruction: `Complete ${title}.`, command: "sleep 300", kind }],
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  openedSessions.push(started.body.session);
  return { goal: created.body.file, ...started.body };
}

/** Reads the authoritative queue written by the production server. */
async function readQueue(root, worker) {
  return readPipeline(path.join(root, "pipelines"), area, worker.pipeline.slug);
}

/** Stops one exact tmux session without changing the brain record. */
async function stopSession(name) {
  await new Promise((resolve) => execFile("tmux", ["kill-session", "-t", `=${name}`], () => resolve()));
}

/** Worker-handover notices only, excluding unrelated Area events. */
function workerNotices(inbox) {
  return inbox.notices.filter((notice) => String(notice.sourceId ?? "").startsWith("worker-handover:"));
}

/** A plain worker send through the public command boundary. */
async function sendWorker(base, session, kind, text) {
  return post(base, "/api/agents/send", { to: "brain", from: session, kind, text });
}

/** Polls one durable condition that a background reconcile pass completes. */
async function waitFor(what, check, attempts = 320) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

test("neara/portland worker handovers survive delay, rollover, restart, and exact retry", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "worker-handover-portland-"));
  const { trees, workspace } = await buildVault(root);
  const openedSessions = [];
  const base = await startShellServer(context, {
    here,
    root,
    trees,
    workspace,
    openedSessions,
    // Exercise the production scheduler without tying correctness to which
    // side of its ten-second wall-clock boundary a loaded test process lands.
    env: { TANGENT_RECONCILE_INTERVAL_MS: "100" },
  });
  if (!base) return;

  const parent = await post(base, "/api/brains/start", { area: "neara", instruction: "Own Neara." });
  const child = await post(base, "/api/brains/start", { area, instruction: "Own Portland." });
  assert.equal(parent.status, 200, JSON.stringify(parent.body));
  assert.equal(child.status, 200, JSON.stringify(child.body));
  openedSessions.push(parent.body.session, child.body.session);

  // The typed implementation report enters the child queue. Generation 1 is
  // a non-agent shell, so the durable notice remains unread while it is busy.
  const implementation = await startWorker(base, child.body.session, openedSessions, "Portland implementation");
  const implementationReport = {
    type: "implementation-result",
    status: "complete",
    summary: "Portland implementation is complete.",
    evidenceRefs: ["commit:portland-implementation"],
    problems: [],
    nextNeed: null,
  };
  const submitBody = {
    session: implementation.session,
    text: "Files and checks are in the report.",
    report: implementationReport,
  };
  const submitted = await post(base, "/api/goals/handover", submitBody);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.status, "reported");
  const receipt = submitted.body.receipt;
  assert.equal(receipt.workerSession, implementation.session);
  assert.equal(receipt.goal, implementation.goal);
  assert.equal(receipt.assignmentId, implementation.pipeline.steps[0].id);
  assert.equal(receipt.assignmentIndex, 1);
  assert.equal(receipt.reportType, "implementation-result");
  assert.equal(receipt.queue.result, "accepted");
  assert.equal(receipt.queue.assignmentStatus, "complete");
  assert.equal(receipt.destinationArea, area);
  assert.ok(receipt.notice.id);

  const implementationQueue = await readQueue(root, implementation);
  assert.equal(implementationQueue.steps[0].reports[0].idempotencyKey.startsWith(`report:${implementation.session}:`), true);
  assert.equal(implementationQueue.steps[0].handoverReceipts[0].notice.id, receipt.notice.id);
  const childBeforeRetry = await readInbox(path.join(root, "brains"), area);
  assert.equal(unreadNotices(childBeforeRetry).some((notice) => notice.id === receipt.notice.id), true, "the busy brain has not lost the notice");
  assert.equal(workerNotices(childBeforeRetry).filter((notice) => notice.id === receipt.notice.id).length, 1);

  // The exact transport retry reads the accepted operation. It does not add a
  // report, receipt, or notice.
  const retried = await post(base, "/api/goals/handover", submitBody);
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.status, "repeated");
  assert.equal(retried.body.receipt.id, receipt.id);
  assert.equal(retried.body.receipt.notice.id, receipt.notice.id);
  const afterRetryQueue = await readQueue(root, implementation);
  assert.equal(afterRetryQueue.steps[0].reports.length, 1);
  assert.equal(afterRetryQueue.steps[0].handoverReceipts.length, 1);
  assert.equal(workerNotices(await readInbox(path.join(root, "brains"), area)).filter((notice) => notice.id === receipt.notice.id).length, 1);

  // Julian restarts the brain: the woken attempt's first message carries the
  // unread notice exactly once, below his words.
  const stoppedChild = await post(base, "/api/brains/stop", { area, expectedAttemptId: child.body.session, operationId: "portland-restart" });
  assert.equal(stoppedChild.status, 200, JSON.stringify(stoppedChild.body));
  const rolled = await post(base, "/api/brains/start", { area, resume: true, instruction: "Carry the Portland queue on." });
  assert.equal(rolled.status, 200, JSON.stringify(rolled.body));
  assert.equal(rolled.body.generation, 2);
  openedSessions.push(rolled.body.session);
  const rolledPrompt = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(rolled.body.session)}`).then((response) => response.json());
  assert.match(rolledPrompt.prompt, /^Carry the Portland queue on\.\n\n/);
  assert.match(rolledPrompt.prompt, /Portland implementation is complete/);
  const deliveredImplementation = workerNotices(await readInbox(path.join(root, "brains"), area)).find((notice) => notice.id === receipt.notice.id);
  assert.equal(deliveredImplementation.deliveredGeneration, 2);
  assert.equal(deliveredImplementation.deliveredTo, rolled.body.session);

  // Free text is a note: durable on the assignment, and the assignment keeps
  // running. Kill generation 2 first to reproduce delivery during a brain
  // restart gap.
  const evidence = await startWorker(base, rolled.body.session, openedSessions, "Portland free text");
  await stopSession(rolled.body.session);
  const evidenceResult = await post(base, "/api/goals/handover", {
    session: evidence.session,
    text: "Observed the Portland failure and saved the logs.",
  });
  assert.equal(evidenceResult.status, 200, JSON.stringify(evidenceResult.body));
  assert.equal(evidenceResult.body.status, "noted");
  assert.equal(evidenceResult.body.receipt.reportType, "note");
  assert.equal(evidenceResult.body.receipt.queue.result, "note");
  const evidenceQueue = await readQueue(root, evidence);
  assert.equal(evidenceQueue.steps[0].status, "running", "a note changes no assignment status");
  assert.equal(evidenceQueue.steps[0].reports?.length ?? 0, 0, "a note is not a typed report");
  assert.match(evidenceQueue.steps[0].handover, /Observed the Portland failure/);
  assert.equal(evidenceResult.body.next, null);

  const resumed = await post(base, "/api/brains/start", { area, resume: true, instruction: "Resume Portland." });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.ok(resumed.body.generation >= 3);
  openedSessions.push(resumed.body.session);
  const resumedPrompt = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(resumed.body.session)}`).then((response) => response.json());
  assert.match(resumedPrompt.prompt, /note: Observed the Portland failure/);
  const deliveredEvidence = workerNotices(await readInbox(path.join(root, "brains"), area))
    .find((notice) => notice.id === evidenceResult.body.receipt.notice.id);
  assert.equal(deliveredEvidence.deliveredGeneration, resumed.body.generation);
  assert.equal(deliveredEvidence.deliveredTo, resumed.body.session);

  // A designated review report uses the same queue and notice operation.
  const review = await startWorker(base, resumed.body.session, openedSessions, "Portland review", "review");
  const reviewReport = {
    type: "review-result",
    verdict: "changes-required",
    summary: "One Portland criterion still needs work.",
    goalRevision: review.pipeline.goalRevision,
    criteria: [{ id: "route", passed: false, evidenceRefs: ["test:portland-route"] }],
    evidenceRefs: ["test:portland-route"],
    problems: ["The remaining criterion failed."],
    nextNeed: "Run another implementation assignment.",
  };
  const reviewBody = { session: review.session, text: "Review evidence is attached.", report: reviewReport };
  const reviewed = await post(base, "/api/goals/handover", reviewBody);
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.receipt.reportType, "review-result");
  const reviewedAgain = await post(base, "/api/goals/handover", reviewBody);
  assert.equal(reviewedAgain.body.receipt.notice.id, reviewed.body.receipt.notice.id);
  const reviewQueue = await readQueue(root, review);
  assert.equal(reviewQueue.steps[0].reports.length, 1);
  assert.equal(reviewQueue.steps[0].reports[0].verdict, "changes-required");

  // Reproduce the crash window between queue acceptance and inbox storage.
  // The first call fails loudly. The persisted receipt is then repaired by
  // the production reconcile loop, and the worker's retry finds one notice.
  const repair = await startWorker(base, resumed.body.session, openedSessions, "Portland notice repair");
  const repairReport = {
    type: "implementation-result",
    status: "complete",
    summary: "The notice outbox can repair delivery.",
    evidenceRefs: ["test:notice-repair"],
    problems: [],
    nextNeed: null,
  };
  const repairBody = { session: repair.session, text: "Exercise the notice repair path.", report: repairReport };
  const childBrainDirectory = path.join(root, "brains", area);
  let interrupted;
  await chmod(childBrainDirectory, 0o500);
  try {
    interrupted = await post(base, "/api/goals/handover", repairBody);
  } finally {
    await chmod(childBrainDirectory, 0o700);
  }
  assert.equal(interrupted.status, 503, JSON.stringify(interrupted.body));
  assert.match(interrupted.body.error, /queue recorded submission.*notice is not durable yet.*Run the same Area send again, unchanged/i);
  const pendingRepair = await readQueue(root, repair);
  assert.equal(pendingRepair.steps[0].reports.length, 1, "queue acceptance survives the notice interruption");
  assert.equal(pendingRepair.steps[0].handoverReceipts[0].notice.id, null);
  const repairedReceipt = await waitFor("the pending worker notice receipt", async () => {
    const queue = await readQueue(root, repair);
    return queue.steps[0].handoverReceipts[0].notice.id ? queue.steps[0].handoverReceipts[0] : null;
  });
  const repairedRetry = await post(base, "/api/goals/handover", repairBody);
  assert.equal(repairedRetry.status, 200, JSON.stringify(repairedRetry.body));
  assert.equal(repairedRetry.body.status, "repeated");
  assert.equal(repairedRetry.body.receipt.notice.id, repairedReceipt.notice.id);
  assert.equal(workerNotices(await readInbox(path.join(root, "brains"), area))
    .filter((notice) => notice.id === repairedReceipt.notice.id).length, 1);

  // The parent Area never receives any child worker notice.
  assert.equal(workerNotices(await readInbox(path.join(root, "brains"), "neara")).length, 0);
  const childWorkerNotices = workerNotices(await readInbox(path.join(root, "brains"), area));
  for (const expected of [receipt.notice.id, evidenceResult.body.receipt.notice.id, reviewed.body.receipt.notice.id, repairedReceipt.notice.id]) {
    assert.equal(childWorkerNotices.filter((notice) => notice.id === expected).length, 1);
  }
});

test("the recorded organizer receives its handover and a no-live handover stays queued", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "worker-handover-ancestor-"));
  const { trees, workspace } = await buildVault(root);
  const openedSessions = [];
  const base = await startShellServer(context, {
    here, root, trees, workspace, openedSessions,
    env: { TANGENT_RECONCILE_INTERVAL_MS: "100" },
  });
  if (!base) return;

  const parent = await post(base, "/api/brains/start", { area: "neara", instruction: "Own Neara." });
  const child = await post(base, "/api/brains/start", { area, instruction: "Own Portland." });
  const sibling = await post(base, "/api/brains/start", { area: "neara/seattle", instruction: "Own Seattle." });
  for (const started of [parent, child, sibling]) assert.equal(started.status, 200, JSON.stringify(started.body));
  openedSessions.push(parent.body.session, child.body.session, sibling.body.session);

  const routedWorker = await startWorker(base, child.body.session, openedSessions, "Portland parent route");
  const stoppedChild = await post(base, "/api/brains/stop", { area, expectedAttemptId: child.body.session, operationId: "parent-route-child-stop" });
  assert.equal(stoppedChild.status, 200, JSON.stringify(stoppedChild.body));
  const routed = await sendWorker(base, routedWorker.session, "done", "The child work is complete.");
  assert.equal(routed.status, 200, JSON.stringify(routed.body));
  assert.equal(routed.body.status, "deferred");
  assert.equal(routed.body.to, null);
  assert.equal(routed.body.brainArea, null);
  assert.equal(routed.body.sourceArea, area);
  assert.equal(routed.body.receipt.queue.assignmentStatus, "complete");
  const routedNotice = workerNotices(await readInbox(path.join(root, "brains"), area))
    .find((item) => item.id === routed.body.receipt.notice.id);
  assert.equal(routedNotice.deliveredAt, null, "the source notice stays unread until prompt transport acknowledges it");
  assert.equal(workerNotices(await readInbox(path.join(root, "brains"), "neara")).length, 0, "the source inbox stays exact");
  assert.equal(workerNotices(await readInbox(path.join(root, "brains"), "neara/seattle")).length, 0, "a sibling never receives child work");

  const resumedChild = await post(base, "/api/brains/start", { area, resume: true, instruction: "Create the deferred case." });
  assert.equal(resumedChild.status, 200, JSON.stringify(resumedChild.body));
  openedSessions.push(resumedChild.body.session);
  const resumedChildPrompt = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(resumedChild.body.session)}`).then((response) => response.json());
  assert.match(resumedChildPrompt.prompt, /The child work is complete/);
  const deferredWorker = await startWorker(base, resumedChild.body.session, openedSessions, "Portland deferred route");
  assert.equal((await post(base, "/api/brains/stop", { area, expectedAttemptId: resumedChild.body.session, operationId: "deferred-child-stop" })).status, 200);
  assert.equal((await post(base, "/api/brains/stop", { area: "neara", expectedAttemptId: parent.body.session, operationId: "deferred-parent-stop" })).status, 200);
  const deferred = await sendWorker(base, deferredWorker.session, "blocked", "No active brain exists yet.");
  assert.equal(deferred.status, 200, JSON.stringify(deferred.body));
  assert.equal(deferred.body.status, "deferred");
  assert.equal(deferred.body.to, null);
  assert.equal(deferred.body.brainArea, null);
  assert.equal(deferred.body.receipt.queue.assignmentStatus, "waiting");
  const unread = workerNotices(await readInbox(path.join(root, "brains"), area))
    .find((item) => item.id === deferred.body.receipt.notice.id);
  assert.equal(unread.deliveredAt, null);

  const returnedParent = await post(base, "/api/brains/start", { area: "neara", resume: true, instruction: "Consume deferred child work." });
  assert.equal(returnedParent.status, 200, JSON.stringify(returnedParent.body));
  openedSessions.push(returnedParent.body.session);
  await waitFor("the deferred notice route after parent restart", async () => {
    const log = await readFile(path.join(root, "messages.jsonl"), "utf8");
    return log.includes(`\"to\":\"${returnedParent.body.session}\"`) && log.includes("unread notices") ? true : null;
  });
  assert.equal(workerNotices(await readInbox(path.join(root, "brains"), area))
    .filter((item) => item.id === deferred.body.receipt.notice.id).length, 1);
});

test("malformed, truncated, shell-quoted, and rejected reports cannot look successful", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "worker-handover-rejection-"));
  const { trees, workspace } = await buildVault(root);
  const openedSessions = [];
  const base = await startShellServer(context, { here, root, trees, workspace, openedSessions });
  if (!base) return;
  const brain = await post(base, "/api/brains/start", { area, instruction: "Own Portland." });
  assert.equal(brain.status, 200, JSON.stringify(brain.body));
  openedSessions.push(brain.body.session);
  const worker = await startWorker(base, brain.body.session, openedSessions, "Portland rejection");
  const before = await readQueue(root, worker);

  const truncatedResponse = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: `{"session":"${worker.session}","text":"facts","report":`,
  });
  const truncated = await truncatedResponse.json();
  assert.equal(truncatedResponse.status, 400);
  assert.match(truncated.error, /malformed or truncated JSON.*Retry.*Nothing was submitted/i);

  const quoted = await post(base, "/api/goals/handover", {
    session: worker.session,
    text: "facts",
    report: `'${JSON.stringify({ type: "implementation-result", status: "complete", summary: "Done." })}'`,
  });
  assert.equal(quoted.status, 400);
  assert.match(quoted.body.error, /not one JSON object.*retry the same handover request.*Nothing was submitted/i);

  const rejected = await post(base, "/api/goals/handover", {
    session: worker.session,
    text: "facts",
    report: { type: "implementation-result", status: "complete" },
  });
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /report-summary-required.*Correct the report.*recorded no report or brain notice/i);

  const afterFailures = await readQueue(root, worker);
  assert.equal(afterFailures.revision, before.revision);
  assert.equal(afterFailures.steps[0].status, "running");
  assert.equal(afterFailures.steps[0].reports.length, 0);
  assert.equal(afterFailures.steps[0].handoverReceipts.length, 0);
  assert.equal(workerNotices(await readInbox(path.join(root, "brains"), area)).length, 0);

  // The recovery instruction is actionable: one corrected retry succeeds.
  const corrected = await post(base, "/api/goals/handover", {
    session: worker.session,
    text: "facts",
    report: {
      type: "implementation-result",
      status: "complete",
      summary: "The corrected Portland report is complete.",
      evidenceRefs: ["test:corrected"],
      problems: [],
      nextNeed: null,
    },
  });
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  assert.ok(corrected.body.receipt.notice.id);
});
