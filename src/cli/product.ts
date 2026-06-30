import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import type { CliCommandSpec } from "@tangent/core";
import { booleanArg, numberArg, parseArgs, stringArg, stringsArg } from "@tangent/core/cli";
import { readBuildIdentity, type UiRoute } from "@tangent/ui-server";
import { optionalModule, requiredProductModule } from "./module-loader.js";
import { discoverUiApps } from "./ui-discovery.js";
import { appendWorklogEntry, listWorklogEntries, setWorklogActual } from "./worklog.js";
import { appendFocusEvent, listFocusEvents, readAgentStatus, transcriptDirFor, type FocusEvent } from "./focus.js";
import { appendFeedbackEntry, listFeedbackEntries } from "./feedback.js";

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
    { name: "summary-provider", takesValue: true, values: ["claude-cli", "claude-sdk", "codex-cli"], description: "Rollup summary provider" },
    { name: "model", takesValue: true, description: "Rollup summary model" },
    { name: "output", takesValue: true, values: ["user-global", "repo-local-private"], description: "Private data location" },
    { name: "yes", aliases: ["-y"], description: "Accept non-interactive defaults" },
    { name: "json", description: "Print JSON" }
  ]
};

export const statusCommandSpec: CliCommandSpec = {
  name: "status",
  description: "Show capture, rollup, and provider health",
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
  args: "[usage|eval]",
  options: [
    { name: "repo", takesValue: true, description: "Repository path" },
    { name: "scope", takesValue: true, values: ["all", "repo"], description: "Session discovery scope (default: all projects)" },
    { name: "days", takesValue: true, description: "Usage view window in days (default 7); use 'all' for full history" },
    { name: "host", takesValue: true, description: "Host to bind" },
    { name: "port", takesValue: true, description: "Port to bind" },
    { name: "provider", takesValue: true, values: ["claude", "codex"], description: "Usage provider filter" },
    { name: "source", takesValue: true, values: ["native", "all"], description: "Usage data source" },
    { name: "list-apps", description: "List installed UI apps and exit" },
    { name: "dev", description: "Force workspace hot-reload serving and fail if unavailable" },
    { name: "static-ui", description: "Serve compiled UI assets instead of workspace hot reload" },
    { name: "no-browser", description: "Do not open the browser" },
    { name: "json", description: "Print JSON" }
  ]
};

export const openCommandSpec: CliCommandSpec = {
  name: "open",
  description: "Open an agent or project directory in the configured terminal",
  subcommands: [
    {
      name: "agent",
      description: "Open a new agent session in path",
      args: "[path]",
      options: [{ name: "path", takesValue: true, description: "Directory to open (default: git root or cwd)" }]
    },
    {
      name: "project",
      description: "Open a terminal at path with no agent command",
      args: "[path]",
      options: [{ name: "path", takesValue: true, description: "Directory to open (default: cwd)" }]
    },
    {
      name: "setup",
      description: "Configure terminal driver and tmux preference"
    }
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
    const { status: usageStatus } = await requiredProductModule<{ status(options: unknown): Promise<unknown> }>("@tangent/usage", "setup --usage");
    actions.push({ usage: await usageStatus({ repo, providers: usageProviders(selected.provider) }) });
  }

  if (selected.rollup) {
    const { configure: configureRollup } = await requiredProductModule<{ configure(options: unknown): Promise<unknown> }>("@tangent/rollup", "setup --rollup");
    const rollup = await configureRollup({
      repo,
      output: selected.output,
      summaryProvider: selected.summaryProvider,
      model: selected.model
    });
    actions.push({ rollup });
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`Repo: ${repo}`);
  for (const provider of detected) console.log(`${provider.available ? "✓" : "-"} ${provider.label}${provider.version ? ` ${provider.version}` : ""}`);
  if (selected.usage) console.log(`Activity capture: native transcripts (${selected.provider})`);
  if (selected.rollup) console.log(`Rollup notes: initialized (${selected.output})`);
  if (!selected.usage && !selected.rollup) console.log("No setup actions selected.");
}

/** Prints the aggregate product health status. */
export async function runProductStatusCommand(argv: string[], verboseDefault = false): Promise<void> {
  const args = parseArgs(argv);
  const repo = stringArg(args.repo) || args._[0] || ".";
  const verbose = verboseDefault || booleanArg(args.verbose);
  const [usage, rollup] = await Promise.allSettled([
    productStatus("@tangent/usage", { repo }),
    productStatus("@tangent/rollup", { repo })
  ]);
  const value = {
    repo,
    usage: settledValue(usage),
    rollup: settledValue(rollup)
  };
  if (args.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(`Repo: ${repo}`);
  printUsageHealth(value.usage);
  printRollupHealth(value.rollup, verbose);
}

/** Reads and JSON-parses the body of an incoming HTTP request. */
async function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: unknown) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({}); }
    });
    request.on("error", (err: Error) => reject(err));
  });
}

// One stable port for `tangent ui`. A PWA locks its start URL (origin + port) at install time, so the
// server it points at must always live at the same address; an OS-assigned port breaks the installed app
// on the next launch. An explicit --port still overrides this (dev worktrees pass --port 0 to coexist).
const DEFAULT_UI_PORT = 58888;

/** True if the error is a "port already in use" bind failure. */
function isAddressInUse(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "EADDRINUSE";
}

/** True if a Tangent UI server is already answering at the given base URL (via its /healthz route). */
async function isTangentServer(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/healthz", baseUrl), { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: boolean; product?: string };
    return body.ok === true && body.product === "tangent";
  } catch {
    return false;
  }
}

/** Starts the combined Tangent local UI shell. */
export async function runTangentUiCommand(argv: string[]): Promise<void> {
  const args = parseArgs(argv, { repeatable: ["provider", "source"] });
  const requestedApp = stringArg(args._[0]);
  const host = stringArg(args.host) || "127.0.0.1";
  const mode = uiMode(args);
  const registrations = await discoverUiApps({
    requestedApp,
    repo: stringArg(args.repo) || ".",
    // Default to every project so the panel is a cross-project view; `--scope repo` limits it to one.
    scope: stringArg(args.scope) === "repo" ? "repo" : "all",
    // Default the Usage view to the last 7 days so the global index loads fast; `--days all` widens it.
    windowDays: uiWindowDaysArg(stringArg(args.days)),
    mode,
    providers: stringsArg(args.provider),
    sources: stringsArg(args.source)
  });
  if (booleanArg(args["list-apps"])) {
    const apps = registrations.map((registration) => registration.app);
    if (booleanArg(args.json)) console.log(JSON.stringify({ apps }, null, 2));
    else for (const app of apps) console.log(`${app.id}\t${app.label}`);
    return;
  }
  if (!registrations.length) throw new Error("No installed Tangent UI apps found.");

  const initialApp = registrations.find((registration) => registration.app.id === requestedApp)?.app.id || registrations[0]!.app.id;
  const apps = registrations.map((registration) => registration.app);
  const [{ createLocalUiServer, openBrowser }, { tangentUiAssets }, launcher] = await Promise.all([
    import("@tangent/ui-server"),
    import("@tangent/tangent-ui/assets"),
    import("@tangent/launcher")
  ]);

  /** Dispatches /api/launcher/* requests to the launcher package. */
  async function handleLauncherRoute(
    request: IncomingMessage,
    url: URL
  ): Promise<{ status: number; json: unknown } | undefined> {
    if (request.method === "GET" && url.pathname === "/api/launcher/config") {
      return { status: 200, json: await launcher.loadLaunchConfig() };
    }
    if (request.method === "POST" && url.pathname === "/api/launcher/config") {
      const body = await readJson(request) as Record<string, unknown>;
      const current = await launcher.loadLaunchConfig();
      const merged = { driver: current.driver, tmux: current.tmux, agentCommand: current.agentCommand };
      if ("driver" in body) merged.driver = body["driver"] as typeof current.driver;
      if (typeof body["tmux"] === "boolean") merged.tmux = body["tmux"];
      if (typeof body["agentCommand"] === "string") merged.agentCommand = body["agentCommand"];
      await launcher.saveLaunchConfig(merged);
      return { status: 200, json: merged };
    }
    if (request.method === "GET" && url.pathname === "/api/launcher/sessions") {
      return { status: 200, json: await launcher.listActiveSessions() };
    }
    if (request.method === "POST" && url.pathname === "/api/launcher/open") {
      const body = await readJson(request) as Record<string, unknown>;
      const config = await launcher.loadLaunchConfig();
      const targetPath = typeof body["path"] === "string" ? body["path"] : ".";
      const title = typeof body["title"] === "string" ? body["title"] : undefined;
      const effectiveConfig = typeof body["tmux"] === "boolean" ? { ...config, tmux: body["tmux"] } : config;
      if (body["type"] === "agent") {
        const name = typeof body["name"] === "string" ? body["name"].trim() : "";
        const estimateMinutes = typeof body["estimateMinutes"] === "number" ? body["estimateMinutes"] : undefined;
        await launcher.openAgent(targetPath, { config: effectiveConfig, title, name: name || undefined, estimateMinutes });
        if (name && estimateMinutes !== undefined) {
          await appendWorklogEntry({
            entityPath: title,
            cwd: targetPath,
            name,
            description: typeof body["description"] === "string" ? body["description"].trim() || undefined : undefined,
            estimateMinutes,
            startedAt: new Date().toISOString()
          });
        }
      } else {
        await launcher.openDirectory(targetPath, { config: effectiveConfig, title });
      }
      return { status: 200, json: { ok: true } };
    }
    if (request.method === "POST" && url.pathname === "/api/launcher/sessions/stop") {
      const body = await readJson(request) as Record<string, unknown>;
      if (typeof body["cwd"] === "string") {
        await launcher.stopSession(body as unknown as Parameters<typeof launcher.stopSession>[0]);
      }
      return { status: 204, json: null };
    }
    if (request.method === "POST" && url.pathname === "/api/launcher/sessions/focus") {
      const body = await readJson(request) as Record<string, unknown>;
      if (typeof body["cwd"] === "string") {
        const config = await launcher.loadLaunchConfig();
        await launcher.focusSession(body as unknown as Parameters<typeof launcher.focusSession>[0], config);
      }
      return { status: 204, json: null };
    }
    return undefined;
  }

  /** Dispatches /api/worklog requests to the worklog store. */
  async function handleWorklogRoute(
    request: IncomingMessage,
    url: URL
  ): Promise<{ status: number; json: unknown } | undefined> {
    if (request.method === "GET" && url.pathname === "/api/worklog") {
      return { status: 200, json: await listWorklogEntries() };
    }
    if (request.method === "POST" && url.pathname === "/api/worklog") {
      const body = await readJson(request) as Record<string, unknown>;
      const name = typeof body["name"] === "string" ? body["name"].trim() : "";
      const estimateMinutes = typeof body["estimateMinutes"] === "number" ? body["estimateMinutes"] : undefined;
      if (!name || estimateMinutes === undefined) {
        return { status: 400, json: { error: "name and estimateMinutes are required" } };
      }
      const entry = await appendWorklogEntry({
        entityPath: typeof body["entityPath"] === "string" ? body["entityPath"] : undefined,
        name,
        description: typeof body["description"] === "string" ? body["description"].trim() || undefined : undefined,
        estimateMinutes,
        startedAt: new Date().toISOString(),
        actualMinutes: typeof body["actualMinutes"] === "number" ? body["actualMinutes"] : null
      });
      return { status: 200, json: entry };
    }
    if (request.method === "POST" && url.pathname === "/api/worklog/actual") {
      const body = await readJson(request) as Record<string, unknown>;
      if (typeof body["id"] === "string" && typeof body["minutes"] === "number") {
        const note = typeof body["note"] === "string" ? body["note"].trim() || undefined : undefined;
        await setWorklogActual(body["id"], body["minutes"], note);
      }
      return { status: 204, json: null };
    }
    return undefined;
  }

  /** Dispatches /api/focus requests to the command-and-control event log. */
  async function handleFocusRoute(
    request: IncomingMessage,
    url: URL
  ): Promise<{ status: number; json: unknown } | undefined> {
    if (request.method === "GET" && url.pathname === "/api/focus/events") {
      return { status: 200, json: await listFocusEvents() };
    }
    if (request.method === "POST" && url.pathname === "/api/focus/events") {
      const body = await readJson(request) as { events?: FocusEvent[]; event?: FocusEvent };
      const events = body.events ?? (body.event ? [body.event] : []);
      for (const event of events) await appendFocusEvent(event);
      return { status: 200, json: { ok: true, count: events.length } };
    }
    if (request.method === "POST" && url.pathname === "/api/focus/dispatch") {
      const body = await readJson(request) as Record<string, unknown>;
      const taskId = typeof body["taskId"] === "string" ? body["taskId"] : "";
      const cwd = typeof body["cwd"] === "string" ? body["cwd"] : ".";
      const adapter = typeof body["adapter"] === "string" ? body["adapter"] : "claude";
      if (!taskId) return { status: 400, json: { error: "taskId is required" } };
      const config = await launcher.loadLaunchConfig();
      await launcher.openAgent(cwd, { config, title: taskId });
      await appendFocusEvent({ type: "agent_dispatched", ts: Date.now(), taskId, adapter, cwd, transcriptDir: transcriptDirFor(cwd) });
      return { status: 200, json: { ok: true } };
    }
    if (request.method === "POST" && url.pathname === "/api/focus/agent-status") {
      const body = await readJson(request) as { dirs?: Array<{ id: string; dir: string }> };
      const statuses: Record<string, string> = {};
      for (const { id, dir } of body.dirs ?? []) statuses[id] = await readAgentStatus(dir);
      return { status: 200, json: statuses };
    }
    return undefined;
  }

  /** Dispatches /api/feedback requests to the in-app feedback log a coding agent reads directly. */
  async function handleFeedbackRoute(
    request: IncomingMessage,
    url: URL
  ): Promise<{ status: number; json: unknown } | undefined> {
    if (request.method === "GET" && url.pathname === "/api/feedback") {
      return { status: 200, json: await listFeedbackEntries() };
    }
    if (request.method === "POST" && url.pathname === "/api/feedback") {
      const body = await readJson(request) as Record<string, unknown>;
      const text = typeof body["text"] === "string" ? body["text"].trim() : "";
      if (!text) return { status: 400, json: { error: "text is required" } };
      const entry = await appendFeedbackEntry({
        ts: Date.now(),
        text,
        app: typeof body["app"] === "string" ? body["app"] : undefined,
        route: typeof body["route"] === "string" ? body["route"] : undefined
      });
      return { status: 200, json: entry };
    }
    return undefined;
  }

  // Correction metrics are judged by the rollup package, which may depend on Usage; the Usage app
  // may not depend on rollup, so the route lives here in the shell (the composition root) under its
  // own namespace rather than under /api/usage. The selection's scope and providers match the panel.
  const metricsRepo = stringArg(args.repo) || ".";
  const metricsScope = stringArg(args.scope) === "repo" ? "repo" : "all";
  const metricsProviders = stringsArg(args.provider).filter((provider): provider is "claude" | "codex" => provider === "claude" || provider === "codex");

  /** Dispatches /api/metrics requests to the rollup metrics engine. */
  async function handleMetricsRoute(
    request: IncomingMessage,
    url: URL
  ): Promise<{ status: number; json: unknown } | undefined> {
    if (request.method === "POST" && url.pathname === "/api/metrics/rollup") {
      const body = await readJson(request) as { conversationIds?: unknown };
      const conversationIds = Array.isArray(body.conversationIds) ? body.conversationIds.filter((id): id is string => typeof id === "string") : [];
      if (!conversationIds.length) return { status: 400, json: { error: "conversationIds is required" } };
      const rollup = await optionalModule<{ processMetrics(options: unknown): Promise<unknown> }>("@tangent/rollup");
      if (!rollup?.processMetrics) return { status: 501, json: { error: "Rollup is not installed." } };
      const result = await rollup.processMetrics({ conversationIds, repo: metricsRepo, scope: metricsScope, providers: metricsProviders.length ? metricsProviders : undefined });
      return { status: 200, json: result };
    }
    return undefined;
  }

  const routes: UiRoute[] = [
    {
      method: "GET",
      pattern: /^\/api\/ui\/apps$/,
      /** Serves the list of available local UI apps. The embedded app entries (embedded.js/.css) have
          stable filenames, so stamp each with the current build id (`?v=`) so a new build is a new URL
          the browser must refetch, instead of an immutable-cached stale bundle. */
      handle: () => {
        let version = "";
        try { version = readBuildIdentity(tangentUiAssets.rootDir).buildId; } catch { /* unbuilt server */ }
        /** Appends the build id as a `?v=` query so a new build is a new URL the browser must refetch. */
        const stamp = (assetPath: string): string => version ? `${assetPath}${assetPath.includes("?") ? "&" : "?"}v=${version}` : assetPath;
        const versionedApps = apps.map((app) => ({
          ...app,
          modulePath: stamp(app.modulePath),
          stylePaths: app.stylePaths?.map(stamp)
        }));
        return { json: { apps: versionedApps, initialApp } };
      }
    },
    {
      pattern: /^\/api\/focus\//,
      /** Routes focus (command-and-control) API requests. */
      handle: (request, url) => handleFocusRoute(request, url)
    },
    {
      pattern: /^\/api\/launcher\//,
      /** Routes launcher API requests to handleLauncherRoute. */
      handle: (request, url) => handleLauncherRoute(request, url)
    },
    {
      pattern: /^\/api\/worklog/,
      /** Routes worklog API requests to handleWorklogRoute. */
      handle: (request, url) => handleWorklogRoute(request, url)
    },
    {
      pattern: /^\/api\/feedback$/,
      /** Routes feedback API requests to handleFeedbackRoute. */
      handle: (request, url) => handleFeedbackRoute(request, url)
    },
    {
      pattern: /^\/api\/metrics\//,
      /** Routes correction-metrics API requests to handleMetricsRoute. */
      handle: (request, url) => handleMetricsRoute(request, url)
    },
    {
      method: "GET",
      pattern: /^\/api\/version$/,
      /** Reports the on-disk build identity so the long-lived PWA can detect a new build and reload.
          A read failure (older or unbuilt server) returns 500 so the client fails quiet. */
      handle: () => {
        try {
          return { json: readBuildIdentity(tangentUiAssets.rootDir) };
        } catch {
          return { status: 500 };
        }
      }
    },
    ...registrations.flatMap((registration) => registration.routes)
  ];
  const serverOptions = {
    product: "tangent",
    host,
    open: !booleanArg(args["no-browser"]),
    mode,
    assets: tangentUiAssets,
    assetMounts: registrations.flatMap((registration) => registration.assetMounts),
    routes
  };
  const explicitPort = numberArg(args.port);
  let server;
  try {
    server = await createLocalUiServer({ ...serverOptions, port: explicitPort ?? DEFAULT_UI_PORT });
  } catch (error) {
    if (explicitPort !== undefined || !isAddressInUse(error)) throw error;
    // The stable port is taken. If Tangent already owns it, point the user at the running instance rather
    // than spawning a second server on a throwaway port (the stray random-port server is what broke the PWA).
    const running = `http://${host}:${DEFAULT_UI_PORT}/`;
    if (await isTangentServer(running)) {
      if (serverOptions.open) openBrowser(running);
      if (booleanArg(args.json)) console.log(JSON.stringify({ url: running, apps: apps.map((app) => app.id), initialApp, alreadyRunning: true }, null, 2));
      else console.log(`Tangent UI already running: ${running}`);
      return;
    }
    // A non-Tangent process holds the port; fall back to an OS-assigned one so the launch still succeeds.
    server = await createLocalUiServer({ ...serverOptions, port: 0 });
  }

  if (booleanArg(args.json)) console.log(JSON.stringify({ url: server.url, apps: apps.map((app) => app.id), initialApp }, null, 2));
  else console.log(`Tangent UI: ${server.url}`);
  await waitForInterrupt(server.close);
}

/** Runs the open agent/project/setup commands. */
export async function runOpenCommand(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  const { loadLaunchConfig, saveLaunchConfig, defaultLaunchConfig, openAgent, openDirectory } = await import("@tangent/launcher");

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log("Usage: tangent open <agent|project|setup> [path]");
    return;
  }

  if (subcommand === "setup") {
    await runOpenSetup(loadLaunchConfig, saveLaunchConfig, defaultLaunchConfig);
    return;
  }

  if (subcommand === "agent" || subcommand === "project") {
    const args = parseArgs(rest);
    const targetPath = stringArg(args._[0]) || path.resolve(".");
    const config = await loadLaunchConfig();

    if (subcommand === "agent") {
      await openAgent(targetPath, { config });
      console.log(`Opening agent in ${targetPath}`);
    } else {
      await openDirectory(targetPath, { config });
      console.log(`Opening terminal at ${targetPath}`);
    }
    return;
  }

  throw new Error(`Unknown open subcommand: ${subcommand}`);
}

type LaunchSetup = {
  driver: "iterm2-tab" | "iterm2-window" | "linux-terminal" | { type: "custom"; template: string };
  tmux: boolean;
  agentCommand: string;
};

/** Prompts the user to configure their launcher preferences. */
async function runOpenSetup(
  loadConfig: () => Promise<LaunchSetup>,
  saveConfig: (config: LaunchSetup) => Promise<void>,
  defaultConfig: () => LaunchSetup
): Promise<void> {
  const existing = await loadConfig();
  const rl = createInterface({ input, output });
  try {
    console.log("Configure terminal launcher.");
    console.log("Driver options: iterm2-tab, iterm2-window (macOS), linux-terminal (Linux), custom");
    const rawDriver = (await rl.question(`Driver [${JSON.stringify(existing.driver)}]: `)).trim();
    let driver: LaunchSetup["driver"] = existing.driver;
    if (rawDriver === "iterm2-tab" || rawDriver === "iterm2-window" || rawDriver === "linux-terminal") {
      driver = rawDriver;
    } else if (rawDriver === "custom") {
      const template = (await rl.question("Custom template ({cmd} and {cwd} tokens): ")).trim();
      driver = { type: "custom", template: template || "{cmd}" };
    } else if (!rawDriver) {
      driver = existing.driver;
    } else {
      driver = { type: "custom", template: rawDriver };
    }

    const rawTmux = (await rl.question(`Use tmux? [${existing.tmux ? "Y/n" : "y/N"}]: `)).trim().toLowerCase();
    const tmux = rawTmux === "" ? existing.tmux : rawTmux === "y" || rawTmux === "yes";

    const defaults = defaultConfig();
    const rawCmd = (await rl.question(`Agent command [${existing.agentCommand || defaults.agentCommand}]: `)).trim();
    const agentCommand = rawCmd || existing.agentCommand || defaults.agentCommand;

    const config: LaunchSetup = { driver, tmux, agentCommand };
    await saveConfig(config);
    console.log(`Saved: driver=${JSON.stringify(driver)} tmux=${tmux} agentCommand=${agentCommand}`);
  } finally {
    rl.close();
  }
}

type SetupSelection = {
  provider: "claude" | "codex" | "all";
  usage: boolean;
  rollup: boolean;
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
  const anyExplicit = Boolean(args.usage || args.rollup);
  return {
    provider,
    usage: anyExplicit ? booleanArg(args.usage) : true,
    rollup: anyExplicit ? booleanArg(args.rollup) : true,
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
  if (isNotInstalled(value)) {
    console.log("Usage: not installed");
    return;
  }
  const status = value as {
    providers: Array<{ provider: string; nativePaths: string[]; capture: { lastEvent?: string } }>;
    index: { exists: boolean; sourceFiles: number };
  };
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
  if (isNotInstalled(value)) {
    console.log("Rollup: not installed");
    return;
  }
  const status = value as { rollup: { initialized: boolean; outputDir: string; ledgerPath: string } };
  console.log(`Rollup: initialized=${status.rollup.initialized ? "yes" : "no"} output=${status.rollup.outputDir}`);
  if (verbose) console.log(`       ledger=${status.rollup.ledgerPath}`);
}

/** Converts a settled promise result to a printable value. */
function settledValue<T>(result: PromiseSettledResult<T>): T | { error: string } {
  if (result.status === "fulfilled") return result.value;
  return { error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
}

/** Loads a product status function when installed. */
async function productStatus(specifier: string, options: { repo: string }): Promise<unknown> {
  const product = await optionalModule<{ status(options: { repo: string }): Promise<unknown> }>(specifier);
  if (!product?.status) return { installed: false };
  return product.status(options);
}

/** Keeps a long-running server alive until interrupted. */
function waitForInterrupt(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    /** Stops the server and resolves the wait, force-exiting if a graceful close stalls. */
    const stop = () => {
      // Safety net: Vite signal handlers or lingering sockets can keep close() from resolving; never leave the process unkillable.
      setTimeout(() => process.exit(0), 500).unref();
      void close().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

/** Tests whether a status value is an error envelope. */
function isErrorValue(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value);
}

/** Tests whether a status value represents an absent optional product. */
function isNotInstalled(value: unknown): value is { installed: false } {
  return Boolean(value && typeof value === "object" && (value as { installed?: unknown }).installed === false);
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
function usageProviders(provider: SetupSelection["provider"]): string[] {
  return provider === "all" ? ["claude", "codex"] : [provider];
}

/** Parses the root UI dev/static mode flags. Defaults to static so `tangent ui` serves pre-built assets and loads instantly; `--dev` opts into Vite hot reload. */
function uiMode(args: ReturnType<typeof parseArgs>): "auto" | "dev" | "static" {
  if (booleanArg(args.dev) && booleanArg(args["static-ui"])) throw new Error("--dev and --static-ui are mutually exclusive.");
  if (booleanArg(args.dev)) return "dev";
  return "static";
}

/** Parses `--days` for the Usage view window: a positive number of days, or `all`/`0` for full history. Defaults to 7. */
function uiWindowDaysArg(value: string | undefined): number {
  if (value === undefined) return 7;
  if (value === "all" || value === "0") return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

/** Parses the rollup summary provider CLI argument. */
function summaryProviderArg(value: unknown): SetupSelection["summaryProvider"] {
  if (value === undefined) return undefined;
  if (value === "claude-cli" || value === "claude-sdk" || value === "codex-cli") return value;
  throw new Error("--summary-provider must be claude-cli, claude-sdk, or codex-cli.");
}
