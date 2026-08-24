import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs, stringArg } from "@tangent/core/cli";

const execFileAsync = promisify(execFile);
const PROCESS_FILE = ".processes.json";
const PROCESS_NAME = /^[a-z0-9][a-z0-9-]*$/;
const SHELL_COMMANDS = new Set(["zsh", "bash", "fish", "sh", "dash", "tcsh", "nu"]);

export interface ProcessDefinition {
  name: string;
  command: string;
  area: string;
  cwd: string;
  manifest: string;
}

export interface ProcessManifest {
  scripts: Record<string, ProcessManifestEntry>;
  commands: Record<string, ProcessManifestEntry>;
}

export interface ProcessManifestEntry {
  command: string;
  cwd?: string;
}

export interface ProcessRunner {
  run(command: string, args: string[]): Promise<{ stdout: string }>;
}

const defaultRunner: ProcessRunner = {
  /** Runs one process-management command. */
  async run(command, args) {
    const result = await execFileAsync(command, args);
    return { stdout: result.stdout };
  }
};

/** Returns the local Tangent tree root. */
export function tangentTreesRoot(home = os.homedir()): string {
  return process.env.TANGENT_TREES_DIR || path.join(home, ".tangent", "trees");
}

/** Parses and validates one area-local process manifest. */
export function parseProcessManifest(text: string, manifestPath: string): ProcessManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${manifestPath}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${manifestPath}: expected an object`);
  const keys = Object.keys(value);
  if (keys.some((key) => !["scripts", "commands", "triggers"].includes(key))) {
    throw new Error(`${manifestPath}: only "scripts", "commands", and "triggers" are supported`);
  }
  /** Parses one optional name-to-command field. */
  const parseCommands = (field: "scripts" | "commands"): Record<string, ProcessManifestEntry> => {
    const entries = (value as Record<string, unknown>)[field];
    if (entries === undefined) return {};
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      throw new Error(`${manifestPath}: "${field}" must be an object`);
    }
    const out: Record<string, ProcessManifestEntry> = {};
    for (const [name, raw] of Object.entries(entries)) {
      if (!PROCESS_NAME.test(name)) throw new Error(`${manifestPath}: invalid program name ${JSON.stringify(name)}`);
      const command = typeof raw === "string" ? raw : raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { command?: unknown }).command : undefined;
      const cwd = typeof raw === "object" && raw && !Array.isArray(raw) ? (raw as { cwd?: unknown }).cwd : undefined;
      if (typeof command !== "string" || !command.trim()) {
        throw new Error(`${manifestPath}: ${field.slice(0, -1)} ${JSON.stringify(name)} must be a non-empty string`);
      }
      if (cwd !== undefined && (typeof cwd !== "string" || !cwd.trim())) {
        throw new Error(`${manifestPath}: ${field.slice(0, -1)} ${JSON.stringify(name)} cwd must be a non-empty string`);
      }
      out[name] = { command: command.trim(), ...(typeof cwd === "string" ? { cwd: cwd.trim() } : {}) };
    }
    return out;
  };
  const scripts = parseCommands("scripts");
  const commands = parseCommands("commands");
  if (!Object.keys(scripts).length && !Object.keys(commands).length && !(value as Record<string, unknown>).triggers) {
    throw new Error(`${manifestPath}: declare at least one script, command, or trigger`);
  }
  return { scripts, commands };
}

/** Reads an Area note's Repository/Worktree resource and resolves it to an existing directory. */
async function areaDirectory(treesRoot: string, area: string): Promise<string> {
  const base = area.split("/").pop();
  const note = path.join(treesRoot, area, `${base}.md`);
  let text: string;
  try {
    text = await readFile(note, "utf8");
  } catch {
    throw new Error(`Area ${area} has no readable note at ${note}`);
  }
  const resources = text.split(/^## /m).find((section) => section.startsWith("Resources")) ?? "";
  const match = resources.match(/^\s*-\s*(?:Repository|Worktree):\s*(.+?)\s*$/mi);
  if (!match) throw new Error(`Area ${area} has no Repository or Worktree in ${note}`);
  const cwd = match[1]!.replace(/^~(?=\/|$)/, os.homedir());
  if (!path.isAbsolute(cwd) || !existsSync(cwd)) throw new Error(`Area ${area} records an unavailable directory: ${cwd}`);
  return cwd;
}

/** Resolves inherited definitions from root to area; the nearest declaration wins. */
export async function resolveProcessDefinitions(area: string, treesRoot = tangentTreesRoot()): Promise<Map<string, ProcessDefinition>> {
  const clean = area.replace(/^\/+|\/+$/g, "");
  if (!clean || clean.split("/").some((part) => part === "." || part === "..")) throw new Error(`invalid Tangent area ${JSON.stringify(area)}`);
  const parts = clean.split("/");
  const definitions = new Map<string, ProcessDefinition>();
  for (let depth = 1; depth <= parts.length; depth++) {
    const owner = parts.slice(0, depth).join("/");
    const manifest = path.join(treesRoot, owner, PROCESS_FILE);
    if (!existsSync(manifest)) continue;
    const parsed = parseProcessManifest(await readFile(manifest, "utf8"), manifest);
    let inheritedCwd: string | null = null;
    for (const [name, entry] of Object.entries(parsed.scripts)) {
      let cwd = entry.cwd?.replace(/^~(?=\/|$)/, os.homedir()) ?? null;
      if (!cwd) {
        inheritedCwd ??= await areaDirectory(treesRoot, owner);
        cwd = inheritedCwd;
      }
      if (!path.isAbsolute(cwd) || !existsSync(cwd)) throw new Error(`${manifest}: ${name} records an unavailable directory: ${cwd}`);
      definitions.set(name, { name, command: entry.command, area: owner, cwd, manifest });
    }
  }
  return definitions;
}

/** Deterministic tmux identity, namespaced by defining area and script. */
export function processSessionName(definition: Pick<ProcessDefinition, "area" | "name">): string {
  const base = `${definition.area.split("/").pop()}--${definition.name}`.replace(/[^a-z0-9-]/g, "-").slice(0, 42);
  const hash = createHash("sha1").update(`${definition.area}\0${definition.name}`).digest("hex").slice(0, 8);
  return `process-${base}-${hash}`;
}

/** Resolves the area override or the authoritative area bound to the current tmux session. */
export async function resolveProcessArea(explicit: string | undefined, runner: ProcessRunner = defaultRunner): Promise<string> {
  if (explicit) return explicit;
  if (!process.env.TMUX) throw new Error("no --area given and this shell is not inside a Tangent-bound tmux session");
  const result = await runner.run("tmux", ["show-option", "-qv", "@tangent_area"]);
  const area = result.stdout.trim();
  if (!area) throw new Error("the current tmux session has no @tangent_area; pass --area <path>");
  return area;
}

/** Lists live tmux session names and their foreground commands. */
async function tmuxSessions(runner: ProcessRunner): Promise<Map<string, string>> {
  try {
    const { stdout } = await runner.run("tmux", ["list-sessions", "-F", "#{session_name}\t#{pane_current_command}"]);
    return new Map(stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [name, command = ""] = line.split("\t");
      return [name!, command];
    }));
  } catch {
    return new Map();
  }
}

/** Starts, stops, restarts, or closes a single declared process. */
export async function controlProcess(action: "start" | "stop" | "restart" | "close", definition: ProcessDefinition, runner: ProcessRunner = defaultRunner): Promise<string> {
  const session = processSessionName(definition);
  const sessions = await tmuxSessions(runner);
  const command = sessions.get(session);
  const exists = command !== undefined;
  const stopped = exists && SHELL_COMMANDS.has(command);
  if (action === "close") {
    if (!exists) return `${definition.name} has no process session`;
    await runner.run("tmux", ["kill-session", "-t", `=${session}`]);
    return `closed ${definition.name} on ${definition.area}`;
  }
  if (action === "stop") {
    if (!exists) return `${definition.name} has no process session`;
    if (stopped) return `${definition.name} is already stopped on ${definition.area}`;
    await runner.run("tmux", ["send-keys", "-t", `=${session}:`, "C-c"]);
    return `stopped ${definition.name} on ${definition.area}`;
  }
  if (action === "restart" && exists && !stopped) {
    await runner.run("tmux", ["send-keys", "-t", `=${session}:`, "C-c"]);
  }
  if (action === "start" && exists && !stopped) return `${definition.name} is already running on ${definition.area} (${session})`;
  if (!exists) {
    await runner.run("tmux", ["new-session", "-d", "-s", session, "-c", definition.cwd]);
    await runner.run("tmux", ["set-option", "-t", session, "@tangent_kind", "process"]);
    await runner.run("tmux", ["set-option", "-t", session, "@tangent_area", definition.area]);
    await runner.run("tmux", ["set-option", "-t", session, "@tangent_process", definition.name]);
  }
  await runner.run("tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", definition.command]);
  await runner.run("tmux", ["send-keys", "-t", `=${session}:`, "Enter"]);
  return `${action === "restart" ? "restarted" : "started"} ${definition.name} on ${definition.area} (${session})`;
}

/** Runs the `tangent process` command family. */
export async function runProcessCommand(argv: string[], runner: ProcessRunner = defaultRunner, treesRoot = tangentTreesRoot()): Promise<void> {
  const args = parseArgs(argv);
  const action = args._[0];
  if (!action || !["list", "start", "stop", "restart", "close"].includes(action)) {
    throw new Error("usage: tangent process <list|start|stop|restart|close> [name] [--area <path>]");
  }
  const area = await resolveProcessArea(stringArg(args.area), runner);
  const definitions = await resolveProcessDefinitions(area, treesRoot);
  if (action === "list") {
    if (!definitions.size) {
      console.log(`no managed processes declared for ${area}`);
      return;
    }
    for (const definition of definitions.values()) console.log(`${definition.name}\t${definition.area}\t${definition.command}`);
    return;
  }
  const name = args._[1];
  if (!name) throw new Error(`tangent process ${action} requires a process name`);
  const definition = definitions.get(name);
  if (!definition) {
    const names = [...definitions.keys()].join(", ") || "none";
    throw new Error(`${JSON.stringify(name)} is not a managed process for ${area}; declared: ${names}. Run it normally if it does not need tree visibility.`);
  }
  console.log(await controlProcess(action as "start" | "stop" | "restart" | "close", definition, runner));
}
