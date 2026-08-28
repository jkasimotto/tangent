import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const area = "otto/repair";
const execFileAsync = promisify(execFile);

/** Sends one authenticated JSON request to the isolated controller. */
async function post(base, route, body, session = "") {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(session ? { "x-tangent-session": session } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Polls one durable repair fact with a bounded test deadline. */
async function waitFor(label, read, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

/** Creates the smallest exact-Area vault accepted by the controller. */
async function buildVault(root) {
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  await mkdir(path.join(trees, area), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), "# Harnesses\n\n```tangent.harnesses.v2\n{\"version\":2,\"harnesses\":[{\"id\":\"test\",\"label\":\"Test\",\"command\":\"true\"}]}\n```\n");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n\n```tangent.environment.v2\n{\"version\":2,\"allow\":[\"test\"]}\n```\n");
  await writeFile(path.join(trees, area, "repair.md"), `---\ntype: area\n---\n\n# Repair\n\n## Resources\n\n- Repository: ${workspace}\n`);
  return { trees, workspace };
}

test("a stopped brain dispatches one fenced crew and a returning brain supersedes it", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repair-crew-http-"));
  const { trees, workspace } = await buildVault(root);
  const openedSessions = [];
  const base = await startShellServer(context, {
    here, root, trees, workspace, openedSessions,
    env: { TANGENT_RECONCILE_INTERVAL_MS: "50", TANGENT_REPAIR_GRACE_MINUTES: "0" },
  });
  if (!base) return;

  const brain = await post(base, "/api/brains/start", { area, instruction: "Own repair work." });
  assert.equal(brain.status, 200, JSON.stringify(brain.body));
  openedSessions.push(brain.body.session);
  const created = await post(base, "/api/goals/create", { area, caller: brain.body.session, goal: { title: "Settle report", doneWhen: "The report is settled." } }, brain.body.session);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const brainRecord = JSON.parse(await readFile(path.join(root, "brains", area, "brain.json"), "utf8"));
  assert.equal(brainRecord.lastAction.command, "goal-create");
  assert.equal(brainRecord.lastAction.target, "settle-report");
  const started = await post(base, "/api/goals/start", { file: created.body.file, caller: brain.body.session, steps: [{ instruction: "Finish it.", command: "true", kind: "implementation" }] }, brain.body.session);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  openedSessions.push(started.body.session);
  const handed = await post(base, "/api/goals/handover", {
    session: started.body.session,
    text: "The work is complete.",
    report: { type: "implementation-result", status: "complete", summary: "Complete and proved.", evidenceRefs: ["test:repair"], problems: [], nextNeed: null },
  });
  assert.equal(handed.status, 200, JSON.stringify(handed.body));
  const stopped = await post(base, "/api/brains/stop", { area, expectedAttemptId: brain.body.session, operationId: "repair-stop" });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));

  const repair = await waitFor("the Area repair crew", async () => {
    try {
      const record = JSON.parse(await readFile(path.join(root, "repairs", `${area}.json`), "utf8"));
      return record.current?.session && record.current?.firstMessage ? record.current : null;
    } catch { return null; }
  });
  openedSessions.push(repair.session);
  assert.equal(repair.ordinal, 1);
  assert.equal(repair.instanceId.startsWith("focus-shell-"), true);
  assert.match(repair.firstMessage, /Goal settle-report: Reported done/);

  const agents = await fetch(`${base}/api/agents`).then((response) => response.json());
  const listed = agents.agents.find((agent) => agent.name === repair.session);
  assert.equal(listed.kind, "repair");
  assert.match(listed.agentState.word, /^repair crew /);
  const recovered = await fetch(`${base}/api/agents/context?session=${encodeURIComponent(repair.session)}`).then((response) => response.json());
  assert.equal(recovered.context.role, "repair");
  assert.equal(recovered.context.area, area);

  const refused = await post(base, "/api/goals/create", { area, caller: repair.session, goal: { title: "Forbidden", doneWhen: "Never." } }, repair.session);
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /repair crew finishes live work/);

  const resumed = await post(base, "/api/brains/start", { area, resume: true, instruction: "Resume after repair." });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  openedSessions.push(resumed.body.session);
  const settled = JSON.parse(await readFile(path.join(root, "repairs", `${area}.json`), "utf8"));
  assert.equal(settled.current, null);
  assert.equal(settled.history.at(-1).result, "superseded");
});

test("a repair crew can append, move a verify Goal to Check it, and finish once", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repair-crew-authority-http-"));
  const { trees, workspace } = await buildVault(root);
  const openedSessions = [];
  const base = await startShellServer(context, {
    here, root, trees, workspace, openedSessions,
    env: { TANGENT_RECONCILE_INTERVAL_MS: "50", TANGENT_REPAIR_GRACE_MINUTES: "0" },
  });
  if (!base) return;

  const brain = await post(base, "/api/brains/start", { area, instruction: "Own repair work." });
  assert.equal(brain.status, 200, JSON.stringify(brain.body));
  openedSessions.push(brain.body.session);
  const created = await post(base, "/api/goals/create", { area, caller: brain.body.session, verify: true, goal: { title: "Verify repair", doneWhen: "The repair is checked." } }, brain.body.session);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const started = await post(base, "/api/goals/start", { file: created.body.file, caller: brain.body.session, steps: [{ instruction: "Finish it.", command: "true", kind: "implementation" }] }, brain.body.session);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  openedSessions.push(started.body.session);
  const handed = await post(base, "/api/goals/handover", {
    session: started.body.session,
    text: "The work is complete.",
    report: { type: "implementation-result", status: "complete", summary: "Complete and proved.", evidenceRefs: ["test:repair-authority"], problems: [], nextNeed: null },
  });
  assert.equal(handed.status, 200, JSON.stringify(handed.body));
  const stopped = await post(base, "/api/brains/stop", { area, expectedAttemptId: brain.body.session, operationId: "repair-authority-stop" });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));

  const repair = await waitFor("the authority repair crew", async () => {
    try {
      const record = JSON.parse(await readFile(path.join(root, "repairs", `${area}.json`), "utf8"));
      return record.current?.session && record.current?.target && record.current?.firstMessage ? record.current : null;
    } catch { return null; }
  });
  openedSessions.push(repair.session);
  const fenced = await execFileAsync("tmux", ["display-message", "-p", "-t", `=${repair.session}:`, "#{session_id}\t#{@tangent_agent_shell_instance}"]);
  assert.equal(fenced.stdout.trim(), `${repair.target}\t${repair.instanceId}`);

  const appended = await post(base, "/api/pipelines/append", {
    goal: created.body.file,
    caller: repair.session,
    steps: [{ instruction: "Record the repair evidence.", command: "true", kind: "review" }],
  }, repair.session);
  assert.equal(appended.status, 200, JSON.stringify(appended.body));
  assert.equal(appended.body.status, "queued");

  const done = await post(base, "/api/goals/edit", { file: created.body.file, status: "done", session: repair.session, note: "The repair passed." }, repair.session);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.status, "verify");

  const finished = await post(base, "/api/agents/send", { to: "brain", from: repair.session, kind: "done", text: "The Goal now waits for Julian's check." }, repair.session);
  assert.equal(finished.status, 200, JSON.stringify(finished.body));
  assert.equal(finished.body.state, "done");
  const record = JSON.parse(await readFile(path.join(root, "repairs", `${area}.json`), "utf8"));
  assert.equal(record.current, null);
  assert.equal(record.history.at(-1).result, "done");
  assert.ok(record.history.at(-1).audit.some((entry) => entry.operation === "goal-append"));
  assert.ok(record.history.at(-1).audit.some((entry) => entry.operation === "goal-verify"));
});
