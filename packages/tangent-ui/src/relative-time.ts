/**
 * Shell-local time formatters for the "Updated <relative time>" freshness label. Kept in the shared
 * shell (not reused from a product UI package) so `@tangent/tangent-ui` stays free of product imports;
 * isolated in its own module so it is unit-testable apart from the Svelte component.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relative freshness label, e.g. `Updated just now` / `Updated 4m ago` / `Updated 3h ago` / `Updated 2d ago`. */
export function formatUpdatedLabel(builtAt: string, now: Date = new Date()): string {
  const built = new Date(builtAt).getTime();
  const elapsed = now.getTime() - built;
  if (!Number.isFinite(built) || elapsed < MINUTE) return "Updated just now";
  if (elapsed < HOUR) return `Updated ${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `Updated ${Math.floor(elapsed / HOUR)}h ago`;
  return `Updated ${Math.floor(elapsed / DAY)}d ago`;
}

/** Absolute build stamp for the `title`/`aria` tooltip, e.g. `Built 2026-06-25 14:32`. */
export function formatBuiltAtAbsolute(builtAt: string): string {
  const date = new Date(builtAt);
  if (Number.isNaN(date.getTime())) return "";
  /** Zero-pad a number to two digits for the date/time stamp. */
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `Built ${stamp}`;
}
