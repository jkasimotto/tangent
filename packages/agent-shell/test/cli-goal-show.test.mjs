import assert from "node:assert/strict";
import test from "node:test";

import { goalCommandSpec, runGoalCli } from "../dist/cli/index.js";

test("Goal show is an intent-only command", async (context) => {
  const show = goalCommandSpec.subcommands.find((entry) => entry.name === "show");
  assert.match(show.description, /intent/);
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const seen = [];
  const printed = [];
  console.log = (...parts) => printed.push(parts.join(" "));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    if (url.pathname === "/api/goals/show") return Response.json({ goal: { slug: "proof", file: "otto/test/goal-proof.md", area: "otto/test", status: "open" } });
    if (url.pathname === "/api/goals/detail") return Response.json({ goal: { slug: "proof", file: "otto/test/goal-proof.md", area: "otto/test", status: "open", title: "Proof", doneWhen: "It works." }, dependencies: [], requiredBy: [], documents: [], cards: [], commands: [] });
    return Response.json({ error: "unexpected" }, { status: 404 });
  };
  context.after(() => { globalThis.fetch = previousFetch; console.log = previousLog; });
  await runGoalCli(["show", "proof"]);
  assert.deepEqual(seen, ["/api/goals/show", "/api/goals/detail"]);
  assert.doesNotMatch(printed.join("\n"), /Attempt|Assignment|Job/);
});
