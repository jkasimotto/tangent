import type { openUsage } from "@tangent/usage-index-sqlite";

import { appendLedgerLine } from "../core/ledger.js";
import { loadRollupStyleExamples } from "../core/examples.js";
import {
  writeRollupInputCache,
  writeRollupMessagesCache,
  writeRollupOutputCache,
  writeRollupPromptCache,
  writeGeneratedRollupMarkdown,
  resolveRollupNotePath
} from "../core/note-writer.js";
import { hashObject } from "../core/hash.js";
import { rollupPrompt } from "../core/prompts.js";
import { buildRollupInput, renderRollupMessages } from "../usage/adapter.js";
import type { RollupPeriod } from "../types/period.js";
import type { RollupPurpose } from "../types/digest.js";
import type { RunnerStatus, SummaryRunner } from "../types/provider.js";
import type { ProcessResult } from "./processRollup.js";
import {
  ledgerLine,
  summarizeRunnerFailure,
  writeFailureArtifact,
  type ProcessLoadedConfig,
  type ProcessRows
} from "./processShared.js";

/**
 * Builds rollup input from selected turns, writes artifacts, and invokes summarization.
 */
export async function processPeriodRollup(args: {
  loaded: ProcessLoadedConfig;
  rows: ProcessRows;
  dataset: Awaited<ReturnType<typeof openUsage>>;
  runner: SummaryRunner;
  period: RollupPeriod;
  providerStatus: RunnerStatus;
  purpose?: RollupPurpose;
  output?: {
    filename?: string;
    outputPath?: string;
    overwrite?: boolean;
  };
}): Promise<ProcessResult> {
  const {
    loaded,
    rows,
    dataset,
    runner,
    period,
    providerStatus,
    purpose,
    output: noteOutput
  } = args;
  const examples = await loadRollupStyleExamples(loaded, period.startDate);
  const input = buildRollupInput({ dataset, repo: loaded.repo, config: loaded.config, turns: rows.map((row) => row.turn), period, examples, purpose });
  const notePath = await resolveRollupNotePath({
    loaded,
    period,
    filename: noteOutput?.filename,
    outputPath: noteOutput?.outputPath,
    overwrite: noteOutput?.overwrite
  });
  const inputHash = hashObject(input);
  const inputPath = await writeRollupInputCache({ loaded, input, inputHash });
  const messagesPath = await writeRollupMessagesCache({
    loaded,
    key: period.key,
    inputHash,
    markdown: renderRollupMessages(input)
  });
  const prompt = rollupPrompt({ inputPath, period, purpose });
  const promptPath = await writeRollupPromptCache({
    loaded,
    key: period.key,
    inputHash,
    prompt
  });

  const artifacts = {
    inputPath,
    messagesPath,
    promptPath,
    outputPath: undefined as string | undefined
  };

  try {
    const rollupOutput = await runner.summarizeRollup(input);
    const rollupOutputPath = await writeRollupOutputCache({ loaded, key: period.key, output: rollupOutput, inputHash });
    artifacts.outputPath = rollupOutputPath;
    const note = await writeGeneratedRollupMarkdown(loaded, period, rollupOutput.markdown, {
      filename: noteOutput?.filename,
      outputPath: noteOutput?.outputPath,
      overwrite: noteOutput?.overwrite
    });

    for (const row of rows) {
      await appendLedgerLine(loaded.paths.ledgerPath, ledgerLine(
        loaded,
        row,
        "processed",
        inputHash,
        undefined,
        undefined,
        "rollup.input.v1",
        rollupOutputPath,
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
      digests: rows.map((row) => ({ sourceKey: row.sourceKey, path: rollupOutputPath, status: "processed" as const })),
      note: {
        path: note.path,
        created: note.created,
        updated: note.updated
      },
      providerStatus,
      failures: [],
      artifacts,
      warnings: rollupOutput.sourceCaveats
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
      note: { path: notePath, created: false, updated: false },
      providerStatus,
      artifacts,
      failures,
      warnings
    };
  }
}
