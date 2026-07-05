import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { repoHash, usageHome } from "../paths.js";

/**
 * A parked finding resurfaces once its live cost has grown by this fraction or more since the
 * moment it was parked. Parking is curation, not dismissal: a pattern that persists at the same
 * cost stays out of the feed on purpose, but one that keeps getting worse deserves attention again.
 */
export const PARK_RESURFACE_GROWTH_THRESHOLD = 0.5;

export type ParkedFindingRecord = {
  parkedAt: string;
  costMsAtPark: number;
};

/** Park state keyed by finding fingerprint. */
export type ParkState = Record<string, ParkedFindingRecord>;

/**
 * Returns the park-state file path for the global (all-projects) insights scope, stored beside the
 * global usage index. `baseDir` defaults to the current usage home so callers get the live location
 * for free, but tests can inject a temporary directory instead of mutating process.env.
 */
export function globalInsightsParkStatePath(baseDir: string = usageHome()): string {
  return path.join(baseDir, "global", "insights", "park.json");
}

/**
 * Returns the park-state file path for a single repo's insights scope, stored beside that repo's
 * usage index. `baseDir` is injectable for the same reason as `globalInsightsParkStatePath`.
 */
export function repoInsightsParkStatePath(repoRoot: string, baseDir: string = usageHome()): string {
  return path.join(baseDir, "repos", repoHash(repoRoot), "insights", "park.json");
}

/** Loads park state from disk, returning an empty store if the file does not exist yet. */
export async function loadParkState(filePath: string): Promise<ParkState> {
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return isParkState(parsed) ? parsed : {};
  } catch (error) {
    if (isMissingFileError(error)) return {};
    throw error;
  }
}

/** Writes park state to disk, creating the parent directory if needed. */
export async function saveParkState(filePath: string, state: ParkState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Parks a finding at its current cost, persisting the updated state and returning it. */
export async function parkFinding(filePath: string, fingerprint: string, costMs: number, now: Date = new Date()): Promise<ParkState> {
  const state = await loadParkState(filePath);
  const next: ParkState = { ...state, [fingerprint]: { parkedAt: now.toISOString(), costMsAtPark: costMs } };
  await saveParkState(filePath, next);
  return next;
}

/** Removes a finding's park entry, persisting the updated state and returning it. Unparking an entry that is not parked is a no-op. */
export async function unparkFinding(filePath: string, fingerprint: string): Promise<ParkState> {
  const state = await loadParkState(filePath);
  if (!(fingerprint in state)) return state;
  const next = { ...state };
  delete next[fingerprint];
  await saveParkState(filePath, next);
  return next;
}

/**
 * Returns true when a finding is currently parked and should be excluded from the feed. Resurfaces
 * once the live cost has grown by PARK_RESURFACE_GROWTH_THRESHOLD or more since it was parked.
 */
export function isParked(state: ParkState, fingerprint: string, currentCostMs: number): boolean {
  const entry = state[fingerprint];
  if (!entry) return false;
  const resurfaceThreshold = entry.costMsAtPark * (1 + PARK_RESURFACE_GROWTH_THRESHOLD);
  return currentCostMs < resurfaceThreshold;
}

/** Type guard for a parsed JSON value being a plausible ParkState object. */
function isParkState(value: unknown): value is ParkState {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Returns true if the error is Node's ENOENT (file does not exist). */
function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}
