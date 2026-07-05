import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ResolvedRepoInfo as SearchRepoInfo } from "@tangent/repo";

import type { SearchConfig } from "../types/config.js";

export type SearchOutputPaths = {
  globalConfigPath: string;
  repoSharedConfigPath: string;
  outputDir: string;
  privateConfigPath: string;
  dbPath: string;
};

/** Searches home. */
export function searchHome(): string {
  return process.env.TANGENT_SEARCH_HOME || path.join(process.env.TANGENT_HOME || path.join(homedir(), ".tangent"), "search");
}

/** Supports the global search config path helper. */
export function globalSearchConfigPath(): string {
  return path.join(searchHome(), "config.json");
}

/** Supports the default repo output dir helper. */
export function defaultRepoOutputDir(repo: SearchRepoInfo): string {
  return path.join(searchHome(), "repos", repo.id);
}

/** Supports the repo local output dir helper. */
export function repoLocalOutputDir(repo: SearchRepoInfo): string {
  return path.join(repo.root, ".tangent", "search");
}

/** Resolves output paths. */
export function resolveOutputPaths(repo: SearchRepoInfo, config: SearchConfig): SearchOutputPaths {
  const outputDir = config.storage.baseDir
    ? resolveUserPath(config.storage.baseDir)
    : config.storage.mode === "repo-local-private"
      ? repoLocalOutputDir(repo)
      : defaultRepoOutputDir(repo);
  return {
    globalConfigPath: globalSearchConfigPath(),
    repoSharedConfigPath: path.join(repo.root, ".search.config.json"),
    outputDir,
    privateConfigPath: path.join(outputDir, "config.json"),
    dbPath: config.storage.dbPath ? resolveUserPath(config.storage.dbPath) : path.join(outputDir, "index.sqlite3")
  };
}

/** Ensures output dirs. */
export async function ensureOutputDirs(paths: SearchOutputPaths): Promise<void> {
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(path.dirname(paths.dbPath), { recursive: true });
}

/** Resolves user path. */
export function resolveUserPath(inputPath: string): string {
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/")) return path.join(homedir(), inputPath.slice(2));
  return path.resolve(inputPath);
}
