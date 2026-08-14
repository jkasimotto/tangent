import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runAgentCli } from "@tangent/agent-runtime/agent";
import { loadNotifyConfig, notify } from "@tangent/agent-runtime/notify";

import {
  REVIEWED_BUILD_STEPS,
  builtInReviewedBindings,
  selectReviewedBindings
} from "./program.js";
import { executeReviewedStepAttempt } from "./attempt.js";
import { validateAllReviewedSessions, validateReviewedSession } from "./prompt.js";
import {
  changedSnapshotPaths,
  repositoryDiff,
  repositoryRevision,
  repositorySnapshot,
  snapshotIdentity
} from "./repository.js";
import { createReviewedRunStore, type ReviewedRunStore } from "./store.js";
import type {
  ReviewedAgentBinding,
  ReviewedAreaDefaults,
  ReviewedEngineOptions,
  ReviewedProgramView,
  ReviewedRun,
  ReviewedRunControl,
  ReviewedRunner,
  ReviewedSessionChoice,
  ReviewedStepState,
  StartReviewedRunInput
} from "./types.js";
import { listReviewedGoals, loadReviewedAreaPresets, loadReviewedGoalContext } from "./vault.js";

export class ReviewedBuildEngine {
  readonly treesRoot: string;
  readonly store: ReviewedRunStore;
  readonly fallbackRepository?: string;
  readonly runner: ReviewedRunner;
  readonly now: () => Date;
  private readonly notifier?: (input: { kind: "complete" | "needs_attention"; run: ReviewedRun }) => void | Promise<void>;
  private readonly active = new Map<string, { controller: AbortController; promise: Promise<void> }>();

  constructor(options: ReviewedEngineOptions = {}) {
    this.treesRoot = options.treesRoot || process.env.TANGENT_TREES_ROOT || path.join(os.homedir(), ".tangent", "trees");
    this.store = createReviewedRunStore(options.loopsRoot || process.env.TANGENT_LOOPS_ROOT || path.join(os.homedir(), ".tangent", "loops"));
    this.fallbackRepository = options.fallbackRepository;
    this.runner = options.runner || runAgentCli;
    this.now = options.now || (() => new Date());
    this.notifier = options.notifier === false
      ? undefined
      : options.notifier || (options.runner ? undefined : defaultRunNotifier);
  }

  /** Recovers Run records whose owning server stopped during an active attempt. */
  async initialize(): Promise<void> {
    for (const run of await this.store.listRuns()) {
      if (run.status !== "running") continue;
      const step = run.steps.find((item) => item.status === "running");
      const attempt = [...(step?.attempts || [])].reverse().find((item) => item.status === "running");
      const at = this.timestamp();
      if (attempt) {
        attempt.status = "interrupted";
        attempt.endedAt = at;
        attempt.error = "The process ended before this attempt returned a handoff.";
      }
      if (step) step.status = "stopped";
      run.status = "needs_attention";
      run.attention = {
        kind: "interrupted",
        stepId: step?.id || run.currentStepId || "unknown",
        message: "The Tangent process ended during this step. Resume to start a new attempt.",
        artifactPaths: attempt?.artifacts.map((artifact) => artifact.path) || [],
        at
      };
      run.updatedAt = at;
      await this.store.saveRun(run);
    }
  }

  /** Lists Goals that can start a reviewed build. */
  listGoals() {
    return listReviewedGoals(this.treesRoot);
  }

  /** Returns the built-in Program and any saved defaults for one Area. */
  async program(areaPath?: string): Promise<ReviewedProgramView> {
    const defaults = areaPath ? await this.store.loadDefaults(areaPath) : undefined;
    const roles = areaPath
      ? selectReviewedBindings(await loadReviewedAreaPresets(this.treesRoot, areaPath))
      : builtInReviewedBindings();
    return {
      id: "reviewed-build",
      name: "Reviewed build",
      version: 1,
      description: "Design, independent review, implementation planning, implementation, review, and one response-and-fix pass.",
      steps: REVIEWED_BUILD_STEPS,
      defaults,
      bindings: Object.fromEntries(REVIEWED_BUILD_STEPS.map((step) => [step.id, defaults?.bindings[step.id] || roles[step.defaultBinding]])),
      sessions: Object.fromEntries(REVIEWED_BUILD_STEPS.map((step) => [step.id, defaults?.sessions[step.id] || { mode: "fresh" }]))
    };
  }

  /** Lists durable Runs newest first. */
  listRuns(): Promise<ReviewedRun[]> {
    return this.store.listRuns();
  }

  /** Loads one durable Run. */
  getRun(runId: string): Promise<ReviewedRun> {
    return this.store.loadRun(runId);
  }

  /** Creates and starts one Goal-bound Reviewed build Run. */
  async start(input: StartReviewedRunInput): Promise<ReviewedRun> {
    const context = await loadReviewedGoalContext({
      treesRoot: this.treesRoot,
      goalPath: input.goalPath,
      fallbackRepository: this.fallbackRepository
    });
    if (["done", "dropped"].includes(context.goal.status)) throw new Error("A completed or dropped Goal cannot start a new Run.");
    const [revision, baseline, saved] = await Promise.all([
      repositoryRevision(context.repository),
      repositorySnapshot(context.repository),
      this.store.loadDefaults(context.goal.areaPath)
    ]);
    const roles = selectReviewedBindings(context.presets);
    const steps: ReviewedStepState[] = REVIEWED_BUILD_STEPS.map((definition) => ({
      ...definition,
      status: "pending",
      binding: cloneBinding(input.bindings?.[definition.id] || saved?.bindings[definition.id] || roles[definition.defaultBinding]),
      session: cloneSession(input.sessions?.[definition.id] || saved?.sessions[definition.id] || { mode: "fresh" }),
      attempts: []
    }));
    validateAllReviewedSessions(steps);
    const at = this.timestamp();
    const run: ReviewedRun = {
      schema: "reviewed-build.run.v1",
      id: this.store.createId(this.now()),
      program: { id: "reviewed-build", name: "Reviewed build", version: 1 },
      status: "queued",
      createdAt: at,
      updatedAt: at,
      areaPath: context.goal.areaPath,
      goalPath: context.goal.path,
      goalTitle: context.goal.title,
      goalDoneWhen: context.goal.doneWhen,
      repository: { root: context.repository, ...revision, baseline },
      originalRequest: context.goalText,
      context: context.contextText,
      sources: context.sources,
      steps,
      decisions: []
    };
    await this.store.saveRun(run);
    this.queue(run.id);
    return run;
  }

  /** Updates a pending step without changing the saved Program or earlier attempts. */
  async updatePendingStep(runId: string, stepId: string, update: {
    binding?: ReviewedAgentBinding;
    session?: ReviewedSessionChoice;
  }): Promise<ReviewedRun> {
    const run = await this.store.loadRun(runId);
    const step = requiredStep(run, stepId);
    if (step.status !== "pending") throw new Error("Only a pending step can change its agent or session.");
    if (update.binding) step.binding = cloneBinding(update.binding);
    if (update.session) step.session = cloneSession(update.session);
    validateReviewedSession(run.steps, step);
    run.updatedAt = this.timestamp();
    await this.store.saveRun(run);
    return run;
  }

  /** Saves one Area's current step choices as its Reviewed build defaults. */
  async saveAreaDefaults(areaPath: string, input: {
    bindings: Record<string, ReviewedAgentBinding>;
    sessions: Record<string, ReviewedSessionChoice>;
  }): Promise<ReviewedAreaDefaults> {
    const steps = REVIEWED_BUILD_STEPS.map((definition) => ({
      ...definition,
      status: "pending" as const,
      binding: cloneBinding(input.bindings[definition.id]),
      session: cloneSession(input.sessions[definition.id] || { mode: "fresh" as const }),
      attempts: []
    }));
    if (steps.some((step) => !step.binding)) throw new Error("Every Program step needs an agent binding.");
    validateAllReviewedSessions(steps);
    const defaults: ReviewedAreaDefaults = {
      schema: "reviewed-build.defaults.v1",
      areaPath,
      bindings: Object.fromEntries(steps.map((step) => [step.id, step.binding])),
      sessions: Object.fromEntries(steps.map((step) => [step.id, step.session])),
      updatedAt: this.timestamp()
    };
    await this.store.saveDefaults(defaults);
    return defaults;
  }

  /** Stops, resumes, or retries one durable Run. */
  async control(runId: string, control: ReviewedRunControl): Promise<ReviewedRun> {
    if (control.action === "stop") return this.stop(runId);
    const run = await this.store.loadRun(runId);
    if (run.status === "complete") throw new Error("A complete Run cannot resume.");
    if (this.active.has(runId)) throw new Error("The Run already has an active step.");
    const step = run.steps.find((item) => item.id === run.currentStepId) || run.steps.find((item) => item.status !== "complete");
    if (!step) throw new Error("The Run has no incomplete step.");
    if (run.attention?.kind === "judgment") {
      const answer = control.decision?.trim();
      if (!answer) throw new Error("Answer the judgment question before resuming.");
      run.decisions.push({ stepId: step.id, question: run.attention.question || run.attention.message, answer, at: this.timestamp() });
    }
    step.status = "pending";
    run.status = "queued";
    run.attention = undefined;
    run.currentStepId = step.id;
    run.updatedAt = this.timestamp();
    await this.store.saveRun(run);
    this.queue(runId);
    return run;
  }

  /** Waits until the current background attempt for a Run settles. */
  async waitForIdle(runId: string): Promise<void> {
    await this.active.get(runId)?.promise;
  }

  /** Reads the tail of the active or latest attempt log for the Run detail view. */
  async latestOutput(runId: string, maxCharacters = 12_000): Promise<string> {
    const run = await this.store.loadRun(runId);
    const step = run.steps.find((item) => item.id === run.currentStepId) || [...run.steps].reverse().find((item) => item.attempts.length);
    const log = step?.attempts.at(-1)?.logFile;
    if (!log) return "";
    const text = await readFile(log, "utf8").catch(() => "");
    return text.slice(-maxCharacters);
  }

  /** Returns the live repository diff for a Run. */
  async diff(runId: string): Promise<string> {
    const run = await this.store.loadRun(runId);
    return repositoryDiff(run.repository.root);
  }

  /** Starts one background state-machine task unless it is already active. */
  private queue(runId: string): void {
    if (this.active.has(runId)) return;
    const controller = new AbortController();
    const promise = this.execute(runId, controller.signal)
      .catch((error) => this.recordCoordinatorFailure(runId, error))
      .finally(() => this.active.delete(runId));
    this.active.set(runId, { controller, promise });
  }

  /** Converts an unexpected coordinator failure into durable attention state. */
  private async recordCoordinatorFailure(runId: string, error: unknown): Promise<void> {
    const run = await this.store.loadRun(runId);
    if (run.status === "complete" || run.status === "stopped") return;
    const step = run.steps.find((item) => item.id === run.currentStepId) || run.steps.find((item) => item.status !== "complete");
    if (step && step.status === "pending") step.status = "failed";
    run.status = "needs_attention";
    run.attention = {
      kind: "error",
      stepId: step?.id || "unknown",
      message: errorMessage(error),
      artifactPaths: [],
      at: this.timestamp()
    };
    run.updatedAt = this.timestamp();
    await this.store.saveRun(run);
    this.announce("needs_attention", run);
  }

  /** Executes incomplete steps in order until completion or attention. */
  private async execute(runId: string, signal: AbortSignal): Promise<void> {
    for (;;) {
      const run = await this.store.loadRun(runId);
      if (["stopped", "needs_attention", "complete"].includes(run.status)) return;
      const step = run.steps.find((item) => item.status !== "complete");
      if (!step) {
        await this.finish(run);
        return;
      }
      if (step.status !== "pending") return;
      await executeReviewedStepAttempt({
        run,
        step,
        signal,
        runner: this.runner,
        store: this.store,
        /** Returns the engine clock value. */
        timestamp: () => this.timestamp(),
        /** Announces that the Run needs user attention. */
        onAttention: (waiting) => this.announce("needs_attention", waiting)
      });
    }
  }

  /** Stops the active step and preserves all completed steps. */
  private async stop(runId: string): Promise<ReviewedRun> {
    const run = await this.store.loadRun(runId);
    if (run.status === "complete") return run;
    run.status = "stopped";
    run.attention = undefined;
    const step = run.steps.find((item) => item.status === "running");
    if (step) step.status = "stopped";
    run.updatedAt = this.timestamp();
    await this.store.saveRun(run);
    this.active.get(runId)?.controller.abort(new Error("Stopped by the user."));
    return run;
  }

  /** Finalizes a Run after its eighth and final step. */
  private async finish(run: ReviewedRun): Promise<void> {
    const snapshot = await repositorySnapshot(run.repository.root);
    const changedPaths = changedSnapshotPaths(run.repository.baseline, snapshot);
    run.final = {
      changedPaths,
      diffIdentity: snapshotIdentity(snapshot, changedPaths),
      proof: run.steps.flatMap((step) => step.attempts.filter((attempt) => attempt.status === "complete").flatMap((attempt) => attempt.proof))
    };
    run.status = "complete";
    run.currentStepId = undefined;
    run.attention = undefined;
    run.updatedAt = this.timestamp();
    await this.store.saveRun(run);
    this.announce("complete", run);
  }

  /** Returns an ISO timestamp from the injected clock. */
  private timestamp(): string {
    return this.now().toISOString();
  }

  /** Sends one best-effort Run notification without delaying the state machine. */
  private announce(kind: "complete" | "needs_attention", run: ReviewedRun): void {
    try { void this.notifier?.({ kind, run }); } catch { /* Notifications never change Run state. */ }
  }
}

/** Creates the durable Reviewed build engine. */
export function createReviewedBuildEngine(options: ReviewedEngineOptions = {}): ReviewedBuildEngine {
  return new ReviewedBuildEngine(options);
}


/** Returns one required step. */
function requiredStep(runOrSteps: ReviewedRun | ReviewedStepState[], stepId: string): ReviewedStepState {
  const steps = Array.isArray(runOrSteps) ? runOrSteps : runOrSteps.steps;
  const step = steps.find((item) => item.id === stepId);
  if (!step) throw new Error(`Unknown Reviewed build step: ${stepId}`);
  return step;
}


/** Clones one serializable binding before it becomes Run state. */
function cloneBinding(binding: ReviewedAgentBinding): ReviewedAgentBinding {
  if (!binding || !binding.id || !binding.label || !binding.command || !binding.provider) throw new Error("An agent binding needs an id, label, provider, and command.");
  return JSON.parse(JSON.stringify(binding)) as ReviewedAgentBinding;
}

/** Clones one session choice before it becomes Run state. */
function cloneSession(session: ReviewedSessionChoice): ReviewedSessionChoice {
  return session.mode === "continue" ? { mode: "continue", fromStepId: session.fromStepId } : { mode: "fresh" };
}

/** Formats an unknown failure for durable attention state. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Sends the configured desktop notification for a completed or waiting Run. */
async function defaultRunNotifier(input: { kind: "complete" | "needs_attention"; run: ReviewedRun }): Promise<void> {
  const config = loadNotifyConfig();
  const enabled = input.kind === "complete" ? config.events.done : config.events.needsInput;
  if (!enabled) return;
  const body = input.kind === "complete"
    ? "Reviewed build finished with final proof."
    : input.run.attention?.question || input.run.attention?.message || "Reviewed build needs attention.";
  await notify({ title: input.run.goalTitle, body }, config);
}
