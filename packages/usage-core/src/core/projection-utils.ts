export function groupBy<T, K>(values: T[], keyFn: (value: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFn(value);
    const rows = map.get(key) || [];
    rows.push(value);
    map.set(key, rows);
  }
  return map;
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter((value): value is T & {} => value !== undefined && value !== null))];
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
