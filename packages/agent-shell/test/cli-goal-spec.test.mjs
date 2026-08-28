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
  assert.match(append.description, /the brain reads its note and marks the Goal done/, "append help says a review closes nothing itself");
  assert.match(append.options.find((entry) => entry.name === "kind").description, /defaults to implementation/i, "kind help names the safe default");
});

test("tangent goal handover is a hidden alias that names its replacement", () => {
  const handover = subcommand("handover");
  assert.ok(handover, "goal spec keeps the alias for one release");
  assert.equal(handover.hidden, true, "the alias is gone from help");
  assert.equal(handover.args, "<facts...>");
  assert.deepEqual(optionNames(handover), ["session", "report", "server"]);
  assert.match(handover.description, /Replaced by tangent send brain/);
});

test("tangent goal create starts the worker for a brain in the same call", () => {
  const create = subcommand("create");
  for (const name of ["start", "path", "launch", "verify", "instruction", "instruction-file"]) assert.ok(create.options.some((entry) => entry.name === name), `create has --${name}`);
  assert.notEqual(create.options.find((entry) => entry.name === "start").takesValue, true, "start is a switch");
  assert.notEqual(create.options.find((entry) => entry.name === "verify").takesValue, true, "verify is a switch");
  assert.match(create.options.find((entry) => entry.name === "done-when").description, /defaults to the title/);
  assert.match(create.options.find((entry) => entry.name === "launch").description, /brain's own harness is lent/);
});

test("goal help still lists the vault commands beside start and handover", () => {
  assert.deepEqual(
    goalCommandSpec.subcommands.map((entry) => entry.name),
    ["present", "create", "list", "show", "depend", "undepend", "own", "release", "start", "append", "handover", "done", "wont-do", "park", "reopen", "replace-agent"]
  );
});

test("Goal lifecycle and agent replacement have complete CLI contracts", () => {
  assert.deepEqual(optionNames(subcommand("park")), ["reason", "server"]);
  assert.deepEqual(optionNames(subcommand("reopen")), ["server"]);
  assert.deepEqual(optionNames(subcommand("replace-agent")), ["launch", "operation-id", "confirm", "session", "server", "json"]);
  assert.match(subcommand("replace-agent").description, /preserving the Goal and queue/);
});

test("park, reopen, and replace-agent send exact Goal mutations", async (context) => {
  const { runGoalCli } = await import("../dist/cli/index.js");
  const previousTmux = process.env.TMUX;
  delete process.env.TMUX;
  const requests = [];
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  let showCount = 0;
  console.log = () => {};
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ path: url.pathname, body });
    if (url.pathname === "/api/goals/show") {
      const status = showCount++ === 1 ? "parked" : "open";
      return Response.json({ goal: { slug: "proof", file: "otto/test/goal-proof.md", area: "otto/test", status } });
    }
    if (url.pathname === "/api/goals/detail") return Response.json({
      goal: { slug: "proof", file: "otto/test/goal-proof.md", area: "otto/test", status: "open" },
      current: { assignmentId: "assignment-2", attemptId: "attempt-proof", session: "proof-worker" },
      queue: { revision: 8, currentAssignmentId: "assignment-2", assignments: [{ id: "assignment-2", status: "running", session: "proof-worker", attempts: [{ id: "attempt-proof", session: "proof-worker" }] }] },
    });
    if (url.pathname === "/api/goals/edit" || url.pathname === "/api/goals/attempts/replace") return Response.json({ status: "complete", session: "proof-worker-2" });
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
  });

  await runGoalCli(["park", "proof", "--reason", "Later"]);
  await runGoalCli(["reopen", "proof"]);
  await runGoalCli(["replace-agent", "proof", "--launch", "codex/sol/high", "--operation-id", "replace-proof", "--session", "parent-brain"]);
  await runGoalCli(["replace-agent", "proof", "--launch", "codex/sol/high", "--operation-id", "replace-proof", "--confirm", "--session", "parent-brain"]);

  const edits = requests.filter((request) => request.path === "/api/goals/edit");
  assert.deepEqual(edits[0].body, { file: "otto/test/goal-proof.md", status: "parked", reason: "Later" });
  assert.deepEqual(edits[1].body, { file: "otto/test/goal-proof.md", status: "open" });
  const replacements = requests.filter((request) => request.path === "/api/goals/attempts/replace").map((request) => request.body);
  const replacement = replacements[0];
  assert.equal(replacement.goal, "otto/test/goal-proof.md");
  assert.equal(replacement.assignmentId, "assignment-2");
  assert.equal(replacement.expectedRevision, 8);
  assert.equal(replacement.expectedAttemptId, "attempt-proof");
  assert.deepEqual(replacement.launch, { harness: "codex", model: "sol", effort: "high" });
  assert.equal(replacement.caller, "parent-brain");
  assert.equal(replacement.operationId, "replace-proof");
  assert.equal(replacement.confirmed, undefined);
  assert.equal(replacements[1].operationId, "replace-proof");
  assert.equal(replacements[1].confirmed, true);
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
  const defaultAppend = requests.filter((request) => request.path === "/api/pipelines/append").at(-1).body.steps[0];
  assert.equal(defaultAppend.path, "/tmp/arbitrary-worker");
  assert.equal(defaultAppend.kind, "implementation", "review words do not infer a review assignment");

  await runGoalCli(["append", "proof", "--step", "Review the current Goal revision.", "--kind", "review"]);
  const reviewAppend = requests.filter((request) => request.path === "/api/pipelines/append").at(-1).body.steps[0];
  assert.equal(reviewAppend.kind, "review", "--kind review preserves the designated review type");

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

test("tangent brain has status and stop and no handover; tangent area gains create", async () => {
  const { brainCommandSpec, areaCommandSpec } = await import("../dist/cli/index.js");
  assert.equal(brainCommandSpec.subcommands.find((entry) => entry.name === "handover"), undefined, "a brain runs until Julian restarts it");
  assert.match(brainCommandSpec.subcommands.find((entry) => entry.name === "request").options.find((entry) => entry.name === "kind").description, /^plan, decision, or approval$/, "no test request");
  const status = brainCommandSpec.subcommands.find((entry) => entry.name === "status");
  assert.equal(status.args, "[area]");
  const stop = brainCommandSpec.subcommands.find((entry) => entry.name === "stop");
  assert.equal(stop.args, "[area]");
  assert.deepEqual(optionNames(stop), ["session", "server"]);
  const create = areaCommandSpec.subcommands.find((entry) => entry.name === "create");
  assert.ok(create, "area spec has a create subcommand");
  assert.equal(create.args, "<parent> <name>");
  assert.equal(brainCommandSpec.subcommands.find((entry) => entry.name === "advance").args, "<goal> <step>");
  assert.ok(brainCommandSpec.subcommands.find((entry) => entry.name === "request"));
});
