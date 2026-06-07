import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LoadedDailyConfig } from "./config.js";
import type { DailyNote } from "../types/daily-note.js";
import type { SessionDigest } from "../types/digest.js";
import { hashObject } from "./hash.js";
import { digestPath, notePath, userIdHash } from "./paths.js";
import { pathExists } from "./repo.js";
import { groupWorkSessions } from "./grouping.js";
import { renderDailyNote } from "./renderer.js";

export async function writeDigestCache(args: {
  loaded: LoadedDailyConfig;
  digest: SessionDigest;
  inputHash: string;
}): Promise<string> {
  const filePath = digestPath(args.loaded.paths, args.digest.conversation.id, args.inputHash);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(args.digest, null, 2)}\n`, "utf8");
  return filePath;
}

export async function readDigestsForDate(loaded: LoadedDailyConfig, date: string): Promise<Array<{ digest: SessionDigest; hash: string; path: string }>> {
  if (!(await pathExists(loaded.paths.digestsDir))) return [];
  const entries = await readdir(loaded.paths.digestsDir, { withFileTypes: true });
  const rows: Array<{ digest: SessionDigest; hash: string; path: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(loaded.paths.digestsDir, entry.name);
    const digest = JSON.parse(await readFile(filePath, "utf8")) as SessionDigest;
    if (digest.conversation.dateBucket !== date) continue;
    rows.push({ digest, hash: hashObject(digest), path: filePath });
  }
  return rows;
}

export async function writeDailyNote(loaded: LoadedDailyConfig, date: string): Promise<{ path: string; markdown: string; model: DailyNote; created: boolean; updated: boolean }> {
  const digestRows = await readDigestsForDate(loaded, date);
  const digests = digestRows.map((row) => row.digest);
  const model = buildDailyNote(loaded, date, digests, digestRows.map((row) => row.hash));
  const markdown = renderDailyNote(model, loaded.config);
  const target = notePath(loaded.paths, date);
  const existed = await pathExists(target);
  const current = existed ? await readFile(target, "utf8") : undefined;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, markdown, "utf8");
  return { path: target, markdown, model, created: !existed, updated: current !== markdown };
}

export async function readDailyNote(loaded: LoadedDailyConfig, date: string): Promise<{ path: string; markdown: string; model?: DailyNote; exists: boolean; stale: boolean }> {
  const target = notePath(loaded.paths, date);
  if (!(await pathExists(target))) return { path: target, markdown: "", exists: false, stale: true };
  const markdown = await readFile(target, "utf8");
  return { path: target, markdown, exists: true, stale: false };
}

function buildDailyNote(loaded: LoadedDailyConfig, date: string, digests: SessionDigest[], digestHashes: string[]): DailyNote {
  const workSessions = groupWorkSessions({ digests, repo: loaded.repo, date, config: loaded.config });
  const allDone = unique(digests.flatMap((digest) => digest.standup.done));
  const allNext = unique(digests.flatMap((digest) => digest.standup.next));
  const allBlockers = unique(digests.flatMap((digest) => digest.standup.blockers));
  const decisions = digests.flatMap((digest) => digest.decisions);
  const experiments = digests.flatMap((digest) => digest.experiments);
  const designSeeds = digests.flatMap((digest) => digest.designNotes);
  const followUps = digests.flatMap((digest) => digest.followUps);
  const risks = digests.flatMap((digest) => digest.risks);
  const themes = inferThemes(digests);

  return {
    schema: "daily.note.v1",
    repo: {
      id: loaded.repo.id,
      name: loaded.config.repo?.displayName || loaded.repo.displayName,
      rootHash: loaded.repo.rootHash,
      branch: loaded.repo.branch
    },
    user: {
      idHash: userIdHash()
    },
    date,
    timezone: loaded.config.processing.timezone,
    generatedAt: new Date().toISOString(),
    source: {
      conversationIds: digests.map((digest) => digest.conversation.id),
      digestHashes,
      dailyVersion: "0.1.0"
    },
    standup: {
      done: allDone,
      next: allNext,
      blockers: allBlockers
    },
    daySummary: {
      short: summarizeDay(digests),
      themes
    },
    workSessions,
    decisions,
    experiments,
    designSeeds,
    followUps,
    risks,
    metrics: loaded.config.note.includeMetrics ? aggregateMetrics(digests) : undefined,
    sourceCaveats: sourceCaveats(loaded, digests)
  };
}

function summarizeDay(digests: SessionDigest[]): string {
  if (!digests.length) return "No conversations have been processed for this date yet.";
  if (digests.length === 1) return digests[0]!.summary.short;
  const headlines = digests.map((digest) => digest.headline).filter(Boolean).slice(0, 4);
  return `Work focused on ${headlines.join("; ")}.`;
}

function inferThemes(digests: SessionDigest[]): string[] {
  return unique([
    ...digests.flatMap((digest) => digest.workDone.flatMap((entry) => entry.files || []).map((file) => file.split("/")[0]).filter(Boolean)),
    ...digests.flatMap((digest) => digest.designNotes.map((entry) => entry.title))
  ]).slice(0, 8);
}

function aggregateMetrics(digests: SessionDigest[]): NonNullable<DailyNote["metrics"]> {
  return {
    conversations: digests.length,
    toolCalls: sum(digests.map((digest) => digest.metrics?.toolCalls)),
    filesRead: sum(digests.map((digest) => digest.metrics?.filesRead)),
    filesWritten: sum(digests.map((digest) => digest.metrics?.filesWritten)),
    testsRun: sum(digests.map((digest) => digest.metrics?.testsRun)),
    testFailures: sum(digests.map((digest) => digest.metrics?.testFailures)),
    tokensTotal: sum(digests.map((digest) => digest.metrics?.tokensTotal)) || undefined
  };
}

function sourceCaveats(loaded: LoadedDailyConfig, digests: SessionDigest[]): string[] {
  const caveats: string[] = [];
  if (!loaded.config.input.includeInternalMessages) caveats.push("Internal thinking/planning messages were excluded by daily config.");
  if (loaded.config.privacy.contentMode !== "full") caveats.push(`Conversation content used ${loaded.config.privacy.contentMode} privacy mode.`);
  if (digests.some((digest) => digest.quality.confidence === "low")) caveats.push("At least one session digest had low summarizer confidence.");
  if (digests.some((digest) => digest.metrics?.tokensTotal === undefined)) caveats.push("Token usage was unavailable or incomplete for at least one conversation.");
  return unique(caveats);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (value || 0), 0);
}
