import {
  aggregateRows,
  normalizeScopeWhere,
  queryRows,
  resultMeta,
  type AggregateQuery,
  type HistogramQuery,
  type MessageQuery,
  type MessageSearchQuery,
  type SeriesQuery,
  type SessionQuery,
  type SessionReportOptions,
  type StepQuery,
  type StepTimelineQuery,
  type TimelineOptions,
  type UsageAggregateTable,
  type UsageHistogram,
  type UsageListQuery,
  type UsageSeries,
  type UsageTimeline
} from "../query/index.js";
import {
  UsageError,
  usageAvailability,
  type UsageContentMode,
  type UsageEventV3,
  type UsageMessage,
  type UsageProviderAdapter,
  type UsageProviderCapabilities,
  type UsageResult,
  type UsageSession,
  type UsageSourceKind,
  type UsageSourceRef,
  type UsageStep,
  type UsageToolCall,
  type UsageTurn,
  type UsageWarning
} from "../schema/index.js";
import { eventsToProjections, type UsageProjectionInput, type UsageProjections } from "./projections.js";

export type OpenUsageOptions = {
  repo?: string;
  scope?: "repo" | "all";
  workspace?: string;
  providers?: string[];
  sources?: Array<UsageSourceKind | string>;
  from?: Date | string;
  to?: Date | string;
  timezone?: string;
  contentMode?: UsageContentMode;
  index?: false | "auto" | UsageIndex;
  adapters?: UsageProviderAdapter[];
  includeRaw?: boolean;
  now?: Date;
};

export interface UsageIndex {
  kind: "sqlite" | "memory";
  path?: string;
}

export type UsageSessionReport = {
  schema: "tangent.usage.session_report.v1";
  session: UsageSession;
  messages: Array<UsageMessage & { toolCalls?: UsageToolCall[] }>;
  totals: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    tokens?: UsageSession["metrics"]["tokens"];
  };
  caveats: string[];
};

export type UsageMessageSearchHit = UsageMessage & {
  score: number;
};

export interface UsageSessionApi {
  list(query?: SessionQuery): Promise<UsageResult<UsageSession[]>>;
  get(idOrRef: string, options?: { strict?: boolean }): Promise<UsageResult<UsageSession>>;
  latest(query?: SessionQuery): Promise<UsageResult<UsageSession | undefined>>;
  report(idOrRef: string, options?: SessionReportOptions): Promise<UsageResult<UsageSessionReport>>;
  timeline(idOrRef: string, options?: TimelineOptions): Promise<UsageResult<UsageTimeline<UsageStep>>>;
}

export interface UsageTurnApi {
  query(query?: UsageListQuery): Promise<UsageResult<UsageTurn[]>>;
}

export interface UsageStepApi {
  query(query?: StepQuery): Promise<UsageResult<UsageStep[]>>;
  timeline(query: StepTimelineQuery): Promise<UsageResult<UsageTimeline<UsageStep>>>;
}

export interface UsageMessageApi {
  query(query?: MessageQuery): Promise<UsageResult<UsageMessage[]>>;
  search(query: MessageSearchQuery): Promise<UsageResult<UsageMessageSearchHit[]>>;
}

export interface UsageToolApi {
  query(query?: UsageListQuery & { includeResults?: "preview" | "full" | "none" }): Promise<UsageResult<UsageToolCall[]>>;
}

export interface UsageTokenApi {
  summary(query?: AggregateQuery): Promise<UsageResult<UsageAggregateTable>>;
}

export interface UsageAnalyticsApi {
  aggregate(query: AggregateQuery): Promise<UsageResult<UsageAggregateTable>>;
  series(query: SeriesQuery): Promise<UsageResult<UsageSeries>>;
  histogram(query: HistogramQuery): Promise<UsageResult<UsageHistogram>>;
}

export interface UsageProviderApi {
  list(): Promise<UsageResult<UsageProviderCapabilities[]>>;
  inspect(provider: string): Promise<UsageResult<UsageProviderCapabilities | undefined>>;
}

export interface UsageRawApi {
  events(query?: UsageListQuery): Promise<UsageResult<UsageEventV3[]>>;
  evidence(eventId: string): Promise<UsageResult<UsageEventV3>>;
}

export interface UsageIndexApi {
  kind: "sqlite" | "memory";
  path?: string;
}

export interface UsageClient {
  sessions: UsageSessionApi;
  conversations: UsageSessionApi;
  turns: UsageTurnApi;
  steps: UsageStepApi;
  messages: UsageMessageApi;
  tools: UsageToolApi;
  tokens: UsageTokenApi;
  analytics: UsageAnalyticsApi;
  providers: UsageProviderApi;
  raw: UsageRawApi;
  index?: UsageIndexApi;
}

export async function openUsage(options: OpenUsageOptions = {}): Promise<UsageClient> {
  const loaded = await loadAdapterEvents(options);
  return createUsageClient(eventsToProjections({
    events: loaded.events,
    warnings: loaded.warnings,
    sources: loaded.sources,
    capabilities: loaded.capabilities,
    contentMode: options.contentMode || "metadata-with-excerpts",
    index: { kind: "memory", version: "usage.memory.v1" }
  }));
}

type LoadedAdapterEvents = {
  events: UsageEventV3[];
  warnings: UsageWarning[];
  sources: UsageSourceRef[];
  capabilities: UsageProviderCapabilities[];
};

/** Loads events from caller-provided adapters without depending on built-in providers. */
async function loadAdapterEvents(options: OpenUsageOptions): Promise<LoadedAdapterEvents> {
  const events: UsageEventV3[] = [];
  const warnings: UsageWarning[] = [];
  const sources: UsageSourceRef[] = [];
  const capabilities: UsageProviderCapabilities[] = [];
  for (const adapter of options.adapters || []) {
    capabilities.push(adapter.capabilities());
    if (!adapter.discover) continue;
    for await (const source of adapter.discover({ repo: options.repo, workspace: options.workspace, from: options.from, to: options.to, now: options.now })) {
      sources.push({ id: source.id, provider: source.provider, kind: source.kind, path: source.path, rawHash: source.rawHash });
      for await (const event of adapter.normalize(source, {
        contentMode: options.contentMode || "metadata-with-excerpts",
        includeRaw: options.includeRaw,
        now: options.now
      })) {
        events.push(event);
      }
    }
  }
  return { events, warnings, sources, capabilities };
}

export function createUsageClient(input: UsageProjections | UsageProjectionInput): UsageClient {
  const projections = isProjections(input) ? input : eventsToProjections(input);
  const context = {
    warnings: projections.warnings,
    sources: projections.sources,
    events: projections.rawEvents.length,
    index: projections.index,
    support: usageAvailability({
      confidence: projections.capabilities.length ? "partial" : "unknown",
      providerCoverage: Object.fromEntries(projections.capabilities.flatMap((capability) => Object.entries(capability.fields)))
    })
  };

  const result = <T>(data: T, schema: string, query: unknown, page?: UsageResult<T>["meta"]["page"]): UsageResult<T> => resultMeta(data, {
    schema,
    query,
    page,
    warnings: context.warnings,
    sources: context.sources,
    events: context.events,
    index: context.index,
    support: context.support
  });

  const sessions: UsageSessionApi = {
    list: async (query = {}) => {
      const merged = mergeSessionQuery(query);
      const page = queryRows(projections.sessions as unknown as Array<Record<string, unknown>>, merged);
      return result(page.rows as unknown as UsageSession[], "tangent.usage.sessions.list.v1", query, {
        nextCursor: page.nextCursor,
        hasMore: page.hasMore
      });
    },
    get: async (idOrRef) => {
      const session = resolveSession(projections.sessions, idOrRef);
      return result(session, "tangent.usage.sessions.get.v1", { idOrRef });
    },
    latest: async (query = {}) => {
      const merged = mergeSessionQuery({ ...query, orderBy: query.orderBy || [{ field: "lastActivityAt", direction: "desc" }] });
      const page = queryRows(projections.sessions as unknown as Array<Record<string, unknown>>, { ...merged, limit: 1 });
      return result(page.rows[0] as UsageSession | undefined, "tangent.usage.sessions.latest.v1", query);
    },
    report: async (idOrRef, options = {}) => {
      const session = resolveSession(projections.sessions, idOrRef);
      return result(sessionReport(projections, session, options), "tangent.usage.sessions.report.v1", { idOrRef, options });
    },
    timeline: async (idOrRef, options = {}) => {
      const session = resolveSession(projections.sessions, idOrRef);
      return result(buildTimeline(projections.steps.filter((step) => step.sessionId === session.id), { ...options, sessionId: session.id }), "tangent.usage.sessions.timeline.v1", { idOrRef, options });
    }
  };

  return {
    sessions,
    conversations: sessions,
    turns: {
      query: async (query = {}) => {
        const page = queryRows(projections.turns as unknown as Array<Record<string, unknown>>, query);
        return result(page.rows as unknown as UsageTurn[], "tangent.usage.turns.query.v1", query, {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore
        });
      }
    },
    steps: {
      query: async (query = {}) => {
        const page = queryRows(projections.steps as unknown as Array<Record<string, unknown>>, query);
        return result(page.rows as unknown as UsageStep[], "tangent.usage.steps.query.v1", query, {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore
        });
      },
      timeline: async (query) => {
        const where = query.where || (query.sessionId ? { sessionId: query.sessionId } : undefined);
        const page = queryRows(projections.steps as unknown as Array<Record<string, unknown>>, { where, orderBy: [{ field: "startedAt", direction: "asc" }] });
        return result(buildTimeline(page.rows as unknown as UsageStep[], query), "tangent.usage.steps.timeline.v1", query);
      }
    },
    messages: {
      query: async (query = {}) => {
        const page = queryRows(projections.messages as unknown as Array<Record<string, unknown>>, query);
        return result(page.rows as unknown as UsageMessage[], "tangent.usage.messages.query.v1", query, {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore
        });
      },
      search: async (query) => {
        const needle = query.text.toLowerCase();
        const rows = projections.messages
          .filter((message) => (!query.where || queryRows([message as unknown as Record<string, unknown>], { where: query.where }).rows.length > 0))
          .map((message) => ({ ...message, score: searchScore(message, needle) }))
          .filter((message) => message.score > 0)
          .sort((left, right) => right.score - left.score || (right.createdAt || "").localeCompare(left.createdAt || ""))
          .slice(0, query.limit || 50);
        return result(rows, "tangent.usage.messages.search.v1", query);
      }
    },
    tools: {
      query: async (query = {}) => {
        const page = queryRows(projections.toolCalls as unknown as Array<Record<string, unknown>>, query);
        const rows = page.rows as unknown as UsageToolCall[];
        const data = query.includeResults === "none" ? rows.map((row) => ({ ...row, result: undefined })) : rows;
        return result(data, "tangent.usage.tools.query.v1", query, {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore
        });
      }
    },
    tokens: {
      summary: async (query = { metrics: ["tokens.total.sum"], groupBy: ["model"] }) => {
        const table = aggregateRows(projections.steps as unknown as Array<Record<string, unknown>>, query);
        return result(table, "tangent.usage.tokens.summary.v1", query);
      }
    },
    analytics: {
      aggregate: async (query) => {
        const table = aggregateRows(projections.steps as unknown as Array<Record<string, unknown>>, {
          ...query,
          where: query.where || normalizeScopeWhere(query.scope)
        });
        return result(table, "tangent.usage.analytics.aggregate.v1", query);
      },
      series: async (query) => {
        const table = aggregateRows(projections.steps as unknown as Array<Record<string, unknown>>, {
          ...query,
          groupBy: [...(query.groupBy || []), query.bucket === "hour" ? "hour" : "date"],
          where: query.where || normalizeScopeWhere(query.scope)
        });
        return result({ schema: "tangent.usage.series.v1", bucket: query.bucket, rows: table.rows }, "tangent.usage.analytics.series.v1", query);
      },
      histogram: async (query) => {
        const rows = projections.steps.filter((step) => queryRows([step as unknown as Record<string, unknown>], { where: query.where || normalizeScopeWhere(query.scope) }).rows.length > 0);
        return result(histogram(rows, query), "tangent.usage.analytics.histogram.v1", query);
      }
    },
    providers: {
      list: async () => result(projections.capabilities, "tangent.usage.providers.list.v1", {}),
      inspect: async (provider) => result(projections.capabilities.find((capability) => capability.provider === provider), "tangent.usage.providers.inspect.v1", { provider })
    },
    raw: {
      events: async (query = {}) => {
        const page = queryRows(projections.rawEvents as unknown as Array<Record<string, unknown>>, query);
        return result(page.rows as unknown as UsageEventV3[], "tangent.usage.raw.events.v1", query, {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore
        });
      },
      evidence: async (eventId) => {
        const event = projections.rawEvents.find((row) => row.id === eventId);
        if (!event) throw new UsageError("USAGE_NOT_FOUND", `No usage event found for ${eventId}.`, { details: { eventId }, retryable: false });
        return result(event, "tangent.usage.raw.evidence.v1", { eventId });
      }
    },
    index: projections.index
  };
}

function mergeSessionQuery(query: SessionQuery): UsageListQuery {
  return {
    ...query,
    where: {
      ...query.where,
      provider: query.provider ?? query.where?.provider,
      startedAt: query.where?.startedAt || rangeFromSessionQuery(query)
    }
  };
}

function rangeFromSessionQuery(query: SessionQuery): { gte?: string; lte?: string } | undefined {
  if (!query.from && !query.to) return undefined;
  return {
    gte: query.from instanceof Date ? query.from.toISOString() : query.from,
    lte: query.to instanceof Date ? query.to.toISOString() : query.to
  };
}

function resolveSession(sessions: UsageSession[], idOrRef: string): UsageSession {
  if (idOrRef === "latest") {
    const latest = [...sessions].sort((left, right) => (right.lastActivityAt || right.endedAt || right.startedAt || "").localeCompare(left.lastActivityAt || left.endedAt || left.startedAt || ""))[0];
    if (!latest) throw new UsageError("USAGE_NOT_FOUND", "No usage sessions found.", { retryable: false });
    return latest;
  }
  const matches = sessions.filter((session) => {
    const providerSessionId = session.providerSessionId || session.id.split(":").slice(1).join(":");
    const shortId = `${session.provider}:${providerSessionId.slice(0, 8)}`;
    return idOrRef === session.id ||
      idOrRef === session.providerSessionId ||
      idOrRef === shortId ||
      providerSessionId.startsWith(idOrRef) ||
      idOrRef === `${session.provider}:${providerSessionId}` ||
      idOrRef === `${session.provider}:${providerSessionId.slice(0, idOrRef.split(":").at(1)?.length || 0)}`;
  });
  if (matches.length === 1) return matches[0]!;
  if (!matches.length) throw new UsageError("USAGE_NOT_FOUND", `No usage session found for ${idOrRef}.`, { details: { idOrRef }, retryable: false });
  throw new UsageError("USAGE_AMBIGUOUS_REF", `Usage session ref ${idOrRef} is ambiguous.`, {
    details: { idOrRef, candidates: matches.slice(0, 10).map((session) => session.id) },
    retryable: false
  });
}

function sessionReport(projections: UsageProjections, session: UsageSession, options: SessionReportOptions): UsageSessionReport {
  const messages = projections.messages.filter((message) => message.sessionId === session.id);
  const callsByMessage = new Map<string, UsageToolCall[]>();
  for (const call of projections.toolCalls.filter((call) => call.sessionId === session.id)) {
    const key = call.messageId || "";
    callsByMessage.set(key, [...(callsByMessage.get(key) || []), call]);
  }
  const caveats = [
    ...session.availability.notes,
    ...projections.warnings.map((warning) => warning.message),
    ...projections.steps.filter((step) => step.sessionId === session.id && (step.durationConfidence === "estimated" || step.durationConfidence === "unknown")).map((step) => `${step.label} timing is ${step.durationConfidence}.`)
  ];
  return {
    schema: "tangent.usage.session_report.v1",
    session,
    messages: options.includeMessages === false ? [] : messages.map((message) => ({
      ...message,
      toolCalls: options.includeTools === false ? undefined : callsByMessage.get(message.id) || []
    })),
    totals: {
      userMessages: session.counts.userMessages,
      assistantMessages: session.counts.assistantMessages,
      toolCalls: session.counts.toolCalls,
      tokens: session.metrics.tokens
    },
    caveats: [...new Set(caveats)]
  };
}

function buildTimeline(steps: UsageStep[], options: TimelineOptions & { sessionId?: string }): UsageTimeline<UsageStep> {
  const metric = options.metric || "selfDurationMs";
  const included = steps
    .filter((step) => !options.includeKinds?.length || options.includeKinds.includes(step.kind))
    .filter((step) => !options.excludeKinds?.includes(step.kind));
  const sorted = options.sort === "metric-desc"
    ? [...included].sort((left, right) => metricValue(right, metric) - metricValue(left, metric))
    : [...included].sort((left, right) => (left.startedAt || "").localeCompare(right.startedAt || "") || left.order - right.order);
  const startedAt = sorted.map((step) => step.startedAt).filter(Boolean).sort()[0];
  const endedAt = sorted.map((step) => step.endedAt || step.startedAt).filter(Boolean).sort().at(-1);
  const rangeStart = startedAt ? Date.parse(startedAt) : undefined;
  const totalMetric = sorted.reduce((sum, step) => sum + metricValue(step, metric), 0);
  const parentDepth = depthMap(sorted);
  const items = sorted.map((step) => {
    const value = metricValue(step, metric);
    const item = {
      ...step,
      depth: options.nesting === "flat" ? 0 : parentDepth.get(step.id) || 0,
      offsetMs: rangeStart !== undefined && step.startedAt ? Math.max(0, Date.parse(step.startedAt) - rangeStart) : undefined,
      widthMs: step.durationMs,
      metricValue: value,
      metricShare: totalMetric ? value / totalMetric : undefined
    };
    return item;
  });
  const totals = aggregateRows(sorted as unknown as Array<Record<string, unknown>>, {
    groupBy: [bucketDimension(options.bucketBy || "kind")],
    metrics: ["durationMs.sum", "selfDurationMs.sum", "tokens.total.sum", "cost.amount.sum", "count"]
  });
  const caveats = [
    ...sorted.filter((step) => step.durationConfidence === "estimated" || step.durationConfidence === "unknown").map((step) => `${step.label} timing is ${step.durationConfidence}.`),
    ...(metric.startsWith("tokens") && sorted.every((step) => !step.metrics.tokens) ? ["No token usage was available for this timeline."] : [])
  ];
  return {
    schema: "tangent.usage.timeline.v1",
    sessionId: options.sessionId,
    metric,
    unit: metric.includes("tokens") ? "tokens" : metric.includes("cost") ? "usd" : metric.includes("duration") ? "ms" : "count",
    range: {
      startedAt,
      endedAt,
      durationMs: durationMs(startedAt, endedAt)
    },
    items,
    totals,
    caveats: [...new Set(caveats)],
    chart: options.chart === "vega-lite" ? vegaLiteTimeline(items, metric) : undefined
  };
}

function bucketDimension(bucket: NonNullable<TimelineOptions["bucketBy"]>): "step.kind" | "step.category" | "provider" | "model" | "tool.name" | "status" {
  if (bucket === "kind") return "step.kind";
  if (bucket === "category") return "step.category";
  if (bucket === "toolName") return "tool.name";
  return bucket;
}

function depthMap(steps: UsageStep[]): Map<string, number> {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depthFor = (step: UsageStep): number => {
    if (depths.has(step.id)) return depths.get(step.id)!;
    if (visiting.has(step.id)) {
      depths.set(step.id, 0);
      return 0;
    }
    visiting.add(step.id);
    const parent = step.parentStepId ? byId.get(step.parentStepId) : undefined;
    const depth = parent && parent.id !== step.id ? depthFor(parent) + 1 : 0;
    visiting.delete(step.id);
    depths.set(step.id, depth);
    return depth;
  };
  for (const step of steps) depthFor(step);
  return depths;
}

function metricValue(step: UsageStep, metric: NonNullable<TimelineOptions["metric"]>): number {
  if (metric === "durationMs") return step.durationMs || step.metrics.durationMs || 0;
  if (metric === "selfDurationMs") return step.selfDurationMs || step.metrics.selfDurationMs || 0;
  if (metric === "tokens.input") return step.metrics.tokens?.input || 0;
  if (metric === "tokens.output") return step.metrics.tokens?.output || 0;
  if (metric === "tokens.total") return step.metrics.tokens?.total || 0;
  if (metric === "cost.amount") return step.metrics.cost?.amount || 0;
  return 0;
}

function durationMs(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined;
}

function searchScore(message: UsageMessage, needle: string): number {
  const text = `${message.text || ""}\n${message.textPreview || ""}`.toLowerCase();
  if (!needle) return 0;
  let score = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    score += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return score;
}

function histogram(steps: UsageStep[], query: HistogramQuery): UsageHistogram {
  const metric = query.metric.replace(".sum", "");
  const values = steps.map((step) => metric === "durationMs" ? step.durationMs || 0 : metric === "selfDurationMs" ? step.selfDurationMs || 0 : step.metrics.tokens?.total || 0);
  const max = Math.max(0, ...values);
  const bucketCount = query.buckets || 10;
  const width = max ? max / bucketCount : 1;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({ min: index * width, max: (index + 1) * width, count: 0 }));
  for (const value of values) {
    const bucket = buckets[Math.min(bucketCount - 1, Math.floor(value / width))];
    if (bucket) bucket.count += 1;
  }
  return { schema: "tangent.usage.histogram.v1", metric: query.metric, buckets };
}

function vegaLiteTimeline(items: Array<UsageStep & { metricValue?: number }>, metric: string): unknown {
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    data: {
      values: items.map((item) => ({
        id: item.id,
        label: item.label,
        kind: item.kind,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        value: item.metricValue || 0
      }))
    },
    mark: "bar",
    encoding: {
      y: { field: "label", type: "nominal", sort: null },
      x: { field: "value", type: "quantitative", title: metric },
      color: { field: "kind", type: "nominal" },
      tooltip: [
        { field: "label" },
        { field: "kind" },
        { field: "value", type: "quantitative" },
        { field: "startedAt" },
        { field: "endedAt" }
      ]
    }
  };
}

function isProjections(value: UsageProjections | UsageProjectionInput): value is UsageProjections {
  return (value as UsageProjections).schema === "tangent.usage.projections.v1";
}

function isOptionalSqliteFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /better-sqlite3|Cannot find package|Cannot find module|SQLite unavailable|USAGE_CAPABILITY_UNAVAILABLE/.test(message);
}

export { toUsageEventV3 } from "./event-v3.js";
export { eventsToProjections, type UsageProjections } from "./projections.js";
export type {
  AggregateQuery,
  HistogramQuery,
  MessageQuery,
  MessageSearchQuery,
  SeriesQuery,
  SessionQuery,
  StepQuery,
  TimelineOptions,
  UsageAggregateTable,
  UsageHistogram,
  UsageSeries,
  UsageTimeline
} from "../query/index.js";
export type {
  UsageContentMode,
  UsageEventV3,
  UsageMessage,
  UsageProviderAdapter,
  UsageProviderCapabilities,
  UsageResult,
  UsageSession,
  UsageStep,
  UsageToolCall,
  UsageTurn
} from "../schema/index.js";
