import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openIterm2Tab, openIterm2Window } from "./drivers/iterm2.js";
import { openLinuxTerminal } from "./drivers/linux.js";
import { openCustom } from "./drivers/custom.js";
import { recordSession, cwdSessionName } from "./sessions.js";
import type { LaunchConfig } from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * Opens a terminal session running the given command in cwd, honoring the
 * tmux flag and driver configuration.
 *
 * When tmux is true and a tmux session is active ($TMUX is set), this creates
 * a new tmux window directly without invoking the driver. When tmux is true
 * but no session is active, the driver opens a terminal that runs
 * `tmux new-session` internally. When tmux is false, the driver runs the
 * command directly.
 */
export async function openTerminalSession(
  command: string,
  cwd: string,
  config: LaunchConfig,
  kind: "agent" | "terminal" = "agent",
  title?: string,
  name?: string,
  estimateMinutes?: number
): Promise<void> {
  if (config.tmux && process.env["TMUX"]) {
    await execFileAsync("tmux", ["new-window", "-c", cwd, command]);
    await recordSession({ cwd, kind, tmux: true, startedAt: new Date().toISOString(), name, estimateMinutes });
    return;
  }

  let tmuxSession: string | undefined;
  let actualCommand: string;
  if (config.tmux) {
    tmuxSession = cwdSessionName(cwd);
    actualCommand = `tmux new-session -s ${shellEscape(tmuxSession)} -c ${shellEscape(cwd)} ${shellEscape(command)}`;
  } else {
    actualCommand = command;
  }

  const { driver } = config;
  let iterm2SessionId: string | undefined;
  if (driver === "iterm2-tab") {
    iterm2SessionId = await openIterm2Tab(actualCommand, cwd, title);
  } else if (driver === "iterm2-window") {
    iterm2SessionId = await openIterm2Window(actualCommand, cwd, title);
  } else if (driver === "linux-terminal") {
    await openLinuxTerminal(actualCommand, cwd, title);
  } else if (driver.type === "custom") {
    await openCustom(driver.template, actualCommand, cwd);
  } else {
    throw new Error(`Unknown launcher driver: ${JSON.stringify(driver)}`);
  }

  await recordSession({ cwd, kind, tmux: config.tmux, tmuxSession, title, iterm2SessionId, startedAt: new Date().toISOString(), name, estimateMinutes });
}

/** Single-quotes a value for safe shell interpolation. */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
