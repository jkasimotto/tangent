import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "@tangent/repo";

import type { RollupLedgerLineV1 } from "../types/ledger.js";

export async function readLedger(ledgerPath: string): Promise<RollupLedgerLineV1[]> {
  if (!(await pathExists(ledgerPath))) return [];
  const text = await readFile(ledgerPath, "utf8");
  const rows: RollupLedgerLineV1[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as RollupLedgerLineV1;
      if (parsed.schema === "rollup.ledger.v1") rows.push(parsed);
    } catch (error) {
      throw new Error(`Invalid rollup ledger line at ${ledgerPath}:${index + 1}: ${(error as Error).message}`);
    }
  }
  return rows;
}

export async function appendLedgerLine(ledgerPath: string, line: RollupLedgerLineV1): Promise<void> {
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, `${JSON.stringify(line)}\n`, "utf8");
}

export function latestLedgerBySource(lines: RollupLedgerLineV1[]): Map<string, RollupLedgerLineV1> {
  const latest = new Map<string, RollupLedgerLineV1>();
  for (const line of lines) latest.set(line.sourceKey, line);
  return latest;
}

export function latestSuccessfulRollupForKey(lines: RollupLedgerLineV1[], key: string): RollupLedgerLineV1 | undefined {
  return [...lines]
    .filter((line) => (line.rollupKey || line.dateBucket) === key && line.status === "processed" && line.inputVersion === "rollup.input.v1" && Boolean(line.rollupPath))
    .sort((a, b) => b.processedAt.localeCompare(a.processedAt))[0];
}
