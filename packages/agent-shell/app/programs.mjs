import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { absoluteAreaPath, cleanAreaPath, areaSlug } from "./area-operations.mjs";

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
  const unknown = Object.keys(value).filter((key) => !["scripts", "commands"].includes(key));
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
  return { scripts: readMap("scripts"), commands: readMap("commands") };
}

/** Reads one recurring-agent definition without expanding its prompt. */
export function parseRoutine(area, file, text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${file}: frontmatter is missing`);
  const fields = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([a-z_]+):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim();
  }
  const schedule = fields.schedule?.match(/^daily\s+(\d{2}:\d{2})$/i);
  if (!schedule) throw new Error(`${file}: only daily HH:MM schedules are supported here`);
  if (!fields.cwd) throw new Error(`${file}: cwd is required`);
  return {
    id: `routine:${area}:${file}`,
    type: "routine",
    area,
    name: file.replace(/^recur-/, "").replace(/\.md$/, ""),
    label: programLabel(file.replace(/^recur-/, "").replace(/\.md$/, "")),
    source: `${area}/${file}`,
    schedule: `daily ${schedule[1]}`,
    time: schedule[1],
    cwd: fields.cwd.replace(/^~(?=\/|$)/, os.homedir()),
    model: fields.model || "sonnet",
    paused: fields.paused?.toLowerCase() === "true",
    prompt: match[2].trim(),
    sessionName: `tg-${file.replace(/^recur-/, "").replace(/\.md$/, "")}`,
  };
}

/** Computes the next local run for one daily time. */
function nextDailyRun(time, now = new Date()) {
  const [hour, minute] = time.split(":").map(Number);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

/** Reads all processes, commands, and recurring agents for the UI. */
export async function programsSnapshot({ treesRoot, sessions = [], sidecarFile = path.join(os.homedir(), ".tangent", "threads-status.json") }) {
  const programs = [];
  const errors = [];
  const areas = [];
  let sidecar = {};
  try { sidecar = JSON.parse(await readFile(sidecarFile, "utf8")); } catch {}
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
      } catch (error) {
        errors.push({ area, file: `${area}/${PROCESS_FILE}`, error: error.message });
      }
    }
    let files = [];
    try { files = await readdir(directory); } catch {}
    for (const file of files.filter((name) => /^recur-[^/]+\.md$/.test(name))) {
      try {
        const routine = parseRoutine(area, file, await readFile(path.join(directory, file), "utf8"));
        const session = sessions.find((item) => item.name === routine.sessionName) ?? null;
        programs.push({
          ...routine,
          session,
          available: existsSync(routine.cwd),
          lastRunAt: sidecar.recur?.[routine.name]?.lastRunAt ?? null,
          nextRunAt: routine.paused ? null : nextDailyRun(routine.time),
        });
      } catch (error) {
        errors.push({ area, file: `${area}/${file}`, error: error.message });
      }
    }
  }
  programs.sort((left, right) => {
    const leftLive = left.session && !["shell", "stopped"].includes(left.session.state) ? 1 : 0;
    const rightLive = right.session && !["shell", "stopped"].includes(right.session.state) ? 1 : 0;
    return rightLive - leftLive || left.area.localeCompare(right.area) || left.label.localeCompare(right.label);
  });
  const liveCount = programs.filter((program) => program.session && !["shell", "stopped"].includes(program.session.state)).length;
  return { programs, errors, areas, liveCount, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
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

/** Creates one committed daily agent routine definition. */
export async function saveRoutine({ treesRoot, area, name, time, cwd, model, prompt }) {
  const clean = cleanAreaPath(area);
  const slug = areaSlug(name);
  if (!PROGRAM_NAME.test(slug)) throw new Error("Use a routine name with letters or numbers.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time ?? ""))) throw new Error("Use a valid daily time.");
  const directory = String(cwd ?? "").replace(/^~(?=\/|$)/, os.homedir());
  if (!path.isAbsolute(directory) || !existsSync(directory)) throw new Error("Choose an existing working directory.");
  if (!String(prompt ?? "").trim()) throw new Error("Describe what the agent must do.");
  for (const other of await allAreas(treesRoot)) {
    if (existsSync(path.join(absoluteAreaPath(treesRoot, other), `recur-${slug}.md`))) throw new Error(`A routine named “${programLabel(slug)}” already exists.`);
  }
  const file = `${clean}/recur-${slug}.md`;
  const text = `---\nschedule: daily ${time}\ncwd: ${directory}\nmodel: ${String(model || "sonnet").trim()}\npaused: false\n---\n${String(prompt).trim()}\n`;
  await writeFile(path.join(treesRoot, file), text, "utf8");
  return { id: `routine:${clean}:recur-${slug}.md`, file, area: clean, name: slug };
}

/** Changes a recurring agent's paused field without changing its prompt. */
export async function setRoutinePaused({ treesRoot, source, paused }) {
  const relative = cleanAreaPath(source);
  if (!/\/recur-[^/]+\.md$/.test(relative)) throw new Error("Choose a recurring agent routine.");
  const file = absoluteAreaPath(treesRoot, relative);
  const text = await readFile(file, "utf8");
  const next = /^paused:/m.test(text)
    ? text.replace(/^paused:.*$/m, `paused: ${paused ? "true" : "false"}`)
    : text.replace(/^---\n/, `---\npaused: ${paused ? "true" : "false"}\n`);
  await writeFile(file, next, "utf8");
  return { file: relative, paused: Boolean(paused) };
}
