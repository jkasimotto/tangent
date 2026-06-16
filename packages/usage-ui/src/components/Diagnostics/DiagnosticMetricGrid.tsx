import React from "react";
import type { DiagnosticMetricCard as DiagnosticMetricCardView } from "@tangent/usage-ui-data";
import { DiagnosticMetricCard } from "./DiagnosticMetricCard.js";

/** Renders the DiagnosticMetricGrid UI. */
export function DiagnosticMetricGrid({ cards }: { cards: DiagnosticMetricCardView[] }): React.ReactElement {
  return (
    <section className="usage-diagnostic-grid" aria-label="Diagnostic metrics">
      {cards.map((card) => <DiagnosticMetricCard key={card.id} card={card} />)}
    </section>
  );
}
