import { openTerminalSession } from "./resolve.js";
import { loadLaunchConfig, saveLaunchConfig } from "./config.js";
import type { LaunchConfig } from "./config.js";

export type { LaunchConfig, DriverId, CustomDriver } from "./config.js";
export { loadLaunchConfig, saveLaunchConfig, defaultLaunchConfig, configPath } from "./config.js";
export type { LaunchSession } from "./sessions.js";
export { listActiveSessions } from "./sessions.js";
export { stopSession } from "./stop.js";
export { focusSession } from "./focus.js";

export interface OpenOptions {
  config?: LaunchConfig;
  /** Label shown as the terminal tab/window title. */
  title?: string;
  name?: string;
  estimateMinutes?: number;
}

/** Opens a new terminal session running the configured agent command in cwd. */
export async function openAgent(cwd: string, options: OpenOptions = {}): Promise<void> {
  const config = options.config ?? await loadLaunchConfig();
  await openTerminalSession(config.agentCommand, cwd, config, "agent", options.title, options.name, options.estimateMinutes);
}

/** Opens a new terminal session at path with no agent command (shell login). */
export async function openDirectory(dirPath: string, options: OpenOptions = {}): Promise<void> {
  const config = options.config ?? await loadLaunchConfig();
  const shell = process.env["SHELL"] || "bash";
  await openTerminalSession(shell, dirPath, config, "terminal", options.title);
}
