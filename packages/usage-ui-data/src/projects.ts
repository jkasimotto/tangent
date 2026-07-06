import { NO_PROJECT_LABEL } from "./format.js";
import type { UsageSessionListItem } from "./index.js";

/** One project row in the browse view's left rail. */
export type UsageProjectRailItem = {
  /** Stable slug for keys and selection; `label` is the display name. */
  id: string;
  /** Display name shown in the rail (the session's project label). */
  label: string;
  /** Most-recent activity across the project's sessions; drives sort order and the rail's relative-time label. */
  lastActivityAt?: string;
  /** Number of conversations in the project; the rail badge. */
  total: number;
};

/** Returns the timestamp used to sort sessions and projects newest-first. */
function sessionActivityAt(session: Pick<UsageSessionListItem, "lastActivityAt" | "endedAt" | "startedAt">): string | undefined {
  return session.lastActivityAt || session.endedAt || session.startedAt;
}

/** Slugifies a project label for stable rail keys and selection. */
export function projectSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

/**
 * Groups the flat session list into the project rail the browse view leads with, so opening Usage
 * foregrounds the project of intention rather than a flat wall of conversations. Projects sort by
 * most-recent activity, except the "(no project)" bucket (sessions with no derivable project),
 * which always sorts last regardless of recency: it is a catch-all, not a project a user picked,
 * and mixing it in by recency buries real projects behind stale telemetry (e.g. eval sandbox
 * sessions with no recorded cwd). Pure, so usage-ui-data tests cover it directly.
 */
export function groupSessionsByProject(sessions: UsageSessionListItem[]): UsageProjectRailItem[] {
  const groups = new Map<string, UsageProjectRailItem>();
  for (const session of sessions) {
    const label = session.project || NO_PROJECT_LABEL;
    const id = projectSlug(label);
    const group = groups.get(id) || { id, label, lastActivityAt: undefined, total: 0 };
    group.total += 1;
    const at = sessionActivityAt(session);
    if (at && (!group.lastActivityAt || at > group.lastActivityAt)) group.lastActivityAt = at;
    groups.set(id, group);
  }
  return [...groups.values()].sort((left, right) => {
    const leftUnknown = left.label === NO_PROJECT_LABEL;
    const rightUnknown = right.label === NO_PROJECT_LABEL;
    if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
    return (right.lastActivityAt || "").localeCompare(left.lastActivityAt || "");
  });
}
