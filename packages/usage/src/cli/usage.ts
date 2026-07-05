import { renderCommandHelp } from "@tangent/core";
import { parseArgs, stringArg } from "@tangent/core/cli";

import { archiveUsageTelemetry, ensureUsageIndex, loadUsageDatasetFromIndex, resolveConversationRef } from "@tangent/usage-index-sqlite/sdk/indexStore";
import { pruneUsageIndex } from "@tangent/usage-index-sqlite/sdk/prune";
import type { UsageIndexSource } from "@tangent/usage-index-sqlite/sdk/indexStore";
import { importNative } from "@tangent/usage-index-sqlite/sdk/importNative";
import { status } from "@tangent/usage-index-sqlite/sdk/status";
import { inspectNativeLogFile } from "@tangent/usage-providers/providers/native/inspect";
import { listNativeSchemas } from "@tangent/usage-providers/providers/native/schema-registry";
import { nativeSchemaStatus } from "@tangent/usage-providers/providers/native/status";
import type { NativeLogInspection, NativeProviderSchemaStatus } from "@tangent/usage-providers/providers/native/types";
import type { UsageDataset, VisibleMessage } from "@tangent/usage-core/core/dataset";
import { isUsageProvider, usageProviders, type UsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { runUsageInsightsCommand } from "./insights.js";
import { runUsageResourceCommand } from "./resource-commands.js";
import { usageCommandSpec } from "./spec.js";
import { usageUiCommand } from "./ui.js";
import {
  formatDatePart,
  formatDateTime,
  formatDuration,
  formatTime,
  numberField,
  objectField,
  printConversationReport,
  preview,
  printToolRows,
  printTranscript,
  quotePreview,
  shortConversationId,
  stringField
} from "./human-output.js";

type SessionRow = {
  id: string;
  shortId: string;
  provider: UsageProvider;
  providerSessionId?: string;
  startedAt?: Date;
  endedAt?: Date;
  lastActivityAt?: Date;
  turns: number;
  toolCalls: number;
  filesTouched: number;
  firstPrompt?: string;
  branch?: string;
  cwd?: string;
};

type UsageRow = {
  provider: UsageProvider;
  model: string;
  conversationId: string;
  usage: unknown;
  source: string;
  confidence: string;
};

/** Runs the Usage CLI dispatcher for normalized telemetry commands. */
export async function runUsageCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv, { repeatable: ["metric", "group"] });
  const [command, subcommand] = args._;

  if (!command || args.help) {
    console.log(renderCommandHelp(usageCommandSpec));
    return;
  }

  if (command === "init") {
    const value = await status({ repo: stringArg(args.repo) || args._[1] || ".", providers: providerList(args.provider || "all").filter((p): p is UsageProvider => p !== "all") });
    if (args.json) console.log(JSON.stringify(value, null, 2));
    else printNativeInit(value);
    return;
  }

  if (command === "status") {
    const value = await status({ repo: args._[1] || ".", providers: providerList(args.provider).filter((p): p is UsageProvider => p !== "all") });
    if (args.json) console.log(JSON.stringify(value, null, 2));
    else printUsageStatus(value, Boolean(args.verbose));
    return;
  }

  if (command === "ui") {
    await usageUiCommand(args);
    return;
  }

  if (command === "insights") {
    await runUsageInsightsCommand(args, subcommand);
    return;
  }

  if (await runUsageResourceCommand(args)) return;

  if (command === "today" || command === "sessions") {
    const repoArg = command === "today" ? args._[1] : args._[1] || ".";
    const date = command === "today" ? todayDate() : stringArg(args.date);
    const sources = sourceList(args.source);
    const dataset = await loadUsageDatasetFromIndex({
      repo: repoArg || ".",
      providers: providerList(args.provider).filter((p): p is UsageProvider => p !== "all"),
      sources,
      since: dateArg(args.since),
      until: dateArg(args.until),
      date
    });
    const rows = sessionRows(dataset, { date, provider: providerArgOrUndefined(args.provider) });
    if (args.json) console.log(JSON.stringify(rows, null, 2));
    else printUsageSessions(rows, date);
    return;
  }

  if (command === "session") {
    const session = requiredSession(args._[1]);
    const repo = stringArg(args.repo) || ".";
    const sources = sourceList(args.source);
    const resolved = await resolveConversationRef({ repo, ref: session, sources });
    const dataset = await loadUsageDatasetFromIndex({ repo, conversationId: resolved.conversationId, sources });
    const rows = sessionRows(dataset).filter((row) => row.id === resolved.conversationId);
    if (!rows.length) throw new Error(`No session found for ${session}.`);
    if (args.json) console.log(JSON.stringify(rows[0], null, 2));
    else printUsageSession(rows[0]!);
    return;
  }

  if (command === "report") {
    const session = requiredSession(args._[1]);
    const repo = stringArg(args.repo) || ".";
    const providers = providerList(args.provider).filter((p): p is UsageProvider => p !== "all");
    const sources = sourceList(args.source);
    const resolved = await resolveConversationRef({ repo, ref: session, providers, sources });
    const dataset = await loadUsageDatasetFromIndex({ repo, conversationId: resolved.conversationId, providers, sources });
    const result = dataset.conversations.report({ conversationId: resolved.conversationId });
    if (args.json) console.log(JSON.stringify(result.data, null, 2));
    else printConversationReport(result.data);
    return;
  }

  if (command === "transcript") {
    const session = requiredSession(args._[1]);
    const repo = stringArg(args.repo) || ".";
    const sources = sourceList(args.source);
    const resolved = await resolveConversationRef({ repo, ref: session, sources });
    const dataset = await loadUsageDatasetFromIndex({ repo, conversationId: resolved.conversationId, sources });
    if (args.internal && !args.json) throw new Error("usage transcript --internal is a machine/debug view; rerun with --json.");
    const result = args.internal
      ? dataset.messages.internal({ conversationId: resolved.conversationId })
      : dataset.messages.visible({ conversationId: resolved.conversationId });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else printTranscript(result.data as VisibleMessage[], resolved);
    return;
  }

  if (command === "tools") {
    const session = requiredSession(args._[1]);
    const repo = stringArg(args.repo) || ".";
    const sources = sourceList(args.source);
    const resolved = await resolveConversationRef({ repo, ref: session, sources });
    const dataset = await loadUsageDatasetFromIndex({ repo, conversationId: resolved.conversationId, sources });
    const result = dataset.tools.calls({
      conversationId: resolved.conversationId,
      includeResults: args["include-results"] ? "preview" : false
    });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else printToolRows(result.data);
    return;
  }

  if (command === "tokens") {
    const repo = stringArg(args.repo) || ".";
    const session = args._[1];
    const providers = providerList(args.provider).filter((p): p is UsageProvider => p !== "all");
    const sources = sourceList(args.source);
    const resolved = session ? await resolveConversationRef({ repo, ref: session, providers, sources }) : undefined;
    const dataset = await loadUsageDatasetFromIndex({
      repo,
      providers,
      sources,
      conversationId: resolved?.conversationId
    });
    if (stringArg(args.by) === "tool") {
      throw new Error("usage tokens --by tool was removed because providers do not report exact per-tool-call token usage.");
    }
    const rows = aggregateUsageEvents(dataset.events, stringArg(args.by), Boolean(args.estimate));
    if (args.json) console.log(JSON.stringify(rows, null, 2));
    else printUsageTokens(rows, providers);
    return;
  }

  if (command === "reindex") {
    const result = await ensureUsageIndex({
      repo: args._[1] || ".",
      providers: providerList(args.provider).filter((p): p is UsageProvider => p !== "all"),
      sources: sourceList(args.source),
      force: Boolean(args.force)
    });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Index: ${result.dbPath}`);
      console.log(`Indexed: ${result.indexed}`);
      console.log(`Skipped: ${result.skipped}`);
      console.log(`Removed: ${result.removed}`);
      for (const warning of result.warnings) console.warn(`warning: ${warning.path || "index"}: ${warning.message}`);
    }
    return;
  }

  if (command === "export") {
    const dataset = await loadUsageDatasetFromIndex({
      repo: args._[1] || ".",
      providers: providerList(args.provider).filter((p): p is UsageProvider => p !== "all"),
      sources: sourceList(args.source),
      since: dateArg(args.since),
      until: dateArg(args.until)
    });
    for (const event of dataset.events) console.log(JSON.stringify(event));
    return;
  }

  if (command === "events") {
    if (!args.json) throw new Error("usage events is a machine/debug command; rerun with --json.");
    const dataset = await loadUsageDatasetFromIndex({
      repo: args._[1] || ".",
      providers: providerList(args.provider).filter((p): p is UsageProvider => p !== "all"),
      sources: sourceList(args.source),
      since: dateArg(args.since),
      until: dateArg(args.until),
      date: stringArg(args.date)
    });
    const rows = dataset.events
      .filter((event) => !args.date || (event.observed_at || event.recorded_at).slice(0, 10) === stringArg(args.date))
      .filter((event) => !args.provider || event.provider === args.provider);
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (command === "messages") {
    if (!args.json) throw new Error("usage messages is a machine/debug command; rerun with --json or use usage transcript.");
    const session = requiredSession(args._[1]);
    const repo = stringArg(args.repo) || ".";
    const sources = sourceList(args.source);
    const resolved = await resolveConversationRef({ repo, ref: session, sources });
    const dataset = await loadUsageDatasetFromIndex({ repo, conversationId: resolved.conversationId, sources });
    const result = args.internal ? dataset.messages.internal({ conversationId: resolved.conversationId }) : dataset.messages.visible({ conversationId: resolved.conversationId });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "native" && subcommand === "schemas") {
    const rows = listNativeSchemas(providerArgOrUndefined(args.provider));
    if (args.json) console.log(JSON.stringify(rows, null, 2));
    else printNativeSchemas(rows);
    return;
  }

  if (command === "native" && subcommand === "inspect") {
    const inspection = await inspectNativeLogFile(requiredPath(args._[2], "usage native inspect requires a path."));
    if (args.json) console.log(JSON.stringify(inspection, null, 2));
    else printNativeInspection(inspection);
    return;
  }

  if (command === "native" && subcommand === "status") {
    const rows = await nativeSchemaStatus({
      repo: args._[2] || ".",
      providers: providerList(args.provider).filter((p): p is UsageProvider => p !== "all")
    });
    if (args.json) console.log(JSON.stringify(rows, null, 2));
    else printNativeSchemaStatuses(rows);
    return;
  }

  if (command === "archive") {
    const before = dateArg(args.before);
    if (!before) throw new Error("usage archive requires --before YYYY-MM-DD.");
    const result = await archiveUsageTelemetry({
      repo: args._[1] || ".",
      providers: providerList(args.provider).filter((p): p is UsageProvider => p !== "all"),
      before,
      dryRun: Boolean(args["dry-run"])
    });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.dryRun ? "Would archive" : "Archived"}: ${result.archived.length}`);
      for (const row of result.archived) console.log(`  ${row.path} -> ${row.archivePath}`);
      for (const row of result.skipped) console.log(`  skipped: ${row.path} (${row.reason})`);
    }
    return;
  }

  if (command === "prune") {
    const before = dateArg(args.before) || daysAgo(numberOr(stringArg(args.days), DEFAULT_RETENTION_DAYS));
    const result = await pruneUsageIndex({
      repo: args._[1] || ".",
      // The global all-projects index is the one that balloons, so prune it by default.
      scope: stringArg(args.scope) === "repo" ? "repo" : "all",
      before,
      dryRun: Boolean(args["dry-run"]),
      vacuum: Boolean(args.vacuum)
    });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Index:   ${result.dbPath} (${result.scope})`);
      console.log(`${result.dryRun ? "Would delete" : "Deleted"} events before ${result.before.slice(0, 10)}: ${result.deletedEvents}`);
      const delta = result.bytesBefore - result.bytesAfter;
      if (result.vacuumed) console.log(`Reclaimed: ${formatBytes(delta)} (${formatBytes(result.bytesBefore)} -> ${formatBytes(result.bytesAfter)})`);
      else if (!result.dryRun) console.log(`Size:      ${formatBytes(result.bytesAfter)} on disk; rerun with --vacuum to reclaim freed space.`);
    }
    return;
  }

  if (command === "import-native") {
    const provider = providerArg(args.provider || "claude");
    if (provider !== "claude") throw new Error("import-native currently supports --provider claude only.");
    const result = await importNative({ repo: args._[1] || ".", provider });
    await ensureUsageIndex({ repo: args._[1] || ".", providers: [provider], sources: ["usage-jsonl"] });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`provider: ${result.provider}`);
      console.log(`files:    ${result.files}`);
      console.log(`imported: ${result.imported}`);
      console.log(`skipped:  ${result.skipped}`);
      for (const warning of result.warnings) console.warn(`warning: ${warning.path}: ${warning.message}`);
    }
    return;
  }

  if (command === "doctor") {
    const started = Date.now();
    const value = await status({ repo: args._[1] || "." });
    const statusMs = Date.now() - started;
    if (args.json) {
      console.log(JSON.stringify(value, null, 2));
      return;
    }
    printUsageStatus(value, true);
    if (args.trace) {
      const indexStarted = Date.now();
      const index = await ensureUsageIndex({ repo: args._[1] || "." });
      console.log("");
      console.log("Trace");
      console.log(JSON.stringify({
        statusMs,
        indexMs: Date.now() - indexStarted,
        indexed: index.indexed,
        skipped: index.skipped,
        sourceFiles: index.sourceFiles.length
      }, null, 2));
    }
    return;
  }

  throw new Error(`Unknown usage command: ${command}`);
}

/** Prints repository capture coverage and provider capability status. */
function printUsageStatus(value: Awaited<ReturnType<typeof status>>, verbose: boolean): void {
  const repoName = value.repo.gitRoot ? value.repo.gitRoot.split("/").at(-1) : value.repo.path.split("/").at(-1);
  console.log(`Repo: ${repoName || value.repo.path} (${value.repo.branch || "unknown"})`);
  console.log(`Index: ${value.index.exists ? `${value.index.sourceFiles} source files` : "missing"}`);
  console.log("");
  console.log("Capture coverage");
  for (const provider of value.providers) {
    const label = provider.provider === "claude" ? "Claude Code" : "Codex";
    console.log(`  ${label}`);
    console.log(`    Native logs: ${provider.nativePaths.length ? `${provider.nativePaths.length} files` : "none"}`);
    console.log(`    Data:        ${provider.capture.lastEvent ? `last seen ${provider.capture.lastEvent}` : "no sessions seen yet"}`);
    console.log(`    Messages:    ${provider.capabilities["messages.visible"].status}`);
    console.log(`    Tool calls:  ${provider.capabilities["tools.calls"].status}`);
    console.log(`    Tool results:${provider.capabilities["tools.results"].status}`);
    console.log(`    Token usage: ${provider.capabilities["tokens.byConversation"].status}`);
    if (verbose) {
      console.log(`    Native logs: ${nativeSchemaSummary(provider.nativeSchema)}`);
      for (const message of provider.nativeSchema.messages) console.log(`      ${message}`);
      for (const [key, support] of Object.entries(provider.capabilities)) {
        console.log(`    ${key}: ${support.status}/${support.source} ${support.notes.join(" ")}`);
      }
    }
  }
}

/** Prints native transcript discovery output for usage init. */
function printNativeInit(value: Awaited<ReturnType<typeof status>>): void {
  console.log(`Repo: ${value.repo.gitRoot || value.repo.path}`);
  for (const provider of value.providers) {
    const label = provider.provider === "claude" ? "Claude Code" : "Codex";
    const availability = provider.nativePaths.length ? `${provider.nativePaths.length} native transcript files found` : "no native transcript files found";
    console.log(`${label}: ${availability}`);
    if (provider.nativeSchema.messages.length) {
      for (const message of provider.nativeSchema.messages) console.log(`  ${message}`);
    }
  }
  console.log("Native transcripts are the usage source of truth. Legacy usage-jsonl files remain readable with --source all.");
}

/** Prints registered native provider schema descriptors. */
function printNativeSchemas(rows: ReturnType<typeof listNativeSchemas>): void {
  console.log("Known native log schemas");
  if (!rows.length) {
    console.log("  No schemas registered.");
    return;
  }
  for (const row of rows) {
    const ranges = row.versionRanges.map((range) => `${range.min || "*"}..${range.max || "*"}`).join(", ");
    console.log(`  ${row.id}  provider=${row.provider}  kind=${row.logKind}  versions=${ranges}`);
    console.log(`    variants: ${row.variants.slice(0, 8).join(", ")}${row.variants.length > 8 ? ", ..." : ""}`);
    for (const note of row.notes) console.log(`    note: ${note}`);
  }
}

/** Prints native provider schema compatibility rows. */
function printNativeSchemaStatuses(rows: NativeProviderSchemaStatus[]): void {
  console.log("Native log schema status");
  for (const row of rows) {
    console.log(`  ${row.provider}: ${nativeSchemaSummary(row)}`);
    for (const message of row.messages) console.log(`    ${message}`);
  }
}

/** Prints a concise summary of one inspected native log file. */
function printNativeInspection(row: NativeLogInspection): void {
  console.log(`Native log: ${row.path}`);
  console.log(`  Provider: ${row.provider || "unknown"}`);
  console.log(`  Kind:     ${row.logKind || "unknown"}`);
  console.log(`  Records:  ${row.recordCount}`);
  console.log(`  Errors:   ${row.parseErrors.length}`);
  if (row.producerHints.versions.length) console.log(`  Versions: ${row.producerHints.versions.join(", ")}`);
  if (row.producerHints.models.length) console.log(`  Models:   ${row.producerHints.models.join(", ")}`);
  if (row.producerHints.origins.length) console.log(`  Origins:  ${row.producerHints.origins.join(", ")}`);
  if (row.producerHints.sources.length) console.log(`  Sources:  ${row.producerHints.sources.join(", ")}`);
  console.log("  Variants:");
  for (const variant of row.variants.slice(0, 20)) console.log(`    ${variant.key}: ${variant.count}`);
  if (row.variants.length > 20) console.log(`    ... ${row.variants.length - 20} more`);
}

/** Formats native schema compatibility into a single terminal line. */
function nativeSchemaSummary(row: NativeProviderSchemaStatus): string {
  if (row.compatibility === "no-native-logs") return "no native logs found";
  const versions = row.observedVersions.length ? row.observedVersions.join(", ") : "version unknown";
  const schemas = row.matchedSchemaIds.length ? ` schema=${row.matchedSchemaIds.join(",")}` : "";
  const parse = row.parseErrors ? ` parseErrors=${row.parseErrors}` : "";
  return `${row.compatibility} files=${row.files} records=${row.records} versions=${versions}${schemas}${parse}`;
}

/** Maps a usage dataset into sorted session rows for CLI output. */
function sessionRows(dataset: UsageDataset, query: { date?: string; provider?: UsageProvider } = {}): SessionRow[] {
  const turns = dataset.turns.list({ provider: query.provider }).data;
  const conversations = dataset.conversations.all().data
    .filter((row) => !query.provider || row.provider === query.provider);
  return conversations.map((conversation) => {
    const conversationTurns = turns.filter((turn) => turn.conversationId === conversation.id);
    const lastActivityAt = latestDate(conversationTurns.map((turn) => turn.lastActivityAt)) || conversation.endedAt || conversation.startedAt;
    const files = new Set(conversationTurns.flatMap((turn) => Array.from({ length: turn.stats.filesTouched }, (_, index) => `${turn.sourceKey}:${index}`)));
    return {
      id: conversation.id,
      shortId: shortConversationId(conversation),
      provider: conversation.provider,
      providerSessionId: conversation.providerSessionId,
      startedAt: conversation.startedAt,
      endedAt: conversation.endedAt,
      lastActivityAt,
      turns: conversationTurns.length || 1,
      toolCalls: sumNumbers(conversationTurns.map((turn) => turn.stats.toolCalls)),
      filesTouched: files.size || sumNumbers(conversationTurns.map((turn) => turn.stats.filesTouched)),
      firstPrompt: conversation.firstPrompt || conversation.title,
      branch: conversation.gitBranch,
      cwd: conversation.cwd
    };
  })
    .filter((row) => !query.date || formatDatePart(row.lastActivityAt || row.startedAt || row.endedAt || new Date(0)) === query.date)
    .sort((a, b) => (b.lastActivityAt?.getTime() || 0) - (a.lastActivityAt?.getTime() || 0));
}

/** Prints a compact session list. */
function printUsageSessions(rows: SessionRow[], date?: string): void {
  console.log(date ? `Sessions for ${date}` : "Sessions");
  if (!rows.length) {
    console.log("  No captured sessions.");
    return;
  }
  for (const row of rows) {
    const at = formatTime(row.lastActivityAt || row.startedAt);
    const duration = formatDuration(row.startedAt, row.endedAt);
    const prompt = row.firstPrompt ? quotePreview(row.firstPrompt, 70) : "(no prompt captured)";
    console.log(`  ${at}  ${row.provider.padEnd(6)} ${duration.padStart(5)}  ${String(row.toolCalls).padStart(3)} tools  ${String(row.filesTouched).padStart(2)} files  ${row.shortId}  ${prompt}`);
  }
}

/** Prints one session summary. */
function printUsageSession(row: SessionRow): void {
  console.log(`Session: ${row.shortId}`);
  console.log(`Provider: ${row.provider}`);
  console.log(`Started:  ${formatDateTime(row.startedAt)}`);
  console.log(`Ended:    ${formatDateTime(row.endedAt)}`);
  console.log(`Turns:    ${row.turns}`);
  console.log(`Tools:    ${row.toolCalls}`);
  console.log(`Files:    ${row.filesTouched}`);
  if (row.branch) console.log(`Branch:   ${row.branch}`);
  if (row.cwd) console.log(`Cwd:      ${row.cwd}`);
  if (row.firstPrompt) console.log(`Prompt:   ${preview(row.firstPrompt, 140)}`);
}

/** Aggregates token usage events for raw rows or model-level totals. */
function aggregateUsageEvents(events: UsageDataset["events"], by?: string, includeEstimates = false): Array<Record<string, unknown>> {
  const usageEvents: UsageRow[] = events.flatMap((event) => {
    const usage = objectField(event.data, "usage") || (event.kind === "token.usage" ? objectField(event.data, "totals") || event.data : undefined);
    if (!usage) return [];
    return [{
      provider: event.provider,
      model: event.actor?.model || stringField(event.data, "model") || "unknown",
      conversationId: event.conversation.id,
      usage,
      source: event.capture.source === "native-import" ? "native" : event.capture.source,
      confidence: stringField(event.data, "usageConfidence") || stringField(event.data, "confidence") || (event.capture.source === "native-import" ? "provider-reported" : "derived")
    }];
  });
  if (includeEstimates) usageEvents.push(...estimatedUsageRows(events));
  if (by !== "model") return usageEvents;

  const grouped = new Map<string, Record<string, unknown>>();
  for (const row of usageEvents) {
    const key = `${row.model || "unknown"}:${row.source}:${row.confidence}`;
    const current = grouped.get(key) || { model: row.model || "unknown", count: 0, input: 0, output: 0, total: 0, cacheRead: 0, confidence: row.confidence, source: row.source };
    current.count = Number(current.count) + 1;
    const totals = usageTotals(row.usage);
    current.input = Number(current.input) + totals.input;
    current.output = Number(current.output) + totals.output;
    current.total = Number(current.total) + totals.total;
    current.cacheRead = Number(current.cacheRead) + totals.cacheRead;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

/** Builds estimated token rows from visible message text. */
function estimatedUsageRows(events: UsageDataset["events"]): UsageRow[] {
  return events.flatMap((event) => {
    if (event.kind !== "message.user" && event.kind !== "message.assistant.visible") return [];
    const text = stringField(event.data, "text") || stringField(event.data, "delta") || stringField(event.data, "text_preview");
    if (!text) return [];
    const count = estimateTokens(text);
    const input = event.kind === "message.user" ? count : 0;
    const output = event.kind === "message.assistant.visible" ? count : 0;
    return [{
      provider: event.provider,
      model: event.actor?.model || stringField(event.data, "model") || "unknown",
      conversationId: event.conversation.id,
      usage: { input, output, total: input + output },
      source: "estimated",
      confidence: "estimated"
    }];
  });
}

/** Estimates token count from text length when provider totals are absent. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.replace(/\s+/g, " ").trim().length / 4));
}

/** Prints known or estimated token usage rows. */
function printUsageTokens(rows: Array<Record<string, unknown>>, providers: UsageProvider[]): void {
  console.log("Known token usage");
  if (!rows.length) {
    for (const provider of providers.length ? providers : usageProviders) {
      console.log(`  ${provider}: unavailable  reason=no native token usage found in indexed transcripts`);
    }
    return;
  }
  for (const row of rows) {
    if ("usage" in row) {
      console.log(`  ${row.provider} ${row.model || "unknown"}  confidence=${row.confidence}  source=${row.source}`);
      console.log(`    ${JSON.stringify(row.usage)}`);
    } else {
      console.log(`  ${row.model}: input=${row.input} output=${row.output} total=${row.total} cacheRead=${row.cacheRead} count=${row.count} confidence=${row.confidence} source=${row.source}`);
    }
  }
}

/** Normalizes common token usage field names into CLI totals. */
function usageTotals(value: unknown): { input: number; output: number; total: number; cacheRead: number } {
  return {
    input: numberField(value, "input") || numberField(value, "input_tokens") || 0,
    output: numberField(value, "output") || numberField(value, "output_tokens") || 0,
    total: numberField(value, "total") || numberField(value, "total_tokens") || 0,
    cacheRead: numberField(value, "cacheRead") || numberField(value, "cache_read_input_tokens") || numberField(value, "cached_input_tokens") || 0
  };
}

/** Returns a required session argument or throws a CLI error. */
function requiredSession(value: string | undefined): string {
  if (!value) throw new Error("A session id is required.");
  return value;
}
/** Returns a required path argument or throws the provided CLI error. */
function requiredPath(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}
/** Returns the latest defined date from a list. */
function latestDate(values: Array<Date | undefined>): Date | undefined {
  return values.filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
}
/** Sums a list of numeric values. */
function sumNumbers(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
/** Returns today's local date in report date format. */
function todayDate(): string {
  return formatDatePart(new Date());
}
/** Default retention window for `usage prune`: keep roughly two months of history. */
const DEFAULT_RETENTION_DAYS = 60;

/** Returns the timestamp `days` days before now, the lower bound prune keeps. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Parses a numeric CLI argument, falling back to a default when absent or invalid. */
function numberOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Formats a byte count as a compact human-readable size. */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${(bytes < 0 ? -value : value).toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

/** Parses an optional CLI date argument. */
function dateArg(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}
/** Parses a required provider CLI argument. */
function providerArg(value: unknown): UsageProvider {
  if (isUsageProvider(value)) return value;
  throw new Error("--provider must be claude, codex, or gemini.");
}

/** Parses an optional provider CLI argument. */
function providerArgOrUndefined(value: unknown): UsageProvider | undefined {
  if (value === undefined) return undefined;
  return providerArg(value);
}
/** Parses a provider argument that may request all providers. */
function providerOrAll(value: unknown): UsageProvider | "all" {
  if (value === undefined) return "all";
  if (value === "all" || isUsageProvider(value)) return value;
  throw new Error("--provider must be claude, codex, gemini, or all.");
}

/** Expands the provider CLI argument into provider filters. */
function providerList(value: unknown): Array<UsageProvider | "all"> {
  const provider = providerOrAll(value);
  return provider === "all" ? [...usageProviders] : [provider];
}

/** Parses the usage index source CLI argument. */
function sourceList(value: unknown): UsageIndexSource[] {
  if (value === undefined || value === "native") return ["native"];
  if (value === "all") return ["native", "usage-jsonl"];
  throw new Error("--source must be native or all.");
}
