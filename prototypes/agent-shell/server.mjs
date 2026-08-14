// Agent Shell prototype server.
// Serves the focus-and-return frontend and bridges WebSocket connections to
// tmux sessions through node-pty.
import http from "node:http";
import os from "node:os";
import { createHash } from "node:crypto";
import { appendFile, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { doneCascade } from "./goal-cascade.mjs";
import { noteResource } from "./area-agent-command.mjs";
import { harnessModels, inheritedLaunch, parseHarnessRegistry, resolveLaunch, upsertEnvironmentLaunch, upsertHarnessRegistry, validateHarnessRegistry } from "./launch-environment.mjs";
import { createArea, moveArea, areaHasGitChanges, previewAreaMove } from "./area-operations.mjs";
import { commandSession, programsSnapshot, saveLocalProgram, saveRoutine, setRoutinePaused } from "./programs.mjs";
import { createReviewedBuildBridge } from "./reviewed-build.mjs";
import pty from "node-pty";
import { documentHash, markdownTitle, safeMarkdownPath, wikiLinks } from "./vault-documents.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? "127.0.0.1";
const GOAL_COMMAND = path.join(here, "goal-command.mjs");
let agentCmd = process.env.AGENT_CMD ?? "claude";

/**
 * Reads the machine-wide harness registry from the vault root Document
 * (~/.tangent/trees/harnesses.md). An empty registry is valid: launches
 * then rely on legacy `- Agent:` lines and the profile fallback.
 */
async function harnessRegistry() {
  const text = await readFile(path.join(TREES_ROOT, "harnesses.md"), "utf8").catch(() => "");
  return parseHarnessRegistry(text) ?? { modelSets: {}, harnesses: [] };
}

/**
 * The default launch for one Area, resolved through the harness registry
 * (design contract: design-goal-launch-environments). The nearest Area
 * environment default wins, then a legacy `- Agent:` line, then the profile
 * fallback (otto/** runs claude-otto, other Areas plain claude). Returns
 * { command, label, harness, model, source } or { error } — a broken
 * declaration blocks the launch instead of substituting another command.
 */
async function launchForArea(area) {
  const registry = await harnessRegistry();
  if (registry.error) return { error: registry.error };
  return inheritedLaunch(area, areaNote, registry);
}

/**
 * The launch command a Goal session pre-types for the user to accept or
 * edit. It is a suggestion, not a policy: editing the line is how one Run
 * uses any other harness or model. The switchable agentCmd only ever
 * applies to the orchestrator session.
 */
async function agentCmdForArea(area) {
  const launch = await launchForArea(area);
  if (launch.error) throw new Error(launch.error);
  return launch.command;
}

/**
 * Resolves an explicit per-run launch choice from a request body: an exact
 * edited `command` wins, then a `choice: { harness, model }` registry
 * reference. (`launch` stays the existing press-Enter boolean.) Empty
 * fields mean "use the Area default". Errors name the id that failed.
 */
async function requestedLaunch(body) {
  if (typeof body.command === "string" && body.command.trim()) {
    return { command: body.command.trim(), label: "Edited command" };
  }
  if (body.choice && typeof body.choice === "object") {
    const registry = await harnessRegistry();
    if (registry.error) return { error: registry.error };
    return resolveLaunch(registry, body.choice);
  }
  return { command: "", label: "" };
}

/**
 * claude persists the last /model choice across sessions, so a fresh
 * session silently reopens on whatever model was used last (fable, say).
 * Pin claude launches to the default model unless the command already
 * picks one explicitly.
 */
function withDefaultModel(cmd) {
  const launchesClaude = cmd.split(/\s+/)[0].includes("claude");
  if (!launchesClaude || cmd.includes("--model")) return cmd;
  return `${cmd} --model default`;
}
const CHAT_SESSION = process.env.CHAT_SESSION ?? "orchestrator";
const WORKSPACE = process.env.WORKSPACE ?? path.join(here, "workspace");
const TREES_ROOT = process.env.TREES_ROOT ?? path.join(os.homedir(), ".tangent", "trees");
const reviewedBuild = createReviewedBuildBridge({
  treesRoot: TREES_ROOT,
  loopsRoot: process.env.TANGENT_LOOPS_ROOT,
});

if (!existsSync(WORKSPACE)) mkdirSync(WORKSPACE, { recursive: true });

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".png": "image/png",
};

/**
 * Lists live tmux sessions for the sidebar in the frontend, which polls
 * /api/sessions to discover sessions the chat agent created. The `area`
 * field is the tangent tree area the session belongs to, read from the
 * tmux user option `@tangent_area` that the agent sets at creation time.
 */
async function listSessions() {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}\t#{session_path}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{@tangent_area}\t#{@tangent_kind}\t#{@tangent_goal}\t#{@tangent_process}\t#{pane_current_command}\t#{@tangent_phase}\t#{@tangent_work_title}\t#{@tangent_launch}",
    ]);
    const sessions = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, cwd, windows, attached, created, area, kind, goal, processName, command, phase, workTitle, launchLabel] = line.split("\t");
        return {
          name,
          cwd,
          windows: Number(windows),
          attached: Number(attached) > 0,
          created: Number(created) * 1000,
          area: area || null,
          kind: kind || null,
          goal: goal || null,
          process: processName || null,
          command,
          phase: phase || null,
          workTitle: workTitle || null,
          launchLabel: launchLabel || null,
          isChat: name === CHAT_SESSION,
        };
      });
    return await withAgentStates(await withGoalInfo(sessions));
  } catch {
    return []; // no tmux server running yet
  }
}

/** Reads only the tmux facts Programs needs, without sampling agent screens. */
async function listProgramSessions() {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}\t#{session_path}\t#{@tangent_area}\t#{@tangent_kind}\t#{@tangent_process}\t#{pane_current_command}",
    ]);
    return stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [name, cwd, area, kind, processName, command] = line.split("\t");
      const stopped = SHELL_CMDS.has(command);
      return { name, cwd, area: area || null, kind: kind || null, process: processName || null, command, state: stopped ? "stopped" : "service" };
    });
  } catch {
    return [];
  }
}

// ---- agent state via screen diff ----
// An agent TUI repaints at least once a second while working (spinner and
// elapsed-seconds timer) and goes fully static when it waits for input, so
// hashing the visible pane between polls separates "working" from "waiting".
// A plain shell as the pane command means no agent is running at all. This
// covers every harness without hooks; a later refinement can split "waiting"
// into idle-at-prompt vs blocked-on-question with a cheap LLM call.
const SHELL_CMDS = new Set(["zsh", "bash", "fish", "sh", "dash", "tcsh", "nu"]);
const MIN_SAMPLE_MS = 1200; // a repaint window; closer polls can't show a diff
const paneSamples = new Map(); // session name -> { hash, at, state }

/**
 * Hashes the visible pane content of a session's active pane, the raw signal
 * for the working/waiting screen diff.
 */
async function screenHash(name) {
  // "=name:" is an exact session match; capture-pane rejects bare "=name".
  const { stdout } = await execFileAsync("tmux", ["capture-pane", "-p", "-t", "=" + name + ":"]);
  return createHash("sha1").update(stdout).digest("hex");
}

/**
 * Classifies one session as working, waiting, or shell by comparing the pane
 * hash against the previous poll's sample in `paneSamples`. Polls closer than
 * MIN_SAMPLE_MS return the cached state, so extra clients cannot mask repaints.
 */
function classifyState(name, command, hash, now) {
  if (SHELL_CMDS.has(command)) {
    paneSamples.set(name, { hash, at: now, state: "shell" });
    return "shell";
  }
  const prev = paneSamples.get(name);
  if (prev && now - prev.at < MIN_SAMPLE_MS) return prev.state;
  const state = !prev || prev.state === "shell" || hash !== prev.hash ? "working" : "waiting";
  paneSamples.set(name, { hash, at: now, state });
  return state;
}

/**
 * Attaches a `state` field to each session for the sidebar chips and drops
 * samples of sessions that no longer exist. Capture failures degrade to
 * state null rather than hiding the session.
 *
 * Program sessions skip the screen diff.
 * skip the screen diff: a quiet server would read as a waiting agent. The
 * pane command is signal enough — a shell means the command exited.
 */
async function withAgentStates(sessions) {
  const now = Date.now();
  const out = await Promise.all(
    sessions.map(async (s) => {
      if (s.kind === "process" || s.kind === "service" || s.kind === "command") {
        return { ...s, state: SHELL_CMDS.has(s.command) ? "stopped" : "service" };
      }
      try {
        return { ...s, state: classifyState(s.name, s.command, await screenHash(s.name), now) };
      } catch {
        return { ...s, state: null };
      }
    })
  );
  for (const name of paneSamples.keys()) {
    if (!sessions.some((s) => s.name === name)) paneSamples.delete(name);
  }
  return out;
}

/**
 * Reads one labelled line from an Area note's `## Resources` section, the
 * vault's home for per-area settings the shell honours when it opens a
 * session (`- Repository: ~/Projects/x`, `- Agent: claude`). Returns null
 * when the note, the section, or the label is missing.
 */
async function areaResource(area, label) {
  const base = String(area ?? "").split("/").pop();
  let text;
  try {
    text = await readFile(path.join(TREES_ROOT, area, base + ".md"), "utf8");
  } catch {
    return null;
  }
  return noteResource(text, label);
}

/**
 * Resolves the working directory for a tree area from its area note's
 * `## Resources` section (a `Repository:` or `Worktree:` line), the same
 * lookup the chat agent performs when it opens sessions. Returns null when
 * the note records no usable directory.
 */
async function areaDirectory(area) {
  const recorded = await areaResource(area, "Repository|Worktree");
  if (!recorded) return null;
  const dir = recorded.replace(/^~(?=\/|$)/, os.homedir());
  return path.isAbsolute(dir) && existsSync(dir) ? dir : null;
}

let caffeinateProc = null; // running `caffeinate -di` child, or null

/**
 * Starts or stops a `caffeinate -di` child, the header's keep-awake toggle
 * for long agent runs. `-w` ties the assertion to this server's lifetime, so
 * quitting the shell can never leave the machine stuck awake.
 */
function setCaffeinate(on) {
  if (on && !caffeinateProc) {
    caffeinateProc = spawn("caffeinate", ["-di", "-w", String(process.pid)], { stdio: "ignore" });
    caffeinateProc.on("exit", () => (caffeinateProc = null));
  } else if (!on && caffeinateProc) {
    caffeinateProc.kill();
    caffeinateProc = null;
  }
}

/** Collects a request body as a string for the JSON POST endpoints. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Creates a detached tmux work session on a tree area: plain shell in the
 * area's recorded repository, bound via @tangent_area. Backs the sidebar's
 * `+` affordance; the chat agent remains the path for richer setups.
 */
async function spawnSession(area, name) {
  if (!/^[a-z0-9-]+$/.test(name ?? "")) return { status: 400, error: "name must be lowercase letters, digits, hyphens" };
  const dir = await areaDirectory(area);
  if (!dir) return { status: 409, error: "no repo recorded, ask chat" };
  // Exact-name existence check via list-sessions: has-session prefix-matches,
  // and set-option rejects the "=" exact-match prefix on this tmux, so "="
  // targets are unusable here.
  try {
    const { stdout } = await execFileAsync("tmux", ["list-sessions", "-F", "#{session_name}"]);
    if (stdout.split("\n").includes(name)) return { status: 409, error: `session "${name}" already exists` };
  } catch {} // no tmux server yet: nothing exists
  await execFileAsync("tmux", ["new-session", "-d", "-s", name, "-c", dir]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_area", area]);
  return { status: 200 };
}

const TREE_SKIP = new Set([".git", ".obsidian", "shared", "node_modules"]);

/**
 * Walks the Tangent vault and returns Areas as a nested tree.
 * Directories are Areas. The walk ignores files and
 * vault internals (.git, .obsidian) and shared/ team repos.
 */
async function readTree(dir, rel = "") {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const areas = [];
  for (const e of entries) {
    if (!e.isDirectory() || TREE_SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    areas.push({
      name: e.name,
      path: childRel,
      children: await readTree(path.join(dir, e.name), childRel),
    });
  }
  areas.sort((a, b) => a.name.localeCompare(b.name));
  return areas;
}

/** Runs one vault git command, with a filesystem fallback for isolated tests. */
async function runVaultGit(args, fallback) {
  try {
    await execFileAsync("git", ["-C", TREES_ROOT, ...args]);
  } catch (error) {
    if (existsSync(path.join(TREES_ROOT, ".git"))) throw error;
    if (fallback) await fallback();
  }
}

/** Captures one read-only vault git command, or an empty result outside git. */
async function captureVaultGit(args) {
  try {
    return (await execFileAsync("git", ["-C", TREES_ROOT, ...args])).stdout;
  } catch (error) {
    if (existsSync(path.join(TREES_ROOT, ".git"))) throw error;
    return "";
  }
}

/** Updates live tmux bindings after an Area subtree moves. */
async function moveSessionBindings(preview) {
  for (const session of await listSessions()) {
    if (!session.area || (session.area !== preview.source && !session.area.startsWith(`${preview.source}/`))) continue;
    const area = `${preview.destination}${session.area.slice(preview.source.length)}`;
    await execFileAsync("tmux", ["set-option", "-t", session.name, "@tangent_area", area]).catch(() => {});
    if (session.goal?.startsWith(`${preview.source}/`)) {
      const goal = `${preview.destination}${session.goal.slice(preview.source.length)}`;
      await execFileAsync("tmux", ["set-option", "-t", session.name, "@tangent_goal", goal]).catch(() => {});
    }
  }
}

/** Runs, stops, or closes one on-demand command in its retained tmux session. */
async function controlCommand(program, action) {
  const session = commandSession(program.area, program.name);
  const sessions = await listProgramSessions();
  const current = sessions.find((item) => item.name === session);
  if (action === "close") {
    if (current) await execFileAsync("tmux", ["kill-session", "-t", `=${session}`]);
    return;
  }
  if (action === "stop") {
    if (current && current.state !== "stopped") await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "C-c"]);
    return;
  }
  if (action !== "run") throw new Error("This command supports Run, Stop, and Close.");
  if (!program.cwd) throw new Error("This area needs a Repository or Worktree resource first.");
  if (current && current.state !== "stopped") throw new Error("This command is already running.");
  if (!current) {
    await execFileAsync("tmux", ["new-session", "-d", "-s", session, "-c", program.cwd]);
    await execFileAsync("tmux", ["set-option", "-t", session, "@tangent_kind", "command"]);
    await execFileAsync("tmux", ["set-option", "-t", session, "@tangent_area", program.area]);
    await execFileAsync("tmux", ["set-option", "-t", session, "@tangent_process", program.name]);
  }
  await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", program.command]);
  await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "Enter"]);
}

/** Runs the built Tangent CLI against this server's vault. */
async function runLocalTangent(args) {
  const entry = path.resolve(here, "../../dist/cli/index.js");
  if (!existsSync(entry)) throw new Error("Build Tangent before this action.");
  return execFileAsync(process.execPath, [entry, ...args], {
    env: { ...process.env, TANGENT_TREES_DIR: TREES_ROOT },
  });
}

let schedulerStatusCache = null;

/** Reports whether the macOS recurring-agent dispatcher is installed. */
async function recurringSchedulerStatus() {
  if (schedulerStatusCache && Date.now() - schedulerStatusCache.at < 30_000) return schedulerStatusCache.value;
  const service = `gui/${os.userInfo().uid}/com.tangent.threads-recur`;
  try {
    const { stdout } = await execFileAsync("launchctl", ["print", service]);
    const lastExit = stdout.match(/last exit code = (-?\d+)/)?.[1] ?? null;
    const value = { installed: true, intervalMinutes: 30, lastExitCode: lastExit === null ? null : Number(lastExit) };
    schedulerStatusCache = { at: Date.now(), value };
    return value;
  } catch {
    const value = { installed: false, intervalMinutes: 30, lastExitCode: null };
    schedulerStatusCache = { at: Date.now(), value };
    return value;
  }
}

// ---- goals ----
// Goal files live beside their Area note. A Goal can contain other Goals
// through the Subgoals section. This relation records why and how. It does not
// create another Area. The server owns only session binding and direct edits.

/** Parses the note/goal frontmatter block into a flat {key: value} object. */
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

/** The text of one `## <name>` section of a note, without the heading. */
function noteSection(text, name) {
  const s = text.split(/^## /m).find((x) => x.startsWith(name));
  return s ? s.slice(name.length).replace(/^\n+/, "").split(/^## /m)[0].trim() : "";
}

/** Reads an Area note, or an empty string when no note exists. */
async function areaNote(area) {
  try {
    return await readFile(path.join(TREES_ROOT, area, area.split("/").pop() + ".md"), "utf8");
  } catch {
    return "";
  }
}

/** Reads the Documents that belong directly to one Area. */
async function readAreaDocuments(area) {
  const dir = path.join(TREES_ROOT, area);
  const noteName = area.split("/").pop() + ".md";
  let files;
  try { files = await readdir(dir); } catch { return []; }
  const documents = [];
  for (const name of files.filter((f) => f.endsWith(".md") && f !== noteName && !/^(?:goal|outcome)-/.test(f))) {
    const file = `${area}/${name}`;
    const absolute = path.join(dir, name);
    try {
      const [text, info] = await Promise.all([readFile(absolute, "utf8"), stat(absolute)]);
      if (name.startsWith("recur-") || parseFrontmatter(text).type === "routine") continue;
      documents.push({
        file, area, kind: "document", title: markdownTitle(text, name.slice(0, -3)),
        mtime: info.mtimeMs, hash: documentHash(text), links: wikiLinks(text),
        searchText: `${file}\n${text}`.toLowerCase(),
      });
    } catch {}
  }
  return documents.sort((a, b) => a.title.localeCompare(b.title));
}

/** Reads one indexed vault Markdown file, including its derived link context. */
async function readVaultDocument(file) {
  const safe = safeMarkdownPath(TREES_ROOT, file);
  if (!safe) return null;
  const index = await vaultIndex();
  const metadata = index.documents.find((d) => d.file === safe.relative);
  if (!metadata) return null;
  const text = await readFile(safe.absolute, "utf8").catch(() => null);
  return text == null ? null : { ...metadata, text, hash: documentHash(text) };
}

/** Tests one wiki target against a record path or its short stem. */
function linkTargetsRecord(target, record) {
  if (!record) return false;
  const link = String(target ?? "").replace(/\.md$/i, "").replaceAll("\\", "/");
  const recordPath = record.file.replace(/\.md$/i, "");
  return link.includes("/") ? link === recordPath : path.basename(link) === path.basename(recordPath);
}

/** Conflict-safe, atomic replacement of an existing indexed Markdown file. */
async function saveVaultDocument(file, text, baseHash) {
  const current = await readVaultDocument(file);
  if (!current) return { status: 404, error: `no document ${file}` };
  if (!baseHash || baseHash !== current.hash) {
    return { status: 409, error: "document changed since it was opened", current };
  }
  const safe = safeMarkdownPath(TREES_ROOT, file);
  const temp = `${safe.absolute}.tangent-${process.pid}-${Date.now()}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, safe.absolute);
  await vaultCommit([safe.relative], `update: ${current.area} ${current.kind} ${path.basename(file, ".md")} edited in tree`, current.area, null);
  return { status: 200, document: { ...current, text, hash: documentHash(text) } };
}

/** Reads current or legacy Goal links from one ordered Markdown section. */
function goalLinkOrder(text) {
  return [...String(text ?? "").matchAll(/\[\[(?:goal|outcome)-([a-z0-9-]+)(?:[^\]]*)\]\]/g)].map((match) => match[1]);
}

/** Reads top-level Goal slugs in their authored order. */
function areaGoalOrder(noteText) {
  return [...new Set([
    ...goalLinkOrder(noteSection(noteText, "Goals")),
    ...goalLinkOrder(noteSection(noteText, "Road to done")),
  ])];
}

/** Reads Subgoal slugs in their authored order. */
function subgoalsOrder(text) {
  return [...new Set([
    ...goalLinkOrder(noteSection(text, "Subgoals")),
    ...goalLinkOrder(noteSection(text, "Breakdown")),
  ])];
}

/**
 * Reads the Goal files in one Area directory. The index derives their order.
 */
async function readAreaGoals(area) {
  let entries;
  try {
    entries = await readdir(path.join(TREES_ROOT, area));
  } catch {
    return [];
  }
  const goals = [];
  for (const f of entries.filter((f) => /^(?:goal|outcome)-[a-z0-9-]+\.md$/.test(f))) {
    let text;
    try {
      text = await readFile(path.join(TREES_ROOT, area, f), "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    if (!["goal", "outcome"].includes(fm.type)) continue;
    const slug = f.replace(/^(?:goal|outcome)-/, "").slice(0, -".md".length);
    const mtime = await stat(path.join(TREES_ROOT, area, f)).then((s) => s.mtimeMs, () => 0);
    const status = fm.status || "open";
    goals.push({
      mtime,
      area,
      slug,
      file: `${area}/${f}`,
      title: text.match(/^# (.+)$/m)?.[1]?.trim() ?? slug,
      status,
      doneWhen: fm.done_when || fm.outcome || "",
      stateText: noteSection(text, "State"),
      myUnderstanding: noteSection(text, "My understanding"),
      currentBrief: noteSection(text, "Current brief"),
      storyText: noteSection(text, "Story so far"),
      waitingOn: fm.waiting_on || null,
      due: fm.due || null,
      session: fm.session || null,
      subgoals: subgoalsOrder(text),
    });
  }
  return goals;
}

/**
 * The launcher's search index: every area with its note's purpose line, the
 * people on it (owners/waiting_on, including its goals'), a lowercased
 * body excerpt for content matches ("sami" finds the area whose note mentions
 * Sami), and its goals. Each area's goal list is the depth-first
 * flatten of its Goal roots through Subgoal links. Subgoals can be
 * homed in other areas), with `depth` for indentation; goal files nothing
 * links trail at the top level, alphabetically.
 * Small vault, read fresh per request. Returns { areas, map }: the per-area
 * entries for typed search, plus the unified deduplicated map (built below)
 * that the launcher's browse view renders.
 */
async function vaultIndex() {
  const flat = [];
  /** Depth-first over the area tree, collecting every area. */
  const walk = async (areas) => {
    for (const n of areas) {
      flat.push(n);
      await walk(n.children);
    }
  };
  await walk(await readTree(TREES_ROOT));
  const entries = [];
  const bySlug = new Map();
  for (const n of flat) {
    const note = await areaNote(n.path);
    const own = await readAreaGoals(n.path);
    const documents = await readAreaDocuments(n.path);
    entries.push({ n, note, own, documents });
    for (const o of own) if (!bySlug.has(o.slug)) bySlug.set(o.slug, o);
  }
  const linked = new Set([...bySlug.values()].flatMap((o) => o.subgoals));
  const parentBySlug = new Map();
  for (const goal of bySlug.values()) {
    for (const subgoal of goal.subgoals) {
      if (!parentBySlug.has(subgoal)) parentBySlug.set(subgoal, goal.slug);
    }
  }
  for (const goal of bySlug.values()) {
    const why = [];
    const seen = new Set([goal.slug]);
    let parentSlug = parentBySlug.get(goal.slug);
    while (parentSlug && !seen.has(parentSlug)) {
      seen.add(parentSlug);
      const parent = bySlug.get(parentSlug);
      if (!parent) break;
      why.unshift({ file: parent.file, title: parent.title, doneWhen: parent.doneWhen, status: parent.status });
      parentSlug = parentBySlug.get(parent.slug);
    }
    goal.why = why;
    goal.subgoalItems = goal.subgoals
      .map((slug) => bySlug.get(slug))
      .filter(Boolean)
      .map((subgoal) => ({ file: subgoal.file, title: subgoal.title, doneWhen: subgoal.doneWhen, status: subgoal.status }));
    goal.searchText = [
      goal.area,
      goal.title,
      goal.doneWhen,
      goal.stateText,
      goal.currentBrief,
      goal.storyText,
      ...why.flatMap((parent) => [parent.title, parent.doneWhen]),
    ].filter(Boolean).join("\n").toLowerCase();
  }
  const out = [];
  const records = [];
  for (const { n, note, own, documents } of entries) {
    const noteFile = `${n.path}/${n.name}.md`;
    records.push({ file: noteFile, area: n.path, kind: "note", title: markdownTitle(note, n.name), links: wikiLinks(note) });
    for (const o of own) {
      const text = await readFile(path.join(TREES_ROOT, o.file), "utf8").catch(() => "");
      records.push({ file: o.file, area: o.area, kind: "goal", title: o.title, links: wikiLinks(text), searchText: o.searchText });
    }
    records.push(...documents);
  }
  const byTarget = new Map(records.map((record) => [record.file.replace(/\.md$/i, ""), record]));
  const byStem = new Map(records.map((record) => [path.basename(record.file, ".md"), record]));
  const backlinks = new Map(records.map((r) => [r.file, []]));
  for (const source of records) for (const target of source.links) {
    const hit = target.includes("/") ? byTarget.get(target.replace(/\.md$/i, "")) : byStem.get(path.basename(target));
    if (hit && hit.file !== source.file) backlinks.get(hit.file).push(source.file);
  }
  for (const record of records) record.backlinks = backlinks.get(record.file) ?? [];
  for (const goal of bySlug.values()) {
    const goalRecord = records.find((record) => record.file === goal.file);
    const directOrder = goalRecord?.links ?? [];
    const directLinks = new Set(directOrder);
    const related = records
      .filter((record) => ["document", "goal"].includes(record.kind) && record.file !== goal.file)
      .filter((record) => [...directLinks].some((target) => linkTargetsRecord(target, record)) || record.backlinks.includes(goal.file))
      .sort((left, right) => {
        const leftIndex = directOrder.findIndex((target) => linkTargetsRecord(target, left));
        const rightIndex = directOrder.findIndex((target) => linkTargetsRecord(target, right));
        return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
          || left.title.localeCompare(right.title);
      });
    goal.documents = related
      .filter((record) => record.kind === "document")
      .map((record) => ({ file: record.file, title: record.title, kind: record.kind }));
  }
  for (const document of records.filter((record) => record.kind === "document")) {
    const relatedGoals = [...bySlug.values()].filter((goal) => {
      const goalRecord = records.find((record) => record.file === goal.file);
      return goalRecord?.links.some((target) => linkTargetsRecord(target, document))
        || document.links.some((target) => linkTargetsRecord(target, goalRecord));
    });
    const history = [];
    const seen = new Set();
    for (const goal of relatedGoals) {
      for (const item of [...goal.why, { file: goal.file, title: goal.title, doneWhen: goal.doneWhen, status: goal.status }]) {
        if (seen.has(item.file)) continue;
        seen.add(item.file);
        history.push(item);
      }
    }
    document.goalHistory = history;
    document.searchText = [
      document.searchText,
      document.area,
      ...history.flatMap((goal) => [goal.title, goal.doneWhen]),
    ].filter(Boolean).join("\n").toLowerCase();
  }

  for (const { n, note, own, documents } of entries) {
    const roots = areaGoalOrder(note).filter((s) => bySlug.has(s));
    const unlinked = own.map((o) => o.slug).filter((s) => !roots.includes(s) && !linked.has(s)).sort();
    const seen = new Set();
    const goals = [];
    /** Flattens one goal and its subgoals descendants, depth-first. */
    const dive = (slug, depth) => {
      const o = bySlug.get(slug);
      if (!o || seen.has(slug)) return;
      seen.add(slug);
      goals.push({ ...o, depth });
      for (const c of o.subgoals) dive(c, depth + 1);
    };
    for (const s of [...roots, ...unlinked]) dive(s, 0);
    const fm = parseFrontmatter(note);
    out.push({
      path: n.path,
      name: n.name,
      purpose: noteSection(note, "Purpose").split("\n")[0] ?? "",
      people: [fm.owners, fm.waiting_on, ...own.map((o) => o.waitingOn)].filter(Boolean).join(" "),
      body: note.slice(0, 4000).toLowerCase(),
      note: records.find((r) => r.kind === "note" && r.area === n.path),
      documents: documents.map((d) => ({ ...d, backlinks: backlinks.get(d.file) ?? [] })),
      goals,
    });
  }
  // The unified map: every goal exactly once, at its topmost position.
  // A root is a Goal that no other Goal links as a Subgoal.
  const groups = [];
  const groupByArea = new Map();
  const placed = new Set();
  for (const { n, note, own } of entries) {
    const road = areaGoalOrder(note).filter((s) => bySlug.has(s));
    const ordered = [...road, ...own.map((o) => o.slug).filter((s) => !road.includes(s)).sort()];
    for (const s of ordered) {
      if (linked.has(s) || placed.has(s)) continue;
      let g = groupByArea.get(n.path);
      if (!g) {
        g = { path: n.path, name: n.name, purpose: noteSection(note, "Purpose").split("\n")[0] ?? "", goals: [] };
        groupByArea.set(n.path, g);
        groups.push(g);
      }
      /** Places one root and its subgoals descendants into the group. */
      const place = (slug, depth) => {
        const o = bySlug.get(slug);
        if (!o || placed.has(slug)) return;
        placed.add(slug);
        g.goals.push({ ...o, depth, foreign: o.area === n.path ? null : o.area.split("/").pop() });
        for (const c of o.subgoals) place(c, depth + 1);
      };
      place(s, 0);
    }
  }
  // Heat: groups with a live (active) goal first, then most recently
  // touched, so the goal you came for is in the top rows before you type.
  for (const g of groups) {
    g.active = g.goals.some((o) => o.status === "active");
    g.mtime = Math.max(0, ...g.goals.map((o) => o.mtime ?? 0));
  }
  groups.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.mtime - a.mtime);
  return { areas: out, map: groups, documents: records };
}

/** Replaces (or appends) one `key: value` line inside a note's frontmatter. */
function withFrontmatterLine(text, key, value) {
  const fmMatch = text.match(/^---\n[\s\S]*?\n---/);
  if (!fmMatch) throw new Error("note has no frontmatter");
  const line = new RegExp(`^${key}:.*$`, "m");
  const next = value ? `${key}: ${value}` : `${key}:`;
  const fm = line.test(fmMatch[0])
    ? fmMatch[0].replace(line, () => next)
    : fmMatch[0].replace(/\n---$/, () => `\n${next}\n---`);
  return text.replace(fmMatch[0], () => fm);
}

/**
 * Rewrites the mechanical fields that the server owns in a Goal file.
 */
async function writeGoalBinding(file, { status, session, waitingOn }) {
  const abs = path.join(TREES_ROOT, file);
  let text = await readFile(abs, "utf8");
  text = withFrontmatterLine(text, "status", status);
  text = withFrontmatterLine(text, "session", session);
  if (waitingOn !== undefined) text = withFrontmatterLine(text, "waiting_on", waitingOn);
  await writeFile(abs, text);
}

/**
 * Applies a direct user edit to a Goal file.
 */
function replaceNoteSection(text, name, value) {
  const heading = `## ${name}`;
  const headingPattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*$`, "m");
  const match = headingPattern.exec(text);
  const body = value.trim();
  if (!match) return `${text.replace(/\s*$/, "")}\n\n${heading}\n\n${body}\n`;
  const contentStart = match.index + match[0].length;
  const rest = text.slice(contentStart).replace(/^\n/, "");
  const nextHeading = rest.search(/^## /m);
  const suffix = nextHeading >= 0 ? rest.slice(nextHeading) : "";
  return `${text.slice(0, contentStart)}\n\n${body}\n\n${suffix}`.replace(/\n{3,}(?=## )/g, "\n\n");
}

/** Applies the allowed direct-edit fields to one goal Markdown file. */
async function editGoalFile(file, { status, session, title, doneWhen, state, understanding, currentBrief, story }) {
  const abs = path.join(TREES_ROOT, file);
  let text = await readFile(abs, "utf8");
  if (status !== undefined) {
    text = withFrontmatterLine(text, "status", status);
    if (status === "done") {
      text = withFrontmatterLine(text, "session", null);
      text = withFrontmatterLine(text, "waiting_on", null);
    }
  }
  if (session !== undefined) text = withFrontmatterLine(text, "session", session);
  if (doneWhen !== undefined) {
    const current = parseFrontmatter(text);
    const field = current.type === "outcome" && !current.done_when ? "outcome" : "done_when";
    text = withFrontmatterLine(text, field, doneWhen.replace(/\s*\n\s*/g, " ").trim());
  }
  if (title !== undefined && title.trim()) {
    const t = title.replace(/\s*\n\s*/g, " ").trim();
    text = /^# .*$/m.test(text) ? text.replace(/^# .*$/m, () => "# " + t) : text + `\n# ${t}\n`;
  }
  if (state !== undefined) text = replaceNoteSection(text, "State", state);
  if (understanding !== undefined) text = replaceNoteSection(text, "My understanding", understanding);
  if (currentBrief !== undefined) text = replaceNoteSection(text, "Current brief", currentBrief);
  if (story !== undefined) text = replaceNoteSection(text, "Story so far", story);
  await writeFile(abs, text);
}

/** Collapses user-entered multiline text into one readable line. */
function oneLine(value) {
  return String(value ?? "").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** Allocates one vault-unique goal slug and records it as taken. */
function allocateGoalSlug(area, title, taken) {
  const base = normName(title).slice(0, 48).replace(/-+$/, "") || "goal";
  let slug = base;
  for (let index = 2; taken.has(slug) || existsSync(path.join(TREES_ROOT, area, `goal-${slug}.md`)); index += 1) {
    slug = `${base}-${index}`;
  }
  taken.add(slug);
  return slug;
}

/** Renders a new goal with compact return context from its first save. */
function renderNewGoal({ title, doneWhen, state, context, subgoals = [], sources = [] }) {
  const result = oneLine(doneWhen);
  const subgoalsSection = subgoals.length
    ? `\n\n## Subgoals\n\n${subgoals.map((slug, index) => `${index + 1}. [[goal-${slug}]]`).join("\n")}`
    : "";
  const contextParagraph = oneLine(context) ? `\n\n${oneLine(context)}` : "";
  const sourcesSection = sources.length
    ? `\n\n## Sources\n\n${sources.map((source) => `- [[${source.file.replace(/\.md$/i, "")}|${oneLine(source.title).replace(/[|\]]/g, "")}]]`).join("\n")}`
    : "";
  return (
    `---\ntype: goal\nstatus: open\ndone_when: ${result}\nsession:\n---\n\n` +
    `# ${oneLine(title)}${contextParagraph}${subgoalsSection}${sourcesSection}\n\n` +
    `## State\n\n${String(state ?? "").trim() || "Not started."}\n\n` +
    `## Current brief\n\n` +
    `- You wanted: ${result}\n` +
    `\n` +
    `## Story so far\n\n` +
    `### Goal defined\n\nThe result was saved. No agent has started.\n`
  );
}

/** Resolves client-supplied source paths to indexed Documents. */
async function sourceDocuments(value) {
  const requested = Array.isArray(value) ? value.slice(0, 8) : [];
  const documents = [];
  const seen = new Set();
  for (const item of requested) {
    const file = typeof item === "string" ? item : String(item?.file ?? "");
    if (!file || seen.has(file)) continue;
    const document = await readVaultDocument(file);
    if (!document || document.kind !== "document") continue;
    seen.add(document.file);
    documents.push(document);
  }
  return documents;
}

/** Returns the relative path for an Area note. */
function areaNoteFile(area) {
  return `${area}/${area.split("/").pop()}.md`;
}

/** Creates the minimal note text for an Area. */
function emptyAreaNote(area) {
  const title = area.split("/").pop().replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return (
    `---\ntype: area\nstatus: active\n---\n\n# ${title}\n\n` +
    `## Purpose\n\n\n\n## Current\n\n\n\n## Goals\n\n\n\n` +
    `## Knowledge\n\n\n\n## Ideas and open questions\n\n\n\n## Resources\n`
  );
}

/** Adds one top-level goal to the area's ordered Goals. */
async function addGoalToArea(area, slug) {
  const file = areaNoteFile(area);
  const absolute = path.join(TREES_ROOT, file);
  let text = await readFile(absolute, "utf8").catch(() => emptyAreaNote(area));
  const current = noteSection(text, "Goals");
  if (!current.includes(`[[goal-${slug}]]`)) {
    const count = goalLinkOrder(current).length;
    const next = [current, `${count + 1}. [[goal-${slug}]]`].filter(Boolean).join("\n");
    text = replaceNoteSection(text, "Goals", next);
    await writeFile(absolute, text);
  }
  return file;
}

/**
 * Creates one Goal and its optional Subgoals in one confirmed save.
 */
async function createGoalSet(area, { goal, subgoals = [], description = "", sources = [] }) {
  const taken = new Set([...(await goalsByFile()).values()].map((item) => item.slug));
  const goalSlug = allocateGoalSlug(area, goal.title, taken);
  const subgoalRecords = subgoals.map((subgoal) => ({
    ...subgoal,
    slug: allocateGoalSlug(area, subgoal.title, taken),
  }));
  const records = [
    { ...goal, slug: goalSlug, subgoals: subgoalRecords.map((subgoal) => subgoal.slug), context: description, sources },
    ...subgoalRecords.map((subgoal) => ({ ...subgoal, subgoals: [], context: `This Goal supports [[goal-${goalSlug}]].` })),
  ].map((record) => ({ ...record, file: `${area}/goal-${record.slug}.md` }));

  for (const record of records) {
    await writeFile(path.join(TREES_ROOT, record.file), renderNewGoal(record));
  }
  const noteFile = await addGoalToArea(area, goalSlug);
  const changed = [...records.map((record) => record.file), noteFile];
  await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", ...changed]).catch(() => {});
  await vaultCommit(changed, `add: ${area} goal ${goalSlug} from Agent Shell`, area, null);
  return { file: records[0].file, files: records.map((record) => record.file) };
}

/** Creates one Goal through the shared Goal-and-Subgoals path. */
async function createGoalFile(area, { title, doneWhen, state }) {
  const created = await createGoalSet(area, { goal: { title, doneWhen, state } });
  return created.file;
}

/** Saves a natural work description as an idea without creating goals. */
async function saveWorkIdea(area, description) {
  const file = areaNoteFile(area);
  const absolute = path.join(TREES_ROOT, file);
  let text = await readFile(absolute, "utf8").catch(() => emptyAreaNote(area));
  const current = noteSection(text, "Ideas and open questions");
  const next = [current, `- Idea: ${oneLine(description)}`].filter(Boolean).join("\n");
  text = replaceNoteSection(text, "Ideas and open questions", next);
  await writeFile(absolute, text);
  await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", file]).catch(() => {});
  await vaultCommit([file], `note: ${area} captures an idea from Agent Shell`, area, null);
  return file;
}

/**
 * Commits exactly the given vault paths with the provenance trailers the
 * vault rules require. Pathspec commit, no staging: another agent's staged
 * edits can never ride along. Best effort — a failed commit logs and moves
 * on, the file edit itself already happened.
 */
async function vaultCommit(relPaths, message, area, tmuxSession) {
  const trailers = [`Tangent-Area: ${area}`, tmuxSession ? `Tangent-Tmux: ${tmuxSession}` : null].filter(Boolean);
  try {
    await execFileAsync("git", ["-C", TREES_ROOT, "commit", "-m", message, "-m", trailers.join("\n"), "--", ...relPaths]);
  } catch (err) {
    console.error("vault commit:", String(err.stderr ?? err.message ?? err).slice(0, 200));
  }
}

/**
 * Marks one Goal and every Subgoal done, clearing bindings
 * and stopping their sessions. This is the shared mutation for both direct
 * tree-card flips and agent-authored done states found by reconciliation.
 * Returns only files changed by this pass, suitable for one atomic commit.
 */
async function cascadeGoalDone(rootFile, byFile) {
  const changed = [];
  for (const goal of doneCascade(rootFile, byFile)) {
    if (goal.status !== "done" || goal.session || goal.waitingOn) {
      await writeGoalBinding(goal.file, { status: "done", session: null, waitingOn: null });
      changed.push(goal.file);
    }
    if (goal.session) {
      await execFileAsync("tmux", ["kill-session", "-t", "=" + goal.session]).catch(() => {});
    }
    goal.status = "done";
    goal.session = null;
    goal.waitingOn = null;
  }
  return changed;
}

/** Returns Area notes from the nearest Area to the root. */
function areaNoteFiles(area) {
  const parts = area.split("/");
  const notes = [];
  for (let i = parts.length; i >= 1; i--) {
    const p = parts.slice(0, i).join("/");
    const abs = path.join(TREES_ROOT, p, parts[i - 1] + ".md");
    if (existsSync(abs)) notes.push(abs);
  }
  return notes;
}

/** The deterministic source set that one goal supplies to an agent. */
async function goalContext(area, o) {
  const notes = areaNoteFiles(area);
  const index = await vaultIndex();
  const goalRecord = index.documents.find((record) => record.file === o.file);
  const linked = index.documents.filter((d) => d.kind === "document" && (
    d.backlinks.includes(o.file) || goalRecord?.links.some((target) => linkTargetsRecord(target, d))
  ));
  return {
    goalFile: path.join(TREES_ROOT, o.file),
    notes,
    documents: linked.map((d) => path.join(TREES_ROOT, d.file)),
  };
}

/** Builds the first message for a conversation that defines new work. */
function describeWorkPrompt(area, description, sources = []) {
  const notes = areaNoteFiles(area);
  const sourceLines = [
    `- Area folder: ${path.join(TREES_ROOT, area)}`,
    ...notes.map((note, index) => `- Area note ${index + 1}: ${note}`),
    ...sources.map((source) => `- Document: ${path.join(TREES_ROOT, source.file)}`),
  ];
  return (
    `# Describe work with Julian\n\n` +
    `Help Julian turn the following description into durable work. This is a conversation, not a one-shot form.\n\n` +
    `## Area\n\n${area}\n\n` +
    `## Julian's description\n\n${description}\n\n` +
    `## Sources\n\n${sourceLines.join("\n") || "- No source notes or Documents were found."}\n\n` +
    `## Working contract\n\n` +
    `- Read the Area notes from nearest to farthest. Read each listed Document.\n` +
    `- When code or existing work can resolve an important question, inspect the Area's repository.\n` +
    `- Discuss the work with Julian in this native agent conversation. Do not reduce his description to a generated form.\n` +
    `- Preserve the complete intent. Ask about choices that would change meaning, scope, trade-offs, or proof.\n` +
    `- Use an Area for a durable subject. Use a Goal for a desired change with a clear finish.\n` +
    `- Use a Subgoal only for a separately focusable result that answers “To do that” for its parent Goal.\n` +
    `- Use separate top-level Goals for results that Julian can start, pause, or finish independently.\n` +
    `- Unless an action produces a separately useful result, keep it in the agent plan.\n` +
    `- Inspect related Goals and Documents in the Area folder before you propose new work.\n` +
    `- When the requested work already exists, prefer an update.\n` +
    `- Show the exact Goal names, done conditions, and Subgoal links before you write them. Wait for Julian to confirm them.\n` +
    `- Create confirmed Goals only through the deterministic command below. Never hand-write Goal frontmatter or Area links. Repeat the Subgoal option pair for each confirmed Subgoal.\n` +
    `  node ${JSON.stringify(GOAL_COMMAND)} create --server ${JSON.stringify(`http://127.0.0.1:${PORT}`)} --area ${JSON.stringify(area)} --title "<Goal name>" --done-when "<done condition>" [--description "<shared context>"] [--source "<vault-relative Document>"] [--subgoal-title "<Subgoal name>" --subgoal-done-when "<done condition>"]\n` +
    `- Before you create Goals, read ${path.join(TREES_ROOT, "README.md")} for its commit and provenance rules. Its older Outcome storage examples do not override the command's current Goal schema.\n` +
    `- Link each source Document to the Goal that it informs.\n` +
    `- Do not implement product code in this conversation. The result is well-defined work in Tangent.`
  );
}

/**
 * The exact assignment shown before execution and typed into the selected
 * harness. Markdown keeps the contract readable in both the shell and the
 * agent composer.
 */
async function goalPrompt(area, o) {
  const context = await goalContext(area, o);
  const sources = [
    `- Goal: ${context.goalFile}`,
    ...context.notes.map((note, index) => `- Area note ${index + 1}: ${note}`),
    ...context.documents.map((document) => `- Document: ${document}`),
  ];
  return (
    `# Assignment: ${o.title}\n\n` +
    `## Done when\n\n${o.doneWhen || "Read the Goal file for the done condition."}\n\n` +
    (o.myUnderstanding ? `## Julian's understanding\n\n${o.myUnderstanding}\n\n` : "") +
    `## Sources\n\n${sources.join("\n")}\n\n` +
    `## Working contract\n\n` +
    `- Read the goal first. Then read the area notes from nearest to farthest.\n` +
    (context.documents.length
      ? `- Read each linked Document. Before you write design prose, read ${path.join(os.homedir(), ".agents", "skills", "simple-english", "SKILL.md")}. Use pragmatic mode and do its mandatory self-check.\n`
      : "") +
    (o.subgoals.length ? `- Work through the Subgoals in order.\n` : "") +
    `- Before you start a long-running server or watcher, run \`tangent process list\`. Use \`tangent process start\` for a matching managed process.\n` +
    `- Keep the goal State section current.\n` +
    `- When the Goal changes, update the one You wanted bullet in Current brief.\n` +
    `- Add to Story so far only after meaningful feedback, an accepted or rejected direction, or a result that changes the plan. Use one short heading and no more than two sentences. Keep at most five moments. Do not copy the chat.\n` +
    `- When the result is met, propose marking it done. Never mark it done without confirmation.`
  );
}

/** The contract for one native-agent collaboration around a complete Goal. */
async function collaborationPrompt(area, o, documentFile = "") {
  const assignment = await goalPrompt(area, o);
  const focus = documentFile ? await readVaultDocument(documentFile) : null;
  const documentFocus = focus
    ? `## Current reading location\n\nJulian is reading ${focus.file}. Use this location to interpret references such as “this section.” It does not limit the feedback to one Document.\n\n`
    : "";
  return (
    `# Work with Julian\n\n` +
    `This session covers the complete Goal and all linked Documents. Julian can ask questions, give feedback, request Document edits, or describe new work.\n\n` +
    `Do not ask Julian to classify a message as discussion, feedback, or related work. Infer the useful response from his words.\n\n` +
    `Read all source context before you respond. You can edit linked Documents when Julian requests or accepts a change.\n\n` +
    `Do not implement product code until Julian explicitly requests implementation.\n\n` +
    `If the feedback defines a separate Goal, propose its exact name and done condition. Wait for confirmation before you create it.\n\n` +
    `Research facts yourself. Present one product decision at a time. Julian owns decisions that change meaning, scope, trade-offs, or proof.\n\n` +
    `Keep the goal State section current with these headings when they are useful: Goal, Settled decisions, Deferred, Proof, and Unresolved decisions.\n\n` +
    `When no important decision remains, show the complete shared understanding. Then propose one exact next action.\n\n` +
    documentFocus +
    `## Source context\n\n${assignment}`
  );
}

// ---- goal prompt arming ----
// A collaboration call primes a plain shell and leaves both the harness command
// and the opening prompt for the user to submit. The execution path can request
// direct launch after it has shown the human-readable plan. In that path, the
// harness command and the verified opening prompt are both submitted.
//
// Arming is only ever set by the start-agent action, never inferred from what
// the user runs. A session that has been used for a while sits unarmed, so
// ordinary work in the pane (an editor, a test run, a pager) is never typed
// into; starting the goal again re-primes it, which is how a second harness
// on the same goal gets the same context.

const ARM_POLL_MS = 1000;
const SETTLE_MS = 500; // repaint window between readiness samples
const STILL_SAMPLES = 3; // consecutive identical samples that count as booted
const READY_MAX_MS = 30_000; // stop waiting for a quiet screen and type anyway
const ECHO_MS = 1200; // time for a TUI to draw what was typed into it
const RETRY_MS = 2500; // extra boot time before typing the prompt again
const TYPE_ATTEMPTS = 3;
const PROBE_CHARS = 24; // opening words, short enough to stay visible in a composer
const armedSessions = new Map(); // session -> { phase, submit, document, prompt }
let armTimer = null;

/** The pane's foreground command, "" when the session is gone. */
async function paneCommand(session) {
  try {
    const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", "=" + session + ":", "#{pane_current_command}"]);
    return stdout.trim();
  } catch {
    return "";
  }
}

/** The visible pane with all whitespace removed, so line wrapping cannot hide a match. */
async function paneText(session) {
  const { stdout } = await execFileAsync("tmux", ["capture-pane", "-p", "-t", "=" + session + ":"]);
  return stdout.replace(/\s+/g, "");
}

/**
 * Waits for a just-started harness to finish booting. How long a TUI takes to
 * come up is not knowable — codex is slower than claude, and one that clears
 * the screen on start swallows anything typed before it does — so readiness is
 * observed rather than timed: the pane is sampled until it stops repainting,
 * which is the same signal the sidebar uses to tell working from waiting.
 * False means the harness is already gone (a typo, a quick quit); the next
 * priming covers whatever starts after it.
 */
async function waitForHarnessReady(session) {
  const deadline = Date.now() + READY_MAX_MS;
  let previous = null;
  let still = 1;
  while (Date.now() < deadline) {
    await sleep(SETTLE_MS);
    if (SHELL_CMDS.has(await paneCommand(session))) return false;
    let hash;
    try {
      hash = await screenHash(session);
    } catch {
      return false; // session gone
    }
    still = hash === previous ? still + 1 : 1;
    previous = hash;
    if (still >= STILL_SAMPLES) return true;
  }
  return true; // never settles (an animated TUI): type anyway
}

/**
 * Types a Goal's opening prompt into the harness the user just started,
 * once that harness is up, and checks that it arrived whole.
 *
 * A still screen is not proof a TUI is listening: codex goes quiet while its
 * MCP servers start, then redraws and eats whatever was typed into the gap,
 * which cost the prompt its first line and left the agent a path it could not
 * read. So the opening words go in alone as a probe and have to appear on
 * screen before the rest follows. Only the probe can be checked that way — a
 * composer holding the whole prompt has scrolled its first line out of sight,
 * so the far end is what proves the remainder arrived.
 */
async function typePromptWhenReady(session, prompt, submit = false, label = "agent prompt") {
  try {
    /** Whitespace-free comparison form, so wrapping cannot hide a match. */
    const squash = (s) => s.replace(/\s+/g, "");
    const probe = prompt.slice(0, PROBE_CHARS);
    const tail = squash(prompt.slice(-40));
    for (let attempt = 1; attempt <= TYPE_ATTEMPTS; attempt++) {
      if (!(await waitForHarnessReady(session))) return;
      await typeInto(session, probe, false);
      await sleep(ECHO_MS);
      if ((await paneText(session)).includes(squash(probe))) {
        await typeInto(session, prompt.slice(PROBE_CHARS), false);
        await sleep(ECHO_MS);
        if ((await paneText(session)).includes(tail)) {
          if (submit) await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "Enter"]);
          return;
        }
      }
      console.error(`${label}: ${session} took it partially (attempt ${attempt}), clearing and retyping`);
      // C-u is "clear the input line" in every composer the shell meets, and
      // an unrecognised C-u costs a stray keystroke, not the prompt.
      await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "C-u"]).catch(() => {});
      await sleep(RETRY_MS);
    }
    console.error(`${label}: ${session} never showed the whole prompt`);
  } catch (err) {
    console.error(`${label}:`, err.message ?? err);
  }
}

/** Types a Goal assignment after its native harness is ready. */
async function typeGoalPromptWhenReady(session, area, file, phase = "execute", submit = false, documentFile = "") {
  const o = (await readAreaGoals(area)).find((t) => t.file === file);
  if (!o) return;
  const prompt = phase === "collaborate" ? await collaborationPrompt(area, o, documentFile) : await goalPrompt(area, o);
  await typePromptWhenReady(session, prompt, submit, "goal prompt");
}

/**
 * One arming pass: fires the prompt for every armed session whose pane has
 * left the shell, and forgets sessions that died. Armed sessions are the only
 * ones looked at, so a Goal session in ordinary use costs nothing.
 */
async function tickArmedSessions() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}\t#{@tangent_area}\t#{@tangent_goal}\t#{pane_current_command}",
    ]));
  } catch {
    armedSessions.clear(); // no tmux server: nothing to watch
    return;
  }
  const live = new Set();
  for (const line of stdout.trim().split("\n").filter(Boolean)) {
    const [name, area, file, command] = line.split("\t");
    live.add(name);
    if (!armedSessions.has(name) || SHELL_CMDS.has(command)) continue;
    const armed = armedSessions.get(name);
    armedSessions.delete(name);
    if (armed.prompt) typePromptWhenReady(name, armed.prompt, armed.submit, "describe-work prompt");
    else if (area && file) typeGoalPromptWhenReady(name, area, file, armed.phase, armed.submit, armed.document);
  }
  for (const name of armedSessions.keys()) if (!live.has(name)) armedSessions.delete(name);
}

/**
 * Arms one primed session and keeps the watch timer running while anything is
 * armed: one tmux query a second, never overlapping, stopped once every primed
 * session has its harness.
 */
function armSession(name, phase = "execute", submit = false, document = "", prompt = "") {
  armedSessions.set(name, { phase, submit, document, prompt });
  if (armTimer) return;
  let running = false;
  armTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tickArmedSessions();
    } catch (err) {
      console.error("arm watch:", err.message ?? err);
    } finally {
      running = false;
      if (!armedSessions.size) {
        clearInterval(armTimer);
        armTimer = null;
      }
    }
  }, ARM_POLL_MS);
  armTimer.unref();
}

/**
 * Primes a session sitting at its shell: the area's suggested launch command
 * typed but not submitted, and the goal prompt armed to follow whatever
 * harness the user starts. A pane that is already running something is left
 * alone — priming must never type over an agent mid-conversation.
 */
async function primeGoalSession(session, area, phase = "execute", { launch = false, document = "", command = "" } = {}) {
  const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", "=" + session + ":", "#{pane_current_command}"]);
  if (!SHELL_CMDS.has(stdout.trim())) return false;
  armSession(session, phase, launch, document);
  await typeInto(session, withDefaultModel(command || (await agentCmdForArea(area))), false);
  if (launch) {
    await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "Enter"]);
    await sleep(250);
  }
  return true;
}

/** Primes one native agent with a conversation about new work. */
async function primeDescribeWorkSession(session, area, prompt, { launch = true } = {}) {
  const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", "=" + session + ":", "#{pane_current_command}"]);
  if (!SHELL_CMDS.has(stdout.trim())) return false;
  armSession(session, "define", launch, "", prompt);
  await typeInto(session, withDefaultModel(await agentCmdForArea(area)), false);
  if (launch) {
    await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "Enter"]);
    await sleep(250);
  }
  return true;
}

/** Returns a short readable label for one work-definition conversation. */
function describeWorkTitle(description) {
  const first = oneLine(String(description).split(/(?<=[.!?])\s+|\n+/)[0] || description);
  return first.length > 88 ? `${first.slice(0, 85).replace(/\s+\S*$/, "")}…` : first;
}

/** Opens a native agent in the selected Area to define durable work. */
async function spawnDescribeWorkSession(area, description, sources, { session: requested = "", launch = true } = {}) {
  const sessions = await listSessions();
  const existing = requested
    ? sessions.find((item) => item.name === requested && item.kind === "work-definition" && item.area === area)
    : null;
  if (existing) {
    const prompt = describeWorkPrompt(area, description, sources);
    const primed = existing.state === "shell"
      ? await primeDescribeWorkSession(existing.name, area, prompt, { launch }).catch(() => false)
      : false;
    return { status: 200, session: existing.name, reattached: true, primed };
  }

  const title = describeWorkTitle(description) || "Describe work";
  const base = normName(`${area.split("/").pop()}--describe-${title}`).slice(0, 55) || "describe-work";
  const names = new Set(sessions.map((item) => item.name));
  let name = base;
  for (let index = 2; names.has(name); index += 1) name = `${base.slice(0, 55 - String(index).length)}-${index}`;
  const directory = (await areaDirectory(area)) ?? path.join(TREES_ROOT, area);
  await execFileAsync("tmux", ["new-session", "-d", "-s", name, "-c", directory]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_area", area]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_kind", "work-definition"]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_phase", "define"]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_work_title", title]);

  /** Sends the captured description after the native agent is ready. */
  const prime = async () => {
    await sleep(700);
    try {
      await primeDescribeWorkSession(name, area, describeWorkPrompt(area, description, sources), { launch });
    } catch (error) {
      console.error("describe work session:", error.message ?? error);
    }
  };
  if (launch) await prime();
  else prime();
  return { status: 200, session: name, title };
}

/**
 * Spawns (or reattaches) the work session for one goal: a plain shell in
 * the area's repo with the suggested agent command pre-typed, bound via
 * @tangent_area + @tangent_goal, goal mechanically flipped to active.
 * Both the launch line and the opening prompt follow the type-but-never-submit
 * rule, so the harness, the model, and the words all stay the user's call.
 */
async function spawnGoalSession(area, slug, { phase = "execute", approved = false, launch = false, document = "", command = "", label = "" } = {}) {
  const o = (await readAreaGoals(area)).find((t) => t.slug === slug);
  if (!o) return { status: 404, error: `no goal "${slug}" on ${area}` };
  if (["done", "dropped"].includes(o.status)) return { status: 409, error: `goal is ${o.status}` };
  // Resolve the launch before any tmux action: a declaration that does not
  // resolve blocks the start and names itself, it never gets substituted.
  if (!command) {
    const inherited = await launchForArea(area);
    if (inherited.error) return { status: 409, error: inherited.error };
    command = inherited.command;
    if (!label && inherited.label) label = inherited.label;
  }
  const sessions = await listSessions();
  const baseName = normName(`${area.split("/").pop()}--${slug}`).slice(0, 60);
  const phaseName = phase === "collaborate" ? normName(`${baseName}--collaborate`).slice(0, 60) : baseName;
  // Starting a Goal that already has a session re-primes it: a pane left
  // at a shell (the agent was stopped to do ordinary work) gets the launch
  // line and the prompt again, a pane still running one is only reattached.
  const existing = [o.session, phaseName, baseName].find((n) => n && sessions.some((s) => s.name === n));
  if (existing) {
    await execFileAsync("tmux", ["set-option", "-t", existing, "@tangent_phase", phase]);
    if (document) await execFileAsync("tmux", ["set-option", "-t", existing, "@tangent_document", document]);
    if (label) await execFileAsync("tmux", ["set-option", "-t", existing, "@tangent_launch", label]);
    const live = sessions.find((s) => s.name === existing);
    let primed = false;
    if (approved && phase === "execute" && live && !SHELL_CMDS.has(live.command)) {
      if (live.state === "working") return { status: 409, error: "the agent is still working; wait before you approve another assignment" };
      await typeInto(existing, await goalPrompt(area, o), true);
    } else {
      primed = await primeGoalSession(existing, area, phase, { launch, document, command }).catch(() => false);
    }
    if (o.status !== "active" || o.session !== existing) {
      await writeGoalBinding(o.file, { status: "active", session: existing });
      await vaultCommit([o.file], `update: ${area} goal ${slug} active`, area, existing);
    }
    return { status: 200, session: existing, reattached: true, primed };
  }
  const dir = (await areaDirectory(area)) ?? path.join(TREES_ROOT, area);
  // No command: tmux runs the login shell, so aliases (claude-otto) resolve
  // and the session outlives whatever agent is started in it.
  await execFileAsync("tmux", ["new-session", "-d", "-s", phaseName, "-c", dir]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_area", area]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_goal", o.file]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_kind", "goal"]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_phase", phase]);
  if (document) await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_document", document]);
  if (label) await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_launch", label]);
  try {
    await writeGoalBinding(o.file, { status: "active", session: phaseName });
    await vaultCommit([o.file], `update: ${area} goal ${slug} active`, area, phaseName);
  } catch (err) {
    console.error("goal binding:", err.message ?? err);
  }
  /** Primes the new pane after its login shell finishes drawing. */
  const primeNewSession = async () => {
    // Let the login shell finish drawing its prompt: a line typed earlier can
    // be wiped by the redraw.
    await sleep(700);
    try {
      await primeGoalSession(phaseName, area, phase, { launch, document, command });
    } catch (err) {
      console.error("prime session:", err.message ?? err);
    }
  };
  if (launch) await primeNewSession();
  else primeNewSession();
  return { status: 200, session: phaseName };
}

let lastReconcile = 0;
let reconciling = false;
const warnedUnlinkedSessions = new Set();
/**
 * Repairs Goal bindings after a session ends. This background pass never
 * stops a tmux session. Goal files can move or change while another agent
 * works, so only an explicit user action has authority to end a Run.
 */
async function reconcileGoals(sessions) {
  if (reconciling || Date.now() - lastReconcile < 10_000) return;
  reconciling = true;
  lastReconcile = Date.now();
  try {
    const live = new Set(sessions.map((s) => s.name));
    const byFile = new Map();
    for (const area of flattenAreaPaths(await readTree(TREES_ROOT))) {
      for (const t of await readAreaGoals(area)) byFile.set(t.file, t);
    }
    for (const t of byFile.values()) {
      if (t.status !== "active" || !t.session || live.has(t.session)) continue;
      await writeGoalBinding(t.file, { status: "open", session: null });
      await vaultCommit([t.file], `update: ${t.area} goal ${t.slug} back to open, session ended`, t.area, null);
    }
    for (const s of sessions) {
      if (!s.goal) continue;
      const t = byFile.get(s.goal);
      if (t && !["done", "dropped"].includes(t.status)) {
        warnedUnlinkedSessions.delete(s.name);
        continue;
      }
      if (warnedUnlinkedSessions.has(s.name)) continue;
      warnedUnlinkedSessions.add(s.name);
      console.warn(`preserved session ${s.name}: goal ${s.goal} is ${t ? t.status : "not indexed"}; only the user can stop it`);
    }
  } catch (err) {
    console.error("goal reconcile:", err.message ?? err);
  } finally {
    reconciling = false;
  }
}

const goalInfoCache = new Map(); // file -> { at, info }
/**
 * Attaches goal title/statement/status to each session that carries
 * @tangent_goal, for the frontend strip and sidebar labels. Tiny TTL
 * cache: the sessions poll runs every 2s and goal files rarely change.
 */
async function withGoalInfo(sessions) {
  return Promise.all(
    sessions.map(async (s) => {
      if (!s.goal) return s;
      let hit = goalInfoCache.get(s.goal);
      if (!hit || Date.now() - hit.at > 3000) {
        try {
          const text = await readFile(path.join(TREES_ROOT, s.goal), "utf8");
          const fm = parseFrontmatter(text);
          hit = {
            at: Date.now(),
            info: {
              goalTitle: text.match(/^# (.+)$/m)?.[1]?.trim() ?? null,
              goalText: fm.done_when || fm.outcome || null,
              goalStatus: fm.status || null,
            },
          };
        } catch {
          hit = { at: Date.now(), info: {} };
        }
        goalInfoCache.set(s.goal, hit);
      }
      return { ...s, ...hit.info };
    })
  );
}

// ---- goal lookup + start ----
// There is no focus concept: the tree (scoped client-side) is the only lens,
// and the user starts goals going themselves. The one spawn path in the
// shell is the explicit /api/goals/start; everything else — clicking,
// scoping, selecting — is side-effect free.

const CLOSED_GOAL = new Set(["done", "dropped", "deferred"]);

/** Every goal in the vault keyed by its vault-relative file path. */
async function goalsByFile() {
  const map = new Map();
  for (const area of flattenAreaPaths(await readTree(TREES_ROOT))) {
    for (const o of await readAreaGoals(area)) map.set(o.file, o);
  }
  return map;
}

/**
 * The one spawn path in the shell: opens (or re-primes) the session for an
 * goal, by file. A session is only ever primed when this is explicitly
 * asked, and the harness itself is always started by the user.
 */
async function startGoal(file, options = {}) {
  const o = (await goalsByFile()).get(file);
  if (!o) return { status: 404, error: `no goal file ${file}` };
  return spawnGoalSession(o.area, o.slug, options);
}

/** Stops one accepted assignment without claiming that its goal is done. */
async function acceptGoalAssignment(file) {
  const o = (await goalsByFile()).get(file);
  if (!o) return { status: 404, error: `no goal file ${file}` };
  if (o.session) await execFileAsync("tmux", ["kill-session", "-t", "=" + o.session]).catch(() => {});
  await writeGoalBinding(o.file, { status: "open", session: null });
  await vaultCommit([o.file], `update: ${o.area} goal ${o.slug} assignment accepted`, o.area, null);
  return { status: 200 };
}

// ---- voice + typed command control ----
// POST /api/voice: an utterance in, actions out. The browser records push-to-
// talk audio; this server transcribes it (Groq whisper) and hands the
// transcript plus live shell state (sessions, states, pane tails, tree areas,
// the areas visible in the user's sidebar) to a fast LLM router.
// POST /api/command is the same lane for typed text: identical grammar,
// identical routing, no transcription.
//
// The router's contract: the user's words are never rewritten. Speech or text
// meant for an agent travels verbatim via the "say" action — the router only
// picks the destination and names the leading address words, which the server
// strips itself. Shell verbs (view, spawn, kill, sidebar, caffeinate, agent
// switch, spoken answers) are a small closed set and fire only on clear
// matches. Areas have no agents of their own: addressing a tree area
// delivers the utterance to the orchestrator (the chat session) with the
// area name kept in the words, so the orchestrator knows which area is
// meant. On any router failure the fallback is inert: the utterance is
// typed into the focused session, unsubmitted — a misheard or misrouted
// utterance can never fire an action on its own.

const GROQ_KEY =
  process.env.GROQ_API_KEY ??
  (() => {
    // The otto-launcher area keeps a Groq key in its .env; reuse it so the
    // shell needs no separate setup on this machine.
    try {
      const env = readFileSync(path.join(os.homedir(), "Areas", "otto-launcher", ".env"), "utf8");
      return env.match(/^GROQ_API_KEY=(.+)$/m)?.[1]?.trim() ?? null;
    } catch {
      return null;
    }
  })();
const ROUTER_MODEL = process.env.VOICE_ROUTER_MODEL ?? "llama-3.3-70b-versatile";

const ROUTER_SYSTEM = `You route commands for Agent Shell, a terminal app whose tabs are tmux sessions running coding agents. The session named in chatSession is the orchestrator. It organizes Areas, captures Goals, and opens sessions. The user addresses agents by session name or Area name. Areas have no agents of their own, so an Area name means the orchestrator acting on that Area.

You get a JSON payload: the utterance (speech-to-text or typed), the focused session, all sessions (state: working = agent busy, waiting = agent finished or needs input, shell = plain shell, service/stopped = background command), the visible pane tail of relevant sessions, visibleAreas (the tree areas the user can currently see in the sidebar — their mental model; prefer them when resolving names), and allAreas.

THE RULE ABOVE ALL OTHERS: you never write, rewrite, trim, or fix the user's words. Words meant for an agent travel verbatim through "say"; you only pick the destination and identify which leading words were the address. The server strips the address itself.

Reply with JSON only: {"actions":[...]}, at most 5 actions, executed in order. Action types:
- {"type":"say","target":"<the payload's exact session name or Area path, or \\"\\" for the focused session>","address":"<the exact leading words that name the target, or \\"\\" if none>"} — deliver the utterance without its address. This is the default action. An utterance that opens with a session or Area name is addressed. Everything else has target "". A Goal or Subgoal request addressed to an Area stays in one complete utterance. The orchestrator receives an Area target with the Area name intact. Never infer a target from topic or content. A non-empty target must include the address words that named it.
- {"type":"keys","session":"<name>","keys":["Enter"]} — press special keys. Allowed: Enter, Escape, Tab, Up, Down, Left, Right, BSpace, Space, C-c, and single letters or digits like "y" or "2". Use for answering menus and permission prompts visible in the pane tail (send the matching option key) and for "stop" or "interrupt" (Escape, or C-c in a shell).
- {"type":"view","target":"<session or Area name>"} — show that session or Area. Use this for "show me X", "open X", "go to X", or "switch to X".
- {"type":"close_view"} — leave the current session view, back to the orchestrator.
- {"type":"sidebar"} — toggle the area tree sidebar.
- {"type":"spawn","area":"<Area path>","name":"<lowercase-hyphen-name>"} — create a plain work session in an Area. Only for a bare "new/open a session on X (called Y)" with nothing else attached. If the user states a Goal or context in the same utterance, do NOT spawn. Send the complete request to the Area instead.
- {"type":"kill","session":"<name>"} — destroy a session and everything in it. Only on an explicit kill or destroy request.
- {"type":"caffeinate","on":true} — keep the mac awake (or release it).
- {"type":"agent","cmd":"<command>"} — switch the orchestrator's agent command (for example "claude-otto" or "pi"). Only on an explicit request; it restarts the orchestrator. Goal sessions are unaffected: they always run their area's own agent.
- {"type":"speak","text":"one short sentence"} — answer out loud. Use for status questions ("who's waiting on me?" — summarize the waiting and working sessions from the payload) and to say why you did nothing.

Rules:
- Shell verbs fire only on a clear match. When torn between say and any non-destructive action, say. Never guess kill, agent, or spawn.
- Spoken names are fuzzy, but targets are literal. Copy the matched session name or complete Area path from the payload. A complete session-name match wins. Otherwise, a name that matches an Area's base name selects that Area. Resolve sessions first, then visibleAreas, then allAreas. Reference only payload entries.
- A bare confirmation ("yes", "go ahead", "option two") while the focused pane shows a question or menu: answer with keys matching the visible choices; otherwise say it.
- To act on a prompt in a session that is not focused, put a view action first so the user sees what happens.
- Unclear or nothing matches: return one speak action asking a single short question.`;

/** Collects a request body as a Buffer (readBody would corrupt audio bytes). */
function readBinaryBody(req) {
  return new Promise((resolve, reject) => {
    const bufs = [];
    req.on("data", (c) => bufs.push(c));
    req.on("end", () => resolve(Buffer.concat(bufs)));
    req.on("error", reject);
  });
}

/**
 * Transcribes one recorded utterance via Groq whisper-large-v3-turbo. Session
 * names ride along as the whisper prompt so spoken hyphen-names ("retry loop")
 * come back recognizable. An empty transcript is an error, not a result.
 */
async function transcribe(audio, contentType, nameHints) {
  const type = contentType?.split(";")[0] || "audio/mp4";
  const ext = type.includes("webm") ? "webm" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "m4a";
  const fd = new FormData();
  fd.append("file", new Blob([audio], { type }), "utterance." + ext);
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("prompt", `Voice commands for a terminal app. Names: ${nameHints.join(", ")}.`.slice(0, 500));
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${GROQ_KEY}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`transcription ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = ((await res.json()).text ?? "").trim();
  if (text.length < 2) throw new Error("heard nothing");
  return text;
}

/** One JSON-mode chat call to the router model, parsed leniently ({ to }). */
async function routerCall(userPayload) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${GROQ_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: ROUTER_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ROUTER_SYSTEM },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const content = (await res.json()).choices?.[0]?.message?.content ?? "";
  const m = content.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : content);
}

/**
 * Live state the router decides against: every session with its agent state,
 * pane tails for the focused, chat, and waiting sessions (what a "yes" or an
 * option number would answer), the vault area paths, and the subset of areas
 * the user's sidebar currently shows (their mental model, so spoken names
 * resolve the way the tree spells them).
 */
async function voiceContext(focused, visibleAreas = []) {
  const sessions = await listSessions();
  const paneTails = {};
  for (const s of sessions) {
    if (s.name !== focused && s.state !== "waiting" && !s.isChat) continue;
    try {
      const { stdout } = await execFileAsync("tmux", ["capture-pane", "-p", "-t", "=" + s.name + ":"]);
      paneTails[s.name] = stdout.replace(/\s+$/, "").split("\n").slice(-14).join("\n");
    } catch {}
  }
  const areas = flattenAreaPaths(await readTree(TREES_ROOT));
  // Workable goals ride along so spoken references to work ("who's on X?")
  // can resolve against real goal titles.
  const goals = [...(await goalsByFile()).values()]
    .filter((goal) => !CLOSED_GOAL.has(goal.status))
    .map((o) => ({ title: o.title, area: o.area }));
  return { sessions, paneTails, areas, visibleAreas: visibleAreas.filter((p) => areas.includes(p)), goals };
}

/** Flattens the nested tree into the plain area-path list the router reads. */
function flattenAreaPaths(areas, out = []) {
  for (const n of areas) {
    out.push(n.path);
    flattenAreaPaths(n.children, out);
  }
  return out;
}

const NAMED_KEYS = new Set(["Enter", "Escape", "Tab", "Up", "Down", "Left", "Right", "BSpace", "Space", "C-c", "C-d", "C-u", "Home", "End", "PPage", "NPage"]);
/** Awaitable pause, used to let a TUI ingest typed text before Enter. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Session-name slug of any spoken phrase: "Voice Smoke" -> "voice-smoke". */
const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Maps a spoken (fuzzy) session name onto a real one, or null. */
function resolveSession(name, sessions) {
  if (!name) return null;
  const hit = sessions.find((s) => s.name === name) ?? sessions.find((s) => normName(s.name) === normName(name));
  return hit?.name ?? null;
}

/**
 * Resolves a spoken target onto a session or a tree area: sessions first,
 * then area base names (visible areas before the whole vault), then full
 * area paths. "root", "orchestrator", and "chat" all mean the orchestrator
 * session. Returns {session} or {area} or null.
 */
function resolveTarget(spoken, ctx) {
  const n = normName(spoken ?? "");
  if (!n) return null;
  if (n === "root" || n === "orchestrator" || n === "chat") return { session: CHAT_SESSION };
  const sess = resolveSession(spoken, ctx.sessions);
  if (sess) return { session: sess };
  /** First path whose base name (else full path) matches the spoken name. */
  const byName = (paths) =>
    paths.find((p) => normName(p.split("/").pop()) === n) ?? paths.find((p) => normName(p) === n);
  const area = byName(ctx.visibleAreas) ?? byName(ctx.areas);
  return area ? { area } : null;
}

/**
 * The utterance's own leading words when they name the resolved target, null
 * otherwise. The router is supposed to report which spoken words addressed
 * its target; when it forgets, this recovers the obvious cases ("Tangent,
 * here's a big one...") so the no-address invariant judges the utterance,
 * not the router's bookkeeping. Matching is deliberately exact: a fuzzy
 * spoken form the server cannot verify stays unaddressed.
 */
function leadingAddress(utterance, resolved) {
  const names = resolved.area ? [resolved.area, resolved.area.split("/").pop()] : [resolved.session];
  const norms = new Set(names.map(normName));
  const words = String(utterance).trim().split(/\s+/).slice(0, 4);
  for (let n = words.length; n >= 1; n--) {
    const lead = words.slice(0, n).join(" ");
    if (norms.has(normName(lead))) return lead;
  }
  return null;
}

/**
 * Removes the router-identified address words from the front of the utterance,
 * but only when they really are its first words — the verbatim guarantee is
 * that nothing else ever changes. On any mismatch the full utterance survives.
 */
function stripAddress(utterance, address) {
  const words = String(address ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return utterance;
  const m = utterance.match(new RegExp(`^\\s*(?:\\S+\\s+){${words.length - 1}}\\S+[\\s,.:;!?]*`));
  /** Case-, punctuation-, and whitespace-insensitive comparison form. */
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();
  if (!m || norm(m[0]) !== norm(words.join(" "))) return utterance;
  return utterance.slice(m[0].length).trim() || utterance;
}

/**
 * Types literal text into a session's active pane. The pause before Enter
 * lets an agent TUI finish ingesting the text before the submit arrives.
 */
async function typeInto(session, text, submit) {
  // "=name:" exact session, active pane — send-keys rejects bare "=name".
  await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "-l", "--", text]);
  if (submit) {
    await sleep(150);
    await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "Enter"]);
  }
}

/**
 * Executes the router's plan. Server-owned actions run here in order; actions
 * only the page can perform (view, scope, close_view, sidebar) are returned to it.
 * Every action degrades to a summary line, never an exception: one failed
 * step must not hide what the rest of the plan did.
 */
async function executeVoiceActions(actions, ctx, focused, utterance) {
  const { sessions } = ctx;
  const summary = [];
  const clientActions = [];
  for (const a of (Array.isArray(actions) ? actions : []).slice(0, 5)) {
    try {
      switch (a.type) {
        case "say": {
          // The invariant that stops topic-guessing: the router may redirect
          // only when the user actually spoke address words. No address means
          // the focused session, whatever the router claims the target is. A
          // missing address is first re-derived from the utterance itself, so
          // the invariant judges the user's words, not the router's paperwork.
          let address = String(a.address ?? "").trim();
          const named = a.target ? resolveTarget(a.target, ctx) : null;
          if (!address && named) address = leadingAddress(utterance, named) ?? "";
          const resolved = address && a.target ? named : { session: focused };
          if (!resolved) {
            await typeInto(focused, utterance, false);
            summary.push(`no "${a.target}" — typed here, not sent`);
            break;
          }
          // An Area has no agent of its own: Area-addressed words go to the
          // orchestrator with the address kept, so it knows which area is
          // meant. Session-addressed words are stripped of the address.
          const target = resolved.area ? CHAT_SESSION : resolved.session;
          const text = (resolved.area ? utterance : stripAddress(utterance, address)).slice(0, 4000);
          // Never auto-run prose at a bare shell prompt; agents get Enter.
          const submit = sessions.find((s) => s.name === target)?.state !== "shell";
          await typeInto(target, text, submit);
          // The HUD line says WHY it went there: which spoken words redirected
          // it, or that it followed the viewed session.
          const why = resolved.area ? ` (for ${resolved.area})` : address ? ` (you said “${address}”)` : "";
          summary.push((submit ? `→ ${target}` : `typed into ${target}, not sent`) + why);
          break;
        }
        case "keys": {
          const target = resolveSession(a.session, sessions) ?? focused;
          const keys = (Array.isArray(a.keys) ? a.keys : [])
            .filter((k) => NAMED_KEYS.has(k) || /^[0-9a-zA-Z]$/.test(k))
            .slice(0, 8);
          if (!keys.length) break;
          await execFileAsync("tmux", ["send-keys", "-t", "=" + target + ":", ...keys]);
          summary.push(`pressed ${keys.join(" ")} in ${target}`);
          break;
        }
        case "view": {
          const spoken = a.target ?? a.session;
          const resolved = resolveTarget(spoken, ctx);
          if (!resolved) {
            summary.push(`no session or area "${spoken}"`);
            break;
          }
          if (resolved.area) {
            // An Area is a place in the tree, not a session: viewing it
            // scopes the sidebar to that subtree.
            clientActions.push({ type: "scope", area: resolved.area });
            summary.push(`scoped the tree to ${resolved.area}`);
            break;
          }
          clientActions.push({ type: "view", session: resolved.session });
          summary.push(`viewing ${resolved.session}`);
          break;
        }
        case "close_view":
          clientActions.push({ type: "close_view" });
          summary.push("closed view");
          break;
        case "sidebar":
          clientActions.push({ type: "sidebar" });
          summary.push("toggled sidebar");
          break;
        case "spawn": {
          const name = normName(a.name ?? "");
          const result = await spawnSession(String(a.area ?? ""), name);
          if (result.status !== 200) {
            summary.push(`spawn failed: ${result.error}`);
            break;
          }
          clientActions.push({ type: "view", session: name });
          summary.push(`spawned ${name} on ${a.area}`);
          break;
        }
        case "kill": {
          const target = resolveSession(a.session, sessions);
          if (!target || target === CHAT_SESSION) {
            summary.push("refusing to kill that");
            break;
          }
          await execFileAsync("tmux", ["kill-session", "-t", "=" + target]);
          summary.push(`killed ${target}`);
          break;
        }
        case "caffeinate":
          setCaffeinate(Boolean(a.on));
          summary.push(`caffeinate ${a.on ? "on" : "off"}`);
          break;
        case "agent": {
          const cmd = String(a.cmd ?? "").trim();
          if (!cmd) break;
          agentCmd = cmd;
          try {
            await execFileAsync("tmux", ["kill-session", "-t", "=" + CHAT_SESSION]);
          } catch {} // no chat session running: reconnect spawns it fresh
          summary.push(`chat agent → ${cmd}`);
          break;
        }
        case "speak": {
          const text = String(a.text ?? "").slice(0, 400);
          if (!text) break;
          execFile("say", [text], () => {});
          summary.push(`“${text}”`);
          break;
        }
        default:
          summary.push(`unknown action ${String(a.type).slice(0, 40)}`);
      }
    } catch (err) {
      summary.push(`${a.type} failed: ${String(err.stderr ?? err.message ?? err).slice(0, 120)}`);
    }
  }
  return { summary, clientActions };
}

const VOICE_LOG = path.join(os.homedir(), ".tangent", "agent-shell-voice.jsonl");

/**
 * Appends one routing decision to ~/.tangent/agent-shell-voice.jsonl: the
 * utterance, the router's raw plan, and what actually executed. The audit
 * trail for "why did that go there?" — without it a misroute is unexplainable
 * after the fact. Best effort, never throws.
 */
function logVoice(entry) {
  appendFile(VOICE_LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n").catch(() => {});
}

/**
 * Routes one utterance (spoken or typed, same grammar) and executes the plan.
 * The failure fallback is inert: the utterance is typed into the focused
 * session, unsubmitted, and nothing else happens.
 */
async function routeAndExecute(utterance, focused, ctx) {
  let plan = null;
  try {
    plan = await routerCall({
      utterance,
      chatSession: CHAT_SESSION,
      focusedSession: focused,
      sessions: ctx.sessions.map(({ name, state, area, kind }) => ({ name, state, area, kind })),
      paneTails: ctx.paneTails,
      visibleAreas: ctx.visibleAreas,
      allAreas: ctx.areas,
      goals: ctx.goals,
    });
    const out = await executeVoiceActions(plan.actions, ctx, focused, utterance);
    logVoice({ utterance, focused, plan, summary: out.summary });
    return out;
  } catch (err) {
    console.error("voice router:", err.message ?? err);
    logVoice({ utterance, focused, plan, error: String(err.message ?? err) });
    try {
      await typeInto(focused, utterance, false);
    } catch {}
    return { summary: ["router failed — typed it here, not submitted"], clientActions: [] };
  }
}

/** Name hints for whisper: sessions plus visible area base names. */
function voiceNameHints(ctx) {
  const areaNames = ctx.visibleAreas.map((p) => p.split("/").pop());
  return [...new Set([...ctx.sessions.map((s) => s.name), ...areaNames])];
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (await reviewedBuild.handle(req, res, url)) return;
    if (url.pathname === "/api/sessions") {
      const sessions = await listSessions();
      reconcileGoals(sessions); // throttled fire-and-forget
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ agent: agentCmd, caffeinate: caffeinateProc !== null, voice: Boolean(GROQ_KEY), sessions })
      );
      return;
    }
    // The frontend must target the same orchestrator session the server
    // special-cases, so the name ships as a tiny script instead of being
    // hardcoded twice.
    if (url.pathname === "/config.js") {
      res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-cache" });
      res.end(`window.CHAT_SESSION = ${JSON.stringify(CHAT_SESSION)};\n`);
      return;
    }
    if (url.pathname === "/api/tree") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ root: TREES_ROOT, areas: await readTree(TREES_ROOT) }));
      return;
    }
    if (url.pathname === "/api/areas/new" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      try {
        const created = await createArea({ treesRoot: TREES_ROOT, parent: body.parent, name: body.name });
        await runVaultGit(["add", "--", ...created.changedPaths]);
        await vaultCommit(created.changedPaths, `add: ${created.area} Area`, created.area, null);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(created));
      } catch (error) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error.stderr ?? error.message ?? error) }));
      }
      return;
    }
    if (url.pathname === "/api/areas/preview-move" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      try {
        const preview = await previewAreaMove({ treesRoot: TREES_ROOT, area: body.area, parent: body.parent, name: body.name });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(preview));
      } catch (error) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error.message ?? error) }));
      }
      return;
    }
    if (url.pathname === "/api/areas/move" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      try {
        if (await areaHasGitChanges({ treesRoot: TREES_ROOT, area: body.area, runGitCapture: captureVaultGit })) {
          throw new Error("Save or discard this area's pending vault edits before you move it.");
        }
        const moved = await moveArea({
          treesRoot: TREES_ROOT,
          area: body.area,
          parent: body.parent,
          name: body.name,
          runGit: runVaultGit,
        });
        await moveSessionBindings(moved);
        await vaultCommit([moved.source, moved.destination], `update: ${moved.source} moves to ${moved.destination}`, moved.destination, null);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(moved));
      } catch (error) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error.stderr ?? error.message ?? error) }));
      }
      return;
    }
    if (url.pathname === "/api/programs" && req.method === "GET") {
      const payload = await programsSnapshot({ treesRoot: TREES_ROOT, sessions: await listProgramSessions() });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...payload, scheduler: await recurringSchedulerStatus() }));
      return;
    }
    if (url.pathname === "/api/programs/new" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      try {
        let created;
        if (body.type === "routine") {
          created = await saveRoutine({
            treesRoot: TREES_ROOT,
            area: body.area,
            name: body.name,
            time: body.time,
            cwd: body.cwd,
            model: body.model,
            prompt: body.prompt,
          });
          await runVaultGit(["add", "--", created.file]);
          await vaultCommit([created.file], `add: ${created.area} routine ${created.name}`, created.area, null);
        } else {
          created = await saveLocalProgram({
            treesRoot: TREES_ROOT,
            area: body.area,
            type: body.type,
            name: body.name,
            command: body.command,
            cwd: body.cwd,
          });
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(created));
      } catch (error) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error.message ?? error) }));
      }
      return;
    }
    if (url.pathname === "/api/programs/control" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      try {
        const snapshot = await programsSnapshot({ treesRoot: TREES_ROOT, sessions: await listProgramSessions() });
        const program = snapshot.programs.find((item) => item.id === body.id);
        if (!program) throw new Error("The program no longer exists.");
        const action = String(body.action ?? "");
        if (program.type === "process") {
          if (!["start", "stop", "restart", "close"].includes(action)) throw new Error("Choose Start, Stop, Restart, or Close.");
          await runLocalTangent(["process", action, program.name, "--area", program.area]);
        } else if (program.type === "command") {
          await controlCommand(program, action);
        } else if (["pause", "resume"].includes(action)) {
          const changed = await setRoutinePaused({ treesRoot: TREES_ROOT, source: program.source, paused: action === "pause" });
          await runVaultGit(["add", "--", changed.file]);
          await vaultCommit([changed.file], `update: ${program.area} routine ${program.name} ${action}d`, program.area, null);
        } else if (action === "run") {
          await runLocalTangent(["threads", "recur", "run", program.name]);
        } else if (["stop", "close"].includes(action)) {
          if (program.session) await execFileAsync("tmux", ["kill-session", "-t", `=${program.sessionName}`]);
        } else {
          throw new Error("Choose Run, Pause, Stop, or Close.");
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error.stderr ?? error.message ?? error) }));
      }
      return;
    }
    // The launcher's index: per-area entries for search plus the unified map.
    if (url.pathname === "/api/vault") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(await vaultIndex()));
      return;
    }
    if (url.pathname === "/api/document" && req.method === "GET") {
      const document = await readVaultDocument(url.searchParams.get("file") ?? "");
      res.writeHead(document ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(document ?? { error: "document not found" }));
      return;
    }
    if (url.pathname === "/api/document" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      if (typeof body.text !== "string") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "text is required" }));
        return;
      }
      const result = await saveVaultDocument(String(body.file ?? ""), body.text, String(body.baseHash ?? ""));
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.status === 200 ? result.document : { error: result.error, current: result.current }));
      return;
    }
    if (url.pathname === "/api/goals/brief" && req.method === "GET") {
      const file = url.searchParams.get("file") ?? "";
      const goal = (await goalsByFile()).get(file);
      if (!goal) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no goal file ${file}` }));
        return;
      }
      const context = await goalContext(goal.area, goal);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        goal,
        markdown: await goalPrompt(goal.area, goal),
        agent: await agentCmdForArea(goal.area).then(withDefaultModel).catch(() => ""),
        context,
      }));
      return;
    }
    if (url.pathname === "/api/work/describe" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const area = String(body.area ?? "");
      const description = String(body.description ?? "").trim().slice(0, 12_000);
      if (!area || !flattenAreaPaths(await readTree(TREES_ROOT)).includes(area)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no area "${area}"` }));
        return;
      }
      if (!description) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "describe the work before you open an agent" }));
        return;
      }
      try {
        const sources = await sourceDocuments(body.sources);
        const result = await spawnDescribeWorkSession(area, description, sources, {
          session: String(body.session ?? ""),
          launch: body.launch !== false,
        });
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.status === 200 ? result : { error: result.error }));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error.stderr ?? error.message ?? error) }));
      }
      return;
    }
    // The registry for the harness editor: read the raw structure, and
    // write a validated replacement back into the harnesses Document.
    if (url.pathname === "/api/harnesses" && req.method === "GET") {
      const registry = await harnessRegistry();
      if (registry.error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: registry.error }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ registry }));
      return;
    }
    if (url.pathname === "/api/harnesses" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const registry = { version: 1, modelSets: body.modelSets ?? {}, harnesses: body.harnesses ?? [] };
      const problem = validateHarnessRegistry(registry);
      if (problem) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: problem }));
        return;
      }
      const absolute = path.join(TREES_ROOT, "harnesses.md");
      const text = await readFile(absolute, "utf8").catch(() => "");
      await writeFile(absolute, upsertHarnessRegistry(text, registry));
      await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", "harnesses.md"]).catch(() => {});
      await vaultCommit(["harnesses.md"], "update: harness registry from Agent Shell", "machine", null);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    // Launch choices for the Start work surface: the registry's named
    // harnesses and models, and the Area's resolved default launch.
    if (url.pathname === "/api/launch/options" && req.method === "GET") {
      const area = url.searchParams.get("area") ?? "";
      const registry = await harnessRegistry();
      if (registry.error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: registry.error }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        harnesses: registry.harnesses.map((harness) => ({
          id: harness.id,
          label: harness.label || harness.id,
          command: harness.command,
          models: harnessModels(registry, harness).map((model) => ({ id: model.id, label: model.label || model.id, args: model.args })),
        })),
        default: await launchForArea(area),
      }));
      return;
    }
    // Saves one picker selection as the Area's durable default launch.
    // Only this explicit action writes a declaration; picking never does.
    if (url.pathname === "/api/launch/default" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const area = String(body.area ?? "");
      const registry = await harnessRegistry();
      const resolved = registry.error ? registry : resolveLaunch(registry, body.launch ?? {});
      if (resolved.error || !area) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: resolved.error || "an area is required" }));
        return;
      }
      const file = areaNoteFile(area);
      const absolute = path.join(TREES_ROOT, file);
      const text = await readFile(absolute, "utf8").catch(() => emptyAreaNote(area));
      const ref = { harness: resolved.harness, ...(resolved.model ? { model: resolved.model } : {}) };
      await writeFile(absolute, upsertEnvironmentLaunch(text, ref));
      await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", file]).catch(() => {});
      await vaultCommit([file], `update: ${area} default launch ${resolved.label}`, area, null);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ label: resolved.label, command: resolved.command }));
      return;
    }
    if (url.pathname === "/api/goals/agent" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const chosen = await requestedLaunch(body);
      if (chosen.error) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: chosen.error }));
        return;
      }
      try {
        const [focus] = await sourceDocuments(body.document ? [body.document] : []);
        const result = await startGoal(String(body.file ?? ""), {
          phase: "collaborate",
          launch: body.launch === true,
          document: focus?.file ?? "",
          command: chosen.command,
          label: chosen.label,
        });
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.status === 200 ? result : { error: result.error }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    // The one spawn path: the visible start-agent action for a Goal.
    if (url.pathname === "/api/goals/start" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const chosen = await requestedLaunch(body);
      if (chosen.error) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: chosen.error }));
        return;
      }
      try {
        const result = await startGoal(String(body.file ?? ""), {
          phase: "execute",
          approved: body.approved === true,
          launch: body.launch === true,
          command: chosen.command,
          label: chosen.label,
        });
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            result.status === 200
              ? { session: result.session, reattached: Boolean(result.reattached), primed: Boolean(result.primed) }
              : { error: result.error }
          )
        );
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    if (url.pathname === "/api/goals/understanding" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const file = String(body.file ?? "");
      const understanding = typeof body.understanding === "string" ? body.understanding.trim() : "";
      const goal = (await goalsByFile()).get(file);
      if (!goal) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no goal file ${file}` }));
        return;
      }
      if (!understanding) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Write what you think this work means." }));
        return;
      }
      try {
        await editGoalFile(file, { understanding });
        await vaultCommit(
          [file],
          `update: ${goal.area} goal ${goal.slug} records Julian's understanding`,
          goal.area,
          null
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, understanding }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    if (url.pathname === "/api/goals/accept" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      try {
        const result = await acceptGoalAssignment(String(body.file ?? ""));
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.status === 200 ? { ok: true } : { error: result.error }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    // The create lane writes a new Goal into an Area,
    // written on the user's word with a provenance commit, same as edits.
    if (url.pathname === "/api/goals/new" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const area = String(body.area ?? "");
      const title = String(body.title ?? "").trim();
      const doneWhen = String(body.doneWhen ?? "").trim();
      if (!area || !flattenAreaPaths(await readTree(TREES_ROOT)).includes(area)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no area "${area}"` }));
        return;
      }
      if (!title || !doneWhen) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: !title ? "a title is required" : "a Goal needs a done condition" }));
        return;
      }
      try {
        const file = await createGoalFile(area, { title, doneWhen, state: typeof body.state === "string" ? body.state : "" });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ file }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    if (url.pathname === "/api/goals/create" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const area = String(body.area ?? "");
      const goal = body.goal && typeof body.goal === "object" ? body.goal : {};
      const subgoals = Array.isArray(body.subgoals) ? body.subgoals.slice(0, 8) : [];
      if (!area || !flattenAreaPaths(await readTree(TREES_ROOT)).includes(area)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no area "${area}"` }));
        return;
      }
      if (!String(goal.title ?? "").trim() || !String(goal.doneWhen ?? "").trim()) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "the Goal needs a name and a done condition" }));
        return;
      }
      const normalizedSubgoals = subgoals
        .map((subgoal) => ({ title: String(subgoal?.title ?? "").trim(), doneWhen: String(subgoal?.doneWhen ?? "").trim(), state: "Not started." }))
        .filter((subgoal) => subgoal.title || subgoal.doneWhen);
      if (normalizedSubgoals.some((subgoal) => !subgoal.title || !subgoal.doneWhen)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "each Subgoal needs a name and a done condition" }));
        return;
      }
      try {
        const sources = await sourceDocuments(body.sources);
        const created = await createGoalSet(area, {
          goal: {
            title: String(goal.title).trim(),
            doneWhen: String(goal.doneWhen).trim(),
            state: String(goal.state ?? "Not started.").trim(),
          },
          subgoals: normalizedSubgoals,
          description: String(body.description ?? "").trim(),
          sources: sources.map((source) => ({ file: source.file, title: source.title })),
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(created));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    if (url.pathname === "/api/idea/new" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const area = String(body.area ?? "");
      const description = String(body.description ?? "").trim();
      if (!area || !flattenAreaPaths(await readTree(TREES_ROOT)).includes(area)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no area "${area}"` }));
        return;
      }
      if (!description) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "describe the idea before you save it" }));
        return;
      }
      try {
        const file = await saveWorkIdea(area, description);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, file }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    // The tree's edit lane: a status flip (mark done / reopen) or the
    // goal's own text, written on the user's click with a provenance
    // commit. Direct edits are the user's word; no agent is in the loop.
    if (url.pathname === "/api/goals/edit" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const file = String(body.file ?? "");
      const o = (await goalsByFile()).get(file);
      if (!o) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no goal file ${file}` }));
        return;
      }
      const fields = {};
      if (body.status !== undefined) {
        if (!["open", "done"].includes(body.status)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `status must be open or done, got "${body.status}"` }));
          return;
        }
        fields.status = body.status;
      }
      for (const key of ["title", "doneWhen", "state"]) {
        if (typeof body[key] === "string") fields[key] = body[key];
      }
      if (!Object.keys(fields).length) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "nothing to edit" }));
        return;
      }
      try {
        await editGoalFile(file, fields);
        const changed = fields.status === "done"
          ? await cascadeGoalDone(file, await goalsByFile())
          : [file];
        // The requested file can also carry text edits.
        if (!changed.includes(file)) changed.unshift(file);
        const what =
          fields.status === "done" ? "done" : fields.status === "open" ? "reopened" : "edited";
        await vaultCommit(changed, `update: ${o.area} goal ${o.slug} ${what} in tree`, o.area, null);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    if (url.pathname === "/api/spawn" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      try {
        const result = await spawnSession(body.area, body.name);
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.status === 200 ? { ok: true } : { error: result.error }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    if (url.pathname === "/api/caffeinate" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      setCaffeinate(Boolean(body.on));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, caffeinate: caffeinateProc !== null }));
      return;
    }
    // Switches the orchestrator's agent command only; goal sessions
    // always use their area-owned command (agentCmdForArea). The command is
    // whatever the user typed (claude, claude-otto, agy, pi, flags allowed);
    // tmux runs a single trailing string through the shell. Kills the running
    // orchestrator so the frontend's reconnect respawns it with the new command.
    if (url.pathname === "/api/agent" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const cmd = typeof body.cmd === "string" ? body.cmd.trim() : "";
      if (!cmd) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "cmd required" }));
        return;
      }
      agentCmd = cmd;
      try {
        await execFileAsync("tmux", ["kill-session", "-t", "=" + CHAT_SESSION]);
      } catch {} // no chat session running: nothing to respawn yet
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, agent: agentCmd }));
      return;
    }
    // Kills a tmux session (the kill-session shortcut in the frontend). The
    // "=" target prefix forces an exact name match; without it tmux treats the
    // target as a prefix and "vault" could kill "vaulttest".
    if (url.pathname.startsWith("/api/kill/") && req.method === "POST") {
      const name = decodeURIComponent(url.pathname.slice("/api/kill/".length));
      if (!name || name === CHAT_SESSION) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "refusing to kill this session" }));
        return;
      }
      try {
        await execFileAsync("tmux", ["kill-session", "-t", "=" + name]);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    if (url.pathname === "/api/voice" && req.method === "POST") {
      if (!GROQ_KEY) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no Groq key: set GROQ_API_KEY or keep one in otto-launcher/.env" }));
        return;
      }
      const focused = url.searchParams.get("focused") || CHAT_SESSION;
      try {
        const audio = await readBinaryBody(req);
        if (audio.length < 200) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "no audio" }));
          return;
        }
        const visible = (req.headers["x-visible-areas"] ?? "").split(",").filter(Boolean);
        const ctx = await voiceContext(focused, visible);
        const transcript = await transcribe(audio, req.headers["content-type"], voiceNameHints(ctx));
        const out = await routeAndExecute(transcript, focused, ctx);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ transcript, ...out }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.message ?? err) }));
      }
      return;
    }
    // The typed lane: the exact sentence the user would have spoken, routed
    // through the same grammar and actions, no transcription. For places
    // where talking out loud is not an option.
    if (url.pathname === "/api/command" && req.method === "POST") {
      if (!GROQ_KEY) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no Groq key: set GROQ_API_KEY or keep one in otto-launcher/.env" }));
        return;
      }
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const text = String(body.text ?? "").trim();
      if (!text) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "text required" }));
        return;
      }
      try {
        const focused = body.focused || CHAT_SESSION;
        const ctx = await voiceContext(focused, Array.isArray(body.visibleAreas) ? body.visibleAreas : []);
        const out = await routeAndExecute(text, focused, ctx);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ transcript: text, ...out }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.message ?? err) }));
      }
      return;
    }
    let filePath;
    if (url.pathname === "/" || url.pathname === "/index.html") {
      filePath = path.join(here, "public", "shell.html");
    } else if (url.pathname === "/vision" || url.pathname === "/vision/") {
      filePath = path.join(here, "public", "vision.html");
    } else if (url.pathname.startsWith("/vendor/xterm/")) {
      const rel = url.pathname.slice("/vendor/xterm/".length);
      const roots = {
        "xterm.js": "@xterm/xterm/lib/xterm.js",
        "xterm.css": "@xterm/xterm/css/xterm.css",
        "addon-fit.js": "@xterm/addon-fit/lib/addon-fit.js",
      };
      if (!roots[rel]) {
        res.writeHead(404).end("not found");
        return;
      }
      filePath = path.join(here, "node_modules", roots[rel]);
    } else {
      filePath = path.join(here, "public", path.normalize(url.pathname).replace(/^([.][.][/\\])+/, ""));
    }
    const body = await readFile(filePath);
    // no-cache (revalidate, and with no validators: refetch): Safari's
    // heuristic caching once served stale JavaScript against fresh HTML.
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const wss = new WebSocketServer({ server, path: "/term" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const session = url.searchParams.get("session") ?? CHAT_SESSION;
  const cols = Number(url.searchParams.get("cols") ?? 120);
  const rows = Number(url.searchParams.get("rows") ?? 32);

  // -A attaches when the session exists, creates it otherwise. The chat
  // session runs the agent command; other sessions get a plain shell.
  const args = ["new-session", "-A", "-s", session, "-c", WORKSPACE];
  // The agent command runs through the user's interactive shell so aliases
  // (claude-otto, pi) and rc-file PATH additions resolve; tmux itself spawns
  // commands via a non-interactive shell where aliases do not exist.
  if (session === CHAT_SESSION) {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const cmd = withDefaultModel(agentCmd);
    args.push(`exec ${shell} -ic '${cmd.replace(/'/g, "'\\''")}'`);
  }

  const term = pty.spawn("tmux", args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: WORKSPACE,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  term.onExit(() => ws.close());

  ws.on("message", (raw) => {
    const text = raw.toString();
    if (text.startsWith("\x00resize:")) {
      const [c, r] = text.slice(8).split("x").map(Number);
      if (c > 0 && r > 0) term.resize(c, r);
      return;
    }
    term.write(text);
  });
  ws.on("close", () => term.kill()); // kills the tmux *client* (detach); the session survives
});

server.listen(PORT, HOST, () => {
  console.log(`agent-shell: http://${HOST}:${PORT}`);
  console.log(`  orchestrator session "${CHAT_SESSION}" runs: ${agentCmd}`);
  console.log(`  workspace: ${WORKSPACE}`);
  if (!process.env.AGENT_SHELL_NO_OPEN) openStandaloneWindow();
});

/**
 * Opens (or focuses) the native "Agent Shell" app (a WKWebView wrapper built
 * from native/, installed in ~/Applications). The app also starts this server
 * itself when launched directly, setting AGENT_SHELL_NO_OPEN=1 to avoid a loop.
 */
function openStandaloneWindow() {
  execFile("open", ["-a", "Agent Shell"], (err) => {
    if (err) {
      console.log(`  no "Agent Shell" app installed: build it with npm run app,`);
      console.log(`  or open http://localhost:${PORT} in a browser. (Set AGENT_SHELL_NO_OPEN=1 to skip.)`);
    }
  });
}
