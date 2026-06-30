import {
  cleanTitle,
  confidenceOrUnknown,
  formatDuration,
  formatTimeRange,
  formatTokens,
  normalizeSessionStatus,
  stepDuration,
  stepTokens,
  truncateText
} from "./format.js";
import type {
  UsageSession,
  UsageSessionTimelineView,
  UsageTimeline,
  UsageTimelineStepBar,
  UsageStep,
  UsageUiConfidence
} from "./types.js";

export type UsageSessionTimelineOptions = {
  sessions?: UsageSession[];
  selectedSessionId?: string;
  query?: string;
  listCaveats?: string[];
  timelineCaveats?: string[];
};

/** Builds the minimal session timeline view. */
export function buildUsageSessionTimelineView(
  session: UsageSession,
  steps: UsageStep[],
  timeline: UsageTimeline = {},
  options: UsageSessionTimelineOptions = {}
): UsageSessionTimelineView {
  const normalizedSteps = timelineBars(session, steps, timeline);
  const totalDurationMs = timelineDuration(session, normalizedSteps, timeline);
  const maxTokens = Math.max(1, ...normalizedSteps.map((step) => step.tokens || 0));
  const widthPx = Math.max(1200, Math.ceil(totalDurationMs / 1000) * 18, normalizedSteps.length * 44);
  const heightPx = 420;
  const warning = timelineWarning(normalizedSteps, options.timelineCaveats || []);

  return {
    selected: {
      id: session.id,
      title: cleanTitle(session.title || session.firstPrompt || session.id),
      provider: session.provider || "unknown",
      status: normalizeSessionStatus(session.status),
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationLabel: formatDuration(session.metrics?.durationMs || timeline.range?.durationMs),
      tokenLabel: formatTokens(sessionTotalTokens(session, normalizedSteps)),
      summaryLabel: selectedSummary(session, timeline),
      warning
    },
    picker: {
      query: options.query || "",
      results: pickerResults(options.sessions?.length ? options.sessions : [session], options.query)
    },
    chart: {
      totalDurationMs,
      maxTokens,
      widthPx,
      heightPx,
      steps: normalizedSteps
    }
  };
}

/** Builds bars from Usage steps without ranking by token volume. */
function timelineBars(session: UsageSession, steps: UsageStep[], timeline: UsageTimeline): UsageTimelineStepBar[] {
  const visible = steps
    .filter((step) => step.kind !== "session" && step.kind !== "turn")
    .map((step, index) => ({ step, index }))
    .sort((left, right) => {
      const leftOrder = left.step.order ?? left.step.offsetMs ?? left.index;
      const rightOrder = right.step.order ?? right.step.offsetMs ?? right.index;
      return leftOrder - rightOrder || (left.step.startedAt || "").localeCompare(right.step.startedAt || "");
    });
  const fallbackSlotMs = Math.max(1, Math.round((session.metrics?.durationMs || timeline.range?.durationMs || Math.max(visible.length, 1) * 60_000) / Math.max(visible.length, 1)));
  let cursor = 0;

  return visible.map(({ step, index }) => {
    const duration = stepDuration(step);
    const effectiveDuration = duration ?? fallbackSlotMs;
    const offset = cursor;
    cursor += effectiveDuration;
    const tokens = stepTokens(step) ?? (timeline.metric?.startsWith("tokens") ? step.metricValue : undefined);
    const confidence = barConfidence(step, offset, duration, tokens);
    return {
      id: step.id,
      label: cleanTitle(step.label || step.kind || `Step ${index + 1}`, `Step ${index + 1}`),
      kind: timelineKind(step.kind),
      startedAt: step.startedAt,
      endedAt: step.endedAt,
      offsetMs: Math.max(0, offset),
      durationMs: effectiveDuration,
      tokens,
      durationLabel: duration === undefined ? undefined : formatDuration(duration),
      tokenLabel: formatTokens(tokens),
      confidence,
      detail: {
        title: cleanTitle(step.label || step.kind || `Step ${index + 1}`, `Step ${index + 1}`),
        subtitle: [step.kind, step.status, step.model || step.actor?.model].filter(Boolean).join(" · ") || undefined,
        excerpt: truncateText(stringField(step.providerFields, "excerpt") || stringField(step.providerFields, "textPreview") || stringField(step.providerFields, "summary"), 180) || undefined,
        toolName: step.toolName,
        files: step.targetPaths,
        rawEventIds: step.evidence?.map((ref) => ref.eventId).filter((id): id is string => Boolean(id))
      }
    };
  });
}

/** Computes a stable timeline duration for chart scaling. */
function timelineDuration(session: UsageSession, steps: UsageTimelineStepBar[], timeline: UsageTimeline): number {
  const extent = Math.max(0, ...steps.map((step) => step.offsetMs + (step.durationMs || 0)));
  const envelope = session.metrics?.durationMs || timeline.range?.durationMs;
  const fallback = Math.max(steps.length, 1) * 60_000;
  return Math.max(1, envelope || 0, extent || fallback);
}

/** Maps raw Usage kinds into the minimal chart semantic set. */
export function timelineKind(kind: string | undefined): UsageTimelineStepBar["kind"] {
  if (kind === "user" || kind === "user_message" || kind === "prompt") return "user";
  if (kind === "assistant" || kind === "assistant_response") return "assistant";
  if (kind === "model" || kind === "model_call" || kind === "subagent") return "model";
  if (kind === "tool" || kind === "tool_call") return "tool";
  if (kind === "tool_result") return "tool_result";
  if (kind === "command") return "command";
  if (kind === "file" || kind === "file_read" || kind === "file_search" || kind === "file_write") return "file";
  if (kind === "system" || kind === "permission" || kind === "compaction") return "system";
  return "unknown";
}

/** Chooses confidence after timing/token normalization. */
function barConfidence(step: UsageStep, offsetMs: number, durationMs: number | undefined, tokens: number | undefined): UsageUiConfidence {
  if (step.confidence || step.durationConfidence) return confidenceOrUnknown(step.confidence || step.durationConfidence);
  if (step.offsetMs !== undefined && durationMs !== undefined && tokens !== undefined) return "exact";
  if (durationMs !== undefined || tokens !== undefined || offsetMs > 0) return "partial";
  return "unknown";
}

/** Builds picker rows for the compact top picker. */
function pickerResults(sessions: UsageSession[], query: string | undefined): UsageSessionTimelineView["picker"]["results"] {
  const needle = (query || "").toLowerCase().trim();
  return sessions
    .filter((session) => !needle || [session.title, session.firstPrompt, session.summary, session.provider, session.status].some((value) => (value || "").toLowerCase().includes(needle)))
    .map((session) => ({
      id: session.id,
      title: cleanTitle(session.title || session.firstPrompt || session.id),
      provider: session.provider || "unknown",
      status: normalizeSessionStatus(session.status),
      durationLabel: formatDuration(session.metrics?.durationMs),
      tokenLabel: formatTokens(session.metrics?.tokens?.total),
      reasonLabel: reasonLabel(session)
    }))
    .sort((left, right) => reasonRank(left.reasonLabel) - reasonRank(right.reasonLabel));
}

/** Selects a compact picker reason. */
function reasonLabel(session: UsageSession): UsageSessionTimelineView["picker"]["results"][number]["reasonLabel"] {
  const status = normalizeSessionStatus(session.status);
  if (status === "active") return "active";
  if (status === "failed") return "failed";
  if ((session.metrics?.tokens?.total || 0) >= 10_000_000) return "costly";
  if ((session.metrics?.durationMs || 0) >= 30 * 60 * 1000) return "slow";
  return "recent";
}

/** Orders picker reasons. */
function reasonRank(reason: UsageSessionTimelineView["picker"]["results"][number]["reasonLabel"]): number {
  if (reason === "active") return 0;
  if (reason === "recent") return 1;
  if (reason === "failed") return 2;
  if (reason === "costly") return 3;
  if (reason === "slow") return 4;
  return 5;
}

/** Builds selected session one-line summary. */
function selectedSummary(session: UsageSession, timeline: UsageTimeline): string {
  const range = formatTimeRange(session.startedAt || timeline.range?.startedAt, session.endedAt || timeline.range?.endedAt);
  return [session.provider || "unknown", normalizeSessionStatus(session.status), range, formatDuration(session.metrics?.durationMs || timeline.range?.durationMs), formatTokens(session.metrics?.tokens?.total)].filter(Boolean).join(" · ");
}

/** Chooses a single inline warning. */
function timelineWarning(steps: UsageTimelineStepBar[], caveats: string[]): string | undefined {
  if (steps.length && steps.every((step) => step.tokens === undefined)) return "Token data is unavailable for this provider/session.";
  if (steps.length && steps.some((step) => step.durationMs === undefined || step.confidence === "partial" || step.confidence === "estimated" || step.confidence === "unknown")) return "Step timing is partial; bar positions are estimated.";
  return caveats[0];
}

/** Totals tokens from the session or visible bars. */
function sessionTotalTokens(session: UsageSession, steps: UsageTimelineStepBar[]): number | undefined {
  return session.metrics?.tokens?.total || steps.reduce((sum, step) => sum + (step.tokens || 0), 0) || undefined;
}

/** Reads a string provider field. */
function stringField(fields: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = fields?.[key];
  return typeof value === "string" ? value : undefined;
}
