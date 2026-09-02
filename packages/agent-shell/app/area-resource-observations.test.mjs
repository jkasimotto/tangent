import assert from "node:assert/strict";
import test from "node:test";

import { createAreaResourceObservations, providerTreatment, recognizeReviewLink, validProviderLabel } from "./area-resource-observations.mjs";

/** Builds one active worktree fixture. */
const worktree = (id = "one", path = "/tmp/one") => ({ locator: { owner: "otto/tangent", id }, membership: { state: "active" }, target: { kind: "worktree", path } });
/** Builds one active Link fixture. */
const link = (id, url) => ({ locator: { owner: "otto/tangent", id }, membership: { state: "active" }, target: { kind: "link", url } });

test("recognizes only GitHub pull requests and configured Phabricator revisions", () => {
  const settings = { githubHost: "github.com", phabricatorBaseUrls: ["https://reviews.example.test/"] };
  assert.deepEqual(recognizeReviewLink("https://github.com/openai/codex/pull/42", settings), { kind: "github-pr", owner: "openai", repository: "codex", number: 42 });
  assert.deepEqual(recognizeReviewLink("https://reviews.example.test/D123", settings), { kind: "phabricator-revision", baseUrl: "https://reviews.example.test/", revisionId: "D123" });
  assert.deepEqual(recognizeReviewLink("https://untrusted.test/D123", settings), { kind: "generic" });
  assert.deepEqual(recognizeReviewLink("https://github.com/openai/codex/issues/42", settings), { kind: "generic" });
});

test("keeps provider words while deriving only success, muted, and neutral treatment", () => {
  assert.equal(providerTreatment("github", "Merged"), "success");
  assert.equal(providerTreatment("phabricator", "Accepted"), "success");
  assert.equal(providerTreatment("github", "Closed"), "muted");
  assert.equal(providerTreatment("phabricator", "Abandoned"), "muted");
  assert.equal(providerTreatment("github", "Ready for train"), "neutral");
  assert.equal(validProviderLabel("Ready for train"), true);
  assert.equal(validProviderLabel("bad\nlabel"), false);
});

test("coalesces reads and keeps a last-known local fact after a bounded error", async () => {
  let calls = 0;
  let fail = false;
  const observations = createAreaResourceObservations({
    /** Returns a controllable local observation. */
    localReader: async () => {
      calls += 1;
      await Promise.resolve();
      if (fail) throw new Error("secret local failure");
      return { state: "available", checkout: { kind: "branch", head: "abc", branchRef: "refs/heads/main" }, repositoryPath: "/tmp/repo" };
    },
    /** Keeps observation timestamps deterministic. */
    now: () => Date.parse("2026-09-02T00:00:00.000Z"),
  });
  const resource = worktree();
  const [left, right] = await Promise.all([observations.refreshOne(resource), observations.refreshOne(resource)]);
  assert.equal(calls, 1);
  assert.deepEqual(left, right);
  assert.equal(left.observation.state, "current");
  fail = true;
  const stale = await observations.refreshOne(resource);
  assert.equal(stale.observation.state, "last-known");
  assert.equal(stale.observation.value.state, "available");
  assert.equal(stale.observation.error.code, "local-check-failed");
  assert.doesNotMatch(stale.observation.error.message, /secret/);
});

test("uses injected named readers, exact labels, and missing-capability unavailable state", async () => {
  const observations = createAreaResourceObservations({
    githubReader: {
      /** Returns exact provider vocabulary for the requested PR. */
      read: async (ref) => ({ state: "current", stateLabel: ref.number === 1 ? "Merged" : "Ready for train", providerUpdatedAt: "2026-09-02T00:00:00.000Z" }),
    },
    recognition: { githubHost: "github.com", phabricatorBaseUrls: ["https://reviews.example.test/"] },
    /** Keeps observation timestamps deterministic. */
    now: () => Date.parse("2026-09-02T00:00:01.000Z"),
  });
  const merged = await observations.refreshOne(link("merged", "https://github.com/o/r/pull/1"));
  assert.deepEqual(merged.observation.value, { stateLabel: "Merged", treatment: "success", providerUpdatedAt: "2026-09-02T00:00:00.000Z" });
  const novel = await observations.refreshOne(link("novel", "https://github.com/o/r/pull/2"));
  assert.equal(novel.observation.value.treatment, "neutral");
  const unavailable = await observations.refreshOne(link("phab", "https://reviews.example.test/D7"));
  assert.equal(unavailable.observation.state, "unavailable");
  assert.equal(unavailable.observation.error.code, "provider-unavailable");
});

test("generation invalidation rejects a late target result", async () => {
  let release;
  /** Holds one local observation until the test crosses its generation fence. */
  const heldReader = () => new Promise((resolve) => { release = resolve; });
  const observations = createAreaResourceObservations({ localReader: heldReader });
  const resource = worktree();
  const pending = observations.refreshOne(resource);
  observations.invalidate(resource.locator);
  release({ state: "missing" });
  await pending;
  assert.equal(observations.peek(resource).state, "not-checked");
});

test("evicts the least-recent inactive entry and refuses overflow while every entry is active", async () => {
  /** Returns one deterministic fact for LRU tests. */
  const fixtureReader = async (target) => ({ state: target.path.endsWith("missing") ? "missing" : "available", checkout: { kind: "detached", head: "a" }, repositoryPath: "/r" });
  const observations = createAreaResourceObservations({ capacity: 2, localReader: fixtureReader });
  await observations.refreshOne(worktree("one", "/one"));
  await observations.refreshOne(worktree("two", "/two"));
  observations.peek(worktree("one", "/one"));
  await observations.refreshOne(worktree("three", "/three"));
  assert.equal(observations.peek(worktree("one", "/one")).state, "current");
  assert.equal(observations.peek(worktree("two", "/two")).state, "not-checked");

  let release;
  /** Holds the only cache slot active until the overflow result arrives. */
  const capacityReader = () => new Promise((resolve) => { release = resolve; });
  const full = createAreaResourceObservations({ capacity: 1, localReader: capacityReader });
  const active = full.refreshOne(worktree("active", "/active"));
  const refused = await full.refreshOne(worktree("other", "/other"));
  assert.equal(refused.observation.error.code, "observation-capacity");
  release({ state: "missing" });
  await active;
});

test("skips tombstones and generic links and preserves ordered bounded refresh output", async () => {
  /** Echoes a path tail so ordered results stay visible. */
  const orderedReader = async (target) => ({ state: target.path.slice(1) });
  const observations = createAreaResourceObservations({ localReader: orderedReader });
  const removed = { ...worktree("gone", "/gone"), membership: { state: "removed" } };
  const generic = link("site", "https://example.test/path");
  const resources = [worktree("a", "/a"), removed, generic, worktree("b", "/b")];
  const result = await observations.refresh(resources);
  assert.deepEqual(result.map((item) => item.locator?.id), ["a", "gone", "site", "b"]);
  assert.equal(result[1].skipped, true);
  assert.equal(result[2].skipped, true);
  await assert.rejects(observations.refresh(Array.from({ length: 501 }, (_, index) => worktree(String(index), `/${index}`))), { code: "invalid-resource-request" });
});
