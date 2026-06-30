import { mkdirSync } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathExists, repoInfo } from "@tangent/repo";

import { listJsonlFiles, readJsonl } from "@tangent/usage-core/core/append-jsonl";
import { UsageDataset } from "@tangent/usage-core/core/dataset";
import { eventsToProjections } from "@tangent/usage-core/core/projections";
import { buildSessionSparkline } from "@tangent/usage-core/core/sparkline";
import { globalEventRoot, globalIndexPath, repoArchiveDir, repoEventDir, repoIndexPath } from "@tangent/usage-core/core/paths";
import { usageProviders, type UsageJsonlLineV1, type UsageProvider, type UsageWarning } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { loadNativeSourceFiles } from "@tangent/usage-providers/providers/native/load";
import { usageProjectionSchemaSql, obsoleteProjectionTables } from "@tangent/usage-index-sqlite/sqlite/schema";

const require = createRequire(import.meta.url);

// Bumped when the derived-table shape changes so an older on-disk index re-derives once. The slim
// schema (sessions + messages only, with a precomputed sparkline) is version 3; opening an index
// stamped with an earlier version drops the obsolete tables and rebuilds the kept ones from `events`.
const DERIVE_VERSION = "usage.derive.v3";
type StatementHandle = {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
};
type DatabaseHandle = {
  exec(sql: string): void;
  prepare(sql: string): StatementHandle;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
};
export type UsageIndexSource = "native" | "usage-jsonl";

export type UsageIndexOptions = {
  repo: string;
  scope?: "repo" | "all";
  providers?: UsageProvider[];
  sources?: UsageIndexSource[];
  now?: Date;
  force?: boolean;
};

export type UsageIndexResult = {
  repoRoot: string;
  dbPath: string;
  indexed: number;
  skipped: number;
  removed: number;
  events: number;
  sourceFiles: string[];
  warnings: UsageWarning[];
};

export type UsageDatasetQuery = {
  repo: string;
  scope?: "repo" | "all";
  providers?: UsageProvider[];
  sources?: UsageIndexSource[];
  now?: Date;
  conversationId?: string;
  since?: Date;
  until?: Date;
  date?: string;
  force?: boolean;
};

export type ResolvedConversationRef = {
  conversationId: string;
  shortId: string;
};

export type UsageArchiveOptions = {
  repo: string;
  providers?: UsageProvider[];
  before: Date;
  dryRun?: boolean;
};

export type UsageArchiveResult = {
  repoRoot: string;
  before: string;
  dryRun: boolean;
  archived: Array<{ provider: UsageProvider; path: string; archivePath: string; latestEventAt?: string }>;
  skipped: Array<{ path: string; reason: string }>;
};

type SourceFileRow = {
  path: string;
  provider: UsageProvider;
  source_kind: string;
  mtime_ms: number;
  size: number;
  event_count: number;
};

type EventRow = {
  json: string;
};

type ConversationRow = {
  id: string;
  provider: UsageProvider;
  session_id: string | null;
  last_activity_at: string | null;
};

type UsageIndexTarget = {
  repoRoot: string;
  sourceRepoRoot?: string;
  dbPath: string;
  global: boolean;
};

/** Builds or incrementally updates the repo or global usage index from its native and usage-jsonl sources, returning what changed. */
export async function ensureUsageIndex(options: UsageIndexOptions): Promise<UsageIndexResult> {
  const target = await usageIndexTarget(options);
  const root = target.repoRoot;
  const providers = options.providers?.length ? options.providers : [...usageProviders];
  const sources = options.sources?.length ? options.sources : ["native"] as UsageIndexSource[];
  const db = await openDb(target);
  const warnings: UsageWarning[] = [];
  let indexed = 0;
  let skipped = 0;
  let removed = 0;
  let eventCount = 0;
  const sourceFiles: string[] = [];
  const seenNative = new Set<string>();
  const affected = new Set<string>();

  try {
    ensureSchema(db);
    const found = new Set<string>();

    if (sources.includes("native")) {
      const existingNative = options.force ? new Map<string, Pick<SourceFileRow, "mtime_ms" | "size">>() : sourceFileMetadata(db, providers, "native");
      const native = await loadNativeSourceFiles({
        repoRoot: target.sourceRepoRoot,
        providers,
        now: options.now,
        skipUnchanged: options.force ? undefined : (file) => {
          const existing = existingNative.get(file.path);
          return Boolean(existing && existing.mtime_ms === file.mtimeMs && existing.size === file.size);
        }
      });
      warnings.push(...native.warnings);
      for (const file of native.seenPaths) seenNative.add(file);
      for (const file of native.skipped) {
        found.add(file.path);
        sourceFiles.push(file.path);
        skipped += 1;
      }
      for (const file of native.files) {
        found.add(file.path);
        sourceFiles.push(file.path);
        const existing = db.prepare("select mtime_ms, size from source_files where path = ?").get(file.path) as { mtime_ms: number; size: number } | undefined;
        if (!options.force && existing && existing.mtime_ms === file.mtimeMs && existing.size === file.size) {
          skipped += 1;
          continue;
        }

        for (const id of upsertSourceFile(db, file.path, file.provider, "native", file.mtimeMs, file.size, file.events)) affected.add(id);
        indexed += 1;
        eventCount += file.events.length;
      }
    }

    if (sources.includes("usage-jsonl")) {
      for (const provider of providers) {
        const eventRoot = target.sourceRepoRoot ? repoEventDir(target.sourceRepoRoot, provider) : globalEventRoot(provider);
        const files = await listJsonlFiles(eventRoot);
        for (const file of files) {
          found.add(file);
          sourceFiles.push(file);
          const fileStat = await stat(file);
          const existing = db.prepare("select mtime_ms, size from source_files where path = ?").get(file) as { mtime_ms: number; size: number } | undefined;
          if (!options.force && existing && existing.mtime_ms === fileStat.mtimeMs && existing.size === fileStat.size) {
            skipped += 1;
            continue;
          }

          try {
            const events = await readJsonl<UsageJsonlLineV1>(file);
            for (const id of upsertSourceFile(db, file, provider, "usage-jsonl", fileStat.mtimeMs, fileStat.size, events)) affected.add(id);
            indexed += 1;
            eventCount += events.length;
          } catch (error) {
            warnings.push({ code: "invalid-jsonl", message: (error as Error).message, path: file });
          }
        }
      }
    }

    for (const provider of providers) {
      const indexedRows = db.prepare("select path, source_kind from source_files where provider = ? and archived_at is null").all(provider) as Array<{ path: string; source_kind: UsageIndexSource }>;
      for (const row of indexedRows) {
        if (found.has(row.path) && sources.includes(row.source_kind)) continue;
        if (row.source_kind === "native" && sources.includes("native") && seenNative.has(row.path)) {
          if (!sourceFiles.includes(row.path)) sourceFiles.push(row.path);
          continue;
        }
        for (const id of removeSourceFile(db, row.path)) affected.add(id);
        removed += 1;
      }
    }
    // A version bump, an explicit force, or an empty index rebuilds everything once; otherwise only
    // the conversations whose source files changed are re-derived, so a single new turn no longer
    // rewrites the whole index.
    if (options.force || !hasDerivedRows(db) || deriveVersion(db) !== DERIVE_VERSION) {
      refreshDerivedTables(db);
    } else if (affected.size) {
      refreshDerivedTablesForSessions(db, affected);
    }
    return {
      repoRoot: root,
      dbPath: target.dbPath,
      indexed,
      skipped,
      removed,
      events: eventCount,
      sourceFiles,
      warnings
    };
  } finally {
    db.close();
  }
}

/** Ensures the index is current, then loads a filtered event dataset from it for projection. */
export async function loadUsageDatasetFromIndex(query: UsageDatasetQuery): Promise<UsageDataset> {
  const index = await ensureUsageIndex(query);
  const db = await openDb(await usageIndexTarget(query));
  try {
    ensureSchema(db);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.conversationId) {
      clauses.push("conversation_id = ?");
      params.push(query.conversationId);
    }
    if (query.providers?.length) {
      clauses.push(`provider in (${query.providers.map(() => "?").join(", ")})`);
      params.push(...query.providers);
    }
    if (query.since) {
      clauses.push("coalesce(observed_at, recorded_at) >= ?");
      params.push(query.since.toISOString());
    }
    if (query.until) {
      clauses.push("coalesce(observed_at, recorded_at) <= ?");
      params.push(query.until.toISOString());
    }
    if (query.date) {
      clauses.push("substr(coalesce(observed_at, recorded_at), 1, 10) = ?");
      params.push(query.date);
    }
    const sql = `select json from events${clauses.length ? ` where ${clauses.join(" and ")}` : ""} order by coalesce(observed_at, recorded_at), recorded_at`;
    const events = (db.prepare(sql).all(...params) as EventRow[]).map((row) => JSON.parse(row.json) as UsageJsonlLineV1);
    return new UsageDataset(events, index.warnings, {
      sourceFiles: index.sourceFiles,
      indexVersion: "usage.index.v2",
      generatedAt: new Date().toISOString()
    });
  } finally {
    db.close();
  }
}

/** Resolves a user-supplied session ref (full id, short id, or prefix) to a single indexed conversation. */
export async function resolveConversationRef(options: { repo: string; ref: string; providers?: UsageProvider[]; sources?: UsageIndexSource[] }): Promise<ResolvedConversationRef> {
  const index = await ensureUsageIndex({ repo: options.repo, providers: options.providers, sources: options.sources });
  const db = await openDb(repoIndexTarget(index.repoRoot));
  try {
    ensureSchema(db);
    const rows = conversationRows(db, options.providers);
    if (options.ref === "latest") {
      const latest = rows[0];
      if (!latest) throw new Error("No captured sessions.");
      return { conversationId: latest.id, shortId: shortConversationId(latest) };
    }

    const matches = rows.filter((row) => {
      const session = row.session_id || row.id.split(":").slice(1).join(":");
      return options.ref === row.id ||
        options.ref === shortConversationId(row) ||
        options.ref === `${row.provider}:${session}` ||
        session.startsWith(options.ref) ||
        options.ref === `${row.provider}:${session.slice(0, options.ref.split(":").at(1)?.length || 0)}`;
    });
    if (matches.length === 1) return { conversationId: matches[0]!.id, shortId: shortConversationId(matches[0]!) };
    if (!matches.length) throw new Error(`No session found for ${options.ref}.`);
    throw new Error(`Session id ${options.ref} is ambiguous. Use one of: ${matches.slice(0, 5).map(shortConversationId).join(", ")}`);
  } finally {
    db.close();
  }
}

/** Moves indexed usage-jsonl source files older than the cutoff to an archive dir, marking them archived in the index. */
export async function archiveUsageTelemetry(options: UsageArchiveOptions): Promise<UsageArchiveResult> {
  const index = await ensureUsageIndex({ repo: options.repo, providers: options.providers, sources: ["usage-jsonl"] });
  const db = await openDb(repoIndexTarget(index.repoRoot));
  const result: UsageArchiveResult = {
    repoRoot: index.repoRoot,
    before: options.before.toISOString(),
    dryRun: Boolean(options.dryRun),
    archived: [],
    skipped: []
  };

  try {
    ensureSchema(db);
    const rows = sourceFileRows(db, options.providers);
    for (const row of rows) {
      const latestEventAt = latestEventForSource(db, row.path);
      if (latestEventAt && latestEventAt >= options.before.toISOString()) {
        result.skipped.push({ path: row.path, reason: "newer-than-before" });
        continue;
      }
      if (!(await pathExists(row.path))) {
        result.skipped.push({ path: row.path, reason: "missing" });
        continue;
      }
      const fileStat = await stat(row.path);
      if (fileStat.mtimeMs !== row.mtime_ms || fileStat.size !== row.size) {
        result.skipped.push({ path: row.path, reason: "changed-since-index" });
        continue;
      }
      const archivePath = archivePathFor(index.repoRoot, row.provider, row.path);
      result.archived.push({ provider: row.provider, path: row.path, archivePath, latestEventAt });
      if (options.dryRun) continue;
      await mkdir(path.dirname(archivePath), { recursive: true });
      await rename(row.path, archivePath);
      db.prepare("update source_files set archived_at = ?, archive_path = ? where path = ?").run(new Date().toISOString(), archivePath, row.path);
    }
    return result;
  } finally {
    db.close();
  }
}

/** Opens (creating its parent directory) the better-sqlite3 database for an index target. */
export async function openDb(target: UsageIndexTarget): Promise<DatabaseHandle> {
  const dbPath = target.dbPath;
  mkdirSyncForDb(dbPath);
  const Database = optionalSqlite();
  const db = new Database(dbPath) as DatabaseHandle;
  // WAL lets the UI's read queries run while the watcher writes the next incremental update, instead
  // of blocking on the writer's lock; the busy timeout absorbs the brief checkpoint overlaps.
  db.exec("pragma journal_mode = WAL; pragma busy_timeout = 5000; pragma synchronous = normal");
  return db;
}

/** Resolves the index target (the global all-sessions db, or the per-repo db) for the given scope. */
export async function usageIndexTarget(options: { repo: string; scope?: "repo" | "all" }): Promise<UsageIndexTarget> {
  if (options.scope === "all") {
    return {
      repoRoot: "all-local-sessions",
      dbPath: globalIndexPath(),
      global: true
    };
  }
  const repo = await repoInfo(options.repo);
  return repoIndexTarget(repo.root || repo.cwd);
}

/** Builds the per-repo index target for a resolved repo root. */
function repoIndexTarget(repoRoot: string): UsageIndexTarget {
  return {
    repoRoot,
    sourceRepoRoot: repoRoot,
    dbPath: repoIndexPath(repoRoot),
    global: false
  };
}

/** Loads the optional better-sqlite3 dependency lazily, throwing a clear error when it is not installed. */
function optionalSqlite(): new (path: string, options?: unknown) => unknown {
  try {
    return require("better-sqlite3") as new (path: string, options?: unknown) => unknown;
  } catch (error) {
    throw new Error(`SQLite index support requires optional dependency better-sqlite3: ${(error as Error).message}`);
  }
}

/** Returns whether the derived projection tables already hold any rows. */
function hasDerivedRows(db: DatabaseHandle): boolean {
  const row = db.prepare("select count(*) as count from sessions").get() as { count: number } | undefined;
  return Number(row?.count || 0) > 0;
}

/** Creates the index tables if missing and applies additive column migrations. */
export function ensureSchema(db: DatabaseHandle): void {
  db.exec(`
    create table if not exists source_files (
      path text primary key,
      provider text not null,
      source_kind text not null,
      mtime_ms real not null,
      size integer not null,
      event_count integer not null,
      indexed_at text not null,
      archived_at text,
      archive_path text
    );
    create table if not exists events (
      event_id text primary key,
      kind text not null,
      provider text not null,
      conversation_id text not null,
      session_id text,
      turn_id text,
      observed_at text,
      recorded_at text not null,
      source_path text,
      json text not null
    );
    create table if not exists conversations (
      id text primary key,
      provider text not null,
      session_id text,
      started_at text,
      ended_at text,
      first_prompt text,
      cwd text,
      git_branch text
    );
    create table if not exists turns (
      source_key text primary key,
      provider text not null,
      conversation_id text not null,
      session_id text,
      turn_id text not null,
      started_at text,
      ended_at text,
      last_activity_at text not null,
      status text not null,
      source_fingerprint text not null,
      stats_json text not null
    );
    create index if not exists events_source_path_idx on events (source_path);
    create index if not exists events_conversation_idx on events (conversation_id, recorded_at);
    create index if not exists events_provider_recorded_idx on events (provider, recorded_at);
    create index if not exists turns_conversation_idx on turns (conversation_id, last_activity_at);
  `);
  // The slim sessions table stores the projected session as a `session_json` payload; a pre-slim index
  // has a columnar sessions table without it, so drop it here and let the slim create plus the
  // version-triggered rebuild repopulate it from `events`.
  if (tableExists(db, "sessions") && !tableHasColumn(db, "sessions", "session_json")) db.exec("drop table sessions");
  db.exec(usageProjectionSchemaSql);
  db.exec("create table if not exists meta (key text primary key, value text)");
  if (!tableHasColumn(db, "events", "source_path")) db.exec("alter table events add column source_path text");
  // Reclaim the multi-GB the pre-slim index spent on derived tables the UI never read.
  for (const table of obsoleteProjectionTables) db.exec(`drop table if exists ${table}`);
}

/** Reports whether a table exists in the index. */
function tableExists(db: DatabaseHandle, name: string): boolean {
  return Boolean(db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(name));
}

/** Reads the derive-schema version stamped on the index, or undefined for a pre-versioned index. */
function deriveVersion(db: DatabaseHandle): string | undefined {
  const row = db.prepare("select value from meta where key = 'derive_version'").get() as { value?: string } | undefined;
  return row?.value;
}

/** Stamps the current derive-schema version after a (re)build so later opens skip the rebuild. */
function setDeriveVersion(db: DatabaseHandle): void {
  db.prepare("insert or replace into meta (key, value) values ('derive_version', ?)").run(DERIVE_VERSION);
}

/** Replaces a source file's row and all its events in the index within a single transaction. */
function upsertSourceFile(db: DatabaseHandle, file: string, provider: UsageProvider, sourceKind: UsageIndexSource, mtimeMs: number, size: number, events: UsageJsonlLineV1[]): string[] {
  const dataset = new UsageDataset(events);
  const insertSource = db.prepare(`
    insert or replace into source_files (path, provider, source_kind, mtime_ms, size, event_count, indexed_at, archived_at, archive_path)
    values (?, ?, ?, ?, ?, ?, ?, null, null)
  `);
  const deleteEvents = db.prepare("delete from events where source_path = ?");
  const insertEvent = db.prepare(`
    insert or replace into events
    (event_id, kind, provider, conversation_id, session_id, turn_id, observed_at, recorded_at, source_path, json)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // A rewritten file can drop a conversation it used to hold, so a conversation present before the
  // upsert is affected even if it has no events after it; capture both sides for the incremental pass.
  const affected = new Set<string>(sessionIdsForSource(db, file));
  const transaction = db.transaction(() => {
    deleteEvents.run(file);
    insertSource.run(file, provider, sourceKind, mtimeMs, size, events.length, new Date().toISOString());
    for (const event of dataset.annotatedEvents) {
      affected.add(event.conversation.id);
      insertEvent.run(
        event.event_id,
        event.kind,
        event.provider,
        event.conversation.id,
        event.conversation.provider_session_id,
        event.effectiveTurnId,
        event.observed_at,
        event.recorded_at,
        file,
        JSON.stringify(event)
      );
    }
  });
  transaction();
  return [...affected];
}

/** Deletes a source file's row and all its events from the index, returning the conversations it touched. */
function removeSourceFile(db: DatabaseHandle, file: string): string[] {
  const affected = sessionIdsForSource(db, file);
  const transaction = db.transaction(() => {
    db.prepare("delete from events where source_path = ?").run(file);
    db.prepare("delete from source_files where path = ?").run(file);
  });
  transaction();
  return affected;
}

/** Returns the distinct conversation ids whose events currently come from a source file. */
function sessionIdsForSource(db: DatabaseHandle, file: string): string[] {
  return (db.prepare("select distinct conversation_id from events where source_path = ?").all(file) as Array<{ conversation_id: string }>).map((row) => row.conversation_id);
}

type DeriveStatements = {
  insertConversation: StatementHandle;
  insertTurn: StatementHandle;
  insertSession: StatementHandle;
  insertMessage: StatementHandle;
  deleteConversation: StatementHandle;
  deleteTurns: StatementHandle;
  deleteSession: StatementHandle;
  deleteMessages: StatementHandle;
  loadEvents: StatementHandle;
};

/** Prepares the statements used to (re)derive one session's rows in the slim schema. */
function deriveStatements(db: DatabaseHandle): DeriveStatements {
  return {
    insertConversation: db.prepare("insert or replace into conversations values (?, ?, ?, ?, ?, ?, ?, ?)"),
    insertTurn: db.prepare("insert or replace into turns values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    insertSession: db.prepare(`
      insert or replace into sessions
      (id, provider, started_at, last_activity_at, status, session_json, sparkline_json)
      values (?, ?, ?, ?, ?, ?, ?)
    `),
    insertMessage: db.prepare(`
      insert or replace into messages
      (id, session_id, turn_id, step_id, role, ordinal, created_at, text_preview, text_full, text_chars, text_bytes, content_mode, model, has_tool_use, has_thinking, thinking_text, thinking_preview, token_usage_json, confidence, evidence_json, provider_fields_json)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    deleteConversation: db.prepare("delete from conversations where id = ?"),
    deleteTurns: db.prepare("delete from turns where conversation_id = ?"),
    deleteSession: db.prepare("delete from sessions where id = ?"),
    deleteMessages: db.prepare("delete from messages where session_id = ?"),
    loadEvents: db.prepare("select json from events where conversation_id = ? order by coalesce(observed_at, recorded_at), recorded_at")
  };
}

/**
 * Re-derives a single conversation's slim rows (conversation, turns, session with precomputed
 * sparkline, messages) from its events, replacing any prior rows. A conversation whose events have
 * all been removed leaves no rows behind. The projection is scoped to one conversation, so this is
 * the cheap unit the incremental watcher path replays instead of rebuilding the whole index.
 */
function deriveSession(db: DatabaseHandle, conversationId: string, stmts: DeriveStatements): void {
  const events = (stmts.loadEvents.all(conversationId) as EventRow[]).map((row) => JSON.parse(row.json) as UsageJsonlLineV1);
  stmts.deleteMessages.run(conversationId);
  stmts.deleteTurns.run(conversationId);
  stmts.deleteConversation.run(conversationId);
  stmts.deleteSession.run(conversationId);
  if (!events.length) return;
  const dataset = new UsageDataset(events);
  const projections = eventsToProjections(events);
  for (const row of dataset.conversations.all().data) {
    stmts.insertConversation.run(row.id, row.provider, row.providerSessionId, iso(row.startedAt), iso(row.endedAt), row.firstPrompt, row.cwd, row.gitBranch);
  }
  for (const row of dataset.turns.list().data) {
    stmts.insertTurn.run(row.sourceKey, row.provider, row.conversationId, row.providerSessionId, row.turnId, iso(row.startedAt), iso(row.endedAt), row.lastActivityAt.toISOString(), row.status, row.sourceFingerprint, JSON.stringify(row.stats));
  }
  for (const row of projections.sessions) {
    const sparkline = buildSessionSparkline(projections.steps.filter((step) => step.sessionId === row.id));
    stmts.insertSession.run(row.id, row.provider, row.startedAt, row.lastActivityAt, row.status, JSON.stringify(row), jsonOrNull(sparkline));
  }
  for (const row of projections.messages) {
    stmts.insertMessage.run(row.id, row.sessionId, row.turnId, row.stepId, row.role, row.ordinal, row.createdAt, row.textPreview, row.text ?? null, row.textChars, row.textBytes, row.contentMode, row.model, row.hasToolUse ? 1 : 0, row.hasThinking ? 1 : 0, row.thinking ?? null, row.thinkingPreview ?? null, jsonOrNull(row.tokenUsage), row.confidence, JSON.stringify(row.evidence), jsonOrNull(row.providerFields));
  }
}

/** Fully rebuilds the slim derived tables from `events`, one conversation at a time, and stamps the derive version. */
export function refreshDerivedTables(db: DatabaseHandle): void {
  const stmts = deriveStatements(db);
  const ids = (db.prepare("select distinct conversation_id from events").all() as Array<{ conversation_id: string }>).map((row) => row.conversation_id);
  const transaction = db.transaction(() => {
    db.prepare("delete from conversations").run();
    db.prepare("delete from turns").run();
    db.prepare("delete from sessions").run();
    db.prepare("delete from messages").run();
    for (const id of ids) deriveSession(db, id, stmts);
    setDeriveVersion(db);
  });
  transaction();
}

/** Re-derives only the named conversations' slim rows, the incremental unit replayed when a few transcripts change. */
export function refreshDerivedTablesForSessions(db: DatabaseHandle, conversationIds: Iterable<string>): void {
  const stmts = deriveStatements(db);
  const transaction = db.transaction(() => {
    for (const id of conversationIds) deriveSession(db, id, stmts);
  });
  transaction();
}

/** Returns indexed conversation rows, newest first, optionally filtered by provider. */
function conversationRows(db: DatabaseHandle, providers: UsageProvider[] | undefined): ConversationRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (providers?.length) {
    clauses.push(`c.provider in (${providers.map(() => "?").join(", ")})`);
    params.push(...providers);
  }
  const sql = `
    select c.id, c.provider, c.session_id, max(t.last_activity_at) as last_activity_at
    from conversations c
    left join turns t on t.conversation_id = c.id
    ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
    group by c.id
    order by coalesce(max(t.last_activity_at), c.ended_at, c.started_at, '') desc
  `;
  return db.prepare(sql).all(...params) as ConversationRow[];
}

/** Returns non-archived source file rows, optionally filtered by provider. */
function sourceFileRows(db: DatabaseHandle, providers: UsageProvider[] | undefined): SourceFileRow[] {
  const clauses = ["source_kind = 'usage-jsonl'", "archived_at is null"];
  const params: unknown[] = [];
  if (providers?.length) {
    clauses.push(`provider in (${providers.map(() => "?").join(", ")})`);
    params.push(...providers);
  }
  return db.prepare(`select path, provider, source_kind, mtime_ms, size, event_count from source_files where ${clauses.join(" and ")}`).all(...params) as SourceFileRow[];
}

/** Maps each indexed source file path to its mtime and size, for skip-unchanged change detection. */
function sourceFileMetadata(db: DatabaseHandle, providers: UsageProvider[], sourceKind: UsageIndexSource): Map<string, Pick<SourceFileRow, "mtime_ms" | "size">> {
  const clauses = ["source_kind = ?", "archived_at is null"];
  const params: unknown[] = [sourceKind];
  if (providers.length) {
    clauses.push(`provider in (${providers.map(() => "?").join(", ")})`);
    params.push(...providers);
  }
  const rows = db.prepare(`select path, mtime_ms, size from source_files where ${clauses.join(" and ")}`).all(...params) as Array<Pick<SourceFileRow, "path" | "mtime_ms" | "size">>;
  return new Map(rows.map((row) => [row.path, { mtime_ms: row.mtime_ms, size: row.size }]));
}

/** Returns the latest event timestamp recorded for a source file, if any. */
function latestEventForSource(db: DatabaseHandle, sourcePath: string): string | undefined {
  const row = db.prepare("select max(coalesce(observed_at, recorded_at)) as latest from events where source_path = ?").get(sourcePath) as { latest: string | null } | undefined;
  return row?.latest || undefined;
}

/** Builds the archive destination path for a source file being retired. */
function archivePathFor(repoRoot: string, provider: UsageProvider, sourcePath: string): string {
  const base = repoEventDir(repoRoot, provider);
  const relative = path.relative(base, sourcePath);
  const safeRelative = relative.startsWith("..") ? path.basename(sourcePath) : relative;
  return path.join(repoArchiveDir(repoRoot), "events", provider, safeRelative);
}

/** Builds the short, human-facing id (provider plus first 8 chars of the session) for a conversation row. */
function shortConversationId(row: Pick<ConversationRow, "provider" | "id" | "session_id">): string {
  const session = row.session_id || row.id.split(":").slice(1).join(":");
  return `${row.provider}:${session.slice(0, 8)}`;
}

/** Formats a date as an ISO string, or undefined when absent. */
function iso(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

/** Serializes a value to JSON, or null when it is undefined. */
function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/** Creates the parent directory for a database file synchronously. */
function mkdirSyncForDb(dbPath: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
}

/** Returns whether a table already has the named column. */
function tableHasColumn(db: DatabaseHandle, table: string, column: string): boolean {
  return (db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}
