import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ReviewedAreaDefaults, ReviewedRun } from "./types.js";

export type ReviewedRunStore = ReturnType<typeof createReviewedRunStore>;

/** Creates the durable store for Reviewed build definitions and Run records. */
export function createReviewedRunStore(loopsRoot = path.join(os.homedir(), ".tangent", "loops")) {
  const root = path.join(loopsRoot, "reviewed-build");
  const runsRoot = path.join(root, "runs");
  const defaultsFile = path.join(root, "defaults.json");

  /** Creates the store folders before the first write. */
  const ensure = async (): Promise<void> => {
    await mkdir(runsRoot, { recursive: true });
  };

  /** Returns a collision-resistant, sortable Run identifier. */
  const createId = (now = new Date()): string => `${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;

  /** Returns one Run directory. */
  const runDirectory = (runId: string): string => path.join(runsRoot, safeId(runId));

  /** Returns one process-log path relative to the Run directory. */
  const attemptLog = (runId: string, stepId: string, attempt: number): string => path.join(runDirectory(runId), "attempts", `${safeId(stepId)}-${attempt}.log`);

  /** Atomically persists one Run record. */
  const saveRun = async (run: ReviewedRun): Promise<void> => {
    await ensure();
    const directory = runDirectory(run.id);
    await mkdir(path.join(directory, "attempts"), { recursive: true });
    await atomicJson(path.join(directory, "run.json"), run);
  };

  /** Loads one Run record. */
  const loadRun = async (runId: string): Promise<ReviewedRun> => {
    const value = JSON.parse(await readFile(path.join(runDirectory(runId), "run.json"), "utf8")) as ReviewedRun;
    if (value.schema !== "reviewed-build.run.v1" || value.id !== runId) throw new Error(`Invalid Reviewed build Run: ${runId}`);
    return value;
  };

  /** Lists Run records newest first and ignores partial temporary writes. */
  const listRuns = async (): Promise<ReviewedRun[]> => {
    await ensure();
    const runs: ReviewedRun[] = [];
    for (const entry of await readdir(runsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try { runs.push(await loadRun(entry.name)); } catch { /* A partial or foreign directory is not a Run. */ }
    }
    return runs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  };

  /** Saves one Area's default step bindings and session choices. */
  const saveDefaults = async (defaults: ReviewedAreaDefaults): Promise<void> => {
    await ensure();
    const all = await loadAllDefaults();
    all[defaults.areaPath] = defaults;
    await atomicJson(defaultsFile, all);
  };

  /** Loads one Area's default bindings. */
  const loadDefaults = async (areaPath: string): Promise<ReviewedAreaDefaults | undefined> => (await loadAllDefaults())[areaPath];

  /** Reads every saved Area default. */
  const loadAllDefaults = async (): Promise<Record<string, ReviewedAreaDefaults>> => {
    try {
      const value = JSON.parse(await readFile(defaultsFile, "utf8")) as unknown;
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, ReviewedAreaDefaults> : {};
    } catch { return {}; }
  };

  return { root, runsRoot, ensure, createId, runDirectory, attemptLog, saveRun, loadRun, listRuns, saveDefaults, loadDefaults };
}

/** Writes JSON through a sibling temporary file and an atomic rename. */
async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 6)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

/** Rejects path syntax in a Run or step identifier. */
function safeId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(`Invalid identifier: ${value}`);
  return value;
}
