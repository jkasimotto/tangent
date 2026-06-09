import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "@tangent/repo";

import type { DailyLedgerLineV2 } from "../types/ledger.js";

export async function readLedger(ledgerPath: string): Promise<DailyLedgerLineV2[]> {
  if (!(await pathExists(ledgerPath))) return [];
  const text = await readFile(ledgerPath, "utf8");
  const rows: DailyLedgerLineV2[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as DailyLedgerLineV2;
      if (parsed.schema === "daily.ledger.v2") rows.push(parsed);
    } catch (error) {
      throw new Error(`Invalid daily ledger line at ${ledgerPath}:${index + 1}: ${(error as Error).message}`);
    }
  }
  return rows;
}

export async function appendLedgerLine(ledgerPath: string, line: DailyLedgerLineV2): Promise<void> {
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, `${JSON.stringify(line)}\n`, "utf8");
}

export function latestLedgerBySource(lines: DailyLedgerLineV2[]): Map<string, DailyLedgerLineV2> {
  const latest = new Map<string, DailyLedgerLineV2>();
  for (const line of lines) latest.set(line.sourceKey, line);
  return latest;
}

export function latestSuccessfulDigestsForDate(lines: DailyLedgerLineV2[], date: string): DailyLedgerLineV2[] {
  const latest = latestLedgerBySource(lines);
  return [...latest.values()]
    .filter((line) => line.dateBucket === date && line.status === "processed" && Boolean(line.digestPath))
    .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

export function latestSuccessfulDayRollupForDate(lines: DailyLedgerLineV2[], date: string): DailyLedgerLineV2 | undefined {
  return [...lines]
    .filter((line) => line.dateBucket === date && line.status === "processed" && (line.inputVersion === "daily.rollup-input.v1" || line.inputVersion === "daily.day-rollup-input.v1") && Boolean(line.rollupPath))
    .sort((a, b) => b.processedAt.localeCompare(a.processedAt))[0];
}
