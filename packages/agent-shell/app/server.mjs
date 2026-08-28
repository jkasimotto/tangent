// Agent Shell prototype server.
// Serves the focus-and-return frontend and bridges WebSocket connections to
// tmux sessions through node-pty.
import http from "node:http";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { execFile, fork, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doneCascade } from "./goal-cascade.mjs";
import { describeAreaResources, resolveWorkFolder, unboundAreaMessage } from "./area-resources.mjs";
import { launchRef, migrateEnvironmentV1, parseLaunch, resolveLaunch } from "./launch-environment.mjs";
import { createLaunchCatalog } from "./launch-catalog.mjs";
import { createLaunchMemory } from "./launch-memory.mjs";
import { cleanAreaPath, createArea, moveArea, areaHasGitChanges, previewAreaMove } from "./area-operations.mjs";
import { commandSession, programsSnapshot, saveLocalProgram } from "./programs.mjs";
import { discoverProcesses, evaluateProcess, goalNamesProcess, processFileExists, processView, readAreaProcesses, readProcessState, removeProcessState, sweepProcesses, withProcessStatus } from "./process-scheduler.mjs";
import { formatLoopNote, parseProcessNote, validateProcessSlug } from "./process-note.mjs";
import { documentHash, markdownTitle, safeMarkdownPath, wikiLinks } from "./vault-documents.mjs";
import documentComments from "./public/document-comments.js";
import areaMapCore from "./public/area-map-core.js";
import whatHappenedCore from "./public/what-happened-core.js";
import { createVaultGitReader, fileTimes } from "./area-map.mjs";
import { createPaneObserver } from "./pane-observer.mjs";
import { classifyWorkingComposer } from "./pane-state.mjs";
import { mapWithConcurrency } from "./bounded-work.mjs";
import { createObservationCache } from "./observation-cache.mjs";
import { appendSteps, continuationSource, currentStep, endPipeline, goalBindingGoneFromSnapshot, newPipeline, nextPendingStep, pipelineFinished, pipelineStatus, queueNormalizationChanged, readAllPipelines, readPipeline, reclaimLiveSteps, recordTypedReport, snapshotCanJudgeAbsence, stepGoneFromSnapshot, validateSteps, writePipeline } from "./pipeline-record.mjs";
import { readAllContinuations, readContinuation } from "./continuation-record.mjs";
import { contextReminderText, contextRepeatText, continuationSection, reminderDue } from "./context-handover.mjs";
import { messageBanner, noticeMessage, normalizeMessage } from "./agent-messages.mjs";
import { beginGeneration, brainOwnsArea, brainRecordForArea, brainSessionName, brainSessionNames, currentGeneration, endBrain, latestHandover, newBrain, readAllBrains, readBrain, validateInstruction, writeBrain } from "./brain-record.mjs";
import { resolveBrainAttemptLaunch } from "./brain-launch.mjs";
import { refreshBrainObservation } from "./brain-lifecycle.mjs";
import { appendNotice, inboxesForBrain, markDelivered, mergeNotices, noticeBlock, noticeDigest, readAllInboxes, readInbox, unreadNotices, writeInbox } from "./brain-inbox.mjs";
import { forJulianSectionText, parseForJulian, removeForJulianLine, restoreForJulianLine, unparsedForJulianLines } from "./for-julian.mjs";
import { createCommitChangeMonitor } from "./commit-change-monitor.mjs";
import { promptArrived, readyForText, splitPrompt, squash, typeChunks } from "./prompt-delivery.mjs";
import { clearArmedPrompt, readAllArmedPrompts, writeArmedPrompt } from "./armed-prompts.mjs";
import { createPaneWriteQueue } from "./pane-writes.mjs";
import { createRuntimeScheduler } from "./runtime-scheduler.mjs";
import { attachTerminalTransport } from "./terminal-transport.mjs";
import { serveStaticAsset } from "./static-assets.mjs";
import { createStateEvents } from "./state-events.mjs";
import { createBrainRoutes } from "./brain-routes.mjs";
import { answerBrainRequest, beginRequestEffect, brainRequestAnswerNotice, closeBrainRequests, closeGoalRequests, createBrainRequest, dismissBrainRequest, finishRequestEffect, openBrainRequests, readBrainRequests, withdrawBrainRequest, writeBrainRequests } from "./brain-requests.mjs";
import { createPipelineRoutes } from "./pipeline-routes.mjs";
import { createAgentRoutes } from "./agent-routes.mjs";
import { resolveAgentContext, unassignedAgentContext } from "./agent-context.mjs";
import { workerShellExitNotice } from "./agent-recovery.mjs";
import { createVaultRepository } from "./vault-repository.mjs";
import { pipelineExecution } from "./execution-record.mjs";
import { createAreaRoutes } from "./area-routes.mjs";
import { createProgramRoutes } from "./program-routes.mjs";
import { createProcessRoutes } from "./process-routes.mjs";
import { parseSkillNote, projectSkills, routeSkills, skillSlugFromFile } from "./area-skills.mjs";
import { createDocumentRoutes } from "./document-routes.mjs";
import { projectDesk } from "./desk-projection.mjs";
import { createShellControlRoutes } from "./shell-control-routes.mjs";
import { goalStopTarget } from "./goal-stop.mjs";
import { createShellStateRoutes } from "./shell-state-routes.mjs";
import { createVoiceRoutes } from "./voice-routes.mjs";
import { createGoalQueryRoutes } from "./goal-query-routes.mjs";
import { filterGoalSummaries, goalQueryFilters, hasGoalQueryFilters } from "./goal-query-filters.mjs";
import { changeGoalDependencies, dependencySlugs, projectGoalDependencies, writeDependencySlugs } from "./goal-dependencies.mjs";
import { createLaunchRoutes } from "./launch-routes.mjs";
import { createWorkMutationRoutes } from "./work-mutation-routes.mjs";
import { recordActionTelemetry } from "./action-telemetry.mjs";
import { createMessageDelivery } from "./message-delivery.mjs";
import { openMessageQueueStore } from "./message-queue-store.mjs";
import { areaInboxTarget, commandActor } from "./command-provenance.mjs";
import { createRebuildOperations, readRebuildOperation, rebuildIsActive } from "./rebuild-operation.mjs";
import { HttpError, readJson, sendJson } from "./http-json.mjs";
import { createVaultProjectionController } from "./vault-projection-controller.mjs";
import { startEventLoopWatchdog } from "./event-loop-watchdog.mjs";
import { uniqueSessionName } from "./session-names.mjs";
import { withDefaultModel } from "./agent-command.mjs";
import { findCodexRollouts, launchWithConversation, newConversation, resumeCommand } from "./harness-conversation.mjs";
import { clearGoalCleanup, readAllGoalCleanups, readGoalCleanup, writeGoalCleanup } from "./goal-cleanup-record.mjs";
import { appendJournalEntry, appendMilestone, emergencyStartProblem, exportLegacyAudit, journalFiles, querySubtreeMilestones, readJournalEntry, readMilestones } from "./area-brain-domain.mjs";
import { areaDirectory, areaFilePrefix, isRootArea, ROOT_AREA, rootAreaRow } from "./area-identity.mjs";
import { materialOperationEvents, markOperationEventDelivered, readOperationEvents, writeOperationEvents } from "./operation-events.mjs";
import { agentShellInstanceId, createSessionOwnership, SESSION_OWNER_OPTION } from "./session-ownership.mjs";
import { appendWorkerHandoverReceipt, pendingWorkerHandoverReceipts, recordWorkerHandoverNotice, workerHandoverReceipt } from "./worker-handover-receipt.mjs";
import { projectGoalDetail } from "./goal-detail.mjs";
import { SETTLED_GOAL_STATUSES, goalIsFlaggedForVerify, goalStatusChange, normalizeGoalRecord, normalizeGoalStatus } from "./goal-lifecycle.mjs";
import { withoutBrainGoalBinding, withoutBrainGoalBindings } from "./goal-brain-binding.mjs";
import { notifyGoalWaitsForCheck, removeGoalCheckNotification } from "./julian-notify.mjs";
import { appendIdea, areaNoteTemplate, areaTitle, currentSectionKey, ensureAreaNoteLinks, ensureVaultRootLinks, ideasFilePath, ideasFromFile, noteSignal, orderGoals, vaultRootAgentsText } from "./area-note-links.mjs";
import { newAttemptReplacement, readAllAttemptReplacements, readAttemptReplacement, sameAttemptReplacementRequest, transitionAttemptReplacement, unsettledAttemptReplacements, writeAttemptReplacement } from "./goal-attempt-replacement.mjs";
import { GoalExecutionTransitionError, attachLateSourceEvidence, parkCurrentGoalAttempt, promoteReadyReplacement, reopenParkedGoalQueue } from "./goal-execution-transition.mjs";
import { dismissGoalDocument, markGoalDocumentOpened, presentGoalDocument, projectPresentations, pruneMissingPresentations, readGoalPresentations, removeGoalPresentations, withdrawGoalDocument } from "./goal-presentations.mjs";
import { createGoalPresentationRoutes } from "./goal-presentation-routes.mjs";

const rawExecFileAsync = promisify(execFile);
const TMUX_COMMAND_TIMEOUT_MS = Number(process.env.TANGENT_TMUX_COMMAND_TIMEOUT_MS ?? 10_000);
const TMUX_COMMAND_MAX_BYTES = Number(process.env.TANGENT_TMUX_COMMAND_MAX_BYTES ?? 8 * 1024 * 1024);

/** Gives every tmux subprocess a hard lifetime and output budget. */
function execFileAsync(file, args, options = {}) {
  return rawExecFileAsync(file, args, file === "tmux"
    ? { timeout: TMUX_COMMAND_TIMEOUT_MS, maxBuffer: TMUX_COMMAND_MAX_BYTES, ...options }
    : options);
}
const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? "127.0.0.1";
const IS_CONTROLLER = process.env.AGENT_SHELL_CONTROLLER === "1";
if (process.env.AGENT_SHELL_INDEX_WORKER !== "1") startEventLoopWatchdog({
  timeoutMs: Number(process.env.TANGENT_CONTROLLER_WATCHDOG_TIMEOUT_MS ?? 15_000),
  heartbeatMs: 1_000,
});
// A fresh controller id. The gateway passes its separate process identity so
// an explicit rebuild can replace the process that owns browser assets.
const BOOT_ID = randomUUID();
const RUNTIME_BOOT_ID = process.env.AGENT_SHELL_GATEWAY_BOOT || BOOT_ID;
const RUNTIME_SERVER_PID = Number(process.env.AGENT_SHELL_GATEWAY_PID || process.pid);
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
  bootId: RUNTIME_BOOT_ID,
  serverPid: RUNTIME_SERVER_PID,
  /** Reads the commit range at the exact rebuild start boundary. */
  revisions: () => commitChanges.status(),
});
const stateEvents = createStateEvents();
let agentCmd = process.env.AGENT_CMD ?? "claude";

/** Emits causal stage timings for a mutation that can cross process boundaries. */
function traceOperation(name, fields = {}) {
  const id = randomUUID();
  const startedAt = Date.now();
  let previousAt = startedAt;
  /** Writes one bounded JSON line that survives a later watchdog exit. */
  const write = (stage, extra = {}) => {
    const at = Date.now();
    console.error(`[runtime] ${JSON.stringify({ operation: name, id, stage, elapsedMs: at - startedAt, stageMs: at - previousAt, ...fields, ...extra })}`);
    previousAt = at;
  };
  write("started");
  return { id, mark: write };
}

const CHAT_SESSION = process.env.CHAT_SESSION ?? "orchestrator";
const WORKSPACE = process.env.WORKSPACE ?? path.join(here, "workspace");
const TREES_ROOT = process.env.TREES_ROOT ?? path.join(os.homedir(), ".tangent", "trees");
const INSTANCE_ID = agentShellInstanceId({
  explicit: process.env.TANGENT_SHELL_INSTANCE_ID,
  host: HOST,
  port: PORT,
  treesRoot: TREES_ROOT,
  chatSession: CHAT_SESSION,
});
const SESSION_OWNERS_ROOT = process.env.TANGENT_SESSION_OWNERS_ROOT
  ?? (process.env.TANGENT_BRAINS_ROOT
    ? path.join(path.dirname(process.env.TANGENT_BRAINS_ROOT), "session-owners")
    : path.join(os.homedir(), ".tangent", "agent-shell", "session-owners"));
const sessionOwnership = createSessionOwnership({
  instanceId: INSTANCE_ID,
  root: SESSION_OWNERS_ROOT,
  /** Runs one ownership command through the bounded tmux executor. */
  runTmux: (args) => execFileAsync("tmux", args),
});
/** Runs one Git command for the vault repository boundary. */
const runRepositoryGit = (args) => execFileAsync("git", args);
const vaultRepository = createVaultRepository({ root: TREES_ROOT, runGit: runRepositoryGit });
const launchMemory = createLaunchMemory(process.env.TANGENT_LAUNCH_MEMORY ?? path.join(os.homedir(), ".tangent", "agent-shell", "launch-memory.json"));
const launchCatalog = createLaunchCatalog({
  root: TREES_ROOT,
  readAreaNote: areaNote,
  repository: vaultRepository,
  commit: vaultCommit,
  /** Stages exactly one launch-owned vault file before its provenance commit. */
  stage: (file) => execFileAsync("git", ["-C", TREES_ROOT, "add", "--", file]).catch(() => {}),
  areaFile: areaNoteFile,
  emptyAreaNote,
  memory: launchMemory,
  /** Lists every Area for descendant policy validation. */
  listAreas: async () => flattenAreaPaths(await readTree(TREES_ROOT)),
});
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
const PRESENTATIONS_ROOT = process.env.TANGENT_PRESENTATIONS_ROOT
  ?? (process.env.TANGENT_PIPELINES_ROOT ? path.join(path.dirname(process.env.TANGENT_PIPELINES_ROOT), "presented") : path.join(os.homedir(), ".tangent", "agent-shell", "presented"));
// One JSON record per Goal for a solo (non-pipeline) session's context
// continuations: the same mechanism pipeline steps keep inline on the step
// (design-worker-context-handover D6).
const CONTINUATIONS_ROOT = process.env.TANGENT_CONTINUATIONS_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "continuations");
// Recoverable failures from retiring workers of finished Goals.
const GOAL_CLEANUPS_ROOT = process.env.TANGENT_GOAL_CLEANUPS_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "goal-cleanups");
// Idempotent attempt replacement operations stay outside the vault beside
// the queue records whose immutable attempt history they change.
const ATTEMPT_REPLACEMENTS_ROOT = process.env.TANGENT_ATTEMPT_REPLACEMENTS_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "attempt-replacements");
// One JSON record per exact Area brain: logical lifecycle, founding
// instruction, checkpoint, launch, and runtime attempt diagnostics.
const BRAINS_ROOT = process.env.TANGENT_BRAINS_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "brains");
// One JSON record per process note (`<area>/process-<slug>.md`): when it was
// last due, when the brain was told, and the Goal it created (ADR-0043).
const PROCESSES_ROOT = process.env.TANGENT_PROCESSES_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "processes");

// Persist the additive subject identity for pre-lifecycle Request records.
// The v1 envelope stays readable, and no request status or answer changes.
for (const brain of await readAllBrains(BRAINS_ROOT)) {
  const requests = await readBrainRequests(BRAINS_ROOT, brain.area);
  for (const request of requests.requests) {
    if (request.effectOperation?.status !== "running") continue;
    request.effectOperation.status = "failed";
    request.effectOperation.finishedAt = new Date().toISOString();
    request.effectOperation.problem = "The Agent Shell process ended before this exact effect recorded a result. Retry the effect.";
  }
  if (requests.requests.length) await writeBrainRequests(BRAINS_ROOT, requests);
}
const BRAIN_RECOVERY_LIMIT = 3;
// A running step idle this long without a handover is reported to the brain once.
const BRAIN_IDLE_NOTICE_MS = Number(process.env.TANGENT_BRAIN_IDLE_MINUTES ?? 10) * 60_000;
// A running step's pane sitting this long at a decision menu or an unsent
// draft is reported to the brain once (Julian, 2026-08-22): the classifier
// has false positives, so a step that answers itself within the threshold
// must never notify.
const BRAIN_WAIT_NOTICE_MS = Number(process.env.TANGENT_BRAIN_WAIT_MINUTES ?? 5) * 60_000;
const RECONCILE_INTERVAL_MS = Math.max(10, Number(process.env.TANGENT_RECONCILE_INTERVAL_MS ?? 10_000));
// The carried-context threshold at which a worker must report context risk
// to its queue controller. One
// absolute token count, never a percentage: a model whose window is at or
// under this just uses its full window, today's behavior.
const CONTEXT_HANDOVER_TOKENS = Number(process.env.TANGENT_CONTEXT_HANDOVER_TOKENS ?? 300_000);

/**
 * The closing section of every worker prompt: the one Tangent command a
 * worker has (D5). The same four lines close a review step; --done on a
 * review step means the review passed.
 */
function workerSendSection() {
  return (
    `## When you finish\n\n` +
    `You have one Tangent command. Run it inside this session.\n\n` +
    `    tangent send brain "<note>"            a note to the brain, no status change\n` +
    `    tangent send brain --done "<note>" [--present <file>]  the work is finished; present each document Julian must read\n` +
    `    tangent send brain --blocked "<note>"  you cannot continue; say why\n` +
    `    tangent send brain --question "<note>" you need a decision; ask it\n\n` +
    `Do not run other tangent commands. Do not change the Goal file's frontmatter. The brain marks the Goal done.`
  );
}
// One JSON record per session with a prompt armed to type once its harness
// leaves the shell (armSession below), so the arm survives a server restart
// between typing the launch command and the harness coming up. Rules and
// file shape live in armed-prompts.mjs.
const ARMED_ROOT = process.env.TANGENT_ARMED_ROOT ?? path.join(os.homedir(), ".tangent", "agent-shell", "armed");

if (!existsSync(WORKSPACE)) mkdirSync(WORKSPACE, { recursive: true });

const legacyWorkflowClaims = new Set();

/** Claims pre-marker live work only when its durable record and tmux tags agree. */
async function claimLegacyWorkflowSessions(sessions) {
  const candidates = sessions.filter((session) => !session.instanceId && ["brain", "goal"].includes(session.kind) && !legacyWorkflowClaims.has(session.name));
  if (!candidates.length) return;
  const expectedBySession = new Map();
  for (const brain of await readAllBrains(BRAINS_ROOT)) {
    if (brain.status !== "active" || !brain.session) continue;
    expectedBySession.set(brain.session, { kind: "brain", area: brain.area, brain: brain.area, generation: brain.generation });
  }
  for (const pipeline of await readAllPipelines(PIPELINES_ROOT)) {
    for (const step of pipeline.steps ?? []) {
      if (!["running", "waiting"].includes(step.status) || !step.session) continue;
      expectedBySession.set(step.session, {
        kind: "goal", area: pipeline.area, goal: pipeline.goal, pipeline: pipeline.goal, step: step.index,
      });
    }
  }
  for (const session of candidates) {
    legacyWorkflowClaims.add(session.name);
    const expected = expectedBySession.get(session.name);
    if (!expected) continue;
    const claimed = await sessionOwnership.claimLegacySession({ session: session.name, expected });
    if (!["claimed", "owned"].includes(claimed.state)) continue;
    session.instanceId = INSTANCE_ID;
    session.owned = true;
    console.error(`[runtime] ${JSON.stringify({ operation: "claim-legacy-workflow", session: session.name, kind: session.kind, instanceId: INSTANCE_ID })}`);
  }
}

/**
 * Lists live tmux sessions for the sidebar in the frontend, which polls
 * /api/sessions to discover sessions the chat agent created. The `area`
 * field is the tangent tree area the session belongs to, read from the
 * tmux user option `@tangent_area` that the agent sets at creation time.
 */
async function loadSessions() {
  try {
    const { stdout } = await runTmuxObservation([
      "list-sessions",
      "-F",
      `#{session_name}\t#{session_path}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{@tangent_area}\t#{@tangent_kind}\t#{@tangent_goal}\t#{@tangent_process}\t#{pane_current_command}\t#{@tangent_phase}\t#{@tangent_work_title}\t#{@tangent_launch}\t#{@tangent_launch_ref}\t#{@tangent_pipeline}\t#{@tangent_step}\t#{@tangent_brain}\t#{@tangent_generation}\t#{@tangent_assignment}\t#{@tangent_attempt}\t#{${SESSION_OWNER_OPTION}}`,
    ]);
    const sessions = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, cwd, windows, attached, created, area, kind, goal, processName, command, phase, workTitle, launchLabel, launchIds, pipeline, step, brain, generation, assignment, attempt, instanceId] = line.split("\t");
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
          // The ids, not the label: a Work row prints `claude-otto/opus-5/medium`.
          // Empty on a session that started before this option existed; the row
          // then keeps its verb until the session restarts.
          launchRef: launchIds || null,
          pipeline: pipeline || null,
          step: step ? Number(step) : null,
          brain: brain || null,
          generation: generation ? Number(generation) : null,
          assignment: assignment || null,
          attempt: attempt || null,
          instanceId: instanceId || null,
          owned: instanceId === INSTANCE_ID,
          isChat: name === CHAT_SESSION,
        };
      });
    await claimLegacyWorkflowSessions(sessions);
    const owned = sessions.filter((session) => session.owned);
    const enriched = new Map((await paneObserver.enrich(await withGoalInfo(owned))).map((session) => [session.name, session]));
    return sessions.map((session) => enriched.get(session.name) ?? session);
  } catch (error) {
    if (isNoTmuxServer(error)) return [];
    throw error;
  }
}

/** Reads every tmux session so foreign names remain visible to collision and reconcile guards. */
async function listAllSessions(options) {
  return sessionObservation.get(options);
}

/** Reads only sessions whose live tmux marker belongs to this Agent Shell. */
async function listSessions(options) {
  return (await listAllSessions(options)).filter((session) => session.owned);
}

/**
 * Live sessions with the one fact the delivery decision cannot observe: a
 * prompt this server already has on its way into the pane.
 */
async function listDeliverySessions() {
  return (await listSessions()).map((session) => ({ ...session, promptPending: promptPending(session.name) }));
}

/** Reuses the shared observation for the subset of facts Programs needs. */
async function listProgramSessions() {
  return (await listSessions()).map(({ name, cwd, area, kind, process: processName, command, state }) => ({
    name, cwd, area, kind, process: processName, command,
    state: ["process", "service", "command"].includes(kind) ? state : SHELL_CMDS.has(command) ? "stopped" : "service",
  }));
}

// ---- agent state via screen diff ----
// An agent TUI repaints at least once a second while working (spinner and
// elapsed-seconds timer) and goes fully static when it waits for input, so
// hashing the visible pane between polls separates "working" from "waiting".
// A plain shell as the pane command means no agent is running at all. This
// covers every harness without hooks; a later refinement can split "waiting"
// into idle-at-prompt vs blocked-on-question with a cheap LLM call.
const SHELL_CMDS = new Set(["zsh", "bash", "fish", "sh", "dash", "tcsh", "nu"]);
const paneObserver = createPaneObserver({
  /** Runs one tmux observation command. */
  runTmux: runTmuxObservation,
  shellCommands: SHELL_CMDS,
  concurrency: Number(process.env.TANGENT_PANE_OBSERVATION_CONCURRENCY ?? 8),
});

const TMUX_OBSERVATION_TIMEOUT_MS = Number(process.env.TANGENT_TMUX_OBSERVATION_TIMEOUT_MS ?? 2_500);
const TMUX_OBSERVATION_MAX_BYTES = Number(process.env.TANGENT_TMUX_OBSERVATION_MAX_BYTES ?? 4 * 1024 * 1024);

/** Runs passive tmux observation with a hard time and output budget. */
function runTmuxObservation(args) {
  return execFileAsync("tmux", args, { timeout: TMUX_OBSERVATION_TIMEOUT_MS, maxBuffer: TMUX_OBSERVATION_MAX_BYTES });
}

/** Distinguishes an empty tmux server from an unhealthy observation command. */
function isNoTmuxServer(error) {
  const detail = `${error?.stderr ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return detail.includes("no server running") || detail.includes("failed to connect to server") || (detail.includes("error connecting to") && detail.includes("no such file"));
}

const sessionObservation = createObservationCache({
  load: loadSessions,
  ttlMs: Number(process.env.TANGENT_SESSION_OBSERVATION_TTL_MS ?? 500),
});

/** Creates one tmux session and records this instance before any caller can use it. */
async function createOwnedTmuxSession(name, args) {
  const created = await execFileAsync("tmux", ["new-session", "-P", "-F", "#{session_id}", ...args]);
  const target = String(created.stdout ?? "").trim();
  if (!target) throw new Error(`tmux returned no immutable session ID for ${name}`);
  try {
    await sessionOwnership.claim(name, target);
  } catch (error) {
    await sessionOwnership.terminate(name).catch(() => {});
    throw new Error(`Agent Shell could not record ownership for ${name}: ${error.message ?? error}`);
  }
  sessionObservation.invalidate();
  return target;
}

/** Terminates one session only when its live marker belongs to this instance. */
async function terminateOwnedSession(name) {
  const result = await sessionOwnership.terminate(name);
  if (result.state === "terminated") sessionObservation.invalidate();
  return result;
}

/** Gives one stable refusal for a foreign, legacy, or unreadable session. */
function terminationError(name, result) {
  if (result.state === "foreign") return `session ${name} belongs to Agent Shell instance ${result.instanceId}`;
  if (result.state === "legacy") return `session ${name} has no ${SESSION_OWNER_OPTION} ownership marker`;
  if (result.state === "absent") return `no live session ${name}`;
  return `could not inspect or terminate session ${name}: ${result.error?.stderr ?? result.error?.message ?? result.error ?? result.state}`;
}

/** Authorizes a terminal attachment and creates this instance's chat session when absent. */
async function prepareTerminalSession({ session, chat, workspace, chatCommand }) {
  const inspected = await sessionOwnership.inspect(session);
  if (inspected.state === "live") {
    if (inspected.instanceId === INSTANCE_ID) return;
    const ownership = inspected.instanceId ? { state: "foreign", instanceId: inspected.instanceId } : { state: "legacy" };
    throw new Error(terminationError(session, ownership));
  }
  if (inspected.state === "error") throw new Error(terminationError(session, inspected));
  if (!chat) throw new Error(`no live session ${session}`);
  const shell = process.env.SHELL ?? "/bin/zsh";
  const command = `exec ${shell} -ic '${chatCommand.replace(/'/g, "'\\''")}'`;
  await createOwnedTmuxSession(session, ["-d", "-s", session, "-c", workspace, command]);
}

/**
 * The folder work on this Area runs in: the nearest `Worktree:` or
 * `Repository:` binding on the Area or its ancestors that names an existing
 * directory, as `{ path, source: "area:<area>" }`, or null when nothing
 * binds. Every spawn path and the brain prompt read the folder through this
 * one call, so they can never disagree about where an Area's work lives.
 */
async function areaWorkFolder(area) {
  return resolveWorkFolder(TREES_ROOT, area);
}

/**
 * The folder one assignment starts in: its own `path` when the step named
 * one, else the Area's bound folder. Null means the start must be refused.
 */
async function stepWorkFolder(area, step) {
  const requested = typeof step?.path === "string" ? step.path.trim() : "";
  if (requested) return { cwd: requested, source: "step", branch: (await areaWorkFolder(area))?.branch ?? null };
  return areaWorkFolder(area);
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
  const folder = await areaWorkFolder(area);
  if (!folder) return { status: 409, error: unboundAreaMessage(TREES_ROOT, area, { pathHint: false }) };
  if ((await listAllSessions({ fresh: true })).some((session) => session.name === name)) {
    return { status: 409, error: `session "${name}" already exists` };
  }
  await createOwnedTmuxSession(name, ["-d", "-s", name, "-c", folder.cwd]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_area", area]);
  await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_cwd", folder.cwd]);
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

/** Adds each Area note's frontmatter `status` to a tree from `readTree`, so `tangent area list` can fold hidden Areas away. */
async function withAreaStatus(areas) {
  return Promise.all(areas.map(async (area) => ({
    ...area,
    status: parseFrontmatter(await areaNote(area.path)).status ?? "",
    children: await withAreaStatus(area.children),
  })));
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
    const result = await terminateOwnedSession(session);
    if (!["terminated", "absent"].includes(result.state)) throw new Error(terminationError(session, result));
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
    const occupied = await sessionOwnership.inspect(session);
    if (occupied.state === "live") throw new Error(terminationError(session, occupied.instanceId ? { state: "foreign", instanceId: occupied.instanceId } : { state: "legacy" }));
    if (occupied.state === "error") throw new Error(terminationError(session, occupied));
    await createOwnedTmuxSession(session, ["-d", "-s", session, "-c", program.cwd]);
    await execFileAsync("tmux", ["set-option", "-t", session, "@tangent_kind", "command"]);
    await execFileAsync("tmux", ["set-option", "-t", session, "@tangent_area", program.area]);
    await execFileAsync("tmux", ["set-option", "-t", session, "@tangent_process", program.name]);
  }
  await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", program.command]);
  await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "Enter"]);
}

/** Runs the built Tangent CLI against this server's vault. */
async function runLocalTangent(args) {
  const entry = path.resolve(here, "../../../dist/cli/index.js");
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

// The two instruction links of an Area folder point at its note; they are
// not Documents of their own.
const INSTRUCTION_LINK_NAMES = new Set(["AGENTS.md", "CLAUDE.md"]);

/**
 * When the Current section of one Area note was last rewritten: the newest
 * commit whose diff added the section's exact text (`git log -S`). Cached by
 * the section's text, so an unchanged note costs one lookup ever.
 */
const currentSectionChanges = new Map();
/** The epoch ms when one note's Current section was last rewritten, or null when git does not know. */
async function currentSectionChangedAt(file, text) {
  const key = `${file}\u0000${currentSectionKey(text)}`;
  if (currentSectionChanges.has(key)) return currentSectionChanges.get(key);
  const current = noteSection(text, "Current");
  let when = null;
  if (current) {
    const stamp = await captureVaultGit(["log", "-1", "--format=%ct", "-S", current, "--", file]).catch(() => "");
    const seconds = Number(String(stamp).trim());
    when = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
  }
  currentSectionChanges.set(key, when);
  if (currentSectionChanges.size > 2_000) currentSectionChanges.delete(currentSectionChanges.keys().next().value);
  return when;
}

/**
 * Gives every Area its instruction and skill-discovery links, and gives the
 * vault root its AGENTS.md and skill link (ADR-0041, ADR-0045). Idempotent.
 */
async function sweepAreaNoteLinks() {
  const rootChanged = await ensureVaultRootLinks({ treesRoot: TREES_ROOT, agentsText: await vaultRootAgentsText() });
  if (rootChanged.length) {
    await runVaultGit(["add", "-f", "--", ...rootChanged]);
    await vaultCommit(rootChanged, "add: vault root AGENTS.md tells brains how to work", "", null);
  }
  for (const area of flattenAreaPaths(await readTree(TREES_ROOT))) {
    const changed = await ensureAreaNoteLinks({ treesRoot: TREES_ROOT, area });
    if (!changed.length) continue;
    await runVaultGit(["add", "-f", "--", ...changed]);
    await vaultCommit(changed, `add: ${area} AGENTS.md links`, area, null);
  }
}

/** Reads the Documents that belong directly to one Area. */
async function readAreaDocuments(area) {
  const dir = path.join(TREES_ROOT, area);
  const noteName = area.split("/").pop() + ".md";
  let files;
  try { files = await readdir(dir); } catch { return []; }
  const documents = [];
  for (const name of files.filter((f) => f.endsWith(".md") && f !== noteName && !INSTRUCTION_LINK_NAMES.has(f) && !/^(?:goal|outcome)-/.test(f))) {
    const file = `${area}/${name}`;
    const absolute = path.join(dir, name);
    try {
      const [text, info] = await Promise.all([readFile(absolute, "utf8"), stat(absolute)]);
      const skill = skillSlugFromFile(name) ? parseSkillNote(text, { file, area, path: absolute }) : null;
      documents.push({
        file, area, kind: "document", title: markdownTitle(text, name.slice(0, -3)),
        mtime: info.mtimeMs, hash: documentHash(text), links: wikiLinks(text),
        commentCount: documentComments.parseComments(text).length,
        // A skill Document carries its name and description so the Area
        // page lists it the way `tangent area show` does (D20).
        ...(skill ? { skill: { name: skill.name, description: skill.description } } : {}),
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

/** Resolves one presentation input to a Markdown file inside the vault or the Goal worker folder. */
async function resolvePresentedDocument(goal, input) {
  const requested = String(input ?? "").trim();
  if (!requested) return { error: "present needs a document path" };
  const vaultSafe = safeMarkdownPath(TREES_ROOT, requested);
  if (vaultSafe) {
    const text = await readFile(vaultSafe.absolute, "utf8").catch(() => null);
    if (text == null) return { error: `no Markdown file ${requested}` };
    return { root: "vault", file: vaultSafe.relative, title: markdownTitle(text, path.basename(vaultSafe.relative, ".md")), hash: documentHash(text), text };
  }
  const queue = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
  const boundFolder = await areaWorkFolder(goal.area);
  const roots = [boundFolder?.cwd, ...(queue?.steps ?? []).flatMap((step) => (step.attempts ?? []).map((attempt) => attempt.cwd).filter(Boolean))]
    .filter(Boolean)
    .map((root) => path.resolve(root));
  const absolute = path.isAbsolute(requested)
    ? path.resolve(requested)
    : roots.map((root) => path.resolve(root, requested)).find((candidate) => existsSync(candidate)) ?? path.resolve(requested);
  if (path.extname(absolute).toLowerCase() !== ".md") return { error: "present accepts Markdown files only" };
  const repository = roots.find((root) => absolute === root || absolute.startsWith(`${root}${path.sep}`));
  if (!repository) return { error: "the document is outside the vault and this Goal's repository" };
  const text = await readFile(absolute, "utf8").catch(() => null);
  if (text == null) return { error: `no Markdown file ${absolute}` };
  return { root: "repository", file: absolute, repository, title: markdownTitle(text, path.basename(absolute, ".md")), hash: documentHash(text), text };
}

/** Reads an allow-listed repository Document without granting general file access. */
async function readPresentedRepositoryDocument(file) {
  const absolute = path.resolve(String(file ?? ""));
  for (const goal of (await goalsByFile()).values()) {
    const record = await readGoalPresentations(PRESENTATIONS_ROOT, goal.area, goal.slug);
    const item = projectPresentations(record).find((entry) => entry.root === "repository" && entry.file === absolute);
    if (!item) continue;
    const text = await readFile(absolute, "utf8").catch(() => null);
    return text == null ? null : { file: absolute, area: goal.area, kind: "document", root: "repository", repositoryFile: true, readOnly: true, title: markdownTitle(text, item.title), text, hash: documentHash(text), comments: [] };
  }
  return null;
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
 * Tells the logical Area brain that Julian finished adding comments to one
 * Document. This is explicit: saving or editing a comment sends nothing.
 * An inactive or not-yet-created brain reads the durable notice when it starts.
 */
async function notifyBrainOfDocumentComments(file) {
  const document = await readVaultDocument(file);
  if (!document) return { status: 404, error: `no document ${file}` };
  if (!document.comments.length) return { status: 409, error: "This Document has no open comments." };
  const count = document.comments.length;
  const delivery = await routeBrainNotice(document.area, `Julian added comments to ${document.file} (${count} open ${count === 1 ? "comment" : "comments"}). Read them with tangent document comments ${document.file}.`);
  return { status: 200, value: { ok: true, brain: document.area, comments: count, delivery: delivery.addressed ? "live" : "inbox" } };
}

/**
 * The only agent path that removes a comment (design-comment-on-documents,
 * decision 5): exactly one comment must start with the given words, and the
 * removal is its own named commit, so nothing is lost silently.
 */
async function resolveVaultDocumentComment(file, prefix, note, tmuxSession, index = null) {
  const current = await readVaultDocument(file);
  if (!current) return { status: 404, error: `no document ${file}` };
  const result = documentComments.resolveComment(current.text, prefix, index);
  if (result.error) return { status: result.matches.length ? 409 : 404, error: result.error, matches: result.matches };
  const words = result.comment.text.split(/\s+/).slice(0, 6).join(" ");
  const message = `resolve: ${current.area} ${path.basename(file, ".md")} "${words}"` + (note ? `\n\n${String(note).trim()}` : "");
  const document = await writeVaultDocument(current, result.text, message, tmuxSession || null);
  await recordCommittedCommand({ operation: "document-comment-resolve", actorSession: tmuxSession, targetArea: current.area, result: `resolved comment ${result.comment.index + 1}` });
  return { status: 200, document, comment: result.comment };
}

/** Reads current or legacy Goal links from one ordered Markdown section. */
function goalLinkOrder(text) {
  return [...String(text ?? "").matchAll(/\[\[(?:goal|outcome)-([a-z0-9-]+)(?:[^\]]*)\]\]/g)].map((match) => match[1]);
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
  const brainSessions = brainSessionNames(await readAllBrains(BRAINS_ROOT));
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
    const info = await stat(path.join(TREES_ROOT, area, f)).catch(() => null);
    const mtime = info?.mtimeMs ?? 0;
    const projectedBinding = withoutBrainGoalBinding({
      status: normalizeGoalStatus(fm.status || "open"),
      session: fm.session || null,
    }, brainSessions);
    goals.push({
      mtime,
      birthtime: info?.birthtimeMs ?? 0,
      created: fm.created || null,
      area,
      slug,
      file: `${area}/${f}`,
      title: text.match(/^# (.+)$/m)?.[1]?.trim() ?? slug,
      status: projectedBinding.status,
      doneWhen: fm.done_when || fm.outcome || "",
      verify: goalIsFlaggedForVerify(fm.verify),
      stateText: noteSection(text, "State"),
      myUnderstanding: noteSection(text, "My understanding"),
      currentBrief: noteSection(text, "Current brief"),
      storyText: noteSection(text, "Story so far"),
      waitingOn: fm.waiting_on || null,
      due: fm.due || null,
      session: projectedBinding.session,
      brainSessionBinding: projectedBinding.brainSessionBinding ?? null,
      // The process note this Goal was started from, so a due process is
      // skipped while its last Goal is open (ADR-0043).
      process: fm.process || null,
      subgoals: subgoalsOrder(text),
      dependencySlugs: dependencySlugs(text),
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
    const signal = noteSignal(note, note ? await currentSectionChangedAt(areaNoteFile(n.path), note) : null);
    entries.push({ n, note, own, documents, signal });
    for (const o of own) if (!bySlug.has(o.slug)) bySlug.set(o.slug, o);
  }
  projectGoalDependencies(entries.flatMap(({ own }) => own));
  const linked = new Set([...bySlug.values()].flatMap((o) => o.subgoals));
  const parentBySlug = new Map();
  const presentationsByGoal = new Map(await Promise.all([...bySlug.values()].map(async (goal) => {
    const record = await readGoalPresentations(PRESENTATIONS_ROOT, goal.area, goal.slug);
    await pruneMissingPresentations(PRESENTATIONS_ROOT, record, (item) => stat(item.root === "vault" ? path.join(TREES_ROOT, item.file) : item.file).then(() => true, () => false));
    return [goal.file, record];
  })));
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
      records.push({ file: o.file, area: o.area, kind: "goal", title: o.title, status: o.status, links: wikiLinks(text), mtime: o.mtime, goal: o });
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
    const presentationRecord = presentationsByGoal.get(goal.file);
    const presented = projectPresentations(presentationRecord);
    goal.presentations = presented.map((item) => ({ ...item }));
    for (const item of presented.reverse()) {
      const existing = goal.documents.findIndex((document) => document.file === item.file);
      const projected = { file: item.file, title: item.title, kind: "document", root: item.root, repository: item.repository, presentedBy: item.presentedBy, presentedAt: item.presentedAt, note: item.note };
      if (existing >= 0) goal.documents.splice(existing, 1);
      goal.documents.unshift(projected);
    }
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
  }

  for (const { n, note, own, documents, signal } of entries) {
    // Goal order comes from the Goal files alone (ADR-0041): status, then
    // creation time. A Subgoal keeps its place inside its parent.
    const roots = orderGoals(own.filter((o) => !linked.has(o.slug))).map((o) => o.slug);
    const unlinked = [];
    const seen = new Set();
    const goals = [];
    /** Flattens one goal and its subgoals descendants, depth-first. */
    const dive = (slug, depth) => {
      const o = bySlug.get(slug);
      if (!o || seen.has(slug)) return;
      seen.add(slug);
      goals.push({ ...o, depth, order: goals.length });
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
      noteSignal: signal,
      documents: documents.map((d) => ({ ...d, backlinks: backlinks.get(d.file) ?? [] })),
      goals,
    });
  }
  out.unshift(rootAreaRow(entries.filter(({ n }) => !n.path.includes("/")).map(({ n }) => n.path)));
  // The unified map: every goal exactly once, at its topmost position.
  // A root is a Goal that no other Goal links as a Subgoal.
  const groups = [];
  const groupByArea = new Map();
  const placed = new Set();
  for (const { n, note, own } of entries) {
    const ordered = orderGoals(own).map((o) => o.slug);
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
  return { areas: out, map: groups, documents: records, recentCloses, closes: gitCloses };
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
/** Builds one complete projection in a disposable process. */
function buildVaultIndexInWorker({ signal }) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ["--vault-index-worker"], {
      env: { ...process.env, AGENT_SHELL_INDEX_WORKER: "1" },
      serialization: "advanced",
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    let settled = false;
    /** Settles once and stops the disposable worker. */
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      if (child.connected) child.disconnect();
      if (!child.killed) child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    /** Stops an index build that exceeded the controller deadline. */
    const aborted = () => finish(signal.reason ?? new Error("Vault projection was cancelled."));
    signal.addEventListener("abort", aborted, { once: true });
    child.once("message", (message) => {
      if (message?.type === "vault-projection") finish(null, message.value);
      else if (message?.type === "vault-projection-error") finish(new Error(message.error));
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code, exitSignal) => {
      if (!settled) finish(new Error(`Vault projection worker exited ${exitSignal ?? code}.${stderr ? ` ${stderr.trim()}` : ""}`));
    });
  });
}

if (process.env.AGENT_SHELL_INDEX_WORKER === "1") {
  try {
    const value = await buildVaultIndex();
    await new Promise((resolve) => process.send?.({ type: "vault-projection", value }, resolve));
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => process.send?.({ type: "vault-projection-error", error: String(error?.stack ?? error) }, resolve));
    process.exit(1);
  }
}

const vaultProjection = createVaultProjectionController({ fingerprint: vaultFingerprint, build: buildVaultIndexInWorker });
const vaultIndex = vaultProjection.get;

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
  if (session && brainSessionNames(await readAllBrains(BRAINS_ROOT)).has(session)) {
    throw new Error(`Area brain session ${session} cannot own or bind to a Goal.`);
  }
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
async function editGoalFile(file, { status, session, title, doneWhen, state, understanding, currentBrief, story, wontDoReason, verify }) {
  const abs = path.join(TREES_ROOT, file);
  let text = await readFile(abs, "utf8");
  if (verify !== undefined) text = verify ? withFrontmatterLine(text, "verify", "yes") : text.replace(/^verify:.*\n/m, "");
  if (status !== undefined) {
    text = withFrontmatterLine(text, "status", status);
    if (SETTLED_GOAL_STATUSES.has(status)) {
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
function renderNewGoal({ title, doneWhen, state, context, subgoals = [], sources = [], verify = false, process = "" }) {
  const result = oneLine(doneWhen);
  const subgoalsSection = subgoals.length
    ? `\n\n## Subgoals\n\n${subgoals.map((slug, index) => `${index + 1}. [[goal-${slug}]]`).join("\n")}`
    : "";
  const contextParagraph = oneLine(context) ? `\n\n${oneLine(context)}` : "";
  const sourcesSection = sources.length
    ? `\n\n## Sources\n\n${sources.map((source) => `- [[${source.file.replace(/\.md$/i, "")}|${oneLine(source.title).replace(/[|\]]/g, "")}]]`).join("\n")}`
    : "";
  return (
    `---\ntype: goal\nstatus: open\ndone_when: ${result}\n${verify ? "verify: yes\n" : ""}${process ? `process: ${process}\n` : ""}session:\n---\n\n` +
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
  return areaNoteTemplate(areaTitle(area));
}

/**
 * The two Area statuses that fold an Area away from Work, the Areas
 * directory, Go To, and `tangent area list`: `done` is a finished subject,
 * `archived` a shelved one (design area-archive Decision 3). Both stop brain
 * starts and process notes under the Area.
 */
const HIDDEN_AREA_STATUSES = new Set(["done", "archived"]);

/** The hidden status of an Area or of its nearest hidden ancestor, else "". */
async function hiddenAreaStatus(area) {
  const parts = String(area ?? "").split("/").filter(Boolean);
  for (let depth = parts.length; depth > 0; depth -= 1) {
    const status = parseFrontmatter(await areaNote(parts.slice(0, depth).join("/"))).status ?? "";
    if (HIDDEN_AREA_STATUSES.has(status)) return status;
  }
  return "";
}

/** Live brain and agent sessions bound to an Area or any Area inside it. Program sessions do not count. */
async function liveAgentSessionsUnder(area) {
  return (await listSessions()).filter((session) =>
    session.area && (session.area === area || session.area.startsWith(`${area}/`)) &&
    !["process", "service", "command"].includes(session.kind ?? ""));
}

/**
 * Sets an Area's status (`done`, `archived`, or `active`) in its note
 * frontmatter on Julian's word (design-area-map Decision 11, area-archive
 * Decision 1). Goals are not touched. Creates the note when the Area has
 * none. Hiding an Area is refused while a brain or agent under it is live
 * (area-archive Decision 5). Returns the open Goals that stay open and
 * hidden with the Area, so the caller can say so.
 */
async function setAreaStatus(area, status, tmuxSession) {
  if (HIDDEN_AREA_STATUSES.has(status)) {
    const live = await liveAgentSessionsUnder(area);
    if (live.length) return { refused: true, liveSessions: live.map((session) => session.name) };
  }
  const file = areaNoteFile(area);
  const absolute = path.join(TREES_ROOT, file);
  const text = await readFile(absolute, "utf8").catch(() => emptyAreaNote(area));
  const next = withFrontmatterLine(text, "status", status);
  await vaultRepository.writeMarkdown(file, next);
  await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", file]).catch(() => {});
  await vaultCommit([file], `update: ${area} area ${status === "active" ? "reopened" : status}`, area, tmuxSession);
  const openGoals = (await readAreaGoalsDeep(area)).filter((goal) => !["done", "dropped", "parked"].includes(goal.status));
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

/**
 * Creates one Goal and its optional Subgoals in one confirmed save.
 */
async function createGoalSet(area, { goal, subgoals = [], description = "", sources = [], verify = false, process = "" }) {
  const taken = new Set([...(await goalsByFile()).values()].map((item) => item.slug));
  const goalSlug = allocateGoalSlug(area, goal.title, taken);
  const subgoalRecords = subgoals.map((subgoal) => ({
    ...subgoal,
    slug: allocateGoalSlug(area, subgoal.title, taken),
  }));
  const records = [
    { ...goal, slug: goalSlug, subgoals: subgoalRecords.map((subgoal) => subgoal.slug), context: description, sources, verify, process },
    ...subgoalRecords.map((subgoal) => ({ ...subgoal, subgoals: [], context: `This Goal supports [[goal-${goalSlug}]].` })),
  ].map((record) => ({ ...record, file: `${area}/goal-${record.slug}.md` }));

  for (const record of records) {
    await vaultRepository.writeMarkdown(record.file, renderNewGoal(record));
  }
  // Tangent never writes into the Area note (ADR-0041): a Goal is only its file.
  const changed = records.map((record) => record.file);
  await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", ...changed]).catch((err) => {
    console.error(`goal stage failed: ${changed.join(", ")}: ${String(err.stderr ?? err.message ?? err).slice(0, 200)}`);
  });
  await vaultCommit(changed, `add: ${area} goal ${goalSlug} from Agent Shell`, area, null);
  return { file: records[0].file, files: records.map((record) => record.file) };
}

/**
 * The ideas of one Area: its `ideas.md` lines, then any `- Idea:` line an
 * older note still carries under Ideas and open questions.
 */
async function areaIdeas(area) {
  const file = await readFile(path.join(TREES_ROOT, ideasFilePath(area)), "utf8").catch(() => "");
  const legacy = noteSection(await areaNote(area), "Ideas and open questions")
    .split("\n")
    .map((line) => line.match(/^-\s*Idea:\s*(.+)$/))
    .filter(Boolean)
    .map((match) => match[1].trim());
  return [...ideasFromFile(file), ...legacy];
}

/** Reduces one readAreaGoals() entry to the compact shape the tangent goal CLI lists. */
function goalSummary(goal) {
  return {
    slug: goal.slug,
    file: goal.file,
    area: goal.area,
    title: goal.title,
    status: goal.status,
    doneWhen: goal.doneWhen,
    verify: goal.verify === true,
    dependsOn: goal.dependsOn ?? [],
    requiredBy: goal.requiredBy ?? [],
    unresolvedDependencies: goal.unresolvedDependencies ?? [],
    // When the Goal file last changed. A recency filter has nothing to read
    // without it, and the listing is the one place a brain asks what moved.
    changedAt: goal.changedAt ?? goal.mtime ?? 0,
  };
}

/** The filter flags of one listing, so a printed follow-up command keeps them. */
function goalFilterFlags(filters) {
  return [
    ...filters.status.map((one) => ` --status ${one}`),
    filters.changedSince ? ` --changed-since ${filters.changedSince}` : "",
    filters.query ? ` --query ${JSON.stringify(filters.query)}` : "",
  ].join("");
}

/** Saves one idea line to the Area's ideas.md; the note itself is never written. */
async function saveWorkIdea(area, description) {
  const file = await appendIdea({ treesRoot: TREES_ROOT, area, text: description });
  await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", file]).catch(() => {});
  await vaultCommit([file], `note: ${area} captures an idea`, area, null);
  return file;
}

/**
 * Commits exactly the given vault paths with the provenance trailers the
 * vault rules require. Pathspec commit, no staging: another agent's staged
 * edits can never ride along. A failed commit logs and never throws, because
 * the file edit itself already happened; the returned outcome lets a caller
 * that must not act on an uncommitted file stop instead.
 */
async function vaultCommit(relPaths, message, area, tmuxSession) {
  return vaultRepository.commit(relPaths, message, area, tmuxSession);
}

/** Every historical session name that can lead to one Goal's live execution. */
function goalExecutionCandidates(goalFile, goal, pipeline, continuation) {
  const names = new Set(goal?.session ? [goal.session] : []);
  for (const step of pipeline?.steps ?? []) {
    if (step.session) names.add(step.session);
    for (const entry of step.continuations ?? []) if (entry.session) names.add(entry.session);
  }
  if (continuation?.session) names.add(continuation.session);
  for (const entry of continuation?.continuations ?? []) if (entry.session) names.add(entry.session);
  return { names, pipeline };
}

/**
 * Retires all live workers proven by fresh tmux metadata to belong to these Goals.
 * Historical names find candidates but can never authorize a kill.
 */
async function finishGoalExecutions({ goalFiles, reason, sessions = null }) {
  const targets = new Set(goalFiles);
  const byFile = await goalsByFile();
  const candidates = new Set();
  const pipelines = new Map();
  const removed = [];
  const alreadyAbsent = [];
  const preserved = [];
  const failures = [];
  const previouslyRemoved = new Set();
  const [allPipelines, allContinuations] = await Promise.all([readAllPipelines(PIPELINES_ROOT), readAllContinuations(CONTINUATIONS_ROOT)]);
  const pipelineByGoal = new Map(allPipelines.map((record) => [record.goal, record]));
  const continuationByGoal = new Map(allContinuations.map((record) => [record.goal, record]));
  for (const goalFile of targets) {
    const found = goalExecutionCandidates(goalFile, byFile.get(goalFile), pipelineByGoal.get(goalFile), continuationByGoal.get(goalFile));
    for (const name of found.names) candidates.add(name);
    if (found.pipeline) pipelines.set(goalFile, found.pipeline);
    for (const name of (await readGoalCleanup(GOAL_CLEANUPS_ROOT, goalFile))?.removed ?? []) previouslyRemoved.add(name);
  }
  for (const session of sessions ?? []) if (targets.has(session.goal)) candidates.add(session.name);
  let observed;
  try {
    observed = await listAllSessions({ fresh: true });
    if (sessionObservation.status().error) throw new Error(`tmux observation failed: ${sessionObservation.status().error}`);
  } catch (error) {
    failures.push({ goal: null, session: null, operation: "observe", error: String(error.message ?? error) });
    observed = [];
  }
  for (const session of observed) if (targets.has(session.goal)) candidates.add(session.name);
  const liveByName = new Map(observed.map((session) => [session.name, session]));
  for (const name of candidates) {
    const live = liveByName.get(name);
    if (!live) {
      if (await sessionOwnership.ownsRecorded(name)) alreadyAbsent.push(name);
      else preserved.push({ session: name, kind: null, goal: null, created: null, instanceId: null, legacy: true });
      continue;
    }
    if (!live.owned || live.kind !== "goal" || !targets.has(live.goal)) {
      preserved.push({ session: name, kind: live.kind, goal: live.goal, created: live.created, instanceId: live.instanceId });
      continue;
    }
    const stopped = await terminateOwnedSession(name);
    if (stopped.state === "terminated") {
      removed.push(name);
      armedSessions.delete(name);
      await clearArmedPrompt(ARMED_ROOT, name);
    } else {
      failures.push({ goal: live.goal, session: name, operation: "kill", error: terminationError(name, stopped) });
    }
  }
  sessionObservation.invalidate();
  let after = [];
  if (!failures.length) {
    try {
      after = await listAllSessions({ fresh: true });
      if (sessionObservation.status().error) throw new Error(`tmux observation failed: ${sessionObservation.status().error}`);
      for (const session of after) {
        if (session.owned && session.kind === "goal" && targets.has(session.goal)) failures.push({ goal: session.goal, session: session.name, operation: "verify", error: "worker session remains live" });
      }
    } catch (error) {
      failures.push({ goal: null, session: null, operation: "verify", error: String(error.message ?? error) });
    }
  }
  if (failures.length) {
    for (const goalFile of targets) await writeGoalCleanup(GOAL_CLEANUPS_ROOT, goalFile, {
      targetStatus: byFile.get(goalFile)?.status === "dropped" || reason === "goal-dropped" ? "dropped" : "done",
      removed, failures: failures.filter((item) => !item.goal || item.goal === goalFile),
    });
    const result = { ok: false, removed, alreadyAbsent, preserved, releasedGoals: [], failures };
    console.error("goal worker cleanup:", JSON.stringify({ goalFiles: [...targets], reason, ...result }));
    return result;
  }
  for (const [goalFile, record] of pipelines) {
    if (endPipeline(record).length) await writePipeline(PIPELINES_ROOT, record);
    await clearGoalCleanup(GOAL_CLEANUPS_ROOT, goalFile);
  }
  for (const goalFile of targets) if (!pipelines.has(goalFile)) await clearGoalCleanup(GOAL_CLEANUPS_ROOT, goalFile);
  const removedNames = new Set([...previouslyRemoved, ...removed, ...alreadyAbsent]);
  const releasedGoals = [];
  for (const goal of byFile.values()) {
    if (targets.has(goal.file) || !goal.session || !removedNames.has(goal.session) || SETTLED_GOAL_STATUSES.has(goal.status)) continue;
    await writeGoalBinding(goal.file, { status: "open", session: null });
    releasedGoals.push(goal.file);
  }
  return { ok: true, removed, alreadyAbsent, preserved, releasedGoals, failures: [] };
}

/** Marks one Goal and every Subgoal done after their worker cleanup succeeds. */
async function cascadeGoalDone(rootFile, byFile, { note = "" } = {}) {
  const changed = [];
  const endedGoals = [];
  const cascade = doneCascade(rootFile, byFile);
  const cleanup = await finishGoalExecutions({ goalFiles: cascade.map((goal) => goal.file), reason: "goal-done" });
  if (!cleanup.ok) {
    const error = new Error("Worker cleanup failed. Retry the Goal finish.");
    error.cleanup = cleanup;
    throw error;
  }
  changed.push(...cleanup.releasedGoals);
  for (const goal of cascade) {
    endedGoals.push(goal.file);
    if (goal.status !== "done" || goal.session || goal.waitingOn) {
      await writeGoalBinding(goal.file, { status: "done", session: null, waitingOn: null });
      changed.push(goal.file);
    }
    goal.status = "done";
    goal.session = null;
    goal.waitingOn = null;
  }
  await closeRequestsForGoals(endedGoals, "goal-done");
  for (const goal of cascade) await recordGoalClosure(goal, "done", note);
  return changed;
}

/**
 * Writes one material milestone for a Goal that ended. Every closure path
 * funnels through here: a passing designated review, `tangent goal done`, an
 * authorized Request effect, and Julian's own completion control. Recording it
 * at each call site missed three of the four, so a brain's recent-work view
 * stayed empty while Goals closed all around it.
 */
async function recordGoalClosure(goal, outcome, reason = "") {
  if (!goal?.area || !goal.file) return;
  const title = goal.title || goal.slug || goal.file;
  const summary = outcome === "done"
    ? `${title} closed.${reason ? ` ${reason}` : ""}`
    : `${title} was dropped.${reason ? ` Reason: ${reason}` : ""}`;
  try {
    await appendMilestone({
      root: BRAINS_ROOT,
      area: goal.area,
      kind: `goal-${outcome}`,
      summary,
      ref: goal.file,
      idempotencyKey: `goal-${outcome}:${goal.file}`,
    });
  } catch (error) {
    console.error("milestone:", error.message ?? error);
  }
}

/** Closes open Requests in every brain store when their Goal subject ends. */
async function closeRequestsForGoals(goalFiles, reason) {
  const targets = new Set(goalFiles);
  if (!targets.size) return [];
  const closed = [];
  for (const brain of await readAllBrains(BRAINS_ROOT)) {
    const record = await readBrainRequests(BRAINS_ROOT, brain.area);
    const changed = [...targets].flatMap((goal) => closeGoalRequests(record, goal, reason));
    if (changed.length) {
      await writeBrainRequests(BRAINS_ROOT, record);
      closed.push(...changed);
    }
  }
  return closed;
}

/** Closes the open Requests whose subject is one brain generation. */
async function transitionBrainRequests(area, generation, transition) {
  const record = await readBrainRequests(BRAINS_ROOT, area);
  const changed = closeBrainRequests(record, area, generation, transition);
  if (changed.length) await writeBrainRequests(BRAINS_ROOT, record);
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
async function goalContext(area, o, trace = null) {
  const notes = areaNoteFiles(area);
  trace?.mark("area notes resolved", { notes: notes.length });
  const linked = await goalContextDocuments(area, o, trace);
  return {
    goalFile: path.join(TREES_ROOT, o.file),
    notes,
    documents: linked.map((d) => d.root === "repository" ? d.file : path.join(TREES_ROOT, d.file)),
    commentCounts: linked.map((d) => d.commentCount ?? 0),
  };
}

const GOAL_CONTEXT_MAX_DOCUMENTS = 64;
const GOAL_CONTEXT_MAX_BYTES = 512_000;

/**
 * Reads only the bounded Document metadata needed to start one Goal.
 *
 * A mutation must not build the complete vault search/map projection merely
 * to name its source files. Only explicit links from the Goal are safe on the
 * mutation path. Reverse-link discovery stays in the background projection.
 */
async function goalContextDocuments(area, goal, trace = null) {
  const goalText = await readFile(path.join(TREES_ROOT, goal.file), "utf8").catch(() => "");
  trace?.mark("goal source read", { characters: goalText.length });
  const goalLinks = wikiLinks(goalText);
  trace?.mark("goal links parsed", { links: goalLinks.length });
  const candidates = [...new Set(goalLinks.map((target) => {
    const stem = target.replace(/\.md$/i, "");
    return `${stem.includes("/") ? stem : `${area}/${stem}`}.md`;
  }))].slice(0, GOAL_CONTEXT_MAX_DOCUMENTS);
  const linked = [];
  const presentations = projectPresentations(await readGoalPresentations(PRESENTATIONS_ROOT, goal.area, goal.slug));
  for (const item of presentations) {
    if (item.root === "repository") {
      linked.push({ file: item.file, root: "repository", title: item.title, commentCount: 0 });
      continue;
    }
    candidates.unshift(item.file);
  }
  const seen = new Set(linked.map((item) => item.file));
  for (const file of candidates) {
    if (seen.has(file)) continue;
    const safe = safeMarkdownPath(TREES_ROOT, file);
    if (!safe || /\/(?:goal|outcome)-[^/]+\.md$/.test(safe.relative)) continue;
    const info = await stat(safe.absolute).catch(() => null);
    if (!info || info.size > GOAL_CONTEXT_MAX_BYTES) continue;
    const text = await readFile(safe.absolute, "utf8").catch(() => null);
    if (text == null) continue;
    trace?.mark("linked document read", { file: safe.relative, characters: text.length });
    linked.push({
      file: safe.relative,
      title: markdownTitle(text, path.basename(safe.relative, ".md")),
      commentCount: documentComments.parseComments(text).length,
    });
    seen.add(safe.relative);
  }
  return linked;
}

/**
 * The worker prompt section that names the folder the session opened in and
 * where that folder came from (a step's own path or the Area that bound it),
 * with the Branch when the Area declares one. Empty when no folder is known.
 */
function workingDirectorySection(folder) {
  if (!folder?.cwd) return "";
  const branch = folder.branch ? `\nBranch: ${folder.branch}` : "";
  return `## Working directory\n\n${folder.cwd} (from ${folder.source})${branch}\n\n`;
}

/**
 * The folder a prompt names when no session or attempt recorded one: the
 * Area's bound folder. The preview route, the armed-prompt typing pass, and
 * context recovery all read it here, so they print the same
 * `## Working directory` as the start that opened the session.
 */
async function promptWorkFolder(area, recorded = null) {
  if (recorded?.cwd) return { cwd: recorded.cwd, source: recorded.cwdSource ?? recorded.source ?? "session", branch: recorded.branch ?? null };
  return areaWorkFolder(area);
}

/**
 * The exact assignment shown before execution and typed into the selected
 * harness (D7): the Goal, its sources, the working directory, and the one
 * command. Everything else the worker needs is in the files it names.
 * Markdown keeps the contract readable in both the shell and the agent
 * composer.
 */
async function goalPrompt(area, o, extras = [], continuationEntries = [], trace = null, folder = null, { closing = true } = {}) {
  const context = await goalContext(area, o, trace);
  trace?.mark("goal context ready", { documents: context.documents.length });
  const sources = [
    `- Goal: ${context.goalFile}`,
    ...extras.map((extra) => `- Goal also assigned to this session, work it after the one above: ${path.join(TREES_ROOT, extra.file)}`),
    ...context.notes.map((note, index) => `- Area note ${index + 1}: ${note}`),
    ...context.documents.map((document, index) => `- Document: ${document}${context.commentCounts[index] ? ` (${context.commentCounts[index]} open comment${context.commentCounts[index] === 1 ? "" : "s"} from Julian)` : ""}`),
  ];
  const openComments = context.commentCounts.some(Boolean);
  const goalLink = o.file.split("/").pop().replace(/\.md$/, "");
  return (
    `# Assignment: ${o.title}\n\n` +
    `## Done when\n\n${o.doneWhen || "Read the Goal file for the done condition."}\n\n` +
    `## Sources\n\n${sources.join("\n")}\n\n` +
    workingDirectorySection(folder) +
    (openComments
      ? `Julian's comments in a Document look like \`{>>Julian: ...<<}\`, sometimes after \`{==the words they refer to==}\`. Carry them along unchanged when you edit the Document.\n\n`
      : "") +
    `Design documents go in the Area folder ${path.join(TREES_ROOT, area)} as design-<slug>.md, in Simple English (${path.join(os.homedir(), ".agents", "skills", "simple-english", "SKILL.md")}, pragmatic mode), with a [[${goalLink}]] link. Present each document with --present <file> when you send the brain your result.` +
    (continuationEntries.length ? `\n\n${continuationSection({ index: 1, total: 1, entries: continuationEntries, subject: "Goal" })}` : "") +
    (closing ? `\n\n${workerSendSection()}` : "")
  );
}

/**
 * The first message of one pipeline step: the Goal assignment, this step's
 * instruction, every earlier handover verbatim (facts from earlier agents),
 * and how to hand over when done. Guidance, not a schema.
 */
async function pipelineStepPrompt(area, o, record, index, extras = [], sessionName = "", trace = null, folder = null) {
  const assignment = await goalPrompt(area, o, extras, [], trace, folder, { closing: false });
  trace?.mark("assignment rendered", { characters: assignment.length });
  const step = record.steps[index - 1];
  const total = record.steps.length;
  const earlier = record.steps
    .filter((item) => item.index < index && item.handover)
    .map((item) => `### Handover from step ${item.index} (${item.label || "agent"}, ${item.status})\n\n${item.handover}`);
  trace?.mark("step controller resolved");
  const continuationEntries = step.continuations ?? [];
  return (
    `${assignment}\n\n` +
    `## Your step\n\n` +
    `Step ${index} of ${total}${total > 1 ? " in a pipeline" : ""}: ${step.instruction}${step.kind === "review" ? " This is the review step. --done means the review passed." : ""}\n\n` +
    (earlier.length ? `## Handovers so far\n\n${earlier.join("\n\n")}\n\n` : "") +
    (continuationEntries.length ? `${continuationSection({ index, total, entries: continuationEntries, subject: "step" })}\n\n` : "") +
    workerSendSection()
  );
}

// ---- goal prompt arming ----
// A start primes a plain shell with the harness command and the opening prompt.
// A direct launch submits both; otherwise both wait for the user.
//
// Arming is only ever set by a brain start, never inferred from what
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
const armedSessions = new Map(); // session -> { submit, prompt, extraFiles, onTyped }
// Every prompt this server types goes through one queue per pane, so the
// arming poll and the message queue cannot type into the same brain at the
// same moment (pane-writes.mjs).
const paneWrites = createPaneWriteQueue();

/**
 * True while Tangent has a prompt on its way into this pane: armed and
 * waiting for the harness, or being typed right now. The delivery decision
 * holds notices back on this, because a booting generation shows a working
 * pane with an empty composer for the whole time.
 */
function promptPending(session) {
  return armedSessions.has(session) || paneWrites.busy(session);
}

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
      hash = await paneObserver.hash(session);
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
 * The composer state of a live pane, read fresh: "idle", "draft", or null.
 * The observer's reading can be up to one sample old, which is long enough
 * for Julian to have started typing, so the working path asks again at the
 * moment it is about to type.
 */
async function paneComposerNow(session) {
  try {
    const [{ stdout: text }, { stdout: at }] = await Promise.all([
      execFileAsync("tmux", ["capture-pane", "-p", "-t", "=" + session + ":"]),
      execFileAsync("tmux", ["display-message", "-p", "-t", "=" + session + ":", "#{cursor_x} #{cursor_y}"]),
    ]);
    const [cursorX, cursorY] = at.trim().split(/\s+/).map(Number);
    return classifyWorkingComposer({ text, cursorX: Number.isFinite(cursorX) ? cursorX : 0, cursorY: Number.isFinite(cursorY) ? cursorY : 0 });
  } catch {
    return null;
  }
}

/**
 * True when a pane can take typed text now. A booting harness is waited for;
 * one already running an agent must not be a bare shell and must still show
 * the empty composer the delivery decision found. The second check is what
 * makes mid-turn delivery safe: the decision read a sample, and text typed
 * since then would otherwise be typed over.
 */
async function paneReadyForText(session, settle) {
  if (settle) return waitForHarnessReady(session);
  return readyForText({ command: await paneCommand(session), composer: await paneComposerNow(session), shellCommands: SHELL_CMDS });
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
 *
 * `settle` false skips the boot wait. The wait watches for a quiet screen,
 * which a working agent never shows, so waiting on one costs the full
 * READY_MAX_MS per attempt and delays exactly the message that must be
 * prompt: a worker's report to a busy Area brain. A working harness is
 * already up; the only thing left to prove is that its pane is not a shell.
 */
async function typePromptWhenReady(session, prompt, submit = false, label = "agent prompt", { settle = true } = {}) {
  return paneWrites.run(session, () => typePromptNow(session, prompt, submit, label, settle));
}

/**
 * Types one prompt into a pane that is this writer's alone. Called only from
 * typePromptWhenReady, inside that pane's write queue.
 */
async function typePromptNow(session, prompt, submit, label, settle) {
  const startedAt = Date.now();
  /** Records delivery latency without the session name or prompt content. */
  const measured = (ok) => {
    recordActionTelemetry(ACTION_TELEMETRY_LOG, { kind: "delivery", action: label, durationMs: Date.now() - startedAt, ok }).catch(() => {});
    return ok;
  };
  try {
    const { probe, rest } = splitPrompt(prompt);
    for (let attempt = 1; attempt <= TYPE_ATTEMPTS; attempt++) {
      if (!(await paneReadyForText(session, settle))) return measured(false);
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
async function typeGoalPromptWhenReady(session, area, file, submit = false, extraFiles = []) {
  const goals = await readAreaGoals(area);
  const o = goals.find((t) => t.file === file);
  if (!o) return false;
  const extras = (extraFiles ?? []).map((extra) => goals.find((t) => t.file === extra)).filter(Boolean);
  const folder = await promptWorkFolder(area);
  const prompt = await goalPrompt(area, o, extras, [], null, folder);
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
      `#{session_name}\t#{@tangent_area}\t#{@tangent_goal}\t#{pane_current_command}\t#{${SESSION_OWNER_OPTION}}`,
    ]));
  } catch {
    armedSessions.clear(); // no tmux server: nothing to watch
    return;
  }
  const live = new Set();
  for (const line of stdout.trim().split("\n").filter(Boolean)) {
    const [name, area, file, command, instanceId] = line.split("\t");
    if (instanceId !== INSTANCE_ID) continue;
    live.add(name);
    if (!armedSessions.has(name) || SHELL_CMDS.has(command)) continue;
    const armed = armedSessions.get(name);
    if (armed.firing) continue;
    // The arm stays in the map until its prompt has settled, not until it is
    // picked up. Building a goal prompt reads the vault first, and promptPending
    // has to stay true across that read, or a notice can win the pane in the
    // gap and be typed into the activation prompt.
    armed.firing = true;
    /** Commits the caller's receipt before forgetting the durable arm. */
    const settle = async (arrived) => {
      await (armed.onTyped ?? noop)(arrived);
      if (armedSessions.get(name) === armed) armedSessions.delete(name); // never drop a newer arm
      await clearArmedPrompt(ARMED_ROOT, name).catch(() => {});
    };
    /** Leaves a failed receipt armed so the next pass or restart can retry it. */
    const failed = (error) => {
      armed.firing = false;
      reportArmedPromptFailure(error);
    };
    if (armed.prompt) typePromptWhenReady(name, armed.prompt, armed.submit, "armed prompt").then(settle).catch(failed);
    else if (area && file) typeGoalPromptWhenReady(name, area, file, armed.submit, armed.extraFiles).then(settle).catch(failed);
    else {
      // No goal bound yet: nothing left to type, and nobody was promised a
      // callback for a prompt that never existed.
      if (armedSessions.get(name) === armed) armedSessions.delete(name);
      clearArmedPrompt(ARMED_ROOT, name).catch(() => {});
    }
  }
  for (const [name, armed] of [...armedSessions.entries()]) {
    if (live.has(name)) continue;
    try {
      if (armed.onTyped) await armed.onTyped(false);
      armedSessions.delete(name);
      await clearArmedPrompt(ARMED_ROOT, name).catch(() => {});
    } catch (error) {
      armed.firing = false;
      reportArmedPromptFailure(error);
    }
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
async function armSession(name, { submit = false, prompt = "", extraFiles = [], onTyped = null } = {}) {
  armedSessions.set(name, { submit, prompt, extraFiles, onTyped });
  try {
    await writeArmedPrompt(ARMED_ROOT, name, { submit, prompt, extraFiles });
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
  const sessions = await listAllSessions();
  // An empty snapshot cannot say these sessions died (snapshotCanJudgeAbsence):
  // keep every record; the next boot that sees a real world sweeps them.
  if (!snapshotCanJudgeAbsence(sessions)) return;
  const live = new Map(sessions.map((session) => [session.name, session]));
  for (const record of records) {
    const observed = live.get(record.session);
    if (observed && !observed.owned) continue;
    if (!observed) {
      if (!(await sessionOwnership.ownsRecorded(record.session))) continue;
      await clearArmedPrompt(ARMED_ROOT, record.session).catch(() => {});
      continue;
    }
    await armSession(record.session, { submit: record.submit, prompt: record.prompt, extraFiles: record.extraFiles });
  }
}

// ---- cross-agent messages ----
// One queue per target session. The server is the only writer into panes, so
// every message flows through here: stamped with the sender's identity,
// delivered only into a positively identified empty composer, and audited to
// ~/.tangent/agent-shell-messages.jsonl. Generic `tangent send` entries
// also live in one atomic queue under Agent Shell state until presentation
// settles. Rules live in agent-messages.mjs.

const MESSAGE_POLL_MS = 2000;
const MESSAGE_LOG = process.env.AGENT_MESSAGE_LOG ?? path.join(os.homedir(), ".tangent", "agent-shell-messages.jsonl");
const MESSAGE_QUEUE_FILE = process.env.TANGENT_MESSAGE_QUEUE_FILE
  ?? path.join(path.dirname(MESSAGE_LOG), "agent-shell", "message-queue.json");
const messageQueueStore = await openMessageQueueStore({ file: MESSAGE_QUEUE_FILE });
const messages = createMessageDelivery({
  file: MESSAGE_LOG,
  store: messageQueueStore,
  sessions: listDeliverySessions,
  /** Delivers a complete message through the prompt transport. */
  deliverText: (target, text, label, options) => typePromptWhenReady(target, text, true, label, options),
  notices: { delivered: markBrainNoticesDelivered },
  /** The scheduler is constructed below; delivery begins only after this callback runs. */
  wake: () => runtimeScheduler.wake(),
});

const runtimeScheduler = createRuntimeScheduler([
  {
    name: "goal reconciliation", intervalMs: RECONCILE_INTERVAL_MS,
    /** Keeps durable repair live inside the replaceable controller. */
    active: () => true,
    /** Reads one current session snapshot and repairs stale work bindings. */
    async run() {
      const sessions = await listAllSessions();
      // The snapshot's own capture time bounds what it can testify about: a
      // step or binding created after the capture is invisible to it, so
      // absence is judged against loadedAt, never against the clock now.
      await reconcileGoals(sessions, sessionObservation.status().loadedAt || Date.now());
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
    active: messages.active,
    run: messages.tick,
  },
  {
    name: "processes", intervalMs: 10_000,
    /** A due process must reach the brain inbox whether or not a browser is open. */
    active: () => true,
    /** Tells the Area brain about each due process note (ADR-0043). */
    async run() {
      await sweepProcesses({ treesRoot: TREES_ROOT, stateRoot: PROCESSES_ROOT, runProbe: runProcessProbe, openGoalFor: openGoalForProcess, notify: notifyBrain, hiddenAreaStatus, brainLive: loopBrainLive });
    },
  },
  {
    name: "material Operation events", intervalMs: 10_000,
    /** Operation results must reach the brain even when no browser polls the shelf. */
    active: () => true,
    /** Projects root-owned Operation state into durable exact-Area outboxes. */
    async run() {
      const snapshot = await programsSnapshot({ treesRoot: TREES_ROOT, sessions: await listProgramSessions() });
      await projectMaterialOperationEvents(snapshot);
    },
  },
]);

/**
 * The launch command and label recorded on one live session. Both are empty
 * when the session carries none, which is a refusal, never a reason to guess.
 */
async function sessionLaunch(session) {
  const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", "=" + session + ":", "#{@tangent_launch_command}\t#{@tangent_launch}\t#{@tangent_launch_ref}"]).catch(() => ({ stdout: "" }));
  const [command = "", label = "", ref = ""] = String(stdout).replace(/\n$/, "").split("\t");
  return { command: command.trim(), label: label.trim(), ref: ref.trim() };
}

/**
 * Primes a session sitting at its shell: the launch command the caller named,
 * typed but not submitted, and the goal prompt armed to follow whatever
 * harness the user starts. A pane that is already running something is left
 * alone — priming must never type over an agent mid-conversation.
 */
async function primeGoalSession(session, { launch = false, command = "", extraFiles = [], prompt = "", onTyped = null } = {}) {
  // The caller names the harness or nothing is typed. spawnGoalSession
  // refuses a start with no command, and a pane that reached its shell
  // between that check and this one must not get an Area default nobody
  // asked for: not priming is visible, a wrong harness is not.
  if (!command) return false;
  const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", "=" + session + ":", "#{pane_current_command}"]);
  if (!SHELL_CMDS.has(stdout.trim())) return false;
  await armSession(session, { submit: launch, prompt, extraFiles, onTyped });
  await typeInto(session, withDefaultModel(command), false);
  if (launch) {
    await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "Enter"]);
    await sleep(250);
  }
  return true;
}

/**
 * Spawns (or reattaches) the work session for one goal: a plain shell in
 * the area's repo with the suggested agent command pre-typed, bound via
 * @tangent_area + @tangent_goal, goal mechanically flipped to active.
 * Only a brain start reaches this (D8): the queue start and the exact-attempt
 * replacement. Both the launch line and the opening prompt follow the
 * type-but-never-submit rule unless the start asks for a direct launch.
 * The path option gives the new pane one exact directory instead of the
 * Area repository; a pipeline step passes its own.
 */
async function spawnGoalSession(area, slug, { approved = false, launch = false, command = "", label = "", ref = "", path: workingDirectory = "", workFolder = null, extraSlugs = [], pipeline = null, continuation = null, attemptId = "", deferBinding = false, onPrimed = null, trace = null } = {}) {
  const areaGoals = await readAreaGoals(area);
  trace?.mark("spawn area goals ready", { goals: areaGoals.length });
  const o = areaGoals.find((t) => t.slug === slug);
  if (!o) return { status: 404, error: `no goal "${slug}" on ${area}` };
  if (["done", "dropped", "parked"].includes(o.status)) return { status: 409, error: `goal is ${o.status}` };
  const sessions = await listSessions();
  trace?.mark("spawn sessions ready", { sessions: sessions.length });
  // Extra Goals ride along in the same session: same Area only, still open,
  // never pulled away from another live session's ownership.
  const liveNames = new Set(sessions.map((s) => s.name));
  const extras = [...new Set(extraSlugs)]
    .map((extraSlug) => areaGoals.find((t) => t.slug === extraSlug))
    .filter((extra) => extra && extra.slug !== slug && !["done", "dropped", "parked"].includes(extra.status));
  const baseName = normName(`${area.split("/").pop()}--${slug}`).slice(0, 60);
  const phaseName = pipeline ? pipeline.sessionName : continuation ? continuation.sessionName : baseName;
  const ownExtras = extras.filter((extra) => !extra.session || !liveNames.has(extra.session) || [o.session, baseName, phaseName].includes(extra.session));
  const extraFiles = ownExtras.map((extra) => extra.file);
  // Starting a Goal that already has a session re-primes it: a pane left
  // at a shell (the agent was stopped to do ordinary work) gets the launch
  // line and the prompt again, a pane still running one is only reattached.
  // A pipeline step or a continuation always forces a fresh session: there
  // is never a reason to reattach to an old, about-to-be-killed one.
  const existing = (pipeline || continuation) ? null : [o.session, phaseName, baseName].find((n) => n && sessions.some((s) => s.name === n));
  const live = existing ? sessions.find((session) => session.name === existing) : null;
  const existingAtShell = Boolean(live && SHELL_CMDS.has(live.command));
  // A fresh session opens in the step's own directory, else the Area's bound
  // folder. Nothing else: an Area that binds no folder is refused before any
  // session or record exists, because a worker that silently opens in the
  // vault looks right on Work and does the wrong thing. A reattached session
  // keeps the folder it already has.
  const folder = existing
    ? { cwd: live?.cwd ?? "", source: "session", branch: null }
    : workFolder ?? (workingDirectory ? { cwd: workingDirectory, source: "step", branch: null } : await areaWorkFolder(area));
  if (!folder) return { status: 409, error: `goal ${slug}: ${unboundAreaMessage(TREES_ROOT, area)}` };
  trace?.mark("work folder resolved", { source: folder.source });
  // A pipeline step, or a continued solo session, is always a fresh session
  // with its own name; the step prompt is typed verbatim once the harness
  // is up. AGENT_SHELL_TEST_NO_LAUNCH leaves the pane at its shell so tests
  // can prove binding without a harness.
  const stepPrompt = pipeline
    ? await pipelineStepPrompt(area, o, pipeline.record, pipeline.index, ownExtras, pipeline.sessionName, trace, folder)
    : continuation
      ? await goalPrompt(area, o, ownExtras, continuation.entries, null, folder)
      : "";
  trace?.mark("step prompt ready", { characters: stepPrompt.length });
  if ((pipeline || continuation) && process.env.AGENT_SHELL_TEST_NO_LAUNCH === "1") launch = false;
  // A new launch, including one in an existing shell pane, resolves after the
  // saved Area edit. An explicit request still wins, while an agent that
  // already runs keeps its recorded launch.
  // A new launch names its own harness or it does not happen. Tangent never
  // supplies one: a worker that starts on a harness nobody named costs its
  // whole run before the mistake is visible.
  if (!command && (!existing || existingAtShell)) {
    return { status: 409, error: `goal ${slug}: this start named no harness. Pass --launch <harness[/model[/effort]]>.\n${await launchHelpLines(area)}` };
  }
  trace?.mark("launch resolved", { reattachedRunningAgent: Boolean(existing && !existingAtShell) });
  if (existing) {
    await execFileAsync("tmux", ["set-option", "-t", existing, "@tangent_phase", "execute"]);
    if (existingAtShell && label) await execFileAsync("tmux", ["set-option", "-t", existing, "@tangent_launch", label]);
    if (existingAtShell && ref) await execFileAsync("tmux", ["set-option", "-t", existing, "@tangent_launch_ref", ref]);
    if (existingAtShell && command) await execFileAsync("tmux", ["set-option", "-t", existing, "@tangent_launch_command", command]);
    let primed = false;
    if (approved && live && !SHELL_CMDS.has(live.command)) {
      if (live.state === "working") return { status: 409, error: "the agent is still working; wait before you approve another assignment" };
      await typeInto(existing, await goalPrompt(area, o, ownExtras, [], null, folder), true);
    } else {
      primed = await primeGoalSession(existing, { launch, command, extraFiles }).catch(() => false);
    }
    const rebind = [o, ...ownExtras].filter((goal) => goal.status !== "active" || goal.session !== existing);
    if (rebind.length) {
      for (const goal of rebind) await writeGoalBinding(goal.file, { status: "active", session: existing });
      await vaultCommit(rebind.map((goal) => goal.file), `update: ${area} ${rebind.length === 1 ? `goal ${rebind[0].slug}` : `${rebind.length} goals`} active`, area, existing);
    }
    if (existingAtShell && ref) await launchCatalog.saveMemory(area, "work", parseLaunch(ref));
    return { status: 200, session: existing, reattached: true, primed };
  }
  // No command: tmux runs the login shell, so aliases (claude-otto) resolve
  // and the session outlives whatever agent is started in it.
  const immutableTarget = await createOwnedTmuxSession(phaseName, ["-d", "-s", phaseName, "-c", folder.cwd]);
  trace?.mark("tmux session created", { session: phaseName });
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_area", area]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_cwd", folder.cwd]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_goal", o.file]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_kind", "goal"]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_phase", "execute"]);
  await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_launch_command", command]);
  if (label) await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_launch", label]);
  if (ref) await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_launch_ref", ref]);
  if (pipeline) {
    await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_pipeline", o.file]);
    await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_step", String(pipeline.index)]);
    await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_assignment", String(pipeline.record.steps[pipeline.index - 1]?.id ?? "")]);
    if (attemptId) await execFileAsync("tmux", ["set-option", "-t", phaseName, "@tangent_attempt", attemptId]);
  }
  try {
    const owned = [o, ...ownExtras];
    if (!deferBinding) {
      for (const goal of owned) await writeGoalBinding(goal.file, { status: "active", session: phaseName });
      await vaultCommit(owned.map((goal) => goal.file), `update: ${area} ${owned.length === 1 ? `goal ${slug}` : `${owned.length} goals`} active`, area, phaseName);
    }
  } catch (err) {
    console.error("goal binding:", err.message ?? err);
  }
  trace?.mark("goal binding persisted", { session: phaseName });
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
      const primed = await primeGoalSession(phaseName, { launch, command, extraFiles, prompt: stepPrompt, onTyped: onPrimed });
      if (!primed && onPrimed) onPrimed(false);
    } catch (err) {
      console.error("prime session:", err.message ?? err);
      if (onPrimed) onPrimed(false);
    }
  };
  if (launch) await primeNewSession();
  else primeNewSession();
  trace?.mark("session primed", { session: phaseName, awaited: launch });
  if (ref) await launchCatalog.saveMemory(area, "work", parseLaunch(ref));
  return { status: 200, session: phaseName, target: immutableTarget, cwd: folder.cwd, cwdSource: folder.source };
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

let reconciling = false;
/**
 * Repairs Goal bindings after a session ends. This background pass never
 * stops a tmux session. Goal files can move or change while another agent
 * works, so only an explicit user action has authority to end a Run.
 */
async function reconcileGoals(sessions, snapshotAt = Date.now()) {
  // runtimeScheduler owns the reconciliation cadence and already keeps this
  // lane serial. Keep the local guard for defensive re-entry, but do not
  // throttle a due scheduler pass a second time: the scheduler records its
  // timestamp before collecting the session snapshot, so a duplicate elapsed
  // time check here can reject the boundary pass and delay durable repairs by
  // another full interval.
  if (reconciling) return;
  // An empty snapshot is a wrong-world signal, never proof that a session
  // ended (snapshotCanJudgeAbsence): judging against one marked live workers
  // stopped when a test-spawned server reconciled the real records.
  if (!snapshotCanJudgeAbsence(sessions)) {
    // A pending brain stop carries its own immutable ownership evidence and
    // does not rely on a world snapshot. Let that state machine settle even
    // when an empty tmux list is not trustworthy for Goal recovery.
    reconciling = true;
    try { await reconcileBrains(sessions); }
    catch (error) { console.error("brain reconcile:", error.message ?? error); }
    finally { reconciling = false; }
    return;
  }
  reconciling = true;
  try {
    const live = new Set(sessions.map((s) => s.name));
    const byFile = new Map();
    for (const area of flattenAreaPaths(await readTree(TREES_ROOT))) {
      for (const t of await readAreaGoals(area)) byFile.set(t.file, t);
    }
    const closed = [...byFile.values()].filter((goal) => ["done", "dropped"].includes(goal.status));
    const closedCleanup = closed.length ? await finishGoalExecutions({
      goalFiles: closed.map((goal) => goal.file),
      reason: "goal-done",
      sessions,
    }) : null;
    if (closedCleanup?.releasedGoals.length) await vaultCommit(closedCleanup.releasedGoals, "update: release Goals from finished worker", closed[0].area, null);
    for (const t of byFile.values()) {
      if (t.brainSessionBinding) {
        await writeGoalBinding(t.file, {
          status: SETTLED_GOAL_STATUSES.has(t.status) ? t.status : "open",
          session: null,
        });
        await vaultCommit([t.file], `update: ${t.area} goal ${t.slug} released from Area brain session`, t.area, null);
        continue;
      }
      if (SETTLED_GOAL_STATUSES.has(t.status)) continue;
      if (t.session && !live.has(t.session) && !(await sessionOwnership.ownsRecorded(t.session))) continue;
      // The Goal file's own mtime is when its binding was last written: a
      // binding fresher than the sessions snapshot above is not stopped.
      if (!goalBindingGoneFromSnapshot(t, live, snapshotAt)) continue;
      await writeGoalBinding(t.file, { status: "open", session: null });
      await vaultCommit([t.file], `update: ${t.area} goal ${t.slug} back to open, session ended`, t.area, null);
      if (!(await pipelineStepForSession(t.session))) {
        await notifyBrain(t.area, `Goal ${t.slug}: its session ${t.session} ended without a pipeline; the Goal is open again.`);
      }
    }
    await reconcilePipelines(sessions, snapshotAt);
    await reconcileBrains(sessions);
    await reconcileContextHandovers(sessions.filter((session) => session.owned));
    const missingFinishedGoals = new Set();
    for (const s of sessions) {
      if (!s.goal) continue;
      const t = byFile.get(s.goal);
      if (t) continue;
      if (s.kind === "goal") missingFinishedGoals.add(s.goal);
    }
    for (const file of missingFinishedGoals) await finishGoalExecutions({ goalFiles: [file], reason: "goal-done", sessions });
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
  return mapWithConcurrency(
    sessions,
    Number(process.env.TANGENT_GOAL_INFO_CONCURRENCY ?? 16),
    async (s) => {
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
    }
  );
}

// ---- goal lookup + start ----
// There is no focus concept: the tree (scoped client-side) is the only lens,
// and the user starts goals going themselves. The one spawn path in the
// shell is the explicit /api/goals/start; everything else — clicking,
// scoping, selecting — is side-effect free.

const CLOSED_GOAL = new Set(["done", "dropped", "parked"]);

/** Every goal in the vault keyed by its vault-relative file path. */
async function goalsByFile() {
  const map = new Map();
  for (const area of flattenAreaPaths(await readTree(TREES_ROOT))) {
    for (const o of await readAreaGoals(area)) map.set(o.file, o);
  }
  return map;
}

/**
 * Fills each Area's milestone index from the Goals that already closed, once.
 * Without this the recent-work view starts empty on every Area that finished
 * work before the index existed, which is every Area but one. `appendMilestone`
 * is keyed by Goal file, so a repeated boot adds nothing and costs one read.
 * The Goal file's own modified time dates the milestone, so the order matches
 * the work rather than the boot.
 */
async function backfillClosureMilestones() {
  for (const goal of (await goalsByFile()).values()) {
    if (!["done", "dropped"].includes(goal.status)) continue;
    const outcome = goal.status === "done" ? "done" : "dropped";
    const at = Number.isFinite(goal.mtime) ? new Date(goal.mtime).toISOString() : undefined;
    const title = goal.title || goal.slug || goal.file;
    await appendMilestone({
      root: BRAINS_ROOT,
      area: goal.area,
      kind: `goal-${outcome}`,
      summary: outcome === "done" ? `${title} closed.` : `${title} was dropped.`,
      ref: goal.file,
      idempotencyKey: `goal-${outcome}:${goal.file}`,
      ...(at ? { now: at } : {}),
    }).catch((error) => console.error("milestone backfill:", error.message ?? error));
  }
}

/** Reads one Goal from its own Area without walking the complete vault. */
async function goalByFile(file) {
  const relative = String(file ?? "").replaceAll("\\", "/");
  const area = path.posix.dirname(relative);
  if (!validAreaPath(area) || !/\/(?:goal|outcome)-[a-z0-9-]+\.md$/.test(`/${relative}`)) return null;
  return (await readAreaGoals(area)).find((goal) => goal.file === relative) ?? null;
}

/** Hashes semantic Goal text without volatile execution bindings. */
async function goalContentRevision(file) {
  const text = await readFile(path.join(TREES_ROOT, file), "utf8");
  const stable = text.replace(/^(?:status|session|waiting_on):.*$/gm, (line) => `${line.split(":", 1)[0]}:`);
  return documentHash(stable);
}

// ---- agent pipelines ----
// A pipeline is a list of steps on one Goal. Each step is an ordinary Goal
// session (spawnGoalSession with the pipeline option) or the step prompt
// delivered into an earlier step's live session. The record under
// PIPELINES_ROOT holds the steps and their handovers; the Goal file's session
// binding follows the current step. Design: design-agent-pipelines.

/** The tmux session name for one step; restarts get the smallest free suffix. */
function pipelineStepSessionName(record, index, liveNames) {
  const base = normName(`${record.area.split("/").pop()}--${record.slug}`);
  const suffix = index === 1 ? "" : `-s${index}`;
  return uniqueSessionName(base, suffix, liveNames, 60);
}

/** Resolves one step's launch to an exact command, or returns the error. */
async function resolveStepLaunch(area, step) {
  if (!step.launch) return step.command ? { command: step.command, label: step.label || "Edited command" } : { error: `step ${step.index}: no command` };
  return launchCatalog.allowed(area, step.launch);
}

/** The Area's declared work default as `harness[/model[/effort]]`, or null when none resolves. */
async function declaredWorkLaunch(area) {
  const launch = await launchCatalog.forArea(area);
  if (!launch || launch.error || !launch.harness) return null;
  return launchRef(launch);
}

/**
 * The two closing lines of every missing-launch refusal: what this Area
 * declares, and where the valid ids are. A brain that reads the error can
 * retry correctly without a second lookup.
 */
async function launchHelpLines(area) {
  const declared = await declaredWorkLaunch(area);
  const what = declared ? `declares the work default ${declared}` : "declares no work default";
  return `${area} ${what}.\nRun \`tangent harness list --area ${area}\` for the valid ids.`;
}

/**
 * Refuses a start whose steps do not each name a harness, naming every step
 * that is missing one. Runs before anything is written, so a refused start
 * leaves no record and no session behind. firstIndex is the step number of
 * the first entry, so appended steps name themselves correctly.
 */
async function missingStepLaunches(area, steps, firstIndex = 1) {
  const missing = (Array.isArray(steps) ? steps : [])
    .map((step, position) => (step?.launch || String(step?.command ?? "").trim() ? 0 : firstIndex + position))
    .filter(Boolean);
  if (!missing.length) return null;
  const named = missing.map((index) => `step ${index} has no --launch`);
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")}, and ${named[named.length - 1]}`;
  return `${list}. Every step names its own harness.\nPass --launch <harness[/model[/effort]]> for each step.\n${await launchHelpLines(area)}`;
}

/**
 * Resolves every step's working directory before anything is written. A step
 * may name any directory on the machine, so a brain can put one worker in a
 * plugin, a sibling repository, or a scratch tree while the rest of the
 * pipeline stays in the Area repository. A step that names no directory is
 * returned untouched and falls back to the Area repository in
 * spawnGoalSession. The error contract of design-goal-launch-environments
 * applies: a directory that does not resolve stops the launch, names itself,
 * and leaves no record and no tmux session behind. firstIndex is the step
 * number of the first entry, so appended steps name themselves correctly.
 */
function resolveStepPaths(steps, firstIndex = 1) {
  if (!Array.isArray(steps)) return { steps };
  const resolved = [];
  for (const [position, step] of steps.entries()) {
    const requested = typeof step?.path === "string" ? step.path.trim() : "";
    if (!requested) {
      resolved.push(step);
      continue;
    }
    const dir = requested.replace(/^~(?=\/|$)/, os.homedir());
    const index = firstIndex + position;
    if (!path.isAbsolute(dir)) return { error: `step ${index}: path ${requested} is not an absolute directory` };
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return { error: `step ${index}: no directory ${dir}` };
    resolved.push({ ...step, path: dir });
  }
  return { steps: resolved };
}

/**
 * Settles the folder of every step before anything is written: a step's own
 * path, else the Goal's Area folder. One step with neither refuses the whole
 * start with the line to add, so a refused start leaves no record and no
 * session. Returns `{ folders }` aligned with the steps, or `{ error }`.
 */
async function resolveStepFolders(goal, steps) {
  const folders = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    const folder = await stepWorkFolder(goal.area, step);
    if (!folder) return { error: `goal ${goal.slug}: ${unboundAreaMessage(TREES_ROOT, goal.area)}` };
    folders.push(folder);
  }
  return { folders };
}

/** Adds each step's settled folder to its launch disclosure row, beside the harness. */
function discloseStepFolders(rows, folders) {
  return rows.map((row, position) => ({ ...row, cwd: folders[position]?.cwd ?? null, cwdSource: folders[position]?.source ?? null }));
}

/**
 * The Area's declared harness id, or null when the Area declares nothing and
 * when its declaration is broken. Callers skip the comparison rather than
 * compare against a guess.
 */
async function areaHarnessId(area) {
  const launch = await launchCatalog.forArea(area);
  return launch && !launch.error && launch.harness ? launch.harness : null;
}

/**
 * The launch identity the calling brain itself runs on, or null when that
 * brain was started from an edited command and so has no harness id. This is
 * the one authority for a worker that names no harness of its own: a brain
 * launched as claude-otto dispatches claude-otto workers, whatever the Area
 * declares for hand-started work.
 */
function brainWorkerLaunch(brain) {
  const launch = currentGeneration(brain)?.resolvedLaunch?.ref;
  if (!launch?.harness) return null;
  return { harness: String(launch.harness), model: launch.model ?? null, effort: launch.effort ?? null };
}

/**
 * Turns the requested assignments into launched ones: every assignment that
 * names no harness takes the calling brain's own launch, and every
 * assignment is then resolved to its exact command. Nothing is written
 * before this returns, so a refusal or an unresolvable id leaves no record
 * and no session behind.
 *
 * A current brain caller can lend its own launch across Area boundaries. A
 * worker, stale brain, browser, or local shell must name the launch. Tangent
 * still supplies no harness from a profile or from a recorded command.
 */
async function materializeStepLaunches(area, steps, { firstIndex = 1, brain = null } = {}) {
  const fallback = brainWorkerLaunch(brain);
  const requested = Array.isArray(steps) ? steps : [];
  /** True when the caller already named this assignment's harness or command. */
  const named = (step) => Boolean(step?.launch) || Boolean(String(step?.command ?? "").trim());
  const filled = requested.map((step) => named(step) || !fallback
    ? step
    : { ...step, launch: { ...fallback }, launchSource: "brain-default" });
  const missing = await missingStepLaunches(area, filled, firstIndex);
  if (missing) return { status: 400, error: missing };
  const rows = [];
  for (const [position, step] of filled.entries()) {
    const index = firstIndex + position;
    const resolved = await resolveStepLaunch(area, { ...step, index });
    if (resolved.error) return { status: resolved.code === "launch-not-allowed" ? 403 : 409, code: resolved.code, error: `step ${index}: ${resolved.error}`, ...resolved };
    rows.push({
      index,
      launch: step.launch ? launchRef(step.launch) : null,
      source: step.launchSource === "brain-default" ? "brain-default" : "explicit",
      label: resolved.label,
      command: resolved.command,
    });
  }
  // The default a mismatch is measured against is the one that would have
  // been applied, never a second reading of the Area note.
  const defaultHarness = fallback?.harness ?? await areaHarnessId(area);
  const warnings = rows
    .filter((row) => row.source === "explicit" && row.launch && defaultHarness && row.launch.split("/")[0] !== defaultHarness)
    .map((row) => `step ${row.index}: --launch ${row.launch} differs from the default harness ${defaultHarness}.`);
  return { steps: filled, rows, warnings, defaultHarness };
}

/**
 * Writes what one assignment is about to run into the queue record and tells
 * every open shell, before any session is created or primed. The entry keeps
 * the facts it was written with, so a later reader can prove the harness was
 * settled while the assignment still had no session.
 */
async function discloseAssignmentLaunch(record, step, folder = null) {
  step.launchDisclosure = {
    launch: launchRef(step.launch) || null,
    source: step.launchSource ?? "explicit",
    label: step.label,
    command: step.command,
    cwd: folder?.cwd ?? null,
    cwdSource: folder?.source ?? null,
    assignmentStatus: step.status,
    session: step.session,
    disclosedAt: new Date().toISOString(),
  };
  await writePipeline(PIPELINES_ROOT, record);
  stateEvents.changed("assignment launch disclosed");
}

/**
 * Starts one pending step: fresh session by default, or the step prompt
 * delivered into an earlier step's live session when the step continues it.
 * The Goal binds to whichever session now works it.
 */
async function startPipelineStep(record, index, trace = null) {
  if (record.migrationProblem || record.status === "paused") return { status: 409, error: record.migrationProblem ?? "the Goal queue is paused" };
  let step = record.steps[index - 1];
  if (!step) return { status: 404, error: `no step ${index}` };
  const current = record.steps.find((item) => ["running", "waiting"].includes(item.status));
  if (current && current.id !== step.id) {
    return { status: 409, error: `assignment ${current.index} is current; assignment ${index} cannot start` };
  }
  if (step.status !== "pending") return { status: 409, error: `step ${index} is ${step.status}` };
  const resolved = await resolveStepLaunch(record.area, step);
  trace?.mark("step launch resolved");
  if (resolved.error) return { status: 409, code: resolved.code, error: `step ${index}: ${resolved.error}`, ...resolved };
  step.command = resolved.command;
  step.label = resolved.label;
  const byFile = new Map((await readAreaGoals(record.area)).map((goal) => [goal.file, goal]));
  trace?.mark("step area goals ready", { goals: byFile.size });
  const o = byFile.get(record.goal);
  if (!o) return { status: 404, error: `no goal file ${record.goal}` };
  if (!record.goalRevision) record.goalRevision = await goalContentRevision(record.goal);
  record.controllerArea = record.area;
  if (record.status !== "open") record.status = "open";
  const sessions = await listSessions();
  trace?.mark("step sessions ready", { sessions: sessions.length });
  const liveNames = new Set(sessions.map((item) => item.name));
  const extraSlugs = (record.extraFiles ?? []).map((extra) => byFile.get(extra)).filter((extra) => extra && extra.area === o.area).map((extra) => extra.slug);
  const source = continuationSource(record, step);
  const continuedSession = source?.session && liveNames.has(source.session) ? sessions.find((item) => item.name === source.session) : null;
  // The folder is settled and disclosed before anything is created. A step
  // that continues a live session keeps that session's folder; a fresh
  // session opens in the step's path or the Area's bound folder, and an
  // Area that binds nothing stops here with the line to add.
  const folder = continuedSession
    ? { cwd: continuedSession.cwd ?? "", source: source.attempts?.at(-1)?.cwdSource ?? "session", branch: null }
    : await stepWorkFolder(record.area, step);
  if (!folder) return { status: 409, error: `goal ${record.slug}: ${unboundAreaMessage(TREES_ROOT, record.area)}` };
  await discloseAssignmentLaunch(record, step, folder);
  // writePipeline canonicalizes assignments in place. Reacquire the stored
  // assignment before recording runtime state, or later writes mutate the
  // detached pre-canonicalization object and leave the queue pending.
  step = record.steps[index - 1];
  trace?.mark("step launch disclosed", { launch: step.launchDisclosure.launch });
  const attemptId = randomUUID();
  // The conversation id is chosen here, before the session exists, for a
  // harness that takes one at launch (ADR-0042). A continued session keeps
  // the conversation it already has.
  const stepHarness = await registryHarness(step.launch?.harness);
  const conversation = continuedSession ? source.attempts?.at(-1)?.providerSession ?? null : newConversation(stepHarness);
  let immutableTarget = null;
  if (continuedSession) {
    const goals = await readAreaGoals(record.area);
    const extras = extraSlugs.map((extraSlug) => goals.find((goal) => goal.slug === extraSlug)).filter(Boolean);
    const prompt = await pipelineStepPrompt(record.area, o, record, index, extras, source.session, trace, folder);
    messages.queue(source.session, { from: "tangent", area: record.area, text: prompt, banner: false, queuedAt: new Date().toISOString() });
    await execFileAsync("tmux", ["set-option", "-t", "=" + source.session + ":", "@tangent_step", String(index)]).catch(() => {});
    await execFileAsync("tmux", ["set-option", "-t", "=" + source.session + ":", "@tangent_assignment", step.id]).catch(() => {});
    await execFileAsync("tmux", ["set-option", "-t", "=" + source.session + ":", "@tangent_attempt", attemptId]).catch(() => {});
    const inspected = await sessionOwnership.inspect(source.session);
    if (inspected.state === "live" && inspected.instanceId === INSTANCE_ID) immutableTarget = inspected.target;
    if (o.status !== "active" || o.session !== source.session) {
      await writeGoalBinding(o.file, { status: "active", session: source.session });
      await vaultCommit([o.file], `update: ${record.area} goal ${record.slug} active`, record.area, source.session);
    }
    step.session = source.session;
  } else {
    if (source) {
      // The stable reference is the durable contract. When its live process is
      // gone, clear both the stable value and its legacy display projection.
      step.continueFromAssignmentId = null;
      step.continueFrom = null;
    }
    const sessionName = pipelineStepSessionName(record, index, liveNames);
    const result = await spawnGoalSession(record.area, record.slug, {
      approved: true,
      launch: true,
      command: launchWithConversation(stepHarness, step.command, conversation),
      label: step.label,
      ref: launchRef(step.launch),
      path: step.path,
      workFolder: folder,
      extraSlugs,
      pipeline: { record, index, sessionName },
      attemptId,
      trace,
    });
    if (result.status !== 200) return result;
    step.session = result.session;
    immutableTarget = result.target ?? null;
  }
  step.status = "running";
  step.startedAt = new Date().toISOString();
  step.endedAt = null;
  record.instanceId = INSTANCE_ID;
  step.attempts = [...(step.attempts ?? []), {
    id: attemptId,
    kind: step.nextAttemptKind ?? "managed",
    session: step.session,
    instanceId: INSTANCE_ID,
    target: immutableTarget,
    resolvedLaunch: {
      ref: step.launch ? structuredClone(step.launch) : null,
      command: step.command,
      label: step.label,
    },
    cwd: folder.cwd,
    cwdSource: folder.source,
    providerSession: conversation ? structuredClone(conversation) : null,
    contextFill: null,
    startedAt: step.startedAt,
    endedAt: null,
    report: null,
  }];
  delete step.nextAttemptKind;
  record.currentAssignmentId = step.id;
  record.revision = Math.max(1, Number(record.revision) || 1) + 1;
  record.assignments = record.steps;
  await writePipeline(PIPELINES_ROOT, record);
  trace?.mark("pipeline step persisted", { session: step.session });
  return { status: 200, session: step.session, index, pipeline: record };
}

/** One registry harness entry by id, or null when unknown or the registry is broken. */
async function registryHarness(harnessId) {
  if (!harnessId) return null;
  const registry = await launchCatalog.registry();
  if (registry.error) return null;
  return registry.harnesses.find((entry) => entry.id === harnessId) ?? null;
}

/** True when two context fill readings differ. */
function contextFillChanged(before, after) {
  return (before?.usedTokens ?? null) !== (after?.usedTokens ?? null) || (before?.windowTokens ?? null) !== (after?.windowTokens ?? null);
}

/** Creates the record for one Goal and starts its first step. */
async function startPipeline(file, { steps, extraFiles = [], start = true, attemptKind = "managed", brain = null } = {}) {
  const byFile = await goalsByFile();
  const o = byFile.get(file);
  if (!o) return { status: 404, error: `no goal file ${file}` };
  if (["done", "dropped", "parked"].includes(o.status)) return { status: 409, error: `goal is ${o.status}` };
  const existingQueue = await readPipeline(PIPELINES_ROOT, o.area, o.slug);
  if (existingQueue && !pipelineFinished(existingQueue)) return { status: 409, error: "this Goal already has an authoritative queue" };
  const sessions = await listSessions();
  if (o.session && sessions.some((item) => item.name === o.session)) {
    return { status: 409, error: `goal is owned by live session ${o.session}` };
  }
  // Fill and resolve every assignment before anything is written: a bad
  // launch names itself and leaves no record and no session behind.
  const materialized = await materializeStepLaunches(o.area, steps, { brain });
  if (materialized.error) return materialized;
  const located = resolveStepPaths(materialized.steps);
  if (located.error) return { status: 400, error: located.error };
  steps = located.steps;
  const folders = await resolveStepFolders(o, steps);
  if (folders.error) return { status: 409, error: folders.error };
  const error = validateSteps(steps);
  if (error) return { status: 400, error };
  const sameArea = extraFiles.map(String).filter((extra) => byFile.get(extra)?.area === o.area);
  const record = newPipeline({ goal: o.file, goalRevision: await goalContentRevision(o.file), area: o.area, slug: o.slug, extraFiles: sameArea, steps });
  record.instanceId = INSTANCE_ID;
  record.steps[0].nextAttemptKind = attemptKind;
  const { warnings } = materialized;
  const launches = discloseStepFolders(materialized.rows, folders.folders);
  await writePipeline(PIPELINES_ROOT, record);
  if (!start) return { status: 200, state: "queued", session: null, pipeline: record, warnings, launches };
  const started = await startPipelineStep(record, 1);
  if (started.status !== 200) return started;
  return { ...started, warnings, launches };
}

/**
 * Converts one live pre-queue Goal session into the authoritative queue.
 * The old continuation file stays untouched as detached compatibility evidence.
 */
async function migrateLiveSoloExecution(goal, sessions) {
  const existing = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
  if (existing) return existing;
  const candidates = sessions.filter((session) => session.kind === "goal" && (!session.phase || session.phase === "execute") && session.goal === goal.file);
  if (!candidates.length) return null;
  const legacy = await readContinuation(CONTINUATIONS_ROOT, goal.area, goal.slug);
  const record = newPipeline({
    goal: goal.file,
    goalRevision: await goalContentRevision(goal.file),
    area: goal.area,
    slug: goal.slug,
    steps: [{ instruction: "Complete this migrated solo Goal execution and submit a typed implementation result.", command: "true" }],
  });
  const step = record.steps[0];
  const launch = candidates.length === 1 ? await sessionLaunch(candidates[0].name) : null;
  step.command = String(legacy?.command || launch?.command || "true");
  step.label = String(legacy?.label ?? "Migrated solo execution");
  step.continuations = Array.isArray(legacy?.continuations) ? structuredClone(legacy.continuations) : [];
  step.contextReminders = legacy?.contextReminders && typeof legacy.contextReminders === "object" ? structuredClone(legacy.contextReminders) : {};
  step.attempts = candidates.map((session) => ({
    id: randomUUID(),
    kind: "legacy-solo",
    session: session.name,
    startedAt: Number.isFinite(session.created) ? new Date(session.created).toISOString() : legacy?.createdAt ?? record.createdAt,
    endedAt: null,
    report: null,
  }));
  if (candidates.length === 1) {
    step.status = "running";
    step.session = candidates[0].name;
    step.startedAt = step.attempts[0].startedAt;
    record.currentAssignmentId = step.id;
  } else {
    step.status = "stopped";
    record.status = "paused";
    record.migrationProblem = `Ambiguous legacy solo execution: ${candidates.map((session) => session.name).join(", ")}`;
  }
  record.migration = { source: legacy?.schema ?? "goal-session-binding", migratedAt: new Date().toISOString() };
  await writePipeline(PIPELINES_ROOT, record);
  return record;
}

/** Starts one pending assignment only after automatic brain recovery is exhausted. */
async function recoverQueuedGoal(goal) {
  const record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
  const brain = await readBrain(BRAINS_ROOT, goal.area);
  const problem = emergencyStartProblem(record, brain);
  if (problem) return { status: 409, error: problem };
  const next = record.steps.find((step) => step.status === "pending");
  next.nextAttemptKind = "julian-emergency";
  return startPipelineStep(record, next.index);
}

/** Finds the record and step a live session works, or null. */
async function pipelineStepForSession(sessionName) {
  for (const record of await readAllPipelines(PIPELINES_ROOT)) {
    const step = record.steps.find((item) => item.session === sessionName && ["running", "waiting"].includes(item.status));
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

/** Stable server identity for an exact retry when the CLI supplies no key. */
function workerHandoverOperationId(sessionName, text, report, idempotencyKey, kind = null) {
  return idempotencyKey || `report:${sessionName}:${createHash("sha256").update(JSON.stringify(report ?? (kind ? { kind, text } : { text }))).digest("hex")}`;
}

/** The send flags a worker has (D5), each with the queue effect it stands for. */
const WORKER_SEND_KINDS = new Set(["note", "done", "blocked", "question"]);

/**
 * Builds the stored report for one `tangent send brain` flag. Existing readers
 * keep working because the shapes are the typed reports they already know.
 * A review step's --done is a passed review at the current Goal revision.
 */
function reportFromSendKind(record, step, kind, text) {
  if (kind === "blocked") return { type: "failed", summary: text };
  if (kind === "question") return { type: "question-needed", summary: text, question: text };
  if (kind !== "done") return null;
  if (step.kind === "review") {
    return { type: "review-result", verdict: "passed", goalRevision: record.goalRevision, summary: text, criteria: [{ id: "done", passed: true, evidenceRefs: [text] }] };
  }
  return { type: "implementation-result", status: "done", summary: text };
}

/** One actionable refusal for a typed report that the queue did not accept. */
function workerReportRejection(error) {
  const reason = String(error?.message ?? error);
  return `The typed report was rejected (${reason}). Correct --report and run the same tangent send brain command again. Tangent recorded no report or brain notice.`;
}

/**
 * The durable notice text saved with a queue receipt before delivery. A send
 * starts with its flag word; a legacy typed report keeps its type line.
 */
function workerHandoverNotice(record, step, workerSession, report, text, kind = null) {
  if (kind) {
    return `${kind}: ${brainMessageExcerpt(text)} (Goal ${record.slug}, assignment ${step.index}, worker ${workerSession}, queue revision ${record.revision}, assignment status ${step.status})`;
  }
  const result = `${report.type}${report.verdict ? ` (${report.verdict})` : report.status ? ` (${report.status})` : ""}`;
  return `Goal ${record.slug}: assignment ${step.index} from worker ${workerSession} submitted ${result}. Queue revision ${record.revision} recorded assignment status ${step.status}. ${brainMessageExcerpt(report.summary || text)}`;
}

/** Makes the receipt's exact-Area notice durable before a worker sees success. */
async function settleWorkerHandoverNotice(record, receipt) {
  // writePipeline canonicalizes the queue in place. That keeps each assignment
  // object stable, but replaces its normalized receipt array, so a receipt held
  // across the queue-acceptance write can be detached from `record`. Always
  // mutate the receipt currently owned by the authoritative queue.
  /** Finds the canonical copy after any queue write. */
  const storedReceipt = () => record.steps
    .find((step) => step.id === receipt.assignmentId)
    ?.handoverReceipts?.find((candidate) => candidate.id === receipt.id) ?? receipt;
  receipt = storedReceipt();
  if (receipt.destinationArea !== record.area || record.controllerArea !== record.area) {
    return {
      status: 503,
      error: `The Goal queue recorded submission ${receipt.id}, but its exact-Area destination is inconsistent. Keep this worker open and ask the ${record.area} brain to repair the queue. Tangent sent no notice.`,
    };
  }
  if (!receipt.notice.id) {
    try {
      const routed = await routeBrainNotice(receipt.destinationArea, receipt.notice.text, { idempotencyKey: receipt.notice.sourceId });
      recordWorkerHandoverNotice(receipt, routed.notice);
      await writePipeline(PIPELINES_ROOT, record);
      receipt = storedReceipt();
    } catch (error) {
      console.error("worker handover notice:", error?.message ?? error);
      return {
        status: 503,
        error: `The Goal queue recorded submission ${receipt.id}, but its exact-Area brain notice is not durable yet. Run the same tangent send brain command again, unchanged. Tangent will repair and deduplicate the notice.`,
      };
    }
  }
  return { status: 200, receipt };
}

/**
 * Records one worker send under the queue's per-Goal mutation lock. `kind`
 * is a send flag (note, done, blocked, question); a legacy typed `report`
 * arrives with no kind, and plain text with neither is a note.
 */
async function handoverPipelineStep(sessionName, text, report = null, idempotencyKey = "", kind = null) {
  const records = await readAllPipelines(PIPELINES_ROOT);
  const matched = records.find((record) => record.steps.some((step) => step.session === sessionName || step.attempts?.some((attempt) => attempt.session === sessionName)));
  if (matched) return withGoalQueueMutation(matched.goal, () => handoverPipelineStepUnlocked(sessionName, text, report, idempotencyKey, kind));

  // A plain handover from a session whose step already swapped to a fresh one
  // must not complete the step out from under the live replacement.
  const movedTo = await swappedAwayNaming(sessionName);
  if (movedTo) return { status: 409, error: `This assignment moved to ${movedTo}. Submit from that live worker session instead. Nothing was recorded.` };
  const live = (await listSessions()).find((session) => session.name === sessionName && session.kind === "goal" && session.goal);
  if (!live) return { status: 404, error: "This session is not a running Goal worker. Run tangent send brain inside the assigned worker session. Nothing was recorded." };
  const goal = (await goalsByFile()).get(live.goal);
  if (!goal) return { status: 404, error: "This worker has no Goal assignment. Read tangent goal show, then report from the assigned session. Nothing was recorded." };
  return withGoalQueueMutation(goal.file, () => handoverPipelineStepUnlocked(sessionName, text, report, idempotencyKey, kind));
}

/** Performs one serialized worker submission or exact retry. */
async function handoverPipelineStepUnlocked(sessionName, text, report = null, idempotencyKey = "", kind = null) {
  const operationId = workerHandoverOperationId(sessionName, text, report, idempotencyKey, kind);
  const records = await readAllPipelines(PIPELINES_ROOT);
  for (const record of records) {
    const step = record.steps.find((item) => (item.session === sessionName || item.attempts?.some((attempt) => attempt.session === sessionName))
      && (item.reports?.some((stored) => stored.idempotencyKey === operationId) || workerHandoverReceipt(record, item, sessionName, operationId)));
    if (!step) continue;
    let receipt = workerHandoverReceipt(record, step, sessionName, operationId);
    if (!receipt) {
      const stored = (step.reports ?? []).find((item) => item.idempotencyKey === operationId);
      receipt = appendWorkerHandoverReceipt(record, step, {
        workerSession: sessionName,
        idempotencyKey: operationId,
        reportType: report?.type ?? stored?.type ?? "note",
        queueRevisionBefore: record.revision,
        queueResult: "accepted-before-receipt-cutover",
        noticeText: workerHandoverNotice(record, step, sessionName, report ?? stored, text, report || stored ? null : "note"),
      }).receipt;
      await writePipeline(PIPELINES_ROOT, record);
    }
    const settled = await settleWorkerHandoverNotice(record, receipt);
    return settled.status === 200
      ? { status: 200, state: "repeated", next: null, pipeline: record, receipt: settled.receipt, repeated: true }
      : settled;
  }

  // A source process can finish typing after its ready replacement became
  // current. Preserve that report on the ended source attempt, but never let
  // it advance or mutate the replacement assignment.
  for (const record of records) {
    const step = record.steps.find((assignment) => assignment.attempts?.some((attempt) => attempt.session === sessionName
      && attempt.endedAt
      && attempt.disposition?.type === "replaced"));
    const attempt = step?.attempts?.find((candidate) => candidate.session === sessionName
      && candidate.endedAt
      && candidate.disposition?.type === "replaced");
    if (!step || !attempt) continue;
    try {
      const evidence = report
        ? { ...structuredClone(report), text }
        : { type: kind ?? "note", text };
      const attached = attachLateSourceEvidence(record, {
        assignmentId: step.id,
        attemptId: attempt.id,
        evidence,
        idempotencyKey: operationId,
      });
      if (!attached.repeated) await writePipeline(PIPELINES_ROOT, record);
      await routeBrainNotice(
        record.area,
        `Goal ${record.slug}: late evidence from replaced source ${sessionName} was preserved on attempt ${attempt.id}; it did not advance the current assignment. ${brainMessageExcerpt(report?.summary || text)}`,
        { idempotencyKey: `late-evidence:${operationId}` },
      );
      return { status: 200, state: attached.repeated ? "repeated" : "late-evidence", next: null, pipeline: record, repeated: attached.repeated };
    } catch (error) {
      if (error instanceof GoalExecutionTransitionError) {
        return { status: 409, error: error.message, code: error.code, pipeline: error.pipeline ?? record };
      }
      throw error;
    }
  }

  let found = await pipelineStepForSession(sessionName);
  if (!found) {
    const live = (await listSessions()).find((session) => session.name === sessionName && session.kind === "goal" && session.goal);
    if (!live) return { status: 404, error: "This session is not a running Goal worker. Run tangent send brain inside the assigned worker session. Nothing was recorded." };
    const goal = (await goalsByFile()).get(live.goal);
    if (!goal) return { status: 404, error: "This worker has no Goal assignment. Read tangent goal show, then report from the assigned session. Nothing was recorded." };
    const migrated = await migrateLiveSoloExecution(goal, await listSessions());
    const step = migrated?.steps.find((item) => item.status === "running" && item.session === sessionName);
    if (!step) return { status: 409, error: `${migrated?.migrationProblem ?? "The legacy Goal could not become an authoritative queue"}. Nothing was recorded.` };
    found = { record: migrated, step };
  }
  if (found.record.migrationProblem || found.record.status === "paused" || found.record.controllerArea !== found.record.area) {
    return { status: 409, error: `The authoritative Goal queue is paused: ${found.record.migrationProblem ?? "it needs repair"}. Keep this worker session open and repair the queue for ${found.record.area}. Nothing was recorded.` };
  }
  const effectiveReport = report ?? reportFromSendKind(found.record, found.step, kind, text);
  const effectiveKind = report ? null : kind ?? "note";
  return completePipelineStep(found.record, found.step, text, "agent", effectiveReport, operationId, sessionName, effectiveKind);
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
 * Marks a step complete with its handover text and advances the line. A step
 * asked to hand over again (a step was appended after it finished) keeps its
 * first handover and gains the second below it: nothing already handed over
 * is lost.
 */
async function completePipelineStep(record, step, text, source, report = null, idempotencyKey = "", workerSession = "", kind = null) {
  const queueRevisionBefore = record.revision;
  step.handover = step.handover ? `${step.handover}\n\n${text}` : text;
  step.handoverSource = source;
  const endedAt = new Date().toISOString();
  let typed = null;
  if (source === "agent" && !report) {
    // A plain note from a worker: kept on the step and told to the brain.
    // The assignment keeps its status, the queue keeps its revision.
    record.assignments = record.steps;
    const receipt = appendWorkerHandoverReceipt(record, step, {
      workerSession,
      idempotencyKey,
      reportType: "note",
      queueRevisionBefore,
      queueResult: "note",
      noticeText: workerHandoverNotice(record, step, workerSession, null, text, "note"),
    }).receipt;
    await writePipeline(PIPELINES_ROOT, record);
    const settled = await settleWorkerHandoverNotice(record, receipt);
    return settled.status === 200 ? { status: 200, state: "noted", next: null, pipeline: record, receipt: settled.receipt } : settled;
  }
  if (report) {
    try {
      typed = recordTypedReport(record, step, report, idempotencyKey, endedAt);
    } catch (error) {
      return { status: 409, error: source === "agent" ? workerReportRejection(error) : String(error.message ?? error) };
    }
    if (source === "agent" && step.status === "waiting") record.currentAssignmentId = step.id;
  } else {
    step.status = source === "skip" ? "skipped" : "complete";
    step.endedAt = endedAt;
    const attempt = step.attempts?.at(-1);
    if (attempt && !attempt.endedAt) {
      attempt.endedAt = endedAt;
      attempt.result = source === "skip" ? { type: "skipped", summary: `Step ${step.index} was skipped.` } : attempt.result;
    }
    record.currentAssignmentId = null;
    record.revision = Math.max(1, Number(record.revision) || 1) + 1;
  }
  step.endedAt = endedAt;
  record.assignments = record.steps;
  let receipt = null;
  if (source === "agent") {
    receipt = appendWorkerHandoverReceipt(record, step, {
      workerSession,
      idempotencyKey,
      reportType: report.type,
      queueRevisionBefore,
      queueResult: "accepted",
      noticeText: workerHandoverNotice(record, step, workerSession, report, text, kind),
    }).receipt;
  }
  await writePipeline(PIPELINES_ROOT, record);

  /** Finishes the receipt before a worker sees a successful response. */
  const workerResponse = async (state, next = null) => {
    const settled = await settleWorkerHandoverNotice(record, receipt);
    return settled.status === 200
      ? { status: 200, state, next, pipeline: record, receipt: settled.receipt }
      : settled;
  };

  if (source === "agent" && step.status === "waiting") {
    return workerResponse("reported");
  }
  if (source !== "agent" && (report?.type === "question-needed" || report?.status === "blocked" || report?.verdict === "blocked")) {
    await notifyBrain(record.area, `Goal ${record.slug}: assignment ${step.index} reported a typed block. ${brainMessageExcerpt(report.summary || text)}`);
    return { status: 200, state: "reported", next: null, pipeline: record };
  }
  const next = nextPendingStep(record, step.index);
  const stepWord = source === "skip" ? "skipped" : "complete";
  if (!next) {
    if (typed) {
      if (source === "agent") return workerResponse("reported");
      await notifyBrain(record.area, `Goal ${record.slug}: assignment ${step.index} submitted ${report.type}${report.verdict ? ` (${report.verdict})` : ""}. ${brainMessageExcerpt(report.summary || text)}`);
      return { status: 200, state: "reported", next: null, pipeline: record };
    }
    if (source === "agent") return workerResponse("reported");
    await notifyBrain(record.area, `Goal ${record.slug}: pipeline complete (${record.steps.length} steps; step ${step.index} ${stepWord}, ${step.label || "agent"}). Last handover: ${brainMessageExcerpt(step.handover)}`);
    return { status: 200, state: "complete", next: null, pipeline: record };
  }
  if (record.schema === "area-goal-queue.v2" && ["agent", "skip"].includes(source)) {
    if (source === "agent") return workerResponse("reported", { index: next.index, session: null });
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

const goalQueueMutations = new Map();

/** Serializes one Goal queue mutation across concurrent HTTP requests. */
function withGoalQueueMutation(goalFile, mutation) {
  const key = String(goalFile ?? "");
  const earlier = goalQueueMutations.get(key) ?? Promise.resolve();
  const run = earlier.catch(() => undefined).then(mutation);
  goalQueueMutations.set(key, run);
  run.finally(() => { if (goalQueueMutations.get(key) === run) goalQueueMutations.delete(key); });
  return run;
}

/** Rejects stale queue mutations and makes exact retries harmless. */
function queueMutationGuard(record, options = {}, { allowPaused = false } = {}) {
  if (!allowPaused && (record.migrationProblem || record.status === "paused")) return { status: 409, error: record.migrationProblem ?? "the Goal queue is paused" };
  const key = String(options.idempotencyKey ?? "").trim();
  if (key && record.idempotencyKeys?.includes(key)) return { status: 200, state: "repeated", pipeline: record, repeated: true };
  if (options.expectedRevision !== undefined && Number(options.expectedRevision) !== record.revision) {
    return { status: 409, error: `stale-revision:${record.revision}` };
  }
  if (key) record.idempotencyKeys = [...(record.idempotencyKeys ?? []), key];
  return null;
}

/** Applies one explicit queue control command. */
async function controlPipeline(goalFile, action, index, options = {}) {
  return withGoalQueueMutation(goalFile, () => controlPipelineUnlocked(goalFile, action, index, options));
}

/** Performs one serialized queue control mutation. */
async function controlPipelineUnlocked(goalFile, action, index, options = {}) {
  const trace = action === "advance" ? traceOperation("pipeline advance", { goal: goalFile, step: Number(index) }) : null;
  const o = await goalByFile(goalFile);
  trace?.mark("goal resolved");
  if (!o) return { status: 404, error: `no goal file ${goalFile}` };
  if (["restart", "send"].includes(action) && !options.caller) {
    return { status: 403, error: action === "restart"
      ? "Use guarded Goal recovery after automatic recovery is exhausted."
      : "The retired send-on action cannot advance an authoritative Goal queue." };
  }
  const record = await readPipeline(PIPELINES_ROOT, o.area, o.slug);
  trace?.mark("pipeline read");
  if (!record) return { status: 404, error: "no pipeline on this goal" };
  const guarded = queueMutationGuard(record, options, { allowPaused: action === "end" });
  if (guarded) {
    if (guarded.repeated && action === "advance") {
      await recordCommittedCommand({ operation: "goal-advance", actorSession: options.caller, targetArea: record.area, goal: record.slug, operationId: options.idempotencyKey });
    }
    return guarded;
  }
  const step = record.steps[Number(index) - 1];
  if (!step) return { status: 404, error: `no step ${index}` };
  const allSessions = await listAllSessions({ fresh: true });
  const sessions = allSessions.filter((session) => session.owned);
  trace?.mark("control sessions ready", { sessions: sessions.length });
  const observed = step.session ? allSessions.find((item) => item.name === step.session) : null;
  if (observed && !observed.owned) {
    const ownership = observed.instanceId ? { state: "foreign", instanceId: observed.instanceId } : { state: "legacy" };
    return { status: 409, error: terminationError(step.session, ownership) };
  }
  const live = observed?.owned ? observed : null;
  if (action === "advance") {
    // A caller can lose the HTTP response after the durable transition. The
    // exact retry is an idempotent status read, not a second agent launch.
    if (step.status === "running" && live) {
      trace?.mark("advance already committed", { session: step.session });
      return { status: 200, session: step.session, index: step.index, pipeline: record, repeated: true };
    }
    if (step.status === "stopped" || (step.status === "running" && !live)) {
      step.status = "pending";
      step.session = null;
      record.currentAssignmentId = null;
    }
    if (step.status !== "pending") return { status: 409, error: `step ${step.index} is ${step.status}; advance needs a pending or stopped step` };
    const started = await startPipelineStep(record, step.index, trace);
    if (started.status === 200) {
      await recordCommittedCommand({ operation: "goal-advance", actorSession: options.caller, targetArea: record.area, goal: record.slug, operationId: options.idempotencyKey });
    }
    return started;
  }
  if (action === "restart") {
    return { status: 410, error: "Restart was replaced by queue advance and guarded recovery." };
  }
  if (action === "skip") {
    if (!["stopped", "running", "pending"].includes(step.status)) return { status: 409, error: `step ${step.index} is ${step.status}` };
    if (live) {
      const stopped = await terminateOwnedSession(step.session);
      if (stopped.state !== "terminated") return { status: 409, error: terminationError(step.session, stopped) };
    }
    return completePipelineStep(record, step, `Step ${step.index} was skipped by Julian.`, "skip");
  }
  if (action === "end") {
    // Stop work on the whole run: kill the live step, if any, and end every
    // step that has not run. The Goal stays open with its handovers.
    const attemptSessions = new Set([step.session, ...(step.attempts ?? []).map((attempt) => attempt.session)].filter(Boolean));
    const foreign = [...attemptSessions].map((name) => allSessions.find((session) => session.name === name)).find((session) => session && !session.owned);
    if (foreign) {
      const ownership = foreign.instanceId ? { state: "foreign", instanceId: foreign.instanceId } : { state: "legacy" };
      return { status: 409, error: terminationError(foreign.name, ownership) };
    }
    for (const name of attemptSessions) {
      if (!sessions.some((session) => session.name === name)) continue;
      const stopped = await terminateOwnedSession(name);
      if (stopped.state !== "terminated") return { status: 409, error: terminationError(name, stopped) };
    }
    const ended = endPipeline(record);
    await writePipeline(PIPELINES_ROOT, record);
    await notifyBrain(record.area, `Goal ${record.slug}: pipeline ended by Julian at step ${step.index}.`);
    return { status: 200, state: "ended", ended, pipeline: record };
  }
  if (action === "send") {
    return { status: 410, error: "Send-on was replaced by a typed worker report to the queue controller." };
  }
  return { status: 400, error: `unknown action ${action}` };
}

/**
 * Appends steps to a Goal's pipeline without touching what already ran.
 * New assignments always stay pending. Only the brain adds them, because an
 * appended step starts a worker when the queue reaches it (D8). Queue
 * revision and idempotency guards still serialize concurrent edits.
 */
async function appendPipelineSteps(goalFile, steps, options = {}) {
  return withGoalQueueMutation(goalFile, () => appendPipelineStepsUnlocked(goalFile, steps, options));
}

/** Performs one serialized queue append mutation. */
async function appendPipelineStepsUnlocked(goalFile, steps, options = {}) {
  const byFile = await goalsByFile();
  const o = byFile.get(goalFile);
  if (!o) return { status: 404, error: `no goal file ${goalFile}` };
  const caller = await liveCallingBrain(options.caller);
  if (!caller) return { status: 403, error: brainOnlyStartRefusal(o.area) };
  if (["done", "dropped", "parked"].includes(o.status)) return { status: 409, error: `goal is ${o.status}` };
  const record = await readPipeline(PIPELINES_ROOT, o.area, o.slug);
  if (!record) return { status: 404, error: "no pipeline on this goal" };
  const guarded = queueMutationGuard(record, options);
  if (guarded) {
    if (guarded.repeated) await recordCommittedCommand({ operation: "goal-append", actorSession: options.caller, targetArea: o.area, goal: o.slug, operationId: options.idempotencyKey });
    return guarded;
  }
  // Fill and resolve every new assignment before anything is written: a bad
  // launch names itself and leaves the record as it was.
  const materialized = await materializeStepLaunches(o.area, steps, { firstIndex: record.steps.length + 1, brain: caller });
  if (materialized.error) return materialized;
  const located = resolveStepPaths(materialized.steps, record.steps.length + 1);
  if (located.error) return { status: 400, error: located.error };
  steps = located.steps;
  const folders = await resolveStepFolders(o, steps);
  if (folders.error) return { status: 409, error: folders.error };
  const last = record.steps[record.steps.length - 1];
  let added;
  try {
    added = appendSteps(record, steps);
  } catch (error) {
    return { status: 400, error: error.message };
  }
  const { warnings } = materialized;
  const launches = discloseStepFolders(materialized.rows, folders.folders);
  await writePipeline(PIPELINES_ROOT, record);
  await recordCommittedCommand({ operation: "goal-append", actorSession: options.caller, targetArea: o.area, goal: o.slug, operationId: options.idempotencyKey });
  return { status: 200, state: "queued", after: currentStep(record)?.index ?? last.index, added: added.map((step) => step.index), pipeline: record, warnings, launches };
}

/** Returns one current attempt's immutable live target after all tags match. */
async function inspectCurrentGoalAttemptTarget(goal, record, assignment, attempt) {
  const sessions = await listAllSessions({ fresh: true });
  const live = sessions.find((session) => session.name === attempt.session);
  if (!live) return { error: `source session ${attempt.session} is not live`, code: "source-absent" };
  if (!live.owned) return { error: `source session ${attempt.session} is not owned by this Agent Shell`, code: "source-foreign" };
  const expected = {
    kind: "goal",
    area: record.area,
    goal: record.goal,
    pipeline: record.goal,
    step: assignment.index,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (String(live[key] ?? "") !== String(value)) {
      return { error: `source session ${attempt.session} has ${key} ${live[key] ?? "(empty)"}, expected ${value}`, code: "source-target-mismatch" };
    }
  }
  if (live.assignment && live.assignment !== assignment.id) {
    return { error: `source session ${attempt.session} belongs to assignment ${live.assignment}`, code: "stale-assignment" };
  }
  if (live.attempt && live.attempt !== attempt.id) {
    return { error: `source session ${attempt.session} belongs to attempt ${live.attempt}`, code: "stale-attempt" };
  }
  const inspected = await sessionOwnership.inspect(attempt.session);
  if (inspected.state !== "live" || inspected.instanceId !== INSTANCE_ID) {
    return { error: `source session ${attempt.session} failed its immutable ownership fence`, code: "source-target-mismatch" };
  }
  // Old queues predate the stable assignment and attempt tmux options. The
  // complete older tag set above proves this exact process before backfill.
  if (!live.assignment) await execFileAsync("tmux", ["set-option", "-t", inspected.target, "@tangent_assignment", assignment.id]);
  if (!live.attempt) await execFileAsync("tmux", ["set-option", "-t", inspected.target, "@tangent_attempt", attempt.id]);
  return {
    target: {
      instanceId: INSTANCE_ID,
      area: record.area,
      goal: record.goal,
      assignmentId: assignment.id,
      attemptId: attempt.id,
      session: attempt.session,
      target: inspected.target,
      generation: null,
    },
  };
}

/** Gives one replacement a fresh tmux name without touching the source. */
function replacementSessionName(record, liveNames) {
  const base = normName(`${record.area.split("/").pop()}--${record.slug}`);
  return uniqueSessionName(base, "-replacement", liveNames, 60);
}

/** Binds the Goal set to the ready replacement after queue promotion. */
async function bindReplacementGoalSet(record, operation) {
  const byFile = await goalsByFile();
  const source = operation.sourceTarget.session;
  const files = [record.goal, ...(record.extraFiles ?? [])]
    .map((file) => byFile.get(file))
    .filter((goal) => goal && !["done", "dropped", "parked"].includes(goal.status))
    .filter((goal) => goal.file === record.goal || !goal.session || goal.session === source);
  for (const goal of files) await writeGoalBinding(goal.file, { status: "active", session: operation.replacementTarget.session });
  if (files.length) {
    await vaultCommit(
      files.map((goal) => goal.file),
      `update: ${record.area} ${files.length === 1 ? `goal ${record.slug}` : `${files.length} goals`} moved to ready replacement`,
      record.area,
      operation.replacementTarget.session,
    );
  }
  return files;
}

/** Proves that the persisted replacement target is still the same live worker. */
async function inspectReplacementTarget(operation) {
  const target = operation.replacementTarget;
  if (!target) return { ok: false, error: "the replacement operation has no immutable target" };
  const inspected = await sessionOwnership.inspect(target.session);
  if (inspected.state !== "live") return { ok: false, error: `replacement session ${target.session} is ${inspected.state}` };
  if (inspected.instanceId !== target.instanceId || inspected.target !== target.target) {
    return { ok: false, error: `replacement session ${target.session} no longer matches operation ${operation.id}` };
  }
  const live = (await listAllSessions({ fresh: true })).find((session) => session.name === target.session);
  if (!live
    || live.kind !== "goal"
    || live.area !== target.area
    || live.goal !== target.goal
    || live.assignment !== target.assignmentId
    || live.attempt !== target.attemptId) {
    return { ok: false, error: `replacement session ${target.session} failed its Goal, assignment, or attempt fence` };
  }
  return { ok: true };
}

/**
 * Retires only the immutable source target. A worker that still owns another
 * Goal is detached and retagged instead, so shared work is never killed.
 */
async function retireReplacementSource(record, operation) {
  const source = operation.sourceTarget;
  const remaining = [...(await goalsByFile()).values()].find((goal) => goal.file !== record.goal
    && goal.session === source.session
    && !["done", "dropped", "parked"].includes(goal.status));
  if (remaining) {
    const inspected = await sessionOwnership.inspect(source.session);
    if (inspected.state !== "live") return inspected.state === "absent"
      ? { ok: true, sourceOutcome: { kind: "detached", detail: "source ended after replacement promotion" } }
      : { ok: false, error: terminationError(source.session, inspected) };
    if (inspected.instanceId !== source.instanceId || inspected.target !== source.target) {
      return { ok: false, error: `source session ${source.session} no longer matches replacement operation ${operation.id}` };
    }
    await execFileAsync("tmux", ["set-option", "-t", source.target, "@tangent_goal", remaining.file]);
    await execFileAsync("tmux", ["set-option", "-t", source.target, "@tangent_pipeline", ""]);
    await execFileAsync("tmux", ["set-option", "-t", source.target, "@tangent_step", ""]);
    await execFileAsync("tmux", ["set-option", "-t", source.target, "@tangent_assignment", ""]);
    await execFileAsync("tmux", ["set-option", "-t", source.target, "@tangent_attempt", ""]);
    messages.queue(source.session, {
      from: "tangent",
      area: record.area,
      text: `Goal ${record.slug} moved to replacement ${operation.replacementTarget.session}. Keep this session alive only for Goal ${remaining.slug}.`,
      banner: true,
      queuedAt: new Date().toISOString(),
    });
    sessionObservation.invalidate();
    return { ok: true, sourceOutcome: { kind: "detached", detail: `source kept for Goal ${remaining.slug}` } };
  }
  const stopped = await sessionOwnership.terminate(source.session, source.target);
  if (["terminated", "absent"].includes(stopped.state)) {
    armedSessions.delete(source.session);
    await clearArmedPrompt(ARMED_ROOT, source.session).catch(() => {});
    sessionObservation.invalidate();
    return { ok: true, sourceOutcome: { kind: "retired", detail: stopped.state === "absent" ? "source was already absent" : "exact source target retired" } };
  }
  return { ok: false, error: terminationError(source.session, stopped) };
}

/** Finishes a ready replacement; every stage is restart-safe and idempotent. */
async function settleReadyGoalReplacementUnlocked(goal, operation, readiness = null) {
  let record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
  if (!record) return { status: 404, error: "no pipeline on this goal", operation };
  try {
    if (operation.status === "replacement-starting") {
      if (!readiness) {
        return { status: 200, state: operation.status, session: operation.replacementTarget?.session ?? null, operation, pipeline: record, requiresConfirmation: true };
      }
      transitionAttemptReplacement(operation, "replacement-ready", { readiness });
      await writeAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, operation);
    }
    if (["replacement-ready", "source-retiring", "retirement-incomplete"].includes(operation.status)) {
      const replacement = await inspectReplacementTarget(operation);
      if (!replacement.ok) {
        const promoted = record.steps.some((assignment) => assignment.attempts?.some((attempt) => attempt.id === operation.replacementAttemptId));
        if (operation.status === "replacement-ready" && !promoted) {
          transitionAttemptReplacement(operation, "rollback", { error: `${replacement.error}; the source stayed current` });
          transitionAttemptReplacement(operation, "failed", { error: `${replacement.error}; the source stayed current` });
        } else if (operation.status === "replacement-ready") {
          transitionAttemptReplacement(operation, "source-retiring");
          transitionAttemptReplacement(operation, "retirement-incomplete", { error: `${replacement.error}; the source was preserved` });
        } else if (operation.status === "source-retiring") {
          transitionAttemptReplacement(operation, "retirement-incomplete", { error: `${replacement.error}; the source was preserved` });
        }
        await writeAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, operation);
        return {
          status: 409,
          state: operation.status,
          code: operation.status === "failed" ? "replacement-not-live" : "retirement-incomplete",
          error: operation.error ?? replacement.error,
          operation,
          pipeline: record,
        };
      }
    }
    if (operation.status === "replacement-ready") {
      const promoted = promoteReadyReplacement(record, operation);
      if (!promoted.repeated) await writePipeline(PIPELINES_ROOT, record);
      await bindReplacementGoalSet(record, operation);
      transitionAttemptReplacement(operation, "source-retiring");
      await writeAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, operation);
    } else if (operation.status === "retirement-incomplete") {
      transitionAttemptReplacement(operation, "source-retiring");
      await writeAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, operation);
    }
    if (operation.status === "source-retiring") {
      const retired = await retireReplacementSource(record, operation);
      if (retired.ok) transitionAttemptReplacement(operation, "complete", { sourceOutcome: retired.sourceOutcome });
      else transitionAttemptReplacement(operation, "retirement-incomplete", { error: retired.error });
      await writeAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, operation);
    }
    await recordCommittedCommand({
      operation: "goal-attempt-replace",
      actorSession: operation.actor?.session,
      targetArea: goal.area,
      goal: goal.slug,
      assignment: operation.assignmentId,
      operationId: operation.id,
      result: operation.status,
    }).catch((error) => console.error("replacement audit:", error.message ?? error));
    record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug) ?? record;
    return {
      status: operation.status === "retirement-incomplete" ? 409 : 200,
      state: operation.status,
      session: operation.replacementTarget?.session ?? null,
      operation,
      pipeline: record,
      repeated: operation.status === "complete",
      ...(operation.status === "retirement-incomplete" ? { error: operation.error, code: "retirement-incomplete" } : {}),
    };
  } catch (error) {
    return {
      status: ["stale-revision", "stale-assignment", "stale-attempt", "target-mismatch"].includes(error.code) ? 409 : 500,
      code: error.code ?? "replacement-failed",
      error: String(error.message ?? error),
      operation,
      pipeline: error.pipeline ?? record,
    };
  }
}

/** Records an asynchronous prompt receipt or startup failure. */
async function recordReplacementReadiness(goalFile, operationId, ready) {
  return withGoalQueueMutation(goalFile, async () => {
    const goal = (await goalsByFile()).get(goalFile);
    const operation = await readAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, goalFile, operationId);
    if (!goal || !operation || operation.status !== "replacement-starting") return;
    if (ready) {
      await settleReadyGoalReplacementUnlocked(goal, operation, {
        kind: "prompt-receipt",
        receiptId: `prompt:${operation.replacementAttemptId}`,
      });
      return;
    }
    const target = operation.replacementTarget;
    if (target) await sessionOwnership.terminate(target.session, target.target).catch(() => {});
    transitionAttemptReplacement(operation, "failed", { error: "the replacement prompt was not delivered; the source stayed live" });
    await writeAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, operation);
  });
}

/** Starts a successor and never retires the source before durable readiness. */
async function replaceGoalAttempt(goalFile, options = {}) {
  return withGoalQueueMutation(goalFile, () => replaceGoalAttemptUnlocked(goalFile, options));
}

/** Performs one serialized exact-attempt replacement request. */
async function replaceGoalAttemptUnlocked(goalFile, options = {}) {
  const goal = (await goalsByFile()).get(goalFile);
  if (!goal) return { status: 404, error: `no goal file ${goalFile}` };
  // Everything starts through the brain (D8): a replacement is a new worker
  // attempt, so only a live brain requests one.
  if (!await liveCallingBrain(options.caller)) return { status: 403, error: brainOnlyStartRefusal(goal.area) };
  if (["done", "dropped", "parked"].includes(goal.status)) return { status: 409, error: `goal is ${goal.status}` };
  const operationId = String(options.operationId ?? "").trim();
  if (!operationId) return { status: 400, code: "operation-required", error: "an operation ID is required" };
  let record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
  if (!record) return { status: 404, error: "no pipeline on this goal" };
  const request = {
    operationId,
    goal: goalFile,
    assignmentId: options.assignmentId,
    expectedAttemptId: options.expectedAttemptId,
    expectedRevision: options.expectedRevision,
    launch: options.launch,
  };
  const existing = await readAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, goalFile, operationId);
  if (existing) {
    let same = false;
    try { same = sameAttemptReplacementRequest(existing, request); }
    catch (error) { return { status: 400, code: error.code, error: error.message, operation: existing, pipeline: record }; }
    if (!same) return { status: 409, code: "operation-conflict", error: `replacement operation ${operationId} names different inputs`, operation: existing, pipeline: record };
    if (existing.status === "complete" || existing.status === "failed") {
      return { status: existing.status === "complete" ? 200 : 409, state: existing.status, session: existing.replacementTarget?.session ?? null, operation: existing, pipeline: record, repeated: true };
    }
    const readiness = options.confirmed && existing.status === "replacement-starting"
      ? { kind: "julian-confirmed", receiptId: `julian:${operationId}` }
      : null;
    return settleReadyGoalReplacementUnlocked(goal, existing, readiness);
  }

  const assignment = record.steps.find((item) => item.id === options.assignmentId);
  const attempt = assignment?.attempts?.at(-1);
  if (!assignment || !attempt) return { status: 409, code: "stale-assignment", error: "the requested assignment has no current attempt", pipeline: record };
  const source = await inspectCurrentGoalAttemptTarget(goal, record, assignment, attempt);
  if (source.error) return { status: 409, code: source.code, error: source.error, pipeline: record };
  const chosen = await launchCatalog.requested({ choice: options.launch });
  if (chosen.error || !chosen.command) return { status: 400, code: "launch-invalid", error: chosen.error ?? "replacement launch needs a harness", pipeline: record };
  const accepted = await launchCatalog.allowed(goal.area, options.launch);
  if (accepted.error) return { status: 403, code: accepted.code, error: accepted.error, ...accepted, pipeline: record };
  let operation;
  try {
    const actor = await commandProvenance(options.caller);
    operation = newAttemptReplacement(record, {
      ...request,
      sourceTarget: source.target,
      actor: { session: actor.session, area: actor.area },
    });
    await writeAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, operation);
  } catch (error) {
    return { status: ["stale-revision", "stale-assignment", "stale-attempt", "target-mismatch"].includes(error.code) ? 409 : 400, code: error.code, error: error.message, pipeline: error.pipeline ?? record };
  }

  const liveNames = new Set((await listAllSessions({ fresh: true })).map((session) => session.name));
  const sessionName = replacementSessionName(record, liveNames);
  const replacementAttemptId = randomUUID();
  let releasePersisted;
  const persisted = new Promise((resolve) => { releasePersisted = resolve; });
  /** Defers the prompt receipt until the starting target is durable. */
  const onPrimed = (ready) => {
    void persisted.then(() => recordReplacementReadiness(goalFile, operationId, ready))
      .catch((error) => console.error("replacement readiness:", error.message ?? error));
  };
  let started;
  try {
    const goalIndex = await goalsByFile();
    const extraSlugs = (record.extraFiles ?? []).map((file) => goalIndex.get(file)?.slug).filter(Boolean);
    started = await spawnGoalSession(goal.area, goal.slug, {
      approved: true,
      launch: true,
      command: accepted.command,
      label: accepted.label,
      ref: launchRef(options.launch),
      path: assignment.path,
      extraSlugs,
      pipeline: { record, index: assignment.index, sessionName },
      attemptId: replacementAttemptId,
      deferBinding: true,
      onPrimed,
    });
    if (started.status !== 200) throw new Error(started.error);
    const replacementTarget = {
      instanceId: INSTANCE_ID,
      area: record.area,
      goal: record.goal,
      assignmentId: assignment.id,
      attemptId: replacementAttemptId,
      session: started.session,
      target: started.target,
      cwd: started.cwd ?? null,
      cwdSource: started.cwdSource ?? null,
      generation: null,
    };
    transitionAttemptReplacement(operation, "replacement-starting", {
      replacementAttemptId,
      replacementTarget,
      resolvedLaunch: { ref: operation.launch, command: chosen.command, label: chosen.label },
    });
    await writeAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, operation);
    releasePersisted();
  } catch (error) {
    releasePersisted();
    const inspected = await sessionOwnership.inspect(sessionName).catch(() => ({ state: "error" }));
    if (inspected.state === "live" && inspected.instanceId === INSTANCE_ID) await sessionOwnership.terminate(sessionName, inspected.target).catch(() => {});
    transitionAttemptReplacement(operation, "failed", { error: `replacement startup failed; source preserved: ${String(error.message ?? error)}` });
    await writeAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, operation);
    return { status: 409, state: operation.status, code: "replacement-start-failed", error: operation.error, operation, pipeline: record };
  }
  await recordCommittedCommand({
    operation: "goal-attempt-replace",
    actorSession: options.caller,
    targetArea: goal.area,
    goal: goal.slug,
    assignment: assignment.id,
    operationId,
    result: "replacement started; source preserved pending readiness",
  }).catch((error) => console.error("replacement audit:", error.message ?? error));
  if (options.confirmed) {
    return settleReadyGoalReplacementUnlocked(goal, operation, { kind: "julian-confirmed", receiptId: `julian:${operationId}` });
  }
  return { status: 200, state: operation.status, session: started.session, operation, pipeline: record, requiresConfirmation: true };
}

/** Resumes only persisted replacement stages that are safe after a restart. */
async function resumeAttemptReplacements() {
  const pending = unsettledAttemptReplacements(await readAllAttemptReplacements(ATTEMPT_REPLACEMENTS_ROOT));
  for (const stored of pending) {
    await withGoalQueueMutation(stored.goal, async () => {
      const operation = await readAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, stored.goal, stored.id);
      if (!operation) return;
      const goal = (await goalsByFile()).get(operation.goal);
      if (!goal) return;
      if (operation.status === "requested") {
        transitionAttemptReplacement(operation, "failed", { error: "the controller restarted before a replacement target was durable; the source stayed live" });
        await writeAttemptReplacement(ATTEMPT_REPLACEMENTS_ROOT, operation);
        return;
      }
      if (["replacement-ready", "source-retiring", "retirement-incomplete"].includes(operation.status)) {
        await settleReadyGoalReplacementUnlocked(goal, operation);
      }
      // replacement-starting deliberately waits for a persisted prompt
      // receipt or Julian's explicit confirmation. Restart never guesses.
    }).catch((error) => console.error("resume replacement:", error.message ?? error));
  }
}

/**
 * Every pipeline record with live facts folded in: whether each step's
 * session exists, its pane state, and the derived pipeline status.
 */
async function pipelinesView(sessions) {
  const brainSessions = brainSessionNames(await readAllBrains(BRAINS_ROOT));
  const byName = new Map(sessions.filter((item) => item.kind !== "brain" && !brainSessions.has(item.name)).map((item) => [item.name, item]));
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
async function reconcilePipelines(sessions, snapshotAt = Date.now()) {
  const brainSessions = brainSessionNames(await readAllBrains(BRAINS_ROOT));
  const allByName = new Map(sessions.map((item) => [item.name, item]));
  const byName = new Map(sessions.filter((item) => item.owned).map((item) => [item.name, item]));
  const now = Date.now();
  let goalIndex = null;
  for (const record of await readAllPipelines(PIPELINES_ROOT)) {
    let changed = queueNormalizationChanged(record) || reclaimLiveSteps(record, byName);
    if (!record.goalRevision) {
      goalIndex ??= await goalsByFile();
      const goal = goalIndex.get(record.goal);
      if (goal) {
        record.goalRevision = await goalContentRevision(goal.file);
        changed = true;
      }
    }
    for (const { receipt } of pendingWorkerHandoverReceipts(record)) {
      if (receipt.destinationArea !== record.area || record.controllerArea !== record.area) {
        console.error("worker handover reconcile:", JSON.stringify({ goal: record.goal, receipt: receipt.id, error: "exact-Area destination mismatch" }));
        continue;
      }
      try {
        const routed = await routeBrainNotice(receipt.destinationArea, receipt.notice.text, { idempotencyKey: receipt.notice.sourceId });
        recordWorkerHandoverNotice(receipt, routed.notice);
        changed = true;
      } catch (error) {
        console.error("worker handover reconcile:", JSON.stringify({ goal: record.goal, receipt: receipt.id, error: String(error?.message ?? error) }));
      }
    }
    const stopped = [];
    for (const step of record.steps) {
      const key = `${record.goal}#${step.index}#${step.session}`;
      if (!["running", "waiting"].includes(step.status) || !step.session) {
        idleNoticed.delete(key);
        waitNoticed.delete(key);
        shellExitNoticed.delete(key);
        continue;
      }
      if (brainSessions.has(step.session)) {
        step.status = "stopped";
        step.endedAt = new Date().toISOString();
        const attempt = step.attempts?.findLast?.((item) => item.session === step.session);
        if (attempt && !attempt.endedAt) {
          attempt.endedAt = step.endedAt;
          attempt.result = { type: "invalid-brain-binding", summary: "An Area brain session cannot run a Goal assignment." };
        }
        changed = true;
        idleNoticed.delete(key);
        waitNoticed.delete(key);
        shellExitNoticed.delete(key);
        stopped.push(step.index);
        continue;
      }
      const observed = allByName.get(step.session);
      if (observed && !observed.owned) {
        shellExitNoticed.delete(key);
        continue;
      }
      const live = byName.get(step.session);
      if (!live) {
        shellExitNoticed.delete(key);
        const attempt = step.attempts?.findLast?.((item) => item.session === step.session);
        const ownedAttempt = attempt?.instanceId === INSTANCE_ID || await sessionOwnership.ownsRecorded(step.session);
        if (!ownedAttempt) continue;
        // The step may have started after this sessions snapshot was taken:
        // its tmux session exists but this list predates it. Absence is
        // judged against the snapshot's capture time, so a stale list can
        // never outvote an attempt that started after it was captured.
        if (!stepGoneFromSnapshot(step, byName, snapshotAt)) continue;
        step.status = "stopped";
        step.endedAt = new Date().toISOString();
        if (attempt && !attempt.endedAt) {
          attempt.endedAt = step.endedAt;
          attempt.result = { type: "runtime-stopped", summary: "The worker session ended without a handover." };
        }
        changed = true;
        idleNoticed.delete(key);
        waitNoticed.delete(key);
        stopped.push(step.index);
        continue;
      }
      // The last context fill seen while live stays on the attempt, so a
      // dead attempt still says how full its conversation was (D22).
      const liveAttempt = step.attempts?.findLast?.((item) => item.session === step.session);
      if (liveAttempt && live.context && contextFillChanged(liveAttempt.contextFill, live.context)) {
        liveAttempt.contextFill = { usedTokens: live.context.usedTokens, windowTokens: live.context.windowTokens, at: new Date().toISOString() };
        changed = true;
      }
      const shellExit = workerShellExitNotice(record, step, live);
      if (shellExit && shellExitNoticed.get(key) !== shellExit.sourceId) {
        try {
          await routeBrainNotice(record.area, shellExit.text, { idempotencyKey: shellExit.sourceId });
          shellExitNoticed.set(key, shellExit.sourceId);
        } catch (error) {
          console.error("worker shell recovery notice:", JSON.stringify({ goal: record.goal, step: step.index, error: String(error?.message ?? error) }));
        }
      } else if (!shellExit) shellExitNoticed.delete(key);
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
    if (!changed) continue;
    // A restart, handover, or continuation may have rewritten this record
    // while this pass held its copy; writing the copy back would resurrect
    // the replaced attempt and stop it on the next pass. Drop the changes
    // instead: the next pass re-judges the fresh record. Stop notices only
    // follow a write that landed, so a dropped stop is never announced.
    const fresh = await readPipeline(PIPELINES_ROOT, record.area, record.slug);
    if (!fresh || fresh.updatedAt !== record.updatedAt) continue;
    await writePipeline(PIPELINES_ROOT, record);
    for (const index of stopped) {
      await notifyBrain(record.area, `Goal ${record.slug}: step ${index} of ${record.steps.length} stopped without a handover. Retry or skip it through the exact queue, or end the work. Julian's recovery start is available only after your recovery is exhausted.`);
    }
  }
}
const idleNoticed = new Set();
const waitNoticed = new Map();
const shellExitNoticed = new Map();

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

/** The exact active Area brain whose session is live, or null. */
async function liveBrainForArea(area) {
  return exactLiveBrainForArea(area);
}

/** The active exact-Area brain whose recorded session is currently live. */
async function exactLiveBrainForArea(area) {
  const records = await readAllBrains(BRAINS_ROOT);
  const record = records.find((item) => item.area === String(area ?? "") && item.status === "active" && item.session);
  if (!record) return null;
  const live = await sessionOwnership.inspect(record.session);
  return live.state === "live" && live.instanceId === INSTANCE_ID ? record : null;
}

/** Running brain records whose current sessions exist in this snapshot. */
async function liveBrainRecords(sessions = null) {
  const live = new Set((sessions ?? await listSessions()).map((session) => session.name));
  return (await readAllBrains(BRAINS_ROOT))
    .filter((record) => record.status === "active" && record.session && live.has(record.session));
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
async function recordBrainNotice(area, text, sourceId = null) {
  return withInbox(area, (record) => appendNotice(record, text, new Date().toISOString(), sourceId));
}

/** Every notice no generation of one brain has read, oldest first. */
async function unreadBrainNotices(area, records = null) {
  const owners = records ?? await liveBrainRecords();
  return mergeNotices(inboxesForBrain(await readAllInboxes(BRAINS_ROOT), area, (eventArea) => brainOwnsArea(owners, area, eventArea)));
}

/** Marks notices read by one brain session and generation. */
async function markBrainNoticesDelivered(notices, session, generation) {
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

/** The key of one notice in the in-flight set: the same shape `pendingNotices` uses. */
function noticeKey(notice) {
  return `${notice.area} ${notice.id}`;
}

/**
 * Every unread notice that is on its way to a brain right now (D24): queued
 * durably in message-queue.json for a live session, or typed inside the
 * first message of a generation whose prompt is still armed. The sweep
 * queues only notices outside this set, so a retry never doubles a delivery
 * in progress. Nothing here lives in memory alone: a queue entry survives a
 * restart, and an armed first message is re-armed from disk or forgotten
 * with its dead session, so a notice can never be stuck as in flight.
 */
function noticesInFlight(records) {
  const keys = new Set(messages.pendingNotices());
  for (const record of records) {
    for (const entry of record.generations ?? []) {
      if (entry.deliveryStatus !== "pending" || !promptPending(entry.session)) continue;
      for (const notice of entry.notices ?? []) keys.add(noticeKey(notice));
    }
  }
  return keys;
}

/**
 * Queues one brain notice text for a live brain session, durable until it
 * was shown. The inbox holds the words and marks them read on arrival.
 */
async function queueBrainNotice(session, { from = "tangent", area = null, text, notices, generation = null }) {
  return messages.queueDurable(session, { from, area, text: clipQueuedNotice(text), notices, generation, queuedAt: new Date().toISOString() });
}

/** The queue store keeps one message under 4000 characters; a longer notice is cut, the inbox keeps every word. */
function clipQueuedNotice(text) {
  const body = String(text ?? "");
  return body.length > 3900 ? `${body.slice(0, 3880)} [clipped; the inbox holds the full text]` : body;
}

/**
 * Tells the exact Area brain what happened, as a message from
 * `tangent`. The text is clipped, never refused, so a long Request answer or
 * handover cannot be dropped before it is written down. The notice is
 * persisted first, then queued when a brain session is live. The queue
 * delivers it into any empty composer, including that of a brain still in a
 * long turn, which reads it at its next turn boundary. With no live brain the
 * notice waits on disk for the next generation. Returns true when a live
 * brain was addressed.
 */
async function routeBrainNotice(area, text, { idempotencyKey = null, sender = null } = {}) {
  const senderName = String(sender?.session ?? "").trim();
  const senderArea = String(sender?.area ?? "").trim() || null;
  const body = noticeMessage(text);
  const message = senderName ? noticeMessage(messageBanner(senderName, senderArea, body)) : body;
  const records = await readAllBrains(BRAINS_ROOT);
  const owner = brainRecordForArea(records, area);
  const notice = await recordBrainNotice(area, message, idempotencyKey);
  if (notice.duplicate && (notice.deliveredAt || noticesInFlight(records).has(noticeKey({ area, id: notice.id })))) {
    return { addressed: Boolean(owner), notice, session: notice.deliveredTo ?? owner?.session ?? null, generation: notice.deliveredGeneration ?? owner?.generation ?? null };
  }
  if (!owner) {
    await messages.log({ event: "kept", to: `${area} brain`, from: senderName || "tangent", area: senderArea, text: body, reason: "Area brain has not started yet" });
    return { addressed: false, notice, session: null, generation: null };
  }
  const record = await liveBrainForArea(area);
  if (!record) {
    await messages.log({ event: "kept", to: `${owner.area} brain`, from: senderName || "tangent", area: senderArea, text: body, reason: "no live brain; waits for the next generation" });
    return { addressed: false, notice, session: null, generation: null };
  }
  const notices = [{ area, id: notice.id }];
  await queueBrainNotice(record.session, {
    from: senderName || "tangent",
    area: senderName ? senderArea : null,
    text: senderName ? body : message,
    notices,
    generation: record.generation ?? null,
  });
  await messages.log({ event: "sent", to: record.session, from: senderName || "tangent", area: senderArea, text: body, disposition: "queued", reason: "brain event" });
  return { addressed: true, notice, session: record.session, generation: record.generation ?? null };
}

/**
 * The routes a worker session cannot call (D6). A worker has one command,
 * `tangent send brain`; every other Tangent mutation belongs to the brain.
 */
const WORKER_REFUSED_ROUTES = new Set([
  "/api/goals/create", "/api/goals/new", "/api/goals/own", "/api/goals/release", "/api/goals/edit", "/api/goals/start",
  "/api/goals/depend", "/api/goals/undepend", "/api/goals/accept", "/api/goals/understanding", "/api/goals/cleanup",
  "/api/pipelines/append", "/api/pipelines/control", "/api/goals/attempts/replace", "/api/goals/attempts/resume",
  "/api/areas/new", "/api/areas/status", "/api/areas/move", "/api/areas/journal", "/api/idea/new", "/api/document/resolve", "/api/document",
  "/api/brains/start", "/api/brains/stop", "/api/brains/reply", "/api/brains/verdict", "/api/brains/verdict/undo",
  "/api/brains/requests", "/api/brains/requests/withdraw", "/api/brains/requests/answer", "/api/brains/requests/dismiss",
  "/api/operations/new", "/api/operations/control", "/api/programs/new", "/api/programs/control", "/api/processes/create", "/api/processes/remove", "/api/processes/control", "/api/processes/check",
  "/api/harnesses", "/api/launch/default", "/api/spawn", "/api/agent",
]);

const WORKER_MUTATION_REFUSAL = 'workers only send. Use: tangent send brain "<note>"';
/** The 403 text when a worker sends to anything but its brain (D5). */
const WORKER_SEND_TARGET_REFUSAL = 'workers only send to their brain. Use: tangent send brain "<note>"';

/**
 * The 403 text for a mutating route called from a worker session, or null
 * when the caller is not a worker or the route is a read or a send. The CLI
 * names its tmux session in the x-tangent-session header.
 */
async function refuseWorkerMutation(req, url) {
  if (req.method !== "POST" || !WORKER_REFUSED_ROUTES.has(url.pathname)) return null;
  const session = String(req.headers["x-tangent-session"] ?? "").trim();
  if (!session) return null;
  const actor = await commandProvenance(session);
  return actor.role === "worker" ? WORKER_MUTATION_REFUSAL : null;
}

/** Resolves one command's audit identity without using it as permission. */
async function commandProvenance(session) {
  const [sessions, brains] = await Promise.all([listDeliverySessions().catch(() => []), readAllBrains(BRAINS_ROOT)]);
  return commandActor(session, { sessions, brains });
}

/** Finds the Goal that owns one current or historical worker session. */
async function workerGoalForSession(session) {
  const pipeline = (await readAllPipelines(PIPELINES_ROOT)).find((record) => record.steps.some((step) => step.session === session || step.attempts?.some((attempt) => attempt.session === session)));
  return pipeline ? (await goalsByFile()).get(pipeline.goal) ?? null : null;
}

/**
 * Records a committed command and tells the logical target Area brain. The
 * state mutation is already authoritative. This durable notice is its audit
 * event, even when the Area has no active brain generation.
 */
async function recordCommittedCommand({ operation, actorSession = "", targetArea, goal = "", assignment = "", operationId = "", result = "committed" }) {
  operationId = String(operationId || randomUUID()).slice(0, 128);
  const actor = await commandProvenance(actorSession);
  const subject = goal ? `Goal ${goal}` : `Area ${targetArea}`;
  const origin = actor.session ? `${actor.session}${actor.area ? ` (${actor.area})` : ""}` : "local Agent Shell caller";
  await messages.log({
    event: "work mutation",
    operation,
    actorSession: actor.session,
    actorArea: actor.area,
    actorRole: actor.role,
    targetArea,
    goal: goal || null,
    assignment: assignment || null,
    operationId,
    result,
  });
  return routeBrainNotice(
    targetArea,
    `${subject}${assignment ? ` assignment ${assignment}` : ""}: command ${operation} ${result} by ${origin}.`,
    { idempotencyKey: `command:${operation}:${operationId}` },
  );
}

/** Keeps best-effort behavior for non-workflow notices. */
async function notifyBrain(area, text, options = {}) {
  try {
    return (await routeBrainNotice(area, text, options)).addressed;
  } catch (err) {
    console.error("brain notify:", err.message ?? err);
    return false;
  }
}

/** The durable brain notice created by Describe work. */
function describedWorkNotice(area, description, sources) {
  const documents = sources.length
    ? sources.map((source) => `- ${source.file}`).join("\n")
    : "- None selected.";
  return `Julian described work on Area ${area}.\n\nDescription:\n${description}\n\nSelected Documents:\n${documents}`;
}

/**
 * Records described work for the controlling brain, then opens its live
 * generation or starts its next generation. The inbox write is the commit
 * point: a later start error leaves the description unread on disk.
 */
async function describeWorkToBrain(owner, area, description, sources, launchOverride = null) {
  owner = await exactLiveBrainForArea(area) ?? brainRecordForArea(await readAllBrains(BRAINS_ROOT), area) ?? owner;
  const live = owner.status === "active" && owner.session
    ? await sessionOwnership.inspect(owner.session).then((session) => session.state === "live" && session.instanceId === INSTANCE_ID)
    : false;
  if (live) {
    if (launchOverride) {
      return { status: 400, error: "Brain launch overrides are retired. Change the Area Brain configuration, then refresh." };
    }
    const message = describedWorkNotice(area, description, sources);
    const notice = await recordBrainNotice(area, message);
    const notices = [{ area, id: notice.id }];
    await queueBrainNotice(owner.session, { text: message, notices, generation: owner.generation ?? null });
    await messages.log({ event: "sent", to: owner.session, from: "tangent", text: message, disposition: "queued", reason: "described work" });
    return { status: 200, session: owner.session, generation: owner.generation, brainArea: owner.area, route: "brain-opened", launchLabel: currentGeneration(owner)?.resolvedLaunch?.label || "" };
  }
  const message = describedWorkNotice(area, description, sources);
  const route = owner.status === "active" ? "brain-started" : "brain-resumed";
  if (launchOverride) return { status: 400, error: "Brain launch overrides are retired. Change the Area Brain configuration, then refresh." };
  // Julian's message is typed verbatim as the woken attempt's first message.
  // A start that fails leaves it in the inbox, so it waits for the next one.
  const started = await startBrain(owner.area, { resume: true, instruction: message });
  if (started.status !== 200) {
    await recordBrainNotice(area, message);
    return { status: started.status, error: `Your description was saved for the ${owner.area} brain, but the brain did not start: ${started.error}` };
  }
  return { ...started, brainArea: owner.area, route, launchLabel: started.brain?.resolvedLaunch?.label || "" };
}

/**
 * Commits one Journal capture and reports whether its words are durable. A
 * vault with no Git history has nothing to commit, the same rule `runVaultGit`
 * already follows, so an isolated vault never blocks capture. A vault that has
 * history must hold the words before a milestone or a brain reads them, which
 * is what ADR-0033 means by the Journal commit occurring first.
 */
async function commitJournalCapture(changed, message, area, session) {
  const outcome = await vaultCommit(changed, message, area, session);
  if (outcome.committed || !existsSync(path.join(TREES_ROOT, ".git"))) return { committed: true, error: null };
  return outcome;
}

/** True when both durable downstream records exist for one Journal entry. */
async function journalProcessingComplete(area, entry) {
  const sourceId = `journal:${entry.id}`;
  const [milestones, inbox] = await Promise.all([
    readMilestones(BRAINS_ROOT, area),
    readInbox(BRAINS_ROOT, area),
  ]);
  return milestones.items.some((item) => item.id === sourceId)
    && inbox.notices.some((notice) => notice.sourceId === sourceId);
}

/**
 * Finds only the Journal paths that still belong to this capture's refused
 * commit. A marker in HEAD proves that the entry is durable. It does not
 * prove that the entry gained its milestone and brain notice. In that case,
 * a rollover archive linked by the entry's Journal can still be pending, but
 * an unrelated active-Journal edit must stay out of the recovery commit.
 */
async function pendingJournalChangedPaths(area, entry) {
  const files = await journalFiles(TREES_ROOT, area);
  const changed = files.map((file) => path.relative(TREES_ROOT, file));
  if (!changed.length || !existsSync(path.join(TREES_ROOT, ".git"))) return { paths: [], persisted: true };
  const marker = `<!-- tangent-journal:${entry.id} -->`;
  let persisted = false;
  for (const relative of changed) {
    const committed = await captureVaultGit(["show", `HEAD:${relative}`]).catch(() => "");
    if (committed.includes(marker)) {
      persisted = true;
      break;
    }
  }
  if (!persisted) {
    const status = await captureVaultGit(["status", "--porcelain", "--", ...changed]);
    return { paths: status.trim() ? changed : [], persisted: false };
  }

  const containingFile = entry.existingFile || entry.file;
  const current = await readFile(containingFile, "utf8").catch(() => "");
  const linkedArchives = [...current.matchAll(/\((journal-[^)\/]+\.md)\)/g)].map((match) => match[1]);
  const available = new Map(files.map((file) => [path.basename(file), file]));
  const pending = [];
  for (const name of new Set(linkedArchives)) {
    const file = available.get(name);
    if (!file) continue;
    const relative = path.relative(TREES_ROOT, file);
    const committed = await captureVaultGit(["show", `HEAD:${relative}`]).then(() => true).catch(() => false);
    if (!committed) pending.push(relative);
  }
  return { paths: pending, persisted: true };
}

/** The vault paths one saved Journal entry changed, its active file first. */
function journalChangedPaths(entry) {
  const files = [entry.file, ...(entry.archive ? [entry.archive] : [])];
  return files.map((file) => path.relative(TREES_ROOT, file));
}

/**
 * Delivers one saved Journal notice to the exact Area brain, and wakes that
 * brain when its record exists but nothing is live. Capture promises Julian
 * that his words reach the brain, not only the file, so an inactive
 * destination is activated instead of left with an unread notice. The notice
 * is written down before the wake, so a start error costs the delivery and
 * never the words. An Area with no brain record keeps the notice for the
 * brain it gets later. Returns what happened, so the surface can say it.
 */
async function deliverJournalToBrain(area, message, idempotencyKey) {
  if (await notifyBrain(area, message, { idempotencyKey })) return { route: "brain-opened" };
  const record = brainRecordForArea(await readAllBrains(BRAINS_ROOT), area);
  if (!record) return { route: "no-brain" };
  // The notice already carries Julian's words, so this wake is a message wake
  // even though the start call has no instruction text of its own.
  const started = await startBrain(area, { resume: true, messageRecorded: true });
  if (started.status !== 200) return { route: "not-started", brainError: started.error };
  return { route: record.status === "active" ? "brain-started" : "brain-resumed", session: started.session };
}

/**
 * Queues every unread notice that is not already on its way, for the brains
 * that run right now. The server calls this when it starts and on every
 * reconcile pass, so a notice whose queue entry was dropped with an old
 * generation's session still reaches the live generation. The durable queue
 * and the inbox say what is on its way; nothing is kept in memory alone.
 */
async function flushBrainNotices(sessions = null, reason = "unread notices after a server start") {
  const records = await liveBrainRecords(sessions);
  const inFlight = noticesInFlight(records);
  for (const record of records) {
    const unread = (await unreadBrainNotices(record.area, records)).filter((notice) => !inFlight.has(noticeKey(notice)));
    if (!unread.length) continue;
    const text = unread.length === 1 ? unread[0].text : noticeDigest(unread);
    const notices = unread.map((notice) => ({ area: notice.area, id: notice.id }));
    await queueBrainNotice(record.session, { text, notices, generation: record.generation ?? null });
    await messages.log({ event: "sent", to: record.session, from: "tangent", text, disposition: "queued", reason });
  }
}

/** True only for the exact generation currently representing the logical brain. */
function isCurrentBrainGeneration(record, session, generation) {
  const current = currentGeneration(record);
  return record.status === "active"
    && record.currentAttemptId === session
    && current?.session === session
    && current?.generation === generation;
}

/**
 * Settles one generation's first message against the current record. A dead
 * earlier attempt can report failure after a replacement has started, so it
 * updates only its own entry and never overwrites current health.
 */
async function settleBrainActivation(record, session, generation, arrived, notices = []) {
  const entry = (record.generations ?? []).find((item) => item.session === session && item.generation === generation);
  if (!entry) return;
  entry.deliveryStatus = arrived ? "ready" : "failed";
  if (isCurrentBrainGeneration(record, session, generation)) {
    record.health = arrived
      ? { status: "healthy", problem: null, updatedAt: new Date().toISOString() }
      : { status: "recovering", problem: "The first message did not arrive.", updatedAt: new Date().toISOString() };
  }
  await writeBrain(BRAINS_ROOT, record);
  // The notices typed inside the first message are read once it arrived. A
  // failed first message leaves them unread, so the sweep queues them again.
  if (arrived && notices.length) await markBrainNoticesDelivered(notices, session, generation);
}

/**
 * The first message of a brain woken without words of Julian's own: the
 * unread notices that wait for it, as one text, so the woken attempt reads
 * why it is awake instead of guessing. Empty when nothing waits.
 */
async function unreadNoticesAsFirstMessage(area, record) {
  const others = (await liveBrainRecords()).filter((item) => item.area !== area);
  // The record may still be inactive at this point; its inbox is the one
  // the new attempt reads either way. A notice queued for the attempt that
  // died is not on its way anywhere, so it is typed too.
  const unread = await unreadBrainNotices(area, [...others, { ...record, status: "active" }]);
  if (!unread.length) return { text: "", notices: [] };
  return { text: unread.length === 1 ? unread[0].text : noticeDigest(unread), notices: unread };
}

/**
 * The first message a new brain attempt gets: Julian's own words, verbatim.
 * When there are none, `Start.` The harness reads the Area note chain from
 * the brain's folder as its instructions (ADR-0041), so Tangent generates
 * no prompt of its own.
 */
function brainFirstMessage(text) {
  return String(text ?? "").trim() || "Start.";
}

/**
 * Creates and primes one brain attempt: a tmux session in the Area's vault
 * folder, the harness command, and Julian's message typed as the first
 * message once the harness is ready. Unread inbox notices reach the live
 * session through the message queue on the next sweep.
 */
async function spawnBrainSession(record, resolvedLaunch, { firstMessage = "", notices = [] } = {}) {
  const sessions = await listAllSessions();
  const names = new Set(sessions.map((item) => item.name));
  const generation = (record.generations?.length ?? 0) + 1;
  const name = uniqueSessionName(brainSessionName(record.area, generation), "", names, 60);
  // A brain always sits in its Area folder in the vault, whatever the Area
  // binds: its work is the Area's notes, Goals, and Documents, and the
  // folder's AGENTS.md chain is its standing instruction.
  const directory = areaDirectory(TREES_ROOT, record.area);
  const message = brainFirstMessage(firstMessage);
  const held = notices.map((notice) => ({ area: notice.area, id: notice.id }));
  let target = "";
  let armed = false;
  try {
    target = await createOwnedTmuxSession(name, ["-d", "-s", name, "-c", directory]);
    await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_area", record.area]);
    await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_kind", "brain"]);
    await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_phase", "orchestrate"]);
    await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_brain", record.area]);
    await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_cwd", directory]);
    await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_generation", String(generation)]);
    if (resolvedLaunch.label) await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_launch", resolvedLaunch.label]);
    if (launchRef(resolvedLaunch.ref)) await execFileAsync("tmux", ["set-option", "-t", name, "@tangent_launch_ref", launchRef(resolvedLaunch.ref)]);
    record.instanceId = INSTANCE_ID;
    const registry = await launchCatalog.registry();
    if (registry.error) throw new Error(registry.error);
    const harness = registry.harnesses.find((item) => item.id === resolvedLaunch.ref.harness);
    if (!harness) throw new Error(`harness ${resolvedLaunch.ref.harness} is no longer registered`);
    const conversation = newConversation(harness);
    const entry = beginGeneration(record, name, resolvedLaunch);
    entry.instanceId = INSTANCE_ID;
    entry.target = target;
    entry.deliveryStatus = "pending";
    entry.firstMessage = message;
    entry.cwd = directory;
    entry.providerSession = conversation ? structuredClone(conversation) : null;
    entry.notices = notices.map((notice) => ({ area: notice.area, id: notice.id, text: notice.text, createdAt: notice.createdAt }));
    record.health = { status: "starting", problem: null, updatedAt: new Date().toISOString() };
    /** Settles an asynchronous arm callback under the same Area lifecycle lock. */
    const firstMessageTyped = (arrived) => withBrainMutation(record.area, async () => {
      const current = await readBrain(BRAINS_ROOT, record.area);
      if (!current) return;
      await settleBrainActivation(current, name, generation, arrived, held);
    });
    if (process.env.AGENT_SHELL_TEST_NO_LAUNCH === "1") {
      await writeBrain(BRAINS_ROOT, record);
      await settleBrainActivation(record, name, generation, true, held);
      await launchCatalog.saveMemory(record.area, "brain", resolvedLaunch.ref);
      return { status: 200, session: name, generation, brain: { ...record, resolvedLaunch }, firstMessage: message, cwd: directory };
    }
    await sleep(700);
    const pane = await execFileAsync("tmux", ["display-message", "-p", "-t", "=" + name + ":", "#{pane_current_command}"]);
    if (!SHELL_CMDS.has(pane.stdout.trim())) throw new Error("the new brain session did not reach its shell");
    // Persist the arm before making this generation current, and make it
    // current before launching the harness, so a restart before the harness
    // is ready still types the message.
    await armSession(name, { submit: true, prompt: message, onTyped: firstMessageTyped });
    armed = true;
    await writeBrain(BRAINS_ROOT, record);
    await typeInto(name, launchWithConversation(harness, withDefaultModel(resolvedLaunch.command), conversation), false);
    await execFileAsync("tmux", ["send-keys", "-t", "=" + name + ":", "Enter"]);
    await sleep(250);
    await launchCatalog.saveMemory(record.area, "brain", resolvedLaunch.ref);
    return { status: 200, session: name, generation, brain: { ...record, resolvedLaunch }, firstMessage: message, cwd: directory };
  } catch (error) {
    const problem = `could not activate the brain session: ${error.stderr ?? error.message ?? error}`;
    if (armed) {
      armedSessions.delete(name);
      await clearArmedPrompt(ARMED_ROOT, name).catch(() => {});
    }
    if (target) await sessionOwnership.terminate(name, target).catch(() => {});
    record.health = { status: "failed", problem, updatedAt: new Date().toISOString() };
    await writeBrain(BRAINS_ROOT, record);
    return { status: 500, error: problem };
  }
}

/**
 * Starts a brain from its founding instruction, or reattaches to its current
 * attempt. One logical brain exists per exact Area.
 */
const brainMutations = new Map();

/**
 * Serializes every lifecycle mutation for one exact Area. Start, recovery,
 * and stop must all observe the record written by the operation before them.
 */
function withBrainMutation(area, mutation) {
  const exactArea = cleanAreaPath(area);
  const earlier = brainMutations.get(exactArea) ?? Promise.resolve();
  const run = earlier.catch(() => undefined).then(mutation);
  brainMutations.set(exactArea, run);
  return run.finally(() => {
    if (brainMutations.get(exactArea) === run) brainMutations.delete(exactArea);
  });
}

/** Serializes an exact-Area start with every other lifecycle transition. */
function startBrain(area, options = {}) {
  let exactArea;
  try {
    exactArea = cleanAreaPath(area);
  } catch (error) {
    return { status: 400, code: "invalid-area", error: String(error.message ?? error) };
  }
  return withBrainMutation(exactArea, () => startBrainUnlocked(exactArea, options));
}

/** Performs one exact-Area start, resume, or reattachment. */
async function startBrainUnlocked(area, { instruction = "", expectedLaunch = "", choice = null, resume = false, automaticRecovery = false, messageRecorded = false } = {}) {
  if (!area || (!isRootArea(area) && !existsSync(areaDirectory(TREES_ROOT, area)))) return { status: 404, error: `no Area ${area || "(none)"}` };
  const hidden = isRootArea(area) ? null : await hiddenAreaStatus(area);
  if (hidden) return { status: 409, code: "area-hidden", error: `Area ${area} is ${hidden}. Reopen it first: tangent area reopen ${area}` };
  const existing = await readBrain(BRAINS_ROOT, area);
  if (existing?.status === "inactive" && unsettledBrainStop(existing)) {
    return { status: 409, code: "stop-unsettled", error: `the ${area} brain is still settling stop ${existing.stopOperation.id}; retry stop before you resume it` };
  }
  if (existing?.session && existing.status === "active") {
    let live = await sessionOwnership.inspect(existing.session);
    if (live.state === "error") return { status: 503, error: terminationError(existing.session, live) };
    if (live.state === "live" && !live.instanceId && resume && !automaticRecovery) {
      const claimed = await sessionOwnership.claimLegacyBrain({
        session: existing.session,
        area: existing.area,
        generation: existing.generation,
      });
      if (claimed.state === "claimed" || claimed.state === "owned") {
        console.error(`[runtime] ${JSON.stringify({ operation: "claim-legacy-brain", session: existing.session, area: existing.area, generation: existing.generation, instanceId: INSTANCE_ID })}`);
        live = await sessionOwnership.inspect(existing.session);
        sessionObservation.invalidate();
      } else if (claimed.state === "foreign") {
        live = { state: "live", instanceId: claimed.instanceId, target: claimed.target };
      }
    }
    if (live.state === "live" && live.instanceId !== INSTANCE_ID) {
      const ownership = live.instanceId ? { state: "foreign", instanceId: live.instanceId } : { state: "legacy" };
      return { status: 409, error: terminationError(existing.session, ownership) };
    }
    if (live.state === "live") return {
      status: 200,
      session: existing.session,
      generation: existing.generation,
      brain: { ...existing, resolvedLaunch: currentGeneration(existing)?.resolvedLaunch ?? null },
      reattached: true,
    };
  }
  // Root has no Area note in which to declare a default. After its first
  // explicit launch, reuse that exact registry ref for resume and recovery.
  // Other Areas continue to follow their current note policy.
  const rootPreviousChoice = isRootArea(area) && existing
    ? currentGeneration(existing)?.resolvedLaunch?.ref ?? null
    : null;
  const attemptChoice = automaticRecovery ? rootPreviousChoice : (choice ?? rootPreviousChoice);
  const resolvedLaunch = await resolveBrainAttemptLaunch({ area, choice: attemptChoice, expectedLaunch, launchCatalog });
  if (resolvedLaunch.error) return { status: resolvedLaunch.status ?? 409, error: resolvedLaunch.error, ...(resolvedLaunch.code ? { code: resolvedLaunch.code } : {}), ...(resolvedLaunch.launch ? { launch: resolvedLaunch.launch } : {}), ...(resolvedLaunch.area ? { area: resolvedLaunch.area } : {}), ...(resolvedLaunch.allowed ? { allowed: resolvedLaunch.allowed } : {}) };
  if (resume) {
    if (!existing) return { status: 404, error: "no brain to resume on this Area" };
    // A wake needs no message. The brain reads its Area note, its checkpoint,
    // and any unread notices; Julian messages it when he has something to
    // say (2026-08-28, superseding the wake-needs-message rule).
    if (!automaticRecovery) existing.recovery = { attempts: 0, exhausted: false, lastAttemptAt: null };
    // The wake message is typed verbatim as the woken attempt's first
    // message, with the notices that waited for it below. A wake with no
    // words of Julian's own (a saved capture, or automatic recovery) types
    // the unread notices alone, or `Start.`.
    await writeBrain(BRAINS_ROOT, existing);
    const waiting = await unreadNoticesAsFirstMessage(area, existing);
    return spawnBrainSession(existing, resolvedLaunch, { firstMessage: [instruction.trim(), waiting.text].filter(Boolean).join("\n\n"), notices: waiting.notices });
  }
  if (existing) return { status: 409, error: `the ${area} brain already exists; resume it so its founding instruction stays immutable` };
  const invalid = validateInstruction(instruction);
  if (invalid) return { status: 400, error: invalid };
  const leaf = isRootArea(area) ? "root" : area.split("/").pop();
  let record;
  try {
    record = newBrain({
      area,
      instruction,
      planFile: `${areaFilePrefix(area)}plan-${leaf}.md`,
    });
  } catch (error) {
    return { status: 400, error: String(error.message ?? error) };
  }
  const replacedGeneration = existing?.generation ?? null;
  // Notes that arrived before the brain existed wait in its inbox; the
  // founding message carries them below Julian's own words.
  const waiting = await unreadNoticesAsFirstMessage(area, record);
  const started = await spawnBrainSession(record, resolvedLaunch, { firstMessage: [instruction.trim(), waiting.text].filter(Boolean).join("\n\n"), notices: waiting.notices });
  if (started.status === 200 && replacedGeneration !== null) {
    await transitionBrainRequests(area, replacedGeneration, "brain-replaced");
  }
  return started;
}

/** Returns the calling brain and repairs a false stopped state after a session restart race. */
async function liveBrainForSession(sessionName) {
  const record = (await readAllBrains(BRAINS_ROOT)).find((item) => (
    item.status === "active"
    && item.session === sessionName
    && item.currentAttemptId === sessionName
  ));
  if (!record) return null;
  const live = await sessionOwnership.inspect(sessionName);
  if (live.state !== "live" || live.instanceId !== INSTANCE_ID) return null;
  return record;
}

/** The session a mutation names as its caller, whatever the route calls that field. */
function actingSession(body) {
  for (const key of ["session", "caller", "from"]) {
    const value = body?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Returns the current live brain caller only to resolve its launch default. */
async function liveCallingBrain(session) {
  const name = String(session ?? "").trim();
  return name ? liveBrainForSession(name) : null;
}

/**
 * The 403 text when anyone but the Area brain tries to start a worker (D8).
 * Julian and other sessions ask the brain; the brain runs the start.
 */
function brainOnlyStartRefusal(area) {
  return `only the brain starts workers. Message it in Work (a on the Area) or run: tangent send ${area} "<what you want>"`;
}

/** True while a logical stop still needs to settle its exact tmux attempt. */
function unsettledBrainStop(record) {
  return ["pending", "incomplete"].includes(record.stopOperation?.status);
}

/** Persists one retriable stop failure without pretending the process ended. */
async function failBrainStop(record, { status = 503, code = "stop-incomplete", error }) {
  record.stopOperation = { ...record.stopOperation, status: "incomplete", error, updatedAt: new Date().toISOString() };
  record.health = { status: "failed", problem: error, updatedAt: new Date().toISOString() };
  await writeBrain(BRAINS_ROOT, record);
  return { status, code, error, brain: record };
}

/** Maps a fenced tmux refusal to the stable brain-stop response. */
function brainStopRefusal(attemptId, result) {
  if (result.state === "foreign") return { status: 409, code: "foreign-process", error: terminationError(attemptId, result) };
  if (result.state === "legacy") return { status: 409, code: "legacy-process", error: terminationError(attemptId, result) };
  if (result.state === "replaced") return { status: 409, code: "attempt-replaced", error: terminationError(attemptId, result) };
  if (result.state === "unowned") return { status: 409, code: "unowned-absent-attempt", error: `the absent brain attempt ${attemptId} has no durable ownership record for this Agent Shell` };
  return { status: 503, code: "stop-incomplete", error: terminationError(attemptId, result) };
}

/**
 * Completes or retries one persisted stop. This is shared by the request path
 * and reconciliation so a crash after the pending write cannot strand a live
 * tmux process behind an inactive logical brain.
 */
async function settleBrainStop(record) {
  const operation = record.stopOperation;
  const attemptId = operation?.attemptId ?? "";
  if (!operation || !unsettledBrainStop(record)) return { status: 200, state: "already-inactive", brain: record };
  if (operation.instanceId !== INSTANCE_ID) {
    return { status: 409, code: "foreign-stop-operation", error: `brain stop ${operation.id} belongs to Agent Shell instance ${operation.instanceId ?? "unknown"}`, brain: record };
  }
  try {
    await transitionBrainRequests(record.area, record.generation, "brain-ended");
  } catch (error) {
    return failBrainStop(record, { error: `could not close the brain's Requests: ${error.message ?? error}` });
  }

  const ownership = await sessionOwnership.inspect(attemptId);
  if (ownership.state === "error") return failBrainStop(record, brainStopRefusal(attemptId, ownership));
  if (ownership.state === "absent") {
    if (!(await sessionOwnership.ownsRecorded(attemptId))) {
      return failBrainStop(record, brainStopRefusal(attemptId, { state: "unowned" }));
    }
  } else if (ownership.instanceId !== INSTANCE_ID) {
    const refusal = ownership.instanceId
      ? { state: "foreign", instanceId: ownership.instanceId }
      : { state: "legacy" };
    return failBrainStop(record, brainStopRefusal(attemptId, refusal));
  } else if (!operation.target) {
    // This stop began while the attempt was absent and its legacy sidecar had
    // no immutable ID. A later same-name live session is necessarily new; it
    // must never be killed merely because the human-readable name matches.
    return failBrainStop(record, brainStopRefusal(attemptId, {
      state: "replaced", instanceId: ownership.instanceId, target: ownership.target, expectedTarget: null,
    }));
  } else if (ownership.target !== operation.target) {
    return failBrainStop(record, brainStopRefusal(attemptId, {
      state: "replaced", instanceId: ownership.instanceId, target: ownership.target, expectedTarget: operation.target,
    }));
  }

  const stopped = ownership.state === "absent"
    ? ownership
    : await sessionOwnership.terminate(attemptId, operation.target);
  if (stopped.state !== "terminated" && stopped.state !== "absent") {
    return failBrainStop(record, brainStopRefusal(attemptId, stopped));
  }
  if (stopped.state === "terminated") sessionObservation.invalidate();
  record.stopOperation = { ...operation, status: "complete", completedAt: new Date().toISOString(), error: null };
  record.health = { status: "inactive", problem: null, updatedAt: new Date().toISOString() };
  await writeBrain(BRAINS_ROOT, record);
  return { status: 200, state: "stopped", brain: record };
}

/** Makes one logical brain inactive, then terminates only its exact owned attempt. */
async function stopBrain(area, { expectedAttemptId = "", operationId = "" } = {}) {
  if (!area) return { status: 400, code: "area-required", error: "an Area is required" };
  if (!expectedAttemptId) return { status: 400, code: "attempt-required", error: "an expected brain attempt is required" };
  if (!operationId) return { status: 400, code: "operation-required", error: "an operation ID is required" };
  let exactArea;
  try {
    exactArea = cleanAreaPath(area);
  } catch (error) {
    return { status: 400, code: "invalid-area", error: String(error.message ?? error) };
  }
  return withBrainMutation(exactArea, () => stopBrainUnlocked(exactArea, { expectedAttemptId, operationId }));
}

/** Performs one fenced stop after the exact Area lifecycle lock is held. */
async function stopBrainUnlocked(area, { expectedAttemptId, operationId }) {
  const record = await readBrain(BRAINS_ROOT, area);
  if (!record) return { status: 404, code: "brain-not-found", error: `no brain on ${area}` };
  if (record.stopOperation?.id === operationId && record.stopOperation.status === "complete") {
    return { status: 200, state: "stopped", brain: record };
  }
  const acceptedAttempts = new Set([record.currentAttemptId].filter(Boolean));
  const attemptId = unsettledBrainStop(record)
    ? record.stopOperation.attemptId
    : record.currentAttemptId ?? record.session ?? "";
  if (expectedAttemptId && expectedAttemptId !== attemptId && !acceptedAttempts.has(expectedAttemptId)) {
    return { status: 409, code: "attempt-changed", error: `the active brain attempt changed to ${attemptId}` };
  }
  if (record.status === "inactive" && unsettledBrainStop(record)) return settleBrainStop(record);
  if (record.status === "inactive") return { status: 200, state: "already-inactive", brain: record };
  const ownership = await sessionOwnership.inspect(attemptId);
  if (ownership.state === "error") {
    return { status: 503, code: "stop-incomplete", error: terminationError(attemptId, ownership) };
  }
  if (ownership.state === "live" && ownership.instanceId !== INSTANCE_ID) {
    const result = ownership.instanceId ? { state: "foreign", instanceId: ownership.instanceId } : { state: "legacy" };
    const code = result.state === "foreign" ? "foreign-process" : result.state === "legacy" ? "legacy-process" : "stop-incomplete";
    const status = ["foreign-process", "legacy-process"].includes(code) ? 409 : 503;
    return { status, code, error: terminationError(attemptId, result) };
  }
  let durableTarget = ownership.target ?? null;
  if (ownership.state === "absent") {
    if (!(await sessionOwnership.ownsRecorded(attemptId))) {
      return brainStopRefusal(attemptId, { state: "unowned" });
    }
    durableTarget = await sessionOwnership.recordedTarget(attemptId);
  }
  endBrain(record, "inactive");
  record.stopOperation = { id: operationId, attemptId, target: durableTarget, instanceId: INSTANCE_ID, status: "pending", requestedAt: new Date().toISOString() };
  record.health = { status: "stopping", problem: null, updatedAt: new Date().toISOString() };
  await writeBrain(BRAINS_ROOT, record);
  return settleBrainStop(record);
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

/** Reconciles one brain while its exact-Area lifecycle lock is held. */
async function reconcileBrain(area, { allByName, live, index }) {
  const record = await readBrain(BRAINS_ROOT, area);
  if (!record) return;
  const entry = currentGeneration(record);
  let observed = record.session ? allByName.get(record.session) : null;
  if (record.status === "inactive" && unsettledBrainStop(record)) {
    const settled = await settleBrainStop(record);
    if (settled.status !== 200) console.error("brain stop reconciliation:", settled.error);
    return;
  }
  // The sessions snapshot predates this Area lock. A start can finish while
  // reconciliation waits, so prove any new current attempt live before
  // treating its absence from that old snapshot as a crash.
  const refreshed = await refreshBrainObservation({
    session: record.session,
    observed,
    instanceId: INSTANCE_ID,
    /** Reuses the current live observation before reconciliation acquires the lifecycle lock. */
    inspect: (session) => sessionOwnership.inspect(session),
  });
  if (!refreshed.canJudgeAbsence) return;
  observed = refreshed.observed;
  if (refreshed.live && record.session) live.add(record.session);
  if (observed && !observed.owned) return;
  const durableOwner = record.instanceId === INSTANCE_ID
    || entry?.instanceId === INSTANCE_ID
    || Boolean(record.session && await sessionOwnership.ownsRecorded(record.session));
  if (!observed && !durableOwner) return;
  if (record.status === "active") {
    await reportUnshownForJulian(record, index).catch(reportUnshownFailure);
  }
  if (record.status !== "active") return;
  const deliveryFailed = entry?.deliveryStatus === "failed";
  if (record.session && live.has(record.session) && deliveryFailed) {
    const stopped = await terminateOwnedSession(record.session);
    if (stopped.state !== "terminated") {
      console.error("brain recovery ownership:", terminationError(record.session, stopped));
      return;
    }
    live.delete(record.session);
  }
  if (!record.session || !live.has(record.session)) {
    const attempts = Math.max(0, Number(record.recovery?.attempts) || 0);
    const exhausted = record.recovery?.exhausted === true || attempts >= BRAIN_RECOVERY_LIMIT;
    record.recovery = { attempts, exhausted, lastAttemptAt: record.recovery?.lastAttemptAt ?? null };
    record.health = exhausted
      ? { status: "failed", problem: `Automatic brain recovery failed ${attempts} times.`, updatedAt: new Date().toISOString() }
      : { status: "recovering", problem: "The active brain has no usable process.", detectedAt: record.health?.detectedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeBrain(BRAINS_ROOT, record);
    if (exhausted) {
      await recordBrainNotice(record.area, `Automatic brain recovery is exhausted after ${attempts} attempts. Julian can use the guarded Goal recovery action for an existing pending queue.`, `brain-recovery-exhausted:${record.area}:${attempts}`);
      return;
    }
    const nextAttempts = attempts + 1;
    record.recovery = { attempts: nextAttempts, exhausted: false, lastAttemptAt: new Date().toISOString() };
    await writeBrain(BRAINS_ROOT, record);
    // This pass already owns the Area lifecycle lock. Calling startBrain here
    // would wait on itself, so recovery uses the unlocked implementation.
    const recovered = await startBrainUnlocked(record.area, { resume: true, automaticRecovery: true });
    if (recovered.status !== 200) {
      console.error("brain recovery start:", JSON.stringify({ area: record.area, instanceId: INSTANCE_ID, status: recovered.status, error: recovered.error }));
      const current = await readBrain(BRAINS_ROOT, record.area);
      if (current) {
        current.recovery = { attempts: nextAttempts, exhausted: nextAttempts >= BRAIN_RECOVERY_LIMIT, lastAttemptAt: record.recovery.lastAttemptAt };
        current.health = current.recovery.exhausted
          ? { status: "failed", problem: `Automatic brain recovery failed ${nextAttempts} times: ${recovered.error}`, updatedAt: new Date().toISOString() }
          : { status: "recovering", problem: `Automatic brain recovery attempt ${nextAttempts} failed: ${recovered.error}`, updatedAt: new Date().toISOString() };
        await writeBrain(BRAINS_ROOT, current);
      }
    }
    return;
  }
  if (record.health?.status !== "healthy") {
    record.health = { status: "healthy", problem: null, updatedAt: new Date().toISOString() };
    await writeBrain(BRAINS_ROOT, record);
  }
}

/** Queues unread notices and records runtime recovery health. */
async function reconcileBrains(sessions) {
  const allByName = new Map(sessions.map((item) => [item.name, item]));
  const ownedSessions = sessions.filter((item) => item.owned);
  const live = new Set(ownedSessions.map((item) => item.name));
  await flushBrainNotices(ownedSessions, "unread notices found by a sweep").catch(reportNoticeSweepFailure);
  const index = await vaultIndex();
  for (const record of await readAllBrains(BRAINS_ROOT)) {
    await withBrainMutation(record.area, () => reconcileBrain(record.area, { allByName, live, index }));
  }
}

/**
 * Reminds a worker whose carried context has passed the handover threshold
 * to hand its step or Goal to a fresh copy of itself (D1 C, D3). Scope:
 * pipeline steps and solo Goal sessions (kind "goal", phase "execute");
 * brains, work-definition, and study sessions never see this.
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
      const record = await migrateLiveSoloExecution(o, sessions);
      const step = record?.steps.find((item) => item.status === "running" && item.session === session.name);
      if (!record || !step) continue;
      execution = pipelineExecution({
        record,
        step,
        /** Persists the migrated authoritative queue. */
        save: (next) => writePipeline(PIPELINES_ROOT, next),
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
    const handoverText = level === "first"
      ? `Your context is nearly full. At the next natural pause, send the brain what is done and what is next with: tangent send brain "<facts>". Do not replace yourself. The brain starts a fresh attempt when it needs one.`
      : `Your context is well past the threshold. Send now with: tangent send brain "<facts>". Do not replace yourself. The brain starts a fresh attempt when it needs one.`;
    messages.queue(session.name, {
      from: "tangent",
      area,
      kind: "context-reminder",
      text: handoverText,
      // Rebuilt at delivery time so the fill number is current, not the one
      // read at queue time (design touchpoint 1).
      /** Rebuilds the reminder with the latest pane context at delivery time. */
      render: () => {
        const fill = paneObserver.context(session.name);
        if (!fill) return null;
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
 * The brain record of exactly this Area, active or inactive. Compatibility
 * rows stay readable while their related work remains open.
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
async function brainsView(sessions, { includeForJulian = true } = {}) {
  const byName = new Map(sessions.map((item) => [item.name, item]));
  const index = includeForJulian ? await vaultIndex() : null;
  const records = await readAllBrains(BRAINS_ROOT);
  return Promise.all(records.map(async (record) => {
    const live = record.session ? byName.get(record.session) : null;
    return {
      ...record,
      resolvedLaunch: currentGeneration(record)?.resolvedLaunch ?? null,
      live: Boolean(live),
      state: live?.state ?? null,
      stateDetail: live?.stateDetail ?? null,
      stateQuestion: live?.stateQuestion ?? "",
      idleSince: live?.idleSince ?? null,
      waitingSince: live?.waitingSince ?? null,
      latestHandover: latestHandover(record),
      forJulian: includeForJulian ? await forJulianItems(record, index) : [],
      requests: openBrainRequests(await readBrainRequests(BRAINS_ROOT, record.area)),
    };
  }));
}

/** Stops one accepted assignment without claiming that its goal is done. */
async function acceptGoalAssignment(file) {
  const o = (await goalsByFile()).get(file);
  if (!o) return { status: 404, error: `no goal file ${file}` };
  if (o.session) {
    const stopped = await terminateOwnedSession(o.session);
    if (!["terminated", "absent"].includes(stopped.state)) return { status: 409, error: terminationError(o.session, stopped) };
  }
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
  for (const chunk of typeChunks(text)) {
    await execFileAsync("tmux", ["send-keys", "-t", "=" + session + ":", "-l", "--", chunk]);
  }
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
          const stopped = await terminateOwnedSession(target);
          if (stopped.state !== "terminated") {
            summary.push(`refusing to kill ${target}: ${terminationError(target, stopped)}`);
            break;
          }
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
          const stopped = await terminateOwnedSession(CHAT_SESSION);
          if (!["terminated", "absent"].includes(stopped.state)) throw new Error(terminationError(CHAT_SESSION, stopped));
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

/** Executes the small allowlist of effects that one Request revision can authorize. */
async function executeAuthorizedRequestEffect(effect, brain) {
  const type = String(effect?.type ?? "");
  if (type === "goal-done") {
    const file = String(effect.goal ?? "");
    const byFile = await goalsByFile();
    if (!byFile.has(file)) throw new Error("the authorized Goal no longer exists");
    const goal = byFile.get(file);
    const changed = await cascadeGoalDone(file, byFile);
    await vaultCommit(changed, `update: ${goal.area} goal ${goal.slug} done in tree`, goal.area, brain.session);
    await recordCommittedCommand({ operation: "goal-done", actorSession: brain.session, targetArea: goal.area, goal: goal.slug, result: "authorized request applied" });
    return;
  }
  if (type === "route-journal") {
    const area = String(effect.area ?? "");
    const text = String(effect.text ?? "").trim();
    const areas = flattenAreaPaths(await readTree(TREES_ROOT));
    if ((!areas.includes(area) && !isRootArea(area)) || !text) throw new Error("the authorized Journal route is invalid");
    const sourceEntryId = String(effect.sourceEntryId ?? "").trim();
    if (sourceEntryId) {
      const sourceEntry = await readJournalEntry(TREES_ROOT, brain.area, sourceEntryId);
      if (!sourceEntry) throw new Error(`source Journal entry ${sourceEntryId} does not exist in ${brain.area}`);
      if (!sourceEntry.text.includes(text)) throw new Error("the authorized Journal route is not an exact excerpt of its source entry");
    }
    const id = String(effect.idempotencyKey ?? `request-route:${brain.area}:${createHash("sha256").update(text).digest("hex")}`);
    const sourceArea = isRootArea(brain.area) ? "Root" : brain.area;
    const source = sourceEntryId ? `Routed from ${sourceArea} Journal entry ${sourceEntryId}` : `routed from ${sourceArea}`;
    const entry = await appendJournalEntry({ treesRoot: TREES_ROOT, area, text, idempotencyKey: id, source });
    if (!entry.duplicate) {
      const changed = journalChangedPaths(entry);
      const [relative] = changed;
      await runVaultGit(["add", "--", ...changed]);
      const saved = await commitJournalCapture(changed, `note: ${area} routed Journal capture`, area, brain.session);
      if (!saved.committed) throw new Error(`the routed Journal text was saved to ${relative} but not committed: ${saved.error}`);
      await appendMilestone({ root: BRAINS_ROOT, area, kind: "routed-journal", summary: text, ref: relative, idempotencyKey: `journal:${entry.id}`, now: entry.createdAt });
      await notifyBrain(area, `The ${brain.area} brain routed exact Journal text to this Area. Read ${relative}. This message grants no authority.`);
    }
    return { type, area, journal: path.relative(TREES_ROOT, entry.file), duplicate: entry.duplicate };
  }
  throw new Error(`unsupported Request effect type: ${type || "missing"}`);
}

const brainRoutes = createBrainRoutes({
  start: startBrain,
  stop: stopBrain,
  normalizeMessage,
  verdict: clearRowWithVerdict,
  undoVerdict: restoreVerdictLine,
  reply: noteReplySubject,
  /** Creates a request only for the calling live brain session. */
  async createRequest(session, input) {
    const brain = await liveBrainForSession(session);
    if (!brain) return { status: 403, error: "only a live brain can create a request" };
    // Julian flags what he checks (D12, D15): a brain never asks him to test.
    if (String(input?.kind ?? "").trim() === "test") return { status: 400, error: "Julian flags what he checks. Mark the Goal done with tangent goal done; a Goal he flagged waits for him as Check it." };
    const record = await readBrainRequests(BRAINS_ROOT, brain.area);
    try {
      const precedingContext = await paneLastMessage(session);
      const request = createBrainRequest(record, {
        ...input,
        brainGeneration: brain.generation,
        conversationAnchor: { area: brain.area, session, generation: brain.generation },
        precedingContext,
      });
      await writeBrainRequests(BRAINS_ROOT, record);
      return { status: 200, request };
    } catch (error) { return { status: 400, error: String(error.message ?? error) }; }
  },
  /** Records Julian's request answer and delivers it to the brain inbox. */
  async answerRequest(area, id, answer, note, effectRevision = null) {
    const brain = await brainOfArea(area);
    if (!brain) return { status: 404, error: `no brain on ${area}` };
    const record = await readBrainRequests(BRAINS_ROOT, brain.area);
    try {
      const pending = record.requests.find((item) => item.id === id);
      if (answer === "authorize") {
        const idempotencyKey = `request-effect:${id}:${effectRevision}`;
        const begun = beginRequestEffect(record, id, effectRevision, idempotencyKey);
        await writeBrainRequests(BRAINS_ROOT, record);
        if (!begun.duplicate) {
          try {
            const result = await executeAuthorizedRequestEffect(pending.effect, brain);
            finishRequestEffect(record, id, { result: result ?? { ok: true } });
            await writeBrainRequests(BRAINS_ROOT, record);
          } catch (error) {
            finishRequestEffect(record, id, { problem: String(error.message ?? error) });
            await writeBrainRequests(BRAINS_ROOT, record);
            await notifyBrain(brain.area, `Request "${pending.subject}" exact effect failed and remains actionable: ${String(error.message ?? error)}`);
            return { status: 409, error: String(error.message ?? error), request: pending };
          }
        }
      }
      const request = answerBrainRequest(record, id, answer, note, undefined, effectRevision);
      await writeBrainRequests(BRAINS_ROOT, record);
      await notifyBrain(brain.area, brainRequestAnswerNotice(request));
      return { status: 200, request };
    } catch (error) { return { status: 400, error: String(error.message ?? error) }; }
  },
  /** Lets only the creating live brain withdraw its obsolete Request. */
  async withdrawRequest(session, id, note) {
    const brain = await liveBrainForSession(session);
    if (!brain) return { status: 403, error: "only a live brain can withdraw a request" };
    const record = await readBrainRequests(BRAINS_ROOT, brain.area);
    try {
      const request = withdrawBrainRequest(record, id, note);
      await writeBrainRequests(BRAINS_ROOT, record);
      return { status: 200, request };
    } catch (error) { return { status: 400, error: String(error.message ?? error) }; }
  },
  /** Makes Julian's dismissal durable and tells the brain to stop waiting. */
  async dismissRequest(area, id) {
    const brain = await brainOfArea(area);
    if (!brain) return { status: 404, error: `no brain on ${area}` };
    const record = await readBrainRequests(BRAINS_ROOT, area);
    try {
      const request = dismissBrainRequest(record, id);
      await writeBrainRequests(BRAINS_ROOT, record);
      await notifyBrain(area, `Julian dismissed "${request.subject}". The Request is closed; do not wait for an answer.`);
      return { status: 200, request };
    } catch (error) { return { status: 400, error: String(error.message ?? error) }; }
  },
  /** Finds one enriched brain record by Area or session. */
  async show(area, session) {
    // The durable brain is still readable when passive tmux observation is
    // temporarily unhealthy. In particular, do not let the inner await
    // reject before the old `brainsView(...).catch(...)` could run: opening a
    // brain would then return 500 even though its record and prompt were
    // intact. Live state is optional enrichment on this read path.
    const sessions = await listSessions().catch((error) => {
      console.error("brain show observation:", error.message ?? error);
      return [];
    });
    const brains = await brainsView(sessions);
    return brains.find((item) => (area && item.area === area) || (session && item.session === session)) ?? null;
  },
  /** Returns the plan lines that the parser could not classify. */
  async unparsed(brain) {
    return unparsedForJulianLines(await brainPlanText(brain)).map((item) => item.line);
  },
  /** The first message the current attempt was typed: there is no generated prompt (ADR-0041). */
  prompt: (brain) => currentGeneration(brain)?.firstMessage ?? brainFirstMessage(brain.foundingInstruction?.text),
});
const pipelineRoutes = createPipelineRoutes({
  normalizeMessage,
  handoverStep: handoverPipelineStep,
  /** Whether a send flag word is one a worker has. */
  isWorkerSendKind: (kind) => WORKER_SEND_KINDS.has(kind),
  control: controlPipeline,
  append: appendPipelineSteps,
  replaceAttempt: replaceGoalAttempt,
  resumeAttempt: resumeGoalAttempt,
});

/** Rebuilds an opening prompt without hiding otherwise usable durable context. */
async function rebuiltAgentPrompt(build) {
  try {
    return { prompt: await build(), promptError: null };
  } catch (error) {
    return { prompt: null, promptError: String(error?.message ?? error) };
  }
}

/**
 * Resolves the exact extra Goal records carried by one recovered context.
 * Queue order wins because it is the durable launch contract; any additional
 * same-session Goal bindings follow in the order projected by the vault.
 */
function recoveredExtraGoals(projected, goalIndex) {
  const files = [
    ...(projected.queue?.extraFiles ?? []),
    ...(projected.extraGoals ?? []).map((goal) => goal.file),
  ];
  const seen = new Set([projected.goal?.file]);
  const goals = [];
  const missing = [];
  for (const value of files) {
    const file = String(value ?? "").trim();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const goal = goalIndex.get(file);
    if (goal) goals.push(goal);
    else missing.push(file);
  }
  if (missing.length) throw new Error(`the durable extra Goal source is unavailable: ${missing.join(", ")}`);
  return goals;
}

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
        queued: messages.queuedCount(session.name),
      }));
  },
  /** Resolves durable recovery facts, then distinguishes an unknown session with one read-only live check. */
  async context(session) {
    const brains = await readAllBrains(BRAINS_ROOT);
    let projected = resolveAgentContext({ session, brains });
    if (projected?.role === "brain") {
      if (!projected.current) return { ...projected, prompt: null };
      const inbox = await readInbox(BRAINS_ROOT, projected.area);
      projected = resolveAgentContext({ session, brains, notices: unreadNotices(inbox).map((notice) => ({ ...notice, area: inbox.area })) });
      const brain = brains.find((record) => record.area === projected.area);
      // A brain has no generated prompt: its instructions are the Area note
      // chain in its folder, and its first message was Julian's own words.
      return brain
        ? { ...projected, prompt: currentGeneration(brain)?.firstMessage ?? brainFirstMessage(brain.foundingInstruction?.text), promptError: null }
        : { ...projected, prompt: null, promptError: "the durable brain record is unavailable" };
    }
    const [pipelines, goalIndex] = await Promise.all([readAllPipelines(PIPELINES_ROOT), goalsByFile()]);
    projected = resolveAgentContext({ session, brains, pipelines, goals: [...goalIndex.values()] });
    if (!projected) {
      const live = await sessionOwnership.inspect(session);
      return live.state === "live" ? unassignedAgentContext(session) : null;
    }
    const goal = projected.goal?.file ? goalIndex.get(projected.goal.file) : null;
    if (!goal) return { ...projected, prompt: null, promptError: "the durable Goal source is unavailable" };
    if (projected.source === "goal-queue" && projected.assignment) {
      const record = pipelines.find((item) => item.goal === projected.goal.file);
      return record
        ? { ...projected, ...await rebuiltAgentPrompt(async () => pipelineStepPrompt(record.area, goal, record, projected.assignment.index, recoveredExtraGoals(projected, goalIndex), session, null, await promptWorkFolder(record.area, projected.attempt))) }
        : { ...projected, prompt: null, promptError: "the durable Goal queue is unavailable" };
    }
    return { ...projected, ...await rebuiltAgentPrompt(async () => goalPrompt(goal.area, goal, recoveredExtraGoals(projected, goalIndex), [], null, await promptWorkFolder(goal.area, projected.attempt))) };
  },
  /**
   * A worker's `tangent send brain`: the note lands on the worker's own
   * assignment and in the inbox of the brain that controls it. Only a worker
   * has a brain to resolve; anyone else names a session or an Area.
   */
  async sendToBrain(body) {
    const text = normalizeMessage(body.text);
    const session = String(body.from ?? "").trim();
    const kind = body.kind == null ? null : String(body.kind);
    if (kind !== null && !WORKER_SEND_KINDS.has(kind)) return { status: 400, error: `Unknown send kind "${kind}". Use --done, --blocked, --question, or no flag.` };
    const actor = await commandProvenance(session);
    const queued = session && (await readAllPipelines(PIPELINES_ROOT)).some((record) => record.steps.some((step) => step.session === session || step.attempts?.some((attempt) => attempt.session === session)));
    if (actor.role !== "worker" && !queued) return { status: 400, error: "tangent send brain works inside a worker session. Name a session or an Area path." };
    const goal = await workerGoalForSession(session);
    const requestedPresentations = Array.isArray(body.present) ? body.present.map(String).filter(Boolean) : [];
    const resolvedPresentations = [];
    if (requestedPresentations.length) {
      if (!goal) return { status: 400, error: "the worker has no assigned Goal for this presentation" };
      for (const file of requestedPresentations) {
        const document = await resolvePresentedDocument(goal, file);
        if (document.error) return { status: 400, error: document.error };
        resolvedPresentations.push(document);
      }
    }
    const result = await handoverPipelineStep(session, text, null, String(body.idempotencyKey ?? ""), kind ?? "note");
    if (result.status !== 200) return { status: result.status, error: result.error };
    for (const document of resolvedPresentations) {
      await presentGoalDocument(PRESENTATIONS_ROOT, goal, document, { session: actor.session, role: "worker", assignmentId: actor.assignment?.id ?? null });
    }
    const area = result.receipt?.destinationArea ?? result.pipeline?.area ?? actor.area;
    const brain = area ? await liveBrainForArea(area) : null;
    return { status: 200, value: { status: "sent", to: brain?.session ?? area, kind: kind ?? "note", state: result.state, receipt: result.receipt ?? null, pipeline: result.pipeline } };
  },
  /** Delivers or queues one normalized cross-agent message. */
  async send(body) {
    const text = normalizeMessage(body.text);
    const [sessions, brains, tree] = await Promise.all([listDeliverySessions(), readAllBrains(BRAINS_ROOT), readTree(TREES_ROOT)]);
    const requested = String(body.to ?? "").trim();
    const target = resolveSession(requested, sessions);
    const live = sessions.find((session) => session.name === target);
    const sender = commandActor(body.from, { sessions, brains });
    // Workers have one command (D5): their notes go to their own brain.
    if (sender.role === "worker") return { status: 403, error: WORKER_SEND_TARGET_REFUSAL };
    const entry = { from: sender.session ?? "unknown sender", area: sender.area, text, durable: true, queuedAt: new Date().toISOString() };
    if (!live) {
      const inbox = areaInboxTarget(requested, { areas: [ROOT_AREA, ...flattenAreaPaths(tree)], brains });
      if (inbox) {
        const delivery = await routeBrainNotice(inbox.area, text, { sender: { session: entry.from, area: entry.area } });
        const reason = delivery.addressed
          ? "stored in the Area inbox and queued for its live brain"
          : "stored in the Area inbox; it will arrive when the brain starts";
        return { status: 200, value: { status: "queued", to: inbox.area, target: "area", via: inbox.via, reason, receipt: delivery.notice.id } };
      }
    }
    const result = await messages.dispatch(live ?? null, entry);
    if (result.status !== 200) return { status: result.status, error: result.error };
    return { status: 200, value: { status: result.state, to: result.to, ...(result.reason ? { reason: result.reason, position: result.position } : {}) } };
  },
});
const areaRoutesOperations = {
  /** Returns the complete Area tree. */
  async tree() {
    const physical = await withAreaStatus(await readTree(TREES_ROOT));
    return { root: TREES_ROOT, areas: [rootAreaRow(physical.map((area) => area.path)), ...physical] };
  },
  /** Returns one Area's note sections and own Goals. */
  async show(area) {
    if (isRootArea(area)) return {
      area,
      status: "",
      purpose: "The complete Tangent vault.",
      resources: "",
      resolved: {},
      workFolder: null,
      skills: [],
      projectSkills: [],
      goals: [],
      ideas: [],
      processes: [],
    };
    if (!area || !flattenAreaPaths(await readTree(TREES_ROOT)).includes(area)) return null;
    const text = await areaNote(area);
    const workFolder = await areaWorkFolder(area);
    const resolved = await describeAreaResources(TREES_ROOT, area);
    return {
      area,
      status: parseFrontmatter(text).status ?? "",
      purpose: noteSection(text, "Purpose"),
      resources: noteSection(text, "Resources"),
      // The three resource lines as the Area sees them, each with the Area
      // that declared it, and the folder a worker would actually start in.
      resolved,
      workFolder,
      // Every skill on the route from the vault root to this Area, root
      // first, and the bound repository's own project skills (D20).
      skills: await routeSkills(TREES_ROOT, area),
      projectSkills: await projectSkills(resolved.repository?.value ?? null),
      goals: (await readAreaGoals(area)).map(goalSummary),
      ideas: await areaIdeas(area),
      processes: await processViews({ area, exact: true }),
    };
  },
  /** Returns archived and active Journal text in chronological file order. */
  async journal(area) {
    if (!area || (!isRootArea(area) && !flattenAreaPaths(await readTree(TREES_ROOT)).includes(area))) return null;
    const files = await journalFiles(TREES_ROOT, area);
    return { area, files: await Promise.all(files.map(async (file) => ({ file: path.relative(TREES_ROOT, file), text: await readFile(file, "utf8") }))) };
  },
  /** Returns the durable recent-context projection for an Area and its children. */
  async milestones(area, options) {
    const areas = [ROOT_AREA, ...flattenAreaPaths(await readTree(TREES_ROOT))];
    if (!area || !areas.includes(area)) return null;
    return querySubtreeMilestones({ root: BRAINS_ROOT, area, areas, ...options });
  },
  /** Writes one detached audit archive. Normal product reads never use this file. */
  async legacyAudit(body) {
    const area = String(body.area ?? "");
    const areas = flattenAreaPaths(await readTree(TREES_ROOT));
    if (!areas.includes(area)) throw new Error("The Area does not exist.");
    const brain = await readBrain(BRAINS_ROOT, area);
    const requests = await readBrainRequests(BRAINS_ROOT, area);
    const pipelines = (await readAllPipelines(PIPELINES_ROOT)).filter((record) => record.area === area || record.area.startsWith(`${area}/`));
    const safe = area.replaceAll("/", "--");
    const output = path.join(os.homedir(), ".tangent", "audit", `${safe}-area-brain-legacy.json.gz`);
    return exportLegacyAudit({ output, area, records: { generations: brain?.generations ?? [], requests: requests.requests, pipelines } });
  },
  /** Commits exact capture text and its rollover archive, then wakes the logical Area brain. An uncommitted capture wakes nothing. */
  async capture(body) {
    const area = String(body.area ?? "");
    if (!isRootArea(area) && !flattenAreaPaths(await readTree(TREES_ROOT)).includes(area)) throw new Error("The destination Area does not exist.");
    const entry = await appendJournalEntry({ treesRoot: TREES_ROOT, area, text: body.text, idempotencyKey: body.idempotencyKey || body.id, source: body.source || "capture", now: body.createdAt || new Date().toISOString() });
    if (entry.duplicate && await journalProcessingComplete(area, entry)) return { ...entry, route: "duplicate", files: [] };
    const pending = entry.duplicate ? await pendingJournalChangedPaths(area, entry) : { paths: journalChangedPaths(entry), persisted: false };
    const changed = pending.paths;
    if (entry.duplicate && !pending.persisted && !changed.length) {
      return { ...entry, route: "not-committed", commitError: "The Journal entry is not in Git, and no pending Journal file can be committed.", files: [] };
    }
    const relative = entry.existingFile ? path.relative(TREES_ROOT, entry.existingFile) : changed[0];
    if (changed.length) {
      await runVaultGit(["add", "--", ...changed]);
      const saved = await commitJournalCapture(changed, `note: ${area} Journal capture`, area, null);
      if (!saved.committed) return { ...entry, route: "not-committed", commitError: saved.error, files: changed };
    }
    await appendMilestone({ root: BRAINS_ROOT, area, kind: "journal", summary: entry.text || String(body.text ?? "").trim(), ref: relative, idempotencyKey: `journal:${entry.id}`, now: entry.createdAt || new Date().toISOString() });
    const delivery = await deliverJournalToBrain(area, `Journal entry ${entry.id} was saved. Read ${relative} and respond in this Area conversation.`, `journal:${entry.id}`);
    return { ...entry, ...delivery, files: changed };
  },
  /** Creates and commits one Area. */
  async create(body) {
    const created = await createArea({ treesRoot: TREES_ROOT, parent: body.parent, name: body.name });
    created.changedPaths.push(...await ensureAreaNoteLinks({ treesRoot: TREES_ROOT, area: created.area }));
    await runVaultGit(["add", "-f", "--", ...created.changedPaths]);
    await vaultCommit(created.changedPaths, `add: ${created.area} Area`, created.area, null);
    await recordCommittedCommand({ operation: "area-create", actorSession: body.caller, targetArea: created.area });
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
};

const areaRoutes = createAreaRoutes(areaRoutesOperations);

/** Persists each material Operation edge and delivers it to the exact Area inbox once. */
async function projectMaterialOperationEvents(snapshot) {
  for (const operation of snapshot.operations ?? []) {
    const ledger = await readOperationEvents(BRAINS_ROOT, operation.area);
    const before = JSON.stringify(ledger);
    materialOperationEvents(ledger, operation);
    if (JSON.stringify(ledger) !== before) await writeOperationEvents(BRAINS_ROOT, ledger);
    for (const event of ledger.events.filter((item) => !item.deliveredAt)) {
      await notifyBrain(operation.area, `Operation ${operation.label ?? operation.name}: ${event.summary}`, { idempotencyKey: `operation:${event.id}` });
      await appendMilestone({
        root: BRAINS_ROOT,
        area: operation.area,
        kind: `operation-${event.kind}`,
        summary: event.summary,
        ref: event.evidenceRef,
        idempotencyKey: `operation:${event.id}`,
        now: event.createdAt,
      });
      markOperationEventDelivered(ledger, event.id);
      await writeOperationEvents(BRAINS_ROOT, ledger);
    }
  }
  return snapshot;
}

// ---- processes: repeatable work as notes (ADR-0043) ----

/** The vault-relative process note an instruction file names, or "" when it is not one. */
function processFileOf(instructionFile) {
  const absolute = String(instructionFile ?? "").trim();
  if (!absolute) return "";
  const relative = path.relative(TREES_ROOT, path.resolve(absolute));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return /^process-[a-z0-9][a-z0-9-]*\.md$/.test(path.basename(relative)) ? relative.split(path.sep).join("/") : "";
}

/** The open Goal a process note started, or null. Done, dropped, and parked Goals do not count. */
async function openGoalForProcess(note) {
  const goals = (await readAreaGoals(note.area)).filter((goal) => goalNamesProcess(goal, note));
  return goals.find((goal) => ["open", "active", "verify"].includes(goal.status)) ?? null;
}

/** Runs a `when:` probe in the process's folder and resolves its exit code. */
async function runProcessProbe(note) {
  const folder = note.path?.replace(/^~(?=\/|$)/, os.homedir()) || (await areaWorkFolder(note.area))?.cwd || path.join(TREES_ROOT, note.area);
  return new Promise((resolve) => {
    execFile("zsh", ["-c", note.when], { cwd: existsSync(folder) ? folder : TREES_ROOT, timeout: 60_000 }, (error) => {
      resolve(error ? (typeof error.code === "number" ? error.code : 1) : 0);
    });
  });
}

/** Whether the Area brain runs now, for loop ticks; a lookup error reads as not running. */
async function loopBrainLive(area) {
  return Boolean(await liveBrainForArea(area).catch(() => null));
}

/** Every process note as the Area page, Work, and the CLI show it, with its brain and Goal state. */
async function processViews({ area = "", exact = false } = {}) {
  const notes = exact ? await readAreaProcesses(TREES_ROOT, area) : await discoverProcesses(TREES_ROOT, { area });
  const views = [];
  const liveByArea = new Map();
  for (const note of notes) {
    if (!liveByArea.has(note.area)) liveByArea.set(note.area, Boolean(await liveBrainForArea(note.area).catch(() => null)));
    const state = await readProcessState(PROCESSES_ROOT, note.area, note.slug);
    views.push(processView(note, state, new Date(), { brainLive: liveByArea.get(note.area), openGoal: await openGoalForProcess(note), areaHidden: await hiddenAreaStatus(note.area) }));
  }
  return views;
}

/** Resolves one process by `<area>/<slug>`, `<slug>` with an Area, or a slug that is unique in the vault. */
async function resolveProcessNote(slug, area = "") {
  const notes = await discoverProcesses(TREES_ROOT, { area });
  const matches = notes.filter((note) => note.slug === slug || `${note.area}/${note.slug}` === slug || note.file === slug);
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`no process named ${JSON.stringify(slug)}${area ? ` in ${area}` : ""}`);
  throw new Error(`${slug} names ${matches.length} processes; use <area>/<slug>: ${matches.map((note) => `${note.area}/${note.slug}`).join(", ")}`);
}

const processRoutes = createProcessRoutes({
  /** Lists processes, in one Area and below it when asked. */
  async list(area) {
    return { processes: await processViews({ area }) };
  },
  /** Creates and commits one loop process note. */
  async create(body) {
    const area = cleanAreaPath(String(body.area ?? "").trim());
    if (!area || isRootArea(area) || !existsSync(areaDirectory(TREES_ROOT, area))) throw new Error(`no Area ${area || "(none)"}`);
    if (await hiddenAreaStatus(area)) throw new Error(`Area ${area} is not open`);
    const slug = validateProcessSlug(body.slug);
    const file = `${area}/process-${slug}.md`;
    if (processFileExists(TREES_ROOT, file)) throw new Error(`${file} already exists`);
    const text = formatLoopNote({ every: body.every, message: body.message });
    const note = parseProcessNote(text, { file, area });
    if (note.error || !note.loop) throw new Error(note.error || "the new process is not a loop");
    await removeProcessState(PROCESSES_ROOT, area, slug);
    await vaultRepository.writeMarkdown(file, text);
    await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", file]).catch(() => {});
    const committed = await vaultCommit([file], `add: ${area} loop ${slug}`, area, String(body.caller ?? "").trim() || null);
    if (!committed.committed) throw new Error(`the loop was saved but not committed: ${committed.error}`);
    const process = (await processViews({ area, exact: true })).find((item) => item.slug === slug);
    return { ok: true, file, process };
  },
  /** Removes and commits one resolved loop process note. */
  async remove(body) {
    const note = await resolveProcessNote(String(body.slug ?? "").trim(), String(body.area ?? "").trim());
    if (!note.loop) throw new Error(`${note.file} is not a loop`);
    if (!processFileExists(TREES_ROOT, note.file)) throw new Error(`${note.file} no longer exists.`);
    await unlink(path.join(TREES_ROOT, note.file));
    await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", note.file]).catch(() => {});
    const committed = await vaultCommit([note.file], `remove: ${note.area} loop ${note.slug}`, note.area, String(body.caller ?? "").trim() || null);
    if (!committed.committed) throw new Error(`the loop was removed but not committed: ${committed.error}`);
    await removeProcessState(PROCESSES_ROOT, note.area, note.slug);
    return { ok: true, file: note.file, area: note.area, slug: note.slug };
  },
  /** Pauses or resumes one process by rewriting its status line and committing through the vault. */
  async control(body) {
    const action = String(body.action ?? "");
    if (!["pause", "resume"].includes(action)) throw new Error("Choose pause or resume.");
    const note = await resolveProcessNote(String(body.slug ?? "").trim(), String(body.area ?? "").trim());
    if (!processFileExists(TREES_ROOT, note.file)) throw new Error(`${note.file} no longer exists.`);
    const status = action === "pause" ? "paused" : "active";
    const text = await readFile(path.join(TREES_ROOT, note.file), "utf8");
    await vaultRepository.writeMarkdown(note.file, withProcessStatus(text, status));
    await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", note.file]).catch(() => {});
    await vaultCommit([note.file], `update: ${note.area} process ${note.slug} ${status}`, note.area, String(body.caller ?? "").trim() || null);
    const view = (await processViews({ area: note.area, exact: true })).find((item) => item.slug === note.slug);
    return { ok: true, file: note.file, status, process: view };
  },
  /** Evaluates one process now and says why it is or is not due. Writes nothing. */
  async check(body) {
    const note = await resolveProcessNote(String(body.slug ?? "").trim(), String(body.area ?? "").trim());
    const state = await readProcessState(PROCESSES_ROOT, note.area, note.slug);
    const openGoal = await openGoalForProcess(note);
    const brainLive = await loopBrainLive(note.area);
    const outcome = await evaluateProcess({ note, state, runProbe: runProcessProbe, openGoal, brainLive });
    const view = processView(note, state, new Date(), { brainLive, openGoal });
    return { due: outcome.due, reason: outcome.reason, process: view };
  },
});

const programRoutes = createProgramRoutes({
  /** Returns local programs with live status, and every process note with its run state. */
  async list() {
    const snapshot = await programsSnapshot({ treesRoot: TREES_ROOT, sessions: await listProgramSessions() });
    return { ...await projectMaterialOperationEvents(snapshot), processes: await processViews() };
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
      await runLocalTangent(["service", action, program.name, "--area", program.area]);
    } else if (program.type === "command") {
      await controlCommand(program, action);
    } else {
      throw new Error("Choose Start, Run, Stop, Restart, or Close.");
    }
    const refreshed = await programsSnapshot({ treesRoot: TREES_ROOT, sessions: await listProgramSessions() });
    await projectMaterialOperationEvents(refreshed);
    return { ok: true };
  },
});
const documentRoutes = createDocumentRoutes({
  /** Returns the vault index with its server-owned desk projection. */
  async vault() {
    const [vault, sessions, brains] = await Promise.all([vaultIndex(), listSessions(), readAllBrains(BRAINS_ROOT)]);
    const projectedVault = withoutBrainGoalBindings(vault, brainSessionNames(brains));
    return { ...projectedVault, projection: await vaultProjection.status(), desk: projectDesk(projectedVault, sessions) };
  },
  readMap: readMapState,
  writeMap: writeMapState,
  validArea: validAreaPath,
  /** Reads a vault Document or one presentation-authorized repository file. */
  async readDocument(file, repository) { return repository ? readPresentedRepositoryDocument(repository) : readVaultDocument(file); },
  writeDocument: saveVaultDocument,
  notifyComments: notifyBrainOfDocumentComments,
  resolve: resolveVaultDocumentComment,
});
const goalPresentationRoutes = createGoalPresentationRoutes({
  /** Validates and records one or more Goal presentations. */
  async present(body) {
    const goals = await goalsByFile();
    const requested = String(body.goal ?? "");
    const goal = goals.get(requested) ?? [...goals.values()].find((item) => item.slug === requested);
    if (!goal || ["done", "dropped", "parked", "deferred"].includes(normalizeGoalStatus(goal.status))) return { status: 404, error: `no open Goal ${requested}` };
    const session = String(body.session ?? body.caller ?? "").trim();
    const actor = await commandProvenance(session);
    if (actor.role === "worker" && (await workerGoalForSession(session))?.file !== goal.file) return { status: 403, error: "a worker can present only on its assigned Goal" };
    const files = Array.isArray(body.files) ? body.files : [body.file];
    const resolved = [];
    for (const file of files) {
      const document = await resolvePresentedDocument(goal, file);
      if (document.error) return { status: 400, error: document.error };
      resolved.push(document);
    }
    const items = [];
    for (const document of resolved) {
      const result = await presentGoalDocument(PRESENTATIONS_ROOT, goal, document, { session: actor.session, role: actor.role, assignmentId: actor.assignment?.id ?? null }, body.note);
      items.push(result.item);
    }
    return { status: 200, value: { goal: goal.file, items } };
  },
  /** Withdraws one presentation from its Goal. */
  async withdraw(body) {
    const goals = await goalsByFile();
    const requested = String(body.goal ?? "");
    const goal = goals.get(requested) ?? [...goals.values()].find((item) => item.slug === requested);
    if (!goal) return { status: 404, error: `no Goal ${requested}` };
    const result = await withdrawGoalDocument(PRESENTATIONS_ROOT, goal, String(body.file ?? ""));
    return result.changed ? { status: 200, value: { ok: true } } : { status: 404, error: "no active presentation for that document" };
  },
  /** Hides one presentation on Julian's word until its content changes. */
  async dismiss(body) {
    const goals = await goalsByFile();
    const requested = String(body.goal ?? "");
    const goal = goals.get(requested) ?? [...goals.values()].find((item) => item.slug === requested);
    if (!goal) return { status: 404, error: `no Goal ${requested}` };
    const result = await dismissGoalDocument(PRESENTATIONS_ROOT, goal, String(body.file ?? ""));
    return result.changed ? { status: 200, value: { ok: true } } : { status: 404, error: "no active presentation for that document" };
  },
  /** Records that a reader opened a presented Document. The row stays on Work. */
  async opened(body) {
    const goals = await goalsByFile();
    const requested = String(body.goal ?? "");
    const candidates = requested ? [goals.get(requested) ?? [...goals.values()].find((item) => item.slug === requested)].filter(Boolean) : [...goals.values()];
    let changed = false;
    for (const goal of candidates) changed = (await markGoalDocumentOpened(PRESENTATIONS_ROOT, goal, String(body.file ?? ""), body.hash ?? null)).changed || changed;
    return { status: 200, value: { ok: true, changed } };
  },
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
  /** Replaces all v1 defaults with the confirmed top-level Area policies. */
  async migrateLaunchPolicy({ apply = false } = {}) {
    const policies = { otto: ["codex", "claude-otto"], neara: ["claude-gw", "codex-gw", "pi-code", "opencode"] };
    const areas = flattenAreaPaths(await readTree(TREES_ROOT));
    const changes = [];
    const seeds = [];
    for (const area of areas) {
      const file = areaNoteFile(area);
      const original = await readFile(path.join(TREES_ROOT, file), "utf8").catch(() => "");
      let migrated;
      try { migrated = migrateEnvironmentV1(original, policies[area] ?? []); }
      catch (error) { return { status: 400, error: `${area}: ${error.message}` }; }
      if (migrated.text !== original) changes.push({ area, file, text: migrated.text, allow: policies[area] ?? [] });
      const work = migrated.defaults?.launch;
      const brain = migrated.defaults?.brain === "work" ? work : migrated.defaults?.brain;
      if (work?.harness) seeds.push({ area, kind: "work", ref: work });
      if (brain?.harness) seeds.push({ area, kind: "brain", ref: brain });
    }
    const preview = { policies, files: changes.map(({ area, file, allow }) => ({ area, file, allow })), memory: seeds };
    if (!apply) return { status: 200, value: { dryRun: true, ...preview } };
    if (!changes.length) return { status: 200, value: { dryRun: false, changed: false, ...preview } };
    for (const change of changes) {
      await vaultRepository.writeMarkdown(change.file, change.text);
      await execFileAsync("git", ["-C", TREES_ROOT, "add", "--", change.file]);
    }
    await vaultCommit(changes.map((change) => change.file), "update: launch policy replaces defaults", "machine", null);
    const stored = [];
    for (const seed of seeds) {
      const saved = await launchCatalog.saveMemory(seed.area, seed.kind, seed.ref);
      if (!saved.error) stored.push(seed);
    }
    return { status: 200, value: { dryRun: false, changed: true, ...preview, memory: stored } };
  },
  /** Changes the orchestrator command and stops its old session. */
  async agent(command) {
    agentCmd = command;
    const stopped = await terminateOwnedSession(CHAT_SESSION);
    if (!["terminated", "absent"].includes(stopped.state)) throw new Error(terminationError(CHAT_SESSION, stopped));
    return agentCmd;
  },
  /** Kills one exact non-orchestrator session and closes its execution records. */
  async kill(name) {
    if (!name || name === CHAT_SESSION) return { status: 400, error: "refusing to kill this session" };
    try {
      const brain = (await readAllBrains(BRAINS_ROOT)).find((item) => item.status === "active" && item.session === name);
      if (brain) {
        const result = await stopBrain(brain.area, { expectedAttemptId: name, operationId: randomUUID() });
        return result.status === 200
          ? { status: 200, value: { ok: true, pipelineEnded: false, brainEnded: true } }
          : { status: result.status, error: result.error };
      }
      const stopped = await terminateOwnedSession(name);
      if (stopped.state !== "terminated") {
        const status = stopped.state === "absent" ? 404 : stopped.state === "error" ? 503 : 409;
        return { status, error: terminationError(name, stopped) };
      }
      const ended = await endPipelineForSession(name).catch((error) => { console.error("end pipeline on kill:", error.message ?? error); return null; });
      return { status: 200, value: { ok: true, pipelineEnded: Boolean(ended), brainEnded: false } };
    } catch (error) {
      return { status: 500, error: String(error.stderr ?? error.message ?? error) };
    }
  },
  /** Fences a Goal stop to its exact projected live session. */
  async stopGoal({ goal, expectedSession } = {}) {
    const target = goalStopTarget(await listSessions(), { goal, expectedSession });
    if (target.status !== 200) return target;
    return shellControlOperations.kill(target.name);
  },
});
const shellStateRoutes = createShellStateRoutes({
  chatSession: CHAT_SESSION,
  /** Returns one coherent live shell snapshot. */
  async snapshot() {
    const sessions = await listSessions();
    const [pipelines, brains, revisions, rebuild, attemptReplacements] = await Promise.all([
      pipelinesView(sessions).catch(() => []),
      // Projection work runs in the replaceable controller and is cached; the
      // public gateway and terminal path remain independent while the shell
      // snapshot keeps its complete For-Julian contract.
      brainsView(sessions).catch(() => []),
      commitChanges.status().catch(() => ({ deployedCommit: commitChanges.deployedCommit, currentCommit: commitChanges.deployedCommit, commits: [] })),
      rebuildOperations.current().catch(() => null),
      readAllAttemptReplacements(ATTEMPT_REPLACEMENTS_ROOT).then(unsettledAttemptReplacements).catch(() => []),
    ]);
    return {
      agent: agentCmd,
      boot: BOOT_ID,
      sourceChanged: revisions.commits.length > 0,
      deployedCommit: revisions.deployedCommit,
      currentCommit: revisions.currentCommit,
      pendingCommits: revisions.commits,
      rebuild,
      goalCleanups: await readAllGoalCleanups(GOAL_CLEANUPS_ROOT),
      caffeinate: caffeinateProc !== null,
      voice: Boolean(GROQ_KEY),
      sessions,
      runtime: { instanceId: INSTANCE_ID, ownershipKey: SESSION_OWNER_OPTION, sessions: sessionObservation.status() },
      pipelines,
      attemptReplacements,
      brains,
      contextHandoverTokens: CONTEXT_HANDOVER_TOKENS,
    };
  },
});
const voiceRoutes = createVoiceRoutes({
  chatSession: CHAT_SESSION,
  /** Reports whether transcription and command routing are configured. */
  available: () => Boolean(GROQ_KEY),
  transcribe,
  /** Saves transcribed or typed capture through the Journal-first Area route. */
  capture(body) { return areaRoutesOperations.capture(body); },
});
const goalQueryRoutes = createGoalQueryRoutes({
  /**
   * Lists summarized Goals in one Area, its subtree, or the whole vault.
   *
   * The exact-Area result also reports what the subtree holds. A brain that
   * asked one Area for recent work used to read an empty list and then search
   * unrelated repositories, because nothing told it that child Areas existed.
   */
  async list(area, { subtree = false, ...requested } = {}) {
    const allAreas = flattenAreaPaths(await readTree(TREES_ROOT));
    if (area && !allAreas.includes(area)) return { status: 404, error: `no area "${area}"` };
    const filters = goalQueryFilters(requested);
    const allGoals = [];
    for (const one of allAreas) allGoals.push(...await readAreaGoals(one));
    projectGoalDependencies(allGoals);
    /** Applies the caller's filters to one page of summaries. */
    const narrow = (goals) => filterGoalSummaries(goals, filters);
    const prefix = `${area}/`;
    /** True when one Goal belongs to the requested Area scope. */
    const inScope = (goal) => goal.area === area || (subtree && goal.area.startsWith(prefix));
    const children = area ? allAreas.filter((one) => one.startsWith(prefix)) : [];
    const descendants = area ? allGoals.filter((goal) => goal.area.startsWith(prefix)) : [];
    let goals;
    let matchedDescendants;
    // An unreadable recency window is the caller's mistake. Answering it with
    // an empty list would report the opposite of what the caller asked.
    try {
      goals = narrow((area ? allGoals.filter(inScope) : allGoals).map(goalSummary));
      matchedDescendants = narrow(descendants.map(goalSummary));
    } catch (error) {
      return { status: 400, error: String(error.message ?? error) };
    }
    if (!area) return { status: 200, value: { goals, ...(hasGoalQueryFilters(filters) ? { filters } : {}) } };
    return {
      status: 200,
      value: {
        goals,
        scope: subtree ? "subtree" : "exact",
        childAreas: children.length,
        // The subtree scent counts what the same filters would find there, so
        // a filtered listing never sends a brain after work it excluded.
        descendantGoals: matchedDescendants.length,
        ...(hasGoalQueryFilters(filters) ? { filters } : {}),
        ...(!subtree && matchedDescendants.length
          ? { subtreeCommand: `tangent goal list ${area} --subtree${goalFilterFlags(filters)}` }
          : {}),
      },
    };
  },
  /** Finds one complete Goal by slug. */
  async show(slug) {
    const goals = [...(await goalsByFile()).values()];
    projectGoalDependencies(goals);
    const matches = goals.filter((goal) => goal.slug === slug);
    if (matches.length === 1) return { status: 200, value: { goal: matches[0] } };
    if (matches.length > 1) return { status: 409, error: `goal ${slug} is ambiguous: ${matches.map((goal) => goal.file).join(", ")}` };
    return { status: 404, error: `no goal ${slug}` };
  },
  /** Adds or removes advisory prerequisite links on one Goal. */
  async dependencies(body, removing) {
    const slug = String(body.slug ?? "").trim();
    const on = (Array.isArray(body.on) ? body.on : []).map(String).map((item) => item.trim()).filter(Boolean);
    if (!slug || !on.length) return { status: 400, error: `${removing ? "undepend" : "depend"} needs a goal slug and at least one prerequisite` };
    const goals = [...(await goalsByFile()).values()];
    const result = changeGoalDependencies(goals, slug, on, removing);
    if (result.error) {
      const status = result.error.startsWith("no goal") ? 404 : 409;
      return { status, error: result.error };
    }
    if (!result.changed) return { status: 200, value: { ok: true, slug, dependsOn: result.slugs, changed: false } };
    try {
      const text = await readFile(path.join(TREES_ROOT, result.goal.file), "utf8");
      await vaultRepository.writeMarkdown(result.goal.file, writeDependencySlugs(text, result.slugs));
      await vaultCommit([result.goal.file], `update: ${result.goal.area} goal ${result.goal.slug} dependencies`, result.goal.area, null);
      await recordCommittedCommand({ operation: removing ? "goal-undepend" : "goal-depend", actorSession: body.caller, targetArea: result.goal.area, goal: result.goal.slug });
      return { status: 200, value: { ok: true, slug, dependsOn: result.slugs, changed: true } };
    } catch (error) {
      return { status: 500, error: String(error.stderr ?? error.message ?? error) };
    }
  },
  /** Owns or releases a set of Goals for one live session. */
  async ownership(body, releasing) {
    const session = String(body.session ?? "").trim();
    const slugs = (Array.isArray(body.slugs) ? body.slugs : []).map(String).filter(Boolean);
    const verb = releasing ? "release" : "own";
    if (!session || !slugs.length) return { status: 400, error: `${verb} needs a session name and at least one goal slug` };
    const liveSessions = await listSessions();
    if (brainSessionNames(await readAllBrains(BRAINS_ROOT)).has(session)) return { status: 403, error: "An Area brain controls Goal queues; it cannot own a worker Goal." };
    const live = new Set(liveSessions.map((item) => item.name));
    if (!releasing && !live.has(session)) return { status: 404, error: `no tmux session "${session}"; run this inside the agent's session or pass --session` };
    const bySlug = new Map([...(await goalsByFile()).values()].map((goal) => [goal.slug, goal]));
    const resolved = [];
    for (const slug of slugs) {
      const goal = bySlug.get(slug);
      if (!goal) return { status: 404, error: `no goal ${slug}` };
      if (!releasing && ["done", "dropped", "parked"].includes(goal.status)) return { status: 409, error: `goal ${slug} is ${goal.status}` };
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
        await recordCommittedCommand({ operation: releasing ? "goal-release" : "goal-own", actorSession: session, targetArea: goal.area, goal: goal.slug });
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
    if (mode === "pipeline") {
      const record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
      if (!record) return { status: 404, error: "this Goal has no pipeline" };
      const selected = record.steps.find((item) => item.index === step) ?? currentStep(record) ?? record.steps[0];
      const attempt = selected.attempts?.at(-1) ?? null;
      markdown = await pipelineStepPrompt(goal.area, goal, record, selected.index, [], selected.session ?? "", null, await promptWorkFolder(goal.area, attempt));
    } else markdown = await goalPrompt(goal.area, goal, [], [], null, await promptWorkFolder(goal.area));
    return {
      status: 200,
      value: {
        goal,
        markdown,
        agent: await launchCatalog.commandForArea(goal.area).then(withDefaultModel).catch(() => ""),
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
    try {
      const sources = await sourceDocuments(body.sources);
      const owner = brainRecordForArea(await readAllBrains(BRAINS_ROOT), area);
      if (owner) {
        const hasLaunchOverride = Boolean(body.choice || String(body.command ?? "").trim());
        const launchOverride = hasLaunchOverride
          ? { choice: body.choice ?? null, command: String(body.command ?? "") }
          : null;
        if (launchOverride) {
          const chosen = await launchCatalog.requested(launchOverride);
          if (chosen.error) return { status: 400, error: chosen.error };
        }
        const result = await describeWorkToBrain(owner, area, description, sources, launchOverride);
        return { status: result.status, ...(result.status === 200 ? { value: result } : { error: result.error }) };
      }
      // No brain record yet: everything starts through the brain (D8), so
      // Julian's message founds one. It is typed as the first message.
      const started = await startBrain(area, { instruction: describedWorkNotice(area, description, sources) });
      if (started.status !== 200) return { status: started.status, error: `The ${area} brain did not start: ${started.error}` };
      return { status: 200, value: { ...started, brainArea: area, route: "brain-started", launchLabel: started.brain?.resolvedLaunch?.label || "" } };
    } catch (error) { return { status: 500, error: String(error.stderr ?? error.message ?? error) }; }
  },
  /** Returns the raw harness registry. */
  async readHarnesses() {
    const registry = await launchCatalog.registry();
    return registry.error ? { status: 500, error: registry.error } : { status: 200, value: { registry } };
  },
  /** Validates and commits a replacement harness registry. */
  async writeHarnesses(body) {
    const saved = await launchCatalog.saveRegistry(body);
    if (saved.error) return { status: 400, error: saved.error };
    return { status: 200, value: { ok: true } };
  },
  /** Returns named launch choices and the requested Area defaults. */
  async options(area, kind = "launch") {
    const catalog = await launchCatalog.options(area, kind);
    return catalog.error ? { status: 500, error: catalog.error } : { status: 200, value: catalog };
  },
  /** Commits one Area's explicit default launch. */
  async saveDefault(body) {
    return { status: 410, code: "defaults-retired", error: "launch defaults are retired" };
  },
  /** Commits one Area's allowed launch policy. */
  async savePolicy(body) {
    const area = String(body.area ?? "");
    if (!validAreaPath(area) || !await areaExists(area)) return { status: 404, error: `no area "${area}"` };
    const saved = await launchCatalog.savePolicy(area, body.allow ?? []);
    const status = saved.code === "policy-empties-child" ? 409 : saved.error ? 400 : 200;
    return saved.error ? { status, code: saved.code, error: saved.error } : { status: 200, value: saved };
  },
  /** Starts a Goal agent or a validated pipeline. */
  async start(body) {
    try {
      const file = String(body.file ?? "");
      const goal = (await goalsByFile()).get(file);
      if (!goal) return { status: 404, error: `no goal file ${file}` };
      const caller = String(body.caller ?? "").trim();
      // Only the brain starts workers (D8). It may lend its own launch across
      // Area boundaries; a step that names a launch keeps it.
      const callingBrain = await liveCallingBrain(caller);
      if (!callingBrain) return { status: 403, error: brainOnlyStartRefusal(goal.area) };
      if (body.recovery === true) {
        const recovered = await recoverQueuedGoal(goal);
        if (recovered.status === 200) {
          await recordCommittedCommand({ operation: "goal-recovery-start", actorSession: caller, targetArea: goal.area, goal: goal.slug, operationId: body.idempotencyKey });
        }
        return { status: recovered.status, ...(recovered.status === 200 ? { value: { session: recovered.session, pipeline: recovered.pipeline, warnings: [], recovery: true } } : { error: recovered.error }) };
      }
      let steps = Array.isArray(body.steps) && body.steps.length ? body.steps : null;
      if (!steps) {
        const chosen = await launchCatalog.requested(body);
        if (chosen.error) return { status: 400, error: chosen.error };
        steps = [{
          instruction: "Implement this Goal and submit a typed implementation result.",
          ...(body.choice && typeof body.choice === "object" ? { launch: body.choice } : { command: chosen.command }),
          kind: "implementation",
        }];
      }
      const result = await startPipeline(file, {
        steps,
        attemptKind: "managed",
        brain: callingBrain,
        extraFiles: Array.isArray(body.extraFiles) ? body.extraFiles.map(String) : [],
      });
      if (result.status === 200) {
        await recordCommittedCommand({ operation: "goal-start", actorSession: caller, targetArea: goal.area, goal: goal.slug, operationId: body.idempotencyKey, result: `started assignment 1 in ${result.session}` });
      }
      return { status: result.status, ...(result.status === 200 ? { value: { session: result.session, pipeline: result.pipeline, warnings: result.warnings ?? [], launches: result.launches ?? [], recovery: false } } : { error: result.error }) };
    } catch (error) { return { status: 500, error: String(error.stderr ?? error.message ?? error) }; }
  },
});

/** Reads the complete Goal model used by both the Vim reader and the CLI. */
async function readGoalDetail(file, { conversations = false } = {}) {
  const requested = String(file ?? "").trim();
  const goalIndex = await goalsByFile();
  let rawGoal = goalIndex.get(requested);
  if (!rawGoal) {
    const matches = [...goalIndex.values()].filter((goal) => goal.slug === requested);
    if (matches.length > 1) return { status: 409, error: `goal ${requested} is ambiguous: ${matches.map((goal) => goal.file).join(", ")}` };
    rawGoal = matches[0] ?? null;
  }
  if (!rawGoal) return { status: 404, error: `no goal ${requested}` };
  const goalFile = rawGoal.file;
  const [projection, markdown, queue, sessions, registry] = await Promise.all([
    vaultIndex(),
    readFile(path.join(TREES_ROOT, goalFile), "utf8"),
    readPipeline(PIPELINES_ROOT, rawGoal.area, rawGoal.slug),
    listSessions(),
    launchCatalog.registry(),
  ]);
  const enriched = projection.areas
    .flatMap((area) => area.goals ?? [])
    .find((goal) => goal.file === goalFile) ?? rawGoal;
  const goal = normalizeGoalRecord({ ...rawGoal, ...enriched });
  const validRegistry = registry.error ? null : registry;
  const detail = projectGoalDetail({
    goal,
    markdown,
    queue,
    sessions,
    relatedDocuments: goal.documents ?? [],
    registry: validRegistry,
  });
  if (conversations) await attachFoundConversations(goal, detail, validRegistry);
  return { status: 200, value: detail };
}

/**
 * Finds the conversation of every attempt that got no id at launch (codex)
 * by its folder and start time, on request only (D22). Every match is
 * listed; one match also fills the resume command and is written back to
 * the attempt, so the next `goal show` and Resume need no lookup.
 */
async function attachFoundConversations(goal, detail, registry) {
  for (const attempt of detail.attempts) {
    if (attempt.providerSession?.id) continue;
    const harness = (registry?.harnesses ?? []).find((entry) => entry.id === attempt.resolvedLaunch?.ref?.harness);
    if (!harness?.transcripts || !attempt.cwd || !attempt.startedAt) continue;
    const found = await findCodexRollouts({ transcripts: harness.transcripts, cwd: attempt.cwd, startedAt: attempt.startedAt });
    attempt.resume.found = found;
    if (found.length === 1) {
      attempt.resume.conversationId = found[0].id;
      attempt.resume.command = resumeCommand(harness, { command: attempt.resolvedLaunch?.command ?? "", id: found[0].id });
      attempt.providerSession = await rememberFoundConversation(goal, attempt.id, { provider: harness.id, id: found[0].id });
    }
  }
}

/**
 * Writes a conversation found by lookup onto its attempt in the queue record
 * (D22), under the Goal queue lock. Returns the stored conversation. A later
 * lookup for the same attempt is then never needed.
 */
async function rememberFoundConversation(goal, attemptId, conversation) {
  return withGoalQueueMutation(goal.file, async () => {
    const record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
    const attempt = (record?.steps ?? []).flatMap((step) => step.attempts ?? []).find((item) => item.id === attemptId);
    if (!attempt) return conversation;
    if (attempt.providerSession?.id) return attempt.providerSession;
    attempt.providerSession = { provider: conversation.provider, id: conversation.id };
    await writePipeline(PIPELINES_ROOT, record);
    return attempt.providerSession;
  });
}

/**
 * Resumes one attempt (D23). A live attempt is attached, so the caller opens
 * its session. A dead attempt gets a new owned tmux session of kind `resume`
 * in the attempt's folder with the resume command typed and never submitted.
 * The session carries no Goal, so a finished Goal can be resumed and nothing
 * rebinds the Goal to it.
 */
async function resumeGoalAttempt(goalFile, { attemptId = "", conversationId = "" } = {}) {
  const goal = (await goalsByFile()).get(goalFile);
  if (!goal) return { status: 404, error: `no goal file ${goalFile}` };
  const record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
  const attempts = (record?.steps ?? []).flatMap((step) => step.attempts ?? []);
  const attempt = attemptId ? attempts.find((item) => item.id === attemptId) : attempts.at(-1);
  if (!attempt) return { status: 404, error: attemptId ? `no attempt ${attemptId} on ${goal.slug}` : `${goal.slug} has no attempts` };
  const sessions = await listSessions();
  // A dead attempt whose tmux name was reused must never attach to the
  // stranger that holds the name now.
  if (attempt.session && !attempt.endedAt && sessions.some((session) => session.name === attempt.session)) {
    return { status: 200, state: "live", session: attempt.session, command: null };
  }
  const harness = await registryHarness(attempt.resolvedLaunch?.ref?.harness);
  if (!harness?.resume) return { status: 409, error: `harness ${attempt.resolvedLaunch?.ref?.harness ?? "(unknown)"} has no resume command in harnesses.md` };
  let id = String(conversationId || attempt.providerSession?.id || "");
  if (!id && harness.transcripts && attempt.cwd && attempt.startedAt) {
    const found = await findCodexRollouts({ transcripts: harness.transcripts, cwd: attempt.cwd, startedAt: attempt.startedAt });
    if (found.length === 1) {
      id = found[0].id;
      await rememberFoundConversation(goal, attempt.id, { provider: harness.id, id });
    }
    else if (found.length > 1) return { status: 409, error: `${found.length} conversations match this attempt: ${found.map((item) => item.id).join(", ")}. Pass conversationId.`, found };
  }
  if (!id) return { status: 409, error: `attempt ${attempt.id} has no conversation id to resume` };
  const command = resumeCommand(harness, { command: attempt.resolvedLaunch?.command ?? "", id });
  if (!attempt.cwd || !existsSync(attempt.cwd)) return { status: 409, error: `the attempt's folder ${attempt.cwd || "(none)"} does not exist` };
  const sessionName = normName(`${attempt.session || goal.slug}--resume`).slice(0, 60);
  if (sessions.some((session) => session.name === sessionName)) return { status: 200, state: "resumed", session: sessionName, command };
  const occupied = await sessionOwnership.inspect(sessionName);
  if (occupied.state === "live") return { status: 409, error: terminationError(sessionName, occupied.instanceId ? { state: "foreign", instanceId: occupied.instanceId } : { state: "legacy" }) };
  await createOwnedTmuxSession(sessionName, ["-d", "-s", sessionName, "-c", attempt.cwd]);
  await execFileAsync("tmux", ["set-option", "-t", sessionName, "@tangent_kind", "resume"]);
  await execFileAsync("tmux", ["set-option", "-t", sessionName, "@tangent_area", goal.area]);
  await execFileAsync("tmux", ["set-option", "-t", sessionName, "@tangent_cwd", attempt.cwd]);
  await execFileAsync("tmux", ["set-option", "-t", sessionName, "@tangent_work_title", `Resume ${attempt.session || goal.slug}`]);
  await execFileAsync("tmux", ["set-option", "-t", sessionName, "@tangent_launch_command", command]);
  // Let the login shell finish drawing its prompt, then type and never submit.
  await sleep(700);
  await typeInto(sessionName, command, false);
  return { status: 200, state: "resumed", session: sessionName, command };
}

/** Retires or detaches one parked Goal only after its status commit. */
async function settleParkedGoalSession(goal, sourceTarget, operationId) {
  const sourceSession = sourceTarget?.session;
  if (!sourceSession) return { kind: "absent", detail: "the Goal had no source session" };
  const sessions = await listAllSessions({ fresh: true });
  const live = sessions.find((session) => session.name === sourceSession);
  if (!live || !live.owned || live.kind !== "goal" || live.goal !== goal.file) {
    return { kind: "preserved", detail: "the historical session no longer exactly owns this Goal" };
  }
  const inspected = await sessionOwnership.inspect(sourceSession);
  if (inspected.state === "absent") return { kind: "retired", detail: "the exact source was already absent" };
  if (inspected.state !== "live" || inspected.instanceId !== sourceTarget.instanceId || inspected.target !== sourceTarget.target) {
    return { kind: "preserved", detail: "the live session failed its immutable ownership fence" };
  }
  const remaining = [...(await goalsByFile()).values()]
    .find((candidate) => candidate.file !== goal.file
      && candidate.session === sourceSession
      && !["done", "dropped", "parked"].includes(candidate.status));
  const nextGoal = remaining?.file ?? "";
  if (!remaining) {
    const stopped = await sessionOwnership.terminate(sourceSession, sourceTarget.target);
    if (!["terminated", "absent"].includes(stopped.state)) {
      return { kind: "preserved", detail: terminationError(sourceSession, stopped) };
    }
    armedSessions.delete(sourceSession);
    await clearArmedPrompt(ARMED_ROOT, sourceSession).catch(() => {});
    sessionObservation.invalidate();
    return { kind: "retired", detail: "the exact sole Goal attempt was retired after the status commit" };
  }
  await execFileAsync("tmux", ["set-option", "-t", inspected.target, "@tangent_goal", nextGoal]);
  await execFileAsync("tmux", ["set-option", "-t", inspected.target, "@tangent_pipeline", ""]);
  await execFileAsync("tmux", ["set-option", "-t", inspected.target, "@tangent_step", ""]);
  await execFileAsync("tmux", ["set-option", "-t", inspected.target, "@tangent_assignment", ""]);
  await execFileAsync("tmux", ["set-option", "-t", inspected.target, "@tangent_attempt", ""]);
  messages.queue(sourceSession, {
    from: "tangent",
    area: goal.area,
    text: remaining
      ? `Goal ${goal.slug} was parked. Keep working only on Goal ${remaining.slug}; the parked Goal is no longer assigned to this session.`
      : `Goal ${goal.slug} was parked.`,
    banner: true,
    queuedAt: new Date().toISOString(),
    idempotencyKey: `park-detach:${operationId}`,
  });
  sessionObservation.invalidate();
  return { kind: "detached", detail: `retagged to ${remaining.slug}` };
}

/** Parks a Goal queue and detaches only its exact current worker. */
async function parkGoalExecution(goal, body, operationId) {
  return withGoalQueueMutation(goal.file, async () => {
    const record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
    let sourceSession = goal.session ?? null;
    let sourceTarget = null;
    let transition = null;
    if (record?.currentAssignmentId) {
      const assignment = record.steps.find((item) => item.id === record.currentAssignmentId);
      const attempt = assignment?.attempts?.at(-1);
      if (!assignment || !attempt) return { status: 409, error: "the Goal queue has no exact current attempt", pipeline: record };
      const inspected = await inspectCurrentGoalAttemptTarget(goal, record, assignment, attempt);
      if (inspected.error) return { status: 409, code: inspected.code, error: inspected.error, pipeline: record };
      sourceTarget = inspected.target;
      try {
        transition = parkCurrentGoalAttempt(record, {
          assignmentId: assignment.id,
          expectedAttemptId: attempt.id,
          expectedRevision: body.expectedRevision ?? record.revision,
          operationId,
          reason: body.reason,
        });
      } catch (error) {
        if (!(error instanceof GoalExecutionTransitionError)) throw error;
        return { status: error.code === "stale-revision" ? 409 : 400, code: error.code, error: error.message, pipeline: error.pipeline ?? record };
      }
      sourceSession = transition.sourceSession ?? sourceSession;
      if (!transition.repeated) await writePipeline(PIPELINES_ROOT, record);
    }
    return { status: 200, transition, sourceSession, sourceTarget, pipeline: record };
  });
}

/** Reopens a parked Goal queue without selecting or launching work. */
async function reopenGoalExecution(goal, body, operationId) {
  return withGoalQueueMutation(goal.file, async () => {
    const record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
    if (!record || record.status !== "parked") return { status: 200, pipeline: record, repeated: false };
    try {
      const result = reopenParkedGoalQueue(record, {
        expectedRevision: body.expectedRevision ?? record.revision,
        operationId,
      });
      if (!result.repeated) await writePipeline(PIPELINES_ROOT, record);
      return { status: 200, pipeline: record, repeated: result.repeated };
    } catch (error) {
      if (!(error instanceof GoalExecutionTransitionError)) throw error;
      return { status: error.code === "stale-revision" ? 409 : 400, code: error.code, error: error.message, pipeline: error.pipeline ?? record };
    }
  });
}

const workMutationRoutes = createWorkMutationRoutes({
  /** Projects one complete Goal reader from vault and runtime authority. */
  async detail(body) {
    try { return await readGoalDetail(body.goal ?? body.file, { conversations: ["1", "true"].includes(String(body.conversations ?? "")) }); }
    catch (error) { return serverError(error); }
  },
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
      await recordCommittedCommand({ operation: "goal-understanding", actorSession: body.session, targetArea: goal.area, goal: goal.slug });
      return { status: 200, value: { ok: true, understanding } };
    } catch (error) { return serverError(error); }
  },
  /** Accepts one Goal assignment. */
  async accept(body) {
    try {
      const file = String(body.file ?? "");
      const result = await acceptGoalAssignment(file);
      const goal = (await goalsByFile()).get(file);
      if (result.status === 200 && goal) await recordCommittedCommand({ operation: "goal-accept", actorSession: body.session, targetArea: goal.area, goal: goal.slug });
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
    try {
      const created = await createGoalSet(area, { goal: { title, doneWhen, state: typeof body.state === "string" ? body.state : "" } });
      const goal = (await goalsByFile()).get(created.file);
      await recordCommittedCommand({ operation: "goal-create", actorSession: body.caller, targetArea: area, goal: goal?.slug ?? path.basename(created.file, ".md").replace(/^goal-/, "") });
      return { status: 200, value: { file: created.file } };
    }
    catch (error) { return serverError(error); }
  },
  /** Creates one Goal with optional Subgoals, sources, and ownership. */
  async create(body) {
    const area = String(body.area ?? "");
    const goal = body.goal && typeof body.goal === "object" ? body.goal : {};
    if (!await areaExists(area)) return { status: 404, error: `no area "${area}"` };
    if (!String(goal.title ?? "").trim()) return { status: 400, error: "the Goal needs a name" };
    // The done condition defaults to the title (D8).
    goal.doneWhen = String(goal.doneWhen ?? "").trim() || String(goal.title).trim();
    const caller = String(body.caller ?? "").trim();
    // Everything starts through the brain (D8): only a live brain starts a
    // worker from create. Nothing is written before this refusal.
    const start = body.start === true;
    const callingBrain = start ? await liveCallingBrain(caller) : null;
    if (start && !callingBrain) return { status: 403, error: brainOnlyStartRefusal(area) };
    const subgoals = (Array.isArray(body.subgoals) ? body.subgoals.slice(0, 8) : []).map((item) => ({ title: String(item?.title ?? "").trim(), doneWhen: String(item?.doneWhen ?? "").trim(), state: "Not started." })).filter((item) => item.title || item.doneWhen);
    if (subgoals.some((item) => !item.title || !item.doneWhen)) return { status: 400, error: "each Subgoal needs a name and a done condition" };
    const own = String(body.own ?? "").trim();
    if (caller && own && caller !== own) return { status: 409, error: `${caller} cannot create a Goal owned by live session ${own}` };
    if (own && brainSessionNames(await readAllBrains(BRAINS_ROOT)).has(own)) return { status: 403, error: "An Area brain controls Goal queues; it cannot own a worker Goal." };
    const sessions = own ? await listSessions() : [];
    if (own && !sessions.some((session) => session.name === own)) return { status: 404, error: `no tmux session "${own}"; run create --own inside the agent's session or pass --session` };
    try {
      const sources = await sourceDocuments(body.sources);
      const created = await createGoalSet(area, { goal: { title: String(goal.title).trim(), doneWhen: String(goal.doneWhen).trim(), state: String(goal.state ?? "Not started.").trim() }, subgoals, description: String(body.description ?? "").trim(), sources: sources.map((source) => ({ file: source.file, title: source.title })), verify: body.verify === true, process: processFileOf(body.instructionFile) });
      if (start && created.file) {
        await recordCommittedCommand({ operation: "goal-create", actorSession: caller, targetArea: area, goal: path.basename(created.file, ".md").replace(/^goal-/, "") });
        const instruction = String(body.instruction ?? "").trim() || `${String(goal.title).trim()}. Done when: ${goal.doneWhen}`;
        const step = { instruction, kind: "implementation", ...(typeof body.path === "string" && body.path.trim() ? { path: body.path.trim() } : {}), ...(body.launch && typeof body.launch === "object" ? { launch: body.launch } : {}) };
        const started = await startPipeline(created.file, { steps: [step], attemptKind: "managed", brain: callingBrain });
        if (started.status !== 200) return { status: 200, value: { ...created, started: false, startError: started.error } };
        await recordCommittedCommand({ operation: "goal-start", actorSession: caller, targetArea: area, goal: path.basename(created.file, ".md").replace(/^goal-/, ""), result: `started assignment 1 in ${started.session}` });
        return { status: 200, value: { ...created, started: true, session: started.session, launches: started.launches ?? [], warnings: started.warnings ?? [] } };
      }
      if (own && created.file) {
        await writeGoalBinding(created.file, { status: "active", session: own });
        await vaultCommit([created.file], `update: ${area} goal owned by ${own}`, area, own);
        await adoptGoalSession(sessions, own, { area, file: created.file });
      }
      if (created.file) {
        const createdGoal = (await goalsByFile()).get(created.file);
        await recordCommittedCommand({ operation: "goal-create", actorSession: caller, targetArea: area, goal: createdGoal?.slug ?? path.basename(created.file, ".md").replace(/^goal-/, "") });
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
    try {
      const file = await saveWorkIdea(area, description);
      await recordCommittedCommand({ operation: "idea-add", actorSession: body.caller, targetArea: area });
      return { status: 200, value: { ok: true, file } };
    }
    catch (error) { return serverError(error); }
  },
  /** Lists ideas in one Area or the complete vault. */
  async ideas({ area = null }) {
    const allAreas = flattenAreaPaths(await readTree(TREES_ROOT));
    if (area && !allAreas.includes(area)) return { status: 404, error: `no area "${area}"` };
    const ideas = [];
    for (const one of area ? [area] : allAreas) ideas.push(...(await areaIdeas(one)).map((text) => ({ area: one, text })));
    return { status: 200, value: { ideas } };
  },
  /** Marks an Area done, archived, or active without changing its Goals. */
  async areaStatus(body) {
    const area = String(body.area ?? "");
    const status = String(body.status ?? "");
    if (!validAreaPath(area) || !["done", "archived", "active"].includes(status)) return { status: 400, error: "area and status (done, archived, or active) required" };
    try { await stat(path.join(TREES_ROOT, area)); }
    catch { return { status: 404, error: `no Area ${area}` }; }
    const value = await setAreaStatus(area, status, body.session ? String(body.session) : null);
    if (value.refused) {
      const names = value.liveSessions.join(", ");
      return { status: 409, code: "live-sessions", error: `${value.liveSessions.length === 1 ? "An agent is" : "Agents are"} live under ${area}: ${names}. Stop ${value.liveSessions.length === 1 ? "it" : "them"} first.`, liveSessions: value.liveSessions };
    }
    await recordCommittedCommand({ operation: status === "active" ? "area-reopen" : `area-${status}`, actorSession: body.session, targetArea: area });
    return { status: 200, value };
  },
  /** Applies validated direct edits and status changes to one Goal. */
  async edit(body) {
    const file = String(body.file ?? "");
    const goal = (await goalsByFile()).get(file);
    if (!goal) return { status: 404, error: `no goal file ${file}` };
    const fields = {};
    let lifecycle = null;
    const actorSession = body.session ? String(body.session).trim() : "";
    const actor = await statusActor(actorSession);
    if (String(body.status ?? "") === "done" && goal.verify && actor === "brain") {
      return markGoalWaitsForCheck(goal, { note: body.note, session: actorSession, operationId: String(body.operationId ?? body.idempotencyKey ?? randomUUID()) });
    }
    if (body.status !== undefined) {
      try { lifecycle = goalStatusChange(goal.status, body.status, body.reason, { actor, verify: goal.verify === true }); }
      catch (error) { return { status: 400, error: String(error.message ?? error), code: error.code ?? "invalid-status" }; }
      fields.status = lifecycle.status;
      if (lifecycle.status === "dropped") fields.wontDoReason = lifecycle.reason;
    }
    for (const key of ["title", "doneWhen", "state"]) if (typeof body[key] === "string") fields[key] = body[key];
    // Julian flags what he checks (D12): only he sets or clears `verify: yes`.
    if (typeof body.verify === "boolean") {
      if (actor !== "julian") return { status: 403, error: "Julian flags what he checks. Only he sets verify on a Goal." };
      fields.verify = body.verify;
    }
    if (!Object.keys(fields).length) return { status: 400, error: "nothing to edit" };
    try {
      let changed;
      let execution = null;
      const operationId = String(body.operationId ?? body.idempotencyKey ?? randomUUID()).trim().slice(0, 128) || randomUUID();
      if (fields.status === "done") {
        changed = await cascadeGoalDone(file, await goalsByFile());
        const remaining = { ...fields };
        delete remaining.status;
        if (Object.keys(remaining).length) await editGoalFile(file, remaining);
      } else if (fields.status === "dropped") {
        const cleanup = await finishGoalExecutions({ goalFiles: [file], reason: "goal-dropped" });
        if (!cleanup.ok) return { status: 503, value: { error: "Worker cleanup failed. Retry the Goal finish.", cleanup } };
        await editGoalFile(file, fields);
        changed = [file, ...cleanup.releasedGoals];
        await closeRequestsForGoals([file], "goal-dropped");
        await recordGoalClosure(goal, "dropped", fields.wontDoReason);
      } else if (fields.status === "parked") {
        execution = await parkGoalExecution(goal, body, operationId);
        if (execution.status !== 200) return { status: execution.status, value: { error: execution.error, code: execution.code, pipeline: execution.pipeline } };
        await editGoalFile(file, fields);
        changed = [file];
      } else if (fields.status === "open" && normalizeGoalStatus(goal.status) === "parked") {
        execution = await reopenGoalExecution(goal, body, operationId);
        if (execution.status !== 200) return { status: execution.status, value: { error: execution.error, code: execution.code, pipeline: execution.pipeline } };
        await editGoalFile(file, fields);
        changed = [file];
      } else {
        await editGoalFile(file, fields);
        changed = [file];
      }
      if (!changed.includes(file)) changed.unshift(file);
      if (["done", "dropped", "parked"].includes(fields.status)) await removeGoalPresentations(PRESENTATIONS_ROOT, goal);
      const what = fields.status === "done" ? "done" : fields.status === "dropped" ? "marked won't do" : fields.status === "parked" ? "parked" : fields.status === "open" ? "reopened" : fields.verify === true ? "flagged for Julian to check" : fields.verify === false ? "unflagged" : "edited";
      await vaultCommit(changed, `update: ${goal.area} goal ${goal.slug} ${what} in tree`, goal.area, body.session ? String(body.session) : null);
      if (lifecycle?.leftVerify) await forgetCheckNotification(goal);
      if (fields.status === "parked" && execution?.sourceTarget) {
        execution.detached = await settleParkedGoalSession(goal, execution.sourceTarget, operationId)
          .catch((error) => ({ kind: "preserved", detail: `Goal parked; exact worker retirement needs retry: ${String(error.message ?? error)}` }));
      }
      await recordCommittedCommand({ operation: fields.status === "done" ? "goal-done" : fields.status === "dropped" ? "goal-wont-do" : fields.status === "parked" ? "goal-park" : fields.status === "open" ? "goal-reopen" : "goal-edit", actorSession: body.session, targetArea: goal.area, goal: goal.slug, operationId });
      return { status: 200, value: { ok: true, status: fields.status ?? lifecycle?.status ?? goal.status, ...(execution?.pipeline ? { pipeline: execution.pipeline } : {}), ...(execution?.detached ? { detached: execution.detached } : {}) } };
    } catch (error) {
      if (error.cleanup) return { status: 503, value: { error: error.message, cleanup: error.cleanup } };
      return serverError(error);
    }
  },
  /** Retries one server-derived cleanup failure for an already-finished Goal. */
  async cleanup(body) {
    const file = String(body.file ?? "");
    const goal = (await goalsByFile()).get(file);
    if (!goal) return { status: 404, error: `no goal file ${file}` };
    if (!["done", "dropped"].includes(goal.status)) return { status: 409, error: `goal is ${goal.status}` };
    const cleanup = await finishGoalExecutions({ goalFiles: [file], reason: goal.status === "dropped" ? "goal-dropped" : "goal-done" });
    if (cleanup.ok && cleanup.releasedGoals.length) await vaultCommit(cleanup.releasedGoals, `update: ${goal.area} release Goals from finished worker`, goal.area, null);
    return cleanup.ok ? { status: 200, value: { cleanup } } : { status: 503, value: { error: "Worker cleanup failed. Retry the cleanup.", cleanup } };
  },
});

/**
 * Who asks for a Goal status: `brain` for a live Area brain session, `worker`
 * for a Goal session, else `julian` (the browser, or his own shell).
 */
async function statusActor(session) {
  if (!session) return "julian";
  if (await liveCallingBrain(session)) return "brain";
  const live = (await listSessions()).find((item) => item.name === session);
  return live?.kind === "goal" ? "worker" : "julian";
}

/**
 * A brain's done on a Goal Julian flagged `verify: yes` (D13): the Goal
 * waits for him as Check it. Its worker is retired the way done retires
 * one, the session is cleared, the brain's note goes into State, and Julian
 * gets his one notification.
 */
async function markGoalWaitsForCheck(goal, { note = "", session = "", operationId = "" } = {}) {
  const cleanup = await finishGoalExecutions({ goalFiles: [goal.file], reason: "goal-done" });
  if (!cleanup.ok) return { status: 503, value: { error: "Worker cleanup failed. Retry the Goal finish.", cleanup } };
  const words = oneLine(note);
  const state = words ? `The brain marked this done: ${words} It waits for Julian to check it.` : "The brain marked this done. It waits for Julian to check it.";
  await editGoalFile(goal.file, { status: "verify", state });
  await vaultCommit([goal.file, ...cleanup.releasedGoals], `update: ${goal.area} goal ${goal.slug} waits for Julian to check it`, goal.area, session || null);
  await notifyJulianOnce(goal);
  await recordCommittedCommand({ operation: "goal-verify", actorSession: session, targetArea: goal.area, goal: goal.slug, operationId });
  return { status: 200, value: { ok: true, status: "verify" } };
}

/**
 * Sends the Check it notification once per entry into verify. The Goal's
 * queue record remembers it as `verifyNotifiedAt`, so a repeated transition
 * cannot notify twice. A test server sends nothing.
 */
async function notifyJulianOnce(goal) {
  const record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
  if (record?.verifyNotifiedAt) return;
  if (process.env.AGENT_SHELL_TEST_NO_LAUNCH !== "1") await notifyGoalWaitsForCheck({ file: goal.file, area: goal.area, title: goal.title });
  if (record) {
    record.verifyNotifiedAt = new Date().toISOString();
    await writePipeline(PIPELINES_ROOT, record);
  }
}

/** Removes the Check it notification when a Goal leaves verify, so its next entry notifies again. */
async function forgetCheckNotification(goal) {
  if (process.env.AGENT_SHELL_TEST_NO_LAUNCH !== "1") await removeGoalCheckNotification(goal.file);
  const record = await readPipeline(PIPELINES_ROOT, goal.area, goal.slug);
  if (record?.verifyNotifiedAt) {
    record.verifyNotifiedAt = null;
    await writePipeline(PIPELINES_ROOT, record);
  }
}

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
  const operationId = String(req.headers["x-tangent-operation-id"] ?? randomUUID()).slice(0, 128);
  req.tangentOperationId = operationId;
  res.setHeader("x-tangent-operation-id", operationId);
  try {
    if (url.pathname === "/api/health" && req.method === "GET") {
      sendJson(res, 200, { ok: true, service: "tangent-agent-shell-controller", role: IS_CONTROLLER ? "controller" : "standalone", boot: BOOT_ID, instanceId: INSTANCE_ID, pid: process.pid });
      return;
    }
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
        if (res.statusCode < 400) {
          sessionObservation.invalidate();
          if (["/api/areas", "/api/goals", "/api/idea", "/api/document", "/api/pipelines", "/api/brains", "/api/launch", "/api/work"].some((prefix) => url.pathname.startsWith(prefix))) {
            vaultProjection.invalidate();
          }
          stateEvents.changed(url.pathname);
        }
      });
    }
    const refusal = await refuseWorkerMutation(req, url);
    if (refusal) {
      sendJson(res, 403, { error: refusal });
      return;
    }
    if (await shellStateRoutes.handle(req, res, url)) return;
    if (await brainRoutes.handle(req, res, url)) return;
    if (await pipelineRoutes.handle(req, res, url)) return;
    if (await agentRoutes.handle(req, res, url)) return;
    if (await areaRoutes.handle(req, res, url)) return;
    if (await programRoutes.handle(req, res, url)) return;
    if (await processRoutes.handle(req, res, url)) return;
    if (await goalPresentationRoutes.handle(req, res, url)) return;
    if (await documentRoutes.handle(req, res, url)) return;
    if (await shellControlRoutes.handle(req, res, url)) return;
    if (await voiceRoutes.handle(req, res, url)) return;
    if (await goalQueryRoutes.handle(req, res, url)) return;
    if (await launchRoutes.handle(req, res, url)) return;
    if (await workMutationRoutes.handle(req, res, url)) return;
    await serveStaticAsset(url, res, here);
  } catch (error) {
    console.error(`request ${req.method} ${url.pathname} operation=${operationId}:`, error?.stack ?? error);
    if (!res.headersSent) sendJson(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : "Agent Shell could not complete the request.", operationId });
    else res.end();
  }
});

server.headersTimeout = Number(process.env.TANGENT_HTTP_HEADERS_TIMEOUT_MS ?? 10_000);
server.requestTimeout = Number(process.env.TANGENT_HTTP_REQUEST_TIMEOUT_MS ?? 30_000);
server.keepAliveTimeout = Number(process.env.TANGENT_HTTP_KEEPALIVE_TIMEOUT_MS ?? 5_000);
server.maxRequestsPerSocket = Number(process.env.TANGENT_HTTP_MAX_REQUESTS_PER_SOCKET ?? 1_000);
server.on("clientError", (error, socket) => {
  console.error("agent-shell client error:", error?.code ?? error?.message ?? error);
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});
server.on("error", (error) => {
  console.error("agent-shell listener error:", error?.code ?? error?.message ?? error);
  // A handled listen error must still end this generation so its supervisor
  // can probe the actual owner and back off. Remaining alive would be a
  // healthy-looking process with no public listener.
  if (!server.listening) setImmediate(() => process.exit(1));
});

if (!IS_CONTROLLER) {
  attachTerminalTransport(server, {
    port: PORT,
    workspace: WORKSPACE,
    chatSession: CHAT_SESSION,
    chatCommand: withDefaultModel(agentCmd),
    prepareSession: prepareTerminalSession,
  });
}

// Every Area has its note and its AGENTS.md links before the first request,
// so a brain that starts at once opens on a complete chain.
await sweepAreaNoteLinks().catch((err) => console.error("area note links:", err.message ?? err));

server.listen(PORT, HOST, () => {
  const address = server.address();
  const listeningPort = typeof address === "object" && address ? address.port : PORT;
  console.log(`agent-shell controller: http://${HOST}:${listeningPort} instance=${INSTANCE_ID}`);
  console.log(`  orchestrator session "${CHAT_SESSION}" runs: ${agentCmd}`);
  console.log(`  workspace: ${WORKSPACE}`);
  if (IS_CONTROLLER && process.send) {
    process.send({ type: "agent-shell-ready", port: listeningPort, boot: BOOT_ID, instanceId: INSTANCE_ID, pid: process.pid });
    const heartbeat = setInterval(() => process.send?.({ type: "agent-shell-heartbeat", boot: BOOT_ID, at: Date.now() }), 1_000);
    heartbeat.unref();
  }
  runtimeScheduler.wake();
  if (!IS_CONTROLLER && !process.env.AGENT_SHELL_NO_OPEN) openStandaloneWindow();
  // The transient notice queue died with the last process; its inbox did not.
  // Generic agent messages were hydrated from their own durable queue above.
  /** Reports a failed flush without stopping the server. */
  const flushFailed = (err) => console.error("brain notices:", err.message ?? err);
  flushBrainNotices().catch(flushFailed);
  // A prompt armed by the last process is still waiting on disk if its
  // harness had not left the shell yet.
  rearmPersistedPrompts().catch((err) => console.error("armed prompts:", err.message ?? err));
  backfillClosureMilestones().catch((err) => console.error("milestone backfill:", err.message ?? err));
  resumeAttemptReplacements().catch((err) => console.error("replacement resume:", err.message ?? err));
});

if (IS_CONTROLLER) process.once("disconnect", () => process.exit(0));

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
