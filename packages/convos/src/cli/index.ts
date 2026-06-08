#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { renderCommandHelp } from "@tangent/core";
import { parseArgs, stringArg, type Args } from "@tangent/core/cli";

import { installHooks, uninstallHooks } from "../sdk/installHooks.js";
import { importNative } from "../sdk/importNative.js";
import { scanRepo } from "../sdk/scanRepo.js";
import { status } from "../sdk/status.js";
import { recordHook } from "../hook-runner/record.js";
import type { ConvosProvider } from "../core/schema/convos-jsonl-v1.js";
import { convosCommandSpec } from "./spec.js";

export { convosCommandSpec } from "./spec.js";

export async function runConvosCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const [command, subcommand] = args._;

  if (!command || args.help) return help();

  if (command === "hook" && subcommand === "record") {
    await recordHook({
      provider: providerArg(args.provider),
      scope: scopeArg(args.scope || "global"),
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
    for (const result of results) console.log(`${result.provider}: removed ${result.scope} hook at ${result.path}`);
    return;
  }

  if (command === "track") {
    console.log("track is no longer required; installed convos hooks capture automatically.");
    return;
  }

  if (command === "untrack") {
    console.log("untrack is deprecated; uninstall convos hooks to stop capture.");
    return;
  }

  if (command === "status") {
    const value = await status({ repo: args._[1] || ".", providers: providerList(args.provider).filter((p): p is ConvosProvider => p !== "all") });
    if (args.json) console.log(JSON.stringify(value, null, 2));
    else if (args.verbose) printStatusVerbose(value);
    else printStatusCompact(value);
    return;
  }

  if (command === "conversations") {
    const dataset = await scanRepo({
      repo: args._[1] || ".",
      providers: providerList(args.provider).filter((p): p is ConvosProvider => p !== "all"),
      since: dateArg(args["started-after"]),
      until: dateArg(args["started-before"])
    });
    const rows = dataset.conversations.all().data;
    printJsonOrTable(args, rows);
    return;
  }

  if (command === "events") {
    const dataset = await scanRepo({
      repo: args._[1] || ".",
      providers: providerList(args.provider).filter((p): p is ConvosProvider => p !== "all"),
      since: dateArg(args.since),
      until: dateArg(args.until)
    });
    const rows = dataset.events
      .filter((event) => !args.date || (event.observed_at || event.recorded_at).slice(0, 10) === stringArg(args.date))
      .filter((event) => !args.provider || event.provider === args.provider);
    printJsonOrTable(args, rows);
    return;
  }

  if (command === "turns") {
    const dataset = await scanRepo({
      repo: args._[1] || ".",
      providers: providerList(args.provider).filter((p): p is ConvosProvider => p !== "all")
    });
    printJsonOrTable(args, dataset.turns.list({
      provider: providerArgOrUndefined(args.provider),
      date: stringArg(args.date),
      includeActive: Boolean(args["include-active"])
    }));
    return;
  }

  if (command === "turn") {
    const key = args._[1];
    if (!key) throw new Error("turn requires a source key.");
    const dataset = await scanRepo({ repo: stringArg(args.repo) || "." });
    printJsonOrTable(args, dataset.turns.get(key));
    return;
  }

  if (command === "activity") {
    const key = args._[1];
    if (!key) throw new Error("activity requires a source key.");
    const parsed = parseSourceKey(key);
    const dataset = await scanRepo({ repo: stringArg(args.repo) || ".", providers: [parsed.provider] });
    const turn = dataset.turns.get(key).data;
    if (!turn) throw new Error(`No turn found for ${key}.`);
    printJsonOrTable(args, dataset.activity.timeline({ conversationId: turn.conversationId, turnId: turn.turnId }));
    return;
  }

  if (command === "messages") {
    const conversationId = args._[1];
    if (!conversationId) throw new Error("messages requires a conversation id.");
    const dataset = await scanRepo({ repo: stringArg(args.repo) || "." });
    const result = args.internal ? dataset.messages.internal({ conversationId }) : dataset.messages.visible({ conversationId });
    printJsonOrTable(args, result);
    return;
  }

  if (command === "tools") {
    const conversationId = args._[1];
    if (!conversationId) throw new Error("tools requires a conversation id.");
    const dataset = await scanRepo({ repo: stringArg(args.repo) || "." });
    printJsonOrTable(args, dataset.tools.calls({ conversationId, includeResults: Boolean(args["include-results"]) }));
    return;
  }

  if (command === "tokens") {
    const conversationId = args._[1];
    if (!conversationId) throw new Error("tokens requires a conversation id.");
    const dataset = await scanRepo({ repo: stringArg(args.repo) || "." });
    const by = stringArg(args.by);
    const result = by === "model" ? dataset.tokens.byModel({ conversationId }) : by === "tool" ? dataset.tokens.perToolCall({ conversationId }) : dataset.tokens.byConversation({ conversationId });
    printJsonOrTable(args, result);
    return;
  }

  if (command === "export") {
    const dataset = await scanRepo({
      repo: args._[1] || ".",
      providers: providerList(args.provider).filter((p): p is ConvosProvider => p !== "all"),
      since: dateArg(args.since),
      until: dateArg(args.until)
    });
    for (const event of dataset.events) console.log(JSON.stringify(event));
    return;
  }

  if (command === "import-native") {
    const provider = providerArg(args.provider || "claude");
    if (provider !== "claude") throw new Error("import-native currently supports --provider claude only.");
    const result = await importNative({ repo: args._[1] || ".", provider });
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
    printStatusVerbose(value);
    if (args.trace) {
      const scanStarted = Date.now();
      const dataset = await scanRepo({ repo: args._[1] || "." });
      console.log("");
      console.log("Trace");
      console.log(JSON.stringify({
        statusMs,
        scanMs: Date.now() - scanStarted,
        rows: dataset.events.length,
        sourceFiles: dataset.provenance.sourceFiles.length
      }, null, 2));
    }
    return;
  }

  throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}

function printStatusCompact(value: Awaited<ReturnType<typeof status>>): void {
  const repoName = value.repo.gitRoot ? value.repo.gitRoot.split("/").at(-1) : value.repo.path.split("/").at(-1);
  const branch = value.repo.branch || "unknown";
  console.log(`Repo: ${repoName || value.repo.path} (${branch})`);
  const activeProviders = value.providers.filter(providerHasCompactStatus);
  if (!activeProviders.length) {
    console.log("  no convos providers installed or discovered");
    return;
  }
  for (const provider of activeProviders) {
    console.log("");
    console.log(provider.provider === "claude" ? "Claude Code" : "Codex");
    console.log(`  installed: ${installedHookScopes(provider)}`);
    console.log(`  data:      ${dataLabel(provider)}`);
  }
}

function providerHasCompactStatus(provider: Awaited<ReturnType<typeof status>>["providers"][number]): boolean {
  const hasHooks = installedHookScopes(provider) !== "none";
  const hasCapturedData = Boolean(provider.capture.lastEvent);
  const hasNativeData = provider.nativePaths.length > 0;
  return hasHooks || hasCapturedData || hasNativeData;
}

function installedHookScopes(provider: Awaited<ReturnType<typeof status>>["providers"][number]): string {
  const scopes = [
    provider.hooks.global.installed ? "global" : undefined,
    provider.hooks.repoLocal.installed ? "repo-local" : undefined,
    provider.hooks.repoShared.installed ? "repo-shared" : undefined
  ].filter(Boolean);
  return scopes.length ? scopes.join(", ") : "none";
}

function dataLabel(provider: Awaited<ReturnType<typeof status>>["providers"][number]): string {
  if (provider.capture.lastEvent) return `last seen ${provider.capture.lastEvent}`;
  if (provider.nativePaths.length > 0) return "sessions found";
  return "no sessions seen yet";
}

function printStatusVerbose(value: Awaited<ReturnType<typeof status>>): void {
  console.log("Repo");
  console.log(`  path:        ${value.repo.path}`);
  console.log(`  git root:    ${value.repo.gitRoot || "(none)"}`);
  console.log(`  branch:      ${value.repo.branch || "(unknown)"}`);
  console.log(`  tracking:    ${value.repo.tracking ? "enabled" : "disabled"}`);
  console.log(`  source:      ${value.repo.trackingSource}`);
  for (const provider of value.providers) {
    console.log("");
    console.log(provider.provider === "claude" ? "Claude Code" : "Codex");
    console.log("  supported:   yes");
    console.log(`  native:      ${provider.native}`);
    if (provider.nativePaths[0]) console.log(`  native path: ${provider.nativePaths[0]}`);
    console.log("  hooks:");
    console.log(`    global:      ${provider.hooks.global.installed ? "installed" : "not installed"}  ${provider.hooks.global.path}`);
    console.log(`    repo-local:  ${provider.hooks.repoLocal.installed ? "installed" : "not installed"}  ${provider.hooks.repoLocal.path}`);
    console.log(`    repo-shared: ${provider.hooks.repoShared.installed ? "installed" : "not installed"}  ${provider.hooks.repoShared.path}`);
    console.log("  capture:");
    console.log(`    enabled:     ${provider.capture.enabled ? "yes" : "no"}`);
    console.log(`    log dir:     ${provider.capture.logDir}`);
    console.log(`    last event:  ${provider.capture.lastEvent || "(none)"}`);
    console.log("  capabilities:");
    for (const [key, support] of Object.entries(provider.capabilities)) {
      console.log(`    ${key}: ${support.status}/${support.source}`);
    }
  }
}

function printJsonOrTable(args: Args, value: unknown): void {
  console.log(JSON.stringify(value, null, args.json ? 2 : 2));
}

function dateArg(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function providerArg(value: unknown): ConvosProvider {
  if (value === "claude" || value === "codex") return value;
  throw new Error("--provider must be claude or codex.");
}

function providerArgOrUndefined(value: unknown): ConvosProvider | undefined {
  if (value === undefined) return undefined;
  return providerArg(value);
}

function providerOrAll(value: unknown): ConvosProvider | "all" {
  if (value === undefined) return "all";
  if (value === "all" || value === "claude" || value === "codex") return value;
  throw new Error("--provider must be claude, codex, or all.");
}

function providerList(value: unknown): Array<ConvosProvider | "all"> {
  const provider = providerOrAll(value);
  return provider === "all" ? ["claude", "codex"] : [provider];
}

function scopeArg(value: unknown): "global" | "repo-local" | "repo-shared" {
  return installScopeArg(value);
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

function parseSourceKey(value: string): { provider: ConvosProvider; sessionId: string; turnId: string } {
  const [provider, sessionId, ...rest] = value.split(":");
  if (provider !== "claude" && provider !== "codex") throw new Error(`Invalid source key provider: ${value}`);
  if (!sessionId || !rest.length) throw new Error(`Invalid source key: ${value}`);
  return { provider, sessionId, turnId: rest.join(":") };
}

function help(): void {
  console.log(renderCommandHelp(convosCommandSpec));
}

if (isDirectRun()) {
  runConvosCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}
