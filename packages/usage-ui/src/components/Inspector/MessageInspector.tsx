import React from "react";

/** Renders the MessageInspector UI. */
export function MessageInspector(): React.ReactElement {
  return (
    <section className="usage-inspector-section">
      <h3>Selected message</h3>
      <p>Select a transcript highlight to inspect message evidence.</p>
    </section>
  );
}
