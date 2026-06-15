import { collectEval } from "../core/metrics.js";
import { loadEvalSpec } from "../core/config.js";
import { isEvalRunCancelled, runPreparedEval, type EvalRunProgressEvent } from "../core/run.js";
import { prepareEval, type PrepareEvalProgressEvent } from "../core/worktree.js";
import type { EvalUiJobEvent, EvalUiJobView } from "./dto.js";

const maxEvents = 2000;
const maxChunkChars = 12000;

export class EvalJobConflictError extends Error {
  status = 409;

  constructor(message: string) {
    super(message);
    this.name = "EvalJobConflictError";
  }
}

export type EvalJobManager = {
  start(specId: string, specPath: string): EvalUiJobView;
  get(id: string): EvalUiJobView;
  events(id: string, after?: number): EvalUiJobEvent[];
  cancel(id: string): EvalUiJobView;
};

type InternalJob = {
  id: string;
  specId: string;
  status: EvalUiJobView["status"];
  startedAt: string;
  endedAt?: string;
  runId?: string;
  error?: string;
  controller: AbortController;
  events: EvalUiJobEvent[];
  nextSeq: number;
};

export function createEvalJobManager(options: { cwd: string }): EvalJobManager {
  const jobs = new Map<string, InternalJob>();

  return {
    start(specId, specPath) {
      const active = [...jobs.values()].find((job) => job.status === "running");
      if (active) throw new EvalJobConflictError(`Eval run already active: ${active.id}`);
      const job = createJob(specId);
      jobs.set(job.id, job);
      void runJob(job, specPath, options.cwd);
      return jobView(job);
    },
    get(id) {
      return jobView(requiredJob(jobs, id));
    },
    events(id, after = 0) {
      return requiredJob(jobs, id).events.filter((event) => event.seq > after);
    },
    cancel(id) {
      const job = requiredJob(jobs, id);
      if (job.status === "running") {
        append(job, { type: "job.cancel-requested", message: "Cancellation requested." });
        job.controller.abort();
      }
      return jobView(job);
    }
  };
}

function createJob(specId: string): InternalJob {
  return {
    id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    specId,
    status: "running",
    startedAt: new Date().toISOString(),
    controller: new AbortController(),
    events: [],
    nextSeq: 1
  };
}

async function runJob(job: InternalJob, specPath: string, cwd: string): Promise<void> {
  append(job, { type: "job.started", message: "Loading eval spec." });
  try {
    const loaded = await loadEvalSpec(specPath, { invocationCwd: cwd });
    append(job, { type: "spec.loaded", message: loaded.spec.name });
    const prepared = await prepareEval(loaded, {
      signal: job.controller.signal,
      onProgress: (event) => appendPrepareEvent(job, event)
    });
    job.runId = prepared.manifest.id;
    await runPreparedEval(prepared.manifest, {
      signal: job.controller.signal,
      onProgress: (event) => appendRunEvent(job, event)
    });
    append(job, { type: "collect.started", runId: prepared.manifest.id, message: "Collecting metrics." });
    await collectEval(prepared.manifest);
    append(job, { type: "collect.completed", runId: prepared.manifest.id, message: "Metrics collected." });
    job.status = "done";
    job.endedAt = new Date().toISOString();
    append(job, { type: "job.completed", runId: prepared.manifest.id, message: "Eval run completed." });
  } catch (error) {
    const cancelled = job.controller.signal.aborted || isEvalRunCancelled(error);
    job.status = cancelled ? "cancelled" : "failed";
    job.endedAt = new Date().toISOString();
    job.error = (error as Error).message;
    append(job, {
      type: cancelled ? "job.cancelled" : "job.failed",
      runId: job.runId,
      message: (error as Error).message
    });
  }
}

function appendPrepareEvent(job: InternalJob, event: PrepareEvalProgressEvent): void {
  if (event.runId) job.runId = event.runId;
  append(job, {
    type: event.type,
    runId: event.runId,
    caseId: event.caseId,
    variantId: event.variantId,
    message: event.message
  });
}

function appendRunEvent(job: InternalJob, event: EvalRunProgressEvent): void {
  job.runId = event.runId;
  append(job, {
    type: event.type,
    runId: event.runId,
    caseId: event.caseId,
    variantId: event.variantId,
    phase: event.phase,
    stream: event.stream,
    chunk: event.chunk ? event.chunk.slice(-maxChunkChars) : undefined,
    message: event.message
  });
}

function append(job: InternalJob, event: Omit<EvalUiJobEvent, "seq" | "at">): void {
  job.events.push({
    seq: job.nextSeq,
    at: new Date().toISOString(),
    ...event
  });
  job.nextSeq += 1;
  if (job.events.length > maxEvents) job.events.splice(0, job.events.length - maxEvents);
}

function requiredJob(jobs: Map<string, InternalJob>, id: string): InternalJob {
  const job = jobs.get(id);
  if (!job) throw new Error(`Eval job not found: ${id}`);
  return job;
}

function jobView(job: InternalJob): EvalUiJobView {
  return {
    id: job.id,
    specId: job.specId,
    status: job.status,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    runId: job.runId,
    error: job.error,
    eventCount: job.nextSeq - 1
  };
}
