import { openUsage } from "@tangent/usage-index-sqlite";

import { ensureOutputDirs } from "../core/paths.js";
import { loadConfig } from "../core/config.js";
import { resolveRollupPeriod } from "../core/time.js";
import { createSummaryRunner } from "../runners/summary-runner.js";
import { collectCandidates, type CandidateQuery } from "../usage/selectors.js";
import type { RollupPeriod } from "../types/period.js";
import type { RollupPurpose } from "../types/digest.js";
import type { RunnerStatus, SummaryRunner } from "../types/provider.js";
import { resolveRollupNotePath } from "../core/note-writer.js";
import { processPeriodRollup } from "./processPeriodRollup.js";

export type ProcessRollupOptions = Omit<CandidateQuery, "from" | "to"> & {
  from?: string | Date;
  to?: string | Date;
  selector?: string;
  provider?: "claude" | "codex";
  dryRun?: boolean;
  summaryRunner?: SummaryRunner;
  purpose?: string;
  focus?: string[];
  title?: string;
  kind?: RollupPurpose["kind"];
  audience?: RollupPurpose["audience"];
  output?: string;
  filename?: string;
  overwrite?: boolean;
};

export type ProcessResult = {
  repoId: string;
  period: RollupPeriod;
  rollupKey: string;
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
  artifacts?: {
    inputPath: string;
    messagesPath: string;
    promptPath: string;
    outputPath?: string;
  };
  warnings: string[];
};

/**
 * Orchestrates candidate selection and rollup execution for a selected period.
 */
export async function processRollup(options: ProcessRollupOptions): Promise<ProcessResult> {
  const loaded = await loadConfig({ repo: options.repo });
  await ensureOutputDirs(loaded.paths);
  const period = resolveRollupPeriod({
    selector: options.selector,
    date: options.date,
    from: options.from,
    to: options.to,
    timezone: loaded.config.processing.timezone
  });
  const providers = options.provider ? [options.provider] : options.providers;
  const purpose: RollupPurpose | undefined = options.purpose ? {
    request: options.purpose,
    kind: options.kind,
    title: options.title,
    focusTerms: options.focus || [],
    audience: options.audience,
    outputPath: options.output
  } : undefined;

  const output = {
    filename: options.filename,
    outputPath: options.output,
    overwrite: options.overwrite
  };

  const fallbackNotePath = await resolveRollupNotePath({
    loaded,
    period,
    filename: output.filename,
    outputPath: output.outputPath,
    overwrite: output.overwrite
  });
  const rows = await collectCandidates(loaded, {
    ...options,
    providers,
    from: undefined,
    to: undefined,
    date: period.kind === "day" ? period.date : undefined,
    fromDate: period.kind === "range" ? period.startDate : undefined,
    toDate: period.kind === "range" ? period.endDate : undefined,
    rollupKey: period.key
  });
  if (options.dryRun) {
    return {
      repoId: loaded.repo.id,
      period,
      rollupKey: period.key,
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
      period,
      rollupKey: period.key,
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
      period,
      rollupKey: period.key,
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
  return processPeriodRollup({
    loaded,
    rows,
    dataset,
    runner,
    period,
    providerStatus,
    purpose,
    output
  });
}
