import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route table for live-agent discovery and messaging. */
export function createAgentRoutes(operations) {
  const routes = new Map([
    ["GET /api/agents", list],
    ["POST /api/agents/send", send],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response);
    return true;
  }

  /** Lists the live interactive agents. */
  async function list(_request, response) {
    sendJson(response, 200, { agents: await operations.list() });
  }

  /** Sends or queues one message for a live agent. */
  async function send(request, response) {
    const body = await readJson(request);
    try {
      const result = await operations.send(body);
      sendJson(response, result.status, result.status === 200 ? result.value : { error: result.error });
    } catch (error) {
      sendJson(response, 400, { error: String(error.message ?? error) });
    }
  }

  return { handle };
}
