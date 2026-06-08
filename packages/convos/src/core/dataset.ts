import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import type {
  ConvosJsonlLineV1,
  ConvosProvider,
  QueryResult,
  QuerySupport
} from "./schema/convos-jsonl-v1.js";
import { capabilitiesForProvider } from "./schema/capabilities.js";
import { repoIndexPath } from "./paths.js";

export type ConversationListItem = {
  id: string;
  provider: ConvosProvider;
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
  schema: "convos.turn.v1";
  sourceKey: string;
  provider: ConvosProvider;
  conversationId: string;
  providerSessionId?: string;
  turnId: string;
  startedAt?: Date;
  endedAt?: Date;
  lastActivityAt: Date;
  status: "completed" | "failed" | "active" | "unknown";
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
  provider: ConvosProvider;
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

export type ToolCallWithResult = {
  id: string;
  provider: ConvosProvider;
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
  provider: ConvosProvider;
  conversationId: string;
  turnId?: string;
  at: Date;
  summary: string;
  data?: unknown;
};

type AnnotatedEvent = ConvosJsonlLineV1 & {
  effectiveTurnId?: string;
  effectiveTurnIndex?: number;
};

type DatasetProvenance = QueryResult<unknown>["provenance"];

export class ConvosDataset {
  readonly events: ConvosJsonlLineV1[];
  readonly annotatedEvents: AnnotatedEvent[];
  readonly warnings: { code: string; message: string; path?: string }[];
  readonly provenance: DatasetProvenance;

  private readonly eventsByConversation = new Map<string, AnnotatedEvent[]>();
  private readonly eventsByTurn = new Map<string, AnnotatedEvent[]>();

  constructor(
    events: ConvosJsonlLineV1[],
    warnings: { code: string; message: string; path?: string }[] = [],
    provenance?: Partial<DatasetProvenance>
  ) {
    this.events = [...events].sort(compareEvents);
    this.annotatedEvents = annotateTurns(this.events);
    this.warnings = warnings;
    this.provenance = {
      sourceFiles: provenance?.sourceFiles || [],
      indexVersion: provenance?.indexVersion || "convos.index.v1",
      generatedAt: provenance?.generatedAt || new Date().toISOString()
    };

    for (const event of this.annotatedEvents) {
      pushMap(this.eventsByConversation, event.conversation.id, event);
      if (event.effectiveTurnId) pushMap(this.eventsByTurn, sourceKey(event.provider, event.conversation.provider_session_id, event.conversation.id, event.effectiveTurnId), event);
    }
  }

  conversations = {
    list: (query: { provider?: ConvosProvider; from?: Date; to?: Date } = {}): QueryResult<ConversationListItem[]> => {
      const rows = this.conversationRows()
        .filter((row) => !query.provider || row.provider === query.provider)
        .filter((row) => inRange(row.startedAt || row.endedAt, query.from, query.to));
      return this.result(rows, this.providers(), "conversations");
    },
    startedBetween: (range: { from?: Date; to?: Date }): QueryResult<ConversationListItem[]> => {
      const rows = this.conversationRows().filter((row) => inRange(row.startedAt, range.from, range.to));
      return this.result(rows, this.providers(), "conversations");
    },
    endedBetween: (range: { from?: Date; to?: Date }): QueryResult<ConversationListItem[]> => {
      const rows = this.conversationRows().filter((row) => inRange(row.endedAt, range.from, range.to));
      return this.result(rows, this.providers(), "conversations");
    },
    all: (): QueryResult<ConversationListItem[]> => this.result(this.conversationRows(), this.providers(), "conversations")
  };

  turns = {
    list: (query: {
      provider?: ConvosProvider;
      from?: Date;
      to?: Date;
      includeActive?: boolean;
      date?: string;
      bucketBy?: "turnEndedAt" | "turnStartedAt" | "lastActivityAt";
    } = {}): QueryResult<TurnListItem[]> => {
      const bucketBy = query.bucketBy || "turnEndedAt";
      const rows = this.turnRows()
        .filter((row) => !query.provider || row.provider === query.provider)
        .filter((row) => query.includeActive || row.status !== "active")
        .filter((row) => {
          const date = turnBucketDate(row, bucketBy);
          return inRange(date, query.from, query.to);
        })
        .filter((row) => !query.date || datePart(turnBucketDate(row, bucketBy)) === query.date);
      return this.result(rows, this.providers(), "conversations");
    },
    get: (key: string): QueryResult<TurnListItem | undefined> => {
      const row = this.turnRows().find((turn) => turn.sourceKey === key);
      return this.result(row, row ? [row.provider] : this.providers(), "conversations");
    }
  };

  messages = {
    visible: ({ conversationId, turnId }: { conversationId: string; turnId?: string }): QueryResult<VisibleMessage[]> => {
      const data = this.scopedEvents({ conversationId, turnId })
        .filter((event) => event.kind === "message.user" || event.kind === "message.assistant.visible")
        .map((event) => ({
          id: event.event_id,
          provider: event.provider,
          conversationId: event.conversation.id,
          turnId: event.effectiveTurnId,
          role: event.kind === "message.user" ? "user" as const : "assistant" as const,
          text: dataString(event.data, "text") || dataString(event.data, "delta"),
          textPreview: dataString(event.data, "text_preview"),
          createdAt: eventDate(event),
          model: event.actor?.model,
          confidence: event.availability?.confidence || event.capture.confidence || "unknown",
          source: sourceOf(event)
        }));
      return this.result(data, [providerForConversation(this.events, conversationId)], "messages.visible");
    },
    internal: ({ conversationId, turnId }: { conversationId: string; turnId?: string }): QueryResult<unknown[]> => {
      const data = this.scopedEvents({ conversationId, turnId }).filter((event) => event.kind === "message.assistant.internal");
      return this.result(data, [providerForConversation(this.events, conversationId)], "messages.internal");
    }
  };

  tools = {
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
    byConversation: ({ conversationId }: { conversationId: string }): QueryResult<unknown[]> => {
      const rows = aggregateUsage(this.scopedEvents({ conversationId }));
      return this.result(rows, [providerForConversation(this.events, conversationId)], "tokens.byConversation");
    },
    byModel: ({ conversationId }: { conversationId: string }): QueryResult<unknown[]> => {
      const rows = aggregateUsage(this.scopedEvents({ conversationId }), "model");
      return this.result(rows, [providerForConversation(this.events, conversationId)], "tokens.byModel");
    },
    perToolCall: ({ conversationId }: { conversationId: string }): QueryResult<unknown[]> => {
      return this.result([], [providerForConversation(this.events, conversationId)], "tokens.perToolCall");
    }
  };

  capabilities = {
    forProvider: (provider: ConvosProvider) => capabilitiesForProvider(provider),
    forQuery: (query: keyof ReturnType<typeof capabilitiesForProvider>) => supportFor(this.providers(), query)
  };

  writeIndex(repoRoot: string): void {
    const dbPath = repoIndexPath(repoRoot);
    mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.exec(`
      drop table if exists events;
      drop table if exists turns;
      drop table if exists conversations;
      create table events (
        event_id text primary key,
        kind text not null,
        provider text not null,
        conversation_id text not null,
        session_id text,
        turn_id text,
        observed_at text,
        recorded_at text not null,
        json text not null
      );
      create table conversations (
        id text primary key,
        provider text not null,
        session_id text,
        started_at text,
        ended_at text,
        first_prompt text,
        cwd text,
        git_branch text
      );
      create table turns (
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
    `);
    const insertEvent = db.prepare("insert into events values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertConversation = db.prepare("insert into conversations values (?, ?, ?, ?, ?, ?, ?, ?)");
    const insertTurn = db.prepare("insert into turns values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
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

  private result<T>(data: T, providers: Array<ConvosProvider | undefined>, key: keyof ReturnType<typeof capabilitiesForProvider>): QueryResult<T> {
    return {
      data,
      support: supportFor(providers, key),
      warnings: this.warnings,
      provenance: this.provenance
    };
  }

  private providers(): ConvosProvider[] {
    return [...new Set(this.events.map((event) => event.provider))];
  }

  private scopedEvents(query: { conversationId?: string; turnId?: string }): AnnotatedEvent[] {
    const events = query.conversationId ? this.eventsByConversation.get(query.conversationId) || [] : this.annotatedEvents;
    return query.turnId ? events.filter((event) => event.effectiveTurnId === query.turnId) : events;
  }

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
        schema: "convos.turn.v1" as const,
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

function annotateTurns(events: ConvosJsonlLineV1[]): AnnotatedEvent[] {
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

function supportFor(providers: Array<ConvosProvider | undefined>, key: keyof ReturnType<typeof capabilitiesForProvider>): QuerySupport {
  const present = [...new Set(providers.filter(Boolean) as ConvosProvider[])];
  const providerCoverage = Object.fromEntries(
    present.map((provider) => [provider, capabilitiesForProvider(provider)[key]])
  );
  const statuses = Object.values(providerCoverage).map((entry) => entry.status);
  const status = statuses.includes("unsupported") ? (statuses.length === 1 ? "unsupported" : "partial") : statuses.includes("partial") ? "partial" : "supported";
  return { status, providerCoverage };
}

function compareEvents(a: ConvosJsonlLineV1, b: ConvosJsonlLineV1): number {
  return (a.observed_at || a.recorded_at).localeCompare(b.observed_at || b.recorded_at) || a.recorded_at.localeCompare(b.recorded_at);
}

function sourceKey(provider: ConvosProvider, sessionId: string | undefined, conversationId: string, turnId: string): string {
  return `${provider}:${sessionId || conversationId.split(":").slice(1).join(":") || "unknown"}:${turnId}`;
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const rows = map.get(key) || [];
  rows.push(value);
  map.set(key, rows);
}

function eventDate(event: ConvosJsonlLineV1): Date {
  return new Date(event.observed_at || event.recorded_at);
}

function turnBucketDate(row: TurnListItem, bucketBy: "turnEndedAt" | "turnStartedAt" | "lastActivityAt"): Date | undefined {
  if (bucketBy === "turnStartedAt") return row.startedAt || row.lastActivityAt || row.endedAt;
  if (bucketBy === "lastActivityAt") return row.lastActivityAt || row.endedAt || row.startedAt;
  return row.endedAt || row.lastActivityAt || row.startedAt;
}

function datePart(date: Date | undefined): string | undefined {
  return date?.toISOString().slice(0, 10);
}

function inRange(date: Date | undefined, from?: Date, to?: Date): boolean {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function providerForConversation(events: ConvosJsonlLineV1[], conversationId: string): ConvosProvider | undefined {
  return events.find((event) => event.conversation.id === conversationId)?.provider;
}

function providersForEvents(events: ConvosJsonlLineV1[]): ConvosProvider[] {
  return [...new Set(events.map((event) => event.provider))];
}

function dataField(data: unknown, key: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
}

function dataString(data: unknown, key: string): string | undefined {
  const value = dataField(data, key);
  return typeof value === "string" ? value : undefined;
}

function dataNumber(data: unknown, key: string): number | undefined {
  const value = dataField(data, key);
  return typeof value === "number" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sourceOf(event: ConvosJsonlLineV1): "native" | "hook" | "best-effort" {
  if (event.capture.source === "hook") return "hook";
  if (event.capture.source === "native-import") return "best-effort";
  return "native";
}

function turnStatus(end: AnnotatedEvent | undefined): TurnListItem["status"] {
  if (!end) return "active";
  const status = dataString(end.data, "status");
  if (status === "completed" || status === "failed") return status;
  return "unknown";
}

function titlePreview(events: AnnotatedEvent[]): string | undefined {
  const prompt = events.find((event) => event.kind === "message.user");
  const text = prompt ? dataString(prompt.data, "text") || dataString(prompt.data, "text_preview") : undefined;
  return text ? previewUnknown(text, 100) : undefined;
}

function captureConfidence(events: AnnotatedEvent[]): TurnListItem["captureConfidence"] {
  if (events.some((event) => event.capture.source === "native-import")) return "best-effort";
  if (events.some((event) => event.availability?.confidence === "partial" || event.capture.confidence === "partial")) return "partial";
  return "exact";
}

function fingerprint(events: AnnotatedEvent[]): string {
  return createHash("sha256").update(JSON.stringify({
    ids: events.map((event) => event.event_id),
    count: events.length,
    latest: events.at(-1)?.recorded_at,
    version: "turn-input.v1"
  })).digest("hex").slice(0, 16);
}

function pathsForEvent(event: ConvosJsonlLineV1): string[] {
  const values = [
    dataField(event.data, "path"),
    dataField(event.data, "file"),
    dataField(event.data, "target_path"),
    dataField(event.data, "targetPaths"),
    dataField(event.data, "target_paths")
  ];
  return values.flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string");
}

function eventSummary(event: ConvosJsonlLineV1): string {
  if (event.kind === "message.user" || event.kind === "message.assistant.visible") return previewUnknown(dataString(event.data, "text") || dataString(event.data, "text_preview"), 120);
  if (event.kind === "tool.call" || event.kind === "tool.result") return [dataString(event.data, "tool_name"), dataString(event.data, "status")].filter(Boolean).join(" ");
  if (event.kind === "compact.post") return previewUnknown(dataString(event.data, "compact_summary") || dataString(event.data, "summary"), 120);
  return event.kind;
}

function previewUnknown(value: unknown, max = 240): string {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function aggregateUsage(events: ConvosJsonlLineV1[], by?: "model"): unknown[] {
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

function iso(date: Date | undefined): string | undefined {
  return date?.toISOString();
}
