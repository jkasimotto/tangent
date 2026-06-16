import React from "react";
import type { UsageTranscriptHighlight } from "@tangent/usage-ui-data";
import { ToolClusterCard } from "./ToolClusterCard.js";

/** Renders the TranscriptHighlightCard UI. */
export function TranscriptHighlightCard({ highlight }: { highlight: UsageTranscriptHighlight }): React.ReactElement {
  if (highlight.kind === "tool-cluster") return <ToolClusterCard highlight={highlight} />;
  return (
    <article className="usage-highlight-card" data-role={highlight.role}>
      <header>
        <span>{highlight.title}</span>
        {highlight.tokenLabel ? <em>{highlight.tokenLabel} tok</em> : null}
      </header>
      <p>{highlight.summary}</p>
      {highlight.textPreview ? <blockquote>{highlight.textPreview}</blockquote> : null}
    </article>
  );
}
