import { sendJson } from "./http-json.mjs";

/** Creates the estimated-cost route the shell's top bar reads. */
export function createCostRoutes(operations) {
  const routes = new Map([["GET /api/cost", read]]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Answers with the current cost snapshot for the requested window. */
  async function read(_request, response, url) {
    const days = Number(url.searchParams.get("days") ?? 1);
    sendJson(response, 200, await operations.read({ days, wait: url.searchParams.get("wait") === "1" }));
  }

  return { handle };
}
