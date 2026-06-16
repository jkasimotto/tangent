import React from "react";
import type { UsageTraceWaterfallView } from "@tangent/usage-ui-data";
import { TraceLane } from "./TraceLane.js";
import { TraceLegend } from "./TraceLegend.js";
import { TraceMetricToggle } from "./TraceMetricToggle.js";

/** Renders the TraceWaterfall UI. */
export function TraceWaterfall({ trace }: { trace: UsageTraceWaterfallView }): React.ReactElement {
  return (
    <section className="usage-section usage-trace" aria-labelledby="usage-trace-title">
      <header className="usage-section__header usage-trace__header">
        <div>
          <h2 id="usage-trace-title">Trace waterfall</h2>
          <p>{traceSummary(trace)}</p>
        </div>
        <TraceMetricToggle metric={trace.metric} grouping={trace.grouping} />
      </header>
      <div className="usage-trace-envelope" aria-label="Session envelope totals">
        <span>Session envelope: {formatMs(trace.totals.sessionDurationMs)}</span>
        <span>Measured child self-time: {formatMs(trace.totals.attributedDurationMs)}</span>
        <span>Unattributed/idle/unknown: {formatMs(trace.totals.unattributedDurationMs)}</span>
      </div>
      <div className="usage-trace-canvas">
        <div className="usage-trace-axis">Time</div>
        {trace.lanes.length ? trace.lanes.map((lane) => (
          <TraceLane key={lane.id} lane={lane} totalMs={trace.range.durationMs || trace.totals.sessionDurationMs} />
        )) : <p className="usage-empty-note">No trace steps were available.</p>}
      </div>
      <TraceLegend />
    </section>
  );
}

/** Builds trace summary. */
function traceSummary(trace: UsageTraceWaterfallView): string {
  return `${trace.lanes.length} lanes · ${trace.caveats.length} caveats`;
}

/** Formats the ms. */
function formatMs(value: number | undefined): string {
  if (value === undefined) return "Unknown";
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}
