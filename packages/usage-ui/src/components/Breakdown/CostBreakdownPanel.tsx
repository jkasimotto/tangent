import React from "react";
import type { UsageBreakdownView } from "@tangent/usage-ui-data";
import { BreakdownBarList } from "./BreakdownBarList.js";

/** Renders the CostBreakdownPanel UI. */
export function CostBreakdownPanel({ breakdowns }: { breakdowns: UsageBreakdownView[] }): React.ReactElement {
  return (
    <section className="usage-section usage-breakdowns" aria-labelledby="usage-breakdown-title">
      <header className="usage-section__header">
        <h2 id="usage-breakdown-title">Where did cost go?</h2>
      </header>
      {breakdowns.length ? (
        <div className="usage-breakdowns__grid">
          {breakdowns.map((breakdown) => <BreakdownBarList key={breakdown.id} breakdown={breakdown} />)}
        </div>
      ) : <p className="usage-empty-note">No duration or token breakdown was available.</p>}
    </section>
  );
}
