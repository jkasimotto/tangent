import path from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";

/** Returns the Gemini CLI home directory, honoring a GEMINI_HOME override. */
export function geminiHome(): string {
  return process.env.GEMINI_HOME || path.join(homedir(), ".gemini");
}

/**
 * Maps a Gemini `tmp/<dir>` chat directory back to the working directory that produced it.
 * Gemini names each project dir either by a friendly basename (`otto-dnd`) or by the SHA-256
 * of the absolute cwd, and every session file also carries that same `projectHash`. Both forms
 * resolve through `~/.gemini/projects.json` (`{ projects: { "<cwd>": "<name>" } }`), so we index
 * it by name and by sha256(cwd) and resolve a directory or a file's projectHash through either.
 */
export type GeminiProjectMap = {
  byName: Map<string, string>;
  byHash: Map<string, string>;
};

/** Reads and indexes projects.json under a Gemini home; returns empty maps when it is missing. */
export async function buildGeminiProjectMap(home = geminiHome()): Promise<GeminiProjectMap> {
  const byName = new Map<string, string>();
  const byHash = new Map<string, string>();
  try {
    const text = await readFile(path.join(home, "projects.json"), "utf8");
    const parsed = JSON.parse(text) as unknown;
    const projects = parsed && typeof parsed === "object" ? (parsed as { projects?: unknown }).projects : undefined;
    if (projects && typeof projects === "object" && !Array.isArray(projects)) {
      for (const [cwd, name] of Object.entries(projects as Record<string, unknown>)) {
        if (typeof name === "string" && name) byName.set(name, cwd);
        byHash.set(sha256(cwd), cwd);
      }
    }
  } catch {
    // No projects.json (or unreadable): conversations still import, just without a resolved cwd.
  }
  return { byName, byHash };
}

/** Resolves a chat directory name and a session file's projectHash to a working directory, or undefined. */
export function resolveGeminiCwd(dir: string, projectHash: string | undefined, map: GeminiProjectMap): string | undefined {
  return (projectHash ? map.byHash.get(projectHash) : undefined) || map.byName.get(dir) || map.byHash.get(dir);
}

/** Returns the `tmp/<dir>` segment for a session file path, i.e. the project directory name. */
export function geminiDirOf(filePath: string): string | undefined {
  const segments = filePath.split(path.sep);
  const tmpIndex = segments.lastIndexOf("tmp");
  return tmpIndex >= 0 && tmpIndex + 1 < segments.length ? segments[tmpIndex + 1] : undefined;
}

/**
 * Finds Gemini CLI chat session files under `~/.gemini/tmp/<dir>/chats`. Sessions are stored either
 * as a single JSON document (`session-*.json`, older) or line-delimited (`session-*.jsonl`, newer);
 * both are returned. When `repoRoot` is given, only sessions whose project directory resolves to that
 * repo are kept; orphan hash dirs absent from projects.json resolve to no cwd and are excluded.
 */
export async function discoverGeminiNative(repoRoot?: string): Promise<string[]> {
  const home = geminiHome();
  const tmpDir = path.join(home, "tmp");
  let entries: Dirent[];
  try {
    const tmpStat = await stat(tmpDir);
    if (!tmpStat.isDirectory()) return [];
    entries = await readdir(tmpDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const map = repoRoot ? await buildGeminiProjectMap(home) : undefined;
  const canonicalRepoRoot = repoRoot ? await canonicalPath(repoRoot) : undefined;
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (map && canonicalRepoRoot) {
      const cwd = resolveGeminiCwd(entry.name, undefined, map);
      if (!cwd || await canonicalPath(cwd) !== canonicalRepoRoot) continue;
    }
    const chatsDir = path.join(tmpDir, entry.name, "chats");
    for (const file of await listSessionFiles(chatsDir)) result.push(file);
  }
  return result.sort();
}

/** Lists `session-*.json` and `session-*.jsonl` files directly under a chats directory. */
async function listSessionFiles(chatsDir: string): Promise<string[]> {
  try {
    const files = await readdir(chatsDir, { withFileTypes: true });
    return files
      .filter((file) => file.isFile() && isGeminiSessionFilename(file.name))
      .map((file) => path.join(chatsDir, file.name));
  } catch {
    return [];
  }
}

/** Reports whether a filename is a Gemini chat session file in either on-disk format. */
export function isGeminiSessionFilename(name: string): boolean {
  return name.startsWith("session-") && (name.endsWith(".json") || name.endsWith(".jsonl"));
}

/** Returns the full hex SHA-256 of a string, matching how Gemini derives a project's directory hash. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Resolves a path to its canonical real path, falling back to a plain resolve when it does not exist. */
async function canonicalPath(filePath: string): Promise<string> {
  return realpath(filePath).catch(() => path.resolve(filePath));
}
