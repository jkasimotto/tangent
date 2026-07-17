import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "./atomic-write.js";
import type { SidecarState } from "./types.js";

/** Returns a freshly-initialized sidecar with zero counts and empty registry/dedup state, for a first-ever sweep or a missing sidecar file. */
export function emptySidecar(): SidecarState {
  return {
    sweptAt: undefined,
    counts: { needsYou: 0, blocked: 0, working: 0, finishing: 0, ready: 0, parked: 0, unowned: 0 },
    needsYou: [],
    registry: {},
    notified: {},
    recur: {}
  };
}

/** Reads the sidecar JSON from disk, returning an empty sidecar when the file does not exist yet. */
export async function readSidecar(filePath: string): Promise<SidecarState> {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeSidecar(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptySidecar();
    throw error;
  }
}

/** Fills in any fields missing from an older or hand-edited sidecar file with their defaults, so a partial file never crashes a sweep. */
function normalizeSidecar(value: unknown): SidecarState {
  const record = (value && typeof value === "object" ? value : {}) as Partial<SidecarState>;
  const empty = emptySidecar();
  return {
    sweptAt: typeof record.sweptAt === "string" ? record.sweptAt : undefined,
    counts: { ...empty.counts, ...record.counts },
    needsYou: Array.isArray(record.needsYou) ? record.needsYou : [],
    registry: record.registry && typeof record.registry === "object" ? record.registry : {},
    notified: record.notified && typeof record.notified === "object" ? record.notified : {},
    recur: record.recur && typeof record.recur === "object" ? record.recur : {},
    view: normalizeView(record.view)
  };
}

/** Validates a persisted view's shape; anything unexpected reads as "no view yet" (filtered list then asks for a sweep) rather than crashing. */
function normalizeView(value: unknown): SidecarState["view"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { threads?: unknown; unowned?: unknown };
  if (!Array.isArray(record.threads) || !Array.isArray(record.unowned)) return undefined;
  return { threads: record.threads, unowned: record.unowned } as SidecarState["view"];
}

/** Writes the sidecar JSON atomically (tmp file + rename) so a crash mid-write never corrupts the previous, valid sidecar. */
export async function writeSidecarAtomic(filePath: string, state: SidecarState): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
}
