import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http, { type Server } from "node:http";
import path from "node:path";

export type StaticUiAssets = {
  rootDir: string;
  indexFile?: string;
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

export type CreateLocalUiServerOptions = {
  product: string;
  host?: string;
  port?: number;
  open?: boolean;
  assets: StaticUiAssets;
  routes?: UiRoute[];
};

export type LocalUiServer = {
  url: string;
  close(): Promise<void>;
};

/** Creates create local ui server. */
export async function createLocalUiServer(options: CreateLocalUiServerOptions): Promise<LocalUiServer> {
  const host = options.host || "127.0.0.1";
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, options);
  });
  await listen(server, options.port ?? 0, host);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error(`${options.product} UI server did not bind to a TCP address.`);
  const url = `http://${host}:${address.port}/`;
  if (options.open) openBrowser(url);
  return {
    url,
    /** Closes the local server instance. */
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

/** Handles the local UI request. */
async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse, options: CreateLocalUiServerOptions): Promise<void> {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === "/healthz") return sendJson(response, 200, { ok: true, product: options.product });

    for (const route of options.routes || []) {
      if (route.method && route.method !== request.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      const handled = await route.handle(request, url, match);
      if (handled) return sendRouteResponse(response, handled);
    }

    if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Method not allowed." });
    return await sendStatic(response, url.pathname, options.assets);
  } catch (error) {
    return sendJson(response, 500, { error: (error as Error).message });
  }
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
    "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable"
  });
  createReadStream(file).pipe(response);
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
