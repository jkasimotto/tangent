import type { UsageBottleneck, UsageConversationChartRow } from "./types.js";

const BOTTLENECK_LIMIT = 8;

/**
 * Ranks the slowest activity for the bottleneck panel. Prefers step-level segments (a single slow
 * model or tool call is the most actionable thing to drill into); falls back to whole work turns
 * when no segment carries a duration. Each step-level candidate carries the command/query that ran
 * (`detail`) so the panel names what happened, not just the step kind. Drives the "jump to next
 * bottleneck" controls in the UI. `inputPreviews` maps step id to the command text (built once by
 * the caller and shared with the flame segment builder).
 */
export function rankBottlenecks(rows: UsageConversationChartRow[], inputPreviews: Map<string, string>): UsageBottleneck[] {
  const segmentCandidates = rows.flatMap((row) =>
    row.segments
      .filter((segment) => (segment.durationMs || 0) > 0)
      .map((segment) => ({
        id: segment.id,
        rowId: row.id,
        messageId: segment.messageId || row.messageId,
        stepId: segment.stepId,
        label: segment.label,
        detail: segment.stepId ? inputPreviews.get(segment.stepId) : undefined,
        kind: segment.kind as UsageBottleneck["kind"],
        durationMs: segment.durationMs as number,
        durationLabel: segment.durationLabel,
        confidence: segment.confidence
      }))
  );
  const candidates = segmentCandidates.length ? segmentCandidates : turnBottleneckCandidates(rows);
  return candidates
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, BOTTLENECK_LIMIT)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/** Builds work-turn bottleneck candidates when step segments lack durations. */
function turnBottleneckCandidates(rows: UsageConversationChartRow[]): Array<Omit<UsageBottleneck, "rank">> {
  return rows
    .filter((row) => (row.durationMs || 0) > 0)
    .map((row) => ({
      id: row.id,
      rowId: row.id,
      messageId: row.messageId,
      stepId: undefined,
      label: row.label,
      kind: "turn" as const,
      durationMs: row.durationMs as number,
      durationLabel: row.durationLabel,
      confidence: row.confidence
    }));
}
