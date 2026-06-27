import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { currentCommit, git, gitText, statusPorcelain } from "./git.js";

/** Creates (or resets) a git worktree at the given path on a branch pointing at a commit. */
export async function worktreeAdd(args: { sourceRepo: string; branch: string; worktree: string; commit: string }): Promise<void> {
  await rm(args.worktree, { recursive: true, force: true });
  await mkdir(path.dirname(args.worktree), { recursive: true });
  await git(args.sourceRepo, ["worktree", "add", "-B", args.branch, args.worktree, args.commit]);
}

/** Stages everything and commits it, returning the resulting commit (or the current one when nothing changed). */
export async function commitAll(repo: string, message: string, options: { allowEmpty?: boolean } = {}): Promise<string> {
  await git(repo, ["add", "-A"]);
  const status = await statusPorcelain(repo);
  if (!status && !options.allowEmpty) return currentCommit(repo);
  const args = [
    "-c",
    "user.name=Tangent Eval",
    "-c",
    "user.email=tangent-eval@example.invalid",
    "commit",
    // These commits snapshot an isolated throwaway worktree (eval context/plan/implement). Running the
    // target repo's commit hooks is wrong here and routinely fails: a freshly checked-out worktree lacks
    // installed dev deps, so a lint/test pre-commit hook aborts the snapshot and leaves the run empty.
    "--no-verify"
  ];
  if (options.allowEmpty) args.push("--allow-empty");
  args.push("-m", message);
  await git(repo, args);
  return currentCommit(repo);
}

/** Builds a commit from in-memory file contents via a temporary index and points a ref at it, without touching the worktree. */
export async function createSyntheticCommit(args: {
  repo: string;
  ref: string;
  message: string;
  files: Array<{ path: string; content: string | Buffer; mode?: string }>;
}): Promise<string> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "tangent-eval-index-"));
  const indexPath = path.join(tempDir, "index");
  const env = { GIT_INDEX_FILE: indexPath };
  try {
    for (const file of [...args.files].sort((a, b) => a.path.localeCompare(b.path))) {
      const objectId = await gitText(args.repo, ["hash-object", "-w", "--stdin"], { stdin: file.content.toString(), env });
      await git(args.repo, ["update-index", "--add", "--cacheinfo", `${file.mode || "100644"},${objectId},${file.path}`], { env });
    }
    const tree = await gitText(args.repo, ["write-tree"], { env });
    const commit = await gitText(args.repo, ["commit-tree", tree, "-m", args.message]);
    await git(args.repo, ["update-ref", args.ref, commit]);
    return commit;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/** Removes a git worktree, falling back to a forced directory delete if git refuses. */
export async function removeGitWorktree(repo: string, worktree: string): Promise<void> {
  await git(repo, ["worktree", "remove", "--force", worktree]).catch(async () => {
    await rm(worktree, { recursive: true, force: true });
  });
}
