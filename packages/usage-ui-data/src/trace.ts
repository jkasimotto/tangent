import { attributedDurationMs } from "./diagnostics.js";
import { confidenceOrUnknown, normalizeStepStatus, stepDuration, stepSelfDuration, stepTokens } from "./format.js";
import type {
  TraceMetric,
  TraceWaterfallOptions,
  UsageSession,
  UsageStep,
  UsageTimeline,
  UsageTraceItem,
  UsageTraceLane,
  UsageTraceWaterfallView
} from "./types.js";

const LANE_DEFINITIONS: Array<{ id: string; label: string; kinds: string[] }> = [
  { id: "user", label: "User", kinds: ["user_message"] },
  { id: "model", label: "Assistant/model", kinds: ["assistant_response", "model_call"] },
  { id: "tools", label: "Tools", kinds: ["tool_call", "tool_result", "permission"] },
  { id: "files", label: "Files", kinds: ["file_read", "file_search", "file_write"] },
  { id: "commands", label: "Commands", kinds: ["command"] },
  { id: "subagents", label: "Subagents", kinds: ["subagent"] },
  { id: "system", label: "System/caveats", kinds: ["compaction", "error", "unknown"] }
];

/** Builds the trace waterfall. */
export function buildTraceWaterfall(
  session: UsageSession,
  steps: UsageStep[],
  options: TraceWaterfallOptions = {},
  timeline?: UsageTimeline
): UsageTraceWaterfallView {
  const metric = options.metric || "duration";
  const grouping = options.grouping || "turn";
  const range = {
    startedAt: timeline?.range?.startedAt || earliest(steps.map((step) => step.startedAt)) || session.startedAt,
    endedAt: timeline?.range?.endedAt || latest(steps.map((step) => step.endedAt || step.startedAt)) || session.endedAt,
    durationMs: session.metrics?.durationMs || timeline?.range?.durationMs
  };
  const rangeStart = range.startedAt ? Date.parse(range.startedAt) : undefined;
  const leafSteps = steps.filter((step) => step.kind !== "session" && step.kind !== "turn");
  const lanes = LANE_DEFINITIONS.map((lane) => ({
    id: lane.id,
    label: lane.label,
    items: leafSteps
      .filter((step) => lane.kinds.includes(step.kind || "unknown"))
      .map((step) => traceItem(step, rangeStart))
  })).filter((lane) => lane.items.length > 0);
  const uncategorized = leafSteps.filter((step) => !LANE_DEFINITIONS.some((lane) => lane.kinds.includes(step.kind || "unknown")));
  if (uncategorized.length) {
    lanes.push({ id: "other", label: "Other", items: uncategorized.map((step) => traceItem(step, rangeStart)) });
  }
  const sessionDurationMs = range.durationMs;
  const attributed = attributedDurationMs(leafSteps);
  const unattributed = sessionDurationMs === undefined ? undefined : Math.max(0, sessionDurationMs - attributed);
  return {
    metric,
    grouping,
    range,
    lanes,
    totals: {
      sessionDurationMs,
      attributedDurationMs: attributed || undefined,
      unattributedDurationMs: unattributed,
      totalTokens: session.metrics?.tokens?.total || leafSteps.reduce((sum, step) => sum + (stepTokens(step) || 0), 0) || undefined
    },
    caveats: traceCaveats(session, leafSteps, unattributed)
  };
}

/** Builds trace item. */
function traceItem(step: UsageStep, rangeStart: number | undefined): UsageTraceItem {
  const startedAt = step.startedAt;
  const offsetMs = step.offsetMs ?? (rangeStart !== undefined && startedAt ? Math.max(0, Date.parse(startedAt) - rangeStart) : undefined);
  return {
    id: step.id,
    stepId: step.id,
    label: step.label || step.toolName || step.kind || "Step",
    kind: step.kind || "unknown",
    startedAt,
    endedAt: step.endedAt,
    offsetMs,
    durationMs: stepDuration(step),
    selfDurationMs: stepSelfDuration(step),
    tokens: stepTokens(step),
    status: normalizeStepStatus(step.status),
    confidence: confidenceOrUnknown(step.durationConfidence || step.confidence),
    colorRole: traceColorRole(step)
  };
}

/** Builds trace color role. */
function traceColorRole(step: UsageStep): string {
  if (step.status === "error" || step.kind === "error") return "error";
  if (step.kind === "user_message") return "user";
  if (step.kind === "assistant_response" || step.kind === "model_call") return "model";
  if (step.kind === "command") return "command";
  if (step.kind === "file_read" || step.kind === "file_search" || step.kind === "file_write") return "file";
  if (step.kind === "tool_call" || step.kind === "tool_result" || step.kind === "permission") return "tool";
  return "system";
}

/** Builds trace caveats. */
function traceCaveats(session: UsageSession, steps: UsageStep[], unattributed: number | undefined): string[] {
  const caveats = new Set<string>(session.availability?.notes || []);
  const sessionDuration = session.metrics?.durationMs;
  if (sessionDuration && unattributed !== undefined && unattributed / sessionDuration >= 0.5) {
    caveats.add("Most session envelope time is not attributed to child steps.");
  }
  if (steps.some((step) => confidenceOrUnknown(step.durationConfidence || step.confidence) === "unknown")) {
    caveats.add("Some step durations have unknown confidence.");
  }
  return [...caveats];
}

/** Supports the earliest helper. */
function earliest(values: Array<string | undefined>): string | undefined {
  return values.filter(Boolean).sort()[0];
}

/** Supports the latest helper. */
function latest(values: Array<string | undefined>): string | undefined {
  return values.filter(Boolean).sort().at(-1);
}

/** Supports the metric value for step helper. */
export function metricValueForStep(step: UsageStep, metric: TraceMetric): number {
  if (metric === "duration") return stepDuration(step) || 0;
  if (metric === "selfDuration") return stepSelfDuration(step) || 0;
  if (metric === "tokens") return stepTokens(step) || 0;
  if (metric === "cost") return step.metrics?.cost?.amount || 0;
  return 0;
}
