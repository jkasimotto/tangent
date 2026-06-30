import type { UsageEventV3 } from "../schema/index.js";

/** Returns all file paths referenced by a usage event, deduplicating across tool and file facets. */
export function pathsForEvent(event: UsageEventV3): string[] {
  return unique([
    ...(event.data.tool?.targetPaths || []),
    ...(event.data.file?.targetPaths || []),
    ...(event.data.file?.path ? [event.data.file.path] : []),
    ...pathsForData(event.data)
  ]);
}

/** Collects all path-like strings from an arbitrary data object by walking known path keys. */
function pathsForData(data: unknown): string[] {
  const rows: string[] = [];
  collectPaths(data, rows);
  return unique(rows.map((row) => row.trim()).filter(Boolean));
}

/** Recursively walks a value, pushing strings found under known path keys into rows. */
function collectPaths(value: unknown, rows: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, rows);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (["path", "paths", "file", "file_path", "file_paths", "target_path", "target_paths", "glob"].includes(key)) {
      if (typeof nested === "string") rows.push(nested);
      if (Array.isArray(nested)) rows.push(...nested.filter((item): item is string => typeof item === "string"));
    }
    if (key === "input" || key === "tool_input" || key === "arguments" || key === "command") collectPaths(nested, rows);
  }
}

/** Returns a new array with duplicate and nullish values removed. */
function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter((value): value is T & {} => value !== undefined && value !== null))];
}
