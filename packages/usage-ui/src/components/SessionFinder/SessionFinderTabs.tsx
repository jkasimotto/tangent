import React from "react";
import type { UsageSessionFinderTabId, UsageSessionFinderView } from "@tangent/usage-ui-data";

/** Renders the SessionFinderTabs UI. */
export function SessionFinderTabs({
  tabs,
  activeTab,
  onChange
}: {
  tabs: UsageSessionFinderView["tabs"];
  activeTab: UsageSessionFinderTabId;
  onChange(tab: UsageSessionFinderTabId): void;
}): React.ReactElement {
  return (
    <div className="usage-finder-tabs" role="tablist" aria-label="Session filters">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeTab}
          className="usage-finder-tab"
          onClick={() => onChange(tab.id)}
        >
          <span>{tab.label}</span>
          <em>{tab.count}</em>
        </button>
      ))}
    </div>
  );
}
