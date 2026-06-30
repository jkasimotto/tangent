import { buildUsageBreakdowns } from "./breakdown.js";
import { buildDiagnosticCards, primaryFinding } from "./diagnostics.js";
import {
  cleanTitle,
  confidenceOrUnknown,
  formatDuration,
  formatTimeRange,
  formatTokens,
  normalizeSessionStatus,
  statusLabel,
  stepTokens,
  truncateText
} from "./format.js";
import { buildSessionFinderView } from "./sessionFinder.js";
import { buildSessionStoryline } from "./storyline.js";
import { buildTraceWaterfall } from "./trace.js";
import { buildTranscriptHighlights } from "./transcriptHighlights.js";
import type {
  UsageActionModel,
  UsageCockpitOptions,
  UsageCockpitView,
  UsageInspectorDefaultView,
  UsageMessage,
  UsageSession,
  UsageSessionHeroView,
  UsageStep,
  UsageTimeline
} from "./types.js";

/** Builds the usage cockpit view. */
export function buildUsageCockpitView(
  session: UsageSession,
  steps: UsageStep[],
  messages: UsageMessage[],
  timeline: UsageTimeline = {},
  options: UsageCockpitOptions = {}
): UsageCockpitView {
  const caveats = uniqueCaveats([
    ...(session.availability?.notes || []),
    ...(timeline.caveats || []),
    ...(options.listCaveats || []),
    ...(options.detailCaveats || []),
    ...(options.timelineCaveats || []),
    ...(options.transcriptCaveats || [])
  ]);
  const allSessions = options.sessions?.length ? options.sessions : [session];
  const normalizedSession = {
    ...session,
    availability: {
      ...session.availability,
      notes: caveats
    }
  };
  const trace = buildTraceWaterfall(normalizedSession, steps, { metric: "duration", grouping: "turn" }, timeline);

  return {
    session: buildSessionHeroView(normalizedSession, steps, messages),
    finder: buildSessionFinderView(allSessions, options.selectedSessionId || session.id, { caveats: options.listCaveats, now: options.now }),
    diagnostics: buildDiagnosticCards(normalizedSession, steps),
    storyline: buildSessionStoryline(normalizedSession, steps, messages),
    trace,
    breakdowns: buildUsageBreakdowns(steps),
    transcriptHighlights: buildTranscriptHighlights(messages, steps),
    inspector: buildInspectorDefaultView(normalizedSession, steps, trace.caveats)
  };
}

/** Builds the session hero view. */
export function buildSessionHeroView(session: UsageSession, steps: UsageStep[], messages: UsageMessage[]): UsageSessionHeroView {
  const status = normalizeSessionStatus(session.status);
  const repoLabel = session.repo?.id || shortPath(session.repo?.root || session.repo?.cwd || session.cwd);
  const branchLabel = session.gitBranch || session.repo?.branch;
  const summary = session.summary || inferredSummary(session, steps, messages);
  return {
    provider: session.provider || "unknown",
    status,
    title: cleanTitle(session.title || session.firstPrompt || session.id),
    subtitle: [session.models?.[0], session.project].filter(Boolean).join(" · ") || "Conversation session",
    timeRangeLabel: formatTimeRange(session.startedAt, session.endedAt),
    repoLabel,
    branchLabel,
    summary,
    primaryFinding: primaryFinding(session, steps),
    actions: sessionActions(session.id)
  };
}

/** Builds the inspector default view. */
export function buildInspectorDefaultView(session: UsageSession, steps: UsageStep[], traceCaveats: string[] = []): UsageInspectorDefaultView {
  const caveats = uniqueCaveats([...(session.availability?.notes || []), ...traceCaveats]);
  const durationConfidence = confidenceOrUnknown(session.metrics?.durationConfidence || session.availability?.confidence);
  const tokenConfidence = confidenceOrUnknown(session.metrics?.tokens?.confidence || session.availability?.confidence);
  const duration = session.metrics?.durationMs;
  const attributed = steps.filter((step) => step.kind !== "session" && step.kind !== "turn").reduce((sum, step) => sum + (step.selfDurationMs || step.durationMs || step.metrics?.selfDurationMs || 0), 0);
  const unattributed = duration === undefined ? undefined : Math.max(0, duration - attributed);
  const anomalies = [];
  if (unattributed !== undefined && duration && unattributed / duration >= 0.5) {
    anomalies.push({ label: "Unattributed duration", detail: `${formatDuration(unattributed)} of ${formatDuration(duration)} is not assigned to child steps.`, tone: "warning" as const });
  }
  if ((session.metrics?.tokens?.total || 0) >= 50_000_000) {
    anomalies.push({ label: "Extreme tokens", detail: `${formatTokens(session.metrics?.tokens?.total)} tokens in one session.`, tone: "danger" as const });
  }
  if (!anomalies.length && caveats.length) {
    anomalies.push({ label: "Provider caveats", detail: caveats[0] || "Provider data is partial.", tone: "warning" as const });
  }
  return {
    title: "Inspector",
    sessionHealth: [
      { label: "Status", value: statusLabel(normalizeSessionStatus(session.status)), tone: normalizeSessionStatus(session.status) === "failed" ? "danger" : normalizeSessionStatus(session.status) === "active" ? "info" : "success" },
      { label: "Caveats", value: String(caveats.length), tone: caveats.length ? "warning" : "success" },
      { label: "Tokens", value: tokenConfidence, tone: tokenConfidence === "exact" ? "success" : "info" },
      { label: "Durations", value: durationConfidence, tone: durationConfidence === "unknown" ? "warning" : "info" },
      { label: "Native source", value: session.provider || "unknown", tone: "neutral" }
    ],
    anomalies,
    evidence: [
      { label: "Session id", value: session.id },
      { label: "Evidence refs", value: String(session.evidence?.length || 0) },
      { label: "Step refs", value: String(steps.reduce((sum, step) => sum + (step.evidence?.length || 0), 0)) }
    ],
    caveats,
    rawEvidenceTarget: { kind: "evidence", id: session.id, label: "Raw provider record" }
  };
}

/** Builds session actions. */
function sessionActions(sessionId: string): UsageActionModel[] {
  const id = encodeURIComponent(sessionId);
  return [
    { id: "read-transcript", label: "Read transcript", href: `/usage/sessions/${id}/messages` },
    { id: "inspect-trace", label: "Inspect trace", href: `/usage/sessions/${id}/timeline` },
    { id: "compare", label: "Compare with another session", href: `/usage/sessions/${id}/compare` },
    { id: "rollup", label: "Create rollup", href: `/rollup/new?session=${id}` },
    { id: "export", label: "Export session data", href: `/api/usage/sessions/${id}/export` },
    { id: "evidence", label: "Inspect evidence", href: `/usage/sessions/${id}/evidence` }
  ];
}

/** Supports the inferred summary helper. */
function inferredSummary(session: UsageSession, steps: UsageStep[], messages: UsageMessage[]): string {
  const firstPrompt = messages.find((message) => message.role === "user")?.textPreview || session.firstPrompt;
  const fileReads = steps.filter((step) => step.kind === "file_read" || step.kind === "file_search").length;
  const edits = steps.filter((step) => step.kind === "file_write").length;
  const commands = steps.filter((step) => step.kind === "command").length;
  if (firstPrompt) {
    const parts = [`The agent worked from the user prompt: ${truncateText(firstPrompt, 140)}`];
    if (fileReads || edits || commands) parts.push(`It recorded ${fileReads} read/search steps, ${edits} edit steps, and ${commands} command steps.`);
    return parts.join(" ");
  }
  if (steps.length) return `The agent produced ${steps.length} recorded steps across messages, tools, and provider events.`;
  return "No session summary is available from provider data.";
}

/** Supports the short path helper. */
function shortPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parts = value.split("/").filter(Boolean);
  return parts.at(-1) || value;
}

/** Returns unique caveats. */
function uniqueCaveats(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Supports the timeline steps helper. */
export function timelineSteps(timeline: UsageTimeline): UsageStep[] {
  return (timeline.items || []).map((item) => ({
    ...item,
    metrics: {
      ...item.metrics,
      tokens: item.metrics?.tokens || (item.metricValue && timeline.metric?.startsWith("tokens") ? { total: item.metricValue } : undefined)
    }
  }));
}

/** Supports the transcript messages helper. */
export function transcriptMessages(messages: UsageMessage[]): UsageMessage[] {
  return messages.map((message, index) => ({
    ...message,
    ordinal: message.ordinal ?? index,
    tokenUsage: message.tokenUsage || (message.tokens?.value && typeof message.tokens.value === "number" ? { total: message.tokens.value, confidence: message.confidence } : undefined)
  }));
}

/** Builds session total tokens. */
export function sessionTotalTokens(session: UsageSession, steps: UsageStep[]): number | undefined {
  return session.metrics?.tokens?.total || steps.reduce((sum, step) => sum + (stepTokens(step) || 0), 0) || undefined;
}
