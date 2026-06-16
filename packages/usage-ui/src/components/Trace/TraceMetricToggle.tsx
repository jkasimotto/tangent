import React from "react";
import type { TraceGrouping, TraceMetric } from "@tangent/usage-ui-data";

/** Renders the TraceMetricToggle UI. */
export function TraceMetricToggle({ metric, grouping }: { metric: TraceMetric; grouping: TraceGrouping }): React.ReactElement {
  return (
    <div className="usage-trace-controls" aria-label="Trace controls">
      <div>
        <span>Metric</span>
        {(["duration", "selfDuration", "tokens", "cost"] as TraceMetric[]).map((item) => (
          <button key={item} type="button" aria-pressed={item === metric}>{label(item)}</button>
        ))}
      </div>
      <div>
        <span>Group</span>
        {(["turn", "chapter", "stepKind", "model", "tool"] as TraceGrouping[]).map((item) => (
          <button key={item} type="button" aria-pressed={item === grouping}>{label(item)}</button>
        ))}
      </div>
    </div>
  );
}

/** Returns the label. */
function label(value: string): string {
  if (value === "selfDuration") return "Self duration";
  if (value === "stepKind") return "Step kind";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
