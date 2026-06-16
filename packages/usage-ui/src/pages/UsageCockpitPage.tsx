import React from "react";
import type { UsageCockpitView } from "@tangent/usage-ui-data";
import { CostBreakdownPanel } from "../components/Breakdown/CostBreakdownPanel.js";
import { DiagnosticMetricGrid } from "../components/Diagnostics/DiagnosticMetricGrid.js";
import { UsageInspectorPanel } from "../components/Inspector/UsageInspectorPanel.js";
import { SessionFinder } from "../components/SessionFinder/SessionFinder.js";
import { SessionHero } from "../components/SessionHero/SessionHero.js";
import { SessionStoryline } from "../components/Storyline/SessionStoryline.js";
import { TraceWaterfall } from "../components/Trace/TraceWaterfall.js";
import { TranscriptHighlights } from "../components/Transcript/TranscriptHighlights.js";

/** Renders the UsageCockpitPage UI. */
export function UsageCockpitPage({
  cockpit,
  onSelectSession
}: {
  cockpit: UsageCockpitView;
  onSelectSession(id: string): void;
}): React.ReactElement {
  return (
    <div className="usage-cockpit-page">
      <SessionFinder finder={cockpit.finder} onSelectSession={onSelectSession} />
      <main className="usage-cockpit-main">
        <SessionHero session={cockpit.session} />
        <DiagnosticMetricGrid cards={cockpit.diagnostics} />
        <SessionStoryline storyline={cockpit.storyline} />
        <TraceWaterfall trace={cockpit.trace} />
        <CostBreakdownPanel breakdowns={cockpit.breakdowns} />
        <TranscriptHighlights highlights={cockpit.transcriptHighlights} />
      </main>
      <UsageInspectorPanel cockpit={cockpit} />
    </div>
  );
}
