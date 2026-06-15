export type UsageSqliteIndex = {
  kind: "sqlite";
  path: string;
};

/** Supports the sqlite index helper. */
export function sqliteIndex(path: string): UsageSqliteIndex {
  return { kind: "sqlite", path };
}
