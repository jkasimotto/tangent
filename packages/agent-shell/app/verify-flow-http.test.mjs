// The brain contract (ADR-0041): a brain creates and starts a Goal in one
// call, marks Goals done itself, and a Goal Julian flagged `verify: yes`
// waits for him as Check it. A brain never files a test request.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readPipeline } from "./pipeline-record.mjs";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();
const here = path.dirname(fileURLToPath(import.meta.url));

/** Posts JSON and returns the status with the parsed body. */
async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

/** One vault with a bound Area whose brain and workers run the fixture harness. */
async function buildVault(root) {
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const area = path.join(trees, "otto", "check");
  await mkdir(area, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(trees, "harnesses.md"), "# Harnesses\n\n```tangent.harnesses.v1\n" + JSON.stringify({ version: 1, harnesses: [{ id: "other", label: "Other", command: "other-agent" }] }) + "\n```\n", "utf8");
  await writeFile(path.join(area, "check.md"), `---\ntype: area\n---\n\n# Check\n\n## Knowledge\n\n- Repository: ${workspace}\n\n\`\`\`tangent.environment.v1\n{"defaults":{"launch":{"harness":"other"},"brain":{"harness":"other"}}}\n\`\`\`\n`, "utf8");
  return { trees, workspace };
}

test("a brain creates and starts a Goal in one call; Julian's flag turns the brain's done into Check it", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-verify-flow-"));
  const { trees, workspace } = await buildVault(root);
  const openedSessions = [];
  const base = await startShellServer(context, { here, root, trees, workspace, openedSessions });
  if (!base) return;

  // Only a brain starts a worker from create; nothing is written first.
  const refused = await post(base, "/api/goals/create", { area: "otto/check", goal: { title: "Not from a brain" }, start: true, caller: "julian-shell" });
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  assert.equal(refused.body.error, 'only the brain starts workers. Message it in Work (a on the Area) or run: tangent send otto/check "<what you want>"');

  const brain = await post(base, "/api/brains/start", { area: "otto/check", instruction: "Fix the flicker. I check that one myself." });
  assert.equal(brain.status, 200, JSON.stringify(brain.body));
  openedSessions.push(brain.body.session);

  // The done condition defaults to the title; --verify writes the flag; the
  // worker starts in --path with the brain's own harness lent.
  const created = await post(base, "/api/goals/create", {
    area: "otto/check",
    goal: { title: "Fix the flicker" },
    caller: brain.body.session,
    start: true,
    verify: true,
    path: workspace,
    instruction: "Make the strip repaint without flicker. Prove it with the strip test.",
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.started, true, JSON.stringify(created.body));
  openedSessions.push(created.body.session);
  const file = created.body.file;
  const goalText = await readFile(path.join(trees, file), "utf8");
  assert.match(goalText, /^done_when: Fix the flicker$/m, "the done condition defaults to the title");
  assert.match(goalText, /^verify: yes$/m);
  assert.match(goalText, /^status: active$/m);
  assert.equal(created.body.launches[0].source, "brain-default", "no --launch: the brain's harness is lent");
  assert.equal(created.body.launches[0].cwd, workspace, "--path is where the worker runs");
  const queue = await readPipeline(path.join(root, "pipelines"), "otto/check", "fix-the-flicker");
  assert.equal(queue.steps[0].instruction, "Make the strip repaint without flicker. Prove it with the strip test.");
  assert.equal("completionPolicy" in queue, false);

  // The brain's done on a flagged Goal becomes Check it: verify, no session,
  // the note in State, one notification recorded on the queue record.
  const brainDone = await post(base, "/api/goals/edit", { file, status: "done", session: brain.body.session, note: "The strip test passes." });
  assert.equal(brainDone.status, 200, JSON.stringify(brainDone.body));
  assert.equal(brainDone.body.status, "verify");
  const waiting = await readFile(path.join(trees, file), "utf8");
  assert.match(waiting, /^status: verify$/m);
  assert.match(waiting, /^session:$/m, "the session is cleared");
  assert.match(waiting, /## State\n\nThe brain marked this done: The strip test passes\. It waits for Julian to check it\./);
  const notified = await readPipeline(path.join(root, "pipelines"), "otto/check", "fix-the-flicker");
  assert.ok(notified.verifyNotifiedAt, "the notification is recorded once per entry");
  const again = await post(base, "/api/goals/edit", { file, status: "done", session: brain.body.session });
  assert.equal(again.body.status, "verify", "a repeated brain done stays Check it");
  assert.equal((await readPipeline(path.join(root, "pipelines"), "otto/check", "fix-the-flicker")).verifyNotifiedAt, notified.verifyNotifiedAt, "no second notification");
  const listed = await fetch(`${base}/api/goals?area=otto%2Fcheck`).then((response) => response.json());
  assert.deepEqual(listed.goals.map((goal) => [goal.slug, goal.status, goal.verify]), [["fix-the-flicker", "verify", true]]);

  // The reconciler leaves a Goal in verify alone.
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.match(await readFile(path.join(trees, file), "utf8"), /^status: verify$/m);

  // Julian's own Done closes it, and the notification is removed.
  const julianDone = await post(base, "/api/goals/edit", { file, status: "done" });
  assert.equal(julianDone.status, 200, JSON.stringify(julianDone.body));
  assert.match(await readFile(path.join(trees, file), "utf8"), /^status: done$/m);
  assert.equal((await readPipeline(path.join(root, "pipelines"), "otto/check", "fix-the-flicker")).verifyNotifiedAt, null, "leaving verify forgets the notification");

  // Only Julian sets the flag; a brain's done on an unflagged Goal is done.
  const plain = await post(base, "/api/goals/create", { area: "otto/check", goal: { title: "Plain work", doneWhen: "It works." }, caller: brain.body.session });
  assert.equal(plain.status, 200, JSON.stringify(plain.body));
  const brainFlag = await post(base, "/api/goals/edit", { file: plain.body.file, verify: true, session: brain.body.session });
  assert.equal(brainFlag.status, 403, "Julian flags what he checks");
  const julianFlag = await post(base, "/api/goals/edit", { file: plain.body.file, verify: true });
  assert.equal(julianFlag.status, 200, JSON.stringify(julianFlag.body));
  assert.match(await readFile(path.join(trees, plain.body.file), "utf8"), /^verify: yes$/m);
  const julianUnflag = await post(base, "/api/goals/edit", { file: plain.body.file, verify: false });
  assert.equal(julianUnflag.status, 200);
  assert.doesNotMatch(await readFile(path.join(trees, plain.body.file), "utf8"), /^verify:/m);
  const plainDone = await post(base, "/api/goals/edit", { file: plain.body.file, status: "done", session: brain.body.session });
  assert.equal(plainDone.body.status, "done", "the brain marks an unflagged Goal done");

  // A brain never files a test request.
  const testRequest = await post(base, "/api/brains/requests", { session: brain.body.session, kind: "test", subject: "Check", question: "Check it?", proposal: "Close it." });
  assert.equal(testRequest.status, 400, JSON.stringify(testRequest.body));
  assert.match(testRequest.body.error, /^Julian flags what he checks\./);
  const decision = await post(base, "/api/brains/requests", { session: brain.body.session, kind: "decision", subject: "Which", question: "Which one?", proposal: "This one." });
  assert.equal(decision.status, 200, JSON.stringify(decision.body));
});
