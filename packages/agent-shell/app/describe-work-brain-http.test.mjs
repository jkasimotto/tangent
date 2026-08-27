import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { endBrain, newBrain, readBrain, writeBrain } from "./brain-record.mjs";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));

/** Posts one Describe work request. */
function describe(base, body) {
  return fetch(`${base}/api/work/describe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ launch: false, ...body }),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

test("Describe work reaches inactive, live, or recovering exact-Area brains", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "describe-work-brain-"));
  const trees = path.join(root, "trees");
  const brains = path.join(root, "brains");
  const workspace = path.join(root, "workspace");
  const fakeBin = path.join(root, "bin");
  const fakeTmuxState = path.join(root, "fake-tmux.json");
  await mkdir(fakeBin, { recursive: true });
  await writeFile(path.join(fakeBin, "tmux"), `#!/usr/bin/env node
const fs = require("node:fs");
const file = process.env.FAKE_TMUX_STATE;
const args = process.argv.slice(2);
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { sessions: {}, commands: [], nextId: 1 };
state.nextId ??= Object.keys(state.sessions).length + 1;
state.commands.push(args);
const value = (flag) => args[args.indexOf(flag) + 1];
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const cleanTarget = (target) => String(target ?? "").replace(/^=/, "").replace(/:$/, "");
const sessionFor = (target) => Object.values(state.sessions).find((session) => session.name === cleanTarget(target) || session.id === cleanTarget(target));
const formatSession = (session, format) => format.replace(/#\{([^}]+)\}/g, (_, key) => key.startsWith("@") ? (session.options[key] ?? "") : ({ session_id: session.id, session_name: session.name, session_path: session.cwd, session_windows: "1", session_attached: "0", session_created: "1", pane_current_command: "zsh" }[key] ?? ""));
if (args[0] === "new-session") {
  const name = value("-s");
  const session = { id: "$" + state.nextId++, name, cwd: value("-c"), options: {} };
  state.sessions[name] = session;
  if (args.includes("-P")) process.stdout.write(formatSession(session, value("-F") ?? "#{session_id}") + "\\n");
}
else if (args[0] === "set-option") {
  const session = sessionFor(value("-t"));
  if (session) session.options[args[args.indexOf("-t") + 2]] = args[args.indexOf("-t") + 3] ?? "";
} else if (args[0] === "has-session") {
  if (!sessionFor(value("-t"))) { process.stderr.write("can't find session\\n"); process.exitCode = 1; }
} else if (args[0] === "display-message") {
  const session = sessionFor(value("-t"));
  if (!session) { process.stderr.write("can't find session\\n"); process.exitCode = 1; }
  else process.stdout.write(formatSession(session, args.at(-1)) + "\\n");
} else if (args[0] === "kill-session") {
  const session = sessionFor(value("-t"));
  if (session) delete state.sessions[session.name];
}
else if (args[0] === "list-sessions") {
  const format = value("-F") ?? "#{session_name}";
  for (const session of Object.values(state.sessions)) process.stdout.write(formatSession(session, format) + "\\n");
}
save();
`, "utf8");
  await chmod(path.join(fakeBin, "tmux"), 0o755);
  for (const area of ["otto/tangent/child", "otto/plain"]) await mkdir(path.join(trees, area), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(trees, "otto", "tangent", "tangent.md"), `---\ntype: area\n---\n\n# Tangent\n\n## Resources\n\n- Repository: ${workspace}\n\n\`\`\`tangent.environment.v1\n{"defaults":{"brain":{"harness":"codex","model":"sol"}}}\n\`\`\`\n`, "utf8");
  await writeFile(path.join(trees, "otto", "tangent", "child", "child.md"), "---\ntype: area\n---\n\n# Child\n", "utf8");
  await writeFile(path.join(trees, "otto", "plain", "plain.md"), `---\ntype: area\n---\n\n# Plain\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  await writeFile(path.join(trees, "harnesses.md"), [
    "```tangent.harnesses.v1",
    JSON.stringify({ version: 1, modelSets: { claude: [{ id: "fable", label: "Fable", args: "--model fable" }], codex: [{ id: "sol", label: "Sol", args: "--model sol" }] }, harnesses: [{ id: "claude", label: "Claude", command: "claude", modelSet: "claude" }, { id: "codex", label: "Codex", command: "codex", modelSet: "codex" }] }),
    "```",
  ].join("\n"), "utf8");
  await writeFile(path.join(trees, "otto", "tangent", "design-context.md"), "---\ntype: document\n---\n\n# Context\n", "utf8");
  const record = endBrain(newBrain({
    area: "otto/tangent",
    instruction: "Run Tangent work.",
    command: "claude",
    planFile: "otto/tangent/plan-tangent.md",
  }), "stopped");
  await writeBrain(brains, record);

  const base = await startShellServer(context, {
    here, root, trees, workspace,
    env: { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, FAKE_TMUX_STATE: fakeTmuxState },
  });
  if (!base) return;

  const resumed = await describe(base, {
    area: "otto/tangent",
    description: "Route this exact description to the controlling brain.",
    sources: ["otto/tangent/design-context.md"],
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.route, "brain-resumed");
  assert.equal(resumed.body.brainArea, "otto/tangent");
  const tmuxAfterResume = JSON.parse(await readFile(fakeTmuxState, "utf8"));
  assert.equal(tmuxAfterResume.sessions[resumed.body.session].options["@tangent_kind"], "brain");
  assert.equal(tmuxAfterResume.sessions[resumed.body.session].options["@tangent_launch"], "Codex · Sol");
  assert.equal(resumed.body.launchLabel, "Codex · Sol");
  const resumedRecord = await readBrain(brains, "otto/tangent");
  assert.deepEqual(resumedRecord.generations.at(-1).resolvedLaunch.ref, { harness: "codex", model: "sol", effort: null });
  assert.equal(resumedRecord.generations.at(-1).resolvedLaunch.command, "codex --model sol");
  assert.equal(Object.values(tmuxAfterResume.sessions).some((session) => session.options["@tangent_kind"] === "work-definition"), false);
  const inbox = JSON.parse(await readFile(path.join(brains, "otto", "tangent", "inbox.json"), "utf8"));
  assert.match(inbox.notices[0].text, /Route this exact description to the controlling brain\./);
  assert.match(inbox.notices[0].text, /otto\/tangent\/design-context\.md/);

  const child = await describe(base, {
    area: "otto/tangent/child",
    description: "Define child work without borrowing parent authority.",
  });
  assert.equal(child.status, 200);
  assert.equal(child.body.route, "work-definition-opened", "a parent brain never controls a child Area");

  const live = await describe(base, { area: "otto/tangent", description: "Deliver this while the brain is live." });
  assert.equal(live.status, 200);
  assert.equal(live.body.route, "brain-opened");
  assert.equal(live.body.session, resumed.body.session);

  const inboxBeforeConflict = JSON.parse(await readFile(path.join(brains, "otto", "tangent", "inbox.json"), "utf8"));
  const conflict = await describe(base, {
    area: "otto/tangent",
    description: "Keep this draft when the brain became live.",
  });
  assert.equal(conflict.status, 200);
  assert.equal(conflict.body.route, "brain-opened");
  const inboxAfterConflict = JSON.parse(await readFile(path.join(brains, "otto", "tangent", "inbox.json"), "utf8"));
  assert.equal(inboxAfterConflict.notices.length, inboxBeforeConflict.notices.length + 1);

  const staleTmux = JSON.parse(await readFile(fakeTmuxState, "utf8"));
  delete staleTmux.sessions[live.body.session];
  await writeFile(fakeTmuxState, JSON.stringify(staleTmux), "utf8");
  const started = await describe(base, {
    area: "otto/tangent",
    description: "Restart the stale recorded brain.",
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.route, "brain-started");
  assert.notEqual(started.body.session, live.body.session);
  const tmuxAfterStart = JSON.parse(await readFile(fakeTmuxState, "utf8"));
  assert.equal(tmuxAfterStart.sessions[started.body.session].options["@tangent_kind"], "brain");
  assert.equal(tmuxAfterStart.sessions[started.body.session].options["@tangent_launch"], "Codex · Sol");
  assert.equal((await readBrain(brains, "otto/tangent")).generations.at(-1).resolvedLaunch.command, "codex --model sol");

  /** Starts the exact child brain through the public lifecycle route. */
  const startChild = () => fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/tangent/child", instruction: "Own child work." }),
  }).then((response) => response.json());
  const childStarts = await Promise.all([startChild(), startChild()]);
  assert.equal(childStarts[0].session, "child-brain");
  assert.equal(childStarts[1].session, "child-brain");
  assert.equal(childStarts.filter((result) => result.reattached).length, 1, "concurrent exact starts share one child brain");

  const childOwned = await describe(base, { area: "otto/tangent/child", description: "The nearest child brain owns this." });
  assert.equal(childOwned.status, 200);
  assert.equal(childOwned.body.brainArea, "otto/tangent/child");
  const staleChildTmux = JSON.parse(await readFile(fakeTmuxState, "utf8"));
  delete staleChildTmux.sessions["child-brain"];
  await writeFile(fakeTmuxState, JSON.stringify(staleChildTmux), "utf8");
  const childRecovered = await describe(base, { area: "otto/tangent/child", description: "The child brain recovers after process loss." });
  assert.equal(childRecovered.status, 200, JSON.stringify(childRecovered.body));
  assert.equal(childRecovered.body.brainArea, "otto/tangent/child", "parent authority never replaces exact child authority");

  const plain = await describe(base, {
    area: "otto/plain",
    description: "Keep the existing behavior here.",
    choice: { harness: "codex", model: "sol" },
  });
  assert.equal(plain.status, 200);
  assert.equal(plain.body.route, "work-definition-opened");
  const tmuxAfterPlain = JSON.parse(await readFile(fakeTmuxState, "utf8"));
  assert.equal(tmuxAfterPlain.sessions[plain.body.session].options["@tangent_kind"], "work-definition");
  assert.equal(tmuxAfterPlain.sessions[plain.body.session].options["@tangent_launch"], "Codex · Sol");
});
