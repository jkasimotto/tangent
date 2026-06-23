#!/usr/bin/env node
// Creates an isolated git worktree off `main` so an agent can develop while the user keeps running the
// live app on main, and the user can boot the agent's own instance to verify the change. The worktree is a
// separate working tree on its own branch; `npm install` there gives it its own workspace symlinks, so the
// app it runs reflects the worktree's edits, not main's. Read-only verify-app on an OS-assigned port means
// the agent's instance and the live main app coexist with no port or ~/.tangent collision.
//
//   node scripts/dev-worktree.mjs create [name]   # branch dev/<name> off main, default name "dev"
//   node scripts/dev-worktree.mjs list
//   node scripts/dev-worktree.mjs remove [name]
//
// Worktree/git plumbing is reused from @tangent/repo (the one place git lives); this script only orchestrates.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { worktreeAdd, removeGitWorktree } from "@tangent/repo/worktree";
import { resolveGitRoot, resolveCommit, currentCommit, gitText } from "@tangent/repo/git";

const action = process.argv[2] || "create";
const name = (process.argv[3] || "dev").replace(/[^a-zA-Z0-9._-]/g, "-");

const repoRoot = await resolveGitRoot(path.dirname(fileURLToPath(import.meta.url)));
const branch = `dev/${name}`;
// Sibling dir so it never nests inside the repo (which would confuse globs and the indexer).
const worktree = path.join(path.dirname(repoRoot), "otto-tangent-dev", name);

/** Resolves the commit to branch from: main when it exists, else the current HEAD. */
async function baseCommit() {
  try {
    return await resolveCommit(repoRoot, "main");
  } catch {
    return await currentCommit(repoRoot);
  }
}

if (action === "create") {
  const commit = await baseCommit();
  await worktreeAdd({ sourceRepo: repoRoot, branch, worktree, commit });
  console.log(`Worktree ready: ${worktree}`);
  console.log(`Branch: ${branch}  (off main @ ${commit.slice(0, 9)})`);
  console.log("");
  console.log("Develop and verify the agent's own instance (live main app stays running):");
  console.log(`  cd ${worktree}`);
  console.log("  npm install            # first time only: gives the worktree its own workspace links");
  console.log("  npm run build");
  console.log("  node scripts/verify-app.mjs ui   # read-only, OS-assigned port, never touches live ~/.tangent");
} else if (action === "remove") {
  await removeGitWorktree(repoRoot, worktree);
  console.log(`Removed worktree: ${worktree} (branch ${branch} kept; delete with: git branch -D ${branch})`);
} else if (action === "list") {
  console.log((await gitText(repoRoot, ["worktree", "list"])).trim());
} else {
  console.error("usage: node scripts/dev-worktree.mjs [create|list|remove] [name]");
  process.exit(2);
}
