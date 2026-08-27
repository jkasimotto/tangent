// A worker starts in the folder its Area binds, or not at all. This test
// drives the real server: an Area that binds nothing is refused with the
// line to add and no record, a bound Area records the folder on the attempt
// and in the prompt, a step's own --path wins, a vault-folder binding never
// inherits, and the brain sees the resources with the Area they come from.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readAllArmedPrompts } from "./armed-prompts.mjs";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { pipelinePath, readPipeline } from "./pipeline-record.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const launch = { harness: "test-shell" };
const harnessRegistry = "# Harnesses\n\n```tangent.harnesses.v1\n{\"version\":1,\"modelSets\":{},\"harnesses\":[{\"id\":\"test-shell\",\"label\":\"Test shell\",\"command\":\"sleep 300\"}]}\n```\n";

/** Sends one JSON request and parses its JSON response. */
async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

/** Writes one Area note and one open Goal in it. */
async function writeAreaWithGoal(trees, area, resourceLines, slug) {
  const directory = path.join(trees, area);
  await mkdir(directory, { recursive: true });
  const leaf = area.split("/").pop();
  const resources = resourceLines.length ? `## Resources\n\n${resourceLines.join("\n")}\n\n` : "";
  await writeFile(path.join(directory, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n\n${resources}## Goals\n\n1. [[goal-${slug}]]\n\n\`\`\`tangent.environment.v1\n{"defaults":{"launch":{"harness":"test-shell"},"brain":{"harness":"test-shell"}}}\n\`\`\`\n`, "utf8");
  await writeFile(path.join(directory, `goal-${slug}.md`), `---\ntype: goal\nstatus: open\ndone_when: ${slug} is proven.\nsession:\n---\n\n# ${slug}\n\n## State\n\nNot started.\n`, "utf8");
}

/** Polls until the armed prompt for the session is on disk. */
async function armedPrompt(armed, session) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = (await readAllArmedPrompts(armed)).find((item) => item.session === session);
    if (record) return record.prompt;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no armed prompt for ${session}`);
}

/** Reads one tmux user option of a session. */
async function tmuxOption(session, name) {
  const { stdout } = await execFileAsync("tmux", ["show-option", "-t", `=${session}:`, "-v", name]);
  return stdout.trim();
}

test("a worker starts in the Area's bound folder or is refused before any record", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-work-folder-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const stepFolder = path.join(root, "step-folder");
  const pipelines = path.join(root, "pipelines");
  const armed = path.join(root, "armed");
  await mkdir(workspace, { recursive: true });
  await mkdir(stepFolder, { recursive: true });
  await mkdir(trees, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), harnessRegistry, "utf8");
  await mkdir(path.join(trees, "otto"), { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeAreaWithGoal(trees, "otto/bound", [`- Repository: ${workspace}`, "- Branch: main"], "bound-work");
  await writeAreaWithGoal(trees, "otto/bound/child", [], "child-work");
  await writeFile(path.join(trees, "otto", "skill-review.md"), "---\nname: review\ndescription: Review a change.\n---\n\nSteps.\n", "utf8");
  await writeFile(path.join(trees, "otto", "bound", "child", "skill-release.md"), "# Ship a release\n\nSteps.\n", "utf8");
  await mkdir(path.join(workspace, ".claude", "skills", "deploy"), { recursive: true });
  await writeFile(path.join(workspace, ".claude", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Deploy the app.\n---\nSteps.\n", "utf8");
  await writeAreaWithGoal(trees, "otto/unbound", [], "unbound-work");
  await writeAreaWithGoal(trees, "otto/docs", [`- Repository: ${path.join(trees, "otto", "docs")}`], "docs-work");
  await writeAreaWithGoal(trees, "otto/docs/kid", [], "kid-work");
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "commit", "-q", "-m", "add: folder fixture"]);
  const openedSessions = [];
  const base = await startShellServer(context, {
    here, root, trees, workspace, openedSessions,
    env: { TANGENT_ARMED_ROOT: armed, TANGENT_RECONCILE_INTERVAL_MS: "600000" },
  });
  if (!base) return;

  await context.test("an Area that binds nothing is refused with the line to add and writes no record", async () => {
    const refused = await post(base, "/api/goals/start", { file: "otto/unbound/goal-unbound-work.md", steps: [{ instruction: "Do it.", launch }] });
    assert.equal(refused.status, 409);
    assert.equal(
      refused.body.error,
      `goal unbound-work: otto/unbound and its parent Areas bind no repository. Add "- Repository: <path>" under ## Resources in ${path.join(trees, "otto", "unbound", "unbound.md")}, or pass --path.`,
    );
    assert.equal(existsSync(pipelinePath(pipelines, "otto/unbound", "unbound-work")), false, "no queue record is written");
    const { stdout } = await execFileAsync("tmux", ["list-sessions", "-F", "#{session_name}"]).catch(() => ({ stdout: "" }));
    assert.equal(stdout.includes("unbound"), false, "no session is created");
  });

  await context.test("a child inherits its parent's folder and the attempt, session, and prompt record it", async () => {
    const started = await post(base, "/api/goals/start", { file: "otto/bound/child/goal-child-work.md", steps: [{ instruction: "Prove the folder.", launch }] });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    openedSessions.push(started.body.session);
    assert.equal(started.body.launches[0].cwd, workspace);
    assert.equal(started.body.launches[0].cwdSource, "area:otto/bound");
    const queue = await readPipeline(pipelines, "otto/bound/child", "child-work");
    const attempt = queue.steps[0].attempts.at(-1);
    assert.equal(attempt.cwd, workspace);
    assert.equal(attempt.cwdSource, "area:otto/bound");
    assert.equal(queue.steps[0].launchDisclosure.cwd, workspace);
    assert.equal(await tmuxOption(started.body.session, "@tangent_cwd"), workspace);
    const prompt = await armedPrompt(armed, started.body.session);
    assert.match(prompt, new RegExp(`## Working directory\\n\\n${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(from area:otto/bound\\)\\nBranch: main`));
  });

  await context.test("a step's own path wins and is recorded as the source", async () => {
    const started = await post(base, "/api/goals/start", { file: "otto/bound/goal-bound-work.md", steps: [{ instruction: "Use my folder.", launch, path: stepFolder }] });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    openedSessions.push(started.body.session);
    const queue = await readPipeline(pipelines, "otto/bound", "bound-work");
    assert.equal(queue.steps[0].attempts.at(-1).cwd, stepFolder);
    assert.equal(queue.steps[0].attempts.at(-1).cwdSource, "step");
    assert.equal(await tmuxOption(started.body.session, "@tangent_cwd"), stepFolder);
  });

  await context.test("a vault folder binds the Area that declares it and does not inherit", async () => {
    const own = await post(base, "/api/goals/start", { file: "otto/docs/goal-docs-work.md", steps: [{ instruction: "Write docs.", launch }] });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    openedSessions.push(own.body.session);
    assert.equal(own.body.launches[0].cwd, path.join(trees, "otto", "docs"));
    const kid = await post(base, "/api/goals/start", { file: "otto/docs/kid/goal-kid-work.md", steps: [{ instruction: "Inherit nothing.", launch }] });
    assert.equal(kid.status, 409);
    assert.match(kid.body.error, /^goal kid-work: otto\/docs\/kid and its parent Areas bind no repository\./);
  });

  await context.test("area show names each resource with the Area it comes from, and the brain sits in its vault folder", async () => {
    const shown = await fetch(`${base}/api/areas/show?area=${encodeURIComponent("otto/bound/child")}`).then((response) => response.json());
    assert.deepEqual(shown.resolved.repository, { value: workspace, area: "otto/bound" });
    assert.deepEqual(shown.resolved.branch, { value: "main", area: "otto/bound" });
    assert.equal(shown.workFolder.cwd, workspace);
    assert.deepEqual(shown.skills.map((skill) => [skill.name, skill.description, skill.path]), [
      ["review", "Review a change.", path.join(trees, "otto", "skill-review.md")],
      ["release", "Ship a release", path.join(trees, "otto", "bound", "child", "skill-release.md")],
    ], "route skills list root first with frontmatter defaults");
    assert.deepEqual(shown.projectSkills.map((skill) => [skill.name, skill.description, skill.path]), [["deploy", "Deploy the app.", path.join(workspace, ".claude", "skills", "deploy", "SKILL.md")]]);
    const unboundShown = await fetch(`${base}/api/areas/show?area=${encodeURIComponent("otto/unbound")}`).then((response) => response.json());
    assert.deepEqual(unboundShown.projectSkills, [], "no bound repository lists no project skills");
    const vault = await fetch(`${base}/api/vault`).then((response) => response.json());
    const skillDocument = vault.documents.find((item) => item.file === "otto/bound/child/skill-release.md");
    assert.deepEqual(skillDocument?.skill, { name: "release", description: "Ship a release" }, "the vault index carries the skill's name and description for the Area page");
    const brain = await post(base, "/api/brains/start", { area: "otto/bound/child", instruction: "Organize the child." });
    assert.equal(brain.status, 200, JSON.stringify(brain.body));
    openedSessions.push(brain.body.session);
    const show = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(brain.body.session)}`).then((response) => response.json());
    assert.match(show.prompt, /^Organize the child\./, "no generated prompt: Julian's words come first, and the brain reads its Area note chain itself");
    assert.equal(await tmuxOption(brain.body.session, "@tangent_cwd"), path.join(trees, "otto", "bound", "child"), "the brain sits in its vault Area folder");
    const unboundBrain = await post(base, "/api/brains/start", { area: "otto/unbound", instruction: "Organize nothing." });
    assert.equal(unboundBrain.status, 200, JSON.stringify(unboundBrain.body));
    openedSessions.push(unboundBrain.body.session);
  });
});
