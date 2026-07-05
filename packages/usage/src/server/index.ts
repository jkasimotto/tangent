import http from "node:http";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LocalUiApp, StaticAssetMount, UiModePreference, UiRoute, UiRouteResponse } from "@tangent/ui-server";
import { createUsageUiClient, type UsageUiClient } from "@tangent/usage-ui-data";
import { openUsageUiFromSqlite, ensureUsageIndex, type OpenUsageOptions, type UsageClient } from "@tangent/usage-index-sqlite/sqlite";
import { nativeWatchRoots } from "@tangent/usage-providers/providers/index";
import { isUsageProvider, type UsageProvider } from "@tangent/usage-core/core/schema/usage-jsonl-v1";
import { json, numberParam, stringParam } from "./http.js";
import { handleInsightsGet, handleInsightsPark, handleInsightsUnpark } from "./insights.js";
import { watchUsageSources, type UsageSourceWatcher } from "./watch.js";

export type StartUsageUiServerOptions = {
  sessionId?: string;
  repo?: string;
  scope?: "repo" | "all";
  providers?: string[];
  sources?: string[];
  host?: string;
  port?: number;
  open?: boolean;
  dev?: boolean;
  mode?: UiModePreference;
  client?: UsageClient;
  /** Watch native transcript dirs and rebuild the snapshot on change. Defaults to true. */
  watch?: boolean;
  /**
   * Only load conversations active within this many days, applied as a SQL date filter so the
   * all-projects global index (which the projection loads fully into memory) stays fast. Omit or
   * pass a non-finite value to load all history.
   */
  windowDays?: number;
};

export type UsageUiServer = {
  url: string;
  sessionId?: string;
  dev?: boolean;
  close(): Promise<void>;
};

export type UsageUiApp = {
  app: LocalUiApp;
  routes: UiRoute[];
  assetMounts: StaticAssetMount[];
  sessionId?: string;
  /** Stops the transcript watcher started for live updates, if any. */
  close?: () => void;
};

type UsageUiRequestContext = {
  client: UsageUiClient;
  usage: UsageClient;
  preferredSessionId?: string;
};

/** Starts the local Usage UI server. */
export async function startUsageUiServer(options: StartUsageUiServerOptions = {}): Promise<UsageUiServer> {
  const host = options.host || "127.0.0.1";
  const mode = options.mode || (options.dev ? "auto" : "static");
  const usageApp = await createUsageUiApp({ ...options, mode });
  const [{ createLocalUiServer }, { usageUiAssets }] = await Promise.all([
    import("@tangent/ui-server"),
    import("@tangent/usage-ui/assets")
  ]);
  const server = await createLocalUiServer({
    product: "usage",
    host,
    port: options.port ?? 0,
    open: Boolean(options.open),
    mode,
    assets: usageUiAssets,
    assetMounts: usageApp.assetMounts,
    routes: usageApp.routes
  });
  return {
    url: server.url,
    sessionId: usageApp.sessionId,
    dev: Boolean(server.dev),
    /** Stops the transcript watcher first so no rebuild runs after the server closes. */
    close: async () => {
      usageApp.close?.();
      await server.close();
    }
  };
}

/** Creates a Usage app registration for the combined Tangent UI. */
export async function createUsageUiApp(options: StartUsageUiServerOptions = {}): Promise<UsageUiApp> {
  // The SQLite UI client serves the list with indexed reads and projects one session's detail on
  // demand, so it opens instantly with no in-memory projection of the window. The watcher keeps the
  // index current with cheap per-session updates; the client reads the live DB, so nothing is swapped.
  // An injected client (tests, verify harness) is used directly.
  const usage = options.client || await openUsageUiFromSqlite(openOptions(options));
  const context: UsageUiRequestContext = { client: createUsageUiClient(usage), usage, preferredSessionId: options.sessionId };
  context.preferredSessionId = await preferredSession(options.sessionId, context.client);
  const [{ usageUiEmbeddedAssets }] = await Promise.all([
    import("@tangent/usage-ui/assets")
  ]);
  const mode = options.mode || "static";
  const devRoot = mode !== "static" ? await usageUiSourceRoot() : undefined;
  const modulePath = devRoot ? "/apps/usage/src/embedded.ts" : "/apps/usage/embedded.js";
  const reload = makeReloader(options, context);
  // Kick off index maintenance off the request path: the first run does any one-time rebuild (e.g. a
  // schema-version bump) and later runs are incremental. Skipped when a client is injected.
  if (!options.client) void reload();
  const watcher = startSourceWatcher(options, reload);
  return {
    app: {
      id: "usage",
      label: "Usage",
      routePath: "/usage",
      modulePath,
      stylePaths: devRoot ? [] : ["/apps/usage/embedded.css"]
    },
    routes: usageApiRoutes(context),
    assetMounts: [{ pathPrefix: "/apps/usage", assets: devRoot ? { ...usageUiEmbeddedAssets, dev: { sourceRoot: devRoot } } : usageUiEmbeddedAssets }],
    sessionId: context.preferredSessionId,
    close: watcher ? () => watcher.close() : undefined
  };
}

/**
 * Watches the native transcript directories and rebuilds the served snapshot in place
 * when they change, so the UI's polling sees new turns. Skipped when the caller injects
 * its own client (nothing to rebuild from disk) or disables watching. The Usage client
 * is an immutable projection snapshot, so a fresh `openUsage` is the way to pick up new
 * events; the rebuilt client and wrapper are swapped onto the shared request context,
 * which every route reads by reference. A reentrancy guard coalesces overlapping
 * rebuilds, and rebuild failures are swallowed so a mid-write transcript never crashes
 * the server.
 */
function startSourceWatcher(options: StartUsageUiServerOptions, reload: () => void): UsageSourceWatcher | undefined {
  // The watcher is the only continuous writer (it rebuilds the index), so the verify harness disables it.
  if (options.client || options.watch === false || process.env.TANGENT_VERIFY_READONLY) return undefined;
  const roots = nativeWatchRoots(options.providers);
  if (!roots.length) return undefined;
  return watchUsageSources({ roots, onChange: reload });
}

/**
 * Builds the index-maintenance function shared by the initial background build and the watcher. It
 * brings the SQLite index current (a full rebuild only on first run or a schema-version bump,
 * otherwise per-session incremental updates) and refreshes the preferred session. The client reads
 * the live DB, so there is nothing to swap. Runs off the request path; a reentrancy guard coalesces
 * overlapping runs and failures are swallowed so a transcript caught mid-write never crashes the server.
 */
function makeReloader(options: StartUsageUiServerOptions, context: UsageUiRequestContext): () => void {
  let running = false;
  let pending = false;
  /** Brings the index current and refreshes the preferred session, coalescing overlapping runs. */
  const run = async (): Promise<void> => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await ensureUsageIndex(maintenanceOptions(options));
      if (!options.sessionId || options.sessionId === "latest") {
        context.preferredSessionId = await preferredSession(options.sessionId, context.client);
      }
    } catch {
      // A transcript caught mid-write yields a transient parse error; the next run reruns this.
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void run();
      }
    }
  };
  return () => { void run(); };
}

/** Maps server options to the index-maintenance options. The index spans all history; the view window is applied at read time. */
function maintenanceOptions(options: StartUsageUiServerOptions): { repo: string; scope?: "repo" | "all"; providers?: UsageProvider[]; sources?: Array<"native" | "usage-jsonl"> } {
  const providers = options.providers?.filter(isUsageProvider);
  const sources = options.sources?.some((source) => source === "usage-jsonl" || source === "hook") ? ["native", "usage-jsonl"] as const : ["native"] as const;
  return { repo: options.repo || ".", scope: options.scope || "repo", providers, sources: [...sources] };
}

/** Resolves the workspace Usage UI source root if this install includes it. */
async function usageUiSourceRoot(): Promise<string | undefined> {
  const assetsUrl = import.meta.resolve("@tangent/usage-ui/assets");
  let current = path.dirname(fileURLToPath(assetsUrl));
  for (let index = 0; index < 6; index += 1) {
    const packageJson = path.join(current, "package.json");
    const indexHtml = path.join(current, "index.html");
    const main = path.join(current, "src", "main.ts");
    if (await isFile(packageJson) && await isFile(indexHtml) && await isFile(main)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/** Tests whether a path is a readable file. */
async function isFile(filePath: string): Promise<boolean> {
  return stat(filePath).then((entry) => entry.isFile()).catch(() => false);
}

/** Builds Usage API routes for the local UI server. */
function usageApiRoutes(context: UsageUiRequestContext): UiRoute[] {
  return [{
    pattern: /^\/api\/usage(?:\/.*)?$/,
    /** Handles a Usage API request. */
    handle: (request, url) => handleApiRequest(request, url, context)
  }];
}

/** Handles the local Usage API request. */
async function handleApiRequest(request: http.IncomingMessage, url: URL, context: UsageUiRequestContext): Promise<UiRouteResponse> {
  try {
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] !== "api" || parts[1] !== "usage") return json(404, { error: "Not found." });

    if (request.method === "POST") {
      if (parts.length === 4 && parts[2] === "insights" && parts[3] === "park") {
        // Parking writes into the user's real ~/.tangent park-state file, not test data, so the
        // read-only verify harness (driven against live data) must not persist a curation change.
        if (process.env.TANGENT_VERIFY_READONLY) return json(403, { error: "Park disabled in verify harness." });
        return await handleInsightsPark(request);
      }
      if (parts.length === 4 && parts[2] === "insights" && parts[3] === "unpark") {
        if (process.env.TANGENT_VERIFY_READONLY) return json(403, { error: "Unpark disabled in verify harness." });
        return await handleInsightsUnpark(request);
      }
      return json(405, { error: "Method not allowed." });
    }
    if (request.method !== "GET") return json(405, { error: "Method not allowed." });

    if (parts.length === 3 && parts[2] === "insights") return await handleInsightsGet(url);

    if (parts.length === 3 && parts[2] === "selection") {
      return json(200, { sessionId: context.preferredSessionId });
    }

    if (parts[2] === "sessions") {
      if (parts.length === 3) {
        return json(200, await context.client.listSessions({
          provider: stringParam(url, "provider"),
          limit: numberParam(url.searchParams.get("limit")) ?? 50
        }));
      }
      if (!parts[3]) return json(404, { error: "Missing session id." });
      const id = sessionRef(parts[3], context);
      if (parts.length === 4) return json(200, await context.client.getSession(id));
      if (parts.length === 5 && parts[4] === "cockpit") {
        return json(200, await context.client.getCockpit(id));
      }
      if (parts.length === 5 && parts[4] === "conversation-view") {
        return json(200, await context.client.getConversationView(id, {
          query: stringParam(url, "query"),
          limit: numberParam(url.searchParams.get("limit")) ?? 50
        }));
      }
      if (parts.length === 5 && parts[4] === "timeline-view") {
        return json(200, await context.client.getSessionTimelineView(id, {
          query: stringParam(url, "query"),
          limit: numberParam(url.searchParams.get("limit")) ?? 50
        }));
      }
      if (parts.length === 5 && parts[4] === "timeline") {
        return json(200, await context.client.getSessionTimeline(id, { metric: timelineMetric(url.searchParams.get("metric")) }));
      }
      if (parts.length === 5 && parts[4] === "transcript") {
        return json(200, await context.client.getTranscript(id, { includeTools: url.searchParams.get("includeTools") !== "false" }));
      }
    }

    if (parts.length === 4 && parts[2] === "messages" && parts[3] === "selection") {
      return json(200, await context.client.getMessageSelection({
        role: roleParam(url.searchParams.get("role")),
        contains: stringParam(url, "contains")
      }));
    }

    if (parts.length === 3 && parts[2] === "providers") {
      return json(200, await context.usage.providers.list());
    }

    return json(404, { error: "Not found." });
  } catch (error) {
    return json(errorStatus(error), { error: (error as Error).message });
  }
}

/** Converts server options to Usage core open options. */
function openOptions(options: StartUsageUiServerOptions): OpenUsageOptions {
  return {
    repo: options.repo || ".",
    scope: options.scope || "repo",
    providers: options.providers,
    sources: options.sources,
    // Rolling window recomputed on each (re)open so the watcher's rebuilds stay current.
    from: windowStart(options.windowDays),
    contentMode: "metadata-with-excerpts",
    index: "auto"
  };
}

/** Resolves the inclusive lower bound for the recent-activity window, or undefined for all history. */
function windowStart(windowDays: number | undefined): string | undefined {
  if (windowDays === undefined || !Number.isFinite(windowDays) || windowDays <= 0) return undefined;
  return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
}

/** Resolves the initially selected session id. */
async function preferredSession(sessionId: string | undefined, client: UsageUiClient): Promise<string | undefined> {
  if (sessionId && sessionId !== "latest") return sessionId;
  const sessions = await client.listSessions({ limit: 1 }).catch(() => ({ sessions: [] }));
  return sessions.sessions[0]?.id;
}

/** Resolves the special selected session ref. */
function sessionRef(value: string, context: UsageUiRequestContext): string {
  return value === "selected" ? context.preferredSessionId || "latest" : value;
}

/** Reads a valid timeline metric. */
function timelineMetric(value: string | null): "durationMs" | "selfDurationMs" | "tokens.total" | "cost.amount" | undefined {
  if (value === "durationMs" || value === "selfDurationMs" || value === "tokens.total" || value === "cost.amount") return value;
  return undefined;
}

/** Reads a valid message role filter. */
function roleParam(value: string | null): "user" | "assistant" | "system" | "tool" | undefined {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") return value;
  return undefined;
}

/** Maps thrown errors to HTTP statuses. */
function errorStatus(error: unknown): number {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  const message = error instanceof Error ? error.message : String(error);
  return /not found|No usage sessions|No usage session/i.test(message) ? 404 : 500;
}
