import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP routes for presented-document attention state. */
export function createGoalPresentationRoutes(operations) {
  /** Handles one presentation route and reports whether this router owned it. */
  async function handle(request, response, url) {
    if (request.method !== "POST") return false;
    const handlers = {
      "/api/goals/present": operations.present,
      "/api/goals/withdraw-presentation": operations.withdraw,
      "/api/goals/dismiss-presentation": operations.dismiss,
      "/api/goals/presented-opened": operations.opened,
    };
    const operation = handlers[url.pathname];
    if (!operation) return false;
    const result = await operation(await readJson(request));
    sendJson(response, result.status, result.status < 400 ? result.value : { error: result.error });
    return true;
  }
  return { handle };
}
