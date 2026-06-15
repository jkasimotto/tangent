import React from "react";
import { TangentAppShell, type TangentNavModel } from "@tangent/ui-app-shell";
import { MetricCard, PageHeader } from "@tangent/ui-components";
import { MasterDetailLayout, ProgressiveMetadata, TranscriptLayout } from "@tangent/ui-patterns";
import { TranscriptMessage } from "@tangent/ui-code";

/** Renders the UsageApp UI. */
export function UsageApp(): React.ReactElement {
  const nav: TangentNavModel = {
    product: "usage",
    sections: [{ label: "Usage", items: [
      { id: "sessions", label: "Sessions", href: "/usage/sessions" },
      { id: "timeline", label: "Timeline", href: "/usage/timeline" },
      { id: "providers", label: "Providers", href: "/usage/providers" }
    ] }]
  };
  return (
    <TangentAppShell nav={nav}>
      <PageHeader title="Usage sessions" />
      <MasterDetailLayout
        list={<p>Sessions load from `UsageUiClient`.</p>}
        detail={<section>
          <div className="eval-metric-grid">
            <MetricCard label="Duration" value="Unknown" unit="ms" />
            <MetricCard label="Tokens" value="Unknown" unit="tokens" />
            <MetricCard label="Tool calls" value="Unknown" unit="count" />
          </div>
          <TranscriptLayout messages={<TranscriptMessage role="assistant" textPreview="Select a session to inspect transcript, timeline, tools, tokens, caveats, and next actions." />} />
        </section>}
        inspector={<ProgressiveMetadata>Raw provider metadata appears here only when requested.</ProgressiveMetadata>}
      />
    </TangentAppShell>
  );
}
