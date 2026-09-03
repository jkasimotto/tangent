import { stat } from "node:fs/promises";
import path from "node:path";

import { gitText } from "@tangent/repo/git";
import { mapWithConcurrency } from "./bounded-work.mjs";

const DEFAULT_CAPACITY = 2_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CLEANUP_GRACE_MS = 250;
const SAFE_PROVIDER_CODES = new Set(["provider-access-unavailable", "provider-unavailable"]);

/** Returns one target's stable cache fingerprint without exposing its value in telemetry. */
export function observationTargetFingerprint(target) {
  if (target?.kind === "worktree" || target?.kind === "repository") return `${target.kind}:${target.path}`;
  if (target?.kind === "link") return `link:${target.url}`;
  throw new Error("resource target is invalid");
}

/** Recognizes only the configured GitHub PR and trusted Phabricator revision URL shapes. */
export function recognizeReviewLink(value, recognition = {}) {
  let url;
  try { url = new URL(String(value ?? "")); } catch { return { kind: "generic" }; }
  if (url.protocol === "https:" && url.hostname.toLowerCase() === (recognition.githubHost ?? "github.com")) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 4 && parts[2] === "pull" && /^[1-9]\d*$/.test(parts[3])) {
      return { kind: "github-pr", owner: parts[0], repository: parts[1], number: Number(parts[3]) };
    }
  }
  for (const configured of recognition.phabricatorBaseUrls ?? []) {
    let base;
    try { base = new URL(configured); } catch { continue; }
    if (url.origin !== base.origin) continue;
    const prefix = base.pathname.replace(/\/$/, "");
    if (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) continue;
    const revisionId = url.pathname.split("/").filter(Boolean).findLast((part) => /^D[1-9]\d*$/.test(part));
    if (revisionId) return { kind: "phabricator-revision", baseUrl: configured, revisionId };
  }
  return { kind: "generic" };
}

/** Maps a provider-owned lifecycle word to the small presentation treatment union. */
export function providerTreatment(provider, stateLabel) {
  if (provider === "github" && stateLabel === "Merged" || provider === "phabricator" && stateLabel === "Accepted") return "success";
  if (provider === "github" && stateLabel === "Closed" || provider === "phabricator" && ["Closed", "Abandoned"].includes(stateLabel)) return "muted";
  return "neutral";
}

/** Validates one provider label without interpreting new valid provider vocabulary. */
export function validProviderLabel(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Returns an expected empty Git result without swallowing abort or system failures. */
async function optionalGitText(readGit, cwd, args, signal, allowedCodes) {
  try { return await readGit(cwd, args, { signal }); }
  catch (error) {
    if (allowedCodes.has(Number(error?.code))) return "";
    throw error;
  }
}

/**
 * Reports whether one checkout has an uncommitted change to a tracked file.
 * `--no-optional-locks` keeps the check from writing the index, so it never
 * contends with an agent running Git in the same checkout. Untracked files do
 * not count: scanning for them costs seconds on a large repository and one
 * scratch file would leave a checkout dirty for good.
 */
async function checkoutIsDirty(readGit, cwd, signal) {
  try {
    await readGit(cwd, ["--no-optional-locks", "diff", "--quiet", "HEAD", "--"], { signal });
    return false;
  } catch (error) {
    if (Number(error?.code) === 1) return true;
    throw error;
  }
}

/** Reads one local worktree or repository as bounded Git and filesystem facts. */
export async function inspectLocalResource(target, { signal, statPath = stat, readGit = gitText } = {}) {
  try {
    signal?.throwIfAborted?.();
    const info = await statPath(target.path);
    signal?.throwIfAborted?.();
    if (!info.isDirectory()) return { state: "missing" };
    const bare = await readGit(target.path, ["rev-parse", "--is-bare-repository"], { signal });
    if (target.kind === "worktree" && bare === "true") return { state: "not-a-worktree" };
    if (target.kind === "worktree") {
      const root = await readGit(target.path, ["rev-parse", "--show-toplevel"], { signal });
      if (path.resolve(root) !== path.resolve(target.path)) return { state: "not-a-worktree" };
      const head = await readGit(target.path, ["rev-parse", "HEAD"], { signal });
      const branchRef = await optionalGitText(readGit, target.path, ["symbolic-ref", "-q", "HEAD"], signal, new Set([1]));
      return {
        state: "available",
        checkout: branchRef ? { kind: "branch", head, branchRef } : { kind: "detached", head },
        dirty: await checkoutIsDirty(readGit, target.path, signal),
        repositoryPath: await readGit(target.path, ["rev-parse", "--path-format=absolute", "--git-common-dir"], { signal }).then((folder) => path.dirname(folder)),
      };
    }
    const head = bare === "true"
      ? await optionalGitText(readGit, target.path, ["rev-parse", "HEAD"], signal, new Set([128]))
      : await readGit(target.path, ["rev-parse", "HEAD"], { signal });
    if (bare === "true") return { state: "available", checkout: { kind: "bare", head: head || null } };
    await readGit(target.path, ["rev-parse", "--show-toplevel"], { signal });
    const branchRef = await optionalGitText(readGit, target.path, ["symbolic-ref", "-q", "HEAD"], signal, new Set([1]));
    return { state: "available", checkout: branchRef ? { kind: "branch", head, branchRef } : { kind: "detached", head }, dirty: await checkoutIsDirty(readGit, target.path, signal) };
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return { state: "missing" };
    if (["EACCES", "EPERM"].includes(error?.code)) return { state: "access-denied" };
    throw error;
  }
}

/** Returns the public, bounded local error shape. */
function localError(error) {
  if (error?.code === "observation-capacity") return error;
  return { code: "local-check-failed", message: "Could not inspect the local target.", retryable: true };
}

/** Returns the public, bounded provider error shape. */
function providerError(error) {
  if (error?.code === "observation-capacity") return error;
  const code = SAFE_PROVIDER_CODES.has(error?.code) ? error.code : error?.name === "TimeoutError" ? "provider-timeout" : "provider-unavailable";
  const messages = {
    "provider-access-unavailable": "Provider access is unavailable.",
    "provider-timeout": "Provider status timed out.",
    "provider-unavailable": "Provider status is unavailable.",
  };
  return { code, message: messages[code], retryable: code !== "provider-access-unavailable" };
}

/** Runs one operation against an owned deadline and propagates caller cancellation. */
async function withDeadline(load, timeoutMs, callerSignal, cleanupGraceMs) {
  const controller = new AbortController();
  let timeoutId;
  let timedOut = false;
  /** Propagates an outer cancellation without leaking its reason into output. */
  const abort = () => controller.abort();
  if (callerSignal?.aborted) abort(); else callerSignal?.addEventListener("abort", abort, { once: true });
  let operation;
  try { operation = Promise.resolve(load(controller.signal)); }
  catch (error) { operation = Promise.reject(error); }
  const settled = operation.then(
    (value) => ({ state: "fulfilled", value }),
    (error) => ({ state: "rejected", error }),
  );
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ state: "timed-out" });
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([settled, timeout]);
    if (timedOut || result.state === "timed-out") {
      let cleanupTimer;
      await Promise.race([
        settled,
        new Promise((resolve) => { cleanupTimer = setTimeout(resolve, cleanupGraceMs); }),
      ]);
      clearTimeout(cleanupTimer);
      throw Object.assign(new Error("observation timed out"), { name: "TimeoutError" });
    }
    if (result.state === "rejected") throw result.error;
    return result.value;
  }
  finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abort);
  }
}

/** Creates the process-local, target-fenced observation authority. */
export function createAreaResourceObservations({
  localReader = inspectLocalResource,
  githubReader = null,
  phabricatorReader = null,
  recognition = { githubHost: "github.com", phabricatorBaseUrls: [] },
  capacity = DEFAULT_CAPACITY,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cleanupGraceMs = DEFAULT_CLEANUP_GRACE_MS,
  concurrency = 8,
  now = () => Date.now(),
} = {}) {
  const entries = new Map();
  const generations = new Map();
  let access = 0;
  let epoch = 0;

  /** Returns one locator's stable string identity. */
  function locatorKey(locator) { return `${locator?.owner ?? ""}\0${locator?.id ?? ""}`; }

  /** Returns a cache key and reader facet for one active resource. */
  function descriptor(resource) {
    if (!resource?.locator || !resource?.target || resource.membership?.state === "removed" || resource.sourceState === "gone") return null;
    const fingerprint = observationTargetFingerprint(resource.target);
    if (["worktree", "repository"].includes(resource.target.kind)) return { facet: "local", fingerprint, key: `${locatorKey(resource.locator)}\0${fingerprint}\0local`, recognition: null };
    const review = recognizeReviewLink(resource.target.url, recognition);
    if (review.kind === "generic") return { facet: "generic", fingerprint, key: null, recognition: review };
    return { facet: "provider", fingerprint, key: `${locatorKey(resource.locator)}\0${fingerprint}\0provider`, recognition: review };
  }

  /** Returns an immutable not-checked observation. */
  function notChecked() { return { state: "not-checked", value: null, checkedAt: null }; }

  /** Admits one inactive key, evicting only the least-recent inactive entry. */
  function admit(key) {
    let entry = entries.get(key);
    if (entry) return entry;
    if (entries.size >= capacity) {
      const victim = [...entries.entries()].filter(([, value]) => !value.inFlight).sort((left, right) => left[1].access - right[1].access)[0];
      if (!victim) return null;
      entries.delete(victim[0]);
    }
    entry = { observation: notChecked(), access: ++access, inFlight: null, generation: 0 };
    entries.set(key, entry);
    return entry;
  }

  /** Reads an entry without starting I/O. */
  function peek(resource) {
    const described = descriptor(resource);
    if (!described || described.facet === "generic") return notChecked();
    const entry = entries.get(described.key);
    if (!entry) return notChecked();
    entry.access = ++access;
    return structuredClone(entry.observation);
  }

  /** Projects one resource's independent local and Link facets. */
  function project(resource) {
    const described = descriptor(resource);
    if (!described) return resource?.target?.kind === "link" ? { local: null, link: { kind: "generic" } } : { local: notChecked(), link: null };
    if (described.facet === "local") return { local: peek(resource), link: null };
    if (described.facet === "generic") return { local: null, link: { kind: "generic" } };
    return { local: null, link: { ...described.recognition, lifecycle: peek(resource) } };
  }

  /** Loads one resource facet through the injected local or named provider reader. */
  async function load(resource, described, signal) {
    if (described.facet === "local") return localReader(resource.target, { signal });
    const review = described.recognition;
    const reader = review.kind === "github-pr" ? githubReader : phabricatorReader;
    if (!reader?.read) throw { code: "provider-unavailable" };
    const reference = review.kind === "github-pr"
      ? { owner: review.owner, repository: review.repository, number: review.number }
      : { baseUrl: review.baseUrl, revisionId: review.revisionId };
    const result = await reader.read(reference, { signal });
    if (result?.state === "error") throw result.error;
    if (result?.state !== "current" || !validProviderLabel(result.stateLabel) || !Number.isFinite(Date.parse(result.providerUpdatedAt))) {
      throw { code: "provider-state-unsupported" };
    }
    return {
      stateLabel: result.stateLabel,
      treatment: providerTreatment(review.kind === "github-pr" ? "github" : "phabricator", result.stateLabel),
      providerUpdatedAt: result.providerUpdatedAt,
    };
  }

  /** Refreshes one resource with coalescing, capacity control, and generation fencing. */
  async function refreshOne(resource, { signal } = {}) {
    const described = descriptor(resource);
    if (!described || described.facet === "generic") return { locator: resource?.locator ?? null, observation: notChecked(), skipped: true };
    const entry = admit(described.key);
    const capacityError = { code: "observation-capacity", message: "Resource observation capacity is busy.", retryable: true };
    if (!entry) return { locator: resource.locator, observation: { state: "unavailable", value: null, checkedAt: null, error: capacityError } };
    entry.access = ++access;
    if (entry.inFlight) return entry.inFlight;
    const cacheEpoch = epoch;
    const generation = generations.get(locatorKey(resource.locator)) ?? 0;
    const previous = entry.observation;
    entry.observation = { state: "checking", value: previous.value ?? null, checkedAt: previous.checkedAt ?? null };
    entry.inFlight = (async () => {
      let observation;
      try {
        const value = await withDeadline((ownedSignal) => load(resource, described, ownedSignal), timeoutMs, signal, cleanupGraceMs);
        observation = { state: "current", value, checkedAt: new Date(now()).toISOString() };
      } catch (error) {
        const bounded = described.facet === "local" ? localError(error) : error?.code === "provider-state-unsupported"
          ? { code: "provider-state-unsupported", message: "Provider returned an unsupported state.", retryable: true }
          : providerError(error);
        observation = previous.value
          ? { state: "last-known", value: previous.value, checkedAt: previous.checkedAt, error: bounded }
          : { state: "unavailable", value: null, checkedAt: null, error: bounded };
      }
      if (epoch === cacheEpoch && (generations.get(locatorKey(resource.locator)) ?? 0) === generation && entries.get(described.key) === entry) {
        entry.observation = observation;
        entry.access = ++access;
      }
      return { locator: resource.locator, observation: structuredClone(observation) };
    })().finally(() => { entry.inFlight = null; });
    return entry.inFlight;
  }

  /** Refreshes an ordered, bounded resource collection with at most eight active observations by default. */
  async function refresh(resources, options = {}) {
    if (!Array.isArray(resources) || resources.length > 500) throw Object.assign(new Error("refresh accepts at most 500 resources"), { code: "invalid-resource-request" });
    return mapWithConcurrency(resources, concurrency, (resource) => refreshOne(resource, options));
  }

  /** Invalidates every cached target generation for one locator. */
  function invalidate(locator) {
    const identity = locatorKey(locator);
    generations.set(identity, (generations.get(identity) ?? 0) + 1);
    for (const [key, entry] of entries) if (key.startsWith(`${identity}\0`)) {
      if (entry.inFlight) entry.observation = notChecked();
      else entries.delete(key);
    }
  }

  /** Clears every owner-keyed fact and fences late results after an Area move. */
  function clear() {
    epoch += 1;
    entries.clear();
    generations.clear();
  }

  /** Reports bounded cache facts for tests and health output. */
  function status() { return { size: entries.size, capacity, active: [...entries.values()].filter((entry) => entry.inFlight).length }; }

  return { clear, invalidate, peek, project, refresh, refreshOne, status };
}

export default { createAreaResourceObservations, inspectLocalResource, observationTargetFingerprint, providerTreatment, recognizeReviewLink, validProviderLabel };
