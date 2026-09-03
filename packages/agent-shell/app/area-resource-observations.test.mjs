import assert from "node:assert/strict";
import test from "node:test";

import { createAreaResourceObservations, inspectLocalResource, providerTreatment, recognizeReviewLink, validProviderLabel } from "./area-resource-observations.mjs";

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

test("local Git inspection distinguishes exact root facts from abort and command failures", async () => {
  const directory = {
    /** Reports the fixture path as a directory. */
    isDirectory: () => true,
  };
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(inspectLocalResource(
    { kind: "worktree", path: process.cwd() },
    { signal: aborted.signal },
  ), (error) => error?.name === "AbortError");
  const cancelled = createAreaResourceObservations();
  const cancelledResult = await cancelled.refreshOne(worktree("cancelled", process.cwd()), { signal: aborted.signal });
  assert.equal(cancelledResult.observation.state, "unavailable");
  assert.equal(cancelledResult.observation.error.code, "local-check-failed");

  await assert.rejects(inspectLocalResource(
    { kind: "worktree", path: "/repo" },
    {
      signal: new AbortController().signal,
      /** Resolves the fixture directory. */
      statPath: async () => directory,
      /** Fails every Git command with an I/O error. */
      readGit: async () => { throw Object.assign(new Error("git unavailable"), { code: "EIO" }); },
    },
  ), (error) => error?.code === "EIO");

  const nested = await inspectLocalResource(
    { kind: "worktree", path: "/repo/nested" },
    {
      signal: new AbortController().signal,
      /** Resolves the fixture directory. */
      statPath: async () => directory,
      /** Answers a non-bare repository rooted at /repo. */
      readGit: async (_cwd, args) => args.includes("--is-bare-repository") ? "false" : "/repo",
    },
  );
  assert.deepEqual(nested, { state: "not-a-worktree" });

  const detached = await inspectLocalResource(
    { kind: "worktree", path: "/repo" },
    {
      signal: new AbortController().signal,
      /** Resolves the fixture directory. */
      statPath: async () => directory,
      /** Answers scripted Git facts for the exact-root case. */
      readGit: async (_cwd, args) => {
        if (args.includes("--is-bare-repository")) return "false";
        if (args.includes("--show-toplevel")) return "/repo";
        if (args.includes("HEAD") && args[0] === "rev-parse") return "abcdef";
        if (args.includes("symbolic-ref")) throw Object.assign(new Error("detached"), { code: 1 });
        if (args.includes("--git-common-dir")) return "/repo/.git";
        if (args.join(" ") === "--no-optional-locks diff --quiet HEAD --") return "";
        throw new Error(`unexpected Git arguments ${args.join(" ")}`);
      },
    },
  );
  assert.deepEqual(detached, {
    state: "available",
    checkout: { kind: "detached", head: "abcdef" },
    dirty: false,
    repositoryPath: "/repo",
  });
});

test("a working tree with an uncommitted tracked change reports dirty, and untracked files never do", async () => {
  const directory = {
    /** Reports the fixture path as a directory. */
    isDirectory: () => true,
  };
  const dirtyArguments = [];
  /** Answers scripted Git facts for a branch checkout with a scripted dirty result. */
  const readerFor = (diff) => async (_cwd, args) => {
    if (args.includes("--is-bare-repository")) return diff.bare ? "true" : "false";
    if (args.includes("--show-toplevel")) return "/repo";
    if (args.includes("HEAD") && args[0] === "rev-parse") return "abcdef";
    if (args.includes("symbolic-ref")) return "refs/heads/main";
    if (args.includes("--git-common-dir")) return "/repo/.git";
    if (args[0] === "--no-optional-locks") { dirtyArguments.push(args.join(" ")); return diff.run(); }
    throw new Error(`unexpected Git arguments ${args.join(" ")}`);
  };
  /** Builds the injected inspection options for one scripted reader. */
  const options = (diff) => ({
    signal: new AbortController().signal,
    /** Resolves the fixture directory. */
    statPath: async () => directory,
    readGit: readerFor(diff),
  });

  /** Exits 0, which is how Git reports no difference. */
  const noDifference = () => "";
  const clean = await inspectLocalResource({ kind: "worktree", path: "/repo" }, options({ run: noDifference }));
  assert.equal(clean.dirty, false);
  assert.deepEqual(dirtyArguments, ["--no-optional-locks diff --quiet HEAD --"]);

  const dirty = await inspectLocalResource({ kind: "repository", path: "/repo" }, options({
    /** Exits 1, which is how Git reports a difference. */
    run: () => { throw Object.assign(new Error("differences"), { code: 1 }); },
  }));
  assert.equal(dirty.dirty, true);

  await assert.rejects(inspectLocalResource({ kind: "worktree", path: "/repo" }, options({
    /** Exits 128, which is a real Git failure and never a dirty answer. */
    run: () => { throw Object.assign(new Error("not a repository"), { code: 128 }); },
  })), (error) => Number(error.code) === 128);

  const bare = await inspectLocalResource({ kind: "repository", path: "/repo" }, options({ bare: true, run: noDifference }));
  assert.deepEqual(bare, { state: "available", checkout: { kind: "bare", head: "abcdef" } });
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

test("observation timeout waits for aborted reader cleanup before returning", async () => {
  let aborted = false;
  let cleaned = false;
  const observations = createAreaResourceObservations({
    timeoutMs: 5,
    /** Finishes asynchronous child cleanup only after observing abort. */
    localReader: (_target, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        setTimeout(() => {
          cleaned = true;
          reject(new Error("reader reaped"));
        }, 10);
      }, { once: true });
    }),
  });
  const result = await observations.refreshOne(worktree("timeout", "/timeout"));
  assert.equal(aborted, true);
  assert.equal(cleaned, true);
  assert.equal(result.observation.state, "unavailable");
  assert.equal(result.observation.error.code, "local-check-failed");
});

test("an abort-ignoring provider stays bounded and can never install a late current value", async () => {
  let release;
  const observations = createAreaResourceObservations({
    timeoutMs: 5,
    cleanupGraceMs: 10,
    githubReader: {
      /** Deliberately ignores AbortSignal until the test releases its late value. */
      read: () => new Promise((resolve) => { release = resolve; }),
    },
  });
  const resource = link("late", "https://github.com/o/r/pull/9");
  const started = Date.now();
  const result = await observations.refreshOne(resource);
  assert.ok(Date.now() - started < 200, "an uncooperative provider cannot make the observation deadline unbounded");
  assert.equal(result.observation.state, "unavailable");
  assert.equal(result.observation.error.code, "provider-timeout");
  release({ state: "current", stateLabel: "Merged", providerUpdatedAt: "2026-09-02T00:00:00.000Z" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(observations.peek(resource).state, "unavailable");
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

test("passes exact Phabricator references and retains current state after permission loss", async () => {
  const references = [];
  let permitted = true;
  const observations = createAreaResourceObservations({
    recognition: { phabricatorBaseUrls: ["https://reviews.example.test/"] },
    phabricatorReader: {
      /** Models a trusted adapter whose credentials remain outside its public reference. */
      async read(reference) {
        references.push(structuredClone(reference));
        if (!permitted) throw { code: "provider-access-unavailable", credential: "never public" };
        return { state: "current", stateLabel: "Accepted", providerUpdatedAt: "2026-09-02T00:00:00.000Z" };
      },
    },
    /** Fixes the observation clock one second after the provider update. */
    now: () => Date.parse("2026-09-02T00:00:01.000Z"),
  });
  const resource = link("phab-permission", "https://reviews.example.test/D71");
  const current = await observations.refreshOne(resource);
  assert.equal(current.observation.state, "current");
  assert.deepEqual(current.observation.value, { stateLabel: "Accepted", treatment: "success", providerUpdatedAt: "2026-09-02T00:00:00.000Z" });

  permitted = false;
  const retained = await observations.refreshOne(resource);
  assert.equal(retained.observation.state, "last-known");
  assert.deepEqual(retained.observation.value, current.observation.value);
  assert.deepEqual(retained.observation.error, { code: "provider-access-unavailable", message: "Provider access is unavailable.", retryable: false });
  assert.deepEqual(references, [
    { baseUrl: "https://reviews.example.test/", revisionId: "D71" },
    { baseUrl: "https://reviews.example.test/", revisionId: "D71" },
  ]);
  assert.equal(JSON.stringify(retained).includes("credential"), false);
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

test("clearing observations fences every late owner-keyed result after an Area move", async () => {
  let release;
  const observations = createAreaResourceObservations({
    /** Holds an old-owner fact until the move cache clear completes. */
    localReader: () => new Promise((resolve) => { release = resolve; }),
  });
  const resource = worktree("moving", "/moving");
  const pending = observations.refreshOne(resource);
  observations.clear();
  assert.deepEqual(observations.status(), { size: 0, capacity: 2_000, active: 0 });
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
