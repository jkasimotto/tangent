import React from "react";
import type { DiagnosticMetricCard as DiagnosticMetricCardView } from "@tangent/usage-ui-data";

/** Renders the DiagnosticMetricCard UI. */
export function DiagnosticMetricCard({ card }: { card: DiagnosticMetricCardView }): React.ReactElement {
  return (
    <button type="button" className="usage-diagnostic-card" data-tone={card.tone || "neutral"} aria-label={`Inspect ${card.label}`}>
      <span className="usage-diagnostic-card__label">{card.label}</span>
      <strong>{card.value}</strong>
      {card.unit ? <span className="usage-diagnostic-card__unit">{card.unit}</span> : null}
      <span className="usage-diagnostic-card__interpretation">{card.interpretation || "No interpretation available"}</span>
      {card.confidence ? <em>{card.confidence}</em> : null}
    </button>
  );
}
