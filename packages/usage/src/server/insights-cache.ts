import type { AgentTimeDistribution, Finding } from "@tangent/usage-core/core/insights/index";

/** How long one cached Insights computation stays fresh before the next request recomputes it. */
export const INSIGHTS_CACHE_TTL_MS = 120_000;

/**
 * The expensive, park-independent part of one Insights window: every finding computed with
 * includeParked true (park filtering happens per request after cache retrieval, so park and unpark
 * reflect immediately), the agent-time distribution, when the computation ran, and how many eval
 * sandbox conversations were dropped before computing.
 */
export type InsightsComputation = {
  /** Every finding in the window across all generators, pre park-filter and pre generator-filter. */
  findings: Finding[];
  distribution: AgentTimeDistribution;
  /** ISO timestamp of when this computation ran, served to clients so cached data is honest about its age. */
  computedAt: string;
  /** How many eval sandbox conversations were excluded from the window. Always 0 when includeEvalRuns was set. */
  excludedEvalRuns: number;
};

/** The request inputs that change what an Insights computation contains, and therefore form its cache key. */
export type InsightsComputationKeyParts = {
  repo: string;
  scope: "repo" | "all";
  days: number;
  includeEvalRuns: boolean;
};

/**
 * Builds the cache key for one Insights computation. Generator and park filtering are deliberately
 * absent: both are cheap per-request filters applied after cache retrieval, so one cached
 * computation serves every combination of them. Encoded as a JSON array so a repo path can never
 * collide with another field.
 */
export function insightsComputationCacheKey(parts: InsightsComputationKeyParts): string {
  return JSON.stringify([parts.repo, parts.scope, parts.days, parts.includeEvalRuns]);
}

/** A TTL-bounded in-process store of Insights computations, keyed by insightsComputationCacheKey. */
export type InsightsComputationCache = {
  /** Returns the cached computation for a key if it is fresher than the TTL, undefined otherwise. */
  get(key: string): InsightsComputation | undefined;
  /** Stores a computation under a key, restarting its TTL. */
  set(key: string, value: InsightsComputation): void;
};

/**
 * Creates the in-process cache for Insights computations. The window load plus generator run is the
 * expensive part of every Insights request (it re-reads and re-normalizes each conversation in the
 * window), so the server keeps one computation per key for INSIGHTS_CACHE_TTL_MS. `ttlMs` and `now`
 * are injectable so tests can drive expiry with a fake clock instead of sleeping.
 */
export function createInsightsComputationCache(options: { ttlMs?: number; now?: () => number } = {}): InsightsComputationCache {
  const ttlMs = options.ttlMs ?? INSIGHTS_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: InsightsComputation; storedAtMs: number }>();
  return {
    /** Returns the cached computation if present and fresher than the TTL, evicting an expired entry. */
    get(key: string): InsightsComputation | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.storedAtMs >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    /** Stores a computation, restarting its TTL. */
    set(key: string, value: InsightsComputation): void {
      entries.set(key, { value, storedAtMs: now() });
    }
  };
}
