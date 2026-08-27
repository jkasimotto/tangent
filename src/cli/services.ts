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

export interface ServiceDefinition {
  name: string;
  command: string;
  area: string;
  cwd: string;
  manifest: string;
}

export interface ServiceManifest {
  scripts: Record<string, ServiceManifestEntry>;
  commands: Record<string, ServiceManifestEntry>;
}

export interface ServiceManifestEntry {
  command: string;
  cwd?: string;
}

export interface ServiceRunner {
  run(command: string, args: string[]): Promise<{ stdout: string }>;
}

const defaultRunner: ServiceRunner = {
  /** Runs one service-management command. */
  async run(command, args) {
    const result = await execFileAsync(command, args);
    return { stdout: result.stdout };
  }
};

/** Returns the local Tangent tree root. */
export function tangentTreesRoot(home = os.homedir()): string {
  return process.env.TANGENT_TREES_DIR || path.join(home, ".tangent", "trees");
}

/** Parses and validates one area-local service manifest (`.processes.json`). */
export function parseServiceManifest(text: string, manifestPath: string): ServiceManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${manifestPath}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${manifestPath}: expected an object`);
  const keys = Object.keys(value);
  if (keys.some((key) => !["scripts", "commands"].includes(key))) {
    throw new Error(`${manifestPath}: only "scripts" and "commands" are supported${keys.includes("triggers") ? " (triggers retired; write a process-<slug>.md note instead, ADR-0043)" : ""}`);
  }
  /** Parses one optional name-to-command field. */
  const parseCommands = (field: "scripts" | "commands"): Record<string, ServiceManifestEntry> => {
    const entries = (value as Record<string, unknown>)[field];
    if (entries === undefined) return {};
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      throw new Error(`${manifestPath}: "${field}" must be an object`);
    }
    const out: Record<string, ServiceManifestEntry> = {};
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
  if (!Object.keys(scripts).length && !Object.keys(commands).length) {
    throw new Error(`${manifestPath}: declare at least one script or command`);
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

/** Resolves inherited service definitions from root to area; the nearest declaration wins. */
export async function resolveServiceDefinitions(area: string, treesRoot = tangentTreesRoot()): Promise<Map<string, ServiceDefinition>> {
  const clean = area.replace(/^\/+|\/+$/g, "");
  if (!clean || clean.split("/").some((part) => part === "." || part === "..")) throw new Error(`invalid Tangent area ${JSON.stringify(area)}`);
  const parts = clean.split("/");
  const definitions = new Map<string, ServiceDefinition>();
  for (let depth = 1; depth <= parts.length; depth++) {
    const owner = parts.slice(0, depth).join("/");
    const manifest = path.join(treesRoot, owner, PROCESS_FILE);
    if (!existsSync(manifest)) continue;
    const parsed = parseServiceManifest(await readFile(manifest, "utf8"), manifest);
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
export function serviceSessionName(definition: Pick<ServiceDefinition, "area" | "name">): string {
  const base = `${definition.area.split("/").pop()}--${definition.name}`.replace(/[^a-z0-9-]/g, "-").slice(0, 42);
  const hash = createHash("sha1").update(`${definition.area}\0${definition.name}`).digest("hex").slice(0, 8);
  return `process-${base}-${hash}`;
}

/** Resolves the area override or the authoritative area bound to the current tmux session. */
export async function resolveServiceArea(explicit: string | undefined, runner: ServiceRunner = defaultRunner): Promise<string> {
  if (explicit) return explicit;
  if (!process.env.TMUX) throw new Error("no --area given and this shell is not inside a Tangent-bound tmux session");
  const result = await runner.run("tmux", ["show-option", "-qv", "@tangent_area"]);
  const area = result.stdout.trim();
  if (!area) throw new Error("the current tmux session has no @tangent_area; pass --area <path>");
  return area;
}

/**
 * Whether the current tmux session is a worker (`@tangent_kind goal`). Workers
 * only send notes to their brain (D6). `tangent service` never reaches the
 * server, so the server's 403 gate cannot see it; this local check stands in.
 */
async function currentSessionIsWorker(runner: ServiceRunner): Promise<boolean> {
  if (!process.env.TMUX) return false;
  try {
    const result = await runner.run("tmux", ["show-option", "-qv", "@tangent_kind"]);
    return result.stdout.trim() === "goal";
  } catch {
    return false;
  }
}

/** Refuses service mutations from a worker session with the shared D6 message. */
async function refuseWorkerMutation(runner: ServiceRunner): Promise<void> {
  if (!(await currentSessionIsWorker(runner))) return;
  const { WORKER_MUTATION_REFUSAL } = await import("@tangent/agent-shell/cli");
  throw new Error(WORKER_MUTATION_REFUSAL);
}

/** Lists live tmux session names and their foreground commands. */
async function tmuxSessions(runner: ServiceRunner): Promise<Map<string, string>> {
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

/** Starts, stops, restarts, or closes a single declared service. The tmux session keeps kind `process` (D19). */
export async function controlService(action: "start" | "stop" | "restart" | "close", definition: ServiceDefinition, runner: ServiceRunner = defaultRunner): Promise<string> {
  const session = serviceSessionName(definition);
  const sessions = await tmuxSessions(runner);
  const command = sessions.get(session);
  const exists = command !== undefined;
  const stopped = exists && SHELL_COMMANDS.has(command);
  if (action === "close") {
    if (!exists) return `${definition.name} has no service session`;
    await runner.run("tmux", ["kill-session", "-t", `=${session}`]);
    return `closed ${definition.name} on ${definition.area}`;
  }
  if (action === "stop") {
    if (!exists) return `${definition.name} has no service session`;
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

/** Runs the `tangent service` command family: servers and watchers declared in `.processes.json`. */
export async function runServiceCommand(argv: string[], runner: ServiceRunner = defaultRunner, treesRoot = tangentTreesRoot()): Promise<void> {
  const args = parseArgs(argv);
  const action = args._[0];
  if (!action || !["list", "start", "stop", "restart", "close"].includes(action)) {
    throw new Error("usage: tangent service <list|start|stop|restart|close> [name] [--area <path>]");
  }
  if (action !== "list") await refuseWorkerMutation(runner);
  const area = await resolveServiceArea(stringArg(args.area), runner);
  const definitions = await resolveServiceDefinitions(area, treesRoot);
  if (action === "list") {
    if (!definitions.size) {
      console.log(`no services declared for ${area}`);
      return;
    }
    for (const definition of definitions.values()) console.log(`${definition.name}\t${definition.area}\t${definition.command}`);
    return;
  }
  const name = args._[1];
  if (!name) throw new Error(`tangent service ${action} requires a service name`);
  const definition = definitions.get(name);
  if (!definition) {
    const names = [...definitions.keys()].join(", ") || "none";
    throw new Error(`${JSON.stringify(name)} is not a service for ${area}; declared: ${names}. Run it normally if it does not need tree visibility.`);
  }
  console.log(await controlService(action as "start" | "stop" | "restart" | "close", definition, runner));
}
