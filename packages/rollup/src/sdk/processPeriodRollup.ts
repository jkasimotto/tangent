import type { openUsage } from "@tangent/usage";

import { appendLedgerLine } from "../core/ledger.js";
import { notePath } from "../core/paths.js";
import { loadRollupStyleExamples } from "../core/examples.js";
import { writeRollupInputCache, writeRollupMessagesCache, writeRollupOutputCache, writeRollupPromptCache, writeGeneratedRollupMarkdown } from "../core/note-writer.js";
import { hashObject } from "../core/hash.js";
import { rollupPrompt } from "../core/prompts.js";
import { buildRollupInput, renderRollupMessages } from "../usage/adapter.js";
import type { RollupPeriod } from "../types/period.js";
import type { RunnerStatus, SummaryRunner } from "../types/provider.js";
import type { ProcessResult } from "./processRollup.js";
import {
  ledgerLine,
  summarizeRunnerFailure,
  writeFailureArtifact,
  type ProcessLoadedConfig,
  type ProcessRows
} from "./processShared.js";

export async function processPeriodRollup(args: {
  loaded: ProcessLoadedConfig;
  rows: ProcessRows;
  dataset: Awaited<ReturnType<typeof openUsage>>;
  runner: SummaryRunner & { summarizeRollup: NonNullable<SummaryRunner["summarizeRollup"]> };
  period: RollupPeriod;
  providerStatus: RunnerStatus;
}): Promise<ProcessResult> {
  const { loaded, rows, dataset, runner, period, providerStatus } = args;
  const examples = await loadRollupStyleExamples(loaded, period.startDate);
  const input = buildRollupInput({ dataset, repo: loaded.repo, config: loaded.config, turns: rows.map((row) => row.turn), period, examples });
  const inputHash = hashObject(input);
  const inputPath = await writeRollupInputCache({ loaded, input, inputHash });
  await writeRollupMessagesCache({ loaded, key: period.key, inputHash, markdown: renderRollupMessages(input) });
  await writeRollupPromptCache({ loaded, key: period.key, inputHash, prompt: rollupPrompt({ inputPath, period }) });

  try {
    const output = await runner.summarizeRollup(input);
    const outputPath = await writeRollupOutputCache({ loaded, key: period.key, output, inputHash });
    const note = await writeGeneratedRollupMarkdown(loaded, period, output.markdown);

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
        "rollup.input.v1",
        outputPath,
        period.key
      ));
    }

    return {
      repoId: loaded.repo.id,
      period,
      rollupKey: period.key,
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
        message: `${message}\n\nRollup input: ${inputPath}`,
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
        "rollup.input.v1",
        undefined,
        period.key
      ));
    }

    return {
      repoId: loaded.repo.id,
      period,
      rollupKey: period.key,
      candidates: rows.length,
      processed: 0,
      skipped: 0,
      failed: rows.length,
      digests: rows.map((row) => ({ sourceKey: row.sourceKey, path: "", status: "failed" as const, reason })),
      note: { path: notePath(loaded.paths, period.key), created: false, updated: false },
      providerStatus,
      failures,
      warnings
    };
  }
}
