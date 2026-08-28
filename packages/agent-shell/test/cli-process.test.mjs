import assert from "node:assert/strict";
import test from "node:test";

import { processCommandSpec, runProcessCli } from "../dist/cli/index.js";

/** Finds one named process subcommand. */
function subcommand(name) {
  return processCommandSpec.subcommands.find((entry) => entry.name === name);
}

test("process help exposes the complete loop lifecycle", () => {
  assert.deepEqual(processCommandSpec.subcommands.map((entry) => entry.name), ["create", "list", "show", "pause", "resume", "check", "remove"]);
  assert.deepEqual(subcommand("create").options.map((entry) => entry.name), ["area", "slug", "every", "message", "server", "json"]);
  assert.equal(subcommand("remove").args, "<slug|area/slug>");
});

test("process create and remove send exact requests and print results", async (context) => {
  const previousTmux = process.env.TMUX;
  delete process.env.TMUX;
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const requests = [];
  const printed = [];
  console.log = (...parts) => printed.push(parts.join(" "));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
    if (url.pathname === "/api/processes/create") return Response.json({ ok: true, file: "otto/tangent/process-review-work.md", process: { loop: true } });
    if (url.pathname === "/api/processes/remove") return Response.json({ ok: true, file: "otto/tangent/process-review-work.md", area: "otto/tangent", slug: "review-work" });
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
  });

  await runProcessCli(["create", "--area", "otto/tangent", "--slug", "review-work", "--every", "20m", "--message", "Review open work."]);
  await runProcessCli(["remove", "otto/tangent/review-work"]);
  assert.deepEqual(requests, [
    { path: "/api/processes/create", body: { area: "otto/tangent", slug: "review-work", every: "20m", message: "Review open work." } },
    { path: "/api/processes/remove", body: { slug: "otto/tangent/review-work", area: "" } },
  ]);
  assert.deepEqual(printed, ["otto/tangent/process-review-work.md: loop created", "otto/tangent/process-review-work.md: loop removed"]);
});

test("process create validates all required named values before a request", async () => {
  await assert.rejects(runProcessCli(["create"]), /requires --area/);
  await assert.rejects(runProcessCli(["create", "--area", "otto"]), /requires --slug/);
  await assert.rejects(runProcessCli(["create", "--area", "otto", "--slug", "review"]), /requires --every/);
  await assert.rejects(runProcessCli(["create", "--area", "otto", "--slug", "review", "--every", "20m"]), /requires --message/);
  await assert.rejects(runProcessCli(["remove"]), /requires <slug>/);
});
