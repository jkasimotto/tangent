import {
  confidenceOrUnknown,
  formatCount,
  formatDuration,
  formatTokens,
  normalizeConfidence,
  stepKindLabel,
  stepSelfDuration,
  stepTokens,
  uniquePaths
} from "./format.js";
import type { DiagnosticMetricCard, UsageSession, UsageStep, UsageTone } from "./types.js";

/** Builds the diagnostic cards. */
export function buildDiagnosticCards(session: UsageSession, steps: UsageStep[]): DiagnosticMetricCard[] {
  const sessionDuration = session.metrics?.durationMs;
  const attributedDuration = attributedDurationMs(steps);
  const unattributed = sessionDuration === undefined ? undefined : Math.max(0, sessionDuration - attributedDuration);
  const tokenTotal = session.metrics?.tokens?.total;
  const readCount = steps.filter((step) => step.kind === "file_read" || step.kind === "file_search").length;
  const writeCount = steps.filter((step) => step.kind === "file_write").length;
  const editedFiles = uniquePaths(steps.filter((step) => step.kind === "file_write")).length;
  const topKind = topDurationKind(steps);

  return [
    {
      id: "duration",
      label: "Duration",
      value: formatDuration(sessionDuration) || "Unknown",
      confidence: normalizeConfidence(session.metrics?.durationConfidence) || confidenceOrUnknown(session.availability?.confidence),
      interpretation: durationInterpretation(sessionDuration, attributedDuration, unattributed, topKind?.label),
      tone: sessionDuration !== undefined && sessionDuration >= 60 * 60 * 1000 ? "warning" : "neutral",
      inspectTarget: { kind: "metric", id: "duration", label: "Duration contributors" }
    },
    {
      id: "tokens",
      label: "Tokens",
      value: formatTokens(tokenTotal) || "Unknown",
      confidence: normalizeConfidence(session.metrics?.tokens?.confidence) || confidenceOrUnknown(session.availability?.confidence),
      interpretation: tokenInterpretation(tokenTotal),
      tone: tokenTone(tokenTotal),
      inspectTarget: { kind: "metric", id: "tokens", label: "Token contributors" }
    },
    {
      id: "tools",
      label: "Tools",
      value: formatCount(session.counts?.toolCalls),
      confidence: "derived",
      interpretation: readCount || writeCount ? `${readCount} reads/searches - ${writeCount} writes` : "No tool mix available",
      tone: session.counts?.toolCalls !== undefined && session.counts.toolCalls >= 40 ? "warning" : "neutral",
      inspectTarget: { kind: "metric", id: "tools", label: "Tool calls" }
    },
    {
      id: "files",
      label: "Files",
      value: formatCount(session.counts?.filesTouched),
      confidence: "derived",
      interpretation: editedFiles ? `${editedFiles} edited` : "No edits detected",
      tone: editedFiles ? "info" : "neutral",
      inspectTarget: { kind: "metric", id: "files", label: "Files touched" }
    }
  ];
}

/** Supports the primary finding helper. */
export function primaryFinding(session: UsageSession, steps: UsageStep[]): { tone: UsageTone; text: string } | undefined {
  const caveats = session.availability?.notes || [];
  const duration = session.metrics?.durationMs;
  const attributed = attributedDurationMs(steps);
  const unattributed = duration === undefined ? undefined : Math.max(0, duration - attributed);
  const tokens = session.metrics?.tokens?.total;
  const quietLabel = quietActiveLabel(session);
  const topKind = topDurationKind(steps);

  if (quietLabel) return { tone: "warning", text: `This active session has been quiet for ${quietLabel}.` };
  if (unattributed !== undefined && duration && unattributed / duration >= 0.5) {
    return { tone: "warning", text: `${Math.round((unattributed / duration) * 100)}% of measured time is unattributed; step-level self-time needs inspection.` };
  }
  if (tokens !== undefined && tokens >= 50_000_000) {
    return { tone: "danger", text: `Token usage is extreme at ${formatTokens(tokens)} tokens.` };
  }
  if (topKind?.label && topKind.value > 0) {
    return { tone: "info", text: `Most attributed time was spent in ${topKind.label.toLowerCase()}.` };
  }
  if (caveats.length) return { tone: "warning", text: "This session has partial transcript capture or provider caveats." };
  return { tone: "success", text: "No major timing, token, or provider anomalies are visible." };
}

/** Supports the attributed duration ms helper. */
export function attributedDurationMs(steps: UsageStep[]): number {
  return steps
    .filter((step) => step.kind !== "session" && step.kind !== "turn")
    .reduce((sum, step) => sum + (stepSelfDuration(step) || 0), 0);
}

/** Finds the top duration kind. */
export function topDurationKind(steps: UsageStep[]): { kind: string; label: string; value: number } | undefined {
  const totals = new Map<string, number>();
  for (const step of steps) {
    if (step.kind === "session" || step.kind === "turn") continue;
    const value = stepSelfDuration(step) || 0;
    if (!value) continue;
    const kind = step.kind || "unknown";
    totals.set(kind, (totals.get(kind) || 0) + value);
  }
  const top = [...totals.entries()].sort((left, right) => right[1] - left[1])[0];
  return top ? { kind: top[0], label: stepKindLabel(top[0]), value: top[1] } : undefined;
}

/** Computes the total step tokens. */
export function totalStepTokens(steps: UsageStep[]): number {
  return steps.reduce((sum, step) => sum + (stepTokens(step) || 0), 0);
}

/** Supports the duration interpretation helper. */
function durationInterpretation(sessionDuration: number | undefined, attributedDuration: number, unattributed: number | undefined, topKindLabel: string | undefined): string {
  if (sessionDuration === undefined) return "Duration not available";
  if (unattributed !== undefined && sessionDuration > 0 && unattributed / sessionDuration >= 0.5) {
    return `${Math.round((unattributed / sessionDuration) * 100)}% unattributed`;
  }
  if (topKindLabel) return `Mostly ${topKindLabel.toLowerCase()}`;
  if (attributedDuration > 0) return "Attributed from step timing";
  return "Only session envelope timing available";
}

/** Supports the token interpretation helper. */
function tokenInterpretation(tokens: number | undefined): string {
  if (tokens === undefined) return "Token data unavailable";
  if (tokens >= 50_000_000) return "exact - extreme";
  if (tokens >= 10_000_000) return "high";
  if (tokens >= 1_000_000) return "large";
  return "normal";
}

/** Supports the token tone helper. */
function tokenTone(tokens: number | undefined): UsageTone {
  if (tokens !== undefined && tokens >= 50_000_000) return "danger";
  if (tokens !== undefined && tokens >= 10_000_000) return "warning";
  return "neutral";
}

/** Supports the quiet active label helper. */
function quietActiveLabel(session: UsageSession): string | undefined {
  if (session.status !== "active" || !session.lastActivityAt) return undefined;
  const last = Date.parse(session.lastActivityAt);
  if (!Number.isFinite(last)) return undefined;
  const minutes = Math.round((Date.now() - last) / 60000);
  if (minutes < 15) return undefined;
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
