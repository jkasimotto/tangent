import React from "react";
import type { UsageTraceItem } from "@tangent/usage-ui-data";

/** Renders the TraceItem UI. */
export function TraceItem({ item, totalMs }: { item: UsageTraceItem; totalMs?: number }): React.ReactElement {
  const left = totalMs && item.offsetMs !== undefined ? Math.min(96, Math.max(0, (item.offsetMs / totalMs) * 100)) : 0;
  const width = totalMs && item.durationMs !== undefined ? Math.min(100 - left, Math.max(2, (item.durationMs / totalMs) * 100)) : 8;
  const style = {
    "--trace-left": `${left}%`,
    "--trace-width": `${width}%`
  } as React.CSSProperties;
  return (
    <button
      type="button"
      className="usage-trace-item"
      data-role={item.colorRole}
      data-status={item.status}
      style={style}
      title={`${item.label} · ${item.confidence}`}
    >
      <span>{item.label}</span>
    </button>
  );
}
