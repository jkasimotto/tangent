// Agent Shell prototype server.
// Serves the xterm.js frontend and bridges WebSocket connections to tmux
// sessions via node-pty. The "chat" session is the always-on agent shell;
// every other tmux session is a workspace the agent (or user) created.
import http from "node:http";
import os from "node:os";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import pty from "node-pty";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 4321);
let agentCmd = process.env.AGENT_CMD ?? "claude";
const CHAT_SESSION = process.env.CHAT_SESSION ?? "chat";
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
      "#{session_name}\t#{session_path}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{@tangent_node}\t#{@tangent_kind}\t#{pane_current_command}",
    ]);
    const sessions = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, cwd, windows, attached, created, node, kind, command] = line.split("\t");
        return {
          name,
          cwd,
          windows: Number(windows),
          attached: Number(attached) > 0,
          created: Number(created) * 1000,
          node: node || null,
          kind: kind || null,
          command,
          isChat: name === CHAT_SESSION,
        };
      });
    return await withAgentStates(sessions);
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
 * Sessions marked @tangent_kind=service (routine commands like a dev server)
 * skip the screen diff: a quiet server would read as a waiting agent. The
 * pane command is signal enough — a shell means the command exited.
 */
async function withAgentStates(sessions) {
  const now = Date.now();
  const out = await Promise.all(
    sessions.map(async (s) => {
      if (s.kind === "service") {
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
 * Resolves the working directory for a tree node from its node note's
 * `## Resources` section (a `Repository:` or `Worktree:` line), the same
 * lookup the chat agent performs when it opens sessions. Returns null when
 * the note records no usable directory.
 */
async function nodeDirectory(node) {
  const base = node.split("/").pop();
  let text;
  try {
    text = await readFile(path.join(TREES_ROOT, node, base + ".md"), "utf8");
  } catch {
    return null;
  }
  const resources = text.split(/^## /m).find((s) => s.startsWith("Resources"));
  const m = resources?.match(/(?:Repository|Worktree)[^:\n]*:\s*`?([^`\n]+?)`?\s*$/im);
  if (!m) return null;
  const dir = m[1].trim().replace(/^~(?=\/|$)/, os.homedir());
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/api/sessions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ agent: agentCmd, caffeinate: caffeinateProc !== null, sessions: await listSessions() })
      );
      return;
    }
    // The frontend must target the same chat session the server special-cases,
    // so the name ships as a tiny script instead of being hardcoded twice.
    if (url.pathname === "/config.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(`window.CHAT_SESSION = ${JSON.stringify(CHAT_SESSION)};\n`);
      return;
    }
    if (url.pathname === "/api/tree") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ root: TREES_ROOT, nodes: await readTree(TREES_ROOT) }));
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
    // Switches the orchestrator agent for the chat session. The command is
    // whatever the user typed (claude, claude-otto, agy, pi, flags allowed);
    // tmux runs a single trailing string through the shell. Kills the running
    // chat session so the frontend's reconnect respawns it with the new command.
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
    let filePath;
    if (url.pathname === "/" || url.pathname === "/index.html") {
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
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
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
    args.push(`exec ${shell} -ic '${agentCmd.replace(/'/g, "'\\''")}'`);
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

server.listen(PORT, () => {
  console.log(`agent-shell: http://localhost:${PORT}`);
  console.log(`  chat session "${CHAT_SESSION}" runs: ${agentCmd}`);
  console.log(`  workspace: ${WORKSPACE}`);
  if (!process.env.AGENT_SHELL_NO_OPEN) openStandaloneWindow();
});

/**
 * Opens (or focuses) the "Agent Shell" Safari web app so the UI lives in its
 * own window with a dock icon instead of a Chrome tab. The app is created
 * once by the user: open http://localhost:PORT in Safari, then
 * File > Add to Dock, named "Agent Shell". Until then, print that hint
 * instead of opening any browser.
 */
function openStandaloneWindow() {
  execFile("open", ["-a", "Agent Shell"], (err) => {
    if (err) {
      console.log(`  no "Agent Shell" app yet: open http://localhost:${PORT} in Safari,`);
      console.log(`  then File > Add to Dock and name it "Agent Shell".`);
      console.log(`  After that, npm start opens the app window automatically. (Set AGENT_SHELL_NO_OPEN=1 to skip.)`);
    }
  });
}
