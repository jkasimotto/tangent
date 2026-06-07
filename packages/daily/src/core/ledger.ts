import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";

import type { ProcessedConversationLedgerLine } from "../types/ledger.js";
import { pathExists } from "./repo.js";

export async function readLedger(ledgerPath: string): Promise<ProcessedConversationLedgerLine[]> {
  if (!(await pathExists(ledgerPath))) return [];
  const text = await readFile(ledgerPath, "utf8");
  const rows: ProcessedConversationLedgerLine[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as ProcessedConversationLedgerLine);
    } catch (error) {
      throw new Error(`Invalid daily ledger line at ${ledgerPath}:${index + 1}: ${(error as Error).message}`);
    }
  }
  return rows;
}

export async function appendLedgerLine(ledgerPath: string, line: ProcessedConversationLedgerLine): Promise<void> {
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, `${JSON.stringify(line)}\n`, "utf8");
}

export function latestLedgerByConversation(lines: ProcessedConversationLedgerLine[]): Map<string, ProcessedConversationLedgerLine> {
  const latest = new Map<string, ProcessedConversationLedgerLine>();
  for (const line of lines) latest.set(line.conversationId, line);
  return latest;
}

export function hasCurrentProcessedDigest(lines: ProcessedConversationLedgerLine[], conversationId: string, inputHash: string): boolean {
  return lines.some((line) =>
    line.conversationId === conversationId &&
    line.inputHash === inputHash &&
    line.status === "processed"
  );
}
