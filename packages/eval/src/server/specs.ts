import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveGitRoot, showFile } from "@tangent/repo/git";

import { loadEvalSpec, type LoadedEvalSpec } from "../core/config.js";
import { readContextManifest } from "../core/context-snapshot.js";
import { shortHash } from "../core/hash.js";
import { relativeFrom, resolveMaybeRelative, sanitizePathSegment } from "../core/paths.js";
import type { ResolvedEvalVariant } from "../types/spec.js";
import type { EvalSpecListItem, EvalSpecView, EvalContextView, EvalContextSnapshotView } from "./dto.js";

export type EvalSpecRegistry = {
  listSpecs(): Promise<EvalSpecListItem[]>;
  getSpec(id: string): Promise<EvalSpecView>;
  getContext(id: string, caseId: string, variantId: string): Promise<EvalContextSnapshotView>;
  resolveSpecPath(id: string): Promise<string>;
};

export function createEvalSpecRegistry(options: { cwd: string; explicitSpecPath?: string }): EvalSpecRegistry {
  return {
    async listSpecs() {
      const paths = await discoverSpecPaths(options.cwd, options.explicitSpecPath);
      return Promise.all(paths.map((specPath) => specListItem(options.cwd, specPath)));
    },
    async getSpec(id) {
      const specPath = await resolveSpecPath(options.cwd, id, options.explicitSpecPath);
      return specView(options.cwd, specPath);
    },
    async getContext(id, caseId, variantId) {
      const specPath = await resolveSpecPath(options.cwd, id, options.explicitSpecPath);
      return contextSnapshotView(options.cwd, id, specPath, caseId, variantId);
    },
    async resolveSpecPath(id) {
      return resolveSpecPath(options.cwd, id, options.explicitSpecPath);
    }
  };
}

async function discoverSpecPaths(cwd: string, explicitSpecPath?: string): Promise<string[]> {
  const rows = new Set<string>();
  if (explicitSpecPath) rows.add(resolveMaybeRelative(cwd, explicitSpecPath));
  await walk(path.join(cwd, "evals"), rows);
  return [...rows].sort((a, b) => relativeFrom(cwd, a).localeCompare(relativeFrom(cwd, b)));
}

async function walk(dir: string, rows: Set<string>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectory(entry.name)) continue;
      await walk(path.join(dir, entry.name), rows);
      continue;
    }
    if (entry.isFile() && entry.name === "eval.json") rows.add(path.join(dir, entry.name));
  }
}

async function specListItem(cwd: string, specPath: string): Promise<EvalSpecListItem> {
  const base = {
    id: specId(specPath),
    path: specPath,
    relativePath: relativeFrom(cwd, specPath)
  };
  try {
    const loaded = await loadEvalSpec(specPath, { invocationCwd: cwd });
    return {
      ...base,
      name: loaded.spec.name,
      caseCount: loaded.spec.cases.length,
      variantCount: loaded.variants.length
    };
  } catch (error) {
    return {
      ...base,
      name: await rawSpecName(specPath),
      error: (error as Error).message
    };
  }
}

async function specView(cwd: string, specPath: string): Promise<EvalSpecView> {
  const base = {
    id: specId(specPath),
    path: specPath,
    relativePath: relativeFrom(cwd, specPath)
  };
  let loaded: LoadedEvalSpec;
  try {
    loaded = await loadEvalSpec(specPath, { invocationCwd: cwd });
  } catch (error) {
    return {
      ...base,
      name: await rawSpecName(specPath),
      error: (error as Error).message,
      cases: []
    };
  }

  return {
    ...base,
    name: loaded.spec.name,
    spec: loaded.spec,
    defaults: loaded.spec.defaults,
    cases: await Promise.all(loaded.spec.cases.map(async (testCase) => {
      const variants = loaded.variants.filter((variant) => variant.caseId === testCase.id);
      const promptPath = variants[0]?.promptPath || resolveMaybeRelative(loaded.specDir, testCase.prompt);
      const prompt = await readFile(promptPath, "utf8").catch((error) => `Could not read prompt: ${(error as Error).message}`);
      return {
        caseId: testCase.id,
        promptPath,
        prompt,
        variants: await Promise.all(variants.map(async (variant) => {
          const rawVariant = testCase.variants.find((item) => item.id === variant.variantId);
          return {
            caseId: variant.caseId,
            variantId: variant.variantId,
            promptPath: variant.promptPath,
            repo: variant.repo,
            cwd: variant.cwd,
            context: await contextView(loaded, variant),
            agent: variant.agent,
            phases: variant.phases,
            rawPhases: rawVariant?.phases || testCase.phases || loaded.spec.defaults?.phases
          };
        }))
      };
    }))
  };
}

async function contextView(loaded: LoadedEvalSpec, variant: ResolvedEvalVariant): Promise<EvalContextView> {
  if (variant.context.mode !== "snapshot") return variant.context;
  const repoPath = resolveMaybeRelative(loaded.invocationCwd, variant.repo.path);
  try {
    const manifest = await readContextManifest(repoPath, variant.context.ref);
    return {
      ...variant.context,
      files: manifest.files
    };
  } catch (error) {
    return {
      ...variant.context,
      error: (error as Error).message
    };
  }
}

async function contextSnapshotView(cwd: string, specIdValue: string, specPath: string, caseId: string, variantId: string): Promise<EvalContextSnapshotView> {
  const loaded = await loadEvalSpec(specPath, { invocationCwd: cwd });
  const variant = loaded.variants.find((item) => item.caseId === caseId && item.variantId === variantId);
  if (!variant) throw new Error(`Eval variant not found: ${caseId}/${variantId}`);
  if (variant.context.mode !== "snapshot") throw new Error(`Eval variant does not use a snapshot context: ${caseId}/${variantId}`);
  const ref = variant.context.ref;
  const repoPath = resolveMaybeRelative(loaded.invocationCwd, variant.repo.path);
  const repoRoot = await resolveGitRoot(repoPath);
  const manifest = await readContextManifest(repoRoot, ref);
  return {
    specId: specIdValue,
    caseId,
    variantId,
    ref,
    files: await Promise.all(manifest.files.map(async (file) => ({
      ...file,
      content: await showFile(repoRoot, ref, file.snapshotPath)
    })))
  };
}

async function resolveSpecPath(cwd: string, id: string, explicitSpecPath?: string): Promise<string> {
  const paths = await discoverSpecPaths(cwd, explicitSpecPath);
  const match = paths.find((specPath) => specId(specPath) === id);
  if (!match) throw new Error(`Eval spec not found: ${id}`);
  return match;
}

async function rawSpecName(specPath: string): Promise<string | undefined> {
  const raw = await readFile(specPath, "utf8").catch(() => undefined);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

function specId(specPath: string): string {
  return `${sanitizePathSegment(path.basename(path.dirname(specPath)))}-${shortHash(path.resolve(specPath))}`;
}

function ignoredDirectory(name: string): boolean {
  return name === ".git" || name === "node_modules" || name === "dist" || name === "build" || name === ".cache";
}
