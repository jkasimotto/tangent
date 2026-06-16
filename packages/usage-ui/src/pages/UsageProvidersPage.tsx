import React from "react";
import type { UsageCockpitView } from "@tangent/usage-ui-data";
import { UsageInspectorPanel } from "../components/Inspector/UsageInspectorPanel.js";

/** Renders the UsageProvidersPage UI. */
export function UsageProvidersPage({ cockpit }: { cockpit: UsageCockpitView }): React.ReactElement {
  return (
    <div className="usage-providers-page">
      <main className="usage-cockpit-main">
        <section className="usage-section">
          <header className="usage-section__header">
            <h2>Provider context</h2>
          </header>
          <div className="usage-provider-fields">
            <div><span>Provider</span><strong>{cockpit.session.provider}</strong></div>
            <div><span>Status</span><strong>{cockpit.session.status}</strong></div>
            <div><span>Repository</span><strong>{cockpit.session.repoLabel || "Unknown"}</strong></div>
            <div><span>Branch</span><strong>{cockpit.session.branchLabel || "Unknown"}</strong></div>
          </div>
        </section>
      </main>
      <UsageInspectorPanel cockpit={cockpit} />
    </div>
  );
}
