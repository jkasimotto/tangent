import { ensureOutputDirs } from "../core/paths.js";
import { buildIndex, watchIndex, type IndexResult } from "../core/indexer.js";
import { callGraphDb, openPlanDb, searchDb, skeletonDb, statusDb, symbolDb, testsDb, type CallGraphResult, type OpenPlanResult, type SearchResults, type SearchStatus, type SkeletonResult, type SymbolDetails, type TestResult } from "../core/search.js";
import { loadConfig } from "../core/config.js";
import type { SearchQueryMode } from "../core/search.js";
import { resolveEngine, type SearchEngine } from "./engine.js";
import { rustCallGraph, rustIndex, rustOpenPlan, rustSearch, rustSkeleton, rustStatus, rustSymbol, rustTests } from "./rust-engine.js";

export type IndexRepoOptions = {
  repo?: string;
  languages?: string[];
  includeGenerated?: boolean;
  force?: boolean;
  reedgeAll?: boolean;
  watch?: boolean;
  intervalSeconds?: number;
  onResult?: (result: IndexResult) => void;
  engine?: SearchEngine;
};

export async function indexRepo(options: IndexRepoOptions = {}): Promise<IndexResult | undefined> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  await ensureOutputDirs(loaded.paths);
  const engine = resolveEngine(options.engine);
  if (engine === "rust") {
    if (options.watch) throw new Error("Rust search engine does not support watch mode; use --engine ts.");
    return rustIndex(loaded, options);
  }
  const args = {
    root: loaded.repo.root,
    dbPath: loaded.paths.dbPath,
    config: loaded.config,
    languages: options.languages,
    includeGenerated: options.includeGenerated,
    force: options.force,
    reedgeAll: options.reedgeAll
  };
  if (options.watch) {
    await watchIndex({ ...args, intervalSeconds: options.intervalSeconds || 1, onResult: options.onResult });
    return undefined;
  }
  return buildIndex(args);
}

export async function searchRepo(query: string, options: { repo?: string; mode?: SearchQueryMode; maxResults?: number; languages?: string[]; includeTests?: boolean; engine?: SearchEngine } = {}): Promise<SearchResults> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  const engine = resolveEngine(options.engine);
  if (engine === "rust") {
    return rustSearch(loaded, query, {
      mode: options.mode || loaded.config.search.defaultMode,
      maxResults: options.maxResults || loaded.config.search.maxResults,
      languages: options.languages,
      includeTests: options.includeTests ?? loaded.config.search.includeTests
    });
  }
  return searchDb(loaded.paths.dbPath, query, {
    mode: options.mode || loaded.config.search.defaultMode,
    maxResults: options.maxResults || loaded.config.search.maxResults,
    languages: options.languages,
    includeTests: options.includeTests ?? loaded.config.search.includeTests
  });
}

export async function symbol(name: string, options: { repo?: string; languages?: string[]; engine?: SearchEngine } = {}): Promise<SymbolDetails[]> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  if (resolveEngine(options.engine) === "rust") return rustSymbol(loaded, name, options.languages);
  return symbolDb(loaded.paths.dbPath, name, options.languages);
}

export async function callers(name: string, options: { repo?: string; languages?: string[]; engine?: SearchEngine } = {}): Promise<CallGraphResult> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  if (resolveEngine(options.engine) === "rust") return rustCallGraph(loaded, name, true, options.languages);
  return callGraphDb(loaded.paths.dbPath, name, true, options.languages);
}

export async function callees(name: string, options: { repo?: string; languages?: string[]; engine?: SearchEngine } = {}): Promise<CallGraphResult> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  if (resolveEngine(options.engine) === "rust") return rustCallGraph(loaded, name, false, options.languages);
  return callGraphDb(loaded.paths.dbPath, name, false, options.languages);
}

export async function testsFor(target: string, options: { repo?: string; languages?: string[]; engine?: SearchEngine } = {}): Promise<TestResult> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  if (resolveEngine(options.engine) === "rust") return rustTests(loaded, target, options.languages);
  return testsDb(loaded.paths.dbPath, target, options.languages);
}

export async function skeleton(target: string, options: { repo?: string; languages?: string[]; engine?: SearchEngine } = {}): Promise<SkeletonResult> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  if (resolveEngine(options.engine) === "rust") return rustSkeleton(loaded, target, options.languages);
  return skeletonDb(loaded.paths.dbPath, target, options.languages);
}

export async function openPlan(query: string, options: { repo?: string; languages?: string[]; engine?: SearchEngine } = {}): Promise<OpenPlanResult> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  if (resolveEngine(options.engine) === "rust") return rustOpenPlan(loaded, query, options.languages);
  return openPlanDb(loaded.paths.dbPath, query, options.languages);
}

export async function status(options: { repo?: string; engine?: SearchEngine } = {}): Promise<SearchStatus & { repoRoot: string; configuredLanguages: string[] }> {
  const loaded = await loadConfig({ repo: options.repo || "." });
  const value = resolveEngine(options.engine) === "rust" ? await rustStatus(loaded) : statusDb(loaded.paths.dbPath);
  return {
    ...value,
    repoRoot: loaded.repo.root,
    configuredLanguages: loaded.config.indexing.languages
  };
}

export { configure } from "./config.js";
export { benchSearch } from "./bench.js";
export type { BenchOptions, BenchResult, EngineBenchResult } from "./bench.js";
export type { ConfigureOptions } from "./config.js";
export type { SearchEngine } from "./engine.js";
export type { SearchConfig } from "../types/config.js";
export type { SearchResults, SearchHit, SymbolDetails, CallGraphResult, TestResult, SkeletonResult, OpenPlanResult, SearchStatus } from "../core/search.js";
