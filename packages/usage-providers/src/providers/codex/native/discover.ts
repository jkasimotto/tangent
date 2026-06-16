import path from "node:path";
import { homedir } from "node:os";
import { readFile, readdir, realpath, stat } from "node:fs/promises";

export function codexHome(): string {
  return process.env.CODEX_HOME || path.join(homedir(), ".codex");
}

export async function discoverCodexNative(repoRoot?: string): Promise<string[]> {
  const sessionsDir = path.join(codexHome(), "sessions");
  const files = await listJsonlFiles(sessionsDir);
  if (!repoRoot) return files;
  const canonicalRepoRoot = await canonicalPath(repoRoot);
  const matching: string[] = [];
  for (const file of files) {
    if (await codexTranscriptBelongsToRepo(file, canonicalRepoRoot)) matching.push(file);
  }
  return matching;
}

async function codexTranscriptBelongsToRepo(filePath: string, canonicalRepoRoot: string): Promise<boolean> {
  try {
    const text = await readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/).slice(0, 200)) {
      if (!line.trim()) continue;
      let record: unknown;
      try {
        record = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const payload = (record as { payload?: unknown }).payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      const cwd = (payload as { cwd?: unknown }).cwd;
      if (typeof cwd === "string" && await canonicalPath(cwd) === canonicalRepoRoot) return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function canonicalPath(filePath: string): Promise<string> {
  return realpath(filePath).catch(() => path.resolve(filePath));
}

async function listJsonlFiles(root: string): Promise<string[]> {
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) return [];
  } catch {
    return [];
  }
  const result: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(fullPath);
    }
  }
  await walk(root);
  return result.sort();
}
