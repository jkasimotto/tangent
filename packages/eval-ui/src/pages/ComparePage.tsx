import React from "react";
import type { EvalCompareView, EvalRunDetailView } from "@tangent/eval-ui-data";
import { TimelineBarChart } from "@tangent/ui-charts";
import { DiffViewer, MarkdownBlock } from "@tangent/ui-code";
import { CaveatList, CompareSelector, MetricCard, MetricDelta, PageHeader } from "@tangent/ui-components";
import { CompareLayout } from "@tangent/ui-patterns";
import { Tabs } from "@tangent/ui-primitives";

/** Renders the ComparePage UI. */
export function ComparePage({ run, compare }: { run: EvalRunDetailView; compare: EvalCompareView }): React.ReactElement {
  return (
    <div className="eval-page">
      <PageHeader title={`${run.run.name || run.run.id} compare`} />
      <CompareLayout
        controls={<CompareSelector>{compare.caseId} · {compare.left.variantId} vs {compare.right.variantId} · {compare.phase}</CompareSelector>}
        overview={<div className="eval-metric-grid">
          <MetricCard label="Left tokens" value={compare.left.summary.tokensTotal} unit="tokens" />
          <MetricCard label="Right tokens" value={compare.right.summary.tokensTotal} unit="tokens" />
          <MetricDelta label="Tokens" leftLabel={compare.left.variantId} rightLabel={compare.right.variantId} left={compare.left.summary.tokensTotal} right={compare.right.summary.tokensTotal} unit="tokens" polarity="lower-is-better" />
          <MetricDelta label="Wall time" leftLabel={compare.left.variantId} rightLabel={compare.right.variantId} left={compare.left.summary.wallTimeMs} right={compare.right.summary.wallTimeMs} unit="ms" polarity="lower-is-better" />
        </div>}
        left={<VariantSummary label="Left" variant={compare.left} />}
        right={<VariantSummary label="Right" variant={compare.right} />}
        tabs={<Tabs aria-label="Comparison details" tabs={[
          { id: "metrics", label: "Metrics", panel: <MetricDeltas compare={compare} /> },
          { id: "timeline", label: "Timeline", panel: <TimelineBarChart metric="durationMs" items={[
            { id: "left", label: compare.left.variantId, kind: "variant", durationMs: compare.left.summary.wallTimeMs },
            { id: "right", label: compare.right.variantId, kind: "variant", durationMs: compare.right.summary.wallTimeMs }
          ]} /> },
          { id: "output", label: "Output", panel: <Output compare={compare} /> },
          { id: "diff", label: "Diff", panel: <DiffViewer diff={compare.git.comparisonDiff || "No diff available"} /> },
          { id: "files", label: "Files", panel: <MarkdownBlock markdown={[...compare.git.changedFiles.shared, ...compare.git.changedFiles.onlyLeft, ...compare.git.changedFiles.onlyRight].join("\n") || "No files changed"} /> },
          { id: "warnings", label: "Warnings", panel: <CaveatList caveats={compare.warnings} /> }
        ]} />}
      />
    </div>
  );
}

/** Renders the VariantSummary UI. */
function VariantSummary({ label, variant }: { label: string; variant: EvalCompareView["left"] }): React.ReactElement {
  return (
    <section className="eval-variant-card">
      <strong>{label}: {variant.variantId}</strong>
      <span>{variant.status}</span>
      <span>{variant.summary.toolCalls} tools · {variant.summary.filesChanged} files · {variant.summary.commandFailures} command failures</span>
    </section>
  );
}

/** Renders the MetricDeltas UI. */
function MetricDeltas({ compare }: { compare: EvalCompareView }): React.ReactElement {
  return (
    <div className="eval-metric-grid">
      <MetricDelta label="Active agent time" leftLabel="Left" rightLabel="Right" left={compare.left.summary.activeAgentTimeMs} right={compare.right.summary.activeAgentTimeMs} unit="ms" polarity="lower-is-better" />
      <MetricDelta label="Tool calls" leftLabel="Left" rightLabel="Right" left={compare.left.summary.toolCalls} right={compare.right.summary.toolCalls} unit="count" polarity="neutral" />
      <MetricDelta label="Command failures" leftLabel="Left" rightLabel="Right" left={compare.left.summary.commandFailures} right={compare.right.summary.commandFailures} unit="count" polarity="lower-is-better" />
      <MetricDelta label="Files changed" leftLabel="Left" rightLabel="Right" left={compare.left.summary.filesChanged} right={compare.right.summary.filesChanged} unit="files" polarity="neutral" />
    </div>
  );
}

/** Renders the Output UI. */
function Output({ compare }: { compare: EvalCompareView }): React.ReactElement {
  return (
    <div className="tg-side-by-side">
      <MarkdownBlock markdown={compare.outputs.leftImplementation || compare.outputs.leftPlan || "No output"} />
      <MarkdownBlock markdown={compare.outputs.rightImplementation || compare.outputs.rightPlan || "No output"} />
    </div>
  );
}
