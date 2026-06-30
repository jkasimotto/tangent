import { readFile } from "node:fs/promises";
import path from "node:path";

import type { EvalMetrics } from "../types/metrics.js";
import type { EvalRunManifest, EvalRunVariantState } from "../types/run.js";
import type { EvalAgentTelemetry } from "../types/telemetry.js";
import { variantDir } from "../core/run-store.js";
import { collectVariantMetrics } from "../core/metrics.js";
import { estimateCost } from "../core/cost.js";
import type { EvalSparkline, EvalSparklineKind, EvalVariantMetricsView } from "./types.js";

const SPARKLINE_BUCKETS = 28;

type SparkEvent = { at: number; kind: EvalSparklineKind; tokens: number };

/**
 * Reads a variant's metrics and projects the summary the Eval UI shows (time, peak context, code
 * change size, and a flame-palette activity sparkline). Prefers the persisted metrics.json written by
 * `collectEval`; for a variant that has started but not yet been collected (i.e. it is still running),
 * it computes a live snapshot from the usage index. The flame and token total fall back to the runner's
 * own activity telemetry (agent-telemetry.json) when the usage index has nothing, which is the normal
 * case for headless `claude --print` runs that write no scannable transcript. Returns null only for
 * not-yet-started configurations, which render empty.
 */
export async function readVariantMetricsView(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<EvalVariantMetricsView | null> {
  const metrics = await readMetrics(manifest, variant) ?? await liveMetrics(manifest, variant);
  const telemetry = await readAgentTelemetry(manifest, variant);
  if (!metrics && !telemetry) return null;
  const sparkline = (metrics && buildSparkline(metrics)) || (telemetry && sparklineFromTelemetry(telemetry)) || undefined;
  const cost = metrics ? estimateCost(metrics.tokens) : undefined;
  return {
    durationMs: metrics?.time.durationMs,
    activeAgentDurationMs: metrics?.time.activeAgentDurationMs,
    tokensTotal: metrics?.tokens.total ?? telemetry?.tokensTotal,
    cachedTokens: cost?.cachedTokens || undefined,
    costUsd: cost?.costUsd,
    peakContextTokens: metrics ? peakContextTokens(metrics) : undefined,
    filesChanged: metrics?.files.changed.length ?? 0,
    filesRead: metrics?.files.read.length ?? 0,
    diffStat: metrics?.git.diffStat,
    conversationIds: metrics?.conversations.map((conversation) => conversation.id) ?? [],
    sparkline
  };
}

/** Reads the runner's activity telemetry sidecar, returning undefined when it is absent or malformed. */
async function readAgentTelemetry(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<EvalAgentTelemetry | undefined> {
  const file = path.join(variantDir(manifest, variant.caseId, variant.variantId), "agent-telemetry.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as EvalAgentTelemetry;
    return parsed.schema === "eval.agent-telemetry.v1" && Array.isArray(parsed.events) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Builds a flame sparkline from the runner's timestamped activity events. */
function sparklineFromTelemetry(telemetry: EvalAgentTelemetry): EvalSparkline | undefined {
  const events: SparkEvent[] = [];
  for (const event of telemetry.events) {
    const at = Date.parse(event.at);
    if (Number.isNaN(at)) continue;
    events.push({ at, kind: event.kind, tokens: event.tokens });
  }
  return bucketEvents(events, telemetry.tokensTotal);
}

/**
 * Computes a live metrics snapshot for a started-but-not-collected variant, so an in-progress config
 * shows a growing flame and a live token count before its metrics.json exists. Returns undefined when
 * the variant has not started or the usage scan fails, in which case the card simply renders without a
 * flame until the next poll. Cost is one usage-index scan per active variant per poll, acceptable for
 * the handful of configs a local eval runs.
 */
async function liveMetrics(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<EvalMetrics | undefined> {
  if (!variant.startedAt) return undefined;
  try {
    return await collectVariantMetrics(manifest, variant);
  } catch {
    return undefined;
  }
}

/** Reads metrics.json for a variant, returning undefined when it is absent. */
async function readMetrics(manifest: EvalRunManifest, variant: EvalRunVariantState): Promise<EvalMetrics | undefined> {
  const file = path.join(variantDir(manifest, variant.caseId, variant.variantId), "metrics.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as EvalMetrics;
    return parsed.schema === "eval.metrics.v1" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Peak per-turn context, not cumulative tokens. A turn's context is its prompt size
 * (input + cache read + cache creation); the peak is the largest such turn. This matches the
 * "peak context" Usage adopted instead of summing every turn's full context.
 */
function peakContextTokens(metrics: EvalMetrics): number | undefined {
  let peak = 0;
  for (const message of metrics.tokens.messages) {
    const context = (message.input || 0) + (message.cacheRead || 0) + (message.cacheCreation || 0);
    if (context > peak) peak = context;
  }
  return peak > 0 ? peak : undefined;
}

/** Buckets messages and tool calls by timestamp into a flame-palette activity series. */
function buildSparkline(metrics: EvalMetrics): EvalSparkline | undefined {
  const events: SparkEvent[] = [];
  for (const message of metrics.tokens.messages) {
    const at = Date.parse(message.at);
    if (Number.isNaN(at)) continue;
    events.push({ at, kind: "assistant", tokens: messageTokens(message) });
  }
  for (const call of metrics.tools.calls) {
    const at = Date.parse(call.at);
    if (Number.isNaN(at)) continue;
    events.push({ at, kind: toolKind(call.category), tokens: 0 });
  }
  return bucketEvents(events, metrics.tokens.total);
}

/** Distributes timestamped activity events into a fixed-width flame series, or undefined when empty. */
function bucketEvents(events: SparkEvent[], tokensTotal: number | undefined): EvalSparkline | undefined {
  if (!events.length) return undefined;
  const start = Math.min(...events.map((event) => event.at));
  const end = Math.max(...events.map((event) => event.at));
  const span = Math.max(1, end - start);
  const buckets = Array.from({ length: SPARKLINE_BUCKETS }, () => ({ tokens: 0, count: 0, kindCount: new Map<EvalSparklineKind, number>() }));
  for (const event of events) {
    const index = Math.min(SPARKLINE_BUCKETS - 1, Math.floor(((event.at - start) / span) * SPARKLINE_BUCKETS));
    const bucket = buckets[index]!;
    bucket.tokens += event.tokens;
    bucket.count += 1;
    bucket.kindCount.set(event.kind, (bucket.kindCount.get(event.kind) || 0) + 1);
  }

  const maxTokens = Math.max(0, ...buckets.map((bucket) => bucket.tokens));
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return {
    durationMs: span,
    tokensTotal,
    buckets: buckets.map((bucket) => ({
      kind: dominantKind(bucket.kindCount),
      tokenShare: maxTokens > 0 ? bucket.tokens / maxTokens : 0,
      durationShare: bucket.count / maxCount
    }))
  };
}

/** Returns total tokens billed for a usage message. */
function messageTokens(message: EvalMetrics["tokens"]["messages"][number]): number {
  return message.total ?? (message.input || 0) + (message.output || 0) + (message.cacheRead || 0) + (message.cacheCreation || 0);
}

/** Maps a tool-call category to a flame-palette kind. */
function toolKind(category: string): EvalSparklineKind {
  if (category.startsWith("file")) return "file";
  if (category === "command") return "command";
  return "tool";
}

/** Returns the kind with the most events in a bucket. */
function dominantKind(kindCount: Map<EvalSparklineKind, number>): EvalSparklineKind {
  let best: EvalSparklineKind = "unknown";
  let bestCount = -1;
  for (const [kind, count] of kindCount) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best;
}
