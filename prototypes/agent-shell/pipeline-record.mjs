// Pipeline record store: one JSON file per Goal under a pipelines root,
// `${root}/${area}/${slug}.json`. Pure module, no tmux, no HTTP. The server
// owns session spawning and status transitions; this module owns the record
// shape, its validation, and the derived questions (which step is current,
// what comes next, what the whole pipeline's status is), so the rules are
// unit-testable without a live shell.

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const PIPELINE_SCHEMA = "agent-pipeline.v1";

const MAX_STEPS = 20;
const MAX_INSTRUCTION_CHARS = 2000;

/** File path of one pipeline record. */
export function pipelinePath(root, area, slug) {
  return path.join(root, area, `${slug}.json`);
}

/** Reads one pipeline record, or null when the file is missing or unparsable. */
export async function readPipeline(root, area, slug) {
  return readRecordFile(pipelinePath(root, area, slug));
}

/** Reads every pipeline record under the root; empty when the root is missing. */
export async function readAllPipelines(root) {
  const files = await walkJsonFiles(root);
  const records = [];
  for (const file of files) {
    const record = await readRecordFile(file);
    if (record) records.push(record);
  }
  return records;
}

/**
 * Writes a record to its path with mkdir -p and an atomic tmp + rename, and
 * stamps updatedAt. Returns the record.
 */
export async function writePipeline(root, record) {
  const target = pipelinePath(root, record.area, record.slug);
  record.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tmp, target);
  return record;
}

/** Deletes one pipeline record; a missing file is not an error. */
export async function deletePipeline(root, area, slug) {
  await rm(pipelinePath(root, area, slug), { force: true });
}

/**
 * Builds a fresh record with every step pending. Throws with the
 * validateSteps message when the steps are invalid.
 */
export function newPipeline({ goal, area, slug, extraFiles = [], steps, now = new Date().toISOString() }) {
  const error = validateSteps(steps);
  if (error) throw new Error(error);
  return {
    schema: PIPELINE_SCHEMA,
    goal,
    area,
    slug,
    createdAt: now,
    updatedAt: now,
    extraFiles: [...extraFiles],
    steps: steps.map((step, position) => normalizeStep(step, position + 1))
  };
}

/**
 * Appends steps to a record whose earlier steps may already have run. The
 * new steps are validated together with the existing ones (numbering and the
 * step cap continue from the record), normalized to pending, and pushed in
 * place. Returns the appended steps. Throws with the validation message.
 * Nothing already in the record changes: finished steps and their handovers
 * are history.
 */
export function appendSteps(record, steps) {
  if (!Array.isArray(steps) || steps.length < 1) throw new Error("append needs at least one step");
  const existing = record?.steps ?? [];
  const error = validateSteps([...existing, ...steps]);
  if (error) throw new Error(error);
  const added = steps.map((step, position) => normalizeStep(step, existing.length + position + 1));
  record.steps = [...existing, ...added];
  return added;
}

/** Step statuses that never change again: the step ran, was skipped, or Julian ended the run. */
const FINAL_STATUSES = new Set(["complete", "skipped", "ended"]);

/**
 * Whether every step has finished (complete, skipped, or ended), so nothing
 * running or pending would carry the pipeline into a step appended now.
 */
export function pipelineFinished(record) {
  const steps = record?.steps ?? [];
  return steps.length > 0 && steps.every((step) => FINAL_STATUSES.has(step.status));
}

/**
 * Ends the run at Julian's word: every running, stopped, or pending step
 * becomes "ended" and keeps its handover, so the Goal falls back to plain
 * open work and the desk never offers Restart for it again. Steps that ran
 * to completion or were skipped are history and stay as they were. Returns
 * the indices that changed; an empty list means nothing was left to end.
 * Appending steps later starts fresh after the ended ones.
 */
export function endPipeline(record, now = new Date().toISOString()) {
  const changed = [];
  for (const step of record?.steps ?? []) {
    if (FINAL_STATUSES.has(step.status)) continue;
    step.status = "ended";
    step.endedAt = now;
    changed.push(step.index);
  }
  if (changed.length) record.updatedAt = now;
  return changed;
}

/** Returns an error string naming the offending step, or null when the steps are valid. */
export function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) {
    return `a pipeline needs 1 to ${MAX_STEPS} steps`;
  }
  for (let position = 0; position < steps.length; position += 1) {
    const step = steps[position] ?? {};
    const index = position + 1;
    const instruction = typeof step.instruction === "string" ? step.instruction.trim() : "";
    if (!instruction) return `step ${index}: instruction is empty`;
    if (instruction.length > MAX_INSTRUCTION_CHARS) {
      return `step ${index}: instruction is longer than ${MAX_INSTRUCTION_CHARS} characters`;
    }
    if (!hasLaunch(step) && !hasCommand(step)) return `step ${index}: needs a launch or a command`;
    if (step.continueFrom !== null && step.continueFrom !== undefined) {
      const from = step.continueFrom;
      if (!Number.isInteger(from) || from < 1 || from > index - 1) {
        return `step ${index}: continueFrom must name an earlier step`;
      }
    }
  }
  return null;
}

/** The step the pipeline is on: first running or stopped, else first pending, else null. */
export function currentStep(record) {
  const steps = record?.steps ?? [];
  return steps.find((step) => step.status === "running" || step.status === "stopped")
    ?? steps.find((step) => step.status === "pending")
    ?? null;
}

/** First pending step after the given index, else null. */
export function nextPendingStep(record, afterIndex) {
  const steps = record?.steps ?? [];
  return steps.find((step) => step.status === "pending" && step.index > afterIndex) ?? null;
}

// A sessions snapshot the server polls tmux for can predate a step or Goal
// binding written moments earlier (spawnGoalSession creates the tmux session
// and writes the binding before the next poll can see it): a reconcile pass
// racing that stale snapshot must not treat the missing session as gone.
export const RECONCILE_GRACE_MS = 30_000;

/**
 * True while `at` (an epoch ms, or NaN/undefined) is recent enough that a
 * sessions snapshot taken around `now` cannot be trusted to include
 * whatever tmux session it caused.
 */
export function withinReconcileGrace(at, now = Date.now(), graceMs = RECONCILE_GRACE_MS) {
  return typeof at === "number" && !Number.isNaN(at) && now - at < graceMs;
}

/** True while a running step started too recently for a stale sessions snapshot to be trusted about it being gone. */
export function stepStartedWithinGrace(step, now = Date.now(), graceMs = RECONCILE_GRACE_MS) {
  const startedAt = step?.startedAt ? Date.parse(step.startedAt) : NaN;
  return withinReconcileGrace(startedAt, now, graceMs);
}

/**
 * Derived pipeline status. isLive(sessionName) tells whether a running
 * step's session still exists; a running step whose session is gone counts
 * as stopped.
 */
export function pipelineStatus(record, isLive) {
  const steps = record?.steps ?? [];
  if (pipelineFinished(record)) return "complete";
  if (steps.some((step) => step.status === "stopped")) return "stopped";
  const running = steps.filter((step) => step.status === "running");
  if (running.some((step) => !isLive(step.session))) return "stopped";
  if (running.length > 0) return "running";
  return "pending";
}

/** Whether a step carries a usable launch reference. */
function hasLaunch(step) {
  return Boolean(step.launch && typeof step.launch === "object" && typeof step.launch.harness === "string" && step.launch.harness.trim());
}

/** Whether a step carries a hand-typed command. */
function hasCommand(step) {
  return typeof step.command === "string" && step.command.trim().length > 0;
}

/** Normalizes one validated step into its stored pending shape. */
function normalizeStep(step, index) {
  const launch = hasLaunch(step)
    ? {
      harness: step.launch.harness.trim(),
      model: typeof step.launch.model === "string" && step.launch.model ? step.launch.model : null,
      effort: typeof step.launch.effort === "string" && step.launch.effort ? step.launch.effort : null
    }
    : null;
  return {
    index,
    instruction: step.instruction.trim(),
    launch,
    command: launch ? "" : step.command.trim(),
    label: "",
    continueFrom: Number.isInteger(step.continueFrom) ? step.continueFrom : null,
    status: "pending",
    session: null,
    startedAt: null,
    endedAt: null,
    handover: null,
    handoverSource: null
  };
}

/** Parses one record file, or null when it is missing or not valid JSON. */
async function readRecordFile(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Lists every .json file under a directory, sorted; empty when it is missing. */
async function walkJsonFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}
