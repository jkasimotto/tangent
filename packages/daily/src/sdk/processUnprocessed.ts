import { openUsage } from "@tangent/usage";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ensureOutputDirs, failureArtifactPath, notePath } from "../core/paths.js";
import { appendLedgerLine } from "../core/ledger.js";
import { loadConfig } from "../core/config.js";
import { dateArgToBucket, todayBucket } from "../core/time.js";
import { readDigestsForDate, writeDailyNote, writeTopicRollupCache, writeTurnDigestCache, writeTurnInputCache } from "../core/note-writer.js";
import { normalizeTopicRollup } from "../core/schemas.js";
import { createSummaryRunner } from "../runners/summary-runner.js";
import { collectCandidates, type CandidateQuery } from "../usage/selectors.js";
import { buildTurnDigestInput } from "../usage/adapter.js";
import { hashObject } from "../core/hash.js";
import { fallbackTopicRollup, groupTurnDigests } from "../core/grouping.js";
import type { DailyLedgerLineV2 } from "../types/ledger.js";
import type { TopicRollup, TurnDigest, TurnDigestInput } from "../types/digest.js";
import type { RunnerStatus, SummaryRunner } from "../types/provider.js";

export type ProcessUnprocessedOptions = CandidateQuery & {
  provider?: "claude" | "codex";
  dryRun?: boolean;
  summaryRunner?: SummaryRunner;
};

export type ProcessResult = {
  repoId: string;
  date: string;
  dryRun?: boolean;
  candidates: number;
  processed: number;
  skipped: number;
  failed: number;
  digests: Array<{
    sourceKey: string;
    path: string;
    status: "processed" | "failed" | "skipped";
    failurePath?: string;
    reason?: string;
  }>;
  note: {
    path: string;
    created: boolean;
    updated: boolean;
  };
  providerStatus?: RunnerStatus;
  failures: Array<{
    sourceKey: string;
    code: string;
    reason: string;
    detailsPath: string;
  }>;
  warnings: string[];
};

export async function processUnprocessed(options: ProcessUnprocessedOptions): Promise<ProcessResult> {
  const loaded = await loadConfig({ repo: options.repo });
  await ensureOutputDirs(loaded.paths);
  const date = dateArgToBucket(options.date, loaded.config.processing.timezone);
  const providers = options.provider ? [options.provider] : options.providers;
  const fallbackDate = date || todayBucket(loaded.config.processing.timezone);
  const fallbackNotePath = notePath(loaded.paths, fallbackDate);
  const rows = await collectCandidates(loaded, { ...options, providers, date });
  if (options.dryRun) {
    return {
      repoId: loaded.repo.id,
      date: fallbackDate,
      dryRun: true,
      candidates: rows.length,
      processed: 0,
      skipped: 0,
      failed: 0,
      digests: rows.map((row) => ({ sourceKey: row.sourceKey, path: "", status: "skipped" as const, reason: `would process: ${row.reason}` })),
      note: { path: fallbackNotePath, created: false, updated: false },
      failures: [],
      warnings: []
    };
  }
  const runner = options.summaryRunner || createSummaryRunner(loaded.config.summary.provider);
  const providerStatus = await runner.checkAvailable();
  if (!providerStatus.available) {
    const reason = providerStatus.warnings[0] || `${loaded.config.summary.provider.kind} is unavailable.`;
    return {
      repoId: loaded.repo.id,
      date: fallbackDate,
      candidates: 0,
      processed: 0,
      skipped: 0,
      failed: 0,
      digests: [],
      note: { path: fallbackNotePath, created: false, updated: false },
      providerStatus,
      failures: [],
      warnings: [`Summary provider unavailable: ${reason}`]
    };
  }
  const dataset = await openUsage({ repo: loaded.repo.root, providers: providers || loaded.config.input.providers });
  const digests: ProcessResult["digests"] = [];
  const failures: ProcessResult["failures"] = [];
  const warnings: string[] = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const touchedDates = new Set<string>();

  for (const row of rows) {
    const input = buildTurnDigestInput({ dataset, repo: loaded.repo, config: loaded.config, turn: row.turn, dateBucket: row.dateBucket });
    const inputHash = hashObject(input);
    await writeTurnInputCache({ loaded, input, inputHash });

    if (isEmptyInput(input)) {
      skipped += 1;
      await appendLedgerLine(loaded.paths.ledgerPath, ledgerLine(loaded, row, "skipped-empty", inputHash));
      digests.push({ sourceKey: row.sourceKey, path: "", status: "skipped" });
      continue;
    }

    try {
      const digest = withSourceDefaults(await runner.summarizeTurn(input), input, inputHash);
      const digestPath = loaded.config.summary.writeDigestCache
        ? await writeTurnDigestCache({ loaded, digest, inputHash })
        : "";
      processed += 1;
      touchedDates.add(row.dateBucket);
      await appendLedgerLine(loaded.paths.ledgerPath, ledgerLine(loaded, row, "processed", inputHash, digestPath, digest.topicHints.map((hint) => hint.key)));
      digests.push({ sourceKey: row.sourceKey, path: digestPath, status: "processed" });
    } catch (error) {
      failed += 1;
      const message = (error as Error).message;
      const reason = summarizeRunnerFailure(message);
      const failurePath = await writeFailureArtifact({
        loaded,
        date: row.dateBucket,
        sourceKey: row.sourceKey,
        inputHash,
        reason,
        message,
        stack: (error as Error).stack
      });
      warnings.push(`${row.sourceKey}: ${reason}`);
      failures.push({ sourceKey: row.sourceKey, code: "summary-runner-failed", reason, detailsPath: failurePath });
      await appendLedgerLine(loaded.paths.ledgerPath, ledgerLine(loaded, row, "failed", inputHash, undefined, undefined, reason, failurePath));
      digests.push({ sourceKey: row.sourceKey, path: "", status: "failed", failurePath, reason });
    }
  }

  const resultDate = date || [...touchedDates][0] || todayBucket(loaded.config.processing.timezone);
  const noteDate = touchedDates.has(resultDate) || date ? resultDate : [...touchedDates][0] || resultDate;
  const latestDigests = await readDigestsForDate(loaded, noteDate);
  const noteDigests = latestDigests.map((row) => row.digest);
  const topics = noteDigests.length ? await rollupTopics(noteDate, noteDigests, runner) : [];
  for (const topic of topics) await writeTopicRollupCache({ loaded, rollup: topic });
  const note = topics.length
    ? await writeDailyNote(loaded, noteDate, topics)
    : { path: notePath(loaded.paths, noteDate), created: false, updated: false };

  return {
    repoId: loaded.repo.id,
    date: noteDate,
    candidates: rows.length,
    processed,
    skipped,
    failed,
    digests,
    note: {
      path: note.path,
      created: note.created,
      updated: note.updated
    },
    providerStatus,
    failures,
    warnings
  };
}

async function writeFailureArtifact(args: {
  loaded: Awaited<ReturnType<typeof loadConfig>>;
  date: string;
  sourceKey: string;
  inputHash: string;
  reason: string;
  message: string;
  stack?: string;
}): Promise<string> {
  const filePath = failureArtifactPath(args.loaded.paths, args.date, args.sourceKey, args.inputHash);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, [
    `source: ${args.sourceKey}`,
    `reason: ${args.reason}`,
    "",
    "message:",
    args.message,
    "",
    "stack:",
    args.stack || "(none)",
    ""
  ].join("\n"), "utf8");
  return filePath;
}

function summarizeRunnerFailure(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("json") || lower.includes("schema")) return "Summary runner returned non-JSON output";
  if (lower.includes("timed out")) return "Summary runner timed out";
  if (lower.includes("command not found") || lower.includes("enoent")) return "Summary provider command was not found";
  return "Summary runner failed";
}

async function rollupTopics(date: string, digests: TurnDigest[], runner: ReturnType<typeof createSummaryRunner>): Promise<TopicRollup[]> {
  const groups = groupTurnDigests(digests);
  const topics: TopicRollup[] = [];
  for (const group of groups) {
    const fallback = fallbackTopicRollup(date, group);
    if (!runner.rollupTopic) {
      topics.push(fallback);
      continue;
    }
    try {
      topics.push(normalizeTopicRollup(await runner.rollupTopic({ date, key: group.key, title: group.title, digests: group.digests }), fallback));
    } catch {
      topics.push(fallback);
    }
  }
  return topics;
}

function ledgerLine(
  loaded: Awaited<ReturnType<typeof loadConfig>>,
  row: Awaited<ReturnType<typeof collectCandidates>>[number],
  status: DailyLedgerLineV2["status"],
  inputHash: string,
  digestPath?: string,
  topicKeys?: string[],
  errorMessage?: string,
  failurePath?: string
): DailyLedgerLineV2 {
  return {
    schema: "daily.ledger.v2",
    repoId: loaded.repo.id,
    dateBucket: row.dateBucket,
    sourceKey: row.sourceKey,
    provider: row.provider,
    conversationId: row.conversationId,
    turnId: row.turnId,
    sourceFingerprint: row.sourceFingerprint,
    inputVersion: "daily.turn-digest-input.v1",
    inputHash,
    digestPath,
    failurePath,
    topicKeys,
    processedAt: new Date().toISOString(),
    status,
    error: errorMessage ? { code: "summary-runner-failed", message: errorMessage } : undefined
  };
}

function isEmptyInput(input: TurnDigestInput): boolean {
  return input.transcript.length === 0 &&
    input.activity.commands.length === 0 &&
    input.activity.toolHighlights.length === 0 &&
    input.activity.fileChanges.length === 0;
}

function withSourceDefaults(digest: TurnDigest, input: TurnDigestInput, inputHash: string): TurnDigest {
  const source = {
    sourceKey: input.source.sourceKey,
    provider: input.source.provider,
    conversationId: input.source.conversationId,
    turnId: input.source.turnId,
    dateBucket: input.source.dateBucket,
    startedAt: input.source.startedAt,
    endedAt: input.source.endedAt,
    wallTimeMs: input.source.wallTimeMs,
    inputHash
  };
  const next: TurnDigest = {
    ...digest,
    source: { ...source, ...digest.source, inputHash },
    topicHints: digest.topicHints.length ? digest.topicHints : [{
      key: slug(digest.entities.files[0] || digest.headline || "general"),
      title: titleFromKey(digest.entities.files[0] || digest.headline || "General"),
      confidence: "low"
    }]
  };
  return next;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "general";
}

function titleFromKey(value: string): string {
  return value.replace(/[-_\/]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
