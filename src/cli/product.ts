import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { CliCommandSpec } from "@tangent/core";
import { booleanArg, parseArgs, stringArg } from "@tangent/core/cli";
import { status as usageStatus } from "@tangent/usage";
import type { UsageProvider } from "@tangent/usage";
import { configure as configureDaily, status as dailyStatus } from "@tangent/daily";
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
    { name: "daily", description: "Initialize daily notes" },
    { name: "search", description: "Initialize structural search" },
    { name: "index-search", description: "Build the search index during setup" },
    { name: "summary-provider", takesValue: true, values: ["claude-cli", "claude-sdk", "codex-cli"], description: "Daily summary provider" },
    { name: "model", takesValue: true, description: "Daily summary model" },
    { name: "output", takesValue: true, values: ["user-global", "repo-local-private"], description: "Private data location" },
    { name: "yes", aliases: ["-y"], description: "Accept non-interactive defaults" },
    { name: "json", description: "Print JSON" }
  ]
};

export const statusCommandSpec: CliCommandSpec = {
  name: "status",
  description: "Show capture, daily, search, and provider health",
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

export const devCommandSpec: CliCommandSpec = {
  name: "dev",
  description: "Developer and CI maintenance commands",
  hidden: true,
  subcommands: [
    { name: "lint", description: "Run governance lints", args: "[group]" }
  ]
};

export const hooksCommandSpec: CliCommandSpec = {
  name: "hooks",
  description: "Low-level provider hook management",
  hidden: true
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

  if (selected.daily) {
    const daily = await configureDaily({
      repo,
      output: selected.output,
      summaryProvider: selected.summaryProvider,
      model: selected.model
    });
    actions.push({ daily });
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
  if (selected.daily) console.log(`Daily notes: initialized (${selected.output})`);
  if (selected.search) console.log(selected.indexSearch ? "Search: initialized and indexed" : "Search: initialized");
  if (!selected.usage && !selected.daily && !selected.search) console.log("No setup actions selected.");
}

export async function runProductStatusCommand(argv: string[], verboseDefault = false): Promise<void> {
  const args = parseArgs(argv);
  const repo = stringArg(args.repo) || args._[0] || ".";
  const verbose = verboseDefault || booleanArg(args.verbose);
  const [usage, daily, search] = await Promise.allSettled([
    usageStatus({ repo }),
    dailyStatus({ repo }),
    searchStatus({ repo })
  ]);
  const value = {
    repo,
    usage: settledValue(usage),
    daily: settledValue(daily),
    search: settledValue(search)
  };
  if (args.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(`Repo: ${repo}`);
  printUsageHealth(value.usage);
  printDailyHealth(value.daily, verbose);
  printSearchHealth(value.search, verbose);
}

type SetupSelection = {
  provider: "claude" | "codex" | "all";
  usage: boolean;
  daily: boolean;
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

function setupSelection(args: ReturnType<typeof parseArgs>): SetupSelection {
  const provider = providerArg(args.provider || "codex");
  const anyExplicit = Boolean(args.usage || args.daily || args.search);
  return {
    provider,
    usage: anyExplicit ? booleanArg(args.usage) : true,
    daily: anyExplicit ? booleanArg(args.daily) : true,
    search: anyExplicit ? booleanArg(args.search) : true,
    indexSearch: booleanArg(args["index-search"]),
    output: outputArg(args.output || "user-global"),
    summaryProvider: summaryProviderArg(args["summary-provider"]),
    model: stringArg(args.model)
  };
}

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
      daily: await askYes(rl, "Initialize daily notes", args.daily, true),
      search: await askYes(rl, "Initialize search", args.search, true),
      indexSearch: await askYes(rl, "Build search index now", args["index-search"], false),
      output: outputArg(await ask(rl, "Private data location [user-global/repo-local-private]", stringArg(args.output) || "user-global")),
      summaryProvider: summaryProviderArg(await ask(rl, "Daily summary provider [codex-cli/claude-cli/claude-sdk]", stringArg(args["summary-provider"]) || "codex-cli")),
      model: await ask(rl, "Daily summary model", stringArg(args.model) || "gpt-5.4-mini")
    };
  } finally {
    rl.close();
  }
}

async function ask(rl: ReturnType<typeof createInterface>, question: string, defaultValue: string): Promise<string> {
  const answer = await rl.question(`${question} (${defaultValue}): `);
  return answer.trim() || defaultValue;
}

async function askYes(rl: ReturnType<typeof createInterface>, question: string, raw: unknown, defaultValue: boolean): Promise<boolean> {
  if (raw !== undefined) return booleanArg(raw);
  const answer = (await rl.question(`${question}? ${defaultValue ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

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

function printDailyHealth(value: unknown, verbose: boolean): void {
  if (isErrorValue(value)) {
    console.log(`Daily: error - ${value.error}`);
    return;
  }
  const status = value as Awaited<ReturnType<typeof dailyStatus>>;
  console.log(`Daily: initialized=${status.daily.initialized ? "yes" : "no"} output=${status.daily.outputDir}`);
  if (verbose) console.log(`       ledger=${status.daily.ledgerPath}`);
}

function printSearchHealth(value: unknown, verbose: boolean): void {
  if (isErrorValue(value)) {
    console.log(`Search: error - ${value.error}`);
    return;
  }
  const status = value as Awaited<ReturnType<typeof searchStatus>>;
  console.log(`Search: ${status.exists ? "indexed" : "missing"} db=${status.dbPath}`);
  if (verbose && status.exists) console.log(`        languages=${status.languages.map((row) => `${row.language}:${row.files}`).join(", ")}`);
}

function settledValue<T>(result: PromiseSettledResult<T>): T | { error: string } {
  if (result.status === "fulfilled") return result.value;
  return { error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
}

function isErrorValue(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value);
}

function providerArg(value: unknown): SetupSelection["provider"] {
  if (value === "claude" || value === "codex" || value === "all") return value;
  throw new Error("--provider must be claude, codex, or all.");
}

function outputArg(value: unknown): SetupSelection["output"] {
  if (value === "user-global" || value === "repo-local-private") return value;
  throw new Error("--output must be user-global or repo-local-private.");
}

function usageProviders(provider: SetupSelection["provider"]): UsageProvider[] {
  return provider === "all" ? ["claude", "codex"] : [provider];
}

function summaryProviderArg(value: unknown): SetupSelection["summaryProvider"] {
  if (value === undefined) return undefined;
  if (value === "claude-cli" || value === "claude-sdk" || value === "codex-cli") return value;
  throw new Error("--summary-provider must be claude-cli, claude-sdk, or codex-cli.");
}
