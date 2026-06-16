export const treesSqliteProjectionTables = [
  "entities",
  "work_sessions",
  "checkpoints",
  "captures",
  "agent_runs",
  "terminal_sessions",
  "observations",
  "attention_items",
  "tree_events",
  "projects",
  "worktrees"
] as const;

export type TreesSqliteProjectionTable = typeof treesSqliteProjectionTables[number];

export type TreesSqliteProjectionStore = {
  readonly kind: "sqlite-projection";
  readonly tables: readonly TreesSqliteProjectionTable[];
  rebuild(): Promise<void>;
};

/** Documents the sqliteProjectionUnavailable helper. */
export function sqliteProjectionUnavailable(): never {
  throw new Error("trees-store-sqlite is an optional projection package; no SQLite driver is wired yet.");
}
