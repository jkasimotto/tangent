import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

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

/** Finds a Node.js executable that can run the child server. */
function nodeExecutable() {
  const candidates = [
    ...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")),
    process.execPath,
  ];
  const executable = candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate))
    ?? candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) throw new Error("A Node.js executable was not found for the server test.");
  return executable;
}

test("the context-first shell is default and keeps the user's understanding with the goal", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-focus-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const areaDirectory = path.join(trees, "otto", "test");
  await mkdir(areaDirectory, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(areaDirectory, "test.md"), `---\ntype: area\n---\n\n# Test\n\n## Goals\n\n1. [[goal-prove-it]]\n2. [[outcome-connect-chosen-ramp-faces]]\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  await writeFile(path.join(areaDirectory, ".processes.json"), '{"scripts":{"dev":"npm run dev"}}\n', "utf8");
  await writeFile(path.join(areaDirectory, "design-test.md"), "---\ntype: document\n---\n\n# Test design\n\nA useful result is visible.\n", "utf8");
  await writeFile(
    path.join(areaDirectory, "use-cases.md"),
    "---\ntype: document\n---\n\n# Use cases\n\nThe reader can inspect the use cases.\n",
    "utf8"
  );
  await writeFile(
    path.join(areaDirectory, "goal-prove-it.md"),
    "---\ntype: goal\nstatus: open\ndone_when: The result is visible\nwaiting_on: Julian\nsession:\n---\n\n# Prove it\n\n## State\n\nNot started.\n\n## Documents\n\n1. [[use-cases]]\n2. [[design-test]]\n",
    "utf8"
  );
  await writeFile(
    path.join(areaDirectory, "outcome-connect-chosen-ramp-faces.md"),
    "---\ntype: outcome\nstatus: open\noutcome: The chosen ramp faces connect at the dragged width.\nsession:\n---\n\n# Connect the chosen ramp faces\n\n## State\n\nReady to start.\n",
    "utf8"
  );

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
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"),
      WORKSPACE: workspace,
      AGENT_SHELL_NO_OPEN: "1",
      GROQ_API_KEY: "",
      CHAT_SESSION: `focus-shell-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    await Promise.all(openedSessions.map((session) => new Promise((resolve) => {
      execFile("tmux", ["kill-session", "-t", `=${session}`], () => resolve());
    })));
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const home = await fetch(base).then((response) => response.text());
  assert.match(home, /Agent Shell/i);
  assert.match(home, /\/shell\.js/);
  assert.doesNotMatch(home, />Legacy</);

  const shellScript = await fetch(`${base}/shell.js`).then((response) => response.text());
  const serverSource = await readFile(path.join(here, "server.mjs"), "utf8");
  assert.match(shellScript, /data-command-enter-submit/);
  assert.match(shellScript, /event\.key === "Enter" && event\.metaKey/);
  assert.match(shellScript, /data-new-goal/);
  assert.match(shellScript, /data-next-step/);
  assert.match(shellScript, /data-toggle-awake/);
  assert.match(shellScript, /data-open-vision/);
  assert.match(shellScript, /data-describe-work/);
  assert.doesNotMatch(shellScript, /data-share-context/);
  assert.match(shellScript, /\/api\/work\/describe/);
  assert.doesNotMatch(shellScript, /\/api\/goals\/shape|shape-review/);
  assert.match(shellScript, /\/api\/goals\/agent/);
  assert.match(shellScript, /Document reader/);
  assert.match(shellScript, /data-document-history/);
  assert.match(shellScript, /document-picker/);
  assert.match(shellScript, /data-open-vault-link/);
  assert.doesNotMatch(shellScript, /Discuss with agent|Describe related work|Talk it through first|See what the agent will do|Review execution plan|Read what will happen/);
  assert.match(shellScript, /Current brief/);
  assert.match(shellScript, /Story so far/);
  assert.match(shellScript, /post\("\/api\/caffeinate"/);
  assert.doesNotMatch(shellScript, /EventSource|location\.reload|api\/reload/);
  assert.doesNotMatch(serverSource, /createReloadController|api\/reload|source changed; restarting|watch\(here/);
  assert.match(serverSource, /goal-command\.mjs/);
  assert.match(serverSource, /Never hand-write Goal frontmatter or Area links/);

  const reloadEndpoint = await fetch(`${base}/api/reload`, { method: "POST" });
  assert.equal(reloadEndpoint.status, 404);

  const sessionPayload = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(sessionPayload.caffeinate, false);

  const programs = await fetch(`${base}/api/programs`).then((response) => response.json());
  assert.equal(programs.programs.find((program) => program.name === "dev").type, "process");

  const reviewedProgram = await fetch(`${base}/api/reviewed-build/program?area=otto%2Ftest`).then((response) => response.json());
  assert.equal(reviewedProgram.id, "reviewed-build");
  assert.equal(reviewedProgram.steps.length, 8);
  assert.equal(reviewedProgram.sessions["design"].mode, "fresh");
  const reviewedRuns = await fetch(`${base}/api/reviewed-build/runs`).then((response) => response.json());
  assert.deepEqual(reviewedRuns.runs, []);

  const command = await fetch(`${base}/api/programs/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "command", area: "otto/test", name: "Release", command: "npm run release", cwd: workspace }),
  }).then((response) => response.json());
  assert.equal(command.id, "command:otto/test:release");

  const routine = await fetch(`${base}/api/programs/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "routine", area: "otto/test", name: "Daily check", time: "07:30", cwd: workspace, model: "sonnet", prompt: "Check the area and leave proof." }),
  }).then((response) => response.json());
  assert.equal(routine.id, "routine:otto/test:recur-daily-check.md");

  const paused = await fetch(`${base}/api/programs/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: routine.id, action: "pause" }),
  });
  assert.equal(paused.status, 200);
  assert.match(await readFile(path.join(areaDirectory, "recur-daily-check.md"), "utf8"), /^paused: true$/m);

  const createdArea = await fetch(`${base}/api/areas/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parent: "otto/test", name: "Hackathon" }),
  }).then((response) => response.json());
  assert.equal(createdArea.area, "otto/test/hackathon");
  assert.match(await readFile(path.join(trees, createdArea.note), "utf8"), /^type: area$/m);
  await fetch(`${base}/api/areas/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parent: createdArea.area, name: "Live edit" }),
  });
  const movePreview = await fetch(`${base}/api/areas/preview-move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: createdArea.area, parent: "otto/test", name: "Demo event" }),
  }).then((response) => response.json());
  assert.equal(movePreview.changedPaths.length, 2);

  const vision = await fetch(`${base}/vision`).then((response) => response.text());
  assert.match(vision, /Agent Shell — product vision/i);
  assert.match(vision, /Human limit/);
  assert.match(vision, /Model limit/);

  const visionScript = await fetch(`${base}/vision.js`).then((response) => response.text());
  assert.match(visionScript, /Keep the native agent chat whole/);
  assert.match(visionScript, /Native agent surface/);
  assert.match(visionScript, /Define work through a native conversation/);
  assert.match(visionScript, /data-describe-form/);
  assert.match(visionScript, /Give durable Areas one clear home/);
  assert.match(visionScript, /Keep operational programs near their areas/);
  assert.match(visionScript, /Daily remediation run/);
  assert.match(visionScript, /Path preview/);
  assert.match(visionScript, /Keep Mac awake/);
  assert.match(visionScript, /Design Document: Live Edit Collaboration/);
  assert.match(visionScript, /Read one Document at a time/);
  assert.doesNotMatch(visionScript, /Two-minute context|What changed|Review execution plan|Read what will happen/);

  const brief = await fetch(`${base}/api/goals/brief?file=otto%2Ftest%2Fgoal-prove-it.md`).then((response) => response.json());
  assert.equal(brief.goal.title, "Prove it");
  assert.match(brief.markdown, /^# Assignment: Prove it/m);
  assert.match(brief.markdown, /## Done when\n\nThe result is visible/);
  assert.deepEqual(brief.context.notes.map((file) => path.basename(file)), ["test.md", "otto.md"]);
  assert.deepEqual(brief.context.documents.map((file) => path.basename(file)).sort(), ["design-test.md", "use-cases.md"]);

  const initialVault = await fetch(`${base}/api/vault`).then((response) => response.json());
  const initialGoal = initialVault.map.flatMap((group) => group.goals).find((item) => item.file === "otto/test/goal-prove-it.md");
  assert.deepEqual(initialGoal.documents.map((item) => [path.basename(item.file), item.kind]), [
    ["use-cases.md", "document"],
    ["design-test.md", "document"],
  ]);
  const legacyGoal = initialVault.map.flatMap((group) => group.goals)
    .find((item) => item.file === "otto/test/outcome-connect-chosen-ramp-faces.md");
  assert.equal(legacyGoal.title, "Connect the chosen ramp faces");
  assert.equal(legacyGoal.doneWhen, "The chosen ramp faces connect at the dragged width.");
  assert.equal(initialVault.documents.some((document) => document.file === legacyGoal.file && document.kind === "document"), false);
  const linkedDocument = await fetch(`${base}/api/document?file=otto%2Ftest%2Fuse-cases.md`).then((response) => response.json());
  assert.equal(linkedDocument.kind, "document");
  assert.match(linkedDocument.text, /inspect the use cases/);

  const saved = await fetch(`${base}/api/goals/understanding`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      file: "otto/test/goal-prove-it.md",
      understanding: "I asked for a visible result. I will inspect it before I close the goal.",
    }),
  }).then((response) => response.json());
  assert.equal(saved.ok, true);

  const updated = await fetch(`${base}/api/goals/brief?file=otto%2Ftest%2Fgoal-prove-it.md`).then((response) => response.json());
  assert.equal(updated.goal.myUnderstanding, "I asked for a visible result. I will inspect it before I close the goal.");
  assert.match(updated.markdown, /## Julian's understanding/);
  assert.match(updated.markdown, /update the one You wanted bullet in Current brief/);
  assert.match(updated.markdown, /Story so far/);

  const described = await fetch(`${base}/api/work/describe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      area: "otto/test",
      description: "Make the complete flow reliable. Keep the final proof easy to inspect.",
      sources: ["otto/test/use-cases.md"],
      launch: false,
    }),
  }).then((response) => response.json());
  openedSessions.push(described.session);
  assert.match(described.session, /^test-describe-make-the-complete-flow-reliable/);
  const workSession = (await fetch(`${base}/api/sessions`).then((response) => response.json())).sessions
    .find((session) => session.name === described.session);
  assert.equal(workSession.kind, "work-definition");
  assert.equal(workSession.area, "otto/test");
  assert.equal(workSession.cwd, workspace);

  const created = await fetch(`${base}/api/goals/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      area: "otto/test",
      title: "A second visible result",
      doneWhen: "The second result is visible.",
      state: "Not started.",
    }),
  }).then((response) => response.json());
  assert.equal(created.file, "otto/test/goal-a-second-visible-result.md");

  const vault = await fetch(`${base}/api/vault`).then((response) => response.json());
  const newGoal = vault.map.flatMap((group) => group.goals).find((goal) => goal.file === created.file);
  assert.equal(newGoal.title, "A second visible result");
  assert.equal(newGoal.status, "open");
  assert.match(await readFile(path.join(areaDirectory, "test.md"), "utf8"), /\[\[goal-a-second-visible-result\]\]/);

  const hierarchy = await fetch(`${base}/api/goals/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      area: "otto/test",
      description: "Make one complete flow. Keep each proof useful alone.",
      goal: { title: "Complete flow works", doneWhen: "The complete flow works from start to finish." },
      subgoals: [
        { title: "First proof works", doneWhen: "The first proof passes." },
        { title: "Second proof works", doneWhen: "The second proof passes." },
      ],
      sources: [{ file: "otto/test/use-cases.md", title: "Use cases" }],
    }),
  }).then((response) => response.json());
  assert.equal(hierarchy.file, "otto/test/goal-complete-flow-works.md");
  assert.equal(hierarchy.files.length, 3);

  const hierarchyVault = await fetch(`${base}/api/vault`).then((response) => response.json());
  const hierarchyGroup = hierarchyVault.map.find((group) => group.path === "otto/test");
  const rootGoal = hierarchyGroup.goals.find((goal) => goal.file === hierarchy.file);
  const subgoal = hierarchyGroup.goals.find((goal) => goal.file === hierarchy.files[1]);
  assert.deepEqual(rootGoal.subgoals, ["first-proof-works", "second-proof-works"]);
  assert.equal(subgoal.depth, 1);
  assert.deepEqual(subgoal.why.map((goal) => goal.title), ["Complete flow works"]);
  assert.deepEqual(rootGoal.documents.map((document) => document.file), ["otto/test/use-cases.md"]);
  assert.match(rootGoal.currentBrief, /You wanted:/);
  assert.match(rootGoal.storyText, /Goal defined/);
  assert.match(await readFile(path.join(trees, hierarchy.file), "utf8"), /## Sources\n\n- \[\[otto\/test\/use-cases\|Use cases\]\]/);
  const sourceAfterCreate = await fetch(`${base}/api/document?file=otto%2Ftest%2Fuse-cases.md`).then((response) => response.json());
  assert.match(sourceAfterCreate.goalHistory.map((goal) => goal.title).join(" "), /Complete flow works/);

  const idea = await fetch(`${base}/api/idea/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", description: "Maybe add a calmer return screen later." }),
  }).then((response) => response.json());
  assert.equal(idea.ok, true);
  assert.match(await readFile(path.join(areaDirectory, "test.md"), "utf8"), /Idea: Maybe add a calmer return screen later\./);

  const completed = await fetch(`${base}/api/goals/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-prove-it.md", status: "done" }),
  });
  assert.equal(completed.status, 200);
  const completedText = await readFile(path.join(areaDirectory, "goal-prove-it.md"), "utf8");
  assert.match(completedText, /^status: done$/m);
  assert.match(completedText, /^waiting_on:$/m);
  assert.match(completedText, /^session:$/m);
});
