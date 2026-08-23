// Agent Shell prototype server.
// Serves the focus-and-return frontend and bridges WebSocket connections to
// tmux sessions through node-pty.
import http from "node:http";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doneCascade } from "./goal-cascade.mjs";
import { noteResource } from "./area-agent-command.mjs";
import { harnessEfforts, harnessModels, inheritedLaunch, modelEfforts, parseHarnessRegistry, resolveLaunch, upsertEnvironmentLaunch, upsertHarnessRegistry, validateHarnessRegistry } from "./launch-environment.mjs";
import { createArea, moveArea, areaHasGitChanges, previewAreaMove } from "./area-operations.mjs";
import { commandSession, programsSnapshot, saveLocalProgram } from "./programs.mjs";
import { documentHash, markdownTitle, safeMarkdownPath, wikiLinks } from "./vault-documents.mjs";
import { rationaleDossierContract } from "./rationale-dossier.mjs";
import documentComments from "./public/document-comments.js";
import areaMapCore from "./public/area-map-core.js";
import whatHappenedCore from "./public/what-happened-core.js";
import { createVaultGitReader, fileTimes } from "./area-map.mjs";
import { createFingerprintCache } from "./vault-index-cache.mjs";

import { classifyStaticPane, parseContextFill, stabilizeStaticPane, staticSinceOf } from "./pane-state.mjs";
import { appendSteps, currentStep, endPipeline, goalBindingGoneFromSnapshot, newPipeline, nextPendingStep, pipelineFinished, pipelineStatus, readAllPipelines, readPipeline, stepGoneFromSnapshot, validateSteps, writePipeline } from "./pipeline-record.mjs";
import { newContinuationRecord, readAllContinuations, readContinuation, writeContinuation } from "./continuation-record.mjs";
import { contextReminderText, contextRepeatText, continuationSection, continuationSessionName, reminderDue } from "./context-handover.mjs";
import { deliveryDecision, messageBanner, normalizeMessage } from "./agent-messages.mjs";
import { beginGeneration, brainForArea, brainRecordForArea, brainSessionName, currentGeneration, endBrain, latestHandover, newBrain, readAllBrains, readBrain, recordHandover, validateInstruction, writeBrain } from "./brain-record.mjs";
import { appendNotice, inboxesForBrain, markDelivered, mergeNotices, noticeBlock, noticeDigest, readAllInboxes, readInbox, writeInbox } from "./brain-inbox.mjs";
import { forJulianSectionText, parseForJulian, removeForJulianLine, restoreForJulianLine, unparsedForJulianLines } from "./for-julian.mjs";
import { createCommitChangeMonitor } from "./commit-change-monitor.mjs";
import { promptArrived, splitPrompt, squash } from "./prompt-delivery.mjs";
import { clearArmedPrompt, readAllArmedPrompts, writeArmedPrompt } from "./armed-prompts.mjs";
import { createRuntimeScheduler } from "./runtime-scheduler.mjs";
import { attachTerminalTransport } from "./terminal-transport.mjs";
import { serveStaticAsset } from "./static-assets.mjs";
import { createStateEvents } from "./state-events.mjs";
import { createBrainRoutes } from "./brain-routes.mjs";
import { answerBrainRequest, createBrainRequest, hasApprovedPlan, openBrainRequests, readBrainRequests, writeBrainRequests } from "./brain-requests.mjs";
import { createPipelineRoutes } from "./pipeline-routes.mjs";
import { createAgentRoutes } from "./agent-routes.mjs";
import { createVaultRepository } from "./vault-repository.mjs";
import { pipelineExecution, soloExecution } from "./execution-record.mjs";
import { createAreaRoutes } from "./area-routes.mjs";
import { createProgramRoutes } from "./program-routes.mjs";
import { createDocumentRoutes } from "./document-routes.mjs";
import { projectDesk } from "./desk-projection.mjs";
import { createShellControlRoutes } from "./shell-control-routes.mjs";
import { createShellStateRoutes } from "./shell-state-routes.mjs";
import { createVoiceRoutes } from "./voice-routes.mjs";
import { createGoalQueryRoutes } from "./goal-query-routes.mjs";
import { createLaunchRoutes } from "./launch-routes.mjs";
import { createWorkMutationRoutes } from "./work-mutation-routes.mjs";
import { recordActionTelemetry } from "./action-telemetry.mjs";
import { createRebuildOperations, readRebuildOperation, rebuildIsActive } from "./rebuild-operation.mjs";
import { readJson, sendJson } from "./http-json.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? "127.0.0.1";
// A fresh id per server process. The frontend compares it across polls to
// notice that a rebuilt server is live and offer one explicit reload.
const BOOT_ID = randomUUID();
const ACTION_TELEMETRY_LOG = process.env.AGENT_SHELL_ACTION_LOG ?? path.join(os.homedir(), ".tangent", "agent-shell-actions.jsonl");
const repoRoot = path.join(here, "..", "..", "..");
const rebuildStateFile = process.env.AGENT_SHELL_REBUILD_STATE ?? path.join(os.homedir(), ".tangent", "agent-shell-rebuild.json");
const rebuildLog = process.env.AGENT_SHELL_REBUILD_LOG ?? path.join(os.homedir(), ".tangent", "agent-shell-rebuild.log");
const priorRebuild = await readRebuildOperation(rebuildStateFile);
const carriedRevision = rebuildIsActive(priorRebuild) && ["restarting", "reconnecting"].includes(priorRebuild.phase) ? priorRebuild.targetCommit : "";
const commitChanges = await createCommitChangeMonitor({ root: repoRoot, deployedCommit: carriedRevision });
const rebuildOperations = createRebuildOperations({
  file: rebuildStateFile,
  root: repoRoot,
  log: rebuildLog,
  bootId: BOOT_ID,
  /** Reads the commit range at the exact rebuild start boundary. */
  revisions: () => commitChanges.status(),
});
const stateEvents = createStateEvents();
let agentCmd = process.env.AGENT_CMD ?? "claude";

/**
 * Reads the machine-wide harness registry from the vault root Document
 * (~/.tangent/trees/harnesses.md). An empty registry is valid: launches
 * then rely on legacy `- Agent:` lines and the profile fallback.
 */
async function harnessRegistry() {
  const text = await readFile(path.join(TREES_ROOT, "harnesses.md"), "utf8").catch(() => "");
  return parseHarnessRegistry(text) ?? { modelSets: {}, effortSets: {}, harnesses: [] };
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
/** Runs one Git command for the vault repository boundary. */
const runRepositoryGit = (args) => execFileAsync("git", args);
const vaultRepository = createVaultRepository({ root: TREES_ROOT, runGit: runRepositoryGit });
/** Per-file git times and agent runs for the vault, cached by HEAD (design-area-map Decision 9, design-goal-cards Decision 1). */
const vaultGit = createVaultGitReader(TREES_ROOT);
/**
 * Where the Area map keeps node positions and filters per Area. Shell state,
 * not knowledge, so it lives outside the vault (design-area-map Decision 7).
 */
const MAP_STATE_ROOT = process.env.TANGENT_MAP_STATE_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "map-state");
// One JSON record per Goal with a pipeline: its steps, their sessions, and
// the handovers between them. Ownership stays in the Goal file; this holds
// only what neither the Goal nor tmux can.
const PIPELINES_ROOT = process.env.TANGENT_PIPELINES_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "pipelines");
// One JSON record per Goal for a solo (non-pipeline) session's context
// continuations: the same mechanism pipeline steps keep inline on the step
// (design-worker-context-handover D6).
const CONTINUATIONS_ROOT = process.env.TANGENT_CONTINUATIONS_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "continuations");
// One JSON record per Area with a brain: Julian's instruction, the launch,
// the generations, and their self-handovers (design-area-brain-solution).
const BRAINS_ROOT = process.env.TANGENT_BRAINS_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "brains");
// After this long in one generation the brain is reminded to hand over.
const BRAIN_REFRESH_MS = Number(process.env.TANGENT_BRAIN_REFRESH_MINUTES ?? 90) * 60_000;
// A running step idle this long without a handover is reported to the brain once.
const BRAIN_IDLE_NOTICE_MS = Number(process.env.TANGENT_BRAIN_IDLE_MINUTES ?? 10) * 60_000;
// A running step's pane sitting this long at a decision menu or an unsent
// draft is reported to the brain once (Julian, 2026-08-22): the classifier
// has false positives, so a step that answers itself within the threshold
// must never notify.
const BRAIN_WAIT_NOTICE_MS = Number(process.env.TANGENT_BRAIN_WAIT_MINUTES ?? 5) * 60_000;
// The carried-context threshold at which a worker is reminded to hand its
// step to a fresh copy of itself (design-worker-context-handover D3). One
// absolute token count, never a percentage: a model whose window is at or
// under this just uses its full window, today's behavior.
const CONTEXT_HANDOVER_TOKENS = Number(process.env.TANGENT_CONTEXT_HANDOVER_TOKENS ?? 300_000);

/** The one-sentence teaching line in every worker prompt: D1 C, the prompt teaches the verb, Tangent is the trigger. */
function contextTeachingSentence(subject) {
  const threshold = Math.round(CONTEXT_HANDOVER_TOKENS / 1000);
  return `If your carried context passes ${threshold}k tokens before you finish, hand this ${subject} to a fresh copy of yourself at a natural pause: tangent goal handover --continue "<facts written for a fresh agent>"; Tangent also reminds you when it sees your fill.`;
}
// One JSON record per session with a prompt armed to type once its harness
// leaves the shell (armSession below), so the arm survives a server restart
// between typing the launch command and the harness coming up. Rules and
// file shape live in armed-prompts.mjs.
const ARMED_ROOT = process.env.TANGENT_ARMED_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "armed");

if (!existsSync(WORKSPACE)) mkdirSync(WORKSPACE, { recursive: true });

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
      "#{session_name}\t#{session_path}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{@tangent_area}\t#{@tangent_kind}\t#{@tangent_goal}\t#{@tangent_process}\t#{pane_current_command}\t#{@tangent_phase}\t#{@tangent_work_title}\t#{@tangent_launch}\t#{@tangent_pipeline}\t#{@tangent_step}\t#{@tangent_brain}\t#{@tangent_generation}",
    ]);
    const sessions = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, cwd, windows, attached, created, area, kind, goal, processName, command, phase, workTitle, launchLabel, pipeline, step, brain, generation] = line.split("\t");
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
          pipeline: pipeline || null,
          step: step ? Number(step) : null,
          brain: brain || null,
          generation: generation ? Number(generation) : null,
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
const WAIT_STABLE_MS = 8_000; // generic static panes must remain quiet before demanding attention
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
 * The cursor position of a session's active pane, for the empty-composer
 * test. Reads are passive; a failure degrades to (0,0), which classifies as
 * plain waiting rather than idle, so delivery stays conservative.
 */
async function paneCursor(name) {
  try {
    const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", "=" + name + ":", "#{cursor_x} #{cursor_y}"]);
    const [x, y] = stdout.trim().split(/\s+/).map(Number);
    return { cursorX: Number.isFinite(x) ? x : 0, cursorY: Number.isFinite(y) ? y : 0 };
  } catch {
    return { cursorX: 0, cursorY: 0 };
  }
}

/**
 * Classifies one session by comparing the pane hash against the previous
 * poll's sample in `paneSamples`. Polls closer than MIN_SAMPLE_MS return the
 * cached sample, so extra clients cannot mask repaints. A static screen is
 * refined by pane-state.mjs into detail: "decision" (a dialog waits on a
 * choice, with its question), "idle" (empty composer), "draft" (unsent
 * composer text), or null (static but unrecognized). The wire state stays
 * working|waiting|shell; detail rides beside it as stateDetail.
 */
async function classifyState(name, command, now) {
  const prev = paneSamples.get(name);
  if (SHELL_CMDS.has(command)) {
    const shellSince = prev?.state === "shell" ? prev.staticSince ?? now : now;
    paneSamples.set(name, { hash: "", at: now, state: "shell", detail: null, question: "", staticSince: shellSince, context: null });
    return { state: "shell", detail: null, question: "", idleSince: null, waitingSince: shellSince, context: null };
  }
  if (prev && now - prev.at < MIN_SAMPLE_MS) {
    const cachedWait = prev.state === "waiting" || prev.state === "shell" ? prev.staticSince ?? null : null;
    return { state: prev.state, detail: prev.detail ?? null, question: prev.question ?? "", idleSince: prev.idleSince ?? null, waitingSince: cachedWait, context: prev.context ?? null };
  }
  const { stdout: text } = await execFileAsync("tmux", ["capture-pane", "-p", "-t", "=" + name + ":"]);
  const hash = createHash("sha1").update(text).digest("hex");
  const context = parseContextFill(text);
  let state = !prev || prev.state === "shell" || hash !== prev.hash ? "working" : "waiting";
  let detail = null;
  let question = "";
  let quietSince = null;
  if (state === "waiting") {
    const classified = classifyStaticPane({ text, ...(await paneCursor(name)) });
    const stable = stabilizeStaticPane({
      classification: classified,
      quietSince: prev?.hash === hash ? prev?.quietSince : null,
      now,
      thresholdMs: WAIT_STABLE_MS,
    });
    const refined = stable.classification;
    quietSince = stable.quietSince;
    if (refined.kind === "working") state = "working";
    else if (refined.kind !== "waiting") {
      detail = refined.kind;
      question = refined.question ?? "";
    }
  }
  // idleSince: when the pane first went quiet at an empty composer, kept
  // while it stays so; the desk uses it to offer "send on" after a while.
  const idleSince = state === "waiting" && (detail === "idle" || detail === null) ? (prev?.idleSince ?? now) : null;
  // staticSince: when the pane stopped changing, whatever the detail. It is
  // the start of "waiting for you" on the Goal card; quietSince covers only
  // the unrecognized static pane and its stable-wait delay.
  const staticSince = staticSinceOf({ previous: prev, hash, now });
  paneSamples.set(name, { hash, at: now, state, detail, question, idleSince, quietSince, staticSince, context });
  return { state, detail, question, idleSince, waitingSince: state === "waiting" ? staticSince : null, context };
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
        return { ...s, state: SHELL_CMDS.has(s.command) ? "stopped" : "service", stateDetail: null, stateQuestion: "", context: null };
      }
      try {
        const { state, detail, question, idleSince, waitingSince, context } = await classifyState(s.name, s.command, now);
        return { ...s, state, stateDetail: detail, stateQuestion: question, idleSince: idleSince ?? null, waitingSince: waitingSince ?? null, context: context ?? null };
      } catch {
        return { ...s, state: null, stateDetail: null, stateQuestion: "", context: null };
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

let caffeinateProc = null; // running `caffeinate -is` child, or null

/**
 * Starts or stops a `caffeinate -is` child, the header's keep-awake toggle
 * for long agent runs. `-i` blocks idle system sleep and `-s` covers AC with
 * the lid closed, so agents keep running; deliberately no `-d`, so the
 * display still sleeps and locks on the normal schedule. `-w` ties the
 * assertion to this server's lifetime, so quitting the shell can never leave
 * the machine stuck awake.
 */
function setCaffeinate(on) {
  if (on && !caffeinateProc) {
    caffeinateProc = spawn("caffeinate", ["-is", "-w", String(process.pid)], { stdio: "ignore" });
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
      documents.push({
        file, area, kind: "document", title: markdownTitle(text, name.slice(0, -3)),
        mtime: info.mtimeMs, hash: documentHash(text), links: wikiLinks(text),
        commentCount: documentComments.parseComments(text).length,
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
  return text == null ? null : { ...metadata, text, hash: documentHash(text), comments: documentComments.parseComments(text) };
}

/** Tests one wiki target against a record path or its short stem. */
function linkTargetsRecord(target, record) {
  if (!record) return false;
  const link = String(target ?? "").replace(/\.md$/i, "").replaceAll("\\", "/");
  const recordPath = record.file.replace(/\.md$/i, "");
  return link.includes("/") ? link === recordPath : path.basename(link) === path.basename(recordPath);
}

/** Writes one Document atomically and commits only that path. */
async function writeVaultDocument(current, text, message, tmuxSession = null) {
  await vaultRepository.writeAndCommit(current.file, text, message, current.area, tmuxSession);
  return { ...current, text, hash: documentHash(text), comments: documentComments.parseComments(text) };
}

/** Conflict-safe, atomic replacement of an existing indexed Markdown file. */
async function saveVaultDocument(file, text, baseHash, summary = "edited in tree") {
  const current = await readVaultDocument(file);
  if (!current) return { status: 404, error: `no document ${file}` };
  if (!baseHash || baseHash !== current.hash) {
    return { status: 409, error: "document changed since it was opened", current };
  }
  const what = String(summary || "edited in tree").replace(/\s+/g, " ").trim().slice(0, 80);
  const document = await writeVaultDocument(current, text, `update: ${current.area} ${current.kind} ${path.basename(file, ".md")} ${what}`);
  return { status: 200, document };
}

/**
 * Tells the nearest live brain that Julian finished adding comments to one
 * Document. This is explicit: saving or editing a comment sends nothing.
 */
async function notifyBrainOfDocumentComments(file) {
  const document = await readVaultDocument(file);
  if (!document) return { status: 404, error: `no document ${file}` };
  if (!document.comments.length) return { status: 409, error: "This Document has no open comments." };
  const brain = await nearestLiveBrainForArea(document.area);
  if (!brain) return { status: 409, error: `No active brain covers ${document.area}.` };
  const count = document.comments.length;
  await notifyBrain(brain.area, `Julian added comments to ${document.file} (${count} open ${count === 1 ? "comment" : "comments"}). Read them with tangent document comments ${document.file}.`);
  return { status: 200, value: { ok: true, brain: brain.area, comments: count } };
}

/**
 * The only agent path that removes a comment (design-comment-on-documents,
 * decision 5): exactly one comment must start with the given words, and the
 * removal is its own named commit, so nothing is lost silently.
 */
async function resolveVaultDocumentComment(file, prefix, note, tmuxSession) {
  const current = await readVaultDocument(file);
  if (!current) return { status: 404, error: `no document ${file}` };
  const result = documentComments.resolveComment(current.text, prefix);
  if (result.error) return { status: result.matches.length ? 409 : 404, error: result.error, matches: result.matches };
  const words = result.comment.text.split(/\s+/).slice(0, 6).join(" ");
  const message = `resolve: ${current.area} ${path.basename(file, ".md")} "${words}"` + (note ? `\n\n${String(note).trim()}` : "");
  const document = await writeVaultDocument(current, result.text, message, tmuxSession || null);
  return { status: 200, document, comment: result.comment };
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
 * Returns { areas, map }: the per-area entries for typed search, plus the
 * unified deduplicated map (built below) that the launcher's browse view
 * renders. Reads every Markdown file in the vault, so callers use the cached
 * `vaultIndex` below rather than this function.
 */
async function buildVaultIndex() {
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
    const noteMtime = await stat(path.join(TREES_ROOT, noteFile)).then((s) => s.mtimeMs, () => null);
    // An Area without a note keeps a record (the shell reads area.note) marked
    // missing, so the map and the chips leave it out.
    records.push({ file: noteFile, area: n.path, kind: "note", title: markdownTitle(note, n.name), links: wikiLinks(note), mtime: noteMtime ?? 0, missing: noteMtime === null });
    for (const o of own) {
      const text = await readFile(path.join(TREES_ROOT, o.file), "utf8").catch(() => "");
      records.push({ file: o.file, area: o.area, kind: "goal", title: o.title, status: o.status, links: wikiLinks(text), searchText: o.searchText, mtime: o.mtime, goal: o });
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
  // Area map facts on every record: file-name kind, git times, and link
  // degrees. Goals carry the same facts on their index object so the desk and
  // the map rank one way (design-area-map Decisions 9, 10, 13).
  areaMapCore.assignKinds(records);
  const { times: gitTimes, runs: gitRuns, closes: gitCloses } = await vaultGit();
  for (const record of records) {
    const { createdAt, changedAt } = fileTimes(record.file, record.mtime, gitTimes);
    record.createdAt = createdAt;
    record.changedAt = changedAt;
    record.inDegree = record.backlinks.length;
    record.outDegree = record.links.filter((target) => {
      const hit = target.includes("/") ? byTarget.get(target.replace(/\.md$/i, "")) : byStem.get(path.basename(target));
      return hit && hit.file !== record.file;
    }).length;
    if (record.goal) {
      // The agents that ever worked this Goal, when the work started, and when
      // it last ended: the facts line of the Goal card (design-goal-cards).
      const run = gitRuns.get(record.file);
      Object.assign(record.goal, { docKind: record.docKind, createdAt, changedAt, inDegree: record.inDegree, outDegree: record.outDegree, agents: run?.agents ?? [], firstStartAt: run?.firstStartAt ?? null, lastEndAt: run?.lastEndAt ?? null });
      delete record.goal;
    }
  }
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
      .map((record) => ({ file: record.file, title: record.title, kind: record.kind, docKind: record.docKind, changedAt: record.changedAt }));
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
      parent: areaMapCore.parentOf(n.path),
      children: n.children.map((child) => child.path),
      status: fm.status || "",
      type: fm.type || "",
      purpose: noteSection(note, "Purpose").split("\n")[0] ?? "",
      current: noteSection(note, "Current").split(/\n\s*\n/)[0]?.trim() ?? "",
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
  // A 12-hour window of closes, windowed again in the browser at render time
  // with its own clock so rows age out between vault commits
  // (design-done-goals-timeline, Decision 6).
  const recentCloses = whatHappenedCore.windowCloses(gitCloses, Date.now());
  return { areas: out, map: groups, documents: records, recentCloses };
}

/**
 * A string that changes whenever the vault index would change: the path, size,
 * and modification time of every Markdown file the index reads, plus the size
 * and modification time of the vault reflog, because the index also carries
 * git times and agent runs that only a commit changes, plus every Area
 * directory, because a directory is an Area even when it holds no file. One
 * `readdir` per Area and one `stat` per file, some 50 times cheaper than a
 * build.
 */
async function vaultFingerprint(dir = TREES_ROOT, rel = "") {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return "";
  }
  const parts = [];
  if (!rel) {
    const reflog = await stat(path.join(TREES_ROOT, ".git", "logs", "HEAD")).catch(() => null);
    parts.push(`git:${reflog ? `${reflog.mtimeMs}:${reflog.size}` : "none"}`);
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (TREE_SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      // A directory is an Area even with no Markdown file in it.
      parts.push(`dir:${childRel}`, await vaultFingerprint(absolute, childRel));
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    const info = await stat(absolute).catch(() => null);
    if (info) parts.push(`${rel}/${entry.name}:${info.mtimeMs}:${info.size}`);
  }
  return parts.join("\n");
}

/**
 * The vault index every Document, Goal, and map request reads, built once per
 * vault change instead of once per request. See vault-index-cache.mjs for why.
 */
const vaultIndex = createFingerprintCache({ fingerprint: vaultFingerprint, build: buildVaultIndex });

/** True for a vault-relative Area path with no traversal. */
function validAreaPath(area) {
  return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(area) && !area.split("/").includes("..");
}

/** The JSON file that stores one Area's map state. */
function mapStateFile(area) {
  return path.join(MAP_STATE_ROOT, `${area.replaceAll("/", "__")}.json`);
}

/** Reads one Area's stored map state, or an empty object. */
async function readMapState(area) {
  if (!validAreaPath(area)) return {};
  try {
    return JSON.parse(await readFile(mapStateFile(area), "utf8"));
  } catch {
    return {};
  }
}

/** Writes one Area's map state atomically. */
async function writeMapState(area, mapState) {
  mkdirSync(MAP_STATE_ROOT, { recursive: true });
  const file = mapStateFile(area);
  await writeFile(`${file}.tmp`, JSON.stringify(mapState), "utf8");
  await rename(`${file}.tmp`, file);
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
  let text = await readFile(path.join(TREES_ROOT, file), "utf8");
  text = withFrontmatterLine(text, "status", status);
  text = withFrontmatterLine(text, "session", session);
  if (waitingOn !== undefined) text = withFrontmatterLine(text, "waiting_on", waitingOn);
  await vaultRepository.writeMarkdown(file, text);
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
async function editGoalFile(file, { status, session, title, doneWhen, state, understanding, currentBrief, story, wontDoReason }) {
  const abs = path.join(TREES_ROOT, file);
  let text = await readFile(abs, "utf8");
  if (status !== undefined) {
    text = withFrontmatterLine(text, "status", status);
    if (["done", "dropped"].includes(status)) {
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
  if (wontDoReason !== undefined) {
    const stateMatch = text.match(/^## State[^\n]*\n+([\s\S]*?)(?=^## |\s*$)/m);
    const previousState = stateMatch?.[1]?.trim() ?? "";
    const decision = `### Won't do\n\n${oneLine(wontDoReason)}`;
    text = replaceNoteSection(text, "State", [decision, previousState].filter(Boolean).join("\n\n"));
  }
  await vaultRepository.writeMarkdown(file, text);
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

/**
 * Sets an Area's status (`done` or `active`) in its note frontmatter on
 * Julian's word (design-area-map Decision 11). Goals are not touched. Creates
 * the note when the Area has none. Returns the open Goals that stay open and
 * hidden with the Area, so the caller can say so.
 */
async function setAreaStatus(area, status, tmuxSession) {
  const file = areaNoteFile(area);
  const absolute = path.join(TREES_ROOT, file);
  const text = await readFile(absolute, "utf8").catch(() => emptyAreaNote(area));
  const next = withFrontmatterLine(text, "status", status);
  await vaultRepository.writeMarkdown(file, next);
  await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", file]).catch(() => {});
  await vaultCommit([file], `update: ${area} area ${status === "done" ? "done" : "reopened"}`, area, tmuxSession);
  const openGoals = (await readAreaGoalsDeep(area)).filter((goal) => !["done", "dropped", "deferred"].includes(goal.status));
  return { file, status, openGoals: openGoals.length };
}

/** Every Goal stored in an Area or any Area inside it. */
async function readAreaGoalsDeep(area) {
  const goals = [];
  /** Collects the Goals of one directory and every Area directory inside it. */
  const walk = async (dir, rel) => {
    goals.push(...await readAreaGoals(rel));
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch {}
    for (const entry of entries) {
      if (!entry.isDirectory() || TREE_SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      await walk(path.join(dir, entry.name), `${rel}/${entry.name}`);
    }
  };
  await walk(path.join(TREES_ROOT, area), area);
  return goals;
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
    await vaultRepository.writeMarkdown(file, text);
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
    await vaultRepository.writeMarkdown(record.file, renderNewGoal(record));
  }
  const noteFile = await addGoalToArea(area, goalSlug);
  const changed = [...records.map((record) => record.file), noteFile];
  await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", ...changed]).catch((err) => {
    console.error(`goal stage failed: ${changed.join(", ")}: ${String(err.stderr ?? err.message ?? err).slice(0, 200)}`);
  });
  await vaultCommit(changed, `add: ${area} goal ${goalSlug} from Agent Shell`, area, null);
  return { file: records[0].file, files: records.map((record) => record.file) };
}

/** Creates one Goal through the shared Goal-and-Subgoals path. */
async function createGoalFile(area, { title, doneWhen, state }) {
  const created = await createGoalSet(area, { goal: { title, doneWhen, state } });
  return created.file;
}

/** Parses idea lines out of an Area note's Ideas and open questions section, in order. */
function ideasFromNote(text) {
  return noteSection(text, "Ideas and open questions")
    .split("\n")
    .map((line) => line.match(/^-\s*Idea:\s*(.+)$/))
    .filter(Boolean)
    .map((match) => match[1].trim());
}

/** Reduces one readAreaGoals() entry to the compact shape the tangent goal CLI lists. */
function goalSummary(goal) {
  return { slug: goal.slug, file: goal.file, area: goal.area, title: goal.title, status: goal.status, doneWhen: goal.doneWhen };
}

/** Saves a natural work description as an idea without creating goals. */
async function saveWorkIdea(area, description) {
  const file = areaNoteFile(area);
  const absolute = path.join(TREES_ROOT, file);
  let text = await readFile(absolute, "utf8").catch(() => emptyAreaNote(area));
  const current = noteSection(text, "Ideas and open questions");
  const next = [current, `- Idea: ${oneLine(description)}`].filter(Boolean).join("\n");
  text = replaceNoteSection(text, "Ideas and open questions", next);
  await vaultRepository.writeMarkdown(file, text);
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
  await vaultRepository.commit(relPaths, message, area, tmuxSession);
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
    commentCounts: linked.map((d) => d.commentCount ?? 0),
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
    `Julian described work for this Area. Help him turn it into work that starts well.\n\n` +
    `## Area\n\n${area}\n\n` +
    `## Julian's description\n\n${description}\n\n` +
    `## Sources\n\n${sourceLines.join("\n") || "- No source notes or Documents were found."}\n\n` +
    `## How to work\n\n` +
    `Read the Area notes from nearest to farthest and each listed Document. When code answers a question better than a guess, look at the Area's repository. Related Goals and Documents already in the Area folder show what exists; prefer updating existing work over duplicating it.\n\n` +
    `Two good outcomes:\n\n` +
    `- The work is small and clear: create the Goal yourself (\`tangent goal create --area ${area} ... --own\`), say in a line what you are doing, and do it now.\n` +
    `- The work is bigger or splits into parts: gather context, talk with Julian where his intent is genuinely unclear, and create Goals that give a fresh agent a great launchpad: the intent, what Julian already decided, and pointers to the Documents and code that matter (link each with \`--source\`). The fresh agent scopes the details itself and can ask its own questions. What wastes Julian's time is explaining the same thing twice, so put what he told you into each Goal's description.\n\n` +
    `The judgment between the two is yours. Lean toward doing trivial things immediately and leaving real work well-framed for later. An Area holds a durable subject, a Goal a desired change with a clear finish, and a Subgoal only a separately focusable step that answers “To do that” for its parent; independently startable results are separate top-level Goals.`
  );
}

/**
 * The exact assignment shown before execution and typed into the selected
 * harness. Markdown keeps the contract readable in both the shell and the
 * agent composer.
 */
async function goalPrompt(area, o, extras = [], continuationEntries = []) {
  const context = await goalContext(area, o);
  const sources = [
    `- Goal: ${context.goalFile}`,
    ...context.notes.map((note, index) => `- Area note ${index + 1}: ${note}`),
    ...context.documents.map((document, index) => `- Document: ${document}${context.commentCounts[index] ? ` (${context.commentCounts[index]} open comment${context.commentCounts[index] === 1 ? "" : "s"} from Julian)` : ""}`),
  ];
  const openComments = context.commentCounts.some(Boolean);
  const brain = await liveBrainForArea(area);
  const brainSection = brain
    ? `## Brain\n\n` +
      `The brain for Area ${brain.area} controls this work. Do the assignment. Do not create, start, close, or re-plan Goals. Do not contact Julian or choose another agent. Report only to the brain with the handover command below.\n\n`
    : "";
  const alsoOwned = extras.length
    ? `## Also in this session\n\n` +
      `Julian assigned these Goals to this session too. Work them after the assignment above, in order; each file holds its own context.\n\n` +
      extras.map((extra) => `- ${extra.title}: done when ${extra.doneWhen || "see the Goal file"} (${path.join(TREES_ROOT, extra.file)})`).join("\n") +
      `\n\n`
    : "";
  return (
    `# Assignment: ${o.title}\n\n` +
    `## Done when\n\n${o.doneWhen || "Read the Goal file for the done condition."}\n\n` +
    (o.myUnderstanding ? `## Julian's understanding\n\n${o.myUnderstanding}\n\n` : "") +
    `## Sources\n\n${sources.join("\n")}\n\n` +
    alsoOwned +
    brainSection +
    `## How to work\n\n` +
    `This Goal was already scoped with Julian. Its file holds what he explained, so he does not need to repeat it. Pick up the work directly, scope the details yourself, and bring him real decisions when they come up. There is no need to re-confirm the assignment before starting.\n\n` +
    `Read the goal first, then the area notes from nearest to farthest.` +
    (context.documents.length
      ? ` Read each linked Document; before writing design prose, read ${path.join(os.homedir(), ".agents", "skills", "simple-english", "SKILL.md")} (pragmatic mode, with its self-check).`
      : "") +
    (o.subgoals.length ? ` The Subgoals are ordered; work through them in order.` : "") +
    `\n\n` +
    (openComments
      ? `Julian left comments in the Documents marked above. They look like \`{>>Julian: ...<<}\`, sometimes after \`{==the words they refer to==}\`. Read them before you change a Document, and do what they ask or discuss them with Julian. \`tangent document comments <vault-relative file>\` lists them. Close each one only with \`tangent document resolve <file> "<first words of the comment>" -m "<what changed>"\`, after the work is done or after Julian says to close it. Never remove or rewrite a comment by hand, and carry comments along when you rewrite the text around them.\n\n`
      : "") +
    `Useful habits here: check \`tangent process list\` before starting a server or watcher. When the done condition is met, report the proof to the brain. The brain controls Goal state.\n\n` +
    `Design documents for this work belong in the Area folder ${path.join(TREES_ROOT, area)} as design-<slug>.md (a solution beside it as impl-<slug>.md), in Simple English (${path.join(os.homedir(), ".agents", "skills", "simple-english", "SKILL.md")}, pragmatic mode), with a [[${o.file.split("/").pop().replace(/\.md$/, "")}]] link so the Goal shows them. Read files wherever they are; write new design documents there.\n\n` +
    contextTeachingSentence("Goal") +
    (continuationEntries.length ? `\n\n${continuationSection({ index: 1, total: 1, entries: continuationEntries, subject: "Goal" })}` : "")
  );
}

/**
 * The first message of one pipeline step: the Goal assignment, this step's
 * instruction, every earlier handover verbatim (facts from earlier agents),
 * and how to hand over when done. Guidance, not a schema.
 */
async function pipelineStepPrompt(area, o, record, index, extras = [], sessionName = "") {
  const assignment = await goalPrompt(area, o, extras);
  const step = record.steps[index - 1];
  const total = record.steps.length;
  const earlier = record.steps
    .filter((item) => item.index < index && item.handover)
    .map((item) => `### Handover from step ${item.index} (${item.label || "agent"}, ${item.status})\n\n${item.handover}`);
  const brain = await liveBrainForArea(area);
  const decisionLine = brain
    ? `If you need a decision, test, correction, fresh context, or another agent, include that fact in the same handover. The brain decides the next action.`
    : `If a real decision needs Julian, ask him here; this legacy pipeline waits.`;
  const dossierContract = rationaleDossierContract({ goalFile: o.file, title: o.title, area, treesRoot: TREES_ROOT, session: sessionName });
  const continuationEntries = step.continuations ?? [];
  return (
    `${assignment}\n\n` +
    `## Your step\n\n` +
    `Step ${index} of ${total}${total > 1 ? " in a pipeline" : ""}: ${step.instruction}\n\n` +
    (earlier.length ? `## Handovers so far\n\n${earlier.join("\n\n")}\n\n` : "") +
    (continuationEntries.length ? `${continuationSection({ index, total, entries: continuationEntries, subject: "step" })}\n\n` : "") +
    `## When you finish\n\n` +
    `${dossierContract}\n\n` +
    `Run \`tangent handover "<facts>"\` from this session. State files and commits, checks and results, what is complete, what is unresolved, and any decision or test that is needed. This operation reports to the brain; it does not choose the next agent. ${decisionLine} ${brain ? "If your context is nearly full, hand over that fact through the same command." : contextTeachingSentence("step")}`
  );
}

/** The contract for one native-agent collaboration around a complete Goal. */
async function collaborationPrompt(area, o, documentFile = "", extras = []) {
  const assignment = await goalPrompt(area, o, extras);
  const focus = documentFile ? await readVaultDocument(documentFile) : null;
  const documentFocus = focus
    ? `## Current reading location\n\nJulian is reading ${focus.file}. Use this location to interpret references such as “this section.” It does not limit the feedback to one Document.\n\n`
    : "";
  return (
    `# Work with Julian\n\n` +
    `This session covers the ${extras.length ? "assigned Goals" : "complete Goal"} and all linked Documents. Julian can ask questions, give feedback, request Document edits, or describe new work; infer the useful response from his words rather than asking him to classify them.\n\n` +
    `Read the source context before you respond, and research facts yourself. Bring Julian one real decision at a time; he owns choices that change meaning, scope, trade-offs, or proof. When the work is already well defined, get to it; when he is thinking out loud, think with him.\n\n` +
    `You can edit linked Documents when Julian requests or accepts a change. If feedback turns into separate work, shape it into a Goal with him. Keep the goal State section current with the headings that help: Goal, Settled decisions, Deferred, Proof, and Unresolved decisions.\n\n` +
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
const armedSessions = new Map(); // session -> { phase, submit, document, prompt }

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
 * so the far end is what proves the remainder arrived, unless the harness
 * collapsed the remainder into a pasted-text marker (Claude Code does for any
 * large input); prompt-delivery.mjs holds both rules.
 *
 * Returns true when the whole prompt showed in the pane, false when the
 * session was gone, sat at a shell, or never took the whole prompt. A brain
 * notice counts as read only on true.
 */
async function typePromptWhenReady(session, prompt, submit = false, label = "agent prompt") {
  const startedAt = Date.now();
  /** Records delivery latency without the session name or prompt content. */
  const measured = (ok) => {
    recordActionTelemetry(ACTION_TELEMETRY_LOG, { kind: "delivery", action: label, durationMs: Date.now() - startedAt, ok }).catch(() => {});
    return ok;
  };
  try {
    const { probe, rest } = splitPrompt(prompt);
    for (let attempt = 1; attempt <= TYPE_ATTEMPTS; attempt++) {
      if (!(await waitForHarnessReady(session))) return measured(false);
      await typeInto(session, probe, false);
      await sleep(ECHO_MS);
      if ((await paneText(session)).includes(squash(probe))) {
        await typeInto(session, rest, false);
        await sleep(ECHO_MS);
        if (promptArrived(await paneText(session), prompt)) {
          if (submit) await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "Enter"]);
          return measured(true);
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
  return measured(false);
}

/** Types a Goal assignment after its native harness is ready. */
async function typeGoalPromptWhenReady(session, area, file, phase = "execute", submit = false, documentFile = "", extraFiles = []) {
  const goals = await readAreaGoals(area);
  const o = goals.find((t) => t.file === file);
  if (!o) return false;
  const extras = (extraFiles ?? []).map((extra) => goals.find((t) => t.file === extra)).filter(Boolean);
  const prompt = phase === "collaborate" ? await collaborationPrompt(area, o, documentFile, extras) : await goalPrompt(area, o, extras);
  return typePromptWhenReady(session, prompt, submit, "goal prompt");
}

/**
 * One arming pass: fires the prompt for every armed session whose pane has
 * left the shell, and forgets sessions that died. Armed sessions are the only
 * ones looked at, so a Goal session in ordinary use costs nothing.
 *
 * The persisted record (armed-prompts.mjs) is cleared only once delivery is
 * settled, success or failure, so a restart mid-typing still finds the record
 * and retries rather than losing it.
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
    /** Clears the persisted record and runs the caller's callback, once delivery settles. */
    const settle = (arrived) => {
      clearArmedPrompt(ARMED_ROOT, name).catch(() => {});
      (armed.onTyped ?? noop)(arrived);
    };
    if (armed.prompt) typePromptWhenReady(name, armed.prompt, armed.submit, "armed prompt").then(settle).catch(reportArmedPromptFailure);
    else if (area && file) typeGoalPromptWhenReady(name, area, file, armed.phase, armed.submit, armed.document, armed.extraFiles).then(settle).catch(reportArmedPromptFailure);
    else clearArmedPrompt(ARMED_ROOT, name).catch(() => {}); // no goal bound yet: nothing left to type
  }
  for (const [name, armed] of [...armedSessions.entries()]) {
    if (live.has(name)) continue;
    armedSessions.delete(name);
    clearArmedPrompt(ARMED_ROOT, name).catch(() => {});
    if (armed.onTyped) armed.onTyped(false);
  }
}

/** Does nothing; the default for an armed prompt nobody waits on. */
function noop() {}

/** Reports a failure in what an armed prompt's caller did on arrival. */
function reportArmedPromptFailure(err) {
  console.error("armed prompt:", err.message ?? err);
}

/**
 * Arms one primed session and keeps the watch timer running while anything is
 * armed: one tmux query a second, never overlapping, stopped once every primed
 * session has its harness. The arm is written to disk before this returns, so
 * a restart before the harness leaves its shell still has the prompt to
 * re-arm at boot (rearmPersistedPrompts).
 */
async function armSession(name, phase = "execute", submit = false, document = "", prompt = "", extraFiles = [], onTyped = null) {
  armedSessions.set(name, { phase, submit, document, prompt, extraFiles, onTyped });
  try {
    await writeArmedPrompt(ARMED_ROOT, name, { phase, submit, document, prompt, extraFiles });
  } catch (err) {
    console.error("armed prompt persist:", err.message ?? err);
  }
  runtimeScheduler.wake();
}

/**
 * Restores armed prompts written before this process last stopped: a prompt
 * whose session is still alive is re-armed exactly as armSession left it, one
 * whose session died while the server was down is forgotten. Runs once at
 * boot, before anything else touches armedSessions, so a step still booting
 * its harness when `tangent shell rebuild` restarted the server still gets
 * its prompt from the new process.
 */
async function rearmPersistedPrompts() {
  const records = await readAllArmedPrompts(ARMED_ROOT);
  if (!records.length) return;
  const live = new Set((await listSessions()).map((session) => session.name));
  for (const record of records) {
    if (!live.has(record.session)) {
      await clearArmedPrompt(ARMED_ROOT, record.session).catch(() => {});
      continue;
    }
    await armSession(record.session, record.phase, record.submit, record.document, record.prompt, record.extraFiles);
  }
}

// ---- cross-agent messages ----
// One queue per target session. The server is the only writer into panes, so
// every message flows through here: stamped with the sender's identity,
// delivered only into a positively identified empty composer, and audited to
// ~/.tangent/agent-shell-messages.jsonl. Rules live in agent-messages.mjs.

const MESSAGE_POLL_MS = 2000;
const MESSAGE_LOG = process.env.AGENT_MESSAGE_LOG ?? path.join(os.homedir(), ".tangent", "agent-shell-messages.jsonl");
const messageQueues = new Map(); // target session -> [{ from, area, text, queuedAt }]

/** Appends one messaging event to the audit log; failures only log. */
async function logAgentMessage(entry) {
  try {
    await appendFile(MESSAGE_LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch (err) {
    console.error("agent message log:", err.message ?? err);
  }
}

/** Types one stamped message into its target composer and audits the result. */
async function deliverAgentMessage(target, entry) {
  // A context reminder is rebuilt at delivery time (entry.render), so the
  // fill number Julian's agent sees is current, not the one at queue time.
  const body = typeof entry.render === "function" ? entry.render() ?? entry.text : entry.text;
  const text = entry.banner === false ? body : messageBanner(entry.from, entry.area, body);
  const arrived = await typePromptWhenReady(target, text, true, entry.banner === false ? "pipeline step" : "agent message");
  await logAgentMessage({ event: arrived ? "delivered" : "not delivered", to: target, from: entry.from, area: entry.area, text: body, banner: entry.banner !== false, queuedAt: entry.queuedAt });
  // A brain notice is persisted before it is queued. It counts as read only
  // here, after the whole text showed in the composer. Otherwise it stays
  // unread on disk and the next sweep queues it again.
  if (!entry.notices?.length) return;
  if (arrived) await markBrainNoticesDelivered(entry.notices, target, entry.generation ?? null);
  else releaseBrainNotices(entry.notices);
}

/**
 * One queue pass: delivers to every queued target whose composer is empty,
 * and drops (with an audit entry) messages whose target session died.
 * At-most-once by design; there is no retry beyond the queue itself.
 */
async function tickMessageQueues() {
  if (!messageQueues.size) return;
  const sessions = await listSessions();
  for (const [target, queue] of [...messageQueues.entries()]) {
    const live = sessions.find((session) => session.name === target);
    if (!live) {
      messageQueues.delete(target);
      for (const entry of queue) {
        await logAgentMessage({ event: "dropped", to: target, from: entry.from, text: entry.text, reason: "session ended" });
        // A brain notice is not lost with its queue entry: it stays unread on
        // disk, and the next generation or the next sweep picks it up.
        if (entry.notices?.length) releaseBrainNotices(entry.notices);
      }
      continue;
    }
    if (deliveryDecision(live).action !== "deliver") continue;
    const entry = queue.shift();
    if (!queue.length) messageQueues.delete(target);
    await deliverAgentMessage(target, entry);
  }
}

/** Queues one message and keeps the delivery timer running while any wait. */
function queueAgentMessage(target, entry) {
  const queue = messageQueues.get(target) ?? [];
  queue.push(entry);
  messageQueues.set(target, queue);
  runtimeScheduler.wake();
}

const runtimeScheduler = createRuntimeScheduler([
  {
    name: "goal reconciliation", intervalMs: 10_000,
    /** Reconciles durable work independently of browser requests. */
    active: () => true,
    /** Reads one current session snapshot and repairs stale work bindings. */
    async run() {
      await reconcileGoals(await listSessions());
    },
  },
  {
    name: "armed prompts", intervalMs: ARM_POLL_MS,
    /** Runs only while at least one session waits for its harness. */
    active: () => armedSessions.size > 0,
    run: tickArmedSessions,
  },
  {
    name: "message queue", intervalMs: MESSAGE_POLL_MS,
    /** Runs only while at least one target has queued messages. */
    active: () => messageQueues.size > 0,
    run: tickMessageQueues,
  },
]);

/**
 * Primes a session sitting at its shell: the area's suggested launch command
 * typed but not submitted, and the goal prompt armed to follow whatever
 * harness the user starts. A pane that is already running something is left
 * alone — priming must never type over an agent mid-conversation.
 */
async function primeGoalSession(session, area, phase = "execute", { launch = false, document = "", command = "", extraFiles = [], prompt = "", onTyped = null } = {}) {
  const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", "=" + session + ":", "#{pane_current_command}"]);
  if (!SHELL_CMDS.has(stdout.trim())) return false;
  await armSession(session, phase, launch, document, prompt, extraFiles, onTyped);
  await typeInto(session, withDefaultModel(command || (await agentCmdForArea(area))), false);
  if (launch) {
    await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "Enter"]);
    await sleep(250);
  }
  return true;
}

/** Primes one native agent with a conversation about new work. */
async function primeDescribeWorkSession(session, area, prompt, { launch = true, command = "", onTyped = null } = {}) {
  const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", "=" + session + ":", "#{pane_current_command}"]);
  if (!SHELL_CMDS.has(stdout.trim())) return false;
  await armSession(session, "define", launch, "", prompt, [], onTyped);
  await typeInto(session, withDefaultModel(command || (await agentCmdForArea(area))), false);
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
async function spawnDescribeWorkSession(area, description, sources, { session: requested = "", launch = true, command = "", label = "" } = {}) {
  const sessions = await listSessions();
  const existing = requested
    ? sessions.find((item) => item.name === requested && item.kind === "work-definition" && item.area === area)
    : null;
  if (existing) {
    const prompt = describeWorkPrompt(area, description, sources);
    const primed = existing.state === "shell"
      ? await primeDescribeWorkSession(existing.name, area, prompt, { launch, command }).catch(() => false)
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
  if (label) await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_launch", label]);

  /** Sends the captured description after the native agent is ready. */
  const prime = async () => {
    await sleep(700);
    try {
      await primeDescribeWorkSession(name, area, describeWorkPrompt(area, description, sources), { launch, command });
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
async function spawnGoalSession(area, slug, { phase = "execute", approved = false, launch = false, document = "", command = "", label = "", extraSlugs = [], pipeline = null, continuation = null, onPrimed = null } = {}) {
  const areaGoals = await readAreaGoals(area);
  const o = areaGoals.find((t) => t.slug === slug);
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
  // Extra Goals ride along in the same session: same Area only, still open,
  // never pulled away from another live session's ownership.
  const liveNames = new Set(sessions.map((s) => s.name));
  const extras = [...new Set(extraSlugs)]
    .map((extraSlug) => areaGoals.find((t) => t.slug === extraSlug))
    .filter((extra) => extra && extra.slug !== slug && !["done", "dropped"].includes(extra.status));
  const baseName = normName(`${area.split("/").pop()}--${slug}`).slice(0, 60);
  const phaseName = pipeline ? pipeline.sessionName : continuation ? continuation.sessionName : phase === "collaborate" ? normName(`${baseName}--collaborate`).slice(0, 60) : baseName;
  const ownExtras = extras.filter((extra) => !extra.session || !liveNames.has(extra.session) || [o.session, baseName, phaseName].includes(extra.session));
  const extraFiles = ownExtras.map((extra) => extra.file);
  // A pipeline step, or a continued solo session, is always a fresh session
  // with its own name; the step prompt is typed verbatim once the harness
  // is up. AGENT_SHELL_TEST_NO_LAUNCH leaves the pane at its shell so tests
  // can prove binding without a harness.
  const stepPrompt = pipeline
    ? await pipelineStepPrompt(area, o, pipeline.record, pipeline.index, ownExtras, pipeline.sessionName)
    : continuation
      ? await goalPrompt(area, o, ownExtras, continuation.entries)
      : "";
  if ((pipeline || continuation) && process.env.AGENT_SHELL_TEST_NO_LAUNCH === "1") launch = false;
  // Starting a Goal that already has a session re-primes it: a pane left
  // at a shell (the agent was stopped to do ordinary work) gets the launch
  // line and the prompt again, a pane still running one is only reattached.
  // A pipeline step or a continuation always forces a fresh session: there
  // is never a reason to reattach to an old, about-to-be-killed one.
  const existing = (pipeline || continuation) ? null : [o.session, phaseName, baseName].find((n) => n && sessions.some((s) => s.name === n));
  if (existing) {
    await execFileAsync("tmux", ["set-option", "-t", existing, "@tangent_phase", phase]);
    if (document) await execFileAsync("tmux", ["set-option", "-t", existing, "@tangent_document", document]);
    if (label) await execFileAsync("tmux", ["set-option", "-t", existing, "@tangent_launch", label]);
    const live = sessions.find((s) => s.name === existing);
    let primed = false;
    if (approved && phase === "execute" && live && !SHELL_CMDS.has(live.command)) {
      if (live.state === "working") return { status: 409, error: "the agent is still working; wait before you approve another assignment" };
      await typeInto(existing, await goalPrompt(area, o, ownExtras), true);
    } else {
      primed = await primeGoalSession(existing, area, phase, { launch, document, command, extraFiles }).catch(() => false);
    }
    const rebind = [o, ...ownExtras].filter((goal) => goal.status !== "active" || goal.session !== existing);
    if (rebind.length) {
      for (const goal of rebind) await writeGoalBinding(goal.file, { status: "active", session: existing });
      await vaultCommit(rebind.map((goal) => goal.file), `update: ${area} ${rebind.length === 1 ? `goal ${rebind[0].slug}` : `${rebind.length} goals`} active`, area, existing);
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
  if (pipeline) {
    await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_pipeline", o.file]);
    await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_step", String(pipeline.index)]);
  }
  try {
    const owned = [o, ...ownExtras];
    for (const goal of owned) await writeGoalBinding(goal.file, { status: "active", session: phaseName });
    await vaultCommit(owned.map((goal) => goal.file), `update: ${area} ${owned.length === 1 ? `goal ${slug}` : `${owned.length} goals`} active`, area, phaseName);
  } catch (err) {
    console.error("goal binding:", err.message ?? err);
  }
  /**
   * Primes the new pane after its login shell finishes drawing. onPrimed, when
   * given, is the swap contract's confirmation callback (design-worker-context-handover
   * D6): called with true once tickArmedSessions confirms the whole prompt
   * arrived, false on a session death or a failure before that point ever
   * arms. It must fire exactly once either way, so a caller waiting to kill
   * the old session on confirmation never hangs.
   */
  const primeNewSession = async () => {
    // Let the login shell finish drawing its prompt: a line typed earlier can
    // be wiped by the redraw.
    await sleep(700);
    try {
      const primed = await primeGoalSession(phaseName, area, phase, { launch, document, command, extraFiles, prompt: stepPrompt, onTyped: onPrimed });
      if (!primed && onPrimed) onPrimed(false);
    } catch (err) {
      console.error("prime session:", err.message ?? err);
      if (onPrimed) onPrimed(false);
    }
  };
  if (launch) await primeNewSession();
  else primeNewSession();
  return { status: 200, session: phaseName };
}

/**
 * A work-definition session that takes Goal ownership becomes that Goal's
 * session: its tmux identity flips from "Defining work" to the Goal it now
 * works, so the desk shows it on the Goal row instead of under Dispatches.
 * Sessions that already carry a Goal keep their identity; extra owned Goals
 * show through their own session bindings.
 */
async function adoptGoalSession(sessions, sessionName, goal) {
  const session = sessions.find((s) => s.name === sessionName);
  if (!session || session.kind !== "work-definition") return;
  /** Writes one tmux option on the adopted session, ignoring failures. */
  const set = (key, value) => execFileAsync("tmux", ["set-option", "-t", "=" + sessionName + ":", key, value]).catch(() => {});
  await set("@tangent_kind", "goal");
  await set("@tangent_area", goal.area);
  await set("@tangent_goal", goal.file);
  await set("@tangent_phase", "execute");
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
    const now = Date.now();
    const byFile = new Map();
    for (const area of flattenAreaPaths(await readTree(TREES_ROOT))) {
      for (const t of await readAreaGoals(area)) byFile.set(t.file, t);
    }
    for (const t of byFile.values()) {
      // The Goal file's own mtime is when its binding was last written: a
      // binding fresher than the sessions snapshot above is not stopped.
      if (!goalBindingGoneFromSnapshot(t, live, now)) continue;
      await writeGoalBinding(t.file, { status: "open", session: null });
      await vaultCommit([t.file], `update: ${t.area} goal ${t.slug} back to open, session ended`, t.area, null);
      if (!(await pipelineStepForSession(t.session))) {
        await notifyBrain(t.area, `Goal ${t.slug}: its session ${t.session} ended without a pipeline; the Goal is open again.`);
      }
    }
    await reconcilePipelines(sessions);
    await reconcileBrains(sessions);
    await reconcileContextHandovers(sessions);
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
  const byFile = await goalsByFile();
  const o = byFile.get(file);
  if (!o) return { status: 404, error: `no goal file ${file}` };
  // Extra Goals must share the primary's Area: one session, one repository.
  const extraSlugs = (options.extraFiles ?? [])
    .map((extra) => byFile.get(extra))
    .filter((extra) => extra && extra.area === o.area)
    .map((extra) => extra.slug);
  return spawnGoalSession(o.area, o.slug, { ...options, extraSlugs });
}

// ---- agent pipelines ----
// A pipeline is a list of steps on one Goal. Each step is an ordinary Goal
// session (spawnGoalSession with the pipeline option) or the step prompt
// delivered into an earlier step's live session. The record under
// PIPELINES_ROOT holds the steps and their handovers; the Goal file's session
// binding follows the current step. Design: design-agent-pipelines.

/** The tmux session name for one step; restarts get the smallest free suffix. */
function pipelineStepSessionName(record, index, liveNames) {
  const base = normName(`${record.area.split("/").pop()}--${record.slug}`).slice(0, 60);
  const stepName = index === 1 ? base : normName(`${base}--s${index}`).slice(0, 60);
  if (!liveNames.has(stepName)) return stepName;
  for (let k = 2; ; k += 1) {
    const candidate = normName(`${stepName}-r${k}`).slice(0, 60);
    if (!liveNames.has(candidate)) return candidate;
  }
}

/** Resolves one step's launch to an exact command, or returns the error. */
async function resolveStepLaunch(step) {
  if (!step.launch) return step.command ? { command: step.command, label: step.label || "Edited command" } : { error: `step ${step.index}: no command` };
  const registry = await harnessRegistry();
  if (registry.error) return { error: registry.error };
  return resolveLaunch(registry, step.launch);
}

/**
 * The Area's resolved harness id in plain words: the registry harness id
 * when the default resolves through the registry, else the bare command
 * from the profile or legacy fallback (a single word, no arguments). Null
 * when the Area's launch is broken or the fallback command carries
 * arguments, so callers skip rather than compare against a guess.
 */
async function areaHarnessId(area) {
  const launch = await launchForArea(area);
  if (launch.error) return null;
  if (launch.harness) return launch.harness;
  const command = String(launch.command ?? "").trim();
  return command && !command.includes(" ") ? command : null;
}

/**
 * One warning per step whose explicit --launch harness differs from the
 * Area's inherited default. Warns, never blocks: the step's own choice is
 * still honored.
 */
async function launchHarnessWarnings(area, steps) {
  const areaHarness = await areaHarnessId(area);
  if (!areaHarness) return [];
  return steps
    .filter((step) => step.launch?.harness && step.launch.harness !== areaHarness)
    .map((step) => `step ${step.index}: --launch ${step.launch.harness}${step.launch.model ? `/${step.launch.model}` : ""} differs from ${area}'s default harness ${areaHarness}.`);
}

/**
 * Starts one pending step: fresh session by default, or the step prompt
 * delivered into an earlier step's live session when the step continues it.
 * The Goal binds to whichever session now works it.
 */
async function startPipelineStep(record, index) {
  const step = record.steps[index - 1];
  if (!step) return { status: 404, error: `no step ${index}` };
  if (step.status !== "pending") return { status: 409, error: `step ${index} is ${step.status}` };
  const resolved = await resolveStepLaunch(step);
  if (resolved.error) return { status: 409, error: `step ${index}: ${resolved.error}` };
  step.command = resolved.command;
  step.label = resolved.label;
  const byFile = await goalsByFile();
  const o = byFile.get(record.goal);
  if (!o) return { status: 404, error: `no goal file ${record.goal}` };
  const sessions = await listSessions();
  const liveNames = new Set(sessions.map((item) => item.name));
  const extraSlugs = (record.extraFiles ?? []).map((extra) => byFile.get(extra)).filter((extra) => extra && extra.area === o.area).map((extra) => extra.slug);
  const source = step.continueFrom ? record.steps[step.continueFrom - 1] : null;
  if (source?.session && liveNames.has(source.session)) {
    const goals = await readAreaGoals(record.area);
    const extras = extraSlugs.map((extraSlug) => goals.find((goal) => goal.slug === extraSlug)).filter(Boolean);
    const prompt = await pipelineStepPrompt(record.area, o, record, index, extras, source.session);
    queueAgentMessage(source.session, { from: "tangent", area: record.area, text: prompt, banner: false, queuedAt: new Date().toISOString() });
    await execFileAsync("tmux", ["set-option", "-t", "=" + source.session + ":", "@tangent_step", String(index)]).catch(() => {});
    if (o.status !== "active" || o.session !== source.session) {
      await writeGoalBinding(o.file, { status: "active", session: source.session });
      await vaultCommit([o.file], `update: ${record.area} goal ${record.slug} active`, record.area, source.session);
    }
    step.session = source.session;
  } else {
    if (source) step.continueFrom = null; // the earlier session is gone: fall back to fresh
    const sessionName = pipelineStepSessionName(record, index, liveNames);
    const result = await spawnGoalSession(record.area, record.slug, {
      phase: "execute",
      approved: true,
      launch: true,
      command: step.command,
      label: step.label,
      extraSlugs,
      pipeline: { record, index, sessionName },
    });
    if (result.status !== 200) return result;
    step.session = result.session;
  }
  step.status = "running";
  step.startedAt = new Date().toISOString();
  step.endedAt = null;
  await writePipeline(PIPELINES_ROOT, record);
  return { status: 200, session: step.session, index, pipeline: record };
}

/** Creates the record for one Goal and starts its first step. */
async function startPipeline(file, { steps, extraFiles = [] } = {}) {
  const byFile = await goalsByFile();
  const o = byFile.get(file);
  if (!o) return { status: 404, error: `no goal file ${file}` };
  if (["done", "dropped"].includes(o.status)) return { status: 409, error: `goal is ${o.status}` };
  const sessions = await listSessions();
  if (o.session && sessions.some((item) => item.name === o.session)) {
    return { status: 409, error: `goal is owned by live session ${o.session}` };
  }
  const error = validateSteps(steps);
  if (error) return { status: 400, error };
  const sameArea = extraFiles.map(String).filter((extra) => byFile.get(extra)?.area === o.area);
  const record = newPipeline({ goal: o.file, area: o.area, slug: o.slug, extraFiles: sameArea, steps });
  // Resolve step 1 before anything is written: a bad launch names itself
  // and leaves no record and no session behind.
  const first = await resolveStepLaunch(record.steps[0]);
  if (first.error) return { status: 409, error: `step 1: ${first.error}` };
  const warnings = await launchHarnessWarnings(o.area, record.steps);
  await writePipeline(PIPELINES_ROOT, record);
  const started = await startPipelineStep(record, 1);
  if (started.status !== 200) return started;
  return { ...started, warnings };
}

/** Finds the record and step a live session works, or null. */
async function pipelineStepForSession(sessionName) {
  for (const record of await readAllPipelines(PIPELINES_ROOT)) {
    const step = record.steps.find((item) => item.session === sessionName && item.status === "running");
    if (step) return { record, step };
  }
  return null;
}

/**
 * Ends the pipeline whose step this session works, if any. Called when Julian
 * kills a session: Stop agent, ⌘D, or ✕ on a tree row. Without this the
 * reconciler would only mark the step "stopped", the Goal would sit in
 * attention offering Restart forever, and the multi-step Goal would never
 * settle back to plain open work the way a solo Goal does. Returns the record
 * that ended, or null when the session was no pipeline step.
 */
async function endPipelineForSession(sessionName) {
  const found = await pipelineStepForSession(sessionName);
  if (!found) return null;
  endPipeline(found.record);
  await writePipeline(PIPELINES_ROOT, found.record);
  await notifyBrain(found.record.area, `Goal ${found.record.slug}: pipeline ended by Julian at step ${found.step.index}.`);
  return found.record;
}

/** Records one step's handover and starts the next pending step. */
async function handoverPipelineStep(sessionName, text) {
  const found = await pipelineStepForSession(sessionName);
  if (!found) {
    // A plain handover from a session whose step already swapped to a fresh
    // one (attack 3, design-worker-context-handover) must not complete the
    // step out from under the live session.
    const movedTo = await swappedAwayNaming(sessionName);
    if (movedTo) return { status: 409, error: `this step moved to a fresh session (${movedTo}); it is no longer yours to hand over` };
    const live = (await listSessions()).find((session) => session.name === sessionName && session.kind === "goal" && session.goal);
    if (!live) return { status: 404, error: "this session is not a running worker assignment" };
    const goal = (await goalsByFile()).get(live.goal);
    if (!goal) return { status: 404, error: "this worker has no Goal" };
    const controller = brainForArea(await readAllBrains(BRAINS_ROOT), goal.area);
    if (!controller) return { status: 409, error: "a solo legacy Goal has no brain; use its existing session controls" };
    await notifyBrain(goal.area, `Goal ${goal.slug}: worker reported and waits for your command. Handover: ${brainMessageExcerpt(text)}`);
    return { status: 200, state: "reported", next: null, pipeline: null };
  }
  return completePipelineStep(found.record, found.step, text, "agent");
}

/**
 * Finds the live session name a dead-but-not-yet-forgotten `sessionName`
 * swapped away to, by scanning every pipeline step's and every solo
 * continuation record's `continuations` list for an entry naming it. Null
 * when `sessionName` never handed over.
 */
async function swappedAwayNaming(sessionName) {
  for (const record of await readAllPipelines(PIPELINES_ROOT)) {
    for (const step of record.steps) {
      if ((step.continuations ?? []).some((entry) => entry.session === sessionName)) return step.session;
    }
  }
  for (const record of await readAllContinuations(CONTINUATIONS_ROOT)) {
    if ((record.continuations ?? []).some((entry) => entry.session === sessionName)) return record.session;
  }
  return null;
}

/**
 * Moves a session's queued messages to a fresh name, dropping any
 * context-reminder entry: a fresh session does not need the old reminder,
 * and its own fill will earn it a fresh one if it also fills up (swap
 * contract rule 2, design-worker-context-handover). A brain answer in
 * flight survives the move.
 */
function retargetMessageQueue(oldName, newName) {
  const queue = messageQueues.get(oldName);
  if (!queue) return;
  messageQueues.delete(oldName);
  const kept = queue.filter((entry) => entry.kind !== "context-reminder");
  if (kept.length) messageQueues.set(newName, [...(messageQueues.get(newName) ?? []), ...kept]);
}

/** The carried-context clause for a continuation notice: exact tokens and percent, or "unknown carried context". */
function carriedContextClause(fill) {
  if (!fill) return "unknown carried context";
  const used = Math.round(fill.usedTokens / 1000);
  const pct = Math.round((fill.usedTokens / fill.windowTokens) * 100);
  return `${used}k carried context (${pct}% of window)`;
}

/** The brain notice for one continuation (design touchpoint 5). */
function continuationNotice({ slug, index, next, fill }) {
  const subject = index != null ? `step ${index}` : "its session";
  return `Goal ${slug}: ${subject} handed over to a fresh session (${next}) at ${carriedContextClause(fill)}.`;
}

/** The brain notice once a step or Goal session has continued three times without failing: probably oversized. */
function oversizedContinuationNotice({ slug, index }) {
  const subject = index != null ? `step ${index}` : "its session";
  return `Goal ${slug}: ${subject} has continued three times; it is probably oversized. Consider splitting it: tangent goal append, or a fresh Goal.`;
}

/** How many continuations on a list actually swapped in a fresh session (excludes failed attempts). */
function liveContinuationCount(entries) {
  return (entries ?? []).filter((entry) => !entry.failed).length;
}

/**
 * The worker's own context-fill escape hatch: `tangent goal handover
 * --continue` (design-worker-context-handover D4, D6). Hands the caller's
 * step or Goal to a fresh copy of itself instead of advancing the pipeline.
 *
 * The order below is the swap contract and must not be rearranged: write the
 * continuation record before anything else, retarget queued messages, spawn
 * the fresh session, and only kill the old session once `onPrimed` confirms
 * the fresh session's whole prompt arrived (not merely typed) - never
 * through `endPipelineForSession`, which would end the whole run and tell
 * the brain a step died. A server restart between spawn and prime loses the
 * `onPrimed` callback (armed prompts persist without callbacks on disk);
 * both sessions then stay alive, the record already points at the new one,
 * and the old session is refused by name on its next command.
 */
async function continueWorkerSession(sessionName, text) {
  const pipelineHit = await pipelineStepForSession(sessionName);
  const sessions = await listSessions();
  const live = sessions.find((s) => s.name === sessionName);
  // Check "already moved away" before falling back to the solo path: an
  // orphaned pipeline-step (or solo) session still carries its kind=goal and
  // goal=<file> tmux tags after its step moved to a fresh session, so that
  // check alone would otherwise misroute a repeat --continue as a fresh solo
  // continuation instead of refusing it.
  if (!pipelineHit) {
    const movedTo = await swappedAwayNaming(sessionName);
    if (movedTo) return { status: 409, error: `this step moved to a fresh session (${movedTo}); it is no longer yours to hand over` };
  }
  const soloHit = !pipelineHit && live && live.kind === "goal" && live.goal ? live : null;
  if (!pipelineHit && !soloHit) {
    return { status: 404, error: "this session is neither a running pipeline step nor a Goal session" };
  }
  const liveNames = new Set(sessions.map((s) => s.name));
  const next = continuationSessionName(sessionName, liveNames);
  const fill = live?.context ?? null;
  const at = new Date().toISOString();

  if (pipelineHit) {
    const { record, step } = pipelineHit;
    const entry = { session: sessionName, next, facts: text, at, fill };
    const execution = pipelineExecution({
      record,
      step,
      /** Persists the enclosing pipeline record. */
      save: (value) => writePipeline(PIPELINES_ROOT, value),
    });
    await execution.continueTo(entry);
    retargetMessageQueue(sessionName, next);

    const byFile = await goalsByFile();
    const o = byFile.get(record.goal);
    const extraSlugs = (record.extraFiles ?? []).map((extra) => byFile.get(extra)).filter((extra) => extra && extra.area === record.area).map((extra) => extra.slug);
    let settled = false;
    /** Settles a pipeline continuation after its replacement prompt arrives or fails. */
    const onPrimed = (arrived) => {
      if (settled) return;
      settled = true;
      if (arrived) {
        execFileAsync("tmux", ["kill-session", "-t", "=" + sessionName]).catch(() => {});
        notifyBrain(record.area, continuationNotice({ slug: record.slug, index: step.index, next, fill })).catch(() => {});
        if (liveContinuationCount(step.continuations) === 3) {
          notifyBrain(record.area, oversizedContinuationNotice({ slug: record.slug, index: step.index })).catch(() => {});
        }
        return;
      }
      execFileAsync("tmux", ["kill-session", "-t", "=" + next]).catch(() => {});
      execution.failContinuation(entry).catch(() => {});
      retargetMessageQueue(next, sessionName);
      if (o) writeGoalBinding(o.file, { status: "active", session: sessionName }).then(() => vaultCommit([o.file], `update: ${record.area} goal ${record.slug} continuation failed, back to ${sessionName}`, record.area, sessionName)).catch(() => {});
      queueAgentMessage(sessionName, { from: "tangent", area: record.area, text: `Continuation recorded, but the fresh session could not start: the prompt never arrived. You still work this step.`, queuedAt: new Date().toISOString() });
    };
    const result = await spawnGoalSession(record.area, record.slug, {
      phase: "execute", launch: true, command: step.command, label: step.label, extraSlugs,
      pipeline: { record, index: step.index, sessionName: next }, onPrimed,
    });
    if (result.status !== 200) {
      await execution.failContinuation(entry);
      retargetMessageQueue(next, sessionName);
      queueAgentMessage(sessionName, { from: "tangent", area: record.area, text: `Continuation recorded, but the fresh session could not start: ${result.error}. You still work this step.`, queuedAt: new Date().toISOString() });
      return { status: result.status, error: result.error };
    }
    return { status: 200, session: next };
  }

  // A solo Goal session: no pipeline record, so the continuation lives in
  // its own tiny store (goal-continuation.v1).
  const byFile = await goalsByFile();
  const o = byFile.get(soloHit.goal);
  if (!o) return { status: 404, error: "this session's Goal file could not be read" };
  const record = (await readContinuation(CONTINUATIONS_ROOT, o.area, o.slug)) ?? newContinuationRecord({ goal: o.file, area: o.area, slug: o.slug, session: sessionName });
  const entry = { session: sessionName, next, facts: text, at, fill };
  const execution = soloExecution({
    record,
    area: o.area,
    /** Persists the solo execution record. */
    save: (value) => writeContinuation(CONTINUATIONS_ROOT, value),
  });
  await execution.continueTo(entry);
  retargetMessageQueue(sessionName, next);

  let settled = false;
  /** Settles a solo Goal continuation after its replacement prompt arrives or fails. */
  const onPrimed = (arrived) => {
    if (settled) return;
    settled = true;
    if (arrived) {
      execFileAsync("tmux", ["kill-session", "-t", "=" + sessionName]).catch(() => {});
      notifyBrain(o.area, continuationNotice({ slug: o.slug, index: null, next, fill })).catch(() => {});
      if (liveContinuationCount(record.continuations) === 3) {
        notifyBrain(o.area, oversizedContinuationNotice({ slug: o.slug, index: null })).catch(() => {});
      }
      return;
    }
    execFileAsync("tmux", ["kill-session", "-t", "=" + next]).catch(() => {});
    execution.failContinuation(entry).catch(() => {});
    retargetMessageQueue(next, sessionName);
    writeGoalBinding(o.file, { status: "active", session: sessionName }).then(() => vaultCommit([o.file], `update: ${o.area} goal ${o.slug} continuation failed, back to ${sessionName}`, o.area, sessionName)).catch(() => {});
    queueAgentMessage(sessionName, { from: "tangent", area: o.area, text: `Continuation recorded, but the fresh session could not start: the prompt never arrived. You still work this Goal.`, queuedAt: new Date().toISOString() });
  };
  const result = await spawnGoalSession(o.area, o.slug, {
    phase: "execute", launch: true, continuation: { sessionName: next, entries: record.continuations }, onPrimed,
  });
  if (result.status !== 200) {
    await execution.failContinuation(entry);
    retargetMessageQueue(next, sessionName);
    queueAgentMessage(sessionName, { from: "tangent", area: o.area, text: `Continuation recorded, but the fresh session could not start: ${result.error}. You still work this Goal.`, queuedAt: new Date().toISOString() });
    return { status: result.status, error: result.error };
  }
  return { status: 200, session: next };
}

/**
 * Marks a step complete with its handover text and advances the line. A step
 * asked to hand over again (a step was appended after it finished) keeps its
 * first handover and gains the second below it: nothing already handed over
 * is lost.
 */
async function completePipelineStep(record, step, text, source) {
  step.handover = step.handover ? `${step.handover}\n\n${text}` : text;
  step.handoverSource = source;
  step.status = source === "skip" ? "skipped" : "complete";
  step.endedAt = new Date().toISOString();
  await writePipeline(PIPELINES_ROOT, record);
  const next = nextPendingStep(record, step.index);
  const stepWord = source === "skip" ? "skipped" : "complete";
  if (!next) {
    await notifyBrain(record.area, `Goal ${record.slug}: pipeline complete (${record.steps.length} steps; step ${step.index} ${stepWord}, ${step.label || "agent"}). Last handover: ${brainMessageExcerpt(step.handover)}`);
    return { status: 200, state: "complete", next: null, pipeline: record };
  }
  const controller = brainForArea(await readAllBrains(BRAINS_ROOT), record.area);
  if (controller && source === "agent") {
    await notifyBrain(record.area, `Goal ${record.slug}: step ${step.index} of ${record.steps.length} ${stepWord} (${step.label || "agent"}). Step ${next.index} is ready and waits for your command. Handover: ${brainMessageExcerpt(step.handover)}`);
    return { status: 200, state: "reported", next: { index: next.index, session: null }, pipeline: record };
  }
  const started = await startPipelineStep(record, next.index);
  if (started.status !== 200) {
    await notifyBrain(record.area, `Goal ${record.slug}: step ${step.index} ${stepWord}, but step ${next.index} could not start: ${started.error}`);
    return started;
  }
  await notifyBrain(record.area, `Goal ${record.slug}: step ${step.index} of ${record.steps.length} ${stepWord} (${step.label || "agent"}). Step ${next.index} started (${next.label || "agent"}). Handover: ${brainMessageExcerpt(step.handover)}`);
  return { status: 200, state: "started", next: { index: next.index, session: started.session }, pipeline: record };
}

/** The last agent message visible in a pane, for a step sent on without a handover. */
async function paneLastMessage(sessionName) {
  try {
    const { stdout } = await execFileAsync("tmux", ["capture-pane", "-p", "-S", "-200", "-t", "=" + sessionName + ":"]);
    const lines = stdout.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim());
    const text = lines.slice(-40).join("\n").trim();
    return text || "(no handover text)";
  } catch {
    return "(no handover text)";
  }
}

/** Restart, skip, end, or send-on one step at Julian's explicit action. */
async function controlPipeline(goalFile, action, index) {
  const byFile = await goalsByFile();
  const o = byFile.get(goalFile);
  if (!o) return { status: 404, error: `no goal file ${goalFile}` };
  const record = await readPipeline(PIPELINES_ROOT, o.area, o.slug);
  if (!record) return { status: 404, error: "no pipeline on this goal" };
  const step = record.steps[Number(index) - 1];
  if (!step) return { status: 404, error: `no step ${index}` };
  const sessions = await listSessions();
  const live = step.session ? sessions.find((item) => item.name === step.session) : null;
  if (action === "advance") {
    if (step.status !== "pending") return { status: 409, error: `step ${step.index} is ${step.status}; advance needs a pending step` };
    const controller = brainForArea(await readAllBrains(BRAINS_ROOT), record.area);
    if (!controller) return { status: 409, error: `no live brain controls ${record.area}` };
    return startPipelineStep(record, step.index);
  }
  if (action === "restart") {
    if (!(step.status === "stopped" || (step.status === "running" && !live))) return { status: 409, error: `step ${step.index} is ${step.status}; restart needs a stopped step` };
    step.status = "pending";
    step.session = null;
    await writePipeline(PIPELINES_ROOT, record);
    return startPipelineStep(record, step.index);
  }
  if (action === "skip") {
    if (!["stopped", "running", "pending"].includes(step.status)) return { status: 409, error: `step ${step.index} is ${step.status}` };
    return completePipelineStep(record, step, `Step ${step.index} was skipped by Julian.`, "skip");
  }
  if (action === "end") {
    // Stop work on the whole run: kill the live step, if any, and end every
    // step that has not run. The Goal stays open with its handovers.
    if (live) await execFileAsync("tmux", ["kill-session", "-t", "=" + step.session]).catch(() => {});
    const ended = endPipeline(record);
    await writePipeline(PIPELINES_ROOT, record);
    await notifyBrain(record.area, `Goal ${record.slug}: pipeline ended by Julian at step ${step.index}.`);
    return { status: 200, state: "ended", ended, pipeline: record };
  }
  if (action === "send") {
    if (step.status !== "running" || !live) return { status: 409, error: `step ${step.index} is not running` };
    if (!(live.state === "waiting" && ["idle", null, undefined].includes(live.stateDetail))) return { status: 409, error: `step ${step.index} is ${live.state}; send needs an idle agent` };
    return completePipelineStep(record, step, await paneLastMessage(step.session), "last-message");
  }
  return { status: 400, error: `unknown action ${action}` };
}

/** The banner-less message that asks a finished step's agent to hand over again into appended steps. */
function handoverAgainMessage(step, added) {
  const first = added[0];
  const list = added.length === 1
    ? `step ${first.index} (${first.instruction})`
    : `steps ${first.index} to ${added[added.length - 1].index}; step ${first.index} is: ${first.instruction}`;
  return `Tangent: after you handed over, Julian added ${list} to this pipeline. Run \`tangent goal handover "<facts>"\` again from this session with your current facts (files with full paths, what is finished, what is unresolved, decisions Julian made) so the pipeline continues into step ${first.index}. Your earlier handover is kept; state only what changed since or what the next agent still needs.`;
}

/**
 * Appends steps to a Goal's pipeline without touching what already ran.
 * Mid-run, the new steps simply wait: the running step's handover flows into
 * them through nextPendingStep. On a finished pipeline the previously last
 * step is asked to hand over again when its session still runs an agent
 * (its status returns to running so the desk and the handover path treat it
 * as the current step); otherwise the first new step starts at once.
 */
async function appendPipelineSteps(goalFile, steps) {
  const byFile = await goalsByFile();
  const o = byFile.get(goalFile);
  if (!o) return { status: 404, error: `no goal file ${goalFile}` };
  if (["done", "dropped"].includes(o.status)) return { status: 409, error: `goal is ${o.status}` };
  const record = await readPipeline(PIPELINES_ROOT, o.area, o.slug);
  if (!record) return { status: 404, error: "no pipeline on this goal" };
  const finished = pipelineFinished(record);
  const last = record.steps[record.steps.length - 1];
  let added;
  try {
    added = appendSteps(record, steps);
  } catch (error) {
    return { status: 400, error: error.message };
  }
  // Resolve the first new step before anything is written: a bad launch
  // names itself and leaves the record as it was.
  const first = await resolveStepLaunch(added[0]);
  if (first.error) return { status: 409, error: `step ${added[0].index}: ${first.error}` };
  const warnings = await launchHarnessWarnings(record.area, added);
  if (!finished) {
    await writePipeline(PIPELINES_ROOT, record);
    return { status: 200, state: "queued", after: currentStep(record)?.index ?? last.index, added: added.map((step) => step.index), pipeline: record, warnings };
  }
  const sessions = last.status === "complete" && last.session ? await withAgentStates(await listSessions()) : [];
  const live = sessions.find((session) => session.name === last.session && session.state !== "shell");
  if (live) {
    last.status = "running";
    last.endedAt = null;
    await writePipeline(PIPELINES_ROOT, record);
    queueAgentMessage(last.session, { from: "tangent", area: record.area, text: handoverAgainMessage(last, added), banner: false, queuedAt: new Date().toISOString() });
    return { status: 200, state: "asked", after: last.index, session: last.session, added: added.map((step) => step.index), pipeline: record, warnings };
  }
  await writePipeline(PIPELINES_ROOT, record);
  const started = await startPipelineStep(record, added[0].index);
  if (started.status !== 200) return started;
  return { status: 200, state: "started", next: { index: added[0].index, session: started.session }, added: added.map((step) => step.index), pipeline: record, warnings };
}

/** Edits one pending step; started steps are history. */
async function editPipelineStep(goalFile, index, patch) {
  const byFile = await goalsByFile();
  const o = byFile.get(goalFile);
  if (!o) return { status: 404, error: `no goal file ${goalFile}` };
  const record = await readPipeline(PIPELINES_ROOT, o.area, o.slug);
  if (!record) return { status: 404, error: "no pipeline on this goal" };
  const step = record.steps[Number(index) - 1];
  if (!step) return { status: 404, error: `no step ${index}` };
  if (step.status !== "pending") return { status: 409, error: `step ${step.index} is ${step.status}; only pending steps change` };
  const draft = record.steps.map((item) => ({ ...item }));
  const target = draft[step.index - 1];
  if (typeof patch.instruction === "string") target.instruction = patch.instruction.trim();
  if (typeof patch.command === "string" && patch.command.trim()) { target.command = patch.command.trim(); target.launch = null; }
  else if (patch.choice && typeof patch.choice === "object") { target.launch = { harness: String(patch.choice.harness ?? ""), model: patch.choice.model ?? null, effort: patch.choice.effort ?? null }; target.command = ""; }
  if (patch.continueFrom === null || Number.isInteger(patch.continueFrom)) target.continueFrom = patch.continueFrom;
  const error = validateSteps(draft);
  if (error) return { status: 400, error };
  record.steps = draft;
  await writePipeline(PIPELINES_ROOT, record);
  return { status: 200, pipeline: record };
}

/**
 * Every pipeline record with live facts folded in: whether each step's
 * session exists, its pane state, and the derived pipeline status.
 */
async function pipelinesView(sessions) {
  const byName = new Map(sessions.map((item) => [item.name, item]));
  const records = await readAllPipelines(PIPELINES_ROOT);
  return records.map((record) => ({
    ...record,
    status: pipelineStatus(record, (name) => byName.has(name)),
    steps: record.steps.map((step) => {
      const live = step.session ? byName.get(step.session) : null;
      return { ...step, live: Boolean(live), state: live?.state ?? null, stateDetail: live?.stateDetail ?? null, idleSince: live?.idleSince ?? null, waitingSince: live?.waitingSince ?? null, context: live?.context ?? null };
    }),
  }));
}

/** Marks running steps whose session is gone as stopped. */
async function reconcilePipelines(sessions) {
  const byName = new Map(sessions.map((item) => [item.name, item]));
  const now = Date.now();
  for (const record of await readAllPipelines(PIPELINES_ROOT)) {
    let changed = false;
    for (const step of record.steps) {
      const key = `${record.goal}#${step.index}#${step.session}`;
      if (step.status !== "running" || !step.session) {
        idleNoticed.delete(key);
        waitNoticed.delete(key);
        continue;
      }
      const live = byName.get(step.session);
      if (!live) {
        // The step may have started after this sessions snapshot was taken:
        // its tmux session exists but this list predates it.
        if (!stepGoneFromSnapshot(step, byName, now)) continue;
        step.status = "stopped";
        step.endedAt = new Date().toISOString();
        changed = true;
        idleNoticed.delete(key);
        waitNoticed.delete(key);
        await notifyBrain(record.area, `Goal ${record.slug}: step ${step.index} of ${record.steps.length} stopped (its session ended without a handover). Restart, skip, or end it on the desk, or start it again with tangent goal start.`);
        continue;
      }
      // One idle notice per step session: the brain decides whether to send
      // the step on, message the worker, or ask Julian.
      const idle = live.state === "waiting" && (live.stateDetail === "idle" || live.stateDetail == null) && live.idleSince && now - live.idleSince >= BRAIN_IDLE_NOTICE_MS;
      if (idle && !idleNoticed.has(key)) {
        idleNoticed.add(key);
        await notifyBrain(record.area, `Goal ${record.slug}: step ${step.index} of ${record.steps.length} (${step.label || "agent"}, session ${step.session}) has been idle for ${Math.round(BRAIN_IDLE_NOTICE_MS / 60_000)} minutes without a handover.`);
      }
      // One notice per wait occurrence: waitingSince marks when this pane
      // went static, so a fresh occurrence (the pane changed, then went
      // static again) carries a new timestamp and is eligible again, while a
      // repeated check against the same still-unanswered wait is not.
      const waiting = live.state === "waiting" && (live.stateDetail === "decision" || live.stateDetail === "draft") && live.waitingSince && now - live.waitingSince >= BRAIN_WAIT_NOTICE_MS;
      if (waiting && waitNoticed.get(key) !== live.waitingSince) {
        waitNoticed.set(key, live.waitingSince);
        const question = live.stateQuestion ? ` It asks: "${live.stateQuestion}"` : "";
        const kind = live.stateDetail === "decision" ? "a decision menu" : "an unsent draft";
        await notifyBrain(record.area, `Goal ${record.slug}: step ${step.index} of ${record.steps.length} (${step.label || "agent"}, session ${step.session}) has sat at ${kind} for ${Math.round(BRAIN_WAIT_NOTICE_MS / 60_000)} minutes without an answer.${question}`);
      }
    }
    if (changed) await writePipeline(PIPELINES_ROOT, record);
  }
}
const idleNoticed = new Set();
const waitNoticed = new Map();

// ---- Area brains ----
// One long-lived orchestrating agent per Area (design-area-brain-solution in
// the vault). The server owns the record, the session, the event messages
// the brain hears, and the self-handover that starts a fresh generation.

/** The first 400 characters of a handover for a brain message, one line. */
function brainMessageExcerpt(text) {
  const flat = oneLine(String(text ?? "").trim());
  if (!flat) return "(no handover text)";
  return flat.length > 400 ? `${flat.slice(0, 397)}…` : flat;
}

/** The running brain that covers an Area whose session is live, or null. */
async function liveBrainForArea(area) {
  const record = brainForArea(await readAllBrains(BRAINS_ROOT), area);
  if (!record?.session) return null;
  try {
    await execFileAsync("tmux", ["has-session", "-t", "=" + record.session]);
    return record;
  } catch {
    return null;
  }
}

/** The closest ancestor brain whose recorded session is currently live. */
async function nearestLiveBrainForArea(area) {
  const records = await readAllBrains(BRAINS_ROOT);
  const parts = String(area ?? "").split("/").filter(Boolean);
  for (let count = parts.length; count > 0; count -= 1) {
    const candidate = parts.slice(0, count).join("/");
    const record = records.find((item) => item.area === candidate && item.status === "running" && item.session);
    if (!record) continue;
    const live = await execFileAsync("tmux", ["has-session", "-t", "=" + record.session]).then(() => true, () => false);
    if (live) return record;
  }
  return null;
}

// ---- the brain's notice inbox ----
// Every brain notice is written to disk before it is queued, and marked read
// only after it reached a composer or was listed in a new generation's first
// message. That is what makes a notice survive a server restart, a
// generation handover, and a gap with no live brain. Rules and file shape
// live in brain-inbox.mjs.

const inboxWrites = new Map(); // area -> the promise of its last change

/**
 * Runs one read-change-write pass on an Area's inbox, after any earlier pass
 * on the same Area. Notices arrive from several places at once, so the
 * changes are serialized instead of racing on the file.
 */
function withInbox(area, change) {
  const earlier = inboxWrites.get(area) ?? Promise.resolve();
  /** Reads the inbox, applies the change, and writes it back. */
  const run = async () => {
    const record = await readInbox(BRAINS_ROOT, area);
    const result = await change(record);
    await writeInbox(BRAINS_ROOT, record);
    return result;
  };
  /** Ignores the earlier pass's outcome; this pass runs either way. */
  const ignoreEarlier = () => undefined;
  const next = earlier.then(ignoreEarlier, ignoreEarlier).then(run);
  inboxWrites.set(area, next);
  /** Forgets the chain once this pass is the last one on the Area. */
  const forget = () => {
    if (inboxWrites.get(area) === next) inboxWrites.delete(area);
  };
  next.then(forget, forget);
  return next;
}

/** Writes one notice for the Area's brain and returns it. */
async function recordBrainNotice(area, text) {
  return withInbox(area, (record) => appendNotice(record, text));
}

/** Every notice no generation of one brain has read, oldest first. */
async function unreadBrainNotices(area) {
  return mergeNotices(inboxesForBrain(await readAllInboxes(BRAINS_ROOT), area));
}

/**
 * Marks notices read by one brain session and generation, and lets go of
 * them: they are no longer on their way anywhere.
 */
async function markBrainNoticesDelivered(notices, session, generation) {
  releaseBrainNotices(notices);
  const byArea = new Map();
  for (const notice of notices) {
    const ids = byArea.get(notice.area) ?? [];
    ids.push(notice.id);
    byArea.set(notice.area, ids);
  }
  for (const [area, ids] of byArea) {
    await withInbox(area, (record) => markDelivered(record, ids, { session, generation }));
  }
}

// A notice is "on its way" from the moment it is queued or put into a new
// generation's first message until it is marked read or that way failed. The
// sweep in flushBrainNotices queues only notices that are not on their way,
// so a retry never doubles a delivery that is still in progress, and a
// failed delivery is tried again at the next sweep.
const noticesOnTheirWay = new Set(); // "area\u0000id"

/** The key of one notice in the on-their-way set. */
function noticeKey(notice) {
  return `${notice.area}\u0000${notice.id}`;
}

/** Remembers that these notices are on their way to a brain. */
function holdBrainNotices(notices) {
  for (const notice of notices) noticesOnTheirWay.add(noticeKey(notice));
}

/** Forgets that these notices are on their way; they may be queued again. */
function releaseBrainNotices(notices) {
  for (const notice of notices) noticesOnTheirWay.delete(noticeKey(notice));
}

/**
 * Tells the brain that covers an Area what happened, as a message from
 * `tangent`. The notice is persisted first, then queued when a brain session
 * is live; the queue delivers it into an idle composer and a working brain
 * reads it when it pauses. With no live brain the notice waits on disk for
 * the next generation. Returns true when a live brain was addressed.
 */
async function notifyBrain(area, text) {
  try {
    const message = normalizeMessage(text);
    const owner = brainRecordForArea(await readAllBrains(BRAINS_ROOT), area);
    if (!owner) return false;
    const notice = await recordBrainNotice(area, message);
    const record = await liveBrainForArea(area);
    if (!record) {
      await logAgentMessage({ event: "kept", to: `${owner.area} brain`, from: "tangent", text: message, reason: "no live brain; waits for the next generation" });
      return false;
    }
    const notices = [{ area, id: notice.id }];
    holdBrainNotices(notices);
    queueAgentMessage(record.session, {
      from: "tangent",
      area: null,
      text: message,
      notices,
      generation: record.generation ?? null,
      queuedAt: new Date().toISOString(),
    });
    await logAgentMessage({ event: "sent", to: record.session, from: "tangent", text: message, disposition: "queued", reason: "brain event" });
    return true;
  } catch (err) {
    console.error("brain notify:", err.message ?? err);
    return false;
  }
}

/**
 * Queues every unread notice that is not already on its way, for the brains
 * that run right now. The server calls this when it starts (the memory queue
 * is gone after a restart, the notices are not) and on every reconcile pass,
 * so a notice whose delivery failed or whose queue entry died with an old
 * generation's session still reaches the live generation.
 */
async function flushBrainNotices(sessions = null, reason = "unread notices after a server start") {
  const live = new Set((sessions ?? await listSessions()).map((session) => session.name));
  for (const record of await readAllBrains(BRAINS_ROOT)) {
    if (record.status !== "running" || !record.session || !live.has(record.session)) continue;
    const unread = (await unreadBrainNotices(record.area)).filter((notice) => !noticesOnTheirWay.has(noticeKey(notice)));
    if (!unread.length) continue;
    const text = unread.length === 1 ? unread[0].text : noticeDigest(unread);
    const notices = unread.map((notice) => ({ area: notice.area, id: notice.id }));
    holdBrainNotices(notices);
    queueAgentMessage(record.session, {
      from: "tangent",
      area: null,
      text,
      notices,
      generation: record.generation ?? null,
      queuedAt: new Date().toISOString(),
    });
    await logAgentMessage({ event: "sent", to: record.session, from: "tangent", text, disposition: "queued", reason });
  }
}

/**
 * The registry model ids one harness offers, or the standard three
 * (fable-5, sonnet-5, opus-5) when the harness is not in the registry
 * (the profile and legacy fallbacks never resolve through it).
 */
async function areaHarnessModelIds(harnessId) {
  const registry = await harnessRegistry();
  const entry = !registry.error ? (registry.harnesses ?? []).find((item) => item.id === harnessId) : null;
  const ids = entry ? harnessModels(registry, entry).map((model) => model.id) : [];
  return ids.length ? ids : ["fable-5", "sonnet-5", "opus-5"];
}

/**
 * The first message of one brain generation: instruction, sources, the
 * notices no generation read, and policy. The notices come from the
 * generation entry, so this rebuilds the message the brain was given.
 */
async function brainPrompt(record) {
  const area = record.area;
  const generation = currentGeneration(record)?.generation ?? 1;
  const notices = currentGeneration(record)?.notices ?? [];
  const notes = areaNoteFiles(area);
  const documents = (await readAreaDocuments(area)).filter((doc) => doc.file !== record.planFile);
  const planPath = path.join(TREES_ROOT, record.planFile);
  const handover = latestHandover(record);
  const harness = (await areaHarnessId(area)) ?? "claude";
  const modelIds = await areaHarnessModelIds(harness);
  /** The wanted model id when the harness offers it, else its first model. */
  const pickModel = (id) => (modelIds.includes(id) ? id : modelIds[0]);
  const designModel = pickModel("fable-5");
  const implementModel = pickModel("sonnet-5");
  const harnessRule = `Every --launch in this Area is ${harness}/<model>; models: ${modelIds.join(", ")}; never another harness unless Julian says so.`;
  const sourceLines = [
    `- Plan: ${planPath} (yours; create it if it does not exist)`,
    `- Area folder: ${path.join(TREES_ROOT, area)}`,
    ...notes.map((note, index) => `- Area note ${index + 1}: ${note}`),
    ...documents.map((doc) => `- Document: ${path.join(TREES_ROOT, doc.file)}`),
  ];
  return (
    `# Brain for ${area}\n\n` +
    `You are the brain of the Area ${area}: the one long-lived agent that plans and dispatches its work. Julian started you with the instruction below and will mostly leave you alone. This is generation ${generation} of this brain${handover ? "; the earlier generation handed over the facts under Handover" : ""}.\n\n` +
    `## Julian's instruction\n\n${record.instruction}\n\n` +
    `## Sources\n\n${sourceLines.join("\n")}\n\n` +
    (handover ? `## Handover from generation ${generation - 1}\n\n${handover}\n\n` : "") +
    (notices.length
      ? `## Notices you have not read\n\nTangent recorded these while no generation of this brain was reading. Each one is an agent event under this Area. Read them before you plan, and act on the ones that need it.\n\n${noticeBlock(notices)}\n\n`
      : "") +
    `## How to work\n\n` +
    `${harnessRule}\n\n` +
    `On takeover, run \`tangent agent list\` and sweep every running step's pane: a session shown as "needs decision" or "draft" carries an \`asks:\` line with the question, and it is stuck waiting on a person, not idle. Answer it or message the worker (\`tangent agent send <session> "..."\`) before anything else.\n\n` +
    `Read the plan first when it exists, then the Area notes from nearest to farthest, then the Documents that matter. Look at the Area's repository when code answers a question better than a guess.\n\n` +
    `Before you create a Goal or start a worker, write the proposed result, Goals and done conditions, agent count, assignments, dependencies, parallel work, and known risks in the plan. Commit it with \`tangent vault commit\`. Then request one approval with \`tangent brain request --kind plan --subject "Work plan" --question "Approve this plan?" --detail "<short Goals, agents, and order summary>"\`. Wait for the durable approval notice. A changed Goal boundary or larger scope needs a new plan request. A retry, model change, or review pass inside the approved boundary does not. Julian may also comment in the plan; \`tangent document comments <file>\` lists comments and \`tangent document resolve\` closes one after the work is done.\n\n` +
    `Split the work into Goals: a Goal is a result with a clear finish. Create a sub-Area only for a durable subject Julian will return to (\`tangent area create <parent> <name>\`). Give each Goal a description a fresh agent can start from: intent, what Julian decided, and the Documents and code that matter (\`tangent goal create --area ${area} --title "..." --done-when "..." --description "..." --source <vault-file>\`).\n\n` +
    `Start each leaf Goal as a pipeline, for example: \`tangent goal start <slug> --step "/design this Goal" --launch ${harness}/${designModel} --step "/impl the design at <path>" --launch ${harness}/${designModel} --step "implement the solution" --launch ${harness}/${implementModel} --step "review the implementation against the design and solution; fix what is wrong" --launch ${harness}/${designModel}\`. Judge each Goal: when the work is small and clear, one implementer step is enough; when it is hard or vague, raise the implementer to Opus or Fable and keep the design step. Fable plans, designs, decomposes, and reviews; Sonnet is the workhorse. Run one implementing pipeline per repository at a time; design and review steps may run in parallel. \`tangent agent list\` shows what runs and \`tangent goal list ${area}\` shows the Goals.\n\n` +
    `Tangent sends you durable worker reports. Read the handover and the files. You alone choose the next transition. Start a pending approved assignment with \`tangent brain advance <goal> <step>\`. When a review asks for changes, append an assignment. When a result is good, note it in the plan and start what its completion unblocked. Workers do not choose successors.\n\n` +
    `Ask Julian only through structured requests. Use kind decision with repeated --option values for user behavior, user-facing choices, one-way doors, and material scope changes. Use kind test with exact test steps. Use kind approval only when policy requires an explicit final approval. The answer returns to this brain as a durable notice. Julian started this brain to get the approved Goals done. When a Goal's final review passes and its done condition holds, write the verdict into the Goal State and close it in the same turn. A finished Goal left waiting is a brain failure.\n\n` +
    `## Requests for Julian\n\n` +
    `Create requests with \`tangent brain request\`. Do not use plan Markdown as a control protocol. Plan reviews use Approve plan and Request changes. Tests use Pass and Needs work. Decisions use the option names you supply. Each request must state what waits for the answer. If a visible Agent Shell change needs a test, run \`tangent shell rebuild\` before you create the test request. Document comments are a separate direct lane and still arrive here as durable notices.\n\n` +
    `## When to hand over\n\n` +
    `Before every handover, sweep \`tangent goal list ${area}\` and \`tangent agent list\` for any Goal whose pipeline finished and close it (\`tangent goal done <slug>\` or \`tangent goal wont-do <slug> --reason "..."\`); a finished Goal left waiting is a failure, never something to hand off to the next generation. In the same sweep, check \`tangent agent list\` for a running step showing "needs decision" or "draft" and answer it; do not hand over a step sitting stuck on a question the next generation has to notice all over again. Then, at a natural pause, after a wave is dispatched or a batch of results is processed, and always when Tangent reminds you, write the plan status and run \`tangent brain handover "<facts>"\`: what runs (Goal, step, session), what waits and why, decisions taken, what the next generation should do first. Facts, no narrative. A fresh copy of you starts from the plan and those facts, and this session ends.`
  );
}

/** Creates and primes the next generation's session for one brain record. */
async function spawnBrainSession(record) {
  const sessions = await listSessions();
  const names = new Set(sessions.map((item) => item.name));
  const generation = (record.generations?.length ?? 0) + 1;
  let name = brainSessionName(record.area, generation);
  for (let k = 2; names.has(name); k += 1) name = `${brainSessionName(record.area, generation).slice(0, 55)}-r${k}`;
  const directory = (await areaDirectory(record.area)) ?? path.join(TREES_ROOT, record.area);
  try {
    await execFileAsync("tmux", ["new-session", "-d", "-s", name, "-c", directory]);
  } catch (error) {
    return { status: 500, error: `could not create the brain session: ${error.stderr ?? error.message ?? error}` };
  }
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_area", record.area]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_kind", "brain"]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_phase", "orchestrate"]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_brain", record.area]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_generation", String(generation)]);
  if (record.label) await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_launch", record.label]);
  const entry = beginGeneration(record, name);
  // The notices no generation read belong in this generation's first
  // message. They are kept on the record so the desk can show the message
  // the brain actually got, and marked read only after that message showed
  // in the new session's composer. Until then they are on their way, so the
  // sweep does not queue them a second time; if the message never arrives
  // they are let go, stay unread, and the sweep queues them for whichever
  // generation is live.
  const unread = await unreadBrainNotices(record.area);
  entry.notices = unread.map((notice) => ({ area: notice.area, id: notice.id, text: notice.text, createdAt: notice.createdAt }));
  await writeBrain(BRAINS_ROOT, record);
  holdBrainNotices(unread);
  /** Settles the notices once the first message arrived, or failed to. */
  const firstMessageTyped = async (arrived) => {
    if (!unread.length) return;
    if (arrived) await markBrainNoticesDelivered(unread, name, generation);
    else releaseBrainNotices(unread);
  };
  if (process.env.AGENT_SHELL_TEST_NO_LAUNCH === "1") {
    await firstMessageTyped(true);
    return { status: 200, session: name, generation, brain: record };
  }
  await sleep(700);
  let primed = false;
  try {
    primed = await primeDescribeWorkSession(name, record.area, await brainPrompt(record), { launch: true, command: record.command, onTyped: firstMessageTyped });
  } catch (error) {
    console.error("brain session:", error.message ?? error);
  }
  if (!primed) releaseBrainNotices(unread);
  return { status: 200, session: name, generation, brain: record };
}

/**
 * Starts a brain on an Area from Julian's instruction, resumes a stopped or
 * ended one, or reattaches to the one that runs. One brain per Area.
 */
async function startBrain(area, { instruction = "", choice = null, command = "", resume = false } = {}) {
  if (!area || !existsSync(path.join(TREES_ROOT, area))) return { status: 404, error: `no Area ${area || "(none)"}` };
  const overlap = (await readAllBrains(BRAINS_ROOT)).find((record) => record.area !== area && record.status === "running" && (area.startsWith(`${record.area}/`) || record.area.startsWith(`${area}/`)));
  if (overlap) return { status: 409, error: `brain ${overlap.area} already controls overlapping work; stop or transfer it before starting ${area}` };
  const existing = await readBrain(BRAINS_ROOT, area);
  if (existing?.status === "running" && existing.session) {
    const live = await execFileAsync("tmux", ["has-session", "-t", "=" + existing.session]).then(() => true, () => false);
    if (live) return { status: 200, session: existing.session, generation: existing.generation, brain: existing, reattached: true };
  }
  if (resume) {
    if (!existing) return { status: 404, error: "no brain to resume on this Area" };
    return spawnBrainSession(existing);
  }
  const invalid = validateInstruction(instruction);
  if (invalid) return { status: 400, error: invalid };
  // Fable plans by default; the picker, an edited command, or the Area
  // default (when the registry has no Fable) replace it.
  let launch = await requestedLaunch({ choice, command });
  let ref = command ? null : choice;
  if (!launch.error && !launch.command) {
    const registry = await harnessRegistry();
    const fable = registry.error ? { error: registry.error } : resolveLaunch(registry, { harness: "claude", model: "fable-5" });
    if (!fable.error) {
      launch = fable;
      ref = { harness: "claude", model: "fable-5", effort: null };
    } else {
      launch = await launchForArea(area);
      ref = launch.harness ? { harness: launch.harness, model: launch.model ?? null, effort: launch.effort ?? null } : null;
    }
  }
  if (launch.error) return { status: 409, error: launch.error };
  const leaf = area.split("/").pop();
  let record;
  try {
    record = newBrain({
      area,
      instruction,
      launch: ref,
      command: launch.command,
      label: launch.label ?? "",
      planFile: `${area}/plan-${leaf}.md`,
    });
  } catch (error) {
    return { status: 400, error: String(error.message ?? error) };
  }
  return spawnBrainSession(record);
}

/**
 * The brain hands over to itself: record the facts, start the next
 * generation, and end this session once the new one is primed. On a failed
 * spawn the old session stays alive and hears the error.
 */
async function handoverBrain(sessionName, text) {
  const records = await readAllBrains(BRAINS_ROOT);
  const record = records.find((item) => item.status === "running" && item.session === sessionName);
  if (!record) return { status: 404, error: "this session is not a running brain" };
  const previous = sessionName;
  recordHandover(record, text);
  await writeBrain(BRAINS_ROOT, record);
  const started = await spawnBrainSession(record);
  if (started.status !== 200) {
    queueAgentMessage(previous, { from: "tangent", area: null, text: `Handover recorded, but the next generation could not start: ${started.error}. You are still the brain.`, queuedAt: new Date().toISOString() });
    return started;
  }
  setTimeout(() => {
    execFileAsync("tmux", ["kill-session", "-t", "=" + previous]).catch(() => {});
  }, 1500).unref();
  return { status: 200, state: "started", session: started.session, generation: started.generation, previous, brain: record };
}

/** Ends the brain whose current session Julian killed, if any. */
async function endBrainForSession(sessionName) {
  const records = await readAllBrains(BRAINS_ROOT);
  const record = records.find((item) => item.status === "running" && item.session === sessionName);
  if (!record) return null;
  endBrain(record, "ended");
  await writeBrain(BRAINS_ROOT, record);
  return record;
}

/** Reports a failed notice sweep without stopping the reconcile pass. */
function reportNoticeSweepFailure(err) {
  console.error("brain notices:", err.message ?? err);
}

/** Reports a failed unshown-lines sweep without stopping the reconcile pass. */
function reportUnshownFailure(err) {
  console.error("brain unshown lines:", err.message ?? err);
}

/** The one message that names what Tangent hid, and the shapes that are shown. */
function unshownNotice(lines) {
  const shown = lines.slice(0, 3).map((line) => `"${line.trim()}"`).join(", ");
  const rest = lines.length > 3 ? ` and ${lines.length - 3} more` : "";
  const subject = lines.length === 1 ? "1 line in your plan's For Julian section is" : `${lines.length} lines in your plan's For Julian section are`;
  return `${subject} not shown on Julian's desk: ${shown}${rest}. `
    + `The shapes: "- Decide [[<document>]]: <question>? Unblocks: <what>.", "- Decide: <question>?", "- Test [[<goal-slug>]]: <where, press, see>." `
    + `A Decide ask must end with ?, and every [[target]] must resolve. Run tangent brain status to see what parses.`;
}

/**
 * Tells one brain, once per plan change, which lines of its `## For Julian`
 * section Tangent shows nothing for: lines in no known shape, and rows whose
 * [[target]] resolves to nothing. Hiding a line must never be silent, and it
 * must never nag: the hash of the section is kept on the record, so a section
 * that did not change since the last look sends nothing.
 */
async function reportUnshownForJulian(record, index) {
  const text = await brainPlanText(record);
  if (!text) return;
  const hash = createHash("sha256").update(forJulianSectionText(text)).digest("hex");
  if (hash === record.forJulianNoticeHash) return;
  const lines = [
    ...unparsedForJulianLines(text).map((item) => item.line),
    ...(await forJulianItems(record, index)).filter((row) => row.missing).map((row) => row.line),
  ];
  record.forJulianNoticeHash = hash;
  await writeBrain(BRAINS_ROOT, record);
  if (lines.length) await notifyBrain(record.area, unshownNotice(lines));
}

/**
 * Queues unread brain notices for live brains, marks running brains whose
 * session is gone as stopped, and reminds a long-running generation once to
 * hand over.
 */
async function reconcileBrains(sessions) {
  const live = new Set(sessions.map((item) => item.name));
  const now = Date.now();
  await flushBrainNotices(sessions, "unread notices found by a sweep").catch(reportNoticeSweepFailure);
  const index = await vaultIndex();
  for (const record of await readAllBrains(BRAINS_ROOT)) {
    if (record.status === "running" || record.status === "stopped") {
      await reportUnshownForJulian(record, index).catch(reportUnshownFailure);
    }
    if (record.status !== "running" || !record.session) continue;
    if (!live.has(record.session)) {
      endBrain(record, "stopped");
      await writeBrain(BRAINS_ROOT, record);
      continue;
    }
    const entry = currentGeneration(record);
    if (!entry || entry.remindedAt || now - Date.parse(entry.startedAt) < BRAIN_REFRESH_MS) continue;
    entry.remindedAt = new Date().toISOString();
    await writeBrain(BRAINS_ROOT, record);
    const minutes = Math.round((now - Date.parse(entry.startedAt)) / 60_000);
    queueAgentMessage(record.session, { from: "tangent", area: null, text: `You have run ${minutes} minutes in this generation. At the next natural pause, write the plan status and run tangent brain handover "<facts>".`, queuedAt: new Date().toISOString() });
  }
}

/**
 * Reminds a worker whose carried context has passed the handover threshold
 * to hand its step or Goal to a fresh copy of itself (D1 C, D3). Scope:
 * pipeline steps and solo Goal sessions (kind "goal", phase "execute");
 * brains, work-definition, collaborate, and study sessions never see this.
 * The reminder holder is the running step (pipeline) or a lazily-created
 * solo continuation record (no record churn on a quiet session).
 */
async function reconcileContextHandovers(sessions) {
  for (const session of sessions) {
    if (session.kind !== "goal" || session.phase !== "execute") continue;
    const pipelineHit = await pipelineStepForSession(session.name);
    let execution;
    if (pipelineHit) {
      const { record, step } = pipelineHit;
      execution = pipelineExecution({
        record,
        step,
        /** Persists the enclosing pipeline record. */
        save: (next) => writePipeline(PIPELINES_ROOT, next),
      });
    } else if (session.goal) {
      const byFile = await goalsByFile();
      const o = byFile.get(session.goal);
      if (!o) continue;
      const existing = await readContinuation(CONTINUATIONS_ROOT, o.area, o.slug);
      const record = existing ?? newContinuationRecord({ goal: o.file, area: o.area, slug: o.slug, session: session.name });
      execution = soloExecution({
        record,
        area: o.area,
        /** Persists the solo execution record. */
        save: (next) => writeContinuation(CONTINUATIONS_ROOT, next),
      });
    } else {
      continue;
    }
    const { area, subject } = execution;
    const reminders = execution.reminder(session.name);
    const level = reminderDue({ fill: session.context, thresholdTokens: CONTEXT_HANDOVER_TOKENS, reminders });
    if (!level) continue;
    const now = new Date().toISOString();
    await execution.saveReminder(session.name, { firstAt: reminders?.firstAt ?? (level === "first" ? now : null), repeatAt: level === "repeat" ? now : reminders?.repeatAt ?? null });
    const controller = brainForArea(await readAllBrains(BRAINS_ROOT), area);
    const brainControlledText = level === "first"
      ? `Your context is nearly full. At the next natural pause, report your files, checks, unresolved facts, and first next action to the brain with: tangent handover "<facts>". The brain will decide whether a fresh worker continues.`
      : `Your context is well past the handover threshold. Report to the brain now with: tangent handover "<facts>".`;
    queueAgentMessage(session.name, {
      from: "tangent",
      area,
      kind: "context-reminder",
      text: controller ? brainControlledText : level === "first"
        ? contextReminderText({ ...session.context, subject })
        : contextRepeatText({ usedTokens: session.context.usedTokens, thresholdTokens: CONTEXT_HANDOVER_TOKENS, subject }),
      // Rebuilt at delivery time so the fill number is current, not the one
      // read at queue time (design touchpoint 1).
      /** Rebuilds the reminder with the latest pane context at delivery time. */
      render: () => {
        const fill = paneSamples.get(session.name)?.context;
        if (!fill) return null;
        if (controller) return brainControlledText;
        return level === "first"
          ? contextReminderText({ ...fill, subject })
          : contextRepeatText({ usedTokens: fill.usedTokens, thresholdTokens: CONTEXT_HANDOVER_TOKENS, subject });
      },
      queuedAt: now,
    });
  }
}

/** The plan text of one brain record, or "" when the plan does not exist yet. */
async function brainPlanText(record) {
  if (!record?.planFile) return "";
  const safe = safeMarkdownPath(TREES_ROOT, record.planFile);
  if (!safe) return "";
  return readFile(safe.absolute, "utf8").catch(() => "");
}

/**
 * The rows the brain wrote for Julian, resolved against the vault index so the
 * desk can show titles and comment counts without a second request.
 * Returns [] when the plan has no section.
 */
async function forJulianItems(record, index) {
  const rows = parseForJulian(await brainPlanText(record));
  return rows.map((row) => {
    const item = { ...row, file: null, title: null, commentCount: 0, missing: false, goalStatus: null };
    if (row.kind === "decide" && !row.target) return { ...item, title: row.text };
    const hit = row.kind === "decide"
      ? index.documents.find((document) => linkTargetsRecord(row.target, document))
      : index.documents.find((document) => document.kind === "goal" && path.basename(document.file, ".md") === `goal-${row.target}`);
    if (!hit) return { ...item, file: row.kind === "decide" ? row.target : null, title: row.target, missing: true };
    if (row.kind === "decide") {
      return { ...item, file: hit.file, title: hit.title, commentCount: hit.commentCount ?? 0 };
    }
    return { ...item, file: hit.file, title: hit.title, goalStatus: hit.status ?? null };
  });
}

/**
 * The brain record of exactly this Area, running or not. A stopped brain's
 * rows stay on the desk, so its plan is still Julian's to edit.
 */
async function brainOfArea(area) {
  return (await readAllBrains(BRAINS_ROOT)).find((record) => record.area === area) ?? null;
}

/**
 * Julian answered one row: the line leaves the plan's `## For Julian`
 * section, the plan is committed, and the brain hears the verdict. Both
 * verbs are answers, so both travel: Accept means go with it as written,
 * a bare Reject means he parks the subject and the brain must not raise it
 * again. Only a row with a target goes this way; a targetless Decide is
 * answered in the brain's own terminal. The brain need not be live: with no
 * live session the notice waits on disk for the next generation.
 */
async function clearRowWithVerdict(area, line, verdict) {
  if (verdict !== "accept" && verdict !== "reject") return { status: 400, error: "the verdict is accept or reject" };
  const record = await brainOfArea(area);
  if (!record) return { status: 404, error: `no brain on ${area || "(none)"}` };
  if (!String(line ?? "").trim()) return { status: 400, error: "no line" };
  const current = await readVaultDocument(record.planFile);
  if (!current) return { status: 404, error: `no plan ${record.planFile}` };
  const row = parseForJulian(current.text).find((item) => item.line.trimEnd() === String(line).trimEnd());
  if (!row) return { status: 404, error: "the plan has no such line" };
  if (!row.target) return { status: 400, error: "a targetless Decide is answered in the brain terminal" };
  const { text, removed, index, removedText } = removeForJulianLine(current.text, line);
  if (!removed) return { status: 404, error: "the plan has no such line" };
  const past = verdict === "accept" ? "accepted" : "rejected";
  await writeVaultDocument(current, text, `update: ${area} plan ${row.target} ${past}`);
  await notifyBrain(area, `Julian ${past} ${row.target}`);
  return { status: 200, line: row.line, removedText, index, target: row.target, verdict };
}

/**
 * Julian pressed Undo on a verdict: the line goes back where it was and the
 * brain hears that the verdict is withdrawn, so it never acts on an answer
 * that was taken back.
 */
async function restoreVerdictLine(area, line, index) {
  const record = await brainOfArea(area);
  if (!record) return { status: 404, error: `no brain on ${area || "(none)"}` };
  if (!String(line ?? "").trim()) return { status: 400, error: "no line" };
  const current = await readVaultDocument(record.planFile);
  if (!current) return { status: 404, error: `no plan ${record.planFile}` };
  const text = restoreForJulianLine(current.text, line, index);
  const row = parseForJulian(text).find((item) => item.line.trimEnd() === String(line).trimEnd());
  const target = row?.target ?? "row";
  await writeVaultDocument(current, text, `update: ${area} plan restore ${target}`);
  await notifyBrain(area, `Julian withdrew his verdict on ${target}; the line is back`);
  return { status: 200 };
}

/**
 * Tells the Area's brain which For-you row Julian is about to reply to,
 * right before he opens its terminal, so whatever he types next is read
 * with that row's subject already named.
 */
async function noteReplySubject(area, subject) {
  const record = await brainOfArea(area);
  if (!record) return { status: 404, error: `no brain on ${area || "(none)"}` };
  const clean = String(subject ?? "").trim();
  if (!clean) return { status: 400, error: "no subject" };
  await notifyBrain(area, `Julian is replying about: ${clean}`);
  return { status: 200 };
}

/** Every brain record with its current session's live state, for the desk. */
async function brainsView(sessions) {
  const byName = new Map(sessions.map((item) => [item.name, item]));
  const index = await vaultIndex();
  const records = await readAllBrains(BRAINS_ROOT);
  return Promise.all(records.map(async (record) => {
    const live = record.session ? byName.get(record.session) : null;
    return {
      ...record,
      live: Boolean(live),
      state: live?.state ?? null,
      stateDetail: live?.stateDetail ?? null,
      stateQuestion: live?.stateQuestion ?? "",
      idleSince: live?.idleSince ?? null,
      latestHandover: latestHandover(record),
      forJulian: await forJulianItems(record, index),
      requests: openBrainRequests(await readBrainRequests(BRAINS_ROOT, record.area)),
    };
  }));
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
          const requested = String(a.session ?? "").trim();
          const target = requested ? resolveSession(requested, sessions) : focused;
          if (!target) {
            summary.push(`no session "${requested}" — pressed nothing`);
            break;
          }
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

const brainRoutes = createBrainRoutes({
  start: startBrain,
  handover: handoverBrain,
  normalizeMessage,
  verdict: clearRowWithVerdict,
  undoVerdict: restoreVerdictLine,
  reply: noteReplySubject,
  /** Creates a request only for the calling live brain session. */
  async createRequest(session, input) {
    const brain = (await readAllBrains(BRAINS_ROOT)).find((item) => item.session === session && item.status === "running");
    if (!brain) return { status: 403, error: "only a live brain can create a request" };
    const record = await readBrainRequests(BRAINS_ROOT, brain.area);
    try {
      const request = createBrainRequest(record, input);
      await writeBrainRequests(BRAINS_ROOT, record);
      return { status: 200, request };
    } catch (error) { return { status: 400, error: String(error.message ?? error) }; }
  },
  /** Records Julian's request answer and delivers it to the brain inbox. */
  async answerRequest(area, id, answer) {
    const brain = await brainOfArea(area);
    if (!brain) return { status: 404, error: `no brain on ${area}` };
    const record = await readBrainRequests(BRAINS_ROOT, brain.area);
    try {
      const request = answerBrainRequest(record, id, answer);
      await writeBrainRequests(BRAINS_ROOT, record);
      await notifyBrain(brain.area, `Julian answered ${request.kind} request "${request.subject}": ${request.answer}`);
      return { status: 200, request };
    } catch (error) { return { status: 400, error: String(error.message ?? error) }; }
  },
  /** Finds one enriched brain record by Area or session. */
  async show(area, session) {
    const brains = await brainsView(await listSessions()).catch(() => []);
    return brains.find((item) => (area && item.area === area) || (session && item.session === session)) ?? null;
  },
  /** Returns the plan lines that the parser could not classify. */
  async unparsed(brain) {
    return unparsedForJulianLines(await brainPlanText(brain)).map((item) => item.line);
  },
  prompt: brainPrompt,
});
const pipelineRoutes = createPipelineRoutes({
  normalizeMessage,
  continueWorker: continueWorkerSession,
  handoverStep: handoverPipelineStep,
  control: controlPipeline,
  append: appendPipelineSteps,
  edit: editPipelineStep,
});
const agentRoutes = createAgentRoutes({
  /** Returns every live non-process session with its delivery state. */
  async list() {
    return (await listSessions())
      .filter((session) => !["process", "service", "command"].includes(session.kind ?? ""))
      .map((session) => ({
        name: session.name,
        area: session.area,
        kind: session.kind,
        goal: session.goalTitle ?? null,
        state: session.state,
        stateDetail: session.stateDetail ?? null,
        stateQuestion: session.stateQuestion ?? "",
        queued: (messageQueues.get(session.name) ?? []).length,
      }));
  },
  /** Delivers or queues one normalized cross-agent message. */
  async send(body) {
    const text = normalizeMessage(body.text);
    const sessions = await listSessions();
    const target = resolveSession(String(body.to ?? ""), sessions);
    const live = sessions.find((session) => session.name === target);
    const decision = deliveryDecision(live ?? null);
    if (decision.action === "refuse") return { status: live ? 409 : 404, error: decision.error };
    const sender = sessions.find((session) => session.name === String(body.from ?? ""));
    const entry = { from: sender?.name ?? "unknown sender", area: sender?.area ?? null, text, queuedAt: new Date().toISOString() };
    if (decision.action === "deliver" && !(messageQueues.get(live.name) ?? []).length) {
      deliverAgentMessage(live.name, entry).catch((error) => console.error("agent message:", error.message ?? error));
      await logAgentMessage({ event: "sent", to: live.name, from: entry.from, text, disposition: "delivered" });
      return { status: 200, value: { status: "delivered", to: live.name } };
    }
    queueAgentMessage(live.name, entry);
    const reason = decision.action === "queue" ? decision.reason : "messages queued ahead";
    await logAgentMessage({ event: "sent", to: live.name, from: entry.from, text, disposition: "queued", reason });
    return { status: 200, value: { status: "queued", to: live.name, reason, position: messageQueues.get(live.name).length } };
  },
});
const areaRoutes = createAreaRoutes({
  /** Returns the complete Area tree. */
  async tree() {
    return { root: TREES_ROOT, areas: await readTree(TREES_ROOT) };
  },
  /** Returns one Area's note sections and own Goals. */
  async show(area) {
    if (!area || !flattenAreaPaths(await readTree(TREES_ROOT)).includes(area)) return null;
    const text = await areaNote(area);
    return {
      area,
      purpose: noteSection(text, "Purpose"),
      resources: noteSection(text, "Resources"),
      goals: (await readAreaGoals(area)).map(goalSummary),
      ideas: ideasFromNote(text),
    };
  },
  /** Creates and commits one Area. */
  async create(body) {
    const created = await createArea({ treesRoot: TREES_ROOT, parent: body.parent, name: body.name });
    await runVaultGit(["add", "--", ...created.changedPaths]);
    await vaultCommit(created.changedPaths, `add: ${created.area} Area`, created.area, null);
    return created;
  },
  /** Describes one valid Area move. */
  previewMove: (body) => previewAreaMove({ treesRoot: TREES_ROOT, area: body.area, parent: body.parent, name: body.name }),
  /** Moves an Area, its vault paths, and live session bindings. */
  async move(body) {
    if (await areaHasGitChanges({ treesRoot: TREES_ROOT, area: body.area, runGitCapture: captureVaultGit })) {
      throw new Error("Save or discard this area's pending vault edits before you move it.");
    }
    const moved = await moveArea({ treesRoot: TREES_ROOT, area: body.area, parent: body.parent, name: body.name, runGit: runVaultGit });
    await moveSessionBindings(moved);
    await vaultCommit([moved.source, moved.destination], `update: ${moved.source} moves to ${moved.destination}`, moved.destination, null);
    return moved;
  },
});
const programRoutes = createProgramRoutes({
  /** Returns local programs with live status. */
  async list() {
    return programsSnapshot({ treesRoot: TREES_ROOT, sessions: await listProgramSessions() });
  },
  /** Creates one local process or command. */
  async create(body) {
    return saveLocalProgram({ treesRoot: TREES_ROOT, area: body.area, type: body.type, name: body.name, command: body.command, cwd: body.cwd });
  },
  /** Applies one control action to a configured program. */
  async control(body) {
    const snapshot = await programsSnapshot({ treesRoot: TREES_ROOT, sessions: await listProgramSessions() });
    const program = snapshot.programs.find((item) => item.id === body.id);
    if (!program) throw new Error("The program no longer exists.");
    const action = String(body.action ?? "");
    if (program.type === "process") {
      if (!["start", "stop", "restart", "close"].includes(action)) throw new Error("Choose Start, Stop, Restart, or Close.");
      await runLocalTangent(["process", action, program.name, "--area", program.area]);
    } else if (program.type === "command") {
      await controlCommand(program, action);
    } else {
      throw new Error("Choose Start, Run, Stop, Restart, or Close.");
    }
    return { ok: true };
  },
});
const documentRoutes = createDocumentRoutes({
  /** Returns the vault index with its server-owned desk projection. */
  async vault() {
    const [vault, sessions] = await Promise.all([vaultIndex(), listSessions()]);
    return { ...vault, desk: projectDesk(vault, sessions) };
  },
  readMap: readMapState,
  writeMap: writeMapState,
  validArea: validAreaPath,
  readDocument: readVaultDocument,
  writeDocument: saveVaultDocument,
  notifyComments: notifyBrainOfDocumentComments,
  resolve: resolveVaultDocumentComment,
});
const shellControlRoutes = createShellControlRoutes({
  spawn: spawnSession,
  /** Toggles caffeinate and returns its resulting state. */
  caffeinate(on) {
    setCaffeinate(on);
    return caffeinateProc !== null;
  },
  /** Starts a detached rebuild when mutations are allowed. */
  async rebuild() {
    if (process.env.TANGENT_VERIFY_READONLY) return { status: 403, value: { error: "Rebuild is disabled in the verification harness." } };
    return rebuildOperations.start();
  },
  /** Changes the orchestrator command and stops its old session. */
  async agent(command) {
    agentCmd = command;
    await execFileAsync("tmux", ["kill-session", "-t", "=" + CHAT_SESSION]).catch(() => {});
    return agentCmd;
  },
  /** Kills one exact non-orchestrator session and closes its execution records. */
  async kill(name) {
    if (!name || name === CHAT_SESSION) return { status: 400, error: "refusing to kill this session" };
    try {
      await execFileAsync("tmux", ["kill-session", "-t", "=" + name]);
      const ended = await endPipelineForSession(name).catch((error) => { console.error("end pipeline on kill:", error.message ?? error); return null; });
      const brainEnded = await endBrainForSession(name).catch((error) => { console.error("end brain on kill:", error.message ?? error); return null; });
      return { status: 200, value: { ok: true, pipelineEnded: Boolean(ended), brainEnded: Boolean(brainEnded) } };
    } catch (error) {
      return { status: 500, error: String(error.stderr ?? error.message ?? error) };
    }
  },
});
const shellStateRoutes = createShellStateRoutes({
  chatSession: CHAT_SESSION,
  /** Returns one coherent live shell snapshot. */
  async snapshot() {
    const sessions = await listSessions();
    const [pipelines, brains, revisions, rebuild] = await Promise.all([
      pipelinesView(sessions).catch(() => []),
      brainsView(sessions).catch(() => []),
      commitChanges.status().catch(() => ({ deployedCommit: commitChanges.deployedCommit, currentCommit: commitChanges.deployedCommit, commits: [] })),
      rebuildOperations.current().catch(() => null),
    ]);
    return {
      agent: agentCmd,
      boot: BOOT_ID,
      sourceChanged: revisions.commits.length > 0,
      deployedCommit: revisions.deployedCommit,
      currentCommit: revisions.currentCommit,
      pendingCommits: revisions.commits,
      rebuild,
      caffeinate: caffeinateProc !== null,
      voice: Boolean(GROQ_KEY),
      sessions,
      pipelines,
      brains,
      contextHandoverTokens: CONTEXT_HANDOVER_TOKENS,
    };
  },
});
const voiceRoutes = createVoiceRoutes({
  chatSession: CHAT_SESSION,
  /** Reports whether transcription and command routing are configured. */
  available: () => Boolean(GROQ_KEY),
  context: voiceContext,
  transcribe,
  nameHints: voiceNameHints,
  route: routeAndExecute,
});
const goalQueryRoutes = createGoalQueryRoutes({
  /** Lists summarized Goals in one Area or the whole vault. */
  async list(area) {
    const allAreas = flattenAreaPaths(await readTree(TREES_ROOT));
    if (area && !allAreas.includes(area)) return { status: 404, error: `no area "${area}"` };
    const goals = [];
    for (const one of area ? [area] : allAreas) goals.push(...(await readAreaGoals(one)).map(goalSummary));
    return { status: 200, value: { goals } };
  },
  /** Finds one complete Goal by slug. */
  async show(slug) {
    for (const area of flattenAreaPaths(await readTree(TREES_ROOT))) {
      const goal = (await readAreaGoals(area)).find((item) => item.slug === slug);
      if (goal) return { status: 200, value: { goal } };
    }
    return { status: 404, error: `no goal ${slug}` };
  },
  /** Owns or releases a set of Goals for one live session. */
  async ownership(body, releasing) {
    const session = String(body.session ?? "").trim();
    const slugs = (Array.isArray(body.slugs) ? body.slugs : []).map(String).filter(Boolean);
    const verb = releasing ? "release" : "own";
    if (!session || !slugs.length) return { status: 400, error: `${verb} needs a session name and at least one goal slug` };
    const liveSessions = await listSessions();
    const live = new Set(liveSessions.map((item) => item.name));
    if (!releasing && !live.has(session)) return { status: 404, error: `no tmux session "${session}"; run this inside the agent's session or pass --session` };
    const bySlug = new Map([...(await goalsByFile()).values()].map((goal) => [goal.slug, goal]));
    const resolved = [];
    for (const slug of slugs) {
      const goal = bySlug.get(slug);
      if (!goal) return { status: 404, error: `no goal ${slug}` };
      if (!releasing && ["done", "dropped"].includes(goal.status)) return { status: 409, error: `goal ${slug} is ${goal.status}` };
      if (goal.session && goal.session !== session && live.has(goal.session)) return { status: 409, error: `goal ${slug} is owned by ${goal.session}` };
      resolved.push(goal);
    }
    try {
      for (const goal of resolved) {
        const target = releasing ? { status: "open", session: null } : { status: "active", session };
        if (goal.status === target.status && (goal.session ?? null) === target.session) continue;
        if (releasing && goal.status !== "active") continue;
        await writeGoalBinding(goal.file, target);
        await vaultCommit([goal.file], `update: ${goal.area} goal ${goal.slug} ${releasing ? "released" : `owned by ${session}`}`, goal.area, releasing ? null : session);
      }
      if (!releasing && resolved.length) await adoptGoalSession(liveSessions, session, resolved[0]);
      return { status: 200, value: { ok: true, session, slugs: resolved.map((goal) => goal.slug) } };
    } catch (error) {
      return { status: 500, error: String(error.stderr ?? error.message ?? error) };
    }
  },
  /** Builds the Goal, prompt, command, and context launch brief. */
  async brief(file, mode = "goal", step = 0) {
    const goal = (await goalsByFile()).get(file);
    if (!goal) return { status: 404, error: `no goal file ${file}` };
    let markdown;
    if (mode === "collaborate") markdown = await collaborationPrompt(goal.area, goal);
    else if (mode === "pipeline") {
      const record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
      if (!record) return { status: 404, error: "this Goal has no pipeline" };
      const selected = record.steps.find((item) => item.index === step) ?? currentStep(record) ?? record.steps[0];
      markdown = await pipelineStepPrompt(goal.area, goal, record, selected.index, [], selected.session ?? "");
    } else markdown = await goalPrompt(goal.area, goal);
    return {
      status: 200,
      value: {
        goal,
        markdown,
        agent: await agentCmdForArea(goal.area).then(withDefaultModel).catch(() => ""),
        context: await goalContext(goal.area, goal),
      },
    };
  },
});
const launchRoutes = createLaunchRoutes({
  /** Opens one validated work-definition session. */
  async describe(body) {
    const area = String(body.area ?? "");
    const description = String(body.description ?? "").trim().slice(0, 12_000);
    if (!area || !flattenAreaPaths(await readTree(TREES_ROOT)).includes(area)) return { status: 404, error: `no area "${area}"` };
    if (!description) return { status: 400, error: "describe the work before you open an agent" };
    const chosen = await requestedLaunch(body);
    if (chosen.error) return { status: 400, error: chosen.error };
    try {
      const sources = await sourceDocuments(body.sources);
      const result = await spawnDescribeWorkSession(area, description, sources, { session: String(body.session ?? ""), launch: body.launch !== false, command: chosen.command, label: chosen.label });
      return { status: result.status, ...(result.status === 200 ? { value: result } : { error: result.error }) };
    } catch (error) { return { status: 500, error: String(error.stderr ?? error.message ?? error) }; }
  },
  /** Returns the raw harness registry. */
  async readHarnesses() {
    const registry = await harnessRegistry();
    return registry.error ? { status: 500, error: registry.error } : { status: 200, value: { registry } };
  },
  /** Validates and commits a replacement harness registry. */
  async writeHarnesses(body) {
    const registry = { version: 1, modelSets: body.modelSets ?? {}, ...(body.effortSets && Object.keys(body.effortSets).length ? { effortSets: body.effortSets } : {}), harnesses: body.harnesses ?? [] };
    const problem = validateHarnessRegistry(registry);
    if (problem) return { status: 400, error: problem };
    const text = await readFile(path.join(TREES_ROOT, "harnesses.md"), "utf8").catch(() => "");
    await vaultRepository.writeMarkdown("harnesses.md", upsertHarnessRegistry(text, registry));
    await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", "harnesses.md"]).catch(() => {});
    await vaultCommit(["harnesses.md"], "update: harness registry from Agent Shell", "machine", null);
    return { status: 200, value: { ok: true } };
  },
  /** Returns named launch choices and the Area default. */
  async options(area) {
    const registry = await harnessRegistry();
    if (registry.error) return { status: 500, error: registry.error };
    return { status: 200, value: {
      harnesses: registry.harnesses.map((harness) => ({ id: harness.id, label: harness.label || harness.id, command: harness.command, models: harnessModels(registry, harness).map((model) => ({ id: model.id, label: model.label || model.id, args: model.args, efforts: modelEfforts(registry, harness, model).map((effort) => ({ id: effort.id, label: effort.label || effort.id, args: effort.args })) })), efforts: harnessEfforts(registry, harness).map((effort) => ({ id: effort.id, label: effort.label || effort.id, args: effort.args })) })),
      default: await launchForArea(area),
    } };
  },
  /** Commits one Area's explicit default launch. */
  async saveDefault(body) {
    const area = String(body.area ?? "");
    const registry = await harnessRegistry();
    const resolved = registry.error ? registry : resolveLaunch(registry, body.launch ?? {});
    if (resolved.error || !area) return { status: 400, error: resolved.error || "an area is required" };
    const file = areaNoteFile(area);
    const text = await readFile(path.join(TREES_ROOT, file), "utf8").catch(() => emptyAreaNote(area));
    const ref = { harness: resolved.harness, ...(resolved.model ? { model: resolved.model } : {}), ...(resolved.effort ? { effort: resolved.effort } : {}) };
    await vaultRepository.writeMarkdown(file, upsertEnvironmentLaunch(text, ref));
    await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", file]).catch(() => {});
    await vaultCommit([file], `update: ${area} default launch ${resolved.label}`, area, null);
    return { status: 200, value: { label: resolved.label, command: resolved.command } };
  },
  /** Starts a Goal agent in collaboration mode. */
  async collaborate(body) {
    const chosen = await requestedLaunch(body);
    if (chosen.error) return { status: 400, error: chosen.error };
    try {
      const [focus] = await sourceDocuments(body.document ? [body.document] : []);
      const result = await startGoal(String(body.file ?? ""), { phase: "collaborate", launch: body.launch === true, document: focus?.file ?? "", command: chosen.command, label: chosen.label, extraFiles: Array.isArray(body.extraFiles) ? body.extraFiles.map(String) : [] });
      return { status: result.status, ...(result.status === 200 ? { value: result } : { error: result.error }) };
    } catch (error) { return { status: 500, error: String(error.stderr ?? error.message ?? error) }; }
  },
  /** Starts a Goal agent or a validated pipeline. */
  async start(body) {
    try {
      const caller = String(body.caller ?? "").trim();
      if (caller) {
        const goal = (await goalsByFile()).get(String(body.file ?? ""));
        if (!goal) return { status: 404, error: `no goal file ${String(body.file ?? "")}` };
        const brains = await readAllBrains(BRAINS_ROOT);
        const callerBrain = brains.find((item) => item.session === caller && item.status === "running");
        if (!callerBrain) return { status: 403, error: "workers cannot start agents; report to the controlling brain with tangent handover" };
        const controller = brainForArea(brains, goal.area);
        if (!controller || controller.session !== caller) return { status: 403, error: `${caller} does not control ${goal.area}` };
        if (!hasApprovedPlan(await readBrainRequests(BRAINS_ROOT, controller.area))) return { status: 409, error: "Julian must approve the brain's plan before it starts workers" };
      }
      if (Array.isArray(body.steps) && body.steps.length) {
        const result = await startPipeline(String(body.file ?? ""), { steps: body.steps, extraFiles: Array.isArray(body.extraFiles) ? body.extraFiles.map(String) : [] });
        return { status: result.status, ...(result.status === 200 ? { value: { session: result.session, pipeline: result.pipeline, warnings: result.warnings ?? [] } } : { error: result.error }) };
      }
      const chosen = await requestedLaunch(body);
      if (chosen.error) return { status: 400, error: chosen.error };
      const result = await startGoal(String(body.file ?? ""), { phase: "execute", approved: body.approved === true, launch: body.launch === true, command: chosen.command, label: chosen.label, extraFiles: Array.isArray(body.extraFiles) ? body.extraFiles.map(String) : [] });
      return { status: result.status, ...(result.status === 200 ? { value: { session: result.session, reattached: Boolean(result.reattached), primed: Boolean(result.primed) } } : { error: result.error }) };
    } catch (error) { return { status: 500, error: String(error.stderr ?? error.message ?? error) }; }
  },
});
const workMutationRoutes = createWorkMutationRoutes({
  /** Records Julian's understanding of one Goal. */
  async understanding(body) {
    const file = String(body.file ?? "");
    const understanding = String(body.understanding ?? "").trim();
    const goal = (await goalsByFile()).get(file);
    if (!goal) return { status: 404, error: `no goal file ${file}` };
    if (!understanding) return { status: 400, error: "Write what you think this work means." };
    try {
      await editGoalFile(file, { understanding });
      await vaultCommit([file], `update: ${goal.area} goal ${goal.slug} records Julian's understanding`, goal.area, null);
      return { status: 200, value: { ok: true, understanding } };
    } catch (error) { return serverError(error); }
  },
  /** Accepts one Goal assignment. */
  async accept(body) {
    try {
      const result = await acceptGoalAssignment(String(body.file ?? ""));
      return { status: result.status, ...(result.status === 200 ? { value: { ok: true } } : { error: result.error }) };
    } catch (error) { return serverError(error); }
  },
  /** Creates one simple Goal. */
  async createSimple(body) {
    const area = String(body.area ?? "");
    const title = String(body.title ?? "").trim();
    const doneWhen = String(body.doneWhen ?? "").trim();
    if (!await areaExists(area)) return { status: 404, error: `no area "${area}"` };
    if (!title || !doneWhen) return { status: 400, error: !title ? "a title is required" : "a Goal needs a done condition" };
    try { return { status: 200, value: { file: await createGoalFile(area, { title, doneWhen, state: typeof body.state === "string" ? body.state : "" }) } }; }
    catch (error) { return serverError(error); }
  },
  /** Creates one Goal with optional Subgoals, sources, and ownership. */
  async create(body) {
    const area = String(body.area ?? "");
    const goal = body.goal && typeof body.goal === "object" ? body.goal : {};
    if (!await areaExists(area)) return { status: 404, error: `no area "${area}"` };
    if (!String(goal.title ?? "").trim() || !String(goal.doneWhen ?? "").trim()) return { status: 400, error: "the Goal needs a name and a done condition" };
    const caller = String(body.caller ?? "").trim();
    if (caller) {
      const brains = await readAllBrains(BRAINS_ROOT);
      const callerBrain = brains.find((item) => item.session === caller && item.status === "running");
      if (!callerBrain) return { status: 403, error: "workers cannot create Goals; report to the controlling brain with tangent handover" };
      const controller = brainForArea(brains, area);
      if (!controller || controller.session !== caller) return { status: 403, error: `${caller} does not control ${area}` };
      const requestRecord = await readBrainRequests(BRAINS_ROOT, callerBrain.area);
      if (!hasApprovedPlan(requestRecord)) return { status: 409, error: "Julian must approve the brain's plan before it creates Goals" };
    }
    const subgoals = (Array.isArray(body.subgoals) ? body.subgoals.slice(0, 8) : []).map((item) => ({ title: String(item?.title ?? "").trim(), doneWhen: String(item?.doneWhen ?? "").trim(), state: "Not started." })).filter((item) => item.title || item.doneWhen);
    if (subgoals.some((item) => !item.title || !item.doneWhen)) return { status: 400, error: "each Subgoal needs a name and a done condition" };
    const own = String(body.own ?? "").trim();
    const sessions = own ? await listSessions() : [];
    if (own && !sessions.some((session) => session.name === own)) return { status: 404, error: `no tmux session "${own}"; run create --own inside the agent's session or pass --session` };
    try {
      const sources = await sourceDocuments(body.sources);
      const created = await createGoalSet(area, { goal: { title: String(goal.title).trim(), doneWhen: String(goal.doneWhen).trim(), state: String(goal.state ?? "Not started.").trim() }, subgoals, description: String(body.description ?? "").trim(), sources: sources.map((source) => ({ file: source.file, title: source.title })) });
      if (own && created.file) {
        await writeGoalBinding(created.file, { status: "active", session: own });
        await vaultCommit([created.file], `update: ${area} goal owned by ${own}`, area, own);
        await adoptGoalSession(sessions, own, { area, file: created.file });
      }
      return { status: 200, value: { ...created, ...(own ? { session: own } : {}) } };
    } catch (error) { return serverError(error); }
  },
  /** Saves one idea on an Area. */
  async createIdea(body) {
    const area = String(body.area ?? "");
    const description = String(body.description ?? "").trim();
    if (!await areaExists(area)) return { status: 404, error: `no area "${area}"` };
    if (!description) return { status: 400, error: "describe the idea before you save it" };
    try { return { status: 200, value: { ok: true, file: await saveWorkIdea(area, description) } }; }
    catch (error) { return serverError(error); }
  },
  /** Lists ideas in one Area or the complete vault. */
  async ideas({ area = null }) {
    const allAreas = flattenAreaPaths(await readTree(TREES_ROOT));
    if (area && !allAreas.includes(area)) return { status: 404, error: `no area "${area}"` };
    const ideas = [];
    for (const one of area ? [area] : allAreas) ideas.push(...ideasFromNote(await areaNote(one)).map((text) => ({ area: one, text })));
    return { status: 200, value: { ideas } };
  },
  /** Marks an Area done or active without changing its Goals. */
  async areaStatus(body) {
    const area = String(body.area ?? "");
    const status = String(body.status ?? "");
    if (!validAreaPath(area) || !["done", "active"].includes(status)) return { status: 400, error: "area and status (done or active) required" };
    try { await stat(path.join(TREES_ROOT, area)); }
    catch { return { status: 404, error: `no Area ${area}` }; }
    return { status: 200, value: await setAreaStatus(area, status, body.session ? String(body.session) : null) };
  },
  /** Applies validated direct edits and status changes to one Goal. */
  async edit(body) {
    const file = String(body.file ?? "");
    const goal = (await goalsByFile()).get(file);
    if (!goal) return { status: 404, error: `no goal file ${file}` };
    const fields = {};
    if (body.status !== undefined) {
      if (!["open", "done", "dropped"].includes(body.status)) return { status: 400, error: `status must be open, done, or dropped, got "${body.status}"` };
      fields.status = body.status;
      if (body.status === "dropped") {
        const reason = oneLine(body.reason);
        if (!reason) return { status: 400, error: "give a brief reason before you mark this goal won't do" };
        fields.wontDoReason = reason;
      }
    }
    for (const key of ["title", "doneWhen", "state"]) if (typeof body[key] === "string") fields[key] = body[key];
    if (!Object.keys(fields).length) return { status: 400, error: "nothing to edit" };
    try {
      await editGoalFile(file, fields);
      if (fields.status === "dropped" && goal.session) await execFileAsync("tmux", ["kill-session", "-t", "=" + goal.session]).catch(() => {});
      const changed = fields.status === "done" ? await cascadeGoalDone(file, await goalsByFile()) : [file];
      if (!changed.includes(file)) changed.unshift(file);
      const what = fields.status === "done" ? "done" : fields.status === "dropped" ? "marked won't do" : fields.status === "open" ? "reopened" : "edited";
      await vaultCommit(changed, `update: ${goal.area} goal ${goal.slug} ${what} in tree`, goal.area, body.session ? String(body.session) : null);
      return { status: 200, value: { ok: true } };
    } catch (error) { return serverError(error); }
  },
});

/** Reports whether one Area exists in the current vault tree. */
async function areaExists(area) {
  return Boolean(area) && flattenAreaPaths(await readTree(TREES_ROOT)).includes(area);
}

/** Converts an unexpected mutation failure to an HTTP operation result. */
function serverError(error) {
  return { status: 500, error: String(error.stderr ?? error.message ?? error) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/api/events" && req.method === "GET") {
      stateEvents.connect(req, res);
      return;
    }
    if (url.pathname === "/api/telemetry/action" && req.method === "POST") {
      const body = await readJson(req);
      await recordActionTelemetry(ACTION_TELEMETRY_LOG, body).catch(() => {});
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST") {
      res.once("finish", () => {
        if (res.statusCode < 400) stateEvents.changed(url.pathname);
      });
    }
    if (await shellStateRoutes.handle(req, res, url)) return;
    if (await brainRoutes.handle(req, res, url)) return;
    if (await pipelineRoutes.handle(req, res, url)) return;
    if (await agentRoutes.handle(req, res, url)) return;
    if (await areaRoutes.handle(req, res, url)) return;
    if (await programRoutes.handle(req, res, url)) return;
    if (await documentRoutes.handle(req, res, url)) return;
    if (await shellControlRoutes.handle(req, res, url)) return;
    if (await voiceRoutes.handle(req, res, url)) return;
    if (await goalQueryRoutes.handle(req, res, url)) return;
    if (await launchRoutes.handle(req, res, url)) return;
    if (await workMutationRoutes.handle(req, res, url)) return;
    await serveStaticAsset(url, res, here);
  } catch {
    res.writeHead(404).end("not found");
  }
});

attachTerminalTransport(server, {
  port: PORT,
  workspace: WORKSPACE,
  chatSession: CHAT_SESSION,
  chatCommand: withDefaultModel(agentCmd),
});

server.listen(PORT, HOST, () => {
  console.log(`agent-shell: http://${HOST}:${PORT}`);
  console.log(`  orchestrator session "${CHAT_SESSION}" runs: ${agentCmd}`);
  console.log(`  workspace: ${WORKSPACE}`);
  runtimeScheduler.wake();
  if (!process.env.AGENT_SHELL_NO_OPEN) openStandaloneWindow();
  // The message queue died with the last process; the notices did not.
  /** Reports a failed flush without stopping the server. */
  const flushFailed = (err) => console.error("brain notices:", err.message ?? err);
  flushBrainNotices().catch(flushFailed);
  // A prompt armed by the last process is still waiting on disk if its
  // harness had not left the shell yet.
  rearmPersistedPrompts().catch((err) => console.error("armed prompts:", err.message ?? err));
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
