import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type {
  UsageJsonlLineV1,
  UsageProvider,
  QueryResult,
  QuerySupport
} from "./schema/usage-jsonl-v1.js";
import { capabilitiesForProvider } from "./schema/capabilities.js";
import { conversationReport, type NormalizedConversation } from "./conversation-report.js";
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

export type ConversationListItem = {
  id: string;
  provider: UsageProvider;
  providerSessionId?: string;
  startedAt?: Date;
  endedAt?: Date;
  title?: string;
  firstPrompt?: string;
  cwd?: string;
  gitBranch?: string;
  confidence: {
    startedAt: string;
    endedAt: string;
  };
};

export type TurnListItem = {
  schema: "usage.turn.v1";
  sourceKey: string;
  provider: UsageProvider;
  conversationId: string;
  providerSessionId?: string;
  turnId: string;
  startedAt?: Date;
  endedAt?: Date;
  lastActivityAt: Date;
  status: "completed" | "failed" | "unknown";
  titlePreview?: string;
  sourceFingerprint: string;
  captureConfidence: "exact" | "partial" | "best-effort";
  stats: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    commandCalls: number;
    filesTouched: number;
  };
};

export type VisibleMessage = {
  id: string;
  provider: UsageProvider;
  conversationId: string;
  turnId?: string;
  role: "user" | "assistant";
  text?: string;
  textPreview?: string;
  createdAt?: Date;
  model?: string;
  confidence: string;
  source: "native" | "hook" | "best-effort";
};

export type MessageListQuery = {
  provider?: UsageProvider;
  conversationId?: string;
  turnId?: string;
  role?: VisibleMessage["role"];
  from?: Date;
  to?: Date;
  date?: string;
};

export type MessageListItem = VisibleMessage & {
  sourceKey?: string;
};

export type ToolCallWithResult = {
  id: string;
  provider: UsageProvider;
  conversationId: string;
  turnId?: string;
  toolName: string;
  category: string;
  input?: unknown;
  result?: { status: "success" | "error" | "unknown"; output?: unknown; durationMs?: number };
  targetPaths: string[];
  model?: string;
  confidence: string;
  evidenceEventId: string;
};

export type ActivityTimelineItem = {
  eventId: string;
  kind: string;
  provider: UsageProvider;
  conversationId: string;
  turnId?: string;
  at: Date;
  summary: string;
  data?: unknown;
};

type AnnotatedEvent = UsageJsonlLineV1 & {
  effectiveTurnId?: string;
  effectiveTurnIndex?: number;
};

type DatasetProvenance = QueryResult<unknown>["provenance"];

export class UsageDataset {
  readonly events: UsageJsonlLineV1[];
  readonly annotatedEvents: AnnotatedEvent[];
  readonly warnings: { code: string; message: string; path?: string }[];
  readonly provenance: DatasetProvenance;

  private readonly eventsByConversation = new Map<string, AnnotatedEvent[]>();
  private readonly eventsByTurn = new Map<string, AnnotatedEvent[]>();

  constructor(
    events: UsageJsonlLineV1[],
    warnings: { code: string; message: string; path?: string }[] = [],
    provenance?: Partial<DatasetProvenance>
  ) {
    this.events = [...events].sort(compareEvents);
    this.annotatedEvents = annotateTurns(this.events);
    this.warnings = warnings;
    this.provenance = {
      sourceFiles: provenance?.sourceFiles || [],
      indexVersion: provenance?.indexVersion || "usage.index.v1",
      generatedAt: provenance?.generatedAt || new Date().toISOString()
    };

    for (const event of this.annotatedEvents) {
      pushMap(this.eventsByConversation, event.conversation.id, event);
      if (event.effectiveTurnId) pushMap(this.eventsByTurn, sourceKey(event.provider, event.conversation.provider_session_id, event.conversation.id, event.effectiveTurnId), event);
    }
  }

  conversations = {
    /** Lists conversations matching an optional provider and date range filter. */
    list: (query: { provider?: UsageProvider; from?: Date; to?: Date } = {}): QueryResult<ConversationListItem[]> => {
      const rows = this.conversationRows()
        .filter((row) => !query.provider || row.provider === query.provider)
        .filter((row) => inRange(row.startedAt || row.endedAt, query.from, query.to));
      return this.result(rows, this.providers(), "conversations");
    },
    /** Lists conversations whose startedAt timestamp falls within the given range. */
    startedBetween: (range: { from?: Date; to?: Date }): QueryResult<ConversationListItem[]> => {
      const rows = this.conversationRows().filter((row) => inRange(row.startedAt, range.from, range.to));
      return this.result(rows, this.providers(), "conversations");
    },
    /** Lists conversations whose endedAt timestamp falls within the given range. */
    endedBetween: (range: { from?: Date; to?: Date }): QueryResult<ConversationListItem[]> => {
      const rows = this.conversationRows().filter((row) => inRange(row.endedAt, range.from, range.to));
      return this.result(rows, this.providers(), "conversations");
    },
    /** Returns a normalized conversation report for the given conversation and optional turn ID. */
    report: (query: { conversationId: string; turnId?: string }): QueryResult<NormalizedConversation> => {
      const report = conversationReport(this, query);
      return this.result(report, [report.provider], "conversations");
    },
    /** Returns all conversations in the dataset. */
    all: (): QueryResult<ConversationListItem[]> => this.result(this.conversationRows(), this.providers(), "conversations")
  };

  turns = {
    /** Lists turns filtered by provider, date range, or bucket date, sorted by the chosen bucket field. */
    list: (query: {
      provider?: UsageProvider;
      from?: Date;
      to?: Date;
      date?: string;
      bucketBy?: "turnEndedAt" | "turnStartedAt" | "lastActivityAt";
    } = {}): QueryResult<TurnListItem[]> => {
      const bucketBy = query.bucketBy || "turnEndedAt";
      const rows = this.turnRows()
        .filter((row) => !query.provider || row.provider === query.provider)
        .filter((row) => {
          const date = turnBucketDate(row, bucketBy);
          return inRange(date, query.from, query.to);
        })
        .filter((row) => !query.date || datePart(turnBucketDate(row, bucketBy)) === query.date);
      return this.result(rows, this.providers(), "conversations");
    },
    /** Returns a single turn by its source key, or undefined if not found. */
    get: (key: string): QueryResult<TurnListItem | undefined> => {
      const row = this.turnRows().find((turn) => turn.sourceKey === key);
      return this.result(row, row ? [row.provider] : this.providers(), "conversations");
    }
  };

  messages = {
    /** Lists visible messages matching the given query filters. */
    list: (query: MessageListQuery = {}): QueryResult<MessageListItem[]> => {
      const events = this.scopedEvents(query);
      const data = events
        .filter((event) => event.kind === "message.user" || event.kind === "message.assistant.visible")
        .filter((event) => !query.provider || event.provider === query.provider)
        .map((event) => this.visibleMessage(event))
        .filter((message) => !query.role || message.role === query.role)
        .filter((message) => inRange(message.createdAt, query.from, query.to))
        .filter((message) => !query.date || datePart(message.createdAt) === query.date);
      return this.result(data, this.providersForMessageQuery(query, events), "messages.visible");
    },
    /** Returns all visible messages for a conversation, optionally scoped to a turn. */
    visible: ({ conversationId, turnId }: { conversationId: string; turnId?: string }): QueryResult<VisibleMessage[]> => {
      return this.messages.list({ conversationId, turnId });
    },
    /** Returns internal assistant messages for a conversation, optionally scoped to a turn. */
    internal: ({ conversationId, turnId }: { conversationId: string; turnId?: string }): QueryResult<unknown[]> => {
      const data = this.scopedEvents({ conversationId, turnId }).filter((event) => event.kind === "message.assistant.internal");
      return this.result(data, [providerForConversation(this.events, conversationId)], "messages.internal");
    }
  };

  tools = {
    /** Returns tool calls with optional results, scoped to a conversation or turn. */
    calls: ({ conversationId, turnId, includeResults = true }: {
      conversationId?: string;
      turnId?: string;
      includeResults?: boolean | "none" | "preview" | "full";
    }): QueryResult<ToolCallWithResult[]> => {
      const events = this.scopedEvents({ conversationId, turnId });
      const calls = events.filter((event) => event.kind === "tool.call");
      const results = new Map(
        events.filter((event) => event.kind === "tool.result" && event.links?.tool_call_id)
          .map((event) => [event.links!.tool_call_id!, event])
      );
      const wantResults = includeResults !== false && includeResults !== "none";
      const data = calls.map((call) => {
        const result = wantResults && call.links?.tool_call_id ? results.get(call.links.tool_call_id) : undefined;
        return {
          id: call.links?.tool_call_id || call.event_id,
          provider: call.provider,
          conversationId: call.conversation.id,
          turnId: call.effectiveTurnId,
          toolName: dataString(call.data, "tool_name") || "unknown",
          category: dataString(call.data, "category") || "other",
          input: dataField(call.data, "input"),
          result: result ? {
            status: (dataString(result.data, "status") as "success" | "error" | "unknown") || "unknown",
            output: includeResults === "preview" ? previewUnknown(dataField(result.data, "output"), 1000) : dataField(result.data, "output"),
            durationMs: dataNumber(result.data, "duration_ms")
          } : undefined,
          targetPaths: stringArray(dataField(call.data, "target_paths")),
          model: call.actor?.model,
          confidence: call.availability?.confidence || call.capture.confidence || "unknown",
          evidenceEventId: call.event_id
        };
      });
      return this.result(data, providersForEvents(events), "tools.calls");
    }
  };

  activity = {
    /** Returns all events for a conversation or turn as an ordered activity timeline. */
    timeline: ({ conversationId, turnId }: { conversationId?: string; turnId?: string }): QueryResult<ActivityTimelineItem[]> => {
      const events = this.scopedEvents({ conversationId, turnId });
      const data = events.map((event) => ({
        eventId: event.event_id,
        kind: event.kind,
        provider: event.provider,
        conversationId: event.conversation.id,
        turnId: event.effectiveTurnId,
        at: eventDate(event),
        summary: eventSummary(event),
        data: event.data
      }));
      return this.result(data, providersForEvents(events), "conversations");
    }
  };

  tokens = {
    /** Returns raw token usage events grouped by conversation. */
    byConversation: ({ conversationId }: { conversationId: string }): QueryResult<unknown[]> => {
      const rows = aggregateUsage(this.scopedEvents({ conversationId }));
      return this.result(rows, [providerForConversation(this.events, conversationId)], "tokens.byConversation");
    },
    /** Returns raw token usage events grouped by model within a conversation. */
    byModel: ({ conversationId }: { conversationId: string }): QueryResult<unknown[]> => {
      const rows = aggregateUsage(this.scopedEvents({ conversationId }), "model");
      return this.result(rows, [providerForConversation(this.events, conversationId)], "tokens.byModel");
    }
  };

  capabilities = {
    /** Returns provider capability metadata for the given provider. */
    forProvider: (provider: UsageProvider) => capabilitiesForProvider(provider),
    /** Returns aggregated query support status across all providers in the dataset. */
    forQuery: (query: keyof ReturnType<typeof capabilitiesForProvider>) => supportFor(this.providers(), query)
  };

  /** Writes all events, conversations, and turns to a SQLite index at the repo's index path. */
  writeIndex(repoRoot: string): void {
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
      for (const event of this.annotatedEvents) {
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
      for (const row of this.conversationRows()) {
        insertConversation.run(row.id, row.provider, row.providerSessionId, iso(row.startedAt), iso(row.endedAt), row.firstPrompt, row.cwd, row.gitBranch);
      }
      for (const row of this.turnRows()) {
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

  /** Wraps data in a QueryResult envelope with support metadata derived from the given providers. */
  private result<T>(data: T, providers: Array<UsageProvider | undefined>, key: keyof ReturnType<typeof capabilitiesForProvider>): QueryResult<T> {
    return {
      data,
      support: supportFor(providers, key),
      warnings: this.warnings,
      provenance: this.provenance
    };
  }

  /** Returns the deduplicated list of providers represented in the dataset's events. */
  private providers(): UsageProvider[] {
    return [...new Set(this.events.map((event) => event.provider))];
  }

  /** Returns events scoped to an optional conversation and/or turn ID. */
  private scopedEvents(query: { conversationId?: string; turnId?: string }): AnnotatedEvent[] {
    const events = query.conversationId ? this.eventsByConversation.get(query.conversationId) || [] : this.annotatedEvents;
    return query.turnId ? events.filter((event) => event.effectiveTurnId === query.turnId) : events;
  }

  /** Converts an annotated event to a MessageListItem for the messages query surface. */
  private visibleMessage(event: AnnotatedEvent): MessageListItem {
    return {
      id: event.links?.message_id || event.event_id,
      provider: event.provider,
      conversationId: event.conversation.id,
      turnId: event.effectiveTurnId,
      sourceKey: event.effectiveTurnId ? sourceKey(event.provider, event.conversation.provider_session_id, event.conversation.id, event.effectiveTurnId) : undefined,
      role: event.kind === "message.user" ? "user" as const : "assistant" as const,
      text: dataString(event.data, "text") || dataString(event.data, "delta"),
      textPreview: dataString(event.data, "text_preview"),
      createdAt: eventDate(event),
      model: event.actor?.model,
      confidence: event.availability?.confidence || event.capture.confidence || "unknown",
      source: sourceOf(event)
    };
  }

  /** Returns the providers relevant to a message query, respecting explicit provider or conversation scope. */
  private providersForMessageQuery(query: MessageListQuery, scopedEvents: AnnotatedEvent[]): Array<UsageProvider | undefined> {
    if (query.provider) return [query.provider];
    if (query.conversationId) return [providerForConversation(this.events, query.conversationId)];
    return providersForEvents(scopedEvents);
  }

  /** Builds a ConversationListItem for each conversation ID in the event index. */
  private conversationRows(): ConversationListItem[] {
    return [...this.eventsByConversation.entries()].map(([id, events]) => {
      const start = events.find((event) => event.kind === "conversation.start") || events[0];
      const end = [...events].reverse().find((event) => event.kind === "conversation.end");
      const firstPrompt = events.find((event) => event.kind === "message.user");
      return {
        id,
        provider: events[0]!.provider,
        providerSessionId: events[0]!.conversation.provider_session_id,
        startedAt: start ? eventDate(start) : undefined,
        endedAt: end ? eventDate(end) : undefined,
        firstPrompt: firstPrompt ? dataString(firstPrompt.data, "text") || dataString(firstPrompt.data, "text_preview") : undefined,
        title: firstPrompt ? previewUnknown(dataString(firstPrompt.data, "text") || dataString(firstPrompt.data, "text_preview"), 80) : undefined,
        cwd: start?.repo.cwd,
        gitBranch: start?.repo.git?.branch,
        confidence: {
          startedAt: start?.availability?.confidence || "derived",
          endedAt: end?.availability?.confidence || "unknown"
        }
      };
    });
  }

  /** Builds a TurnListItem for each turn in the event index, sorted by lastActivityAt. */
  private turnRows(): TurnListItem[] {
    return [...this.eventsByTurn.entries()].map(([key, events]) => {
      const start = events.find((event) => event.kind === "turn.start") || events.find((event) => event.kind === "message.user") || events[0]!;
      const end = [...events].reverse().find((event) => event.kind === "turn.end");
      const last = events.at(-1)!;
      const provider = events[0]!.provider;
      const conversation = events[0]!.conversation;
      const turnId = events[0]!.effectiveTurnId!;
      const files = new Set(events.flatMap(pathsForEvent));
      const toolCalls = events.filter((event) => event.kind === "tool.call");
      return {
        schema: "usage.turn.v1" as const,
        sourceKey: key,
        provider,
        conversationId: conversation.id,
        providerSessionId: conversation.provider_session_id,
        turnId,
        startedAt: start ? eventDate(start) : undefined,
        endedAt: end ? eventDate(end) : undefined,
        lastActivityAt: eventDate(last),
        status: turnStatus(end),
        titlePreview: titlePreview(events),
        sourceFingerprint: fingerprint(events),
        captureConfidence: captureConfidence(events),
        stats: {
          userMessages: events.filter((event) => event.kind === "message.user").length,
          assistantMessages: events.filter((event) => event.kind === "message.assistant.visible").length,
          toolCalls: toolCalls.length,
          commandCalls: toolCalls.filter((event) => dataString(event.data, "category") === "command").length,
          filesTouched: files.size
        }
      };
    }).sort((a, b) => a.lastActivityAt.getTime() - b.lastActivityAt.getTime());
  }
}

/** Dynamically requires better-sqlite3, throwing a descriptive error if it is not installed. */
function optionalSqlite(): new (path: string, options?: unknown) => unknown {
  try {
    return require("better-sqlite3") as new (path: string, options?: unknown) => unknown;
  } catch (error) {
    throw new Error(`SQLite index support requires optional dependency better-sqlite3: ${(error as Error).message}`);
  }
}

/** Annotates events with effectiveTurnId and effectiveTurnIndex by tracking turn boundaries per conversation. */
function annotateTurns(events: UsageJsonlLineV1[]): AnnotatedEvent[] {
  const state = new Map<string, { current?: string; counter: number; indexes: Map<string, number> }>();
  return events.map((event) => {
    const key = event.conversation.id;
    const row = state.get(key) || { counter: 0, indexes: new Map<string, number>() };
    let turnId = event.turn?.id;
    const turnScoped = !event.kind.startsWith("conversation.");

    if ((event.kind === "turn.start" || (event.kind === "message.user" && !row.current)) && !turnId) {
      row.counter += 1;
      turnId = `turn-${String(row.counter).padStart(6, "0")}`;
      row.current = turnId;
    } else if (turnId) {
      row.current = turnId;
    } else if (turnScoped) {
      turnId = row.current || "turn-000001";
      row.current = turnId;
    }

    if (turnId && !row.indexes.has(turnId)) row.indexes.set(turnId, row.indexes.size + 1);
    if (event.kind === "turn.end") row.current = undefined;
    state.set(key, row);
    return {
      ...event,
      effectiveTurnId: turnId,
      effectiveTurnIndex: turnId ? row.indexes.get(turnId) : undefined
    };
  });
}

/** Returns the QuerySupport status for a capability key across the given set of providers. */
function supportFor(providers: Array<UsageProvider | undefined>, key: keyof ReturnType<typeof capabilitiesForProvider>): QuerySupport {
  const present = [...new Set(providers.filter(Boolean) as UsageProvider[])];
  const providerCoverage = Object.fromEntries(
    present.map((provider) => [provider, capabilitiesForProvider(provider)[key]])
  );
  const statuses = Object.values(providerCoverage).map((entry) => entry.status);
  const status = statuses.includes("unsupported") ? (statuses.length === 1 ? "unsupported" : "partial") : statuses.includes("partial") ? "partial" : "supported";
  return { status, providerCoverage };
}

/** Compares two events by observed/recorded timestamp for chronological sorting. */
function compareEvents(a: UsageJsonlLineV1, b: UsageJsonlLineV1): number {
  return (a.observed_at || a.recorded_at).localeCompare(b.observed_at || b.recorded_at) || a.recorded_at.localeCompare(b.recorded_at);
}

/** Constructs the compound source key used to index a turn in the eventsByTurn map. */
function sourceKey(provider: UsageProvider, sessionId: string | undefined, conversationId: string, turnId: string): string {
  return `${provider}:${sessionId || conversationId.split(":").slice(1).join(":") || "unknown"}:${turnId}`;
}

/** Appends a value to the array stored at key in the map, creating the array if absent. */
function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const rows = map.get(key) || [];
  rows.push(value);
  map.set(key, rows);
}

/** Returns the observed or recorded timestamp of an event as a Date object. */
function eventDate(event: UsageJsonlLineV1): Date {
  return new Date(event.observed_at || event.recorded_at);
}

/** Returns the bucket date for a turn based on the requested bucket field. */
function turnBucketDate(row: TurnListItem, bucketBy: "turnEndedAt" | "turnStartedAt" | "lastActivityAt"): Date | undefined {
  if (bucketBy === "turnStartedAt") return row.startedAt || row.lastActivityAt || row.endedAt;
  if (bucketBy === "lastActivityAt") return row.lastActivityAt || row.endedAt || row.startedAt;
  return row.endedAt || row.lastActivityAt || row.startedAt;
}

/** Returns the ISO date string prefix (YYYY-MM-DD) for a Date, or undefined if absent. */
function datePart(date: Date | undefined): string | undefined {
  return date?.toISOString().slice(0, 10);
}

/** Returns true if the date is defined and falls within the optional from/to bounds. */
function inRange(date: Date | undefined, from?: Date, to?: Date): boolean {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** Returns the provider for the first event matching the given conversation ID. */
function providerForConversation(events: UsageJsonlLineV1[], conversationId: string): UsageProvider | undefined {
  return events.find((event) => event.conversation.id === conversationId)?.provider;
}

/** Returns the deduplicated list of providers across a set of events. */
function providersForEvents(events: UsageJsonlLineV1[]): UsageProvider[] {
  return [...new Set(events.map((event) => event.provider))];
}

/** Returns a named key from an object-like data value, or undefined if data is not an object. */
function dataField(data: unknown, key: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
}

/** Returns a string field from a data object, or undefined if the field is absent or not a string. */
function dataString(data: unknown, key: string): string | undefined {
  const value = dataField(data, key);
  return typeof value === "string" ? value : undefined;
}

/** Returns a number field from a data object, or undefined if the field is absent or not a number. */
function dataNumber(data: unknown, key: string): number | undefined {
  const value = dataField(data, key);
  return typeof value === "number" ? value : undefined;
}

/** Returns an array of strings from an unknown value, filtering out non-string elements. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Returns the capture source category for a message event. */
function sourceOf(event: UsageJsonlLineV1): "native" | "hook" | "best-effort" {
  if (event.capture.source === "hook") return "hook";
  if (event.capture.source === "native-import") return "native";
  return "native";
}

/** Returns the turn status derived from a turn.end event, or "unknown" if there is no end event. */
function turnStatus(end: AnnotatedEvent | undefined): TurnListItem["status"] {
  if (!end) return "unknown";
  const status = dataString(end.data, "status");
  if (status === "completed" || status === "failed") return status;
  return "unknown";
}

/** Returns a truncated preview of the first user message text in the turn's events. */
function titlePreview(events: AnnotatedEvent[]): string | undefined {
  const prompt = events.find((event) => event.kind === "message.user");
  const text = prompt ? dataString(prompt.data, "text") || dataString(prompt.data, "text_preview") : undefined;
  return text ? previewUnknown(text, 100) : undefined;
}

/** Returns the capture confidence level for the turn, based on the weakest event confidence. */
function captureConfidence(events: AnnotatedEvent[]): TurnListItem["captureConfidence"] {
  if (events.some((event) => event.availability?.confidence === "partial" || event.capture.confidence === "partial")) return "partial";
  if (events.some((event) => event.availability?.confidence === "inferred" || event.capture.confidence === "inferred")) return "best-effort";
  return "exact";
}

/** Returns a short SHA-256 fingerprint of the turn's event IDs and count for change detection. */
function fingerprint(events: AnnotatedEvent[]): string {
  return createHash("sha256").update(JSON.stringify({
    ids: events.map((event) => event.event_id),
    count: events.length,
    latest: events.at(-1)?.recorded_at,
    version: "turn-input.v1"
  })).digest("hex").slice(0, 16);
}

/** Returns all file paths referenced by a legacy usage event across known path data fields. */
function pathsForEvent(event: UsageJsonlLineV1): string[] {
  const values = [
    dataField(event.data, "path"),
    dataField(event.data, "file"),
    dataField(event.data, "target_path"),
    dataField(event.data, "targetPaths"),
    dataField(event.data, "target_paths")
  ];
  return values.flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string");
}

/** Returns a one-line summary string for an event suitable for display in a timeline. */
function eventSummary(event: UsageJsonlLineV1): string {
  if (event.kind === "message.user" || event.kind === "message.assistant.visible") return previewUnknown(dataString(event.data, "text") || dataString(event.data, "text_preview"), 120);
  if (event.kind === "tool.call" || event.kind === "tool.result") return [dataString(event.data, "tool_name"), dataString(event.data, "status")].filter(Boolean).join(" ");
  if (event.kind === "compact.post") return previewUnknown(dataString(event.data, "compact_summary") || dataString(event.data, "summary"), 120);
  return event.kind;
}

/** Serializes an unknown value to a compact single-line string, truncated to max characters. */
function previewUnknown(value: unknown, max = 240): string {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

/** Returns raw token usage events grouped by conversation or by model within a conversation. */
function aggregateUsage(events: UsageJsonlLineV1[], by?: "model"): unknown[] {
  const usageEvents = events.filter((event) => event.kind === "token.usage" || Boolean(dataField(event.data, "usage")));
  if (!by) return usageEvents.map((event) => ({ provider: event.provider, conversationId: event.conversation.id, usage: dataField(event.data, "usage"), source: sourceOf(event) }));
  const rows = new Map<string, { model?: string; count: number; usage: unknown[] }>();
  for (const event of usageEvents) {
    const model = event.actor?.model || "unknown";
    const row = rows.get(model) || { model, count: 0, usage: [] };
    row.count += 1;
    row.usage.push(dataField(event.data, "usage"));
    rows.set(model, row);
  }
  return [...rows.values()];
}

/** Returns an ISO string for a Date, or undefined if the date is absent. */
function iso(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

/** Returns true if the given SQLite table has a column with the specified name. */
function tableHasColumn(db: DatabaseHandle, table: string, column: string): boolean {
  return (db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}
