import assert from "node:assert/strict";
import test from "node:test";

import { goalCommandSpec, runGoalCli } from "../dist/cli/index.js";

/** Runs one list command and returns the requested status values. */
async function requestedUrl(argv) {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const requests = [];
  console.log = () => {};
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname === "/api/tree") return Response.json({ areas: [{ path: "otto", children: [{ path: "otto/tangent", children: [] }] }] });
    return Response.json({ goals: [], filters: { status: url.searchParams.getAll("status"), changedSince: "", query: "" } });
  };
  try {
    await runGoalCli(["list", ...argv]);
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  }
  return requests.at(-1);
}

test("goal list advertises explicit done and all views", () => {
  const list = goalCommandSpec.subcommands.find((entry) => entry.name === "list");
  assert.ok(list.options.some((entry) => entry.name === "done"));
  assert.ok(list.options.some((entry) => entry.name === "all"));
});

test("goal list defaults to open work and makes done or all explicit", async () => {
  assert.deepEqual((await requestedUrl([])).searchParams.getAll("status"), ["open", "active", "verify"]);
  assert.deepEqual((await requestedUrl(["--done"])).searchParams.getAll("status"), ["done"]);
  assert.deepEqual((await requestedUrl(["--all"])).searchParams.getAll("status"), []);
  assert.deepEqual((await requestedUrl(["--status", "parked"])).searchParams.getAll("status"), ["parked"]);
});

test("goal list keeps exact Area and subtree scoping with the new views", async () => {
  const url = await requestedUrl(["otto/tangent", "--subtree", "--done"]);
  assert.equal(url.searchParams.get("area"), "otto/tangent");
  assert.equal(url.searchParams.get("subtree"), "1");
  assert.deepEqual(url.searchParams.getAll("status"), ["done"]);
});

test("goal list refuses ambiguous status shortcuts", async () => {
  await assert.rejects(runGoalCli(["list", "--done", "--all"]), /either --done or --all/);
  await assert.rejects(runGoalCli(["list", "--done", "--status", "active"]), /--status or --done\/--all/);
});
