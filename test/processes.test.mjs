import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  controlProcess,
  parseProcessManifest,
  processSessionName,
  resolveProcessDefinitions,
  resolveProcessNode
} from "../dist/cli/processes.js";

test("process manifests validate their deliberately small schema", () => {
  assert.deepEqual(parseProcessManifest('{"scripts":{"dev":"npm run dev"}}', "/node/.processes.json"), {
    scripts: { dev: "npm run dev" }
  });
  assert.throws(() => parseProcessManifest("{", "/bad"), /invalid JSON/);
  assert.throws(() => parseProcessManifest('{"scripts":{"Bad name":"x"}}', "/bad"), /invalid process name/);
  assert.throws(() => parseProcessManifest('{"scripts":{"dev":""}}', "/bad"), /non-empty string/);
  assert.throws(() => parseProcessManifest('{"scripts":{},"cwd":"x"}', "/bad"), /only "scripts"/);
});

test("descendants inherit definitions and the nearest noun node wins", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-processes-"));
  const repoA = path.join(root, "repo-a");
  const repoB = path.join(root, "repo-b");
  try {
    await mkdir(path.join(root, "otto", "tangent", "shell"), { recursive: true });
    await mkdir(repoA);
    await mkdir(repoB);
    await writeNode(root, "otto", repoA, { dev: "root-dev", shared: "root-shared" });
    await writeNode(root, "otto/tangent", repoB, { dev: "tangent-dev" });

    const definitions = await resolveProcessDefinitions("otto/tangent/shell", root);
    assert.deepEqual([...definitions.keys()], ["dev", "shared"]);
    assert.deepEqual(definitions.get("dev"), {
      name: "dev",
      command: "tangent-dev",
      node: "otto/tangent",
      cwd: repoB,
      manifest: path.join(root, "otto", "tangent", ".processes.json")
    });
    assert.equal(definitions.get("shared").node, "otto");
    assert.equal(definitions.get("shared").cwd, repoA);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("process sessions are stable and namespaced by defining node", () => {
  const a = processSessionName({ node: "otto/tangent", name: "dev" });
  assert.equal(a, processSessionName({ node: "otto/tangent", name: "dev" }));
  assert.notEqual(a, processSessionName({ node: "neara/tangent", name: "dev" }));
  assert.match(a, /^process-tangent--dev-[a-f0-9]{8}$/);
});

test("start creates a metadata-bound tmux shell and submits the literal command", async () => {
  const runner = recordingRunner([""]);
  const definition = def();
  const message = await controlProcess("start", definition, runner);
  const session = processSessionName(definition);
  assert.match(message, /started dev on otto\/tangent/);
  assert.deepEqual(runner.calls, [
    ["tmux", ["list-sessions", "-F", "#{session_name}\t#{pane_current_command}"]],
    ["tmux", ["new-session", "-d", "-s", session, "-c", "/repo"]],
    ["tmux", ["set-option", "-t", session, "@tangent_kind", "process"]],
    ["tmux", ["set-option", "-t", session, "@tangent_node", "otto/tangent"]],
    ["tmux", ["set-option", "-t", session, "@tangent_process", "dev"]],
    ["tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", "npm run dev && echo '$HOME'"]],
    ["tmux", ["send-keys", "-t", `=${session}:`, "Enter"]]
  ]);
});

test("start reuses running sessions and reruns stopped sessions", async () => {
  const definition = def();
  const session = processSessionName(definition);
  const live = recordingRunner([`${session}\tnode\n`]);
  assert.match(await controlProcess("start", definition, live), /already running/);
  assert.equal(live.calls.length, 1);

  const stopped = recordingRunner([`${session}\tzsh\n`]);
  assert.match(await controlProcess("start", definition, stopped), /started dev/);
  assert.deepEqual(stopped.calls.slice(1), [
    ["tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", definition.command]],
    ["tmux", ["send-keys", "-t", `=${session}:`, "Enter"]]
  ]);
});

test("stop and close target only the exact managed session", async () => {
  const definition = def();
  const session = processSessionName(definition);
  const stop = recordingRunner([`${session}\tnode\n`]);
  await controlProcess("stop", definition, stop);
  assert.deepEqual(stop.calls.at(-1), ["tmux", ["send-keys", "-t", `=${session}:`, "C-c"]]);

  const close = recordingRunner([`${session}\tzsh\n`]);
  await controlProcess("close", definition, close);
  assert.deepEqual(close.calls.at(-1), ["tmux", ["kill-session", "-t", `=${session}`]]);
});

test("the bound tmux node is authoritative unless --node is explicit", async () => {
  const runner = recordingRunner(["otto/tangent\n"]);
  const previous = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    assert.equal(await resolveProcessNode(undefined, runner), "otto/tangent");
    assert.equal(await resolveProcessNode("neara/pgande", runner), "neara/pgande");
    assert.equal(runner.calls.length, 1);
  } finally {
    if (previous === undefined) delete process.env.TMUX;
    else process.env.TMUX = previous;
  }
});

async function writeNode(root, node, repo, scripts) {
  const dir = path.join(root, node);
  await mkdir(dir, { recursive: true });
  const base = node.split("/").pop();
  await writeFile(path.join(dir, `${base}.md`), `---\ntype: work\nstatus: active\n---\n\n# ${base}\n\n## Resources\n\n- Repository: ${repo}\n`);
  await writeFile(path.join(dir, ".processes.json"), JSON.stringify({ scripts }));
}

function def() {
  return {
    name: "dev",
    command: "npm run dev && echo '$HOME'",
    node: "otto/tangent",
    cwd: "/repo",
    manifest: "/trees/otto/tangent/.processes.json"
  };
}

function recordingRunner(outputs) {
  let index = 0;
  return {
    calls: [],
    async run(command, args) {
      this.calls.push([command, args]);
      return { stdout: outputs[index++] ?? "" };
    }
  };
}
