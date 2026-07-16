import { pathExists } from "@tangent/core";
import { runProcess } from "@tangent/agent-runtime/process";
import { sidecarPath as defaultSidecarPath } from "./paths.js";
import { readSidecar } from "./sidecar.js";

/**
 * Opens a registered thread's tmux session in a new full-screen iTerm window, deterministically and
 * with verification. This module exists because the first-generation attach flow (the skill layer
 * improvising an `osascript` call) failed silently in three stacked ways: iTerm's `command` runs
 * without the user's shell PATH (so a bare `tmux` is not found), the default profile closes the
 * window the moment the command exits (so the error was unreadable), and the default profile's
 * window is small. Every step here addresses one of those: absolute tmux path, pre-flight
 * has-session check, explicit full-screen bounds, and a post-launch poll of `tmux list-clients`
 * that proves a client actually attached instead of assuming the window worked.
 */

/** The subset of a finished process the attach flow inspects. */
export type AttachProcessResult = { code: number | null; stdout: string; stderr: string };

/** Runs one external command. Injectable so tests never spawn tmux or osascript. */
export type AttachProcessRunner = (command: string, args: string[], stdin?: string) => Promise<AttachProcessResult>;

export type OpenAttachOptions = {
  slug: string;
  sidecarPath?: string;
  run?: AttachProcessRunner;
  fileExists?: (filePath: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for a tmux client to appear after launching iTerm before declaring failure. */
  verifyTimeoutMs?: number;
};

export type OpenAttachResult = {
  ok: boolean;
  /** Human-readable step/diagnostic lines for the CLI to print. */
  lines: string[];
  /** The attach command to run by hand (in a normal shell, where PATH works) when the automated open fails. */
  manualCommand: string;
};

const tmuxCandidates = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"];

/** Resolves an absolute tmux binary path from well-known install locations, falling back to a bare "tmux" (which only works where PATH is sane, i.e. never inside iTerm's profile command). */
export async function resolveTmuxBinary(fileExists: (filePath: string) => Promise<boolean> = pathExists): Promise<string> {
  for (const candidate of tmuxCandidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return "tmux";
}

/** tmux session names and slugs this flow will embed into an AppleScript string literal. Anything else is rejected up front rather than escaped. */
const safeName = /^[A-Za-z0-9._-]+$/;

const defaultVerifyTimeoutMs = 6000;
const verifyIntervalMs = 300;

/** Default runner: a real process via @tangent/agent-runtime, capped so a hung osascript cannot hang the CLI. */
const defaultRunner: AttachProcessRunner = (command, args, stdin) => runProcess({ command, args, stdin, timeoutMs: 20000 });

/**
 * Opens the registered thread's tmux session in a new full-screen iTerm window: verifies the
 * session exists, ensures the two-pane working layout (worker left, nvim file tree right), launches
 * iTerm via AppleScript with an absolute tmux path, and then polls `tmux list-clients` until a new
 * client appears. Returns a report instead of throwing for every operational failure (missing
 * session, osascript error, no client attached) so the CLI can always print the manual command;
 * only an unknown slug throws, since there is nothing to attach to at all.
 */
export async function openAttach(options: OpenAttachOptions): Promise<OpenAttachResult> {
  const run = options.run || defaultRunner;
  const fileExists = options.fileExists || pathExists;
  const sleep = options.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const verifyTimeoutMs = options.verifyTimeoutMs ?? defaultVerifyTimeoutMs;

  const sidecar = await readSidecar(options.sidecarPath || defaultSidecarPath());
  const entry = sidecar.registry[options.slug];
  if (!entry) {
    const known = Object.keys(sidecar.registry).sort().join(", ") || "(none)";
    throw new Error(`No registered thread named ${JSON.stringify(options.slug)}. Known threads: ${known}.`);
  }

  const tmuxBin = await resolveTmuxBinary(fileExists);
  const manualCommand = `tmux attach -t ${entry.tmux}`;
  const lines: string[] = [];

  if (!safeName.test(entry.tmux)) {
    return { ok: false, lines: [`refusing to attach: tmux session name ${JSON.stringify(entry.tmux)} contains characters unsafe to script.`], manualCommand };
  }

  const hasSession = await run(tmuxBin, ["has-session", "-t", entry.tmux]);
  if (hasSession.code !== 0) {
    const sessions = await run(tmuxBin, ["ls"]);
    lines.push(`tmux session ${entry.tmux} is not running (the worker exited or was never started).`);
    lines.push(sessions.code === 0 && sessions.stdout.trim() ? `live sessions:\n${sessions.stdout.trimEnd()}` : "no tmux sessions are running at all.");
    return { ok: false, lines, manualCommand };
  }

  await ensureWorkerLayout(run, tmuxBin, entry.tmux, entry.worktree, fileExists, lines);

  const clientsBefore = await listClientTtys(run, tmuxBin, entry.tmux);
  const launch = await run("osascript", [], attachAppleScript(tmuxBin, entry.tmux));
  if (launch.code !== 0) {
    lines.push(`iTerm launch failed (osascript exit ${launch.code}): ${launch.stderr.trim() || "(no stderr)"}`);
    return { ok: false, lines, manualCommand };
  }

  const deadline = Date.now() + verifyTimeoutMs;
  while (Date.now() < deadline) {
    const clients = await listClientTtys(run, tmuxBin, entry.tmux);
    if ([...clients].some((tty) => !clientsBefore.has(tty))) {
      lines.push(`attached ${entry.tmux} in a new iTerm window (worker left, nvim right).`);
      return { ok: true, lines, manualCommand };
    }
    await sleep(verifyIntervalMs);
  }
  lines.push(`iTerm window launched but no tmux client attached within ${verifyTimeoutMs}ms; the window may have closed with an error.`);
  return { ok: false, lines, manualCommand };
}

/**
 * Ensures the session has the two-pane working layout: when it still has a single pane and the
 * registered worktree exists, splits a right-hand pane running `nvim .` in the worktree and puts
 * focus back on the worker pane. Layout failures are reported but never abort the attach; a
 * one-pane attach is still useful.
 */
async function ensureWorkerLayout(
  run: AttachProcessRunner,
  tmuxBin: string,
  session: string,
  worktree: string,
  fileExists: (filePath: string) => Promise<boolean>,
  lines: string[]
): Promise<void> {
  const panes = await run(tmuxBin, ["list-panes", "-t", session, "-F", "#{pane_id}"]);
  if (panes.code !== 0) return;
  const paneIds = panes.stdout.trim().split("\n").filter(Boolean);
  if (paneIds.length !== 1) return;
  if (!worktree || !(await fileExists(worktree))) return;
  const split = await run(tmuxBin, ["split-window", "-h", "-t", session, "-c", worktree, "nvim", "."]);
  if (split.code !== 0) {
    lines.push(`could not add the nvim pane: ${split.stderr.trim()}`);
    return;
  }
  await run(tmuxBin, ["select-pane", "-t", paneIds[0]!]);
}

/** Lists the ttys of clients currently attached to the session, as a set for before/after comparison. */
async function listClientTtys(run: AttachProcessRunner, tmuxBin: string, session: string): Promise<Set<string>> {
  const result = await run(tmuxBin, ["list-clients", "-t", session, "-F", "#{client_tty}"]);
  if (result.code !== 0) return new Set();
  return new Set(result.stdout.trim().split("\n").filter(Boolean));
}

/**
 * The AppleScript that opens the attach window: a new iTerm window running `tmux attach` via the
 * absolute tmux path (iTerm profile commands do not get the user's shell PATH), sized to the full
 * screen (the default profile's window is small), then brought to the front. Fed to osascript via
 * stdin so nothing here needs shell quoting.
 */
export function attachAppleScript(tmuxBin: string, session: string): string {
  return [
    `tell application "Finder" to set screenBounds to bounds of window of desktop`,
    `tell application "iTerm2"`,
    `  set newWindow to (create window with default profile command "${tmuxBin} attach -t ${session}")`,
    `  set bounds of newWindow to screenBounds`,
    `  activate`,
    `end tell`
  ].join("\n");
}
