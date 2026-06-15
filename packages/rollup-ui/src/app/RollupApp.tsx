import React from "react";
import { TangentAppShell, type TangentNavModel } from "@tangent/ui-app-shell";
import { MetricCard, PageHeader } from "@tangent/ui-components";
import { RollupBuilderLayout } from "@tangent/ui-patterns";
import { Button } from "@tangent/ui-primitives";

/** Renders the RollupApp UI. */
export function RollupApp(): React.ReactElement {
  const nav: TangentNavModel = {
    product: "rollup",
    sections: [{ label: "Rollup", items: [
      { id: "new", label: "New rollup", href: "/rollup/new" },
      { id: "history", label: "History", href: "/history/rollups" }
    ] }]
  };
  return (
    <TangentAppShell nav={nav}>
      <PageHeader title="Rollup builder" />
      <RollupBuilderLayout
        steps={<section><h2>Selection</h2><p>Select sources, filters, and message rules.</p></section>}
        preview={<div className="eval-metric-grid">
          <MetricCard label="Messages included" value={0} unit="count" />
          <MetricCard label="Messages excluded" value={0} unit="count" />
          <MetricCard label="Tokens included" value={0} unit="tokens" />
          <MetricCard label="Tokens excluded" value={0} unit="tokens" />
        </div>}
        output={<section><h2>Output preview</h2><p>Rollup markdown, JSON, and prompt bundle exports appear here.</p></section>}
        actions={<Button variant="primary">Preview selection</Button>}
      />
    </TangentAppShell>
  );
}
