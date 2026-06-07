import { ensureOutputDirs } from "../core/paths.js";
import { appendLedgerLine } from "../core/ledger.js";
import { loadConfig } from "../core/config.js";
import { dateArgToBucket, todayBucket } from "../core/time.js";
import { writeDailyNote, writeDigestCache } from "../core/note-writer.js";
import { normalizeSessionDigest } from "../core/schemas.js";
import { createSummaryRunner } from "../runners/summary-runner.js";
import { collectUnprocessed, type UnprocessedConversationQuery } from "../convos/selectors.js";
import type { SessionDigest } from "../types/digest.js";

export type ProcessUnprocessedOptions = UnprocessedConversationQuery & {
  provider?: "claude" | "codex";
};

export type ProcessResult = {
  repoId: string;
  date: string;
  processed: number;
  skipped: number;
  failed: number;
  digests: Array<{
    conversationId: string;
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
  const rows = await collectUnprocessed(loaded, { ...options, providers, date });
  const runner = createSummaryRunner(loaded.config.summary.provider);
  const digests: ProcessResult["digests"] = [];
  const warnings: string[] = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const touchedDates = new Set<string>();

  for (const row of rows) {
    if (isEmptyInput(row.input)) {
      skipped += 1;
      await appendLedgerLine(loaded.paths.ledgerPath, ledgerLine(loaded, row, "skipped-empty"));
      digests.push({ conversationId: row.conversationId, path: "", status: "skipped" });
      continue;
    }

    try {
      const digest = withConversationDefaults(await runner.summarizeSession(row.input), row.input);
      const digestPath = loaded.config.summary.writeDigestCache
        ? await writeDigestCache({ loaded, digest, inputHash: row.inputHash })
        : "";
      processed += 1;
      touchedDates.add(row.dateBucket);
      await appendLedgerLine(loaded.paths.ledgerPath, ledgerLine(loaded, row, "processed", digestPath));
      digests.push({ conversationId: row.conversationId, path: digestPath, status: "processed" });
    } catch (error) {
      failed += 1;
      const message = (error as Error).message;
      warnings.push(`${row.conversationId}: ${message}`);
      await appendLedgerLine(loaded.paths.ledgerPath, ledgerLine(loaded, row, "failed", undefined, message));
      digests.push({ conversationId: row.conversationId, path: "", status: "failed" });
    }
  }

  const resultDate = date || [...touchedDates][0] || todayBucket(loaded.config.processing.timezone);
  const noteDate = touchedDates.has(resultDate) || date ? resultDate : [...touchedDates][0] || resultDate;
  const note = await writeDailyNote(loaded, noteDate);
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

function ledgerLine(
  loaded: Awaited<ReturnType<typeof loadConfig>>,
  row: Awaited<ReturnType<typeof collectUnprocessed>>[number],
  status: "processed" | "skipped-empty" | "failed",
  digestPath?: string,
  errorMessage?: string
) {
  return {
    schema: "daily.ledger.v1" as const,
    repoId: loaded.repo.id,
    repoRootHash: loaded.repo.rootHash,
    conversationId: row.conversationId,
    provider: row.provider,
    inputHash: row.inputHash,
    eventHighWatermark: row.eventHighWatermark,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    lastActivityAt: row.lastActivityAt,
    dateBucket: row.dateBucket,
    processedAt: new Date().toISOString(),
    status,
    digestPath,
    error: errorMessage ? { code: "summary-runner-failed", message: errorMessage } : undefined
  };
}

function isEmptyInput(input: Awaited<ReturnType<typeof collectUnprocessed>>[number]["input"]): boolean {
  return input.messages.length === 0 && input.tools.length === 0 && input.commands.length === 0;
}

function withConversationDefaults(digest: SessionDigest, input: Awaited<ReturnType<typeof collectUnprocessed>>[number]["input"]): SessionDigest {
  return normalizeSessionDigest({
    ...digest,
    conversation: {
      ...digest.conversation,
      id: digest.conversation.id || input.conversation.id,
      provider: digest.conversation.provider || input.conversation.provider,
      title: digest.conversation.title || input.conversation.title || "Untitled conversation",
      startedAt: digest.conversation.startedAt || input.conversation.startedAt,
      endedAt: digest.conversation.endedAt || input.conversation.endedAt,
      dateBucket: digest.conversation.dateBucket || input.conversation.dateBucket,
      branch: digest.conversation.branch || input.repo.branch
    },
    metrics: {
      ...digest.metrics,
      tokensTotal: digest.metrics?.tokensTotal || input.metrics?.tokens?.total,
      toolCalls: digest.metrics?.toolCalls || input.metrics?.toolCalls,
      filesRead: digest.metrics?.filesRead || input.files.read.length,
      filesWritten: digest.metrics?.filesWritten || input.files.written.length,
      testsRun: digest.metrics?.testsRun || input.commands.filter((command) => command.classification.isTest).length,
      testFailures: digest.metrics?.testFailures || input.commands.filter((command) => command.classification.isTest && command.status === "error").length
    }
  });
}
