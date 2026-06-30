import { cleanTitle, formatDuration, formatTokens, lastActivityLabel, normalizeSessionStatus } from "./format.js";
import type { SessionFinderBadge, SessionFinderItem, UsageSession, UsageSessionFinderTabId, UsageSessionFinderView } from "./types.js";

/** Builds the session finder view. */
export function buildSessionFinderView(
  sessions: UsageSession[],
  selectedSessionId?: string,
  options: { activeTab?: UsageSessionFinderTabId; caveats?: string[]; now?: Date | string } = {}
): UsageSessionFinderView {
  const now = options.now ? new Date(options.now) : new Date();
  const items = sessions.map((session) => sessionFinderItem(session, now));
  const activeTab = options.activeTab || "active";
  const tabDefinitions: Array<{ id: UsageSessionFinderTabId; label: string; predicate: (item: SessionFinderItem) => boolean }> = [
    { id: "active", label: "Active", predicate: isActiveItem },
    { id: "recent", label: "Recent", predicate: isRecentItem },
    { id: "costly", label: "Costly", predicate: isCostlyItem },
    { id: "slow", label: "Slow", predicate: isSlowItem },
    { id: "errors", label: "Errors", predicate: isErrorItem },
    { id: "starred", label: "Starred", predicate: isStarredItem }
  ];
  const tabs = tabDefinitions.map((tab) => ({ id: tab.id, label: tab.label, count: items.filter(tab.predicate).length }));
  const groups = tabDefinitions
    .filter((tab) => tab.id !== "starred")
    .map((tab) => ({ id: tab.id, label: tab.label, items: items.filter(tab.predicate).slice(0, tab.id === "recent" ? 12 : 6) }))
    .filter((group) => group.items.length > 0);
  return {
    tabs,
    activeTab,
    searchPlaceholder: "Search sessions...",
    sortLabel: "Last activity",
    selectedSessionId,
    groups: groups.length ? groups : [{ id: "empty", label: "Sessions", items }],
    items,
    caveats: options.caveats || []
  };
}

/** Returns whether an item belongs in the Active tab. */
function isActiveItem(item: SessionFinderItem): boolean {
  return item.status === "active";
}

/** Returns whether an item belongs in the Recent tab. */
function isRecentItem(): boolean {
  return true;
}

/** Returns whether an item belongs in the Costly tab. */
function isCostlyItem(item: SessionFinderItem): boolean {
  return item.badges.includes("costly");
}

/** Returns whether an item belongs in the Slow tab. */
function isSlowItem(item: SessionFinderItem): boolean {
  return item.badges.includes("slow");
}

/** Returns whether an item belongs in the Errors tab. */
function isErrorItem(item: SessionFinderItem): boolean {
  return item.status === "failed" || item.badges.includes("failed");
}

/** Returns whether an item belongs in the Starred tab. */
function isStarredItem(): boolean {
  return false;
}

/** Builds session finder item. */
export function sessionFinderItem(session: UsageSession, now = new Date()): SessionFinderItem {
  const status = normalizeSessionStatus(session.status);
  const caveatCount = (session.availability?.notes || []).length;
  const durationMs = session.metrics?.durationMs;
  const tokenTotal = session.metrics?.tokens?.total;
  const badges = sessionBadges(session);
  return {
    id: session.id,
    title: cleanTitle(session.title || session.firstPrompt || session.id),
    provider: session.provider || "unknown",
    status,
    lastActivityLabel: lastActivityLabel(session, now),
    durationLabel: formatDuration(durationMs),
    tokenLabel: formatTokens(tokenTotal),
    toolCallCount: session.counts?.toolCalls,
    fileCount: session.counts?.filesTouched,
    caveatCount,
    badges
  };
}

/** Builds session badges. */
function sessionBadges(session: UsageSession): SessionFinderBadge[] {
  const badges: SessionFinderBadge[] = [];
  const status = normalizeSessionStatus(session.status);
  const durationMs = session.metrics?.durationMs;
  const tokenTotal = session.metrics?.tokens?.total;
  const caveats = session.availability?.notes || [];
  const confidence = session.availability?.confidence || session.metrics?.durationConfidence || session.metrics?.tokens?.confidence;
  if (status === "active") badges.push("active");
  if (status === "failed") badges.push("failed");
  if (tokenTotal !== undefined && tokenTotal >= 10_000_000) badges.push("costly");
  if (durationMs !== undefined && durationMs >= 30 * 60 * 1000) badges.push("slow");
  if (caveats.length > 0 || confidence === "partial" || confidence === "estimated" || confidence === "unknown" || confidence === "unsupported") badges.push("partial-data");
  return badges;
}
