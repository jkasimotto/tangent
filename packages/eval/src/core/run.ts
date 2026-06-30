import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { changedFiles, currentCommit, statusPorcelain } from "@tangent/repo/git";
import { commitAll } from "@tangent/repo/worktree";

import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import type { EvalAgentEvent, EvalAgentTelemetry } from "../types/telemetry.js";
import { runAgent } from "../runners/index.js";
import { implementationPrompt, planPrompt } from "./phase-prompts.js";
import { saveRunManifest } from "./run-store.js";

export type EvalRunProgressEvent = {
  type:
    | "run.started"
    | "run.completed"
    | "run.cancelled"
    | "variant.started"
    | "variant.completed"
    | "variant.failed"
    | "variant.cancelled"
    | "phase.started"
    | "phase.agent-started"
    | "phase.output"
    | "phase.completed"
    | "phase.failed"
    | "phase.cancelled";
  runId: string;
  at: string;
  caseId?: string;
  variantId?: string;
  phase?: "plan" | "implement";
  stream?: "stdout" | "stderr";
  chunk?: string;
  message?: string;
};

export type RunPreparedEvalOptions = {
  signal?: AbortSignal;
  onProgress?: (event: EvalRunProgressEvent) => void;
};

type SaveManifest = () => Promise<void>;

type VariantRunOutcome =
  | { status: "done"; variant: EvalRunVariantState }
  | { status: "failed"; variant: EvalRunVariantState; error: Error }
  | { status: "cancelled"; variant: EvalRunVariantState; error: Error };

export class EvalRunCancelledError extends Error {
  constructor(message = "Eval run cancelled.") {
    super(message);
    this.name = "EvalRunCancelledError";
  }
}

/** Executes all automatic variants in a prepared eval run concurrently and throws on failure. */
export async function runPreparedEval(manifest: EvalRunManifest, options: RunPreparedEvalOptions = {}): Promise<EvalRunManifest> {
  const saveManifest = createQueuedManifestSaver(manifest);
  emit(manifest, options, { type: "run.started" });

  const automaticVariants = manifest.variants.filter((variant) => variant.agent.kind !== "manual");
  const outcomes = await Promise.all(automaticVariants.map((variant) => runVariantAndCapture(manifest, variant, options, saveManifest)));
  const cancellation = outcomes.find((outcome): outcome is Extract<VariantRunOutcome, { status: "cancelled" }> => outcome.status === "cancelled");
  if (cancellation) {
    emit(manifest, options, { type: "run.cancelled", message: cancellation.error.message });
    throw new EvalRunCancelledError(cancellation.error.message);
  }

  const failures = outcomes
    .filter((outcome): outcome is Extract<VariantRunOutcome, { status: "failed" }> => outcome.status === "failed")
    .map((outcome) => `${outcome.variant.caseId}/${outcome.variant.variantId}: ${outcome.error.message}`);
  if (failures.length > 0) throw new Error(`Eval run failed:\n${failures.join("\n")}`);
  emit(manifest, options, { type: "run.completed" });
  return manifest;
}

/** Runs a single variant and normalises any thrown error into a typed outcome object. */
async function runVariantAndCapture(
  manifest: EvalRunManifest,
  variant: EvalRunVariantState,
  options: RunPreparedEvalOptions,
  saveManifest: SaveManifest
): Promise<VariantRunOutcome> {
  try {
    throwIfCancelled(options.signal);
    await runVariant(manifest, variant, options, saveManifest);
    return { status: "done", variant };
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (isCancellation(normalized, options.signal)) {
      if (variant.status !== "cancelled") {
        variant.status = "cancelled";
        variant.error = normalized.message;
        variant.endedAt = new Date().toISOString();
        await saveManifest();
      }
      emit(manifest, options, {
        type: "variant.cancelled",
        caseId: variant.caseId,
        variantId: variant.variantId,
        message: normalized.message
      });
      return { status: "cancelled", variant, error: normalized };
    }

    variant.status = "failed";
    variant.error = normalized.message;
    variant.endedAt ||= new Date().toISOString();
    await saveManifest();
    emit(manifest, options, {
      type: "variant.failed",
      caseId: variant.caseId,
      variantId: variant.variantId,
      message: normalized.message
    });
    return { status: "failed", variant, error: normalized };
  }
}

/** Executes all phases for a single eval variant, committing results after each phase. */
async function runVariant(manifest: EvalRunManifest, variant: EvalRunVariantState, options: RunPreparedEvalOptions, saveManifest: SaveManifest): Promise<void> {
  throwIfCancelled(options.signal);
  variant.status = "running";
  variant.startedAt ||= new Date().toISOString();
  await saveManifest();
  emit(manifest, options, {
    type: "variant.started",
    caseId: variant.caseId,
    variantId: variant.variantId
  });

  const task = await readFile(variant.promptPath, "utf8");
  let plan = variant.planPath ? await readFile(variant.planPath, "utf8").catch(() => "") : "";

  // Accumulate the agent's activity stream across phases and persist it live, so the Eval UI can draw a
  // growing flame for this config while it runs (headless `claude --print` writes no scannable transcript).
  const telemetryEvents: EvalAgentEvent[] = [];
  let telemetryTotal: number | undefined;
  const writeTelemetry = createQueuedTelemetryWriter(
    path.join(path.dirname(variant.metricsPath), "agent-telemetry.json"),
    () => ({ schema: "eval.agent-telemetry.v1", events: telemetryEvents, tokensTotal: telemetryTotal })
  );

  for (const phase of variant.phases) {
    throwIfCancelled(options.signal);
    if (phase.status === "done") continue;
    phase.status = "running";
    phase.startedAt = new Date().toISOString();
    await saveManifest();
    emit(manifest, options, {
      type: "phase.started",
      caseId: variant.caseId,
      variantId: variant.variantId,
      phase: phase.id
    });

    const phaseBaseCommit = await currentCommit(variant.worktree);
    const prompt = phase.id === "plan" ? planPrompt(task) : implementationPrompt(task, plan);
    if (phase.promptPath) await writeFile(phase.promptPath, prompt, "utf8");
    let output: string;
    phase.agentStartedAt = new Date().toISOString();
    await saveManifest();
    emit(manifest, options, {
      type: "phase.agent-started",
      caseId: variant.caseId,
      variantId: variant.variantId,
      phase: phase.id
    });
    try {
      output = await runAgent({
        agent: variant.agent,
        prompt,
        cwd: variant.executionCwd,
        sandbox: phase.mode || (phase.id === "plan" ? "read-only" : "workspace-write"),
        env: {
          TANGENT_EVAL_RUN_ID: manifest.id,
          TANGENT_EVAL_CASE_ID: variant.caseId,
          TANGENT_EVAL_VARIANT_ID: variant.variantId,
          TANGENT_EVAL_PHASE: phase.id
        },
        signal: options.signal,
        /** Appends an agent event to the telemetry buffer and flushes to disk. */
        onEvent: (event) => {
          telemetryEvents.push(event);
          void writeTelemetry();
        },
        /** Accumulates token usage and flushes the telemetry sidecar to disk. */
        onUsageTotal: (total) => {
          telemetryTotal = (telemetryTotal || 0) + total;
          void writeTelemetry();
        },
        /** Forwards an agent output chunk as a phase.output progress event. */
        onOutput: (chunk) => emit(manifest, options, {
          type: "phase.output",
          caseId: variant.caseId,
          variantId: variant.variantId,
          phase: phase.id,
          stream: chunk.stream,
          chunk: chunk.chunk
        })
      });
    } catch (error) {
      phase.agentEndedAt = new Date().toISOString();
      phase.agentDurationMs = durationMs(phase.agentStartedAt, phase.agentEndedAt);
      phase.endedAt = phase.agentEndedAt;
      const cancelled = isCancellation(error, options.signal);
      phase.status = cancelled ? "cancelled" : "failed";
      phase.error = (error as Error).message;
      variant.status = cancelled ? "cancelled" : "failed";
      variant.error = (error as Error).message;
      variant.endedAt = phase.endedAt;
      await saveManifest();
      emit(manifest, options, {
        type: cancelled ? "phase.cancelled" : "phase.failed",
        caseId: variant.caseId,
        variantId: variant.variantId,
        phase: phase.id,
        message: (error as Error).message
      });
      throw error;
    }
    phase.agentEndedAt = new Date().toISOString();
    phase.agentDurationMs = durationMs(phase.agentStartedAt, phase.agentEndedAt);

    if (phase.id === "plan") {
      plan = output.trim();
      const repoPlanPath = path.join(variant.worktree, "evals", "runs", manifest.id, variant.caseId, variant.variantId, "PLAN.md");
      const artifactPlanPath = path.join(path.dirname(variant.promptPath), "plan.md");
      await mkdir(path.dirname(repoPlanPath), { recursive: true });
      await writeFile(repoPlanPath, `${plan}\n`, "utf8");
      await writeFile(artifactPlanPath, `${plan}\n`, "utf8");
      variant.planPath = artifactPlanPath;
      phase.outputPath = artifactPlanPath;
      phase.commit = await commitAll(variant.worktree, `eval: plan ${variant.caseId} / ${variant.variantId}`, { allowEmpty: true });
      variant.planCommit = phase.commit;
    } else {
      const dirty = await statusPorcelain(variant.worktree);
      const changed = await changedFiles(variant.worktree, phaseBaseCommit).catch(() => []);
      if (dirty || changed.length === 0) {
        phase.commit = await commitAll(variant.worktree, `eval: implement ${variant.caseId} / ${variant.variantId}`, { allowEmpty: changed.length === 0 && !dirty });
      } else {
        phase.commit = await currentCommit(variant.worktree);
      }
      variant.implementationCommit = phase.commit;
      const outputPath = path.join(path.dirname(variant.promptPath), "implementation-output.md");
      await writeFile(outputPath, `${output.trim()}\n`, "utf8");
      phase.outputPath = outputPath;
    }

    phase.endedAt = new Date().toISOString();
    phase.status = "done";
    await saveManifest();
    emit(manifest, options, {
      type: "phase.completed",
      caseId: variant.caseId,
      variantId: variant.variantId,
      phase: phase.id
    });
  }

  variant.endedAt = new Date().toISOString();
  variant.status = "done";
  await saveManifest();
  emit(manifest, options, {
    type: "variant.completed",
    caseId: variant.caseId,
    variantId: variant.variantId
  });
}

/** Computes the duration in milliseconds between two ISO timestamp strings. */
function durationMs(startedAt?: string, endedAt?: string): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const started = new Date(startedAt).getTime();
  const ended = new Date(endedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(ended)) return undefined;
  return Math.max(0, ended - started);
}

/** Returns a queued save function that serialises manifest writes to prevent interleaved files. */
function createQueuedManifestSaver(manifest: EvalRunManifest): SaveManifest {
  let queue = Promise.resolve();
  return () => {
    const save = queue.catch(() => undefined).then(() => saveRunManifest(manifest));
    queue = save;
    return save;
  };
}

/** Serializes telemetry-sidecar writes so frequent activity events never interleave a partial file. */
function createQueuedTelemetryWriter(filePath: string, build: () => EvalAgentTelemetry): () => Promise<void> {
  let queue = Promise.resolve();
  return () => {
    const write = queue.catch(() => undefined).then(() => writeFile(filePath, `${JSON.stringify(build(), null, 2)}\n`, "utf8"));
    queue = write;
    return write;
  };
}

/** Returns true if an error represents an eval run cancellation or process abort. */
export function isEvalRunCancelled(error: unknown): boolean {
  return error instanceof EvalRunCancelledError || isProcessAborted(error);
}

/** Emits a run progress event with the run id and current timestamp attached. */
function emit(manifest: EvalRunManifest, options: RunPreparedEvalOptions, event: Omit<EvalRunProgressEvent, "runId" | "at">): void {
  options.onProgress?.({
    runId: manifest.id,
    at: new Date().toISOString(),
    ...event
  });
}

/** Throws an EvalRunCancelledError if the abort signal has been triggered. */
function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EvalRunCancelledError();
}

/** Returns true if the error is a cancellation or the abort signal is set. */
function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  return isEvalRunCancelled(error) || Boolean(signal?.aborted);
}

/** Returns true if the error is a ProcessAbortedError from the agent runtime. */
function isProcessAborted(error: unknown): boolean {
  return error instanceof Error && error.name === "ProcessAbortedError";
}
