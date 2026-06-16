import React, { useMemo, useState } from "react";
import type { UsageSessionFinderTabId, UsageSessionFinderView } from "@tangent/usage-ui-data";
import { SessionFinderItem } from "./SessionFinderItem.js";
import { SessionFinderTabs } from "./SessionFinderTabs.js";

/** Renders the SessionFinder UI. */
export function SessionFinder({
  finder,
  onSelectSession
}: {
  finder: UsageSessionFinderView;
  onSelectSession(id: string): void;
}): React.ReactElement {
  const [activeTab, setActiveTab] = useState<UsageSessionFinderTabId>(finder.activeTab);
  const visibleItems = useMemo(() => {
    if (activeTab === "recent") return finder.items;
    if (activeTab === "active") return finder.items.filter((item) => item.status === "active");
    if (activeTab === "costly") return finder.items.filter((item) => item.badges.includes("costly"));
    if (activeTab === "slow") return finder.items.filter((item) => item.badges.includes("slow"));
    if (activeTab === "errors") return finder.items.filter((item) => item.status === "failed" || item.badges.includes("failed"));
    return [];
  }, [activeTab, finder.items]);
  const groups = activeTab === "recent"
    ? finder.groups
    : [{ id: activeTab, label: labelForTab(activeTab), items: visibleItems }];

  return (
    <aside className="usage-session-finder" aria-label="Session finder">
      <header className="usage-session-finder__header">
        <p>Session Finder</p>
        <strong>{finder.items.length}</strong>
      </header>
      <SessionFinderTabs tabs={finder.tabs} activeTab={activeTab} onChange={setActiveTab} />
      <label className="usage-finder-search">
        <span>Search sessions</span>
        <input placeholder={finder.searchPlaceholder} />
      </label>
      <div className="usage-finder-sort">Sort: {finder.sortLabel}</div>
      <div className="usage-finder-groups">
        {groups.map((group) => (
          <section key={group.id} className="usage-finder-group">
            <h2>{group.label}</h2>
            {group.items.length ? group.items.map((item) => (
              <SessionFinderItem
                key={item.id}
                item={item}
                selected={item.id === finder.selectedSessionId}
                onSelect={onSelectSession}
              />
            )) : <p className="usage-finder-empty">No sessions in this filter.</p>}
          </section>
        ))}
      </div>
    </aside>
  );
}

/** Returns the label for tab. */
function labelForTab(tab: UsageSessionFinderTabId): string {
  if (tab === "active") return "Active";
  if (tab === "costly") return "Costly";
  if (tab === "slow") return "Slow";
  if (tab === "errors") return "Errors";
  if (tab === "starred") return "Starred";
  return "Recent";
}
