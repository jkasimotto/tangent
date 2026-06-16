import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { CliCommandSpec } from "@tangent/core";
import { booleanArg, numberArg, parseArgs, stringArg, stringsArg } from "@tangent/core/cli";
import type { LocalUiApp, StaticAssetMount, UiRoute } from "@tangent/ui-server";
import { status as usageStatus } from "@tangent/usage";
import type { UsageProvider } from "@tangent/usage";
import { configure as configureRollup, status as rollupStatus } from "@tangent/rollup";
import { configure as configureSearch, indexRepo, status as searchStatus } from "@tangent/search";

const execFileAsync = promisify(execFile);

export const setupCommandSpec: CliCommandSpec = {
  name: "setup",
  description: "Configure Tangent for this repo",
  args: "[repo]",
  options: [
    { name: "repo", takesValue: true, description: "Repository path" },
    { name: "provider", takesValue: true, values: ["claude", "codex", "all"], description: "Provider to enable" },
    { name: "usage", description: "Enable activity capture" },
    { name: "rollup", description: "Initialize rollup notes" },
    { name: "search", description: "Initialize structural search" },
    { name: "index-search", description: "Build the search index during setup" },
    { name: "summary-provider", takesValue: true, values: ["claude-cli", "claude-sdk", "codex-cli"], description: "Rollup summary provider" },
    { name: "model", takesValue: true, description: "Rollup summary model" },
    { name: "output", takesValue: true, values: ["user-global", "repo-local-private"], description: "Private data location" },
    { name: "yes", aliases: ["-y"], description: "Accept non-interactive defaults" },
    { name: "json", description: "Print JSON" }
  ]
};

export const statusCommandSpec: CliCommandSpec = {
  name: "status",
  description: "Show capture, rollup, search, and provider health",
  args: "[repo]",
  options: [
    { name: "repo", takesValue: true, description: "Repository path" },
    { name: "json", description: "Print JSON" },
    { name: "verbose", description: "Print verbose details" }
  ]
};

export const doctorCommandSpec: CliCommandSpec = {
  name: "doctor",
  description: "Debug Tangent installation problems",
  args: "[repo]",
  options: [
    { name: "repo", takesValue: true, description: "Repository path" },
    { name: "json", description: "Print JSON" },
    { name: "verbose", description: "Print verbose details" }
  ]
};

export const uiCommandSpec: CliCommandSpec = {
  name: "ui",
  description: "Start the local Tangent UI for installed apps",
  args: "[usage|trees|eval]",
  options: [
    { name: "repo", takesValue: true, description: "Repository path" },
    { name: "scope", takesValue: true, values: ["all", "repo"], description: "Session discovery scope" },
    { name: "host", takesValue: true, description: "Host to bind" },
    { name: "port", takesValue: true, description: "Port to bind" },
    { name: "provider", takesValue: true, values: ["claude", "codex"], description: "Usage provider filter" },
    { name: "source", takesValue: true, values: ["native", "all"], description: "Usage data source" },
    { name: "no-browser", description: "Do not open the browser" },
    { name: "json", description: "Print JSON" }
  ]
};

export const devCommandSpec: CliCommandSpec = {
  name: "dev",
  description: "Developer and CI maintenance commands",
  hidden: true,
  subcommands: [
    { name: "lint", description: "Run governance lints", args: "[group]" }
  ]
};

export const dataCommandSpec: CliCommandSpec = {
  name: "data",
  description: "Raw data import/export commands",
  hidden: true,
  subcommands: [
    { name: "export", description: "Export normalized telemetry JSONL" },
    { name: "archive", description: "Archive indexed raw telemetry" }
  ]
};

/** Runs the interactive or scripted setup workflow. */
export async function runSetupCommand(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const repo = stringArg(args.repo) || args._[0] || ".";
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !booleanArg(args.yes);
  const detected = await detectProviders();
  const selected = interactive ? await promptSetup(args, detected) : setupSelection(args);
  const results: Record<string, unknown> = { repo, detected, selected, actions: [] };
  const actions = results.actions as unknown[];

  if (selected.usage) {
    actions.push({ usage: await usageStatus({ repo, providers: usageProviders(selected.provider) }) });
  }

  if (selected.rollup) {
    const rollup = await configureRollup({
      repo,
      output: selected.output,
      summaryProvider: selected.summaryProvider,
      model: selected.model
    });
    actions.push({ rollup });
  }

  if (selected.search) {
    const search = await configureSearch({
      repo,
      storage: selected.output,
      scope: "private"
    });
    actions.push({ search });
    if (selected.indexSearch) actions.push({ searchIndex: await indexRepo({ repo }) });
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`Repo: ${repo}`);
  for (const provider of detected) console.log(`${provider.available ? "✓" : "-"} ${provider.label}${provider.version ? ` ${provider.version}` : ""}`);
  if (selected.usage) console.log(`Activity capture: native transcripts (${selected.provider})`);
  if (selected.rollup) console.log(`Rollup notes: initialized (${selected.output})`);
  if (selected.search) console.log(selected.indexSearch ? "Search: initialized and indexed" : "Search: initialized");
  if (!selected.usage && !selected.rollup && !selected.search) console.log("No setup actions selected.");
}

/** Prints the aggregate product health status. */
export async function runProductStatusCommand(argv: string[], verboseDefault = false): Promise<void> {
  const args = parseArgs(argv);
  const repo = stringArg(args.repo) || args._[0] || ".";
  const verbose = verboseDefault || booleanArg(args.verbose);
  const [usage, rollup, search] = await Promise.allSettled([
    usageStatus({ repo }),
    rollupStatus({ repo }),
    searchStatus({ repo })
  ]);
  const value = {
    repo,
    usage: settledValue(usage),
    rollup: settledValue(rollup),
    search: settledValue(search)
  };
  if (args.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(`Repo: ${repo}`);
  printUsageHealth(value.usage);
  printRollupHealth(value.rollup, verbose);
  printSearchHealth(value.search, verbose);
}

/** Starts the combined Tangent local UI shell. */
export async function runTangentUiCommand(argv: string[]): Promise<void> {
  const args = parseArgs(argv, { repeatable: ["provider", "source"] });
  const requestedApp = stringArg(args._[0]);
  const host = stringArg(args.host) || "127.0.0.1";
  const registrations = await installedUiApps({
    requestedApp,
    repo: stringArg(args.repo) || ".",
    scope: stringArg(args.scope) === "all" ? "all" : "repo",
    providers: stringsArg(args.provider),
    sources: stringsArg(args.source)
  });
  if (!registrations.length) throw new Error("No installed Tangent UI apps found.");

  const initialApp = registrations.find((registration) => registration.app.id === requestedApp)?.app.id || registrations[0]!.app.id;
  const apps = registrations.map((registration) => registration.app);
  const [{ createLocalUiServer }, { tangentUiAssets }] = await Promise.all([
    import("@tangent/ui-server"),
    import("@tangent/tangent-ui/assets")
  ]);
  const routes: UiRoute[] = [{
    method: "GET",
    pattern: /^\/api\/ui\/apps$/,
    /** Serves the list of available local UI apps. */
    handle: () => ({ json: { apps, initialApp } })
  }, ...registrations.flatMap((registration) => registration.routes)];
  const server = await createLocalUiServer({
    product: "tangent",
    host,
    port: numberArg(args.port) ?? 0,
    open: !booleanArg(args["no-browser"]),
    assets: tangentUiAssets,
    assetMounts: registrations.flatMap((registration) => registration.assetMounts),
    routes
  });

  if (booleanArg(args.json)) console.log(JSON.stringify({ url: server.url, apps: apps.map((app) => app.id), initialApp }, null, 2));
  else console.log(`Tangent UI: ${server.url}`);
  await waitForInterrupt(server.close);
}

type InstalledUiAppOptions = {
  requestedApp?: string;
  repo: string;
  scope: "repo" | "all";
  providers: string[];
  sources: string[];
};

type UiAppRegistration = {
  app: LocalUiApp;
  routes: UiRoute[];
  assetMounts: StaticAssetMount[];
};

/** Loads registrations for installed UI apps. */
async function installedUiApps(options: InstalledUiAppOptions): Promise<UiAppRegistration[]> {
  const loaders: Record<string, () => Promise<UiAppRegistration | undefined>> = {
    /** Loads the Usage UI app if installed. */
    usage: () => loadUsageUiApp(options),
    /** Loads the Trees UI app if installed. */
    trees: () => loadTreesUiApp(),
    /** Loads the Eval UI app if installed. */
    eval: () => loadEvalUiApp()
  };
  const ids = options.requestedApp ? [options.requestedApp] : Object.keys(loaders);
  const registrations = await Promise.all(ids.map(async (id) => {
    const loader = loaders[id];
    if (!loader) throw new Error(`Unknown UI app: ${id}`);
    return loader();
  }));
  return registrations.filter((registration): registration is UiAppRegistration => Boolean(registration));
}

/** Imports and creates the Usage UI app registration. */
async function loadUsageUiApp(options: InstalledUiAppOptions): Promise<UiAppRegistration | undefined> {
  const usage = await optionalImport<{ createUsageUiApp(options: unknown): Promise<UiAppRegistration> }>("@tangent/usage/server");
  if (!usage?.createUsageUiApp) return undefined;
  return usage.createUsageUiApp({
    repo: options.repo,
    scope: options.scope,
    providers: options.providers,
    sources: options.sources
  });
}

/** Imports and creates the Trees UI app registration. */
async function loadTreesUiApp(): Promise<UiAppRegistration | undefined> {
  const trees = await optionalImport<{ createTreesUiApp(): UiAppRegistration }>("@tangent/trees-server");
  if (!trees?.createTreesUiApp) return undefined;
  return trees.createTreesUiApp();
}

/** Imports and creates the Eval UI app registration. */
async function loadEvalUiApp(): Promise<UiAppRegistration | undefined> {
  const evalServer = await optionalImport<{ createEvalUiApp(): Promise<UiAppRegistration> }>("@tangent/eval/server");
  if (!evalServer?.createEvalUiApp) return undefined;
  return evalServer.createEvalUiApp();
}

type SetupSelection = {
  provider: "claude" | "codex" | "all";
  usage: boolean;
  rollup: boolean;
  search: boolean;
  indexSearch: boolean;
  output: "user-global" | "repo-local-private";
  summaryProvider?: "claude-cli" | "claude-sdk" | "codex-cli";
  model?: string;
};

type DetectedProvider = {
  provider: "claude" | "codex";
  label: string;
  command: string;
  available: boolean;
  version?: string;
};

/** Creates setup selections from non-interactive CLI flags. */
function setupSelection(args: ReturnType<typeof parseArgs>): SetupSelection {
  const provider = providerArg(args.provider || "codex");
  const anyExplicit = Boolean(args.usage || args.rollup || args.search);
  return {
    provider,
    usage: anyExplicit ? booleanArg(args.usage) : true,
    rollup: anyExplicit ? booleanArg(args.rollup) : true,
    search: anyExplicit ? booleanArg(args.search) : true,
    indexSearch: booleanArg(args["index-search"]),
    output: outputArg(args.output || "user-global"),
    summaryProvider: summaryProviderArg(args["summary-provider"]),
    model: stringArg(args.model)
  };
}

/** Prompts for setup selections in an interactive terminal. */
async function promptSetup(args: ReturnType<typeof parseArgs>, detected: DetectedProvider[]): Promise<SetupSelection> {
  const rl = createInterface({ input, output });
  try {
    const defaultProvider = detected.find((provider) => provider.provider === "codex" && provider.available)?.provider ||
      detected.find((provider) => provider.available)?.provider ||
      "codex";
    console.log("Detected providers:");
    for (const provider of detected) console.log(`  ${provider.available ? "✓" : "-"} ${provider.label}${provider.version ? ` ${provider.version}` : ""}`);
    return {
      provider: providerArg(await ask(rl, "Provider to enable [codex/claude/all]", stringArg(args.provider) || defaultProvider)),
      usage: await askYes(rl, "Capture coding-agent activity", args.usage, true),
      rollup: await askYes(rl, "Initialize rollup notes", args.rollup, true),
      search: await askYes(rl, "Initialize search", args.search, true),
      indexSearch: await askYes(rl, "Build search index now", args["index-search"], false),
      output: outputArg(await ask(rl, "Private data location [user-global/repo-local-private]", stringArg(args.output) || "user-global")),
      summaryProvider: summaryProviderArg(await ask(rl, "Rollup summary provider [codex-cli/claude-cli/claude-sdk]", stringArg(args["summary-provider"]) || "codex-cli")),
      model: await ask(rl, "Rollup summary model", stringArg(args.model) || "gpt-5.4-mini")
    };
  } finally {
    rl.close();
  }
}

/** Asks for a string value with a default. */
async function ask(rl: ReturnType<typeof createInterface>, question: string, defaultValue: string): Promise<string> {
  const answer = await rl.question(`${question} (${defaultValue}): `);
  return answer.trim() || defaultValue;
}

/** Asks for a boolean value with a default. */
async function askYes(rl: ReturnType<typeof createInterface>, question: string, raw: unknown, defaultValue: boolean): Promise<boolean> {
  if (raw !== undefined) return booleanArg(raw);
  const answer = (await rl.question(`${question}? ${defaultValue ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

/** Detects supported local coding-agent providers. */
async function detectProviders(): Promise<DetectedProvider[]> {
  const rows: DetectedProvider[] = [
    { provider: "codex", label: "Codex CLI", command: "codex", available: false },
    { provider: "claude", label: "Claude Code", command: "claude", available: false }
  ];
  return Promise.all(rows.map(async (row) => {
    try {
      const result = await execFileAsync(row.command, ["--version"], { timeout: 3000 });
      return { ...row, available: true, version: (result.stdout || result.stderr).trim() || undefined };
    } catch {
      return row;
    }
  }));
}

/** Prints Usage health in a compact human-readable form. */
function printUsageHealth(value: unknown): void {
  if (isErrorValue(value)) {
    console.log(`Usage: error - ${value.error}`);
    return;
  }
  const status = value as Awaited<ReturnType<typeof usageStatus>>;
  const native = status.providers.filter((provider) => provider.nativePaths.length).map((provider) => `${provider.provider}:${provider.nativePaths.length}`).join(", ") || "none";
  const seen = status.providers.filter((provider) => provider.capture.lastEvent).map((provider) => `${provider.provider} last seen ${provider.capture.lastEvent}`).join("; ") || "no sessions seen yet";
  console.log(`Usage: native=${native}; index=${status.index.exists ? `${status.index.sourceFiles} files` : "missing"}; ${seen}`);
}

/** Prints Rollup health in a compact human-readable form. */
function printRollupHealth(value: unknown, verbose: boolean): void {
  if (isErrorValue(value)) {
    console.log(`Rollup: error - ${value.error}`);
    return;
  }
  const status = value as Awaited<ReturnType<typeof rollupStatus>>;
  console.log(`Rollup: initialized=${status.rollup.initialized ? "yes" : "no"} output=${status.rollup.outputDir}`);
  if (verbose) console.log(`       ledger=${status.rollup.ledgerPath}`);
}

/** Prints Search health in a compact human-readable form. */
function printSearchHealth(value: unknown, verbose: boolean): void {
  if (isErrorValue(value)) {
    console.log(`Search: error - ${value.error}`);
    return;
  }
  const status = value as Awaited<ReturnType<typeof searchStatus>>;
  console.log(`Search: ${status.exists ? "indexed" : "missing"} db=${status.dbPath}`);
  if (verbose && status.exists) console.log(`        languages=${status.languages.map((row) => `${row.language}:${row.files}`).join(", ")}`);
}

/** Converts a settled promise result to a printable value. */
function settledValue<T>(result: PromiseSettledResult<T>): T | { error: string } {
  if (result.status === "fulfilled") return result.value;
  return { error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
}

/** Keeps a long-running server alive until interrupted. */
function waitForInterrupt(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    /** Stops the server and resolves the wait. */
    const stop = () => {
      void close().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

/** Dynamically imports an optional package dependency. */
async function optionalImport<T>(specifier: string): Promise<T | undefined> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (value: string) => Promise<T>;
  return dynamicImport(specifier).catch(() => undefined);
}

/** Tests whether a status value is an error envelope. */
function isErrorValue(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value);
}

/** Parses a provider CLI argument. */
function providerArg(value: unknown): SetupSelection["provider"] {
  if (value === "claude" || value === "codex" || value === "all") return value;
  throw new Error("--provider must be claude, codex, or all.");
}

/** Parses an output location CLI argument. */
function outputArg(value: unknown): SetupSelection["output"] {
  if (value === "user-global" || value === "repo-local-private") return value;
  throw new Error("--output must be user-global or repo-local-private.");
}

/** Expands the setup provider selection into Usage providers. */
function usageProviders(provider: SetupSelection["provider"]): UsageProvider[] {
  return provider === "all" ? ["claude", "codex"] : [provider];
}

/** Parses the rollup summary provider CLI argument. */
function summaryProviderArg(value: unknown): SetupSelection["summaryProvider"] {
  if (value === undefined) return undefined;
  if (value === "claude-cli" || value === "claude-sdk" || value === "codex-cli") return value;
  throw new Error("--summary-provider must be claude-cli, claude-sdk, or codex-cli.");
}
