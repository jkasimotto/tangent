import { stepSelfDuration, stepTokens } from "./format.js";
import { timelineKind } from "./sessionTimeline.js";
import type { PrecomputedSparkline, UsageFlameKind, UsageSparkline, UsageSparklineBucket, UsageStep } from "./types.js";

const DEFAULT_BUCKETS = 28;

/**
 * Maps the index-precomputed session sparkline (raw step kinds, built at index time so the list view
 * needs no per-card timeline projection) into the UI shape by colouring each bucket's dominant kind.
 */
export function sparklineFromPrecomputed(precomputed: PrecomputedSparkline): UsageSparkline {
  return {
    durationMs: precomputed.durationMs,
    tokensTotal: precomputed.tokensTotal,
    compactions: precomputed.compactions,
    buckets: precomputed.buckets.map((bucket) => ({
      kind: timelineKind(bucket.kind),
      tokenShare: bucket.tokenShare,
      durationShare: bucket.durationShare
    }))
  };
}

type PackedStep = {
  kind: UsageFlameKind;
  durationMs: number;
  tokens: number;
};

type BucketAccumulator = {
  durationMs: number;
  tokens: number;
  kindMs: Map<UsageFlameKind, number>;
};

/**
 * Builds the compact per-session activity series shown on the conversation list cards and rail.
 * Steps are packed end-to-end by their active duration (idle gaps removed, matching the main
 * flame graph) and downsampled into fixed-width time buckets so every card renders with one
 * cheap payload instead of a per-card timeline fetch.
 */
export function buildSparkline(steps: UsageStep[], bucketCount = DEFAULT_BUCKETS): UsageSparkline | undefined {
  const visible = steps.filter((step) => step.kind !== "session" && step.kind !== "turn");
  if (!visible.length) return undefined;

  const ordered = [...visible].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || (left.startedAt || "").localeCompare(right.startedAt || ""));
  const fallbackSlot = averageKnownDuration(ordered);
  const packed: PackedStep[] = ordered.map((step) => ({
    kind: timelineKind(step.kind),
    durationMs: positiveDuration(stepSelfDuration(step)) ?? fallbackSlot,
    tokens: stepTokens(step) ?? 0
  }));

  const totalDuration = packed.reduce((sum, item) => sum + item.durationMs, 0) || packed.length;
  const buckets = accumulateBuckets(packed, totalDuration, bucketCount);
  const maxTokens = Math.max(0, ...buckets.map((bucket) => bucket.tokens));
  const maxDuration = Math.max(1, ...buckets.map((bucket) => bucket.durationMs));

  return {
    durationMs: totalDuration,
    tokensTotal: packed.reduce((sum, item) => sum + item.tokens, 0) || undefined,
    compactions: ordered.filter((step) => step.kind === "compaction").length,
    buckets: buckets.map((bucket) => bucketView(bucket, maxTokens, maxDuration))
  };
}

/** Distributes each packed step's duration and tokens across the time buckets it overlaps. */
function accumulateBuckets(packed: PackedStep[], totalDuration: number, bucketCount: number): BucketAccumulator[] {
  const bucketMs = totalDuration / bucketCount;
  const buckets: BucketAccumulator[] = Array.from({ length: bucketCount }, () => ({ durationMs: 0, tokens: 0, kindMs: new Map() }));
  let cursor = 0;
  for (const item of packed) {
    const start = cursor;
    const end = cursor + item.durationMs;
    cursor = end;
    const tokenRate = item.tokens / Math.max(1, item.durationMs);
    for (let index = 0; index < bucketCount; index += 1) {
      const overlap = Math.max(0, Math.min(end, (index + 1) * bucketMs) - Math.max(start, index * bucketMs));
      if (overlap <= 0) continue;
      const bucket = buckets[index];
      bucket.durationMs += overlap;
      bucket.tokens += tokenRate * overlap;
      bucket.kindMs.set(item.kind, (bucket.kindMs.get(item.kind) || 0) + overlap);
    }
  }
  return buckets;
}

/** Converts an accumulator into the normalized bucket view, colouring by the dominant kind. */
function bucketView(bucket: BucketAccumulator, maxTokens: number, maxDuration: number): UsageSparklineBucket {
  return {
    kind: dominantKind(bucket.kindMs),
    tokenShare: maxTokens > 0 ? bucket.tokens / maxTokens : 0,
    durationShare: bucket.durationMs / maxDuration
  };
}

/** Returns the kind holding the most duration in a bucket. */
function dominantKind(kindMs: Map<UsageFlameKind, number>): UsageFlameKind {
  let best: UsageFlameKind = "unknown";
  let bestMs = -1;
  for (const [kind, ms] of kindMs) {
    if (ms > bestMs) {
      best = kind;
      bestMs = ms;
    }
  }
  return best;
}

/** Returns the mean of known positive step durations, used to slot steps with missing timing. */
function averageKnownDuration(steps: UsageStep[]): number {
  const known = steps.map((step) => positiveDuration(stepSelfDuration(step))).filter((value): value is number => value !== undefined);
  if (!known.length) return 1;
  return Math.round(known.reduce((sum, value) => sum + value, 0) / known.length);
}

/** Returns a strictly positive duration or undefined. */
function positiveDuration(value: number | undefined): number | undefined {
  return value !== undefined && value > 0 ? value : undefined;
}
