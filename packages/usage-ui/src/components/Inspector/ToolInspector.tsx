import React from "react";

/** Renders the ToolInspector UI. */
export function ToolInspector(): React.ReactElement {
  return (
    <section className="usage-inspector-section">
      <h3>Selected tool</h3>
      <p>Select a tool cluster to inspect commands, files, and provider evidence.</p>
    </section>
  );
}
