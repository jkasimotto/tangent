import assert from "node:assert/strict";
import test from "node:test";

import { agentCommandSpec, runAgentCli } from "../dist/cli/index.js";

test("tangent agent publishes canonical session commands and hides context", () => {
  assert.deepEqual(agentCommandSpec.subcommands.map((entry) => entry.name), ["list", "show", "stop", "resume", "send"]);
  assert.equal(agentCommandSpec.subcommands.find((entry) => entry.name === "send").args, "<session> <text...>");
  assert.equal(agentCommandSpec.subcommands.some((entry) => entry.name === "context"), false);
});

test("the agent context alias calls agent show and identifies itself", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const previousLog = console.log;
  const errors = [];
  let requested;
  console.error = (...parts) => errors.push(parts.join(" "));
  console.log = () => {};
  globalThis.fetch = async (input) => {
    requested = new URL(String(input));
    return Response.json({ agent: { session: "worker one", live: true, role: "worker", context: null } });
  };
  context.after(() => { globalThis.fetch = previousFetch; console.error = previousError; console.log = previousLog; });
  await runAgentCli(["context", "worker one", "--json"]);
  assert.equal(requested.pathname, "/api/agents/show");
  assert.equal(requested.searchParams.get("session"), "worker one");
  assert.equal(requested.searchParams.get("compatAlias"), "agent context");
  assert.equal(errors[0], "tangent agent context is now tangent agent show");
});

test("agent send keeps Area addressing for one release and adds an operation ID", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const previousLog = console.log;
  let body;
  const errors = [];
  console.error = (...parts) => errors.push(parts.join(" "));
  console.log = () => {};
  globalThis.fetch = async (_input, init = {}) => {
    body = JSON.parse(String(init.body));
    return Response.json({ status: "queued", target: "area", to: "otto/tangent", reason: "stored" });
  };
  context.after(() => { globalThis.fetch = previousFetch; console.error = previousError; console.log = previousLog; });
  await runAgentCli(["send", "otto/tangent", "done", "--from", "brain"]);
  assert.equal(body.to, "otto/tangent");
  assert.match(body.operationId, /^[0-9a-f-]{36}$/);
  assert.match(errors[0], /tangent send <area>/);
});
