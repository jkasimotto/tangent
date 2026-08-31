// The worker contract (D5, D6): a worker has one command, `tangent send
// brain`, and the server refuses every other Tangent mutation from it.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readInbox } from "./brain-inbox.mjs";
import { readGoalPresentations } from "./goal-presentations.mjs";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { readPipeline } from "./job-record.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const area = "otto/sendprobe";

/** Posts JSON as one named tmux session and returns the status and body. */
async function post(base, route, body, session = "") {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(session ? { "x-tangent-session": session } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Writes one Area with a repository so workers can start. */
async function buildVault(root) {
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  await mkdir(path.join(trees, area), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), "# Harnesses\n\n```tangent.harnesses.v1\n{\"version\":1,\"harnesses\":[{\"id\":\"test\",\"label\":\"Test\",\"command\":\"true\"}]}\n```\n", "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n\n```tangent.environment.v2\n{\"version\":2,\"allow\":[\"test\"]}\n```\n", "utf8");
  await writeFile(path.join(trees, area, "sendprobe.md"), `---\ntype: area\n---\n\n# Send probe\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  await mkdir(path.join(trees, "otto", "other"), { recursive: true });
  await writeFile(path.join(trees, "otto", "other", "other.md"), `---\ntype: area\n---\n\n# Other\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  return { trees, workspace };
}

/** Creates one Goal and starts its sole assignment as a worker. */
async function startWorker(base, brain, openedSessions, title, kind = "implementation") {
  const created = await post(base, "/api/goals/create", { area, caller: brain, goal: { title, doneWhen: `${title} is proved.` } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const started = await post(base, "/api/goals/start", {
    file: created.body.file,
    caller: brain,
    steps: [{ instruction: `Complete ${title}.`, command: "sleep 300", kind }],
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  openedSessions.push(started.body.session);
  return { goal: created.body.file, slug: started.body.pipeline.slug, ...started.body };
}

/** Reads the authoritative queue written by the server. */
async function readQueue(root, worker) {
  return readPipeline(path.join(root, "pipelines"), area, worker.slug);
}

test("a worker sends notes, blocked reports, and done to its brain, and nothing else", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "worker-send-"));
  const { trees, workspace } = await buildVault(root);
  const openedSessions = [];
  const base = await startShellServer(context, { here, root, trees, workspace, openedSessions });
  if (!base) return;

  const brain = await post(base, "/api/brains/start", { area, instruction: "Own the send probe." });
  assert.equal(brain.status, 200, JSON.stringify(brain.body));
  openedSessions.push(brain.body.session);
  const otherBrain = await post(base, "/api/brains/start", { area: "otto/other", instruction: "Own other work." });
  assert.equal(otherBrain.status, 200, JSON.stringify(otherBrain.body));
  openedSessions.push(otherBrain.body.session);

  // A plain note: kept on the assignment, told to the brain, no status change.
  const worker = await startWorker(base, brain.body.session, openedSessions, "Send probe");
  const before = await readQueue(root, worker);
  const note = await post(base, "/api/agents/send", { to: "brain", from: worker.session, text: "Parser wired. Next: the route." });
  assert.equal(note.status, 200, JSON.stringify(note.body));
  assert.equal(note.body.status, "queued");
  assert.equal(note.body.kind, "note");
  assert.equal(note.body.to, brain.body.session, "the note names the brain that controls the worker's Goal");
  const afterNote = await readQueue(root, worker);
  assert.equal(afterNote.steps[0].status, "running", "a note changes no assignment status");
  assert.equal(afterNote.revision, before.revision, "a note changes no queue revision");
  assert.match(afterNote.steps[0].handover, /Parser wired/);
  assert.equal(afterNote.steps[0].handoverReceipts[0].reportType, "note");
  const inboxAfterNote = await readInbox(path.join(root, "brains"), area);
  const noteNotice = inboxAfterNote.notices.find((entry) => entry.id === note.body.receipt.notice.id);
  assert.match(noteNotice.text, /^note: Parser wired/);

  // The same note again is an exact retry: one receipt, one notice.
  const again = await post(base, "/api/agents/send", { to: "brain", from: worker.session, text: "Parser wired. Next: the route." });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.state, "repeated");
  assert.equal((await readQueue(root, worker)).steps[0].handoverReceipts.length, 1);

  const revisionBeforeRemovedKind = afterNote.revision;
  const removedKind = await post(base, "/api/agents/send", { to: "brain", from: worker.session, text: "Keep the old field name?", kind: "question" });
  assert.equal(removedKind.status, 400);
  assert.equal((await readQueue(root, worker)).revision, revisionBeforeRemovedKind);

  const stoppedBrain = await post(base, "/api/brains/stop", { area, expectedAttemptId: brain.body.session, operationId: "stale-answer-stop" });
  assert.equal(stoppedBrain.status, 200, JSON.stringify(stoppedBrain.body));
  const currentBrain = await post(base, "/api/brains/start", { area, resume: true, instruction: "Continue coordinating the Area." });
  assert.equal(currentBrain.status, 200, JSON.stringify(currentBrain.body));
  openedSessions.push(currentBrain.body.session);
  const staleAnswer = await post(base, "/api/agents/send", { to: worker.session, from: brain.body.session, text: "Use neither." }, brain.body.session);
  assert.notEqual(staleAnswer.body.status, "answered");

  const ordinary = await post(base, "/api/agents/send", { to: worker.session, from: otherBrain.body.session, text: "Use neither." }, otherBrain.body.session);
  assert.equal(ordinary.status, 409, "ordinary messaging keeps its shell-safety refusal");

  // Done: the assignment is complete, stored as the typed result readers know.
  const second = await startWorker(base, currentBrain.body.session, openedSessions, "Second probe");
  const designFile = path.join(trees, area, "design-second-probe.md");
  await writeFile(designFile, "# Second probe design\n", "utf8");
  const outside = path.join(root, "outside.md");
  await writeFile(outside, "# Outside\n", "utf8");
  const refusedPresentation = await post(base, "/api/agents/send", { to: "brain", from: second.session, text: "Do not complete.", kind: "done", present: [outside] });
  assert.equal(refusedPresentation.status, 400);
  assert.equal(refusedPresentation.body.error, "the document is outside the vault and this Goal's repository");
  assert.equal((await readQueue(root, second)).steps[0].status, "running", "an unauthorized absolute path cannot complete the handover");
  const done = await post(base, "/api/agents/send", { to: "brain", from: second.session, text: "Route wired; npm test green.", kind: "done", present: [designFile] });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const afterDone = await readQueue(root, second);
  assert.equal(afterDone.steps[0].status, "complete");
  assert.deepEqual({ type: afterDone.steps[0].reports[0].type, status: afterDone.steps[0].reports[0].status, summary: afterDone.steps[0].reports[0].summary },
    { type: "implementation-result", status: "done", summary: "Route wired; npm test green." });
  const presentation = await readGoalPresentations(path.join(root, "presented"), area, second.slug);
  assert.deepEqual(presentation.items.map(({ root, file }) => ({ root, file })), [{ root: "vault", file: `${area}/design-second-probe.md` }],
    "an absolute vault path completes the handover and stores the canonical vault-relative Document path");
  assert.match((await readInbox(path.join(root, "brains"), area)).notices.find((entry) => entry.id === done.body.receipt.notice.id).text, /^done: Route wired/);

  // Blocked: the assignment waits, stored as a failed report.
  const third = await startWorker(base, currentBrain.body.session, openedSessions, "Third probe");
  const blocked = await post(base, "/api/agents/send", { to: "brain", from: third.session, text: "Port 4321 is taken.", kind: "blocked" });
  assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
  const afterBlocked = await readQueue(root, third);
  assert.equal(afterBlocked.steps[0].status, "waiting");
  assert.equal(afterBlocked.steps[0].reports[0].type, "failed");

  // Done on a review step is a passed review.
  const review = await startWorker(base, currentBrain.body.session, openedSessions, "Review probe", "review");
  const reviewed = await post(base, "/api/agents/send", { to: "brain", from: review.session, text: "Reviewed the diff; all criteria hold.", kind: "done" });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  const afterReview = await readQueue(root, review);
  assert.equal(afterReview.steps[0].reports[0].type, "review-result");
  assert.equal(afterReview.steps[0].reports[0].verdict, "passed");

  // Two flags or an unknown flag is refused; a non-worker has no brain to resolve.
  const unknown = await post(base, "/api/agents/send", { to: "brain", from: worker.session, text: "x", kind: "later" });
  assert.equal(unknown.status, 400);
  const fromBrain = await post(base, "/api/agents/send", { to: "brain", from: currentBrain.body.session, text: "Hello." });
  assert.equal(fromBrain.status, 400);
  assert.equal(fromBrain.body.error, "tangent send brain works inside a worker session. Name a session or an Area path.");

  // D6: a worker session gets 403 on every other mutation and 200 on reads.
  const refused = await post(base, "/api/goals/edit", { file: worker.goal, status: "done", session: worker.session }, worker.session);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'workers only send. Use: tangent send brain "<note>"');
  const created = await post(base, "/api/goals/create", { area, caller: worker.session, goal: { title: "Sneaky", doneWhen: "Never." } }, worker.session);
  assert.equal(created.status, 403);
  const pausedProcess = await post(base, "/api/processes/control", { slug: "anything", action: "pause" }, worker.session);
  assert.equal(pausedProcess.status, 403, "a worker cannot pause or resume a process");
  assert.equal(pausedProcess.body.error, 'workers only send. Use: tangent send brain "<note>"');
  for (const route of ["/api/processes/create", "/api/processes/remove"]) {
    const answer = await post(base, route, { area, slug: "worker-loop", every: "20m", message: "No." }, worker.session);
    assert.equal(answer.status, 403, `${route} refuses a worker`);
  }
  const show = await fetch(`${base}/api/goals/show?slug=${encodeURIComponent(worker.slug)}`, { headers: { "x-tangent-session": worker.session } });
  assert.equal(show.status, 200, "a worker still reads its Goal");
  const list = await fetch(`${base}/api/goals?area=${encodeURIComponent(area)}`, { headers: { "x-tangent-session": worker.session } });
  assert.equal(list.status, 200);
  const legacy = await post(base, "/api/goals/handover", { session: worker.session, text: "Legacy alias still lands." }, worker.session);
  assert.equal(legacy.status, 200, "the alias route is the send path and stays open");
  assert.equal(legacy.body.status, "noted");
  const fromBrainEdit = await post(base, "/api/goals/edit", { file: worker.goal, status: "done", session: currentBrain.body.session }, currentBrain.body.session);
  assert.notEqual(fromBrainEdit.status, 403, "the gate is for workers only");

  // D6: every other write is refused for a worker, whatever the body says.
  // The first worker's Goal is done above, so the blocked worker is the probe.
  const refusedRoutes = [
    "/api/goals/attempts/replace", "/api/goals/attempts/resume", "/api/pipelines/append", "/api/pipelines/control",
    "/api/processes/check", "/api/harnesses", "/api/launch/default", "/api/brains/reply", "/api/brains/verdict", "/api/brains/requests/answer",
    "/api/spawn", "/api/agent", "/api/brains/start", "/api/brains/stop", "/api/document",
  ];
  for (const route of refusedRoutes) {
    const answer = await post(base, route, { area, file: third.goal, goal: third.goal, caller: third.session, session: third.session }, third.session);
    assert.equal(answer.status, 403, `${route} refuses a worker: ${JSON.stringify(answer.body)}`);
    assert.equal(answer.body.error, 'workers only send. Use: tangent send brain "<note>"', route);
  }
  const noHandover = await fetch(`${base}/api/brains/handover`, { method: "POST", headers: { "content-type": "application/json", "x-tangent-session": third.session }, body: "{}" });
  assert.equal(noHandover.status, 404, "the brain handover route is gone, not gated");

  const browserMessage = { to: area, from: "Agent Shell", text: "Exact live Area note.", idempotencyKey: "browser-live-1" };
  const liveArea = await post(base, "/api/agents/send", browserMessage);
  const liveAreaRetry = await post(base, "/api/agents/send", browserMessage);
  assert.equal(liveArea.body.status, "sent");
  assert.equal(liveArea.body.live, true);
  assert.equal(liveAreaRetry.body.receipt, liveArea.body.receipt);
  assert.equal((await readInbox(path.join(root, "brains"), area)).notices.filter((notice) => notice.sourceId === browserMessage.idempotencyKey).length, 1);

  // D5: a worker sends only to its brain. Another session or Area is refused.
  const toBrainSession = await post(base, "/api/agents/send", { to: currentBrain.body.session, from: third.session, text: "Hello brain." });
  assert.equal(toBrainSession.status, 403);
  assert.equal(toBrainSession.body.error, `this worker reports only to ${area}: tangent send ${area} "<plain note>"`);
  const toArea = await post(base, "/api/agents/send", { to: "otto", from: third.session, text: "Hello otto." });
  assert.equal(toArea.status, 403);
  const brainToWorker = await post(base, "/api/agents/send", { to: third.session, from: currentBrain.body.session, text: "Carry on." });
  assert.notEqual(brainToWorker.status, 403, "a brain still messages its workers");

  // D8: a replacement is a new worker attempt, so only the brain requests one.
  const queue = await readQueue(root, third);
  const replaceBody = { goal: third.goal, assignmentId: queue.currentAssignmentId, expectedRevision: queue.revision, expectedAttemptId: queue.steps[0].attempts.at(-1).id, launch: { harness: "test" }, operationId: "julian-replace" };
  const julianReplace = await post(base, "/api/goals/attempts/replace", replaceBody);
  assert.equal(julianReplace.status, 403);
  assert.match(julianReplace.body.error, /^only the brain starts workers/);
});
