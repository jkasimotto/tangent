import assert from "node:assert/strict";
import test from "node:test";

import { agentCommandSpec, runAgentCli } from "../dist/cli/index.js";

/** Finds one named agent subcommand. */
const subcommand = (name) => agentCommandSpec.subcommands.find((entry) => entry.name === name);

test("tangent agent publishes the durable context command", () => {
  assert.deepEqual(agentCommandSpec.subcommands.map((entry) => entry.name), ["list", "context", "send"]);
  assert.equal(subcommand("context").args, "[session]");
  assert.deepEqual(subcommand("context").options.map((option) => option.name), ["session", "server", "json"]);
  assert.equal(subcommand("send").args, "<session-or-area> <text...>");
});

test("tangent agent send reports an Area inbox without promising immediate delivery", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const printed = [];
  let body = null;
  console.log = (...parts) => printed.push(parts.join(" "));
  globalThis.fetch = async (_input, init = {}) => {
    body = JSON.parse(String(init.body));
    return Response.json({
      status: "queued",
      to: "neara/essential/autodesign",
      target: "area",
      via: "area",
      reason: "stored in the Area inbox; it will arrive when the brain starts",
      receipt: "notice-1",
    });
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  });

  await runAgentCli(["send", "neara/essential/autodesign", "Start the queued Goal.", "--from", "essential-brain"]);

  assert.deepEqual(body, { to: "neara/essential/autodesign", text: "Start the queued Goal.", from: "essential-brain" });
  assert.equal(printed[0], "queued for neara/essential/autodesign (stored in the Area inbox; it will arrive when the brain starts)");
});

test("tangent agent context requests an encoded session and prints the complete JSON projection", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const printed = [];
  let requested = null;
  console.log = (...parts) => printed.push(parts.join(" "));
  globalThis.fetch = async (input) => {
    requested = new URL(String(input));
    return Response.json({ context: { schema: "tangent-agent-context.v1", session: "worker one", role: "worker", area: "otto/tangent", current: true, unreadNotices: [] } });
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  });

  await runAgentCli(["context", "worker one", "--json"]);
  assert.equal(requested.pathname, "/api/agents/context");
  assert.equal(requested.searchParams.get("session"), "worker one");
  assert.equal(JSON.parse(printed.join("\n")).session, "worker one");
});

test("tangent agent context accepts an explicit session option", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  let requested = null;
  console.log = () => {};
  globalThis.fetch = async (input) => {
    requested = new URL(String(input));
    return Response.json({ context: { schema: "tangent-agent-context.v1", session: "worker-two", role: "unassigned", area: null, current: true } });
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  });
  await runAgentCli(["context", "--session", "worker-two", "--json"]);
  assert.equal(requested.searchParams.get("session"), "worker-two");
});

test("tangent agent context needs an explicit session outside tmux", async (context) => {
  const previousTmux = process.env.TMUX;
  delete process.env.TMUX;
  context.after(() => {
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
  });
  await assert.rejects(runAgentCli(["context"]), /needs a session name when it runs outside tmux/);
});
