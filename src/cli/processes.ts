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
  node: string;
  cwd: string;
  manifest: string;
}

export interface ProcessManifest {
  scripts: Record<string, string>;
}

export interface ProcessRunner {
  run(command: string, args: string[]): Promise<{ stdout: string }>;
}

const defaultRunner: ProcessRunner = {
  async run(command, args) {
    const result = await execFileAsync(command, args);
    return { stdout: result.stdout };
  }
};

/** Returns the local Tangent tree root. */
export function tangentTreesRoot(home = os.homedir()): string {
  return path.join(home, ".tangent", "trees");
}

/** Parses and validates one node-local process manifest. */
export function parseProcessManifest(text: string, manifestPath: string): ProcessManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${manifestPath}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${manifestPath}: expected an object`);
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "scripts")) throw new Error(`${manifestPath}: only "scripts" is supported`);
  const scripts = (value as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) throw new Error(`${manifestPath}: "scripts" must be an object`);
  const out: Record<string, string> = {};
  for (const [name, command] of Object.entries(scripts)) {
    if (!PROCESS_NAME.test(name)) throw new Error(`${manifestPath}: invalid process name ${JSON.stringify(name)}`);
    if (typeof command !== "string" || !command.trim()) throw new Error(`${manifestPath}: script ${JSON.stringify(name)} must be a non-empty string`);
    out[name] = command;
  }
  return { scripts: out };
}

/** Reads a node note's Repository/Worktree resource and resolves it to an existing directory. */
async function nodeDirectory(treesRoot: string, node: string): Promise<string> {
  const base = node.split("/").pop();
  const note = path.join(treesRoot, node, `${base}.md`);
  let text: string;
  try {
    text = await readFile(note, "utf8");
  } catch {
    throw new Error(`node ${node} has no readable note at ${note}`);
  }
  const resources = text.split(/^## /m).find((section) => section.startsWith("Resources")) ?? "";
  const match = resources.match(/^\s*-\s*(?:Repository|Worktree):\s*(.+?)\s*$/mi);
  if (!match) throw new Error(`node ${node} has no Repository or Worktree in ${note}`);
  const cwd = match[1]!.replace(/^~(?=\/|$)/, os.homedir());
  if (!path.isAbsolute(cwd) || !existsSync(cwd)) throw new Error(`node ${node} records an unavailable directory: ${cwd}`);
  return cwd;
}

/** Resolves inherited definitions from root to node; the nearest declaration wins. */
export async function resolveProcessDefinitions(node: string, treesRoot = tangentTreesRoot()): Promise<Map<string, ProcessDefinition>> {
  const clean = node.replace(/^\/+|\/+$/g, "");
  if (!clean || clean.split("/").some((part) => part === "." || part === "..")) throw new Error(`invalid Tangent node ${JSON.stringify(node)}`);
  const parts = clean.split("/");
  const definitions = new Map<string, ProcessDefinition>();
  for (let depth = 1; depth <= parts.length; depth++) {
    const owner = parts.slice(0, depth).join("/");
    const manifest = path.join(treesRoot, owner, PROCESS_FILE);
    if (!existsSync(manifest)) continue;
    const parsed = parseProcessManifest(await readFile(manifest, "utf8"), manifest);
    const cwd = await nodeDirectory(treesRoot, owner);
    for (const [name, command] of Object.entries(parsed.scripts)) {
      definitions.set(name, { name, command, node: owner, cwd, manifest });
    }
  }
  return definitions;
}

/** Deterministic tmux identity, namespaced by defining node and script. */
export function processSessionName(definition: Pick<ProcessDefinition, "node" | "name">): string {
  const base = `${definition.node.split("/").pop()}--${definition.name}`.replace(/[^a-z0-9-]/g, "-").slice(0, 42);
  const hash = createHash("sha1").update(`${definition.node}\0${definition.name}`).digest("hex").slice(0, 8);
  return `process-${base}-${hash}`;
}

/** Resolves the node override or the authoritative node bound to the current tmux session. */
export async function resolveProcessNode(explicit: string | undefined, runner: ProcessRunner = defaultRunner): Promise<string> {
  if (explicit) return explicit;
  if (!process.env.TMUX) throw new Error("no --node given and this shell is not inside a Tangent-bound tmux session");
  const result = await runner.run("tmux", ["show-option", "-qv", "@tangent_node"]);
  const node = result.stdout.trim();
  if (!node) throw new Error("the current tmux session has no @tangent_node; pass --node <path>");
  return node;
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
    return `closed ${definition.name} on ${definition.node}`;
  }
  if (action === "stop") {
    if (!exists) return `${definition.name} has no process session`;
    if (stopped) return `${definition.name} is already stopped on ${definition.node}`;
    await runner.run("tmux", ["send-keys", "-t", `=${session}:`, "C-c"]);
    return `stopped ${definition.name} on ${definition.node}`;
  }
  if (action === "restart" && exists && !stopped) {
    await runner.run("tmux", ["send-keys", "-t", `=${session}:`, "C-c"]);
  }
  if (action === "start" && exists && !stopped) return `${definition.name} is already running on ${definition.node} (${session})`;
  if (!exists) {
    await runner.run("tmux", ["new-session", "-d", "-s", session, "-c", definition.cwd]);
    await runner.run("tmux", ["set-option", "-t", session, "@tangent_kind", "process"]);
    await runner.run("tmux", ["set-option", "-t", session, "@tangent_node", definition.node]);
    await runner.run("tmux", ["set-option", "-t", session, "@tangent_process", definition.name]);
  }
  await runner.run("tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", definition.command]);
  await runner.run("tmux", ["send-keys", "-t", `=${session}:`, "Enter"]);
  return `${action === "restart" ? "restarted" : "started"} ${definition.name} on ${definition.node} (${session})`;
}

/** Runs the `tangent process` command family. */
export async function runProcessCommand(argv: string[], runner: ProcessRunner = defaultRunner, treesRoot = tangentTreesRoot()): Promise<void> {
  const args = parseArgs(argv);
  const action = args._[0];
  if (!action || !["list", "start", "stop", "restart", "close"].includes(action)) {
    throw new Error("usage: tangent process <list|start|stop|restart|close> [name] [--node <path>]");
  }
  const node = await resolveProcessNode(stringArg(args.node), runner);
  const definitions = await resolveProcessDefinitions(node, treesRoot);
  if (action === "list") {
    if (!definitions.size) {
      console.log(`no managed processes declared for ${node}`);
      return;
    }
    for (const definition of definitions.values()) console.log(`${definition.name}\t${definition.node}\t${definition.command}`);
    return;
  }
  const name = args._[1];
  if (!name) throw new Error(`tangent process ${action} requires a process name`);
  const definition = definitions.get(name);
  if (!definition) {
    const names = [...definitions.keys()].join(", ") || "none";
    throw new Error(`${JSON.stringify(name)} is not a managed process for ${node}; declared: ${names}. Run it normally if it does not need tree visibility.`);
  }
  console.log(await controlProcess(action as "start" | "stop" | "restart" | "close", definition, runner));
}
