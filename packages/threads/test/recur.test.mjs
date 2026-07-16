// isDue reads local calendar fields (see recur.ts), and the fixtures below are written as +10:00
// wall-clock times (Sydney). Pin the process timezone before any Date is constructed so this file
// passes regardless of the machine/CI's actual local timezone.
process.env.TZ = "Australia/Sydney";

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseRecurFile, isDue, runRecur, scanRecurFiles, TmuxWorkerLauncher } from "../dist/core/recur.js";
import { readSidecar } from "../dist/core/sidecar.js";

const recurContent = [
  "---", "schedule: daily 08:30", "cwd: /tmp", "---",
  "Rebase the branches per the SOP note."
].join("\n");

const weeklyContent = [
  "---", "schedule: weekly mon 09:00", "cwd: /tmp", "model: opus", "---",
  "Send the weekly status update."
].join("\n");

test("parses a daily recur definition", () => {
  const def = parseRecurFile("proj", "recur-daily-rebase.md", recurContent);
  assert.equal(def.slug, "daily-rebase");
  assert.deepEqual(def.schedule, { kind: "daily", time: "08:30" });
  assert.equal(def.cwd, "/tmp");
  assert.equal(def.model, "sonnet");
  assert.match(def.prompt, /SOP note/);
});

test("parses a weekly recur definition with an explicit model", () => {
  const def = parseRecurFile("proj", "recur-weekly-status.md", weeklyContent);
  assert.equal(def.slug, "weekly-status");
  assert.deepEqual(def.schedule, { kind: "weekly", weekday: 1, time: "09:00" });
  assert.equal(def.model, "opus");
});

test("parseRecurFile throws a descriptive error for a missing schedule", () => {
  const content = ["---", "cwd: /tmp", "---", "Do the thing."].join("\n");
  assert.throws(() => parseRecurFile("proj", "recur-no-schedule.md", content), /schedule/);
});

test("parseRecurFile throws a descriptive error for an invalid schedule", () => {
  const content = ["---", "schedule: hourly 08:30", "cwd: /tmp", "---", "Do the thing."].join("\n");
  assert.throws(() => parseRecurFile("proj", "recur-bad-schedule.md", content), /invalid schedule/);
});

test("parseRecurFile throws a descriptive error for a missing cwd", () => {
  const content = ["---", "schedule: daily 08:30", "---", "Do the thing."].join("\n");
  assert.throws(() => parseRecurFile("proj", "recur-no-cwd.md", content), /cwd/);
});

test("isDue fires once per scheduled instant", () => {
  const def = parseRecurFile("proj", "recur-daily-rebase.md", recurContent);
  const before = new Date("2026-07-16T08:00:00+10:00");
  const after = new Date("2026-07-16T09:00:00+10:00");
  assert.equal(isDue(def, undefined, before), false);
  assert.equal(isDue(def, undefined, after), true);
  assert.equal(isDue(def, after.toISOString(), new Date("2026-07-16T10:00:00+10:00")), false);
  assert.equal(isDue(def, after.toISOString(), new Date("2026-07-17T09:00:00+10:00")), true);
});

test("isDue respects the weekly occurrence", () => {
  const def = parseRecurFile("proj", "recur-weekly-status.md", weeklyContent);
  // 2026-07-13 is a Monday.
  const mondayBefore = new Date("2026-07-13T08:00:00+10:00");
  const mondayAfter = new Date("2026-07-13T10:00:00+10:00");
  const laterThatWeek = new Date("2026-07-15T10:00:00+10:00");
  const nextMonday = new Date("2026-07-20T10:00:00+10:00");
  assert.equal(isDue(def, undefined, mondayBefore), false);
  assert.equal(isDue(def, undefined, mondayAfter), true);
  assert.equal(isDue(def, mondayAfter.toISOString(), laterThatWeek), false);
  assert.equal(isDue(def, mondayAfter.toISOString(), nextMonday), true);
});

test("runRecur writes the thread file, registers, records lastRun, launches", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "recur-vault-"));
  await mkdir(path.join(root, "proj"), { recursive: true });
  const sidecarPath = path.join(root, "..", `sidecar-${path.basename(root)}.json`);
  const launches = [];
  const def = parseRecurFile("proj", "recur-daily-rebase.md", recurContent);
  await runRecur(def, {
    launcher: {
      /** Records launches instead of starting tmux. */
      launch: async (args) => { launches.push(args); }
    },
    vaultRoot: root,
    sidecarPath,
    now: new Date("2026-07-16T09:00:00+10:00")
  });
  const thread = await readFile(path.join(root, "proj", "thread-daily-rebase.md"), "utf8");
  assert.match(thread, /status: open/);
  assert.match(thread, /Owner: sonnet worker \(recurring\)/);
  const sidecar = await readSidecar(sidecarPath);
  assert.equal(sidecar.registry["daily-rebase"].tmux, "tg-daily-rebase");
  assert.equal(sidecar.registry["daily-rebase"].worktree, "/tmp");
  assert.equal(sidecar.registry["daily-rebase"].node, "proj");
  assert.ok(sidecar.recur["daily-rebase"].lastRunAt);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].model, "sonnet");
});

test("runRecur upserts an existing thread file without rewriting its body", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "recur-vault-upsert-"));
  await mkdir(path.join(root, "proj"), { recursive: true });
  const sidecarPath = path.join(root, "..", `sidecar-${path.basename(root)}.json`);
  const threadPath = path.join(root, "proj", "thread-daily-rebase.md");
  await writeFile(
    threadPath,
    "---\nstatus: done\nopened: 2026-07-01\nclosed: 2026-07-10\n---\nOwner: sonnet worker (recurring).\n\nHuman-added notes that must survive.\n",
    "utf8"
  );
  const def = parseRecurFile("proj", "recur-daily-rebase.md", recurContent);
  await runRecur(def, {
    launcher: {
      /** Discards launches. */
      launch: async () => {}
    },
    vaultRoot: root,
    sidecarPath,
    now: new Date("2026-07-16T09:00:00+10:00")
  });
  const thread = await readFile(threadPath, "utf8");
  assert.match(thread, /status: open/);
  assert.doesNotMatch(thread, /status: done/);
  assert.match(thread, /Human-added notes that must survive/);
  assert.match(thread, /ran: 2026-07-15T23:00:00\.000Z/);
});

test("scanRecurFiles finds definitions and skips shared", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "recur-scan-"));
  await mkdir(path.join(root, "proj", "shared"), { recursive: true });
  await writeFile(path.join(root, "proj", "recur-daily-rebase.md"), recurContent);
  await writeFile(path.join(root, "proj", "shared", "recur-nope.md"), recurContent);
  const defs = await scanRecurFiles(root);
  assert.deepEqual(defs.map((d) => d.slug), ["daily-rebase"]);
});

test("TmuxWorkerLauncher refuses to launch when cwd does not exist", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "recur-launcher-home-"));
  const launcher = new TmuxWorkerLauncher({ promptDir: path.join(home, "recur-prompts") });
  await assert.rejects(
    () => launcher.launch({ slug: "ghost", cwd: path.join(home, "does-not-exist"), model: "sonnet", prompt: "hi" }),
    /does not exist/
  );
});
