import { UsageError, type UsageResult } from "../schema/index.js";

export type Range<T> = {
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  eq?: T;
};

export type UsageWhere = {
  provider?: string | string[];
  sessionId?: string | string[];
  conversationId?: string | string[];
  turnId?: string | string[];
  stepKind?: string | string[];
  kind?: string | string[];
  role?: string | string[];
  model?: string | string[];
  toolName?: string | string[];
  status?: string | string[];
  createdAt?: Range<string | Date>;
  startedAt?: Range<string | Date>;
  endedAt?: Range<string | Date>;
  textChars?: Range<number>;
  tokensTotal?: Range<number>;
  durationMs?: Range<number>;
  textIncludes?: string;
  targetPathIncludes?: string;
  and?: UsageWhere[];
  or?: UsageWhere[];
  not?: UsageWhere;
};

export type UsageOrderBy = {
  field: string;
  direction?: "asc" | "desc";
};

export type UsageListQuery = {
  where?: UsageWhere;
  orderBy?: UsageOrderBy[];
  limit?: number;
  cursor?: string;
  strict?: boolean;
};

export type SessionQuery = UsageListQuery & {
  provider?: string | string[];
  from?: Date | string;
  to?: Date | string;
};

export type GetSessionOptions = {
  strict?: boolean;
};

export type SessionReportOptions = {
  includeTools?: boolean;
  includeMessages?: boolean;
};

export type MessageQuery = UsageListQuery;

export type MessageSearchQuery = {
  text: string;
  where?: UsageWhere;
  limit?: number;
};

export type StepQuery = UsageListQuery;

export type StepTimelineQuery = TimelineOptions & {
  sessionId?: string;
  where?: UsageWhere;
};

export type UsageScope = {
  sessionId?: string;
  conversationId?: string;
  provider?: string | string[];
  from?: Date | string;
  to?: Date | string;
};

export type UsageMetricSpec =
  | "count"
  | "durationMs.sum"
  | "selfDurationMs.sum"
  | "tokens.input.sum"
  | "tokens.output.sum"
  | "tokens.total.sum"
  | "tokens.cacheRead.sum"
  | "tokens.cacheCreation.sum"
  | "tokens.reasoning.sum"
  | "cost.amount.sum"
  | "messages.count"
  | "tools.count";

export type UsageDimension =
  | "provider"
  | "model"
  | "sessionId"
  | "turnId"
  | "step.kind"
  | "step.category"
  | "tool.name"
  | "tool.category"
  | "actor.role"
  | "status"
  | "date"
  | "hour";

export type AggregateQuery = {
  scope?: UsageScope;
  where?: UsageWhere;
  groupBy?: UsageDimension[];
  metrics: UsageMetricSpec[];
};

export type SeriesQuery = AggregateQuery & {
  bucket: "hour" | "day";
};

export type HistogramQuery = {
  scope?: UsageScope;
  where?: UsageWhere;
  metric: UsageMetricSpec;
  buckets?: number;
};

export type UsageAggregateRow = {
  dimensions: Record<string, string | number | undefined>;
  metrics: Record<string, number>;
};

export type UsageAggregateTable = {
  schema: "tangent.usage.aggregate.v1";
  rows: UsageAggregateRow[];
  totals: Record<string, number>;
};

export type UsageSeries = {
  schema: "tangent.usage.series.v1";
  bucket: "hour" | "day";
  rows: UsageAggregateRow[];
};

export type UsageHistogram = {
  schema: "tangent.usage.histogram.v1";
  metric: string;
  buckets: Array<{ min: number; max: number; count: number }>;
};

export type TimelineOptions = {
  metric?: "durationMs" | "selfDurationMs" | "tokens.total" | "tokens.input" | "tokens.output" | "cost.amount";
  includeKinds?: string[];
  excludeKinds?: string[];
  nesting?: "flat" | "tree";
  bucketBy?: "kind" | "category" | "provider" | "model" | "toolName" | "status";
  sort?: "time" | "metric-desc";
  chart?: "vega-lite";
};

export type UsageTimelineItem<TStep = unknown> = TStep & {
  depth: number;
  offsetMs?: number;
  widthMs?: number;
  metricValue?: number;
  metricShare?: number;
};

export type UsageTimeline<TStep = unknown> = {
  schema: "tangent.usage.timeline.v1";
  sessionId?: string;
  metric: string;
  unit: "ms" | "tokens" | "usd" | "count";
  range: { startedAt?: string; endedAt?: string; durationMs?: number };
  items: Array<UsageTimelineItem<TStep>>;
  totals: UsageAggregateTable;
  caveats: string[];
  chart?: unknown;
};

export type QueryPage<T> = {
  rows: T[];
  nextCursor?: string;
  hasMore: boolean;
};

const whereKeys = new Set([
  "provider",
  "sessionId",
  "conversationId",
  "turnId",
  "stepKind",
  "kind",
  "role",
  "model",
  "toolName",
  "status",
  "createdAt",
  "startedAt",
  "endedAt",
  "textChars",
  "tokensTotal",
  "durationMs",
  "textIncludes",
  "targetPathIncludes",
  "and",
  "or",
  "not"
]);

export function queryRows<T extends Record<string, unknown>>(rows: T[], query: UsageListQuery = {}): QueryPage<T> {
  const strict = query.strict !== false;
  if (strict) validateWhere(query.where);
  const filtered = rows.filter((row) => matchesWhere(row, query.where));
  const sorted = sortRows(filtered, query.orderBy);
  const cursor = decodeCursor(query.cursor);
  const afterCursor = cursor ? sorted.filter((row) => compareCursor(row, cursor, query.orderBy) > 0) : sorted;
  const limit = normalizeLimit(query.limit);
  const pageRows = afterCursor.slice(0, limit);
  const hasMore = afterCursor.length > limit;
  return {
    rows: pageRows,
    hasMore,
    nextCursor: hasMore ? encodeCursor(pageRows.at(-1), query.orderBy) : undefined
  };
}

export function matchesWhere(row: Record<string, unknown>, where: UsageWhere | undefined): boolean {
  if (!where) return true;
  if (where.and?.some((child) => !matchesWhere(row, child))) return false;
  if (where.or?.length && !where.or.some((child) => matchesWhere(row, child))) return false;
  if (where.not && matchesWhere(row, where.not)) return false;

  if (!matchValue(row, "provider", where.provider)) return false;
  if (!matchValue(row, "sessionId", where.sessionId ?? where.conversationId)) return false;
  if (!matchValue(row, "turnId", where.turnId)) return false;
  if (!matchValue(row, "kind", where.stepKind ?? where.kind)) return false;
  if (!matchValue(row, "role", where.role)) return false;
  if (!matchValue(row, "model", where.model)) return false;
  if (!matchValue(row, "toolName", where.toolName)) return false;
  if (!matchValue(row, "status", where.status)) return false;
  if (!matchRange(dateComparable(valueAt(row, "createdAt")), dateRange(where.createdAt))) return false;
  if (!matchRange(dateComparable(valueAt(row, "startedAt")), dateRange(where.startedAt))) return false;
  if (!matchRange(dateComparable(valueAt(row, "endedAt")), dateRange(where.endedAt))) return false;
  if (!matchRange(numberValue(valueAt(row, "textChars")), where.textChars)) return false;
  if (!matchRange(numberValue(valueAt(row, "metrics.tokens.total")) ?? numberValue(valueAt(row, "tokenUsage.total")), where.tokensTotal)) return false;
  if (!matchRange(numberValue(valueAt(row, "durationMs")) ?? numberValue(valueAt(row, "metrics.durationMs")), where.durationMs)) return false;
  if (where.textIncludes && !stringIncludes(valueAt(row, "text") ?? valueAt(row, "textPreview"), where.textIncludes)) return false;
  if (where.targetPathIncludes && !targetIncludes(valueAt(row, "targetPaths"), where.targetPathIncludes)) return false;
  return true;
}

export function aggregateRows(rows: Array<Record<string, unknown>>, query: AggregateQuery): UsageAggregateTable {
  validateWhere(query.where);
  const scoped = rows.filter((row) => matchesScope(row, query.scope)).filter((row) => matchesWhere(row, query.where));
  const groupBy = query.groupBy || [];
  const grouped = new Map<string, UsageAggregateRow>();
  const totals = Object.fromEntries(query.metrics.map((metric) => [metric, 0])) as Record<string, number>;
  for (const row of scoped) {
    const dimensions = Object.fromEntries(groupBy.map((dimension) => [dimension, dimensionValue(row, dimension)]));
    const key = JSON.stringify(dimensions);
    const current = grouped.get(key) || { dimensions, metrics: Object.fromEntries(query.metrics.map((metric) => [metric, 0])) };
    for (const metric of query.metrics) {
      const value = metricValue(row, metric);
      current.metrics[metric] = (current.metrics[metric] || 0) + value;
      totals[metric] = (totals[metric] || 0) + value;
    }
    grouped.set(key, current);
  }
  return {
    schema: "tangent.usage.aggregate.v1",
    rows: [...grouped.values()],
    totals
  };
}

export function resultMeta<T>(
  data: T,
  args: {
    schema: string;
    query: unknown;
    warnings?: UsageResult<T>["meta"]["warnings"];
    sources?: UsageResult<T>["meta"]["provenance"]["sources"];
    events?: number;
    index?: UsageResult<T>["meta"]["provenance"]["index"];
    page?: UsageResult<T>["meta"]["page"];
    support?: UsageResult<T>["meta"]["support"];
  }
): UsageResult<T> {
  return {
    data,
    meta: {
      schema: args.schema,
      generatedAt: new Date().toISOString(),
      query: args.query ?? {},
      page: args.page,
      support: args.support || { confidence: "unknown", missing: [], notes: [], providerCoverage: {} },
      warnings: args.warnings || [],
      provenance: {
        sources: args.sources || [],
        events: args.events || 0,
        index: args.index
      }
    }
  };
}

export function normalizeScopeWhere(scope: UsageScope | undefined): UsageWhere | undefined {
  if (!scope) return undefined;
  return {
    provider: scope.provider,
    sessionId: scope.sessionId ?? scope.conversationId,
    startedAt: rangeFromDates(scope.from, scope.to)
  };
}

function matchesScope(row: Record<string, unknown>, scope: UsageScope | undefined): boolean {
  return matchesWhere(row, normalizeScopeWhere(scope));
}

function validateWhere(where: UsageWhere | undefined): void {
  if (!where) return;
  for (const key of Object.keys(where)) {
    if (!whereKeys.has(key)) throw new UsageError("USAGE_INVALID_QUERY", `Unknown usage query field: ${key}`, { details: { field: key }, retryable: false });
  }
  for (const child of where.and || []) validateWhere(child);
  for (const child of where.or || []) validateWhere(child);
  if (where.not) validateWhere(where.not);
}

function sortRows<T extends Record<string, unknown>>(rows: T[], orderBy: UsageOrderBy[] | undefined): T[] {
  const ordering = orderBy?.length ? orderBy : [{ field: "startedAt", direction: "asc" as const }, { field: "createdAt", direction: "asc" as const }, { field: "id", direction: "asc" as const }];
  return [...rows].sort((left, right) => {
    for (const order of ordering) {
      const direction = order.direction === "desc" ? -1 : 1;
      const compared = compareUnknown(valueAt(left, order.field), valueAt(right, order.field));
      if (compared) return compared * direction;
    }
    return compareUnknown(valueAt(left, "id"), valueAt(right, "id"));
  });
}

function compareUnknown(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function encodeCursor(row: Record<string, unknown> | undefined, orderBy: UsageOrderBy[] | undefined): string | undefined {
  if (!row) return undefined;
  const fields = [...(orderBy || []), { field: "id", direction: "asc" as const }];
  return Buffer.from(JSON.stringify(fields.map((field) => [field.field, valueAt(row, field.field)])), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): Array<[string, unknown]> | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    return Array.isArray(value) ? value.filter((item): item is [string, unknown] => Array.isArray(item) && typeof item[0] === "string") : undefined;
  } catch {
    throw new UsageError("USAGE_INVALID_QUERY", "Invalid usage query cursor.", { details: { cursor }, retryable: false });
  }
}

function compareCursor(row: Record<string, unknown>, cursor: Array<[string, unknown]>, orderBy: UsageOrderBy[] | undefined): number {
  const fields = [...(orderBy || []), { field: "id", direction: "asc" as const }];
  for (const field of fields) {
    const cursorValue = cursor.find(([key]) => key === field.field)?.[1];
    const direction = field.direction === "desc" ? -1 : 1;
    const compared = compareUnknown(valueAt(row, field.field), cursorValue) * direction;
    if (compared) return compared;
  }
  return 0;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 1000;
  if (!Number.isInteger(limit) || limit < 0) throw new UsageError("USAGE_INVALID_QUERY", "Query limit must be a non-negative integer.", { details: { limit }, retryable: false });
  return limit;
}

function matchValue(row: Record<string, unknown>, field: string, expected: string | string[] | undefined): boolean {
  if (expected === undefined) return true;
  const actual = valueAt(row, field);
  const values = Array.isArray(expected) ? expected : [expected];
  return values.includes(String(actual));
}

function matchRange<T extends number | string>(actual: T | undefined, range: Range<T> | undefined): boolean {
  if (!range) return true;
  if (actual === undefined) return false;
  if (range.eq !== undefined && actual !== range.eq) return false;
  if (range.gt !== undefined && actual <= range.gt) return false;
  if (range.gte !== undefined && actual < range.gte) return false;
  if (range.lt !== undefined && actual >= range.lt) return false;
  if (range.lte !== undefined && actual > range.lte) return false;
  return true;
}

function dateRange(range: Range<string | Date> | undefined): Range<string> | undefined {
  if (!range) return undefined;
  return Object.fromEntries(Object.entries(range).map(([key, value]) => [key, dateComparable(value)])) as Range<string>;
}

function rangeFromDates(from: Date | string | undefined, to: Date | string | undefined): Range<string> | undefined {
  if (!from && !to) return undefined;
  return {
    gte: from ? dateComparable(from) : undefined,
    lte: to ? dateComparable(to) : undefined
  };
}

function dateComparable(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

function valueAt(row: Record<string, unknown>, path: string): unknown {
  const aliases: Record<string, string> = {
    kind: "kind",
    "step.kind": "kind",
    "tool.name": "toolName",
    "tool.category": "category",
    "actor.role": "actor.role",
    tokensTotal: "metrics.tokens.total",
    durationMs: "durationMs"
  };
  const actualPath = aliases[path] || path;
  let current: unknown = row;
  for (const part of actualPath.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringIncludes(value: unknown, needle: string): boolean {
  return typeof value === "string" && value.toLowerCase().includes(needle.toLowerCase());
}

function targetIncludes(value: unknown, needle: string): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.includes(needle));
}

function dimensionValue(row: Record<string, unknown>, dimension: UsageDimension): string | number | undefined {
  if (dimension === "date") return stringPrefix(valueAt(row, "startedAt") ?? valueAt(row, "createdAt"), 10);
  if (dimension === "hour") return stringPrefix(valueAt(row, "startedAt") ?? valueAt(row, "createdAt"), 13);
  return valueAt(row, dimension) as string | number | undefined;
}

function metricValue(row: Record<string, unknown>, metric: UsageMetricSpec): number {
  if (metric === "count") return 1;
  if (metric === "messages.count") return valueAt(row, "role") ? 1 : 0;
  if (metric === "tools.count") return valueAt(row, "toolName") ? 1 : 0;
  if (metric === "durationMs.sum") return numberValue(valueAt(row, "durationMs")) ?? numberValue(valueAt(row, "metrics.durationMs")) ?? 0;
  if (metric === "selfDurationMs.sum") return numberValue(valueAt(row, "selfDurationMs")) ?? numberValue(valueAt(row, "metrics.selfDurationMs")) ?? 0;
  if (metric === "tokens.input.sum") return numberValue(valueAt(row, "metrics.tokens.input")) ?? numberValue(valueAt(row, "tokenUsage.input")) ?? 0;
  if (metric === "tokens.output.sum") return numberValue(valueAt(row, "metrics.tokens.output")) ?? numberValue(valueAt(row, "tokenUsage.output")) ?? 0;
  if (metric === "tokens.total.sum") return numberValue(valueAt(row, "metrics.tokens.total")) ?? numberValue(valueAt(row, "tokenUsage.total")) ?? 0;
  if (metric === "tokens.cacheRead.sum") return numberValue(valueAt(row, "metrics.tokens.cacheRead")) ?? numberValue(valueAt(row, "tokenUsage.cacheRead")) ?? 0;
  if (metric === "tokens.cacheCreation.sum") return numberValue(valueAt(row, "metrics.tokens.cacheCreation")) ?? numberValue(valueAt(row, "tokenUsage.cacheCreation")) ?? 0;
  if (metric === "tokens.reasoning.sum") return numberValue(valueAt(row, "metrics.tokens.reasoning")) ?? numberValue(valueAt(row, "tokenUsage.reasoning")) ?? 0;
  if (metric === "cost.amount.sum") return numberValue(valueAt(row, "metrics.cost.amount")) ?? 0;
  return 0;
}

function stringPrefix(value: unknown, length: number): string | undefined {
  return typeof value === "string" ? value.slice(0, length) : undefined;
}
