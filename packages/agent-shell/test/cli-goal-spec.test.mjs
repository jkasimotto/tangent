import assert from "node:assert/strict";
import test from "node:test";

import { goalCommandSpec } from "../dist/cli/index.js";

/** Finds one named subcommand in the goal command spec. */
const subcommand = (name) => goalCommandSpec.subcommands.find((entry) => entry.name === name);
/** Lists the option names one spec entry accepts. */
const optionNames = (entry) => entry.options.map((option) => option.name);

test("tangent goal start takes a slug and repeatable step, launch, and continue-from options", () => {
  const start = subcommand("start");
  assert.ok(start, "goal spec has a start subcommand");
  assert.equal(start.args, "<slug>");
  assert.deepEqual(optionNames(start), ["step", "launch", "continue-from", "session", "server", "json"]);
  for (const name of ["step", "launch", "continue-from"]) {
    const option = start.options.find((entry) => entry.name === name);
    assert.equal(option.takesValue, true, `${name} takes a value`);
    assert.match(option.description, /repeatable/i, `${name} is documented as repeatable`);
  }
});

test("tangent goal append takes a slug and the same repeatable step options as start", () => {
  const append = subcommand("append");
  assert.ok(append, "goal spec has an append subcommand");
  assert.equal(append.args, "<slug>");
  assert.deepEqual(optionNames(append), ["step", "launch", "continue-from", "server", "json"]);
  assert.match(append.description, /without restarting/);
});

test("tangent goal handover takes the facts and an optional session", () => {
  const handover = subcommand("handover");
  assert.ok(handover, "goal spec has a handover subcommand");
  assert.equal(handover.args, "<facts...>");
  assert.deepEqual(optionNames(handover), ["session", "continue", "server"]);
  assert.match(handover.description, /facts/);
});

test("goal help still lists the vault commands beside start and handover", () => {
  assert.deepEqual(
    goalCommandSpec.subcommands.map((entry) => entry.name),
    ["create", "list", "show", "depend", "undepend", "own", "release", "start", "append", "handover", "done", "wont-do"]
  );
});

test("tangent goal depend and undepend take repeatable prerequisites", () => {
  for (const name of ["depend", "undepend"]) {
    const command = subcommand(name);
    assert.equal(command.args, "<slug>");
    assert.deepEqual(optionNames(command), ["on", "server", "json"]);
    assert.match(command.options[0].description, /repeatable/);
  }
});

test("tangent goal create accepts repeatable human assignees without changing agent ownership", () => {
  const create = subcommand("create");
  assert.ok(create);
  assert.ok(optionNames(create).includes("assignee"));
  assert.match(create.options.find((entry) => entry.name === "assignee").description, /repeatable/);
  assert.ok(optionNames(create).includes("own"), "agent ownership remains a separate option");
});

test("goal mutations accept an explicit caller outside tmux", async (context) => {
  const { runGoalCli } = await import("../dist/cli/index.js");
  const previousTmux = process.env.TMUX;
  delete process.env.TMUX;
  const requests = [];
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  console.log = () => {};
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname, body: init.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === "/api/tree") return Response.json({ areas: [{ path: "otto/test", children: [] }] });
    if (url.pathname === "/api/goals/show") return Response.json({ goal: { slug: "proof", file: "otto/test/goal-proof.md", area: "otto/test", status: "open" } });
    if (url.pathname === "/api/goals/create") return Response.json({ file: "otto/test/goal-proof.md", files: [] });
    if (url.pathname === "/api/goals/start") return Response.json({ session: "worker-proof" });
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
  });

  await runGoalCli(["create", "--area", "otto/test", "--title", "Proof", "--done-when", "The proof passes.", "--session", "tangent-brain-test"]);
  await runGoalCli(["start", "proof", "--session", "tangent-brain-test"]);

  assert.equal(requests.find((request) => request.path === "/api/goals/create").body.caller, "tangent-brain-test");
  assert.equal(requests.find((request) => request.path === "/api/goals/start").body.caller, "tangent-brain-test");
});

test("tangent brain has handover and status; tangent area gains create", async () => {
  const { brainCommandSpec, areaCommandSpec } = await import("../dist/cli/index.js");
  const handover = brainCommandSpec.subcommands.find((entry) => entry.name === "handover");
  assert.ok(handover, "brain spec has a handover subcommand");
  assert.equal(handover.args, "<facts...>");
  assert.deepEqual(optionNames(handover), ["session", "server"]);
  const status = brainCommandSpec.subcommands.find((entry) => entry.name === "status");
  assert.equal(status.args, "[area]");
  const create = areaCommandSpec.subcommands.find((entry) => entry.name === "create");
  assert.ok(create, "area spec has a create subcommand");
  assert.equal(create.args, "<parent> <name>");
  assert.equal(brainCommandSpec.subcommands.find((entry) => entry.name === "advance").args, "<goal> <step>");
  assert.ok(brainCommandSpec.subcommands.find((entry) => entry.name === "request"));
});
