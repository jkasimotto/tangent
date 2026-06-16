import React from "react";
import type { UsageCockpitView } from "@tangent/usage-ui-data";
import { RawEvidenceDisclosure } from "./RawEvidenceDisclosure.js";
import { SessionHealthInspector } from "./SessionHealthInspector.js";

/** Renders the UsageInspectorPanel UI. */
export function UsageInspectorPanel({ cockpit }: { cockpit: UsageCockpitView }): React.ReactElement {
  const inspector = cockpit.inspector;
  return (
    <aside className="usage-inspector" aria-label="Inspector">
      <header>
        <h2>{inspector.title}</h2>
      </header>
      <SessionHealthInspector inspector={inspector} />
      <section className="usage-inspector-section">
        <h3>Top anomalies</h3>
        {inspector.anomalies.length ? (
          <ul className="usage-anomaly-list">
            {inspector.anomalies.map((anomaly) => (
              <li key={anomaly.label} data-tone={anomaly.tone || "neutral"}>
                <strong>{anomaly.label}</strong>
                <span>{anomaly.detail}</span>
              </li>
            ))}
          </ul>
        ) : <p>No anomalies detected.</p>}
      </section>
      <section className="usage-inspector-section">
        <h3>Evidence</h3>
        <dl>
          {inspector.evidence.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {inspector.caveats.length ? (
        <section className="usage-inspector-section">
          <h3>Caveats</h3>
          <ul>
            {inspector.caveats.slice(0, 5).map((caveat) => <li key={caveat}>{caveat}</li>)}
          </ul>
        </section>
      ) : null}
      <RawEvidenceDisclosure value={{ session: cockpit.session, diagnostics: cockpit.diagnostics, caveats: inspector.caveats }} />
    </aside>
  );
}
