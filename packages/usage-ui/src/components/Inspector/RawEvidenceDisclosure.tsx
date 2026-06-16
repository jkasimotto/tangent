import React from "react";
import { JsonInspector } from "@tangent/ui-code";

/** Renders the RawEvidenceDisclosure UI. */
export function RawEvidenceDisclosure({ value }: { value: unknown }): React.ReactElement {
  return (
    <details className="usage-raw-evidence">
      <summary>Raw evidence</summary>
      <JsonInspector value={value} />
    </details>
  );
}
