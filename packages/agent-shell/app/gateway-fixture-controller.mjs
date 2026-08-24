// Minimal IPC controller used only by gateway resilience integration tests.
import http from "node:http";
import { randomUUID } from "node:crypto";

const boot = randomUUID();
const server = http.createServer((request, response) => {
  if (request.url === "/api/sessions") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ boot, sessions: [{ name: "durable-agent", state: "working" }] }));
    return;
  }
  if (request.url === "/api/block") {
    // Deliberately reproduce an event loop that cannot serve HTTP or IPC.
    for (;;) { /* test fixture: supervisor must terminate this process */ }
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, boot }));
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.send?.({ type: "agent-shell-ready", port: address.port, boot, pid: process.pid });
});

setInterval(() => process.send?.({ type: "agent-shell-heartbeat", boot, at: Date.now() }), 25);
process.once("disconnect", () => process.exit(0));
