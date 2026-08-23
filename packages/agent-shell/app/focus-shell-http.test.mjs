import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

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
      AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
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
  assert.match(shellScript, /data-create-form/);
  assert.match(shellScript, /What happens next\?/);
  assert.match(shellScript, /data-mark-wont-do/);
  assert.match(shellScript, /data-toggle-awake/);
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
  assert.doesNotMatch(shellScript, /EventSource|api\/reload/);
  assert.match(shellScript, /noteServerBoot/);
  assert.match(shellScript, /api\/shell\/rebuild/);
  assert.match(shellScript, /data-goal-anchor/);
  assert.doesNotMatch(shellScript, /data-view-goal|Goal details/);
  assert.doesNotMatch(serverSource, /createReloadController|api\/reload|source changed; restarting|watch\(here/);
  // Command teaching moved to the ambient ~/.agents/AGENTS.md: the describe
  // prompt names the trivial-path command and the two good outcomes instead.
  assert.match(serverSource, /tangent goal create/);
  assert.match(serverSource, /--own/);
  assert.doesNotMatch(serverSource, /goal-command\.mjs/);

  const reloadEndpoint = await fetch(`${base}/api/reload`, { method: "POST" });
  assert.equal(reloadEndpoint.status, 404);

  const sessionPayload = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(sessionPayload.caffeinate, false);

  const programs = await fetch(`${base}/api/programs`).then((response) => response.json());
  assert.equal(programs.programs.find((program) => program.name === "dev").type, "process");

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


  const brief = await fetch(`${base}/api/goals/brief?file=otto%2Ftest%2Fgoal-prove-it.md`).then((response) => response.json());
  assert.equal(brief.goal.title, "Prove it");
  assert.match(brief.markdown, /^# Assignment: Prove it/m);
  assert.match(brief.markdown, /## Done when\n\nThe result is visible/);
  assert.deepEqual(brief.context.notes.map((file) => path.basename(file)), ["test.md", "otto.md"]);
  assert.deepEqual(brief.context.documents.map((file) => path.basename(file)).sort(), ["design-test.md", "use-cases.md"]);

  const initialVault = await fetch(`${base}/api/vault`).then((response) => response.json());
  assert.deepEqual(initialVault.recentCloses, [], "a vault without git carries no close events");
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
  assert.deepEqual(linkedDocument.comments, []);

  // Comments: a base-hash save adds one, the Goal prompt counts it, and only
  // `tangent document resolve` removes it, in its own named commit.
  const commented = linkedDocument.text.replace("inspect the use cases", "inspect the {==use cases==}{>>Julian: Name them.<<}");
  const stale = await fetch(`${base}/api/document`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/use-cases.md", text: commented, baseHash: "stale", summary: "added a comment" }),
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).current.hash, linkedDocument.hash);
  const commentedDocument = await fetch(`${base}/api/document`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/use-cases.md", text: commented, baseHash: linkedDocument.hash, summary: "added a comment" }),
  }).then((response) => response.json());
  assert.deepEqual(commentedDocument.comments.map((comment) => [comment.author, comment.text, comment.quote]), [["Julian", "Name them.", "use cases"]]);
  const listed = await fetch(`${base}/api/document/comments?file=otto%2Ftest%2Fuse-cases.md`).then((response) => response.json());
  assert.equal(listed.comments.length, 1);
  const briefWithComment = await fetch(`${base}/api/goals/brief?file=otto%2Ftest%2Fgoal-prove-it.md`).then((response) => response.json());
  assert.match(briefWithComment.markdown, /use-cases\.md \(1 open comment from Julian\)/);
  assert.match(briefWithComment.markdown, /tangent document resolve/);
  const missing = await fetch(`${base}/api/document/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/use-cases.md", prefix: "Nothing like this", note: "x" }),
  });
  assert.equal(missing.status, 404);
  const resolved = await fetch(`${base}/api/document/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/use-cases.md", prefix: "name them", note: "Listed the use cases." }),
  }).then((response) => response.json());
  assert.equal(resolved.comment.text, "Name them.");
  assert.equal(resolved.remaining, 0);
  assert.equal(await readFile(path.join(areaDirectory, "use-cases.md"), "utf8"), linkedDocument.text);
  const briefAfterResolve = await fetch(`${base}/api/goals/brief?file=otto%2Ftest%2Fgoal-prove-it.md`).then((response) => response.json());
  assert.doesNotMatch(briefAfterResolve.markdown, /open comment/);

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
  assert.match(updated.markdown, /no need to re-confirm the assignment/);
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

  // A defining agent that creates a Goal with --own stops being "Defining
  // work": the Goal binds to its session and the session adopts the Goal's
  // identity, so the desk shows it on the Goal row instead of Dispatches.
  const ownedCreate = await fetch(`${base}/api/goals/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      area: "otto/test",
      goal: { title: "A trivial fix", doneWhen: "The fix is visible." },
      own: described.session,
    }),
  }).then((response) => response.json());
  assert.equal(ownedCreate.session, described.session);
  const ownedText = await readFile(path.join(trees, ownedCreate.file), "utf8");
  assert.match(ownedText, /^status: active$/m);
  assert.match(ownedText, new RegExp(`^session: ${described.session}$`, "m"));
  const adopted = (await fetch(`${base}/api/sessions`).then((response) => response.json())).sessions
    .find((session) => session.name === described.session);
  assert.equal(adopted.kind, "goal");
  assert.equal(adopted.goal, ownedCreate.file);

  // Release hands the Goal back to open; the session stays alive.
  const releasedOwned = await fetch(`${base}/api/goals/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: described.session, slugs: ["a-trivial-fix"] }),
  });
  assert.equal(releasedOwned.status, 200);
  const releasedText = await readFile(path.join(trees, ownedCreate.file), "utf8");
  assert.match(releasedText, /^status: open$/m);

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

  // Read-only endpoints behind `tangent area`, `tangent goal`, and `tangent idea`.
  const areaShow = await fetch(`${base}/api/areas/show?area=otto%2Ftest`).then((response) => response.json());
  assert.deepEqual(areaShow.goals.map((goal) => goal.slug).sort(), [
    "a-second-visible-result", "a-trivial-fix", "complete-flow-works", "connect-chosen-ramp-faces", "first-proof-works", "prove-it", "second-proof-works",
  ]);
  assert.deepEqual(areaShow.ideas, ["Maybe add a calmer return screen later."]);
  const missingAreaShow = await fetch(`${base}/api/areas/show?area=otto%2Fnowhere`);
  assert.equal(missingAreaShow.status, 404);

  const areaGoals = await fetch(`${base}/api/goals?area=otto%2Ftest`).then((response) => response.json());
  assert.deepEqual(areaGoals.goals.map((goal) => goal.slug).sort(), [
    "a-second-visible-result", "a-trivial-fix", "complete-flow-works", "connect-chosen-ramp-faces", "first-proof-works", "prove-it", "second-proof-works",
  ]);
  const allGoals = await fetch(`${base}/api/goals`).then((response) => response.json());
  assert.ok(allGoals.goals.some((goal) => goal.slug === "prove-it" && goal.area === "otto/test"));

  const goalShow = await fetch(`${base}/api/goals/show?slug=prove-it`).then((response) => response.json());
  assert.equal(goalShow.goal.title, "Prove it");
  assert.equal(goalShow.goal.file, "otto/test/goal-prove-it.md");
  const missingGoalShow = await fetch(`${base}/api/goals/show?slug=does-not-exist`);
  assert.equal(missingGoalShow.status, 404);

  const agents = await fetch(`${base}/api/agents`).then((response) => response.json());
  assert.ok(Array.isArray(agents.agents));
  assert.ok(agents.agents.every((agent) => !["process", "service", "command"].includes(agent.kind ?? "")));
  assert.ok(agents.agents.every((agent) => "stateDetail" in agent && "queued" in agent));

  const sendMissing = await fetch(`${base}/api/agents/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: "no-such-session-anywhere", text: "hello" }),
  });
  assert.equal(sendMissing.status, 404);
  const sendEmpty = await fetch(`${base}/api/agents/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: "no-such-session-anywhere", text: "   " }),
  });
  assert.equal(sendEmpty.status, 400);

  // Ownership lane: own validates the claiming session against live tmux
  // sessions; release is idempotent for a goal nobody owns.
  const ownNoBody = await fetch(`${base}/api/goals/own`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(ownNoBody.status, 400);
  const ownUnknownSession = await fetch(`${base}/api/goals/own`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "no-such-session-anywhere", slugs: ["prove-it"] }),
  });
  assert.equal(ownUnknownSession.status, 404);
  const releaseUnowned = await fetch(`${base}/api/goals/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "no-such-session-anywhere", slugs: ["prove-it"] }),
  });
  assert.equal(releaseUnowned.status, 200);
  const unownedText = await readFile(path.join(areaDirectory, "goal-prove-it.md"), "utf8");
  assert.match(unownedText, /^status: open$/m);
  const createOwnUnknownSession = await fetch(`${base}/api/goals/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      area: "otto/test",
      goal: { title: "Never created", doneWhen: "Never." },
      own: "no-such-session-anywhere",
    }),
  });
  assert.equal(createOwnUnknownSession.status, 404);
  const afterFailedOwnCreate = await fetch(`${base}/api/goals?area=otto%2Ftest`).then((response) => response.json());
  assert.ok(!afterFailedOwnCreate.goals.some((goal) => goal.title === "Never created"));

  const areaIdeas = await fetch(`${base}/api/ideas?area=otto%2Ftest`).then((response) => response.json());
  assert.deepEqual(areaIdeas.ideas, [{ area: "otto/test", text: "Maybe add a calmer return screen later." }]);
  const allIdeas = await fetch(`${base}/api/ideas`).then((response) => response.json());
  assert.ok(allIdeas.ideas.some((entry) => entry.area === "otto/test" && entry.text === "Maybe add a calmer return screen later."));

  // ---- agent pipelines ----
  // A registry with an effort axis; step launches resolve through it.
  await writeFile(path.join(trees, "harnesses.md"), "# Harnesses\n\n```tangent.harnesses.v1\n" + JSON.stringify({
    version: 1,
    modelSets: { fake: [{ id: "one", label: "One", args: "--model one" }] },
    effortSets: { fake: [{ id: "high", label: "High", args: "--effort high" }] },
    harnesses: [{ id: "fake", label: "Fake", command: "fake-agent", modelSet: "fake", effortSet: "fake" }],
  }, null, 2) + "\n```\n", "utf8");
  const options = await fetch(`${base}/api/launch/options?area=otto%2Ftest`).then((response) => response.json());
  assert.deepEqual(options.harnesses[0].efforts, [{ id: "high", label: "High", args: "--effort high" }]);
  assert.match(serverSource, /## Your step/);
  assert.match(serverSource, /## When you finish/);
  assert.match(serverSource, /tangent goal handover/);
  assert.match(serverSource, /design-<slug>\.md/);
  assert.match(serverSource, /rationaleDossierContract\(/);

  const pipelineGoal = await fetch(`${base}/api/goals/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", goal: { title: "Pipeline demo", doneWhen: "Three agents handed over." } }),
  }).then((response) => response.json());
  const badEffort = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: pipelineGoal.file, steps: [{ instruction: "design", launch: { harness: "fake", model: "one", effort: "ultra" } }] }),
  });
  assert.equal(badEffort.status, 409);
  assert.match((await badEffort.json()).error, /unknown effort "ultra"/);
  assert.equal(existsSync(path.join(root, "pipelines", "otto", "test", "pipeline-demo.json")), false);
  const badSteps = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: pipelineGoal.file, steps: [{ instruction: "  ", launch: { harness: "fake" } }] }),
  });
  assert.equal(badSteps.status, 400);

  const startedPipeline = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      file: pipelineGoal.file,
      steps: [
        { instruction: "/design this Goal.", launch: { harness: "fake", model: "one", effort: "high" } },
        { instruction: "Review the design from step 1 and update it.", launch: { harness: "fake", model: "one" }, continueFrom: 1 },
        { instruction: "Implement the design.", command: "fake-agent --implement" },
      ],
    }),
  }).then((response) => response.json());
  openedSessions.push(startedPipeline.session);
  assert.equal(startedPipeline.session, "test-pipeline-demo");
  assert.equal(startedPipeline.pipeline.steps[0].status, "running");
  assert.equal(startedPipeline.pipeline.steps[0].command, "fake-agent --model one --effort high");
  assert.equal(startedPipeline.pipeline.steps[0].label, "Fake · One · High");
  assert.ok(existsSync(path.join(root, "pipelines", "otto", "test", "pipeline-demo.json")));
  // otto/test's default harness is claude-otto (profile fallback); steps 1 and
  // 2 named a different harness, so the server warns without blocking either.
  assert.equal(startedPipeline.warnings.length, 2);
  assert.match(startedPipeline.warnings[0], /step 1: --launch fake\/one differs from otto\/test's default harness claude-otto\./);
  assert.match(startedPipeline.warnings[1], /step 2: --launch fake\/one differs from otto\/test's default harness claude-otto\./);
  let goalText = await readFile(path.join(trees, pipelineGoal.file), "utf8");
  assert.match(goalText, /^status: active$/m);
  assert.match(goalText, /^session: test-pipeline-demo$/m);
  let snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  const stepOne = snapshot.sessions.find((session) => session.name === "test-pipeline-demo");
  assert.equal(stepOne.pipeline, pipelineGoal.file);
  assert.equal(stepOne.step, 1);
  assert.equal(stepOne.goal, pipelineGoal.file);
  assert.equal(snapshot.pipelines.length, 1);
  assert.equal(snapshot.pipelines[0].status, "running");
  assert.equal(snapshot.pipelines[0].steps[0].live, true);

  const ownedElsewhere = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: pipelineGoal.file, steps: [{ instruction: "again", launch: { harness: "fake" } }] }),
  });
  assert.equal(ownedElsewhere.status, 409);
  assert.match((await ownedElsewhere.json()).error, /owned by live session test-pipeline-demo/);

  const strayHandover = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: described.session, text: "nothing" }),
  });
  assert.equal(strayHandover.status, 404);
  const editRunning = await fetch(`${base}/api/pipelines/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, step: 1, instruction: "changed" }),
  });
  assert.equal(editRunning.status, 409);
  const editPending = await fetch(`${base}/api/pipelines/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, step: 3, instruction: "Implement the design and prove it." }),
  }).then((response) => response.json());
  assert.equal(editPending.pipeline.steps[2].instruction, "Implement the design and prove it.");

  // Step 1 hands over: step 2 continues step 1's session (same tmux session,
  // step option advanced), the Goal stays bound to it.
  const handoverOne = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "test-pipeline-demo", text: "Design written: design-pipeline-demo.md. Unresolved: none." }),
  }).then((response) => response.json());
  assert.equal(handoverOne.status, "started");
  assert.deepEqual(handoverOne.next, { index: 2, session: "test-pipeline-demo" });
  assert.equal(handoverOne.pipeline.steps[0].status, "complete");
  assert.equal(handoverOne.pipeline.steps[0].handoverSource, "agent");
  snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(snapshot.sessions.find((session) => session.name === "test-pipeline-demo").step, 2);

  // Step 2 hands over: step 3 is a fresh session named for its step and the
  // Goal follows it.
  const handoverTwo = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "test-pipeline-demo", text: "Design reviewed and updated in place." }),
  }).then((response) => response.json());
  assert.deepEqual(handoverTwo.next, { index: 3, session: "test-pipeline-demo-s3" });
  openedSessions.push("test-pipeline-demo-s3");
  goalText = await readFile(path.join(trees, pipelineGoal.file), "utf8");
  assert.match(goalText, /^session: test-pipeline-demo-s3$/m);
  snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  const stepThree = snapshot.sessions.find((session) => session.name === "test-pipeline-demo-s3");
  assert.equal(stepThree.step, 3);
  assert.equal(stepThree.launchLabel, "Edited command");
  const sendShell = await fetch(`${base}/api/pipelines/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, action: "send", step: 3 }),
  });
  assert.equal(sendShell.status, 409);

  // The step 3 session dies: restart creates a new session for the same step.
  await new Promise((resolve, reject) => execFile("tmux", ["kill-session", "-t", "=test-pipeline-demo-s3"], (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve())));
  await new Promise((resolve) => execFile("tmux", ["has-session", "-t", "=test-pipeline-demo-s3"], (error) => resolve(assert.ok(error, "step 3 session should be gone"))));
  const restarted = await fetch(`${base}/api/pipelines/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, action: "restart", step: 3 }),
  }).then((response) => response.json());
  assert.equal(restarted.next.index, 3);
  assert.equal(restarted.next.session, "test-pipeline-demo-s3");
  openedSessions.push(restarted.next.session);
  goalText = await readFile(path.join(trees, pipelineGoal.file), "utf8");
  assert.match(goalText, /^session: test-pipeline-demo-s3$/m);

  // Appending mid-run: step 4 waits behind the running step 3 and nothing
  // that already ran changes.
  const appendMidRun = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, steps: [{ instruction: "Prove the implementation.", launch: { harness: "fake", model: "one" } }] }),
  }).then((response) => response.json());
  assert.equal(appendMidRun.status, "queued");
  assert.equal(appendMidRun.after, 3);
  assert.deepEqual(appendMidRun.added, [4]);
  assert.equal(appendMidRun.pipeline.steps[3].status, "pending");
  assert.equal(appendMidRun.pipeline.steps[0].handover, "Design written: design-pipeline-demo.md. Unresolved: none.");
  assert.equal(appendMidRun.pipeline.steps[2].status, "running");
  const appendEmpty = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, steps: [] }),
  });
  assert.equal(appendEmpty.status, 400);
  const appendNoPipeline = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: hierarchy.file, steps: [{ instruction: "x", launch: { harness: "fake" } }] }),
  });
  assert.equal(appendNoPipeline.status, 404);

  // Skipping step 3 flows into the appended step 4 without any restart.
  const skipped = await fetch(`${base}/api/pipelines/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, action: "skip", step: 3 }),
  }).then((response) => response.json());
  assert.equal(skipped.status, "started");
  assert.deepEqual(skipped.next, { index: 4, session: "test-pipeline-demo-s4" });
  openedSessions.push("test-pipeline-demo-s4");
  assert.equal(skipped.pipeline.steps[2].status, "skipped");
  const handoverFour = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "test-pipeline-demo-s4", text: "Proof written." }),
  }).then((response) => response.json());
  assert.equal(handoverFour.status, "complete");
  snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(snapshot.pipelines[0].status, "complete");

  // Appending to a finished pipeline whose last agent is gone (its pane sits
  // at a shell): the new step starts at once.
  const appendAfterDead = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, steps: [{ instruction: "Write the release note.", launch: { harness: "fake", model: "one" } }] }),
  }).then((response) => response.json());
  assert.equal(appendAfterDead.status, "started");
  assert.deepEqual(appendAfterDead.next, { index: 5, session: "test-pipeline-demo-s5" });
  openedSessions.push("test-pipeline-demo-s5");
  assert.equal(appendAfterDead.pipeline.steps[3].status, "complete", "the finished step stays finished");
  const handoverFive = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "test-pipeline-demo-s5", text: "Release note written." }),
  }).then((response) => response.json());
  assert.equal(handoverFive.status, "complete");

  // Appending to a finished pipeline whose last agent still runs: that step
  // is asked to hand over again; its second handover is kept beside the first
  // and flows into the new step.
  await new Promise((resolve, reject) => execFile("tmux", ["send-keys", "-t", "=test-pipeline-demo-s5:", "sleep 300", "Enter"], (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve())));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const command = await new Promise((resolve) => execFile("tmux", ["display-message", "-p", "-t", "=test-pipeline-demo-s5:", "#{pane_current_command}"], (error, stdout) => resolve(error ? "" : stdout.trim())));
    if (command === "sleep") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // The server caches a pane sample for MIN_SAMPLE_MS (1200ms); the last poll
  // saw a shell, so wait out the window or the append reads a stale "shell".
  await new Promise((resolve) => setTimeout(resolve, 1300));
  const appendAfterLive = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, steps: [{ instruction: "Announce it.", launch: { harness: "fake" } }, { instruction: "Archive it.", command: "fake-agent --archive", continueFrom: 6 }] }),
  }).then((response) => response.json());
  assert.equal(appendAfterLive.status, "asked");
  assert.equal(appendAfterLive.after, 5);
  assert.equal(appendAfterLive.session, "test-pipeline-demo-s5");
  assert.deepEqual(appendAfterLive.added, [6, 7]);
  assert.equal(appendAfterLive.pipeline.steps[4].status, "running");
  assert.equal(appendAfterLive.pipeline.steps[4].handover, "Release note written.");
  assert.equal(appendAfterLive.pipeline.steps[5].status, "pending");
  snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(snapshot.pipelines[0].status, "running");
  const handoverAgain = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "test-pipeline-demo-s5", text: "Nothing changed since; the note is final." }),
  }).then((response) => response.json());
  assert.deepEqual(handoverAgain.next, { index: 6, session: "test-pipeline-demo-s6" });
  openedSessions.push("test-pipeline-demo-s6");
  assert.equal(handoverAgain.pipeline.steps[4].status, "complete");
  assert.equal(handoverAgain.pipeline.steps[4].handover, "Release note written.\n\nNothing changed since; the note is final.");
  assert.equal(handoverAgain.pipeline.steps[5].status, "running");

  // Julian stops the agent on step 6 (the same kill as Stop agent, ⌘D, or ✕):
  // the run ends. Step 6 and the pending step 7 are ended, not left
  // "stopped", so the desk offers no Restart and the Goal settles back to
  // plain open work.
  const killed = await fetch(`${base}/api/kill/${encodeURIComponent("test-pipeline-demo-s6")}`, { method: "POST" }).then((response) => response.json());
  assert.equal(killed.pipelineEnded, true);
  snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.deepEqual(snapshot.pipelines[0].steps.slice(4).map((step) => step.status), ["complete", "ended", "ended"]);
  assert.equal(snapshot.pipelines[0].status, "complete");
  const killedPlain = await fetch(`${base}/api/kill/${encodeURIComponent("test-pipeline-demo-s5")}`, { method: "POST" }).then((response) => response.json());
  assert.equal(killedPlain.pipelineEnded, false, "killing a session that is no running step ends nothing");
  // Ending a run twice is harmless, and a later append starts fresh after the ended steps.
  const endAgain = await fetch(`${base}/api/pipelines/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, action: "end", step: 6 }),
  }).then((response) => response.json());
  assert.equal(endAgain.status, "ended");
  assert.deepEqual(endAgain.ended, []);
  const appendAfterEnd = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, steps: [{ instruction: "Pick it up again.", launch: { harness: "fake" } }] }),
  }).then((response) => response.json());
  assert.equal(appendAfterEnd.status, "started");
  assert.deepEqual(appendAfterEnd.next, { index: 8, session: "test-pipeline-demo-s8" });
  openedSessions.push("test-pipeline-demo-s8");
  assert.equal(appendAfterEnd.pipeline.steps[6].status, "ended", "the ended step stays ended");
  // A step whose session died on its own can be ended from the desk too.
  await new Promise((resolve, reject) => execFile("tmux", ["kill-session", "-t", "=test-pipeline-demo-s8"], (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve())));
  const endDead = await fetch(`${base}/api/pipelines/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, action: "end", step: 8 }),
  }).then((response) => response.json());
  assert.deepEqual(endDead.ended, [8]);
  assert.equal(endDead.pipeline.steps[7].status, "ended");

  // ---- Area brain ----
  // Julian starts one brain on the Area; it is a session of kind brain with a
  // record under the brains root, and every Goal prompt on the Area names it.
  assert.match(serverSource, /# Brain for \$\{area\}/);
  assert.match(serverSource, /tangent brain handover/);
  assert.match(serverSource, /Sonnet is the workhorse/);
  assert.match(serverSource, /Every --launch in this Area is \$\{harness\}/);
  const emptyBrain = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", instruction: "   " }),
  });
  assert.equal(emptyBrain.status, 400);
  const brainStart = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", instruction: "Get the test Area done.", choice: { harness: "fake", model: "one" } }),
  }).then((response) => response.json());
  assert.equal(brainStart.session, "test-brain");
  openedSessions.push("test-brain");
  assert.equal(brainStart.generation, 1);
  assert.equal(brainStart.brain.command, "fake-agent --model one");
  assert.equal(brainStart.brain.planFile, "otto/test/plan-test.md");
  assert.ok(existsSync(path.join(root, "brains", "otto", "test", "brain.json")));
  snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  const brainSession = snapshot.sessions.find((session) => session.name === "test-brain");
  assert.equal(brainSession.kind, "brain");
  assert.equal(brainSession.brain, "otto/test");
  assert.equal(brainSession.generation, 1);
  assert.equal(snapshot.brains.length, 1);
  assert.equal(snapshot.brains[0].live, true);
  assert.equal(snapshot.brains[0].status, "running");
  const brainAgain = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", instruction: "Something else." }),
  }).then((response) => response.json());
  assert.equal(brainAgain.reattached, true);
  assert.equal(brainAgain.session, "test-brain");
  const brainShow = await fetch(`${base}/api/brains/show?session=test-brain`).then((response) => response.json());
  assert.equal(brainShow.brain.area, "otto/test");
  // otto/test resolves to claude-otto (profile fallback); the prompt states
  // it in plain words and every example launch uses it, never plain claude.
  assert.match(brainShow.prompt, /Every --launch in this Area is claude-otto\/<model>/);
  assert.doesNotMatch(brainShow.prompt, /claude\//);
  assert.equal((await fetch(`${base}/api/brains/show?area=otto%2Fnowhere`)).status, 404);
  const briefUnderBrain = await fetch(`${base}/api/goals/brief?file=${encodeURIComponent(pipelineGoal.file)}`).then((response) => response.json());
  assert.match(briefUnderBrain.markdown, /## Brain\n\nThis Goal is part of the plan of the brain session `test-brain` for Area otto\/test/);
  // A pipeline event on the Area is queued to the brain as a message from tangent.
  const eventPipeline = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, steps: [{ instruction: "One more.", launch: { harness: "fake" } }] }),
  }).then((response) => response.json());
  assert.equal(eventPipeline.status, "started");
  openedSessions.push(eventPipeline.next.session);
  const eventHandover = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: eventPipeline.next.session, text: "One more done." }),
  }).then((response) => response.json());
  assert.equal(eventHandover.status, "complete");
  const messageLog = (await readFile(path.join(root, "messages.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const brainEvent = messageLog.find((entry) => entry.to === "test-brain" && entry.from === "tangent" && /pipeline complete/.test(entry.text));
  assert.ok(brainEvent, "the brain hears that the pipeline completed");
  assert.match(brainEvent.text, /Last handover: One more done\./);
  // Handover from a session that is not a brain is refused; from the brain it
  // starts generation 2 on a new session and the record follows it.
  const notBrain = await fetch(`${base}/api/brains/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "test-pipeline-demo", text: "facts" }),
  });
  assert.equal(notBrain.status, 404);
  const brainHandover = await fetch(`${base}/api/brains/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "test-brain", text: "Wave 1 dispatched: pipeline-demo runs step 9. Next: wait for it." }),
  }).then((response) => response.json());
  assert.equal(brainHandover.status, "started");
  assert.equal(brainHandover.session, "test-brain-g2");
  assert.equal(brainHandover.generation, 2);
  openedSessions.push("test-brain-g2");
  await new Promise((resolve) => setTimeout(resolve, 1800));
  snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(snapshot.sessions.some((session) => session.name === "test-brain"), false, "the old generation ends after the new one starts");
  assert.equal(snapshot.brains[0].session, "test-brain-g2");
  assert.equal(snapshot.brains[0].generation, 2);
  assert.equal(snapshot.brains[0].status, "running");
  assert.equal(snapshot.brains[0].latestHandover, "Wave 1 dispatched: pipeline-demo runs step 9. Next: wait for it.");
  assert.equal(snapshot.brains[0].generations[0].handover, "Wave 1 dispatched: pipeline-demo runs step 9. Next: wait for it.");
  // Stop agent on the brain ends it; Resume starts generation 3 from the record.
  const brainKilled = await fetch(`${base}/api/kill/${encodeURIComponent("test-brain-g2")}`, { method: "POST" }).then((response) => response.json());
  assert.equal(brainKilled.brainEnded, true);
  snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(snapshot.brains[0].status, "ended");
  assert.equal(snapshot.brains[0].live, false);
  const briefWithoutBrain = await fetch(`${base}/api/goals/brief?file=${encodeURIComponent(pipelineGoal.file)}`).then((response) => response.json());
  assert.doesNotMatch(briefWithoutBrain.markdown, /## Brain/);
  const brainResume = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", resume: true }),
  }).then((response) => response.json());
  assert.equal(brainResume.session, "test-brain-g3");
  assert.equal(brainResume.generation, 3);
  openedSessions.push("test-brain-g3");
  assert.equal(brainResume.brain.instruction, "Get the test Area done.");

  const missingDropReason = await fetch(`${base}/api/goals/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: hierarchy.file, status: "dropped" }),
  });
  assert.equal(missingDropReason.status, 400);

  const dropped = await fetch(`${base}/api/goals/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: hierarchy.file, status: "dropped", reason: "The simpler flow already solves this need." }),
  });
  assert.equal(dropped.status, 200);
  const droppedText = await readFile(path.join(trees, hierarchy.file), "utf8");
  assert.match(droppedText, /^status: dropped$/m);
  assert.match(droppedText, /^session:$/m);
  assert.match(droppedText, /### Won't do\n\nThe simpler flow already solves this need\./);

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

test("a close commit records the session that closed the Goal, and the vault payload carries it as a recent close", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "what-happened-http-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const areaDirectory = path.join(trees, "otto", "test");
  await mkdir(areaDirectory, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(areaDirectory, "test.md"), "---\ntype: area\n---\n\n# Test\n\n## Goals\n\n1. [[goal-prove-it]]\n", "utf8");
  await writeFile(
    path.join(areaDirectory, "goal-prove-it.md"),
    "---\ntype: goal\nstatus: open\ndone_when: The result is visible\nsession:\n---\n\n# Prove it\n\n## State\n\nNot started.\n",
    "utf8"
  );
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "add: everything"]);

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
      AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "",
      CHAT_SESSION: `what-happened-http-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const edited = await fetch(`${base}/api/goals/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-prove-it.md", status: "done", session: "tangent-brain-g4" }),
  });
  assert.equal(edited.status, 200);

  const { stdout: log } = await execFileAsync("git", ["-C", trees, "log", "-1", "--format=%s%n%b"]);
  assert.match(log, /done in tree/);
  assert.match(log, /Tangent-Tmux: tangent-brain-g4/);

  const vault = await fetch(`${base}/api/vault`).then((response) => response.json());
  assert.deepEqual(vault.recentCloses, [{ file: "otto/test/goal-prove-it.md", kind: "done", at: vault.recentCloses[0]?.at, session: "tangent-brain-g4" }]);
  assert.ok(vault.recentCloses[0].at > Date.now() - 60_000, "the close time is the fresh commit's time");
});
