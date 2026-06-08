import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { SearchConfig } from "../types/config.js";
import type { SearchRepoInfo } from "./repo.js";

export type SearchOutputPaths = {
  globalConfigPath: string;
  repoSharedConfigPath: string;
  outputDir: string;
  privateConfigPath: string;
  dbPath: string;
};

export function searchHome(): string {
  return process.env.TANGENT_SEARCH_HOME || path.join(process.env.TANGENT_HOME || path.join(homedir(), ".tangent"), "search");
}

export function globalSearchConfigPath(): string {
  return path.join(searchHome(), "config.json");
}

export function defaultRepoOutputDir(repo: SearchRepoInfo): string {
  return path.join(searchHome(), "repos", repo.id);
}

export function repoLocalOutputDir(repo: SearchRepoInfo): string {
  return path.join(repo.root, ".tangent", "search");
}

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

export async function ensureOutputDirs(paths: SearchOutputPaths): Promise<void> {
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(path.dirname(paths.dbPath), { recursive: true });
}

export function resolveUserPath(inputPath: string): string {
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/")) return path.join(homedir(), inputPath.slice(2));
  return path.resolve(inputPath);
}
