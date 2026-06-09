import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "@tangent/repo";

import type { LoadedDailyConfig } from "./config.js";
import type { DailyNote } from "../types/daily-note.js";
import type { DailyRollupInput, DailyRollupOutput, TopicRollup, TurnDigest, TurnDigestInput } from "../types/digest.js";
import { hashObject } from "./hash.js";
import {
  dailyRollupMessagesPath,
  dailyRollupPromptPath,
  dayInputPath,
  dayRollupOutputPath,
  notePath,
  renderModelPath,
  topicRollupPath,
  turnDigestPath,
  turnInputPath
} from "./paths.js";
import { readLedger, latestSuccessfulDayRollupForDate, latestSuccessfulDigestsForDate } from "./ledger.js";
import { fallbackTopicRollup, groupTurnDigests } from "./grouping.js";
import { renderDailyNote } from "./renderer.js";

export async function writeTurnInputCache(args: {
  loaded: LoadedDailyConfig;
  input: TurnDigestInput;
  inputHash: string;
}): Promise<string> {
  const filePath = turnInputPath(args.loaded.paths, args.input.source.dateBucket, args.input.source.sourceKey, args.inputHash);
  await writeJsonFile(filePath, args.input);
  return filePath;
}

export async function writeDayInputCache(args: {
  loaded: LoadedDailyConfig;
  input: DailyRollupInput;
  inputHash: string;
}): Promise<string> {
  const filePath = dayInputPath(args.loaded.paths, args.input.date, args.inputHash);
  await writeJsonFile(filePath, args.input);
  return filePath;
}

export async function writeDayRollupOutputCache(args: {
  loaded: LoadedDailyConfig;
  date: string;
  output: DailyRollupOutput;
  inputHash: string;
}): Promise<string> {
  const filePath = dayRollupOutputPath(args.loaded.paths, args.date, args.inputHash);
  await writeJsonFile(filePath, args.output);
  return filePath;
}

export async function writeDayRollupMessagesCache(args: {
  loaded: LoadedDailyConfig;
  date: string;
  inputHash: string;
  markdown: string;
}): Promise<string> {
  const filePath = dailyRollupMessagesPath(args.loaded.paths, args.date, args.inputHash);
  await writeTextFile(filePath, args.markdown);
  return filePath;
}

export async function writeDayRollupPromptCache(args: {
  loaded: LoadedDailyConfig;
  date: string;
  inputHash: string;
  prompt: string;
}): Promise<string> {
  const filePath = dailyRollupPromptPath(args.loaded.paths, args.date, args.inputHash);
  await writeTextFile(filePath, args.prompt);
  return filePath;
}

export async function writeTurnDigestCache(args: {
  loaded: LoadedDailyConfig;
  digest: TurnDigest;
  inputHash: string;
}): Promise<string> {
  const filePath = turnDigestPath(args.loaded.paths, args.digest.source.dateBucket, args.digest.source.sourceKey, args.inputHash);
  await writeJsonFile(filePath, args.digest);
  return filePath;
}

export async function writeTopicRollupCache(args: {
  loaded: LoadedDailyConfig;
  rollup: TopicRollup;
}): Promise<string> {
  const hash = hashObject(args.rollup);
  const filePath = topicRollupPath(args.loaded.paths, args.rollup.date, args.rollup.key, hash);
  await writeJsonFile(filePath, args.rollup);
  return filePath;
}

export async function readDigestsForDate(loaded: LoadedDailyConfig, date: string): Promise<Array<{ digest: TurnDigest; hash: string; path: string }>> {
  const ledger = await readLedger(loaded.paths.ledgerPath);
  const rows = latestSuccessfulDigestsForDate(ledger, date);
  const result: Array<{ digest: TurnDigest; hash: string; path: string }> = [];
  for (const row of rows) {
    if (!row.digestPath || !(await pathExists(row.digestPath))) continue;
    const digest = JSON.parse(await readFile(row.digestPath, "utf8")) as TurnDigest;
    result.push({ digest, hash: hashObject(digest), path: row.digestPath });
  }
  return result;
}

export async function readDayRollupForDate(loaded: LoadedDailyConfig, date: string): Promise<{ output: DailyRollupOutput; path: string } | undefined> {
  const ledger = await readLedger(loaded.paths.ledgerPath);
  const row = latestSuccessfulDayRollupForDate(ledger, date);
  if (!row?.rollupPath || !(await pathExists(row.rollupPath))) return undefined;
  const output = normalizeDailyRollupOutput(JSON.parse(await readFile(row.rollupPath, "utf8")) as unknown);
  return { output, path: row.rollupPath };
}

export async function writeDailyNote(
  loaded: LoadedDailyConfig,
  date: string,
  topics?: TopicRollup[]
): Promise<{ path: string; markdown: string; model: DailyNote; created: boolean; updated: boolean }> {
  const topicRows = topics || await topicsFromLedger(loaded, date);
  const model = buildDailyNote(loaded, date, topicRows);
  await writeJsonFile(renderModelPath(loaded.paths, date), model);
  const generated = renderDailyNote(model, loaded.config);
  const target = notePath(loaded.paths, date);
  const existed = await pathExists(target);
  const current = existed ? await readFile(target, "utf8") : defaultNoteShell(loaded, date);
  const markdown = replaceGeneratedBlock(current, date, generated);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, markdown, "utf8");
  return { path: target, markdown, model, created: !existed, updated: current !== markdown };
}

export async function writeGeneratedDailyMarkdown(
  loaded: LoadedDailyConfig,
  date: string,
  generatedMarkdown: string
): Promise<{ path: string; markdown: string; created: boolean; updated: boolean }> {
  const target = notePath(loaded.paths, date);
  const existed = await pathExists(target);
  const current = existed ? await readFile(target, "utf8") : defaultNoteShell(loaded, date);
  const markdown = replaceGeneratedBlock(current, date, generatedMarkdown);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, markdown, "utf8");
  return { path: target, markdown, created: !existed, updated: current !== markdown };
}

export async function readDailyNote(loaded: LoadedDailyConfig, date: string): Promise<{ path: string; markdown: string; model?: DailyNote; exists: boolean; stale: boolean }> {
  const target = notePath(loaded.paths, date);
  if (!(await pathExists(target))) return { path: target, markdown: "", exists: false, stale: true };
  const markdown = await readFile(target, "utf8");
  return { path: target, markdown, exists: true, stale: false };
}

function buildDailyNote(loaded: LoadedDailyConfig, date: string, topics: TopicRollup[]): DailyNote {
  const turnKeys = topics.flatMap((topic) => topic.sourceTurnKeys);
  return {
    schema: "daily.note.v2",
    repo: {
      id: loaded.repo.id,
      name: loaded.config.repo?.displayName || loaded.repo.displayName,
      rootHash: loaded.repo.rootHash,
      branch: loaded.repo.branch
    },
    date,
    timezone: loaded.config.processing.timezone,
    generatedAt: new Date().toISOString(),
    source: {
      turnKeys,
      providers: unique(topics.flatMap((topic) => topic.providers)),
      topicKeys: topics.map((topic) => topic.key),
      dailyVersion: "0.2.0"
    },
    topics,
    metrics: loaded.config.note.includeMetrics ? {
      turns: turnKeys.length,
      topics: topics.length,
      toolCalls: 0,
      commandCalls: 0,
      filesTouched: unique(topics.flatMap((topic) => topic.evidence.flatMap((entry) => entry.file || []))).length,
      activeAgentWallTimeMs: sum(topics.map((topic) => topic.timeSpentMs))
    } : undefined,
    sourceCaveats: unique(topics.flatMap((topic) => topic.caveats))
  };
}

async function topicsFromLedger(loaded: LoadedDailyConfig, date: string): Promise<TopicRollup[]> {
  const digestRows = await readDigestsForDate(loaded, date);
  return groupTurnDigests(digestRows.map((row) => row.digest)).map((group) => fallbackTopicRollup(date, group));
}

function defaultNoteShell(loaded: LoadedDailyConfig, date: string): string {
  const title = loaded.config.note.titleTemplate
    .replaceAll("{{repo}}", loaded.config.repo?.displayName || loaded.repo.displayName)
    .replaceAll("{{date}}", date);
  return `# ${title}\n\n## Manual notes\n\nWrite anything here. Tangent will not modify this section.\n\n`;
}

function replaceGeneratedBlock(markdown: string, date: string, generated: string): string {
  const start = `<!-- tangent:generated:start date=${date} schema=daily.note.v2 -->`;
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

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

function sum(values: Array<number | undefined>): number | undefined {
  const total = values.reduce<number>((acc, value) => acc + (value || 0), 0);
  return total || undefined;
}

function normalizeDailyRollupOutput(value: unknown): DailyRollupOutput {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    schema: "daily.rollup.v1",
    markdown: typeof record.markdown === "string" ? record.markdown : typeof record.generatedMarkdown === "string" ? record.generatedMarkdown : "",
    sourceCaveats: Array.isArray(record.sourceCaveats) ? record.sourceCaveats.filter((item): item is string => typeof item === "string") : []
  };
}
