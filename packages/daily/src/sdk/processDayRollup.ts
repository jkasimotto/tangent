import type { openUsage } from "@tangent/usage";

import { appendLedgerLine } from "../core/ledger.js";
import { notePath } from "../core/paths.js";
import { loadDailyStyleExamples } from "../core/examples.js";
import { writeDayInputCache, writeDayRollupMessagesCache, writeDayRollupOutputCache, writeDayRollupPromptCache, writeGeneratedDailyMarkdown } from "../core/note-writer.js";
import { hashObject } from "../core/hash.js";
import { dayRollupPrompt } from "../core/prompts.js";
import { buildDayRollupInput, renderDailyRollupMessages } from "../usage/adapter.js";
import type { RunnerStatus, SummaryRunner } from "../types/provider.js";
import type { ProcessResult } from "./processUnprocessed.js";
import {
  ledgerLine,
  summarizeRunnerFailure,
  writeFailureArtifact,
  type ProcessLoadedConfig,
  type ProcessRows
} from "./processShared.js";

export async function processDayRollup(args: {
  loaded: ProcessLoadedConfig;
  rows: ProcessRows;
  dataset: Awaited<ReturnType<typeof openUsage>>;
  runner: SummaryRunner & { summarizeDay: NonNullable<SummaryRunner["summarizeDay"]> };
  date: string;
  providerStatus: RunnerStatus;
}): Promise<ProcessResult> {
  const { loaded, rows, dataset, runner, date, providerStatus } = args;
  const examples = await loadDailyStyleExamples(loaded, date);
  const input = buildDayRollupInput({ dataset, repo: loaded.repo, config: loaded.config, turns: rows.map((row) => row.turn), date, examples });
  const inputHash = hashObject(input);
  const inputPath = await writeDayInputCache({ loaded, input, inputHash });
  await writeDayRollupMessagesCache({ loaded, date, inputHash, markdown: renderDailyRollupMessages(input) });
  await writeDayRollupPromptCache({ loaded, date, inputHash, prompt: dayRollupPrompt({ inputPath, date }) });

  try {
    const output = await runner.summarizeDay(input);
    const outputPath = await writeDayRollupOutputCache({ loaded, date, output, inputHash });
    const note = await writeGeneratedDailyMarkdown(loaded, date, output.markdown);

    for (const row of rows) {
      await appendLedgerLine(loaded.paths.ledgerPath, ledgerLine(
        loaded,
        row,
        "processed",
        inputHash,
        undefined,
        undefined,
        undefined,
        undefined,
        "daily.rollup-input.v1",
        outputPath
      ));
    }

    return {
      repoId: loaded.repo.id,
      date,
      candidates: rows.length,
      processed: rows.length,
      skipped: 0,
      failed: 0,
      digests: rows.map((row) => ({ sourceKey: row.sourceKey, path: outputPath, status: "processed" as const })),
      note: {
        path: note.path,
        created: note.created,
        updated: note.updated
      },
      providerStatus,
      failures: [],
      warnings: output.sourceCaveats
    };
  } catch (error) {
    const message = (error as Error).message;
    const reason = summarizeRunnerFailure(message);
    const failures: ProcessResult["failures"] = [];
    const warnings: string[] = [];

    for (const row of rows) {
      const failurePath = await writeFailureArtifact({
        loaded,
        date: row.dateBucket,
        sourceKey: row.sourceKey,
        inputHash,
        reason,
        message: `${message}\n\nDay input: ${inputPath}`,
        stack: (error as Error).stack
      });
      warnings.push(`${row.sourceKey}: ${reason}`);
      failures.push({ sourceKey: row.sourceKey, code: "summary-runner-failed", reason, detailsPath: failurePath });
      await appendLedgerLine(loaded.paths.ledgerPath, ledgerLine(
        loaded,
        row,
        "failed",
        inputHash,
        undefined,
        undefined,
        reason,
        failurePath,
        "daily.rollup-input.v1"
      ));
    }

    return {
      repoId: loaded.repo.id,
      date,
      candidates: rows.length,
      processed: 0,
      skipped: 0,
      failed: rows.length,
      digests: rows.map((row) => ({ sourceKey: row.sourceKey, path: "", status: "failed" as const, reason })),
      note: { path: notePath(loaded.paths, date), created: false, updated: false },
      providerStatus,
      failures,
      warnings
    };
  }
}
