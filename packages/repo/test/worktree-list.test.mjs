import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { listGitWorktrees, parseGitWorktreesPorcelain } from "../dist/worktree.js";

const run = promisify(execFile);

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

test("lists multiple real worktrees from an ephemeral Git repository", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "tangent-worktree-list-"));
  const repository = path.join(fixture, "repository");
  const checkout = path.join(fixture, "topic-checkout");
  try {
    await run("git", ["init", "-q", "-b", "main", repository]);
    await run("git", ["-C", repository, "config", "user.email", "tangent-test@example.invalid"]);
    await run("git", ["-C", repository, "config", "user.name", "Tangent Test"]);
    await writeFile(path.join(repository, "README.md"), "fixture\n");
    await run("git", ["-C", repository, "add", "README.md"]);
    await run("git", ["-C", repository, "commit", "-qm", "fixture"]);
    await run("git", ["-C", repository, "worktree", "add", "-qb", "topic/resource-map", checkout]);

    const rows = await listGitWorktrees(repository, { signal: new AbortController().signal });

    assert.deepEqual(rows.map((row) => [row.path, row.checkout.kind, row.checkout.branchRef]), [
      [await realpath(repository), "branch", "refs/heads/main"],
      [await realpath(checkout), "branch", "refs/heads/topic/resource-map"],
    ]);
    assert.ok(rows.every((row) => row.locked === null && row.prunable === null));
  } finally {
    await run("git", ["-C", repository, "worktree", "remove", "--force", checkout]).catch(() => null);
    await rm(fixture, { recursive: true, force: true });
  }
});
