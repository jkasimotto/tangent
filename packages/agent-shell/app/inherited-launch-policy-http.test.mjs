import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startBrainCaller, startShellServer } from "./focus-shell-http-fixture.mjs";
import { areaHarnessContractText, parseAreaHarnessContract } from "./launch-environment.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const launch = { harness: "claude", model: "fable-5" };
const registry = {
  version: 2,
  modelSets: { claude: [{ id: "fable-5", label: "Fable 5", effortSet: "claude" }] },
  effortSets: { claude: [{ id: "low", label: "Low" }, { id: "high", label: "High" }] },
  harnesses: [{ id: "claude", label: "Claude", command: "sleep 300", modelSet: "claude" }],
};

/** Writes one current inherited harness contract. */
async function writeContract(trees, area, allow = []) {
  await writeFile(path.join(trees, area, "harnesses.md"), areaHarnessContractText({ allow, registry }), "utf8");
}

/** Sends one JSON request and returns its status with the parsed body. */
async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("Standards and CLI start claude/fable-5 through empty current child contracts", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inherited-launch-policy-http-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const areas = ["neara", "neara/delivery", "neara/delivery/standards", "neara/delivery/cli"];
  for (const area of areas) await mkdir(path.join(trees, area), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), `# Harnesses\n\n\`\`\`tangent.harnesses.v2\n${JSON.stringify(registry)}\n\`\`\`\n`, "utf8");
  for (const area of areas) {
    const name = area.split("/").at(-1);
    await writeFile(path.join(trees, area, `${name}.md`), `---\ntype: area\n---\n\n# ${name}\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  }
  await writeContract(trees, "neara", ["claude"]);
  await writeContract(trees, "neara/delivery");
  await writeContract(trees, "neara/delivery/standards");
  await writeContract(trees, "neara/delivery/cli");
  for (const area of ["neara/delivery/standards", "neara/delivery/cli"]) {
    const name = area.split("/").at(-1);
    await writeFile(
      path.join(trees, area, `goal-${name}-launch.md`),
      `---\ntype: goal\nstatus: open\ndone_when: ${name} starts the inherited launch.\nsession:\n---\n\n# ${name} launch\n\n## State\n\nNot started.\n`,
      "utf8",
    );
  }
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "commit", "-q", "-m", "add: inherited launch fixture"]);

  const openedSessions = [];
  const base = await startShellServer(context, {
    here,
    root,
    trees,
    workspace,
    openedSessions,
    env: { TANGENT_RECONCILE_INTERVAL_MS: "600000" },
  });
  if (!base) return;

  for (const area of ["neara/delivery/standards", "neara/delivery/cli"]) {
    const options = await fetch(`${base}/api/launch/options?area=${encodeURIComponent(area)}&kind=all`).then((response) => response.json());
    assert.equal(options.policy.health, "valid");
    assert.deepEqual(options.policy.declaredBy, ["neara"]);
    const brain = await startBrainCaller(base, { area, choice: launch, openedSessions });
    const name = area.split("/").at(-1);
    const started = await post(base, "/api/goals/start", {
      caller: brain,
      file: `${area}/goal-${name}-launch.md`,
      steps: [{ instruction: `Start ${name}.`, launch }],
    });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    openedSessions.push(started.body.session);
    assert.equal(started.body.launches[0].launch, "claude/fable-5");
    assert.equal(started.body.launches[0].command, "sleep 300");
    const contract = parseAreaHarnessContract(await readFile(path.join(trees, area, "harnesses.md"), "utf8"), registry);
    assert.deepEqual(contract.allow, [], "the valid current child contract needs no migration or rewrite");
  }
});
