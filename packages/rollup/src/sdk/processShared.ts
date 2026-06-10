import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { failureArtifactPath } from "../core/paths.js";
import { loadConfig } from "../core/config.js";
import { collectCandidates } from "../usage/selectors.js";
import type { RollupLedgerLineV1 } from "../types/ledger.js";

export type ProcessLoadedConfig = Awaited<ReturnType<typeof loadConfig>>;
export type ProcessRows = Awaited<ReturnType<typeof collectCandidates>>;
export type ProcessRow = ProcessRows[number];

export async function writeFailureArtifact(args: {
  loaded: ProcessLoadedConfig;
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

export function summarizeRunnerFailure(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("json") || lower.includes("schema")) return "Summary runner returned non-JSON output";
  if (lower.includes("timed out")) return "Summary runner timed out";
  if (lower.includes("command not found") || lower.includes("enoent")) return "Summary provider command was not found";
  return "Summary runner failed";
}

export function ledgerLine(
  loaded: ProcessLoadedConfig,
  row: ProcessRow,
  status: RollupLedgerLineV1["status"],
  inputHash: string,
  errorMessage?: string,
  failurePath?: string,
  inputVersion = "rollup.turn-digest-input.v1",
  rollupPath?: string,
  rollupKey?: string
): RollupLedgerLineV1 {
  return {
    schema: "rollup.ledger.v1",
    repoId: loaded.repo.id,
    dateBucket: row.dateBucket,
    rollupKey,
    sourceKey: row.sourceKey,
    provider: row.provider,
    conversationId: row.conversationId,
    turnId: row.turnId,
    sourceFingerprint: row.sourceFingerprint,
    inputVersion,
    inputHash,
    rollupPath,
    failurePath,
    processedAt: new Date().toISOString(),
    status,
    error: errorMessage ? { code: "summary-runner-failed", message: errorMessage } : undefined
  };
}
