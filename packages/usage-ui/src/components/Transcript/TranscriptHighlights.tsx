import React from "react";
import type { UsageTranscriptHighlightsView } from "@tangent/usage-ui-data";
import { TranscriptHighlightCard } from "./TranscriptHighlightCard.js";

/** Renders the TranscriptHighlights UI. */
export function TranscriptHighlights({ highlights }: { highlights: UsageTranscriptHighlightsView }): React.ReactElement {
  return (
    <section className="usage-section usage-highlights" aria-labelledby="usage-highlights-title">
      <header className="usage-section__header">
        <h2 id="usage-highlights-title">Transcript highlights</h2>
        <nav aria-label="Transcript highlight actions">
          {highlights.actions.slice(0, 3).map((action) => <a key={action.id} href={action.href || "#"}>{action.label}</a>)}
        </nav>
      </header>
      <div className="usage-highlights__grid">
        {highlights.highlights.map((highlight) => <TranscriptHighlightCard key={highlight.id} highlight={highlight} />)}
      </div>
    </section>
  );
}
