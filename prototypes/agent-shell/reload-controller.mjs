import { watch } from "node:fs";

/** Owns Agent Shell's reload event stream and debounced public-asset watcher. */
export function createReloadController({ watchDir, debounceMs = 120, watchFiles = watch } = {}) {
  const clients = new Set();
  let sequence = 0;
  let debounceTimer;

  /** Broadcasts one named reload event to every connected browser. */
  function broadcast(reason, force = false) {
    const payload = JSON.stringify({ reason, force, sequence: ++sequence });
    for (const response of clients) response.write(`event: reload\ndata: ${payload}\n\n`);
    return clients.size;
  }

  /** Registers a browser response as a long-lived server-sent event stream. */
  function addClient(request, response) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    response.write("retry: 1000\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
  }

  /** Handles the reload protocol's two local HTTP endpoints. */
  function handle(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/reload/events") {
      addClient(request, response);
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/reload") {
      const notified = broadcast("force", true);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, notified }));
      return true;
    }
    return false;
  }

  /** Coalesces the several filesystem events one save commonly emits. */
  function scheduleSourceReload() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => broadcast("source-change"), debounceMs);
  }

  const watcher = watchDir ? watchFiles(watchDir, { recursive: true }, scheduleSourceReload) : undefined;
  watcher?.on?.("error", (error) => console.error("agent-shell reload watcher:", error.message ?? error));

  return {
    broadcast,
    /** Announces a backend restart before its HTTP connection disappears. */
    announceRestart() { return broadcast("server-restart", true); },
    handle,
    /** Number of browsers currently listening for reloads. */
    get clientCount() { return clients.size; },
    /** Stops file watching and closes every connected event stream. */
    close() {
      clearTimeout(debounceTimer);
      watcher?.close();
      for (const response of clients) response.end();
      clients.clear();
    },
  };
}
