import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { goalCommandSpec } from "../dist/cli/index.js";

/** Finds one named subcommand in the goal command spec. */
const subcommand = (name) => goalCommandSpec.subcommands.find((entry) => entry.name === name);
/** Lists the option names one spec entry accepts. */
const optionNames = (entry) => entry.options.map((option) => option.name);

test("tangent goal start takes a slug, typed assignments, and an explicit recovery option", () => {
  const start = subcommand("start");
  assert.ok(start, "goal spec has a start subcommand");
  assert.equal(start.args, "<slug>");
  assert.deepEqual(optionNames(start), ["step", "launch", "path", "continue-from", "kind", "recovery", "session", "server", "json"]);
  for (const name of ["step", "launch", "path", "continue-from"]) {
    const option = start.options.find((entry) => entry.name === name);
    assert.equal(option.takesValue, true, `${name} takes a value`);
    assert.match(option.description, /repeatable/i, `${name} is documented as repeatable`);
  }
  assert.equal(start.options.find((entry) => entry.name === "kind").takesValue, true, "assignment kind takes a value");
  assert.notEqual(start.options.find((entry) => entry.name === "recovery").takesValue, true, "recovery is an explicit switch");
});

test("tangent goal append takes a slug and the same repeatable step options as start", () => {
  const append = subcommand("append");
  assert.ok(append, "goal spec has an append subcommand");
  assert.equal(append.args, "<slug>");
  assert.deepEqual(optionNames(append), ["step", "launch", "path", "continue-from", "kind", "server", "json"]);
  assert.match(append.description, /without restarting/);
});

test("tangent goal handover takes facts, session identity, and a typed report", () => {
  const handover = subcommand("handover");
  assert.ok(handover, "goal spec has a handover subcommand");
  assert.equal(handover.args, "<facts...>");
  assert.deepEqual(optionNames(handover), ["session", "report", "server"]);
  assert.equal(handover.options.find((entry) => entry.name === "report").takesValue, true);
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
    assert.deepEqual(optionNames(command), ["on", "session", "server", "json"]);
    assert.match(command.options[0].description, /repeatable/);
  }
});

test("tangent goal create has no human assignee option and keeps agent ownership", () => {
  const create = subcommand("create");
  assert.ok(create);
  assert.equal(optionNames(create).includes("assignee"), false, "the human assignee concept is gone");
  assert.ok(optionNames(create).includes("own"), "session ownership remains a separate option");
});

test("brain Goal creation stays unowned unless --own is explicit", async (context) => {
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
  await runGoalCli(["create", "--area", "otto/test", "--title", "Owned proof", "--done-when", "The owned proof passes.", "--own", "--session", "tangent-brain-test"]);
  await runGoalCli(["start", "proof", "--launch", "codex/sol/low", "--session", "tangent-brain-test"]);

  const creates = requests.filter((request) => request.path === "/api/goals/create");
  assert.equal(creates[0].body.caller, "tangent-brain-test");
  assert.equal(Object.hasOwn(creates[0].body, "own"), false, "caller authority does not imply ownership");
  assert.equal(creates[1].body.caller, "tangent-brain-test");
  assert.equal(creates[1].body.own, "tangent-brain-test", "--own keeps explicit ownership");
  assert.equal(requests.find((request) => request.path === "/api/goals/start").body.caller, "tangent-brain-test");
});

test("each --step carries its own working directory, and a step without one keeps the Area repository", async (context) => {
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
    if (url.pathname === "/api/goals/show") return Response.json({ goal: { slug: "proof", file: "otto/test/goal-proof.md", area: "otto/test", status: "open" } });
    if (url.pathname === "/api/sessions") return Response.json({ pipelines: [{ goal: "otto/test/goal-proof.md", revision: 4 }] });
    if (url.pathname === "/api/goals/start") return Response.json({ session: "worker-proof" });
    if (url.pathname === "/api/pipelines/append") return Response.json({ state: "queued", after: 1, added: [2] });
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
  });

  await runGoalCli(["start", "proof", "--step", "Design it.", "--path=", "--step", "Implement it in the plugin.", "--path", "/tmp/arbitrary-worker", "--session", "tangent-brain-test"]);
  const steps = requests.find((request) => request.path === "/api/goals/start").body.steps;
  assert.equal(steps[0].path, undefined, "an empty --path= keeps the Area repository for that step");
  assert.equal(steps[1].path, "/tmp/arbitrary-worker", "the step at the same position takes the directory");

  await runGoalCli(["start", "proof", "--step", "Work here.", "--path", "..", "--session", "tangent-brain-test"]);
  const relative = requests.filter((request) => request.path === "/api/goals/start").at(-1).body.steps[0].path;
  assert.equal(relative, path.resolve(".."), "a relative directory resolves against the calling shell");

  await runGoalCli(["start", "proof", "--step", "Work at home.", "--path", "~", "--session", "tangent-brain-test"]);
  const home = requests.filter((request) => request.path === "/api/goals/start").at(-1).body.steps[0].path;
  assert.equal(home, os.homedir(), "a leading ~ expands before the server sees it");

  await runGoalCli(["start", "proof", "--launch", "codex/sol/low", "--session", "tangent-brain-test"]);
  const plain = requests.filter((request) => request.path === "/api/goals/start").at(-1).body;
  assert.equal(plain.steps, undefined, "a Goal started without steps is unchanged");
  assert.deepEqual(plain.choice, { harness: "codex", model: "sol", effort: "low" }, "the solo form carries its own harness");

  await runGoalCli(["append", "proof", "--step", "Prove it.", "--path", "/tmp/arbitrary-worker"]);
  assert.equal(requests.find((request) => request.path === "/api/pipelines/append").body.steps[0].path, "/tmp/arbitrary-worker");

  // An omitted --launch is not a client-side error any more: it reaches the
  // server, which lends the calling brain's own harness or refuses loudly.
  // The client still names no harness of its own.
  await runGoalCli(["start", "proof", "--session", "tangent-brain-test"]);
  const unnamed = requests.filter((request) => request.path === "/api/goals/start").at(-1).body;
  assert.equal(Object.hasOwn(unnamed, "choice"), false, "the client sends no harness it was not given");
  assert.equal(unnamed.caller, "tangent-brain-test", "the server needs the caller to know whose harness applies");
  await assert.rejects(
    () => runGoalCli(["start", "proof", "--launch", "codex", "--launch", "pi-code", "--session", "tangent-brain-test"]),
    /exactly one --launch/,
    "two harnesses for one agent is a mistake, not a choice"
  );
  await assert.rejects(
    () => runGoalCli(["start", "proof", "--path", "/tmp/arbitrary-worker", "--session", "tangent-brain-test"]),
    /--path belongs to a --step/,
    "a directory without a step is refused instead of dropped"
  );
  await assert.rejects(
    () => runGoalCli(["start", "proof", "--step", "One.", "--path", "/a", "--path", "/b", "--session", "tangent-brain-test"]),
    /More --path values than --step values/
  );
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
