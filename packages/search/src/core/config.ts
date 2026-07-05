import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, resolveRepo, type ResolvedRepoInfo as SearchRepoInfo } from "@tangent/repo";

import type { LanguageId } from "../languages/base.js";
import type { SearchConfig, SearchMode, SearchStorageMode } from "../types/config.js";
import { ensureOutputDirs, resolveOutputPaths, resolveUserPath, type SearchOutputPaths } from "./paths.js";

export type LoadedSearchConfig = {
  config: SearchConfig;
  repo: SearchRepoInfo;
  paths: SearchOutputPaths;
  sources: string[];
};

export type InitSearchOptions = {
  repo: string;
  storage?: SearchStorageMode;
  baseDir?: string;
  dbPath?: string;
  languages?: LanguageId[];
  includeGenerated?: boolean;
  defaultMode?: SearchMode;
  maxResults?: number;
  scope?: "private" | "global" | "repo-shared";
};

/** Supports the default config helper. */
export function defaultConfig(repo?: SearchRepoInfo): SearchConfig {
  return {
    schema: "search.config.v1",
    repo: {
      root: repo?.root,
      displayName: repo?.displayName
    },
    storage: {
      mode: "user-global"
    },
    indexing: {
      languages: ["dart", "typescript"],
      includeGenerated: false,
      includeGlobs: [],
      excludeGlobs: []
    },
    search: {
      defaultMode: "precise",
      maxResults: 10,
      includeTests: false
    }
  };
}

/** Loads config. */
export async function loadConfig(options: { repo: string }): Promise<LoadedSearchConfig> {
  const repo = await resolveRepo(options.repo);
  const sources: string[] = [];
  let config = defaultConfig(repo);

  const defaultPaths = resolveOutputPaths(repo, config);
  const globalConfig = await readConfigFile(defaultPaths.globalConfigPath);
  if (globalConfig) {
    config = mergeConfig(config, globalConfig);
    sources.push(defaultPaths.globalConfigPath);
  }

  const repoSharedConfig = await readConfigFile(defaultPaths.repoSharedConfigPath);
  if (repoSharedConfig) {
    config = mergeConfig(config, repoSharedConfig);
    sources.push(defaultPaths.repoSharedConfigPath);
  }

  let paths = resolveOutputPaths(repo, config);
  const privateConfig = await readConfigFile(paths.privateConfigPath);
  if (privateConfig) {
    config = mergeConfig(config, privateConfig);
    sources.push(paths.privateConfigPath);
    paths = resolveOutputPaths(repo, config);
  }

  return { config, repo, paths, sources };
}

/** Supports the init config helper. */
export async function initConfig(options: InitSearchOptions): Promise<LoadedSearchConfig> {
  const repo = await resolveRepo(options.repo);
  let config = defaultConfig(repo);
  if (options.storage) config.storage.mode = options.storage;
  if (options.baseDir) config.storage.baseDir = resolveUserPath(options.baseDir);
  if (options.dbPath) config.storage.dbPath = resolveUserPath(options.dbPath);
  if (options.languages) config.indexing.languages = options.languages;
  if (options.includeGenerated !== undefined) config.indexing.includeGenerated = options.includeGenerated;
  if (options.defaultMode) config.search.defaultMode = options.defaultMode;
  if (options.maxResults !== undefined) config.search.maxResults = options.maxResults;

  const paths = resolveOutputPaths(repo, config);
  const scope = options.scope || "private";
  const targetPath = scope === "global" ? paths.globalConfigPath : scope === "repo-shared" ? paths.repoSharedConfigPath : paths.privateConfigPath;
  if (scope === "repo-shared") config = sharedConfigOnly(config);
  await ensureOutputDirs(paths);
  await writeConfigFile(targetPath, config);
  if (config.storage.mode === "repo-local-private") await excludeRepoLocalSearch(repo.root);
  return { config, repo, paths, sources: [targetPath] };
}

/** Writes config file. */
export async function writeConfigFile(filePath: string, config: SearchConfig): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Supports the set config value helper. */
export function setConfigValue(config: SearchConfig, dottedPath: string, rawValue: string): SearchConfig {
  const next = structuredClone(config) as SearchConfig;
  const segments = dottedPath.split(".").filter(Boolean);
  if (!segments.length) throw new Error("Config path is required.");
  let cursor = next as unknown as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = parseConfigValue(rawValue);
  return next;
}

/** Reads config file. */
async function readConfigFile(filePath: string): Promise<Partial<SearchConfig> | undefined> {
  if (!(await pathExists(filePath))) return undefined;
  const text = await readFile(filePath, "utf8");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (parsed.schema && parsed.schema !== "search.config.v1") throw new Error(`Unsupported search config schema in ${filePath}: ${String(parsed.schema)}`);
  return parsed as Partial<SearchConfig>;
}

/** Merges config. */
function mergeConfig(base: SearchConfig, override: Partial<SearchConfig>): SearchConfig {
  return deepMerge(base, override) as SearchConfig;
}

/** Supports the deep merge helper. */
function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (isObject(base) && isObject(override)) {
    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) result[key] = deepMerge(result[key], value);
    return result;
  }
  return override;
}

/** Supports the shared config only helper. */
export function sharedConfigOnly(config: SearchConfig): SearchConfig {
  return {
    schema: "search.config.v1",
    indexing: config.indexing,
    search: config.search,
    storage: { mode: "user-global" }
  };
}

/** Returns whether object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Parses config value. */
function parseConfigValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Supports the exclude repo local search helper. */
async function excludeRepoLocalSearch(repoRoot: string): Promise<void> {
  const gitDir = path.join(repoRoot, ".git");
  if (!(await pathExists(gitDir))) return;
  const excludePath = path.join(gitDir, "info", "exclude");
  const existing = (await pathExists(excludePath)) ? await readFile(excludePath, "utf8") : "";
  if (existing.split(/\r?\n/).includes(".tangent/search/")) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(excludePath, `${existing}${prefix}.tangent/search/\n`, "utf8");
}
