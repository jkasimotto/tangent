#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { renderCommandHelp } from "@tangent/core";

import { loadConfig } from "../core/config.js";
import { runGrep } from "../core/grep.js";
import { configure, indexRepo, searchRepo, status as statusSdk, symbol, callers, callees, testsFor, skeleton, openPlan } from "../sdk/index.js";
import { booleanArg, languageArgs, modeArg, numberArg, parseArgs, scopeArg, storageArg, stringArg, type Args } from "./args.js";
import { searchCommandSpec } from "./spec.js";

export { searchCommandSpec } from "./spec.js";

const namedCommands = new Set(["index", "init", "status", "doctor", "symbol", "callers", "callees", "tests", "skeleton", "open-plan", "grep", "rg", "find", "config"]);

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
    const result = await indexRepo({
      repo: args._[1] || ".",
      languages: languageArgs(args.language),
      includeGenerated: booleanArg(args["include-generated"]) || undefined,
      force: booleanArg(args.force),
      reedgeAll: booleanArg(args["reedge-all"]),
      watch: booleanArg(args.watch),
      intervalSeconds: numberArg(args.interval),
      onResult: printIndexResult
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

function printSearch(result: Awaited<ReturnType<typeof searchRepo>>): void {
  console.log(`Query: ${JSON.stringify(result.query)}`);
  console.log(`Mode: ${result.mode}`);
  emitHits("Likely implementation symbols", result.implementationSymbols);
  emitHits("Likely implementation files", result.implementationFiles);
  emitHits("Likely tests", result.tests);
  if (!result.implementationSymbols.length && !result.implementationFiles.length && !result.tests.length) console.log("No index matches. Try: tangent search grep -rn <pattern> <path>");
}

function emitHits(title: string, hits: Awaited<ReturnType<typeof searchRepo>>["implementationSymbols"]): void {
  if (!hits.length) return;
  console.log(`\n${title}`);
  for (const [index, hit] of hits.entries()) {
    console.log(`\n${index + 1}. ${hit.qualifiedName} [${hit.language}${hit.kind ? ` ${hit.kind}` : " file"}]`);
    console.log(`   file: ${hit.path}${hit.startLine ? `:${hit.startLine}-${hit.endLine}` : ""}`);
    if (hit.signature) console.log(`   signature: ${hit.signature}`);
    if (hit.reasons.length) console.log(`   why: ${hit.reasons.join("; ")}`);
    console.log(hit.type === "symbol" ? `   next: tangent search symbol ${JSON.stringify(hit.name)}\n         tangent search skeleton ${hit.path}` : `   next: tangent search skeleton ${hit.path}`);
  }
}

function printIndexResult(result: NonNullable<Awaited<ReturnType<typeof indexRepo>>>): void {
  console.log(`search ${result.action}: ${result.files} files, ${result.symbols} symbols, ${result.edges} edges (${result.parsed} parsed, ${result.deleted} deleted) in ${(result.elapsedMs / 1000).toFixed(2)}s`);
  console.log(`db: ${result.dbPath}`);
}

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

function printSymbols(name: string, values: Awaited<ReturnType<typeof symbol>>): void {
  if (!values.length) {
    console.log(`No symbol found for ${JSON.stringify(name)}`);
    return;
  }
  for (const [index, item] of values.entries()) {
    console.log(`${index + 1}. ${item.qualifiedName} [${item.language} ${item.kind}]`);
    console.log(`   file: ${item.path}:${item.startLine}-${item.endLine}`);
    if (item.signature) console.log(`   signature: ${item.signature}`);
    if (item.calledBy.length) console.log(`   called by: ${item.calledBy.slice(0, 5).map((row) => `${row.qualifiedName} (${row.path})`).join(", ")}`);
    if (item.calls.length) console.log(`   calls: ${item.calls.slice(0, 5).map((row) => `${row.qualifiedName} (${row.path})`).join(", ")}`);
    if (item.tests.length) console.log(`   tests: ${item.tests.slice(0, 5).join(", ")}`);
    console.log("");
  }
}

function printCallGraph(result: Awaited<ReturnType<typeof callers>>): void {
  if (!result.root) {
    console.log("No symbol found.");
    return;
  }
  console.log(`${result.direction} for ${result.root.qualifiedName} (${result.root.path}):\n`);
  for (const [index, row] of result.rows.entries()) console.log(`${index + 1}. ${row.qualifiedName}  ${row.path}:${row.line}  evidence: ${row.evidence}`);
  if (!result.rows.length) console.log("No call edges found. Try grep or reindex with --reedge-all.");
}

function printTests(result: Awaited<ReturnType<typeof testsFor>>): void {
  console.log(`Likely tests for ${result.target}:`);
  for (const [index, row] of result.rows.entries()) console.log(`${index + 1}. ${row.path}  confidence=${row.confidence.toFixed(2)}  why: ${row.evidence}`);
  if (!result.rows.length) console.log("No likely tests found.");
}

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

function printOpenPlan(result: Awaited<ReturnType<typeof openPlan>>): void {
  console.log("Recommended read order:\n");
  for (const [index, item] of result.paths.entries()) console.log(`${index + 1}. tangent search skeleton ${item}`);
  console.log(`${result.paths.length + 1}. read only the top 1-3 full files after skeleton review`);
}

function printJsonOr(args: Args, value: unknown, printer: () => void): void {
  if (args.json) console.log(JSON.stringify(value, null, 2));
  else printer();
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function help(): void {
  console.log(renderCommandHelp(searchCommandSpec));
}

if (isDirectRun()) {
  runSearchCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}
