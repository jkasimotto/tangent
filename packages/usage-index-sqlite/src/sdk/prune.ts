import { stat } from "node:fs/promises";

import { ensureSchema, openDb, refreshDerivedTables, usageIndexTarget } from "./indexStore.js";

export type UsagePruneOptions = {
  repo: string;
  scope?: "repo" | "all";
  before: Date;
  dryRun?: boolean;
  vacuum?: boolean;
};

export type UsagePruneResult = {
  dbPath: string;
  scope: "repo" | "all";
  before: string;
  dryRun: boolean;
  deletedEvents: number;
  bytesBefore: number;
  bytesAfter: number;
  vacuumed: boolean;
};

/**
 * Trims an index to a retention window by deleting events older than `before` and rebuilding the
 * derived tables, so the all-projects global index, which otherwise accumulates every transcript
 * ever seen, stays bounded. Source-file rows are kept as tombstones with their original mtime/size,
 * so a later incremental rebuild skips the pruned files instead of re-importing them; the native
 * transcripts stay untouched on disk, and `usage reindex --force` re-imports full history from them.
 * A plain prune deletes rows (the freed pages are reused, so the file stops growing); `vacuum`
 * additionally rewrites the file to reclaim that space on disk (slower, needs exclusive access).
 */
export async function pruneUsageIndex(options: UsagePruneOptions): Promise<UsagePruneResult> {
  const target = await usageIndexTarget(options);
  const scope: "repo" | "all" = target.global ? "all" : "repo";
  const before = options.before.toISOString();
  const bytesBefore = await fileSize(target.dbPath);
  const db = await openDb(target);
  try {
    ensureSchema(db);
    // Wait briefly for a concurrent watcher rebuild rather than failing outright when the UI is live.
    db.exec("pragma busy_timeout = 5000");
    const older = db.prepare("select count(*) as n from events where coalesce(observed_at, recorded_at) < ?").get(before) as { n: number } | undefined;
    const deletedEvents = older?.n || 0;
    if (!options.dryRun && deletedEvents > 0) {
      const transaction = db.transaction(() => {
        db.prepare("delete from events where coalesce(observed_at, recorded_at) < ?").run(before);
        db.prepare("update source_files set event_count = (select count(*) from events where source_path = source_files.path)").run();
      });
      transaction();
      refreshDerivedTables(db);
    }
    if (!options.dryRun && options.vacuum) db.exec("vacuum");
    return {
      dbPath: target.dbPath,
      scope,
      before,
      dryRun: Boolean(options.dryRun),
      deletedEvents,
      bytesBefore,
      bytesAfter: options.dryRun ? bytesBefore : await fileSize(target.dbPath),
      vacuumed: Boolean(options.vacuum && !options.dryRun)
    };
  } finally {
    db.close();
  }
}

/** Returns a file's size in bytes, or 0 if it does not exist yet. */
async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}
