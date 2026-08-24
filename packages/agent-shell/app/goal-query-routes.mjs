import { readJson, sendJson } from "./http-json.mjs";

/** Creates Goal discovery, ownership, and brief routes. */
export function createGoalQueryRoutes(operations) {
  const routes = new Map([
    ["GET /api/goals", list],
    ["GET /api/goals/show", show],
    ["POST /api/goals/own", own],
    ["POST /api/goals/release", release],
    ["POST /api/goals/depend", depend],
    ["POST /api/goals/undepend", undepend],
    ["GET /api/goals/brief", brief],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Lists Goals, optionally limited to one Area. */
  async function list(_request, response, url) {
    sendResult(response, await operations.list(url.searchParams.get("area")));
  }

  /** Finds one Goal by slug. */
  async function show(_request, response, url) {
    sendResult(response, await operations.show(url.searchParams.get("slug") ?? ""));
  }

  /** Assigns Goals to the calling session. */
  async function own(request, response) {
    sendResult(response, await operations.ownership(await readJson(request), false));
  }

  /** Releases Goals from the calling session. */
  async function release(request, response) {
    sendResult(response, await operations.ownership(await readJson(request), true));
  }

  /** Adds prerequisites to one Goal. */
  async function depend(request, response) {
    sendResult(response, await operations.dependencies(await readJson(request), false));
  }

  /** Removes prerequisites from one Goal. */
  async function undepend(request, response) {
    sendResult(response, await operations.dependencies(await readJson(request), true));
  }

  /** Returns the complete launch brief for one Goal file. */
  async function brief(_request, response, url) {
    sendResult(response, await operations.brief(
      url.searchParams.get("file") ?? "",
      url.searchParams.get("mode") ?? "goal",
      Number(url.searchParams.get("step") ?? 0),
    ));
  }

  /** Sends one `{status, value|error}` operation result. */
  function sendResult(response, result) {
    sendJson(response, result.status, result.value ?? { error: result.error });
  }

  return { handle };
}
