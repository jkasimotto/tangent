import React from "react";
import type { UsageTranscriptHighlight } from "@tangent/usage-ui-data";

/** Renders the ToolClusterCard UI. */
export function ToolClusterCard({ highlight }: { highlight: UsageTranscriptHighlight }): React.ReactElement {
  return (
    <article className="usage-highlight-card usage-highlight-card--tool">
      <header>
        <span>Tool cluster</span>
        {highlight.toolCallCount ? <em>{highlight.toolCallCount} calls</em> : null}
      </header>
      <h3>{highlight.title}</h3>
      <p>{highlight.summary}</p>
      {highlight.textPreview ? <code>{highlight.textPreview}</code> : null}
    </article>
  );
}
