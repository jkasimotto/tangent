import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { absoluteAreaPath, cleanAreaPath, areaSlug } from "./area-operations.mjs";

const PROCESS_FILE = ".processes.json";
const TREE_SKIP = new Set([".git", ".obsidian", "shared", "node_modules"]);
const PROGRAM_NAME = /^[a-z0-9][a-z0-9-]*$/;
const DURATION = /^(\d+)(s|m|h|d)$/;

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

/** Creates the same deterministic session name as `tangent trigger`. */
export function triggerSession(area, name) {
  const base = `${area.split("/").pop()}--${name}`.replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  const hash = createHash("sha1").update(`trigger\0${area}\0${name}`).digest("hex").slice(0, 8);
  return `trigger-${base}-${hash}`;
}

/** Reads one area's exact Repository or Worktree resource. */
export async function programDirectory(treesRoot, area) {
  const clean = cleanAreaPath(area);
  const base = path.basename(clean);
  let text;
  try {
    text = await readFile(path.join(absoluteAreaPath(treesRoot, clean), `${base}.md`), "utf8");
  } catch {
    return null;
  }
  const resources = text.split(/^## /m).find((section) => section.startsWith("Resources")) ?? "";
  const match = resources.match(/^\s*-\s*(?:Repository|Worktree):\s*(.+?)\s*$/mi);
  if (!match) return null;
  const cwd = match[1].replace(/^~(?=\/|$)/, os.homedir());
  return path.isAbsolute(cwd) && existsSync(cwd) ? cwd : null;
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
  const unknown = Object.keys(value).filter((key) => !["scripts", "commands", "triggers"].includes(key));
  if (unknown.length) throw new Error(`${file}: unsupported field ${unknown[0]}`);
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
      if (typeof command !== "string" || !command.trim()) throw new Error(`${file}: ${name} needs a command`);
      if (cwd !== undefined && (typeof cwd !== "string" || !cwd.trim())) throw new Error(`${file}: ${name} needs a valid working folder`);
      output[name] = { command: command.trim(), ...(typeof cwd === "string" ? { cwd: cwd.trim().replace(/^~(?=\/|$)/, os.homedir()) } : {}) };
    }
    return output;
  };
  const triggers = {};
  if (value.triggers !== undefined) {
    if (!value.triggers || typeof value.triggers !== "object" || Array.isArray(value.triggers)) throw new Error(`${file}: triggers must be an object`);
    for (const [name, raw] of Object.entries(value.triggers)) {
      if (!PROGRAM_NAME.test(name)) throw new Error(`${file}: invalid program name ${name}`);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${file}: trigger ${name} must be an object`);
      const every = typeof raw.every === "string" ? raw.every.trim() : "";
      const probe = typeof raw.probe === "string" ? raw.probe.trim() : "";
      const instructions = typeof raw.instructions === "string" ? raw.instructions.trim() : "";
      const cwd = typeof raw.cwd === "string" ? raw.cwd.trim().replace(/^~(?=\/|$)/, os.homedir()) : undefined;
      if (!DURATION.test(every)) throw new Error(`${file}: trigger ${name} needs an interval such as 15m`);
      if (!probe) throw new Error(`${file}: trigger ${name} needs a probe`);
      if (!instructions) throw new Error(`${file}: trigger ${name} needs instructions`);
      triggers[name] = { every, probe, instructions, paused: raw.paused === true, ...(cwd ? { cwd } : {}) };
    }
  }
  return { scripts: readMap("scripts"), commands: readMap("commands"), triggers };
}

/** Reads all managed processes and commands for the UI. */
export async function programsSnapshot({ treesRoot, sessions = [] }) {
  const programs = [];
  const errors = [];
  const areas = [];
  const triggerState = await readTriggerState();
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
          programs.push({ id: `process:${area}:${name}`, type: "process", area, name, label: programLabel(name), command: entry.command, cwd: programCwd, sessionName, session: session ?? null, available: Boolean(programCwd && existsSync(programCwd)) });
        }
        for (const [name, entry] of Object.entries(parsed.commands)) {
          const programCwd = entry.cwd || cwd;
          const sessionName = commandSession(area, name);
          const session = sessions.find((item) => item.name === sessionName);
          programs.push({ id: `command:${area}:${name}`, type: "command", area, name, label: programLabel(name), command: entry.command, cwd: programCwd, sessionName, session: session ?? null, available: Boolean(programCwd && existsSync(programCwd)) });
        }
        for (const [name, entry] of Object.entries(parsed.triggers)) {
          const programCwd = entry.cwd || cwd;
          const sessionName = triggerSession(area, name);
          const session = sessions.find((item) => item.name === sessionName || (item.kind === "trigger" && item.area === area && item.process === name));
          const runtime = triggerState.triggers?.[`${area}:${name}`] ?? {};
          programs.push({
            id: `trigger:${area}:${name}`, type: "trigger", area, name, label: programLabel(name), command: entry.probe,
            probe: entry.probe, instructions: entry.instructions, every: entry.every, paused: entry.paused, runtime,
            cwd: programCwd, sessionName, session: session ?? null, available: Boolean(programCwd && existsSync(programCwd))
          });
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
  return { programs, errors, areas, liveCount };
}

/** Reads the durable trigger projection; an absent or malformed file degrades to no state. */
async function readTriggerState() {
  const file = path.join(process.env.TANGENT_HOME || path.join(os.homedir(), ".tangent"), "agent-shell", "triggers", "state.json");
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return value && typeof value === "object" ? value : { triggers: {} };
  } catch {
    return { triggers: {} };
  }
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
  let manifest = { scripts: {}, commands: {}, triggers: {} };
  if (existsSync(file)) manifest = parseProgramManifest(await readFile(file, "utf8"), `${clean}/${PROCESS_FILE}`);
  const field = type === "process" ? "scripts" : "commands";
  if (manifest.scripts[slug] || manifest.commands[slug]) throw new Error(`“${programLabel(slug)}” already exists on this area.`);
  manifest[field][slug] = { command: String(command).trim(), cwd: directory };
  const temporary = `${file}.agent-shell-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporary, file);
  return { id: `${type}:${clean}:${slug}`, area: clean, name: slug };
}
