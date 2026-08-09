// Agent Shell prototype server.
// Serves the xterm.js frontend and bridges WebSocket connections to tmux
// sessions via node-pty. The "chat" session is the always-on agent shell;
// every other tmux session is a workspace the agent (or user) created.
import http from "node:http";
import os from "node:os";
import { createHash } from "node:crypto";
import { appendFile, readFile, readdir } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

/**
 * The orchestrator command for a node's home agent. Agent identity is a
 * property of the node, not a global toggle: personal projects (otto/**)
 * run on the otto profile via the claude-otto alias, work nodes (neara,
 * pgande, ...) run the plain work-account claude. The switchable agentCmd
 * only ever applies to the chat session.
 */
function agentCmdForNode(node) {
  const top = String(node ?? "").split("/")[0];
  return top === "otto" ? "claude-otto" : "claude";
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
// matches. Addressing a tree node reaches that node's "home" agent session
// (spawned on demand, named after the node, @tangent_kind=home); the chat
// session is the root node's home. On any router failure the fallback is
// inert: the utterance is typed into the focused session, unsubmitted — a
// misheard or misrouted utterance can never fire an action on its own.

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

const ROUTER_SYSTEM = `You route commands for "agent shell", a terminal app whose tabs are tmux sessions running coding agents. Every project tree node can have a "home" agent session that organizes that node; the root node's home is the session named in chatSession. The user addresses agents by session name or by node name — a node name means that node's home agent, which the server spawns on demand, so you may target any node in the payload.

You get a JSON payload: the utterance (speech-to-text or typed), the focused session, all sessions (state: working = agent busy, waiting = agent finished or needs input, shell = plain shell, service/stopped = background command; kind: home = a node's home agent), the visible pane tail of relevant sessions, visibleNodes (the tree nodes the user can currently see in the sidebar — their mental model; prefer them when resolving names), and allNodes.

THE RULE ABOVE ALL OTHERS: you never write, rewrite, trim, or fix the user's words. Words meant for an agent travel verbatim through "say"; you only pick the destination and identify which leading words were the address. The server strips the address itself.

Reply with JSON only: {"actions":[...]}, at most 5 actions, executed in order. Action types:
- {"type":"say","target":"<session or node name as spoken, or \\"\\" for the focused session>","address":"<the exact leading words of the utterance that name the target, \\"\\" if none>"} — deliver the utterance (minus the address) to an agent. THE DEFAULT: anything that is not clearly a shell verb below is a say. An utterance opening with a session or node name and then instructing it ("megabranch, run the client build" / "PG&E run the daily speedrun") is addressed; everything else has target "" (the focused session). Target must be "" unless the utterance's own words name the target. NEVER infer a target from topic or content: a complaint or question about sessions, the shell, killing, or an agent goes to the focused session like anything else unless a name was actually said. The server enforces this — a say without address words always lands in the focused session.
- {"type":"keys","session":"<name>","keys":["Enter"]} — press special keys. Allowed: Enter, Escape, Tab, Up, Down, Left, Right, BSpace, Space, C-c, and single letters or digits like "y" or "2". Use for answering menus and permission prompts visible in the pane tail (send the matching option key) and for "stop" or "interrupt" (Escape, or C-c in a shell).
- {"type":"view","target":"<session or node name>"} — show that session in the app (a node name shows its home agent). For "show me X", "open X", "go to X", "switch to X".
- {"type":"close_view"} — leave the current session view, back to chat.
- {"type":"sidebar"} — toggle the project tree sidebar.
- {"type":"spawn","node":"<tree node path>","name":"<lowercase-hyphen-name>"} — create a plain work session on a project node. Only for a bare "new/open a session on X (called Y)" with nothing else attached. If the user states a goal, task, or any context in the same utterance, do NOT spawn: say the whole thing to that node's home agent instead, which does the richer setup.
- {"type":"kill","session":"<name>"} — destroy a session and everything in it. Only on an explicit kill or destroy request.
- {"type":"caffeinate","on":true} — keep the mac awake (or release it).
- {"type":"agent","cmd":"<command>"} — switch the chat session's agent command (for example "claude-otto" or "pi"). Only on an explicit request; it restarts chat. Node home sessions are unaffected: they always run their node's own agent.
- {"type":"speak","text":"one short sentence"} — answer out loud. Use for status questions ("who's waiting on me?" — summarize the waiting and working sessions from the payload) and to say why you did nothing.

Rules:
- Shell verbs fire only on a clear match. When torn between say and any non-destructive action, say. Never guess kill, agent, or spawn.
- Spoken names are fuzzy: "retry loop" means session "retry-loop", "PG&E" means the pgande node. Resolve against sessions first, then visibleNodes, then allNodes. Only reference sessions and nodes that exist in the payload.
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
  return { sessions, paneTails, projectNodes, visibleNodes: visibleNodes.filter((p) => projectNodes.includes(p)) };
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
 * node paths. "root" and "chat" are the root node's home, the chat session.
 * Returns {session} or {node} or null.
 */
function resolveTarget(spoken, ctx) {
  const n = normName(spoken ?? "");
  if (!n) return null;
  if (n === "root" || n === "chat") return { session: CHAT_SESSION };
  const sess = resolveSession(spoken, ctx.sessions);
  if (sess) return { session: sess };
  /** First path whose base name (else full path) matches the spoken name. */
  const byName = (paths) =>
    paths.find((p) => normName(p.split("/").pop()) === n) ?? paths.find((p) => normName(p) === n);
  const node = byName(ctx.visibleNodes) ?? byName(ctx.projectNodes);
  return node ? { node } : null;
}

/**
 * Finds or spawns a node's home agent session: named after the node, running
 * the node's own orchestrator command (agentCmdForNode) in the node's repo
 * (or its vault directory), marked @tangent_kind=home. Talking to a node
 * means talking to this session.
 */
async function ensureHomeSession(node, sessions) {
  // ponytail: home name = node basename; two nodes sharing a basename collide
  // on the first one's session — qualify with the parent if that ever bites.
  const name = normName(node.split("/").pop());
  if (sessions.some((s) => s.name === name)) return { name, fresh: false };
  const dir = (await nodeDirectory(node)) ?? path.join(TREES_ROOT, node);
  const shell = process.env.SHELL ?? "/bin/zsh";
  const cmd = withDefaultModel(agentCmdForNode(node));
  await execFileAsync("tmux", ["new-session", "-d", "-s", name, "-c", dir, `exec ${shell} -ic '${cmd.replace(/'/g, "'\\''")}'`]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_node", node]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_kind", "home"]);
  return { name, fresh: true };
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
 * only the page can perform (view, close_view, sidebar) are returned to it.
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
          // the focused session, whatever the router claims the target is.
          const address = String(a.address ?? "").trim();
          const text = stripAddress(utterance, address).slice(0, 4000);
          let resolved = address && a.target ? resolveTarget(a.target, ctx) : { session: focused };
          if (!resolved) {
            await typeInto(focused, utterance, false);
            summary.push(`no "${a.target}" — typed here, not sent`);
            break;
          }
          let target = resolved.session;
          if (resolved.node) {
            const home = await ensureHomeSession(resolved.node, sessions);
            target = home.name;
            if (home.fresh) {
              clientActions.push({ type: "view", session: target });
              // ponytail: fixed boot pause before typing into a fresh agent;
              // raise it if the TUI keeps eating the first words.
              await sleep(2500);
              await typeInto(target, text, false);
              summary.push(`started ${target} home — typed, not sent`);
              break;
            }
          }
          // Never auto-run prose at a bare shell prompt; agents get Enter.
          const submit = sessions.find((s) => s.name === target)?.state !== "shell";
          await typeInto(target, text, submit);
          // The HUD line says WHY it went there: which spoken words redirected
          // it, or that it followed focus.
          const why = address ? ` (you said “${address}”)` : "";
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
          let target = resolved.session;
          if (resolved.node) {
            const home = await ensureHomeSession(resolved.node, sessions);
            target = home.name;
            if (home.fresh) summary.push(`started ${target} home`);
          }
          clientActions.push({ type: "view", session: target });
          summary.push(`viewing ${target}`);
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
    if (url.pathname === "/api/sessions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ agent: agentCmd, caffeinate: caffeinateProc !== null, voice: Boolean(GROQ_KEY), sessions: await listSessions() })
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
    // Switches the orchestrator agent for the chat session only; node home
    // sessions always use their node-owned command (agentCmdForNode). The
    // command is whatever the user typed (claude, claude-otto, agy, pi, flags allowed);
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

server.listen(PORT, () => {
  console.log(`agent-shell: http://localhost:${PORT}`);
  console.log(`  chat session "${CHAT_SESSION}" runs: ${agentCmd}`);
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
