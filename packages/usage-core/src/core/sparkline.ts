import type { UsageStep } from "../schema/index.js";

const DEFAULT_BUCKETS = 28;

/** A single time slice of a session's activity, coloured by its dominant raw step kind. */
export type SessionSparklineBucket = {
  /** Dominant raw step kind in this slice (e.g. "model_call", "tool_call"); the UI maps it to a flame colour. */
  kind: string;
  /** Token intensity for this slice, 0..1 relative to the busiest slice. */
  tokenShare: number;
  /** Duration intensity fallback for this slice when tokens are unavailable, 0..1. */
  durationShare: number;
};

/** Compact, precomputed per-session activity series shown on the session list cards and rail. */
export type SessionSparkline = {
  durationMs: number;
  tokensTotal?: number;
  compactions: number;
  buckets: SessionSparklineBucket[];
};

type PackedStep = {
  kind: string;
  durationMs: number;
  tokens: number;
};

type BucketAccumulator = {
  durationMs: number;
  tokens: number;
  kindMs: Map<string, number>;
};

/**
 * Builds the compact activity series for one session by packing its steps end-to-end by active
 * duration (idle gaps removed) and downsampling into fixed-width time buckets. Precomputed once at
 * index time and stored on the session row so the list view renders every card from a single cheap
 * payload instead of a per-card timeline projection (the N+1 that made the list slow). Buckets carry
 * the raw step kind; the UI maps it to a flame colour at render time, keeping this layer UI-free.
 */
export function buildSessionSparkline(steps: UsageStep[], bucketCount = DEFAULT_BUCKETS): SessionSparkline | undefined {
  const visible = steps.filter((step) => step.kind !== "session" && step.kind !== "turn");
  if (!visible.length) return undefined;

  const ordered = [...visible].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || (left.startedAt || "").localeCompare(right.startedAt || ""));
  const fallbackSlot = averageKnownDuration(ordered);
  const packed: PackedStep[] = ordered.map((step) => ({
    kind: step.kind,
    durationMs: positiveDuration(selfDuration(step)) ?? fallbackSlot,
    tokens: finite(step.metrics?.tokens?.total) ?? 0
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
      const bucket = buckets[index]!;
      bucket.durationMs += overlap;
      bucket.tokens += tokenRate * overlap;
      bucket.kindMs.set(item.kind, (bucket.kindMs.get(item.kind) || 0) + overlap);
    }
  }
  return buckets;
}

/** Converts an accumulator into the normalized bucket view, colouring by the dominant kind. */
function bucketView(bucket: BucketAccumulator, maxTokens: number, maxDuration: number): SessionSparklineBucket {
  return {
    kind: dominantKind(bucket.kindMs),
    tokenShare: maxTokens > 0 ? bucket.tokens / maxTokens : 0,
    durationShare: bucket.durationMs / maxDuration
  };
}

/** Returns the kind holding the most duration in a bucket. */
function dominantKind(kindMs: Map<string, number>): string {
  let best = "unknown";
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
  const known = steps.map((step) => positiveDuration(selfDuration(step))).filter((value): value is number => value !== undefined);
  if (!known.length) return 1;
  return Math.round(known.reduce((sum, value) => sum + value, 0) / known.length);
}

/** Resolves a step's self-duration, falling back through metrics and total duration. */
function selfDuration(step: UsageStep): number | undefined {
  return finite(step.selfDurationMs) ?? finite(step.metrics?.selfDurationMs) ?? finite(step.durationMs) ?? finite(step.metrics?.durationMs);
}

/** Returns a strictly positive duration or undefined. */
function positiveDuration(value: number | undefined): number | undefined {
  return value !== undefined && value > 0 ? value : undefined;
}

/** Returns a finite number or undefined. */
function finite(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
