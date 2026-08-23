/** Creates the small server-sent-event hub used to invalidate shell snapshots. */
export function createStateEvents() {
  const clients = new Set();

  /** Keeps one event stream open until its request closes. */
  function connect(request, response) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write("event: ready\ndata: {}\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
  }

  /** Tells every connected shell to fetch one fresh snapshot. */
  function changed(reason = "state") {
    const event = `event: changed\ndata: ${JSON.stringify({ reason })}\n\n`;
    for (const response of clients) response.write(event);
  }

  return { changed, connect };
}
