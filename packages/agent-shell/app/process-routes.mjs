import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP route table for the complete process-note lifecycle. */
export function createProcessRoutes(operations) {
  const routes = new Map([
    ["GET /api/processes", list],
    ["POST /api/processes/create", create],
    ["POST /api/processes/remove", remove],
    ["POST /api/processes/control", control],
    ["POST /api/processes/check", check],
  ]);

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    const route = routes.get(`${request.method} ${url.pathname}`);
    if (!route) return false;
    await route(request, response, url);
    return true;
  }

  /** Returns every process with its schedule, next run, last run, and state. */
  async function list(_request, response, url) {
    sendJson(response, 200, await operations.list(url.searchParams.get("area") ?? ""));
  }

  /** Creates one loop process note. */
  async function create(request, response) { await mutate(request, response, operations.create); }
  /** Removes one loop process note. */
  async function remove(request, response) { await mutate(request, response, operations.remove); }

  /** Pauses or resumes one process. */
  async function control(request, response) {
    await mutate(request, response, operations.control);
  }

  /** Evaluates one process now and says why. */
  async function check(request, response) {
    await mutate(request, response, operations.check);
  }

  /** Runs one process operation and reports a refusal as 409. */
  async function mutate(request, response, operation) {
    try {
      sendJson(response, 200, await operation(await readJson(request)));
    } catch (error) {
      sendJson(response, 409, { error: String(error.stderr ?? error.message ?? error) });
    }
  }

  return { handle };
}
