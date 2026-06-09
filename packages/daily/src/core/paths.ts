import { createHash } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ResolvedRepoInfo as DailyRepoInfo } from "@tangent/repo";

import type { DailyConfig } from "../types/config.js";

export type DailyOutputPaths = {
  globalConfigPath: string;
  repoSharedConfigPath: string;
  outputDir: string;
  privateConfigPath: string;
  ledgerPath: string;
  notesDir: string;
  examplesDir: string;
  artifactsDir: string;
  rollupsDir: string;
  inputsDir: string;
  turnDigestsDir: string;
  topicRollupsDir: string;
  renderDir: string;
  failuresDir: string;
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
    examplesDir: path.join(baseDir, "examples"),
    artifactsDir,
    rollupsDir: path.join(artifactsDir, "rollups"),
    inputsDir: path.join(artifactsDir, "inputs"),
    turnDigestsDir: path.join(artifactsDir, "turn-digests"),
    topicRollupsDir: path.join(artifactsDir, "topic-rollups"),
    renderDir: path.join(artifactsDir, "render"),
    failuresDir: path.join(artifactsDir, "failures")
  };
}

export async function ensureOutputDirs(paths: DailyOutputPaths): Promise<void> {
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(paths.notesDir, { recursive: true });
  await mkdir(paths.examplesDir, { recursive: true });
  await mkdir(paths.rollupsDir, { recursive: true });
  await mkdir(paths.inputsDir, { recursive: true });
  await mkdir(paths.turnDigestsDir, { recursive: true });
  await mkdir(paths.topicRollupsDir, { recursive: true });
  await mkdir(paths.renderDir, { recursive: true });
  await mkdir(paths.failuresDir, { recursive: true });
}

export function notePath(paths: DailyOutputPaths, date: string): string {
  return path.join(paths.notesDir, `${date}.md`);
}

export function turnInputPath(paths: DailyOutputPaths, date: string, sourceKey: string, inputHash: string): string {
  return path.join(paths.inputsDir, date, `${safeFileId(sourceKey)}.${inputHash}.json`);
}

export function dayInputPath(paths: DailyOutputPaths, date: string, inputHash: string): string {
  return dailyRollupInputPath(paths, date, inputHash);
}

export function dayRollupOutputPath(paths: DailyOutputPaths, date: string, inputHash: string): string {
  return dailyRollupOutputPath(paths, date, inputHash);
}

export function dailyRollupInputPath(paths: DailyOutputPaths, date: string, inputHash: string): string {
  return path.join(paths.rollupsDir, date, `input.${inputHash}.json`);
}

export function dailyRollupMessagesPath(paths: DailyOutputPaths, date: string, inputHash: string): string {
  return path.join(paths.rollupsDir, date, `messages.${inputHash}.md`);
}

export function dailyRollupOutputPath(paths: DailyOutputPaths, date: string, inputHash: string): string {
  return path.join(paths.rollupsDir, date, `output.${inputHash}.json`);
}

export function dailyRollupPromptPath(paths: DailyOutputPaths, date: string, inputHash: string): string {
  return path.join(paths.rollupsDir, date, `prompt.${inputHash}.md`);
}

export function turnDigestPath(paths: DailyOutputPaths, date: string, sourceKey: string, inputHash: string): string {
  return path.join(paths.turnDigestsDir, date, `${safeFileId(sourceKey)}.${inputHash}.json`);
}

export function topicRollupPath(paths: DailyOutputPaths, date: string, topicKey: string, hash: string): string {
  return path.join(paths.topicRollupsDir, date, `${safeFileId(topicKey)}.${hash}.json`);
}

export function renderModelPath(paths: DailyOutputPaths, date: string): string {
  return path.join(paths.renderDir, `${date}.model.json`);
}

export function failureArtifactPath(paths: DailyOutputPaths, date: string, sourceKey: string, inputHash: string): string {
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
