import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { REVIEWED_COMPLETION_SCHEMA, parseReviewedEnvelope } from "./program.js";
import {
  buildReviewedStepPrompt,
  ensureFreshReviewedSession,
  resolveReviewedSession
} from "./prompt.js";
import {
  changedSnapshotPaths,
  repositorySnapshot,
  validateStepHandoff
} from "./repository.js";
import type { ReviewedRunStore } from "./store.js";
import type { ReviewedRun, ReviewedRunner, ReviewedStepState } from "./types.js";

/** Executes one agent attempt, validates its handoff, and persists its result. */
export async function executeReviewedStepAttempt(args: {
  run: ReviewedRun;
  step: ReviewedStepState;
  signal: AbortSignal;
  runner: ReviewedRunner;
  store: ReviewedRunStore;
  timestamp: () => string;
  onAttention: (run: ReviewedRun) => void;
}): Promise<void> {
  const { run, step, signal, runner, store, timestamp } = args;
  const session = resolveReviewedSession(run, step);
  const preSnapshot = await repositorySnapshot(run.repository.root);
  const number = step.attempts.length + 1;
  const attemptId = `${step.id}-${number}`;
  const logFile = store.attemptLog(run.id, step.id, number);
  await mkdir(path.dirname(logFile), { recursive: true });
  await writeFile(logFile, "", "utf8");
  const attempt = {
    id: attemptId,
    number,
    status: "running" as const,
    startedAt: timestamp(),
    logFile,
    artifacts: [],
    proof: [],
    preSnapshot,
    changedPaths: []
  };
  step.attempts.push(attempt);
  step.status = "running";
  run.status = "running";
  run.currentStepId = step.id;
  run.attention = undefined;
  run.updatedAt = timestamp();
  await store.saveRun(run);

  let writes = Promise.resolve();
  let resultText = "";
  let postSnapshot = preSnapshot;
  try {
    const result = await runner({
      agent: {
        provider: step.binding.provider,
        command: step.binding.command,
        loginShell: step.binding.loginShell,
        model: step.binding.model,
        profile: step.binding.profile,
        effort: step.binding.effort,
        permissionMode: step.binding.permissionMode,
        maxTurns: step.binding.maxTurns,
        timeoutMs: step.binding.timeoutMs,
        extraArgs: step.binding.extraArgs,
        env: step.binding.env
      },
      prompt: buildReviewedStepPrompt(run, step),
      cwd: run.repository.root,
      sandbox: "workspace-write",
      session,
      schema: REVIEWED_COMPLETION_SCHEMA,
      signal,
      /** Serializes output chunks into the attempt's durable process log. */
      onOutput: (chunk) => {
        const text = chunk.stream === "stderr" ? `[stderr] ${chunk.chunk}` : chunk.chunk;
        writes = writes.then(() => appendFile(logFile, text, "utf8"));
      }
    });
    resultText = result.text;
    await writes;
    postSnapshot = await repositorySnapshot(run.repository.root);
    const current = await store.loadRun(run.id);
    const currentStep = requiredStep(current, step.id);
    const currentAttempt = requiredAttempt(currentStep, attemptId);
    if (current.status === "stopped" || signal.aborted) {
      currentAttempt.status = "stopped";
      currentAttempt.endedAt = timestamp();
      currentAttempt.output = resultText;
      currentAttempt.postSnapshot = postSnapshot;
      currentAttempt.changedPaths = changedSnapshotPaths(preSnapshot, postSnapshot);
      currentStep.status = "stopped";
      current.updatedAt = timestamp();
      await store.saveRun(current);
      return;
    }
    const envelope = parseReviewedEnvelope(result.structuredOutput ?? result.text);
    ensureFreshReviewedSession(current, currentStep, result.sessionId);
    const handoff = await validateStepHandoff({
      run: current,
      step: currentStep,
      attempt: number,
      envelope,
      before: preSnapshot,
      after: postSnapshot
    });
    currentAttempt.status = envelope.status === "needs_judgment" ? "needs_attention" : "complete";
    currentAttempt.endedAt = timestamp();
    currentAttempt.sessionId = result.sessionId;
    currentAttempt.output = resultText;
    currentAttempt.envelope = envelope;
    currentAttempt.artifacts = handoff.artifacts;
    currentAttempt.proof = envelope.proof;
    currentAttempt.postSnapshot = postSnapshot;
    currentAttempt.changedPaths = handoff.changedPaths;
    if (envelope.status === "needs_judgment") {
      currentStep.status = "needs_attention";
      current.status = "needs_attention";
      current.attention = {
        kind: "judgment",
        stepId: currentStep.id,
        message: envelope.summary,
        question: envelope.question || undefined,
        artifactPaths: handoff.artifacts.map((artifact) => artifact.path),
        at: timestamp()
      };
    } else {
      currentStep.status = "complete";
      current.status = "running";
      current.currentStepId = current.steps.find((item) => item.status !== "complete")?.id;
    }
    current.updatedAt = timestamp();
    await store.saveRun(current);
    if (current.status === "needs_attention") args.onAttention(current);
  } catch (error) {
    await writes.catch(() => undefined);
    postSnapshot = await repositorySnapshot(run.repository.root).catch(() => preSnapshot);
    const current = await store.loadRun(run.id);
    const currentStep = requiredStep(current, step.id);
    const currentAttempt = requiredAttempt(currentStep, attemptId);
    currentAttempt.endedAt = timestamp();
    currentAttempt.output = resultText || currentAttempt.output;
    currentAttempt.postSnapshot = postSnapshot;
    currentAttempt.changedPaths = changedSnapshotPaths(preSnapshot, postSnapshot);
    const stopped = current.status === "stopped" || signal.aborted;
    currentAttempt.status = stopped ? "stopped" : "failed";
    currentAttempt.error = stopped ? "Stopped by the user." : errorMessage(error);
    currentStep.status = stopped ? "stopped" : "failed";
    if (!stopped) {
      current.status = "needs_attention";
      current.attention = {
        kind: "error",
        stepId: currentStep.id,
        message: currentAttempt.error,
        artifactPaths: currentAttempt.artifacts.map((artifact) => artifact.path),
        at: timestamp()
      };
    }
    current.updatedAt = timestamp();
    await store.saveRun(current);
    if (!stopped) args.onAttention(current);
  }
}

/** Returns one required step. */
function requiredStep(run: ReviewedRun, stepId: string): ReviewedStepState {
  const step = run.steps.find((item) => item.id === stepId);
  if (!step) throw new Error(`Unknown Reviewed build step: ${stepId}`);
  return step;
}

/** Returns one required attempt from a step. */
function requiredAttempt(step: ReviewedStepState, attemptId: string) {
  const attempt = step.attempts.find((item) => item.id === attemptId);
  if (!attempt) throw new Error(`Missing attempt: ${attemptId}`);
  return attempt;
}

/** Formats an unknown failure for durable attention state. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
