import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Opens a new iTerm2 tab in the current window running the given command.
 * Returns the iTerm2 session unique ID, which is stable even after the tab title changes.
 * Requires iTerm2 to already be running on macOS.
 */
export async function openIterm2Tab(command: string, cwd: string, title?: string): Promise<string> {
  const escaped = shellCommand(command, cwd);
  const nameStmt = title ? `set name of current session of newTab to ${appleScriptString(title)}` : "";
  const script = `
    tell application "iTerm2"
      activate
      tell current window
        set newTab to (create tab with default profile command ${appleScriptString(escaped)})
        select newTab
        ${nameStmt}
        return unique ID of current session of newTab
      end tell
    end tell
  `;
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  return stdout.trim();
}

/**
 * Opens a new iTerm2 window running the given command.
 * Returns the iTerm2 session unique ID, which is stable even after the tab title changes.
 * Requires iTerm2 to already be running on macOS.
 */
export async function openIterm2Window(command: string, cwd: string, title?: string): Promise<string> {
  const escaped = shellCommand(command, cwd);
  const nameStmt = title ? `set name of current session of newWindow to ${appleScriptString(title)}` : "";
  const script = `
    tell application "iTerm2"
      activate
      set newWindow to (create window with default profile command ${appleScriptString(escaped)})
      ${nameStmt}
      return unique ID of current session of newWindow
    end tell
  `;
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  return stdout.trim();
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

/**
 * Lists all open iTerm2 sessions as `{id, name}` pairs. Returns empty array if
 * iTerm2 is not running or AppleScript fails. The unique ID is stable even after
 * the running process overrides the tab title.
 */
export async function listIterm2Sessions(): Promise<Array<{ id: string; name: string }>> {
  const script = `
    tell application "iTerm2"
      set out to {}
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            set end of out to (unique ID of s) & "|||" & (name of s)
          end repeat
        end repeat
      end repeat
      return out
    end tell
  `;
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    return stdout.trim().split(", ").filter(Boolean).map((entry) => {
      const sep = entry.indexOf("|||");
      return sep >= 0
        ? { id: entry.slice(0, sep), name: entry.slice(sep + 3) }
        : { id: entry, name: "" };
    });
  } catch {
    return [];
  }
}

/** Closes the iTerm2 tab identified by the given session unique ID. No-op if not found. */
export async function closeIterm2SessionById(sessionId: string): Promise<void> {
  const script = `
    tell application "iTerm2"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if unique ID of s is ${appleScriptString(sessionId)} then
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
    // session not found or iTerm2 not running
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

/** Brings the iTerm2 tab identified by the given session unique ID to the foreground. No-op if not found. */
export async function focusIterm2SessionById(sessionId: string): Promise<void> {
  const script = `
    tell application "iTerm2"
      activate
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if unique ID of s is ${appleScriptString(sessionId)} then
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
    // session not found or iTerm2 not running
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
