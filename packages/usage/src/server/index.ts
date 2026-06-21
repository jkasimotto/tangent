import http from "node:http";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LocalUiApp, StaticAssetMount, UiModePreference, UiRoute, UiRouteResponse } from "@tangent/ui-server";
import { createUsageUiClient, type UsageUiClient } from "@tangent/usage-ui-data";
import { openUsageFromSqlite as openUsage, type OpenUsageOptions, type UsageClient } from "@tangent/usage-index-sqlite/sqlite";
import { nativeWatchRoots } from "@tangent/usage-providers/providers/index";
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
  const usage = options.client || await openUsage(openOptions(options));
  const client = createUsageUiClient(usage);
  const preferredSessionId = await preferredSession(options.sessionId, client);
  const [{ usageUiEmbeddedAssets }] = await Promise.all([
    import("@tangent/usage-ui/assets")
  ]);
  const mode = options.mode || "static";
  const devRoot = mode !== "static" ? await usageUiSourceRoot() : undefined;
  const modulePath = devRoot ? "/apps/usage/src/embedded.ts" : "/apps/usage/embedded.js";
  const context: UsageUiRequestContext = { client, usage, preferredSessionId };
  const watcher = startSourceWatcher(options, context);
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
    sessionId: preferredSessionId,
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
function startSourceWatcher(options: StartUsageUiServerOptions, context: UsageUiRequestContext): UsageSourceWatcher | undefined {
  // The watcher is the only thing that writes (it rebuilds the index), so the verify harness disables it.
  if (options.client || options.watch === false || process.env.TANGENT_VERIFY_READONLY) return undefined;
  const roots = nativeWatchRoots(options.providers);
  if (!roots.length) return undefined;
  let rebuilding = false;
  let pending = false;
  /** Reopens the snapshot and swaps it onto the shared context, coalescing overlapping rebuilds. */
  const rebuild = async (): Promise<void> => {
    if (rebuilding) {
      pending = true;
      return;
    }
    rebuilding = true;
    try {
      const usage = await openUsage(openOptions(options));
      context.usage = usage;
      context.client = createUsageUiClient(usage);
    } catch {
      // A transcript caught mid-write yields a transient parse error; the next change reruns this.
    } finally {
      rebuilding = false;
      if (pending) {
        pending = false;
        void rebuild();
      }
    }
  };
  /** Triggers a debounced rebuild whenever a watched transcript changes. */
  const onChange = () => { void rebuild(); };
  return watchUsageSources({ roots, onChange });
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
    if (request.method !== "GET") return json(405, { error: "Method not allowed." });
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] !== "api" || parts[1] !== "usage") return json(404, { error: "Not found." });

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
    contentMode: "metadata-with-excerpts",
    index: "auto"
  };
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

/** Reads an optional string query parameter. */
function stringParam(url: URL, key: string): string | undefined {
  return url.searchParams.get(key) || undefined;
}

/** Reads an optional numeric query parameter. */
function numberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

/** Sends a JSON route response. */
function json(status: number, value: unknown): UiRouteResponse {
  return { status, json: value };
}

/** Maps thrown errors to HTTP statuses. */
function errorStatus(error: unknown): number {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  const message = error instanceof Error ? error.message : String(error);
  return /not found|No usage sessions|No usage session/i.test(message) ? 404 : 500;
}
