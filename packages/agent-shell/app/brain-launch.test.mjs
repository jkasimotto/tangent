import assert from "node:assert/strict";
import test from "node:test";
import { resolveBrainAttemptLaunch } from "./brain-launch.mjs";

test("brain attempts resolve either the current Area default or one requested choice", async () => {
  const calls = [];
  const launchCatalog = {
    /** Returns the current inherited brain declaration. */
    async forBrain(area) {
      calls.push({ method: "forBrain", area });
      return { harness: "codex", model: "luna", effort: "low", label: "Codex · Luna · Low", command: "codex --model luna --effort low", source: "otto", via: "brain" };
    },
    /** Resolves one registry choice without changing a declaration. */
    async requested(input) {
      calls.push({ method: "requested", input });
      return { harness: "claude", model: "opus", effort: null, label: "Claude · Opus", command: "claude --model opus" };
    },
  };

  const declared = await resolveBrainAttemptLaunch({ area: "otto/tangent", expectedLaunch: "codex/luna/low", launchCatalog });
  assert.deepEqual(declared, {
    // The stub catalog resolves no provider, so the axis records null.
    ref: { harness: "codex", model: "luna", effort: "low", provider: null },
    label: "Codex · Luna · Low",
    command: "codex --model luna --effort low",
    sourceArea: "otto",
    mode: "brain",
  });

  const choice = { harness: "claude", model: "opus" };
  const overridden = await resolveBrainAttemptLaunch({ area: "otto/tangent", choice, expectedLaunch: "claude/opus", launchCatalog });
  assert.deepEqual(overridden, {
    ref: { harness: "claude", model: "opus", effort: null, provider: null },
    label: "Claude · Opus",
    command: "claude --model opus",
    sourceArea: null,
    mode: "override",
  });
  assert.deepEqual(calls, [
    { method: "forBrain", area: "otto/tangent" },
    { method: "requested", input: { choice } },
  ]);
});

test("expectedLaunch is checked against the resolved override reference", async () => {
  const launchCatalog = {
    /** Resolves the selected registry entry. */
    async requested() {
      return { harness: "codex", model: "sol", effort: "high", label: "Codex · Sol · High", command: "codex --model sol --effort high" };
    },
  };
  const result = await resolveBrainAttemptLaunch({
    area: "otto/tangent",
    choice: { harness: "codex", model: "sol", effort: "high" },
    expectedLaunch: "codex/sol/low",
    launchCatalog,
  });
  assert.equal(result.status, 409);
  assert.equal(result.code, "launch-changed");
  // The stub catalog resolves no provider, so the axis records null rather
  // than a guess from the harness id.
  assert.deepEqual(result.launch.ref, { harness: "codex", model: "sol", effort: "high", provider: null });
  assert.match(result.error, /codex\/sol\/high/);
});

test("an unknown requested choice is a client error while a broken Area default stays a conflict", async () => {
  const launchCatalog = {
    /** Rejects an unknown registry choice. */
    async requested() { return { error: 'unknown harness "missing"' }; },
    /** Reports a broken durable Area declaration. */
    async forBrain() { return { error: 'otto: unknown harness "removed"' }; },
  };
  assert.deepEqual(
    await resolveBrainAttemptLaunch({ area: "otto/tangent", choice: { harness: "missing" }, launchCatalog }),
    { status: 400, code: "invalid-choice", error: 'unknown harness "missing"' },
  );
  assert.deepEqual(
    await resolveBrainAttemptLaunch({ area: "otto/tangent", launchCatalog }),
    { status: 409, error: 'otto: unknown harness "removed"' },
  );
});
