import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Opens a new iTerm2 tab in the current window running the given command.
 * Requires iTerm2 to already be running on macOS.
 */
export async function openIterm2Tab(command: string, cwd: string): Promise<void> {
  const escaped = shellCommand(command, cwd);
  const script = `
    tell application "iTerm2"
      tell current window
        create tab with default profile command ${appleScriptString(escaped)}
      end tell
    end tell
  `;
  await execFileAsync("osascript", ["-e", script]);
}

/**
 * Opens a new iTerm2 window running the given command.
 * Requires iTerm2 to already be running on macOS.
 */
export async function openIterm2Window(command: string, cwd: string): Promise<void> {
  const escaped = shellCommand(command, cwd);
  const script = `
    tell application "iTerm2"
      create window with default profile command ${appleScriptString(escaped)}
    end tell
  `;
  await execFileAsync("osascript", ["-e", script]);
}

/** Wraps a command in a login zsh invocation so PATH includes user profile entries. */
function shellCommand(command: string, cwd: string): string {
  const inner = `cd ${shellEscape(cwd)} && ${command}`;
  return `zsh -lc ${shellEscape(inner)}`;
}

/** Single-quotes a value for safe shell interpolation. */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Double-quotes a value for safe AppleScript string interpolation. */
function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
