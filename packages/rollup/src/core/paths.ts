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

export function rollupHome(): string {
  return process.env.TANGENT_ROLLUP_HOME || process.env.ROLLUP_HOME || path.join(process.env.TANGENT_HOME || path.join(homedir(), ".tangent"), "rollup");
}

export function globalRollupConfigPath(): string {
  return path.join(rollupHome(), "config.json");
}

export function defaultRepoOutputDir(repo: RollupRepoInfo): string {
  return path.join(rollupHome(), "repos", repo.slug);
}

export function repoLocalOutputDir(repo: RollupRepoInfo): string {
  return path.join(repo.root, ".tangent", "rollup");
}

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

export async function ensureOutputDirs(paths: RollupOutputPaths): Promise<void> {
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(paths.notesDir, { recursive: true });
  await mkdir(paths.examplesDir, { recursive: true });
  await mkdir(paths.rollupsDir, { recursive: true });
  await mkdir(paths.failuresDir, { recursive: true });
}

export function notePath(paths: RollupOutputPaths, key: string): string {
  return path.join(paths.notesDir, `${key}.md`);
}

export function rollupInputArtifactPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return rollupInputPath(paths, key, inputHash);
}

export function rollupOutputArtifactPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return rollupOutputPath(paths, key, inputHash);
}

export function rollupInputPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return path.join(paths.rollupsDir, key, `input.${inputHash}.json`);
}

export function rollupMessagesPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return path.join(paths.rollupsDir, key, `messages.${inputHash}.md`);
}

export function rollupOutputPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return path.join(paths.rollupsDir, key, `output.${inputHash}.json`);
}

export function rollupPromptPath(paths: RollupOutputPaths, key: string, inputHash: string): string {
  return path.join(paths.rollupsDir, key, `prompt.${inputHash}.md`);
}

export function failureArtifactPath(paths: RollupOutputPaths, date: string, sourceKey: string, inputHash: string): string {
  return path.join(paths.failuresDir, date, `${safeFileId(sourceKey)}.${inputHash}.log`);
}

function safeFileId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

export function userIdHash(): string {
  const name = process.env.USER || process.env.LOGNAME || userInfo().username || "unknown";
  return createHash("sha256").update(name).digest("hex").slice(0, 16);
}

export function resolveUserPath(inputPath: string): string {
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/")) return path.join(homedir(), inputPath.slice(2));
  return path.resolve(inputPath);
}
