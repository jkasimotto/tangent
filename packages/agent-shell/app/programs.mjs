import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { absoluteAreaPath, cleanAreaPath, areaSlug } from "./area-operations.mjs";
import { operationFromProgram } from "./area-brain-domain.mjs";
import { resolveWorkFolder } from "./area-resources.mjs";

const PROCESS_FILE = ".processes.json";
const TREE_SKIP = new Set([".git", ".obsidian", "shared", "node_modules"]);
const PROGRAM_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Turns a program slug into a compact visible name. */
export function programLabel(value) {
  const upper = new Map([["hmr", "HMR"], ["ci", "CI"], ["ui", "UI"], ["api", "API"]]);
  return String(value ?? "")
    .split("-")
    .map((part) => upper.get(part) || `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** Creates the same deterministic session name as `tangent process`. */
export function managedProcessSession(area, name) {
  const base = `${area.split("/").pop()}--${name}`.replace(/[^a-z0-9-]/g, "-").slice(0, 42);
  const hash = createHash("sha1").update(`${area}\0${name}`).digest("hex").slice(0, 8);
  return `process-${base}-${hash}`;
}

/** Creates a deterministic session name for an on-demand command. */
export function commandSession(area, name) {
  const base = `${area.split("/").pop()}--${name}`.replace(/[^a-z0-9-]/g, "-").slice(0, 42);
  const hash = createHash("sha1").update(`command\0${area}\0${name}`).digest("hex").slice(0, 8);
  return `command-${base}-${hash}`;
}

/**
 * The folder a program on this Area runs in: the same Worktree or Repository
 * binding, inherited from parent Areas, that workers start in. Programs and
 * workers read one parser so they can never disagree about an Area's folder.
 */
export async function programDirectory(treesRoot, area) {
  const folder = await resolveWorkFolder(treesRoot, cleanAreaPath(area));
  return folder?.cwd ?? null;
}

/** Lists every area path in the private vault. */
async function allAreas(treesRoot) {
  const out = [];
  /** Walks visible area directories. */
  const walk = async (directory, relative = "") => {
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || TREE_SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const area = relative ? `${relative}/${entry.name}` : entry.name;
      out.push(area);
      await walk(path.join(directory, entry.name), area);
    }
  };
  await walk(treesRoot);
  return out;
}

/** Parses the local process and command manifest used by Programs. */
export function parseProgramManifest(text, file = PROCESS_FILE) {
  let value;
  try { value = JSON.parse(text); } catch (error) { throw new Error(`${file}: invalid JSON (${error.message})`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file}: expected an object`);
  const unknown = Object.keys(value).filter((key) => !["scripts", "commands"].includes(key));
  if (unknown.length) throw new Error(`${file}: unsupported field ${unknown[0]}${unknown[0] === "triggers" ? " (triggers retired; write a process-<slug>.md note instead, ADR-0043)" : ""}`);
  /** Reads and validates one optional map. */
  const readMap = (field) => {
    const input = value[field];
    if (input === undefined) return {};
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${file}: ${field} must be an object`);
    const output = {};
    for (const [name, raw] of Object.entries(input)) {
      if (!PROGRAM_NAME.test(name)) throw new Error(`${file}: invalid program name ${name}`);
      const command = typeof raw === "string" ? raw : raw && typeof raw === "object" && !Array.isArray(raw) ? raw.command : "";
      const cwd = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.cwd : undefined;
      const report = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.report === true : false;
      if (typeof command !== "string" || !command.trim()) throw new Error(`${file}: ${name} needs a command`);
      if (cwd !== undefined && (typeof cwd !== "string" || !cwd.trim())) throw new Error(`${file}: ${name} needs a valid working folder`);
      output[name] = { command: command.trim(), report, ...(typeof cwd === "string" ? { cwd: cwd.trim().replace(/^~(?=\/|$)/, os.homedir()) } : {}) };
    }
    return output;
  };
  return { scripts: readMap("scripts"), commands: readMap("commands") };
}

/** Reads all managed services (kind `process`) and commands for the UI. */
export async function programsSnapshot({ treesRoot, sessions = [] }) {
  const programs = [];
  const errors = [];
  const areas = [];
  for (const area of await allAreas(treesRoot)) {
    const directory = absoluteAreaPath(treesRoot, area);
    const cwd = await programDirectory(treesRoot, area);
    areas.push({ path: area, cwd });
    const manifest = path.join(directory, PROCESS_FILE);
    if (existsSync(manifest)) {
      try {
        const parsed = parseProgramManifest(await readFile(manifest, "utf8"), `${area}/${PROCESS_FILE}`);
        for (const [name, entry] of Object.entries(parsed.scripts)) {
          const programCwd = entry.cwd || cwd;
          const sessionName = managedProcessSession(area, name);
          const session = sessions.find((item) => item.name === sessionName || (item.kind === "process" && item.area === area && item.process === name));
          programs.push({ id: `process:${area}:${name}`, type: "process", area, name, label: programLabel(name), command: entry.command, report: entry.report, cwd: programCwd, sessionName, session: session ?? null, available: Boolean(programCwd && existsSync(programCwd)) });
        }
        for (const [name, entry] of Object.entries(parsed.commands)) {
          const programCwd = entry.cwd || cwd;
          const sessionName = commandSession(area, name);
          const session = sessions.find((item) => item.name === sessionName);
          programs.push({ id: `command:${area}:${name}`, type: "command", area, name, label: programLabel(name), command: entry.command, report: entry.report, cwd: programCwd, sessionName, session: session ?? null, available: Boolean(programCwd && existsSync(programCwd)) });
        }
      } catch (error) {
        errors.push({ area, file: `${area}/${PROCESS_FILE}`, error: error.message });
      }
    }
  }
  programs.sort((left, right) => {
    const leftLive = left.session && !["shell", "stopped"].includes(left.session.state) ? 1 : 0;
    const rightLive = right.session && !["shell", "stopped"].includes(right.session.state) ? 1 : 0;
    return rightLive - leftLive || left.area.localeCompare(right.area) || left.label.localeCompare(right.label);
  });
  const liveCount = programs.filter((program) => program.session && !["shell", "stopped"].includes(program.session.state)).length;
  const operations = programs.map(operationFromProgram);
  return { programs, operations, problems: operations.filter((operation) => operation.state === "problem"), errors, areas, liveCount };
}

/** Adds one local process or command definition to an Area. */
export async function saveLocalProgram({ treesRoot, area, type, name, command, cwd }) {
  const clean = cleanAreaPath(area);
  const slug = areaSlug(name);
  if (!PROGRAM_NAME.test(slug)) throw new Error("Use a program name with letters or numbers.");
  if (!["process", "command"].includes(type)) throw new Error("Choose a process or command.");
  if (!String(command ?? "").trim()) throw new Error("Add the command to run.");
  const directory = String(cwd || await programDirectory(treesRoot, clean) || "").replace(/^~(?=\/|$)/, os.homedir());
  if (!path.isAbsolute(directory) || !existsSync(directory)) throw new Error("Choose an existing working folder.");
  const file = path.join(absoluteAreaPath(treesRoot, clean), PROCESS_FILE);
  let manifest = { scripts: {}, commands: {} };
  if (existsSync(file)) manifest = parseProgramManifest(await readFile(file, "utf8"), `${clean}/${PROCESS_FILE}`);
  const field = type === "process" ? "scripts" : "commands";
  if (manifest.scripts[slug] || manifest.commands[slug]) throw new Error(`“${programLabel(slug)}” already exists on this area.`);
  manifest[field][slug] = { command: String(command).trim(), cwd: directory };
  const temporary = `${file}.agent-shell-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporary, file);
  return { id: `${type}:${clean}:${slug}`, area: clean, name: slug };
}
