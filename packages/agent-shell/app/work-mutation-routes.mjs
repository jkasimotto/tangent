import { readJson, sendJson } from "./http-json.mjs";

/** Creates routes that mutate Goals and Area status. */
export function createWorkMutationRoutes(operations) {
  const routes = new Map([
    ["POST /api/goals/understanding", "understanding"],
    ["POST /api/goals/accept", "accept"],
    ["POST /api/goals/new", "createSimple"],
    ["POST /api/goals/create", "create"],
    ["GET /api/goals/detail", "detail"],
    ["POST /api/areas/status", "areaStatus"],
    ["POST /api/goals/edit", "edit"],
    ["POST /api/goals/cleanup", "cleanup"],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const operation = routes.get(`${request.method} ${url.pathname}`);
    if (!operation) return false;
    const input = request.method === "GET" ? Object.fromEntries(url.searchParams) : await readJson(request);
    if (request.method !== "GET" && !input.operationId && request.tangentOperationId) input.operationId = request.tangentOperationId;
    const result = await operations[operation](input);
    sendJson(response, result.status, result.value ?? {
      error: result.error,
      ...(result.code ? { code: result.code } : {}),
      ...(result.pipeline ? { pipeline: result.pipeline } : {}),
    });
    return true;
  }

  return { handle };
}
