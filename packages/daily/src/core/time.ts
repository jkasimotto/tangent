export function dateBucket(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function timeLabel(iso: string | undefined, timezone: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function timestampLabel(iso: string, timezone: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short"
  }).format(date);
}

export function todayBucket(timezone: string): string {
  return dateBucket(new Date(), timezone);
}

export function dateArgToBucket(value: string | undefined, timezone: string): string | undefined {
  if (!value) return undefined;
  if (value === "today") return offsetBucket(0, timezone);
  if (value === "yesterday") return offsetBucket(-1, timezone);
  if (value === "tomorrow") return offsetBucket(1, timezone);
  const offsetMatch = value.match(/^([+-]\d+)d$/);
  if (offsetMatch) return offsetBucket(Number(offsetMatch[1]), timezone);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  return dateBucket(parsed, timezone);
}

function offsetBucket(offsetDays: number, timezone: string): string {
  const today = todayBucket(timezone);
  const [year, month, day] = today.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid current date bucket: ${today}`);
  return dateBucket(new Date(Date.UTC(year, month - 1, day + offsetDays, 12, 0, 0)), timezone);
}
