import { createHash } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { DailyConfig } from "../types/config.js";
import type { DailyRepoInfo } from "./repo.js";

export type DailyOutputPaths = {
  globalConfigPath: string;
  repoSharedConfigPath: string;
  outputDir: string;
  privateConfigPath: string;
  ledgerPath: string;
  notesDir: string;
  digestsDir: string;
  artifactsDir: string;
};

export function dailyHome(): string {
  return process.env.TANGENT_DAILY_HOME || process.env.DAILY_HOME || path.join(process.env.TANGENT_HOME || path.join(homedir(), ".tangent"), "daily");
}

export function globalDailyConfigPath(): string {
  return path.join(dailyHome(), "config.json");
}

export function defaultRepoOutputDir(repo: DailyRepoInfo): string {
  return path.join(dailyHome(), "repos", repo.slug);
}

export function repoLocalOutputDir(repo: DailyRepoInfo): string {
  return path.join(repo.root, ".tangent", "daily");
}

export function resolveOutputPaths(repo: DailyRepoInfo, config: DailyConfig): DailyOutputPaths {
  const baseDir = config.output.baseDir
    ? resolveUserPath(config.output.baseDir)
    : config.output.mode === "repo-local-private"
      ? repoLocalOutputDir(repo)
      : defaultRepoOutputDir(repo);
  const notesDir = config.output.notesDir ? resolveUserPath(config.output.notesDir) : path.join(baseDir, "notes");
  const artifactsDir = config.output.artifactsDir ? resolveUserPath(config.output.artifactsDir) : path.join(baseDir, "artifacts");

  return {
    globalConfigPath: globalDailyConfigPath(),
    repoSharedConfigPath: path.join(repo.root, ".daily.config.json"),
    outputDir: baseDir,
    privateConfigPath: path.join(baseDir, "config.json"),
    ledgerPath: path.join(baseDir, "ledger.jsonl"),
    notesDir,
    digestsDir: path.join(baseDir, "digests"),
    artifactsDir
  };
}

export async function ensureOutputDirs(paths: DailyOutputPaths): Promise<void> {
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(paths.notesDir, { recursive: true });
  await mkdir(paths.digestsDir, { recursive: true });
  await mkdir(path.join(paths.artifactsDir, "design"), { recursive: true });
}

export function notePath(paths: DailyOutputPaths, date: string): string {
  return path.join(paths.notesDir, `${date}.md`);
}

export function digestPath(paths: DailyOutputPaths, conversationId: string, inputHash: string): string {
  const safeId = conversationId.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return path.join(paths.digestsDir, `${safeId}.${inputHash}.json`);
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
