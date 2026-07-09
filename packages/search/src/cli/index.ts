#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { renderCommandHelp } from "@tangent/core";

import { loadConfig } from "../core/config.js";
import { runGrep } from "../core/grep.js";
import { configure, indexRepo, searchRepo, status as statusSdk, symbol, callers, callees, testsFor, skeleton, openPlan, type IndexProgressEvent } from "../sdk/index.js";
import { booleanArg, languageArgs, modeArg, numberArg, parseArgs, scopeArg, storageArg, stringArg, type Args } from "./args.js";
import { searchCommandSpec } from "./spec.js";

export { searchCommandSpec } from "./spec.js";

const namedCommands = new Set(["index", "init", "status", "doctor", "symbol", "callers", "callees", "tests", "skeleton", "open-plan", "grep", "rg", "find", "config"]);

/** Runs search cli. */
export async function runSearchCli(argv = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "grep" || argv[0] === "rg" || argv[0] === "find") {
    process.exitCode = await runGrep(argv[0], argv.slice(1));
    return;
  }

  const args = parseArgs(argv);
  const command = args._[0];
  if (!command || args.help) return help();

  if (!namedCommands.has(command)) {
    const result = await searchRepo(command, {
      repo: stringArg(args.repo),
      mode: modeArg(args.mode),
      maxResults: numberArg(args["max-results"]),
      languages: languageArgs(args.language),
      includeTests: booleanArg(args["include-tests"])
    });
    return printJsonOr(args, result, () => printSearch(result));
  }

  if (command === "index") {
    const verbose = booleanArg(args.verbose);
    const printProgress = createIndexProgressPrinter({ verbose });
    const result = await indexRepo({
      repo: args._[1] || ".",
      languages: languageArgs(args.language),
      includeGenerated: booleanArg(args["include-generated"]) || undefined,
      force: booleanArg(args.force),
      reedgeAll: booleanArg(args["reedge-all"]),
      slowOperationMs: verbose ? 2000 : 5000,
      watch: booleanArg(args.watch),
      intervalSeconds: numberArg(args.interval),
      onResult: printIndexResult,
      onProgress: printProgress
    });
    if (result) printIndexResult(result);
    return;
  }

  if (command === "init") {
    const result = await configure({
      repo: args._[1] || ".",
      storage: booleanArg(args["repo-local"]) ? "repo-local-private" : storageArg(args.storage),
      scope: scopeArg(args.scope),
      baseDir: stringArg(args["base-dir"]),
      dbPath: stringArg(args["db-path"]),
      languages: languageArgs(args.language),
      includeGenerated: args["include-generated"] === undefined ? undefined : booleanArg(args["include-generated"]),
      defaultMode: modeArg(args.mode),
      maxResults: numberArg(args["max-results"])
    });
    console.log(`search initialized: ${result.path}`);
    return;
  }

  if (command === "status" || command === "doctor") {
    const value = await statusSdk({ repo: args._[1] || "." });
    return printJsonOr(args, value, () => printStatus(value, command === "doctor"));
  }

  if (command === "symbol") {
    const name = required(args._[1], "symbol requires <name>.");
    const result = await symbol(name, { repo: stringArg(args.repo), languages: languageArgs(args.language) });
    return printJsonOr(args, result, () => printSymbols(name, result));
  }

  if (command === "callers" || command === "callees") {
    const name = required(args._[1], `${command} requires <name>.`);
    const result = command === "callers" ? await callers(name, { repo: stringArg(args.repo), languages: languageArgs(args.language) }) : await callees(name, { repo: stringArg(args.repo), languages: languageArgs(args.language) });
    return printJsonOr(args, result, () => printCallGraph(result));
  }

  if (command === "tests") {
    const target = required(args._[1], "tests requires <path|symbol>.");
    const result = await testsFor(target, { repo: stringArg(args.repo), languages: languageArgs(args.language) });
    return printJsonOr(args, result, () => printTests(result));
  }

  if (command === "skeleton") {
    const target = required(args._[1], "skeleton requires <path|symbol>.");
    const result = await skeleton(target, { repo: stringArg(args.repo), languages: languageArgs(args.language) });
    return printJsonOr(args, result, () => printSkeleton(result));
  }

  if (command === "open-plan") {
    const query = required(args._[1], "open-plan requires <query>.");
    const result = await openPlan(query, { repo: stringArg(args.repo), languages: languageArgs(args.language) });
    return printJsonOr(args, result, () => printOpenPlan(result));
  }

  if (command === "config") {
    const subcommand = args._[1] || "show";
    const repo = stringArg(args.repo) || ".";
    if (subcommand === "show") {
      const loaded = await loadConfig({ repo });
      console.log(JSON.stringify(loaded.config, null, 2));
      return;
    }
    if (subcommand === "set") {
      const key = required(args._[2], "search config set requires <path> <value>.");
      const value = required(args._[3], "search config set requires <path> <value>.");
      const result = await configure({ repo, scope: scopeArg(args.scope), set: { path: key, value } });
      console.log(`updated: ${result.path}`);
      return;
    }
  }

  throw new Error(`Unknown search command: ${command}`);
}

/** Prints search. */
function printSearch(result: Awaited<ReturnType<typeof searchRepo>>): void {
  console.log(`Query: ${JSON.stringify(result.query)}`);
  console.log(`Mode: ${result.mode}`);
  emitHits("Likely implementation symbols", result.implementationSymbols);
  emitHits("Likely implementation files", result.implementationFiles);
  emitHits("Likely tests", result.tests);
  if (!result.implementationSymbols.length && !result.implementationFiles.length && !result.tests.length) console.log("No index matches. Try: tangent search grep -rn <pattern> <path>");
}

/** Emits hits. The next-step hint prints once per section, not per hit. */
function emitHits(title: string, hits: Awaited<ReturnType<typeof searchRepo>>["implementationSymbols"]): void {
  if (!hits.length) return;
  console.log(`\n${title}`);
  for (const [index, hit] of hits.entries()) {
    console.log(`\n${index + 1}. ${hit.qualifiedName} [${hit.language}${hit.kind ? ` ${hit.kind}` : " file"}]`);
    console.log(`   file: ${hit.path}${hit.startLine ? `:${hit.startLine}-${hit.endLine}` : ""}`);
    if (hit.signature) console.log(`   signature: ${hit.signature}`);
    if (hit.reasons.length) console.log(`   why: ${hit.reasons.join("; ")}`);
  }
  const top = hits[0];
  if (!top) return;
  console.log(top.type === "symbol" ? `\nnext: tangent search symbol ${JSON.stringify(top.name)} | tangent search skeleton <path>` : `\nnext: tangent search skeleton ${top.path}`);
}

/** Prints index result. */
function printIndexResult(result: NonNullable<Awaited<ReturnType<typeof indexRepo>>>): void {
  console.log(`search ${result.action}: ${result.files} files, ${result.symbols} symbols, ${result.edges} edges (${result.parsed} parsed, ${result.deleted} deleted) in ${(result.elapsedMs / 1000).toFixed(2)}s`);
  console.log(`db: ${result.dbPath}`);
}

/** Creates index progress printer. */
function createIndexProgressPrinter(options: { verbose: boolean }): (event: IndexProgressEvent) => void {
  if (options.verbose) return createVerboseIndexProgressPrinter();
  return createConciseIndexProgressPrinter();
}

/** Creates concise index progress printer. */
function createConciseIndexProgressPrinter(): (event: IndexProgressEvent) => void {
  const lastPrinted = new Map<string, number>();
  return (event) => {
    if (event.level === "warning") {
      console.error(`search index: warning slow ${event.stage || event.phase}${event.step && event.step !== "warning" ? ` ${event.step}` : ""}${event.path ? ` ${event.path}` : ""} in ${formatMs(event.durationMs)}`);
      return;
    }
    if (event.phase === "start") {
      console.error(`search index: starting ${event.root} (${event.languages.join(", ") || "no languages"})`);
      return;
    }
    if (event.phase === "context" && event.stage === "languages" && event.step === "start") {
      console.error("search index: loading language context...");
      return;
    }
    if (event.phase === "scan") {
      if (event.total === undefined) {
        console.error("search index: scanning files...");
        return;
      }
      if (shouldPrintCounter(event, lastPrinted)) console.error(`search index: scanned ${event.current ?? event.total}/${event.total} files`);
      return;
    }
    if (event.phase === "plan") {
      if (event.action === "up-to-date") {
        console.error(`search index: no file changes detected across ${event.files ?? 0} files`);
        return;
      }
      if (event.action === "full") {
        console.error(`search index: full rebuild; parsing ${event.total ?? 0} files`);
        return;
      }
      console.error(`search index: incremental update; parsing ${event.changed ?? 0} changed files, deleting ${event.deleted ?? 0}`);
      return;
    }
    if (event.phase === "parse") {
      if ((event.step === undefined || event.step === "done") && shouldPrintCounter(event, lastPrinted)) console.error(`search index: parsed ${event.current ?? 0}/${event.total ?? 0} files`);
      return;
    }
    if (event.phase === "write") {
      if (!event.stage) {
        console.error("search index: writing index rows...");
        return;
      }
      if (event.stage === "reset") {
        if (event.total === undefined) console.error("search index: clearing old index rows...");
        else if (shouldPrintCounter(event, lastPrinted)) console.error(`search index: cleared ${event.current ?? event.total}/${event.total} old index rows`);
        return;
      }
      if (event.stage === "affected") {
        console.error("search index: finding affected importers...");
        return;
      }
      if (event.stage === "delete") {
        if (event.total === undefined) console.error("search index: deleting stale index rows...");
        else if (event.total === 0) console.error("search index: no stale index rows to delete");
        else if (shouldPrintCounter(event, lastPrinted)) console.error(`search index: deleted ${event.current ?? event.total}/${event.total} stale index rows`);
        return;
      }
      if (event.stage === "delete-old") {
        return;
      }
      if (event.stage === "upsert") {
        if (event.step === "start" && event.current === undefined) console.error(`search index: upserting ${event.total ?? event.parsed ?? 0} parsed files...`);
        else if (event.step === "done" && shouldPrintCounter(event, lastPrinted)) console.error(`search index: upserted ${event.current}/${event.total} parsed files`);
        return;
      }
      if (event.stage === "metadata") {
        console.error("search index: writing index metadata...");
        return;
      }
      console.error(`search index: writing ${event.stage}...`);
      return;
    }
    if (event.phase === "edges") {
      const label = event.stage === "import" ? "import edges" : event.stage === "symbol" ? "symbol graph" : event.stage === "test" ? "test links" : "graph edges";
      if (event.step === "start" && event.current === undefined) {
        console.error(event.total === undefined ? `search index: rebuilding ${label}...` : `search index: rebuilding ${label} for ${event.total} files...`);
        return;
      }
      if (event.total === 0) {
        console.error(`search index: no ${label} to rebuild`);
        return;
      }
      if ((event.step === undefined || event.step === "done") && shouldPrintCounter(event, lastPrinted)) console.error(`search index: rebuilt ${label} for ${event.current ?? 0}/${event.total ?? 0} files`);
    }
  };
}

/** Creates verbose index progress printer. */
function createVerboseIndexProgressPrinter(): (event: IndexProgressEvent) => void {
  return (event) => {
    const parts = ["search index:"];
    if (event.level === "warning") parts.push("warning");
    parts.push(event.phase);
    if (event.stage) parts.push(event.stage);
    if (event.step) parts.push(event.step);
    if (event.action) parts.push(`action=${event.action}`);
    if (event.current !== undefined && event.total !== undefined) parts.push(`${event.current}/${event.total}`);
    if (event.path) parts.push(event.path);
    if (event.language) parts.push(`language=${event.language}`);
    if (event.size !== undefined) parts.push(`size=${event.size}`);
    if (event.files !== undefined) parts.push(`files=${event.files}`);
    if (event.changed !== undefined) parts.push(`changed=${event.changed}`);
    if (event.deleted !== undefined) parts.push(`deleted=${event.deleted}`);
    if (event.parsed !== undefined) parts.push(`parsed=${event.parsed}`);
    if (event.symbols !== undefined) parts.push(`symbols=${event.symbols}`);
    if (event.imports !== undefined) parts.push(`imports=${event.imports}`);
    if (event.edges !== undefined) parts.push(`edges=${event.edges}`);
    if (event.entities !== undefined) parts.push(`entities=${event.entities}`);
    if (event.fts !== undefined) parts.push(`fts=${event.fts}`);
    if (event.ftsMode !== undefined) parts.push(`ftsMode=${event.ftsMode}`);
    if (event.indexVersion) parts.push(`version=${event.indexVersion}`);
    if (event.ftsEnabled !== undefined) parts.push(`fts=${event.ftsEnabled ? "enabled" : "disabled"}`);
    if (event.includeGenerated !== undefined) parts.push(`includeGenerated=${event.includeGenerated ? "true" : "false"}`);
    if (event.force !== undefined) parts.push(`force=${event.force ? "true" : "false"}`);
    if (event.reedgeAll !== undefined) parts.push(`reedgeAll=${event.reedgeAll ? "true" : "false"}`);
    if (event.reason) parts.push(`reason=${event.reason}`);
    if (event.durationMs !== undefined) parts.push(`duration=${formatMs(event.durationMs)}`);
    if (event.elapsedMs !== undefined) parts.push(`elapsed=${formatMs(event.elapsedMs)}`);
    if (event.message) parts.push(`message=${JSON.stringify(event.message)}`);
    console.error(parts.join(" "));
  };
}

/** Returns whether print counter. */
function shouldPrintCounter(event: IndexProgressEvent, lastPrinted: Map<string, number>): boolean {
  const total = event.total ?? 0;
  const current = event.current ?? total;
  if (!total) return false;
  const key = `${event.phase}:${event.stage || ""}`;
  const previous = lastPrinted.get(key) || 0;
  if (current === previous) return false;
  const shouldPrint = current === 1 || current === total || current - previous >= 250;
  if (shouldPrint) lastPrinted.set(key, current);
  return shouldPrint;
}

/** Formats ms. */
function formatMs(value: number | undefined): string {
  if (value === undefined) return "unknown";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
}

/** Prints status. */
function printStatus(value: Awaited<ReturnType<typeof statusSdk>>, verbose: boolean): void {
  console.log(`Repo: ${value.repoRoot}`);
  console.log(`DB:   ${value.dbPath}`);
  if (!value.exists) {
    console.log("Index: missing or empty; run tangent search index");
    return;
  }
  console.log(`Index: ${value.version || "unknown"}${value.indexedAt ? ` at ${new Date(Number(value.indexedAt) * 1000).toISOString()}` : ""}`);
  console.log(`Languages: ${value.languages.map((row) => `${row.language}=${row.files} files/${row.symbols} symbols`).join(", ") || "(none)"}`);
  if (verbose) {
    console.log(`Configured languages: ${value.configuredLanguages.join(", ")}`);
    console.log(`FTS: ${value.ftsEnabled ? "enabled" : "disabled"}`);
  }
}

/** Prints symbols. Top matches get full detail; the rest print one line each. */
function printSymbols(name: string, values: Awaited<ReturnType<typeof symbol>>): void {
  if (!values.length) {
    console.log(`No symbol found for ${JSON.stringify(name)}`);
    return;
  }
  const detailed = 5;
  for (const [index, item] of values.entries()) {
    if (index >= detailed) {
      console.log(`${index + 1}. ${item.qualifiedName} [${item.language} ${item.kind}] ${item.path}:${item.startLine}-${item.endLine}`);
      continue;
    }
    console.log(`${index + 1}. ${item.qualifiedName} [${item.language} ${item.kind}]`);
    console.log(`   file: ${item.path}:${item.startLine}-${item.endLine}`);
    if (item.signature) console.log(`   signature: ${item.signature}`);
    if (item.calledBy.length) console.log(`   called by: ${item.calledBy.slice(0, 5).map((row) => `${row.qualifiedName} (${row.path})`).join(", ")}`);
    if (item.calls.length) console.log(`   calls: ${item.calls.slice(0, 5).map((row) => `${row.qualifiedName} (${row.path})`).join(", ")}`);
    if (item.tests.length) console.log(`   tests: ${item.tests.slice(0, 5).join(", ")}`);
    console.log("");
  }
  if (values.length > detailed) console.log(`\nRun tangent search symbol "<exact name>" for call graph detail on one match.`);
  if (values.length >= 25) console.log(`More matches may exist; refine the query.`);
}

/** Prints call graph. */
function printCallGraph(result: Awaited<ReturnType<typeof callers>>): void {
  if (!result.root) {
    console.log("No symbol found.");
    return;
  }
  console.log(`${result.direction} for ${result.root.qualifiedName} (${result.root.path}):\n`);
  for (const [index, row] of result.rows.entries()) console.log(`${index + 1}. ${row.qualifiedName}  ${row.path}:${row.line}  evidence: ${row.evidence}`);
  if (!result.rows.length) console.log("No call edges found. Try grep or reindex with --reedge-all.");
}

/** Prints tests. */
function printTests(result: Awaited<ReturnType<typeof testsFor>>): void {
  console.log(`Likely tests for ${result.target}:`);
  for (const [index, row] of result.rows.entries()) console.log(`${index + 1}. ${row.path}  confidence=${row.confidence.toFixed(2)}  why: ${row.evidence}`);
  if (!result.rows.length) console.log("No likely tests found.");
}

/** Prints skeleton. */
function printSkeleton(result: Awaited<ReturnType<typeof skeleton>>): void {
  if (!result.path) {
    console.log("No file or symbol found.");
    return;
  }
  console.log(`# skeleton: ${result.path} [${result.language}]\n`);
  for (const row of result.rows) {
    const indent = row.parentSymbolId ? "  " : "";
    console.log(`${indent}${row.kind} ${row.qualifiedName}  // ${row.startLine}-${row.endLine}`);
    if (row.signature) console.log(`${indent}  ${row.signature}`);
  }
}

/** Prints open plan. */
function printOpenPlan(result: Awaited<ReturnType<typeof openPlan>>): void {
  console.log("Recommended read order:\n");
  for (const [index, item] of result.paths.entries()) console.log(`${index + 1}. tangent search skeleton ${item}`);
  console.log(`${result.paths.length + 1}. read only the top 1-3 full files after skeleton review`);
}

/** Prints json or. */
function printJsonOr(args: Args, value: unknown, printer: () => void): void {
  if (args.json) console.log(JSON.stringify(value, null, 2));
  else printer();
}

/** Supports the required helper. */
function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

/** Supports the help helper. */
function help(): void {
  console.log(renderCommandHelp(searchCommandSpec));
}

if (isDirectRun()) {
  runSearchCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

/** Returns whether direct run. */
function isDirectRun(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}
