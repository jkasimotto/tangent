import React from "react";
import type { UsageTraceLane } from "@tangent/usage-ui-data";
import { TraceItem } from "./TraceItem.js";

/** Renders the TraceLane UI. */
export function TraceLane({ lane, totalMs }: { lane: UsageTraceLane; totalMs?: number }): React.ReactElement {
  return (
    <div className="usage-trace-lane">
      <div className="usage-trace-lane__label">{lane.label}</div>
      <div className="usage-trace-lane__track">
        {lane.items.map((item) => <TraceItem key={item.id} item={item} totalMs={totalMs} />)}
      </div>
    </div>
  );
}
