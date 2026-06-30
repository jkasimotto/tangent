import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import type { EvalSpec } from "../types/spec.js";
import { isoCompact, runDir, runsDir, sanitizePathSegment } from "./paths.js";

/** Generates a timestamped run id from the eval name and current date. */
export function createRunId(name: string, date = new Date()): string {
  return `${isoCompact(date)}-${sanitizePathSegment(name)}`;
}

/** Creates a new run manifest directory and persists the initial manifest to disk. */
export async function createRunManifest(args: {
  name: string;
  specPath?: string;
  spec?: EvalSpec;
}): Promise<EvalRunManifest> {
  const id = await uniqueRunId(args.name);
  const dir = runDir(id);
  await mkdir(dir, { recursive: true });
  const manifest: EvalRunManifest = {
    schema: "eval.run.v1",
    id,
    name: args.name,
    createdAt: new Date().toISOString(),
    specPath: args.specPath,
    spec: args.spec,
    runDir: dir,
    variants: []
  };
  await saveRunManifest(manifest);
  return manifest;
}

/** Allocates a run id that does not already exist on disk, appending a counter if needed. */
async function uniqueRunId(name: string): Promise<string> {
  const base = createRunId(name);
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    if (!await exists(runDir(candidate))) return candidate;
  }
  throw new Error(`Could not allocate eval run id for ${name}`);
}

/** Returns true if the file or directory at the given path exists. */
async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false);
}

/** Loads and parses a run manifest from a run id, directory path, or .json file path. */
export async function loadRunManifest(idOrPath: string): Promise<EvalRunManifest> {
  const manifestPath = idOrPath.endsWith(".json")
    ? idOrPath
    : path.join(idOrPath.includes(path.sep) ? idOrPath : runDir(idOrPath), "run.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as EvalRunManifest;
  if (manifest.schema !== "eval.run.v1") throw new Error(`Not an eval run manifest: ${manifestPath}`);
  return manifest;
}

/** Writes the run manifest to disk as run.json inside the run directory. */
export async function saveRunManifest(manifest: EvalRunManifest): Promise<void> {
  await mkdir(manifest.runDir, { recursive: true });
  await writeFile(path.join(manifest.runDir, "run.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/** Lists all eval runs from the runs directory, sorted newest first. */
export async function listRuns(): Promise<EvalRunManifest[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(runsDir(), { withFileTypes: true }).catch(() => []);
  const rows: EvalRunManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(runsDir(), entry.name, "run.json");
    try {
      rows.push(JSON.parse(await readFile(file, "utf8")) as EvalRunManifest);
    } catch {
      // Ignore partial run directories.
    }
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Returns the directory for a specific case/variant within a run. */
export function variantDir(manifest: EvalRunManifest, caseId: string, variantId: string): string {
  return path.join(manifest.runDir, "variants", sanitizePathSegment(`${caseId}-${variantId}`));
}

/** Finds a variant in a run manifest by variant id, disambiguating by case id when needed. */
export function findVariant(manifest: EvalRunManifest, variantId: string, caseId?: string): EvalRunVariantState {
  const matches = manifest.variants.filter((variant) => variant.variantId === variantId && (!caseId || variant.caseId === caseId));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`Variant not found in run ${manifest.id}: ${caseId ? `${caseId}/` : ""}${variantId}`);
  throw new Error(`Variant id is ambiguous in run ${manifest.id}: ${variantId}; pass a case id.`);
}
