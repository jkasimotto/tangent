import { mkdirSync } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { pathExists, repoInfo } from "@tangent/repo";

import { listJsonlFiles, readJsonl } from "../core/append-jsonl.js";
import { UsageDataset } from "../core/dataset.js";
import { repoArchiveDir, repoEventDir, repoIndexPath } from "../core/paths.js";
import type { UsageJsonlLineV1, UsageProvider, UsageWarning } from "../core/schema/usage-jsonl-v1.js";

type DatabaseHandle = InstanceType<typeof Database>;

export type UsageIndexOptions = {
  repo: string;
  providers?: UsageProvider[];
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
  providers?: UsageProvider[];
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

export async function ensureUsageIndex(options: UsageIndexOptions): Promise<UsageIndexResult> {
  const repo = await repoInfo(options.repo);
  const root = repo.root || repo.cwd;
  const providers = options.providers?.length ? options.providers : ["claude", "codex"] as UsageProvider[];
  const db = openDb(root);
  const warnings: UsageWarning[] = [];
  let indexed = 0;
  let skipped = 0;
  let removed = 0;
  let eventCount = 0;
  const sourceFiles: string[] = [];

  try {
    ensureSchema(db);
    const found = new Set<string>();
    for (const provider of providers) {
      const files = await listJsonlFiles(repoEventDir(root, provider));
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
          upsertSourceFile(db, file, provider, fileStat.mtimeMs, fileStat.size, events);
          indexed += 1;
          eventCount += events.length;
        } catch (error) {
          warnings.push({ code: "invalid-jsonl", message: (error as Error).message, path: file });
        }
      }

      const indexedRows = db.prepare("select path from source_files where provider = ? and source_kind = 'usage-jsonl' and archived_at is null").all(provider) as Array<{ path: string }>;
      for (const row of indexedRows) {
        if (found.has(row.path)) continue;
        removeSourceFile(db, row.path);
        removed += 1;
      }
    }
    refreshDerivedTables(db);
    return {
      repoRoot: root,
      dbPath: repoIndexPath(root),
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

export async function loadUsageDatasetFromIndex(query: UsageDatasetQuery): Promise<UsageDataset> {
  const index = await ensureUsageIndex(query);
  const db = openDb(index.repoRoot);
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

export async function resolveConversationRef(options: { repo: string; ref: string; providers?: UsageProvider[] }): Promise<ResolvedConversationRef> {
  const index = await ensureUsageIndex({ repo: options.repo, providers: options.providers });
  const db = openDb(index.repoRoot);
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

export async function archiveUsageTelemetry(options: UsageArchiveOptions): Promise<UsageArchiveResult> {
  const index = await ensureUsageIndex({ repo: options.repo, providers: options.providers });
  const db = openDb(index.repoRoot);
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

function openDb(repoRoot: string): DatabaseHandle {
  const dbPath = repoIndexPath(repoRoot);
  mkdirSyncForDb(dbPath);
  return new Database(dbPath);
}

function ensureSchema(db: DatabaseHandle): void {
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
  if (!tableHasColumn(db, "events", "source_path")) db.exec("alter table events add column source_path text");
}

function upsertSourceFile(db: DatabaseHandle, file: string, provider: UsageProvider, mtimeMs: number, size: number, events: UsageJsonlLineV1[]): void {
  const dataset = new UsageDataset(events);
  const insertSource = db.prepare(`
    insert or replace into source_files (path, provider, source_kind, mtime_ms, size, event_count, indexed_at, archived_at, archive_path)
    values (?, ?, 'usage-jsonl', ?, ?, ?, ?, null, null)
  `);
  const deleteEvents = db.prepare("delete from events where source_path = ?");
  const insertEvent = db.prepare(`
    insert or replace into events
    (event_id, kind, provider, conversation_id, session_id, turn_id, observed_at, recorded_at, source_path, json)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const transaction = db.transaction(() => {
    deleteEvents.run(file);
    insertSource.run(file, provider, mtimeMs, size, events.length, new Date().toISOString());
    for (const event of dataset.annotatedEvents) {
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
}

function removeSourceFile(db: DatabaseHandle, file: string): void {
  const transaction = db.transaction(() => {
    db.prepare("delete from events where source_path = ?").run(file);
    db.prepare("delete from source_files where path = ?").run(file);
  });
  transaction();
}

function refreshDerivedTables(db: DatabaseHandle): void {
  const events = (db.prepare("select json from events order by coalesce(observed_at, recorded_at), recorded_at").all() as EventRow[])
    .map((row) => JSON.parse(row.json) as UsageJsonlLineV1);
  const dataset = new UsageDataset(events);
  const insertConversation = db.prepare("insert or replace into conversations values (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertTurn = db.prepare("insert or replace into turns values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const transaction = db.transaction(() => {
    db.prepare("delete from conversations").run();
    db.prepare("delete from turns").run();
    for (const row of dataset.conversations.all().data) {
      insertConversation.run(row.id, row.provider, row.providerSessionId, iso(row.startedAt), iso(row.endedAt), row.firstPrompt, row.cwd, row.gitBranch);
    }
    for (const row of dataset.turns.list({ includeActive: true }).data) {
      insertTurn.run(
        row.sourceKey,
        row.provider,
        row.conversationId,
        row.providerSessionId,
        row.turnId,
        iso(row.startedAt),
        iso(row.endedAt),
        row.lastActivityAt.toISOString(),
        row.status,
        row.sourceFingerprint,
        JSON.stringify(row.stats)
      );
    }
  });
  transaction();
}

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

function sourceFileRows(db: DatabaseHandle, providers: UsageProvider[] | undefined): SourceFileRow[] {
  const clauses = ["source_kind = 'usage-jsonl'", "archived_at is null"];
  const params: unknown[] = [];
  if (providers?.length) {
    clauses.push(`provider in (${providers.map(() => "?").join(", ")})`);
    params.push(...providers);
  }
  return db.prepare(`select path, provider, source_kind, mtime_ms, size, event_count from source_files where ${clauses.join(" and ")}`).all(...params) as SourceFileRow[];
}

function latestEventForSource(db: DatabaseHandle, sourcePath: string): string | undefined {
  const row = db.prepare("select max(coalesce(observed_at, recorded_at)) as latest from events where source_path = ?").get(sourcePath) as { latest: string | null } | undefined;
  return row?.latest || undefined;
}

function archivePathFor(repoRoot: string, provider: UsageProvider, sourcePath: string): string {
  const base = repoEventDir(repoRoot, provider);
  const relative = path.relative(base, sourcePath);
  const safeRelative = relative.startsWith("..") ? path.basename(sourcePath) : relative;
  return path.join(repoArchiveDir(repoRoot), "events", provider, safeRelative);
}

function shortConversationId(row: Pick<ConversationRow, "provider" | "id" | "session_id">): string {
  const session = row.session_id || row.id.split(":").slice(1).join(":");
  return `${row.provider}:${session.slice(0, 8)}`;
}

function iso(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

function mkdirSyncForDb(dbPath: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
}

function tableHasColumn(db: DatabaseHandle, table: string, column: string): boolean {
  return (db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}
