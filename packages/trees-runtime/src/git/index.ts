import path from "node:path";

import { git, gitRaw, gitText, resolveCommit, statusPorcelain } from "@tangent/repo";
import type { TreesClient } from "@tangent/trees-core";
import type { ProjectRef, TreeEntity } from "@tangent/trees-schema";

export type EnsureWorktreeOptions = {
  entity: TreeEntity;
  project?: ProjectRef;
  worktreePath?: string;
  branch?: string;
};

export type EnsureWorktreeResult = {
  entity: TreeEntity;
  repoRoot: string;
  branch: string;
  worktreePath: string;
  reused: boolean;
  created: boolean;
};

export type WorktreeStatus = {
  entityId: string;
  worktreePath?: string;
  branch?: string;
  dirty: boolean;
  porcelain: string;
};

/** Documents the ensureEntityWorktree helper. */
export async function ensureEntityWorktree(client: TreesClient, ref: string, options: Partial<EnsureWorktreeOptions> = {}): Promise<EnsureWorktreeResult> {
  const entity = options.entity || await client.entities.get(ref);
  if (!entity) throw new Error(`Unknown tree entity: ${ref}`);
  const projects = await client.projects.list();
  const project = options.project || projects.find((candidate) => candidate.id === entity.projectId || candidate.name === entity.projectId);
  const repoRoot = entity.repoRoot || project?.path;
  if (!repoRoot) throw new Error(`Tree entity has no repoRoot or project: ${entity.path}`);
  const branch = options.branch || entity.branch || branchFromEntity(entity);
  const existing = await findWorktreeForBranch(repoRoot, branch);
  const worktreePath = existing || options.worktreePath || entity.worktreePath || expectedSiblingWorktreePath(repoRoot, branch);
  let created = false;
  if (!existing) {
    await addWorktree(repoRoot, worktreePath, branch);
    created = true;
  }
  const updated = await client.entities.update(entity.id, { repoRoot, branch, worktreePath, kind: entity.kind === "group" ? "work" : entity.kind });
  await client.events.append({
    type: "worktree.ensured",
    entityId: entity.id,
    data: { repoRoot, branch, worktreePath, reused: Boolean(existing), created }
  });
  return { entity: updated, repoRoot, branch, worktreePath, reused: Boolean(existing), created };
}

/** Documents the worktreeStatus helper. */
export async function worktreeStatus(client: TreesClient, ref: string): Promise<WorktreeStatus> {
  const entity = await client.entities.get(ref);
  if (!entity) throw new Error(`Unknown tree entity: ${ref}`);
  const target = entity.worktreePath || entity.repoRoot;
  if (!target) throw new Error(`Tree entity has no worktree or repo root: ${entity.path}`);
  const porcelain = await statusPorcelain(target);
  const status: WorktreeStatus = { entityId: entity.id, worktreePath: entity.worktreePath, branch: entity.branch, dirty: Boolean(porcelain.trim()), porcelain };
  await client.events.append({
    type: "worktree.statusObserved",
    entityId: entity.id,
    data: { status },
    evidence: [{ id: `git_status_${entity.id}_${Date.now()}`, kind: "git", text: porcelain }]
  });
  return status;
}

/** Documents the findWorktreeForBranch helper. */
export async function findWorktreeForBranch(repoRoot: string, branch: string): Promise<string | undefined> {
  const worktrees = await listGitWorktrees(repoRoot);
  return worktrees.find((worktree) => worktree.branch === `refs/heads/${branch}`)?.path;
}

/** Documents the listGitWorktrees helper. */
export async function listGitWorktrees(repoRoot: string): Promise<Array<{ path: string; branch?: string; commit?: string }>> {
  const raw = await gitRaw(repoRoot, ["worktree", "list", "--porcelain"]);
  const rows: Array<{ path: string; branch?: string; commit?: string }> = [];
  let current: { path?: string; branch?: string; commit?: string } = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current.path) rows.push({ path: current.path, branch: current.branch, commit: current.commit });
      current = {};
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") current.path = value;
    if (key === "branch") current.branch = value;
    if (key === "HEAD") current.commit = value;
  }
  if (current.path) rows.push({ path: current.path, branch: current.branch, commit: current.commit });
  return rows;
}

/** Documents the expectedSiblingWorktreePath helper. */
export function expectedSiblingWorktreePath(repoRoot: string, branch: string): string {
  return path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-${safeBranchName(branch)}`);
}

/** Documents the branchFromEntity helper. */
export function branchFromEntity(entity: TreeEntity): string {
  return entity.path.split("/").map(safeBranchName).join("-");
}

/** Documents the addWorktree helper. */
async function addWorktree(repoRoot: string, worktreePath: string, branch: string): Promise<void> {
  if (await commitExists(repoRoot, branch)) {
    await git(repoRoot, ["worktree", "add", worktreePath, branch]);
    return;
  }
  if (await commitExists(repoRoot, `origin/${branch}`)) {
    await git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, `origin/${branch}`]);
    return;
  }
  const head = await gitText(repoRoot, ["rev-parse", "HEAD"]);
  await git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, head]);
}

/** Documents the commitExists helper. */
async function commitExists(repoRoot: string, ref: string): Promise<boolean> {
  return resolveCommit(repoRoot, ref).then(() => true).catch(() => false);
}

/** Documents the safeBranchName helper. */
function safeBranchName(value: string): string {
  return value.replace(/[^A-Za-z0-9._/-]+/g, "-").replace(/\/+/g, "-").replace(/^-+|-+$/g, "") || "work";
}
