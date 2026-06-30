import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";

// Terminal emulators tried in order when no $TERMINAL is set. x-terminal-emulator
// is first so the Debian/Ubuntu "default terminal" alternative wins when present.
const TERMINAL_CANDIDATES = [
  "x-terminal-emulator",
  "gnome-terminal",
  "konsole",
  "xfce4-terminal",
  "alacritty",
  "kitty",
  "xterm"
];

/**
 * Opens a Linux terminal emulator running the given command in cwd. This is the
 * non-macOS counterpart to the iTerm2 driver: macOS uses AppleScript via osascript,
 * which does not exist on Linux, so the launcher would otherwise fail with ENOENT.
 *
 * Most terminals inherit the working directory from the spawning process, so cwd is
 * passed to spawn and only gnome-terminal/konsole get an explicit working-dir flag.
 * The command runs under `bash -lc` so login-shell PATH (e.g. the `claude` binary) resolves.
 */
export async function openLinuxTerminal(command: string, cwd: string, _title?: string): Promise<void> {
  const program = await firstAvailableTerminal();
  if (!program) {
    throw new Error(
      "No Linux terminal emulator found on PATH. Set $TERMINAL to your terminal, or configure a custom launcher driver in ~/.tangent/launcher/config.json " +
      "(for example: { \"driver\": { \"type\": \"custom\", \"template\": \"gnome-terminal --working-directory={cwd} -- bash -lc '{cmd}'\" } })."
    );
  }
  const child = spawn(program, terminalArgs(path.basename(program), command, cwd), {
    cwd,
    stdio: "ignore",
    detached: true
  });
  child.unref();
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
}

/** Returns the first usable terminal: $TERMINAL if set and on PATH, else the first available candidate. */
async function firstAvailableTerminal(): Promise<string | undefined> {
  const preferred = process.env["TERMINAL"];
  if (preferred) {
    const resolved = await resolveOnPath(preferred);
    if (resolved) return resolved;
  }
  for (const candidate of TERMINAL_CANDIDATES) {
    const resolved = await resolveOnPath(candidate);
    if (resolved) return resolved;
  }
  return undefined;
}

/** Resolves an executable name to an absolute path via PATH, or undefined when not found. */
async function resolveOnPath(name: string): Promise<string | undefined> {
  if (name.includes("/")) {
    return (await isExecutable(name)) ? name : undefined;
  }
  for (const dir of (process.env["PATH"] || "").split(path.delimiter).filter(Boolean)) {
    const full = path.join(dir, name);
    if (await isExecutable(full)) return full;
  }
  return undefined;
}

/** Tests whether a path is an executable file. */
async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Builds the argv that runs `command` in the given terminal, accounting for per-terminal flag quirks. */
function terminalArgs(program: string, command: string, cwd: string): string[] {
  const runner = ["bash", "-lc", command];
  switch (program) {
    case "gnome-terminal":
      // gnome-terminal deprecated -e; use -- and an explicit working directory.
      return [`--working-directory=${cwd}`, "--", ...runner];
    case "konsole":
      return ["--workdir", cwd, "-e", ...runner];
    case "kitty":
      // kitty takes the program directly, without -e.
      return runner;
    default:
      // x-terminal-emulator, xfce4-terminal, alacritty, xterm, urxvt, st, and others.
      return ["-e", ...runner];
  }
}
