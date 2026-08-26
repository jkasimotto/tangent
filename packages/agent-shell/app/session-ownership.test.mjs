import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { agentShellInstanceId, createSessionOwnership, readSessionOwner, SESSION_OWNER_OPTION } from "./session-ownership.mjs";

test("an Agent Shell instance ID is stable for one public endpoint and accepts an explicit override", () => {
  const input = { host: "127.0.0.1", port: 4321, treesRoot: "/tmp/trees", chatSession: "orchestrator" };
  assert.equal(agentShellInstanceId(input), agentShellInstanceId(input));
  assert.notEqual(agentShellInstanceId(input), agentShellInstanceId({ ...input, port: 4322 }));
  assert.equal(agentShellInstanceId({ ...input, explicit: "test-shell:one" }), "test-shell:one");
  assert.throws(() => agentShellInstanceId({ ...input, explicit: "bad owner" }), /TANGENT_SHELL_INSTANCE_ID/);
});

test("session termination requires the live tmux owner and records stale ownership", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-session-owner-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const live = new Map();
  const calls = [];
  /** Implements the tmux commands used by the ownership capability. */
  const runTmux = async (args) => {
    calls.push(args);
    const session = String(args[args.indexOf("-t") + 1]).replace(/^[$=]/, "").replace(/:$/, "");
    if (args[0] === "set-option") {
      if (!live.has(session)) throw new Error(`can't find session: ${session}`);
      live.set(session, args[4]);
      return { stdout: "" };
    }
    if (args[0] === "has-session") {
      if (!live.has(session)) throw new Error(`can't find session: ${session}`);
      return { stdout: "" };
    }
    if (args[0] === "display-message") {
      if (!live.has(session)) throw new Error(`can't find session: ${session}`);
      return { stdout: `$${session}\t${live.get(session) ?? ""}\n` };
    }
    if (args[0] === "kill-session") {
      if (!live.delete(session)) throw new Error(`can't find session: ${session}`);
      return { stdout: "" };
    }
    throw new Error(`unexpected tmux command ${args[0]}`);
  };
  const one = createSessionOwnership({ instanceId: "shell-one", root, runTmux });
  const two = createSessionOwnership({ instanceId: "shell-two", root, runTmux });

  live.set("worker-one", null);
  await one.claim("worker-one", "$worker-one");
  assert.equal(live.get("worker-one"), "shell-one");
  assert.equal((await readSessionOwner(root, "worker-one")).instanceId, "shell-one");
  assert.equal(await one.ownsRecorded("worker-one"), true);
  assert.equal(await two.ownsRecorded("worker-one"), false);
  assert.deepEqual(await two.terminate("worker-one"), { state: "foreign", instanceId: "shell-one" });
  assert.equal(live.has("worker-one"), true);
  assert.deepEqual(await one.terminate("worker-one"), { state: "terminated", instanceId: "shell-one" });
  assert.equal(live.has("worker-one"), false);
  assert.deepEqual(calls.findLast((args) => args[0] === "kill-session"), ["kill-session", "-t", "$worker-one"]);

  live.set("legacy", null);
  assert.deepEqual(await one.terminate("legacy"), { state: "legacy", instanceId: null });
  assert.equal(live.has("legacy"), true);
  assert.ok(calls.some((args) => args.includes(SESSION_OWNER_OPTION)), "the tmux option is the live ownership key");
});
