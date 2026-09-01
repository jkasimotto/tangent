import assert from "node:assert/strict";
import test from "node:test";

import { processCommandSpec, runProcessCli } from "../dist/cli/index.js";

/** Finds one named process subcommand. */
function subcommand(name) {
  return processCommandSpec.subcommands.find((entry) => entry.name === name);
}

test("process help exposes the complete definition and run lifecycle", () => {
  assert.deepEqual(processCommandSpec.subcommands.map((entry) => entry.name), ["create", "list", "show", "start", "pause", "resume", "check", "dismiss", "restore", "remove"]);
  assert.deepEqual(subcommand("create").options.map((entry) => entry.name), ["area", "slug", "every", "message", "server", "json"]);
  assert.equal(subcommand("remove").args, "<slug|area/slug>");
  assert.deepEqual(subcommand("start").options.map((entry) => entry.name), ["event", "attempt", "definition", "operation-id", "area", "server", "json"]);
});

test("process dismiss and restore fence the occurrence selected from server state", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const requests = [];
  const printed = [];
  let dismissed = false;
  console.log = (...parts) => printed.push(parts.join(" "));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/processes" && !init.method) return Response.json({ processes: [{
      area: "otto/tangent", slug: "review", file: "otto/tangent/process-review.md", title: "Review", status: "active", when: "Daily", nextRunAt: null,
      lastRunAt: null, lastNoticeAt: null, lastGoalFile: null, lastReason: null, state: dismissed ? "Dismissed" : "Start it?", error: null, launch: null, path: null, verify: false,
      revision: dismissed ? 5 : 4, eventId: "event-1", dismissedEventId: dismissed ? "event-1" : null,
    }] });
    const body = JSON.parse(String(init.body));
    requests.push({ path: url.pathname, body });
    if (url.pathname === "/api/processes/dismiss") { dismissed = true; return Response.json({ returnRule: { kind: "calendar", nextDueAt: "2026-09-02T09:00:00.000Z" } }); }
    if (url.pathname === "/api/processes/restore") { dismissed = false; return Response.json({ process: { state: "Start it?" } }); }
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  };
  context.after(() => { globalThis.fetch = previousFetch; console.log = previousLog; });

  await runProcessCli(["dismiss", "otto/tangent/review", "--operation-id", "dismiss-op"]);
  await runProcessCli(["restore", "otto/tangent/review", "--operation-id", "restore-op"]);
  assert.deepEqual(requests, [
    { path: "/api/processes/dismiss", body: { file: "otto/tangent/process-review.md", eventId: "event-1", expectedRevision: 4, operationId: "dismiss-op" } },
    { path: "/api/processes/restore", body: { file: "otto/tangent/process-review.md", eventId: "event-1", expectedRevision: 5, operationId: "restore-op" } },
  ]);
  assert.deepEqual(printed, [
    "otto/tangent/process-review.md: occurrence dismissed; next due 2026-09-02T09:00:00.000Z",
    "otto/tangent/process-review.md: occurrence restored",
  ]);
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
