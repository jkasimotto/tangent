import React from "react";
import type { UsageSessionHeroView } from "@tangent/usage-ui-data";

/** Renders the PrimaryFinding UI. */
export function PrimaryFinding({ finding }: { finding?: UsageSessionHeroView["primaryFinding"] }): React.ReactElement | null {
  if (!finding) return null;
  return <p className="usage-primary-finding" data-tone={finding.tone}>{finding.text}</p>;
}
