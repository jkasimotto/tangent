import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { contextPatterns, type EvalContextFileScope } from "../types/context.js";
import { relativeFrom } from "./paths.js";

const contextFileNames = new Set(["CLAUDE.md", "AGENT.md", "AGENTS.md"]);
const contextDirNames = new Set([".claude", ".agents", ".agnets"]);
const ignoredRecursiveEntryNames = new Set([".git"]);

export type DiscoveredContextFile = {
  scope: EvalContextFileScope;
  depth?: number;
  path: string;
  sourcePath: string;
  snapshotPath: string;
};

export async function discoverContextFiles(args: {
  repoRoot: string;
  cwd: string;
  includeAncestors?: boolean;
  includeExternalAncestors?: boolean;
  maxExternalAncestorDepth?: number;
}): Promise<DiscoveredContextFile[]> {
  const repoRoot = path.resolve(args.repoRoot);
  const executionCwd = path.resolve(repoRoot, args.cwd || ".");
  if (!isInsideOrEqual(repoRoot, executionCwd)) throw new Error(`cwd is outside repo: ${args.cwd}`);

  const rows: DiscoveredContextFile[] = [];
  const seen = new Set<string>();
  const repoDirs = repoDiscoveryDirs(repoRoot, executionCwd, Boolean(args.includeAncestors));
  for (const dir of repoDirs) {
    for (const file of await contextFilesInDirectory(dir)) {
      const rel = relativeFrom(repoRoot, file);
      add({
        scope: "repo",
        path: rel,
        sourcePath: file,
        snapshotPath: `repo/${rel}`
      });
    }
  }

  if (args.includeAncestors && args.includeExternalAncestors) {
    let current = path.dirname(repoRoot);
    for (let depth = 1; depth <= (args.maxExternalAncestorDepth || 3); depth += 1) {
      if (!current || current === path.dirname(current)) break;
      for (const file of await contextFilesInDirectory(current)) {
        const rel = relativeFrom(current, file);
        add({
          scope: "ancestor",
          depth,
          path: rel,
          sourcePath: file,
          snapshotPath: `ancestor/${depth}/${rel}`
        });
      }
      current = path.dirname(current);
    }
  }

  return rows.sort((a, b) => a.snapshotPath.localeCompare(b.snapshotPath));

  function add(file: DiscoveredContextFile): void {
    const key = `${file.scope}:${file.depth || 0}:${file.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(file);
  }
}

export function contextPatternsList(): string[] {
  return [...contextPatterns];
}

export function isContextPath(pathName: string): boolean {
  const parts = pathName.split(/[\\/]+/).filter(Boolean);
  return parts.some((part) => contextFileNames.has(part) || contextDirNames.has(part));
}

export function pathMatchesContextDiscovery(pathName: string, cwd: string, includeAncestors: boolean): boolean {
  const normalizedPath = pathName.split(/[\\/]+/).filter(Boolean).join("/");
  if (!isContextPath(normalizedPath)) return false;
  const normalizedCwd = cwd === "." ? "" : cwd.split(/[\\/]+/).filter(Boolean).join("/");
  if (!normalizedCwd) return true;
  if (normalizedPath === normalizedCwd || normalizedPath.startsWith(`${normalizedCwd}/`)) return true;
  if (!includeAncestors) return false;
  let current = normalizedCwd;
  while (current) {
    if (normalizedPath === current || normalizedPath.startsWith(`${current}/`)) return true;
    current = current.split("/").slice(0, -1).join("/");
  }
  return !normalizedPath.includes("/") || normalizedPath.startsWith(".claude/") || normalizedPath.startsWith(".agents/") || normalizedPath.startsWith(".agnets/");
}

function repoDiscoveryDirs(repoRoot: string, executionCwd: string, includeAncestors: boolean): string[] {
  const dirs = [executionCwd];
  if (!includeAncestors) return dirs;
  let current = executionCwd;
  while (current !== repoRoot) {
    current = path.dirname(current);
    dirs.push(current);
  }
  return dirs;
}

async function contextFilesInDirectory(dir: string): Promise<string[]> {
  const rows: string[] = [];
  for (const name of contextFileNames) {
    const candidate = path.join(dir, name);
    if (await isFile(candidate)) rows.push(candidate);
  }
  for (const name of contextDirNames) {
    const candidate = path.join(dir, name);
    if (await isDirectory(candidate)) rows.push(...await listFilesRecursive(candidate));
  }
  return rows;
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const rows: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (ignoredRecursiveEntryNames.has(entry.name.toLowerCase())) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...await listFilesRecursive(fullPath));
    else if (entry.isFile()) rows.push(fullPath);
  }
  return rows;
}

async function isFile(filePath: string): Promise<boolean> {
  return stat(filePath).then((value) => value.isFile()).catch(() => false);
}

async function isDirectory(filePath: string): Promise<boolean> {
  return stat(filePath).then((value) => value.isDirectory()).catch(() => false);
}

function isInsideOrEqual(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
