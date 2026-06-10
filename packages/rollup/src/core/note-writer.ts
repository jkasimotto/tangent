import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "@tangent/repo";

import type { LoadedRollupConfig } from "./config.js";
import type { RollupInput, RollupOutput } from "../types/digest.js";
import type { RollupPeriod } from "../types/period.js";
import {
  rollupMessagesPath,
  rollupPromptPath,
  notePath,
  rollupInputArtifactPath,
  rollupOutputArtifactPath
} from "./paths.js";
import { readLedger, latestSuccessfulRollupForKey } from "./ledger.js";

export async function writeRollupInputCache(args: {
  loaded: LoadedRollupConfig;
  input: RollupInput;
  inputHash: string;
}): Promise<string> {
  const filePath = rollupInputArtifactPath(args.loaded.paths, args.input.period.key, args.inputHash);
  await writeJsonFile(filePath, args.input);
  return filePath;
}

export async function writeRollupOutputCache(args: {
  loaded: LoadedRollupConfig;
  key: string;
  output: RollupOutput;
  inputHash: string;
}): Promise<string> {
  const filePath = rollupOutputArtifactPath(args.loaded.paths, args.key, args.inputHash);
  await writeJsonFile(filePath, args.output);
  return filePath;
}

export async function writeRollupMessagesCache(args: {
  loaded: LoadedRollupConfig;
  key: string;
  inputHash: string;
  markdown: string;
}): Promise<string> {
  const filePath = rollupMessagesPath(args.loaded.paths, args.key, args.inputHash);
  await writeTextFile(filePath, args.markdown);
  return filePath;
}

export async function writeRollupPromptCache(args: {
  loaded: LoadedRollupConfig;
  key: string;
  inputHash: string;
  prompt: string;
}): Promise<string> {
  const filePath = rollupPromptPath(args.loaded.paths, args.key, args.inputHash);
  await writeTextFile(filePath, args.prompt);
  return filePath;
}

export async function readRollupForKey(loaded: LoadedRollupConfig, key: string): Promise<{ output: RollupOutput; path: string } | undefined> {
  const ledger = await readLedger(loaded.paths.ledgerPath);
  const row = latestSuccessfulRollupForKey(ledger, key);
  if (!row?.rollupPath || !(await pathExists(row.rollupPath))) return undefined;
  const output = normalizeRollupOutput(JSON.parse(await readFile(row.rollupPath, "utf8")) as unknown);
  return { output, path: row.rollupPath };
}

export async function writeGeneratedRollupMarkdown(
  loaded: LoadedRollupConfig,
  period: RollupPeriod,
  generatedMarkdown: string
): Promise<{ path: string; markdown: string; created: boolean; updated: boolean }> {
  const target = notePath(loaded.paths, period.key);
  const existed = await pathExists(target);
  const current = existed ? await readFile(target, "utf8") : defaultNoteShell(loaded, period);
  const markdown = replaceGeneratedBlock(current, period, generatedMarkdown);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, markdown, "utf8");
  return { path: target, markdown, created: !existed, updated: current !== markdown };
}

export async function readRollupNote(loaded: LoadedRollupConfig, period: RollupPeriod): Promise<{ path: string; markdown: string; exists: boolean; stale: boolean }> {
  const target = notePath(loaded.paths, period.key);
  if (!(await pathExists(target))) return { path: target, markdown: "", exists: false, stale: true };
  const markdown = await readFile(target, "utf8");
  return { path: target, markdown, exists: true, stale: false };
}

function defaultNoteShell(loaded: LoadedRollupConfig, period: RollupPeriod): string {
  const title = loaded.config.note.titleTemplate
    .replaceAll("{{repo}}", loaded.config.repo?.displayName || loaded.repo.displayName)
    .replaceAll("{{date}}", period.label);
  return `# ${title}\n\n## Manual notes\n\nWrite anything here. Tangent will not modify this section.\n\n`;
}

function replaceGeneratedBlock(markdown: string, period: RollupPeriod, generated: string): string {
  const start = `<!-- tangent:generated:start period=${period.key} schema=rollup.note.v1 -->`;
  const end = "<!-- tangent:generated:end -->";
  const block = `${start}\n${generated.trim()}\n${end}`;
  const pattern = /<!-- tangent:generated:start[^>]* -->[\s\S]*?<!-- tangent:generated:end -->/;
  if (pattern.test(markdown)) return `${markdown.replace(pattern, block).trim()}\n`;
  return `${markdown.trim()}\n\n${block}\n`;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeTextFile(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function normalizeRollupOutput(value: unknown): RollupOutput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    schema: "rollup.output.v1",
    markdown: typeof record.markdown === "string" ? record.markdown : typeof record.generatedMarkdown === "string" ? record.generatedMarkdown : "",
    sourceCaveats: Array.isArray(record.sourceCaveats) ? record.sourceCaveats.filter((item): item is string => typeof item === "string") : []
  };
}
