import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Returns the hashed receipt path for one operation. */
function receiptPath(root, operationId) {
  return path.join(root, `${createHash("sha256").update(String(operationId)).digest("hex")}.json`);
}

/** Stores the recoverable boundary between Park's Git commit and exact cleanup. */
export function createParkGoalReceipts(root) {
  /** Reads one Park receipt when it exists. */
  async function read(operationId) {
    try { return JSON.parse(await readFile(receiptPath(root, operationId), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  /** Writes one Park receipt atomically. */
  async function write(receipt) {
    await mkdir(root, { recursive: true });
    const file = receiptPath(root, receipt.operationId);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await rename(temporary, file);
    return receipt;
  }
  /** Returns all Park receipts that still need reconciliation. */
  async function unsettled() {
    const names = await readdir(root).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    const records = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readFile(path.join(root, name), "utf8").then(JSON.parse)));
    return records.filter((record) => ["prepared", "committed", "cleanup-pending"].includes(record.state));
  }
  return { read, unsettled, write };
}
