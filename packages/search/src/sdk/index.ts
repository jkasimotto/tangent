import { ensureOutputDirs } from "../core/paths.js";
import { buildIndex, watchIndex, type IndexProgressEvent, type IndexResult } from "../core/indexer.js";
import { callGraphDb, openPlanDb, searchDb, skeletonDb, statusDb, symbolDb, testsDb, type CallGraphResult, type OpenPlanResult, type SearchResults, type SearchStatus, type SkeletonResult, type SymbolDetails, type TestResult } from "../core/search.js";
import { loadConfig } from "../core/config.js";
import type { SearchQueryMode } from "../core/search.js";

export type IndexRepoOptions = {
  repo?: string;
  languages?: string[];
  includeGenerated?: boolean;
  force?: boolean;
  reedgeAll?: boolean;
  slowOperationMs?: number;
  watch?: boolean;
  intervalSeconds?: number;
  onResult?: (result: IndexResult) => void;
  onProgress?: (event: IndexProgressEvent) => void;
};

/** Indexes repo. */
export async function indexRepo(options: IndexRepoOptions = {}): Promise<IndexResult | undefined> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  await ensureOutputDirs(loaded.paths);
  const args = {
    root: loaded.repo.root,
    dbPath: loaded.paths.dbPath,
    config: loaded.config,
    languages: options.languages,
    includeGenerated: options.includeGenerated,
    force: options.force,
    reedgeAll: options.reedgeAll,
    slowOperationMs: options.slowOperationMs,
    onProgress: options.onProgress
  };
  if (options.watch) {
    await watchIndex({ ...args, intervalSeconds: options.intervalSeconds || 1, onResult: options.onResult });
    return undefined;
  }
  return buildIndex(args);
}

/** Searches repo. */
export async function searchRepo(query: string, options: { repo?: string; mode?: SearchQueryMode; maxResults?: number; languages?: string[]; includeTests?: boolean } = {}): Promise<SearchResults> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  return searchDb(loaded.paths.dbPath, query, {
    mode: options.mode || loaded.config.search.defaultMode,
    maxResults: options.maxResults || loaded.config.search.maxResults,
    languages: options.languages,
    includeTests: options.includeTests ?? loaded.config.search.includeTests
  });
}

/** Looks up. */
export async function symbol(name: string, options: { repo?: string; languages?: string[] } = {}): Promise<SymbolDetails[]> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  return symbolDb(loaded.paths.dbPath, name, options.languages);
}

/** Finds. */
export async function callers(name: string, options: { repo?: string; languages?: string[] } = {}): Promise<CallGraphResult> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  return callGraphDb(loaded.paths.dbPath, name, true, options.languages);
}

/** Finds. */
export async function callees(name: string, options: { repo?: string; languages?: string[] } = {}): Promise<CallGraphResult> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  return callGraphDb(loaded.paths.dbPath, name, false, options.languages);
}

/** Supports the tests for helper. */
export async function testsFor(target: string, options: { repo?: string; languages?: string[] } = {}): Promise<TestResult> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  return testsDb(loaded.paths.dbPath, target, options.languages);
}

/** Builds. */
export async function skeleton(target: string, options: { repo?: string; languages?: string[] } = {}): Promise<SkeletonResult> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  return skeletonDb(loaded.paths.dbPath, target, options.languages);
}

/** Supports the open plan helper. */
export async function openPlan(query: string, options: { repo?: string; languages?: string[] } = {}): Promise<OpenPlanResult> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  return openPlanDb(loaded.paths.dbPath, query, options.languages);
}

/** Reports. */
export async function status(options: { repo?: string } = {}): Promise<SearchStatus & { repoRoot: string; configuredLanguages: string[] }> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  return {
    ...statusDb(loaded.paths.dbPath),
    repoRoot: loaded.repo.root,
    configuredLanguages: loaded.config.indexing.languages
  };
}

export { configure } from "./config.js";
export type { ConfigureOptions } from "./config.js";
export type { SearchConfig } from "../types/config.js";
export type { IndexProgressEvent, IndexResult } from "../core/indexer.js";
export type { SearchResults, SearchHit, SymbolDetails, CallGraphResult, TestResult, SkeletonResult, OpenPlanResult, SearchStatus } from "../core/search.js";
