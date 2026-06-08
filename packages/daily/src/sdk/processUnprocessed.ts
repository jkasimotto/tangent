import { openConvos } from "@convos/convos";

import { ensureOutputDirs } from "../core/paths.js";
import { appendLedgerLine } from "../core/ledger.js";
import { loadConfig } from "../core/config.js";
import { dateArgToBucket, todayBucket } from "../core/time.js";
import { writeDailyNote, writeTopicRollupCache, writeTurnDigestCache, writeTurnInputCache } from "../core/note-writer.js";
import { normalizeTopicRollup } from "../core/schemas.js";
import { createSummaryRunner } from "../runners/summary-runner.js";
import { collectCandidates, type CandidateQuery } from "../convos/selectors.js";
import { buildTurnDigestInput } from "../convos/adapter.js";
import { hashObject } from "../core/hash.js";
import { fallbackTopicRollup, groupTurnDigests } from "../core/grouping.js";
import type { DailyLedgerLineV2 } from "../types/ledger.js";
import type { TopicRollup, TurnDigest, TurnDigestInput } from "../types/digest.js";

export type ProcessUnprocessedOptions = CandidateQuery & {
  provider?: "claude" | "codex";
};

export type ProcessResult = {
  repoId: string;
  date: string;
  processed: number;
  skipped: number;
  failed: number;
  digests: Array<{
    sourceKey: string;
    path: string;
    status: "processed" | "failed" | "skipped";
  }>;
  note: {
    path: string;
    created: boolean;
    updated: boolean;
  };
  warnings: string[];
};

export async function processUnprocessed(options: ProcessUnprocessedOptions): Promise<ProcessResult> {
  const loaded = await loadConfig({ repo: options.repo });
  await ensureOutputDirs(loaded.paths);
  const date = dateArgToBucket(options.date, loaded.config.processing.timezone);
  const providers = options.provider ? [options.provider] : options.providers;
  const rows = await collectCandidates(loaded, { ...options, providers, date });
  const dataset = await openConvos({ repo: loaded.repo.root, providers: providers || loaded.config.input.providers });
  const runner = createSummaryRunner(loaded.config.summary.provider);
  const digests: ProcessResult["digests"] = [];
  const processedDigests: TurnDigest[] = [];
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
      processedDigests.push(digest);
      await appendLedgerLine(loaded.paths.ledgerPath, ledgerLine(loaded, row, "processed", inputHash, digestPath, digest.topicHints.map((hint) => hint.key)));
      digests.push({ sourceKey: row.sourceKey, path: digestPath, status: "processed" });
    } catch (error) {
      failed += 1;
      const message = (error as Error).message;
      warnings.push(`${row.sourceKey}: ${message}`);
      await appendLedgerLine(loaded.paths.ledgerPath, ledgerLine(loaded, row, "failed", inputHash, undefined, undefined, message));
      digests.push({ sourceKey: row.sourceKey, path: "", status: "failed" });
    }
  }

  const resultDate = date || [...touchedDates][0] || todayBucket(loaded.config.processing.timezone);
  const noteDate = touchedDates.has(resultDate) || date ? resultDate : [...touchedDates][0] || resultDate;
  const topics = await rollupTopics(noteDate, processedDigests, runner);
  for (const topic of topics) await writeTopicRollupCache({ loaded, rollup: topic });
  const note = await writeDailyNote(loaded, noteDate, topics.length ? topics : undefined);

  return {
    repoId: loaded.repo.id,
    date: noteDate,
    processed,
    skipped,
    failed,
    digests,
    note: {
      path: note.path,
      created: note.created,
      updated: note.updated
    },
    warnings
  };
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
  errorMessage?: string
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
