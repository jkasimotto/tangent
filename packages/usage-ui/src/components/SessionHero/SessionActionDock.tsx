import React from "react";
import type { UsageActionModel } from "@tangent/usage-ui-data";

/** Renders the SessionActionDock UI. */
export function SessionActionDock({ actions }: { actions: UsageActionModel[] }): React.ReactElement {
  return (
    <nav className="usage-action-dock" aria-label="Next actions">
      {actions.slice(0, 6).map((action, index) => (
        <a key={action.id} href={action.href || "#"} data-primary={index === 0 || index === 1 || undefined}>
          {action.label}
        </a>
      ))}
    </nav>
  );
}
