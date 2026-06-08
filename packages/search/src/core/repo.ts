import { createHash } from "node:crypto";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SearchRepoInfo = {
  inputPath: string;
  root: string;
  displayName: string;
  branch?: string;
  headSha?: string;
  rootHash: string;
  slug: string;
  id: string;
};

export async function resolveRepo(inputPath = process.cwd()): Promise<SearchRepoInfo> {
  const cwd = path.resolve(inputPath);
  const root = await findRepoRoot(cwd);
  const branch = await gitValue(root, ["branch", "--show-current"]);
  const headSha = await gitValue(root, ["rev-parse", "HEAD"]);
  const rootHash = hashString(path.resolve(root));
  const displayName = path.basename(root) || rootHash.slice(0, 8);
  const slug = slugify(displayName) || `repo-${rootHash.slice(0, 8)}`;
  return { inputPath: cwd, root, displayName, branch: branch || undefined, headSha: headSha || undefined, rootHash, slug, id: `${slug}-${rootHash.slice(0, 8)}` };
}

export async function findRepoRoot(inputPath: string): Promise<string> {
  const gitRoot = await findGitRoot(inputPath);
  if (gitRoot) return gitRoot;
  let current = path.resolve(inputPath);
  const markers = [".git", "pubspec.yaml", "melos.yaml", "package.json", "pnpm-workspace.yaml", "yarn.lock", "tsconfig.json", "jsconfig.json"];
  while (true) {
    for (const marker of markers) {
      if (await pathExists(path.join(current, marker))) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(inputPath);
    current = parent;
  }
}

export async function findGitRoot(inputPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", inputPath, "rev-parse", "--show-toplevel"]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function gitValue(repoRoot: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
