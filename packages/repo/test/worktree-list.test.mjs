import assert from "node:assert/strict";
import test from "node:test";

import { parseGitWorktreesPorcelain } from "../dist/worktree.js";

test("parses branched, detached, bare, locked, and prunable worktree porcelain", () => {
  const rows = parseGitWorktreesPorcelain([
    "worktree /repo", "HEAD aaaa", "branch refs/heads/main", "locked held by review", "",
    "worktree /repo/detached", "HEAD bbbb", "detached", "",
    "worktree /repo/bare", "bare", "",
    "worktree /repo/old", "HEAD cccc", "branch refs/heads/old", "prunable gitdir file points to non-existent location", "",
  ].join("\0"));

  assert.deepEqual(rows, [
    { path: "/repo", checkout: { kind: "branch", head: "aaaa", branchRef: "refs/heads/main" }, locked: { reason: "held by review" }, prunable: null },
    { path: "/repo/detached", checkout: { kind: "detached", head: "bbbb" }, locked: null, prunable: null },
    { path: "/repo/bare", checkout: { kind: "bare", head: null }, locked: null, prunable: null },
    { path: "/repo/old", checkout: { kind: "branch", head: "cccc", branchRef: "refs/heads/old" }, locked: null, prunable: { reason: "gitdir file points to non-existent location" } },
  ]);
});

test("rejects an incomplete worktree record instead of inventing checkout facts", () => {
  assert.throws(() => parseGitWorktreesPorcelain("worktree /repo\0HEAD aaaa\0\0"), /no checkout state/);
});
