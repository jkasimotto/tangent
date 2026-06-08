import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../core/config.js";
import { buildIndex, type IndexResult } from "../core/indexer.js";
import { ensureOutputDirs } from "../core/paths.js";
import type { SearchResults } from "../core/search.js";
import { searchDb } from "../core/search.js";
import type { SearchEngine } from "./engine.js";
import { rustIndex, rustSearch } from "./rust-engine.js";

export type BenchOptions = {
  repo: string;
  query: string;
  languages?: string[];
  iterations: number;
  includeGenerated?: boolean;
};

export type EngineBenchResult = {
  engine: SearchEngine;
  coldIndexMs: number;
  warmIndexMs: number;
  queryMs: number[];
  queryAverageMs: number;
  index?: IndexResult;
  query?: SearchResults;
};

export type BenchResult = {
  repo: string;
  query: string;
  tempHome: string;
  results: EngineBenchResult[];
  parity: {
    fileCountsMatch: boolean;
    symbolCountsMatch: boolean;
    topHitMatches: boolean;
    warnings: string[];
  };
};

export async function benchSearch(options: BenchOptions): Promise<BenchResult> {
  const tempHome = await mkdtemp(path.join(tmpdir(), "tangent-search-bench-"));
  const previousHome = process.env.TANGENT_SEARCH_HOME;
  process.env.TANGENT_SEARCH_HOME = tempHome;
  try {
    const results = [];
    for (const engine of ["ts", "rust"] as const) results.push(await benchEngine(engine, options));
    return { repo: options.repo, query: options.query, tempHome, results, parity: parity(results) };
  } finally {
    if (previousHome === undefined) delete process.env.TANGENT_SEARCH_HOME;
    else process.env.TANGENT_SEARCH_HOME = previousHome;
  }
}

async function benchEngine(engine: SearchEngine, options: BenchOptions): Promise<EngineBenchResult> {
  const cold = await timed(() => indexWithEngine(engine, options, true));
  const warm = await timed(() => indexWithEngine(engine, options, false));
  const queryMs = [];
  let lastQuery: SearchResults | undefined;
  for (let index = 0; index < options.iterations; index += 1) {
    const query = await timed(() => queryWithEngine(engine, options));
    queryMs.push(query.ms);
    lastQuery = query.value;
  }
  return {
    engine,
    coldIndexMs: cold.ms,
    warmIndexMs: warm.ms,
    queryMs,
    queryAverageMs: queryMs.reduce((sum, item) => sum + item, 0) / Math.max(1, queryMs.length),
    index: cold.value,
    query: lastQuery
  };
}

async function indexWithEngine(engine: SearchEngine, options: BenchOptions, force: boolean): Promise<IndexResult> {
  const loaded = await loadConfig({ repo: options.repo });
  await ensureOutputDirs(loaded.paths);
  if (engine === "rust") {
    return rustIndex(loaded, {
      languages: options.languages,
      includeGenerated: options.includeGenerated,
      force
    });
  }
  return buildIndex({
    root: loaded.repo.root,
    dbPath: loaded.paths.dbPath,
    config: loaded.config,
    languages: options.languages,
    includeGenerated: options.includeGenerated,
    force
  });
}

async function queryWithEngine(engine: SearchEngine, options: BenchOptions): Promise<SearchResults> {
  const loaded = await loadConfig({ repo: options.repo });
  if (engine === "rust") {
    return rustSearch(loaded, options.query, {
      mode: loaded.config.search.defaultMode,
      maxResults: loaded.config.search.maxResults,
      languages: options.languages,
      includeTests: loaded.config.search.includeTests
    });
  }
  return searchDb(loaded.paths.dbPath, options.query, {
    mode: loaded.config.search.defaultMode,
    maxResults: loaded.config.search.maxResults,
    languages: options.languages,
    includeTests: loaded.config.search.includeTests
  });
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
}

function parity(results: EngineBenchResult[]): BenchResult["parity"] {
  const [ts, rust] = results;
  const warnings = [];
  const fileCountsMatch = Boolean(ts?.index && rust?.index && ts.index.files === rust.index.files);
  const symbolCountsMatch = Boolean(ts?.index && rust?.index && ts.index.symbols === rust.index.symbols);
  const tsTop = topHit(ts?.query);
  const rustTop = topHit(rust?.query);
  const topHitMatches = Boolean(tsTop && rustTop && tsTop === rustTop);
  if (!fileCountsMatch) warnings.push("file counts differ");
  if (!symbolCountsMatch) warnings.push("symbol counts differ");
  if (!topHitMatches) warnings.push("top query hit differs");
  return { fileCountsMatch, symbolCountsMatch, topHitMatches, warnings };
}

function topHit(result: SearchResults | undefined): string | undefined {
  const hit = result?.implementationSymbols[0] || result?.implementationFiles[0] || result?.tests[0];
  return hit ? `${hit.qualifiedName}:${hit.path}` : undefined;
}
