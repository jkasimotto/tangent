/** Returns the local IANA timezone name, falling back to UTC. */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Returns a compact ISO 8601 timestamp without hyphens, colons, or milliseconds. */
export function isoCompact(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
