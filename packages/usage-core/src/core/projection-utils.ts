/** Groups an array of values into a Map keyed by the result of keyFn applied to each element. */
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

/** Returns a new array with duplicate and nullish values removed. */
export function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter((value): value is T & {} => value !== undefined && value !== null))];
}

/** Returns true if the value is not undefined. */
export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** Returns the value as a plain object record, or undefined if it is an array or non-object. */
export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Returns a named key from an object-like value, or undefined if value is not an object. */
export function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** Returns the value as a non-empty string, or undefined. */
export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
