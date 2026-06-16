import React from "react";

const LEGEND = [
  ["user", "User"],
  ["model", "Model"],
  ["tool", "Tool"],
  ["command", "Command"],
  ["file", "File"],
  ["error", "Error"]
] as const;

/** Renders the TraceLegend UI. */
export function TraceLegend(): React.ReactElement {
  return (
    <div className="usage-trace-legend" aria-label="Trace legend">
      {LEGEND.map(([role, label]) => <span key={role} data-role={role}>{label}</span>)}
    </div>
  );
}
