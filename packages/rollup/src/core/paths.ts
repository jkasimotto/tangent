import { createHash } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ResolvedRepoInfo as RollupRepoInfo } from "@tangent/repo";

import type { RollupConfig } from "../types/config.js";

export type RollupOutputPaths = {
  globalConfigPath: string;
  repoSharedConfigPath: string;
  outputDir: string;
  privateConfigPath: string;
  ledgerPath: string;
  notesDir: string;
  examplesDir: string;
  artifactsDir: string;
  rollupsDir: string;
  failuresDir: string;
};

/** Returns the root directory for all rollup data, resolved from env vars or the default ~/.tangent/rollup. */
export function rollupHome(): string {
  return process.env.TANGENT_ROLLUP_HOME || process.env.ROLLUP_HOME || path.join(process.env.TANGENT_HOME || path.join(homedir(), ".tangent"), "rollup");
}

/** Returns the path to the global rollup config.json file. */
export function globalRollupConfigPath(): string {
  return path.join(rollupHome(), "config.json");
}

/** Returns the default user-global output directory for a given repo. */
export function defaultRepoOutputDir(repo: RollupRepoInfo): string {
  return path.join(rollupHome(), "repos", repo.slug);
}

/** Returns the repo-local private output directory (.tangent/rollup inside the repo). */
export function repoLocalOutputDir(repo: RollupRepoInfo): string {
  return path.join(repo.root, ".tangent", "rollup");
}

/** Resolves all output directory and file paths for a repo based on its config. */
export function resolveOutputPaths(repo: RollupRepoInfo, config: RollupConfig): RollupOutputPaths {
  const baseDir = config.output.baseDir
    ? resolveUserPath(config.output.baseDir)
    : config.output.mode === "repo-local-private"
      ? repoLocalOutputDir(repo)
      : defaultRepoOutputDir(repo);
  const notesDir = config.output.notesDir ? resolveUserPath(config.output.notesDir) : path.join(baseDir, "notes");
  const artifactsDir = config.output.artifactsDir ? resolveUserPath(config.output.artifactsDir) : path.join(baseDir, "artifacts");

  return {
    globalConfigPath: globalRollupConfigPath(),
    repoSharedConfigPath: path.join(repo.root, ".rollup.config.json"),
    outputDir: baseDir,
    privateConfigPath: path.join(baseDir, "config.json"),
    ledgerPath: path.join(baseDir, "ledger.jsonl"),
    notesDir,
    examplesDir: path.join(baseDir, "examples"),
    artifactsDir,
    rollupsDir: path.join(artifactsDir, "rollups"),
    failuresDir: path.join(artifactsDir, "failures")
  };
}

/** Creates all required rollup output directories if they do not already exist. */
export async function ensureOutputDirs(paths: RollupOutputPaths): Promise<void> {
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(paths.notesDir, { recursive: true });
  await mkdir(paths.examplesDir, { recursive: true });
  await mkdir(paths.rollupsDir, { recursive: true });
  await mkdir(paths.failuresDir, { recursive: true });
}

/** Returns the path to the markdown note file for the given period key. */
export function notePath(paths: RollupOutputPaths, key: string): string {
  return path.join(paths.notesDir, `${key}.md`);
}

/** Returns the artifact path for a rollup input JSON file. */
export function rollupInputArtifactPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return rollupInputPath(paths, key, inputHash);
}

/** Returns the artifact path for a rollup output JSON file. */
export function rollupOutputArtifactPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return rollupOutputPath(paths, key, inputHash);
}

/** Returns the file path for a rollup input artifact keyed by period and input hash. */
export function rollupInputPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return path.join(paths.rollupsDir, key, `input.${inputHash}.json`);
}

/** Returns the file path for a cached messages markdown artifact. */
export function rollupMessagesPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return path.join(paths.rollupsDir, key, `messages.${inputHash}.md`);
}

/** Returns the file path for a rollup output artifact keyed by period and input hash. */
export function rollupOutputPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return path.join(paths.rollupsDir, key, `output.${inputHash}.json`);
}

/** Returns the file path for a cached prompt artifact. */
export function rollupPromptPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return path.join(paths.rollupsDir, key, `prompt.${inputHash}.md`);
}

/** Returns the file path for a failure log artifact for the given source and hash. */
export function failureArtifactPath(paths: RollupOutputPaths, date: string, sourceKey: string, inputHash: string): string {
  return path.join(paths.failuresDir, date, `${safeFileId(sourceKey)}.${inputHash}.log`);
}

/** Converts a string to a safe file identifier by replacing non-alphanumeric characters with underscores. */
function safeFileId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

/** Returns a 16-character hex hash of the current OS username for anonymous identification. */
export function userIdHash(): string {
  const name = process.env.USER || process.env.LOGNAME || userInfo().username || "unknown";
  return createHash("sha256").update(name).digest("hex").slice(0, 16);
}

/** Expands a ~ prefix and resolves the given path to an absolute path. */
export function resolveUserPath(inputPath: string): string {
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/")) return path.join(homedir(), inputPath.slice(2));
  return path.resolve(inputPath);
}
