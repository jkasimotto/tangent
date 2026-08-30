import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route table for live-agent discovery and messaging. */
export function createAgentRoutes(operations) {
  const routes = new Map([
    ["GET /api/agents", list],
    ["GET /api/agents/context", context],
    ["POST /api/agents/send", send],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Lists the live interactive agents. */
  async function list(_request, response) {
    sendJson(response, 200, { agents: await operations.list() });
  }

  /** Reads durable recovery context without inspecting or claiming a session. */
  async function context(_request, response, url) {
    const session = String(url.searchParams.get("session") ?? "").trim();
    if (!session) {
      sendJson(response, 400, { error: "agent context requires a session name" });
      return;
    }
    const value = await operations.context(session);
    sendJson(response, value ? 200 : 404, value
      ? { context: value }
      : { error: `no durable brain or Goal assignment for session ${session}` });
  }

  /** Sends or queues one message for a live agent, or a worker's send to its brain. */
  async function send(request, response) {
    const body = await readJson(request);
    try {
      body.operationId ??= String(request.headers["x-tangent-operation-id"] ?? "").trim();
      const result = String(body.to ?? "").trim() === "brain" ? await operations.sendToBrain(body) : await operations.send(body);
      sendJson(response, result.status, result.status === 200 ? result.value : { error: result.error });
    } catch (error) {
      sendJson(response, 400, { error: String(error.message ?? error) });
    }
  }

  return { handle };
}
