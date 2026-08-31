import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

test("the context-first shell is default and keeps the user's understanding with the goal", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-focus-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const areaDirectory = path.join(trees, "otto", "test");
  await mkdir(areaDirectory, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(areaDirectory, "test.md"), `---\ntype: area\n---\n\n# Test\n\n## Goals\n\n1. [[goal-prove-it]]\n2. [[outcome-connect-chosen-ramp-faces]]\n\n## Resources\n\n- Repository: ${workspace}\n\n## Development environment\n\n\`\`\`tangent.environment.v1\n{"defaults":{"launch":{"harness":"other"},"brain":{"harness":"fake","model":"one"}}}\n\`\`\`\n`, "utf8");
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

  const openedSessions = [];
  const instanceId = `workflow-test-${process.pid}`;
  const base = await startShellServer(context, { here, root, trees, workspace, openedSessions, env: { TANGENT_SHELL_INSTANCE_ID: instanceId } });
  if (!base) return;

  const browserModules = [
    "shell.js", "work-desk-view.js", "area-directory-view.js", "program-view.js", "goal-launch-view.js",
    "agent-decision-view.js", "document-reader-view.js", "document-reader-controller.js", "shell-coordinator.js",
    "shell-event-bindings.js", "terminal-controller.js",
  ];
  const shellScript = (await Promise.all(browserModules.map((file) => fetch(`${base}/${file}`).then((response) => response.text())))).join("\n");
  const goalNarrativeScript = await fetch(`${base}/goal-narrative.js`).then((response) => response.text());
  const serverSource = await readFile(path.join(here, "server.mjs"), "utf8");
  assert.match(shellScript, /data-command-enter-submit/);
  assert.match(shellScript, /event\.key === "Enter" && event\.metaKey/);
  assert.match(shellScript, /data-describe-work-form/);
  assert.match(shellScript, /What happens next\?/);
  assert.match(shellScript, /data-mark-wont-do/);
  assert.match(shellScript, /data-toggle-awake/);
  assert.match(shellScript, /data-describe-work/);
  assert.doesNotMatch(shellScript, /data-share-context/);
  assert.match(shellScript, /\/api\/work\/describe/);
  assert.doesNotMatch(shellScript, /\/api\/goals\/shape|shape-review/);
  assert.doesNotMatch(shellScript, /\/api\/goals\/agent/, "the collaborate start is gone: only the brain starts workers (D8)");
  assert.match(shellScript, /Document reader/);
  assert.match(shellScript, /data-document-history/);
  assert.match(shellScript, /document-picker/);
  assert.match(shellScript, /data-open-vault-link/);
  assert.doesNotMatch(shellScript, /Discuss with agent|Describe related work|Talk it through first|See what the agent will do|Review execution plan|Read what will happen/);
  assert.match(shellScript, /from "\.\/goal-narrative\.js"/);
  assert.match(goalNarrativeScript, /currentBriefFields/);
  assert.match(goalNarrativeScript, /storyEntries/);
  assert.match(shellScript, /post\("\/api\/caffeinate"/);
  assert.doesNotMatch(shellScript, /EventSource|api\/reload/);
  assert.match(shellScript, /noteRuntimeIdentity/);
  assert.doesNotMatch(shellScript, /noteServerBoot/);
  assert.match(shellScript, /api\/shell\/rebuild/);
  assert.match(shellScript, /data-goal-anchor/);
  assert.doesNotMatch(shellScript, /data-view-goal/, "Goal reading does not restore the retired standalone detail screen");
  assert.match(shellScript, /api\/goals\/detail/);
  assert.match(shellScript, /Goal details/, "the Document reader projects the stable Goal read model");
  assert.doesNotMatch(serverSource, /createReloadController|api\/reload|source changed; restarting|watch\(here/);
  // Everything starts through the brain (ADR-0041): no describe-work agent
  // and no command teaching in a generated prompt. The brain reads
  // `tangent help` and the vault root AGENTS.md instead.
  assert.doesNotMatch(serverSource, /describeWorkPrompt|spawnDescribeWorkSession|primeDescribeWorkSession/);
  assert.doesNotMatch(serverSource, /goal-command\.mjs/);

  const reloadEndpoint = await fetch(`${base}/api/reload`, { method: "POST" });
  assert.equal(reloadEndpoint.status, 404);

  const sessionPayload = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(sessionPayload.caffeinate, false);

  const programs = await fetch(`${base}/api/operations`).then((response) => response.json());
  assert.equal(programs.programs.find((program) => program.name === "dev").type, "process");

  const command = await fetch(`${base}/api/operations/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "command", area: "otto/test", name: "Release", command: "npm run release", cwd: workspace }),
  }).then((response) => response.json());
  assert.equal(command.id, "command:otto/test:release");

  const routine = await fetch(`${base}/api/operations/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "routine", area: "otto/test", name: "Daily check", time: "07:30", cwd: workspace, model: "sonnet", prompt: "Check the area and leave proof." }),
  });
  assert.equal(routine.status, 409, "the removed daily-agent type is rejected");

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
  assert.match(briefWithComment.markdown, /\{>>Julian: \.\.\.<<\}/, "the worker learns the comment shape, not a command");
  assert.doesNotMatch(briefWithComment.markdown, /tangent document resolve/, "the brain closes comments, not the worker");
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
  assert.doesNotMatch(updated.markdown, /## Julian's understanding|## How to work|## Dependencies/, "the worker prompt is the Goal, its sources, the folder, and the one command");
  assert.match(updated.markdown, /## Working directory/);

  // A session this server owns that is not yet a worker: the shape an agent
  // that defines work has before it takes a Goal with --own. Everything
  // starts through the brain now (ADR-0041), so the test opens it itself.
  const described = { session: `test-describe-make-the-complete-flow-reliable-${process.pid}` };
  await execFileAsync("tmux", ["new-session", "-d", "-s", described.session, "-c", workspace]);
  for (const [key, value] of [["@tangent_kind", "work-definition"], ["@tangent_area", "otto/test"], ["@tangent_agent_shell_instance", instanceId], ["@tangent_work_title", "Make the complete flow reliable"]]) {
    await execFileAsync("tmux", ["set-option", "-t", described.session, key, value]);
  }
  openedSessions.push(described.session);
  const workSession = await (async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const found = (await fetch(`${base}/api/sessions`).then((response) => response.json())).sessions.find((session) => session.name === described.session);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  })();
  assert.ok(workSession, "the owned session is listed");
  assert.equal(workSession.kind, "work-definition");
  assert.equal(workSession.area, "otto/test");

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
  assert.doesNotMatch(await readFile(path.join(areaDirectory, "test.md"), "utf8"), /\[\[goal-a-second-visible-result\]\]/, "Tangent never writes into the Area note (ADR-0041)");

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

  // Read-only endpoints behind `tangent area` and `tangent goal`.
  const areaShow = await fetch(`${base}/api/areas/show?area=otto%2Ftest`).then((response) => response.json());
  assert.deepEqual(areaShow.goals.map((goal) => goal.slug).sort(), [
    "a-second-visible-result", "a-trivial-fix", "complete-flow-works", "connect-chosen-ramp-faces", "first-proof-works", "prove-it", "second-proof-works",
  ]);
  assert.equal(Object.hasOwn(areaShow, "ideas"), false);
  const missingAreaShow = await fetch(`${base}/api/areas/show?area=otto%2Fnowhere`);
  assert.equal(missingAreaShow.status, 404);

  const areaGoals = await fetch(`${base}/api/goals?area=otto%2Ftest`).then((response) => response.json());
  assert.deepEqual(areaGoals.goals.map((goal) => goal.slug).sort(), [
    "a-second-visible-result", "a-trivial-fix", "complete-flow-works", "connect-chosen-ramp-faces", "first-proof-works", "prove-it", "second-proof-works",
  ]);
  const allGoals = await fetch(`${base}/api/goals`).then((response) => response.json());
  assert.ok(allGoals.goals.some((goal) => goal.slug === "prove-it" && goal.area === "otto/test"));

  // An exact-Area listing names what its child Areas hold, so a brain that
  // finds nothing here learns where to look instead of searching elsewhere.
  await fetch(`${base}/api/areas/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parent: "otto/test", name: "nested" }),
  });
  await writeFile(path.join(trees, "otto", "test", "nested", "goal-nested-work.md"), "---\ntype: goal\nstatus: open\ndone_when: The nested work is done.\n---\n\n# Nested work\n");
  const exactScope = await fetch(`${base}/api/goals?area=otto%2Ftest`).then((response) => response.json());
  assert.equal(exactScope.scope, "exact");
  assert.ok(exactScope.childAreas >= 1, "the exact listing counts the child Areas that exist");
  assert.equal(exactScope.descendantGoals, 1);
  assert.equal(exactScope.subtreeCommand, "tangent goal list otto/test --subtree");
  assert.ok(!exactScope.goals.some((goal) => goal.slug === "nested-work"), "the exact scope stays exact");
  const subtreeScope = await fetch(`${base}/api/goals?area=otto%2Ftest&subtree=1`).then((response) => response.json());
  assert.equal(subtreeScope.scope, "subtree");
  assert.ok(subtreeScope.goals.some((goal) => goal.slug === "nested-work"), "the subtree scope reaches child Areas");
  assert.equal(subtreeScope.subtreeCommand, undefined, "a subtree listing does not point at itself");

  // Area messages enter the durable inbox. A retry uses the same receipt and
  // does not change the Area note.
  const messageBody = { to: "otto/test", text: "Neil owns the loading work until Friday.", from: "Agent Shell", idempotencyKey: "area-message-http-1" };
  const sent = await fetch(`${base}/api/agents/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(messageBody),
  }).then((response) => response.json());
  assert.equal(sent.status, "queued");
  assert.equal(sent.live, false);
  const retried = await fetch(`${base}/api/agents/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(messageBody),
  }).then((response) => response.json());
  assert.equal(retried.receipt, sent.receipt);
  const inbox = JSON.parse(await readFile(path.join(root, "brains", "otto", "test", "inbox.json"), "utf8"));
  assert.equal(inbox.notices.filter((notice) => notice.sourceId === messageBody.idempotencyKey).length, 1);
  assert.doesNotMatch(await readFile(path.join(areaDirectory, "test.md"), "utf8"), /Neil owns the loading work/);

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

  for (const [method, route] of [["GET", "/api/areas/" + "journal"], ["POST", "/api/areas/" + "journal"], ["GET", "/api/" + "ideas"], ["POST", "/api/" + "idea/new"], ["POST", "/api/" + "command"]]) {
    const response = await fetch(`${base}${route}`, { method, ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) });
    assert.equal(response.status, 404, `${method} ${route} is not routed`);
  }

  // ---- agent pipelines ----
  // A registry with an effort axis; step launches resolve through it.
  await writeFile(path.join(trees, "harnesses.md"), "# Harnesses\n\n```tangent.harnesses.v1\n" + JSON.stringify({
    version: 1,
    modelSets: { fake: [{ id: "one", label: "One", args: "--model one" }] },
    effortSets: { fake: [{ id: "high", label: "High", args: "--effort high" }] },
    harnesses: [
      { id: "fake", label: "Fake", command: "fake-agent", modelSet: "fake", effortSet: "fake" },
      { id: "other", label: "Other", command: "other-agent" },
    ],
  }, null, 2) + "\n```\n", "utf8");
  const options = await fetch(`${base}/api/launch/options?area=otto%2Ftest`).then((response) => response.json());
  assert.deepEqual(options.harnesses[0].efforts, [{ id: "high", label: "High", args: "--effort high", command: "fake-agent --effort high" }]);
  assert.match(serverSource, /## Your step/);
  assert.match(serverSource, /## When you finish/);
  assert.match(serverSource, /tangent send \$\{organizerArea\} "<note>"/);
  assert.doesNotMatch(serverSource, /tangent send brain|--done means/);
  assert.doesNotMatch(serverSource, /tangent goal handover/, "worker prompts use the one send command");
  assert.match(serverSource, /design-<slug>\.md/);
  assert.match(serverSource, /name: "material Operation events"/, "material Operation delivery runs without a browser poll");
  assert.doesNotMatch(serverSource, /\b(?:newContinuationRecord|writeContinuation|soloExecution)\b/, "production has no retired solo writer");

  const brainStart = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", instruction: "Get the test Area done." }),
  }).then((response) => response.json());
  assert.equal(brainStart.session, "test-brain");
  openedSessions.push("test-brain");

  const pipelineGoal = await fetch(`${base}/api/goals/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", goal: { title: "Pipeline demo", doneWhen: "Three agents handed over." } }),
  }).then((response) => response.json());
  const badEffort = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: pipelineGoal.file, caller: brainStart.session, steps: [{ instruction: "design", launch: { harness: "fake", model: "one", effort: "ultra" } }] }),
  });
  assert.equal(badEffort.status, 409);
  assert.match((await badEffort.json()).error, /unknown effort "ultra"/);
  assert.equal(existsSync(path.join(root, "pipelines", "otto", "test", "pipeline-demo.json")), false);
  const badSteps = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: pipelineGoal.file, caller: brainStart.session, steps: [{ instruction: "  ", launch: { harness: "fake" } }] }),
  });
  assert.equal(badSteps.status, 400);

  const startedPipeline = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      file: pipelineGoal.file,
      caller: brainStart.session,
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
  // The worker default is the calling brain's own harness, and this brain
  // runs `fake`. Steps 1 and 2 named the same harness, so nothing warns.
  assert.equal(startedPipeline.warnings.length, 0, JSON.stringify(startedPipeline.warnings));
  assert.deepEqual(startedPipeline.launches.map((row) => [row.index, row.launch, row.source]), [
    [1, "fake/one/high", "explicit"],
    [2, "fake/one", "explicit"],
    [3, null, "explicit"],
  ], "the start response says what each assignment runs and where its harness came from");
  let goalText = await readFile(path.join(trees, pipelineGoal.file), "utf8");
  assert.match(goalText, /^status: active$/m);
  assert.match(goalText, /^session: test-pipeline-demo$/m);
  let snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  const stepOne = snapshot.sessions.find((session) => session.name === "test-pipeline-demo");
  assert.equal(stepOne.pipeline, pipelineGoal.file);
  assert.equal(stepOne.step, 1);
  assert.equal(stepOne.goal, pipelineGoal.file);
  const goalPipelines = snapshot.pipelines.filter((pipeline) => pipeline.goal === pipelineGoal.file);
  assert.equal(goalPipelines.length, 1, "one Goal has one authoritative queue");
  assert.equal(new Set(snapshot.pipelines.map((pipeline) => pipeline.goal)).size, snapshot.pipelines.length, "the snapshot never projects duplicate queues for a Goal");
  assert.equal(goalPipelines[0].status, "running");
  assert.equal(goalPipelines[0].steps[0].live, true);

  const overlappingAdvance = await fetch(`${base}/api/pipelines/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: pipelineGoal.file,
      action: "advance",
      step: 2,
      caller: brainStart.session,
      expectedRevision: startedPipeline.pipeline.revision,
      idempotencyKey: "overlapping-advance",
    }),
  });
  assert.equal(overlappingAdvance.status, 409, "one current assignment blocks a different pending assignment");
  assert.match((await overlappingAdvance.json()).error, /assignment 1 is current/);

  const ownedElsewhere = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: pipelineGoal.file, caller: brainStart.session, steps: [{ instruction: "again", launch: { harness: "fake" } }] }),
  });
  assert.equal(ownedElsewhere.status, 409);
  assert.match((await ownedElsewhere.json()).error, /already has an authoritative queue/);

  const strayHandover = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: described.session, text: "nothing" }),
  });
  assert.equal(strayHandover.status, 200, "a work-definition session can still hand over its durable discovery facts");
  // A typed worker report completes only its assignment. A local caller starts
  // each later assignment through the authoritative queue.
  const handoverOne = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session: "test-pipeline-demo",
      text: "Design written: design-pipeline-demo.md. Unresolved: none.",
      report: { type: "implementation-result", status: "complete", summary: "The design is ready.", evidenceRefs: ["design-pipeline-demo.md"] },
    }),
  }).then((response) => response.json());
  assert.equal(handoverOne.status, "reported");
  assert.equal(handoverOne.pipeline.steps[0].status, "complete");
  assert.deepEqual(handoverOne.next, { index: 2, session: null }, "a worker report identifies but never starts its successor");

  const directAdvance = await fetch(`${base}/api/pipelines/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: pipelineGoal.file, action: "advance", step: 2, expectedRevision: handoverOne.pipeline.revision, idempotencyKey: "workflow-advance-2" }),
  });
  assert.equal(directAdvance.status, 200, "Julian can directly advance normal work without impersonating its Area brain");
  const advanceTwo = await directAdvance.json();
  assert.equal(advanceTwo.status, "started");
  assert.equal(advanceTwo.next.index, 2);
  assert.equal(advanceTwo.next.session, "test-pipeline-demo");
  const repeatedAdvance = await fetch(`${base}/api/pipelines/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: pipelineGoal.file,
      action: "advance",
      step: 2,
      expectedRevision: handoverOne.pipeline.revision,
      idempotencyKey: "workflow-advance-2",
    }),
  }).then((response) => response.json());
  assert.equal(repeatedAdvance.status, "repeated", "an exact retry wins over its stale queue revision");

  const handoverTwo = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session: advanceTwo.next.session,
      text: "Design reviewed and updated in place.",
      report: { type: "implementation-result", status: "complete", summary: "The reviewed design is ready.", evidenceRefs: ["design-pipeline-demo.md"] },
    }),
  }).then((response) => response.json());
  assert.equal(handoverTwo.status, "reported");
  assert.deepEqual(handoverTwo.next, { index: 3, session: null });

  const advanceThree = await fetch(`${base}/api/pipelines/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: pipelineGoal.file,
      action: "advance",
      step: 3,
      caller: brainStart.session,
      expectedRevision: handoverTwo.pipeline.revision,
      idempotencyKey: "workflow-advance-3",
    }),
  }).then((response) => response.json());
  assert.equal(advanceThree.status, "started");
  assert.equal(advanceThree.next.index, 3);
  openedSessions.push(advanceThree.next.session);

  const appended = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: pipelineGoal.file,
      caller: brainStart.session,
      steps: [{ instruction: "Review the implementation against the done condition.", kind: "review", launch: { harness: "fake", model: "one" } }],
    }),
  }).then((response) => response.json());
  assert.equal(appended.status, "queued");
  assert.deepEqual(appended.added, [4]);
  assert.equal(appended.pipeline.steps[3].kind, "review");

  const handoverThree = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session: advanceThree.next.session,
      text: "Implementation complete.",
      report: { type: "implementation-result", status: "complete", summary: "The implementation is complete.", evidenceRefs: ["commit:workflow"] },
    }),
  }).then((response) => response.json());
  assert.equal(handoverThree.status, "reported");

  const advanceFour = await fetch(`${base}/api/pipelines/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: pipelineGoal.file,
      action: "advance",
      step: 4,
      caller: brainStart.session,
      expectedRevision: handoverThree.pipeline.revision,
      idempotencyKey: "workflow-advance-4",
    }),
  }).then((response) => response.json());
  assert.equal(advanceFour.status, "started");
  openedSessions.push(advanceFour.next.session);

  const evidenceFreeReview = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session: advanceFour.next.session,
      text: "Review claimed a pass without proof.",
      idempotencyKey: "review-without-proof",
      report: {
        type: "review-result",
        verdict: "passed",
        goalRevision: advanceFour.pipeline.goalRevision,
        summary: "Claimed pass.",
        criteria: [{ id: "done-condition", passed: true, evidenceRefs: [] }],
      },
    }),
  });
  assert.equal(evidenceFreeReview.status, 409, "complete review criteria require evidence");

  const handoverFour = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session: advanceFour.next.session,
      text: "Review passed.",
      report: {
        type: "review-result",
        verdict: "passed",
        goalRevision: advanceFour.pipeline.goalRevision,
        summary: "The current Goal revision satisfies its done condition.",
        criteria: [{ id: "done-condition", passed: true, evidenceRefs: ["test:workflow"] }],
      },
    }),
  }).then((response) => response.json());
  assert.equal(handoverFour.status, "reported", "no report closes a Goal: the brain marks it done (ADR-0041)");
  const repeatedReview = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session: advanceFour.next.session,
      text: "Review passed.",
      report: {
        type: "review-result",
        verdict: "passed",
        goalRevision: advanceFour.pipeline.goalRevision,
        summary: "The current Goal revision satisfies its done condition.",
        criteria: [{ id: "done-condition", passed: true, evidenceRefs: ["test:workflow"] }],
      },
    }),
  }).then((response) => response.json());
  assert.equal(repeatedReview.status, "repeated", "an exact retry is the same submission");
  goalText = await readFile(path.join(trees, pipelineGoal.file), "utf8");
  assert.doesNotMatch(goalText, /^status: done$/m, "a passing review leaves the Goal for the brain to close");
  const closedByWord = await fetch(`${base}/api/goals/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: pipelineGoal.file, status: "done" }),
  }).then((response) => response.json());
  assert.equal(closedByWord.ok, true);
  goalText = await readFile(path.join(trees, pipelineGoal.file), "utf8");
  assert.match(goalText, /^status: done$/m);
  // ---- Area brain ----
  // Julian starts one brain on the Area; it is a session of kind brain with a
  // record under the brains root, and every Goal prompt on the Area names it.
  // Tangent generates no brain prompt (ADR-0041): the first message is
  // Julian's own words, and the Area note chain is the instruction.
  assert.doesNotMatch(serverSource, /async function brainPrompt\(|composeBrainPrompt\(|designatedReview|completionPolicy/);
  assert.match(serverSource, /function brainFirstMessage\(/);
  assert.doesNotMatch(serverSource, /Sonnet is the workhorse/);
  const brainDefault = await fetch(`${base}/api/launch/default`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", kind: "brain", mode: "launch", launch: { harness: "fake", model: "one", effort: "high" } }),
  });
  assert.equal(brainDefault.status, 200);
  assert.equal(brainStart.session, "test-brain");
  assert.equal(brainStart.generation, 1);
  assert.equal(brainStart.brain.resolvedLaunch.command, "fake-agent --model one");
  assert.equal(brainStart.brain.planFile, "otto/test/plan-test.md");
  assert.ok(existsSync(path.join(root, "brains", "otto", "test", "brain.json")));
  snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  const brainSession = snapshot.sessions.find((session) => session.name === "test-brain");
  assert.equal(brainSession.kind, "brain");
  assert.equal(brainSession.brain, "otto/test");
  assert.equal(brainSession.generation, 1);
  assert.equal(snapshot.brains.length, 1);
  assert.equal(snapshot.brains[0].live, true);
  assert.equal(snapshot.brains[0].status, "active");
  const brainAgain = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", instruction: "Something else." }),
  }).then((response) => response.json());
  assert.equal(brainAgain.reattached, true);
  assert.equal(brainAgain.session, "test-brain");
  const brainShow = await fetch(`${base}/api/brains/show?session=test-brain`).then((response) => response.json());
  assert.equal(brainShow.brain.area, "otto/test");
  // The brain's first message is Julian's founding message, verbatim, with
  // the notices that waited for it below.
  assert.match(brainShow.prompt, /^Get the test Area done\./);
  assert.doesNotMatch(brainShow.prompt, /## Identity|## Resources|declares the work harness/, "no generated prompt section");
  assert.equal((await fetch(`${base}/api/brains/show?area=otto%2Fnowhere`)).status, 404);
  const brainRequest = await fetch(`${base}/api/brains/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "test-brain", kind: "decision", subject: "Live choice", question: "Approve this choice?", proposal: "Use the live choice." }),
  }).then((response) => response.json());
  assert.equal(brainRequest.request.ownerRef.generation, null, "the Request belongs to the logical Area brain");
  const briefUnderBrain = await fetch(`${base}/api/goals/brief?file=${encodeURIComponent(pipelineGoal.file)}`).then((response) => response.json());
  assert.doesNotMatch(briefUnderBrain.markdown, /## Brain/, "the worker prompt has no permissions paragraph");
  assert.match(briefUnderBrain.markdown, /## When you finish\n\nYou have one Tangent command/);
  // A queue event on the Area is queued to the brain as a message from tangent.
  const eventGoal = await fetch(`${base}/api/goals/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", goal: { title: "Event demo", doneWhen: "The event reaches the brain." } }),
  }).then((response) => response.json());
  const eventPipeline = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: eventGoal.file, caller: brainStart.session, steps: [{ instruction: "One more.", launch: { harness: "fake" } }] }),
  }).then((response) => response.json());
  assert.ok(eventPipeline.session);
  openedSessions.push(eventPipeline.session);
  const eventHandover = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: eventPipeline.session, text: "One more done." }),
  }).then((response) => response.json());
  assert.equal(eventHandover.status, "noted", "plain text from a worker is a note");
  const messageLog = (await readFile(path.join(root, "messages.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const brainEvent = messageLog.find((entry) => entry.to === "test-brain" && entry.from === "tangent" && /^note: One more done\./.test(entry.text));
  assert.ok(brainEvent, "the brain hears the worker's note");
  assert.match(brainEvent.text, /One more done\./);
  const correctedEventHandover = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session: eventPipeline.session,
      text: "One more done with a typed result.",
      report: { type: "implementation-result", status: "complete", summary: "One more done.", evidenceRefs: ["event"] },
    }),
  }).then((response) => response.json());
  assert.equal(correctedEventHandover.status, "reported", "the same worker can follow a note with a typed result");
  assert.equal(correctedEventHandover.pipeline.status, "complete");
  const appendedReview = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: eventGoal.file,
      caller: brainStart.session,
      expectedRevision: correctedEventHandover.pipeline.revision,
      idempotencyKey: "append-review-after-complete",
      steps: [{ instruction: "Review the current Goal revision.", kind: "review", launch: { harness: "fake" } }],
    }),
  }).then((response) => response.json());
  assert.equal(appendedReview.status, "queued", "a finished queue never starts an appended assignment itself");
  assert.equal(appendedReview.pipeline.steps[0].status, "complete", "append does not revive the finished worker");
  assert.equal(appendedReview.pipeline.steps[1].status, "pending");
  assert.equal(appendedReview.pipeline.steps[1].kind, "review");
  assert.equal(appendedReview.pipeline.steps[1].kind, "review");
  assert.equal(appendedReview.pipeline.currentAssignmentId, null);
  // There is no brain handover (ADR-0041): the route is gone, and Julian's
  // Restart is a stop followed by a start with his message.
  const noHandover = await fetch(`${base}/api/brains/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "test-brain", text: "facts" }),
  });
  assert.equal(noHandover.status, 404);
  const brainStopped = await fetch(`${base}/api/brains/stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", expectedAttemptId: "test-brain", operationId: "workflow-restart" }),
  }).then((response) => response.json());
  assert.equal(brainStopped.state, "stopped", JSON.stringify(brainStopped));
  const brainRestart = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", resume: true, instruction: "Wave 1 dispatched: pipeline-demo runs step 9. Next: wait for it." }),
  }).then((response) => response.json());
  assert.equal(brainRestart.session, "test-brain-g2");
  assert.equal(brainRestart.generation, 2);
  const restartedBrain = await fetch(`${base}/api/brains/show?session=test-brain-g2`).then((response) => response.json());
  assert.deepEqual(restartedBrain.brain.resolvedLaunch.ref, { harness: "fake", model: "one", effort: "high" });
  assert.equal(restartedBrain.brain.resolvedLaunch.command, "fake-agent --model one --effort high", "a restart resolves the current Area Brain configuration for the new attempt");
  assert.match(restartedBrain.prompt, /^Wave 1 dispatched: pipeline-demo runs step 9\. Next: wait for it\./, "Julian's message is the first message");
  openedSessions.push("test-brain-g2");
  snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(snapshot.sessions.some((session) => session.name === "test-brain"), false, "the stopped attempt is gone");
  assert.equal(snapshot.brains[0].session, "test-brain-g2");
  assert.equal(snapshot.brains[0].generation, 2);
  assert.equal(snapshot.brains[0].status, "active");
  assert.equal(snapshot.brains[0].latestHandover, null, "nothing writes a handover any more");
  let durableRequests = JSON.parse(await readFile(path.join(root, "brains", "otto", "test", "requests.json"), "utf8")).requests;
  assert.deepEqual(durableRequests[0].ownerRef, { type: "brain", area: "otto/test", generation: null }, "the Request belongs to the logical Area brain");
  assert.deepEqual(durableRequests[0].subjectRef, { type: "brain", area: "otto/test", generation: null });
  // Stop agent on the brain ends it; Resume starts generation 3 from the record.
  const brainKilled = await fetch(`${base}/api/kill/${encodeURIComponent("test-brain-g2")}`, { method: "POST" }).then((response) => response.json());
  assert.equal(brainKilled.brainEnded, true);
  snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(snapshot.brains[0].status, "inactive");
  assert.equal(snapshot.brains[0].live, false);
  durableRequests = JSON.parse(await readFile(path.join(root, "brains", "otto", "test", "requests.json"), "utf8")).requests;
  assert.deepEqual([durableRequests[0].status, durableRequests[0].closedReason], ["closed", "brain-ended"], "explicit brain end closes its open Requests");
  const briefWithoutBrain = await fetch(`${base}/api/goals/brief?file=${encodeURIComponent(pipelineGoal.file)}`).then((response) => response.json());
  assert.doesNotMatch(briefWithoutBrain.markdown, /## Brain/);
  const brainResume = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", resume: true, instruction: "Take the test Area back up." }),
  }).then((response) => response.json());
  assert.equal(brainResume.session, "test-brain-g3");
  assert.equal(brainResume.generation, 3);
  openedSessions.push("test-brain-g3");
  assert.equal(brainResume.brain.foundingInstruction.text, "Get the test Area done.");
  assert.deepEqual(brainResume.brain.resolvedLaunch.ref, { harness: "fake", model: "one", effort: "high" });
  assert.equal(brainResume.brain.resolvedLaunch.command, "fake-agent --model one --effort high");

  const resumedRequest = await fetch(`${base}/api/brains/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "test-brain-g3", kind: "approval", subject: "Resumed choice", question: "Approve resumed choice?", proposal: "Use the resumed choice." }),
  }).then((response) => response.json());
  assert.equal(resumedRequest.request.ownerRef.generation, null, "resume creates Requests under the logical Area brain");

  await new Promise((resolve, reject) => execFile("tmux", ["kill-session", "-t", "=test-brain-g3"], (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve())));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    snapshot = await fetch(`${base}/api/sessions`).then((response) => response.json());
    if (snapshot.brains[0].health?.status === "recovering") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(snapshot.brains[0].status, "active");
  assert.ok(["recovering", "healthy"].includes(snapshot.brains[0].health.status), "automatic recovery can finish before this poll observes it");
  const brainReplacement = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", resume: true }),
  }).then((response) => response.json());
  assert.equal(brainReplacement.session, "test-brain-g4");
  openedSessions.push(brainReplacement.session);
  durableRequests = JSON.parse(await readFile(path.join(root, "brains", "otto", "test", "requests.json"), "utf8")).requests;
  assert.equal(durableRequests[1].status, "open", "a runtime replacement keeps the logical Area brain's Request open");

  const replacementRequest = await fetch(`${base}/api/brains/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: brainReplacement.session, kind: "decision", subject: "Surviving choice", question: "Approve surviving choice?", proposal: "Keep this choice open." }),
  }).then((response) => response.json());
  assert.equal(replacementRequest.request.status, "open", "a Request for the live replacement remains open");

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
