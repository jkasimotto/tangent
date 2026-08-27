// Filters for a Goal listing. Pure module: no HTTP, no vault, no clock of its
// own. A brain that asks an Area for recent work needs to narrow the answer
// before it reads it, so the same three filters exist on the CLI and on the
// HTTP route (design-record-tangent-around-the-area-brain, "tangent goal list
// gains subtree, status, recency, and query filters").

import { normalizeGoalRecord, normalizeGoalStatus } from "./goal-lifecycle.mjs";

const WINDOW_UNITS = new Map([
  ["m", 60_000],
  ["h", 3_600_000],
  ["d", 86_400_000],
  ["w", 604_800_000],
]);

/**
 * Reads a recency bound as a millisecond timestamp.
 *
 * It accepts a relative window (`30d`, `12h`, `2w`, `90m`) and an absolute
 * date (`2026-08-01`, or any ISO timestamp). It returns null for an empty
 * value, and throws for text that is neither, because a filter that silently
 * matched everything would report the opposite of what it was asked.
 */
export function recencyBound(value, now = Date.now()) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const window = /^(\d+)\s*([mhdw])$/i.exec(text);
  if (window) return now - Number(window[1]) * WINDOW_UNITS.get(window[2].toLowerCase());
  const absolute = Date.parse(text);
  if (Number.isFinite(absolute)) return absolute;
  throw new Error(`"${text}" is not a recency window (30d, 12h, 2w, 90m) or a date.`);
}

/** The words of a free-text Goal query, lowercased and deduplicated. */
export function queryTerms(value) {
  return [...new Set(String(value ?? "").toLowerCase().split(/\s+/).filter(Boolean))];
}

/**
 * Keeps the Goals that match every supplied filter.
 *
 * A status list and a recency bound both narrow. The query is a list of
 * alternatives: `--query "241 250"` finds the work about either number, which
 * is how a brain asks about a subject it only half remembers.
 */
export function filterGoalSummaries(goals, { status = [], changedSince = "", query = "" } = {}, now = Date.now()) {
  const wanted = new Set(status.map(canonicalStatus).filter(Boolean));
  const since = recencyBound(changedSince, now);
  const terms = queryTerms(query);
  /** True when one Goal's searchable text holds any query term. */
  const matchesQuery = (goal) => {
    if (!terms.length) return true;
    const text = [goal.slug, goal.title, goal.doneWhen, goal.area].filter(Boolean).join(" ").toLowerCase();
    return terms.some((term) => text.includes(term));
  };
  return goals.filter((goal) => {
    if (wanted.size && !wanted.has(canonicalStatus(goal.status))) return false;
    if (since !== null && !(Number(goal.changedAt ?? 0) >= since)) return false;
    return matchesQuery(goal);
  }).map(normalizeGoalRecord);
}

/** The filters a caller supplied, as one record the routes and the CLI share. */
export function goalQueryFilters({ status = [], changedSince = "", query = "" } = {}) {
  return {
    status: status.map(canonicalStatus).filter(Boolean),
    changedSince: String(changedSince ?? "").trim(),
    query: String(query ?? "").trim(),
  };
}

/** True when any filter narrows the listing. */
export function hasGoalQueryFilters(filters) {
  return Boolean(filters.status.length || filters.changedSince || filters.query);
}

/** Canonicalizes a case-insensitive Goal status supplied to a read filter. */
function canonicalStatus(value) {
  const status = String(value ?? "").trim().toLowerCase();
  return status ? normalizeGoalStatus(status) : "";
}
