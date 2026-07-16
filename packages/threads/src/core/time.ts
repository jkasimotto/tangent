const dayMs = 24 * 60 * 60 * 1000;

/** Returns the given date as YYYY-MM-DD in UTC, for comparison against deadline and note-filename dates. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Returns whole days between an ISO date (YYYY-MM-DD) or timestamp and now, floored at 0. Undefined input or an unparseable date returns undefined. */
export function daysSince(reference: string | undefined, now: Date): number | undefined {
  if (!reference) return undefined;
  const parsed = new Date(reference.length === 10 ? `${reference}T00:00:00Z` : reference);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / dayMs));
}

/** Formats an age in days as a compact label ("today", "3d"), or "--" when unknown. */
export function formatAge(days: number | undefined): string {
  if (days === undefined) return "--";
  return days <= 0 ? "today" : `${days}d`;
}

/** Formats a millisecond duration as a compact minute label ("5m"), rounding to the nearest minute. */
export function formatMinutes(ms: number): string {
  return `${Math.max(0, Math.round(ms / 60000))}m`;
}
