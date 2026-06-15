import React from "react";
import type { EvalRunDetailView } from "@tangent/eval-ui-data";
import { AnalysisWorkbench } from "@tangent/ui-patterns";
import { MetricCard, PageHeader, RunStatusStrip } from "@tangent/ui-components";
import { Table } from "@tangent/ui-primitives";

/** Renders the RunPage UI. */
export function RunPage({ run }: { run: EvalRunDetailView }): React.ReactElement {
  const statuses = run.run.variants.reduce<Record<string, number>>((acc, variant) => {
    const status = typeof variant === "object" && variant && "status" in variant ? String((variant as { status?: unknown }).status || "unknown") : "unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  return (
    <div className="eval-page">
      <PageHeader title={run.run.name || run.run.id} actions={<RunStatusStrip statuses={statuses} />} />
      <AnalysisWorkbench
        metrics={<>
          <MetricCard label="Cases" value={run.cases.length} unit="count" />
          <MetricCard label="Variants" value={run.run.variants.length} unit="count" />
          <MetricCard label="Metric rows" value={run.metrics.length} unit="count" />
        </>}
        visualization={<VariantMatrix run={run} />}
      />
    </div>
  );
}

/** Renders the VariantMatrix UI. */
function VariantMatrix({ run }: { run: EvalRunDetailView }): React.ReactElement {
  return (
    <div className="eval-variant-matrix">
      <Table>
        <thead><tr><th>Case</th><th>Variant</th><th>Status</th><th>Tokens</th><th>Time</th><th>Warnings</th></tr></thead>
        <tbody>
          {run.cases.flatMap((entry) => entry.variants.map((variant) => (
            <tr key={`${entry.caseId}:${variant.variantId}`}>
              <td>{entry.caseId}</td>
              <td>{variant.variantId}</td>
              <td>{variant.status}</td>
              <td>{variant.summary.tokensTotal ?? ""}</td>
              <td>{variant.summary.wallTimeMs ?? ""}</td>
              <td>{variant.warnings.length}</td>
            </tr>
          )))}
        </tbody>
      </Table>
    </div>
  );
}
