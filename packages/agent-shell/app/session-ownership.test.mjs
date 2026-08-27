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
  const tags = new Map();
  const calls = [];
  /** Implements the tmux commands used by the ownership capability. */
  const runTmux = async (args) => {
    calls.push(args);
    const session = String(args[args.indexOf("-t") + 1]).replace(/^[$=]/, "").replace(/:$/, "");
    if (args[0] === "set-option") {
      if (!live.has(session)) throw new Error(`can't find session: ${session}`);
      if (args.includes("-o") && live.get(session)) throw new Error("already set");
      live.set(session, args.at(-1));
      return { stdout: "" };
    }
    if (args[0] === "has-session") {
      if (!live.has(session)) throw new Error(`can't find session: ${session}`);
      return { stdout: "" };
    }
    if (args[0] === "display-message") {
      if (!live.has(session)) throw new Error(`can't find session: ${session}`);
      if (String(args.at(-1)).includes("@tangent_kind")) {
        const value = tags.get(session) ?? {};
        return { stdout: `${value.kind ?? ""}\t${value.brain ?? ""}\t${value.generation ?? ""}\n` };
      }
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

  tags.set("legacy", { kind: "brain", brain: "otto/tangent", generation: "12" });
  assert.deepEqual(
    await one.claimLegacyBrain({ session: "legacy", area: "otto/other", generation: 12 }),
    { state: "mismatch", instanceId: null, target: "$legacy", observed: { kind: "brain", brain: "otto/tangent", generation: "12" } },
  );
  assert.equal(live.get("legacy"), null, "mismatched legacy evidence stays unowned");
  assert.deepEqual(
    await one.claimLegacyBrain({ session: "legacy", area: "otto/tangent", generation: 12 }),
    { state: "claimed", instanceId: "shell-one", target: "$legacy" },
  );
  assert.equal(live.get("legacy"), "shell-one");
  assert.equal((await readSessionOwner(root, "legacy")).instanceId, "shell-one");
  assert.deepEqual(
    await two.claimLegacyBrain({ session: "legacy", area: "otto/tangent", generation: 12 }),
    { state: "foreign", instanceId: "shell-one", target: "$legacy" },
  );
  live.set("legacy-worker", null);
  tags.set("legacy-worker", { kind: "goal", brain: "otto/tangent/goal-one.md", generation: "2" });
  assert.deepEqual(
    await one.claimLegacySession({ session: "legacy-worker", expected: { kind: "goal", brain: "otto/tangent/goal-one.md", generation: 2 } }),
    { state: "claimed", instanceId: "shell-one", target: "$legacy-worker" },
  );
  assert.ok(calls.some((args) => args.includes(SESSION_OWNER_OPTION)), "the tmux option is the live ownership key");
});
