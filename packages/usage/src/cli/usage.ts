import { renderCommandHelp } from "@tangent/core";
import { parseArgs, stringArg } from "@tangent/core/cli";

import { installHooks, uninstallHooks } from "../sdk/installHooks.js";
import { archiveUsageTelemetry, ensureUsageIndex, loadUsageDatasetFromIndex, resolveConversationRef } from "../sdk/indexStore.js";
import { importNative } from "../sdk/importNative.js";
import { status } from "../sdk/status.js";
import { listNativeSchemas } from "../providers/native/schema-registry.js";
import { nativeSchemaStatus } from "../providers/native/status.js";
import type { NativeProviderSchemaStatus } from "../providers/native/types.js";
import { recordHook } from "../hook-runner/record.js";
import type { UsageDataset, VisibleMessage } from "../core/dataset.js";
import type { UsageProvider } from "../core/schema/usage-jsonl-v1.js";
import { usageCommandSpec } from "./spec.js";
import {
  formatDatePart,
  formatDateTime,
  formatDuration,
  formatTime,
  numberField,
  objectField,
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

export async function runUsageCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const [command, subcommand] = args._;

  if (!command || args.help) {
    console.log(renderCommandHelp(usageCommandSpec));
    return;
  }

  if (command === "hook" && subcommand === "record") {
    await recordHook({
      provider: providerArg(args.provider),
      scope: installScopeArg(args.scope || "global"),
      repoRoot: stringArg(args["repo-root"])
    });
    return;
  }

  if (command === "hooks" && subcommand === "install") {
    const results = await installHooks({
      provider: providerOrAll(args.provider),
      scope: installScopeArg(args.scope || "global"),
      repo: stringArg(args.repo) || ".",
      tracking: trackingArg(args.tracking)
    });
    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    for (const result of results) {
      console.log(`${result.provider}: installed ${result.scope} hook at ${result.path}`);
      for (const warning of result.warnings) console.warn(`warning: ${warning}`);
    }
    return;
  }

  if (command === "hooks" && subcommand === "uninstall") {
    const results = await uninstallHooks({
      provider: providerOrAll(args.provider),
      scope: installScopeArg(args.scope || "global"),
      repo: stringArg(args.repo) || "."
    });
    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    for (const result of results) console.log(`${result.provider}: removed ${result.scope} hook at ${result.path}`);
    return;
  }

  if (command === "init") {
    const results = await installHooks({
      provider: providerOrAll(args.provider || "codex"),
      scope: installScopeArg(args.scope || "repo-local"),
      repo: stringArg(args.repo) || ".",
      tracking: trackingArg(args.tracking)
    });
    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    for (const result of results) {
      console.log(`${result.provider}: capture enabled (${result.scope})`);
      console.log(`  hook: ${result.path}`);
      for (const warning of result.warnings) console.warn(`  warning: ${warning}`);
    }
    return;
  }

  if (command === "status") {
    const value = await status({ repo: args._[1] || ".", providers: providerList(args.provider).filter((p): p is UsageProvider => p !== "all") });
    if (args.json) console.log(JSON.stringify(value, null, 2));
    else printUsageStatus(value, Boolean(args.verbose));
    return;
  }

  if (command === "today" || command === "sessions") {
    const repoArg = command === "today" ? args._[1] : args._[1] || ".";
    const date = command === "today" ? todayDate() : stringArg(args.date);
    const dataset = await loadUsageDatasetFromIndex({
      repo: repoArg || ".",
      providers: providerList(args.provider).filter((p): p is UsageProvider => p !== "all"),
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
    const resolved = await resolveConversationRef({ repo, ref: session });
    const dataset = await loadUsageDatasetFromIndex({ repo, conversationId: resolved.conversationId });
    const rows = sessionRows(dataset).filter((row) => row.id === resolved.conversationId);
    if (!rows.length) throw new Error(`No session found for ${session}.`);
    if (args.json) console.log(JSON.stringify(rows[0], null, 2));
    else printUsageSession(rows[0]!);
    return;
  }

  if (command === "transcript") {
    const session = requiredSession(args._[1]);
    const repo = stringArg(args.repo) || ".";
    const resolved = await resolveConversationRef({ repo, ref: session });
    const dataset = await loadUsageDatasetFromIndex({ repo, conversationId: resolved.conversationId });
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
    const resolved = await resolveConversationRef({ repo, ref: session });
    const dataset = await loadUsageDatasetFromIndex({ repo, conversationId: resolved.conversationId });
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
    const resolved = session ? await resolveConversationRef({ repo, ref: session, providers }) : undefined;
    const dataset = await loadUsageDatasetFromIndex({
      repo,
      providers,
      conversationId: resolved?.conversationId
    });
    const rows = aggregateUsageEvents(dataset.events, stringArg(args.by), Boolean(args.estimate));
    if (args.json) console.log(JSON.stringify(rows, null, 2));
    else printUsageTokens(rows, providers);
    return;
  }

  if (command === "reindex") {
    const result = await ensureUsageIndex({
      repo: args._[1] || ".",
      providers: providerList(args.provider).filter((p): p is UsageProvider => p !== "all"),
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
    const resolved = await resolveConversationRef({ repo, ref: session });
    const dataset = await loadUsageDatasetFromIndex({ repo, conversationId: resolved.conversationId });
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

  if (command === "import-native") {
    const provider = providerArg(args.provider || "claude");
    if (provider !== "claude") throw new Error("import-native currently supports --provider claude only.");
    const result = await importNative({ repo: args._[1] || ".", provider });
    await ensureUsageIndex({ repo: args._[1] || ".", providers: [provider] });
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

function printUsageStatus(value: Awaited<ReturnType<typeof status>>, verbose: boolean): void {
  const repoName = value.repo.gitRoot ? value.repo.gitRoot.split("/").at(-1) : value.repo.path.split("/").at(-1);
  console.log(`Repo: ${repoName || value.repo.path} (${value.repo.branch || "unknown"})`);
  console.log(`Index: ${value.index.exists ? `${value.index.sourceFiles} source files` : "missing"}`);
  console.log("");
  console.log("Capture coverage");
  for (const provider of value.providers) {
    const label = provider.provider === "claude" ? "Claude Code" : "Codex";
    console.log(`  ${label}`);
    console.log(`    Hooks:       ${installedHookScopes(provider)}`);
    console.log(`    Data:        ${provider.capture.lastEvent ? `last seen ${provider.capture.lastEvent}` : "no sessions seen yet"}`);
    console.log(`    Messages:    ${provider.capabilities["messages.visible"].status}`);
    console.log(`    Tool calls:  ${provider.capabilities["tools.calls"].status}`);
    console.log(`    Tool results:${provider.capabilities["tools.results"].status}`);
    console.log(`    Token usage: ${provider.capabilities["tokens.byConversation"].status}`);
    if (provider.provider === "claude") console.log("    Tip: run `tangent usage tokens` after `tangent usage import-native --provider claude` for provider-reported token data.");
    if (provider.provider === "codex") console.log("    Note: Codex hooks do not expose token usage; transcript paths are not a stable usage API.");
    if (verbose) {
      console.log(`    Native logs: ${nativeSchemaSummary(provider.nativeSchema)}`);
      for (const message of provider.nativeSchema.messages) console.log(`      ${message}`);
      for (const [key, support] of Object.entries(provider.capabilities)) {
        console.log(`    ${key}: ${support.status}/${support.source} ${support.notes.join(" ")}`);
      }
    }
  }
}

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

function printNativeSchemaStatuses(rows: NativeProviderSchemaStatus[]): void {
  console.log("Native log schema status");
  for (const row of rows) {
    console.log(`  ${row.provider}: ${nativeSchemaSummary(row)}`);
    for (const message of row.messages) console.log(`    ${message}`);
  }
}

function nativeSchemaSummary(row: NativeProviderSchemaStatus): string {
  if (row.compatibility === "no-native-logs") return "no native logs found";
  const versions = row.observedVersions.length ? row.observedVersions.join(", ") : "version unknown";
  const schemas = row.matchedSchemaIds.length ? ` schema=${row.matchedSchemaIds.join(",")}` : "";
  const parse = row.parseErrors ? ` parseErrors=${row.parseErrors}` : "";
  return `${row.compatibility} files=${row.files} records=${row.records} versions=${versions}${schemas}${parse}`;
}

function sessionRows(dataset: UsageDataset, query: { date?: string; provider?: UsageProvider } = {}): SessionRow[] {
  const turns = dataset.turns.list({ includeActive: true, provider: query.provider }).data;
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

function aggregateUsageEvents(events: UsageDataset["events"], by?: string, includeEstimates = false): Array<Record<string, unknown>> {
  const usageEvents: UsageRow[] = events.flatMap((event) => {
    const usage = objectField(event.data, "usage") || (event.kind === "token.usage" ? objectField(event.data, "totals") || event.data : undefined);
    if (!usage) return [];
    return [{
      provider: event.provider,
      model: event.actor?.model || stringField(event.data, "model") || "unknown",
      conversationId: event.conversation.id,
      usage,
      source: event.capture.source,
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

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.replace(/\s+/g, " ").trim().length / 4));
}

function printUsageTokens(rows: Array<Record<string, unknown>>, providers: UsageProvider[]): void {
  console.log("Known token usage");
  if (!rows.length) {
    for (const provider of providers.length ? providers : ["claude", "codex"] as const) {
      if (provider === "claude") console.log("  Claude native import: unavailable in current query. Run `tangent usage import-native --provider claude` to backfill provider-reported usage when native transcripts include it.");
      else console.log("  Codex hooks: unavailable  reason=hooks do not expose token usage");
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

function usageTotals(value: unknown): { input: number; output: number; total: number; cacheRead: number } {
  return {
    input: numberField(value, "input") || numberField(value, "input_tokens") || 0,
    output: numberField(value, "output") || numberField(value, "output_tokens") || 0,
    total: numberField(value, "total") || numberField(value, "total_tokens") || 0,
    cacheRead: numberField(value, "cacheRead") || numberField(value, "cache_read_input_tokens") || 0
  };
}

function installedHookScopes(provider: Awaited<ReturnType<typeof status>>["providers"][number]): string {
  const scopes = [
    provider.hooks.global.installed ? "global" : undefined,
    provider.hooks.repoLocal.installed ? "repo-local" : undefined,
    provider.hooks.repoShared.installed ? "repo-shared" : undefined
  ].filter(Boolean);
  return scopes.length ? scopes.join(", ") : "none";
}

function requiredSession(value: string | undefined): string {
  if (!value) throw new Error("A session id is required.");
  return value;
}
function latestDate(values: Array<Date | undefined>): Date | undefined {
  return values.filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
}
function sumNumbers(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
function todayDate(): string {
  return formatDatePart(new Date());
}
function dateArg(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}
function providerArg(value: unknown): UsageProvider {
  if (value === "claude" || value === "codex") return value;
  throw new Error("--provider must be claude or codex.");
}

function providerArgOrUndefined(value: unknown): UsageProvider | undefined {
  if (value === undefined) return undefined;
  return providerArg(value);
}
function providerOrAll(value: unknown): UsageProvider | "all" {
  if (value === undefined) return "all";
  if (value === "all" || value === "claude" || value === "codex") return value;
  throw new Error("--provider must be claude, codex, or all.");
}

function providerList(value: unknown): Array<UsageProvider | "all"> {
  const provider = providerOrAll(value);
  return provider === "all" ? ["claude", "codex"] : [provider];
}
function installScopeArg(value: unknown): "global" | "repo-local" | "repo-shared" {
  if (value === "global" || value === "repo-local" || value === "repo-shared") return value;
  throw new Error("--scope must be global, repo-local, or repo-shared.");
}

function trackingArg(value: unknown): "all" | "allowlist" | "off" | undefined {
  if (value === undefined) return undefined;
  if (value === "all" || value === "allowlist" || value === "off") return value;
  throw new Error("--tracking must be all, allowlist, or off.");
}
