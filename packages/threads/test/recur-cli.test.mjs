// isDue reads local calendar fields (see recur.ts), and the fixtures below are written as +10:00
// wall-clock times (Sydney). Pin the process timezone before any Date is constructed so this file
// passes regardless of the machine/CI's actual local timezone.
process.env.TZ = "Australia/Sydney";

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runThreadsCli } from "../dist/cli/index.js";
import { runRecurDue } from "../dist/sdk/index.js";

/**
 * Runs the threads CLI's `recur` verbs against an isolated vault, capturing printed lines. Only
 * `--dry-run` is exercised at the CLI layer: the CLI wires the real TmuxWorkerLauncher, and a
 * dry run never reaches it, so this stays a unit test with no tmux dependency.
 */
async function runRecurCapturing(argv, home, vaultRoot) {
  const previousHome = process.env.TANGENT_HOME;
  const previousTrees = process.env.TANGENT_TREES_DIR;
  process.env.TANGENT_HOME = home;
  process.env.TANGENT_TREES_DIR = vaultRoot;
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    await runThreadsCli(argv);
  } finally {
    console.log = originalLog;
    if (previousHome === undefined) delete process.env.TANGENT_HOME;
    else process.env.TANGENT_HOME = previousHome;
    if (previousTrees === undefined) delete process.env.TANGENT_TREES_DIR;
    else process.env.TANGENT_TREES_DIR = previousTrees;
  }
  return lines;
}

test("recur due runs only due definitions and honors dry-run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "recur-due-"));
  await mkdir(path.join(root, "proj"), { recursive: true });
  await writeFile(path.join(root, "proj", "recur-daily-rebase.md"),
    ["---", "schedule: daily 08:30", "cwd: /tmp", "---", "Do the rebase."].join("\n"));
  const launches = [];
  const deps = {
    launcher: {
      /** Records launches for assertions. */
      launch: async (args) => { launches.push(args.slug); }
    },
    vaultRoot: root,
    sidecarPath: path.join(root, "..", `sidecar-${path.basename(root)}.json`),
    now: new Date("2026-07-16T09:00:00+10:00")
  };
  const dry = await runRecurDue({ ...deps, dryRun: true });
  assert.deepEqual(dry.due.map((d) => d.slug), ["daily-rebase"]);
  assert.equal(launches.length, 0);
  const wet = await runRecurDue(deps);
  assert.deepEqual(wet.ran.map((d) => d.slug), ["daily-rebase"]);
  assert.deepEqual(launches, ["daily-rebase"]);
  const again = await runRecurDue({ ...deps, now: new Date("2026-07-16T10:00:00+10:00") });
  assert.equal(again.ran.length, 0);
});

test("runRecurDue isolates one definition's launch failure: the other def still runs and the failing one is not recorded", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "recur-due-isolation-"));
  await mkdir(path.join(root, "proj"), { recursive: true });
  await writeFile(path.join(root, "proj", "recur-a.md"),
    ["---", "schedule: daily 08:30", "cwd: /tmp", "---", "Def A."].join("\n"));
  await writeFile(path.join(root, "proj", "recur-b.md"),
    ["---", "schedule: daily 08:30", "cwd: /tmp", "---", "Def B."].join("\n"));
  const launched = [];
  const launcher = {
    /** Def A always fails to launch; def B always succeeds. */
    launch: async (args) => {
      if (args.slug === "a") throw new Error("tmux session tg-a still running; skipped");
      launched.push(args.slug);
    }
  };
  const sidecarPath = path.join(root, "..", `sidecar-${path.basename(root)}.json`);
  const now = new Date("2026-07-16T09:00:00+10:00");

  const originalError = console.error;
  const errors = [];
  console.error = (line) => errors.push(String(line));
  let result;
  try {
    result = await runRecurDue({ launcher, vaultRoot: root, sidecarPath, now });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(result.due.map((d) => d.slug).sort(), ["a", "b"]);
  assert.deepEqual(result.ran.map((d) => d.slug), ["b"]);
  assert.deepEqual(launched, ["b"]);
  assert.ok(errors.some((line) => line.includes("a") && line.includes("still running; skipped")), `expected a stderr line naming def "a"; got: ${JSON.stringify(errors)}`);

  const { readSidecar } = await import("../dist/core/sidecar.js");
  const sidecar = await readSidecar(sidecarPath);
  assert.equal(sidecar.recur?.a, undefined);
  assert.ok(sidecar.recur?.b?.lastRunAt);
});

test("CLI: recur due reports nothing due for an empty vault", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "tangent-recur-cli-empty-"));
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "tangent-recur-cli-empty-vault-"));
  const lines = await runRecurCapturing(["recur", "due", "--dry-run"], home, vaultRoot);
  assert.deepEqual(lines, ["recur: nothing due"]);
});

test("CLI: recur run <slug> --dry-run prints a would-launch line without dispatching", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "tangent-recur-cli-run-"));
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "tangent-recur-cli-run-vault-"));
  await mkdir(path.join(vaultRoot, "proj"), { recursive: true });
  await writeFile(path.join(vaultRoot, "proj", "recur-daily-rebase.md"),
    ["---", "schedule: daily 08:30", "cwd: /tmp", "---", "Do the rebase."].join("\n"));
  const lines = await runRecurCapturing(["recur", "run", "daily-rebase", "--dry-run"], home, vaultRoot);
  assert.deepEqual(lines, ["recur: would launch daily-rebase (tg-daily-rebase)"]);
});

test("CLI: recur run on an unknown slug errors clearly, listing known slugs", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "tangent-recur-cli-unknown-"));
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "tangent-recur-cli-unknown-vault-"));
  await mkdir(path.join(vaultRoot, "proj"), { recursive: true });
  await writeFile(path.join(vaultRoot, "proj", "recur-daily-rebase.md"),
    ["---", "schedule: daily 08:30", "cwd: /tmp", "---", "Do the rebase."].join("\n"));
  await assert.rejects(
    runRecurCapturing(["recur", "run", "no-such-slug"], home, vaultRoot),
    /Unknown recur slug "no-such-slug"\. Known recur slugs: daily-rebase\./
  );
});
