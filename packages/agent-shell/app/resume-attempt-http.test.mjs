// Resume (ADR-0042) against the real server: a harness with a session id
// flag gets a fresh conversation id at launch, recorded on the attempt before
// the session exists; a live attempt is attached; a dead attempt opens a new
// owned session of kind `resume` in the attempt's folder with the command
// typed and never submitted, and that session never binds to the Goal.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { readPipeline } from "./pipeline-record.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const harnessRegistry = `# Harnesses

\`\`\`tangent.harnesses.v2
{
  "version": 2,
  "modelSets": {},
  "harnesses": [
    { "id": "test-shell", "label": "Test shell", "command": "sleep 300", "resume": "{command} --resume {id}", "sessionIdArg": "--session-id {id}" },
    { "id": "test-noid", "label": "No id", "command": "sleep 300", "resume": "sleep resume {id}" },
    { "id": "test-plain", "label": "Plain", "command": "sleep 300" }
  ]
}
\`\`\`
`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Sends one JSON request and parses its JSON response. */
async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

/** Reads one tmux user option of a session. */
async function tmuxOption(session, name) {
  const { stdout } = await execFileAsync("tmux", ["show-option", "-t", `=${session}:`, "-v", name]).catch(() => ({ stdout: "" }));
  return stdout.trim();
}

/** Polls the pane until it shows the text or the wait runs out. */
async function paneShows(session, text) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { stdout } = await execFileAsync("tmux", ["capture-pane", "-p", "-t", `=${session}:`]).catch(() => ({ stdout: "" }));
    if (stdout.replace(/\s+/g, " ").includes(text)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** Writes one open Goal file in the Area. */
async function writeGoal(directory, slug) {
  await writeFile(path.join(directory, `goal-${slug}.md`), `---\ntype: goal\nstatus: open\ndone_when: ${slug} is proven.\nsession:\n---\n\n# ${slug}\n\n## State\n\nNot started.\n`, "utf8");
}

test("an attempt records its conversation at launch and resumes into a session that never binds the Goal", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-resume-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const pipelines = path.join(root, "pipelines");
  const area = path.join(trees, "otto", "resume");
  await mkdir(workspace, { recursive: true });
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), harnessRegistry, "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, "resume.md"), `---\ntype: area\n---\n\n# Resume\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  for (const slug of ["with-id", "no-id", "plain"]) await writeGoal(area, slug);
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "commit", "-q", "-m", "add: resume fixture"]);
  const openedSessions = [];
  const base = await startShellServer(context, { here, root, trees, workspace, openedSessions, env: { TANGENT_RECONCILE_INTERVAL_MS: "600000" } });
  if (!base) return;

  const goalFile = "otto/resume/goal-with-id.md";
  const started = await post(base, "/api/goals/start", { file: goalFile, steps: [{ instruction: "Prove resume.", launch: { harness: "test-shell" } }] });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const workerSession = started.body.session;
  openedSessions.push(workerSession);
  let queue = await readPipeline(pipelines, "otto/resume", "with-id");
  const attempt = queue.steps[0].attempts.at(-1);

  await context.test("the conversation id is on the attempt and on the launch line", async () => {
    assert.equal(attempt.providerSession.provider, "test-shell");
    assert.match(attempt.providerSession.id, UUID);
    assert.equal(attempt.resolvedLaunch.command, "sleep 300", "the recorded launch line stays the registry's string");
    assert.equal(await tmuxOption(workerSession, "@tangent_launch_command"), `sleep 300 --session-id ${attempt.providerSession.id}`);
  });

  await context.test("a harness without a session id flag gets no id", async () => {
    const noId = await post(base, "/api/goals/start", { file: "otto/resume/goal-no-id.md", steps: [{ instruction: "No id.", launch: { harness: "test-noid" } }] });
    assert.equal(noId.status, 200, JSON.stringify(noId.body));
    openedSessions.push(noId.body.session);
    const record = await readPipeline(pipelines, "otto/resume", "no-id");
    assert.equal(record.steps[0].attempts.at(-1).providerSession, null);
    assert.equal(await tmuxOption(noId.body.session, "@tangent_launch_command"), "sleep 300");
  });

  await context.test("goal detail carries the resume command per attempt", async () => {
    const detail = await (await fetch(`${base}/api/goals/detail?goal=${encodeURIComponent(goalFile)}`)).json();
    const [first] = detail.attempts;
    assert.equal(first.resume.live, true);
    assert.equal(first.resume.command, `sleep 300 --resume ${attempt.providerSession.id}`);
    assert.equal(first.resume.cwd, workspace);
  });

  await context.test("a live attempt is attached", async () => {
    const resumed = await post(base, "/api/goals/attempts/resume", { goal: goalFile, attemptId: attempt.id });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.status, "live");
    assert.equal(resumed.body.session, workerSession);
  });

  await context.test("a dead attempt on a finished Goal opens a resume session that binds nothing", async () => {
    await fetch(`${base}/api/kill/${encodeURIComponent(workerSession)}`, { method: "POST" });
    const done = await post(base, "/api/goals/edit", { file: goalFile, status: "done" });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const resumed = await post(base, "/api/goals/attempts/resume", { goal: goalFile, attemptId: attempt.id });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.status, "resumed");
    const resumeSession = resumed.body.session;
    openedSessions.push(resumeSession);
    assert.equal(resumeSession, `${workerSession}-resume`);
    assert.equal(resumed.body.command, `sleep 300 --resume ${attempt.providerSession.id}`);
    assert.equal(await tmuxOption(resumeSession, "@tangent_kind"), "resume");
    assert.equal(await tmuxOption(resumeSession, "@tangent_goal"), "", "the resume session carries no Goal");
    assert.equal(await tmuxOption(resumeSession, "@tangent_cwd"), workspace);
    assert.equal(await paneShows(resumeSession, `sleep 300 --resume ${attempt.providerSession.id}`), true, "the command is typed");
    const goalText = await readFile(path.join(trees, goalFile), "utf8");
    assert.match(goalText, /^status: done$/m, "the Goal stays finished");
    assert.doesNotMatch(goalText, new RegExp(`^session: ${resumeSession}$`, "m"), "the Goal is not bound to the resume session");
    queue = await readPipeline(pipelines, "otto/resume", "with-id");
    assert.equal(queue.steps[0].attempts.length, 1, "no new attempt is recorded");
    const again = await post(base, "/api/goals/attempts/resume", { goal: goalFile, attemptId: attempt.id });
    assert.equal(again.body.session, resumeSession, "a second resume reuses the live resume session");
  });

  await context.test("a harness without resume has no Resume verb", async () => {
    const plain = await post(base, "/api/goals/start", { file: "otto/resume/goal-plain.md", steps: [{ instruction: "Plain.", launch: { harness: "test-plain" } }] });
    assert.equal(plain.status, 200, JSON.stringify(plain.body));
    openedSessions.push(plain.body.session);
    await fetch(`${base}/api/kill/${encodeURIComponent(plain.body.session)}`, { method: "POST" });
    const refused = await post(base, "/api/goals/attempts/resume", { goal: "otto/resume/goal-plain.md" });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /has no resume command/);
  });
});
