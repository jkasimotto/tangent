import { mkdir, readFile, readdir, stat, appendFile } from "node:fs/promises";
import path from "node:path";

/** Appends a JSON-serialized line to a JSONL file, creating the parent directory if needed. */
export async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

/** Reads and parses every line of a JSONL file, throwing on malformed JSON. */
export async function readJsonl<T = unknown>(filePath: string): Promise<T[]> {
  const text = await readFile(filePath, "utf8");
  const rows: T[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch (error) {
      throw new Error(`Invalid JSONL at ${filePath}:${index + 1}: ${(error as Error).message}`);
    }
  }
  return rows;
}

/** Recursively lists all .jsonl file paths under a directory root. */
export async function listJsonlFiles(root: string): Promise<string[]> {
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) return [];
  } catch {
    return [];
  }

  const result: string[] = [];
  /** Recursively walks a directory collecting .jsonl file paths into the result array. */
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(fullPath);
    }
  }
  await walk(root);
  return result;
}
