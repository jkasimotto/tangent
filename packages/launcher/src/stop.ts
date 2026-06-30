import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { removeSession } from "./sessions.js";
import type { LaunchSession } from "./sessions.js";
import { closeIterm2SessionById, closeIterm2SessionByName } from "./drivers/iterm2.js";

const execFileAsync = promisify(execFile);

/** Kills a session: terminates the tmux session or closes the iTerm2 tab, then removes it from sessions.json. */
export async function stopSession(session: LaunchSession): Promise<void> {
  if (session.tmuxSession) {
    try {
      await execFileAsync("tmux", ["kill-session", "-t", session.tmuxSession]);
    } catch {
      // already gone
    }
  } else if (session.iterm2SessionId) {
    await closeIterm2SessionById(session.iterm2SessionId);
  } else if (session.title) {
    await closeIterm2SessionByName(session.title);
  }
  await removeSession(session.cwd, session.startedAt);
}
