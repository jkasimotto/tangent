import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { pipelinePath, readPipeline, writePipeline } from "./pipeline-record.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const goalFile = "otto/test/goal-work-contract.md";
const unrelatedGoalFile = "otto/test/goal-unrelated.md";
const launch = { harness: "test-shell" };

const harnessRegistry = `# Harnesses

\`\`\`tangent.harnesses.v1
{
  "version": 1,
  "modelSets": {},
  "harnesses": [
    { "id": "test-shell", "label": "Test shell", "command": "sleep 300" }
  ]
}
\`\`\`
`;

/** Sends one JSON request and parses its JSON response. */
async function jsonRequest(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

/** Lists only the sessions on this test file's private tmux socket. */
async function privateSessions() {
  try {
    const { stdout } = await execFileAsync("tmux", ["list-sessions", "-F", "#{session_name}"]);
    return stdout.trim().split("\n").filter(Boolean);
  } catch (error) {
    if (error?.code === 1) return [];
    throw error;
  }
}

/** Initializes the minimal Git vault that production route operations read. */
async function createVault(trees, workspace) {
  const area = path.join(trees, "otto", "test");
  await mkdir(area, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), harnessRegistry, "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, "test.md"), [
    "---", "type: area", "---", "", "# Test", "", "## Resources", "", `- Repository: ${workspace}`, "", "## Goals", "",
    "1. [[goal-work-contract]]", "2. [[goal-prerequisite]]", "3. [[goal-unrelated]]", "",
  ].join("\n"), "utf8");
  await writeFile(path.join(area, "goal-work-contract.md"), [
    "---", "type: goal", "status: open", "done_when: Every approved server work contract is durable.", "session:", "---", "",
    "# Work contract", "", "## State", "", "Ready for integration proof.", "", "## Notes", "",
    "Keep this narrative, queue history, and related evidence.", "", "## Dependencies", "", "- [[goal-prerequisite]]", "",
    "## Documents", "", "- [[design-evidence]]", "",
  ].join("\n"), "utf8");
  await writeFile(path.join(area, "goal-prerequisite.md"), [
    "---", "type: goal", "status: parked", "done_when: The prerequisite can resume later.", "session:", "---", "",
    "# Prerequisite", "", "## State", "", "Parked for this fixture.", "",
  ].join("\n"), "utf8");
  await writeFile(path.join(area, "goal-unrelated.md"), [
    "---", "type: goal", "status: open", "done_when: Unrelated work remains live.", "session:", "---", "",
    "# Unrelated", "", "## State", "", "Not started.", "",
  ].join("\n"), "utf8");
  await writeFile(path.join(area, "design-evidence.md"), "# Design evidence\n\nThe reader must retain this related Document.\n", "utf8");
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "commit", "-q", "-m", "add: contract fixture"]);
}

/** Starts one three-assignment queue through the public server route. */
async function startContractGoal(base) {
  return jsonRequest(base, "/api/goals/start", {
    file: goalFile,
    steps: [
      { id: "implementation", instruction: "Implement the contract.", kind: "implementation", launch },
      { id: "draft-review", instruction: "Review the contract.", kind: "review", launch, continueFromAssignmentId: "implementation" },
      { id: "release", instruction: "Release the contract.", kind: "implementation", launch, continueFromAssignmentId: "draft-review" },
    ],
  });
}

test("approved Agent Shell work contracts cross the real HTTP route boundary", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-work-contract-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const pipelines = path.join(root, "pipelines");
  const openedSessions = [];
  await createVault(trees, workspace);
  const base = await startShellServer(context, {
    here,
    root,
    trees,
    workspace,
    openedSessions,
    env: {
      TANGENT_SESSION_OWNERS_ROOT: path.join(root, "session-owners"),
      TANGENT_CONTINUATIONS_ROOT: path.join(root, "continuations"),
      TANGENT_GOAL_CLEANUPS_ROOT: path.join(root, "goal-cleanups"),
      TANGENT_ATTEMPT_REPLACEMENTS_ROOT: path.join(root, "attempt-replacements"),
      TANGENT_ARMED_ROOT: path.join(root, "armed"),
      TANGENT_MAP_STATE_ROOT: path.join(root, "map-state"),
      TANGENT_MESSAGE_QUEUE_FILE: path.join(root, "message-queue.json"),
      AGENT_SHELL_ACTION_LOG: path.join(root, "actions.jsonl"),
      AGENT_SHELL_REBUILD_STATE: path.join(root, "rebuild-state.json"),
      AGENT_SHELL_REBUILD_LOG: path.join(root, "rebuild.log"),
      TANGENT_RECONCILE_INTERVAL_MS: "600000",
    },
  });
  if (!base) return;

  const unrelated = await jsonRequest(base, "/api/goals/start", {
    file: unrelatedGoalFile,
    steps: [{ id: "unrelated", instruction: "Keep unrelated work alive.", launch }],
  });
  assert.equal(unrelated.response.status, 200, JSON.stringify(unrelated.body));
  const unrelatedSession = unrelated.body.session;
  openedSessions.push(unrelatedSession);

  const started = await startContractGoal(base);
  assert.equal(started.response.status, 200, JSON.stringify(started.body));
  const sourceSession = started.body.session;
  openedSessions.push(sourceSession);

  await context.test("POST /api/pipelines/mutate commits one stable-ID batch atomically", async () => {
    const initialRevision = started.body.pipeline.revision;
    const operations = [
      { type: "update", assignmentId: "release", patch: { instruction: "Release the proven contract.", continueFromAssignmentId: "implementation" } },
      { type: "move", assignmentId: "release", afterAssignmentId: "implementation" },
      { type: "remove", assignmentId: "draft-review" },
      { type: "add", afterAssignmentId: "release", assignment: { id: "final-review", instruction: "Review the release.", kind: "review", launch, continueFromAssignmentId: "release" } },
    ];
    const changed = await jsonRequest(base, "/api/pipelines/mutate", {
      goal: goalFile,
      expectedRevision: initialRevision,
      operationId: "mutate-stable-ids",
      operations,
    });
    assert.equal(changed.response.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.repeated, false);
    assert.equal(changed.body.pipeline.revision, initialRevision + 1, "the whole batch consumes one revision");
    assert.deepEqual(changed.body.pipeline.steps.map((assignment) => assignment.id), ["implementation", "release", "final-review"]);
    assert.deepEqual(changed.body.pipeline.steps.map((assignment) => assignment.continueFromAssignmentId), [null, "implementation", "release"]);
    assert.equal(changed.body.pipeline.steps[1].instruction, "Release the proven contract.");

    const persisted = await readPipeline(pipelines, "otto/test", "work-contract");
    assert.deepEqual(persisted.steps.map((assignment) => assignment.id), ["implementation", "release", "final-review"]);
    const stored = JSON.parse(await readFile(pipelinePath(pipelines, "otto/test", "work-contract"), "utf8"));
    assert.equal(stored.steps.every((assignment) => !Object.hasOwn(assignment, "continueFrom")), true, "storage uses only stable continuation IDs");

    const beforeInvalid = structuredClone(persisted);
    const invalid = await jsonRequest(base, "/api/pipelines/mutate", {
      goal: goalFile,
      expectedRevision: persisted.revision,
      operationId: "mutate-invalid",
      operations: [{ type: "remove", assignmentId: "release" }],
    });
    assert.equal(invalid.response.status, 400, JSON.stringify(invalid.body));
    assert.equal(invalid.body.code, "invalid-assignments");
    assert.deepEqual(await readPipeline(pipelines, "otto/test", "work-contract"), beforeInvalid, "a broken reference rolls back every operation");

    const repeated = await jsonRequest(base, "/api/pipelines/mutate", {
      goal: goalFile,
      expectedRevision: initialRevision,
      operationId: "mutate-stable-ids",
      operations: [{ type: "update", assignmentId: "release", patch: { instruction: "A retry cannot overwrite committed text." } }],
    });
    assert.equal(repeated.response.status, 200, JSON.stringify(repeated.body));
    assert.equal(repeated.body.repeated, true);
    assert.equal(repeated.body.pipeline.steps[1].instruction, "Release the proven contract.");
    assert.equal(repeated.body.pipeline.revision, initialRevision + 1);

    const stale = await jsonRequest(base, "/api/pipelines/mutate", {
      goal: goalFile,
      expectedRevision: initialRevision,
      operationId: "mutate-stale",
      operations: [{ type: "update", assignmentId: "release", patch: { instruction: "Stale text." } }],
    });
    assert.equal(stale.response.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.code, "stale-revision");
    assert.equal(stale.body.pipeline.revision, initialRevision + 1, "the stale response includes the current queue");
  });

  // Seed durable evidence that replacement must carry through unchanged.
  // The server generated the queue and exact live attempt; only the historical
  // evidence is fixture data because no worker has actually run in this test.
  const evidenced = await readPipeline(pipelines, "otto/test", "work-contract");
  evidenced.steps[0].handover = "Earlier durable implementation facts.";
  evidenced.steps[0].reports = [{ idempotencyKey: "earlier-evidence", type: "context-risk", summary: "Preserve this report." }];
  await writePipeline(pipelines, evidenced);

  await context.test("GET /api/goals/detail returns the complete file-or-slug projection", async () => {
    for (const requested of [goalFile, "work-contract"]) {
      const response = await fetch(`${base}/api/goals/detail?goal=${encodeURIComponent(requested)}`);
      const detail = await response.json();
      assert.equal(response.status, 200, `${requested}: ${JSON.stringify(detail)}`);
      assert.equal(detail.goal.file, goalFile);
      assert.equal(detail.goal.doneWhen, "Every approved server work contract is durable.");
      assert.equal(detail.goal.stateText, "Ready for integration proof.");
      assert.match(detail.markdown, /Keep this narrative, queue history, and related evidence\./);
      assert.deepEqual(detail.dependencies.blockers.map((blocker) => [blocker.file, blocker.status]), [["otto/test/goal-prerequisite.md", "parked"]]);
      assert.deepEqual(detail.relatedDocuments.map((document) => document.file), ["otto/test/design-evidence.md"]);
      assert.equal(detail.queue.goal, goalFile);
      assert.deepEqual(detail.current, {
        assignmentId: "implementation",
        attemptId: evidenced.steps[0].attempts[0].id,
        session: sourceSession,
      });
      assert.equal(detail.sessions.some((session) => session.name === sourceSession), true);
      assert.equal(detail.attempts.find((attempt) => attempt.id === detail.current.attemptId)?.current, true);
      assert.equal(detail.commands.find((command) => command.id === "change-agent")?.enabled, true);
      assert.equal(detail.commands.every((command) => command.enabled || command.reason), true, "disabled commands include a server reason");
    }
  });

  await context.test("exact-attempt replacement is no-loss, confirmable, and idempotent", async () => {
    const before = await readPipeline(pipelines, "otto/test", "work-contract");
    const assignmentBefore = structuredClone(before.steps[0]);
    const laterBefore = structuredClone(before.steps.slice(1));
    const request = {
      goal: goalFile,
      assignmentId: before.currentAssignmentId,
      expectedRevision: before.revision,
      expectedAttemptId: before.steps[0].attempts.at(-1).id,
      launch,
      operationId: "replace-current-attempt",
    };
    const requested = await jsonRequest(base, "/api/goals/attempts/replace", request);
    assert.equal(requested.response.status, 200, JSON.stringify(requested.body));
    assert.equal(requested.body.requiresConfirmation, true, "an unproved test harness never retires the source implicitly");
    assert.ok(requested.body.operation, "the replacement operation is durable before confirmation");
    const replacementSession = requested.body.session ?? requested.body.operation.replacementTarget?.session;
    assert.ok(replacementSession, JSON.stringify(requested.body));
    openedSessions.push(replacementSession);
    assert.ok((await privateSessions()).includes(sourceSession), "the source stays alive before explicit confirmation");
    assert.ok((await privateSessions()).includes(replacementSession), "the replacement is available for inspection");
    assert.deepEqual(await readPipeline(pipelines, "otto/test", "work-contract"), before, "an unconfirmed replacement is not current");

    const confirmed = await jsonRequest(base, "/api/goals/attempts/replace", { ...request, confirmed: true });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.operation.status, "complete");
    const after = await readPipeline(pipelines, "otto/test", "work-contract");
    const assignment = after.steps.find((item) => item.id === request.assignmentId);
    assert.equal(after.currentAssignmentId, request.assignmentId);
    assert.equal(assignment.session, replacementSession);
    assert.equal(assignment.attempts.length, assignmentBefore.attempts.length + 1);
    assert.equal(assignment.attempts[0].id, request.expectedAttemptId);
    assert.equal(assignment.attempts[0].disposition.type, "replaced");
    assert.equal(assignment.attempts.at(-1).session, replacementSession);
    assert.deepEqual({
      id: assignment.id,
      instruction: assignment.instruction,
      kind: assignment.kind,
      path: assignment.path,
      continueFromAssignmentId: assignment.continueFromAssignmentId,
      reports: assignment.reports,
      handover: assignment.handover,
    }, {
      id: assignmentBefore.id,
      instruction: assignmentBefore.instruction,
      kind: assignmentBefore.kind,
      path: assignmentBefore.path,
      continueFromAssignmentId: assignmentBefore.continueFromAssignmentId,
      reports: assignmentBefore.reports,
      handover: assignmentBefore.handover,
    });
    assert.deepEqual(after.steps.slice(1), laterBefore, "later pending assignments are not rewritten");
    assert.equal((await privateSessions()).includes(sourceSession), false, "confirmation retires only the exact source");
    assert.ok((await privateSessions()).includes(replacementSession));
    assert.ok((await privateSessions()).includes(unrelatedSession), "replacement leaves another owned worker alone");

    const late = await jsonRequest(base, "/api/goals/handover", {
      session: sourceSession,
      text: "The old source finished after replacement.",
      report: { type: "implementation-result", status: "complete", summary: "Late source evidence." },
      idempotencyKey: "late-source-evidence",
    });
    assert.equal(late.response.status, 200, JSON.stringify(late.body));
    const afterLate = await readPipeline(pipelines, "otto/test", "work-contract");
    assert.equal(afterLate.currentAssignmentId, request.assignmentId);
    assert.equal(afterLate.steps[0].session, replacementSession);
    assert.equal(afterLate.steps[0].status, "running");
    assert.equal(afterLate.steps[0].attempts[0].lateEvidence.length, 1);
    assert.equal(afterLate.steps[0].attempts[0].lateEvidence[0].summary, "Late source evidence.");
    assert.deepEqual(afterLate.steps[0].attempts.at(-1), after.steps[0].attempts.at(-1), "late source evidence cannot edit the current attempt");

    const retried = await jsonRequest(base, "/api/goals/attempts/replace", { ...request, confirmed: true });
    assert.equal(retried.response.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.repeated, true);
    const afterRetry = await readPipeline(pipelines, "otto/test", "work-contract");
    assert.equal(afterRetry.steps[0].attempts.length, assignment.attempts.length);
    assert.equal((await privateSessions()).filter((session) => session === replacementSession).length, 1);
  });

  await context.test("Park and Reopen fence the queue and never affect unrelated work", async () => {
    const active = await readPipeline(pipelines, "otto/test", "work-contract");
    const replacementSession = active.steps[0].session;
    const stale = await jsonRequest(base, "/api/goals/edit", {
      file: goalFile,
      status: "parked",
      reason: "Wait for a release window.",
      expectedRevision: active.revision - 1,
      operationId: "park-stale",
    });
    assert.equal(stale.response.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.code, "stale-revision");
    assert.deepEqual(await readPipeline(pipelines, "otto/test", "work-contract"), active, "a stale Park is atomic");
    assert.ok((await privateSessions()).includes(replacementSession));

    const parked = await jsonRequest(base, "/api/goals/edit", {
      file: goalFile,
      status: "parked",
      reason: "Wait for a release window.",
      expectedRevision: active.revision,
      operationId: "park-current",
    });
    assert.equal(parked.response.status, 200, JSON.stringify(parked.body));
    assert.equal(parked.body.status, "parked");
    const parkedQueue = await readPipeline(pipelines, "otto/test", "work-contract");
    assert.equal(parkedQueue.status, "parked");
    assert.equal(parkedQueue.currentAssignmentId, null);
    assert.equal(parkedQueue.steps[0].status, "stopped");
    assert.equal(parkedQueue.steps[0].session, null);
    assert.deepEqual(parkedQueue.steps[0].attempts.at(-1).disposition, {
      type: "parked",
      reason: "Wait for a release window.",
      at: parkedQueue.steps[0].attempts.at(-1).disposition.at,
    });
    assert.deepEqual(parkedQueue.steps.slice(1), active.steps.slice(1));
    const parkedDetail = await fetch(`${base}/api/goals/detail?goal=${encodeURIComponent(goalFile)}`).then((response) => response.json());
    assert.equal(parkedDetail.goal.status, "parked");
    assert.equal(parkedDetail.goal.session, null);
    assert.equal((await privateSessions()).includes(replacementSession), false, "a sole exact parked attempt is retired after the status commit");
    assert.ok((await privateSessions()).includes(unrelatedSession), "Park leaves another owned worker alive");

    const attemptsBeforeReopen = structuredClone(parkedQueue.steps.map((assignment) => assignment.attempts));
    const reopened = await jsonRequest(base, "/api/goals/edit", {
      file: goalFile,
      status: "open",
      expectedRevision: parkedQueue.revision,
      operationId: "reopen-parked",
    });
    assert.equal(reopened.response.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body.status, "open");
    const reopenedQueue = await readPipeline(pipelines, "otto/test", "work-contract");
    assert.equal(reopenedQueue.status, "open");
    assert.equal(reopenedQueue.currentAssignmentId, null);
    assert.equal(reopenedQueue.steps[0].status, "stopped");
    assert.deepEqual(reopenedQueue.steps.map((assignment) => assignment.attempts), attemptsBeforeReopen);
    assert.equal(reopenedQueue.parks.at(-1).reopenedAt != null, true);
    assert.equal((await privateSessions()).includes(replacementSession), false, "Reopen does not start an agent");
    assert.ok((await privateSessions()).includes(unrelatedSession));
  });
});
