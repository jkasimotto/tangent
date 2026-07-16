import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseWakeCondition, evaluateWakeCondition, RepoGitProbe } from "../dist/core/wake.js";

/** Fake git probe returning a canned ancestor answer. */
function probe(answer) {
  return {
    /** Simulates git merge-base --is-ancestor with a fixed result. */
    isAncestor: async () => answer
  };
}

/** Runs a git command synchronously in a fixture directory, discarding its output. */
function runGit(dir, args) {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

/**
 * Builds a throwaway git repository with one commit on `main` and a branch `b` pointing at the
 * same commit, for exercising RepoGitProbe against a real `git merge-base --is-ancestor` call
 * instead of a fake. Caller is responsible for removing the returned directory.
 */
async function tempGitRepoWithBranch() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wake-test-"));
  runGit(dir, ["init", "-q", "-b", "main"]);
  runGit(dir, ["config", "user.email", "wake-test@example.com"]);
  runGit(dir, ["config", "user.name", "Wake Test"]);
  await writeFile(path.join(dir, "file.txt"), "hello\n");
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-q", "-m", "initial"]);
  runGit(dir, ["branch", "b"]);
  return dir;
}

test("parses date wake conditions", () => {
  const parsed = parseWakeCondition("Wake on 2026-07-20");
  assert.deepEqual(parsed, { kind: "date", date: "2026-07-20", raw: "Wake on 2026-07-20" });
});

test("parses merged wake conditions with a repo path", () => {
  const raw = "Wake when pgande-staging is merged into main in ~/neara/polez";
  const parsed = parseWakeCondition(raw);
  assert.equal(parsed.kind, "merged");
  assert.equal(parsed.branch, "pgande-staging");
  assert.equal(parsed.target, "main");
  assert.ok(parsed.repoPath.endsWith("/neara/polez"));
});

test("anything else is opaque and never met", async () => {
  const parsed = parseWakeCondition("Wake when Troy says so");
  assert.equal(parsed.kind, "opaque");
  assert.equal(await evaluateWakeCondition(parsed, new Date(), probe(true)), false);
});

test("date condition is met on or after the date", async () => {
  const parsed = parseWakeCondition("Wake on 2026-07-20");
  assert.equal(await evaluateWakeCondition(parsed, new Date("2026-07-19T23:00:00Z"), probe(false)), false);
  assert.equal(await evaluateWakeCondition(parsed, new Date("2026-07-20T01:00:00Z"), probe(false)), true);
});

test("merged condition delegates to the git probe", async () => {
  const parsed = parseWakeCondition("Wake when b is merged into main in /tmp/repo");
  assert.equal(await evaluateWakeCondition(parsed, new Date(), probe(true)), true);
  assert.equal(await evaluateWakeCondition(parsed, new Date(), probe(false)), false);
});

test("strips trailing prose punctuation from the branch, target, and repoPath captures", () => {
  const parsed = parseWakeCondition("Wake when b is merged into main in ~/repo.");
  assert.equal(parsed.kind, "merged");
  assert.equal(parsed.branch, "b");
  assert.equal(parsed.target, "main");
  assert.ok(parsed.repoPath.endsWith("/repo"), `expected repoPath to end with "/repo", got ${JSON.stringify(parsed.repoPath)}`);
  assert.ok(!parsed.repoPath.endsWith("."), `expected repoPath to have no trailing period, got ${JSON.stringify(parsed.repoPath)}`);
});

test("strips trailing comma/semicolon/colon punctuation too", () => {
  assert.equal(parseWakeCondition("Wake when b, is merged into main; in /tmp/repo:").branch, "b");
});

test("parses merged wake conditions with case-insensitive \"lands on\" phrasing", () => {
  const parsed = parseWakeCondition("Wake when x LANDS ON main in /tmp/r");
  assert.equal(parsed.kind, "merged");
});

test("RepoGitProbe reports true when a branch's tip is contained in the target", async () => {
  const repo = await tempGitRepoWithBranch();
  try {
    const result = await new RepoGitProbe().isAncestor(repo, "b", "main");
    assert.equal(result, true);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("RepoGitProbe resolves false, never throws, for a nonexistent repo path", async () => {
  const result = await new RepoGitProbe().isAncestor("/nonexistent/path", "a", "b");
  assert.equal(result, false);
});
