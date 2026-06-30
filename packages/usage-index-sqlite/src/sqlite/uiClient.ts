import type { OpenUsageOptions, UsageClient, UsageSessionApi } from "@tangent/usage-core/core/index";
import { createUsageClient } from "@tangent/usage-core/core/index";
import { eventsToProjections } from "@tangent/usage-core/core/projections";
import { resultMeta } from "@tangent/usage-core/query";
import { UsageError, type UsageMessage, type UsageSession } from "@tangent/usage-core/schema";
import { isUsageProvider, usageProviders } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { providerCapabilities } from "@tangent/usage-providers/providers/index";
import { ensureSchema, openDb, usageIndexTarget } from "../sdk/indexStore.js";

type Db = Awaited<ReturnType<typeof openDb>>;

/** Wraps a value in the Usage result envelope, tagged as sourced from the SQLite index. */
function wrap<T>(data: T, schema: string, query: unknown, page?: { hasMore?: boolean; nextCursor?: string }) {
  return resultMeta(data, { schema, query, page, index: { kind: "sqlite" } });
}

type SessionRow = { session_json: string; sparkline_json: string | null };
type MessageRow = {
  id: string;
  session_id: string;
  turn_id: string | null;
  step_id: string | null;
  role: string;
  ordinal: number;
  created_at: string | null;
  text_preview: string | null;
  text_full: string | null;
  text_chars: number | null;
  content_mode: string;
  model: string | null;
  has_tool_use: number;
  has_thinking: number;
  token_usage_json: string | null;
  confidence: string | null;
};

/** A session payload carrying its precomputed sparkline so the list view renders without a per-card timeline. */
export type UsageSessionWithSparkline = UsageSession & { sparkline?: unknown };

/**
 * Opens a Usage client that serves the local UI directly from the slim SQLite index: the session
 * list and message selection are indexed SQL reads over precomputed rows, and a single session's
 * detail (report, timeline, tool calls) is projected on demand from that session's `events`. It never
 * loads or projects the whole window into memory, so switching to the Usage panel is a cheap query
 * rather than a multi-second rebuild. Cold analytics methods the UI never calls fall through to an
 * empty in-memory client. Reads only; the watcher keeps the index current through `ensureUsageIndex`.
 */
export async function openUsageUiFromSqlite(options: OpenUsageOptions = {}): Promise<UsageClient> {
  const providers = options.providers?.filter(isUsageProvider);
  const contentMode = options.contentMode || "metadata-with-excerpts";
  const capabilities = (providers || usageProviders).map(providerCapabilities);
  const since = options.from ? new Date(options.from).toISOString() : undefined;
  const db = await openDb(await usageIndexTarget({ repo: options.repo || ".", scope: options.scope }));
  ensureSchema(db);

  // Empty in-memory client supplies correctly-shaped empty results for the analytics/raw/token methods
  // the UI never calls; the hot session, message, and tool methods below are overridden with SQL.
  const base = createUsageClient(eventsToProjections({ events: [], capabilities, contentMode, index: { kind: "sqlite", version: "usage.index.v2" } }));

  /** Loads one conversation's events and projects them into a single-session in-memory client. */
  const sessionClient = (conversationId: string): UsageClient => {
    const events = (db.prepare("select json from events where conversation_id = ? order by coalesce(observed_at, recorded_at), recorded_at").all(conversationId) as Array<{ json: string }>)
      .map((row) => JSON.parse(row.json));
    return createUsageClient(eventsToProjections({ events, capabilities, contentMode, index: { kind: "sqlite", version: "usage.index.v2" } }));
  };

  /** Resolves a session ref (full id, short id/prefix, or "latest") to a stored session payload. */
  const resolveSession = (idOrRef: string): UsageSessionWithSparkline => {
    if (idOrRef === "latest" || idOrRef === "selected") {
      const row = db.prepare("select session_json, sparkline_json from sessions order by last_activity_at desc limit 1").get() as SessionRow | undefined;
      if (!row) throw new UsageError("USAGE_NOT_FOUND", "No usage sessions found.", { retryable: false });
      return withSparkline(row);
    }
    const exact = db.prepare("select session_json, sparkline_json from sessions where id = ?").get(idOrRef) as SessionRow | undefined;
    if (exact) return withSparkline(exact);
    const prefix = db.prepare("select session_json, sparkline_json from sessions where id like ? order by last_activity_at desc limit 2").all(`${idOrRef}%`) as SessionRow[];
    if (prefix.length === 1) return withSparkline(prefix[0]!);
    if (!prefix.length) throw new UsageError("USAGE_NOT_FOUND", `No usage session found for ${idOrRef}.`, { details: { idOrRef }, retryable: false });
    throw new UsageError("USAGE_AMBIGUOUS_REF", `Usage session ref ${idOrRef} is ambiguous.`, { details: { idOrRef }, retryable: false });
  };

  const sessions: UsageSessionApi = {
    /** Lists sessions newest-first from the slim table, windowed by activity, each with its precomputed sparkline. */
    list: async (query = {}) => {
      const limit = query.limit ?? 50;
      const provider = query.provider ?? query.where?.provider;
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (since) { clauses.push("last_activity_at >= ?"); params.push(since); }
      if (provider) { clauses.push("provider = ?"); params.push(provider); }
      const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
      const rows = db.prepare(`select session_json, sparkline_json from sessions ${where} order by last_activity_at desc limit ?`).all(...params, limit) as SessionRow[];
      const data = rows.map(withSparkline);
      return wrap(data as unknown as UsageSession[], "tangent.usage.sessions.list.v1", query, { hasMore: rows.length === limit });
    },
    /** Resolves a session ref to its stored payload. */
    get: async (idOrRef) => wrap(resolveSession(idOrRef) as unknown as UsageSession, "tangent.usage.sessions.get.v1", { idOrRef }),
    /** Returns the most recently active session. */
    latest: async (query = {}) => wrap(resolveSessionOrUndefined(db) as unknown as UsageSession | undefined, "tangent.usage.sessions.latest.v1", query),
    /** Projects one session's events on demand to build its report. */
    report: async (idOrRef, options = {}) => sessionClient(resolveSession(idOrRef).id).sessions.report(idOrRef, options),
    /** Projects one session's events on demand to build its timeline. */
    timeline: async (idOrRef, options = {}) => sessionClient(resolveSession(idOrRef).id).sessions.timeline(idOrRef, options)
  };

  return {
    ...base,
    sessions,
    conversations: sessions,
    steps: {
      ...base.steps,
      /** Projects one session's events for its step timeline; an unscoped query has no global step store to read. */
      timeline: async (query) => query.sessionId ? sessionClient(query.sessionId).steps.timeline(query) : base.steps.timeline(query)
    },
    messages: {
      ...base.messages,
      /** Reads recent messages from the slim table for the cross-session message-selection view. */
      query: async (query = {}) => {
        const role = query.where?.role as string | undefined;
        const limit = query.limit ?? 200;
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (role) { clauses.push("role = ?"); params.push(role); }
        const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
        const rows = db.prepare(`select id, session_id, turn_id, step_id, role, ordinal, created_at, text_preview, text_full, text_chars, content_mode, model, has_tool_use, has_thinking, token_usage_json, confidence from messages ${where} order by created_at desc limit ?`).all(...params, limit) as MessageRow[];
        return wrap(rows.map(mapMessageRow), "tangent.usage.messages.query.v1", query);
      }
    },
    tools: {
      ...base.tools,
      /** Projects one session's events for its tool calls; an unscoped query has no global tool store to read. */
      query: async (query = {}) => {
        const sessionId = query.where?.sessionId as string | undefined;
        return sessionId ? sessionClient(sessionId).tools.query(query) : base.tools.query(query);
      }
    },
    index: { kind: "sqlite" }
  };
}

/** Parses a stored session payload and attaches its precomputed sparkline. */
function withSparkline(row: SessionRow): UsageSessionWithSparkline {
  const session = JSON.parse(row.session_json) as UsageSession;
  return { ...session, sparkline: row.sparkline_json ? JSON.parse(row.sparkline_json) : undefined };
}

/** Returns the most recent session payload, or undefined when the index is empty. */
function resolveSessionOrUndefined(db: Db): UsageSessionWithSparkline | undefined {
  const row = db.prepare("select session_json, sparkline_json from sessions order by last_activity_at desc limit 1").get() as SessionRow | undefined;
  return row ? withSparkline(row) : undefined;
}

/** Maps a stored message row into the domain shape the message-selection view reads. */
function mapMessageRow(row: MessageRow): UsageMessage {
  const tokenUsage = row.token_usage_json ? JSON.parse(row.token_usage_json) : undefined;
  return {
    schema: "tangent.usage.message.v1",
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id ?? undefined,
    stepId: row.step_id ?? undefined,
    role: row.role as UsageMessage["role"],
    ordinal: row.ordinal,
    createdAt: row.created_at ?? undefined,
    text: row.text_full ?? undefined,
    textPreview: row.text_preview ?? undefined,
    textChars: row.text_chars ?? undefined,
    contentMode: row.content_mode as UsageMessage["contentMode"],
    model: row.model ?? undefined,
    hasToolUse: row.has_tool_use === 1,
    hasThinking: row.has_thinking === 1,
    tokenUsage,
    confidence: (row.confidence ?? "unknown") as UsageMessage["confidence"],
    evidence: []
  };
}
