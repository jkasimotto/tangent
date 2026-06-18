import { mkdirSync } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathExists, repoInfo } from "@tangent/repo";

import { listJsonlFiles, readJsonl } from "@tangent/usage-core/core/append-jsonl";
import { UsageDataset } from "@tangent/usage-core/core/dataset";
import { eventsToProjections } from "@tangent/usage-core/core/projections";
import { globalEventRoot, globalIndexPath, repoArchiveDir, repoEventDir, repoIndexPath } from "@tangent/usage-core/core/paths";
import type { UsageJsonlLineV1, UsageProvider, UsageWarning } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { loadNativeSourceFiles } from "@tangent/usage-providers/providers/native/load";
import { usageProjectionSchemaSql } from "@tangent/usage-index-sqlite/sqlite/schema";

const require = createRequire(import.meta.url);
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

export async function ensureUsageIndex(options: UsageIndexOptions): Promise<UsageIndexResult> {
  const target = await usageIndexTarget(options);
  const root = target.repoRoot;
  const providers = options.providers?.length ? options.providers : ["claude", "codex"] as UsageProvider[];
  const sources = options.sources?.length ? options.sources : ["native"] as UsageIndexSource[];
  const db = await openDb(target);
  const warnings: UsageWarning[] = [];
  let indexed = 0;
  let skipped = 0;
  let removed = 0;
  let eventCount = 0;
  const sourceFiles: string[] = [];
  const seenNative = new Set<string>();

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

        upsertSourceFile(db, file.path, file.provider, "native", file.mtimeMs, file.size, file.events);
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
            upsertSourceFile(db, file, provider, "usage-jsonl", fileStat.mtimeMs, fileStat.size, events);
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
        removeSourceFile(db, row.path);
        removed += 1;
      }
    }
    if (options.force || indexed > 0 || removed > 0 || !hasDerivedRows(db)) {
      refreshDerivedTables(db);
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

async function openDb(target: UsageIndexTarget): Promise<DatabaseHandle> {
  const dbPath = target.dbPath;
  mkdirSyncForDb(dbPath);
  const Database = optionalSqlite();
  return new Database(dbPath) as DatabaseHandle;
}

async function usageIndexTarget(options: { repo: string; scope?: "repo" | "all" }): Promise<UsageIndexTarget> {
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

function repoIndexTarget(repoRoot: string): UsageIndexTarget {
  return {
    repoRoot,
    sourceRepoRoot: repoRoot,
    dbPath: repoIndexPath(repoRoot),
    global: false
  };
}

function optionalSqlite(): new (path: string, options?: unknown) => unknown {
  try {
    return require("better-sqlite3") as new (path: string, options?: unknown) => unknown;
  } catch (error) {
    throw new Error(`SQLite index support requires optional dependency better-sqlite3: ${(error as Error).message}`);
  }
}

function hasDerivedRows(db: DatabaseHandle): boolean {
  const row = db.prepare("select count(*) as count from sessions").get() as { count: number } | undefined;
  return Number(row?.count || 0) > 0;
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
  db.exec(usageProjectionSchemaSql);
  if (!tableHasColumn(db, "events", "source_path")) db.exec("alter table events add column source_path text");
  if (!tableHasColumn(db, "messages", "text_full")) db.exec("alter table messages add column text_full text");
  if (!tableHasColumn(db, "messages", "thinking_text")) db.exec("alter table messages add column thinking_text text");
  if (!tableHasColumn(db, "messages", "thinking_preview")) db.exec("alter table messages add column thinking_preview text");
  if (!tableHasColumn(db, "tool_calls", "input_json")) db.exec("alter table tool_calls add column input_json text");
  if (!tableHasColumn(db, "tool_calls", "plan_text")) db.exec("alter table tool_calls add column plan_text text");
  if (!tableHasColumn(db, "tool_results", "output_full")) db.exec("alter table tool_results add column output_full text");
}

function upsertSourceFile(db: DatabaseHandle, file: string, provider: UsageProvider, sourceKind: UsageIndexSource, mtimeMs: number, size: number, events: UsageJsonlLineV1[]): void {
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
  const transaction = db.transaction(() => {
    deleteEvents.run(file);
    insertSource.run(file, provider, sourceKind, mtimeMs, size, events.length, new Date().toISOString());
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
  const projections = eventsToProjections(events);
  const insertConversation = db.prepare("insert or replace into conversations values (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertTurn = db.prepare("insert or replace into turns values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertRawEvent = db.prepare(`
    insert or replace into raw_events
    (id, source_file_id, provider, kind, recorded_at, observed_at, session_id, turn_id, step_id, json)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSession = db.prepare(`
    insert or replace into sessions
    (id, provider, provider_session_id, title, first_prompt, started_at, ended_at, last_activity_at, status, counts_json, metrics_json, availability_json, evidence_json, provider_fields_json)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertStep = db.prepare(`
    insert or replace into steps
    (id, session_id, turn_id, parent_step_id, step_order, kind, label, category, status, provider, model, tool_name, started_at, ended_at, duration_ms, self_duration_ms, duration_confidence, metrics_json, target_paths_json, evidence_json, native_refs_json, provider_fields_json)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMessage = db.prepare(`
    insert or replace into messages
    (id, session_id, turn_id, step_id, role, ordinal, created_at, text_preview, text_chars, text_bytes, content_mode, model, has_tool_use, has_thinking, token_usage_json, confidence, evidence_json, provider_fields_json, text_full, thinking_text, thinking_preview)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertToolCall = db.prepare(`
    insert or replace into tool_calls
    (id, session_id, turn_id, step_id, message_id, provider, tool_name, category, target_paths_json, model, status, result_step_id, evidence_json, provider_fields_json, input_json, plan_text)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertToolResult = db.prepare(`
    insert or replace into tool_results
    (id, session_id, turn_id, step_id, tool_call_id, provider, tool_name, status, output_preview, duration_ms, evidence_json, provider_fields_json, output_full)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertUsageSample = db.prepare(`
    insert or replace into usage_samples
    (id, session_id, turn_id, step_id, provider, model, tokens_json, evidence_json)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFileEvent = db.prepare(`
    insert or replace into file_events
    (id, session_id, step_id, provider, operation, target_paths_json, evidence_json)
    values (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEdge = db.prepare("insert or replace into edges (id, from_id, to_id, kind) values (?, ?, ?, ?)");
  const transaction = db.transaction(() => {
    db.prepare("delete from conversations").run();
    db.prepare("delete from turns").run();
    db.prepare("delete from raw_events").run();
    db.prepare("delete from sessions").run();
    db.prepare("delete from steps").run();
    db.prepare("delete from messages").run();
    db.prepare("delete from tool_calls").run();
    db.prepare("delete from tool_results").run();
    db.prepare("delete from usage_samples").run();
    db.prepare("delete from file_events").run();
    db.prepare("delete from edges").run();
    for (const row of dataset.conversations.all().data) {
      insertConversation.run(row.id, row.provider, row.providerSessionId, iso(row.startedAt), iso(row.endedAt), row.firstPrompt, row.cwd, row.gitBranch);
    }
    for (const row of dataset.turns.list().data) {
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
    for (const event of projections.rawEvents) {
      insertRawEvent.run(
        event.id,
        event.source.path || event.source.id,
        event.provider,
        event.kind,
        event.recordedAt,
        event.observedAt,
        event.scope.sessionId,
        event.scope.turnId,
        event.scope.stepId,
        JSON.stringify(event)
      );
    }
    for (const row of projections.sessions) {
      insertSession.run(row.id, row.provider, row.providerSessionId, row.title, row.firstPrompt, row.startedAt, row.endedAt, row.lastActivityAt, row.status, JSON.stringify(row.counts), JSON.stringify(row.metrics), JSON.stringify(row.availability), JSON.stringify(row.evidence), jsonOrNull(row.providerFields));
    }
    for (const row of projections.steps) {
      insertStep.run(row.id, row.sessionId, row.turnId, row.parentStepId, row.order, row.kind, row.label, row.category, row.status, row.provider, row.model, row.toolName, row.startedAt, row.endedAt, row.durationMs, row.selfDurationMs, row.durationConfidence, JSON.stringify(row.metrics), JSON.stringify(row.targetPaths), JSON.stringify(row.evidence), JSON.stringify(row.nativeRefs), jsonOrNull(row.providerFields));
      if (row.parentStepId) insertEdge.run(`edge:${row.parentStepId}:${row.id}`, row.parentStepId, row.id, "parent");
    }
    for (const row of projections.messages) {
      insertMessage.run(row.id, row.sessionId, row.turnId, row.stepId, row.role, row.ordinal, row.createdAt, row.textPreview, row.textChars, row.textBytes, row.contentMode, row.model, row.hasToolUse ? 1 : 0, row.hasThinking ? 1 : 0, jsonOrNull(row.tokenUsage), row.confidence, JSON.stringify(row.evidence), jsonOrNull(row.providerFields), row.text ?? null, row.thinking ?? null, row.thinkingPreview ?? null);
      if (row.stepId) insertEdge.run(`edge:${row.stepId}:${row.id}`, row.stepId, row.id, "message");
    }
    for (const row of projections.toolCalls) {
      insertToolCall.run(row.id, row.sessionId, row.turnId, row.stepId, row.messageId, row.provider, row.toolName, row.category, JSON.stringify(row.targetPaths), row.model, row.status, row.resultStepId, JSON.stringify(row.evidence), jsonOrNull(row.providerFields), jsonOrNull(row.input), row.plan ?? null);
      if (row.stepId) insertEdge.run(`edge:${row.stepId}:${row.id}`, row.stepId, row.id, "tool_call");
    }
    for (const row of projections.toolResults) {
      insertToolResult.run(row.id, row.sessionId, row.turnId, row.stepId, row.toolCallId, row.provider, row.toolName, row.status, row.outputPreview, row.durationMs, JSON.stringify(row.evidence), jsonOrNull(row.providerFields), typeof row.output === "string" ? row.output : jsonOrNull(row.output));
      if (row.stepId) insertEdge.run(`edge:${row.stepId}:${row.id}`, row.stepId, row.id, "tool_result");
    }
    for (const row of projections.usageSamples) {
      insertUsageSample.run(row.id, row.sessionId, row.turnId, row.id, row.provider, row.model, JSON.stringify(row.metrics.tokens), JSON.stringify(row.evidence));
    }
    for (const row of projections.steps.filter((step) => step.kind === "file_read" || step.kind === "file_search" || step.kind === "file_write")) {
      insertFileEvent.run(row.id, row.sessionId, row.id, row.provider, row.kind.replace("file_", ""), JSON.stringify(row.targetPaths), JSON.stringify(row.evidence));
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

function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function mkdirSyncForDb(dbPath: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
}

function tableHasColumn(db: DatabaseHandle, table: string, column: string): boolean {
  return (db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}
