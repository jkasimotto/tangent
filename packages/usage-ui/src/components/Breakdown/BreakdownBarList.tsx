import React from "react";
import type { UsageBreakdownView } from "@tangent/usage-ui-data";

/** Renders the BreakdownBarList UI. */
export function BreakdownBarList({ breakdown }: { breakdown: UsageBreakdownView }): React.ReactElement {
  return (
    <section className="usage-breakdown-list" aria-label={breakdown.title}>
      <h3>{breakdown.title}</h3>
      <div>
        {breakdown.items.map((item) => (
          <div key={item.id} className="usage-breakdown-row" data-role={item.colorRole}>
            <span>{item.label}</span>
            <div aria-hidden="true"><i style={{ width: `${Math.max(2, item.share * 100)}%` }} /></div>
            <strong>{item.valueLabel}</strong>
            <em>{item.shareLabel}</em>
          </div>
        ))}
      </div>
    </section>
  );
}
