import { readJson, sendJson } from "./http-json.mjs";

/** Creates routes that mutate Goals, ideas, and Area status. */
export function createWorkMutationRoutes(operations) {
  const routes = new Map([
    ["POST /api/goals/understanding", "understanding"],
    ["POST /api/goals/accept", "accept"],
    ["POST /api/goals/new", "createSimple"],
    ["POST /api/goals/create", "create"],
    ["POST /api/goals/assignees", "assignees"],
    ["POST /api/idea/new", "createIdea"],
    ["GET /api/ideas", "ideas"],
    ["POST /api/areas/status", "areaStatus"],
    ["POST /api/areas/people", "areaPeople"],
    ["POST /api/goals/edit", "edit"],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const operation = routes.get(`${request.method} ${url.pathname}`);
    if (!operation) return false;
    const input = request.method === "GET" ? Object.fromEntries(url.searchParams) : await readJson(request);
    const result = await operations[operation](input);
    sendJson(response, result.status, result.value ?? { error: result.error });
    return true;
  }

  return { handle };
}
