import type { RollupPeriod } from "../types/period.js";

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
  if (/^\d{8}$/.test(value)) return compactDateToBucket(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  return dateBucket(parsed, timezone);
}

export function rollupPeriodArg(value: string | undefined, timezone: string): RollupPeriod {
  const selector = value || "today";
  const compactRange = selector.match(/^(\d{8})-(\d{8})$/);
  if (compactRange) {
    const startDate = compactDateToBucket(compactRange[1]!);
    const endDate = compactDateToBucket(compactRange[2]!);
    if (startDate > endDate) throw new Error(`Invalid rollup range: ${selector}`);
    return {
      kind: "range",
      startDate,
      endDate,
      key: `${startDate}--${endDate}`,
      label: `${startDate} to ${endDate}`
    };
  }

  const date = dateArgToBucket(selector, timezone);
  if (!date) throw new Error(`Invalid date: ${selector}`);
  return {
    kind: "day",
    date,
    startDate: date,
    endDate: date,
    key: date,
    label: date
  };
}

export function resolveRollupPeriod(params: {
  selector?: string;
  date?: string;
  from?: string | Date;
  to?: string | Date;
  timezone: string;
}): RollupPeriod {
  if (params.selector || params.date) {
    return rollupPeriodArg(params.selector || params.date, params.timezone);
  }

  if (!params.from && !params.to) {
    return rollupPeriodArg(undefined, params.timezone);
  }

  if (!params.from || !params.to) {
    throw new Error("Range rollups require both --from and --to.");
  }

  const startDate = resolveBoundaryDate(params.from, params.timezone);
  const endDate = resolveBoundaryDate(params.to, params.timezone);
  if (startDate > endDate) throw new Error(`Invalid rollup range: ${startDate} to ${endDate}`);

  return {
    kind: "range",
    startDate,
    endDate,
    key: `${startDate}--${endDate}`,
    label: `${startDate} to ${endDate}`
  };
}

function resolveBoundaryDate(value: string | Date, timezone: string): string {
  if (typeof value === "string") {
    const bucket = dateArgToBucket(value, timezone);
    if (!bucket) throw new Error(`Invalid rollup range boundary: ${value}`);
    return bucket;
  }
  return dateBucket(value, timezone);
}

export function isRollupSelector(value: string | undefined): boolean {
  return Boolean(value && (
    value === "today" ||
    value === "yesterday" ||
    value === "tomorrow" ||
    /^\d{4}-\d{2}-\d{2}$/.test(value) ||
    /^\d{8}$/.test(value) ||
    /^\d{8}-\d{8}$/.test(value) ||
    /^[+-]\d+d$/.test(value)
  ));
}

function compactDateToBucket(value: string): string {
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const bucket = `${year}-${month}-${day}`;
  const parsed = new Date(`${bucket}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) {
    throw new Error(`Invalid date: ${value}`);
  }
  return bucket;
}

function offsetBucket(offsetDays: number, timezone: string): string {
  const today = todayBucket(timezone);
  const [year, month, day] = today.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid current date bucket: ${today}`);
  return dateBucket(new Date(Date.UTC(year, month - 1, day + offsetDays, 12, 0, 0)), timezone);
}
