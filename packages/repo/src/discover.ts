import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { hashString, isFile, pathExists } from "@tangent/core";

const execFileAsync = promisify(execFile);

export type RepoInfo = {
  inputPath: string;
  root?: string;
  cwd: string;
  branch?: string;
  headSha?: string;
  originUrlHash?: string;
};

export type ResolvedRepoInfo = {
  inputPath: string;
  root: string;
  displayName: string;
  branch?: string;
  headSha?: string;
  rootHash: string;
  slug: string;
  id: string;
};

export const defaultRepoMarkers = [
  ".git",
  "pubspec.yaml",
  "melos.yaml",
  "package.json",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "tsconfig.json",
  "jsconfig.json"
];

export { hashString, isFile, pathExists };

/** Returns the git repository root for the given path, or undefined if not inside a git repo. */
export async function findGitRoot(inputPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", inputPath, "rev-parse", "--show-toplevel"]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Walks up from inputPath to find a repo root via git or well-known marker files. */
export async function findRepoRoot(inputPath: string, markers = defaultRepoMarkers): Promise<string> {
  const gitRoot = await findGitRoot(inputPath);
  if (gitRoot) return gitRoot;

  let current = path.resolve(inputPath);
  while (true) {
    for (const marker of markers) {
      if (await pathExists(path.join(current, marker))) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(inputPath);
    current = parent;
  }
}

/** Collects basic git metadata (branch, HEAD SHA, origin URL hash) for the given path. */
export async function repoInfo(inputPath = process.cwd()): Promise<RepoInfo> {
  const cwd = path.resolve(inputPath);
  const root = await findGitRoot(cwd);
  const gitRoot = root || cwd;
  const branch = await gitValue(gitRoot, ["branch", "--show-current"]);
  const headSha = await gitValue(gitRoot, ["rev-parse", "HEAD"]);
  const origin = await gitValue(gitRoot, ["config", "--get", "remote.origin.url"]);
  return {
    inputPath: cwd,
    root,
    cwd,
    branch: branch || undefined,
    headSha: headSha || undefined,
    originUrlHash: origin ? hashString(origin) : undefined
  };
}

/** Resolves a full ResolvedRepoInfo (root, slug, id, display name, git metadata) for the given path. */
export async function resolveRepo(
  inputPath = process.cwd(),
  options: { markers?: string[] | false } = {}
): Promise<ResolvedRepoInfo> {
  const cwd = path.resolve(inputPath);
  const root = options.markers === false ? (await findGitRoot(cwd) || cwd) : await findRepoRoot(cwd, options.markers);
  const branch = await gitValue(root, ["branch", "--show-current"]);
  const headSha = await gitValue(root, ["rev-parse", "HEAD"]);
  const rootHash = hashString(path.resolve(root));
  const displayName = path.basename(root) || rootHash.slice(0, 8);
  const slug = slugify(displayName) || `repo-${rootHash.slice(0, 8)}`;
  return {
    inputPath: cwd,
    root,
    displayName,
    branch: branch || undefined,
    headSha: headSha || undefined,
    rootHash,
    slug,
    id: `${slug}-${rootHash.slice(0, 8)}`
  };
}

/** Runs a git command under repoRoot and returns trimmed stdout, or undefined on failure. */
async function gitValue(repoRoot: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Converts a string to a lowercase URL-safe slug by replacing non-alphanumeric characters with hyphens. */
function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
