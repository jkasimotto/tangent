import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RepoInfo = {
  inputPath: string;
  root?: string;
  cwd: string;
  branch?: string;
  headSha?: string;
  originUrlHash?: string;
};

export async function findGitRoot(inputPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", inputPath, "rev-parse", "--show-toplevel"]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

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
    originUrlHash: origin ? createHash("sha256").update(origin).digest("hex").slice(0, 16) : undefined
  };
}

async function gitValue(repoRoot: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args]);
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
