import { openUsage } from "@tangent/usage";

import { ensureOutputDirs, notePath } from "../core/paths.js";
import { loadConfig } from "../core/config.js";
import { dateArgToBucket, todayBucket } from "../core/time.js";
import { createSummaryRunner } from "../runners/summary-runner.js";
import { collectCandidates, type CandidateQuery } from "../usage/selectors.js";
import type { RunnerStatus, SummaryRunner } from "../types/provider.js";
import { processDayRollup } from "./processDayRollup.js";

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
  const date = dateArgToBucket(options.date, loaded.config.processing.timezone) || todayBucket(loaded.config.processing.timezone);
  const providers = options.provider ? [options.provider] : options.providers;
  const fallbackNotePath = notePath(loaded.paths, date);
  const rows = await collectCandidates(loaded, { ...options, providers, date });
  if (options.dryRun) {
    return {
      repoId: loaded.repo.id,
      date,
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
      date,
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
  if (!rows.length) {
    return {
      repoId: loaded.repo.id,
      date,
      candidates: 0,
      processed: 0,
      skipped: 0,
      failed: 0,
      digests: [],
      note: { path: fallbackNotePath, created: false, updated: false },
      providerStatus,
      failures: [],
      warnings: []
    };
  }
  if (!runner.summarizeDay) {
    return {
      repoId: loaded.repo.id,
      date,
      candidates: rows.length,
      processed: 0,
      skipped: 0,
      failed: rows.length,
      digests: rows.map((row) => ({ sourceKey: row.sourceKey, path: "", status: "failed" as const, reason: "Summary provider does not support daily rollup" })),
      note: { path: fallbackNotePath, created: false, updated: false },
      providerStatus,
      failures: rows.map((row) => ({ sourceKey: row.sourceKey, code: "summary-runner-failed", reason: "Summary provider does not support daily rollup", detailsPath: "" })),
      warnings: ["Summary provider does not support daily rollup."]
    };
  }
  return processDayRollup({
    loaded,
    rows,
    dataset,
    runner: runner as SummaryRunner & { summarizeDay: NonNullable<SummaryRunner["summarizeDay"]> },
    date,
    providerStatus
  });
}
