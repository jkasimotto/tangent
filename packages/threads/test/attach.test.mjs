import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { attachAppleScript, openAttach, resolveTmuxBinary } from "../dist/core/attach.js";

/** Writes a sidecar file registering one thread and returns its path. */
async function sidecarWith(registry) {
  const dir = await mkdtemp(path.join(tmpdir(), "threads-attach-"));
  const sidecarPath = path.join(dir, "sidecar.json");
  await writeFile(sidecarPath, JSON.stringify({ registry }, null, 2));
  return sidecarPath;
}

const entry = { node: "neara/pgande", worktree: "/work/tree", tmux: "tg-fix", registeredAt: "2026-07-16T00:00:00.000Z" };

/**
 * Builds a scripted AttachProcessRunner: responses maps a "command arg0 arg1" prefix to a result,
 * or to an array of results consumed call by call (the last one repeats) for stateful sequences.
 * Every call is recorded for assertions, and anything unscripted succeeds with empty output.
 */
function scriptedRunner(responses) {
  const calls = [];
  const counts = new Map();
  /** The AttachProcessRunner handed to openAttach; records and answers each call. */
  const run = async (command, args, stdin) => {
    calls.push({ command, args, stdin });
    const joined = `${command} ${args.join(" ")}`;
    for (const [prefix, result] of Object.entries(responses)) {
      if (joined.startsWith(prefix)) {
        const n = counts.get(prefix) || 0;
        counts.set(prefix, n + 1);
        return Array.isArray(result) ? result[Math.min(n, result.length - 1)] : result;
      }
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

/** A successful process result with the given stdout. */
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
/** A failed process result with the given stderr. */
const fail = (stderr = "boom") => ({ code: 1, stdout: "", stderr });

/** A runner for flows that must fail before ever running a process. */
const neverCalledRunner = async () => ok();

/** Standard injectable options for a fast, process-free openAttach. */
function fakeOptions(runner, overrides = {}) {
  return {
    slug: "fix",
    run: runner.run,
    /** Every path exists in these tests unless a test overrides it. */
    fileExists: async () => true,
    /** No real waiting in tests. */
    sleep: async () => {},
    verifyTimeoutMs: 1000,
    ...overrides
  };
}

test("an unknown slug throws and names the registered threads", async () => {
  const sidecarPath = await sidecarWith({ fix: entry });
  await assert.rejects(
    openAttach({ slug: "nope", sidecarPath, run: neverCalledRunner }),
    /No registered thread named "nope"\. Known threads: fix\./
  );
});

test("a missing tmux session reports failure with the live session list and the manual command", async () => {
  const sidecarPath = await sidecarWith({ fix: entry });
  const runner = scriptedRunner({
    "/opt/homebrew/bin/tmux has-session": fail("no such session"),
    "/opt/homebrew/bin/tmux ls": ok("tg-other: 1 windows")
  });
  const result = await openAttach(fakeOptions(runner, { sidecarPath }));
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /tg-fix is not running/);
  assert.match(result.lines[1], /tg-other/);
  assert.equal(result.manualCommand, "tmux attach -t tg-fix");
});

test("a single-pane session gets the nvim pane split in the worktree with focus returned to the worker", async () => {
  const sidecarPath = await sidecarWith({ fix: entry });
  const runner = scriptedRunner({
    "/opt/homebrew/bin/tmux list-panes": ok("%0\n"),
    "/opt/homebrew/bin/tmux list-clients": [ok(""), ok("/dev/ttys009\n")]
  });
  const result = await openAttach(fakeOptions(runner, { sidecarPath }));
  assert.equal(result.ok, true);
  const split = runner.calls.find((call) => call.args[0] === "split-window");
  assert.deepEqual(split.args, ["split-window", "-h", "-t", "tg-fix", "-c", "/work/tree", "nvim", "."]);
  const select = runner.calls.find((call) => call.args[0] === "select-pane");
  assert.deepEqual(select.args, ["select-pane", "-t", "%0"]);
});

test("a session that already has two panes is not split again", async () => {
  const sidecarPath = await sidecarWith({ fix: entry });
  const runner = scriptedRunner({
    "/opt/homebrew/bin/tmux list-panes": ok("%0\n%1\n"),
    "/opt/homebrew/bin/tmux list-clients": [ok(""), ok("/dev/ttys009\n")]
  });
  await openAttach(fakeOptions(runner, { sidecarPath }));
  assert.ok(!runner.calls.some((call) => call.args[0] === "split-window"));
});

test("iTerm is launched via osascript stdin with the absolute tmux path, full-screen bounds, and activation", async () => {
  const sidecarPath = await sidecarWith({ fix: entry });
  const runner = scriptedRunner({
    "/opt/homebrew/bin/tmux list-panes": ok("%0\n%1\n"),
    "/opt/homebrew/bin/tmux list-clients": [ok(""), ok("/dev/ttys009\n")]
  });
  const result = await openAttach(fakeOptions(runner, { sidecarPath }));
  assert.equal(result.ok, true);
  const launch = runner.calls.find((call) => call.command === "osascript");
  assert.match(launch.stdin, /"\/opt\/homebrew\/bin\/tmux attach -t tg-fix"/);
  assert.match(launch.stdin, /set bounds of newWindow to screenBounds/);
  assert.match(launch.stdin, /activate/);
});

test("an osascript failure reports its stderr and the manual command instead of pretending it worked", async () => {
  const sidecarPath = await sidecarWith({ fix: entry });
  const runner = scriptedRunner({
    "/opt/homebrew/bin/tmux list-panes": ok("%0\n%1\n"),
    osascript: fail("iTerm got an error")
  });
  const result = await openAttach(fakeOptions(runner, { sidecarPath }));
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /iTerm got an error/);
  assert.equal(result.manualCommand, "tmux attach -t tg-fix");
});

test("a window that opens but never attaches a new tmux client is a failure, even when a client was already attached elsewhere", async () => {
  const sidecarPath = await sidecarWith({ fix: entry });
  const runner = scriptedRunner({
    "/opt/homebrew/bin/tmux list-panes": ok("%0\n%1\n"),
    "/opt/homebrew/bin/tmux list-clients": ok("/dev/ttys001\n")
  });
  const result = await openAttach(fakeOptions(runner, { sidecarPath, verifyTimeoutMs: 1 }));
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /no tmux client attached/);
});

test("a scripting-unsafe tmux session name is refused rather than escaped", async () => {
  const sidecarPath = await sidecarWith({ fix: { ...entry, tmux: 'tg-x"; do shell script "rm' } });
  const runner = scriptedRunner({});
  const result = await openAttach(fakeOptions(runner, { sidecarPath }));
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /unsafe to script/);
  assert.equal(runner.calls.length, 0);
});

test("resolveTmuxBinary picks the first existing well-known path and falls back to a bare tmux", async () => {
  assert.equal(await resolveTmuxBinary(async (p) => p === "/usr/local/bin/tmux"), "/usr/local/bin/tmux");
  assert.equal(await resolveTmuxBinary(async () => false), "tmux");
});

test("attachAppleScript embeds the binary and session into a full window script", () => {
  const script = attachAppleScript("/usr/bin/tmux", "tg-a");
  assert.match(script, /create window with default profile command "\/usr\/bin\/tmux attach -t tg-a"/);
  assert.match(script, /tell application "Finder" to set screenBounds/);
});
