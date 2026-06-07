import type { ConvosJsonlLineV1, ConvosProvider, QueryResult, QuerySupport } from "./schema/convos-jsonl-v1.js";
import { capabilitiesForProvider } from "./schema/capabilities.js";

export type ConversationListItem = {
  id: string;
  provider: ConvosProvider;
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
};

export class ConvosDataset {
  readonly events: ConvosJsonlLineV1[];
  readonly warnings: { code: string; message: string; path?: string }[];

  constructor(events: ConvosJsonlLineV1[], warnings: { code: string; message: string; path?: string }[] = []) {
    this.events = [...events].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
    this.warnings = warnings;
  }

  conversations = {
    startedBetween: (range: { from?: Date; to?: Date }): QueryResult<ConversationListItem[]> => {
      const rows = this.conversationRows().filter((row) => inRange(row.startedAt, range.from, range.to));
      return { data: rows, support: supportFor(this.providers(), "conversations"), warnings: this.warnings };
    },
    endedBetween: (range: { from?: Date; to?: Date }): QueryResult<ConversationListItem[]> => {
      const rows = this.conversationRows().filter((row) => inRange(row.endedAt, range.from, range.to));
      return { data: rows, support: supportFor(this.providers(), "conversations"), warnings: this.warnings };
    },
    all: (): QueryResult<ConversationListItem[]> => ({
      data: this.conversationRows(),
      support: supportFor(this.providers(), "conversations"),
      warnings: this.warnings
    })
  };

  messages = {
    visible: ({ conversationId }: { conversationId: string }): QueryResult<VisibleMessage[]> => {
      const data = this.events
        .filter((event) => event.conversation.id === conversationId)
        .filter((event) => event.kind === "message.user" || event.kind === "message.assistant.visible")
        .map((event) => ({
          id: event.event_id,
          provider: event.provider,
          conversationId: event.conversation.id,
          turnId: event.turn?.id,
          role: event.kind === "message.user" ? "user" as const : "assistant" as const,
          text: dataString(event.data, "text") || dataString(event.data, "delta"),
          textPreview: dataString(event.data, "text_preview"),
          createdAt: new Date(event.observed_at || event.recorded_at),
          model: event.actor?.model,
          confidence: event.availability?.confidence || "unknown",
          source: sourceOf(event)
        }));
      return { data, support: supportFor([providerForConversation(this.events, conversationId)], "messages.visible"), warnings: this.warnings };
    },
    internal: ({ conversationId }: { conversationId: string }): QueryResult<unknown[]> => ({
      data: this.events.filter((event) => event.conversation.id === conversationId && event.kind === "message.assistant.internal"),
      support: supportFor([providerForConversation(this.events, conversationId)], "messages.internal"),
      warnings: this.warnings
    })
  };

  tools = {
    calls: ({ conversationId, includeResults = true }: { conversationId: string; includeResults?: boolean }): QueryResult<ToolCallWithResult[]> => {
      const calls = this.events.filter((event) => event.conversation.id === conversationId && event.kind === "tool.call");
      const results = this.events.filter((event) => event.conversation.id === conversationId && event.kind === "tool.result");
      const data = calls.map((call) => {
        const result = includeResults ? results.find((row) => row.links?.tool_call_id && row.links.tool_call_id === call.links?.tool_call_id) : undefined;
        return {
          id: call.links?.tool_call_id || call.event_id,
          provider: call.provider,
          conversationId: call.conversation.id,
          turnId: call.turn?.id,
          toolName: dataString(call.data, "tool_name") || "unknown",
          category: dataString(call.data, "category") || "other",
          input: dataField(call.data, "input"),
          result: result ? { status: (dataString(result.data, "status") as "success" | "error" | "unknown") || "unknown", output: dataField(result.data, "output") } : undefined,
          targetPaths: Array.isArray(dataField(call.data, "target_paths")) ? dataField(call.data, "target_paths") as string[] : [],
          model: call.actor?.model,
          confidence: call.availability?.confidence || "unknown"
        };
      });
      return { data, support: supportFor([providerForConversation(this.events, conversationId)], "tools.calls"), warnings: this.warnings };
    }
  };

  tokens = {
    byConversation: ({ conversationId }: { conversationId: string }): QueryResult<unknown[]> => ({
      data: aggregateUsage(this.events.filter((event) => event.conversation.id === conversationId)),
      support: supportFor([providerForConversation(this.events, conversationId)], "tokens.byConversation"),
      warnings: this.warnings
    }),
    byModel: ({ conversationId }: { conversationId: string }): QueryResult<unknown[]> => ({
      data: aggregateUsage(this.events.filter((event) => event.conversation.id === conversationId), "model"),
      support: supportFor([providerForConversation(this.events, conversationId)], "tokens.byModel"),
      warnings: this.warnings
    }),
    perToolCall: ({ conversationId }: { conversationId: string }): QueryResult<unknown[]> => ({
      data: [],
      support: supportFor([providerForConversation(this.events, conversationId)], "tokens.perToolCall"),
      warnings: this.warnings
    })
  };

  capabilities = {
    forProvider: (provider: ConvosProvider) => capabilitiesForProvider(provider),
    forQuery: (query: keyof ReturnType<typeof capabilitiesForProvider>) => supportFor(this.providers(), query)
  };

  private providers(): ConvosProvider[] {
    return [...new Set(this.events.map((event) => event.provider))];
  }

  private conversationRows(): ConversationListItem[] {
    const byId = new Map<string, ConvosJsonlLineV1[]>();
    for (const event of this.events) {
      const existing = byId.get(event.conversation.id) || [];
      existing.push(event);
      byId.set(event.conversation.id, existing);
    }
    return [...byId.entries()].map(([id, events]) => {
      const start = events.find((event) => event.kind === "conversation.start") || events[0];
      const end = [...events].reverse().find((event) => event.kind === "conversation.end");
      const firstPrompt = events.find((event) => event.kind === "message.user");
      return {
        id,
        provider: events[0]!.provider,
        startedAt: start ? new Date(start.observed_at || start.recorded_at) : undefined,
        endedAt: end ? new Date(end.observed_at || end.recorded_at) : undefined,
        firstPrompt: firstPrompt ? dataString(firstPrompt.data, "text") || dataString(firstPrompt.data, "text_preview") : undefined,
        cwd: start?.repo.cwd,
        gitBranch: start?.repo.git?.branch,
        confidence: {
          startedAt: start?.availability?.confidence || "derived",
          endedAt: end?.availability?.confidence || "unknown"
        }
      };
    });
  }
}

function supportFor(providers: Array<ConvosProvider | undefined>, key: keyof ReturnType<typeof capabilitiesForProvider>): QuerySupport {
  const present = providers.filter(Boolean) as ConvosProvider[];
  const providerCoverage = Object.fromEntries(
    present.map((provider) => [provider, capabilitiesForProvider(provider)[key]])
  );
  const statuses = Object.values(providerCoverage).map((entry) => entry.status);
  const status = statuses.includes("unsupported") ? (statuses.length === 1 ? "unsupported" : "partial") : statuses.includes("partial") ? "partial" : "supported";
  return { status, providerCoverage };
}

function providerForConversation(events: ConvosJsonlLineV1[], conversationId: string): ConvosProvider | undefined {
  return events.find((event) => event.conversation.id === conversationId)?.provider;
}

function dataField(data: unknown, key: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
}

function dataString(data: unknown, key: string): string | undefined {
  const value = dataField(data, key);
  return typeof value === "string" ? value : undefined;
}

function sourceOf(event: ConvosJsonlLineV1): "native" | "hook" | "best-effort" {
  if (event.capture.source === "hook") return "hook";
  if (event.capture.source === "provider-native-transcript-best-effort") return "best-effort";
  return "native";
}

function inRange(date: Date | undefined, from?: Date, to?: Date): boolean {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
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
