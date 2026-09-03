import { sendJson } from "./http-json.mjs";

/** Creates the route that serves what each worker has cost. */
export function createCostRoutes(operations) {
  const routes = new Map([["GET /api/cost/workers", readWorkers]]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Answers with what each worker has cost, keyed by Goal and by session. */
  async function readWorkers(_request, response, url) {
    sendJson(response, 200, await operations.readWorkers({ wait: url.searchParams.get("wait") === "1" }));
  }

  return { handle };
}
