import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Opens a new iTerm2 tab in the current window running the given command.
 * Requires iTerm2 to already be running on macOS.
 */
export async function openIterm2Tab(command: string, cwd: string, title?: string): Promise<void> {
  const escaped = shellCommand(command, cwd);
  const nameStmt = title ? `set name of current session of newTab to ${appleScriptString(title)}` : "";
  const script = `
    tell application "iTerm2"
      activate
      tell current window
        set newTab to (create tab with default profile command ${appleScriptString(escaped)})
        select newTab
        ${nameStmt}
      end tell
    end tell
  `;
  await execFileAsync("osascript", ["-e", script]);
}

/**
 * Opens a new iTerm2 window running the given command.
 * Requires iTerm2 to already be running on macOS.
 */
export async function openIterm2Window(command: string, cwd: string, title?: string): Promise<void> {
  const escaped = shellCommand(command, cwd);
  const nameStmt = title ? `set name of current session of newWindow to ${appleScriptString(title)}` : "";
  const script = `
    tell application "iTerm2"
      activate
      set newWindow to (create window with default profile command ${appleScriptString(escaped)})
      ${nameStmt}
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

/** Lists the names of all currently open iTerm2 sessions across all windows and tabs. Returns empty array if iTerm2 is not running or AppleScript fails. */
export async function listIterm2SessionNames(): Promise<string[]> {
  const script = `
    tell application "iTerm2"
      set out to {}
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            set end of out to name of s
          end repeat
        end repeat
      end repeat
      return out
    end tell
  `;
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    return stdout.trim().split(", ").filter(Boolean);
  } catch {
    return [];
  }
}

/** Closes the first iTerm2 tab whose session name matches the given title. No-op if not found. */
export async function closeIterm2SessionByName(title: string): Promise<void> {
  const script = `
    tell application "iTerm2"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if name of s is ${appleScriptString(title)} then
              close t
              return
            end if
          end repeat
        end repeat
      end repeat
    end tell
  `;
  try {
    await execFileAsync("osascript", ["-e", script]);
  } catch {
    // tab not found or iTerm2 not running
  }
}

/** Brings the iTerm2 tab with the given session name to the foreground. No-op if not found. */
export async function focusIterm2SessionByName(title: string): Promise<void> {
  const script = `
    tell application "iTerm2"
      activate
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if name of s is ${appleScriptString(title)} then
              set index of w to 1
              select t
              return
            end if
          end repeat
        end repeat
      end repeat
    end tell
  `;
  try {
    await execFileAsync("osascript", ["-e", script]);
  } catch {
    // tab not found or iTerm2 not running
  }
}

/** Double-quotes a value for safe AppleScript string interpolation. */
function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
