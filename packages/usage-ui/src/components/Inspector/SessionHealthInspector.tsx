import React from "react";
import type { UsageInspectorDefaultView } from "@tangent/usage-ui-data";

/** Renders the SessionHealthInspector UI. */
export function SessionHealthInspector({ inspector }: { inspector: UsageInspectorDefaultView }): React.ReactElement {
  return (
    <section className="usage-inspector-section">
      <h3>Session health</h3>
      <dl>
        {inspector.sessionHealth.map((item) => (
          <div key={item.label} data-tone={item.tone || "neutral"}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
