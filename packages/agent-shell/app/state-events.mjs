/** Creates the bounded server-sent-event hub used to invalidate snapshots. */
export function createStateEvents({ maxClients = 256, heartbeatMs = 15_000 } = {}) {
  const clients = new Set();

  /** Removes one response from the hub exactly once. */
  function remove(response) {
    clients.delete(response);
  }

  /** Keeps one event stream open until its request closes. */
  function connect(request, response) {
    if (clients.size >= maxClients) {
      response.writeHead(503, { "content-type": "application/json", connection: "close" });
      response.end(JSON.stringify({ error: "too many Agent Shell event streams" }));
      return false;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write("event: ready\ndata: {}\n\n");
    clients.add(response);
    request.on("close", () => remove(response));
    response.on("close", () => remove(response));
    response.on("error", () => remove(response));
    return true;
  }

  /** Tells every connected shell to fetch one fresh snapshot. */
  function changed(reason = "state") {
    const event = `event: changed\ndata: ${JSON.stringify({ reason })}\n\n`;
    for (const response of clients) {
      if (response.writableEnded || response.destroyed) {
        remove(response);
        continue;
      }
      // One invalidation is enough. Skip duplicates while the kernel/socket
      // buffer is full instead of building an unbounded per-client queue.
      if (response.writableNeedDrain) continue;
      try { response.write(event); } catch { remove(response); }
    }
  }

  const heartbeat = setInterval(() => {
    for (const response of clients) {
      if (response.writableEnded || response.destroyed) remove(response);
      else if (!response.writableNeedDrain) {
        try { response.write(": heartbeat\n\n"); } catch { remove(response); }
      }
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  /** Ends all streams during controlled server shutdown. */
  function close() {
    clearInterval(heartbeat);
    for (const response of clients) response.end();
    clients.clear();
  }

  return {
    changed,
    close,
    connect,
    /** Reports the current bounded client count. */
    size: () => clients.size,
  };
}
