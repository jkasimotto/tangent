import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http, { type Server } from "node:http";
import path from "node:path";

export * from "./build-identity.js";

export type UiModePreference = "auto" | "dev" | "static";

export type StaticUiAssets = {
  rootDir: string;
  indexFile?: string;
  dev?: DevUiAssets;
};

export type StaticAssetMount = {
  pathPrefix: string;
  assets: StaticUiAssets;
};

export type DevUiAssets = {
  sourceRoot: string;
};

export type EmbeddedUiAssets = StaticUiAssets & {
  modulePath: string;
};

export type LocalUiApp = {
  id: string;
  label: string;
  modulePath: string;
  stylePaths?: string[];
  routePath?: string;
};

export type UiAppContext = {
  repo: string;
  scope: "repo" | "all";
  mode: UiModePreference;
  providers?: string[];
  sources?: string[];
};

export type UiRouteResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  json?: unknown;
};

export type UiRoute = {
  method?: string;
  pattern: RegExp;
  handle(request: http.IncomingMessage, url: URL, match: RegExpMatchArray): Promise<UiRouteResponse | undefined> | UiRouteResponse | undefined;
};

export type UiAppRegistration = {
  app: LocalUiApp;
  routes: UiRoute[];
  assetMounts: StaticAssetMount[];
  close?: () => Promise<void>;
};

export type UiAppFactory = (context: UiAppContext) => Promise<UiAppRegistration | undefined> | UiAppRegistration | undefined;

export type CreateLocalUiServerOptions = {
  product: string;
  host?: string;
  port?: number;
  open?: boolean;
  mode?: UiModePreference;
  assets: StaticUiAssets;
  assetMounts?: StaticAssetMount[];
  routes?: UiRoute[];
};

export type LocalUiServer = {
  url: string;
  dev?: boolean;
  close(): Promise<void>;
};

type ViteDevServerLike = {
  middlewares(request: http.IncomingMessage, response: http.ServerResponse, next: (error?: unknown) => void): void;
  close(): Promise<void>;
};

type ActiveDevMount = {
  pathPrefix: string;
  server: ViteDevServerLike;
};

/** Creates create local ui server. */
export async function createLocalUiServer(options: CreateLocalUiServerOptions): Promise<LocalUiServer> {
  const host = options.host || "127.0.0.1";
  const devMounts = await startDevMounts(options);
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, options, devMounts);
  });
  await listen(server, options.port ?? 0, host);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error(`${options.product} UI server did not bind to a TCP address.`);
  const url = `http://${host}:${address.port}/`;
  if (options.open) openBrowser(url);
  return {
    url,
    dev: devMounts.length > 0,
    /** Closes the local server instance. */
    close: () => {
      // Drop idle keep-alive sockets (e.g. the browser's) so server.close() actually resolves instead of hanging.
      server.closeAllConnections?.();
      return Promise.all([
        ...devMounts.map((mount) => mount.server.close()),
        new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      ]).then(() => undefined);
    }
  };
}

/** Handles the local UI request. */
async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse, options: CreateLocalUiServerOptions, devMounts: ActiveDevMount[]): Promise<void> {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === "/healthz") return sendJson(response, 200, { ok: true, product: options.product, dev: devMounts.length > 0 });

    for (const route of options.routes || []) {
      if (route.method && route.method !== request.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      const handled = await route.handle(request, url, match);
      if (handled) return sendRouteResponse(response, handled);
    }

    if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Method not allowed." });
    if (url.pathname.startsWith("/api/")) return sendJson(response, 404, { error: "API route not found." });
    const devMount = matchingDevMount(url.pathname, devMounts);
    if (devMount) return handleDevMount(request, response, url, devMount);
    const mount = matchingAssetMount(url.pathname, options.assetMounts || []);
    if (mount) return await sendStatic(response, mountedPathname(url.pathname, mount.pathPrefix), mount.assets);
    return await sendStatic(response, url.pathname, options.assets);
  } catch (error) {
    return sendJson(response, 500, { error: (error as Error).message });
  }
}

/** Starts Vite middleware for dev-capable mounted assets. */
async function startDevMounts(options: CreateLocalUiServerOptions): Promise<ActiveDevMount[]> {
  const mode = options.mode || "static";
  if (mode === "static") return [];
  const candidates = (options.assetMounts || []).filter((mount) => mount.assets.dev);
  if (!candidates.length) {
    if (mode === "dev") throw new Error(`${options.product} UI dev mode is unavailable: no dev asset mounts are registered.`);
    return [];
  }
  const vite = await optionalImport<{ createServer(options: unknown): Promise<ViteDevServerLike> }>("vite");
  if (!vite?.createServer) {
    if (mode === "dev") throw new Error(`${options.product} UI dev mode requires Vite to be installed.`);
    return [];
  }
  const mounts: ActiveDevMount[] = [];
  for (const [index, mount] of candidates.entries()) {
    mounts.push({
      pathPrefix: mount.pathPrefix,
      server: await vite.createServer({
        root: mount.assets.dev!.sourceRoot,
        base: normalizedPrefix(mount.pathPrefix),
        appType: "custom",
        server: { hmr: { clientPort: 24679 + index, port: 24679 + index }, middlewareMode: true }
      })
    });
  }
  return mounts;
}

/** Finds the most specific active dev mount for a pathname. */
function matchingDevMount(pathname: string, mounts: ActiveDevMount[]): ActiveDevMount | undefined {
  return mounts
    .filter((mount) => mountMatches(pathname, mount.pathPrefix))
    .sort((left, right) => normalizedPrefix(right.pathPrefix).length - normalizedPrefix(left.pathPrefix).length)[0];
}

/** Rewrites and forwards a mounted request into Vite middleware. */
function handleDevMount(request: http.IncomingMessage, response: http.ServerResponse, url: URL, mount: ActiveDevMount): void {
  const originalUrl = request.url;
  request.url = `${url.pathname}${url.search}`;
  mount.server.middlewares(request, response, (error) => {
    request.url = originalUrl;
    if (error) return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    return sendJson(response, 404, { error: "Not found." });
  });
}

/** Finds the most specific static asset mount for a pathname. */
function matchingAssetMount(pathname: string, mounts: StaticAssetMount[]): StaticAssetMount | undefined {
  return mounts
    .filter((mount) => mountMatches(pathname, mount.pathPrefix))
    .sort((left, right) => normalizedPrefix(right.pathPrefix).length - normalizedPrefix(left.pathPrefix).length)[0];
}

/** Tests whether a mount prefix matches a request pathname. */
function mountMatches(pathname: string, prefix: string): boolean {
  const normalized = normalizedPrefix(prefix);
  return pathname === normalized.slice(0, -1) || pathname.startsWith(normalized);
}

/** Converts a mounted request path to the path served from the mounted root. */
function mountedPathname(pathname: string, prefix: string): string {
  const normalized = normalizedPrefix(prefix);
  const withoutPrefix = pathname.startsWith(normalized) ? pathname.slice(normalized.length - 1) : "/";
  return withoutPrefix || "/";
}

/** Normalizes an asset mount prefix. */
function normalizedPrefix(prefix: string): string {
  const withLeading = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

/** Supports the send static helper. */
async function sendStatic(response: http.ServerResponse, pathname: string, assets: StaticUiAssets): Promise<void> {
  const clean = pathname === "/" ? assets.indexFile || "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(assets.rootDir, clean);
  const root = path.resolve(assets.rootDir);
  if (!candidate.startsWith(root)) return sendJson(response, 403, { error: "Forbidden." });
  const file = await stat(candidate).then((entry) => entry.isFile() ? candidate : undefined).catch(() => undefined);
  if (!file) {
    const indexPath = path.join(root, assets.indexFile || "index.html");
    const body = await readFile(indexPath);
    return send(response, 200, body, contentType(indexPath));
  }
  response.writeHead(200, {
    "content-type": contentType(file),
    "cache-control": cacheControlFor(file)
  });
  createReadStream(file).pipe(response);
}

/**
 * Cache policy by filename. index.html must never cache (it points at the current bundles). Only
 * content-hashed files (e.g. `index-CfM7sdH4.js`) are safe to cache `immutable`, because a new build
 * gives them a new name. Stable-named files like the embedded apps' `embedded.js` / `embedded.css`
 * MUST revalidate (`no-cache`): their name never changes, so serving them `immutable` would pin the
 * browser to a stale build forever (the cause of the persistently stale PWA backdrop).
 */
function cacheControlFor(file: string): string {
  const name = path.basename(file);
  if (name === "index.html") return "no-store";
  if (/-[A-Za-z0-9_]{8,}\.[a-z0-9]+$/i.test(name)) return "public, max-age=31536000, immutable";
  return "no-cache";
}

/** Supports the send route response helper. */
function sendRouteResponse(response: http.ServerResponse, value: UiRouteResponse): void {
  if ("json" in value) return sendJson(response, value.status || 200, value.json);
  return send(response, value.status || 200, value.body || "", value.headers?.["content-type"] || "text/plain; charset=utf-8", value.headers);
}

/** Sends a JSON response. */
function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  send(response, status, `${JSON.stringify(value, null, 2)}\n`, "application/json; charset=utf-8");
}

/** Sends an HTTP response. */
function send(response: http.ServerResponse, status: number, body: string | Uint8Array, contentTypeValue: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    "content-type": contentTypeValue,
    "cache-control": "no-store",
    ...headers
  });
  response.end(body);
}

/** Supports the content type helper. */
function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
  return "application/octet-stream";
}

/** Lists listen. */
function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

/** Supports the open browser helper. */
export function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}

/** Dynamically imports an optional development dependency. */
async function optionalImport<T>(specifier: string): Promise<T | undefined> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (value: string) => Promise<T>;
  return dynamicImport(specifier).catch(() => undefined);
}
