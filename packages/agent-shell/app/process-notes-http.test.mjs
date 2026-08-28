// Processes are notes (ADR-0043). This test drives the real server: the Area
// page and the CLI read process notes with their next run, a check says why a
// process is due, pause commits the note, a Goal created from a process note
// carries `process:` and holds the process while it is open, and the
// scheduler lane writes the due note to the Area brain inbox.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readInbox } from "./brain-inbox.mjs";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

/** Sends one JSON request and parses its JSON response. */
async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

/** Reads one JSON route. */
async function get(base, pathname) {
  return fetch(`${base}${pathname}`).then((response) => response.json());
}

/** Polls until the Area inbox holds a process note, or gives up. */
async function processNotice(brains, area) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const inbox = await readInbox(brains, area);
    const notice = (inbox?.notices ?? []).find((item) => /^Process /.test(item.text));
    if (notice) return notice;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

test("process notes reach the Area page, the CLI routes, the Goal, and the brain inbox", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-process-notes-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const brains = path.join(root, "brains");
  const area = path.join(trees, "otto", "dnd");
  await mkdir(workspace, { recursive: true });
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, "dnd.md"), `---\ntype: area\n---\n\n# D&D\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  await writeFile(path.join(area, "process-nightly-check.md"), "---\ntype: process\nschedule: daily 09:00 UTC\nverify: yes\n---\n\n# Nightly check\n\nRun the checks and report.\n", "utf8");
  await writeFile(path.join(area, "process-red-build.md"), "---\ntype: process\nwhen: true\nevery: 1m\npath: ~/Projects/dnd\n---\n\nFix the red build.\n", "utf8");
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "commit", "-q", "-m", "add: process fixture"]);
  const base = await startShellServer(context, {
    here, root, trees, workspace,
    env: { TANGENT_PROCESSES_ROOT: path.join(root, "processes"), TANGENT_RECONCILE_INTERVAL_MS: "600000" },
  });
  if (!base) return;

  await context.test("the Area page and tangent process list read each note with its next run", async () => {
    const shown = await get(base, "/api/areas/show?area=otto%2Fdnd");
    assert.deepEqual(shown.processes.map((item) => [item.slug, item.when, item.status]), [
      ["nightly-check", "Daily 09:00 UTC", "active"],
      ["red-build", "Every 1m while `true` exits 0", "active"],
    ]);
    const nightly = shown.processes[0];
    assert.equal(nightly.title, "Nightly check");
    assert.equal(nightly.verify, true);
    assert.match(nightly.nextRunAt, /T09:00:00\.000Z$/);
    const listed = await get(base, "/api/processes?area=otto%2Fdnd");
    assert.equal(listed.processes.length, 2);
    assert.equal(listed.processes[1].path, "~/Projects/dnd");
    const everything = await get(base, "/api/operations");
    assert.equal(everything.processes.length, 2, "the browser projection carries processes beside Operations");
  });

  await context.test("the due note reaches the Area brain inbox and names the start command", async () => {
    const notice = await processNotice(brains, "otto/dnd");
    assert.ok(notice, "the scheduler lane wrote the note");
    assert.equal(notice.text, `Process red-build is due. Start it with: tangent goal create --area otto/dnd --title "Red Build" --start --instruction-file ${path.join(area, "process-red-build.md")} --path ~/Projects/dnd`);
    const listed = await get(base, "/api/processes?area=otto%2Fdnd");
    const red = listed.processes.find((item) => item.slug === "red-build");
    assert.equal(red.state, "Due, brain not running");
    assert.equal(red.due, true);
  });

  await context.test("check says why a process is or is not due", async () => {
    const nightly = await post(base, "/api/processes/check", { slug: "nightly-check", area: "otto/dnd" });
    assert.equal(nightly.status, 200);
    assert.equal(nightly.body.due, false);
    assert.match(nightly.body.reason, /next slot/);
    const red = await post(base, "/api/processes/check", { slug: "red-build" });
    assert.equal(red.body.due, false);
    assert.match(red.body.reason, /waits for the brain/);
    const missing = await post(base, "/api/processes/check", { slug: "nothing" });
    assert.equal(missing.status, 409);
    assert.match(missing.body.error, /no process named "nothing"/);
  });

  await context.test("a Goal created from a process note carries process: and holds the process while open", async () => {
    const created = await post(base, "/api/goals/create", { area: "otto/dnd", goal: { title: "Nightly check", doneWhen: "The checks ran." }, instructionFile: path.join(area, "process-nightly-check.md") });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const text = await readFile(path.join(trees, created.body.file), "utf8");
    assert.match(text, /^process: otto\/dnd\/process-nightly-check\.md$/m);
    const listed = await get(base, "/api/processes?area=otto%2Fdnd");
    const nightly = listed.processes.find((item) => item.slug === "nightly-check");
    assert.equal(nightly.state, "Running");
    assert.equal(nightly.lastGoalFile ?? created.body.file, created.body.file);
    const check = await post(base, "/api/processes/check", { slug: "nightly-check" });
    assert.match(check.body.reason, /still open/);
  });

  await context.test("pause rewrites status: and commits the note; resume puts it back", async () => {
    const paused = await post(base, "/api/processes/control", { slug: "red-build", action: "pause" });
    assert.equal(paused.status, 200, JSON.stringify(paused.body));
    assert.equal(paused.body.status, "paused");
    assert.match(await readFile(path.join(area, "process-red-build.md"), "utf8"), /^status: paused$/m);
    const { stdout } = await execFileAsync("git", ["-C", trees, "log", "-1", "--format=%s"]);
    assert.equal(stdout.trim(), "update: otto/dnd process red-build paused");
    assert.equal(paused.body.process.state, "Paused");
    assert.equal(paused.body.process.nextRunAt, null);
    const resumed = await post(base, "/api/processes/control", { slug: "red-build", action: "resume" });
    assert.equal(resumed.body.status, "active");
    assert.match(await readFile(path.join(area, "process-red-build.md"), "utf8"), /^status: active$/m);
    const refused = await post(base, "/api/processes/control", { slug: "red-build", action: "delete" });
    assert.equal(refused.status, 409);
  });

  await context.test("create and remove own the complete loop lifecycle", async () => {
    const stateFile = path.join(root, "processes", "otto", "dnd", "review-work.json");
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, '{"lastNoticeAt":"2020-01-01T00:00:00.000Z"}\n', "utf8");
    const created = await post(base, "/api/processes/create", { area: "otto/dnd", slug: "review-work", every: "20m", message: "Review the open Goals." });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.file, "otto/dnd/process-review-work.md");
    assert.equal(created.body.process.loop, true);
    assert.equal(created.body.process.body, "Review the open Goals.");
    await assert.rejects(readFile(stateFile, "utf8"), /ENOENT/);
    assert.equal(await readFile(path.join(area, "process-review-work.md"), "utf8"), "---\ntype: process\nstatus: active\nevery: 20m\n---\n\nReview the open Goals.\n");
    let log = await execFileAsync("git", ["-C", trees, "log", "-1", "--format=%s"]);
    assert.equal(log.stdout.trim(), "add: otto/dnd loop review-work");

    const duplicate = await post(base, "/api/processes/create", { area: "otto/dnd", slug: "review-work", every: "1h", message: "Overwrite." });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.body.error, /already exists/);
    assert.doesNotMatch(await readFile(path.join(area, "process-review-work.md"), "utf8"), /Overwrite/);

    const checked = await post(base, "/api/processes/check", { slug: "otto/dnd/review-work" });
    assert.equal(checked.status, 200);
    assert.deepEqual([checked.body.due, checked.body.reason], [false, "brain not running"]);
    const paused = await post(base, "/api/processes/control", { slug: "review-work", area: "otto/dnd", action: "pause" });
    assert.equal(paused.body.status, "paused");
    const resumed = await post(base, "/api/processes/control", { slug: "otto/dnd/review-work", action: "resume" });
    assert.equal(resumed.body.status, "active");

    const removed = await post(base, "/api/processes/remove", { slug: "review-work", area: "otto/dnd" });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    log = await execFileAsync("git", ["-C", trees, "log", "-1", "--format=%s"]);
    assert.equal(log.stdout.trim(), "remove: otto/dnd loop review-work");
    const listed = await get(base, "/api/processes?area=otto%2Fdnd");
    assert.equal(listed.processes.some((item) => item.slug === "review-work"), false);
    assert.equal(listed.processes.some((item) => item.slug === "red-build"), true);
    const removedAgain = await post(base, "/api/processes/remove", { slug: "review-work", area: "otto/dnd" });
    assert.equal(removedAgain.status, 409);
  });

  await context.test("loop mutations return actionable validation and commit errors", async () => {
    for (const [body, pattern] of [
      [{ area: "missing", slug: "review", every: "20m", message: "Review." }, /no Area missing/],
      [{ area: "otto/dnd", slug: "Review Work", every: "20m", message: "Review." }, /lowercase kebab-case/],
      [{ area: "otto/dnd", slug: "fast", every: "30s", message: "Review." }, /1m or slower/],
      [{ area: "otto/dnd", slug: "empty", every: "20m", message: "" }, /message must not be empty/],
    ]) {
      const response = await post(base, "/api/processes/create", body);
      assert.equal(response.status, 409);
      assert.match(response.body.error, pattern);
    }

    const hook = path.join(trees, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\nexit 1\n", "utf8");
    await execFileAsync("chmod", ["+x", hook]);
    const failed = await post(base, "/api/processes/create", { area: "otto/dnd", slug: "commit-fails", every: "20m", message: "Review." });
    assert.equal(failed.status, 409);
    assert.match(failed.body.error, /saved but not committed/);
  });
});
