// Agent Shell prototype server.
// Serves the focus-and-return frontend and bridges WebSocket connections to
// tmux sessions through node-pty. The legacy tree UI remains at /legacy while
// the new product loop takes over the default entry.
import http from "node:http";
import os from "node:os";
import { createHash } from "node:crypto";
import { appendFile, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, watch } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { doneCascade } from "./outcome-cascade.mjs";
import { inheritedAgentCommand, noteResource } from "./node-agent-command.mjs";
import pty from "node-pty";
import { createReloadController } from "./reload-controller.mjs";
import { documentHash, markdownTitle, safeMarkdownPath, wikiLinks } from "./vault-documents.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? "127.0.0.1";
let agentCmd = process.env.AGENT_CMD ?? "claude";

/**
 * The launch command an outcome session pre-types for the user to accept or
 * edit. It is a suggestion, not a policy: a node note can name its own command
 * (`- Agent: claude`), otherwise the profile default follows the node path
 * (personal projects under otto/** run on the otto profile via the claude-otto
 * alias, work nodes run the plain work-account claude), and editing the line
 * is how an outcome runs on any other harness (codex, agy) or model. The
 * switchable agentCmd only ever applies to the orchestrator session.
 */
async function agentCmdForNode(node) {
  return inheritedAgentCommand(node, nodeNote);
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
// `chat` was the original name of the home session. Once the home session was
// renamed to `orchestrator`, an old tmux session could survive and appear as a
// second root process even though both names mean the same thing to Tangent.
const LEGACY_CHAT_SESSION = "chat";
const WORKSPACE = process.env.WORKSPACE ?? path.join(here, "workspace");
const TREES_ROOT = process.env.TREES_ROOT ?? path.join(os.homedir(), ".tangent", "trees");

if (!existsSync(WORKSPACE)) mkdirSync(WORKSPACE, { recursive: true });

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".png": "image/png",
};

// The native WKWebView is intentionally long-lived. Public asset saves notify
// it in place; POST /api/reload gives agents an explicit force-refresh hook.
const reloadController = createReloadController({ watchDir: path.join(here, "public") });
let sourceRestartTimer = null;

/**
 * Backend modules cannot hot-reload in place. Tell the page a restart is
 * coming, then exit cleanly; the native wrapper supervises and relaunches the
 * server while tmux keeps every agent/process alive.
 */
function scheduleServerRestart() {
  clearTimeout(sourceRestartTimer);
  sourceRestartTimer = setTimeout(() => {
    console.log("agent-shell: server source changed; restarting");
    reloadController.announceRestart();
    setTimeout(() => {
      reloadController.close();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref();
    }, 100).unref();
  }, 150);
}

const serverSourceWatcher = watch(here, { recursive: true }, (_event, filename) => {
  const file = String(filename ?? "");
  if (!file.endsWith(".mjs") || file.startsWith("node_modules/") || file.startsWith("native/build/")) return;
  scheduleServerRestart();
});

/**
 * Lists live tmux sessions for the sidebar in the frontend, which polls
 * /api/sessions to discover sessions the chat agent created. The `node`
 * field is the tangent tree node the session belongs to, read from the
 * tmux user option `@tangent_node` that the agent sets at creation time.
 */
async function listSessions() {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}\t#{session_path}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{@tangent_node}\t#{@tangent_kind}\t#{@tangent_outcome}\t#{@tangent_goal}\t#{@tangent_process}\t#{pane_current_command}\t#{@tangent_phase}",
    ]);
    const sessions = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, cwd, windows, attached, created, node, kind, outcome, goal, processName, command, phase] = line.split("\t");
        return {
          name,
          cwd,
          windows: Number(windows),
          attached: Number(attached) > 0,
          created: Number(created) * 1000,
          node: node || null,
          kind: kind || null,
          outcome: outcome || null,
          goal: goal || null,
          process: processName || null,
          command,
          phase: phase || null,
          isChat: name === CHAT_SESSION,
        };
      })
      .filter((session) => session.name !== LEGACY_CHAT_SESSION || CHAT_SESSION === LEGACY_CHAT_SESSION);
    return await withAgentStates(await withOutcomeInfo(sessions));
  } catch {
    return []; // no tmux server running yet
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
 * Sessions marked @tangent_kind=process (or legacy service sessions)
 * skip the screen diff: a quiet server would read as a waiting agent. The
 * pane command is signal enough — a shell means the command exited.
 */
async function withAgentStates(sessions) {
  const now = Date.now();
  const out = await Promise.all(
    sessions.map(async (s) => {
      if (s.kind === "process" || s.kind === "service") {
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
 * Reads one labelled line out of a node note's `## Resources` section, the
 * vault's home for per-node settings the shell honours when it opens a
 * session (`- Repository: ~/Projects/x`, `- Agent: claude`). Returns null
 * when the note, the section, or the label is missing.
 */
async function nodeResource(node, label) {
  const base = String(node ?? "").split("/").pop();
  let text;
  try {
    text = await readFile(path.join(TREES_ROOT, node, base + ".md"), "utf8");
  } catch {
    return null;
  }
  return noteResource(text, label);
}

/**
 * Resolves the working directory for a tree node from its node note's
 * `## Resources` section (a `Repository:` or `Worktree:` line), the same
 * lookup the chat agent performs when it opens sessions. Returns null when
 * the note records no usable directory.
 */
async function nodeDirectory(node) {
  const recorded = await nodeResource(node, "Repository|Worktree");
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
 * Creates a detached tmux work session on a tree node: plain shell in the
 * node's recorded repository, bound via @tangent_node. Backs the sidebar's
 * `+` affordance; the chat agent remains the path for richer setups.
 */
async function spawnSession(node, name) {
  if (!/^[a-z0-9-]+$/.test(name ?? "")) return { status: 400, error: "name must be lowercase letters, digits, hyphens" };
  const dir = await nodeDirectory(node);
  if (!dir) return { status: 409, error: "no repo recorded, ask chat" };
  // Exact-name existence check via list-sessions: has-session prefix-matches,
  // and set-option rejects the "=" exact-match prefix on this tmux, so "="
  // targets are unusable here.
  try {
    const { stdout } = await execFileAsync("tmux", ["list-sessions", "-F", "#{session_name}"]);
    if (stdout.split("\n").includes(name)) return { status: 409, error: `session "${name}" already exists` };
  } catch {} // no tmux server yet: nothing exists
  await execFileAsync("tmux", ["new-session", "-d", "-s", name, "-c", dir]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_node", node]);
  return { status: 200 };
}

const TREE_SKIP = new Set([".git", ".obsidian", "shared", "node_modules"]);

/**
 * Walks the tangent trees vault and returns project nodes as a nested tree
 * for the sidebar. Directories are nodes; files (notes) are ignored, as are
 * vault internals (.git, .obsidian) and shared/ team repos.
 */
async function readTree(dir, rel = "") {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes = [];
  for (const e of entries) {
    if (!e.isDirectory() || TREE_SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    nodes.push({
      name: e.name,
      path: childRel,
      children: await readTree(path.join(dir, e.name), childRel),
    });
  }
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  return nodes;
}

// ---- outcomes ----
// Outcomes are outcome-<slug>.md files beside node notes; the schema lives in
// the vault README. Nodes are what the user talks about, outcomes are what
// they achieve, sessions execute one outcome at a time. There is no separate
// task concept: a task is just an outcome small enough to work directly.
// Outcomes nest: a Breakdown section of [[outcome-...]] links orders an
// outcome's children, so a big outcome completes as the sum of its smallest
// achievable parts. The server's vault writes are strictly mechanical: status
// open->active plus the session name when it spawns an outcome's session, and
// the reverse when that session is gone. Every judgment write (waiting, done,
// steps, state) belongs to agents acting on the user's word.

/** Parses the note/outcome frontmatter block into a flat {key: value} object. */
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

/** Reads a node's note text, or "" when the node has no note yet. */
async function nodeNote(node) {
  try {
    return await readFile(path.join(TREES_ROOT, node, node.split("/").pop() + ".md"), "utf8");
  } catch {
    return "";
  }
}

/** Direct-child Markdown documents on a node, excluding its note/outcomes. */
async function readNodeDocuments(node) {
  const dir = path.join(TREES_ROOT, node);
  const noteName = node.split("/").pop() + ".md";
  let files;
  try { files = await readdir(dir); } catch { return []; }
  const documents = [];
  for (const name of files.filter((f) => f.endsWith(".md") && f !== noteName && !f.startsWith("outcome-"))) {
    const file = `${node}/${name}`;
    const absolute = path.join(dir, name);
    try {
      const [text, info] = await Promise.all([readFile(absolute, "utf8"), stat(absolute)]);
      documents.push({
        file, node, kind: "document", title: markdownTitle(text, name.slice(0, -3)),
        mtime: info.mtimeMs, hash: documentHash(text), links: wikiLinks(text),
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
  await vaultCommit([safe.relative], `update: ${current.node} ${current.kind} ${path.basename(file, ".md")} edited in tree`, current.node, null);
  return { status: 200, document: { ...current, text, hash: documentHash(text) } };
}

/** Outcome slugs in the order the node note's Road to done links them. */
function roadToDoneOrder(noteText) {
  return [...noteSection(noteText, "Road to done").matchAll(/\[\[outcome-([a-z0-9-]+)\]\]/g)].map((m) => m[1]);
}

/** Child outcome slugs in the order an outcome file's Breakdown links them. */
function breakdownOrder(text) {
  return [...noteSection(text, "Breakdown").matchAll(/\[\[outcome-([a-z0-9-]+)\]\]/g)].map((m) => m[1]);
}

/**
 * Reads the outcome files homed in one node's directory, unordered. Ordering
 * is hierarchical and can cross nodes, so vaultIndex derives it; spawn and
 * reconcile only need lookup by slug within the home node.
 */
async function readNodeOutcomes(node) {
  let entries;
  try {
    entries = await readdir(path.join(TREES_ROOT, node));
  } catch {
    return [];
  }
  const outcomes = [];
  for (const f of entries.filter((f) => /^outcome-[a-z0-9-]+\.md$/.test(f))) {
    let text;
    try {
      text = await readFile(path.join(TREES_ROOT, node, f), "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    if (fm.type !== "outcome") continue;
    const slug = f.slice("outcome-".length, -".md".length);
    const mtime = await stat(path.join(TREES_ROOT, node, f)).then((s) => s.mtimeMs, () => 0);
    outcomes.push({
      mtime,
      node,
      slug,
      file: `${node}/${f}`,
      title: text.match(/^# (.+)$/m)?.[1]?.trim() ?? slug,
      status: fm.status || "open",
      outcome: fm.outcome || "",
      stateText: noteSection(text, "State"),
      myUnderstanding: noteSection(text, "My understanding"),
      waitingOn: fm.waiting_on || null,
      due: fm.due || null,
      session: fm.session || null,
      breakdown: breakdownOrder(text),
    });
  }
  return outcomes;
}

/**
 * The launcher's search index: every node with its note's purpose line, the
 * people on it (owners/waiting_on, including its outcomes'), a lowercased
 * body excerpt for content matches ("sami" finds the node whose note mentions
 * Sami), and its outcomes. Each node's outcome list is the depth-first
 * flatten of its Road to done roots through Breakdown links (children may be
 * homed in other nodes), with `depth` for indentation; outcome files nothing
 * links trail at the top level, alphabetically.
 * Small vault, read fresh per request. Returns { nodes, map }: the per-node
 * entries for typed search, plus the unified deduplicated map (built below)
 * that the launcher's browse view renders.
 */
async function vaultIndex() {
  const flat = [];
  /** Depth-first over the node tree, collecting every node. */
  const walk = async (nodes) => {
    for (const n of nodes) {
      flat.push(n);
      await walk(n.children);
    }
  };
  await walk(await readTree(TREES_ROOT));
  const entries = [];
  const bySlug = new Map();
  for (const n of flat) {
    const note = await nodeNote(n.path);
    const own = await readNodeOutcomes(n.path);
    const documents = await readNodeDocuments(n.path);
    entries.push({ n, note, own, documents });
    for (const o of own) if (!bySlug.has(o.slug)) bySlug.set(o.slug, o);
  }
  const linked = new Set([...bySlug.values()].flatMap((o) => o.breakdown));
  const out = [];
  const records = [];
  for (const { n, note, own, documents } of entries) {
    const noteFile = `${n.path}/${n.name}.md`;
    records.push({ file: noteFile, node: n.path, kind: "note", title: markdownTitle(note, n.name), links: wikiLinks(note) });
    for (const o of own) {
      const text = await readFile(path.join(TREES_ROOT, o.file), "utf8").catch(() => "");
      records.push({ file: o.file, node: o.node, kind: "outcome", title: o.title, links: wikiLinks(text) });
    }
    records.push(...documents);
  }
  const byStem = new Map(records.map((r) => [path.basename(r.file, ".md"), r]));
  const backlinks = new Map(records.map((r) => [r.file, []]));
  for (const source of records) for (const target of source.links) {
    const hit = byStem.get(path.basename(target));
    if (hit && hit.file !== source.file) backlinks.get(hit.file).push(source.file);
  }
  for (const record of records) record.backlinks = backlinks.get(record.file) ?? [];

  for (const { n, note, own, documents } of entries) {
    const roots = roadToDoneOrder(note).filter((s) => bySlug.has(s));
    const unlinked = own.map((o) => o.slug).filter((s) => !roots.includes(s) && !linked.has(s)).sort();
    const seen = new Set();
    const outcomes = [];
    /** Flattens one outcome and its breakdown descendants, depth-first. */
    const dive = (slug, depth) => {
      const o = bySlug.get(slug);
      if (!o || seen.has(slug)) return;
      seen.add(slug);
      outcomes.push({ ...o, depth });
      for (const c of o.breakdown) dive(c, depth + 1);
    };
    for (const s of [...roots, ...unlinked]) dive(s, 0);
    const fm = parseFrontmatter(note);
    out.push({
      path: n.path,
      name: n.name,
      purpose: noteSection(note, "Purpose").split("\n")[0] ?? "",
      people: [fm.owners, fm.waiting_on, ...own.map((o) => o.waitingOn)].filter(Boolean).join(" "),
      body: note.slice(0, 4000).toLowerCase(),
      note: records.find((r) => r.kind === "note" && r.node === n.path),
      documents: documents.map((d) => ({ ...d, backlinks: backlinks.get(d.file) ?? [] })),
      outcomes,
    });
  }
  // The unified map: every outcome exactly once, at its topmost position.
  // A root is an outcome no other outcome's Breakdown links; it groups under
  // its home node and its whole subtree indents beneath it, wherever the
  // children are homed (`foreign` names a child's home node when it differs).
  // This is what kills the launcher's duplicate subtrees: viz-input's tree
  // renders once, under the megabranch root that contains it.
  const groups = [];
  const groupByNode = new Map();
  const placed = new Set();
  for (const { n, note, own } of entries) {
    const road = roadToDoneOrder(note).filter((s) => bySlug.has(s));
    const ordered = [...road, ...own.map((o) => o.slug).filter((s) => !road.includes(s)).sort()];
    for (const s of ordered) {
      if (linked.has(s) || placed.has(s)) continue;
      let g = groupByNode.get(n.path);
      if (!g) {
        g = { path: n.path, name: n.name, purpose: noteSection(note, "Purpose").split("\n")[0] ?? "", outcomes: [] };
        groupByNode.set(n.path, g);
        groups.push(g);
      }
      /** Places one root and its breakdown descendants into the group. */
      const place = (slug, depth) => {
        const o = bySlug.get(slug);
        if (!o || placed.has(slug)) return;
        placed.add(slug);
        g.outcomes.push({ ...o, depth, foreign: o.node === n.path ? null : o.node.split("/").pop() });
        for (const c of o.breakdown) place(c, depth + 1);
      };
      place(s, 0);
    }
  }
  // Heat: groups with a live (active) outcome first, then most recently
  // touched, so the outcome you came for is in the top rows before you type.
  for (const g of groups) {
    g.active = g.outcomes.some((o) => o.status === "active");
    g.mtime = Math.max(0, ...g.outcomes.map((o) => o.mtime ?? 0));
  }
  groups.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.mtime - a.mtime);
  return { nodes: out, map: groups, documents: records };
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
 * Rewrites only the status and session frontmatter lines of an outcome file —
 * the two mechanical fields the server owns. Everything else in the file is
 * agent- or user-spoken text and must pass through untouched.
 */
async function writeOutcomeBinding(file, { status, session }) {
  const abs = path.join(TREES_ROOT, file);
  let text = await readFile(abs, "utf8");
  text = withFrontmatterLine(text, "status", status);
  text = withFrontmatterLine(text, "session", session);
  await writeFile(abs, text);
}

/**
 * Applies a user edit from the tree's card to an outcome file: a status flip
 * (mark done / reopen) or the outcome's own text (title, done condition, the
 * State section). Direct edits are the user's own word, so the vault rule
 * that judgment state is written on Julian's word is satisfied by the click
 * itself — no agent in the loop, status never waits on one.
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

async function editOutcomeFile(file, { status, session, title, outcome, state, understanding }) {
  const abs = path.join(TREES_ROOT, file);
  let text = await readFile(abs, "utf8");
  if (status !== undefined) text = withFrontmatterLine(text, "status", status);
  if (session !== undefined) text = withFrontmatterLine(text, "session", session);
  if (outcome !== undefined) {
    text = withFrontmatterLine(text, "outcome", outcome.replace(/\s*\n\s*/g, " ").trim());
  }
  if (title !== undefined && title.trim()) {
    const t = title.replace(/\s*\n\s*/g, " ").trim();
    text = /^# .*$/m.test(text) ? text.replace(/^# .*$/m, () => "# " + t) : text + `\n# ${t}\n`;
  }
  if (state !== undefined) text = replaceNoteSection(text, "State", state);
  if (understanding !== undefined) text = replaceNoteSection(text, "My understanding", understanding);
  await writeFile(abs, text);
}

/**
 * Creates a new outcome file on a node, from the tree's editor. The slug
 * comes from the title and is suffixed until vault-unique (wikilinks resolve
 * by file name). The vault schema makes `outcome:` mandatory — the caller
 * validates it. Returns the vault-relative file path.
 */
async function createOutcomeFile(node, { title, outcome, state }) {
  /** Collapses user-entered multiline text into a YAML-safe single line. */
  const oneline = (s) => s.replace(/\s*\n\s*/g, " ").trim();
  const base = normName(title).slice(0, 48).replace(/-+$/, "") || "outcome";
  const taken = new Set([...(await outcomesByFile()).values()].map((o) => o.slug));
  let slug = base;
  for (let i = 2; taken.has(slug) || existsSync(path.join(TREES_ROOT, node, `outcome-${slug}.md`)); i++) {
    slug = `${base}-${i}`;
  }
  const file = `${node}/outcome-${slug}.md`;
  const text =
    `---\ntype: outcome\nstatus: open\noutcome: ${oneline(outcome)}\nsession:\n---\n\n` +
    `# ${oneline(title)}\n\n## State\n\n${(state ?? "").trim() || "Not started."}\n`;
  await writeFile(path.join(TREES_ROOT, file), text);
  // A brand-new file is invisible to vaultCommit's pathspec commit until it
  // is tracked; adding exactly this path stages nothing else.
  await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", file]).catch(() => {});
  await vaultCommit([file], `add: ${node} outcome ${slug} from tree`, node, null);
  return file;
}

/**
 * Commits exactly the given vault paths with the provenance trailers the
 * vault rules require. Pathspec commit, no staging: another agent's staged
 * edits can never ride along. Best effort — a failed commit logs and moves
 * on, the file edit itself already happened.
 */
async function vaultCommit(relPaths, message, node, tmuxSession) {
  const trailers = [`Tangent-Node: ${node}`, tmuxSession ? `Tangent-Tmux: ${tmuxSession}` : null].filter(Boolean);
  try {
    await execFileAsync("git", ["-C", TREES_ROOT, "commit", "-m", message, "-m", trailers.join("\n"), "--", ...relPaths]);
  } catch (err) {
    console.error("vault commit:", String(err.stderr ?? err.message ?? err).slice(0, 200));
  }
}

/**
 * Marks one outcome and every Breakdown descendant done, clearing bindings
 * and stopping their sessions. This is the shared mutation for both direct
 * tree-card flips and agent-authored done states found by reconciliation.
 * Returns only files changed by this pass, suitable for one atomic commit.
 */
async function cascadeOutcomeDone(rootFile, byFile) {
  const changed = [];
  for (const outcome of doneCascade(rootFile, byFile)) {
    if (outcome.status !== "done" || outcome.session) {
      await writeOutcomeBinding(outcome.file, { status: "done", session: null });
      changed.push(outcome.file);
    }
    if (outcome.session) {
      await execFileAsync("tmux", ["kill-session", "-t", "=" + outcome.session]).catch(() => {});
    }
    outcome.status = "done";
    outcome.session = null;
  }
  return changed;
}

/** The deterministic source set that one outcome supplies to an agent. */
async function outcomeContext(node, o) {
  const parts = node.split("/");
  const notes = [];
  for (let i = parts.length; i >= 1; i--) {
    const p = parts.slice(0, i).join("/");
    const abs = path.join(TREES_ROOT, p, parts[i - 1] + ".md");
    if (existsSync(abs)) notes.push(abs);
  }
  const index = await vaultIndex();
  const linked = index.documents.filter((d) => d.kind === "document" && (
    d.backlinks.includes(o.file) || index.documents.find((r) => r.file === o.file)?.links.includes(path.basename(d.file, ".md"))
  ));
  return {
    outcome: path.join(TREES_ROOT, o.file),
    notes,
    designs: linked.map((d) => path.join(TREES_ROOT, d.file)),
  };
}

/**
 * The exact assignment shown before execution and typed into the selected
 * harness. Markdown keeps the contract readable in both the shell and the
 * agent composer.
 */
async function outcomePrompt(node, o) {
  const context = await outcomeContext(node, o);
  const sources = [
    `- Outcome: ${context.outcome}`,
    ...context.notes.map((note, index) => `- Node note ${index + 1}: ${note}`),
    ...context.designs.map((design) => `- Design: ${design}`),
  ];
  return (
    `# Assignment: ${o.title}\n\n` +
    `## Result\n\n${o.outcome || "Read the outcome file for the required result."}\n\n` +
    (o.myUnderstanding ? `## Julian's understanding\n\n${o.myUnderstanding}\n\n` : "") +
    `## Sources\n\n${sources.join("\n")}\n\n` +
    `## Working contract\n\n` +
    `- Read the outcome first. Then read the node notes from nearest to farthest.\n` +
    (context.designs.length
      ? `- Read each linked design as the current solution contract. Before you write design prose, read ${path.join(os.homedir(), ".agents", "skills", "simple-english", "SKILL.md")}. Use pragmatic mode and do its mandatory self-check.\n`
      : "") +
    (o.breakdown.length ? `- Work the child outcomes in Breakdown order.\n` : "") +
    `- Before you start a long-running server or watcher, run \`tangent process list\`. Use \`tangent process start\` for a matching managed process.\n` +
    `- Keep the outcome State section current.\n` +
    `- When the result is met, propose marking it done. Never mark it done without confirmation.`
  );
}

/** The contract for a discussion that must not become hidden execution. */
async function understandingPrompt(node, o) {
  const assignment = await outcomePrompt(node, o);
  return (
    `# Understand before execution\n\n` +
    `Discuss this outcome with Julian. Do not edit code or start implementation.\n\n` +
    `Research facts yourself. Present one product decision at a time. Julian owns decisions that change meaning, scope, trade-offs, or proof.\n\n` +
    `Keep the outcome State section current with these headings when they are useful: Outcome, Settled decisions, Deferred, Proof, and Unresolved decisions.\n\n` +
    `When no important decision remains, show the complete shared understanding. Then propose one exact assignment. Wait for approval before execution.\n\n` +
    `## Source context\n\n${assignment}`
  );
}

// ---- outcome prompt arming ----
// Legacy calls prime a plain shell and leave both the harness command and the
// opening prompt for the user to submit. The context-first shell can request
// direct launch after it has shown the human-readable plan. In that path, the
// harness command and the verified opening prompt are both submitted.
//
// Arming is only ever set by the start-agent action, never inferred from what
// the user runs. A session that has been used for a while sits unarmed, so
// ordinary work in the pane (an editor, a test run, a pager) is never typed
// into; starting the outcome again re-primes it, which is how a second harness
// on the same outcome gets the same context.

const ARM_POLL_MS = 1000;
const SETTLE_MS = 500; // repaint window between readiness samples
const STILL_SAMPLES = 3; // consecutive identical samples that count as booted
const READY_MAX_MS = 30_000; // stop waiting for a quiet screen and type anyway
const ECHO_MS = 1200; // time for a TUI to draw what was typed into it
const RETRY_MS = 2500; // extra boot time before typing the prompt again
const TYPE_ATTEMPTS = 3;
const PROBE_CHARS = 24; // opening words, short enough to stay visible in a composer
const armedSessions = new Map(); // session -> { phase, submit }
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
 * Types an outcome's opening prompt into the harness the user just started,
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
async function typeOutcomePromptWhenReady(session, node, file, phase = "execute", submit = false) {
  try {
    const o = (await readNodeOutcomes(node)).find((t) => t.file === file);
    if (!o) return;
    const prompt = phase === "understand" ? await understandingPrompt(node, o) : await outcomePrompt(node, o);
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
      console.error(`outcome prompt: ${session} took it partially (attempt ${attempt}), clearing and retyping`);
      // C-u is "clear the input line" in every composer the shell meets, and
      // an unrecognised C-u costs a stray keystroke, not the prompt.
      await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "C-u"]).catch(() => {});
      await sleep(RETRY_MS);
    }
    console.error(`outcome prompt: ${session} never showed the whole prompt`);
  } catch (err) {
    console.error("outcome prompt:", err.message ?? err);
  }
}

/**
 * One arming pass: fires the prompt for every armed session whose pane has
 * left the shell, and forgets sessions that died. Armed sessions are the only
 * ones looked at, so an outcome session in ordinary use costs nothing.
 */
async function tickArmedSessions() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}\t#{@tangent_node}\t#{@tangent_outcome}\t#{pane_current_command}",
    ]));
  } catch {
    armedSessions.clear(); // no tmux server: nothing to watch
    return;
  }
  const live = new Set();
  for (const line of stdout.trim().split("\n").filter(Boolean)) {
    const [name, node, file, command] = line.split("\t");
    live.add(name);
    if (!armedSessions.has(name) || SHELL_CMDS.has(command)) continue;
    const armed = armedSessions.get(name);
    armedSessions.delete(name);
    if (node && file) typeOutcomePromptWhenReady(name, node, file, armed.phase, armed.submit);
  }
  for (const name of armedSessions.keys()) if (!live.has(name)) armedSessions.delete(name);
}

/**
 * Arms one primed session and keeps the watch timer running while anything is
 * armed: one tmux query a second, never overlapping, stopped once every primed
 * session has its harness.
 */
function armSession(name, phase = "execute", submit = false) {
  armedSessions.set(name, { phase, submit });
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
 * Primes a session sitting at its shell: the node's suggested launch command
 * typed but not submitted, and the outcome prompt armed to follow whatever
 * harness the user starts. A pane that is already running something is left
 * alone — priming must never type over an agent mid-conversation.
 */
async function primeOutcomeSession(session, node, phase = "execute", { launch = false } = {}) {
  const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", "=" + session + ":", "#{pane_current_command}"]);
  if (!SHELL_CMDS.has(stdout.trim())) return false;
  armSession(session, phase, launch);
  await typeInto(session, withDefaultModel(await agentCmdForNode(node)), false);
  if (launch) {
    await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "Enter"]);
    await sleep(250);
  }
  return true;
}

/**
 * Spawns (or reattaches) the work session for one outcome: a plain shell in
 * the node's repo with the suggested agent command pre-typed, bound via
 * @tangent_node + @tangent_outcome, outcome mechanically flipped to active.
 * Both the launch line and the opening prompt follow the type-but-never-submit
 * rule, so the harness, the model, and the words all stay the user's call.
 */
async function spawnOutcomeSession(node, slug, { phase = "execute", approved = false, launch = false } = {}) {
  const o = (await readNodeOutcomes(node)).find((t) => t.slug === slug);
  if (!o) return { status: 404, error: `no outcome "${slug}" on ${node}` };
  if (["done", "dropped"].includes(o.status)) return { status: 409, error: `outcome is ${o.status}` };
  const sessions = await listSessions();
  const baseName = normName(`${node.split("/").pop()}--${slug}`).slice(0, 60);
  const phaseName = phase === "understand" ? normName(`${baseName}--understand`).slice(0, 60) : baseName;
  // Starting an outcome that already has a session re-primes it: a pane left
  // at a shell (the agent was stopped to do ordinary work) gets the launch
  // line and the prompt again, a pane still running one is only reattached.
  const existing = [o.session, phaseName, baseName].find((n) => n && sessions.some((s) => s.name === n));
  if (existing) {
    await execFileAsync("tmux", ["set-option", "-t", existing, "@tangent_phase", phase]);
    const live = sessions.find((s) => s.name === existing);
    let primed = false;
    if (approved && phase === "execute" && live && !SHELL_CMDS.has(live.command)) {
      if (live.state === "working") return { status: 409, error: "the agent is still working; wait before you approve another assignment" };
      await typeInto(existing, await outcomePrompt(node, o), true);
    } else {
      primed = await primeOutcomeSession(existing, node, phase, { launch }).catch(() => false);
    }
    if (o.status !== "active" || o.session !== existing) {
      await writeOutcomeBinding(o.file, { status: "active", session: existing });
      await vaultCommit([o.file], `update: ${node} outcome ${slug} active`, node, existing);
    }
    return { status: 200, session: existing, reattached: true, primed };
  }
  const dir = (await nodeDirectory(node)) ?? path.join(TREES_ROOT, node);
  // No command: tmux runs the login shell, so aliases (claude-otto) resolve
  // and the session outlives whatever agent is started in it.
  await execFileAsync("tmux", ["new-session", "-d", "-s", phaseName, "-c", dir]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_node", node]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_outcome", o.file]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_kind", "outcome"]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_phase", phase]);
  if (o.outcome) await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_goal", o.outcome]);
  try {
    await writeOutcomeBinding(o.file, { status: "active", session: phaseName });
    await vaultCommit([o.file], `update: ${node} outcome ${slug} active`, node, phaseName);
  } catch (err) {
    console.error("outcome binding:", err.message ?? err);
  }
  const primeNewSession = async () => {
    // Let the login shell finish drawing its prompt: a line typed earlier can
    // be wiped by the redraw.
    await sleep(700);
    try {
      await primeOutcomeSession(phaseName, node, phase, { launch });
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
/**
 * Reconciles outcome files and tmux sessions both ways, off the sessions
 * poll, throttled; also covers drift that happened while this server was
 * down. File side: an `active` outcome whose owning session is gone reverts
 * to open, session cleared — only `active` reverts, waiting/done are
 * judgment states and stay. Session side: a finished outcome leaves no
 * session behind, so any live session whose @tangent_outcome points at a
 * done, dropped, or deleted outcome is an orphan and is killed. That sweep
 * is what covers agent-written done flips and orphans from before the rule.
 */
async function reconcileOutcomes(sessions) {
  if (reconciling || Date.now() - lastReconcile < 10_000) return;
  reconciling = true;
  lastReconcile = Date.now();
  try {
    const live = new Set(sessions.map((s) => s.name));
    const byFile = new Map();
    for (const node of flattenNodePaths(await readTree(TREES_ROOT))) {
      for (const t of await readNodeOutcomes(node)) byFile.set(t.file, t);
    }
    // A done status may have been written by any agent while the server was
    // running or stopped. Cascade before active-session cleanup so a live
    // child is completed, rather than incorrectly reopened, with its parent.
    for (const t of byFile.values()) {
      if (t.status !== "done") continue;
      const changed = await cascadeOutcomeDone(t.file, byFile);
      if (changed.length) {
        await vaultCommit(changed, `update: ${t.node} outcome ${t.slug} done cascaded to children`, t.node, null);
      }
    }
    for (const t of byFile.values()) {
      if (t.status !== "active" || !t.session || live.has(t.session)) continue;
      await writeOutcomeBinding(t.file, { status: "open", session: null });
      await vaultCommit([t.file], `update: ${t.node} outcome ${t.slug} back to open, session ended`, t.node, null);
    }
    for (const s of sessions) {
      if (!s.outcome) continue;
      const t = byFile.get(s.outcome);
      if (t && !["done", "dropped"].includes(t.status)) continue;
      await execFileAsync("tmux", ["kill-session", "-t", "=" + s.name]).catch(() => {});
      console.log(`reaped session ${s.name}: outcome ${s.outcome} is ${t ? t.status : "deleted"}`);
      if (t && t.session === s.name) {
        await writeOutcomeBinding(t.file, { status: t.status, session: null });
        await vaultCommit([t.file], `update: ${t.node} outcome ${t.slug} session reaped`, t.node, null);
      }
    }
  } catch (err) {
    console.error("outcome reconcile:", err.message ?? err);
  } finally {
    reconciling = false;
  }
}

const outcomeInfoCache = new Map(); // file -> { at, info }
/**
 * Attaches outcome title/statement/status to each session that carries
 * @tangent_outcome, for the frontend strip and sidebar labels. Tiny TTL
 * cache: the sessions poll runs every 2s and outcome files rarely change.
 */
async function withOutcomeInfo(sessions) {
  return Promise.all(
    sessions.map(async (s) => {
      if (!s.outcome) return s;
      let hit = outcomeInfoCache.get(s.outcome);
      if (!hit || Date.now() - hit.at > 3000) {
        try {
          const text = await readFile(path.join(TREES_ROOT, s.outcome), "utf8");
          const fm = parseFrontmatter(text);
          hit = {
            at: Date.now(),
            info: {
              outcomeTitle: text.match(/^# (.+)$/m)?.[1]?.trim() ?? null,
              outcomeText: fm.outcome || null,
              outcomeStatus: fm.status || null,
            },
          };
        } catch {
          hit = { at: Date.now(), info: {} };
        }
        outcomeInfoCache.set(s.outcome, hit);
      }
      return { ...s, ...hit.info };
    })
  );
}

// ---- outcome lookup + start ----
// There is no focus concept: the tree (scoped client-side) is the only lens,
// and the user starts outcomes going themselves. The one spawn path in the
// shell is the explicit /api/outcome/start; everything else — clicking,
// scoping, selecting — is side-effect free.

const CLOSED_OUTCOME = new Set(["done", "dropped", "deferred"]); // not workable

/** Every outcome in the vault keyed by its vault-relative file path. */
async function outcomesByFile() {
  const map = new Map();
  for (const node of flattenNodePaths(await readTree(TREES_ROOT))) {
    for (const o of await readNodeOutcomes(node)) map.set(o.file, o);
  }
  return map;
}

/**
 * The one spawn path in the shell: opens (or re-primes) the session for an
 * outcome, by file. A session is only ever primed when this is explicitly
 * asked, and the harness itself is always started by the user.
 */
async function startOutcome(file, options = {}) {
  const o = (await outcomesByFile()).get(file);
  if (!o) return { status: 404, error: `no outcome file ${file}` };
  return spawnOutcomeSession(o.node, o.slug, options);
}

/** Stops one accepted assignment without claiming that its outcome is done. */
async function acceptOutcomeAssignment(file) {
  const o = (await outcomesByFile()).get(file);
  if (!o) return { status: 404, error: `no outcome file ${file}` };
  if (o.session) await execFileAsync("tmux", ["kill-session", "-t", "=" + o.session]).catch(() => {});
  await writeOutcomeBinding(o.file, { status: "open", session: null });
  await vaultCommit([o.file], `update: ${o.node} outcome ${o.slug} assignment accepted`, o.node, null);
  return { status: 200 };
}

// ---- voice + typed command control ----
// POST /api/voice: an utterance in, actions out. The browser records push-to-
// talk audio; this server transcribes it (Groq whisper) and hands the
// transcript plus live shell state (sessions, states, pane tails, tree nodes,
// the nodes visible in the user's sidebar) to a fast LLM router.
// POST /api/command is the same lane for typed text: identical grammar,
// identical routing, no transcription.
//
// The router's contract: the user's words are never rewritten. Speech or text
// meant for an agent travels verbatim via the "say" action — the router only
// picks the destination and names the leading address words, which the server
// strips itself. Shell verbs (view, spawn, kill, sidebar, caffeinate, agent
// switch, spoken answers) are a small closed set and fire only on clear
// matches. Nodes have no agents of their own: addressing a tree node
// delivers the utterance to the orchestrator (the chat session) with the
// node name kept in the words, so the orchestrator knows which node is
// meant. On any router failure the fallback is inert: the utterance is
// typed into the focused session, unsubmitted — a misheard or misrouted
// utterance can never fire an action on its own.

const GROQ_KEY =
  process.env.GROQ_API_KEY ??
  (() => {
    // The otto-launcher project keeps a Groq key in its .env; reuse it so the
    // shell needs no separate setup on this machine.
    try {
      const env = readFileSync(path.join(os.homedir(), "Projects", "otto-launcher", ".env"), "utf8");
      return env.match(/^GROQ_API_KEY=(.+)$/m)?.[1]?.trim() ?? null;
    } catch {
      return null;
    }
  })();
const ROUTER_MODEL = process.env.VOICE_ROUTER_MODEL ?? "llama-3.3-70b-versatile";

const ROUTER_SYSTEM = `You route commands for "agent shell", a terminal app whose tabs are tmux sessions running coding agents. The session named in chatSession is the orchestrator: the root agent that organizes the whole project tree (creating nodes, capturing outcomes, opening sessions). The user addresses agents by session name or by node name — nodes have no agents of their own, so a node name means the orchestrator acting on that node, and you may target any node in the payload.

You get a JSON payload: the utterance (speech-to-text or typed), the focused session, all sessions (state: working = agent busy, waiting = agent finished or needs input, shell = plain shell, service/stopped = background command), the visible pane tail of relevant sessions, visibleNodes (the tree nodes the user can currently see in the sidebar — their mental model; prefer them when resolving names), and allNodes.

THE RULE ABOVE ALL OTHERS: you never write, rewrite, trim, or fix the user's words. Words meant for an agent travel verbatim through "say"; you only pick the destination and identify which leading words were the address. The server strips the address itself.

Reply with JSON only: {"actions":[...]}, at most 5 actions, executed in order. Action types:
- {"type":"say","target":"<the payload's exact session name or node path, or \\"\\" for the focused session>","address":"<the exact leading words of the utterance that name the target, \\"\\" if none>"} — deliver the utterance (minus the address) to an agent. THE DEFAULT: anything that is not clearly a shell verb below is a say. An utterance opening with a session or node name and then instructing it ("megabranch, run the client build" / "PG&E run the daily speedrun") is addressed; everything else has target "" (the focused session). Stating a goal, an ambition, or a breakdown request at a node ("tangent, I want X") is one say to that node, the whole utterance in one piece. A node target is delivered to the orchestrator with the utterance intact, node name included. Target must be "" unless the utterance's own words name the target, and a non-empty target always carries the address words that named it — never one without the other. NEVER infer a target from topic or content: a complaint or question about sessions, the shell, killing, or an agent goes to the focused session like anything else unless a name was actually said. The server enforces this — a say without address words always lands in the focused session.
- {"type":"keys","session":"<name>","keys":["Enter"]} — press special keys. Allowed: Enter, Escape, Tab, Up, Down, Left, Right, BSpace, Space, C-c, and single letters or digits like "y" or "2". Use for answering menus and permission prompts visible in the pane tail (send the matching option key) and for "stop" or "interrupt" (Escape, or C-c in a shell).
- {"type":"view","target":"<session or node name>"} — show that session in the app (a node name scopes the sidebar tree to that node instead). For "show me X", "open X", "go to X", "switch to X".
- {"type":"close_view"} — leave the current session view, back to the orchestrator.
- {"type":"sidebar"} — toggle the project tree sidebar.
- {"type":"spawn","node":"<tree node path>","name":"<lowercase-hyphen-name>"} — create a plain work session on a project node. Only for a bare "new/open a session on X (called Y)" with nothing else attached. If the user states a goal, task, or any context in the same utterance, do NOT spawn: say the whole thing to the node instead (it reaches the orchestrator, which does the richer setup).
- {"type":"kill","session":"<name>"} — destroy a session and everything in it. Only on an explicit kill or destroy request.
- {"type":"caffeinate","on":true} — keep the mac awake (or release it).
- {"type":"agent","cmd":"<command>"} — switch the orchestrator's agent command (for example "claude-otto" or "pi"). Only on an explicit request; it restarts the orchestrator. Outcome sessions are unaffected: they always run their node's own agent.
- {"type":"speak","text":"one short sentence"} — answer out loud. Use for status questions ("who's waiting on me?" — summarize the waiting and working sessions from the payload) and to say why you did nothing.

Rules:
- Shell verbs fire only on a clear match. When torn between say and any non-destructive action, say. Never guess kill, agent, or spawn.
- Spoken names are fuzzy, but targets are literal: resolve the spoken name against the payload and copy its exact spelling into the action — a session's name ("retry loop" → "retry-loop") or a node's full path ("PG&E" → "neara/pgande"). A whole-name session match wins; otherwise a name matching a node's base name means the node, even when session names merely contain it ("tangent" beside session "tangent-fix-voice" means the tangent node). Resolve against sessions, then visibleNodes, then allNodes. Only reference sessions and nodes that exist in the payload.
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
 * option number would answer), the vault node paths, and the subset of nodes
 * the user's sidebar currently shows (their mental model, so spoken names
 * resolve the way the tree spells them).
 */
async function voiceContext(focused, visibleNodes = []) {
  const sessions = await listSessions();
  const paneTails = {};
  for (const s of sessions) {
    if (s.name !== focused && s.state !== "waiting" && !s.isChat) continue;
    try {
      const { stdout } = await execFileAsync("tmux", ["capture-pane", "-p", "-t", "=" + s.name + ":"]);
      paneTails[s.name] = stdout.replace(/\s+$/, "").split("\n").slice(-14).join("\n");
    } catch {}
  }
  const projectNodes = flattenNodePaths(await readTree(TREES_ROOT));
  // Workable outcomes ride along so spoken references to work ("who's on X?")
  // can resolve against real outcome titles.
  const outcomes = [...(await outcomesByFile()).values()]
    .filter((o) => !CLOSED_OUTCOME.has(o.status))
    .map((o) => ({ title: o.title, node: o.node }));
  return { sessions, paneTails, projectNodes, visibleNodes: visibleNodes.filter((p) => projectNodes.includes(p)), outcomes };
}

/** Flattens the nested tree into the plain node-path list the router reads. */
function flattenNodePaths(nodes, out = []) {
  for (const n of nodes) {
    out.push(n.path);
    flattenNodePaths(n.children, out);
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
 * Resolves a spoken target onto a session or a tree node: sessions first,
 * then node base names (visible nodes before the whole vault), then full
 * node paths. "root", "orchestrator", and "chat" all mean the orchestrator
 * session. Returns {session} or {node} or null.
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
  const node = byName(ctx.visibleNodes) ?? byName(ctx.projectNodes);
  return node ? { node } : null;
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
  const names = resolved.node ? [resolved.node, resolved.node.split("/").pop()] : [resolved.session];
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
          // A node has no agent of its own: node-addressed words go to the
          // orchestrator with the address kept, so it knows which node is
          // meant. Session-addressed words are stripped of the address.
          const target = resolved.node ? CHAT_SESSION : resolved.session;
          const text = (resolved.node ? utterance : stripAddress(utterance, address)).slice(0, 4000);
          // Never auto-run prose at a bare shell prompt; agents get Enter.
          const submit = sessions.find((s) => s.name === target)?.state !== "shell";
          await typeInto(target, text, submit);
          // The HUD line says WHY it went there: which spoken words redirected
          // it, or that it followed the viewed session.
          const why = resolved.node ? ` (for ${resolved.node})` : address ? ` (you said “${address}”)` : "";
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
            summary.push(`no session or node "${spoken}"`);
            break;
          }
          if (resolved.node) {
            // A node is a place in the tree, not a session: viewing it
            // scopes the sidebar to that subtree.
            clientActions.push({ type: "scope", node: resolved.node });
            summary.push(`scoped the tree to ${resolved.node}`);
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
          const result = await spawnSession(String(a.node ?? ""), name);
          if (result.status !== 200) {
            summary.push(`spawn failed: ${result.error}`);
            break;
          }
          clientActions.push({ type: "view", session: name });
          summary.push(`spawned ${name} on ${a.node}`);
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
      sessions: ctx.sessions.map(({ name, state, node, kind }) => ({ name, state, node, kind })),
      paneTails: ctx.paneTails,
      visibleNodes: ctx.visibleNodes,
      allNodes: ctx.projectNodes,
      outcomes: ctx.outcomes,
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

/** Name hints for whisper: sessions plus visible node base names. */
function voiceNameHints(ctx) {
  const nodeNames = ctx.visibleNodes.map((p) => p.split("/").pop());
  return [...new Set([...ctx.sessions.map((s) => s.name), ...nodeNames])];
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (reloadController.handle(req, res, url)) return;
    if (url.pathname === "/api/sessions") {
      const sessions = await listSessions();
      reconcileOutcomes(sessions); // throttled fire-and-forget
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
      res.end(JSON.stringify({ root: TREES_ROOT, nodes: await readTree(TREES_ROOT) }));
      return;
    }
    // The launcher's index: per-node entries for search plus the unified map.
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
    if (url.pathname === "/api/outcome/brief" && req.method === "GET") {
      const file = url.searchParams.get("file") ?? "";
      const outcome = (await outcomesByFile()).get(file);
      if (!outcome) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no outcome file ${file}` }));
        return;
      }
      const context = await outcomeContext(outcome.node, outcome);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        outcome,
        markdown: await outcomePrompt(outcome.node, outcome),
        agent: withDefaultModel(await agentCmdForNode(outcome.node)),
        context,
      }));
      return;
    }
    if (url.pathname === "/api/outcome/discuss" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      try {
        const result = await startOutcome(String(body.file ?? ""), {
          phase: "understand",
          launch: body.launch === true,
        });
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.status === 200 ? result : { error: result.error }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    // The one spawn path: the visible "start agent" action on an outcome.
    if (url.pathname === "/api/outcome/start" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      try {
        const result = await startOutcome(String(body.file ?? ""), {
          phase: "execute",
          approved: body.approved === true,
          launch: body.launch === true,
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
    if (url.pathname === "/api/outcome/understanding" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const file = String(body.file ?? "");
      const understanding = typeof body.understanding === "string" ? body.understanding.trim() : "";
      const outcome = (await outcomesByFile()).get(file);
      if (!outcome) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no outcome file ${file}` }));
        return;
      }
      if (!understanding) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Write what you think this work means." }));
        return;
      }
      try {
        await editOutcomeFile(file, { understanding });
        await vaultCommit(
          [file],
          `update: ${outcome.node} outcome ${outcome.slug} records Julian's understanding`,
          outcome.node,
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
    if (url.pathname === "/api/outcome/accept" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      try {
        const result = await acceptOutcomeAssignment(String(body.file ?? ""));
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.status === 200 ? { ok: true } : { error: result.error }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    // The tree's create lane: a new outcome typed straight onto a node,
    // written on the user's word with a provenance commit, same as edits.
    if (url.pathname === "/api/outcome/new" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const node = String(body.node ?? "");
      const title = String(body.title ?? "").trim();
      const outcome = String(body.outcome ?? "").trim();
      if (!node || !flattenNodePaths(await readTree(TREES_ROOT)).includes(node)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no node "${node}"` }));
        return;
      }
      if (!title || !outcome) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: !title ? "a title is required" : "say what done looks like — an outcome without a done condition is not an outcome" }));
        return;
      }
      try {
        const file = await createOutcomeFile(node, { title, outcome, state: typeof body.state === "string" ? body.state : "" });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ file }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err.stderr ?? err.message ?? err) }));
      }
      return;
    }
    // The tree's edit lane: a status flip (mark done / reopen) or the
    // outcome's own text, written on the user's click with a provenance
    // commit. Direct edits are the user's word; no agent is in the loop.
    if (url.pathname === "/api/outcome/edit" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const file = String(body.file ?? "");
      const o = (await outcomesByFile()).get(file);
      if (!o) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no outcome file ${file}` }));
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
      for (const k of ["title", "outcome", "state"]) if (typeof body[k] === "string") fields[k] = body[k];
      if (!Object.keys(fields).length) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "nothing to edit" }));
        return;
      }
      try {
        await editOutcomeFile(file, fields);
        const changed = fields.status === "done"
          ? await cascadeOutcomeDone(file, await outcomesByFile())
          : [file];
        // The requested file may also carry title/outcome/state edits, or may
        // already have been done; it still belongs in this user-edit commit.
        if (!changed.includes(file)) changed.unshift(file);
        const what =
          fields.status === "done" ? "done" : fields.status === "open" ? "reopened" : "edited";
        await vaultCommit(changed, `update: ${o.node} outcome ${o.slug} ${what} in tree`, o.node, null);
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
        const result = await spawnSession(body.node, body.name);
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
    // Switches the orchestrator's agent command only; outcome sessions
    // always use their node-owned command (agentCmdForNode). The command is
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
        const visible = (req.headers["x-visible-nodes"] ?? "").split(",").filter(Boolean);
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
        const ctx = await voiceContext(focused, Array.isArray(body.visibleNodes) ? body.visibleNodes : []);
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
    } else if (url.pathname === "/legacy" || url.pathname === "/legacy/") {
      filePath = path.join(here, "public", "index.html");
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
    // heuristic caching once served a stale keymap.js against a fresh
    // index.html, silently unbinding a renamed action's chord.
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
