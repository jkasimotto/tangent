import assert from "node:assert/strict";
import test from "node:test";

import { runAgentCli } from "../dist/cli/index.js";

test("agent list prints the server word for a worker and repair crew", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const printed = [];
  const since = Date.now() - 2 * 60_000;
  console.log = (...parts) => printed.push(parts.join(" "));
  globalThis.fetch = async () => Response.json({
    agents: [
      { name: "worker", area: "otto/tangent", kind: "goal", goal: "truth", state: "working", stateDetail: null, stateQuestion: "", queued: 0, agentState: { word: "Working", since, owner: "worker" } },
      { name: "tangent-repair", area: "otto/tangent", kind: "repair", goal: null, state: "working", stateDetail: null, stateQuestion: "", queued: 0, agentState: { word: "repair crew working", since, owner: "repair crew" } },
    ],
  });
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  });

  await runAgentCli(["list"]);

  assert.match(printed[0], /worker  \[Working · 2m · owner worker\]/);
  assert.match(printed[1], /tangent-repair  \[repair crew working · 2m · owner repair crew\]/);
});
