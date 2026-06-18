import { loadLaunchConfig } from "./config.js";
import type { LaunchConfig } from "./config.js";
import type { LaunchSession } from "./sessions.js";
import { openIterm2Tab } from "./drivers/iterm2.js";
import { focusIterm2SessionById, focusIterm2SessionByName } from "./drivers/iterm2.js";

/** Focuses a live session: brings the iTerm2 tab to front, or opens a new terminal attached to the tmux session. */
export async function focusSession(session: LaunchSession, config?: LaunchConfig): Promise<void> {
  if (session.tmuxSession) {
    const effectiveConfig = config ?? await loadLaunchConfig();
    const { driver } = effectiveConfig;
    const attachCmd = `tmux attach-session -t ${shellEscape(session.tmuxSession)}`;
    if (driver === "iterm2-tab" || driver === "iterm2-window") {
      await openIterm2Tab(attachCmd, session.cwd);
    }
    return;
  }
  if (session.iterm2SessionId) {
    await focusIterm2SessionById(session.iterm2SessionId);
  } else if (session.title) {
    await focusIterm2SessionByName(session.title);
  }
}

/** Single-quotes a value for safe shell interpolation. */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
