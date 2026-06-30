import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * How a notification is delivered. "auto" picks the OS default (osascript on
 * macOS, notify-send on Linux). "custom" runs a user shell template with {title}
 * and {body} tokens, mirroring the launcher's custom terminal driver.
 */
export type NotifyDriver = "auto" | "macos" | "linux" | "none" | { type: "custom"; template: string };

/** Which agent lifecycle events fire a notification. */
export interface NotifyEvents {
  done: boolean;
  needsInput: boolean;
  failed: boolean;
}

export interface NotifyConfig {
  driver: NotifyDriver;
  /** Watcher poll interval in seconds. */
  pollSeconds: number;
  events: NotifyEvents;
}

/** Returns the built-in default notify configuration. */
export function defaultNotifyConfig(): NotifyConfig {
  return { driver: "auto", pollSeconds: 5, events: { done: true, needsInput: true, failed: false } };
}

/** Returns the path to the notify config file (~/.tangent/notify/config.json). */
export function notifyConfigPath(): string {
  const home = process.env["TANGENT_HOME"] || path.join(os.homedir(), ".tangent");
  return path.join(home, "notify", "config.json");
}

/** Loads notify config from disk; falls back to defaults if missing or unreadable. A partial `events` object still merges over the defaults. */
export function loadNotifyConfig(): NotifyConfig {
  const defaults = defaultNotifyConfig();
  try {
    const parsed = JSON.parse(readFileSync(notifyConfigPath(), "utf8")) as Partial<NotifyConfig>;
    return { ...defaults, ...parsed, events: { ...defaults.events, ...parsed.events } };
  } catch {
    return defaults;
  }
}

/** Strips newlines, neutralizes double quotes, and caps length so the value is safe to embed. */
function sanitize(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/"/g, "'").slice(0, 200);
}

/**
 * Fires a desktop notification using the configured driver. Fire-and-forget and
 * never throws: a missing binary or a broken template must not break the caller
 * (e.g. the usage transcript watcher).
 */
export async function notify(input: { title: string; body: string }, config: NotifyConfig): Promise<void> {
  const driver = config.driver === "auto" ? (process.platform === "darwin" ? "macos" : process.platform === "linux" ? "linux" : "none") : config.driver;
  const title = sanitize(input.title);
  const body = sanitize(input.body);
  try {
    if (driver === "none") return;
    if (driver === "macos") {
      execFile("osascript", ["-e", `display notification "${body}" with title "${title}"`], () => {});
      return;
    }
    if (driver === "linux") {
      execFile("notify-send", [title, body], () => {});
      return;
    }
    if (typeof driver === "object" && driver.type === "custom") {
      const resolved = driver.template.replace(/\{title\}/g, title).replace(/\{body\}/g, body);
      const child = spawn(resolved, [], { shell: true, stdio: "ignore", detached: true });
      child.on("error", () => {});
      child.unref();
    }
  } catch {
    // ponytail: notifications are best-effort; swallow so a failed ping never breaks the caller.
  }
}
