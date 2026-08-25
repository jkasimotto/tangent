import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { booleanArg, parseArgs, stringArg } from "@tangent/core/cli";

const execFileAsync = promisify(execFile);
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const SKIP = new Set([".git", ".obsidian", "shared", "node_modules"]);

export type TriggerDefinition = {
  area: string;
  name: string;
  everyMs: number;
  every: string;
  probe: string;
  instructions: string;
  cwd: string;
  paused: boolean;
};

export type TriggerOutcome =
  | { status: "idle" }
  | { status: "work"; key: string; context?: string }
  | { status: "attention"; key: string; message: string };

export type TriggerRecord = {
  lastCheckedAt?: string;
  lastOutcome?: TriggerOutcome;
  handledKey?: string;
  acknowledgedKey?: string;
  error?: string;
  sessionName?: string;
};

export type TriggerState = { triggers: Record<string, TriggerRecord> };

export interface TriggerRunner {
  run(command: string, args: string[], options?: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string }>;
}

const defaultRunner: TriggerRunner = {
  /** Runs one trigger subprocess. */
  async run(command, args, options) {
    const result = await execFileAsync(command, args, { cwd: options?.cwd, timeout: options?.timeout });
    return { stdout: result.stdout, stderr: result.stderr };
  }
};

/** Returns the machine-local tree and trigger-state locations. */
export function triggerPaths(home = os.homedir()): { trees: string; state: string; lock: string } {
  const base = process.env.TANGENT_HOME || path.join(home, ".tangent");
  return {
    trees: process.env.TANGENT_TREES_DIR || path.join(base, "trees"),
    state: path.join(base, "agent-shell", "triggers", "state.json"),
    lock: path.join(base, "agent-shell", "triggers", "sweep.lock")
  };
}

/** Parses a duration such as 30s, 15m, 2h, or 1d. */
export function parseDuration(value: string): number {
  const match = String(value).trim().match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`invalid interval ${JSON.stringify(value)}; use 30s, 15m, 2h, or 1d`);
  const amount = Number(match[1]);
  if (amount < 1) throw new Error("trigger interval must be positive");
  return amount * ({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]!] ?? 0);
}

/** Parses and validates the trigger map in an Area program manifest. */
export function parseTriggerManifest(text: string, file: string, area: string, defaultCwd: string): TriggerDefinition[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new Error(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file}: expected an object`);
  const rawTriggers = (value as Record<string, unknown>).triggers;
  if (rawTriggers === undefined) return [];
  if (!rawTriggers || typeof rawTriggers !== "object" || Array.isArray(rawTriggers)) throw new Error(`${file}: triggers must be an object`);
  const definitions: TriggerDefinition[] = [];
  for (const [name, raw] of Object.entries(rawTriggers)) {
    if (!NAME.test(name)) throw new Error(`${file}: invalid trigger name ${JSON.stringify(name)}`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${file}: trigger ${name} must be an object`);
    const entry = raw as Record<string, unknown>;
    const every = typeof entry.every === "string" ? entry.every.trim() : "";
    const probe = typeof entry.probe === "string" ? entry.probe.trim() : "";
    const instructions = typeof entry.instructions === "string" ? entry.instructions.trim() : "";
    const cwd = (typeof entry.cwd === "string" ? entry.cwd.trim() : defaultCwd).replace(/^~(?=\/|$)/, os.homedir());
    if (!probe) throw new Error(`${file}: trigger ${name} needs a probe`);
    if (!instructions) throw new Error(`${file}: trigger ${name} needs instructions`);
    if (!path.isAbsolute(cwd) || !existsSync(cwd)) throw new Error(`${file}: trigger ${name} has an unavailable working folder: ${cwd}`);
    definitions.push({ area, name, every, everyMs: parseDuration(every), probe, instructions, cwd, paused: entry.paused === true });
  }
  return definitions;
}

/** Parses the one-object stdout contract returned by a trigger probe. */
export function parseTriggerOutcome(stdout: string): TriggerOutcome {
  let value: unknown;
  try { value = JSON.parse(stdout.trim()); } catch { throw new Error("probe must print one JSON object on stdout"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("probe output must be an object");
  const item = value as Record<string, unknown>;
  if (item.status === "idle") return { status: "idle" };
  if (item.status === "work" && typeof item.key === "string" && item.key.trim()) {
    return { status: "work", key: item.key.trim(), ...(typeof item.context === "string" && item.context.trim() ? { context: item.context.trim() } : {}) };
  }
  if (item.status === "attention" && typeof item.key === "string" && item.key.trim() && typeof item.message === "string" && item.message.trim()) {
    return { status: "attention", key: item.key.trim(), message: item.message.trim() };
  }
  throw new Error('probe status must be "idle", "work" with key, or "attention" with key and message');
}

/** Stable identity shared by state records and retained tmux sessions. */
export function triggerId(definition: Pick<TriggerDefinition, "area" | "name">): string {
  return `${definition.area}:${definition.name}`;
}

/** Returns the stable tmux session name for a trigger. */
export function triggerSessionName(definition: Pick<TriggerDefinition, "area" | "name">): string {
  const base = `${definition.area.split("/").pop()}--${definition.name}`.replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  const hash = createHash("sha1").update(`trigger\0${definition.area}\0${definition.name}`).digest("hex").slice(0, 8);
  return `trigger-${base}-${hash}`;
}

/** True when a definition should be probed now. Missed intervals coalesce. */
export function triggerIsDue(definition: TriggerDefinition, record: TriggerRecord | undefined, now: Date): boolean {
  if (definition.paused) return false;
  if (!record?.lastCheckedAt) return true;
  const checked = new Date(record.lastCheckedAt).getTime();
  return !Number.isFinite(checked) || now.getTime() - checked >= definition.everyMs;
}

/** Reads every Area trigger definition without requiring Agent Shell. */
export async function discoverTriggers(treesRoot: string): Promise<TriggerDefinition[]> {
  const definitions: TriggerDefinition[] = [];
  /** Walks Area directories and parses manifests in place. */
  const walk = async (directory: string, relative = ""): Promise<void> => {
    let entries = [] as Awaited<ReturnType<typeof readdir>>;
    try { entries = await readdir(directory, { withFileTypes: true }) as never; } catch { return; }
    if (relative) {
      const manifest = path.join(directory, ".processes.json");
      if (existsSync(manifest)) {
        const defaultCwd = await areaDirectory(treesRoot, relative);
        definitions.push(...parseTriggerManifest(await readFile(manifest, "utf8"), manifest, relative, defaultCwd));
      }
    }
    for (const entry of entries as unknown as Array<{ isDirectory(): boolean; name: string }>) {
      if (!entry.isDirectory() || SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      await walk(path.join(directory, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
    }
  };
  await walk(treesRoot);
  return definitions;
}

/** Runs due probes and launches bounded visible workers for new work keys. */
export async function checkTriggers(options: { treesRoot: string; statePath: string; now?: Date; name?: string; force?: boolean; runner?: TriggerRunner }): Promise<TriggerState> {
  const runner = options.runner ?? defaultRunner;
  const now = options.now ?? new Date();
  const state = await readState(options.statePath);
  const definitions = (await discoverTriggers(options.treesRoot)).filter((item) => !options.name || item.name === options.name || triggerId(item) === options.name);
  if (options.name && !definitions.length) throw new Error(`no trigger matches ${JSON.stringify(options.name)}`);
  for (const definition of definitions) {
    const id = triggerId(definition);
    const previous = state.triggers[id] ?? {};
    if (!options.force && !triggerIsDue(definition, previous, now)) continue;
    try {
      const result = await runner.run("zsh", ["-lic", definition.probe], { cwd: definition.cwd, timeout: 60_000 });
      const outcome = parseTriggerOutcome(result.stdout);
      const record: TriggerRecord = { ...previous, lastCheckedAt: now.toISOString(), lastOutcome: outcome, error: undefined };
      if (outcome.status === "idle") {
        record.handledKey = undefined;
        record.acknowledgedKey = undefined;
      } else if (outcome.status === "work" && previous.handledKey !== outcome.key) {
        const sessionName = await launchTriggerAgent(definition, outcome, runner);
        record.handledKey = outcome.key;
        record.sessionName = sessionName;
      }
      state.triggers[id] = record;
    } catch (error) {
      state.triggers[id] = { ...previous, lastCheckedAt: now.toISOString(), error: error instanceof Error ? error.message : String(error) };
    }
    await writeState(options.statePath, state);
  }
  return state;
}

/** Acknowledges the current attention key without discarding the condition. */
export async function acknowledgeTrigger(statePath: string, definition: TriggerDefinition): Promise<TriggerState> {
  const state = await readState(statePath);
  const id = triggerId(definition);
  const record = state.triggers[id];
  if (!record?.lastOutcome || record.lastOutcome.status !== "attention") throw new Error(`${definition.name} does not need attention`);
  state.triggers[id] = { ...record, acknowledgedKey: record.lastOutcome.key };
  await writeState(statePath, state);
  return state;
}

/** Ends the live trigger agent and releases its session binding. The definition, its interval, and its recorded work key stay unchanged. */
export async function stopTrigger(statePath: string, definition: TriggerDefinition, runner: TriggerRunner = defaultRunner): Promise<TriggerState> {
  const session = triggerSessionName(definition);
  try { await runner.run("tmux", ["kill-session", "-t", `=${session}`]); } catch { /* The session may already be gone. */ }
  const state = await readState(statePath);
  const id = triggerId(definition);
  const record = state.triggers[id];
  if (record?.sessionName) {
    state.triggers[id] = { ...record, sessionName: undefined };
    await writeState(statePath, state);
  }
  return state;
}

/** Runs the root trigger CLI. */
export async function runTriggerCommand(argv: string[], runner: TriggerRunner = defaultRunner): Promise<void> {
  const args = parseArgs(argv);
  const action = args._[0];
  const paths = triggerPaths();
  if (action === "list") {
    const definitions = await discoverTriggers(paths.trees);
    const state = await readState(paths.state);
    if (booleanArg(args.json)) return void console.log(JSON.stringify({ definitions, state }, null, 2));
    for (const definition of definitions) {
      const record = state.triggers[triggerId(definition)];
      console.log(`${triggerId(definition)}\t${definition.paused ? "paused" : describeRecord(record)}\t${definition.every}`);
    }
    return;
  }
  if (action === "check") {
    await withSweepLock(paths.lock, async () => checkTriggers({ treesRoot: paths.trees, statePath: paths.state, name: args._[1], force: booleanArg(args.force), runner }));
    return;
  }
  if (action === "acknowledge" || action === "stop") {
    const name = args._[1];
    if (!name) throw new Error(`tangent trigger ${action} requires <area:name> or a unique name`);
    const matches = (await discoverTriggers(paths.trees)).filter((item) => triggerId(item) === name || item.name === name);
    if (matches.length !== 1) throw new Error(matches.length ? `${name} matches more than one trigger; use area:name` : `no trigger matches ${name}`);
    if (action === "stop") await stopTrigger(paths.state, matches[0]!, runner);
    else await acknowledgeTrigger(paths.state, matches[0]!);
    return;
  }
  if (action === "install") {
    console.log(await installTriggerLaunchAgent(os.homedir(), runner));
    return;
  }
  throw new Error("usage: tangent trigger <list|check|acknowledge|stop|install> [name] [--force] [--json]");
}

/** Installs one coarse per-user launchd wake-up; Tangent still owns due logic. */
export async function installTriggerLaunchAgent(home: string, runner: TriggerRunner = defaultRunner): Promise<string> {
  const label = "com.tangent.triggers";
  const directory = path.join(home, "Library", "LaunchAgents");
  const file = path.join(directory, `${label}.plist`);
  const logs = path.join(home, ".tangent", "agent-shell", "triggers");
  await mkdir(directory, { recursive: true });
  await mkdir(logs, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>${label}</string>\n  <key>ProgramArguments</key><array><string>/usr/bin/env</string><string>zsh</string><string>-lic</string><string>tangent trigger check</string></array>\n  <key>StartInterval</key><integer>60</integer>\n  <key>StandardOutPath</key><string>${xmlEscape(path.join(logs, "launchd.log"))}</string>\n  <key>StandardErrorPath</key><string>${xmlEscape(path.join(logs, "launchd-error.log"))}</string>\n</dict></plist>\n`;
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, plist, "utf8");
  await rename(temporary, file);
  const domain = `gui/${process.getuid?.() ?? 501}`;
  try { await runner.run("launchctl", ["bootout", domain, file]); } catch { /* It may not be loaded yet. */ }
  await runner.run("launchctl", ["bootstrap", domain, file]);
  return `installed ${label}; Tangent will check due triggers every minute`;
}

/** Resolves the Area repository or worktree resource. */
async function areaDirectory(treesRoot: string, area: string): Promise<string> {
  const note = path.join(treesRoot, area, `${area.split("/").pop()}.md`);
  let text = "";
  try { text = await readFile(note, "utf8"); } catch { return ""; }
  const section = text.split(/^## /m).find((part) => part.startsWith("Resources")) ?? "";
  const match = section.match(/^\s*-\s*(?:Repository|Worktree):\s*(.+?)\s*$/mi);
  return match ? match[1]!.replace(/^~(?=\/|$)/, os.homedir()) : "";
}

/** Launches one agent in a retained trigger session. */
async function launchTriggerAgent(definition: TriggerDefinition, outcome: Extract<TriggerOutcome, { status: "work" }>, runner: TriggerRunner): Promise<string> {
  const instructionsPath = path.isAbsolute(definition.instructions) ? definition.instructions : path.join(definition.cwd, definition.instructions);
  const instructions = await readFile(instructionsPath, "utf8");
  const session = triggerSessionName(definition);
  let existingCommand = "";
  try { existingCommand = (await runner.run("tmux", ["display-message", "-p", "-t", `=${session}:`, "#{pane_current_command}"])).stdout.trim(); } catch { /* No retained session. */ }
  if (existingCommand && !["zsh", "bash", "fish", "sh", "dash", "tcsh", "nu"].includes(existingCommand)) throw new Error(`trigger agent ${session} is still active`);
  const command = await inheritedAgentCommand(definition.area, triggerPaths().trees);
  if (!existingCommand) {
    await runner.run("tmux", ["new-session", "-d", "-s", session, "-c", definition.cwd]);
    for (const [key, value] of [["@tangent_kind", "trigger"], ["@tangent_area", definition.area], ["@tangent_process", definition.name]]) {
      await runner.run("tmux", ["set-option", "-t", session, key!, value!]);
    }
  }
  await runner.run("tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", command]);
  await runner.run("tmux", ["send-keys", "-t", `=${session}:`, "Enter"]);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const prompt = `${instructions.trim()}\n\nTrigger: ${definition.area}:${definition.name}\nObserved key: ${outcome.key}${outcome.context ? `\nContext: ${outcome.context}` : ""}`;
  await runner.run("tmux", ["set-buffer", "--", prompt]);
  await runner.run("tmux", ["paste-buffer", "-t", `=${session}:`, "-d"]);
  await runner.run("tmux", ["send-keys", "-t", `=${session}:`, "Enter"]);
  return session;
}

/** Resolves the nearest Area Agent resource, matching Agent Shell fallback. */
async function inheritedAgentCommand(area: string, treesRoot: string): Promise<string> {
  const parts = area.split("/");
  for (let depth = parts.length; depth > 0; depth--) {
    const candidate = parts.slice(0, depth).join("/");
    const note = path.join(treesRoot, candidate, `${parts[depth - 1]}.md`);
    let text = "";
    try { text = await readFile(note, "utf8"); } catch { continue; }
    const resources = text.split(/^## /m).find((part) => part.startsWith("Resources")) ?? "";
    const match = resources.match(/^\s*-\s*Agent[^:]*:\s*`?([^`\n]+?)`?\s*$/mi);
    if (match) return match[1]!.trim();
  }
  return parts[0] === "otto" ? "claude-otto" : "claude";
}

/** Reads the machine-local trigger state. */
async function readState(file: string): Promise<TriggerState> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as TriggerState;
    return value && typeof value === "object" && value.triggers && typeof value.triggers === "object" ? value : { triggers: {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { triggers: {} };
    throw error;
  }
}

/** Atomically writes the machine-local trigger state. */
async function writeState(file: string, state: TriggerState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

/** Runs one sweep while holding the coarse trigger lock. */
async function withSweepLock<T>(directory: string, action: () => Promise<T>): Promise<T | undefined> {
  try { await mkdir(directory, { recursive: false }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const age = Date.now() - (await stat(directory)).mtimeMs;
    if (age < 300_000) return undefined;
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: false });
  }
  try { return await action(); } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Returns the user-facing state label for a trigger record. */
function describeRecord(record: TriggerRecord | undefined): string {
  if (!record) return "waiting";
  if (record.error) return "error";
  if (record.lastOutcome?.status === "attention" && record.acknowledgedKey !== record.lastOutcome.key) return "needs-attention";
  if (record.lastOutcome?.status === "work") return "work-seen";
  return "waiting";
}

/** Escapes text inserted into a launchd property list. */
function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
