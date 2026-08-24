import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { UsageJsonlLineV1 } from "./schema/usage-jsonl-v1.js";
import type { ConversationListItem, TurnListItem } from "./dataset.js";
import { repoIndexPath } from "./paths.js";

const require = createRequire(import.meta.url);

type DatabaseHandle = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
};

type IndexedEvent = UsageJsonlLineV1 & {
  effectiveTurnId?: string;
};

/** Writes one dataset snapshot to the repository SQLite index. */
export function writeDatasetIndex(repoRoot: string, rows: {
  events: IndexedEvent[];
  conversations: ConversationListItem[];
  turns: TurnListItem[];
}): void {
  const dbPath = repoIndexPath(repoRoot);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const Database = optionalSqlite();
  const db = new Database(dbPath) as DatabaseHandle;
  db.exec(`
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
    create index if not exists events_conversation_idx on events (conversation_id, recorded_at);
    create index if not exists events_turn_idx on events (turn_id, recorded_at);
    create index if not exists events_provider_recorded_idx on events (provider, recorded_at);
  `);
  if (!tableHasColumn(db, "events", "source_path")) db.exec("alter table events add column source_path text");
  const insertEvent = db.prepare(`
    insert or replace into events
    (event_id, kind, provider, conversation_id, session_id, turn_id, observed_at, recorded_at, source_path, json)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertConversation = db.prepare("insert or replace into conversations values (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertTurn = db.prepare("insert or replace into turns values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const transaction = db.transaction(() => {
    for (const event of rows.events) {
      insertEvent.run(
        event.event_id,
        event.kind,
        event.provider,
        event.conversation.id,
        event.conversation.provider_session_id,
        event.effectiveTurnId,
        event.observed_at,
        event.recorded_at,
        null,
        JSON.stringify(event)
      );
    }
    for (const row of rows.conversations) {
      insertConversation.run(row.id, row.provider, row.providerSessionId, iso(row.startedAt), iso(row.endedAt), row.firstPrompt, row.cwd, row.gitBranch);
    }
    for (const row of rows.turns) {
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
  db.close();
}

/** Dynamically requires better-sqlite3, with a descriptive error when it is absent. */
function optionalSqlite(): new (path: string, options?: unknown) => unknown {
  try {
    return require("better-sqlite3") as new (path: string, options?: unknown) => unknown;
  } catch (error) {
    throw new Error(`SQLite index support requires optional dependency better-sqlite3: ${(error as Error).message}`);
  }
}

/** Returns an ISO string for a Date, or undefined if the date is absent. */
function iso(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

/** Returns true if the given SQLite table has a column with the specified name. */
function tableHasColumn(db: DatabaseHandle, table: string, column: string): boolean {
  return (db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}
