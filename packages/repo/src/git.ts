import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitResult = {
  stdout: string;
  stderr: string;
};

/** Runs a git command in a repo and returns its stdout/stderr, throwing on a non-zero exit. */
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

/** Runs a git command and returns its stdout trimmed of surrounding whitespace. */
export async function gitText(repo: string, args: string[], options: { stdin?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return (await git(repo, args, options)).stdout.trim();
}

/** Runs a git command and returns its raw stdout without trimming. */
export async function gitRaw(repo: string, args: string[], options: { stdin?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return (await git(repo, args, options)).stdout;
}

/** Resolves the top-level working directory of the repo containing a path. */
export async function resolveGitRoot(inputPath: string): Promise<string> {
  const root = await gitText(inputPath, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error(`Not a git repository: ${inputPath}`);
  return root;
}

/** Resolves a ref to its full commit SHA. */
export async function resolveCommit(repo: string, ref: string): Promise<string> {
  return gitText(repo, ["rev-parse", "--verify", `${ref}^{commit}`]);
}

/** Returns the current HEAD commit SHA. */
export async function currentCommit(repo: string): Promise<string> {
  return gitText(repo, ["rev-parse", "HEAD"]);
}

/** Returns the current branch name, or undefined in detached HEAD. */
export async function branchName(repo: string): Promise<string | undefined> {
  const branch = await gitText(repo, ["branch", "--show-current"]).catch(() => "");
  return branch || undefined;
}

/** Returns `git status --porcelain` output for the repo. */
export async function statusPorcelain(repo: string): Promise<string> {
  return gitText(repo, ["status", "--porcelain"]);
}

/** Lists the paths that differ between two refs. */
export async function changedFiles(repo: string, fromRef: string, toRef = "HEAD"): Promise<string[]> {
  const output = await gitText(repo, ["diff", "--name-only", `${fromRef}..${toRef}`]);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Returns the `git diff --stat` summary between two refs, or undefined when empty. */
export async function diffStat(repo: string, fromRef: string, toRef = "HEAD"): Promise<string | undefined> {
  const output = await gitText(repo, ["diff", "--stat", `${fromRef}..${toRef}`]);
  return output || undefined;
}

/** Reads the contents of a file at a given ref. */
export async function showFile(repo: string, ref: string, filePath: string): Promise<string> {
  return gitRaw(repo, ["show", `${ref}:${filePath}`]);
}

/**
 * Reads a file at a ref, following in-tree symlinks to the content they point at.
 *
 * Git stores a symlink as a blob whose content is the target path, so a plain `git show ref:link`
 * yields that path string, not the linked file. Eval context files (CLAUDE.md, AGENTS.md) are
 * commonly symlinks to one shared file, so reading them this way surfaces the real instructions.
 * Targets resolve within the tree, relative to the link's directory; broken, out-of-tree, or
 * cyclic links throw like a missing path so callers fall back to their absent-file handling.
 */
export async function showFileFollowingSymlinks(repo: string, ref: string, filePath: string, maxHops = 10): Promise<string> {
  let current = normalizeTreePath(filePath);
  for (let hop = 0; hop < maxHops; hop += 1) {
    if (await treeEntryMode(repo, ref, current) !== "120000") return gitRaw(repo, ["show", `${ref}:${current}`]);
    const target = (await gitRaw(repo, ["show", `${ref}:${current}`])).trim();
    current = resolveTreePath(current, target);
  }
  throw new Error(`Symlink cycle following ${filePath} at ${ref}`);
}

/** Returns the octal file mode of a path at a ref (e.g. "120000" for a symlink), or undefined when absent. */
async function treeEntryMode(repo: string, ref: string, filePath: string): Promise<string | undefined> {
  const line = await gitText(repo, ["ls-tree", ref, "--", filePath]).catch(() => "");
  return line ? line.split(/\s+/)[0] : undefined;
}

/** Resolves a symlink target against the link's directory, collapsing "." and ".." within the tree. */
function resolveTreePath(from: string, target: string): string {
  const base = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  return normalizeTreePath(target.startsWith("/") ? target : base ? `${base}/${target}` : target);
}

/** Collapses a posix tree path: drops empty and "." segments, and pops the parent on "..". */
function normalizeTreePath(treePath: string): string {
  const parts: string[] = [];
  for (const segment of treePath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/** Lists every tracked file path at a ref. */
export async function listFilesAtRef(repo: string, ref: string): Promise<string[]> {
  const output = await gitText(repo, ["ls-tree", "-r", "--name-only", ref]);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/**
 * Maps every file at a ref to its blob OID in one `git ls-tree` call. Because blob OIDs are
 * content hashes, comparing two refs' maps tells you which files changed without reading any
 * content, even across separate worktrees. Used to badge eval comparisons cheaply instead of
 * spawning one `git show` per file.
 */
export async function fileOidsAtRef(repo: string, ref: string): Promise<Map<string, string>> {
  const output = await gitText(repo, ["ls-tree", "-r", ref]);
  const oids = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const oid = line.slice(0, tab).split(/\s+/)[2];
    if (oid) oids.set(line.slice(tab + 1), oid);
  }
  return oids;
}

/** Spawns git with piped stdin (for commands that read from stdin) and returns stdout, stderr, and exit code. */
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
