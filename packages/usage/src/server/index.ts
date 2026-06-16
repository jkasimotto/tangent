import http from "node:http";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { UiRoute, UiRouteResponse } from "@tangent/ui-server";
import { createUsageUiClient, type UsageUiClient } from "@tangent/usage-ui-data";
import { openUsage, type OpenUsageOptions, type UsageClient } from "../core/index.js";

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
  client?: UsageClient;
};

export type UsageUiServer = {
  url: string;
  sessionId?: string;
  dev?: boolean;
  close(): Promise<void>;
};

type UsageUiRequestContext = {
  client: UsageUiClient;
  usage: UsageClient;
  preferredSessionId?: string;
};

/** Starts the local Usage UI server. */
export async function startUsageUiServer(options: StartUsageUiServerOptions = {}): Promise<UsageUiServer> {
  const host = options.host || "127.0.0.1";
  const usage = options.client || await openUsage(openOptions(options));
  const client = createUsageUiClient(usage);
  const preferredSessionId = await preferredSession(options.sessionId, client);
  const routes = usageApiRoutes({ client, usage, preferredSessionId });
  if (options.dev) {
    const devServer = await tryStartUsageUiDevServer({
      product: "usage",
      host,
      port: options.port ?? 0,
      open: Boolean(options.open),
      routes
    });
    if (devServer) {
      return {
        url: devServer.url,
        sessionId: preferredSessionId,
        dev: true,
        close: devServer.close
      };
    }
  }
  const [{ createLocalUiServer }, { usageUiAssets }] = await Promise.all([
    import("@tangent/ui-server"),
    import("@tangent/usage-ui/assets")
  ]);
  const server = await createLocalUiServer({
    product: "usage",
    host,
    port: options.port ?? 0,
    open: Boolean(options.open),
    assets: usageUiAssets,
    routes
  });
  return {
    url: server.url,
    sessionId: preferredSessionId,
    dev: false,
    close: server.close
  };
}

type UsageUiDevServerOptions = {
  product: string;
  host: string;
  port: number;
  open: boolean;
  routes: UiRoute[];
};

type ViteDevServerLike = {
  middlewares(request: http.IncomingMessage, response: http.ServerResponse, next: (error?: unknown) => void): void;
  close(): Promise<void>;
};

/** Starts Vite middleware for workspace UI development when Vite and source files are available. */
async function tryStartUsageUiDevServer(options: UsageUiDevServerOptions): Promise<UsageUiServer | undefined> {
  const root = await usageUiSourceRoot();
  if (!root) return undefined;
  const vite = await optionalImport<{ createServer(options: unknown): Promise<ViteDevServerLike> }>("vite");
  if (!vite?.createServer) return undefined;

  let viteServer: ViteDevServerLike | undefined;
  const server = http.createServer((request, response) => {
    void handleDevRequest(request, response, { ...options, viteServer });
  });
  viteServer = await vite.createServer({
    root,
    appType: "spa",
    server: { middlewareMode: true, hmr: { server } }
  });
  await listen(server, options.port, options.host);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error(`${options.product} UI dev server did not bind to a TCP address.`);
  const url = `http://${options.host}:${address.port}/`;
  if (options.open) {
    const { openBrowser } = await import("@tangent/ui-server");
    openBrowser(url);
  }
  return {
    url,
    /** Closes the Vite dev server. */
    close: () => closeDevServer(viteServer, server)
  };
}

/** Closes Vite middleware and its owning HTTP server. */
async function closeDevServer(viteServer: ViteDevServerLike | undefined, server: http.Server): Promise<void> {
  await viteServer?.close();
  await closeServer(server);
}

/** Handles a request for the Usage UI Vite dev server. */
async function handleDevRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  options: UsageUiDevServerOptions & { viteServer?: ViteDevServerLike }
): Promise<void> {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === "/healthz") return sendJson(response, 200, { ok: true, product: options.product, dev: true });

    for (const route of options.routes) {
      if (route.method && route.method !== request.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      const handled = await route.handle(request, url, match);
      if (handled) return sendRouteResponse(response, handled);
    }

    if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Method not allowed." });
    if (url.pathname.startsWith("/api/")) return sendJson(response, 404, { error: "API route not found." });
    if (!options.viteServer) return sendJson(response, 503, { error: "Usage UI dev server is starting." });
    return options.viteServer.middlewares(request, response, (error) => {
      if (error) return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      return sendJson(response, 404, { error: "Not found." });
    });
  } catch (error) {
    return sendJson(response, 500, { error: (error as Error).message });
  }
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

/** Dynamically imports an optional development dependency. */
async function optionalImport<T>(specifier: string): Promise<T | undefined> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (value: string) => Promise<T>;
  return dynamicImport(specifier).catch(() => undefined);
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

/** Sends a UI route response from the dev server. */
function sendRouteResponse(response: http.ServerResponse, value: UiRouteResponse): void {
  if ("json" in value) return sendJson(response, value.status || 200, value.json);
  return send(response, value.status || 200, value.body || "", value.headers?.["content-type"] || "text/plain; charset=utf-8", value.headers);
}

/** Sends JSON from the dev server. */
function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  send(response, status, `${JSON.stringify(value, null, 2)}\n`, "application/json; charset=utf-8");
}

/** Sends a plain HTTP response from the dev server. */
function send(response: http.ServerResponse, status: number, body: string | Uint8Array, contentTypeValue: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    "content-type": contentTypeValue,
    "cache-control": "no-store",
    ...headers
  });
  response.end(body);
}

/** Waits for a local HTTP server to bind. */
function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

/** Closes a local HTTP server. */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

/** Maps thrown errors to HTTP statuses. */
function errorStatus(error: unknown): number {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  const message = error instanceof Error ? error.message : String(error);
  return /not found|No usage sessions|No usage session/i.test(message) ? 404 : 500;
}
