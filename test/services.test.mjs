import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  controlService,
  parseServiceManifest,
  serviceSessionName,
  resolveServiceDefinitions,
  resolveServiceArea,
  runServiceCommand
} from "../dist/cli/services.js";

test("process manifests validate their deliberately small schema", () => {
  assert.deepEqual(parseServiceManifest('{"scripts":{"dev":"npm run dev"}}', "/area/.processes.json"), {
    scripts: { dev: { command: "npm run dev" } },
    commands: {}
  });
  assert.throws(() => parseServiceManifest("{", "/bad"), /invalid JSON/);
  assert.throws(() => parseServiceManifest('{"scripts":{"Bad name":"x"}}', "/bad"), /invalid program name/);
  assert.throws(() => parseServiceManifest('{"scripts":{"dev":""}}', "/bad"), /non-empty string/);
  assert.throws(() => parseServiceManifest('{"scripts":{},"cwd":"x"}', "/bad"), /only "scripts" and "commands"/);
});

test("process manifests can hold on-demand commands beside managed processes", () => {
  assert.deepEqual(parseServiceManifest('{"commands":{"release":"npm run release"}}', "/area/.processes.json"), {
    scripts: {},
    commands: { release: { command: "npm run release" } }
  });
});

test("a managed process may record its own working directory", () => {
  assert.deepEqual(parseServiceManifest('{"scripts":{"dev":{"command":"npm run dev","cwd":"/tmp"}}}', "/area/.processes.json"), {
    scripts: { dev: { command: "npm run dev", cwd: "/tmp" } },
    commands: {}
  });
});

test("descendants inherit definitions and the nearest Area wins", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-processes-"));
  const repoA = path.join(root, "repo-a");
  const repoB = path.join(root, "repo-b");
  try {
    await mkdir(path.join(root, "otto", "tangent", "shell"), { recursive: true });
    await mkdir(repoA);
    await mkdir(repoB);
    await writeArea(root, "otto", repoA, { dev: "root-dev", shared: "root-shared" });
    await writeArea(root, "otto/tangent", repoB, { dev: "tangent-dev" });

    const definitions = await resolveServiceDefinitions("otto/tangent/shell", root);
    assert.deepEqual([...definitions.keys()], ["dev", "shared"]);
    assert.deepEqual(definitions.get("dev"), {
      name: "dev",
      command: "tangent-dev",
      area: "otto/tangent",
      cwd: repoB,
      manifest: path.join(root, "otto", "tangent", ".processes.json")
    });
    assert.equal(definitions.get("shared").area, "otto");
    assert.equal(definitions.get("shared").cwd, repoA);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("process sessions are stable and namespaced by defining area", () => {
  const a = serviceSessionName({ area: "otto/tangent", name: "dev" });
  assert.equal(a, serviceSessionName({ area: "otto/tangent", name: "dev" }));
  assert.notEqual(a, serviceSessionName({ area: "neara/tangent", name: "dev" }));
  assert.match(a, /^process-tangent--dev-[a-f0-9]{8}$/);
});

test("start creates a metadata-bound tmux shell and submits the literal command", async () => {
  const runner = recordingRunner([""]);
  const definition = def();
  const message = await controlService("start", definition, runner);
  const session = serviceSessionName(definition);
  assert.match(message, /started dev on otto\/tangent/);
  assert.deepEqual(runner.calls, [
    ["tmux", ["list-sessions", "-F", "#{session_name}\t#{pane_current_command}"]],
    ["tmux", ["new-session", "-d", "-s", session, "-c", "/repo"]],
    ["tmux", ["set-option", "-t", session, "@tangent_kind", "process"]],
    ["tmux", ["set-option", "-t", session, "@tangent_area", "otto/tangent"]],
    ["tmux", ["set-option", "-t", session, "@tangent_process", "dev"]],
    ["tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", "npm run dev && echo '$HOME'"]],
    ["tmux", ["send-keys", "-t", `=${session}:`, "Enter"]]
  ]);
});

test("start reuses running sessions and reruns stopped sessions", async () => {
  const definition = def();
  const session = serviceSessionName(definition);
  const live = recordingRunner([`${session}\tnode\n`]);
  assert.match(await controlService("start", definition, live), /already running/);
  assert.equal(live.calls.length, 1);

  const stopped = recordingRunner([`${session}\tzsh\n`]);
  assert.match(await controlService("start", definition, stopped), /started dev/);
  assert.deepEqual(stopped.calls.slice(1), [
    ["tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", definition.command]],
    ["tmux", ["send-keys", "-t", `=${session}:`, "Enter"]]
  ]);
});

test("stop and close target only the exact managed session", async () => {
  const definition = def();
  const session = serviceSessionName(definition);
  const stop = recordingRunner([`${session}\tnode\n`]);
  await controlService("stop", definition, stop);
  assert.deepEqual(stop.calls.at(-1), ["tmux", ["send-keys", "-t", `=${session}:`, "C-c"]]);

  const close = recordingRunner([`${session}\tzsh\n`]);
  await controlService("close", definition, close);
  assert.deepEqual(close.calls.at(-1), ["tmux", ["kill-session", "-t", `=${session}`]]);
});

test("the bound tmux area is authoritative unless --area is explicit", async () => {
  const runner = recordingRunner(["otto/tangent\n"]);
  const previous = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    assert.equal(await resolveServiceArea(undefined, runner), "otto/tangent");
    assert.equal(await resolveServiceArea("neara/pgande", runner), "neara/pgande");
    assert.equal(runner.calls.length, 1);
  } finally {
    if (previous === undefined) delete process.env.TMUX;
    else process.env.TMUX = previous;
  }
});

test("a worker session cannot start, stop, restart, or close processes", async () => {
  const previous = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    for (const action of ["start", "stop", "restart", "close"]) {
      const runner = recordingRunner(["goal\n"]);
      await assert.rejects(runServiceCommand([action, "dev", "--area", "otto/tangent"], runner, "/nowhere"), /workers only send\. Use the exact Area-path command/);
      assert.deepEqual(runner.calls, [["tmux", ["show-option", "-qv", "@tangent_kind"]]]);
    }
  } finally {
    if (previous === undefined) delete process.env.TMUX;
    else process.env.TMUX = previous;
  }
});

/** Writes one Area and its process manifest. */
async function writeArea(root, area, repo, scripts) {
  const dir = path.join(root, area);
  await mkdir(dir, { recursive: true });
  const base = area.split("/").pop();
  await writeFile(path.join(dir, `${base}.md`), `---\ntype: area\nstatus: active\n---\n\n# ${base}\n\n## Resources\n\n- Repository: ${repo}\n`);
  await writeFile(path.join(dir, ".processes.json"), JSON.stringify({ scripts }));
}

/** Returns the standard managed-process fixture. */
function def() {
  return {
    name: "dev",
    command: "npm run dev && echo '$HOME'",
    area: "otto/tangent",
    cwd: "/repo",
    manifest: "/trees/otto/tangent/.processes.json"
  };
}

/** Returns a runner that records commands and yields fixture output. */
function recordingRunner(outputs) {
  let index = 0;
  return {
    calls: [],
    /** Records one command and returns its next fixture output. */
    async run(command, args) {
      this.calls.push([command, args]);
      return { stdout: outputs[index++] ?? "" };
    }
  };
}
