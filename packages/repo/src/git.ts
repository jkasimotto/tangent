import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitResult = {
  stdout: string;
  stderr: string;
};

export async function git(repo: string, args: string[], options: { stdin?: string; env?: NodeJS.ProcessEnv } = {}): Promise<GitResult> {
  if (options.stdin !== undefined) {
    const result = await runGitProcess(repo, args, options);
    if (result.code !== 0) throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
    return { stdout: result.stdout, stderr: result.stderr };
  }

  const { stdout, stderr } = await execFileAsync("git", ["-C", repo, ...args], {
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024
  });
  return { stdout, stderr };
}

export async function gitText(repo: string, args: string[], options: { stdin?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return (await git(repo, args, options)).stdout.trim();
}

export async function gitRaw(repo: string, args: string[], options: { stdin?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return (await git(repo, args, options)).stdout;
}

export async function resolveGitRoot(inputPath: string): Promise<string> {
  const root = await gitText(inputPath, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error(`Not a git repository: ${inputPath}`);
  return root;
}

export async function resolveCommit(repo: string, ref: string): Promise<string> {
  return gitText(repo, ["rev-parse", "--verify", `${ref}^{commit}`]);
}

export async function currentCommit(repo: string): Promise<string> {
  return gitText(repo, ["rev-parse", "HEAD"]);
}

export async function branchName(repo: string): Promise<string | undefined> {
  const branch = await gitText(repo, ["branch", "--show-current"]).catch(() => "");
  return branch || undefined;
}

export async function statusPorcelain(repo: string): Promise<string> {
  return gitText(repo, ["status", "--porcelain"]);
}

export async function changedFiles(repo: string, fromRef: string, toRef = "HEAD"): Promise<string[]> {
  const output = await gitText(repo, ["diff", "--name-only", `${fromRef}..${toRef}`]);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export async function diffStat(repo: string, fromRef: string, toRef = "HEAD"): Promise<string | undefined> {
  const output = await gitText(repo, ["diff", "--stat", `${fromRef}..${toRef}`]);
  return output || undefined;
}

export async function showFile(repo: string, ref: string, filePath: string): Promise<string> {
  return gitRaw(repo, ["show", `${ref}:${filePath}`]);
}

export async function listFilesAtRef(repo: string, ref: string): Promise<string[]> {
  const output = await gitText(repo, ["ls-tree", "-r", "--name-only", ref]);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function runGitProcess(repo: string, args: string[], options: { stdin?: string; env?: NodeJS.ProcessEnv }): Promise<GitResult & { code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repo, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...options.env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    child.stdin.end(options.stdin);
  });
}
