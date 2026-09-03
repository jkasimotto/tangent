import assert from "node:assert/strict";
import test from "node:test";

import { discoverAreaResources, recentAreaAttempts } from "./area-resource-discovery.mjs";
import { areaResourceTargetFingerprint } from "./area-resource-catalog.mjs";

/** Builds one complete Job-history fixture. */
function job(area, attempts) {
  return { area, slug: "map", runs: [{ run: 1, assignments: [{ id: "assignment-1", attempts }] }] };
}

test("applies the 30-day and newest-20 Attempt bounds before target deduplication", () => {
  const now = Date.parse("2026-09-02T00:00:00.000Z");
  const attempts = Array.from({ length: 24 }, (_value, index) => ({
    id: `attempt-${index}`,
    cwd: `/work/${index}/nested`,
    startedAt: new Date(now - index * 60_000).toISOString(),
  }));
  attempts.push({ id: "old", cwd: "/work/old", startedAt: "2026-07-01T00:00:00.000Z" });
  const result = recentAreaAttempts([job("otto/tangent", attempts), job("other", attempts)], "otto/tangent", { now });
  assert.equal(result.length, 20);
  assert.deepEqual(result.map((item) => item.evidence.attemptId), attempts.slice(0, 20).map((item) => item.id));
});

test("discovers branch, detached, and locked repository worktrees while naming excluded diagnostics", async () => {
  /** Returns production-shaped Git porcelain facts without touching a real repository. */
  async function listWorktrees() {
    return [
      { path: "/repo/main", checkout: { kind: "branch", head: "a", branchRef: "refs/heads/main" }, locked: null, prunable: null },
      { path: "/repo/review", checkout: { kind: "detached", head: "b" }, locked: { reason: "review" }, prunable: null },
      { path: "/repo/bare", checkout: { kind: "bare", head: null }, locked: null, prunable: null },
      { path: "/repo/old", checkout: { kind: "branch", head: "c", branchRef: "refs/heads/old" }, locked: null, prunable: { reason: "gone" } },
    ];
  }
  const result = await discoverAreaResources({
    area: "otto/tangent",
    repositories: [{ locator: { owner: "otto", id: "repo" }, label: "Tangent", target: { kind: "repository", path: "/repo" } }],
    jobsEvidence: { jobs: [], problems: [] },
    listWorktrees,
  });
  assert.equal(result.suggestions[0].targetFingerprint, areaResourceTargetFingerprint(result.suggestions[0].target));
  assert.equal(result.suggestions[0].evidence.repositoryTargetFingerprint, areaResourceTargetFingerprint({ kind: "repository", path: "/repo" }));
  assert.equal(result.state, "partial");
  assert.deepEqual(result.suggestions.map((item) => [item.target.path, item.proposedLabel]), [["/repo/main", "main"], ["/repo/review", "review"]]);
  assert.deepEqual(result.problems.map((item) => item.code), ["bare-worktree", "prunable-worktree"]);
  assert.ok(result.suggestions.every((item) => item.owner === "otto/tangent" && item.evidence.kind === "git-worktree"));
});

test("reads every numbered run as Attempt evidence and retains malformed Job problems", async () => {
  const now = Date.parse("2026-09-02T00:00:00.000Z");
  const jobs = [{
    area: "otto/tangent",
    slug: "map",
    runs: [
      { run: 1, assignments: [{ id: "a1", attempts: [{ id: "old-run", cwd: "/nested/one", startedAt: "2026-09-01T01:00:00.000Z" }] }] },
      { run: 2, assignments: [{ id: "a2", attempts: [{ id: "new-run", cwd: "/nested/two", startedAt: "2026-09-01T02:00:00.000Z" }] }] },
    ],
  }];
  /** Maps nested Attempt folders to their exact worktree root. */
  async function resolveAttempt(folder) { return folder.endsWith("one") ? "/worktrees/one" : "/worktrees/two"; }
  const result = await discoverAreaResources({
    area: "otto/tangent",
    jobsEvidence: { jobs, problems: [{ file: "/jobs/broken.json", code: "job-record-malformed", message: "Malformed.", retryable: false }] },
    resolveAttempt,
    now,
  });
  assert.equal(result.state, "partial");
  assert.deepEqual(result.suggestions.map((item) => [item.evidence.run, item.target.path]), [[2, "/worktrees/two"], [1, "/worktrees/one"]]);
  assert.equal(result.problems[0].code, "job-record-malformed");
});

test("settles repository failures independently and never promotes discovery to membership", async () => {
  /** Returns one worktree for the second repository and fails the first. */
  async function listWorktrees(repository) {
    if (repository === "/bad") throw new Error("private failure");
    return [{ path: "/good/wt", checkout: { kind: "branch", head: "a", branchRef: "refs/heads/good" }, locked: null, prunable: null }];
  }
  const result = await discoverAreaResources({
    area: "otto/tangent",
    repositories: [
      { locator: { owner: "otto", id: "bad" }, target: { kind: "repository", path: "/bad" } },
      { locator: { owner: "otto", id: "good" }, target: { kind: "repository", path: "/good" } },
    ],
    jobsEvidence: { jobs: [], problems: [] },
    listWorktrees,
  });
  assert.equal(result.state, "partial");
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].target.path, "/good/wt");
  assert.equal(result.suggestions[0].membership, undefined);
  assert.doesNotMatch(JSON.stringify(result.problems), /private failure/);
});
