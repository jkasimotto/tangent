import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { endBrain, newBrain, writeBrain } from "./brain-record.mjs";
import { startShellServer } from "./focus-shell-http-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Posts one Describe work request. */
function describe(base, body) {
  return fetch(`${base}/api/work/describe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ launch: false, ...body }),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

test("Describe work reaches stopped, live, or stale Area brains and never opens a work-definition session", async (context) => {
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
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { sessions: {}, commands: [] };
state.commands.push(args);
const value = (flag) => args[args.indexOf(flag) + 1];
const save = () => fs.writeFileSync(file, JSON.stringify(state));
if (args[0] === "new-session") state.sessions[value("-s")] = { name: value("-s"), cwd: value("-c"), options: {} };
else if (args[0] === "set-option") {
  const session = state.sessions[String(value("-t")).replace(/^=/, "")];
  if (session) session.options[args[args.indexOf("-t") + 2]] = args[args.indexOf("-t") + 3] ?? "";
} else if (args[0] === "has-session") {
  if (!state.sessions[String(value("-t")).replace(/^=/, "")]) process.exitCode = 1;
} else if (args[0] === "kill-session") delete state.sessions[String(value("-t")).replace(/^=/, "")];
else if (args[0] === "list-sessions") {
  const format = value("-F") ?? "#{session_name}";
  for (const session of Object.values(state.sessions)) {
    const fields = { session_name: session.name, session_path: session.cwd, session_windows: "1", session_attached: "0", session_created: "1", pane_current_command: "zsh" };
    const line = format.replace(/#\{([^}]+)\}/g, (_, key) => key.startsWith("@") ? (session.options[key] ?? "") : (fields[key] ?? ""));
    process.stdout.write(line + "\\n");
  }
}
save();
`, "utf8");
  await chmod(path.join(fakeBin, "tmux"), 0o755);
  for (const area of ["otto/tangent/child", "otto/plain"]) await mkdir(path.join(trees, area), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(trees, "otto", "tangent", "tangent.md"), `---\ntype: area\n---\n\n# Tangent\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  await writeFile(path.join(trees, "otto", "tangent", "child", "child.md"), "---\ntype: area\n---\n\n# Child\n", "utf8");
  await writeFile(path.join(trees, "otto", "plain", "plain.md"), `---\ntype: area\n---\n\n# Plain\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
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
    area: "otto/tangent/child",
    description: "Route this exact description to the controlling brain.",
    sources: ["otto/tangent/design-context.md"],
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.route, "brain-resumed");
  assert.equal(resumed.body.brainArea, "otto/tangent");
  const tmuxAfterResume = JSON.parse(await readFile(fakeTmuxState, "utf8"));
  assert.equal(tmuxAfterResume.sessions[resumed.body.session].options["@tangent_kind"], "brain");
  assert.equal(Object.values(tmuxAfterResume.sessions).some((session) => session.options["@tangent_kind"] === "work-definition"), false);
  const inbox = JSON.parse(await readFile(path.join(brains, "otto", "tangent", "child", "inbox.json"), "utf8"));
  assert.match(inbox.notices[0].text, /Route this exact description to the controlling brain\./);
  assert.match(inbox.notices[0].text, /otto\/tangent\/design-context\.md/);

  const live = await describe(base, { area: "otto/tangent", description: "Deliver this while the brain is live." });
  assert.equal(live.status, 200);
  assert.equal(live.body.route, "brain-opened");
  assert.equal(live.body.session, resumed.body.session);

  const staleTmux = JSON.parse(await readFile(fakeTmuxState, "utf8"));
  delete staleTmux.sessions[live.body.session];
  await writeFile(fakeTmuxState, JSON.stringify(staleTmux), "utf8");
  const started = await describe(base, { area: "otto/tangent/child", description: "Restart the stale recorded brain." });
  assert.equal(started.status, 200);
  assert.equal(started.body.route, "brain-started");
  assert.notEqual(started.body.session, live.body.session);
  const tmuxAfterStart = JSON.parse(await readFile(fakeTmuxState, "utf8"));
  assert.equal(tmuxAfterStart.sessions[started.body.session].options["@tangent_kind"], "brain");
  assert.equal(Object.values(tmuxAfterStart.sessions).some((session) => session.options["@tangent_kind"] === "work-definition"), false);

  const plain = await describe(base, { area: "otto/plain", description: "Keep the existing behavior here." });
  assert.equal(plain.status, 200);
  assert.equal(plain.body.route, "work-definition-opened");
  const tmuxAfterPlain = JSON.parse(await readFile(fakeTmuxState, "utf8"));
  assert.equal(tmuxAfterPlain.sessions[plain.body.session].options["@tangent_kind"], "work-definition");
});
