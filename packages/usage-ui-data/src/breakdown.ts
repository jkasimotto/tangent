import { formatDuration, formatTokens, stepKindLabel, stepSelfDuration, stepTokens } from "./format.js";
import type { TraceMetric, UsageBreakdownItem, UsageBreakdownView, UsageStep } from "./types.js";

/** Builds the usage breakdowns. */
export function buildUsageBreakdowns(steps: UsageStep[]): UsageBreakdownView[] {
  return [
    buildBreakdown("duration-by-kind", "Duration", "duration", "ms", steps, (step) => stepSelfDuration(step) || 0),
    buildBreakdown("tokens-by-kind", "Tokens", "tokens", "tokens", steps, (step) => stepTokens(step) || 0)
  ].filter((breakdown) => breakdown.items.length > 0);
}

/** Builds the breakdown. */
function buildBreakdown(
  id: string,
  title: string,
  metric: TraceMetric,
  unit: UsageBreakdownView["unit"],
  steps: UsageStep[],
  valueFor: (step: UsageStep) => number
): UsageBreakdownView {
  const totals = new Map<string, number>();
  for (const step of steps) {
    if (step.kind === "session" || step.kind === "turn") continue;
    const value = valueFor(step);
    if (!value) continue;
    const kind = step.kind || "unknown";
    totals.set(kind, (totals.get(kind) || 0) + value);
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  const items: UsageBreakdownItem[] = [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([kind, value]) => ({
      id: `${id}:${kind}`,
      label: stepKindLabel(kind),
      value,
      valueLabel: unit === "ms" ? formatDuration(value) || "0ms" : unit === "tokens" ? `${formatTokens(value) || "0"} tok` : String(value),
      share: total ? value / total : 0,
      shareLabel: total ? `${Math.round((value / total) * 100)}%` : "0%",
      colorRole: colorRoleForKind(kind)
    }));
  return {
    id,
    title,
    metric,
    groupBy: "stepKind",
    unit,
    items
  };
}

/** Supports the color role for kind helper. */
function colorRoleForKind(kind: string): string {
  if (kind === "assistant_response" || kind === "model_call") return "model";
  if (kind === "command") return "command";
  if (kind === "file_read" || kind === "file_search" || kind === "file_write") return "file";
  if (kind === "tool_call" || kind === "tool_result") return "tool";
  if (kind === "user_message") return "user";
  if (kind === "error") return "error";
  return "system";
}
