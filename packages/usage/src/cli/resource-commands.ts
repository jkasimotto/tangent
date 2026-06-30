import { numberArg, stringArg, stringsArg, type Args } from "@tangent/core/cli";

import { openUsageFromSqlite as openUsage, type UsageClient } from "@tangent/usage-index-sqlite/sqlite";
import { ensureUsageIndex, type UsageIndexSource } from "@tangent/usage-index-sqlite/sdk/indexStore";
import { isUsageProvider, usageProviders, type UsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { objectField } from "./human-output.js";

export async function runUsageResourceCommand(args: Args): Promise<boolean> {
  const [command, subcommand] = args._;

  if (command === "index" && subcommand === "rebuild") {
    printData(await ensureUsageIndex({
      repo: args._[2] || ".",
      providers: legacyProviderList(args.provider),
      sources: sourceList(args.source),
      force: Boolean(args.force)
    }), args);
    return true;
  }

  if (command === "providers" && subcommand === "list") {
    const usage = await openClient(args, args._[2] || ".");
    printResult(await usage.providers.list(), args);
    return true;
  }

  if (command === "providers" && subcommand === "inspect") {
    const usage = await openClient(args, ".");
    printResult(await usage.providers.inspect(requiredValue(args._[2], "A provider id is required.")), args);
    return true;
  }

  if (command === "sessions" && subcommand === "list") {
    const usage = await openClient(args, args._[2] || ".");
    printResult(await usage.sessions.list({
      provider: stringArg(args.provider),
      from: dateArg(args.since),
      to: dateArg(args.until),
      where: stringArg(args.date) ? { startedAt: { gte: `${stringArg(args.date)}T00:00:00.000Z`, lte: `${stringArg(args.date)}T23:59:59.999Z` } } : undefined,
      orderBy: [{ field: "lastActivityAt", direction: "desc" }]
    }), args);
    return true;
  }

  if (command === "sessions" && subcommand === "get") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    printResult(await usage.sessions.get(requiredValue(args._[2], "A session id is required.")), args);
    return true;
  }

  if (command === "sessions" && subcommand === "report") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    printResult(await usage.sessions.report(requiredValue(args._[2], "A session id is required.")), args);
    return true;
  }

  if (command === "sessions" && subcommand === "timeline") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    printResult(await usage.sessions.timeline(requiredValue(args._[2], "A session id is required."), {
      metric: cliMetric(args.metric),
      bucketBy: cliBucket(args.group),
      chart: stringArg(args.format) === "vega-lite" ? "vega-lite" : undefined,
      nesting: "tree"
    }), args);
    return true;
  }

  if (command === "messages" && subcommand === "query") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    printResult(await usage.messages.query({
      where: {
        sessionId: stringArg(args.session),
        role: stringArg(args.role),
        textChars: numberArg(args["min-chars"]) !== undefined ? { gte: numberArg(args["min-chars"])! } : undefined,
        textIncludes: stringArg(args.contains)
      },
      limit: numberArg(args.limit),
      orderBy: [{ field: "createdAt", direction: "desc" }]
    }), args);
    return true;
  }

  if (command === "messages" && subcommand === "search") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    printResult(await usage.messages.search({
      text: requiredValue(args._[2], "A search query is required."),
      limit: numberArg(args.limit),
      where: { provider: stringArg(args.provider) }
    }), args);
    return true;
  }

  if (command === "steps" && subcommand === "query") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    printResult(await usage.steps.query({
      where: {
        sessionId: stringArg(args.session),
        stepKind: stringArg(args.kind)
      },
      orderBy: [cliStepOrder(args.order)],
      limit: numberArg(args.limit)
    }), args);
    return true;
  }

  if (command === "steps" && subcommand === "timeline") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    printResult(await usage.steps.timeline({
      sessionId: stringArg(args.session),
      metric: cliMetric(args.metric),
      nesting: "tree"
    }), args);
    return true;
  }

  if (command === "tools" && subcommand === "query") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    printResult(await usage.tools.query({
      where: {
        sessionId: stringArg(args.session),
        toolName: stringArg(args.name)
      },
      includeResults: includeResultsArg(args["include-results"]),
      limit: numberArg(args.limit)
    }), args);
    return true;
  }

  if (command === "tokens" && subcommand === "summary") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    const by = stringArg(args.by);
    printResult(await usage.tokens.summary({
      scope: { sessionId: stringArg(args.session) },
      groupBy: by === "provider" ? ["provider"] : by === "session" ? ["sessionId"] : by === "step-kind" ? ["step.kind"] : ["model"],
      metrics: ["tokens.input.sum", "tokens.output.sum", "tokens.total.sum", "count"]
    }), args);
    return true;
  }

  if (command === "analytics" && subcommand === "aggregate") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    printResult(await usage.analytics.aggregate({
      scope: { sessionId: stringArg(args.session) },
      groupBy: stringsArg(args.group) as never[],
      metrics: stringsArg(args.metric) as never[]
    }), args);
    return true;
  }

  if (command === "analytics" && subcommand === "series") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    printResult(await usage.analytics.series({
      bucket: stringArg(args.bucket) === "hour" ? "hour" : "day",
      groupBy: stringsArg(args.group) as never[],
      metrics: stringsArg(args.metric) as never[]
    }), args);
    return true;
  }

  if (command === "raw" && subcommand === "events") {
    const usage = await openClient(args, stringArg(args.repo) || ".");
    const result = await usage.raw.events({
      where: {
        sessionId: stringArg(args.session),
        kind: stringArg(args.kind)
      }
    });
    if (args.ndjson) for (const event of result.data) console.log(JSON.stringify(event));
    else printResult(result, args);
    return true;
  }

  return false;
}

async function openClient(args: Args, repo: string): Promise<UsageClient> {
  return openUsage({
    repo,
    providers: providerStrings(args.provider),
    sources: sourceList(args.source),
    index: "auto"
  });
}

function printResult(result: { data: unknown; meta?: unknown }, args: Args): void {
  const format = stringArg(args.format);
  if (args.json || format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (format === "csv") {
    printCsv(Array.isArray(result.data) ? result.data : rowsFromData(result.data));
    return;
  }
  if (format === "vega-lite") {
    const chart = objectField(result.data, "chart");
    console.log(JSON.stringify(chart || result.data, null, 2));
    return;
  }
  console.log(JSON.stringify(result.data, null, 2));
}

function printData(data: unknown, args: Args): void {
  if (args.json || stringArg(args.format) === "json") console.log(JSON.stringify(data, null, 2));
  else console.log(JSON.stringify(data, null, 2));
}

function printCsv(rows: unknown[]): void {
  const flatRows = rows.map((row) => flattenRecord(row));
  const columns = [...new Set(flatRows.flatMap((row) => Object.keys(row)))];
  console.log(columns.join(","));
  for (const row of flatRows) console.log(columns.map((column) => csvCell(row[column])).join(","));
}

function rowsFromData(data: unknown): unknown[] {
  const rows = objectField(data, "rows");
  if (Array.isArray(rows)) return rows;
  const items = objectField(data, "items");
  if (Array.isArray(items)) return items;
  return [data];
}

function flattenRecord(value: unknown, prefix = ""): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { [prefix || "value"]: value };
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) Object.assign(result, flattenRecord(nested, name));
    else result[name] = Array.isArray(nested) ? JSON.stringify(nested) : nested;
  }
  return result;
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[,"\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function cliMetric(value: unknown): "durationMs" | "selfDurationMs" | "tokens.total" | "tokens.input" | "tokens.output" | "cost.amount" | undefined {
  const metric = stringArg(value);
  if (!metric) return undefined;
  if (metric === "duration" || metric === "self-duration") return "selfDurationMs";
  if (metric === "tokens") return "tokens.total";
  if (metric === "cost") return "cost.amount";
  if (metric === "durationMs" || metric === "selfDurationMs" || metric === "tokens.total" || metric === "tokens.input" || metric === "tokens.output" || metric === "cost.amount") return metric;
  throw new Error(`Unsupported timeline metric: ${metric}`);
}

function cliBucket(value: unknown): "kind" | "category" | "provider" | "model" | "toolName" | "status" | undefined {
  const bucket = stringArg(value);
  if (!bucket) return undefined;
  if (bucket === "tool") return "toolName";
  if (bucket === "kind" || bucket === "category" || bucket === "provider" || bucket === "model" || bucket === "toolName" || bucket === "status") return bucket;
  throw new Error(`Unsupported timeline group: ${bucket}`);
}

function cliStepOrder(value: unknown): { field: string; direction: "asc" | "desc" } {
  const order = stringArg(value);
  if (order === "tokens-desc") return { field: "metrics.tokens.total", direction: "desc" };
  if (order === "duration-desc") return { field: "durationMs", direction: "desc" };
  return { field: "startedAt", direction: "asc" };
}

function includeResultsArg(value: unknown): "preview" | "full" | "none" | undefined {
  const mode = stringArg(value);
  if (mode === "preview" || mode === "full" || mode === "none") return mode;
  return value ? "preview" : undefined;
}

function providerStrings(value: unknown): string[] | undefined {
  const raw = stringArg(value);
  if (!raw || raw === "all") return undefined;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function legacyProviderList(value: unknown): UsageProvider[] {
  const raw = providerStrings(value);
  if (!raw) return [...usageProviders];
  return raw.filter(isUsageProvider);
}

function sourceList(value: unknown): UsageIndexSource[] {
  if (value === undefined || value === "native") return ["native"];
  if (value === "all") return ["native", "usage-jsonl"];
  if (value === "usage-jsonl") return ["usage-jsonl"];
  throw new Error("--source must be native, usage-jsonl, or all.");
}

function dateArg(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function requiredValue(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}
