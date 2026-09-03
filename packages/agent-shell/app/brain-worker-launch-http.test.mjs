// A brain launched on one harness dispatches workers on that same harness.
// The Area's declared work launch here is plain `claude` on purpose: it must
// not reach a worker that the brain started, because the brain's own launch
// is the authority. Both harnesses exist in the fixture registry, so a pass
// can never come from an unavailable plain `claude`.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));

const REGISTRY = `# Harnesses

\`\`\`tangent.harnesses.v1
{
  "version": 1,
  "modelSets": {
    "claude": [
      { "id": "fable-5", "label": "Fable 5", "args": "--model claude-fable-5" },
      { "id": "opus-5", "label": "Opus 5", "args": "--model claude-opus-5" }
    ]
  },
  "harnesses": [
    { "id": "claude", "label": "Claude", "command": "fake-claude", "modelSet": "claude" },
    { "id": "claude-otto", "label": "Claude · Otto", "command": "FAKE_CONFIG_DIR=~/.claude-otto fake-claude", "modelSet": "claude" }
  ]
}
\`\`\`
`;

/** Reserves and releases one local port for the HTTP test. */
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

/** Polls until the child server accepts HTTP requests. */
async function waitForServer(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Agent Shell did not start at ${url}`);
}

/** Writes one Goal file into the fixture vault. */
async function writeGoal(directory, slug, title, doneWhen) {
  await writeFile(
    path.join(directory, `goal-${slug}.md`),
    `---\ntype: goal\nstatus: open\ndone_when: ${doneWhen}\nsession:\n---\n\n# ${title}\n\n## State\n\nNot started.\n`,
    "utf8"
  );
}

test("a brain lends its own harness to every worker it starts", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-worker-launch-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const proof = path.join(trees, "otto", "proof");
  const plain = path.join(trees, "otto", "plainbrain");
  const override = path.join(trees, "otto", "overridebrain");
  await mkdir(proof, { recursive: true });
  await mkdir(plain, { recursive: true });
  await mkdir(override, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), REGISTRY, "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(
    path.join(proof, "proof.md"),
    `---\ntype: area\n---\n\n# Proof\n\n## Development environment\n\n\`\`\`tangent.environment.v1\n{"defaults": {"launch": {"harness": "claude", "model": "opus-5"}, "brain": {"harness": "claude-otto", "model": "fable-5"}}}\n\`\`\`\n\n## Resources\n\n- Repository: ${workspace}\n`,
    "utf8"
  );
  await writeFile(
    path.join(plain, "plainbrain.md"),
    `---\ntype: area\n---\n\n# Plain brain\n\n## Resources\n\n- Repository: ${workspace}\n`,
    "utf8"
  );
  await writeFile(
    path.join(override, "overridebrain.md"),
    `---\ntype: area\n---\n\n# Override brain\n\n## Development environment\n\n\`\`\`tangent.environment.v1\n{"defaults": {"launch": {"harness": "claude", "model": "opus-5"}, "brain": {"harness": "claude-otto", "model": "fable-5"}}}\n\`\`\`\n\n## Resources\n\n- Repository: ${workspace}\n`,
    "utf8"
  );
  await writeGoal(proof, "default-worker", "Default worker", "The worker runs the brain's harness");
  await writeGoal(proof, "julian-start", "Julian start", "A hand-started Goal names its own harness");
  await writeGoal(plain, "no-identity", "No identity", "A brain without a harness id refuses");

  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") {
      context.skip("This environment does not permit local HTTP listeners.");
      return;
    }
    throw error;
  }
  const openedSessions = [];
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"),
      WORKSPACE: workspace,
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_ARMED_ROOT: path.join(root, "armed"),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      AGENT_SHELL_NO_OPEN: "1",
      // This suite proves an explicit resume choice. Keep background recovery
      // from winning the intentional kill-to-resume window under load.
      TANGENT_RECONCILE_INTERVAL_MS: "600000",
      GROQ_API_KEY: "",
      CHAT_SESSION: `worker-launch-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    await Promise.all(openedSessions.filter(Boolean).map((session) => new Promise((resolve) => {
      execFile("tmux", ["kill-session", "-t", `=${session}`], () => resolve());
    })));
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  /** Posts one JSON body and returns the status with the parsed value. */
  const post = async (route, body) => {
    const response = await fetch(`${base}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  // The Area declares plain `claude` for work. The brain runs Claude Otto.
  const declared = await fetch(`${base}/api/launch/options?area=otto/proof`).then((response) => response.json());
  assert.equal(declared.default.command, "fake-claude --model claude-opus-5", "the Area work declaration is plain claude");
  const brain = await post("/api/brains/start", {
    area: "otto/proof",
    instruction: "Control the worker launch proof.",
  });
  assert.equal(brain.status, 200, JSON.stringify(brain.body));
  openedSessions.push(brain.body.session);
  assert.deepEqual(brain.body.brain.resolvedLaunch.ref, { harness: "claude-otto", model: "fable-5", effort: null, provider: "anthropic" });

  const brainOwnedCreate = await post("/api/goals/create", {
    area: "otto/proof",
    caller: brain.body.session,
    own: brain.body.session,
    goal: { title: "Brain owned", doneWhen: "This Goal must not exist." },
  });
  assert.equal(brainOwnedCreate.status, 403, JSON.stringify(brainOwnedCreate.body));
  await assert.rejects(
    readFile(path.join(proof, "goal-brain-owned.md"), "utf8"),
    { code: "ENOENT" },
    "create --own refuses the brain before it writes a Goal"
  );

  const brainOwn = await post("/api/goals/own", {
    session: brain.body.session,
    slugs: ["julian-start"],
  });
  assert.equal(brainOwn.status, 403, JSON.stringify(brainOwn.body));

  // Two assignments, neither naming a harness. Both take the brain's.
  const started = await post("/api/goals/start", {
    file: "otto/proof/goal-default-worker.md",
    caller: brain.body.session,
    steps: [{ instruction: "Do the work." }, { instruction: "Review the work.", kind: "review" }],
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  openedSessions.push(started.body.session);
  assert.deepEqual(started.body.launches, [
    { index: 1, launch: "claude-otto/fable-5", source: "brain-default", label: "Claude · Otto · Fable 5", command: "FAKE_CONFIG_DIR=~/.claude-otto fake-claude --model claude-fable-5", cwd: workspace, cwdSource: "area:otto/proof" },
    { index: 2, launch: "claude-otto/fable-5", source: "brain-default", label: "Claude · Otto · Fable 5", command: "FAKE_CONFIG_DIR=~/.claude-otto fake-claude --model claude-fable-5", cwd: workspace, cwdSource: "area:otto/proof" },
  ], "the start response says what each assignment runs, where its harness came from, and the folder it runs in");
  assert.deepEqual(started.body.warnings, []);
  const [first, second] = started.body.pipeline.steps;
  assert.deepEqual(first.launch, { harness: "claude-otto", model: "fable-5", effort: null });
  assert.equal(first.launchSource, "brain-default");
  assert.deepEqual(second.launch, { harness: "claude-otto", model: "fable-5", effort: null });
  assert.equal(second.launchSource, "brain-default", "a pending assignment carries the same applied default");
  assert.equal(first.command, "FAKE_CONFIG_DIR=~/.claude-otto fake-claude --model claude-fable-5");
  assert.doesNotMatch(first.command, /^fake-claude/, "plain claude is never substituted for the brain's harness");

  // The selected harness is disclosed into the durable record before the
  // worker exists: the entry was written while the assignment was still
  // pending and had no session.
  assert.equal(first.launchDisclosure.launch, "claude-otto/fable-5");
  assert.equal(first.launchDisclosure.source, "brain-default");
  assert.equal(first.launchDisclosure.command, "FAKE_CONFIG_DIR=~/.claude-otto fake-claude --model claude-fable-5");
  assert.equal(first.launchDisclosure.assignmentStatus, "pending");
  assert.equal(first.launchDisclosure.session, null);
  assert.ok(
    Date.parse(first.launchDisclosure.disclosedAt) <= Date.parse(first.startedAt),
    "the disclosure precedes the assignment start"
  );
  const stored = JSON.parse(await readFile(path.join(root, "pipelines", "otto", "proof", "default-worker.json"), "utf8"));
  assert.equal(stored.assignments[0].launchDisclosure.launch, "claude-otto/fable-5", "the disclosure is durable, not only a response line");

  // The worker's own session carries the same harness.
  const ref = await new Promise((resolve) => {
    execFile("tmux", ["show-options", "-t", started.body.session, "-v", "@tangent_launch_ref"], (_error, stdout) => resolve((stdout ?? "").trim()));
  });
  assert.equal(ref, "claude-otto/fable-5", "the tmux session runs the brain's harness");
  const command = await new Promise((resolve) => {
    execFile("tmux", ["show-options", "-t", started.body.session, "-v", "@tangent_launch_command"], (_error, stdout) => resolve((stdout ?? "").trim()));
  });
  assert.match(command, /^FAKE_CONFIG_DIR=~\/\.claude-otto fake-claude/);

  // Append follows the same rule, and an explicit choice still wins and warns.
  const appended = await post("/api/pipelines/append", {
    goal: "otto/proof/goal-default-worker.md",
    caller: brain.body.session,
    steps: [{ instruction: "Prove it." }],
  });
  assert.equal(appended.status, 200, JSON.stringify(appended.body));
  assert.deepEqual(appended.body.launches.map((row) => [row.index, row.launch, row.source]), [[3, "claude-otto/fable-5", "brain-default"]]);
  assert.deepEqual(appended.body.warnings, []);
  const explicit = await post("/api/pipelines/append", {
    goal: "otto/proof/goal-default-worker.md",
    caller: brain.body.session,
    steps: [{ instruction: "Try plain claude.", launch: { harness: "claude", model: "opus-5" } }],
  });
  assert.equal(explicit.status, 200, JSON.stringify(explicit.body));
  assert.deepEqual(explicit.body.launches.map((row) => [row.index, row.launch, row.source]), [[4, "claude/opus-5", "explicit"]]);
  assert.deepEqual(explicit.body.warnings, ["step 4: --launch claude/opus-5 differs from the default harness claude-otto."]);
  assert.equal(explicit.body.pipeline.steps[3].launchSource, "explicit", "an explicit choice is never recorded as a lent default");

  // Nothing that took a default runs plain claude.
  const lent = explicit.body.pipeline.steps.filter((step) => step.launchSource === "brain-default");
  assert.equal(lent.length, 3);
  for (const step of lent) assert.equal(step.launch.harness, "claude-otto");

  // A registry choice applies to one brain attempt and never rewrites the
  // Area default. A second start reattaches to the existing attempt instead
  // of changing its launch, even when that request carries another choice.
  const overriddenBrain = await post("/api/brains/start", {
    area: "otto/overridebrain",
    instruction: "Prove one-attempt Brain launch choices.",
    choice: { harness: "claude", model: "opus-5" },
    expectedLaunch: "claude/opus-5",
  });
  assert.equal(overriddenBrain.status, 200, JSON.stringify(overriddenBrain.body));
  openedSessions.push(overriddenBrain.body.session);
  assert.deepEqual(overriddenBrain.body.brain.resolvedLaunch, {
    ref: { harness: "claude", model: "opus-5", effort: null },
    label: "Claude · Opus 5",
    command: "fake-claude --model claude-opus-5",
    sourceArea: null,
    mode: "override",
  });
  const reattachedBrain = await post("/api/brains/start", {
    area: "otto/overridebrain",
    instruction: "This must not replace the live attempt.",
    choice: { harness: "claude-otto", model: "fable-5" },
    expectedLaunch: "claude-otto/fable-5",
  });
  assert.equal(reattachedBrain.status, 200, JSON.stringify(reattachedBrain.body));
  assert.equal(reattachedBrain.body.reattached, true);
  assert.equal(reattachedBrain.body.session, overriddenBrain.body.session);
  assert.deepEqual(reattachedBrain.body.brain.resolvedLaunch.ref, { harness: "claude", model: "opus-5", effort: null, provider: "anthropic" });

  // An explicit resume can make its own one-attempt choice. Earlier
  // generations retain their complete launch snapshots.
  await new Promise((resolve) => execFile("tmux", ["kill-session", "-t", `=${overriddenBrain.body.session}`], () => resolve()));
  const resumedBrain = await post("/api/brains/start", {
    area: "otto/overridebrain",
    resume: true,
    choice: { harness: "claude", model: "fable-5" },
    expectedLaunch: "claude/fable-5",
  });
  assert.equal(resumedBrain.status, 200, JSON.stringify(resumedBrain.body));
  openedSessions.push(resumedBrain.body.session);
  assert.equal(resumedBrain.body.generation, 2);
  assert.deepEqual(resumedBrain.body.brain.resolvedLaunch.ref, { harness: "claude", model: "fable-5", effort: null, provider: "anthropic" });
  const storedBrain = JSON.parse(await readFile(path.join(root, "brains", "otto", "overridebrain", "brain.json"), "utf8"));
  assert.deepEqual(storedBrain.generations.map((entry) => [entry.resolvedLaunch.mode, entry.resolvedLaunch.ref]), [
    ["override", { harness: "claude", model: "opus-5", effort: null }],
    ["override", { harness: "claude", model: "fable-5", effort: null }],
  ]);
  const unchangedDefaults = await fetch(`${base}/api/launch/options?area=otto/overridebrain&kind=all`).then((response) => response.json());
  assert.deepEqual(
    { harness: unchangedDefaults.brainDefault.harness, model: unchangedDefaults.brainDefault.model },
    { harness: "claude-otto", model: "fable-5" },
    "attempt choices do not mutate the Area Brain default",
  );

  // A caller who is not the exact live brain cannot start a worker (D8).
  const julian = await post("/api/goals/start", {
    file: "otto/proof/goal-julian-start.md",
    steps: [{ instruction: "Start this by hand.", launch: { harness: "claude" } }],
  });
  assert.equal(julian.status, 403);
  assert.equal(julian.body.error, 'only the brain starts workers. Message it in Work (a on the Area) or run: tangent send otto/proof "<what you want>"');

  // An edited command cannot become a second Brain launch authority.
  const commandBrain = await post("/api/brains/start", {
    area: "otto/plainbrain",
    instruction: "Control the no-identity proof.",
    command: "sleep 300",
  });
  assert.equal(commandBrain.status, 400);
  assert.equal(commandBrain.body.code, "override-retired");
  assert.equal(
    (await fetch(`${base}/api/sessions`).then((response) => response.json())).pipelines.some((item) => item.goal === "otto/plainbrain/goal-no-identity.md"),
    false,
    "a refused start leaves no record"
  );
});
