import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type DriverId = "iterm2-tab" | "iterm2-window" | "linux-terminal";

export interface CustomDriver {
  type: "custom";
  /** Shell template. Use {cmd} and {cwd} tokens. */
  template: string;
}

export interface LaunchConfig {
  /** Which terminal driver to use for opening new sessions. */
  driver: DriverId | CustomDriver;
  /** Wrap the launched command in a new tmux window or session. */
  tmux: boolean;
  /** The agent command to run (e.g. "claude"). */
  agentCommand: string;
}

/** Returns the built-in default launcher configuration. The terminal driver is
 * platform-aware: macOS drives iTerm2 via AppleScript, every other platform opens
 * a generic terminal emulator (iTerm2/osascript does not exist off macOS). */
export function defaultLaunchConfig(): LaunchConfig {
  return {
    driver: process.platform === "darwin" ? "iterm2-tab" : "linux-terminal",
    tmux: false,
    agentCommand: "claude"
  };
}

/** Returns the path to the launcher config file (~/.tangent/launcher/config.json). */
export function configPath(): string {
  const home = process.env["TANGENT_HOME"] || path.join(os.homedir(), ".tangent");
  return path.join(home, "launcher", "config.json");
}

/** Loads config from disk; falls back to defaults if the file is missing or unreadable. */
export async function loadLaunchConfig(): Promise<LaunchConfig> {
  const filePath = configPath();
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as Partial<LaunchConfig>;
    return { ...defaultLaunchConfig(), ...parsed };
  } catch {
    return defaultLaunchConfig();
  }
}

/** Writes config to disk, creating the parent directory if needed. */
export async function saveLaunchConfig(config: LaunchConfig): Promise<void> {
  const filePath = configPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
